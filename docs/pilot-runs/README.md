# Pilot run evidence

Create one Markdown record per release rehearsal from `TEMPLATE.md`. Name it
with a UTC timestamp and short release id, for example
`2026-09-16T1800Z-a1b2c3d.md`.

`TABLETOP-SCRIPT.md` is the facilitation pack for the P2 session: copy it per
run and fill in the capture boxes during the session, not afterwards. Seed its
environment first with `npm run seed:tabletop`, and keep the manifest that
prints with the completed record — it says what the room started from.

Two records here are not release rehearsals and say so at the top:
`2026-09-16-local-working-tree.md` and `2026-09-16-late-stage-p4.md` are
implementation evidence from a dirty tree on an unsupported runtime. Neither
carries a gate, and neither may be cited as a pass for a later commit.

Evidence is release-specific. Record the commit and whether the tree was dirty;
if it was, attach a sanitized `git diff --binary` outside the repository and
record its checksum. Do not commit identity tokens, candidate bearer URLs,
credentials, raw provider prompts, unsanitized traces, or real candidate data.

The default local suites are safe against their own temporary stores. The
hosted harness is intentionally separate and refuses to start until all of the
following are supplied:

```powershell
$env:SLATE_HOSTED_URL = 'https://isolated-staging.example'
$env:SLATE_HOSTED_CONFIRM = 'I_AM_USING_SYNTHETIC_STAGING'
$env:SLATE_HOSTED_RUN_ID = 'pilot-20260916-abc123'
$env:SLATE_HOSTED_TOKENS = '<controlled Clerk session JWTs, comma separated>'
npm run test:hosted-load
```

The first token must belong to an administrator or consultant allowed to create
and remove synthetic searches. Every token used for a request loop must be a
consultant in that same workspace because the loop measures ordinary saves.
Use separate manual/API evidence for committee read-only latency and role
enforcement; the harness reports how many distinct tokens it actually used.

The default hosted profile is a 5-minute warmup, 15-minute measured load and
60-minute soak with 100 synthetic candidates and 20 request loops. Use
`SLATE_HOSTED_CLEANUP=true` only when the run owner wants the harness to delete
the exact synthetic search IDs it created. If a run stops early, its output
prints those IDs for scoped cleanup.
