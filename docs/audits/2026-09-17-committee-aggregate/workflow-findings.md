# Committee aggregate workflow diagnostic

Audit date: September 17, 2026 (America/Phoenix). UTC evidence timestamps fall on September 18.

## Method and boundaries

Ran 19 API scenarios through an isolated local instance of the actual server, using the repository's signed Clerk test identities and disposable OS-temporary data. Actors: account manager Abe, unassigned staff consultant Mike, committee members Alice and Bob. The sequence covers roster confirmation, opening, draft, submit, adoption, closing, reopening, withdrawal, revision, rebuild, and member removal/addition. No production data, real invitations, paid AI calls, application changes, or test-suite changes were made.

Reproduce from the repository root: `node docs/audits/2026-09-17-committee-aggregate/workflow-scenarios.cjs`. The script leaves a disposable OS-temporary store for troubleshooting, stops its server, and writes `workflow-evidence.json`. This is an observation harness, not a regression test that declares current defects acceptable. It does not exercise browser rendering, live Clerk delivery, cross-workspace isolation, or downstream scoring/artifact invalidation.

All findings below are **confirmed in isolated API execution**, with UI statements cross-checked in source. Severity is this auditor's assessment, not an established product severity policy.

## Findings

### WF-01 — High: Closing publishes unfinished private drafts

Alice saved an unfinished draft containing a criterion, private note and private context, without submitting. Bob submitted his own answer; the manager closed intake. Bob's search GET then returned Alice's complete object with `submitted: false`, including her note and context (W09). The aggregate correctly counted only Bob, but the raw response included both objects.

This contradicts the visible draft-save promise: “Nobody reads it until you submit.” It can expose abandoned, tentative or sensitive writing that a committee member never chose to share. The raw object is delivered to the browser even if the normal screen does not render it.

Evidence: W06, W09. Sources: `public/app.js:4310`, `public/app.js:4311`; `server/db.js:778`–`784` returns every stored submission after closure. The closed-search records export also includes all submissions (`server/export.js:244`–`251`; source inspection only, not executed in this harness).

Recommended acceptance criterion: closing must expose only completed submissions to other members and exclude unfinished drafts from shared exports. A draft's author must still be able to retrieve their own work. Verify an unfinished note and context never appear in another member's response.

### WF-02 — High: Early adoption bypasses the open-window privacy boundary

Before adoption, Alice received `consensus: null` and could not see Bob's submitted private note (W07). The manager adopted while intake was still open; the request succeeded with HTTP 200. Alice's next GET still had `consensus: null`, but now contained the profile criterion note `Named by 1 of 1 on the committee. SUBMITTED PRIVATE BOB NOTE` (W08). Thus the profile exposes the input content and response count before closure. Reopening a previously closed intake also leaves those adopted notes visible (W11).

Early adoption is an intentionally supported route, not a demonstrated privilege escalation: existing `tests/bughunt.js:993` exercises adoption before close. The defect is that the derivative profile does not preserve the privacy boundary promised for independent intake. The API evidence is enough to confirm disclosure; the root audit separately examines the committee profile UI.

Sources: `server/index.js:205`–`210` hides open consensus from committee; `server/index.js:1336`–`1344` allows adoption irrespective of window state; `server/committee.js:226`–`229` copies a contributor note and count; `server/db.js:748` begins by spreading the full search, including criteria, into the readable result.

Recommended acceptance criterion: choose a consistent publication rule. Either require closure before publishing an adopted profile to committee, or keep the working profile private until publication. Test both initial adoption and reopening; hiding only `consensus` is insufficient.

### WF-03 — Medium: “Save and finish later” silently withdraws an already submitted response

Bob submitted and then used the API operation emitted by the visible save-later control. His completed-response count changed from 1 to 0 (W12), his previous adopted criterion remained, and the search activity log was identical before and after. Draft writes do increment the search revision, so concurrency protection works (W06); the issue is the unannounced withdrawal and missing activity event.

Sources: `public/app.js:4309`–`4311` retains both Update and Save-later controls; `public/app.js:7508`–`7523` sets `submitted` solely from which button was clicked; `server/index.js:1320`–`1332` replaces the previous submission and logs only completed submissions.

Recommended acceptance criterion: editing a submitted response should preserve the last committed version until resubmission, or present withdrawal as an explicit action with a clear explanation. A withdrawal should record an activity event and trigger the same adoption-freshness review as any other aggregate change.

### WF-04 — Medium: Adopted profile becomes stale and rebuilding can preserve obsolete committee claims

