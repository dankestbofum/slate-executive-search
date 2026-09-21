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

/* ------------------------------------------------------------------ *
 * What a snapshot directory's name means
 *
 * There are exactly two kinds of snapshot this module will ever delete, and
 * both are named by a machine on a schedule:
 *
 *   daily      2026-09-21                    ensureDaily(), once per day
 *   scheduled  2026-09-21T04-30-00-000Z      recovery.snapshotNow(), hourly
 *
 * Everything else in the backups directory is *protected* and is never swept,
 * whatever its age: `pre-migration-*` safety copies taken before a schema
 * change, snapshots an operator labelled by hand, and anything held as
 * evidence. That is the whole safety model here — a name this module does not
 * recognise is a name it does not touch.
 *
 * The scheduled pattern used to be missing, and that was the bug: hourly
 * recovery snapshots matched nothing, so the sweep walked past every one of
 * them and they accumulated for ever. On a 1 GB disk (render.yaml) carrying
 * applicant PDFs, twenty-four full copies a day fills the volume in days and
 * the first symptom is saves failing.
 *
 * Operational retention is NOT records retention. Sweeping these directories
 * destroys recovery points, never official records: the records themselves
 * live in the store, in exports, and in whatever the records custodian's
 * policy says. See docs/operations.md.
 * ------------------------------------------------------------------ */
const DAILY = /^\d{4}-\d{2}-\d{2}$/;
const SCHEDULED = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

function classify(name) {
  if (DAILY.test(name)) return 'daily';
  if (SCHEDULED.test(name)) return 'scheduled';
  return 'protected';
}

/**
 * How many *daily* snapshots to keep. One per day, so this is a window in days.
 */
function keepDays(env = process.env) {
  const asked = Number(env.SLATE_BACKUP_KEEP_DAYS);
  if (!Number.isFinite(asked) || asked < 1) return 14;
  return Math.floor(asked);
}

/**
 * How many *scheduled* snapshots to keep — the rolling recovery window.
 *
 * Counted in snapshots rather than days because that is what bounds the disk:
 * the scheduler's interval is configurable (SLATE_BACKUP_INTERVAL_MINUTES), so
 * "a day of snapshots" is not a fixed number of copies but this is. The
 * default of 24 is one day at the default hourly interval.
 *
 * Named separately from SLATE_BACKUP_KEEP_DAYS because it answers a different
 * question: that one is "how far back can I go", this one is "how much disk
 * will the recovery window cost".
 */
function keepSnapshots(env = process.env) {
  const asked = Number(env.SLATE_RECOVERY_KEEP_SNAPSHOTS);
  if (!Number.isFinite(asked) || asked < 1) return 24;
  return Math.floor(asked);
}

/** The last sweep's outcome, so readiness can show what retention is doing. */
let lastPrune = null;

/**
 * Keep the most recent operational snapshots and remove the rest.
 *
 * Deliberately careful, because this deletes backups:
 *
 *  - only directories whose name this module generated are considered, and
 *    each class is swept against its own window;
 *  - the newest snapshot of each class is never touched, and neither is the
 *    newest snapshot overall, whichever class it belongs to;
 *  - protected directories (`pre-migration-*`, hand-labelled copies, anything
 *    held as evidence) are counted and reported but never deleted;
 *  - every delete is re-checked to be inside the backups directory before it
 *    happens, so a name that somehow escaped classification still cannot make
 *    this remove something elsewhere on the volume;
 *  - a directory that will not delete is reported rather than retried into a
 *    loop, and the sweep carries on with the rest.
 *
 * `keep` may be a number (the daily window, which is how this was called
 * before) or `{ daily, scheduled }`.
 */
