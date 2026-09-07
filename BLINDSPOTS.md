# Slate app review

Implementation update: the confirmed privacy, score-rendering, revision, concurrent
write, questionnaire validation, approval, completion, and test-exit defects have
been addressed. The app now provides archive/restore, history recovery, hashed
credentials, stronger new committee PINs, link replacement, honest questionnaire
opening labels, and verified local backups. See README.md for migration and restore
instructions. Legacy candidate links are replaced once on upgrade. Named accounts
are still recommended for accountable sign-off; shared access remains supported.
External notification delivery, resume intake, hiring/withdrawal journeys, recurring
evaluations, off-volume backup configuration, and browser/mobile QA remain separate
product or deployment work. The findings below preserve the original audit evidence.

Reviewed September 6, 2026 against the current working tree, including uncommitted changes. Application code and existing search data were not changed. Findings below come from source inspection and isolated API probes with synthetic users and candidates.

**Assessment:** The guided process is useful, but candidate privacy, score integrity, concurrent editing, and recovery need work before relying on the app for live searches.

**Validation:** The existing suite reported **241 passed, 3 failed**, with exit code **0**. Two failures were research URL tests receiving a missing-key error before URL validation; the third was the external example.com fetch. These failures do not establish an SSRF bypass. Separate probes reproduced the defects described below. AI overwrite behavior was tested using a delayed local model stub; no paid model calls were made. Browser control was unavailable, so visual layout, keyboard navigation, mobile use, and actual browser script execution remain unverified.

## Fix first

