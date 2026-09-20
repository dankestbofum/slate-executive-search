# Slate implementation plan
Prepared September 16, 2026 · Scope: city/county research reliability, error recovery, and associated UI/launch findings

[Diagnostic report](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/docs/audits/2026-09-16-website-audit/DIAGNOSTIC.md>)

**Recommended order: identify the recorded failure, close the cancellation race, repair recovery and request handling, then validate research on the actual deployment configuration.**

**Status, September 16, 2026: every code change below is applied; the deployment, Clerk, and paid-staging items are not.** See the [implementation record](IMPLEMENTATION_RECORD.md) for which is which, the tests added, and what still needs Render or Clerk access. The text below is left as written, as the backlog it was.

## 1. Establish the failure and deployed version
Owner: application engineer with Render access. Addresses D01, D08, D10.

- Read the affected search's latest job through the existing authorized application flow. Capture its job reference, terminal state, failure code, stage, and timestamp.
- Find the corresponding Render `research-job-failed` event. Retain code, stage, rounds, elapsed time, network classification, attempts, and provider request ID. Keep credentials and research contents out of the report. Anthropic provides request IDs for diagnosis. [Claude API errors](https://platform.claude.com/docs/en/api/errors).
- Reconcile the running image/build commit with `SLATE_RELEASE`. Compare frontend asset hashes independently; a matching frontend does not verify the backend.
- Repair `scripts/preflight.js` so local execution loads the intended environment, while production remains controlled by deployment variables. Include the command in the image if it is the documented operational entry point. Run model-entitlement checks in the deployment environment.

**Acceptance:** one incident record links the user's failed job to its actual error and deployed build. “Key present” or an unrelated local success is insufficient. No timeout increase is needed to complete this diagnostic step.

| Observed job/log result | Implement or correct | Verification |
| --- | --- | --- |
| First-round `TIMEOUT` / `RESEARCH_TIMEOUT` | Measure crawl and round timings. Evaluate a single bounded synthesis fallback using already crawled sources; tune the round allowance only if measurements support it. Preserve the overall deadline and usage limits. | Slow-provider fixture ends within the total limit; supported partial output is reviewable; a representative city and county can complete under the chosen configuration. |
| `NO_KEY`, `AUTH_ERROR`, `AI_AUTH_ERROR` | Correct the deployed credential/configuration and expose a useful operator action. | Entitlement check passes; a controlled full operation succeeds. |
| `MODEL_UNAVAILABLE`, `BAD_REQUEST`, billing/permission error | Validate the exact deployed model, tool request, account access, and provider error classification. | The failing request shape is accepted or a clear non-retryable explanation is shown. |
| `CONNECTION_ERROR`, `RESEARCH_CONNECTION_ERROR` | Diagnose DNS/TLS/connection and provider request ID; keep retries bounded and idempotent. | Simulated disconnection recovers without duplicate work or losing edits. |
| `RESEARCH_UNVERIFIED`, `STALE_SEARCH`, save failure | Address access lookup, concurrent edits, or persistence; retain usable findings for review. | No automatic overwrite of newer edits; recovery shows the appropriate action. |

## 2. Make cancellation and the final save agree
Owner: backend engineer, coordinated with frontend engineer. Addresses D02–D03. Highest implementation priority.

Files: [server/research-jobs.js](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/server/research-jobs.js:396>), [server/research-op.js](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/server/research-op.js:172>), [public/app.js](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/public/app.js:1060>).

- Bound the awaited authorization phase by the operation's remaining time.
- After every awaited pre-save check, verify cancellation, expiry, current search lifecycle, workspace, and revision before writing. Keep the final check and synchronous application together so there is no new asynchronous gap.
- Keep a cancelled job terminal. Decide explicitly whether supported findings are retained for manual review; do not auto-apply them.
- Release the UI immediately when Cancel is selected, but say “Cancellation requested” until acknowledged. If the response is lost, show “Outcome unknown” and a reconciliation action.
- When no job ID has arrived, preserve the original idempotency key and reconcile it through an authorized, non-creating status lookup or equivalent contract. A status check must not accidentally start work.
- Report “already saved” when the server genuinely finished first. Scope messages to research output, since Search facts may already have been saved.

**Acceptance:** cancellation during provider work, during authorization, and just before application produces zero subsequent automatic writes when cancellation wins. Expiry during authorization produces zero writes. If saving wins first, the UI accurately says so. Lost acknowledgements cannot trigger an unintended second run after the first job finishes. Re-run the two backend reproductions as regression cases on Node 24.20.0.

## 3. Restore failures and bound the initial wait
Owner: frontend engineer with a small API contract update as needed. Addresses D03–D06.

Files: [startResearch / API helper](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/public/app.js:795>), [adoptResearchJob](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/public/app.js:1093>), [Search facts](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/public/app.js:3418>), [Community](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/public/app.js:4968>).

- Use one terminal-job mapper for polling and re-opening a search. Restore failure text, reference, retry eligibility, and reviewable output.
- Track explicit dismissal separately from terminal state. Define it per job and user, and clear state on search/workspace changes.
- Add deadlines for token acquisition, optional facts save, job acknowledgement, and cancellation acknowledgement. Keep these short network deadlines separate from the overall research deadline; never infer “nothing saved” merely because a request timed out.
- Retain the idempotency key across uncertain outcomes. Clear it only after reconciliation or a deliberate new run.
- Use one eligibility helper for profile readiness, service package, role, configured AI availability, and active operation. Present the same explanation on both screens.
- Preserve entered values and focus when a request fails. Keep a persistent recovery panel with a support reference; use plain language such as “Research unavailable” instead of exposing implementation details to routine users.

**Acceptance:** refresh after failure or restart interruption restores the explanation. A pending start request returns control automatically. Facts and Community offer matching actions. A late response from another search/workspace cannot repaint the current page or clear its operation.

## 4. Make diagnostics and launch configuration truthful
Owner: application engineer and deployment administrator. Addresses D07–D12.

- Report AI configuration separately from recent success/failure and the time of any entitlement check. Show “not yet verified” when no usable operational evidence exists.
- Track final job outcomes as well as provider-call outcomes: a provider success followed by a failed save is not a successful research job.
- Keep Render's traffic health check fast and focused on core service availability; provide AI degradation and recovery/alert status separately. [Render health checks](https://render.com/docs/health-checks).
- Stamp the release from the actual build and verify it in deployment checks.
- Rename the authentication application to Slate. Prepare production Clerk configuration using an owned domain; carry over or deliberately map organizations, roles, users, and invitations before switching credentials. Validate sign-in and workspace access. [Clerk production guide](https://clerk.com/docs/guides/development/deployment/production).
- Configure an independent verified backup destination and alert recipient/channel; perform a restore and delivery check.
- Recheck authentication contrast after removing development decoration. Verify the signed-in research screens at desktop and phone widths and with keyboard navigation.

**Acceptance:** diagnostics distinguish app availability, AI configuration, and research outcomes; a release is traceable; intended members retain correct access; a restore and alert delivery are evidenced.

## 5. Verify, stage, and release
Owner: test engineer or implementing engineer. This is required before calling the research feature fixed.

| Test group | Required scenarios | Passing result |
| --- | --- | --- |
| Backend regression | Cancel/expire during authorization; concurrent revision change; access removed; save failure | No prohibited or stale write; correct terminal state and recoverable findings. |
| UI regression | Failure while tab is away; reload; initial request never answers; lost acknowledgement; cancel before ID; late response | Persistent explanation, bounded wait, truthful status, preserved identity and edits. |
| API contract | City/county input, invalid URL, auth error, model refusal, rate limit, malformed response | Structured error and reference; consistent action eligibility. |
| Isolation | Workspace switch while running; another workspace requests job/status/result | No state or data crosses workspaces; existing authorization remains enforced. |
| Controlled staging research | At least one representative city and one county; official websites; manual facts already entered | Supported output with sources; existing facts preserved; duration and provider usage recorded. |
| Interface and accessibility | Signed-in Facts/Community, mobile width, zoom, keyboard, focus, screen-reader status, contrast | Usable actions, readable errors, no trapped focus or unintended overflow. |
| Release smoke test | Verified build, job completion, refresh/reconnect, controlled cancellation, rollback rehearsal | Hosted behavior matches the tested release and stored records remain recoverable. |

Use synthetic staging records and a bounded provider budget for live research validation. The current audit made no paid calls. Run the repository's syntax and regression suites plus the new cases; then run only the focused hosted checks needed to validate deployment behavior.

Deploy application fixes with a verified backup and a traceable build. Preserve the current workspace isolation and data schema when choosing rollback artifacts. If research must be held during rollout, keep manual facts entry available; account for the existing inline fallback rather than assuming that disabling the job endpoint disables research.

**Completion evidence:** the original failure is explained; the cancellation/expiry regressions pass; failed jobs remain visible after reload; a city and a county complete on staging using deployment-equivalent settings; and the released build passes the focused hosted checks. Broader production availability cannot be inferred from this small smoke-test sample.

