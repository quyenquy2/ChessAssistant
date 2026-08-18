(() => {
  const ENGINE_URL = chrome.runtime.getURL('engine/stockfish.js');
  const DEPTH = 18;
  const MOVE_TIME = 900;

  const pieceLetter = { king: 'K', queen: 'Q', rook: 'R', bishop: 'B', knight: 'N', pawn: 'P' };
  const shortPieceLetter = { k: 'K', q: 'Q', r: 'R', b: 'B', n: 'N', p: 'P' };
  const Chess = exports.Chess;

  const state = {
    ready: false,
    busy: false,
    queuedFen: null,
    lastFen: null,
    cache: new Map(),
    held: false,
    evalText: '',
    depthText: '',
    engineError: null,
  };

  const DEFAULT_SHORTCUTS = [
    { ctrl: true, alt: false, shift: false, meta: false, key: 'KeyQ' },
    { ctrl: false, alt: true, shift: false, meta: false, key: 'KeyQ' },
  ];

  let shortcuts = DEFAULT_SHORTCUTS.slice();

  function loadShortcutsFromStorage() {
    chrome.storage.sync.get(['shortcuts', 'shortcut'], (d) => {
      if (Array.isArray(d.shortcuts) && d.shortcuts.length) {
        shortcuts = d.shortcuts.filter(isValidShortcut);
        if (shortcuts.length === 0) shortcuts = DEFAULT_SHORTCUTS.slice();
      } else if (d.shortcut) {
        shortcuts = [{ ...DEFAULT_SHORTCUTS[0], ...d.shortcut }];
        chrome.storage.sync.set({ shortcuts });
      }
    });
  }

  function isValidShortcut(s) {
    return s && typeof s.key === 'string' && /^Key[A-Z]$|^(F\d+|Digit\d+|Numpad\d+|Space|Enter|Tab|Backspace|Escape|Arrow[A-Z][a-z]+|Minus|Equal|Comma|Period|Slash|Backslash|BracketLeft|BracketRight|Semicolon|Quote|Backquote)$/.test(s.key);
  }

  function shortcutsMatch(e) {
    return shortcuts.some((s) =>
      e.code === s.key &&
      !!e.ctrlKey === !!s.ctrl &&
      !!e.altKey === !!s.alt &&
      !!e.shiftKey === !!s.shift &&
      !!e.metaKey === !!s.meta
    );
  }

  function anyKeyOfShortcuts(e) {
    if (shortcuts.some((s) => e.code === s.key)) return true;
    for (const s of shortcuts) {
      const mods = [];
      if (s.ctrl) mods.push('Control');
      if (s.alt) mods.push('AltLeft', 'AltRight');
      if (s.shift) mods.push('ShiftLeft', 'ShiftRight');
      if (s.meta) mods.push('MetaLeft', 'MetaRight');
      if (mods.includes(e.code)) return true;
    }
    return false;
  }

  loadShortcutsFromStorage();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.shortcuts && changes.shortcuts.newValue) {
      const next = (changes.shortcuts.newValue || []).filter(isValidShortcut);
      shortcuts = next.length ? next : DEFAULT_SHORTCUTS.slice();
    }
  });

  let overlay = null;
  function ensureOverlay() {
    if (overlay && overlay.isConnected) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'cc-hint';
    overlay.innerHTML = '<div class="cc-hint-move"></div><div class="cc-hint-meta"></div>';
    (document.body || document.documentElement).appendChild(overlay);
    return overlay;
  }

  function setHint(san, meta) {
    const el = ensureOverlay();
    el.querySelector('.cc-hint-move').textContent = san;
    el.querySelector('.cc-hint-meta').textContent = meta || '';
  }

  function showHint() {
    ensureOverlay().classList.add('cc-show');
  }

  function hideHint() {
    if (overlay) overlay.classList.remove('cc-show');
  }

  function comboMatches(e) {
    return shortcutsMatch(e);
  }

  function isComboKey(e) {
    return anyKeyOfShortcuts(e);
  }

  function isTypingTarget(e) {
    const t = e.target;
    if (!t || !t.tagName) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }

  function readSquare(pieceEl) {
    const cn = pieceEl.className || '';
    const m = cn.match(/\bsquare-(\d+)\b/);
    return m ? parseInt(m[1], 10) : null;
  }

  function pieceCodeFromClass(pieceEl) {
    const cn = pieceEl.className || '';
    let m = cn.match(/\b(white|black)-(king|queen|rook|bishop|knight|pawn)\b/);
    if (m) return { color: m[1], letter: pieceLetter[m[2]] };
    m = cn.match(/\b(w|b)(k|q|r|b|n|p)\b/);
    if (!m) return null;
    const color = m[1] === 'w' ? 'white' : 'black';
    const letter = shortPieceLetter[m[2]];
    return { color, letter };
  }

  function parsePieces(board) {
    const grid = Array.from({ length: 8 }, () => Array(8).fill(''));
    const pieces = board.querySelectorAll('.piece');
    for (const p of pieces) {
      const sq = readSquare(p);
      if (sq == null || sq < 11 || sq > 88) continue;
      const code = pieceCodeFromClass(p);
      if (!code) continue;
      const fileIdx = Math.floor(sq / 10) - 1;
      const rankIdx = (sq % 10) - 1;
      const rank = 7 - rankIdx;
      const file = fileIdx;
      if (rank < 0 || rank > 7 || file < 0 || file > 7) continue;
      grid[rank][file] = code.color === 'white' ? code.letter : code.letter.toLowerCase();
    }
    return grid;
  }

  function sideToMove() {
    const sel =
      document.querySelector('.move-list .node-highlight') ||
      document.querySelector('.move-list .node:last-child');
    if (sel) {
      const node = sel.classList.contains('node') ? sel : sel.closest('.node');
      if (node) {
        const plyRaw = node.dataset.ply || node.getAttribute('data-ply');
        if (plyRaw) return parseInt(plyRaw, 10) % 2 === 1 ? 'b' : 'w';
        const parent = node.parentElement;
        const siblings = parent
          ? Array.from(parent.children).filter((el) => el.classList.contains('node'))
          : [];
        return (siblings.indexOf(node) + 1) % 2 === 1 ? 'b' : 'w';
      }
    }
    const parts = chesscomFenParts();
    if (parts && (parts[1] === 'b' || parts[1] === 'w')) return parts[1];
    return 'w';
  }

  function chesscomFenParts() {
    try {
      const cc = (window.wrappedJSObject && window.wrappedJSObject.chesscom)
        || window.chesscom;
      const fen = cc && cc.analysis && cc.analysis.fen;
      if (typeof fen === 'string' && fen) return fen.split(/\s+/);
    } catch (e) {}
    try {
      const url = new URL(location.href);
      const raw = url.searchParams.get('fen');
      if (typeof raw === 'string' && raw) {
        return raw.replace(/\+/g, ' ').split(/\s+/);
      }
    } catch (e) {}
    return null;
  }

  function castlingRights(grid) {
    const p = chesscomFenParts();
    if (p && p[2]) return p[2];
    let rights = '';
    if (grid[7][4] === 'K') {
      if (grid[7][7] === 'R') rights += 'K';
      if (grid[7][0] === 'R') rights += 'Q';
    }
    if (grid[0][4] === 'k') {
      if (grid[0][7] === 'r') rights += 'k';
      if (grid[0][0] === 'r') rights += 'q';
    }
    return rights || '-';
  }

  function epSquare(grid, turn) {
    const p = chesscomFenParts();
    if (p && p[3] && p[3] !== '-') return p[3];
    const last = document.querySelector('.move-list .node:last-child');
    if (!last) return '-';
    const text = (last.textContent || '').trim();
    const m = text.match(/^([a-h])([2-7])([+#])?$/);
    if (!m) return '-';
    const file = m[1];
    const destRank = parseInt(m[2], 10);
    const mover = turn === 'w' ? 'b' : 'w';
    const destRow = mover === 'w' ? destRank - 1 : 8 - destRank;
    const pawn = mover === 'w' ? 'P' : 'p';
    const enemy = mover === 'w' ? 'p' : 'P';
    const fIdx = file.charCodeAt(0) - 97;
    if (grid[destRow][fIdx] !== pawn) return '-';
    if (mover === 'w' ? destRank !== 4 : destRank !== 5) return '-';
    const adjacent =
      (fIdx > 0 && grid[destRow][fIdx - 1] === enemy) ||
      (fIdx < 7 && grid[destRow][fIdx + 1] === enemy);
    if (!adjacent) return '-';
    return file + (mover === 'w' ? '3' : '6');
  }

  function buildFen(grid) {
    const rows = [];
    for (let r = 0; r < 8; r++) {
      let line = '';
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const c = grid[r][f];
        if (!c) empty++;
        else {
          if (empty) {
            line += empty;
            empty = 0;
          }
          line += c;
        }
      }
      if (empty) line += empty;
      rows.push(line);
    }
    const turn = sideToMove();
    return (
      rows.join('/') + ' ' + turn + ' ' + castlingRights(grid) + ' ' + epSquare(grid, turn) + ' 0 1'
    );
  }

  function readBoard() {
    const board = document.querySelector('wc-board, .board');
    if (!board) return null;
    let fen = buildFen(parsePieces(board));
    try {
      new Chess(fen);
      return { fen };
    } catch (e) {
      return null;
    }
  }

  function formatScore(kind, val) {
    const v = parseInt(val, 10);
    if (kind === 'mate') return '#' + v;
    const p = v / 100;
    return (p >= 0 ? '+' : '-') + Math.abs(p).toFixed(2);
  }

  function metaText() {
    const parts = [];
    if (state.evalText) parts.push(state.evalText);
    if (state.depthText) parts.push('depth ' + state.depthText);
    return parts.join(' · ');
  }

  function toSan(fen, uci) {
    const uciMove = uci.trim().split(' ')[0];
    if (!uciMove || uciMove.length < 4) return null;
    const from = uciMove.slice(0, 2);
    const to = uciMove.slice(2, 4);
    const promotion = uciMove.length >= 5 ? uciMove.slice(4, 5).toLowerCase() : undefined;
    try {
      const c = new Chess(fen);
      const mv = c.move({ from, to, promotion });
      return mv ? mv.san : null;
    } catch (e) {
      return null;
    }
  }

  let worker = null;

  function initEngine() {
    fetch(ENGINE_URL)
      .then((r) => r.text())
      .then((src) => {
        const blob = new Blob([src], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        try {
          worker = new Worker(blobUrl);
          worker.addEventListener('message', (e) => onEngineLine(e.data));
          worker.addEventListener('error', (err) => {
            state.engineError = String(err.message || err);
            setHint('engine error', state.engineError.slice(0, 200));
          });
          worker.postMessage('uci');
        } catch (err) {
          state.engineError = String(err.message || err);
          setHint('engine error', state.engineError.slice(0, 200));
        }
      })
      .catch((err) => {
        state.engineError = String(err.message || err);
        setHint('engine error', state.engineError.slice(0, 200));
      });
  }

  function onEngineLine(line) {
    line = String(line || '').trim();
    if (line === 'uciok') {
      sendEngine('isready');
      return;
    }
    if (line === 'readyok') {
      state.ready = true;
      if (state.queuedFen) {
        const f = state.queuedFen;
        state.queuedFen = null;
        requestMove(f);
      } else {
        warmup();
      }
      return;
    }
    if (line.startsWith('info')) {
      const d = line.match(/depth (\d+)/);
      if (d) state.depthText = d[1];
      const s = line.match(/score (cp|mate) (-?\d+)/);
      if (s) state.evalText = formatScore(s[1], s[2]);
      return;
    }
    if (line.startsWith('bestmove')) {
      state.busy = false;
      const bm = (line.split(' ')[1] || '').trim();
      const fen = state.lastFen;
      if (bm && bm !== '0000') {
        const san = toSan(fen, bm);
        if (san) {
          cacheSet(fen, san, metaText());
          if (state.held) showCached(fen);
          flushQueue(fen);
          return;
        }
      }
      cacheSet(fen, '—', '');
      if (state.held) showCached(fen);
      flushQueue(fen);
    }
  }

  function cacheSet(fen, san, meta) {
    if (state.cache.size > 200) {
      const first = state.cache.keys().next().value;
      state.cache.delete(first);
    }
    state.cache.set(fen, { san, meta });
  }

  function flushQueue(currentFen) {
    if (state.queuedFen && state.queuedFen !== currentFen) {
      const f = state.queuedFen;
      state.queuedFen = null;
      requestMove(f);
    }
  }

  function sendEngine(cmd) {
    if (worker) worker.postMessage(cmd);
  }

  function requestMove(fen) {
    state.lastFen = fen;
    if (!state.ready) {
      state.queuedFen = fen;
      return;
    }
    if (state.busy) {
      state.queuedFen = fen;
      return;
    }
    state.busy = true;
    state.evalText = '';
    state.depthText = '';
    sendEngine('position fen ' + fen);
    sendEngine('go depth ' + DEPTH + ' movetime ' + MOVE_TIME);
  }

  function showCached(fen) {
    const c = state.cache.get(fen);
    if (c) setHint(c.san, c.meta);
  }

  function warmup() {
    const pos = readBoard();
    if (!pos) return;
    if (state.lastFen === pos.fen) return;
    requestMove(pos.fen);
  }

  function onKeyDown(e) {
    if (e.repeat || isTypingTarget(e) || !comboMatches(e)) return;
    state.held = true;
    showHint();
    const pos = readBoard();
    if (!pos) {
      setHint('—', state.engineError ? 'engine error' : '');
      return;
    }
    const fen = pos.fen;
    const cached = state.cache.get(fen);
    if (cached) {
      setHint(cached.san, cached.meta);
      return;
    }
    setHint('…', '');
    requestMove(fen);
  }

  function onKeyUp(e) {
    if (!state.held || !isComboKey(e)) return;
    state.held = false;
    hideHint();
  }

  function hideIfUnheld() {
    state.held = false;
    hideHint();
  }

  function debounce(fn, ms) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  initEngine();

  const board = document.querySelector('wc-board, .board');
  const observer = new MutationObserver(debounce(warmup, 600));
  observer.observe(board || document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['style', 'class'],
  });

  setInterval(warmup, 5000);

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', hideIfUnheld);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hideIfUnheld();
  });
})();