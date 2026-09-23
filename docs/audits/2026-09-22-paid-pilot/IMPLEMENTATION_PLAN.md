# Slate paid pilot implementation plan

Current follow-up: [September 23 pilot remediation plan](../2026-09-22-pilot-walkthrough/IMPLEMENTATION_PLAN.md), based on the three-agent walkthrough and subsequent local invitation fix. Use that plan for current priorities and remaining work; this document preserves the earlier design and baseline findings.

Date: September 22, 2026, America/Phoenix

Baseline: `main`, commit `8fe844bc202cd2a9387f89f73e3e8eced8c1e46a`.

The pilot should charge **a fee per search project**, as confirmed by the owner. The reported API problem is **city/county research**. The owner requires **Claude Opus 5.5 for the API**, covering research and drafting. The requested navigation changes are a working home icon and an optional side menu. This document plans the implementation; no application changes, provider configuration changes, purchases, or deployments were made during this audit.

## Recommendation

Build project payments and project access controls using one-time Stripe Checkout. Keep Clerk for identity, organizations, and roles. Use Opus 5.5 throughout AI requests, and replace the research feature's default multi-round browsing conversation with bounded retrieval, reusable evidence, and a short extraction call. Reduce unnecessary model work while keeping the requested model. Add a consistent home control and collapsible navigation. Complete operational and hosted user-journey checks before accepting pilot payments.

The existing organization subscription integration is a different commercial model. Do not activate it as a shortcut for project fees. Do not convert the old Basic/Enhanced/Executive price ranges into checkout amounts without an explicit price decision.

## Evidence and limits of this review

Live target: <https://slate-executive-search.onrender.com>. Checks were taken on September 22 locally, September 23 UTC. See [live-evidence.json](live-evidence.json), [research-probes.json](research-probes.json), and [test-evidence.json](test-evidence.json).

| Area | Finding | Evidence / confidence |
|---|---|---|
| Public routes | Home, signup, signin, subscriptions, and careers return HTTP 200. | Live HTTP checks. This proves delivery, not rendered usability. |
| Frontend version | Served `app.js`, `auth.js`, and `app.css` match local HEAD after normalizing line endings. | Live content comparison. |
| Home control | The public header already links the word Slate to `/`. The workspace house graphic is a decorative SVG inside a `div`; the onboarding brand is a `span`. | `public/app.js`: `publicFrame`, `shell`, `accountFrame`. The exact reported signup icon interaction still needs a browser reproduction. |
| Optional menu | The workspace has a mobile drawer; signup and other public pages use a separate header without it. Desktop collapse is not exposed by that mobile control. | `public/app.js`: `publicFrame`, `shell`, `setNav`; CSS shell rules. |
| Billing | Live mode is `off`; no plans are returned. Local billing reads Clerk organization plans and subscriptions. There is no project purchase model or paid-feature enforcement. | Live `/api/public/billing/plans`; `server/billing.js`; prior billing implementation record. |
| Research | Live limits are 180 seconds total, 25 seconds crawling, 60 seconds per round, four rounds, no automatic research retries. | Live `/api/ready`, `server/research-op.js`. |
| Research reliability | Existing code already has persisted jobs, duplicate-start protection, cancellation, revision checks, partial-result review, and restart interruption. Preserve these. | `server/research-jobs.js`, `tests/research.js`, `tests/research-ui.js`. |
| Retrieval gaps | An offline probe missed a budget link titled “Adopted budget FY 2026” at `/DocumentCenter/View/1234`. Another collapsed `/budget?year=2026` and `/budget?year=2025`. Direct fetching rejects PDF content. | Reproduced with `server/site.js`; [probe results](research-probes.json). These demonstrate weaknesses, not a diagnosis of a particular historical failed run. |
| Token exposure | Up to six locally fetched pages contribute the first 9,000 characters each. The model request allows eight web searches and six fetches, with a 20,000-token fetch-content setting and 8,000 output tokens. Conversation history is resent on later rounds. | `server/site.js`, `server/ai.js`. These are configured limits, not measured usage or an operation-wide token ceiling. |
| Cost accounting | The estimator includes token/cache charges but omits search-tool charges. Budget totals are held in process memory; spending is recorded after work. There is no durable per-project dollar reservation. | `server/aibudget.js`, `server/research-op.js`; search-only usage probe estimates zero. |
| Live AI evidence | Current-process metrics report research as unverified, with no completed jobs observed. | Live readiness snapshot. This does not establish that research has never run or failed before. |
| Deployment identity | Build reports `16df657…`; platform reports `8fe844b…`; `releaseIdentity.agrees` is false. | Live health/readiness. Frontend parity does not prove backend parity. Investigate stale configuration/build stamping. |
| Operations | Off-volume backup and alert destination are unconfigured. Applicant mail is unavailable; uploads are disabled and no production scanner exists. | Live readiness, supported by the latest release-readiness record. |

