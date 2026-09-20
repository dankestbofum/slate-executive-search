# Committee aggregation diagnostic: calculation and adoption

Date: 2026-09-17. Scope: real `server/committee.js` and `server/integrity.js`, intake/adoption routes, profile prompt, and existing coverage. No application code was changed. No production, network, or paid AI calls were made. No AGENTS.md was present in the repository scan.

## Outcome

The basic tally is internally consistent for submissions passed through normal intake normalization. The significant weaknesses are preserving provenance through revisions and adoption, misleading completeness feedback, and conflicting AI instructions at the category cap. This is a ranked tally of mentions, not a vote approving every proposed item and not a semantic clustering engine.

Ten offline scenarios executed successfully. Here “successfully” means the reproduction assertions match actual behavior, including defects; it does not mean ten product acceptance tests passed. Run from repository root:

```powershell
node docs/audits/2026-09-17-committee-aggregate/aggregation-reproduce.cjs
```

Exact outputs are in [aggregation-evidence.json](aggregation-evidence.json). The reusable script is [aggregation-reproduce.cjs](aggregation-reproduce.cjs).

## Confirmed findings

### AGG-01 — High: withdrawn priorities survive a rebuild with obsolete support claims

Reproduction A05: two respondents name “Old priority”; adopt it. Both revise their submissions to “New priority”; rebuild using the existing profile. The new aggregate contains only New priority. The rebuilt profile contains both priorities, and Old priority still says “Named by 2 of 2 on the committee.” Its `from` remains `committee`.

Keeping existing handwritten criteria is documented behavior. The defect is treating previously adopted committee items exactly like handwritten additions, without identifying withdrawn evidence or dating the old support claim. The user cannot tell from the stored criterion whether its support describes the current intake.

Cause: `server/committee.js:266` preserves every unmatched existing criterion up to the cap and copies old note/source at lines 279–280. `server/index.js:1341` uses this merge on every rebuild. Fix direction: preserve provenance and the source revision; distinguish explicitly retained historical items from currently supported items and show the resulting changes before adoption.

### AGG-02 — Medium: changes to intake do not mark an adopted profile out of date

Reproduction A06 uses real `integrity.reconcile`: replacing submissions while leaving criteria unchanged increments the search revision but leaves `profileRevision` at 1, `staleArtifacts` empty, and history empty in the minimal fixture. There is no source revision/fingerprint attached by adoption (`server/index.js:1336`). Source-only changes do not trigger the profile comparison in `server/integrity.js:84`; roster changes only reset roster confirmation at line 115.

This is separate from AGG-01: even before rebuilding, the profile can look current although the input changed. The existing profile intentionally remains stable; the missing behavior is a visible source-change warning or review requirement. Profile edits themselves do correctly archive scoring evidence and stale downstream documents (`server/integrity.js:84`). Do not describe the entire integrity system as absent.

### AGG-03 — Medium: adoption reports missing categories that the resulting profile already fills

Reproduction A07 starts with three existing criteria in each category and one submitted skill. After merge, counts are skill=4, trait=3, chall=3, opp=3. Nevertheless `adoptionGaps` returns all four categories as short, because it examines aggregate counts alone (`server/committee.js:295`), not the merged result. The endpoint returns those gaps at `server/index.js:1344`; the UI tells the user “Still short ... fill those in” at `public/app.js:7533`.

The helper’s documented purpose is consensus-only coverage, which is valid. The route/UI use it to report final profile completeness, which is incorrect. Fix direction: calculate final-profile gaps separately and label input-coverage gaps explicitly.

### AGG-04 — Medium: disagreement is not preserved in the adopted criterion’s own evidence

Reproduction A04: two respondents rate Decisiveness 5 and 1 and give opposing reasons. The aggregate correctly marks it contested. Direct adoption stores weight 3 and “Named by 2 of 2 on the committee. Need fast decisions.” It does not retain the contested flag, range, second reason, voter references, or source revision. `critNote` takes only the first note (`server/committee.js:226`); `mergeIntoCriteria` records only rounded weight, a note, and `from` (`server/committee.js:256`). Note order follows stored submission iteration, not the strength or representativeness of the reason.

The manager’s current editable profile can still display a contested badge by looking the label up in the live aggregate (`public/app.js:4456`). Therefore this finding is about loss of durable adopted evidence, not universal disappearance of the live badge. AI drafting explicitly asks to mention disagreement, unlike direct adoption (`server/ai.js:833`). Fix direction: include disagreement and source references in the adopted record, and keep the display independent of mutable label matching.

