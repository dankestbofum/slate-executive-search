# User guide, in-app guidance, and public candidate portal

Prepared September 19, 2026. **Status: proposed; planning only.**

Build three connected improvements: a task-based guide to Slate, consistent explanations where people work, and a public portal where candidates browse openings and apply. The user selected **public applications: browse openings and apply** as the portal's first scope.

Recommended sequence: **guide and contextual help → public job publishing → application and recovery → pilot release.** The guidance improvements can ship before the portal.

## 1. What exists and what needs building

This assessment is based on the current local working tree, including uncommitted changes, and the existing audits. It is not a new live-site or browser audit. Source locations below name the relevant functions so they remain useful as line numbers change.

| Area | Existing foundation | Work to add |
| --- | --- | --- |
| Process guidance | `server/steps.js` defines the package-specific process. `vProcess()` in `public/app.js` shows included steps and dependencies. | Task instructions that explain how to finish each step, who can do it, and what happens afterward. |
| Hover help | `withTip()`, `TIPS`, and the tooltip runtime in `public/app.js` already support hover, keyboard focus, and a tap/click help button. | Inventory coverage, improve wording and accessible names, and connect short explanations to full help articles. |
| Forms and progress | Shared `field()`, `actionBar()`, and empty-state helpers already exist. | Consistent examples, required-field explanations, save feedback, recovery instructions, and permission explanations. |
| Documentation | The README explains architecture and workflows; `docs/search-operating-procedure.md` covers external work and remains a draft awaiting operational acceptance. | A user-facing guide with role-specific quick starts and screenshots. Preserve the operating procedure as the operational reference. |
| Candidate experience | `/apply/:token` and `/api/apply/:token` serve private initial/semifinalist questionnaires, server-saved drafts, receipts, and support information. | Public openings, job detail pages, applicant-initiated records, verified recovery, application materials, and staff review of incoming applications. |
| Candidate creation | `POST /api/searches/:id/candidates` currently requires workspace staff access. | A separate public intake path with its own validation and authorization. |
| Documents and communications | `server/candidates.js` records references to externally stored documents and staff-recorded contacts. Slate does not currently send applicant email or store resumes. | Deliberate email and private document-storage integrations for a complete online application. |
| Access | Clerk organizations isolate staff workspaces. `server/authority.js` governs accountable search decisions. | Applicant access scoped to their own application; explicit manager authority to publish public content. |

Use the September 17 [committee implementation status](../2026-09-17-committee-aggregate/IMPLEMENTATION_STATUS.md), not the earlier diagnostic alone, when writing intake instructions. It reports fixes verified locally but not released. Likewise, reconcile the September 16 [website implementation record](../2026-09-16-website-audit/IMPLEMENTATION_RECORD.md) with the actual deployed build before capturing screenshots or publishing instructions.

## 2. User guide

### Entry points and format

- Add **Help & user guide** to the workspace navigation and **Help with this page** to major screens. Keep **Interview guide**, an existing search document, clearly separate from the app's user guide.
- Provide a searchable help page with stable article links, a role selector, and a short glossary. Selecting a role changes explanations, never permissions.
- Begin each screen's article with a short checklist. Put detailed examples and troubleshooting below it.
- Provide a print-friendly HTML version generated from the same content. Video walkthroughs can follow after the workflow stabilizes.
- Put candidate-only help in the public portal. Public help contains only content deliberately approved for applicants, without private search information.

### Content outline

