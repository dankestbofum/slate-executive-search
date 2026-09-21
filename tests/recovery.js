'use strict';

// DEP-05 acceptance evidence: scheduled recovery outside the app volume.
//
// The central check is the restore drill: take a snapshot, copy it somewhere
// that does not share the volume, restore that copy into an empty environment,
// and confirm the search survived intact while a pre-Clerk session table did not.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const backup = require('../server/backup');
const recovery = require('../server/recovery');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try { fn(); passed += 1; console.log('PASS  Recovery: ' + name); }
  catch (error) { failed += 1; console.error('FAIL  Recovery: ' + name + '\n      ' + error.message); }
}

// The scheduler is async, so a check against it has to be awaited or its
// assertions land after the summary has already been printed — which reads as
// a pass whatever it found. Queued here and drained before the totals.
const pending = [];
function checkAsync(name, fn) {
  pending.push((async () => {
    try { await fn(); passed += 1; console.log('PASS  Recovery: ' + name); }
    catch (error) { failed += 1; console.error('FAIL  Recovery: ' + name + '\n      ' + error.message); }
  }));
}

function tmpdir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'slate-' + label + '-'));
}

// A data directory that looks like a real one: a search with a committee, a
// candidate answer against its original questions, scores, history and media.
function seedStore() {
  const dir = tmpdir('recover-src');
  const store = {
    schemaVersion: 1,
    users: [
      { id: 'u1', email: 'abe@slate.local', name: 'Abe Macy', role: 'consultant', pinHash: 'x:y' },
      { id: 'c9', email: 'rose@example.com', name: 'Rose Committee', role: 'committee', pinHash: 'x:y' }
    ],
    sessions: { 'live-session': { userId: 'u1', exp: Date.now() + 3600000 } },
    seq: 1,
    searches: [{
      id: 'sr-recover', no: 1, client: 'Recovery County', position: 'County Administrator',
      jurisdictionType: 'county', revision: 7, profileRevision: 2,
      members: [{ userId: 'u1', searchRole: 'manager' }, { userId: 'c9', searchRole: 'committee' }],
      criteria: [{ id: 'S1', kind: 'skill', label: 'Budget' }],
      scores: { 'C1': { S1: 4 } },
      candidates: [{
        id: 'C1', name: 'Dana Ruiz', stage: 'semifinalist',
        survey1: {
          submittedAt: '2026-09-01T00:00:00.000Z',
          answers: { q1: 'My answer to the original question.' },
          questions: [{ n: 1, prompt: 'Why this county?', required: true }]
        }
      }],
      artifacts: { brochure: { photos: { cover: '/media/sr-recover/cover.0123456789abcdef.jpg' } } },
      history: [{ at: '2026-09-01T00:00:00.000Z', who: 'Abe Macy', kind: 'facts', body: { client: 'Old Name' } }],
      activity: [{ at: '2026-09-01T00:00:00.000Z', who: 'Abe Macy', x: 'opened the search' }]
    }],
    archivedSearches: []
  };
  fs.writeFileSync(path.join(dir, 'slate.json'), JSON.stringify(store, null, 2));
  fs.mkdirSync(path.join(dir, 'media', 'sr-recover'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'media', 'sr-recover', 'cover.0123456789abcdef.jpg'), 'brochure image bytes');
  return dir;
}

/* ---------------- The restore drill ---------------- */

