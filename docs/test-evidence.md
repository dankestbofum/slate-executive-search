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
| Load measurement | `npm run test:load` | 1 run, ~30s | no — a measurement, not a pass |
| Print samples | `npm run print:samples` | 7 PDFs + PNGs | no — output for a person to review |

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

## Load measurement

`npm run test:load` builds the plan's envelope (§6: one county search, 100
candidates, 15 accounts) and then runs 20 concurrent request streams — 19
readers and one writer — against it. It is not part of `npm test`: it takes
half a minute and its output is a measurement to read, not a pass or a fail.

One run, 12 September 2026, Node v22.18.0 on Windows, 16 CPUs, loopback, no
TLS, no proxy, warm page cache:

| Measurement | n | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| Add candidate, first 10 (85 KB store) | 10 | 12.0 ms | 13.6 ms | 13.6 ms | 13.6 ms |
| Add candidate, last 10 | 10 | 14.6 ms | 15.4 ms | 15.4 ms | 15.4 ms |
| GET search, 19 concurrent readers | 11,095 | 34.0 ms | **41.9 ms** | 46.9 ms | 462.0 ms |
| PUT scores, 1 concurrent writer | 307 | 62.3 ms | 70.6 ms | 126.2 ms | 480.0 ms |

569 req/s sustained, no unexpected responses, no revision conflicts.

These are the figures **after** the history fix below. The first run, before it,
read p95 56.7 ms and wrote 255 scores at p95 87.5 ms for 473 req/s; a repeat of
that run reproduced within a few milliseconds, so neither set is a single lucky
sample — but both are samples on one machine.

**Read p95 of 42 ms against the checklist's 1,000 ms target.** On this hardware
the JSON store is not close to being the constraint at pilot size, and the
single-writer model costs a score save under 100 ms while nineteen readers are
hitting the same file.

### What the run found anyway

**History dominated growth, and each entry was a full snapshot — now fixed.**
The first run put 255 score saves at 823 KB, of which 217 KB was 101 history
entries, roughly 4 KB each: every entry copied the whole `criteria`, `scores`
and `notesBy` state rather than what changed. That per-entry cost *rose as
scoring proceeded*, so history grew faster than linearly in the number of edits
— quadratic in a panel's work, and precisely what DEP-04's instruction to bound
history growth is about.

A scoring entry now records only the reviewer-and-candidate pairs that actually
changed, and names the profile revision instead of copying the criteria. The
same measurement, with *more* writes:

| | before | after |
|---|---|---|
| History, 101 entries | 217 KB | **16.5 KB** |
| One entry | 4,002 bytes | **166 bytes** |
| Whole store file | 823 KB | **186 KB** |
| Score writes in 20s | 255 | 307 |

**Nothing was removed from the record.** A score that did not change is still
recorded in the entry where it did change, or in the search's current state; the
full picture at a point in time is the profile revision's baseline plus the
deltas after it, as it always was. Entries written before the change keep their
old shape and are read as complete snapshots — the export labels each one
`changed-only` or `complete-snapshot` so a reader never has to guess. Three
checks in `tests/integrity.js` pin both halves: that the redundancy is gone, and
that the replaced value is still there.

This bounds the growth. It does not decide **retention**, which is still an open
decision for the county's records officer.

**Activity is now the largest growing component** — 424 entries, 46.5 KB — but
it grows linearly, one small entry per action, which is the shape you want.

**The store is written pretty-printed.** 303 KB of data occupies 823 KB on
disk, about 2.7x. That is a deliberate trade for a store a person can read
during an incident, and it is worth knowing before sizing a disk or reading a
backup-duration figure. Not changed here: it is a decision, not a defect.

**Neither of these is a reason to move off JSON for the pilot**, on this
evidence. Both are reasons to re-measure on Render before the pilot starts,
because a network disk changes the cost of rewriting the whole file on every
write, and that is the operation this design performs most.

## Print output

`npm run print:samples` builds a search deliberately shaped to break layout — a
county name that wraps, a matching position title, long candidate answers, a
six-row plan table and eight candidates with names that do not fit a narrow
column — drives the application's own print path, and writes seven PDFs plus
PNGs of the same pages to `print-samples/`. The output is gitignored: it is
evidence for a review, not an artifact of the build.

**Looking at the output found two defects the print test did not**, because
that test set the print flag by hand and so only ever exercised the path where
it is set:

1. **The print stylesheet applied only to the brochure and advertisements.**
   Every rule sat behind `html[data-print]`, which only those two Print controls
   set. Pressing Ctrl+P anywhere else — the ad plan table, the candidate list,
   someone's answers — printed the navigation rail, the filter controls and the
   back link, losing about a fifth of the page width. Navigation chrome is now
   hidden on any print; content never is.
2. **An internal review warning printed on the client-facing brochure.** "The
   candidate profile changed. Review this copy against the current profile." is
   for the consultant who has to act on it, not for the county reading the
   packet. Notices are now hidden when printing a packet.

Two browser checks now pin both, including the unflagged Ctrl+P path.

**Still open, and left for a person deliberately:**

- Editor fields print as input boxes and truncate: a plan table cell holding
  "ICMA Job Center" prints as "ICMA Job". Fixing it means rendering a read-only
  view for print, which is a design decision rather than a CSS change.
- Row action buttons still print. Hiding every button risked hiding things that
  read as content.
- **Nobody has printed one on paper.** Screen PDF and paper differ, and the
  sign-off in `print-samples/README.md` is not closed until someone has.
- A browser-printed PDF is **not an accessible tagged document**, as DEP-12 says
  explicitly. None of these files satisfy that if the county requires it.

## Coverage gaps, stated plainly

| Gap | Consequence | Ticket |
|---|---|---|
| **Desktop WebKit, not Safari on a device** | The engine iOS runs is now covered; the device is not. Touch, on-screen keyboards, viewport quirks and iOS-specific input behaviour remain unknown. | DEP-12 |
| **PWA and offline behaviour in Chromium only** | Service workers are blocked in the WebKit project to keep it offline. Whether the worker behaves on WebKit is untested. | DEP-12 |
| **Emulated mobile, not a real device** | Catches layout and target size; does not establish real iOS or Android browser behaviour. The plan requires at least one real phone rehearsal. | DEP-12 |
| **Clerk's own components unverified** | The sign-in modal and account button are excluded from the accessibility scan and are not covered by any test here. | DEP-12 |
| **No screen-reader testing** | The priority accessibility claim is unverified. | DEP-12 |
| **No print/PDF verification** | Brochures, panel materials and long answers have not been printed and looked at. A browser-printed PDF is also not an accessible tagged document. | DEP-12 |
| **Load measured on a developer machine only** | The envelope has been measured against loopback on Windows, not against a Render starter instance and its network disk. The numbers bound the application's own cost; they do not predict the pilot. | DEP-04 |
| **No real AI calls** | Model IDs, tool compatibility, latency and cost are configuration, not evidence. | DEP-11 |
| **No manual restore drill** | The mechanism is tested on synthetic data in milliseconds. That is not evidence an operator can recover under pressure. | DEP-05 |
| **Print samples generated but not signed off** | `npm run print:samples` produces seven PDFs and PNGs from a search shaped to break layout; two defects were found and fixed from them, but nobody has opened the current set or printed one on paper. | DEP-12 |
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
