# Slate operations

Recovery, monitoring, and the restore drill. Written for the person on call.

This document describes what the software does today. Several things it depends
on — where the off-volume copy lives, how long backups are kept, who is
notified — are **owner and county decisions that have not been made**. They are
marked below. None of them can be answered by changing code.

---

## 1. What protects the data

Three layers, weakest to strongest:

| Layer | What it survives | Status |
|---|---|---|
| Local snapshots in `DATA_DIR/backups/` | A bad write, a bad migration, an accidental deletion | Working, automatic |
| Off-volume copy (`SLATE_BACKUP_MIRROR` or `SLATE_BACKUP_COMMAND`) | Losing the volume | **Mechanism built; destination not chosen** |
| Platform volume backups | Losing the volume, without depending on Slate | **Not configured; see §7** |

A local snapshot sits on the disk it is protecting. If the volume is lost, so
is every snapshot on it. **The off-volume copy is the one that matters**, and
until a destination is configured, `/api/ready` reports
`offVolumeCopy: "NOT CONFIGURED"`.

## 2. How snapshots run

Automatically, on a timer inside the app, hourly by default
(`SLATE_BACKUP_INTERVAL_MINUTES`, minimum 5).

They run **in the writing process**, which is what makes them consistent: a
save and a snapshot are both synchronous, so they cannot interleave. A snapshot
never catches a half-written store.

For the same reason, **do not run `scripts/backup.js snapshot` against a
running app.** Nothing orders an outside process against the writer. The CLI
refuses when it detects a live writer:

```
Slate is running against /data (pid 41). A snapshot taken from outside
that process can catch a write in progress.
```

Every published snapshot has already been verified against SHA-256 checksums
before it appears under its final name. A partial copy is never left where an
operator could mistake it for a backup.

Backups do **not** run on the request path. They used to run ahead of every API
call, including the health check, which put a whole-store copy on the latency
of ordinary work. A backup failure now alerts rather than turning every request
into an error.

## 3. Configuring the off-volume copy

Pick one:

```bash
# A path on a different volume or host mount.
SLATE_BACKUP_MIRROR=/mnt/offsite/slate

# Or hand each new snapshot to an approved tool. The snapshot path is appended
# as the last argument; no shell is involved.
SLATE_BACKUP_COMMAND="rclone copy --config /etc/rclone.conf"

# Optional: encrypt before it leaves the host. 32 bytes, hex or base64.
SLATE_BACKUP_KEY=<64 hex characters>
```

`SLATE_BACKUP_MIRROR` is refused if it resolves inside `DATA_DIR` — a copy on
the volume it protects is not a second failure domain.

Copies are **verified at the destination**, after arrival, not at the source. A
copy that was never checked at the far end is an assumption, not a backup.

If you set `SLATE_BACKUP_KEY`, store it somewhere that survives losing the
hosting account. **An encrypted backup with a lost key is not a backup.**

> **Owner decision — not made.** Which account and region hold the copy, who
> can restore it if the primary hosting account is unavailable, and whether the
> destination's own encryption at rest is sufficient instead of
> `SLATE_BACKUP_KEY`.

## 4. Monitoring

`GET /api/health` — cheap liveness. Use for the platform health check. No disk
work, no AI call.

`GET /api/ready` — readiness and recovery health, unauthenticated, reports
state only and never record contents:

```json
{
  "ready": true,
  "recovery": {
    "lastSnapshotAt": "2026-09-08T12:58:18.972Z",
    "snapshotAgeMinutes": 0,
    "mirrorConfigured": true,
    "mirrorAgeMinutes": 0,
    "lastMirrorError": null,
    "overdue": false,
    "offVolumeCopy": "configured"
  }
}
```

**Alert on `recovery.overdue === true`.** It goes true when a snapshot or an
off-volume copy has not succeeded within two intervals, or when either reported
an error. That is the moment the recovery point objective stops being met.

> **Owner decision — not made.** Who receives that alert, their backup, and
> expected response time. An alert with no named recipient is not monitoring.

## 5. The restore drill

Run this before the pilot opens, and repeat before any expansion. **No
off-volume restore evidence means no live pilot.**

