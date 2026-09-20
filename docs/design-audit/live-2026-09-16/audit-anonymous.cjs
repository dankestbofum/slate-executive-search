const { chromium } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const report = { startedAt: new Date().toISOString(), console: [], failedRequests: [], errorResponses: [], screens: [] };
  page.on('console', msg => { if (['error', 'warning'].includes(msg.type())) report.console.push({ type: msg.type(), text: msg.text() }); });
  page.on('pageerror', err => report.console.push({ type: 'pageerror', text: err.message }));
  page.on('requestfailed', req => report.failedRequests.push({ url: req.url(), error: req.failure()?.errorText }));
  page.on('response', res => { if (res.status() >= 400) report.errorResponses.push({ url: res.url(), status: res.status() }); });
  async function snapshot(name) {
    await page.screenshot({ path: path.join(__dirname, name + '.png'), fullPage: true, animations: 'disabled' });
    const layout = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
    const screen = { name, url: page.url(), title: await page.title(), ...layout, text: await page.locator('body').innerText(), buttons: await page.getByRole('button').allTextContents(), violations: axe.violations.map(v => ({ id: v.id, impact: v.impact, description: v.description, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })) };
    report.screens.push(screen);
    fs.writeFileSync(path.join(__dirname, 'anonymous-browser-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(screen));
  }
  try {
    await page.goto('https://slate-executive-search.onrender.com/', { waitUntil: 'networkidle', timeout: 60000 });
    await snapshot('anonymous-desktop');
    await page.setViewportSize({ width: 390, height: 844 });
    await snapshot('anonymous-mobile');
    const signIn = page.getByRole('button', { name: /sign in|open workspace|enter workspace|start/i }).first();
    if (await signIn.count()) {
      await signIn.click();
      await page.waitForLoadState('networkidle');
      await page.getByRole('heading', { name: /Sign in to/ }).waitFor({ state: 'visible' });
      await snapshot('signin-mobile');
      await page.setViewportSize({ width: 1440, height: 1000 });
      await snapshot('signin-desktop');
      await page.keyboard.press('Escape');
      await page.getByRole('heading', { name: /Sign in to/ }).waitFor({ state: 'hidden' });
      report.keyboard = { escapeClosesSignIn: true, focusAfterEscape: await page.evaluate(() => ({ tag: document.activeElement.tagName, text: document.activeElement.textContent?.trim(), action: document.activeElement.getAttribute('data-act') })) };
      await page.getByRole('button', { name: 'Sign up', exact: true }).click();
      await page.getByRole('heading', { name: /Create your account/ }).waitFor({ state: 'visible' });
      await snapshot('signup-desktop');
      await page.setViewportSize({ width: 390, height: 844 });
      await snapshot('signup-mobile');
    }
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(__dirname, 'anonymous-browser-results.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
