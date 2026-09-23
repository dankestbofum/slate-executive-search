'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const identity = require('./identity');

const fixture = identity.serverEnv();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-paid-access-'));
const env = { ...process.env, ...fixture.server,
  NODE_ENV:'test', HOST:'127.0.0.1', PORT:'0', DATA_DIR:dataDir,
  ANTHROPIC_API_KEY:'', SLATE_BILLING_MODE:'off',
  SLATE_PROJECT_BILLING_MODE:'test', SLATE_PROJECT_OFFER_VERSION:'pilot-test',
  SLATE_PROJECT_AMOUNT_CENTS:'45000', SLATE_PROJECT_CURRENCY:'usd',
  SLATE_PROJECT_STRIPE_PRICE_ID:'price_fixture123', SLATE_PROJECT_AI_ALLOWANCE_USD:'12',
  SLATE_AI_RESERVATION_USD:'2', SLATE_AI_DEPLOYMENT_CEILING_USD:'100',
  SLATE_OPUS_55_VERIFIED:'1', STRIPE_SECRET_KEY:'sk_test_fixture',
  STRIPE_WEBHOOK_SECRET:'whsec_fixture', SLATE_PUBLIC_URL:'https://slate.example',
  SLATE_EMAIL_ABE:'abe@slate.local', SLATE_EMAIL_MIKE:'mike@slate.local' };
const child = fork(path.join(__dirname, 'server.js'), [], {
  cwd:path.resolve(__dirname, '..'), env, stdio:['ignore','ignore','inherit','ipc'], windowsHide:true
});

(async () => {
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Paid access test server did not start.')), 15000);
    child.once('message', value => { clearTimeout(timer); resolve(value); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Paid access test server exited.')); });
  });
  const base = 'http://127.0.0.1:' + ready.port;
  process.env.SLATE_TEST_CLERK_KEY = fixture.privateKey;
  const org = await identity.bootstrapWorkspace(base, { owner:'abe@slate.local' });
  const sign = identity.signer();
  const headers = { ...sign.inOrg('abe@slate.local', org), 'content-type':'application/json' };
  const create = async name => {
    const res = await fetch(base + '/api/searches', { method:'POST', headers,
      body:JSON.stringify({ client:name, position:'City Manager', package:'executive' }) });
    assert.equal(res.status, 200);
    return res.json();
  };
  const first = await create('Pilot town');
  const second = await create('Second town');
  const details = await (await fetch(base + '/api/searches/' + first.id, { headers })).json();
  assert.equal(details.projectAccess.state, 'unpaid');
  assert.equal(details.projectPayment.state, 'unpaid');
  assert.equal((await (await fetch(base + '/api/searches/' + second.id + '/payment', { headers })).json()).state, 'unpaid');
  const draft = await fetch(base + '/api/searches/' + first.id, { method:'PATCH',
    headers:{ ...headers, 'if-match':String(details.revision) }, body:JSON.stringify({ notes:'Unpaid draft' }) });
  assert.equal(draft.status, 200, 'basic facts remain editable before payment');
  const revision = (await draft.json()).revision;
  for (const [method, route, body] of [
    ['POST', '/team/confirm', {}],
    ['POST', '/generate', { kind:'profile' }],
    ['POST', '/research-jobs', { city:'Pilot town', website:'https://example.gov' }]
  ]) {
    const res = await fetch(base + '/api/searches/' + first.id + route, { method,
      headers:{ ...headers, 'if-match':String(revision) }, body:JSON.stringify(body) });
    assert.equal(res.status, 402, route + ' must require project payment');
    assert.equal((await res.json()).code, 'PROJECT_PAYMENT_REQUIRED');
  }
  const missing = await fetch(base + '/api/searches/' + first.id + '/payment');
  assert.equal(missing.status, 401);
  console.log('Paid access: unpaid drafts, paid-work gates, separate projects, and authentication passed.');
})().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => child.kill());
