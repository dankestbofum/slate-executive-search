# Committee aggregate implementation plan

Prepared September 17, 2026, America/Phoenix. Based on the [committee aggregate diagnostic](DIAGNOSTIC.md).

**Status: implemented and verified locally on Node 22; not released. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).** This plan covers all 12 diagnostic findings. It recommends product behavior where the diagnostic identified a choice, rather than treating those choices as previously approved requirements.

**Delivery order: repair publication boundaries → preserve submitted answers and independent edits → preserve adoption evidence → make rebuilding reviewable → align AI and interface behavior → validate and release.** The privacy repair can ship independently after its acceptance checks pass; it should not wait for the later interface work.

## Recommended behavior

| Area | Recommended rule |
| --- | --- |
| Draft privacy | Only the author can read an unfinished draft through normal application views. Shared records exports exclude unfinished drafts, including after closing. Operational backups remain protected recovery records, not shared exports. |
| Staff visibility | Keep the existing workspace staff access to submitted input while intake is open, and explain it clearly. Staff do not receive another person's unfinished draft. |
| Publication | Require closed intake before adopting or saving a profile for committee use. Apply the rule to direct adoption, manual profile saves, and AI profile writes. A button change alone is insufficient. |
| Reopening | Keep the previously published profile visible as a dated snapshot. New input remains private under the normal collection rules. Block publishing profile changes until intake closes again; explain that reopening does not retract previously shared material. |
| Drafting after submission | Preserve the last submitted answer in the tally while the member saves draft edits. Only “Update my answers” replaces that submitted version. |
| Withdrawal | If offered, make it a separate, explicit action while intake is open. Explain the consequence, record the event, and mark adoption sources as changed. Saving a draft never means withdrawal. |
| Concurrent members | Different members can save independent answers without invalidating one another. Concurrent edits to the same member's response remain protected. |
| Adoption | Record a dated source snapshot. Editing a label or weight does not erase its origin or historical disagreement evidence. |
| Rebuilding | Preview changes before saving. Do not silently reinsert unsupported old committee items with old support claims. Retaining one is an explicit consultant decision. |
| Contested items | Rank using the current rules and keep the category cap. Put contested priorities outside the selected profile in a separate discussion list; do not require every contested item to fit into five slots. |
| Empty intake | Preserve the ability to proceed without input, but require an explicit manager decision and reason. Display “Completed without committee input,” rather than implying responses were collected. |
| Roster changes during intake | Invalidate roster confirmation. Ask the manager to reconfirm before closing/publishing; existing and newly eligible members may continue answering while the window is open. |

The tally itself remains unchanged: equal participation for eligible roster roles; completed respondents form the denominator; mention count precedes average weight; normalization stays lexical. This plan does not add semantic clustering, new role permissions, or mandatory quorum rules.

## Work packages and dependencies

| Package | Findings | Primary responsibility | Dependency |
| --- | --- | --- | --- |
| P1 — Publication boundaries | CA-01, CA-02, immediate CA-10 copy | Backend, with interface changes | None |
| P2 — Drafts and concurrent answers | CA-04, CA-12 | Backend and frontend together | P1 visibility rules |
| P3 — Adoption evidence and identity | CA-03, CA-05, CA-07, CA-08 | Backend data model and profile UI | P1; coordinate with P2 response model |
| P4 — Rebuild review and completeness | CA-03, CA-06 | Backend and frontend together | P3 |
| P5 — AI, clarity, and accessibility | CA-09, remaining CA-10, CA-11 | AI integration and frontend | P3–P4 for AI; copy/labels can proceed earlier |
| P6 — Migration and release validation | All findings | Implementer/reviewer | Relevant package tests pass |

Owner labels describe responsibilities, not assigned individuals. Each package should be a reviewable change with its own regression coverage. P2 and P3 share intake/adoption structures and must agree on the data contract before concurrent implementation.

## P1 — Enforce the publication boundary

Primary files: `server/db.js`, `server/export.js`, `server/index.js`, `public/app.js`. Add focused API coverage to the existing test runner.