check('an independently copied snapshot restores a complete search', () => {
  const source = seedStore();
  const offVolume = tmpdir('recover-offvolume');   // a different failure domain
  const restored = tmpdir('recover-target');       // an empty environment
  fs.rmSync(restored, { recursive: true, force: true });

  const started = Date.now();
  const snap = recovery.snapshotNow(source, { label: 'drill' });
  const mirrored = recovery.mirrorSnapshot(snap.path, offVolume);

  // Restore from the off-volume copy, not from the snapshot beside the source.
  backup.restore(mirrored.path, restored);
  const elapsed = Date.now() - started;

  const store = JSON.parse(fs.readFileSync(path.join(restored, 'slate.json'), 'utf8'));
  const search = store.searches.find(s => s.id === 'sr-recover');

  assert.ok(search, 'the search did not survive the restore');
  assert.strictEqual(search.client, 'Recovery County');
  assert.strictEqual(search.revision, 7, 'the revision was not preserved');

  // Committee access.
  assert.ok(search.members.some(m => m.userId === 'c9'), 'the committee place was lost');
  assert.ok(store.users.some(u => u.id === 'c9'), 'the committee account was lost');

  // Candidate answers and the questions they were asked.
  const candidate = search.candidates[0];
  assert.strictEqual(candidate.survey1.answers.q1, 'My answer to the original question.');
  assert.strictEqual(candidate.survey1.questions[0].prompt, 'Why this county?',
    'the original question text was lost, so the answer no longer has its question');

  // Scores and history.
  assert.strictEqual(search.scores.C1.S1, 4, 'scores were lost');
  assert.strictEqual(search.history.length, 1, 'history was lost');

  // Brochure image.
  const photo = path.join(restored, 'media', 'sr-recover', 'cover.0123456789abcdef.jpg');
  assert.ok(fs.existsSync(photo), 'the brochure image was not restored');
  assert.strictEqual(fs.readFileSync(photo, 'utf8'), 'brochure image bytes');

  // A session table written before Clerk must not come back to life.
  assert.strictEqual(store.sessions, undefined, 'a session table survived the restore');

  console.log('      drill: restored in ' + elapsed + 'ms from a copy outside the source volume');
});

/* ---------------- Copy integrity ---------------- */

check('a corrupt snapshot is never copied off-volume', () => {
  const source = seedStore();
  const snap = recovery.snapshotNow(source, { label: 'corrupt' });
  fs.appendFileSync(path.join(snap.path, 'slate.json'), 'tampered');
  assert.throws(() => recovery.mirrorSnapshot(snap.path, tmpdir('recover-dest')), /checksum/,
    'a snapshot that fails verification was copied anyway');
});

check('a partial copy is never published as a backup', () => {
  const dest = tmpdir('recover-dest');
  const source = seedStore();
  const snap = recovery.snapshotNow(source, { label: 'ok' });
  recovery.mirrorSnapshot(snap.path, dest);
  const names = fs.readdirSync(dest);
  assert.deepStrictEqual(names, ['ok'], 'staging directories were left behind: ' + names.join(', '));
});

/* ---------------- Encryption ---------------- */

check('an encrypted copy round-trips and verifies', () => {
  const key = crypto.randomBytes(32);
  const source = seedStore();
  const dest = tmpdir('recover-enc');
  const restored = tmpdir('recover-dec');

  const snap = recovery.snapshotNow(source, { label: 'encrypted' });
  const mirrored = recovery.mirrorSnapshot(snap.path, dest, { key });

  // Nothing readable should be sitting at the destination.
  const raw = fs.readFileSync(path.join(mirrored.path, 'slate.json.enc'));
  assert.doesNotMatch(raw.toString('latin1'), /Recovery County/, 'the copy is not actually encrypted');

  recovery.decryptTree(mirrored.path, restored, key);
  backup.verify(restored);
  const store = JSON.parse(fs.readFileSync(path.join(restored, 'slate.json'), 'utf8'));
  assert.strictEqual(store.searches[0].client, 'Recovery County');
});

check('a wrong key fails loudly rather than producing rubbish', () => {
  const source = seedStore();
  const dest = tmpdir('recover-enc');
  const snap = recovery.snapshotNow(source, { label: 'wrongkey' });
  const mirrored = recovery.mirrorSnapshot(snap.path, dest, { key: crypto.randomBytes(32) });
  assert.throws(() => recovery.decryptTree(mirrored.path, tmpdir('recover-dec'), crypto.randomBytes(32)));
});

