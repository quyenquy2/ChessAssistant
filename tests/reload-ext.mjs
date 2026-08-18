import { chromium } from 'playwright';

async function run() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const p = await ctx.newPage();
  await p.goto('chrome://extensions', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);

  const extId = 'oijmakdnlkmpbkicdnbffphgkhbmbpog';
  const found = await p.evaluate((id) => {
    const mgr = document.querySelector('extensions-manager');
    if (!mgr || !mgr.shadowRoot) return { err: 'no manager' };
    const list = mgr.shadowRoot.querySelector('extensions-item-list');
    if (!list || !list.shadowRoot) return { err: 'no item list' };
    const it = Array.from(list.shadowRoot.querySelectorAll('extensions-item')).find(i => i.getAttribute('id') === id);
    if (!it || !it.shadowRoot) return { err: 'item not found', ids: Array.from(list.shadowRoot.querySelectorAll('extensions-item')).map(i => i.getAttribute('id')) };
    const btns = Array.from(it.shadowRoot.querySelectorAll('button')).map(b => b.id + '|' + (b.textContent || '').trim().slice(0, 30) + '|' + (b.getAttribute('aria-label') || ''));
    return { found: true, buttons: btns, html: it.shadowRoot.innerHTML.slice(0, 800) };
  }, extId);
  console.log(JSON.stringify(found, null, 2));

  if (found.found) {
    const clicked = await p.evaluate((id) => {
      const mgr = document.querySelector('extensions-manager');
      const list = mgr.shadowRoot.querySelector('extensions-item-list');
      const it = Array.from(list.shadowRoot.querySelectorAll('extensions-item')).find(i => i.getAttribute('id') === id);
      const sr = it.shadowRoot;
      const btn = sr.querySelector('#reloadButton') || sr.querySelector('[id*="reload" i]') || Array.from(sr.querySelectorAll('button')).find(b => (b.getAttribute('aria-label') || b.textContent || '').match(/reload/i));
      if (!btn) return 'no reload button';
      btn.click();
      return 'clicked ' + (btn.id || btn.getAttribute('aria-label') || '?');
    }, extId);
    console.log('RELOAD:', clicked);
  }

  await p.waitForTimeout(1500);
  await p.close();
  await browser.close();
}

run().catch(e => { console.error(e); process.exit(1); });