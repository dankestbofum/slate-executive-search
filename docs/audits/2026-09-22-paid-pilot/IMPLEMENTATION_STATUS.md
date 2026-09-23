# Paid pilot implementation status

Updated September 22, 2026. This record tracks the implementation against [the plan](IMPLEMENTATION_PLAN.md); it is not a launch approval.

## Implemented locally

- One-time, search-scoped Stripe Checkout design with persisted purchases, immutable offer snapshots, stable checkout idempotency keys, raw signed webhook handling, event deduplication, authoritative session reconciliation, receipt recovery, and a bounded restart sweep. Refunds and disputes suspend new paid work while retaining records.
- Separate workflow choice and payment entitlement. New searches created with project billing enabled are unpaid drafts; existing searches are marked legacy. Backend mutation, AI, publishing, and queued research checks enforce project access. Administrators buy; consultants can prepare drafts.
- Public search pricing and project payment screens, a `/subscriptions` compatibility redirect, a home control, desktop rail collapse, and a keyboard operable public menu. The Clerk subscription table is removed from the buyer journey.
- Requested `claude-opus-5-5` identifier in drafting and research, explicit effort, a versioned published API price table including prompt-cache and web-search categories, and durable AI reservations against project and deployment limits.
- Bounded official-site retrieval with PDF extraction, link ranking, evidence and result reuse, one structured core extraction call with at most one repair, field-level citations and selected-field review. Optional 2024 ACS population evidence is enabled by `SLATE_CENSUS_API_KEY`.

## Verified locally

- `npm.cmd run check` parses 113 files with no failures.
- `node tests/run.js` exited 0, including payment, access, allowance, retrieval, Census, research, and existing regression suites.
- The desktop Chrome pricing and welcome assertions passed in the local browser fixture. The Playwright runner did not return a final process exit in this Windows session after reporting completed tests, so the browser suite needs a clean CI run.
- `node scripts/preflight.js` found a local Anthropic key, but the Models API check returned a connection error. No paid model call was made.

## Required before test-mode purchase or pilot launch

1. Owner approves the exact search fee, Stripe Price ID, project AI allowance, per-operation reservation, deployment ceiling, payer/refund policy, and treatment of legacy searches. Set the matching `SLATE_PROJECT_*` and `SLATE_AI_*` variables together.
2. Verify that the Anthropic account can access `claude-opus-5-5` and that the deployed SDK calls for drafting, structured extraction, and deeper research work. Set `SLATE_OPUS_55_VERIFIED=1` only after verification.
3. Configure a Stripe **test** account, webhook secret, and public URL. Exercise a hosted test checkout, declined card, duplicate and delayed events, refunds/disputes, receipt, browser-close return, and restart recovery. Then change `SLATE_PROJECT_BILLING_MODE` from `off` to `test`.
4. Run the 12-jurisdiction cold/warm research benchmark and compare source accuracy, model tokens, actual billed usage, cost, and p95 latency against the plan targets. Confirm the Census key and source dates if population lookup is in scope.
5. Run Node 24 CI and the full desktop Chrome, WebKit, and mobile browser suite on the exact release. Complete the hosted Clerk/Stripe role walkthrough, backup restore, alert exercise, and load envelope from the plan before enabling live payments.

The current deployment blueprint keeps project checkout off and the model verification flag at zero. Local tests use synthetic identities and Stripe fixtures; they do not prove provider entitlement, live charges, hosted performance, or operational recovery.
