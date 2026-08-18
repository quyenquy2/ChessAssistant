(() => {
  const DEFAULT_SHORTCUTS = [
    { ctrl: true, alt: false, shift: false, meta: false, key: 'KeyQ' },
    { ctrl: false, alt: true, shift: false, meta: false, key: 'KeyQ' },
  ];
  const MOD_CODES = new Set([
    'ControlLeft', 'ControlRight',
    'AltLeft', 'AltRight',
    'ShiftLeft', 'ShiftRight',
    'MetaLeft', 'MetaRight',
  ]);

  const listEl = document.getElementById('list');
  const addBtn = document.getElementById('add');
  const statusEl = document.getElementById('status');
  const saveBtn = document.getElementById('save');
  const strengthEl = document.getElementById('strength');

  let shortcuts = [];
  let captureIndex = -1;
  let dirty = false;
  let strength = 'normal';

  function codeToName(code) {
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (/^F\d+$/.test(code)) return code;
    const map = {
      Space: 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
      Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Escape: 'Esc',
      Minus: '-', Equal: '=',
      Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
      BracketLeft: '[', BracketRight: ']',
      Semicolon: ';', Quote: "'", Backquote: '`',
    };
    return map[code] || code;
  }

  function comboToText(cfg) {
    const mods = [];
    if (cfg.ctrl) mods.push('Ctrl');
    if (cfg.alt) mods.push('Alt');
    if (cfg.shift) mods.push('Shift');
    if (cfg.meta) mods.push('Cmd');
    return mods.join(' + ') + ' + ' + codeToName(cfg.key);
  }

  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = cls || '';
  }

  function render() {
    listEl.innerHTML = '';
    shortcuts.forEach((s, idx) => {
      const row = document.createElement('div');
      row.className = 'row';
      if (captureIndex === idx) row.classList.add('active');

      const cap = document.createElement('div');
      cap.className = 'capture';
      cap.tabIndex = 0;
      cap.textContent = captureIndex === idx ? 'Nhấn tổ hợp phím...' : comboToText(s);
      cap.addEventListener('click', () => startCapture(idx));
      row.appendChild(cap);

      const rem = document.createElement('button');
      rem.className = 'remove';
      rem.title = 'Xoá';
      rem.textContent = '×';
      rem.addEventListener('click', () => removeShortcut(idx));
      row.appendChild(rem);

      listEl.appendChild(row);
    });
  }

  function startCapture(idx) {
    captureIndex = idx;
    setStatus('(Esc để hủy)', '');
    render();
    listEl.children[idx]?.querySelector('.capture')?.focus();
  }

  function stopCapture() {
    captureIndex = -1;
    render();
  }

  function removeShortcut(idx) {
    shortcuts.splice(idx, 1);
    dirty = true;
    saveBtn.disabled = false;
    setStatus('Đã xoá — bấm "Lưu" để áp dụng', '');
    render();
  }

  function addShortcut() {
    shortcuts.push({ ctrl: false, alt: false, shift: false, meta: false, key: '' });
    dirty = true;
    saveBtn.disabled = false;
    render();
    startCapture(shortcuts.length - 1);
    setStatus('Bấm tổ hợp phím (cần ít nhất 1 phím bổ trợ)', '');
  }

  chrome.storage.sync.get(['shortcuts', 'shortcut', 'strength'], (d) => {
    if (Array.isArray(d.shortcuts) && d.shortcuts.length) {
      shortcuts = d.shortcuts.map(normalize);
    } else if (d.shortcut) {
      shortcuts = [{ ...DEFAULT_SHORTCUTS[0], ...d.shortcut }];
      chrome.storage.sync.set({ shortcuts });
    } else {
      shortcuts = DEFAULT_SHORTCUTS.slice();
    }
    strength = ['fast', 'normal', 'strong', 'brutal'].includes(d.strength) ? d.strength : 'normal';
    strengthEl.value = strength;
    render();
    setStatus('Mặc định: Ctrl + Q (trắng) · Alt + Q (đen)', 'ok');
  });

  function normalize(s) {
    return {
      ctrl: !!s.ctrl, alt: !!s.alt, shift: !!s.shift, meta: !!s.meta,
      key: typeof s.key === 'string' ? s.key : 'KeyQ',
    };
  }

  document.addEventListener('keydown', (e) => {
    if (captureIndex < 0) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      stopCapture();
      setStatus('Đã hủy', '');
      return;
    }
    if (MOD_CODES.has(e.code)) {
      setStatus('Bấm thêm 1 phím thường (Q, B, F2, Space...)', 'err');
      return;
    }
    if (!e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
      setStatus('Cần ít nhất 1 phím bổ trợ (Ctrl/Alt/Shift/Cmd)', 'err');
      return;
    }
    shortcuts[captureIndex] = normalize({
      ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey,
      key: e.code,
    });
    dirty = true;
    saveBtn.disabled = false;
    captureIndex = -1;
    render();
    setStatus('Sẽ lưu: ' + comboToText(shortcuts[shortcuts.length - 1]) + ' — bấm "Lưu"', 'ok');
  });

  addBtn.addEventListener('click', addShortcut);

  strengthEl.addEventListener('change', () => {
    if (strengthEl.value === strength) return;
    strength = strengthEl.value;
    dirty = true;
    saveBtn.disabled = false;
    setStatus('Đã đổi độ thông minh — bấm "Lưu"', '');
  });

  saveBtn.addEventListener('click', () => {
    if (!dirty) { saveBtn.disabled = true; return; }
    const clean = shortcuts.filter((s) => s.key);
    if (!clean.length) {
      setStatus('Cần ít nhất 1 phím tắt hợp lệ', 'err');
      return;
    }
    chrome.storage.sync.set({ shortcuts: clean, strength }, () => {
      chrome.storage.sync.remove('shortcut', () => {});
      dirty = false;
      saveBtn.disabled = true;
      shortcuts = clean;
      render();
      const sName = strengthEl.options[strengthEl.selectedIndex].text;
      setStatus('✓ Đã lưu ' + clean.length + ' phím tắt, độ thông minh: ' + sName + '. F5 trang chess.com để áp dụng.', 'ok');
    });
  });
})();