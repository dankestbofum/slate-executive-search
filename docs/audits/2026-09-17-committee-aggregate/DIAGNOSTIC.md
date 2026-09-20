# Committee aggregate diagnostic

September 17, 2026, America/Phoenix. Local source baseline: `9290200ca6c0d6904d5f704cc4b96040ea91fa29`. Evidence timestamps use UTC and fall on September 18.

[Implementation plan](IMPLEMENTATION_PLAN.md) — phased changes, recommended behavior, and acceptance tests for these findings.

**The core tally works, but the surrounding workflow has two confirmed privacy defects and several problems preserving the meaning of adopted criteria. Fix the privacy defects before relying on the current promise of independent, private intake.** The aggregate is useful as a facilitated shortlist; it is not an approval vote or an automatic determination of the committee's final requirements.

Three specialist agents reviewed calculation/adoption, role-based API journeys, and the browser workflow. The coordinating agent independently checked interface provenance and reconciled overlapping findings. This report covers local code and disposable local searches, not a signed-in production audit. Only audit artifacts were added; no application fixes or deployment changes were made.

## Process evaluated

1. Assemble and confirm a roster including the manager, consultants, and committee members.
2. Open intake; each member writes weighted priorities and optional narrative answers.
3. Save a draft, submit, revise, and compare the staff view with another member's view.
4. Close intake and inspect what becomes visible.
5. Build the profile, edit its wording, reopen intake, change answers or membership, and rebuild.
6. Check whether the resulting profile accurately represents its source and reports its remaining gaps.

The independent API walkthrough recorded 19 scenarios. The calculation agent executed 10 synthetic scenarios against production modules. The coordinator executed three isolated rendering-helper probes. These are diagnostic reproductions: an assertion that successfully reproduces a defect is not a product acceptance pass. Browser results are recorded separately below.

## Prioritized findings

P1 means address before using the privacy promise with a real committee. P2 means a material correctness or workflow issue. P3 means clarity or usability improvement. Confidence labels distinguish executed local evidence from source-only or prompt analysis.

| ID | Priority | Finding | Evidence |
| --- | --- | --- | --- |
| CA-01 | P1 | Closing intake discloses unfinished drafts to other committee members. | API W09 |
| CA-02 | P1 | Building the profile before closing exposes submitted private notes through the profile. | API W08, W11 |
| CA-03 | P2 | Revised or withdrawn input leaves stale support claims, including after rebuilding. | API W13–W15; module A05–A06 |
| CA-04 | P2 | “Save and finish later” after submission withdraws the response from the tally. | API W12; desktop/mobile browser |
| CA-05 | P2 | Adopted criteria omit durable disagreement evidence and select one person's reason. | Module A04 |
| CA-06 | P2 | Adoption can report incomplete categories even when the merged profile is complete. | Module A07; interface handler |
| CA-07 | P2 | Accepted labels can produce duplicate criterion IDs during adoption. | Module A08 |
| CA-08 | P2 | A small wording change drops committee provenance and contested badges. | Isolated UI-01; desktop/mobile browser |
| CA-09 | P2 | AI instructions to retain all contested items conflict with the five-item cap. | Module A09 and prompt inspection; no model call |
| CA-10 | P3 | Privacy explanations conflict about staff access while intake is open. | Interface source; API W07 |
| CA-11 | P3 | Intake weight buttons lack item-specific accessible names. | Isolated markup UI-03 |
| CA-12 | P2 | Another member's submission interrupts an independent answer with a search-wide revision conflict. | Desktop/mobile browser walkthrough |

### CA-01 — Unsubmitted drafts become accessible after closing

Alice saves a draft with an item, private note, and context but never submits. Bob submits his own answer. The manager closes intake. Bob's authenticated search response now contains Alice's entire `submitted: false` draft, although the tally correctly excludes it. The normal tally screen does not display this draft; the disclosure is in the data sent to another authorized committee member's browser.

The UI promises “Nobody reads it until you submit.” [Response serialization](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/server/db.js:778>) filters by current viewer while open but returns the whole submissions object after closing. Closed exports use the same whole-object pattern in [server/export.js](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/server/export.js:246>); that export consequence was inspected in source, not separately exercised over HTTP.

