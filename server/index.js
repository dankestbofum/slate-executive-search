'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const db = require('./db');
const ai = require('./ai');
const {
  assembleBrochure, applyBrochureDefaults, packTheme, packScheme,
  PLACE_FIELDS, GOV_FIELDS, PACK_THEMES, PACK_SCHEMES
} = require('./brochure');

const app = express();
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
const COOKIE = 'slate_sid';
const isProd = process.env.NODE_ENV === 'production';
const showDemoLogins = process.env.SHOW_DEMO_LOGINS === 'true'
  || (!isProd && process.env.SHOW_DEMO_LOGINS !== 'false');
const NON_ARTIFACT_STEPS = new Set(['profile', 'screen', 'send2', 'finalists']);
const ARTIFACTS = new Set(db.STEPS.map(s => s.key).filter(k => !NON_ARTIFACT_STEPS.has(k)));

app.set('trust proxy', 1);
app.use(express.json({ limit: '8mb' }));
const PHOTO_SLOTS = new Set(['cover', 'place', 'org']);
const PHOTO_FILE_RE = new RegExp('^(' + [...PHOTO_SLOTS].join('|') + ')\\.jpg$', 'i');
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

const SESSION_MS = db.SESSION_MS;
const loginHits = new Map();

function clientIp(req){
  return String(req.ip || req.socket?.remoteAddress || 'unknown');
}

function loginBlocked(ip){
  const now = Date.now();
  const row = loginHits.get(ip);
  if (!row) return false;
  if (row.until && now < row.until) return true;
  if (row.until && now >= row.until) loginHits.delete(ip);
  return false;
}

function loginFail(ip){
  const now = Date.now();
  const row = loginHits.get(ip) || { n: 0, until: 0, ts: now };
  if (row.until && now >= row.until) { row.n = 0; row.until = 0; }
  row.n += 1;
  row.ts = now;
  if (row.n >= 8) row.until = now + 15 * 60 * 1000;
  loginHits.set(ip, row);
}

function loginOk(ip){ loginHits.delete(ip); }

const LOGIN_HITS_IDLE_MS = 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [ip, row] of loginHits) {
    if (!row.until && now - row.ts > LOGIN_HITS_IDLE_MS) loginHits.delete(ip);
  }
}, 15 * 60 * 1000).unref();

function painted(req, search){
  return db.decorate(search, req.user);
}

function claudeFail(err){
  if (err.code === 'NO_KEY') return { status: 503, error: err.message };
  if (err.code === 'BAD_KIND' || err.code === 'BAD_URL' || err.code === 'BAD_JSON') {
    return { status: 400, error: err.message };
  }
  if (err.code === 'AUTH_ERROR') {
    return { status: 503, error: 'The Anthropic API key is invalid or expired. Update ANTHROPIC_API_KEY and try again.' };
  }
  if (err.code === 'RATE_LIMIT') {
    return { status: 429, error: 'Claude is rate-limited. Wait a minute and try again.' };
  }
  // Defense in depth for an SDK error that reached here unnormalized (ai.js
  // normalizes the calls it makes into the codes above).
  const status = err.status || err.statusCode;
  if (status === 401) return { status: 503, error: 'The Anthropic API key is invalid or expired. Update ANTHROPIC_API_KEY and try again.' };
  if (status === 429) return { status: 429, error: 'Claude is rate-limited. Wait a minute and try again.' };
  return { status: 500, error: err.message || 'Request failed.' };
}

function sid(){ return crypto.randomBytes(24).toString('hex'); }

function cookieOpts(){
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    maxAge: SESSION_MS
  };
}

function currentUser(req){
  const id = req.cookies[COOKIE];
  const sess = id && db.db.sessions[id];
  if (!sess) return null;
  if (Number.isFinite(sess.exp) && Date.now() > sess.exp) {
    delete db.db.sessions[id];
    db.persist();
    return null;
  }
  return db.findUserById(sess.userId);
}

function requireUser(req, res, next){
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error:'Sign in required.' });
  req.user = u;
  next();
}

function clampWeight(w){
  const n = (w === '' || w === null || w === undefined) ? 3 : Number(w);
  return Math.max(1, Math.min(5, Number.isFinite(n) ? n : 3));
}

function requireSearch(req, res, next){
  const s = db.findSearch(req.params.id);
  if (!s) return res.status(404).json({ error:'Search not found.' });
  req.search = s;
  next();
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/config', (_req, res) => {
  const body = {
    demoLogins: showDemoLogins,
    communityFields: { place: PLACE_FIELDS, gov: GOV_FIELDS },
    packThemes: PACK_THEMES,
    packSchemes: PACK_SCHEMES
  };
  if (showDemoLogins) {
    body.accounts = db.db.users.map(u => ({
      email: u.email, pin: u.pin, name: u.name, title: u.title
    }));
  }
  res.json(body);
});