- Centralize intake visibility in an explicit serializer used by search responses and exports. Return only permitted fields; do not spread the entire intake object and then hide selected properties. Closed intake may expose submitted answers to committee members, but only the author receives their own draft in their personal view.
- Filter unfinished drafts out of shared exports regardless of who requests the export. Keep raw persisted data intact for its author and existing recovery mechanisms.
- Require closed intake for all profile mutation/publication entry points. Cover direct adoption, manual profile saves, and AI generation/application. Reject a prohibited AI request before provider work; recheck status, authorization, and relevant revision immediately before applying a delayed result.
- Record which profile revision was published and when. Reopening preserves that profile as previously published; it does not expose subsequent draft or submitted revisions through derived fields.
- For existing open searches where publication cannot be established, suppress committee access to the unverified profile until manager review and closure/publication. Do not fabricate an earlier publication date from the current state. Apply the same visibility policy to profile-derived responses available to committee members, so hiding one page does not leave a second data path.
- Disable or explain unavailable profile actions in the interface. Keep the server authoritative. Do not introduce a separate editable provisional-profile subsystem in this repair.
- Clarify that submitted answers are visible to workspace staff during collection, and become visible to fellow committee members after closure. Draft wording must accurately describe the author's exclusive access.
- Make empty completion an explicit recorded manager action; require reconfirmation after a roster change before closing or publishing. Ensure step-completion labels reflect the exception.

**Acceptance:** an unfinished note/context never appears in another member's response or a shared export. Early adoption, manual saves, and AI profile writes cannot publish new input. Reopening leaves the dated published snapshot intact while new input remains private. Non-managers remain unable to close/adopt, and cross-workspace access stays denied. An AI operation started before reopening cannot apply afterward.

**Tests:** convert W08/W09 into privacy regression tests, add export assertions, test every profile write route, and test close/reopen while a mocked AI result is pending. Verify empty completion and roster reconfirmation through both API and UI. No paid calls are required.

## P2 — Separate draft edits from submitted answers

Primary files: `server/committee.js`, `server/db.js`, `server/index.js`, `public/app.js`, intake tests and browser coverage.

### Response contract

Introduce a versioned per-member response record, conceptually:

```text
intake.responses[userId]
  revision             version of this member's response record
  draft                private working answer, or null
  submitted            last committed answer with submitted/updated timestamps, or null
```

Finalize exact field names with the existing store migration conventions. Keep this distinction in every reader: aggregation and AI inputs use `submitted`; the author's editor may use `draft`; shared serializers never expose somebody else's `draft`. Preserve legitimate empty draft content rather than treating it as a withdrawal.

- Saving a draft changes only the working version. Submitting atomically replaces the committed answer and clears or aligns the saved draft. Display “Submitted; you have unpublished changes” when appropriate.
- Expose the member's own response revision. Require it on personal intake writes and compare it with the stored member record, not the entire search revision.
- Narrow any exception to the global `If-Match` mechanism to personal intake writes only. Keep workspace authorization, current membership, search lifecycle, and open-window checks. Search-wide manager mutations retain search revision protection.
- Continue advancing the overall search revision on writes for the rest of the app. A different member's response must not cause a false personal-response conflict.
- Recheck current eligibility and intake state at the final write, after any asynchronous authorization step. Never add a generic automatic retry that could overwrite a same-member edit or submit after closure.
- When a genuine conflict occurs, preserve every local field and offer an in-app recovery action. Explain the conflicting submitted/draft version; avoid requiring copy/retyping or refreshing the entire browser.
- If withdrawal is implemented, use its own action and activity event. Do not log draft contents or create a withdrawal event on ordinary draft saves.

**Acceptance:** A and B open the same search and both submit successfully. A's two tabs cannot silently overwrite each other. Saving A's revised draft leaves A's previous committed answer in the tally. Closed intake or removed membership rejects a later save without erasing local work. A reload restores a saved draft and correctly distinguishes it from the last submission.

**Tests:** turn W12 and the browser concurrent-submission scenario into positive acceptance tests. Add same-author two-tab conflicts, close-during-edit, member-removal-during-edit, and lost-response recovery. Exercise desktop and mobile controls.

## P3 — Preserve source identity and adopted evidence

Primary files: `server/committee.js`, `server/integrity.js`, `server/index.js`, `server/export.js`, `public/app.js`.

