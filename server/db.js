'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const isProd = process.env.NODE_ENV === 'production';
const DATA_DIR = process.env.DATA_DIR
  || process.env.RAILWAY_VOLUME_MOUNT_PATH
  || path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'slate.json');
const SESSION_MS = 14 * 24 * 60 * 60 * 1000;

if (isProd && !process.env.DATA_DIR && !process.env.RAILWAY_VOLUME_MOUNT_PATH) {
  console.error('Slate: production needs a persistent disk. Set DATA_DIR or attach a volume.');
  process.exit(1);
}

const STEPS = [
  { n:1,  key:'profile',   t:'Develop the candidate profile', opt:false, needs:[] },
  { n:2,  key:'community', t:'Develop community and form-of-government profile', opt:false, needs:['profile'] },
  { n:3,  key:'brochure',  t:'Develop recruitment brochure', opt:false, needs:['profile','community'] },
  { n:4,  key:'ads',       t:'Develop recruitment advertisement', opt:false, needs:['profile','community'] },
  { n:5,  key:'survey1',   t:'Develop initial candidate survey', opt:false, needs:['profile'] },
  { n:6,  key:'plan',      t:'Develop recruitment and advertising locations', opt:false, needs:['ads'] },
  { n:7,  key:'guide',     t:'Develop interview questions and assessment scenarios', opt:false, needs:['profile'] },
  { n:8,  key:'survey2',   t:'Develop semifinalist survey', opt:true,  needs:['guide'] },
  { n:9,  key:'screen',    t:'Screen candidate surveys', opt:false, needs:['survey1'] },
  { n:10, key:'send2',     t:'Send semifinalist survey', opt:true,  needs:['survey2'] },
  { n:11, key:'finalists', t:'Select finalists', opt:false, needs:['screen'] },
  { n:12, key:'schedule',  t:'Develop finalist interview and assessment center process', opt:false, needs:['finalists','guide'] },
  { n:13, key:'contract',  t:'Develop model employment contract', opt:true,  needs:['finalists'] },
  { n:14, key:'bar',       t:'Develop annual executive performance evaluation process', opt:true,  needs:['profile'] }
];

function seedUsers(){
  const abePin = process.env.SLATE_PIN_ABE || (isProd ? '' : '2468');
  const mikePin = process.env.SLATE_PIN_MIKE || (isProd ? '' : '1357');
  if (!abePin || !mikePin) {
    console.error('Slate: first boot needs SLATE_PIN_ABE and SLATE_PIN_MIKE.');
    process.exit(1);
  }
  return [
    { id:'u1', email: process.env.SLATE_EMAIL_ABE || 'abe@slate.local',  pin: String(abePin), name:'Abe Macy',     init:'AM', role:'consultant', title:'Operations' },
    { id:'u2', email: process.env.SLATE_EMAIL_MIKE || 'mike@slate.local', pin: String(mikePin), name:'Mike Letcher', init:'ML', role:'consultant', title:'Search consultant' }
  ];
}

function now(){ return new Date().toISOString(); }
function nid(prefix){ return prefix + '-' + crypto.randomBytes(4).toString('hex'); }

function blankSearch(input, user){
  return {
    id: nid('sr'),
    no: null,
    client: input.client || '',
    position: input.position || '',
    state: input.state || '',
    website: input.website || '',
    fog: input.fog || 'Council–Manager',
    population: input.population || '',
    budget: input.budget || '',
    salary: input.salary || '',
    opened: input.opened || now().slice(0,10),
    firstReview: input.firstReview || '',
    notes: input.notes || '',
    research: null,
    aiUsage: { input_tokens: 0, output_tokens: 0 },
    createdBy: user.id,
    createdAt: now(),
    updatedAt: now(),
    criteria: [],
    artifacts: {},
    candidates: [],
    scores: {},
    notesBy: {},
    released: false,
    activity: [{ at: now(), who: user.name, x: 'opened the search' }]
  };
}

function load(){
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    const db = { users: seedUsers(), sessions: {}, searches: [], seq: 0 };
    save(db);
    return db;
  }
  const loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  // Backfill sessions written before `exp` existed, so every session object
  // always carries it and callers never need a per-request fallback.
  for (const sess of Object.values(loaded.sessions || {})) {
    if (!sess.exp) sess.exp = Date.parse(sess.at || '') + SESSION_MS;
  }
  return loaded;
}

