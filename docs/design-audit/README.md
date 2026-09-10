# Design audit deliverables

- [Audit and screenshot evidence](AUDIT.md)
- [Implementation plan](IMPLEMENTATION_PLAN.md)
- [Implementation status](IMPLEMENTATION_STATUS.md) — what was built, the measurements after, and what is still open

The screenshots and `metrics.json` describe the interface **as audited**, before the plan was implemented. `evidence/after-measurements.json` describes it afterwards; regenerate it with `node docs/design-audit/measure.cjs`, which starts its own server on a throwaway store and needs no separate terminal.

The `evidence/` directory contains screenshots of synthetic local data, baseline scans (`metrics.json`), the later package/candidate/committee scans (`followup-metrics.json`), and focused layout/theme measurements (`verified-measurements.json`). Screenshots are captured at different stages of fixture setup; an empty screen and a populated screen are deliberately different states.

The audit server used a temporary store and no AI credentials. Capture helpers are one-off audit tools, not additions to the application test suite. To reproduce in a **fresh** temporary store, start the server in one PowerShell terminal:

```powershell
$env:NODE_ENV='test'
$env:PORT='4190'
$env:HOST='127.0.0.1'
$env:DATA_DIR=Join-Path $env:TEMP ('slate-design-audit-'+[guid]::NewGuid())
$env:ANTHROPIC_API_KEY=''
$env:SLATE_SUPPORT_EMAIL='recruitment@example.gov'
node server/index.js
```

Then run these sequentially from the repository root in a second terminal:

```powershell
node docs/design-audit/capture.cjs
node docs/design-audit/followup.cjs
node docs/design-audit/verify.cjs
```

These overwrite screenshot evidence. The first two create and change synthetic records and the follow-up submits a synthetic candidate response; use the dedicated empty audit store. `verify.cjs` only reads the existing synthetic search and operates navigation/theme controls.

The initial audit discovered stale Home state while navigating, so capture and follow-up were executed in separate passes. The helper was then shortened to end at that baseline; the follow-up continues from a fresh browser session. Initial captures include all nineteen workflow entry screens; populated and role-specific captures cover selected deeper flows as detailed in the audit.
