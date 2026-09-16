# Pilot readiness run — RUN-ID

## Release and environment

| Field | Value |
|---|---|
| Started / finished (UTC) | |
| Tester | |
| Commit | |
| Dirty tree | No / Yes — sanitized diff checksum: |
| Node / container image | |
| Staging URL / region | |
| Clerk instance | development / production |
| Fixture run ID | |
| AI models and spending cap | |
| Backup destination | |

## Automated baseline

| Command | Passed | Failed | Skipped | Artifact / notes |
|---|---:|---:|---:|---|
| `npm ci` | | | | |
| `npm run check` | | | | |
| `npm test` | | | | |
| `npm run test:browser` | | | | |
| `npm audit --omit=dev --audit-level=moderate` | | | | |
| Container job | | | | |
| `npm run test:load` | | | | |
| `npm run test:hosted-load` | | | | |
| `npm run print:samples` | | | | |

## Test cases

Use one row for every applicable A01–E05 case. A skipped or quarantined P0 is
not a pass.

| ID | Priority | Tester / timestamp | Expected | Actual | Status | Evidence | Defect / retest |
|---|---|---|---|---|---|---|---|
| A01 | P0 | | | | NOT RUN | | |

## Hosted measurements

| Measurement | Result |
|---|---|
| Ordinary read p50 / p95 / p99 / max | |
| Ordinary save p50 / p95 / p99 / max | |
| Samples / unexpected errors / expected conflicts | |
| CPU / memory / disk before and after | |
| Store / history size | |
| Clerk directory latency | |
| AI first response / total / requests / cost | |
| Recovery point / recovery time | |

## Human and operational evidence

| Review | Person / device / version | Result | Evidence / defect |
|---|---|---|---|
| iPhone Safari candidate journey | | NOT RUN | |
| Android Chrome candidate journey | | NOT RUN | |
| NVDA + Chrome/Edge | | NOT RUN | |
| VoiceOver + Safari | | NOT RUN | |
| Print and paper review | | NOT RUN | |
| Unassisted consultant task | | NOT RUN | |
| Unassisted committee task | | NOT RUN | |
| Unassisted candidate task | | NOT RUN | |
| Independent restore drill | | NOT RUN | |
| Alert delivery drill | | NOT RUN | |
| Rollback drill | | NOT RUN | |

## Decisions and approval

- Primary operator:
- Backup operator:
- Alert recipient and escalation:
- Candidate support contact and hours:
- Accepted P1 workarounds, owner and expiry:
- `pilot-decisions.md` review:
- Second-person reviewer:
- Owner decision: NOT DECIDED

Do not enter real candidate information while any P0 control is unverified.
