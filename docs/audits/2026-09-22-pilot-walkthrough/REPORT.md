# Pilot walkthrough and invitation failure

Execution plan: [Pilot remediation plan](IMPLEMENTATION_PLAN.md), with phased work, dependencies, and acceptance gates.

Date: September 22, 2026, America/Phoenix (September 23 UTC).
Deployed baseline: `a6c91bf278f42fb96d64c48970f56300be0d07cd`.

## Decision

The core search workflow can run with isolated synthetic data, but the hosted paid pilot is not ready for sign-off. Three GPT-6 Sol agents independently investigated authentication, the manager workflow, and committee/candidate journeys. They used runnable local browser/server fixtures rather than relying solely on source review. Clerk, email, payment, and AI substitutes are explicitly identified below; passing those tests does not establish a working hosted invitation or paid search.

The reported invitation panel was reproduced in a **matching pending-session state**: Clerk had a user but required workspace selection; Slate's API refused the pending session, and Slate rendered a sign-in container that its own mount guard skipped. The actual session behind the user's screenshot was not inspected, and their live invitation ticket was not consumed or saved in the audit. This is a reproduced cause of the symptom, not a claim that the hosted cause has been conclusively observed.

## Fixes prepared locally in this audit

- Pending workspace selection now has a visible chooser populated from the signed-in Clerk user's existing memberships and invitations. It offers no workspace-creation action. Password-reset and MFA tasks use their corresponding Clerk components, with recovery for unavailable/unknown tasks. Slate's protected APIs still reject pending sessions.
- The session listener observes status and task transitions as well as session/organization IDs. Completing a task within the same session refreshes access.
- Accepted invitations with an authorized target continue to the assigned search. Older links without a search ID open a sole server-authorized assignment; ambiguous destinations retain a choice. An opaque ticket cannot silently choose the user's old workspace. A ticket's organization claim is only an optional navigation hint; membership and search access come from authenticated APIs.
- A same-origin homepage invitation-redirect override is upgraded to `/join` with organization/search context for new invitations. External/custom overrides remain separate.
- The browser fixture now models pending sessions and clears its out-of-page authorization on sign-out. Previously it only modeled active sessions, which is why the blank-panel regression escaped the first tests.

These fixes are in the working tree, **not deployed by this audit**. No production users, searches, memberships, invitations, billing settings, or provider settings were changed.

## Prioritized pilot work

| Priority | Finding | Required completion evidence |
|---|---|---|
| P0 | **Invitation-to-search flow was broken for pending sessions.** Matching failure reproduced; local fix prepared. | Deploy the fix and complete a real Clerk development-instance invitation with new/existing accounts, interrupted workspace/MFA/password tasks, wrong-account recovery, and accepted/revoked links. Verify arrival at the intended assigned search. |
| P0 for a paid pilot | **Hosted project billing is off and the offer is unconfigured.** Live offer has no price or AI allowance. Billing-off searches receive legacy access; the unpaid/402 gate was tested separately in local billing-test mode. | Approve the offer, configure provider test mode, then complete checkout, webhook/reconciliation, browser-close recovery, and a second unpaid project. Verify entitlement isolation before enabling live payments. |
| P1 | **Committee views go stale during real collaboration.** After staff adds a candidate and the candidate submits, an already-open committee session can still show zero candidates when navigating to Candidates. Browser reload reveals the candidate and scoring works. Reproduced on desktop Chromium and emulated Pixel 7. | Refresh authorized search data on navigation or provide an obvious update action, preserving dirty drafts and handling conflicts. Rehearse with two independent sessions without asking the member to reload. |
| P1, required if public applications are in scope | **Hosted applicant email verification is unavailable.** Mail transport is `none`. Uploads are also disabled, with no production scanner. Local candidate application success used echo mail and a test scanner. | Configure real delivery and rehearse verify/save/return/submit/receipt with test addresses. Keep uploads disabled unless a production scanner is integrated; document any external materials workflow. |
| P1 | **Off-volume recovery and alert delivery are absent.** Live mirror and alert destination report NOT CONFIGURED. Local disk snapshots do not establish recovery from disk loss. | Restore an independently stored backup into a separate environment; verify purchases, searches, and materials; demonstrate alert delivery to the operator. |
| P1 | **Real research and drafting remain unverified.** The live process reports no verified research outcome or model entitlement check. UI tests use mocked job responses. | Run approved model preflight and a bounded, approved-spend jurisdiction benchmark; record sources, partial-result handling, actual costs, and completed document review. |
| P1 | **Release identity disagrees.** Render's platform commit is `a6c91bf`; the reported build release remains `16df657…`. | Correct the stale release stamp/configuration and show matching platform/build identity for the hosted rehearsal. |
| P1 verification | **Clerk organization-creation policy is unverified.** Slate's custom chooser offers only existing access, but Clerk can independently permit user-created organizations. | Confirm provider settings prevent unauthorized creation/automatic first-organization creation, or enforce the intended founder policy beyond the Slate creation endpoint. |
| P2 | **Unpaid screens offer actions the payment gate rejects.** The local unpaid committee page offers Add people despite a server-side payment refusal. | Disable or replace gated actions with a payment-review action before the user fills the form. |
| P2 | **Mobile rating controls are cramped.** Step 2 and candidate-scoring buttons measure 28 by 28 CSS pixels on emulated Pixel 7. | Enlarge mobile hit areas and check wrapping and scoring on physical phones. |
| P2 release evidence | **The full deployed-commit browser CI run is red: 16 failures.** Several assertions assume old menu visibility, old research copy, desktop navigation on mobile, or an old post-create destination. These are not 16 independently verified product defects. | Triage each failure against intended behavior, update stale tests, fix genuine regressions, and obtain green Node 24 CI for the actual release. |

