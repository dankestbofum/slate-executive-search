# Pilot decisions

Decisions the pilot depends on that **cannot be answered by changing code**.
Every one belongs to a person, not to the application.

This document is a register, not a recommendation. Where a default is proposed
it is a starting point for a conversation, not a decision already taken. Nothing
here has been agreed with a county, because no county has been identified.

**Status key:** `OPEN` — no decision. `PROPOSED` — a suggested starting point
awaiting an owner's agreement. `DECIDED` — agreed, with the date and who agreed.

---

## 1. Engagement and scope

| # | Decision | Owner | Status |
|---|---|---|---|
| 1.1 | Which Arizona county | Search owner | **OPEN** |
| 1.2 | The county-approved job description and official position title | County HR | **OPEN** |
| 1.3 | The appointing body and its statutory authority | County counsel | **OPEN** |
| 1.4 | Which service package was purchased | Search owner | **OPEN** (Executive assumed for rehearsal only) |
| 1.5 | Search calendar: opening, first review, committee dates | Search owner and county HR | **OPEN** |

Slate must not infer 1.2 or 1.3 from the position title. County government
structures differ, and separately elected offices do not report to an
administrator. The application asks for these as facts and marks them
unconfirmed until a person supplies them.

## 2. Records, retention, and disclosure

| # | Decision | Owner | Status |
|---|---|---|---|
| 2.1 | Records custodian for the search record | County records officer | **OPEN** |
| 2.2 | Classification of these materials under the applicable schedule | County records officer and counsel | **OPEN** |
| 2.3 | Retention period, separate from operational backup rotation | County records officer | **OPEN** |
| 2.4 | Legal-hold procedure | County counsel | **OPEN** |
| 2.5 | Public-records disclosure handling, including applicant confidentiality | County counsel | **OPEN** |
| 2.6 | Executive-session handling for committee deliberations | County counsel | **OPEN** |

