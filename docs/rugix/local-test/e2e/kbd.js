const { chromium } = require('playwright-core');
const OUT = (process.env.OUT_DIR || require('os').tmpdir()) + '/';
const DASH = process.env.DASHBOARD_URL || 'http://localhost:8080/dashboards/<dashboard-id>';
(async () => {
  const tok = await (await fetch('http://localhost:8080/api/auth/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'tenant@thingsboard.org',password:'tenant'})})).json();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-US' });
  await ctx.addInitScript(([t, r]) => {
    localStorage.setItem('jwt_token', t); localStorage.setItem('refresh_token', r);
    localStorage.setItem('jwt_token_expiration', String(Date.now() + 9e5)); localStorage.setItem('refresh_token_expiration', String(Date.now() + 9e6));
  }, [tok.token, tok.refreshToken]);
  const page = await ctx.newPage();
  await page.goto(DASH);
  await page.waitForSelector('tb-rugix-agents .view-tab', { timeout: 60000 });
  await page.waitForTimeout(3000);
  const desc = () => page.evaluate(() => {
    const e = document.activeElement; if (!e || e === document.body) return null;
    const cs = getComputedStyle(e);
    const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
    return { el: e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : ''), name: (e.getAttribute('aria-label') || (e.closest('mat-checkbox') && e.closest('mat-checkbox').innerText) || e.innerText || e.getAttribute('placeholder') || '').trim().slice(0, 30).replace(/\n/g, ' '), ring, inDialog: !!e.closest('.cdk-overlay-container') };
  });
  const log = (l, v) => console.log(l.padEnd(34), typeof v === 'string' ? v : JSON.stringify(v));
  // 1. focus order inside widget
  await page.evaluate(() => document.querySelector('tb-rugix-agents .view-tab').focus());
  const noRing = [];
  const inWidget = () => page.evaluate(() => !!document.activeElement?.closest('tb-rugix-agents'));
  for (let i = 0; i < 40; i++) {
    const d = await desc(); if (d && await inWidget() && !d.ring && !noRing.find(x => x.el === d.el && x.name === d.name)) noRing.push(d);
    await page.keyboard.press('Tab');
  }
  log('focus stops w/o visible ring (40 tabs)', noRing.map(d => `${d.el}[${d.name}]`));
  // 2. open view via keyboard: Devices tab, Enter
  await page.evaluate(() => [...document.querySelectorAll('tb-rugix-agents .view-tab')].find(x => x.innerText.includes('Devices')).focus());
  await page.keyboard.press('Enter'); await page.waitForTimeout(1200);
  log('Devices view active', await page.evaluate(() => document.querySelector('tb-rugix-agents .view-tab[aria-current=page]')?.innerText.trim()));
  // 3. row open with Space, close with Escape
  await page.evaluate(() => document.querySelector('tb-rugix-agents .main-table tbody tr').focus());
  await page.keyboard.press('Space'); await page.waitForTimeout(1500);
  log('Space opens details', await page.evaluate(() => !!document.querySelector('.rugix-details')));
  await page.keyboard.press('Escape'); await page.waitForTimeout(800);
  log('Escape closes details', await page.evaluate(() => !document.querySelector('.rugix-details')));
  // 4. dialog focus: open via keyboard, check focus lands inside, tab trap, escape returns focus
  await page.evaluate(() => document.querySelector('tb-rugix-agents .main-table tbody tr').click()); await page.waitForTimeout(1500);
  await page.evaluate(() => [...document.querySelectorAll('.details-buttons button')].find(x => x.innerText.includes('Factory')).focus());
  const before = await desc();
  await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
  const inD = await desc(); log('dialog open: focus inside', inD);
  let leaked = false; const seq = [];
  for (let i = 0; i < 14; i++) { await page.keyboard.press('Tab'); const d = await desc(); seq.push(d && d.name); if (!d || !d.inDialog) leaked = true; }
  log('tab trap in dialog (14 tabs)', leaked ? 'FOCUS LEFT DIALOG' : 'ok');
  log('focus order', seq.slice(0, 8));
  await page.keyboard.press('Escape'); await page.waitForTimeout(800);
  const after = await desc();
  log('focus returns to opener', { before: before && before.name, after: after && after.name });
  log('dbg', await page.evaluate(() => ({ active: document.activeElement && document.activeElement.tagName, btns: document.querySelectorAll('.details-buttons button').length, dialogs: document.querySelectorAll('mat-dialog-container').length })));
  // 5. keyboard-only confirm in reboot dialog: ack with Space, confirm enabled
  await page.evaluate(() => [...document.querySelectorAll('.details-buttons button')].find(x => x.innerText.trim().endsWith('Reboot')).focus());
  await page.keyboard.press('Enter'); await page.waitForTimeout(1200);
  for (let i = 0; i < 6; i++) { const d = await desc(); if (d && /understand/.test(d.name)) break; await page.keyboard.press('Tab'); }
  await page.keyboard.press('Space'); await page.waitForTimeout(300);
  log('ack by Space enables confirm', await page.evaluate(() => !document.querySelector('tb-rugix-confirm-dialog [mat-dialog-actions] button:last-child').disabled));
  await page.screenshot({ path: OUT + 'kbd-dialog.png' });
  await page.keyboard.press('Escape');
  await browser.close();
})();