No connected browser surface was available; both in-app-browser and Chrome attempts were unavailable. This review therefore does **not** claim a visual desktop/mobile walkthrough, a real Clerk signup, or a hosted checkout. Those are explicit implementation acceptance checks below. No paid AI requests were made, so actual cost, latency, and source accuracy need a measured baseline.

Fresh verification: `node tests/run.js` completed with exit 0, including billing, 55 research checks, 18 research-interface checks, and the remaining server suites. The run used local Node 22.18.0, below the supported Node 24 floor, so it is supplemental evidence, not a substitute for Node 24 CI. The first PowerShell redirect reported a shell error from native stderr; a second run captured the actual child exit code directly. [Test evidence](test-evidence.json) records the verified result. No browser or provider-payment tests were run during this audit.

`/api/ready` reporting `ready: true` means the process and store can serve traffic. It is not evidence that billing, research, backups, or the pilot are ready.

## Delivery order

Estimates below are provisional engineering days for one developer, excluding owner decisions, merchant setup, and external review. Re-estimate after the baseline and payment-policy decisions. Work can be implemented in separate pull requests; no broad frontend rewrite is needed.

| Order | Work package | Priority | Estimate | Exit condition |
|---|---|---|---|---|
| 0 | Reproduce journeys and establish a trustworthy release/research baseline | P0 | 1–2 days | Known deployed commit, browser evidence, agreed benchmark and price policy |
| 1 | Home control and optional side menu | P1, required pilot UX | 1–2 days | Consistent navigation on signup, onboarding, workspace, and mobile |
| 2 | Project catalog, purchase ledger, checkout, and payment recovery | P0 | 3–5 days | One verified payment activates exactly one authorized search |
| 3 | Server access controls and project billing interface | P0 | 2–3 days | Direct API calls cannot bypass purchase limits; unpaid and paid states are clear |
| 4 | Opus 5.5 migration, research retrieval, reuse, cost bounds, and review experience | P0 | 4–6 days | Requested model verified; benchmark meets agreed reliability/cost targets without losing citations |
| 5 | Hosted rehearsals, recovery, alerts, and pilot sign-off | P0 | 2–3 days | Completed evidence record and a full synthetic search without developer intervention |

Allow roughly **13–21 engineering days**, with uncertainty concentrated in hosted payment integration and difficult government sites. Do not promise a pilot date before package 0. Start backup/alert setup while the feature work proceeds. If public applications are included, production email integration is additional required work; resume uploads add scanner integration and its own validation.

## 0. Establish the baseline

1. Inspect Render's configured release value and build pipeline. Remove a stale manually maintained release override if that is the cause; rebuild and verify build/platform identity agrees with the release under test. Keep deployment validation separate from runtime liveness.
2. Reproduce the reported house-icon behavior in signed-out signup, any Clerk form/modal, and signed-in onboarding. Record URLs and click outcomes. Check keyboard navigation, back, refresh, error states, and a narrow viewport.
3. Verify access to `claude-opus-5-5` using the Models API, then update the preflight and verify it in the deployed environment. Test model/tool compatibility separately; do not assume a configured key proves successful research. Record the existing Sonnet 5 / Opus 5 configuration before migration.
4. Collect 12 representative public jurisdictions: six cities/towns and six counties. Include a document-center budget, PDF-heavy site, JS-heavy site, redirects, a slow or blocked site, missing published figures, and ambiguous jurisdiction names. Record provider request IDs, stage times, billable usage, sources, outcome, and human correction time. Establish and approve the spend ceiling before the live benchmark.
5. Record exactly what the project fee buys. Approve price, currency, package scope, payment timing, permitted payers, included AI allowance, and refund/cancellation rules. Preserve existing projects and audit records while defining their migration treatment.

## 1. Navigation

Proposed scope: the optional menu is available throughout the public/account flow, with the existing workspace menu made collapsible on desktop as well. Public pages default to closed; workspace desktop state may remember the user's preference. Mobile always starts closed.

