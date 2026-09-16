# Research reliability: implementation status

Companion to [RESEARCH_RELIABILITY_IMPLEMENTATION_PLAN.md](RESEARCH_RELIABILITY_IMPLEMENTATION_PLAN.md).
Status: **all five steps implemented; the hosted validation run in step 5 is still outstanding.**

The diagnosis is unchanged: research failed after about six minutes, which is a
180-second attempt plus one automatic retry, and nothing in the application
could tell whether the cause was provider latency, a dropped idle connection,
or another network failure — because a timeout, an aborted request and a dropped
socket all arrived as the same `CONNECTION_ERROR`.

## What was built

### 1. Bound requests and preserve the real error

New `server/research-op.js` is the operation context: one deadline, one abort
signal, one round allowance, and a ledger of attempts and usage. It is created
before the crawl and shared by continuations and the fallback, so the pieces
that each carried their own timeout now answer to one.

| Limit | Default | Range | Variable |
|---|---|---|---|
| Whole operation, queue wait included | 180 s | 15 s – 900 s | `SLATE_RESEARCH_TIMEOUT_MS` |
| Website crawl | 25 s | 1 s – 120 s | `SLATE_RESEARCH_CRAWL_TIMEOUT_MS` |
| One model round | 60 s | 5 s – 600 s | `SLATE_RESEARCH_ROUND_TIMEOUT_MS` |
| Model rounds, fallback included | 4 | 1 – 8 | `SLATE_RESEARCH_MAX_ROUNDS` |
| Reserved for final synthesis | 30 s | — | (derived, at most half the total) |

`SLATE_AI_TIMEOUT_MS` keeps its meaning as the per-provider-call ceiling and
additionally caps one round; the hardcoded `{ timeout: 180000 }` override in
`runResearchAgent` is gone. Values outside those ranges are clamped rather than
honoured, in `research-op.js` and in `server/aibudget.js`: a limit one typo in a
platform variable can remove is not a limit.

- **Automatic SDK retries are off for research** (`maxRetries: 0`). Nothing
  retries a cancellation, an invalid credential, or a malformed request.
- **Provider calls are streamed** (`messages.stream` → `finalMessage()`), with
  the round timer running to the last event of the stream rather than to the
  arrival of response headers. Anthropic recommends streaming for long requests
  because an idle connection can be dropped, which is a plausible reading of the
  observed failures. Tool blocks and usage are preserved; partial JSON is never
  shown as finished research.
- **Cancellation reaches real work.** `server/site.js` threads the operation's
  signal into DNS waits, sockets and response bodies. The DNS lookup has its own
  deadline and a late resolver answer is discarded rather than used to open a
  socket — it does not pretend the OS lookup is cancellable, it guarantees its
  result is not acted on. Redirect chains share one deadline instead of
  resetting it per hop, response bodies are size-limited while they are read,
  unread bodies are cancelled, attempted URLs are bounded as well as successes,
  and pages already read survive a truncated crawl. The crawler's broad catch
  still swallows one unreadable page and no longer swallows cancellation.
  Private-address checks, DNS pinning, redirect validation and source-text
  isolation are unchanged.
- **Errors are classified most-specific first.** `normalizeClaudeError` reads
  the operation's own verdict before the transport's, then timeout before
  generic connection failure (`APIConnectionTimeoutError` extends
  `APIConnectionError`; testing the base class first is what produced the
  ambiguous logs).

| Outcome | HTTP | Code |
|---|---|---|
| Deadline expired | 504 | `RESEARCH_TIMEOUT` |
| Dropped or failed connection, provider 5xx | 502 | `RESEARCH_CONNECTION_ERROR` |
| Missing or invalid key | 503 | `AI_AUTH_ERROR` |
| Rate limited | 429 | `AI_RATE_LIMIT` |
| Supported findings, named gaps | 422 | `RESEARCH_INCOMPLETE` |
| Cancelled | 409 | `RESEARCH_CANCELLED` |

