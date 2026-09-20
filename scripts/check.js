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
const roots = ['server', 'scripts', 'tests', 'public', 'content'];
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

// ---------------------------------------------------------------------------
// Second gate: does the image contain what the server requires?
//
// The Dockerfile copies named paths rather than the working tree, so a new
// top-level directory reaches production only if somebody remembers to add a
// COPY for it. content/ was not added, and nothing caught it: every local
// suite runs against the working tree, where the file is plainly there. The
// container built, then refused to boot on a module it could not find.
//
// This is the same family as the syntax gate above — a failure that surfaces
// only once the code is packaged — and it costs a file read rather than a
// container build.
// ---------------------------------------------------------------------------

const dockerfile = path.join(root, 'Dockerfile');
const packaging = [];

if (fs.existsSync(dockerfile)) {
  const copied = [];
  for (const line of fs.readFileSync(dockerfile, 'utf8').split('\n')) {
    const match = /^\s*COPY\s+(.+)$/.exec(line);
    if (!match) continue;
    const parts = match[1].trim().split(/\s+/).filter(p => !p.startsWith('--'));
    // The last token is the destination inside the image; the rest are sources.
    for (const source of parts.slice(0, -1)) copied.push(source.replace(/^\.\//, ''));
  }

  const shipped = source => copied.some(c => c === source || source.startsWith(c + '/'));

  // Only the files the image actually runs are in scope. Tests and the rest of
  // scripts/ are deliberately not shipped, so requires made from them say
  // nothing about the image.
  const runtime = files.filter(shipped);

  for (const file of runtime) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const [, specifier] of source.matchAll(/require\(\s*['"](\.\.[^'"]*)['"]\s*\)/g)) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      if (resolved.startsWith('..')) continue;
      const target = fs.existsSync(path.join(root, resolved)) ? resolved : resolved + '.js';
      if (!fs.existsSync(path.join(root, target))) continue; // a broken require is the syntax gate's business, not this one
      if (!shipped(target)) {
        packaging.push(file + ' requires ' + target + ', which no COPY in the Dockerfile puts in the image');
      }
    }
  }
}

for (const failure of packaging) console.error('FAIL ' + failure);
console.log(packaging.length
  ? packaging.length + ' runtime requires are missing from the image'
  : 'every runtime require is in the image');

process.exitCode = failures.length || packaging.length ? 1 : 0;
