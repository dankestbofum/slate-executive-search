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
  { key:'committee',  label:'Committee',  icon:'people' },
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
  // Incoming applications are the front of the candidate pipeline, so the
  // breadcrumb and the rail put them with the candidates rather than in a
  // section of their own. The posting that produced them is the firm's own
  // publishing work and sits outside the destinations, beside Search facts.
  applications:'candidates',
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

const SEARCH_ROLE = {
  manager:   { label:'Account manager', hint:'Runs the search. Adds people, opens and closes intake, adopts the profile.' },
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
  opp:   { t:'What could they build?', hint:'What becomes possible with the right person in the role.' }
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
  // The firm workspace this tab is working in, the role held in it, and what
  // that role may do. Everything on screen is drawn from these rather than
  // from anything stored on the account: the same person is a consultant in
  // one workspace and a committee member in another.
  org:null, role:null, caps:{},
  // Whether this deployment lets this account found a new workspace at all.
  // Separate from `caps`, which describe the workspace you are already in.
  canCreateWorkspace:false,
  // Every workspace this account can enter, for the chooser. null means the
  // list has not been loaded, which is different from belonging to none.
  workspaces:null, workspacesError:null,
  // Onboarding and workspace screens: what is in flight and what failed.
  orgBusy:false, orgError:null, orgDraft:null, orgNotice:null,
  // Invitations Clerk is holding for this account, loaded on request.
  invites:null, invitesError:null,
  // Team & access, loaded when an administrator opens it.
  team:null, teamError:null, inviteDraft:null,
  // Object URLs for brochure photos, which are fetched with the session rather
  // than by the browser (see photoSource). Revoked when the workspace changes.
  media:{},
  sel:null, busy:false, premium:false, apply:null,
  // The user guide screen. The role here changes which explanations are shown
  // and nothing else; permissions come from `caps` and the server, and this is
  // deliberately not consulted for either.
  helpRole:null, helpQuery:'', helpArticle:null, helpError:null,
  // The public posting and the application inbox for the open search, loaded
  // when their screens are opened.
  posting:null, postingDraft:null, applicationList:null, application:null,
  // The research operation this tab is driving, and what a finished one left
  // behind. `token` invalidates late responses from a previous search, a
  // previous workspace, or an attempt that was cancelled. `error` and `review`
  // outlive the dialog on purpose: a failure has to stay on the page long
  // enough to be read and acted on. See startResearch.
  // "dismissed" is keyed by job id: saying "fill the facts by hand" is a
  // decision about one operation, not a standing preference, so re-opening a
  // search restores a failure the consultant has not dealt with and stays quiet
  // about one they have. "draft" holds the jurisdiction and website last typed
  // into the lookup form, so a failed attempt does not take them with it.
  research:{ token:0, active:null, error:null, review:null, key:null, dismissed:{}, draft:null },
  // The intake answers being edited, held here rather than read back off the
  // DOM so a re-render never drops what somebody typed. Cleared when the
  // search changes or the answers are saved.
  intake:null,
  // A save that collided with the same member's other tab: the version the
  // server holds, shown beside the local one so neither is thrown away.
  intakeConflict:null,
  // A proposed profile the manager is reviewing before it is applied.
  adoptPlan:null,
  scoreDraft:null, scoreConflict:null,
  // The people being typed into the add-people form, held here rather than
  // read back off the DOM only at submit, so a re-render never drops a row.
  newPeople:null,
  // A just-issued sign-in, shown once on the roster page.
  newPin:null,
  // Which pay-level sample the Packages page is showing, and the package
  // pre-selected when someone starts a search from that page.
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
  publicNavOpen:false,
  desktopRailClosed: localStorage.getItem('slate-rail-closed') === '1',
  // Which navigation was in flight when the user last opened the drawer. A
  // screen change closes the drawer, but only its own: a navigation that was
  // already running when somebody opened the menu must not shut it again when
  // it finally lands. See setNav() and go().
  navOpenedDuring:null,
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
  intake:'Committee questionnaire',
  profile:'Adopt the candidate profile',
  community:'Community',
  survey1:'Candidate questions',
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
    { id:0, key:'convene', t:'Part 1 \u00b7 Committee input', lede:'Who is on this search, who runs it, and what each member is actually looking for.' },
    { id:1, key:'recruit', t:'Part 2 \u00b7 Prepare and post', lede:'Profile, community, surveys, and the ad plan. Then the brochure and ads you actually post.' },
    { id:2, key:'people', t:'Part 3 \u00b7 Candidate evaluation', lede:'Screening is where applicants enter the file. Everything after that waits until someone is on it.' }
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

function packagePill(key){
  const k = key==='executive' ? 'ok' : key==='enhanced' ? 'info' : 'idle';
  return pill(k, packageLabel(key)+' workflow');
}

/* --- who the signed-in person is on this search --------------------------- */

function you(){
  return state.search?.you || { searchRole:null, member:false, staff:isStaff(), consultant:isStaff(), canEdit:false, canManage:false };
}
function canEdit(){ return Boolean(you().canEdit); }
function canManage(){ return Boolean(you().canManage); }
function canManageIntake(){ return Boolean(you().canManageIntake); }
/**
 * May I take this late-stage decision?
 *
 * The answers come from the server, computed by server/authority.js on every
 * read, so a control this file draws and the route behind it are reading one
 * table. Unknown while a search is loading, and in the sample preview, which is
 * why the fallback is `canEdit()` rather than false: the preview is showing what
 * the screen looks like, not deciding anything.
 */
function may(action){
  const answers = you().may;
  return answers ? Boolean(answers[action]) : canEdit();
}
/** Who to ask, for the line under a control this person cannot use. */
function askManager(){
  const mgr = state.search?.accountManager;
  return mgr && mgr.name ? mgr.name + ' runs this search.' : 'The account manager decides this.';
}
// Works across this workspace's whole book: a consultant or an administrator.
function isStaff(){ return Boolean(state.caps?.staff); }
function isAdmin(){ return Boolean(state.caps?.admin); }
// Kept under its old name because so much of the workspace asks the question
// this way round. It now means "not staff in the workspace I am in", which is
// the only sense in which it was ever true.
function isCommittee(){ return !isStaff(); }
function orgName(){ return state.org?.name || 'your workspace'; }
function stepFlow(){
  const steps = catalogSteps();
  return (steps.length ? steps.map(s => s.key) : STEP_FLOW).filter(key => !['guide','survey2'].includes(key));
}
function stepOf(key){
  return catalogSteps().find(s => s.key===key) || null;
}
function stepNo(key){
  const st = stepOf(key);
  return st ? st.n : (STEP_FLOW.indexOf(key)+1 || '');
}

// Research no longer has a list of steps on a timer. It reports the stage the
// server is actually in; see RESEARCH_STAGE_TEXT.
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

// Where focus goes when a wait dialog closes. The dialog takes focus so a
// keyboard user is not tabbing around an inert page; without this they would be
// left on <body> when it closed, with no way back to the control they pressed.
let waitReturnFocus = null;

function showWait(opts={}){
  const el = $('#lookup');
  if (!el) return;
  const kicker = $('#lookup-kicker');
  const title = $('#lookup-title');
  const copy = $('#lookup-copy');
  const site = $('#lookup-site');
  const steps = $('#lookup-steps');
  if (el.hidden) waitReturnFocus = document.activeElement;
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

  // The real stage, when there is one to report, and a clock. Both empty for
  // the short saves that use this dialog.
  setWaitStage(opts.stage || '');
  const clock = $('#lookup-elapsed');
  clearInterval(showWait._clock);
  if (clock){
    clock.hidden = !opts.elapsed;
    clock.textContent = '';
    if (opts.elapsed){
      // From when the operation was accepted, not from when this dialog
      // opened, so reconnecting to a running job shows its real age.
      const from = Number.isFinite(opts.elapsedFrom) ? opts.elapsedFrom : Date.now();
      const paint = () => { clock.textContent = elapsedLabel(Date.now() - from); };
      paint();
      showWait._clock = setInterval(paint, 1000);
    }
  }
  const acts = $('#lookup-acts');
  showWait._cancel = typeof opts.cancel === 'function' ? opts.cancel : null;
  if (acts) acts.hidden = !showWait._cancel;
  const cancelButton = $('#lookup-cancel');
  if (cancelButton){
    cancelButton.textContent = opts.cancelLabel || 'Cancel';
    cancelButton.disabled = false;
  }

  el.hidden = false;
  $('#app')?.setAttribute('inert','');
  (showWait._cancel && cancelButton ? cancelButton : $('#lookup .lookup__card'))?.focus();

  clearInterval(showWait._t);
  if (!list.length) return;
  let i = 0;
  showWait._t = setInterval(() => {
    i = Math.min(i+1, list.length-1);
    paintLookupStep(i);
    if (i === list.length-1) clearInterval(showWait._t);
  }, opts.tick || 8000);
}

function setWaitStage(text){
  const el = $('#lookup-stage');
  if (!el) return;
  const next = String(text || '');
  // Only write when it changes, so a polite live region announces a new stage
  // rather than repeating the same one every poll.
  if (el.textContent !== next) el.textContent = next;
}

function elapsedLabel(ms){
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m ? m + 'm ' + String(s).padStart(2,'0') + 's' : s + 's';
}

function hideWait(){
  clearInterval(showWait._t);
  clearInterval(showWait._clock);
  showWait._cancel = null;
  const el = $('#lookup');
  if (el) el.hidden = true;
  const acts = $('#lookup-acts');
  if (acts) acts.hidden = true;
  setWaitStage('');
  // inert is removed unconditionally: if this is ever skipped the whole
  // application is unreachable, which is the failure this replaces.
  $('#app')?.removeAttribute('inert');
  const back = waitReturnFocus;
  waitReturnFocus = null;
  if (back && document.contains(back) && typeof back.focus === 'function') back.focus();
  else $('#main')?.focus();
}

/* ===========================================================================
 * Research
 *
 * This used to be: open a modal, advance four labels on an eight-second timer,
 * and await one promise. After about twenty-four seconds the dialog said it was
 * writing the search file whether or not the server had answered, and there was
 * no Cancel, no deadline, and no way out if the promise never settled — the
 * page stayed inert until it did.
 *
 * What replaces it:
 *
 *  - the stage shown is the stage the server reported, and the clock beside it
 *    is real elapsed time rather than a claim about progress;
 *  - Cancel returns control at once and then tells the server;
 *  - one operation per tab, with a token so a result belonging to a previous
 *    search, a previous workspace or a cancelled attempt is ignored;
 *  - failure leaves a panel on the page with Retry and fill-by-hand, instead of
 *    a toast that is gone before it is read;
 *  - findings that are supported but incomplete are offered for review rather
 *    than discarded or written over a consultant's own work.
 * ========================================================================= */

const RESEARCH_TERMINAL = new Set(['succeeded','partial','failed','cancelled','interrupted']);

// Frequent while somebody is looking at it, rare when they are not: a
// backgrounded tab does not need second-by-second news.
const RESEARCH_POLL_VISIBLE_MS = 2000;
const RESEARCH_POLL_HIDDEN_MS = 15000;
// Each status check gets its own short deadline, so one hanging poll never
// becomes the reason the operation looks stuck.
const RESEARCH_POLL_TIMEOUT_MS = 10000;
// Room beyond the server's own deadline for it to deliver a structured timeout,
// rather than the browser inventing a verdict first.
const RESEARCH_GRACE_MS = 20000;
const RESEARCH_POLL_FAILURES = 10;
// Deadlines for the requests that surround an operation, as distinct from the
// operation's own deadline. These bound a network round trip; the research is
// bounded by the server. Keeping them separate is what stops "the request did
// not answer" from being reported as "the research did not happen" (D05).
const RESEARCH_START_TIMEOUT_MS = 20000;
const RESEARCH_SAVE_TIMEOUT_MS = 20000;
const RESEARCH_CANCEL_TIMEOUT_MS = 10000;
const RESEARCH_LOOKUP_TIMEOUT_MS = 10000;

const RESEARCH_STAGE_TEXT = {
  queued: 'Waiting for a free slot',
  starting: 'Starting',
  crawling: 'Reading the official website',
  researching: 'Searching public records',
  synthesizing: 'Writing up what it found',
  saving: 'Saving to the search file',
  done: 'Finished'
};

function stageText(stage){
  return RESEARCH_STAGE_TEXT[stage] || 'Working';
}

/**
 * Has this operation stopped being the one this tab is showing?
 *
 * A search change, a workspace switch, a cancellation, or a second attempt all
 * make an in-flight response irrelevant. Applying it anyway is how one client's
 * material ends up under another client's name.
 */
function researchStale(active){
  return !active
    || state.research.active !== active
    || state.research.token !== active.token
    || state.search?.id !== active.searchId
    || (state.org?.id || null) !== active.orgId;
}

function researchWait(active){
  showWait({
    kicker: 'Jurisdiction lookup',
    title: 'Looking up ' + (String(active.city || '').trim() || 'the jurisdiction'),
    copy: 'A research agent is reading the official website and public records. Nothing is written to the search file until it finishes, and you can cancel at any time.',
    site: active.website ? hostOf(active.website) : '',
    stage: stageText(active.stage),
    elapsed: true,
    elapsedFrom: active.startedAt,
    cancel: () => void cancelResearch(active)
  });
}

function pollSignal(active){
  const own = AbortSignal.timeout(RESEARCH_POLL_TIMEOUT_MS);
  return AbortSignal.any ? AbortSignal.any([active.controller.signal, own]) : active.controller.signal;
}

/** Turn a failed request into something the failure panel can say. */
function researchProblem(error){
  const detail = error.detail || {};
  const fatal = ['AI_AUTH_ERROR','BAD_URL','MODEL_UNAVAILABLE','RESEARCH_JOBS_OFF'];
  return {
    code: error.code || 'RESEARCH_FAILED',
    error: error.message || 'Research did not finish.',
    missing: Array.isArray(detail.missing) ? detail.missing : [],
    operation: detail.operation || null,
    retry: !fatal.includes(error.code),
    // Only set when the outcome is genuinely unknown. Never claim nothing was
    // saved when we cannot tell.
    reload: false,
    // Offers "Check what happened": an authorized read that reconciles the key
    // this tab is holding. Set only where the outcome is genuinely unknown.
    reconcile: false
  };
}

/**
 * The start request was never answered inside its bound.
 *
 * Deliberately offers reconciliation rather than Retry. The server may have
 * recorded the operation and begun paying for it under an id this tab never
 * learned, and a retry that looks like a fresh start is how the same research
 * gets billed twice.
 */
function researchUnsureStart(){
  return {
    code: 'RESEARCH_UNSURE',
    error: 'Slate did not hear back about starting this research, so whether it started is not known here. Check what happened before trying again.',
    missing: [], retry: false, reload: false, reconcile: true
  };
}

/** The facts save failed outright, so research was never started. */
function factsSaveProblem(error){
  return {
    code: error.code || 'FACTS_SAVE_FAILED',
    error: 'Slate could not save the facts on this form, so research was not started. ' + (error.message || ''),
    missing: [], retry: true, reload: false, reconcile: false
  };
}

/** The facts save was not answered, so whether it landed is unknown. */
function factsSaveUnsure(){
  return {
    code: 'FACTS_SAVE_UNSURE',
    // Scoped to the facts rather than to the research: the research definitely
    // did not start, and the facts may well have been saved.
    error: 'Slate did not hear back about saving these facts, so research was not started. Reload this search to see what was saved, then research again.',
    missing: [], retry: false, reload: true, reconcile: false
  };
}

/**
 * Start research.
 *
 * `patch` is the facts the consultant typed in the form, saved first so their
 * typing is never lost to the operation that follows. Both are inside the same
 * abort signal, so cancelling during the save does not leave a request in
 * flight with nobody waiting for it.
 */
async function startResearch({ city, website, premium, refreshEvidence, patch }){
  const s = state.search;
  if (!s) return;
  if (state.research.active) {
    toast('Research is already running on this search. Cancel it if you want to start again.');
    return;
  }
  const token = ++state.research.token;
  const active = {
    token,
    searchId: s.id,
    orgId: state.org?.id || null,
    city, website, premium, refreshEvidence,
    controller: new AbortController(),
    jobId: null,
    stage: 'starting',
    startedAt: Date.now(),
    deadlineAt: null,
    pollTimer: null,
    pollFailures: 0,
    // Held across a retry, so a consultant whose start response was lost finds
    // the operation they already paid for rather than starting a second one.
    key: state.research.key || ('rk-' + s.id + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10))
  };
  state.research.key = active.key;
  state.research.active = active;
  state.research.error = null;
  state.research.review = null;
  researchWait(active);

  // Held so a failure does not take the consultant's typing with it: a
  // re-render draws the lookup form from state, not from the DOM it replaced.
  state.research.draft = { city, website };

  // The facts save and the research are two writes, and they are reported
  // separately. A message about research is not a message about whether the
  // form was saved.
  if (patch) {
    try {
      const saved = await api('/api/searches/' + s.id, {
        method: 'PATCH', body: patch,
        signal: active.controller.signal,
        timeoutMs: RESEARCH_SAVE_TIMEOUT_MS
      });
      if (researchStale(active)) return;
      state.search = saved;
    } catch (error) {
      if (error.aborted) return;
      endResearch(active, { error: error.timedOut ? factsSaveUnsure() : factsSaveProblem(error) });
      return;
    }
  }

  let started;
  try {
    started = await api('/api/searches/' + active.searchId + '/research-jobs', {
      method: 'POST',
      signal: active.controller.signal,
      // A bound on the acknowledgement, not on the research. The operation's
      // deadline is the server's and is learned from this response, which is
      // exactly why waiting for the response cannot itself be unbounded (D05).
      timeoutMs: RESEARCH_START_TIMEOUT_MS,
      headers: { 'idempotency-key': active.key },
      body: { city, website, premium, refreshEvidence }
    });
  } catch (error) {
    if (error.aborted) return;
    // The job contract can be switched off for rollback. An already-open
    // client falls back to holding the connection itself.
    if (error.code === 'RESEARCH_JOBS_OFF') { await researchInline(active, { city, website, premium, refreshEvidence }); return; }
    // No acknowledgement inside the bound. The operation may be running under
    // an id this tab never learned, so the key is kept and the outcome is
    // reconciled rather than guessed at.
    if (error.timedOut || error.code === 'AUTH_TIMEOUT') { endResearch(active, { error: researchUnsureStart() }); return; }
    endResearch(active, { error: researchProblem(error) });
    return;
  }
  if (researchStale(active)) return;
  active.jobId = started.job.id;
  if (started.job.createdAt) active.startedAt = Date.parse(started.job.createdAt);
  if (started.job.deadlineAt) active.deadlineAt = Date.parse(started.job.deadlineAt);
  if (started.reused) setWaitStage(stageText(started.job.stage) + ' · already running');
  if (researchStatus(active, started.job)) return;
  pollResearch(active);
}

/**
 * The synchronous contract, kept for rollback.
 *
 * The browser cannot read the server's configured deadline from here, so it
 * carries its own: the default total plus the same grace period, which is the
 * point past which holding the connection open tells us nothing. It is a
 * backstop for a contract that is on its way out, not the bound — the bound is
 * the operation deadline on the server.
 */
const RESEARCH_INLINE_DEADLINE_MS = 180000 + RESEARCH_GRACE_MS;

async function researchInline(active, input){
  const own = AbortSignal.timeout(RESEARCH_INLINE_DEADLINE_MS);
  const signal = AbortSignal.any ? AbortSignal.any([active.controller.signal, own]) : active.controller.signal;
  try {
    const out = await api('/api/searches/' + active.searchId + '/research', {
      method: 'POST', signal, body: input
    });
    if (researchStale(active)) return;
    state.search = out.search;
    endResearch(active, { saved: true, held: out.held || [] });
  } catch (error) {
    if (error.aborted) {
      // Cancellation has already tidied up. The browser's own deadline firing
      // has not, and its honest report is that the outcome is unknown.
      if (!active.controller.signal.aborted) endResearch(active, { error: researchUnknownOutcome() });
      return;
    }
    endResearch(active, { error: researchProblem(error) });
  }
}

function pollResearch(active){
  if (researchStale(active) || !active.jobId) return;
  clearTimeout(active.pollTimer);
  const base = document.hidden ? RESEARCH_POLL_HIDDEN_MS : RESEARCH_POLL_VISIBLE_MS;
  // Backing off while disconnected, so a server that is down is asked less
  // often rather than every two seconds by every open tab.
  const backoff = Math.min(8, 2 ** Math.max(0, active.pollFailures - 1));
  active.pollTimer = setTimeout(() => void checkResearch(active), base * backoff);
}

/**
 * The browser's own deadline.
 *
 * A small grace period past the server's, so the server has room to deliver its
 * structured timeout rather than the browser inventing a verdict first. Past
 * that, the honest answer is that the outcome is not known here.
 */
function researchOverdue(active){
  return Boolean(active.deadlineAt) && Date.now() > active.deadlineAt + RESEARCH_GRACE_MS;
}

function researchUnknownOutcome(){
  return {
    code: 'RESEARCH_UNKNOWN',
    // Deliberately does not claim nothing was saved. We cannot see the
    // server, so we do not know, and saying otherwise would be a guess
    // presented as a fact about a client's file.
    error: 'Slate stopped hearing back about this research, so its outcome is not known here. Reload this search to see whether it finished.',
    missing: [], retry: false, reload: true
  };
}

async function checkResearch(active){
  if (researchStale(active)) return;
  let out;
  try {
    out = await api('/api/searches/' + active.searchId + '/research-jobs/' + active.jobId, { signal: pollSignal(active) });
    active.pollFailures = 0;
  } catch (error) {
    // Cancellation aborts the poll too; that is not a poll failure.
    if (error.aborted && active.controller.signal.aborted) return;
    if (error.status === 404) {
      endResearch(active, { error: {
        code: 'RESEARCH_LOST',
        error: 'Slate could not find that research operation any more. Reload this search to see where it got to.',
        missing: [], retry: false, reload: true
      } });
      return;
    }
    active.pollFailures += 1;
    // A status check that failed is not a job that failed. Say which.
    setWaitStage(stageText(active.stage) + ' · reconnecting');
    if (active.pollFailures >= RESEARCH_POLL_FAILURES || researchOverdue(active)) {
      endResearch(active, { error: researchUnknownOutcome() });
      return;
    }
    pollResearch(active);
    return;
  }
  if (researchStale(active)) return;
  if (researchStatus(active, out.job)) return;
  // Reachable, answering, and still not finished past its own deadline. The
  // server bounds this operation, so this is a last resort rather than the
  // mechanism; without it the browser would poll a stuck job forever.
  if (researchOverdue(active)) { endResearch(active, { error: researchUnknownOutcome() }); return; }
  pollResearch(active);
}

/**
 * What a finished job means, in one place.
 *
 * Polling and re-opening a search both need this answer and used to derive it
 * separately: polling built a failure panel, and re-opening restored only
 * reviewable findings, so a failure that happened while the tab was away
 * disappeared on the way back (D04). One mapper, two callers.
 *
 * Findings worth a decision and the reason the job did not apply them itself
 * are separate: a stale-search conflict has both, because the work is good and
 * the file moved under it; a plain partial has only the first; and a cancelled
 * job that still produced findings has no failure to report at all.
 */
function researchTerminal(job){
  if (job.state === 'succeeded') return { saved: true, job };
  const review = job.reviewable ? job : null;
  const noFailureToReport = job.state === 'partial' || job.state === 'cancelled';
  const failure = job.failure
    ? {
      code: job.failure.code || 'RESEARCH_FAILED',
      error: job.failure.error || 'Research did not finish.',
      missing: job.failure.missing || job.missing || [],
      operation: job.id,
      retry: !['AI_AUTH_ERROR','NO_KEY','AUTH_ERROR','BAD_URL','MODEL_UNAVAILABLE'].includes(job.failure.code),
      reload: false,
      reconcile: false
    }
    : (noFailureToReport ? null : {
      code: 'RESEARCH_FAILED',
      error: 'Research did not finish.', missing: job.missing || [], operation: job.id,
      retry: true, reload: false, reconcile: false
    });
  if (job.state === 'cancelled' && !review) return { cancelled: true, job };
  return { review, error: failure, job };
}

/** Read one status. Returns true when the operation is over. */
function researchStatus(active, job){
  active.stage = job.stage || active.stage;
  if (job.deadlineAt) active.deadlineAt = Date.parse(job.deadlineAt);
  if (!RESEARCH_TERMINAL.has(job.state)) {
    setWaitStage(stageText(job.stage));
    return false;
  }
  endResearch(active, researchTerminal(job));
  return true;
}

/**
 * Finish, whatever the reason.
 *
 * Timers, the signal and the dialog are released unconditionally and first:
 * if that is ever skipped the application is unreachable, which is the failure
 * this whole change exists to remove. Only then is the outcome applied, and
 * only if it still belongs to what is on screen.
 */
function endResearch(active, outcome = {}){
  clearTimeout(active.pollTimer);
  active.pollTimer = null;
  const mine = state.research.active === active;
  if (mine) state.research.active = null;
  hideWait();
  if (!mine) return;
  if (state.search?.id !== active.searchId || (state.org?.id || null) !== active.orgId) return;

  if (outcome.requested) {
    // Control is back and nothing is claimed. The server has not answered yet,
    // so "nothing was saved" would be a guess about a client's file (D03).
    toast('Cancellation requested. Waiting for the server to confirm.');
    render();
    return;
  }
  if (outcome.saved) {
    state.research.key = null;
    state.research.error = null;
    state.research.review = null;
    state.research.draft = null;
    const held = outcome.held || [];
    toast(held.length
      ? 'Filled from public sources. Kept what you had already entered for: ' + held.join(', ') + '.'
      : 'Filled from public sources. Check the numbers, then edit.');
    // Reload so the page shows what was actually written, not what the client
    // hoped was written.
    void refreshAfterResearch(active.searchId, 'community');
    render();
    return;
  }
  if (outcome.cancelled) {
    state.research.key = null;
    toast(outcome.alreadyCompleted
      ? 'That research had already finished and been saved.'
      : 'Research cancelled. Nothing was saved.');
    render();
    return;
  }
  state.research.review = outcome.review || null;
  state.research.error = outcome.error || null;
  // The key is kept only while we never learned a job id. That is the case
  // where the start response was lost and we cannot tell whether the server
  // recorded the operation: the retry must carry the same key so it finds the
  // one operation rather than paying for a second. Once a job id is known the
  // operation is identified and finished, and a retry is a new one.
  // ...and while the outcome is unknown, whether or not an id is known: a
  // cancellation that was never acknowledged has to be reconciled before a
  // retry, for the same reason.
  if (outcome.error && active.jobId && !outcome.error.reconcile) state.research.key = null;
  render();
}

/* --- reconciliation ------------------------------------------------------- *
 *
 * The one question this tab cannot answer on its own: an operation was started,
 * or possibly started, and no answer arrived. Retrying the start would find out
 * by risking a second paid run, so that is not how it is asked. The key is
 * looked up through a read-only route that never creates work.
 * ------------------------------------------------------------------------- */

/**
 * Ask the server what became of the key this tab is holding.
 *
 * The cancelling flag is set when the consultant asked to stop: an operation
 * found still running is then told to stop, because that is what they asked
 * for and this is the first moment it could be delivered.
 */
async function reconcileResearch({ searchId, key, cancelling = false } = {}){
  const id = searchId || state.search?.id;
  if (!id) return;
  if (!key) {
    if (cancelling) toast('Research cancelled. Nothing was started, so nothing was saved.');
    return;
  }
  let out;
  try {
    out = await api('/api/searches/' + id + '/research-jobs?key=' + encodeURIComponent(key),
      { timeoutMs: RESEARCH_LOOKUP_TIMEOUT_MS });
  } catch (error) {
    if (error.aborted) return;
    if (state.search?.id !== id) return;
    // Still unknown. The panel keeps the key and the offer to check again,
    // rather than resolving into a claim in either direction.
    state.research.error = {
      code: 'RESEARCH_UNSURE',
      error: 'Slate still could not reach the server to check on this research, so nothing about its outcome is known here. Try checking again in a moment.',
      missing: [], retry: false, reload: true, reconcile: true
    };
    render();
    return;
  }
  if (state.search?.id !== id) return;

  const job = out.job || null;
  if (!job) {
    // The key names no operation, which is a real answer: nothing was recorded
    // under it, so nothing was started and nothing was billed for it.
    state.research.key = null;
    state.research.error = null;
    toast(cancelling
      ? 'Research cancelled. It had not started, so nothing was saved.'
      : 'That research was never started. Nothing was saved and nothing was billed.');
    render();
    return;
  }

  state.research.key = null;
  if (!RESEARCH_TERMINAL.has(job.state)) {
    if (cancelling) {
      // Now there is an id to cancel with. This is the deferred half of the
      // Cancel that could not be delivered when it was pressed.
      await requestCancel(id, job.id);
      return;
    }
    // Still running: reconnect to it rather than starting anything.
    state.research.error = null;
    state.search = { ...state.search, researchJob: job };
    adoptResearchJob();
    return;
  }
  applyTerminalResearch(job);
  render();
}

/**
 * Put a finished job's outcome on the page.
 *
 * Shared by reconciliation and by re-opening a search, so one job produces one
 * explanation however it was arrived at.
 */
function applyTerminalResearch(job){
  const outcome = researchTerminal(job);
  if (outcome.saved) {
    toast('That research had already finished and been saved.');
    void refreshAfterResearch(job.searchId || state.search?.id, 'community');
    return;
  }
  if (outcome.cancelled) { toast('That research was cancelled. Nothing was saved.'); return; }
  if (outcome.review) state.research.review = outcome.review;
  if (outcome.error) state.research.error = outcome.error;
}

async function refreshAfterResearch(searchId, view){
  try {
    await loadSearch(searchId);
    if (state.view !== view && state.search?.id === searchId) go(view, {}, { fresh:true });
    else render();
  } catch { render(); }
}

/**
 * Cancel.
 *
 * Control comes back before the server is told, because somebody who pressed
 * Cancel should not have to wait on the network to get their page back. The
 * server is then asked to stop the work; if it had already saved, that is
 * reported as what happened rather than as a cancellation that undid nothing.
 */
async function cancelResearch(active){
  if (!active || active.cancelling) return;
  active.cancelling = true;
  const button = $('#lookup-cancel');
  if (button) { button.disabled = true; button.textContent = 'Cancelling…'; }
  const { jobId, searchId, key } = active;
  clearTimeout(active.pollTimer);
  active.controller.abort();
  // The page comes back straight away and says what is actually known: that
  // cancellation was requested. It does not say nothing was saved, because at
  // this instant nobody here knows whether the save had already happened (D03).
  endResearch(active, { requested: true });
  // No id means the start was never acknowledged. The key is the only handle on
  // the operation, so it is reconciled rather than abandoned, because
  // abandoning it is what let a retry pay for the same work twice.
  if (!jobId) { await reconcileResearch({ searchId, key, cancelling: true }); return; }
  await requestCancel(searchId, jobId);
}

/**
 * Deliver a cancellation and report what the server said.
 *
 * Separate from cancelResearch because reconciliation reaches this point too,
 * with an id it has only just learned.
 */
async function requestCancel(searchId, jobId){
  let out;
  try {
    out = await api('/api/searches/' + searchId + '/research-jobs/' + jobId + '/cancel',
      { method: 'POST', body: {}, timeoutMs: RESEARCH_CANCEL_TIMEOUT_MS });
  } catch (error) {
    if (error.aborted) return;
    if (state.search?.id !== searchId) return;
    // The request was not delivered, or its answer was lost. The operation is
    // bounded by its own deadline on the server either way, so the honest
    // report is that the outcome is not known here yet.
    state.research.error = {
      code: 'RESEARCH_CANCEL_UNSURE',
      error: 'Slate could not confirm the cancellation. The research stops on its own deadline, but whether it saved first is not known here. Reload this search to see.',
      missing: [], operation: jobId, retry: false, reload: true, reconcile: false
    };
    render();
    return;
  }
  if (state.search?.id !== searchId) return;
  state.research.key = null;
  if (out.alreadyCompleted) {
    toast('That research had already finished and been saved.');
    void refreshAfterResearch(searchId, 'community');
    return;
  }
  if (out.job && out.job.reviewable) {
    // Cancelled after the provider had already answered. The findings were paid
    // for, so they are offered rather than thrown away, and nothing was written
    // to the file.
    state.research.review = out.job;
    toast('Research cancelled. Nothing was saved, but it had already found something. Review it below.');
    render();
    return;
  }
  toast('Research cancelled. Nothing was saved.');
  render();
}

/**
 * Reconnect to research that is already running.
 *
 * Every search read carries its current or latest operation, so refreshing the
 * page, or coming back to it tomorrow, finds the same one instead of losing it
 * or starting a second paid run.
 */
function adoptResearchJob(){
  const job = state.search && state.search.researchJob;
  if (!job || state.research.active) return;
  if (RESEARCH_TERMINAL.has(job.state)) {
    restoreResearchOutcome(job);
    return;
  }
  const active = {
    token: ++state.research.token,
    searchId: state.search.id,
    orgId: state.org?.id || null,
    city: job.city,
    website: job.website,
    premium: job.premium,
    controller: new AbortController(),
    jobId: job.id,
    stage: job.stage,
    startedAt: job.createdAt ? Date.parse(job.createdAt) : Date.now(),
    deadlineAt: job.deadlineAt ? Date.parse(job.deadlineAt) : null,
    pollTimer: null,
    pollFailures: 0,
    key: job.id,
    adopted: true
  };
  state.research.active = active;
  researchWait(active);
  if (!researchStatus(active, job)) pollResearch(active);
}

/**
 * Put a finished operation's explanation back on the page.
 *
 * A consultant who left while research was running, or whose tab was in the
 * background when it failed, comes back to the reason and the recovery action
 * rather than to a page that looks like nothing ever happened (D04). What they
 * have already dealt with stays dealt with: dismissal is recorded per job.
 */
function restoreResearchOutcome(job){
  if (state.research.dismissed[job.id]) return;
  const outcome = researchTerminal(job);
  // Saved work needs no notice: it is on the file, which is where it is read.
  if (outcome.saved || outcome.cancelled) return;
  if (outcome.review && !state.research.review) state.research.review = outcome.review;
  if (outcome.error && !state.research.error) state.research.error = outcome.error;
}

/**
 * "I will fill this in by hand", recorded against the operation it was said
 * about. This was a bare flag, so a reload could not tell a failure that had
 * been read from one that had not.
 */
function dismissResearchNotice(){
  for (const id of [state.research.review?.id, state.research.error?.operation]) {
    if (id) state.research.dismissed[id] = true;
  }
  state.research.error = null;
  state.research.review = null;
  state.research.draft = null;
}

/** Nothing from a previous workspace, search, or session may keep running. */
function stopResearch(){
  const active = state.research.active;
  state.research.token += 1;
  state.research.active = null;
  state.research.error = null;
  state.research.review = null;
  state.research.key = null;
  // Both are scoped to one search in one workspace, and neither may follow the
  // consultant to the next one.
  state.research.dismissed = {};
  state.research.draft = null;
  if (!active) return;
  clearTimeout(active.pollTimer);
  active.controller.abort();
}

// Polling slows down when the tab is hidden and picks up again on return,
// rather than running at the same rate into a sleeping laptop.
document.addEventListener('visibilitychange', () => {
  const active = state.research.active;
  if (!active || !active.jobId) return;
  if (!document.hidden) void checkResearch(active);
});

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
  const remaining = flow.slice(i+1);
  const key = isCommittee() ? remaining.find(step => COMMITTEE_STEPS.has(step)) : remaining[0];
  if (!key) return { key:'overview', n:null, title:'This search' };
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

/** A request that was abandoned rather than one that failed. */
function abortedError(){
  const error = new Error('Cancelled.');
  error.code = 'ABORTED';
  error.aborted = true;
  return error;
}

/**
 * A request that ran out of time, which is neither a request that was
 * abandoned nor one that failed.
 *
 * Callers have to tell all three apart: "you stopped it", "the server said
 * no", and "we never found out". The third must never be reported as though
 * nothing happened on the server.
 */
function timedOutError(ms){
  const error = new Error('The server did not answer within ' + Math.round(ms / 1000) + ' seconds.');
  error.code = 'REQUEST_TIMEOUT';
  error.timedOut = true;
  return error;
}

// A session token is a network call in front of every other network call, so
// an authentication service that stopped answering used to leave a request
// that had not started and a page with nothing to time out (D05).
const TOKEN_TIMEOUT_MS = 15000;

function authToken(){
  let timer = null;
  const bounded = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error('Slate could not confirm your sign-in in time. Check your connection and try again.');
      error.code = 'AUTH_TIMEOUT';
      reject(error);
    }, TOKEN_TIMEOUT_MS);
  });
  return Promise.race([window.SlateAuth.token(), bounded])
    .finally(() => clearTimeout(timer));
}

/**
 * One signal for a request, out of the caller's signal and an optional
 * deadline, which also remembers which of them fired.
 *
 * AbortSignal.any would combine them but not tell them apart afterwards, and
 * telling them apart is the whole point.
 */
function requestDeadline(signal, timeoutMs){
  if (!timeoutMs) return { signal, timedOut: () => false, release(){} };
  const own = new AbortController();
  let fired = false;
  const timer = setTimeout(() => { fired = true; own.abort(); }, timeoutMs);
  const relay = () => own.abort();
  if (signal) {
    if (signal.aborted) own.abort();
    else signal.addEventListener('abort', relay, { once: true });
  }
  return {
    signal: own.signal,
    timedOut: () => fired,
    release(){
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', relay);
    }
  };
}

