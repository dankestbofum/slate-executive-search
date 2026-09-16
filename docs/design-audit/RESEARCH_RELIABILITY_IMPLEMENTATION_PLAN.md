# Research reliability: diagnosis and implementation plan

Prepared September 14, 2026. Status: **diagnosis complete; all five steps
implemented.** See
[RESEARCH_RELIABILITY_IMPLEMENTATION_STATUS.md](RESEARCH_RELIABILITY_IMPLEMENTATION_STATUS.md)
for what was built, how it was verified, and the one check still outstanding:
a bounded run against the hosted deployment.

## Finding

Research is failing after a long wait, rather than reliably producing a result. Hosted logs contain two research failures lasting approximately six minutes. The application makes non-streaming Anthropic requests with a hardcoded three-minute timeout and one automatic retry, then reports timeout and other connection failures under the same generic error. The browser waits behind a blocking dialog with simulated progress and no cancellation or overall deadline.

The current API key authenticates successfully. Replacing the key again is not the recommended fix. The priority is to bound the entire research operation, stream long provider responses, report actionable errors, and give research an independently trackable lifecycle.

The six-minute timings strongly fit a 180-second attempt plus one retry. The existing logs do **not** prove whether the underlying cause was provider latency, an idle connection being dropped, or another network failure. They do not record the provider request ID, error subclass, research stage, or individual attempts. No paid research request was made during this audit.

## Evidence collected

The inspected source and live Render deployment are release `16df65715938811ea650e0a82b0236ea2b694903`.

| Check | Observed result | Interpretation |
|---|---|---|
| Local and Render credentials | Both accepted by Anthropic's read-only Models API; keys match without being displayed | The earlier invalid/missing-key issue is not the current configuration state |
| Configured models | `claude-sonnet-5` and `claude-opus-5` both appear in the authenticated model listing | Model identifiers are recognized; this does not prove Messages billing, web-tool availability, or completion latency |
| Hosted readiness | HTTP 200; `ai.configured: true`; timeout 180,000 ms; retries 1 | Key presence and app readiness are healthy; readiness does not exercise research |
| Hosted log, September 14 at 20:19:04.875 UTC | Research failed after **363,324 ms**, code `CONNECTION_ERROR` | An observed research failure after 6 minutes 3 seconds |
| Hosted log, September 14 at 22:12:06.796 UTC | Research failed after **364,205 ms**, code `CONNECTION_ERROR`; associated HTTP request returned **500** after 364,468 ms | An observed research failure after 6 minutes 4 seconds, with no usable output |
| Earlier hosted log, 18:52:26.028 UTC | `NO_KEY`, followed by HTTP 503 | Historical configuration failure; distinguish it from the later connection failures |
| Offline reproduction against the actual `runResearchAgent` function | Mock returned six `pause_turn` responses. All six calls used 180,000 ms despite `SLATE_AI_TIMEOUT_MS=25`; no submitted result | Confirms the configured timeout is bypassed and multiple continuations can finish without a result; zero network/model calls |

The log query was restricted to research entries in a recent six-hour window. It is not a complete history or a browser trace of the user's specific attempt. The readiness counters are process/day scoped and are not a durable incident history.

## Where the failure comes from

| Area | Source | Defect and effect |
|---|---|---|
| Provider requests | `server/ai.js`, `client`, `runResearchAgent` (around lines 36 and 381) | The client reads configured limits, but research overrides each call with `{ timeout: 180000 }`. One SDK retry can turn one stalled attempt into approximately six minutes. Research uses non-streaming `messages.create`. |
| Continuation loop | `server/ai.js`, `runResearchAgent` | Up to six rounds each receive a fresh timeout. There is no shared deadline or cancellation signal. Six slow successful rounds can consume roughly 18 minutes before considering retry time. This is a permitted scenario, not the duration observed in the logs. |
| Website collection | `server/site.js`, `assertPublicHost`, `fetchOnce`, `fetchCitySite` | DNS validation occurs outside the 12-second fetch timeout. Redirects reset that timeout. The six-page limit counts successes, so failed pages can cause more fallback batches. No total crawl deadline exists. |
| Fallback | `server/ai.js`, `researchCity` (around line 652) | Any thrown error message matching `web_search`, `web_fetch`, or `tool` starts another research loop using fetched pages. It discards the first loop's progress and has no shared time/attempt budget. Tool errors returned inside successful responses also need explicit handling. |
| Result validation | `server/ai.js`, `researchGaps` | Missing required facts can trigger repeated research. Population and budget become optional on the second submission, but other missing fields can still exhaust the loop. Useful partial findings have no reviewable outcome. |
| HTTP lifecycle | `server/index.js`, `POST /api/searches/:id/research` (around line 1698) | One HTTP request stays open through crawling, all model rounds, and persistence. There is no job ID, resumable status, or duplicate-request protection. Disconnecting the browser does not cancel the work. |
| Error reporting | `server/ai.js`, `normalizeClaudeError`; `server/index.js`, `claudeFail` | SDK timeout errors inherit from `APIConnectionError`, so they become `CONNECTION_ERROR`. The research route omits a stable error code from most failure responses. Logs lose the detail needed to establish the upstream cause. |
| Loading UI | `public/app.js`, `showWait`, `withLookup`, `api`, research submit handler; `public/index.html`, `#lookup` | Four progress labels advance every eight seconds regardless of server activity. After about 24 seconds the dialog says it is writing the file, even if the API has not returned. The app is inert until the promise settles; there is no Cancel button, browser deadline, or persistent failure panel. `finally` does clean up when the promise settles, but cannot help while it remains pending. |