- Use one category-aware canonical grouping key, including the fallback for labels that normalize to empty text. Use it consistently in normalization, merging, and ID reuse. Reserve a reused criterion ID immediately so no second criterion can claim it.
- Validate the complete adopted criteria before persistence, including unique IDs, valid kinds, valid weights, and the per-category cap. Keep an incomplete first draft possible, but do not label it complete before each category meets the minimum.
- Store an adoption record with timestamp, adopting actor, source fingerprint/revision, participant and respondent counts, and the selected source groups. Its fingerprint must change for relevant committed answers, weights, notes, narratives, and roster changes, but not for private draft keystrokes or unrelated search facts.
- Give each adopted criterion a durable link to the adoption/group record. Keep criterion IDs stable when the consultant edits wording. Origin, historical support, current support, and consultant modifications are separate concepts.
- Snapshot support counts, weight average/range, contested state, and source references needed to explain adoption. Preserve source reasons under the same publication rules; do not make the first stored reason the apparent committee rationale.
- Show contested range and the existence of differing reasons in staff and member profile views. Avoid fabricating a synthesized agreement; a neutral disagreement note plus access to the published reasons is sufficient.
- Mark adopted profiles “Input changed since adoption” after relevant committed changes or roster changes. Do not automatically rewrite adopted criteria or candidate scores in response to new intake.
- Preserve existing integrity behavior when criteria actually change: prior scoring remains in history, current scoring resets where required, and downstream artifacts become stale. A metadata-only source annotation should not unnecessarily reset scoring.
- Make support badges read the durable source record rather than the editable label. A manual criterion that happens to match a label does not acquire false adoption provenance.

**Acceptance:** Strong and Good cannot produce duplicate `S1` IDs. Renaming or reweighting a committee criterion preserves its origin and adopted disagreement evidence. Changed submissions produce a source-change warning without altering the adopted profile. Old support is clearly dated. Export and history retain the same explanation shown in the app.

**Tests:** convert A04–A06, A08, and UI-01 into regressions. Include punctuation-only and substantial renames, contributor removal, note-only source changes, unchanged repeated adoption, and criteria changes after candidate scoring. Verify that draft-only saves do not make the published profile stale.

## P4 — Make rebuilding a reviewable decision

Primary files: `server/committee.js`, `server/index.js`, `public/app.js`.

- Calculate a proposed profile before saving. Show added, changed, removed, and retained items, with historical versus current support distinguished.
- Keep valid consultant-authored additions where capacity allows. Treat old committee-derived items that no longer have current support as removal proposals, not automatic filler.
- Let the manager explicitly retain a historical criterion as a consultant decision with a reason. Preserve its history, but remove any implication that old support describes current responses.
- Show all exclusions caused by the five-item cap. Keep unresolved/omitted contested nominations accessible in a discussion list. Do not silently crowd out manual additions.
- Bind confirmation to the source fingerprint and current profile revision used to build the preview. If either changes before confirmation, require a refreshed preview rather than applying stale selections.
- Calculate final profile gaps from the resulting criteria. Report committee-input coverage separately: “Only one opportunity was nominated” is different from “Your profile needs two more opportunities.”
- Make repeated adoption of the same selection idempotent with respect to criterion identity and substantive profile history.

**Acceptance:** replacing Old priority with New priority shows Old priority as a proposed removal. It can survive only as an explicit retained decision with accurate labeling. The 4/3/3/3 merged profile reports no completeness gaps. A concurrent intake/profile change prevents applying a stale preview. Cap exclusions are visible before confirmation.

**Tests:** A05/A07, W13–W15, five-item overflow, manual-item preservation, explicit historical retention, and changes between preview and apply.

## P5 — Align AI, language, and accessible controls

Primary files: `server/ai.js`, `server/committee.js`, profile validation in `server/desk.js`, `public/app.js`.

- Give AI drafting an explicit selected-profile list and a separate discussion list. Include the counts, averages, ranges, and relevant reasons for every item the model is asked to discuss. Apply a documented bounded packing policy; do not provide a dangling contested item without its supporting detail.
- Remove the requirement to put every contested item into the capped profile. Require disagreement to remain explicit for selected contested criteria; leave excluded ones in the discussion list.
- Carry adopted source identity through AI output using validated references. Reject invented or mismatched provenance instead of trusting model-authored IDs/support claims. Enforce the same publication and freshness checks as direct adoption.
- Show participation and support together: “2 of 3 people responded; both respondents named this.” Explain that absence from an answer is not a vote against an item, and that narratives are guidance rather than automatically enforced constraints.
- Use consistent privacy explanations at the form, management page, save/submit feedback, and help text. Explain that lexical matching can leave similar wording in separate groups.
- Give each intake weight group an accessible name identifying the priority and scale. Label individual controls with the value and item context, using the profile editor's existing pattern. Keep focus stable while adding/removing rows and adjusting weights.

