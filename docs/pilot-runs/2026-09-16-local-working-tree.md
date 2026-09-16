# Local working-tree validation — 2026-09-16

This is implementation evidence, not pilot approval. It was run from a dirty
working tree at base commit `3be3db1` on Windows with Node `v22.18.0`; the
supported release runtime is Node 24. The tree was not frozen, so this record
must not be treated as evidence for a later commit or container image.

Run completed at 2026-09-16T17:48:26Z.

## Results

| Check | Result | Notes |
|---|---|---|
| `npm run check` | PASS | 74 files parsed, 0 failed |
| `npm test` | PASS | 569 checks passed, 0 failed |
| `npm run test:browser` | PASS with explained skips | 224 passed, 22 project-specific skips, 0 failed; run before the final print-only CSS changes |
| Targeted print browser regression | PASS | 3 desktop-Chrome tests passed after the final print changes |
| New recovery/conflict/connected browser specs | PASS | Included in the full browser run; the connected rehearsal intentionally runs only in its desktop-Chrome project |
| `npm run print:samples` | PASS (generation only) | 7 PDFs and matching PNGs generated; electronic first-pass inspection found no clipping or printed action controls after fixes |
| `git diff --check` | PASS | Line-ending conversion warnings only |
| Container restart job | NOT RUN | CI implementation changed; release image and volume still need execution |
| Hosted load | NOT RUN | Requires named staging URL, fixture accounts, authorization, and explicit confirmation phrase |
| Dependency audit / clean install | NOT RUN | Must run in Node 24 CI on the frozen release |

On this Windows/Node 22 host, Playwright's web-server process did not exit on
its own after the tests completed. The exact spawned server process was stopped
and the runner then returned exit code 0. Treat this as a local harness caveat;
Node 24 CI must establish A01 for the release.

## External and human gates

All hosted Clerk, AI/provider, deployed-volume, independent restore, alert,
rollback, physical-device, screen-reader, paper-print, and unassisted-user
checks remain `NOT RUN`. No real candidate data may be entered on the strength
of this local record.
