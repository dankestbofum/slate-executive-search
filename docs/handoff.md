# Slate implementation handoff

Response to `CLAUDE_DEPLOYMENT_HANDOFF.md` §10.

**Release proposed for review:** the `account-controls` branch, on top of
`77ae9d75622a7d0d918eac2362d3522b6d8f10ab`.

Updated 12 September 2026. The version of this document dated 8 September
described release `9db2042`; since then Clerk became the only way in, the
deployment moved from Railway to Render, the workspace was redesigned around
recruiting destinations, and the three tickets that had shipped as API routes
with no interface now have one.

**Gate reached: none of the three.** Not "ready for synthetic staging", not
"ready for county review", not "ready for authorized pilot launch".

Gate 1 is close. CI has now been read (11 runs, all green), and the container
job passes every step — the image builds, refuses to start without storage or
credentials, boots on an empty volume, runs as non-root, survives a restart,
**shuts down cleanly on SIGTERM**, and restarts with no stale lock. That was
the blocker recorded in the first version of this document, and it is resolved.

What still blocks Gate 1 is coverage breadth, not the container. WebKit is now
covered, which removes one of the five items below. What remains: no real
device, no screen-reader pass, no print inspection, and no load test. §6 lists
it.

Note that the CI run counted above predates this branch. The container job has
not been re-read since Clerk, Render and the interface work landed, and the
WebKit job has never run in CI at all — it has only been run locally, on
Windows. That is the first thing to check, not the last.

---

## 1. Ticket status

All twelve tickets are implemented with automated coverage. "Implemented" here
means the code exists and is tested; it does not mean the ticket's acceptance
criteria are satisfied, which for several tickets requires evidence only a
person or real infrastructure can produce.

| Ticket | Commit | Implemented | Acceptance met |
|---|---|---|---|
| DEP-01 Runtime and release pipeline | `5a57a6a` | yes | **yes** — container verified in CI |
| DEP-02 Accounts, sessions, permissions | `caae399` | yes | yes |
| DEP-03 HTTP security and input bounds | `b0f1054` | yes | yes (CSP verified later, in DEP-12) |
| DEP-04 Failure-safe storage | `c0a6ac2` | yes | **partial** — shutdown verified in CI; load measured on a dev machine, not on Render |
| DEP-05 Scheduled recovery off-volume | `b62d3c5` | yes | **no** — no manual restore drill |
| DEP-06 Health and monitoring | `2596afe` | yes | **partial** — no named operator or alert recipient |
| DEP-07 County setup and fact verification | `2ac3e4f` | yes | **partial** — has a UI now; drafts never generated or reviewed |
| DEP-08 Candidate intake and recovery | `3f3a319` | yes | **partial** — has a UI now; no real-device submission |
| DEP-09 Withdrawal, disposition, closeout | `62e4250` | yes | **yes** — consultant UI added and covered in three browsers |
| DEP-10 Records export and attribution | `c922337` | yes | **partial** — no county records review |
| DEP-11 AI reliability and cost control | `9db2042` | yes | **no** — no real model call |
| DEP-12 Browser, accessibility, print | `01409a3` | yes | **partial** — two engines and print samples generated; no real device, screen reader, or paper sign-off |

Two commits precede these: `48a0d63` squashed pre-existing uncommitted work
into a working baseline (before it, `HEAD` could neither build nor test), and
`76598b9` added the plan and the prior audit.

## 2. Commands, versions, results

```bash
npm ci
npm run check          # 56 files parsed, 0 failed
npm test               # 482 checks, exit 0
npm run test:browser   # 162 checks, 0 failed (54 in each of three projects)
npm run preflight      # AI key and model entitlement (not run against a live account)
npm run test:load      # envelope measurement; read p95 42 ms, write p95 71 ms
npm run print:samples  # seven PDFs and PNGs for a person to review
```

| | |
|---|---|
| Runtime under test | Node **v22.18.0** (Windows) |
| Runtime in CI and the image | Node **24.20.0** LTS, pinned by digest |
| Browser | Chromium 153 and **WebKit 26.6** (Playwright 1.63), desktop each, plus Pixel 7 emulation |
| Container | **builds and boots** — verified in CI; Docker unavailable locally |
| CI | GitHub Actions, 11 runs all green as of `cdb2ce8` — **not re-read since**, and it has never run the WebKit project |

Server suite composition: 245 baseline, 37 integrity regression, 30 county, 28
security, 26 roles, 20 candidates, 19 disposition, 18 AI, 17 storage, 17
export, 14 monitoring, 11 recovery.

The suite grew from **298 to 482**, plus 162 browser checks that did not exist.

## 3. Stubs versus real external services