**Repair:** expose submitted responses according to the publication policy, plus the current member's own draft. Do not publish other people's drafts merely because the window closes. Verify both API and export serialization.

### CA-02 — Early adoption bypasses the intended publication boundary

With intake still open, Bob submits a priority with a private explanatory note. Alice cannot read Bob's raw answer and receives `consensus: null`. The manager builds the profile. Alice's next response includes a criterion containing Bob's note and “Named by 1 of 1 on the committee.” [The adoption endpoint](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/server/index.js:1336>) requires a manager and at least one submission, but does not require closed intake. The interface offers the action while intake is open. The [member profile view](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/public/app.js:4505>) renders criterion notes.

This is not anonymous or cross-workspace access: it is premature disclosure to another member of the same search. Reopening a previously published profile also cannot make that already-shared information private again; the workflow needs to explain what reopening means.

**Repair:** either require closure before publication, or introduce a staff-only draft profile with explicit publication. Cover direct adoption and other profile-generation paths. Updating only button visibility would leave the API path open.

### CA-03 — The adopted profile can misrepresent current support

Two respondents name Old priority and it is adopted with “Named by 2 of 2.” Both change to New priority. Before rebuilding, the old profile remains without a source-change warning. After rebuilding, the profile can contain both priorities, with Old priority still claiming 2-of-2 support. Removing a member also removes their input from the tally but does not annotate the old criterion's support claim.

Keeping an adopted profile stable is reasonable. The defect is the absence of a dated source snapshot or clear indication that its support describes earlier answers. [The merge](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/server/committee.js:266>) treats unmatched old committee criteria like handwritten additions and copies their old notes. [Integrity reconciliation](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/server/integrity.js:84>) tracks changes to criteria themselves but not changes to the intake from which they came.

**Repair:** record an adoption source revision and stable source IDs; show that source input has changed; preview additions, removals, and historical items retained before rebuilding. Preserve intentional consultant additions without presenting withdrawn nominations as current support.

### CA-04 — Saving a revision as a draft silently retracts the submitted answer

The same “Save and finish later” button remains available after submission. Its [handler](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/public/app.js:7508>) sends `submitted: false`, replacing the existing submission. The executed API scenario changed the submitted count from one to zero; already-adopted criteria remained. The interface does not describe this action as withdrawing an answer.

**Repair:** keep the last submitted version active while separately saving draft edits, or make withdrawal an explicit action with a clear explanation. The normal draft revision mechanism itself works: the API increased the search revision and rejected a stale write with 409.

### CA-05 — Disagreement is flattened in the adopted record

Two members rate Decisiveness 5 and 1 and supply opposing reasons. The tally correctly flags it as contested. Direct adoption stores weight 3 and the first stored reason, without the disagreement flag or rating range. It can therefore read as a shared moderate preference justified by one person's explanation.

[Criterion note creation](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/server/committee.js:226>) takes one note; adoption saves no durable disagreement metadata. The editable staff profile can still recover a live badge by exact label lookup. Thus disagreement is not erased everywhere, but the adopted criterion's evidence is incomplete and fragile. The member profile does not render those staff badges.

**Repair:** preserve the range, disagreement status, and links to source reasons. Present opposing reasons together or summarize their difference explicitly; do not turn the first available reason into the apparent committee rationale.

### CA-06 — “Still short” can contradict the completed profile

Starting with three existing criteria in every category, adopt one submitted skill. The merged profile has counts 4/3/3/3 and meets every category minimum. Nevertheless the endpoint returns all four categories as gaps and the interface says they are still short. [The helper](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/server/committee.js:295>) measures committee-input coverage; [the toast](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/public/app.js:7533>) uses it as final-profile completeness.

**Repair:** compute final gaps from the merged profile. Label limited committee coverage separately.

### CA-07 — Inconsistent label identity can duplicate IDs

“Strong” and “Good” are accepted labels. Both reduce to empty text under filler-word normalization. Grouping falls back to the original label and keeps them separate, but matching against an existing criterion does not use that fallback. With an existing Strong criterion `S1`, adopting both can assign `S1` to both resulting rows. This was reproduced using normally normalized submissions, not corrupt storage.