```bash
# 1. Take the copy from the off-volume destination, not from DATA_DIR.
node scripts/backup.js verify   /mnt/offsite/slate/2026-09-08T12-00-00-000Z

# 1a. If encrypted:
SLATE_BACKUP_KEY=... node scripts/backup.js decrypt \
  /mnt/offsite/slate/2026-09-08T12-00-00-000Z /tmp/decrypted

# 2. Restore into an empty directory. It refuses a non-empty destination.
node scripts/backup.js restore /tmp/decrypted /tmp/restored

# 3. Start a separate instance against it, then check by hand.
NODE_ENV=production DATA_DIR=/tmp/restored PORT=4174 npm start
```

Verify, and write down what you found:

- [ ] The search opens, with the right client, position and revision
- [ ] Its committee members are still seated and can still sign in
- [ ] Candidate answers are present **with the original question text**
- [ ] Scores and history are intact
- [ ] Brochure images render
- [ ] **Old sessions do not work** — everyone must sign in again
- [ ] Elapsed time from starting to a working instance: __________
- [ ] Age of the snapshot you restored: __________

The last two are the actual recovery point and recovery time. Compare them to
the proposed one hour / four hours and record the gap if there is one.

`tests/recovery.js` runs this whole path automatically against synthetic data
on every CI run, including the off-volume copy and the assertion that sessions
do not come back. That proves the mechanism. **It does not substitute for the
manual drill against real infrastructure**, which is what proves the operator
can do it under pressure.

## 6. Retention

**Nothing is deleted automatically.** Snapshots accumulate until an operator
removes them. This is deliberate: retention is a records policy, and a
destructive job that runs before the policy exists could destroy something
under legal hold.

Monitor disk use. `/api/ready` reports snapshot counts; the volume's own
metrics report space.

> **Owner decision — not made.** The retention schedule, agreed with the county
> records officer, including legal holds. Keep the short operational rotation
> (how many recent snapshots to keep for recovery) separate from the official
> records retention period for search records — they are different questions
> with different owners.

## 7. Platform volume backups

