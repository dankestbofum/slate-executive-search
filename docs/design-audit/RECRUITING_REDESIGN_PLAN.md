# Slate recruiting platform redesign: implementation plan

Date: 10 September 2026  
Status: Implemented. See the [recruiting redesign status](RECRUITING_REDESIGN_STATUS.md) for what shipped, the measurements after, and the human checks still open.

This is the next design pass after the [usability implementation plan](IMPLEMENTATION_PLAN.md). The [implementation status](IMPLEMENTATION_STATUS.md) records that plan's five core phases as implemented, with candidate saved drafts and human validation still open. This plan builds on those changes.

## Outcome

Make Slate feel like an established recruiting workspace while retaining its municipal executive-search identity. A consultant should immediately understand which searches need attention, where candidates are in the process, and what action to take next. Committee members should find their assigned work without navigating the consultant's entire workflow.

The direction is a compact workspace with Public Sans headings, restrained navy accents, clear candidate stages, useful tables, and consistent actions. Retain the Slate wordmark and use Newsreader in branding and generated documents. Prioritize hiring information over numbered workflow instructions.

## Starting point and scope

Fresh desktop screenshots of Home, search overview, and screening were reviewed using synthetic local data. The current overview repeats the next step in several places; large serif headers and introductory copy occupy substantial space; navigation emphasizes the process catalog. Screening already has filtering, readable stage badges, invitation controls, and a responsive table. Candidate review already places evidence beside scoring. Improve these working foundations.

Included:

- Shared workspace typography, surfaces, spacing, navigation, and action hierarchy.
- Search overview and candidate pipeline as the first complete redesign slice.
- Home portfolio view, including the minimal summary data it needs.
- Candidate profile presentation and navigation between review sections.
- Consistent treatment of committee, interview, document, and activity surfaces.
- Responsive, accessibility, state, and permission verification.

Separate future work: candidate saved drafts, drag-and-drop pipeline boards, calendar integration, email automation, global candidate search, resume parsing, new hiring stages, custom analytics, and a new file-upload system. The initial Interviews and Documents destinations organize capabilities already present in Slate.

Keep vanilla JavaScript and Express. A framework migration is outside this design scope. Preserve server-owned package and step rules, role permissions, optimistic revision checks, unsaved-edit protection, review invalidation, score sealing, invitations, receipts, and existing exports.

## Visual specification

| Element | Implementation direction |
|---|---|
| Workspace type | Public Sans; page titles 28–32 px desktop and 24–28 px mobile; section headings 18–20 px; body and inputs 15–16 px; labels and table content 13–14 px. Use 12 px only for supplemental metadata. |
| Brand and documents | Preserve the Slate serif wordmark and existing document typography. Scope workspace changes so shared type classes do not unintentionally restyle brochures, previews, or print output. |
| Color | Keep the existing navy accent and semantic status colors. Use a soft neutral canvas, white content surfaces, and muted borders. Define equivalent dark-theme tokens and verify contrast on actual surfaces. |
| Spacing | Use the existing 4/8/12/16/24/32 px scale. Reduce header height and large instructional panels; preserve comfortable form spacing. |
| Containers | One clear surface for a table or section; avoid cards nested inside cards. Use subtle separation and existing 6–10 px corner radii. |
| Actions | One dominant task action per action area. Use a quiet row-level Review control or clearly actionable candidate name; move infrequent corrections and destructive actions into labeled menus. Keep Save prominent during editing. |
| Status | Short labels with consistent meanings and accessible text. Color supplements the label. Show saved, unsaved, saving, failed, and stale states beside the relevant action. |
| Navigation | Compact labeled icons, a visible selected destination, and a persistent search identity. Retain the visible Back control, focus indicators, tooltips, and mobile drawer behavior. |

Starting layout targets: approximately 232–248 px desktop rail, 24–32 px content padding, and 40 px ordinary controls with 44 px touch controls. Use the existing 900 px drawer breakpoint initially; adjust only when content testing supports it. Avoid fixed heights that clip long names, translated browser text, or zoomed content.

## Information architecture

Global navigation remains Home with access to Archives and Packages. Within a search, show the following destinations. Secondary search utilities belong in a labeled Search settings/More area. Account and theme controls stay compact in the rail footer.