app.post('/api/login', (req, res) => {
  const ip = clientIp(req);
  if (loginBlocked(ip)) {
    return res.status(429).json({ error:'Too many sign-in attempts. Wait a few minutes.' });
  }
  const { email, pin } = req.body || {};
  const u = db.findUserByEmail(email);
  if (!u || String(pin) !== u.pin) {
    loginFail(ip);
    return res.status(401).json({ error:'Email or PIN is not right.' });
  }
  loginOk(ip);
  const id = sid();
  db.db.sessions[id] = { userId: u.id, at: db.now(), exp: Date.now() + SESSION_MS };
  db.persist();
  res.cookie(COOKIE, id, cookieOpts());
  res.json({ user: db.publicUser(u) });
});

app.post('/api/logout', (req, res) => {
  const id = req.cookies[COOKIE];
  if (id) delete db.db.sessions[id];
  db.persist();
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: isProd, path: '/' });
  res.json({ ok: true });
});

app.get('/api/me', requireUser, (req, res) => {
  res.json({
    user: db.publicUser(req.user),
    users: db.db.users.map(db.publicUser),
    health: {
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-5',
      premium: process.env.CLAUDE_MODEL_PREMIUM || 'claude-opus-5',
      hasKey: Boolean(process.env.ANTHROPIC_API_KEY)
    }
  });
});

app.get('/api/searches', requireUser, (_req, res) => {
  res.json(db.db.searches.map(s => {
    const d = db.decorate(s);
    return {
      id:s.id, no:s.no, client:s.client, position:s.position, state:s.state,
      fog:s.fog, opened:s.opened, updatedAt:s.updatedAt,
      progress: d.progress
    };
  }).sort((a,b)=> (b.updatedAt||'').localeCompare(a.updatedAt||'')));
});

app.post('/api/searches', requireUser, (req, res) => {
  if (req.user.role !== 'consultant') return res.status(403).json({ error:'The consultant opens a search.' });
  const body = req.body || {};
  if (!String(body.client || '').trim() || !String(body.position || '').trim()) {
    return res.status(400).json({ error:'Client and position are required.' });
  }
  const s = db.blankSearch(body, req.user);
  s.no = db.nextNo();
  db.db.searches.unshift(s);
  db.persist();
  res.json(painted(req, s));
});

app.get('/api/searches/:id', requireUser, requireSearch, (req, res) => {
  res.json(painted(req, req.search));
});

app.delete('/api/searches/:id', requireUser, requireSearch, (req, res) => {
  if (req.user.role !== 'consultant') return res.status(403).json({ error:'The consultant deletes a search.' });
  const media = path.join(db.DATA_DIR, 'media', req.search.id);
  fs.rmSync(media, { recursive: true, force: true });
  db.db.searches = db.db.searches.filter(s => s.id !== req.search.id);
  db.persist();
  res.json({ ok:true, id: req.search.id });
});

const PATCH_FIELDS = [
  'client', 'position', 'state', 'website', 'fog', 'population', 'budget', 'salary', 'opened', 'firstReview', 'notes',
  { key: 'released', role: 'consultant', roleError: 'The consultant releases scores.' }
];

app.patch('/api/searches/:id', requireUser, requireSearch, (req, res) => {
  const body = req.body || {};
  for (const f of PATCH_FIELDS) {
    if (typeof f !== 'object' || !f.role) continue;
    if (f.key in body && req.user.role !== f.role) {
      return res.status(403).json({ error: f.roleError });
    }
  }
  for (const f of PATCH_FIELDS) {
    const key = typeof f === 'string' ? f : f.key;
    if (key in body) req.search[key] = body[key];
  }
  db.touch(req.search, req.user, 'updated search facts');
  db.persist();
  res.json(painted(req, req.search));
});

app.put('/api/searches/:id/profile', requireUser, requireSearch, (req, res) => {
  const criteria = Array.isArray(req.body?.criteria) ? req.body.criteria : [];
  req.search.criteria = criteria.map((c,i) => ({
    id: c.id || ('X'+(i+1)),
    kind: c.kind || 'skill',
    label: String(c.label||'').trim(),
    weight: clampWeight(c.weight),
    note: String(c.note||'')
  })).filter(c=>c.label);
  db.touch(req.search, req.user, 'saved the candidate profile');
  db.persist();
  res.json(painted(req, req.search));
});

