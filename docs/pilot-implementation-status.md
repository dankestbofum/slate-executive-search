# Pilot plan implementation status

Prepared 2026-09-16. This file distinguishes repository implementation from
release evidence. A checked implementation item is not a pilot approval.

## Implemented in the working tree

- Candidate draft save/reload is exposed in the public questionnaire; drafts
  remain server-side and expire after 14 days.
- Browser regression covers a committed submission whose acknowledgement is
  lost and verifies that retry returns the original receipt without duplicating
  the recorded response.
- Browser regression covers two consultants saving the same facts revision;
  the stale save is rejected, local text remains, and the first save survives.
- Package copy now describes a human decision workspace and does not advertise
  AI candidate screening or automated candidate decisions.
- Container CI seeds and verifies representative search facts, an original
  questionnaire and answer, score history, and brochure media across restart.
- Browser CI retains both the HTML report and failure traces/screenshots.
- An opt-in, mutation-guarded hosted load harness builds the stated synthetic
  envelope and records p50/p95/p99/max, errors, conflicts, readiness and store
  size in JSON.
- Print samples cover long county and candidate content. The print view now
  wraps editor values and notes, omits action and raw-JSON controls, keeps only
  selected scores, and avoids repeating an already-labelled first-review line.
- A release-specific evidence template is available in `docs/pilot-runs/`.
- A local working-tree validation record captures current results and clearly
  separates them from release-runtime and hosted evidence.
- Obsolete PIN, first-boot credential and `accounts.js audit` checklist text is
  reconciled with Clerk-only authentication.

## Requires execution outside this repository

- Node 24 CI on the exact release and its container image.
- Real Clerk invitation, acceptance, role change, revocation and directory
  latency checks against the intended hosted instance.
- Authorized provider preflight and bounded AI drafting/research with a named
  budget owner.
- Hosted load, persistent-volume restart, independent off-volume restore,
  alert delivery and rollback drills.
- Physical iPhone and Android, NVDA/VoiceOver, paper/print inspection, and
  unassisted consultant, committee and candidate sessions.
- Named primary/backup operators, alert recipient, support contact, county
  decisions, second-person review and owner go/no-go.

Until those items are recorded in a release-specific run, every affected case
remains `NOT RUN` and no release gate is reached.
