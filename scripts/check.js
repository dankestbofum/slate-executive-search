'use strict';

// Parses every first-party JavaScript file without running it. This is the
// cheap gate: it catches a syntax error in a file the test suite happens not
// to require, which would otherwise only surface when a route is first hit in
// production. Deliberately not a linter; it has no configuration and no
// dependencies.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const roots = ['server', 'scripts', 'tests', 'public'];
const skip = new Set(['node_modules', 'data', '.git']);

function collect(directory) {
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap(entry => {
    if (skip.has(entry.name)) return [];
    const relative = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) return collect(relative);
    return entry.name.endsWith('.js') ? [relative] : [];
  });
}

const files = roots.flatMap(collect).sort();
const failures = [];

for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  try {
    // Browser files are not CommonJS modules, so compile them as bare scripts
    // rather than wrapping them the way require() would.
    new vm.Script(source, { filename: file });
  } catch (error) {
    failures.push(file + ': ' + error.message);
  }
}

for (const failure of failures) console.error('FAIL ' + failure);
console.log(files.length + ' files parsed, ' + failures.length + ' failed');
process.exitCode = failures.length ? 1 : 0;