1. **High: Committee members receive candidate submission credentials.**

   `decorate()` copies the complete search into the response and only removes selected fields. Candidate objects retain their `invite` tokens even though the UI hides applicant links from committee members. Those tokens authorize unauthenticated questionnaire submissions.

   **Reproduced:** A committee account read a candidate token from the search API. Submitting with that token returned 200; the candidate's subsequent submission returned 409. A committee member can impersonate a candidate and consume their submission opportunity.

   **Fix:** Build explicit response shapes for each role, omitting candidate bearer tokens from committee responses. Support invitation revocation and rotation. Assess whether issued tokens need replacement after fixing the exposure.

   Evidence: [server/db.js](server/db.js#L392), [server/index.js](server/index.js#L1091), [public/app.js](public/app.js#L2432).

2. **High: Scores accept arbitrary HTML and render it without escaping.**

   The score endpoint accepts an arbitrary object. Released panel scores concatenate its keys and values directly into HTML, which is inserted through `innerHTML`.

   **Reproduced:** A committee member saved a nonnumeric HTML score with a 200 response. Running the candidate-page renderer with the resulting data preserved the markup as raw HTML. This establishes stored HTML injection; event-handler payloads could execute with the viewing consultant's browser privileges. No executable payload was run in a browser during this review.

   **Fix:** Accept only known criterion IDs and integer scores from 1 to 5. Escape both keys and values when rendering. Add a regression test across submission, release, and rendering.

   Evidence: [server/index.js](server/index.js#L1056), [public/app.js](public/app.js#L2552), [public/app.js](public/app.js#L2684).

3. **High: Profile revisions can silently change what an existing score means.**

   Scores reference mutable criterion IDs. Saving or generating a new profile does not invalidate scores, and adopting consensus regenerates sequential IDs based on the new order.

   **Reproduced:** After scoring `S1` for “Budget management” as 5, replacing `S1` with “Public engagement” left the 5 attached to the new criterion. Consensus reordering can create the same problem without an explicit ID edit.

   **Fix:** Use stable criterion identities and profile revisions. Keep scores attached to the exact evaluated revision; require deliberate reassessment when meaning changes. Version surveys and criterion references together.

   Evidence: [server/index.js](server/index.js#L619), [server/index.js](server/index.js#L765), [server/committee.js](server/committee.js#L239).

4. **High: An AI job can overwrite newer work.**

   Generation and research check whether the search still exists after awaiting a model response, but do not check whether its inputs or destination changed. Ordinary saves also have no revision check.

   **Reproduced:** Start a delayed survey generation, save a newer manual survey, then let generation finish. The older generated result replaces the manual edit.

   **Fix:** Capture input and artifact revisions when work starts. Reject conflicting writes or save the result as a separate draft for review. Apply the same optimistic concurrency check to ordinary multi-user editing.

   Evidence: [server/index.js](server/index.js#L752), [server/index.js](server/index.js#L797), [server/index.js](server/index.js#L640).

## Other confirmed defects

5. **Questionnaires lack server validation and historical question snapshots.** Required answers are enforced only by browser form attributes. An empty answer object is accepted and then cannot be corrected through the normal submission endpoint. Stored responses contain a timestamp and answers, while the review screen pairs them with the current questionnaire. Editing or redrafting questions can therefore change the apparent question an old answer addressed.

   **Fix:** Validate answers against a published survey revision; store that revision with every response. Add an explicit correction/reopen workflow. Decide whether displayed deadlines are advisory or enforced; currently they are text and are not enforced.

   Evidence: [server/index.js](server/index.js#L1070), [server/index.js](server/index.js#L1091), [public/app.js](public/app.js#L2420).

6. **Approvals do not become stale when their source facts change.** Editing an artifact clears that artifact's approval, but changing salary, the profile, or community research does not invalidate dependent recruiting copy.

   **Reproduced:** Approve an advertisement, change the search salary, and the advertisement remains approved with its previous salary.

   **Fix:** Record the source revisions used by each artifact. Mark dependent copy as needing review when those revisions change, and show what changed.

   Evidence: [server/index.js](server/index.js#L591), [server/index.js](server/index.js#L636), [server/index.js](server/index.js#L656).

7. **Staff and roster completion stamps can describe outdated records.** Reference entries without a candidate ID bypass the candidate-consent check. Deleting a completed step's last log entry does not reopen it. Editing notes can similarly leave completion intact. Removing a member leaves the roster confirmed, although adding a member clears confirmation.

   **Reproduced:** A reference log without candidate or consent returned 200. After completing the step and deleting its only log, the empty record still had `doneAt`. A confirmed roster also stayed confirmed after a member was removed.

   **Fix:** Require a candidate for actual reference contacts, distinguish general administrative notes, and invalidate completion when the signed record changes. Apply roster confirmation rules consistently.

   Evidence: [server/index.js](server/index.js#L440), [server/index.js](server/index.js#L931), [server/index.js](server/index.js#L972).

8. **The test command can pass despite failures.** The suite logs failed checks without setting a failing exit code. The unreachable-server path also returns normally. Several UI checks only search source text for function names or labels, so they do not prove that the flows work.

   **Reproduced:** The 241-pass/3-failure run exited 0.

   **Fix:** Exit nonzero whenever any check fails or the server is unavailable. Give the test runner its own temporary store and server. Add behavioral coverage for the permission, rendering, and revision issues above; separate external-network checks from deterministic checks.

   Evidence: [tests/bughunt.js](tests/bughunt.js#L80), [tests/bughunt.js](tests/bughunt.js#L1204), [tests/bughunt.js](tests/bughunt.js#L1322).

## Operational and product blind spots

9. **“Send survey” does not deliver a message.** The handler sets `survey2SentAt` and exposes survey two on the existing candidate link. The UI then reports “Survey sent,” but there is no email delivery, bounce status, or reminder mechanism. This could leave staff believing a candidate was notified.

   **Action:** Either label the action “Open questionnaire” and provide a clear manual notification step, or implement delivery with separate opened, sent, and delivered states. Evidence: [server/index.js](server/index.js#L891), [public/app.js](public/app.js#L3271).

10. **Account security and accountability rely on short shared secrets.** Committee PINs have 9,000 possibilities and are stored in plaintext alongside named and shared consultant credentials. The shared firm account also makes approvals and edits attributable only to “Slate Team.” Login throttling is per IP and held in memory.

    **Reproduced, conditional on deployment:** A blocked login returned 429, but changing `X-Forwarded-For` on the same direct connection returned 401 and bypassed that bucket. The app trusts one proxy hop unconditionally; exposure depends on whether the deployment prevents direct access and overwrites forwarded headers. Production routing was not inspected.

    **Action:** Use named accounts for attributable actions, stronger sign-in credentials or time-limited sign-in links, hashed secrets, account-aware throttling, and a proxy trust configuration matched to the deployment. Evidence: [server/db.js](server/db.js#L33), [server/db.js](server/db.js#L76), [server/index.js](server/index.js#L60).

11. **There is no app-level recovery or durable audit history.** Writes replace one JSON store; deleting a search immediately removes its record and media. Most activity history is capped at 40 entries. No backup/restore workflow, artifact history, or recoverable archive was found in the repository. Hosting-level backups may exist, but were not inspected.

    **Action:** Establish and test backup restoration, add a recoverable archive, preserve artifact revisions, and keep a durable record of meaningful decisions. The documented single-replica constraint matters: multiple app instances must not share this JSON store. Evidence: [server/db.js](server/db.js#L195), [server/db.js](server/db.js#L513), [server/index.js](server/index.js#L552), [README.md](README.md).

12. **The candidate journey still depends on work outside the app.** Staff must create each candidate before an application link exists. The screening instructions mention resumes, but the candidate flow has no resume or attachment intake. There is no normal UI journey for application corrections, withdrawal, hiring, or closing a search. “Annual evaluation” is a generated artifact rather than a recurring evaluation workflow.

    **Action:** Decide which of these the app owns and make external handoffs explicit. Prioritize candidate intake, document collection or links, correction/withdrawal, final disposition, and search closeout. Also test draft recovery: candidate answers and several editor forms live in the DOM and have no general navigation-loss protection.

    Evidence: [server/index.js](server/index.js#L847), [server/index.js](server/index.js#L871), [public/app.js](public/app.js#L548), [public/app.js](public/app.js#L2566).

Recommended order: close the two permission/rendering issues; protect scoring and questionnaire history; prevent conflicting writes; fix the test exit status; then address completion, notification, and recovery workflows.