async function api(path, opts={}){
  const { timeoutMs = 0, signal: given = null, ...rest } = opts;
  const deadline = requestDeadline(given, timeoutMs);
  try {
    const token = path.startsWith('/api/apply/') ? null : await authToken();
    // Acquiring the token is itself a wait. A cancelled operation must not start
    // a request just because the token promise happened to settle afterwards.
    if (given && given.aborted) throw abortedError();
    if (deadline.timedOut()) throw timedOutError(timeoutMs);
    const writesSearch = rest.method && rest.method !== 'GET' && state.search && path.startsWith('/api/searches/'+state.search.id);
    let res;
    try {
      res = await fetch(path, {
        credentials:'include',
        ...rest,
        signal: deadline.signal,
        headers:{ 'content-type':'application/json', ...(token ? { authorization:'Bearer ' + token } : {}), ...(writesSearch ? { 'if-match':String(state.search.revision) } : {}), ...(rest.headers||{}) },
        body: rest.body ? JSON.stringify(rest.body) : undefined
      });
    } catch (error) {
      // An abort is a decision, not a network fault. A deadline is neither.
      if (deadline.timedOut()) throw timedOutError(timeoutMs);
      if ((given && given.aborted) || error.name === 'AbortError' || error.name === 'TimeoutError') throw abortedError();
      throw error;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(data.error || res.statusText);
      error.code = data.code;
      error.status = res.status;
      error.detail = data;
      throw error;
    }
    if (writesSearch && data.revision) state.search.revision = data.revision;
    return data;
  } finally {
    deadline.release();
  }
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
  if (['home','new','archives','packages','billing','overview','facts','verify','closeout','history','person','people','intake-mine','team-access','help'].includes(view)) return true;
  if (['posting','applications'].includes(view)) return true;
  if (HUB_VIEWS.includes(view)) return true;
  return STEP_FLOW.includes(view);
}

// Screens that belong to a workspace rather than to one search. Listed once,
// because routing, the navigation guard, and the address builder all have to
// agree about which ones can be opened with no search loaded.
const WORKSPACE_VIEWS = ['home','new','archives','packages','team-access','help'];

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

/**
 * Every in-workspace address names its workspace: `#/o/{orgId}/s/{id}/screen`.
 *
 * Without it, a link copied out of one firm's workspace and opened while
 * another is active would silently resolve against whichever workspace the
 * session happened to be in. With it, the mismatch is visible before anything
 * is loaded and the app can offer to switch instead of quietly guessing.
 * Organization slugs are disabled on this instance, so the id is what travels.
 */
function orgPrefix(orgId = state.org?.id){
  return orgId ? '#/o/' + encodeURIComponent(orgId) : '#';
}

function routeFor(view = state.view, opts = {}){
  const sel = opts.sel !== undefined ? opts.sel : state.sel;
  const at = orgPrefix(opts.orgId);
  if (view === 'packages') return at + '/packages/' + encodeURIComponent(opts.pkg || '');
  if (WORKSPACE_VIEWS.includes(view) && view !== 'packages') return at + '/' + view;
  const id = opts.searchId || state.search?.id;
  if (!id) return at + '/home';
  if (view === 'overview') return at + '/s/' + encodeURIComponent(id);
  if (view === 'person') return at + '/s/' + encodeURIComponent(id) + '/person/' + encodeURIComponent(sel || '');
  return at + '/s/' + encodeURIComponent(id) + '/' + encodeURIComponent(view);
}

function parseRoute(hash){
  let parts = String(hash || '').replace(/^#\/?/, '').split('/').filter(Boolean).map(p => {
    try { return decodeURIComponent(p); } catch { return p; }
  });
  // An address written before workspaces existed carries no `/o/` segment. It
  // is read as "this workspace", which is safe because the search it names is
  // still looked up through an authorized request: a search belonging to
  // another firm comes back not-found rather than opening.
  let orgId = null;
  if (parts[0] === 'o'){
    orgId = parts[1] || null;
    parts = parts.slice(2);
  }
  if (!parts.length) return { view:'home', orgId };
  if (parts[0] === 's'){
    if (!parts[1]) return { view:'home', orgId };
    const view = parts[2] || 'overview';
    return { view, orgId, searchId:parts[1], sel: view === 'person' ? (parts[3] || null) : null };
  }
  if (parts[0] === 'packages') return { view:'packages', orgId, pkg: parts[1] || null };
  if (WORKSPACE_VIEWS.includes(parts[0]) && parts[0] !== 'packages') return { view:parts[0], orgId };
  return { view:'home', orgId };
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
  if (v === 'home' || v === 'new' || v === 'archives' || v === 'packages' || v === 'help') return { view:'home', label:'Back to Home' };
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
  const ticket = ++navSeq;
  // An address from another workspace. Offer the switch explicitly rather than
  // opening whatever this workspace happens to have at that id — and say
  // nothing about the other workspace's contents, which this person may have
  // no business knowing exist.
  if (route.orgId && state.org?.id && route.orgId !== state.org.id){
    const known = (state.workspaces || []).find(w => w.id === route.orgId && w.role);
    if (known){
      state.pendingLink = { ...route, workspace:known };
      await go('home', {}, { replace:true });
      return;
    }
    toast('That link belongs to a workspace you are not in.');
    await go('home', {}, { replace:true });
    return;
  }
  const loaded = route.searchId && state.search?.id !== route.searchId;
  if (loaded){
    try { await loadSearch(route.searchId, { current:() => ticket === navSeq }); }
    catch {
      if (ticket !== navSeq) return;
      toast('That search is not on your book, or is no longer available.');
      await go('home', {}, { replace:true });
      return;
    }
    if (ticket !== navSeq) return;
  }
  if (!route.searchId && !WORKSPACE_VIEWS.includes(route.view)) route = { view:'home' };
  const extra = route.sel ? { sel:route.sel } : {};
  await go(route.view, extra, { push, replace:!push, fromHistory:true, ticket, fresh:loaded });
}

/**
 * How many navigations have been asked for.
 *
 * A screen can wait on a fetch before it paints — the follow-up list, the
 * archive, the member list. If somebody moves again while one of those is in
 * flight, the slower request must not paint over the screen the faster one
 * already delivered. Every navigation takes a ticket and abandons itself if a
 * later one has been issued.
 */
let navSeq = 0;

async function go(view, extra={}, opts={}){
  if (['guide','survey2'].includes(view) && isStaff() && canOpenStep(view)) view = 'survey1';
  if (!state.busy && state.dirty && !confirm('Leave this page and discard unsaved edits?')) return;
  state.myAccess = false;
  if (state.view === 'profile' && view !== 'profile') state.adoptPlan = null;
  if (state.view === 'person' && view !== 'person') { state.scoreDraft = null; state.scoreConflict = null; }
  // Taken when the move was asked for, not when this function happened to get
  // its turn: a navigation delayed by a slow fetch must not outrank one asked
  // for after it and already painted.
  const ticket = opts.ticket ?? ++navSeq;
  const superseded = () => ticket !== navSeq;
  state.dirty = false;
  if (!opts.fromHistory) rememberScroll();
  // The drawer is closed when this navigation commits, not here. Writing
  // `navOpen = false` at the moment a move was *asked for* left the flag
  // waiting for whichever render happened next, which on a slow connection is
  // seconds later — long enough for somebody to open the menu in the meantime
  // and have it torn down under their finger as the screen landed. On a phone
  // the drawer is the only navigation there is, so that took the destinations
  // and the theme controls with it. See closeNavFor() below.
  // Help is about the screen it was opened from. Carrying it to the next one
  // would leave somebody reading instructions for a page they have left.
  window.SlateHelp?.closeDrawer?.();
  if (view === 'home') { state.search = null; state.sel = null; }
  if (offPackage(view)) {
    const st = (state.health?.steps || []).find(x => x.key === view);
    toast((st ? STEP_NAME[view] || st.t : 'That step')+' is not part of the '+packageLabel(state.search.package)+' workflow.');
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
  if (view === 'archives' && !state.caps?.viewArchives) view = 'home';
  if (view === 'new' && !state.caps?.createSearch) view = 'home';
  // Team & access is the administrator's screen. A consultant following a link
  // to it lands on Home rather than on an explanation of a door they cannot
  // open.
  if (view === 'team-access' && !state.caps?.manageMembers){
    toast('An organization administrator manages members and invitations.');
    view = 'home';
  }
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
  if (!state.search && !WORKSPACE_VIEWS.includes(view)) view = 'home';
  // The public posting and the application inbox are the firm's side of the
  // portal. A committee member who follows a link to either lands on the
  // search, like every other consultant-only screen.
  if (state.search && ['posting','applications'].includes(view) && !canEdit()) view = 'overview';
  try {
    if (view === 'billing' && state.search && new URLSearchParams(location.search).get('payment') === 'return') {
      try {
        await api('/api/searches/'+state.search.id+'/payment/reconcile', { method:'POST', body:{} });
        await loadSearch(state.search.id);
      } catch (error) { toast('Payment verification is still pending. Use Check payment status to retry.'); }
      history.replaceState(history.state, '', location.pathname + location.hash);
    }
    if (view === 'home') await refreshSearches();
    if (view === 'archives') state.archives = await api('/api/archives');
    if (view === 'history') state.history = await api('/api/searches/'+state.search.id+'/history');
    if (view === 'team-access') await loadTeam();
    // Loaded before the screen paints, so the guide never renders as an empty
    // page that fills in a moment later.
    if (view === 'help') await loadHelp();
    if (view === 'posting') state.posting = await api('/api/searches/'+state.search.id+'/posting');
    if (view === 'applications') state.applicationList = await api('/api/searches/'+state.search.id+'/applications');
  } catch (error) {
    if (superseded()) return;
    toast(error.message); return;
  }
  if (superseded()) return;
  // Other people change a search while it sits open here: a manager adds a
  // candidate, an applicant submits, a colleague saves. Each move within an
  // open search reads it again, so nobody has to reload the browser to see
  // today's list. A failure keeps what is on screen and says it may be old.
  if (state.search && view !== 'home' && !opts.fresh) await refreshOpenSearch(superseded);
  if (superseded()) return;
  // Who still needs chasing, read from the server so the list and the export
  // agree on the answer. Deliberately not fatal: the candidate list is still
  // worth opening when this one call fails.
  if (['screen','people'].includes(view) && state.search && canEdit()){
    try { state.followUps = await api('/api/searches/'+state.search.id+'/follow-ups'); }
    catch { state.followUps = null; }
    if (superseded()) return;
  }
  Object.assign(state, extra, { view });
  closeNavFor(ticket);
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

/**
 * Close the mobile drawer for the navigation that is now committing.
 *
 * Arriving somewhere closes the menu you left from — but only that menu. If
 * the drawer was opened while this navigation was already in flight, the
 * user's most recent deliberate act was opening it, and it stays open over the
 * screen that has just landed. They close it themselves, by choosing a
 * destination, tapping the scrim, or pressing Escape.
 *
 * The two cases are told apart by the navigation ticket, which setNav() stamps
 * on the way open: a drawer opened before this move was asked for carries an
 * earlier ticket, one opened during it carries this one.
 */
function closeNavFor(ticket){
  if (state.navOpenedDuring === ticket) return;
  state.navOpen = false;
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
    people:'<path d="M8 7.4a2.1 2.1 0 1 0 0-4.2 2.1 2.1 0 0 0 0 4.2Z"/><path d="M3.6 13.4c0-2.3 2-3.6 4.4-3.6s4.4 1.3 4.4 3.6"/>',
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
 * The name the help trigger announces.
 *
 * Every trigger used to be called "Explain this control", so a screen-reader
 * user listing the controls on the candidate screen heard it eleven times and
 * could not tell which one belonged to Replace candidate link. The name is
 * taken from the control's own visible text — "Explain Replace candidate link"
 * — which keeps the two in step for free when a label is reworded.
 */
function tipName(markup, given){
  if (given) return given;
  const label = /\saria-label="([^"]+)"/.exec(markup)?.[1];
  const visible = String(markup)
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const name = (label || visible).slice(0, 60).trim();
  return name ? 'Explain ' + name : 'Explain this control';
}

/**
 * Wrap a control with a tooltip.
 *
 * `html` must start with the control's own opening tag; the id is added to
 * that tag's aria-describedby. Tooltips hold no interactive content, so they
 * are safe to leave in the accessibility tree as description text.
 *
 * A control that already has a description keeps it. Writing a second
 * aria-describedby attribute is not additive — the browser takes the first and
 * discards the rest — so a field hint would have been silently replaced by its
 * own tooltip. The ids are merged into one attribute instead, and the hint is
 * read first because it is the one that is also visible on the page.
 */
function withTip(html, text, opts={}){
  if (!text) return html;
  const markup = String(html).trim();
  const id = 'tip-' + (++tipSeq);
  const m = /^<(button|a|span|select|input|summary|label)\b/.exec(markup);
  if (!m) return markup;
  const existing = /^<[a-z]+\b[^>]*\saria-describedby="([^"]*)"/.exec(markup)?.[1];
  const described = existing
    ? markup.replace(/(^<[a-z]+\b[^>]*\saria-describedby=")([^"]*)"/, '$1$2 ' + id + '"')
    : markup.replace(/^<([a-z]+)\b/, '<$1 aria-describedby="' + id + '"');
  return `<span class="tipwrap">${described}<button type="button" class="tiphelp" data-act="tip-help" aria-expanded="false" aria-controls="${id}" aria-label="${esc(tipName(markup, opts.name))}">?</button><span class="tip" role="tooltip" id="${id}" hidden>${esc(text)}</span></span>`;
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
  backTip:'Return to the screen you came from.',
  // Wording reviewed against the behaviour it describes, rather than against
  // what the control is called. Each of these sits beside a visible sentence
  // that says the same thing: a tooltip supplements an instruction, it is
  // never the only place an instruction appears.
  saveIntake:'Save your work without changing the answers you last submitted.',
  submitIntake:'Staff can read submitted answers while input is open. After it closes, members on this search can read them.',
  adoptPreview:'Review which committee priorities will become the candidate profile before saving.',
  openQuestionnaireAccess:'This opens the questionnaire. It does not send an email. Copy the link and contact the candidate.',
  publishPosting:'Publishes this approved job page so anyone with its address can view it.',
  republishPosting:'Replaces the live job page with what you have saved here. Until you do, the public sees the previous version.',
  pausePosting:'Stops new applications. The page stays readable and says it is not accepting applications.',
  closePosting:'Closes the posting to new applications. The search stays open and you keep working the applicants you have.',
  previewPosting:'Open the public job page exactly as an applicant sees it.',
  acceptApplication:'Add this applicant to the candidate list. From there they are an ordinary candidate.',
  reopenApplication:'Let this applicant correct their application. The submission they already made is kept.',
  applicationFile:'Download this material. Only a file a scanner has cleared can be opened.',
  helpPage:'Open the user guide for this screen. Nothing you have typed is lost.'
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

/**
 * What this action will do, said before it is taken.
 *
 * A tooltip is supplementary: it is behind a hover, a focus, or a tap, and it
 * is the wrong place for the one fact somebody needs in order to decide. Who
 * will be able to read this, whether anything is sent, and whether a link stops
 * working are all decisions rather than details, so they are visible next to
 * the control and stay visible.
 */