| Guide | Tasks to explain |
| --- | --- |
| Start here | What Slate does; sign in; choose a workspace; understand your role; find an assignment; identify the next task. |
| Administrator quick start | Invite members; choose roles; distinguish an invitation from an assignment; resolve missing access; reassign a manager. |
| Consultant and manager quick start | Create a search; select a package; enter search facts; assemble the committee; prepare and complete the process. Distinguish preparation from manager decisions. |
| Committee quick start | Find the search; save private input; submit/update answers; understand publication after closure; score candidates; understand score release. |
| Prepare the search | Committee intake and consensus, candidate profile, research and source review, questionnaires, interview guide, ad plan, brochure, and advertisements as included in the package. |
| Recruit and evaluate | Publish an opening, review applications, manage candidates, open questionnaires, record contact, screen and score, advance candidates, and record staff work. Portal instructions ship with the portal. |
| Complete the search | Record outcomes, reference consent, agreements and external records, export, close, archive, and restore. Explain link revocation and what reopening does not restore. |
| Candidate quick start | Find an opening, understand requirements, verify email, save an application, provide materials, submit, keep the receipt, return, and request corrections or accommodations. |
| Troubleshooting and glossary | Invitation pending, no assignment, unavailable action, excluded package step, unsaved work, conflict, research failure, stale document, expired candidate access, and missing receipt. Define intake, adopted profile, semifinalist, released scores, and archive. |

Every article uses the same template: **who this is for → before you start → numbered steps using actual button labels → how to know it worked → who sees the result → next step → recovery/help**. Include a reviewed date and the application release used to verify it.

Start with ten high-value articles: first sign-in, create a search, assemble a committee, submit committee input, adopt the profile, research and review sources, add/contact candidates, score/release scores, recover unsaved or conflicting work, and close/archive. Add candidate and publishing articles during the portal phase.

### Content implementation and ownership

- Proposed content source: `content/help/`, with stable article IDs, audience, related screen/step keys, short explanations, and full instructions. Generate the in-app and printable versions from this one source.
- Connect help to step keys from `server/steps.js`, package inclusion, and server-provided capabilities. Do not maintain a second editable list of process step numbers or authorization rules.
- Keep help navigation within the current unsaved-edit guard. A help drawer must preserve entered work and return focus to its trigger when closed.
- Use synthetic searches and candidate data in screenshots; capture desktop and mobile examples only where the image helps complete the task.
- Assign an operational content owner and a technical reviewer. Any change to workflow, permissions, button wording, or candidate policy must include a help-content review in the release checklist.

**Acceptance:** a first-time committee member can submit input and recognize the saved/submitted state without coaching; a new consultant can find instructions for creating a search and sharing a questionnaire; every help link resolves to the right task and preserves unsaved work.

## 3. More user-friendly screens

### Priority order

| Priority | Change | Result the user should see |
| --- | --- | --- |
| First | A short purpose statement and the next available action | “Submit your priorities by Friday. You can save a private draft first.” Wording must use the actual configured date/state. |
| First | Visible instructions for required or consequential actions | Explain who sees a submission, whether an email is sent, and whether a link is revoked before the user acts. |
| First | Clear saved, unsaved, submitted, and failed states | Distinguish “Draft saved” from “Submitted”; show the last successful save and preserve text after an error. |
| First | Explain unavailable actions | Show the missing prerequisite or responsible role next to the action, with a useful link when the user has access. |
| Next | Helpful empty states and field examples | “No candidates yet” leads staff to add a candidate or publish an opening when available; no unexplained blank panels. |
| Next | Consistent hover/focus/tap explanations | One short explanation per unfamiliar action or concept, using the existing tooltip system. |
| Next | Dismissible getting-started checklist | Derive completion from actual search state, respect role/package, and allow reopening it from Help. |
| Later | Optional guided walkthroughs | Use only if usability sessions show that the guide and contextual explanations still leave a gap. |

### Tooltip and inline-help rules

Extend the existing component rather than adding a second tooltip library. Essential instructions remain visible. Tooltips provide brief supplementary explanations; links, long content, and interactive instructions belong in the help drawer.

