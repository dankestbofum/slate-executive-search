# What was implemented from the plan
September 16, 2026 · Branch `account-controls` · Node 22.18.0 locally; CI and production run Node 24.20.0

[Diagnostic](DIAGNOSTIC.md) · [Plan](IMPLEMENTATION_PLAN.md)

**Every code change in the plan is applied. Nothing that needs Render, Clerk, or a paid provider call is done, because none of those are reachable from here.** This file records which is which, so the plan's acceptance criteria can be read against something.

## Applied

| Plan step | Finding | What changed |
| --- | --- | --- |
| 2 | D02 | The awaited access check is bounded by the operation's remaining time (`op.guard` in [server/research-op.js](../../../server/research-op.js)). Cancellation, expiry, and the search's own state are re-checked after that await and in the same synchronous turn as the write ([server/research-jobs.js](../../../server/research-jobs.js)). `authorizeJob` now returns a `recheck()` that re-runs every store-readable check without re-opening an await ([server/index.js](../../../server/index.js)). |
| 2 | D02 | A job that is already terminal keeps the state it reached. A run that concluded after `cancel()` or after a restart sweep used to overwrite the record with the opposite outcome; it now attaches its findings and logs `research-job-terminal-conflict`. |
| 2, 3 | D03 | Cancel releases the page immediately and says "Cancellation requested", then reports what the server actually answered: cancelled, already saved, or outcome unknown. With no job id yet, the idempotency key is reconciled through a new read-only lookup (`GET /api/searches/:id/research-jobs?key=`) that cannot create work, and an operation found still running is then cancelled. |
| 3 | D04 | One terminal-job mapper (`researchTerminal`) serves both polling and re-opening a search, so a failure that happened while the tab was away is restored with its explanation, its support reference, and its retry eligibility. Dismissal is recorded per job id, so what has been dealt with stays dealt with and a later failure still appears. |
| 3 | D05 | Deadlines added for token acquisition, the facts save, the job acknowledgement, the cancellation acknowledgement, and the key lookup. They are separate from the operation deadline, and a request that times out is never reported as "nothing was saved" — the client tells "you stopped it", "the server said no", and "we never found out" apart. |
| 3 | D06 | One `researchEligibility()` decision, rendered by both Search facts and Community through `researchAction()`, and re-checked in the click handler. It covers role, search lifecycle, profile adoption, configured AI, and an operation already running. |
| 3 | — | Typed jurisdiction and website survive a failed attempt (`state.research.draft`), and a late answer from another search or workspace cannot repaint the current page. |
| 4 | D07 | `/api/ready` reports AI configuration, entitlement provenance, and **final research outcomes** separately. `degraded` now means "not known to be working" — no key, or a run of failures — never key presence alone. Research job outcomes are counted apart from provider calls, so a provider success that failed to save is not a success. AI state is still deliberately outside `ready`, so an Anthropic outage cannot make Render pull traffic. |
| 4 | D08 | Release identity has two independent sources and says which it used: `SLATE_RELEASE` (stamped into the image by CI) and `RENDER_GIT_COMMIT` (supplied by the host at runtime), with placeholder values rejected as no answer. A disagreement is reported on `/api/ready` and warned at boot — that is the exact condition the audit found, now confirmed below. [render.yaml](../../../render.yaml) explains why a hand-set `SLATE_RELEASE` is the trap. |
| 1 | D10 | The preflight reads configuration the way the application does, through the new [server/env.js](../../../server/env.js), and prints which source it read. It is copied into the image, so it can be run where it matters. Verified: it now finds the local key it previously reported missing. |

### Tests added

- [tests/research.js](../../../tests/research.js): 8 new checks — the save-phase bound, cancellation during the access check, expiry during the access check, an edit during the access check, a terminal state not being overwritten, and key reconciliation both in-process and over HTTP; plus readiness separating a configured key from research that works.
- [tests/research-ui.js](../../../tests/research-ui.js): new suite, 18 checks. It runs the real functions from `public/app.js` in an isolated context — the same technique the audit used to reproduce D03–D05 — and asserts the fixed behaviour.
- [tests/monitoring.js](../../../tests/monitoring.js): release identity says where it came from, and a placeholder build argument is not mistaken for a stamp.

