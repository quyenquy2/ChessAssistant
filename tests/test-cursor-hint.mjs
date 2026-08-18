import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function log(...a) { console.log('[cursor-test]', ...a); }
function fail(msg) { console.error('[FAIL]', msg); process.exit(1); }

const src = readFileSync(new URL('../chess-move-hint/lib/chess.min.js', import.meta.url), 'utf8');
const sandbox = { exports: {}, module: { exports: {} } };
sandbox.exports = sandbox.module.exports;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const Chess = sandbox.exports.Chess || sandbox.module.exports.Chess;

function sanToFromTo(fen, san) {
  const c = new Chess(fen);
  const mv = c.move(san);
  if (!mv) return null;
  return { from: mv.from, to: mv.to };
}
function sqNum(name) {
  const fileIdx = name.charCodeAt(0) - 97;
  return (fileIdx + 1) * 10 + parseInt(name[1], 10);
}

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

async function hold(p, mods) {
  for (const m of mods) await p.keyboard.down(m);
  await p.keyboard.down('q');
  try {
    await p.waitForSelector('#cc-hint.cc-show', { timeout: 25000 }).catch(() => {});
    let san = '';
    for (let i = 0; i < 60; i++) {
      san = await p.locator('#cc-hint .cc-hint-move').first().textContent({ timeout: 1000 }).catch(() => '') || '';
      san = (san || '').trim();
      if (san && san !== '…' && san !== '—') break;
      await p.waitForTimeout(250);
    }
    return san;
  } finally {
    await p.keyboard.up('q');
    for (const m of mods) await p.keyboard.up(m);
  }
}

async function cursorOf(p, sq) {
  const c = await p.evaluate((n) => {
    const el = document.querySelector('.piece.square-' + n) || document.querySelector('[class*="square-' + n + '"]');
    if (!el) return { found: false };
    return { found: true, cursor: getComputedStyle(el).cursor, cls: el.className };
  }, sq);
  return c;
}

async function hoverSq(p, sq) {
  const el = p.locator('.piece.square-' + sq + ', [class*="square-' + sq + '"]').first();
  if (await el.count()) {
    await el.hover();
    return true;
  }
  return false;
}

async function squareCenter(p, name) {
  const g = await p.evaluate(() => {
    const p11 = document.querySelector('.piece.square-11');
    const p88 = document.querySelector('.piece.square-88');
    if (!p11 || !p88) return null;
    const r1 = p11.getBoundingClientRect();
    const r2 = p88.getBoundingClientRect();
    const cell = Math.abs(r2.left - r1.left) / 7;
    if (!(cell > 0) || !isFinite(cell)) return null;
    return {
      xMin: Math.min(r1.left, r2.left),
      yMin: Math.min(r1.top, r2.top),
      cell,
      flippedX: r1.left > r2.left,
      flippedY: r1.top < r2.top,
    };
  });
  if (!g) return null;
  const col = name.charCodeAt(0) - 97;
  const rank = parseInt(name[1], 10) - 1;
  const colIdx = g.flippedX ? 7 - col : col;
  const rowIdx = g.flippedY ? rank : 7 - rank;
  return { x: g.xMin + (colIdx + 0.5) * g.cell, y: g.yMin + (rowIdx + 0.5) * g.cell };
}

async function boardCursor(p) {
  return p.evaluate(() => {
    const b = document.querySelector('wc-chess-board, wc-board, .board');
    return b ? getComputedStyle(b).cursor : 'no-board';
  });
}

