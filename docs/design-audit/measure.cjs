/**
 * Re-measure the numbers the audit reported, against the implemented design.
 *
 * Companion to verify.cjs, which measured the interface as it was. This one
 * starts its own server on a throwaway data directory, builds a populated
 * fixture through the API, and records heading positions, page heights, form
 * geometry and axe results at the viewports in the plan's verification matrix.
 *
 *   node docs/design-audit/measure.cjs
 *
 * Writes docs/design-audit/evidence/after-measurements.json.
 */
'use strict';

const { chromium } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 4193;
const BASE = 'http://127.0.0.1:' + PORT;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-measure-'));
  const child = spawn(process.execPath, [path.join(__dirname, '..', '..', 'server', 'index.js')], {
    env: {
      ...process.env,
      NODE_ENV: 'test', PORT: String(PORT), HOST: '127.0.0.1',
      DATA_DIR: dataDir, ANTHROPIC_API_KEY: '', SHOW_DEMO_LOGINS: 'true',
      SLATE_SUPPORT_EMAIL: 'recruitment@example.gov'
    },
    stdio: 'ignore', windowsHide: true
  });
  return { child, dataDir };
}

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(BASE + '/api/health');
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('the measurement server never came up');
}

const KINDS = ['skill', 'trait', 'chall', 'opp'];

async function fixture(request) {
  const started = await (await request.post(BASE + '/api/start', { data: {} })).json();
  const search = await (await request.post(BASE + '/api/searches', {
    data: { client: 'City of Ridgeline', position: 'City Manager', state: 'Colorado', package: 'executive' }
  })).json();
  const revision = async () =>
    String((await (await request.get(BASE + '/api/searches/' + search.id)).json()).revision);

  // Twelve criteria: three in each category, which is what the audit's
  // populated profile screenshot carried.
  const criteria = [];
  for (const kind of KINDS) {
    for (let i = 1; i <= 3; i += 1) {
      criteria.push({
        id: kind[0].toUpperCase() + i, kind,
        label: 'A criterion with a reasonably long name, number ' + i,
        weight: 3, note: 'Why this matters to the governing body of this jurisdiction.'
      });
    }
  }
  await request.put(BASE + '/api/searches/' + search.id + '/profile', {
    headers: { 'if-match': await revision() }, data: { criteria }
  });

  await request.put(BASE + '/api/searches/' + search.id + '/artifact/survey1', {
    headers: { 'if-match': await revision() },
    data: { body: { intro: 'Tell us about your work.', questions: [
      { n: 1, prompt: 'Describe a budget you turned around.', required: true },
      { n: 2, prompt: 'What would your first ninety days look like?', required: false }
    ] } }
  });

  for (let i = 0; i < 20; i += 1) {
    await request.post(BASE + '/api/searches/' + search.id + '/candidates', {
      headers: { 'if-match': await revision() },
      data: {
        name: i === 0 ? 'Alexandra Featherstonehaugh-Wellington' : 'Candidate Number ' + String(i + 1).padStart(2, '0'),
        cur: 'Deputy City Manager for Administrative Services',
        org: 'City and County of Somewhere Rather Long'
      }
    });
  }
  const loaded = await (await request.get(BASE + '/api/searches/' + search.id)).json();
  return { user: started.user, search: loaded };
}

const VIEWPORTS = [
  { name: '1440x1000', width: 1440, height: 1000 },
  { name: '1280x720', width: 1280, height: 720 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
  { name: '320x720', width: 320, height: 720 }
];

async function measure(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const top = sel => {
      const el = document.querySelector(sel);
      return el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null;
    };
    return {
      headingTop: top('#main h1'),
      firstActionTop: top('#main .hero .btn, #main .band .btn'),
      pageHeight: doc.scrollHeight,
      sidewaysOverflow: doc.scrollWidth - doc.clientWidth,
      widestTable: (() => {
        const t = document.querySelector('#main table');
        return t ? Math.round(t.getBoundingClientRect().width) : null;
      })()
    };
  });
}

(async () => {
  const server = startServer();
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const { search } = await fixture(context.request);
    const page = await context.newPage();

    const screens = {
      home: '/#/home',
      'new search': '/#/new',
      overview: '/#/s/' + search.id,
      screening: '/#/s/' + search.id + '/screen',
      profile: '/#/s/' + search.id + '/profile',
      'search facts': '/#/s/' + search.id + '/facts',
      'initial survey': '/#/s/' + search.id + '/survey1'
    };

    const geometry = {};
    for (const view of VIEWPORTS) {
      await page.setViewportSize({ width: view.width, height: view.height });
      geometry[view.name] = {};
      for (const [name, route] of Object.entries(screens)) {
        await page.goto(BASE + route);
        await page.locator('#main h1').first().waitFor({ timeout: 15000 });
        geometry[view.name][name] = await measure(page);
      }
    }

    // The new-search form specifically: the audit measured the client field at
    // y = 1,645px and the form at 2,117px tall on a 1440x1000 desktop.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(BASE + '/#/new');
    await page.locator('#newsearch').waitFor();
    const newSearch = await page.evaluate(() => ({
      clientFieldTop: Math.round(document.querySelector('#newsearch [name="client"]').getBoundingClientRect().top + window.scrollY),
      formHeight: Math.round(document.querySelector('#newsearch').getBoundingClientRect().height),
      formColumns: getComputedStyle(document.querySelector('#newsearch .formgrid')).gridTemplateColumns.split(' ').length
    }));

    const accessibility = {};
    for (const [name, route] of Object.entries(screens)) {
      accessibility[name] = {};
      for (const theme of ['light', 'dark']) {
        await page.goto(BASE + route);
        await page.locator('#main h1').first().waitFor();
        await page.locator('button[data-theme="' + theme + '"]').click();
        // Controls animate their background over 120ms. Scanning immediately
        // measures a colour part-way between the two palettes.
        await page.waitForTimeout(300);
        const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        accessibility[name][theme] = {
          violations: results.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
          strayAriaPressedOnHtml: await page.evaluate(() => document.documentElement.getAttribute('aria-pressed'))
        };
      }
    }

    const out = { measuredAt: new Date().toISOString(), viewports: geometry, newSearch, accessibility };
    const file = path.join(__dirname, 'evidence', 'after-measurements.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    console.log('wrote ' + file);
    console.log(JSON.stringify({ newSearch, mobile: geometry['390x844'], tablet: geometry['768x1024'] }, null, 2));
  } finally {
    if (browser) await browser.close();
    server.child.kill();
  }
})().catch(err => { console.error(err); process.exit(1); });
