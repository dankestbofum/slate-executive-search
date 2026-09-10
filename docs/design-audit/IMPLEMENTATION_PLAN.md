# Slate UI implementation plan

Companion to the [design audit](AUDIT.md). This is a proposed implementation sequence; the application has not been redesigned as part of this audit.

## Outcome and constraints

Make the active task visible immediately, make saved work easy to find, and make the primary workflows understandable without reading the process catalog. Retain the existing visual identity and server-owned package/step rules.

Use the current vanilla JavaScript/Express architecture. Shared render helpers and scoped CSS are sufficient; a framework migration would add work without addressing the findings. Preserve existing role permissions, optimistic revision checks, unsaved-edit protection, review invalidation, score sealing, and candidate receipt behavior.

## Proposed screen structure

| Surface | Proposed order |
|---|---|
| Consultant Home | Page title + New search; work needing attention; active searches with next action; compact archive access |
| Search overview | Client/position + phase; next action; outstanding tasks; candidates and committee summary; recent activity; expandable full process |
| New search | Client and role; compact package selector; optional details; Create search/Cancel |
| Search step | Search/step context; status and prerequisite notice; task content; persistent save/complete actions; secondary navigation |
| Screening | Search/filter and Add candidate; readable candidate rows; review/stage/invitation actions |
| Document editor | Title + draft/review status; Edit/Preview controls; structured content; save/review/export actions |
| Committee | Pending task and due date; section progress; questionnaire; Save draft/Submit |
| Candidate | Search identity + question count/help; questions; draft/submission status; receipt |

On desktop, keep a compact left rail with workspace links and collapsible search phases. At 900 px and below, replace the in-flow rail with a short app bar and a navigation drawer. Current phase/step remains visible when the drawer is closed. More detailed breakpoint tuning follows actual content testing.

## Requested additions: Back button and hover text

These are explicit user requirements, included in the core implementation scope.

### Visible Back button

- Place a labeled arrow + Back control consistently in the workspace page header, above the title; keep it available in the compact mobile header. Use a destination label where useful, such as Back to screening.
- Return to the previous visited app screen, rather than automatically moving to the previous numbered workflow step. Restore the relevant search, list filters, scroll position, and focus where possible. Use the same navigation state as browser Back/Forward.
- For a direct link with no valid in-app history, fall back from candidate detail to Screening, from a search step to its search overview, and from overview/New search/Packages/Archives to Home. Never send the user to an unrelated external page through the app's Back control. Omit it on Home when there is no meaningful return destination.
- Protect unsaved edits on Back exactly as on other navigation. Canceling departure must preserve the current URL, view, and values; completed submissions must not be repeated by going back. The public invitation/receipt flow remains separate from workspace navigation.

### Hover text and contextual help

- Provide short tooltips for unfamiliar actions, icons, status badges, rating scales, and truncated navigation labels. Explain the effect or meaning instead of repeating the visible label. Keep essential instructions, prerequisites, and destructive-action consequences visible in the page or confirmation.
- Examples: Copy invite → “Copy this candidate’s questionnaire link”; Release scores → “Make panel scores visible to the search committee”; Mark reviewed → “Record that you checked this draft against its sources.” Explain the actual prerequisite beside an unavailable action.
- Implement a shared tooltip component with a brief hover delay, keyboard-focus access, Escape dismissal, and positioning that stays inside the viewport. Associate the description using `aria-describedby`; retain an accessible name on the control itself. Tooltips contain no interactive controls and remain open while the pointer is over their content.
- On touch devices, use a labeled help button/disclosure for explanations that need on-demand access; a tap on an action must still perform that action. Do not depend solely on native `title` attributes or hover. Explain disabled controls with adjacent help or a focusable help trigger rather than making a disabled button the only source of information.

**Ownership:** Back belongs to Phase 1 (shared shell and routing). Hover text belongs to Phase 2 (shared controls/help), with specific copy applied during Phases 3–5.

## Delivery sequence

Estimates are planning ranges for one engineer familiar with this repository, including targeted verification. They are not commitments. Execute the phases in order; total core scope is approximately **13–20 engineering days**, plus **2–4 days** if candidate draft/resume is included. Product review and real-user sessions may extend calendar time.

### Phase 1 · Restore usable navigation and reliable state · 2–3 days

Addresses D01, D03, D07, D11.

- Refresh/reconcile `state.searches` on Home entry and after create/archive/restore or summary-changing actions. Provide retry behavior without blanking existing records on a failed fetch.
- Introduce the mobile app bar/drawer; give desktop phase sections expand/collapse controls with current-step status. Add a skip-to-content link.
- Add URL-backed view selection, Back/Forward support, refreshed-view restoration, active-step breadcrumbs and page titles. Validate search access and excluded package steps before rendering a deep link.
- Add the visible Back control and deterministic direct-link fallbacks specified above; share its history and unsaved-edit handling with browser navigation.
- Manage focus for navigation and drawer open/close; maintain unsaved-edit confirmation. Keep focus stable during field edits.
- Scope theme state to `button[data-theme]`, remove any stale root `aria-pressed`, and correct the confirmed contrast combinations.