**Nothing in any automated suite calls an external service.** No paid model
call has been made at any point.

That sentence was not true the first time WebKit ran, and it is worth recording
why. Playwright does not intercept service-worker requests under WebKit, so once
Slate had registered its worker, a reload fetched Clerk’s real SDK from Clerk’s
real CDN — the fixture domain sits inside Clerk’s own wildcard, so it resolved.
Nine tests failed, which is how it was noticed. Service workers are now blocked
in that project. A claim to be offline is only as good as the engine it was
checked in.

| Area | How it was tested | Real service used |
|---|---|---|
| AI drafting and research | Deterministic failure paths, offline; the suite runs with no API key | **no** |
| Model IDs | Confirmed valid against the current API reference | **no** — account entitlement unverified |
| Outbound site fetching | Synthetic HTML; loopback, link-local, RFC1918, `file://`, `gopher://` all refused | **no** |
| Off-volume backup | Local temp directory as the second failure domain | **no** — no cloud destination |
| Alert delivery | Local webhook receiver; raise, deduplicate, clear proven end to end | **no** |
| Fonts | Downloaded once at vendoring time; served first-party thereafter | n/a |

## 4. Recovery, monitoring, rollback

**Restore:** the full path is exercised automatically on every run —
snapshot → copy off-volume → restore into an empty environment → verify the
search, committee seats and accounts, candidate answers *with their original
questions*, scores, history and brochure image, and that old sessions do not
come back. Measured at **36ms against synthetic data**.

That figure proves the mechanism and nothing about real recovery. **No manual
drill against real infrastructure has been run**, so there is no measured
recovery time, no measured recoverable snapshot age, and no evidence an
operator can do it under pressure. `docs/operations.md` §5 has the drill with
blanks for both figures.

**Backup configuration:** hourly in-process snapshots, verified before
publication. Off-volume copies are implemented (`SLATE_BACKUP_MIRROR` or
`SLATE_BACKUP_COMMAND`, optional AES-256-GCM) but **no destination is
configured**, so `/api/ready` reports `offVolumeCopy: "NOT CONFIGURED"`.

**Monitoring owner: none.** Alerts on `backup-overdue`, `storage-unwritable`
and `error-rate` work and are deduplicated, but no destination and no recipient
are configured. An alert with no named recipient is not monitoring.

**Load:** the plan's envelope was measured for the first time on 12 September
(`npm run test:load`, recorded in `docs/test-evidence.md`). Read p95 57 ms and
write p95 88 ms against a 1,000 ms target, 473 req/s, no unexpected responses.
On that evidence the JSON store is not the constraint at pilot size.

It surfaced the thing to watch and that has since been fixed: **history was the
growth, and each entry was a full snapshot** of criteria, scores and notes
rather than a delta, so it grew faster than linearly as scoring proceeded — 255
score saves produced 217 KB of history. A scoring entry now records only what
that save replaced. The same measurement, with more writes, puts history at
16.5 KB and the store at 186 KB, and read p95 improved from 57 ms to 42 ms.
Nothing left the record: what did not change is recorded where it did, and the
export labels every entry as a delta or a complete snapshot.

Growth is now bounded. **Retention is not** — how long any of it is kept is
still the county records officer's decision. And the measurement needs
repeating on Render, where a network disk changes the cost of the whole-file
write this design performs on every save.

**Rollback:** the path is defined and partly enforced — the store carries a
schema version, and a store written by a newer release is refused rather than
downgraded, which is the case where rollback turns into data loss. **It has
never been executed.** Rolling back the application and its matching snapshot
together is documented, not demonstrated.

## 5. What was found and fixed

Beyond the planned work, testing found defects that source reading had not:

- **The CSP shipped in DEP-03 was blocking the application's own styling.** It
  was verified by asserting on the response header; a real browser refused all
  37 inline style attributes. Found in DEP-12, four tickets later.
- **The candidate support contact was never rendered.** DEP-06 added it to the
  API and nothing displayed it, so a candidate needing an accommodation still
  had nowhere to go. Same for the submission receipt from DEP-08.
- **Questionnaire fields had no accessible names** — critical, on the one page
  used by members of the public.
- **A committed submission whose response was lost returned 409**, which reads
  as failure and invites a duplicate, conflicting submission.
- **Media replacement deleted the committed photo before saving the record**, so
  a failed save rolled back over an image that no longer existed.
- **Fetched web pages were interpolated raw into the research prompt.**
- **A closed search still accepted new candidates** — the freeze was wired to
  one route rather than to the request path.

## 6. Why no gate is reached

Gate 1, *technical staging ready*, requires: a supported container, all
relevant automated checks passing, security and storage controls implemented,
and synthetic browser and recovery evidence complete.

