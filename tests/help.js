'use strict';

/**
 * The user guide.
 *
 * Three things are worth proving about help content, and none of them is about
 * prose quality:
 *
 *  1. Every link resolves. A help link that lands nowhere is found by somebody
 *     who is already stuck, which is the worst possible moment.
 *  2. The screens the guide claims to explain are screens this build actually
 *     renders. That check needs the client's own knownView(), so it is done
 *     here against the real public/app.js rather than by keeping a second list
 *     of view names on the server.
 *  3. The public projection carries candidate content and nothing else. It is
 *     served to anybody on the internet with no session at all.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const catalog = require('../content/help/catalog');
const schema = require('../content/help/schema');
const help = require('../server/help');
const { STEPS, PACKAGE_ORDER } = require('../server/steps');

const BASE = process.env.SLATE_URL || 'http://127.0.0.1:4173';
let passed = 0;
let failed = 0;

async function check(name, fn) {
  try { await fn(); passed += 1; console.log('PASS  Help: ' + name); }
  catch (error) { failed += 1; console.error('FAIL  Help: ' + name + '\n      ' + (error && error.stack || error)); }
}

/**
 * The client's own view predicate, lifted out of public/app.js.
 *
 * knownView() reads two module constants, so they come along. Extracting
 * rather than reimplementing is the whole point: a view removed from the
 * client has to make this fail.
 */
function clientKnownView() {
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const grab = (label, re) => {
    const match = source.match(re);
    assert.ok(match, 'public/app.js no longer defines ' + label);
    return match[0];
  };
  const context = vm.createContext({});
  vm.runInContext([
    grab('HUB_VIEWS', /^const HUB_VIEWS = \[[^\]]*\];/m),
    grab('STEP_FLOW', /^const STEP_FLOW = \[[^\]]*\];/m),
    grab('knownView', /^function knownView\([^]*?^}/m)
  ].join('\n'), context);
  return context.knownView;
}

