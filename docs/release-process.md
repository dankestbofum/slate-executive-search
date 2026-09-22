# Release process

How a change gets from a working tree to a running service, and what has to be
true at each step.

The one rule this exists to enforce:

> **Red CI must not reach `main` by accident.**

`main` is the branch Render deploys. At the time of writing it is unprotected,
which is how two consecutive commits with failing checks became the production
branch (runs `35483806953` and `35490231645`). The settings in §3 are what stop
that; until they are applied, §1 is a convention and nothing enforces it.

---

## 1. The path

```
branch
  ↓
local tests          npm run check · npm test · npm run test:browser · npm audit --omit=dev
  ↓
pull request         one focused change, described in terms of what it fixes
  ↓
CI                   Syntax and isolated suite · Browser, accessibility and policy · Container build and boot
  ↓
merge to main        only with all three green
  ↓
Render deploy        automatic from main
  ↓
hosted verification  §4 — nothing counts as verified from a local run
```

### Before opening a pull request

```bash
npm ci
npm run check
npm test
npm run test:browser
npm audit --omit=dev
```

All four must pass. Record the totals; a release record that says "tests
passed" without numbers is not evidence.

Browser tests run three projects (`desktop-chrome`, `desktop-safari`,
`mobile-chrome`). A failure in one project only is still a failure — the mobile
project is emulation, but the interaction defects it catches are real, and the
last one it caught was a navigation drawer that closed under the user's finger
on a slow connection.

If a browser test is flaky, **find out why before changing the test**. Raising a
timeout, force-clicking, or disabling actionability checks converts a defect
report into silence.

---

## 2. Required checks

These three job names are what a branch protection rule must require. They are
the `name:` values in `.github/workflows/ci.yml` and are what GitHub matches on:

| Job | What it establishes |
|---|---|
| `Syntax and isolated suite` | Every first-party file parses; the isolated server suite passes; production dependencies have no known vulnerabilities |
| `Browser, accessibility and policy` | The app works in three browser projects, meets WCAG 2.1 AA under automated scanning, and enforces its Content-Security-Policy |
| `Container build and boot` | The image builds, refuses to start without persistent storage, boots on a writable volume, runs as non-root, keeps its data across a restart, drains cleanly on SIGTERM, and reports a release identity that matches the commit |

---

## 3. Branch protection settings for `main`

Apply these in **Settings → Branches → Add branch ruleset** (or Branch
protection rules) for `main`. Claude Code cannot change repository settings
without credentials for them, so these are written out to be applied by hand
and then recorded in the release record.

| Setting | Value | Why |
|---|---|---|
| Require a pull request before merging | **On** | Nothing reaches `main` without passing through CI |
| Required approvals | **0** | Deliberate. A solo development workflow cannot produce a second reviewer, and requiring one would make the rule get switched off. Raise it when there is a second maintainer |
| Dismiss stale approvals | On | Only meaningful once approvals are required |
| Require status checks to pass | **On** | The whole point |
| Required checks | `Syntax and isolated suite`, `Browser, accessibility and policy`, `Container build and boot` | Exactly the three in §2 |
| Require branches to be up to date before merging | **On** | Two branches that pass separately can fail together; this is what catches it |
| Require conversation resolution before merging | On | Cheap now, necessary as soon as review is part of the workflow |
| Block force pushes | **On** | A force push to `main` rewrites the history a deployed release is identified by |
| Restrict deletions | **On** | — |
| Restrict who can push | Maintainers only | Direct pushes bypass the checks above |
| Include administrators / enforce for admins | **On** | A rule the one person who can push is exempt from is not a rule |

Applied by: `[TO RECORD: who, when]`
Verified by: `[TO RECORD: a pull request with a deliberately failing check that
could not be merged]`

Verifying it is not optional. A protection rule that names a check GitHub never
sees — a renamed job, a workflow that does not run on pull requests — blocks
nothing and looks like it does.

---

## 4. Hosted verification

