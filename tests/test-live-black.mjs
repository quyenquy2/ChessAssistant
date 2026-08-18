import { chromium } from 'playwright';

function log(...a) { console.log('[live-black]', ...a); }
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
    const cb = document.querySelector('wc-chess-board, wc-board, .board');
    try { return cb && cb.game ? cb.game.getFEN() : 'no-game'; } catch (e) { return 'err'; }
  });
}

async function hold(p, mods) {
  for (const m of mods) await p.keyboard.down(m);
  await p.keyboard.down('q');
  try {
    await p.waitForSelector('#cc-hint.cc-show', { timeout: 8000 }).catch(() => {});
    let san = '';
    for (let i = 0; i < 25; i++) {
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
  await p.goto('https://www.chess.com/play/computer', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(6000);
  await closeModals(p);
  await p.locator('.player-row-wrapper').first().click({ timeout: 10000 });
  await p.waitForTimeout(2500);
  await closeModals(p);
  await p.waitForSelector('wc-chess-board, wc-board, .board', { timeout: 30000 }).catch(() => {});
  await p.waitForFunction(() => document.querySelectorAll('.piece').length > 0, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(2000);

  log('start fen:', await getFen(p));

  const mv = await p.evaluate(() => {
    const cb = document.querySelector('wc-chess-board, wc-board, .board');
    if (!cb || !cb.game || typeof cb.game.move !== 'function') return 'no move API';
    try { cb.game.move('e4'); return 'ok'; } catch (e) { return 'err: ' + e.message; }
  });
  log('game.move e4 →', mv);
  await p.waitForTimeout(2000);
  const fen = await getFen(p);
  log('fen after e4:', fen);
  if (fen.split(' ')[1] !== 'b') fail('position is not black-to-move');

  const san = await hold(p, ['Alt']);
  log(`hint (black to move) → "${san}"`);
  if (!san) fail('no hint returned');
  if (san === 'd4' || san.endsWith('=Q')) fail(`engine saw the wrong side: "${san}"`);
  log('PASS: hint is a black move on the live game page');

  await p.close();
  await browser.close();
}

run().catch(e => { console.error(e); process.exit(1); });