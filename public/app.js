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

/* --- outcomes, documents and contact --------------------------------------
 * The vocabulary the server validates against (server/disposition.js and
 * server/candidates.js). Mirrored here so the forms offer exactly what will be
 * accepted; the server remains the one that decides.
 * ------------------------------------------------------------------------ */

const OUTCOME = {
  withdrawn: {
    label:'Withdrew', pill:'idle',
    hint:'The candidate told you they are out. Recorded by staff, on their behalf.',
    evidence:false, revokes:true
  },
  'not-selected': {
    label:'Not selected', pill:'stop',
    hint:'The firm’s decision. It has to name the job-related basis it rests on.',
    evidence:true, revokes:true
  },
  selected: {
    label:'Selected', pill:'ok',
    hint:'The hire. Their file stays open through contracting, so their link is not revoked.',
    evidence:true, revokes:false
  },
  'declined-offer': {
    label:'Declined the offer', pill:'wait',
    hint:'They were selected and said no. Recorded by staff, on their behalf.',
    evidence:false, revokes:true
  }
};

// Staff record these two on a candidate's behalf. Saying so on screen keeps a
// candidate's own decision from reading as the firm's.
const OUTCOME_SOURCE = {
  'staff-recorded-from-candidate': 'Reported by the candidate, recorded by staff',
  'consultant-decision': 'Decision by the search team'
};

const DOC_KIND = {
  resume:     { label:'Resume', restricted:false },
  application:{ label:'Application', restricted:false },
  supporting: { label:'Supporting material', restricted:false },
  // Narrower than the rest of the file, and labelled as such wherever listed.
  reference:  { label:'Reference material', restricted:true },
  background: { label:'Background check', restricted:true }
};

const CHANNEL = {
  email:'Email', phone:'Phone', letter:'Letter', 'in-person':'In person', other:'Other'
};
const PURPOSE = {
  invitation:'Invitation', reminder:'Reminder', scheduling:'Scheduling',
  status:'Status update', decision:'Decision', accommodation:'Accommodation', other:'Other'
};

/* ===========================================================================
 * Destinations
 *
 * The rail used to be the nineteen-step production run, one numbered task per
 * line. A consultant works in recruiting terms — who is in the pipeline, what
 * is drafted, who still owes an answer — so a search now navigates by
 * destination and the numbered process keeps its own screen.
 *
 * One mapping drives rail selection, the breadcrumb, and the document title.
 * Every existing view keeps its own route; these only say where a view lives.
 * ========================================================================= */

const DESTS = [
  { key:'overview',   label:'Overview',   icon:'gauge' },
  { key:'candidates', label:'Candidates', icon:'people' },
  { key:'interviews', label:'Interviews', icon:'screen' },
  { key:'committee',  label:'Committee',  icon:'seats' },
  { key:'documents',  label:'Documents',  icon:'docs' },
  { key:'activity',   label:'Activity',   icon:'clock' }
];

// Which destination each view belongs to. Views absent from this map (Home,
// New search, Packages, Archived searches, Search facts, History) sit outside
// a search's destinations and highlight nothing.
const VIEW_DEST = {
  overview:'overview',
  screen:'candidates', people:'candidates', person:'candidates',
  send2:'candidates', finalists:'candidates', sourcing:'candidates', references:'candidates',
  interviews:'interviews', video:'interviews', guide:'interviews', schedule:'interviews',
  committee:'committee', team:'committee', intake:'committee', 'intake-mine':'committee', profile:'committee',
  documents:'documents', community:'documents', survey1:'documents', survey2:'documents',
  plan:'documents', brochure:'documents', ads:'documents', contract:'documents', bar:'documents',
  activity:'activity'
};

// Where a destination opens. Candidates opens the list; the rest are hubs over
// work that already exists.
const DEST_HOME = {
  overview:'overview', candidates:'screen', interviews:'interviews',
  committee:'committee', documents:'documents', activity:'activity'
};

// The steps each destination is built out of, used to decide whether it has
// any content this viewer and this package are entitled to see.
const DEST_STEPS = {
  candidates:['screen','send2','finalists','sourcing','references'],
  interviews:['video','guide','schedule'],
  committee:['team','intake','profile'],
  // The adopted profile is indexed with the documents but it is the
  // committee's product, so it does not by itself put a Documents destination
  // in front of a committee member who has no drafting work.
  documents:['community','survey1','survey2','guide','plan','brochure','ads','schedule','contract','bar']
};

// The order the Documents index lists artifacts in: the profile everything
// inherits from, then the research, then what goes out, then what closes.
const DOC_KEYS = ['profile','community','plan','brochure','ads','survey1','survey2','guide','schedule','contract','bar'];

