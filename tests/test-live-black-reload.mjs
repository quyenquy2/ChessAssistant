import { chromium } from 'playwright';

function log(...a) { console.log('[reload-test]', ...a); }
function fail(msg) { console.error('[FAIL]', msg); process.exit(1); }

async function closeModals(p) {
  for (let i = 0; i < 4; i++) {
    const open = await p.locator('dialog[open], .cc-modal-component-v2[open], [role="dialog"][open]').count().catch(() => 0);
    if (!open) return;
    try {
      const closeBtn = p.locator('dialog[open] .cc-modal-close, dialog[open] button[aria-label*="Close" i], dialog[open] [class*="close"]').first();
      if (await closeBtn.count()) { await closeBtn.click({ timeout: 1500 }); }
      else { await p.keyboard.press('Escape'); }
    } catch {}
    await p.waitForTimeout(700);
  }
}

async function getFen(p) {
  return p.evaluate(() => {
    const boards = Array.from(document.querySelectorAll('wc-chess-board, wc-board, .board'));
    return {
      count: boards.length,
      fens: boards.map(b => {
        try { return b.game ? b.game.getFEN() : 'no-game'; } catch (e) { return 'err'; }
      }),
      pieces: document.querySelectorAll('.piece').length,
    };
  });
}

async function hold(p, mods) {
  for (const m of mods) await p.keyboard.down(m);
  await p.keyboard.down('q');
  try {
    await p.waitForSelector('#cc-hint.cc-show', { timeout: 8000 }).catch(() => {});
    let san = '';
    for (let i = 0; i < 30; i++) {
      san = await p.locator('#cc-hint .cc-hint-move').first().textContent({ timeout: 1000 }).catch(() => '') || '';
      san = (san || '').trim();
      if (san && san !== '…' && san !== '—') break;
      await p.waitForTimeout(200);
    }
    return san;
  } finally {
    await p.keyboard.up('q');
    for (const m of mods) await p.keyboard.up(m);
  }
}

async function run() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const p = await ctx.newPage();

  // Phase 1: fresh game, play 1.e4
  await p.goto('https://www.chess.com/play/computer', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(6000);
  await closeModals(p);
  await p.locator('.player-row-wrapper').first().click({ timeout: 10000 });
  await p.waitForTimeout(2500);
  await closeModals(p);
  await p.waitForSelector('wc-chess-board, wc-board, .board', { timeout: 30000 }).catch(() => {});
  await p.waitForFunction(() => document.querySelectorAll('.piece').length > 0, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(2000);
  log('phase1 start:', JSON.stringify(await getFen(p)));

  await p.evaluate(() => document.querySelector('wc-chess-board, wc-board, .board').game.move('e4'));
  await p.waitForTimeout(2000);
  log('phase1 after e4:', JSON.stringify(await getFen(p)));

  // Phase 2: RELOAD the page while it's black's turn (simulates joining mid-game)
  log('--- reloading page (black to move) ---');
  await p.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(8000);
  await closeModals(p);
  log('phase2 boards:', JSON.stringify(await getFen(p)));

  const san = await hold(p, ['Control']);
  log(`hint after reload (black to move) → "${san}"`);

  const fen = await getFen(p);
  const turn = fen.fens[0] && fen.fens[0].split(' ')[1];
  log('turn now:', turn);
  if (turn !== 'b') fail('setup broken: not black to move');
  if (!san) fail('no hint');
  if (san === 'd4' || san.endsWith('=Q')) fail(`wrong side: "${san}"`);
  log(san === 'Nf3' ? 'REPRODUCED BUG: suggested white move Nf3' : 'OK: black move suggested');
  if (san === 'Nf3') process.exitCode = 2;

  await p.close();
  await browser.close();
}

run().catch(e => { console.error(e); process.exit(1); });