app.put('/api/searches/:id/artifact/:key', requireUser, requireSearch, (req, res) => {
  if (!ARTIFACTS.has(req.params.key)) return res.status(400).json({ error:'Unknown artifact.' });
  const incoming = req.body?.body ?? req.body;
  if (req.params.key === 'brochure') {
    const prev = req.search.artifacts.brochure || {};
    const next = incoming && typeof incoming === 'object' ? incoming : {};
    req.search.artifacts.brochure = applyBrochureDefaults(next, prev);
  } else {
    req.search.artifacts[req.params.key] = incoming;
  }
  db.touch(req.search, req.user, 'saved '+req.params.key);
  db.persist();
  res.json(painted(req, req.search));
});

app.post('/api/searches/:id/assemble', requireUser, requireSearch, (req, res) => {
  const kind = req.body?.kind;
  if (kind !== 'brochure') return res.status(400).json({ error:'Unknown assemble kind.' });
  const community = req.search.artifacts.community;
  if (!community || typeof community !== 'object') {
    return res.status(400).json({ error:'Finish the community profile first.' });
  }
  req.search.artifacts.brochure = assembleBrochure(req.search);
  db.touch(req.search, req.user, 'filled the brochure from the community file');
  db.persist();
  res.json(painted(req, req.search));
});

function photoDir(searchId){
  return path.join(db.DATA_DIR, 'media', searchId);
}

function wipeSlotFiles(dir, slot){
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith(slot + '.')) fs.unlinkSync(path.join(dir, f));
  }
}

app.post('/api/searches/:id/media', requireUser, requireSearch, (req, res) => {
  const slot = String(req.body?.slot || '');
  if (!PHOTO_SLOTS.has(slot)) return res.status(400).json({ error:'Unknown photo slot.' });
  const dataUrl = String(req.body?.data || '');
  const m = dataUrl.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/]+=*)$/);
  if (!m) return res.status(400).json({ error:'Send a JPEG photo.' });
  const buf = Buffer.from(m[1], 'base64');
  if (!buf.length) return res.status(400).json({ error:'That photo is empty.' });
  if (buf.length > 6 * 1024 * 1024) return res.status(400).json({ error:'That photo is too large.' });
  const dir = photoDir(req.search.id);
  fs.mkdirSync(dir, { recursive: true });
  wipeSlotFiles(dir, slot);
  const file = slot + '.jpg';
  fs.writeFileSync(path.join(dir, file), buf);
  const brochure = req.search.artifacts.brochure || {};
  brochure.photos = { ...(brochure.photos || {}), [slot]: '/media/' + req.search.id + '/' + file + '?v=' + Date.now() };
  brochure.theme = packTheme(brochure.theme);
  brochure.scheme = packScheme(brochure.scheme);
  req.search.artifacts.brochure = brochure;
  db.touch(req.search, req.user, 'added the ' + slot + ' photo');
  db.persist();
  res.json(painted(req, req.search));
});

app.delete('/api/searches/:id/media/:slot', requireUser, requireSearch, (req, res) => {
  const slot = String(req.params.slot || '');
  if (!PHOTO_SLOTS.has(slot)) return res.status(400).json({ error:'Unknown photo slot.' });
  wipeSlotFiles(photoDir(req.search.id), slot);
  const brochure = req.search.artifacts.brochure || {};
  const photos = { ...(brochure.photos || {}) };
  delete photos[slot];
  brochure.photos = photos;
  req.search.artifacts.brochure = brochure;
  db.touch(req.search, req.user, 'removed the ' + slot + ' photo');
  db.persist();
  res.json(painted(req, req.search));
});

app.get('/media/:id/:file', requireUser, requireSearch, (req, res) => {
  const file = path.basename(String(req.params.file || ''));
  if (!PHOTO_FILE_RE.test(file)) return res.status(404).end();
  const dir = photoDir(req.search.id);
  const abs = path.resolve(path.join(dir, file));
  const root = path.resolve(dir);
  if (!abs.startsWith(root + path.sep)) return res.status(404).end();
  if (!fs.existsSync(abs)) return res.status(404).end();
  res.type('image/jpeg');
  res.sendFile(abs);
});