function beforeYouAct(text){
  if (!text) return '';
  return `<p class="foreword">${text}</p>`;
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

// Search workflow selection does not purchase or change a subscription.
function packageChoice(selected){
  const list = packages();
  if (!list.length) return '';
  const on = list.some(p => p.key === selected) ? selected : state.health?.defaultPackage;
  return '<div class="stack stack--tight"><p class="t-small">Choose the steps this search needs. Review the project fee on <a href="/pricing">Search pricing</a>.</p>' +
    '<label for="search-workflow">Search workflow</label><select id="search-workflow" class="input" name="package">' +
    list.map(p => '<option value="'+esc(p.key)+'"'+(p.key===on?' selected':'')+'>'+esc(p.label)+'</option>').join('') +
    '</select></div>';
}
/**
 * The workspace page header.
 *
 * Compact and horizontal: the eyebrow, the title, and the screen's dominant
 * action on one line, with the explanation under it. The serif display face is
 * kept for the wordmark and for generated documents, which is why the title
 * here is a workspace type class rather than `.t-display`.
 */
/**
 * Help for the screen the user is on.
 *
 * Drawn only where the guide actually has an article, so the control is never
 * an invitation to a dead end. It opens a drawer rather than navigating, which
 * is what lets somebody read the instructions without losing the half-written
 * answer they are reading them about — the control says so, because that is
 * the reservation people have about clicking Help mid-form.
 */
function helpControl(view = state.view){
  const key = view === 'intake-mine' ? 'intake' : view === 'people' ? 'screen' : view;
  const article = window.SlateHelp?.catalog ? window.SlateHelp.forScreen(key) : null;
  if (!article) return '';
  return withTip(
    `<button type="button" class="btn btn--ghost btn--sm" data-act="help-page" data-screen="${esc(key)}">Help with this page</button>`,
    TIPS.helpPage, { name: 'Explain Help with this page' });
}

function head(eyebrow, title, lede, actions=''){
  const guide = helpControl();
  return `<div class="pagehead"><div class="wrap">
    ${backControl()}
    <div class="pagehead__row">
      <div class="pagehead__id">
        <div class="eyebrow">${esc(eyebrow)}</div>
        <h1 class="pagehead__title">${esc(title)}</h1>
      </div>
      ${actions||guide?`<div class="pagehead__act">${actions}${guide}</div>`:''}
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
  return `<span class="t-small">Claude Opus 5.5 ${pill(h.hasKey?'ok':'wait', h.hasKey?'API key ready':'No API key')}</span>`;
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
    state.onboarding = me.onboarding;
    state.org = me.organization || null;
    state.role = me.role || null;
    state.caps = me.capabilities || {};
    state.canCreateWorkspace = Boolean(me.canCreateWorkspace);
    state.workspaces = me.workspaces || null;
    state.workspacesError = me.workspacesError || null;
    state.users = me.users || [];
    state.health = Object.assign({}, state.health, me.health);
    state.authError = null;
    state.authTaskPending = false;
    return true;
  } catch (error) {
    // A session Clerk is holding on an unanswered task is not a failure to
    // sign in; it is a person who has not chosen a workspace yet. The chooser
    // is what they need, not the sign-in page.
    if (error.code === 'SESSION_TASK_PENDING') {
      state.authTaskPending = true;
      state.user = state.user || null;
      state.onboarding = { stage:'workspace', blocked:true, required:false };
      state.authError = null;
      return Boolean(state.user);
    }
    state.user = null;
    state.authTaskPending = false;
    state.authError = window.SlateAuth.signedIn ? error.message : null;
    return false;
  }
}

/**
 * Everything that belongs to the workspace being left.
 *
 * Called before loading another one. A switch that kept the previous firm's
 * search, directory, filters, or half-fetched responses on screen would put
 * one client's material under another client's name, which is the single worst
 * thing this feature could do.
 */
function clearWorkspaceState(){
  state.billing = null; state.billingActionError = null;
  // A research operation belongs to one firm's search. It stops before
  // anything else, so no late status or result can land in the next workspace.
  stopResearch();
  for (const url of Object.values(state.media)) URL.revokeObjectURL(url);
  state.media = {};
  state.search = null; state.searches = []; state.users = [];
  state.sel = null; state.picked = []; state.archives = null; state.history = null;
  state.followUps = null; state.intake = null; state.intakeConflict = null; state.adoptPlan = null;
  state.scoreDraft = null; state.scoreConflict = null;
  state.newPin = null; state.newPeople = null;
  state.filters = {}; state.open = {}; state.mode = {}; state.tab = {};
  state.scrollMem = {}; state.homeQ = ''; state.searchesError = null;
  state.team = null; state.teamError = null; state.inviteDraft = null;
  state.dirty = false;
}
async function loadSearches(){ state.searches = await api('/api/searches'); state.searchesError = null; }

/**
 * Move this tab into another firm's workspace.
 *
 * The guard runs here, before Clerk is asked for anything, so answering "stay"
 * leaves the current screen and every typed value exactly as they were — a
 * prebuilt switcher's selection event cannot be taken back, which is why Slate
 * owns this control.
 *
 * Once the switch is made the page is reloaded at the new workspace's address.
 * That is deliberate rather than lazy: a reload is the only way to guarantee
 * that no search, candidate, filter, draft, cached photo, or in-flight response
 * from the previous firm survives into the next one, and putting one client's
 * material under another client's name is the worst thing this feature could
 * do.
 */
async function enterWorkspace(orgId, destination){
  if (isInvitationPage() && orgId) {
    const params = new URLSearchParams(location.search);
    const searchId = params.get('organization') === orgId ? params.get('search') : null;
    destination = '#/o/' + encodeURIComponent(orgId) + (searchId ? '/s/' + encodeURIComponent(searchId) : '/home');
    state.orgBusy = true; state.orgError = null;
    try {
      if (orgId !== window.SlateAuth.organizationId) await window.SlateAuth.setActiveOrganization(orgId);
      // Only authenticated, server-authorized assignments determine the
      // destination of older invitations that did not include a search ID.
      if (!searchId && await loadMe() && state.org?.id === orgId && state.role) {
        const searches = await api('/api/searches');
        if (searches.length === 1) destination = '#/o/' + encodeURIComponent(orgId) + '/s/' + encodeURIComponent(searches[0].id);
      }
      location.assign('/' + destination);
    } catch (error) {
      state.orgBusy = false; state.orgError = error.message; render();
    }
    return;
  }
  if (!orgId || orgId === state.org?.id) return;
  const target = (state.workspaces || []).find(w => w.id === orgId);
  if (state.dirty && !confirm('Switch to ' + (target?.name || 'another workspace')
    + '?\n\nUnsaved edits on this page will be discarded.')) return;
  state.orgBusy = true; state.orgError = null;
  showWait(waitSave('Opening ' + (target?.name || 'the workspace')));
  try {
    await window.SlateAuth.setActiveOrganization(orgId);
    state.dirty = false;
    clearWorkspaceState();
    window.removeEventListener('beforeunload', warnUnsaved);
    location.hash = destination || ('#/o/' + encodeURIComponent(orgId) + '/home');
    location.reload();
  } catch (error) {
    state.orgError = error.message || 'That workspace could not be opened.';
    state.orgBusy = false;
    hideWait();
    render();
  }
}

/**
 * A brochure photo, fetched with this tab's session rather than by the browser.
 *
 * An <img src> sends the session cookie, and Clerk's cookie carries whichever
 * organization was selected last in any tab. That is precisely the request that
 * must not resolve against the wrong workspace, so the bytes are fetched with
 * the bearer token the rest of the app uses and handed to the image as an
 * object URL. The server refuses the ambient form outright.
 */
function photoSource(path){
  if (!path) return '';
  if (!path.startsWith('/media/')) return path;
  if (state.media[path]) return state.media[path];
  if (state.media[path] === null) return '';
  state.media[path] = null;
  (async () => {
    try {
      const token = await window.SlateAuth.token();
      const res = await fetch(path, { headers: token ? { authorization:'Bearer ' + token } : {} });
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(await res.blob());
      // A switch may have happened while this was in flight. Late results from
      // the previous workspace are dropped rather than painted.
      if (state.media[path] !== null) { URL.revokeObjectURL(url); return; }
      state.media[path] = url;
      for (const img of $('img[data-media="' + CSS.escape(path) + '"]')) img.src = url;
    } catch { delete state.media[path]; }
  })();
  return '';
}

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
/**
 * Read the open search again without letting a slow answer win.
 *
 * The response is applied only if this is still the navigation in charge, the
 * same search and workspace are still open, and nothing has been typed since
 * it was asked for. Anything else keeps the screen the person is looking at.
 */
async function refreshOpenSearch(superseded = () => false){
  const asked = state.search;
  const id = asked?.id;
  const orgId = state.org?.id;
  if (!id) return false;
  try {
    const fresh = await api('/api/searches/'+id);
    // A save made while this read was in flight already put a newer search on
    // screen; the read must not put the older one back.
    if (superseded() || state.search !== asked || state.org?.id !== orgId || state.dirty) return false;
    state.search = fresh;
    state.searchStale = null;
    adoptResearchJob();
    return true;
  } catch (error) {
    if (superseded() || state.search !== asked || state.org?.id !== orgId) return false;
    state.searchStale = error.message || 'The latest changes could not be loaded.';
    return false;
  }
}

function searchStaleNotice(){
  if (!state.search || !state.searchStale) return '';
  return `<div class="notice notice--wait" role="status"><div>
    <div class="notice__t">This search may be out of date</div>
    <div class="notice__b">${esc(state.searchStale)} You are seeing what was last loaded; changes by other people may be missing.
      <button type="button" class="btn btn--secondary btn--sm" data-act="retry-search-refresh">Try again</button></div>
  </div></div>`;
}

async function loadSearch(id, { current = () => true } = {}){
  const search = await api('/api/searches/'+id);
  // A navigation that has since been replaced must not paint its search over
  // the one the person moved on to.
  if (!current()) return false;
  // An in-progress intake draft belongs to one search. Drop it when the file
  // changes so answers cannot bleed from one committee into another. Research
  // is the same: an operation on the previous search must not keep reporting
  // into this one.
  if (state.search?.id !== id) {
    state.intake = null; state.intakeConflict = null; state.adoptPlan = null;
    state.scoreDraft = null; state.scoreConflict = null;
    delete state.open.profileedit;
    state.profileFavorites = null;
    state.newPin = null; state.newPeople = null; stopResearch();
  }
  state.search = search;
  state.searchStale = null;
  // Research that is already running reconnects here rather than being lost
  // because the page was reloaded or revisited.
  adoptResearchJob();
  return true;
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
  if (['guide','survey2'].includes(st.key)) return '';
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
  if (state.view === 'packages') return 'Subscriptions';
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

/**
 * Which firm this tab is working in, above everything else in the rail.
 *
 * Deliberately separate from the account menu below it. "Who am I" and "whose
 * records am I looking at" are different questions, and answering them in one
 * control is how somebody ends up believing a switch changed their identity —
 * or worse, not noticing it changed the client.
 */
function railWorkspace(){
  if (!state.org) return '';
  const others = (state.workspaces || []).filter(w => w.role && w.id !== state.org.id).length;
  const open = Boolean(state.open.wsswitch);
  const list = (state.workspaces || []).filter(w => w.role);
  return `<div class="rail__group ws">
    <div class="rail__label" id="ws-label">Workspace</div>
    <div class="ws__name" title="${esc(state.org.name)}">${esc(state.org.name)}</div>
    <div class="ws__role">${esc(state.onboarding?.roleLabel || '')}</div>
    ${others ? `<button type="button" class="btn btn--ghost btn--sm ws__switch" data-panel="wsswitch" aria-expanded="${open}" aria-controls="wsswitch" data-open-label="Switch workspace" data-close-label="Switch workspace">Switch workspace</button>
      <div class="ws__list" id="wsswitch"${open?'':' hidden'} role="group" aria-labelledby="ws-label">
        ${list.map(w => `<button type="button" class="rail__link rail__link--sub" data-act="switch-workspace" data-org="${esc(w.id)}" ${w.id===state.org.id?'aria-current="true" disabled':''}>${esc(w.name)}<span class="ws__listrole">${esc(w.roleLabel)}</span></button>`).join('')}
      </div>` : ''}
  </div>`;
}

// The account and theme controls, kept to the height of a row so the rail's
// working area is destinations rather than identity.
function railAccount(u, s){
  const searchRole = s && you().searchRole ? SEARCH_ROLE[you().searchRole]?.label || '' : '';
  const title = String(state.onboarding?.roleLabel || u.title || '').trim();
  const detail = title && searchRole && title.toLowerCase() !== searchRole.toLowerCase() ? title + ' · ' + searchRole : title || searchRole;
  return `<div class="acct">
    <div class="acct__avatar" data-clerk-user></div>
    <span class="acct__id"><span class="acct__nm">${esc(u.name)}</span>${detail?`<span class="acct__rl">${esc(detail)}</span>`:''}</span>
  </div>`;
}

function shell(body){
  if (state.search && canEdit() && !WORKSPACE_VIEWS.includes(state.view)) {
    const stages = [['intake','Committee questionnaire'], ['profile','Adopt the candidate profile'], ['survey1','Candidate questions'],
      ['brochure','Create brochure'], ['ads','Create advertisement'], ['screen','Review candidates']];
    body = `<div class="wrap"><nav class="secnav" aria-label="Search stages">
      ${stages.filter(([key]) => canOpenStep(key)).map(([key,label]) => {
        const st = stepState(key);
        return `<button type="button" data-go="${peopleView(key)}" ${isCurrentStep(key)?'aria-current="step"':''}
          class="${st.status==='done'?'is-done':''}">${esc(label)}${st.skipped?' · Skipped':st.status==='done'?' · Done':st.blocked?' · Waiting':''}</button>`;
      }).join('')}
    </nav></div>` + body;
  }
  // A closed search refuses every ordinary write at the server. Saying so once
  // at the top of whatever screen the user is on is the difference between a
  // deliberate freeze and a page whose Save button mysteriously fails.
  const frozen = frozenNotice();
  if (frozen) body = frozen + body;
  body = searchStaleNotice() + body;
  if (state.search?.projectAccess?.state === 'unpaid' && canEdit() && state.view !== 'billing') {
    body = '<div class="notice notice--info" role="status">This search is a draft. Complete its project payment before research, publishing, or other search work. <button type="button" class="btn btn--secondary btn--sm" data-go="billing">Review project payment</button></div>' + body;
  }
  const warning = state.search?.staleArtifacts?.[state.view];
  if (warning) body = `<div class="notice notice--info" role="status">${esc(warning)}</div>` + body;
  const u = state.user, s = state.view==='packages' ? null : state.search;
  const settingsOpen = Boolean(state.open.railmore);
  return `<div class="shell${state.busy?' busy':''}${state.navOpen?' shell--navopen':''}${state.desktopRailClosed?' shell--railclosed':''}">
    <a class="skip" href="#main" data-act="skip">Skip to content</a>
    <header class="appbar">
      <button type="button" class="appbar__menu" data-act="nav-toggle" aria-expanded="${state.navOpen}" aria-controls="rail">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12"/></svg>
        <span>Menu</span>
      </button>
      <button type="button" class="appbar__rail-toggle" data-act="rail-toggle" aria-expanded="${!state.desktopRailClosed}" aria-controls="rail">${state.desktopRailClosed?'Show':'Hide'} menu</button>
      <span class="appbar__ctx">${state.org ? `<span class="appbar__ws">${esc(state.org.name)}</span>` : ''}${esc(shellContext(s))}</span>
    </header>
    <div class="scrim" data-act="nav-close" ${state.navOpen?'':'hidden'}></div>
    <nav class="rail" id="rail" aria-label="Primary">
      <div class="rail__head">
      <a class="rail__brand" href="/" data-act="slate-home" aria-label="Slate home">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="u-accent" aria-hidden="true"><path d="M4 20h16M6 20V9l6-4 6 4v11M10 20v-5h4v5"/></svg>
        <span class="rail__name">Slate</span><span class="rail__ver">Live</span>
      </a>
      <button type="button" class="rail__close" data-act="nav-close" aria-label="Close navigation">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>
      </button>
      </div>
      ${railWorkspace()}
      <div class="rail__group"><div class="rail__label">This workspace</div>
        <button class="rail__link" data-go="home" ${!s && state.view==='home'?'aria-current="page"':''}>Workspace home</button>
        <button class="rail__link" data-act="my-access">My access</button>
        ${state.caps?.manageMembers ? '<button class="rail__link" data-go="team-access" '+(state.view==='team-access'?'aria-current="page"':'')+'>Team &amp; access</button>' : ''}
        ${state.caps?.createSearch ? '<button class="rail__link" data-go="new" '+(state.view==='new'?'aria-current="page"':'')+'>New search</button>' : ''}
        ${state.caps?.viewArchives ? '<button class="rail__link" data-go="archives" '+(state.view==='archives'?'aria-current="page"':'')+'>Archived searches</button>' : ''}
        ${s ? `<button class="rail__link" data-go="billing" ${state.view==='billing'?'aria-current="page"':''}>Project payment</button>` : ''}
        <a class="rail__link" href="/pricing">Search pricing</a>
        <button class="rail__link" data-go="help" ${state.view==='help'?'aria-current="page"':''}>Help &amp; user guide</button>
      </div>
      ${s?`<div class="rail__group rail__group--dests">
        <div class="rail__here" title="${esc(s.client||'Search')}">
          <span class="rail__here-nm">${esc(s.client||'Search')}</span>
          <span class="rail__here-sub">${esc(s.position||'')}</span>
        </div>
        ${availableDests().map(railDest).join('')}
        ${canEdit() ? `<button class="rail__link rail__link--dest" data-go="posting" ${state.view==='posting'?'aria-current="page"':''}>
          <span class="rail__ico">${ico('docs', 15)}</span>
          <span class="rail__label rail__label--dest">Public posting</span>
          <span class="rail__tail">${s.posting?.live ? (s.posting.accepting ? 'Live' : 'Paused') : ''}</span>
        </button>` : ''}
        ${canEdit() && s.posting?.published ? `<button class="rail__link rail__link--dest" data-go="applications" ${state.view==='applications'?'aria-current="page"':''}>
          <span class="rail__ico">${ico('people', 15)}</span>
          <span class="rail__label rail__label--dest">New applications</span>
          <span class="rail__tail">${s.applications?.awaiting ? s.applications.awaiting : ''}</span>
        </button>` : ''}
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
        </div>` : `<button class="rail__link rail__link--dest" data-act="reload-search">
          <span class="rail__ico">${ico('more', 15)}</span>
          <span class="rail__label rail__label--dest">Reload search</span>
        </button>`}
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
        <button type="button" class="btn btn--ghost btn--sm desktop-rail-toggle" data-act="rail-toggle" aria-expanded="${!state.desktopRailClosed}" aria-controls="rail">${state.desktopRailClosed?'Show':'Hide'} menu</button>
        <span class="mono mast__id">${state.view==='packages'?'Subscriptions':(s?esc(s.no)+' · '+esc(s.position)+(s.package?' · '+esc(packageLabel(s.package)):''):'Slate')}</span>
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
  if (v === 'packages') return 'Subscriptions';
  if (v === 'home') return 'Home';
  if (v === 'help') return 'Help & user guide';
  if (v === 'posting') return 'Public posting';
  if (v === 'applications') return 'New applications';
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
    (state.view==='packages' ? `<span class="dot"></span><span>Subscriptions</span>` :
    (s ? `<span class="dot"></span><button type="button" data-go="overview">${esc(s.client||'Search')}</button>` : '')) +
    destCrumb + tail;
  document.title = state.user
    ? (state.view==='home' ? 'Home' : viewLabel()) + (s ? ' · '+(s.client||'Search') : '') + ' · Slate'
    : 'Slate — Executive Search';
}

function homeIcon(){
  return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 11 12 4l9 7M5 10v10h14V10M9 20v-7h6v7"/></svg>';
}

function publicFrame(body){
  const controls = window.SlateAuth.signedIn
    ? '<div class="row"><a class="btn btn--secondary" href="/#/home">My workspace</a><button class="btn btn--ghost" data-act="logout">Sign out</button></div>'
    : isInvitationPage()
      ? `<div class="row"><a class="btn btn--ghost" href="/join/sign-in${esc(location.search)}">Sign in</a><a class="btn btn--primary" href="/join/sign-up${esc(location.search)}">Sign up</a></div>`
      : `<div class="row"><button class="btn btn--ghost" data-act="sign-in" ${state.authError?'disabled':''}>Sign in</button><button class="btn btn--primary" data-act="sign-up" ${state.authError?'disabled':''}>Sign up</button></div>`;
  return `<div class="gate welcome"><a class="skip" href="#main">Skip to content</a>
    <header class="gate__bar"><a class="rail__brand" href="/" aria-label="Slate home">${homeIcon()}<span class="rail__name">Slate</span></a>
      <button type="button" class="btn btn--ghost" data-act="public-nav-toggle" aria-expanded="${state.publicNavOpen}" aria-controls="public-nav">Menu</button>
      <nav id="public-nav" class="public-nav" aria-label="Site navigation" ${state.publicNavOpen?'':'hidden'}>
        <a href="/" ${location.pathname==='/'?'aria-current="page"':''}>Home</a>
        <a href="/how-it-works#welcome-how">How it works</a>
        <a href="/pricing" ${location.pathname==='/pricing'?'aria-current="page"':''}>Search pricing</a>
        <a href="/careers">Find a position</a>${controls}
      </nav></header>
    <button type="button" class="public-nav-scrim" data-act="public-nav-close" aria-label="Close menu" ${state.publicNavOpen?'':'hidden'}></button>
    <main id="main" class="wrap welcome__main stack" tabindex="-1">${body}</main>
    <footer class="wrap welcome__footer">Slate · Executive search for local government</footer></div>`;
}

function subscriptionInfo(){
  return `<p>Each search project has a one-time payment before paid work begins. Creating an account or workspace does not charge you.</p>
    <p>Choose a search workflow, review the project total, and have your workspace administrator complete checkout.</p>`;
}

async function loadBilling(){
  state.billing = { loading: true };
  state.billingActionError = null;
  render();
  try {
    state.billing = await api('/api/public/project-offer');
  } catch (error) { state.billing = { error: error.message }; }
  render();
}

function vPricing(){
  document.title = 'Search pricing · Slate';
  const offer = state.billing || {};
  const total = offer.configured ? `${esc(offer.currency.toUpperCase())} ${(offer.amount/100).toFixed(2)}` : 'Pricing available soon';
  return publicFrame(`<div><p class="t-label">Project pricing</p><h1 class="t-title">Search pricing</h1>
    <p class="t-body">A one-time fee applies to each search project. Candidates browse and apply for free.</p></div>
    <section class="welcome__card stack" aria-label="Pilot search offer"><h2 class="t-section">Pilot search</h2>
      <p><strong>${total}</strong> per search project</p>
      <p>Includes the search workspace and an AI research and drafting allowance${offer.configured ? ' of $'+esc(offer.allowanceUsd.toFixed(2)) : ''}.</p>
      ${!offer.configured ? '<p>Checkout is not open yet. Contact support for pilot terms.</p>' : ''}
      <a class="btn btn--primary" href="${state.user ? '/#/home' : '/sign-up'}">${state.user ? 'My workspace' : 'Create account'}</a>
    </section>`);
}

function isInvitationPage(){ return /^\/join(?:\/|$)/.test(location.pathname); }

function vSessionTask(){
  const task = window.SlateAuth.pendingTask;
  const title = { 'choose-organization':'Choose your search workspace', 'reset-password':'Update your password', 'setup-mfa':'Secure your account' }[task] || 'Finish signing in';
  return publicFrame(`<section class="welcome__card stack"><p class="t-label">Continue to your search</p>
    <h1 class="t-title">${esc(title)}</h1>
    <p>Your account is signed in. Complete this required step to open your assigned search.</p>
    ${task === 'choose-organization'
      ? `${state.taskChoicesError ? `<p role="alert">${esc(state.taskChoicesError)}</p>` : ''}
        ${(state.taskChoices || []).map(w => `<div class="row"><button class="btn btn--primary" data-act="complete-workspace-task" data-org="${esc(w.id)}" ${state.orgBusy?'disabled':''}>${w.accept ? 'Accept invitation to' : 'Continue with'} ${esc(w.name)}</button></div>`).join('')}
        ${state.taskChoices?.length === 0 ? '<p role="status">No workspace or invitation is available for this account. Ask your search team to invite the email you signed in with.</p>' : ''}`
      : `<div data-clerk-task="${esc(task || '')}"></div>`}
    <p class="t-small">Use the workspace named in your invitation. If it is missing, check that you signed in with the email your team invited.</p>
    <div class="row"><button class="btn btn--secondary" data-act="auth-retry">Try again</button><button class="btn btn--ghost" data-act="logout">Use a different account</button></div>
  </section>`);
}

async function continueInvitation(){
  const params = new URLSearchParams(location.search);
  const target = params.get('organization');
  // Clerk can also issue opaque tickets. Without a target, let the member
  // choose instead of mistaking their old workspace for the new invitation.
  if (params.has('__clerk_ticket') && !target) return false;
  const memberships = (state.workspaces || []).filter(w => w.role && (!target || w.id === target));
  // A pending invitation still needs explicit acceptance. Never choose
  // between several workspaces or infer membership from URL parameters.
  const pending = (state.invites || []).filter(i => !target || i.organizationId === target);
  if (state.invitesError || pending.length || memberships.length !== 1) return false;
  await enterWorkspace(memberships[0].id);
  return !state.orgError;
}

function vInvitation(){
  const params = new URLSearchParams(location.search);
  const signup = location.pathname.startsWith('/join/sign-up')
    || (!location.pathname.startsWith('/join/sign-in') && params.get('__clerk_status') === 'sign_up');
  const failure = state.authError ? `<p role="alert">${esc(state.authError)}</p><button class="btn" data-act="auth-retry">Try again</button>` : '';
  const workspaces = (state.workspaces || []).filter(w => w.role && (!params.get('organization') || w.id === params.get('organization')));
  return publicFrame(`<div class="welcome__grid"><section class="stack">
    <p class="t-label">Search team invitation</p><h1 class="t-title">Join your search team</h1>
    <p class="t-body">Your team uses Slate to organize the search, share materials, and evaluate candidates.</p>
    <ol class="welcome__steps invitation__steps"><li><strong>Use your invited email</strong><span>Sign in or create an account with the address that received the invitation.</span></li><li><strong>Join the workspace</strong><span>Accept your invitation, then open the workspace your team invited you to.</span></li><li><strong>Open your assigned search</strong><span>Confirm your name if prompted. Your team sets your role and search access.</span></li></ol>
    <p class="t-small">Link expired or invitation missing? Ask the person who invited you to send a new invitation to the email you use here.</p>
    </section><section class="welcome__card stack" aria-label="Join your team">
    ${!state.user ? `${failure || `<h2 class="t-section">${signup ? 'Create your account' : 'Sign in to join'}</h2><div data-clerk-auth="${signup ? 'sign-up' : 'sign-in'}"></div>`}
      <a href="/join/${signup ? 'sign-in' : 'sign-up'}${esc(location.search)}">${signup ? 'Already have an account? Sign in' : 'New to Slate? Create an account'}</a>`
      : `<h2 class="t-section">Your team access</h2><p>Signed in as <strong>${esc(state.user.email)}</strong></p>
      ${state.orgError ? `<p role="alert">${esc(state.orgError)}</p>` : ''}
      ${state.workspacesError ? `<p role="alert">${esc(state.workspacesError)}</p>` : ''}
      ${inviteList()}
      ${workspaces.map(w => `<div class="stack stack--tight"><strong>${esc(w.name)}</strong><span>${esc(w.roleLabel)}</span><button class="btn btn--primary" data-act="switch-workspace" data-org="${esc(w.id)}" ${state.orgBusy?'disabled':''}>Continue to workspace</button></div>`).join('')}
      <div class="row"><button class="btn btn--secondary" data-act="check-invites" ${state.orgBusy?'disabled':''}>Check invitations</button><button class="btn btn--ghost" data-act="logout">Use a different account</button></div>`}
    </section></div>`);
}

function vGate(){
  const authPage = /^\/(sign-up|sign-in)(?:\/|$)/.exec(location.pathname)?.[1];
  const failure = state.authError ? `<p role="alert">${esc(state.authError)}</p><button class="btn" data-act="auth-retry">Try again</button>` : '';
  if (authPage) {
    const signup = authPage === 'sign-up';
    document.title = (signup ? 'Sign up' : 'Sign in') + ' · Slate';
    return publicFrame(`<div class="welcome__grid"><section class="stack"><p class="t-label">${signup ? 'Start your search workspace' : 'Welcome back'}</p>
      <h1 class="t-title">${signup ? 'Create your Slate account' : 'Sign in to Slate'}</h1>
      <p class="t-body">${signup ? 'For organizations, search consultants, and invited committee members. After creating your account, confirm your name, choose how you will use Slate, and create or join a workspace.' : 'Use the email your search team knows to open your workspace and assignments.'}</p>
      <p>Looking for your next position? <a href="/careers">Browse openings and apply as a candidate</a>. You do not need a staff workspace.</p>
      <p class="t-small">${signup ? 'Account creation does not purchase a search. ' : ''}<a href="/pricing">Search pricing</a></p></section>
      <section aria-label="${signup ? 'Sign up' : 'Sign in'} form" class="welcome__auth">${failure || '<div data-clerk-auth="'+authPage+'"></div>'}</section></div>`);
  }
  document.title = 'Slate · Guided executive search';
  return publicFrame(`<section class="welcome__hero stack"><p class="t-label">From search priorities to your next hire</p>
    <h1 class="t-title">A clear next step.<br>For every executive search.</h1>
    <p class="t-body">Slate helps local governments and search firms define the role, bring their committee together, recruit candidates, and organize evaluations and interviews in one shared workspace.</p></section>
    ${failure}
    <section aria-labelledby="welcome-paths"><h2 id="welcome-paths" class="t-section">What brings you to Slate?</h2>
      <div class="welcome__grid">
        <article class="welcome__card stack"><p class="t-label">For hiring teams</p><h3 class="t-section">I’m conducting a search</h3>
          <p>Set up your organization, choose a search workflow, invite your team, and follow a guided process from planning through selection.</p>
          <a class="btn btn--primary" href="/sign-up">Set up an organization</a><p class="t-small">Already invited? <a href="/join">Join your search team</a> with the email on your invitation.</p></article>
        <article class="welcome__card stack"><p class="t-label">For candidates</p><h3 class="t-section">I’m looking for a position</h3>
          <p>Explore published openings, review requirements, and apply with your verified email. Save a draft and return to finish it.</p>
          <a class="btn btn--secondary" href="/careers">Browse openings</a><p class="t-small">Have a questionnaire invitation? Open the private link your search team sent you.</p></article>
      </div></section>
    <section class="stack" aria-labelledby="welcome-how"><h2 id="welcome-how" class="t-section">How your team gets started</h2>
      <ol class="welcome__steps"><li><strong>Create your account</strong><span>Confirm your name and tell us how you will use Slate.</span></li><li><strong>Set up your workspace</strong><span>Create a space for your organization, or accept your team’s invitation.</span></li><li><strong>Start your first search</strong><span>Enter the position, choose a workflow, and assemble the committee.</span></li></ol></section>
    <section class="welcome__card stack"><h2 class="t-section">Search pricing</h2>${subscriptionInfo()}<a href="/pricing">View search pricing</a></section>`);
}

const ACCOUNT_PATHS = {
  organization: { label:'Organization conducting a search', description:'I am hiring for my organization.', tasks:'Create a workspace, invite the team, and start an executive search.', next:'Create a workspace for your organization if this deployment allows it, or join by invitation. Then enter your first position and choose a search package.' },
  candidate: { label:'Candidate looking for a position', description:'I want to find and apply for opportunities.', tasks:'Browse openings, verify your email, and save or submit an application.', next:'Open the candidate portal and choose a position. You do not need to create or join a staff workspace. Each application uses its own email verification.' },
  consultant: { label:'Search consultant', description:'I organize and manage executive searches.', tasks:'Set up searches, manage the committee, review candidates, and prepare search documents.', next:'A workspace administrator must authorize consultant access. Once approved, you can work across the firm’s searches.' },
  committee: { label:'Committee member', description:'I help evaluate candidates for a search.', tasks:'Share what you are looking for, review assigned search materials, and score candidates.', next:'Your search consultant adds you to the committee using your sign-in email. Only your assigned searches will appear.' }
};

function accountFrame(body){
  document.title = 'Account setup · Slate';
  return `<div class="gate onboarding"><a class="skip" href="#main">Skip to content</a>
    <header class="gate__bar"><a class="rail__brand" href="/" data-act="slate-home" aria-label="Slate home">${homeIcon()}<span class="rail__name">Slate</span></a><div class="auth-profile"><a href="/pricing">Search pricing</a><div data-clerk-user></div><button class="btn btn--ghost" data-act="logout">Sign out</button></div></header>
    <main id="main" class="onboarding__main stack" tabindex="-1">${body}</main></div>`;
}

/**
 * Step 1 of Sign in → Choose workspace → Confirm access → Start work.
 *
 * Somebody who arrived on an invitation already has a role, so they are not
 * offered the choice: they are told what they have joined and asked only for
 * the name their colleagues will see. Everybody else picks a path, which
 * changes the guidance they get and nothing about what they can open.
 */
function vOnboarding(){
  const draft = state.onboardingDraft || {};
  const assigned = state.onboarding?.role || null;
  const selected = draft.requestedRole || state.onboarding?.requestedRole || '';
  const path = ACCOUNT_PATHS[selected];
  return accountFrame(`<div><p class="t-label">Welcome to Slate · Account setup</p>
    <h1 class="t-title">${assigned ? 'Confirm your name' : 'How will you use Slate?'}</h1>
    <p class="t-body">${assigned
      ? 'This is the name your colleagues see on the roster and against your scores.'
      : 'Slate guides hiring teams through executive searches and helps candidates find and apply for published positions. Choose your path to get started.'}</p></div>
    <form id="onboardingform" class="stack">
      <div class="onboarding__identity"><label class="stack stack--tight" for="onboarding-name"><span>Your name</span><input class="input" id="onboarding-name" name="name" autocomplete="name" required maxlength="120" value="${esc(draft.name ?? state.user.name)}"></label>
        <p class="t-small">Signed in as <strong>${esc(state.user.email)}</strong>. Use the email your search team knows.</p></div>
      ${assigned ? `<div class="onboarding__next"><h2 class="t-section">You have joined ${esc(state.onboarding.organization?.name || 'a workspace')}</h2>
        <p>Your role there is <strong>${esc(state.onboarding.roleLabel)}</strong>. ${esc(state.onboarding.roleSummary || '')}</p>
        <p class="t-small">An administrator of that workspace sets this role. You do not choose it here.</p></div>`
      : `<fieldset class="onboarding__choices"><legend>Choose how you will use Slate</legend><div class="onboarding__grid">${Object.entries(ACCOUNT_PATHS).map(([key, option]) => `<label class="onboarding__choice">
        <input type="radio" id="onboarding-role-${key}" name="requestedRole" value="${key}" required ${selected===key?'checked':''}>
        <span><strong>${option.label}</strong><span>${option.description}</span><span class="t-small">${option.tasks}</span></span></label>`).join('')}</div></fieldset>
      <div class="onboarding__next" aria-live="polite"><h2 class="t-section">${path ? 'What happens next' : 'A workspace built around your role'}</h2><p>${path ? path.next : 'Choose a role to see how you will get started.'}</p>
        <p class="t-small">This choice guides what we show you. It does not grant access: that comes from the workspace you join.</p></div>`}
      ${state.onboardingError ? `<p role="alert">${esc(state.onboardingError)}</p>` : ''}
      <div class="row"><button class="btn btn--primary" type="submit" ${state.onboardingSaving?'disabled':''}>${state.onboardingSaving?'Saving…':'Continue'}</button>
        ${!state.onboarding?.required ? '<button class="btn btn--ghost" type="button" data-act="cancel-account-setup">Cancel</button>' : ''}</div>
    </form>`);
}

/** The invitations Clerk is holding for this account, once they are asked for. */
function inviteList(){
  if (state.invitesError) return `<p role="alert">${esc(state.invitesError)}</p>`;
  if (state.invites === null) return '';
  if (!state.invites.length) {
    return '<p class="t-small" role="status">No invitations are waiting for <strong>' + esc(state.user.email)
      + '</strong>. An administrator has to invite that exact address.</p>';
  }
  return `<ul class="wslist" role="list">${state.invites.map(i => `<li class="wslist__row">
    <span class="wslist__id"><strong>${esc(i.organizationName)}</strong>
      <span class="t-small">Invited as ${esc(ROLE_LABEL[i.role] || i.role)}</span></span>
    <button class="btn btn--primary btn--sm" data-act="accept-invite" data-invite="${esc(i.id)}" ${state.orgBusy?'disabled':''}>Accept and open</button>
  </li>`).join('')}</ul>`;
}

const ROLE_LABEL = {
  'org:admin':'Organization administrator',
  'org:consultant':'Search consultant',
  'org:committee':'Committee member'
};

/**
 * Step 2: choose a workspace.
 *
 * Three different people land here and they need three different things: the
 * firm owner who has to create a workspace, the colleague waiting on an
 * invitation, and the person who belongs to several and has to say which one
 * they are working in. All three are on the page, ordered by which is most
 * likely given what we already know about this account.
 */
function vCandidateStart(){
  return accountFrame(`<div><p class="t-label">Candidate setup complete</p><h1 class="t-title">Find your next position</h1><p class="t-body">Welcome, ${esc(state.user.name)}. Your next step is to choose an opening in the candidate portal.</p></div>
    <ol class="welcome__steps"><li><strong>Browse openings</strong><span>Read the position, requirements, deadline, and contact details.</span></li><li><strong>Verify your email</strong><span>Open Apply on a position and verify your email to access that application.</span></li><li><strong>Apply and keep your receipt</strong><span>Save a draft, add the required materials, review, and submit. Return through the same posting.</span></li></ol>
    <div class="row"><a class="btn btn--primary" href="/careers">Browse openings</a><button class="btn btn--secondary" data-act="edit-account-setup">Change how I use Slate</button></div>
    <section class="onboarding__next stack"><h2 class="t-section">Already started an application?</h2><p>Open the same job posting and verify the email you used to apply. This account does not automatically link or display applications.</p><p>If you received a private questionnaire invitation, use that original link. Contact the search team listed on the posting if you need help.</p></section>`);
}

function vWorkspaceChooser(){
  const list = (state.workspaces || []).filter(w => w.role);
  const unusable = (state.workspaces || []).filter(w => !w.role);
  const mayCreate = state.canCreateWorkspace;
  const wantsToOwn = mayCreate && ['organization', 'consultant'].includes(state.onboarding?.requestedRole);
  const draft = state.orgDraft || {};
  const createForm = `<form id="createworkspace" class="stack stack--tight">
    <label class="stack stack--tight" for="ws-name"><span>Workspace name</span>
      <input class="input" id="ws-name" name="name" maxlength="100" required placeholder="Organization or search firm name" value="${esc(draft.name || '')}"></label>
    <p class="t-small">This creates a separate workspace for your organization or search firm. You become its administrator and can invite colleagues. To work with an existing team, join by invitation instead.</p>
    <div class="row"><button class="btn btn--primary" type="submit" ${state.orgBusy?'disabled':''}>${state.orgBusy?'Creating…':'Create a workspace'}</button></div>
  </form>`;

  const joinBlock = `<section class="onboarding__next stack stack--tight"><h2 class="t-section">Join an existing workspace</h2>
    <p>An administrator at your organization invites <strong>${esc(state.user.email)}</strong>. When they do, the invitation appears here.</p>
    <div class="row"><button class="btn btn--secondary" data-act="check-invites" ${state.orgBusy?'disabled':''}>Check invitations</button>
      <button class="btn btn--ghost" data-act="logout">Use a different account</button></div>
    ${inviteList()}</section>`;

  const chooseBlock = list.length ? `<section class="stack stack--tight"><h2 class="t-section">${list.length===1?'Your workspace':'Choose a workspace'}</h2>
    <ul class="wslist" role="list">${list.map(w => `<li class="wslist__row">
      <span class="wslist__id"><strong>${esc(w.name)}</strong><span class="t-small">${esc(w.roleLabel)}</span></span>
      <button class="btn btn--primary btn--sm" data-act="switch-workspace" data-org="${esc(w.id)}" ${state.orgBusy?'disabled':''}>Open</button>
    </li>`).join('')}</ul></section>` : '';

  const blocked = unusable.length ? `<p class="t-small">You are also in ${unusable.map(w => esc(w.name)).join(', ')}, with a role Slate does not open searches for. An administrator there can assign you one.</p>` : '';

  return accountFrame(`<div><p class="t-label">Step 2 of 3 · Choose workspace</p>
    <h1 class="t-title">${list.length ? 'Where are you working?' : 'You are not in a workspace yet'}</h1>
    <p class="t-body">${list.length
      ? 'Each workspace belongs to one organization or search firm. Its searches, staff, and committees are kept separate.'
      : mayCreate
        ? 'A workspace is your organization\u2019s shared space. Create your own, or join one you have been invited to.'
        : 'A workspace is your organization\u2019s shared space. You join one by invitation from an organization already using Slate.'}</p></div>
    ${state.workspacesError ? `<p role="alert">${esc(state.workspacesError)} <button class="btn btn--ghost btn--sm" data-act="check-account-access">Try again</button></p>` : ''}
    ${state.orgError ? `<p role="alert">${esc(state.orgError)}</p>` : ''}
    <div class="row"><button class="btn btn--ghost" data-act="edit-account-setup">Change how I use Slate</button><a href="/pricing">Search pricing</a></div>
    ${chooseBlock}
    ${blocked}
    ${!mayCreate
      // This deployment does not hand a workspace to whoever signs up. Say so
      // rather than showing a form that would be refused after it is filled in.
      ? joinBlock
      : wantsToOwn || list.length
        ? `<section class="onboarding__next stack stack--tight"><h2 class="t-section">Create a workspace</h2>${createForm}</section>${joinBlock}`
        : `${joinBlock}<section class="onboarding__next stack stack--tight"><h2 class="t-section">Or create your own workspace</h2>${createForm}</section>`}`);
}

/** The session names a workspace this account is no longer in. */
function vMembershipLost(){
  return accountFrame(`<div><p class="t-label">Workspace access</p>
    <h1 class="t-title">You are no longer in this workspace</h1>
    <p class="t-body">Your access to the workspace this tab was open in has ended. Nothing from it is shown here.</p></div>
    <section class="onboarding__next stack stack--tight">
      <p>If this is unexpected, ask an administrator at that firm to invite <strong>${esc(state.user.email)}</strong> again.</p>
      <p class="t-small">Your record of what you did there is kept. It is your access that ended, not your work.</p></section>
    ${state.orgError ? `<p role="alert">${esc(state.orgError)}</p>` : ''}
    <div class="row"><button class="btn btn--primary" data-act="check-account-access">Check my workspaces</button>
      <button class="btn btn--secondary" data-act="logout">Sign out</button></div>`);
}

/** In the workspace, holding a role Slate does not act on. */
function vRolePending(){
  const org = state.onboarding?.organization?.name || 'this workspace';
  return accountFrame(`<div><p class="t-label">Step 3 of 3 · Confirm access</p>
    <h1 class="t-title">Your role in ${esc(org)} is not set up yet</h1>
    <p class="t-body">You are a member of ${esc(org)}, but the role you hold there does not open search records.</p></div>
    <section class="onboarding__next stack stack--tight">
      <p>Ask an administrator of ${esc(org)} to set your role to search consultant or committee member for <strong>${esc(state.user.email)}</strong>.</p>
      ${state.onboarding?.providerRole ? `<p class="t-small">Your current role is <span class="mono">${esc(state.onboarding.providerRole)}</span>.</p>` : ''}
    </section>
    <div class="row"><button class="btn btn--primary" data-act="check-account-access">Check again</button>
      ${(state.workspaces||[]).filter(w => w.role).length ? '<button class="btn btn--secondary" data-act="open-workspaces">Switch workspace</button>' : ''}</div>`);
}

/** In the workspace, but not on any search yet. */
function vAssignmentPending(){
  const org = state.onboarding?.organization?.name || 'this workspace';
  return accountFrame(`<div><p class="t-label">Step 3 of 3 · Confirm access</p>
    <h1 class="t-title">You are part of ${esc(org)}</h1>
    <p class="t-body">Your search assignment is pending. An account manager adds committee members to one search at a time, so being in the workspace is not by itself an assignment.</p></div>
    <section class="onboarding__next stack stack--tight">
      <p>Ask your search consultant to add <strong>${esc(state.user.email)}</strong> to the search you are serving on.</p>
      <p class="t-small">Nothing is sent by pressing the button below; it re-reads your assignments.</p></section>
    ${state.onboardingError ? `<p role="alert">${esc(state.onboardingError)}</p>` : ''}
    <div class="row"><button class="btn btn--primary" data-act="check-account-access">Check for assignments</button>
      <button class="btn btn--secondary" data-act="my-access">My access</button></div>`);
}

/**
 * My access — what this account holds, and how to change it.
 *
 * The screen the old "Change my role" button promised and could not deliver:
 * the role here is the one the workspace assigned, so this explains it and
 * says who to ask, rather than offering a control that only saved a
 * preference.
 */
function vMyAccess(){
  const o = state.onboarding || {};
  const assignments = (state.searches || []).map(s => `<li><strong>${esc(s.client || 'Untitled')}</strong> · ${esc(SEARCH_ROLE[s.searchRole]?.label || 'Assigned')}${s.no ? ' · <span class="mono">'+esc(s.no)+'</span>' : ''}</li>`).join('');
  const others = (state.workspaces || []).filter(w => w.id !== state.org?.id && w.role);
  return accountFrame(`<div><p class="t-label">Your account</p><h1 class="t-title">My access</h1>
    <p class="t-body">Signed in as <strong>${esc(state.user.email)}</strong>.</p></div>
    <section class="onboarding__next stack stack--tight"><h2 class="t-section">${esc(state.org?.name || 'No active workspace')}</h2>
      ${o.roleLabel ? `<p>Your role here is <strong>${esc(o.roleLabel)}</strong>. ${esc(o.roleSummary || '')}</p>` : '<p>You have no role in an active workspace.</p>'}
      <p class="t-small">Roles are set by an administrator of this workspace in Team &amp; access. To change yours, ask one of them.</p></section>
    <section class="stack stack--tight"><h2 class="t-section">Your searches</h2>
      ${assignments ? `<ul class="wslist wslist--plain" role="list">${assignments}</ul>` : '<p class="t-small">You are not on any search in this workspace.</p>'}
      <p class="t-small">An account manager adds people to individual searches. Being in the workspace is a separate thing from being on a search.</p></section>
    ${others.length ? `<section class="stack stack--tight"><h2 class="t-section">Your other workspaces</h2>
      <ul class="wslist" role="list">${others.map(w => `<li class="wslist__row"><span class="wslist__id"><strong>${esc(w.name)}</strong><span class="t-small">${esc(w.roleLabel)}</span></span>
        <button class="btn btn--secondary btn--sm" data-act="switch-workspace" data-org="${esc(w.id)}">Switch</button></li>`).join('')}</ul></section>` : ''}
    <div class="row"><button class="btn btn--primary" data-act="close-my-access">Back to work</button>
      <button class="btn btn--secondary" data-act="edit-account-setup">Change my name</button></div>`);
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
    ${head(orgName(),'Your assignments',
      'You are on '+(list.length===1?'a search':list.length+' searches')+' in '+esc(orgName())+' as a committee member. You are asked what you are looking for in the executive, and later you score candidates against what the committee agreed on.',
      owed.length ? `<button class="btn btn--primary" data-open="${owed[0].id}" data-answer="true">Answer for ${esc(owed[0].client)}</button>` : '')}
    <div class="band"><div class="wrap stack">
      ${crossWorkspaceNotice()}
      ${searchesNotice()}
      ${owed.length ? `<div class="spec"><div class="spec__bar">Waiting on you · ${owed.length}</div>
        <div class="spec__body stack stack--tight">${owed.map(s => `<div class="hubrow">
          <div class="hubrow__id"><b>${esc(s.client||'')} · ${esc(s.position||'')}</b>
            <div class="t-small">The committee is being asked what to look for in the next ${esc(s.position||'executive')}. Answer for yourself; nobody sees your answers until the window closes.${s.intakeDue?' <b>'+esc(summaryDeadline(s))+'.</b>':''}</div></div>
          <div class="hubrow__st"></div>
          <div class="hubrow__act"><button class="btn btn--primary btn--sm" data-open="${s.id}" data-answer="true">Answer now</button></div>
        </div>`).join('')}</div>
      </div>` : ''}
      <div class="spec"><div class="spec__bar">Your searches · ${list.length}</div>
        <div class="spec__body spec__body--flush">${list.length ? `<div class="tablewrap"><table class="candtable hometable">
          <thead><tr><th scope="col">Search</th><th scope="col">Your part</th><th scope="col">Open</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>` : `<div class="empty">${emptyState('Nothing yet','When a consultant adds you to a search, it appears here.')}</div>`}</div>
      </div>
    </div></div>`);
}

// Shown when the search index could not be refreshed. The records already
// loaded stay on the page; this says they may be out of date and offers a
// retry, rather than replacing the book with an empty state.
/**
 * A deep link that belongs to a workspace this person can enter, but is not in.
 *
 * Offered as a switch rather than followed, because switching throws away
 * whatever is open here. Nothing about the other workspace's contents is named
 * — only that the link belongs to it.
 */
function crossWorkspaceNotice(){
  const link = state.pendingLink;
  if (!link) return '';
  return `<div class="notice notice--info" role="status"><div>
    <div class="notice__t">That link is in ${esc(link.workspace.name)}</div>
    <div class="notice__b">You are working in ${esc(orgName())}. Opening it switches this tab to
      ${esc(link.workspace.name)} and closes what is open here.</div></div>
    <div class="row"><button class="btn btn--secondary btn--sm" data-act="follow-link">Switch and open</button>
      <button class="btn btn--ghost btn--sm" data-act="dismiss-link">Stay here</button></div></div>`;
}

function searchesNotice(){
  if (!state.searchesError) return '';
  return `<div class="notice notice--wait" role="status"><div>
    <div class="notice__t">This list may be out of date</div>
    <div class="notice__b">${esc(state.searchesError)} The searches below are the ones last loaded.
      <button class="btn btn--secondary btn--sm" data-act="retry-searches">Try again</button></div>
  </div></div>`;
}

function pickedIds(){
  // Only searches this person may archive. Home offers the checkbox across the
  // firm's whole book, but archiving is the manager's decision on each file, so
  // a selection that could not be carried out is never allowed to form.
  const known = new Set((state.searches||[]).filter(s => s.mayArchive).map(s => s.id));
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

function workspaceQuickStart(){
  return `<section class="spec" aria-labelledby="workspace-start"><div class="spec__body stack"><h2 class="t-section" id="workspace-start">Get started with Slate</h2>
    <p>Plan the search, gather committee priorities, prepare recruiting materials, and evaluate candidates in one workspace. Your workspace is ready; start with the position you need to fill.</p>
    <ol class="welcome__steps"><li><strong>Open a search</strong><span>Enter the employer and position, then choose the workflow that fits the search.</span></li><li><strong>Assemble your team</strong><span>Invite colleagues to the workspace and add the committee to the search.</span></li><li><strong>Follow the next task</strong><span>Open the search overview for the next step and instructions.</span></li></ol>
    <div class="row">${state.caps?.createSearch ? '<button class="btn btn--primary" data-go="new">Start your first search</button>' : ''}<button class="btn btn--secondary" data-go="help">Read the getting-started guide</button><a href="/pricing">Search pricing</a></div></div></section>`;
}

function vHome(){
  if (isCommittee()) return vHomeCommittee();
  const u = state.user;
  const canDelete = isStaff();
  const list = state.searches || [];
  const shown = list.filter(matchesHomeQuery);
  const picked = pickedIds();
  state.picked = picked;
  const allPicked = shown.length > 0 && shown.every(s => picked.includes(s.id));
  const complete = list.filter(s => s.progress && s.progress.done >= s.progress.total).length;
  const live = list.length - complete;
  const pickup = list.find(s => s.progress?.next);
  const owed = list.filter(s => s.intakeOpen && s.searchRole && !s.intakeMine);
  const manage = canDelete && Boolean(state.open.homemanage);
  const managed = list.filter(s => s.searchRole === 'manager');

  const rows = shown.map(s => {
    const n = s.progress?.next;
    const on = picked.includes(s.id);
    const counts = s.candidateCounts;
    const due = summaryDeadline(s);
    return `<tr${on?' class="is-picked"':''}>
      ${manage?(s.mayArchive
        ? `<td class="pickcell"><input type="checkbox" data-pick-search="${s.id}" ${on?'checked':''} aria-label="Select ${esc(s.client||s.no||'this search')}"></td>`
        : `<td class="pickcell"><span class="u-sr">${esc(s.accountManager?s.accountManager.name+' runs this search':'Another consultant runs this search')}</span></td>`):''}
      <th scope="row"><button type="button" class="candlink" data-open="${s.id}">${esc(s.client||'Untitled')}</button>
        <span class="candmeta">${esc(s.position||'')}${s.packageLabel?' · '+esc(s.packageLabel):''} · <span class="mono">${esc(s.no)}</span></span>
        ${due?`<span class="candmeta">${esc(due)}</span>`:''}</th>
      <td data-label="Phase">${esc(summaryPhase(s))}</td>
      <td data-label="Candidates" class="tnum">${counts
        ? `<b>${counts.total}</b>${counts.total?`<span class="candmeta">${counts.semifinalist+counts.finalist} advanced · ${counts.responses} answered</span>`:''}`
        : '<span class="t-small">Not on this package</span>'}</td>
      <td data-label="Account manager">${s.accountManager?esc(s.accountManager.name):'<span class="t-small">Unassigned</span>'}${s.people>1?' <span class="t-small">+'+(s.people-1)+'</span>':''}</td>
      <td data-label="Next action">${n?esc(STEP_NAME[n.key]||n.t):'<span class="t-small">Every step complete</span>'}</td>
      ${manage?(s.mayArchive
        ? `<td data-label="" class="candacts"><button class="btn btn--danger btn--sm" data-act="delete-search" data-id="${s.id}" data-name="${esc(s.client||s.no||'this search')}">Archive</button></td>`
        : `<td data-label="" class="candacts"><span class="t-small">Their search</span></td>`):''}
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
    ${head(state.onboarding?.roleLabel || 'Workspace', orgName() + ' searches',
      list.length ? esc(live)+' in progress, '+esc(complete)+' complete.' : 'Your workspace is ready. Set up your first search.',
      state.caps?.createSearch ? `<button class="btn btn--primary" data-go="new">Open a new search</button>` : '')}
    <div class="band"><div class="wrap stack">
      ${crossWorkspaceNotice()}
      ${searchesNotice()}
      ${!list.length ? workspaceQuickStart() : ''}
      ${state.caps?.manageMembers && state.team?.invitations?.length ? `<div class="notice notice--info" role="status"><div>
        <div class="notice__t">${state.team.invitations.length} invitation${state.team.invitations.length===1?'':'s'} waiting to be accepted</div>
        <div class="notice__b">They are not in the workspace until they accept.</div></div>
        <button class="btn btn--secondary btn--sm" data-go="team-access">Team &amp; access</button></div>` : ''}
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
          'A search starts by assembling the committee and asking each member what they are looking for. The profile is built from their answers, and everything else is generated from that.',
          state.caps?.createSearch ? `<button class="btn btn--primary" data-go="new">Open a new search</button>` : '')}</div>`}</div>
      </div>
      ${state.caps?.viewArchives ? '<div class="row"><button class="btn btn--secondary btn--sm" data-go="archives">Archived searches</button></div>' : ''}
      ${canDelete && managed.length ? `<div class="spec">
        <div class="spec__bar">Start fresh</div>
        <div class="spec__body stack stack--tight">
          <p>Archive the ${managed.length === 1 ? 'search you manage' : managed.length+' searches you manage'} in ${esc(orgName())} and open a new search. Your account and your place in this workspace stay exactly as they are. Colleagues' searches stay on the book.</p>
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
    ${head('New search','Who is hiring, and for what','Open the file, then add the search committee. The profile comes after the committee has told you what they are looking for.')}
    <div class="band"><div class="wrap"><form id="newsearch" class="stack">
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
          ? 'Opens at the '+esc(packageLabel(state.health?.defaultPackage))+' workflow. Change that on Search facts.'
          : 'Opens the file and takes you to the search committee.')}
    </form></div></div>`);
}

function nextHint(next){
  if (!next) return '';
  if (isCommittee()) {
    const memberHints = {
      team:'See who is on this search. The account manager confirms the roster.',
      intake:'Answer your own questionnaire when collection is open, or preview the questions while you wait.',
      profile:'Read the adopted candidate profile when the account manager shares it.',
      screen:'Review candidates and save your own scores against the adopted profile.',
      finalists:'Review the finalists and your permitted evaluation work.'
    };
    if (memberHints[next.key]) return memberHints[next.key];
  }
  if (next.blocked) {
    if (next.needsCandidates) return 'Add a candidate in Screening first. Later steps wait until someone is on the file.';
    return 'Finish the earlier step first. Later documents are only as good as the profile they inherit.';
  }
  const hints = {
    team:'Add every governing-body or committee member who gets a say, and name the account manager. People on the roster are included in the search.',
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
  return `<div class="steps">${(steps||[]).filter(st => !['guide','survey2'].includes(st.key)).map(st => {
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
  if (st.skipped) return pill('idle','Skipped');
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
        `<span class="rosterchip${m.searchRole==='manager'?' rosterchip--mgr':''}" title="${esc(SEARCH_ROLE[m.searchRole]?.label||m.searchRole)}">
          <span class="rosterchip__i">${esc(m.init)}</span>${esc(m.name)}${intakeDoneBy(m.userId)?' '+ico('check'):''}
        </span>`).join('') || '<span class="t-small">Nobody added yet.</span>'}
      </div>
      <p class="t-small">${s.accountManager?esc(s.accountManager.name)+' runs this account. ':''}${state.preview?'':'<button class="btn btn--ghost btn--sm" data-go="team">Open the roster</button>'}</p>
    </div></div>`;
}

function packagePanel(s){
  if (!s.packageInfo || isCommittee()) return '';
  const left = stepsLeftOut(s.package);
  return `<div class="spec"><div class="spec__bar">${esc(s.packageInfo.label)} workflow</div>
    <div class="spec__body">
      <p class="t-small u-mb-3">${esc(s.packageInfo.lede)}</p>
      <ul class="svcs">${(s.packageInfo.services||[]).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      ${left.length ? `<p class="t-small u-mt-3">Not on this file: ${left.map(st => esc(STEP_NAME[st.key]||st.t)).join(', ')}.${canEdit() && !state.preview?' Change the workflow on <button class="btn btn--ghost btn--sm" data-go="facts">Search facts</button> if the engagement changed.':''}</p>` : ''}
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
    const answered = s.consensus ? s.consensus.submitted : Object.values(s.intake?.answered||{}).filter(Boolean).length;
    return `<div class="spec"><div class="spec__bar">Committee and profile</div>
      <div class="spec__body stack">
        <div class="rosterline">${(s.roster||[]).map(m =>
          `<span class="rosterchip${m.searchRole==='manager'?' rosterchip--mgr':''}" title="${esc(SEARCH_ROLE[m.searchRole]?.label||m.searchRole)}"><span class="rosterchip__i">${esc(m.init)}</span>${esc(m.name)}${intakeDoneBy(m.userId)?' '+ico('check'):''}</span>`).join('') || '<span class="t-small">Nobody added yet.</span>'}
        </div>
        ${kv('Roster', statusPill(team))}
        ${kv('Intake', statusPill(intake)+(s.intake?.status==='open'
          ? ' <span class="t-small">'+answered+' of '+(s.roster||[]).length+' answered</span>'
          : s.intake?.completedEmpty ? ' <span class="t-small">Completed without committee input</span>' : ''))}
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
      b: pending.map(p => esc(p.name || p)).join(', '), key:'intake', cta:'Open candidate profile input' });
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

/* --- getting started ------------------------------------------------------
 *
 * A short checklist of what this person, on this search, has not done yet.
 *
 * Every line is derived from the search as the server decorated it, so it
 * cannot claim something is outstanding that is already done, or offer a step
 * the package leaves off the file or the viewer may not open. It is dismissed
 * per search, per person, in this browser, and Help reopens it: a checklist
 * that cannot be got rid of becomes noise, and one that cannot be got back is
 * a feature somebody loses by accident.
 * ------------------------------------------------------------------------ */

function checklistKey(){
  return 'slate.checklist.' + (state.search?.id || '') + '.' + (state.user?.id || '');
}

function checklistDismissed(){
  try { return localStorage.getItem(checklistKey()) === 'off'; }
  catch { return false; }
}

function setChecklistDismissed(off){
  try { localStorage.setItem(checklistKey(), off ? 'off' : 'on'); }
  catch { /* private browsing; the checklist simply comes back */ }
}

/**
 * What is actually outstanding, in the order it has to happen.
 *
 * `done` lines are kept and shown struck through rather than removed, so the
 * list reads as progress instead of shrinking mysteriously.
 */
function checklistItems(s){
  const step = key => (s.steps || []).find(x => x.key === key) || null;
  const has = key => step(key)?.status === 'done';
  const onFile = key => Boolean(step(key));
  const items = [];

  if (isCommittee()){
    const mine = s.intake?.responses?.[state.user?.id]?.submitted;
    const open = s.intake?.status === 'open';
    if (!s.intake?.skipped) items.push({
      done: Boolean(mine),
      label: 'Submit what you are looking for in this hire',
      note: open
        ? 'The input window is open. Save a private draft as often as you like; submit when you are ready.'
        : (mine ? 'Counted in the tally.' : 'The input window is not open. The account manager opens it.'),
      go: open && canOpenStep('intake') ? 'intake-mine' : null,
      goLabel: 'Open your questionnaire'
    });
    items.push({
      done: Boolean(s.candidates?.length && Object.keys(s.scores?.[state.user?.id] || {}).length),
      label: 'Score the candidates',
      note: s.candidates?.length
        ? 'Each person scores privately. The account manager decides when the panel sees each other.'
        : 'Nothing to score yet. Candidates appear here once the search team adds them.',
      go: s.candidates?.length && canOpenStep('screen') ? 'screen' : null,
      goLabel: 'Open candidates'
    });
    return items;
  }

  items.push({
    done: Boolean(s.team?.confirmedAt),
    label: 'Add the committee and confirm the roster',
    note: 'The intake window cannot open until the roster is set.',
    go: canOpenStep('team') ? 'team' : null, goLabel: 'Open the roster'
  });
  items.push({
    done: s.intake?.status === 'closed',
    label: s.intake?.skipped ? 'Committee questionnaire skipped' : 'Collect candidate profile input and close the window',
    note: s.intake?.skipped ? 'The organization administrator chose to proceed directly to the candidate profile.' : s.intake?.status === 'open'
      ? 'Open now. Closing it publishes submitted answers to everyone on the search.'
      : s.intake?.status === 'closed' ? 'Closed.' : 'Not opened yet.',
    go: canOpenStep('intake') ? 'intake' : null, goLabel: 'Open candidate profile input'
  });
  items.push({
    done: has('profile'),
    label: 'Adopt the candidate profile',
    note: 'This is what every candidate is scored against.',
    go: canOpenStep('profile') ? 'profile' : null, goLabel: 'Open the profile'
  });
  if (onFile('community')) items.push({
    done: has('community'),
    label: 'Research the community and check the facts',
    note: 'Nothing research returns is authoritative until a person has read it against a source.',
    go: canOpenStep('community') ? 'community' : null, goLabel: 'Open the community profile'
  });
  if (canEdit()) items.push({
    done: Boolean(s.posting?.published),
    label: 'Publish the public job posting',
    note: s.posting?.published
      ? (s.posting.accepting ? 'Live and accepting applications.' : 'Live, not accepting applications.')
      : 'Optional. Nothing is public until the account manager publishes it.',
    go: 'posting', goLabel: 'Open Public posting'
  });
  items.push({
    done: Boolean((s.candidates || []).length),
    label: 'Bring candidates onto the file',
    note: 'Add them by hand, or accept applications from the public posting.',
    go: canOpenStep('screen') ? 'screen' : null, goLabel: 'Open candidates'
  });
  return items;
}

function checklistPanel(s){
  if (state.preview || !state.user) return '';
  const items = checklistItems(s);
  const left = items.filter(i => !i.done).length;
  if (!left) return '';
  if (checklistDismissed()) return '';
  return `<div class="spec startlist">
    <div class="spec__bar">Getting started · ${left} left
      <span class="spec__bar-act"><button type="button" class="btn btn--ghost btn--sm" data-act="dismiss-checklist">Hide this</button></span>
    </div>
    <div class="spec__body">
      <p class="t-small">Where this search stands, for you. Reopen this from <b>Help &amp; user guide</b> if you hide it.</p>
      <ol class="startlist__l">${items.map(i => `<li class="startlist__i${i.done?' startlist__i--done':''}">
        <span class="startlist__mark" aria-hidden="true">${i.done?ico('check',13):''}</span>
        <span class="startlist__t"><b>${esc(i.label)}</b><span class="sr-only">${i.done?' — done':''}</span>
          <span class="t-small">${esc(i.note)}</span></span>
        ${!i.done && i.go ? `<button type="button" class="btn btn--ghost btn--sm" data-go="${esc(i.go)}">${esc(i.goLabel)}</button>` : ''}
      </li>`).join('')}</ol>
    </div>
  </div>`;
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
      ${checklistPanel(s)}
      ${outstandingPanel(s)}
      ${candidatePanel(s)}
      ${panels}
      ${activityPanel(s)}`;
}

// The phase of the process this search is in, said in two words. It is not the
// candidate stage and it is not the step count; those are different questions
// and they are answered elsewhere on the page. The catalog's own phase titles
// are sentences, which do not read as a header eyebrow.
const PHASE_SHORT = { convene:'Part 1 \u00b7 Committee input', recruit:'Part 2 \u00b7 Recruiting', people:'Part 3 \u00b7 Candidates' };
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
         may('archiveSearch') ? `<button class="btn btn--ghost btn--sm btn--danger" data-act="delete-search" data-id="${s.id}" data-name="${esc(s.client||s.no||'this search')}">Archive search</button>` : ''
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
        <div class="spec__body"><p class="t-small">The ${esc(packageLabel(s.package))} package does not include ${left.map(st => esc(STEP_NAME[st.key]||st.t)).join(', ')}.${canEdit()?' Change the workflow on Search facts if the engagement changed.':''}</p>
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
  const answered = agg ? agg.submitted : Object.values(s.intake?.answered||{}).filter(Boolean).length;
  const onSearch = Boolean(you().searchRole);
  const open = s.intake?.status === 'open';
  const mine = mySubmission();
  const crit = (s.criteria||[]).filter(c => c.label).length;
  const due = s.intake?.dueBy || '';
  return shell(`
    ${head('Part 1 · Committee input','Committee',
      'Who is on the committee, what they were asked, and the profile their answers produced.',
      onSearch && open && !mine && canOpenStep('intake')
        ? `<button class="btn btn--primary" data-go="intake-mine">Answer your questionnaire</button>` : '')}
    <div class="band"><div class="wrap stack">
      ${rosterPanel(s)}
      <div class="spec"><div class="spec__bar">Candidate profile input</div>
        <div class="spec__body stack stack--tight">
          ${hubRow('Intake window',
            s.intake?.skipped ? 'Optional questionnaire skipped by the organization administrator. Continue with the candidate profile.'
              : open ? `Open${due?' · due '+esc(due):''}. ${answered} of ${roster.length} answered. Saved drafts stay private to whoever wrote them.`
                 : s.intake?.completedEmpty
                   ? 'Completed without committee input. No responses were collected; the reason is on the record.'
                   : s.intake?.status === 'closed'
                     ? 'Closed. Everyone on the search can read the submitted answers; unsent drafts stay private.'
                     : 'Not opened yet.',
            statusPill(intake),
            openBtn('intake', you().consultant ? 'Manage intake' : 'Open the questionnaire', open && !you().consultant))}
          ${onSearch && !s.intake?.skipped ? hubRow('Your answers',
            mine
              ? (intakeHasUnsubmitted()
                ? 'Submitted and counted. You have saved edits that are not submitted yet.'
                : 'On file. You can revise them while the window is open.')
              : open ? 'Not submitted yet.' : 'The window is not open.',
            mine ? pill(intakeHasUnsubmitted() ? 'wait' : 'ok', intakeHasUnsubmitted() ? 'Edits not submitted' : 'Submitted') : pill('idle','Not submitted'),
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

function questionKeys(){
  return ['survey1','survey2','guide'].filter(canOpenStep);
}

function captureQuestionEdits(){
  if (!$('#question-plan')) return;
  const drafts = Object.fromEntries(questionKeys().map(key => [key, collectArtifact(key)]));
  state.search.artifacts = { ...state.search.artifacts, ...drafts };
}

async function saveQuestions(advance=false){
  captureQuestionEdits();
  const body = Object.fromEntries(questionKeys()
    .filter(key => state.search.artifacts?.[key]?.questions?.length || state.search.artifacts?.[key]?.scenarios?.length)
    .map(key => [key, state.search.artifacts[key]]));
  // Include a cleared existing survey so the server reports the missing
  // question, instead of silently leaving the old questions on file.
  for (const key of questionKeys()) {
    if (state.search.artifacts?.[key]?.questions && !body[key]) body[key] = state.search.artifacts[key];
  }
  await withBusy(async () => {
    state.search = await api('/api/searches/'+state.search.id+'/questions', { method:'PUT', body:{ body } });
    toast('Question plan saved. Candidates receive questions when their stage opens.');
    if (advance) await go(nextOf('survey1').key);
  });
}

function vQuestions(){
  const s = state.search;
  const keys = questionKeys();
  const labels = { survey1:'Initial screening', survey2:'Semifinalist questionnaire', guide:'Interviews and assessment' };
  const hints = {
    survey1:'Candidates see these questions when they open their initial survey link.',
    survey2:'Candidates see these questions after you name them semifinalists and open their questionnaire in Screening.',
    guide:'The panel uses these questions during interviews. Scoring guidance stays with the panel.'
  };
  return shell(`
    ${head('Part 2 · Prepare and post', 'Candidate questions', 'Plan the questions once, across every stage. Use each question to ask for different evidence against the adopted profile.')}
    <div class="band"><div class="wrap stack" id="question-plan">
      <div class="notice notice--info"><div><div class="notice__t">One plan, released by stage</div>
        <div class="notice__b">All included question sets are below. Saving prepares them; it does not send invitations. Questionnaires already issued to candidates keep their original wording.</div></div></div>
      <nav class="row" aria-label="Question stages">${keys.map(key => `<button class="btn btn--secondary btn--sm" data-act="jump" data-to="question-stage-${key}">${esc(labels[key])}</button>`).join('')}</nav>
      ${!(s.criteria||[]).some(c => c.label) ? prereqNotice('Adopt the profile first', 'Questions should test the criteria agreed from committee input.', 'profile', 'Open the profile') : ''}
      ${keys.map(key => {
        const a = s.artifacts?.[key];
        const mode = docMode(key);
        return `<section class="spec question-stage" id="question-stage-${key}" aria-labelledby="question-title-${key}">
          <div class="spec__bar"><h2 id="question-title-${key}">${esc(labels[key])}${key==='survey2'?' · Optional':''}</h2></div>
          <div class="spec__body stack"><p class="t-small">${esc(hints[key])}</p>
            ${docBar(key, Boolean(a?.questions?.length))}
            ${mode === 'preview' ? (a ? renderArtifact(key, a) : emptyState('No questions yet','Switch to Edit to add questions.')) : artifactEditor(key, a)}
          </div></section>`;
      }).join('')}
      ${actionBar('<button type="button" class="btn btn--primary" data-act="save-questions">Save all questions</button>',
        `<button type="button" class="btn btn--secondary" data-act="generate-questions" ${state.health?.hasKey?'':'disabled'}>Draft all questions with Claude</button>
         ${state.health?.hasKey?'':'<span class="t-small">Add and edit questions by hand, or configure an API key to draft them together.</span>'}
         ${nextBtn('survey1').replace('btn--primary','btn--secondary')}`)}
    </div></div>`);
}

function vDocuments(){
  const s = state.search;
  const keys = DOC_KEYS.filter(key => canOpenStep(key) && !['guide','survey2'].includes(key));
  const rows = keys.map(key => {
    const has = key === 'profile' ? (s.criteria||[]).some(c => c.label) : Boolean(s.artifacts?.[key]);
    const meta = key === 'survey1' ? { title:'Candidate questions' } : DRAFTS[key] || { title: STEP_NAME[key] || key };
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

// Old package bookmarks lead to the provider-backed subscription page.
function vPackages(){
  return shell(head('Search pricing', 'Project fees',
    'Each search has a one-time project payment.',
    '<a class="btn btn--primary" href="/pricing">View search pricing</a>'));
}

function vProjectBilling(){
  const s = state.search;
  if (!s) return shell(head('Project payment', 'Choose a search', 'Open a search to review its payment.'));
  const p = s.projectPayment || { state:'unpaid' };
  const offer = p.offer || {};
  const amount = p.amount ?? offer.amount;
  const currency = p.currency || offer.currency || 'usd';
  const total = amount == null ? 'Not available yet' : `${esc(currency.toUpperCase())} ${(amount/100).toFixed(2)}`;
  const status = p.state === 'legacy' ? 'Legacy access pending owner review' : p.state.replaceAll('-', ' ');
  const active = s.projectAccess?.state === 'paid' || s.projectAccess?.state === 'legacy';
  return shell(`${head('Project payment', s.client || 'Search project', 'Review the one-time project total and payment status.')}
    <div class="band"><div class="wrap stack"><section class="welcome__card stack">
      <h2 class="t-section">${esc(s.position || 'Search')} · ${esc(s.client || 'Client')}</h2>
      <p><strong>Selected workflow:</strong> ${esc(s.packageInfo?.label || s.package || '')}</p>
      <p><strong>One-time total:</strong> ${total}</p>
      <p><strong>Payment status:</strong> ${esc(status)}</p>
      ${p.allowanceUsd || offer.allowanceUsd ? `<p><strong>Included AI allowance:</strong> $${esc(Number(p.allowanceUsd || offer.allowanceUsd).toFixed(2))}</p>` : ''}
      ${p.paidAt ? `<p><strong>Amount paid:</strong> ${total} on ${esc(p.paidAt.slice(0,10))}</p>` : ''}
      ${p.receiptUrl ? `<a href="${esc(p.receiptUrl)}" target="_blank" rel="noopener noreferrer">Receipt</a>` : ''}
      ${!active && canEdit() ? `<div class="row">${isAdmin() && offer.configured !== false && !['processing','refunded','partially-refunded','disputed'].includes(p.state) ? '<button class="btn btn--primary" data-act="project-checkout">Continue to checkout</button>' : '<p>Contact support or ask your workspace administrator about payment.</p>'}
        <button class="btn btn--secondary" data-act="project-reconcile">Check payment status</button></div>` : ''}
      ${active ? `<p>${p.state === 'legacy' ? 'This existing search remains accessible under legacy terms while the owner reviews its payment status.' : 'Project access is active. You can continue the search.'}</p><button class="btn btn--primary" data-go="team">Continue search</button>` : ''}
      <p class="t-small">Questions about a payment? Contact support with the search number.</p>
    </section></div></div>`);
}

function vFacts(){
  const s = state.search;
  const pkgOpen = Boolean(state.open.factspkg);
  return shell(`
    ${head('Search facts', s.client||'Client','These facts feed every generated document. Check them before you draft recruiting copy.')}
    ${researchNoticeBand()}
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
      ${sectionHead('Search workflow', packageLabel(s.package), `<button type="button" class="btn btn--ghost btn--sm" data-panel="factspkg" aria-expanded="${pkgOpen}" aria-controls="factspkg" data-open-label="Change the workflow" data-close-label="Hide workflow options">${pkgOpen?'Hide workflow options':'Change the workflow'}</button>`)}
      <div id="factspkg"${pkgOpen?'':' hidden'}>
        <p class="t-small u-mb-3">Choosing a shorter workflow removes steps from this search. Anything already drafted on them stays on file and comes back if you move up again.</p>
        ${packageChoice(s.package)}
      </div>` : ''}
      ${actionBar(
        `<button class="btn btn--primary" data-act="save-facts">Save facts</button>`,
        researchAction('Research this ' + jurisdictionInfo().noun)
        + ` <button type="button" class="btn btn--ghost" data-go="verify">County fact verification${factGap(s)}</button>`
        + ` <button type="button" class="btn btn--ghost" data-go="profile">Candidate profile</button>`)}
      <label class="t-small u-inline-check"><input type="checkbox" id="deeper-research">Find missing facts with additional web searches</label>
      <label class="t-small u-inline-check"><input type="checkbox" id="refresh-evidence">Refresh public sources</label>
    </form></div></div>`);
}

