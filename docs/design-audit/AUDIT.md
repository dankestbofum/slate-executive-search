# Slate interface design audit

Audited September 9, 2026, America/Phoenix. Scope: the current app served from `public/`, not the standalone `slate.html` prototype.

**The interface feels off primarily because its hierarchy follows the process catalog instead of the task someone is doing.** Long navigation, package detail, repeated instructions, and competing buttons obscure the work. The restrained navy, warm neutrals, and serif headings already give Slate an appropriate identity; a rebrand would not resolve these problems.

Read the [implementation plan](IMPLEMENTATION_PLAN.md) for the proposed work sequence, code boundaries, and completion criteria.

## Review method and limits

Used a separate local server on port 4190, a temporary data directory, and synthetic searches, committee members, candidates, criteria, and survey responses. Production records were not used. No AI requests were made. The available runtime was Node 22.18.0; the project specifies Node 24, so this audit is not release certification.

Inspected rendered screens with Chromium at 1440 × 1000, 390 × 844, and selected 768 × 1024 layouts. Reviewed source templates, styles, navigation, save behavior, and existing browser tests. Ran targeted axe WCAG 2.1 AA scans. Screenshot capture covers all nineteen workflow steps; deeper interaction covered search creation, candidate review, committee input, package previews, and candidate submission.

| Area | Coverage |
|---|---|
| Landing, Home, New search, Search facts | Empty and populated Home; creation; desktop and selected mobile layouts |
| Search overview and packages | Executive search; Basic, Enhanced, Executive sample dashboards; tablet and dark overview |
| Committee | Manager roster/intake surfaces; committee Home and open questionnaire |
| Profile | Empty and twelve-criterion populated layouts, desktop/mobile |
| Community and recruiting documents | All document entry surfaces; empty and populated initial survey editor |
| Candidates | Empty/populated screening; candidate scorecard; semifinalist and finalist empty states |
| Staff work | Sourcing, video interviews, references entry surfaces |
| History and archive | Empty views and source behavior |
| Public questionnaire | Desktop/mobile; successful submission; receipt after reload |

Not established: live AI generation quality, fully populated brochure/ad print output, released multi-person scoring, completed archive/restore journeys, real device behavior, screen-reader usability, or full keyboard conformance. The brochure and later-stage recommendations below combine entry-screen inspection with source review, rather than claiming all output states were visually verified.

## Findings

P1 = materially impedes a primary task or undermines confidence. P2 = substantial friction or inconsistency. P3 = refinement. Severity reflects the user impact of a finding, not axe's own severity labels.

### D01 · P1 · Navigation consumes the mobile workspace

At 390 px wide, the Executive search rail occupies approximately **1,340 px before the main content**; the page heading begins around **1,476 px** down. The same issue affects tablets: the heading starts near 1,445 px at 768 px wide. Each navigation action scrolls back to the top of this menu. Even the smaller committee menu places the intake heading around 868 px down.

The breakpoint changes the rail to a static, full-height content block rather than introducing mobile navigation. Users repeatedly scroll through account details, workspace utilities, nineteen steps, theme controls, and logout to resume work.

**Change:** compact mobile app bar and an accessible navigation drawer; desktop phase groups that can collapse; a persistent search identity and current-step label. Keep account/theme utilities out of the primary task area.

Evidence: [mobile screening](evidence/mobile-screen.png), [tablet overview](evidence/tablet-overview.png). Code: `styles.css:94–124, 680–685`; `app.js:shell`, `railPhaseGroups`, `go`.

### D02 · P1 · Package detail buries search creation

The client-name input starts at **y = 1,645 px** on a 1440 × 1000 desktop. A full comparison matrix appears before the hiring details, while the only Create search button is above the matrix. The form stretches to about 2,117 px. Required fields are not visually distinguished from optional research information. Search facts repeats the same package-heavy arrangement.

**Change:** show client, position, jurisdiction type, and state first; use a compact package selector with expandable comparison; move supplemental research fields into a clearly optional section. Place the submit control at the form's end or in a persistent action bar.

Evidence: [New search](evidence/03-new-desktop.png), [Search facts](evidence/desktop-facts.png). Code: `app.js:vNew`, `vFacts`, `packagePicker`, `packageMatrix`.

### D03 · P1 · Home can hide a newly created search

Reproduction: enter the workspace with no searches → create a search → use Home. The new search is absent and the counts still read zero. Reloading the app makes the record appear. This interrupted the audit's own navigation and is separate from visual preference.

`createSearch()` updates `state.search`, but not `state.searches`; `go('home')` renders the existing list without refreshing it. A user could reasonably assume creation failed and make a duplicate.

**Change:** refresh or reconcile the search index after successful mutations and on Home entry; preserve the existing list if a refresh fails and show an actionable error.

Evidence: [stale Home](evidence/desktop-home-stale.png), [Home after reload](evidence/desktop-home-refreshed.png). Code: `app.js:createSearch`, `go`, `loadSearches`, `vHome`.