app.post('/api/searches/:id/generate', requireUser, requireSearch, async (req, res) => {
  const kind = req.body?.kind;
  const premium = Boolean(req.body?.premium);
  try {
    const out = await ai.generate(kind, req.search, { premium, notes: req.body?.notes||'' });
    if (!db.findSearch(req.search.id)) {
      return res.status(409).json({ error:'This search was deleted while the draft was generating.' });
    }
    if (kind === 'profile') {
      req.search.criteria = (out.json.criteria||[]).map((c,i)=>({
        id: c.id || ('X'+(i+1)),
        kind: c.kind,
        label: c.label,
        weight: clampWeight(c.weight),
        note: c.note||''
      }));
      db.touch(req.search, req.user, 'drafted the profile with '+out.model);
    } else {
      const prev = req.search.artifacts[kind] || {};
      req.search.artifacts[kind] = out.json;
      if (kind === 'brochure') {
        const next = req.search.artifacts.brochure || {};
        req.search.artifacts.brochure = applyBrochureDefaults(next, prev, { preferPrev: true });
      }
      db.touch(req.search, req.user, 'drafted '+kind+' with '+out.model);
    }
    req.search.aiUsage = ai.addUsage(req.search.aiUsage, out.usage);
    db.persist();
    res.json({ search: painted(req, req.search), model: out.model, usage: out.usage });
  } catch (err) {
    const fail = claudeFail(err);
    res.status(fail.status).json({ error: fail.error });
  }
});

app.post('/api/searches/:id/research', requireUser, requireSearch, async (req, res) => {
  const body = req.body || {};
  const city = String(Object.prototype.hasOwnProperty.call(body, 'city') ? body.city : (req.search.client || '')).trim();
  const website = String(Object.prototype.hasOwnProperty.call(body, 'website') ? body.website : (req.search.website || '')).trim();
  const premium = Boolean(body.premium);
  if (!city) return res.status(400).json({ error:'Enter the city or jurisdiction name.' });
  if (!website) return res.status(400).json({ error:'Enter the official city website.' });
  try {
    const out = await ai.researchCity({
      city, website, premium,
      position: req.search.position,
      state: req.search.state
    });
    if (!db.findSearch(req.search.id)) {
      return res.status(409).json({ error:'This search was deleted while research was running.' });
    }
    const facts = (out.json && out.json.facts) || {};
    req.search.website = website;
    if (facts.client) req.search.client = facts.client;
    else if (!req.search.client) req.search.client = city;
    for (const k of ['state','fog','population','budget','salary']) {
      if (facts[k]) req.search[k] = facts[k];
    }
    if (facts.notes) {
      const mark = '— From city research —';
      const incoming = facts.notes;
      const base = String(req.search.notes || '').split(mark)[0].trim();
      req.search.notes = base ? base + '\n\n' + mark + '\n' + incoming : incoming;
    }
    const community = out.json.community || {};
    if (community.lede || community.government || community.community || community.organization || community.why || (community.facts||[]).length) {
      req.search.artifacts.community = community;
    }
    req.search.research = {
      at: db.now(),
      city,
      website,
      sources: out.sources || [],
      model: out.model
    };
    db.touch(req.search, req.user, 'researched '+city+' from the city website');
    req.search.aiUsage = ai.addUsage(req.search.aiUsage, out.usage);
    db.persist();
    res.json({ search: painted(req, req.search), model: out.model, usage: out.usage });
  } catch (err) {
    const fail = claudeFail(err);
    res.status(fail.status).json({ error: fail.error });
  }
});

app.post('/api/searches/:id/candidates', requireUser, requireSearch, (req, res) => {
  const b = req.body || {};
  const c = {
    id: db.nid('C'),
    name: String(b.name||'').trim(),
    cur: String(b.cur||'').trim(),
    org: String(b.org||'').trim(),
    yrs: Number(b.yrs)||0,
    email: String(b.email||'').trim(),
    stage: 'applicant',
    invite: crypto.randomBytes(9).toString('hex'),
    survey1: null,
    survey2: null,
    survey2SentAt: null,
    survey2Deadline: '',
    addedAt: db.now()
  };
  if (!c.name) return res.status(400).json({ error:'Name is required.' });
  req.search.candidates.push(c);
  db.touch(req.search, req.user, 'added '+c.name);
  db.persist();
  res.json(painted(req, req.search));
});

app.patch('/api/searches/:id/candidates/:cid', requireUser, requireSearch, (req, res) => {
  const c = req.search.candidates.find(x=>x.id===req.params.cid);
  if (!c) return res.status(404).json({ error:'Candidate not found.' });
  const body = req.body || {};
  if ('stage' in body) {
    if (req.user.role !== 'consultant') return res.status(403).json({ error:'The consultant advances candidates.' });
    const ok = ['applicant','semifinalist','finalist','declined'];
    if (!ok.includes(body.stage)) return res.status(400).json({ error:'Unknown stage.' });
  }
  const allow = ['name','cur','org','yrs','email','stage'];
  for (const k of allow) if (k in body) c[k] = body[k];
  db.touch(req.search, req.user, 'updated '+c.name);
  db.persist();
  res.json(painted(req, req.search));
});

