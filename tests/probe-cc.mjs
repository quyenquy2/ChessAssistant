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
  const blackToMove = 'rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  const url = `https://www.chess.com/analysis?fen=${encodeURIComponent(blackToMove).replace(/%20/g, '+')}`;
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForSelector('wc-board, .board', { timeout: 30000 });
  await p.waitForFunction(() => document.querySelectorAll('.piece').length > 0);

  // Sample a few times to see when chesscom.analysis.fen stabilises
  for (const t of [500, 1500, 3000, 5000]) {
    await p.waitForTimeout(t === 500 ? 500 : t - 500);
    const data = await p.evaluate(() => ({
      analysisFen: window.chesscom?.analysis?.fen,
      url: location.href,
      piecesCount: document.querySelectorAll('.piece').length,
    }));
    console.log('t+' + t + 'ms:', JSON.stringify(data));
  }
  await ctx.close();
})().catch(e => { console.error(e); process.exit(1); });
