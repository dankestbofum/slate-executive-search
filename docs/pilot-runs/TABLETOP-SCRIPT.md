# P2 tabletop — facilitation script

The connected three-semifinalist rehearsal from §4 of
[the late-stage pilot plan](../late-stage-pilot-plan.md), written to be read
aloud and worked through in order.

**This session is allowed to fail.** It is the first time the late-stage
workflow meets a practicing consultant, and its purpose is to find the places
where the application, the authority model, or the work outside Slate does not
survive contact. A segment that goes badly has done its job. A segment that
somebody quietly rescues with a developer's help has not — log that as a defect,
because the county will not have a developer sitting beside them.

Nothing here confers readiness. Passing every segment moves P2 to done; the
three [release gates](../release-checklist.md) are decided later and separately.

Copy this file per session. Fill in the capture boxes as you go — not
afterwards, when the hesitation everybody noticed has already been rationalised.

---

## Before the session

| | |
|---|---|
| Run ID | `tabletop-________` |
| Date and duration | |
| Deployment URL | |
| Release / commit | |
| Facilitator | |

### Who is in the room

The plan asks for an actual practicing consultant as the search manager. That
is the point of the exercise: a colleague who already knows the software will
not hesitate in the places a consultant will.

| Role | Person | Signed in as | Browser session |
|---|---|---|---|
| Search manager (practicing consultant) | | | separate |
| Second consultant | | | separate |
| Committee reviewer 1 | | | separate |
| Committee reviewer 2 | | | separate |
| Candidate role-player (A, B, C) | | anonymous | private window |
| Records reviewer | | | separate |
| Observer / note-taker | | — | — |
| Operators (recovery segment only) | | | |

Every identity gets its own browser session. Two people sharing one window is
not the workflow, and it hides exactly the authority handoffs this session is
here to test.

### Preflight

- [ ] Deployment is isolated. **Not a pilot volume, not a production store.**
- [ ] Environment seeded: `node scripts/tabletop.js` — see its header for the
      variables. Keep the manifest it prints; it lists what was seeded and, more
      usefully, what deliberately was not.
- [ ] Every participant can sign in and open the search before the session
      starts. Sorting out an account at minute three costs the room its
      attention.
- [ ] Candidate links tested once, in a private window.
- [ ] Recording or note-taking agreed with everyone present.
- [ ] Nobody has real candidate information open in another tab.

### Say this at the start

> Everything on this file is invented. There is no Cottonwood Basin County and
> these three people do not exist. Work the way you actually would — if you
> would pick up the phone here, say so, and we will write down that the phone
> call is the step. If something is confusing, stop and say it is confusing;
> that is the most valuable thing you can give us today. Do not work around a
> problem to be polite.

---

## How to run a segment

Each segment below has the same shape:

**Do** — what the room does, in order.
**Break it** — the deliberate failure. Attempt it; it is not a mistake.
**Passes if** — what has to be true afterwards.
**Capture** — fill in before moving on.

Pause after every handoff — every time the work moves from one person to
another. That is where searches lose things. Ask the three questions:

1. Did you know it was your turn?
2. Did you have everything you needed?
3. What did you just do outside Slate?

---

## Segment 1 — Step 13: the semifinalist questionnaire

**Do.** The consultant opens the semifinalist questionnaire for A, B and C.
Deliver the links through whatever process the firm actually uses — the
[operating procedure](../search-operating-procedure.md) §3 is the draft; follow
it and mark where it is wrong. The candidate role-player opens A's link, saves a
draft, reloads, and submits.

**Break it.** Replace one candidate's link, then try the old one.

**Passes if.** Opening a questionnaire in Slate never reads as having told the
candidate. The contact log matches what was actually sent, with the real
timestamp. A saved draft survives a reload with the same questions. The replaced
link fails.

**Capture.**

| | |
|---|---|
| Who sent the links, from where | |
| Did anything imply Slate had delivered them? | |
| Draft survived reload | yes / no |
| Replaced link refused | yes / no |
| Defects | |

---

## Segment 2 — Step 14 and B07: sourcing and video interviews

**Do.** The consultant records sourcing history, schedules the video interviews
externally, runs a simulated interview with the candidate role-player, and
records the staff work.

**Break it.** Try to certify the sourcing step with nothing logged against it.
Then, as a committee reviewer, try to read the sourcing and interview notes.

**Passes if.** The record says what happened and who did it. An empty step
cannot be certified. A committee member cannot read restricted staff work —
check the screen *and* have the observer confirm it is absent from the data the
browser received, not merely hidden.

**Capture.**

