# Slate pilot remediation plan

Date: September 23, 2026, America/Phoenix.

Objective: an invited committee member reaches the correct search, understands candidate-profile input, sees current candidate information, and completes their work without developer assistance. Before accepting paid pilot customers, prove payments, research, candidate intake, and operational recovery on the release being launched.

This is the current follow-up plan to the [three-agent walkthrough](REPORT.md). The [earlier paid-pilot plan](../2026-09-22-paid-pilot/IMPLEMENTATION_PLAN.md) retains the broader payment and research design; reconcile its proposals with existing code before implementing anything again.

## Committee workflow clarification (September 23)

- Step 2 collects each member's independent priorities: suggested or custom qualities, clickable 1–5 importance ratings, and a visible **Explain why** field. Before the administrator opens the window, members can preview the shared questions but cannot submit answers or advance into an administrator task.
- Step 3 is the administrator's review of submitted ratings, every explanation, community challenges/opportunities, and written context. Aggregation and adoption live here, not in Step 2. A blank profile editor no longer replaces this review; administrators can adopt the proposed profile or explicitly write the final profile after collection closes.
- Committee members see a read-only adopted profile. Skipping the optional questionnaire still opens direct profile writing for the administrator.
- Maintained coverage: `tests/browser/committee.spec.js` exercises the member waiting screen, independent submissions, community-needs review, adoption in Step 3, explanation persistence, and the skipped-questionnaire path. Existing role and server adoption checks remain in force.

## Starting point

- Invitation landing and clearer Step 2 wording were deployed in baseline `a6c91bf`.
- The later pending-session invitation correction is prepared locally, with 27 passing browser tests. It has not been deployed or verified with real Clerk invitations.
- Stale committee candidate lists are reproduced on desktop and emulated mobile; no correction is yet recorded.
- Core manager, committee, and candidate paths ran locally with substitute providers. This is not hosted acceptance.
- The last hosted snapshot had billing off, no configured project offer, no applicant mail transport, and no off-volume backup or alert destination. Recheck these before changing configuration.
- The baseline browser CI has 16 failures requiring triage; local Node 22 results do not replace supported Node 24 checks.

## Progress, September 23 (local, not deployed)

Engineering work for phases 1-3 is in the working tree, uncommitted. Nothing below has been pushed, deployed, or tested against real Clerk, mail, payment, or model providers.

- **Phase 1:** reviewed the prepared pending-session correction; authenticated membership/search checks and server rejection of pending sessions are retained. Invitation suite passes on all three browser projects. Real Clerk accounts and the organization-creation setting are still unverified.
- **Phase 2:** moving within an open search now rereads it (`refreshOpenSearch()` from `go()` in `public/app.js`). A response is applied only if the same navigation and workspace are still current, nothing was typed meanwhile, and no save replaced the search while the read was in flight. A failed refresh keeps the last data and shows "This search may be out of date" with a retry button. `loadSearch()` drops responses from superseded navigations. A typed or pasted address previously ran the same navigation twice (`popstate` then `hashchange`); it now runs once. Step 2 links to the adopted candidate profile once there is one. On phones and touch screens, rating buttons are at least 44 × 44 CSS px and wrap as needed. Maintained coverage: `tests/browser/collaboration.spec.js` (two-session candidate visibility, sealed score save, failed refresh, slow refresh, mobile target size); without the fix, the first case fails.
- **Phase 3 triage of the 16 baseline failures** (6 tests × browsers):
  - `journeys.spec.js` sign-out, keyboard sign-in, and focus indicator: stale. Sign in now sits in the public "Menu" at every width. The tests open it, the keyboard test uses real key presses, and the focus test reaches the button by keyboard so `:focus-visible` applies.
  - `research.spec.js` partial findings: stale copy. The notice now reads "Research ready for review".
  - `workspace.spec.js` new search on Home: **product defect**. Creating a search always opened Project payment, even with billing off or access already in place. It now opens Payment only when the search is unpaid; otherwise it opens Team.
  - `billing.spec.js` home control on mobile: stale. The desktop rail toggle is not part of the phone drawer. The mobile path checks the home control through the drawer.
