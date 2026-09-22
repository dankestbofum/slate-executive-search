# Release readiness — production-readiness branch, 2026-09-21

Evidence for the remediation work on branch `production-readiness`, taken
against **that branch's tree** and no other. Nothing here is carried forward
from an earlier commit, and nothing is ticked because the code appears to
support it.

## Gate reached

> **Engineering checks complete, and green on CI against the release commit.**
> **Hosted verification pending. Human pilot pending.**

Not "controlled pilot ready". Six of the twelve conditions in the Definition of
Pilot Ready cannot be established from this machine at all, and two of them are
blocked on capabilities that do not exist yet in any deployment (a mail
provider and a malware scanner).

---

## Release and environment

| Field | Value |
|---|---|
| Branch | `production-readiness`, merged to `main` 2026-09-22 |
| Baseline commit | `1bea001` (`main` at start of work) |
| Release commit | `efef1b6` (merge of PR #9 into `main`) |
| Tree state | Working tree; see the change list in the pull request |
| Node (local) | v22.18.0 |
| Node (CI / container) | 24.x — `package.json` `engines` requires `>=24` |
| Platform (local) | Windows 11, npm 10.9.3 |
| Store schema version | 1 |
| Docker base image | `node:24.20.0-alpine` (digest-pinned; see `Dockerfile`) |
| Staging URL | `[TO RECORD]` |
| Clerk instance | `[TO RECORD]` — development fixture used locally |
| Backup destination | `[NOT CONFIGURED]` — `SLATE_BACKUP_MIRROR` / `SLATE_BACKUP_COMMAND` unset |

> **Local runtime is below the supported floor.** These results were produced on
> Node 22.18.0 against an `engines` floor of `>=24`. The application warns about
> this at startup. CI and the container run 24.x, so the CI run is the
> authoritative result; treat the local numbers as corroborating, not
> substituting.

---

## Automated evidence

**Authoritative result: CI run [35679015163](https://github.com/dankestbofum/slate-executive-search/actions/runs/35679015163)
against `efef1b6` on `main` — all three jobs green.** This is the first green
`main` run after two consecutive failures, and it includes the `mobile-chrome`
accessibility job that was failing.

| Job | Result |
|---|---|
| Syntax and isolated suite | **pass** — 0 vulnerabilities |
| Container build and boot | **pass** — all eight steps |
| Browser, accessibility and policy | **pass** — 320 passed, 0 failed, 28 skipped, 11.6m |

The local figures below corroborate it and do not substitute for it.

| Command | Result | Recorded |
|---|---|---|
| `npm run check` | **pass** | 101 files parsed, 0 failed; every runtime require present in the image |
| `npm test` | **pass** | 770 checks, 0 failed, exit 0 |
| `npm run test:browser` | **pass** | 320 passed, 0 failed, 28 skipped, across `desktop-chrome`, `desktop-safari`, `mobile-chrome` |
| `npm audit --omit=dev` | **pass** | 0 vulnerabilities |

`npm test` by suite: organizations 21 · billing (pass, untotalled) · baseline
258 · jurisdictions 30 · security 28 · roles 26 · authority 28 · storage 22 ·
recovery 28 · monitoring 19 · export 24 · candidates 21 · disposition 19 ·
AI 18 · research 55 · research UI 18 · integrity 40 · committee 28 · help 16 ·
portal 67.

**+22 checks against the baseline** (748 → 770), all new coverage for the
defects fixed here:

- `tests/recovery.js` 16 → **28** (+12): snapshot taxonomy; the scheduled
  window and bounded growth; the daily window left alone; the newest snapshot
  never removed; hand-labelled and held copies never removed; deletes confined
  to the backups directory; the scheduled run sweeping only after its own
  snapshot verified; the window's configuration floor; volume usage reporting;
  storage-pressure measurement; the volume being sampled rather than walked per
  readiness poll; and an incomplete backup never verifying.
- `tests/portal.js` 60 → **67** (+7): the pilot scanner refused in production;
  no deployment claiming a production-capable scanner; a scan result recording
  only what was established; an applicant never told a scan happened; scan
  metadata unforgeable through a request payload; no transport claiming real
  delivery; a handoff never recorded as a delivery.
- `tests/monitoring.js` 16 → **19** (+3): readiness reporting what the volume
  holds and what bounds it; readiness never claiming a capability the
  deployment does not have; and storage reporting counting bytes without ever
  naming a stored file.

Two further checks are in the browser suite, not this total:
`tests/browser/workspace.spec.js` now pins both halves of the drawer rule.

Two intermittent failures surfaced while establishing this, both on a loaded
machine, both diagnosed rather than retried:

1. **`[desktop-safari] late-stage.spec.js:458` — contention, not a defect.**
   Timed out at 30s inside the `finally` block closing three browser contexts,
   after its last assertion had already passed. It ran while `npm test` was
   using the same machine. In isolation it passes in 12.8s. No change made.

2. **`[mobile-chrome] welcome.spec.js:6` — a second latent theme-transition
   flake, fixed.** axe reported a serious `color-contrast` violation on
   `.btn--primary`: 4.38:1, foreground `#0d1420` on background `#4d7eb8`.
   `#4d7eb8` is in neither palette — it is the midpoint of the 120ms
   `background-color` transition between the light accent `#1D4E89` and the
   dark accent `#84B4EE` (`public/styles.css`). The test switched the colour
   scheme and scanned immediately, measuring a colour that never settles on
   screen. The settled dark pairing `#84B4EE` on `#0D1420` is **8.57:1**, so
   there is no real violation being hidden. Fixed by letting the palette
   arrive before scanning, in `welcome.spec.js` and in `onboarding.spec.js`
   which had the same pattern. `tests/browser/accessibility.spec.js` already
   guarded against this and documents why; these two did not.

3. **The settle added to the two scanning tests costs real time on WebKit, and
   is paid for rather than hidden.** Making the scans measure the screen that
   was asked for — rather than the one being left, which a same-document hash
   move leaves on the page — means waiting on the router's own fetches. On
   WebKit that roughly doubles both tests. A cheaper signal was tried and
   rejected on evidence: waiting for the breadcrumb's current-page label to
   change hangs whenever two views share a label, which they do. Both tests are
   therefore marked `test.slow()`, which the record-keeping test already was
   for exactly this reason. Measured on this machine (~3x slower than CI at
   WebKit): 23.6s and 37.3s against 90s budgets. This is a duration, not a
   defect, and it is not the fix for the CI failure in §1 — that is fixed in
   the application.

### A regression this work introduced, found by measurement and fixed

Adding storage reporting to `/api/ready` made that endpoint walk every file in
every snapshot — and do it **twice**, because the pressure judgement recomputed
the same figures the usage block had just produced.

Measured with the retention windows full (14 daily + 24 scheduled = 38
snapshots, each carrying a posting's worth of applicant PDFs, 959 MB total):

```
cold readiness cost: 974ms   (959MB over 38 snapshots)   <- after the fix
warm readiness cost:   0ms
warm readiness cost:   0ms

before the fix: 700ms-1.1s per walk, twice per request
```

`/api/ready` is documented as the endpoint a platform monitor polls. Left
alone, it would have spent roughly two seconds of disk reads per poll reading
the very volume it was reporting on. The figures are now sampled per directory
with a minute's life, carry `measuredAt` so nothing pretends they are live, and
are measured once and used for both answers; a sweep that deletes something
drops the sample. Pinned by `tests/recovery.js`.

Worth stating plainly: this was introduced by the remediation, not found in the
existing code, and it was caught by measuring rather than by a test failing.

### Baseline for comparison (commit `1bea001`, before this work)

| Command | Result |
|---|---|
| `npm run check` | 101 files parsed, 0 failed |
| `npm test` | 748 checks, exit 0 |
| `npm run test:browser` | not run to completion at baseline; `mobile-chrome` accessibility failing in CI |
| `npm audit --omit=dev` | 0 vulnerabilities |

### The CI failure this work started from

Two consecutive `main` runs failed, both on the same test:

```
[mobile-chrome] tests/browser/accessibility.spec.js:245
a populated workspace screen has no WCAG 2.1 AA violations, in either theme
Error: locator.click: Test timeout of 30000ms exceeded.
  - waiting for locator('button[data-theme="light"]')
  - element was detached from the DOM, retrying
  - 54 × waiting for element to be visible, enabled and stable
      - element is not visible
```

Runs `35483806953` and `35490231645`. `desktop-chrome` and `desktop-safari`
passed both times.

**Root cause — a real mobile interaction defect, not a flaky test.**
`go()` in `public/app.js` wrote `state.navOpen = false` at the moment a
navigation was *requested*. That flag was only applied to the DOM by the
`render()` at the *end* of the navigation, which can be seconds later on a slow
connection. Anyone who opened the navigation drawer inside that window had it
torn down under their finger when the screen landed. Below the breakpoint the
drawer is the only navigation there is, so this took the destination list and
the theme controls with it.

The trace says so exactly: the theme button resolves and is visible (the drawer
is open and sliding in), then *detaches* (the navigation's render), then is
**permanently** invisible for 54 retries (the re-render painted the drawer
closed). A timing-sensitive defect that a fast machine hides — all 5 local
repeats passed before the fix.

**Proven deterministically**, by holding the search fetch that the router
awaits before it commits the screen:

```
DIAG after menu click:        {"navOpenClass":true, "railVisibility":"visible",  "themeBtn":"visible"}
DIAG after navigation lands:  {"navOpenClass":false,"railVisibility":"hidden",   "themeBtn":"HIDDEN"}
```

and after the fix:

```
DIAG after menu click:        {"navOpenClass":true, "railVisibility":"visible", "themeBtn":"visible"}
DIAG after navigation lands:  {"navOpenClass":true, "railVisibility":"visible", "themeBtn":"visible"}
```

**Acceptance run (the plan's condition):**

```
npx playwright test tests/browser/accessibility.spec.js --project=mobile-chrome --repeat-each=10
120 passed (8.7m)
```

No timeout was raised, no actionability check was disabled, nothing was
force-clicked, and no test was skipped or removed.

### Bounded snapshot growth

From `tests/recovery.js`, the synthetic scheduled-snapshot test:

```
72 snapshots created
24 snapshots retained
48 snapshots deleted
185904 bytes before
 61968 bytes after
```

---

## Container evidence

| Check | Status |
|---|---|
| Image builds | **pass** |
| Refuses to start without persistent storage | **pass** |
| Boots on a writable volume (Clerk-only identity) | **pass** |
| Runs as a non-root process | **pass** |
| Restart retains data | **pass** |
| SIGTERM drains cleanly | **pass** |
| Write lock released on restart | **pass** |
| Release identity recorded | **pass** |

All eight are the named steps of the `Container build and boot` job, observed
green on CI run [35678579927](https://github.com/dankestbofum/slate-executive-search/actions/runs/35678579927)
(job 106590469430, 25s) against commit `3b15982` on this branch — not run on the
development machine, which has no Docker in this session.

> This is CI evidence for the branch head, not for a release commit. When this
> merges, the squashed or merged commit is a different SHA and needs its own
> green run before anything is deployed on the strength of it.

---

## Hosted evidence — NONE

Nothing in this section has been done. It cannot be done from a development
machine, and a local pass is not a substitute for any of it.

| Check | Status |
|---|---|
| Render release SHA matches the expected commit | **NOT RUN** |
| `releaseIdentity.agrees === true` on the deployment | **NOT RUN** |
| `/api/health` and `/api/ready` answer on the deployment | **NOT RUN** |
| Persistent disk survives a restart | **NOT RUN** |
| Store and application files intact after restart | **NOT RUN** |
| No stale write lock after clean restart | **NOT RUN** |
| Off-volume copy configured to a second failure domain | **NOT CONFIGURED** |
| Restore into a new empty location, from the off-volume copy | **NOT RUN** |
| Slate boots against the restored location | **NOT RUN** |
| Uploaded candidate materials intact after restore | **NOT RUN** |
| Elapsed recovery time recorded | **NOT RUN** |
| Snapshot age recorded | **NOT RUN** |
| Alert destination configured | **NOT CONFIGURED** |
| Synthetic `backup-overdue` delivered to a human | **NOT RUN** |
| Synthetic `storage-unwritable` delivered to a human | **NOT RUN** |
| Clerk rehearsal (12 cases: create, invite, accept, three roles, downgrade, removal, mid-session revocation, multi-org, switching, pending selection) | **NOT RUN** |
| Clerk directory latency recorded | **NOT RUN** |
| Hosted load test (`npm run test:hosted-load`, 100 candidates / 15 accounts / 20 concurrent) | **NOT RUN** |
| Hosted load test with representative uploaded PDFs | **NOT RUN** |

The load test decides whether the JSON store stays for the pilot. Until it has
run against the hosted service, **the question is open and no migration should
be started on the strength of an opinion about JSON files.**

---

## Human evidence — NONE

| Review | Status |
|---|---|
| Real phone check (iPhone Safari, Android Chrome) | **NOT RUN** |
| Screen-reader check (NVDA, VoiceOver) | **NOT RUN** |
| Print / PDF review | **NOT RUN** |
| Consultant tabletop against `server/authority.js` | **NOT RUN** |
| Candidate portal walkthrough | **NOT RUN** |
| Authority matrix accepted by a practising search professional | **NOT RUN** |
| Full synthetic search completed without developer intervention | **NOT RUN** |

The `mobile-chrome` project is **emulation**. It catches layout and interaction
defects — it caught the one this branch fixes — and it establishes nothing about
real iOS or Android browser behaviour. A phone in somebody's hand is still
required.

Automated accessibility scanning finds roughly a third of real accessibility
problems. A green axe run is not a claim that the application is usable with a
screen reader.

---

## Operational assignments — NONE ASSIGNED

| Role | Assigned to |
|---|---|
| Primary operator | `[TO ASSIGN]` |
| Backup operator | `[TO ASSIGN]` |
| Alert recipient | `[TO ASSIGN]` |
| Workspace administrator | `[TO ASSIGN]` |
| Records custodian | `[TO ASSIGN]` |
| Candidate support contact | `[TO ASSIGN]` |
| Incident-response owner | `[TO ASSIGN]` |

A pilot cannot start with these empty. An alert with no recipient is a log line.

---

## Policy decisions — NONE MADE

None of these are invented in code, and none should be.

| Decision | Status | Owner |
|---|---|---|
| Candidate privacy notice | `[NOT DECIDED]` | Client / counsel |
| Candidate data-use notice | `[NOT DECIDED]` | Client / counsel |
| Records classification | `[NOT DECIDED]` | Records custodian |
| Records retention | `[NOT DECIDED]` | Records custodian + counsel |
| Legal hold process | `[NOT DECIDED]` | Counsel |
| AI processor approval | `[NOT DECIDED]` | Client |
| Upload policy (on or off for this engagement) | `[NOT DECIDED]` | Client + owner |
| Resume / document storage policy | `[NOT DECIDED]` | Records custodian |
| Support / accommodation process | `[NOT DECIDED]` | Owner |

The mechanics each of these has to govern are now written down
(`docs/operations.md` §6, `docs/search-operating-procedure.md` §5). The
decisions themselves are not engineering's to make.

---

## Definition of Pilot Ready — condition by condition

| # | Condition | Status |
|---|---|---|
| 1 | Current CI is fully green | **YES** — all three jobs green on `efef1b6`, run 35679015163 |
| 2 | The release commit is identifiable | **Mechanism yes** (`releaseIdentity` on `/api/health` and `/api/ready`); `efef1b6` is the release commit; **unverified on the deployment** |
| 3 | Direct red pushes to `main` are prevented | **NO** — settings written out in `docs/release-process.md` §3, not applied |
| 4 | Backup growth is bounded | **YES** — fixed and tested; see the synthetic run above |
| 5 | Off-volume recovery has been proven | **NO** — mechanism tested in CI; no destination configured, no hosted drill |
| 6 | Alerts reach a named human | **NO** — no destination, no recipient |
| 7 | Hosted Clerk organization behaviour rehearsed | **NO** |
| 8 | Operational documents match current software | **YES** — reconciled in this branch |
| 9 | Authority matrix reviewed by a practising search professional | **NO** |
| 10 | A full synthetic search completed without developer intervention | **NO** |
| 11 | Candidate uploads disabled **or** protected by a real scanner | **Enforceable, not decided.** No scanner exists; `accept-all` is now refused in production, so a production deployment cannot silently serve unscanned files to reviewers. The engagement still has to choose |
| 12 | Public intake disabled **or** backed by a real mail provider and approved procedures | **Enforceable, not decided.** No provider exists; a production portal now offers no email flow at all, so it cannot collect an address and go quiet. The engagement still has to choose |

Five of twelve. Conditions 1, 4 and 8 were closed by this work; 11 and 12 moved
from "silently possible to get wrong" to "impossible to get wrong by accident,
still undecided".

---

## Sign-off

- Engineering checks: complete, on the evidence above.
- Hosted verification: **pending**.
- Human pilot: **pending**.
- Owner decision: **NOT DECIDED**.

Do not enter real candidate information while any of the above is outstanding.
