import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function log(...a) { console.log('[capture-test]', ...a); }
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

// white knight f3 can take black knight e5 — capture is clearly the best move
const FEN = 'rnbqkbnr/pppppppp/8/4n3/8/5N2/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

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
    const el = document.querySelector('.piece.square-' + n);
    if (!el) return { found: false };
    return { found: true, cursor: getComputedStyle(el).cursor, cls: el.className };
  }, sq);
  return c;
}

async function run() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const p = await ctx.newPage();
  const fenEnc = encodeURIComponent(FEN).replace(/%20/g, '+');
  await p.goto('https://www.chess.com/analysis?tab=analysis&fen=' + fenEnc, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(7000);

  const fen = await p.evaluate(() => {
    const cb = document.querySelector('wc-chess-board, wc-board, .board');
    return cb.getAttribute('data-cc-hint-fen') || '';
  });
  log('board fen:', fen);
  if (!fen.startsWith('rnbqkbnr/pppppppp/8/4n3')) fail('FEN did not load');

  const san = await hold(p, ['Control']);
  log('best move:', san);
  if (!san || san === '…' || san === '—') fail('no best move');
  if (!san.includes('x')) fail('expected a capture move, got ' + san);
  const ft = sanToFromTo(FEN, san);
  if (!ft) fail('cannot parse move ' + san);
  log('from/to:', ft.from, ft.to, '=> capture');

  // hover the from-square piece → default (arrow)
  await p.hover('.piece.square-' + sqNum(ft.from));
  await p.waitForTimeout(300);
  let c = await cursorOf(p, sqNum(ft.from));
  log('hover from (' + ft.from + '):', JSON.stringify(c));
  if (!c.found || c.cursor !== 'default') fail('from-square should be default, got ' + JSON.stringify(c));

  // hover the to-square (occupied — capture) → default (arrow), NOT the natural hand
  await p.hover('.piece.square-' + sqNum(ft.to));
  await p.waitForTimeout(300);
  c = await cursorOf(p, sqNum(ft.to));
  log('hover to (' + ft.to + ', capture):', JSON.stringify(c));
  if (!c.found || c.cursor !== 'default') fail('capture to-square should be default (arrow), got ' + JSON.stringify(c));

  // hover another piece → natural hand
  const other = ft.from === 'a1' ? 'b1' : 'a1';
  await p.hover('.piece.square-' + sqNum(other));
  await p.waitForTimeout(300);
  c = await cursorOf(p, sqNum(other));
  log('hover other (' + other + '):', JSON.stringify(c));
  if (!c.found || c.cursor === 'default') fail('other piece should keep hand, got ' + JSON.stringify(c));

  log('PASS: capture to-square keeps arrow cursor');
  await p.close();
  await browser.close();
}

run().catch((e) => { console.error(e); process.exit(1); });