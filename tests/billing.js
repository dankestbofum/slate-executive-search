'use strict';
const assert = require('assert/strict');
const { configuration, create } = require('../server/billing');
const env = { SLATE_BILLING_MODE: 'test', CLERK_SECRET_KEY: 'sk_test_fixture', CLERK_PUBLISHABLE_KEY: 'pk_test_fixture' };
const fail = code => { throw { errors: [{ code, message: 'Provider secrets must not escape' }] }; };

(async () => {
  const migration = require('../docs/audits/2026-09-19-user-guidance-candidate-portal/CLERK_PLAN_MIGRATION.json');
  assert.deepEqual(migration.plans.map(p => p.name), ['Basic', 'Enhanced', 'Executive']);
  assert.deepEqual(migration.plans.map(p => p.features.length), [7, 13, 17]);
  assert.deepEqual(migration.plans.map(p => p.originalPriceRange), ['$3,500 to $5,000', '$7,500 to $12,500', '$15,000 to $25,000+']);
  for (const p of migration.plans) {
    assert.equal(p.amount, null, 'price ranges cannot be turned into invented checkout amounts');
    assert.equal(p.billingInterval, null);
    assert.equal(p.publish, false);
  }
  assert.equal(configuration({}).enabled, false);
  for (const patch of [{ SLATE_BILLING_MODE: 'typo' }, { SLATE_BILLING_MODE: 'live' }, { CLERK_PUBLISHABLE_KEY: 'pk_live_fixture' }]) {
    assert.equal(configuration({ ...env, ...patch }).enabled, false);
  }
  let reads = 0;
  const visible = { id: 'plan_public', name: 'Organization plan', publiclyVisible: true, forPayerType: 'org', fee: { amount: 1200, amountFormatted: '12.00', currency: 'USD', internal: 'secret' }, internal: 'secret' };
  const billing = create({ env, provider: {
    async getPlanList({ payerType, offset }) {
      assert.equal(payerType, 'org');
      reads++;
      return offset === 0
        ? { data: [visible, { ...visible, id: 'private', publiclyVisible: false }, { ...visible, id: 'personal', forPayerType: 'user' }], totalCount: 4 }
        : { data: [{ ...visible, id: 'second' }], totalCount: 4 };
    },
    async getOrganizationBillingSubscription(id) {
      assert.equal(id, 'org_verified');
      return { status: 'active', payerId: 'secret', subscriptionItems: [{ plan: visible, status: 'active', planPeriod: 'month', paymentSource: 'secret' }] };
    }
  } });
  const [catalog, same] = await Promise.all([billing.catalog(), billing.catalog()]);
  assert.deepEqual(catalog, same);
  assert.deepEqual(catalog.plans.map(p => p.id), ['plan_public', 'second']);
  assert.equal(reads, 2);
  await billing.catalog();
  assert.equal(reads, 2, 'catalog reads are cached');
  assert.ok(!JSON.stringify(catalog).includes('secret'));
  const subscription = await billing.subscription('org_verified');
  assert.equal(subscription.organizationId, 'org_verified');
  assert.ok(!JSON.stringify(subscription).includes('secret'));
  await assert.rejects(billing.subscription(null), /active organization/);
  for (const code of ['billing_not_enabled', 'api_error']) {
    const broken = create({ env, provider: { getPlanList: () => fail(code), getOrganizationBillingSubscription: () => fail(code) } });
    if (code === 'billing_not_enabled') {
      assert.equal((await broken.catalog()).status, 'not-enabled');
      assert.equal((await broken.subscription('org_verified')).status, 'not-enabled');
    } else {
      await assert.rejects(broken.catalog(), { message: 'Billing is temporarily unavailable. Please try again.', status: 503 });
      await assert.rejects(broken.subscription('org_verified'), { status: 503 });
    }
  }
  const missing = create({ env, provider: { getOrganizationBillingSubscription: () => fail('resource_not_found') } });
  assert.equal((await missing.subscription('org_verified')).subscription, null);
  const disabled = create({ env: {}, provider: new Proxy({}, { get() { throw new Error('Disabled billing contacted Clerk'); } }) });
  assert.equal((await disabled.catalog()).status, 'disabled');
  assert.equal((await disabled.subscription('org_verified')).status, 'disabled');

  if (process.env.SLATE_URL) {
    const sign = require('./identity').signer();
    const base = process.env.SLATE_URL;
    const get = (path, headers) => fetch(base + path, { headers });
    assert.equal((await get('/api/public/billing/plans')).status, 200);
    assert.equal((await get('/api/billing/subscription')).status, 401);
    assert.equal((await get('/api/billing/subscription', sign.headers('abe@slate.local'))).status, 200);
    assert.equal((await get('/api/billing/subscription', sign.headers('mike@slate.local', { org_role: 'org:admin' }))).status, 403, 'claimed administrator role cannot override verified membership');
    assert.equal((await get('/api/billing/subscription', sign.headers('outsider@example.test'))).status, 403);
    const page = await get('/subscriptions');
    assert.ok(page.headers.get('content-security-policy').includes('https://js.stripe.com'));
    assert.ok(page.headers.get('cache-control').includes('no-store'));
    for (const route of ['/', '/careers', '/apply/test']) {
      assert.ok(!(await get(route)).headers.get('content-security-policy').includes('stripe.com'));
    }
  }
  console.log('Billing configuration, privacy, provider failure, scope and authorization checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