[Grouping](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/server/committee.js:60>) and [ID reuse](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/server/committee.js:285>) use different identities. Direct adoption also skips the criterion validation used for manual saves. Duplicate IDs create ambiguity for later references and scoring; this audit did not execute downstream scoring on the malformed profile.

**Repair:** use one canonical identity function throughout and validate the adopted profile before saving. Include this edge case in regression coverage.

### CA-08 — Renaming a criterion loses its visible provenance

Changing Financial management to Financial management. changes the displayed `3 of 3` / `Contested` badges to `Yours`, although the criterion still has `from: 'committee'`. The [interface lookup](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/public/app.js:4448>) uses exact label text after trimming/lowercasing, unlike the backend normalizer. If a manually written criterion matches that text, it receives the support badge regardless of its saved source.

**Repair:** distinguish origin, current support, and consultant edits. Track source identity independently of the editable label. See [ui-evidence.json](ui-evidence.json).

### CA-09 — The AI prompt has incompatible requirements at high disagreement

Nine contested skills produce eight detailed skill entries and nine contested entries in the model input. [The prompt](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/server/ai.js:833>) says to retain contested items, but the profile is limited to five per category. The ninth entry also lacks the detailed count/average/reasons supplied in the main list. This establishes a prompt-contract conflict, not an observed model failure; no paid model call was made.

**Repair:** decide how contested items outside the shortlist are handled, such as a separate discussion list, and align the prompt, packed data, and validation with that rule.

### CA-10 and CA-11 — Clarity and accessibility

The manager introduction says answers become readable after closing, while a later notice correctly says staff can already read the running tally. API W07 confirms even staff not on this search roster can read submitted names, weights, reasons, and narratives within their workspace. That follows the app's broader staff visibility model; it is not classified here as an authorization bypass. State that policy consistently so members understand the audience.

Intake weight buttons repeat the accessible names 1–5 without identifying which priority they control. The profile editor already has contextual labels that intake can reuse. This is a confirmed markup gap, not a completed screen-reader usability audit. See [ui-findings.md](ui-findings.md).

### CA-12 — Independent member submissions conflict with one another

Two members open intake. The first submits; the second writes a separate answer and submits from the already-open form. The second receives HTTP 409 because every intake write uses the revision of the entire search. The browser walkthrough reproduced this on desktop and mobile Chromium. All four unsaved rows remained on screen after the error. The message explicitly tells the member to copy their edits, reload, and try again; browser reload then loses those unsaved rows.

This is not a silent overwrite or unexplained deletion. The protective check works, but its scope creates avoidable friction during the ordinary independent-answer workflow. The in-app Reload search control that staff can use sits inside a `canEdit()` section, so committee members are not offered that recovery control. Sources: [shared revision header](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/public/app.js:1574>), [server precondition](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/server/index.js:425>), and [staff-only reload control](<C:/Users/abrah/OneDrive/Desktop/Interview Process App/public/app.js:2528>).

**Repair:** support safe recovery without retyping, or scope conflict detection to the member's own submission while still checking membership and whether intake remains open. Acceptance: two members can submit independent answers; a genuine same-member editing conflict remains protected; closing the window during editing still produces a clear refusal without losing the local draft.

## What works and what the numbers mean

| Behavior | Result |
| --- | --- |
| Draft exclusion | Unsubmitted drafts do not enter the tally or its denominator. |
| Support calculation | Three mentions among five submitted respondents means 60%; unsubmitted roster members are excluded. |
| Importance calculation | Weights 5, 4, 3 average to 4; people who did not name the item do not contribute zeroes. |
| Ranking | Mentions first, average importance second, alphabetical tie-break last. |
| Duplicate nominations | Normalized duplicates within one submitted answer count once; the first weight/note wins. |
| Access to management actions | Non-manager staff and committee members were refused closure/adoption; unassigned staff could not submit intake. |
| Window guards | Opening needs roster confirmation; closed intake rejects edits; empty and narrative-only submissions are rejected. |
| Concurrent writes | Saving a draft increments the revision; a stale revision is rejected. |
| Roster removal | Removed members lose search access and their answers leave the aggregate. |