| Destination | Existing content and proposed behavior |
|---|---|
| Overview | Existing `overview` route; concise search health, candidate stage counts, outstanding work, and recent activity. |
| Candidates | Existing `screen` route as the default list; `person`, `send2`, and `finalists` remain reachable from this area. Highlight Candidates on candidate detail and related selection screens. |
| Interviews | New lightweight hub linking to permitted `video`, `guide`, and `schedule` work. Distinguish the interview log, interview materials, and assessment schedule. No calendar or scheduling integration is implied. |
| Committee | Existing `team` and `intake` work grouped together, with a direct route to the viewer's assigned questionnaire. Link to adopted criteria in `profile`. |
| Documents | New index of existing artifacts, their draft/review state, and their editors: `profile`, `community`, `survey1`, `survey2`, `guide`, `plan`, `brochure`, `ads`, `schedule`, `contract`, and `bar`, where included. |
| Activity | Existing search activity presented as a dedicated view. Keep privileged History and recovery separate from the ordinary activity timeline. |
| Process checklist | Accessible from Overview and search navigation. Retain all included steps, prerequisites, completion state, and direct links, including sourcing and reference checks. |

Define one presentation mapping from existing view keys to destinations and reuse it for rail selection, breadcrumbs, and labels. Existing hash URLs must continue working. Add stable routes only for the new hubs; extend route validation, role/package checks, title generation, and direct-link fallbacks together.

Use the server-supplied included steps and access rules to determine available links. Hide destinations with no authorized content. When an included task is blocked by a prerequisite, explain the prerequisite and link to it where permitted. New hubs must not bypass existing access checks.

## Screen composition

**Home:** compact page header and New search action; work requiring attention; active-search table; secondary archive access. Rows show client/position, current process phase, candidate count, account manager, and next action. Show a deadline only when an actual supported date exists, labeled by its purpose. Include local text filtering and clear empty/no-results states. Committee Home remains an assignment list.

**Search overview:** client, role, and process phase in the header; one primary next action; clickable candidate stage summary; outstanding work; compact committee status and recent activity. Put package descriptions and the complete process behind secondary access. Do not repeat the same next step in a header button, metric tile, rail message, and large panel.

**Candidates:** compact header, stage-count filters, name/role/organization search, response filter, and Add candidate. Rows prioritize identity, stage, response status, and Review. Keep invitation actions available without exposing raw links as table data. Use stacked rows on mobile. A board is deferred until the table experience is validated.

**Candidate detail:** identity and stage header; Review as the default section with responses beside the viewer's scorecard; Details for existing metadata and permitted invitation/correction controls. Add an Activity section only when existing events can be reliably attributed to that candidate. Do not manufacture an individual history from unrelated search events. Preserve edits and focus when switching sections. On mobile, provide clear Evidence and Scorecard navigation while keeping the draft in memory.

**Other surfaces:** use the shared header, section, field, status, and action components. Keep document Edit/Preview and review controls, committee draft/submission behavior, and the public questionnaire's focused layout. Generated documents retain their own presentation.

## Data and state contract

1. **Home summaries:** `GET /api/searches` currently includes process progress, account manager, intake status/due date, and timestamps, but no candidate counts. Add a small, role-authorized candidate count summary to that response. Avoid fetching every full search merely to render Home. Test that unrelated search records and protected candidate details are not exposed.
2. **Stage semantics:** use the existing `applicant`, `semifinalist`, `finalist`, and `declined` values. Counts are mutually exclusive current stages. Do not invent Interview, Offer, or Hired states. Display declined candidates as a separate outcome filter. Keep process phase distinct from candidate stage and step-completion progress.
3. **Filter semantics:** calculate each stage count after applying text and response filters, before applying the selected stage. “All” includes every stage the viewer may see. Label the resulting visible/total count. Overview links clear unrelated candidate filters, apply the selected stage, and open the list; Back from detail restores the list's filters, scroll, and focus.
4. **Deadlines and attention:** the portfolio summary currently has an intake deadline, not a general next hiring milestone. Initially label it “Committee intake due” when relevant. Derive other next actions from existing workflow data; do not describe them as overdue without a stored due date. Missing dates display as absent, never as invented values.
5. **Freshness:** refresh affected summaries after candidate additions or stage changes and on Home entry. Preserve the existing list with retry feedback when a refresh fails. Use the API result after a successful mutation to update counts.
6. **Scoring and documents:** default to the current viewer's permitted data. Preserve sealed/released states, revision conflict handling, source-based review invalidation, and explicit save behavior. Section switching must not silently discard scores, notes, or document edits.