function pruneSnapshots(dataDir, keep = keepDays()) {
  const windows = typeof keep === 'object' && keep !== null
    ? { daily: keep.daily ?? keepDays(), scheduled: keep.scheduled ?? keepSnapshots() }
    : { daily: keep, scheduled: keepSnapshots() };

  const directory = path.join(dataDir, 'backups');
  const result = {
    at: new Date().toISOString(),
    removed: [], kept: [], protected: [], failed: [], windows
  };
  if (!fs.existsSync(directory)) { lastPrune = result; return result; }

  const groups = { daily: [], scheduled: [], protected: [] };
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    // A symlink is not a directory to sweep; following one is how a delete
    // leaves the backups directory.
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    groups[classify(entry.name)].push(entry.name);
  }
  // Both generated formats sort lexicographically into chronological order.
  for (const names of Object.values(groups)) names.sort();

  // Never swept, whatever the windows say.
  result.protected = groups.protected.slice();

  // The newest operational snapshot there is. Held back unconditionally, so
  // even a misconfigured window cannot leave the volume with no recovery point.
  const newest = [...groups.daily, ...groups.scheduled].sort().pop() || null;

  const root = path.resolve(directory);
  for (const kind of ['daily', 'scheduled']) {
    const names = groups[kind];
    const window = Math.max(1, windows[kind]);
    result.kept.push(...names.slice(-window));
    for (const name of names.slice(0, Math.max(0, names.length - window))) {
      if (name === newest) { result.kept.push(name); continue; }
      const target = path.resolve(directory, name);
      // Belt and braces: the name came from readdir and was matched against a
      // generated pattern, and it is still checked to be a direct child of the
      // backups directory before anything is removed.
      if (path.dirname(target) !== root || target === root) {
        result.failed.push({ name, error: 'refused: outside the backups directory' });
        continue;
      }
      try {
        fs.rmSync(target, { recursive: true, force: true });
        result.removed.push(name);
      } catch (error) {
        result.failed.push({ name, error: error.message });
        console.error('Slate: could not remove old snapshot ' + name + ': ' + error.message);
      }
    }
  }
  result.kept.sort();
  lastPrune = result;
  return result;
}

/** What the last sweep did, for /api/ready. Null until one has run. */
function pruneStatus() {
  if (!lastPrune) return { ran: false };
  return {
    ran: true,
    at: lastPrune.at,
    removed: lastPrune.removed.length,
    kept: lastPrune.kept.length,
    protectedCopies: lastPrune.protected.length,
    failed: lastPrune.failed,
    windows: lastPrune.windows
  };
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

/**
 * What the snapshot directory is costing, for the readiness report.
 *
 * Broken down by class, because the two numbers an operator needs are
 * different: `scheduled` and `daily` are what the windows bound and will stop
 * growing, `protectedCopies` is what will not and has to be dealt with by
 * hand. Counts and bytes only — never a snapshot's contents.
 */
function snapshotUsage(dataDir) {
  const directory = path.join(dataDir, 'backups');
  const empty = { snapshots: 0, bytes: 0, daily: 0, scheduled: 0, protectedCopies: 0, oldest: null, newest: null };
  if (!fs.existsSync(directory)) return empty;
  const usage = { ...empty };
  const operational = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    usage.snapshots += 1;
    const kind = classify(entry.name);
    if (kind === 'protected') usage.protectedCopies += 1;
    else { usage[kind] += 1; operational.push(entry.name); }
    let names = [];
    try { names = files(path.join(directory, entry.name)); }
    catch { continue; /* a snapshot being written underneath us */ }
    for (const name of names) {
      try { usage.bytes += fs.statSync(path.join(directory, entry.name, name)).size; }
      catch { /* likewise */ }
    }
  }
  operational.sort();
  usage.oldest = operational[0] || null;
  usage.newest = operational[operational.length - 1] || null;
  return usage;
}

/**
 * What Slate is using on the volume, in the three places it writes.
 *
 * Reported so that the disk filling is visible before it fills. Uploads are
 * the part that grows without anybody deciding it should: the store is
 * records, the snapshots are bounded by the windows above, and
 * `application-files` is however many PDFs the public sent today.
 *
 * Deliberately generic: it measures directories, and knows nothing about any
 * particular host's disk sizes or plans.
 */
