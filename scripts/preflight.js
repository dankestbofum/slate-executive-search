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
//
// It reads configuration the way the application does, through server/env.js:
// a local .env in development, the platform's own environment in production.
// Before that it read bare process.env, so on a developer's machine it
// reported no API key while `npm run dev` two terminals away had one — a
// diagnostic that disagreed with the thing it was diagnosing (D10).

const Anthropic = require('@anthropic-ai/sdk');
const env = require('../server/env');
const loaded = env.loadLocalEnv();
const budget = require('../server/aibudget');

const WANTED = {
  CLAUDE_MODEL: 'claude-opus-5-5',
  CLAUDE_MODEL_PREMIUM: 'claude-opus-5-5'
};

const tick = ok => (ok ? '  ok  ' : ' FAIL ');
let failed = false;

function report(ok, label, detail) {
  if (!ok) failed = true;
  console.log(tick(ok) + label + (detail ? ' — ' + detail : ''));
}

(async () => {
  console.log('Slate AI preflight\n');

  // Which configuration this run is reporting on. Without this line a FAIL
  // below is ambiguous: it could be a missing key or a key the check never
  // looked for.
  console.log('Configuration source: ' + (loaded.loaded
    ? loaded.path + ' (' + loaded.keys + ' variable(s)), over the process environment'
    : loaded.reason === 'production'
      ? 'the deployment environment (NODE_ENV=production; a local .env is ignored here, by design)'
      : loaded.reason === 'test'
        ? 'the process environment (NODE_ENV=test)'
        : 'the process environment only — ' + loaded.path + ' was not read'
          + (loaded.error ? ' (' + loaded.error + ')' : '')));
  console.log('Node ' + process.versions.node + '; NODE_ENV=' + (process.env.NODE_ENV || 'unset') + '\n');

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

  /* --------------------------------------------------------------------- *
   * The public portal
   *
   * Not a pass or a fail: all three of these are legitimately off, and a
   * deployment that only advertises jobs never needs them. But an operator
   * about to publish a posting should be told what an applicant will actually
   * be able to do, before somebody finds out by trying to apply.
   * --------------------------------------------------------------------- */
  const mailer = require('../server/mailer');
  const files = require('../server/application-files');

  console.log('\nPublic careers portal');
  const mail = mailer.status();
  console.log('  ' + (mail.configured ? ' ok  ' : ' off ') + 'Mail transport: ' + mail.transport);
  console.log('        ' + mail.note);
  const uploads = files.uploadsEnabled();
  console.log('  ' + (uploads ? ' ok  ' : ' off ') + 'Application uploads: ' + (uploads ? 'on' : 'off'));
  const scanner = files.scannerStatus();
  console.log('  ' + (scanner.scans ? ' ok  ' : ' off ') + 'File scanner: ' + scanner.scanner);
  console.log('        ' + scanner.note);
  if (!mail.configured) {
    console.log('        A posting will publish as a readable advertisement with its support');
    console.log('        contact, and will not offer an application form.');
  }

  console.log('\nWhat this did NOT check:');
  console.log('  - Whether mail is actually delivered. That needs a controlled recipient.');
  console.log('  - Whether a draft or a research run actually succeeds. That is a billed call.');
  console.log('  - Latency or real cost under load.');
  console.log('  - Tool and effort compatibility in practice.');
  console.log('  Those need an explicitly authorised staging run against synthetic records.');
  console.log('\n  To check the deployment rather than a laptop, run this inside the running');
  console.log('  service (the image carries it), so it reads the same environment the app does.');

  if (failed) console.log('\nPreflight failed. Fix the items marked FAIL before relying on AI features.');
  else console.log('\nPreflight passed.');
  process.exitCode = failed ? 1 : 0;
})().catch(error => {
  console.error('Preflight could not complete: ' + (error?.message || error));
  process.exitCode = 1;
});
