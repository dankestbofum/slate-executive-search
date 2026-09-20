# Slate website diagnostic
September 16, 2026, America/Phoenix · Evidence captured September 17, approximately 03:09–03:19 UTC

Target: [Slate home](https://slate-executive-search.onrender.com/#/home). The user identified **Research a city or county** as the failing action. This audit combined an independent agent's API/backend investigation with live public UI inspection and isolated execution of the current interface code.

**The web API is responding. A failed AI operation is recorded, and research recovery and cancellation have reproducible defects.** The approximately 62-second failure is consistent with the configured 60-second model-round timeout, but its exact cause remains unconfirmed without the affected job's failure detail or Render log. There was one recorded call, so the observed failure rate is not an estimate of long-term reliability.

[Implementation plan](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/docs/audits/2026-09-16-website-audit/IMPLEMENTATION_PLAN.md>) · [Fresh endpoint evidence](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/docs/audits/2026-09-16-website-audit/api-evidence.json>)

## What the live service returned

| Check | Fresh result | Interpretation |
| --- | --- | --- |
| `/api/health` | 200; `ok: true`; Node 24.20.0 | Process responds. |
| `/api/ready` | 200; `ready: true`; storage writable | Core readiness passes. |
| `/api/config` | 200; authentication configured | Public configuration loads. |
| `/api/me`, `/api/searches` without sign-in | 401 with sign-in explanation | Expected access control; not an API failure. |
| AI metrics | 1 call, 1 failure, 62,211 ms average | One real failure is recorded. |
| Usage of failed call | Unknown; zero reported tokens | Does not establish zero provider cost. |
| Research jobs | Enabled; 1 retained, 0 running, 0 queued | No active queue backlog at inspection. |
| Research limits | 180 s overall; 25 s crawl; 60 s per model round; 4 rounds; 0 research SDK retries | A round may fail before the total budget is exhausted. |
| AI indicator | Configured and not degraded | Only checks key presence, not successful research. |
| Authentication | Development instance | Matches the live “Development mode” label. |

## Prioritized findings

P1 means address before relying on the research workflow. P2 means a material reliability, usability, or launch-readiness issue. P3 means lower-priority polish. “Local reproduction” does not mean the condition was exercised against production.

**D01 · P1 · Research failure recorded; exact cause unresolved — live evidence.**  
The only AI operation in the exposed metrics failed after 62.211 seconds. The 60-second provider-round limit is the leading hypothesis, not a confirmed diagnosis. The provider stream is bounded in [server/ai.js](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/server/ai.js:149>); a first-round timeout can terminate the work without using the remaining overall budget. The page-only fallback at [runResearch](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/server/ai.js:1085>) handles tool-unavailability conditions rather than every timeout. Invalid credentials, entitlement, network failure, and provider errors need to be separated using the actual error code. Public metrics do not identify the user's exact operation.

**D02 · P1 · Cancelled or expired research can still be saved — local backend reproduction.**  
The job checks cancellation, then awaits a fresh authorization check. If Cancel or the operation deadline occurs during that await, the code reaches the save without checking again. The real job manager, with in-memory dependencies, acknowledged `cancelled` and later applied the result and changed the job to `succeeded`. A separate case applied after the deadline. See [authorization await](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/server/research-jobs.js:396>), [apply call](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/server/research-jobs.js:443>), and [reproduction results](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/docs/audits/2026-09-16-website-audit/backend-reproduction-results.json>). This is confirmed in local backend source; deployed backend parity is unresolved because of D08.

**D03 · P1 · Cancel reports an outcome it has not confirmed — interface source and isolated reproduction.**  
[cancelResearch](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/public/app.js:1060>) immediately calls [endResearch](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/public/app.js:1002>), displaying “Research cancelled. Nothing was saved.” before the server answers. When the initial start response has not arrived, there is no job ID, no cancellation request is sent, and the original idempotency key is discarded. Retrying after the original job becomes terminal can start another paid operation. The backend deduplicates active jobs, so this does not imply every retry duplicates work. It also matters on Search facts, which saves entered facts before research starts.

**D04 · P2 · Failed jobs disappear when a search is reopened — interface source and isolated reproduction.**  
[adoptResearchJob](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/public/app.js:1093>) returns for terminal jobs without restoring `job.failure`. It restores reviewable findings only. Both failed and interrupted synthetic jobs lost their visible failure state and support reference after adoption; [researchFailurePanel](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/public/app.js:4909>) consequently renders nothing. A user who leaves while research runs can return without an explanation or recovery action.

**D05 · P2 · Research can wait indefinitely for its initial acknowledgement — interface source and isolated reproduction.**  
[startResearch](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/public/app.js:795>) sends the optional facts save and the job-start request with a manually cancellable signal but no automatic request deadline. The server deadline is learned only from the response; polling safeguards start afterward. A stalled initial request therefore leaves the progress UI active until the user cancels. Manual cancellation exists, so this is not an inescapable interface lock. Token acquisition in [api](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/public/app.js:1238>) also precedes the request and needs a bounded wait.

**D06 · P2 · Research prerequisites differ between screens — deployed-interface source.**  
[Search facts](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/public/app.js:3450>) offers an enabled research action regardless of profile readiness or AI configuration. [Community](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/public/app.js:5005>) disables it with an explanation when the candidate profile is incomplete or no key is present. The shared handler redirects to the profile only after a click. Use one availability decision and explanation across both entry points. Missing-key behavior is conditional; the hosted key is present.

**D07 · P2 · “Not degraded” does not establish working AI — live evidence and source.**  
[readiness](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/server/index.js:502>) derives AI degradation solely from key presence. It reports `degraded: false` alongside one failed call and no successful calls. Separate configuration, entitlement-check status, and recent research outcomes. Keep external AI health separate from core service liveness: Render health failures can remove traffic and trigger restarts. [Render health-check documentation](https://render.com/docs/health-checks).

**D08 · P2 · Release identity cannot reliably identify deployed code — live/source mismatch.**  
The live service reports commit `16df65715938811ea650e0a82b0236ea2b694903`. That local Git commit lacks `server/research-jobs.js`, while the live service exposes research-job diagnostics. This proves an inconsistency; it does not prove which backend revision is deployed. Inspect the image/build revision and the `SLATE_RELEASE` override, then record a reproducible release stamp. The current frontend is checked separately by asset hash.

**D09 · P2 before external launch · Sign-in uses development configuration and generic branding — live UI.**  
At desktop size and 390 px width, the sign-in dialog reads “Sign in to My Application” and “Development mode.” The browser also emits Clerk's development-key warning. Correct branding and plan the production instance with its domain, OAuth configuration, organizations, roles, and access mapping. Treat this as a launch task, not the established cause of the research failure. Clerk's production guide requires an owned domain and production configuration. [Clerk production deployment](https://clerk.com/docs/guides/development/deployment/production).

**D10 · P2 · The documented preflight is incomplete — local source.**  
[scripts/preflight.js](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/scripts/preflight.js:1>) reads environment variables without loading the local `.env`, unlike normal local app startup. The [Dockerfile](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/Dockerfile:24>) does not copy this script. Make the documented command work in development and in the deployed image before depending on it for diagnosis. Model metadata access is useful for entitlement checks but is not proof that a full research run succeeds.

**D11 · P2 operational follow-up · Recovery copies and alert delivery are not configured — live evidence.**  
Readiness reports the app's off-volume copy and alert destination as “NOT CONFIGURED.” Hourly on-volume snapshots are succeeding. This is not a storage outage, and it does not establish whether separate hosting-level backups exist. Establish independent recovery and failure notification before broader use; it does not explain the research failure.

**D12 · P3 · Authentication decoration has a prior contrast finding — carried-forward evidence.**  
The earlier same-day accessibility scan reported a 3.04:1 contrast failure in Clerk's development-mode decoration. The decoration remains visible in this audit, but the automated contrast scan was not rerun. Recheck after changing authentication configuration. [Prior scan evidence](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/docs/design-audit/live-2026-09-16/anonymous-browser-results.json>). Do not describe this as a new full accessibility audit.

## Verification and limits

At 03:18:37 UTC, fresh downloads of the hosted app script, authentication script, and root HTML matched their local counterparts byte-for-byte. Source-based interface findings therefore apply to the deployed assets. This does not verify backend parity. [Asset hashes](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/docs/audits/2026-09-16-website-audit/asset-parity.json>) · [Browser observations](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/docs/audits/2026-09-16-website-audit/browser-evidence.json>) · [Interface reproduction results](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/docs/audits/2026-09-16-website-audit/ui-diagnostic-evidence.json>).

The live landing page and sign-in dialog rendered at 1280 × 720. Landing, sign-in, and sign-up were also inspected at a 390 × 844 viewport: document width was 390, and no form controls extended horizontally beyond the viewport. Escape dismissed authentication dialogs and returned focus to their opening buttons. No JavaScript exception appeared in the inspected console capture; the development-instance warning did.

Five isolated interface scenarios reproduced D03–D05, including separate failed and interrupted recovery cases. Two isolated backend scenarios reproduced D02. All 79 first-party JavaScript files passed the existing syntax check. These are diagnostic results, not a full regression pass. Local reproductions used Node 22.18.0; production reports Node 24.20.0, so acceptance testing should use the production runtime.

No signed-in production session or Render job log was available. Authenticated layouts, the precise failed job, production write behavior, full research success, and real-device accessibility remain unverified. The local backend reproduction must not be presented as a hosted exploit or an observed production overwrite. Prior local-provider success in older notes was not repeated and does not validate Render credentials.

Only audit artifacts were added. No app fixes, deployment changes, production records, account submissions, or paid provider calls were made during this audit.