check('a malformed key is rejected before any backup runs', () => {
  assert.throws(() => recovery.keyFrom('too-short'), /32 bytes/);
  assert.strictEqual(recovery.keyFrom(''), null);
  assert.strictEqual(recovery.keyFrom(crypto.randomBytes(32).toString('hex')).length, 32);
});

/* ---------------- Configuration guards ---------------- */

check('a copy inside the volume it protects is refused', () => {
  const dir = tmpdir('recover-src');
  assert.throws(
    () => recovery.start(dir, { SLATE_BACKUP_MIRROR: path.join(dir, 'backups', 'offsite') }),
    /outside DATA_DIR/,
    'a mirror inside DATA_DIR was accepted; it would not survive losing that volume'
  );
  recovery.stop();
});

check('the schedule falls back to hourly and honours an override', () => {
  assert.strictEqual(recovery.configure({}, '/tmp').intervalMs, 60 * 60 * 1000);
  assert.strictEqual(recovery.configure({ SLATE_BACKUP_INTERVAL_MINUTES: '15' }, '/tmp').intervalMs, 15 * 60000);
  // Too small a value is ignored rather than allowed to hammer the disk.
  assert.strictEqual(recovery.configure({ SLATE_BACKUP_INTERVAL_MINUTES: '1' }, '/tmp').intervalMs, 60 * 60 * 1000);
});

/* ---------------- Reported status ---------------- */

check('status names an unconfigured off-volume copy rather than implying one', () => {
  const status = recovery.status({ intervalMs: 60000 });
  assert.strictEqual(status.mirrorConfigured, false);
  assert.strictEqual(status.offVolumeCopy, 'NOT CONFIGURED');
});

check('a configured but failing copy is reported overdue', () => {
  const source = seedStore();
  const config = { dataDir: source, intervalMs: 60000, mirrorTo: null, mirrorCommand: null };
  recovery.runOnce(config);
  const after = recovery.status({ ...config, mirrorTo: path.join(os.tmpdir(), 'never-written') });
  assert.strictEqual(after.overdue, true,
    'a configured off-volume copy that has never run was not reported overdue');
});

/* --- snapshots are bounded ------------------------------------------------
 *
 * A snapshot now copies applicant materials as well as the store and the
 * brochure photography, which is what makes a restore whole. It is also what
 * makes an unbounded pile of them dangerous: every day copies every resume
 * again, and the production volume is 1 GB. These pin the sweep that keeps
 * that from filling the disk, and pin what it must never touch.
 * ------------------------------------------------------------------------ */

function seedWithMaterials() {
  const dir = seedStore();
  const held = path.join(dir, 'application-files', 'apl-abc123');
  fs.mkdirSync(held, { recursive: true });
  fs.writeFileSync(path.join(held, 'a'.repeat(32) + '.pdf'), Buffer.from('%PDF-1.4\nsynthetic'));
  return dir;
}

check('a snapshot carries applicant materials, so a restore is whole', () => {
  const source = seedWithMaterials();
  const dest = path.join(tmpdir('snap'), 'today');
  backup.snapshot(source, dest);
  const restored = tmpdir('restored');
  fs.rmSync(restored, { recursive: true, force: true });
  backup.restore(dest, restored);
  const file = path.join(restored, 'application-files', 'apl-abc123', 'a'.repeat(32) + '.pdf');
  assert.ok(fs.existsSync(file), 'a restore brought back the records without the documents they name');
  assert.match(fs.readFileSync(file, 'utf8'), /^%PDF/);
});

check('daily snapshots are swept to a bounded number, newest first', () => {
  const source = seedWithMaterials();
  for (let day = 1; day <= 20; day += 1) {
    backup.snapshot(source, path.join(source, 'backups', '2026-09-' + String(day).padStart(2, '0')));
  }
  const result = backup.pruneSnapshots(source, 14);
  const left = fs.readdirSync(path.join(source, 'backups')).sort();
  assert.strictEqual(result.removed.length, 6);
  assert.strictEqual(left.length, 14);
  assert.strictEqual(left[left.length - 1], '2026-09-20', 'the sweep removed the newest snapshot');
  assert.strictEqual(left[0], '2026-09-07', 'the sweep kept the wrong end of the range');
});