Every failure response carries an operation reference. The provider's request
id, the SDK error class and the underlying network code (`ECONNRESET` and the
like) go to `telemetry.log`, with stage timings, round number, stop reason and
the per-attempt ledger — the fields the earlier logs did not record, and the
ones a decision to raise a limit should be based on. Known usage is retained on
failure and unknown usage is marked unknown, not zero. Concurrency slots are
released exactly once on every terminal path.

Other AI drafting routes are untouched: `generate` keeps its client, its
timeout, its retry count and `claudeFail`.

### 2. An honest loading state

- The simulated four-step list is gone. The dialog shows the stage the server
  reported (`crawling`, `researching`, `synthesizing`, `saving`) in a polite
  live region and a real elapsed clock beside it, hidden from screen readers so
  the second is not announced every second. It can no longer claim it is writing
  the search file after twenty-four seconds regardless of what the server is
  doing.
- **Cancel** returns control immediately and then tells the server; Escape does
  the same. `inert` is removed unconditionally, timers are cleared, and focus
  returns to the control that opened the dialog.
- Failure leaves a **persistent panel** on the community and search-facts
  screens with Retry, Reload, and fill-by-hand, carrying the operation
  reference. A toast is gone before it has been read; this is the one message a
  consultant has to act on.
- One operation per tab, with a token that invalidates a response belonging to a
  previous search, a previous workspace, or a cancelled attempt. The abort
  signal covers saving the typed facts and acquiring the auth token, so a token
  promise that settles after cancellation cannot start a fetch.
- Beyond the server's deadline plus a 20-second grace, or after repeated failed
  status checks, the browser says the outcome is **not known** and offers a
  reload. It does not claim nothing was saved, because it cannot see the server.
  A failed poll is reported as reconnecting, distinctly from a failed job.

### 3. A durable job lifecycle

New `server/research-jobs.js`. Store schema 5 → 6 adds an empty `researchJobs`
table. Deliberately still one process and one writer: the Render blueprint says
plainly that a second writer would overwrite the JSON store, so this is an
in-process queue with a durable record, not a worker.

| Contract | Behaviour |
|---|---|
| `POST /api/searches/:id/research-jobs` | Validates input, editing permission, revision, quota and idempotency key; persists the job, then answers **202** with its id and status address |
| `GET …/research-jobs/:jobId` | Real stage, elapsed time, deadline, safe failure, and whether a result is waiting |
| `POST …/research-jobs/:jobId/cancel` | Idempotent; aborts live work and prevents a later commit; a job that already saved reports the completed outcome |
| `POST …/research-jobs/:jobId/apply` | Applies findings held for review, re-checking authority and revision at that moment |
| Search reload | Every read carries `researchJob`, so refreshing or revisiting reconnects |

- States: `queued`, `running`, `succeeded`, `partial`, `failed`, `cancelled`,
  `interrupted`. Stale-search conflicts get their own failure code and keep
  their findings for review rather than discarding paid work.
- One active job per search; a bounded global queue refused before acceptance;
  the existing concurrency allowance shared with drafting. Capacity is reserved
  in the same synchronous turn as the check, which holds because this process is
  the only writer.
- The total deadline includes queue waiting.
- A restart marks running jobs `interrupted` and **never replays** them: the
  request may already have been billed. Only unexpired queued jobs resume.
- Authority is revalidated against the directory before the write, not inherited
  from the request that started the job minutes earlier (`auth.accessFor`). A
  directory outage refuses the write rather than guessing.
- Records hold no credentials. Retention is bounded (60 records, 7 days), and
  deleting a search stops its work and removes its history.
- Cancelling skips the revision precondition and the frozen-search refusal:
  stopping work is not an edit, and needing a reload first would mean a paid
  operation nobody can stop.
- `SLATE_RESEARCH_JOBS=off` serves the synchronous contract only. The
  synchronous route is retained and bounded the same way, and an already-open
  client falls back to it.

### 4. Completion that is reliable and useful