## What was actually exercised

- **Authentication agent:** isolated Express server with a signed pending JWT and a browser SDK stub reproduced the empty panel. Independent code review identified the task transition and ambiguous routing problems and reviewed the local correction. See [authentication findings](auth/FINDINGS.md).
- **Manager agent:** synthetic account setup, workspace creation, new search, local unpaid payment screen, and a refused candidate write (402). Existing isolated desktop journeys reached candidate receipt, independent scoring, score release, and closeout/export/archive using legacy access. Nineteen cases printed as passing; one research-copy assertion was stale. Agent runners needed interruption during teardown, so those runs are reported as printed case results, not clean process exits. See [manager report](manager/REPORT.md).
- **Participant agent:** independent committee session found its assignment, completed candidate-profile input, reviewed a candidate, and saved a score after recovering from the stale-view defect. Private questionnaire and public application journeys completed saved-draft reload, submission, and receipt on desktop Chromium and emulated Pixel 7. Four cases printed as passing; the runner was interrupted during lingering teardown. See [participant report](participants/RESULTS.md) and its screenshots/evidence.
- **Root validation:** final invitation suite: **27 passed**, exit 0, across desktop Chromium, desktop WebKit, and emulated mobile Chromium. This includes pending organization selection, same-session MFA completion, legacy invitation assignment landing, wrong organization, opaque ticket, and sign-out recovery. An earlier adjacent onboarding/organization run passed 52 cases with two deliberate skips; the final focused suite then covered the chooser changes. Syntax/packaging check passed (114 files). Local Node is 22.18.0, below the supported Node 24 production runtime.
- **Hosted read-only checks:** [minimal readiness snapshot](live-readiness.json); no checkout, paid AI call, or real email was sent. [GitHub CI for the deployed baseline](https://github.com/dankestbofum/slate-executive-search/actions/runs/35816422036) passed server and container jobs and failed the full browser job.

## Next rehearsal

1. Resolve invitation handling and stale participant views, then get the release checks green.
2. Verify provider policy, release identity, backup/restore, and operator alerts.
3. In staging, create a fresh manager, buy a synthetic project, invite a new committee account and an existing account, submit profile input independently, adopt the profile, run approved research, and review the resulting documents.
4. Submit a candidate application/questionnaire, confirm it appears in the already-open committee session, score independently, release scores, complete finalist work, and close/export/archive/restore.
5. Repeat invitation and candidate recovery with a real email inbox and a physical phone. Record the exact deployed commit and the checks actually completed. Do not treat configured credentials, HTTP 200, or an SDK stub as successful provider integration.
