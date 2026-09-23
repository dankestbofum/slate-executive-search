'use strict';

const crypto = require('crypto');

function offer(env = process.env) {
  const amount = Number(env.SLATE_PROJECT_AMOUNT_CENTS);
  const currency = String(env.SLATE_PROJECT_CURRENCY || 'usd').toLowerCase();
  const priceId = String(env.SLATE_PROJECT_STRIPE_PRICE_ID || '').trim();
  const version = String(env.SLATE_PROJECT_OFFER_VERSION || 'pilot-1').trim();
  const allowanceUsd = Number(env.SLATE_PROJECT_AI_ALLOWANCE_USD);
  const aiReservation = Number(env.SLATE_AI_RESERVATION_USD);
  const deploymentCeiling = Number(env.SLATE_AI_DEPLOYMENT_CEILING_USD);
  const mode = env.SLATE_PROJECT_BILLING_MODE || 'off';
  const configured = ['test', 'live'].includes(mode)
    && Number.isSafeInteger(amount) && amount > 0
    && /^[a-z]{3}$/.test(currency) && /^price_[A-Za-z0-9]+$/.test(priceId)
    && Number.isFinite(allowanceUsd) && allowanceUsd > 0
    && Number.isFinite(aiReservation) && aiReservation > 0 && aiReservation <= allowanceUsd
    && Number.isFinite(deploymentCeiling) && deploymentCeiling >= aiReservation
    && env.SLATE_OPUS_55_VERIFIED === '1'
    && Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET)
    && String(env.STRIPE_SECRET_KEY).startsWith(mode === 'test' ? 'sk_test_' : 'sk_live_')
    && String(env.STRIPE_WEBHOOK_SECRET).startsWith('whsec_');
  return { mode, version, name: 'Slate pilot search', amount, currency, priceId,
    capabilities: ['work', 'ai', 'publish'], allowanceUsd, configured };
}

function publicOffer(env = process.env) {
  const o = offer(env);
  return { mode: o.mode, version: o.version, name: o.name, amount: o.configured ? o.amount : null,
    currency: o.currency, allowanceUsd: o.configured ? o.allowanceUsd : null,
    configured: o.configured };
}

async function stripe(method, path, { body, idempotencyKey, env = process.env, fetcher = fetch } = {}) {
  if (!env.STRIPE_SECRET_KEY) throw new Error('Stripe is not configured.');
  const response = await fetcher('https://api.stripe.com/v1/' + path, {
    method, headers: {
      Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
    }, body: body ? new URLSearchParams(body).toString() : undefined,
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || 'Stripe could not complete the request.');
  return result;
}

function verifyWebhook(raw, header, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!Buffer.isBuffer(raw) || !secret || !header) return null;
  const parts = String(header).split(',').map(s => s.split('=').map(x => x.trim()));
  const stamp = Number(parts.find(([key]) => key === 't')?.[1]);
  if (!Number.isSafeInteger(stamp) || Math.abs(nowSeconds - stamp) > 300) return null;
  const expected = crypto.createHmac('sha256', secret).update(String(stamp) + '.').update(raw).digest();
  const valid = parts.filter(([key]) => key === 'v1').some(([,signature]) => {
    if (!/^[a-f0-9]{64}$/i.test(signature || '')) return false;
    const actual = Buffer.from(signature, 'hex');
    return crypto.timingSafeEqual(actual, expected);
  });
  if (!valid) return null;
  try { return JSON.parse(raw.toString('utf8')); } catch { return null; }
}

