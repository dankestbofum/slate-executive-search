'use strict';

/**
 * DEP-04 acceptance evidence: is the JSON store adequate for the pilot?
 *
 * The plan (§6) names the envelope rather than leaving it to opinion: one
 * active county search, 100 candidates, 15 committee and consultant accounts,
 * 20 concurrent browser sessions. The release checklist adds p95 under one
 * second. This measures that, because "JSON is probably fine at this size" is
 * a guess and the decision it feeds — whether to keep a single JSON file or
 * move to a database before the pilot — is not a guess-shaped decision.
 *
 * What it deliberately stresses is the part that cannot scale by construction:
 * every write serialises through one writer and rewrites the whole store. Read
 * concurrency is cheap; the question is what a write costs once the file is
 * full-size, and what reads do while writes are landing.
 *
 * HONEST LIMITS, and they are large:
 *
 *  - This runs on whatever machine invoked it, against loopback, with no TLS,
 *    no proxy, no other tenant, and a warm page cache. Render's starter
 *    instance and its network disk are not this. Treat these numbers as an
 *    upper bound on the application's own cost, not as a prediction.
 *  - Twenty concurrent request streams are not twenty browser sessions. A real
 *    session is mostly idle.
 *  - It measures latency and errors. It does not prove correctness under
 *    concurrency; tests/storage.js and tests/integrity.js do that.
 *
 * Run it with `npm run test:load`. It is not part of `npm test`: it takes
 * minutes and its output is a measurement to be read, not a pass or a fail.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const identity = require('./identity');

const root = path.resolve(__dirname, '..');

// The envelope from CLAUDE_DEPLOYMENT_HANDOFF.md §6.
const CANDIDATES = Number(process.env.SLATE_LOAD_CANDIDATES || 100);
const ACCOUNTS = Number(process.env.SLATE_LOAD_ACCOUNTS || 15);
const SESSIONS = Number(process.env.SLATE_LOAD_SESSIONS || 20);
const SECONDS = Number(process.env.SLATE_LOAD_SECONDS || 20);
// The checklist's target. Reported against, not enforced: a number this
// machine produces is not the number the pilot will see.
const TARGET_P95_MS = 1000;

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function summarise(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] || 0
  };
}

function ms(value) {
  return value.toFixed(1).padStart(8) + ' ms';
}

function row(label, stats) {
  console.log('  ' + label.padEnd(34)
    + String(stats.n).padStart(6) + '  '
    + ms(stats.p50) + '  ' + ms(stats.p95) + '  ' + ms(stats.p99) + '  ' + ms(stats.max));
}

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-load-'));
  const dataDir = path.join(directory, 'server');
  const fixture = identity.serverEnv();
  const env = {
    ...process.env, NODE_ENV: 'test', PORT: '0', HOST: '127.0.0.1', DATA_DIR: dataDir,
    TRUST_PROXY: '', ANTHROPIC_API_KEY: '', ...fixture.server,
    SLATE_EMAIL_TEAM: 'team@slate.local', SLATE_EMAIL_ABE: 'abe@slate.local', SLATE_EMAIL_MIKE: 'mike@slate.local'
  };

  const server = fork(path.join(__dirname, 'server.js'), [], {
    cwd: root, env, stdio: ['ignore', 'ignore', 'inherit', 'ipc'], windowsHide: true
  });

  let failed = 0;
  try {
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Load server did not start.')), 15000);
      server.once('message', m => { clearTimeout(timer); resolve(m); });
      server.once('exit', () => { clearTimeout(timer); reject(new Error('Load server exited before startup.')); });
      server.once('error', e => { clearTimeout(timer); reject(e); });
    });
    const BASE = 'http://127.0.0.1:' + ready.port;
    const signer = identity.signer(fixture.privateKey);
    const owner = signer.headers('abe@slate.local');

    async function call(method, url, body, headers) {
      const res = await fetch(BASE + url, {
        method,
        headers: { 'content-type': 'application/json', ...(headers || owner) },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* a non-JSON body is itself the finding */ }
      return { status: res.status, body: json, text };
    }
    async function revision(id) {
      return String((await call('GET', '/api/searches/' + id)).body.revision);
    }
    async function write(method, url, body) {
      const id = url.split('/')[3];
      return call(method, url, body, { ...owner, 'if-match': await revision(id) });
    }

    console.log('Slate load measurement');
    console.log('  envelope: ' + CANDIDATES + ' candidates, ' + ACCOUNTS + ' accounts, '
      + SESSIONS + ' concurrent streams, ' + SECONDS + 's');
    console.log('  node ' + process.version + ' on ' + os.platform() + ' ' + os.arch()
      + ', ' + os.cpus().length + ' cpus');
    console.log('  store: ' + dataDir);
    console.log('');

    /* ---------------- Build the envelope ---------------- */

    const created = await call('POST', '/api/searches', {
      client: 'Load County', position: 'County Administrator', jurisdictionType: 'county', package: 'executive'
    });
    if (created.status !== 200) throw new Error('Could not create the search: ' + created.text.slice(0, 200));
    const id = created.body.id;

    // A profile, so scoring has criteria to write against.
    await write('PUT', '/api/searches/' + id + '/profile', {
      criteria: [
        { id: 'S1', kind: 'skill', label: 'Financial management', weight: 5, note: '' },
        { id: 'S2', kind: 'skill', label: 'Board relations', weight: 4, note: '' },
        { id: 'S3', kind: 'skill', label: 'Staff leadership', weight: 3, note: '' }
      ]
    });

    const buildStart = Date.now();
    const seatEmails = [];
    for (let i = 0; i < ACCOUNTS; i += 1) {
      const email = 'load-member-' + i + '@example.gov';
      const res = await write('POST', '/api/searches/' + id + '/members',
        { name: 'Load Member ' + i, email, seat: 'committee' });
      if (res.status === 200) seatEmails.push(email);
    }

    // Writes are serial by design: one writer, whole-file persist. Measuring
    // them one at a time is measuring the real thing.
    const addSamples = [];
    for (let i = 0; i < CANDIDATES; i += 1) {
      const started = process.hrtime.bigint();
      const res = await write('POST', '/api/searches/' + id + '/candidates', {
        name: 'Load Candidate ' + i,
        cur: 'Deputy County Administrator',
        org: 'County of Elsewhere ' + i,
        email: 'load-candidate-' + i + '@example.gov'
      });
      addSamples.push(Number(process.hrtime.bigint() - started) / 1e6);
      if (res.status !== 200) throw new Error('Candidate ' + i + ' failed: ' + res.text.slice(0, 200));
    }
    const buildSeconds = (Date.now() - buildStart) / 1000;

    const loaded = await call('GET', '/api/searches/' + id);
    const candidateIds = loaded.body.candidates.map(c => c.id);
    const storeBytes = fs.statSync(path.join(dataDir, 'slate.json')).size;

    console.log('  built in ' + buildSeconds.toFixed(1) + 's · '
      + candidateIds.length + ' candidates · ' + seatEmails.length + ' seats · store '
      + (storeBytes / 1024).toFixed(0) + ' KB');
    console.log('');

    // The write cost as the file grows is the whole question, so report the
    // first ten against the last ten rather than only the aggregate.
    const firstTen = summarise(addSamples.slice(0, 10));
    const lastTen = summarise(addSamples.slice(-10));
    console.log('  Write cost as the store grows');
    console.log('  ' + 'measurement'.padEnd(34) + '     n'.padStart(6)
      + '       p50'.padStart(13) + '       p95'.padStart(13) + '       p99'.padStart(13) + '       max'.padStart(13));
    row('add candidate, first 10', firstTen);
    row('add candidate, last 10', lastTen);
    console.log('');

    /* ---------------- Concurrent sessions ---------------- */

    // Nineteen readers and one writer. A search is read far more than it is
    // written, and the writer is there to show what reads cost while the store
    // is being rewritten underneath them.
    const readers = Math.max(1, SESSIONS - 1);
    const reads = [];
    const writes = [];
    const errors = new Map();
    const deadline = Date.now() + SECONDS * 1000;
    let requests = 0;

    function note(where, status, text) {
      const key = where + ' ' + status + ' ' + String(text || '').slice(0, 80);
      errors.set(key, (errors.get(key) || 0) + 1);
    }

    async function readerLoop(index) {
      // Committee members and consultants read the same search; both paths run.
      const headers = index % 4 === 0 ? owner : signer.headers(seatEmails[index % seatEmails.length]);
      while (Date.now() < deadline) {
        const started = process.hrtime.bigint();
        const res = await call('GET', '/api/searches/' + id, undefined, headers);
        reads.push(Number(process.hrtime.bigint() - started) / 1e6);
        requests += 1;
        if (res.status !== 200) note('read', res.status, res.body?.error);
      }
    }

    async function writerLoop() {
      let n = 0;
      while (Date.now() < deadline) {
        const cid = candidateIds[n % candidateIds.length];
        n += 1;
        const started = process.hrtime.bigint();
        const res = await write('PUT', '/api/searches/' + id + '/scores/' + cid,
          { scores: { S1: (n % 5) + 1, S2: ((n + 1) % 5) + 1, S3: ((n + 2) % 5) + 1 } });
        writes.push(Number(process.hrtime.bigint() - started) / 1e6);
        requests += 1;
        // A 409 here is the optimistic revision check doing its job against a
        // concurrent writer, not a failure. Counted separately for that reason.
        if (res.status !== 200) note(res.status === 409 ? 'write (revision conflict)' : 'write', res.status, res.body?.error);
      }
    }

    const wallStart = Date.now();
    await Promise.all([
      ...Array.from({ length: readers }, (_, i) => readerLoop(i)),
      writerLoop()
    ]);
    const wallSeconds = (Date.now() - wallStart) / 1000;

    const readStats = summarise(reads);
    const writeStats = summarise(writes);

    console.log('  Under ' + SESSIONS + ' concurrent streams for ' + wallSeconds.toFixed(1) + 's');
    console.log('  ' + 'measurement'.padEnd(34) + '     n'.padStart(6)
      + '       p50'.padStart(13) + '       p95'.padStart(13) + '       p99'.padStart(13) + '       max'.padStart(13));
    row('GET search (' + readers + ' readers)', readStats);
    row('PUT scores (1 writer)', writeStats);
    console.log('');
    console.log('  throughput: ' + (requests / wallSeconds).toFixed(0) + ' req/s'
      + ' · final store ' + (fs.statSync(path.join(dataDir, 'slate.json')).size / 1024).toFixed(0) + ' KB');
    console.log('');

    /* ---------------- What it means ---------------- */

    const readOk = readStats.p95 <= TARGET_P95_MS;
    console.log('  Read p95 ' + readStats.p95.toFixed(0) + ' ms against a ' + TARGET_P95_MS
      + ' ms target: ' + (readOk ? 'within it' : 'OVER IT'));
    if (!readOk) failed = 1;

    const unexpected = [...errors.entries()].filter(([key]) => !key.startsWith('write (revision conflict)'));
    const conflicts = [...errors.entries()].filter(([key]) => key.startsWith('write (revision conflict)'))
      .reduce((sum, [, n]) => sum + n, 0);
    if (conflicts) console.log('  Revision conflicts: ' + conflicts + ' (the optimistic check refusing a stale write)');
    if (unexpected.length) {
      failed = 1;
      console.log('  UNEXPECTED RESPONSES:');
      for (const [key, count] of unexpected) console.log('    ' + count + ' x ' + key);
    } else {
      console.log('  No unexpected responses.');
    }

    console.log('');
    console.log('  These numbers describe this machine and loopback, not Render. They bound');
    console.log('  the application\'s own cost; they do not predict the pilot. Record them in');
    console.log('  docs/test-evidence.md with the hardware they came from.');
  } catch (error) {
    console.error(error);
    failed = 1;
  } finally {
    server.kill();
    process.exitCode = failed;
  }
})();
