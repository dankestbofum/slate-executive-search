'use strict';

const entitlements = require('./project-entitlements');
const budget = require('./aibudget');

function create({ db, env = process.env }) {
  function reserve(search, id, kind) {
    if (search.paymentAccess === 'legacy') return { ok:true, legacy:true };
    const access = entitlements.status(search, db.db.projectPurchases);
    if (access.state !== 'paid' || !access.capabilities.includes('ai')) {
      return { ok:false, status:402, code:'PROJECT_PAYMENT_REQUIRED', error:'Complete this search’s project payment before using AI.' };
    }
    const amount = Number(env.SLATE_AI_RESERVATION_USD);
    const deployment = Number(env.SLATE_AI_DEPLOYMENT_CEILING_USD);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(deployment) || deployment <= 0) {
      return { ok:false, status:503, code:'AI_ALLOWANCE_NOT_CONFIGURED', error:'AI allowance is not configured for paid searches.' };
    }
    const existing = db.db.aiReservations.find(r => r.id === id);
    if (existing) return existing.searchId === search.id ? { ok:true, reused:true } :
      { ok:false, status:409, code:'AI_OPERATION_CONFLICT', error:'That AI operation belongs to another search.' };
    const committed = r => r.state === 'settled' ? r.actualUsd : r.state === 'released' ? 0 : r.reservedUsd;
    const forSearch = db.db.aiReservations.filter(r => r.searchId === search.id).reduce((sum,r) => sum + committed(r),0);
    const total = db.db.aiReservations.reduce((sum,r) => sum + committed(r),0);
    if (forSearch + amount > access.allowanceUsd || total + amount > deployment) {
      return { ok:false, status:429, code:'AI_ALLOWANCE_EXHAUSTED', error:'The AI allowance for this search or deployment is exhausted.' };
    }
    db.db.aiReservations.push({ id, searchId:search.id, organizationId:search.organizationId,
      kind, reservedUsd:amount, actualUsd:null, state:'reserved', createdAt:db.now() });
    return { ok:true };
  }
  function settle(id, model, usage, attempted = true) {
    const row = db.db.aiReservations.find(r => r.id === id);
    if (!row || row.state !== 'reserved') return;
    const estimate = usage ? budget.estimateCost(model, usage) : null;
    if (!attempted) { row.state = 'released'; row.actualUsd = 0; }
    else if (estimate?.known && usage) { row.state = 'settled'; row.actualUsd = estimate.usd; }
    else { row.state = 'unknown'; }
    row.updatedAt = db.now();
    db.persist();
  }
  return { reserve, settle };
}

module.exports = { create };