### D04 · P1 · Candidate tables conceal the decisions

Raw invitation URLs consume the screening table's width. In the sample, the table is about **1,350 px wide inside a 326 px mobile viewport**. On desktop, candidate names and job titles wrap while advancement controls sit beyond the initial visible table area. The always-open add-candidate form also takes priority over reviewing existing candidates.

**Change:** replace the raw URL column with Copy invite/Open questionnaire actions; prioritize name, role, stage, response status, and Review. Put adding a candidate behind an explicit control. Use stacked candidate rows on small screens and preserve horizontal scrolling only where actual comparison benefits from it.

Evidence: [desktop screening](evidence/desktop-screen-populated.png), [mobile screening](evidence/mobile-screen.png). Code: `app.js:vScreen`, `vSend2`; `.tablewrap`.

### D05 · P1 · Document entry exposes a technical editing surface

An empty initial survey offers Draft with Claude, Save edits, Next, and a large editable `{}` JSON box. Structured editing becomes available after a draft exists. This leaves manual first-time creation poorly supported. Populated surveys stack a read preview above the editor, increasing travel between content and actions.

**Change:** provide structured blank-state editors with Add question/section. Offer explicit Edit and Preview modes, review status, and a consistent save bar. Keep raw JSON under an Advanced disclosure if it remains necessary. Make AI generation a supported optional entry path with clear availability feedback.

Evidence: [empty survey](evidence/desktop-survey1.png), [populated survey](evidence/desktop-survey-populated.png). Code: `app.js:artifactEditor`, `sourceJson`, `editorWrap`, `vDraft`, `vBrochure`.

### D06 · P1 · Save, advance, and completion actions compete

The roster shows four blue actions across the screen: Roster is set, Next, Seat this person, and another Next. Draft pages emphasize both generation and navigation while Save edits is secondary. New search puts submission before the fields. The scorecard emphasizes advancing the candidate before the scoring task, with Save my scores at the bottom.

**Change:** distinguish task submission from navigation. Each action area should have one dominant task action. Use a consistent bottom save bar for long forms; keep Next secondary until the current action is complete. Show Unsaved changes/Saving/Saved/Save failed beside the action. Keep phase prerequisites and incomplete states explicit.

Evidence: [roster](evidence/04-created-search-team.png), [scorecard](evidence/desktop-scorecard-populated.png). Code: `app.js:head`, `nextBtn`, `stepFooter`, `vTeam`, `vPerson`, `withBusy`.

### D07 · P1 · Theme changes introduce invalid accessibility markup; tinted labels fail contrast

Targeted scans found:

- Selected package fees and labels on the blue Continue panel: **4.32:1** contrast against the tinted surface.
- The empty Phase 2 navigation hint: **3.91:1**, including the parent's opacity effect.
- Switching to Dark causes `aria-pressed` to be written onto `<html>` because the handler selects every `[data-theme]`, including the document element. The invalid attribute persists when returning to Light.

These failures occur outside the limited landing/empty-Home/candidate states exercised by existing accessibility tests. Profile/scoring controls also need manual contextual-label review: repeated 1–5 buttons are visually and programmatically weak without a named group and scale explanation. Breadcrumb controls measured about 20 px tall; this is a usability concern, not an automatic claim of a target-size conformance failure.

**Change:** scope theme selectors to buttons; audit semantic text colors against every supported surface without fading whole navigation groups; name rating groups and explain endpoints. Verify keyboard use and focus after screen transitions.

Evidence: [initial scan details](evidence/metrics.json), [dark overview](evidence/dark-overview.png). Code: `app.js:render` and theme click handler; `styles.css:.rail__group--later`, `.rail__hint`; `app.css:.pkgmx__fee`; `app.js:critRow`, `vPerson`.

### D08 · P2 · Home and overview repeat context instead of helping prioritize

Home repeats the workspace identity in a highlighted metric tile despite displaying it in the rail. New-search actions appear twice in the populated view. Archive controls are permanently visible next to daily work. Executive overview repeats the process already visible in the rail, reaching approximately 3,261 px tall in the sample. Package details precede activity far below the fold.

**Change:** center Home on active searches and work awaiting attention; use the existing intake/next-step/due-date data before inventing new metrics. Make overview a concise next action, outstanding work, candidates, and recent activity. Put the full process in expandable phase sections and package information in Search facts. Move archive to a labeled More menu.

Evidence: [populated Home](evidence/desktop-home-refreshed.png), [overview](evidence/desktop-overview.png). Code: `app.js:vHome`, `overviewInner`, `overviewTiles`, `phaseSpecs`, `packagePanel`.

### D09 · P2 · Form geometry and typography are inconsistent

The class named `.grid2` becomes four columns on desktop because `app.css` overrides it with auto-fit 240 px columns. Fields with helper text have lower baselines than adjacent fields without hints. Very small uppercase labels and monospace metadata occupy numerous navigation and card surfaces. `.rail__label` is emitted throughout the app but has no dedicated style, so phase labels appear larger and less controlled than intended.

