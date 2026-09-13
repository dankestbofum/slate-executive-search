# Test evidence

What has actually been verified, by what, and what has not. Written so that a
green build is not mistaken for a broader claim than it supports.

Last updated: 2026-09-12.

---

## What runs

| Suite | Command | Count | Runs in CI |
|---|---|---|---|
| Syntax | `npm run check` | 56 files parsed | yes |
| Isolated server suite | `npm test` | **482 checks** | yes |
| Browser, accessibility, policy | `npm run test:browser` | **162 checks** (54 each: Chromium desktop, WebKit desktop, mobile Chromium emulation) | yes |
| Container build and boot | CI only | 12 steps | yes |

The server suite runs against temporary data directories with an empty
`ANTHROPIC_API_KEY`. The browser suite starts its own server the same way.
**No paid model call is made by any automated test.**

### Server suite breakdown

| File | Checks | Covers |
|---|---|---|
| `bughunt.js` | 245 | Baseline API behaviour |
| `jurisdictions.js` | 30 | County setup, discovery, fact verification (DEP-07) |
| `security.js` | 28 | Headers, CSRF, bounds, SSRF, log redaction (DEP-03) |
| `roles.js` | 26 | Permission matrix, identity, withdrawal of access (DEP-02) |
| `candidates.js` | 20 | Receipts, drafts, documents, communications (DEP-08) |
| `disposition.js` | 19 | Outcomes, closeout, reopening (DEP-09) |
| `storage.js` | 17 | Media commit, schema, single writer (DEP-04) |
| `export.js` | 17 | Records export and attribution (DEP-10) |
| `monitoring.js` | 14 | Health, metrics, alerts (DEP-06) |
| `recovery.js` | 11 | Snapshots, off-volume copies, restore drill (DEP-05) |
| `integrity.js` | 37 | Regression checks for previously fixed defects |

## What the browser coverage found

Browser testing was added in DEP-12. It immediately found four defects that
server-side testing could not have found, three of them shipped by earlier
tickets in this same programme:

1. **The Content-Security-Policy blocked the application's own styling.**
   DEP-03 shipped `style-src 'self'` and verified it by asserting on the
   header. A real browser refused all 37 inline `style` attributes in
   `public/app.js`. The header was correct and the page was quietly broken.
   Fixed by extracting 34 static styles to utility classes and setting the
   three runtime values through the CSSOM, which CSP does not intercept. The
   policy stayed strict.

2. **The candidate support contact was never rendered.** DEP-06 added it to the
   API payload and nothing displayed it, so a candidate needing an
   accommodation still had nowhere to go. The same was true of the submission
   receipt and the deadline explanation from DEP-08.

3. **Questionnaire fields had no accessible names** (`label`, *critical*). A
   screen-reader user could not tell which question a text box belonged to, on
   the one page used by members of the public. Fixed with
   `aria-labelledby` tying each field to its prompt.

4. **Colour contrast below AA** (`color-contrast`, *serious*) and a
   **keyboard-inaccessible scrollable table** (`scrollable-region-focusable`,
   *serious*, mobile widths only). The `--ink-3` token was 3.63:1 against the
   page background where 4.5:1 is required; darkened to 4.53:1 keeping the same
   hue. Scrollable tables are now focusable.

This is the argument for browser testing in one list: every one of these looked
correct from the server.

### What adding a second engine found

WebKit was added on 12 September 2026, and adding it found something on the
first run that Chromium had never shown: **the suite was leaving the machine.**

Playwright does not intercept requests made by a service worker under WebKit.
Slate registers one, so the first page load used the stubbed Clerk SDK as
intended, and every load after that fetched Clerk's real SDK from Clerk's real
CDN — `fixture.clerk.accounts.dev` is inside Clerk's own wildcard domain, so the
request resolved. The page then failed to initialise against an instance that
does not exist, which is how it was noticed. Nine tests failed for this one
reason.

The claim in `docs/handoff.md` §3 — that nothing in any automated suite calls an
external service — was true of Chromium and would have been false of WebKit the
moment it was switched on. Service workers are now blocked in that project
(`playwright.config.js` records why), which keeps it offline at the cost of
covering PWA and offline behaviour in Chromium only.

