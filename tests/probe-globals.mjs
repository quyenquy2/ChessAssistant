import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const extDir = resolve(__dirname, '..', 'chess-move-hint');

(async () => {
  const ctx = await chromium.launchPersistentContext('', {
    headless: false,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--no-sandbox'],
    viewport: { width: 1280, height: 800 },
  });
  const p = await ctx.newPage();

  // Load FEN-via-URL so we have a non-starting position with black to move.
  const fen = 'rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  const encoded = fen.replace(/ /g, '+');
  const url = `https://www.chess.com/analysis?fen=${encodeURIComponent(encoded)}`;
  console.log('URL:', url);
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('wc-board, .board', { timeout: 30000 });
  await p.waitForFunction(() => document.querySelectorAll('.piece').length > 0);
  await p.waitForTimeout(3500);

  const data = await p.evaluate(() => {
    const out = {};
    function safe(name, fn) { try { out[name] = fn(); } catch (e) { out[name] = String(e); } }
    safe('chesscom.analysis', () => {
      const a = window.chesscom && window.chesscom.analysis;
      if (!a) return null;
      const keys = Object.keys(a);
      return { keys, hasFen: typeof a.fen, turn: typeof a.turn, position: typeof a.position };
    });
    safe('chesscom object', () => Object.keys(window.chesscom || {}));
    // Look for an object with .fen() OR .turn()
    safe('possible game obj', () => {
      for (const k of Object.keys(window)) {
        try {
          const v = window[k];
          if (v && typeof v === 'object' && typeof v.fen === 'function') return k;
        } catch {}
      }
      return null;
    });
    // wc-board attributes
    safe('wc-board attrs', () => Array.from(document.querySelector('wc-board').attributes).map(a => a.name + '=' + a.value));
    return out;
  });
  console.log(JSON.stringify(data, null, 2));
  await ctx.close();
})().catch(e => { console.error(e); process.exit(1); });
