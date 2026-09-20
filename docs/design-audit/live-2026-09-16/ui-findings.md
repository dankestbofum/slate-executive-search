# Hosted UI audit — September 16, 2026

Target: https://slate-executive-search.onrender.com/

## Coverage and limits

The browser automation runtime initially reported `No browser is available`; its inventory returned `{"apps":[],"browsers":[]}`. After the user explicitly authorized Playwright, the audit used installed Chromium in a fresh anonymous context. It covered the landing page, sign-in dialog, and sign-up dialog at 1440 × 1000 and 390 × 844, with screenshots, axe WCAG 2/2.1 A/AA scans, network/console capture, and sign-in Escape/focus restoration.

No credentials were entered, no accounts or production records were created or changed, and no existing browser profile was accessed. Authenticated workspace layouts and an end-to-end hosted research attempt remain unverified. Opening sign-in/sign-up was tested; completing authentication was not.

Public JavaScript was successfully retrieved over HTTP (200) and saved as [deployed-app.js](deployed-app.js). Its SHA256 is identical to `public/app.js` in the working directory at the time of the audit:

`5474E4315C2F61A5BE5C70FF41065B7D66FFDBECA8B50D741EA57F2D9CBFAE02`

UI-01 and UI-02 therefore apply to the code served by the hosted site. They are source-derived and, where stated, verified in an isolated JavaScript harness; they are not observations of an authenticated live browser session. UI-03 and UI-04 were observed in the live anonymous browser.

## UI-01 — Research failures disappear when a search is reopened

**Severity: P2.** A user can return to a failed research operation without seeing its error, operation reference, or retry panel.

Reproduction scenario: start research, leave the tab before it finishes, let the operation fail or be interrupted, and reopen the search. `loadSearch()` calls `adoptResearchJob()`, but its terminal-state branch returns for failed/interrupted jobs without copying `job.failure` into `state.research.error`. It restores only reviewable findings. `researchFailurePanel()` depends on `state.research.error`, so the stored failure is invisible. The comment assumes the failure was already reported, which does not hold when the user left before completion.

Evidence: `public/app.js:1093–1100`, `2029–2039`, and `4909–4930`; matching lines in deployed-app.js. An isolated VM invocation of the actual `adoptResearchJob` function with a stored failed job containing `RESEARCH_TIMEOUT` left both `state.research.error` and `state.research.review` null.

Suggested correction: restore an unacknowledged failed/interrupted job's failure and operation reference on search load. Treat dismissal separately from whether the operation is terminal. Cover failure while the tab is closed as well as page reload after failure.

## UI-02 — Research availability differs between Search facts and Community

**Severity: P2.** The same task is offered as available on one screen while disabled with an explanation on another.

Search facts always renders an enabled research button (`public/app.js:3450`). Community enables it only when the candidate profile is adopted and the health response says an AI key is present, with visible explanations for either prerequisite (`4999–5007`). The shared click handler checks the profile only after the Search facts button has been clicked, gives a short toast, and navigates to Candidate profile (`7154–7160`). For a missing key it can proceed to a predictably failing API request.

Reproduction scenario: open Search facts before adopting the profile and compare its enabled Research action with Community's disabled action and explanation. This is confirmed in deployed source, not an authenticated browser reproduction. The missing-key branch is conditional; this audit does not assert that production lacks a key.

Suggested correction: apply one shared availability decision and visible explanation to both entry points. When a prerequisite is missing, present a direct action to complete it.

## UI-03 — Hosted sign-in exposes development configuration and generic branding

**Severity: P2.** The actual hosted sign-in modal says **“Sign in to My Application”** and its footer says **“Development mode.”** Sign-up also shows Development mode. The browser console independently warns that Clerk was loaded with development keys and that development instances have strict usage limits.

Evidence: [sign-in desktop](signin-desktop.png), [sign-in mobile](signin-mobile.png), [sign-up mobile](signup-mobile.png), and [captured browser results](anonymous-browser-results.json). Reproduction: open the hosted root page, click Sign in; no authentication is required to observe it.

The generic name makes the authentication boundary look unfinished, and the deployed site is visibly using a development authentication instance. This does **not** establish that Clerk caused the research timeout. Correct the Clerk application display name and plan the appropriate production-instance configuration before launch; do not blindly swap keys without carrying over the intended workspace/access setup.

## UI-04 — Development badge fails contrast in authentication dialogs

**Severity: P3.** Axe reports a color-contrast violation in both sign-in and sign-up at desktop and mobile sizes, targeting Clerk's development-mode decoration (`.cl-internal-560t1i`): **3.04:1**, compared with **4.5:1** required for its 12 px text. This issue is in the development indicator, not the app's main content. Replacing the development authentication configuration may remove that indicator; rerun the scan afterward.

## What passed in the anonymous browser

- Landing, sign-in, and sign-up fit both tested viewports without document-level horizontal overflow.
- The landing page had no violations in the targeted automated accessibility scan. Auth dialogs had the contrast issue above; no other violations were reported in that scan.
- Escape closed sign-in and returned focus to the original Sign in button.
- No JavaScript page exceptions or failed network requests occurred. The only HTTP error captured was `/api/me` returning **401**, which is expected for a fresh anonymous visitor and is not a defect or evidence that the research API is broken.
- These are automated browser checks, not complete screen-reader or real-device accessibility certification.

Reproduction script: [audit-anonymous.cjs](audit-anonymous.cjs). Full measurements and console/network results: [anonymous-browser-results.json](anonymous-browser-results.json).

## Still requiring an authenticated browser session

- Reproduce one bounded research attempt using the user's existing authorized workspace and capture the persistent error/reference.
- Confirm cancel, refresh/reconnect, and retry behavior on the hosted deployment.
- Inspect desktop and mobile layouts, focus order, error placement, and navigation in the authenticated workspace. No existing authorized session was available in the isolated audit context.
- Do not treat September 9 historical audit screenshots as current deployed evidence; the application has changed since that audit.