**Code:** `public/app.js:shell`, `railPhaseGroups`, `go`, `crumbs`, `render`, `loadSearches`, `createSearch`, `boot`, theme handler; `public/styles.css` shell/breakpoints; `public/index.html` skip link/title support.

**Accept when:** at 390 × 844 and 768 × 1024, heading and first task action are visible without scrolling past navigation; creating a search and returning Home immediately shows it; refresh and Back restore the intended screen; drawer supports keyboard close and focus return; Light/Auto/Dark transitions have no invalid ARIA or confirmed contrast regressions.

**Back checks:** open a filtered candidate list → candidate → Back and recover the list context; open a search step directly → Back and reach its overview; cancel Back with unsaved edits and retain every value; use both browser and on-page Back without loops or duplicate submissions.

### Phase 2 · Establish shared layout and rebuild entry screens · 2–3 days

Addresses D02, D06, D08, D09.

- Define a small set of shared primitives: page header, section heading, status notice, form field, action bar, empty state, list/table row, and labeled rating group.
- Add the shared tooltip/help component and a concise description inventory for actions and statuses; apply the hover, focus, touch, and disabled-control rules above.
- Give form grids explicit column counts; keep dashboard auto-fit layouts separate. Consolidate duplicated `.grid2`, `.sub`, `.btn--ghost`, `.btn--sm`, and textarea rules instead of appending further overrides.
- Standardize typography, spacing, focus and component states. Starting targets: 15–16 px inputs/body, 13–14 px labels, 12 px supplemental metadata, 40–44 px ordinary controls and 44 px touch controls where practical; 16/24/32 px section spacing. Validate against actual content.
- Rebuild New search and Search facts with essentials first, a compact package choice, expandable comparison, optional details, and adjacent validation.
- Simplify Home and overview: remove repeated account tiles and duplicate actions; surface pending tasks, candidate status, and recent activity. Move archive into a labeled menu and full process/package detail into secondary areas.

**Code:** `app.js:head`, `field`, `vHome`, `vNew`, `vFacts`, `packagePicker`, `overviewInner`, `overviewTiles`, `phaseSpecs`; `styles.css` tokens/components; `app.css` page-specific styles.

**Accept when:** client and position fields appear in the first desktop viewport; required fields are identified; package selection preserves typed data; users can submit at the end of a form; four-column accidental form layouts are gone; selected, disabled, error, loading and empty states use the shared components.

**Help checks:** descriptions appear on hover and keyboard focus; Escape dismisses them without activating the control; moving onto tooltip content keeps it readable; explanations stay within the viewport at 320 px and zoom; touch users can access equivalent help; icon controls retain accessible names without an open tooltip.

### Phase 3 · Make candidate review and scoring efficient · 2–3 days

Addresses D04 and scoring portions of D06/D07.

- Replace long invitation strings with Copy invite and Open questionnaire controls, including success/failure feedback.
- Collapse Add candidate into a deliberate form panel. Make Review the obvious row action; separate stage advancement and score release from ordinary navigation.
- Add client-side name filtering and stage/response filters using existing loaded records; do not add a backend query system for the current scale.
- Create stacked mobile candidate rows. Keep essential stage and questionnaire status visible without sideways scrolling.
- Group score controls by criterion with clear scale labels and a saved/unsaved state. Bring candidate responses close to the scoring task; use a responsive evidence/score layout or named sections rather than putting all evidence below actions.
- Add a persistent Save scores action and explicit confirmation/state feedback for release or stage changes.

**Code:** `app.js:vScreen`, `vPerson`, `vSend2`, `vFinalists`, score handlers; table/rating styles in both stylesheets. Preserve current API permissions and sealed-score behavior.

**Accept when:** 0, 1, and 20 candidates render clearly; long names and organizations do not displace actions; invitation and review actions are visible at 390 px; copy failure has a usable fallback; unsaved scores cannot disappear during advancement/navigation; private scores remain private.

### Phase 4 · Restructure forms and document work · 4–6 days

Addresses D05, D06, D10.

