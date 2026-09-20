# Committee intake browser diagnostic

Executed September 17, 2026 (America/Phoenix; evidence timestamps use UTC).

## Result and method

**Two audit walkthroughs passed:** desktop Chromium (10.8 seconds) and Pixel 7 Chromium emulation (14.7 seconds). Each walkthrough exercised a facilitator and two separate committee-member browser contexts against an isolated local server at port 4293. Search/workspace/member setup used authenticated fixture APIs; opening intake, entering answers, saving, submitting, closing, adopting, and editing the profile used actual browser controls. The final run completed with `2 passed (45.3s)` and exit code 0. These are diagnostic assertions, including assertions that the defects below reproduce, not a clean bill of health.

Reproduce from the repository root:

```powershell
npx.cmd playwright test --config docs/audits/2026-09-17-committee-aggregate/browser-playwright.config.js
```

The configuration creates throwaway storage and fixture-signed Clerk sessions, blocks service workers, and provides no model API key. No production records or paid model calls were used. Clerk's browser SDK/directory are fixtures; application HTTP routes and authorization execute locally.

## Executed process

| Step | Observed result in both projects |
| --- | --- |
| Confirm roster and open intake | Facilitator could confirm roster, specify prompt/due date, and open the window. |
| Enter four kinds of answer | Member entered skill, trait, challenge, opportunity, importance, notes, and a free-text must-have. |
| Save draft and reload | Draft persisted; submitted aggregate count remained zero. |
| Submit draft | Confirmation appeared; facilitator count became one and displayed item as `1 of 1`. Other member's consensus API field remained null. |
| Save after submitting | `Save and finish later` silently changed submitted count from one to zero, moving all three roster members into pending. No confirmation occurred. |
| Submit from another already-open session | HTTP 409 `STALE_SEARCH`; clicking Submit again also returned 409. Four typed rows remained on screen. No in-app Reload search control existed for the committee role. |
| Recover after 409 | Following the response's copy/reload/retry instruction required preserving/reentering answers; browser reload removed all four unsaved rows. Reentry then submitted successfully. |
| Calculate overlap/disagreement | `Strong financial management skills` (5) and `Financial management` (1) merged as `Financial management`, `2 of 2`, `avg 3.0`, `Contested`. Manager remained pending, so two of three roster members had answered. |
| Close and publish | Facilitator received the one-missing-member warning. Accepting closed intake; member then saw named voters, notes, averages, and contested state. |
| Build profile | Persisted profile adopted five total items across four categories. Financial management had weight 3, support `2 of 2`, and Contested badge; missing category counts remained visible. |
| Rename committee criterion | Renaming Financial management to Financial stewardship and clicking weight 4 rerendered its source as `Yours`, dropping the support and Contested badges. The edit was not saved. |

## Findings

1. **Saving after submission retracts the submission without an explicit withdrawal action.** A member returning to revise an answer can unintentionally remove it from the aggregate by selecting the familiar save-for-later control. The button's explanation describes draft privacy but does not explain withdrawal. Evidence: `observations.saveAfterSubmit` in both JSON files. Relevant implementation: `public/app.js:4309`, `public/app.js:7505`, `server/committee.js:91`.
2. **Independent committee answers contend on the search-wide revision.** The second member's work did not overwrite the first member, but ordinary multi-person intake required a manual copy/reload/reentry recovery. Exact response: “This search changed since you opened it. Your edits were not saved. Copy your edits, then reload the search and try again.” This is explicit stale-write protection, not silent loss. The member's unsaved rows survive the error itself; they do not survive a browser reload. No claim is made that previously saved drafts were lost. The in-app reload control is staff-only (`public/app.js:2528–2537`), and the test found zero such controls for this member. Evidence includes first and repeat 409 statuses and before/after row counts.
3. **Renaming drops visible committee provenance.** The browser marks a committee-derived criterion `Yours` after a routine wording edit and hides its contested status, despite the adopted original remaining on the persisted server record. Source matching uses the current exact label (`public/app.js:4448–4462`). Evidence: `observations.renamedSourceBadge` and renamed-profile images.

## Evidence

- [Desktop structured evidence](browser-desktop-chrome-evidence.json)
- [Mobile structured evidence](browser-mobile-chrome-evidence.json)
- [Browser walkthrough source](browser-walkthrough.spec.js)
- [Isolated runner configuration](browser-playwright.config.js)
- [Desktop running tally](browser-desktop-chrome-running-tally.png)
- [Desktop submission conflict](browser-desktop-chrome-submission-conflict.png)
- [Desktop adopted profile](browser-desktop-chrome-adopted-profile.png)
- [Desktop renamed profile](browser-desktop-chrome-renamed-profile.png)
- [Mobile closed member view](browser-mobile-chrome-closed-member.png)
- [Mobile submission conflict](browser-mobile-chrome-submission-conflict.png)

Each project also has saved-draft, running-tally, closed-member, adopted-profile, and renamed-profile full-page screenshots. Visually inspected the desktop adopted-profile and mobile closed-member images: content rendered with readable category grouping; mobile aggregate showed the named voters and contested explanation. Full-page captures retain the fixed action bar at its viewport position, so some profile rows are obscured in those captures; DOM assertions independently verified their badges and weight selection.

## Limits and harness notes

- The populated draft screen had zero axe violations and zero horizontal overflow in both projects. This limited automated check does not establish screen-reader usability or accessibility of every step.
- Mobile coverage is Pixel 7 Chromium emulation, not a physical device. No WebKit/Safari run was performed.
- This machine ran Node 22.18.0; the application warns that its supported floor and production runtime are Node 24. Results need eventual confirmation on the supported runtime.
- Initial harness attempts corrected fixture enrollment order (the offline directory initially assigned email as the member name) and a selector that assumed the longer wording would remain the merged label. Those setup/selector failures were not application findings. A separate intermediate failure exposed the real concurrent-submission 409, which the final diagnostic explicitly asserts and recovers from.
- Windows Playwright web-server teardown did not complete automatically. After each test run had finished, the specific audit server PID printed by that run was stopped; the final runner then exited successfully. No unrelated server was stopped. Prior failure traces/screenshots were cleared automatically by the final Playwright run; `browser-results` contains only the small final `.last-run.json`.