Anthropic documents automatic retries on connection errors and timeouts, and recommends streaming for long requests because idle connections can be dropped. Slate overrides the SDK retry count to one. [Anthropic TypeScript SDK documentation](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript#retries)

`pause_turn` itself is expected behavior for server tools. Continue the original content and tool definitions within a bounded operation; removing continuation support would break legitimate research. [Anthropic server-tool documentation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/server-tools#the-server-side-loop-and-pause_turn)

## Intended experience

After a consultant starts research, show the actual stage, elapsed time, and a Cancel action. Keep their entered facts safe. Report success only after the result has been saved. If the work fails, leave a persistent explanation with Retry and Continue manually actions. If research produces incomplete but supported findings, offer a review instead of silently discarding everything or inventing missing facts.

After the job lifecycle is implemented, the consultant can navigate elsewhere and return to the same research status. Refreshing or double-clicking must not create another paid run. Organization membership and search editing permissions apply to starting, viewing, cancelling, and applying results. Committee members do not gain research privileges.

## Implementation order

### 1. Bound requests and preserve the real error (first release)

Files: `server/ai.js`, `server/site.js`, `server/index.js`, `server/aibudget.js`, `server/telemetry.js`, `.env.example`, `render.yaml`.

- Introduce an operation context with a shared deadline, abort signal, operation ID, stage callback, and attempt/usage ledger. Start the deadline before website collection. Continuations and fallback reuse it.
- Proposed initial limits: **180 seconds total**, **25 seconds for website collection**, **60 seconds per model round**, and **four model rounds total**, including fallback. Reserve up to 30 seconds of the remaining operation budget for final synthesis. These are starting limits to validate, not a promise that every jurisdiction completes in three minutes.
- Add documented `SLATE_RESEARCH_TIMEOUT_MS`, `SLATE_RESEARCH_CRAWL_TIMEOUT_MS`, and `SLATE_RESEARCH_MAX_ROUNDS`. Validate their ranges. Honor `SLATE_AI_TIMEOUT_MS` as a per-round ceiling, additionally capped by the research limit and remaining time. Remove the hardcoded override.
- Disable automatic SDK retries for research initially (`maxRetries: 0` on research requests). Permit a single explicit transient retry only if later measurements justify it and sufficient shared budget remains. Never retry cancellation, invalid credentials, or malformed requests.
- Thread cancellation through crawling, redirects, DNS waits, provider calls, and response-body consumption. A DNS deadline must stop the operation and prevent a late resolver result from opening a socket; it need not pretend the underlying OS lookup is cancellable. Abort real work rather than only racing and ignoring its promise. Preserve private-address checks, DNS pinning, redirect validation, and source-text isolation.
- Bound attempted URLs as well as successful pages; retain useful pages when the crawl budget ends. Cancel unread response bodies and enforce the size limit while reading. Do not swallow cancellation in the crawler's broad catches.
- Use the provider's streaming Messages API server-side, accumulate the final typed response, and preserve tool blocks and usage. Keep an operation timer through the entire stream/body, not only until response headers arrive. Do not display partial JSON as finished research. Verify compatibility with the installed SDK before changing versions.
- Normalize timeout before generic connection errors. Return safe structured errors such as `RESEARCH_TIMEOUT` (504), `RESEARCH_CONNECTION_ERROR` (502), `AI_AUTH_ERROR` (503), `AI_RATE_LIMIT` (429), and `RESEARCH_INCOMPLETE` (422), with an operation reference and retry guidance. Keep raw provider details in sanitized operator telemetry only.
- Log stage transitions, elapsed stage time, round number, stop reason, SDK error class, safe underlying network error code, and provider request ID when present. Retain known usage on failure; mark unknown usage explicitly. Release concurrency slots exactly once on every terminal path.
- During this synchronous first release, cancel on a disconnected response only when it has not completed; do not use request-body completion as a disconnect signal. Check cancellation, permissions, and revision again before saving. No delayed write after cancellation.

Acceptance: an upstream call that never completes terminates within the shared deadline; changing the timeout changes observed behavior; cancellation halts downstream work; error responses distinguish timeout from authentication and connection failures. Other AI drafting routes keep their existing behavior.

### 2. Replace the trapped loading state (ship with step 1)

Files: `public/app.js`, `public/index.html`, `public/app.css` or the existing lookup styles.

- Add an AbortController and explicit deadline to the research operation, including pre-research fact saving and token acquisition. A token promise that finishes after cancellation must not start a fetch. Keep this change scoped; avoid assigning a research-length timeout to every API action.
- Remove simulated research stage advancement. Until step 3 provides real status, show an honest indeterminate state with elapsed time, rather than claiming a specific source was checked or saved.
- Provide Cancel and persistent failure/retry/manual-entry controls. Always remove `inert`, restore focus, and clear timers/listeners on success, failure, cancellation, navigation, or sign-out. Make status announcements accessible and avoid announcing every elapsed second.
- Give the browser a small grace period beyond the server deadline so the server can deliver its structured timeout response. If the connection fails first, show a connection-specific message without claiming that nothing was saved when the outcome is unknown.
- Preserve entered facts and existing community text. Do not turn a lost response into an automatic retry that might duplicate work. Maintain a single active browser operation and ignore late callbacks from a previous search or organization.

Acceptance: a permanently pending mocked request cannot trap the interface; Cancel returns control promptly; retry and manual entry are available after failure; saving is only reported after acknowledgement.

### 3. Give research a durable job lifecycle

Files: new `server/research-jobs.js`; `server/index.js`, `server/db.js`, `server/telemetry.js`, `public/app.js`, and storage/recovery tests.

Implement this after the deadline fix, so introducing background work cannot simply hide an unbounded task. Keep the current single-instance, single-writer architecture. Render's blueprint explicitly warns that two writers would overwrite the JSON store; do not attach a second worker to that file. A separate worker requires a transactional shared store/queue and is outside this initial repair.

| Contract | Behavior |
|---|---|
| `POST /api/searches/:id/research-jobs` | Validate input, editing permission, revision, quota, and idempotency key; persist a job before returning HTTP 202 with job ID and status URL |
| `GET /api/searches/:id/research-jobs/:jobId` | Return authorized status, real stage, elapsed time, deadline, safe error, and result availability |
| `POST /api/searches/:id/research-jobs/:jobId/cancel` | Idempotently request cancellation, abort active work, and prevent a later commit; if already saved, report the completed outcome |
| Search reload | Return the relevant active/latest job reference so refreshing or revisiting reconnects to the existing operation |
| Partial result application | Explicit review/apply action with fresh authorization and revision checking; partial results never silently overwrite facts |

- Persist bounded records containing organization/search/requester IDs, input snapshot and revision, idempotency key, timestamps/deadline, state/stage, result or safe failure, and measured usage. Do not persist API keys. Define migration, retention, backup, and per-search deletion behavior.
- Use states `queued`, `running`, `succeeded`, `partial`, `failed`, `cancelled`, and `interrupted`. Use a separate failure code for stale-search conflicts. Only transition to `succeeded` with the saved result and job outcome persisted together.
- Enforce one active research job per search, a bounded global queue, and existing concurrency limits. The total deadline includes queue waiting. Refuse excess work before accepting it; reserve capacity atomically so parallel requests cannot bypass limits.
- On restart or deployment, mark previously running jobs `interrupted`; do not silently replay a potentially billed request. Resume only unstarted, unexpired queued jobs. Persist state before exposing it and test storage failure paths.
- Revalidate current authoritative organization membership and editing rights before applying a result, as well as search existence, lifecycle, and revision. The current `stillAuthorized` uses the request's earlier access object; that is insufficient for a long-running job after membership changes.
- Poll with short per-request deadlines, approximately every two seconds while visible, backing off when hidden or disconnected. Stop on terminal state, workspace change, or sign-out. Keep polling errors distinct from job failure. Navigation no longer cancels server work; only explicit cancellation does. This deliberately replaces step 1's synchronous disconnect behavior.
- Roll out through a feature flag with both contracts temporarily supported. Retain the bounded synchronous path for rollback until the new client is verified. Do not remove the original endpoint while an already-open client depends on it.

Acceptance: startup acknowledgement is under two seconds in the local harness; refresh finds the same job; repeated starts with the same key create one operation; cancelling and saving cannot race into contradictory outcomes; restarts leave no permanent `running` jobs.

### 4. Make completion reliable and useful

Files: `server/ai.js`, `server/research-jobs.js`, `public/app.js`, and research result tests.

- Replace broad error-message matching with an explicit, tested tool-unavailable classification. Treat tool-result errors as well as top-level HTTP errors. Allow at most one fallback within the same deadline/round budget, retaining already collected sources and known usage.
- Separate source gathering from final synthesis. Near the budget limit, stop requesting more sources and use the remaining time to submit supported findings. Preserve server-tool continuation state correctly; do not remove a tool from a conversation that still has a pending call to it.
- Return a validated partial result with missing-field warnings when enough supported material exists. Allow unknown government form/population/budget to be represented as unknown, rather than repeatedly demanding unavailable information. Maintain citations and jurisdiction consistency. A refusal, truncated response, invalid structure, or zero usable evidence must have an explicit outcome.
- Preserve the previous completed research until replacement is successfully applied. Full results retain the current revision-safe save behavior; partial results require review. Do not label model submission as saved before the database write succeeds.
- Count usage across every round and fallback, including cache and reported server-tool usage where available. Label cost estimates and unknown usage accurately; do not reset accounting when a fallback begins.

Acceptance: missing public budget data yields supported partial findings or a clear failure within the deadline; there is no endless completeness loop and no unsupported fact is inserted to pass validation.

### 5. Verify and release

Extend the existing AI reliability and concurrency tests, with injected clocks/provider/site clients so tests do not need paid requests or multi-minute sleeps. Add focused browser coverage for the research screen.

| Scenario | Required assertion |
|---|---|
| Provider never answers; headers arrive but body stalls; stream stalls | Shared deadline aborts work, structured timeout appears, UI recovers, no late save |
| DNS stall, redirect chain, slow/error pages, oversize body | Crawl budget holds, network resources are released, usable pages survive, private-address protections remain intact |
| Repeated `pause_turn`, missing fields, malformed/truncated JSON | Round/time limits apply, tool state is preserved, result is partial or explicit failure |
| Invalid key, unavailable model/tool, 429, provider 5xx | Correct error classification; no inappropriate retry/fallback; safe telemetry |
| Cancel, duplicate click, lost start response, reload, tab return | One job, known status, no duplicate spend, focus restored, no stale callbacks |
| Concurrent edit, membership removal, organization switch, deleted/closed search | No unauthorized read/apply and no overwrite of newer work |
| Deploy/restart during work, queue full, persistence failure | Durable terminal state or explicit recovery, bounded queue, no false success |
| Failure after several successful rounds | Prior known usage retained; concurrency released once; unknown usage is visible |

Run `npm run check`, `npm test`, and the relevant Playwright tests before release. Preserve the existing organization, stale-write, budget, and SSRF regressions. A Markdown-only planning change does not require rerunning the application suite now.

After implementation, validate one bounded research run from the actual Render deployment against a public jurisdiction site, then verify saved facts/sources and reload behavior. This is the missing check for Messages/tool execution that the read-only Models API cannot provide. Record first response, crawl duration, model rounds, final status, total time, and usage; exercise cancellation separately. Recheck both standard and premium paths before enabling each for general use.

Keep credentials in Render environment settings, not GitHub or this document. Add only nonsecret limit/feature settings to deployment configuration. Leave Clerk roles, organization configuration, the persistent data directory, and unrelated UI unchanged.

Release gate: every accepted operation has a recoverable or terminal state; users can regain control immediately; every run finishes or stops within its configured overall deadline; successful research is demonstrably saved with sources. If the hosted connection error recurs, use the newly captured provider request IDs and stage timings to isolate the upstream failure before increasing limits.

## Work completed in this audit

- Inspected the browser, Express route, website crawler, Anthropic wrapper, budgets, telemetry, deployment configuration, and relevant existing tests.
- Verified current local/Render key authentication and model listing without printing credentials or generating research.
- Retrieved sanitized hosted research timings and checked the current live release/readiness.
- Reproduced the hardcoded timeout and six-round behavior against the actual function using a mocked provider.
- Created this implementation plan. Application behavior has not yet been changed or redeployed for this repair.