function isSemifinalistOrFinalist(c){
  return c.stage === 'semifinalist' || c.stage === 'finalist';
}

function sendSurvey2(search, candidate, deadline, user){
  if (!isSemifinalistOrFinalist(candidate)) {
    const err = new Error('Advance '+candidate.name+' to semifinalist before sending the second survey.');
    err.status = 400;
    throw err;
  }
  if (!search.artifacts.survey2) {
    const err = new Error('Develop the semifinalist survey first.');
    err.status = 400;
    throw err;
  }
  candidate.survey2SentAt = db.now();
  if (deadline != null) candidate.survey2Deadline = String(deadline);
  db.touch(search, user, 'sent the semifinalist survey to '+candidate.name);
}

app.post('/api/searches/:id/candidates/:cid/send2', requireUser, requireSearch, (req, res) => {
  if (req.user.role !== 'consultant') return res.status(403).json({ error:'The consultant sends the semifinalist survey.' });
  const c = req.search.candidates.find(x=>x.id===req.params.cid);
  if (!c) return res.status(404).json({ error:'Candidate not found.' });
  try {
    sendSurvey2(req.search, c, req.body?.deadline, req.user);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  db.persist();
  res.json(painted(req, req.search));
});

app.post('/api/searches/:id/send2', requireUser, requireSearch, (req, res) => {
  if (req.user.role !== 'consultant') return res.status(403).json({ error:'The consultant sends the semifinalist survey.' });
  const deadline = req.body?.deadline;
  const eligible = req.search.candidates.filter(isSemifinalistOrFinalist);
  if (!eligible.length) return res.status(400).json({ error:'Advance at least one candidate to semifinalist first.' });
  try {
    for (const c of eligible) sendSurvey2(req.search, c, deadline, req.user);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  db.persist();
  res.json(painted(req, req.search));
});

app.put('/api/searches/:id/scores/:cid', requireUser, requireSearch, (req, res) => {
  const c = req.search.candidates.find(x=>x.id===req.params.cid);
  if (!c) return res.status(404).json({ error:'Candidate not found.' });
  if (!req.search.scores[req.user.id]) req.search.scores[req.user.id] = {};
  req.search.scores[req.user.id][c.id] = req.body?.scores || {};
  if (req.body?.note != null) {
    if (!req.search.notesBy[req.user.id]) req.search.notesBy[req.user.id] = {};
    req.search.notesBy[req.user.id][c.id] = String(req.body.note);
  }
  db.touch(req.search, req.user, 'scored '+c.name);
  db.persist();
  res.json(painted(req, req.search));
});

app.get('/api/apply/:token', (req, res) => {
  const found = db.findByInvite(req.params.token);
  if (found) {
    const { search: s, candidate: c } = found;
    const sent2 = Boolean(c.survey2SentAt);
    return res.json({
      token: req.params.token,
      client: s.client,
      position: s.position,
      candidate: { name:c.name, id:c.id },
      survey1: s.artifacts.survey1 || null,
      survey2: sent2 ? (s.artifacts.survey2 || null) : null,
      submitted1: Boolean(c.survey1),
      submitted2: Boolean(c.survey2),
      sent2,
      deadline2: c.survey2Deadline || ''
    });
  }
  res.status(404).json({ error:'This link is not valid.' });
});

app.post('/api/apply/:token', (req, res) => {
  const found = db.findByInvite(req.params.token);
  if (found) {
    const { search: s, candidate: c } = found;
    const which = req.body?.which === 'survey2' ? 'survey2' : 'survey1';
    if (!s.artifacts[which]) {
      return res.status(400).json({ error:'This survey is not open yet.' });
    }
    if (which === 'survey2' && !c.survey2SentAt) {
      return res.status(400).json({ error:'The search team has not sent this questionnaire yet.' });
    }
    if (c[which]) {
      return res.status(409).json({ error:'This questionnaire was already submitted.' });
    }
    c[which] = { at: db.now(), answers: req.body?.answers || {} };
    s.activity.unshift({ at: db.now(), who: c.name, x: 'submitted the '+which+' questionnaire' });
    db.persist();
    return res.json({ ok:true });
  }
  res.status(404).json({ error:'This link is not valid.' });
});

app.get('/apply/:token', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log('Slate listening on http://'+HOST+':'+PORT);
  console.log('Default model:', process.env.CLAUDE_MODEL || 'claude-sonnet-5');
  console.log('API key:', process.env.ANTHROPIC_API_KEY ? 'present' : 'MISSING — set ANTHROPIC_API_KEY');
});
