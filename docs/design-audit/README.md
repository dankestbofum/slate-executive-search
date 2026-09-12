# Design audit deliverables

- [Recruiting platform redesign plan](RECRUITING_REDESIGN_PLAN.md) — the second design pass: visual system, recruiting navigation, portfolio, pipeline, and candidate profiles.
- [Recruiting redesign status](RECRUITING_REDESIGN_STATUS.md) — what that plan built, the measurements after, and what is still open.

- [Audit and screenshot evidence](AUDIT.md)
- [Implementation plan](IMPLEMENTATION_PLAN.md)
- [Implementation status](IMPLEMENTATION_STATUS.md) — what was built, the measurements after, and what is still open

The screenshots and `metrics.json` describe the interface **as audited**, before the plan was implemented. `evidence/after-measurements.json` describes it afterwards; regenerate it with `node docs/design-audit/measure.cjs`, which starts its own server on a throwaway store and needs no separate terminal.

The `evidence/recruiting-redesign/` directory holds the redesign's own screenshots and `measurements.json`. Regenerate it with `node docs/design-audit/redesign.cjs`, which starts its own server on a throwaway store, builds a populated fixture through the API, and walks every redesigned screen at the plan's viewports in both themes; add `--quick` for a desktop-only pass while iterating. It also captures a committee member's session and the public questionnaire, so role and package boundaries are evidence rather than description.

The `evidence/` directory contains screenshots of synthetic local data, baseline scans (`metrics.json`), the later package/candidate/committee scans (`followup-metrics.json`), and focused layout/theme measurements (`verified-measurements.json`). Screenshots are captured at different stages of fixture setup; an empty screen and a populated screen are deliberately different states.

The audit server used a temporary store and no AI credentials. Capture helpers are one-off audit tools, not additions to the application test suite. To reproduce in a **fresh** temporary store, start the server in one terminal:

```powershell
node docs/design-audit/server.cjs
```

It picks a throwaway store, prints it, and runs with the fixture identity the capture tools sign in with. Set `DATA_DIR` first to reuse an earlier audit store.

Then run these sequentially from the repository root in a second terminal:

```powershell
node docs/design-audit/capture.cjs
node docs/design-audit/followup.cjs
node docs/design-audit/verify.cjs
```

These overwrite screenshot evidence. The first two create and change synthetic records and the follow-up submits a synthetic candidate response; use the dedicated empty audit store. `verify.cjs` only reads the existing synthetic search and operates navigation/theme controls.

The initial audit discovered stale Home state while navigating, so capture and follow-up were executed in separate passes. The helper was then shortened to end at that baseline; the follow-up continues from a fresh browser session. Initial captures include all nineteen workflow entry screens; populated and role-specific captures cover selected deeper flows as detailed in the audit.