- **Phase 4 (engineering only):** an unpaid search's Team page replaces the Add people form, which the server would refuse, with "Review project payment".
- **Release stamp:** no code change needed. `server/env.js` already reports the disagreement. The hosted service has a hand-set `SLATE_RELEASE` (`16df657…`) overriding `RENDER_GIT_COMMIT`. Operations must delete that Render environment variable, as `render.yaml` directs.
- **Local results (Node 22.18.0; Node 24 not installed here):** `npm run check` 115 files OK; `npm test` all suites pass. Final full browser run: 355 passed, 28 skipped (deliberate project skips), 1 failed. The failure was a timing race in the unchanged Safari pricing-menu keyboard test, which focused the menu before the offer repaint. The test now waits for the page to settle and passed 30 of 30 repeated Safari runs. Node 24 evidence must come from CI.
- **Also fixed while triaging:** a navigation's in-flight refresh could overwrite a save made meanwhile, which would drop a just-logged contact. The recordkeeping test now waits for the Candidates screen instead of text shared with the candidate page.

## Delivery sequence

### Optional committee questionnaire follow-up (local, not deployed)

- The organization administrator can select **Skip questionnaire and continue** in Step 2 after the roster is confirmed, including when another consultant manages the search. The choice is recorded by name and date, marks Step 2 as skipped, and opens the candidate profile without requiring questionnaire responses.
- Members see that no response is required, and their getting-started checklist omits the skipped questionnaire. Saved private drafts remain private and are retained. Administrators can select **Include committee questionnaire** to return it to draft; the search manager then opens the window normally.
- Submitted answers are not discarded or relabeled as skipped: once answers exist, review them and close the response window. Server authorization, revision checks, payment gates, and roster checks remain enforced.
- Validation: syntax/packaging and full isolated server suites passed locally. Browser coverage exercises skipping, persistence, member messaging, re-enabling, and normal submission across desktop Chrome, WebKit, and mobile Chrome. These checks use substitute identity providers and local Node 22; no deployment is included in this follow-up.

### Committee qualities and owner navigation follow-up (September 23)

Implemented locally, not deployed:

- Before opening Step 2, the account manager can prepare shared candidate qualities in each category, or copy the current profile's labels. Every rostered member, including the manager, gets the same 1–5 importance controls and can suggest additions. Equal ratings are allowed; this is importance weighting, not forced ordinal ranking.
- Shared qualities freeze when the window opens. Existing response windows retain their current questionnaire. Private drafts preserve unrated qualities as blank; submission requires an explicit rating for every shared quality. Only submitted answers contribute to the existing aggregate and adoption workflow.
- The owner can navigate directly among Committee rankings, Aggregate and adopt, Create brochure, Create advertisement, and Review candidates. Completion and waiting states remain visible, and existing workflow/package prerequisites still apply.
- Rating-button edits now participate in the unsaved-edit guard. Shared-list and window-settings saves preserve both forms' values.
- Regression coverage lives in `tests/committee.js` and `tests/browser/committee.spec.js`: manager/member parity, unrated drafts, incomplete submissions, list immutability, permissions, privacy, aggregate weights, adoption, and later-stage navigation. Browser providers remain substitutes; hosted acceptance is outstanding.
- Local validation: syntax/packaging check passed; 24 committee/collaboration browser checks passed across Chrome, WebKit, and mobile Chrome. The full server suite reported all checks passing. Runtime remains Node 22.18.0; supported Node 24 and hosted validation are still release gates. Playwright's Windows server teardown needed the test server stopped after all assertions finished.

| Phase | Work | Depends on | Completion gate |
|---|---|---|---|
| 1 | Finish invitation-to-search recovery | Existing local fix | Real invited accounts reach only their assigned search |
| 2 | Refresh committee data and finish Step 2/mobile usability | Can be developed alongside phase 1 | Two independent sessions collaborate without manual reload or lost edits |
| 3 | Make the release verifiable and deploy the corrections | Phases 1-2 code complete | Green release checks, matching deployed commit, hosted invitation verification |
| 4 | Configure and prove paid-pilot services | Owner scope/offer decisions; phase 3 release for final verification | Payments, intake, research, backup, and alerts have recorded evidence |
| 5 | Run a complete hosted rehearsal and launch decision | All applicable gates above | Search completed without developer intervention; no unresolved launch blockers |