### Verification run

- `npm test` — 0 failures (research 47 → 55 checks; research interface 18 new; monitoring 14 → 16).
- `npx playwright test --project=desktop-chrome` — 79 passed, including all 7 research specs.
- The audit's own backend reproduction, re-run unchanged: both scenarios now report `violationReproduced: false`, zero writes, and honest terminal states (`cancelled`, `failed`).
- The audit's UI reproduction script no longer runs against the current source, by design — `adoptResearchJob` delegates to the new mapper. `tests/research-ui.js` is its replacement as a living regression suite.
- Local Node is 22.18.0. The plan requires these regressions on 24.20.0; CI pins that version, so the run on this branch is the evidence, not this machine.

## D08 confirmed from the September 16, 20:58 UTC deploy log

The audit could prove only an inconsistency, not its cause. The deploy log settles it.

- **The stamp is not the running code.** The service booted reporting `Release: 16df65715938811ea650e0a82b0236ea2b694903`. That commit is the September 13 merge of PR #4, and it contains no `server/research-jobs.js` and no `server/research-op.js` — while the running service exposes research-job diagnostics and reports `schemaVersion: 6`. The deploy built `origin/main` at `060a0d8` (September 16), which does contain them.
- **Where the wrong value comes from.** Render's blueprint build passes no `SLATE_RELEASE` build argument, so the image's own value is the Dockerfile placeholder `unknown`. A full commit sha can therefore only have reached the process from a service-level `SLATE_RELEASE` environment variable — set once by hand, three days and two merges ago, and never updated since. That is the "`SLATE_RELEASE` override" the plan asked to inspect.
- **The deployment action:** delete the `SLATE_RELEASE` environment variable from the Render service. With it gone, the code now falls back to `RENDER_GIT_COMMIT` and reports the commit actually deployed. Until then, this build warns `release-identity-mismatch` at boot naming both values, and `/api/ready` reports `releaseIdentity.agrees: false`.
- **The log also caught a defect in the first version of this fix.** Treating `SLATE_RELEASE` as a stamp whenever it was non-empty would have read the image's literal `unknown` as a real answer and ignored the host's commit entirely. The rule now rejects placeholder values and lives in [server/env.js](../../../server/env.js) where it is unit-tested, including this exact deployment path.

Two other things in the same log match the audit and remain open: `off-volume copy NOT CONFIGURED` and `Alerts: NOT CONFIGURED` (D11). No `research-job-failed` event appears in the window, so D01 is no closer.

**This deploy does not contain any of the work above.** The build log lists nine layers, ending at `COPY scripts/container-persistence.js`; this branch adds a tenth (`COPY scripts/preflight.js`). The changes are committed nowhere yet.

## Not applied, and why

None of these are code. Each needs an account, a console, or a budget that is not available from here.

| Plan step | Finding | What it needs |
| --- | --- | --- |
| 1 | D01 | The Render log for the failed job, and the job record itself through a signed-in session. The cause of the 62-second failure is still unconfirmed, and no timeout was tuned — the plan makes tuning conditional on measurements, and there are none. |
| 1 | D08 | Reconciling the running image against `SLATE_RELEASE` in the Render dashboard. The code now reports the disagreement; clearing a stale variable is a console action. |
| 4 | D09, D12 | Renaming the Clerk application to Slate, standing up the production instance on an owned domain, mapping organizations and roles, then re-running the contrast check. |
| 4 | D11 | An off-volume backup destination and an alert recipient, plus a restore and delivery test. Both are still reported as `NOT CONFIGURED`, which is accurate. |
| 5 | — | Controlled staging research against a real city and county. That is a paid provider call and needs explicit authorization; this work made none. |

Until step 1 closes, the original failure remains unexplained. What changed is that the failure modes around it no longer produce wrong records or dishonest claims, and the next occurrence is diagnosable from the logs and `/api/ready` rather than from a key-presence check.