// The new hubs and the process checklist. Every other view is either a step,
// a workspace screen, or the candidate detail.
const HUB_VIEWS = ['interviews','committee','documents','activity','process'];

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
  picked:[],
  // Why the last search-index refresh failed, if it did. The previously
  // loaded list stays on screen; this drives the retry notice above it.
  searchesError:null,
  // Navigation shell state. `navOpen` is the mobile drawer; `railOpen` holds
  // the phase groups the user has expanded or collapsed by hand, so a render
  // does not fight their choice.
  navOpen:false,
  railOpen:{},
  // Where each route was scrolled to, so Back returns to the same place.
  scrollMem:{},
  // Screening list filters, kept per search so Back recovers list context.
  filters:{},
  // Open/close state for panels that collapse (suggestion banks, advanced
  // source JSON, package comparison).
  open:{},
  // Which editor mode a document surface is in: 'edit' or 'preview'.
  mode:{},
  // The selected section of a screen that has them, keyed by tab group, and
  // which column of the candidate review a small screen is showing.
  tab:{},
  reviewCol:'both',
  // Home's local text filter over the searches already loaded.
  homeQ:'',
  // Who has not been contacted and whose follow-up date has passed, as the
  // server reports it. Refreshed when the candidate list opens.
  followUps:null
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
function packageMatrix(selected, { pick=false, plain=false }={}){
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
    // Inside a form the comparison is reference material only: a header that
    // navigated to the Packages page would discard what had been typed.
    if (plain || !state.user) return `<div class="pkgmx__pick">${inner}</div>`;
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

// Kept for surfaces that still present "what comes next" as a card rather than
// an action bar. Document screens use the shared bar instead (D06).
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
  const token = path.startsWith('/api/apply/') ? null : await window.SlateAuth.token();
  const writesSearch = opts.method && opts.method !== 'GET' && state.search && path.startsWith('/api/searches/'+state.search.id);
  const res = await fetch(path, {
    credentials:'include',
    ...opts,
    headers:{ 'content-type':'application/json', ...(token ? { authorization:'Bearer ' + token } : {}), ...(writesSearch ? { 'if-match':String(state.search.revision) } : {}), ...(opts.headers||{}) },
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

/* --- destination helpers -------------------------------------------------- */

// The destination the current view sits in, so the rail marks one item and the
// breadcrumb names the same place the rail does.
function destOf(view = state.view){
  return VIEW_DEST[view] || null;
}

function destLabel(key){
  return (DESTS.find(d => d.key === key) || {}).label || '';
}

// Does this viewer have anything to open in this destination? A destination
// with no authorised content is not drawn at all, rather than opening on an
// explanation of why it is empty. Overview and Activity always exist.
function destAvailable(key){
  if (!state.search) return false;
  if (key === 'overview' || key === 'activity') return true;
  return (DEST_STEPS[key] || []).some(canOpenStep);
}

function availableDests(){
  return DESTS.filter(d => destAvailable(d.key));
}

// Every view this build can render. A deep link to anything else lands on the
// search overview rather than silently painting Home under a stale address.
function knownView(view){
  if (['home','new','archives','packages','overview','facts','verify','closeout','history','person','people','intake-mine'].includes(view)) return true;
  if (HUB_VIEWS.includes(view)) return true;
  return STEP_FLOW.includes(view);
}

/* ===========================================================================
 * Routing
 *
 * Until DEP-13 the current screen lived only in `state.view`: refreshing threw
 * the user back to Home, browser Back left the app, and there was no address
 * to send anyone. Every screen now has a URL, and the visible Back control and
 * the browser's own Back move through the same history.
 * ========================================================================= */

// How many entries this session has pushed. Anything above zero means the
// previous entry belongs to the app, so Back can safely use browser history.
let navDepth = 0;

function routeFor(view = state.view, opts = {}){
  const sel = opts.sel !== undefined ? opts.sel : state.sel;
  if (view === 'packages') return '#/packages/' + encodeURIComponent(opts.pkg || state.showcasePkg || '');
  if (view === 'new' || view === 'archives' || view === 'home') return '#/' + view;
  const id = opts.searchId || state.search?.id;
  if (!id) return '#/home';
  if (view === 'overview') return '#/s/' + encodeURIComponent(id);
  if (view === 'person') return '#/s/' + encodeURIComponent(id) + '/person/' + encodeURIComponent(sel || '');
  return '#/s/' + encodeURIComponent(id) + '/' + encodeURIComponent(view);
}

function parseRoute(hash){
  const parts = String(hash || '').replace(/^#\/?/, '').split('/').filter(Boolean).map(p => {
    try { return decodeURIComponent(p); } catch { return p; }
  });
  if (!parts.length) return { view:'home' };
  if (parts[0] === 's'){
    if (!parts[1]) return { view:'home' };
    const view = parts[2] || 'overview';
    return { view, searchId:parts[1], sel: view === 'person' ? (parts[3] || null) : null };
  }
  if (parts[0] === 'packages') return { view:'packages', pkg: parts[1] || null };
  if (['home','new','archives'].includes(parts[0])) return { view:parts[0] };
  return { view:'home' };
}

// The route the address bar is showing right now, used to key scroll memory.
function currentRoute(){
  return location.hash || '#/home';
}

function rememberScroll(){
  state.scrollMem[currentRoute()] = window.scrollY || 0;
}

function pushRoute(replace){
  const url = routeFor();
  if (replace || url === currentRoute()){
    history.replaceState({ slateDepth:navDepth }, '', url);
  } else {
    navDepth += 1;
    history.pushState({ slateDepth:navDepth }, '', url);
  }
}

// Where the visible Back control lands when there is no in-app history to pop:
// a deep link opened in a fresh tab. Never leaves the app.
function backFallback(){
  const v = state.view;
  if (v === 'person') return { view:'screen', label:'Back to candidates' };
  if (v === 'home' || v === 'new' || v === 'archives' || v === 'packages') return { view:'home', label:'Back to Home' };
  if (v === 'overview') return { view:'home', label:'Back to Home' };
  if (state.search) return { view:'overview', label:'Back to '+(state.search.client || 'this search') };
  return { view:'home', label:'Back to Home' };
}

function canGoBack(){
  if (location.pathname.startsWith('/apply/')) return false;
  if (!state.user) return false;
  // Home with nothing behind it has no meaningful return destination.
  if (state.view === 'home' && navDepth <= 0) return false;
  return true;
}

function backControl(){
  if (!canGoBack()) return '';
  const label = navDepth > 0 ? 'Back' : backFallback().label;
  return `<div class="backbar"><button type="button" class="backlink" data-act="back">
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3 5 8l5 5"/></svg>
    <span>${esc(label)}</span>
  </button></div>`;
}

// Back is one behaviour whether it is pressed on the page or in the browser
// chrome: same history, same unsaved-edit prompt, same fallbacks.
async function goBack(){
  if (navDepth > 0){ history.back(); return; }
  const to = backFallback();
  await go(to.view);
}

// Move to a parsed route without pushing a new entry. Used by boot (deep link
// or refresh) and by popstate (browser Back/Forward).
async function applyRoute(route, { push=false }={}){
  if (route.searchId && state.search?.id !== route.searchId){
    try { await loadSearch(route.searchId); }
    catch { toast('That search is not on your book, or is no longer available.'); await go('home', {}, { replace:true }); return; }
  }
  if (!route.searchId && !['home','new','archives','packages'].includes(route.view)) route = { view:'home' };
  if (route.pkg) state.showcasePkg = route.pkg;
  const extra = route.sel ? { sel:route.sel } : {};
  await go(route.view, extra, { push, replace:!push, fromHistory:true });
}

async function go(view, extra={}, opts={}){
  if (!state.busy && state.dirty && !confirm('Leave this page and discard unsaved edits?')) return;
  state.dirty = false;
  if (!opts.fromHistory) rememberScroll();
  state.navOpen = false;
  if (view === 'home') { state.search = null; state.sel = null; }
  if (offPackage(view)) {
    const st = (state.health?.steps || []).find(x => x.key === view);
    toast((st ? STEP_NAME[view] || st.t : 'That step')+' is not part of the '+packageLabel(state.search.package)+' package.');
    view = 'overview';
  }
  // A deep link can name a step a committee member does not take part in.
  if (isCommittee() && STEP_FLOW.includes(view === 'intake-mine' ? 'intake' : view)
      && !COMMITTEE_STEPS.has(view === 'intake-mine' ? 'intake' : view)){
    toast('That step is run by the search consultant.');
    view = 'overview';
  }
  // Facts, verification, closeout and history are the consultant's side of the
  // file. A committee member who follows a link to one lands on the search.
  if (state.search && ['facts','verify','closeout','history'].includes(view) && !canEdit()){
    view = 'overview';
  }
  if (view === 'archives' && isCommittee()) view = 'home';
  // An address this build cannot render is not painted as Home under someone
  // else's URL; it lands on the search, or the book, and says so.
  if (!knownView(view)){
    toast('That address is not part of the workspace.');
    view = state.search ? 'overview' : 'home';
  }
  // The new hubs are windows onto existing work, so they take the same access
  // decision as the work behind them: nothing to show, nothing to open.
  if (state.search && DEST_STEPS[view] && !destAvailable(view)){
    toast(destLabel(view)+' has nothing on this search.');
    view = 'overview';
  }
  // Every other screen belongs to an open search. A link to one without a
  // loaded file lands on Home rather than rendering an empty workspace.
  if (!state.search && !['home','new','archives','packages'].includes(view)) view = 'home';
  try {
    if (view === 'home') await refreshSearches();
    if (view === 'archives') state.archives = await api('/api/archives');
    if (view === 'history') state.history = await api('/api/searches/'+state.search.id+'/history');
  } catch (error) { toast(error.message); return; }
  // Who still needs chasing, read from the server so the list and the export
  // agree on the answer. Deliberately not fatal: the candidate list is still
  // worth opening when this one call fails.
  if (['screen','people'].includes(view) && state.search && canEdit()){
    try { state.followUps = await api('/api/searches/'+state.search.id+'/follow-ups'); }
    catch { state.followUps = null; }
  }
  Object.assign(state, extra, { view });
  if (view === 'brochure' && brochureNeedsFill(state.search)){
    pushRoute(opts.replace);
    if (state.busy) {
      try { await fillBrochureFromCommunity(); }
      catch (err) { toast(err.message); }
      settleView(opts);
      return;
    }
    await withBusy(() => fillBrochureFromCommunity(), {
      kicker: 'Brochure',
      title: 'Building the brochure',
      copy: 'Pulling the community research and the adopted profile into a packet. Then you can add pictures.',
      steps: ['Reading the community file', 'Laying out the packet']
    });
    settleView(opts);
    return;
  }
  pushRoute(opts.replace);
  render();
  settleView(opts);
}

// After a screen changes: put the page where the user expects it and move
// keyboard focus to the new heading, which is what makes a screen change
// announce itself instead of silently repainting.
function settleView(opts = {}){
  const y = opts.fromHistory ? (state.scrollMem[currentRoute()] || 0) : 0;
  window.scrollTo({ top:y, behavior:'instant' });
  focusHeading();
}

function focusHeading(){
  const h = $('#app h1');
  if (!h) return;
  h.setAttribute('tabindex','-1');
  h.focus({ preventScroll:true });
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

function ico(name, size=15){
  const p = {
    lock:'<path d="M5 8V6a3 3 0 0 1 6 0v2M4 8h8v6H4z"/>',
    check:'<path d="M3 8.5 6.2 12 13 4.5"/>',
    // Destination marks. Labels carry the meaning; these only help the eye
    // find the same row again.
    gauge:'<path d="M2.5 11a5.5 5.5 0 1 1 11 0"/><path d="M8 11 10.6 7"/>',
    people:'<path d="M6 8a2.2 2.2 0 1 0 0-4.4A2.2 2.2 0 0 0 6 8Z"/><path d="M1.9 13.2c0-2 1.8-3.2 4.1-3.2s4.1 1.2 4.1 3.2"/><path d="M11 4.2a2 2 0 0 1 0 3.9"/><path d="M12.1 10.3c1.3.4 2.1 1.3 2.1 2.6"/>',
    screen:'<path d="M2 3.5h12v8H2z"/><path d="M6.6 6.2 9.6 7.7 6.6 9.2z"/><path d="M5.5 13.8h5"/>',
    seats:'<path d="M8 7.4a2.1 2.1 0 1 0 0-4.2 2.1 2.1 0 0 0 0 4.2Z"/><path d="M3.6 13.4c0-2.3 2-3.6 4.4-3.6s4.4 1.3 4.4 3.6"/>',
    docs:'<path d="M4.2 2.2h4.4L11.8 5v8.8H4.2z"/><path d="M8.4 2.4V5h3.2"/><path d="M6 8.4h4M6 10.7h4"/>',
    clock:'<path d="M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12Z"/><path d="M8 4.9V8l2.2 1.4"/>',
    list:'<path d="M3 4.3h10M3 8h10M3 11.7h10"/>',
    more:'<path d="M8 3.4v.01M8 8v.01M8 12.6v.01"/>'
  }[name] || '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}
function pill(k, label){ return `<span class="pill pill--${k}">${esc(label)}</span>`; }

/* ===========================================================================
 * Hover text and contextual help
 *
 * A short description of what a control actually does, available on hover, on
 * keyboard focus, and — where a pointer cannot hover — from a labelled help
 * button beside it. The description is attached with aria-describedby so the
 * control keeps its own accessible name. Anything a user must know before
 * acting stays visible in the page; these only explain.
 * ========================================================================= */

let tipSeq = 0;

/**
 * Wrap a control with a tooltip.
 *
 * `html` must start with the control's own opening tag; the id is written into
 * that tag as aria-describedby. Tooltips hold no interactive content, so they
 * are safe to leave in the accessibility tree as description text.
 */
function withTip(html, text){
  if (!text) return html;
  const markup = String(html).trim();
  const id = 'tip-' + (++tipSeq);
  const m = /^<(button|a|span|select|input|summary|label)\b/.exec(markup);
  if (!m) return markup;
  const described = markup.replace(/^<([a-z]+)\b/, '<$1 aria-describedby="'+id+'"');
  return `<span class="tipwrap">${described}<button type="button" class="tiphelp" data-act="tip-help" aria-expanded="false" aria-controls="${id}" aria-label="Explain this control">?</button><span class="tip" role="tooltip" id="${id}" hidden>${esc(text)}</span></span>`;
}

// Explanations reused across screens, so the same control says the same thing
// wherever it appears.
const TIPS = {
  copyInvite:'Copy this candidate’s questionnaire link to share with them.',
  openQuestionnaire:'Open this candidate’s questionnaire in a new tab, exactly as they see it.',
  release:'Make panel scores visible to the search committee. Until then each person sees only their own.',
  seal:'Hide panel scores again. Everyone sees only their own scores.',
  review:'Record that you checked this draft against its sources.',
  unreview:'Send this back to draft so it can be edited and reviewed again.',
  advanceSemi:'Move this candidate to semifinalist. It opens the semifinalist questionnaire step.',
  advanceFinal:'Move this candidate to finalist. Reference checks are for finalists only.',
  saveScores:'Save your ratings and your note to the file.',
  reloadSearch:'Fetch the latest saved version of this search from the server.',
  archive:'Move this search to Archived searches. Nothing is deleted and it can be restored.',
  replaceInvite:'Issue a new questionnaire link. The old one stops working immediately.',
  reopenSurvey:'Let this candidate answer again. The original response stays in history.',
  research:'Read public sources for this jurisdiction and fill the community profile and search facts.',
  premium:'Use the larger model for this draft. It costs more per draft.',
  weight:'How much this criterion counts, from 1 (least) to 5 (most).',
  score:'Rate this candidate against this criterion, from 1 (weakest) to 5 (strongest).',
  printPack:'Open the browser print dialog with only the printable packet on the page.',
  backTip:'Return to the screen you came from.'
};
/* ===========================================================================
 * Shared layout primitives
 *
 * One page header, section heading, form field, action bar, empty state and
 * rating group, used everywhere. Before DEP-13 each screen assembled its own
 * from `.sub`, `.row` and bare buttons, which is why no two forms had the same
 * geometry and every screen ended with a different arrangement of blue
 * buttons (D06, D09).
 * ========================================================================= */

function field(label, hint, control, opts={}){
  const req = opts.req ? '<span class="field__req" aria-hidden="true">*</span>' : '';
  return `<label class="field field--wide${opts.span?' field--span':''}">
    <span class="field__label">${label}${req}</span>
    ${control}
    ${hint?`<span class="field__hint">${hint}</span>`:''}
  </label>`;
}

// A heading inside a page, optionally with a count and its own actions.
function sectionHead(title, count='', actions=''){
  return `<div class="sechead">
    <h2 class="sechead__t">${esc(title)}</h2>
    ${count?`<span class="sechead__n">${esc(count)}</span>`:''}
    ${actions?`<span class="sechead__act">${actions}</span>`:''}
  </div>`;
}

/**
 * The one dominant action for a screen, with its save state beside it.
 *
 * Navigation stays secondary here: the audit found four blue buttons
 * competing on a single roster screen (D06).
 */
function actionBar(primary, secondary='', stateNote='', dirtyText=''){
  return `<div class="actionbar">
    ${primary}
    ${secondary}
    ${stateNote||dirtyText?`<span class="actionbar__state"${dirtyText?` data-dirty-text="${esc(dirtyText)}"`:''}>${stateNote}</span>`:''}
  </div>`;
}

/**
 * Sections within a screen.
 *
 * Real tabs: one stop in the tab order, arrows between the sections, and each
 * panel labelled by its own tab. Switching is done against the live DOM rather
 * than through a re-render, which is what keeps unsaved scores, a half-written
 * note, and the caret exactly where they were.
 */
function secTabs(group, items){
  const sel = (state.tab && state.tab[group]) || items[0].key;
  return `<div class="sectabs" role="tablist" aria-label="Sections">${items.map(i => {
    const on = i.key === sel;
    return `<button type="button" class="sectab" role="tab" id="tab-${esc(group)}-${esc(i.key)}"
      data-tab="${esc(group)}:${esc(i.key)}" aria-selected="${on}" aria-controls="panel-${esc(group)}-${esc(i.key)}"
      tabindex="${on?0:-1}">${esc(i.label)}</button>`;
  }).join('')}</div>`;
}

function setTab(group, key, { focus=true }={}){
  state.tab = { ...(state.tab||{}), [group]: key };
  const mark = group + ':' + key;
  $$('[data-tab^="'+group+':"]').forEach(b => {
    const on = b.dataset.tab === mark;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  $$('[data-tabpanel^="'+group+':"]').forEach(p => { p.hidden = p.dataset.tabpanel !== mark; });
  if (focus) $('[data-tab="'+mark+'"]')?.focus();
}

// Say so the moment something is edited, beside the control that saves it.
function markUnsaved(){
  const el = $('.actionbar__state[data-dirty-text]');
  if (!el || el.classList.contains('actionbar__state--dirty')) return;
  el.textContent = el.dataset.dirtyText;
  el.classList.add('actionbar__state--dirty');
}

function emptyState(title, body, actions=''){
  return `<div class="emptystate">
    <div class="emptystate__t">${esc(title)}</div>
    <div class="t-small">${body}</div>
    ${actions?`<div class="row">${actions}</div>`:''}
  </div>`;
}

/**
 * A 1–5 scale as a named group with its endpoints written out.
 *
 * A bare row of numbers is weak both visually and programmatically; a screen
 * reader announced five buttons called "1" through "5" with nothing saying
 * what they applied to or which end was better (D07).
 */
function ratingGroup(name, buttons, ends=''){
  return `<div class="rating">
    <div class="rating__scale" role="group" aria-label="${esc(name)}">${buttons}</div>
    ${ends?`<span class="rating__ends">${esc(ends)}</span>`:''}
  </div>`;
}

// A compact package choice with the full comparison behind a disclosure. The
// matrix used to run ahead of the client and position fields (D02).
function packageChoice(selected){
  const list = packages();
  if (!list.length) return '';
  const fallback = state.health?.defaultPackage || list[list.length-1].key;
  const on = list.some(p => p.key === selected) ? selected : fallback;
  const open = Boolean(state.open.pkgcompare);
  const cards = `<div class="pkgs" role="radiogroup" aria-label="Service package">${list.map(p => `
    <label class="pkg">
      <input type="radio" name="package" value="${esc(p.key)}" ${p.key===on?'checked':''}>
      <span class="pkg__hd"><span class="pkg__nm">${esc(p.label)}</span><span class="pkg__fee">${esc(p.fee)}</span></span>
      <span class="t-small">${esc(p.lede||'')}</span>
    </label>`).join('')}</div>`;
  return `<div class="stack stack--tight">
    ${cards}
    <div><button type="button" class="btn btn--ghost btn--sm" data-panel="pkgcompare" aria-expanded="${open}" aria-controls="pkgcompare" data-open-label="Compare what each level includes" data-close-label="Hide the comparison">${open?'Hide the comparison':'Compare what each level includes'}</button></div>
    <div id="pkgcompare"${open?'':' hidden'}>${packageMatrix(on, { plain:true })}</div>
  </div>`;
}
/**
 * The workspace page header.
 *
 * Compact and horizontal: the eyebrow, the title, and the screen's dominant
 * action on one line, with the explanation under it. The serif display face is
 * kept for the wordmark and for generated documents, which is why the title
 * here is a workspace type class rather than `.t-display`.
 */
function head(eyebrow, title, lede, actions=''){
  return `<div class="pagehead"><div class="wrap">
    ${backControl()}
    <div class="pagehead__row">
      <div class="pagehead__id">
        <div class="eyebrow">${esc(eyebrow)}</div>
        <h1 class="pagehead__title">${esc(title)}</h1>
      </div>
      ${actions?`<div class="pagehead__act">${actions}</div>`:''}
    </div>
    ${lede?`<p class="lede">${lede}</p>`:''}
  </div></div>`;
}

/**
 * A menu of infrequent actions.
 *
 * Corrections, archiving, and search settings do not belong beside the task
 * the screen is for, and they are not worth a row of competing buttons. They
 * collapse into one labelled control that opens a list.
 */
function menu(key, label, items){
  const list = items.filter(Boolean);
  if (!list.length) return '';
  const open = Boolean(state.open[key]);
  const id = 'menu-'+key;
  return `<span class="menu">
    <button type="button" class="btn btn--secondary btn--sm menu__btn" data-panel="${esc(key)}" aria-expanded="${open}" aria-controls="${id}">${esc(label)}${ico('more', 14)}</button>
    <span class="menu__list" id="${id}"${open?'':' hidden'}>${list.join('')}</span>
  </span>`;
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
    state.health = state.health || { ok:false };
  }
}

async function loadMe(){
  try {
    const me = await api('/api/me');
    state.user = me.user;
    state.users = me.users || [];
    state.health = Object.assign({}, state.health, me.health);
    return true;
  } catch (error) { state.user = null; state.authError = window.SlateAuth.signedIn ? error.message : null; return false; }
}
async function loadSearches(){ state.searches = await api('/api/searches'); state.searchesError = null; }

/**
 * Reconcile the search index without ever blanking it.
 *
 * The audit's D03: `createSearch()` updated `state.search` and Home rendered a
 * list that had not been refetched, so a search someone had just created was
 * missing and the counts still read zero. Home now refetches on entry and
 * after anything that changes the book. A failed refetch keeps the records
 * already on screen and says so, rather than showing an empty book.
 */
async function refreshSearches(){
  try { await loadSearches(); return true; }
  catch (error) { state.searchesError = error.message || 'The list could not be refreshed.'; return false; }
}
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

// The step the workspace is on right now, whether the view is the step itself
// or one of the screens that belong to it.
function isCurrentStep(key){
  return state.view===key
    || (state.view==='person' && key==='screen')
    || (state.view==='intake-mine' && key==='intake');
}

function railStepLink(st){
  const current = isCurrentStep(st.key);
  const label = (st.n || '')+' · '+(STEP_NAME[st.key] || st.t);
  const mark = st.status==='done' ? 'done' : st.blocked ? 'wait' : st.status==='now' ? 'now' : '';
  return `<button class="rail__link${mark?' rail__link--'+mark:''}" data-go="${st.key}" ${current?'aria-current="page"':''}>${esc(label)}</button>`;
}

// Phase groups collapse. Nineteen steps in one unbroken column is what pushed
// the heading 1,400px down the mobile workspace (D01); only the phase being
// worked opens by default, and a hand-set choice wins over that default.
function phaseIsOpen(id, here){
  return state.railOpen[id] === undefined ? here : Boolean(state.railOpen[id]);
}

function railPhaseGroups(search){
  const steps = (search.steps || []).filter(st => !isCommittee() || COMMITTEE_STEPS.has(st.key));
  const hasPeople = (search.candidates||[]).length > 0;
  return catalogPhases().map(p => {
    const list = steps.filter(st => st.phase===p.id);
    if (!list.length) return '';
    const wait = p.id===2 && !hasPeople;
    const done = list.filter(st => st.status==='done').length;
    const here = list.some(st => isCurrentStep(st.key));
    const open = phaseIsOpen(p.id, here);
    const id = 'railphase-'+p.id;
    return `<div class="rail__group${wait?' rail__group--later':''}">
      <button type="button" class="rail__toggle" data-phase="${p.id}" aria-expanded="${open}" aria-controls="${id}">
        <svg class="rail__caret" width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>
        <span class="rail__label">${esc(p.t)}</span>
        <span class="rail__tail">${done}/${list.length}${here?' · here':''}</span>
      </button>
      <div class="rail__steps" id="${id}"${open?'':' hidden'}>
        ${wait?`<div class="rail__hint">${isCommittee()?'Nothing to do here until candidates apply.':'Add people in Screening. The rest waits until someone is on the file.'}</div>`:''}
        ${list.map(railStepLink).join('')}
      </div>
    </div>`;
  }).join('');
}

// What the compact mobile bar says you are looking at, so the current search
// and destination stay visible with the drawer closed.
function shellContext(s){
  if (state.view === 'packages') return 'Sample · '+packageLabel(showcasePkg());
  if (!s) return state.view === 'new' ? 'New search' : state.view === 'archives' ? 'Archived searches' : 'Home';
  const dest = destOf();
  return (s.client || 'Search') + (dest ? ' · '+destLabel(dest) : '');
}

// One destination row: a mark, a label, and — where the destination is a
// pipeline — how much is in it. The selected row is the one the browser will
// announce as current.
function railDest(d){
  const on = destOf() === d.key;
  const tail = d.key === 'candidates' ? (state.search?.candidates||[]).length : '';
  return `<button class="rail__link rail__link--dest" data-go="${DEST_HOME[d.key]}" ${on?'aria-current="page"':''}>
    <span class="rail__ico">${ico(d.icon, 15)}</span>
    <span class="rail__label rail__label--dest">${esc(d.label)}</span>
    ${tail!=='' ? `<span class="rail__tail">${esc(String(tail))}</span>` : ''}
  </button>`;
}

// The account and theme controls, kept to the height of a row so the rail's
// working area is destinations rather than identity.
function railAccount(u, s){
  const seat = s && you().seat ? SEAT[you().seat]?.label || '' : '';
  const title = String(u.title || '').trim();
  const detail = title && seat && title.toLowerCase() !== seat.toLowerCase() ? title + ' · ' + seat : title || seat;
  return `<div class="acct">
    <div class="acct__avatar" data-clerk-user></div>
    <span class="acct__id"><span class="acct__nm">${esc(u.name)}</span>${detail?`<span class="acct__rl">${esc(detail)}</span>`:''}</span>
  </div>`;
}

function shell(body){
  // A closed search refuses every ordinary write at the server. Saying so once
  // at the top of whatever screen the user is on is the difference between a
  // deliberate freeze and a page whose Save button mysteriously fails.
  const frozen = frozenNotice();
  if (frozen) body = frozen + body;
  const warning = state.search?.staleArtifacts?.[state.view];
  if (warning) body = `<div class="notice notice--info" role="status">${esc(warning)}</div>` + body;
  const u = state.user, s = state.view==='packages' ? null : state.search;
  const settingsOpen = Boolean(state.open.railmore);
  return `<div class="shell${state.busy?' busy':''}${state.navOpen?' shell--navopen':''}">
    <a class="skip" href="#main" data-act="skip">Skip to content</a>
    <header class="appbar">
      <button type="button" class="appbar__menu" data-act="nav-toggle" aria-expanded="${state.navOpen}" aria-controls="rail">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12"/></svg>
        <span>Menu</span>
      </button>
      <span class="appbar__ctx">${esc(shellContext(s))}</span>
    </header>
    <div class="scrim" data-act="nav-close" ${state.navOpen?'':'hidden'}></div>
    <nav class="rail" id="rail" aria-label="Primary">
      <div class="rail__head">
      <div class="rail__brand">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="u-accent" aria-hidden="true"><path d="M4 20h16M6 20V9l6-4 6 4v11M10 20v-5h4v5"/></svg>
        <span class="rail__name">Slate</span><span class="rail__ver">Live</span>
      </div>
      <button type="button" class="rail__close" data-act="nav-close" aria-label="Close navigation">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>
      </button>
      </div>
      <div class="rail__group"><div class="rail__label">Workspace</div>
        <button class="rail__link" data-go="home" ${!s && state.view==='home'?'aria-current="page"':''}>Home</button>
        ${!isCommittee() ? '<button class="rail__link" data-go="new" '+(state.view==='new'?'aria-current="page"':'')+'>New search</button>' : ''}
        ${!isCommittee() ? '<button class="rail__link" data-go="archives" '+(state.view==='archives'?'aria-current="page"':'')+'>Archived searches</button>' : ''}
        ${!isCommittee() && packages().length ? `<button class="rail__link" data-go="packages" ${state.view==='packages'?'aria-current="page"':''}>Packages</button>` : ''}
      </div>
      ${s?`<div class="rail__group rail__group--dests">
        <div class="rail__here" title="${esc(s.client||'Search')}">
          <span class="rail__here-nm">${esc(s.client||'Search')}</span>
          <span class="rail__here-sub">${esc(s.position||'')}</span>
        </div>
        ${availableDests().map(railDest).join('')}
        <button class="rail__link rail__link--dest" data-go="process" ${state.view==='process'?'aria-current="page"':''}>
          <span class="rail__ico">${ico('list', 15)}</span>
          <span class="rail__label rail__label--dest">Process checklist</span>
          <span class="rail__tail">${s.progress ? s.progress.done+'/'+s.progress.total : ''}</span>
        </button>
        ${canEdit() ? `<button type="button" class="rail__link rail__more" data-panel="railmore" aria-expanded="${settingsOpen}" aria-controls="railmore" data-open-label="Search settings" data-close-label="Search settings">
          <span class="rail__ico">${ico('more', 15)}</span>
          <span class="rail__label rail__label--dest">Search settings</span>
        </button>
        <div class="rail__steps" id="railmore"${settingsOpen?'':' hidden'}>
          <button class="rail__link rail__link--sub" data-go="facts" ${state.view==='facts'?'aria-current="page"':''}>Search facts</button>
          <button class="rail__link rail__link--sub" data-go="history" ${state.view==='history'?'aria-current="page"':''}>History and recovery</button>
          <button class="rail__link rail__link--sub" data-act="reload-search">Reload search</button>
        </div>` : ''}
      </div>`:''}
      <div class="rail__foot">
        ${railAccount(u, s)}
        <div class="themeswap" role="group" aria-label="Theme">
          <button type="button" data-theme="light">Light</button>
          <button type="button" data-theme="auto">Auto</button>
          <button type="button" data-theme="dark">Dark</button>
        </div>
      </div>
    </nav>
    <main class="page" id="main" tabindex="-1">
      <div class="masthead"><div class="wrap"><div class="masthead__in">
        <nav class="crumbs" id="crumbs" aria-label="Breadcrumb"></nav>
        <span class="mono mast__id">${state.view==='packages'?'SAMPLE · '+esc(packageLabel(showcasePkg())):(s?esc(s.no)+' · '+esc(s.position)+(s.package?' · '+esc(packageLabel(s.package)):''):'Slate')}</span>
      </div></div></div>
      ${body}
    </main>
  </div>`;
}

// What screen the user is on, in one phrase. Feeds both the breadcrumb tail
// and the document title, so a browser tab and a screen-reader announcement
// name the actual step rather than the product.
function viewLabel(){
  const v = state.view;
  if (v === 'packages') return 'Packages · '+packageLabel(showcasePkg());
  if (v === 'home') return 'Home';
  if (v === 'new') return 'New search';
  if (v === 'archives') return 'Archived searches';
  if (v === 'history') return 'History and recovery';
  if (v === 'facts') return 'Search facts';
  if (v === 'overview') return 'Overview';
  if (v === 'interviews') return 'Interviews';
  if (v === 'committee') return 'Committee';
  if (v === 'documents') return 'Documents';
  if (v === 'activity') return 'Activity';
  if (v === 'process') return 'Process checklist';
  if (v === 'screen' || v === 'people') return 'Candidates';
  if (v === 'person'){
    const c = (state.search?.candidates||[]).find(x => x.id === state.sel);
    return c ? c.name : 'Candidate';
  }
  const key = v === 'intake-mine' ? 'intake' : v === 'people' ? 'screen' : v;
  const st = stepOf(key);
  const name = STEP_NAME[key] || DRAFTS[key]?.title || STAFF[key]?.title;
  if (!name) return 'Slate';
  return st?.n ? 'Step '+st.n+' · '+name : name;
}

function crumbs(){
  const el = $('#crumbs');
  if (!el) return;
  const s = state.search;
  const tail = state.view==='home' ? '' : `<span class="dot"></span><span aria-current="page"><b>${esc(viewLabel())}</b></span>`;
  // The same destination mapping the rail marks, so a breadcrumb never names a
  // section the navigation is not showing as current.
  const dest = s ? destOf() : null;
  const destCrumb = dest && dest !== 'overview' && destLabel(dest) !== viewLabel()
    ? `<span class="dot"></span><button type="button" data-go="${DEST_HOME[dest]}">${esc(destLabel(dest))}</button>` : '';
  el.innerHTML = `<button type="button" data-go="home">Home</button>` +
    (state.view==='packages' ? `<span class="dot"></span><span>Packages</span>` :
    (s ? `<span class="dot"></span><button type="button" data-go="overview">${esc(s.client||'Search')}</button>` : '')) +
    destCrumb + tail;
  document.title = state.user
    ? (state.view==='home' ? 'Home' : viewLabel()) + (s ? ' · '+(s.client||'Search') : '') + ' · Slate'
    : 'Slate — Executive Search';
}

function vGate(){
  const controls = window.SlateAuth.signedIn
    ? '<div class="auth-profile"><div data-clerk-user></div><button class="btn btn--ghost" data-act="logout">Sign out</button></div>'
    : `<div class="row"><button class="btn btn--ghost" data-act="sign-in" ${state.authError?'disabled':''}>Sign in</button><button class="btn btn--primary" data-act="sign-up" ${state.authError?'disabled':''}>Sign up</button></div>`;
  return `<div class="gate">
    <header class="gate__bar">
      <div class="login__brand">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="u-accent" aria-hidden="true"><path d="M4 20h16M6 20V9l6-4 6 4v11M10 20v-5h4v5"/></svg>
        <span class="rail__name">Slate</span>
      </div>
      ${controls}
    </header>
    <div class="wrap gate__hero">
      <h1 class="t-title">A guided executive search</h1>
      <p class="t-body">Every engagement seats the search committee, asks each member what they are looking for, and builds the candidate profile from their answers. Recruiting, screening, and interviews all run against that profile.</p>
    </div>
    <div class="wrap gate__table stack">
      <p class="t-body">Sign in to work with your search team. New here? Create an account using the email on your invitation.</p>${state.authError ? `<p role="alert">${esc(state.authError)}</p><button class="btn" data-act="auth-retry">Try again</button>` : ''}
    </div>
  </div>`;
}

// A committee member's home is a to-do list, not a book of business. If a
// window is open and they have not answered, that is the whole page.
function vHomeCommittee(){
  const list = state.searches || [];
  const owed = list.filter(s => s.intakeOpen && !s.intakeMine);
  const rows = list.map(s => `<tr>
    <th scope="row"><button type="button" class="candlink" data-open="${s.id}">${esc(s.client||'Untitled')}</button>
      <span class="candmeta">${esc(s.position||'')}${s.accountManager?' · '+esc(s.accountManager.name):''} · <span class="mono">${esc(s.no)}</span></span>
      ${summaryDeadline(s)?`<span class="candmeta">${esc(summaryDeadline(s))}</span>`:''}</th>
    <td data-label="Your part">${s.intakeOpen
      ? (s.intakeMine ? pill('ok','Answers in') : pill('wait','Waiting on you'))
      : (s.intakeMine ? pill('ok','Answers on file') : pill('idle','Nothing needed'))}</td>
    <td data-label="Open" class="candacts"><button class="btn btn--secondary btn--sm" data-open="${s.id}">Open</button></td>
  </tr>`).join('');
  return shell(`
    ${head('Workspace','Your assignments',
      'You are on '+(list.length===1?'a search':list.length+' searches')+' as a committee member. You are asked what you are looking for in the executive, and later you score candidates against what the committee agreed on.',
      owed.length ? `<button class="btn btn--primary" data-open="${owed[0].id}">Answer for ${esc(owed[0].client)}</button>` : '')}
    <div class="band"><div class="wrap stack">
      ${searchesNotice()}
      ${owed.length ? `<div class="spec"><div class="spec__bar">Waiting on you · ${owed.length}</div>
        <div class="spec__body stack stack--tight">${owed.map(s => `<div class="hubrow">
          <div class="hubrow__id"><b>${esc(s.client||'')} · ${esc(s.position||'')}</b>
            <div class="t-small">The committee is being asked what to look for in the next ${esc(s.position||'executive')}. Answer for yourself; nobody sees your answers until the window closes.${s.intakeDue?' <b>'+esc(summaryDeadline(s))+'.</b>':''}</div></div>
          <div class="hubrow__st"></div>
          <div class="hubrow__act"><button class="btn btn--primary btn--sm" data-open="${s.id}">Answer now</button></div>
        </div>`).join('')}</div>
      </div>` : ''}
      <div class="spec"><div class="spec__bar">Your searches · ${list.length}</div>
        <div class="spec__body spec__body--flush">${list.length ? `<div class="tablewrap"><table class="candtable hometable">
          <thead><tr><th scope="col">Search</th><th scope="col">Your part</th><th scope="col">Open</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>` : `<div class="empty">${emptyState('Nothing yet','When a consultant seats you on a search, it appears here.')}</div>`}</div>
      </div>
    </div></div>`);
}

// Shown when the search index could not be refreshed. The records already
// loaded stay on the page; this says they may be out of date and offers a
// retry, rather than replacing the book with an empty state.
function searchesNotice(){
  if (!state.searchesError) return '';
  return `<div class="notice notice--wait" role="status"><div>
    <div class="notice__t">This list may be out of date</div>
    <div class="notice__b">${esc(state.searchesError)} The searches below are the ones last loaded.
      <button class="btn btn--secondary btn--sm" data-act="retry-searches">Try again</button></div>
  </div></div>`;
}

function pickedIds(){
  const known = new Set((state.searches||[]).map(s => s.id));
  return (state.picked||[]).filter(id => known.has(id));
}

/**
 * The phase a portfolio row is in.
 *
 * Home reads the summary the index returns, not a loaded search, so this works
 * from `progress.next` alone and says "Complete" when there is no next step.
 */
function summaryPhase(s){
  const next = s.progress?.next;
  if (!next) return 'Complete';
  const phase = catalogPhases().find(p => p.id === next.phase);
  return phase ? (PHASE_SHORT[phase.key] || phase.t) : '';
}

// The only date the portfolio actually has is the committee intake deadline,
// and only while the window is open. It is labelled by what it is, never
// presented as a general hiring milestone and never described as overdue,
// because nothing here stores a hiring milestone or compares the date to now.
function summaryDeadline(s){
  return s.intakeOpen && s.intakeDue ? 'Committee intake due ' + s.intakeDue : '';
}

function homeQuery(){
  return String(state.homeQ || '');
}

function matchesHomeQuery(s){
  const q = homeQuery().trim().toLowerCase();
  if (!q) return true;
  return [s.client, s.position, s.no, s.accountManager?.name]
    .some(v => String(v||'').toLowerCase().includes(q));
}

function vHome(){
  if (isCommittee()) return vHomeCommittee();
  const u = state.user;
  const canDelete = u.role==='consultant';
  const list = state.searches || [];
  const shown = list.filter(matchesHomeQuery);
  const picked = pickedIds();
  state.picked = picked;
  const allPicked = shown.length > 0 && shown.every(s => picked.includes(s.id));
  const complete = list.filter(s => s.progress && s.progress.done >= s.progress.total).length;
  const live = list.length - complete;
  const pickup = list.find(s => s.progress?.next);
  const owed = list.filter(s => s.intakeOpen && s.seat && !s.intakeMine);
  const manage = canDelete && Boolean(state.open.homemanage);
  const managed = list.filter(s => s.seat === 'manager');

  const rows = shown.map(s => {
    const n = s.progress?.next;
    const on = picked.includes(s.id);
    const counts = s.candidateCounts;
    const due = summaryDeadline(s);
    return `<tr${on?' class="is-picked"':''}>
      ${manage?`<td class="pickcell"><input type="checkbox" data-pick-search="${s.id}" ${on?'checked':''} aria-label="Select ${esc(s.client||s.no||'this search')}"></td>`:''}
      <th scope="row"><button type="button" class="candlink" data-open="${s.id}">${esc(s.client||'Untitled')}</button>
        <span class="candmeta">${esc(s.position||'')}${s.packageLabel?' · '+esc(s.packageLabel):''} · <span class="mono">${esc(s.no)}</span></span>
        ${due?`<span class="candmeta">${esc(due)}</span>`:''}</th>
      <td data-label="Phase">${esc(summaryPhase(s))}</td>
      <td data-label="Candidates" class="tnum">${counts
        ? `<b>${counts.total}</b>${counts.total?`<span class="candmeta">${counts.semifinalist+counts.finalist} advanced · ${counts.responses} answered</span>`:''}`
        : '<span class="t-small">Not on this package</span>'}</td>
      <td data-label="Account manager">${s.accountManager?esc(s.accountManager.name):'<span class="t-small">Unassigned</span>'}${s.seats>1?' <span class="t-small">+'+(s.seats-1)+'</span>':''}</td>
      <td data-label="Next action">${n?esc(STEP_NAME[n.key]||n.t):'<span class="t-small">Every step complete</span>'}</td>
      ${manage?`<td data-label="" class="candacts"><button class="btn btn--danger btn--sm" data-act="delete-search" data-id="${s.id}" data-name="${esc(s.client||s.no||'this search')}">Archive</button></td>`:''}
    </tr>`;
  }).join('');

  // What is actually waiting on this person, in the order they would pick it
  // up. Home used to open on repeated identity tiles and a duplicate New
  // search button instead (D08).
  const waiting = [
    ...owed.map(s => ({ id:s.id, t:'Answer committee intake', b:esc(s.client||s.no)+' · '+esc(s.position||'')
      + (s.intakeDue ? ' · '+esc(summaryDeadline(s)) : ''), cta:'Answer now' })),
    ...(pickup && !owed.some(o => o.id === pickup.id)
      ? [{ id:pickup.id, t:STEP_NAME[pickup.progress.next.key] || pickup.progress.next.t,
           b:esc(pickup.client||'Untitled')+' · '+esc(pickup.position||''), cta:'Open this search' }]
      : [])
  ];

  const cols = 5 + (manage ? 2 : 0);
  return shell(`
    ${head('Workspace','Your searches',
      list.length ? esc(live)+' in progress, '+esc(complete)+' complete.' : 'Nothing on the book yet.',
      u.role==='consultant' ? `<button class="btn btn--primary" data-go="new">Open a new search</button>` : '')}
    <div class="band"><div class="wrap stack">
      ${searchesNotice()}
      ${waiting.length ? `<div class="spec"><div class="spec__bar">Waiting on you · ${waiting.length}</div>
        <div class="spec__body stack stack--tight">${waiting.map(w => `<div class="hubrow">
          <div class="hubrow__id"><b>${w.t}</b><div class="t-small">${w.b}</div></div>
          <div class="hubrow__st"></div>
          <div class="hubrow__act"><button class="btn btn--primary btn--sm" data-open="${w.id}">${esc(w.cta)}</button></div>
        </div>`).join('')}</div>
      </div>` : ''}
      ${list.length ? `<div class="listbar">
        ${field('Find a search','', `<input class="input" id="home-filter" data-homefilter type="search" data-nodirty placeholder="Client, position, number, or manager" value="${esc(homeQuery())}">`)}
        ${homeQuery() ? `<div class="listbar__act"><button type="button" class="btn btn--secondary" data-act="clear-home-filter">Clear filter</button></div>` : ''}
      </div>` : ''}
      <div class="spec"><div class="spec__bar">Active searches · ${shown.length}${list.length!==shown.length?' of '+list.length:''}${canDelete && list.length ? `<span class="spec__bar-act">
          ${manage ? `<button type="button" class="btn btn--ghost btn--sm" data-act="pick-all">${allPicked?'Clear':'Select all'}</button>
          ${withTip(`<button type="button" class="btn btn--danger btn--sm" data-act="delete-searches" ${picked.length?'':'disabled'}>Archive selected${picked.length?' · '+picked.length:''}</button>`, TIPS.archive)}` : ''}
          <button type="button" class="btn btn--ghost btn--sm" data-act="home-manage">${manage?'Done':'More'}</button>
        </span>` : ''}</div>
        <div class="spec__body spec__body--flush">${list.length ? `<div class="tablewrap"><table class="candtable hometable">
          <thead><tr>${manage?'<th scope="col"><span class="u-sr">Select</span></th>':''}<th scope="col">Search</th><th scope="col">Phase</th><th scope="col">Candidates</th><th scope="col">Account manager</th><th scope="col">Next action</th>${manage?'<th scope="col"><span class="u-sr">Archive</span></th>':''}</tr></thead>
          <tbody>${rows || `<tr><td colspan="${cols}">No search matches “${esc(homeQuery())}”. <button type="button" class="btn btn--ghost btn--sm" data-act="clear-home-filter">Clear filter</button></td></tr>`}</tbody>
        </table></div>` : `<div class="empty">${emptyState('No searches yet',
          'A search starts by seating the committee and asking each member what they are looking for. The profile is built from their answers, and everything else is generated from that.',
          u.role==='consultant' ? `<button class="btn btn--primary" data-go="new">Open a new search</button>` : '')}</div>`}</div>
      </div>
      <div class="row"><button class="btn btn--secondary btn--sm" data-go="archives">Archived searches</button></div>
      ${canDelete && managed.length ? `<div class="spec">
        <div class="spec__bar">Start fresh</div>
        <div class="spec__body stack stack--tight">
          <p>Archive the ${managed.length === 1 ? 'search you manage' : managed.length+' searches you manage'} and open a new search. Your account and Clerk login stay active. Other consultants' searches stay on the book.</p>
          <p class="t-small">Archived searches leave the active workspace for everyone on their committees. You can restore them from Archived searches.</p>
          <div class="row"><button type="button" class="btn btn--secondary btn--sm" data-act="start-fresh">Start fresh</button></div>
        </div>
      </div>` : ''}
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
  const moreOpen = Boolean(state.open.newmore);
  return shell(`
    ${head('New search','Who is hiring, and for what','Open the file, then seat the search committee. The profile comes after the committee has told you what they are looking for.')}
    <div class="band"><div class="wrap"><form id="newsearch" class="stack">
      ${/* The service package is not asked for here. A new file opens on the
            default level and the package is set on Search facts, except when
            the search was started from a package sample, which carries its
            choice through on this hidden field. */
        state.newPackage ? `<input type="hidden" name="package" value="${esc(state.newPackage)}">` : ''}
      ${sectionHead('The client', 'Required')}
      <div class="formgrid">
        ${field('Client jurisdiction','Official county, city, or town name.', `<input class="input" name="client" required placeholder="${esc(jurisdiction.clientPlaceholder)}">`, { req:true })}
        ${field('Position','The title being recruited.', `<input class="input" name="position" required placeholder="${esc(jurisdiction.positionPlaceholder)}">`, { req:true })}
        ${jurisdictionPicker(jurisdiction.key)}
        ${field('State','', `<input class="input" name="state" placeholder="Colorado">`)}
      </div>
      ${sectionHead('Research details', 'Optional', `<button type="button" class="btn btn--ghost btn--sm" data-panel="newmore" aria-expanded="${moreOpen}" aria-controls="newmore" data-open-label="Add these now" data-close-label="Hide these">${moreOpen?'Hide these':'Add these now'}</button>`)}
      <p class="t-small">None of this is needed to open the file. Research fills most of it later from public sources.</p>
      <div id="newmore"${moreOpen?'':' hidden'}>
        <div class="formgrid">
          ${field(jurisdiction.key==='county'?'County website':'City or town website','Saved now. Looked up once the profile is adopted.', `<input class="input" name="website" type="url" placeholder="https://">`)}
          ${field('Form of government','Use the jurisdiction’s official structure.', `<input class="input" name="fog" placeholder="${esc(jurisdiction.governmentPlaceholder)}">`)}
          ${field('Population','', `<input class="input" name="population" placeholder="18,400">`)}
          ${field('Operating budget','', `<input class="input" name="budget" placeholder="$34M general fund">`)}
          ${field('Salary range','', `<input class="input" name="salary" placeholder="$165,000–$195,000">`)}
          ${field('First review date','', `<input class="input" name="firstReview" placeholder="14 Sep 2026">`)}
          ${field('Notes from the governing body','Paste workshop notes. Used to draft the profile.', `<textarea class="input ed" name="notes" placeholder="Structural deficit, three director vacancies, deferred water mains…"></textarea>`, { span:true })}
        </div>
      </div>
      ${actionBar(
        `<button class="btn btn--primary" type="submit" form="newsearch">Create search</button>`,
        `<button type="button" class="btn btn--secondary" data-go="home">Cancel</button>`,
        packages().length
          ? 'Opens at the '+esc(packageLabel(state.newPackage || state.health?.defaultPackage))+' level. Change that on Search facts.'
          : 'Opens the file and takes you to the search committee.')}
    </form></div></div>`);
}

function nextHint(next){
  if (!next) return '';
  if (next.blocked) {
    if (next.needsCandidates) return 'Add a candidate in Screening first. Later steps wait until someone is on the file.';
    return 'Finish the earlier step first. Later documents are only as good as the profile they inherit.';
  }
  const hints = {
    team:'Seat every governing-body or committee member who gets a say, and name the account manager. People on the roster are included in the search.',
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

// Which included step is holding this one up, named rather than described as
// "an earlier step". Only steps this viewer may open are offered as a link.
function blockingStep(st, search){
  if (!st.blocked) return null;
  if (st.needsCandidates && !((search.candidates||[]).length)) return { key:'screen', name:STEP_NAME.screen };
  const pending = (st.needs||[]).map(k => (search.steps||[]).find(x => x.key===k))
    .find(x => x && x.status !== 'done');
  return pending ? { key:pending.key, name:STEP_NAME[pending.key] || pending.t } : null;
}

function stepsList(steps, search){
  return `<div class="steps">${(steps||[]).map(st => {
    const block = blockingStep(st, search);
    const why = block
      ? `Waiting on ${esc(block.name)}.` + (canOpenStep(block.key) ? ' ' : '')
      : esc(stepWaitCopy(st, search));
    return `
    <div class="step ${st.status==='done'?'step--done':st.status==='now'?'step--now':''}">
      <div class="step__n">${String(st.n).padStart(2,'0')}</div>
      <div>
        <div class="step__t">${esc(st.t)}${st.opt?' '+pill('idle','Optional'):''}${st.kind==='staff'?' '+pill('info','Staff work'):''}</div>
        <div class="t-small">${why}</div>
        <div class="step__foot">
          ${block && canOpenStep(block.key) ? openBtn(block.key, 'Open '+block.name) : ''}
          ${!block ? openBtn(st.key, st.status==='done' ? 'Open' : 'Open this step', st.status==='now') : ''}
        </div>
      </div>
    </div>`;
  }).join('')}
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
  const all = s.activity || [];
  return `<div class="spec"><div class="spec__bar">Recent activity${state.preview?'':`<span class="spec__bar-act"><button class="btn btn--ghost btn--sm" data-go="activity">See all ${all.length}</button></span>`}</div>
    <div class="spec__body"><div class="feed">${all.slice(0,6).map(a=>`
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

/**
 * Work that is open on this search, in one place.
 *
 * The overview used to repeat the process already visible in the rail and put
 * package detail ahead of anything actionable (D08). This reads the state the
 * server already reports — intake tally, review status, stale sources — rather
 * than inventing new metrics.
 */
function outstandingPanel(s){
  const items = [];
  const pending = s.consensus?.pending || [];
  if (s.intake?.status === 'open' && pending.length){
    items.push({ t: pending.length+' committee member'+(pending.length===1?' has':'s have')+' not answered intake',
      b: pending.map(p => esc(p.name || p)).join(', '), key:'intake', cta:'Open committee input' });
  }
  for (const [key, warning] of Object.entries(s.staleArtifacts || {})){
    if (!stepOf(key)) continue;
    items.push({ t:(STEP_NAME[key]||DRAFTS[key]?.title||key)+' needs another look', b:esc(warning), key, cta:'Open it' });
  }
  const needsReview = (state.health?.reviewSteps || []).filter(key =>
    stepOf(key) && s.artifacts?.[key] && (s.reviews||{})[key]?.status !== 'approved' && !s.staleArtifacts?.[key]);
  for (const key of needsReview){
    items.push({ t:(STEP_NAME[key]||DRAFTS[key]?.title||key)+' is drafted but not reviewed',
      b:'A consultant marks it reviewed before it goes out.', key, cta:'Review it' });
  }
  const blocked = (s.steps||[]).filter(st => st.blocked && st.needsCandidates).length;
  if (blocked && !(s.candidates||[]).length){
    items.push({ t:blocked+' step'+(blocked===1?'':'s')+' wait until someone is on the file',
      b:'Add candidates in Screening when applications come in.', key:'screen', cta:'Open screening' });
  }
  if (!items.length) return '';
  return `<div class="spec"><div class="spec__bar">Outstanding · ${items.length}</div>
    <div class="spec__body stack stack--tight">${items.map(i => `<div class="hubrow">
      <div class="hubrow__id"><b>${esc(i.t)}</b><div class="t-small">${i.b}</div></div>
      <div class="hubrow__st"></div>
      <div class="hubrow__act">${openBtn(i.key, i.cta)}</div>
    </div>`).join('')}</div></div>`;
}

/**
 * Where the candidates stand, as the way into the list.
 *
 * The four stages are the ones the product actually stores. Nothing here
 * invents an Interview, Offer or Hired state, and declined is an outcome shown
 * beside the pipeline rather than a stage inside it. Each count opens the list
 * already filtered to it.
 */
const STAGE_LABEL = { applicant:'Applicants', semifinalist:'Semifinalists', finalist:'Finalists', declined:'Declined' };
const STAGE_ONE = { applicant:'Applicant', semifinalist:'Semifinalist', finalist:'Finalist', declined:'Declined' };
const STAGE_ORDER = ['applicant','semifinalist','finalist','declined'];

function stageTallies(list){
  const by = stage => list.filter(x => x.stage===stage).length;
  return [{ key:'', label:'All', n:list.length }]
    .concat(STAGE_ORDER.map(k => ({ key:k, label:STAGE_LABEL[k], n:by(k) })));
}

// The stage counts as a way in. `mode` is 'link' on the overview, where a
// count opens the list, and 'filter' on the list itself, where it selects.
function stageBar(items, selected, mode){
  return `<div class="stagebar" role="group" aria-label="Candidate stages">${items.map(i => {
    const on = (selected||'') === i.key;
    const attrs = mode==='filter'
      ? `data-act="stage-filter" data-stage="${esc(i.key)}" aria-pressed="${on}"`
      : `data-act="stage-open" data-stage="${esc(i.key)}"`;
    return `<button type="button" class="stagebar__i${on?' stagebar__i--on':''} stagebar__i--${i.key||'all'}" ${attrs}>
      <span class="stagebar__n">${i.n}</span>
      <span class="stagebar__l">${esc(i.label)}</span>
    </button>`;
  }).join('')}</div>`;
}

function candidatePanel(s){
  if (!stepOf('screen')) return '';
  const c = s.candidates || [];
  const responses = c.filter(x => x.survey1).length;
  return `<div class="spec"><div class="spec__bar">Candidates${state.preview?'':`<span class="spec__bar-act">${openBtn('screen', c.length ? 'Open the list' : 'Add the first candidate')}</span>`}</div>
    <div class="spec__body">
      ${c.length ? `${state.preview
          ? stageBar(stageTallies(c), '', 'list').replace(/data-act="stage-open"/g, 'disabled')
          : stageBar(stageTallies(c), '', 'list')}
        <p class="t-small u-mt-3">${responses} of ${c.length} ${c.length===1?'has':'have'} answered the initial questionnaire.</p>`
        : `<p class="t-small">Nobody on the file yet.</p>`}
    </div></div>`;
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
  // The sample keeps its tiles and its "where this file is" card, because a
  // client is being shown the shape of a pay level rather than working a file.
  if (preview){
    const steps = view.steps === 'strip' ? stepStrip(s) : phaseSpecs(s);
    return `${overviewTiles(s, next, view)}
      ${nextCard}
      ${candidatePanel(s)}
      ${panels}
      ${activityPanel(s)}
      ${steps}
      ${packagePanel(s)}`;
  }
  // A committee member with nothing open should be told so, rather than left
  // to read an empty page as a fault.
  const idle = isCommittee() && !next
    ? `<div class="notice notice--info" role="status"><div>
        <div class="notice__t">Nothing needed from you right now</div>
        <div class="notice__b">The search team is working the file. You will be asked to score candidates once screening opens.</div>
      </div></div>` : '';
  return `${idle}
      ${outstandingPanel(s)}
      ${candidatePanel(s)}
      ${panels}
      ${activityPanel(s)}`;
}

// The phase of the process this search is in, said in two words. It is not the
// candidate stage and it is not the step count; those are different questions
// and they are answered elsewhere on the page. The catalog's own phase titles
// are sentences, which do not read as a header eyebrow.
const PHASE_SHORT = { convene:'Committee phase', recruit:'Recruiting phase', people:'Candidate phase' };
function processPhase(s){
  const next = s.progress?.next;
  if (!next) return 'Search complete';
  const phase = catalogPhases().find(p => p.id === next.phase);
  return phase ? (PHASE_SHORT[phase.key] || phase.t) : '';
}

function vOverview(){
  const s = state.search;
  const next = nextForViewer(s);
  const view = overviewView(s);
  const hint = next ? nextHint(next) : '';
  // One next action, in the action area, once. It used to appear in a header
  // button, a metric tile, a rail message and a full-width panel at the same
  // time, which is four places to read the same sentence.
  const primary = next
    ? withTip(`<button class="btn btn--primary" data-go="${peopleView(next.key)}">Continue: ${esc(STEP_NAME[next.key] || next.t)}</button>`, hint)
    : (isCommittee() ? '' : `<span class="pill pill--ok">Every included step is complete</span>`);
  return shell(`
    ${head(`${s.no} · ${processPhase(s)}`, s.position || 'Untitled position',
      `${esc(s.client||'the client')}${s.fog?' · '+esc(s.fog):''} ${packagePill(s.package)}`,
      `${primary}
       ${menu('ovmore','More', [
         canEdit() ? `<button class="btn btn--ghost btn--sm" data-go="facts">Search facts</button>` : '',
         canEdit() ? `<button class="btn btn--ghost btn--sm" data-go="verify">County fact verification</button>` : '',
         `<button class="btn btn--ghost btn--sm" data-go="process">Process checklist</button>`,
         canEdit() ? `<button class="btn btn--ghost btn--sm" data-go="closeout">${isFrozen(s)?'Closeout and reopening':'Close this search'}</button>` : '',
         canEdit() ? `<button class="btn btn--ghost btn--sm btn--danger" data-act="delete-search" data-id="${s.id}" data-name="${esc(s.client||s.no||'this search')}">Archive search</button>` : ''
       ])}`)}
    <div class="band"><div class="wrap stack">
      ${overviewInner(s)}
    </div></div>`);
}

/* ===========================================================================
 * Destination hubs
 *
 * Interviews, Committee, Documents and Activity are windows onto work that
 * already exists. They add no capability and no data: each one reads the same
 * server-decorated search the steps read, and every link is the existing
 * route, gated by the existing package and role checks.
 * ========================================================================= */

// One row in a hub: what the thing is, where it stands, and the way in.
function hubRow(title, body, status, actions){
  return `<div class="hubrow">
    <div class="hubrow__id"><b>${esc(title)}</b><div class="t-small">${body}</div></div>
    <div class="hubrow__st">${status||''}</div>
    <div class="hubrow__act">${actions||''}</div>
  </div>`;
}

function vProcess(){
  const s = state.search;
  const list = (s.steps||[]).filter(st => !isCommittee() || COMMITTEE_STEPS.has(st.key));
  const left = isCommittee() ? [] : stepsLeftOut(s.package);
  return shell(`
    ${head('This search','Process checklist',
      `${s.progress.done} of ${s.progress.total} included step${s.progress.total===1?'':'s'} complete. Every step on this file is listed here with what it is waiting on.`)}
    <div class="band"><div class="wrap stack">
      ${catalogPhases().map(p => {
        const phase = list.filter(st => st.phase===p.id);
        if (!phase.length) return '';
        return `<div class="spec"><div class="spec__bar">${esc(p.t)} · ${phase.filter(st=>st.status==='done').length}/${phase.length}</div>
          <div class="spec__body"><p class="t-small u-mb-4">${esc(p.lede)}</p>${stepsList(phase, s)}</div></div>`;
      }).join('')}
      ${left.length ? `<div class="spec"><div class="spec__bar">Not on this file</div>
        <div class="spec__body"><p class="t-small">The ${esc(packageLabel(s.package))} package does not include ${left.map(st => esc(STEP_NAME[st.key]||st.t)).join(', ')}.${canEdit()?' Change the package on Search facts if the engagement changed.':''}</p>
        ${canEdit()?`<div class="row u-mt-3"><button class="btn btn--secondary btn--sm" data-go="facts">Open Search facts</button></div>`:''}</div></div>` : ''}
    </div></div>`);
}

function vActivity(){
  const s = state.search;
  const feed = s.activity || [];
  return shell(`
    ${head('This search','Activity','Everything recorded on this file, most recent first. Names are the account that took the action.')}
    <div class="band"><div class="wrap stack">
      <div class="spec"><div class="spec__bar">Activity · ${feed.length}</div>
        <div class="spec__body">${feed.length ? `<div class="feed">${feed.map(a => `
          <div class="feed__i"><span class="feed__w">${esc(a.who)}</span><span class="feed__x">${esc(a.x)}</span><span class="feed__t">${esc((a.at||'').slice(0,10))}</span></div>`).join('')}</div>`
          : emptyState('Nothing recorded yet','Actions appear here as the search is worked.')}</div></div>
      ${canEdit() ? `<div class="spec"><div class="spec__bar">Recovery</div>
        <div class="spec__body stack stack--tight">
          <p class="t-small">Previous copy, evaluations, and saved document revisions are kept separately from this timeline, because restoring one changes the file.</p>
          <div class="row"><button class="btn btn--secondary btn--sm" data-go="history">Open history and recovery</button></div>
        </div></div>` : ''}
    </div></div>`);
}

function vCommittee(){
  const s = state.search;
  const intake = stepState('intake');
  const agg = s.consensus;
  const roster = s.roster || [];
  const answered = agg ? agg.submitted : Object.values(s.intake?.submissions||{}).filter(x => x && x.submitted).length;
  const seated = Boolean(you().seat);
  const open = s.intake?.status === 'open';
  const mine = mySubmission();
  const crit = (s.criteria||[]).filter(c => c.label).length;
  const due = s.intake?.dueBy || '';
  return shell(`
    ${head('This search','Committee',
      'Who is seated, what they were asked, and the profile their answers produced.',
      seated && open && !(mine && mine.submitted) && canOpenStep('intake')
        ? `<button class="btn btn--primary" data-go="intake-mine">Answer your questionnaire</button>` : '')}
    <div class="band"><div class="wrap stack">
      ${rosterPanel(s)}
      <div class="spec"><div class="spec__bar">Committee input</div>
        <div class="spec__body stack stack--tight">
          ${hubRow('Intake window',
            open ? `Open${due?' · due '+esc(due):''}. ${answered} of ${roster.length} answered.`
                 : s.intake?.status === 'closed' ? 'Closed. Answers are visible to the search team.' : 'Not opened yet.',
            statusPill(intake),
            openBtn('intake', you().consultant ? 'Manage intake' : 'Open the questionnaire', open && !you().consultant))}
          ${seated ? hubRow('Your answers',
            mine && mine.submitted ? 'On file. You can revise them while the window is open.' : open ? 'Not submitted yet.' : 'The window is not open.',
            mine && mine.submitted ? pill('ok','Submitted') : pill('idle','Not submitted'),
            open && canOpenStep('intake') ? `<button class="btn btn--secondary btn--sm" data-go="intake-mine">Open your questionnaire</button>` : '') : ''}
          ${hubRow('Adopted profile',
            crit ? crit+' criteria adopted. Screening, surveys, and interviews all score against these.' : 'Not adopted yet. It is built from the committee’s answers.',
            statusPill(stepState('profile')),
            openBtn('profile', crit ? 'Read the profile' : 'Build the profile'))}
        </div></div>
    </div></div>`);
}

function vInterviews(){
  const s = state.search;
  const rec = (s.staff||{}).video || { log:[] };
  const semis = (s.candidates||[]).filter(x => x.stage==='semifinalist' || x.stage==='finalist');
  const seen = new Set((rec.log||[]).map(e => e.candidateId).filter(Boolean)).size;
  const guide = s.artifacts?.guide, sched = s.artifacts?.schedule;
  return shell(`
    ${head('This search','Interviews','The interview log, the materials interviews run from, and the assessment schedule. Nothing here schedules or sends anything.')}
    <div class="band"><div class="wrap stack">
      <div class="spec"><div class="spec__bar">Interview log</div>
        <div class="spec__body stack stack--tight">
          ${canOpenStep('video') ? hubRow('Video interviews',
            semis.length ? seen+' of '+semis.length+' semifinalist'+(semis.length===1?'':'s')+' seen and logged.' : 'No semifinalists named yet.',
            statusPill(stepState('video')),
            openBtn('video','Open the log', true)) : ''}
          ${canOpenStep('references') ? hubRow('Reference checks',
            'Finalists only, and only where consent is recorded.',
            statusPill(stepState('references')),
            openBtn('references','Open the log')) : ''}
          ${!canOpenStep('video') && !canOpenStep('references') ? `<p class="t-small">No interview log is included on this file.</p>` : ''}
        </div></div>
      <div class="spec"><div class="spec__bar">Interview materials</div>
        <div class="spec__body stack stack--tight">
          ${canOpenStep('guide') ? hubRow('Interview guide',
            guide ? 'ARE questions and assessment scenarios, each tagged to a profile criterion.' : 'Not drafted yet. It is written from the adopted profile.',
            docStatus('guide', Boolean(guide)),
            openBtn('guide', guide ? 'Open the guide' : 'Draft the guide')) : ''}
          ${canOpenStep('survey2') ? hubRow('Semifinalist questionnaire',
            s.artifacts?.survey2 ? 'Deeper questions asked before interviews.' : 'Optional. Drafted now, opened after semifinalists are named.',
            docStatus('survey2', Boolean(s.artifacts?.survey2)),
            openBtn('survey2','Open the questionnaire')) : ''}
          ${!canOpenStep('guide') && !canOpenStep('survey2') ? `<p class="t-small">No interview materials are included on this file.</p>` : ''}
        </div></div>
      ${canOpenStep('schedule') ? `<div class="spec"><div class="spec__bar">Assessment schedule</div>
        <div class="spec__body stack stack--tight">
          ${hubRow('Finalist week',
            sched ? 'The interview schedule and the assessment guide every finalist runs through.' : 'Not drafted yet. It needs finalists and the interview guide.',
            docStatus('schedule', Boolean(sched)),
            openBtn('schedule', sched ? 'Open finalist week' : 'Draft finalist week'))}
        </div></div>` : ''}
    </div></div>`);
}

// Who last touched a document, taken from the activity the server already
// records. Activity text names the artifact key; where no entry names it, the
// editor is shown as absent rather than guessed at.
function docEditor(key){
  // Matched on whole words rather than a substring, so "plan" is not found
  // inside "planned" and "ads" is not found inside "adsorbed". Where no
  // recorded action names this artifact, the answer is nothing, not a guess.
  const hit = (state.search?.activity||[]).find(a =>
    String(a.x||'').toLowerCase().split(/[^a-z0-9]+/).includes(key));
  return hit ? { who:hit.who, at:(hit.at||'').slice(0,10) } : null;
}

function vDocuments(){
  const s = state.search;
  const keys = DOC_KEYS.filter(canOpenStep);
  const rows = keys.map(key => {
    const has = key === 'profile' ? (s.criteria||[]).some(c => c.label) : Boolean(s.artifacts?.[key]);
    const meta = DRAFTS[key] || { title: STEP_NAME[key] || key };
    const who = docEditor(key);
    const review = (s.reviews||{})[key];
    const stale = s.staleArtifacts?.[key];
    const detail = stale ? esc(stale)
      : review?.status === 'approved' ? 'Reviewed by '+esc(review.byName || 'the search team')+(review.at?' on '+esc(review.at.slice(0,10)):'')
      : who ? 'Last change by '+esc(who.who)+' on '+esc(who.at)
      : has ? 'On file.' : 'Not started.';
    return `<tr>
      <th scope="row"><span class="candname">${esc(key==='profile'?'Candidate profile':meta.title)}</span>
        <span class="candmeta">${detail}</span></th>
      <td data-label="State">${key==='profile' ? statusPill(stepState('profile')) : docStatus(key, has)}</td>
      <td data-label="Open" class="candacts">${openBtn(key, has ? 'Open' : 'Start', false)}</td>
    </tr>`;
  }).join('');
  return shell(`
    ${head('This search','Documents','Every artifact on this file, what state it is in, and who last changed it. Generated documents keep their own presentation when you open them.')}
    <div class="band"><div class="wrap stack">
      ${keys.length ? `<div class="tablewrap"><table class="candtable">
        <thead><tr><th scope="col">Document</th><th scope="col">State</th><th scope="col">Open</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : emptyState('No documents on this file','This package does not include drafted documents.')}
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
      <div class="spec"><div class="spec__bar">What each pay level includes</div>
        <div class="spec__body spec__body--flush">${packageMatrix(pkg)}</div>
      </div>
      <div class="showcase">${inner}</div>
    </div></div>`);
}

function vFacts(){
  const s = state.search;
  const pkgOpen = Boolean(state.open.factspkg);
  return shell(`
    ${head('Search facts', s.client||'Client','These facts feed every generated document. Check them before you draft recruiting copy.')}
    <div class="band"><div class="wrap"><form id="facts" class="stack">
      ${sectionHead('The client')}
      <div class="formgrid">
        ${field('Client','Official county, city, or town name.', `<input class="input" name="client" value="${esc(s.client)}">`)}
        ${field('Position','', `<input class="input" name="position" value="${esc(s.position)}">`)}
        ${jurisdictionPicker(s.jurisdictionType)}
        ${field('State','', `<input class="input" name="state" value="${esc(s.state||'')}">`)}
        ${field(jurisdictionInfo().key==='county'?'County website':'City or town website','Official site used for research.', `<input class="input" name="website" value="${esc(s.website||'')}" placeholder="https://">`)}
        ${field('Form of government','', `<input class="input" name="fog" value="${esc(s.fog||'')}">`)}
      </div>
      ${sectionHead('Facts used in recruiting copy')}
      <div class="formgrid">
        ${field('Population','', `<input class="input" name="population" value="${esc(s.population||'')}">`)}
        ${field('Budget','', `<input class="input" name="budget" value="${esc(s.budget||'')}">`)}
        ${field('Salary','', `<input class="input" name="salary" value="${esc(s.salary||'')}">`)}
        ${field('First review','', `<input class="input" name="firstReview" value="${esc(s.firstReview||'')}">`)}
        ${field('Working notes','Not published. Used when you ask Claude to draft.', `<textarea class="input ed" name="notes">${esc(s.notes||'')}</textarea>`, { span:true })}
      </div>
      ${packages().length ? `
      ${sectionHead('Service package', packageLabel(s.package), `<button type="button" class="btn btn--ghost btn--sm" data-panel="factspkg" aria-expanded="${pkgOpen}" aria-controls="factspkg" data-open-label="Change the package" data-close-label="Hide package options">${pkgOpen?'Hide package options':'Change the package'}</button>`)}
      <div id="factspkg"${pkgOpen?'':' hidden'}>
        <p class="t-small u-mb-3">Moving down a level hides the steps that fee does not include. Anything already drafted on them stays on file and comes back if you move up again.</p>
        ${packageChoice(s.package)}
      </div>` : ''}
      ${actionBar(
        `<button class="btn btn--primary" data-act="save-facts">Save facts</button>`,
        withTip(`<button type="button" class="btn btn--secondary" data-act="research">Research this ${esc(jurisdictionInfo().noun)}</button>`, TIPS.research)
        + ` <button type="button" class="btn btn--ghost" data-go="verify">County fact verification${factGap(s)}</button>`
        + ` <button type="button" class="btn btn--ghost" data-go="profile">Candidate profile</button>`)}
    </form></div></div>`);
}

// How many material facts are still unconfirmed, shown on the way in so the
// gap is visible while the work is happening rather than when a county reads
// the brochure. Defined below vFacts deliberately: tests/jurisdictions.js
// renders that screen from the source between vFacts and seatPill, so its
// helpers have to sit inside that range.
function factGap(s){
  const fs = s?.factStatus;
  if (!fs || !fs.materialTotal || fs.readyToPublish) return '';
  return ' ' + pill('wait', (fs.materialTotal - fs.materialConfirmed) + ' outstanding');
}

/* ===========================================================================
 * County fact verification (DEP-07)
 *
 * Drafting can propose who appoints the administrator. It cannot confirm it.
 * The difference between a fact a person checked against a named source and a
 * sentence a model produced is the difference between a brochure a county will
 * stand behind and one it will not, so the record has to show which is which.
 * ========================================================================= */

const FACT_STATE = {
  confirmed:  { pill:'ok',   label:'Confirmed' },
  unverified: { pill:'wait', label:'Not verified' },
  missing:    { pill:'idle', label:'Not recorded' }
};

function factBlock(f){
  const st = FACT_STATE[f.state] || FACT_STATE.missing;
  return `<div class="spec" data-fact="${esc(f.key)}">
    <div class="spec__bar">${esc(f.label)} ${pill(st.pill, st.label)}${f.material?pill('info','Material'):''}</div>
    <div class="spec__body stack stack--tight">
      <p class="t-small">${esc(f.why||'')}</p>
      ${f.state !== 'confirmed' && f.needs?.length
        ? `<p class="t-small">Still needs: ${esc(f.needs.join(', '))}.</p>` : ''}
      <div class="formgrid">
        ${field('What is true','', `<textarea class="input ed" name="${esc(f.key)}.value">${esc(f.value||'')}</textarea>`, { span:true })}
        ${field('Source','The document or page it was read from.', `<input class="input" name="${esc(f.key)}.source" value="${esc(f.source||'')}" placeholder="County code § 2-14, or a page URL">`)}
        ${field('Current as of','The date that source was current.', `<input class="input" name="${esc(f.key)}.asOf" value="${esc(f.asOf||'')}" placeholder="2026-09-01">`)}
        ${field('Confirmed by','The person who checked it. Naming yourself here is a statement that you did.',
          `<input class="input" name="${esc(f.key)}.confirmedBy" value="${esc(f.confirmedBy||'')}">`)}
      </div>
      ${f.confirmedAt ? `<p class="t-small">Last confirmed ${esc(String(f.confirmedAt).slice(0,10))}. The timestamp is stamped by the server, not typed.</p>` : ''}
    </div></div>`;
}

function vVerify(){
  const s = state.search;
  const fs = s.factStatus || { fields:[], applies:false };
  const fields = fs.fields || [];
  return shell(`
    ${head('Search facts','County fact verification',
      'What a person checked against a named source, and what is still only asserted. Material facts must be confirmed before recruiting copy goes out.',
      `<button type="button" class="btn btn--secondary" data-go="facts">Search facts</button>`)}
    <div class="band"><div class="wrap stack">
      ${!fs.applies ? `<div class="notice notice--info"><div>
        <div class="notice__t">This search is not a county</div>
        <div class="notice__b">These questions are about county authority and governance. They are recorded
          either way, but the publishing gate applies to county searches.</div></div></div>` : ''}
      <div class="notice notice--${fs.readyToPublish?'ok':'info'}" role="status"><div>
        <div class="notice__t">${fs.readyToPublish ? 'Every material fact is confirmed' : 'Material facts outstanding'}</div>
        <div class="notice__b">${esc(fs.materialConfirmed||0)} of ${esc(fs.materialTotal||0)} material facts confirmed,
          ${esc(fs.confirmedCount||0)} of ${esc(fs.total||0)} overall.${!fs.readyToPublish && fs.outstanding?.length
            ? ' Outstanding: '+esc(fs.outstanding.join(', '))+'.' : ''}
          <br>Generated copy is a draft whatever this says. Confirming a fact means a person checked it, not that a model produced it.</div>
      </div></div>
      <form id="verifyform" class="stack">
        ${fields.map(factBlock).join('')}
        ${actionBar(
          `<button type="button" class="btn btn--primary" data-act="save-verification">Save these facts</button>`,
          `<button type="button" class="btn btn--secondary" data-go="overview">Back to this search</button>`,
          'Who confirmed a fact, and when, is recorded by the server.',
          'Unsaved facts')}
      </form>
    </div></div>`);
}

/* ===========================================================================
 * Closeout (DEP-09)
 *
 * Archive is filing. Closing is the statement that the work concluded and how,
 * and it freezes the file so a concluded record cannot drift afterwards.
 * ========================================================================= */

function vCloseout(){
  const s = state.search;
  const lc = s.lifecycle || { status:'active', byOutcome:{}, selected:[], undecided:[], finalDocuments:[] };
  const frozen = isFrozen(s);
  const counts = Object.entries(lc.byOutcome || {});
  return shell(`
    ${head('This search','Closeout',
      'How this search concluded, and the record it leaves behind. Closing is separate from archiving: one says the work finished, the other files it away.')}
    <div class="band"><div class="wrap stack">
      <div class="spec"><div class="spec__bar">Status ${pill(frozen?'stop':'ok', lc.status||'active')}</div>
        <div class="spec__body stack stack--tight">
          ${kv('Candidates on the file', esc(String(lc.candidates||0)))}
          ${counts.map(([k, n]) => kv(k === 'in-process' ? 'Still in process' : (OUTCOME[k]?.label || k), esc(String(n)))).join('')}
          ${lc.selected?.length ? kv('Selected', lc.selected.map(p => esc(p.name)).join(', ')) : ''}
          ${lc.closedAt ? kv('Closed', esc(String(lc.closedAt).slice(0,10))) : ''}
          ${lc.reopenCount ? kv('Reopened', esc(String(lc.reopenCount))+' time'+(lc.reopenCount===1?'':'s')) : ''}
        </div></div>

      ${lc.undecided?.length ? `<div class="notice notice--info"><div>
        <div class="notice__t">${esc(String(lc.undecided.length))} candidate${lc.undecided.length===1?' has':'s have'} no outcome recorded</div>
        <div class="notice__b">Closing does not decide them. A search can close with people undecided, but the
          record will not say what happened to them.<br>
          ${lc.undecided.slice(0,12).map(p => `<button type="button" class="btn btn--ghost btn--sm" data-cand="${esc(p.id)}">${esc(p.name)}</button>`).join('')}
          ${lc.undecided.length>12?'<span class="t-small"> and '+esc(String(lc.undecided.length-12))+' more</span>':''}</div></div></div>` : ''}

      <div class="spec"><div class="spec__bar">Final documents · ${esc(String((lc.finalDocuments||[]).length))}</div>
        <div class="spec__body stack stack--tight">
          ${(lc.finalDocuments||[]).length
            ? `<p class="t-small">${(lc.finalDocuments||[]).map(k => esc(DRAFTS[k]?.title || STEP_NAME[k] || k)).join(' · ')}</p>`
            : '<p class="t-small">No documents drafted on this file.</p>'}
          <p class="t-small">Documents held outside Slate — resumes, background reports, signed agreements — are
            recorded as references on each candidate and must be exported from the repository that holds them.</p>
        </div></div>

      ${frozen ? `<div class="spec"><div class="spec__bar">Reopen</div>
        <div class="spec__body">
          <form id="reopenform" class="stack stack--tight">
            <p class="t-small">Reopening restores ordinary editing. It does not put revoked candidate links back
              into circulation: issuing a new link is a separate, deliberate act on each candidate.</p>
            ${field('Why is this search being reopened','Recorded on the file.', `<textarea class="input ed" name="reason" required></textarea>`, { span:true, req:true })}
            <div class="row"><button type="button" class="btn btn--primary" data-act="reopen-search">Reopen this search</button></div>
          </form>
        </div></div>`
      : `<div class="spec"><div class="spec__bar">Close this search</div>
        <div class="spec__body">
          <form id="closeform" class="stack stack--tight">
            <p class="t-small">Closing freezes the file: no edits, no scoring, no candidate submissions, and every
              outstanding candidate link is revoked. It can be reopened deliberately, with a reason.</p>
            <div class="formgrid">
              ${field('Outcome','', `<select class="input" name="status">
                <option value="closed">Closed — the search concluded</option>
                <option value="cancelled">Cancelled — the search ended without a hire</option>
              </select>`)}
              ${field('Why','Recorded on the file and in the export.', `<textarea class="input ed" name="reason" required></textarea>`, { span:true, req:true })}
            </div>
            <div class="row"><button type="button" class="btn btn--primary" data-act="close-search">Close this search</button></div>
          </form>
        </div></div>`}

      <div class="spec"><div class="spec__bar">Where the rest of the record is</div>
        <div class="spec__body stack stack--tight">
          <p class="t-small">Every close and reopen is recorded on the activity feed with the account that did it.
            Each candidate's outcome, with its reason and evidence, is on that candidate.</p>
          <div class="row">
            <button type="button" class="btn btn--secondary btn--sm" data-go="activity">Open activity</button>
            <button type="button" class="btn btn--secondary btn--sm" data-go="screen">Open candidates</button>
          </div>
        </div></div>
    </div></div>`);
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
      ${manage && m.userId !== mgr?.userId ? `<button class="btn btn--ghost btn--sm" data-act="unseat" data-uid="${m.userId}" data-name="${esc(m.name)}">Remove</button>` : ''}
    </div>
  </div>`;
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
      'Everyone who gets a say in this hire, and the one consultant who runs the account. The roster records who contributes to the hire. Committee input is collected in Step '+stepNo('intake')+', and candidates are scored later.')}
    <div class="band"><div class="wrap stack">
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
          <form id="newmember" class="formgrid">
            ${field('Name','', `<input class="input" name="name" placeholder="Dana Reyes" required>`)}
            ${field('Email','Their contact email for this search.', `<input class="input" name="email" type="email" placeholder="dreyes@example.gov" required>`)}
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
      ${manage
        ? actionBar(
            confirmed
              ? nextBtn('team')
              : withTip(`<button type="button" class="btn btn--primary" data-act="confirm-team">Roster is set</button>`,
                  'Lock the roster so committee input can open. Seating anyone new reopens it.'),
            confirmed
              ? withTip(`<button type="button" class="btn btn--secondary" data-act="confirm-team">Reopen the roster</button>`,
                  'Unlock the roster to seat or remove someone.')
              : nextBtn('team').replace('btn--primary','btn--secondary'),
            confirmed ? 'Roster confirmed.' : committeeCount+' committee seat'+(committeeCount===1?'':'s')+' so far.')
        : actionBar(nextBtn('team'))}
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
  const named = rows.filter(x => String(x.it.label||'').trim()).length;
  const suggKey = 'isugg-'+kind;
  const suggOpen = state.open[suggKey] === undefined ? named === 0 : Boolean(state.open[suggKey]);
  return `<section id="intake-sec-${kind}" class="spec profgroup"><div class="spec__bar">${esc(ask.t)} · ${named} named</div>
    <div class="spec__body stack">
      <p class="t-small">${esc(ask.hint)} Add as many as you want. Rate each 1 to 5 for how much it matters to you.</p>
      ${rows.map(x => intakeRow(x.it, x.i)).join('') || '<p class="t-small">Nothing here yet. Write your own, or open the suggestions.</p>'}
      <div class="row">
        <button type="button" class="btn btn--secondary btn--sm" data-iadd="${kind}">Write my own</button>
        <button type="button" class="btn btn--ghost btn--sm" data-panel="${suggKey}" aria-expanded="${suggOpen}" aria-controls="ipick-${kind}" data-open-label="Suggestions" data-close-label="Hide suggestions">${suggOpen?'Hide suggestions':'Suggestions'}</button>
      </div>
      <div id="ipick-${kind}"${suggOpen?'':' hidden'}>
        <div class="pick">${(SUGGEST[kind]||[]).map(label => {
          const on = labels.has(label.toLowerCase());
          return `<button type="button" data-ipick="${kind}" data-label="${esc(label)}" aria-pressed="${on}">${esc(label)}</button>`;
        }).join('')}</div>
      </div>
    </div></section>`;
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
      'Answer for yourself. Nobody on the committee sees your answers, or anyone else’s, until the account manager closes the window. Then everything is read together.')}
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
        <nav class="secnav" aria-label="Questionnaire sections">
          <span class="secnav__t">Sections</span>
          ${Object.keys(INTAKE_ASK).map(k => {
            const named = d.items.filter(i => i.kind===k && String(i.label||'').trim()).length;
            return `<button type="button" class="${named?'is-done':''}" data-act="jump" data-to="intake-sec-${k}">${esc(KIND[k].plural)} <span class="mono">${named}</span></button>`;
          }).join('')}
          <button type="button" data-act="jump" data-to="intake-sec-words">In your own words</button>
        </nav>
        ${Object.keys(INTAKE_ASK).map(intakeGroup).join('')}
        <section id="intake-sec-words" class="spec profgroup"><div class="spec__bar">In your own words</div><div class="spec__body stack">
          ${field('What would make you say yes to a candidate?','', `<textarea class="input ed" id="intake-mustHave" rows="3">${esc(d.mustHave)}</textarea>`)}
          ${field('What would make you say no?','', `<textarea class="input ed" id="intake-dealBreaker" rows="3">${esc(d.dealBreaker)}</textarea>`)}
          ${field('Anything else the search team should know','', `<textarea class="input ed" id="intake-context" rows="3">${esc(d.context)}</textarea>`)}
        </div></section>
        ${actionBar(
          `<button type="button" class="btn btn--primary" data-act="submit-intake">${mine?.submitted?'Update my answers':'Submit my answers'}</button>`,
          withTip(`<button type="button" class="btn btn--secondary" data-act="save-intake">Save and finish later</button>`,
            'Keep what you have written without submitting it. Nobody reads it until you submit.'),
          count+' named so far.',
          'Not submitted yet')}` : ''}
      ${closed && s.consensus ? consensusPanels(s.consensus, false) : ''}
      ${!open ? stepFooter('intake') : ''}
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
        <div class="spec__body"><form id="intakewindow" class="formgrid">
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
  const name = String(c.label||'').trim() || (KIND[c.kind]?.label || 'This criterion');
  return `<div class="crit-row" data-row="${i}">
    <span class="mono t-small">${esc(c.id||'')}${critSource(c)}</span>
    <div class="stack u-gap-6">
      <input class="input" data-f="label" value="${esc(c.label)}" placeholder="Label" aria-label="Criterion ${esc(c.id||i+1)} label">
      <input class="input" data-f="note" value="${esc(c.note||'')}" placeholder="Why this matters here" aria-label="Why ${esc(name)} matters here">
    </div>
    ${ratingGroup('Weight for '+name+' — 1, nice to have, to 5, decisive',
      `<div class="wgt">${[1,2,3,4,5].map(n=>`<button type="button" data-w="${n}" aria-label="Weight ${n} of 5 for ${esc(name)}" aria-pressed="${Number(c.weight)===n}">${n}</button>`).join('')}</div>`)}
    <button type="button" class="btn btn--ghost btn--sm" data-del="${i}">Remove</button>
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

  const counts = Object.keys(KIND).map(k => ({ k, n: kindCount(k), ok: inCritRange(kindCount(k)) }));
  // Buttons, not anchors: the workspace uses the URL hash for routing, so an
  // in-page "#prof-skill" link would be read as a navigation.
  const nav = `<nav class="secnav" aria-label="Profile sections">
    <span class="secnav__t">Sections</span>
    ${counts.map(c => `<button type="button" class="${c.ok?'is-done':''}" data-act="jump" data-to="prof-${c.k}">${esc(KIND[c.k].plural)} <span class="mono">${c.n}/3–5</span></button>`).join('')}
  </nav>`;

  const groups = Object.keys(KIND).map(k => {
    const rows = (s.criteria||[]).map((c,i)=>({c,i})).filter(x=>x.c.kind===k);
    const n = rows.filter(x => String(x.c.label||'').trim()).length;
    const atCap = rows.length >= 5;
    const labels = new Set(rows.map(x => x.c.label.trim().toLowerCase()).filter(Boolean));
    const range = inCritRange(n) ? 'ok' : (k==='skill' ? 'wait' : (n ? 'wait' : 'idle'));
    // What the committee named comes first and is marked as theirs. The stock
    // suggestions stay underneath for the gaps nobody filled. Once a category
    // has what it needs the bank collapses, so twelve criteria no longer read
    // as four walls of chips (D10).
    const fromRoom = (agg?.byKind[k] || []).filter(e => !labels.has(e.label.trim().toLowerCase()));
    const suggKey = 'sugg-'+k;
    const suggOpen = state.open[suggKey] === undefined ? !inCritRange(n) : Boolean(state.open[suggKey]);
    return `<section id="prof-${k}" class="profgroup">
      ${sectionHead(KIND[k].plural, '', pill(range, n+' of 3–5'))}
      ${k==='skill' ? `<p class="t-small">Select 3 to 5 essential skills. These become the spine of the ads, surveys, and interviews.</p>` : ''}
      ${rows.length ? `<p class="t-small">Weight each one from 1 (nice to have) to 5 (decisive).</p>` : ''}
      ${rows.map(x=>critRow(x.c,x.i)).join('') || '<p class="t-small">None selected yet.</p>'}
      <div class="row u-mt-3">
        <button type="button" class="btn btn--secondary btn--sm" data-add="${k}" ${atCap?'disabled':''}>Add another ${KIND[k].label.toLowerCase()}</button>
        ${atCap ? '<span class="t-small">Five is the maximum. Remove one before adding another.</span>' : ''}
        <button type="button" class="btn btn--ghost btn--sm" data-panel="${suggKey}" aria-expanded="${suggOpen}" aria-controls="pick-${k}" data-open-label="Suggestions" data-close-label="Hide suggestions">${suggOpen?'Hide suggestions':'Suggestions'}</button>
      </div>
      <div id="pick-${k}"${suggOpen?'':' hidden'}>
        ${fromRoom.length ? `<p class="t-small">Named by the committee and not on the profile yet:</p>
          <div class="pick pick--room">${fromRoom.map(e =>
            `<button type="button" data-pick="${k}" data-label="${esc(e.label)}" data-weight="${Math.round(e.avgWeight)}" aria-pressed="false" ${atCap?'disabled':''}>${esc(e.label)} <span class="mono">${e.mentions}/${agg.submitted}</span></button>`
          ).join('')}</div>` : ''}
        <div class="pick">${(SUGGEST[k]||[]).map(label => {
          const on = labels.has(label.toLowerCase());
          return `<button type="button" data-pick="${k}" data-label="${esc(label)}" aria-pressed="${on}" ${!on && atCap ? 'disabled':''}>${esc(label)}</button>`;
        }).join('')}</div>
      </div>
    </section>`;
  }).join('');

  const prepOpen = Boolean(state.open.profileprep);
  const aiReady = Boolean(state.health?.hasKey);

  return shell(`
    ${head('Step '+stepNo('profile'),'Candidate profile','This is the spine. Built from what the committee said in Step '+stepNo('intake')+', then edited by you. Recruiting markets it. Surveys test it. Interviews evidence it.')}
    <div class="band"><div class="wrap stack">
      ${agg?.submitted ? `<div class="notice notice--${adopted?'ok':'info'}"><div>
        <div class="notice__t">${agg.submitted} of ${agg.seats} on the committee answered</div>
        <div class="notice__b">${adopted
          ? 'This profile was built from their answers. The badge on each line shows how many of them named it. Edit freely; the badges follow the label.'
          : 'Build the matrix from their answers rather than typing it from memory, then edit.'}
          ${agg.contested.length ? ' <b>'+agg.contested.length+'</b> item'+(agg.contested.length===1?' is':'s are')+' contested — the committee disagrees on how much '+(agg.contested.length===1?'it matters':'they matter')+'.' : ''}
          <button type="button" class="btn btn--ghost btn--sm" data-go="intake">See what they said</button></div>
      </div></div>` : `<div class="notice notice--info"><div>
        <div class="notice__t">No committee input on file</div>
        <div class="notice__b">Step ${stepNo('intake')} collects what each member is looking for, and this matrix is normally built from it. You can still write the profile by hand.</div>
      </div></div>`}
      ${nav}
      ${groups}
      ${sectionHead('Preparation', 'Optional', `<button type="button" class="btn btn--ghost btn--sm" data-panel="profileprep" aria-expanded="${prepOpen}" aria-controls="profileprep" data-open-label="Open" data-close-label="Close">${prepOpen?'Close':'Open'}</button>`)}
      <div id="profileprep"${prepOpen?'':' hidden'}>
        <div class="stack stack--tight">
          ${field('Notes for the draft','Paste governing-body workshop notes. Claude drafts from the committee’s answers first, then these. You still choose the skills.',
            `<textarea class="input ed" id="profilenotes">${esc(s.notes||'')}</textarea>`)}
          ${modelToggle()}
          <div class="row">
            ${withTip(`<button type="button" class="btn btn--secondary" data-act="draft-profile" ${aiReady?'':'disabled'}>Draft with Claude</button>`, 'Write a first matrix from the committee’s answers and these notes. You still choose and weight the criteria.')}
            ${aiReady ? '' : '<span class="t-small">No API key is configured, so drafting is unavailable. The matrix can be built by hand or from committee input.</span>'}
          </div>
        </div>
      </div>
      ${actionBar(
        `<button type="button" class="btn btn--primary" data-act="save-profile">Save profile</button>`,
        `${agg?.submitted && canManage() ? withTip(`<button type="button" class="btn btn--secondary" data-act="adopt-consensus">${adopted?'Rebuild from committee':'Build from committee'}</button>`, 'Replace this matrix with what the committee named, ranked by how many of them named it.') : ''}
         <button type="button" class="btn btn--secondary" data-act="save-profile-next">Save and move on</button>`,
        profileGaps(s.criteria||[]).length
          ? 'Still needed: '+esc(profileGaps(s.criteria||[]).join(', '))+'.'
          : 'Every category has 3 to 5.',
        'Unsaved edits')}
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
    $$('[data-path]', form).forEach(el =>
      setAt(out, el.dataset.path, el.type === 'checkbox' ? el.checked : el.value));
    return out;
  }
  const raw = $('#art-'+kind)?.value;
  if (raw == null) return state.search.artifacts?.[kind] || {};
  return JSON.parse(raw);
}
function editorWrap(kind, inner){
  return `<form id="edit-${kind}" class="editor">${inner}</form>`;
}

/* --- structured editing ---------------------------------------------------
 * A blank document used to offer nothing but an editable `{}` and a Draft
 * with Claude button, so writing a questionnaire by hand was not really
 * supported (D05). Every document type now has add and remove controls that
 * work from empty. Raw JSON stays, under Advanced.
 * ----------------------------------------------------------------------- */

function artAdd(kind, path, label){
  return `<button type="button" class="btn btn--secondary btn--sm" data-artadd="${esc(kind)}:${esc(path)}">${esc(label)}</button>`;
}
function artDel(kind, path, index, label){
  return `<button type="button" class="btn btn--ghost btn--sm" data-artdel="${esc(kind)}:${esc(path)}:${index}">${esc(label)}</button>`;
}
function artItem(title, controls, remove){
  return `<div class="artitem">
    <div class="artitem__hd"><span class="artitem__t">${esc(title)}</span>${remove}</div>
    ${controls}
  </div>`;
}
function checkField(path, label, on, hint=''){
  return `<label class="check"><input type="checkbox" data-path="${esc(path)}" ${on?'checked':''}>
    <span>${esc(label)}${hint?`<small>${esc(hint)}</small>`:''}</span></label>`;
}

// Template rows for each list a document can grow.
const ART_TEMPLATE = {
  'survey1.questions': list => ({ n:list.length+1, prompt:'', required:false, crit:[] }),
  'survey2.questions': list => ({ n:list.length+1, prompt:'', required:false, crit:[] }),
  'guide.questions':   list => ({ n:list.length+1, stem:'', approach:'', results:'', experience:'', crit:[] }),
  'guide.scenarios':   list => ({ id:String.fromCharCode(65+list.length), name:'', mins:'', who:'', brief:'' }),
  'contract.sections': () => ({ h:'', body:'' }),
  'plan.rows':         () => ({ outlet:'', audience:'', format:'', when:'', cost:'', who:'', status:'' }),
  'bar.behavior':      () => ({ t:'', d:'' }),
  'bar.actions':       () => ({ t:'', due:'' }),
  'bar.results':       () => ({ t:'', target:'' }),
  'bar.governance':    () => ({ t:'' }),
  'community.facts':   () => ({ k:'', v:'' })
};

function sourceJson(kind, obj, folded){
  const ta = `<textarea class="input ed ed--lg" id="art-${kind}">${esc(JSON.stringify(obj||{}, null, 2))}</textarea>`;
  if (!folded) return `<div class="sub">Source (editable JSON)</div>${ta}`;
  return `<details class="srcjson"><summary>Advanced · source JSON</summary><p class="t-small">The fields above are the usual way to edit this. This is the raw file, for when something has to be moved or pasted wholesale.</p>${ta}</details>`;
}
function artifactEditor(kind, a){
  a = a || {};
  if (kind==='community'){
    const gov = a.government || {}, place = (typeof a.community==='object' && a.community) ? a.community : {};
    const facts = Array.isArray(a.facts) ? a.facts : [];
    return editorWrap(kind, `
      ${editArea('lede','Why a candidate would live and lead here', a.lede,'',5)}
      ${sectionHead('Facts', facts.length ? facts.length+' on file' : 'None yet', artAdd(kind,'facts','Add a fact'))}
      ${facts.map((f,i)=>`<div class="formgrid">${editArea('facts.'+i+'.k','Label',f.k,'',1)}${editArea('facts.'+i+'.v','Value',f.v,'',2)}<div class="field--span">${artDel(kind,'facts',i,'Remove this fact')}</div></div>`).join('')}
      ${sectionHead('Form of government')}
      ${govFields().map(([k,label]) => editArea('government.'+k, label, gov[k], '', 3)).join('')}
      ${sectionHead('The community')}
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
      <div class="formgrid formgrid--three">
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
    return editorWrap(kind, `
      ${sectionHead('Introduction')}
      ${editArea('intro','Introduction shown to the candidate', a.intro,'',3)}
      ${editArea('dueHint','Deadline hint', a.dueHint,'',1)}
      ${sectionHead('Questions', qs.length ? qs.length+' on this questionnaire' : 'None yet',
        artAdd(kind,'questions','Add a question'))}
      ${qs.length ? qs.map((q,i)=>artItem('Question '+String(q.n||i+1).padStart(2,'0'),
        `${editArea('questions.'+i+'.prompt','What the candidate is asked', q.prompt,'',3)}
         ${checkField('questions.'+i+'.required','Answer required', q.required, 'The questionnaire cannot be submitted without this one.')}`,
        artDel(kind,'questions',i,'Remove'))).join('')
        : `<p class="t-small">No questions yet. Add them here, or draft the questionnaire with Claude and edit what it writes.</p>`}
      <div class="row">${artAdd(kind,'questions','Add a question')}</div>
    `);
  }
  if (kind==='plan'){
    const rows = a.rows || [];
    return editorWrap(kind, `
      ${sectionHead('Where the position is advertised', rows.length ? rows.length+' outlets' : 'None yet', artAdd(kind,'rows','Add an outlet'))}
      ${rows.length ? `<div class="tablewrap"><table>
      <thead><tr><th>Outlet</th><th>Audience</th><th>Format</th><th>When</th><th>Cost</th><th>Who</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.map((r,i)=>`<tr>
        <td><input class="input" data-path="rows.${i}.outlet" value="${esc(r.outlet||'')}" aria-label="Outlet ${i+1}"></td>
        <td><input class="input" data-path="rows.${i}.audience" value="${esc(r.audience||'')}" aria-label="Audience ${i+1}"></td>
        <td><input class="input" data-path="rows.${i}.format" value="${esc(r.format||'')}" aria-label="Format ${i+1}"></td>
        <td><input class="input" data-path="rows.${i}.when" value="${esc(r.when||'')}" aria-label="When ${i+1}"></td>
        <td><input class="input" data-path="rows.${i}.cost" value="${esc(r.cost||'')}" aria-label="Cost ${i+1}"></td>
        <td><input class="input" data-path="rows.${i}.who" value="${esc(r.who||'')}" aria-label="Who ${i+1}"></td>
        <td><input class="input" data-path="rows.${i}.status" value="${esc(r.status||'')}" aria-label="Status ${i+1}"></td>
        <td>${artDel(kind,'rows',i,'Remove')}</td>
      </tr>`).join('')}</tbody></table></div>`
      : `<p class="t-small">No outlets yet. Add the places this position will be advertised, or draft the plan with Claude.</p>`}
    `);
  }
  if (kind==='guide'){
    const qs = a.questions || [];
    const sc = a.scenarios || [];
    return editorWrap(kind, `
      ${sectionHead('Interview questions', qs.length ? qs.length+' questions' : 'None yet', artAdd(kind,'questions','Add a question'))}
      ${qs.length ? qs.map((q,i)=>artItem('Question '+(q.n||i+1),
        `${editArea('questions.'+i+'.stem','Stem', q.stem,'What the panel asks.',2)}
         ${editArea('questions.'+i+'.approach','Approach', q.approach,'What a strong answer describes doing.',2)}
         ${editArea('questions.'+i+'.results','Results', q.results,'What a strong answer can show for it.',2)}
         ${editArea('questions.'+i+'.experience','Experience', q.experience,'What background the answer should evidence.',2)}`,
        artDel(kind,'questions',i,'Remove'))).join('')
        : `<p class="t-small">No questions yet. Add them here, or draft the guide with Claude.</p>`}
      ${sectionHead('Assessment scenarios', sc.length ? sc.length+' scenarios' : 'None yet', artAdd(kind,'scenarios','Add a scenario'))}
      ${sc.map((s,i)=>artItem('Scenario '+(s.id||String(i+1)),
        `${editArea('scenarios.'+i+'.name','Name', s.name,'',1)}
         <div class="formgrid">
           ${editArea('scenarios.'+i+'.mins','Minutes', s.mins,'',1)}
           ${editArea('scenarios.'+i+'.who','Who observes', s.who,'',1)}
         </div>
         ${editArea('scenarios.'+i+'.brief','Brief', s.brief,'',4)}`,
        artDel(kind,'scenarios',i,'Remove'))).join('')}
    `);
  }
  if (kind==='contract'){
    const secs = a.sections || [];
    return editorWrap(kind, `
      ${editArea('title','Title', a.title,'',1)}
      ${sectionHead('Sections', secs.length ? secs.length+' sections' : 'None yet', artAdd(kind,'sections','Add a section'))}
      ${secs.length ? secs.map((sec,i)=>artItem(sec.h || 'Section '+(i+1),
        `${editArea('sections.'+i+'.h','Heading', sec.h,'',1)}
         ${editArea('sections.'+i+'.body','Body', sec.body,'',5)}`,
        artDel(kind,'sections',i,'Remove'))).join('')
        : `<p class="t-small">No sections yet. Add them here, or draft the agreement with Claude and edit what it writes. It still goes to counsel.</p>`}
    `);
  }
  if (kind==='bar'){
    const parts = [
      ['behavior','Behavior','What the governing body expects of how the manager works', ['t','Behavior'], ['d','What it looks like']],
      ['actions','Actions','Specific commitments for the year', ['t','Action'], ['due','Due']],
      ['results','Results','Measurable outcomes', ['t','Result'], ['target','Target']],
      ['governance','Governing body governance survey','Questions the body answers about its own conduct', ['t','Question']]
    ];
    return editorWrap(kind, parts.map(([path, title, lede, ...fields]) => {
      const list = a[path] || [];
      return `${sectionHead(title, list.length ? list.length+' items' : 'None yet', artAdd(kind, path, 'Add'))}
        <p class="t-small">${esc(lede)}</p>
        ${list.map((item,i)=>artItem(title+' '+(i+1),
          fields.map(([f,label]) => editArea(path+'.'+i+'.'+f, label, typeof item==='string' ? (f==='t'?item:'') : item[f], '', f==='d'||f==='target' ? 2 : 1)).join(''),
          artDel(kind, path, i, 'Remove'))).join('')}`;
    }).join(''));
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
  const mode = docMode('community');
  const aiReady = Boolean(state.health?.hasKey);
  return shell(`
    ${head('Step '+stepNo('community'), meta.title, meta.lede)}
    <div class="band"><div class="wrap stack">
      ${!profileDone ? prereqNotice('The profile comes first',
        'Adopt the candidate profile — 3 to 5 essential skills — then look up the jurisdiction. Research writes this profile against what the committee said it is looking for.',
        'profile', 'Open Step '+stepNo('profile')+' · Candidate profile') : ''}
      ${!has ? communityEmptyNotice(s) : ''}
      ${docBar('community', has)}
      ${mode==='edit' ? `
        ${sectionHead('Look this jurisdiction up')}
        <form id="citylookup" class="formgrid">
          ${field(jurisdictionInfo().key==='county'?'County':'Jurisdiction','', `<input class="input" name="city" value="${esc(s.client||'')}" placeholder="${esc(jurisdictionInfo().clientPlaceholder)}">`)}
          ${field('Official website','http or https', `<input class="input" name="website" value="${esc(s.website||'')}" placeholder="https://www.fcgov.com">`)}
        </form>
        <p class="t-small">A research agent reads the official site, Census, and budget documents, then fills the facts on this search. It will not invent numbers. Check the file before you use it in recruiting.</p>
        ${modelToggle()}
        ${sourceList(s.research)}
        ${(s.population || s.budget || s.fog || s.state || s.salary) ? `<div class="tiles">
          ${s.state?`<div class="tile"><span class="tile__k">State</span><span class="tile__v u-fs-115">${esc(s.state)}</span></div>`:''}
          ${s.fog?`<div class="tile"><span class="tile__k">Form of government</span><span class="tile__v u-fs-115">${esc(s.fog)}</span></div>`:''}
          ${s.population?`<div class="tile"><span class="tile__k">Population</span><span class="tile__v u-fs-115">${esc(s.population)}</span></div>`:''}
          ${s.budget?`<div class="tile"><span class="tile__k">Budget</span><span class="tile__v u-fs-115">${esc(s.budget)}</span></div>`:''}
          ${s.salary?`<div class="tile"><span class="tile__k">Salary</span><span class="tile__v u-fs-115">${esc(s.salary)}</span></div>`:''}
        </div><p class="t-small">Those facts are also on <button type="button" class="btn btn--ghost btn--sm" data-go="facts">Search facts</button>. Check them before you draft recruiting copy.</p>`:''}
        ${artifactEditor('community', s.artifacts?.community)}
        ${sourceJson('community', s.artifacts?.community, true)}`
      : (has ? renderArtifact('community', s.artifacts.community)
             : emptyState('Nothing to preview yet','Switch to Edit and research the jurisdiction, or write the profile by hand.'))}
      ${actionBar(
        `<button type="button" class="btn btn--primary" data-act="save-art" data-kind="community">Save edits</button>`,
        `${withTip(`<button type="button" class="btn btn--secondary" data-act="research" ${profileDone && aiReady ?'':'disabled'}>Research this ${esc(jurisdictionInfo().noun)}</button>`, TIPS.research)}
         ${!profileDone ? '<span class="t-small">Research runs once the candidate profile is adopted.</span>'
           : !aiReady ? '<span class="t-small">No API key is configured, so research is unavailable. You can write this profile by hand.</span>' : ''}
         <button type="button" class="btn btn--secondary" data-act="next-step" data-from="community">Next · Initial survey</button>`,
        'Saved edits stay on the file.',
        'Unsaved edits')}
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
  const mode = docMode('brochure');
  const aiReady = Boolean(state.health?.hasKey);
  return shell(`
    ${head('Step '+stepNo('brochure'), meta.title, meta.lede)}
    <div class="band"><div class="wrap stack">
      ${!hasComm ? prereqNotice('The community file comes first',
        'The community research is what this packet is built from, and the ad plan says where it goes. You add pictures here rather than writing a second narrative.',
        'community', 'Open Step '+stepNo('community')+' · Community') : ''}
      ${hasComm && !has ? `<div class="notice notice--info"><div><div class="notice__t">Fill from the community file</div><div class="notice__b">This step lays out the research you already have, then lets you add photos and change the design. Claude is optional after that.</div></div></div>` : ''}
      ${docBar('brochure', has)}
      ${reviewBar('brochure', has)}
      ${mode==='preview'
        ? (has ? renderArtifact('brochure', a)
               : emptyState('Nothing to preview yet','Fill the brochure from the community file, then come back.'))
        : `${a ? brochureStudio(a) : ''}
           ${artifactEditor('brochure', a || {})}
           ${sourceJson('brochure', a, true)}`}
      ${actionBar(
        hasComm
          ? withTip(`<button type="button" class="btn btn--primary" data-act="assemble" data-kind="brochure">${has?'Refill from community':'Fill from community'}</button>`,
              has ? 'Rebuild this packet from the community research. Photos and layout stay as they are.' : 'Lay the community research out as a recruitment packet.')
          : `<button type="button" class="btn btn--primary" data-act="save-art" data-kind="brochure">Save edits</button>`,
        `${a ? `<button type="button" class="btn btn--secondary" data-act="save-art" data-kind="brochure">Save edits</button>` : ''}
         ${has ? withTip(`<button type="button" class="btn btn--secondary" data-act="print-pack" data-kind="brochure">Print brochure</button>`, TIPS.printPack) : ''}
         ${has ? withTip(`<button type="button" class="btn btn--ghost" data-act="generate" data-kind="brochure" ${aiReady?'':'disabled'}>Tighten with Claude</button>`, 'Rewrite this copy tighter. Photos and layout stay put.') : ''}
         ${has && !aiReady ? '<span class="t-small">No API key is configured, so tightening is unavailable.</span>' : ''}
         ${nextBtn('brochure').replace('btn--primary','btn--secondary')}`,
        'Saved edits stay on the file.',
        'Unsaved edits')}
    </div></div>`);
}

/* ===========================================================================
 * Document surfaces
 *
 * Every drafted document is edited the same way: an explicit Edit/Preview
 * pair, a visible status telling unsaved from saved draft from reviewed from
 * needs-another-look, structured fields that work from empty, raw JSON under
 * Advanced, and one save bar. Before DEP-13 a blank document offered a
 * `{}` textarea and four competing buttons (D05, D06).
 * ========================================================================= */

function docMode(key){
  return state.mode[key] === 'preview' ? 'preview' : 'edit';
}

function docStatus(key, has){
  if (!has) return pill('idle','Nothing on file yet');
  if (state.search?.staleArtifacts?.[key]) return pill('wait','Sources changed since this was written');
  if (takesReview(key)){
    const r = reviewOf(state.search, key);
    return r?.status === 'approved'
      ? pill('ok','Reviewed '+((r.at||'').slice(0,10)))
      : pill('wait','Draft, not reviewed');
  }
  return pill('info','Saved draft');
}

function docBar(key, has){
  const mode = docMode(key);
  return `<div class="docbar">
    ${docStatus(key, has)}
    <div class="modeswitch" role="group" aria-label="Editing mode">
      ${withTip(`<button type="button" data-mode="edit" data-mode-key="${esc(key)}" aria-pressed="${mode==='edit'}">Edit</button>`, 'Change the wording and structure of this document.')}
      ${withTip(`<button type="button" data-mode="preview" data-mode-key="${esc(key)}" aria-pressed="${mode==='preview'}">Preview</button>`, 'See this document the way it will be read. Unsaved edits are included.')}
    </div>
  </div>`;
}

// A prerequisite explained where the work is, with a way to go and do it.
function prereqNotice(title, body, goKey, goLabel){
  return `<div class="notice notice--wait"><div>
    <div class="notice__t">${esc(title)}</div>
    <div class="notice__b">${body}${goKey && canOpenStep(goKey) ? ` <button type="button" class="btn btn--secondary btn--sm" data-go="${esc(goKey)}">${esc(goLabel)}</button>` : ''}</div>
  </div></div>`;
}

// Claude is optional on every document. When it is unavailable, say so beside
// the control rather than leaving a disabled button to explain itself.
function generateControls(key, has){
  const ready = Boolean(state.health?.hasKey);
  return `${withTip(`<button type="button" class="btn btn--secondary" data-act="generate" data-kind="${esc(key)}" ${ready?'':'disabled'}>${has?'Redraft with Claude':'Draft with Claude'}</button>`,
      has ? 'Replace this draft with a new one written from the profile and the search facts.' : 'Write a first draft from the adopted profile and the search facts. You edit it afterwards.')}
    ${ready ? '' : `<span class="t-small">No API key is configured, so drafting is unavailable. Write this by hand in Edit; nothing here depends on Claude.</span>`}`;
}

function docActionBar(key, has){
  return actionBar(
    `<button type="button" class="btn btn--primary" data-act="save-art" data-kind="${esc(key)}">Save edits</button>`,
    `${generateControls(key, has)}
     ${(key==='brochure'||key==='ads') && has ? withTip(`<button type="button" class="btn btn--ghost" data-act="print-pack" data-kind="${esc(key)}">Print for posting</button>`, TIPS.printPack) : ''}
     ${nextBtn(key).replace('btn--primary','btn--secondary')}`,
    'Saved edits stay on the file.',
    'Unsaved edits');
}

function vDraft(key){
  const s = state.search, meta = DRAFTS[key], has = Boolean(s.artifacts?.[key]);
  const mode = docMode(key);
  return shell(`
    ${head('Step '+stepNo(key), meta.title, meta.lede)}
    <div class="band"><div class="wrap stack">
      ${key==='ads' && !stepOf('brochure') ? '' : ''}
      ${!has ? `<div class="notice notice--info"><div><div class="notice__t">Nothing on file yet</div><div class="notice__b">${
        key==='ads' ? (stepOf('brochure')
          ? 'Build it from the brochure and the profile, or draft it with Claude. Color and layout come from the brochure, so the ads stay a matched packet.'
          : 'Write it here, or draft it with Claude from the ad plan and the profile. The '+esc(packageLabel(s.package))+' package has no brochure; this announcement is what gets posted.')
        : key==='contract' ? 'Write the sections here, or draft them with Claude from the profile. Either way it goes to counsel.'
        : 'Write it here, or draft it with Claude from the profile, then edit what it writes.'
      }</div></div></div>` : ''}
      ${docBar(key, has)}
      ${reviewBar(key, has)}
      ${key==='ads' && stepOf('brochure') ? packStudioBar(s.artifacts?.brochure || {}) : ''}
      ${key==='contract' ? modelToggle() : ''}
      ${mode==='preview'
        ? (has ? renderArtifact(key, s.artifacts[key])
               : emptyState('Nothing to preview yet','Switch to Edit and add the content, or draft it with Claude.'))
        : artifactEditor(key, s.artifacts?.[key])}
      ${mode==='edit' ? sourceJson(key, s.artifacts?.[key], true) : ''}
      ${docActionBar(key, has)}
    </div></div>`);
}

function stagePill(stage){
  const k = stage==='finalist'?'ok':stage==='declined'?'stop':stage==='semifinalist'?'wait':'info';
  return pill(k, STAGE_ONE[stage] || stage);
}

/* ===========================================================================
 * Outcomes and the search lifecycle
 *
 * Stage is where someone has reached. An outcome is how their part of the
 * search ended, and it is a separate fact: a finalist who withdrew is still a
 * finalist. The search's own lifecycle is separate again — closing a search
 * states that the work concluded, which filing it in Archive does not.
 * ========================================================================= */

// The current outcome for a candidate, which is the last entry recorded. A
// correction is another entry, so the earlier decision stays readable.
function outcomeOf(c){
  const list = c?.dispositions || [];
  return list.length ? list[list.length - 1] : null;
}

function outcomePill(c){
  const current = outcomeOf(c);
  if (!current) return '';
  const meta = OUTCOME[current.outcome];
  return meta ? pill(meta.pill, meta.label) : pill('idle', current.outcome);
}

/**
 * Why this candidate can no longer be advanced, or '' if they can.
 *
 * Scores already recorded stay: they are evidence of how the committee worked.
 * What stops is new activity that would contradict the outcome. The hire is
 * the exception — their file continues through contracting.
 */
function concludedBy(c){
  const current = outcomeOf(c);
  if (!current || current.outcome === 'selected') return '';
  return OUTCOME[current.outcome]?.label || '';
}

function lifecycleOf(s = state.search){
  return s?.lifecycle?.status || 'active';
}

function isFrozen(s = state.search){
  return ['closed', 'cancelled'].includes(lifecycleOf(s));
}

function frozenNotice(){
  const s = state.search;
  if (!s || !isFrozen(s)) return '';
  const status = lifecycleOf(s);
  const when = String(s.lifecycle?.closedAt || '').slice(0, 10);
  const why = s.lifecycle?.reason || '';
  return `<div class="notice notice--stop" role="status"><div>
    <div class="notice__t">This search is ${esc(status)}${when?' · '+esc(when):''}</div>
    <div class="notice__b">Edits, scoring and candidate submissions are closed. Every candidate link was revoked at closeout.${why?' Recorded reason: '+esc(why):''}
      ${canEdit()?' <button type="button" class="btn btn--secondary btn--sm" data-go="closeout">Open closeout</button>':''}</div>
  </div></div>`;
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

// List filters live per search, so returning from a candidate recovers the
// list context the user left (the Back requirement in the plan).
function listFilter(){
  const id = state.search?.id || '';
  if (!state.filters[id]) state.filters[id] = { q:'', stage:'', resp:'' };
  return state.filters[id];
}

/**
 * Text and response narrow the pool; a stage selects inside it.
 *
 * Keeping the two apart is what lets the stage counts stay stable while the
 * user moves between stages: the numbers are calculated after the text and
 * response filters and before the selected stage, so picking Finalists never
 * changes what the other counts say.
 */
function matchesTextAndResponse(c, f){
  if (f.resp === 'in' && !c.survey1) return false;
  if (f.resp === 'out' && c.survey1) return false;
  const q = f.q.trim().toLowerCase();
  if (!q) return true;
  return [c.name, c.cur, c.org].some(v => String(v||'').toLowerCase().includes(q));
}

function filterCandidates(list){
  const f = listFilter();
  return list.filter(c => matchesTextAndResponse(c, f) && (!f.stage || c.stage === f.stage));
}

function stageCounts(list){
  const f = listFilter();
  return stageTallies(list.filter(c => matchesTextAndResponse(c, f)));
}

function candidateRow(c){
  // Invitation links are a correction-shaped action, not list data: the raw
  // URL is never a column, and the controls that hand it out sit in a labelled
  // menu on the row rather than competing with Review.
  const invite = canEdit() ? menu('cand-'+c.id, 'Invite', [
    withTip(`<button type="button" class="btn btn--ghost btn--sm" data-act="copy-invite" data-cid="${c.id}">Copy invite link</button>`, TIPS.copyInvite),
    withTip(`<a class="btn btn--ghost btn--sm" href="/apply/${esc(c.invite)}" target="_blank" rel="noopener">Open questionnaire</a>`, TIPS.openQuestionnaire),
    withTip(`<button type="button" class="btn btn--ghost btn--sm" data-act="replace-invite" data-cid="${c.id}">Replace candidate link</button>`, TIPS.replaceInvite)
  ]) : '';
  return `<tr>
    <th scope="row"><button type="button" class="candlink" data-cand="${c.id}">${esc(c.name)}</button>
      <span class="candmeta">${esc(c.cur||'')}${c.cur && c.org ? ' · ' : ''}${esc(c.org||'')}</span></th>
    <td data-label="Stage">${stagePill(c.stage)}${outcomePill(c)}</td>
    <td data-label="Response">${c.survey1 ? pill('ok','Response in') : pill('idle','No response')}</td>
    <td data-label="Actions" class="candacts">
      ${withTip(`<button type="button" class="btn btn--secondary btn--sm" data-cand="${c.id}">Review</button>`,
        'Open this candidate to read their responses and score them against the profile.')}
      ${invite}
    </td>
  </tr>`;
}

/**
 * Who still needs chasing.
 *
 * The question a consultant asks every morning, and the one thing a contact
 * log is actually for. Computed by the server so this panel and the exported
 * record cannot disagree about who was contacted.
 */
function followUpPanel(){
  const f = state.followUps;
  if (!canEdit() || !f || !f.total) return '';
  const names = list => list.slice(0, 8).map(p =>
    `<button type="button" class="btn btn--ghost btn--sm" data-cand="${esc(p.id)}">${esc(p.name)}</button>`).join('')
    + (list.length > 8 ? `<span class="t-small"> and ${list.length - 8} more</span>` : '');

  return `<div class="spec"><div class="spec__bar">Follow-up ${pill(f.due.length?'wait':'idle', f.total+' to chase')}</div>
    <div class="spec__body stack stack--tight">
      ${f.due.length ? `<div><div class="t-label">Follow-up date has passed</div>
        <div class="row">${names(f.due)}</div></div>` : ''}
      ${f.uncontacted.length ? `<div><div class="t-label">No contact recorded yet</div>
        <div class="row">${names(f.uncontacted)}</div></div>` : ''}
      <p class="t-small">Contact is logged by hand on each candidate. Slate sends nothing, so this
        reflects what staff recorded, not what a mail server delivered.</p>
    </div></div>`;
}

function vScreen(){
  const s = state.search;
  const all = s.candidates || [];
  const f = listFilter();
  const shown = filterCandidates(all);
  const addOpen = Boolean(state.open.addcand);
  const rows = shown.map(candidateRow).join('');
  return shell(`
    ${head('This search','Candidates',
      canEdit()
        ? 'Read each response against the adopted profile, score the person, and advance the ones you want as semifinalists.'
        : 'Score each candidate against the profile the committee adopted. Your scores stay private until the account manager releases them.',
      canEdit() ? `<button type="button" class="btn btn--primary" data-panel="addcand" aria-expanded="${addOpen}" aria-controls="addcand" data-open-label="Add a candidate" data-close-label="Close this form">${addOpen?'Close this form':'Add a candidate'}</button>` : '')}
    <div class="band"><div class="wrap stack">
      ${canEdit() && s.invitesRotatedAt ? '<div class="notice notice--info">Candidate links were replaced during the privacy update. Share the current links below; links issued before the update no longer work.</div>' : ''}
      ${followUpPanel()}
      ${!all.length ? emptyState(
          canEdit() ? 'No candidates on the file yet' : 'No candidates yet',
          canEdit()
            ? 'Add people as applications come in, then hand each person their invite link from the row menu. Later steps wait until someone is on the file.'
            : 'You will be asked to score applicants here once they apply.',
          canEdit() ? `<button type="button" class="btn btn--primary" data-panel="addcand" aria-expanded="${addOpen}" aria-controls="addcand" data-open-label="Add a candidate" data-close-label="Close this form">${addOpen?'Close this form':'Add a candidate'}</button>` : '')
      : `${stageBar(stageCounts(all), f.stage, 'filter')}
        <div class="listbar">
          ${field('Find a candidate','', `<input class="input" id="cand-filter" data-filter="q" data-nodirty type="search" placeholder="Name, title, or organization" value="${esc(f.q)}">`)}
          ${field('Response','', `<select class="input" id="cand-resp" data-filter="resp" data-nodirty>
            <option value="">Any response</option>
            <option value="in" ${f.resp==='in'?'selected':''}>Response in</option>
            <option value="out" ${f.resp==='out'?'selected':''}>No response yet</option>
          </select>`)}
          ${f.q || f.stage || f.resp ? `<div class="listbar__act"><button type="button" class="btn btn--secondary" data-act="clear-filters">Clear filters</button></div>` : ''}
        </div>`}
      ${canEdit() ? `<div id="addcand"${addOpen?'':' hidden'}>
        <form id="newcand" class="stack stack--tight">
          ${sectionHead('Add a candidate')}
          <div class="formgrid">
            ${field('Name','', `<input class="input" name="name" placeholder="Full name" required>`, { req:true })}
            ${field('Current title','', `<input class="input" name="cur">`)}
            ${field('Organization','', `<input class="input" name="org">`)}
            ${field('Email','Not used to send anything. Kept on the file.', `<input class="input" name="email" type="email">`)}
          </div>
          <div class="row"><button class="btn btn--primary" type="submit">Add to the file</button></div>
        </form>
      </div>` : ''}
      ${all.length ? `<div class="tablewrap"><table class="candtable">
        <caption class="listcount">Showing ${shown.length} of ${all.length} candidate${all.length===1?'':'s'}${f.stage?' · '+esc(STAGE_LABEL[f.stage]||f.stage):''}</caption>
        <thead><tr><th scope="col">Candidate</th><th scope="col">Stage</th><th scope="col">Response</th><th scope="col">Actions</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4">No candidate matches these filters. <button type="button" class="btn btn--ghost btn--sm" data-act="clear-filters">Clear filters</button></td></tr>`}</tbody>
      </table></div>` : ''}
      ${actionBar(
        nextBtn('screen') || `<button class="btn btn--primary" data-go="overview">Back to this search</button>`,
        canEdit() ? withTip(`<button type="button" class="btn btn--secondary" data-act="toggle-release">${s.released?'Seal scores':'Release scores'}</button>`, s.released ? TIPS.seal : TIPS.release) : '',
        canEdit() ? (s.released ? 'Panel scores are visible to the committee.' : 'Each person sees only their own scores.') : '')}
    </div></div>`);
}

function vSend2(){
  const s = state.search;
  const list = (s.candidates||[]).filter(c => c.stage==='semifinalist' || c.stage==='finalist');
  const rows = list.map(c => `
    <tr>
      <th scope="row"><span class="candname">${esc(c.name)}</span>
        <span class="candmeta">${c.survey2SentAt ? 'Opened '+esc((c.survey2SentAt||'').slice(0,10)) : 'Not opened'}${c.survey2Deadline?' · due '+esc(c.survey2Deadline):''}</span></th>
      <td data-label="Stage">${stagePill(c.stage)}</td>
      <td data-label="Response">${c.survey2 ? pill('ok','Response in') : pill('idle','Waiting')}</td>
      <td data-label="Actions" class="candacts">
        ${canEdit() && !c.survey2 && !c.survey2SentAt
          ? withTip(`<button type="button" class="btn btn--primary btn--sm" data-act="send2-one" data-cid="${c.id}">Open questionnaire</button>`,
              'Make the semifinalist questionnaire available on this candidate’s existing invite link.')
          : ''}
        ${canEdit() ? withTip(`<button type="button" class="btn btn--secondary btn--sm" data-act="copy-invite" data-cid="${c.id}">Copy invite</button>`, TIPS.copyInvite) : ''}
        ${withTip(`<button type="button" class="btn btn--ghost btn--sm" data-cand="${c.id}">Review</button>`, 'Open this candidate to read their responses and scores.')}
      </td>
    </tr>`).join('');
  return shell(`
    ${head('Step '+stepNo('send2'),'Open semifinalist questionnaire','Open the questionnaire after naming semifinalists. Then contact each candidate yourself and share their existing applicant link. Opening it does not send an email.')}
    <div class="band"><div class="wrap stack">
      ${!s.artifacts?.survey2 ? `<div class="notice notice--info"><div><div class="notice__t">Survey not drafted yet</div><div class="notice__b">Finish the semifinalist survey (Step ${stepNo('survey2')}), then send it from this page.</div></div></div>` : ''}
      ${field('Deadline','Requested response date, shown to candidates. Late responses are accepted.', `<input class="input" id="send2-deadline" data-nodirty placeholder="Respond by 12 Sep 2026">`)}
      ${list.length ? `<div class="tablewrap"><table class="candtable">
        <thead><tr><th scope="col">Semifinalist</th><th scope="col">Stage</th><th scope="col">Response</th><th scope="col">Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : emptyState('No semifinalists yet',
        'Advance people from Screening, then open the questionnaire for them here.',
        openBtn('screen','Open screening', true))}
      ${actionBar(
        nextBtn('send2'),
        canEdit() && list.length
          ? withTip(`<button type="button" class="btn btn--secondary" data-act="send2-all">Open for all semifinalists</button>`,
              'Make the semifinalist questionnaire available to every semifinalist at once.')
          : '',
        'Opening a questionnaire does not send an email.')}
    </div></div>`);
}

function vFinalists(){
  const s = state.search;
  const list = (s.candidates||[]).filter(c => c.stage==='semifinalist' || c.stage==='finalist');
  const survey = s.artifacts?.survey2;
  const cards = list.map(c => `
    <div class="spec">
      <div class="spec__bar">${esc(c.name)} · ${esc(c.stage)}${c.survey2?' · response in':''}</div>
      <div class="spec__body stack">
        ${surveyRead(survey, c.survey2)}
        <div class="row">
          ${withTip(`<button type="button" class="btn btn--ghost btn--sm" data-cand="${c.id}">Review and score</button>`, 'Open this candidate to read every response and score them.')}
          ${canEdit() && c.stage==='semifinalist'
            ? withTip(`<button type="button" class="btn btn--secondary btn--sm" data-act="advance-final" data-cid="${c.id}">Advance to finalist</button>`, TIPS.advanceFinal)
            : ''}
        </div>
      </div>
    </div>`).join('');
  return shell(`
    ${head('Step '+stepNo('finalists'),'Select finalists','Read the semifinalist responses against the adopted profile. Do not introduce new criteria here.')}
    <div class="band"><div class="wrap stack">
      ${cards || emptyState('No semifinalists yet',
        'Screen and advance people, then open the semifinalist questionnaire for them.',
        openBtn('screen','Open screening', true))}
      ${actionBar(nextBtn('finalists'), `<button type="button" class="btn btn--secondary" data-go="screen">Back to screening</button>`)}
    </div></div>`);
}

/* ===========================================================================
 * Candidate documents and contact log (DEP-08)
 *
 * Slate holds neither. A resume lives in the county-approved repository and a
 * message is sent by a person from their own mailbox; what is recorded here is
 * that a document was received and where it is, and that staff say they made
 * contact. Both screens are written to say exactly that, because a search
 * record that implies more than the application knows is worse than no record.
 * ========================================================================= */

function documentRow(c, d){
  const kind = DOC_KIND[d.kind] || { label:d.kind, restricted:false };
  return `<div class="hubrow">
    <div class="hubrow__id"><b>${esc(d.label)}</b>
      <div class="t-small">${esc(kind.label)} · received ${esc(String(d.receivedAt||'').slice(0,10))}${d.recordedByName?' · recorded by '+esc(d.recordedByName):''}
        ${d.url ? `<br><a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">Open in the repository</a>` : '<br>No link recorded.'}
        ${d.note ? '<br>'+esc(d.note) : ''}</div></div>
    <div class="hubrow__st">${d.restricted ? pill('stop','Restricted') : ''}</div>
    <div class="hubrow__act"><button type="button" class="btn btn--ghost btn--sm" data-act="drop-doc" data-cid="${esc(c.id)}" data-docid="${esc(d.id)}" data-label="${esc(d.label)}">Remove</button></div>
  </div>`;
}

function documentsPanel(c){
  const list = c.documents || [];
  const open = Boolean(state.open['doc-'+c.id]);
  return `<div class="spec"><div class="spec__bar">Documents received ${pill(list.length?'ok':'idle', String(list.length))}</div>
    <div class="spec__body stack stack--tight">
      <p class="t-small">A reference to a document, not the document. Access stays whatever the repository
        grants; recording a link here does not widen it. Reference and background material is marked
        restricted and is narrower than the rest of the file.</p>
      ${list.length ? list.map(d => documentRow(c, d)).join('')
        : '<div class="t-small">Nothing recorded yet.</div>'}
      <div class="row"><button type="button" class="btn btn--secondary btn--sm" data-panel="doc-${esc(c.id)}"
        aria-expanded="${open}" aria-controls="docform-${esc(c.id)}"
        data-open-label="Record a document" data-close-label="Close this form">${open?'Close this form':'Record a document'}</button></div>
      <div id="docform-${esc(c.id)}"${open?'':' hidden'}>
        <form id="docform" class="stack stack--tight" data-cid="${esc(c.id)}">
          <div class="formgrid">
            ${field('Type','', `<select class="input" name="kind">${Object.entries(DOC_KIND).map(([k,v])=>`<option value="${esc(k)}">${esc(v.label)}</option>`).join('')}</select>`)}
            ${field('Label','What this document is, in a few words.', `<input class="input" name="label" placeholder="Resume, received 4 Sep" required>`, { req:true })}
            ${field('Link','https only, to the approved repository. Leave blank if it is held offline.', `<input class="input" name="url" placeholder="https://">`, { span:true })}
            ${field('Note','', `<textarea class="input ed" name="note"></textarea>`, { span:true })}
          </div>
          <div class="row"><button type="button" class="btn btn--primary btn--sm" data-act="add-doc" data-cid="${esc(c.id)}">Record this document</button></div>
        </form>
      </div>
    </div></div>`;
}

function contactRow(e){
  return `<div class="feed__i">
    <span class="feed__w">${esc(CHANNEL[e.channel]||e.channel)} · ${esc(PURPOSE[e.purpose]||e.purpose)}</span>
    <span class="feed__x">${esc(e.summary)}${e.followUpOn?' · follow up '+esc(e.followUpOn):''}${e.actorName?' · '+esc(e.actorName):''}</span>
    <span class="feed__t">${esc(String(e.at||'').slice(0,10))}</span>
  </div>`;
}

function contactPanel(c){
  const log = c.communications || [];
  const open = Boolean(state.open['comm-'+c.id]);
  const today = new Date().toISOString().slice(0,10);
  return `<div class="spec"><div class="spec__bar">Contact log ${pill(log.length?'ok':'idle', String(log.length))}</div>
    <div class="spec__body stack stack--tight">
      <p class="t-small">Staff-recorded contact. Slate has no mail server and cannot confirm delivery, so
        every line here says what someone recorded doing, not what a candidate received.</p>
      ${log.length ? `<div class="feed">${log.map(contactRow).join('')}</div>`
        : '<div class="t-small">No contact recorded yet.</div>'}
      <div class="row"><button type="button" class="btn btn--secondary btn--sm" data-panel="comm-${esc(c.id)}"
        aria-expanded="${open}" aria-controls="commform-${esc(c.id)}"
        data-open-label="Log contact" data-close-label="Close this form">${open?'Close this form':'Log contact'}</button></div>
      <div id="commform-${esc(c.id)}"${open?'':' hidden'}>
        <form id="commform" class="stack stack--tight" data-cid="${esc(c.id)}">
          <div class="formgrid">
            ${field('How','', `<select class="input" name="channel">${Object.entries(CHANNEL).map(([k,v])=>`<option value="${esc(k)}">${esc(v)}</option>`).join('')}</select>`)}
            ${field('About','', `<select class="input" name="purpose">${Object.entries(PURPOSE).map(([k,v])=>`<option value="${esc(k)}">${esc(v)}</option>`).join('')}</select>`)}
            ${field('What was communicated','', `<textarea class="input ed" name="summary" required></textarea>`, { span:true, req:true })}
            ${field('Follow up on','Leave blank if nothing is owed. Dated follow-ups appear on the candidate list.', `<input class="input" name="followUpOn" type="date" min="${esc(today)}">`)}
          </div>
          <div class="row"><button type="button" class="btn btn--primary btn--sm" data-act="log-contact" data-cid="${esc(c.id)}">Record this contact</button></div>
        </form>
      </div>
    </div></div>`;
}

/* ===========================================================================
 * Candidate outcome (DEP-09)
 *
 * A decision is an event, never an edit. Correcting one adds an entry that
 * names what it supersedes, so the file shows both what was decided and that
 * it was later changed — which is the whole point of keeping it.
 * ========================================================================= */

function outcomeHistory(c){
  const list = c.dispositions || [];
  if (!list.length) return '';
  return `<div class="spec"><div class="spec__bar">Decision history · ${list.length}</div>
    <div class="spec__body stack stack--tight">
      ${list.slice().reverse().map(d => {
        const meta = OUTCOME[d.outcome] || { label:d.outcome, pill:'idle' };
        const superseded = list.some(other => other.supersedes === d.id);
        return `<div class="spec"><div class="spec__bar">${pill(meta.pill, meta.label)}
          ${superseded ? pill('idle','Superseded') : ''}${d.supersedes ? pill('info','Correction') : ''}</div>
          <div class="spec__body stack stack--tight">
            ${kv('Recorded', esc(String(d.at||'').slice(0,16).replace('T',' ')) + (d.actorName ? ' · '+esc(d.actorName) : ''))}
            ${kv('Basis', esc(OUTCOME_SOURCE[d.source] || d.source || ''))}
            ${kv('Reason', esc(d.reason||''))}
            ${d.evidence ? kv('Job-related evidence', esc(d.evidence)) : ''}
          </div></div>`;
      }).join('')}
    </div></div>`;
}

function outcomePanel(c){
  const current = outcomeOf(c);
  const frozen = isFrozen();
  return `<div class="stack">
    <div class="spec"><div class="spec__bar">Outcome</div>
      <div class="spec__body stack stack--tight">
        ${current
          ? `<p class="t-small">Recorded as ${outcomePill(c)} on ${esc(String(current.at||'').slice(0,10))}. Recording another outcome
              corrects this one; the entry above stays on the file.</p>`
          : `<p class="t-small">Nothing recorded. This candidate is still in process.</p>`}
        <p class="t-small">An outcome is separate from stage. Withdrawing, declining and non-selection all
          revoke this candidate's questionnaire link; selection does not, because the hire's file continues
          through contracting.</p>
      </div></div>

    ${frozen ? `<div class="notice notice--info"><div><div class="notice__t">The search is ${esc(lifecycleOf())}</div>
      <div class="notice__b">Reopen it from closeout before recording anything further.</div></div></div>` : `
    <div class="spec"><div class="spec__bar">${current ? 'Correct the outcome' : 'Record an outcome'}</div>
      <div class="spec__body">
        <form id="outcomeform" class="stack stack--tight" data-cid="${esc(c.id)}">
          <div class="formgrid">
            ${field('Outcome','', `<select class="input" name="outcome">
              ${Object.entries(OUTCOME).map(([k,v])=>`<option value="${esc(k)}">${esc(v.label)}</option>`).join('')}
            </select>`)}
            ${field('Reason','Why this decision was made. Required.', `<textarea class="input ed" name="reason" required></textarea>`, { span:true, req:true })}
            ${field('Job-related evidence','Required for Selected and Not selected. Name the criteria, scores or responses the decision rests on.',
              `<textarea class="input ed" name="evidence"></textarea>`, { span:true })}
          </div>
          <p class="t-small">${Object.entries(OUTCOME).map(([,v]) => '<b>'+esc(v.label)+'</b> — '+esc(v.hint)).join('<br>')}</p>
          ${current ? `<label class="t-small u-inline-check"><input type="checkbox" name="correction" checked>
            Record this as a correction of the ${esc(OUTCOME[current.outcome]?.label || current.outcome)} entry</label>` : ''}
          <div class="row"><button type="button" class="btn btn--primary" data-act="record-outcome" data-cid="${esc(c.id)}">Record this outcome</button></div>
        </form>
      </div></div>`}

    ${outcomeHistory(c)}
  </div>`;
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
  // An outcome that ended this person's participation stops new advancement.
  // The scores they already have stay exactly where they are.
  const concluded = concludedBy(c);
  const nextStage = concluded ? '' : c.stage==='applicant' ? 'semifinalist' : c.stage==='semifinalist' ? 'finalist' : '';
  const nextLabel = nextStage==='semifinalist' ? 'Advance to semifinalist' : nextStage==='finalist' ? 'Advance to finalist' : '';
  const scoredCount = (s.criteria||[]).filter(cr => mine[cr.id]).length;

  // Scoring, grouped by what the committee adopted. Each scale is a named
  // group with its endpoints written out rather than a bare row of numbers.
  const groups = Object.keys(KIND).map(k => {
    const rows = (s.criteria||[]).filter(cr => cr.kind===k);
    if (!rows.length) return '';
    // The scale is explained once for the group rather than repeated beside
    // every criterion, and each group still carries the criterion's own name
    // for anyone who cannot see the row it sits in.
    return `${sectionHead(KIND[k].plural, rows.length+' criteria')}
      <p class="t-small">Score each one from 1 (does not meet) to 5 (strongest).</p>
      <div>${rows.map(cr => `<div class="scorerow">
        <div>
          <b>${esc(cr.label)}</b>
          <div class="scorerow__id"><span class="mono">${esc(cr.id)}</span>${cr.weight?' · weight '+esc(cr.weight):''}</div>
          ${cr.note?`<div class="t-small">${esc(cr.note)}</div>`:''}
        </div>
        ${ratingGroup(cr.label+' — score from 1, does not meet, to 5, strongest',
          `<div class="wgt">${[1,2,3,4,5].map(n=>`<button type="button" data-score="${esc(cr.id)}" data-val="${n}" aria-label="${esc(cr.label)}: ${n} of 5" aria-pressed="${Number(mine[cr.id])===n}">${n}</button>`).join('')}</div>`)}
      </div>`).join('')}</div>`;
  }).join('');

  // What the candidate actually said, beside the scoring rather than below it.
  const evidence = `
    ${c.survey1 ? `${sectionHead('Initial survey response')}${surveyRead(s.artifacts?.survey1, c.survey1)}` : ''}
    ${c.survey2 ? `${sectionHead('Semifinalist response')}${surveyRead(s.artifacts?.survey2, c.survey2)}` : ''}
    ${!c.survey1 && !c.survey2 ? emptyState('No questionnaire response yet',
        'Share this candidate’s invite link from Screening. Their answers appear here once they submit.') : ''}
    ${!sealed && others.length ? `<div class="spec"><div class="spec__bar">Released panel scores</div><div class="spec__body">${others.map(row => `<div class="t-small"><b>${esc(row.name)}</b> — ${Object.entries(row.scores).map(([id,n])=>esc(id)+': '+esc(n)).join(', ')}</div>`).join('')}</div></div>`:''}`;

  // What this candidate's own record actually holds. Every line is a value
  // stored on the candidate, so nothing here is inferred from unrelated search
  // events; there is no per-candidate event log to draw one from.
  const record = [
    ['Added to the file', (c.addedAt||'').slice(0,10)],
    ['Initial questionnaire', c.survey1 ? 'Answered '+String(c.survey1.at||'').slice(0,10) : 'No response on file'],
    ...(stepOf('send2') ? [['Semifinalist questionnaire', c.survey2 ? 'Answered '+String(c.survey2.at||'').slice(0,10)
      : c.survey2SentAt ? 'Opened '+String(c.survey2SentAt).slice(0,10)+(c.survey2Deadline?' · due '+c.survey2Deadline:'') : 'Not opened']] : []),
    ...(c.referenceConsentAt ? [['Reference consent', 'Recorded '+String(c.referenceConsentAt).slice(0,10)]] : []),
    ['Email', c.email || ''],
    ['Years in the field', c.yrs ? String(c.yrs) : '']
  ].filter(([, v]) => v !== '');

  return shell(`
    ${head('Candidate', c.name,
      `${esc(c.cur||'')}${c.cur && c.org ? ', ' : ''}${esc(c.org||'')} ${stagePill(c.stage)}${outcomePill(c)}`,
      canEdit() && nextStage
        ? withTip(`<button type="button" class="btn btn--secondary" data-act="advance" data-stage="${nextStage}">${esc(nextLabel)}</button>`,
            nextStage==='semifinalist' ? TIPS.advanceSemi : TIPS.advanceFinal)
        : '')}
    <div class="band"><div class="wrap stack">
      ${secTabs('person', [
        { key:'review', label:'Review' },
        { key:'details', label:'Details' },
        ...(canEdit() ? [{ key:'outcome', label:'Outcome' }] : [])
      ])}
      ${concluded ? `<div class="notice notice--info" role="status"><div>
        <div class="notice__t">${esc(concluded)}</div>
        <div class="notice__b">Scores already recorded stay on the file as evidence of how the committee worked.
          This candidate cannot be advanced or newly evaluated while that outcome stands.</div></div></div>` : ''}
      <div data-tabpanel="person:review" role="tabpanel" id="panel-person-review" aria-labelledby="tab-person-review" tabindex="0" class="stack"${(state.tab?.person||'review')==='review'?'':' hidden'}>
        ${sealed?`<div class="seal">${ico('lock')}<div><div class="empty__t">Other scores are sealed</div><div class="t-small">Enter your scores. You will see the rest of the panel after the account manager releases scores.</div></div></div>`:''}
        <div class="colswitch" role="group" aria-label="What to show">
          <button type="button" data-col="both" aria-pressed="${(state.reviewCol||'both')==='both'}">Both</button>
          <button type="button" data-col="evidence" aria-pressed="${state.reviewCol==='evidence'}">Evidence</button>
          <button type="button" data-col="scorecard" aria-pressed="${state.reviewCol==='scorecard'}">Scorecard</button>
        </div>
        <div class="review2 review2--${esc(state.reviewCol||'both')}">
          <div class="review2__col review2__col--evidence">${evidence}</div>
          <div class="review2__col review2__col--scorecard">
            ${(s.criteria||[]).length ? groups : emptyState('No profile adopted yet',
              'Scoring is against the criteria the committee adopted in the candidate profile.')}
            ${field('Note to the file','Only you and the search team see this.', `<textarea class="input ed" id="cnote">${esc(note)}</textarea>`)}
          </div>
        </div>
      </div>
      <div data-tabpanel="person:details" role="tabpanel" id="panel-person-details" aria-labelledby="tab-person-details" tabindex="0" class="stack"${(state.tab?.person||'review')==='details'?'':' hidden'}>
        <div class="spec"><div class="spec__bar">Record</div>
          <div class="spec__body">${record.map(([k, v]) => kv(k, esc(v))).join('')}</div></div>
        ${canEdit() ? documentsPanel(c) : ''}
        ${canEdit() ? contactPanel(c) : ''}
        ${canEdit() ? `<div class="spec"><div class="spec__bar">Candidate link and corrections</div><div class="spec__body stack stack--tight">
          ${c.invite
            ? `<p class="t-small">Current invite link: <span class="mono">${esc(location.origin+'/apply/'+c.invite)}</span></p>`
            : `<p class="t-small">This candidate has no live link. It was revoked${c.inviteRevokedAt?' on '+esc(String(c.inviteRevokedAt).slice(0,10)):''}, and reissuing one is a deliberate act.</p>`}
          <div class="row">
            ${c.invite ? withTip(`<button type="button" class="btn btn--secondary btn--sm" data-act="copy-invite" data-cid="${c.id}">Copy invite</button>`, TIPS.copyInvite) : ''}
            ${withTip(`<button type="button" class="btn btn--secondary btn--sm" data-act="replace-invite" data-cid="${c.id}">${c.invite?'Replace candidate link':'Issue a new link'}</button>`, TIPS.replaceInvite)}
            ${['survey1','survey2'].filter(k=>c[k]).map(k=>withTip(`<button type="button" class="btn btn--secondary btn--sm" data-act="reopen-survey" data-cid="${c.id}" data-which="${k}">Reopen ${k==='survey1'?'initial':'semifinalist'} questionnaire</button>`, TIPS.reopenSurvey)).join('')}
          </div>
        </div></div>` : ''}
      </div>
      ${canEdit() ? `<div data-tabpanel="person:outcome" role="tabpanel" id="panel-person-outcome" aria-labelledby="tab-person-outcome" tabindex="0" class="stack"${(state.tab?.person||'review')==='outcome'?'':' hidden'}>
        ${outcomePanel(c)}
      </div>` : ''}
      ${actionBar(
        withTip(`<button type="button" class="btn btn--primary" data-act="save-score">Save my scores</button>`, TIPS.saveScores),
        `<button type="button" class="btn btn--secondary" data-go="screen">Back to candidates</button>`,
        scoredCount+' of '+((s.criteria||[]).length)+' criteria scored',
        'Unsaved scores')}
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

  return '<div class="apply-help u-mt-5" id="apply-help" tabindex="-1">'
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
  const questions = survey.questions || [];
  const required = questions.filter(q => q.required).length;
  return `<div class="apply-shell">
    ${head(a.client, title, esc(survey.intro||'')+due)}
    <div class="applymeta">
      <p class="t-small"><b>${questions.length} question${questions.length===1?'':'s'}.</b>
        ${required ? esc(required)+' of them must be answered; those are marked with an asterisk. ' : 'None of them are required. '}
        Answers are saved only when you submit, so finish in one sitting.</p>
      <p class="t-small"><button type="button" class="btn btn--ghost btn--sm" data-act="jump" data-to="apply-help">Need help or an accommodation?</button></p>
    </div>
    <form id="applyform" class="stack u-mt-5" data-which="${which}">
      ${questions.map(q => `
        <div class="q">
          <div class="q__hd"><span class="q__n" aria-hidden="true">${String(q.n).padStart(2,'0')}</span><span class="q__t" id="q${q.n}-label">${esc(q.prompt)}${q.required?' <span class="req" aria-hidden="true">*</span>':''}</span></div>
          <div class="q__bd"><textarea class="input ed" name="q${q.n}" id="q${q.n}-input" aria-labelledby="q${q.n}-label" ${q.required?'required aria-required="true"':''}></textarea></div>
        </div>`).join('')}
      <div class="applybar">
        <button class="btn btn--primary" type="submit">Submit questionnaire</button>
        <span class="t-small" id="applycount" role="status" data-total="${questions.length}">0 of ${questions.length} answered</span>
      </div>
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
      <th scope="row"><span class="candname">${esc(c.name)}</span></th>
      <td data-label="Stage">${stagePill(c.stage)}</td>
      <td data-label="Consent">${c.referenceConsentAt ? pill('ok','Consent on file')+' <span class="t-small">'+esc((c.referenceConsentAt||'').slice(0,10))+(c.referenceConsentBy?' · '+esc(c.referenceConsentBy):'')+'</span>' : pill('wait','No consent yet')}</td>
      <td data-label="Actions" class="candacts">${canEdit() ? withTip(`<button type="button" class="btn btn--${c.referenceConsentAt?'ghost':'secondary'} btn--sm" data-act="ref-consent" data-cid="${c.id}" data-on="${c.referenceConsentAt?'0':'1'}">${c.referenceConsentAt?'Withdraw':'Record consent'}</button>`,
        c.referenceConsentAt ? 'Remove this finalist’s consent. Reference entries about them are blocked again.' : 'Record that this finalist agreed to have their references contacted.') : ''}</td>
    </tr>`).join('') : '';
  const logged = (rec.log||[]).length;
  return shell(`
    ${head('Step '+stepNo(key), meta.title, meta.lede+' '+pill(done?'ok':logged?'wait':'idle', done?'Complete':logged?logged+' logged':'Not started')+' '+pill('info','Staff work'))}
    <div class="band"><div class="wrap stack">
      ${st.blocked ? prereqNotice(stepWaitCopy(st, s),
        'You can still log work here; the step reads as waiting until what it depends on is done.',
        st.needsCandidates ? 'screen' : '', 'Open screening') : ''}
      ${done ? `<div class="notice notice--ok"><div><div class="notice__t">Completed ${esc((rec.doneAt||'').slice(0,10))} by ${esc(rec.doneByName||'a consultant')}</div><div class="notice__b">Logging anything new reopens the step.</div></div></div>` : ''}
      ${key==='references' ? `<div class="spec"><div class="spec__bar">Consent to contact references</div>
        <div class="spec__body">
          <p class="t-small u-mb-3">Nothing is logged for a finalist until their consent is on this table.</p>
          ${consentRows ? `<div class="tablewrap"><table class="candtable">
            <thead><tr><th scope="col">Finalist</th><th scope="col">Stage</th><th scope="col">Consent</th><th scope="col">Actions</th></tr></thead>
            <tbody>${consentRows}</tbody>
          </table></div>` : emptyState('No finalists yet',
            'Reference checks are for finalists only. Name them first, then record each one’s consent here.',
            openBtn('finalists','Open Step '+stepNo('finalists')+' · Select finalists', true))}
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
        <div class="spec__body">${(rec.log||[]).length
          ? `<div class="feed">${(rec.log||[]).map(e => staffLogEntry(key, e)).join('')}</div>`
          : emptyState('Nothing logged yet', esc(meta.ask)+' Each entry is dated and attributed. Nothing here reaches the committee.')}</div>
      </div>
      ${canEdit() ? `<div class="spec"><div class="spec__bar">Working notes</div>
        <div class="spec__body stack">
          ${field('Notes for this step','Not published; not shown to the committee.',
            `<textarea class="input ed" id="staff-notes" placeholder="Running notes for this step.">${esc(rec.notes||'')}</textarea>`)}
          <div class="row"><button type="button" class="btn btn--secondary" data-act="staff-notes" data-key="${key}">Save notes</button></div>
        </div></div>` : ''}
      ${actionBar(
        canEdit()
          ? withTip(`<button type="button" class="btn btn--${done?'secondary':'primary'}" data-act="staff-done" data-key="${esc(key)}" data-done="${done?'0':'1'}">${done?'Reopen this step':'Mark complete'}</button>`,
              done ? 'Reopen the step so more work can be logged against it.' : esc(meta.doneWhen))
          : '',
        nextBtn(key).replace('btn--primary','btn--secondary'),
        esc(meta.doneWhen))}
    </div></div>`);
}

function vArchives(){
  const list = state.archives || [];
  return shell(`${head('Workspace','Archived searches','Nothing here is deleted. Restoring a search brings back its documents, responses, and history, and issues fresh candidate links.')}
    <div class="band"><div class="wrap stack">
      ${list.length ? list.map(s => `<div class="spec"><div class="spec__body">
        <div class="hubrow">
          <div class="hubrow__id"><b>${esc(s.client)}</b> · ${esc(s.position)}<div class="t-small">Archived ${esc(s.archivedAt)}</div></div>
          <div class="hubrow__st"></div>
          <div class="hubrow__act">${withTip(`<button type="button" class="btn btn--secondary btn--sm" data-act="restore-search" data-id="${esc(s.id)}">Restore search</button>`,
            'Put this search back on the book. Candidate links are reissued, so the old ones stay dead.')}</div>
        </div>
      </div></div>`).join('')
      : emptyState('No archived searches',
        'Searches archived from Home appear here and can be restored at any time.',
        `<button type="button" class="btn btn--secondary" data-go="home">Back to Home</button>`)}
    </div></div>`);
}

function vHistory(){
  const entries = (state.history?.history || []).map((entry, index) => ({ ...entry, index })).reverse();
  return shell(`${head('This search','History and recovery','Previous copy and evaluations stay on file. Restoring a profile clears current scores, because they were given against the old one.')}
    <div class="band"><div class="wrap stack">
      ${entries.length ? entries.map(e => `<details class="spec"><summary class="spec__bar">${esc(e.key || e.kind)} · ${esc(e.at)} · ${esc(e.who)}</summary><div class="spec__body stack stack--tight">
        ${e.criteria ? `<p class="t-small">Profile revision ${esc(e.revision)}</p><ul>${e.criteria.map(c => `<li>${esc(c.id)}: ${esc(c.label)} (weight ${esc(c.weight)})</li>`).join('')}</ul>` : ''}
        ${historyRecord(e)}
        ${['artifact','profile','facts'].includes(e.kind) ? `<div class="row">${withTip(`<button type="button" class="btn btn--secondary btn--sm" data-act="restore-history" data-index="${e.index}">Restore this ${e.kind==='artifact'?'copy':e.kind}</button>`,
          'Bring this saved version back as the current one. The version it replaces stays in this list.')}</div>` : ''}
      </div></details>`).join('')
      : emptyState('No previous revisions yet',
        'Saved versions appear here as documents are edited, profiles are adopted, and responses are corrected.',
        openBtn('profile','Open the candidate profile') || `<button type="button" class="btn btn--secondary" data-go="overview">Back to this search</button>`)}
      <details class="spec"><summary class="spec__bar">Activity record</summary><div class="spec__body">${(state.history?.activity || []).map(e=>`<p class="t-small">${esc(e.at)} · ${esc(e.who)}: ${esc(e.x)}</p>`).join('') || '<p class="t-small">Nothing recorded yet.</p>'}</div></details>
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
  if (!state.user) return vGate();
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
    case 'interviews': return vInterviews();
    case 'committee': return vCommittee();
    case 'documents': return vDocuments();
    case 'activity': return vActivity();
    case 'process': return vProcess();
    case 'facts': return vFacts();
    case 'verify': return vVerify();
    case 'closeout': return vCloseout();
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

// Mark the selected theme on the three theme buttons and nowhere else.
function paintTheme(){
  const theme = document.documentElement.getAttribute('data-theme') || 'auto';
  $$('button[data-theme]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.theme === theme)));
  // A previous release wrote this onto the document element, where it is not
  // a valid attribute and where it survived switching back to Light.
  if (document.documentElement.hasAttribute('aria-pressed')) document.documentElement.removeAttribute('aria-pressed');
}

/**
 * A stable way to find the field that had focus, across a re-render.
 *
 * Adding a criterion, changing a weight, or picking a suggestion redraws the
 * whole page. Without this the caret jumps to the top of the document in the
 * middle of typing a profile (D11).
 */
function focusKey(el){
  if (!el || el === document.body || !el.matches?.('input, textarea, select, button')) return null;
  if (el.id) return '#' + el.id;
  const row = el.closest?.('[data-row]');
  if (row && el.dataset.f) return '[data-row="'+row.dataset.row+'"] [data-f="'+el.dataset.f+'"]';
  if (el.dataset.path) return '[data-path="'+el.dataset.path+'"]';
  // Suggestion chips and add/remove controls: identified by what they act on,
  // so the keyboard stays where it was after the list redraws.
  for (const attr of ['pick','ipick']){
    if (el.dataset[attr] && el.dataset.label && !el.dataset.label.includes('"')){
      return '[data-'+attr+'="'+el.dataset[attr]+'"][data-label="'+el.dataset.label+'"]';
    }
  }
  for (const attr of ['add','iadd']) if (el.dataset[attr]) return '[data-'+attr+'="'+el.dataset[attr]+'"]';
  if (el.name && el.form?.id) return '#'+el.form.id+' [name="'+el.name+'"]';
  return null;
}

/**
 * Guard against a render started from inside a render.
 *
 * Replacing the page detaches whatever had focus, and the browser fires a
 * `change` event for a modified field as it goes. That handler used to call
 * render again from inside the first one, so the outer pass then restored
 * focus to an element the inner pass had already thrown away — which is how
 * the caret ended up on <body> while someone was typing in a filter.
 */
let rendering = false;

/**
 * Make a table that actually scrolls reachable from the keyboard, and only
 * then.
 *
 * The markup used to declare every table wrapper a focusable region whether or
 * not it scrolled, which left tab stops on things that did not move. Measuring
 * after the layout settles gets both halves right, and it follows the
 * breakpoint where candidate rows stop being a table at all.
 */
function markScrollableRegions(root){
  for (const el of root.querySelectorAll('.tablewrap')){
    if (el.scrollWidth > el.clientWidth + 1){
      el.setAttribute('tabindex', '0');
      if (!el.hasAttribute('role')) el.setAttribute('role', 'region');
      if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', 'Scrollable table');
    } else {
      el.removeAttribute('tabindex');
      if (el.getAttribute('aria-label') === 'Scrollable table'){
        el.removeAttribute('role');
        el.removeAttribute('aria-label');
      }
    }
  }
}

function render(){
  const root = $('#app');
  if (!root || rendering) return;
  rendering = true;
  try { paint(root); }
  finally { rendering = false; }
}

function paint(root){
  const active = document.activeElement;
  const key = focusKey(active);
  const caret = key && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
  const scroll = window.scrollY;
  tipSeq = 0;
  hideTip();
  window.SlateAuth.unmount();
  root.innerHTML = page();
  window.SlateAuth.mount(root);
  applyDynamicStyles(root);
  markScrollableRegions(root);
  crumbs();
  paintTheme();
  if (key){
    let el = null;
    try { el = root.querySelector(key); } catch { el = null; }
    if (el){
      el.focus({ preventScroll:true });
      if (caret && 'setSelectionRange' in el){
        try { el.setSelectionRange(caret[0], caret[1]); } catch { /* not a text field */ }
      }
      window.scrollTo({ top:scroll, behavior:'instant' });
    }
  }
}

/**
 * Open or close the mobile navigation drawer.
 *
 * Done against the live DOM rather than through a re-render so that focus and
 * anything half-typed in the page survive opening the menu.
 */
function setNav(open){
  state.navOpen = Boolean(open);
  const shell = $('.shell');
  if (!shell) return;
  shell.classList.toggle('shell--navopen', state.navOpen);
  const scrim = $('.scrim');
  if (scrim) scrim.hidden = !state.navOpen;
  const menu = $('.appbar__menu');
  if (menu) menu.setAttribute('aria-expanded', String(state.navOpen));
  if (state.navOpen) $('.rail__close')?.focus();
  else menu?.focus();
}

/* --- tooltip runtime ------------------------------------------------------ */

let tipTimer = null;
let tipOpen = null;

function tipOf(wrap){ return wrap ? wrap.querySelector(':scope > .tip') : null; }

function hideTip(){
  clearTimeout(tipTimer);
  const tip = tipOf(tipOpen);
  if (tip){
    tip.hidden = true;
    tip.classList.remove('tip--below');
    tip.style.removeProperty('transform');
  }
  tipOpen?.querySelector(':scope > .tiphelp')?.setAttribute('aria-expanded','false');
  tipOpen = null;
}

// Keep the description inside the viewport, including at 320px and under zoom.
function placeTip(tip){
  const pad = 8;
  const r = tip.getBoundingClientRect();
  let dx = 0;
  if (r.left < pad) dx = pad - r.left;
  else if (r.right > window.innerWidth - pad) dx = (window.innerWidth - pad) - r.right;
  if (dx) tip.style.transform = 'translateX(calc(-50% + '+Math.round(dx)+'px))';
  if (r.top < pad) tip.classList.add('tip--below');
}

function showTip(wrap, immediate){
  const tip = tipOf(wrap);
  if (!tip) return;
  clearTimeout(tipTimer);
  if (tipOpen === wrap && !tip.hidden) return;
  const open = () => {
    if (tipOpen !== wrap) hideTip();
    tip.hidden = false;
    tipOpen = wrap;
    placeTip(tip);
  };
  // A brief delay so descriptions do not flash while the pointer crosses a
  // row of controls on its way somewhere else.
  if (immediate) open(); else tipTimer = setTimeout(open, 320);
}

document.addEventListener('pointerover', e => {
  if (e.pointerType === 'touch') return;
  const wrap = e.target.closest?.('.tipwrap');
  if (wrap) showTip(wrap, false);
  else if (tipOpen && !tipOpen.contains(e.target)) hideTip();
});
document.addEventListener('pointerout', e => {
  if (e.pointerType === 'touch') return;
  const wrap = e.target.closest?.('.tipwrap');
  if (!wrap || wrap !== tipOpen) return;
  // Moving onto the description itself keeps it open and readable.
  if (e.relatedTarget && wrap.contains(e.relatedTarget)) return;
  hideTip();
});
document.addEventListener('focusin', e => {
  const wrap = e.target.closest?.('.tipwrap');
  if (wrap) showTip(wrap, true);
  else if (tipOpen && !tipOpen.contains(e.target)) hideTip();
});
document.addEventListener('focusout', e => {
  if (!tipOpen) return;
  if (e.relatedTarget && tipOpen.contains(e.relatedTarget)) return;
  if (tipOpen.querySelector(':scope > .tiphelp[aria-expanded="true"]')) return;
  hideTip();
});
document.addEventListener('keydown', e => {
  // A tablist is one stop in the tab order; the arrows move between sections.
  const tab = e.target.closest?.('[role="tab"][data-tab]');
  if (tab && ['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){
    const group = tab.dataset.tab.split(':')[0];
    const tabs = $$('[data-tab^="'+group+':"]');
    const at = tabs.indexOf(tab);
    const to = e.key === 'Home' ? 0
      : e.key === 'End' ? tabs.length - 1
      : (at + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
    if (tabs[to]){ e.preventDefault(); setTab(group, tabs[to].dataset.tab.split(':')[1]); }
    return;
  }
  if (e.key !== 'Escape') return;
  // Escape dismisses the description without activating anything.
  if (tipOpen){ hideTip(); e.stopPropagation(); return; }
  if (state.navOpen) setNav(false);
  // Escape also closes an open menu, and returns focus to the control that
  // opened it, so a keyboard user is not left inside a closed list.
  const openMenu = $('.menu__btn[aria-expanded="true"]');
  if (openMenu){
    const panel = document.getElementById(openMenu.getAttribute('aria-controls'));
    if (panel) panel.hidden = true;
    openMenu.setAttribute('aria-expanded','false');
    state.open[openMenu.dataset.panel] = false;
    openMenu.focus();
  }
});
window.addEventListener('resize', hideTip);

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

// Narrow a list without a server round trip. At this scale the records are
// already loaded, so filtering is local and the choice is remembered per
// search rather than reset on every visit.
function applyListFilter(el){
  const f = listFilter();
  f[el.dataset.filter] = el.value;
  render();
}

document.addEventListener('change', e => {
  if (e.target.dataset.filter){ applyListFilter(e.target); return; }
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

// An open menu closes when the next click lands anywhere else, which is what
// people expect of a menu and what stops several sitting open down a list.
function closeMenusExcept(el){
  for (const btn of $$('.menu__btn[aria-expanded="true"]')){
    if (el && btn.closest('.menu') === el.closest('.menu')) continue;
    const panel = document.getElementById(btn.getAttribute('aria-controls'));
    if (panel) panel.hidden = true;
    btn.setAttribute('aria-expanded','false');
    state.open[btn.dataset.panel] = false;
  }
}

document.addEventListener('click', async e => {
  closeMenusExcept(e.target);
  const hit = e.target.closest('.pkgmx tbody td, .pkgmx tfoot td');
  if (hit) {
    const radio = hit.closest('.pkgmx')?.querySelector(`thead th:nth-child(${hit.cellIndex + 1}) input[name="package"]`);
    if (radio) radio.checked = true;
  }
  const t = e.target.closest('[data-go],[data-open],[data-act],[data-add],[data-del],[data-w],button[data-theme],[data-cand],[data-score],[data-pick],[data-ipick],[data-iadd],[data-idel],[data-iw],[data-phase],[data-panel],[data-mode],[data-artadd],[data-artdel],[data-tab],[data-col]');
  if (!t) return;

  if (t.dataset.tab){
    const [group, key] = t.dataset.tab.split(':');
    setTab(group, key);
    return;
  }
  // Which half of the review a narrow screen is showing. Both panels stay in
  // the document either way, so the scorecard keeps its unsaved entries while
  // the evidence is being read.
  if (t.dataset.col){
    state.reviewCol = t.dataset.col;
    $$('[data-col]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.col === t.dataset.col)));
    const wrap = $('.review2');
    if (wrap) wrap.className = 'review2 review2--' + t.dataset.col;
    return;
  }

  /* --- structured document editing --------------------------------------- */
  if (t.dataset.artadd || t.dataset.artdel){
    const spec = (t.dataset.artadd || t.dataset.artdel).split(':');
    const kind = spec[0], path = spec[1];
    let draft;
    // Read the form first so nothing typed since the last save is lost when
    // the list grows or shrinks.
    try { draft = collectArtifact(kind); }
    catch { toast('Fix the source JSON before changing this list.'); return; }
    const list = Array.isArray(draft[path]) ? draft[path] : [];
    if (t.dataset.artadd){
      const make = ART_TEMPLATE[kind+'.'+path];
      list.push(make ? make(list) : {});
    } else {
      list.splice(Number(spec[2]), 1);
    }
    draft[path] = list;
    state.search.artifacts = { ...(state.search.artifacts||{}), [kind]: draft };
    state.dirty = true;
    render();
    // Put the caret in the first field of the item that was just created.
    if (t.dataset.artadd) $('#edit-'+kind+' [data-path^="'+path+'.'+(list.length-1)+'."]')?.focus();
    return;
  }

  if (t.dataset.theme){
    const v = t.dataset.theme;
    if (v==='auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', v);
    // Scoped to the buttons. Selecting every [data-theme] wrote aria-pressed
    // onto <html>, which is invalid there and outlived the theme change (D07).
    paintTheme();
    return;
  }
  if (t.dataset.phase !== undefined && t.dataset.phase !== ''){
    const id = t.dataset.phase;
    const next = !(t.getAttribute('aria-expanded') === 'true');
    state.railOpen[id] = next;
    t.setAttribute('aria-expanded', String(next));
    const panel = document.getElementById(t.getAttribute('aria-controls'));
    if (panel) panel.hidden = !next;
    return;
  }
  if (t.dataset.panel){
    // Toggled against the live DOM, not through a re-render, so a form the
    // user is part-way through keeps every value and the caret.
    const key = t.dataset.panel;
    const next = !(t.getAttribute('aria-expanded') === 'true');
    state.open[key] = next;
    t.setAttribute('aria-expanded', String(next));
    const panel = document.getElementById(t.getAttribute('aria-controls'));
    if (panel) panel.hidden = !next;
    const label = next ? t.dataset.closeLabel : t.dataset.openLabel;
    if (label){
      const slot = t.querySelector('[data-panel-label]') || t;
      slot.textContent = label;
    }
    return;
  }
  if (t.dataset.mode){
    const key = t.dataset.modeKey || state.view;
    // Carry unsaved edits across the switch, so Preview shows what was just
    // typed and going back to Edit finds it still there.
    if ($('#edit-'+key) || $('#art-'+key)){
      let draft;
      try { draft = collectArtifact(key); }
      catch { toast('Fix the source JSON before switching to preview.'); return; }
      state.search.artifacts = { ...(state.search.artifacts||{}), [key]: draft };
    }
    state.mode[key] = t.dataset.mode;
    render();
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
    markUnsaved();
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
  if (act==='tip-help'){
    // The touch equivalent of hover: a labelled control that discloses the
    // same description. Tapping the action itself still performs the action.
    const wrap = t.closest('.tipwrap');
    const tip = tipOf(wrap);
    if (!tip) return;
    const open = tip.hidden;
    hideTip();
    if (open){ tip.hidden = false; tipOpen = wrap; t.setAttribute('aria-expanded','true'); placeTip(tip); }
    return;
  }
  if (act==='back'){ await goBack(); return; }
  if (act==='nav-toggle'){ setNav(!state.navOpen); return; }
  if (act==='nav-close'){ setNav(false); return; }
  if (act==='skip'){
    e.preventDefault();
    const main = $('#main');
    if (main){ main.focus(); main.scrollIntoView({ behavior:'instant', block:'start' }); }
    return;
  }
  if (act==='retry-searches'){
    await withBusy(async () => { await refreshSearches(); }, false);
    return;
  }
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
  if (act==='sign-in') { window.SlateAuth.signIn(); return; }
  if (act==='sign-up') { window.SlateAuth.signUp(); return; }
  if (act==='auth-retry') { location.reload(); return; }
  if (act==='logout'){
    showWait(waitSave('Leaving workspace'));
    try {
      await window.SlateAuth.signOut();
      state.user = null; state.search = null; state.searches = []; state.users = []; state.view = 'home';
    } catch (err) { toast(err.message); }
    finally { hideWait(); render(); }
    return;
  }
  if (act==='jump'){
    const target = document.getElementById(t.dataset.to);
    if (!target) return;
    target.scrollIntoView({ behavior:'smooth', block:'start' });
    // Move the keyboard with the page, not just the scroll position.
    target.setAttribute('tabindex','-1');
    target.focus({ preventScroll:true });
    return;
  }
  if (act==='clear-filters'){
    state.filters[state.search?.id || ''] = { q:'', stage:'', resp:'' };
    render();
    return;
  }
  // Selecting a stage on the list. Text and response stay as they are, so the
  // counts beside every other stage do not move under the user.
  if (act==='stage-filter'){
    const f = listFilter();
    f.stage = f.stage === t.dataset.stage ? '' : t.dataset.stage;
    render();
    return;
  }
  // A stage count on the overview opens the list showing exactly that stage.
  // Unrelated filters are cleared, so the number that was clicked is the
  // number of rows that arrive.
  if (act==='stage-open'){
    state.filters[state.search?.id || ''] = { q:'', stage:t.dataset.stage || '', resp:'' };
    await go('screen');
    return;
  }
  if (act==='copy-invite'){
    const c = (state.search?.candidates||[]).find(x => x.id === t.dataset.cid);
    if (!c) return;
    const link = location.origin + '/apply/' + c.invite;
    try {
      await navigator.clipboard.writeText(link);
      toast('Invite link copied for '+(c.name||'this candidate')+'.');
    } catch {
      // Clipboard access can be refused. Show the link so it can still be
      // selected and copied by hand rather than failing silently.
      window.prompt('Copy this candidate’s invite link:', link);
    }
    return;
  }
  if (act==='home-manage'){
    state.open.homemanage = !state.open.homemanage;
    if (!state.open.homemanage) state.picked = [];
    render();
    return;
  }
  if (act==='clear-home-filter'){
    state.homeQ = '';
    render();
    return;
  }
  if (act==='pick-all'){
    // Select-all means the rows on screen. Selecting searches the filter is
    // hiding is how a bulk archive takes files nobody was looking at.
    const shown = (state.searches || []).filter(matchesHomeQuery);
    const picked = pickedIds();
    const already = shown.length > 0 && shown.every(s => picked.includes(s.id));
    state.picked = already ? [] : shown.map(s => s.id);
    render();
    return;
  }
  if (act==='start-fresh'){
    const managed = (state.searches || []).filter(s => s.seat === 'manager');
    if (!managed.length) return;
    const names = managed.map(s => '- '+(s.client || s.no || 'Untitled')+(s.position ? ' / '+s.position : '')).join('\n');
    if (!confirm('Archive these '+managed.length+' managed search'+(managed.length===1?'':'es')+' and start a new search?\n\n'+names+'\n\nThey will leave the active workspace for everyone on their committees. Your Clerk login stays active. You can restore the searches from Archived searches.')) return;
    await withBusy(async () => {
      const out = await api('/api/account/start-fresh', { method:'POST', body:{ ids:managed.map(s => s.id) } });
      state.search = null;
      state.picked = [];
      state.homeQ = '';
      state.open.homemanage = false;
      await loadSearches();
      toast('Archived '+out.archived+' search'+(out.archived===1?'':'es')+'. Your account is ready for a new search.');
      await go('new');
    });
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

  /* --- county fact verification (DEP-07) --------------------------------- */
  if (act==='save-verification'){
    const form = $('#verifyform');
    if (!form) return;
    // The form is flat — "appointment.source" — because that is what a form
    // can carry. The API takes one record per fact, so fold it back here.
    const body = {};
    for (const [name, value] of new FormData(form).entries()){
      const at = name.indexOf('.');
      if (at < 1) continue;
      const key = name.slice(0, at), prop = name.slice(at + 1);
      (body[key] ||= {})[prop] = String(value).trim();
    }
    await withBusy(async () => {
      state.search = await api('/api/searches/'+state.search.id+'/verification', { method:'PUT', body });
      const fs = state.search.factStatus || {};
      toast(fs.readyToPublish
        ? 'Recorded. Every material fact is confirmed.'
        : 'Recorded. '+((fs.materialTotal||0) - (fs.materialConfirmed||0))+' material fact(s) still outstanding.');
    });
    return;
  }

  /* --- candidate documents and contact (DEP-08) -------------------------- */
  if (act==='add-doc'){
    const form = $('#docform');
    if (!form || !form.reportValidity()) return;
    const cid = t.dataset.cid;
    const body = Object.fromEntries(new FormData(form).entries());
    await withBusy(async () => {
      state.search = await api('/api/searches/'+state.search.id+'/candidates/'+cid+'/documents', { method:'POST', body });
      state.open['doc-'+cid] = false;
      toast('Recorded. Slate holds the reference, not the document.');
    });
    return;
  }
  if (act==='drop-doc'){
    if (!confirm('Remove the reference to “'+(t.dataset.label||'this document')+'”? The document itself is untouched.')) return;
    await withBusy(async () => {
      state.search = await api('/api/searches/'+state.search.id+'/candidates/'+t.dataset.cid+'/documents/'+t.dataset.docid, { method:'DELETE' });
      toast('Reference removed.');
    });
    return;
  }
  if (act==='log-contact'){
    const form = $('#commform');
    if (!form || !form.reportValidity()) return;
    const cid = t.dataset.cid;
    const body = Object.fromEntries(new FormData(form).entries());
    await withBusy(async () => {
      state.search = await api('/api/searches/'+state.search.id+'/candidates/'+cid+'/communications', { method:'POST', body });
      state.open['comm-'+cid] = false;
      toast('Contact recorded. Slate sent nothing.');
    });
    return;
  }

  /* --- outcomes and closeout (DEP-09) ------------------------------------ */
  if (act==='record-outcome'){
    const form = $('#outcomeform');
    if (!form || !form.reportValidity()) return;
    const cid = t.dataset.cid;
    const data = Object.fromEntries(new FormData(form).entries());
    const meta = OUTCOME[data.outcome];
    const who = (state.search.candidates||[]).find(c => c.id === cid)?.name || 'this candidate';
    if (!confirm('Record “'+(meta?.label || data.outcome)+'” for '+who+'?'
      + (meta?.revokes ? '\n\nTheir questionnaire link is revoked and they cannot be advanced further.' : '')
      + (data.correction ? '\n\nThe earlier decision stays on the file, marked superseded.' : ''))) return;
    const body = {
      outcome: data.outcome,
      reason: data.reason,
      evidence: data.evidence || '',
      correction: Boolean(data.correction)
    };
    await withBusy(async () => {
      state.search = await api('/api/searches/'+state.search.id+'/candidates/'+cid+'/disposition', { method:'POST', body });
      toast('Outcome recorded for '+who+'.');
    });
    return;
  }
  if (act==='close-search'){
    const form = $('#closeform');
    if (!form || !form.reportValidity()) return;
    const body = Object.fromEntries(new FormData(form).entries());
    const undecided = (state.search.lifecycle?.undecided || []).length;
    if (!confirm('Mark this search '+body.status+'?\n\nEditing, scoring and candidate submissions stop, and every '
      + 'outstanding candidate link is revoked.'
      + (undecided ? '\n\n'+undecided+' candidate(s) have no outcome recorded.' : '')
      + '\n\nIt can be reopened deliberately, with a reason.')) return;
    await withBusy(async () => {
      const out = await api('/api/searches/'+state.search.id+'/close', { method:'POST', body });
      state.search = out.search;
      toast('Search '+body.status+'. '+(out.linksRevoked||0)+' candidate link(s) revoked.');
    });
    return;
  }
  if (act==='reopen-search'){
    const form = $('#reopenform');
    if (!form || !form.reportValidity()) return;
    const body = Object.fromEntries(new FormData(form).entries());
    if (!confirm('Reopen this search? Revoked candidate links stay revoked; issue new ones individually if they are needed.')) return;
    await withBusy(async () => {
      const out = await api('/api/searches/'+state.search.id+'/reopen', { method:'POST', body });
      state.search = out.search;
      toast('Search reopened. Candidate links were not restored.');
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
    // Releasing changes who can see other people's private scores, so it is
    // confirmed rather than being one click away from Next.
    const releasing = !state.search.released;
    if (!confirm(releasing
      ? 'Make every panel member’s scores visible to the search committee?'
      : 'Hide panel scores again? Each person will see only their own.')) return;
    await withBusy(async () => {
      state.search = await api('/api/searches/'+state.search.id, { method:'PATCH', body:{ released: !state.search.released } });
      toast(state.search.released ? 'Scores released.' : 'Scores sealed.');
    });
    return;
  }
  if (act==='advance'){
    const stage = t.dataset.stage || 'finalist';
    // Unsaved scores must not disappear into a stage change.
    if (state.dirty && !(await saveScores())) return;
    if (!confirm('Advance this candidate to '+stage+'?')) return;
    await withBusy(async () => {
      state.search = await api('/api/searches/'+state.search.id+'/candidates/'+state.sel, { method:'PATCH', body:{ stage } });
      toast(stage==='semifinalist' ? 'Advanced to semifinalist.' : 'Advanced to finalist.');
    });
    return;
  }
  if (act==='advance-semi' || act==='advance-final'){
    const cid = t.dataset.cid;
    const stage = act==='advance-semi' ? 'semifinalist' : 'finalist';
    const who = (state.search?.candidates||[]).find(x => x.id===cid)?.name || 'this candidate';
    if (!confirm('Advance '+who+' to '+stage+'?')) return;
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
    await saveScores();
  }
});

/**
 * Put this reviewer's scores and note on the file.
 *
 * Returns whether the save actually landed, so advancing a candidate can
 * refuse to proceed on a failed save rather than discarding the ratings.
 */
async function saveScores(){
  const scores = {};
  $$('[data-score][aria-pressed="true"]').forEach(b => { scores[b.dataset.score] = Number(b.dataset.val); });
  const note = $('#cnote')?.value || '';
  let saved = false;
  await withBusy(async () => {
    state.search = await api('/api/searches/'+state.search.id+'/scores/'+state.sel, { method:'PUT', body:{ scores, note } });
    saved = true;
    toast('Your scores are on the file.');
  });
  return saved;
}

document.addEventListener('submit', async e => {
  e.preventDefault();
  if (e.target.id==='newsearch'){
    await createSearch();
  }
  if (e.target.id==='newmember'){
    const body = Object.fromEntries(new FormData(e.target).entries());
    await withBusy(async () => {
      const out = await api('/api/searches/'+state.search.id+'/members', { method:'POST', body });
      state.search = out.search;
      toast(body.name+' is seated.');
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
      // The book of business has changed. Reconcile it now so Home shows the
      // new file the moment the user goes back to it (D03).
      await refreshSearches();
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

// Browser Back/Forward. The same unsaved-edit guard the on-page control uses:
// if the user cancels, the entry is pushed back so the address bar, the view,
// and every typed value stay exactly as they were.
window.addEventListener('popstate', async event => {
  if (location.pathname.startsWith('/apply/')) return;
  if (!state.user) return;
  if (state.dirty && !confirm('Leave this page and discard unsaved edits?')){
    history.pushState({ slateDepth:navDepth }, '', routeFor());
    return;
  }
  state.dirty = false;
  navDepth = Number(event.state?.slateDepth) || 0;
  await applyRoute(parseRoute(location.hash), { push:false });
});

(async function boot(){
  await loadHealth();
  const m = location.pathname.match(/^\/apply\/([^/]+)/);
  if (m){
    try { state.apply = await api('/api/apply/'+m[1]); }
    catch { state.apply = null; }
    render();
    return;
  }
  try {
    await window.SlateAuth.init(state.health?.auth, () => {
      state.user = null; state.search = null; state.searches = []; state.users = []; state.dirty = false;
      render();
      location.reload();
    });
  } catch (error) {
    state.authError = error.message;
    render();
    return;
  }
  if (await loadMe()){
    await refreshSearches();
    navDepth = Number(history.state?.slateDepth) || 0;
    await applyRoute(parseRoute(location.hash), { push:false });
  } else {
    render();
  }
})();

// Warn before losing unsaved work, including candidate questionnaires.
document.addEventListener('input', e => {
  if (!e.target.closest('#app')) return;
  // Filter controls change what is listed, not what is saved. Treating them as
  // unsaved work would ask the user to confirm leaving a page they only
  // searched in.
  if (e.target.dataset.filter){ applyListFilter(e.target); return; }
  if (e.target.hasAttribute('data-homefilter')){ state.homeQ = e.target.value; render(); return; }
  if (e.target.matches('input, textarea, select') && !e.target.hasAttribute('data-nodirty')){
    state.dirty = true;
    markUnsaved();
  }
  if (e.target.closest('#applyform')) paintApplyProgress();
});

// How far through the questionnaire a candidate is. Updated against the live
// DOM: re-rendering the public form would throw away what they have typed.
function paintApplyProgress(){
  const el = $('#applycount');
  if (!el) return;
  const total = Number(el.dataset.total) || 0;
  const done = $$('#applyform textarea').filter(t => t.value.trim()).length;
  el.textContent = done + ' of ' + total + ' answered';
}
window.addEventListener('beforeunload', e => {
  if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
});