function dataUsage(dataDir) {
  const measure = relative => {
    const target = path.join(dataDir, relative);
    if (!fs.existsSync(target)) return 0;
    try {
      if (fs.statSync(target).isFile()) return fs.statSync(target).size;
      return files(target).reduce((total, name) => {
        try { return total + fs.statSync(path.join(target, name)).size; }
        catch { return total; }
      }, 0);
    } catch { return 0; }
  };
  const store = measure('slate.json');
  const snapshots = snapshotUsage(dataDir);
  const applicationFiles = measure('application-files');
  const media = measure('media');
  return {
    storeBytes: store,
    applicationFileBytes: applicationFiles,
    mediaBytes: media,
    backupBytes: snapshots.bytes,
    backupCount: snapshots.snapshots,
    totalBytes: store + applicationFiles + media + snapshots.bytes,
    retention: { keepDays: keepDays(), keepSnapshots: keepSnapshots() }
  };
}

/**
 * What the volume holding DATA_DIR has left.
 *
 * Deliberately generic: it asks the filesystem, and knows nothing about any
 * particular host's plans or disk sizes. Null where the platform will not
 * answer, which is a reason to say nothing rather than to guess.
 */
function volumeSpace(dataDir) {
  try {
    const stat = fs.statfsSync(dataDir);
    const total = stat.blocks * stat.bsize;
    const free = stat.bavail * stat.bsize;
    return { totalBytes: total, freeBytes: free, usedBytes: total - free };
  } catch { return null; }
}

/**
 * Is the volume plausibly too small for what this deployment is configured to
 * put on it?
 *
 * The arithmetic that matters is not "how big is the store" but "how many
 * copies of the materials will the retention windows hold at once". Uploads
 * are the term that grows without anybody deciding it should: a posting with a
 * hundred applicants at a few megabytes each, times a daily window and a
 * scheduled window, is the whole volume.
 *
 * This reports a judgement and a reason, never an instruction, and it names no
 * host. The operator decides whether to grow the disk, shorten a window, or
 * turn uploads off.
 */
function storagePressure(dataDir, { uploadsEnabled = false } = {}) {
  const space = volumeSpace(dataDir);
  const usage = dataUsage(dataDir);
  const copies = keepDays() + keepSnapshots();
  // What one more full copy of the live data costs, and what the windows will
  // hold when they are full.
  const perSnapshot = usage.storeBytes + usage.applicationFileBytes + usage.mediaBytes;
  const projectedBackupBytes = perSnapshot * copies;
  const reasons = [];

  if (space && space.totalBytes > 0) {
    const projectedTotal = perSnapshot + projectedBackupBytes;
    if (projectedTotal > space.totalBytes * 0.8) {
      reasons.push('the retention windows hold ' + copies + ' copies, which at the current data size '
        + 'projects to ' + Math.round(projectedTotal / 1e6) + ' MB against a ' + Math.round(space.totalBytes / 1e6)
        + ' MB volume');
    }
    if (space.freeBytes < perSnapshot * 2) {
      reasons.push('there is less free space than two more snapshots would need');
    }
  }
  if (uploadsEnabled && space && space.totalBytes > 0 && space.totalBytes < 5e9) {
    reasons.push('uploads are enabled on a ' + Math.round(space.totalBytes / 1e9 * 10) / 10
      + ' GB volume, and every snapshot copies every stored document again');
  }
  return { space, usage, copies, projectedBackupBytes, pressured: reasons.length > 0, reasons };
}

module.exports = {
  snapshot, verify, restore, ensureDaily, PAYLOAD_DIRS,
  pruneSnapshots, pruneStatus, snapshotUsage, dataUsage,
  volumeSpace, storagePressure,
  classify, keepDays, keepSnapshots
};