| | |
|---|---|
| Where the scheduling actually happened | |
| Empty certification refused | yes / no |
| Committee member's view of staff work | |
| Defects | |

---

## Segment 3 — scoring, and the B09 sealed baseline

**Do.** Both reviewers score independently. Take an export while scores are
still sealed and set it aside — the records reviewer compares it at the end. The
second consultant attempts to release scores. The manager then releases them in
the interface.

**Break it.** The second consultant's release attempt is the break. It is meant
to fail.

**Passes if.** Private scoring stays private until release. The sealed export
declares the scores as withheld rather than omitting them silently. The
unauthorised release is refused, and the refusal says who decides. The released
view and the released export agree with each other and with the policy the room
has just agreed to.

**Capture.**

| | |
|---|---|
| What the second consultant saw when refused | |
| Was the refusal understandable without explanation? | yes / no |
| Sealed export declared the withholding | yes / no |
| Defects | |

---

## Segment 4 — Step 15: finalists

**Do.** The consultant recommends A and C. The manager advances them. B
withdraws — record it through the outcome process, as the withdrawal was
reported by the candidate.

**Break it.** Before the manager acts, have the second consultant try to advance
A to finalist themselves. Afterwards, try B's candidate link.

**Passes if.** Advancement is refused for the consultant and accepted for the
manager, with the rationale on the file. B's link no longer opens anything. The
decision's author and history survive.

**Capture.**

| | |
|---|---|
| Did the consultant know to ask rather than act? | |
| Where was the recommendation actually written down? | |
| Withdrawal recorded as the candidate's decision, not the firm's | yes / no |
| Defects | |

> **Watch for this one.** A withdrawal is time-sensitive and is not really the
> firm's decision. The matrix currently makes it manager-only. If the manager
> being in a meeting would leave a withdrawn candidate live on the file for an
> afternoon, say so — it is an open question in the plan, and this is the moment
> it gets answered.

---

## Segment 5 — Step 16: the finalist process

**Do.** Prepare the interview and assessment plan. Perform the external
scheduling and the simulated panel work.

**Passes if.** The approved plan, the calendar details, any accommodations and
the communication record all agree with each other.

**Capture.**

| | |
|---|---|
| Systems used outside Slate | |
| Anything entered twice | |
| Accommodation handling | |
| Defects | |

---

## Segment 6 — Step 17 and B07: references

The most sensitive segment. Work it slowly.

**Do.** Record consent for A and C. Record the reference contacts and where the
notes are held. The manager certifies completion.

**Break it, in this order.**

1. Before consent, try to log a reference contact.
2. Try to certify with only one finalist's contacts on the log.
3. After certification, delete a log entry. Then rewrite the working notes.
4. Withdraw A's consent.

**Passes if.** Preconditions hold: no contact before consent, no certification
without every current finalist covered. Private content stays with the
consultants. Each of steps 3 and 4 withdraws the certification, and the file
says why it was withdrawn.

**Capture.**

| | |
|---|---|
| Did the certification withdraw itself each time? | 3a / 3b / 4 |
| Was the reason on the file clear enough to act on? | |
| Where reference notes are actually held | |
| Did withdrawing consent trigger the right follow-up outside Slate? | |
| Defects | |

---

## Segment 7 — Steps 18–19: contract and evaluation

**Do.** Prepare the model employment contract and the first-year evaluation
process. Route the contract through a mock counsel review. Record a synthetic
signed-agreement inventory.

**Passes if.** Draft, reviewed version and executed agreement stay
distinguishable. The mock legal review is labelled as mock. The evaluation
process has a named owner and a handoff date.

**Capture.**

| | |
|---|---|
| Could a reader tell unreviewed model language from approved language? | yes / no |
| Who owns the first-year evaluation, and from when | |
| Defects | |

---

## Segment 8 — outcomes and B08

**Do.** Record A as hired and C as not selected. B is already withdrawn. Then
correct one outcome deliberately, with a reason.

**Break it.** After the outcomes are recorded, try to advance or newly score one
of these three.

**Passes if.** All three outcomes are on the file. The original decision and the
correction both survive, and the correction names what it replaced. Prohibited
work and dead links fail.

**Capture.**

| | |
|---|---|
| Was "correction" obviously different from "edit"? | yes / no |
| Job-related basis recorded for the hiring decisions | yes / no |
| Defects | |

---

## Segment 9 — export and B09

**Do.** Download the record from the interface three times: before release,
after release, and after closeout (return here after Segment 10). The records
reviewer compares each against the seeding manifest and the external inventory.

