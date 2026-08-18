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
  p.on('pageerror', (e) => console.log('PAGE EXCEPTION:', e.message));
  await p.goto('https://www.chess.com/play/computer', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('wc-board, .board', { timeout: 30000 });
  await p.waitForFunction(() => document.querySelectorAll('.piece').length > 0);
  await p.waitForTimeout(4000);

  // Take any consent / start dialog if shown
  const startBtn = p.getByRole('button', { name: /^(start|play|cho\xc3\xadm|bat dau)/i }).first();
  if (await startBtn.count()) { try { await startBtn.click({ timeout: 1500 }); } catch {} }
  await p.waitForTimeout(2000);

  const data = await p.evaluate(() => {
    const out = {};
    out.moveListNodes = document.querySelectorAll('.move-list .node').length;
    out.firstMoveText = document.querySelector('.move-list .node')?.textContent;
    out.bodyText = document.body.innerText.slice(0, 600);
    return out;
  });
  console.log(JSON.stringify(data, null, 2));

  // Try to use our extension here (no specific test on /play; just check it loaded).
  await p.waitForTimeout(2000);
  await ctx.close();
})().catch(e => { console.error(e); process.exit(1); });
