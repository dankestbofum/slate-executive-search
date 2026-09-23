'use strict';
const assert = require('node:assert/strict');
const { create } = require('../server/ai-allowance');
const { estimateCost } = require('../server/aibudget');

const search = { id:'sr-paid', organizationId:'org-a', paymentAccess:'unpaid' };
const store = { projectPurchases:[{ id:'pay-1', searchId:'sr-paid', organizationId:'org-a',
  activationStatus:'active', offer:{ capabilities:['work','ai'], allowanceUsd:3 } }], aiReservations:[] };
let saves = 0;
const db = { db:store, now:()=>new Date().toISOString(), persist:()=>{ saves++; } };
const allowance = create({ db, env:{ SLATE_AI_RESERVATION_USD:'2', SLATE_AI_DEPLOYMENT_CEILING_USD:'2.5' } });
assert.equal(allowance.reserve(search, 'op-1', 'research').ok, true);
assert.equal(allowance.reserve(search, 'op-2', 'research').code, 'AI_ALLOWANCE_EXHAUSTED');
allowance.settle('op-1', 'claude-opus-5-5', { input_tokens:1000, output_tokens:500,
  cache_read_input_tokens:1000, cache_creation_input_tokens:1000,
  server_tool_use:{ web_search_requests:2 } }, true);
assert.equal(store.aiReservations[0].state, 'settled');
assert.ok(store.aiReservations[0].actualUsd > 0.02, 'search charges must be counted');
assert.equal(allowance.reserve(search, 'op-2', 'draft').ok, true);
allowance.settle('op-2', null, null, true);
assert.equal(store.aiReservations[1].state, 'unknown');
assert.equal(allowance.reserve(search, 'op-3', 'draft').code, 'AI_ALLOWANCE_EXHAUSTED');
assert.ok(saves >= 2);
assert.equal(estimateCost('claude-opus-5-5', { input_tokens:1000000, output_tokens:1000000,
  cache_read_input_tokens:1000000, cache_creation_input_tokens:1000000 }).usd, 29.2);
console.log('AI allowance: reservations, settlement, unknown usage, and Opus 5.5 cost categories passed.');
