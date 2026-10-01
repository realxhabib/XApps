// Screenshots Nova Rally at chosen moments (headless Chromium, software GL). Needs `npm run dev` on :3000.
// Usage (from apps/web): node scripts/nova-capture.cjs "$(cat plan.json)" [outDir]
// plan: { quality?: "high"|"low", width?, height?, runs: [{ track?: id, cup?: id, cc?: 150, steps: [["ff", seconds] | ["shot", name] | ["key", code, ms] | ["eval", js] | ["wait", ms] | ["autopilot", bool]] }] }
const { chromium } = require('@playwright/test');
(async () => {
  const plan = JSON.parse(process.argv[2]);
  const out = process.argv[3] || 'nova-shots';
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const run of plan.runs) {
    const page = await browser.newPage({ viewport: { width: plan.width || 1280, height: plan.height || 720 } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    if (run.choice) await page.addInitScript((c) => localStorage.setItem('nova-rally:ship', JSON.stringify(c)), run.choice);
    const settings = {};
    if (run.track) settings.track = run.track;
    if (run.cup) settings.cup = run.cup;
    if (run.cc) settings.cc = run.cc;
    if (run.laps) settings.laps = run.laps;
    if (run.mirror) settings.mirror = true;
    if (run.mode) settings.mode = run.mode;
    const q = new URLSearchParams({ 'nr-debug': '1', quality: plan.quality || 'high', 'xapps-settings': JSON.stringify(settings) });
    if (run.players) q.set('xapps-players', String(run.players));
    await page.goto(`http://localhost:3000/embed/nova-rally?${q}`, { waitUntil: 'networkidle', timeout: 180000 });
    await page.getByRole('button', { name: /Start engines/ }).click({ timeout: 120000 });
    await page.waitForFunction(() => !!window.__novaRally, null, { timeout: 120000 });
    for (const step of run.steps) {
      const [op, a, b] = step;
      if (op === 'ff') await page.evaluate((s) => window.__novaRally.fastForward(s), a);
      else if (op === 'autopilot') await page.evaluate((v) => { window.__novaRally.autopilot = v; }, a);
      else if (op === 'wait') await page.waitForTimeout(a);
      else if (op === 'eval') console.log('eval:', JSON.stringify(await page.evaluate(a)));
      else if (op === 'key') { await page.keyboard.down(a); await page.waitForTimeout(b || 500); await page.keyboard.up(a); }
      else if (op === 'shot') {
        await page.waitForTimeout(1500);
        const t = Date.now();
        try { await page.screenshot({ path: `${out}/${a}.png`, timeout: 150000 }); console.log('shot', a, Date.now() - t, 'ms'); } catch (e) { console.log('shot failed', a, e.message.slice(0, 100)); }
      }
    }
    if (errors.length) console.log('errors:\n' + [...new Set(errors)].slice(0, 15).join('\n'));
    await page.close();
  }
  await browser.close();
})();
