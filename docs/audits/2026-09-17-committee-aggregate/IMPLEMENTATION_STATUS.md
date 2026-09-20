# Committee aggregate implementation status

Prepared September 17, 2026, America/Phoenix. Tracks the [implementation plan](IMPLEMENTATION_PLAN.md) against the [diagnostic](DIAGNOSTIC.md).

**Status: implemented and verified locally. Not verified in staging, and not released.** All twelve findings have corrected behaviour and passing local acceptance evidence. The local runtime is Node 22.18.0; the plan's supported-runtime gate (Node 24) has not been met, so this is not a release acceptance pass.

## What each finding does now

| ID | Corrected behaviour | Where |
| --- | --- | --- |
| CA-01 | An explicit serializer returns named fields only. A draft goes to its author and nobody else, before or after closing, in the application and in every export. Who has answered is published; what they said is not. | `server/committee.js` (`visibleResponses`), `server/db.js` (`decorate`), `server/export.js` |
| CA-02 | One publication rule guards direct adoption, manual profile saves and AI profile writes. An AI request is refused before provider work and rechecked immediately before applying. A profile that cannot be established as published is withheld from committee members on both data paths. | `server/committee.js` (`publicationBlock`), `server/index.js` (`profilePublished`, adopt/profile/generate routes) |
| CA-03 | Adoption stores a dated record: actor, source fingerprint, participant and respondent counts, and the evidence behind each line. Changed input raises a source-change warning and changes nothing else. Rebuilding proposes removals; retaining an unsupported line is an explicit decision with a reason, labelled as historical support. | `server/committee.js` (`sourceFingerprint`, `adoptionPreview`), `server/index.js`, `public/app.js` |
| CA-04 | Draft and submitted are two fields on one response record. Saving a draft leaves the committed answer in the tally; only "Update my answers" replaces it. Withdrawal is its own action, its own event, and returns the answer to its author as a draft. | `server/committee.js`, `server/index.js` (`PUT /intake`, `POST /intake/withdraw`), `public/app.js` |
| CA-05 | The adoption record keeps every reason with its author and weight, plus the range and contested state. The criterion note states participation and disagreement and never one member's explanation. Staff and member profile views show the disagreement and the reasons. | `server/committee.js` (`groupSnapshot`, `critNote`), `public/app.js` (`critEvidence`) |
| CA-06 | `profileGaps` measures the finished profile; `coverageGaps` measures what the committee nominated. Both are returned, and the interface words them differently. | `server/committee.js`, `public/app.js` |
| CA-07 | One canonical key (`groupKey`/`critKey`) is used for grouping, merging and ID reuse, and an ID is reserved the moment it is handed out. Adopted criteria are validated before persistence, including weights and the per-category cap. | `server/committee.js`, `server/integrity.js` (`validateCriteria`) |
| CA-08 | Each adopted criterion carries a durable `source.key`. Badges read that record, not the editable label. Renaming preserves origin, ID and evidence; a hand-written criterion cannot acquire provenance by matching wording or by posting one. | `server/committee.js`, `server/index.js` (`PUT /profile`), `public/app.js` (`critOrigin`, `critSource`) |
| CA-09 | The prompt gets a selected list within the cap and a separate discussion list, each item with counts, averages, range and reasons. The contradictory "retain every contested item" instruction is gone. Model-authored provenance is validated against the tally by the desk and again by the server. | `server/ai.js`, `server/desk.js` (`checkSourceKeys`), `server/committee.js` (`packForPrompt`) |
| CA-10 | One privacy explanation on the form, the management page, the save feedback and the profile page: drafts are private to their author, submitted answers are readable by workspace staff while the window is open and by the committee after it closes. Turnout is stated as "of the people who answered", and lexical matching is explained. | `public/app.js` |
| CA-11 | Intake weight controls carry the priority and the scale in their accessible names, using the profile editor's existing pattern. Label, reason and remove controls are named too. | `public/app.js` (`intakeRow`) |
| CA-12 | A personal intake write is preconditioned on the member's own response revision, not the search's. Workspace, membership, window state and eligibility are still checked. A genuine same-member conflict returns both versions and is recovered in the page; members have a reload control. | `server/index.js` (`PERSONAL_INTAKE_PATH`, `PUT /intake`), `public/app.js` (`intakeConflictPanel`) |

