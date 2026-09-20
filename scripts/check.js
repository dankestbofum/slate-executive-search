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

/* ------------------------------------------------------------------ *
 * Does everything the server loads actually ship in the image?
 *
 * The Dockerfile copies named paths rather than the whole tree, so a new
 * first-party directory is invisible to it until somebody adds a COPY line.
 * That failure has a nasty shape: the image builds, the tests pass, and the
 * container dies on its first require with the port never opening. It happened
 * with content/help — the user guide is content rather than code, which is
 * exactly why it was easy to leave out.
 *
 * So: read the COPY lines, follow every relative require reachable from the
 * server, and check each target lands inside one of them. Cheap, and it turns
 * a CI round trip into a one-line answer here.
 * ------------------------------------------------------------------ */
function shippedPaths() {
  const dockerfile = path.join(root, 'Dockerfile');
  if (!fs.existsSync(dockerfile)) return null;
  const copied = [];
  for (const line of fs.readFileSync(dockerfile, 'utf8').split('\n')) {
    if (!/^\s*COPY\s/i.test(line)) continue;
    // `COPY src... dest`, with any number of sources and optional flags. The
    // last token is the destination; everything before it is a source. Reading
    // only the first source is how `COPY package.json package-lock.json ./`
    // came out as "package.json is not in the image".
    const tokens = line.trim().split(/\s+/).slice(1).filter(t => !t.startsWith('--'));
    if (tokens.length < 2) continue;
    for (const source of tokens.slice(0, -1)) copied.push(source.replace(/^\.\//, ''));
  }
  return copied;
}

function resolveRequire(fromFile, target) {
  const base = path.resolve(path.dirname(path.join(root, fromFile)), target);
  for (const candidate of [base, base + '.js', base + '.json', path.join(base, 'index.js')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const shipped = shippedPaths();
if (shipped) {
  // Only the files the container actually loads. Tests and scripts that do not
  // ship are not in the image and are not expected to be.
  const runtime = files.filter(f => f.startsWith('server/'));
  const missing = new Set();
  for (const file of runtime) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of source.matchAll(/\brequire\(\s*'(\.[^']+)'\s*\)/g)) {
      const resolved = resolveRequire(file, match[1]);
      if (!resolved) continue; // a broken require is the parser's problem, not this check's
      const relative = path.relative(root, resolved).split(path.sep).join('/');
      const inImage = shipped.some(copy => relative === copy || relative.startsWith(copy + '/'));
      if (!inImage) missing.add(relative + '  (required by ' + file + ')');
    }
  }
  for (const entry of missing) {
    failures.push('not copied into the image by the Dockerfile: ' + entry);
  }
}

for (const failure of failures) console.error('FAIL ' + failure);
console.log(files.length + ' files parsed, ' + failures.length + ' failed');
process.exitCode = failures.length ? 1 : 0;
