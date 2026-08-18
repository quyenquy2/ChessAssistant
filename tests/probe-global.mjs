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
  await p.goto('https://www.chess.com/analysis', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('wc-board, .board');
  await p.waitForTimeout(3000);
  let data = await p.evaluate(() => {
    const dump = {};
    function safe(name, fn) { try { dump[name] = fn(); } catch (e) { dump[name] = String(e); } }
    safe('chesscom keys', () => Object.keys(window.chesscom || {}).slice(0, 80));
    safe('window.Config', () => typeof window.Config !== 'undefined' ? Object.keys(window.Config) : null);
    // Sometimes there is a wdl global or game state
    safe('wdl', () => typeof window.wdl);
    safe('chessboard', () => {
      const cb = document.querySelector('wc-board');
      if (!cb) return 'no wc-board';
      return {
        attrs: Array.from(cb.attributes).map(a => a.name + '=' + a.value).slice(0, 20),
        shadowExists: !!cb.shadowRoot,
      };
    });
    safe('innerText of body', () => document.body.innerText.slice(0, 300));
    return dump;
  });
  console.log(JSON.stringify(data, null, 2));
  await ctx.close();
})().catch(e => { console.error(e); process.exit(1); });