check('the sweep never removes a pre-migration safety copy', () => {
  const source = seedWithMaterials();
  for (let day = 1; day <= 18; day += 1) {
    backup.snapshot(source, path.join(source, 'backups', '2026-09-' + String(day).padStart(2, '0')));
  }
  const preserved = path.join(source, 'backups', 'pre-migration-7-to-8-1758300000000');
  fs.mkdirSync(preserved, { recursive: true });
  fs.writeFileSync(path.join(preserved, 'slate.json'), '{}');
  backup.pruneSnapshots(source, 14);
  assert.ok(fs.existsSync(preserved),
    'a one-off copy taken before a schema change was swept away with the dailies');
});

check('the retention window is configurable and never drops below one', () => {
  assert.strictEqual(backup.keepDays({}), 14);
  assert.strictEqual(backup.keepDays({ SLATE_BACKUP_KEEP_DAYS: '30' }), 30);
  assert.strictEqual(backup.keepDays({ SLATE_BACKUP_KEEP_DAYS: '0' }), 14,
    'a zero would have meant keeping no backups at all');
  assert.strictEqual(backup.keepDays({ SLATE_BACKUP_KEEP_DAYS: 'nonsense' }), 14);
});

/* --- the scheduled window -------------------------------------------------
 *
 * The sweep used to recognise only `YYYY-MM-DD`, which is the name
 * ensureDaily() writes. The hourly snapshots server/recovery.js takes are
 * named for a timestamp, matched nothing, and so were walked past every time:
 * they accumulated for ever on the volume they were meant to protect. These
 * pin the corrected taxonomy and prove the growth is bounded.
 * ------------------------------------------------------------------------ */

check('a scheduled snapshot is recognised as one, and a hand-labelled copy is not', () => {
  assert.strictEqual(backup.classify('2026-09-21'), 'daily');
  assert.strictEqual(backup.classify(recovery.snapshotName(new Date('2026-09-21T04:30:00.000Z'))), 'scheduled',
    'the name the scheduler actually writes is not recognised by the sweep that has to bound it');
  assert.strictEqual(backup.classify('pre-migration-7-to-8-1758300000000'), 'protected');
  assert.strictEqual(backup.classify('before-the-council-meeting'), 'protected');
  assert.strictEqual(backup.classify('legal-hold-2026-09'), 'protected');
});

check('scheduled snapshots are swept to a bounded number, newest kept', () => {
  const source = seedWithMaterials();
  const made = [];
  for (let hour = 0; hour < 72; hour += 1) {
    const at = new Date(Date.UTC(2026, 8, 21, 0, 0, 0) + hour * 3600000);
    const name = recovery.snapshotName(at);
    backup.snapshot(source, path.join(source, 'backups', name));
    made.push(name);
  }
  const before = backup.snapshotUsage(source);
  const result = backup.pruneSnapshots(source, { daily: 14, scheduled: 24 });
  const after = backup.snapshotUsage(source);
  const left = fs.readdirSync(path.join(source, 'backups')).sort();

  assert.strictEqual(left.length, 24, 'the scheduled window did not bound the pile');
  assert.strictEqual(result.removed.length, 48);
  assert.strictEqual(left[left.length - 1], made[made.length - 1], 'the sweep removed the newest snapshot');
  assert.strictEqual(left[0], made[made.length - 24], 'the sweep kept the wrong end of the range');
  assert.ok(after.bytes < before.bytes, 'the sweep freed nothing');
  console.log('      bounded growth: ' + made.length + ' created, ' + left.length + ' retained, '
    + result.removed.length + ' deleted; ' + before.bytes + ' bytes before, ' + after.bytes + ' bytes after');
});