- Create a shared brand/home control with the house symbol and accessible label “Slate home.” On signup/signin and public pages it is a real link to `/`. Ensure `/` can display the public home for signed-in visitors as well, with a separate “My workspace” action, so onboarding cannot trap the home link in a redirect loop.
- In the workspace, distinguish “Slate home” from “Workspace home.” Route internal workspace navigation through the existing unsaved-edit guard. Do not discard an in-progress form when opening/closing the menu.
- Public menu: Home, How it works, Search pricing, Find a position, Sign in/Create account, and support. Show only available destinations. Signed-in workspace menu retains its role-appropriate searches, team/access, help, and adds project billing.
- Implement a semantic navigation drawer with an explicit Menu button, current-page indication, `aria-expanded`, Escape/backdrop close, sensible focus return, and hidden links removed from the tab order. Trap focus only when the drawer is modal; an expanded desktop rail remains ordinary navigation.
- Add public-menu state separately from the current workspace-only `setNav`, or refactor its DOM targeting deliberately. The existing function requires `.shell` and will not work unchanged in `publicFrame`.
- Configure any Clerk-hosted logo link through its supported appearance API after confirming the installed SDK's options. Avoid DOM patches inside Clerk components.

Files: `public/app.js`, `public/auth.js`, `public/app.css`, `public/styles.css`; navigation fixtures in `tests/browser/welcome.spec.js`, `onboarding.spec.js`, `workspace.spec.js`, and `reflow.spec.js`.

Acceptance: home icon works on signup and onboarding; direct URLs/back/refresh work; drawer toggling preserves typed signup data; desktop collapse restores content width; no overflow at 320 CSS pixels or 200% zoom; keyboard and screen-reader labels are checked. Include the real Clerk component, not only the offline substitute.

## 2–3. One-time project payments and access

### Purchase flow

`Create account → select/create workspace → create search draft → review package and total → hosted checkout → verify payment → activate that search`

Use Stripe Checkout in `payment` mode. This supports one-time purchases. Clerk's currently implemented organization subscriptions would grant access at the wrong scope for the requested commercial model. See [Stripe Checkout Sessions](https://docs.stripe.com/api/checkout/sessions/create) and [Clerk organization billing](https://clerk.com/docs/js-frontend/guides/billing/for-b2b).

Proposed default: only the workspace administrator purchases a project. Consultants can prepare a draft and request purchase; committee members and candidates never see a payment requirement. Confirm whether a client outside the consultant's workspace must pay before designing that separate payer path.

### Data and API changes

