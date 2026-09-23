'use strict';
const config = require('./playwright.audit.config.js');
// New searches use the proposed per-project gate. No offer or Stripe secret is
// supplied, so this rehearsal cannot open checkout or charge anything.
config.webServer.env.SLATE_PROJECT_BILLING_MODE = 'test';
module.exports = config;
