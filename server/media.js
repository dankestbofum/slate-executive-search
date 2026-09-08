'use strict';

// Brochure photo storage.
//
// The ordering here is the whole point. The previous implementation deleted
// the existing photo, wrote the new one, then saved the JSON. A save failure
// rolled the record back in memory but the old image was already gone, so a
// successful rollback still lost data that no backup taken since could return.
//
// So: never overwrite, never delete before commit. Files are content
// addressed, a new photo is staged under a name nothing references yet, the
// record is committed, and only then are files no longer referenced by the
// record or its history swept away.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SLOTS = new Set(['cover', 'place', 'org']);

// slot.<content hash>.jpg — the hash makes the name unique per payload, so a
// replacement never lands on the bytes an older brochure revision points at.
const FILE_RE = /^(cover|place|org)\.[a-f0-9]{16}\.jpg$/;

/**
 * Decode a data URL and prove it is really a JPEG before anything references it.
 *
 * A declared content type is a claim by the caller. Checking the actual
 * markers means a record never points at a file the browser will refuse, or
 * at content of a different type entirely.
 */
function decodeJpeg(dataUrl, maxBytes = 6 * 1024 * 1024) {
  const match = String(dataUrl || '').match(/^data:image\/jpeg;base64,([A-Za-z0-9+/]+=*)$/);
  if (!match) return { error: 'Send a JPEG photo.' };

  const buf = Buffer.from(match[1], 'base64');
  if (!buf.length) return { error: 'That photo is empty.' };
  if (buf.length > maxBytes) return { error: 'That photo is too large.' };

  // Start of Image, and a JFIF/Exif/raw marker segment after it.
  if (buf[0] !== 0xFF || buf[1] !== 0xD8 || buf[2] !== 0xFF) return { error: 'That file is not a JPEG.' };
  // End of Image. Trailing bytes are tolerated; some encoders pad.
  const tail = buf.subarray(Math.max(0, buf.length - 32));
  if (!tail.includes(Buffer.from([0xFF, 0xD9]))) return { error: 'That photo is incomplete. Try saving it again.' };

  return { buf };
}

function nameFor(slot, buf) {
  return slot + '.' + crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16) + '.jpg';
}

/**
 * Write a photo under a name nothing references yet, and make it durable.
 *
 * Returns the filename. The caller publishes the reference and commits the
 * record; if that fails it calls discard() and the previous photo is still on
 * disk, untouched.
 */
function stage(dir, slot, buf) {
  if (!SLOTS.has(slot)) throw new Error('Unknown photo slot.');
  fs.mkdirSync(dir, { recursive: true });
  const file = nameFor(slot, buf);
  const abs = path.join(dir, file);

  // Same content already stored: nothing to write, and the existing file is
  // already durable. Re-uploading an identical photo is a no-op, not a churn.
  if (fs.existsSync(abs)) return file;

  const temporary = abs + '.partial-' + crypto.randomBytes(6).toString('hex');
  const handle = fs.openSync(temporary, 'w');
  try {
    fs.writeFileSync(handle, buf);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  fs.renameSync(temporary, abs);
  return file;
}

/** Remove a staged file after the record failed to commit. */
function discard(dir, file) {
  if (!file || !FILE_RE.test(file)) return;
  try { fs.unlinkSync(path.join(dir, file)); } catch { /* already gone */ }
}

/**
 * Every photo filename this search still points at, current or historical.
 *
 * History matters as much as the current record: restoring an earlier brochure
 * must show the photo that brochure was approved with, not whatever replaced
 * it later.
 */
function referenced(search) {
  const files = new Set();
  const take = photos => {
    for (const url of Object.values(photos || {})) {
      const file = path.basename(String(url || '').split('?')[0]);
      if (FILE_RE.test(file)) files.add(file);
    }
  };
  take(search?.artifacts?.brochure?.photos);
  for (const entry of search?.history || []) {
    if (entry?.kind === 'artifact' && entry.key === 'brochure') take(entry.body?.photos);
  }
  return files;
}

/**
 * Delete photo files nothing references any more.
 *
 * Only ever called after a successful commit, so the set of live references is
 * known rather than assumed. Files that do not match the content-addressed
 * pattern are left alone: they predate this scheme or were not written here,
 * and this is not the place to guess about them.
 */
function sweep(dir, search) {
  if (!fs.existsSync(dir)) return [];
  const keep = referenced(search);
  const removed = [];
  for (const file of fs.readdirSync(dir)) {
    if (!FILE_RE.test(file) || keep.has(file)) continue;
    try { fs.unlinkSync(path.join(dir, file)); removed.push(file); } catch { /* raced with another sweep */ }
  }
  return removed;
}

/** Whether a referenced photo is actually on disk, for honest "unavailable" reporting. */
function present(dir, url) {
  const file = path.basename(String(url || '').split('?')[0]);
  return FILE_RE.test(file) && fs.existsSync(path.join(dir, file));
}

module.exports = { SLOTS, FILE_RE, decodeJpeg, nameFor, stage, discard, referenced, sweep, present };