async function run() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const p = await ctx.newPage();
  await p.goto('https://www.chess.com/play/computer', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(6000);
  await closeModals(p);
  const newBtn = p.locator('.selection-menu-newGameButton');
  if (await newBtn.count()) {
    await newBtn.first().click({ timeout: 5000 });
  } else {
    await p.locator('.player-row-wrapper').first().click({ timeout: 10000 });
  }
  await p.waitForTimeout(2500);
  await closeModals(p);
  await p.waitForSelector('wc-chess-board, wc-board, .board', { timeout: 30000 }).catch(() => {});
  await p.waitForFunction(() => document.querySelectorAll('.piece').length > 0, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(2000);

  // wait until it is the user's turn (the AI may move first when the user plays black)
  // and the position is stable (the AI must not move mid-test)
  const userTurn = () => p.evaluate(() => {
    const cb = document.querySelector('wc-chess-board, wc-board, .board');
    if (!cb) return false;
    const fen = cb.getAttribute('data-cc-hint-fen') || '';
    const turn = fen.split(' ')[1];
    if (turn !== 'b' && turn !== 'w') return false;
    const flipped = cb.classList.contains('flipped');
    return flipped ? turn === 'b' : turn === 'w';
  });
  let stable = false;
  for (let i = 0; i < 30; i++) {
    if (await userTurn()) {
      await p.waitForTimeout(2000);
      if (await userTurn()) { stable = true; break; }
    }
    await p.waitForTimeout(1000);
  }
  if (!stable) fail('never reached a stable user turn');
  await p.waitForTimeout(1500);

  const fen = await p.evaluate(() => {
    const cb = document.querySelector('wc-chess-board, wc-board, .board');
    return cb.getAttribute('data-cc-hint-fen') || '';
  });
  log('board fen:', fen);

  const san = await hold(p, ['Alt']);
  log('best move:', san);
  if (!san || san === '…' || san === '—') fail('no best move');
  const ft = sanToFromTo(fen, san);
  if (!ft) fail('cannot parse move ' + san);
  log('from/to:', ft.from, ft.to);

  // hover the from-square piece → expect default (arrow) cursor
  await hoverSq(p, sqNum(ft.from));
  await p.waitForTimeout(300);
  let c = await cursorOf(p, sqNum(ft.from));
  log(`hover from (${ft.from}):`, JSON.stringify(c));
  if (!c.found || c.cursor !== 'default') fail(`from-square cursor should be default, got ${JSON.stringify(c)}`);

  // hover the to-square → arrow cursor if occupied (capture), hand on board if empty
  const toHasPiece = await p.locator('.piece.square-' + sqNum(ft.to)).count();
  if (toHasPiece) {
    await hoverSq(p, sqNum(ft.to));
    await p.waitForTimeout(300);
    c = await cursorOf(p, sqNum(ft.to));
    log(`hover to (${ft.to}, capture piece):`, JSON.stringify(c));
    if (!c.found || c.cursor !== 'default') fail(`capture to-square cursor should be default, got ${JSON.stringify(c)}`);
  } else {
    const toCenter = await squareCenter(p, ft.to);
    log('to-square center:', JSON.stringify(toCenter));
    if (!toCenter) fail('cannot calibrate board');
    await p.mouse.move(toCenter.x, toCenter.y);
    await p.waitForTimeout(400);
    let bc = await boardCursor(p);
    log(`hover to (${ft.to}, empty via coords): board cursor = ${bc}`);
    if (bc !== 'grab') fail(`to-square should show hand on board, got "${bc}"`);

    // sensitivity: hover near the bottom-right edge of the to-square → still hand
    const g2 = await p.evaluate(() => {
      const p11 = document.querySelector('.piece.square-11');
      const p88 = document.querySelector('.piece.square-88');
      const r1 = p11.getBoundingClientRect();
      const r2 = p88.getBoundingClientRect();
      const cell = Math.abs(r2.left - r1.left) / 7;
      return { xMin: Math.min(r1.left, r2.left), yMin: Math.min(r1.top, r2.top), cell };
    });
    const edgeX = toCenter.x + 0.3 * g2.cell;
    const edgeY = toCenter.y + 0.3 * g2.cell;
    await p.mouse.move(edgeX, edgeY);
    await p.waitForTimeout(400);
    bc = await boardCursor(p);
    log(`hover to near bottom-right edge (${ft.to}): board cursor = ${bc}`);
    if (bc !== 'grab') fail(`to-square should be sensitive across the whole square, got "${bc}"`);
  }

  // move mouse to a genuinely empty square (no piece, not the to-square) → expect arrow
  const candidates = ['e5', 'd5', 'c5', 'f5', 'g5', 'd3', 'c3', 'f3'];
  let otherEmpty = null;
  for (const s of candidates) {
    if (s === ft.to) continue;
    const n = sqNum(s);
    const hasPiece = await p.evaluate((nn) => {
      const el = document.querySelector('.piece.square-' + nn) || document.querySelector('[class*="square-' + nn + '"]');
      return !!el;
    }, n);
    if (!hasPiece) { otherEmpty = s; break; }
  }
  if (!otherEmpty) fail('no empty square candidate');
  const oc = await squareCenter(p, otherEmpty);
  await p.mouse.move(oc.x, oc.y);
  await p.waitForTimeout(400);
  let bc = await boardCursor(p);
  log(`hover other empty (${otherEmpty}): board cursor = ${bc}`);
  if (bc !== 'auto' && bc !== 'default') fail(`other empty square should keep arrow, got "${bc}"`);

  // hover a non-hint piece → expect natural hand cursor (not default)
  const other = ft.from === 'a1' ? 'b1' : 'a1';
  await hoverSq(p, sqNum(other));
  await p.waitForTimeout(300);
  c = await cursorOf(p, sqNum(other));
  log(`hover other (${other}):`, JSON.stringify(c));
  if (!c.found || c.cursor === 'default') fail(`other square should keep hand cursor, got ${JSON.stringify(c)}`);

  log('PASS: cursor hint works');
  await p.close();
  await browser.close();
}

run().catch(e => { console.error(e); process.exit(1); });