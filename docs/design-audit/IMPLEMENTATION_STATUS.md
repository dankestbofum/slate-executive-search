# Implementation status

What was built against the [implementation plan](IMPLEMENTATION_PLAN.md), what the
numbers are now, and what is still open. Recorded 9 September 2026.

The plan's five core phases are implemented. The optional candidate saved-draft
extension is not, and three Phase 5 activities need people rather than code.

## Findings

| Finding | State |
|---|---|
| D01 · Navigation consumes the mobile workspace | Done |
| D02 · Package detail buries search creation | Done |
| D03 · Home can hide a newly created search | Done |
| D04 · Candidate tables conceal the decisions | Done |
| D05 · Document entry exposes a technical editing surface | Done |
| D06 · Save, advance, and completion actions compete | Done |
| D07 · Invalid theme markup; tinted labels fail contrast | Done |
| D08 · Home and overview repeat context | Done |
| D09 · Form geometry and typography are inconsistent | Done |
| D10 · Profile and committee questionnaires are long worksheets | Done |
| D11 · Browser navigation does not represent the workspace | Done |
| D12 · Public questionnaire long-answer recovery | Partly — count, progress and support access added; saved drafts are the optional extension and are not built |
| D13 · Secondary surfaces need consistent treatment | Done |
| Back button (user requirement) | Done |
| Hover text (user requirement) | Done |

## Measurements

Reproduce with `node docs/design-audit/measure.cjs`, which starts its own
server on a throwaway store, builds a populated fixture through the API, and
writes `evidence/after-measurements.json`. "Before" figures are the audit's.

| Measurement | Before | After |
|---|---|---|
| Page heading on a 390px workspace screen | ~1,476px | 237px |
| Page heading on a 768px workspace screen | ~1,445px | 206px |
| Client field on New search, 1440 × 1000 | 1,645px | 388px |
| New search form height, 1440 × 1000 | ~2,117px | 825px |
| New search form columns on desktop | 4 | 2 |
| Executive overview height, desktop | ~3,261px | 1,673px |
| Screening table width inside a 326px viewport | ~1,350px | stacked rows, no sideways scrolling |
| Sideways overflow at 320px on populated screens | not measured | 0px |
| `aria-pressed` on `<html>` after a theme change | present | absent |

Axe (WCAG 2.1 AA) reports no violations on Home, New search, overview,
screening, profile, Search facts and the initial survey, in both light and
dark, on the populated fixture.

One measurement note: controls animate their background over 120ms, so a scan
started in the same tick as a theme change reads a colour part-way between the
two palettes and reports contrast that never appears on screen. Both the
measurement script and the accessibility suite wait for that to settle.

## Verification

- `npm run check` — parses every source file.
- `npm test` — server suites, including the source-shape assertions in
  `tests/bughunt.js` that were updated to match the new structure.
- `npx playwright test` — desktop and emulated-mobile browser suites, including
  the new `tests/browser/workspace.spec.js` and `tests/browser/reflow.spec.js`.

The browser suites cover: a search created in the session appearing on Home
without a reload; heading position and reflow at 320px, 390px, 768px and
tablet width; the drawer closing on Escape and returning focus; theme changes
leaving no invalid ARIA; deep links surviving a reload; browser and on-page
Back, including cancelling with unsaved edits; a filtered list recovered by
Back; invitation actions in place of a raw URL column; twenty candidates;
writing a questionnaire with no AI and no JSON; unsaved scores surviving a
stage change; hover text on focus and its dismissal; deep links to steps a
package or a role excludes; what a committee member is shown; and the
questionnaire's question count and support access.

## Open

- **Candidate saved drafts.** The plan's optional extension. It needs a draft
  endpoint and a persistence and versioning design, and the plan asks for it as
  a separate change. Not started.
- **A real phone and tablet pass.** The mobile project is Chromium device
  emulation. It catches layout and target-size problems; it does not establish
  real iOS or Android behaviour.
- **Screen-reader review.** Automated scanning finds roughly a third of real
  accessibility problems. Nothing here establishes that the workspace is usable
  with a screen reader. Do not read the clean axe results as conformance.
- **Task-based sessions with a consultant and a committee member.** The plan
  asks for short reviews with real users and iteration on whatever confuses
  them. Those have not been run.