Tooltips must open through keyboard focus as well as hover, remain readable while the pointer moves onto them, stay available while relevant, and be dismissible with Escape. Keep the tap/click alternative for phones. These behaviors follow [W3C's hover/focus guidance](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html).

Give each help trigger a specific name such as “Explain Replace link,” rather than repeating “Explain this control.” Audit `withTip()` so adding a description preserves existing `aria-describedby` references. Associate field hints and errors programmatically with their controls; required-field and format instructions must be available before submission, following [W3C's form instructions](https://www.w3.org/WAI/tutorials/forms/instructions/).

Suggested copy to verify against the implemented behavior:

| Location | Copy | Placement |
| --- | --- | --- |
| Committee draft | “Save your work without changing the answers you last submitted.” | Visible next to Save draft |
| Committee submission | “Staff can read submitted answers while input is open. After it closes, members on this search can read them.” | Visible before submission |
| Profile adoption | “Review which committee priorities will become the candidate profile before saving.” | Short help beside preview/adoption |
| Questionnaire access | “This opens the questionnaire. It does not send an email. Copy the link and contact the candidate.” | Visible next to opening access |
| Replace invitation | “The old link stops working immediately. Share the new link with this candidate.” | Visible confirmation plus short help |
| Score release | “Makes panel scores visible to the search committee.” | Short help plus confirmation |
| New public publishing action | “Publishes this approved job page so anyone with its address can view it.” | Visible before publishing |
| Candidate Save draft | “Save and return later. Your application is not submitted until you select Submit application.” | Visible beside save state |

**Acceptance:** every priority screen answers what to do next, what is saved, and why an action is unavailable. Verify keyboard use, touch, screen-reader announcements, small screens, and zoom. Do not claim accessibility conformance from automated scans alone.

## 4. Public candidate portal

### First-release experience

**Browse openings → read job details → start application → verify email → complete and save → review → submit → receive confirmation → return securely.**

Browsing requires no account. Recommend passwordless applicant access for saving and returning, scoped to the application. Applicants must never need a staff workspace invitation. Prove the chosen identity flow against this Express app and the actual Clerk configuration before deciding whether to reuse Clerk identity or a separate managed applicant service; do not silently change organization settings.

| Screen | First-release requirements |
| --- | --- |
| Openings | Public listings grouped/scoped by recruiting firm, keyword search, location filter, clear empty state, and closing/review dates. Only deliberately published searches appear. Defer a combined cross-firm directory. |
| Job details | Position, jurisdiction, location, approved compensation text when provided, responsibilities, qualifications, approved public materials, application requirements, deadline policy/timezone, support contact, and Apply. |
| Application | Verified email, name/contact details, relevant professional background, configured initial questions, and required application materials. Save progress and show remaining requirements. Avoid collecting unrelated sensitive identifiers. |
| Review and submit | Readable summary, edit links, visible required declarations, exact application requirements, and one clear Submit application action. |
| Confirmation | Receipt/reference, submission time with timezone, received materials, any outstanding requirement, next-step wording approved for the posting, and a way to return. |
| Return to application | Show draft or receipt and any explicitly opened candidate questionnaire. Full recruitment-stage tracking, messaging, interview booking, and a reusable multi-job profile are later scope. |

Show application receipt independently from hiring status. Never infer “under review,” “shortlisted,” or “rejected” from internal scoring or workflow changes. An initial application receipt and a later questionnaire receipt must be clearly distinguishable.

### Staff publishing and incoming applications

- Add a **Public posting** area linked from the search overview and recruiting screens. Consultants prepare content; the search manager previews, publishes, pauses, closes, and republishes it through authority checks in `server/authority.js`.
- Publish a versioned snapshot of approved fields and selected public assets. Changes to internal research, draft ads, or search facts do not silently change the live job page.
- Require position, employer/jurisdiction, requirements, application form/material rules, deadline policy, published support contact, and an approved privacy notice before publication. Allow reviewed workspace defaults with per-posting overrides; the current deployment-wide support/privacy settings alone are insufficient for different firms.
- Keep **posting closed** separate from **search closed**. Closing recruitment stops new applications while staff continue evaluating existing applicants.
- Add **New applications** to Candidates, showing submitted date, source “Public portal,” completeness, and acknowledgement state. Reuse the existing candidate record and screening workflow after successful submission; drafts stay outside the committee's candidate list.
- Staff can inspect the submission snapshot and materials without the candidate's recovery credential. Private drafts do not appear in staff/committee views or shared exports.
- Treat possible matches to manually created candidates as a reviewable reconciliation. Do not overwrite or reveal an existing candidate record merely because someone entered the same email.

### Application rules

1. **Identity and duplicates:** verify ownership before returning saved information. Bind the application to the server-resolved posting and workspace. Enforce one active application per verified applicant per posting, preserve corrections/history, and keep applications across firms separate.
2. **Save and recovery:** store drafts server-side with an explicit expiry policy. Reuse the existing 14-day questionnaire draft policy as the proposed starting point, display the actual expiration, and define cleanup for related temporary files. Do not treat a draft as a received application.
3. **Submission:** validate on the server, freeze the question/posting versions, and atomically create/link the candidate, committed answers, document metadata, and receipt. Retries and double-clicks return the same committed result. Email failure must not undo a received application.
4. **Changed forms:** retain the form version a draft began with. Editorial changes may preserve it; material requirement changes require an explicit policy and candidate notice. Never silently discard entered answers or add unseen required questions at submit time.
5. **Deadlines:** support an explicit hard deadline or “open until filled” with an advisory first-review date. Display timezone; enforce only the chosen policy. Existing semifinalist requested dates are advisory and must remain so unless separately changed.
6. **Closure during editing:** recheck posting state at commit. If closed, preserve recoverable work and provide contact instructions without claiming receipt. Define authorized exception/reopening behavior and record it. Archiving or closing a search must stop public intake; restoring it must not automatically republish the job.
7. **Corrections:** submitted applications are immutable snapshots. A staff-authorized correction creates a new version and retains the original, following the existing questionnaire reopening pattern.

### Materials and communications

Recommend private resume upload in the first complete application release, with optional cover letter and posting-specific required materials. This changes the current external-document-only operating model and needs its own work package. If an approved external intake repository is selected instead, make the handoff and separate material receipt explicit; do not describe an application as complete before required materials are accounted for.

For native uploads: use private object storage, scoped upload/download authorization, bounded file sizes/counts, extension and content validation, generated storage keys, and malware quarantine/scanning. Start with a narrow approved format list; treat PDF-only as a proposal with an accommodation route. Quarantined documents are unavailable to reviewers, and incomplete scans must have an honest pending state. Follow [OWASP's file-upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html). File storage, scans, cleanup, backup, retention, and recovery all need named operational owners.

Email verification/recovery is a launch dependency for the recommended flow. Choose the provider, sender/domain configuration, delivery handling, resend limits, and recovery support during the technical spike. Confirmation emails should contain minimal information and a secure return path, not answers or attachments. Separate provider-confirmed delivery states from the existing staff-recorded contact log. Test with controlled recipients before launch; this planning task sends no messages.

### Public and private boundaries

- Use a dedicated allowlisted public posting serializer. Never serialize a complete search or candidate object and remove selected fields afterward.
- Applicants cannot see other applicants, committee identities/input, scores, rankings, internal notes, unpublished documents, staff logs, or internal hiring decisions.
- Validate application ownership and workspace scope on every read, write, upload, and download. Resolve scope from server records rather than trusting submitted organization/search IDs.
- Add limits specifically for verification, resend, application creation, submission, and uploads. Combine identity and IP limits with accessible abuse protection; avoid blocking a whole shared network unnecessarily. Bound abandoned records and storage growth.
- Keep recovery credentials out of logs, analytics, referrers, and search indexing. Use short-lived verification challenges, revocable sessions, and non-enumerating recovery responses. Apply CSRF protection to cookie-authenticated writes and validate redirect destinations.
- Exclude applicant pages, attachments, credentials, and responses from service-worker caching. `public/sw.js` currently bypasses `/api`, `/media`, and `/apply`; extend the boundary to new private routes. Public listing caching must respect unpublication and closure.
- Existing `/apply/:token` links continue under their current rules. Introduce the public flow additively; do not migrate or revoke active invitations accidentally.

## 5. Proposed implementation shape

Names below are proposed additions, not existing APIs or final schema commitments.

| Component | Responsibility |
| --- | --- |
| `content/help/`, `public/help.js` | Shared help catalog, article search, screen help, and print view |
| `public/app.js`, `public/app.css` | Existing staff navigation, accessible help component updates, publishing controls, incoming applications |
| `public/careers.js`, `public/careers.css` | Lightweight public listings, application screens, and candidate help; reuse visual tokens |
| `server/postings.js` | Posting snapshots, public projection, state and deadline rules |
| `server/applications.js` | Ownership, drafts, finalization/idempotency, receipts, and reconciliation |
| `server/applicant-access.js` | Adapter for verified applicant identity and recovery; keep staff organization authorization separate |
| `server/application-files.js` | Private materials, quarantine, metadata, and scoped downloads |
| `server/index.js`, `server/authority.js` | Public and protected routes; publishing permissions and request validation |
| `server/db.js`, `server/candidates.js`, `server/export.js` | Additive migration, committed candidate integration, permitted records exports |
| `server/backup.js`, `server/recovery.js`, `public/sw.js` | Recovery for added records/materials and cache boundaries |

Proposed routes: `/careers/:firmSlug`, `/careers/:firmSlug/:postingSlug`, and a separate private application area. Add public read endpoints under `/api/public/postings`; protect application draft, submission, and materials endpoints with applicant identity. Keep staff publishing endpoints under the authorized search routes.

Model a posting separately from a search, and a draft application separately from a submitted candidate. Store the owning workspace, search/posting association, published version, verified applicant association, form version, material references, timestamps, and final receipt. Never accept stage, score, manager, or permission fields from applicant input.

Begin with the existing single-process JSON-store architecture only for a bounded pilot. Load-test public intake alongside staff saves, enforce record/storage limits, and measure persistence and backup cost before setting a production volume target. If expected public traffic exceeds the measured safe envelope, introduce transactional database storage before broad launch. Do not scale app replicas against the same JSON store.

## 6. Work packages and sequencing

Effort ranges are planning estimates for one experienced full-stack developer with part-time content/design review. They exclude provider procurement, policy decisions, and waiting for pilot participants. Re-estimate after P0; these are not delivery commitments.

| Package | Deliverables | Dependencies | Approximate effort |
| --- | --- | --- | --- |
| P0 — Inventory and prototype | Screen/help inventory, prioritized copy, role journeys, public application prototype, identity/email/storage feasibility check, volume assumptions | Current code and release reconciliation | 2–3 days |
| P1 — Guide foundation | Shared content structure, help entry points, ten initial articles, glossary, printable view | P0 content map | 3–5 days |
| P2 — Contextual guidance | Priority screen copy, extended tooltips, save/error/empty states, next-task checklist, accessibility fixes | P0; links to P1 | 3–5 days |
| P3 — Publish and browse | Posting model/migration, manager-controlled preview/publish, listings, job details, public serializers | P0 publishing rules | 4–6 days |
| P4 — Apply and return | Verified access, drafts, resume/material intake, review/submit, receipts, email recovery, staff inbox integration | P3; working identity/email/storage/scan integrations | 8–12 days |
| P5 — Pilot and release | Candidate guide, end-to-end/security/accessibility checks, backup rehearsal, usability sessions, fixes, release evidence | Relevant P1–P4 acceptance checks | 3–5 days |

Combined estimate: **23–36 working days**, roughly **5–8 weeks** for one developer with review time. Guide/help work is the first independently useful release. Upload and identity integration are the largest estimate uncertainties.

Assign four responsibilities before implementation: product/content owner, engineering owner, operations owner for email/storage/recovery, and pilot coordinator. The same person may fill more than one role.

### Decisions to resolve in P0

| Decision | Recommended starting position |
| --- | --- |
| Portal visibility | Each firm gets its own public listings; publish only explicitly approved searches. |
| Package availability | Public application intake available to all packages; questions and later steps continue to follow package capabilities. Confirm the commercial decision before advertising it. |
| Applicant access | Passwordless verified email, independent of staff workspace membership; choose provider after the feasibility check. |
| Application materials | Private resume upload; required/optional materials configured per posting. Confirm format, size, storage, and scanning choices. |
| Deadline behavior | Explicit per-posting hard close or open-until-filled; no implicit cutoff from an advisory review date. |
| Required declarations and privacy | Use the firm's approved wording and retention policy; engineering records versions and implements those decisions. |
| Applicant status | Draft, submitted receipt, outstanding materials, and explicitly opened questionnaires only in release one. |
| Publication authority | Search manager publishes; consultants prepare and preview. |

These decisions guide implementation; none prevent delivery of this plan. The user has already selected the public browsing/application scope.

## 7. Verification and release gates

Extend the existing Playwright and server suites with meaningful behavior checks:

| Area | Required evidence |
| --- | --- |
| Help | Correct role/package article links, searchable tasks, working print view, preservation of entered work, and accurate copy tied to the tested release. |
| Accessibility | Hover/focus/tap and Escape behavior, unique help names, associated hints/errors, visible focus, mobile reflow, zoom, and manual keyboard/screen-reader journeys alongside automated checks. |
| Publication | Unpublished/paused/archived searches are absent from public results and cannot accept new intake; only authorized managers can publish; edits require deliberate republication. |
| Ownership | Applicant A cannot read/write/download B's records; applicants cannot enter staff routes; staff cannot cross workspace boundaries; recovery never leaks another record. |
| Submission integrity | Reload/resume, same-applicant concurrent tabs, duplicate submission, lost response after commit, failed persistence, changed form, and close/deadline during submit preserve correct records and honest receipts. |
| Materials and email | Wrong type/oversize/infected/pending files, guessed file IDs, expired downloads, scanner outage, verification expiry, resend throttling, provider outage, and bounce handling. |
| Compatibility | Existing private questionnaires, draft privacy, receipts, semifinalist access, corrections, search closure, archive/restore, and exports retain their intended behavior. |
| Operations | Additive migration defaults every existing search to unpublished; recovery covers application records and private materials; public intake load stays within the documented pilot limit. |

Run `npm run check`, `npm test`, and `npm run test:browser` on the project's supported Node 24 runtime during implementation. No application tests were rerun for this documentation-only plan.

Pilot the guide with at least one administrator/manager, one consultant, and two committee members. Pilot the portal with at least five representative candidates, including phone and keyboard users. Target at least four of five completing the application without coaching; any access leak, lost submitted application, or critical accessibility blocker prevents release. Small-pilot results guide improvements, not claims about the whole user population.

Release guidance first, then enable public intake for one controlled posting. Record completion, abandonment by step, recovery failures, support requests, and duplicate attempts without collecting answer text or credentials in analytics. Assign an owner to review the findings.

Keep public intake behind a deployment switch and per-posting publication state. Rollback pauses new applications and preserves submissions, receipts, materials, and staff review access. Reverting code must not destroy or orphan records written by the new schema. Expand after the pilot and restore rehearsal pass.

## 8. Immediate implementation starting point

Start P0 with a screen-by-screen help matrix and three representative prototypes: **committee input with guidance**, **public job details**, and **application review/receipt**. Then deliver P1/P2 as the first usable increment while the portal integrations are specified. This produces helpful improvements early and gives the public application flow a clear, testable foundation.