function create({ db, env = process.env, provider = stripe }) {
  function purchaseFor(search) {
    return db.db.projectPurchases.filter(p => p.searchId === search.id
      && p.organizationId === search.organizationId).at(-1) || null;
  }
  function publicPayment(search) {
    const p = purchaseFor(search);
    if (!p) return { state: search.paymentAccess === 'legacy' ? 'legacy' : 'unpaid', offer: publicOffer(env) };
    return { state: p.state, activationStatus: p.activationStatus, purchaseId: p.id,
      amount: p.offer.amount, currency: p.offer.currency, offerVersion: p.offer.version,
      allowanceUsd: p.offer.allowanceUsd, checkoutUrl: p.state === 'checkout-open' ? p.checkoutUrl : null,
      receiptUrl: p.receiptUrl || null, paidAt: p.paidAt || null };
  }
  async function checkout(search, origin) {
    if (search.paymentAccess === 'legacy') return { status: 409, code: 'LEGACY_SEARCH', error: 'This search has legacy access and is awaiting owner reconciliation.' };
    const o = offer(env);
    if (!o.configured) return { status: 503, code: 'OFFER_UNAVAILABLE', error: 'Project checkout is not configured yet.' };
    const existing = purchaseFor(search);
    if (existing?.activationStatus === 'active') return { status: 409, code: 'ALREADY_PAID', error: 'This search is already paid.' };
    if (existing && ['refunded', 'partially-refunded', 'disputed'].includes(existing.state)) {
      return { status: 409, code: 'PAYMENT_REVIEW', error: 'Contact support about this search’s payment before starting another checkout.' };
    }
    if (existing && ['checkout-open', 'processing'].includes(existing.state)) return { status: 200, payment: publicPayment(search), reused: true };
    let p = existing?.state === 'creating' ? existing : null;
    if (!p) {
      p = { id: db.nid('pay'), searchId: search.id, organizationId: search.organizationId,
        offer: { version: o.version, name: o.name, amount: o.amount, currency: o.currency,
          priceId: o.priceId, capabilities: o.capabilities, allowanceUsd: o.allowanceUsd },
        state: 'creating', activationStatus: 'inactive', createdAt: db.now(), updatedAt: db.now(),
        eventIds: [] };
      db.db.projectPurchases.push(p);
      db.persist();
    }
    const session = await provider('POST', 'checkout/sessions', { env,
      idempotencyKey: 'slate-checkout-' + p.id,
      body: { mode: 'payment', 'payment_method_types[0]': 'card',
        'line_items[0][price]': p.offer.priceId, 'line_items[0][quantity]': '1',
        client_reference_id: p.id, 'metadata[purchaseId]': p.id,
        'metadata[searchId]': p.searchId, 'metadata[organizationId]': p.organizationId,
        success_url: origin + '/?payment=return#/o/' + encodeURIComponent(search.organizationId) + '/s/' + encodeURIComponent(search.id) + '/billing',
        cancel_url: origin + '/?payment=cancel#/o/' + encodeURIComponent(search.organizationId) + '/s/' + encodeURIComponent(search.id) + '/billing' } });
    const current = db.findSearch(search.id);
    if (current !== search || current.organizationId !== p.organizationId || p.state !== 'creating') {
      return { status: 409, code: 'CHECKOUT_CHANGED', error: 'This search changed while checkout was starting.' };
    }
    if (!session.id || !session.url || session.mode !== 'payment' || session.client_reference_id !== p.id) {
      throw new Error('Stripe returned an incomplete checkout session.');
    }
    if (session.amount_total !== p.offer.amount || session.currency !== p.offer.currency) {
      await provider('POST', 'checkout/sessions/' + encodeURIComponent(session.id) + '/expire', { env }).catch(() => {});
      throw new Error('Stripe checkout price differs from the approved offer.');
    }
    p.checkoutSessionId = session.id;
    p.checkoutUrl = session.url;
    p.state = 'checkout-open'; p.updatedAt = db.now(); db.persist();
    return { status: 200, payment: publicPayment(search), reused: false };
  }
  async function reconcile(p, eventId = null) {
    if (!p?.checkoutSessionId) return false;
    const session = await provider('GET', 'checkout/sessions/' + encodeURIComponent(p.checkoutSessionId), { env });
    if (session.id !== p.checkoutSessionId || session.mode !== 'payment'
        || session.client_reference_id !== p.id || session.metadata?.purchaseId !== p.id
        || session.metadata?.searchId !== p.searchId || session.metadata?.organizationId !== p.organizationId
        || session.amount_total !== p.offer.amount || session.currency !== p.offer.currency) {
      throw new Error('Stripe checkout does not match the saved purchase.');
    }
    const search = db.findSearch(p.searchId);
    if (!search || search.organizationId !== p.organizationId) throw new Error('Purchased search is unavailable.');
    p.paymentIntentId = session.payment_intent || p.paymentIntentId || null;
    if (['refunded', 'partially-refunded', 'disputed'].includes(p.state)) {
      p.activationStatus = 'inactive';
    } else if (session.payment_status === 'paid') {
      p.state = 'paid'; p.activationStatus = 'active'; p.paidAt ||= db.now();
      if (p.paymentIntentId && !p.receiptUrl) {
        try {
          const intent = await provider('GET', 'payment_intents/' + encodeURIComponent(p.paymentIntentId) + '?expand[]=latest_charge', { env });
          if (intent.id === p.paymentIntentId && intent.amount === p.offer.amount
              && intent.currency === p.offer.currency && intent.status === 'succeeded'
              && /^https:\/\/pay\.stripe\.com\/receipts\//.test(intent.latest_charge?.receipt_url || '')) {
            p.receiptUrl = intent.latest_charge.receipt_url;
          }
        } catch { /* Payment remains valid; a later reconciliation can restore the receipt. */ }
      }
    } else if (session.status === 'expired') {
      p.state = 'expired'; p.activationStatus = 'inactive';
    } else if (session.status === 'complete') {
      p.state = 'processing'; p.activationStatus = 'inactive';
    } else {
      p.state = 'checkout-open'; p.activationStatus = 'inactive';
    }
    if (eventId && !p.eventIds.includes(eventId)) p.eventIds.push(eventId);
    p.updatedAt = db.now(); db.persist();
    return true;
  }
  async function handleEvent(event) {
    if (!event?.id || !event?.type) throw new Error('Invalid Stripe event.');
    if (db.db.stripeEvents.includes(event.id)) return false;
    const object = event.data?.object || {};
    let p = db.db.projectPurchases.find(row => row.checkoutSessionId === object.id
      || row.paymentIntentId === object.id || row.paymentIntentId === object.payment_intent
      || row.id === object.client_reference_id) || null;
    if (p && !p.checkoutSessionId && event.type.startsWith('checkout.session.')
        && object.client_reference_id === p.id && object.metadata?.purchaseId === p.id
        && object.metadata?.searchId === p.searchId && object.metadata?.organizationId === p.organizationId) {
      p.checkoutSessionId = object.id;
    }
    if (p?.checkoutSessionId && event.type.startsWith('checkout.session.')) await reconcile(p, event.id);
    if (p && ['charge.refunded', 'charge.dispute.created'].includes(event.type)) {
      p.state = event.type === 'charge.refunded'
        ? (object.amount_refunded >= object.amount ? 'refunded' : 'partially-refunded') : 'disputed';
      p.activationStatus = 'inactive'; p.updatedAt = db.now();
    }
    if (p && event.type === 'charge.succeeded' && p.state === 'paid'
        && object.payment_intent === p.paymentIntentId
        && /^https:\/\/pay\.stripe\.com\/receipts\//.test(object.receipt_url || '')) {
      p.receiptUrl = object.receipt_url;
    }
    db.db.stripeEvents.push(event.id);
    db.persist();
    return Boolean(p);
  }
  return { checkout, purchaseFor, publicPayment, reconcile, handleEvent };
}

module.exports = { offer, publicOffer, stripe, verifyWebhook, create };
