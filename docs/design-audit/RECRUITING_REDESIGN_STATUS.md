# Recruiting redesign status

What was built against the [recruiting redesign plan](RECRUITING_REDESIGN_PLAN.md),
the measurements after, and what is still open. Recorded 10 September 2026.

The plan's six phases are implemented in code. The human checks in Phase 6 —
a real phone and tablet pass, a screen-reader review, and task sessions with a
consultant and a committee member — have not been run, and are listed as open
rather than reported as done.

## What shipped

| Phase | State |
|---|---|
| 1 · Visual system and navigation | Done |
| 2 · Overview and candidate pipeline | Done |
| 3 · Recruiting portfolio Home | Done |
| 4 · Candidate profiles and review | Done |
| 5 · The system across remaining surfaces | Done |
| 6 · Validation | Automated coverage done; human checks open |

### The visual system

Workspace type is Public Sans throughout, held as tokens (`--ws-title`,
`--ws-section`, `--ws-body`, `--ws-label`, `--ws-meta`) so no screen invents a
heading size. The serif face stays where it carries meaning: the Slate
wordmark, and the brochures, advertisements and packets Slate generates, whose
`.doc__*` and `.pack__*` rules were not touched. The page header is one
component — eyebrow, title, and the screen's dominant action on a line, with
the explanation under it.

### Navigation

A search navigates by destination rather than by step number. One mapping
(`DESTS`, `VIEW_DEST`, `DEST_HOME`) drives rail selection, the breadcrumb and
the document title, so those three can no longer disagree. The numbered
nineteen-step run kept every step and moved to its own Process checklist
screen, which also names what each blocked step is waiting on and links to it.
Search facts, History and recovery, and Reload search collapsed into a Search
settings group. Account and theme controls are a one-row chip in the rail
footer.

Interviews, Committee, Documents and Activity are new routes over work that
already existed. They add no capability and no data: each reads the same
server-decorated search the steps read, and every link is an existing route
behind the existing package and role checks. A destination with no authorised
content is not drawn, and its address lands on the search with an explanation.

### The pipeline

The four stages the product stores — applicant, semifinalist, finalist,
declined — are a row of counts that act as the way into the list. On the
overview a count opens the list filtered to it; on the list the same component
selects. Counts are calculated after the text and response filters and before
the selected stage, so moving between stages never changes the numbers. The
row leads with identity, then stage, then response, then a quiet Review;
invitation links moved into a labelled per-row menu and are still never table
data.

### Home

`GET /api/searches` now returns a `candidateCounts` summary — totals per stage
plus how many have answered — so Home draws the portfolio without opening every
file. The summary carries no names, organisations, emails or invitation tokens,
and `null` where the package leaves screening off the file, which is a
different statement from nobody having applied. The only date the portfolio has
is the committee intake deadline, and it is labelled "Committee intake due".
Nothing is described as overdue, because nothing here stores a hiring milestone
to compare against.

### Candidate review

The candidate screen has Review and Details sections as real tabs: one stop in
the tab order, arrows between them, each panel labelled by its own tab.
Switching is done against the live DOM rather than through a re-render, which
is what keeps unsaved scores, a half-written note and the caret exactly where
they were. Below 1000px a switch decides whether the evidence or the scorecard
is in front; both stay in the document either way. Details lists only values
stored on the candidate — no per-candidate event log was manufactured out of
unrelated search activity, because the activity records carry no candidate id.

## Measurements

Reproduce with `node docs/design-audit/redesign.cjs`, which starts its own
server on a throwaway store, builds a populated fixture through the API, and
writes `evidence/recruiting-redesign/`. "Before" is the previous
implementation, recorded in `evidence/after-measurements.json`.

| Measurement | Before | After |
|---|---|---|
| Executive overview height, 1440 × 1000 | 1,673px | 1,211px |
| Overview heading position, 390px | 237px | 208px |
| Home heading position, 390px | 175px | 129px |
| Candidate list height, 1440 × 1000 | 1,945px | 1,836px |
| Desktop rail width | 250px | 240px |
| Ordinary rows visible with the list header, 1440 × 1000 | not measured | 8 |
| Hiring summary inside the first viewport, 1280 × 720 | not measured | yes, at 499px |
| Sideways overflow at 320px, all 21 captured screens | not measured | 0px |

Axe (WCAG 2.1 AA) reports no violations across the twenty-one captured screens
in both light and dark. Three contrast defects were found and fixed during the
work: the count on a selected rail row, the initials in a roster chip, and the
fee on a package tab. One was a regression introduced by this change; the other
two were on surfaces the earlier audit had not scanned.

## Verification

- `npm run check` — 49 files parsed, 0 failed.
- `npm test` — 477 server checks, 0 failed, including new coverage in
  `tests/roles.js` that the portfolio summary carries real counts and no
  candidate detail, and never summarises a search the reader cannot open.
- `npx playwright test` — 83 passed, 9 skipped by project, across
  `workspace.spec.js`, `reflow.spec.js`, `journeys.spec.js`,
  `accessibility.spec.js`, `policy.spec.js` and the new `recruiting.spec.js`.

`recruiting.spec.js` covers: a stage count opening the list showing exactly
that stage; counts staying still while the stage changes and moving when the
text filter does; unsaved scores and an unsaved note surviving a section
switch; arrow-key movement between the candidate's sections; a destination with
nothing behind it being neither drawn nor reachable by address; every
destination reaching its work while the checklist keeps all nineteen steps; and
Home rendering the portfolio without one request per search.

Role and package boundaries were captured as evidence rather than asserted only
in tests. A committee member is shown Overview, Candidates, Committee and
Activity and nothing else; a direct link to a consultant's step lands on the
search. A Basic file offers no Interviews destination and a link to its
brochure lands on the search. Both are in
`evidence/recruiting-redesign/measurements.json` under `roles`, with
screenshots beside them.

## Open

- **A real phone and tablet pass.** The mobile project is Chromium device
  emulation. It catches layout and target-size problems; it does not establish
  real iOS or Android behaviour. Carried forward from the previous status.
- **Screen-reader review.** The tab lists, the row menus, the stage counts and
  the portfolio table are new interaction surfaces. Automated scanning finds
  roughly a third of real accessibility problems, and a clean axe run is not
  conformance.
- **Task sessions with a consultant and a committee member.** The plan asks for
  short sessions on five tasks: find the next action, locate a candidate,
  complete a review, locate a document, and return to prior work. Not run.
- **Document editors named in the Documents index.** The index shows the last
  recorded change against an artifact, matched on whole words in the activity
  the server already writes. Where no recorded action names an artifact, the
  editor is shown as absent. A stored `editedBy` on the artifact would be
  exact, but the plan asks for no persistent schema change in this scope.
- **Deferred product work, unchanged from the plan.** Candidate saved drafts,
  drag-and-drop pipeline boards, calendar integration, email automation, global
  candidate search, resume parsing, new hiring stages, custom analytics and a
  new file-upload system are all out of scope and not started.