### AGG-05 — Medium, edge case: inconsistent normalization can produce duplicate criterion IDs

Reproduction A08: submit the accepted labels Strong and Good in separate responses; provide an existing Strong criterion with id S1; rebuild. Aggregate keys are `skill:strong` and `skill:good` because `groupKey` falls back when normalized text is empty (`server/committee.js:61`). Merge matches existing criteria using bare `normLabel`, so both empty normalized labels match the existing Strong row (`server/committee.js:285`). Both resulting criteria receive S1.

These are vague labels, but normal intake accepts them; this is not a corrupt-store-only case. Duplicate IDs can make criterion-based scoring and references ambiguous. Direct adoption does not call `validateCriteria`, unlike manual criterion saves and AI profile writes (`server/index.js:1771`, `server/index.js:1971`). Fix direction: use one canonical identity function throughout and validate uniqueness on adoption. Optional input guidance can separately discourage vague labels.

### AGG-06 — Medium, prompt contract: retaining every contested item conflicts with the profile cap

Reproduction A09 supplies nine distinct skill priorities, each rated 5 and 1. All nine are contested. `packForPrompt` contains eight in its main skill list, but nine in its contested list (`server/committee.js:304`, `server/committee.js:319`). Direct adoption picks five. The AI instruction says to keep every contested item (`server/ai.js:833`), while the profile must hold at most five per kind (`server/desk.js:277`). The ninth contested item has no count, average, or reasons in the main list.

This proves contradictory input requirements; it does not prove a particular model response, because no AI calls were made. Fix direction: define whether contested items displace other top-five priorities or remain in a separate unresolved-issues list, then make prompt packing and validation agree.

## Verified behaviors and decisions to make explicit

| Area | Observed behavior | Assessment |
| --- | --- | --- |
| Baseline math (A01) | Three mentions among five completed respondents = 60%, average (5+4+3)/3=4. Draft excluded. Three mentions outrank two mentions even if the latter average 5. | Works as implemented. |
| Participant roles | Manager, consultant, committee each contribute one submission; removed roster members are excluded. | Intentional equal weighting, not committee-seat-only voting. `server/committee.js:36`, `server/committee.js:106`. |
| Duplicate input (A02) | Normalized duplicates within a response count once; first item’s weight/note survive. | Deterministic, but the UI should make the consolidation visible. `server/committee.js:65`. |
| Matching (A03) | Good governance/Governance merge; Budgeting/Financial management remain separate. Word order, plurals other than skill, and synonyms are not reconciled. | Lexical design limitation; “same idea” should not imply semantic understanding. `server/committee.js:50`. |
| Missing category answers | Every completed respondent is in every category’s denominator even if they supplied nothing for that category. | Measures share of all respondents who named it, not agreement among category respondents; no explicit abstention state. |
| Small turnout | One response yields `single`; two out of two yields `unanimous` even if many roster members are pending. | Correct for completed responses; pair with “submitted of asked” to avoid overstating coverage. `server/committee.js:116`. |
| Contested threshold | Range of at least 3 among two or more mentions is contested. 5 versus 3 is not. | Product choice; it is disagreement about importance among nominators, not everyone’s opinion of the item. |
| Cap and priority | Top five by mentions, then mean weight, then label; low-frequency priorities and existing manual criteria may fall outside the cap. | Intentional; preview exclusions before adoption. `server/committee.js:200`, `server/committee.js:253`. |
| Free-text fields (A10) | Must-have/deal-breaker/context appear in voices and AI input but do not affect direct adoption ranking or selection. | Product choice needing explicit explanation: these are not enforced constraints. `server/committee.js:211`, `server/committee.js:325`. |

## Existing coverage and limitations

`tests/bughunt.js:947` onward exercises roster/intake, normalization, visibility before/after close, contested detection, adoption counts, closed-window rejection, and roster removal. `tests/bughunt.js:1048` adds module assertions for draft exclusion, filler normalization, handwritten fill-ins, the cap, and blank-name rendering. These tests were inspected, not executed by this audit agent; the parent audit may separately run broader suites.

The ten reproduction scenarios add targeted evidence for first-duplicate behavior, source loss, source staleness, withdrawn items, false final-gap reporting, empty-normalization ID collisions, prompt-cap conflicts, and free-text handling. They call production helpers directly and do not exercise HTTP middleware or a browser. Normalized submissions are used throughout, so the findings do not rely on bypassing normal input cleanup.