Engineering owns implementation and automated checks. The product owner supplies commercial and scope decisions. Operations owns provider configuration, deployment evidence, recovery, and support contacts. Name the people filling these roles before rehearsal; one person may fill more than one role.

## Phase 1: Invitations lead to the correct search

**Priority: P0. Status: correction prepared locally; provider validation outstanding.**

- [x] Review the prepared changes in `public/auth.js`, `public/app.js`, and `server/index.js`, retaining authenticated membership/search checks and rejection of pending sessions by protected APIs.
- [ ] Confirm pending workspace selection displays existing memberships and invitations; password/MFA tasks display their required controls; unavailable tasks offer usable recovery.
- [ ] Preserve organization and search context through sign-in, sign-up, invitation acceptance, and profile onboarding. Route directly when there is one authorized destination; show a choice when there are several.
- [ ] Keep old links usable without selecting an unrelated existing workspace. Treat ticket claims only as navigation hints, never authorization.
- [ ] Verify Clerk's organization-creation settings against the intended founder policy, including direct provider access and automatic first-organization creation.
- [ ] Exercise real Clerk accounts in a development/staging environment, then verify controlled invitation-to-search cases on the deployed correction in phase 3.

Acceptance: new and existing accounts, already accepted invitations, expired/revoked invitations, wrong account, multiple workspaces/searches, interrupted workspace selection, and same-session MFA/password completion all reach the intended search or an actionable recovery screen. No blank panel, unauthorized workspace creation, or cross-search disclosure. Store only redacted evidence; never commit invitation tickets.

## Phase 2: Committee members can complete their work

**Priority: P1; mobile target sizing P2. Status: corrected locally with maintained browser coverage; physical-phone and hosted checks outstanding.**

- [x] Refresh authorized search data when entering Candidates and other views affected by another participant's changes. Review `go()` and `loadSearch()` in `public/app.js`.
- [x] Preserve the unsaved-edit guard and revision-conflict handling. Prevent a slow response for a previous search or workspace from replacing the current view.
- [x] On refresh failure, retain usable data with a visible stale-data/retry message. Do not present an unqualified empty list when refresh failed.
- [x] Confirm Step 2 explains that committee members propose priorities for the candidate profile, and Step 3 is where the manager reviews/adopts the profile. Keep categories aligned and make the current profile easy to find.
- [ ] Enlarge Step 2 and candidate-scoring controls on mobile, targeting approximately 44 CSS pixels while preserving layout at 320 pixels and zoom. (Implemented and checked in emulation; physical-phone check outstanding.)
- [x] Add the reproduced two-session scenario to maintained browser tests instead of relying only on audit scripts.

Acceptance: leave a committee session open; have a manager add a candidate and a candidate submit in separate sessions; navigate to Candidates and see current information without a browser reload. Save a score and verify persistence and sealed visibility. Repeat with unsaved edits, a conflicting update, slow/failed refresh, and a workspace switch. An unassisted reviewer can explain what Step 2 contributes and locate the adopted profile. Check touch controls on a physical phone.

## Phase 3: Release the corrections with trustworthy evidence

**Priority: launch gate. Status: outstanding.**

- [x] Triage all 16 baseline browser failures against intended behavior. Update stale menu/copy/destination assertions; fix actual defects. Do not weaken tests just to get a green run.
- [ ] Run syntax/packaging, server, browser, and container checks under the supported Node 24 runtime. Include the pending-session invitation and concurrent-participant regressions.
- [ ] Correct the stale build release stamp and verify build/platform commit agreement.
- [ ] Commit and push the reviewed changes to GitHub and deploy through the existing Render workflow. Record the commit, CI run, deployment, and rollback target.
- [ ] Verify hosted new/existing-account invitations, correct assigned-search landing, Step 2/profile navigation, current candidate data, and mobile layout. Do not use successful HTTP responses as the acceptance test.

Acceptance: release checks pass, the served release is identifiable, and real hosted invitation/collaboration journeys pass. If real Clerk behavior fails, capture redacted session/task state, correct it, and repeat before clearing this gate.