**Acceptance:** nine contested skills produce a valid five-or-fewer selection plus a reviewable discussion list, with no contradictory model instructions. A wording edit cannot make model output lose source identity. Repeated numeric controls are distinguishable by their accessible names, and collection privacy is described consistently.

**Tests:** mocked AI input/output contract cases, invalid source references, cap enforcement, and source changes during generation. Reuse A09 as the motivating fixture. Run browser assertions for accessible names plus keyboard navigation and a focused screen-reader check; a zero-violation axe scan alone is insufficient. A paid-provider smoke test is optional supplemental validation, not a prerequisite for deterministic regression coverage.

## P6 — Migrate, verify, and release

### Existing data

- Take a verified recovery snapshot before the first schema-changing release. Test migration against synthetic copies representing active, closed, reopened, and archived searches.
- Convert a legacy `submitted: false` answer into a private draft. Convert a legacy `submitted: true` answer into the committed version. Preserve text, timestamps, roster identity, and existing criterion IDs. Do not fabricate earlier submitted versions that the old schema already overwrote.
- Initialize response revisions deterministically. Make migration safe to rerun and ensure older clients fail with a recoverable refresh message rather than overwriting the new response structure.
- Treat legacy adoption provenance as unverified unless a real stored historical record establishes it. Do not reconstruct old support from today's live aggregate and present it as historical evidence. Flag affected profiles for review without silently changing their scoring IDs.
- Preserve archived-search readability, recovery behavior, export permissions, and organization isolation. Document schema compatibility: rolling back code after new-format writes may require a compatible reader or an explicit recovery procedure. Do not silently drop new drafts/source records on rollback.

### Regression and release gates

| Gate | Required evidence |
| --- | --- |
| Privacy repair | Drafts excluded from peer responses and exports; all premature publication paths blocked; reopen/late-AI cases pass. |
| Response integrity | Different-member saves succeed; same-member conflicts are safe; submitted answers survive draft edits; local work survives failures. |
| Adoption integrity | Unique IDs, dated source evidence, stable provenance, source-change warnings, accurate gaps, reviewable exclusions, and scoring/history behavior pass. |
| Browser workflow | Manager plus two members complete draft → submit → revise → close → preview → adopt → reopen → rebuild on desktop and mobile emulation. |
| Migration | Legacy examples preserve data and IDs; unknown provenance is labeled; rerunning migration changes nothing; backup restoration is demonstrated. |
| Supported runtime | Run verification on the project's supported Node 24 runtime. The diagnostic's Node 22 results are evidence of current behavior, not release acceptance. |
| Release identity | Record the tested commit, configuration, schema version, and migration result. Hosted smoke checks use synthetic records and verify the actual deployed revision. |

Promote the diagnostic cases into maintained tests with the **corrected** expected behavior. Preserve the original audit scripts/evidence as historical reproductions; some intentionally assert current defects and must not become release gates unchanged. Wire new tests into `tests/run.js` and the existing browser configuration.

Run focused tests during each package. Once the integrated change is ready, run `npm run check`, `npm test`, and the applicable browser suite on Node 24. Repeat tests only for changed code or unresolved failures. Record results and limitations in a new `IMPLEMENTATION_STATUS.md` alongside this plan, distinguishing implemented, verified locally, verified in staging, and released.

The first release may contain P1 alone if all P1 privacy checks pass and it remains compatible with existing data. Follow with P2–P5 in the dependency order above. Release smoke checks should verify real authentication and two-member behavior; local fixture success alone does not establish hosted behavior.

**Completion:** all 12 findings have corrected behavior and passing acceptance evidence; migrations preserve existing records; desktop/mobile journeys complete without forced re-entry for independent submissions; and the deployed version, if released, is explicitly identified. A plan, passing diagnostic reproduction, or unpublished fix does not by itself satisfy that completion standard.