Reference material: [Arizona retention schedules](https://azlibrary.gov/arm/retention-schedules)
and the [Arizona executive-session statute](https://www.azleg.gov/ars/38/00431-03.htm).
These are review inputs. The applicable schedule and the disclosure analysis
depend on the specific county and circumstances, and this project does not
assign them.

**Do not promise candidates confidentiality on the basis that Slate requires a
login.** Whether an application is disclosable is a question of law, not of
access control.

Until 2.3 and 2.4 are decided, **nothing is deleted automatically** — no
retention job runs. See `docs/operations.md` §6.

## 3. What the export contains, and what it does not

The records export (`GET /api/searches/:id/export`) produces the complete
search record: facts and their sources, the committee and intake, adopted
criteria with their revision, artifacts and approvals, candidates with their
responses **and the questions those responses answer**, staff work, decision
history with actor attribution, and a document inventory. Machine-readable
JSON and a plain-text report that stands alone without the application.

Restricted to consultants. A committee member cannot obtain through an export
what they cannot read in the app.

Deliberately absent, and declared as such in every bundle:

- **Credential hashes, sessions, invitation tokens, API keys.** A bundle handed
  to counsel cannot be used to sign in as anyone or to open a candidate's
  questionnaire.
- **Sealed scores.** Withheld while scoring is sealed, and reported as
  withheld. Releasing them is itself a recorded decision.
- **External documents.** Resumes and background material live in the
  county-approved repository. The export names what must be retrieved from
  there; it cannot contain what Slate never held.

### A limitation the county must be told about

The decision history is **recoverable history, not a tamper-evident audit
log**. Anyone with write access to the underlying store could alter it without
leaving evidence in the export. Every bundle states this.

> **Decision 3.1 — OPEN.** Whether the county requires tamper-evident audit
> storage. If it does, that is separate infrastructure Slate does not provide,
> and it is a launch requirement rather than an enhancement.
> **Owner:** county counsel and records officer.

## 4. Access and identity

| # | Decision | Owner | Status |
|---|---|---|---|
| 4.1 | Who may see applications, reference notes, scores, and drafts | Search owner, county HR, counsel | **OPEN** |
| 4.2 | Whether MFA or SSO is required | County IT | **OPEN** |
| 4.3 | Whether search-specific consultant access is needed | Search owner | **PROPOSED**: firm-wide consultant access, as today |
| 4.4 | Session length | App owner | **PROPOSED**: 14 days, ceiling 30 |
| 4.5 | Shared-account use policy | Search owner | **OPEN** |

On 4.2: if MFA or SSO is required, it should come from an established identity
provider. A bespoke implementation here would be worse than none.

On 4.5: the shared firm sign-in is supported and is recorded honestly — the
export marks it `shared-account` and states it identifies the firm, not an
individual. If the county requires every material approval attributable to a
named person, shared-account use must be prohibited by policy for those
actions. The application records what happened; it cannot enforce a policy
nobody has written.

## 5. AI use

| # | Decision | Owner | Status |
|---|---|---|---|
| 5.1 | County approval of Anthropic as a processor | County counsel and IT | **OPEN** |
| 5.2 | What may be sent for drafting and research | Search owner and counsel | **PROPOSED**: search facts and public sources only; no candidate personal information |
| 5.3 | Spending cap and who authorises overruns | App owner | **OPEN** |
| 5.4 | Candidate notice covering AI-assisted drafting | County counsel | **OPEN** |

No automated candidate acceptance, rejection, ranking, or inference of
sensitive traits is in scope for this pilot. Drafting is advisory; a person
reviews and approves every published claim.

Until 5.1 is decided, no live candidate information is sent to any model.

## 6. Hosting and vendors

| # | Decision | Owner | Status |
|---|---|---|---|
| 6.1 | Hosting vendor and region | County IT and procurement | **OPEN** |
| 6.2 | Procurement approval | County procurement | **OPEN** |
| 6.3 | Off-volume backup destination and controlling account | App owner and county IT | **OPEN** |
| 6.4 | Who can restore if the primary hosting account is unavailable | App owner | **OPEN** |
| 6.5 | Recovery point and recovery time objectives | App owner and county | **PROPOSED**: one hour / four hours, unverified |

6.5 is proposed, not demonstrated. See `docs/operations.md` §5 — the manual
restore drill against real infrastructure has not been run, and until it is
there is no measured recovery time.

## 7. Candidate experience

| # | Decision | Owner | Status |
|---|---|---|---|
| 7.1 | Support and accommodation contact, and staffed hours | Search owner and county HR | **OPEN** |
| 7.2 | Application method and where resumes are submitted | Search operations | **OPEN** |
| 7.3 | Privacy and data-use notice shown to candidates | County counsel | **OPEN** |
| 7.4 | Whether dates are advisory or enforced | Search owner | **OPEN** |
| 7.5 | Who is responsible for manual candidate communication | Search operations | **OPEN** |

7.1 is a launch requirement, not a nicety. A candidate who needs an
accommodation must have somewhere to go. The field exists in the application
and reports support as *unavailable* until configured — which is honest, and is
not the same as available.

## 8. Accessibility

| # | Decision | Owner | Status |
|---|---|---|---|
| 8.1 | Applicable standard and current deadlines | County accessibility lead and counsel | **OPEN** |
| 8.2 | Accepted alternatives where a path cannot be made conformant | County accessibility lead | **OPEN** |

WCAG 2.1 AA is the working minimum target. The county's population and
arrangements determine what actually applies; see the
[DOJ small-entity guidance](https://www.ada.gov/resources/small-entity-compliance-guide/).
No browser or assistive-technology testing has been done (DEP-12).

## 9. Operations

| # | Decision | Owner | Status |
|---|---|---|---|
| 9.1 | Named primary operator | App owner | **OPEN** |
| 9.2 | Named backup operator | App owner | **OPEN** |
| 9.3 | Alert destination and escalation | App owner | **OPEN** |
| 9.4 | Incident response owner and county notification path | App owner and county | **OPEN** |
| 9.5 | Maintenance window | App owner and county | **OPEN** |

The runbook exists (`docs/operations.md`). The names do not. An alert with no
named recipient is not monitoring, and `/api/ready` reports the alert
destination as `NOT CONFIGURED` until one is set.

---

## Before real candidate information is entered

The plan's rule: **do not enter real candidate information while a P0 control
is unverified.** Any exception must state the specific unmet criterion, the
consequence, the compensating measure, the owner, and an expiry — and it is not
permission to waive a county obligation.

The decisions above that block live use regardless of code:

- 2.1–2.5 — no records custodian, classification, retention or disclosure position
- 5.1 — no approval for AI processing
- 6.3, 6.4 — no off-volume backup destination, and no verified restore
- 7.1 — no staffed candidate support contact
- 9.1–9.3 — no named operator and no alert recipient
