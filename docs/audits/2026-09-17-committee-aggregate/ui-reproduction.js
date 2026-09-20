'use strict';

// Run real rendering helpers in isolation. This checks their decisions, not
// browser layout or assistive-technology behavior.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
function extract(name) {
  const match = source.match(new RegExp('^(?:async )?function ' + name + '\\([^]*?^}', 'm'));
  assert.ok(match, 'Missing function ' + name);
  return match[0];
}
const context = {
  state: { search: { consensus: { submitted: 3, byKind: {
    skill: [{ label: 'Financial management', mentions: 3, contested: true }]
  } } } },
  esc: value => String(value ?? ''),
  pill: (tone, label) => `<span class="${tone}">${label}</span>`
};
vm.createContext(context);
vm.runInContext(['consensusFor', 'critSource', 'intakeRow'].map(extract).join('\n'), context);
const criterion = { kind: 'skill', label: 'Financial management', from: 'committee' };
const before = context.critSource(criterion);
const renamed = context.critSource({ ...criterion, label: 'Financial management and budgeting' });
const punctuation = context.critSource({ ...criterion, label: 'Financial management.' });
assert.match(before, /Contested/);
assert.match(renamed, /Yours/);
assert.match(punctuation, /Yours/);
const manual = context.critSource({ ...criterion, from: 'consultant' });
assert.match(manual, /3 of 3/);
const row = context.intakeRow({ label: 'Financial management', weight: 3, note: '' }, 0);
const weightButtons = [...row.matchAll(/<button[^>]*data-iw="(\d)"[^>]*>([^<]*)<\/button>/g)].map(match => ({ weight: match[1], markup: match[0] }));
assert.equal(weightButtons.length, 5);
assert.ok(weightButtons.every(button => !/aria-label|aria-labelledby/.test(button.markup)));
const results = {
  recordedAt: new Date().toISOString(),
  runtime: process.version,
  method: 'Real public/app.js helpers extracted into node:vm; synthetic state and presentation-only stubs; no browser or network.',
  checks: [
    { id: 'UI-01', name: 'Renaming committee criterion loses support/contested badges and displays Yours', before, renamed, punctuation, result: 'reproduced' },
    { id: 'UI-02', name: 'Matching manual criterion receives committee support badge by label, regardless of from', manual, result: 'observed; label support is not provenance' },
    { id: 'UI-03', name: 'Weight buttons repeat numeric names without item-specific accessible labels', weightButtons, result: 'markup confirmed; not a screen-reader usability test' }
  ]
};
fs.writeFileSync(path.join(__dirname, 'ui-evidence.json'), JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify({ checks: results.checks.map(({ id, result }) => ({ id, result })) }, null, 2));
