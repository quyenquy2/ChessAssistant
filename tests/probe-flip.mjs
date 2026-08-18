import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const extDir = resolve(__dirname, '..', 'chess-move-hint');

function log(...args) { console.log('[probe]', ...args); }

async function readOverlayMove(page) {
  return (await page.locator('#cc-hint .cc-hint-move').first().textContent() || '').trim();
}

async function loadFen(page, fen) {
  const fenButton = page.getByRole('button', { name: /FEN/i }).first();
  try { await fenButton.click({ timeout: 3000 }); } catch {}
  await page.waitForTimeout(400);
  const ta = page.locator('textarea').last();
  await ta.waitFor({ timeout: 5000 });
  await ta.fill(fen);
  await page.waitForTimeout(200);
  const loadBtn = page.getByRole('button', { name: /^Load/i }).first();
  if (await loadBtn.count()) {
    await loadBtn.click();
  } else {
    await ta.press('Enter');
  }
  await page.waitForTimeout(2500);
  // Re-focus the board after dialog interactions.
  await page.locator('wc-board, .board').first().click({ position: { x: 50, y: 50 } });
  await page.waitForTimeout(200);
}

async function holdAndRead(page, modKey) {
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
  }
}

async function dump(page, label) {
  const d = await page.evaluate(() => ({
    pieces: document.querySelectorAll('.piece').length,
    boardClass: document.querySelector('wc-board')?.className || document.querySelector('.board')?.className,
    moveListNodes: document.querySelectorAll('.move-list .node').length,
    moveListHighlight: !!document.querySelector('.move-list .node-highlight'),
    moveListFirst: document.querySelector('.move-list .node')?.textContent,
    cc: Object.fromEntries(Array.from(document.documentElement.attributes).filter(a => a.name.startsWith('data-cc-')).map(a => [a.name, a.value.slice(0, 80)])),
  }));
  log(label, JSON.stringify(d, null, 2));
}

async function run() {
  const ctx = await chromium.launchPersistentContext('', {
    headless: false,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--no-sandbox'],
    viewport: { width: 1280, height: 800 },
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => log('PAGE EXCEPTION:', e.message));

  await p.goto('https://www.chess.com/analysis', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForSelector('wc-board, .board', { timeout: 30000 });
  await p.waitForFunction(() => document.querySelectorAll('.piece').length > 0);
  await p.waitForTimeout(1500);

  // ----- Case A: white to move, standard start -----
  log('\n--- A) white-to-move start ---');
  await p.locator('wc-board, .board').first().click({ position: { x: 50, y: 50 } });
  await p.waitForTimeout(200);
  const sanA = await holdAndRead(p, 'Control');
  log('Ctrl+Q ->', JSON.stringify(sanA));

  // ----- Case B: black to move -----
  log('\n--- B) black-to-move FEN (after 1.e4) ---');
  await loadFen(p, 'rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
  await dump(p, 'after load FEN:');
  const sanB = await holdAndRead(p, 'Alt');
  log('Alt+Q ->', JSON.stringify(sanB));
  await p.waitForTimeout(300);

  // ----- Case C: a known tactical position, mate in 2 for white (queen sac) -----
  // Standard FEN: white just played, mate exists.
  log('\n--- C) Queen-sacrifice position (rook lift) ---');
  // A position where Re1-O-O and Qh5 mate in 1 - test idea: simple Bishop mate.
  // Use a simple known good position: 1k6/8/8/8/8/8/8/K7 w - - 0 1 (mate in 1: O-O-O? actually mate in 1: Nd3? Not really. Use the simplest: '8/8/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' start but FLIPPED literally means the board view is upside-down.)
  // Simplest meaningful: black to move having 1 legal move only.
  await loadFen(p, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  await dump(p, 'reset FEN:');
  const sanC = await holdAndRead(p, 'Control');
  log('Ctrl+Q ->', JSON.stringify(sanC));

  await ctx.close();
}

run().catch((e) => { console.error(e); process.exit(1); });
