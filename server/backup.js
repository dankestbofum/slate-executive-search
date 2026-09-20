'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const checksum = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function files(root, relative = '') {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink()) throw new Error('Backup refuses symbolic links.');
    const name = path.posix.join(relative, entry.name);
    return entry.isDirectory() ? files(root, name) : [name];
  });
}

/**
 * Directories of bytes that the store only holds references to.
 *
 * `media` is the brochure photography. `application-files` is the materials
 * members of the public attach to an application: the record naming a file,
 * its checksum and its scan state is in slate.json, but the file itself is
 * here, and a snapshot that took the record without the document would restore
 * an application whose resume had vanished.
 */
const PAYLOAD_DIRS = ['media', 'application-files'];

function snapshot(source, destination) {
  if (fs.existsSync(destination)) throw new Error('Backup destination already exists.');
  for (const dir of PAYLOAD_DIRS) {
    const relative = path.relative(path.resolve(source, dir), path.resolve(destination));
    if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
      throw new Error('Backup destination cannot be inside source ' + dir + '.');
    }
  }
  JSON.parse(fs.readFileSync(path.join(source, 'slate.json'), 'utf8'));
  const staging = destination + '.partial-' + crypto.randomBytes(6).toString('hex');
  fs.mkdirSync(staging, { recursive: true });
  fs.copyFileSync(path.join(source, 'slate.json'), path.join(staging, 'slate.json'));
  for (const dir of PAYLOAD_DIRS) {
    const from = path.join(source, dir);
    if (!fs.existsSync(from)) continue;
    if (fs.lstatSync(from).isSymbolicLink()) throw new Error('Backup refuses symbolic links.');
    files(from); // Reject links before copying out of the data directory.
    fs.cpSync(from, path.join(staging, dir), { recursive: true });
  }
  const manifest = { version: 1, at: new Date().toISOString(), files: {} };
  for (const name of files(staging)) manifest.files[name] = checksum(path.join(staging, name));
  fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2));
  verify(staging);
  fs.renameSync(staging, destination);
  return destination;
}

function verify(source) {
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1 || !manifest.files?.['slate.json']) throw new Error('Invalid backup manifest.');
  const actual = files(source).filter(f => f !== 'manifest.json').sort();
  if (JSON.stringify(actual) !== JSON.stringify(Object.keys(manifest.files).sort())) throw new Error('Backup file list does not match.');
  for (const name of actual) if (checksum(path.join(source, name)) !== manifest.files[name]) throw new Error('Backup checksum failed: ' + name);
  const store = JSON.parse(fs.readFileSync(path.join(source, 'slate.json'), 'utf8'));
  if (!Array.isArray(store.users) || !Array.isArray(store.searches)) throw new Error('Backup store is invalid.');
  return manifest;
}

function restore(source, destination) {
  verify(source);
  if (fs.existsSync(destination) && fs.readdirSync(destination).length) throw new Error('Restore requires a new or empty destination. Stop the app before switching DATA_DIR.');
  fs.mkdirSync(destination, { recursive: true });
  const store = JSON.parse(fs.readFileSync(path.join(source, 'slate.json'), 'utf8'));
  delete store.sessions; // Never resurrect sessions from a pre-Clerk store.
  fs.writeFileSync(path.join(destination, 'slate.json'), JSON.stringify(store, null, 2));
  for (const dir of PAYLOAD_DIRS) {
    const from = path.join(source, dir);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(destination, dir), { recursive: true });
  }
  return destination;
}

const lastDays = new Map();
// A dated daily snapshot, and only that. `pre-migration-*` copies are one-off
// safety nets taken before a schema change and are never swept.
const DAILY = /^\d{4}-\d{2}-\d{2}$/;

function keepDays(env = process.env) {
  const asked = Number(env.SLATE_BACKUP_KEEP_DAYS);
  if (!Number.isFinite(asked) || asked < 1) return 14;
  return Math.floor(asked);
}

/**
 * Keep the most recent daily snapshots and remove the rest.
 *
 * Snapshots used to accumulate for ever. That was survivable while one held a
 * JSON store and some brochure photography; it stopped being survivable when
 * application materials joined them, because every day then copies every
 * resume again. The production disk is 1 GB (render.yaml), so a search with a
 * hundred applicants would fill it inside a fortnight and the first symptom
 * would be saves failing.
 *
 * Deliberately careful, because this deletes backups: only directories whose
 * name is a date are considered, the newest `keep` are never touched, and a
 * directory that will not delete is reported rather than retried into a loop.
 */
function pruneSnapshots(dataDir, keep = keepDays()) {
  const directory = path.join(dataDir, 'backups');
  if (!fs.existsSync(directory)) return { removed: [], kept: [] };
  const dated = fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && DAILY.test(entry.name))
    .map(entry => entry.name)
    .sort();
  const kept = dated.slice(-keep);
  const removed = [];
  for (const name of dated.slice(0, Math.max(0, dated.length - keep))) {
    try {
      fs.rmSync(path.join(directory, name), { recursive: true, force: true });
      removed.push(name);
    } catch (error) {
      console.error('Slate: could not remove old snapshot ' + name + ': ' + error.message);
    }
  }
  return { removed, kept };
}

function ensureDaily(dataDir) {
  const day = new Date().toISOString().slice(0, 10);
  if (lastDays.get(dataDir) === day || !fs.existsSync(path.join(dataDir, 'slate.json'))) return;
  const directory = path.join(dataDir, 'backups');
  const dest = path.join(directory, day);
  if (fs.existsSync(dest)) verify(dest);
  else snapshot(dataDir, dest);
  lastDays.set(dataDir, day);
  // After the new one exists and has verified, never before: a sweep that ran
  // first could drop the last good copy and then fail to write its replacement.
  pruneSnapshots(dataDir);
}

/** What the snapshot directory is costing, for the readiness report. */
function snapshotUsage(dataDir) {
  const directory = path.join(dataDir, 'backups');
  if (!fs.existsSync(directory)) return { snapshots: 0, bytes: 0 };
  let bytes = 0;
  let snapshots = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    snapshots += 1;
    for (const name of files(path.join(directory, entry.name))) {
      try { bytes += fs.statSync(path.join(directory, entry.name, name)).size; }
      catch { /* a snapshot being written underneath us */ }
    }
  }
  return { snapshots, bytes };
}

module.exports = {
  snapshot, verify, restore, ensureDaily, PAYLOAD_DIRS,
  pruneSnapshots, snapshotUsage, keepDays
};
