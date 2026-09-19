# Hosted API investigation, September 16, 2026 (Arizona)

Target: https://slate-executive-search.onrender.com

## Conclusion

The web service is up, but its diagnostics confirm a failed AI operation. The
leading explanation is the 60-second provider-round deadline, not a general
API outage. This remains a hypothesis until the failed job's code or Render
log entry is inspected. No production records or deployment settings were
changed during this investigation.

## Direct observations

Read-only requests made around 03:00 UTC on September 17:

| Check | Observed result |
| --- | --- |
| `/api/health` | HTTP 200, `ok: true`, Node 24.20.0 |
| `/api/ready` | HTTP 200, `ready: true`, storage writable |
| AI configuration | Key present; this does not validate the deployed key |
| AI metrics since process start | 1 call, 1 failure, average latency 62,211 ms |
| AI usage | Unknown for the failed attempt; zero reported tokens is not proof of zero billing |
| Research jobs | Enabled; 1 stored job, none queued or running |
| Research limits | Total 180,000 ms; crawl 25,000 ms; one model round 60,000 ms; four rounds; zero SDK retries |
| Authentication configuration | Clerk configured with a development (`pk_test_`) instance |
| Release identifier | `16df65715938811ea650e0a82b0236ea2b694903` |

The agent downloaded `/app.js` and confirmed that it exactly matches local
`public/app.js`, SHA256
`5474e4315c2f61a5be5c70ff41065b7d66ffdbeca8b50d741ea57f2d9cbfae02`.
See [UI findings](ui-findings.md).

## Provider check and real research diagnostic

Using the local `.env` credentials, without printing credentials:

- Anthropic's read-only Models API accepted both `claude-sonnet-5` and
  `claude-opus-5`. These IDs are also listed in the current
  [official model documentation](https://platform.claude.com/docs/en/models/overview).
- One bounded call to the application's `researchCity()` researched City of
  Eloy, Arizona, from `https://www.eloyaz.gov`, for a City Manager position.
- It completed successfully in **47,999 ms**, with four crawled pages and two
  model rounds of **26,540 ms** and **19,118 ms**. It returned a complete result
  with no missing-field warnings.
- Reported usage: 55,350 input tokens, 4,401 output tokens, 56,355 cache-read
  input tokens, and 54,721 cache-creation input tokens. This was a real provider
  call and may incur API charges; no claim of exact cost is made.
- This called the local research module directly. It did not create or change
  a search in local storage or on Render. It does not establish that Render
  has the same API credential, networking, or model overrides.

## Why the timeout is the leading explanation

`server/ai.js:149` starts a timer covering the entire provider stream, including
the provider's web searches and page fetches. `server/research-op.js:35` sets
its default to 60 seconds. If the first round reaches that limit before a
usable submission, the operation fails immediately even when much of the
three-minute total budget remains. The page-only fallback does not handle a
timeout. A roughly two-second crawl followed by this round limit is consistent
with the observed 62.211-second hosted failure.

This is an inference. A connection problem or another failure can also happen
after approximately that duration. The successful local run establishes that
the path can succeed, not that the production failure was transient.

To confirm, inspect the Render `research-job-failed` event for the affected job:
`code`, `stage`, `rounds`, `elapsedMs`, `attempts`, `network`, and
`providerRequestId`. Alternatively, read the authenticated job response's
`failure.code` and operation reference. Do not expose API keys or session tokens.

If the code is `TIMEOUT`/`RESEARCH_TIMEOUT` at the first round, measure a bounded
retry before changing `SLATE_RESEARCH_ROUND_TIMEOUT_MS`. The current three-minute
overall deadline still applies. Increasing limits without this evidence could
make genuine network failures take longer and consume more resources.

## Additional diagnostic issues

1. **Readiness reports AI as healthy based only on key presence.** The live
   response says `ai.degraded: false` despite its only AI call failing. This
   does not establish working model access. Keep app liveness independent,
   but distinguish configuration from recent AI operational health.
2. **The release stamp is inconsistent with deployed behavior.** The reported
   commit predates `server/research-jobs.js`, yet production exposes its job
   diagnostics and serves the current application JavaScript. The stamp
   cannot reliably identify the deployed code. Inspect the Render release
   environment/build configuration before using it for rollback decisions.
3. **The documented local preflight command does not load `.env`.**
   `npm run preflight` executes `scripts/preflight.js`, which reads process
   environment variables but does not load the local file. This investigation
   explicitly loaded dotenv first. The container also copies only two utility
   scripts, so `scripts/preflight.js` is absent from the Docker image.

## Coverage limits

The production failed-job details and authenticated search flow were not
accessible from the anonymous session. The user's original jurisdiction and
error text were requested but not available when these notes were written.
No root-cause fix was deployed. Browser observations and remaining UI coverage
are recorded separately in [UI findings](ui-findings.md).
