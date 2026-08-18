import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const extDir = resolve(__dirname, '..', 'chess-move-hint');

async function probe(extra = '') {
  const ctx = await chromium.launchPersistentContext('', {
    headless: false,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--no-sandbox'],
    viewport: { width: 1280, height: 800 },
  });
  const p = await ctx.newPage();
  await p.goto('https://www.chess.com/analysis', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForSelector('wc-board, .board');
  await p.waitForFunction(() => document.querySelectorAll('.piece').length > 0);
  await p.waitForTimeout(2500);
  if (extra === 'fen') {
    const fb = p.getByRole('button', { name: /FEN/i }).first();
    await fb.click({ timeout: 3000 });
    await p.waitForTimeout(400);
    const ta = p.locator('textarea').last();
    await ta.waitFor();
    await ta.fill('rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    await p.waitForTimeout(200);
    const lb = p.getByRole('button', { name: /^Load/i }).first();
    await lb.click();
    await p.waitForTimeout(2500);
    await p.locator('wc-board, .board').first().click({ position: { x: 50, y: 50 } });
  }
  const data = await p.evaluate(() => {
    const out = { turn: {} };
    out.moveListNodes = document.querySelectorAll('.move-list .node').length;
    out.moveListHighlightText = document.querySelector('.move-list .node-highlight')?.textContent;
    // Try various "to move" indicators chess.com uses.
    const candidates = [
      '[data-cy="to-move"]',
      '.clock-active-white', '.clock-active-black',
      '.turn-indicator', '.turn',
      '.board-tab-counter',
      '[class*="to-move"]',
      '[class*="active-color"]',
      '[class*="player-turn"]',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) {
        out.turn[sel] = { class: el.className, text: (el.textContent || '').slice(0, 60).trim() };
      }
    }
    // Search any text containing " to move"
    const allEls = Array.from(document.querySelectorAll('*'));
    for (const el of allEls) {
      const t = (el.textContent || '').trim();
      if (/^(White|Black) to move$/i.test(t) && el.children.length === 0) {
        out.turn['text-match-' + (out.turn._textMatches||0)] = t;
        out.turn._textMatches = (out.turn._textMatches || 0) + 1;
      }
    }
    // Check clocks
    const clockPlayerWhite = document.querySelector('.clock-component .player-clock-white, [data-cy="clock-white"], .clock-bottom.white');
    const clockPlayerBlack = document.querySelector('.clock-component .player-clock-black, [data-cy="clock-black"], .clock-top.black');
    out.clockWhiteClass = clockPlayerWhite?.className;
    out.clockBlackClass = clockPlayerBlack?.className;
    return out;
  });
  console.log(JSON.stringify(data, null, 2));
  await ctx.close();
}

(async () => {
  console.log('=== default start (analysis) ===');
  await probe();
  console.log('\n=== after loading "black to move" FEN ===');
  await probe('fen');
})().catch(e => { console.error(e); process.exit(1); });
