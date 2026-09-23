'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { create, verifyWebhook, publicOffer } = require('../server/project-billing');
const entitlements = require('../server/project-entitlements');

const env = {
  SLATE_PROJECT_BILLING_MODE: 'test', SLATE_PROJECT_OFFER_VERSION: 'pilot-1',
  SLATE_PROJECT_AMOUNT_CENTS: '45000', SLATE_PROJECT_CURRENCY: 'usd',
  SLATE_PROJECT_STRIPE_PRICE_ID: 'price_fixture123', SLATE_PROJECT_AI_ALLOWANCE_USD: '12',
  SLATE_AI_RESERVATION_USD:'2', SLATE_AI_DEPLOYMENT_CEILING_USD:'100', SLATE_OPUS_55_VERIFIED:'1',
  STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture'
};

(async () => {
  assert.equal(publicOffer({ ...env, SLATE_PROJECT_AMOUNT_CENTS: '' }).configured, false);
  assert.equal(publicOffer({ ...env, SLATE_PROJECT_BILLING_MODE: 'live' }).configured, false);
  const search = { id:'sr-one', organizationId:'org-one', paymentAccess:'unpaid' };
  const other = { id:'sr-two', organizationId:'org-one', paymentAccess:'unpaid' };
  const store = { projectPurchases:[], stripeEvents:[] };
  let saves = 0;
  const db = { db:store, nid:()=>'pay-one', now:()=>new Date().toISOString(),
    persist:()=>{ saves++; }, findSearch:id=>[search,other].find(s=>s.id===id) };
  const calls = [];
  let providerState = 'unpaid';
  const provider = async (method, path, args) => {
    calls.push({ method, path, args });
    if (path.startsWith('payment_intents/')) return { id:'pi_one', amount:45000,
      currency:'usd', status:'succeeded', latest_charge:{ receipt_url:'https://pay.stripe.com/receipts/test-one' } };
    if (method === 'POST') {
      assert.equal(args.body['line_items[0][price]'], env.SLATE_PROJECT_STRIPE_PRICE_ID);
      assert.equal(args.body['metadata[searchId]'], search.id);
      assert.equal(args.idempotencyKey, 'slate-checkout-pay-one');
      return { id:'cs_one', url:'https://checkout.stripe.com/c/pay/cs_one', mode:'payment',
        client_reference_id:'pay-one', amount_total:45000, currency:'usd' };
    }
    return { id:'cs_one', mode:'payment', client_reference_id:'pay-one',
      metadata:{ purchaseId:'pay-one', searchId:search.id, organizationId:search.organizationId },
      amount_total:45000, currency:'usd', payment_status:providerState,
      status:providerState === 'paid' ? 'complete' : 'open', payment_intent:'pi_one' };
  };
  const billing = create({ db, env, provider });
  assert.equal(entitlements.allows(search, store.projectPurchases, 'work'), false);
  const first = await billing.checkout(search, 'https://slate.example');
  assert.equal(first.payment.state, 'checkout-open');
  assert.equal(first.payment.amount, 45000);
  assert.equal(saves, 2, 'pending purchase and provider result are each durable');
  const repeat = await billing.checkout(search, 'https://slate.example');
  assert.equal(repeat.reused, true);
  assert.equal(calls.filter(c => c.method === 'POST').length, 1);
  assert.equal(entitlements.allows(other, store.projectPurchases, 'work'), false);
  await billing.reconcile(store.projectPurchases[0]);
  assert.equal(entitlements.allows(search, store.projectPurchases, 'work'), false,
    'a complete checkout with unpaid funds grants nothing');
  providerState = 'paid';
  const event = { id:'evt_paid', type:'checkout.session.async_payment_succeeded',
    data:{ object:{ id:'cs_one', client_reference_id:'pay-one' } } };
  assert.equal(await billing.handleEvent(event), true);
  assert.equal(await billing.handleEvent(event), false);
  assert.equal(store.stripeEvents.length, 1);
  assert.equal(entitlements.allows(search, store.projectPurchases, 'work'), true);
  assert.equal(billing.publicPayment(search).receiptUrl, 'https://pay.stripe.com/receipts/test-one');
  assert.equal(entitlements.allows(other, store.projectPurchases, 'work'), false);
  assert.equal((await billing.checkout(search, 'https://slate.example')).code, 'ALREADY_PAID');
  await billing.handleEvent({ id:'evt_refund', type:'charge.refunded',
    data:{ object:{ payment_intent:'pi_one', amount:45000, amount_refunded:45000 } } });
  assert.equal(entitlements.allows(search, store.projectPurchases, 'work'), false);
  await billing.handleEvent({ id:'evt_late', type:'checkout.session.completed',
    data:{ object:{ id:'cs_one' } } });
  assert.equal(entitlements.allows(search, store.projectPurchases, 'work'), false,
    'a reordered completion cannot undo a refund');

  const raw = Buffer.from(JSON.stringify(event));
  const stamp = Math.floor(Date.now()/1000);
  const sig = crypto.createHmac('sha256', env.STRIPE_WEBHOOK_SECRET)
    .update(String(stamp) + '.').update(raw).digest('hex');
  assert.deepEqual(verifyWebhook(raw, `t=${stamp},v1=${sig}`, env.STRIPE_WEBHOOK_SECRET), event);
  assert.deepEqual(verifyWebhook(raw, `t=${stamp},v1=${'0'.repeat(64)},v1=${sig}`, env.STRIPE_WEBHOOK_SECRET), event);
  assert.equal(verifyWebhook(Buffer.from('{}'), `t=${stamp},v1=${sig}`, env.STRIPE_WEBHOOK_SECRET), null);
  assert.equal(verifyWebhook(raw, `t=${stamp-400},v1=${sig}`, env.STRIPE_WEBHOOK_SECRET), null);
  console.log('Project billing: checkout reuse, payment verification, scope, refund ordering, and signatures passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
