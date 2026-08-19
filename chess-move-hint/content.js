(() => {
  const ENGINE_URL = chrome.runtime.getURL('engine/stockfish.js');
  const STRENGTHS = {
    fast: { depth: 12, movetime: 300 },
    normal: { depth: 18, movetime: 900 },
    strong: { depth: 22, movetime: 2500 },
    brutal: { depth: 26, movetime: 6000 },
  };
  let engineCfg = STRENGTHS.normal;

  const pieceLetter = { king: 'K', queen: 'Q', rook: 'R', bishop: 'B', knight: 'N', pawn: 'P' };
  const shortPieceLetter = { k: 'K', q: 'Q', r: 'R', b: 'B', n: 'N', p: 'P' };
  const Chess = exports.Chess;

  const state = {
    ready: false,
    busy: false,
    queuedFen: null,
    lastFen: null,
    cache: new Map(),
    best: null,
    held: false,
    evalText: '',
    depthText: '',
    engineError: null,
  };

  let lastMouse = null;

  const DEFAULT_SHORTCUTS = [
    { ctrl: true, alt: false, shift: false, meta: false, key: 'KeyQ' },
  ];

  let shortcuts = DEFAULT_SHORTCUTS.slice();

  function isAltQ(s) {
    return s && s.key === 'KeyQ' && s.alt && !s.ctrl && !s.shift && !s.meta;
  }

  function loadShortcutsFromStorage() {
    chrome.storage.sync.get(['shortcuts', 'shortcut'], (d) => {
      if (Array.isArray(d.shortcuts) && d.shortcuts.length) {
        const cleaned = d.shortcuts.filter(isValidShortcut).filter((s) => !isAltQ(s));
        shortcuts = cleaned.length ? cleaned : DEFAULT_SHORTCUTS.slice();
        if (cleaned.length !== d.shortcuts.filter(isValidShortcut).length) {
          chrome.storage.sync.set({ shortcuts });
        }
      } else if (d.shortcut) {
        shortcuts = isAltQ(d.shortcut) ? DEFAULT_SHORTCUTS.slice() : [{ ...DEFAULT_SHORTCUTS[0], ...d.shortcut }];
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
    if (area !== 'sync') return;
    if (changes.shortcuts && changes.shortcuts.newValue) {
      const filtered = changes.shortcuts.newValue.filter(isValidShortcut).filter((s) => !isAltQ(s));
      shortcuts = filtered.length ? filtered : DEFAULT_SHORTCUTS.slice();
    }
    if (changes.strength && changes.strength.newValue !== changes.strength.oldValue) {
      applyStrength(changes.strength.newValue);
      reloadForStrength();
    }
  });

  function applyStrength(name) {
    const s = STRENGTHS[name] || STRENGTHS.normal;
    engineCfg = { depth: s.depth, movetime: s.movetime };
  }

  function reloadForStrength() {
    state.cache.clear();
    state.best = null;
    refreshCursor();
    warmup();
  }

  function loadStrengthFromStorage() {
    chrome.storage.sync.get('strength', (d) => {
      applyStrength(d.strength);
      reloadForStrength();
    });
  }

  loadStrengthFromStorage();

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

  function isRecalibrateCombo(e) {
    return e.code === 'KeyQ' && e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey;
  }

  function isTypingTarget(e) {
    const t = e.target;
    if (!t || !t.tagName) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }

  function readSquare(pieceEl) {
    const cn = String(pieceEl.className || '');
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
    const pa = boardPlayingAs();
    if (pa === 'black') return 'b';
    if (pa === 'white') return 'w';
    return 'w';
  }

  function boardPlayingAs() {
    try {
      const board = document.querySelector('wc-board, .board');
      if (board && board.game && typeof board.game.getPlayingAs === 'function') {
        const c = board.game.getPlayingAs();
        if (c === 'black' || c === 'white') return c;
      }
    } catch (e) {}
    return null;
  }

  function boardFen() {
    try {
      const board = document.querySelector('wc-chess-board, wc-board, .board');
      if (board && board.game && typeof board.game.getFEN === 'function') {
        const fen = board.game.getFEN();
        if (typeof fen === 'string' && fen) return fen;
      }
    } catch (e) {}
    try {
      const board = document.querySelector('wc-chess-board, wc-board, .board');
      const fen = board && board.getAttribute ? board.getAttribute('data-cc-hint-fen') : null;
      if (typeof fen === 'string' && fen) return fen;
    } catch (e) {}
    return null;
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
    const authoritative = boardFen();
    if (authoritative) {
      try {
        new Chess(authoritative);
        return { fen: authoritative };
      } catch (e) {}
    }
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
      state.best =
        bm && bm !== '0000' && bm.length >= 4
          ? { from: bm.slice(0, 2), to: bm.slice(2, 4) }
          : null;
      refreshCursor();
      if (bm && bm !== '0000') {
        const san = toSan(fen, bm);
        if (san) {
          cacheSet(fen, san, metaText(), bm);
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

  function cacheSet(fen, san, meta, uci) {
    if (state.cache.size > 200) {
      const first = state.cache.keys().next().value;
      state.cache.delete(first);
    }
    let from = null;
    let to = null;
    if (uci && uci.length >= 4) {
      from = uci.slice(0, 2);
      to = uci.slice(2, 4);
    }
    state.cache.set(fen, { san, meta, from, to });
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
    sendEngine('go depth ' + engineCfg.depth + ' movetime ' + engineCfg.movetime);
  }

  function showCached(fen) {
    const c = state.cache.get(fen);
    if (c) setHint(c.san, c.meta);
  }

  function warmup() {
    const pos = readBoard();
    if (!pos) return;
    if (state.lastFen === pos.fen) return;
    state.best = null;
    refreshCursor();
    requestMove(pos.fen);
  }

  function currentFenLight() {
    try {
      const board = document.querySelector('wc-chess-board, wc-board, .board');
      const fen = board && board.getAttribute ? board.getAttribute('data-cc-hint-fen') : null;
      if (typeof fen === 'string' && fen) return fen;
    } catch (e) {}
    return null;
  }

  function squareName(sq) {
    const fileIdx = Math.floor(sq / 10) - 1;
    if (fileIdx < 0 || fileIdx > 7) return null;
    return String.fromCharCode(97 + fileIdx) + (sq % 10);
  }

  function isUserTurn() {
    try {
      if ((location.pathname || '').includes('/analysis')) return true;
      const fen = currentFenLight();
      if (!fen) return false;
      const turn = fen.split(' ')[1];
      if (turn !== 'b' && turn !== 'w') return false;
      const board = document.querySelector('wc-chess-board, wc-board, .board');
      const flipped = !!(board && board.classList && board.classList.contains('flipped'));
      return flipped ? turn === 'b' : turn === 'w';
    } catch (e) {
      return true;
    }
  }

  let markedEls = null;
  function clearHintCursor() {
    if (!markedEls) return;
    for (const el of markedEls) el.style.removeProperty('cursor');
    markedEls = null;
  }

  let boardMarkedEl = null;
  function removeBoardCursor() {
    if (boardMarkedEl) {
      try { boardMarkedEl.style.removeProperty('cursor'); } catch (e) {}
      boardMarkedEl = null;
    }
    try {
      const board = document.querySelector('wc-chess-board, wc-board, .board');
      if (board) board.style.removeProperty('cursor');
    } catch (e) {}
  }

  function gridCalibration() {
    const board = document.querySelector('wc-chess-board, wc-board, .board');
    if (!board) return null;
    const p11 = document.querySelector('.piece.square-11');
    const p88 = document.querySelector('.piece.square-88');
    if (p11 && p88) {
      const r1 = p11.getBoundingClientRect();
      const r2 = p88.getBoundingClientRect();
      const cell = Math.abs(r2.left - r1.left) / 7;
      if (cell > 0 && isFinite(cell)) {
        return {
          board,
          xMin: Math.min(r1.left, r2.left),
          yMin: Math.min(r1.top, r2.top),
          cell,
          flippedX: r1.left > r2.left,
          flippedY: r1.top < r2.top,
        };
      }
    }
    const r = board.getBoundingClientRect();
    return { board, xMin: r.left, yMin: r.top, cell: r.width / 8, flippedX: false, flippedY: false };
  }

function applyBoardCursorAt(x, y) {
    const fen = currentFenLight();
    if (!fen || fen !== state.lastFen || !state.best || !isUserTurn()) {
      removeBoardCursor();
      return;
    }
    const g = gridCalibration();
    if (!g) { removeBoardCursor(); return; }
    const colIdx = Math.floor((x - g.xMin) / g.cell - 1e-6);
    const rowIdx = Math.floor((y - g.yMin) / g.cell - 1e-6);
    if (colIdx < 0 || colIdx > 7 || rowIdx < 0 || rowIdx > 7) {
      removeBoardCursor();
      return;
    }
    const col = g.flippedX ? 7 - colIdx : colIdx;
    const rank = g.flippedY ? rowIdx : 7 - rowIdx;
    const name = String.fromCharCode(97 + col) + (rank + 1);
    if (name !== state.best.to) {
      removeBoardCursor();
      return;
    }
    // set cursor on the topmost element at the point so it survives
    // overlays chess.com draws on top of the board (check / last-move /
    // legal-move highlight SVGs — common on diagonals for bishops/checks)
    let el = null;
    try { el = document.elementFromPoint(x, y); } catch (e) {}
    if (!el || el === document || el === document.documentElement || el === document.body) {
      el = g.board;
    }
    if (boardMarkedEl && boardMarkedEl !== el) {
      try { boardMarkedEl.style.removeProperty('cursor'); } catch (e) {}
      boardMarkedEl = null;
    }
    el.style.setProperty('cursor', 'grab', 'important');
    boardMarkedEl = el;
  }

  function refreshCursor() {
    if (lastMouse) applyBoardCursorAt(lastMouse.x, lastMouse.y);
  }

  let moveRaf = 0;
  function onBoardMouseMove(e) {
    lastMouse = { x: e.clientX, y: e.clientY };
    if (readSquare(e.target) != null) return;
    if (moveRaf) return;
    moveRaf = requestAnimationFrame(() => {
      moveRaf = 0;
      applyBoardCursorAt(e.clientX, e.clientY);
    });
  }

  function onBoardMouseOver(e) {
    let el = e.target;
    let sq = readSquare(el);
    if (sq == null && el.parentElement) {
      el = el.parentElement;
      sq = readSquare(el);
    }
    if (sq == null) {
      clearHintCursor();
      return;
    }
    const fen = currentFenLight();
    const squares = fen && fen === state.lastFen ? state.best : null;
    if (!squares || !isUserTurn()) {
      clearHintCursor();
      removeBoardCursor();
      return;
    }
    removeBoardCursor();
    const name = squareName(sq);
    let cursor = null;
    if (name === squares.from) cursor = 'default';
    else if (name === squares.to) cursor = 'default';
    if (!cursor) {
      clearHintCursor();
      return;
    }
    if (markedEls && markedEls.has(el)) return;
    clearHintCursor();
    el.style.setProperty('cursor', cursor, 'important');
    markedEls = new Set([el]);
  }

  function onKeyDown(e) {
    if (e.repeat || isTypingTarget(e)) return;
    if (isRecalibrateCombo(e)) {
      e.preventDefault();
      e.stopPropagation();
      refreshCursor();
      return;
    }
    if (!comboMatches(e)) return;
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
  document.addEventListener('mouseover', onBoardMouseOver, true);
  document.addEventListener('mousemove', onBoardMouseMove, true);
  window.addEventListener('blur', hideIfUnheld);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hideIfUnheld();
  });
})();