The first three hold, and are now evidenced rather than assumed: CI run
`cdb2ce8` builds the image and exercises every boot, restart and shutdown
assertion on Ubuntu with Node 24.20.0, and both suites pass there.

The fourth is incomplete. Browser evidence now covers two engines — Chromium
and WebKit, the engine every browser on iOS runs — but no real device, no
screen reader, and no print output has been looked at. DEP-12 is a P0 ticket
and its acceptance criterion explicitly requires real-device evidence and
visually inspected print examples. Recovery evidence is complete synthetically
but the manual drill has not been run.

Evidence gaps that block the gates:

| Missing | Blocks |
|---|---|
| Manual restore drill on real infrastructure | Gate 3 (the plan: "no off-volume restore evidence means no live pilot") |
| One authorised real draft and research run, with measured latency and cost | Gate 3 |
| A real phone and screen-reader testing | Gate 1 |
| Someone opening `print-samples/` and signing it off | Gate 1 |
| One CI run of this branch, including the WebKit project and the container job | Gate 1 |
| Load measurement repeated on the Render instance | Gate 1 |
| Named operator, backup operator, alert recipient | Gate 3 |
| Staffed candidate support contact | Gate 2 |
| Every decision in `docs/pilot-decisions.md` | Gate 2 |

## 7. Residual limitations

- **The new screens have never been used against real work.** Outcomes and
  closeout (DEP-09), county fact verification (DEP-07) and document and contact
  logging (DEP-08) now have a consultant interface, covered by browser tests in
  three projects. No consultant has run a search through them. The shape of
  these screens is a proposal about how the work is done, and it should be
  reviewed by someone who does it.
- **PWA and offline behaviour is covered in Chromium only.** Service workers
  are blocked in the WebKit project to keep it offline; see §3.
- **Clerk’s own components are unverified.** The sign-in modal and the account
  button are excluded from the accessibility scan and are stubbed in every test.
- **Automated accessibility scanning finds roughly a third of real problems.**
  Zero violations is a floor, not a conformance claim.
- **The decision history is recoverable history, not a tamper-evident audit
  log.** Anyone with write access to the store could alter it. Every export
  says so.
- **Rate limits and the AI ledger are per process and in memory.** Consistent
  with the single-writer model; not a defence against a distributed source, and
  they reset on restart.
- **The write lock is advisory and pid-based.** It protects one host, not two
  hosts sharing a network volume.
- **Bearer links remain bearer links.** `no-store` and `no-referrer` reduce how
  long and how widely a URL survives; they do not make it a session.
- **AI cost figures are estimates** against a published price table, not a bill.

## 8. Decisions that remain with the owner and the county

Registered in full in `docs/pilot-decisions.md`, none decided. The ones that
block live use regardless of code:

- Records custodian, classification, retention, legal hold, disclosure position
- County approval of AI processing, and a spending cap
- Off-volume backup destination, and who can restore if the hosting account is unavailable
- A staffed candidate support and accommodation contact
- Named primary and backup operator, and an alert recipient

The plan's rule stands: **do not enter real candidate information while a P0
control is unverified.**

## 9. Migration implications of this release

The store gains `schemaVersion` (0 → 1) on first boot, taking a pre-migration
snapshot first and failing closed if the migration errors. All other additions
are additive: `verification`, `dispositions`, `lifecycle`, `documents`,
`communications`, `drafts`, and actor ids on new activity. Existing JSON keys
are unchanged.

Brochure photos move to content-addressed filenames. Legacy `slot.jpg` files
are still served, so existing brochures keep rendering.

**A store written by this release cannot be read by an earlier one.** Rolling
back requires restoring the snapshot that matches the release.

## 10. Recommended next steps, in order

1. **Run CI on this branch and read it.** Everything new here is local
   verification on Windows. CI has not run since Clerk, Render and the
   interface work landed, and it has never run the WebKit project or built the
   container from this tree.
2. **Run `npm run preflight`** against the real account to confirm model
   entitlement. Costs nothing; consumes no tokens.
3. **Configure an off-volume backup destination and run the manual restore
   drill** (`docs/operations.md` §5). Record elapsed time and snapshot age.
4. **Name an operator, a backup, and an alert recipient.** Configure the
   destination and trigger a test alert.
5. **Have a consultant walk the new screens** — outcome, closeout, county fact
   verification, documents and the contact log — against a synthetic search,
   and say where the shape is wrong. They were built from the plan's wording,
   not from watching the work.
6. **Authorise one staging AI run** against synthetic records to measure
   latency and cost.
7. **Start the county conversations** in `docs/pilot-decisions.md`. Several
   have lead times measured in weeks and none depend on further code.
