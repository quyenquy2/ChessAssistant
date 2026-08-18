import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const extDir = resolve(__dirname, '..', 'chess-move-hint');

async function probe(label, fn) {
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
  await fn(p);
  await ctx.close();
  console.log('--- end ---');
}

(async () => {
  console.log('=== analysis board start (white to move default) ===');
  await probe('default', async (p) => {
    const data = await p.evaluate(() => {
      return {
        hasMoveList: !!document.querySelector('.move-list'),
        hasMoveListOuter: Array.from(document.querySelectorAll('[class*="move-list"]')).map(e => e.className).slice(0, 3),
        nodesAll: document.querySelectorAll('[class*="node "]').length,
        nodesDataPly: document.querySelectorAll('[data-ply]').length,
        // The actual selector chess.com uses?
        sampleSelectorA: document.querySelector('.move-list-component .node')?.textContent,
        sampleSelectorB: document.querySelector('.game-controls .move-list .node')?.textContent,
        sampleSelectorC: document.querySelector('wc-move-list .node')?.textContent,
        sampleSelectorD: document.querySelector('[data-cy*="move"]')?.textContent,
        bodyClass: document.body.className,
        // location
        url: location.href,
        hash: location.hash,
      };
    });
    console.log(JSON.stringify(data, null, 2));
  });

  console.log('\n=== /analysis?fen=... with black to move ===');
  await probe('fen-url', async (p) => {
    await p.goto('https://www.chess.com/analysis?fen=rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPP1PPP/RNBQKBNR%20b%20KQkq%20-%200%201', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('wc-board, .board');
    await p.waitForFunction(() => document.querySelectorAll('.piece').length > 0);
    await p.waitForTimeout(3500);
    const data = await p.evaluate(() => ({
      url: location.href,
      hash: location.hash,
      pieces: document.querySelectorAll('.piece').length,
      nodesInDOMElements: Array.from(document.querySelectorAll('[data-ply]')).map(e => e.dataset.ply).slice(0, 10),
      nodesBySelector: Array.from(document.querySelectorAll('.move-list .node')).slice(0, 5).map(e => ({ ply: e.dataset.ply, text: e.textContent.trim() })),
      // chess.com global state hints
      globals: Object.keys(window).filter(k => /chess|board|game/i.test(k)).slice(0, 30),
    }));
    console.log(JSON.stringify(data, null, 2));
  });
})().catch(e => { console.error(e); process.exit(1); });
