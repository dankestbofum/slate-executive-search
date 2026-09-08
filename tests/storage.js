'use strict';

// DEP-04 acceptance evidence: failure-safe storage.
//
// The interesting cases are failures, and most of them cannot be provoked
// through the API, so these drive the storage modules directly against
// throwaway directories.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const media = require('../server/media');
const db = require('../server/db');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try { fn(); passed += 1; console.log('PASS  Storage: ' + name); }
  catch (error) { failed += 1; console.error('FAIL  Storage: ' + name + '\n      ' + error.message); }
}

function tmpdir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'slate-' + label + '-'));
}

// Smallest thing that satisfies the real decoder: SOI, a marker, and EOI.
function jpeg(tag) {
  return Buffer.concat([
    Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]),
    Buffer.from(String(tag).padEnd(24, '.')),
    Buffer.from([0xFF, 0xD9])
  ]);
}

/* ---------------- Decoding ---------------- */

check('a declared JPEG that is not one is refused', () => {
  const notJpeg = 'data:image/jpeg;base64,' + Buffer.from('GIF89a this is not a jpeg at all').toString('base64');
  assert.ok(media.decodeJpeg(notJpeg).error, 'a non-JPEG payload was accepted');
});

check('a truncated JPEG is refused before anything references it', () => {
  const cut = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4]);
  const result = media.decodeJpeg('data:image/jpeg;base64,' + cut.toString('base64'));
  assert.ok(result.error, 'a truncated JPEG was accepted');
  assert.match(result.error, /incomplete/);
});

check('an empty and an oversized photo are both refused', () => {
  assert.ok(media.decodeJpeg('data:image/jpeg;base64,').error);
  const big = Buffer.concat([jpeg('big'), Buffer.alloc(64)]);
  assert.ok(media.decodeJpeg('data:image/jpeg;base64,' + big.toString('base64'), 16).error,
    'a photo over the cap was accepted');
});

check('a valid JPEG decodes', () => {
  const ok = media.decodeJpeg('data:image/jpeg;base64,' + jpeg('ok').toString('base64'));
  assert.ok(!ok.error, 'a valid JPEG was refused: ' + ok.error);
  assert.ok(Buffer.isBuffer(ok.buf));
});

/* ---------------- The commit sequence ---------------- */

check('staging never overwrites the committed photo', () => {
  const dir = tmpdir('media');
  const first = media.stage(dir, 'cover', jpeg('first'));
  const second = media.stage(dir, 'cover', jpeg('second'));

  assert.notStrictEqual(first, second, 'a replacement reused the same filename');
  assert.ok(fs.existsSync(path.join(dir, first)), 'the previous photo was destroyed by staging');
  assert.ok(fs.existsSync(path.join(dir, second)));
});

check('an interrupted replacement leaves the previous photo intact', () => {
  const dir = tmpdir('media');
  const committed = media.stage(dir, 'cover', jpeg('committed'));
  const search = { artifacts: { brochure: { photos: { cover: '/media/s1/' + committed } } }, history: [] };

  // The route stages, then the save throws, then it discards.
  const staged = media.stage(dir, 'cover', jpeg('replacement'));
  media.discard(dir, staged);

  assert.ok(!fs.existsSync(path.join(dir, staged)), 'the abandoned file was left behind');
  assert.ok(fs.existsSync(path.join(dir, committed)), 'rollback lost the committed photo');
  assert.ok(media.present(dir, search.artifacts.brochure.photos.cover),
    'the record points at a photo that is no longer on disk');
});

check('identical content does not churn the stored file', () => {
  const dir = tmpdir('media');
  const a = media.stage(dir, 'cover', jpeg('same'));
  const before = fs.statSync(path.join(dir, a));
  const b = media.stage(dir, 'cover', jpeg('same'));
  assert.strictEqual(a, b, 'the same bytes produced two names');
  assert.strictEqual(fs.statSync(path.join(dir, b)).size, before.size);
});

/* ---------------- History keeps its own photos ---------------- */

check('a historical brochure keeps the photo it was approved with', () => {
  const dir = tmpdir('media');
  const old = media.stage(dir, 'cover', jpeg('approved'));
  const replacement = media.stage(dir, 'cover', jpeg('replacement'));

  const search = {
    artifacts: { brochure: { photos: { cover: '/media/s1/' + replacement } } },
    history: [{ kind: 'artifact', key: 'brochure', body: { photos: { cover: '/media/s1/' + old } } }]
  };

  media.sweep(dir, search);
  assert.ok(fs.existsSync(path.join(dir, old)),
    'sweeping deleted a photo an earlier brochure revision still points at');
  assert.ok(fs.existsSync(path.join(dir, replacement)));
});

