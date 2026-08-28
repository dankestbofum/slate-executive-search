/* Slate — guided executive-search product */
const $ = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => [...el.querySelectorAll(s)];
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
  ['facts','Search facts'],
  ['profile','1 · Profile'],
  ['community','2 · Community'],
  ['brochure','3 · Brochure'],
  ['ads','4 · Advertisements'],
  ['survey1','5 · Initial survey'],
  ['plan','6 · Ad plan'],
  ['guide','7 · Interview guide'],
  ['survey2','8 · Semifinalist survey'],
  ['screen','9 · Screening'],
  ['send2','10 · Semifinalist send'],
  ['finalists','11 · Finalists'],
  ['schedule','12 · Finalist week'],
  ['contract','13 · Contract'],
  ['bar','14 · Evaluation']
];

const DRAFTS = {
  community: { n:2,  title:'Community and form of government', lede:'Enter the jurisdiction and its official website. A research agent reads public sources and fills the search facts and this profile — history, quality of life, and how the government is organized.' },
  brochure:  { n:3,  title:'Recruitment brochure',             lede:'Filled from the community file. Add pictures, pick a color and layout, and print. Ads use the same packet. Claude can tighten the copy if you want.' },
  ads:       { n:4,  title:'Advertisements',                   lede:'Four versions of the same packet as the brochure: a full ICMA listing, a short brief, social, and an association notice.' },
  survey1:   { n:5,  title:'Initial candidate survey',         lede:'Gets past the resume. Every scored item names a profile criterion.' },
  plan:      { n:6,  title:'Recruitment and advertising plan', lede:'Outlet, audience, format, timing, cost, and who posts it.' },
  guide:     { n:7,  title:'Interview guide',                  lede:'ARE questions and four assessment scenarios, each tagged to the profile.' },
  survey2:   { n:8,  title:'Semifinalist questionnaire',       lede:'Optional. Deeper ARE questions before interviews.' },
  schedule:  { n:12, title:'Finalist week and assessment center', lede:'Interview schedule plus the assessment guide. Every finalist gets the same core experience.' },
  contract:  { n:13, title:'Employment agreement',             lede:'ICMA model, customized, for counsel review.' },
  bar:       { n:14, title:'BAR evaluation',                   lede:'Behavior, Actions, Results, governance survey, and the annual cadence — inherited from the adopted profile.' }
};

const state = {
  user:null, users:[], health:null, view:'home', searches:[], search:null,
  sel:null, busy:false, premium:false, apply:null
};

function toast(msg, ms=3400){
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, ms);
}

