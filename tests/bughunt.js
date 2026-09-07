'use strict';

/**
 * Live bug hunt for Slate. Hits the running server and unit-tests helpers.
 * Usage: node tests/bughunt.js
 */
const assert = require('assert');
const { publicUrl, fetchCitySite } = require('../server/site');
const { normalizeResearch, researchGaps, generate } = require('../server/ai');
const desk = require('../server/desk');
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
  const searchPath = path.match(/^\/api\/searches\/(sr-[^/]+)/)?.[0];
  if (cookie && method !== 'GET' && searchPath) {
    const current = await fetch(BASE + searchPath, { headers: { cookie } });
    if (current.ok) headers['if-match'] = String((await current.json()).revision);
  }
  if (method === 'POST' && path.startsWith('/api/apply/') && body) {
    const current = await fetch(BASE + path);
    if (current.ok) body = { ...body, surveyVersion:(await current.json()).versions?.[body.which || 'survey1'] };
  }
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
    process.exitCode = 1;
    return;
  }

  try {
    const cfg = await req('/api/config', { expect:200 });
    record('GET /api/config', typeof cfg.json.demoLogins === 'boolean');
    const pk = cfg.json.packages || [];
    record('Config lists the three service packages',
      pk.map(p => p.key).join(',') === 'basic,enhanced,executive' && pk.every(p => p.label && p.fee && Array.isArray(p.services)),
      pk.map(p => p.key).join(','));
    const cmp = cfg.json.compare || [];
    const bands = cfg.json.compareBands || [];
    record('Config serves the pay-level breakdown',
      cmp.length >= 13 && bands.map(b => b.key).join(',') === 'basic,enhanced,executive'
        && cmp.some(r => r.t==='Position profile' && r.pkg==='basic')
        && cmp.some(r => r.t==='Active candidate sourcing' && r.pkg==='enhanced')
        && cmp.some(r => r.t==='Reference checks' && r.pkg==='executive')
        && cmp.some(r => r.t==='Potential fee') === false,
      'rows='+cmp.length);
    record('Config steps carry their minimum package', (cfg.json.steps||[]).every(s => ['basic','enhanced','executive'].includes(s.pkg)));
    const views = Object.fromEntries(pk.map(p => [p.key, p.view || {}]));
    record('Each package names its overview layout in the catalog',
      views.basic.layout==='dashboard' && views.basic.steps==='strip' && views.enhanced.layout==='dashboard' && views.executive.layout==='spec'
        && pk.every(p => p.view && p.view.kicker && Array.isArray(p.view.panels)),
      pk.map(p => p.key+':'+(p.view||{}).layout).join(','));
    record('Dashboard panels are ones the client can draw',
      ['basic','enhanced'].every(k => views[k].panels.every(p => ['committee','posting','sourcing','applicants','interviews','recommendation'].includes(p)))
        && views.basic.panels.includes('applicants') && views.enhanced.panels.includes('sourcing') && !views.basic.panels.includes('sourcing'));
  } catch (err) { record('GET /api/config', false, err.message); }

  // --- packages (catalog helpers, no server needed) ---
  try {
    const steps = require('../server/steps');
    const basic = steps.stepsFor('basic');
    const enhanced = steps.stepsFor('enhanced');
    const exec = steps.stepsFor('executive');
    const keys = list => list.map(s => s.key);
    record('Basic runs the committee, profile, posting, and screening only',
      keys(basic).join(',') === 'team,intake,profile,survey1,plan,ads,screen,finalists', keys(basic).join(','));
    record('Enhanced adds community, brochure, guide, surveys, and finalist week',
      keys(enhanced).includes('brochure') && keys(enhanced).includes('schedule') && !keys(enhanced).includes('contract') && !keys(enhanced).includes('bar'));
    record('Executive runs every step', exec.length === steps.STEPS.length && steps.STEPS.length === 19);
    record('Staff steps are sourcing, video, and references',
      [...steps.STAFF_STEPS].sort().join(',') === 'references,sourcing,video' && steps.STEPS.filter(s => s.kind==='staff').every(s => s.pkg !== 'basic'));
    record('Sourcing and video are Enhanced; references are Executive',
      keys(enhanced).includes('sourcing') && keys(enhanced).includes('video') && !keys(enhanced).includes('references') && keys(exec).includes('references'));
    record('Video and reference log entries are scoped to a stage',
      steps.STAFF_STAGES.video.join(',') === 'semifinalist,finalist' && steps.STAFF_STAGES.references.join(',') === 'finalist' && !steps.STAFF_STAGES.sourcing);
    const basicAds = basic.find(s => s.key === 'ads');
    record('Basic ads wait on the ad plan, not a brochure', basicAds && basicAds.needs.join(',') === 'plan', basicAds && basicAds.needs.join(','));
    record('Unknown package falls back to Executive', steps.packageOf('gold') === 'executive' && steps.packageOf(undefined) === 'executive');
    record('Compare rows name the cheapest package that includes each service',
      steps.COMPARE.every(r => ['basic','enhanced','executive'].includes(r.pkg))
        && steps.COMPARE.filter(r => r.pkg==='basic').length >= 7
        && steps.includes('basic', { pkg:'basic' }) && !steps.includes('basic', { pkg:'enhanced' })
        && steps.includes('executive', { pkg:'enhanced' }));
  } catch (err) { record('Package catalog helpers', false, err.message); }

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
    record('A search defaults to the Executive package', search.package==='executive' && search.packageInfo?.label==='Executive' && search.progress.total===19,
      'package='+search.package+' total='+search.progress.total);
  } catch (err) { record('Create a named search', false, err.message); return; }

  // --- a Basic package file ---
  let basicSearch;
  try {
    const bad = await req('/api/searches', {
      method:'POST', cookie: abe.cookie, body:{ client:'Basic Town', position:'Clerk', package:'gold' }
    });
    record('Create search rejects an unknown package', bad.status===400, 'status='+bad.status);
    const created = await req('/api/searches', {
      method:'POST', cookie: abe.cookie, expect:200,
      body:{ client:'Test Basic Town', position:'Finance Director', package:'basic' }
    });
    basicSearch = created.json;
    const keys = basicSearch.steps.map(s => s.key);
    record('Basic search carries only its package steps',
      basicSearch.package==='basic' && basicSearch.progress.total===8 && !keys.includes('brochure') && !keys.includes('community') && !keys.includes('contract'),
      keys.join(','));
    record('Basic search still starts on the committee', basicSearch.progress.next?.key==='team', 'next='+basicSearch.progress.next?.key);
    const list = await req('/api/searches', { cookie: abe.cookie, expect:200 });
    const row = list.json.find(s => s.id===basicSearch.id);
    record('Search list carries the package label', row && row.package==='basic' && row.packageLabel==='Basic');
  } catch (err) { record('Basic package search', false, err.message); }

  if (basicSearch) {
    try {
      const put = await req('/api/searches/'+basicSearch.id+'/artifact/brochure', {
        method:'PUT', cookie: abe.cookie, body:{ body:{ lede:'x' } }
      });
      record('Basic refuses a brochure save (not in package)', put.status===400 && /Basic package/.test(put.json.error||''), put.json.error);
      const gen = await req('/api/searches/'+basicSearch.id+'/generate', {
        method:'POST', cookie: abe.cookie, body:{ kind:'contract' }
      });
      record('Basic refuses a contract draft (not in package)', gen.status===400 && /Executive/.test(gen.json.error||''), gen.json.error);
      const asm = await req('/api/searches/'+basicSearch.id+'/assemble', {
        method:'POST', cookie: abe.cookie, body:{ kind:'brochure' }
      });
      record('Basic refuses assembling a brochure', asm.status===400, 'status='+asm.status);
      const send = await req('/api/searches/'+basicSearch.id+'/send2', {
        method:'POST', cookie: abe.cookie, body:{}
      });
      record('Basic refuses the semifinalist send', send.status===400 && /package/.test(send.json.error||''), send.json.error);
      const ok = await req('/api/searches/'+basicSearch.id+'/artifact/plan', {
        method:'PUT', cookie: abe.cookie, expect:200, body:{ body:{ rows:[] } }
      });
      record('Basic accepts an ad plan save (in package)', Boolean(ok.json.artifacts.plan));
      const staff = await req('/api/searches/'+basicSearch.id+'/staff/sourcing/log', {
        method:'POST', cookie: abe.cookie, body:{ text:'Called someone.' }
      });
      record('Basic refuses a sourcing log (staff step not in package)', staff.status===400 && /Enhanced/.test(staff.json.error||''), staff.json.error);
    } catch (err) { record('Basic package gating', false, err.message); }

    try {
      const badPatch = await req('/api/searches/'+basicSearch.id, {
        method:'PATCH', cookie: abe.cookie, body:{ package:'platinum' }
      });
      record('PATCH rejects an unknown package', badPatch.status===400, 'status='+badPatch.status);
      const up = await req('/api/searches/'+basicSearch.id, {
        method:'PATCH', cookie: abe.cookie, expect:200, body:{ package:'enhanced' }
      });
      const keys = up.json.steps.map(s => s.key);
      record('Moving to Enhanced puts the brochure and finalist week on the file',
        up.json.package==='enhanced' && keys.includes('brochure') && keys.includes('schedule') && !keys.includes('contract') && up.json.progress.total===16,
        'total='+up.json.progress.total);
      record('Changing the package is named in the activity feed', (up.json.activity||[]).some(a => /Enhanced package/.test(a.x)));
      const ads = up.json.steps.find(s => s.key==='ads');
      record('Enhanced ads wait on the brochure again', ads && ads.needs.includes('brochure'), ads && ads.needs.join(','));
    } catch (err) { record('Package change', false, err.message); }

    // --- staff steps on the (now Enhanced) file ---
    try {
      const sid = basicSearch.id;
      const empty = await req('/api/searches/'+sid+'/staff/sourcing/complete', { method:'POST', cookie: abe.cookie, body:{ done:true } });
      record('An empty staff step cannot be marked complete', empty.status===400, empty.json.error);
      const blank = await req('/api/searches/'+sid+'/staff/sourcing/log', { method:'POST', cookie: abe.cookie, body:{ text:'   ' } });
      record('Staff log refuses an empty entry', blank.status===400);
      const notStaff = await req('/api/searches/'+sid+'/staff/plan/log', { method:'POST', cookie: abe.cookie, body:{ text:'x' } });
      record('Staff routes refuse desk steps', notStaff.status===400 && /not staff work/.test(notStaff.json.error||''));

      let got = await req('/api/searches/'+sid+'/staff/sourcing/log', {
        method:'POST', cookie: abe.cookie, expect:200, body:{ text:'Called J. Rivera. Interested.' }
      });
      let sourcing = got.json.steps.find(s => s.key==='sourcing');
      const entry = got.json.staff.sourcing.log[0];
      record('Sourcing log entry is recorded with who and when',
        entry && entry.text==='Called J. Rivera. Interested.' && entry.byName==='Abe Macy' && entry.at && sourcing.status==='now',
        'status='+sourcing.status);
      const tagged = await req('/api/searches/'+sid+'/staff/sourcing/log', {
        method:'POST', cookie: abe.cookie, body:{ text:'x', candidateId:'C-nope' }
      });
      record('Sourcing entries take no candidate', tagged.status===400, tagged.json.error);

      got = await req('/api/searches/'+sid+'/staff/sourcing', { method:'PUT', cookie: abe.cookie, expect:200, body:{ notes:'Pool is set.' } });
      record('Staff notes save', got.json.staff.sourcing.notes==='Pool is set.');

      got = await req('/api/searches/'+sid+'/staff/sourcing/complete', { method:'POST', cookie: abe.cookie, expect:200, body:{ done:true } });
      sourcing = got.json.steps.find(s => s.key==='sourcing');
      record('Consultant marks a staff step complete', sourcing.status==='done' && got.json.staff.sourcing.doneByName==='Abe Macy' && (got.json.activity||[]).some(a => /completed source and recruit/.test(a.x)));

      got = await req('/api/searches/'+sid+'/staff/sourcing/log', { method:'POST', cookie: abe.cookie, expect:200, body:{ text:'One more call.' } });
      sourcing = got.json.steps.find(s => s.key==='sourcing');
      record('New work reopens a completed staff step', sourcing.status!=='done' && !got.json.staff.sourcing.doneAt);

      got = await req('/api/searches/'+sid+'/staff/sourcing/log/'+entry.id, { method:'DELETE', cookie: abe.cookie, expect:200, body:{} });
      record('A staff log entry can be removed', !got.json.staff.sourcing.log.some(e => e.id===entry.id));
      const gone = await req('/api/searches/'+sid+'/staff/sourcing/log/'+entry.id, { method:'DELETE', cookie: abe.cookie, body:{} });
      record('Removing a missing log entry is 404', gone.status===404);
    } catch (err) { record('Staff step log', false, err.message); }

    // --- video interviews and reference checks are tied to candidates ---
    try {
      const sid = basicSearch.id;
      let got = await req('/api/searches/'+sid+'/candidates', { method:'POST', cookie: abe.cookie, expect:200, body:{ name:'Pat Finalist' } });
      const cand = got.json.candidates.find(c => c.name==='Pat Finalist');
      const early = await req('/api/searches/'+sid+'/staff/video/log', { method:'POST', cookie: abe.cookie, body:{ text:'x', candidateId: cand.id } });
      record('Video log refuses an applicant who is not a semifinalist', early.status===400 && /semifinalist/.test(early.json.error||''), early.json.error);
      await req('/api/searches/'+sid+'/candidates/'+cand.id, { method:'PATCH', cookie: abe.cookie, expect:200, body:{ stage:'semifinalist' } });
      got = await req('/api/searches/'+sid+'/staff/video/log', { method:'POST', cookie: abe.cookie, expect:200, body:{ text:'Strong on S1.', candidateId: cand.id } });
      record('Video log entry names the semifinalist', got.json.staff.video.log[0].candidateName==='Pat Finalist');

      const refsOnEnhanced = await req('/api/searches/'+sid+'/staff/references/log', { method:'POST', cookie: abe.cookie, body:{ text:'x' } });
      record('Enhanced refuses reference checks (Executive only)', refsOnEnhanced.status===400 && /Executive/.test(refsOnEnhanced.json.error||''));
      await req('/api/searches/'+sid, { method:'PATCH', cookie: abe.cookie, expect:200, body:{ package:'executive' } });

      const notFinal = await req('/api/searches/'+sid+'/staff/references/log', { method:'POST', cookie: abe.cookie, body:{ text:'x', candidateId: cand.id } });
      record('Reference log refuses a semifinalist', notFinal.status===400 && /finalist/.test(notFinal.json.error||''));
      await req('/api/searches/'+sid+'/candidates/'+cand.id, { method:'PATCH', cookie: abe.cookie, expect:200, body:{ stage:'finalist' } });
      const noConsent = await req('/api/searches/'+sid+'/staff/references/log', { method:'POST', cookie: abe.cookie, body:{ text:'Spoke with former mayor.', candidateId: cand.id } });
      record('Reference log refuses a finalist without recorded consent', noConsent.status===400 && /consent/.test(noConsent.json.error||''), noConsent.json.error);
      got = await req('/api/searches/'+sid+'/candidates/'+cand.id+'/consent', { method:'POST', cookie: abe.cookie, expect:200, body:{ consent:true } });
      const c2 = got.json.candidates.find(c => c.id===cand.id);
      record('Consent is recorded on the candidate', Boolean(c2.referenceConsentAt) && c2.referenceConsentBy==='Abe Macy');
      got = await req('/api/searches/'+sid+'/staff/references/log', { method:'POST', cookie: abe.cookie, expect:200, body:{ text:'Spoke with former mayor.', candidateId: cand.id } });
      record('Reference log accepts a consenting finalist', got.json.staff.references.log[0].candidateId===cand.id);

      // A committee member seated on this file reads it without the staff log.
      const seated = await req('/api/searches/'+sid+'/members', {
        method:'POST', cookie: abe.cookie, expect:200,
        body:{ name:'Staff Test Member', email:'staff-test-member@example.com', seat:'committee' }
      });
      if (seated.json.pin) {
        const member = await login('staff-test-member@example.com', seated.json.pin);
        const view = await req('/api/searches/'+sid, { cookie: member.cookie, expect:200 });
        record('Committee member does not see staff logs', view.json.staff && Object.keys(view.json.staff).length===0,
          'staff keys='+Object.keys(view.json.staff||{}).join(','));
        const denied = await req('/api/searches/'+sid+'/staff/references/log', { method:'POST', cookie: member.cookie, body:{ text:'x' } });
        record('Committee member cannot write to a staff log', denied.status===403, 'status='+denied.status);
      } else {
        record('Committee member does not see staff logs', false, 'no PIN returned for a fresh member');
      }
      await req('/api/searches/'+sid, { method:'DELETE', cookie: abe.cookie, expect:200 });
    } catch (err) { record('Video and reference staff steps', false, err.message); }
  }

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

  try {
    const empty = await req('/api/searches/bulk-delete', { method:'POST', cookie: abe.cookie, body:{ ids:[] } });
    record('Bulk delete requires at least one id', empty.status===400, empty.json.error);
    const a = await req('/api/searches', { method:'POST', cookie: abe.cookie, expect:200, body:{ client:'Bughunt Bulk A', position:'Clerk', package:'basic' } });
    const b = await req('/api/searches', { method:'POST', cookie: abe.cookie, expect:200, body:{ client:'Bughunt Bulk B', position:'Clerk', package:'basic' } });
    const out = await req('/api/searches/bulk-delete', {
      method:'POST', cookie: abe.cookie, expect:200, body:{ ids:[a.json.id, b.json.id, a.json.id] }
    });
    const list = await req('/api/searches', { cookie: abe.cookie, expect:200 });
    record('Bulk delete removes every selected search',
      out.json.deleted===2 && !list.json.some(s => s.id===a.json.id || s.id===b.json.id),
      'deleted='+out.json.deleted);
    const gone = await req('/api/searches/bulk-delete', { method:'POST', cookie: abe.cookie, body:{ ids:['sr-nope'] } });
    record('Bulk delete of unknown ids is 404', gone.status===404);
  } catch (err) { record('Bulk delete removes every selected search', false, err.message); }

  // Ten real-looking jurisdictions × each pay level. Walking these in the
  // browser repeats the same three rails; this creates the file, checks the
  // facts and the package cut, then deletes it so Home stays clean.
  try {
    const steps = require('../server/steps');
    const keysOf = pkg => steps.stepsFor(pkg).map(s => s.key);
    const cities = [
      { client:'City of Bozeman', website:'https://www.bozeman.net', position:'City Manager', state:'Montana', fog:'Commission-Manager (charter government)', population:'56,123', budget:'$180 million', salary:'$180,000 to $220,000' },
      { client:'City of Portland', website:'https://www.portland.gov', position:'City Administrator', state:'Oregon', fog:'Mayor–Council with a city administrator', population:'635,749', budget:'$7.8 billion', salary:'$280,000 to $320,000' },
      { client:'City and Borough of Juneau', website:'https://juneau.org', position:'City Manager', state:'Alaska', fog:'Assembly–Manager (unified borough)', population:'31,685', budget:'$420 million', salary:'$190,000 to $230,000' },
      { client:'Louisville Metro Government', website:'https://louisvilleky.gov', position:'Chief Administrative Officer', state:'Kentucky', fog:'Mayor–Council (consolidated city-county)', population:'640,000', budget:'$1.4 billion', salary:'$210,000 to $250,000' },
      { client:'City of Kansas City', website:'https://www.kcmo.gov', position:'City Manager', state:'Missouri', fog:'Council–Manager', population:'508,090', budget:'$2.1 billion', salary:'$240,000 to $280,000' },
      { client:'City of Virginia Beach', website:'https://www.vbgov.com', position:'City Manager', state:'Virginia', fog:'Council–Manager', population:'457,383', budget:'$2.3 billion', salary:'$250,000 to $290,000' },
      { client:'Salt Lake City', website:'https://www.slc.gov', position:'Chief Administrative Officer', state:'Utah', fog:'Mayor–Council (strong mayor)', population:'209,593', budget:'$1.2 billion', salary:'$200,000 to $240,000' },
      { client:'Town of Chapel Hill', website:'https://www.townofchapelhill.org', position:'Town Manager', state:'North Carolina', fog:'Council–Manager', population:'62,043', budget:'$160 million', salary:'$185,000 to $220,000' },
      { client:'District of Columbia', website:'https://dc.gov', position:'City Administrator', state:'District of Columbia', fog:'Mayor–Council (home rule)', population:'678,972', budget:'$21 billion', salary:'$250,000 to $300,000' },
      { client:'Gallatin County', website:'https://www.gallatin.mt.gov', position:'County Administrator', state:'Montana', fog:'County Commission with an administrator', population:'122,713', budget:'$180 million', salary:'$160,000 to $190,000' }
    ];
    const pkgs = ['basic','enhanced','executive'];
    const gated = {
      basic: { path:'/artifact/community', method:'PUT', body:{ body:{ lede:'x' } } },
      enhanced: { path:'/staff/references/log', method:'POST', body:{ text:'Called a reference.' } }
    };
    const leftover = await req('/api/searches', { cookie: abe.cookie, expect:200 });
    for (const row of leftover.json) {
      if (/^Bughunt · /.test(row.client||'')) {
        await req('/api/searches/'+row.id, { method:'DELETE', cookie: abe.cookie });
      }
    }
    const misses = [];
    let opened = 0;
    for (const city of cities) {
      for (const pkg of pkgs) {
        const created = await req('/api/searches', {
          method:'POST', cookie: abe.cookie, expect:200,
          body:{ ...city, client:'Bughunt · '+city.client, package:pkg }
        });
        opened++;
        const s = created.json;
        const want = keysOf(pkg);
        const got = (s.steps||[]).map(st => st.key);
        if (s.fog !== city.fog) misses.push(s.no+' fog='+s.fog);
        if (s.website !== city.website || s.position !== city.position || s.state !== city.state) misses.push(s.no+' facts');
        if (got.join(',') !== want.join(',')) misses.push(s.no+' steps='+got.join(','));
        if (s.progress?.next?.key !== 'team') misses.push(s.no+' next='+(s.progress?.next?.key||''));
        const probe = gated[pkg];
        if (probe) {
          const off = await req('/api/searches/'+s.id+probe.path, { method:probe.method, cookie: abe.cookie, body:probe.body });
          if (off.status !== 400 || !/package/.test(off.json.error||'')) misses.push(s.no+' gating '+pkg);
        }
        await req('/api/searches/'+s.id, { method:'DELETE', cookie: abe.cookie, expect:200 });
      }
    }
    const after = await req('/api/searches', { cookie: abe.cookie, expect:200 });
    const leaked = after.json.filter(row => /^Bughunt · /.test(row.client||''));
    record('City book: 10 jurisdictions × 3 packages persist FOG, steps, and gating',
      opened===30 && !misses.length && !leaked.length,
      misses.length ? misses.slice(0,6).join(' | ') : 'opened='+opened);
  } catch (err) { record('City book: 10 jurisdictions × 3 packages persist FOG, steps, and gating', false, err.message); }

  // --- profile / steps ---
  try {
    const got = await req('/api/searches/'+search.id, { cookie: abe.cookie, expect:200 });
    const profile = got.json.steps.find(s=>s.key==='profile');
    const community = got.json.steps.find(s=>s.key==='community');
    const brochure = got.json.steps.find(s=>s.key==='brochure');
    const survey1 = got.json.steps.find(s=>s.key==='survey1');
    const bar = got.json.steps.find(s=>s.key==='bar');
    const send2 = got.json.steps.find(s=>s.key==='send2');
    const team = got.json.steps.find(s=>s.key==='team');
    const intake = got.json.steps.find(s=>s.key==='intake');
    record('New search: the roster is next / not blocked', team && !team.blocked && team.status!=='done');
    record('Intake waits on the roster being confirmed', intake && intake.blocked===true);
    record('The profile waits on committee intake', profile && profile.blocked===true);
    record('Community waits on the candidate profile', community && community.blocked===true);
    record('Brochure waits on the ad plan', brochure && brochure.blocked===true);
    record('Initial survey waits on the profile', survey1 && survey1.blocked===true);
    record('Candidate-phase steps wait for a person on the file', bar.blocked===true && send2.blocked===true, 'bar='+bar.blocked+' send2='+send2.blocked);
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
    const survey1 = saved.json.steps.find(s=>s.key==='survey1');
    record('Community unlocks after the profile is done', community && community.blocked===false);
    record('Initial survey unlocks after the profile is done', survey1 && survey1.blocked===false);
  } catch (err) { record('Profile with 3-5 of each kind is done', false, err.message); }

  try {
    await req('/api/searches/'+search.id+'/artifact/community', {
      method:'PUT', cookie: abe.cookie, expect:200,
      body:{ body:{ lede:'A mountain town.', facts:[{k:'Pop',v:'12,000'}], government:'CM', community:'x', organization:'y', why:'z' } }
    });
    const got = await req('/api/searches/'+search.id, { cookie: abe.cookie, expect:200 });
    record('Save community artifact', Boolean(got.json.artifacts.community && got.json.artifacts.community.lede));
    const brochure = got.json.steps.find(s=>s.key==='brochure');
    record('Brochure still waits on the ad plan after community', brochure.blocked===true, 'blocked='+brochure.blocked);
    await req('/api/searches/'+search.id+'/artifact/plan', {
      method:'PUT', cookie: abe.cookie, expect:200,
      body:{ body:{ rows:[{ outlet:'ICMA', audience:'managers', format:'full', when:'week 1', cost:'', who:'Abe', status:'planned' }] } }
    });
    const afterPlan = await req('/api/searches/'+search.id, { cookie: abe.cookie, expect:200 });
    const brochure2 = afterPlan.json.steps.find(s=>s.key==='brochure');
    record('Brochure unlocks after the ad plan', brochure2.blocked===false, 'blocked='+brochure2.blocked);
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

  // A drafted brochure is not a finished brochure. It stays 'now' until a
  // consultant signs off, and any later edit reopens it.
  try {
    const got = await req('/api/searches/'+search.id, { cookie: abe.cookie, expect:200 });
    const b = got.json.steps.find(s=>s.key==='brochure');
    record('Drafted brochure waits on review, not done', b.status==='now', 'status='+b.status);

    const ok = await req('/api/searches/'+search.id+'/artifact/brochure/review', {
      method:'POST', cookie: abe.cookie, expect:200, body:{ approve:true }
    });
    const after = ok.json.steps.find(s=>s.key==='brochure');
    const rec = ok.json.reviews && ok.json.reviews.brochure;
    record('Consultant review completes the brochure step', after.status==='done' && rec && rec.byName==='Abe Macy',
      'status='+after.status);

    const edited = await req('/api/searches/'+search.id+'/artifact/brochure', {
      method:'PUT', cookie: abe.cookie, expect:200,
      body:{ body:{ ...got.json.artifacts.brochure, lede:'Reworded after review.' } }
    });
    const reopened = edited.json.steps.find(s=>s.key==='brochure');
    record('Editing after review sends the brochure back to draft',
      reopened.status==='now' && !(edited.json.reviews||{}).brochure, 'status='+reopened.status);
  } catch (err) { record('Brochure review gate', false, err.message); }

  try {
    const nope = await req('/api/searches/'+search.id+'/artifact/survey1/review', {
      method:'POST', cookie: abe.cookie, body:{ approve:true }
    });
    record('Review is refused on steps that do not take one', nope.status===400, 'status='+nope.status);
    const unauth = await req('/api/searches/'+search.id+'/artifact/brochure/review', {
      method:'POST', body:{ approve:true }
    });
    record('Review requires sign-in', unauth.status===401, 'status='+unauth.status);
  } catch (err) { record('Review guards', false, err.message); }

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

  // Mike can open Abe's search (no ACL between consultants)
  try {
    const got = await req('/api/searches/'+search.id, { cookie: mike.cookie, expect:200 });
    record('Any signed-in consultant can open any search (no per-search ACL)', got.json.id===search.id);
  } catch (err) { record('Any signed-in consultant can open any search (no per-search ACL)', false, err.message); }

  // --- the shared team sign-in ---
  // One generic firm account so day-to-day work does not require remembering
  // which named consultant you are. It must be able to pick up a search it was
  // never seated on, which is the case that used to dead-end.
  try {
    const team = await login(process.env.SLATE_EMAIL_TEAM || 'team@slate.local', process.env.SLATE_PIN_TEAM || '1234');
    record('The shared team account signs in', Boolean(team.cookie));
    record('The shared team account is a consultant', team.json.user.role === 'consultant', team.json.user.role);

    const seen = await req('/api/searches', { cookie: team.cookie, expect:200 });
    record('The shared account sees the whole book', seen.json.some(s => s.id === search.id));

    const before = await req('/api/searches/'+search.id, { cookie: team.cookie, expect:200 });
    record('An unseated consultant can read and edit but does not hold the account',
      before.json.you.canEdit===true && before.json.you.canManage===false && before.json.you.member===false,
      JSON.stringify(before.json.you));

    const joined = await req('/api/searches/'+search.id+'/members/self', { method:'POST', cookie: team.cookie, expect:200, body:{} });
    record('A consultant can put themselves on a search', joined.json.search.you.seat==='consultant');
    await req('/api/searches/'+search.id+'/members/self', { method:'POST', cookie: team.cookie, expect:409, body:{} });
    record('Joining a search twice is refused', true);

    const took = await req('/api/searches/'+search.id+'/members/'+team.json.user.id, {
      method:'PATCH', cookie: team.cookie, expect:200, body:{ seat:'manager' }
    });
    record('Any consultant can take an account rather than being stranded by it',
      took.json.search.accountManager.userId===team.json.user.id);
    record('The outgoing manager keeps a consultant seat',
      took.json.roster.find(m => m.userId===abe.json.user.id).seat==='consultant');
    await req('/api/searches/'+search.id+'/team/confirm', { method:'POST', cookie: team.cookie, expect:200, body:{ confirmed:true } });
    record('Taking the account carries the powers that go with it', true);

    // Hand it back so later assertions see the search as they expect.
    await req('/api/searches/'+search.id+'/members/'+abe.json.user.id, {
      method:'PATCH', cookie: team.cookie, expect:200, body:{ seat:'manager' }
    });
    await req('/api/searches/'+search.id+'/members/'+team.json.user.id, {
      method:'DELETE', cookie: abe.cookie, expect:200
    });
  } catch (err) { record('Shared team sign-in', false, err.message); }

  // --- search committee: roster, intake, consensus ---
  // A whole second search, so the committee flow is exercised from an empty
  // file rather than against one already driven to the finalist stage.
  let cm = null;
  try {
    const opened = await req('/api/searches', {
      method:'POST', cookie: abe.cookie, expect:200,
      body:{ client:'City of Quorum', position:'City Manager', state:'Nevada' }
    });
    cm = { id: opened.json.id };
    record('Opening a search seats the creator as account manager',
      opened.json.accountManager && opened.json.accountManager.role==='consultant' && opened.json.roster.length===1);

    const seated = [];
    for (const who of [
      { name:'Rosa Lin', email:'rosa@quorum.test', title:'Mayor' },
      { name:'Ben Ruiz', email:'ben@quorum.test', title:'Council member' },
      { name:'Tia Novak', email:'tia@quorum.test', title:'Council member' }
    ]) {
      const out = await req('/api/searches/'+cm.id+'/members', {
        method:'POST', cookie: abe.cookie, expect:200, body:{ ...who, seat:'committee' }
      });
      seated.push({ ...who, pin: out.json.pin });
    }
    record('Seating a new member returns a one-time sign-in PIN',
      seated.length===3 && seated.every(x => /^\d{8}$/.test(x.pin || '')));

    await req('/api/searches/'+cm.id+'/members', {
      method:'POST', cookie: abe.cookie, expect:400, body:{ name:'Bad Email', email:'not-an-email' }
    });
    record('A member needs a real email to sign in with', true);

    const rosa = await login(seated[0].email, seated[0].pin);
    const ben = await login(seated[1].email, seated[1].pin);
    const tia = await login(seated[2].email, seated[2].pin);

    const mine = await req('/api/searches', { cookie: rosa.cookie, expect:200 });
    record('A committee member sees only the searches they are seated on',
      mine.json.length===1 && mine.json[0].id===cm.id, 'saw '+mine.json.length);

    await req('/api/searches/'+search.id, { cookie: rosa.cookie, expect:404 });
    record('A search they are not seated on reads as not found', true);

    await req('/api/searches/'+cm.id, { method:'PATCH', cookie: rosa.cookie, expect:403, body:{ notes:'x' } });
    record('A committee member cannot edit the search file', true);

    await req('/api/searches/'+cm.id+'/intake/status', {
      method:'POST', cookie: abe.cookie, expect:400, body:{ status:'open' }
    });
    record('Intake will not open until the roster is confirmed', true);

    const confirmed = await req('/api/searches/'+cm.id+'/team/confirm', {
      method:'POST', cookie: abe.cookie, expect:200, body:{ confirmed:true }
    });
    record('Confirming the roster completes the committee step',
      confirmed.json.steps.find(s=>s.key==='team').status==='done');

    await req('/api/searches/'+cm.id+'/intake/status', {
      method:'POST', cookie: abe.cookie, expect:200, body:{ status:'open', dueBy:'12 Sep 2026' }
    });
    await req('/api/searches/'+cm.id+'/intake/status', {
      method:'POST', cookie: mike.cookie, expect:403, body:{ status:'closed' }
    });
    record('Only the account manager runs the intake window', true);

    // Three members, three spellings of the same priority, one real split.
    await req('/api/searches/'+cm.id+'/intake', {
      method:'PUT', cookie: rosa.cookie, expect:200,
      body:{ submitted:true, mustHave:'Someone who answers the phone.', items:[
        { kind:'skill', label:'Financial management', weight:5, note:'Structural deficit.' },
        { kind:'trait', label:'Approachable', weight:5 },
        { kind:'chall', label:'Structural deficit', weight:5 }
      ]}
    });
    await req('/api/searches/'+cm.id+'/intake', {
      method:'PUT', cookie: ben.cookie, expect:200,
      body:{ submitted:true, items:[
        { kind:'skill', label:'financial management skills', weight:4 },
        { kind:'trait', label:'approachable', weight:2 },
        { kind:'chall', label:'structural deficit', weight:4 }
      ]}
    });
    await req('/api/searches/'+cm.id+'/intake', {
      method:'PUT', cookie: tia.cookie, expect:200,
      body:{ submitted:true, items:[
        { kind:'skill', label:'The financial management', weight:5 },
        { kind:'trait', label:'Decisive', weight:4 },
        { kind:'chall', label:'Staff turnover', weight:5 }
      ]}
    });

    const midway = await req('/api/searches/'+cm.id, { cookie: ben.cookie, expect:200 });
    record('While intake is open a member sees only their own answers',
      Object.keys(midway.json.intake.submissions).length===1);
    record('While intake is open a member sees no running tally',
      midway.json.consensus===null);

    const facing = await req('/api/searches/'+cm.id, { cookie: abe.cookie, expect:200 });
    const agg = facing.json.consensus;
    record('The account manager sees the tally as answers arrive', agg && agg.submitted===3, 'submitted='+(agg&&agg.submitted));
    const money = agg.byKind.skill[0];
    record('Different phrasings of one priority fold into a single entry',
      money.mentions===3 && money.label==='Financial management', money.label+' x'+money.mentions);
    record('Unanimous agreement is labeled as such', money.consensus==='unanimous', money.consensus);
    const split = agg.byKind.trait.find(e => /approach/i.test(e.label));
    record('A committee that disagrees on weight is flagged contested',
      split && split.contested===true && split.minWeight===2 && split.maxWeight===5);
    record('Members who have not answered are listed by name',
      agg.pending.some(p => p.name==='Abe Macy'));

    const adopted = await req('/api/searches/'+cm.id+'/intake/adopt', {
      method:'POST', cookie: abe.cookie, expect:200, body:{}
    });
    const crit = adopted.json.search.criteria;
    const top = crit.find(c => c.label==='Financial management');
    record('The profile can be built from what the committee said',
      Boolean(top) && top.from==='committee' && top.weight===5, JSON.stringify(top));
    record('Each adopted line records how many members named it',
      /Named by 3 of 3/.test(top.note), top.note);
    record('Kinds the committee left thin are reported as gaps',
      Array.isArray(adopted.json.gaps) && adopted.json.gaps.some(g => g.kind==='opp'));

    const closed = await req('/api/searches/'+cm.id+'/intake/status', {
      method:'POST', cookie: abe.cookie, expect:200, body:{ status:'closed' }
    });
    record('Closing the window completes the intake step',
      closed.json.steps.find(s=>s.key==='intake').status==='done');

    const after = await req('/api/searches/'+cm.id, { cookie: ben.cookie, expect:200 });
    record('Once closed the committee can read the room',
      after.json.consensus && after.json.consensus.submitted===3 &&
      Object.keys(after.json.intake.submissions).length===3);

    await req('/api/searches/'+cm.id+'/intake', {
      method:'PUT', cookie: ben.cookie, expect:400, body:{ submitted:true, items:[{ kind:'skill', label:'Late', weight:5 }] }
    });
    record('A closed window does not take late answers', true);

    const roster = (await req('/api/searches/'+cm.id, { cookie: abe.cookie, expect:200 })).json.roster;
    const rosaId = roster.find(m => m.email===seated[0].email).userId;
    await req('/api/searches/'+cm.id+'/members/'+rosaId, {
      method:'PATCH', cookie: abe.cookie, expect:400, body:{ seat:'manager' }
    });
    record('The account manager must be a consultant at the firm', true);

    const removed = await req('/api/searches/'+cm.id+'/members/'+rosaId, {
      method:'DELETE', cookie: abe.cookie, expect:200
    });
    record('Removing a member takes their answers out of the tally',
      removed.json.search.consensus.submitted===2, 'submitted='+removed.json.search.consensus.submitted);
    // The account existed only for this seat. Removing them retires it, which
    // kills the open session as well as the sign-in, rather than leaving a
    // live PIN pointed at nothing.
    await req('/api/searches/'+cm.id, { cookie: rosa.cookie, expect:401 });
    record('Removing a member ends their open session', true);
    const relog = await req('/api/login', {
      method:'POST', expect:401, body:{ email: seated[0].email, pin: seated[0].pin }
    });
    record('An unseated member can no longer sign in', relog.status===401);

    const cfg = await req('/api/config', { expect:200 });
    record('Demo sign-ins never list committee PINs',
      (cfg.json.accounts||[]).every(a => !String(a.email).endsWith('@quorum.test')));
  } catch (err) {
    record('Search committee flow', false, err.message);
  } finally {
    if (cm) { try { await req('/api/searches/'+cm.id, { method:'DELETE', cookie: abe.cookie }); } catch {} }
  }

  // --- unit: consensus folding ---
  try {
    const committee = require('../server/committee');
    const fixture = {
      members: [
        { userId:'a', seat:'committee' }, { userId:'b', seat:'committee' },
        { userId:'c', seat:'committee' }, { userId:'d', seat:'committee' }
      ],
      intake: { submissions: {
        a: { submitted:true, items:[{ kind:'skill', label:'Community engagement', weight:5 }] },
        b: { submitted:true, items:[{ kind:'skill', label:'strong community engagement skills', weight:4 }] },
        // Never submitted: must not count toward the denominator.
        c: { submitted:false, items:[{ kind:'skill', label:'Community engagement', weight:1 }] },
        d: { submitted:true, items:[{ kind:'skill', label:'Economic development', weight:2 }] }
      }}
    };
    const agg = committee.aggregate(fixture, id => id.toUpperCase());
    record('Drafts do not count toward the committee denominator', agg.submitted===3, 'submitted='+agg.submitted);
    const eng = agg.byKind.skill.find(e => /community/i.test(e.label));
    record('Filler words do not split one priority into two',
      eng.mentions===2 && agg.byKind.skill.length===2, JSON.stringify(agg.byKind.skill.map(e=>e.label)));
    record('The tidier phrasing becomes the adopted label', eng.label==='Community engagement', eng.label);
    const merged = committee.mergeIntoCriteria(
      [{ kind:'skill', label:'Intergovernmental relations', weight:3, note:'mine' }], agg);
    record('Adoption keeps hand-written criteria behind the consensus',
      merged.some(c => c.label==='Intergovernmental relations' && c.from==='consultant') &&
      merged[0].label==='Community engagement');
    record('Adoption never exceeds five items in a kind',
      merged.filter(c => c.kind==='skill').length <= 5);
    record('Consensus never leaks a name when the caller withholds it',
      committee.aggregate(fixture, () => '').byKind.skill[0].voters.every(v => v.name===''));
  } catch (err) { record('Consensus folding', false, err.message); }

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
  if (process.env.SLATE_NETWORK_TESTS === 'true') try {
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

  // --- desk editor: code-side review of Claude drafts ---
  const deskSearch = {
    id:'desk-test', client:'City of Ridgeline', position:'City Manager', state:'CO', fog:'Council-Manager',
    population:'12,400 (2024 ACS)', budget:'$41.2 million general fund (FY2026)', salary:'$150,000 to $180,000',
    firstReview:'14 September 2026', notes:'', website:'https://ridgeline.gov/page-2048',
    criteria:[
      { id:'S1', kind:'skill', label:'Finance', weight:5, note:'' },
      { id:'C1', kind:'chall', label:'Deficit', weight:5, note:'' }
    ],
    artifacts:{}
  };
  const eightQs = extra => Array.from({ length:8 }, (_, i) => ({ n:i+1, prompt:'Question '+(i+1), type:'short', required:true, crit:[], ...(extra && extra(i) || {}) }));

  try {
    const f = desk.review('survey1', {
      name:'Initial Candidate Survey', intro:'Thanks for applying — we are glad you did!', dueHint:'',
      questions: eightQs(i => i===2 ? { crit:['S9'] } : { crit:['S1'] })
    }, deskSearch, [deskSearch]);
    const msgs = f.map(x => x.msg).join('\n');
    record('Desk flags em dashes', f.some(x => x.code==='style' && /dash/.test(x.msg)), msgs);
    record('Desk flags exclamation points', f.some(x => x.code==='style' && /exclamation/.test(x.msg)));
    record('Desk flags criterion ids not on the profile', f.some(x => x.code==='criteria' && /"S9"/.test(x.msg) && /S1, C1/.test(x.msg)));
    record('Desk accepts criterion ids that are on the profile', !f.some(x => x.code==='criteria' && /"S1"/.test(x.msg)));
  } catch (err) { record('Desk flags em dashes', false, err.message); }

  try {
    const f = desk.review('brochure', {
      title:'City Manager, Ridgeline', lede:'Founded in 1889, Ridgeline has about 12,400 residents.',
      theOpportunity:'The general fund is $41 million.', thePlace:'A $3.5 million bond passed last year.',
      theOrganization:'Roughly 210 employees across nine departments.', ideal:'x', theJob:'x', howToApply:'Apply at https://ridgeline.gov/jobs/99999 or call 970-555-0100.',
      compensation:'$150,000 to $180,000, depending on qualifications.'
    }, deskSearch, [deskSearch]);
    const nums = f.filter(x => x.code==='number');
    record('Desk flags a dollar figure that is not on file', nums.some(x => /\$3\.5 million/.test(x.msg)), nums.map(x=>x.msg).join(' | '));
    record('Desk accepts figures that are on file (rounded, comma, and range forms)',
      !nums.some(x => /12,400|\$41 million|\$150,000|\$180,000/.test(x.msg)));
    record('Desk ignores years and URLs', !nums.some(x => /"1889"|"99999"|"2048"/.test(x.msg)));
    record('Desk flags an invented phone number', nums.some(x => /0100/.test(x.msg)));
  } catch (err) { record('Desk flags a dollar figure that is not on file', false, err.message); }

  try {
    const f = desk.review('plan', { rows:[{ outlet:'ICMA', audience:'Managers', format:'full', when:'Week 1', cost:'$450', who:'Abe', status:'planned' }] }, deskSearch, [deskSearch]);
    record('Desk does not treat ad costs as facts to verify', !f.some(x => x.code==='number'), f.map(x=>x.msg).join(' | '));
    const g = desk.review('bar', {
      behavior:[{ id:'B1', t:'Listens', d:'', from:'T7' }], actions:[{ id:'A1', t:'Adopt budget', due:'June 2027' }],
      results:[{ id:'R1', t:'Reserve', target:'$2,000,000', from:'C1' }], governance:['Item'], cadence:{ beginning:[], midyear:[], annual:[] }
    }, deskSearch, [deskSearch]);
    record('Desk checks BAR "from" ids but not BAR targets',
      g.some(x => x.code==='criteria' && /"T7"/.test(x.msg)) && !g.some(x => x.code==='number'), g.map(x=>x.msg).join(' | '));
  } catch (err) { record('Desk does not treat ad costs as facts to verify', false, err.message); }

  try {
    const f = desk.review('survey2', { name:'Semifinalist Questionnaire', intro:'', dueHint:'', questions: eightQs().slice(0, 4) }, deskSearch, [deskSearch]);
    record('Desk flags a question count the schema did not ask for', f.some(x => x.code==='shape' && /exactly 5/.test(x.msg)));
    const p = desk.review('profile', { criteria:[
      { id:'S1', kind:'skill', label:'Finance', weight:5, note:'' },
      { id:'S1', kind:'skill', label:'Budgeting', weight:9, note:'' },
      { id:'T1', kind:'trait', label:'Calm', weight:3, note:'' }
    ] }, deskSearch, [deskSearch]);
    record('Desk checks the profile draft for duplicate ids, weight range, and kind floors',
      p.some(x => /used twice/.test(x.msg)) && p.some(x => /weight must be/.test(x.msg)) && p.some(x => /kind chall/.test(x.msg)));
    const clean = desk.review('ads', {
      openingDate:'1 October 2026', firstReview:'14 September 2026', closing:'Until filled', apply:'ridgeline.gov', contact:'Abe',
      full:{ headline:'City Manager', body:'Ridgeline, CO. $150,000 to $180,000.' }, short:{ headline:'h', body:'b' },
      social:{ headline:'h', body:'b' }, association:{ headline:'h', body:'b' }
    }, deskSearch, [deskSearch]);
    record('Desk passes a clean draft with no findings', clean.length===0, clean.map(x=>x.msg).join(' | '));
    record('Desk note to Claude lists findings and asks for the full JSON back',
      /desk editor reviewed/.test(desk.describe(f)) && /complete corrected JSON/.test(desk.describe(f)));
  } catch (err) { record('Desk flags a question count the schema did not ask for', false, err.message); }

  // The review loop in generate(), with a fake model so no key is needed.
  try {
    const dirty = { name:'Initial Candidate Survey', intro:'Welcome — glad you are here!', dueHint:'', questions: eightQs(() => ({ crit:['S1'] })) };
    const cleanQ = { ...dirty, intro:'Welcome. We are glad you are here.' };
    const seen = [];
    const fake = replies => async req => {
      seen.push(req);
      const body = replies.shift();
      return { content:[{ type:'text', text: typeof body === 'string' ? body : JSON.stringify(body) }], usage:{ input_tokens:10, output_tokens:5 } };
    };
    const out = await generate('survey1', deskSearch, { call: fake([dirty, cleanQ]) });
    record('generate sends desk findings back to Claude and keeps the fixed draft',
      out.desk.rounds===2 && out.desk.found>0 && out.desk.open.length===0 && out.json.intro===cleanQ.intro
        && seen[1].messages.length===3 && seen[1].messages[1].role==='assistant' && /desk editor/.test(seen[1].messages[2].content),
      JSON.stringify(out.desk));
    record('generate sums usage across review rounds', out.usage.input_tokens===20 && out.usage.output_tokens===10);

    const once = await generate('survey1', deskSearch, { call: fake([cleanQ]) });
    record('generate stops after one round when the desk is satisfied', once.desk.rounds===1 && once.desk.found===0 && once.desk.open.length===0);

    const stuck = await generate('survey1', deskSearch, { call: fake([dirty, 'not json at all']) });
    record('generate keeps the best draft when a fix round comes back unusable',
      stuck.json.intro===dirty.intro && stuck.desk.open.length>0 && stuck.desk.rounds===2, JSON.stringify(stuck.desk));

    const worse = { ...dirty, intro:'Welcome — glad — you — are here!' };
    const capped = await generate('survey1', deskSearch, { call: fake([dirty, worse, worse, worse]) });
    record('generate caps review rounds and does not adopt a worse revision',
      capped.desk.rounds===3 && capped.json.intro===dirty.intro, JSON.stringify(capped.desk));
  } catch (err) { record('generate sends desk findings back to Claude and keeps the fixed draft', false, err.stack || err.message); }

  // --- static analysis of frontend ---
  const fs = require('fs');
  const path = require('path');
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const stylesCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  const appCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.css'), 'utf8');

  record('Apply UI handles survey1 and survey2', /function pickApplySurvey/.test(appJs) && /survey2/.test(appJs));

  record('Rail splits screening, questionnaire, and finalists', /function railPhaseGroups/.test(appJs) && /screen:'Screening'/.test(appJs) && /send2:'Semifinalist questionnaire'/.test(appJs) && /finalists:'Finalists'/.test(appJs));

  record('Search runs in three phases', /Seat the committee and hear them/.test(appJs) && /Prepare and post/.test(appJs) && /Once there are candidates/.test(appJs) && /needsCandidates/.test(fs.readFileSync(path.join(__dirname, '..', 'server', 'db.js'), 'utf8')));

  record('Signed-in card does not shrink in a short rail', /\.rail > \* \{ flex-shrink: 0; \}/.test(stylesCss) && /\.whoami\{[^}]*overflow:hidden/.test(stylesCss));

  record('Ad plan preview includes who and status', /Who<\/th>/.test(appJs) && /Status<\/th>/.test(appJs));

  record('Interview guide preview renders scenarios', /Assessment scenarios/.test(appJs));

  record('BAR preview renders actions, governance, and cadence', /Governing body governance survey/.test(appJs) && /Annual cadence/.test(appJs));

  const aiJs = fs.readFileSync(path.join(__dirname, '..', 'server', 'ai.js'), 'utf8');
  record('Claude prompts forbid em dashes', /Do not use em dashes/.test(aiJs) && /SYSTEM = `[\s\S]*em dashes/.test(aiJs) && /RESEARCH_AGENT = `[\s\S]*em dashes/.test(aiJs));
  record('Claude prompts name steps from the catalog', /function stepNo/.test(aiJs) && !/Draft the Step \d/.test(aiJs));
  const schemaBlock = (aiJs.match(/const SCHEMAS = \{[\s\S]*?\n\};/) || [''])[0];
  record('Schema examples do not model the dashes the desk rejects', schemaBlock.length > 0 && !/[\u2013\u2014]/.test(schemaBlock));
  record('Generate route returns the desk review to the client', /desk: out\.desk/.test(fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8')) && /function deskNote/.test(appJs) && /deskNote\(out\.desk\)/.test(appJs));

  record('Unsigned home is the price structure', /function vGate/.test(appJs) && /What each pay level includes/.test(appJs) && /data-go="login"/.test(appJs) && /Three ways to run a search/.test(appJs));

  record('Sign-in is just email and PIN', /function vLogin/.test(appJs) && /Open workspace/.test(appJs) && !/Two phases/.test(appJs) && /Back to packages/.test(appJs));

  record('Home page is the workspace landing', /head\('Home'/.test(appJs) && /Welcome back/.test(appJs) && />Home</.test(appJs) && !/How a search runs/.test(appJs));

  record('Home can delete more than one search at once',
    /data-act="delete-searches"/.test(appJs) && /data-act="pick-all"/.test(appJs) && /data-pick-search/.test(appJs)
      && /\/api\/searches\/bulk-delete/.test(appJs) && /app\.post\('\/api\/searches\/bulk-delete'/.test(fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8')));

  record('New search opens on the search committee', /go\('team'\)/.test(appJs) && /Seat the committee first/.test(appJs));

  record('New search and Search facts offer the package picker',
    /function packagePicker/.test(appJs) && /name="package"/.test(appJs) && /packagePicker\(state\.newPackage \|\| state\.health\?\.defaultPackage\)/.test(appJs) && /packagePicker\(s\.package\)/.test(appJs));
  record('The package picker is the pay-level breakdown matrix',
    /function packageMatrix/.test(appJs) && /Potential fee/.test(appJs) && /What each pay level includes/.test(appJs)
      && /\.pkgmx/.test(appCss) && /pkgmx--pick:has/.test(appCss));
  record('Each pay level has a sample workspace view',
    /function vPackages/.test(appJs) && /function demoSearch/.test(appJs) && /data-go="packages"/.test(appJs)
      && /case 'packages'/.test(appJs) && /showtabs/.test(appCss) && /data-act="new-from-pkg"/.test(appJs));

  record('Navigating to a step outside the package lands on the overview', /function offPackage/.test(appJs) && /offPackage\(view\)/.test(appJs));

  record('Ads page does not assume a brochure on Basic', /key==='ads' && stepOf\('brochure'\)/.test(appJs));

  record('Overview layout follows the package view from the catalog',
    /function overviewView/.test(appJs) && /packageInfo\?\.view/.test(appJs) && /view\.layout === 'dashboard'/.test(appJs) && /view\.steps === 'strip'/.test(appJs)
      && /const DASH = \{/.test(appJs) && /function stepStrip/.test(appJs) && /function phaseSpecs/.test(appJs));

  record('Overview panels only link steps the viewer can open', /function canOpenStep/.test(appJs) && /COMMITTEE_STEPS\.has\(key\)/.test(appJs));

  record('Staff steps have their own page with a log, notes, and sign-off',
    /function vStaff/.test(appJs) && /data-act="staff-log"/.test(appJs) && /data-act="staff-notes"/.test(appJs) && /data-act="staff-done"/.test(appJs) && /act==='staff-log-del'/.test(appJs));

  record('Reference checks record consent per finalist', /data-act="ref-consent"/.test(appJs) && /candidates\/'\+t\.dataset\.cid\+'\/consent/.test(appJs) && /No consent yet/.test(appJs));

  record('Staff page reads text before withBusy', /act==='staff-log'[\s\S]*#staff-text[\s\S]*withBusy/.test(appJs) && /act==='staff-notes'[\s\S]*#staff-notes[\s\S]*withBusy/.test(appJs));

  record('Committee intake has its own step and view', /function vIntake\b/.test(appJs) && /function vTeam\b/.test(appJs) && /data-act="submit-intake"/.test(appJs));

  record('Consensus is drawn as a share of the committee', /function consensusMeter/.test(appJs) && /cons__bar/.test(appJs) && /Contested/.test(appJs));

  record('The profile can be built from committee input', /data-act="adopt-consensus"/.test(appJs) && /intake\/adopt/.test(appJs));

  record('Step numbers are read from the server catalog, not hardcoded',
    !/Step 1'|Step 2'|Step 9'|Step 14'/.test(appJs) && /function stepNo/.test(appJs));

  record('Profile has a 3 to 5 skill picker', /data-pick/.test(appJs) && /Strategic leadership/.test(appJs));

  record('The profile step has Save and move on', /save-profile-next/.test(appJs) && /Save and move on/.test(appJs));

  record('Saving the profile and moving on follows the package, not Community', (() => {
    const persist = (appJs.match(/async function persistProfile[\s\S]*?return true;\r?\n\}/) || [])[0] || '';
    return /nextOf\('profile'\)/.test(persist) && /go\(dest\)/.test(persist) && !/go\('community'\)/.test(persist);
  })());

  record('New search form of government is free text',
    /id="newsearch"[\s\S]*name="fog"/.test(appJs) && !/<select class="input" name="fog">/.test(appJs));

  record('Community empty state does not ask for a city already on the file',
    /function communityEmptyNotice/.test(appJs) && /already on the file/.test(appJs) && /The community profile is not written yet/.test(appJs));

  record('Each process step has a Next button', /data-act="next-step"/.test(appJs) && /function nextBtn/.test(appJs) && /function stepFooter/.test(appJs) && /act==='next-step'/.test(appJs));

  record('Community has Next to the initial survey', /data-from="community"/.test(appJs) && /Next · Initial survey/.test(appJs) && /stepNextCard\('community'\)/.test(appJs));

  record('Brochure and ads have a posting design', /pack--brochure/.test(appJs) && /pack--ad/.test(appJs) && /Copy for posting/.test(appJs) && /act==='print-pack'/.test(appJs) && /act==='copy-post'/.test(appJs));

  record('Brochure is a layout tool', /Fill from community/.test(appJs) && /function vBrochure/.test(appJs) && /data-photo/.test(appJs) && /pack--photo/.test(stylesCss) && /pack--split/.test(stylesCss) && /act==='assemble'/.test(appJs));

  record('Packet has color and layout pickers', /data-act="pack-scheme"/.test(appJs) && /pack--scheme-forest/.test(stylesCss) && /pack--banner/.test(stylesCss) && /pack--masthead/.test(stylesCss) && /Masthead/.test(appJs) && /Banner/.test(appJs) && /Burgundy \/ cream/.test(appJs));

  record('Recruiting copy carries a review gate', /function reviewBar/.test(appJs) && /data-act="review"/.test(appJs) && /act==='review'/.test(appJs) && /Mark reviewed/.test(appJs) && /Send back to draft/.test(appJs) && /\.reviewbar/.test(stylesCss));

  record('Review bar reads its steps from the server', /function takesReview[\s\S]*state\.health\?\.reviewSteps/.test(appJs) && !/reviewSteps\s*=\s*\[/.test(appJs));

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
    process.exitCode = 1;
    console.log('\nBugs / failures:');
    failed.forEach((f,i) => console.log(`  ${i+1}. ${f.name}${f.detail ? '\n     '+f.detail : ''}`));
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
