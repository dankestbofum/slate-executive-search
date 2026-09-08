'use strict';

// Scheduled snapshots and off-volume recovery copies.
//
// server/backup.js holds the primitives (snapshot, verify, restore). This adds
// the operational layer: when snapshots happen, where a copy goes so it
// survives losing the volume, and whether that is currently working.
//
// Two things this deliberately does not do:
//
//  - It does not choose a storage provider. Which account holds the off-volume
//    copy, in which region, under whose control, is an owner and county
//    decision. SLATE_BACKUP_MIRROR takes a path (a second mounted volume) and
//    SLATE_BACKUP_COMMAND takes whatever approved tool the operator already
//    uses, so neither requires this file to name a vendor.
//  - It does not delete anything on a schedule. Retention is a records policy
//    the county has not set, and an automatic destructive job before that
//    policy exists could destroy something under legal hold.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const backup = require('./backup');

const HOUR = 60 * 60 * 1000;

const state = {
  startedAt: null,
  lastSnapshotAt: null,
  lastSnapshotPath: null,
  lastSnapshotError: null,
  lastMirrorAt: null,
  lastMirrorTarget: null,
  lastMirrorError: null,
  snapshotCount: 0,
  mirrorCount: 0
};

let timer = null;

/* ------------------------------------------------------------------ *
 * Consistency
 *
 * Snapshots run on a timer inside the writing process. persist() is
 * synchronous (write to a temp file, fsync, rename) and so is snapshot(), so
 * the two cannot interleave on the event loop: a snapshot always sees a
 * committed store, never a half-written one.
 *
 * That is exactly why the CLI must not snapshot a live DATA_DIR from a second
 * process, where nothing orders the two. scripts/backup.js refuses to.
 * ------------------------------------------------------------------ */

function snapshotName(at = new Date()) {
  return at.toISOString().replace(/[:.]/g, '-');
}

function snapshotNow(dataDir, { label } = {}) {
  const dir = path.join(dataDir, 'backups', label || snapshotName());
  if (fs.existsSync(dir)) return { path: dir, reused: true };
  backup.snapshot(dataDir, dir); // verifies before publishing the directory
  return { path: dir, reused: false };
}

/* ------------------------------------------------------------------ *
 * Encryption
 *
 * Optional, for when the destination is not already encrypted at rest under a
 * controlled account. AES-256-GCM per file, with the plaintext digest recorded
 * so a restore proves it got the original bytes back rather than merely
 * something that decrypted without error.
 * ------------------------------------------------------------------ */
function keyFrom(material) {
  if (!material) return null;
  const raw = String(material).trim();
  const bytes = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (bytes.length !== 32) throw new Error('SLATE_BACKUP_KEY must be 32 bytes, as 64 hex characters or base64.');
  return bytes;
}

function encryptTree(source, destination, key) {
  fs.mkdirSync(destination, { recursive: true });
  const files = listFiles(source);
  const index = { version: 1, at: new Date().toISOString(), files: {} };

  for (const name of files) {
    const plain = fs.readFileSync(path.join(source, name));
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    const out = path.join(destination, name + '.enc');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.concat([iv, cipher.getAuthTag(), body]));
    index.files[name] = crypto.createHash('sha256').update(plain).digest('hex');
  }

  fs.writeFileSync(path.join(destination, 'bundle.json'), JSON.stringify(index, null, 2));
  return index;
}

function decryptTree(source, destination, key) {
  const index = JSON.parse(fs.readFileSync(path.join(source, 'bundle.json'), 'utf8'));
  if (index.version !== 1) throw new Error('Unsupported encrypted bundle version.');
  fs.mkdirSync(destination, { recursive: true });

  for (const [name, digest] of Object.entries(index.files)) {
    const raw = fs.readFileSync(path.join(source, name + '.enc'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const plain = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
    if (crypto.createHash('sha256').update(plain).digest('hex') !== digest) {
      throw new Error('Decrypted content does not match its recorded digest: ' + name);
    }
    const out = path.join(destination, name);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, plain);
  }
  return index;
}

function listFiles(root, relative = '') {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap(entry => {
    const name = path.posix.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Refusing to copy a symbolic link: ' + name);
    return entry.isDirectory() ? listFiles(root, name) : [name];
  });
}

/* ------------------------------------------------------------------ *
 * Off-volume copy
 * ------------------------------------------------------------------ */

/**
 * Copy a verified snapshot somewhere that does not share the app's volume,
 * then verify what actually arrived.
 *
 * Verifying the destination rather than the source is the point: a copy that
 * was never checked at the far end is not a backup, it is an assumption.
 */
function mirrorSnapshot(snapshotDir, target, { key } = {}) {
  backup.verify(snapshotDir); // never copy a snapshot that is not itself sound

  const destination = path.join(target, path.basename(snapshotDir));
  if (fs.existsSync(destination)) return { path: destination, reused: true, verified: true };

  const staging = destination + '.partial-' + crypto.randomBytes(6).toString('hex');
  fs.mkdirSync(path.dirname(destination), { recursive: true });

  if (key) encryptTree(snapshotDir, staging, key);
  else fs.cpSync(snapshotDir, staging, { recursive: true });

  // Read it back from where it landed, not from memory.
  if (key) {
    const check = staging + '.check';
    try {
      decryptTree(staging, check, key);
      backup.verify(check);
    } finally {
      fs.rmSync(check, { recursive: true, force: true });
    }
  } else {
    backup.verify(staging);
  }

  fs.renameSync(staging, destination);
  return { path: destination, reused: false, verified: true };
}

function runCommand(template, snapshotDir) {
  return new Promise((resolve, reject) => {
    const [command, ...args] = String(template).split(/\s+/).filter(Boolean);
    if (!command) return reject(new Error('SLATE_BACKUP_COMMAND is empty.'));
    // The snapshot path is appended rather than interpolated, so a path can
    // never be spliced into the middle of a shell string. No shell is used.
    execFile(command, [...args, snapshotDir], { timeout: 10 * 60 * 1000 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(error.message + ' ' + String(stderr || '').slice(0, 400)));
      resolve(String(stdout || '').slice(0, 400));
    });
  });
}

