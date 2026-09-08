'use strict';

// Operator preflight for the AI configuration.
//
// The point is to replace an assumption with a check. A model ID in an
// environment variable is configuration; it is not evidence that this account
// can call that model. This asks the account.
//
//   node scripts/preflight.js
//
// It calls the Models API, which returns metadata and consumes no tokens, so
// it costs nothing to run. It deliberately does NOT generate anything: a real
// draft is a billed call and belongs in an explicitly authorised staging test,
// never in a routine check or in the test suite.
//
// Exits non-zero if anything required is missing or unavailable.

const Anthropic = require('@anthropic-ai/sdk');
const budget = require('../server/aibudget');

const WANTED = {
  CLAUDE_MODEL: process.env.CLAUDE_MODEL || 'claude-sonnet-5',
  CLAUDE_MODEL_PREMIUM: process.env.CLAUDE_MODEL_PREMIUM || 'claude-opus-5'
};

const tick = ok => (ok ? '  ok  ' : ' FAIL ');
let failed = false;

function report(ok, label, detail) {
  if (!ok) failed = true;
  console.log(tick(ok) + label + (detail ? ' — ' + detail : ''));
}

(async () => {
  console.log('Slate AI preflight\n');

  const key = String(process.env.ANTHROPIC_API_KEY || '').trim();
  report(Boolean(key), 'ANTHROPIC_API_KEY is set',
    key ? 'length ' + key.length : 'drafting and research will be unavailable');

  const limits = budget.limits();
  console.log('\nLimits in force:');
  console.log('  per search       ' + limits.perSearchCalls + ' calls');
  console.log('  per day          ' + limits.perDayCalls + ' calls, $' + limits.perDayUsd + ' estimated');
  console.log('  concurrent       ' + limits.concurrent);
  console.log('  request timeout  ' + limits.timeoutMs + ' ms');
  console.log('  retries          ' + limits.retries);
  console.log('\n  The timeout must sit inside the host\'s own request timeout. Past that the');
  console.log('  browser sees a gateway error while the call keeps running, and keeps billing.');

  if (!key) {
    console.log('\nNo key, so model entitlement was not checked.');
    console.log('Core search work does not depend on this: drafting is one feature, not the application.');
    process.exitCode = 1;
    return;
  }

  const client = new Anthropic({ apiKey: key, timeout: 30000, maxRetries: 1 });

  console.log('\nModel entitlement (Models API; no tokens consumed):');
  for (const [variable, id] of Object.entries(WANTED)) {
    try {
      const model = await client.models.retrieve(id);
      const priced = Object.hasOwn(budget.PRICES_PER_MTOK, model.id);
      report(true, variable + ' = ' + model.id, model.display_name || '');
      if (!priced) {
        console.log('       note: no price on file for this model, so cost estimates will read as unknown.');
      }
    } catch (error) {
      const status = error?.status ? ' (HTTP ' + error.status + ')' : '';
      if (error instanceof Anthropic.AuthenticationError) {
        report(false, variable + ' = ' + id, 'the API key was rejected' + status);
      } else if (error instanceof Anthropic.NotFoundError) {
        report(false, variable + ' = ' + id, 'this account cannot use that model, or the id is wrong' + status);
      } else {
        report(false, variable + ' = ' + id, (error?.message || 'unknown error') + status);
      }
    }
  }

  console.log('\nWhat this did NOT check:');
  console.log('  - Whether a draft or a research run actually succeeds. That is a billed call.');
  console.log('  - Latency or real cost under load.');
  console.log('  - Tool and effort compatibility in practice.');
  console.log('  Those need an explicitly authorised staging run against synthetic records.');

  if (failed) console.log('\nPreflight failed. Fix the items marked FAIL before relying on AI features.');
  else console.log('\nPreflight passed.');
  process.exitCode = failed ? 1 : 0;
})().catch(error => {
  console.error('Preflight could not complete: ' + (error?.message || error));
  process.exitCode = 1;
});
