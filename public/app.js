/* Slate — guided executive-search product */
const $ = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => [...el.querySelectorAll(s)];
/**
 * Apply the few styles whose values are only known at runtime.
 *
 * These were inline style attributes until DEP-12, where a real browser showed
 * the Content-Security-Policy blocking every one of them. Writing through the
 * CSSOM is not intercepted by style-src, so the policy stays strict and these
 * still work.
 */
function applyDynamicStyles(root){
  if (!root) return;
  for (const el of root.querySelectorAll('[data-width-pct]')) {
    el.style.width = el.getAttribute('data-width-pct') + '%';
  }
  for (const el of root.querySelectorAll('[data-swatch]')) {
    el.style.background = el.getAttribute('data-swatch');
  }
  for (const el of root.querySelectorAll('[data-min-height]')) {
    el.style.minHeight = el.getAttribute('data-min-height') + 'px';
  }
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

const KIND = {
  skill: { label:'Essential skill', plural:'Essential skills' },
  trait: { label:'Leadership trait', plural:'Leadership and personality traits' },
  chall: { label:'Current challenge', plural:'Current challenges' },
  opp:   { label:'Future opportunity', plural:'Future opportunities' }
};
const PREFIX = { skill:'S', trait:'T', chall:'C', opp:'O' };
const SUGGEST = {
  skill: ['Strategic leadership','Financial management','Organizational management','Community engagement','Economic development','Intergovernmental relations','Staff leadership','Communication'],
  trait: ['Collaborative','Approachable','Ethical','Innovative','Decisive','Strategic thinker','Good listener','Accountable','Resilient','Transparent'],
  chall: ['Financial pressures','Staffing/recruitment','Infrastructure needs','Organizational culture','Growth management','Community divisions','Aging facilities','Public safety','Service delivery challenges'],
  opp:   ['Economic development','Organizational innovation','New partnerships','Technology improvements','Community development','Strategic growth','Regional collaboration','Improved employee engagement']
};

const NAV = [
  ['overview','This search'],
  ['facts','Search facts']
];

const SEAT = {
  manager:   { label:'Account manager', hint:'Runs the search. Seats the committee, opens and closes intake, adopts the profile.' },
  consultant:{ label:'Consultant',      hint:'Works the file alongside the manager.' },
  committee: { label:'Committee member',hint:'Answers intake and scores candidates. Reads the file; does not edit it.' }
};

// What each member is asked in Step 2, in their own words, before anyone
// writes a profile. The wording is deliberately about this hire rather than
// about executives in general.
const INTAKE_ASK = {
  skill: { t:'What must this person already know how to do?', hint:'The work they have to be good at on day one.' },
  trait: { t:'What kind of person works here?', hint:'How they carry themselves with the governing body, staff, and residents.' },
  chall: { t:'What are they walking into?', hint:'The problems on the table right now.' },
  opp:   { t:'What could they build?', hint:'What becomes possible with the right person in the seat.' }
};

const DRAFTS = {
  community: { title:'Community and form of government', lede:'Enter the jurisdiction and its official website. A research agent reads public sources and fills the search facts and this profile — history, quality of life, and how the government is organized.' },
  survey1:   { title:'Initial candidate survey',         lede:'Gets past the resume. Every scored item names a profile criterion. Candidates fill this from their apply link after you post.' },
  guide:     { title:'Interview guide',                  lede:'ARE questions and four assessment scenarios, each tagged to the profile. Write it now so it is ready when finalists sit.' },
  survey2:   { title:'Semifinalist questionnaire',       lede:'Optional. Deeper ARE questions before interviews. Draft it now; you send it only after you name semifinalists.' },
  plan:      { title:'Recruitment and advertising plan', lede:'Outlet, audience, format, timing, cost, and who posts it. The brochure and ads come next, once this plan is on file.' },
  brochure:  { title:'Recruitment brochure',             lede:'Filled from the community file after the ad plan. Add pictures, pick a color and layout, and print. Ads use the same packet. A consultant marks it reviewed before it goes out.' },
  ads:       { title:'Advertisements',                   lede:'Four versions of the same packet as the brochure: a full ICMA listing, a short brief, social, and an association notice. A consultant marks them reviewed before they go out.' },
  schedule:  { title:'Finalist week and assessment center', lede:'Interview schedule plus the assessment guide. Every finalist gets the same core experience.' },
  contract:  { title:'Employment agreement',             lede:'ICMA model, customized, for counsel review.' },
  bar:       { title:'BAR evaluation',                   lede:'Behavior, Actions, Results, governance survey, and the annual cadence — inherited from the adopted profile.' }
};

const state = {
  user:null, users:[], health:null, view:'home', searches:[], search:null,
  sel:null, busy:false, premium:false, apply:null,
  // The intake answers being edited, held here rather than read back off the
  // DOM so a re-render never drops what somebody typed. Cleared when the
  // search changes or the answers are saved.
  intake:null,
  // A just-issued sign-in, shown once on the roster page.
  newPin:null,
  // Which pay-level sample the Packages page is showing, and the package
  // pre-selected when someone starts a search from that page.
  showcasePkg:null,
  newPackage:null,
  // Search ids checked on Home for a bulk delete. Dropped after the delete
  // runs, and ignored if a file is no longer on the book.
  picked:[]
};

function toast(msg, ms=3400){
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, ms);
}

// What the desk editor said about a draft. Clean is silent; anything still
// open after the review rounds is named so the consultant knows where to look.
function deskNote(desk){
  const open = desk?.open || [];
  if (!open.length) return '';
  const first = open[0].length > 140 ? open[0].slice(0, 137) + '...' : open[0];
  return ' Desk review left ' + open.length + ' note' + (open.length === 1 ? '' : 's') + ' for you: ' + first;
}

const STEP_FLOW = ['team','intake','profile','community','survey1','guide','survey2','plan','brochure','ads','sourcing','screen','send2','video','finalists','schedule','references','contract','bar'];
const STEP_NAME = {
  team:'Search committee',
  intake:'Committee input',
  profile:'Candidate profile',
  community:'Community',
  survey1:'Initial survey',
  guide:'Interview guide',
  survey2:'Semifinalist survey',
  plan:'Ad plan',
  brochure:'Brochure',
  ads:'Advertisements',
  sourcing:'Sourcing',
  screen:'Screening',
  send2:'Semifinalist questionnaire',
  video:'Video interviews',
  finalists:'Finalists',
  schedule:'Finalist week',
  references:'Reference checks',
  contract:'Contract',
  bar:'Evaluation'
};

// Steps the firm does by hand and records here. Nothing is drafted; the page is
// a log, working notes, and a completion the consultant signs.
const STAFF = {
  sourcing: {
    title:'Source and recruit candidates',
    lede:'Active sourcing and passive recruitment. Who you called, who you wrote to, who said they would look at it. Outreach is to people not yet on the file, so entries here name no candidate.',
    ask:'Who did you reach, and what did they say?',
    hint:'One entry per contact or per outreach batch. Names of sitting managers stay in this log; they do not go to the committee.',
    doneWhen:'Mark complete when outreach has run its course and the applicant pool is what it is going to be.'
  },
  video: {
    title:'Video interviews',
    lede:'A screening conversation with each semifinalist before finalists are named. Record who sat, when, and your read against the profile.',
    ask:'How did the interview go?',
    hint:'Tie each entry to the semifinalist. Point at the profile criteria, not general impressions.',
    doneWhen:'Mark complete once every semifinalist you intend to interview has been seen.'
  },
  references: {
    title:'Reference checks',
    lede:'Finalists only, and only after each one has agreed. Sitting managers will not apply if their own governing body might hear about it from a reference call.',
    ask:'Who did you speak with, and what did they say?',
    hint:'One entry per reference. Slate will not take an entry for a finalist whose consent is not recorded.',
    doneWhen:'Mark complete when every finalist who is still in the running has had their references checked.'
  }
};

function catalogSteps(){
  return state.search?.steps || state.health?.steps || [];
}
function catalogPhases(){
  return state.health?.phases || [
    { id:0, key:'convene', t:'Seat the committee and hear them', lede:'Who is on this search, who runs it, and what each member is actually looking for.' },
    { id:1, key:'recruit', t:'Prepare and post', lede:'Profile, community, surveys, and the ad plan. Then the brochure and ads you actually post.' },
    { id:2, key:'people', t:'Once there are candidates', lede:'Screening is where applicants enter the file. Everything after that waits until someone is on it.' }
  ];
}

// The step count is whatever the server's catalog says, so renumbering the
// process never leaves a stale "9 / 14" on a progress tile.
function stepTotal(){
  return state.search?.progress?.total || catalogSteps().length || STEP_FLOW.length;
}

/* --- service packages ------------------------------------------------------
 * Basic, Enhanced, Executive. The server's catalog (server/steps.js) says which
 * steps each one runs; the client only reads it. A search's `steps` already
 * arrive cut down to its package, so the rail, the overview, and Next buttons
 * never have to know about tiers. What follows is the picker and the labels.
 * ------------------------------------------------------------------------- */

function packages(){
  return state.health?.packages || [];
}
function packageInfo(key){
  return packages().find(p => p.key === key) || state.search?.packageInfo || null;
}
function packageLabel(key){
  return packageInfo(key)?.label || (key ? key[0].toUpperCase()+key.slice(1) : '');
}
// Steps in the full catalog that this package leaves off the file.
function stepsLeftOut(key){
  const p = packageInfo(key);
  const all = state.health?.steps || [];
  if (!p) return [];
  const rank = Object.fromEntries(packages().map(x => [x.key, x.rank]));
  return all.filter(st => (rank[st.pkg] ?? 0) > p.rank);
}

function compareRows(){
  return state.health?.compare || [];
}
function compareBands(){
  return state.health?.compareBands || [];
}
function packageOffers(pkg, row){
  const rank = Object.fromEntries(packages().map(p => [p.key, p.rank]));
  return (rank[pkg] ?? 0) >= (rank[row.pkg] ?? 0);
}

/**
 * The fee-level breakdown. One column per package, one row per service from
 * the catalog. When `pick` is true the column headers are radios named
 * `package`, so New search and Search facts submit the chosen tier.
 */
function packageMatrix(selected, { pick=false }={}){
  const list = packages();
  const rows = compareRows();
  const bands = compareBands();
  if (!list.length) return '';
  if (!rows.length) {
    const on = list.some(p => p.key === selected) ? selected : (state.health?.defaultPackage || list[list.length-1].key);
    return `<div class="pkgs"${pick?' role="radiogroup" aria-label="Service package"':''}>${list.map(p => `
      <${pick?'label':'div'} class="pkg u-default-cursor"${pick?'':''}>
        ${pick?`<input type="radio" name="package" value="${esc(p.key)}" ${p.key===on?'checked':''}>`:''}
        <div class="pkg__hd"><span class="pkg__nm">${esc(p.label)}</span><span class="pkg__fee">${esc(p.fee)}</span></div>
        <div class="t-small">${esc(p.lede)}</div>
        <ul class="pkg__svc">${(p.services||[]).map(s => `<li>${esc(s)}</li>`).join('')}</ul>
      </${pick?'label':'div'}>`).join('')}</div>`;
  }
  const fallback = state.health?.defaultPackage || list[list.length-1].key;
  const on = list.some(p => p.key === selected) ? selected : (pick ? fallback : '');
  const mark = (pkg, row) => packageOffers(pkg, row)
    ? `<span class="pkgmx__yes" title="Included">Yes</span>`
    : `<span class="pkgmx__no" title="Not in this package">—</span>`;
  const colClass = p => `pkgmx__c-${p.key}${!pick && p.key===on ? ' pkgmx--on' : ''}`;
  const head = p => {
    const inner = `<span class="pkgmx__nm">${esc(p.label)}</span><span class="pkgmx__fee">${esc(p.fee)}</span>`;
    if (pick) return `<label class="pkgmx__pick"><input type="radio" name="package" value="${esc(p.key)}" ${p.key===on?'checked':''}>${inner}</label>`;
    if (!state.user) return `<div class="pkgmx__pick">${inner}</div>`;
    return `<button type="button" class="pkgmx__pick" data-go="packages" data-pkg="${esc(p.key)}">${inner}</button>`;
  };
  const bandRows = (bands.length ? bands : [{ key:'', t:'' }]).map(band => {
    const slice = rows.filter(r => !band.key || r.pkg === band.key);
    if (!slice.length) return '';
    const label = band.t
      ? `<tr class="pkgmx__band"><th scope="colgroup" colspan="${1+list.length}">${esc(band.t)}</th></tr>`
      : '';
    return label + slice.map(row => `<tr>
      <th scope="row">${esc(row.t)}</th>
      ${list.map(p => `<td class="pkgmx__cell ${colClass(p)}">${mark(p.key, row)}</td>`).join('')}
    </tr>`).join('');
  }).join('');
  return `<div class="tablewrap" tabindex="0"${pick?' role="radiogroup" aria-label="Service package"':' role="region" aria-label="Service package comparison"'}>
    <table class="pkgmx${pick?' pkgmx--pick':''}">
      <colgroup>
        <col>
        ${list.map(p => `<col class="${colClass(p)}">`).join('')}
      </colgroup>
      <thead><tr>
        <th scope="col">Service</th>
        ${list.map(p => `<th scope="col" class="pkgmx__col ${colClass(p)}">${head(p)}</th>`).join('')}
      </tr></thead>
      <tbody>${bandRows}</tbody>
      <tfoot><tr>
        <th scope="row">Potential fee</th>
        ${list.map(p => `<td class="pkgmx__cell ${colClass(p)}"><span class="pkgmx__fee">${esc(p.fee)}</span></td>`).join('')}
      </tr></tfoot>
    </table>
  </div>`;
}

function packagePicker(selected){
  return packageMatrix(selected, { pick:true });
}

function packagePill(key){
  const k = key==='executive' ? 'ok' : key==='enhanced' ? 'info' : 'idle';
  return pill(k, packageLabel(key)+' package');
}

function showcasePkg(){
  const key = state.showcasePkg;
  return packages().some(p => p.key === key) ? key : (packages()[0]?.key || 'basic');
}

// A made-up mid-search file so each pay level can be shown without opening
// a live client. Statuses are assigned by how far that tier's story has run:
// Basic is screening applicants, Enhanced is sourcing, Executive is on references.
function demoSearch(pkg){
  const info = packageInfo(pkg) || { key:pkg, label:packageLabel(pkg), fee:'', lede:'', view:{}, services:[] };
  const catalog = (state.health?.steps || []).filter(st => packageOffers(pkg, st));
  const now = pkg === 'basic' ? 'screen' : pkg === 'enhanced' ? 'sourcing' : 'references';
  const nowN = (catalog.find(st => st.key === now) || {}).n || 99;
  const steps = catalog.map(st => {
    if (st.n < nowN) return { ...st, status:'done', blocked:false };
    if (st.key === now) return { ...st, status:'now', blocked:false };
    return { ...st, status:'idle', blocked:true };
  });
  const next = steps.find(st => st.status === 'now') || null;
  const people = [
    { id:'c1', name:'Jordan Hale', stage:'applicant', survey1:{} },
    { id:'c2', name:'Priya Shah', stage: pkg==='basic' ? 'applicant' : 'semifinalist', survey1:{} },
    { id:'c3', name:'Marcus Webb', stage: pkg==='executive' ? 'finalist' : pkg==='enhanced' ? 'semifinalist' : 'applicant', survey1:{}, referenceConsentAt: pkg==='executive' ? '2026-09-01' : '' },
    { id:'c4', name:'Elena Ruiz', stage:'declined', survey1:{} }
  ];
  const roster = [
    { userId:'u1', name:'Abe Macy', init:'AM', seat:'manager' },
    { userId:'u2', name:'Pat Chen', init:'PC', seat:'committee' },
    { userId:'u3', name:'Sam Ortiz', init:'SO', seat:'committee' }
  ];
  return {
    id:'demo-'+info.key, no:'SAMPLE', demo:true,
    client:'Town of Ridgeline', position:'Town Manager', state:'CO',
    fog:'Council-Manager', population:'18,400', budget:'$34M general fund',
    salary:'$165,000 to $195,000', firstReview:'14 September 2026',
    opened:'4 August 2026', website:'https://www.ridgelineco.gov',
    package: info.key, packageInfo: info,
    steps, progress: { done: steps.filter(st => st.status==='done').length, total: steps.length, next },
    roster, accountManager: roster[0],
    you: { seat:'consultant', member:false, consultant:true, canEdit:false, canManage:false },
    criteria: [
      { id:'S1', kind:'skill', label:'Financial management', weight:5 },
      { id:'S2', kind:'skill', label:'Council relations', weight:4 },
      { id:'T1', kind:'trait', label:'Steady under pressure', weight:4 },
      { id:'C1', kind:'chall', label:'Structural deficit', weight:5 },
      { id:'O1', kind:'opp', label:'Downtown redevelopment', weight:3 }
    ],
    intake: { status:'closed', submissions:{ u1:{submitted:true}, u2:{submitted:true}, u3:{submitted:true} } },
    consensus: { submitted:3, pending:[] },
    candidates: people,
    released: pkg === 'executive',
    artifacts: {
      plan: { rows:[{},{},{}] },
      ads: { full:{ headline:'Town Manager, Ridgeline' } },
      community: { lede:'A Front Range town of 18,400.' },
      brochure: { title:'Town Manager' }
    },
    reviews: { ads:{ status:'approved' } },
    staff: {
      sourcing: { log:[{ text:'Called sitting managers along the I-25 corridor. Two asked for the brochure.', at:'2026-08-20', byName:'Abe Macy' }] },
      video: { log:[{ candidateId:'c2', text:'45 minutes. Strong on finance.', at:'2026-08-28', byName:'Abe Macy' }] }
    },
    activity: [
      { who:'Abe Macy', x:'opened the sample file', at:'2026-08-04' },
      { who:'Abe Macy', x:'adopted the candidate profile', at:'2026-08-11' },
      { who:'Abe Macy', x:'posted the announcement', at:'2026-08-18' }
    ]
  };
}

function withPreview(search, fn){
  const prev = state.search, was = state.preview;
  state.search = search;
  state.preview = true;
  try { return fn(); }
  finally { state.search = prev; state.preview = was; }
}

/* --- who the signed-in person is on this search --------------------------- */

function you(){
  return state.search?.you || { seat:null, member:false, consultant:state.user?.role==='consultant', canEdit:false, canManage:false };
}
function canEdit(){ return Boolean(you().canEdit); }
function canManage(){ return Boolean(you().canManage); }
function isCommittee(){ return state.user?.role === 'committee'; }
function stepFlow(){
  const steps = catalogSteps();
  return steps.length ? steps.map(s => s.key) : STEP_FLOW;
}
function stepOf(key){
  return catalogSteps().find(s => s.key===key) || null;
}
function stepNo(key){
  const st = stepOf(key);
  return st ? st.n : (STEP_FLOW.indexOf(key)+1 || '');
}

const LOOKUP_STEPS = [
  'Opening the official website',
  'Searching public records',
  'Checking Census and the budget',
  'Writing the search file'
];
const DRAFT_STEPS = [
  'Reading the search file',
  'Drafting from the profile',
  'Writing the document'
];

