'use strict';

// Read-only reproduction against the real job manager. All dependencies are
// in-memory stubs; no server, network, real records, or provider call is used.
const jobs = require('../../../server/research-jobs');
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

async function scenario(kind) {
  let releaseAuthorization;
  let authorizationReached;
  let operation;
  const reached = new Promise(resolve => { authorizationReached = resolve; });
  const held = new Promise(resolve => { releaseAuthorization = resolve; });
  const writes = [];
  const search = { id: 'synthetic-search', revision: 1, organizationId: 'synthetic-org' };
  const user = { id: 'synthetic-user' };
  const manager = jobs.create({
    db: { db: { researchJobs: [] }, persist() {} },
    ai: { normalizeClaudeError: error => error },
    telemetry: { log: { info() {}, warn() {}, error() {} }, recordAi() {} },
    aibudget: { check: () => ({ ok: true }), begin() {}, record() {} },
    apply: () => { writes.push({ afterCancellation: operation.cancelled, afterDeadline: operation.expired() }); return { held: [] }; },
    authorize: async () => { authorizationReached(); await held; return { ok: true, search, user }; },
    research: async (_input, op) => { operation = op; return { json: { facts: { client: 'Synthetic' } }, partial: false }; },
    limits: { totalMs: kind === 'deadline' ? 1100 : 5000, crawlMs: 300, roundMs: 400, maxRounds: 3, synthesisReserveMs: 100, retries: 0 }
  });
  try {
    const { job } = manager.start({ search, user, access: { clerkUserId: 'synthetic-identity' }, input: { city: 'Synthetic', website: 'https://example.gov' } });
    await reached;
    const stage = job.stage;
    let cancellationAcknowledgement = null;
    if (kind === 'cancel') cancellationAcknowledgement = manager.cancel(job, user).job.state;
    else await new Promise(resolve => setTimeout(resolve, 1250));
    releaseAuthorization();
    await nextTurn();
    return { scenario: kind, stageWhenPaused: stage, cancellationAcknowledgement, finalState: job.state, writes, violationReproduced: writes.some(write => write.afterCancellation || write.afterDeadline) };
  } finally { manager.stop(); }
}

(async () => {
  const results = [];
  results.push(await scenario('cancel'));
  results.push(await scenario('deadline'));
  console.log(JSON.stringify({ capturedAtUtc: new Date().toISOString(), runtime: process.version, method: 'real research job manager with in-memory dependency stubs', productionWrites: false, paidProviderCalls: false, results }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