Render deploys `main`. A merge is not a release, and a green CI run says
nothing about the running service.

After a deploy, against the hosted URL:

| Check | Where | Pass condition |
|---|---|---|
| Release matches | `/api/health`, `/api/ready` | `releaseIdentity.agrees === true`, and the commit is the one that was merged |
| Liveness | `/api/health` | 200 |
| Readiness | `/api/ready` | 200, `ready: true`, schema version as expected |
| Storage | `/api/ready` | `storage.writable: true`; `storage.usage` within the volume |
| Retention | `/api/ready` | `storage.retention.failed` empty; snapshot count inside the windows |
| Recovery | `/api/ready` | `recovery.overdue: false`; `recovery.offVolumeCopy: "configured"` |
| Portal honesty | `/api/ready` | `portal.mail.productionCapable` and `portal.files.productionCapable` say what is actually true |
| Persistence | Render dashboard | Restart the service; records and application files survive |
| Lock | `/api/ready` after restart | No stale write lock |

Record the answers in a dated release record under `docs/pilot-runs/`, against
the **exact commit deployed**. Evidence from an earlier commit does not approve
a later one.

---

## 5. Mail provider setup checklist

`server/mailer.js` has no provider. The applicant portal cannot run an email
flow in production until one exists, and readiness reports that honestly rather
than letting a posting go live and go quiet.

None of the following are configured. Each is a `[TO ASSIGN]`, and none should
be recorded as done without evidence rather than intention.

| Item | Status | Evidence needed |
|---|---|---|
| Provider chosen | `[TO ASSIGN]` | The account, who controls it, and under whose contract |
| Sending domain | `[TO ASSIGN]` | The domain applicants will see mail from |
| SPF | `[TO ASSIGN]` | The published DNS record, and a message that passes it |
| DKIM | `[TO ASSIGN]` | Selector published and signing verified on a received message |
| DMARC | `[TO ASSIGN]` | Policy published, and a decision on what to do with reports |
| Sender identity | `[TO ASSIGN]` | The From name and address, and that a reply reaches a person |
| Bounce processing | `[TO ASSIGN]` | Where bounces go and who reads them |
| Complaint processing | `[TO ASSIGN]` | Where spam complaints go and who acts on them |
| Suppression handling | `[TO ASSIGN]` | That a suppressed address stops receiving mail |
| Controlled-recipient test | `[TO ASSIGN]` | A verification code and a receipt received at real mailboxes on at least two providers, by a named tester, with no real candidate involved |

Implementation, when a provider is chosen: `deliver()` in `server/mailer.js` is
the only function the rest of Slate calls, and the transport's name is added to
`PRODUCTION_CAPABLE`. Nothing above it assumes a message was delivered, so the
rest of the application does not change. `deliver()` returns a record whose
`state` distinguishes generated, accepted, delivered, bounced and failed —
never report better than the provider actually confirmed.

---

## 6. Malware scanning setup checklist

`server/application-files.js` has no scanner. `scan()` is the seam; whatever
replaces it returns the same shape, and must keep `state` (what a reviewer may
do) separate from `scanned` (whether anything looked at the bytes).

| Item | Status | Evidence needed |
|---|---|---|
| Scanner chosen | `[TO ASSIGN]` | What it is, where it runs, and who maintains it |
| Definitions updated | `[TO ASSIGN]` | How often, and how a stale database is noticed |
| Known-bad test | `[TO ASSIGN]` | An EICAR-style test file is quarantined and never becomes openable |
| Known-good test | `[TO ASSIGN]` | A real PDF clears and opens for an authorized reviewer only |
| Failure behaviour | `[TO ASSIGN]` | A scanner outage leaves files unopenable, never openable |
| Readiness | `[TO ASSIGN]` | `portal.files.productionCapable: true` reflects a scanner that actually ran |

Until this exists, a public intake runs with uploads **off**
(`SLATE_APPLICATION_UPLOADS`), or it does not run. See
`docs/search-operating-procedure.md` §5c.