Several choices deserve explicit product language rather than automatic treatment as bugs:

- All roster roles contribute equally. The manager and consultants count too.
- “Unanimous” refers to completed respondents, not every invited member. Show turnout alongside support.
- Not naming an item is not the same as voting against it. An omitted category still uses all completed respondents as its denominator.
- Matching is lexical. Budgeting and Financial management remain separate; the system does not decide that synonyms represent one idea.
- Must-have, deal-breaker, and context narratives appear for review and in AI input, but are not enforced constraints in direct adoption.
- Five items per category means some nominations and manual additions can be excluded. Preview these exclusions.
- Adding a member while intake is open clears roster confirmation but leaves intake open; the new member can submit. Decide whether that is the intended flexible workflow. Closing an unopened, empty intake is also accepted by the API; this should be an explicit skip decision if retained.

## Recommended repair order and acceptance checks

1. **Enforce publication boundaries.** A never-submitted draft remains invisible to every other member before and after close. An open-window member cannot obtain another member's private input through adopted criteria. Verify serialization, profile generation, and exports.
2. **Separate working edits from submitted and adopted versions.** Saving edits does not unexpectedly remove the last submitted response. Independent member answers do not force copy/reentry after another member submits. Reopening or changing membership signals that adoption sources changed; historical support is clearly dated.
3. **Make rebuilding reviewable and preserve source identity.** Preview changes, retain explicit consultant additions, resolve or label withdrawn criteria, preserve disagreement, and guarantee unique IDs.
4. **Correct the interface and AI contract.** Derive completeness from the resulting profile, keep provenance through renaming, clarify audience/turnout, give weight controls context, and define how excess contested priorities are handled.

## Evidence and reproduction

Both desktop Chromium and mobile Chromium emulation completed a nine-step walkthrough: open intake, save/reload a draft, submit, save after submission, recover from another member's stale-write conflict, submit the second answer, close, adopt, and rename. The browser verified 2-of-2 support among 2-of-3 roster respondents, mean weight 3 from ratings 5 and 1, the Contested flag, the missing-member closure warning, closed-window member read access, and profile adoption. It also confirmed the unannounced withdrawal, repeated 409 on retry, absence of a member reload control, and provenance badge change to Yours after renaming.

The inspected draft page had zero automated axe violations and zero horizontal overflow in both browser projects. Those limited checks do not establish accessibility of the whole workflow; numeric weight names still lack item context. Saved screenshots document the draft, running tally, submission conflict, closed member view, adopted profile, and renamed profile. See the [desktop evidence](browser-desktop-chrome-evidence.json), [mobile evidence](browser-mobile-chrome-evidence.json), and [browser report](browser-findings.md). Earlier harness setup/expectation failures were corrected; they are not reported as app failures.

- [Calculation report](aggregation-findings.md) and [10 scenario outputs](aggregation-evidence.json).
- [API workflow report](workflow-findings.md) and [19 scenario outputs](workflow-evidence.json).
- [Interface helper report](ui-findings.md) and [three probe outputs](ui-evidence.json).
- [Browser walkthrough report](browser-findings.md), including executed steps, screenshots, and any harness limitations.
- [Source hashes and runtime baseline](source-baseline.json).

From the repository root:

```powershell
node docs/audits/2026-09-17-committee-aggregate/aggregation-reproduce.cjs
node docs/audits/2026-09-17-committee-aggregate/workflow-scenarios.cjs
node docs/audits/2026-09-17-committee-aggregate/ui-reproduction.js
npx playwright test --config docs/audits/2026-09-17-committee-aggregate/browser-playwright.config.js
```

The API/browser scripts use fixture authentication and disposable local storage. The executed local Node runtime is 22.18.0; the project requires Node 24 or later, so repeat acceptance checks on the deployment runtime. Existing committee coverage in `tests/bughunt.js` was inspected: it adopts while open but does not test another member's profile before close, and its closed-window example contains submitted answers only. The full existing regression suite was not rerun. Real Clerk sign-in, deployed backend parity, paid AI behavior, and real-device/screen-reader operation are outside the verified scope.
