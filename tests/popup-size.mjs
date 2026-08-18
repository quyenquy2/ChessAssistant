import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const extDir = resolve(__dirname, '..', 'chess-move-hint');
const optPath = 'file:///' + resolve(extDir, 'options.html').replace(/\\/g, '/');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 200, height: 350 } });
  const p = await ctx.newPage();
  await p.goto(optPath);
  await p.waitForSelector('body');
  await p.waitForTimeout(800);
  const size = await p.evaluate(() => {
    const b = document.body;
    return { w: b.scrollWidth, h: b.scrollHeight, ow: b.offsetWidth, oh: b.offsetHeight };
  });
  console.log('Body size:', JSON.stringify(size));
  await p.screenshot({ path: 'popup-preview.png', fullPage: true });
  console.log('Screenshot saved: popup-preview.png');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });