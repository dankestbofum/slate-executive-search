# Search operating procedure

How the work that happens outside Slate gets done, recorded, and reconciled.

Slate holds the record of a search. It does not send email, hold a calendar,
store a resume, keep a reference note, or execute an agreement. Every one of
those happens in a system somebody else owns, and the gap between the two is
where a search loses a candidate, misses a deadline, or produces a record the
county cannot stand behind. This document closes that gap.

**Status: drafted for the P3 work package of
[the late-stage pilot plan](late-stage-pilot-plan.md). Not yet walked with a
consultant, and not yet accepted.** Owners, systems and timings marked
`[TO ASSIGN]` are decisions for the named role at kickoff, not blanks the
engineer may fill in. A step whose owner is unassigned has no owner; it does not
have a default one.

The plan calls for this document to be walked with the consultant during P2,
revised against what that rehearsal shows, and then used by a different person
without coaching during P7. A step that needs explaining out loud during P7 has
failed and is rewritten, not annotated.

---

## 1. Who does this work

| Role | Person | Backup | Holds |
|---|---|---|---|
| Search manager | `[TO ASSIGN]` | `[TO ASSIGN]` | Every decision in the [authority matrix](late-stage-pilot-plan.md#3-proposed-authority-matrix) |
| Search consultant | `[TO ASSIGN]` | `[TO ASSIGN]` | Candidate contact, sourcing, scheduling, evidence entry |
| Records custodian | `[TO ASSIGN]` | `[TO ASSIGN]` | Closeout reconciliation, records requests, retention |
| Workspace administrator | `[TO ASSIGN]` | `[TO ASSIGN]` | Membership, invitations, emergency manager reassignment |
| County contact | `[TO ASSIGN]` | `[TO ASSIGN]` | Official communications, appointing-body decisions |

Absence is planned, not improvised. The backup named above acts when the
primary is unreachable for more than `[TO ASSIGN: hours]` during an active
search. A manager reassignment is a deliberate act by the workspace
administrator, carries a written reason, and is recorded on the search's
activity feed — Slate refuses it without one.

## 2. Approved systems

Nothing in a search is done in a system not on this list. Adding one is a
decision by the records custodian and county counsel, not a convenience.

| Purpose | Approved system | Owner of the account | Access review |
|---|---|---|---|
| Candidate email | `[TO ASSIGN: mailbox]` | `[TO ASSIGN]` | `[TO ASSIGN: cadence]` |
| Scheduling | `[TO ASSIGN: calendar]` | `[TO ASSIGN]` | `[TO ASSIGN: cadence]` |
| Resume and application storage | `[TO ASSIGN: repository]` | `[TO ASSIGN]` | `[TO ASSIGN: cadence]` |
| Reference notes (restricted) | `[TO ASSIGN: repository]` | `[TO ASSIGN]` | `[TO ASSIGN: cadence]` |
| Contract drafts and counsel review | `[TO ASSIGN]` | `[TO ASSIGN]` | `[TO ASSIGN: cadence]` |
| Executed agreements | `[TO ASSIGN]` | `[TO ASSIGN]` | `[TO ASSIGN: cadence]` |

Two rules apply to all of them:

- **A location, never a way in.** What goes into Slate is where a document is
  and what it is, not a sharing link that carries its own credential. Use a
  permanent HTTPS URL requiring repository sign-in. Slate rejects userinfo,
  query strings, fragments and common anonymous-sharing URL patterns; legacy
  URLs failing this check are withheld from exports. If no suitable URL exists,
  leave it blank and record the stable document identifier in the label. The
  repository owner must still verify permissions: an opaque URL path can grant
  access that a syntax check cannot detect.
- **Restricted material stays restricted.** Reference notes and background
  material are readable by consultants, not by the committee. Slate enforces
  that on its own records; the repository must enforce it on the documents.

## 3. Candidate email

Slate opens a questionnaire. It does not tell anyone that it did. Opening a
survey in Slate and a candidate receiving a link are two separate events, and
the application says so on the screen rather than implying delivery.

| Step | Requirement |
|---|---|
| Sender | The approved mailbox in §2, never a personal account |
| Template | The approved wording for the message being sent |
| Recipient check | Address read back against the candidate record before sending |
| Link handling | One candidate's link goes to that candidate only. A link in a message to the wrong person is revoked and reissued, not recalled |
| Record in Slate | Log the contact on the candidate: channel, purpose, summary, the **actual sent timestamp**, and any follow-up date |
| Delivery | Watch for a bounce or failure notice. A bounce is not a non-response |
| Retry | `[TO ASSIGN: interval]`, then escalate to `[TO ASSIGN]` |

Slate labels every logged contact `staff-recorded` and says plainly that it
cannot confirm delivery. That label is accurate and must not be written around:
"emailed" in a summary means the sender saw the message leave, nothing more.

**Rehearsal acceptance.** A controlled recipient receives the correct link. A
failed delivery is distinguishable in the record from a candidate who was never
written to and from one who opened a questionnaire and did not submit. The
logged timestamp matches the mailbox.

## 4. Scheduling

| Step | Requirement |
|---|---|
| Calendar owner | `[TO ASSIGN]`, one owner per search |
| Timezone | Stated explicitly in every message and invitation, never implied |
| Panel availability | Confirmed before any time is offered to a candidate |
| Location or link | Included in both the candidate's and the panel's invitations, identical text |
| Accommodations | Asked for, and arranged before the appointment is confirmed |
| Reminders | `[TO ASSIGN: lead time]` |
| Rescheduling | Old appointment cancelled in the calendar **and** the change logged on the candidate in Slate |

**Rehearsal acceptance.** The candidate and the panel hold matching details. A
rescheduled appointment leaves no stale invitation, and Slate's contact log
shows the change rather than only the final state.

## 5. Resume and application storage

Slate runs in one of two modes here, and which one this engagement uses is a
decision that has to be made before a posting is published.

### 5a. Inventory mode — the default

Slate records that a document exists, what kind it is, when it arrived, and
where it is held. **It does not hold the document.** This is how the internal
workspace works: `server/candidates.js` records a *reference* to a resume held
in the client's approved repository and refuses to become a way of making a
restricted document reachable.

| Step | Requirement |
|---|---|
| Submission method | `[TO ASSIGN]`, one route, published to candidates |
| Identifier | A stable document identifier in the approved repository |
| Versions | A replacement is a new version with its own identifier; the earlier one is retained under the approved schedule |
| Recorded in Slate | Kind, label, received date, location, and who recorded it |
| Receipt | The candidate is told their material arrived |
| Access | Only the roles in §2; reviewed on the cadence there |

**Rehearsal acceptance.** An authorized reviewer retrieves the correct version
from the identifier in Slate's inventory, and that inventory entry carries no
sharing credential.

### 5b. Custody mode — the public applicant portal with uploads on

When a public posting is published **and** `SLATE_APPLICATION_UPLOADS=on`,
members of the public attach PDFs to their applications and **Slate stores
those files**, under `DATA_DIR/application-files/`. The sentence in §5a stops
being true of this engagement, and several things follow that do not follow in
inventory mode:

- Slate becomes a **storage location and a processor** for candidate-supplied
  documents, not merely an index of where they are.
- Those files are **in every recovery snapshot** and in the off-volume copy,
  so they are in whatever failure domain those live in.
- They are subject to the **records retention** decision and to **legal holds**
  (docs/operations.md §6b, §6c), and the locations to be searched for a records
  request now include the application-files directory and the snapshots.
- A **privacy notice and a data-use notice** have to say so, before the posting
  is published. The posting cannot be published without a support contact; that
  is a floor, not the notice.

| Step | Requirement |
|---|---|
| Uploads enabled? | `[TO ASSIGN]` — a deliberate decision per engagement, not a default |
| Format | PDF only, size-capped, content-checked; the accommodation route for anyone who cannot produce one is the posting's support contact |
| Malware scanning | **`[TO ASSIGN]`** — with no scanner, stored files are *not openable* by reviewers, and `/api/ready` reports `portal.files.productionCapable: false`. See §5c |
| Privacy notice | On the posting, before publication, saying that materials are stored and for how long |
| Retention | The records custodian's schedule, applied to `application-files/` as well as the store |
| Access | Reviewers on that search only, per request, and only once a scan has cleared the file |
| Deletion | An expired draft removes its files; a submitted application does not expire |

**Rehearsal acceptance.** A synthetic applicant attaches a PDF, a reviewer on
that search can open it and a reviewer on another search cannot, the file
appears in a snapshot, and a restore of that snapshot into an empty directory
brings the file back with the application that names it.

### 5c. If uploads are on and scanning is not available

This is a real state, not a hypothetical one: there is no scanner
implementation today, and `SLATE_FILE_SCANNER=accept-all` is refused under
`NODE_ENV=production`. In that state Slate stores what applicants send and
**refuses to let reviewers open any of it** — the applicant is told their
material was received and is being checked, which is true, and staff are told
plainly that nothing has checked it.

That is a safe state and a useless one. Before a pilot, choose:

- turn uploads **off** and take materials through the inventory route in §5a, or
- configure a **real malware scanner** and record the evidence that it works.

Do not run a public intake with uploads on and no scanner for longer than it
takes to decide which.

## 6. Reference notes

Reference work is the most sensitive thing a search does. A sitting manager
whose references are called before they agreed has been outed by their own
recruiter.

| Step | Requirement |
|---|---|
| Precondition | The candidate is a **finalist** and their consent is recorded in Slate. Slate refuses a reference log entry otherwise |
| Permitted contacts | Only those the candidate agreed to. Going beyond the list requires fresh consent |
| Note storage | The restricted repository in §2. Committee members have no access |
| Note fields | Author, date, who was spoken to, in what capacity, and the substance |
| In Slate | A minimal summary and a pointer. The conversation itself stays in the repository |
| Consent withdrawal | Recorded in Slate immediately. Slate withdraws any reference completion that rested on it, and further contact stops |
| Certification | The **search manager** certifies completion, and only when every current finalist has consent and a recorded contact |

Certification describes the evidence as it stands. Slate withdraws it
automatically when the evidence changes — a log entry removed, the working
notes rewritten, consent withdrawn, or the finalist roster changed — and writes
the reason to the activity feed. A withdrawn certification is not a fault; it
means somebody has to look again.

**Rehearsal acceptance.** An authorized consultant retrieves the notes and a
committee member cannot. Withdrawing consent both stops the work and withdraws
the certification. An empty step cannot be certified.

## 7. Counsel review

| Step | Requirement |
|---|---|
| Trigger | Before any draft agreement is shared outside the firm and the county |
| Handoff | A named draft version to the named reviewer, with what is being asked |
| Findings | Returned in writing and recorded against that version |
| Approval | Recorded, naming the version approved |
| Unresolved issues | Block the final agreement handoff. They are escalated to `[TO ASSIGN]`, not carried forward |

Model language is not reviewed language. Anything Slate drafted, and anything
taken from a prior search, is labelled unreviewed until counsel has approved
this version for this county.

**Rehearsal acceptance.** A reviewer can tell unreviewed model language from
the approved version without asking. An unresolved issue prevents the handoff.

## 8. Signed agreements

| Step | Requirement |
|---|---|
| Signatory authority | Confirmed by the county owner or counsel **before** signature is sought |
| Process | `[TO ASSIGN]` |
| Executed repository | `[TO ASSIGN]`, with the final version identified |
| Receipt | Confirmed to both parties |
| Inventory | Recorded in Slate as a document reference, marked executed |

A draft is never represented as executed. The inventory distinguishes draft,
reviewed, and executed, and the custodian can retrieve the executed version at
closeout from the pointer alone.

## 9. Obligations that cut across every step

| Obligation | Procedure | Owner |
|---|---|---|
| Records requests | Route to the records custodian; do not answer directly. Export the permitted record from Slate and the external inventory from each repository | Records custodian |
| Legal hold | On notice, suspend disposal in every system in §2, including backups, and record the hold | County counsel |
| Retention and disposal | Nothing is disposed of without written approval against the approved schedule | Records custodian |
| Account offboarding | Removal from the workspace, from every system in §2, and from the search roster, on the same day | Workspace administrator |
| Support and accommodation requests | Published contact, staffed hours, and a named owner for each request | `[TO ASSIGN]` |
| Incident notification | Follow [operations.md](operations.md); notify the county through the agreed path | `[TO ASSIGN]` |
| Hiring to first-year evaluation | Named handoff with a date, from the search to whoever owns the evaluation process | `[TO ASSIGN]` |

Legal determinations belong to the decision owners in
[pilot-decisions.md](pilot-decisions.md). This procedure implements their
decisions; it does not make them.

## 10. Closeout reconciliation

Run by the records custodian before the search is closed in Slate. Closing
revokes every outstanding candidate link, and reopening does not bring them
back, so the reconciliation happens first.

1. Every candidate on the file has an outcome, or is listed as undecided with a
   reason. Slate names the undecided ones on the closeout screen.
2. Every outcome has its reason, and every hiring decision has its job-related
   basis. Corrections show the entry they replaced.
3. Every document reference in Slate resolves to a retrievable document in the
   repository named, and every document in the repository appears in Slate's
   inventory. Both directions.
4. Every external communication of consequence is in the contact log with its
   actual timestamp.
5. Reference completion is certified, or explicitly not, with the reason.
6. Counsel review status is recorded, and the executed agreement is in the
   executed repository.
7. The record is exported from Slate — report and data bundle — and compared
   against this list. The export declares what it withholds; check that the
   declarations match what is actually being withheld.
8. Retention start date recorded, and the disposal date calculated from the
   approved schedule.

Only then does the search manager close the search in Slate, with a reason.

---

## Revision

| Version | Date | What changed | Accepted by |
|---|---|---|---|
| Draft 1 | 2026-09-16 | First draft for the P3 work package | Not accepted |