check('the sweep leaves the daily window alone while it bounds the scheduled one', () => {
  const source = seedWithMaterials();
  for (let day = 1; day <= 10; day += 1) {
    backup.snapshot(source, path.join(source, 'backups', '2026-09-' + String(day).padStart(2, '0')));
  }
  for (let hour = 0; hour < 30; hour += 1) {
    const at = new Date(Date.UTC(2026, 8, 21, 0, 0, 0) + hour * 3600000);
    backup.snapshot(source, path.join(source, 'backups', recovery.snapshotName(at)));
  }
  backup.pruneSnapshots(source, { daily: 14, scheduled: 24 });
  const left = fs.readdirSync(path.join(source, 'backups'));
  assert.strictEqual(left.filter(n => backup.classify(n) === 'daily').length, 10,
    'dailies inside their own window were swept by the scheduled window');
  assert.strictEqual(left.filter(n => backup.classify(n) === 'scheduled').length, 24);
});

check('the sweep never removes the newest snapshot, whatever the window says', () => {
  const source = seedWithMaterials();
  const at = new Date(Date.UTC(2026, 8, 21, 0, 0, 0));
  const newest = recovery.snapshotName(at);
  backup.snapshot(source, path.join(source, 'backups', '2026-09-01'));
  backup.snapshot(source, path.join(source, 'backups', newest));
  backup.pruneSnapshots(source, { daily: 1, scheduled: 1 });
  assert.ok(fs.existsSync(path.join(source, 'backups', newest)),
    'the most recent recovery point was swept away');
});

check('the sweep never removes a hand-labelled or held copy', () => {
  const source = seedWithMaterials();
  for (let hour = 0; hour < 30; hour += 1) {
    const at = new Date(Date.UTC(2026, 8, 21, 0, 0, 0) + hour * 3600000);
    backup.snapshot(source, path.join(source, 'backups', recovery.snapshotName(at)));
  }
  const held = ['pre-migration-7-to-8-1758300000000', 'legal-hold-jones-2026', 'before-council'];
  for (const name of held) {
    const dir = path.join(source, 'backups', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'slate.json'), '{}');
  }
  const result = backup.pruneSnapshots(source, { daily: 14, scheduled: 4 });
  for (const name of held) {
    assert.ok(fs.existsSync(path.join(source, 'backups', name)), name + ' was swept away');
  }
  assert.strictEqual(result.protected.length, 3, 'held copies were not reported as protected');
});

check('the sweep only ever touches directories inside the backups directory', () => {
  const source = seedWithMaterials();
  backup.snapshot(source, path.join(source, 'backups', '2026-09-01'));
  backup.snapshot(source, path.join(source, 'backups', '2026-09-02'));
  backup.pruneSnapshots(source, { daily: 1, scheduled: 1 });
  // Everything the data directory is for is still there.
  assert.ok(fs.existsSync(path.join(source, 'slate.json')), 'the sweep removed the store');
  assert.ok(fs.existsSync(path.join(source, 'media', 'sr-recover', 'cover.0123456789abcdef.jpg')),
    'the sweep removed brochure media');
  assert.ok(fs.existsSync(path.join(source, 'application-files', 'apl-abc123', 'a'.repeat(32) + '.pdf')),
    'the sweep removed applicant materials');
});

checkAsync('a scheduled run sweeps, and only after its own snapshot has verified', async () => {
  const source = seedWithMaterials();
  for (let hour = 0; hour < 30; hour += 1) {
    const at = new Date(Date.UTC(2026, 8, 20, 0, 0, 0) + hour * 3600000);
    backup.snapshot(source, path.join(source, 'backups', recovery.snapshotName(at)));
  }
  await recovery.runOnce({ dataDir: source, intervalMs: 3600000 });
  const left = fs.readdirSync(path.join(source, 'backups')).filter(n => backup.classify(n) === 'scheduled');
  assert.strictEqual(left.length, backup.keepSnapshots({}),
    'the scheduled run created a snapshot and left the pile unbounded');
  const status = backup.pruneStatus();
  assert.strictEqual(status.ran, true);
  assert.ok(status.removed > 0, 'the sweep reported nothing removed');
  assert.deepStrictEqual(status.failed, [], 'the sweep reported a failure');
});