After adoption, Bob replaced “Financial stewardship” with “Strategic planning.” The aggregate immediately reflected only the new answer, but the profile still showed the old criterion; no adoption-freshness marker appeared (W13). Rebuilding then produced **both** the new and old criteria, each marked `from: committee` and each carrying `Named by 1 of 1` (W14). Removing Bob reduced the actual submitted count to zero and removed his access, but both committee criteria and their historical support claims remained (W15).

Preserving an adopted profile for consultant judgment can be a legitimate product choice. The defect is the lack of a visible distinction between a current aggregate-derived statement and a preserved historical one, compounded by treating old committee criteria as fallback during rebuild. Users can read obsolete claims as current committee support.

Sources: `server/index.js:1336`–`1344` writes criteria without recording an adoption snapshot/fingerprint; `server/committee.js:266`–`280` fills behind new consensus with all existing criteria, including previous committee-origin entries; `server/index.js:1258`–`1259` removes a departed member's submission; `server/integrity.js:65` onward handles other integrity state but not aggregate/adoption freshness.

Recommended acceptance criterion: store the adoption source revision and flag changes to roster, submission, withdrawal or weighting. During rebuild, deliberately replace obsolete committee-derived entries or explicitly label retained historical criteria as consultant decisions. Test a rename, a withdrawal, a removed voter and a complete removal of an old priority.

### WF-05 — Medium: State guards permit completion without collection and inconsistent roster gating

A manager can close a never-opened, empty intake with an unconfirmed roster: HTTP 200, zero submissions, intake step `done` and `blocked: false` (W19). Adoption also succeeds after returning intake to `draft`, provided retained completed answers exist (W18). Adding a consultant while intake is open clears roster confirmation, but leaves intake open and lets the newly added consultant submit immediately (W17). Yet reopening after a roster change fails until reconfirmed (W16).

These observations do not establish that a specific quorum should be mandatory; that is a product decision. They do show inconsistent state prerequisites and a “done” signal that can mean no collection ever occurred.

Sources: `server/index.js:1285`–`1303` checks roster only on a request to open; `server/index.js:1306`–`1325` checks intake state but not roster confirmation; `server/index.js:1336` checks only a nonzero response count for adoption; `server/db.js:687`–`693` marks closed intake done; `server/integrity.js:115` clears roster confirmation after membership changes.

Recommended acceptance criterion: define allowed transitions and explicit exceptions. Closing empty/never-opened intake should either require a documented bypass or remain visibly incomplete. A roster change during intake should have one consistent reconfirmation policy. Adoption should enforce the intended lifecycle policy and clearly distinguish provisional collection from published input.

### WF-06 — Medium product-policy mismatch: all workspace staff see named input while collection is open

Mike was staff in the workspace but had no role on this search. He could not submit, close or adopt (HTTP 403), but his GET returned Bob's named weight, note and narrative while intake was open (W03, W07). This matches the current implementation's workspace-wide staff visibility and is **not classified as an authorization bypass**. It conflicts with the intake guidance “You will see who has responded, not what they said, until you close it” (`public/app.js:3104`) and the route comment `server/index.js:1280`–`1282`.

Sources: `server/index.js:205`–`211` allows every `db.isStaff(access)` caller to receive the live aggregate; `server/committee.js:154`–`161` includes named voters and notes; `server/committee.js:212`–`222` includes named narratives.

Recommended acceptance criterion: align the user-facing confidentiality promise with an explicit policy. If staff must facilitate live, say exactly which staff can see named input and when; if independence requires staff blindness too, enforce that in aggregate construction and visibility.

## Controls that worked

| Scenario | Observed result |
| --- | --- |
| Open before confirmed roster | HTTP 400 (W01). |
| Open after confirmation | HTTP 200 (W02). |
| Unassigned staff submit / close / adopt | HTTP 403 for all three (W03). |
| Committee close / adopt | HTTP 403 for both (W04). |
| Empty or narrative-only completed input | HTTP 400 (W05). |
| Adopt with no completed input | HTTP 400 (W05). |
| Save unfinished draft | Excluded from aggregate; revision advanced from 7 to 8 (W06). |
| Save using stale revision | HTTP 409 (W06). |
| Open-window committee read before adoption | Only own submission; null consensus; no other member's private note (W07). |
| Submit after closure | HTTP 400 (W10). |
| Remove member | Submission excluded, roster confirmation cleared, removed member reads HTTP 404 (W15). |
| Reopen after roster change without reconfirmation | HTTP 400 (W16). |

## Diagnostic conclusion

The central response and permission mechanisms behave predictably. The highest priority defects sit at publication boundaries: closure publishes unfinished drafts, and early adoption publishes still-private completed input through a second channel. Next address adopted-profile freshness and withdrawal behavior; they can leave an apparently committee-backed profile after the supporting answers have changed or disappeared. State transitions and confidentiality wording need an explicit product policy rather than an assumed quorum rule.