**Passes if.** The original questions and answers, decisions and their authors,
permitted scores, staff work, the document inventory and any photos are all
accounted for. No credentials, no bearer links, no other firm's data.

**Capture — records reviewer.**

| Looked for | Present | Notes |
|---|---|---|
| Questions as each candidate was asked them | | |
| Submission dates | | |
| Any replaced response, beside the one that replaced it | | |
| Every outcome, with reason, basis and author | | |
| Lifecycle: closed, reopened, why | | |
| Document inventory resolves to the repository | | |
| Contact log, labelled staff-recorded | | |
| Sealed scores declared, not silently absent | | |
| No candidate links or credentials | | |
| No other firm's records | | |

> Compare against the file, not against expectations. The export was found
> shipping answers with no questions during P4 — by reading one, not by
> reasoning about it.

---

## Segment 10 — lifecycle and B08

**Do.** The manager closes the search. Try an old candidate link and try to
write to the file. Reopen with a reason. Try the old links again. Close again,
archive, and restore from the archive.

**Break it.** Have the second consultant attempt the close, and then the reopen,
before the manager does either.

**Passes if.** Lifecycle and history survive every transition. A frozen file
rejects work. Reopening and restoring bring back neither revoked links nor
access anybody had lost.

**Capture.**

| | |
|---|---|
| Consultant's refusal on close / reopen | |
| Old links after reopening | dead / live |
| Archive restore: what came back, what did not | |
| Defects | |

---

## Segment 11 — independent recovery

Operators join for this. It runs against disposable storage, **never an active
volume**.

**Do.** The backup operator retrieves an off-volume copy without using the
primary hosting account and restores it to a separate instance. The manager
opens the recovered search.

**Passes if.** Answers and questions, score revisions, history, outcomes,
lifecycle, inventory and images are all present. Current revocations still
apply. Recovery point and recovery time are measured against the owner-approved
targets.

**Capture.**

| | |
|---|---|
| Snapshot age at restore (recovery point) | |
| Elapsed time to a usable service (recovery time) | |
| Did the backup operator need the primary account? | yes / no |
| Anything missing from the recovered record | | |

> If the backup predates a link revocation, stop and work out what the recovery
> procedure does about that **before** the recovered service would be exposed.
> A snapshot does not contain decisions made after it was taken.

---

## Debrief

Run it while everyone is still in the room.

1. Where did you hesitate?
2. What did you do outside Slate that the software did not know about?
3. Where were you unsure whose decision something was?
4. What did you have to type twice?
5. Was anything inaccessible, unreadable, or too small to use?
6. What would have gone wrong if you had been doing this alone, for real?

### Authority matrix — the decision this session exists to inform

The matrix in §3 of the plan is enforced in the software today, but **it is a
proposal nobody has accepted.** Walk each row with the search owner and mark it.

| Action | Proposed | Accept / revise | Who decided |
|---|---|---|---|
| Advance to finalist, or reverse it | Search manager | | |
| Release or reseal scores | Search manager | | |
| Record or correct an outcome | Search manager | | |
| Certify or reopen reference completion | Search manager | | |
| Close or cancel | Search manager | | |
| Reopen | Search manager | | |
| Archive | Search manager | | |
| Restore from archive | Manager, or an administrator | | |
| Export | Authorized consultant (enforced as any consultant) | | |
| Emergency manager handover | Workspace administrator, with a reason | | |

Two rows are enforced differently from the proposal and need an explicit answer:
export has no separate authorization in the software, and archive restoration
accepts an administrator because handover only works on a search that is still
on the book.

Open questions carried in from P4:

- May a shared firm account hold a search manager place at all? It can today,
  and the export labels its actions as a firm's rather than a person's.
- Does recording a withdrawal need a delegated, time-sensitive path?
- Should an administrator's emergency reassignment notify the outgoing manager?
  It is recorded on the file; nothing tells them.

### Defect log

One row per defect. A developer-assisted repair is a defect.

| # | Segment | What happened | Expected | Priority (P0/P1/P2) | Owner | Retest |
|---|---|---|---|---|---|---|
| 1 | | | | | | |

### Operating procedure corrections

| § | What the procedure says | What actually happened | Change to make |
|---|---|---|---|
| | | | |

### Outcome

- [ ] Every segment run
- [ ] Every defect logged with a priority and an owner
- [ ] Authority matrix walked, each row accepted or revised, with a name
- [ ] Operating procedure corrections captured
- [ ] Session recorded against [TEMPLATE.md](TEMPLATE.md), with the seeding manifest attached

P2 is done when those boxes are ticked. It is not done when the session ends.
