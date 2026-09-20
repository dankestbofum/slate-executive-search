# Committee interface review

September 17, 2026, America/Phoenix. This is source inspection and isolated execution of the real rendering helpers; the separate browser report records browser execution.

## UI-01 — P2: Changing a label loses the evidence badge

`consensusFor` matches lowercased, trimmed labels exactly. `critSource` consults that lookup and otherwise labels everything except AI drafts as `Yours`, even when the saved criterion still has `from: 'committee'`. Changing `Financial management` to `Financial management.` changes a `3 of 3` / `Contested` badge to `Yours`. The backend's normalizer treats those labels as equivalent. The comment promising badge survival after renaming therefore does not describe the behavior.

Sources: [matching and badge](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/public/app.js:4448>); profile help text in the same file at line 4578.

Evidence: `UI-01` in [ui-evidence.json](ui-evidence.json). Reproduce with `node docs/audits/2026-09-17-committee-aggregate/ui-reproduction.js`.

Recommendation: store a stable source-group identifier plus an adoption snapshot. Separate provenance (where the criterion came from) from current support (what today's intake says). A label edit should not discard provenance or silently erase a disagreement marker.

## UI-02 — Design clarification: support badges are label matches, not provenance

A manually authored criterion matching an aggregate label receives the same support badge. That can be useful, but it is evidence of a wording match, not proof that the criterion was adopted. The distinction matters when the weight or explanatory note was edited independently. This is a design clarification rather than an independent defect.

## UI-03 — P3: Intake weight controls need item context

`intakeRow` generates repeated buttons with accessible names `1` through `5`, without item-specific `aria-label` or `aria-labelledby`. The surrounding `div` has a title but is not a named group. The later profile editor already uses a named group and labels like `Weight 3 of 5 for Financial management`.

Sources: `public/app.js:4233` versus `public/app.js:4465`. Evidence: `UI-03` in [ui-evidence.json](ui-evidence.json). This confirms markup, not a screen-reader usability failure or a comprehensive accessibility result. Use the profile editor's existing contextual naming pattern and test keyboard/screen-reader navigation.

## Copy inconsistency — P3

The facilitator introduction (`public/app.js:4369`) says responses become readable after closing. The notice at line 4407 correctly explains that staff already have the running tally. Existing API tests explicitly expect managers to see the tally while intake is open (`tests/bughunt.js:980`). Treat staff access as implemented behavior; make the privacy explanation consistent with it. This is distinct from exposing one member's draft to other members.

## Coverage gap

Existing committee API tests adopt while intake is open (`tests/bughunt.js:993`) but do not read another committee member's profile response before closing. The closed-window test asserts all three submitted responses are returned; it does not include a fourth unfinished draft. These missing cases are directly relevant to the privacy hypotheses investigated by the workflow agent.
