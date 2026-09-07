'use strict';
const path = require('path');
const backup = require('../server/backup');
const [action, source, destination] = process.argv.slice(2);
if (!['snapshot', 'verify', 'restore'].includes(action) || !source || (action !== 'verify' && !destination)) {
  console.error('Usage: node scripts/backup.js snapshot DATA_DIR NEW_BACKUP_DIR | verify BACKUP_DIR | restore BACKUP_DIR EMPTY_DATA_DIR');
  process.exitCode = 1;
} else {
  try { console.log(backup[action](path.resolve(source), destination && path.resolve(destination))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
