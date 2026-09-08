# Release checklist

Worked through in order. Nothing is ticked here on the basis that the code
exists — a box is ticked when someone has seen the evidence.

Status as of `9db2042`: **no gate reached.** See `docs/handoff.md` §6.

---

## Gate 1 — Technical staging ready

### Automated checks

- [x] `npm run check` — 46 files parsed, 0 failed
- [x] `npm test` — 476 checks, exit 0
- [x] `npm run test:browser` — 39 checks, 0 failed
- [x] `npm audit --omit=dev` — 0 vulnerabilities
- [ ] **A CI run has been observed to pass.** All results above are local.

### Container

- [ ] The image builds. *Never attempted — Docker unavailable in development.*
- [ ] It refuses to start without `DATA_DIR` *(asserted in CI; CI unobserved)*
- [ ] It refuses to start without first-boot credentials *(same)*
- [ ] It boots on an empty writable volume *(same)*
- [ ] It runs as a non-root user *(same)*
- [ ] It survives a restart with records intact *(same)*
- [ ] It shuts down cleanly on SIGTERM and releases the write lock
      *(unverifiable on Windows; asserted in CI via `docker stop`)*
- [ ] Release identity recorded: commit and image digest

### Security and storage

- [x] Security headers, CSP enforced by a real browser, CSRF, input bounds
- [x] Permission matrix across every role, including disabled accounts
- [x] Credential strength policy; weak-credential audit
- [x] Failure-safe media commit; schema version; single-writer lock
- [x] No secret, session, or bearer token in any export or log

### Coverage still missing

- [ ] Safari / WebKit
- [ ] A real phone (iPhone Safari, Android Chrome)
- [ ] Screen-reader pass (NVDA, JAWS, or VoiceOver)
- [ ] Print and PDF output visually inspected
- [ ] Load test against the pilot envelope: 100 candidates, 15 accounts,
      20 concurrent sessions, p95 under 1s

### Recovery

- [x] Snapshot, off-volume copy, and restore verified automatically (36ms, synthetic)
- [ ] **Off-volume destination configured**
- [ ] **Manual restore drill on real infrastructure**
      — elapsed time: ________  snapshot age: ________
- [ ] Platform volume backups configured
- [ ] A rollback executed at least once

---

## Gate 2 — County onboarding ready

None of this is code. All of it is in `docs/pilot-decisions.md`.

- [ ] County identified
- [ ] County-approved job description and official position title
- [ ] Appointing body and statutory authority confirmed by counsel
- [ ] Service package confirmed
- [ ] Records custodian named
- [ ] Records classification and retention schedule assigned
- [ ] Legal-hold and disclosure procedures defined
- [ ] Candidate privacy and data-use notice approved
- [ ] AI processing approved, with a spending cap
- [ ] Hosting vendor, region, and procurement approved
- [ ] MFA/SSO requirement decided
- [ ] Accessibility standard and deadlines confirmed
- [ ] Resume repository chosen and access rules agreed
- [ ] **Support and accommodation contact staffed**, with hours
- [ ] Whether tamper-evident audit storage is required

---

## Gate 3 — Live pilot ready

- [ ] Gate 1 and Gate 2 complete
- [ ] Staging rehearsal accepted by the owner
- [ ] Production storage, secrets, and monitoring configured
- [ ] Independent backup verified by restoring it
- [ ] **Named primary operator:** ____________________
- [ ] **Named backup operator:** ____________________
- [ ] **Alert recipient and escalation:** ____________________
- [ ] Operators have executed the runbook once
- [ ] Demonstration credentials disabled; `accounts.js audit` clean
- [ ] One authorised AI run measured for latency and cost
- [ ] Last-good image and matching snapshot identified
- [ ] A second person has reviewed this checklist
- [ ] **The owner has explicitly approved this specific release and the
      onboarding action**

---

## Standing rule

**Do not enter real candidate information while a P0 control is unverified.**

An exception must state the specific unmet criterion, the consequence, the
compensating measure, the owner, and an expiry. It is not permission to waive a
county obligation.

---

## Sign-off

| | Name | Date |
|---|---|---|
| Technical staging ready | | |
| County onboarding ready | | |
| Live pilot approved | | |