After that, WebKit found no Slate defect: the remaining two failures were axe
scanning Clerk's account button, which under test is the fixture's bare
`<button>` and which WebKit paints in its default grey. That node is now
excluded from the scan, and Clerk's own components remain unverified by anything
here.

### What the record-keeping screens are covered by

`tests/browser/recordkeeping.spec.js` (6 checks per project) covers the three
screens that had no interface before 12 September: that a not-selected outcome
is refused without job-related evidence and that the refusal reaches the screen;
that a correction keeps the decision it supersedes; that a non-https document
link is refused and reference material is marked restricted; that a dated
follow-up reaches the candidate list; that closing a search freezes it on every
screen, revokes links, and that reopening restores none of them; and that a
committee member is offered none of it.

## Accessibility

Automated scanning with axe-core against WCAG 2.1 AA tags, on the landing page,
the sign-in form, the candidate questionnaire, the populated candidate list,
profile and new-search screens, and the record-keeping screens — county fact
verification, closeout, and the candidate Details and Outcome sections — each in
light and dark theme, across desktop Chromium, desktop WebKit and mobile
emulation. **Zero violations at the time of writing**, with Clerk's account
button excluded as described above.

Also checked: reflow without horizontal scrolling at a narrow viewport, a
document language, an `h1`, a visible focus indicator, and a 24×24 minimum
touch target on the candidate page.

**What this does not establish.** Automated tools find roughly a third of real
accessibility problems. Nothing here shows the application is usable with a
screen reader, and no person has tried. The following remain **untested**:

- Screen-reader flow (NVDA, JAWS, VoiceOver)
- Modal focus trapping and focus restoration after a dialog closes
- Live-region announcements for status changes and errors
- Real device behaviour on iPhone Safari and Android Chrome
- Print and PDF output

## Coverage gaps, stated plainly

| Gap | Consequence | Ticket |
|---|---|---|
| **Desktop WebKit, not Safari on a device** | The engine iOS runs is now covered; the device is not. Touch, on-screen keyboards, viewport quirks and iOS-specific input behaviour remain unknown. | DEP-12 |
| **PWA and offline behaviour in Chromium only** | Service workers are blocked in the WebKit project to keep it offline. Whether the worker behaves on WebKit is untested. | DEP-12 |
| **Emulated mobile, not a real device** | Catches layout and target size; does not establish real iOS or Android browser behaviour. The plan requires at least one real phone rehearsal. | DEP-12 |
| **Clerk's own components unverified** | The sign-in modal and account button are excluded from the accessibility scan and are not covered by any test here. | DEP-12 |
| **No screen-reader testing** | The priority accessibility claim is unverified. | DEP-12 |
| **No print/PDF verification** | Brochures, panel materials and long answers have not been printed and looked at. A browser-printed PDF is also not an accessible tagged document. | DEP-12 |
| **No load testing** | The pilot envelope (100 candidates, 20 concurrent sessions, p95 under 1s) is unmeasured. Whether the JSON store is adequate is an open question. | DEP-04 |
| **No real AI calls** | Model IDs, tool compatibility, latency and cost are configuration, not evidence. | DEP-11 |
| **No manual restore drill** | The mechanism is tested on synthetic data in milliseconds. That is not evidence an operator can recover under pressure. | DEP-05 |
| **No manual print inspection** | Print rules are asserted under emulated print media; no one has looked at a printed brochure or a long answer on paper. | DEP-12 |
| **Graceful shutdown unverifiable locally** | Windows emulates SIGTERM as unconditional termination. Checked in CI via `docker stop`. | DEP-04 |

## How to reproduce

```bash
npm ci
npm run check          # parse every first-party file
npm test               # isolated server suite, no network, no model calls
npx playwright install chromium webkit
npm run test:browser   # starts its own server on a throwaway data directory
```

Browser failures write a trace and screenshot to `test-results/`; open one with
`npx playwright show-trace <path>`.