check('sweeping reclaims only what nothing references', () => {
  const dir = tmpdir('media');
  const live = media.stage(dir, 'cover', jpeg('live'));
  const orphan = media.stage(dir, 'place', jpeg('orphan'));
  const search = { artifacts: { brochure: { photos: { cover: '/media/s1/' + live } } }, history: [] };

  const removed = media.sweep(dir, search);
  assert.deepStrictEqual(removed, [orphan], 'the wrong files were reclaimed');
  assert.ok(fs.existsSync(path.join(dir, live)));
});

check('sweeping leaves files it did not write', () => {
  const dir = tmpdir('media');
  // A legacy cover.jpg from before content addressing, and an unrelated file.
  fs.writeFileSync(path.join(dir, 'cover.jpg'), jpeg('legacy'));
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'not ours');
  media.sweep(dir, { artifacts: {}, history: [] });
  assert.ok(fs.existsSync(path.join(dir, 'cover.jpg')), 'a legacy photo was deleted');
  assert.ok(fs.existsSync(path.join(dir, 'notes.txt')), 'an unrelated file was deleted');
});

check('missing photo bytes are reported rather than assumed present', () => {
  const dir = tmpdir('media');
  assert.strictEqual(media.present(dir, '/media/s1/cover.0123456789abcdef.jpg'), false);
  const real = media.stage(dir, 'cover', jpeg('real'));
  assert.strictEqual(media.present(dir, '/media/s1/' + real), true);
});

/* ---------------- Schema version ---------------- */

check('the running store carries an explicit schema version', () => {
  assert.strictEqual(db.db.schemaVersion, db.SCHEMA_VERSION,
    'the loaded store is not stamped with the current schema version');
});

check('a store from a newer release is refused, not downgraded', () => {
  const dir = tmpdir('schema');
  fs.writeFileSync(path.join(dir, 'slate.json'), JSON.stringify({
    schemaVersion: db.SCHEMA_VERSION + 5, users: [], sessions: {}, searches: [], seq: 0
  }));

  const child = spawnSync(process.execPath, ['-e', "require('./server/db')"], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test', DATA_DIR: dir },
    encoding: 'utf8'
  });

  assert.notStrictEqual(child.status, 0, 'an incompatible store was accepted');
  assert.match(child.stderr, /newer release/,
    'the refusal did not explain that the store is newer: ' + child.stderr.slice(0, 200));
});

/* ---------------- Single writer ---------------- */

check('this process holds the write lock', () => {
  const held = JSON.parse(fs.readFileSync(db.LOCK_FILE, 'utf8'));
  assert.strictEqual(held.pid, process.pid, 'the lock names another process');
});

check('a second live writer against the same volume is refused', () => {
  // This process already holds the lock on its DATA_DIR, so a child pointed at
  // the same directory must refuse to start rather than overwrite our saves.
  const child = spawnSync(process.execPath, ['-e', "require('./server/db')"], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test', DATA_DIR: db.DATA_DIR },
    encoding: 'utf8'
  });

  assert.notStrictEqual(child.status, 0, 'a second writer was allowed against a live volume');
  assert.match(child.stderr, /one writer|already writing/,
    'the refusal did not explain the single-writer constraint: ' + child.stderr.slice(0, 200));
});

check('a stale lock from a dead process is taken over', () => {
  const dir = tmpdir('lock');
  // A pid that cannot be running: the store was left locked by a crash.
  fs.writeFileSync(path.join(dir, '.writer.lock'), JSON.stringify({ pid: 2147483646, at: 'earlier', release: 'dev' }));

  const child = spawnSync(process.execPath, ['-e', "require('./server/db'); console.log('started')"], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test', DATA_DIR: dir },
    encoding: 'utf8'
  });

  assert.strictEqual(child.status, 0, 'a stale lock blocked startup: ' + child.stderr.slice(0, 200));
  assert.match(child.stdout, /started/);
  assert.match(child.stderr + child.stdout, /stale write lock/, 'the takeover was not reported');
});

/* ---------------- Corrupt input ---------------- */

check('a corrupt store fails loudly instead of starting empty', () => {
  const dir = tmpdir('corrupt');
  fs.writeFileSync(path.join(dir, 'slate.json'), '{ "users": [ this is not json');

  const child = spawnSync(process.execPath, ['-e', "require('./server/db')"], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test', DATA_DIR: dir },
    encoding: 'utf8'
  });

  assert.notStrictEqual(child.status, 0, 'a corrupt store was silently replaced with an empty one');
  assert.ok(fs.existsSync(path.join(dir, 'slate.json')), 'the corrupt store was destroyed');
  assert.match(fs.readFileSync(path.join(dir, 'slate.json'), 'utf8'), /this is not json/,
    'the unreadable original was overwritten instead of preserved for diagnosis');
});

console.log(passed + ' storage checks passed' + (failed ? ', ' + failed + ' failed' : '') + '.');
process.exitCode = failed ? 1 : 0;
