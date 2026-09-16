# Late-stage implementation review fixes — 2026-09-16

Local working-tree validation based on `467957f`, on Windows with Node
`v22.18.0`. This is not Node 24 release evidence, hosted verification, or
acceptance by a practicing consultant. No live records or provider calls were
used. The human, operational and organizational release gates remain open.

## Changes

| Review finding | Implemented behavior | Regression evidence |
|---|---|---|
| Sealed scores leaked through export history | New exports withhold historical scores and notes while sealed. Releasing current criteria does not release sealed older revisions. Withheld history is declared. Open intake also retains its per-person privacy. | `tests/export.js`: edit, release, reseal, change profile and release again; inspect actual private note content and score values |
| Archive restoration minted candidate links | Restoration revokes any stored invitation token, including legacy archive tokens. Reopening does not grant access. An explicit reissue is required; the UI offers no copy/open action for an absent link. | `tests/authority.js`, `tests/integrity.js`, connected browser journey |
| Reassignment UI disagreed with authority | Roster controls use `handoverManager`. Ordinary consultants cannot take the account; administrators supply a recorded reason. Cancellation and blank reasons make no change. | Browser handover/reassignment test with a newly invited consultant in all three configured projects |
| Closed searches could only be bulk archived | Single and bulk archiving both preserve a closed lifecycle. Home sends the displayed record revision for single archiving; the overview only offers archive to an authorized manager. | API single/bulk close/archive/restore/reopen loop; browser archive from Home |
| Inventory URLs could export sharing credentials | New references reject userinfo, query strings, fragments and common anonymous-sharing patterns. Legacy URLs failing that policy are withheld in both export formats, with a completeness notice. | API rejection cases; legacy export tests; browser correction from a rejected URL to a permanent reference |
| Late-stage/export coverage used different searches | One browser journey carries three candidates from semifinalist responses through staff work, assessment plan, contract/evaluation drafts, references, three outcomes and a correction, sealed/released/closed exports, archive restoration and reopening. Assertions inspect actual answers, questions, scores, history, external inventory and staff evidence. | `tests/browser/late-stage.spec.js` |

The extended journey also exposed an unrelated failure at a required handoff:
refusing an empty staff-work completion created an in-memory staff record.
A subsequent persistence operation changed the search revision, so the next
legitimate save failed as stale. Staff records are now attached only after a
successful mutation. The API regression reuses the original revision after
the refusal, and the browser journey adds evidence immediately afterward.

## URL policy and operational implications

The repository owner must still verify access controls. An opaque path can
grant access that a URL syntax check cannot detect. If the repository supplies
only a sharing URL or a query-based locator, leave the URL blank and put its
stable document identifier in the inventory label. Historical source records
are preserved; export withholding does not rewrite or delete them.

Restoration now requires staff to explicitly reissue any candidate link that
should become usable. Closing and restoring a search are filing decisions,
not permission to resume candidate participation. Backup restoration remains
a separate operational drill, including reconciliation of revocations made
after the chosen snapshot.

## Validation

- Syntax: 79 JavaScript files parsed, zero failures.
- API/server suites: passed with exit 0, including export privacy, reference
  evidence, single/bulk archive lifecycle and recovery regressions.
- Browser validation: full configured suite completed with exit 0; 228 passed,
  24 skipped across desktop Chromium, desktop WebKit and mobile Chromium
  emulation (8.5 minutes). The connected B07–B09 journey passed.
- Whitespace validation: `git diff --check` passed.

The default Playwright web-server teardown hung on this Windows environment.
For completed browser runs, an ephemeral launcher forked the same application
with fixture Clerk identity, an isolated store, no model key and a dynamic
loopback port; it ran the repository's Playwright configuration with only the
server lifecycle and base URL overridden, then stopped its own server. Test
cases, browser projects and assertions were unchanged. CI should still run
the standard harness on the supported release runtime.

The connected journey runs once in desktop Chromium. Reassignment runs in
desktop Chromium, desktop WebKit and mobile Chromium emulation. None of those
substitutes for real Clerk invitation acceptance, physical phones, assistive
technology, unassisted users, actual counsel review/signatures, or the
independent hosted backup-restore drill.
