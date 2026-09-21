# Deferred work

Things deliberately **not** done for the controlled pilot, with the reason and
the condition that would change the answer. Nothing here blocks the pilot. Each
is a backlog item, not an outstanding defect.

Deferring is a decision, so each item says what evidence would reverse it.
"It feels unconventional" is not evidence.

---

## 1. PostgreSQL migration

**Status: deferred. Not started, and must not be started on the strength of an
opinion about JSON files.**

The store is one JSON file with one writer, which is why `render.yaml` runs a
single instance. That is a real constraint and it is not, on its own, a reason
to migrate before anyone has measured it.

**The measurement that decides it** is the hosted load test
(`npm run test:hosted-load`) against the pilot envelope — 100 candidates, 15
accounts, 20 concurrent sessions — run twice: once with ordinary records, once
with records plus representative uploaded candidate PDFs. Capture p50, p95,
p99, max, errors, conflicts, event-loop delay, store size, backup size, and
write and read latency.

If the envelope holds, the JSON store stays for the pilot.

**What would force the migration regardless of the numbers:**

- more than one application instance (the single-writer lock is the whole
  design, and two instances would overwrite each other's records);
- concurrency beyond one writer per workspace;
- reporting or analytics across searches;
- relational integrity enforced by the database rather than by application code;
- a customer base where a whole-store rewrite per save stops being cheap.

**Sketch of the migration, for when it is justified** — recorded so it is not
re-derived under pressure, not as an approved plan:

1. Model the store as it is. `slate.json` already has a schema version and a
   migration path; the shapes are known and `server/db.js` is the only writer.
2. Keep `server/db.js` as the seam. Everything above it asks for searches,
   candidates and applications, not for rows. A migration that leaks SQL into
   routes would be a rewrite.
3. Dual-write behind a flag, read from JSON, compare. Divergence is a bug in
   the port, and finding it in production reads is cheaper than finding it in a
   cutover.
4. Move payload directories (`media/`, `application-files/`) to object storage
   *first* or *not at the same time*. Two storage migrations at once is how a
   restore stops working.
5. Re-prove the restore drill against the new store before cutting over. A
   backup format nobody has restored is not a backup.

---

## 2. Object storage for applicant materials

**Status: deferred. Growing a volume is the pilot answer.**

Applicant PDFs live on the app's disk under `DATA_DIR/application-files/`, and
every snapshot copies all of them again. The retention windows now bound that
(`docs/operations.md` §6a), and `/api/ready` reports what it costs and whether
the volume is under pressure.

**What would force it:** materials outgrowing a volume that can reasonably be
grown; more than one instance; or a records decision that puts candidate
documents somewhere the application does not control.

**Note for whoever does it:** the snapshot and restore path assumes the payload
directories are on the same filesystem as the store
(`server/backup.js` `PAYLOAD_DIRS`). Moving them off it means the snapshot is no
longer atomic with the store, which is a correctness change, not a plumbing
change.

---

## 3. Billing entitlements

**Status: deferred, and deliberately so — the service model is not decided.**

`SLATE_BILLING_MODE` and the subscriptions screen read published plans from
Clerk Billing and can take a payment. Nothing enforces an entitlement: no
search is refused, no seat is counted, no feature is gated.

That is the correct state, because the questions a paywall answers have not
been answered:

- priced per organization, per active search, per consultant, or per seat?
- an annual subscription, or a per-search package?
- what happens to an in-flight search when a subscription lapses — and what
  happens to the candidates in it?
- what does a committee member cost, given they are invited by the firm and
  may never sign in again?

**Do not implement a paywall before the service model is decided.** A gate
built against a guess has to be un-built, and the thing it would gate is
somebody's live hiring process.

---

## 4. Full monitoring platform

**Status: deferred. What exists is enough for a controlled pilot.**

Today: `/api/health` and `/api/ready`, structured logs with a request id
(`X-Request-Id`), event-loop delay, storage usage and pressure, retention
results, recovery status, and two alerts (`backup-overdue`,
`storage-unwritable`) to a configured destination.

Not done: log aggregation and search, error tracking, external uptime
monitoring, metric retention and dashboards.

**What would force it:** more than one instance; an on-call rotation that needs
history rather than a live endpoint; or a support process that needs to answer
"what happened last Tuesday" from something other than a container's stdout.

**Do not add SaaS dependencies to the pilot** to close this. Every one is a
processor the client has to approve, and a controlled pilot with named operators
watching a readiness endpoint is a reasonable amount of monitoring for the
number of people involved.

---

## 5. Module boundaries in the two large files

**Status: deferred, by rule.**

`public/app.js` and `server/index.js` are both large. They are not split here,
and size alone is not a reason to split them: a refactor that touches
everything is a refactor whose diff nobody can review, landing in the same
change as the fixes it would hide.

**The rule going forward: extract only when working in that area**, and only
when extracting materially reduces the risk of the change being made.

Boundaries that look right when the moment comes:

| Client (`public/app.js`) | Server (`server/index.js`) |
|---|---|
| theme / navigation shell | `routes/searches` |
| search setup | `routes/candidates` |
| committee | `routes/committee` |
| candidate review | `routes/organizations` |
| research | `routes/applications` |
| organization admin | `routes/research` |
| documents | `routes/operations` |
| recordkeeping | |

Explicitly **not** planned, and separate decisions if they are ever raised: no
framework migration, no React or Vue rewrite, no TypeScript migration, no
bundler.

---

## 6. Node version floor

**Status: noted, not a defect.**

`package.json` requires `>=24`; the container and CI run 24.20.0. Local
development on this machine is Node 22.18.0, which the application warns about
at startup and which is why local test results are recorded as corroborating
rather than authoritative in `docs/pilot-runs/`.

**Resolution:** bring the development machine to 24.x, or accept CI as the
authoritative runtime and say so in every release record.
