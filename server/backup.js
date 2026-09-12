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

function snapshot(source, destination) {
  if (fs.existsSync(destination)) throw new Error('Backup destination already exists.');
  const mediaRelative = path.relative(path.resolve(source, 'media'), path.resolve(destination));
  if (!mediaRelative || (!mediaRelative.startsWith('..' + path.sep) && mediaRelative !== '..' && !path.isAbsolute(mediaRelative))) throw new Error('Backup destination cannot be inside source media.');
  JSON.parse(fs.readFileSync(path.join(source, 'slate.json'), 'utf8'));
  const staging = destination + '.partial-' + crypto.randomBytes(6).toString('hex');
  fs.mkdirSync(staging, { recursive: true });
  fs.copyFileSync(path.join(source, 'slate.json'), path.join(staging, 'slate.json'));
  const media = path.join(source, 'media');
  if (fs.existsSync(media)) {
    if (fs.lstatSync(media).isSymbolicLink()) throw new Error('Backup refuses symbolic links.');
    files(media); // Reject links before copying out of the data directory.
    fs.cpSync(media, path.join(staging, 'media'), { recursive: true });
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
  if (fs.existsSync(path.join(source, 'media'))) fs.cpSync(path.join(source, 'media'), path.join(destination, 'media'), { recursive: true });
  return destination;
}

const lastDays = new Map();
function ensureDaily(dataDir) {
  const day = new Date().toISOString().slice(0, 10);
  if (lastDays.get(dataDir) === day || !fs.existsSync(path.join(dataDir, 'slate.json'))) return;
  const directory = path.join(dataDir, 'backups');
  const dest = path.join(directory, day);
  if (fs.existsSync(dest)) verify(dest);
  else snapshot(dataDir, dest);
  lastDays.set(dataDir, day);
}

module.exports = { snapshot, verify, restore, ensureDaily };
