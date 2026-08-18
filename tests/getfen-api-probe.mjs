import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const extDir = resolve(__dirname, '..', 'chess-move-hint');

async function run() {
  const ctx = await chromium.launchPersistentContext('', {
    headless: false,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--no-sandbox'],
    viewport: { width: 1280, height: 800 },
  });
  const p = await ctx.newPage();
  await p.goto('https://www.chess.com/analysis', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForSelector('wc-board, .board', { timeout: 30000 });
  await p.waitForFunction(() => document.querySelectorAll('.piece').length > 0);
  await p.waitForTimeout(2500);

  const data = await p.evaluate(() => {
    const out = {};
    const cb = document.querySelector('wc-board, .board');
    out.tag = cb.tagName;
    const own = Object.getOwnPropertyNames(cb);
    out.ownProps = own.slice(0, 80);
    out.hasGame = !!cb.game;
    out.gameKeys = cb.game ? Object.keys(cb.game).slice(0, 60) : null;
    if (cb.game) {
      out.gameOwnProps = Object.getOwnPropertyNames(cb.game).slice(0, 80);
      try { out.fenFromGame = typeof cb.game.getFEN === 'function' ? cb.game.getFEN() : 'no getFEN'; } catch (e) { out.fenFromGame = 'err: ' + e.message; }
    }
    return out;
  });
  console.log(JSON.stringify(data, null, 2));
  await ctx.close();
}

run().catch(e => { console.error(e); process.exit(1); });