const STEP_FLOW = ['profile','community','brochure','ads','survey1','plan','guide','survey2','screen','send2','finalists','schedule','contract','bar'];
const STEP_NAME = {
  profile:'Candidate profile',
  community:'Community',
  brochure:'Brochure',
  ads:'Advertisements',
  survey1:'Initial survey',
  plan:'Ad plan',
  guide:'Interview guide',
  survey2:'Semifinalist survey',
  screen:'Screening',
  send2:'Semifinalist send',
  finalists:'Finalists',
  schedule:'Finalist week',
  contract:'Contract',
  bar:'Evaluation'
};

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
  const name = String(city||'').trim() || 'the city';
  showWait({
    kicker: 'City lookup',
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
  const i = STEP_FLOW.indexOf(view);
  if (i < 0) return null;
  if (i === STEP_FLOW.length-1) return { key:'overview', n:null, title:'This search' };
  const key = STEP_FLOW[i+1];
  return { key, n: i+2, title: STEP_NAME[key] || key };
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
  return `<div class="row" style="margin-top:var(--s-5)">
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
    <p class="t-small">${view==='community' ? 'The brochure sells the job using this community profile and the adopted candidate profile.' : 'Save what you have, then continue.'}</p>
    <div class="row">${nextButton(view, label)}</div>
  </div>`;
}

async function api(path, opts={}){
  const res = await fetch(path, {
    credentials:'include',
    headers:{ 'content-type':'application/json', ...(opts.headers||{}) },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function go(view, extra={}){
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
    ${actions?`<div class="row" style="margin-top:var(--s-4)">${actions}</div>`:''}
  </div></div>`;
}
function modelToggle(){
  const h = state.health || {};
  return `<label class="t-small" style="display:flex;gap:8px;align-items:center">
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
async function loadSearch(id){ state.search = await api('/api/searches/'+id); }

function shell(body){
  const u = state.user, s = state.search, next = s?.progress?.next;
  const links = s
    ? NAV.map(([v,l]) => `<button class="rail__link" data-go="${v}" ${state.view===v || (state.view==='person' && v==='screen')?'aria-current="page"':''}>${l}</button>`).join('')
    : '';
  return `<div class="shell${state.busy?' busy':''}">
    <nav class="rail" aria-label="Primary">
      <div class="rail__brand">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--accent)" aria-hidden="true"><path d="M4 20h16M6 20V9l6-4 6 4v11M10 20v-5h4v5"/></svg>
        <span class="rail__name">Slate</span><span class="rail__ver">Live</span>
      </div>
      <div class="whoami">
        <div class="whoami__hd"><span class="t-label">Signed in as</span></div>
        <div class="whoami__list">
          <div class="whoami__opt" aria-pressed="true">
            <span class="whoami__init">${esc(u.init)}</span>
            <span><span class="whoami__nm">${esc(u.name)}</span><span class="whoami__rl">${esc(u.title)}</span></span>
          </div>
        </div>
      </div>
      <div class="rail__group"><div class="rail__label">Workspace</div>
        <button class="rail__link" data-go="home" ${!s && state.view==='home'?'aria-current="page"':''}>Home</button>
        ${s?links:''}
      </div>
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
        <span class="mono mast__id">${s?esc(s.no)+' · '+esc(s.position):'Slate'}</span>
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
    (s ? `<span class="dot"></span><button type="button" data-go="overview">${esc(s.client||'Search')}</button>` :
      (state.view==='new' ? `<span class="dot"></span><span>New search</span>` : ''));
}

function vLogin(){
  const demo = Boolean(state.health?.demoLogins);
  const accounts = demo ? (state.health?.accounts || []) : [];
  const first = accounts[0];
  return `<div class="login"><div class="login__card">
    <div class="login__brand">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--accent)"><path d="M4 20h16M6 20V9l6-4 6 4v11M10 20v-5h4v5"/></svg>
      <span class="rail__name">Slate</span>
    </div>
    <h1 class="t-title">Sign in</h1>
    <p class="t-body">The app walks a search from the candidate profile through recruiting, screening, interviews, contract, and evaluation. Work is saved on the server.</p>
    <form id="login" class="stack">
      ${field('Email','', `<input class="input" name="email" type="email" value="${esc(first?.email||'')}" autocomplete="username" required>`)}
      ${field('PIN','', `<input class="input" name="pin" inputmode="numeric" maxlength="12" value="${esc(first?.pin||'')}" autocomplete="current-password" required>`)}
      <button class="btn btn--primary" type="submit">Open workspace</button>
    </form>
    ${accounts.length?`<div class="accounts">
      <div class="t-label">Accounts</div>
      ${accounts.map(a => `${esc(a.name)} <b>${esc(a.email)}</b> · ${esc(a.pin)}`).join('<br>')}
    </div>`:''}
  </div></div>`;
}

function vHome(){
  const u = state.user;
  const canDelete = u.role==='consultant';
  const list = state.searches || [];
  const complete = list.filter(s => (s.progress?.done||0) >= 14).length;
  const live = list.length - complete;
  const pickup = list.find(s => s.progress?.next);
  const first = String(u.name||'').split(' ')[0] || 'there';
  const rows = list.length
    ? list.map(s => {
        const n = s.progress?.next;
        return `<div class="home-row">
          <button class="home-row__open" data-open="${s.id}">
            <span><b>${esc(s.client||'Untitled')}</b><div class="t-small">${esc(s.position)} · ${esc(s.fog||'')}</div></span>
            <span class="mono t-small">${esc(s.no)}</span>
            <span class="t-small">${s.progress?s.progress.done+'/14':''}${n?' · next: '+esc(n.t):' · complete'}</span>
          </button>
          ${canDelete?`<button class="btn btn--danger btn--sm" data-act="delete-search" data-id="${s.id}" data-name="${esc(s.client||s.no||'this search')}">Delete</button>`:''}
        </div>`;
      }).join('')
    : `<div class="empty"><div class="empty__t">No searches yet</div>Open a search. Step 1 is the candidate profile — 3 to 5 essential skills. Everything else is generated from that.</div>`;
  return shell(`
    ${head('Home','Welcome back, '+first,'A fourteen-step executive search file. Start with the candidate profile. Recruiting, surveys, interviews, the contract, and evaluation all inherit it.',
      u.role==='consultant' ? `<button class="btn btn--primary" data-go="new">Open a new search</button>` : '')}
    <div class="band"><div class="wrap stack">
      <div class="tiles">
        <div class="tile"><span class="tile__k">Searches</span><span class="tile__v">${list.length}</span></div>
        <div class="tile"><span class="tile__k">In progress</span><span class="tile__v">${live}</span></div>
        <div class="tile"><span class="tile__k">Complete</span><span class="tile__v">${complete}</span></div>
        <div class="tile tile--hi"><span class="tile__k">Signed in</span><span class="tile__v" style="font-size:1.45rem">${esc(u.init)}</span><span class="tile__n">${esc(u.title)}</span></div>
      </div>
      ${pickup ? `<div class="next">
        <div class="t-label">Continue</div>
        <h2>${esc(pickup.client||'Untitled')} · ${esc(pickup.position||'')}</h2>
        <p class="t-small">Step ${pickup.progress.next.n}. ${esc(pickup.progress.next.t)}</p>
        <div class="row"><button class="btn btn--primary" data-open="${pickup.id}">Open this search</button>
          ${u.role==='consultant' ? `<button class="btn btn--secondary" data-go="new">Open a new search</button>` : ''}</div>
      </div>` : ''}
      <div class="spec"><div class="spec__bar">Your searches</div>
        <div class="spec__body spec__body--flush">${rows}</div>
      </div>
      <div class="spec"><div class="spec__bar">How a search runs</div>
        <div class="spec__body"><div class="home-steps">${STEP_FLOW.map((k,i) =>
          `<div class="home-step"><span class="mono">${String(i+1).padStart(2,'0')}</span><span>${esc(STEP_NAME[k])}</span></div>`
        ).join('')}</div></div>
      </div>
    </div></div>`);
}

function vNew(){
  return shell(`
    ${head('New search','Who is hiring, and for what','Open the file, then write the candidate profile. City research is Step 2 — after the profile is adopted.',
      `<button class="btn btn--primary" type="submit" form="newsearch" data-act="create">Create search</button>
       <button class="btn btn--secondary" data-go="home">Cancel</button>`)}
    <div class="band"><div class="wrap"><form id="newsearch" class="stack">
      <div class="grid2">
        ${field('Client jurisdiction','Town of…, City of…', `<input class="input" name="client" required placeholder="Town of Ridgeline">`)}
        ${field('City website','Saved now. Looked up in Step 2, after the profile.', `<input class="input" name="website" type="url" placeholder="https://www.ridgelineco.gov">`)}
        ${field('Position','', `<input class="input" name="position" required placeholder="Town Manager">`)}
        ${field('State','', `<input class="input" name="state" placeholder="Colorado">`)}
        ${field('Form of government','', `<select class="input" name="fog"><option>Council–Manager</option><option>Mayor–Council</option><option>Commission</option><option>County Administrator</option></select>`)}
        ${field('Population','', `<input class="input" name="population" placeholder="18,400">`)}
        ${field('Operating budget','', `<input class="input" name="budget" placeholder="$34M general fund">`)}
        ${field('Salary range','', `<input class="input" name="salary" placeholder="$165,000–$195,000">`)}
        ${field('First review date','', `<input class="input" name="firstReview" placeholder="14 Sep 2026">`)}
      </div>
      ${field('Notes from the governing body','Paste workshop notes. Used to draft the profile.', `<textarea class="input ed" name="notes" placeholder="Structural deficit, three director vacancies, deferred water mains…"></textarea>`)}
    </form></div></div>`);
}

function vOverview(){
  const s = state.search, next = s.progress?.next;
  return shell(`
    ${head(s.no, s.position || 'Untitled position', `Executive search for <b>${esc(s.client||'the client')}</b>. ${esc(s.fog||'')}.`,
      `${next ? `<button class="btn btn--primary" data-go="${peopleView(next.key)}">Continue Step ${next.n}</button>` : ''}
       ${state.user.role==='consultant' ? `<button class="btn btn--danger" data-act="delete-search" data-id="${s.id}" data-name="${esc(s.client||s.no||'this search')}">Delete search</button>` : ''}`)}
    <div class="band"><div class="wrap stack">
      <div class="tiles">
        <div class="tile"><span class="tile__k">Steps done</span><span class="tile__v">${s.progress.done}<span class="tile__n"> / 14</span></span></div>
        <div class="tile"><span class="tile__k">Profile items</span><span class="tile__v">${(s.criteria||[]).length}</span></div>
        <div class="tile"><span class="tile__k">Candidates</span><span class="tile__v">${(s.candidates||[]).length}</span></div>
        <div class="tile tile--hi"><span class="tile__k">Up next</span><span class="tile__v" style="font-size:1.45rem">${next?String(next.n).padStart(2,'0'):'—'}</span><span class="tile__n">${next?esc(next.t):'Search complete'}</span></div>
      </div>
      ${next?`<div class="next">
        <div class="t-label">What to do now</div>
        <h2>Step ${next.n}. ${esc(next.t)}</h2>
        <p class="t-small">${next.n===1?'Select 3 to 5 essential skills, then the traits, challenges, and opportunities. Everything else is generated from this.':next.n===2?'Enter the city and its official website. Claude looks up public facts and fills the community and form-of-government profile. Check every number.':next.n===9?'Add candidates. Score them against the adopted profile. Advance the people you want as semifinalists, then release scores.':next.n===10?'Send the semifinalist survey with a deadline. It is not on their apply link until you send it.':next.n===11?'Read the semifinalist responses against the profile. Advance the people who will sit for finalist week.':next.blocked?'Finish the earlier step first. Later documents are only as good as the profile they inherit.':'Open the step, fill what you know, then ask Claude to draft. You edit. The file saves.'}</p>
        <div class="row"><button class="btn btn--primary" data-go="${peopleView(next.key)}">Open this step</button></div>
      </div>`:''}
      <div class="spec"><div class="spec__bar">The fourteen steps</div>
        <div class="spec__body"><div class="steps">${(s.steps||[]).map(st => `
          <div class="step ${st.status==='done'?'step--done':st.status==='now'?'step--now':''}">
            <div class="step__n">${String(st.n).padStart(2,'0')}</div>
            <div>
              <div class="step__t">${esc(st.t)}${st.opt?' '+pill('idle','Optional'):''}</div>
              <div class="t-small">${st.blocked?'Waiting on an earlier step':st.status==='done'?'On file':st.status==='now'?'In progress':'Not started'}</div>
            </div>
          </div>`).join('')}
        </div></div>
      </div>
      <div class="spec"><div class="spec__bar">Activity</div>
        <div class="spec__body"><div class="feed">${(s.activity||[]).slice(0,8).map(a=>`
          <div class="feed__i"><span class="feed__w">${esc(a.who)}</span><span class="feed__x">${esc(a.x)}</span><span class="feed__t">${esc((a.at||'').slice(0,10))}</span></div>`).join('') || '<div class="t-small">Nothing yet.</div>'}
        </div></div>
      </div>
    </div></div>`);
}

function vFacts(){
  const s = state.search;
  return shell(`
    ${head('Search facts', s.client||'Client','These facts feed every generated document.',
      `<button class="btn btn--primary" data-act="save-facts">Save facts</button>
       <button class="btn btn--secondary" data-act="research">Research this city</button>
       <button class="btn btn--secondary" data-go="profile">Next · Step 1</button>`)}
    <div class="band"><div class="wrap"><form id="facts" class="stack">
      <div class="grid2">
        ${field('Client','', `<input class="input" name="client" value="${esc(s.client)}">`)}
        ${field('City website','Official site used for city lookup.', `<input class="input" name="website" value="${esc(s.website||'')}" placeholder="https://">`)}
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

function critRow(c, i){
  return `<div class="crit-row" data-row="${i}">
    <span class="mono t-small">${esc(c.id||'')}</span>
    <div class="stack" style="gap:6px">
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
  const groups = Object.keys(KIND).map(k => {
    const rows = (s.criteria||[]).map((c,i)=>({c,i})).filter(x=>x.c.kind===k);
    const n = rows.filter(x => String(x.c.label||'').trim()).length;
    const atCap = rows.length >= 5;
    const labels = new Set(rows.map(x => x.c.label.trim().toLowerCase()).filter(Boolean));
    const range = inCritRange(n) ? 'ok' : (k==='skill' ? 'wait' : (n ? 'wait' : 'idle'));
    return `<div>
      <div class="sub">${KIND[k].plural} ${pill(range, n+' of 3–5')}</div>
      ${k==='skill' ? `<p class="t-small">Select 3 to 5 essential skills. These become the spine of the ads, surveys, and interviews.</p>` : ''}
      <div class="pick">${(SUGGEST[k]||[]).map(label => {
        const on = labels.has(label.toLowerCase());
        return `<button type="button" data-pick="${k}" data-label="${esc(label)}" aria-pressed="${on}" ${!on && atCap ? 'disabled':''}>${esc(label)}</button>`;
      }).join('')}</div>
      ${rows.map(x=>critRow(x.c,x.i)).join('') || '<div class="t-small">None selected yet.</div>'}
      <div class="row" style="margin-top:var(--s-3)"><button class="btn btn--secondary btn--sm" data-add="${k}" ${atCap?'disabled':''}>Add another ${KIND[k].label.toLowerCase()}</button></div>
    </div>`;
  }).join('');
  return shell(`
    ${head('Step 1','Candidate profile','This is the spine. Select 3 to 5 essential skills, then traits, challenges, and opportunities — with weights. Recruiting markets it. Surveys test it. Interviews evidence it.',
      `<button class="btn btn--primary" data-act="save-profile-next">Save and move on</button>
       <button class="btn btn--secondary" data-act="save-profile">Save profile</button>
       <button class="btn btn--secondary" data-act="draft-profile">Draft from notes</button>`)}
    <div class="band"><div class="wrap stack">
      ${modelToggle()}
      ${field('Notes for the draft','Paste council workshop notes. Claude can propose the rest of the matrix. You still choose the skills.',
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
function govFields(){ return state.health?.communityFields?.gov || []; }

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
  full: { tag:'Full listing', use:'ICMA, job boards, city website' },
  short: { tag:'Short', use:'Newsletters and association briefs' },
  social: { tag:'Social', use:'LinkedIn and city channels' },
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
      <div class="sub" style="margin:0">Color</div>
      <p class="t-small">Print palettes. The brochure and the ads stay a matched packet.</p>
      <div class="schemes" role="group" aria-label="Packet color">
        ${packSchemeOptions().map(([id,label,ink]) =>
          `<button type="button" class="scheme${scheme===id?' is-on':''}" data-act="pack-scheme" data-scheme="${id}" aria-pressed="${scheme===id}" title="${esc(label)}">
            <span class="scheme__swatch" style="background:${ink}"></span>${esc(label)}
          </button>`
        ).join('')}
      </div>
    </div>
    <div>
      <div class="sub" style="margin:0">Layout</div>
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
    : `<textarea class="input ed" data-path="${esc(path)}" style="min-height:${36+rows*20}px">${esc(value||'')}</textarea>`;
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
    return editorWrap(kind, `<div class="tablewrap"><table>
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
      ${editArea('guide.council','Council / board interview', g.council,'',3)}
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
        ${photoSlot('cover','Cover','Wide landscape of the city or a landmark', photos)}
        ${photoSlot('place','Community','Main street, parks, or a neighborhood', photos)}
        ${photoSlot('org','Organization','City hall, council chambers, or staff', photos)}
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
        <div class="sub" style="margin:0">${esc(meta.tag)}</div>
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
  if (key==='plan') return `<div class="tablewrap"><table><thead><tr><th>Outlet</th><th>Audience</th><th>Format</th><th>When</th><th>Cost</th><th>Who</th><th>Status</th></tr></thead><tbody>
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
          ${docBlock('Council / board interview', g.council)}
          ${docBlock('Staff meetings', g.staff)}
          ${docBlock('Community meetings', g.community)}
          ${docBlock('Facility and community tour', g.tour)}
          ${docBlock('Presentation', g.presentation)}
          ${docBlock('Assessment exercises', g.exercises)}
          ${docBlock('Consistency', g.sameCore || a.note)}
        </div></div>` : (a.note ? `<p class="t-small">${esc(a.note)}</p>` : '')}
      ${(a.days||[]).map(d=>`
      <div class="spec"><div class="spec__bar">${esc(d.date)} · ${esc(d.title)}</div>
      <div class="tablewrap"><table><tbody>${(d.blocks||[]).map(b=>`<tr><td class="mono">${esc(b.time)}</td><td>${esc(b.what)}</td><td>${esc(b.who)}</td></tr>`).join('')}</tbody></table></div></div>`).join('')}
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
        <div><div class="sub">Council governance survey</div>${list(a.governance, x=>`<p>${esc(typeof x==='string'?x:(x.t||x.d||''))}</p>`)}</div>
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

function vCommunity(){
  const s = state.search, meta = DRAFTS.community, has = Boolean(s.artifacts?.community);
  const profileDone = (s.steps||[]).find(st=>st.key==='profile')?.status==='done';
  return shell(`
    ${head('Step '+meta.n, meta.title, meta.lede,
      `<button class="btn btn--primary" data-act="research" ${profileDone?'':'disabled'}>Research this city</button>
       <button class="btn btn--secondary" data-act="save-art" data-kind="community">Save edits</button>
       <button class="btn btn--primary" data-act="next-step" data-from="community">Next · Brochure</button>`)}
    <div class="band"><div class="wrap stack">
      ${!profileDone ? `<div class="notice notice--info"><div><div class="notice__t">Step 1 comes first</div><div class="notice__b">Adopt the candidate profile — 3 to 5 essential skills — then look up the city.</div></div></div>` : ''}
      ${modelToggle()}
      <form id="citylookup" class="grid2">
        ${field('City / jurisdiction','', `<input class="input" name="city" value="${esc(s.client||'')}" placeholder="City of Fort Collins">`)}
        ${field('Official website','http or https', `<input class="input" name="website" value="${esc(s.website||'')}" placeholder="https://www.fcgov.com">`)}
      </form>
      <p class="t-small">A research agent reads the city site, Census, and budget documents, then fills the facts on this search. It will not invent numbers. Check the file before you use it in recruiting.</p>
      ${sourceList(s.research)}
      ${(s.population || s.budget || s.fog || s.state || s.salary) ? `<div class="tiles">
        ${s.state?`<div class="tile"><span class="tile__k">State</span><span class="tile__v" style="font-size:1.15rem">${esc(s.state)}</span></div>`:''}
        ${s.fog?`<div class="tile"><span class="tile__k">Form of government</span><span class="tile__v" style="font-size:1.15rem">${esc(s.fog)}</span></div>`:''}
        ${s.population?`<div class="tile"><span class="tile__k">Population</span><span class="tile__v" style="font-size:1.15rem">${esc(s.population)}</span></div>`:''}
        ${s.budget?`<div class="tile"><span class="tile__k">Budget</span><span class="tile__v" style="font-size:1.15rem">${esc(s.budget)}</span></div>`:''}
        ${s.salary?`<div class="tile"><span class="tile__k">Salary</span><span class="tile__v" style="font-size:1.15rem">${esc(s.salary)}</span></div>`:''}
      </div><p class="t-small">Those facts are also on <button class="btn btn--ghost btn--sm" data-go="facts">Search facts</button>. Check them before you draft recruiting copy.</p>`:''}
      ${has ? renderArtifact('community', s.artifacts.community) : `<div class="notice notice--info"><div><div class="notice__t">Nothing on file yet</div><div class="notice__b">Enter the city and website, then research. Population, budget, form of government, and this profile are filled from public sources.</div></div></div>`}
      ${artifactEditor('community', s.artifacts?.community)}
      ${stepNextCard('community')}
      ${sourceJson('community', s.artifacts?.community, true)}
      ${stepFooter('community')}
    </div></div>`);
}

function vBrochure(){
  const s = state.search, meta = DRAFTS.brochure;
  const a = s.artifacts?.brochure;
  const has = brochureHasCopy(a);
  const hasComm = Boolean(s.artifacts?.community);
  return shell(`
    ${head('Step '+meta.n, meta.title, meta.lede,
      `${hasComm ? `<button class="btn btn--primary" data-act="assemble" data-kind="brochure">${has?'Refill from community':'Fill from community'}</button>` : ''}
       ${a ? `<button class="btn btn--secondary" data-act="save-art" data-kind="brochure">Save edits</button>` : ''}
       ${has ? `<button class="btn btn--secondary" data-act="print-pack" data-kind="brochure">Print brochure</button>` : ''}
       ${has ? `<button class="btn btn--ghost" data-act="generate" data-kind="brochure">Tighten with Claude</button>` : ''}
       ${nextBtn('brochure')}`)}
    <div class="band"><div class="wrap stack">
      ${!hasComm ? `<div class="notice notice--info"><div><div class="notice__t">The community file comes first</div><div class="notice__b">Step 2 research is what this packet is built from. Finish that profile, then come back. You will add pictures here, not write a second narrative.</div></div></div>` : ''}
      ${hasComm && !has ? `<div class="notice notice--info"><div><div class="notice__t">Fill from the community file</div><div class="notice__b">This step lays out the research you already have, then lets you add photos and change the design. Claude is optional after that.</div></div></div>` : ''}
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
    ${head('Step '+meta.n, meta.title, meta.lede,
      `<button class="btn btn--primary" data-act="generate" data-kind="${key}">${has?'Redraft':'Draft with Claude'}</button>
       <button class="btn btn--secondary" data-act="save-art" data-kind="${key}">Save edits</button>
       ${(key==='brochure'||key==='ads') && has ? `<button class="btn btn--secondary" data-act="print-pack" data-kind="${key}">Print for posting</button>` : ''}
       ${nextBtn(key)}`)}
    <div class="band"><div class="wrap stack">
      ${key==='ads' ? packStudioBar(s.artifacts?.brochure || {}) : ''}
      ${key==='contract' ? modelToggle() : ''}
      ${has ? renderArtifact(key, s.artifacts[key]) : `<div class="notice notice--info"><div><div class="notice__t">Nothing on file yet</div><div class="notice__b">${
        key==='ads' ? 'Draft with Claude from the brochure and the profile. Color and layout come from the brochure, so the ads stay a matched packet.'
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
  const answers = submitted.answers || {};
  if (!survey) return `<pre class="t-small">${esc(JSON.stringify(answers, null, 2))}</pre>`;
  return `<div class="stack">${(survey.questions||[]).map(q => `
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
      <td class="mono t-small">${origin}/apply/${c.invite}</td>
      <td>${state.user.role==='consultant' && c.stage==='applicant'
        ? `<button class="btn btn--secondary btn--sm" data-act="advance-semi" data-cid="${c.id}">Advance to semifinalist</button>`
        : ''}</td>
    </tr>`).join('');
  return shell(`
    ${head('Step 9','Screen candidate surveys','Review the resume and the initial survey against the adopted profile. Score each person. Advance the ones who become semifinalists, then release scores.',
      `<button class="btn btn--primary" type="submit" form="newcand">Add candidate</button>
       <button class="btn btn--secondary" data-act="toggle-release">${s.released?'Seal scores':'Release scores'}</button>
       ${nextBtn('screen')}`)}
    <div class="band"><div class="wrap stack">
      <form id="newcand" class="grid2">
        ${field('Name','', `<input class="input" name="name" placeholder="Full name" required>`)}
        ${field('Current title','', `<input class="input" name="cur">`)}
        ${field('Organization','', `<input class="input" name="org">`)}
        ${field('Email','', `<input class="input" name="email" type="email">`)}
      </form>
      <div class="tablewrap"><table>
        <thead><tr><th>Candidate</th><th>Title</th><th>Organization</th><th>Stage</th><th>Survey 1</th><th>Applicant link</th><th></th></tr></thead>
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
      <td>${c.survey2SentAt ? 'Sent '+(c.survey2SentAt||'').slice(0,10) : 'Not sent'}</td>
      <td>${esc(c.survey2Deadline||'—')}</td>
      <td>${c.survey2?'In':'Waiting'}</td>
      <td>${state.user.role==='consultant' && !c.survey2
        ? `<button class="btn btn--secondary btn--sm" data-act="send2-one" data-cid="${c.id}">${c.survey2SentAt?'Send again':'Send survey'}</button>`
        : ''}</td>
    </tr>`).join('');
  return shell(`
    ${head('Step 10','Send semifinalist survey','Optional. Send the questionnaire only after you have named semifinalists. It does not appear on their apply link until you send it.',
      (state.user.role==='consultant' ? `<button class="btn btn--primary" data-act="send2-all">Send to all semifinalists</button>` : '')+' '+nextBtn('send2'))}
    <div class="band"><div class="wrap stack">
      ${!s.artifacts?.survey2 ? `<div class="notice notice--info"><div><div class="notice__t">Survey not drafted yet</div><div class="notice__b">Finish Step 8, then send it from this page.</div></div></div>` : ''}
      ${field('Deadline','Shown to candidates when you send.', `<input class="input" id="send2-deadline" placeholder="Respond by 12 Sep 2026">`)}
      <div class="tablewrap"><table>
        <thead><tr><th>Semifinalist</th><th>Stage</th><th>Sent</th><th>Deadline</th><th>Response</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6">No semifinalists yet. Advance people from Step 9.</td></tr>`}</tbody>
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
        ${state.user.role==='consultant' && c.stage==='semifinalist'
          ? `<div class="row"><button class="btn btn--primary" data-act="advance-final" data-cid="${c.id}">Advance to finalist</button></div>`
          : ''}
      </div>
    </div>`).join('');
  return shell(`
    ${head('Step 11','Select finalists','Read the semifinalist responses against the competencies in Step 1. Do not introduce new criteria here.',
      `<button class="btn btn--secondary" data-go="screen">Back to screening</button>
       ${nextBtn('finalists')}`)}
    <div class="band"><div class="wrap stack">
      ${cards || `<div class="empty"><div class="empty__t">No semifinalists yet</div>Screen and advance people in Step 9, then send the second survey in Step 10.</div>`}
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
       ${state.user.role==='consultant' && nextStage ? `<button class="btn btn--primary" data-act="advance" data-stage="${nextStage}">${nextLabel}</button>` : ''}`)}
    <div class="band"><div class="wrap stack">
      ${sealed?`<div class="seal">${ico('lock')}<div><div class="empty__t">Other scores are sealed</div><div class="t-small">Enter your scores. You will see the rest of the panel after scores are released.</div></div></div>`:''}
      ${(s.criteria||[]).map(cr => `
        <div class="crit-row" style="grid-template-columns:3.2em minmax(0,1fr) auto">
          <span class="mono t-small">${esc(cr.id)}</span>
          <div><b>${esc(cr.label)}</b><div class="t-small">${esc(cr.note||'')}</div></div>
          <div class="wgt">${[1,2,3,4,5].map(n=>`<button type="button" data-score="${cr.id}" data-val="${n}" aria-pressed="${Number(mine[cr.id])===n}">${n}</button>`).join('')}</div>
        </div>`).join('')}
      ${!sealed && others.length ? `<div class="spec"><div class="spec__bar">Released panel scores</div><div class="spec__body">${others.map(row => `<div class="t-small"><b>${esc(row.name)}</b> — ${Object.entries(row.scores).map(([id,n])=>id+': '+n).join(', ')}</div>`).join('')}</div></div>`:''}
      ${field('Note to the file','', `<textarea class="input ed" id="cnote">${esc(note)}</textarea>`)}
      <button class="btn btn--primary" data-act="save-score">Save my scores</button>
      ${c.survey1 ? `<div class="sub">Initial survey</div>${surveyRead(s.artifacts?.survey1, c.survey1)}` : ''}
    </div></div>`);
}

function pickApplySurvey(a){
  if (a.survey1 && !a.submitted1) return 'survey1';
  if (a.survey2 && !a.submitted2) return 'survey2';
  if (a.submitted1 || a.submitted2) return 'done';
  return 'none';
}

function vApply(){
  const a = state.apply;
  if (!a) return `<div class="apply-shell"><h1 class="t-title">This link is not valid</h1><p class="lede">Ask the search team for a new invitation.</p></div>`;
  const which = pickApplySurvey(a);
  if (which === 'none') return `<div class="apply-shell">${head(a.client,'The survey is not open yet','The search team has not published a questionnaire yet.')}</div>`;
  if (which === 'done') return `<div class="apply-shell">${head(a.client,'Received','Thank you. Your responses are on the search file.')}<div class="notice notice--ok"><div><div class="notice__t">You can close this page.</div></div></div></div>`;
  const survey = a[which];
  const title = which === 'survey2' ? 'Semifinalist questionnaire' : 'Initial candidate survey';
  const due = which === 'survey2' && a.deadline2 ? ` Respond by ${esc(a.deadline2)}.` : '';
  return `<div class="apply-shell">
    ${head(a.client, title, esc(survey.intro||'')+due)}
    <form id="applyform" class="stack" style="margin-top:var(--s-5)" data-which="${which}">
      ${(survey.questions||[]).map(q => `
        <div class="q">
          <div class="q__hd"><span class="q__n">${String(q.n).padStart(2,'0')}</span><span class="q__t">${esc(q.prompt)}${q.required?' <span class="req">*</span>':''}</span></div>
          <div class="q__bd"><textarea class="input ed" name="q${q.n}" ${q.required?'required':''}></textarea></div>
        </div>`).join('')}
      <button class="btn btn--primary" type="submit">Submit questionnaire</button>
    </form>
  </div>`;
}

function page(){
  if (location.pathname.startsWith('/apply/')) return vApply();
  if (!state.user) return vLogin();
  if (state.view === 'community') return vCommunity();
  if (state.view === 'brochure') return vBrochure();
  if (DRAFTS[state.view]) return vDraft(state.view);
  switch (state.view){
    case 'home': return vHome();
    case 'new': return vNew();
    case 'overview': return vOverview();
    case 'facts': return vFacts();
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
  $('.shell')?.classList.add('busy');
  if (wait !== false) showWait(wait || waitSave());
  try { await fn(); }
  catch (err) { toast(err.message); }
  finally {
    hideWait();
    state.busy = false;
    render();
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
      toast('Finish Step 1 first: '+gaps.join(', ')+'.');
      return false;
    }
  }
  await withBusy(async () => {
    state.search = await api('/api/searches/'+state.search.id+'/profile', { method:'PUT', body:{ criteria } });
    if (moveOn){
      toast('Profile saved. On to the community profile.');
      go('community');
    } else {
      toast('Profile saved. Later steps can now inherit it.');
    }
  }, waitSave(moveOn ? 'Saving and moving on' : 'Saving the profile'));
  return true;
}

document.addEventListener('change', e => {
  if (e.target.id === 'premium') state.premium = e.target.checked;
  if (e.target.dataset.photo) uploadBrochurePhoto(e.target.dataset.photo, e.target.files?.[0]);
});

document.addEventListener('click', async e => {
  const t = e.target.closest('[data-go],[data-open],[data-act],[data-add],[data-del],[data-w],[data-theme],[data-cand],[data-score],[data-pick]');
  if (!t) return;

  if (t.dataset.theme){
    const v = t.dataset.theme;
    if (v==='auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', v);
    $$('[data-theme]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.theme===v)));
    return;
  }
  if (t.dataset.go){
    if (t.dataset.go==='home'){ state.search = null; await go('home'); return; }
    await go(t.dataset.go); return;
  }
  if (t.dataset.open){
    const id = t.dataset.open;
    await withBusy(async () => {
      await loadSearch(id);
    }, waitSave('Opening the search'));
    if (state.search && state.search.id === id) go('overview');
    return;
  }
  if (t.dataset.cand){
    state.sel = t.dataset.cand;
    go('person'); return;
  }
  if (t.dataset.pick){
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
      state.search.criteria.push({ id: nextCritId(kind), kind, label, weight:3, note:'' });
    }
    render(); return;
  }
  if (t.dataset.add){
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
    collectCriteria();
    state.search.criteria.splice(Number(t.dataset.del), 1);
    render(); return;
  }
  if (t.dataset.w){
    const row = t.closest('[data-row]');
    if (row){
      collectCriteria();
      state.search.criteria[Number(row.dataset.row)].weight = Number(t.dataset.w);
      render();
    }
    return;
  }
  if (t.dataset.score){
    t.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed','false'));
    t.setAttribute('aria-pressed','true');
    return;
  }

  const act = t.dataset.act;
  if (act==='logout'){
    showWait(waitSave('Signing out'));
    try {
      await api('/api/logout', { method:'POST', body:{} });
      state.user = null; state.search = null;
    } catch (err) { toast(err.message); }
    finally { hideWait(); render(); }
    return;
  }
  if (act==='delete-search'){
    const id = t.dataset.id;
    const name = t.dataset.name || 'this search';
    if (!id) return;
    if (!confirm('Delete '+name+'? This cannot be undone.')) return;
    await withBusy(async () => {
      await api('/api/searches/'+id, { method:'DELETE', body:{} });
      if (state.search && state.search.id===id) state.search = null;
      await loadSearches();
      toast('Deleted.');
      go('home');
    });
    return;
  }
  if (act==='create'){
    await createSearch();
    return;
  }
  if (act==='research'){
    const profileDone = (state.search.steps||[]).find(st=>st.key==='profile')?.status==='done';
    if (!profileDone){
      toast('Adopt the candidate profile first (Step 1).');
      go('profile');
      return;
    }
    const form = $('#citylookup') || $('#facts');
    const body = form ? Object.fromEntries(new FormData(form).entries()) : {};
    state.premium = $('#premium')?.checked || false;
    const city = String(body.city || body.client || state.search.client || '').trim();
    const website = String(body.website || state.search.website || '').trim();
    await withLookup(city, website, async () => {
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
      toast('Drafted on '+out.model+'. Edit weights, then save.');
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
      toast(kind==='brochure' ? 'Tightened on '+out.model+'. Photos and layout stayed put.' : 'Drafted on '+out.model+'.');
    }, waitFor(kind));
    return;
  }
  if (act==='assemble'){
    await withBusy(() => fillBrochureFromCommunity(), {
      kicker: 'Brochure',
      title: 'Filling from the community file',
      copy: 'Rebuilding the packet from Step 2 research and the adopted profile. Photos and layout stay put.',
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
  if (act==='send2-one' || act==='send2-all'){
    const deadline = $('#send2-deadline')?.value || '';
    const path = act==='send2-all'
      ? '/api/searches/'+state.search.id+'/send2'
      : '/api/searches/'+state.search.id+'/candidates/'+t.dataset.cid+'/send2';
    await withBusy(async () => {
      state.search = await api(path, { method:'POST', body:{ deadline } });
      toast(act==='send2-all' ? 'Semifinalist survey sent.' : 'Survey sent.');
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
      await api('/api/apply/'+token, { method:'POST', body:{ which, answers } });
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
    if (!state.search) return;
    go('profile');
    toast('Search '+state.search.no+' is open. Select 3 to 5 essential skills.');
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