- The fallback trigger was `/web_search|web_fetch|tool/i.test(err.message)`,
  which matched a rate limit that happened to name a tool and answered it by
  discarding the first loop's progress. It is now an explicit classification
  over the error subclass and the structured body, plus a separate check for a
  successful response whose tool results all failed as unavailable — a case the
  message test could not see at all. At most one fallback, inside the same
  deadline and round budget, retaining sources and usage. Tool definitions are
  never removed from a conversation that referenced them; the fallback starts a
  fresh conversation.
- Source gathering and synthesis are separated. Near the budget limit the agent
  is told to stop searching and submit what it has.
- Unknown form of government, population and budget may stand as unknown after
  the first ask. A submission accepted with blanks comes back as a **partial
  with those blanks named**, not as a finished file whose gaps nobody mentioned.
  A refusal, a truncated response, or zero usable evidence each gets an explicit
  outcome.
- Applying a partial fills blanks and keeps anything a consultant already
  entered, including the previous completed research; what it declined to
  overwrite is named back to them. The model's submission is acknowledged as
  "recorded for review", never as saved, because the database write happens
  afterwards and can still be refused.
- Usage is counted across every round and both loops, and is not reset when a
  fallback begins.

### 5. Verification

`tests/research.js` (new, 47 checks) and `tests/browser/research.spec.js` (new).
Everything is offline: an injected clock, a mock provider, a mock store. No
billed call is made.

| Scenario | Covered by |
|---|---|
| Provider never answers; a stream stalls after headers | `tests/research.js` — deadline aborts, `TIMEOUT` classification, elapsed under the bound |
| Cancellation mid-round | Reported as `RESEARCH_CANCELLED`, not as a provider fault |
| Repeated `pause_turn`, malformed JSON, refusal, truncation | Round limits hold; explicit outcome in each case |
| Missing budget or population | Asked once, then allowed as unknown; returned as a partial with warnings |
| Invalid key, unavailable model, 429, provider 5xx, tool-result errors | Correct classification; no inappropriate retry or fallback |
| Usage after a failure following successful rounds | Earlier rounds still counted; unknown usage visible |
| DNS deadline, crawl budget, attempt cap, SSRF protections | `tests/research.js` |
| Cancel, duplicate start, one job per search, queue full, concurrency | Job-manager harness |
| Concurrent edit, lost authority, directory outage, deleted search | Job-manager harness; no unauthorized write, no overwrite of newer work |
| Restart during work, persistence failure | Marked `interrupted`, never replayed; no permanent `running` |
| A request that never answers cannot trap the interface | `tests/browser/research.spec.js` — Cancel restores the page and `inert` |
| Real stage and elapsed time; no false "saving" claim | Browser spec |
| Persistent failure panel with retry and manual entry | Browser spec |
| Partial findings offered for review, not applied | Browser spec |
| Reload reconnects to a running operation | Browser spec |
| A second click starts one operation | Browser spec |

`npm run check` and `npm test` pass (566 checks). The organization, stale-write,
budget and SSRF regressions are unchanged. `tests/auth.js` was updated for
schema 6 and `tests/jurisdictions.js` stubs the new notice band.

## Still outstanding

- **One bounded research run against the hosted Render deployment**, on a public
  jurisdiction site, recording first response, crawl duration, model rounds,
  final status, total time and usage; then verifying the saved facts and sources
  and the reload behaviour. That is the check the read-only Models API cannot
  provide, and it is the only way to know whether 180 seconds is the right
  starting limit. Cancellation should be exercised separately, and the standard
  and premium paths rechecked before either is enabled generally.
- The limits in this release are **starting limits to validate**, not a promise
  that every jurisdiction completes in three minutes. If the hosted connection
  error recurs, the newly captured provider request ids and stage timings are
  what should isolate the upstream cause — before any limit is raised.
- Clerk roles, organization configuration, the persistent data directory and
  unrelated UI are unchanged. Credentials remain in Render's environment
  settings; only the nonsecret limits were added to the blueprint.