function save(db){
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  try { fs.renameSync(tmp, DATA_FILE); }
  catch {
    fs.copyFileSync(tmp, DATA_FILE);
    fs.unlinkSync(tmp);
  }
}

let db = load();

function persist(){ save(db); }

function publicUser(u){
  if (!u) return null;
  return { id:u.id, email:u.email, name:u.name, init:u.init, role:u.role, title:u.title };
}

const SIMPLE_ARTIFACT_STEPS = new Set(['community','brochure','ads','survey1','plan','guide','survey2','schedule','contract','bar']);

function stepStatus(search, step, cache){
  if (cache && cache.has(step.key)) return cache.get(step.key);
  const a = search.artifacts || {};
  let status;
  if (SIMPLE_ARTIFACT_STEPS.has(step.key)) {
    status = a[step.key] ? 'done' : 'open';
  } else {
    const crit = (search.criteria || []).filter(c => c && String(c.label||'').trim());
    const cands = search.candidates || [];
    switch (step.key){
      case 'profile': {
        const countKind = k => crit.filter(c => c.kind === k).length;
        const inRange = n => n >= 3 && n <= 5;
        const profileReady = ['skill','trait','chall','opp'].every(k => inRange(countKind(k)));
        status = profileReady ? 'done' : (crit.length ? 'now' : 'open');
        break;
      }
      case 'screen': {
        const scored = cands.filter(c => Object.values(search.scores||{}).some(u => u[c.id]));
        const semis = cands.filter(c => c.stage === 'semifinalist' || c.stage === 'finalist');
        status = (semis.length && search.released) ? 'done' : (scored.length || cands.length ? 'now' : 'open');
        break;
      }
      case 'send2': {
        const sent2 = cands.filter(c => c.survey2SentAt);
        status = sent2.some(c => c.survey2) ? 'done' : (sent2.length ? 'now' : 'open');
        break;
      }
      case 'finalists': status = cands.some(c=>c.stage==='finalist') ? 'done' : 'open'; break;
      default: status = 'open';
    }
  }
  if (cache) cache.set(step.key, status);
  return status;
}

function blocked(search, step, cache){
  return (step.needs||[]).some(k => {
    const need = STEPS.find(s=>s.key===k);
    return need && stepStatus(search, need, cache) !== 'done';
  });
}

function decorate(search, viewer){
  const cache = new Map();
  const steps = STEPS.map(s => {
    const status = stepStatus(search, s, cache);
    const lock = blocked(search, s, cache);
    return { ...s, status: lock && status!=='done' ? 'idle' : status, blocked: lock && status!=='done' };
  });
  const done = steps.filter(s=>s.status==='done').length;
  const next = steps.find(s=>!s.blocked && s.status!=='done') || steps.find(s=>s.status!=='done');
  const out = { ...search, steps, progress:{ done, total: STEPS.length, next } };
  if (viewer && !search.released) {
    const uid = viewer.id;
    out.scores = { [uid]: (search.scores || {})[uid] || {} };
    out.notesBy = { [uid]: (search.notesBy || {})[uid] || {} };
  }
  return out;
}

function nextNo(){
  db.seq = (db.seq||0) + 1;
  return 'SR-' + new Date().getFullYear() + '-' + String(db.seq).padStart(3,'0');
}

module.exports = {
  STEPS, nid, now, persist, DATA_DIR, SESSION_MS,
  get db(){ return db; },
  publicUser,
  decorate,
  nextNo,
  blankSearch,
  findUserById: id => db.users.find(u=>u.id===id),
  findUserByEmail: email => db.users.find(u=>u.email.toLowerCase()===String(email||'').toLowerCase()),
  findSearch: id => db.searches.find(s=>s.id===id),
  findByInvite(token){
    for (const s of db.searches) {
      const c = s.candidates.find(x=>x.invite===token);
      if (c) return { search: s, candidate: c };
    }
    return null;
  },
  touch(search, user, x){
    search.updatedAt = now();
    if (x) search.activity.unshift({ at: now(), who: user.name, x });
    if (search.activity.length > 40) search.activity.length = 40;
  }
};
