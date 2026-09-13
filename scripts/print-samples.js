'use strict';

/**
 * Produce the printed output so a person can look at it.
 *
 * DEP-12 asks for print and PDF output to be verified "for long county names,
 * long candidate responses, tables, photos, page breaks, headers, and readable
 * text". A test cannot do that. `tests/browser/accessibility.spec.js` asserts
 * that the editing chrome is hidden under print media, which catches the rule
 * being deleted and nothing else: it says nothing about whether a heading
 * lands at the foot of a page, whether a long answer is cut in half, or
 * whether 9pt grey on white is readable on paper.
 *
 * So this does the part a machine can do — build a search deliberately shaped
 * to break layout, drive the application's own print path, and write the PDFs
 * out — and leaves the looking to a person. The checklist item closes when
 * someone has opened these and initialled them, not when this script exits 0.
 *
 *   npm run print:samples          writes to print-samples/
 *   npm run print:samples -- --out somewhere-else
 *
 * The output is deliberately gitignored (*.pdf). It is evidence for a review,
 * not an artifact of the build.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const { chromium } = require('@playwright/test');
const identity = require('../tests/identity');

const root = path.resolve(__dirname, '..');
const outArg = process.argv.indexOf('--out');
const OUT = path.resolve(root, outArg > -1 ? process.argv[outArg + 1] : 'print-samples');

// Deliberately awkward content. A sample that prints beautifully because it is
// short and tidy is not evidence of anything.
const LONG_COUNTY = 'Sierra de las Estrellas y Cañón del Norte County';
const LONG_POSITION = 'County Administrator and Chief Executive of the Board of Supervisors';

const LONG_ANSWER = [
  'I closed a structural deficit of $14.2M over three budget cycles without a service reduction to public safety or libraries.',
  'The first year was the hardest: we had to renegotiate three bargaining agreements simultaneously while the board was split 3-2 on whether to pursue a sales tax measure at all.',
  'What I learned is that a finance presentation that a supervisor cannot explain to a constituent in their own words is a presentation that has failed, however accurate it is.',
  'I rebuilt the quarterly report around three numbers and a single page, and the measure passed with 58% after two prior attempts had failed.',
  'On organisational culture: I inherited a department where the previous administrator had not held an all-hands in four years, and exit interviews were not read by anyone.',
  'I read every exit interview from the preceding eighteen months in my first month, which took two weekends and told me more than any consultant report would have.',
  'The pattern was not pay. It was that people could not get a decision made, so they stopped asking, and the best of them left for places where decisions happened.'
].join(' ');

function say(message) { process.stdout.write(message + '\n'); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-print-'));
  const fixture = identity.serverEnv();
  process.env.SLATE_TEST_CLERK_KEY = fixture.privateKey;

  const env = {
    ...process.env, NODE_ENV: 'test', PORT: '0', HOST: '127.0.0.1',
    DATA_DIR: path.join(directory, 'server'), TRUST_PROXY: '', ANTHROPIC_API_KEY: '',
    ...fixture.server, SLATE_EMAIL_TEAM: 'team@slate.local',
    SLATE_EMAIL_ABE: 'abe@slate.local', SLATE_EMAIL_MIKE: 'mike@slate.local',
    // The candidate page is one of the samples, and the point of reviewing it
    // is to see what a candidate actually gets. An unconfigured deployment
    // prints "a contact has not been published yet", which is true but is not
    // the page anyone is trying to review.
    SLATE_SUPPORT_EMAIL: 'recruitment@example.gov',
    SLATE_SUPPORT_HOURS: 'Weekdays 8am–5pm Arizona time'
  };
  const server = fork(path.join(root, 'tests', 'server.js'), [], {
    cwd: root, env, stdio: ['ignore', 'ignore', 'inherit', 'ipc'], windowsHide: true
  });

  let browser = null;
  const written = [];
  try {
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server did not start.')), 15000);
      server.once('message', m => { clearTimeout(timer); resolve(m); });
      server.once('exit', () => { clearTimeout(timer); reject(new Error('Server exited before startup.')); });
      server.once('error', e => { clearTimeout(timer); reject(e); });
    });
    const BASE = 'http://127.0.0.1:' + ready.port;
    const signer = identity.signer(fixture.privateKey);
    const auth = signer.headers('abe@slate.local');

    async function call(method, url, body, headers) {
      const res = await fetch(BASE + url, {
        method, headers: { 'content-type': 'application/json', ...(headers || auth) },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* the raw body is the finding */ }
      if (!res.ok) throw new Error(method + ' ' + url + ' -> ' + res.status + ' ' + text.slice(0, 200));
      return json;
    }
    async function write(method, url, body) {
      const id = url.split('/')[3];
      const current = await call('GET', '/api/searches/' + id);
      return call(method, url, body, { ...auth, 'if-match': String(current.revision) });
    }

    /* ---------------- A search shaped to break layout ---------------- */

    say('Building a search with a long name, long answers, tables and photos…');
    const search = await call('POST', '/api/searches', {
      client: LONG_COUNTY, position: LONG_POSITION, jurisdictionType: 'county',
      state: 'AZ', package: 'executive'
    });
    const id = search.id;

    await write('PATCH', '/api/searches/' + id, {
      fog: 'Board of Supervisors – County Administrator',
      population: '412,880', budget: '$1.24 billion', salary: '$265,000 – $310,000 DOQ',
      firstReview: 'First review of applications 14 November 2026'
    });

    // The community profile the brochure is assembled from.
    const paragraph = key => key + ': ' + LONG_ANSWER;
    await write('PUT', '/api/searches/' + id + '/artifact/community', {
      body: {
        history: paragraph('History and identity'),
        qualityOfLife: paragraph('Quality of life'),
        housing: paragraph('Housing and cost of living'),
        schools: paragraph('Schools'),
        parksArts: paragraph('Parks, arts and culture'),
        economy: paragraph('Employers and economic base'),
        healthcare: paragraph('Healthcare'),
        transportation: paragraph('Transportation'),
        climate: paragraph('Climate and outdoors'),
        growth: paragraph('Growth and major projects')
      }
    });
    await write('POST', '/api/searches/' + id + '/assemble', { kind: 'brochure' });

    // A table wide enough to be a page-break problem.
    await write('PUT', '/api/searches/' + id + '/artifact/plan', {
      body: {
        rows: [
          { outlet: 'ICMA Job Center', audience: 'Members nationwide', format: 'Full listing with brochure link', when: 'Week 1', cost: '$400', who: 'Slate', status: 'Planned' },
          { outlet: 'National Association of Counties', audience: 'County administrators', format: 'Display advertisement', when: 'Week 1', cost: '$650', who: 'Slate', status: 'Planned' },
          { outlet: 'Arizona City/County Management Association', audience: 'Arizona practitioners', format: 'Newsletter notice', when: 'Week 2', cost: 'No charge', who: 'County', status: 'Planned' },
          { outlet: 'LinkedIn, targeted', audience: 'Deputy and assistant administrators', format: 'Sponsored post', when: 'Weeks 2–5', cost: '$900', who: 'Slate', status: 'Planned' },
          { outlet: 'Direct outreach', audience: 'Identified sitting administrators', format: 'Personal call and packet', when: 'Weeks 1–6', cost: 'Included', who: 'Slate', status: 'In progress' },
          { outlet: 'County website and social channels', audience: 'Residents and internal candidates', format: 'Notice with application link', when: 'Week 1', cost: 'No charge', who: 'County', status: 'Planned' }
        ]
      }
    });

    // A profile, a questionnaire, and a candidate who answered it at length.
    await write('PUT', '/api/searches/' + id + '/profile', {
      criteria: [
        { id: 'S1', kind: 'skill', label: 'Financial management in a constrained environment', weight: 5, note: 'Closing a structural deficit without cutting mandated services.' },
        { id: 'S2', kind: 'skill', label: 'Board of Supervisors relations', weight: 5, note: '' },
        { id: 'S3', kind: 'skill', label: 'Organisational culture and retention', weight: 4, note: '' },
        { id: 'T1', kind: 'trait', label: 'Transparent under pressure', weight: 4, note: '' },
        { id: 'C1', kind: 'chall', label: 'Deferred infrastructure maintenance', weight: 3, note: '' }
      ]
    });
    const questions = [
      { n: 1, prompt: 'Describe a structural deficit you closed, and what it cost the organisation to do it.', required: true, crit: ['S1'] },
      { n: 2, prompt: 'How have you handled a governing body split on a decision you believed was necessary?', required: true, crit: ['S2'] },
      { n: 3, prompt: 'What did you do about retention in a department that was losing its strongest people?', required: true, crit: ['S3'] }
    ];
    await write('PUT', '/api/searches/' + id + '/artifact/survey1', {
      body: { intro: 'Tell us how you have done this work, in your own words.', questions }
    });

    // Enough candidates that the screening table is a real table.
    const names = ['Marguerite Featherstonehaugh-Villanueva', 'Bo Chen', 'Aisha Abdullah-Okonkwo',
      'Tom Ng', 'Priya Balasubramanian', 'Jean-Baptiste Rousseau', 'Sam Idowu', 'Lena Hovhannisyan'];
    let first = null;
    for (const name of names) {
      const updated = await write('POST', '/api/searches/' + id + '/candidates', {
        name, cur: 'Deputy County Administrator', org: 'County of Elsewhere', email: 'x@example.gov'
      });
      first ||= updated.candidates[0];
    }

    const loaded = await call('GET', '/api/searches/' + id);
    const candidate = loaded.candidates.find(c => c.name === names[0]);
    const version = (await call('GET', '/api/apply/' + candidate.invite)).versions.survey1;
    await fetch(BASE + '/api/apply/' + candidate.invite, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ which: 'survey1', surveyVersion: version, answers: {
        q1: LONG_ANSWER, q2: LONG_ANSWER, q3: LONG_ANSWER
      } })
    });
    await write('PUT', '/api/searches/' + id + '/scores/' + candidate.id, {
      scores: { S1: 5, S2: 4, S3: 5, T1: 4, C1: 3 },
      note: 'Strongest financial evidence in the pool. ' + LONG_ANSWER.slice(0, 300)
    });

    /* ---------------- Drive the app's own print path ---------------- */

    browser = await chromium.launch();
    const context = await browser.newContext({ baseURL: BASE });
    const token = signer.token('abe@slate.local');
    await context.setExtraHTTPHeaders({ authorization: 'Bearer ' + token });
    const { installClerk } = require('../tests/browser/clerk');
    await installClerk(context, { email: 'abe@slate.local' });
    const page = await context.newPage();

    // `print` is what the stylesheet keys off; `data-print` is what the
    // application's own Print control sets. Using both means these PDFs come
    // out of the same path a consultant would use, not a private one.
    async function pdf(name, view, kind) {
      await page.goto('/#/s/' + id + '/' + view);
      await page.waitForLoadState('networkidle');
      await page.locator('#main h1').first().waitFor({ timeout: 15000 });
      await page.emulateMedia({ media: 'print' });
      if (kind) await page.evaluate(k => { document.documentElement.dataset.print = k; }, kind);
      const file = path.join(OUT, name + '.pdf');
      await page.pdf({ path: file, format: 'Letter', printBackground: true,
        margin: { top: '0.6in', bottom: '0.6in', left: '0.6in', right: '0.6in' } });
      // The same page as an image, still under print media. A PDF needs a
      // reader; a PNG can be glanced at in a review, a pull request, or a
      // chat with the county, and it is what makes a first pass cheap.
      const image = path.join(OUT, name + '.png');
      await page.screenshot({ path: image, fullPage: true });
      await page.evaluate(() => { delete document.documentElement.dataset.print; });
      await page.emulateMedia({ media: 'screen' });
      written.push({ file, kb: (fs.statSync(file).size / 1024).toFixed(0) });
      say('  wrote ' + path.relative(root, file) + ' and .png');
    }

    say('Printing…');
    await pdf('01-brochure', 'brochure', 'brochure');
    await pdf('02-advertisements', 'ads', 'ads');
    await pdf('03-recruitment-plan-table', 'plan');
    await pdf('04-candidate-long-answers', 'person/' + candidate.id);
    await pdf('05-screening-table', 'screen');
    await pdf('06-candidate-questionnaire', 'survey1');

    // The candidate's own page is a different document on a different origin
    // path, and it is the one a member of the public might print.
    await page.goto('/apply/' + loaded.candidates[1].invite);
    await page.waitForLoadState('networkidle');
    await page.emulateMedia({ media: 'print' });
    const applyFile = path.join(OUT, '07-public-apply-page.pdf');
    await page.pdf({ path: applyFile, format: 'Letter', printBackground: true,
      margin: { top: '0.6in', bottom: '0.6in', left: '0.6in', right: '0.6in' } });
    await page.screenshot({ path: path.join(OUT, '07-public-apply-page.png'), fullPage: true });
    written.push({ file: applyFile, kb: (fs.statSync(applyFile).size / 1024).toFixed(0) });
    say('  wrote ' + path.relative(root, applyFile) + ' and .png');

    /* ---------------- What a person still has to do ---------------- */

    const checklist = [
      '# Print output for review',
      '',
      'Generated by `npm run print:samples` on ' + new Date().toISOString().slice(0, 10) + '.',
      'Chromium headless, US Letter, 0.6in margins.',
      '',
      'These are for a person to open and look at. DEP-12 asks for print output to',
      'be *visually inspected*; a script can produce the pages but cannot tell you',
      'whether they read well on paper.',
      '',
      'The search behind them is deliberately awkward: a county name that wraps',
      '(`' + LONG_COUNTY + '`), a position title to match, long candidate answers,',
      'a six-row plan table, and eight candidates including names that do not fit a',
      'narrow column.',
      '',
      '| File | What to check |',
      '|---|---|',
      '| `01-brochure.pdf` | Photos placed, headings not orphaned at a page foot, the county name not clipped |',
      '| `02-advertisements.pdf` | Each of the four versions starts cleanly; no editing chrome |',
      '| `03-recruitment-plan-table.pdf` | The table is not cut off at the right margin; the header row repeats or the break is acceptable |',
      '| `04-candidate-long-answers.pdf` | Long answers break across pages without losing a line; scores legible |',
      '| `05-screening-table.pdf` | Long candidate names wrap rather than truncate |',
      '| `06-candidate-questionnaire.pdf` | Question numbering survives a page break |',
      '| `07-public-apply-page.pdf` | The page a candidate might print: support contact and privacy notice present |',
      '',
      '## Already found and fixed by looking at these',
      '',
      'The first run of this script found two things the print test had not, because',
      'that test set the print flag by hand and so only ever exercised the path where',
      'it is set:',
      '',
      '1. **The print stylesheet only applied to the brochure and advertisements.**',
      '   Every other screen printed with Ctrl+P kept the navigation rail, the filter',
      '   controls and the back link, losing about a fifth of the width to links that',
      '   do nothing on paper. The chrome is now hidden on any print.',
      '2. **An internal review warning printed on the brochure.** "The candidate',
      '   profile changed. Review this copy against the current profile." is for the',
      '   consultant, not for the county reading the packet. Notices are now hidden',
      '   when printing a packet.',
      '',
      '## Judgement calls left for a person',
      '',
      '- **Row action buttons still print** (Review, Invite, Add a candidate). They are',
      '  controls, but hiding every button risked hiding things that read as content.',
      '  Worth a view on whether a printed candidate list should carry them.',
      '- **Editor fields print as input boxes and truncate.** On `03`, the plan table',
      '  cells are text inputs, so "ICMA Job Center" prints as "ICMA Job". A printed',
      '  table of half-words is not usable. Fixing it properly means rendering a',
      '  read-only view for print, which is a design decision, not a CSS tweak.',
      '- **The brochure footer prepends "First review:"** to whatever that field holds,',
      '  so a value that already says "First review of applications…" reads twice. The',
      '  sample uses such a value deliberately.',
      '',
      '## Known limitation, not a defect to find',
      '',
      'A browser-printed PDF is **not an accessible tagged document**. DEP-12 says so',
      'explicitly. If the county requires an accessible export, that is a separate',
      'piece of work and none of these files satisfy it.',
      '',
      '## Sign-off',
      '',
      '- [ ] Opened and read each file above',
      '- [ ] Printed at least one on paper (screen PDF and paper differ)',
      '- [ ] Findings recorded in `docs/test-evidence.md`',
      '',
      'Reviewed by: ________________  Date: ____________'
    ].join('\n');
    const readme = path.join(OUT, 'README.md');
    fs.writeFileSync(readme, checklist + '\n');
    say('  wrote ' + path.relative(root, readme));

    say('');
    say(written.length + ' PDFs in ' + path.relative(root, OUT) + '/ — open them, then sign off in its README.');
    say('Nothing here is evidence until a person has looked at it.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})();