## Delivery sequence

Estimates are planning ranges for one engineer familiar with this repository, including targeted verification. Core scope is approximately **16–24 engineering days**. Real-user availability can extend calendar time. Complete each phase's acceptance checks before building dependent work.

### Phase 1 — Establish the visual system and navigation: 3–4 days

- Capture the current implemented screens into a new evidence directory using synthetic data; retain the earlier audit evidence.
- Define workspace-scoped typography and surface tokens; implement a compact shared page header, section header, menu, and navigation item.
- Introduce the destination mapping, compact account controls, and accessible process checklist. Add minimal hub views backed by existing content.
- Preserve existing routes, Back behavior, dirty-state protection, tooltips, focus management, and responsive drawer.

**Code:** `public/styles.css`, `public/app.css`; `public/app.js` functions `head`, `shell`, `railPhaseGroups`, `routeFor`, `parseRoute`, `backFallback`, `viewLabel`, navigation/render handling; `server/steps.js` as the authoritative reference for included steps.

**Accept when:** every included existing task remains reachable; old deep links work; new hubs reject unauthorized access; active navigation identifies the correct section; drawer closes with Escape and restores focus; workspace headings use the new typography while document previews retain theirs. At 1280 × 720, the overview's hiring summary appears in the first viewport.

### Phase 2 — Redesign overview and candidate pipeline: 3–4 days

- Recompose Overview around candidate progress and outstanding work; remove repeated next-step panels and relocate Archive to More.
- Add stage-count filters and their Overview links using the contract above.
- Refine candidate row hierarchy, invitation actions, Add candidate panel, response states, and mobile layout.
- Keep stage advancement and score release deliberate actions using existing permissions and confirmations.

**Code:** `public/app.js` functions `vOverview`, `overviewInner`, `overviewTiles`, `candidatePanel`, `outstandingPanel`, `activityPanel`, `vScreen`, `candidateRow`, `listFilter`, `filterCandidates`; related styles and event handlers.

**Accept when:** an Overview stage count opens the matching list; filters and counts agree for all four existing stages; stage changes update the visible counts; 0, 1, and 20 candidates render cleanly; long identities retain a visible Review action; Back restores list context. At 1440 × 1000, the candidate list header and at least five ordinary rows are visible without scrolling. Mobile rows require no sideways page scroll.

**First reviewable milestone:** the complete shell, Overview, and Candidates slice. Capture light/dark and desktop/mobile examples here and resolve hierarchy problems before extending the style to the remaining screens.

### Phase 3 — Build the recruiting portfolio Home: 2–3 days

- Extend the search-summary response with authorized counts and use it in the compact portfolio table.
- Add text filtering, a useful attention area, manager and phase information, and accurately labeled intake deadlines.
- Retain immediate visibility of newly created/restored searches and removal of archived searches.
- Preserve committee Home as a role-specific task list using the same visual language.

**Code:** `server/index.js` `GET /api/searches`; `server/db.js` summary/access helpers as needed; `public/app.js` functions `vHome`, `vHomeCommittee`, `loadSearches`, mutation reconciliation; Home styles.

**Accept when:** Home loads summaries without one request per search; counts match authorized search data; updates appear on return from candidate work; missing dates have honest empty states; filtering has a clear reset; 0, 1, and 10 searches remain usable; committee users see only their permitted assignments and summaries.

### Phase 4 — Refine candidate profiles and review: 3–5 days

- Introduce the compact identity header and Review/Details sections; provide candidate-specific activity only if supported by existing records.
- Keep questionnaire evidence beside score entry on desktop and make both accessible on small screens.
- Standardize score progress, save feedback, released-score presentation, and permitted corrections.
- Preserve draft values through local section changes and warn on navigation that would discard them.

**Code:** `public/app.js` functions `vPerson`, `surveyRead`, `ratingGroup`, `actionBar`, score and invitation handlers; candidate/review styles. Consult `server/candidates.js`, `server/integrity.js`, and permission serializers before changing any data exposure.

