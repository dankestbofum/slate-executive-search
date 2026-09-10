/**
 * Capture and measure the recruiting redesign.
 *
 * Starts its own server on a throwaway data directory, builds a populated
 * synthetic fixture through the API, then walks the redesigned screens at the
 * plan's viewports in both themes, writing screenshots and measurements to
 * docs/design-audit/evidence/recruiting-redesign/.
 *
 *   node docs/design-audit/redesign.cjs            all screens, both themes
 *   node docs/design-audit/redesign.cjs --quick    desktop light only
 *
 * Nothing here is part of the application test suite; it is an evidence tool.
 */
'use strict';

const { chromium } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 4195;
const BASE = 'http://127.0.0.1:' + PORT;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const OUT = path.join(__dirname, 'evidence', 'recruiting-redesign');
const QUICK = process.argv.includes('--quick');

function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-redesign-'));
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
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(BASE + '/api/health');
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('the redesign capture server never came up');
}

const KINDS = ['skill', 'trait', 'chall', 'opp'];
const STAGES = ['applicant', 'semifinalist', 'finalist', 'declined'];

async function fixture(request) {
  const started = await (await request.post(BASE + '/api/start', { data: {} })).json();
  const search = await (await request.post(BASE + '/api/searches', {
    data: { client: 'City of Ridgeline', position: 'City Manager', state: 'Colorado', package: 'executive' }
  })).json();
  const second = await (await request.post(BASE + '/api/searches', {
    data: { client: 'Buenaventura County', position: 'County Administrator', state: 'Colorado', package: 'enhanced' }
  })).json();
  await request.post(BASE + '/api/searches', {
    data: { client: 'Town of Harrow Bend', position: 'Town Manager', state: 'Colorado', package: 'basic' }
  });

  const revision = async id =>
    String((await (await request.get(BASE + '/api/searches/' + id)).json()).revision);

  // A seated committee, so intake and the roster have something in them.
  for (const m of [
    { name: 'Rosalind Achebe-Whitmore', email: 'rosalind@example.gov', seat: 'committee', title: 'Council member' },
    { name: 'Tomas Ferreira', email: 'tomas@example.gov', seat: 'committee', title: 'Council member' },
    { name: 'Junko Halvorsen', email: 'junko@example.gov', seat: 'committee', title: 'Mayor' }
  ]) {
    await request.post(BASE + '/api/searches/' + search.id + '/members', {
      headers: { 'if-match': await revision(search.id) }, data: m
    });
  }
  await request.post(BASE + '/api/searches/' + search.id + '/team/confirm', {
    headers: { 'if-match': await revision(search.id) }, data: { confirmed: true }
  });
  await request.post(BASE + '/api/searches/' + search.id + '/intake/status', {
    headers: { 'if-match': await revision(search.id) }, data: { status: 'open', dueBy: '19 Sep 2026' }
  });

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
    headers: { 'if-match': await revision(search.id) }, data: { criteria }
  });

  await request.put(BASE + '/api/searches/' + search.id + '/artifact/survey1', {
    headers: { 'if-match': await revision(search.id) },
    data: { body: { intro: 'Tell us about your work.', questions: [
      { n: 1, prompt: 'Describe a budget you turned around.', required: true, crit: ['S1'] },
      { n: 2, prompt: 'What would your first ninety days look like?', required: false, crit: ['T1'] }
    ] } }
  });
  await request.put(BASE + '/api/searches/' + search.id + '/artifact/plan', {
    headers: { 'if-match': await revision(search.id) },
    data: { body: { rows: [
      { outlet: 'ICMA Job Center', audience: 'Sitting managers', format: 'Full listing', timing: 'Week 1', cost: '$450' },
      { outlet: 'State league newsletter', audience: 'In-state', format: 'Brief', timing: 'Week 1', cost: '$120' }
    ] } }
  });

  // Twenty candidates spread across every stage the product actually has.
  for (let i = 0; i < 20; i += 1) {
    await request.post(BASE + '/api/searches/' + search.id + '/candidates', {
      headers: { 'if-match': await revision(search.id) },
      data: {
        name: i === 0 ? 'Alexandra Featherstonehaugh-Wellington' : 'Candidate Number ' + String(i + 1).padStart(2, '0'),
        cur: 'Deputy City Manager for Administrative Services',
        org: 'City and County of Somewhere Rather Long'
      }
    });
  }
  const roll = (await (await request.get(BASE + '/api/searches/' + search.id)).json()).candidates;
  for (let i = 0; i < roll.length; i += 1) {
    const stage = STAGES[i % 4];
    if (stage === 'applicant') continue;
    await request.patch(BASE + '/api/searches/' + search.id + '/candidates/' + roll[i].id, {
      headers: { 'if-match': await revision(search.id) }, data: { stage }
    });
  }

  // Two real questionnaire responses, so evidence beside scoring is populated
  // and the response filter has both states in it.
  for (const c of [roll[0], roll[1]]) {
    const applied = await (await request.get(BASE + '/api/apply/' + c.invite)).json();
    if (!applied || !applied.survey1) continue;
    await request.post(BASE + '/api/apply/' + c.invite, {
      data: {
        which: 'survey1',
        surveyVersion: applied.versions.survey1,
        answers: {
          q1: 'We closed a nine million dollar structural gap over two budget cycles without a service reduction residents could feel.',
          q2: 'Listen first. Meet every department head, every council member, and the three neighbourhood associations before proposing anything.'
        }
      }
    });
  }

  const loaded = await (await request.get(BASE + '/api/searches/' + search.id)).json();
  return { user: started.user, search: loaded, second, candidate: loaded.candidates[0] };
}

