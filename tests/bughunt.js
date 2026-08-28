'use strict';

/**
 * Live bug hunt for Slate. Hits the running server and unit-tests helpers.
 * Usage: node tests/bughunt.js
 */
const assert = require('assert');
const { publicUrl, fetchCitySite } = require('../server/site');
const { normalizeResearch, researchGaps } = require('../server/ai');
const { assembleBrochure } = require('../server/brochure');
const db = require('../server/db');

const BASE = process.env.SLATE_URL || 'http://127.0.0.1:4173';
const results = [];

function record(name, ok, detail){
  results.push({ name, ok, detail: detail || '' });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function req(path, { method='GET', body, cookie, expect }={}){
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  if (expect != null && res.status !== expect) {
    throw new Error(`${path} expected ${expect}, got ${res.status}: ${text.slice(0,200)}`);
  }
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const sid = (set.join(';').match(/slate_sid=([^;]+)/) || [])[1];
  return { status: res.status, json, cookie: sid ? 'slate_sid='+sid : cookie };
}

async function login(email, pin){
  const out = await req('/api/login', { method:'POST', body:{ email, pin }, expect:200 });
  assert.ok(out.cookie, 'login did not set cookie');
  return out;
}

async function run(){
  try {
    const built = assembleBrochure({
      client:'Ridgeline',
      position:'Town Manager',
      salary:'$165,000',
      firstReview:'14 September 2026',
      criteria:[
        { kind:'skill', label:'Finance', weight:5, note:'gap close' },
        { kind:'chall', label:'Deficit', weight:5, note:'' }
      ],
      artifacts:{
        community:{
          lede:'A mountain town.',
          why:'Lead here.',
          organization:'Lean staff.',
          community:{ history:'Founded in 1880.', qualityOfLife:'Trails and a main street.' },
          government:{ managerRole:'Runs daily operations.' }
        },
        brochure:{ photos:{ cover:'/media/x/cover.jpg' }, theme:'split', scheme:'forest' }
      }
    });
    record('assembleBrochure copies community lede', built.lede==='A mountain town.');
    record('assembleBrochure keeps photos and theme', built.photos.cover==='/media/x/cover.jpg' && built.theme==='split');
    record('assembleBrochure keeps color scheme', built.scheme==='forest');
    record('assembleBrochure does not use em dashes', !/[—–]/.test(JSON.stringify(built)));
  } catch (err) {
    record('assembleBrochure copies community lede', false, err.message);
  }

  // --- health ---
  try {
    const h = await req('/api/health', { expect:200 });
    record('GET /api/health', h.json.ok === true && h.json.hasKey === undefined, 'no extra intel');
  } catch (err) {
    record('GET /api/health', false, err.message);
    console.log('\nServer is not reachable at '+BASE+'. Start it with npm start, then re-run.');
    return;
  }

  try {
    const cfg = await req('/api/config', { expect:200 });
    record('GET /api/config', typeof cfg.json.demoLogins === 'boolean');
  } catch (err) { record('GET /api/config', false, err.message); }

  // --- auth ---
  try {
    const bad = await req('/api/login', { method:'POST', body:{ email:'abe@slate.local', pin:'0000' }, expect:401 });
    record('Login rejects bad PIN', bad.json.error && bad.status===401);
  } catch (err) { record('Login rejects bad PIN', false, err.message); }

  try {
    await req('/api/me', { expect:401 });
    record('GET /api/me requires session', true);
  } catch (err) { record('GET /api/me requires session', false, err.message); }

  let abe, mike;
  try {
    abe = await login('abe@slate.local', '2468');
    record('Abe can sign in', abe.json.user && abe.json.user.role==='consultant', abe.json.user.name);
  } catch (err) { record('Abe can sign in', false, err.message); return; }

  try {
    mike = await login('mike@slate.local', '1357');
    record('Mike can sign in', mike.json.user && mike.json.user.name==='Mike Letcher');
  } catch (err) { record('Mike can sign in', false, err.message); }

  try {
    const me = await req('/api/me', { cookie: abe.cookie, expect:200 });
    record('GET /api/me after login', me.json.user.email==='abe@slate.local');
  } catch (err) { record('GET /api/me after login', false, err.message); }

  // --- create search: empty required fields ---
  try {
    const empty = await req('/api/searches', { method:'POST', cookie: abe.cookie, body:{}, expect:400 });
    record('Create search requires client and position', empty.status===400, empty.json.error);
  } catch (err) {
    record('Create search requires client and position', false, err.message);
  }

  // --- happy-path search ---
  let search;
  try {
    const created = await req('/api/searches', {
      method:'POST', cookie: abe.cookie, expect:200,
      body:{ client:'Test Town of Bughunt', position:'Town Manager', state:'Colorado', website:'https://example.com' }
    });
    search = created.json;
    record('Create a named search', search.client==='Test Town of Bughunt' && search.website==='https://example.com', search.no);
  } catch (err) { record('Create a named search', false, err.message); return; }

  try {
    const list = await req('/api/searches', { cookie: abe.cookie, expect:200 });
    record('List searches includes new file', list.json.some(s => s.id===search.id));
  } catch (err) { record('List searches includes new file', false, err.message); }

  try {
    const patched = await req('/api/searches/'+search.id, {
      method:'PATCH', cookie: abe.cookie, expect:200,
      body:{ population:'12,000', budget:'$20M', fog:'Council–Manager', firstReview:'1 Sep 2026' }
    });
    record('PATCH search facts (incl. firstReview)', patched.json.population==='12,000' && patched.json.firstReview==='1 Sep 2026');
  } catch (err) { record('PATCH search facts (incl. firstReview)', false, err.message); }

  try {
    await req('/api/searches/'+search.id, {
      method:'PATCH', cookie: abe.cookie, expect:200,
      body:{ website:'https://www.example.com' }
    });
    const got = await req('/api/searches/'+search.id, { cookie: abe.cookie, expect:200 });
    record('PATCH persists website', got.json.website==='https://www.example.com');
  } catch (err) { record('PATCH persists website', false, err.message); }

  try {
    await req('/api/searches/no-such-id', { cookie: abe.cookie, expect:404 });
    record('Unknown search is 404', true);
  } catch (err) { record('Unknown search is 404', false, err.message); }

  // --- profile / steps ---
  try {
    const got = await req('/api/searches/'+search.id, { cookie: abe.cookie, expect:200 });
    const profile = got.json.steps.find(s=>s.key==='profile');
    const community = got.json.steps.find(s=>s.key==='community');
    const brochure = got.json.steps.find(s=>s.key==='brochure');
    record('New search: profile is next / not blocked', profile && !profile.blocked && profile.status!=='done');
    record('Community waits on the candidate profile', community && community.blocked===true);
    record('Brochure is blocked until profile and community', brochure && brochure.blocked===true);
  } catch (err) { record('Step lock logic', false, err.message); }

  try {
    const saved = await req('/api/searches/'+search.id+'/profile', {
      method:'PUT', cookie: abe.cookie, expect:200,
      body:{ criteria:[
        { id:'S1', kind:'skill', label:'Budget', weight:5, note:'n' },
        { id:'S2', kind:'skill', label:'Hiring', weight:4, note:'n' },
        { id:'S3', kind:'skill', label:'Council relations', weight:4, note:'n' },
        { id:'T1', kind:'trait', label:'Calm', weight:4, note:'n' },
        { id:'T2', kind:'trait', label:'Direct', weight:3, note:'n' },
        { id:'T3', kind:'trait', label:'Ethical', weight:5, note:'n' },
        { id:'C1', kind:'chall', label:'Deficit', weight:5, note:'n' },
        { id:'C2', kind:'chall', label:'Vacancies', weight:4, note:'n' },
        { id:'C3', kind:'chall', label:'Infrastructure', weight:4, note:'n' },
        { id:'O1', kind:'opp', label:'Growth', weight:3, note:'n' },
        { id:'O2', kind:'opp', label:'Partnerships', weight:3, note:'n' },
        { id:'O3', kind:'opp', label:'Innovation', weight:3, note:'n' }
      ]}
    });
    const profile = saved.json.steps.find(s=>s.key==='profile');
    record('Profile with 3-5 of each kind is done', profile.status==='done', 'status='+profile.status);
    const community = saved.json.steps.find(s=>s.key==='community');
    record('Community unlocks after the profile is done', community && community.blocked===false);
  } catch (err) { record('Profile with 3-5 of each kind is done', false, err.message); }

  try {
    await req('/api/searches/'+search.id+'/artifact/community', {
      method:'PUT', cookie: abe.cookie, expect:200,
      body:{ body:{ lede:'A mountain town.', facts:[{k:'Pop',v:'12,000'}], government:'CM', community:'x', organization:'y', why:'z' } }
    });
    const got = await req('/api/searches/'+search.id, { cookie: abe.cookie, expect:200 });
    record('Save community artifact', Boolean(got.json.artifacts.community && got.json.artifacts.community.lede));
    const brochure = got.json.steps.find(s=>s.key==='brochure');
    record('Brochure unlocks after profile + community', brochure.blocked===false, 'blocked='+brochure.blocked);
  } catch (err) { record('Save community / brochure unlock', false, err.message); }

  try {
    const assembled = await req('/api/searches/'+search.id+'/assemble', {
      method:'POST', cookie: abe.cookie, expect:200, body:{ kind:'brochure' }
    });
    const b = assembled.json.artifacts && assembled.json.artifacts.brochure;
    record('Assemble brochure from community without Claude', Boolean(b && b.lede==='A mountain town.' && b.thePlace && b.theme==='photo'), b ? ('lede='+b.lede+' theme='+b.theme) : 'no brochure');
  } catch (err) { record('Assemble brochure from community without Claude', false, err.message); }

  try {
    const bad = await req('/api/searches/'+search.id+'/assemble', {
      method:'POST', cookie: abe.cookie, body:{ kind:'ads' }
    });
    record('Assemble rejects non-brochure kinds', bad.status===400, 'status='+bad.status);
  } catch (err) { record('Assemble rejects non-brochure kinds', false, err.message); }

  try {
    const unauth = await req('/api/searches/'+search.id+'/assemble', { method:'POST', body:{ kind:'brochure' } });
    record('Assemble requires sign-in', unauth.status===401, 'status='+unauth.status);
  } catch (err) { record('Assemble requires sign-in', false, err.message); }

  try {
    const media = await req('/api/searches/'+search.id+'/media', {
      method:'POST', cookie: abe.cookie, body:{ slot:'hero', data:'nope' }
    });
    record('Media rejects unknown photo slot', media.status===400, 'status='+media.status);
  } catch (err) { record('Media rejects unknown photo slot', false, err.message); }

  // --- generate / research ---
  const me = await req('/api/me', { cookie: abe.cookie, expect:200 });
  const hasKey = Boolean(me.json.health && me.json.health.hasKey);

  if (hasKey) {
    record('Generate/research live Claude calls skipped', true, 'API key present — bughunt will not spend tokens');
  } else {
    try {
      const gen = await req('/api/searches/'+search.id+'/generate', {
        method:'POST', cookie: abe.cookie, body:{ kind:'ads' }
      });
      record('Generate without API key returns 503', gen.status===503, 'status='+gen.status+' '+ (gen.json.error||''));
    } catch (err) { record('Generate without API key returns 503', false, err.message); }

    try {
      const r = await req('/api/searches/'+search.id+'/research', {
        method:'POST', cookie: abe.cookie, body:{ city:'Test Town', website:'https://example.com' }
      });
      record('Research without API key returns 503', r.status===503, 'status='+r.status+' '+(r.json.error||''));
    } catch (err) { record('Research without API key returns 503', false, err.message); }
  }

  try {
    const gen = await req('/api/searches/'+search.id+'/generate', {
      method:'POST', cookie: abe.cookie, body:{ kind:'not-a-kind' }
    });
    record('Unknown generate kind is an error', gen.status>=400, 'status='+gen.status);
  } catch (err) { record('Unknown generate kind is an error', false, err.message); }

  try {
    const r = await req('/api/searches/'+search.id+'/research', {
      method:'POST', cookie: abe.cookie, body:{ city:'Test Town', website:'' }
    });
    record('Research without website returns 400', r.status===400);
  } catch (err) { record('Research without website returns 400', false, err.message); }

  try {
    const r = await req('/api/searches/'+search.id+'/research', {
      method:'POST', cookie: abe.cookie, body:{ city:'Test Town', website:'http://127.0.0.1/' }
    });
    record('Research rejects localhost (SSRF)', r.status===400, 'status='+r.status+' '+(r.json.error||''));
  } catch (err) { record('Research rejects localhost (SSRF)', false, err.message); }

  try {
    const r = await req('/api/searches/'+search.id+'/research', {
      method:'POST', cookie: abe.cookie, body:{ city:'Test Town', website:'http://192.168.1.1/' }
    });
    record('Research rejects private IP', r.status===400, 'status='+r.status+' '+(r.json.error||''));
  } catch (err) { record('Research rejects private IP', false, err.message); }

  // --- candidates / apply ---
  let cand;
  try {
    const unnamed = await req('/api/searches/'+search.id+'/candidates', {
      method:'POST', cookie: abe.cookie, body:{ name:'' }
    });
    record('Candidate requires a name', unnamed.status===400);
  } catch (err) { record('Candidate requires a name', false, err.message); }

  try {
    const added = await req('/api/searches/'+search.id+'/candidates', {
      method:'POST', cookie: abe.cookie, expect:200,
      body:{ name:'Ilene Test', cur:'Deputy', org:'Nearby City', email:'ilene@example.com' }
    });
    cand = added.json.candidates.find(c=>c.name==='Ilene Test');
    record('Add candidate and invite token', Boolean(cand && cand.invite), cand && cand.invite);
    const sneaky = await req('/api/searches/'+search.id+'/candidates', {
      method:'POST', cookie: abe.cookie, expect:200,
      body:{ name:'Skip Stage', stage:'finalist' }
    });
    const planted = sneaky.json.candidates.find(c=>c.name==='Skip Stage');
    record('New candidate cannot start as finalist', planted && planted.stage==='applicant');
  } catch (err) { record('Add candidate and invite token', false, err.message); }

  try {
    await req('/api/apply/not-a-real-token', { expect:404 });
    record('Invalid apply token is 404', true);
  } catch (err) { record('Invalid apply token is 404', false, err.message); }

  try {
    const page = await req('/apply/'+cand.invite, { expect:200 });
    record('GET /apply/:token serves HTML', typeof page.json._raw==='string' && page.json._raw.includes('<div id="app">'));
  } catch (err) { record('GET /apply/:token serves HTML', false, err.message); }

  try {
    const info = await req('/api/apply/'+cand.invite, { expect:200 });
    record('Apply payload has no survey yet', info.json.survey1===null && info.json.candidate.name==='Ilene Test');
  } catch (err) { record('Apply payload has no survey yet', false, err.message); }

  try {
    const posted = await req('/api/apply/'+cand.invite, {
      method:'POST', body:{ which:'survey1', answers:{ q1:'hello' } }
    });
    record('Apply refuses submit when no survey is published', posted.status===400, 'status='+posted.status);
  } catch (err) {
    record('Apply refuses submit when no survey is published', false, err.message);
  }

  try {
    await req('/api/searches/'+search.id+'/artifact/survey1', {
      method:'PUT', cookie: abe.cookie, expect:200,
      body:{ body:{ name:'Initial', questions:[{ n:1, prompt:'Why this job?', type:'long', required:true }] } }
    });
    const posted = await req('/api/apply/'+cand.invite, {
      method:'POST', body:{ which:'survey1', answers:{ q1:'hello' } }, expect:200
    });
    record('Apply POST succeeds after survey is published', posted.json.ok===true);
  } catch (err) {
    record('Apply POST succeeds after survey is published', false, err.message);
  }

  try {
    const got = await req('/api/searches/'+search.id, { cookie: abe.cookie, expect:200 });
    const person = got.json.candidates.find(c=>c.id===cand.id);
    record('Survey 1 does not auto-promote to semifinalist', person && person.stage==='applicant', person && person.stage);
  } catch (err) { record('Survey 1 does not auto-promote to semifinalist', false, err.message); }

  try {
    const posted = await req('/api/apply/'+cand.invite, {
      method:'POST', body:{ which:'survey1', answers:{ q1:'again' } }
    });
    record('Apply does not overwrite a submitted survey', posted.status===409, 'status='+posted.status);
  } catch (err) {
    record('Apply does not overwrite a submitted survey', false, err.message);
  }

  try {
    await req('/api/searches/'+search.id+'/artifact/survey2', {
      method:'PUT', cookie: abe.cookie, expect:200,
      body:{ body:{ name:'Semi', questions:[{ n:1, prompt:'Describe a hard problem.', type:'are', required:true, crit:['C1'] }] } }
    });
    const tooSoon = await req('/api/apply/'+cand.invite, {
      method:'POST', body:{ which:'survey2', answers:{ q1:'not yet' } }
    });
    record('Survey 2 submit is blocked until it is sent', tooSoon.status===400, 'status='+tooSoon.status);
    const peek = await req('/api/apply/'+cand.invite, { expect:200 });
    record('Apply payload hides survey 2 until sent', peek.json.survey2===null && peek.json.sent2===false);
  } catch (err) { record('Survey 2 submit is blocked until it is sent', false, err.message); }

  try {
    const sendEarly = await req('/api/searches/'+search.id+'/candidates/'+cand.id+'/send2', {
      method:'POST', cookie: abe.cookie, body:{ deadline:'12 Sep 2026' }
    });
    record('Cannot send survey 2 before semifinalist', sendEarly.status===400, 'status='+sendEarly.status);
  } catch (err) { record('Cannot send survey 2 before semifinalist', false, err.message); }

  try {
    await req('/api/searches/'+search.id+'/scores/'+cand.id, {
      method:'PUT', cookie: abe.cookie, expect:200,
      body:{ scores:{ S1:4, T1:5 }, note:'Strong on budget.' }
    });
    const got = await req('/api/searches/'+search.id, { cookie: abe.cookie, expect:200 });
    const screen = got.json.steps.find(s=>s.key==='screen');
    record('Scoring a candidate moves screening to now', screen.status==='now', 'status='+screen.status);
    const mikes = await req('/api/searches/'+search.id, { cookie: mike.cookie, expect:200 });
    const ids = Object.keys(mikes.json.scores || {});
    record('Sealed scores hide other raters from Mike', ids.every(id => id === mike.json.user.id), 'keys='+ids.join(','));
  } catch (err) { record('Scoring a candidate moves screening to now', false, err.message); }

  try {
    const semi = await req('/api/searches/'+search.id+'/candidates/'+cand.id, {
      method:'PATCH', cookie: abe.cookie, expect:200, body:{ stage:'semifinalist' }
    });
    const person = semi.json.candidates.find(c=>c.id===cand.id);
    record('Advance candidate to semifinalist', person.stage==='semifinalist');
  } catch (err) { record('Advance candidate to semifinalist', false, err.message); }

  try {
    await req('/api/searches/'+search.id, {
      method:'PATCH', cookie: abe.cookie, expect:200, body:{ released:true }
    });
    const got = await req('/api/searches/'+search.id, { cookie: abe.cookie, expect:200 });
    const screen = got.json.steps.find(s=>s.key==='screen');
    record('Screening is done after a semifinalist and released scores', screen.status==='done', 'status='+screen.status);
  } catch (err) { record('Screening is done after a semifinalist and released scores', false, err.message); }

  try {
    const sent = await req('/api/searches/'+search.id+'/candidates/'+cand.id+'/send2', {
      method:'POST', cookie: abe.cookie, expect:200, body:{ deadline:'12 Sep 2026' }
    });
    const person = sent.json.candidates.find(c=>c.id===cand.id);
    record('Send semifinalist survey stores sent-at', Boolean(person.survey2SentAt), person && person.survey2Deadline);
    const peek = await req('/api/apply/'+cand.invite, { expect:200 });
    record('Apply payload includes survey 2 after send', Boolean(peek.json.survey2) && peek.json.sent2===true);
  } catch (err) { record('Send semifinalist survey stores sent-at', false, err.message); }

  try {
    const posted = await req('/api/apply/'+cand.invite, {
      method:'POST', body:{ which:'survey2', answers:{ q1:'I inherited a deficit and closed it.' } }, expect:200
    });
    record('Survey 2 submit succeeds after send', posted.json.ok===true);
    const got = await req('/api/searches/'+search.id, { cookie: abe.cookie, expect:200 });
    const send2 = got.json.steps.find(s=>s.key==='send2');
    record('Sending and receiving survey 2 completes Step 10', send2.status==='done', 'status='+send2.status);
  } catch (err) { record('Survey 2 submit succeeds after send', false, err.message); }

  try {
    const adv = await req('/api/searches/'+search.id+'/candidates/'+cand.id, {
      method:'PATCH', cookie: abe.cookie, expect:200, body:{ stage:'finalist' }
    });
    const person = adv.json.candidates.find(c=>c.id===cand.id);
    record('Advance candidate to finalist', person.stage==='finalist');
    const got = await req('/api/searches/'+search.id, { cookie: abe.cookie, expect:200 });
    const finals = got.json.steps.find(s=>s.key==='finalists');
    record('Selecting a finalist completes Step 11', finals.status==='done', 'status='+finals.status);
  } catch (err) { record('Advance candidate to finalist', false, err.message); }

  // Mike can open Abe's search (no ACL)
  try {
    const got = await req('/api/searches/'+search.id, { cookie: mike.cookie, expect:200 });
    record('Any signed-in consultant can open any search (no per-search ACL)', got.json.id===search.id);
  } catch (err) { record('Any signed-in consultant can open any search (no per-search ACL)', false, err.message); }

  // --- unit: publicUrl ---
  try {
    publicUrl('https://www.fcgov.com');
    record('publicUrl accepts https city site', true);
  } catch (err) { record('publicUrl accepts https city site', false, err.message); }

  try {
    publicUrl('fcgov.com');
    record('publicUrl adds https when scheme missing', true);
  } catch (err) { record('publicUrl adds https when scheme missing', false, err.message); }

  try {
    publicUrl('http://localhost/');
    record('publicUrl blocks localhost', false, 'should have thrown');
  } catch (err) {
    record('publicUrl blocks localhost', err.code==='BAD_URL', err.message);
  }

  try {
    publicUrl('http://169.254.169.254/');
    record('publicUrl blocks link-local metadata IP', false, 'should have thrown');
  } catch (err) {
    record('publicUrl blocks link-local metadata IP', err.code==='BAD_URL', err.message);
  }

  try {
    publicUrl('javascript:alert(1)');
    record('publicUrl blocks javascript: URLs', false, 'should have thrown');
  } catch (err) {
    record('publicUrl blocks javascript: URLs', err.code==='BAD_URL', err.message);
  }

  // fetchCitySite against example.com (public)
  try {
    const site = await fetchCitySite('https://example.com');
    record('fetchCitySite reads example.com', site.pages.length>=1 && site.canonical.startsWith('https://'));
  } catch (err) { record('fetchCitySite reads example.com', false, err.message); }

  try {
    const n = normalizeResearch({
      facts: { population: 169810, budget: 41000000, client: 'City of Fort Collins' },
      community: { lede: 'A northern Colorado city.', facts: [{ k: 'County', v: 'Larimer' }] }
    });
    record('normalizeResearch keeps numeric population and budget',
      n.facts.population==='169810' && n.facts.budget==='41000000' && n.facts.client==='City of Fort Collins');
    record('normalizeResearch copies figures onto community facts',
      n.community.facts.some(f => f.k==='Population' && f.v==='169810'));
    record('normalizeResearch structures government and community sections',
      n.community.government && typeof n.community.government === 'object' && 'form' in n.community.government);
  } catch (err) { record('normalizeResearch keeps numeric population and budget', false, err.message); }

  try {
    const n = normalizeResearch({
      facts: [{ k: 'Form of government', v: 'Council–Manager' }, { k: 'Population', v: '12,000' }],
      community: 'A mountain town.'
    });
    record('normalizeResearch reads fact arrays and string community',
      n.facts.fog.includes('Council') && n.facts.population==='12,000' && n.community.lede==='A mountain town.');
  } catch (err) { record('normalizeResearch reads fact arrays and string community', false, err.message); }

  try {
    const incomplete = researchGaps({ facts:{ client:'Benson' }, community:{} }, 1);
    record('researchGaps first pass wants population and budget',
      incomplete.some(m=>/population/.test(m)) && incomplete.some(m=>/budget/.test(m)));
    const retry = researchGaps({ facts:{ client:'Benson', state:'AZ', fog:'Council–Manager' }, community:{ lede:'A small city.' } }, 2);
    record('researchGaps second pass allows empty figures', retry.length===0);
  } catch (err) { record('researchGaps first pass wants population and budget', false, err.message); }

  // --- static analysis of frontend ---
  const fs = require('fs');
  const path = require('path');
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const stylesCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

  record('Apply UI handles survey1 and survey2', /function pickApplySurvey/.test(appJs) && /survey2/.test(appJs));

  record('Rail splits screening, send, and finalists', /9 · Screening/.test(appJs) && /10 · Semifinalist send/.test(appJs) && /11 · Finalists/.test(appJs));

  record('Ad plan preview includes who and status', /Who<\/th>/.test(appJs) && /Status<\/th>/.test(appJs));

  record('Interview guide preview renders scenarios', /Assessment scenarios/.test(appJs));

  record('BAR preview renders actions, governance, and cadence', /Council governance survey/.test(appJs) && /Annual cadence/.test(appJs));

  const aiJs = fs.readFileSync(path.join(__dirname, '..', 'server', 'ai.js'), 'utf8');
  record('Claude prompts forbid em dashes', /Do not use em dashes/.test(aiJs) && /SYSTEM = `[\s\S]*em dashes/.test(aiJs) && /RESEARCH_AGENT = `[\s\S]*em dashes/.test(aiJs));

  record('Home page is the workspace landing', /head\('Home'/.test(appJs) && /Welcome back/.test(appJs) && /How a search runs/.test(appJs) && />Home</.test(appJs));

  record('New search opens on the candidate profile', /go\('profile'\)/.test(appJs) && /Select 3 to 5 essential skills/.test(appJs));

  record('Profile has a 3 to 5 skill picker', /data-pick/.test(appJs) && /Strategic leadership/.test(appJs));

  record('Step 1 has Save and move on', /save-profile-next/.test(appJs) && /Save and move on/.test(appJs));

  record('Each process step has a Next button', /data-act="next-step"/.test(appJs) && /function nextBtn/.test(appJs) && /function stepFooter/.test(appJs) && /act==='next-step'/.test(appJs));

  record('Community has Next to brochure', /data-from="community"/.test(appJs) && /Next · Brochure/.test(appJs) && /stepNextCard\('community'\)/.test(appJs));

  record('Brochure and ads have a posting design', /pack--brochure/.test(appJs) && /pack--ad/.test(appJs) && /Copy for posting/.test(appJs) && /act==='print-pack'/.test(appJs) && /act==='copy-post'/.test(appJs));

  record('Brochure is a layout tool', /Fill from community/.test(appJs) && /function vBrochure/.test(appJs) && /data-photo/.test(appJs) && /pack--photo/.test(stylesCss) && /pack--split/.test(stylesCss) && /act==='assemble'/.test(appJs));

  record('Packet has color and layout pickers', /data-act="pack-scheme"/.test(appJs) && /pack--scheme-forest/.test(stylesCss) && /pack--banner/.test(stylesCss) && /pack--masthead/.test(stylesCss) && /Masthead/.test(appJs) && /Banner/.test(appJs) && /Burgundy \/ cream/.test(appJs));

  record('API work shows a loading window', /function showWait/.test(appJs) && /function withBusy[\s\S]*showWait/.test(appJs) && /waitFor\('profile'\)/.test(appJs) && /waitFor\(kind\)/.test(appJs));

  record('New-search Create submits the form (HTML required works)', /type="submit" form="newsearch"/.test(appJs));

  record('withBusy does not re-render before the request', !/async function withBusy[\s\S]*state\.busy = true; render\(\);/.test(appJs));

  record('Draft profile reads notes before withBusy', /act==='draft-profile'[\s\S]*profilenotes[\s\S]*withBusy/.test(appJs));

  record('Drafts edit in labeled fields', /function collectArtifact/.test(appJs) && /id="edit-\$\{kind\}"/.test(appJs) && /data-path/.test(appJs) && /Edit the copy/.test(appJs) && /theOpportunity/.test(appJs));

  record('Save artifact reads the form before withBusy', /act==='save-art'[\s\S]*collectArtifact[\s\S]*withBusy/.test(appJs));

  record('Client JS does not hardcode demo PINs', !/\b2468\b/.test(appJs) && !/\b1357\b/.test(appJs));

  // logout
  try {
    await req('/api/logout', { method:'POST', cookie: abe.cookie, expect:200, body:{} });
    await req('/api/me', { cookie: abe.cookie, expect:401 });
    record('Logout clears the session', true);
  } catch (err) { record('Logout clears the session', false, err.message); }

  const failed = results.filter(r => !r.ok);
  const passed = results.filter(r => r.ok);
  console.log('\n---');
  console.log(passed.length+' passed, '+failed.length+' failed / bugs found');
  if (failed.length) {
    console.log('\nBugs / failures:');
    failed.forEach((f,i) => console.log(`  ${i+1}. ${f.name}${f.detail ? '\n     '+f.detail : ''}`));
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
