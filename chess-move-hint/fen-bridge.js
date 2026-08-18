(() => {
  const SEL = 'wc-chess-board, wc-board, .board';
  let last = '';

  const read = () => {
    const b = document.querySelector(SEL);
    if (!b) return;
    let fen = '';
    try {
      if (b.game && typeof b.game.getFEN === 'function') fen = String(b.game.getFEN() || '');
    } catch (e) {}
    if (fen === last) return;
    last = fen;
    b.setAttribute('data-cc-hint-fen', fen);
    window.dispatchEvent(new CustomEvent('cc-hint-fen', { detail: fen }));
  };

  read();
  setInterval(read, 500);
  const b = document.querySelector(SEL);
  if (b) {
    try {
      new MutationObserver(read).observe(b, { subtree: true, childList: true });
    } catch (e) {}
  }
})();
