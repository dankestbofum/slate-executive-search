'use strict';

// CI helper for the container restart check. It deliberately uses a named,
// synthetic record so the assertion proves representative fields and media
// survived, rather than merely proving that a JSON file still exists.

const fs = require('fs');
const path = require('path');

const [action, rootArg] = process.argv.slice(2);
const root = path.resolve(rootArg || process.env.DATA_DIR || '');
const storeFile = path.join(root, 'slate.json');
const searchId = 'sr-container-persistence';
const photoName = 'cover.0123456789abcdef.jpg';
const photoFile = path.join(root, 'media', searchId, photoName);
const photoBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x53, 0x4c, 0x41, 0x54, 0x45, 0xff, 0xd9]);

function fail(message) {
  console.error('FAIL: ' + message);
  process.exit(1);
}

function readStore() {
  if (!fs.existsSync(storeFile)) fail('store does not exist at ' + storeFile);
  try { return JSON.parse(fs.readFileSync(storeFile, 'utf8')); }
  catch (error) { fail('store is not valid JSON: ' + error.message); }
}

function fixture() {
  return {
    id: searchId,
    no: 'SR-CI-PERSIST',
    organizationId: 'org_ci_persistence',
    client: 'Synthetic Persistence County',
    jurisdictionType: 'county',
    position: 'County Manager',
    package: 'executive',
    state: 'Arizona',
    website: 'https://example.gov',
    fog: 'Council-manager',
    population: '42,000',
    budget: '$84 million',
    salary: '$180,000 to $210,000',
    opened: '2026-09-16',
    firstReview: '2026-10-01',
    notes: 'Synthetic CI fixture; never a live candidate record.',
    createdBy: 'u1',
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
    members: [{ userId: 'u1', searchRole: 'manager', addedAt: '2026-09-16T00:00:00.000Z', addedBy: 'u1' }],
    team: { confirmedAt: '2026-09-16T00:00:00.000Z', confirmedBy: 'u1' },
    intake: { status: 'closed', dueBy: '', prompt: '', openedAt: null, closedAt: '2026-09-16T00:00:00.000Z', submissions: {} },
    criteria: [{ id: 'S1', kind: 'skill', label: 'Public budgeting', weight: 5, note: 'Synthetic criterion.' }],
    artifacts: { brochure: { photos: { cover: '/media/' + searchId + '/' + photoName }, lede: 'Synthetic brochure.' } },
    staff: {}, reviews: {},
    candidates: [{
      id: 'C-CI-1', name: 'Synthetic Candidate', email: 'synthetic@example.test', stage: 'semifinalist', invite: null,
      survey1: {
        at: '2026-09-16T00:00:00.000Z', version: 'ci-version', digest: 'ci-digest',
        answers: { q1: 'A synthetic answer that must survive restart.' },
        survey: { intro: 'Synthetic.', questions: [{ n: 1, prompt: 'Original synthetic question?', required: true }] }
      }
    }],
    scores: { u1: { 'C-CI-1': { S1: 4 } } },
    notesBy: {}, released: false,
    history: [{ kind: 'score', at: '2026-09-16T00:00:00.000Z', who: 'Abe Macy', candidateId: 'C-CI-1', body: { S1: 3 } }],
    activity: [{ at: '2026-09-16T00:00:00.000Z', who: 'Abe Macy', by: 'u1', role: 'consultant', x: 'created the synthetic persistence fixture' }]
  };
}

function seed() {
  const store = readStore();
  store.searches ||= [];
  store.searches = store.searches.filter(search => search.id !== searchId);
  store.searches.push(fixture());
  fs.mkdirSync(path.dirname(photoFile), { recursive: true });
  fs.writeFileSync(photoFile, photoBytes);
  const temp = storeFile + '.ci.tmp';
  fs.writeFileSync(temp, JSON.stringify(store, null, 2));
  fs.renameSync(temp, storeFile);
  console.log('Seeded representative search, response, score, history and media.');
}

function verify() {
  const store = readStore();
  const search = (store.searches || []).find(row => row.id === searchId);
  if (!search) fail('representative search did not survive restart');
  if (search.client !== 'Synthetic Persistence County') fail('search facts changed');
  if (search.candidates?.[0]?.survey1?.answers?.q1 !== 'A synthetic answer that must survive restart.') fail('candidate answer changed');
  if (search.candidates?.[0]?.survey1?.survey?.questions?.[0]?.prompt !== 'Original synthetic question?') fail('original question changed');
  if (search.scores?.u1?.['C-CI-1']?.S1 !== 4) fail('score changed');
  if (search.history?.[0]?.body?.S1 !== 3) fail('history changed');
  if (!fs.existsSync(photoFile) || !fs.readFileSync(photoFile).equals(photoBytes)) fail('brochure media changed or disappeared');
  console.log('Verified representative search, response, original question, score, history and media after restart.');
}

if (action === 'seed') seed();
else if (action === 'verify') verify();
else fail('usage: node scripts/container-persistence.js <seed|verify> <data-dir>');