(async () => {

  /* ---------------- The catalog against this build ---------------- */

  await check('the catalog validates against the process catalog', () => {
    const problems = schema.validate(catalog, {
      steps: STEPS.map(s => s.key),
      packages: PACKAGE_ORDER
    });
    assert.deepStrictEqual(problems, [], problems.join('\n      '));
  });

  await check('every screen an article claims is a screen this build renders', () => {
    const knownView = clientKnownView();
    const unknown = [];
    for (const article of catalog.articles) {
      for (const screen of article.screens || []) {
        if (!knownView(screen)) unknown.push(article.id + ' -> ' + screen);
      }
    }
    assert.deepStrictEqual(unknown, [],
      'the guide names screens the client cannot render: ' + unknown.join(', '));
  });

  await check('every article is reachable: it has an audience and either a screen or a link to it', () => {
    const linked = new Set();
    for (const article of catalog.articles) {
      for (const link of [...(article.next || []), ...(article.related || [])]) {
        linked.add(typeof link === 'string' ? link : link.article);
      }
      for (const term of catalog.glossary) if (term.article) linked.add(term.article);
    }
    const orphans = catalog.articles
      .filter(a => !(a.screens || []).length && !linked.has(a.id))
      .map(a => a.id);
    assert.deepStrictEqual(orphans, [],
      'these articles can only be found by searching: ' + orphans.join(', '));
  });

  await check('the ten initial articles the plan names are all present', () => {
    const required = [
      'first-sign-in', 'create-a-search', 'assemble-a-committee', 'submit-committee-input',
      'adopt-the-profile', 'research-and-sources', 'add-and-contact-candidates',
      'score-and-release', 'recover-unsaved-work', 'close-and-archive'
    ];
    const have = new Set(catalog.articles.map(a => a.id));
    const missing = required.filter(id => !have.has(id));
    assert.deepStrictEqual(missing, [], 'missing articles: ' + missing.join(', '));
  });

  await check('every role has at least one article written for it', () => {
    for (const role of schema.AUDIENCES) {
      const count = catalog.articles.filter(a => (a.audience || []).includes(role)).length;
      assert.ok(count > 0, 'no article is written for ' + role);
    }
  });

  await check('a screen with an article resolves to exactly one article', () => {
    const index = catalog.screenIndex();
    for (const [screen, id] of Object.entries(index)) {
      assert.ok(catalog.articles.some(a => a.id === id),
        'screen ' + screen + ' points at a missing article');
    }
  });

  await check('help.verify() refuses a catalog that names a step this build does not have', () => {
    const broken = {
      articles: [{
        ...catalog.articles[0],
        steps: ['a-step-that-does-not-exist']
      }],
      glossary: []
    };
    const problems = schema.validate(broken, { steps: STEPS.map(s => s.key), packages: PACKAGE_ORDER });
    assert.ok(problems.some(p => /a-step-that-does-not-exist/.test(p)),
      'a bad step key passed validation');
  });

  /* ---------------- The public projection ---------------- */

  await check('the candidate guide carries only candidate articles', () => {
    const view = help.publicCatalog();
    assert.ok(view.articles.length, 'the public guide is empty');
    for (const article of view.articles) {
      assert.deepStrictEqual(article.audience, ['candidate'],
        article.id + ' is in the public guide but is not written for candidates');
    }
  });

  await check('the candidate guide links nowhere the reader cannot follow', () => {
    const view = help.publicCatalog();
    const ids = new Set(view.articles.map(a => a.id));
    for (const article of view.articles) {
      for (const link of article.next || []) {
        assert.ok(ids.has(link.article || link),
          article.id + ' links out of the public guide');
      }
      for (const id of article.related || []) {
        assert.ok(ids.has(id), article.id + ' relates to an article the public guide does not have');
      }
    }
    for (const term of view.glossary) {
      assert.ok(ids.has(term.article), 'a public glossary term links out of the public guide');
    }
  });

  await check('no staff article leaks into the public projection, whatever it is called', () => {
    const view = help.publicCatalog();
    const staffOnly = catalog.articles.filter(a => !a.public).map(a => a.id);
    for (const id of staffOnly) {
      assert.ok(!view.articles.some(a => a.id === id), id + ' reached the public guide');
    }
  });

  await check('the projection carries a reviewed date and does not claim a verified release', () => {
    for (const view of [help.staffCatalog(), help.publicCatalog()]) {
      assert.ok(view.reviewed, 'no reviewed date');
      assert.ok(view.verificationNote, 'no statement about what the date means');
      if (!view.verifiedRelease) {
        assert.match(view.verificationNote, /No release has been walked through/,
          'the guide implies verification that has not happened');
      }
    }
  });

  /* ---------------- The routes ---------------- */

  await check('/api/public/help needs no session', async () => {
    const res = await fetch(BASE + '/api/public/help');
    assert.strictEqual(res.status, 200, 'the candidate guide required a sign-in');
    const body = await res.json();
    assert.ok(body.articles.length, 'the candidate guide came back empty');
    assert.ok(body.articles.every(a => a.audience.includes('candidate')));
  });

  await check('/api/help does need one', async () => {
    const res = await fetch(BASE + '/api/help');
    assert.ok(res.status === 401 || res.status === 403 || res.status === 503,
      'the staff guide was served without a session (' + res.status + ')');
  });

  /* ---------------- Content rules the plan sets ---------------- */

  await check('every article says who sees the result', () => {
    for (const article of catalog.articles) {
      assert.ok((article.whoSees || []).length,
        article.id + ' does not say who sees the result of following it');
    }
  });

  await check('every article offers a way out when something goes wrong', () => {
    for (const article of catalog.articles) {
      assert.ok((article.recovery || []).length, article.id + ' has no recovery guidance');
    }
  });

  await check('candidate articles never claim a receipt is a hiring status', () => {
    const text = JSON.stringify(catalog.articles.filter(a => a.public)).toLowerCase();
    assert.ok(/not a hiring status|is not a decision|does not mean/.test(text),
      'the candidate guide does not say what a receipt is not');

    // Every mention of a stage word has to be a denial. Checked by looking at
    // what comes just before it rather than by banning the words outright: the
    // article has to be able to say "it does not mean you are under review",
    // and a rule that forbade the phrase would forbid the correction too.
    const stages = /(under review|shortlisted|rejected|being reviewed)/g;
    for (const match of text.matchAll(stages)) {
      const before = text.slice(Math.max(0, match.index - 60), match.index);
      assert.ok(/\b(not|never|does not|is not|nor|neither)\b[^.]*$/.test(before),
        'the candidate guide states a hiring stage as fact: …' + before.slice(-50) + match[0]);
    }
  });

  process.exitCode = failed ? 1 : 0;
  console.log('Help: ' + passed + ' passed, ' + failed + ' failed.');
})();