Configure these as an additional layer that does not depend on Slate running
correctly. Railway documents
[volume backups](https://docs.railway.com/volumes/backups) and
[volume constraints](https://docs.railway.com/volumes/reference).

Verify what the account is actually set to rather than assuming a default.

## 8. Incidents

**Backup overdue or failing.** The app keeps serving. Read
`recovery.lastSnapshotError` / `lastMirrorError` on `/api/ready`. Usual causes:
the volume is full, the destination is unreachable, credentials for the copy
tool expired. Fix, then confirm `overdue` clears.

**Disk full.** Saves fail; the in-memory record rolls back to the last
committed state, so nothing is corrupted, but new work is not being saved. Free
space or grow the volume, then verify the most recent snapshot.

**Volume lost.** Restore per §5 into a new volume, deploy the release that
matches the snapshot's schema version (a store from a newer release is refused
rather than downgraded), and require everyone to sign in again. Reconcile any
candidate submissions made after the snapshot before asking anyone to resubmit
— check whether the original committed first.

**Suspected credential exposure.** `node scripts/accounts.js reset <id>`
revokes that account's sessions and issues a new PIN. See the account
administration section in README.

## 9. What is not covered here

- **Load and growth.** No load testing has been done. Whether the JSON store
  meets the pilot envelope is unmeasured.
- **AI spend and outage handling.** DEP-11.
- **Structured request logging and correlation-ID search.** Partly built
  (`X-Request-Id` is returned on every response); log aggregation and retention
  are DEP-06.
- **A named on-call rotation.** Owner decision.

---

## 10. Monitoring and logs (DEP-06)

### Endpoints

| Endpoint | Use | Cost |
|---|---|---|
| `GET /api/health` | Platform health check | Trivial. No disk, no AI |
| `GET /api/ready` | Readiness, recovery, metrics, alert status | One small write probe |

Keep the platform health check on `/api/health`. If it pointed at `/api/ready`,
an overdue backup would restart the container instead of paging someone.

`/api/ready` returns 503 when shutting down, when `DATA_DIR` is not writable,
or when the store's schema version does not match the build.

### Structured logs

One JSON object per line on stdout/stderr, for the platform to index:

```json
{"at":"2026-09-08T13:02:11.417Z","level":"info","event":"request","release":"b62d3c5",
 "ref":"9f2a1b7c4d0e8a35","method":"POST","route":"/api/searches/:search/candidates",
 "status":200,"ms":14,"actor":"u1"}
```

Events: `started`, `request`, `ai`, `alert`, `alert-delivery-failed`.

What is deliberately absent: request bodies, candidate answers, names, emails,
and bearer tokens. `route` is a template, so the log is not a list of which
searches exist, and `actor` is an opaque account id. Telemetry is read by more
people and kept longer than the record itself, and Slate holds applications
from people who have not told their employer they are looking.

### Finding a request from a support call

Every response carries `X-Request-Id`, and error replies repeat it as `ref`.
Ask the person for the reference they were shown, then search the logs:

```
ref="9f2a1b7c4d0e8a35"
```

That gives the route, status, timing, and actor — without the record contents.

### Metrics on `/api/ready`

Uptime, request counts by status class, error rate, slow requests (over 1s),
**event-loop delay**, memory, `DATA_DIR` size and file count, store size,
search counts, and AI calls / failures / latency / tokens.

Event-loop delay is the one to watch as volume grows. The store is rewritten
whole and synchronously, so the event loop degrades before CPU or memory does.
It is the cheapest early warning that JSON has stopped being adequate.

### Alerts

```bash
SLATE_ALERT_WEBHOOK=https://hooks.example.com/slate    # POSTs JSON
# or
SLATE_ALERT_COMMAND="/usr/local/bin/notify"            # JSON on stdin
```

Three conditions, checked every 60 seconds:

| Alert | Fires when |
|---|---|
| `backup-overdue` | No verified snapshot or off-volume copy within two intervals, or either errored |
| `storage-unwritable` | `DATA_DIR` refuses a write |
| `error-rate` | Over 5% server errors, after at least 20 requests |

Deduplicated: one notification when a condition starts, one when it clears. An
operator paged every minute stops reading pages.

Deliberately few. The things that actually lose a search are storage failing
and backups silently not happening.

**Drill:** unset `SLATE_BACKUP_MIRROR` and wait two intervals, or point
`DATA_DIR` at a read-only path in staging. Confirm `firing` on `/api/ready`
lists the alert, the destination received it, and it clears.

> **Owner decision — not made.** Who receives alerts, their backup, and the
> escalation path. `/api/ready` reports `"NOT CONFIGURED"` until a destination
> is set. An alert with no named recipient is not monitoring.

### AI outages

`ai.configured` and `ai.degraded` on `/api/ready` are separate from `ready`.
Drafting and research stop; opening searches, seating committees, scoring, and
candidate questionnaires all keep working. An Anthropic outage must never read
as Slate being down.

Failed AI calls are counted as well as successful ones — a failed call can
still have been billed.

### Candidate support contact

```bash
SLATE_SUPPORT_EMAIL=recruitment@example.gov
SLATE_SUPPORT_PHONE=+1-555-0100
SLATE_SUPPORT_HOURS="Weekdays 8am-5pm Arizona time"
```

Served on the candidate questionnaire page. Until configured, the page reports
support as unavailable rather than showing a contact nobody reads.

> **Owner decision — not made.** Who staffs this, during what hours, and how an
> accommodation request is handled. The plan requires it be visible and staffed
> for the pilot.

### Incident quick reference

| Symptom | First step |
|---|---|
| Someone cannot sign in | `node scripts/accounts.js list` — check for `disabled`; `reset` issues a new PIN |
| Candidate link not working | Replace it from the candidate record; old links stop working immediately |
| Candidate says a submission failed | Check whether it committed before asking them to resubmit |
| "This search changed since you opened it" | Expected stale-write protection. Their edits were not lost; copy, reload, reapply |
| Wrong copy published | Restore the prior revision from history; approvals invalidate on edit |
| AI unavailable | Confirm `ai.degraded`; manual work continues. Check the key and model access |
| Volume lost | §8, then §5 |
| Suspected disclosure | Reset affected credentials, replace candidate links, preserve logs, follow the county's incident procedure |
