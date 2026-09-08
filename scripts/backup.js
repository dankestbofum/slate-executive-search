'use strict';

// Snapshot, verify, mirror and restore, for operators.
//
// Snapshots normally run on a timer inside the app (server/recovery.js), where
// they cannot interleave with a save. This CLI exists for deliberate,
// out-of-band work: a pre-deploy snapshot, a restore drill, checking a copy.

const fs = require('fs');
const path = require('path');
const backup = require('../server/backup');
const recovery = require('../server/recovery');

const [action, source, destination] = process.argv.slice(2);

const USAGE = [
  'Usage:',
  '  node scripts/backup.js snapshot DATA_DIR NEW_BACKUP_DIR',
  '  node scripts/backup.js verify   BACKUP_DIR',
  '  node scripts/backup.js mirror   BACKUP_DIR OFF_VOLUME_DIR',
  '  node scripts/backup.js restore  BACKUP_DIR EMPTY_DATA_DIR',
  '  node scripts/backup.js decrypt  ENCRYPTED_DIR EMPTY_DIR      (needs SLATE_BACKUP_KEY)',
  '',
  'mirror and decrypt use SLATE_BACKUP_KEY when it is set.'
].join('\n');

/**
 * Refuse to snapshot a data directory a live process is writing.
 *
 * Two processes are not ordered against each other, so a copy taken from
 * outside can catch the store mid-rename or the media directory mid-write.
 * The app's own scheduled snapshot has no such problem: it runs in the writing
 * process, where a synchronous save and a synchronous copy cannot interleave.
 */
function refuseIfLive(dataDir) {
  const lock = path.join(dataDir, '.writer.lock');
  let held;
  try { held = JSON.parse(fs.readFileSync(lock, 'utf8')); }
  catch { return; }

  let alive = false;
  try { process.kill(held.pid, 0); alive = true; }
  catch (error) { alive = error.code === 'EPERM'; }
  if (!alive) return;

  console.error('Slate is running against ' + dataDir + ' (pid ' + held.pid + ').');
  console.error('A snapshot taken from outside that process can catch a write in progress.');
  console.error('The app already snapshots on a schedule; use that copy, or stop the app first.');
  process.exit(1);
}

function need(value, message) {
  if (!value) { console.error(message + '\n\n' + USAGE); process.exit(1); }
  return value;
}

try {
  if (action === 'snapshot') {
    need(source && destination, 'snapshot needs a source and a destination.');
    refuseIfLive(path.resolve(source));
    console.log(backup.snapshot(path.resolve(source), path.resolve(destination)));

  } else if (action === 'verify') {
    need(source, 'verify needs a backup directory.');
    const manifest = backup.verify(path.resolve(source));
    console.log('Verified ' + Object.keys(manifest.files).length + ' files, taken ' + manifest.at + '.');

  } else if (action === 'mirror') {
    need(source && destination, 'mirror needs a snapshot directory and an off-volume destination.');
    const key = recovery.keyFrom(process.env.SLATE_BACKUP_KEY);
    const out = recovery.mirrorSnapshot(path.resolve(source), path.resolve(destination), { key });
    console.log((out.reused ? 'Already present: ' : 'Copied and verified at destination: ') + out.path);
    if (!key) console.log('Not encrypted. Set SLATE_BACKUP_KEY, or rely on encryption at rest at the destination.');

  } else if (action === 'restore') {
    need(source && destination, 'restore needs a backup directory and an empty data directory.');
    console.log(backup.restore(path.resolve(source), path.resolve(destination)));
    console.log('Sessions were cleared. Everyone signs in again.');

  } else if (action === 'decrypt') {
    need(source && destination, 'decrypt needs an encrypted directory and an empty destination.');
    const key = recovery.keyFrom(need(process.env.SLATE_BACKUP_KEY, 'SLATE_BACKUP_KEY is not set.'));
    const index = recovery.decryptTree(path.resolve(source), path.resolve(destination), key);
    backup.verify(path.resolve(destination));
    console.log('Decrypted and verified ' + Object.keys(index.files).length + ' files from ' + index.at + '.');

  } else {
    console.error(USAGE);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
