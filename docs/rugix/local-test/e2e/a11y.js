const { chromium } = require('playwright-core');
const OUT = (process.env.OUT_DIR || require('os').tmpdir()) + '/';
const fs = require('fs');
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
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
  await page.evaluate(AXE);
  const seen = new Map();
  const scan = async (label) => {
    const res = await page.evaluate(async () => {
      const ctxSel = { include: [['tb-rugix-agents'], ['.cdk-overlay-container']] };
      const r = await axe.run(ctxSel, { resultTypes: ['violations'] });
      return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map(n => (n.target.join(' ') + ' :: ' + (n.failureSummary||'').split('\n')[1]||'').slice(0, 170)).slice(0, 4), count: v.nodes.length }));
    });
    console.log(`--- ${label}: ${res.length} rule(s)`);
    for (const v of res) { console.log(`  [${v.impact}] ${v.id} x${v.count}: ${v.help}`); v.nodes.forEach(n => console.log('      ' + n)); }
  };
  const tab = async t => { await page.evaluate(t => [...document.querySelectorAll('tb-rugix-agents .view-tab')].find(x => x.innerText.includes(t)).click(), t); await page.waitForTimeout(1500); };
  for (const v of ['Overview', 'Devices', 'Jobs', 'Updates', 'Apps', 'Channels']) { await tab(v); await scan('view ' + v); }
  await tab('Updates');
  await page.evaluate(() => document.querySelector('.pkg-table tbody tr').click()); await page.waitForTimeout(1200); await scan('package details');
  await page.evaluate(() => [...document.querySelectorAll('.pkg-details button')].find(b => b.innerText.includes('Edit')).click()); await page.waitForTimeout(1500); await scan('package dialog'); await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector('.pkg-details button[aria-label="Close details"]').click());
  await tab('Devices');
  await page.evaluate(() => document.querySelector('tb-rugix-agents .main-table tbody tr').click()); await page.waitForTimeout(2000); await scan('device details');
  for (const t of ['Slots', 'Apps', 'Components', 'Resources', 'Job log']) {
    const ok = await page.evaluate(t => { const x = [...document.querySelectorAll('.rugix-details .tab')].find(x => x.innerText.startsWith(t)); if (x) { x.click(); return true; } return false; }, t);
    if (ok) { await page.waitForTimeout(1500); await scan('tab ' + t); }
  }
  for (const [btn, label] of [['Factory', 'reset dialog'], ['Reboot', 'reboot dialog'], ['Upgrade', 'install dialog']]) {
    await page.evaluate(b => [...document.querySelectorAll('.details-buttons button')].find(x => x.innerText.includes(b)).click(), btn);
    await page.waitForTimeout(1800); await scan(label);
    await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  }
  await browser.close();
})();