## Phase 4: Prove the paid-pilot services

These workstreams may proceed alongside phases 1-3 where independent. Final evidence must identify the configuration and release tested. Existing implementations should be verified and completed, not replaced from the historical plan by default.

| Workstream | Remaining work | Acceptance evidence |
|---|---|---|
| Project payment | Approve one-time offer, price/currency, payer, included AI allowance, legacy treatment, and refund policy. Configure provider test mode. Align unpaid UI actions with server entitlements, including Add people. | Successful and failed checkout; duplicate/reordered events; closed-browser and restart recovery; verified payment activates exactly one search; another search remains unpaid; committee users cannot purchase or bypass gates. |
| Candidate intake | Decide whether public applications are included. If included, configure real mail and test email verification, saved return, submission, and receipt. | Real test inbox receives messages; candidate completes and resumes the hosted journey. If excluded, remove/disable the public intake path and document the external process. |
| Uploads | Keep disabled unless explicitly included; if included, integrate a production scanner and recovery policy. | Accepted/rejected file handling and restored materials demonstrated with synthetic files before enabling uploads. |
| Research and drafting | Verify the requested model is available; run a bounded jurisdiction benchmark within an approved spending limit; exercise review and drafting. | Sources and jurisdiction/year checked; unknown/partial results explained; review preserves manual edits; cost, latency, cancellation, and budget limits recorded; generated documents reviewed. Use the earlier plan's benchmark design. |
| Recovery and alerts | Configure off-volume backups, operator alerts, and named primary/backup operators. | Restore searches, memberships/access records, payment ledger, and materials into an isolated environment; record recovery time/data age and reconcile payments; trigger and receive a controlled failure alert. |

Billing-off legacy access is not proof of a successful paid workflow. Configured credentials are not proof of delivery, research, payment, or recovery.

## Phase 5: Hosted rehearsal and pilot acceptance

Use synthetic records with distinct manager, committee, and candidate accounts, plus a second workspace for isolation checks. Record the exact commit, environment, provider modes, test results, and unresolved defects in a new dated pilot-run record.

- [ ] Manager creates a workspace/search, completes a provider test payment, and verifies the second project remains unpaid.
- [ ] New and existing committee accounts accept invitations and arrive at their assigned search.
- [ ] Committee members independently save/submit Step 2 priorities; manager reviews/adopts the candidate profile.
- [ ] Manager runs bounded research, reviews sources, and produces/reviews search documents.
- [ ] Candidate completes the agreed intake flow; an already-open committee session sees the update and can review it.
- [ ] Reviewers save independent scores; verify privacy before release and the intended visibility after release.
- [ ] Manager completes finalist work, closeout, export, archive, and restore. Verify authorized access and record integrity.
- [ ] Repeat critical invitation, resume-draft, and scoring paths on a physical phone and with keyboard navigation. Include wrong-account and interrupted-session recovery.
- [ ] Exercise applicable hosted load checks from the earlier plan and verify backup restoration, operator alerts, and support ownership.
- [ ] Product owner and search lead review evidence and record a go/no-go decision. Activate live payments only after commercial configuration and provider test-mode acceptance are complete; verify the production configuration separately.

Launch requires all P0 gates and applicable P1 gates to pass. Any deferred P2 issue needs an owner, a documented workaround, and a follow-up date. Excluding intake or uploads must result in a clear user-facing workflow, not an exposed broken feature.

## Decisions to collect without blocking engineering fixes

| Decision | Needed before |
|---|---|
| Project fee, currency, purchased scope, permitted payer, refund/legacy policy | Payment configuration and acceptance |
| AI allowance and maximum benchmark spend | Paid model calls |
| Public applications and upload scope | Intake integration and rehearsal |
| Staging/test accounts, provider access, and named operators/support contacts | Provider verification and recovery exercises |

The immediate implementation batch is phases 1-3. No new commercial decision is needed to fix invitation recovery, refresh committee data, clarify Step 2, or repair release checks. Re-estimate remaining service work after configuration access and scope are known; the historical plan's total estimate predates the current implementation and should not be reused as a remaining-work estimate.