## Beyond the findings

- **Empty completion** is an explicit, recorded manager decision with a reason, shown as "Completed without committee input".
- **Roster changes during the window** withdraw the roster confirmation, are recorded against the window, and must be reconfirmed before closing or publishing. Everyone on the roster keeps answering meanwhile.
- **Publication** is dated and names the profile revision it published. Reopening preserves that snapshot and blocks republishing until the window closes again.

## Migration

Schema 6 → 7 converts `intake.submissions` into `intake.responses`. A legacy record flagged `submitted: true` becomes the committed answer; an unflagged one becomes a private draft. Text, timestamps, roster identity and criterion IDs are preserved, response revisions start at 1, and the conversion is idempotent — it also runs as a boot-time backfill, so rerunning changes nothing. The version rung exists so an older build, which would write the pre-draft shape back over a new draft, refuses to open the store rather than corrupting it.

A profile adopted before adoption records existed is marked `adoptionProvenance: 'unverified'`: no historical support is reconstructed from today's tally, the profile is withheld from committee members, and staff clear the flag by reviewing and saving it.

**Rollback:** code written after a 7-format write cannot be rolled back onto this store without a compatible reader. The pre-migration snapshot in `DATA_DIR/backups/pre-migration-6-to-7-*` is the recovery path. New drafts and adoption records are not silently dropped; an older build is refused at boot.

## Verification

Run on Node 22.18.0, Windows 11, commit in progress on `research-reliability-fixes`.

| Gate | Evidence | Result |
| --- | --- | --- |
| Static check | `npm run check` | 83 files parsed, 0 failed |
| Full server suite | `npm test` | exit 0; 19 suites, all passing |
| Committee findings | `tests/committee.js` (new, wired into `tests/run.js`) | 28 checks passed |
| Privacy repair | Draft excluded from peer reads, staff reads and all three export viewers; every premature publication path refused; reopen and late-apply guards | in `tests/committee.js`, `tests/export.js` |
| Response integrity | Independent submissions both succeed; same-member two-tab conflict is refused and returns both versions; a draft save leaves the submission in the tally; a refused save damages nothing | in `tests/committee.js` |
| Adoption integrity | Unique IDs from labels that normalize to nothing; dated evidence with every reason; provenance survives renaming; source-change warning without rewriting the profile; profile gaps vs committee coverage; cap exclusions and the discussion list | in `tests/committee.js` |
| Browser workflow | `tests/browser/committee.spec.js` — draft → submit → save-after-submit → reload → independent second submission → close → preview → adopt → rename, plus accessible weight names and keyboard focus across a redraw | 12 passed (desktop Chrome, desktop Safari, mobile Chrome) |
| Browser regression | `npx playwright test` (whole suite, machine otherwise idle) | 240 passed, 0 failed, 24 skipped |
| Migration | Legacy `submissions` converted in place, timestamps and text preserved, an unsent draft never published as a submission, schema 7, pre-migration snapshot written | `tests/auth.js` |
| Supported runtime | Node 24 | **not met** — local runtime is 22.18.0 |
| Release identity | Deployment, hosted smoke checks | **not done** — nothing released |

## What is not claimed

- No staging or hosted verification; no real Clerk sign-in beyond the fixture the suites already use.
- No paid model call. The AI contract is covered by the deterministic input/output shape, the desk's source-key validation and the prompt's own text; how a real model behaves against the new prompt is untested.
- The late-AI guard is tested through `publicationBlock` and `sourceFingerprint` directly rather than over HTTP, because the isolated suite has no API key and must not buy a draft to test one.
- Accessibility: the intake weight controls now have distinguishable accessible names, and keyboard focus survives the redraw that rating or adding a row causes. Both are asserted in a real browser. That is a markup and focus fix with browser evidence, not a completed screen-reader audit of the workflow; no screen reader was run.
- No migration rehearsal against a copy of a production store; the migration evidence is the synthetic legacy fixture in `tests/auth.js`.

## Before release

1. Re-run `npm run check`, `npm test` and `npx playwright test` on Node 24.
2. Take a verified recovery snapshot, and rehearse the 6 → 7 migration against copies of active, closed, reopened and archived searches.
3. Record the tested commit, configuration, schema version and migration result here.
4. Smoke-check the deployed revision with synthetic records, including two members submitting independently under real authentication.