function hostOf(url){
  try { return new URL(url).host; } catch { return String(url||'').replace(/^https?:\/\//,''); }
}

function paintLookupStep(i){
  const items = $$('#lookup-steps li');
  items.forEach((li, n) => {
    li.classList.toggle('is-done', n < i);
    li.classList.toggle('is-now', n === i);
  });
}

function showWait(opts={}){
  const el = $('#lookup');
  if (!el) return;
  const kicker = $('#lookup-kicker');
  const title = $('#lookup-title');
  const copy = $('#lookup-copy');
  const site = $('#lookup-site');
  const steps = $('#lookup-steps');
  if (kicker) kicker.textContent = opts.kicker || 'Working';
  if (title) title.textContent = opts.title || 'Working';
  if (copy) copy.textContent = opts.copy || 'Stay on this page.';
  if (site){
    site.textContent = opts.site || '';
    site.hidden = !opts.site;
  }
  const list = Array.isArray(opts.steps) ? opts.steps : [];
  if (steps) steps.innerHTML = list.map(s => `<li>${esc(s)}</li>`).join('');
  paintLookupStep(0);
  el.hidden = false;
  $('#app')?.setAttribute('inert','');
  $('#lookup .lookup__card')?.focus();
  clearInterval(showWait._t);
  if (!list.length) return;
  let i = 0;
  showWait._t = setInterval(() => {
    i = Math.min(i+1, list.length-1);
    paintLookupStep(i);
    if (i === list.length-1) clearInterval(showWait._t);
  }, opts.tick || 8000);
}

function hideWait(){
  clearInterval(showWait._t);
  const el = $('#lookup');
  if (el) el.hidden = true;
  $('#app')?.removeAttribute('inert');
}

function showLookup(city, website){
  const name = String(city||'').trim() || 'the jurisdiction';
  showWait({
    kicker: 'Jurisdiction lookup',
    title: 'Looking up '+name,
    copy: 'A research agent is reading the official website and public records, then filling the search file. Stay on this page. It often takes a minute or two.',
    site: website ? hostOf(website) : '',
    steps: LOOKUP_STEPS
  });
}

function hideLookup(){ hideWait(); }

async function withLookup(city, website, fn){
  showLookup(city, website);
  try { return await fn(); }
  catch (err) { toast(err.message); }
  finally { hideLookup(); }
}

function waitFor(kind){
  if (kind === 'profile') {
    return {
      kicker: 'Claude',
      title: 'Drafting the candidate profile',
      copy: 'Claude is proposing skills, traits, challenges, and opportunities from your notes. Stay on this page.',
      steps: DRAFT_STEPS,
      tick: 4000
    };
  }
  if (kind === 'brochure') {
    return {
      kicker: 'Claude',
      title: 'Tightening the brochure',
      copy: 'Claude is shortening the copy from the community file. Photos and layout stay put.',
      steps: DRAFT_STEPS,
      tick: 4000
    };
  }
  const meta = DRAFTS[kind];
  return {
    kicker: 'Claude',
    title: 'Drafting '+(meta?.title || kind),
    copy: 'Claude is writing from the adopted profile. Stay on this page. This often takes a minute.',
    steps: DRAFT_STEPS,
    tick: 4000
  };
}

function waitSave(title='Saving'){
  return {
    kicker: 'Slate',
    title,
    copy: 'Talking to the server. Stay on this page.',
    steps: ['Sending your changes', 'Updating the search file'],
    tick: 2000
  };
}

function nextOf(view){
  const flow = stepFlow();
  // The member's own intake form is a second face on the intake step, not a
  // step of its own, so it advances to whatever follows intake.
  const i = flow.indexOf(view === 'intake-mine' ? 'intake' : view);
  if (i < 0) return null;
  if (i === flow.length-1) return { key:'overview', n:null, title:'This search' };
  const key = flow[i+1];
  return { key, n: stepNo(key) || i+2, title: STEP_NAME[key] || key };
}

function nextButton(view, label){
  return `<button class="btn btn--primary" data-act="next-step" data-from="${view}">${esc(label)}</button>`;
}

function nextBtn(view){
  const n = nextOf(view);
  if (!n) return '';
  const label = n.n ? 'Next · '+n.title : 'Next';
  return nextButton(view, label);
}

function stepFooter(view, extra=''){
  const n = nextOf(view);
  if (!n && !extra) return '';
  const label = n ? (n.n ? 'Next · Step '+n.n+' · '+n.title : 'Back to this search') : '';
  return `<div class="row u-mt-5">
    ${extra}
    ${n ? nextButton(view, label) : ''}
  </div>`;
}

function stepNextCard(view){
  const n = nextOf(view);
  if (!n) return '';
  const label = n.n ? 'Next · Step '+n.n+' · '+n.title : 'Back to this search';
  return `<div class="next">
    <div class="t-label">Continue</div>
    <h2>${n.n ? 'Step '+n.n+'. '+esc(n.title) : 'This search'}</h2>
    <p class="t-small">${view==='community' ? 'The initial survey tests the adopted profile. Candidates fill it from their apply link after you post.' : view==='plan' ? 'The brochure and ads are what you post. Fill them from the community file.' : view==='ads' ? 'When applications come in, add people on Screening. Later steps wait until someone is on the file.' : 'Save what you have, then continue.'}</p>
    <div class="row">${nextButton(view, label)}</div>
  </div>`;
}

async function api(path, opts={}){
  const writesSearch = opts.method && opts.method !== 'GET' && state.search && path.startsWith('/api/searches/'+state.search.id);
  const res = await fetch(path, {
    credentials:'include',
    ...opts,
    headers:{ 'content-type':'application/json', ...(writesSearch ? { 'if-match':String(state.search.revision) } : {}), ...(opts.headers||{}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || res.statusText);
    error.code = data.code;
    throw error;
  }
  if (writesSearch && data.revision) state.search.revision = data.revision;
  return data;
}

// True when `view` names a process step that this search's package leaves off
// the file. Views that are not steps (home, facts, person) are never gated.
function offPackage(view){
  const s = state.search;
  if (!s || !Array.isArray(s.steps)) return false;
  const key = view === 'intake-mine' ? 'intake' : view === 'people' ? 'screen' : view;
  if (!STEP_FLOW.includes(key)) return false;
  return !s.steps.some(st => st.key === key);
}

async function go(view, extra={}){
  if (!state.busy && state.dirty && !confirm('Leave this page and discard unsaved edits?')) return;
  state.dirty = false;
  if (view === 'home') state.search = null;
  try {
    if (view === 'archives') state.archives = await api('/api/archives');
    if (view === 'history') state.history = await api('/api/searches/'+state.search.id+'/history');
  } catch (error) { toast(error.message); return; }
  if (offPackage(view)) {
    const st = (state.health?.steps || []).find(x => x.key === view);
    toast((st ? STEP_NAME[view] || st.t : 'That step')+' is not part of the '+packageLabel(state.search.package)+' package.');
    view = 'overview';
  }
  Object.assign(state, extra, { view });
  if (view === 'brochure' && brochureNeedsFill(state.search)){
    if (state.busy) {
      try { await fillBrochureFromCommunity(); }
      catch (err) { toast(err.message); }
      window.scrollTo({ top:0, behavior:'instant' });
      return;
    }
    await withBusy(() => fillBrochureFromCommunity(), {
      kicker: 'Brochure',
      title: 'Building the brochure',
      copy: 'Pulling the community research and the adopted profile into a packet. Then you can add pictures.',
      steps: ['Reading the community file', 'Laying out the packet']
    });
    window.scrollTo({ top:0, behavior:'instant' });
    return;
  }
  render();
  window.scrollTo({ top:0, behavior:'instant' });
}

function brochureHasCopy(b){
  if (!b) return false;
  return Boolean(b.title || b.lede || b.theOpportunity || b.thePlace);
}

function brochureNeedsFill(search){
  return Boolean(search?.artifacts?.community) && !brochureHasCopy(search.artifacts?.brochure);
}

async function fillBrochureFromCommunity(){
  const s = state.search;
  if (!s?.artifacts?.community) {
    toast('Finish the community profile first.');
    return;
  }
  state.search = await api('/api/searches/'+s.id+'/assemble', { method:'POST', body:{ kind:'brochure' } });
  toast('Filled from the community file. Add photos and pick a layout.');
}

function loadImageFile(file){
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}

async function compressPhoto(file){
  const img = await loadImageFile(file);
  const max = 1600;
  let w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) throw new Error('Could not read that image.');
  if (w > max) { h = Math.round(h * max / w); w = max; }
  if (h > max) { w = Math.round(w * max / h); h = max; }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.84);
}

async function uploadBrochurePhoto(slot, file){
  if (!file) return;
  await withBusy(async () => {
    const data = await compressPhoto(file);
    state.search = await api('/api/searches/'+state.search.id+'/media', { method:'POST', body:{ slot, data } });
    toast('Photo added. It prints with the brochure.');
  }, waitSave('Adding the photo'));
}

function peopleView(key){
  return key;
}

function ico(name){
  const p = {
    lock:'<path d="M5 8V6a3 3 0 0 1 6 0v2M4 8h8v6H4z"/>',
    check:'<path d="M3 8.5 6.2 12 13 4.5"/>'
  }[name] || '';
  return `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">${p}</svg>`;
}
function pill(k, label){ return `<span class="pill pill--${k}">${esc(label)}</span>`; }
function field(label, hint, control){
  return `<label class="field field--wide"><span class="field__label">${label}</span>${hint?`<span class="field__hint">${hint}</span>`:''}${control}</label>`;
}
function head(eyebrow, title, lede, actions=''){
  return `<div class="hero"><div class="wrap">
    <div class="eyebrow">${esc(eyebrow)}</div>
    <h1 class="t-display">${esc(title)}</h1>
    ${lede?`<p class="lede">${lede}</p>`:''}
    ${actions?`<div class="row u-mt-4">${actions}</div>`:''}
  </div></div>`;
}
function modelToggle(){
  const h = state.health || {};
  return `<label class="t-small u-inline-check">
    <input type="checkbox" id="premium" ${state.premium?'checked':''}>
    Use Opus 5 for this draft
    ${pill(h.hasKey?'ok':'wait', h.hasKey?'API key ready':'No API key')}
  </label>`;
}

async function loadHealth(){
  try {
    const h = await fetch('/api/config').then(r => r.json());
    state.health = h;
  } catch {
    state.health = state.health || { ok:false, demoLogins:false, accounts:[] };
  }
}

async function loadMe(){
  try {
    const me = await api('/api/me');
    state.user = me.user;
    state.users = me.users || [];
    state.health = Object.assign({}, state.health, me.health);
    return true;
  } catch { state.user = null; return false; }
}
async function loadSearches(){ state.searches = await api('/api/searches'); }
async function loadSearch(id){
  // An in-progress intake draft belongs to one search. Drop it when the file
  // changes so answers cannot bleed from one committee into another.
  if (state.search?.id !== id) { state.intake = null; state.newPin = null; }
  state.search = await api('/api/searches/'+id);
}

// A committee member is on the search to answer intake and score people, not
// to walk the whole production process. Showing them the brochure and contract
// steps they cannot open would only be a list of locked doors.
const COMMITTEE_STEPS = new Set(['team','intake','profile','screen','finalists']);

function railStepLink(st){
  const current = state.view===st.key
    || (state.view==='person' && st.key==='screen')
    || (state.view==='intake-mine' && st.key==='intake');
  const label = (st.n || '')+' · '+(STEP_NAME[st.key] || st.t);
  return `<button class="rail__link" data-go="${st.key}" ${current?'aria-current="page"':''}>${esc(label)}</button>`;
}

function railPhaseGroups(search){
  const steps = (search.steps || []).filter(st => !isCommittee() || COMMITTEE_STEPS.has(st.key));
  const hasPeople = (search.candidates||[]).length > 0;
  return catalogPhases().map(p => {
    const list = steps.filter(st => st.phase===p.id);
    if (!list.length) return '';
    const wait = p.id===2 && !hasPeople;
    return `<div class="rail__group${wait?' rail__group--later':''}">
      <div class="rail__label">${esc(p.t)}</div>
      ${wait?`<div class="rail__hint">${isCommittee()?'Nothing to do here until candidates apply.':'Add people in Screening. The rest waits until someone is on the file.'}</div>`:''}
      ${list.map(railStepLink).join('')}
    </div>`;
  }).join('');
}

function shell(body){
  const warning = state.search?.staleArtifacts?.[state.view];
  if (warning) body = `<div class="notice notice--info" role="status">${esc(warning)}</div>` + body;
  const u = state.user, s = state.view==='packages' ? null : state.search, next = s?.progress?.next;
  // Search facts are an editing surface; a committee member gets the overview.
  const nav = isCommittee() ? NAV.filter(([v]) => v !== 'facts') : NAV;
  const workspace = nav.map(([v,l]) => `<button class="rail__link" data-go="${v}" ${state.view===v?'aria-current="page"':''}>${l}</button>`).join('');
  return `<div class="shell${state.busy?' busy':''}">
    <nav class="rail" aria-label="Primary">
      <div class="rail__brand">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="u-accent" aria-hidden="true"><path d="M4 20h16M6 20V9l6-4 6 4v11M10 20v-5h4v5"/></svg>
        <span class="rail__name">Slate</span><span class="rail__ver">Live</span>
      </div>
      <div class="whoami">
        <div class="whoami__hd"><span class="t-label">Signed in as</span></div>
        <div class="whoami__list">
          <div class="whoami__opt" aria-pressed="true">
            <span class="whoami__init">${esc(u.init)}</span>
            <span><span class="whoami__nm">${esc(u.name)}</span><span class="whoami__rl">${esc(u.title)}${s && you().seat ? ' · '+esc(SEAT[you().seat]?.label||'') : ''}</span></span>
          </div>
        </div>
      </div>
      <div class="rail__group"><div class="rail__label">Workspace</div>
        <button class="rail__link" data-go="home" ${!s && state.view==='home'?'aria-current="page"':''}>Home</button>
        ${!isCommittee() ? '<button class="rail__link" data-go="archives">Archived searches</button>' : ''}
        ${s && canEdit() ? '<button class="rail__link" data-go="history">History and recovery</button><button class="rail__link" data-act="reload-search">Reload search</button>' : ''}
        ${!isCommittee() && packages().length ? `<button class="rail__link" data-go="packages" ${state.view==='packages'?'aria-current="page"':''}>Packages</button>` : ''}
        ${s?workspace:''}
      </div>
      ${s?railPhaseGroups(s):''}
      <div class="rail__foot">
        ${next?`<div class="rail__note"><b>Up next.</b> Step ${next.n}: ${esc(next.t)}</div>`:''}
        <div class="themeswap" role="group" aria-label="Theme">
          <button type="button" data-theme="light">Light</button>
          <button type="button" data-theme="auto">Auto</button>
          <button type="button" data-theme="dark">Dark</button>
        </div>
        <button class="btn btn--ghost btn--sm" data-act="logout">Sign out</button>
      </div>
    </nav>
    <main class="page">
      <div class="masthead"><div class="wrap"><div class="masthead__in">
        <nav class="crumbs" id="crumbs"></nav>
        <span class="mono mast__id">${state.view==='packages'?'SAMPLE · '+esc(packageLabel(showcasePkg())):(s?esc(s.no)+' · '+esc(s.position)+(s.package?' · '+esc(packageLabel(s.package)):''):'Slate')}</span>
      </div></div></div>
      ${body}
    </main>
  </div>`;
}

function crumbs(){
  const el = $('#crumbs');
  if (!el) return;
  const s = state.search;
  el.innerHTML = `<button type="button" data-go="home">Home</button>` +
    (state.view==='packages' ? `<span class="dot"></span><span>Packages</span><span class="dot"></span><span>${esc(packageLabel(showcasePkg()))}</span>` :
    (s ? `<span class="dot"></span><button type="button" data-go="overview">${esc(s.client||'Search')}</button>` :
      (state.view==='new' ? `<span class="dot"></span><span>New search</span>` : '')));
}

function vGate(){
  return `<div class="gate">
    <header class="gate__bar">
      <div class="login__brand">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="u-accent" aria-hidden="true"><path d="M4 20h16M6 20V9l6-4 6 4v11M10 20v-5h4v5"/></svg>
        <span class="rail__name">Slate</span>
      </div>
      <button class="btn btn--primary" data-go="login">Sign in</button>
    </header>
    <div class="wrap gate__hero">
      <h1 class="t-title">Three ways to run a search</h1>
      <p class="t-body">Every engagement seats the committee and builds the profile from their answers. The fee decides how much of the process runs after that.</p>
    </div>
    <div class="wrap gate__table stack">
      <div class="spec"><div class="spec__bar">What each pay level includes</div>
        <div class="spec__body spec__body--flush">${packageMatrix()}</div>
      </div>
      <div class="row"><button class="btn btn--primary" data-go="login">Sign in to the workspace</button></div>
    </div>
  </div>`;
}

function vLogin(){
  const demo = Boolean(state.health?.demoLogins);
  const accounts = demo ? (state.health?.accounts || []) : [];
  const first = accounts[0];
  return `<div class="login"><div class="login__card">
    <div class="login__brand">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="u-accent"><path d="M4 20h16M6 20V9l6-4 6 4v11M10 20v-5h4v5"/></svg>
      <span class="rail__name">Slate</span>
    </div>
    <h1 class="t-title">Sign in</h1>
    <form id="login" class="stack">
      ${field('Email','', `<input class="input" name="email" type="email" value="${esc(first?.email||'')}" autocomplete="username" required>`)}
      ${field('PIN','', `<input class="input" name="pin" type="password" maxlength="256" value="${esc(first?.pin||'')}" autocomplete="current-password" required>`)}
      <button class="btn btn--primary" type="submit">Open workspace</button>
      <button class="btn btn--ghost" type="button" data-go="home">Back to packages</button>
    </form>
    ${accounts.length?`<div class="accounts">
      <div class="t-label">${accounts.length>1?'Accounts':'Account'}</div>
      ${accounts.map((a,i) => `${esc(a.name)} <b>${esc(a.email)}</b> · ${esc(a.pin)}${i===0&&accounts.length>1?' <span class="t-small">(shared)</span>':''}`).join('<br>')}
    </div>`:''}
  </div></div>`;
}

// A committee member's home is a to-do list, not a book of business. If a
// window is open and they have not answered, that is the whole page.
function vHomeCommittee(){
  const u = state.user;
  const list = state.searches || [];
  const first = String(u.name||'').split(' ')[0] || 'there';
  const owed = list.filter(s => s.intakeOpen && !s.intakeMine);
  const rows = list.map(s => `<div class="home-row">
    <button class="home-row__open home-row__open--plain" data-open="${s.id}">
      <span><b>${esc(s.client||'Untitled')}</b><div class="t-small">${esc(s.position)}${s.accountManager?' · '+esc(s.accountManager.name):''}</div></span>
      <span class="mono t-small">${esc(s.no)}</span>
      <span class="t-small">${s.intakeOpen
        ? (s.intakeMine ? 'Your answers are in' : 'Waiting on your answers')
        : (s.intakeMine ? 'Answers on file' : 'Nothing needed right now')}</span>
    </button>
  </div>`).join('');
  return shell(`
    ${head('Home','Welcome, '+first,
      'You are on '+(list.length===1?'a search':list.length+' searches')+' as a committee member. You will be asked what you are looking for in the executive, and later you will score candidates against what the committee agreed on.',
      owed.length ? `<button class="btn btn--primary" data-open="${owed[0].id}">Answer for ${esc(owed[0].client)}</button>` : '')}
    <div class="band"><div class="wrap stack">
      ${owed.map(s => `<div class="next">
        <div class="t-label">Waiting on you</div>
        <h2>${esc(s.client||'')} · ${esc(s.position||'')}</h2>
        <p class="t-small">The search committee is being asked what to look for in the next ${esc(s.position||'executive')}. Answer for yourself; nobody sees your answers until the window closes.${s.intakeDue?' <b>Due '+esc(s.intakeDue)+'.</b>':''}</p>
        <div class="row"><button class="btn btn--primary" data-open="${s.id}">Answer now</button></div>
      </div>`).join('')}
      <div class="spec"><div class="spec__bar">Your searches</div>
        <div class="spec__body spec__body--flush">${rows || '<div class="empty"><div class="empty__t">Nothing yet</div>When a consultant seats you on a search, it appears here.</div>'}</div>
      </div>
    </div></div>`);
}

function pickedIds(){
  const known = new Set((state.searches||[]).map(s => s.id));
  return (state.picked||[]).filter(id => known.has(id));
}

function vHome(){
  if (isCommittee()) return vHomeCommittee();
  const u = state.user;
  const canDelete = u.role==='consultant';
  const list = state.searches || [];
  const picked = pickedIds();
  state.picked = picked;
  const allPicked = list.length > 0 && picked.length === list.length;
  const complete = list.filter(s => s.progress && s.progress.done >= s.progress.total).length;
  const live = list.length - complete;
  const pickup = list.find(s => s.progress?.next);
  const first = String(u.name||'').split(' ')[0] || 'there';
  const owed = list.filter(s => s.intakeOpen && s.seat && !s.intakeMine);
  const rows = list.length
    ? list.map(s => {
        const n = s.progress?.next;
        const on = picked.includes(s.id);
        return `<div class="home-row${on?' home-row--on':''}">
          ${canDelete?`<label class="home-row__pick"><input type="checkbox" data-pick-search="${s.id}" ${on?'checked':''} aria-label="Select ${esc(s.client||s.no||'this search')}"></label>`:''}
          <button class="home-row__open" data-open="${s.id}">
            <span><b>${esc(s.client||'Untitled')}</b><div class="t-small">${esc(s.position)} · ${esc(s.fog||'')}${s.packageLabel?' · '+esc(s.packageLabel):''}</div></span>
            <span class="mono t-small">${esc(s.no)}</span>
            <span class="t-small">${s.accountManager?esc(s.accountManager.name):'—'}${s.seats>1?' +'+(s.seats-1):''}</span>
            <span class="t-small">${s.progress?s.progress.done+'/'+s.progress.total:''}${n?' · next: '+esc(n.t):' · complete'}</span>
          </button>
          ${canDelete?`<button class="btn btn--danger btn--sm" data-act="delete-search" data-id="${s.id}" data-name="${esc(s.client||s.no||'this search')}">Archive</button>`:''}
        </div>`;
      }).join('')
    : `<div class="empty"><div class="empty__t">No searches yet</div>Open a search. It starts by seating the committee and asking each member what they are looking for. The profile is built from their answers, and everything else is generated from that.</div>`;
  return shell(`
    ${head('Home','Welcome back, '+first,'Your book of searches. Open a file or start a new one.',
      u.role==='consultant' ? `<button class="btn btn--primary" data-go="new">Open a new search</button>` : '')}
    <div class="band"><div class="wrap stack">
      <div class="tiles">
        <div class="tile"><span class="tile__k">Searches</span><span class="tile__v">${list.length}</span></div>
        <div class="tile"><span class="tile__k">In progress</span><span class="tile__v">${live}</span></div>
        <div class="tile"><span class="tile__k">Complete</span><span class="tile__v">${complete}</span></div>
        <div class="tile tile--hi"><span class="tile__k">Signed in</span><span class="tile__v u-fs-145">${esc(u.init)}</span><span class="tile__n">${esc(u.title)}</span></div>
      </div>
      ${owed.length ? `<div class="notice notice--info"><div>
        <div class="notice__t">Committee intake is waiting on you</div>
        <div class="notice__b">Your seat counts in the tally on ${owed.map(s => `<button class="btn btn--ghost btn--sm" data-open="${s.id}">${esc(s.client||s.no)}</button>`).join(' ')}</div>
      </div></div>` : ''}
      ${pickup ? `<div class="next">
        <div class="t-label">Continue</div>
        <h2>${esc(pickup.client||'Untitled')} · ${esc(pickup.position||'')}</h2>
        <p class="t-small">Step ${pickup.progress.next.n}. ${esc(pickup.progress.next.t)}</p>
        <div class="row"><button class="btn btn--primary" data-open="${pickup.id}">Open this search</button>
          ${u.role==='consultant' ? `<button class="btn btn--secondary" data-go="new">Open a new search</button>` : ''}</div>
      </div>` : ''}
      <div class="spec"><div class="spec__bar">Your searches${canDelete && list.length ? `<span class="spec__bar-act">
          <button type="button" class="btn btn--ghost btn--sm" data-act="pick-all">${allPicked?'Clear':'Select all'}</button>
          <button type="button" class="btn btn--danger btn--sm" data-act="delete-searches" ${picked.length?'':'disabled'}>Archive selected${picked.length?' · '+picked.length:''}</button>
        </span>` : ''}</div>
        <div class="spec__body spec__body--flush">${rows}</div>
      </div>
    </div></div>`);
}

function jurisdictionInfo(search=state.search){
  const key = search?.jurisdictionType || state.newJurisdiction || 'municipality';
  return (state.health?.jurisdictionTypes || []).find(j => j.key === key)
    || { key, label:key==='county'?'County':'City or town', noun:key==='county'?'county':'jurisdiction', clientPlaceholder:key==='county'?'Example County':'City of Ridgeline', positionPlaceholder:key==='county'?'County Administrator':'City Manager', governmentPlaceholder:key==='county'?'Board–Administrator':'Council–Manager' };
}

function jurisdictionPicker(value='municipality'){
  const types = state.health?.jurisdictionTypes || [{key:'municipality',label:'City or town'},{key:'county',label:'County'}];
  return field('Jurisdiction type','Sets the terminology used throughout this search.', `<select class="input" name="jurisdictionType" data-jurisdiction>${types.map(j => `<option value="${esc(j.key)}" ${j.key===value?'selected':''}>${esc(j.label)}</option>`).join('')}</select>`);
}

function updateJurisdictionFields(form){
  const key = form.querySelector('[name="jurisdictionType"]').value;
  const info = jurisdictionInfo({ jurisdictionType:key });
  const previous = jurisdictionInfo({ jurisdictionType:form.dataset.jurisdiction || (form.id === 'newsearch' ? state.newJurisdiction : state.search?.jurisdictionType) || 'municipality' });
  const government = form.querySelector('[name="fog"]');
  if (government?.value === previous.governmentPlaceholder) government.value = info.governmentPlaceholder;
  form.dataset.jurisdiction = key;
  // Change examples in place so a type switch never discards entered search facts.
  for (const [name, placeholder] of Object.entries({ client:info.clientPlaceholder, position:info.positionPlaceholder, fog:info.governmentPlaceholder })) {
    const input = form.querySelector('[name="'+name+'"]');
    if (input) input.placeholder = placeholder;
  }
  const label = form.querySelector('[name="website"]')?.closest('label')?.querySelector('.field__label');
  if (label) label.textContent = info.key === 'county' ? 'County website' : 'City or town website';
  if (form.id === 'newsearch') state.newJurisdiction = key;
  state.dirty = true;
}

function vNew(){
  const jurisdiction = jurisdictionInfo({ jurisdictionType:state.newJurisdiction || 'municipality' });
  return shell(`
    ${head('New search','Who is hiring, and for what','Open the file, then seat the search committee. The profile comes after the committee has told you what they are looking for.',
      `<button class="btn btn--primary" type="submit" form="newsearch" data-act="create">Create search</button>
       <button class="btn btn--secondary" data-go="home">Cancel</button>`)}
    <div class="band"><div class="wrap"><form id="newsearch" class="stack">
      ${packages().length ? `<div>
        <div class="sub u-mt-0">Service package</div>
        <p class="t-small u-mb-3">What the client bought, and the fee that goes with it. The column you pick sets which steps are on this file; the committee and the profile are on every one. You can change it later on Search facts.</p>
        ${packagePicker(state.newPackage || state.health?.defaultPackage)}
      </div>` : ''}
      <div class="sub">The client</div>
      ${jurisdictionPicker(jurisdiction.key)}
      <div class="grid2">
        ${field('Client jurisdiction','Official county, city, or town name.', `<input class="input" name="client" required placeholder="${esc(jurisdiction.clientPlaceholder)}">`)}
        ${field(jurisdiction.key==='county'?'County website':'City or town website','Saved now. Looked up once the profile is adopted.', `<input class="input" name="website" type="url" placeholder="https://">`)}
        ${field('Position','', `<input class="input" name="position" required placeholder="${esc(jurisdiction.positionPlaceholder)}">`)}
        ${field('State','', `<input class="input" name="state" placeholder="Colorado">`)}
        ${field('Form of government','Use the jurisdiction’s official structure.', `<input class="input" name="fog" placeholder="${esc(jurisdiction.governmentPlaceholder)}">`)}
        ${field('Population','', `<input class="input" name="population" placeholder="18,400">`)}
        ${field('Operating budget','', `<input class="input" name="budget" placeholder="$34M general fund">`)}
        ${field('Salary range','', `<input class="input" name="salary" placeholder="$165,000–$195,000">`)}
        ${field('First review date','', `<input class="input" name="firstReview" placeholder="14 Sep 2026">`)}
      </div>
      ${field('Notes from the governing body','Paste workshop notes. Used to draft the profile.', `<textarea class="input ed" name="notes" placeholder="Structural deficit, three director vacancies, deferred water mains…"></textarea>`)}
    </form></div></div>`);
}

function nextHint(next){
  if (!next) return '';
  if (next.blocked) {
    if (next.needsCandidates) return 'Add a candidate in Screening first. Later steps wait until someone is on the file.';
    return 'Finish the earlier step first. Later documents are only as good as the profile they inherit.';
  }
  const hints = {
    team:'Seat every governing-body or committee member who gets a say, and name the account manager. Each person you seat gets a sign-in of their own.',
    intake:'Open the window and let each member answer on their own. You will see who has responded, not what they said, until you close it.',
    profile:'Build the matrix from what the committee said, then edit. Everything downstream inherits this.',
    community:'Enter the jurisdiction and its official website. Claude looks up public facts and fills the community and form-of-government profile. Check every number.',
    survey1:'Draft the initial survey from the adopted profile. Candidates will fill it from their apply link after you post.',
    plan:'Plan where the ads run. The brochure and ads come next.',
    brochure:'Fill the brochure from the community file. Add photos and pick a layout. Mark it reviewed before it goes out.',
    ads:'Draft the four ad versions from the brochure packet. Mark them reviewed, then you are ready to post.',
    screen:'Add candidates. Score them against the adopted profile. Advance the people you want as semifinalists, then release scores.',
    send2:'Send the semifinalist survey with a deadline. It is not on their apply link until you send it.',
    finalists:'Read the semifinalist responses against the profile. Advance the people who will sit for finalist week.',
    sourcing:'Work the ad plan by hand: call the people who should see this, log each contact, and mark the step complete when the pool is set.',
    video:'Interview each semifinalist on video and log your read against the profile. Complete it before you name finalists.',
    references:'Record each finalist\'s consent first, then log every reference conversation. Nothing here reaches the committee.'
  };
  return hints[next.key] || 'Open the step, fill what you know, then ask Claude to draft. You edit. The file saves.';
}

function stepWaitCopy(st, search){
  if (!st.blocked) return st.status==='done'?'On file':st.status==='now'?'In progress':'Not started';
  if (st.needsCandidates && !((search.candidates||[]).length)) return 'Waiting for a candidate on the file';
  return 'Waiting on an earlier step';
}

function stepsList(steps, search){
  return `<div class="steps">${(steps||[]).map(st => `
    <div class="step ${st.status==='done'?'step--done':st.status==='now'?'step--now':''}">
      <div class="step__n">${String(st.n).padStart(2,'0')}</div>
      <div>
        <div class="step__t">${esc(st.t)}${st.opt?' '+pill('idle','Optional'):''}${st.kind==='staff'?' '+pill('info','Staff work'):''}</div>
        <div class="t-small">${stepWaitCopy(st, search)}</div>
      </div>
    </div>`).join('')}
  </div>`;
}

/* ===========================================================================
 * Overview
 *
 * The layout comes from the package's `view` in the server catalog. A Basic
 * file is a posting and a screen, so it opens on an applicant dashboard; the
 * retained search keeps the step-by-step spec. The panels below are the
 * dashboard's building blocks, drawn in the order the catalog lists them.
 * ========================================================================= */

function overviewView(s){
  return s.packageInfo?.view || { layout:'spec', kicker: packageLabel(s.package)+' search', lede:'', panels:[], steps:'phases' };
}

// Whether this viewer may open a step from the overview. A committee member
// is shown only the steps they take part in; a step off the package is not
// linked at all.
function canOpenStep(key){
  if (state.preview) return false;
  if (!stepOf(key)) return false;
  return !isCommittee() || COMMITTEE_STEPS.has(key);
}
function openBtn(key, label, primary=false){
  if (!canOpenStep(key)) return '';
  return `<button class="btn btn--${primary?'primary':'ghost'} btn--sm" data-go="${peopleView(key)}">${esc(label)}</button>`;
}
function stepState(key){
  return (state.search?.steps||[]).find(st => st.key===key) || null;
}
function statusPill(st){
  if (!st) return pill('idle','Not on file');
  if (st.status==='done') return pill('ok','Done');
  if (st.blocked) return pill('idle','Waiting');
  if (st.status==='now') return pill('wait','In progress');
  return pill('idle','Not started');
}
function kv(label, value){
  return `<div class="dash__kv"><span class="dash__k">${esc(label)}</span><span class="dash__v">${value}</span></div>`;
}

function rosterPanel(s){
  return `<div class="spec"><div class="spec__bar">Who is on this search</div>
    <div class="spec__body">
      <div class="rosterline">${(s.roster||[]).map(m =>
        `<span class="rosterchip${m.seat==='manager'?' rosterchip--mgr':''}" title="${esc(SEAT[m.seat]?.label||m.seat)}">
          <span class="rosterchip__i">${esc(m.init)}</span>${esc(m.name)}${intakeDoneBy(m.userId)?' '+ico('check'):''}
        </span>`).join('') || '<span class="t-small">Nobody seated yet.</span>'}
      </div>
      <p class="t-small">${s.accountManager?esc(s.accountManager.name)+' runs this account. ':''}${state.preview?'':'<button class="btn btn--ghost btn--sm" data-go="team">Open the roster</button>'}</p>
    </div></div>`;
}

function packagePanel(s){
  if (!s.packageInfo || isCommittee()) return '';
  const left = stepsLeftOut(s.package);
  return `<div class="spec"><div class="spec__bar">${esc(s.packageInfo.label)} package · ${esc(s.packageInfo.fee)}</div>
    <div class="spec__body">
      <p class="t-small u-mb-3">${esc(s.packageInfo.lede)}</p>
      <ul class="svcs">${(s.packageInfo.services||[]).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      ${left.length ? `<p class="t-small u-mt-3">Not on this file: ${left.map(st => esc(STEP_NAME[st.key]||st.t)).join(', ')}.${canEdit() && !state.preview?' Change the package on <button class="btn btn--ghost btn--sm" data-go="facts">Search facts</button> if the engagement changed.':''}</p>` : ''}
    </div></div>`;
}

function phaseSpecs(s){
  return catalogPhases().map(p => {
    const list = (s.steps||[]).filter(st => st.phase===p.id && (!isCommittee() || COMMITTEE_STEPS.has(st.key)));
    if (!list.length) return '';
    return `<div class="spec"><div class="spec__bar">${esc(p.t)}</div>
      <div class="spec__body">
        <p class="t-small u-mb-4">${esc(p.lede)}</p>
        ${stepsList(list, s)}
      </div></div>`;
  }).join('');
}

// One line of chips: the whole process at a glance for a short package.
function stepStrip(s){
  const list = (s.steps||[]).filter(st => !isCommittee() || COMMITTEE_STEPS.has(st.key));
  return `<div class="spec"><div class="spec__bar">The process · ${s.progress.done} of ${stepTotal()} done</div>
    <div class="spec__body"><div class="strip">${list.map(st => {
      const k = st.status==='done' ? 'done' : st.blocked ? 'wait' : st.status==='now' ? 'now' : 'open';
      const inner = `<span class="mono">${String(st.n).padStart(2,'0')}</span>${esc(STEP_NAME[st.key]||st.t)}`;
      return canOpenStep(st.key)
        ? `<button type="button" class="strip__s strip__s--${k}" data-go="${peopleView(st.key)}" title="${esc(st.t)}">${inner}</button>`
        : `<span class="strip__s strip__s--${k}" title="${esc(st.t)}">${inner}</span>`;
    }).join('')}</div></div></div>`;
}

function activityPanel(s){
  return `<div class="spec"><div class="spec__bar">Activity</div>
    <div class="spec__body"><div class="feed">${(s.activity||[]).slice(0,8).map(a=>`
      <div class="feed__i"><span class="feed__w">${esc(a.who)}</span><span class="feed__x">${esc(a.x)}</span><span class="feed__t">${esc((a.at||'').slice(0,10))}</span></div>`).join('') || '<div class="t-small">Nothing yet.</div>'}
    </div></div></div>`;
}

const DASH = {
  committee(s){
    const team = stepState('team'), intake = stepState('intake'), profile = stepState('profile');
    const answered = s.consensus ? s.consensus.submitted : Object.values(s.intake?.submissions||{}).filter(x => x && x.submitted).length;
    return `<div class="spec"><div class="spec__bar">Committee and profile</div>
      <div class="spec__body stack">
        <div class="rosterline">${(s.roster||[]).map(m =>
          `<span class="rosterchip${m.seat==='manager'?' rosterchip--mgr':''}" title="${esc(SEAT[m.seat]?.label||m.seat)}"><span class="rosterchip__i">${esc(m.init)}</span>${esc(m.name)}${intakeDoneBy(m.userId)?' '+ico('check'):''}</span>`).join('') || '<span class="t-small">Nobody seated yet.</span>'}
        </div>
        ${kv('Roster', statusPill(team))}
        ${kv('Intake', statusPill(intake)+(s.intake?.status==='open'?' <span class="t-small">'+answered+' of '+(s.roster||[]).length+' answered</span>':''))}
        ${kv('Profile', statusPill(profile)+' <span class="t-small">'+(s.criteria||[]).filter(c=>c.label).length+' criteria</span>')}
        <div class="row">${openBtn('team','Roster')}${openBtn('intake','Intake')}${openBtn('profile','Profile')}</div>
      </div></div>`;
  },
  posting(s){
    const plan = stepState('plan'), ads = stepState('ads'), survey = stepState('survey1');
    const adsReviewed = (s.reviews||{}).ads?.status==='approved';
    return `<div class="spec"><div class="spec__bar">Announcement and posting</div>
      <div class="spec__body stack">
        ${kv('Where it runs', statusPill(plan)+(s.artifacts?.plan?.rows?.length?' <span class="t-small">'+s.artifacts.plan.rows.length+' outlets</span>':''))}
        ${kv('Job announcement', s.artifacts?.ads ? (adsReviewed ? pill('ok','Reviewed, ready to post') : pill('wait','Drafted, not yet reviewed')) : statusPill(ads))}
        ${kv('Applicant survey', statusPill(survey))}
        ${kv('Opened', `<span class="mono">${esc(s.opened||'—')}</span>`)}
        ${kv('First review', `<span class="mono">${esc(s.firstReview||'not set')}</span>`)}
        <div class="row">${openBtn('plan','Ad plan')}${openBtn('ads','Announcement')}${openBtn('survey1','Survey')}</div>
      </div></div>`;
  },
  sourcing(s){
    const st = stepState('sourcing');
    const rec = (s.staff||{}).sourcing || { log:[] };
    return `<div class="spec"><div class="spec__bar">Sourcing and outreach</div>
      <div class="spec__body stack">
        ${kv('Status', statusPill(st))}
        ${kv('Contacts logged', `<b>${(rec.log||[]).length}</b>`)}
        ${rec.log?.[0] ? kv('Latest', `<span class="t-small">${esc(rec.log[0].text.slice(0,120))}${rec.log[0].text.length>120?'…':''}</span>`) : ''}
        <div class="row">${openBtn('sourcing','Open the log', true)}</div>
      </div></div>`;
  },
  applicants(s){
    const c = s.candidates||[];
    const by = stage => c.filter(x => x.stage===stage).length;
    const surveysIn = c.filter(x => x.survey1).length;
    const screen = stepState('screen');
    return `<div class="spec"><div class="spec__bar">Applicants</div>
      <div class="spec__body stack">
        <div class="tiles tiles--tight">
          <div class="tile"><span class="tile__k">Applied</span><span class="tile__v">${c.length}</span></div>
          <div class="tile"><span class="tile__k">Surveys in</span><span class="tile__v">${surveysIn}</span></div>
          <div class="tile"><span class="tile__k">Semifinalists</span><span class="tile__v">${by('semifinalist')+by('finalist')}</span></div>
          <div class="tile"><span class="tile__k">Declined</span><span class="tile__v">${by('declined')}</span></div>
        </div>
        ${kv('Screening', statusPill(screen)+(s.released?' '+pill('ok','Scores released'):''))}
        <div class="row">${openBtn('screen', c.length ? 'Open screening' : 'Add applicants', true)}</div>
      </div></div>`;
  },
  interviews(s){
    const video = stepState('video'), schedule = stepState('schedule'), guide = stepState('guide'), send2 = stepState('send2');
    const rec = (s.staff||{}).video || { log:[] };
    const semis = (s.candidates||[]).filter(x => x.stage==='semifinalist' || x.stage==='finalist');
    const seen = new Set((rec.log||[]).map(e => e.candidateId).filter(Boolean)).size;
    return `<div class="spec"><div class="spec__bar">Interviews and assessment</div>
      <div class="spec__body stack">
        ${kv('Interview guide', statusPill(guide))}
        ${send2 ? kv('Semifinalist survey', statusPill(send2)) : ''}
        ${kv('Video interviews', statusPill(video)+' <span class="t-small">'+seen+' of '+semis.length+' semifinalists seen</span>')}
        ${kv('Finalist week', statusPill(schedule))}
        <div class="row">${openBtn('guide','Guide')}${openBtn('video','Video log')}${openBtn('schedule','Finalist week')}</div>
      </div></div>`;
  },
  recommendation(s){
    const finals = (s.candidates||[]).filter(x => x.stage==='finalist');
    const st = stepState('finalists');
    return `<div class="spec"><div class="spec__bar">Recommendation</div>
      <div class="spec__body stack">
        ${kv('Finalists', statusPill(st))}
        ${finals.length
          ? `<div class="rosterline">${finals.map(f => `<span class="rosterchip"><span class="rosterchip__i">${esc(initialsOf(f.name))}</span>${esc(f.name)}${f.referenceConsentAt?' '+ico('check'):''}</span>`).join('')}</div>`
          : '<p class="t-small">No finalists named yet. The recommendation to the client is the people on this line.</p>'}
        <div class="row">${openBtn('finalists','Select finalists', true)}${stepOf('references') ? openBtn('references','References') : ''}</div>
      </div></div>`;
  }
};

function initialsOf(name){
  const p = String(name||'').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '??';
  return p.length===1 ? p[0].slice(0,2).toUpperCase() : (p[0][0]+p[p.length-1][0]).toUpperCase();
}

function overviewTiles(s, next, view){
  const c = s.candidates||[];
  const upNext = `<div class="tile tile--hi"><span class="tile__k">Up next</span><span class="tile__v u-fs-145">${next?String(next.n).padStart(2,'0'):'—'}</span><span class="tile__n">${next?esc(next.t):'Search complete'}</span></div>`;
  if (view.layout === 'dashboard') {
    return `<div class="tiles">
      <div class="tile"><span class="tile__k">Applicants</span><span class="tile__v">${c.length}</span></div>
      <div class="tile"><span class="tile__k">Semifinalists</span><span class="tile__v">${c.filter(x=>x.stage==='semifinalist'||x.stage==='finalist').length}</span></div>
      <div class="tile"><span class="tile__k">Finalists</span><span class="tile__v">${c.filter(x=>x.stage==='finalist').length}</span></div>
      ${upNext}
    </div>`;
  }
  return `<div class="tiles">
    <div class="tile"><span class="tile__k">Steps done</span><span class="tile__v">${s.progress.done}<span class="tile__n"> / ${stepTotal()}</span></span></div>
    <div class="tile"><span class="tile__k">On the committee</span><span class="tile__v">${(s.roster||[]).length}</span><span class="tile__n">${s.consensus?s.consensus.submitted+' answered':'intake not open'}</span></div>
    <div class="tile"><span class="tile__k">Candidates</span><span class="tile__v">${c.length}</span></div>
    ${upNext}
  </div>`;
}

// What the overview should point this viewer at. The firm's "up next" is the
// process's next step. A committee member is pointed only at steps they take
// part in; the firm's sourcing calls are not their next move.
function nextForViewer(s){
  const next = s.progress?.next;
  if (!next) return null;
  if (canOpenStep(next.key)) return next;
  return (s.steps||[]).find(st => canOpenStep(st.key) && st.status!=='done' && !st.blocked) || null;
}

function overviewInner(s, { preview=false }={}){
  const next = preview ? (s.progress && s.progress.next) : nextForViewer(s);
  const view = overviewView(s);
  const nextCard = next ? `<div class="next">
    <div class="t-label">${preview ? 'Where this sample is' : 'What to do now'}</div>
    <h2>Step ${next.n}. ${esc(next.t)}</h2>
    <p class="t-small">${nextHint(next)}</p>
    ${preview ? '' : `<div class="row"><button class="btn btn--primary" data-go="${peopleView(next.key)}">Open this step</button></div>`}
  </div>` : (isCommittee() && s.progress?.next ? `<div class="next">
    <div class="t-label">What to do now</div>
    <h2>Nothing needed from you right now</h2>
    <p class="t-small">The search team is working the file. You will be asked to score candidates once screening opens.</p>
  </div>` : '');
  const panels = view.layout === 'dashboard'
    ? `<div class="dash">${(view.panels||[]).map(k => DASH[k] ? DASH[k](s) : '').join('')}</div>`
    : rosterPanel(s);
  const steps = view.steps === 'strip' ? stepStrip(s) : phaseSpecs(s);
  return `${overviewTiles(s, next, view)}
      ${nextCard}
      ${panels}
      ${steps}
      ${packagePanel(s)}
      ${activityPanel(s)}`;
}

function vOverview(){
  const s = state.search;
  const next = nextForViewer(s);
  const view = overviewView(s);
  return shell(`
    ${head(s.no, s.position || 'Untitled position', `${esc(view.kicker||packageLabel(s.package)+' search')} for <b>${esc(s.client||'the client')}</b>. ${esc(s.fog||'')}. ${packagePill(s.package)}${view.lede?`<br><span class="t-small">${esc(view.lede)}</span>`:''}`,
      `${next ? `<button class="btn btn--primary" data-go="${peopleView(next.key)}">Continue Step ${next.n}</button>` : ''}
       ${canEdit() ? `<button class="btn btn--danger" data-act="delete-search" data-id="${s.id}" data-name="${esc(s.client||s.no||'this search')}">Archive search</button>` : ''}`)}
    <div class="band"><div class="wrap stack">
      ${overviewInner(s)}
    </div></div>`);
}

function vPackages(){
  const list = packages();
  const pkg = showcasePkg();
  const info = packageInfo(pkg);
  const view = info?.view || {};
  const demo = demoSearch(pkg);
  const inner = withPreview(demo, () => overviewInner(demo, { preview:true }));
  const tabs = `<div class="showtabs" role="tablist" aria-label="Pay level">${list.map(p => `
    <button type="button" class="showtab" role="tab" data-go="packages" data-pkg="${esc(p.key)}" aria-selected="${p.key===pkg}">
      <span class="showtab__nm">${esc(p.label)}</span>
      <span class="showtab__fee">${esc(p.fee)}</span>
    </button>`).join('')}
  </div>`;
  return shell(`
    ${head('Sample file', (info?.label || 'Package')+' · '+(info?.fee || ''),
      `${esc(view.kicker || packageLabel(pkg)+' search')} for <b>${esc(demo.client)}</b>. ${esc(demo.fog)}. ${packagePill(pkg)}${view.lede?`<br><span class="t-small">${esc(view.lede)}</span>`:''}<br><span class="t-small">This is a sample. Nothing here is saved. Use it to show a client what this pay level looks like in the workspace.</span>`,
      `${!isCommittee() ? `<button class="btn btn--primary" data-act="new-from-pkg" data-pkg="${esc(pkg)}">Open ${/^[aeiou]/i.test(info?.label || '')?'an':'a'} ${esc(info?.label || '')} search</button>` : ''}
       <button class="btn btn--secondary" data-go="home">Back to Home</button>`)}
    <div class="band"><div class="wrap stack">
      ${tabs}
      ${packageMatrix(pkg)}
      <div class="showcase">${inner}</div>
    </div></div>`);
}

function vFacts(){
  const s = state.search;
  return shell(`
    ${head('Search facts', s.client||'Client','These facts feed every generated document.',
      `<button class="btn btn--primary" data-act="save-facts">Save facts</button>
       <button class="btn btn--secondary" data-act="research">Research this ${jurisdictionInfo().noun}</button>
       <button class="btn btn--secondary" data-go="profile">Next · Step ${stepNo('profile')}</button>`)}
    <div class="band"><div class="wrap"><form id="facts" class="stack">
      ${packages().length ? `<div>
        <div class="sub u-mt-0">Service package</div>
        <p class="t-small u-mb-3">Pick the pay level the client bought. Moving down a column hides the steps that fee does not include; anything already drafted on them stays on file and comes back if you move up again.</p>
        ${packagePicker(s.package)}
      </div>
      <div class="sub">The client</div>` : ''}
      ${jurisdictionPicker(s.jurisdictionType)}
      <div class="grid2">
        ${field('Client','', `<input class="input" name="client" value="${esc(s.client)}">`)}
        ${field(jurisdictionInfo().key==='county'?'County website':'City or town website','Official site used for research.', `<input class="input" name="website" value="${esc(s.website||'')}" placeholder="https://">`)}
        ${field('Position','', `<input class="input" name="position" value="${esc(s.position)}">`)}
        ${field('State','', `<input class="input" name="state" value="${esc(s.state||'')}">`)}
        ${field('Form of government','', `<input class="input" name="fog" value="${esc(s.fog||'')}">`)}
        ${field('Population','', `<input class="input" name="population" value="${esc(s.population||'')}">`)}
        ${field('Budget','', `<input class="input" name="budget" value="${esc(s.budget||'')}">`)}
        ${field('Salary','', `<input class="input" name="salary" value="${esc(s.salary||'')}">`)}
        ${field('First review','', `<input class="input" name="firstReview" value="${esc(s.firstReview||'')}">`)}
      </div>
      ${field('Working notes','Not published. Used when you ask Claude to draft.', `<textarea class="input ed" name="notes">${esc(s.notes||'')}</textarea>`)}
    </form></div></div>`);
}

/* ===========================================================================
 * Step 1 — the search committee
 * ========================================================================= */

function seatPill(seat){
  const k = seat === 'manager' ? 'ok' : seat === 'consultant' ? 'info' : 'idle';
  return pill(k, SEAT[seat]?.label || seat);
}

function memberRow(m, mgr){
  const me = m.userId === state.user.id;
  const answered = intakeDoneBy(m.userId);
  const manage = canManage();
  return `<div class="seat${me?' seat--me':''}">
    <span class="seat__init">${esc(m.init)}</span>
    <div class="seat__who">
      <b>${esc(m.name)}${me?' (you)':''}</b>
      <div class="t-small">${esc(m.title||'')}${m.email?' · '+esc(m.email):''}</div>
    </div>
    <div class="seat__tags">${seatPill(m.seat)}${answered?pill('ok','Answered'):''}</div>
    <div class="seat__acts">
      ${manage && m.seat==='consultant' ? `<button class="btn btn--ghost btn--sm" data-act="make-manager" data-uid="${m.userId}">Hand over the account</button>` : ''}
      ${!manage && me && you().consultant ? `<button class="btn btn--secondary btn--sm" data-act="make-manager" data-uid="${m.userId}">Take the account</button>` : ''}
      ${manage && m.role==='committee' ? `<button class="btn btn--ghost btn--sm" data-act="reset-pin" data-uid="${m.userId}" data-name="${esc(m.name)}">New PIN</button>` : ''}
      ${manage && m.userId !== mgr?.userId ? `<button class="btn btn--ghost btn--sm" data-act="unseat" data-uid="${m.userId}" data-name="${esc(m.name)}">Remove</button>` : ''}
    </div>
  </div>`;
}

// Shown once, right after a member is seated or their PIN is reissued. There is
// no mail server here, so this card is the only place the PIN appears.
function pinCard(){
  const p = state.newPin;
  if (!p) return '';
  return `<div class="notice notice--ok pincard"><div>
    <div class="notice__t">Sign-in for ${esc(p.name)}</div>
    <div class="notice__b">Read these to them now. The PIN is not shown again; you can issue a new one from the roster.</div>
    <div class="pincard__creds"><span class="mono">${esc(p.email)}</span><span class="mono pincard__pin">${esc(p.pin)}</span></div>
    <button class="btn btn--ghost btn--sm" data-act="dismiss-pin">Got it</button>
  </div></div>`;
}

function vTeam(){
  const s = state.search;
  const list = s.roster || [];
  const mgr = s.accountManager;
  const confirmed = Boolean(s.team?.confirmedAt);
  const manage = canManage();
  const committeeCount = list.filter(m => m.seat === 'committee').length;
  return shell(`
    ${head('Step '+stepNo('team'),'Search committee',
      'Everyone who gets a say in this hire, and the one consultant who runs the account. Each person seated here signs in with their own email and PIN, answers Step '+stepNo('intake')+' privately, and scores candidates later.',
      manage ? `<button class="btn btn--${confirmed?'secondary':'primary'}" data-act="confirm-team">${confirmed?'Reopen the roster':'Roster is set'}</button>
       ${nextBtn('team')}` : nextBtn('team'))}
    <div class="band"><div class="wrap stack">
      ${pinCard()}
      ${you().consultant && !you().member ? `<div class="notice notice--info"><div>
        <div class="notice__t">You are not on this search</div>
        <div class="notice__b">You can read and edit it as a consultant, but seating people and running intake belong to whoever holds the account. Join the file to take it over.
          <button class="btn btn--secondary btn--sm" data-act="join-search">Join this search</button></div>
      </div></div>` : ''}
      ${mgr ? `<div class="spec"><div class="spec__bar">Account manager</div>
        <div class="spec__body">
          <div class="seat seat--mgr">
            <span class="seat__init">${esc(mgr.init)}</span>
            <div class="seat__who"><b>${esc(mgr.name)}</b><div class="t-small">${esc(mgr.title||'')} · ${esc(mgr.email)}</div></div>
            <div class="seat__tags">${pill('ok','Runs this search')}</div>
            <div class="seat__acts"></div>
          </div>
          <p class="t-small">${esc(SEAT.manager.hint)} Any consultant on the roster can take the account; hand it over from the list below.</p>
        </div></div>` : ''}

      <div class="spec"><div class="spec__bar">Roster ${pill(committeeCount?'ok':'wait', committeeCount+(committeeCount===1?' committee seat':' committee seats'))}</div>
        <div class="spec__body stack">
          ${list.map(m => memberRow(m, mgr)).join('')}
          ${!committeeCount ? `<div class="t-small">No committee members seated yet. A search can run with the firm alone, but then Step ${stepNo('intake')} only collects your own answers.</div>` : ''}
        </div></div>

      ${manage ? `<div class="spec"><div class="spec__bar">Seat someone</div>
        <div class="spec__body">
          <form id="newmember" class="grid2">
            ${field('Name','', `<input class="input" name="name" placeholder="Dana Reyes" required>`)}
            ${field('Email','Their sign-in. A PIN is generated when you seat them.', `<input class="input" name="email" type="email" placeholder="dreyes@example.gov" required>`)}
            ${field('Title','', `<input class="input" name="title" placeholder="Board or committee member">`)}
            ${field('Seat','', `<select class="input" name="seat">
              <option value="committee">Committee member</option>
              <option value="consultant">Consultant at the firm</option>
            </select>`)}
          </form>
          <p class="t-small">${esc(SEAT.committee.hint)} A consultant seat is for firm staff and requires an account that already exists.</p>
          <div class="row u-mt-3"><button class="btn btn--primary" type="submit" form="newmember">Seat this person</button></div>
        </div></div>` : ''}

      <div class="notice notice--${confirmed?'ok':'info'}"><div>
        <div class="notice__t">${confirmed?'Roster confirmed':'Confirm the roster before opening intake'}</div>
        <div class="notice__b">${confirmed
          ? 'Step '+stepNo('intake')+' can open. Seating anyone new reopens this step, because a person added later would miss the window.'
          : 'Everyone who should get a say needs a seat first. Once you confirm, you can open the intake window.'}</div>
      </div></div>
      ${stepFooter('team')}
    </div></div>`);
}

/* ===========================================================================
 * Step 2 — committee intake
 *
 * Two pages behind one route. A seated member answers; the account manager
 * runs the window and reads the room. A consultant who is both sees both.
 * ========================================================================= */

function mySubmission(){
  return (state.search?.intake?.submissions || {})[state.user.id] || null;
}

function intakeDoneBy(userId){
  const sub = (state.search?.intake?.submissions || {})[userId];
  if (sub) return Boolean(sub.submitted);
  // While the window is open the server only ships you your own answer, so
  // everyone else's status has to come from the consensus roll-up.
  const agg = state.search?.consensus;
  if (!agg) return false;
  return !agg.pending.some(p => p.userId === userId);
}

// The draft a member is editing lives in state, not the DOM, so adding a line
// or changing a weight does not lose what they already typed elsewhere.
function intakeDraft(){
  if (!state.intake) {
    const mine = mySubmission();
    state.intake = {
      items: (mine?.items || []).map(i => ({ ...i })),
      mustHave: mine?.mustHave || '',
      dealBreaker: mine?.dealBreaker || '',
      context: mine?.context || ''
    };
  }
  return state.intake;
}

function collectIntakeText(){
  const d = intakeDraft();
  for (const k of ['mustHave','dealBreaker','context']) {
    const el = $('#intake-'+k);
    if (el) d[k] = el.value;
  }
  $$('.intake-row[data-row]').forEach(row => {
    const item = d.items[Number(row.dataset.row)];
    if (!item) return;
    const label = $('[data-f="label"]', row);
    const note = $('[data-f="note"]', row);
    if (label) item.label = label.value;
    if (note) item.note = note.value;
  });
  return d;
}

function intakeRow(item, i){
  return `<div class="intake-row" data-row="${i}">
    <div class="stack u-gap-6">
      <input class="input" data-f="label" value="${esc(item.label)}" placeholder="Name it in your own words">
      <input class="input" data-f="note" value="${esc(item.note||'')}" placeholder="Why does this matter here? (optional)">
    </div>
    <div class="wgt" title="How much does this matter?">${[1,2,3,4,5].map(n=>`<button type="button" data-iw="${n}" aria-pressed="${Number(item.weight)===n}">${n}</button>`).join('')}</div>
    <button class="btn btn--ghost btn--sm" data-idel="${i}">Remove</button>
  </div>`;
}

function intakeGroup(kind){
  const d = intakeDraft();
  const rows = d.items.map((it,i)=>({it,i})).filter(x => x.it.kind===kind);
  const labels = new Set(rows.map(x => String(x.it.label||'').trim().toLowerCase()).filter(Boolean));
  const ask = INTAKE_ASK[kind];
  return `<div class="spec"><div class="spec__bar">${esc(ask.t)}</div>
    <div class="spec__body stack">
      <p class="t-small">${esc(ask.hint)} Add as many as you want. Rate each 1 to 5 for how much it matters to you.</p>
      <div class="pick">${(SUGGEST[kind]||[]).map(label => {
        const on = labels.has(label.toLowerCase());
        return `<button type="button" data-ipick="${kind}" data-label="${esc(label)}" aria-pressed="${on}">${esc(label)}</button>`;
      }).join('')}</div>
      ${rows.map(x => intakeRow(x.it, x.i)).join('') || '<div class="t-small">Nothing here yet. Tap a suggestion or write your own.</div>'}
      <div class="row"><button class="btn btn--secondary btn--sm" data-iadd="${kind}">Write my own</button></div>
    </div></div>`;
}

function vIntakeAnswer(){
  const s = state.search;
  const intake = s.intake || {};
  const mine = mySubmission();
  const d = intakeDraft();
  const open = intake.status === 'open';
  const closed = intake.status === 'closed';
  const count = d.items.filter(i => String(i.label||'').trim()).length;
  return shell(`
    ${head('Step '+stepNo('intake'), 'What are you looking for?',
      'Answer for yourself. Nobody on the committee sees your answers, or anyone else’s, until the account manager closes the window. Then everything is read together.',
      open ? `<button class="btn btn--primary" data-act="submit-intake">${mine?.submitted ? 'Update my answers' : 'Submit my answers'}</button>
       <button class="btn btn--secondary" data-act="save-intake">Save and finish later</button>` : '')}
    <div class="band"><div class="wrap stack">
      ${!open ? `<div class="notice notice--${closed?'ok':'info'}"><div>
        <div class="notice__t">${closed ? 'Intake is closed' : 'Intake has not opened yet'}</div>
        <div class="notice__b">${closed
          ? 'The window is shut and the committee’s answers have been read together. Ask '+esc(s.accountManager?.name||'the account manager')+' if you still need to add something.'
          : esc(s.accountManager?.name||'The account manager')+' will open it when the roster is set.'}</div>
      </div></div>` : ''}
      ${mine?.submitted ? `<div class="notice notice--ok"><div>
        <div class="notice__t">Your answers are in</div>
        <div class="notice__b">Submitted ${esc((mine.updatedAt||mine.at||'').slice(0,10))}. ${open?'You can still change them while the window is open.':''}</div>
      </div></div>` : ''}
      ${intake.dueBy ? `<div class="t-small"><b>Due:</b> ${esc(intake.dueBy)}</div>` : ''}
      ${intake.prompt ? `<div class="spec"><div class="spec__bar">From the account manager</div><div class="spec__body"><p>${esc(intake.prompt)}</p></div></div>` : ''}
      ${open ? `
        ${Object.keys(INTAKE_ASK).map(intakeGroup).join('')}
        <div class="spec"><div class="spec__bar">In your own words</div><div class="spec__body stack">
          ${field('What would make you say yes to a candidate?','', `<textarea class="input ed" id="intake-mustHave" rows="3">${esc(d.mustHave)}</textarea>`)}
          ${field('What would make you say no?','', `<textarea class="input ed" id="intake-dealBreaker" rows="3">${esc(d.dealBreaker)}</textarea>`)}
          ${field('Anything else the search team should know','', `<textarea class="input ed" id="intake-context" rows="3">${esc(d.context)}</textarea>`)}
        </div></div>
        <div class="row">
          <button class="btn btn--primary" data-act="submit-intake">${mine?.submitted?'Update my answers':'Submit my answers'}</button>
          <button class="btn btn--secondary" data-act="save-intake">Save and finish later</button>
          <span class="t-small">${count} named so far.</span>
        </div>` : ''}
      ${closed && s.consensus ? consensusPanels(s.consensus, false) : ''}
      ${stepFooter('intake')}
    </div></div>`);
}

function consensusMeter(entry, submitted){
  const pct = Math.round((entry.share || 0) * 100);
  const tone = entry.consensus==='unanimous' ? 'ok' : entry.consensus==='strong' ? 'ok' : entry.consensus==='split' ? 'wait' : 'idle';
  return `<div class="cons">
    <div class="cons__hd">
      <b>${esc(entry.label)}</b>
      <span class="cons__tags">
        ${pill(tone, entry.mentions+' of '+submitted)}
        ${entry.contested ? pill('stop','Contested') : ''}
        <span class="t-small mono">avg ${entry.avgWeight.toFixed(1)}</span>
      </span>
    </div>
    <div class="cons__bar"><span data-width-pct="${pct}"></span></div>
    <div class="cons__who t-small">${entry.voters.map(v => esc(v.name||'A member')+' '+v.weight).join(' · ')}</div>
    ${entry.contested ? `<div class="t-small cons__flag">Rated as low as ${entry.minWeight} and as high as ${entry.maxWeight}. Worth naming out loud before the profile is adopted.</div>` : ''}
    ${entry.notes.length ? `<div class="cons__notes">${entry.notes.slice(0,3).map(n => `<div class="t-small">${esc(n.name||'A member')}: ${esc(n.note)}</div>`).join('')}</div>` : ''}
  </div>`;
}

function consensusPanels(agg, showEmpty=true){
  if (!agg.submitted) {
    return showEmpty ? `<div class="empty"><div class="empty__t">Nothing submitted yet</div>Consensus appears as members answer.</div>` : '';
  }
  const kinds = [['skill','Essential skills'],['trait','Leadership and personality traits'],['chall','Current challenges'],['opp','Future opportunities']];
  return kinds.map(([k,label]) => {
    const list = agg.byKind[k] || [];
    return `<div class="spec"><div class="spec__bar">${esc(label)} ${pill(list.length>=3?'ok':'wait', list.length+' named')}</div>
      <div class="spec__body stack">
        ${list.map(e => consensusMeter(e, agg.submitted)).join('') || '<div class="t-small">Nobody named anything here. You will have to write these yourself.</div>'}
      </div></div>`;
  }).join('') + (agg.voices.length ? `<div class="spec"><div class="spec__bar">In their own words</div>
    <div class="spec__body stack">${agg.voices.map(v => `<div class="voice">
      <div class="t-label">${esc(v.name||'A member')}</div>
      ${v.mustHave ? `<div class="t-small"><b>Yes to:</b> ${esc(v.mustHave)}</div>` : ''}
      ${v.dealBreaker ? `<div class="t-small"><b>No to:</b> ${esc(v.dealBreaker)}</div>` : ''}
      ${v.context ? `<div class="t-small"><b>Also:</b> ${esc(v.context)}</div>` : ''}
    </div>`).join('')}</div></div>` : '');
}

function vIntakeManage(){
  const s = state.search;
  const intake = s.intake || {};
  const agg = s.consensus;
  const confirmed = Boolean(s.team?.confirmedAt);
  const open = intake.status === 'open';
  const closed = intake.status === 'closed';
  const mine = mySubmission();
  const waiting = agg?.pending || [];
  return shell(`
    ${head('Step '+stepNo('intake'), 'Committee input',
      'Each member answers on their own, before anyone drafts a profile. You see who has responded while the window is open, and what they said once you close it.',
      `${!open && !closed ? `<button class="btn btn--primary" data-act="intake-open" ${confirmed?'':'disabled'}>Open the window</button>` : ''}
       ${open ? `<button class="btn btn--primary" data-act="intake-close">Close and read the room</button>` : ''}
       ${closed ? `<button class="btn btn--secondary" data-act="intake-open">Reopen the window</button>` : ''}
       ${nextBtn('intake')}`)}
    <div class="band"><div class="wrap stack">
      ${!confirmed ? `<div class="notice notice--info"><div>
        <div class="notice__t">Confirm the roster first</div>
        <div class="notice__b">Anyone seated after the window opens would miss it. Finish Step ${stepNo('team')}, then open intake.</div>
      </div></div>` : ''}

      <div class="tiles">
        <div class="tile"><span class="tile__k">Seated</span><span class="tile__v">${agg?agg.seats:(s.roster||[]).length}</span></div>
        <div class="tile"><span class="tile__k">Answered</span><span class="tile__v">${agg?agg.submitted:0}</span></div>
        <div class="tile"><span class="tile__k">Waiting on</span><span class="tile__v">${waiting.length}</span></div>
        <div class="tile tile--hi"><span class="tile__k">Window</span><span class="tile__v u-fs-135">${open?'Open':closed?'Closed':'Not open'}</span><span class="tile__n">${esc(intake.dueBy||'no due date')}</span></div>
      </div>

      ${canManage() ? `<div class="spec"><div class="spec__bar">Window</div>
        <div class="spec__body"><form id="intakewindow" class="grid2">
          ${field('Due date','Shown to every member.', `<input class="input" name="dueBy" value="${esc(intake.dueBy||'')}" placeholder="Respond by 12 Sep 2026">`)}
          ${field('Note to the committee','Optional. Appears above their form.', `<input class="input" name="prompt" value="${esc(intake.prompt||'')}" placeholder="Answer for yourself, not for the group.">`)}
        </form>
        <div class="row u-mt-3"><button class="btn btn--secondary btn--sm" data-act="intake-save-window">Save window settings</button></div>
      </div></div>` : ''}

      ${waiting.length ? `<div class="spec"><div class="spec__bar">Still waiting on</div>
        <div class="spec__body"><div class="waiting">${waiting.map(p => `<span class="chip">${esc(p.name||'A member')}</span>`).join('')}</div>
        <p class="t-small">You can close the window without them. Their seat still scores candidates later.</p>
        </div></div>` : ''}

      ${!mine?.submitted && you().member ? `<div class="notice notice--info"><div>
        <div class="notice__t">You have not answered yet</div>
        <div class="notice__b">Your seat is counted in the tally too. <button class="btn btn--ghost btn--sm" data-go="intake-mine">Answer now</button></div>
      </div></div>` : ''}

      ${!closed ? `<div class="notice notice--info"><div>
        <div class="notice__t">Answers are private until you close the window</div>
        <div class="notice__b">You can read the running tally because you are facilitating. The committee cannot, so nobody times their answer against the count.</div>
      </div></div>` : ''}

      <div class="sub">What the committee said</div>
      ${agg ? consensusPanels(agg) : ''}

      ${agg && agg.submitted ? `<div class="next">
        <div class="t-label">Turn this into the profile</div>
        <h2>Step ${stepNo('profile')}. Adopt the candidate profile</h2>
        <p class="t-small">Ranked by how many members named each item, weighted by how much they said it mattered. Anything you have already written by hand is kept behind the consensus. You edit it afterward.</p>
        <div class="row">
          <button class="btn btn--primary" data-act="adopt-consensus">Build the profile from this</button>
          <button class="btn btn--secondary" data-go="profile">Open Step ${stepNo('profile')}</button>
        </div>
      </div>` : ''}
      ${stepFooter('intake')}
    </div></div>`);
}

function vIntake(){
  // A committee member only ever has the answer page. A consultant gets the
  // facilitator view, and reaches their own form from the prompt on it.
  if (!you().consultant || state.view === 'intake-mine') return vIntakeAnswer();
  return vIntakeManage();
}

function nextCritId(kind){
  const p = PREFIX[kind];
  const nums = (state.search.criteria||[]).filter(c=>c.kind===kind).map(c => Number(String(c.id||'').replace(p,'')) || 0);
  return p + (Math.max(0, ...nums) + 1);
}

function kindCount(kind){
  return (state.search.criteria||[]).filter(c => c.kind===kind && String(c.label||'').trim()).length;
}
function kindTotal(kind){
  return (state.search.criteria||[]).filter(c => c.kind===kind).length;
}

// The consensus entry a profile line came from, matched on the label so the
// badge survives the consultant renaming or reweighting it.
function consensusFor(kind, label){
  const agg = state.search?.consensus;
  if (!agg) return null;
  const want = String(label||'').trim().toLowerCase();
  if (!want) return null;
  return (agg.byKind[kind] || []).find(e => e.label.trim().toLowerCase() === want) || null;
}

function critSource(c){
  const e = consensusFor(c.kind, c.label);
  if (e) {
    return `<span class="crit-src">${pill(e.contested?'stop':'ok', e.mentions+' of '+state.search.consensus.submitted)}${e.contested?pill('stop','Contested'):''}</span>`;
  }
  if (c.from === 'draft') return `<span class="crit-src">${pill('info','Drafted')}</span>`;
  return `<span class="crit-src">${pill('idle','Yours')}</span>`;
}

function critRow(c, i){
  return `<div class="crit-row" data-row="${i}">
    <span class="mono t-small">${esc(c.id||'')}${critSource(c)}</span>
    <div class="stack u-gap-6">
      <input class="input" data-f="label" value="${esc(c.label)}" placeholder="Label">
      <input class="input" data-f="note" value="${esc(c.note||'')}" placeholder="Why this matters here">
    </div>
    <div class="wgt">${[1,2,3,4,5].map(n=>`<button type="button" data-w="${n}" aria-pressed="${Number(c.weight)===n}">${n}</button>`).join('')}</div>
    <button class="btn btn--ghost btn--sm" data-del="${i}">Remove</button>
  </div>`;
}

function labeledKind(kind, criteria){
  return (criteria || []).filter(c => c.kind===kind && String(c.label||'').trim());
}

function inCritRange(n){
  return n >= 3 && n <= 5;
}

function profileGaps(criteria){
  const names = {
    skill:'3 to 5 essential skills',
    trait:'3 to 5 leadership traits',
    chall:'3 to 5 current challenges',
    opp:'3 to 5 future opportunities'
  };
  return Object.keys(KIND).filter(k => !inCritRange(labeledKind(k, criteria).length)).map(k => names[k]);
}

function vProfile(){
  const s = state.search;
  const agg = s.consensus;
  const adopted = (s.criteria||[]).some(c => c.from === 'committee');

  // A committee member reads the adopted profile; they do not edit it. Showing
  // them live inputs the server would reject is worse than showing the result.
  if (!canEdit()) {
    return shell(`
      ${head('Step '+stepNo('profile'),'Candidate profile',
        'What the search is looking for, adopted from the committee’s answers. Candidates are screened and interviewed against these.',
        nextBtn('profile'))}
      <div class="band"><div class="wrap stack">
        ${!(s.criteria||[]).length ? `<div class="empty"><div class="empty__t">Not adopted yet</div>${esc(s.accountManager?.name||'The account manager')} builds this from committee input.</div>` : ''}
        ${Object.keys(KIND).map(k => {
          const rows = labeledKind(k, s.criteria);
          if (!rows.length) return '';
          return `<div class="spec"><div class="spec__bar">${KIND[k].plural}</div>
            <div class="spec__body stack">${rows.map(c => `
              <div class="crit-read">
                <span class="mono t-small">${esc(c.id)}</span>
                <div><b>${esc(c.label)}</b>${c.note?`<div class="t-small">${esc(c.note)}</div>`:''}</div>
                <span class="t-small mono">weight ${esc(c.weight)}</span>
              </div>`).join('')}</div></div>`;
        }).join('')}
        ${stepFooter('profile')}
      </div></div>`);
  }

  const groups = Object.keys(KIND).map(k => {
    const rows = (s.criteria||[]).map((c,i)=>({c,i})).filter(x=>x.c.kind===k);
    const n = rows.filter(x => String(x.c.label||'').trim()).length;
    const atCap = rows.length >= 5;
    const labels = new Set(rows.map(x => x.c.label.trim().toLowerCase()).filter(Boolean));
    const range = inCritRange(n) ? 'ok' : (k==='skill' ? 'wait' : (n ? 'wait' : 'idle'));
    // What the committee named comes first and is marked as theirs. The stock
    // suggestions stay underneath for the gaps nobody filled.
    const fromRoom = (agg?.byKind[k] || []).filter(e => !labels.has(e.label.trim().toLowerCase()));
    return `<div>
      <div class="sub">${KIND[k].plural} ${pill(range, n+' of 3–5')}</div>
      ${k==='skill' ? `<p class="t-small">Select 3 to 5 essential skills. These become the spine of the ads, surveys, and interviews.</p>` : ''}
      ${fromRoom.length ? `<p class="t-small">Named by the committee and not on the profile yet:</p>
        <div class="pick pick--room">${fromRoom.map(e =>
          `<button type="button" data-pick="${k}" data-label="${esc(e.label)}" data-weight="${Math.round(e.avgWeight)}" aria-pressed="false" ${atCap?'disabled':''}>${esc(e.label)} <span class="mono">${e.mentions}/${agg.submitted}</span></button>`
        ).join('')}</div>` : ''}
      <div class="pick">${(SUGGEST[k]||[]).map(label => {
        const on = labels.has(label.toLowerCase());
        return `<button type="button" data-pick="${k}" data-label="${esc(label)}" aria-pressed="${on}" ${!on && atCap ? 'disabled':''}>${esc(label)}</button>`;
      }).join('')}</div>
      ${rows.map(x=>critRow(x.c,x.i)).join('') || '<div class="t-small">None selected yet.</div>'}
      <div class="row u-mt-3"><button class="btn btn--secondary btn--sm" data-add="${k}" ${atCap?'disabled':''}>Add another ${KIND[k].label.toLowerCase()}</button></div>
    </div>`;
  }).join('');

  return shell(`
    ${head('Step '+stepNo('profile'),'Candidate profile','This is the spine. Built from what the committee said in Step '+stepNo('intake')+', then edited by you. Recruiting markets it. Surveys test it. Interviews evidence it.',
      `<button class="btn btn--primary" data-act="save-profile-next">Save and move on</button>
       <button class="btn btn--secondary" data-act="save-profile">Save profile</button>
       ${agg?.submitted && canManage() ? `<button class="btn btn--secondary" data-act="adopt-consensus">${adopted?'Rebuild from committee':'Build from committee'}</button>` : ''}
       <button class="btn btn--secondary" data-act="draft-profile">Draft with Claude</button>`)}
    <div class="band"><div class="wrap stack">
      ${agg?.submitted ? `<div class="notice notice--${adopted?'ok':'info'}"><div>
        <div class="notice__t">${agg.submitted} of ${agg.seats} on the committee answered</div>
        <div class="notice__b">${adopted
          ? 'This profile was built from their answers. The badge on each line shows how many of them named it. Edit freely; the badges follow the label.'
          : 'Build the matrix from their answers rather than typing it from memory, then edit.'}
          ${agg.contested.length ? ' <b>'+agg.contested.length+'</b> item'+(agg.contested.length===1?' is':'s are')+' contested — the committee disagrees on how much '+(agg.contested.length===1?'it matters':'they matter')+'.' : ''}
          <button class="btn btn--ghost btn--sm" data-go="intake">See what they said</button></div>
      </div></div>` : `<div class="notice notice--info"><div>
        <div class="notice__t">No committee input on file</div>
        <div class="notice__b">Step ${stepNo('intake')} collects what each member is looking for, and this matrix is normally built from it. You can still write the profile by hand.</div>
      </div></div>`}
      ${modelToggle()}
      ${field('Notes for the draft','Paste governing-body workshop notes. Claude drafts from the committee’s answers first, then these. You still choose the skills.',
        `<textarea class="input ed" id="profilenotes">${esc(s.notes||'')}</textarea>`)}
      ${groups}
      ${stepFooter('profile')}
    </div></div>`);
}

function docBlock(label, text){
  if (!text) return '';
  return `<div><div class="doc__h">${esc(label)}</div><p>${esc(text)}</p></div>`;
}

function sectionBlocks(obj, pairs){
  if (!obj) return '';
  if (typeof obj === 'string') return obj ? `<p>${esc(obj)}</p>` : '';
  return pairs.map(([k, label]) => obj[k] ? docBlock(label, obj[k]) : '').join('');
}

// The field keys and labels come from the server (server/brochure.js) via
// /api/config — this is the same schema ai.js uses to structure what Claude
// writes, so the client never maintains its own copy that could drift.
function placeFields(){ return state.health?.communityFields?.place || []; }
function govFields(){
  return (state.health?.communityFields?.gov || []).map(([key, label]) => {
    if (jurisdictionInfo().key === 'county') {
      if (key === 'roles') label = 'Roles of the county board and elected officials';
      if (key === 'managerRole') label = 'Role of the ' + (state.search?.position || 'county administrator');
    }
    return [key, label];
  });
}

function prose(text){
  return String(text||'').trim().split(/\n{2,}/).filter(Boolean)
    .map(p => `<p>${esc(p).replace(/\n/g,'<br>')}</p>`).join('');
}
function packSec(label, text, extra='', photo=''){
  if (!text && !extra && !photo) return '';
  return `<section class="pack__sec"><div class="pack__h">${esc(label)}</div>${photo}${text?`<div class="pack__prose">${prose(text)}</div>`:''}${extra}</section>`;
}
function packPhoto(src, caption){
  if (!src) return '';
  return `<figure class="pack__fig"><img src="${esc(src)}" alt="${esc(caption||'')}">${caption?`<figcaption>${esc(caption)}</figcaption>`:''}</figure>`;
}
function packChips(kind){
  const rows = labeledKind(kind, state.search?.criteria||[]);
  if (!rows.length) return '';
  return `<div class="pack__chips">${rows.map(c => `<span class="pack__chip">${esc(c.label)}</span>`).join('')}</div>`;
}
function packFact(k, v){
  if (!v) return '';
  return `<div class="pack__fact"><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
}
const AD_KIND = {
  full: { tag:'Full listing', use:'ICMA, job boards, jurisdiction website' },
  short: { tag:'Short', use:'Newsletters and association briefs' },
  social: { tag:'Social', use:'LinkedIn and official channels' },
  association: { tag:'Association', use:'ICMA / state manager networks' }
};
// The valid set of theme/scheme ids and their order come from the server
// (server/brochure.js — the same validator the API enforces); only the
// display label and swatch color are client-only presentation data.
const PACK_LAYOUT_LABEL = {
  photo: 'Photo cover',
  split: 'Split cover',
  classic: 'Classic type',
  banner: 'Banner',
  masthead: 'Masthead'
};
const PACK_SCHEME_META = {
  navy: ['Navy / cream', '#1B3A63'],
  forest: ['Forest / cream', '#1F4A3A'],
  burgundy: ['Burgundy / cream', '#5C2433'],
  charcoal: ['Charcoal / cream', '#2C2E32'],
  municipal: ['Slate / white', '#3D5A73']
};
function packLayoutOptions(){
  const ids = state.health?.packThemes || Object.keys(PACK_LAYOUT_LABEL);
  return ids.map(id => [id, PACK_LAYOUT_LABEL[id] || id]);
}
function packSchemeOptions(){
  const ids = state.health?.packSchemes || Object.keys(PACK_SCHEME_META);
  return ids.map(id => [id, ...(PACK_SCHEME_META[id] || [id, '#3D5A73'])]);
}
function packThemeOf(a){
  const t = a && a.theme;
  const ids = state.health?.packThemes || Object.keys(PACK_LAYOUT_LABEL);
  return ids.includes(t) ? t : ids[0];
}
function packSchemeOf(a){
  const t = a && a.scheme;
  const ids = state.health?.packSchemes || Object.keys(PACK_SCHEME_META);
  return ids.includes(t) ? t : ids[0];
}
function packHero(src, theme, extraClass=''){
  if (!src || theme==='classic' || theme==='masthead') return '';
  return `<div class="pack__hero${extraClass?' '+extraClass:''}"><img src="${esc(src)}" alt=""></div>`;
}
function packStudioBar(a){
  const theme = packThemeOf(a);
  const scheme = packSchemeOf(a);
  return `<div class="studio__bar">
    <div>
      <div class="sub u-m-0">Color</div>
      <p class="t-small">Print palettes. The brochure and the ads stay a matched packet.</p>
      <div class="schemes" role="group" aria-label="Packet color">
        ${packSchemeOptions().map(([id,label,ink]) =>
          `<button type="button" class="scheme${scheme===id?' is-on':''}" data-act="pack-scheme" data-scheme="${id}" aria-pressed="${scheme===id}" title="${esc(label)}">
            <span class="scheme__swatch" data-swatch="${esc(ink)}"></span>${esc(label)}
          </button>`
        ).join('')}
      </div>
    </div>
    <div>
      <div class="sub u-m-0">Layout</div>
      <p class="t-small">The live mockup below is what prints.</p>
      <div class="layouts" role="group" aria-label="Packet layout">
        ${packLayoutOptions().map(([id,label]) =>
          `<button type="button" class="layout${theme===id?' is-on':''}" data-act="pack-theme" data-layout="${id}" aria-pressed="${theme===id}">${esc(label)}</button>`
        ).join('')}
      </div>
    </div>
  </div>`;
}

function editArea(path, label, value, hint='', rows=4){
  const control = rows <= 1
    ? `<input class="input" data-path="${esc(path)}" value="${esc(value||'')}">`
    : `<textarea class="input ed" data-path="${esc(path)}" data-min-height="${36+rows*20}">${esc(value||'')}</textarea>`;
  return field(label, hint, control);
}
function setAt(obj, path, value){
  const parts = String(path).split('.');
  let cur = obj;
  for (let i=0; i<parts.length-1; i++){
    const k = parts[i];
    const next = parts[i+1];
    const asArr = /^\d+$/.test(next);
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = asArr ? [] : {};
    cur = cur[k];
  }
  cur[parts[parts.length-1]] = value;
}
function collectArtifact(kind){
  const form = $('#edit-'+kind);
  if (form){
    const out = JSON.parse(JSON.stringify(state.search.artifacts?.[kind] || {}));
    $$('[data-path]', form).forEach(el => setAt(out, el.dataset.path, el.value));
    return out;
  }
  const raw = $('#art-'+kind)?.value;
  if (raw == null) return state.search.artifacts?.[kind] || {};
  return JSON.parse(raw);
}
function editorWrap(kind, inner){
  return `<form id="edit-${kind}" class="editor">
    <div class="sub">Edit the copy</div>
    <p class="t-small">Change the wording in these fields, then Save edits. The preview above updates. You do not need to edit JSON.</p>
    ${inner}
  </form>`;
}
function sourceJson(kind, obj, folded){
  const ta = `<textarea class="input ed ed--lg" id="art-${kind}">${esc(JSON.stringify(obj||{}, null, 2))}</textarea>`;
  if (!folded) return `<div class="sub">Source (editable JSON)</div>${ta}`;
  return `<details class="srcjson"><summary>Source JSON</summary><p class="t-small">The fields above are the usual way to edit. This is the raw file.</p>${ta}</details>`;
}
function artifactEditor(kind, a){
  a = a || {};
  if (kind==='community'){
    const gov = a.government || {}, place = (typeof a.community==='object' && a.community) ? a.community : {};
    const facts = Array.isArray(a.facts) ? a.facts : [];
    return editorWrap(kind, `
      ${editArea('lede','Why a candidate would live and lead here', a.lede,'',5)}
      ${facts.length ? `<div class="sub">Facts pulled from research</div>${facts.map((f,i)=>`<div class="grid2">${editArea('facts.'+i+'.k','Label',f.k,'',1)}${editArea('facts.'+i+'.v','Value',f.v,'',2)}</div>`).join('')}` : ''}
      <div class="sub">Form of government</div>
      ${govFields().map(([k,label]) => editArea('government.'+k, label, gov[k], '', 3)).join('')}
      <div class="sub">The community</div>
      ${placeFields().map(([k,label]) => editArea('community.'+k, label, typeof place[k]==='string'?place[k]:'', '', 3)).join('')}
      ${editArea('organization','The organization', a.organization,'',4)}
      ${editArea('why','Why lead here', a.why,'',3)}
    `);
  }
  if (kind==='brochure'){
    return editorWrap(kind, `
      ${editArea('title','Title', a.title,'',1)}
      ${editArea('lede','Opening', a.lede,'',4)}
      ${editArea('theOpportunity','The opportunity', a.theOpportunity,'',5)}
      ${editArea('thePlace','About the community', a.thePlace,'',6)}
      ${editArea('theOrganization','About the organization', a.theOrganization,'',5)}
      ${editArea('leadershipOpportunity','Leadership opportunity', a.leadershipOpportunity,'',4)}
      ${editArea('challenges','Current challenges', a.challenges,'',4)}
      ${editArea('opportunities','Future opportunities', a.opportunities,'',4)}
      ${editArea('ideal','Desired candidate', a.ideal,'',4)}
      ${editArea('theJob','Position responsibilities', a.theJob,'',5)}
      ${editArea('compensation','Compensation and benefits', a.compensation,'',3)}
      ${editArea('whyConsider','Why consider this community', a.whyConsider,'',4)}
      ${editArea('howToApply','How to apply', a.howToApply,'',3)}
    `);
  }
  if (kind==='ads'){
    return editorWrap(kind, `
      <div class="grid2">
        ${editArea('openingDate','Opens', a.openingDate,'',1)}
        ${editArea('firstReview','First review', a.firstReview,'',1)}
        ${editArea('closing','Closes', a.closing,'',1)}
        ${editArea('apply','Apply', a.apply,'website or email',1)}
        ${editArea('contact','Contact', a.contact,'',1)}
      </div>
      ${['full','short','social','association'].map(k => {
        const meta = AD_KIND[k];
        const ad = a[k] || {};
        return `<div class="sub">${meta.tag} · ${meta.use}</div>
          ${editArea(k+'.headline','Headline', ad.headline,'',1)}
          ${editArea(k+'.body','Body', ad.body,'', k==='social'?4:7)}`;
      }).join('')}
    `);
  }
  if (kind==='survey1' || kind==='survey2'){
    const qs = a.questions || [];
    if (!qs.length && !a.intro) return '';
    return editorWrap(kind, `
      ${editArea('intro','Introduction shown to the candidate', a.intro,'',3)}
      ${editArea('dueHint','Deadline hint', a.dueHint,'',1)}
      ${qs.map((q,i)=>`${editArea('questions.'+i+'.prompt','Question '+String(q.n||i+1).padStart(2,'0'), q.prompt,'',3)}`).join('')}
    `);
  }
  if (kind==='plan'){
    const rows = a.rows || [];
    if (!rows.length) return '';
    return editorWrap(kind, `<div class="tablewrap" tabindex="0" role="region" aria-label="Scrollable table"><table>
      <thead><tr><th>Outlet</th><th>Audience</th><th>Format</th><th>When</th><th>Cost</th><th>Who</th><th>Status</th></tr></thead>
      <tbody>${rows.map((r,i)=>`<tr>
        <td><input class="input" data-path="rows.${i}.outlet" value="${esc(r.outlet||'')}"></td>
        <td><input class="input" data-path="rows.${i}.audience" value="${esc(r.audience||'')}"></td>
        <td><input class="input" data-path="rows.${i}.format" value="${esc(r.format||'')}"></td>
        <td><input class="input" data-path="rows.${i}.when" value="${esc(r.when||'')}"></td>
        <td><input class="input" data-path="rows.${i}.cost" value="${esc(r.cost||'')}"></td>
        <td><input class="input" data-path="rows.${i}.who" value="${esc(r.who||'')}"></td>
        <td><input class="input" data-path="rows.${i}.status" value="${esc(r.status||'')}"></td>
      </tr>`).join('')}</tbody></table></div>`);
  }
  if (kind==='guide'){
    const qs = a.questions || [];
    const sc = a.scenarios || [];
    if (!qs.length && !sc.length) return '';
    return editorWrap(kind, `
      ${qs.map((q,i)=>`<div class="sub">Question ${q.n||i+1}</div>
        ${editArea('questions.'+i+'.stem','Stem', q.stem,'',2)}
        ${editArea('questions.'+i+'.approach','Approach', q.approach,'',2)}
        ${editArea('questions.'+i+'.results','Results', q.results,'',2)}
        ${editArea('questions.'+i+'.experience','Experience', q.experience,'',2)}`).join('')}
      ${sc.map((s,i)=>`<div class="sub">Scenario ${esc(s.id||String(i+1))}</div>
        ${editArea('scenarios.'+i+'.name','Name', s.name,'',1)}
        ${editArea('scenarios.'+i+'.mins','Minutes', s.mins,'',1)}
        ${editArea('scenarios.'+i+'.who','Who observes', s.who,'',1)}
        ${editArea('scenarios.'+i+'.brief','Brief', s.brief,'',4)}`).join('')}
    `);
  }
  if (kind==='contract'){
    const secs = a.sections || [];
    if (!secs.length && !a.title) return '';
    return editorWrap(kind, `
      ${editArea('title','Title', a.title,'',1)}
      ${secs.map((sec,i)=>`${editArea('sections.'+i+'.h','Heading', sec.h,'',1)}${editArea('sections.'+i+'.body','Body', sec.body,'',5)}`).join('')}
    `);
  }
  if (kind==='schedule'){
    const g = a.guide || {};
    return editorWrap(kind, `
      ${editArea('note','Consistency note', a.note,'',3)}
      ${editArea('guide.panel','Interview panel', g.panel,'',3)}
      ${editArea('guide.council','Governing body interview', g.council,'',3)}
      ${editArea('guide.staff','Staff meetings', g.staff,'',3)}
      ${editArea('guide.community','Community meetings', g.community,'',3)}
      ${editArea('guide.tour','Facility and community tour', g.tour,'',3)}
      ${editArea('guide.presentation','Presentation', g.presentation,'',3)}
      ${editArea('guide.exercises','Assessment exercises', g.exercises,'',3)}
      ${editArea('guide.sameCore','Same core experience', g.sameCore,'',3)}
    `);
  }
  return '';
}

function renderBrochure(a){
  const s = state.search || {};
  const theme = packThemeOf(a);
  const scheme = packSchemeOf(a);
  const photos = a.photos || {};
  const title = a.title || ((s.position||'Position')+': '+(s.client||'Search'));
  const facts = [
    packFact('Population', s.population),
    packFact('Form of government', s.fog),
    packFact('Budget', s.budget),
    packFact('Salary', s.salary),
    packFact('First review', s.firstReview)
  ].join('');
  const skills = packChips('skill');
  const traits = packChips('trait');
  const chall = packChips('chall');
  const opps = packChips('opp');
  return `<div class="pack__tools">
      <button class="btn btn--primary btn--sm" data-act="print-pack" data-kind="brochure">Print brochure</button>
      <button class="btn btn--secondary btn--sm" data-act="copy-post" data-src="brochure">Copy as text</button>
    </div>
    <article class="pack pack--brochure pack--${esc(theme)} pack--scheme-${esc(scheme)}" id="pack-brochure">
      <header class="pack__cover">
        ${packHero(photos.cover, theme)}
        <div class="pack__covertext">
          <div class="pack__brand">Slate · Executive search</div>
          <div class="pack__place">${esc(s.client||'The jurisdiction')}</div>
          <h3 class="pack__title">${esc(title)}</h3>
          ${a.lede ? `<p class="pack__deck">${esc(a.lede)}</p>` : ''}
          <div class="pack__meta">${[s.fog, s.state, s.salary].filter(Boolean).map(esc).join(' · ')}</div>
        </div>
      </header>
      ${facts ? `<div class="pack__facts">${facts}</div>` : ''}
      <div class="pack__body">
        <div class="pack__grid">
          ${packSec('The opportunity', a.theOpportunity)}
          ${packSec('About the community', a.thePlace, '', packPhoto(photos.place, s.client||'The community'))}
        </div>
        ${packSec('About the organization', a.theOrganization, '', packPhoto(photos.org, 'The organization'))}
        ${packSec('Leadership opportunity', a.leadershipOpportunity)}
        <div class="pack__grid">
          ${packSec('Current challenges', a.challenges, chall)}
          ${packSec('Future opportunities', a.opportunities, opps)}
        </div>
        ${skills || traits ? `<section class="pack__sec"><div class="pack__h">Desired candidate</div>
          ${a.ideal ? `<div class="pack__prose">${prose(a.ideal)}</div>` : ''}
          ${skills ? `<div class="pack__label">Essential skills</div>${skills}` : ''}
          ${traits ? `<div class="pack__label">Leadership traits</div>${traits}` : ''}
        </section>` : packSec('Desired candidate', a.ideal)}
        ${packSec('Position responsibilities', a.theJob)}
        ${packSec('Compensation and benefits', a.compensation)}
        ${packSec('Why consider this community', a.whyConsider)}
      </div>
      <footer class="pack__apply">
        <div class="pack__h">How to apply</div>
        ${a.howToApply ? `<div class="pack__prose">${prose(a.howToApply)}</div>` : '<p>See the advertisement for the application link and deadline.</p>'}
        ${s.firstReview ? `<div class="pack__due">First review ${esc(s.firstReview)}</div>` : ''}
      </footer>
    </article>`;
}

function photoSlot(slot, label, hint, photos){
  const src = photos[slot];
  return `<div class="photo-slot">
    <div class="photo-slot__frame">${src ? `<img src="${esc(src)}" alt="">` : '<span>No photo</span>'}</div>
    <div class="photo-slot__meta">
      <div class="photo-slot__label">${esc(label)}</div>
      <p class="t-small">${esc(hint)}</p>
      <div class="row">
        <label class="btn btn--secondary btn--sm">Add photo<input type="file" accept="image/*" data-photo="${slot}" class="photo-slot__file"></label>
        ${src ? `<button type="button" class="btn btn--ghost btn--sm" data-act="photo-del" data-slot="${slot}">Remove</button>` : ''}
      </div>
    </div>
  </div>`;
}

function brochureStudio(a){
  const photos = a.photos || {};
  return `<div class="studio">
    ${packStudioBar(a)}
    <div class="photo-tray">
      <div class="sub">Pictures</div>
      <p class="t-small">Add a cover photo, a community photo, and an organization photo. They print with the packet.</p>
      <div class="photo-tray__grid">
        ${photoSlot('cover','Cover','Wide landscape of the community or a landmark', photos)}
        ${photoSlot('place','Community','Main street, parks, or a neighborhood', photos)}
        ${photoSlot('org','Organization','Government offices, board chambers, or staff', photos)}
      </div>
    </div>
    ${renderBrochure(a)}
  </div>`;
}

function renderAds(a){
  const s = state.search || {};
  const brochure = s.artifacts?.brochure || {};
  const photos = brochure.photos || {};
  const theme = packThemeOf(brochure);
  const scheme = packSchemeOf(brochure);
  const facts = [
    packFact('Opens', a.openingDate),
    packFact('First review', a.firstReview || s.firstReview),
    packFact('Closes', a.closing),
    packFact('Salary', s.salary),
    packFact('Population', s.population),
    packFact('Form of government', s.fog)
  ].join('');
  const cards = ['full','short','social','association'].map(k => renderAdPack(k, a, {
    facts, photos, theme, scheme
  })).join('');
  return `<div class="pack__tools">
      <button class="btn btn--primary btn--sm" data-act="print-pack" data-kind="ads">Print ads</button>
    </div>
    <div class="adpacks" id="pack-ads">${cards}</div>`;
}

function renderAdPack(kind, a, ctx){
  const s = state.search || {};
  const ad = a[kind];
  if (!ad) return '';
  const meta = AD_KIND[kind];
  const n = String(ad.body||'').length;
  const over = kind==='social' && n > 500;
  const title = ad.headline || ((s.position||'Position')+': '+(s.client||'Search'));
  const theme = (kind !== 'full' && (ctx.theme==='photo' || ctx.theme==='split')) ? 'classic' : ctx.theme;
  const scheme = ctx.scheme || 'navy';
  const skills = kind==='full' ? packChips('skill') : '';
  const chall = kind==='full' ? packChips('chall') : '';
  return `<div class="adpack">
    <div class="pack__tools">
      <div>
        <div class="sub u-m-0">${esc(meta.tag)}</div>
        <p class="t-small">${esc(meta.use)}</p>
      </div>
      ${kind==='social' ? `<span class="ad__count${over?' ad__count--over':''}">${n} characters${over?' · over 500':''}</span>` : ''}
      <button class="btn btn--secondary btn--sm ad__copy" data-act="copy-post">Copy for posting</button>
    </div>
    <article class="pack pack--ad pack--ad-${kind} pack--${esc(theme)} pack--scheme-${esc(scheme)}" id="pack-ad-${kind}">
      <header class="pack__cover">
        ${kind==='full' ? packHero(ctx.photos.cover, theme, 'pack__hero--ad') : ''}
        <div class="pack__covertext">
          <div class="pack__brand">Slate · Recruitment advertisement</div>
          <div class="pack__place">${esc(s.client||'The jurisdiction')}${s.state ? ', '+esc(s.state) : ''}</div>
          <h3 class="pack__title">${esc(title)}</h3>
          <div class="pack__meta">${[meta.tag, s.fog, s.salary].filter(Boolean).map(esc).join(' · ')}</div>
        </div>
      </header>
      ${kind !== 'social' && ctx.facts ? `<div class="pack__facts">${ctx.facts}</div>` : ''}
      <div class="pack__body">
        ${ad.body ? `<div class="pack__prose">${prose(ad.body)}</div>` : ''}
        ${skills ? `<div class="pack__label">Essential skills</div>${skills}` : ''}
        ${chall ? `<div class="pack__label">Current challenges</div>${chall}` : ''}
      </div>
      <footer class="pack__apply">
        <div class="pack__h">How to apply</div>
        ${a.apply ? `<div class="pack__prose"><p>${esc(a.apply)}</p></div>` : '<p>See the search file for the application link.</p>'}
        ${a.contact ? `<p class="pack__due">${esc(a.contact)}</p>` : ''}
        ${(a.firstReview || s.firstReview) ? `<div class="pack__due">First review ${esc(a.firstReview || s.firstReview)}</div>` : ''}
      </footer>
    </article>
  </div>`;
}

function renderArtifact(key, a){
  if (!a) return '';
  if (key==='community') return `<div class="doc"><div class="doc__cover"><div class="doc__kicker">Community profile</div><h3 class="doc__title">${esc(state.search.client)}</h3></div>
    <div class="doc__body">
      ${a.lede ? `<p>${esc(a.lede)}</p>` : ''}
      ${(a.facts||[]).map(f=>`<div><div class="doc__h">${esc(f.k)}</div>${esc(f.v)}</div>`).join('')}
      ${sectionBlocks(a.government, govFields())}
      ${sectionBlocks(a.community, placeFields())}
      ${docBlock('The organization', a.organization)}
      ${docBlock('Why lead here', a.why)}
    </div></div>`;
  if (key==='brochure') return renderBrochure(a);
  if (key==='ads') return renderAds(a);
  if (key==='plan') return `<div class="tablewrap" tabindex="0" role="region" aria-label="Scrollable table"><table><thead><tr><th>Outlet</th><th>Audience</th><th>Format</th><th>When</th><th>Cost</th><th>Who</th><th>Status</th></tr></thead><tbody>
    ${(a.rows||[]).map(r=>`<tr><td>${esc(r.outlet)}</td><td>${esc(r.audience)}</td><td>${esc(r.format)}</td><td>${esc(r.when)}</td><td>${esc(r.cost)}</td><td>${esc(r.who||'')}</td><td>${esc(r.status||'')}</td></tr>`).join('')}
  </tbody></table></div>`;
  if (key==='survey1'||key==='survey2') return `<div class="stack">${(a.questions||[]).map(q=>`
    <div class="q"><div class="q__hd"><span class="q__n">${String(q.n).padStart(2,'0')}</span><span class="q__t">${esc(q.prompt)}</span></div>
    <div class="q__ft">${(q.crit||[]).map(id=>`<span class="chip">${esc(id)}</span>`).join('')}</div></div>`).join('')}</div>`;
  if (key==='guide') return `<div class="stack">
    ${(a.questions||[]).map(q=>`
    <div class="q"><div class="q__hd"><span class="q__n">${String(q.n).padStart(2,'0')}</span><span class="q__t">${esc(q.stem)}</span></div>
    <div class="q__bd">${['approach','results','experience'].map(k=>`<div class="are"><div class="t-label">${k}</div><div>${esc(q[k]||'')}</div></div>`).join('')}</div>
    <div class="q__ft">${(q.crit||[]).map(id=>`<span class="chip">${esc(id)}</span>`).join('')}</div></div>`).join('')}
    ${(a.scenarios||[]).length ? `<div class="sub">Assessment scenarios</div>${(a.scenarios||[]).map(sc => `
      <div class="q"><div class="q__hd"><span class="q__n">${esc(sc.id||'')}</span><span class="q__t">${esc(sc.name||'')}</span></div>
      <div class="q__bd"><div class="t-small">${esc(sc.mins||'')} min · ${esc(sc.who||'')}</div><p>${esc(sc.brief||'')}</p></div>
      <div class="q__ft">${(sc.crit||[]).map(id=>`<span class="chip">${esc(id)}</span>`).join('')}</div></div>`).join('')}` : ''}
  </div>`;
  if (key==='schedule') {
    const g = a.guide || {};
    return `<div class="stack">
      ${(g.panel||g.council||g.staff||g.community||g.tour||g.presentation||g.exercises||g.sameCore) ? `<div class="doc"><div class="doc__cover"><div class="doc__kicker">Assessment guide</div><h3 class="doc__title">Same core experience for every finalist</h3></div>
        <div class="doc__body">
          ${docBlock('Interview panel', g.panel)}
          ${docBlock('Governing body interview', g.council)}
          ${docBlock('Staff meetings', g.staff)}
          ${docBlock('Community meetings', g.community)}
          ${docBlock('Facility and community tour', g.tour)}
          ${docBlock('Presentation', g.presentation)}
          ${docBlock('Assessment exercises', g.exercises)}
          ${docBlock('Consistency', g.sameCore || a.note)}
        </div></div>` : (a.note ? `<p class="t-small">${esc(a.note)}</p>` : '')}
      ${(a.days||[]).map(d=>`
      <div class="spec"><div class="spec__bar">${esc(d.date)} · ${esc(d.title)}</div>
      <div class="tablewrap" tabindex="0" role="region" aria-label="Scrollable table"><table><tbody>${(d.blocks||[]).map(b=>`<tr><td class="mono">${esc(b.time)}</td><td>${esc(b.what)}</td><td>${esc(b.who)}</td></tr>`).join('')}</tbody></table></div></div>`).join('')}
    </div>`;
  }
  if (key==='contract') return `<div class="doc"><div class="doc__body">${(a.sections||[]).map(sec=>`<div><div class="doc__h">${esc(sec.h)}</div><p>${esc(sec.body)}</p></div>`).join('')}</div></div>`;
  if (key==='bar') {
    const cad = a.cadence || {};
    const list = (items, render) => (items||[]).map(render).join('') || '';
    return `<div class="stack">
      <div class="grid2">
        <div><div class="sub">Behavior</div>${list(a.behavior, x=>`<p><b>${esc(x.t)}</b> — ${esc(x.d||'')}</p>`)}</div>
        <div><div class="sub">Actions</div>${list(a.actions, x=>`<p><b>${esc(x.t)}</b>${x.due?' · '+esc(x.due):''}</p>`)}</div>
        <div><div class="sub">Results</div>${list(a.results, x=>`<p><b>${esc(x.t)}</b> · ${esc(x.target||'')}</p>`)}</div>
        <div><div class="sub">Governing body governance survey</div>${list(a.governance, x=>`<p>${esc(typeof x==='string'?x:(x.t||x.d||''))}</p>`)}</div>
      </div>
      ${(cad.beginning||cad.midyear||cad.annual) ? `<div class="spec"><div class="spec__bar">Annual cadence</div><div class="spec__body grid2">
        ${cad.beginning?`<div><div class="sub">Beginning of year</div><ul>${cad.beginning.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:''}
        ${cad.midyear?`<div><div class="sub">Mid-year review</div><ul>${cad.midyear.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:''}
        ${cad.annual?`<div><div class="sub">Annual evaluation</div><ul>${cad.annual.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:''}
      </div></div>` : ''}
    </div>`;
  }
  return '';
}

function safeHref(url){
  try {
    const u = new URL(String(url||''), location.href);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '#';
  } catch {
    return '#';
  }
}

function sourceList(research){
  const src = research?.sources || [];
  if (!src.length) return '';
  return `<div class="sources">
    <div class="sub">Sources used</div>
    <ul>${src.map(s => `<li><a href="${esc(safeHref(s.url))}" target="_blank" rel="noopener">${esc(s.title || s.url)}</a></li>`).join('')}</ul>
    ${research.at ? `<div class="t-small">Looked up ${(research.at||'').slice(0,10)}.</div>` : ''}
  </div>`;
}

function communityEmptyNotice(s){
  const cityReady = Boolean(String(s.client||'').trim() && String(s.website||'').trim());
  const factsReady = Boolean(s.population || s.budget || s.fog || s.state || s.salary);
  const body = (cityReady || factsReady)
    ? 'Jurisdiction, website, and the facts above are already on the file. Research writes this profile from public sources, or type it in the fields below.'
    : 'Enter the jurisdiction and website, then research. Population, budget, form of government, and this profile are filled from public sources.';
  return `<div class="notice notice--info"><div><div class="notice__t">The community profile is not written yet</div><div class="notice__b">${body}</div></div></div>`;
}

function vCommunity(){
  const s = state.search, meta = DRAFTS.community, has = Boolean(s.artifacts?.community);
  const profileDone = (s.steps||[]).find(st=>st.key==='profile')?.status==='done';
  return shell(`
    ${head('Step '+stepNo('community'), meta.title, meta.lede,
      `<button class="btn btn--primary" data-act="research" ${profileDone?'':'disabled'}>Research this ${jurisdictionInfo().noun}</button>
       <button class="btn btn--secondary" data-act="save-art" data-kind="community">Save edits</button>
       <button class="btn btn--primary" data-act="next-step" data-from="community">Next · Initial survey</button>`)}
    <div class="band"><div class="wrap stack">
      ${!profileDone ? `<div class="notice notice--info"><div><div class="notice__t">The profile comes first</div><div class="notice__b">Adopt the candidate profile (Step ${stepNo('profile')}) — 3 to 5 essential skills — then look up the jurisdiction.</div></div></div>` : ''}
      ${modelToggle()}
      <form id="citylookup" class="grid2">
        ${field(jurisdictionInfo().key==='county'?'County':'Jurisdiction','', `<input class="input" name="city" value="${esc(s.client||'')}" placeholder="${esc(jurisdictionInfo().clientPlaceholder)}">`)}
        ${field('Official website','http or https', `<input class="input" name="website" value="${esc(s.website||'')}" placeholder="https://www.fcgov.com">`)}
      </form>
      <p class="t-small">A research agent reads the official site, Census, and budget documents, then fills the facts on this search. It will not invent numbers. Check the file before you use it in recruiting.</p>
      ${sourceList(s.research)}
      ${(s.population || s.budget || s.fog || s.state || s.salary) ? `<div class="tiles">
        ${s.state?`<div class="tile"><span class="tile__k">State</span><span class="tile__v u-fs-115">${esc(s.state)}</span></div>`:''}
        ${s.fog?`<div class="tile"><span class="tile__k">Form of government</span><span class="tile__v u-fs-115">${esc(s.fog)}</span></div>`:''}
        ${s.population?`<div class="tile"><span class="tile__k">Population</span><span class="tile__v u-fs-115">${esc(s.population)}</span></div>`:''}
        ${s.budget?`<div class="tile"><span class="tile__k">Budget</span><span class="tile__v u-fs-115">${esc(s.budget)}</span></div>`:''}
        ${s.salary?`<div class="tile"><span class="tile__k">Salary</span><span class="tile__v u-fs-115">${esc(s.salary)}</span></div>`:''}
      </div><p class="t-small">Those facts are also on <button class="btn btn--ghost btn--sm" data-go="facts">Search facts</button>. Check them before you draft recruiting copy.</p>`:''}
      ${has ? renderArtifact('community', s.artifacts.community) : communityEmptyNotice(s)}
      ${artifactEditor('community', s.artifacts?.community)}
      ${stepNextCard('community')}
      ${sourceJson('community', s.artifacts?.community, true)}
      ${stepFooter('community')}
    </div></div>`);
}

function reviewOf(search, key){
  return (search?.reviews || {})[key] || null;
}

// Consultant sign-off on a Claude draft. The AI writes the first pass; nothing
// leaves the app as final until a consultant marks it reviewed. Any edit,
// redraft, or refill on the server clears the approval (server/index.js).
function takesReview(key){
  return (state.health?.reviewSteps || []).includes(key);
}

function reviewBar(key, has){
  if (!has || !takesReview(key)) return '';
  const r = reviewOf(state.search, key);
  const approved = r && r.status === 'approved';
  const status = approved
    ? pill('ok', 'Reviewed by '+r.byName+' on '+(r.at||'').slice(0,10))
    : pill('wait', 'Draft, not reviewed');
  return `<div class="reviewbar">
    ${status}
    <span class="t-small">${approved
      ? 'Edits, redrafts, or changes to source facts require another review.'
      : 'Read the draft against the research, edit what is off, then mark it reviewed before it goes out.'}</span>
    <button class="btn btn--${approved?'ghost':'primary'} btn--sm" data-act="review" data-kind="${esc(key)}" data-approve="${approved?'0':'1'}">
      ${approved ? 'Send back to draft' : 'Mark reviewed'}
    </button>
  </div>`;
}

function vBrochure(){
  const s = state.search, meta = DRAFTS.brochure;
  const a = s.artifacts?.brochure;
  const has = brochureHasCopy(a);
  const hasComm = Boolean(s.artifacts?.community);
  return shell(`
    ${head('Step '+stepNo('brochure'), meta.title, meta.lede,
      `${hasComm ? `<button class="btn btn--primary" data-act="assemble" data-kind="brochure">${has?'Refill from community':'Fill from community'}</button>` : ''}
       ${a ? `<button class="btn btn--secondary" data-act="save-art" data-kind="brochure">Save edits</button>` : ''}
       ${has ? `<button class="btn btn--secondary" data-act="print-pack" data-kind="brochure">Print brochure</button>` : ''}
       ${has ? `<button class="btn btn--ghost" data-act="generate" data-kind="brochure">Tighten with Claude</button>` : ''}
       ${nextBtn('brochure')}`)}
    <div class="band"><div class="wrap stack">
      ${!hasComm ? `<div class="notice notice--info"><div><div class="notice__t">The community file and the ad plan come first</div><div class="notice__b">The community research (Step ${stepNo('community')}) is what this packet is built from. Finish the ad plan (Step ${stepNo('plan')}), then come back. You will add pictures here, not write a second narrative.</div></div></div>` : ''}
      ${hasComm && !has ? `<div class="notice notice--info"><div><div class="notice__t">Fill from the community file</div><div class="notice__b">This step lays out the research you already have, then lets you add photos and change the design. Claude is optional after that.</div></div></div>` : ''}
      ${reviewBar('brochure', has)}
      ${a ? brochureStudio(a) : ''}
      ${a ? artifactEditor('brochure', a) : ''}
      ${sourceJson('brochure', a, Boolean(a))}
      ${stepFooter('brochure')}
    </div></div>`);
}

function vDraft(key){
  const s = state.search, meta = DRAFTS[key], has = Boolean(s.artifacts?.[key]);
  const editor = artifactEditor(key, s.artifacts?.[key]);
  return shell(`
    ${head('Step '+stepNo(key), meta.title, meta.lede,
      `<button class="btn btn--primary" data-act="generate" data-kind="${key}">${has?'Redraft':'Draft with Claude'}</button>
       <button class="btn btn--secondary" data-act="save-art" data-kind="${key}">Save edits</button>
       ${(key==='brochure'||key==='ads') && has ? `<button class="btn btn--secondary" data-act="print-pack" data-kind="${key}">Print for posting</button>` : ''}
       ${nextBtn(key)}`)}
    <div class="band"><div class="wrap stack">
      ${reviewBar(key, has)}
      ${key==='ads' && stepOf('brochure') ? packStudioBar(s.artifacts?.brochure || {}) : ''}
      ${key==='contract' ? modelToggle() : ''}
      ${has ? renderArtifact(key, s.artifacts[key]) : `<div class="notice notice--info"><div><div class="notice__t">Nothing on file yet</div><div class="notice__b">${
        key==='ads' ? (stepOf('brochure')
          ? 'Draft with Claude from the brochure and the profile. Color and layout come from the brochure, so the ads stay a matched packet.'
          : 'Draft with Claude from the ad plan and the profile. The '+esc(packageLabel(s.package))+' package has no brochure; this announcement is what gets posted.')
        : key==='contract' ? 'Draft with Claude from the profile, then edit the copy in the fields below. Opus 5 often does better on this legal language, since it goes to counsel.'
        : 'Draft with Claude from the profile, then edit the copy in the fields below.'
      }</div></div></div>`}
      ${editor}
      ${sourceJson(key, s.artifacts?.[key], Boolean(editor))}
      ${stepFooter(key)}
    </div></div>`);
}

function stagePill(stage){
  const k = stage==='finalist'?'ok':stage==='declined'?'stop':stage==='semifinalist'?'wait':'info';
  return pill(k, stage);
}

function answerOf(answers, q){
  if (!answers) return '';
  return answers['q'+q.n] || answers[q.n] || answers[String(q.n)] || '';
}

function surveyRead(survey, submitted){
  if (!submitted) return '<div class="t-small">No response on file.</div>';
  survey = submitted.survey || survey;
  const answers = submitted.answers || {};
  if (!survey) return `<pre class="t-small">${esc(JSON.stringify(answers, null, 2))}</pre>`;
  return `<div class="stack">${submitted.legacySnapshot ? '<p class="notice">This response predates questionnaire history. The original wording cannot be verified.</p>' : ''}${(survey.questions||[]).map(q => `
    <div class="q">
      <div class="q__hd"><span class="q__n">${String(q.n).padStart(2,'0')}</span><span class="q__t">${esc(q.prompt)}</span></div>
      <div class="q__bd">${esc(answerOf(answers, q))}</div>
      <div class="q__ft">${(q.crit||[]).map(id=>`<span class="chip">${esc(id)}</span>`).join('')}</div>
    </div>`).join('')}</div>`;
}

function vScreen(){
  const s = state.search, origin = location.origin;
  const rows = (s.candidates||[]).map(c => `
    <tr>
      <td><button class="btn btn--ghost btn--sm" data-cand="${c.id}">${esc(c.name)}</button></td>
      <td>${esc(c.cur||'')}</td>
      <td>${esc(c.org||'')}</td>
      <td>${stagePill(c.stage)}</td>
      <td>${c.survey1?'In':'—'}</td>
      <td class="mono t-small">${canEdit() ? origin+'/apply/'+c.invite : ''}</td>
      <td>${canEdit() && c.stage==='applicant'
        ? `<button class="btn btn--secondary btn--sm" data-act="advance-semi" data-cid="${c.id}">Advance to semifinalist</button>`
        : ''}</td>
    </tr>`).join('');
  return shell(`
    ${head('Step '+stepNo('screen'),'Screen candidate surveys',
      canEdit()
        ? 'Review the resume and the initial survey against the adopted profile. Score each person. Advance the ones you want as semifinalists, then release scores.'
        : 'Score each candidate against the profile the committee adopted. Your scores stay private until the account manager releases them.',
      canEdit()
        ? `<button class="btn btn--primary" type="submit" form="newcand">Add candidate</button>
           <button class="btn btn--secondary" data-act="toggle-release">${s.released?'Seal scores':'Release scores'}</button>
           ${nextBtn('screen')}`
        : nextBtn('screen'))}
    <div class="band"><div class="wrap stack">
      ${canEdit() && s.invitesRotatedAt ? '<div class="notice notice--info">Candidate links were replaced during the privacy update. Share the current links below; links issued before the update no longer work.</div>' : ''}
      ${!s.candidates?.length ? `<div class="notice notice--info"><div><div class="notice__t">${canEdit()?'Phase 2 starts here':'No candidates yet'}</div><div class="notice__b">${canEdit()?'Add people when applications come in. Copy the applicant link from the table. Later steps wait until someone is on the file.':'You will be asked to score applicants here once they apply.'}</div></div></div>` : ''}
      ${canEdit() ? `<form id="newcand" class="grid2">
        ${field('Name','', `<input class="input" name="name" placeholder="Full name" required>`)}
        ${field('Current title','', `<input class="input" name="cur">`)}
        ${field('Organization','', `<input class="input" name="org">`)}
        ${field('Email','', `<input class="input" name="email" type="email">`)}
      </form>` : ''}
      <div class="tablewrap" tabindex="0" role="region" aria-label="Scrollable table"><table>
        <thead><tr><th>Candidate</th><th>Title</th><th>Organization</th><th>Stage</th><th>Survey 1</th><th>${canEdit()?'Applicant link':''}</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7">No candidates yet.</td></tr>`}</tbody>
      </table></div>
      ${stepFooter('screen')}
    </div></div>`);
}

function vSend2(){
  const s = state.search;
  const list = (s.candidates||[]).filter(c => c.stage==='semifinalist' || c.stage==='finalist');
  const rows = list.map(c => `
    <tr>
      <td>${esc(c.name)}</td>
      <td>${stagePill(c.stage)}</td>
      <td>${c.survey2SentAt ? 'Opened '+(c.survey2SentAt||'').slice(0,10) : 'Not opened'}</td>
      <td>${esc(c.survey2Deadline||'—')}</td>
      <td>${c.survey2?'In':'Waiting'}</td>
      <td>${canEdit() && !c.survey2
        ? `<button class="btn btn--secondary btn--sm" data-act="send2-one" data-cid="${c.id}">${c.survey2SentAt?'Already open':'Open questionnaire'}</button>`
        : ''}</td>
    </tr>`).join('');
  return shell(`
    ${head('Step '+stepNo('send2'),'Open semifinalist questionnaire','Open the questionnaire after naming semifinalists. Then contact each candidate yourself and share their existing applicant link. Opening it does not send an email.',
      (canEdit() ? `<button class="btn btn--primary" data-act="send2-all">Open for all semifinalists</button>` : '')+' '+nextBtn('send2'))}
    <div class="band"><div class="wrap stack">
      ${!s.artifacts?.survey2 ? `<div class="notice notice--info"><div><div class="notice__t">Survey not drafted yet</div><div class="notice__b">Finish the semifinalist survey (Step ${stepNo('survey2')}), then send it from this page.</div></div></div>` : ''}
      ${field('Deadline','Requested response date, shown to candidates. Late responses are accepted.', `<input class="input" id="send2-deadline" placeholder="Respond by 12 Sep 2026">`)}
      <div class="tablewrap" tabindex="0" role="region" aria-label="Scrollable table"><table>
        <thead><tr><th>Semifinalist</th><th>Stage</th><th>Opened</th><th>Deadline</th><th>Response</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6">No semifinalists yet. Advance people from Screening.</td></tr>`}</tbody>
      </table></div>
      ${stepFooter('send2')}
    </div></div>`);
}

function vFinalists(){
  const s = state.search;
  const list = (s.candidates||[]).filter(c => c.stage==='semifinalist' || c.stage==='finalist');
  const survey = s.artifacts?.survey2;
  const cards = list.map(c => `
    <div class="spec">
      <div class="spec__bar">${esc(c.name)} · ${esc(c.stage)}${c.survey2?' · survey in':''}</div>
      <div class="spec__body stack">
        ${surveyRead(survey, c.survey2)}
        ${canEdit() && c.stage==='semifinalist'
          ? `<div class="row"><button class="btn btn--primary" data-act="advance-final" data-cid="${c.id}">Advance to finalist</button></div>`
          : ''}
      </div>
    </div>`).join('');
  return shell(`
    ${head('Step '+stepNo('finalists'),'Select finalists','Read the semifinalist responses against the adopted profile. Do not introduce new criteria here.',
      `<button class="btn btn--secondary" data-go="screen">Back to screening</button>
       ${nextBtn('finalists')}`)}
    <div class="band"><div class="wrap stack">
      ${cards || `<div class="empty"><div class="empty__t">No semifinalists yet</div>Screen and advance people, then send the second survey.</div>`}
      ${stepFooter('finalists')}
    </div></div>`);
}

function vPerson(){
  const s = state.search;
  const c = (s.candidates||[]).find(x=>x.id===state.sel);
  if (!c) return vScreen();
  const mine = ((s.scores||{})[state.user.id]||{})[c.id] || {};
  const note = (((s.notesBy||{})[state.user.id]||{})[c.id]) || '';
  const sealed = !s.released;
  const others = Object.entries(s.scores||{})
    .filter(([uid]) => uid !== state.user.id)
    .map(([uid, byCand]) => {
      const u = (state.users||[]).find(x=>x.id===uid);
      return { name: u?.name || uid, scores: byCand[c.id] || {} };
    })
    .filter(row => Object.keys(row.scores).length);
  const nextStage = c.stage==='applicant' ? 'semifinalist' : c.stage==='semifinalist' ? 'finalist' : '';
  const nextLabel = nextStage==='semifinalist' ? 'Advance to semifinalist' : nextStage==='finalist' ? 'Advance to finalist' : '';
  return shell(`
    ${head(c.id, c.name, `${esc(c.cur||'')}, ${esc(c.org||'')}`,
      `<button class="btn btn--secondary" data-go="screen">Back to screening</button>
       ${canEdit() && nextStage ? `<button class="btn btn--primary" data-act="advance" data-stage="${nextStage}">${nextLabel}</button>` : ''}`)}
    <div class="band"><div class="wrap stack">
      ${sealed?`<div class="seal">${ico('lock')}<div><div class="empty__t">Other scores are sealed</div><div class="t-small">Enter your scores. You will see the rest of the panel after scores are released.</div></div></div>`:''}
      ${(s.criteria||[]).map(cr => `
        <div class="crit-row u-cols-score">
          <span class="mono t-small">${esc(cr.id)}</span>
          <div><b>${esc(cr.label)}</b><div class="t-small">${esc(cr.note||'')}</div></div>
          <div class="wgt">${[1,2,3,4,5].map(n=>`<button type="button" data-score="${esc(cr.id)}" data-val="${n}" aria-pressed="${Number(mine[cr.id])===n}">${n}</button>`).join('')}</div>
        </div>`).join('')}
      ${!sealed && others.length ? `<div class="spec"><div class="spec__bar">Released panel scores</div><div class="spec__body">${others.map(row => `<div class="t-small"><b>${esc(row.name)}</b> — ${Object.entries(row.scores).map(([id,n])=>esc(id)+': '+esc(n)).join(', ')}</div>`).join('')}</div></div>`:''}
      ${field('Note to the file','', `<textarea class="input ed" id="cnote">${esc(note)}</textarea>`)}
      <button class="btn btn--primary" data-act="save-score">Save my scores</button>
      ${canEdit() ? `<div class="row"><button class="btn btn--secondary" data-act="replace-invite" data-cid="${c.id}">Replace candidate link</button>${['survey1','survey2'].filter(k=>c[k]).map(k=>`<button class="btn btn--secondary" data-act="reopen-survey" data-cid="${c.id}" data-which="${k}">Reopen ${k==='survey1'?'initial':'semifinalist'} questionnaire</button>`).join('')}</div><p class="t-small">Current candidate link: ${esc(location.origin+'/apply/'+c.invite)}</p>` : ''}
      ${c.survey1 ? `<div class="sub">Initial survey</div>${surveyRead(s.artifacts?.survey1, c.survey1)}` : ''}
    </div></div>`);
}

function pickApplySurvey(a){
  if (a.survey1 && !a.submitted1) return 'survey1';
  if (a.survey2 && !a.submitted2) return 'survey2';
  if (a.submitted1 || a.submitted2) return 'done';
  return 'none';
}


/**
 * What a candidate needs when something goes wrong.
 *
 * The server has supplied these since DEP-06 and DEP-08; until DEP-12 nothing
 * rendered them, so a candidate who needed an accommodation had nowhere to go
 * and a candidate who had submitted saw no proof of it.
 */
function applySupport(a){
  const s = a.support || {};
  const bits = [];
  if (s.email) bits.push('<a href="mailto:' + esc(s.email) + '">' + esc(s.email) + '</a>');
  if (s.phone) bits.push(esc(s.phone));
  const contact = s.configured
    ? bits.join(' · ') + (s.hours ? '<div class="t-small">' + esc(s.hours) + '</div>' : '')
    : '<span class="t-small">A contact for this search has not been published yet.</span>';

  return '<div class="apply-help u-mt-5">'
    + '<div class="t-label">Need help or an accommodation?</div>'
    + '<p class="t-small">' + contact + '</p>'
    + (a.correctionNote ? '<p class="t-small">' + esc(a.correctionNote) + '</p>' : '')
    + (a.privacyNoticeConfigured && a.privacyNotice
        ? '<p class="t-small">' + esc(a.privacyNotice) + '</p>'
        : '<p class="t-small">A privacy notice for this search has not been published yet.</p>')
    + '</div>';
}

/** Proof of what was received, shown whenever a questionnaire is submitted. */
function applyReceipt(a){
  const list = Object.values(a.receipts || {});
  if (!list.length) return '';
  return '<div class="notice notice--ok"><div><div class="notice__t">Received</div>'
    + list.map(r => '<div class="t-small">' + esc(r.questionnaire) + ' · reference '
        + esc(r.id) + ' · ' + esc((r.submittedAt || '').slice(0, 16).replace('T', ' ')) + '</div>').join('')
    + '</div></div>';
}

function vApply(){
  const a = state.apply;
  if (!a) return `<div class="apply-shell"><h1 class="t-title">This link is not valid</h1><p class="lede">Ask the search team for a new invitation.</p></div>`;
  const which = pickApplySurvey(a);
  if (which === 'none') return `<div class="apply-shell">${head(a.client,'The survey is not open yet','The search team has not published a questionnaire yet.')}${applySupport(a)}</div>`;
  if (which === 'done') return `<div class="apply-shell">${head(a.client,'Received','Thank you. Your responses are on the search file.')}${applyReceipt(a)}<div class="notice notice--ok"><div><div class="notice__t">You can close this page.</div></div></div>${applySupport(a)}</div>`;
  const survey = a[which];
  const title = which === 'survey2' ? 'Semifinalist questionnaire' : 'Initial candidate survey';
  const due = which === 'survey2' && a.deadline2 ? ` Respond by ${esc(a.deadline2)}.` : '';
  return `<div class="apply-shell">
    ${head(a.client, title, esc(survey.intro||'')+due)}
    <form id="applyform" class="stack u-mt-5" data-which="${which}">
      ${(survey.questions||[]).map(q => `
        <div class="q">
          <div class="q__hd"><span class="q__n" aria-hidden="true">${String(q.n).padStart(2,'0')}</span><span class="q__t" id="q${q.n}-label">${esc(q.prompt)}${q.required?' <span class="req" aria-hidden="true">*</span>':''}</span></div>
          <div class="q__bd"><textarea class="input ed" name="q${q.n}" id="q${q.n}-input" aria-labelledby="q${q.n}-label" ${q.required?'required aria-required="true"':''}></textarea></div>
        </div>`).join('')}
      <button class="btn btn--primary" type="submit">Submit questionnaire</button>
    </form>
    ${a.deadlines && a.deadlines.note ? `<p class="t-small u-mt-3">${esc(a.deadlines.note)} (${esc(a.deadlines.timezone||'')})</p>` : ''}
    ${applySupport(a)}
  </div>`;
}

/* ===========================================================================
 * Staff steps: sourcing, video interviews, reference checks
 * ========================================================================= */

function staffCandidates(key){
  const s = state.search;
  const stages = { video:['semifinalist','finalist'], references:['finalist'] }[key];
  if (!stages) return null;
  return (s.candidates||[]).filter(c => stages.includes(c.stage));
}

function staffLogEntry(key, e){
  return `<div class="feed__i">
    <span class="feed__w">${esc(e.byName||'')}${e.candidateName?' · '+esc(e.candidateName):''}</span>
    <span class="feed__x">${esc(e.text)}</span>
    <span class="feed__t">${esc((e.at||'').slice(0,10))}${canEdit()?` <button class="btn btn--ghost btn--sm" data-act="staff-log-del" data-key="${key}" data-lid="${e.id}" title="Remove entry">Remove</button>`:''}</span>
  </div>`;
}

function vStaff(key){
  const s = state.search, meta = STAFF[key];
  const st = stepOf(key) || {};
  const rec = (s.staff||{})[key] || { notes:'', log:[], doneAt:null };
  const cands = staffCandidates(key);
  const done = Boolean(rec.doneAt);
  const consentRows = key==='references' && cands ? cands.map(c => `
    <tr>
      <td>${esc(c.name)}</td>
      <td>${stagePill(c.stage)}</td>
      <td>${c.referenceConsentAt ? pill('ok','Consent on file')+' <span class="t-small">'+esc((c.referenceConsentAt||'').slice(0,10))+(c.referenceConsentBy?' · '+esc(c.referenceConsentBy):'')+'</span>' : pill('wait','No consent yet')}</td>
      <td>${canEdit() ? `<button class="btn btn--${c.referenceConsentAt?'ghost':'secondary'} btn--sm" data-act="ref-consent" data-cid="${c.id}" data-on="${c.referenceConsentAt?'0':'1'}">${c.referenceConsentAt?'Withdraw':'Record consent'}</button>` : ''}</td>
    </tr>`).join('') : '';
  const logged = (rec.log||[]).length;
  return shell(`
    ${head('Step '+stepNo(key), meta.title, meta.lede+' '+pill(done?'ok':logged?'wait':'idle', done?'Complete':logged?logged+' logged':'Not started')+' '+pill('info','Staff work'),
      `${canEdit() ? `<button class="btn btn--${done?'secondary':'primary'}" data-act="staff-done" data-key="${key}" data-done="${done?'0':'1'}">${done?'Reopen':'Mark complete'}</button>` : ''}
       ${nextBtn(key)}`)}
    <div class="band"><div class="wrap stack">
      ${st.blocked ? `<div class="notice notice--info"><div><div class="notice__t">${esc(stepWaitCopy(st, s))}</div><div class="notice__b">You can still log work here; the step reads as waiting until what it depends on is done.</div></div></div>` : ''}
      ${done ? `<div class="notice notice--ok"><div><div class="notice__t">Completed ${esc((rec.doneAt||'').slice(0,10))} by ${esc(rec.doneByName||'a consultant')}</div><div class="notice__b">Logging anything new reopens the step.</div></div></div>` : ''}
      ${key==='references' ? `<div class="spec"><div class="spec__bar">Consent to contact references</div>
        <div class="spec__body">
          <p class="t-small u-mb-3">Nothing is logged for a finalist until their consent is on this table. If nobody is listed, name finalists first (Step ${stepNo('finalists')}).</p>
          <div class="tablewrap" tabindex="0" role="region" aria-label="Scrollable table"><table>
            <thead><tr><th>Finalist</th><th>Stage</th><th>Consent</th><th></th></tr></thead>
            <tbody>${consentRows || `<tr><td colspan="4">No finalists yet.</td></tr>`}</tbody>
          </table></div>
        </div></div>` : ''}
      ${canEdit() ? `<div class="spec"><div class="spec__bar">Log an entry</div>
        <div class="spec__body stack">
          ${cands ? field('About','', `<select class="input" id="staff-cid">
              <option value="">${key==='references'?'Choose a finalist':'Choose a semifinalist'}</option>
              ${cands.map(c => `<option value="${c.id}" ${key==='references'&&!c.referenceConsentAt?'disabled':''}>${esc(c.name)}${key==='references'&&!c.referenceConsentAt?' (no consent)':''}</option>`).join('')}
            </select>`) : ''}
          ${field(meta.ask, meta.hint, `<textarea class="input ed" id="staff-text" placeholder="${esc(key==='sourcing'?'Called J. Rivera, ACM in Larimer County. Interested; sending the brochure.':key==='video'?'45 minutes. Strong on S1 financial management, thin on C2 utility capital.':'Spoke with former mayor. Confirms budget turnaround; would hire again.')}"></textarea>`)}
          <div class="row"><button class="btn btn--primary" data-act="staff-log" data-key="${key}">Add to the log</button></div>
        </div></div>` : ''}
      <div class="spec"><div class="spec__bar">Work log${logged?' · '+logged:''}</div>
        <div class="spec__body"><div class="feed">${(rec.log||[]).map(e => staffLogEntry(key, e)).join('') || '<div class="t-small">Nothing logged yet.</div>'}</div></div>
      </div>
      ${canEdit() ? `<div class="spec"><div class="spec__bar">Working notes</div>
        <div class="spec__body stack">
          <textarea class="input ed" id="staff-notes" placeholder="Running notes for this step. Not published; not shown to the committee.">${esc(rec.notes||'')}</textarea>
          <div class="row"><button class="btn btn--secondary" data-act="staff-notes" data-key="${key}">Save notes</button></div>
        </div></div>` : ''}
      <p class="t-small">${esc(meta.doneWhen)}</p>
      ${stepFooter(key)}
    </div></div>`);
}

function vArchives(){
  return shell(`${head('Workspace','Archived searches','Restore a search with its documents, responses, and history.')}
    <div class="band"><div class="wrap stack">${(state.archives || []).map(s => `<div class="spec"><div class="spec__body"><b>${esc(s.client)}</b> · ${esc(s.position)}<p class="t-small">Archived ${esc(s.archivedAt)}</p><button class="btn btn--secondary" data-act="restore-search" data-id="${esc(s.id)}">Restore search</button></div></div>`).join('') || '<p>No archived searches.</p>'}</div></div>`);
}

function vHistory(){
  const entries = (state.history?.history || []).map((entry, index) => ({ ...entry, index })).reverse();
  return shell(`${head('This search','History and recovery','Previous copy and evaluations stay on file. Restoring a profile requires new scores.')}
    <div class="band"><div class="wrap stack">${entries.map(e => `<details class="spec"><summary class="spec__bar">${esc(e.key || e.kind)} · ${esc(e.at)} · ${esc(e.who)}</summary><div class="spec__body">
      ${e.criteria ? `<p>Profile revision ${esc(e.revision)}</p><ul>${e.criteria.map(c => `<li>${esc(c.id)}: ${esc(c.label)} (weight ${esc(c.weight)})</li>`).join('')}</ul>` : ''}
      ${historyRecord(e)}
      ${['artifact','profile','facts'].includes(e.kind) ? `<button class="btn btn--secondary" data-act="restore-history" data-index="${e.index}">Restore this ${e.kind==='artifact'?'copy':e.kind}</button>` : ''}
    </div></details>`).join('') || '<p>No previous revisions yet.</p>'}
    <details class="spec"><summary class="spec__bar">Activity record</summary><div class="spec__body">${(state.history?.activity || []).map(e=>`<p>${esc(e.at)} · ${esc(e.who)}: ${esc(e.x)}</p>`).join('')}</div></details>
    </div></div>`);
}

function historyRecord(entry){
  if (entry.kind === 'response') return `<p>${esc(entry.candidateName)} · ${esc(entry.reason)}</p>` + surveyRead(entry.body.survey, entry.body);
  if (entry.kind === 'scores' || entry.kind === 'profile') {
    return Object.entries(entry.scores || {}).map(([uid, byCandidate]) => {
      const name = state.users.find(u => u.id === uid)?.name || 'Former reviewer';
      return Object.entries(byCandidate).map(([cid, scores]) => {
        const candidate = (entry.candidates || state.search.candidates).find(c => c.id === cid)?.name || 'Former candidate';
        return `<p><b>${esc(name)} · ${esc(candidate)}</b></p><ul>${Object.entries(scores).map(([id, n]) => `<li>${esc(entry.criteria?.find(c=>c.id===id)?.label || id)}: ${esc(n)}</li>`).join('')}</ul><p>${esc(entry.notesBy?.[uid]?.[cid] || '')}</p>`;
      }).join('');
    }).join('') || '<p>No scores recorded for this version.</p>';
  }
  const display = value => {
    if (value == null) return '';
    if (Array.isArray(value)) return '<ul>' + value.map(v=>'<li>'+display(v)+'</li>').join('') + '</ul>';
    if (typeof value === 'object') return '<dl>' + Object.entries(value).map(([k,v])=>'<dt><b>'+esc(k.replace(/([a-z])([A-Z])/g,'$1 $2'))+'</b></dt><dd>'+display(v)+'</dd>').join('') + '</dl>';
    return `<span class="u-wrap-any">${esc(value)}</span>`;
  };
  return display(entry.body);
}

function page(){
  if (location.pathname.startsWith('/apply/')) return vApply();
  if (!state.user) return state.view === 'login' ? vLogin() : vGate();
  if (state.view === 'community') return vCommunity();
  if (state.view === 'brochure') return vBrochure();
  if (STAFF[state.view]) return vStaff(state.view);
  if (DRAFTS[state.view]) return vDraft(state.view);
  switch (state.view){
    case 'home': return vHome();
    case 'archives': return vArchives();
    case 'history': return vHistory();
    case 'new': return vNew();
    case 'packages': return vPackages();
    case 'overview': return vOverview();
    case 'facts': return vFacts();
    case 'team': return vTeam();
    case 'intake':
    case 'intake-mine': return vIntake();
    case 'profile': return vProfile();
    case 'screen':
    case 'people': return vScreen();
    case 'send2': return vSend2();
    case 'finalists': return vFinalists();
    case 'person': return vPerson();
    default: return vHome();
  }
}

function render(){
  const root = $('#app');
  if (!root) return;
  root.innerHTML = page();
  applyDynamicStyles(root);
  crumbs();
  const theme = document.documentElement.getAttribute('data-theme') || 'auto';
  $$('[data-theme]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.theme === theme)));
}

function collectCriteria(){
  $$('.crit-row[data-row]').forEach(row => {
    const i = Number(row.dataset.row);
    const c = state.search.criteria[i];
    if (!c) return;
    const label = $('[data-f="label"]', row);
    const note = $('[data-f="note"]', row);
    if (label) c.label = label.value;
    if (note) c.note = note.value;
  });
  return state.search.criteria;
}

async function withBusy(fn, wait){
  state.busy = true;
  let success = false;
  $('.shell')?.classList.add('busy');
  if (wait !== false) showWait(wait || waitSave());
  try { await fn(); success = true; state.dirty = false; }
  catch (err) { toast(err.message); }
  finally {
    hideWait();
    state.busy = false;
    $('.shell')?.classList.remove('busy');
    if (success) render();
  }
}

function artHasContent(body){
  if (body == null) return false;
  if (typeof body !== 'object') return String(body).trim().length > 0;
  return Object.keys(body).length > 0;
}

async function persistProfile(moveOn){
  const criteria = collectCriteria();
  const skills = labeledKind('skill', criteria);
  if (skills.length < 3 || skills.length > 5){
    toast('Select 3 to 5 essential skills.');
    return false;
  }
  if (moveOn){
    const gaps = profileGaps(criteria);
    if (gaps.length){
      toast('Finish the profile first: '+gaps.join(', ')+'.');
      return false;
    }
  }
  await withBusy(async () => {
    state.search = await api('/api/searches/'+state.search.id+'/profile', { method:'PUT', body:{ criteria } });
    if (moveOn){
      const next = nextOf('profile');
      const dest = next?.key || 'overview';
      toast(dest === 'community'
        ? 'Profile saved. On to the community profile.'
        : (next?.title ? 'Profile saved. On to '+next.title+'.' : 'Profile saved.'));
      go(dest);
    } else {
      toast('Profile saved. Later steps can now inherit it.');
    }
  }, waitSave(moveOn ? 'Saving and moving on' : 'Saving the profile'));
  return true;
}

document.addEventListener('change', e => {
  if (e.target.matches('[data-jurisdiction]')) { updateJurisdictionFields(e.target.form); return; }
  if (e.target.dataset.pickSearch){
    const id = e.target.dataset.pickSearch;
    const on = e.target.checked;
    const next = new Set(pickedIds());
    if (on) next.add(id); else next.delete(id);
    state.picked = [...next];
    if (state.view === 'home') render();
    return;
  }
  if (e.target.id === 'premium') state.premium = e.target.checked;
  if (e.target.dataset.photo) uploadBrochurePhoto(e.target.dataset.photo, e.target.files?.[0]);
});

document.addEventListener('click', async e => {
  const hit = e.target.closest('.pkgmx tbody td, .pkgmx tfoot td');
  if (hit) {
    const radio = hit.closest('.pkgmx')?.querySelector(`thead th:nth-child(${hit.cellIndex + 1}) input[name="package"]`);
    if (radio) radio.checked = true;
  }
  const t = e.target.closest('[data-go],[data-open],[data-act],[data-add],[data-del],[data-w],[data-theme],[data-cand],[data-score],[data-pick],[data-ipick],[data-iadd],[data-idel],[data-iw]');
  if (!t) return;

  if (t.dataset.theme){
    const v = t.dataset.theme;
    if (v==='auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', v);
    $$('[data-theme]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.theme===v)));
    return;
  }
  if (t.dataset.go){
    if (t.dataset.pkg) state.showcasePkg = t.dataset.pkg;
    if (t.dataset.go==='home'){ await go('home'); return; }
    await go(t.dataset.go); return;
  }
  if (t.dataset.open){
    if (state.dirty && !confirm('Leave this page and discard unsaved edits?')) return;
    state.dirty = false;
    const id = t.dataset.open;
    await withBusy(async () => {
      await loadSearch(id);
    }, waitSave('Opening the search'));
    if (state.search && state.search.id === id) go('overview');
    return;
  }
  if (t.dataset.cand){
    await go('person', { sel:t.dataset.cand }); return;
  }
  if (t.dataset.pick){
    state.dirty = true;
    collectCriteria();
    const kind = t.dataset.pick;
    const label = t.dataset.label;
    const i = state.search.criteria.findIndex(c => c.kind===kind && String(c.label||'').trim().toLowerCase()===label.toLowerCase());
    if (i >= 0){
      state.search.criteria.splice(i, 1);
    } else {
      if (kindTotal(kind) >= 5){
        toast('Select 3 to 5. Remove one before adding another.');
        return;
      }
      // A chip lifted straight off the consensus carries the committee's own
      // average weight, so picking it does not silently reset them to 3.
      const weight = Number(t.dataset.weight) || 3;
      state.search.criteria.push({ id: nextCritId(kind), kind, label, weight, note:'', from: t.dataset.weight ? 'committee' : 'consultant' });
    }
    render(); return;
  }
  if (t.dataset.add){
    state.dirty = true;
    collectCriteria();
    const kind = t.dataset.add;
    if (kindTotal(kind) >= 5){
      toast('Select 3 to 5. Remove one before adding another.');
      return;
    }
    state.search.criteria.push({ id: nextCritId(kind), kind, label:'', weight:3, note:'' });
    render(); return;
  }
  if (t.dataset.del){
    state.dirty = true;
    collectCriteria();
    state.search.criteria.splice(Number(t.dataset.del), 1);
    render(); return;
  }
  if (t.dataset.w){
    state.dirty = true;
    const row = t.closest('[data-row]');
    if (row){
      collectCriteria();
      state.search.criteria[Number(row.dataset.row)].weight = Number(t.dataset.w);
      render();
    }
    return;
  }
  if (t.dataset.score){
    state.dirty = true;
    t.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed','false'));
    t.setAttribute('aria-pressed','true');
    return;
  }

  /* --- Step 2, the member's own answers ---------------------------------- */
  if (t.dataset.ipick){
    const d = collectIntakeText();
    const kind = t.dataset.ipick;
    const label = t.dataset.label;
    const i = d.items.findIndex(x => x.kind===kind && String(x.label||'').trim().toLowerCase()===label.toLowerCase());
    if (i >= 0) d.items.splice(i, 1);
    else d.items.push({ kind, label, weight:3, note:'' });
    render(); return;
  }
  if (t.dataset.iadd){
    const d = collectIntakeText();
    d.items.push({ kind:t.dataset.iadd, label:'', weight:3, note:'' });
    render(); return;
  }
  if (t.dataset.idel){
    const d = collectIntakeText();
    d.items.splice(Number(t.dataset.idel), 1);
    render(); return;
  }
  if (t.dataset.iw){
    const row = t.closest('[data-row]');
    if (row){
      const d = collectIntakeText();
      const item = d.items[Number(row.dataset.row)];
      if (item) item.weight = Number(t.dataset.iw);
      render();
    }
    return;
  }

  const act = t.dataset.act;
  if (act==='reload-search') {
    if (state.dirty && !confirm('Discard unsaved edits and load the latest search?')) return;
    await withBusy(() => loadSearch(state.search.id));
    return;
  }
  if (act==='restore-search') {
    await withBusy(async () => {
      state.search = await api('/api/archives/'+t.dataset.id+'/restore', { method:'POST', body:{} });
      await loadSearches();
      toast('Search restored. Copy and share the new candidate links from Screening.');
      await go('overview');
    });
    return;
  }
  if (act==='restore-history') {
    if (!confirm('Restore this saved version? Current copy will remain in history. Restoring a profile clears current scores for reassessment.')) return;
    await withBusy(async () => {
      state.search = await api('/api/searches/'+state.search.id+'/history/'+t.dataset.index+'/restore', { method:'POST', body:{} });
      state.history = await api('/api/searches/'+state.search.id+'/history');
      toast('Saved version restored. Review it before using it.');
    });
    return;
  }
  if (act==='replace-invite' || act==='reopen-survey') {
    let reason = '';
    if (act==='reopen-survey') {
      reason = prompt('Why are you reopening this response? The original stays in history.');
      if (!reason?.trim()) return;
    } else if (!confirm('Replace this candidate link? The old link will stop working.')) return;
    await withBusy(async () => {
      state.search = await api('/api/searches/'+state.search.id+'/candidates/'+t.dataset.cid+'/'+(act==='reopen-survey'?'reopen':'invite'), { method:'POST', body:{ which:t.dataset.which, reason } });
      toast('Copy the new link below and share it with the candidate.');
    });
    return;
  }
  if (act==='logout'){
    showWait(waitSave('Signing out'));
    try {
      await api('/api/logout', { method:'POST', body:{} });
      state.user = null; state.search = null; state.view = 'home';
    } catch (err) { toast(err.message); }
    finally { hideWait(); render(); }
    return;
  }
  if (act==='pick-all'){
    const list = state.searches || [];
    state.picked = pickedIds().length === list.length ? [] : list.map(s => s.id);
    render();
    return;
  }
  if (act==='delete-searches'){
    const ids = pickedIds();
    if (!ids.length) return;
    const names = ids.map(id => (state.searches||[]).find(s => s.id===id)).filter(Boolean);
    const label = names.length===1
      ? (names[0].client || names[0].no || 'this search')
      : names.length+' searches';
    if (!confirm('Archive '+label+'? You can restore it from Archived searches.')) return;
    await withBusy(async () => {
      const out = await api('/api/searches/bulk-delete', { method:'POST', body:{ ids } });
      if (state.search && ids.includes(state.search.id)) state.search = null;
      state.picked = [];
      await loadSearches();
      const n = out.deleted || ids.length;
      toast(n===1 ? 'Archived.' : 'Archived '+n+' searches.');
      go('home');
    });
    return;
  }
  if (act==='delete-search'){
    const id = t.dataset.id;
    const name = t.dataset.name || 'this search';
    if (!id) return;
    if (!confirm('Archive '+name+'? You can restore it from Archived searches.')) return;
    await withBusy(async () => {
      await api('/api/searches/'+id, { method:'DELETE', body:{} });
      if (state.search && state.search.id===id) state.search = null;
      state.picked = (state.picked||[]).filter(x => x !== id);
      await loadSearches();
      toast('Archived.');
      go('home');
    });
    return;
  }
  if (act==='create'){
    await createSearch();
    return;
  }
  if (act==='new-from-pkg'){
    state.newPackage = t.dataset.pkg || showcasePkg();
    state.search = null;
    await go('new');
    return;
  }

  /* --- Step 1, the roster ------------------------------------------------- */
  if (act==='dismiss-pin'){
    state.newPin = null;
    render(); return;
  }
  if (act==='confirm-team'){
    const confirmed = !state.search.team?.confirmedAt;
    await withBusy(async () => {
      state.search = await api('/api/searches/'+state.search.id+'/team/confirm', { method:'POST', body:{ confirmed } });
      toast(confirmed ? 'Roster confirmed. You can open committee intake.' : 'Roster reopened.');
    }, waitSave(confirmed ? 'Confirming the roster' : 'Reopening the roster'));
    return;
  }
  if (act==='join-search'){
    await withBusy(async () => {
      const out = await api('/api/searches/'+state.search.id+'/members/self', { method:'POST', body:{} });
      state.search = out.search;
      toast('You are on this search. Take the account if you are running it.');
    }, waitSave('Joining the search'));
    return;
  }
  if (act==='make-manager'){
    const uid = t.dataset.uid;
    const taking = uid === state.user.id;
    await withBusy(async () => {
      const out = await api('/api/searches/'+state.search.id+'/members/'+uid, { method:'PATCH', body:{ seat:'manager' } });
      state.search = out.search;
      toast(taking ? 'You run this search now. The previous manager keeps a consultant seat.' : 'Account handed over. You keep a consultant seat.');
    }, waitSave(taking ? 'Taking the account' : 'Handing over the account'));
    return;
  }
  if (act==='unseat'){
    const uid = t.dataset.uid;
    const name = t.dataset.name || 'this person';
    if (!confirm('Remove '+name+' from this search? Their committee answers come off the file with them.')) return;
    await withBusy(async () => {
      const out = await api('/api/searches/'+state.search.id+'/members/'+uid, { method:'DELETE', body:{} });
      state.search = out.search;
      toast(name+' is off the search.');
    }, waitSave('Removing them from the search'));
    return;
  }
  if (act==='reset-pin'){
    const uid = t.dataset.uid;
    await withBusy(async () => {
      const out = await api('/api/searches/'+state.search.id+'/members/'+uid+'/pin', { method:'POST', body:{} });
      state.newPin = out;
      toast('New PIN issued. Read it to them now.');
    }, waitSave('Issuing a new PIN'));
    return;
  }

  /* --- Step 2, the intake window ------------------------------------------ */
  if (act==='intake-open' || act==='intake-close'){
    const open = act==='intake-open';
    const form = $('#intakewindow');
    const win = form ? Object.fromEntries(new FormData(form).entries()) : {};
    if (!open) {
      const waiting = (state.search.consensus?.pending || []).length;
      if (waiting && !confirm(waiting+' member'+(waiting===1?' has':'s have')+' not answered yet. Close the window anyway?')) return;
    }
    await withBusy(async () => {
      state.search = await api('/api/searches/'+state.search.id+'/intake/status', {
        method:'POST', body:{ status: open ? 'open' : 'closed', ...win }
      });
      toast(open ? 'Intake is open. Every seated member can answer now.' : 'Intake closed. The committee can see what the room said.');
    }, waitSave(open ? 'Opening the window' : 'Closing the window'));
    return;
  }
  if (act==='intake-save-window'){
    const form = $('#intakewindow');
    const win = form ? Object.fromEntries(new FormData(form).entries()) : {};
    await withBusy(async () => {
      state.search = await api('/api/searches/'+state.search.id+'/intake/status', {
        method:'POST', body:{ status: state.search.intake.status, ...win }
      });
      toast('Saved.');
    });
    return;
  }
  if (act==='save-intake' || act==='submit-intake'){
    const submitted = act==='submit-intake';
    const d = collectIntakeText();
    const items = d.items.filter(i => String(i.label||'').trim());
    if (submitted && !items.length){
      toast('Name at least one thing you are looking for.');
      return;
    }
    await withBusy(async () => {
      state.search = await api('/api/searches/'+state.search.id+'/intake', {
        method:'PUT',
        body:{ items, mustHave:d.mustHave, dealBreaker:d.dealBreaker, context:d.context, submitted }
      });
      state.intake = null;
      toast(submitted ? 'Your answers are in. The rest of the committee cannot see them yet.' : 'Saved. Come back and submit when you are ready.');
      if (submitted && you().consultant) go('intake');
    }, waitSave(submitted ? 'Submitting your answers' : 'Saving your answers'));
    return;
  }
  if (act==='adopt-consensus'){
    const adopted = (state.search.criteria||[]).some(c => String(c.label||'').trim());
    if (adopted && !confirm('Rebuild the profile from committee input? Consensus items come first; anything you wrote by hand is kept behind them, up to five per section.')) return;
    await withBusy(async () => {
      const out = await api('/api/searches/'+state.search.id+'/intake/adopt', { method:'POST', body:{} });
      state.search = out.search;
      const gaps = out.gaps || [];
      toast(gaps.length
        ? 'Built from the committee. Still short in '+gaps.map(g=>g.label.toLowerCase()).join(', ')+' — fill those in.'
        : 'Built from the committee. Edit the weights and wording, then save.');
      go('profile');
    }, waitSave('Building the profile from committee input'));
    return;
  }
  if (act==='research'){
    const profileDone = (state.search.steps||[]).find(st=>st.key==='profile')?.status==='done';
    if (!profileDone){
      toast('Adopt the candidate profile first (Step '+stepNo('profile')+').');
      go('profile');
      return;
    }
    const form = $('#citylookup') || $('#facts');
    const body = form ? Object.fromEntries(new FormData(form).entries()) : {};
    state.premium = $('#premium')?.checked || false;
    const city = String(body.city || body.client || state.search.client || '').trim();
    const website = String(body.website || state.search.website || '').trim();
    await withLookup(city, website, async () => {
      if (form?.id === 'facts') {
        state.search = await api('/api/searches/'+state.search.id, { method:'PATCH', body });
      }
      const out = await api('/api/searches/'+state.search.id+'/research', {
        method:'POST',
        body:{ city, website, premium: state.premium }
      });
      state.search = out.search;
      toast('Filled from public sources. Check the numbers, then edit.');
      go('community');
    });
    return;
  }
  if (act==='save-facts'){
    const body = Object.fromEntries(new FormData($('#facts')).entries());
    await withBusy(async () => {
      state.search = await api('/api/searches/'+state.search.id, { method:'PATCH', body });
      toast('Facts saved.');
    });
    return;
  }
  if (act==='next-step'){
    const from = t.dataset.from || state.view;
    if (from === 'profile'){
      await persistProfile(true);
      return;
    }
    const n = nextOf(from);
    if (!n) return;
    // Answers typed into the intake form but never saved would otherwise
    // vanish on the way to the next step.
    if (from === 'intake' && state.intake) {
      const typed = collectIntakeText().items.some(i => String(i.label||'').trim());
      if (typed && !mySubmission()?.submitted &&
          !confirm('Your answers are not submitted yet. Leave this step without submitting them?')) return;
    }
    if ($('#edit-'+from) || $('#art-'+from)){
      let body;
      try { body = collectArtifact(from); }
      catch { toast('Fix the copy before moving on.'); return; }
      if (artHasContent(body)){
        await withBusy(async () => {
          state.search = await api('/api/searches/'+state.search.id+'/artifact/'+from, { method:'PUT', body:{ body } });
          await go(n.key);
        }, waitSave('Saving, then the next step'));
        return;
      }
    }
    await go(n.key);
    return;
  }
  if (act==='save-profile' || act==='save-profile-next'){
    await persistProfile(act==='save-profile-next');
    return;
  }
  if (act==='draft-profile'){
    state.premium = $('#premium')?.checked || false;
    const notes = $('#profilenotes')?.value || '';
    await withBusy(async () => {
      const out = await api('/api/searches/'+state.search.id+'/generate', { method:'POST', body:{ kind:'profile', premium:state.premium, notes } });
      state.search = out.search;
      toast('Drafted on '+out.model+'. Edit weights, then save.'+deskNote(out.desk), out.desk?.open?.length ? 9000 : 3400);
      go('profile');
    }, waitFor('profile'));
    return;
  }
  if (act==='generate'){
    state.premium = $('#premium')?.checked || false;
    const kind = t.dataset.kind;
    await withBusy(async () => {
      const out = await api('/api/searches/'+state.search.id+'/generate', { method:'POST', body:{ kind, premium:state.premium } });
      state.search = out.search;
      const base = kind==='brochure' ? 'Tightened on '+out.model+'. Photos and layout stayed put.' : 'Drafted on '+out.model+'.';
      toast(base+deskNote(out.desk), out.desk?.open?.length ? 9000 : 3400);
    }, waitFor(kind));
    return;
  }
  if (act==='assemble'){
    await withBusy(() => fillBrochureFromCommunity(), {
      kicker: 'Brochure',
      title: 'Filling from the community file',
      copy: 'Rebuilding the packet from the community research and the adopted profile. Photos and layout stay put.',
      steps: ['Reading the community file', 'Laying out the packet']
    });
    return;
  }
  if (act==='pack-theme' || act==='pack-scheme'){
    const prev = { ...(state.search.artifacts?.brochure || {}) };
    let body = prev;
    if ($('#edit-brochure')) {
      try { body = collectArtifact('brochure'); } catch { body = prev; }
    }
    if (act==='pack-theme') body.theme = t.dataset.layout;
    if (act==='pack-scheme') body.scheme = t.dataset.scheme;
    if (!body.photos) body.photos = prev.photos || {};
    if (!body.theme) body.theme = prev.theme;
    if (!body.scheme) body.scheme = prev.scheme;
    await withBusy(async () => {
      state.search = await api('/api/searches/'+state.search.id+'/artifact/brochure', { method:'PUT', body:{ body } });
    }, false);
    return;
  }
  if (act==='photo-del'){
    const slot = t.dataset.slot;
    await withBusy(async () => {
      state.search = await api('/api/searches/'+state.search.id+'/media/'+slot, { method:'DELETE', body:{} });
      toast('Photo removed.');
    }, waitSave('Removing the photo'));
    return;
  }
  if (act==='review'){
    const kind = t.dataset.kind;
    const approve = t.dataset.approve === '1';
    let edited = null;
    if (approve && state.dirty && $('#edit-'+kind)) {
      try { edited = collectArtifact(kind); }
      catch { toast('Save valid copy before marking it reviewed.'); return; }
    }
    await withBusy(async () => {
      if (edited) state.search = await api('/api/searches/'+state.search.id+'/artifact/'+kind, { method:'PUT', body:{ body:edited } });
      state.search = await api('/api/searches/'+state.search.id+'/artifact/'+kind+'/review', {
        method:'POST', body:{ approve }
      });
      toast(approve ? 'Marked reviewed. It is ready to go out.' : 'Back to draft.');
    }, waitSave(approve ? 'Recording your review' : 'Reopening the draft'));
    return;
  }
  if (act==='save-art'){
    const kind = t.dataset.kind;
    let body;
    try { body = collectArtifact(kind); }
    catch { toast('Fix the copy before saving.'); return; }
    await withBusy(async () => {
      state.search = await api('/api/searches/'+state.search.id+'/artifact/'+kind, { method:'PUT', body:{ body } });
      toast('Saved.');
    });
    return;
  }
  if (act==='toggle-release'){
    await withBusy(async () => {
      state.search = await api('/api/searches/'+state.search.id, { method:'PATCH', body:{ released: !state.search.released } });
      toast(state.search.released ? 'Scores released.' : 'Scores sealed.');
    });
    return;
  }
  if (act==='advance'){
    const stage = t.dataset.stage || 'finalist';
    await withBusy(async () => {
      state.search = await api('/api/searches/'+state.search.id+'/candidates/'+state.sel, { method:'PATCH', body:{ stage } });
      toast(stage==='semifinalist' ? 'Advanced to semifinalist.' : 'Advanced to finalist.');
    });
    return;
  }
  if (act==='advance-semi' || act==='advance-final'){
    const cid = t.dataset.cid;
    const stage = act==='advance-semi' ? 'semifinalist' : 'finalist';
    await withBusy(async () => {
      state.search = await api('/api/searches/'+state.search.id+'/candidates/'+cid, { method:'PATCH', body:{ stage } });
      toast(stage==='semifinalist' ? 'Advanced to semifinalist.' : 'Advanced to finalist.');
    });
    return;
  }
  if (act==='staff-log'){
    const key = t.dataset.key;
    const text = $('#staff-text')?.value || '';
    const candidateId = $('#staff-cid')?.value || '';
    if (!text.trim()){ toast('Write down what was done.'); return; }
    if ($('#staff-cid') && !candidateId){ toast(key==='references' ? 'Choose the finalist this reference is for.' : 'Choose the semifinalist you interviewed.'); return; }
    await withBusy(async () => {
      state.search = await api('/api/searches/'+state.search.id+'/staff/'+key+'/log', { method:'POST', body:{ text, candidateId: candidateId || undefined } });
      toast('Logged.');
    }, waitSave('Adding to the log'));
    return;
  }
  if (act==='staff-log-del'){
    if (!confirm('Remove this log entry?')) return;
    await withBusy(async () => {
      state.search = await api('/api/searches/'+state.search.id+'/staff/'+t.dataset.key+'/log/'+t.dataset.lid, { method:'DELETE', body:{} });
      toast('Entry removed.');
    }, false);
    return;
  }
  if (act==='staff-notes'){
    const notes = $('#staff-notes')?.value || '';
    await withBusy(async () => {
      state.search = await api('/api/searches/'+state.search.id+'/staff/'+t.dataset.key, { method:'PUT', body:{ notes } });
      toast('Notes saved.');
    }, waitSave('Saving notes'));
    return;
  }
  if (act==='staff-done'){
    const done = t.dataset.done === '1';
    // Notes typed but not saved would be lost on the re-render; keep them.
    const notes = $('#staff-notes')?.value;
    await withBusy(async () => {
      if (notes !== undefined && notes !== ((state.search.staff||{})[t.dataset.key]?.notes||'')) {
        state.search = await api('/api/searches/'+state.search.id+'/staff/'+t.dataset.key, { method:'PUT', body:{ notes } });
      }
      state.search = await api('/api/searches/'+state.search.id+'/staff/'+t.dataset.key+'/complete', { method:'POST', body:{ done } });
      toast(done ? 'Marked complete.' : 'Reopened.');
    }, waitSave(done ? 'Signing off' : 'Reopening'));
    return;
  }
  if (act==='ref-consent'){
    const consent = t.dataset.on === '1';
    await withBusy(async () => {
      state.search = await api('/api/searches/'+state.search.id+'/candidates/'+t.dataset.cid+'/consent', { method:'POST', body:{ consent } });
      toast(consent ? 'Consent recorded.' : 'Consent withdrawn.');
    }, false);
    return;
  }
  if (act==='send2-one' || act==='send2-all'){
    const deadline = $('#send2-deadline')?.value || '';
    const path = act==='send2-all'
      ? '/api/searches/'+state.search.id+'/send2'
      : '/api/searches/'+state.search.id+'/candidates/'+t.dataset.cid+'/send2';
    await withBusy(async () => {
      state.search = await api(path, { method:'POST', body:{ deadline } });
      toast('Questionnaire opened. Notify candidates yourself using their applicant links.', 7000);
    });
    return;
  }
  if (act==='copy-post'){
    const src = t.dataset.src;
    let text = '';
    if (src === 'brochure') text = $('#pack-brochure')?.innerText || '';
    else {
      const pack = t.closest('.adpack')?.querySelector('.pack--ad') || t.closest('.ad');
      text = pack?.innerText || '';
    }
    if (!text.trim()){ toast('Nothing to copy yet.'); return; }
    try {
      await navigator.clipboard.writeText(text.trim());
      toast('Copied for posting.');
    } catch { toast('Could not copy. Select the text and copy it yourself.'); }
    return;
  }
  if (act==='print-pack'){
    const kind = t.dataset.kind || (state.view==='ads' ? 'ads' : 'brochure');
    document.documentElement.dataset.print = kind;
    const done = () => {
      delete document.documentElement.dataset.print;
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
    setTimeout(done, 1500);
    return;
  }
  if (act==='save-score'){
    const scores = {};
    $$('[data-score][aria-pressed="true"]').forEach(b => { scores[b.dataset.score] = Number(b.dataset.val); });
    const note = $('#cnote')?.value || '';
    await withBusy(async () => {
      state.search = await api('/api/searches/'+state.search.id+'/scores/'+state.sel, { method:'PUT', body:{ scores, note } });
      toast('Your scores are on the file.');
    });
  }
});

document.addEventListener('submit', async e => {
  e.preventDefault();
  if (e.target.id==='login'){
    const body = Object.fromEntries(new FormData(e.target).entries());
    showWait(waitSave('Signing in'));
    try {
      const out = await api('/api/login', { method:'POST', body });
      state.user = out.user;
      await loadMe();
      await loadSearches();
      go('home');
    } catch (err) { toast(err.message); }
    finally { hideWait(); }
  }
  if (e.target.id==='newsearch'){
    await createSearch();
  }
  if (e.target.id==='newmember'){
    const body = Object.fromEntries(new FormData(e.target).entries());
    await withBusy(async () => {
      const out = await api('/api/searches/'+state.search.id+'/members', { method:'POST', body });
      state.search = out.search;
      // Only a brand new account comes back with a PIN. Seating a colleague
      // who already signs in has nothing to hand over.
      state.newPin = out.pin ? { pin: out.pin, email: out.email, name: body.name } : null;
      toast(out.pin ? body.name+' is seated. Read them the sign-in below.' : body.name+' is seated.');
    }, waitSave('Seating '+(body.name||'them')));
  }
  if (e.target.id==='newcand'){
    const body = Object.fromEntries(new FormData(e.target).entries());
    await withBusy(async () => {
      state.search = await api('/api/searches/'+state.search.id+'/candidates', { method:'POST', body });
      toast((body.name||'Candidate')+' is on the file. Copy the applicant link from the table.');
    });
  }
  if (e.target.id==='applyform'){
    const answers = Object.fromEntries(new FormData(e.target).entries());
    const token = location.pathname.split('/').pop();
    const which = e.target.dataset.which === 'survey2' ? 'survey2' : 'survey1';
    showWait(waitSave('Submitting your answers'));
    try {
      await api('/api/apply/'+token, { method:'POST', body:{ which, answers, surveyVersion:state.apply.versions?.[which] } });
      state.dirty = false;
      if (which === 'survey2') state.apply.submitted2 = true;
      else state.apply.submitted1 = true;
      render();
      toast('Submitted.');
    } catch (err) { toast(err.message); }
    finally { hideWait(); }
  }
});

let creating = false;
async function createSearch(){
  if (creating) return;
  const form = $('#newsearch');
  if (!form) return;
  if (!form.reportValidity()) return;
  const body = Object.fromEntries(new FormData(form).entries());
  creating = true;
  try {
    await withBusy(async () => {
      state.search = await api('/api/searches', { method:'POST', body });
    });
    state.newPackage = null;
    state.newJurisdiction = null;
    if (!state.search) return;
    // A search now opens on the roster, not the profile. Seating the committee
    // is what makes the profile something other than one person's guess.
    go('team');
    toast('Search '+state.search.no+' is open. Seat the committee first.');
  } finally {
    creating = false;
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

(async function boot(){
  await loadHealth();
  const m = location.pathname.match(/^\/apply\/([^/]+)/);
  if (m){
    try { state.apply = await api('/api/apply/'+m[1]); }
    catch { state.apply = null; }
    render();
    return;
  }
  if (await loadMe()){
    await loadSearches();
    go('home');
  } else {
    render();
  }
})();

// Warn before losing unsaved work, including candidate questionnaires.
document.addEventListener('input', e => {
  if (e.target.matches('input, textarea, select') && !e.target.closest('#login')) state.dirty = true;
});
window.addEventListener('beforeunload', e => {
  if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
});