const VIEWPORTS = QUICK
  ? [{ name: '1440x1000', width: 1440, height: 1000 }]
  : [
    { name: '1440x1000', width: 1440, height: 1000 },
    { name: '1280x720', width: 1280, height: 720 },
    { name: '768x1024', width: 768, height: 1024 },
    { name: '390x844', width: 390, height: 844 },
    { name: '320x720', width: 320, height: 720 }
  ];

async function measure(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const box = sel => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top + window.scrollY), height: Math.round(r.height) };
    };
    const heading = box('#main h1');
    const rows = [...document.querySelectorAll('#main .candtable tbody tr')];
    const fold = window.innerHeight;
    return {
      headingTop: heading ? heading.top : null,
      pageHeight: doc.scrollHeight,
      sidewaysOverflow: doc.scrollWidth - doc.clientWidth,
      railWidth: (() => {
        const r = document.querySelector('.rail');
        return r && getComputedStyle(r).position !== 'fixed' ? Math.round(r.getBoundingClientRect().width) : null;
      })(),
      // How much of the list survives the first viewport, which is the
      // acceptance measure for the candidate table.
      rowsAboveFold: rows.filter(tr => tr.getBoundingClientRect().bottom <= fold).length,
      firstPanelTop: box('#main .band .spec, #main .band .tiles, #main .band .stagebar')?.top ?? null,
      // The hiring summary itself: the plan asks for it inside the first
      // viewport on a 1280 x 720 desktop.
      stageBarTop: box('#main .stagebar')?.top ?? null,
      stageBarInFirstViewport: (() => {
        const el = document.querySelector('#main .stagebar');
        return el ? el.getBoundingClientRect().bottom <= window.innerHeight : null;
      })(),
      // The list header plus its rows, for the candidate-table acceptance.
      listHeaderVisible: (() => {
        const el = document.querySelector('#main .candtable thead');
        return el ? el.getBoundingClientRect().bottom <= window.innerHeight : null;
      })()
    };
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = startServer();
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const built = await fixture(context.request);
    const id = built.search.id;
    const page = await context.newPage();

    const screens = {
      home: '/#/home',
      overview: '/#/s/' + id,
      candidates: '/#/s/' + id + '/screen',
      candidate: '/#/s/' + id + '/person/' + built.candidate.id,
      interviews: '/#/s/' + id + '/interviews',
      committee: '/#/s/' + id + '/committee',
      documents: '/#/s/' + id + '/documents',
      activity: '/#/s/' + id + '/activity',
      process: '/#/s/' + id + '/process',
      profile: '/#/s/' + id + '/profile',
      facts: '/#/s/' + id + '/facts',
      // A representative form, a representative editor, and the secondary
      // surfaces the shared components had to reach.
      'new search': '/#/new',
      roster: '/#/s/' + id + '/team',
      intake: '/#/s/' + id + '/intake',
      'ad plan': '/#/s/' + id + '/plan',
      sourcing: '/#/s/' + id + '/sourcing',
      semifinalists: '/#/s/' + id + '/send2',
      finalists: '/#/s/' + id + '/finalists',
      packages: '/#/packages/executive',
      archives: '/#/archives',
      history: '/#/s/' + id + '/history'
    };

    const geometry = {};
    for (const view of VIEWPORTS) {
      await page.setViewportSize({ width: view.width, height: view.height });
      geometry[view.name] = {};
      for (const [name, route] of Object.entries(screens)) {
        await page.goto(BASE + route);
        await page.locator('#main h1').first().waitFor({ timeout: 20000 });
        await page.waitForTimeout(120);
        geometry[view.name][name] = await measure(page);
        if (view.name === '1440x1000' || view.name === '390x844') {
          await page.screenshot({
            path: path.join(OUT, name + '-' + (view.width <= 400 ? 'mobile' : 'desktop') + '.png'),
            fullPage: view.width <= 400
          });
        }
      }
    }

    // Dark theme on the first slice, which is where the colour work happened.
    if (!QUICK) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      for (const [name, route] of Object.entries({ overview: screens.overview, candidates: screens.candidates, home: screens.home })) {
        await page.goto(BASE + route);
        await page.locator('#main h1').first().waitFor();
        await page.locator('button[data-theme="dark"]').click();
        await page.waitForTimeout(320);
        await page.screenshot({ path: path.join(OUT, name + '-dark.png') });
      }
    }

    const accessibility = {};
    for (const [name, route] of Object.entries(screens)) {
      accessibility[name] = {};
      for (const theme of QUICK ? ['light'] : ['light', 'dark']) {
        await page.goto(BASE + route);
        await page.locator('#main h1').first().waitFor();
        await page.locator('button[data-theme="' + theme + '"]').click();
        // Controls animate their background over 120ms; scanning in the same
        // tick reads a colour that never appears on screen.
        await page.waitForTimeout(320);
        const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        accessibility[name][theme] = results.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
      }
    }

    // A committee member sees the same visual language and a smaller
    // workspace. Captured in their own session, because what they are shown is
    // decided by the server, not by hiding controls in the page.
    const roles = {};
    if (!QUICK) {
      const member = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await member.request.post(BASE + '/api/login', { data: { email: 'rosalind@example.gov' } });
      const mp = await member.newPage();
      for (const [name, route] of Object.entries({
        'committee-home': '/#/home',
        'committee-overview': '/#/s/' + id,
        'committee-intake': '/#/s/' + id + '/intake',
        'committee-candidates': '/#/s/' + id + '/screen',
        // A step this seat does not take part in, reached by direct link.
        'committee-denied-plan': '/#/s/' + id + '/plan'
      })) {
        await mp.goto(BASE + route);
        await mp.locator('#main h1').first().waitFor({ timeout: 20000 });
        await mp.waitForTimeout(150);
        roles[name] = {
          heading: await mp.locator('#main h1').first().innerText(),
          rail: await mp.locator('.rail__link--dest .rail__label--dest').allInnerTexts(),
          address: await mp.evaluate(() => location.hash)
        };
        await mp.screenshot({ path: path.join(OUT, name + '.png') });
      }
      await member.close();

      // A step the Basic package leaves off the file, reached by direct link.
      const basic = (await (await context.request.get(BASE + '/api/searches')).json())
        .find(x => x.package === 'basic');
      if (basic) {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(BASE + '/#/s/' + basic.id + '/brochure');
        await page.locator('#main h1').first().waitFor();
        await page.waitForTimeout(150);
        roles['basic-excluded-brochure'] = {
          heading: await page.locator('#main h1').first().innerText(),
          rail: await page.locator('.rail__link--dest .rail__label--dest').allInnerTexts(),
          address: await page.evaluate(() => location.hash)
        };
        await page.screenshot({ path: path.join(OUT, 'basic-excluded-brochure.png') });
      }

      // The public questionnaire and its receipt, which keep their own layout.
      const pub = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const pp = await pub.newPage();
      const answered = built.search.candidates[0];
      const unanswered = built.search.candidates.find(c => !c.survey1);
      for (const [name, token] of Object.entries({
        'questionnaire-mobile': unanswered ? unanswered.invite : answered.invite,
        'receipt-mobile': answered.invite
      })) {
        await pp.goto(BASE + '/apply/' + token);
        await pp.locator('#main h1, h1').first().waitFor({ timeout: 20000 });
        await pp.waitForTimeout(150);
        roles[name] = { heading: await pp.locator('h1').first().innerText() };
        await pp.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
      }
      await pub.close();
    }

    const out = { measuredAt: new Date().toISOString(), quick: QUICK, viewports: geometry, roles, accessibility };
    fs.writeFileSync(path.join(OUT, 'measurements.json'), JSON.stringify(out, null, 2));
    console.log('wrote ' + path.join(OUT, 'measurements.json'));
    const violations = Object.entries(accessibility).flatMap(([screen, themes]) =>
      Object.entries(themes).flatMap(([theme, list]) => list.map(v => screen + '/' + theme + ': ' + v.id + ' x' + v.nodes)));
    console.log(violations.length ? 'axe violations:\n' + violations.join('\n') : 'axe: no violations');
    console.log(JSON.stringify(geometry['1440x1000'], null, 2));
  } finally {
    if (browser) await browser.close();
    server.child.kill();
  }
})().catch(err => { console.error(err); process.exit(1); });
