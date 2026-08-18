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
  const fen = 'rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  const url = `https://www.chess.com/analysis?fen=${encodeURIComponent(fen).replace(/%20/g, '+')}`;
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('wc-board, .board');
  await p.waitForFunction(() => document.querySelectorAll('.piece').length > 0);
  await p.waitForTimeout(3500);
  const dump = await p.evaluate(() => {
    const out = {};
    // From page-world: grab all mentions of FEN-shaped text
    const fens = [];
    document.querySelectorAll('*').forEach(el => {
      const t = (el.textContent || '').trim();
      if (/^[rnbqkpRNBQKP1-8]+\/[rnbqkpRNBQKP1-8]+\/[rnbqkpRNBQKP1-8]+\/[rnbqkpRNBQKP1-8]+\/[rnbqkpRNBQKP1-8]+\/[rnbqkpRNBQKP1-8]+\/[rnbqkpRNBQKP1-8]+\/[rnbqkpRNBQKP1-8]+ [wb] [KQkqA-Ha-h-]+ -? .* \d+ \d+$/.test(t) && el.children.length === 0) {
        fens.push(t);
      }
    });
    out.fensInText = fens.slice(0, 3);

    // Look at attributes that might contain position info
    out.wcAttrs = Array.from(document.querySelector('wc-board')?.attributes || []).map(a => `${a.name}="${a.value}"`);
    out.boardAttrs = Array.from(document.querySelector('.board')?.attributes || []).map(a => `${a.name}="${a.value}"`);

    // Try to access window.chesscom via wrappedJSObject proxy
    // (window here is page world; document.documentElement is shared across worlds)
    out.pageChesscomKeys = Object.keys(window.chesscom || {});
    out.pageAnalysisFen = window.chesscom?.analysis?.fen;

    // Cross-world test: write chesscom.analysis.fen into a DOM attribute from page world
    document.documentElement.setAttribute('data-pw-fen', window.chesscom?.analysis?.fen || '');
    return out;
  });
  console.log(JSON.stringify(dump, null, 2));
  // Now read it back from content-script perspective (via page.evaluate which also runs in page world)
  // The point is — does content script see this attribute?
  const sharedAttr = await p.evaluate(() => document.documentElement.getAttribute('data-pw-fen'));
  console.log('Cross-world attr:', sharedAttr);
  await ctx.close();
})().catch(e => { console.error(e); process.exit(1); });