- Add a versioned project-offer catalog with exact approved prices, Stripe price IDs, purchased capabilities, and included research allowance. A saved purchase retains its offer snapshot even if later pricing changes.
- Add durable purchase/payment records linked to both `organizationId` and `searchId`: local purchase ID, offer/version, amount/currency, Checkout/PaymentIntent IDs, payment state, event references, timestamps, and activation status. Store no card data or candidate information in payment metadata.
- Separate selected workflow (`search.package`) from purchased rights. Selecting “Full search” in Search facts must not unlock unpaid features. Compute effective permissions from verified workspace membership, search authority, purchased capabilities, and remaining allowance.
- Proposed routes: `POST /api/searches/:id/checkout`, `GET /api/searches/:id/payment`, a protected reconciliation action, and `POST /api/webhooks/stripe`. Derive project/workspace ownership and price on the server; reject client-supplied amounts and payer/workspace substitutions.
- Persist a pending purchase before calling Stripe. Use a stable idempotency key for checkout creation and reuse an existing open session. Re-check project ownership/state after asynchronous work. Refuse a second purchase for an already activated project; define upgrades as a later explicit purchase flow.
- Verify webhook signatures against the raw request body before JSON parsing. Exempt only this endpoint from session/CSRF requirements, replacing them with Stripe verification. Persist event handling and entitlement activation together; acknowledge only after a durable save.
- Handle duplicate and out-of-order delivery and reconcile authoritative provider state. `checkout.session.completed` alone is not proof that delayed funds have cleared. Track unpaid, checkout-open, processing, paid, expired/failed, refunded/partially refunded, and disputed states separately from access policy.
- Use the same idempotent fulfillment function for verified return-page reconciliation and webhooks. Never activate from query parameters or a success-page visit. Recover payments if the customer closes the browser or the app restarts. Stripe documents this combination and repeated/concurrent fulfillment requirements in its [fulfillment guide](https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted); delivery/signature handling is covered by [webhook guidance](https://docs.stripe.com/webhooks).
- Include purchases, processed-event identifiers, and reconciliation state in backups and migrations. Prove restart and restore behavior. Retain the single-writer deployment for the pilot only if concurrent checkout/webhook tests and the hosted load envelope pass; do not add a separate worker against the same JSON file.

Implementation seams: new `server/project-billing.js` and `server/project-entitlements.js`; routes/middleware in `server/index.js`; migration in `server/db.js`; authority integration in `server/authority.js`; provider/configuration in `.env.example`, `render.yaml`, and `package.json`.

### Access and interface

- Unpaid draft: allow identity/workspace setup, basic search facts, package review, and payment. Propose gating AI execution, publishing/recruiting, and paid workflow actions until activation; finalize the exact action matrix before coding.
- Enforce the matrix on every applicable backend route, including legacy research/generation paths and package changes. Revalidate queued research entitlement immediately before spending. Reflect the same result in UI capabilities.
- Preserve authorized access to existing records, support, and export after a billing interruption. Define restrictions on new paid work explicitly. A refund or dispute must not erase records or silently change committee authority.
- Replace subscription language with **Search pricing**, **Project payment**, **Amount paid**, and **Receipt**. Show the selected search, purchased scope, one-time total, payment status, included allowance, and support contact. Remove Clerk/provider implementation explanations from buyer-facing copy.
- Keep `/subscriptions` as a compatibility redirect to the replacement pricing page once implemented. Remove the unused organization PricingTable/subscription drawer from the project-purchase journey. Preserve any real historical billing records if reconciliation finds them.
- Existing searches need an explicit migration status, such as legacy access awaiting owner reconciliation, with a named policy and expiry if appropriate. Do not silently mark them paid or unexpectedly lock ongoing work.

Acceptance matrix: successful test purchase; declined card; required authentication; abandoned/expired session; delayed payment success/failure if enabled; duplicate click; duplicate/reordered webhook; payment while browser is closed; app restart during fulfillment; provider timeout; forged amount/project/session; cross-workspace request; committee denial; purchased-tier bypass attempt; refund/dispute policy; second project remains unpaid; receipt and recovery. Test a real hosted test-mode checkout before live activation. Production merchant setup and any real-money rehearsal remain separate owner-controlled steps.

## 4. Research: retrieve evidence first, generate second

### Required model: Claude Opus 5.5

Anthropic documents the API identifier as **`claude-opus-5-5`**. The current deployment reports Sonnet 5 for standard calls and Opus 5 for premium calls, so neither currently meets this requirement. See the [Opus 5.5 model reference](https://platform.claude.com/docs/en/models/opus-5-5/overview).

- Set both `CLAUDE_MODEL` and the legacy `CLAUDE_MODEL_PREMIUM` to `claude-opus-5-5` during transition, and update defaults in `server/ai.js`, `scripts/preflight.js`, `.env.example`, and deployment configuration. Remove or relabel the standard/premium model toggle so it does not imply two different models. Apply this to drafting as well as research. Do not silently fall back to Sonnet, Haiku, or an older Opus.
- Verify the installed Anthropic SDK against streaming, tool use, structured output, and the model's response shapes; upgrade/pin only as needed. Re-run representative draft and research fixtures.
- Opus 5.5 always uses adaptive thinking. Set effort explicitly, initially low for evidence extraction and medium for narrative drafting, then measure quality and usage. Preserve thinking blocks unchanged in append-only tool conversations; parse by content type. Use structured output or automatic strict tools, not forced `tool_choice`. Keep UI progress based on application stages. See the [migration guide](https://platform.claude.com/docs/en/models/opus-5-5/migration-guide).
- Add the model to cost accounting **before** switching traffic. Current published standard rates per million tokens are $4 input, $20 output, $5 for five-minute cache writes, $8 for one-hour cache writes, and $0.20 cache reads. The current estimator's universal 10% cache-read multiplier would be wrong here: Opus 5.5 uses 5%. Model rates and cache rates must be explicit and versioned; include billed reasoning output and search tools. Verify rates again at implementation. See [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing).
- Acceptance: readiness and saved generation/research records identify Opus 5.5; the account preflight succeeds; no legacy premium path invokes another model; all cost categories are accounted for; actual model calls pass in staging within the agreed budget.

### Proposed default pipeline

`Confirm jurisdiction → reuse fresh public evidence → retrieve missing facts → select short relevant excerpts → structured extraction → review changes → apply selected fields`

1. **Identity and scope.** Use jurisdiction name, state, jurisdiction type, and official domain as explicit inputs. Confirm ambiguous matches before research. Separate basic facts from optional community narrative so the core lookup is not required to fill a long brochure checklist.
2. **Targeted retrieval.** Rank links using anchor text, title, and URL; handle document-center URLs and meaningful query parameters. Strip navigation/footer repetition and select relevant passages instead of taking the first 9,000 characters. Use official budget/government pages and a versioned Census/ACS adapter for population where available. Show the publication year and budget type.
3. **PDF and difficult-source handling.** Add bounded PDF text extraction for official public documents, with file-size, page, time, and text limits. Keep SSRF/DNS/redirect protections. Report scanned or unreadable PDFs as a gap with a source link; avoid an automatic expensive OCR/browser-agent fallback. Treat retrieved text as untrusted data.
4. **Reusable evidence.** Persist sanitized public text/excerpts, source URL, retrieval time, document date, content hash, and extraction version. Start with workspace-scoped caches. Keep private project facts and candidate data out of reusable public-source records. Revalidate freshness and allow Refresh. Do not reuse a salary across positions. Cache synthesized facts by jurisdiction identity, evidence hashes, schema/prompt version, and model; invalidate when those change.
5. **Short extraction.** Pass only relevant excerpts and a small schema to one extraction call. Require each populated factual field to cite an evidence ID/excerpt; unknown is an accepted result. Reject invented IDs and mismatched jurisdiction/year. Use at most one bounded schema-repair call with the same evidence, without reopening web search.
6. **Optional deeper research.** Search only for named missing facts after normal retrieval. Cap it across the entire operation and show its extra allowance before starting. Keep Opus 5.5 for both core and deeper work; do not rerun all sources. Tune effort, selected evidence, and output length rather than substituting a cheaper model.
7. **Review and reuse.** Return a field-level diff with source, year, and “not found”/“needs review” states. Apply selected fields only after revision/authority checks; preserve manual entries by default. Reuse evidence for brochure/community generation instead of re-researching the jurisdiction.

No vector database is needed for this small, field-specific evidence set. Evaluate simple passage ranking and deduplication first.

### Limits and accounting

Proposed starting settings for benchmarking, not measured guarantees:

| Control | Default proposal |
|---|---|
| Core extraction | One model call; at most one schema-only repair |
| Selected input | 12,000 tokens total, including instructions/schema/evidence |
| Core output | Start at 4,000 tokens per call including reasoning; target a short factual JSON result and adjust only from benchmark evidence |
| Core retrieval | At most six fetch attempts / four selected documents, inside a 20-second fetch budget |
| Additional web searches | Zero on the normal core path; at most three across an explicitly chosen deeper operation |
| Hard operation deadline | 90 seconds core / 180 seconds deeper research, including queue/save time |
| Model choice | `claude-opus-5-5` for all AI requests; explicit effort per task |
| Spending | Durable per-operation reservation, per-project allowance, and deployment ceiling; amounts approved by owner |

Count input, output, cache reads/writes, and paid search-tool uses per provider request. Preserve known usage on failed/cancelled attempts and represent unknown usage separately. Reserve an upper-bound allowance before starting and settle actual usage afterward; hold a conservative reservation for unknown-cost attempts until reconciled. Do not let restart, multiple queued jobs, or an unpriced model reset/bypass the cap. The existing process-memory daily counter is insufficient for purchased allowances.

Anthropic documents per-request web-search limits, separate search charges, and reuse of result tokens in later conversation turns. Those make an application-level operation budget necessary. See [web search documentation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool). Fetch content limits are approximate and do not bound binary PDFs, so also bound document extraction locally. See [web fetch documentation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool).

The code already marks its system prompt for caching. Measure cache-read/write usage before crediting savings: prompt caching has model-specific minimum lengths and does not replace a persistent evidence cache. See [prompt caching documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

Files: `server/site.js`, `server/ai.js`, `server/aibudget.js`, `server/research-op.js`, `server/research-jobs.js`, `server/telemetry.js`, `server/db.js`, `public/app.js`; focused additions such as `server/research-cache.js` and source adapters.

Preserve existing idempotency, cancellation, workspace isolation, immutable input snapshots, stale-write rejection, reviewable partial results, and restart interruption. Extend the current tests around those boundaries rather than replacing the job system.

### Research acceptance

- Repeat the same 12-jurisdiction benchmark cold and warm; separately report core and deeper operations, failures, partials, and time spent correcting results.
- Target at least a **50% reduction in median total model tokens and estimated provider cost** versus the old pipeline running on the same Opus 5.5 model, with no reduction in supported-field accuracy. Also report actual dollars against the previously deployed Sonnet/Opus mix separately: a token reduction alone does not prove lower spend after a model upgrade. These are targets to validate, not promised savings.
- Proposed latency targets: core p95 under 60 seconds, deeper p95 under 120 seconds; every request still obeys its hard deadline and ends in an explained state.
- Every populated factual field has a valid captured source reference and year where applicable. Reviewer checks catch wrong jurisdiction, wrong fiscal year, incorrect fund type, and unsupported salary. Missing figures remain unknown without a repeated completion loop.
- Repeated unchanged research reuses eligible evidence/results. Navigation, polling, refresh, review/apply, and duplicate clicks do not create a second paid operation.
- Test PDF/document-center links, query parameters, source changes, ambiguous names, unavailable sites, cache expiry, cancellation, budget exhaustion, provider errors, restart, stale revisions, and revoked/purchased access while queued.

## 5. Site and operational acceptance

Perform a hosted walkthrough on the exact release with administrator, consultant, committee, and candidate paths. Cover home/signup, onboarding, workspace creation/invitations, unpaid project draft, purchase, research/review, document generation, screening/scoring, closeout/export, archive/restore, help, and error recovery. Confirm the founder allowlist admits intended pilot owners while invitations work for other users.

Before paid launch:

- Verify off-volume backup delivery and restore the store plus media/files and payment ledger into an empty location. Reconcile restored payments against Stripe before accepting new purchases. Record recovery duration and data age.
- Configure a named alert recipient and exercise backup failure, storage failure, payment processing/reconciliation failure, and repeated research failure alerts.
- Run the hosted load envelope from the release plan: 100 synthetic candidates, 15 accounts, 20 concurrent sessions, including payment-event contention and research polling. Keep the single-writer store only if the results support it.
- Validate real Clerk roles, invitations, removal/revocation, and cross-workspace switching. Run supported Node 24 CI and browser checks against the new changes; local Node 22 results are supplemental.
- Rehearse desktop Chrome, WebKit, mobile layout, keyboard-only navigation, and real phone/screen-reader use. Include the real hosted Clerk/Stripe flows.
- Decide public application scope. If included, implement and test a production mail provider and approved candidate support/privacy wording. If excluded, give the portal a truthful unavailable/externally managed path. Leave uploads disabled unless a real scanner and restore policy are implemented and tested.
- Assign primary/backup operator, payment support owner, candidate support contact, and records custodian. Resolve the existing pilot decisions on data handling and authority with the appropriate owners.

Use the existing [release-readiness record](../../pilot-runs/2026-09-21-release-readiness.md) and [pilot decisions](../../pilot-decisions.md) as checklists, not as proof those checks passed for this release. Keep invoice procurement, installments, automated package upgrades, cross-organization payer flows, OCR, and a database migration outside the initial implementation unless an owner decision or measurement makes them necessary.

## Decisions still needed

| Decision | Recommended starting position | Owner |
|---|---|---|
| Exact project offer and fee | One clearly defined pilot offer, paid once before activation; avoid publishing unapproved legacy ranges | Product owner |
| Payer | Workspace administrator; add a separate client payer only if required | Product owner |
| Payment method/timing | Hosted card checkout for the first implementation; confirm whether municipal invoice/PO or deposit requirements change this before launch | Product owner |
| Package/access matrix | Explicit purchased capabilities, separate from workflow selection; candidates remain free | Product owner + search lead |
| Existing projects | Explicit documented legacy treatment; retain records and permissions | Product owner |
| Refunds/disputes/upgrades | Defined policy; preserve records and route exceptions to support | Product owner |
| AI allowance and benchmark spend | Set per-operation, per-project, and deployment caps before paid calls | Product owner |
| Candidate intake/uploads | Production email if intake is in scope; uploads off unless scanning is implemented | Product owner + operations |

Launch only after one synthetic buyer can sign up, create a project, pay in test mode, obtain only that project's entitlements, complete sourced research within budget, and finish the search workflow, with recovery and support demonstrated. Then perform the owner-controlled production payment activation and final release verification.