check('the recovery window is configurable and never drops below one', () => {
  assert.strictEqual(backup.keepSnapshots({}), 24);
  assert.strictEqual(backup.keepSnapshots({ SLATE_RECOVERY_KEEP_SNAPSHOTS: '48' }), 48);
  assert.strictEqual(backup.keepSnapshots({ SLATE_RECOVERY_KEEP_SNAPSHOTS: '0' }), 24,
    'a zero would have meant keeping no recovery point at all');
  assert.strictEqual(backup.keepSnapshots({ SLATE_RECOVERY_KEEP_SNAPSHOTS: 'nonsense' }), 24);
});

check('what the volume is carrying is reportable, with uploads counted separately', () => {
  const source = seedWithMaterials();
  backup.snapshot(source, path.join(source, 'backups', '2026-09-01'));
  const usage = backup.dataUsage(source);
  assert.ok(usage.storeBytes > 0, 'the store reported as costing nothing');
  assert.ok(usage.applicationFileBytes > 0, 'applicant materials reported as costing nothing');
  assert.ok(usage.backupBytes > 0, 'snapshots reported as costing nothing');
  assert.strictEqual(usage.backupCount, 1);
  assert.ok(usage.totalBytes >= usage.storeBytes + usage.applicationFileBytes + usage.backupBytes);
  assert.strictEqual(usage.retention.keepDays, backup.keepDays());
  assert.strictEqual(usage.retention.keepSnapshots, backup.keepSnapshots());
});

check('storage pressure is measured from the filesystem, and names no platform', () => {
  const source = seedWithMaterials();
  backup.snapshot(source, path.join(source, 'backups', '2026-09-01'));
  const pressure = backup.storagePressure(source, { uploadsEnabled: true });
  assert.ok(pressure.space === null || pressure.space.totalBytes > 0,
    'the volume reported a size of zero rather than declining to answer');
  assert.strictEqual(typeof pressure.pressured, 'boolean');
  assert.ok(Array.isArray(pressure.reasons));
  assert.strictEqual(pressure.copies, backup.keepDays() + backup.keepSnapshots());
  assert.ok(!/render|heroku|aws|fly\.io/i.test(JSON.stringify(pressure)),
    'a hosting platform was named in a generic storage module');
});

check('an incomplete backup is never treated as valid', () => {
  const source = seedWithMaterials();
  const dest = path.join(tmpdir('snap'), 'partial');
  backup.snapshot(source, dest);
  // The record naming the document survives; the document itself is gone.
  fs.rmSync(path.join(dest, 'application-files', 'apl-abc123', 'a'.repeat(32) + '.pdf'));
  assert.throws(() => backup.verify(dest), /file list does not match/,
    'a snapshot missing an applicant document verified as sound');
  const restored = tmpdir('restored-partial');
  fs.rmSync(restored, { recursive: true, force: true });
  assert.throws(() => backup.restore(dest, restored),
    'an incomplete snapshot was restored');
});

check('snapshot usage is reportable, so the disk filling is visible before it does', () => {
  const source = seedWithMaterials();
  backup.snapshot(source, path.join(source, 'backups', '2026-09-01'));
  const usage = backup.snapshotUsage(source);
  assert.strictEqual(usage.snapshots, 1);
  assert.ok(usage.bytes > 0, 'a snapshot reported as costing nothing');
});

check('status reports state, never record contents', () => {
  const text = JSON.stringify(recovery.status({ intervalMs: 60000 }));
  assert.doesNotMatch(text, /Recovery County|Dana Ruiz|My answer/, 'record contents leaked into backup status');
});

(async () => {
  for (const run of pending) await run();
  console.log(passed + ' recovery checks passed' + (failed ? ', ' + failed + ' failed' : '') + '.');
  process.exitCode = failed ? 1 : 0;
})();