**Accept when:** keyboard users can read evidence, score, save, and return to the list; switching sections preserves unsaved scores and notes; failed saves retain entries; stale revisions use the existing recovery behavior; other panel scores remain sealed until release; stage changes do not discard drafts; replacement invitation links and reopened questionnaires retain existing behavior.

### Phase 5 — Apply the system across remaining surfaces: 3–5 days

- Complete the Interviews, Committee, Documents, and Activity hub layouts using existing permitted content.
- Apply shared layout and status patterns to New search, Search facts, profile/intake, artifact editors, staff logs, packages, archives, and history/recovery.
- Keep the candidate questionnaire visually aligned through restrained shared controls while preserving its simple public layout and receipt behavior.
- Verify brochure, advertisement, guide, and other generated outputs after workspace CSS changes.

**Code:** `public/app.js` functions `vNew`, `vFacts`, `vTeam`, `vProfile`, `vIntakeAnswer`, `artifactEditor`, `vDraft`, `vBrochure`, `vStaff`, `vPackages`, `vArchives`, `vHistory`, `vApply`; shared and page-specific styles; new hub render helpers.

**Accept when:** all roles use consistent headings and actions; every package exposes only its included work; manual document creation and Edit/Preview still preserve content; review invalidation stays visible; staff logs retain their data; exported documents retain intended typography and pagination; candidate submission and receipt reload succeed.

### Phase 6 — Validate the complete experience: 2–3 days

- Run the full verification matrix below and compare populated screenshots with the Phase 1 baseline.
- Complete a real phone/tablet pass and screen-reader review; record device/browser details and findings.
- Run short task sessions with a consultant and committee member: find the next action, locate a candidate, complete a review, locate a document, and return to prior work.
- Record completed scope, evidence, remaining issues, and any separately scheduled product work in a new redesign status file.

**Accept when:** critical workflows and role boundaries pass; no task-blocking visual or interaction issues remain; human review findings are resolved or explicitly recorded as outstanding. Do not report unperformed human checks as complete or treat a clean automated scan as accessibility conformance.

## Verification and release

| Dimension | Required coverage |
|---|---|
| Screens | Home, Overview, Candidates, candidate detail, new hubs, representative form/editor, committee intake, public questionnaire/receipt. |
| Viewports | 1440 × 1000, 1280 × 720, 768 × 1024, 390 × 844, 320 px reflow; browser zoom separately. |
| Themes | Light, dark, auto, and transitions after colors settle. |
| Roles/packages | Consultant, account manager, committee member, public candidate; Basic, Enhanced, Executive; denied and excluded-step deep links. |
| Data | Empty and populated searches; long names/organizations; all four candidate stages; missing dates; unsubmitted/submitted responses; long scorecards and documents. |
| State | Filtering, no results, Back/Forward, refresh, direct entry, unsaved edits, saving, failed request, revision conflict, sealed/released scores, invalidated review, archived/restored search. |
| Accessibility | Semantic tables and labeled sections, named controls, visible focus, menu/tab keyboard behavior, tooltip focus/Escape/touch access, contrast, screen-reader review, and sticky bars that do not obscure focused content. |

Use `npm run check` and targeted browser suites during each phase. Extend existing behavior tests in `tests/browser/workspace.spec.js`, `reflow.spec.js`, `journeys.spec.js`, and `accessibility.spec.js` where the behavior changes. Add server coverage for summary authorization and counts when extending the API. Use visual inspection for typography/spacing rather than tests that merely mirror CSS values or count elements.

Before release, run `npm test` and `npm run test:browser`, complete the manual checks, and inspect representative exported documents. Keep synthetic fixtures and screenshots under a new `docs/design-audit/evidence/recruiting-redesign/` directory. Review the deployment checklist and record any incomplete validation before rollout.

Use independently reviewable commits or PRs aligned to the phases. Avoid persistent schema changes in this scope so rollback can restore the prior application version without altering search data. The first slice should be usable on its own; new hubs can initially link to existing editors while their presentation is refined in Phase 5.

## Completion criteria

- Hiring progress and candidate work dominate Overview and Candidates; next-step instructions appear once in the relevant action area.
- Consultants can navigate by recruiting task while the full guided process remains available.
- Home counts and dates represent existing authorized data and remain current after work elsewhere.
- Existing routes, drafts, role boundaries, review rules, exports, and candidate submissions remain dependable.
- The same design conventions extend across the workspace, with populated screenshots and verification results supporting completion.
