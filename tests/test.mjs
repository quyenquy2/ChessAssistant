import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const extDir = resolve(__dirname, '..', 'chess-move-hint');

function log(...args) { console.log('[test]', ...args); }
function fail(msg) { console.error('[FAIL]', msg); process.exit(1); }

async function waitForOverlay(page, visible, timeoutMs = 25000) {
  const sel = '#cc-hint';
  if (visible) {
    await page.waitForSelector(sel + '.cc-show', { timeout: timeoutMs });
  } else {
    await page.waitForSelector(sel + ':not(.cc-show)', { timeout: timeoutMs });
  }
}

async function readOverlayMove(page) {
  return (await page.locator('#cc-hint .cc-hint-move').first().textContent() || '').trim();
}

async function holdAndGetSAN(page, modKey, modName, expectedDesc) {
  log(`Holding ${modName} + Q (${expectedDesc})...`);
  await page.keyboard.down(modKey);
  await page.keyboard.down('q');
  try {
    await waitForOverlay(page, true, 20000);
    let san = '';
    const start = Date.now();
    for (let i = 0; i < 120; i++) {
      san = await readOverlayMove(page);
      if (san && san !== '…' && san !== '—') break;
      await page.waitForTimeout(200);
    }
    const elapsed = Date.now() - start;
    log(`  SAN after ${elapsed}ms: "${san}"`);
    if (!san || san === '…' || san === '—') {
      fail(`${expectedDesc}: move did not resolve (got "${san}")`);
    }
    return san;
  } finally {
    await page.keyboard.up('q');
    await page.keyboard.up(modKey);
  }
}

async function expectHidden(page) {
  await waitForOverlay(page, false, 5000);
  log('  Overlay hidden.');
}

async function run() {
  log('Extension dir:', extDir);
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
      '--no-sandbox',
    ],
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();
  page.on('pageerror', (err) => log('PAGE EXCEPTION:', err.message));

  log('Navigating to chess.com/analysis ...');
  await page.goto('https://www.chess.com/analysis', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('wc-board, .board', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('.piece').length > 0, null, { timeout: 30000 });
  log('Board found.');

  await page.waitForTimeout(1200);
  await page.locator('wc-board, .board').first().click({ position: { x: 50, y: 50 } });
  await page.waitForTimeout(150);

  log('\n=== Test 1: start position (white to move) ===');
  const sanStart = await holdAndGetSAN(page, 'Control', 'Ctrl', 'start position (white to move)');
  if (!/^[KQRBN]?[a-h]?[1-8]?[a-h][1-8][+#=O-]*$/i.test(sanStart)) fail('SAN has weird shape: ' + sanStart);
  await expectHidden(page);

  log('\n=== Test 2: cache re-hold with Ctrl+Q ===');
  const sanAgain = await holdAndGetSAN(page, 'Control', 'Ctrl', 'cache re-hold (Ctrl+Q)');
  if (sanAgain !== sanStart) fail(`cached move differs: ${sanStart} -> ${sanAgain}`);
  await expectHidden(page);

  log('\n=== Test 3: Alt+Q second shortcut (white to move) ===');
  const sanAlt = await holdAndGetSAN(page, 'Alt', 'Alt', 'second shortcut (Alt+Q)');
  await expectHidden(page);

  log('\n[PASS] Both Ctrl+Q and Alt+Q trigger the hint correctly.');
  await context.close();
}

run().catch((e) => { console.error(e); process.exit(1); });