**Change:** define explicit one-/two-column form layouts independent of dashboard grids; reserve stable label/help space or place help below controls; standardize ordinary labels at 13–14 px and body/input text around 15–16 px. Retain Newsreader for restrained headings and Public Sans for work content. Use monospace for identifiers and numerical data where it helps scanning.

Evidence: [New search](evidence/03-new-desktop.png), [roster](evidence/desktop-team.png). Code: `styles.css` token/type/form sections; `app.css:256–268`; `app.js:field`, `shell`.

### D10 · P2 · Profile and committee questionnaires become long, repetitive worksheets

Four groups of suggestion chips, criteria, weight controls, and repeated instructions form a continuous page. Twelve populated criteria produce a profile roughly 3,046 px high on desktop and 6,803 px on mobile, including navigation. Committee intake is better because Save and finish later exists, but lacks a concise section-level progress view.

**Change:** persistent section navigation, clear counts per category, collapsible suggestions, and named rating groups. Preserve drafted values and focus when adding/removing criteria. Show the criteria first; put AI notes and model options in a secondary preparation panel. For committee members, make the current questionnaire the primary destination.

Evidence: [populated profile](evidence/desktop-profile-populated.png), [committee intake](evidence/committee-intake.png). Code: `app.js:vProfile`, `critRow`, `intakeGroup`, `vIntakeAnswer`.

### D11 · P2 · Browser navigation does not represent the workspace

Internal pages are stored only in `state.view`; `go()` redraws the root, with no URL/history update or explicit heading focus. Boot always returns to Home. The current breadcrumb omits the active step, and the document title remains generic. This makes refresh, returning to a page, and keyboard orientation inconsistent with conventional browser behavior.

**Change:** add stable search/step URLs or hashes, restore the selected screen after refresh, handle Back/Forward, and provide a consistently placed visible Back button with a clear destination. Include the active step in breadcrumbs/title, and focus the heading on deliberate navigation. Preserve focus during local edits instead of moving it on every render. Back must protect unsaved changes and have an in-app fallback for direct links.

Evidence: source review of `app.js:go`, `crumbs`, `render`, `boot`; `public/index.html`.

### D12 · P2 · Public questionnaire is clear, but long-answer recovery is limited

The candidate screen has a readable single-column layout, visible required indicators, support contact, and a persistent receipt. Desktop/mobile questionnaire scans and the sampled receipt scan found no tagged violations. Submission and receipt reload both worked.

The page provides no visible question count, progress, or Save and finish later. Source inspection shows an unsaved-work warning but no saved draft mechanism. Help is only at the bottom, and nested header padding narrows the introduction on mobile.

**Change:** retain this screen's simplicity. Add question count and support access near the introduction, reduce mobile header whitespace, and design an explicit draft/resume capability with server-side persistence. Display whether answers are draft or submitted. This is additional product work, not a CSS-only fix.

Evidence: [candidate mobile](evidence/candidate-mobile.png), [receipt](evidence/candidate-receipt.png), [candidate/committee scan details](evidence/followup-metrics.json). Code: `app.js:vApply`, `applySupport`, submit handler, `beforeunload`; `app.css:.apply-shell`.

### D13 · P3 · Secondary surfaces need consistent treatment

Staff logs, history, archive, and package previews inherit the same large heading/bordered-panel pattern despite different tasks. The package samples intentionally vary by tier; that is useful for sales demonstrations, but a consistent shell should make the work recognizable across packages. History's empty screen and document missing-prerequisite notices need direct return paths to the relevant task.

**Change:** apply the shared form/table/empty-state patterns after the primary workflows stabilize. Keep package comparisons in the dedicated Packages view. Use task-specific verbs and show the shortest useful explanation beside the relevant action.

Evidence: [staff work](evidence/desktop-sourcing.png), [history](evidence/desktop-history.png), [Basic sample](evidence/package-basic.png), [Executive sample](evidence/package-executive.png).

## Additional user requirements

The user explicitly requested a **Back button** and **hover text** after the initial audit. Back expands D11 into a visible navigation requirement, not just browser-history support. Hover text adds concise explanations for unfamiliar controls and statuses, with equivalent keyboard-focus and touch access. Essential instructions must remain visible without hovering.

The [implementation plan](IMPLEMENTATION_PLAN.md#requested-additions-back-button-and-hover-text) specifies behavior, examples, implementation phases, and acceptance checks for both. These additions are requirements rather than new findings from the screenshot review.

## Design direction

Use a calm, practical search workspace: a compact shell, one clear current task, legible forms, and visible save/review status. Keep the existing palette and font assets. Reduce the number of large bordered sections and blue actions before adjusting decorative details. Give consultants a portfolio view, committee members a task list, and candidates a focused questionnaire.

The first implementation slice should combine D01, D03, D07, and the shared layout/action foundations for D02/D06. That gives an immediately usable shell and dependable navigation on which the rest of the redesign can build.