- Add section navigation and completion counts to profile/intake. Collapse suggestion banks once criteria are selected; preserve input values and focus on add/remove/reorder operations.
- Introduce named weight/score groups with endpoint explanations. Keep manager and committee permissions reflected in the controls.
- Support structured document creation from an empty artifact: add/remove question or section controls and relevant fields, including required-question flags. Keep raw source under Advanced.
- Use Edit/Preview modes and a shared action bar. Distinguish unsaved content, saved draft, reviewed content, and content requiring review after source changes.
- Place source/prerequisite warnings within the normal content width and provide direct navigation to the dependency. Explain AI unavailability beside generation controls; keep manual editing available.
- Apply the editor pattern to the brochure studio, ad formats, guide, schedule, contract, and evaluation without losing layout options, source links, review requirements, or print output.

**Code:** `app.js:vProfile`, `critRow`, `vIntakeAnswer`, `intakeGroup`, `artifactEditor`, `sourceJson`, `vDraft`, `vCommunity`, `vBrochure`, `brochureStudio`, `reviewBar`, `withBusy`; editor/studio styles. Review artifact validators in `server/integrity.js` before expanding creation controls.

**Accept when:** a consultant can create a survey manually without JSON or AI; draft edits remain intact when switching Edit/Preview; saving updates the preview; source/profile changes visibly invalidate review; all four profile groups remain navigable with twelve to twenty criteria; brochure/ad print snapshots retain intended pagination and legibility.

### Phase 5 · Finish secondary surfaces and validate the complete experience · 3–5 days

Addresses D12 visual changes and D13; verifies earlier phases.

- Add candidate question count, support access near the top, and tighter mobile header spacing. Preserve successful-submission and receipt behavior.
- Apply consistent actions, empty states, headings and responsive layouts to staff logs, archives, history/recovery, and package previews.
- Expand browser fixtures to cover populated and empty states across roles and packages. Replace assertions that merely count headings or detect a print rule with checks that exercise the actual requirement.
- Complete screenshot review, keyboard passes, screen-reader checks and one real phone/tablet pass. Run short task-based reviews with a consultant and committee member; record confusion and iterate on the affected components.

**Code:** `app.js:vApply`, `applySupport`, `vStaff`, `vArchives`, `vHistory`, `vPackages`; `tests/browser/journeys.spec.js`, `accessibility.spec.js`; appropriate server suites when behavior changes.

**Accept when:** all P1 findings are resolved, each role's core journey passes, long-content screens reflow, and staff/archive/package surfaces use the same action and layout conventions. Do not declare accessibility conformance from axe results alone.

### Optional extension · Candidate saved drafts · 2–4 days

The current public flow has unsaved-change protection but no draft endpoint. Add a separate draft state under the candidate's existing scoped invitation, a Save and finish later action, saved timestamp, resume behavior, and handling for changed/reopened questionnaire versions. Keep drafts distinct from submitted responses, receipt creation, review visibility, and completion status.

**Code:** `server/candidates.js`, candidate routes in `server/index.js`, persistence/validation as needed; `app.js:vApply` and submission handling; candidate server/browser tests.

**Accept when:** a partially completed response survives refresh and return; it is never shown as submitted; retry or reconnect cannot create duplicate submissions; questionnaire changes are explained and draft answers are not silently discarded. Estimate depends on the persistence/versioning design.

## Verification matrix

| Dimension | Required coverage |
|---|---|
| Viewports | 1440 × 1000, 1280 × 720, 768 × 1024, 390 × 844, 320 px reflow; actual browser zoom separately |
| Roles | Consultant/account manager, committee member, candidate |
| Packages | Basic, Enhanced, Executive, including excluded-step deep links |
| Data | Empty, typical, long names/content, twenty candidates, twelve to twenty criteria |
| State | Unsaved, saving, failed save, stale revision, blocked prerequisite, draft, reviewed, released/sealed, receipt |
| Accessibility | Axe on populated screens and after theme transitions; keyboard task completion; focus return; labels/rating groups; tooltip hover/focus/Escape and touch-help access; screen-reader review |
| Regression | Start → create → Home; roster → intake → profile; manual document → review; candidate → score → advance; questionnaire → receipt → reload; archive → restore; visible/browser Back with direct links, list context, and unsaved edits |

Use `npm run check`, targeted Playwright tests during each phase, and `npm test` when state, routing, or API behavior changes. Run the full browser suite before the final rollout. Add meaningful behavior checks for the stale Home list, mobile content position, theme ARIA scope, URL restoration, invitation actions, and structured document creation; do not rely only on screenshot snapshots.

## Suggested change boundaries

Ship independently reviewable changes: (1) Home refresh and theme fixes, (2) shell/routing/focus, (3) shared fields/actions and entry screens, (4) candidate workflows, (5) profile/intake, (6) artifact editors, (7) secondary surfaces and final verification. Candidate saved drafts should be a separate change because they introduce persistence behavior.

Review Phase 1 and the New search/overview portion of Phase 2 before spreading their components through the app. Keep `server/steps.js` authoritative for workflow/package rules; the design should reveal those rules more clearly, rather than duplicating them in UI conditionals.