// How many material facts are still unconfirmed, shown on the way in so the
// gap is visible while the work is happening rather than when a county reads
// the brochure. Defined below vFacts deliberately: tests/jurisdictions.js
// renders that screen from the source between vFacts and searchRolePill, so its
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

      ${!may(frozen ? 'reopenSearch' : 'closeSearch')
        ? `<div class="spec"><div class="spec__bar">${frozen ? 'Reopening' : 'Closing'} this search</div>
        <div class="spec__body stack stack--tight">
          <p class="t-small">${esc(askManager())} ${frozen
            ? 'Reopening a closed search is their decision, and it needs a reason on the file.'
            : 'Closing or cancelling a search is their decision. Prepare the closeout inventory above and ask them.'}</p>
        </div></div>`
      : frozen ? `<div class="spec"><div class="spec__bar">Reopen</div>
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

      ${may('exportRecords') ? `<div class="spec"><div class="spec__bar">Export the record</div>
        <div class="spec__body stack stack--tight">
          <p class="t-small">The permitted record of this search, for county records review: the questions as each
            candidate was asked them, their answers, decisions with their authors, the document inventory, and the
            staff work. Sealed scores are declared as withheld rather than omitted silently. Candidate links,
            credentials and other firms' records are never in it.</p>
          ${!s.released ? `<p class="t-small">Scores are sealed, so this export will say so and leave them out.
            Releasing them first is the manager's decision.</p>` : ''}
          <div class="row">
            ${withTip(`<button type="button" class="btn btn--secondary btn--sm" data-act="export-record" data-format="text">Download the report</button>`,
              'The readable report, for a records request or a county file.')}
            ${withTip(`<button type="button" class="btn btn--secondary btn--sm" data-act="export-record" data-format="json">Download the data bundle</button>`,
              'The same record as structured data, for archiving or transfer.')}
          </div>
        </div></div>` : ''}

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

function searchRolePill(searchRole){
  const k = searchRole === 'manager' ? 'ok' : searchRole === 'consultant' ? 'info' : 'idle';
  return pill(k, SEARCH_ROLE[searchRole]?.label || searchRole);
}

function memberRow(m, mgr){
  const me = m.userId === state.user.id;
  const answered = intakeDoneBy(m.userId);
  const manage = canManage();
  return `<div class="rosterrow${me?' rosterrow--me':''}">
    <span class="rosterrow__init">${esc(m.init)}</span>
    <div class="rosterrow__who">
      <b>${esc(m.name)}${me?' (you)':''}</b>
      <div class="t-small">${esc(m.title||'')}${m.email?' · '+esc(m.email):''}</div>
    </div>
    <div class="rosterrow__tags">${searchRolePill(m.searchRole)}${answered?pill('ok','Answered'):''}</div>
    <div class="rosterrow__acts">
      ${may('handoverManager') && m.searchRole==='consultant' ? `<button class="btn btn--ghost btn--sm" data-act="make-manager" data-uid="${m.userId}">${manage ? 'Hand over the account' : 'Reassign the account'}</button>` : ''}
      ${manage && m.userId !== mgr?.userId ? `<button class="btn btn--ghost btn--sm" data-act="remove-person" data-uid="${m.userId}" data-name="${esc(m.name)}">Remove</button>` : ''}
    </div>
  </div>`;
}

/**
 * A place that is spoken for but not yet taken.
 *
 * Two different pending states, shown as two different things, because they
 * need two different people to act. "Invitation sent" is waiting on the person.
 * "Invitation needed" is waiting on an administrator — and saying so plainly is
 * the difference between a manager who knows to go and ask, and one who waits
 * a week for an email that was never sent.
 */
function heldPlaceRow(p){
  const sent = p.status === 'invitation-sent';
  return `<div class="rosterrow rosterrow--held">
    <span class="rosterrow__init">${esc(initialsOf(p.name || p.email))}</span>
    <div class="rosterrow__who"><b>${esc(p.name || p.email)}</b><div class="t-small">${esc(p.email)}</div></div>
    <div class="rosterrow__tags">${pill('wait', sent ? 'Invitation sent' : 'Invitation needed')}</div>
    <div class="rosterrow__acts">${canManage()
      ? `<button class="btn btn--ghost btn--sm" data-act="release-place" data-pending="${esc(p.id)}" data-email="${esc(p.email)}">Remove</button>`
      : ''}</div>
  </div>`;
}

function initialsOf(name){
  const parts = String(name || '').trim().split(/[\s@.]+/).filter(Boolean);
  if (!parts.length) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* ---------------------------------------------------------------------------
 * Adding people
 *
 * A committee is assembled in one sitting, not one person at a time: the
 * manager has the whole list in front of them. So the form holds as many
 * people as they want to type, and the server is asked once per person,
 * because each address needs its own membership lookup and may need its own
 * invitation. Whatever fails stays on screen with the reason against it, and
 * whatever succeeded is gone, so a retry can never add somebody twice.
 * ------------------------------------------------------------------------- */
function blankPerson(){ return { name:'', email:'', title:'', searchRole:'committee', error:null }; }

function peopleDraft(){
  if (!Array.isArray(state.newPeople) || !state.newPeople.length) state.newPeople = [blankPerson()];
  return state.newPeople;
}

// Read the rows back off the DOM before any re-render, the same way the intake
// and criteria editors do, so nothing typed is lost to a redraw.
function collectPeople(){
  const rows = $$('#newpeople [data-row]');
  if (!rows.length) return;
  state.newPeople = rows.map(row => ({
    name: row.querySelector('[data-f="name"]')?.value || '',
    email: row.querySelector('[data-f="email"]')?.value || '',
    title: row.querySelector('[data-f="title"]')?.value || '',
    searchRole: row.querySelector('[data-f="searchRole"]')?.value || 'committee',
    error: null
  }));
}

// What actually happened to each address. Reporting a mix of memberships and
// invitations as "3 added" would collapse three different outcomes into one,
// and only one of them means the person can see the search today.
function addPeopleSummary(done, failed){
  if (done.length === 1 && !failed.length) {
    const only = done[0];
    // The server distinguishes added, invited, and held; its wording is
    // better than anything reconstructed from flags out here.
    return only.added ? only.name.trim() + ' is on the search.' : (only.note || 'Their place is held.');
  }
  const onSearch = done.filter(x => x.added);
  const invited = done.filter(x => !x.added && x.invitationSent);
  const waiting = done.filter(x => !x.added && !x.invitationSent);
  const parts = [];
  if (onSearch.length) parts.push(onSearch.length + (onSearch.length === 1 ? ' person is' : ' people are') + ' on the search.');
  if (invited.length) parts.push(invited.length === 1 ? 'One invitation was sent.' : invited.length + ' invitations were sent.');
  if (waiting.length) parts.push((waiting.length === 1 ? 'One place is' : waiting.length + ' places are')
    + ' held, waiting on an administrator to invite them.');
  if (failed.length) parts.push((failed.length === 1 ? 'One person was' : failed.length + ' people were')
    + ' not added; the reason is on the row.');
  return parts.join(' ') || 'Nothing was added.';
}

function personDraftRow(p, i, total){
  return `<div class="person-row" data-row="${i}">
    <div class="formgrid">
      ${field('Name','', `<input class="input" data-f="name" value="${esc(p.name||'')}" placeholder="Dana Reyes" autocomplete="off">`)}
      ${field('Email','Their contact email for this search.', `<input class="input" data-f="email" type="email" value="${esc(p.email||'')}" placeholder="dreyes@example.gov" autocomplete="off">`)}
      ${field('Title','', `<input class="input" data-f="title" value="${esc(p.title||'')}" placeholder="Board or committee member">`)}
      ${field('Role on this search','', `<select class="input" data-f="searchRole">
        <option value="committee"${p.searchRole === 'consultant' ? '' : ' selected'}>Committee member</option>
        <option value="consultant"${p.searchRole === 'consultant' ? ' selected' : ''}>Consultant at the firm</option>
      </select>`)}
    </div>
    <div class="person-row__foot">
      ${p.error ? `<span class="person-row__err">${esc(p.error)}</span>` : '<span></span>'}
      ${total > 1 ? `<button type="button" class="btn btn--ghost btn--sm" data-persondel="${i}">Remove</button>` : ''}
    </div>
  </div>`;
}

function vTeam(){
  const s = state.search;
  const list = s.roster || [];
  const held = s.pending || [];
  const mgr = s.accountManager;
  const confirmed = Boolean(s.team?.confirmedAt);
  const manage = canManage();
  const committeeCount = list.filter(m => m.searchRole === 'committee').length;
  const needInvite = held.filter(p => p.status === 'invitation-needed').length;
  const people = peopleDraft();
  const addOpen = Boolean(state.open.addpeople);
  return shell(`
    ${head('Step '+stepNo('team'),'Search committee',
      'Everyone who gets a say in this hire, and the one consultant who runs the account. The roster records who contributes to the hire. Committee input is collected in Step '+stepNo('intake')+', and candidates are scored later.')}
    <div class="band"><div class="wrap stack">
      ${you().consultant && !you().member ? `<div class="notice notice--info"><div>
        <div class="notice__t">You are not on this search</div>
        <div class="notice__b">Join the roster to contribute your own survey answers. The account manager adds people; the account manager or an organization administrator can confirm the roster and open or close committee input.
          <button class="btn btn--secondary btn--sm" data-act="join-search">Join this search</button></div>
      </div></div>` : ''}
      ${mgr ? `<div class="spec"><div class="spec__bar">Account manager</div>
        <div class="spec__body">
          <div class="rosterrow rosterrow--mgr">
            <span class="rosterrow__init">${esc(mgr.init)}</span>
            <div class="rosterrow__who"><b>${esc(mgr.name)}</b><div class="t-small">${esc(mgr.title||'')} · ${esc(mgr.email)}</div></div>
            <div class="rosterrow__tags">${pill('ok','Runs this search')}</div>
            <div class="rosterrow__acts"></div>
          </div>
          <p class="t-small">${esc(SEARCH_ROLE.manager.hint)} The account manager or an organization administrator can hand over the account from the list below.</p>
        </div></div>` : ''}

      <div class="spec"><div class="spec__bar">Search staff and committee ${pill(committeeCount?'ok':'wait', committeeCount+(committeeCount===1?' committee member':' committee members'))}</div>
        <div class="spec__body stack">
          ${list.map(m => memberRow(m, mgr)).join('')}
          ${!committeeCount ? `<div class="t-small">No committee members yet. A search can run with the firm alone, but then Step ${stepNo('intake')} only collects your own answers.</div>` : ''}
          <p class="t-small">Consultants and administrators in ${esc(orgName())} can work across this firm's searches. A committee member is added to this search individually, so being in the workspace does not by itself put anybody on this roster.</p>
        </div></div>

      ${held.length ? `<div class="spec"><div class="spec__bar">Waiting to join ${pill('wait', held.length + (held.length===1?' person':' people'))}</div>
        <div class="spec__body stack">
          ${held.map(heldPlaceRow).join('')}
          ${needInvite ? `<div class="notice notice--wait"><div>
            <div class="notice__t">${needInvite === 1 ? 'One person is waiting on an invitation' : needInvite + ' people are waiting on invitations'}</div>
            <div class="notice__b">No email has been sent. An administrator of ${esc(orgName())} has to invite these addresses to the workspace before they can join.
              ${state.caps?.manageMembers ? '<button class="btn btn--secondary btn--sm" data-go="team-access">Team &amp; access</button>' : ''}</div>
          </div></div>` : ''}
          <p class="t-small">Somebody waiting joins the roster the moment they accept their workspace invitation and sign in. Until then they can read nothing.</p>
        </div></div>` : ''}

      ${manage && s.projectAccess?.state === 'unpaid' ? `<div class="spec"><div class="spec__bar">Add people</div>
        <div class="spec__body stack">
          <p>People can be added to this search once its project payment is complete.</p>
          ${canEdit() ? '<div class="row"><button type="button" class="btn btn--primary" data-go="billing">Review project payment</button></div>' : ''}
        </div></div>` : ''}
      ${manage && s.projectAccess?.state !== 'unpaid' ? `<div class="spec"><div class="spec__bar">Add people</div>
        <div class="spec__body stack">
          <p class="t-small">${esc(SEARCH_ROLE.committee.hint)} The consultant role is for somebody already in ${esc(orgName())}.
            ${state.caps?.inviteMembers
              ? 'Adding an address that is not in this workspace invites them to it as a committee member and holds their place until they accept.'
              : 'If the address is not in this workspace, their place is held and an administrator has to send the invitation.'}</p>
          <div class="row">
            <button type="button" class="btn btn--primary" data-panel="addpeople" aria-expanded="${addOpen}" aria-controls="addpeople"
              data-open-label="Add people" data-close-label="Close this form">${addOpen?'Close this form':'Add people'}</button>
          </div>
          <div id="addpeople" class="addpeople"${addOpen?'':' hidden'}>
            <form id="newpeople" class="stack stack--tight">
              ${people.map((p, i) => personDraftRow(p, i, people.length)).join('')}
              <div class="row">
                <button type="button" class="btn btn--secondary btn--sm" data-personadd="1">Add another person</button>
              </div>
              <div class="row u-mt-3">
                <button class="btn btn--primary" type="submit">${people.length === 1 ? 'Add this person' : 'Add these ' + people.length + ' people'}</button>
              </div>
            </form>
          </div>
        </div></div>` : ''}

      <div class="notice notice--${confirmed?'ok':'info'}"><div>
        <div class="notice__t">${confirmed?'Roster confirmed':'Confirm the roster before opening intake'}</div>
        <div class="notice__b">${confirmed
          ? 'Step '+stepNo('intake')+' can open. Adding anyone new reopens this step, because a person added later would miss the window.'
          : 'Everyone who should get a say needs to be on the roster first. Once you confirm, you can open the intake window.'}</div>
      </div></div>
      ${canManageIntake()
        ? actionBar(
            confirmed
              ? nextBtn('team')
              : withTip(`<button type="button" class="btn btn--primary" data-act="confirm-team">Roster is set</button>`,
                  'Lock the roster so committee input can open. Adding anyone new reopens it.'),
            confirmed
              ? withTip(`<button type="button" class="btn btn--secondary" data-act="confirm-team">Reopen the roster</button>`,
                  'Unlock the roster to add or remove someone.')
              : nextBtn('team').replace('btn--primary','btn--secondary'),
            confirmed ? 'Roster confirmed.' : committeeCount+' committee member'+(committeeCount===1?'':'s')+' so far.')
        : actionBar(nextBtn('team'))}
    </div></div>`);
}

/* ===========================================================================
 * Step 2 — committee intake
 *
 * Two pages behind one route. A committee member answers; the account manager
 * runs the window and reads the room. A consultant who is both sees both.
 * ========================================================================= */

// This member's own response record: their private draft and their last
// submitted answer, which are two different things. Nobody else's draft is
// ever in here, because the server does not send it.
function myResponse(){
  return (state.search?.intake?.responses || {})[state.user.id] || null;
}

function mySubmission(){
  return myResponse()?.submitted || null;
}

/** The version this member's next write is a change to. */
function myResponseRevision(){
  return Number(myResponse()?.revision || 1);
}

function intakeDoneBy(userId){
  // Who has answered is published while the window is open; what they said is
  // not. One field, so the roster tick never depends on reading an answer.
  const answered = state.search?.intake?.answered;
  if (answered && Object.hasOwn(answered, userId)) return Boolean(answered[userId]);
  const agg = state.search?.consensus;
  if (!agg) return false;
  return !agg.pending.some(p => p.userId === userId);
}

// The draft a member is editing lives in state, not the DOM, so adding a line
// or changing a weight does not lose what they already typed elsewhere. It
// starts from their saved draft when they have one, and otherwise from what
// they last submitted, so revising begins with the answer they gave.
function intakeDraft(){
  if (!state.intake) {
    const record = myResponse();
    const start = record?.draft || record?.submitted || null;
    state.intake = {
      items: (start?.items || []).map(i => ({ ...i })),
      mustHave: start?.mustHave || '',
      dealBreaker: start?.dealBreaker || '',
      context: start?.context || ''
    };
    for (const q of state.search?.intake?.qualities || []) {
      if (!state.intake.items.some(i => i.kind === q.kind && i.label === q.label)) {
        state.intake.items.push({ ...q, weight:null, note:'' });
      }
    }
  }
  // A legacy search can gain its standard qualities while this tab is open.
  // Reconcile by identity so locally typed ratings and explanations survive.
  for (const q of state.search?.intake?.qualities || []) {
    if (!state.intake.items.some(i => i.kind === q.kind && i.label === q.label)) {
      state.intake.items.push({ ...q, weight:null, note:'' });
    }
  }
  return state.intake;
}

/** Saved-but-unsubmitted edits sitting on top of a submitted answer. */
function intakeHasUnsubmitted(){
  const record = myResponse();
  return Boolean(record?.submitted && record?.draft);
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
  // Five buttons reading "1" to "5" are indistinguishable to a screen reader
  // once a form holds a dozen of them. Name the priority and the scale, the
  // same way the profile editor already does (CA-11).
  const named = String(item.label||'').trim();
  const repeated = named && intakeDraft().items.filter(row => String(row.label||'').trim() === named).length > 1;
  const what = named ? named + (repeated ? ' ('+(KIND[item.kind]?.plural || item.kind)+' '+(i+1)+')' : '') : (KIND[item.kind]?.label || 'this priority') + ' ' + (i+1);
  const shared = (state.search?.intake?.qualities || []).some(q => q.kind === item.kind && q.label === item.label);
  return `<div class="intake-row" data-row="${i}">
    <div class="stack u-gap-6">
      <input class="input" data-f="label" value="${esc(item.label)}" ${shared?'readonly':''} placeholder="Name it in your own words" aria-label="${esc(named ? 'Priority: '+what : 'Name '+what)}">
      <label class="field"><span>Explain why</span><textarea class="input" data-f="note" rows="2" maxlength="600" placeholder="Why is this quality important for this search?" aria-label="Explain why ${esc(what)} matters (optional)">${esc(item.note||'')}</textarea><span class="field__hint">Optional. Explain the reason for your rating.</span></label>
    </div>
    ${ratingGroup('How much '+what+' matters — 1, nice to have, to 5, decisive',
      `<span class="t-small">Importance</span><div class="wgt">${[1,2,3,4,5].map(n=>`<button type="button" data-iw="${n}" aria-label="Rate ${esc(what)} ${n} of 5" aria-pressed="${Number(item.weight)===n}">${n}</button>`).join('')}</div>`, '1 = Nice to have · 5 = Decisive')}
    ${shared ? `<span class="t-small">${item.weight == null ? 'Choose a rating' : 'Shared quality'}</span>` : `<button class="btn btn--ghost btn--sm" data-idel="${i}" aria-label="Remove ${esc(what)}">Remove</button>`}
  </div>`;
}

function intakeGroup(kind){
  const d = intakeDraft();
  const rows = d.items.map((it,i)=>({it,i})).filter(x => x.it.kind===kind);
  const labels = new Set(rows.map(x => String(x.it.label||'').trim().toLowerCase()).filter(Boolean));
  const ask = INTAKE_ASK[kind];
  const named = rows.filter(x => String(x.it.label||'').trim()).length;
  const rated = rows.filter(x => Number.isInteger(x.it.weight) && x.it.weight >= 1 && x.it.weight <= 5).length;
  const suggKey = 'isugg-'+kind;
  const suggOpen = state.open[suggKey] === undefined ? true : Boolean(state.open[suggKey]);
  return `<section id="intake-sec-${kind}" class="spec profgroup"><div class="spec__bar">${esc(KIND[kind].plural)} · ${state.search.intake?.questionnaireVersion ? rated+' of '+named+' rated' : named+' named'}</div>
    <div class="spec__body stack">
      <p><strong>${esc(ask.t)}</strong></p>
      <p class="t-small">${esc(ask.hint)} Rate every quality from 1 to 5 and explain why it matters. You may suggest a missing quality; its response count will be shown separately in the results.</p>
      ${rows.map(x => intakeRow(x.it, x.i)).join('') || '<p class="t-small">Nothing here yet. Write your own, or open the suggestions.</p>'}
      <div class="row">
        <button type="button" class="btn btn--secondary btn--sm" data-iadd="${kind}">Write my own</button>
        ${!state.search.intake?.questionnaireVersion ? `<button type="button" class="btn btn--ghost btn--sm" data-panel="${suggKey}" aria-expanded="${suggOpen}" aria-controls="ipick-${kind}" data-open-label="Suggestions" data-close-label="Hide suggestions">${suggOpen?'Hide suggestions':'Suggestions'}</button>` : ''}
      </div>
      <div id="ipick-${kind}"${suggOpen && !state.search.intake?.questionnaireVersion?'':' hidden'}>
        <p class="t-small">Select suggested qualities to add to your answer, or write your own.${(state.search?.intake?.qualities || []).length ? ' Shared qualities are already included; rate those above.' : ''}</p>
        <div class="pick">${(SUGGEST[kind]||[]).map(label => {
          const on = labels.has(label.toLowerCase());
          const shared = (state.search?.intake?.qualities || []).some(q => q.kind === kind && q.label.toLowerCase() === label.toLowerCase());
          return `<button type="button" data-ipick="${kind}" data-label="${esc(label)}" aria-pressed="${on}" ${shared?'disabled':''}>${esc(label)}</button>`;
        }).join('')}</div>
      </div>
    </div></section>`;
}

/**
 * What happened when a save collided with the same member's other tab.
 *
 * Both versions stay on screen and the local rows are never cleared, so
 * recovering is a choice between two readable answers rather than copying text
 * out of a form before reloading (CA-12).
 */
function intakeConflictPanel(){
  const c = state.intakeConflict;
  if (!c) return '';
  const theirs = c.submitted || c.draft;
  const describe = answer => !answer ? 'nothing on file' :
    (answer.items || []).filter(i => String(i.label||'').trim()).map(i => esc(i.label)+' ('+i.weight+')').join(', ') || 'no priorities named';
  return `<div class="notice notice--stop"><div>
    <div class="notice__t">Your answers were changed somewhere else</div>
    <div class="notice__b">Nothing you have typed here was lost, and nothing here was overwritten. Another tab or device saved
      ${c.submitted ? 'a submitted answer' : 'a draft'} for you${theirs?.updatedAt ? ' on '+esc(String(theirs.updatedAt).slice(0,10)) : ''}.
      <div class="t-small u-mt-3"><b>Saved elsewhere:</b> ${describe(theirs)}</div>
      <div class="t-small"><b>On this page:</b> ${describe({ items: intakeDraft().items })}</div>
      <div class="row u-mt-3">
        <button type="button" class="btn btn--secondary btn--sm" data-act="intake-keep-mine">Keep what is on this page</button>
        <button type="button" class="btn btn--ghost btn--sm" data-act="intake-take-theirs">Use the version saved elsewhere</button>
      </div></div>
  </div></div>`;
}

function vIntakeAnswer(){
  const s = state.search;
  const intake = s.intake || {};
  const record = myResponse();
  const mine = mySubmission();
  const d = intakeDraft();
  const open = intake.status === 'open';
  const closed = intake.status === 'closed';
  const count = d.items.filter(i => String(i.label||'').trim() && Number.isInteger(i.weight) && i.weight >= 1 && i.weight <= 5).length;
  return shell(`
    ${head('Step '+stepNo('intake'), 'Committee questionnaire',
      'Describe the candidate you want to hire: essential skills, leadership traits, current challenges, and future opportunities. '
      + 'Rate how much each priority matters to you. The account manager uses the committee’s submitted answers to build and adopt the candidate profile in Step '+stepNo('profile')+'.',
      you().consultant ? '<button type="button" class="btn btn--secondary" data-go="intake">Manage committee input</button>' : '')}
    <div class="band"><div class="wrap stack">
      ${!open ? `<div class="notice notice--info" role="status"><div><div class="notice__t">${closed?'Questionnaire closed':'Preview only — answers are not open'}</div>
        <div class="notice__b">${closed?'Ask the account manager to reopen collection if you need to revise your answer.':'The controls below show the questions. You can answer when the account manager opens collection.'}</div>
        <button type="button" class="btn btn--secondary btn--sm" data-act="check-intake">Check again</button></div></div>` : ''}
      <p class="t-small">Answer for yourself. Saved drafts are private to you. Submitted answers are visible to the search team; the rest of the committee can read them after the account manager closes the response window.</p>
      ${(s.criteria||[]).length && canOpenStep('profile') ? `<div class="notice notice--ok" role="status"><div>
        <div class="notice__t">A candidate profile has been adopted</div>
        <div class="notice__b">It is what candidates are scored against. <button type="button" class="btn btn--secondary btn--sm" data-go="profile">Open the adopted candidate profile</button></div>
      </div></div>` : ''}
      ${(intake.qualities || []).length ? `<div class="notice notice--info"><div>
        <div class="notice__t">Rank the shared candidate qualities</div>
        <div class="notice__b">Every rostered member rates the same qualities independently. Choose 1 (nice to have) through 5 (decisive) for each; equal ratings are allowed. Submitted ratings are aggregated for the account manager to review and adopt before recruiting.</div>
      </div></div>` : ''}
      ${intakeConflictPanel()}
      ${!open ? `<div class="notice notice--${closed?'ok':'info'}"><div>
        <div class="notice__t">${closed ? 'Intake is closed' : 'Intake has not opened yet'}</div>
        <div class="notice__b">${closed
          ? 'The window is shut and the committee’s answers have been read together. Ask '+esc(s.accountManager?.name||'the account manager')+' if you still need to add something.'
          : esc(s.accountManager?.name||'The account manager')+' must open the questionnaire before you can answer. Your ratings and explanations belong here in Step '+stepNo('intake')+'. Step '+stepNo('profile')+' is the account manager’s review of the committee’s answers.'}</div>
      </div></div>` : ''}
      ${mine ? `<div class="notice notice--${intakeHasUnsubmitted()?'wait':'ok'}"><div>
        <div class="notice__t">${intakeHasUnsubmitted() ? 'Submitted — you have unpublished changes' : 'Your answers are in'}</div>
        <div class="notice__b">Submitted ${esc((mine.submittedAt||mine.updatedAt||mine.at||'').slice(0,10))} and counted in the tally.
          ${intakeHasUnsubmitted() ? 'Your saved edits are private until you choose <b>Update my answers</b>; until then the tally still shows what you submitted.' : ''}
          ${open?'You can change them while the window is open.':''}</div>
      </div></div>` : ''}
      ${!mine && record?.draft ? `<div class="notice notice--info"><div>
        <div class="notice__t">Saved, not submitted</div>
        <div class="notice__b">Only you can read this. It is not in the tally and the search team cannot see it until you submit.</div>
      </div></div>` : ''}
      ${record?.withdrawnAt ? `<div class="notice notice--wait"><div>
        <div class="notice__t">You withdrew your answers</div>
        <div class="notice__b">They are out of the tally and back in your own draft. Anything already built from them stays on file and is marked as resting on earlier answers. Submit again to count.</div>
      </div></div>` : ''}
      ${intake.dueBy ? `<div class="t-small"><b>Due:</b> ${esc(intake.dueBy)}</div>` : ''}
      ${intake.prompt ? `<div class="spec"><div class="spec__bar">From the account manager</div><div class="spec__body"><p>${esc(intake.prompt)}</p></div></div>` : ''}
      ${open ? `
        <nav class="secnav" aria-label="Questionnaire sections">
          <span class="secnav__t">Sections</span>
          ${Object.keys(INTAKE_ASK).map(k => {
            const items = d.items.filter(i => i.kind===k && String(i.label||'').trim());
            const rated = items.filter(i => Number.isInteger(i.weight) && i.weight >= 1 && i.weight <= 5).length;
            return `<button type="button" class="${items.length && rated===items.length?'is-done':''}" data-act="jump" data-to="intake-sec-${k}">${esc(KIND[k].plural)} <span class="mono">${rated}/${items.length}</span></button>`;
          }).join('')}
          <button type="button" data-act="jump" data-to="intake-sec-words">In your own words</button>
        </nav>
        ${Object.keys(INTAKE_ASK).map(intakeGroup).join('')}
        <section id="intake-sec-words" class="spec profgroup"><div class="spec__bar">In your own words</div><div class="spec__body stack">
          ${field('What would make you say yes to a candidate?','', `<textarea class="input ed" id="intake-mustHave" rows="3">${esc(d.mustHave)}</textarea>`)}
          ${field('What would make you say no?','', `<textarea class="input ed" id="intake-dealBreaker" rows="3">${esc(d.dealBreaker)}</textarea>`)}
          ${field('Anything else the search team should know','', `<textarea class="input ed" id="intake-context" rows="3">${esc(d.context)}</textarea>`)}
        </div></section>
        ${beforeYouAct('<b>Save and finish later</b> keeps a private draft: '
          + (mine ? 'the answers you already submitted stay exactly as they are.' : 'nobody can read it.')
          + ' ' + esc(TIPS.submitIntake))}
        ${actionBar(
          `<button type="button" class="btn btn--primary" data-act="submit-intake">${mine?'Update my answers':'Submit my answers'}</button>`,
          withTip(`<button type="button" class="btn btn--secondary" data-act="save-intake">Save and finish later</button>`,
            mine
              ? 'Keep these edits privately. Your submitted answers stay in the tally until you choose Update my answers.'
              : 'Keep what you have written without submitting it. Nobody reads it until you submit.')
          + (mine ? withTip(`<button type="button" class="btn btn--ghost" data-act="withdraw-intake">Withdraw my answers</button>`,
            'Take your submitted answers out of the tally. They come back to you as a private draft.') : ''),
          count+' qualities rated so far.',
          mine ? (intakeHasUnsubmitted() ? 'Saved edits not submitted' : 'Submitted') : 'Not submitted yet')}` : ''}
      ${!open && !closed && (intake.qualities || []).length ? `<section class="stack">
        <h2>Preview your questionnaire</h2><p class="t-small">These controls become available when the account manager opens the questionnaire. Then choose 1–5 and explain why for each quality.</p>
        <fieldset class="questionnaire-preview" disabled><legend class="sr-only">Questionnaire preview — not open for answers</legend>${Object.keys(INTAKE_ASK).map(intakeGroup).join('')}</fieldset>
      </section>` : ''}
      ${closed && mine ? `<section class="spec"><div class="spec__bar">Your submitted answers</div><div class="spec__body stack">
        ${(mine.items || []).map(item => `<div><b>${esc(item.label)}</b> <span class="t-small">Importance: ${esc(item.weight)} of 5</span>${item.note ? `<p class="t-small">${esc(item.note)}</p>` : ''}</div>`).join('')}
      </div></section>` : ''}
      ${!open ? `<p class="t-small">The account manager reviews the combined ratings, explanations, and community needs in Step ${stepNo('profile')}. You do not need to complete another questionnaire there.</p>` : ''}
      ${!open && you().consultant ? stepFooter('intake') : ''}
    </div></div>`);
}

function favoritesFor(agg){
  const signature = state.search.id + JSON.stringify(Object.values(agg.byKind).flat().map(e => [e.key,e.avgWeight,e.mentions]));
  if (state.profileFavorites?.signature !== signature) {
    state.profileFavorites = {signature, keys:Object.values(agg.byKind).flatMap(rows => rows.slice(0,5).map(e => e.key))};
  }
  return state.profileFavorites.keys;
}

function consensusMeter(entry, submitted, selection=null, recommended=false){
  const pct = Math.round(state.search.intake?.questionnaireVersion ? entry.avgWeight / 5 * 100 : (entry.share || 0) * 100);
  const tone = entry.consensus==='unanimous' ? 'ok' : entry.consensus==='strong' ? 'ok' : entry.consensus==='split' ? 'wait' : 'idle';
  return `<div class="cons">
    <div class="cons__hd">
      <b>${esc(entry.label)}</b>${recommended ? '<span class="chip">Top 5 recommendation</span>' : ''}
      <span class="cons__tags">
        ${pill(tone, entry.mentions+' of '+submitted)}
        ${entry.contested ? pill('stop','Contested') : ''}
        <span class="t-small mono">avg ${entry.avgWeight.toFixed(1)}</span>
      </span>
    </div>
    <div class="cons__bar"><span data-width-pct="${pct}"></span></div>
    <div class="cons__who t-small">${entry.voters.map(v => esc(v.name||'A member')+' '+v.weight).join(' · ')}</div>
    ${state.search.intake?.questionnaireVersion ? `<p class="t-small">Score: ${entry.avgWeight.toFixed(2)} / 5. Rated 4 or 5 by ${entry.highRatings} of ${submitted} respondents.${(state.search.intake.qualities || []).some(q => q.kind === entry.kind && q.label === entry.label) ? '' : ' Additional suggestion; not every member was asked to rate it.'}</p>` : ''}
    ${selection ? `<label class="row t-small"><input type="checkbox" data-act="profile-favorite" data-key="${esc(entry.key)}" ${selection.includes(entry.key)?'checked':''}> Select ${esc(entry.label)} for the profile</label>` : ''}
    ${entry.contested ? `<div class="t-small cons__flag">Rated as low as ${entry.minWeight} and as high as ${entry.maxWeight}. Worth naming out loud before the profile is adopted.</div>` : ''}
    ${entry.notes.length ? `<div class="cons__notes">${entry.notes.map(n => `<div class="t-small">${esc(n.name||'A member')}: ${esc(n.note)}</div>`).join('')}</div>` : ''}
  </div>`;
}

function consensusPanels(agg, showEmpty=true, choose=false){
  if (!agg.submitted) {
    return showEmpty ? `<div class="empty"><div class="empty__t">Nothing submitted yet</div>Consensus appears as members answer.</div>` : '';
  }
  const kinds = [['skill','Essential skills'],['trait','Leadership and personality traits'],['chall','Current challenges'],['opp','Future opportunities']];
  // Participation and support, said once and together. Every count below is
  // out of the people who answered, and somebody not naming an item is not a
  // vote against it.
  const turnout = `<p class="t-small">${agg.submitted} of ${agg.asked} people asked submitted answers.
    ${state.search.intake?.questionnaireVersion ? 'Score = sum of the submitted ratings divided by the number of people who rated that quality. Results are ranked by average importance, then response count. Exact ties are shown alphabetically, not as stronger consensus. Additional suggestions may have fewer ratings.' : (state.search?.intake?.qualities || []).length ? 'Every submitted answer rates each shared quality. Results are ordered by response count, then average importance.' : ''}
    Each count below is out of those ${agg.submitted}. Somebody who did not name an item was not voting against it.
    Matching is by wording, so “Budgeting” and “Financial management” stay separate entries.
    The must-have, deal-breaker and context answers are guidance for the search team, not rules the profile enforces.</p>`;
  return turnout + kinds.map(([k,label]) => {
    const list = agg.byKind[k] || [];
    return `<div class="spec"><div class="spec__bar">${esc(label)} ${pill(list.length>=3?'ok':'wait', list.length+' named')}</div>
      <div class="spec__body stack">
        ${choose ? `<p class="t-small" role="status"><span data-favorite-count="${k}">${favoritesFor(agg).filter(key => list.some(e => e.key === key)).length}</span> of 3–5 favorites selected for this category. These choices are a preview and are recorded only when you adopt the profile. The five highest-scoring qualities are initially selected. Review ties and explanations before deciding.</p>` : ''}
        ${list.map((e,i) => consensusMeter(e, agg.submitted, choose ? favoritesFor(agg) : null, choose && i < 5)).join('') || '<div class="t-small">Nobody named anything here. You will have to write these yourself.</div>'}
      </div></div>`;
  }).join('') + (agg.voices.length ? `<div class="spec"><div class="spec__bar">In their own words</div>
    <div class="spec__body stack">${agg.voices.map(v => `<div class="voice">
      <div class="t-label">${esc(v.name||'A member')}</div>
      ${v.mustHave ? `<div class="t-small"><b>Yes to:</b> ${esc(v.mustHave)}</div>` : ''}
      ${v.dealBreaker ? `<div class="t-small"><b>No to:</b> ${esc(v.dealBreaker)}</div>` : ''}
      ${v.context ? `<div class="t-small"><b>Also:</b> ${esc(v.context)}</div>` : ''}
    </div>`).join('')}</div></div>` : '');
}

/**
 * The proposed profile, before it is saved.
 *
 * Rebuilding used to quietly carry an old committee item forward with its old
 * "named by 2 of 2" still attached, and to drop hand-written criteria past the
 * cap without saying so. Every one of those is a line on this panel, and
 * keeping an unsupported item is a decision with a reason on it (CA-03).
 */
function adoptPlanPanel(){
  const plan = state.adoptPlan;
  if (!plan) return '';
  const c = plan.changes || {};
  const retained = new Set(plan.retain || []);
  const line = (row, extra='') => `<li><b>${esc(row.label)}</b> <span class="mono t-small">${esc(row.id||'')}</span>
    <span class="t-small">${esc(KIND[row.kind]?.label || row.kind)}</span>${extra}</li>`;
  const group = (title, rows, render) => rows.length
    ? `<div class="spec"><div class="spec__bar">${esc(title)} ${pill('idle', String(rows.length))}</div>
        <div class="spec__body"><ul class="stack stack--tight">${rows.map(render).join('')}</ul></div></div>` : '';
  return `<div class="spec" id="adoptplan"><div class="spec__bar">Review the proposed profile</div>
    <div class="spec__body stack">
      <p class="t-small">Built from ${plan.respondents} of ${plan.participants} who were asked. Nothing is saved until you confirm.</p>
      ${group('Arriving from the committee', c.added || [], r => line(r,
        ` <span class="t-small">named by ${r.mentions} of ${plan.respondents}${r.contested?', contested':''}</span>`))}
      ${group('Already on the profile, support refreshed', c.changed || [], r => line(r,
        ` <span class="t-small">now named by ${r.mentions} of ${plan.respondents}${r.was && r.was.label !== r.label ? '; you renamed it from “'+esc(r.was.label)+'”' : ''}</span>`))}
      ${group('Proposed for removal', c.removed || [], r => `<li>
        <b>${esc(r.label)}</b> <span class="mono t-small">${esc(r.id)}</span>
        <div class="t-small">${esc(r.why)}</div>
        ${r.why === 'Not selected during profile review.' ? '<p class="t-small">Select this quality in the results above to include it again.</p>' : `<label class="t-small"><input type="checkbox" data-retain="${esc(r.id)}" ${retained.has(r.id)?'checked':''}>
          Keep it anyway, as my decision</label>`}
        ${retained.has(r.id) ? `<input class="input" data-retain-reason="${esc(r.id)}" placeholder="Why keep it? Recorded with the profile." value="${esc((plan.retainReasons||{})[r.id]||'')}">` : ''}
      </li>`)}
      ${group('Your own criteria, kept', c.kept || [], r => line(r))}
      ${group('Kept by your decision — support describes earlier answers', c.retained || [], r => line(r,
        ` <span class="t-small">${esc(r.why)}</span>`))}
      ${group('Not included in this profile', c.excluded || [], r => `<li>
        <b>${esc(r.label)}</b> <span class="t-small">${esc(KIND[r.kind]?.label || r.kind)} — ${esc(r.why)}</span></li>`)}
      ${(plan.discussion || []).length ? `<div class="spec"><div class="spec__bar">For discussion, not on the profile ${pill('stop', String(plan.discussion.length))}</div>
        <div class="spec__body stack">${plan.discussion.map(d => `<div class="t-small">
          <b>${esc(d.label)}</b> — named by ${d.mentions} of ${d.respondents}, rated ${d.minWeight} to ${d.maxWeight}${d.contested?', contested':''}.
          ${(d.reasons||[]).slice(0,3).map(r => esc((r.name||'A member')+': '+r.note)).join(' · ')}
        </div>`).join('')}</div></div>` : ''}
      ${(plan.gaps || []).length
        ? `<p class="t-small"><b>The finished profile would still be short in:</b> ${plan.gaps.map(g=>esc(g.label.toLowerCase())).join(', ')}.</p>`
        : `<p class="t-small">Every category would have 3 to 5 criteria.</p>`}
      ${(plan.coverage || []).length
        ? `<p class="t-small">The committee named fewer than three items in ${plan.coverage.map(g=>esc(g.label.toLowerCase())).join(', ')}. That is what they nominated, which is a different thing from what the profile still needs.</p>` : ''}
      <div class="row">
        <button type="button" class="btn btn--primary" data-act="adopt-apply">Save this profile</button>
        <button type="button" class="btn btn--ghost" data-act="adopt-cancel">Cancel</button>
      </div>
    </div></div>`;
}

function sharedQualitiesPanel(){
  const intake = state.search.intake || {};
  const groups = Object.entries(INTAKE_ASK).map(([kind, ask]) => {
    const qualities = (intake.qualities || []).filter(q => q.kind === kind);
    return `<section class="spec"><div class="spec__bar">${esc(KIND[kind].plural)} · ${qualities.length}</div>
      <div class="spec__body stack stack--tight">
        <h3>${esc(ask.t)}</h3>
        <p class="t-small">${esc(ask.hint)}</p>
        <ul>${qualities.map(q => `<li>${esc(q.label)}</li>`).join('')}</ul>
        <p class="t-small">For each quality, the member rates importance from 1 (nice to have) to 5 (decisive) and may explain why.</p>
      </div></section>`;
  }).join('');
  return `<section class="stack" id="committee-questionnaire-preview" aria-label="Committee questionnaire preview">
    <div class="spec"><div class="spec__bar">Committee questionnaire · Read-only preview</div>
      <div class="spec__body stack stack--tight">
        <p>These are the questions and shared qualities committee members see. This preview does not submit an answer.</p>
        <p class="t-small">${intake.questionnaireVersion
          ? 'Standard questionnaire: '+(intake.qualities || []).length+' shared qualities. Only submitted ratings count in the results.'
          : 'This search began an earlier questionnaire. Its questions and answers are preserved so existing responses remain comparable.'}</p>
      </div></div>
    ${groups}
    <section class="spec"><div class="spec__bar">In your own words</div><div class="spec__body stack stack--tight">
      <p>What would make you say yes to a candidate?</p>
      <p>What would make you say no?</p>
      <p>Anything else the search team should know</p>
    </div></section>
  </section>`;
}

function questionnaireChoice(){
  if (!isAdmin()) return '';
  const skipped = Boolean(state.search.intake?.skipped);
  const submitted = state.search.consensus?.submitted || 0;
  const confirmed = Boolean(state.search.team?.confirmedAt);
  return `<section class="spec"><div class="spec__bar">Committee questionnaire · Optional</div>
    <div class="spec__body stack stack--tight"><p>As organization administrator, choose whether this search collects committee priorities. You can proceed directly to writing the candidate profile when the questionnaire is not needed.</p>
      <div class="row">${skipped
        ? '<button type="button" class="btn btn--secondary" data-act="include-questionnaire">Include committee questionnaire</button>'
        : `<span class="t-small">Included in this search.</span><button type="button" class="btn btn--secondary" data-act="skip-questionnaire" ${!confirmed || submitted?'disabled':''}>Skip questionnaire and continue</button>`}</div>
      ${!skipped && !confirmed ? '<p class="t-small">Confirm the roster in Step 1 first. The account manager or an organization administrator can confirm it.</p>' : ''}
      ${!skipped && submitted ? '<p class="t-small">Answers have already been submitted. Review them and close the response window to continue.</p>' : ''}
    </div></section>`;
}

function vIntakeSkipped(){
  const decision = state.search.intake.skipped;
  return shell(`${head('Step '+stepNo('intake'), 'Candidate profile input', 'The committee questionnaire is optional for this search.')}
    <div class="band"><div class="wrap stack">
      <div class="notice notice--info"><div><div class="notice__t">Committee questionnaire skipped</div>
        <div class="notice__b">${esc(decision.byName || 'The organization administrator')} chose to skip it on ${esc(String(decision.at || '').slice(0,10))}.
          No questionnaire response is required. Any saved drafts remain private. The search team can write the candidate profile and continue to recruiting.</div></div></div>
      ${questionnaireChoice()}
      <div class="row">${openBtn('profile', canEdit() ? 'Continue to candidate profile' : 'View candidate profile', true)}</div>
    </div></div>`);
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
  const windowAction = canManageIntake()
    ? (!confirmed
      ? '<button type="button" class="btn btn--primary btn--sm" data-go="team">Confirm the roster</button>'
      : open
        ? '<button type="button" class="btn btn--secondary btn--sm" data-act="intake-close">Close intake and review answers</button>'
        : `<button type="button" class="btn btn--primary btn--sm" data-act="intake-open">${closed?'Reopen':'Open'} intake for committee input</button>`)
    : '<button type="button" class="btn btn--secondary btn--sm" data-go="team">View the account manager and roster</button>';
  return shell(`
    ${head('Step '+stepNo('intake'), 'Committee questionnaire',
      'Collect what each committee member wants in the candidate profile: essential skills, leadership traits, current challenges, and future opportunities. In Step '+stepNo('profile')+', review these priorities together and adopt the profile used to evaluate candidates.',
      `${open ? (you().member
        ? `<button class="btn btn--primary" data-go="intake-mine">${mine ? 'Review my survey' : 'Fill out my survey'}</button>`
        : '<button type="button" class="btn btn--primary" data-act="join-search" data-answer="true">Join and fill out my survey</button>') : ''}
       ${nextBtn('intake')}`)}
    <div class="band"><div class="wrap stack">
      <div class="notice notice--${open?'ok':closed?'wait':'info'}" role="status"><div>
        <div class="notice__t">Committee intake is ${open?'open':closed?'closed':'not open yet'}</div>
        <div class="notice__b">${canManageIntake()
          ? (!confirmed
            ? 'Confirm the search roster before '+(closed?'reopening':'opening')+' intake so everyone who should answer is included.'
            : open
              ? 'Committee members on the roster can answer now. Close intake when their responses are ready for review.'
              : closed
                ? 'Committee members cannot add or revise answers while intake is closed. Reopen it to collect more input.'
                : 'The roster is confirmed. Open intake so committee members can answer.')
          : esc(askManager()+' Only the account manager or an organization administrator can '+(open?'close':closed?'reopen':'open')+' intake.')}</div>
        ${windowAction}
        <button type="button" class="btn btn--secondary btn--sm" data-act="jump" data-to="committee-questionnaire-preview">View questionnaire questions</button>
      </div></div>
      ${!you().member ? `<div class="notice notice--info"><div><div class="notice__t">You are not on this search roster</div><div class="notice__b">You can inspect the questions here. Join the search before answering your own questionnaire.</div>
        <button type="button" class="btn btn--secondary btn--sm" data-act="join-search">Join this search</button></div></div>` : ''}
      <button type="button" class="btn btn--secondary btn--sm" data-act="check-intake">Check again</button>
      ${questionnaireChoice()}
      ${you().member ? `<section class="spec"><div class="spec__bar">Your input for the candidate profile</div>
        <div class="spec__body stack stack--tight"><p>Use your form to name the priorities you want included and rate how much each matters. Your submitted answers contribute alongside the committee’s.</p>
          ${open ? `<div class="row"><button class="btn btn--primary" data-go="intake-mine">${mine ? 'Review my profile input' : 'Add my profile input'}</button></div>`
            : `<p class="t-small">${closed ? 'Reopen intake to revise your answer. Submitted input appears in the candidate profile review.' : 'Your input form becomes available when the response window opens.'}</p>${closed && mine ? '<button type="button" class="btn btn--secondary" data-go="intake-mine">View my submitted survey</button>' : ''}`}
        </div></section>` : ''}
      <div class="tiles">
        <div class="tile"><span class="tile__k">On the search</span><span class="tile__v">${agg?agg.asked:(s.roster||[]).length}</span></div>
        <div class="tile"><span class="tile__k">Answered</span><span class="tile__v">${agg?agg.submitted:0}</span></div>
        <div class="tile"><span class="tile__k">Waiting on</span><span class="tile__v">${waiting.length}</span></div>
        <div class="tile tile--hi"><span class="tile__k">Window</span><span class="tile__v u-fs-135">${open?'Open':closed?'Closed':'Not open'}</span><span class="tile__n">${esc(intake.dueBy||'no due date')}</span></div>
      </div>

      ${canManageIntake() ? `<div class="spec"><div class="spec__bar">Committee input settings</div>
        <div class="spec__body"><form id="intakewindow" class="formgrid">
          ${field('Due date','Shown to every member.', `<input class="input" name="dueBy" value="${esc(intake.dueBy||'')}" placeholder="Respond by 12 Sep 2026">`)}
          ${field('Note to the committee','Optional. Appears above their form.', `<input class="input" name="prompt" value="${esc(intake.prompt||'')}" placeholder="Answer for yourself, not for the group.">`)}
        </form>
        <div class="row u-mt-3"><button class="btn btn--secondary btn--sm" data-act="intake-save-window">Save window settings</button></div>
      </div></div>` : ''}

      ${waiting.length ? `<div class="spec"><div class="spec__bar">Still waiting on</div>
        <div class="spec__body"><div class="waiting">${waiting.map(p => `<span class="chip">${esc(p.name||'A member')}</span>`).join('')}</div>
        <p class="t-small">You can close the window without them. They can still score candidates later.</p>
        </div></div>` : ''}

      ${sharedQualitiesPanel()}

      ${intake.rosterChangedAt && open ? `<div class="notice notice--stop"><div>
        <div class="notice__t">The roster changed while the window is open</div>
        <div class="notice__b">Everyone on the roster, including anyone just added, can keep answering. Confirm the roster again in Step ${stepNo('team')} before you close the window or publish the profile — who was asked is part of what “${agg?agg.submitted:0} of ${agg?agg.asked:0} answered” means.
          <button class="btn btn--ghost btn--sm" data-go="team">Open the roster</button></div>
      </div></div>` : ''}

      ${!closed ? `<div class="notice notice--info"><div>
        <div class="notice__t">Who can read what, while the window is open</div>
        <div class="notice__b">A member's saved draft is theirs alone — nobody else reads it, including you and including after the window closes.
          A <b>submitted</b> answer can be read by the search team in this workspace, because you facilitate; the rest of the committee
          reads submitted answers only once you close the window, so nobody times their own answer against the count.
          Matching is by wording, so “Budgeting” and “Financial management” stay separate entries.</div>
      </div></div>` : `<div class="notice notice--ok"><div>
        <div class="notice__t">The window is closed</div>
        <div class="notice__b">Submitted answers are now readable by everyone on the search. Drafts nobody submitted are still private to their author.
          Reopening collects new input under the same rules — it does not take back anything already shared.</div>
      </div></div>`}

      ${intake.completedEmpty ? `<div class="notice notice--wait"><div>
        <div class="notice__t">Completed without committee input</div>
        <div class="notice__b">${esc(intake.completedEmpty.byName||'The account manager')} recorded this on ${esc(String(intake.completedEmpty.at||'').slice(0,10))}: “${esc(intake.completedEmpty.reason)}”. No responses were collected.</div>
      </div></div>` : ''}

      <section class="spec"><div class="spec__bar">Next: account manager review</div>
        <div class="spec__body stack"><p>Step ${stepNo('profile')} brings together the committee’s ratings, explanations, and community needs. Review and adopt the candidate profile there.</p>
          <div class="row"><button type="button" class="btn btn--primary" data-go="profile">Review committee input</button></div>
        </div>
      </section>
      ${stepFooter('intake')}
    </div></div>`);
}

function vIntake(){
  if (state.search.intake?.skipped) return vIntakeSkipped();
  // A committee member only ever has the answer page. A consultant gets the
  // facilitator view, and reaches their own form from the prompt on it.
  if (state.view === 'intake-mine' && you().member) return vIntakeAnswer();
  if (!you().consultant) return vIntakeAnswer();
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

// Where a profile line came from, read off the line's own source record rather
// than by looking its label up in today's tally. Editing the wording is not a
// change of origin, and a hand-written criterion cannot acquire somebody
// else's support by happening to match their words (CA-08).
function critOrigin(c){
  return c && c.source && c.source.key ? c.source : null;
}

/** The evidence this line was adopted on, as it stood at adoption. */
function adoptedEvidence(c){
  const origin = critOrigin(c);
  if (!origin) return null;
  return (state.search?.adoption?.groups || []).find(g => g.key === origin.key) || null;
}

/** What the committee says about this line now, if they still say anything. */
function currentSupport(c){
  const origin = critOrigin(c);
  const agg = state.search?.consensus;
  if (!origin || !agg) return null;
  return (agg.byKind[c.kind] || []).find(e => e.key === origin.key) || null;
}

function critSource(c){
  const origin = critOrigin(c);
  const now = currentSupport(c);
  const then = adoptedEvidence(c);
  if (origin && now) {
    return `<span class="crit-src">${pill(now.contested?'stop':'ok', now.mentions+' of '+state.search.consensus.submitted)}${now.contested?pill('stop','Contested'):''}</span>`;
  }
  if (origin && origin.support === 'historical') {
    // Kept deliberately, and dated. The count it carries describes the answers
    // that were on file then, not the ones on file now.
    return `<span class="crit-src">${pill('wait', then ? then.mentions+' of '+then.respondents+' on '+String(origin.retainedAt||origin.at||'').slice(0,10) : 'Earlier answers')}</span>`;
  }
  if (origin && then) {
    return `<span class="crit-src">${pill('wait', then.mentions+' of '+then.respondents+' on '+String(then.at||origin.at||'').slice(0,10))}</span>`;
  }
  if (c.from === 'committee') return `<span class="crit-src">${pill('wait','From the committee')}</span>`;
  if (c.from === 'draft') return `<span class="crit-src">${pill('info','Drafted')}</span>`;
  return `<span class="crit-src">${pill('idle','Yours')}</span>`;
}

/** The disagreement behind an adopted line, if the committee had any. */
function critEvidence(c){
  const then = adoptedEvidence(c);
  if (!then) return '';
  const reasons = (then.reasons || []).slice(0, 4);
  if (!then.contested && !reasons.length) return '';
  return `<div class="t-small crit-evid">
    ${then.contested ? `<b>The committee disagreed.</b> Rated as low as ${then.minWeight} and as high as ${then.maxWeight} by the ${then.mentions} of ${then.respondents} who named it. Both readings are below; neither was merged into the other.` : ''}
    ${reasons.length ? `<div>${reasons.map(r => esc((r.name||'A member')+' ('+r.weight+'): '+r.note)).join('<br>')}</div>` : ''}
  </div>`;
}

function critRow(c, i){
  const name = String(c.label||'').trim() || (KIND[c.kind]?.label || 'This criterion');
  return `<div class="crit-row" data-row="${i}">
    <span class="mono t-small">${esc(c.id||'')}${critSource(c)}</span>
    <div class="stack u-gap-6">
      <input class="input" data-f="label" value="${esc(c.label)}" placeholder="Label" aria-label="Criterion ${esc(c.id||i+1)} label">
      <label class="field"><span>Explain why</span><textarea class="input" data-f="note" rows="2" maxlength="600" placeholder="Why is this quality important for this search?" aria-label="Explain why ${esc(name)} matters">${esc(c.note||'')}</textarea></label>
    </div>
    ${ratingGroup('Weight for '+name+' — 1, nice to have, to 5, decisive',
      `<span class="t-small">Importance</span><div class="wgt">${[1,2,3,4,5].map(n=>`<button type="button" data-w="${n}" aria-label="Weight ${n} of 5 for ${esc(name)}" aria-pressed="${Number(c.weight)===n}">${n}</button>`).join('')}</div>`, '1 = Nice to have · 5 = Decisive')}
    <button type="button" class="btn btn--ghost btn--sm" data-del="${i}" aria-label="Remove ${esc(name)}">Remove</button>
    ${critEvidence(c)}
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

function committeeReviewPanel(){
  const s = state.search;
  const agg = s.consensus;
  if (s.intake?.skipped) return '';
  const closed = s.intake?.status === 'closed';
  return `<section id="committee-review" class="stack">
    <h2>Evaluate the committee’s answers</h2>
    <p>Review the candidate qualities alongside the community’s challenges and opportunities. Compare the 1–5 ratings, read each explanation, and consider areas of agreement and disagreement before adopting the profile.</p>
    ${!closed ? `<div class="notice notice--info"><div><div class="notice__t">${s.intake?.status === 'open' ? 'Responses are still being collected' : 'The questionnaire has not opened'}</div>
      <div class="notice__b">These results are preliminary. Finish collecting answers in Step ${stepNo('intake')} before adopting the profile. <button type="button" class="btn btn--secondary btn--sm" data-go="intake">Manage questionnaire</button></div></div></div>` : ''}
    ${agg ? consensusPanels(agg, true, closed && canManage() && Boolean(s.intake?.questionnaireVersion)) : '<p>No submitted answers are available yet.</p>'}
    ${agg?.submitted && canManage() ? `<div class="row"><button type="button" class="btn btn--primary" data-act="adopt-preview" ${closed?'':'disabled'}>Review what this would change</button></div>` : ''}
    ${adoptPlanPanel()}
  </section>`;
}

function vProfile(){
  const s = state.search;
  const agg = s.consensus;
  const adopted = (s.criteria||[]).some(c => c.from === 'committee');

  // A committee member reads the adopted profile; they do not edit it. Showing
  // them live inputs the server would reject is worse than showing the result.
  if (!canEdit()) {
    return shell(`
      ${head('Step '+stepNo('profile'),'Adopted candidate profile',
        'The account manager reviews the committee’s ratings, explanations, and community needs here, then adopts the profile. Your input is collected in Step '+stepNo('intake')+'; this page is read-only for committee members.')}
      <div class="band"><div class="wrap stack">
        ${s.profileWithheld ? `<div class="notice notice--info"><div>
          <div class="notice__t">Not published yet</div>
          <div class="notice__b">${esc(s.profileWithheld.reason)}</div>
        </div></div>` : ''}
        ${!s.profileWithheld && !(s.criteria||[]).length ? `<div class="empty"><div class="empty__t">Not adopted yet</div>${esc(s.accountManager?.name||'The account manager')} builds this from committee input.</div>` : ''}
        ${s.adoption ? `<div class="notice notice--ok"><div>
          <div class="notice__t">Built from committee input on ${esc(String(s.adoption.at||'').slice(0,10))}</div>
          <div class="notice__b">${s.adoption.respondents} of ${s.adoption.participants} people asked submitted answers. A badge of
            “${s.adoption.respondents ? '2 of '+s.adoption.respondents : 'x of y'}” counts the people who answered and named that item —
            not naming something is not a vote against it. The narratives members wrote are guidance for the search team, not rules the profile enforces.
            ${s.sourceChanged ? '<b>Committee input has changed since this was adopted.</b> The profile below is the one that was adopted; its counts describe the answers on file at that time.' : ''}</div>
        </div></div>` : ''}
        ${Object.keys(KIND).map(k => {
          const rows = labeledKind(k, s.criteria);
          if (!rows.length) return '';
          return `<div class="spec"><div class="spec__bar">${KIND[k].plural}</div>
            <div class="spec__body stack">${rows.map(c => `
              <div class="crit-read">
                <span class="mono t-small">${esc(c.id)}${critSource(c)}</span>
                <div><b>${esc(c.label)}</b>${c.note?`<div class="t-small">${esc(c.note)}</div>`:''}${critEvidence(c)}</div>
                <span class="t-small mono">weight ${esc(c.weight)}</span>
              </div>`).join('')}</div></div>`;
        }).join('')}
        ${(s.adoption?.discussion || []).length ? `<div class="spec"><div class="spec__bar">Raised, and not on the profile</div>
          <div class="spec__body stack">
            <p class="t-small">The committee named these, and the profile holds five per category. They are recorded for discussion rather than dropped.</p>
            ${s.adoption.discussion.map(d => `<div class="t-small"><b>${esc(d.label)}</b> — named by ${d.mentions} of ${d.respondents}, rated ${d.minWeight} to ${d.maxWeight}${d.contested?', contested':''}.</div>`).join('')}
          </div></div>` : ''}
        ${s.intake?.status === 'closed' && agg?.submitted ? `<details class="spec"><summary class="spec__bar">View submitted committee input (read-only)</summary><div class="spec__body stack">${consensusPanels(agg, false)}</div></details>` : ''}
        <div class="row"><button type="button" class="btn btn--secondary" data-go="intake">Back to my questionnaire</button></div>
      </div></div>`);
  }

  // Start Step 3 with the evidence, not another blank qualities form. A search
  // without committee input still has the direct profile-writing path.
  if (!s.intake?.skipped && !s.intake?.completedEmpty && !(s.criteria || []).length && !state.open.profileedit) {
    return shell(`${head('Step '+stepNo('profile'), 'Review committee input', 'Evaluate the committee’s view of the candidate and the community’s needs, then adopt the profile that will guide recruiting and candidate review.')}
      <div class="band"><div class="wrap stack">
        ${committeeReviewPanel()}
        ${!canManage() ? `<div class="notice notice--info"><div><div class="notice__t">The account manager adopts the profile</div><div class="notice__b">${esc(askManager())} You can inspect the committee input here and prepare the profile wording with them.</div></div></div>` : ''}
        ${s.intake?.status === 'closed' && !s.intake?.questionnaireVersion ? `<button type="button" class="btn btn--secondary" data-act="edit-final-profile">Write the final profile manually</button>` : ''}
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
    // Committee suggestions keep their attribution. Leave the quality bank
    // visible as selections change; only the user's Hide suggestions closes it.
    const fromRoom = (agg?.byKind[k] || []).filter(e => !labels.has(e.label.trim().toLowerCase()));
    const suggKey = 'sugg-'+k;
    const suggOpen = state.open[suggKey] === undefined ? true : Boolean(state.open[suggKey]);
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
        <p class="t-small">Select suggested qualities, then edit their wording and importance above. You can also add your own.</p>
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
    ${head('Step '+stepNo('profile'),s.intake?.skipped ? 'Candidate profile' : 'Review and adopt profile',s.intake?.skipped
      ? 'Choose the candidate qualities and their weights for this search. The profile guides recruiting, screening, and interviews.'
      : 'Evaluate the committee’s answers and community needs below. Then finalize the profile that guides recruiting, screening, and interviews.')}
    <div class="band"><div class="wrap stack">
      ${committeeReviewPanel()}
      ${s.sourceChanged ? `<div class="notice notice--stop"><div>
        <div class="notice__t">Committee input has changed since this profile was adopted</div>
        <div class="notice__b">The profile has not been altered, and it will not be: a changed answer is something to look at, not an automatic edit to a
          published record. The support badges below describe the answers on file when each line was adopted.
          <button type="button" class="btn btn--ghost btn--sm" data-act="adopt-preview">Review what rebuilding would change</button></div>
      </div></div>` : ''}
      ${s.adoptionProvenance === 'unverified' ? `<div class="notice notice--wait"><div>
        <div class="notice__t">This profile's committee provenance is not on file</div>
        <div class="notice__b">It was adopted before Slate recorded what each line rested on, so there is no stored evidence for its support claims and
          today's tally is not that evidence. The committee does not see this profile until you review and save it.</div>
      </div></div>` : ''}
      ${agg?.submitted ? `<div class="notice notice--${adopted?'ok':'info'}"><div>
        <div class="notice__t">${agg.submitted} of ${agg.asked} people asked submitted answers</div>
        <div class="notice__b">${adopted
          ? 'This profile was built from their answers. Each badge counts the people who answered and named that line; it follows the line, not its wording, so renaming one does not change where it came from. Not naming something is not a vote against it.'
          : 'Build the matrix from their answers rather than typing it from memory, then edit.'}
          ${agg.contested.length ? ' <b>'+agg.contested.length+'</b> item'+(agg.contested.length===1?' is':'s are')+' contested — the committee disagrees on how much '+(agg.contested.length===1?'it matters':'they matter')+'. Disagreement is kept as disagreement rather than averaged away.' : ''}
          Matching is by wording, so “Budgeting” and “Financial management” stay separate entries.
          </div>
      </div></div>` : `<div class="notice notice--info"><div>
        <div class="notice__t">${s.intake?.skipped ? 'Committee questionnaire skipped' : 'No committee input on file'}</div>
        <div class="notice__b">${s.intake?.skipped
          ? 'No questionnaire responses are needed. Add and weight the criteria below, then save the profile to continue. An organization administrator can include the questionnaire again in Step '+stepNo('intake')+'.'
          : 'Step '+stepNo('intake')+' collects what each member is looking for, and this matrix is normally built from it. You can still write the profile by hand.'}</div>
      </div></div>`}
      <h2>Finalize the candidate profile</h2>
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
      ${(s.adoption?.discussion || []).length ? `<div class="spec"><div class="spec__bar">Raised, and not on the profile ${pill('stop', String(s.adoption.discussion.length))}</div>
        <div class="spec__body stack">
          <p class="t-small">The committee named these and the cap is five per category. They are kept for the conversation rather than forced into a slot.</p>
          ${s.adoption.discussion.map(d => `<div class="t-small"><b>${esc(d.label)}</b> — ${esc(KIND[d.kind]?.label||d.kind)}, named by ${d.mentions} of ${d.respondents}, rated ${d.minWeight} to ${d.maxWeight}${d.contested?', contested':''}.
            ${(d.reasons||[]).slice(0,3).map(r => esc((r.name||'A member')+': '+r.note)).join(' · ')}</div>`).join('')}
        </div></div>` : ''}
      ${agg?.submitted && canManage()
        ? beforeYouAct(esc(TIPS.adoptPreview) + ' Adoption is a save: it sets the criteria every candidate is scored against, and it is recorded with the answers it rested on.')
        : ''}
      ${!canManage() && canEdit()
        ? beforeYouAct(esc(askManager() + ' Adopting the profile is their decision; prepare it here and ask them to review it.'))
        : ''}
      ${actionBar(
        `<button type="button" class="btn btn--primary" data-act="save-profile">Save profile</button>`,
        `${agg?.submitted && canManage() ? withTip(`<button type="button" class="btn btn--secondary" data-act="adopt-preview" ${s.intake?.status==='closed'?'':'disabled'}>${adopted?'Rebuild from committee':'Build from committee'}</button>`,
          s.intake?.status==='closed'
            ? 'Show what the committee’s answers would add, change and remove. Nothing is saved until you confirm it.'
            : 'Close the committee input window first. Building the profile publishes what the committee said to everyone on the search.') : ''}
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
  return `<figure class="pack__fig"><img src="${esc(photoSource(src))}" data-media="${esc(src)}" alt="${esc(caption||'')}">${caption?`<figcaption>${esc(caption)}</figcaption>`:''}</figure>`;
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
function firstReviewLine(value){
  const text = String(value || '').trim();
  if (!text) return '';
  return /^first review\b/i.test(text) ? text : 'First review ' + text;
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
  return `<div class="pack__hero${extraClass?' '+extraClass:''}"><img src="${esc(photoSource(src))}" data-media="${esc(src)}" alt=""></div>`;
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
  'survey1.questions': list => ({ n:Math.max(0,...list.map(q => Number(q.n)||0))+1, prompt:'', required:false, crit:[] }),
  'survey2.questions': list => ({ n:Math.max(0,...list.map(q => Number(q.n)||0))+1, prompt:'', required:false, crit:[] }),
  'guide.questions':   list => ({ n:Math.max(0,...list.map(q => Number(q.n)||0))+1, stem:'', approach:'', results:'', experience:'', crit:[] }),
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
    const planInput = (path, label, value) => `<input class="input" data-path="${esc(path)}" value="${esc(value||'')}" aria-label="${esc(label)}"><span class="print-value">${esc(value||'')}</span>`;
    return editorWrap(kind, `
      ${sectionHead('Where the position is advertised', rows.length ? rows.length+' outlets' : 'None yet', artAdd(kind,'rows','Add an outlet'))}
      ${rows.length ? `<div class="tablewrap plan-editor"><table>
      <thead><tr><th>Outlet</th><th>Audience</th><th>Format</th><th>When</th><th>Cost</th><th>Who</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.map((r,i)=>`<tr>
        <td>${planInput('rows.'+i+'.outlet', 'Outlet '+(i+1), r.outlet)}</td>
        <td>${planInput('rows.'+i+'.audience', 'Audience '+(i+1), r.audience)}</td>
        <td>${planInput('rows.'+i+'.format', 'Format '+(i+1), r.format)}</td>
        <td>${planInput('rows.'+i+'.when', 'When '+(i+1), r.when)}</td>
        <td>${planInput('rows.'+i+'.cost', 'Cost '+(i+1), r.cost)}</td>
        <td>${planInput('rows.'+i+'.who', 'Who '+(i+1), r.who)}</td>
        <td>${planInput('rows.'+i+'.status', 'Status '+(i+1), r.status)}</td>
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
  const defaultTitle = (s.position||'Position')+': '+(s.client||'Search');
  const title = a.title && a.title !== defaultTitle ? a.title : (s.position||'Leadership opportunity');
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
          <div class="pack__brand">Executive recruitment</div>
          <div class="pack__place">${esc(s.client||'The jurisdiction')}</div>
          <h3 class="pack__title">${esc(title)}</h3>
          ${a.lede ? `<p class="pack__deck">${esc(a.lede)}</p>` : ''}
          <div class="pack__meta">${[s.fog, s.state, s.salary].filter(Boolean).map(esc).join(' · ')}</div>
        </div>
      </header>
      ${facts ? `<div class="pack__facts">${facts}</div>` : ''}
      <div class="pack__body">
        ${packSec('The opportunity', a.theOpportunity)}
        ${packSec('The community', a.thePlace, '', packPhoto(photos.place, s.client||'The community'))}
        ${packSec('About the organization', a.theOrganization, '', packPhoto(photos.org, 'The organization'))}
        ${packSec('Leadership opportunity', a.leadershipOpportunity)}
        <div class="pack__grid">
          ${packSec('Current challenges', a.challenges, a.challenges ? '' : chall)}
          ${packSec('Future opportunities', a.opportunities, a.opportunities ? '' : opps)}
        </div>
        ${skills || traits ? `<section class="pack__sec"><div class="pack__h">Desired candidate</div>
          ${a.ideal ? `<div class="pack__prose">${prose(a.ideal)}</div>` : ''}
          ${!a.ideal && skills ? `<div class="pack__label">Essential skills</div>${skills}` : ''}
          ${!a.ideal && traits ? `<div class="pack__label">Leadership traits</div>${traits}` : ''}
        </section>` : packSec('Desired candidate', a.ideal)}
        ${packSec('Position responsibilities', a.theJob)}
        ${packSec('Compensation and benefits', a.compensation)}
        ${a.whyConsider && ![a.lede,a.theOpportunity,a.thePlace].includes(a.whyConsider) ? packSec('Why consider this community', a.whyConsider) : ''}
      </div>
      <footer class="pack__apply">
        <div class="pack__h">How to apply</div>
        ${a.howToApply ? `<div class="pack__prose">${prose(a.howToApply)}</div>` : '<p>See the advertisement for the application link and deadline.</p>'}
        ${s.firstReview ? `<div class="pack__due">${esc(firstReviewLine(s.firstReview))}</div>` : ''}
      </footer>
    </article>`;
}

function photoSlot(slot, label, hint, photos){
  const src = photos[slot];
  return `<div class="photo-slot">
    <div class="photo-slot__frame">${src ? `<img src="${esc(photoSource(src))}" data-media="${esc(src)}" alt="">` : '<span>No photo</span>'}</div>
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
        ${(a.firstReview || s.firstReview) ? `<div class="pack__due">${esc(firstReviewLine(a.firstReview || s.firstReview))}</div>` : ''}
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

/* ===========================================================================
 * Whether research can run, decided once
 *
 * Search facts offered an always-enabled button and sent people to the profile
 * only after they had pressed it; Community disabled the same action and
 * explained why. Two screens, two answers, one operation (D06). This is the
 * answer, and both screens render it.
 * ========================================================================= */

function researchEligibility(){
  const s = state.search;
  if (!s) return { ok: false, why: 'Open a search first.' };
  // Research writes to the search file, which is the firm's work.
  if (isCommittee()) return { ok: false, why: 'Only the search team can run research on this file.' };
  if (s.projectAccess?.state === 'unpaid') return {
    ok:false, why:'Complete the project payment before running research.', go:'billing'
  };
  if (isFrozen(s)) {
    return { ok: false, why: 'This search is ' + lifecycleOf(s) + ', so nothing new is written to it. Reopen it to research again.' };
  }
  if (state.research.active) {
    return { ok: false, why: 'Research is already running on this search. Cancel it if you want to start again.' };
  }
  const profileDone = (s.steps || []).find(st => st.key === 'profile')?.status === 'done';
  if (!profileDone) {
    return {
      ok: false,
      // The same sentence on both screens, and it names the step rather than
      // waiting for a click to redirect there.
      why: 'Research runs once the candidate profile is adopted (Step ' + stepNo('profile') + ').',
      go: 'profile'
    };
  }
  if (!state.health?.hasKey) {
    return { ok: false, why: 'No API key is configured, so research is unavailable. You can fill these facts by hand.' };
  }
  return { ok: true };
}

/**
 * The research action, with its availability and its explanation attached.
 *
 * Rendered from researchEligibility so the button state and the sentence beside
 * it can never disagree, and so neither can differ between screens.
 */
function researchAction(label){
  const verdict = researchEligibility();
  const button = '<button type="button" class="btn btn--secondary" data-act="research"'
    + (verdict.ok ? '' : ' disabled') + '>' + esc(label) + '</button>';
  return withTip(button, TIPS.research)
    + (verdict.ok ? '' : ' <span class="t-small">' + esc(verdict.why) + '</span>');
}

/**
 * What the lookup form should show: what was last typed, if a failed attempt
 * left it behind, and otherwise the file.
 */
function researchDraftValue(field, fallback){
  const held = state.research.draft && String(state.research.draft[field] || '').trim();
  return held || fallback || '';
}

/**
 * Why the last research attempt did not land, and what to do about it.
 *
 * On the page rather than in a toast, because a toast is gone before it has
 * been read and this is the one message a consultant has to act on. It stays
 * until they retry, reload, or say they will fill the facts by hand.
 */
function researchFailurePanel(){
  const e = state.research.error;
  if (!e) return '';
  const missing = (e.missing || []).length
    ? `<div class="t-small">Still missing: ${esc((e.missing||[]).join('; '))}.</div>` : '';
  return `<div class="notice notice--stop">
    <div>
      <div class="notice__t">Research did not finish</div>
      <div class="notice__b">${esc(e.error)}</div>
      ${missing}
      <div class="row u-mt-3">
        ${e.retry ? `<button type="button" class="btn btn--secondary btn--sm" data-act="research">Try research again</button>` : ''}
        ${e.reconcile ? `<button type="button" class="btn btn--primary btn--sm" data-act="research-reconcile">Check what happened</button>` : ''}
        ${e.reload ? `<button type="button" class="btn btn--secondary btn--sm" data-act="reload-search">Reload this search</button>` : ''}
        <button type="button" class="btn btn--ghost btn--sm" data-act="research-dismiss">Fill the facts by hand</button>
      </div>
      ${e.operation ? `<div class="t-small mono u-mt-2">Reference ${esc(e.operation)}</div>` : ''}
    </div>
  </div>`;
}

/**
 * Findings that are supported but incomplete, waiting for a decision.
 *
 * The alternative used to be discarding the whole run, or a loop that kept
 * demanding a budget figure a jurisdiction does not publish. Applying this
 * fills what is blank and leaves alone anything already on the file.
 */
function researchReviewPanel(){
  const job = state.research.review;
  if (!job) return '';
  const missing = (job.missing || []).length
    ? `<div class="t-small">Not found: ${esc((job.missing||[]).join('; '))}. Fill those by hand.</div>`
    : '';
  const sources = (job.sources || []).length
    ? `<ul class="t-small">${(job.sources||[]).slice(0,6).map(sx =>
        `<li><a href="${esc(safeHref(sx.url))}" target="_blank" rel="noopener">${esc(sx.title || sx.url)}</a></li>`).join('')}</ul>`
    : '';
  const refs = job.result?.fieldEvidence || {};
  const facts = job.result?.facts || {};
  const labels = { client:'Jurisdiction', state:'State', fog:'Government', population:'Population',
    budget:'Budget', salary:'Salary', notes:'Notes' };
  const findings = Object.entries(labels).filter(([key]) => facts[key]).map(([key,label]) => {
    const ref = refs[key];
    const source = ref?.url ? `<a href="${esc(safeHref(ref.url))}" target="_blank" rel="noopener">Source ${esc(ref.evidenceId || '')}</a>` : 'Review against sources';
    const current = state.search?.[key] ? `Current: ${esc(String(state.search[key]).slice(0,120))}` : 'Currently blank';
    return `<label class="research-finding"><input type="checkbox" name="research-field" value="${key}" checked>
      <span><strong>${label}:</strong> ${esc(String(facts[key]))}<br><small>${source}${ref?.year?' · '+esc(ref.year):''} · ${current}</small></span></label>`;
  });
  if (job.result?.community?.lede) {
    const ref = refs.lede;
    findings.push(`<label class="research-finding"><input type="checkbox" name="research-field" value="community" checked>
      <span><strong>Community summary:</strong> ${esc(job.result.community.lede)}<br><small>${ref?.url ? `<a href="${esc(safeHref(ref.url))}" target="_blank" rel="noopener">Source ${esc(ref.evidenceId || '')}</a>` : 'Review against sources'}</small></span></label>`);
  }
  return `<div class="notice notice--wait">
    <div>
      <div class="notice__t">Research ready for review</div>
      <div class="notice__b">Choose the findings to apply. Existing manual entries stay in place.</div>
      ${findings.join('')}
      ${missing}
      ${sources}
      <div class="row u-mt-3">
        <button type="button" class="btn btn--primary btn--sm" data-act="research-apply">Apply what it found</button>
        <button type="button" class="btn btn--ghost btn--sm" data-act="research-dismiss">Leave it for now</button>
      </div>
      <div class="t-small u-mt-2">Leaving it does not throw it away: it is still on the search until you apply it or research this ${esc(jurisdictionInfo().noun)} again.</div>
    </div>
  </div>`;
}

// The same two panels for screens that are not the community profile, drawn
// only when there is something to say.
function researchNoticeBand(){
  const inner = researchReviewPanel() + researchFailurePanel();
  return inner ? `<div class="band"><div class="wrap stack">${inner}</div></div>` : '';
}

function vCommunity(){
  const s = state.search, meta = DRAFTS.community, has = Boolean(s.artifacts?.community);
  const profileDone = (s.steps||[]).find(st=>st.key==='profile')?.status==='done';
  const mode = docMode('community');
  // Whether research is available, and why not, is researchEligibility's
  // answer now (D06). This screen only decides whether to lead with the
  // profile prerequisite as a notice rather than as a sentence on a button.
  return shell(`
    ${head('Step '+stepNo('community'), meta.title, meta.lede)}
    <div class="band"><div class="wrap stack">
      ${!profileDone ? prereqNotice('The profile comes first',
        'Adopt the candidate profile — 3 to 5 essential skills — then look up the jurisdiction. Research writes this profile against what the committee said it is looking for.',
        'profile', 'Open Step '+stepNo('profile')+' · Candidate profile') : ''}
      ${researchReviewPanel()}
      ${researchFailurePanel()}
      ${!has ? communityEmptyNotice(s) : ''}
      ${docBar('community', has)}
      ${mode==='edit' ? `
        ${sectionHead('Look this jurisdiction up')}
        <form id="citylookup" class="formgrid">
          ${field(jurisdictionInfo().key==='county'?'County':'Jurisdiction','', `<input class="input" name="city" value="${esc(researchDraftValue('city', s.client))}" placeholder="${esc(jurisdictionInfo().clientPlaceholder)}">`)}
          ${field('Official website','http or https', `<input class="input" name="website" value="${esc(researchDraftValue('website', s.website))}" placeholder="https://www.fcgov.com">`)}
        </form>
        <p class="t-small">A research agent reads the official site, Census, and budget documents, then fills the facts on this search. It will not invent numbers. Check the file before you use it in recruiting.</p>
        ${modelToggle()}
        <label class="t-small u-inline-check"><input type="checkbox" id="deeper-research">Find missing facts with additional web searches</label>
        <label class="t-small u-inline-check"><input type="checkbox" id="refresh-evidence">Refresh public sources</label>
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
        `${researchAction('Research this ' + jurisdictionInfo().noun)}
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
    c.invite ? withTip(`<button type="button" class="btn btn--ghost btn--sm" data-act="copy-invite" data-cid="${c.id}">Copy invite link</button>`, TIPS.copyInvite) : '',
    c.invite ? withTip(`<a class="btn btn--ghost btn--sm" href="/apply/${esc(c.invite)}" target="_blank" rel="noopener">Open questionnaire</a>`, TIPS.openQuestionnaire) : '',
    withTip(`<button type="button" class="btn btn--ghost btn--sm" data-act="replace-invite" data-cid="${c.id}">${c.invite ? 'Replace candidate link' : 'Issue a new link'}</button>`, TIPS.replaceInvite)
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
      ${may('releaseScores') ? beforeYouAct(s.released
        ? '<b>Seal scores</b> hides the panel again so each person sees only their own. It cannot recall an export somebody already took.'
        : '<b>Release scores</b> makes every panel score and note visible to everyone on this search, including the committee. There is no partial release.') : ''}
      ${actionBar(
        nextBtn('screen') || `<button class="btn btn--primary" data-go="overview">Back to this search</button>`,
        may('releaseScores') ? withTip(`<button type="button" class="btn btn--secondary" data-act="toggle-release">${s.released?'Seal scores':'Release scores'}</button>`, s.released ? TIPS.seal : TIPS.release) : '',
        !canEdit() ? '' : may('releaseScores')
          ? (s.released ? 'Panel scores are visible to the committee.' : 'Each person sees only their own scores.')
          : (s.released ? 'Panel scores are visible to the committee. ' : 'Each person sees only their own scores. ') + askManager())}
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
        ${canEdit() && c.invite ? withTip(`<button type="button" class="btn btn--secondary btn--sm" data-act="copy-invite" data-cid="${c.id}">Copy invite</button>`, TIPS.copyInvite) : ''}
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
      ${canEdit() && list.length ? beforeYouAct(esc(TIPS.openQuestionnaireAccess)) : ''}
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
          ${may('advanceFinalist') && c.stage==='semifinalist'
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
            ${field('Link','Permanent https URL requiring repository sign-in, without query parameters, fragments or sharing credentials. Otherwise leave blank and put the document identifier in its label.', `<input class="input" name="url" placeholder="https://">`, { span:true })}
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
      <div class="notice__b">Reopen it from closeout before recording anything further.</div></div></div>`
      : !may('recordOutcome') ? `<div class="notice notice--info"><div><div class="notice__t">Recording the outcome is the manager's decision</div>
      <div class="notice__b">${esc(askManager())} Log the source communication on this candidate's contact record,
        then ask them to record it. The entries above are the file as it stands.</div></div></div>` : `
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
  const mine = state.scoreDraft?.cid === c.id ? state.scoreDraft.scores : (((s.scores||{})[state.user.id]||{})[c.id] || {});
  const note = state.scoreDraft?.cid === c.id ? state.scoreDraft.note : ((((s.notesBy||{})[state.user.id]||{})[c.id]) || '');
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
      nextStage && may(nextStage==='finalist' ? 'advanceFinalist' : 'advanceStage')
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
      ${state.scoreConflict?.cid === c.id ? `<div class="notice notice--wait" role="alert"><div>
        <div class="notice__t">Your ratings are still here</div>
        <div class="notice__b">${esc(state.scoreConflict.message)} Review the current criteria and your entries below. Your typed ratings are retained here, including any criterion that was removed:
          <ul>${Object.entries(state.scoreDraft?.scores || {}).map(([id,value]) => `<li>${esc(state.scoreDraft?.labels?.[id] || id)}: ${esc(value)} of 5</li>`).join('')}</ul>
          The latest saved ratings are ${esc(JSON.stringify(state.scoreConflict.current.scores || {}))}; latest note: ${esc(state.scoreConflict.current.note || '(none)')}.</div>
        <button type="button" class="btn btn--secondary" data-act="retry-score">Save my reviewed ratings</button>
      </div></div>` : ''}
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
            ${field('Note to the file','Only you and the search team see this.', `<textarea class="input ed" id="cnote">${esc(note)}</textarea><div class="print-note">${esc(note || 'No note recorded.')}</div>`)}
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
  const draft = a.drafts?.[which] || null;
  const draftAnswers = draft?.answers || {};
  const draftStamp = draft?.at
    ? 'Draft saved ' + esc(String(draft.at).slice(0, 16).replace('T', ' '))
    : 'Not submitted';
  return `<div class="apply-shell">
    ${head(a.client, title, esc(survey.intro||'')+due)}
    <div class="applymeta">
      <p class="t-small"><b>${questions.length} question${questions.length===1?'':'s'}.</b>
        ${required ? esc(required)+' of them must be answered; those are marked with an asterisk. ' : 'None of them are required. '}
        You can save a private draft and return with this same link. Drafts expire after 14 days.</p>
      <p class="t-small"><button type="button" class="btn btn--ghost btn--sm" data-act="jump" data-to="apply-help">Need help or an accommodation?</button></p>
    </div>
    <form id="applyform" class="stack u-mt-5" data-which="${which}">
      ${questions.map(q => `
        <div class="q">
          <div class="q__hd"><span class="q__n" aria-hidden="true">${String(q.n).padStart(2,'0')}</span><span class="q__t" id="q${q.n}-label">${esc(q.prompt)}${q.required?' <span class="req" aria-hidden="true">*</span>':''}</span></div>
          <div class="q__bd"><textarea class="input ed" name="q${q.n}" id="q${q.n}-input" aria-labelledby="q${q.n}-label" ${q.required?'required aria-required="true"':''}>${esc(draftAnswers['q'+q.n] || '')}</textarea></div>
        </div>`).join('')}
      ${beforeYouAct('<b>Save draft</b> keeps your answers and lets you return with this same link. '
        + 'Your questionnaire is not submitted until you select <b>Submit questionnaire</b>.')}
      <div class="applybar">
        <button class="btn btn--primary" type="submit">Submit questionnaire</button>
        <button class="btn btn--secondary" type="button" data-act="save-apply-draft" data-which="${which}">Save draft</button>
        <span class="t-small" id="applycount" role="status" data-total="${questions.length}">${questions.filter(q => String(draftAnswers['q'+q.n] || '').trim()).length} of ${questions.length} answered</span>
      </div>
      <p class="t-small" id="apply-draft-status" role="status">${draftStamp}</p>
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
  // Reference completion certifies work about people outside the firm who agreed
  // to be contacted, so it answers to the manager; sourcing and interview
  // sign-off stay with the consultant who did the work.
  const mayCertify = may(key==='references' ? 'certifyReferences' : 'certifyStaffWork');
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
        mayCertify
          ? withTip(`<button type="button" class="btn btn--${done?'secondary':'primary'}" data-act="staff-done" data-key="${esc(key)}" data-done="${done?'0':'1'}">${done?'Reopen this step':'Mark complete'}</button>`,
              done ? 'Reopen the step so more work can be logged against it.' : esc(meta.doneWhen))
          : '',
        nextBtn(key).replace('btn--primary','btn--secondary'),
        canEdit() && !mayCertify
          ? esc(askManager() + ' Certifying reference completion is their decision; record the consent and the contacts here.')
          : esc(meta.doneWhen))}
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
          <div class="hubrow__act">${s.mayRestore
            ? withTip(`<button type="button" class="btn btn--secondary btn--sm" data-act="restore-search" data-id="${esc(s.id)}">Restore search</button>`,
              'Put this search back on the book. Candidate links stay revoked; reissue a link separately if needed.')
            : `<span class="t-small">${esc(s.managerName ? s.managerName + ' ran this search and restores it.' : 'Its account manager restores it.')}</span>`}</div>
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
        ${e.revision ? `<p class="t-small">Profile revision ${esc(e.revision)}</p>` : ''}
        ${e.criteria ? `<ul>${e.criteria.map(c => `<li>${esc(c.id)}: ${esc(c.label)} (weight ${esc(c.weight)})</li>`).join('')}</ul>` : ''}
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

/**
 * The criteria an entry was given against.
 *
 * A scoring entry no longer repeats them — `revision` names the profile, and
 * that profile's own entry holds the list. Entries written before that change
 * carry their own copy and keep using it.
 */
function historyCriteria(entry){
  if (entry.criteria) return entry.criteria;
  if (entry.revision && entry.revision === state.search?.profileRevision) return state.search.criteria || [];
  const profile = (state.history?.history || []).find(e => e.kind === 'profile' && e.revision === entry.revision);
  return profile?.criteria || [];
}

function historyRecord(entry){
  if (entry.kind === 'response') return `<p>${esc(entry.candidateName)} · ${esc(entry.reason)}</p>` + surveyRead(entry.body.survey, entry.body);
  if (entry.kind === 'scores' || entry.kind === 'profile') {
    const criteria = historyCriteria(entry);
    const rows = Object.entries(entry.scores || {}).map(([uid, byCandidate]) => {
      const name = state.users.find(u => u.id === uid)?.name || 'Former reviewer';
      return Object.entries(byCandidate).map(([cid, scores]) => {
        const candidate = (entry.candidates || state.search.candidates).find(c => c.id === cid)?.name || 'Former candidate';
        const marks = Object.entries(scores);
        return `<p><b>${esc(name)} · ${esc(candidate)}</b></p>${marks.length
          ? `<ul>${marks.map(([id, n]) => `<li>${esc(criteria.find(c=>c.id===id)?.label || id)}: ${esc(n)}</li>`).join('')}</ul>`
          : '<p class="t-small">Not scored before this change.</p>'}<p>${esc(entry.notesBy?.[uid]?.[cid] || '')}</p>`;
      }).join('');
    }).join('');
    // A delta entry lists what that save replaced, not the whole panel. Saying
    // so is the difference between "these were the only scores" and "these are
    // the ones this save changed".
    const lede = entry.delta
      ? '<p class="t-small">What this save replaced. Scores it did not touch are unchanged and recorded where they were last set.</p>'
      : '';
    return rows ? lede + rows : '<p>No scores recorded for this version.</p>';
  }
  const display = value => {
    if (value == null) return '';
    if (Array.isArray(value)) return '<ul>' + value.map(v=>'<li>'+display(v)+'</li>').join('') + '</ul>';
    if (typeof value === 'object') return '<dl>' + Object.entries(value).map(([k,v])=>'<dt><b>'+esc(k.replace(/([a-z])([A-Z])/g,'$1 $2'))+'</b></dt><dd>'+display(v)+'</dd>').join('') + '</dl>';
    return `<span class="u-wrap-any">${esc(value)}</span>`;
  };
  return display(entry.body);
}

/* ===========================================================================
 * Team & access
 *
 * The administrator's side of a workspace: who is in it, what they may do, and
 * which invitations are still out. Membership and pending invitation are shown
 * as two separate lists because they are two different states — somebody who
 * has been emailed is not in the firm yet, and treating them as if they were is
 * how an account manager ends up waiting on access that was never granted.
 * ========================================================================= */

/* ===========================================================================
 * The public job posting
 *
 * Consultants write and preview it; the account manager publishes. The screen
 * draws that split from the authority answers the server sends rather than
 * from a role name, so the buttons and the refusals cannot disagree.
 *
 * The single most important thing this screen has to communicate is that
 * editing is not publishing. A draft saved here changes nothing the public can
 * see until somebody deliberately publishes it, and the state of the live page
 * is stated separately from the state of the draft on every render.
 * ========================================================================= */

const POSTING_FIELDS = [
  { key:'title', label:'Position title', req:true, hint:'What the job is called in the advertisement. “City Manager”, not “Search 2026-04”.' },
  { key:'employer', label:'Employer or jurisdiction', req:true, hint:'Who the applicant would work for.' },
  { key:'location', label:'Location', req:true, hint:'Where the position is. Applicants filter on this.' },
  { key:'compensation', label:'Compensation', hint:'Only what the client has approved for publication. Leave empty rather than estimating.' }
];

const POSTING_TEXT = [
  { key:'summary', label:'About this position', req:true, rows:6, hint:'A short description of the role and the organization.' },
  { key:'responsibilities', label:'Responsibilities', rows:8 },
  { key:'qualifications', label:'Qualifications', req:true, rows:8, hint:'What applicants are measured against. This is what they read to decide whether to apply.' },
  { key:'applicationInstructions', label:'How to apply', req:true, rows:6, hint:'What an applicant has to provide, and anything they should know before starting.' },
  { key:'privacyNotice', label:'Privacy notice', req:true, rows:6, hint:'The firm’s approved wording about what is collected and how long it is kept. A posting cannot be published without one.' }
];

/**
 * Read the posting screen back off the page.
 *
 * Questions and materials keep their `key` where they already have one, so
 * reordering or rewording a question does not orphan the answers an applicant
 * has already written against it (the server generates a key for a new one).
 */
function collectPosting(){
  const value = key => $('[data-posting="'+key+'"]')?.value ?? '';
  const held = state.postingDraft || {};
  const previous = state.posting?.draft || {};
  const kind = $('[data-posting-deadline="kind"]:checked')?.value
    || (held.deadline || previous.deadline || {}).kind || 'open';

  const rows = (selector, shape) => {
    const out = [];
    for (const el of $$('[' + selector + ']')){
      const [index, part] = el.getAttribute(selector).split(':');
      const i = Number(index);
      out[i] ||= { ...shape };
      out[i][part] = el.type === 'checkbox' ? el.checked : el.value;
    }
    return out.filter(Boolean);
  };

  const source = held.questions || previous.questions || [];
  const questions = rows('data-posting-q', { prompt:'', help:'', required:false })
    .map((q, i) => (source[i]?.key ? { ...q, key: source[i].key } : q));
  const materialSource = held.materials || previous.materials || [];
  const materials = rows('data-posting-m', { label:'', note:'', required:false })
    .map((m, i) => (materialSource[i]?.key ? { ...m, key: materialSource[i].key } : m));

  return {
    title: value('title'), employer: value('employer'), location: value('location'),
    compensation: value('compensation'),
    summary: value('summary'), responsibilities: value('responsibilities'),
    qualifications: value('qualifications'),
    applicationInstructions: value('applicationInstructions'),
    privacyNotice: value('privacyNotice'),
    supportEmail: value('supportEmail'), supportPhone: value('supportPhone'),
    supportHours: value('supportHours'),
    deadline: {
      kind,
      closesAt: $('[data-posting-deadline="closesAt"]')?.value || '',
      firstReviewOn: $('[data-posting-deadline="firstReviewOn"]')?.value || '',
      timezone: $('[data-posting-deadline="timezone"]')?.value || ''
    },
    questions, materials
  };
}

function postingStatePill(p){
  if (!p.published) return pill('idle','Not published');
  if (p.frozenBySearch) return pill('stop','Offline: the search is closed');
  if (p.state === 'published') return p.accepting ? pill('ok','Live · accepting applications') : pill('wait','Live · past its closing date');
  if (p.state === 'paused') return pill('wait','Live · paused');
  return pill('idle','Live · closed to new applications');
}

function postingDraftValue(key){
  const draft = state.postingDraft || {};
  if (draft[key] !== undefined) return draft[key];
  return state.posting?.draft?.[key] ?? '';
}

function postingDeadline(){
  return (state.postingDraft?.deadline) || state.posting?.draft?.deadline || { kind:'open', closesAt:'', firstReviewOn:'', timezone:'' };
}

function vPosting(){
  const p = state.posting;
  if (!p) return shell(`${head('This search','Public posting','Loading.')}`);
  const canPublish = may('publishPosting');
  const caps = p.capabilities || {};
  const deadline = postingDeadline();
  const questions = state.postingDraft?.questions || p.draft.questions || [];
  const materials = state.postingDraft?.materials || p.draft.materials || [];

  const text = f => field(esc(f.label), esc(f.hint || ''),
    `<textarea class="input ed" rows="${f.rows}" data-posting="${esc(f.key)}">${esc(postingDraftValue(f.key))}</textarea>`,
    { req:f.req, span:true });

  return shell(`
    ${head('This search', 'Public posting',
      'The job page members of the public read. Nothing here is visible to anyone until it is published, and '
      + 'editing a published posting changes nothing until it is published again.',
      p.publicUrl ? withTip(`<a class="btn btn--secondary btn--sm" href="${esc(p.publicUrl)}" target="_blank" rel="noopener">Open the live page</a>`, TIPS.previewPosting) : '')}
    <div class="band"><div class="wrap stack">

      <div class="spec"><div class="spec__bar">What the public sees right now</div>
        <div class="spec__body stack stack--tight">
          <p>${postingStatePill(p)}</p>
          ${p.published
            ? `<p class="t-small">Version ${esc(p.published.version)}, published ${esc(String(p.published.at).slice(0,10))}${p.published.byName?' by '+esc(p.published.byName):''}.</p>
               ${p.publicUrl ? `<p class="t-small mono u-wrap-any">${esc(p.publicUrl)}</p>` : ''}
               ${p.frozenBySearch ? `<div class="notice notice--stop" role="status"><div>
                 <div class="notice__t">This posting is offline because the search is closed</div>
                 <div class="notice__b">Closing or archiving a search stops public intake. Reopening the search does not republish the posting; that is a separate, deliberate act.</div></div></div>` : ''}
               ${p.unpublishedChanges ? `<div class="notice notice--wait" role="status"><div>
                 <div class="notice__t">You have saved changes the public cannot see</div>
                 <div class="notice__b">The live page is still version ${esc(p.published.version)}. ${canPublish
                   ? 'Publish changes below when the new wording is approved.'
                   : esc(askManager() + ' Publishing is their decision.')}</div></div></div>` : ''}`
            : `<p class="t-small">This search is not advertised anywhere. Filling this in changes nothing until somebody publishes it.</p>`}
        </div></div>

      ${p.readiness.missing.length ? `<div class="notice notice--wait" role="status"><div>
        <div class="notice__t">Still needed before this can be published</div>
        <div class="notice__b"><ul class="u-mt-3">${p.readiness.missing.map(m => `<li>${esc(m)}</li>`).join('')}</ul></div>
      </div></div>` : ''}

      ${postingCapabilityNotice(caps)}

      <form id="postingform" class="spec"><div class="spec__bar">The posting</div>
        <div class="spec__body stack">
          <div class="grid2">
            ${POSTING_FIELDS.map(f => field(esc(f.label), esc(f.hint || ''),
              `<input class="input" data-posting="${esc(f.key)}" value="${esc(postingDraftValue(f.key))}">`, { req:f.req })).join('')}
          </div>
          ${POSTING_TEXT.map(text).join('')}
        </div>
      </form>

      <div class="spec"><div class="spec__bar">Closing date</div>
        <div class="spec__body stack stack--tight">
          <p class="t-small">Only the policy you choose here is enforced. An advisory review date never closes applications, and never will.</p>
          <div class="row">
            <label class="radio"><input type="radio" name="deadlinekind" value="hard" data-posting-deadline="kind"
              ${deadline.kind==='hard'?'checked':''}> Closes on a date</label>
            <label class="radio"><input type="radio" name="deadlinekind" value="open" data-posting-deadline="kind"
              ${deadline.kind!=='hard'?'checked':''}> Open until filled</label>
          </div>
          <div class="grid2">
            ${deadline.kind==='hard'
              ? field('Closing date','Applications are accepted through the end of this day, then the page stops taking them.',
                `<input class="input" type="date" data-posting-deadline="closesAt" value="${esc(deadline.closesAt||'')}">`, { req:true })
              : field('First review date','Optional, and advisory only. Shown to applicants as when reading begins.',
                `<input class="input" type="date" data-posting-deadline="firstReviewOn" value="${esc(deadline.firstReviewOn||'')}">`)}
            ${field('Timezone','Stated beside every date on the public page, so nobody has to guess.',
              `<input class="input" data-posting-deadline="timezone" value="${esc(deadline.timezone||'')}" placeholder="America/Phoenix">`, { req:true })}
          </div>
        </div></div>

      <div class="spec"><div class="spec__bar">Support and accommodation contact</div>
        <div class="spec__body stack stack--tight">
          <p class="t-small">Published on the job page. Somebody who cannot complete the application, or who needs an accommodation, has to have a person to reach. A posting cannot be published without at least an address or a phone number.</p>
          <div class="grid2">
            ${field('Email','', `<input class="input" type="email" data-posting="supportEmail" value="${esc(postingDraftValue('supportEmail'))}">`)}
            ${field('Phone','', `<input class="input" data-posting="supportPhone" value="${esc(postingDraftValue('supportPhone'))}">`)}
          </div>
          ${field('Hours','When somebody actually reads it. Leave empty rather than promising cover you do not have.',
            `<input class="input" data-posting="supportHours" value="${esc(postingDraftValue('supportHours'))}">`, { span:true })}
        </div></div>

      <div class="spec"><div class="spec__bar">Application questions${questions.length?' · '+questions.length:''}</div>
        <div class="spec__body stack stack--tight">
          <p class="t-small">Short questions every applicant answers. These are not the screening questionnaire: they are the public form, and applicants read them before deciding to apply.</p>
          ${questions.map((q, i) => `<div class="artitem" data-row="${i}">
            <div class="artitem__hd"><b>Question ${i+1}</b>
              <button type="button" class="btn btn--ghost btn--sm" data-act="posting-drop-q" data-i="${i}">Remove</button></div>
            ${field('Prompt','', `<input class="input" data-posting-q="${i}:prompt" value="${esc(q.prompt||'')}">`, { span:true })}
            ${field('Help text','Optional. Shown under the field.', `<input class="input" data-posting-q="${i}:help" value="${esc(q.help||'')}">`, { span:true })}
            <label class="radio"><input type="checkbox" data-posting-q="${i}:required" ${q.required?'checked':''}> Required</label>
          </div>`).join('')}
          <div class="row"><button type="button" class="btn btn--secondary btn--sm" data-act="posting-add-q">Add a question</button></div>
        </div></div>

      <div class="spec"><div class="spec__bar">Materials${materials.length?' · '+materials.length:''}</div>
        <div class="spec__body stack stack--tight">
          <p class="t-small">What an applicant has to attach. ${caps.files?.uploads
            ? 'Files are accepted as PDF, up to 8 MB each.'
            : 'This deployment is not accepting uploads, so a required material here cannot be provided through the portal. Say in “How to apply” where to send it instead.'}</p>
          ${materials.map((m, i) => `<div class="artitem" data-row="m${i}">
            <div class="artitem__hd"><b>Material ${i+1}</b>
              <button type="button" class="btn btn--ghost btn--sm" data-act="posting-drop-m" data-i="${i}">Remove</button></div>
            ${field('Label','', `<input class="input" data-posting-m="${i}:label" value="${esc(m.label||'')}" placeholder="Resume">`, { span:true })}
            ${field('Note','Optional guidance shown beside it.', `<input class="input" data-posting-m="${i}:note" value="${esc(m.note||'')}">`, { span:true })}
            <label class="radio"><input type="checkbox" data-posting-m="${i}:required" ${m.required?'checked':''}> Required</label>
          </div>`).join('')}
          <div class="row"><button type="button" class="btn btn--secondary btn--sm" data-act="posting-add-m">Add a material</button></div>
        </div></div>

      ${actionBar(
        `<button type="button" class="btn btn--primary" data-act="save-posting">Save posting</button>`,
        [
          canPublish && p.readiness.ready
            ? withTip(`<button type="button" class="btn btn--${p.published?'secondary':'primary'}" data-act="publish-posting">${p.published?'Publish changes':'Publish posting'}</button>`,
                p.published ? TIPS.republishPosting : TIPS.publishPosting)
            : '',
          canPublish && p.published && p.state === 'published'
            ? withTip(`<button type="button" class="btn btn--secondary" data-act="posting-state" data-state="paused">Pause applications</button>`, TIPS.pausePosting)
            : '',
          canPublish && p.published && p.state === 'paused'
            ? `<button type="button" class="btn btn--secondary" data-act="posting-state" data-state="published">Accept applications again</button>`
            : '',
          canPublish && p.published && p.state !== 'closed'
            ? withTip(`<button type="button" class="btn btn--ghost" data-act="posting-state" data-state="closed">Close applications</button>`, TIPS.closePosting)
            : '',
          canPublish && p.published && p.state === 'closed'
            ? `<button type="button" class="btn btn--ghost" data-act="posting-state" data-state="published">Reopen applications</button>`
            : ''
        ].filter(Boolean).join(' '),
        canPublish
          ? 'Saving changes nothing the public can see.'
          : esc(askManager() + ' Publishing, pausing, and closing the posting are their decisions; prepare and preview it here.'),
        'Not saved yet.')}
    </div></div>`);
}

/**
 * What this deployment can honestly offer an applicant.
 *
 * Shown before publishing rather than discovered by the first person who tries
 * to apply. Without a mail provider there is no way to verify an address, so
 * there is no application flow at all — and saying that here is the difference
 * between a posting that tells people how to reach the firm and one that
 * collects an address and goes quiet.
 */
function postingCapabilityNotice(caps){
  if (!caps.mail) return '';
  const rows = [];
  if (!caps.mail.configured) {
    rows.push('<b>Online applications are not available on this service.</b> No mail provider is configured, so an applicant cannot verify an address or return to a saved application. The job page will be published as a readable advertisement with your support contact, and will not offer an application form.');
  }
  if (caps.files && !caps.files.uploads) {
    rows.push('<b>File uploads are switched off.</b> Applicants cannot attach materials here. Say in “How to apply” where to send them.');
  } else if (caps.files && !caps.files.scans) {
    rows.push('<b>No virus scanner is configured.</b> Uploaded materials are stored and will not be openable by reviewers. Nothing is lost, but nobody can read it until a scanner is in place.');
  }
  if (!rows.length) return '';
  return `<div class="notice notice--wait" role="status"><div>
    <div class="notice__t">What this service can do for applicants today</div>
    <div class="notice__b">${rows.map(r => `<p>${r}</p>`).join('')}</div>
  </div></div>`;
}

/* ===========================================================================
 * Applications from the public portal
 *
 * Only submitted applications appear here. A draft somebody is still writing
 * is not an application: it is not in this list, not in the committee's
 * candidate list, and not in any export.
 * ========================================================================= */

function vApplications(){
  const data = state.applicationList;
  if (!data) return shell(`${head('Candidates','New applications','Loading.')}`);
  const rows = data.applications || [];
  const open = state.application;

  if (open) return vApplication(open);

  return shell(`
    ${head('Candidates', 'New applications',
      'Applications submitted through the public job page. Reading one does not tell the applicant anything; '
      + 'they see only their own receipt.')}
    <div class="band"><div class="wrap stack">
      ${!data.posting.published ? `<div class="notice notice--info" role="status"><div>
        <div class="notice__t">This search is not advertised publicly</div>
        <div class="notice__b">Nothing arrives here until a posting is published.
          <button class="btn btn--secondary btn--sm" data-go="posting">Open Public posting</button></div>
      </div></div>` : ''}

      ${rows.length ? `<div class="tablewrap"><table class="candtable">
        <thead><tr>
          <th scope="col">Applicant</th><th scope="col">Submitted</th>
          <th scope="col">Materials</th><th scope="col">State</th><th scope="col">Actions</th>
        </tr></thead>
        <tbody>${rows.map(a => `<tr>
          <th scope="row"><span class="candname">${esc(a.name)}</span>
            <span class="candmeta">${esc(a.email)}${a.location?' · '+esc(a.location):''}</span>
            <span class="candmeta mono">${esc(a.reference)}</span></th>
          <td data-label="Submitted">${esc(String(a.submittedAt).slice(0,10))}
            ${a.corrections?`<span class="candmeta">Version ${esc(a.version)} after a correction</span>`:''}</td>
          <td data-label="Materials">${a.materials || 0}
            ${a.outstanding.length?`<span class="candmeta">Outstanding: ${esc(a.outstanding.join(', '))}</span>`:''}</td>
          <td data-label="State">${a.accepted
            ? pill('ok','On the candidate list')
            : a.possibleMatches.length ? pill('wait','Possible duplicate') : pill('wait','Not reviewed')}</td>
          <td data-label="Actions" class="candacts">
            <button class="btn btn--secondary btn--sm" data-act="open-application" data-aid="${esc(a.id)}">Open</button>
          </td>
        </tr>`).join('')}</tbody>
      </table></div>`
      : emptyState('No applications yet',
        data.posting.accepting
          ? 'Applications submitted through the public job page arrive here. Nothing else does: a draft somebody has saved but not sent is not an application and is not shown.'
          : 'This posting is not accepting applications at the moment.',
        `<button class="btn btn--secondary" data-go="posting">Open Public posting</button>`)}

      ${rows.length ? `<p class="t-small">${esc(data.counts.awaiting)} of ${esc(data.counts.submitted)} not yet on the candidate list.</p>` : ''}
    </div></div>`);
}

function vApplication(a){
  const back = `<button type="button" class="btn btn--secondary btn--sm" data-act="close-application">Back to applications</button>`;
  return shell(`
    ${head('New applications', a.name,
      // Named as UTC, because a consultant deciding whether this arrived
      // before a Phoenix closing date needs to know which clock they are
      // reading. The applicant's own copy is converted into the posting's
      // timezone; this one is the stored instant, and says so.
      'Submitted ' + esc(String(a.submittedAt).replace('T',' ').slice(0,16)) + ' UTC'
      + ' · reference <span class="mono">' + esc(a.reference) + '</span> · source ' + esc(a.source), back)}
    <div class="band"><div class="wrap stack">
      ${a.possibleMatches.length && !a.accepted ? `<div class="notice notice--wait" role="alert"><div>
        <div class="notice__t">This may be somebody already on this search</div>
        <div class="notice__b">
          <p>Matched on ${esc(a.possibleMatches.map(m => m.on).join(' and '))}: ${esc(a.possibleMatches.map(m => m.name).join(', '))}.</p>
          <p>Nothing has been merged and nothing has been revealed to the applicant. Read both records and decide.
             Two people can share an address, and an address is not proof of identity.</p>
        </div></div></div>` : ''}

      ${a.accepted ? `<div class="notice notice--ok" role="status"><div>
        <div class="notice__t">On the candidate list since ${esc(String(a.acceptedAt).slice(0,10))}</div>
        <div class="notice__b">From here they are an ordinary candidate.
          <button class="btn btn--secondary btn--sm" data-go="person" data-cid="${esc(a.candidateId)}">Open the candidate</button></div>
      </div></div>` : ''}

      <div class="spec"><div class="spec__bar">Contact</div><div class="spec__body">
        <dl class="kv">
          <dt>Email</dt><dd>${esc(a.email)}</dd>
          ${a.phone?`<dt>Phone</dt><dd>${esc(a.phone)}</dd>`:''}
          ${a.location?`<dt>Based in</dt><dd>${esc(a.location)}</dd>`:''}
        </dl></div></div>

      ${a.background ? `<div class="spec"><div class="spec__bar">Relevant background</div>
        <div class="spec__body"><p class="u-wrap-any">${esc(a.background).replace(/\n/g,'<br>')}</p></div></div>` : ''}

      ${a.form.questions.length ? `<div class="spec"><div class="spec__bar">Answers</div><div class="spec__body stack stack--tight">
        ${a.form.questions.map(q => `<div class="q">
          <div class="q__hd"><span class="q__t">${esc(q.prompt)}</span></div>
          <div class="q__bd"><p class="u-wrap-any">${esc(a.responses[q.key] || '').replace(/\n/g,'<br>') || '<span class="t-small">Not answered</span>'}</p></div>
        </div>`).join('')}
      </div></div>` : ''}

      <div class="spec"><div class="spec__bar">Materials</div><div class="spec__body">
        ${a.documents.length ? `<div class="tablewrap"><table class="candtable">
          <thead><tr><th scope="col">File</th><th scope="col">Received</th><th scope="col">State</th><th scope="col">Open</th></tr></thead>
          <tbody>${a.documents.map(d => `<tr>
            <th scope="row">${esc(d.label)}<span class="candmeta">${Math.round(d.bytes/1024)} KB</span></th>
            <td data-label="Received">${esc(String(d.uploadedAt).slice(0,10))}</td>
            <td data-label="State">${d.available?pill('ok','Available'):pill('wait','Not available')}
              <span class="candmeta">${esc(d.note)}</span></td>
            <td data-label="Open" class="candacts">${d.available
              ? withTip(`<button type="button" class="btn btn--secondary btn--sm" data-act="download-material" data-aid="${esc(a.id)}" data-fid="${esc(d.id)}" data-label="${esc(d.label)}">Download</button>`, TIPS.applicationFile)
              : '<span class="t-small">Not openable</span>'}</td>
          </tr>`).join('')}</tbody></table></div>`
        : '<p class="t-small">No materials were attached.</p>'}
      </div></div>

      ${a.history.length ? `<div class="spec"><div class="spec__bar">Earlier versions</div><div class="spec__body">
        ${a.history.map(h => `<p class="t-small">Version submitted ${esc(String(h.submittedAt).slice(0,16).replace('T',' '))} (${esc(h.reference)}), reopened ${esc(String(h.at).slice(0,10))} by ${esc(h.byName||'a consultant')}: ${esc(h.reason)}</p>`).join('')}
      </div></div>` : ''}

      ${actionBar(
        a.accepted ? '' : withTip(`<button type="button" class="btn btn--primary" data-act="accept-application" data-aid="${esc(a.id)}">Accept onto the candidate list</button>`, TIPS.acceptApplication),
        a.accepted ? '' : withTip(`<button type="button" class="btn btn--secondary" data-act="reopen-application" data-aid="${esc(a.id)}">Let them correct it</button>`, TIPS.reopenApplication),
        a.accepted
          ? 'This application is on the candidate list. Corrections are made on the candidate record now.'
          : 'Accepting adds them to the candidate list. The applicant is not notified by it, and their receipt does not change.')}
    </div></div>`);
}

/* ===========================================================================
 * Help and the user guide
 *
 * The content lives in content/help and is rendered by public/help.js, which
 * the candidate portal loads too. This file only supplies the entry points:
 * the screen, the navigation link, and the per-screen drawer.
 * ========================================================================= */

async function loadHelp(){
  state.helpError = null;
  try { await window.SlateHelp.load(); }
  catch (error) { state.helpError = error.message; }
}

/**
 * Put "Help with this page" on the screen once the guide has arrived.
 *
 * Deliberately not a re-render. The catalog is fetched in the background at
 * boot, and `paint()` rebuilds the page from state — so a consultant who
 * started typing into Search facts before the request came back would have
 * lost it the moment it did. Nothing about this application's forms holds an
 * unsaved value anywhere but the DOM, which makes an unrequested render a way
 * to destroy work.
 *
 * So the control is inserted into the page that is already there. Idempotent,
 * and a no-op on a screen the guide has no article for.
 */
function paintHelpControl(){
  const row = $('.pagehead__row');
  if (!row || $('[data-act="help-page"]')) return;
  const markup = helpControl();
  if (!markup) return;
  let slot = row.querySelector(':scope > .pagehead__act');
  if (!slot){
    slot = document.createElement('div');
    slot.className = 'pagehead__act';
    row.appendChild(slot);
  }
  slot.insertAdjacentHTML('beforeend', markup);
}

function vHelp(){
  return shell(`
    ${head('Workspace', 'Help & user guide',
      'Task-by-task instructions for Slate, written against this build. Supported work pages have a '
      + '<b>Help with this page</b> control that opens the relevant article beside your work.')}
    <div class="band"><div class="wrap stack">
      ${state.search && checklistDismissed() ? `<div class="notice notice--info" role="status"><div>
        <div class="notice__t">The getting-started checklist is hidden on ${esc(state.search.client || 'this search')}</div>
        <div class="notice__b">It lists what is outstanding for you on that search.
          <button type="button" class="btn btn--secondary btn--sm" data-act="restore-checklist">Show it again</button></div>
      </div></div>` : ''}
      ${window.SlateHelp.pageHtml({
        role: state.helpRole,
        query: state.helpQuery,
        articleId: state.helpArticle
      })}
    </div></div>`);
}

async function loadTeam(){
  state.teamError = null;
  try { state.team = await api('/api/organization/members'); }
  catch (error) { state.team = null; state.teamError = error.message; throw error; }
}

function roleChoices(selected){
  return Object.entries(ROLE_LABEL).map(([id, label]) =>
    `<option value="${esc(id)}" ${id===selected?'selected':''}>${esc(label)}</option>`).join('');
}

function vTeamAccess(){
  const team = state.team;
  const sel = state.tab?.access || 'members';
  const draft = state.inviteDraft || {};

  const rows = (team?.members || []).map(m => `<tr>
    <th scope="row">${esc(m.name)}${m.you?' <span class="t-small">(you)</span>':''}
      <span class="candmeta">${esc(m.email)}</span></th>
    <td data-label="Role in this workspace">${m.supported
      ? `<select class="input" data-act="set-role" data-member="${esc(m.clerkUserId)}" data-nodirty aria-label="Role for ${esc(m.name)}" ${m.you?'disabled':''}>${roleChoices(m.role)}</select>`
      : `${pill('wait','Role not mapped')}<span class="candmeta mono">${esc(m.role)}</span>`}</td>
    <td data-label="Searches">${m.searches ? m.searches + (m.searches===1?' search':' searches') : '<span class="t-small">None</span>'}</td>
    <td data-label="Remove" class="candacts">${m.you
      ? '<span class="t-small">Ask another administrator</span>'
      : `<button class="btn btn--ghost btn--sm" data-act="remove-member" data-member="${esc(m.clerkUserId)}" data-name="${esc(m.name)}" data-searches="${m.searches}">Remove</button>`}</td>
  </tr>`).join('');

  const invites = (team?.invitations || []).map(i => `<tr>
    <th scope="row">${esc(i.email)}${i.heldPlaces ? `<span class="candmeta">${i.heldPlaces} search place${i.heldPlaces===1?'':'s'} held for them</span>` : ''}</th>
    <td data-label="Invited as">${esc(i.roleLabel || i.role)}</td>
    <td data-label="Status">${pill('wait','Invitation sent')}${i.expiresAt?`<span class="candmeta">Expires ${esc(String(i.expiresAt).slice(0,10))}</span>`:''}</td>
    <td data-label="Revoke" class="candacts"><button class="btn btn--ghost btn--sm" data-act="revoke-invite" data-invite="${esc(i.id)}" data-email="${esc(i.email)}">Revoke</button></td>
  </tr>`).join('');

  const panel = (key, body) => `<div data-tabpanel="access:${key}" role="tabpanel" id="panel-access-${key}" aria-labelledby="tab-access-${key}" tabindex="0" class="stack"${sel===key?'':' hidden'}>${body}</div>`;

  return shell(`
    ${head('Workspace', 'Team & access',
      'Who is in ' + esc(orgName()) + ', and what they may do here. Membership opens the workspace; an account manager still adds people to individual searches.')}
    <div class="band"><div class="wrap stack">
      ${state.teamError ? `<div class="notice notice--wait" role="alert"><div>
        <div class="notice__t">This list could not be loaded</div>
        <div class="notice__b">${esc(state.teamError)}
          <button class="btn btn--secondary btn--sm" data-act="reload-team">Try again</button></div></div></div>` : ''}
      ${state.orgError ? `<div class="notice notice--stop" role="alert"><div><div class="notice__b">${esc(state.orgError)}</div></div></div>` : ''}
      ${state.orgNotice ? `<div class="notice notice--ok" role="status"><div><div class="notice__b">${esc(state.orgNotice)}</div></div></div>` : ''}
      ${secTabs('access', [
        { key:'members', label:'Members' + (team ? ' (' + team.members.length + ')' : '') },
        { key:'invitations', label:'Invitations' + (team ? ' (' + team.invitations.length + ')' : '') }
      ])}
      ${panel('members', `
        ${rows ? `<div class="tablewrap"><table class="candtable">
          <thead><tr><th scope="col">Person</th><th scope="col">Role in this workspace</th><th scope="col">Searches</th><th scope="col">Remove</th></tr></thead>
          <tbody>${rows}</tbody></table></div>`
        : emptyState('Nobody else is here yet','Invite a colleague from the Invitations tab. They join this workspace with the role you give them.')}
        <p class="t-small">A role change takes effect on that person\u2019s next request. Removing somebody ends their access to every search in this workspace and releases their places on searches; their scores, notes, and history stay on the record under their name. Somebody who manages a search hands it over first.</p>`)}
      ${panel('invitations', `
        <form id="inviteform" class="stack stack--tight">
          <h2 class="t-section">Invite someone to ${esc(orgName())}</h2>
          <div class="row">
            <label class="stack stack--tight" for="invite-email"><span>Email</span>
              <input class="input" id="invite-email" name="email" type="email" required placeholder="name@firm.example" value="${esc(draft.email || '')}"></label>
            <label class="stack stack--tight" for="invite-role"><span>Role in this workspace</span>
              <select class="input" id="invite-role" name="role" required>${roleChoices(draft.role || 'org:committee')}</select></label>
          </div>
          <p class="t-small">Send invitation emails this address through Clerk. They join with the role you choose here and cannot pick a different one. A committee member reads and scores only the searches they are on.</p>
          <div class="row"><button class="btn btn--primary" type="submit" ${state.orgBusy?'disabled':''}>${state.orgBusy?'Sending…':'Send invitation'}</button></div>
        </form>
        ${invites ? `<div class="tablewrap"><table class="candtable">
          <thead><tr><th scope="col">Email</th><th scope="col">Invited as</th><th scope="col">Status</th><th scope="col">Revoke</th></tr></thead>
          <tbody>${invites}</tbody></table></div>`
        : emptyState('No invitations are waiting','An invitation appears here until the person accepts it or you revoke it.')}
        <p class="t-small">A pending invitation is not membership. Revoking one does not remove anybody who has already accepted, and it does not release a place held for that address on a search.</p>`)}
    </div></div>`);
}

/**
 * Which screen this is.
 *
 * The onboarding stages come first and in order, because each one is a
 * different reason the workspace is not open and each needs its own answer.
 * Nothing below them renders until somebody has somewhere to work.
 */
function page(){
  if (location.pathname.startsWith('/apply/')) return vApply();
  if (window.SlateAuth.pendingTask || state.authTaskPending) return vSessionTask();
  if (isInvitationPage()) return vInvitation();
  if (location.pathname === '/pricing' || location.pathname === '/subscriptions') return vPricing();
  if (location.pathname === '/how-it-works' || (location.pathname === '/' && !location.hash && !state.user)) return vGate();
  if (!state.user) return vGate();
  if (state.myAccess) return vMyAccess();
  if (state.onboarding?.required || state.editAccountSetup) return vOnboarding();
  if (state.chooseWorkspace) return vWorkspaceChooser();
  switch (state.onboarding?.stage){
    case 'candidate': return vCandidateStart();
    case 'membership-lost': return vMembershipLost();
    case 'workspace': return vWorkspaceChooser();
    case 'role-pending': return vRolePending();
    case 'assignment-pending': return vAssignmentPending();
  }
  if (state.view === 'help') return vHelp();
  if (state.view === 'team-access') return vTeamAccess();
  if (state.view === 'billing') return vProjectBilling();
  if (state.view === 'posting') return vPosting();
  if (state.view === 'applications') return vApplications();
  if (state.view === 'community') return vCommunity();
  if (state.view === 'brochure') return vBrochure();
  if (STAFF[state.view]) return vStaff(state.view);
  if (['survey1','survey2','guide'].includes(state.view) && isStaff()) return vQuestions();
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
  // A rating button, in intake and in the profile editor. Rating a priority
  // redraws the row, and the keyboard has to stay on the scale it was using
  // rather than being dropped at the top of the form.
  for (const attr of ['iw', 'w']) {
    if (row && el.dataset[attr]) return '[data-row="'+row.dataset.row+'"] [data-'+attr+'="'+el.dataset[attr]+'"]';
  }
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
  // Stamped with the navigation that was running when this was opened, so the
  // screen change that eventually lands can tell "the user opened me before
  // asking for this screen" from "the user opened me while it was loading".
  if (state.navOpen) state.navOpenedDuring = navSeq;
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

function setPublicNav(open){
  state.publicNavOpen = Boolean(open);
  const nav = $('#public-nav');
  const menu = $('[data-act="public-nav-toggle"]');
  if (!nav || !menu) return;
  nav.hidden = !state.publicNavOpen;
  $('.public-nav-scrim').hidden = !state.publicNavOpen;
  menu.setAttribute('aria-expanded', String(state.publicNavOpen));
  if (state.publicNavOpen) nav.querySelector('a, button')?.focus();
  else menu.focus();
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
  if (state.publicNavOpen && e.key === 'Tab') {
    const items = [...$$('#public-nav a, #public-nav button')].filter(el => !el.disabled);
    if (items.length) {
      const at = items.indexOf(document.activeElement);
      if (e.shiftKey && at <= 0) { e.preventDefault(); items.at(-1).focus(); }
      else if (!e.shiftKey && at === items.length - 1) { e.preventDefault(); items[0].focus(); }
    }
  }
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
  // A wait that can be cancelled is cancellable from the keyboard too. Only
  // when there is a cancel action: Escape must not appear to dismiss a save
  // that is still going to happen.
  if (showWait._cancel && !$('#lookup')?.hidden){
    e.preventDefault();
    e.stopPropagation();
    showWait._cancel();
    return;
  }
  // Escape dismisses the description without activating anything.
  if (tipOpen){ hideTip(); e.stopPropagation(); return; }
  if (state.publicNavOpen) { setPublicNav(false); return; }
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

/**
 * Ask the server what adopting would do, without doing it.
 *
 * The retain decisions are the manager's and are remembered here; everything
 * else in the plan — including which items the cap excludes once an item is
 * retained — is the server's answer, so the panel always shows the profile
 * that would actually be saved.
 */
async function refreshAdoptPlan(){
  const keepRetain = state.adoptPlan?.retain || [];
  const keepReasons = state.adoptPlan?.retainReasons || {};
  const selectedKeys = state.search.intake?.questionnaireVersion ? [...favoritesFor(state.search.consensus)] : undefined;
  await withBusy(async () => {
    const plan = await api('/api/searches/'+state.search.id+'/intake/adopt', {
      method:'POST', body:{ preview:true, retain: keepRetain, selectedKeys }
    });
    plan.retain = keepRetain;
    plan.retainReasons = keepReasons;
    plan.selectedKeys = selectedKeys;
    state.adoptPlan = plan;
  }, waitSave('Working out what would change'));
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
    state.adoptPlan = null;
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
  if (e.target.dataset.retain && state.adoptPlan){
    // Keeping an unsupported criterion is a decision. Ticking it re-asks the
    // server what the profile would then look like, so the panel always shows
    // the proposal that would actually be saved.
    const id = e.target.dataset.retain;
    const next = new Set(state.adoptPlan.retain || []);
    if (e.target.checked) next.add(id); else next.delete(id);
    state.adoptPlan.retain = [...next];
    $$('[data-retain-reason]').forEach(el => {
      state.adoptPlan.retainReasons = { ...(state.adoptPlan.retainReasons||{}), [el.dataset.retainReason]: el.value };
    });
    refreshAdoptPlan();
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

/* --- the user guide ------------------------------------------------------
 *
 * Handled ahead of everything else and outside the application's own render,
 * because the whole promise of this control is that reading the instructions
 * costs nothing: no navigation, no re-render, no lost form. The only branch
 * that redraws the page is the one for the full help screen, which has no form
 * on it to lose.
 * ------------------------------------------------------------------------ */
document.addEventListener('click', async e => {
  const help = e.target.closest('[data-act="help-page"],[data-help-article],[data-help-role],[data-help-print],[data-help-retry]');
  if (!help) return;

  if (help.dataset.act === 'help-page'){
    await window.SlateHelp.openDrawer({ screen: help.dataset.screen, trigger: help });
    return;
  }
  if (help.hasAttribute('data-help-retry')){
    await loadHelp();
    render();
    return;
  }
  if (help.hasAttribute('data-help-print')){
    window.SlateHelp.print({ role: state.helpRole });
    return;
  }
  if (help.hasAttribute('data-help-role')){
    state.helpRole = help.dataset.helpRole || null;
    render();
    return;
  }
  // An article link. On the help screen it opens the article in the reading
  // pane; anywhere else — inside the drawer, from a glossary term — the drawer
  // handles it itself and this never sees it.
  if (help.dataset.helpArticle && state.view === 'help'){
    state.helpArticle = help.dataset.helpArticle;
    render();
    $('#help-article-' + CSS.escape(state.helpArticle))?.scrollIntoView({ block: 'start' });
    $('.help__reading')?.focus?.();
  }
});

// Searching the guide. Debounced against the render so the caret is not chased
// around the field while somebody types.
let helpFindTimer = null;
document.addEventListener('input', e => {
  const field = e.target.closest('[data-help-search]');
  if (!field) return;
  clearTimeout(helpFindTimer);
  helpFindTimer = setTimeout(() => {
    state.helpQuery = field.value;
    render();
    $('#help-search')?.focus();
  }, 220);
});

// "Open the full guide" from inside the drawer.
window.addEventListener('slate:help-open-guide', () => { go('help'); });

document.addEventListener('click', async e => {
  closeMenusExcept(e.target);
  const t = e.target.closest('[data-go],[data-open],[data-act],[data-add],[data-del],[data-w],button[data-theme],[data-cand],[data-score],[data-pick],[data-ipick],[data-iadd],[data-idel],[data-iw],[data-phase],[data-panel],[data-personadd],[data-persondel],[data-mode],[data-artadd],[data-artdel],[data-tab],[data-col]');
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
    try { captureQuestionEdits(); draft = collectArtifact(kind); }
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
    captureQuestionEdits();
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
    if (state.search && state.search.id === id) go(t.dataset.answer ? 'intake-mine' : 'overview', {}, { fresh:true });
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
  if (t.dataset.personadd){
    collectPeople();
    peopleDraft().push(blankPerson());
    render();
    // Land the caret in the row just created rather than making them find it.
    const rows = $('#newpeople [data-row]');
    rows[rows.length - 1]?.querySelector('[data-f="name"]')?.focus();
    return;
  }
  if (t.dataset.persondel){
    collectPeople();
    peopleDraft().splice(Number(t.dataset.persondel), 1);
    if (!state.newPeople.length) state.newPeople = [blankPerson()];
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
    state.dirty = true;
    const d = collectIntakeText();
    const kind = t.dataset.ipick;
    const label = t.dataset.label;
    const i = d.items.findIndex(x => x.kind===kind && String(x.label||'').trim().toLowerCase()===label.toLowerCase());
    if (i >= 0) d.items.splice(i, 1);
    else d.items.push({ kind, label, weight:3, note:'' });
    render(); return;
  }
  if (t.dataset.iadd){
    state.dirty = true;
    const d = collectIntakeText();
    d.items.push({ kind:t.dataset.iadd, label:'', weight:3, note:'' });
    render(); return;
  }
  if (t.dataset.idel){
    state.dirty = true;
    const d = collectIntakeText();
    d.items.splice(Number(t.dataset.idel), 1);
    render(); return;
  }
  if (t.dataset.iw){
    state.dirty = true;
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
  if (act === 'public-nav-toggle') { setPublicNav(!state.publicNavOpen); return; }
  if (act === 'public-nav-close') { setPublicNav(false); return; }
  if (act === 'project-checkout') {
    await withBusy(async () => {
      const p = await api('/api/searches/'+state.search.id+'/checkout', { method:'POST', body:{} });
      if (!/^https:\/\/checkout\.stripe\.com\//.test(p.checkoutUrl || '')) throw new Error('Checkout returned an unexpected address.');
      location.assign(p.checkoutUrl);
    });
    return;
  }
  if (act === 'project-reconcile') {
    await withBusy(async () => {
      await api('/api/searches/'+state.search.id+'/payment/reconcile', { method:'POST', body:{} });
      await loadSearch(state.search.id);
    });
    render(); return;
  }
  // Handled by the guide's own listener above, which deliberately does not
  // re-render the page.
  if (act==='help-page') return;
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
  if (act==='rail-toggle'){
    state.desktopRailClosed = !state.desktopRailClosed;
    localStorage.setItem('slate-rail-closed', state.desktopRailClosed ? '1' : '0');
    $('.shell')?.classList.toggle('shell--railclosed', state.desktopRailClosed);
    $$('[data-act="rail-toggle"]').forEach(button => {
      button.setAttribute('aria-expanded', String(!state.desktopRailClosed));
      button.textContent = state.desktopRailClosed ? 'Show menu' : 'Hide menu';
    });
    return;
  }
  if (act==='slate-home'){
    e.preventDefault();
    if (state.dirty && !confirm('Leave this page and discard unsaved edits?')) return;
    location.assign('/'); return;
  }
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
  if (act==='retry-search-refresh') {
    if (state.dirty && !confirm('Discard unsaved edits and load the latest search?')) return;
    state.dirty = false;
    await withBusy(async () => {
      if (!(await refreshOpenSearch())) toast('The search still could not be refreshed. Try again shortly.');
    }, false);
    return;
  }
  if (act==='check-intake') {
    if (state.dirty) { toast('Save or finish your edits before checking for a new questionnaire status.'); return; }
    const ticket = navSeq;
    await withBusy(async () => {
      const updated = await refreshOpenSearch(() => ticket !== navSeq);
      if (updated) toast('Questionnaire status checked.');
      else toast('The latest status could not be shown. Try again.');
    }, false);
    return;
  }
  if (act==='reload-search') {
    if (state.dirty && !confirm('Discard unsaved edits and load the latest search?')) return;
    await withBusy(() => loadSearch(state.search.id));
    return;
  }
  if (act==='dismiss-checklist'){
    setChecklistDismissed(true);
    render();
    toast('Hidden for this search. Reopen it from Help & user guide.');
    return;
  }
  if (act==='restore-checklist'){
    setChecklistDismissed(false);
    toast('The getting-started checklist is back on this search.');
    render();
    return;
  }

  /* --- the public posting ------------------------------------------------ */

  if (act==='posting-add-q' || act==='posting-drop-q' || act==='posting-add-m' || act==='posting-drop-m'){
    // Read the form first, so adding or removing a row never costs somebody a
    // paragraph they typed into the row above it.
    const draft = collectPosting();
    if (act==='posting-add-q') draft.questions.push({ prompt:'', help:'', required:false });
    if (act==='posting-drop-q') draft.questions.splice(Number(t.dataset.i), 1);
    if (act==='posting-add-m') draft.materials.push({ label:'', note:'', required:false });
    if (act==='posting-drop-m') draft.materials.splice(Number(t.dataset.i), 1);
    state.postingDraft = draft;
    state.dirty = true;
    render();
    return;
  }
  if (act==='save-posting'){
    await withBusy(async () => {
      state.posting = await api('/api/searches/'+state.search.id+'/posting',
        { method:'PUT', body: collectPosting() });
      state.postingDraft = null;
      state.dirty = false;
      toast('Posting saved. Nothing the public sees has changed.');
    }, waitSave('Saving the posting'));
    render();
    return;
  }
  if (act==='publish-posting'){
    const p = state.posting;
    const first = !p.published;
    const question = first
      ? 'Publish this job page? Anyone with its address will be able to read it, and applications can be submitted to this search.'
      : 'Replace the live job page with what you have saved? Applicants reading it will see the new version.';
    if (!confirm(question)) return;
    await withBusy(async () => {
      state.posting = await api('/api/searches/'+state.search.id+'/posting/publish', { method:'POST' });
      state.search = await api('/api/searches/'+state.search.id);
      toast(first ? 'Published. The address is on this screen.' : 'The live page now shows your changes.');
    }, waitSave('Publishing the posting'));
    render();
    return;
  }
  if (act==='posting-state'){
    const next = t.dataset.state;
    const ask = {
      paused:'Pause applications? The job page stays readable and says it is not accepting applications right now.',
      closed:'Close this posting to new applications? The search stays open and you keep working the applicants you have.',
      published:'Accept applications again on this posting?'
    }[next];
    if (ask && !confirm(ask)) return;
    await withBusy(async () => {
      state.posting = await api('/api/searches/'+state.search.id+'/posting/state', { method:'POST', body:{ state: next } });
      state.search = await api('/api/searches/'+state.search.id);
    }, waitSave('Updating the posting'));
    render();
    return;
  }

  /* --- applications from the portal --------------------------------------- */

  if (act==='open-application'){
    await withBusy(async () => {
      state.application = await api('/api/searches/'+state.search.id+'/applications/'+t.dataset.aid);
    }, false);
    render();
    window.scrollTo({ top:0, behavior:'instant' });
    return;
  }
  if (act==='close-application'){
    state.application = null;
    render();
    return;
  }
  if (act==='accept-application'){
    const application = state.application;
    const duplicate = application?.possibleMatches?.length;
    if (duplicate && !confirm('Slate found ' + duplicate + ' candidate' + (duplicate===1?'':'s')
      + ' on this search who might be the same person. Add this applicant as a separate candidate anyway?')) return;
    await withBusy(async () => {
      const out = await api('/api/searches/'+state.search.id+'/applications/'+t.dataset.aid+'/accept',
        { method:'POST', body:{ reconciled: Boolean(duplicate) } });
      state.search = out.search;
      state.applicationList = await api('/api/searches/'+state.search.id+'/applications');
      state.application = await api('/api/searches/'+state.search.id+'/applications/'+t.dataset.aid);
      toast('Added to the candidate list.');
    }, waitSave('Adding the candidate'));
    render();
    return;
  }
  if (act==='reopen-application'){
    const reason = prompt('Why is this application being reopened? The applicant sees this, and it stays on the record.');
    if (!reason || !reason.trim()) return;
    await withBusy(async () => {
      await api('/api/searches/'+state.search.id+'/applications/'+t.dataset.aid+'/reopen',
        { method:'POST', body:{ reason } });
      state.applicationList = await api('/api/searches/'+state.search.id+'/applications');
      state.application = null;
      toast('Reopened. Their submission is kept, and they can send a correction.');
    }, waitSave('Reopening the application'));
    render();
    return;
  }
  if (act==='download-material'){
    // An authorized GET, so it cannot be a plain link: the session token lives
    // in memory and a browser navigation would not carry it. Same reason as
    // the export below.
    await withBusy(async () => {
      const token = await window.SlateAuth.token();
      const res = await fetch('/api/searches/'+state.search.id+'/applications/'
        + encodeURIComponent(t.dataset.aid)+'/files/'+encodeURIComponent(t.dataset.fid),
        { headers: token ? { authorization:'Bearer ' + token } : {} });
      if (!res.ok){
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.error || 'That file could not be opened.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = t.dataset.label || 'document.pdf';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }, false);
    return;
  }
  if (act==='export-record') {
    // The export is an authorized GET, so it cannot be a plain link: the bearer
    // token lives in memory and a browser navigation would not carry it. Fetch
    // it with the session, then hand the bytes to the person as a file.
    const format = t.dataset.format === 'json' ? 'json' : 'text';
    await withBusy(async () => {
      const token = await window.SlateAuth.token();
      const res = await fetch('/api/searches/'+state.search.id+'/export'+(format==='text'?'?format=text':''),
        { headers: token ? { authorization:'Bearer ' + token } : {} });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.error || 'The export could not be prepared.');
      }
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'slate-' + (state.search.no || state.search.id) + (format==='text' ? '.txt' : '.json');
      document.body.append(link);
      link.click();
      link.remove();
      // Revoked on a later turn: revoking it in this one races the download the
      // click has only just started.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      // Exporting is recorded on the file, so the view behind this reads as
      // stale until it is reloaded.
      await loadSearch(state.search.id);
      toast('Export downloaded. It is recorded on the activity feed.');
    }, {
      kicker: 'Slate', title: 'Preparing the record',
      copy: 'Gathering the whole search. Stay on this page.',
      steps: ['Assembling the record', 'Preparing the download'], tick: 2000
    });
    return;
  }
  if (act==='restore-search') {
    await withBusy(async () => {
      state.search = await api('/api/archives/'+t.dataset.id+'/restore', { method:'POST', body:{} });
      await loadSearches();
      toast('Search restored. Candidate links remain revoked; reissue a link separately if needed.');
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
    } else if (!confirm('Replace this candidate link?\n\nThe old link stops working immediately. Anything the candidate has already submitted is kept, but a draft they have not sent is reachable only from the link you are about to revoke. You will need to share the new link with them yourself.')) return;
    await withBusy(async () => {
      state.search = await api('/api/searches/'+state.search.id+'/candidates/'+t.dataset.cid+'/'+(act==='reopen-survey'?'reopen':'invite'), { method:'POST', body:{ which:t.dataset.which, reason } });
      toast('Copy the new link below and share it with the candidate.');
    });
    return;
  }
  if (act==='edit-account-setup') {
    if (state.dirty && !confirm('Leave this page and discard unsaved edits?')) return;
    state.dirty = false;
    state.onboardingDraft = null; state.onboardingError = null;
    state.myAccess = false; state.editAccountSetup = true; render();
    $('#main')?.focus(); return;
  }
  if (act==='cancel-account-setup') {
    state.editAccountSetup = false; state.onboardingDraft = null; state.onboardingError = null;
    state.dirty = false; render(); return;
  }
  if (act==='check-account-access') {
    if (state.onboardingSaving) return;
    state.onboardingSaving = true;
    try {
      const blockedBefore = state.onboarding?.stage;
      state.onboardingError = null;
      if (!await loadMe()) { state.onboardingError = state.authError || 'We could not read your account.'; }
      else if (state.onboarding?.blocked) {
        // Naming the specific wall is the point: "no access" covers four
        // situations, and the person needs to know which one is theirs.
        state.onboardingError = state.onboarding.stage === blockedBefore
          ? ({
              workspace: 'You are still not in a workspace. An administrator has to invite ' + state.user.email + '.',
              'role-pending': 'Your role here still does not open search records. An administrator sets it in Team & access.',
              'assignment-pending': 'No search has been assigned to you yet. Your search consultant adds you to one.',
              'membership-lost': 'Your access to that workspace has not been restored.'
            }[state.onboarding.stage] || 'Nothing has changed yet.')
          : null;
      } else { state.search = null; await go('home'); }
    } catch (error) { state.onboardingError = error.message; }
    finally { state.onboardingSaving = false; render(); }
    return;
  }

  /* --- workspaces --------------------------------------------------------- */

  if (act==='complete-workspace-task') {
    const choice = (state.taskChoices || []).find(w => w.id === t.dataset.org);
    if (!choice) return;
    state.completingTask = true;
    state.orgBusy = true; state.taskChoicesError = null; render();
    try {
      if (choice.accept) await choice.accept();
      await enterWorkspace(choice.id);
      if (state.orgError) state.taskChoicesError = state.orgError;
    } catch (error) { state.taskChoicesError = error.message || 'The workspace could not be opened. Try again.'; }
    finally { state.completingTask = false; state.orgBusy = false; render(); }
    return;
  }

  if (act==='open-workspaces') { state.chooseWorkspace = true; state.orgError = null; render(); $('#main')?.focus(); return; }
  if (act==='my-access') {
    state.myAccess = true; state.navOpen = false; render(); $('#main')?.focus(); return;
  }
  if (act==='close-my-access') { state.myAccess = false; render(); $('#main')?.focus(); return; }

  if (act==='check-invites') {
    state.orgBusy = true; state.invitesError = null; render();
    try {
      state.invites = await window.SlateAuth.invitations();
      if (isInvitationPage()) await loadMe();
    }
    catch (error) { state.invites = null; state.invitesError = error.message || 'Invitations could not be read.'; }
    finally { state.orgBusy = false; render(); }
    return;
  }

  if (act==='accept-invite') {
    const invitation = (state.invites || []).find(i => i.id === t.dataset.invite);
    if (!invitation) return;
    state.orgBusy = true; state.orgError = null; render();
    try {
      await invitation.accept();
      await enterWorkspace(invitation.organizationId);
    } catch (error) {
      // Expired, revoked, or meant for a different address. Say which without
      // describing a workspace this account may have no business knowing about.
      state.orgError = error?.errors?.[0]?.longMessage || error.message
        || 'That invitation could not be accepted. Ask the administrator to send a new one.';
      state.invites = null;
    } finally { state.orgBusy = false; render(); }
    return;
  }

  if (act==='switch-workspace') {
    await enterWorkspace(t.dataset.org);
    return;
  }

  if (act==='follow-link') {
    const link = state.pendingLink;
    if (!link) return;
    await enterWorkspace(link.workspace.id, routeFor(link.view, { orgId:link.workspace.id, searchId:link.searchId, sel:link.sel }));
    return;
  }
  if (act==='dismiss-link') { state.pendingLink = null; render(); return; }

  /* --- team & access ------------------------------------------------------ */

  if (act==='reload-team') {
    state.orgError = null; state.orgNotice = null;
    try { await loadTeam(); } catch { /* loadTeam records the message */ }
    render();
    return;
  }

  if (act==='remove-member') {
    const searches = Number(t.dataset.searches) || 0;
    const warning = 'Remove ' + t.dataset.name + ' from ' + orgName() + '?\n\n'
      + (searches ? 'They lose their ' + searches + ' search assignment' + (searches===1?'':'s') + ' here. ' : '')
      + 'Their scores, notes, and history stay on the record under their name.';
    if (!confirm(warning)) return;
    state.orgBusy = true; state.orgError = null; state.orgNotice = null; render();
    try {
      const out = await api('/api/organization/members/' + encodeURIComponent(t.dataset.member), { method:'DELETE' });
      state.orgNotice = t.dataset.name + ' was removed'
        + (out.releasedPlaces ? ', and released ' + out.releasedPlaces + ' search assignment' + (out.releasedPlaces===1?'':'s') : '') + '.';
      await loadTeam();
    } catch (error) { state.orgError = error.message; }
    finally { state.orgBusy = false; render(); }
    return;
  }

  if (act==='revoke-invite') {
    if (!confirm('Revoke the invitation to ' + t.dataset.email + '?\n\nThey will not be able to join with it. Any place held for that address on a search stays held.')) return;
    state.orgBusy = true; state.orgError = null; state.orgNotice = null; render();
    try {
      await api('/api/organization/invitations/' + encodeURIComponent(t.dataset.invite), { method:'DELETE' });
      state.orgNotice = 'The invitation to ' + t.dataset.email + ' was revoked.';
      await loadTeam();
    } catch (error) { state.orgError = error.message; }
    finally { state.orgBusy = false; render(); }
    return;
  }

  if (act==='release-place') {
    if (!confirm('Release the held place for ' + t.dataset.email + '?\n\nThis does not revoke their invitation to the workspace.')) return;
    await withBusy(async () => {
      const out = await api('/api/searches/'+state.search.id+'/members/pending/'+encodeURIComponent(t.dataset.pending), { method:'DELETE', body:{} });
      state.search = out.search;
      toast('The held place was released.');
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
    if (!c?.invite) { toast('This candidate has no live link. Issue a new link from their record if needed.'); return; }
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
    const shown = (state.searches || []).filter(matchesHomeQuery).filter(s => s.mayArchive);
    const picked = pickedIds();
    const already = shown.length > 0 && shown.every(s => picked.includes(s.id));
    state.picked = already ? [] : shown.map(s => s.id);
    render();
    return;
  }
  if (act==='start-fresh'){
    const managed = (state.searches || []).filter(s => s.searchRole === 'manager');
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
      // Home has no loaded search, but the archive still needs the revision
      // that was shown to the user. Do not silently refresh past newer work.
      const revision = state.search?.id === id ? state.search.revision
        : (state.searches || []).find(s => s.id === id)?.revision;
      if (revision === undefined) throw new Error('Reload the search list before archiving.');
      await api('/api/searches/'+id, { method:'DELETE', body:{}, headers:{ 'if-match':String(revision) } });
      if (state.search && state.search.id===id) state.search = null;
      state.picked = (state.picked||[]).filter(x => x !== id);
      await loadSearches();
      toast('Archived.');
      go('home');
    });
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
      toast('You are on the roster and can contribute your own survey answers.');
    }, waitSave('Joining the search'));
    if (t.dataset.answer && you().member) await go('intake-mine');
    return;
  }
  if (act==='make-manager'){
    const uid = t.dataset.uid;
    const taking = uid === state.user.id;
    if (!may('handoverManager')) return;
    let reason;
    if (!canManage()) {
      reason = prompt('Why are you reassigning this account? The reason is recorded on the search.');
      if (reason === null) return;
      reason = reason.trim();
      if (!reason) { toast('Enter a reason before reassigning the account.'); return; }
    }
    await withBusy(async () => {
      const out = await api('/api/searches/'+state.search.id+'/members/'+uid, { method:'PATCH', body:{ searchRole:'manager', ...(reason ? { reason } : {}) } });
      state.search = out.search;
      toast(taking ? 'You run this search now. The previous manager keeps a consultant role.' : 'Account handed over. You keep a consultant role.');
    }, waitSave(taking ? 'Taking the account' : 'Handing over the account'));
    return;
  }
  if (act==='remove-person'){
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
  if (act==='skip-questionnaire' || act==='include-questionnaire'){
    const enabled = act==='include-questionnaire';
    if (state.dirty && !confirm('Discard unsaved edits on this page and change the questionnaire option? Saved member drafts will be kept.')) return;
    await withBusy(async () => {
      state.search = await api('/api/searches/'+state.search.id+'/intake/participation', {
        method:'PUT', body:{ enabled }
      });
      state.intake = null;
      state.intakeConflict = null;
      toast(enabled ? 'Committee questionnaire included. The account manager or an organization administrator can open the response window.' : 'Committee questionnaire skipped. Continue with the candidate profile.');
    }, waitSave(enabled ? 'Including the questionnaire' : 'Skipping the questionnaire'));
    if (!enabled && state.search.intake?.skipped) await go('profile');
    return;
  }
  if (act==='intake-open' || act==='intake-close'){
    const open = act==='intake-open';
    const form = $('#intakewindow');
    const win = form ? Object.fromEntries(new FormData(form).entries()) : {};
    let emptyReason = '';
    if (!open) {
      const waiting = (state.search.consensus?.pending || []).length;
      if (waiting && !confirm(waiting+' member'+(waiting===1?' has':'s have')+' not answered yet. Close the window anyway?')) return;
      // Finishing with nothing on file is a decision somebody makes and signs,
      // not a step that quietly reports itself complete.
      if (!(state.search.consensus?.submitted)) {
        emptyReason = String(prompt('Nobody submitted committee input. Closing now completes this step without it.\n\nWhy are you completing it without committee input? This is recorded on the search.') || '').trim();
        if (!emptyReason) { toast('Not closed. A reason is needed to complete this step without committee input.'); return; }
      }
    }
    await withBusy(async () => {
      try {
        state.search = await api('/api/searches/'+state.search.id+'/intake/status', {
          method:'POST', body:{ status: open ? 'open' : 'closed', ...win, ...(emptyReason ? { emptyReason } : {}) }
        });
      } catch (err) {
        if (err.code === 'ROSTER_UNCONFIRMED'){ toast(err.message); go('team'); return; }
        throw err;
      }
      toast(open
        ? 'Intake is open. Everyone on the search can answer now.'
        : (emptyReason
          ? 'Completed without committee input. The reason is on the record.'
          : 'Intake closed. Everyone on the search can now read the submitted answers.'));
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
    if (submitted && (state.search.intake.qualities || []).some(q =>
      !items.some(i => i.kind === q.kind && i.label === q.label && Number.isInteger(i.weight) && i.weight >= 1 && i.weight <= 5))) {
      toast('Rate every shared quality from 1 to 5 before submitting.');
      return;
    }
    if (submitted && !items.length){
      toast('Name at least one thing you are looking for.');
      return;
    }
    await withBusy(async () => {
      try {
        state.search = await api('/api/searches/'+state.search.id+'/intake', {
          method:'PUT',
          // This member's own version, not the whole search's. Another member
          // submitting at the same moment is not a conflict with this answer.
          body:{ items, mustHave:d.mustHave, dealBreaker:d.dealBreaker, context:d.context,
            submitted, responseRevision: myResponseRevision() }
        });
      } catch (err) {
        // Keep every local field. The recovery is a choice on the page, not a
        // reload that would throw the typed rows away (CA-12).
        if (err.code === 'STALE_RESPONSE') { state.intakeConflict = err.detail?.response || {}; return; }
        if (err.code === 'RESPONSE_REVISION_REQUIRED' || err.code === 'INTAKE_SHUT') { toast(err.message); return; }
        throw err;
      }
      state.intake = null;
      state.intakeConflict = null;
      toast(submitted
        ? 'Your answers are in. The rest of the committee cannot see them until the window closes.'
        : 'Saved privately. Your submitted answers are unchanged until you choose Update my answers.');
      if (submitted && you().consultant) go('intake');
    }, waitSave(submitted ? 'Submitting your answers' : 'Saving your answers'));
    return;
  }
  if (act==='intake-keep-mine'){
    state.intakeConflict = null;
    toast('Kept. Save or submit again to write this version.');
    render();
    return;
  }
  if (act==='intake-take-theirs'){
    const theirs = state.intakeConflict?.submitted || state.intakeConflict?.draft;
    state.intake = theirs ? {
      items: (theirs.items || []).map(i => ({ ...i })),
      mustHave: theirs.mustHave || '', dealBreaker: theirs.dealBreaker || '', context: theirs.context || ''
    } : null;
    state.intakeConflict = null;
    // The conflicting version is now on the page, and the record it came from
    // is the one this page holds, so the next save has the right precondition.
    await withBusy(async () => { state.search = await api('/api/searches/'+state.search.id); }, waitSave('Loading the other version'));
    toast('Loaded the version saved elsewhere. Edit it and save.');
    return;
  }
  if (act==='withdraw-intake'){
    if (!confirm('Withdraw your answers from the committee tally?\n\nThey come back to you as a private draft, and the counts on any profile already built from them will be marked as describing earlier answers. This is not the same as saving a draft.')) return;
    await withBusy(async () => {
      state.search = await api('/api/searches/'+state.search.id+'/intake/withdraw', { method:'POST', body:{} });
      state.intake = null;
      toast('Withdrawn. Your answers are out of the tally and saved as your own draft.');
    }, waitSave('Withdrawing your answers'));
    return;
  }
  if (act==='profile-favorite'){
    collectCriteria();
    const selected = favoritesFor(state.search.consensus);
    const kind = Object.entries(state.search.consensus.byKind || {}).find(([,rows]) => rows.some(row => row.key === t.dataset.key))?.[0];
    const count = selected.filter(key => (state.search.consensus.byKind?.[kind] || []).some(row => row.key === key)).length;
    if (t.checked && count >= 5) {
      t.checked = false;
      toast('Choose no more than 5 favorites in this category. Remove one before adding another.');
      return;
    }
    state.profileFavorites.keys = t.checked ? [...new Set([...selected, t.dataset.key])] : selected.filter(key => key !== t.dataset.key);
    state.adoptPlan = null;
    state.dirty = true;
    $('#adoptplan')?.remove();
    markUnsaved();
    const counter = $('[data-favorite-count="'+kind+'"]');
    if (counter) counter.textContent = String(count + (t.checked ? 1 : -1));
    return;
  }
  if (act==='edit-final-profile'){
    state.open.profileedit = true;
    render();
    return;
  }
  if (act==='adopt-preview'){
    await refreshAdoptPlan();
    if (state.adoptPlan && state.view !== 'profile') go('profile');
    return;
  }
  if (act==='adopt-cancel'){
    state.adoptPlan = null;
    render();
    return;
  }
  if (act==='adopt-apply'){
    const plan = state.adoptPlan;
    if (!plan) return;
    // Read the reasons off the panel before the re-render, the same way the
    // intake and profile forms do.
    const reasons = { ...(plan.retainReasons || {}) };
    $$('[data-retain-reason]').forEach(el => { reasons[el.dataset.retainReason] = el.value; });
    await withBusy(async () => {
      try {
        const out = await api('/api/searches/'+state.search.id+'/intake/adopt', {
          method:'POST',
          body:{ retain: plan.retain || [], retainReasons: reasons, selectedKeys:plan.selectedKeys,
            fingerprint: plan.fingerprint, profileRevision: plan.profileRevision }
        });
        state.search = out.search;
        state.adoptPlan = null;
        const gaps = out.gaps || [];
        toast(gaps.length
          ? 'Profile saved from committee input. It is still short in '+gaps.map(g=>g.label.toLowerCase()).join(', ')+' — write those yourself.'
          : 'Profile saved from committee input. Edit the weights and wording, then save.');
        // Adoption already returned the current search. Finish navigation before
        // releasing the editor; a late refresh could replace the first edit.
        await go('profile', {}, { fresh:true });
      } catch (err) {
        if (err.code === 'STALE_SOURCE' || err.code === 'STALE_PROFILE') {
          state.adoptPlan = null;
          toast(err.message);
          return;
        }
        throw err;
      }
    }, waitSave('Saving the profile'));
    return;
  }
  if (act==='research'){
    // The same decision the buttons were drawn from, checked again here: a
    // keyboard activation, a stale render, or a search that changed underneath
    // must not get past it (D06).
    const verdict = researchEligibility();
    if (!verdict.ok){
      toast(verdict.why);
      if (verdict.go) go(verdict.go);
      return;
    }
    const form = $('#citylookup') || $('#facts');
    const body = form ? Object.fromEntries(new FormData(form).entries()) : {};
    state.premium = $('#deeper-research')?.checked || false;
    const refreshEvidence = $('#refresh-evidence')?.checked || false;
    const city = String(body.city || body.client || state.search.client || '').trim();
    const website = String(body.website || state.search.website || '').trim();
    if (!city || !website){
      toast(city ? 'Enter the official jurisdiction website.' : 'Enter the jurisdiction name and its official website.');
      return;
    }
    await startResearch({
      city, website, premium: state.premium, refreshEvidence,
      // Facts typed on the Search facts form are saved before research starts,
      // so nothing somebody entered is lost to the operation that follows.
      patch: form?.id === 'facts' ? body : null
    });
    return;
  }
  if (act==='research-dismiss'){
    dismissResearchNotice();
    render();
    return;
  }
  if (act==='research-reconcile'){
    // A read, never a start. The key is the only handle this tab has on an
    // operation whose acknowledgement was lost.
    const key = state.research.key;
    await withBusy(
      () => reconcileResearch({ searchId: state.search.id, key }),
      waitSave('Checking what happened to this research'));
    return;
  }
  if (act==='research-apply'){
    const job = state.research.review;
    if (!job) return;
    await withBusy(async () => {
      const selected = $$('[name="research-field"]:checked').map(el => el.value);
      const out = await api('/api/searches/'+state.search.id+'/research-jobs/'+job.id+'/apply', { method:'POST',
        body:$$('[name="research-field"]').length ? { selectedFields:selected } : {} });
      state.search = out.search;
      state.research.review = null;
      state.research.error = null;
      state.research.draft = null;
      const held = out.held || [];
      toast(held.length
        ? 'Applied what research found. Kept what you had already entered for: '+held.join(', ')+'.'
        : 'Applied what research found. Fill the remaining facts by hand.');
      go('community');
    }, waitSave('Applying what research found'));
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
  if (act==='save-apply-draft'){
    const form = $('#applyform');
    if (!form) return;
    const token = location.pathname.split('/').pop();
    const which = t.dataset.which === 'survey2' ? 'survey2' : 'survey1';
    const answers = Object.fromEntries(new FormData(form).entries());
    await withBusy(async () => {
      const saved = await api('/api/apply/'+token+'/draft', {
        method:'POST', body:{ which, answers, surveyVersion:state.apply.versions?.[which] }
      });
      state.apply.drafts ||= {};
      state.apply.drafts[which] = { answers, at:saved.savedAt, expiresAt:saved.expiresAt };
      state.dirty = false;
      const status = $('#apply-draft-status');
      if (status) status.textContent = 'Draft saved ' + String(saved.savedAt || '').slice(0, 16).replace('T', ' ');
      toast('Draft saved. Return with this same link within 14 days.');
    }, waitSave('Saving your draft'));
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
    if (from === 'survey1' && isStaff()) { await saveQuestions(true); return; }
    if (from === 'profile'){
      await persistProfile(true);
      return;
    }
    const n = nextOf(from);
    if (!n) return;
    // Answers typed into the intake form but never saved would otherwise
    // vanish on the way to the next step.
    if (from === 'intake' && state.intake) {
      collectIntakeText();
      if (!mySubmission() && state.dirty &&
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
  if (act==='save-questions') { await saveQuestions(); return; }
  if (act==='generate-questions'){
    if (state.dirty) { toast('Save your edits before drafting a new question plan.'); return; }
    if (questionKeys().some(key => state.search.artifacts?.[key]?.questions?.length) && !confirm('Replace all question drafts with a new coordinated plan? Previously issued candidate questionnaires keep their original wording.')) return;
    await withBusy(async () => {
      const out = await api('/api/searches/'+state.search.id+'/generate', { method:'POST', body:{ kind:'questions' } });
      state.search = out.search;
      toast('All candidate questions drafted. Review each stage before using them.');
    }, { title:'Planning candidate questions', copy:'Writing one coordinated plan across the included stages.', steps:['Reading the adopted profile','Drafting distinct questions for each stage'] });
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
  if (act==='advance-final'){
    const cid = t.dataset.cid;
    const stage = 'finalist';
    const who = (state.search?.candidates||[]).find(x => x.id===cid)?.name || 'this candidate';
    if (!confirm('Advance '+who+' to '+stage+'?')) return;
    await withBusy(async () => {
      state.search = await api('/api/searches/'+state.search.id+'/candidates/'+cid, { method:'PATCH', body:{ stage } });
      toast('Advanced to finalist.');
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
  if (act==='retry-score'){
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
  const cid = state.sel;
  state.scoreDraft = { cid, scores, note,
    labels:Object.fromEntries((state.search.criteria || []).map(criterion => [criterion.id, criterion.label])) };
  let saved = false;
  await withBusy(async () => {
    const revision = state.scoreConflict?.cid === cid
      ? state.scoreConflict.current.version
      : String(state.search.profileRevision || 1) + ':' + Number(state.search.scoreRevisions?.[state.user.id]?.[cid] || 1);
    try {
      state.search = await api('/api/searches/'+state.search.id+'/scores/'+cid, {
        method:'PUT', headers:{ 'if-match-score':revision }, body:{ scores, note }
      });
    } catch (error) {
      if (error.code === 'STALE_SCORE') {
        const latest = await api('/api/searches/'+state.search.id);
        state.search = latest;
        state.scoreConflict = { cid, message:error.message, current:error.detail.current };
        render();
      }
      throw error;
    }
    state.scoreDraft = null; state.scoreConflict = null;
    saved = true;
    toast('Your scores are on the file.');
  });
  return saved;
}

document.addEventListener('submit', async e => {
  e.preventDefault();
  if (e.target.id==='createworkspace') {
    if (state.orgBusy) return;
    const body = Object.fromEntries(new FormData(e.target).entries());
    state.orgDraft = body; state.orgBusy = true; state.orgError = null; render();
    try {
      const out = await api('/api/organizations', { method:'POST', body });
      state.orgDraft = null;
      // Creating a workspace does not put this session in it: Clerk decides
      // which organization a session is active in, and the switch is the same
      // deliberate move as any other.
      await enterWorkspace(out.organization.id);
    } catch (error) {
      state.orgError = error.message;
      state.orgBusy = false;
      render();
    }
    return;
  }

  if (e.target.id==='inviteform') {
    if (state.orgBusy) return;
    const body = Object.fromEntries(new FormData(e.target).entries());
    state.inviteDraft = body; state.orgBusy = true; state.orgError = null; state.orgNotice = null; render();
    try {
      const out = await api('/api/organization/invitations', { method:'POST', body });
      state.inviteDraft = null;
      state.orgNotice = 'An invitation was emailed to ' + out.invitation.email + ' as '
        + out.invitation.roleLabel + '. They are in the workspace once they accept it.';
      await loadTeam();
    } catch (error) { state.orgError = error.message; }
    finally { state.orgBusy = false; render(); }
    return;
  }

  if (e.target.id==='onboardingform') {
    if (state.onboardingSaving) return;
    const body = Object.fromEntries(new FormData(e.target).entries());
    state.onboardingDraft = body; state.onboardingError = null; state.onboardingSaving = true;
    render();
    try {
      const result = await api('/api/me/onboarding', { method:'POST', body });
      state.user = result.user; state.onboarding = result.onboarding;
      state.editAccountSetup = false; state.onboardingDraft = null; state.dirty = false;
      if (!state.onboarding.blocked) await refreshSearches();
      state.search = null;
      // A first-time member may have opened a link to an assigned search.
      // Confirming their name must not lose that destination.
      if (!state.onboarding.blocked) await applyRoute(parseRoute(location.hash), { push:false });
      else await go('home');
    } catch (error) { state.onboardingError = error.message; }
    finally { state.onboardingSaving = false; render(); $('#main')?.focus(); }
    return;
  }
  if (e.target.id==='newsearch'){
    await createSearch();
  }
  if (e.target.id==='newpeople'){
    collectPeople();
    const rows = peopleDraft();
    // A row nobody typed in is not an omission, it is an empty row.
    const filled = rows.filter(r => r.name.trim() || r.email.trim());
    if (!filled.length) { toast('Enter a name and an email first.'); return; }
    if (filled.some(r => !r.name.trim() || !r.email.trim())) {
      toast('Everyone needs both a name and an email.');
      return;
    }
    await withBusy(async () => {
      const done = [];
      const failed = [];
      for (const person of filled) {
        try {
          const out = await api('/api/searches/'+state.search.id+'/members', {
            method:'POST',
            body:{ name:person.name.trim(), email:person.email.trim(), title:person.title.trim(), searchRole:person.searchRole }
          });
          // Each reply carries the next revision, and the request after this
          // one has to send it or the server rejects it as a stale write.
          state.search = out.search;
          done.push({ ...person, added:out.added, invitationSent:out.invitationSent, note:out.note });
        } catch (error) {
          failed.push({ ...person, error: error.message });
        }
      }
      // Only what failed stays in the form. Retrying cannot add anybody twice,
      // and the reason sits against the row it belongs to.
      state.newPeople = failed.length ? failed : [blankPerson()];
      state.open.addpeople = failed.length > 0;
      toast(addPeopleSummary(done, failed));
    }, waitSave(filled.length === 1 ? 'Adding '+(filled[0].name.trim()||'them') : 'Adding '+filled.length+' people'));
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
      const received = await api('/api/apply/'+token, { method:'POST', body:{ which, answers, surveyVersion:state.apply.versions?.[which] } });
      state.dirty = false;
      state.apply.receipts ||= {};
      if (received.receipt) state.apply.receipts[which] = received.receipt;
      if (state.apply.drafts) state.apply.drafts[which] = null;
      if (which === 'survey2') state.apply.submitted2 = true;
      else state.apply.submitted1 = true;
      render();
      toast(received.duplicate ? 'Already received. Your answers are safe.' : 'Submitted.');
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
    state.newJurisdiction = null;
    if (!state.search) return;
    // Payment comes first only when this search actually owes one. Without
    // billing, or with access already in place, the work starts with the team.
    if (state.search.projectAccess?.state === 'unpaid') {
      go('billing', {}, { fresh:true });
      toast('Search '+state.search.no+' is open. Review its project payment.');
    } else {
      go('team', {}, { fresh:true });
      toast('Search '+state.search.no+' is open. Add the search committee next.');
    }
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
  // A fragment change fires popstate and then hashchange for the same move.
  // Remember which address this handler is routing so the second event does
  // not start the same navigation, and the same reads, all over again.
  const routing = routingHash = location.hash;
  try { await applyRoute(parseRoute(routing), { push:false }); }
  finally { if (routingHash === routing) routingHash = null; }
});
let routingHash = null;

/**
 * An address changed in place rather than navigated to.
 *
 * Typing or pasting a link into the address bar of an open tab changes the hash
 * without a history navigation, so `popstate` never fires and the workspace
 * would sit on the old screen under the new address. It matters more now that
 * the app rewrites addresses to carry their workspace: the address somebody
 * arrives with and the one that ends up in the bar are not always the same
 * string, and only one of them can be what is on screen.
 */
window.addEventListener('hashchange', async () => {
  if (location.pathname.startsWith('/apply/')) return;
  if (location.pathname === '/how-it-works') return;
  if (!state.user) return;
  // Already showing it: this is the app's own rewrite coming back round.
  if (location.hash === routeFor()) return;
  // Already on its way: popstate is routing this very address.
  if (location.hash === routingHash) return;
  if (state.dirty && !confirm('Leave this page and discard unsaved edits?')){
    history.replaceState({ slateDepth:navDepth }, '', routeFor());
    return;
  }
  state.dirty = false;
  await applyRoute(parseRoute(location.hash), { push:false });
});

// The wait dialog lives outside #app, which is inert while it is open, so its
// Cancel button is wired directly rather than through the delegated handler.
$('#lookup-cancel')?.addEventListener('click', () => { if (showWait._cancel) showWait._cancel(); });

(async function boot(){
  // Older Clerk emails only carry a ticket. Its organization ID is a routing
  // hint, never evidence of access: the authenticated membership and search
  // APIs still authorize everything before a destination can open.
  const invitationParams = new URLSearchParams(location.search);
  if (invitationParams.has('__clerk_ticket') && !location.pathname.startsWith('/apply/')) {
    if (!invitationParams.has('organization')) {
      try {
        const payload = invitationParams.get('__clerk_ticket').split('.')[1];
        const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
        if (/^org_[a-zA-Z0-9]+$/.test(claims.oid || '')) invitationParams.set('organization', claims.oid);
      } catch { /* Clerk, not Slate, decides whether a ticket is valid. */ }
    }
    history.replaceState(null, '', location.pathname + '?' + invitationParams + location.hash);
  }
  // Older email redirects may still point at Home. Keep Clerk's ticket intact.
  if (!location.pathname.startsWith('/apply/') && !isInvitationPage()
      && new URLSearchParams(location.search).has('__clerk_ticket')) {
    history.replaceState(null, '', '/join' + location.search);
  }
  // The guide reads the staff catalog through the same session as everything
  // else. Configured before anything can ask for it; the catalog itself is
  // fetched on first use, not at boot, because most sessions never open it.
  window.SlateHelp.configure({
    endpoint: '/api/help',
    token: () => authToken().catch(() => null)
  });
  await loadHealth();
  const m = location.pathname.match(/^\/apply\/([^/]+)/);
  if (m){
    try { state.apply = await api('/api/apply/'+m[1]); }
    catch { state.apply = null; }
    render();
    return;
  }
  try {
    await window.SlateAuth.init(state.health?.auth,
      () => {
        if ((isInvitationPage() && state.orgBusy) || state.completingTask) return;
        state.user = null; state.dirty = false;
        clearWorkspaceState();
        render();
        location.reload();
      },
      nextOrganization => {
        if ((isInvitationPage() && state.orgBusy) || state.completingTask) return;
        // The active workspace changed somewhere this tab did not ask — another
        // tab, or Clerk resolving a task. Whatever is on screen belongs to the
        // workspace we were in, so it comes down before anything else happens.
        state.dirty = false;
        clearWorkspaceState();
        window.removeEventListener('beforeunload', warnUnsaved);
        location.hash = nextOrganization ? '#/o/' + encodeURIComponent(nextOrganization) + '/home' : '#/home';
        location.reload();
      });
  } catch (error) {
    state.authError = error.message;
    if (location.pathname === '/pricing' || location.pathname === '/subscriptions') { await loadBilling(); return; }
    render();
    return;
  }
  const signedIn = await loadMe();
  if (window.SlateAuth.pendingTask || state.authTaskPending) {
    if (window.SlateAuth.pendingTask === 'choose-organization') {
      try { state.taskChoices = await window.SlateAuth.pendingWorkspaces(); }
      catch (error) { state.taskChoicesError = error.message || 'Your workspaces could not load. Try again.'; }
    }
    render(); return;
  }
  if (isInvitationPage()) {
    // A stable component path survives Clerk's verification/callback steps,
    // even when their query string no longer includes the invitation status.
    if (!window.SlateAuth.signedIn && location.pathname === '/join') {
      const kind = new URLSearchParams(location.search).get('__clerk_status') === 'sign_up' ? 'sign-up' : 'sign-in';
      history.replaceState(null, '', '/join/' + kind + location.search);
    }
    if (signedIn) {
      try { state.invites = await window.SlateAuth.invitations(); }
      catch (error) { state.invitesError = error.message || 'Invitations could not be read. Try again.'; }
      if (await continueInvitation()) return;
    }
    render();
    return;
  }
  if (location.pathname === '/subscriptions') history.replaceState(null, '', '/pricing');
  if (location.pathname === '/pricing') { await loadBilling(); return; }
  if (signedIn && location.pathname === '/how-it-works') { render(); return; }
  if (signedIn){
    if (/^\/(sign-up|sign-in)(?:\/|$)/.test(location.pathname)) history.replaceState(null, '', '/' + location.hash);
    navDepth = Number(history.state?.slateDepth) || 0;
    if (state.onboarding?.blocked){
      // Nowhere to work yet. The onboarding screens are their own thing and do
      // not belong to a route, so no search index is fetched and no address is
      // written until there is a workspace behind it.
      render();
      $('#main')?.focus();
    } else {
      await refreshSearches();
      await applyRoute(parseRoute(location.hash), { push:false });
      const paymentReturn = new URLSearchParams(location.search).get('payment');
      if (paymentReturn === 'return' && state.search && state.view === 'billing') {
        await withBusy(async () => {
          await api('/api/searches/'+state.search.id+'/payment/reconcile', { method:'POST', body:{} });
          await loadSearch(state.search.id);
        }, false);
      }
      if (paymentReturn === 'return' || paymentReturn === 'cancel') {
        history.replaceState(history.state, '', location.pathname + location.hash);
      }
    }
    // In the background, and never blocking the first paint. "Help with this
    // page" appears once the guide is there; until then the screen is simply
    // the screen, rather than offering a control that would open nothing.
    // Inserted into the page rather than rendered onto it — see
    // paintHelpControl for why that distinction matters.
    loadHelp().then(paintHelpControl);
  } else {
    render();
  }
})();

// Warn before losing unsaved work, including candidate questionnaires.
// The role select on Team & access commits on change rather than behind a save
// button: it is one field with one effect, and leaving it looking changed while
// it is not would be worse than a moment's wait.
// Choosing a deadline policy changes which date the screen asks for, so it
// redraws. Everything typed so far is read off the page first: a consultant
// halfway through a posting must not lose it by changing their mind about the
// closing date.
document.addEventListener('change', e => {
  if (!e.target.matches('[data-posting-deadline="kind"]')) return;
  state.postingDraft = collectPosting();
  state.dirty = true;
  render();
});

document.addEventListener('change', async e => {
  const select = e.target.closest('select[data-act="set-role"]');
  if (!select) return;
  const member = select.dataset.member;
  const role = select.value;
  state.orgBusy = true; state.orgError = null; state.orgNotice = null;
  try {
    const out = await api('/api/organization/members/' + encodeURIComponent(member), { method:'PATCH', body:{ role } });
    state.orgNotice = 'Role changed to ' + out.roleLabel + '. It applies on their next request.';
    await loadTeam();
  } catch (error) { state.orgError = error.message; try { await loadTeam(); } catch { /* keep the message */ } }
  finally { state.orgBusy = false; render(); }
});

document.addEventListener('input', e => {
  if (!e.target.closest('#app')) return;
  if (e.target.closest('#createworkspace')) {
    state.orgDraft = Object.fromEntries(new FormData(e.target.form).entries());
    return;
  }
  if (e.target.closest('#inviteform')) {
    state.inviteDraft = Object.fromEntries(new FormData(e.target.form).entries());
    return;
  }
  if (e.target.closest('#onboardingform')) {
    state.onboardingDraft = Object.fromEntries(new FormData(e.target.form).entries());
    state.dirty = true;
    if (e.target.name === 'requestedRole') render();
    return;
  }
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
// Named, because a deliberate workspace switch removes it: the guard has
// already been answered by then, and leaving it attached would ask the same
// question twice on the reload that completes the switch.
function warnUnsaved(e){
  if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
}
window.addEventListener('beforeunload', warnUnsaved);
