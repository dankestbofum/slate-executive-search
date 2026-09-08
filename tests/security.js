'use strict';

// DEP-03 acceptance evidence: the HTTP boundary. Runs against the isolated
// server started by tests/run.js, with synthetic accounts and records.
//
// These are protocol-level checks. They demonstrate that the server sends the
// right headers and refuses the right requests; they do not demonstrate that a
// real browser enforces them, which needs the browser coverage in DEP-12.

const assert = require('assert');
const http = require('../server/http');

const BASE = process.env.SLATE_URL || 'http://127.0.0.1:4173';
let passed = 0;
let failed = 0;

async function check(name, fn) {
  try { await fn(); passed += 1; console.log('PASS  Security: ' + name); }
  catch (error) { failed += 1; console.error('FAIL  Security: ' + name + '\n      ' + error.message); }
}

async function login(email, pin) {
  const res = await fetch(BASE + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, pin })
  });
  assert.strictEqual(res.status, 200, 'login for ' + email + ' returned ' + res.status);
  return res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
}

(async () => {
  const cookie = await login('abe@slate.local', '2468');
  const json = { 'Content-Type': 'application/json' };

  // Search mutations carry the revision they were made against, so these
  // helpers read it first rather than hard-coding a value that goes stale.
  async function newSearch(client) {
    const res = await fetch(BASE + '/api/searches', {
      method: 'POST', headers: { ...json, cookie },
      body: JSON.stringify({ client, position: 'County Administrator' })
    });
    assert.strictEqual(res.status, 200, 'could not create "' + client + '": ' + res.status);
    const body = await res.json();
    const id = body.id || body.search?.id;
    assert.ok(id, 'no search id in the create response');
    return id;
  }

  async function post(id, path, body) {
    const current = await fetch(BASE + '/api/searches/' + id, { headers: { cookie } });
    const revision = String((await current.json()).revision);
    return fetch(BASE + '/api/searches/' + id + path, {
      method: 'POST',
      headers: { ...json, cookie, 'if-match': revision },
      body: JSON.stringify(body)
    });
  }

  /* ---------------- Response headers ---------------- */

  await check('every response carries the security headers', async () => {
    const res = await fetch(BASE + '/api/health');
    assert.match(res.headers.get('content-security-policy') || '', /default-src 'self'/);
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(res.headers.get('x-frame-options'), 'DENY');
    assert.strictEqual(res.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.match(res.headers.get('permissions-policy') || '', /camera=\(\)/);
  });

  await check('the policy allows no inline script, eval, or third-party origin', async () => {
    const res = await fetch(BASE + '/');
    const csp = res.headers.get('content-security-policy') || '';
    assert.doesNotMatch(csp, /unsafe-inline/, 'CSP permits inline code');
    assert.doesNotMatch(csp, /unsafe-eval/, 'CSP permits eval');
    assert.doesNotMatch(csp, /https?:\/\//, 'CSP allow-lists an external origin');
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /base-uri 'none'/);
  });

  await check('static pages are not framable and do not sniff', async () => {
    const res = await fetch(BASE + '/app.js');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(res.headers.get('x-frame-options'), 'DENY');
  });

  await check('the stack does not advertise itself', async () => {
    const res = await fetch(BASE + '/api/health');
    assert.strictEqual(res.headers.get('x-powered-by'), null);
  });

  await check('responses carry a correlation id', async () => {
    const res = await fetch(BASE + '/api/health');
    assert.match(res.headers.get('x-request-id') || '', /^[a-f0-9]{16}$/);
  });

  /* ---------------- Fonts are first-party ---------------- */

  await check('no page requests a third-party font', async () => {
    for (const path of ['/', '/apply/whatever-token']) {
      const body = await (await fetch(BASE + path)).text();
      assert.doesNotMatch(body, /fonts\.googleapis\.com/, path + ' still links Google Fonts');
      assert.doesNotMatch(body, /fonts\.gstatic\.com/, path + ' still preconnects to Google');
    }
  });

  await check('the vendored stylesheet is served from this origin', async () => {
    const res = await fetch(BASE + '/fonts/fonts.css');
    assert.strictEqual(res.status, 200);
    const css = await res.text();
    assert.match(css, /@font-face/);
    assert.doesNotMatch(css, /https?:\/\//, 'vendored CSS still points off-origin');
  });

  /* ---------------- Bearer-link privacy ---------------- */

  await check('candidate pages send no referrer and are never cached', async () => {
    const res = await fetch(BASE + '/apply/some-token');
    assert.strictEqual(res.headers.get('referrer-policy'), 'no-referrer');
    assert.match(res.headers.get('cache-control') || '', /no-store/);
  });

  await check('ordinary pages keep a referrer policy too', async () => {
    const res = await fetch(BASE + '/');
    assert.strictEqual(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  });

  await check('candidate tokens are redacted from log paths', () => {
    assert.strictEqual(http.safePath('/apply/abc123def'), '/apply/:token');
    assert.strictEqual(http.safePath('/api/apply/abc123def'), '/api/apply/:token');
    assert.strictEqual(http.safePath('/media/s1/cover.jpg'), '/media/:id/cover.jpg');
    assert.strictEqual(http.safePath('/api/searches/s1?token=x'), '/api/searches/s1');
  });

  await check('secrets are redacted from diagnostic objects', () => {
    const out = http.redact({ pin: '2468', invite: 'tok', email: 'a@b.c', Authorization: 'Bearer x' });
    assert.strictEqual(out.pin, '[redacted]');
    assert.strictEqual(out.invite, '[redacted]');
    assert.strictEqual(out.Authorization, '[redacted]');
    assert.strictEqual(out.email, 'a@b.c', 'redaction should not blank ordinary fields');
  });

  /* ---------------- Same-origin enforcement ---------------- */

  await check('a cross-origin mutation is refused', async () => {
    const res = await fetch(BASE + '/api/searches', {
      method: 'POST',
      headers: { ...json, cookie, Origin: 'https://evil.example' },
      body: JSON.stringify({ client: 'Cross Origin County', position: 'County Administrator' })
    });
    assert.strictEqual(res.status, 403, 'expected 403, got ' + res.status);
  });

  await check('a browser-labelled cross-site mutation is refused', async () => {
    const res = await fetch(BASE + '/api/searches', {
      method: 'POST',
      headers: { ...json, cookie, 'Sec-Fetch-Site': 'cross-site' },
      body: JSON.stringify({ client: 'Sec Fetch County', position: 'County Administrator' })
    });
    assert.strictEqual(res.status, 403, 'expected 403, got ' + res.status);
  });

  await check('login itself is protected from cross-origin submission', async () => {
    const res = await fetch(BASE + '/api/login', {
      method: 'POST',
      headers: { ...json, Origin: 'https://evil.example' },
      body: JSON.stringify({ email: 'abe@slate.local', pin: '2468' })
    });
    assert.strictEqual(res.status, 403, 'expected 403, got ' + res.status);
  });

  await check('a same-origin mutation still works', async () => {
    const origin = new URL(BASE).origin;
    const res = await fetch(BASE + '/api/searches', {
      method: 'POST',
      headers: { ...json, cookie, Origin: origin, 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify({ client: 'Same Origin County', position: 'County Administrator' })
    });
    assert.strictEqual(res.status, 200, 'expected 200, got ' + res.status);
  });

  await check('reads are not blocked by the origin check', async () => {
    const res = await fetch(BASE + '/api/searches', { headers: { cookie, Origin: 'https://evil.example' } });
    assert.strictEqual(res.status, 200);
  });

  /* ---------------- Request body boundaries ---------------- */

  await check('malformed JSON returns a clear 400, not a stack trace', async () => {
    const res = await fetch(BASE + '/api/searches', {
      method: 'POST', headers: { ...json, cookie }, body: '{"client": '
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /valid JSON/);
    assert.ok(body.ref, 'a support reference should be returned');
    assert.doesNotMatch(JSON.stringify(body), /at Object|node:internal/, 'internals leaked to the client');
  });

  await check('ordinary endpoints refuse an upload-sized body', async () => {
    const res = await fetch(BASE + '/api/searches', {
      method: 'POST',
      headers: { ...json, cookie },
      body: JSON.stringify({ client: 'x'.repeat(400 * 1024), position: 'County Administrator' })
    });
    assert.strictEqual(res.status, 413, 'expected 413, got ' + res.status);
  });

  /* ---------------- Input bounds ---------------- */

  await check('candidate fields are bounded', async () => {
    const id = await newSearch('Bounds County');
    const add = body => post(id, '/candidates', body);

    assert.strictEqual((await add({ name: 'x'.repeat(500) })).status, 400, 'an over-long name was accepted');
    assert.strictEqual((await add({ name: 'Real Person', org: 'y'.repeat(500) })).status, 400, 'an over-long org was accepted');
    assert.strictEqual((await add({ name: 'Real Person', email: 'not an email' })).status, 400, 'a malformed email was accepted');
    assert.strictEqual((await add({ name: 'Real Person', yrs: 5000 })).status, 400, 'an absurd tenure was accepted');
    assert.strictEqual((await add({ name: '' })).status, 400, 'a nameless candidate was accepted');
    assert.strictEqual((await add({ name: 'Dana Ruiz', org: 'Example County', email: 'dana@example.gov', yrs: 12 })).status, 200,
      'a valid candidate was refused');
  });

  await check('candidate markup is never served as active content', async () => {
    const id = await newSearch('Escaping County');
    const payload = '<img src=x onerror=alert(1)>';
    const res = await post(id, '/candidates', { name: payload });
    assert.strictEqual(res.status, 200);

    // Storing the characters verbatim is correct: escaping belongs at render
    // time, and the renderer is covered by the integrity suite. What matters
    // here is that the transport can never be treated as a document. A JSON
    // content type plus nosniff means a browser will not parse this as HTML
    // even if the payload is echoed back inside it.
    assert.match(res.headers.get('content-type') || '', /application\/json/);
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');

    const stored = (await res.json()).candidates?.find(c => c.name === payload);
    assert.ok(stored, 'the candidate did not round-trip intact');
  });

  /* ---------------- Outbound request safety ---------------- */

  await check('research refuses private, reserved and malformed addresses', async () => {
    const id = await newSearch('SSRF County');

    for (const website of [
      'http://127.0.0.1:4173/api/searches',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.1/',
      'http://192.168.1.1/',
      'http://[::1]/',
      'file:///etc/passwd',
      'gopher://example.com/',
      'not a url at all'
    ]) {
      const res = await post(id, '/research', { website });
      assert.ok(res.status >= 400, website + ' was accepted (' + res.status + ')');
      const text = await res.text();
      assert.doesNotMatch(text, /"seq"|"searches"/, website + ' appears to have been fetched');
    }
  });

  /* ---------------- Access boundaries ---------------- */

  await check('private media requires a session', async () => {
    const res = await fetch(BASE + '/media/s1/cover.jpg');
    assert.ok(res.status === 401 || res.status === 403 || res.status === 404,
      'unauthenticated media returned ' + res.status);
  });

  await check('media path traversal is refused', async () => {
    for (const file of ['..%2f..%2fslate.json', '....//slate.json', 'cover.jpg%00.txt']) {
      const res = await fetch(BASE + '/media/s1/' + file, { headers: { cookie } });
      assert.ok(res.status >= 400, file + ' returned ' + res.status);
    }
  });

  await check('an unknown api route does not return the app shell', async () => {
    const res = await fetch(BASE + '/api/not-a-real-route', { headers: { cookie } });
    assert.ok(res.status >= 400, 'expected an error status, got ' + res.status);
    const body = await res.text();
    assert.doesNotMatch(body, /<div id="app">/, 'the SPA shell was served for an unknown API route');
  });

  await check('api responses are never stored by the browser', async () => {
    const res = await fetch(BASE + '/api/searches', { headers: { cookie } });
    assert.match(res.headers.get('cache-control') || '', /no-store/);
  });

  /* ---------------- Service worker ---------------- */

  await check('the service worker never caches private paths', async () => {
    const sw = await (await fetch(BASE + '/sw.js')).text();
    for (const path of ['/api/', '/media/', '/apply/']) {
      assert.ok(sw.includes(path), 'sw.js no longer bypasses ' + path);
    }
    const shell = sw.slice(sw.indexOf('SHELL_ASSETS'), sw.indexOf(']', sw.indexOf('SHELL_ASSETS')));
    for (const path of ['/api', '/media', '/apply']) {
      assert.ok(!shell.includes("'" + path), path + ' is pre-cached in the shell');
    }
  });

  console.log(passed + ' security checks passed' + (failed ? ', ' + failed + ' failed' : '') + '.');
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
