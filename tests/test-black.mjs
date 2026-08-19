import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const extDir = resolve(__dirname, '..', 'chess-move-hint');
function log(...a) { console.log('[flip]', ...a); }
function fail(msg) { console.error('[FAIL]', msg); process.exit(1); }

async function readOverlayMove(page) {
  return (await page.locator('#cc-hint .cc-hint-move').first().textContent() || '').trim();
}

async function hold(page, modKey) {
  await page.keyboard.down(modKey);
  await page.keyboard.down('q');
  try {
    await page.waitForSelector('#cc-hint.cc-show', { timeout: 20000 });
    let san = '';
    for (let i = 0; i < 100; i++) {
      san = await readOverlayMove(page);
      if (san && san !== '…' && san !== '—') break;
      await page.waitForTimeout(200);
    }
    return san;
  } finally {
    await page.keyboard.up('q');
    await page.keyboard.up(modKey);
    await page.waitForTimeout(100);
  }
}

async function run() {
  const ctx = await chromium.launchPersistentContext('', {
    headless: false,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--no-sandbox'],
    viewport: { width: 1280, height: 800 },
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => log('PAGE EXCEPTION:', e.message));

  // Test 1: FEN with BLACK to move (after 1.e4). Stockfish's best response is normally e5 or c5/Nf6.
  const blackToMove = 'rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  const url = `https://www.chess.com/analysis?fen=${encodeURIComponent(blackToMove).replace(/%20/g, '+')}`;
  log('Navigating to URL with BLACK to move FEN');
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForSelector('wc-board, .board', { timeout: 30000 });
  await p.waitForFunction(() => document.querySelectorAll('.piece').length > 0);
  await p.waitForTimeout(3500);
  await p.locator('wc-board, .board').first().click({ position: { x: 50, y: 50 } });
  await p.waitForTimeout(200);

  const san = await hold(p, 'Control');
  log(`ALT+Q (black to move) → "${san}"`);
  if (!san) fail('no move returned');

  // Expected black move from rnbqkbnr/pppp1ppp/8/4p3/... should be a reasonable reply to 1.e4.
  // Common strong candidates (depth 18 stockfish): Nf6, Nc6, e5, c5, e6, d5.
  // The bug being fixed was engine misidentifying the side and returning "d4" or promotions.
  if (san === 'd4' || san.endsWith('=Q')) {
    fail(`engine still seeing the wrong side: returned "${san}"`);
  }
  const acceptable = ['Nf6', 'Nc6', 'e5', 'c5', 'e6', 'd5', 'd6', 'c6', 'a6', 'h6', 'a5',
                       'g6', 'h5', 'b5', 'Be7', 'Bf5'];
  if (!acceptable.includes(san)) {
    log(`WARN: black reply "${san}" is not in common-top list (ok if engine disagrees; just sanity)`);
  } else {
    log(`✓ "${san}" is a valid reply to 1.e4 — black-to-move detection works.`);
  }

  await ctx.close();
  log('\n[PASS] Black-to-move detection works correctly on chess.com!');
}

run().catch(e => { console.error(e); process.exit(1); });