/* ------------------------------------------------------------------ *
 * Scheduler
 * ------------------------------------------------------------------ */

async function runOnce(config) {
  const { dataDir, mirrorTo, mirrorCommand, key } = config;
  try {
    const snap = snapshotNow(dataDir);
    state.lastSnapshotAt = new Date().toISOString();
    state.lastSnapshotPath = snap.path;
    state.lastSnapshotError = null;
    if (!snap.reused) state.snapshotCount += 1;

    if (mirrorTo) {
      mirrorSnapshot(snap.path, mirrorTo, { key });
      state.lastMirrorAt = new Date().toISOString();
      state.lastMirrorTarget = mirrorTo;
      state.lastMirrorError = null;
      state.mirrorCount += 1;
    } else if (mirrorCommand) {
      await runCommand(mirrorCommand, snap.path);
      state.lastMirrorAt = new Date().toISOString();
      state.lastMirrorTarget = 'command';
      state.lastMirrorError = null;
      state.mirrorCount += 1;
    }
  } catch (error) {
    // Never surface a backup failure as an application error. The operator is
    // told; the app keeps serving. A failed backup is an incident to act on,
    // not a reason to stop a search from being worked on.
    const message = error.message || String(error);
    if (state.lastSnapshotAt === null || !state.lastSnapshotPath) state.lastSnapshotError = message;
    else state.lastMirrorError = message;
    console.error('Slate: scheduled recovery copy failed: ' + message);
  }
  return status(config);
}

/**
 * Backup health, for the readiness endpoint and for alerting.
 *
 * `overdue` is what an alert should watch. It goes true when no verified copy
 * has been taken inside the agreed recovery point, which is the moment the
 * proposed one-hour objective stops being met.
 */
function status(config = {}) {
  const intervalMs = config.intervalMs || HOUR;
  const age = at => (at ? Date.now() - Date.parse(at) : null);
  const snapshotAge = age(state.lastSnapshotAt);
  const mirrorAge = age(state.lastMirrorAt);
  const mirrorConfigured = Boolean(config.mirrorTo || config.mirrorCommand);
  // Two intervals of slack, so one slow run is not an alert.
  const limit = intervalMs * 2;

  return {
    startedAt: state.startedAt,
    intervalMinutes: Math.round(intervalMs / 60000),
    lastSnapshotAt: state.lastSnapshotAt,
    snapshotAgeMinutes: snapshotAge === null ? null : Math.round(snapshotAge / 60000),
    lastSnapshotError: state.lastSnapshotError,
    snapshotCount: state.snapshotCount,
    mirrorConfigured,
    lastMirrorAt: state.lastMirrorAt,
    mirrorAgeMinutes: mirrorAge === null ? null : Math.round(mirrorAge / 60000),
    lastMirrorError: state.lastMirrorError,
    mirrorCount: state.mirrorCount,
    overdue: Boolean(
      state.lastSnapshotError
      || (snapshotAge !== null && snapshotAge > limit)
      || (state.lastSnapshotAt === null && state.startedAt && Date.now() - Date.parse(state.startedAt) > limit)
      || (mirrorConfigured && (state.lastMirrorError || mirrorAge === null || mirrorAge > limit))
    ),
    // Stated rather than implied: without an off-volume copy, losing the
    // volume loses the search.
    offVolumeCopy: mirrorConfigured ? 'configured' : 'NOT CONFIGURED'
  };
}

function configure(env = process.env, dataDir) {
  const minutes = Number(env.SLATE_BACKUP_INTERVAL_MINUTES);
  return {
    dataDir,
    intervalMs: Number.isFinite(minutes) && minutes >= 5 ? minutes * 60000 : HOUR,
    mirrorTo: String(env.SLATE_BACKUP_MIRROR || '').trim() || null,
    mirrorCommand: String(env.SLATE_BACKUP_COMMAND || '').trim() || null,
    key: keyFrom(env.SLATE_BACKUP_KEY)
  };
}

function start(dataDir, env = process.env) {
  const config = configure(env, dataDir);

  if (config.mirrorTo && path.resolve(config.mirrorTo).startsWith(path.resolve(dataDir) + path.sep)) {
    // A copy inside the volume it protects is not a second failure domain.
    throw new Error('SLATE_BACKUP_MIRROR must be outside DATA_DIR; it exists to survive losing that volume.');
  }

  state.startedAt = new Date().toISOString();
  timer = setInterval(() => { runOnce(config); }, config.intervalMs);
  timer.unref();

  // First run on the next tick, off the startup path, so a slow copy never
  // delays the process becoming ready.
  setImmediate(() => { runOnce(config); });

  return config;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  snapshotNow, mirrorSnapshot, encryptTree, decryptTree, keyFrom,
  configure, start, stop, runOnce, status, state
};
