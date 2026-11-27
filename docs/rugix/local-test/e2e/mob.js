const { chromium, devices } = require('playwright-core');
const OUT = (process.env.OUT_DIR || require('os').tmpdir()) + '/';
const fs = require('fs');
const DASH = process.env.DASHBOARD_URL || 'http://localhost:8080/dashboards/<dashboard-id>';
const presets = {
  'iphone-se': devices['iPhone SE'],
  'iphone-14': devices['iPhone 14'],
  'pixel-7': devices['Pixel 7'],
  'ipad': devices['iPad (gen 7)'],
  'ipad-land': devices['iPad (gen 7) landscape'],
};
(async () => {
  const tok = await (await fetch('http://localhost:8080/api/auth/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'tenant@thingsboard.org',password:'tenant'})})).json();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const only = process.argv[2];
  for (const [name, dev] of Object.entries(presets)) {
    if (only && only !== name) continue;
    const ctx = await browser.newContext({ ...dev, locale: 'en-US' });
    await ctx.addInitScript(([t, r]) => {
      localStorage.setItem('jwt_token', t); localStorage.setItem('refresh_token', r);
      localStorage.setItem('jwt_token_expiration', String(Date.now() + 9e5)); localStorage.setItem('refresh_token_expiration', String(Date.now() + 9e6));
    }, [tok.token, tok.refreshToken]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(DASH);
    await page.waitForSelector('tb-rugix-agents .view-tab', { timeout: 60000 });
    await page.waitForTimeout(3000);
    const report = [];
    const check = async (label) => {
      const r = await page.evaluate(() => {
        const W = window.innerWidth; const root = document.querySelector('tb-rugix-agents'); const out = [];
        for (const e of root.querySelectorAll('*')) {
          const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
          if (r.right > W + 1 || r.left < -1) {
            let p = e.parentElement, clipped = false;
            while (p && p !== root) { const o = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(o.overflowX) && p.getBoundingClientRect().right <= W + 1) { clipped = true; break; } p = p.parentElement; }
            if (!clipped) out.push((e.tagName + '.' + (e.className.baseVal ?? e.className)).slice(0, 60) + ' L' + Math.round(r.left) + ' R' + Math.round(r.right));
          }
        }
        // small touch targets (visible, interactive, inside widget or dialog)
        const small = [];
        const scope = [root, ...document.querySelectorAll('.cdk-overlay-container')];
        for (const sc of scope) for (const e of sc.querySelectorAll('button, a[href], input, [role=tab], [role=button], mat-select, tr[tabindex]')) {
          const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
          const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
          if (e.matches('input[type=checkbox]')) continue;
          if (r.width < 24 || r.height < 24) small.push((e.getAttribute('aria-label') || e.innerText || e.tagName).slice(0, 25) + ` ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        return { W, docSW: document.documentElement.scrollWidth, out: out.slice(0, 6), small: small.slice(0, 6) };
      });
      report.push({ label, ...r });
      return r;
    };
    const shot = (n) => page.screenshot({ path: OUT + `mob-${name}-${n}.png` });
    for (const v of ['Overview', 'Devices', 'Jobs', 'Updates', 'Apps', 'Channels']) {
      await page.evaluate(t => [...document.querySelectorAll('tb-rugix-agents .view-tab')].find(x => x.innerText.includes(t)).click(), v);
      await page.waitForTimeout(1500);
      await check(v); await shot(v);
    }
    // device details
    await page.evaluate(() => [...document.querySelectorAll('tb-rugix-agents .view-tab')].find(x => x.innerText.includes('Devices')).click());
    await page.waitForTimeout(1200);
    await page.evaluate(() => document.querySelector('tb-rugix-agents .main-table tbody tr').click());
    await page.waitForTimeout(2000);
    await check('device-details'); await shot('details');
    for (const t of ['Slots', 'Apps', 'Components', 'Resources', 'Job log']) {
      const ok = await page.evaluate(t => { const x = [...document.querySelectorAll('.rugix-details .tab')].find(x => x.innerText.startsWith(t)); if (x) { x.click(); return true; } return false; }, t);
      if (ok) { await page.waitForTimeout(1200); await check('tab-' + t); }
    }
    // dialogs
    await page.evaluate(() => [...document.querySelectorAll('.details-buttons button')].find(x => x.innerText.includes('Factory')).click());
    await page.waitForTimeout(1500); await check('dialog-reset'); await shot('reset');
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    await page.evaluate(() => [...document.querySelectorAll('.details-buttons button')].find(x => x.innerText.includes('Upgrade')).click());
    await page.waitForTimeout(2000); await check('dialog-install'); await shot('install');
    await page.evaluate(() => document.querySelector('tb-rugix-install-dialog button[aria-label=Close]').click());
    await page.waitForTimeout(500);
    console.log('== ' + name, JSON.stringify(dev.viewport), 'errors:', errors.length);
    for (const r of report) console.log(' ', r.label.padEnd(16), 'W', r.W, 'docSW', r.docSW, r.out.length ? 'OUT ' + r.out.join(' | ') : '', r.small.length ? 'SMALL ' + r.small.join(' | ') : '');
    await ctx.close();
  }
  await browser.close();
})();
