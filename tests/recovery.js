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
      members: [{ userId: 'u1', seat: 'manager' }, { userId: 'c9', seat: 'committee' }],
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
  assert.ok(search.members.some(m => m.userId === 'c9'), 'the committee seat was lost');
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

check('status reports state, never record contents', () => {
  const text = JSON.stringify(recovery.status({ intervalMs: 60000 }));
  assert.doesNotMatch(text, /Recovery County|Dana Ruiz|My answer/, 'record contents leaked into backup status');
});

console.log(passed + ' recovery checks passed' + (failed ? ', ' + failed + ' failed' : '') + '.');
process.exitCode = failed ? 1 : 0;
