'use strict';

/**
 * The public careers portal.
 *
 * Deliberately its own small application rather than a mode of public/app.js.
 * The staff client is half a megabyte of workspace, search, committee and
 * scoring code with an identity provider attached, and none of that has any
 * business being loaded into a page a member of the public opens to read a job
 * advertisement. Keeping them apart also means there is no code path here that
 * could reach a search record even by mistake: this file knows about postings,
 * one application, and nothing else.
 *
 * It shares the token layer in styles.css and the help runtime in help.js, so
 * the two halves of the product look like one product and the candidate guide
 * has one source.
 *
 * Routing is by real path, not a hash, because these addresses go in job
 * advertisements and have to survive being pasted into anything:
 *
 *   /careers                          the firms with openings
 *   /careers/:firm                    that firm's openings
 *   /careers/:firm/:posting           one job page
 *   /careers/:firm/:posting/apply     the application
 */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * A stored date, as a person reads it.
 *
 * Parsed by hand rather than through `new Date('2026-11-14')`, which is
 * midnight UTC: formatted anywhere west of Greenwich that renders as the 13th,
 * and a closing date that shows a day early is the kind of error somebody
 * misses a deadline over. A plain date has no timezone, and this keeps it that
 * way.
 */
function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  return Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1];
}

/**
 * An instant, in the timezone the posting states.
 *
 * Receipts are stored in UTC. Printing the UTC clock time beside the label
 * "America/Phoenix" is not a formatting nicety to get wrong — it is a receipt
 * that claims an application arrived seven hours after it did, which is the
 * difference between inside and outside a deadline. The conversion is real,
 * and it falls back to saying UTC when the posting names no zone or names one
 * this browser does not know.
 */
function stamp(iso, timezone) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return String(iso || '');
  const parts = { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  if (timezone) {
    try {
      return new Intl.DateTimeFormat('en-GB', { ...parts, timeZone: timezone }).format(at)
        + ' (' + timezone + ')';
    } catch { /* an unknown zone falls through to UTC rather than lying */ }
  }
  return new Intl.DateTimeFormat('en-GB', { ...parts, timeZone: 'UTC' }).format(at) + ' (UTC)';
}

/** Authored text with paragraph breaks. Escaped first; never trusted as markup. */
function paras(text) {
  const blocks = String(text || '').split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  if (!blocks.length) return '';
  return blocks.map(b => `<p>${esc(b).replace(/\n/g, '<br>')}</p>`).join('');
}

const state = {
  route: null,
  firms: null,
  listing: null,
  posting: null,
  apply: null,          // { available, reason, uploads }
  session: { verified: false, email: null },
  application: null,
  formChanged: null,
  step: 'form',         // form | review | done
  verifyStage: 'email', // email | code
  verifyEmail: '',
  notice: null,
  error: null,
  busy: false,
  saveState: 'clean',   // clean | dirty | saving | saved | failed
  savedAt: null,
  dirty: false,
  receipt: null,
  confirmation: null,
  query: '',
  place: ''
};

/* --- plumbing ------------------------------------------------------------- */

let toastTimer = null;
function toast(message) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 5200);
}

async function api(path, opts = {}) {
  const { method = 'GET', body } = opts;
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || res.statusText);
    error.status = res.status;
    error.detail = data;
    throw error;
  }
  return data;
}

function parseRoute() {
  const parts = location.pathname.split('/').filter(Boolean);
  // ['careers'] | ['careers', firm] | ['careers', firm, posting] | + 'apply'
  if (parts[0] !== 'careers') return { view: 'firms' };
  if (!parts[1]) return { view: 'firms' };
  if (!parts[2]) return { view: 'listing', firm: parts[1] };
  if (parts[3] === 'apply') return { view: 'apply', firm: parts[1], posting: parts[2] };
  return { view: 'posting', firm: parts[1], posting: parts[2] };
}

function go(path, { replace = false } = {}) {
  if (state.dirty && !confirm('Leave this page and lose what you have not saved?')) return;
  state.dirty = false;
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  boot();
}

window.addEventListener('popstate', () => boot());

/* --- shared pieces --------------------------------------------------------- */

function masthead(trail) {
  return `<header class="careers__bar">
    <a class="careers__brand" href="/careers">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 20h16M6 20V9l6-4 6 4v11M10 20v-5h4v5"/></svg>
      <span>Careers</span>
    </a>
    <nav class="careers__crumbs" aria-label="Breadcrumb">${trail.map((c, i) =>
      i === trail.length - 1
        ? `<span aria-current="page">${esc(c.label)}</span>`
        : `<a href="${esc(c.href)}" data-nav>${esc(c.label)}</a><span class="careers__dot" aria-hidden="true">·</span>`
    ).join('')}</nav>
    <button type="button" class="btn btn--ghost btn--sm" data-act="help">Help for applicants</button>
  </header>`;
}

function supportBlock(support, { heading = 'If you need help' } = {}) {
  if (!support) return '';
  return `<section class="careers__support">
    <h2 class="t-section">${esc(heading)}</h2>
    ${support.configured
      ? `<p>Contact the search team about this posting, including if you need an accommodation to apply.</p>
         <ul class="careers__contact">
           ${support.email ? `<li><a href="mailto:${esc(support.email)}">${esc(support.email)}</a></li>` : ''}
           ${support.phone ? `<li>${esc(support.phone)}</li>` : ''}
           ${support.hours ? `<li class="t-small">${esc(support.hours)}</li>` : ''}
         </ul>`
      : `<p>No support contact has been published for this posting.</p>`}
  </section>`;
}

function stateBadge(posting) {
  if (posting.accepting) return `<span class="pill pill--ok">Accepting applications</span>`;
  if (posting.state === 'paused') return `<span class="pill pill--wait">Not accepting applications right now</span>`;
  return `<span class="pill pill--idle">Closed to new applications</span>`;
}

function deadlineLine(posting) {
  const d = posting.deadline;
  if (!d) return '';
  const zone = d.timezone ? ' (' + esc(d.timezone) + ')' : '';
  if (d.kind === 'hard') {
    return `<p><b>Closing date:</b> ${esc(longDate(d.closesAt))}${zone}. ${esc(d.note)}</p>`;
  }
  return `<p><b>Open until filled.</b>${d.firstReviewOn
    ? ' First review of applications begins ' + esc(longDate(d.firstReviewOn)) + zone + '.' : ''} ${esc(d.note)}</p>`;
}

/* --- screens --------------------------------------------------------------- */

function vFirms() {
  const firms = state.firms || [];
  return masthead([{ label: 'Openings' }]) + `<div class="careers__wrap">
    <h1 class="careers__h1">Current openings</h1>
    <p class="lede">Each recruiting firm below is running searches that are open to applications.</p>
    ${firms.length ? `<ul class="careers__firms">${firms.map(f => `<li>
      <a class="careers__card" href="/careers/${esc(f.slug)}" data-nav>
        <span class="careers__cardt">${esc(f.name)}</span>
        <span class="careers__cards">${f.postings} open position${f.postings === 1 ? '' : 's'}</span>
      </a></li>`).join('')}</ul>`
      : `<div class="careers__empty"><p><b>No openings are published right now.</b></p>
         <p>Nothing is listed here until a recruiting firm publishes a position. Check back, or contact the firm directly.</p></div>`}
  </div>`;
}

function vListing() {
  const listing = state.listing;
  if (!listing) return '';
  const firm = listing.firm;
  const rows = listing.postings || [];
  return masthead([
    { label: 'Openings', href: '/careers' },
    { label: firm?.name || 'Openings' }
  ]) + `<div class="careers__wrap">
    <h1 class="careers__h1">${esc(firm?.name || 'Openings')}</h1>
    <p class="lede">Positions this firm is currently recruiting for.</p>

    <form class="careers__filters" id="filters">
      <label class="careers__field"><span>Search</span>
        <input class="input" type="search" name="q" value="${esc(state.query)}" placeholder="Position or employer" autocomplete="off"></label>
      <label class="careers__field"><span>Location</span>
        <input class="input" type="search" name="location" value="${esc(state.place)}" placeholder="City or state" autocomplete="off"></label>
      <button class="btn btn--secondary" type="submit">Filter</button>
      ${state.query || state.place ? `<button class="btn btn--ghost" type="button" data-act="clear-filters">Clear</button>` : ''}
    </form>

    ${rows.length ? `<ul class="careers__jobs">${rows.map(p => `<li>
      <a class="careers__job" href="/careers/${esc(p.firmSlug)}/${esc(p.slug)}" data-nav>
        <span class="careers__jobt">${esc(p.title)}</span>
        <span class="careers__jobm">${esc(p.employer)}${p.location ? ' · ' + esc(p.location) : ''}</span>
        <span class="careers__jobst">${stateBadge(p)}${p.closesAt
          ? `<span class="t-small">Closes ${esc(longDate(p.closesAt))}${p.timezone ? ' (' + esc(p.timezone) + ')' : ''}</span>`
          : p.firstReviewOn
            ? `<span class="t-small">Open until filled · first review ${esc(longDate(p.firstReviewOn))}</span>`
            : `<span class="t-small">Open until filled</span>`}</span>
      </a></li>`).join('')}</ul>`
      : `<div class="careers__empty">
          <p><b>${state.query || state.place ? 'Nothing matches that.' : 'No openings are published right now.'}</b></p>
          <p>${state.query || state.place
            ? 'Clear the filters to see every open position from this firm.'
            : 'This firm has no positions open to applications at the moment.'}</p>
        </div>`}
  </div>`;
}

function vPosting() {
  const p = state.posting;
  if (!p) return '';
  const apply = state.apply || {};
  return masthead([
    { label: 'Openings', href: '/careers' },
    { label: state.firmName || 'Firm', href: '/careers/' + p.firmSlug },
    { label: p.title }
  ]) + `<div class="careers__wrap careers__wrap--job">
    <article class="careers__jobpage">
      <p class="eyebrow">${esc(p.employer)}${p.location ? ' · ' + esc(p.location) : ''}</p>
      <h1 class="careers__h1">${esc(p.title)}</h1>
      <div class="careers__badges">${stateBadge(p)}</div>
      ${p.compensation ? `<p class="careers__comp"><b>Compensation:</b> ${esc(p.compensation)}</p>` : ''}
      ${deadlineLine(p)}

      ${p.summaryText ? `<section><h2 class="t-section">About this position</h2>${paras(p.summaryText)}</section>` : ''}
      ${p.responsibilities ? `<section><h2 class="t-section">Responsibilities</h2>${paras(p.responsibilities)}</section>` : ''}
      ${p.qualifications ? `<section><h2 class="t-section">Qualifications</h2>${paras(p.qualifications)}</section>` : ''}

      <section><h2 class="t-section">How to apply</h2>
        ${paras(p.applicationInstructions)}
        ${p.materials.length ? `<p><b>What you will need:</b></p><ul class="careers__mats">${p.materials.map(m =>
          `<li>${esc(m.label)}${m.required ? ' <span class="t-small">(required)</span>' : ' <span class="t-small">(optional)</span>'}${
            m.note ? `<br><span class="t-small">${esc(m.note)}</span>` : ''}</li>`).join('')}</ul>` : ''}
        ${p.questions.length ? `<p class="t-small">The application asks ${p.questions.length} question${p.questions.length === 1 ? '' : 's'} about your experience.</p>` : ''}
      </section>

      <div class="careers__apply">
        ${apply.available
          ? `<a class="btn btn--primary" href="/careers/${esc(p.firmSlug)}/${esc(p.slug)}/apply" data-nav>Apply for this position</a>
             <a class="btn btn--secondary" href="/careers/${esc(p.firmSlug)}/${esc(p.slug)}/apply" data-nav>Return to my application</a>
             <p class="t-small">You do not need an account. You verify your email address, and that is how you come back to a saved application.</p>`
          : `<div class="notice notice--wait" role="status"><div>
               <div class="notice__t">Applications are not open here</div>
               <div class="notice__b">${esc(apply.reason || 'This posting is not accepting applications.')}</div>
             </div></div>`}
      </div>

      ${p.privacyNotice ? `<section class="careers__privacy"><h2 class="t-section">Privacy</h2>${paras(p.privacyNotice)}</section>` : ''}
      ${supportBlock(p.support)}
      <p class="t-small careers__stamp">Posted ${esc(longDate(p.publishedAt))}. This page shows version ${esc(p.version)} of this posting.</p>
    </article>
  </div>`;
}

/* --- the application ------------------------------------------------------- */

function vVerify() {
  const p = state.posting;
  return `<div class="careers__wrap careers__wrap--narrow">
    <h1 class="careers__h1">${state.verifyStage === 'email' ? 'Verify your email address' : 'Enter your code'}</h1>
    ${p ? `<p class="lede">${esc(p.title)} · ${esc(p.employer)}</p>` : ''}
    ${state.notice ? `<div class="notice notice--ok" role="status"><div><div class="notice__b">${esc(state.notice)}</div></div></div>` : ''}
    ${state.error ? `<div class="notice notice--stop" role="alert"><div><div class="notice__b">${esc(state.error)}</div></div></div>` : ''}
    ${state.verifyStage === 'email'
      ? `<form id="verifyform" class="careers__form">
          <p>Your email address is how you save an application and come back to it. There is no password to create and none to lose.</p>
          <label class="careers__field"><span>Email address</span>
            <input class="input" type="email" name="email" required autocomplete="email"
              value="${esc(state.verifyEmail)}" placeholder="you@example.com"></label>
          <div class="careers__acts">
            <button class="btn btn--primary" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Sending…' : 'Send me a code'}</button>
          </div>
          <p class="t-small">We send a six-digit code. It expires in 15 minutes and can be used once.</p>
        </form>`
      : `<form id="codeform" class="careers__form">
          <p>Enter the code sent to <b>${esc(state.verifyEmail)}</b>. Check your spam folder if it has not arrived.</p>
          <label class="careers__field"><span>Six-digit code</span>
            <input class="input" type="text" name="code" required inputmode="numeric" autocomplete="one-time-code"
              pattern="[0-9]{6}" maxlength="6" placeholder="000000"></label>
          <div class="careers__acts">
            <button class="btn btn--primary" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Checking…' : 'Verify and continue'}</button>
            <button class="btn btn--ghost" type="button" data-act="resend" ${state.busy ? 'disabled' : ''}>Send another code</button>
            <button class="btn btn--ghost" type="button" data-act="change-email">Use a different address</button>
          </div>
        </form>`}
    ${supportBlock(p?.support)}
  </div>`;
}

/**
 * What the save state says, beside the control that saves.
 *
 * Every branch ends with the same promise. It is the one sentence on this
 * screen an applicant has to have read — saving is not applying — and an
 * earlier version dropped it the moment they started typing, which is exactly
 * when it matters.
 */
function saveStateText() {
  const promise = 'Your application is not submitted until you select Submit application.';
  if (state.saveState === 'saving') return 'Saving… ' + promise;
  if (state.saveState === 'failed') {
    return 'That save did not go through. Your answers are still on this page — do not reload until you have copied anything long.';
  }
  if (state.saveState === 'dirty') return 'Not saved yet. ' + promise;
  if (state.saveState === 'saved' && state.savedAt) {
    return 'Draft saved ' + stamp(state.savedAt, state.posting?.deadline?.timezone) + '. ' + promise;
  }
  return 'Saving is not applying. ' + promise;
}

/**
 * What is still outstanding, worked out from what is on the page now.
 *
 * The server decides this at submit and is the authority; this is the live
 * hint, and it has to track the form or it tells somebody they still owe a
 * name they have just typed. Kept in step by absorb() on every keystroke.
 */
function missingNow() {
  const a = state.application;
  if (!a || a.state !== 'draft') return [];
  const out = [];
  if (!String(a.answers.name || '').trim()) out.push('Your name');
  for (const q of a.form.questions) {
    if (q.required && !String(a.answers.responses?.[q.key] || '').trim()) out.push(q.prompt);
  }
  for (const m of a.form.materials) {
    if (m.required && !(a.files || []).some(f => f.materialKey === m.key)) out.push(m.label);
  }
  return out;
}

function vForm() {
  const p = state.posting;
  const a = state.application;
  const answers = a.answers;
  const missing = missingNow();
  const expires = a.expiresAt ? longDate(a.expiresAt) : null;

  return `<div class="careers__wrap careers__wrap--narrow">
    <h1 class="careers__h1">Apply: ${esc(p.title)}</h1>
    <p class="lede">${esc(p.employer)}${p.location ? ' · ' + esc(p.location) : ''}</p>

    ${a.reopened ? `<div class="notice notice--info" role="status"><div>
      <div class="notice__t">The search team reopened this application so you can correct it</div>
      <div class="notice__b">${esc(a.reopened.reason || '')} Your original submission is kept on their record. Submit again when you are ready.</div>
    </div></div>` : ''}

    ${state.formChanged ? `<div class="notice notice--${state.formChanged.material ? 'wait' : 'info'}" role="status"><div>
      <div class="notice__t">This application form changed since you started</div>
      <div class="notice__b">
        ${state.formChanged.added.length ? `<p>New questions: ${esc(state.formChanged.added.join('; '))}.</p>` : ''}
        ${state.formChanged.nowRequired.length ? `<p>Now required: ${esc(state.formChanged.nowRequired.join('; '))}.</p>` : ''}
        ${state.formChanged.removed.length ? `<p>No longer asked: ${esc(state.formChanged.removed.join('; '))}. Anything you wrote for those is kept, not deleted.</p>` : ''}
        ${state.formChanged.materials.length ? `<p>Now required to attach: ${esc(state.formChanged.materials.join('; '))}.</p>` : ''}
        ${state.formChanged.material
          ? '<p>You cannot submit until you have seen the updated form. Nothing you have written will be lost.</p>'
          : '<p>The wording changed; the questions themselves are the same. Nothing you wrote is affected.</p>'}
        <button type="button" class="btn btn--secondary btn--sm" data-act="adopt-form">Show me the updated form</button>
      </div>
    </div></div>` : ''}

    ${state.error ? `<div class="notice notice--stop" role="alert"><div><div class="notice__b">${esc(state.error)}</div></div></div>` : ''}

    <form id="appform" class="careers__form">
      <fieldset class="careers__group">
        <legend class="t-section">About you</legend>
        <label class="careers__field"><span>Full name <span class="req" aria-hidden="true">*</span></span>
          <input class="input" name="name" required autocomplete="name" value="${esc(answers.name)}"
            aria-describedby="hint-name">
          <span class="careers__hint" id="hint-name">The name you want the search team to use.</span></label>
        <label class="careers__field"><span>Email address</span>
          <input class="input" name="email" value="${esc(answers.email)}" readonly aria-describedby="hint-email">
          <span class="careers__hint" id="hint-email">The address you verified. It is how you get back to this application, so it cannot be changed here.</span></label>
        <label class="careers__field"><span>Phone</span>
          <input class="input" name="phone" autocomplete="tel" value="${esc(answers.phone)}"></label>
        <label class="careers__field"><span>Where you are based</span>
          <input class="input" name="location" autocomplete="address-level2" value="${esc(answers.location)}"
            placeholder="City, State"></label>
        <label class="careers__field"><span>Relevant professional background</span>
          <textarea class="input ed" name="background" rows="6" aria-describedby="hint-bg">${esc(answers.background)}</textarea>
          <span class="careers__hint" id="hint-bg">A short summary of the experience that is relevant to this position.</span></label>
      </fieldset>

      ${a.form.questions.length ? `<fieldset class="careers__group">
        <legend class="t-section">Questions from the search team</legend>
        ${a.form.questions.map(q => `<label class="careers__field">
          <span>${esc(q.prompt)}${q.required ? ' <span class="req" aria-hidden="true">*</span>' : ''}</span>
          <textarea class="input ed" name="q:${esc(q.key)}" rows="5" ${q.required ? 'required aria-required="true"' : ''}
            ${q.help ? `aria-describedby="hint-${esc(q.key)}"` : ''}>${esc(answers.responses?.[q.key] || '')}</textarea>
          ${q.help ? `<span class="careers__hint" id="hint-${esc(q.key)}">${esc(q.help)}</span>` : ''}
        </label>`).join('')}
      </fieldset>` : ''}

      ${a.form.materials.length ? `<fieldset class="careers__group">
        <legend class="t-section">Materials</legend>
        ${state.apply?.uploads
          ? a.form.materials.map(m => {
            const held = (a.files || []).filter(f => f.materialKey === m.key);
            return `<div class="careers__material">
              <div class="careers__matname">${esc(m.label)}${m.required ? ' <span class="req" aria-hidden="true">*</span>' : ' <span class="t-small">(optional)</span>'}</div>
              ${m.note ? `<p class="careers__hint">${esc(m.note)}</p>` : ''}
              ${held.length ? `<ul class="careers__files">${held.map(f => `<li>
                <span>${esc(f.label)}</span>
                <span class="t-small">${esc(f.note)}</span>
                <button type="button" class="btn btn--ghost btn--sm" data-act="drop-file" data-fid="${esc(f.id)}">Remove</button>
              </li>`).join('')}</ul>` : ''}
              <input type="file" class="careers__file" accept="application/pdf"
                data-material="${esc(m.key)}" aria-label="Attach ${esc(m.label)}">
              <p class="t-small">${m.note ? '' : 'PDF, up to 8 MB. '}If you cannot produce a PDF, use the support contact below and the search team will arrange another way.</p>
            </div>`;
          }).join('')
          : `<p class="notice notice--info">This service is not accepting file uploads. Follow the instructions on the posting for sending your materials.</p>`}
      </fieldset>` : ''}

      <div class="careers__bar" role="group" aria-label="Save and continue">
        <button class="btn btn--primary" type="button" data-act="review">Review and submit</button>
        <button class="btn btn--secondary" type="button" data-act="save">Save draft</button>
        <span class="careers__savestate ${state.saveState === 'failed' ? 'careers__savestate--bad' : ''}" role="status">${esc(saveStateText())}</span>
      </div>
      <p class="t-small careers__missing">${missing.length
        ? 'Still needed before you can submit: ' + esc(missing.join('; ')) + '.' : ''}</p>
      ${expires ? `<p class="t-small">If you do not come back, this draft is removed on ${esc(expires)}. Saving again puts that date back.</p>` : ''}
    </form>
    ${supportBlock(p?.support)}
  </div>`;
}

function vReview() {
  const p = state.posting;
  const a = state.application;
  const answers = a.answers;
  const missing = missingNow();
  const row = (label, value) => `<div class="careers__rrow">
    <dt>${esc(label)}</dt><dd>${value ? esc(value).replace(/\n/g, '<br>') : '<span class="t-small">Not answered</span>'}</dd></div>`;

  return `<div class="careers__wrap careers__wrap--narrow">
    <h1 class="careers__h1">Review your application</h1>
    <p class="lede">${esc(p.title)} · ${esc(p.employer)}</p>
    ${state.error ? `<div class="notice notice--stop" role="alert"><div><div class="notice__b">${esc(state.error)}</div></div></div>` : ''}

    <dl class="careers__review">
      ${row('Name', answers.name)}
      ${row('Email', answers.email)}
      ${row('Phone', answers.phone)}
      ${row('Based in', answers.location)}
      ${row('Relevant background', answers.background)}
      ${a.form.questions.map(q => row(q.prompt, answers.responses?.[q.key])).join('')}
      <div class="careers__rrow"><dt>Materials</dt><dd>${(a.files || []).length
        ? `<ul>${a.files.map(f => `<li>${esc(f.label)} <span class="t-small">${esc(f.note)}</span></li>`).join('')}</ul>`
        : '<span class="t-small">None attached</span>'}</dd></div>
    </dl>

    <section class="careers__declare">
      <h2 class="t-section">Before you submit</h2>
      <ul>
        <li>Your application goes to the search team at ${esc(state.firmName || 'the recruiting firm')}. It is not visible to other applicants.</li>
        <li>Once submitted it is a fixed record. If you need to change something afterwards, contact the search team and they can reopen it.</li>
        <li>You will get a reference number. It confirms your application arrived; it is not a decision about it.</li>
      </ul>
      ${p.privacyNotice ? `<details class="careers__details"><summary>Privacy notice</summary>${paras(p.privacyNotice)}</details>` : ''}
    </section>

    ${missing.length ? `<div class="notice notice--wait" role="status"><div>
      <div class="notice__t">Not finished yet</div>
      <div class="notice__b">Still needed: ${esc(missing.join('; '))}.</div></div></div>` : ''}

    <div class="careers__bar">
      <button class="btn btn--primary" type="button" data-act="submit" ${state.busy || missing.length ? 'disabled' : ''}>
        ${state.busy ? 'Submitting…' : 'Submit application'}</button>
      <button class="btn btn--secondary" type="button" data-act="back-to-form">Back to the form</button>
    </div>
    ${supportBlock(p?.support)}
  </div>`;
}

function vDone() {
  const p = state.posting;
  const receipt = state.receipt;
  return `<div class="careers__wrap careers__wrap--narrow">
    <div class="notice notice--ok" role="status"><div>
      <div class="notice__t">Your application was received</div>
      <div class="notice__b">${esc(state.confirmation || '')}</div>
    </div></div>
    <h1 class="careers__h1">Application received</h1>
    <p class="lede">${esc(p.title)} · ${esc(p.employer)}</p>
    <dl class="careers__receipt">
      <div class="careers__rrow"><dt>Reference</dt><dd class="mono">${esc(receipt.reference)}</dd></div>
      <div class="careers__rrow"><dt>Received</dt><dd>${esc(stamp(receipt.submittedAt, receipt.timezone))}</dd></div>
      <div class="careers__rrow"><dt>Materials received</dt><dd>${receipt.materials.length
        ? esc(receipt.materials.map(m => m.label).join(', ')) : '<span class="t-small">None</span>'}</dd></div>
    </dl>
    <p><b>Keep this reference number.</b> ${esc(receipt.note)} The search team will contact you directly about next steps.</p>
    <div class="careers__bar">
      <a class="btn btn--secondary" href="/careers/${esc(p.firmSlug)}/${esc(p.slug)}" data-nav>Back to the posting</a>
      <button type="button" class="btn btn--ghost" data-act="signout">Sign out of this device</button>
    </div>
    <p class="t-small">Signing out matters on a shared or borrowed computer: it is what stops the next person opening your application.</p>
    ${supportBlock(p?.support)}
  </div>`;
}

function vApply() {
  const p = state.posting;
  const trail = [
    { label: 'Openings', href: '/careers' },
    { label: state.firmName || 'Firm', href: '/careers/' + state.route.firm },
    { label: p ? p.title : 'Position', href: '/careers/' + state.route.firm + '/' + state.route.posting },
    { label: 'Apply' }
  ];
  let body;
  if (!state.session.verified) body = vVerify();
  else if (state.step === 'done' && state.receipt) body = vDone();
  else if (!state.application) body = vStart();
  else if (state.application.state === 'submitted') body = vSubmitted();
  else if (state.step === 'review') body = vReview();
  else body = vForm();
  return masthead(trail) + body;
}

function vStart() {
  const p = state.posting;
  const accepting = state.apply?.available;
  return `<div class="careers__wrap careers__wrap--narrow">
    <h1 class="careers__h1">${accepting ? 'Start your application' : 'Applications are closed'}</h1>
    <p class="lede">${esc(p?.title || '')}</p>
    <p>You are verified as <b>${esc(state.session.email)}</b>. There is no application from this address for this position yet.</p>
    ${state.error ? `<div class="notice notice--stop" role="alert"><div><div class="notice__b">${esc(state.error)}</div></div></div>` : ''}
    <div class="careers__bar">
      ${accepting ? `<button class="btn btn--primary" type="button" data-act="start" ${state.busy ? 'disabled' : ''}>Start my application</button>` : ''}
      <button type="button" class="btn btn--ghost" data-act="signout">Sign out of this device</button>
    </div>
    ${supportBlock(p?.support)}
  </div>`;
}

function vSubmitted() {
  const p = state.posting;
  const a = state.application;
  const receipt = a.receipt;
  return `<div class="careers__wrap careers__wrap--narrow">
    <h1 class="careers__h1">Your application</h1>
    <p class="lede">${esc(p?.title || '')} · ${esc(p?.employer || '')}</p>
    <div class="notice notice--ok" role="status"><div>
      <div class="notice__t">Received ${esc(stamp(receipt.submittedAt, receipt.timezone))}</div>
      <div class="notice__b">Reference <span class="mono">${esc(receipt.reference)}</span>. ${esc(receipt.note)}</div>
    </div></div>
    <p>It does not mean your application is under review, shortlisted, or declined. The search team contacts you directly about next steps.</p>
    ${a.corrections ? `<p class="t-small">This is version ${esc(receipt.version)} of your application. Earlier versions are kept on the search team's record.</p>` : ''}
    <div class="careers__bar">
      <a class="btn btn--secondary" href="/careers/${esc(p.firmSlug)}/${esc(p.slug)}" data-nav>Back to the posting</a>
      <button type="button" class="btn btn--ghost" data-act="signout">Sign out of this device</button>
    </div>
    <p class="t-small">Need to change something? Use the contact below. The search team can reopen your application, and your original stays on their record either way.</p>
    ${supportBlock(p?.support)}
  </div>`;
}

function vError(message) {
  return masthead([{ label: 'Openings', href: '/careers' }, { label: 'Not available' }]) + `<div class="careers__wrap careers__wrap--narrow">
    <h1 class="careers__h1">This page is not available</h1>
    <p class="lede">${esc(message)}</p>
    <p>If you followed a link from an advertisement, the position may have been filled or the posting taken down.</p>
    <div class="careers__bar"><a class="btn btn--secondary" href="/careers" data-nav>See current openings</a></div>
  </div>`;
}

/* --- render ---------------------------------------------------------------- */

function render() {
  const root = $('#careers');
  if (!root) return;
  const active = document.activeElement;
  const key = active?.name && active.closest('form')?.id
    ? '#' + active.closest('form').id + ' [name="' + active.name + '"]' : null;
  const caret = key && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;

  let body;
  if (state.fatal) body = vError(state.fatal);
  else if (state.route.view === 'firms') body = vFirms();
  else if (state.route.view === 'listing') body = vListing();
  else if (state.route.view === 'posting') body = vPosting();
  else body = vApply();

  root.innerHTML = `<main class="careers__main" id="main" tabindex="-1">${body}</main>`;
  document.title = pageTitle();

  if (key) {
    const el = root.querySelector(key);
    if (el) {
      el.focus({ preventScroll: true });
      if (caret && 'setSelectionRange' in el) {
        try { el.setSelectionRange(caret[0], caret[1]); } catch { /* not a text field */ }
      }
    }
  }
}

function pageTitle() {
  if (state.route.view === 'posting' && state.posting) return state.posting.title + ' — Careers';
  if (state.route.view === 'apply' && state.posting) return 'Apply: ' + state.posting.title;
  if (state.route.view === 'listing' && state.listing?.firm) return state.listing.firm.name + ' — Careers';
  return 'Careers';
}

/* --- loading --------------------------------------------------------------- */

async function boot() {
  state.route = parseRoute();
  state.fatal = null;
  state.error = null;
  try {
    if (state.route.view === 'firms') {
      state.firms = (await api('/api/public/firms')).firms;
    } else if (state.route.view === 'listing') {
      const url = new URL(location.href);
      state.query = url.searchParams.get('q') || '';
      state.place = url.searchParams.get('location') || '';
      state.listing = await loadListing();
    } else {
      const found = await api('/api/public/postings/' + encodeURIComponent(state.route.firm)
        + '/' + encodeURIComponent(state.route.posting));
      state.posting = found.posting;
      state.firmName = found.firm.name;
      state.apply = found.apply;
      if (state.route.view === 'apply') await loadApplication();
    }
  } catch (error) {
    state.fatal = error.status === 404
      ? 'That opening is not available.'
      : error.message;
  }
  render();
}

async function loadListing() {
  const params = new URLSearchParams({ firm: state.route.firm });
  if (state.query) params.set('q', state.query);
  if (state.place) params.set('location', state.place);
  return api('/api/public/postings?' + params.toString());
}

async function loadApplication() {
  state.session = await api('/api/applications/session');
  if (!state.session.verified) { state.application = null; return; }
  state.verifyEmail = state.session.email || state.verifyEmail;
  const found = await api('/api/applications/' + encodeURIComponent(state.route.firm)
    + '/' + encodeURIComponent(state.route.posting));
  state.application = found.application;
  state.formChanged = found.formChanged;
  state.saveState = 'clean';
  if (state.application?.state === 'submitted') state.step = 'form';
}

/* --- reading the form ------------------------------------------------------ */

function collect() {
  const form = $('#appform');
  if (!form) return null;
  const body = {
    name: form.elements.name?.value || '',
    phone: form.elements.phone?.value || '',
    location: form.elements.location?.value || '',
    background: form.elements.background?.value || '',
    responses: {}
  };
  for (const el of $$('[name^="q:"]', form)) {
    body.responses[el.name.slice(2)] = el.value;
  }
  return body;
}

// Keep what is on screen on the in-memory record, so moving to Review or
// redrawing after an upload never shows an older answer than the one the
// applicant can see in the field.
function absorb() {
  const body = collect();
  if (!body || !state.application) return;
  Object.assign(state.application.answers, {
    name: body.name, phone: body.phone, location: body.location, background: body.background,
    responses: { ...state.application.answers.responses, ...body.responses }
  });
}

async function save({ quiet = false } = {}) {
  const body = collect();
  if (!body || !state.application) return false;
  absorb();
  state.saveState = 'saving';
  if (!quiet) render();
  try {
    const out = await api('/api/applications/' + state.application.id, { method: 'PUT', body });
    state.saveState = 'saved';
    state.savedAt = out.savedAt;
    state.application.expiresAt = out.expiresAt;
    state.application.missing = out.missing;
    state.dirty = false;
    return true;
  } catch (error) {
    state.saveState = 'failed';
    state.error = error.message;
    return false;
  } finally {
    if (!quiet) render();
  }
}

/* --- events ---------------------------------------------------------------- */

document.addEventListener('click', async e => {
  const link = e.target.closest('a[data-nav]');
  if (link) {
    e.preventDefault();
    go(link.getAttribute('href'));
    return;
  }
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;

  if (act === 'skip') return;

  if (act === 'help') {
    e.preventDefault();
    window.SlateHelp.openDrawer({ articleId: 'candidate-apply', trigger: t });
    return;
  }

  if (act === 'clear-filters') {
    state.query = ''; state.place = '';
    go('/careers/' + state.route.firm, { replace: true });
    return;
  }

  if (act === 'resend') {
    await startVerification(state.verifyEmail);
    return;
  }
  if (act === 'change-email') {
    state.verifyStage = 'email';
    state.notice = null; state.error = null;
    render();
    return;
  }

  if (act === 'start') {
    state.busy = true; state.error = null; render();
    try {
      const out = await api('/api/applications/' + encodeURIComponent(state.route.firm)
        + '/' + encodeURIComponent(state.route.posting) + '/start', { method: 'POST' });
      state.application = out.application;
      state.step = 'form';
    } catch (error) { state.error = error.message; }
    finally { state.busy = false; render(); }
    return;
  }

  if (act === 'save') { await save(); return; }

  if (act === 'review') {
    // Saved first, deliberately. Moving to a review screen that shows answers
    // the server has never seen is how somebody ends up reviewing work that is
    // about to be lost.
    if (!(await save({ quiet: true }))) { render(); return; }
    state.step = 'review';
    state.error = null;
    render();
    window.scrollTo({ top: 0 });
    return;
  }

  if (act === 'back-to-form') { state.step = 'form'; state.error = null; render(); return; }

  if (act === 'adopt-form') {
    try {
      const out = await api('/api/applications/' + state.application.id + '/adopt-form', { method: 'POST' });
      state.application = out.application;
      state.formChanged = null;
      toast('The form is up to date. Nothing you wrote was lost.');
    } catch (error) { state.error = error.message; }
    render();
    return;
  }

  if (act === 'drop-file') {
    try {
      const out = await api('/api/applications/' + state.application.id + '/files/' + t.dataset.fid,
        { method: 'DELETE' });
      state.application.files = state.application.files.filter(f => f.id !== t.dataset.fid);
      state.application.missing = out.missing;
    } catch (error) { state.error = error.message; }
    render();
    return;
  }

  if (act === 'submit') {
    state.busy = true; state.error = null; render();
    try {
      const out = await api('/api/applications/' + state.application.id + '/submit', { method: 'POST' });
      state.receipt = out.receipt;
      state.confirmation = out.confirmationNote;
      state.step = 'done';
      state.dirty = false;
    } catch (error) {
      state.error = error.message;
      if (error.detail?.code === 'FORM_CHANGED') {
        state.step = 'form';
        await loadApplication();
      }
      if (error.detail?.missing?.length && state.application) {
        state.application.missing = error.detail.missing;
      }
    } finally { state.busy = false; render(); }
    return;
  }

  if (act === 'signout') {
    try { await api('/api/applications/signout', { method: 'POST' }); } catch { /* already gone */ }
    state.session = { verified: false, email: null };
    state.application = null;
    state.receipt = null;
    state.step = 'form';
    state.verifyStage = 'email';
    toast('Signed out of this device.');
    render();
    return;
  }
});

document.addEventListener('submit', async e => {
  const form = e.target;
  if (form.id === 'filters') {
    e.preventDefault();
    const params = new URLSearchParams();
    const q = form.elements.q.value.trim();
    const place = form.elements.location.value.trim();
    if (q) params.set('q', q);
    if (place) params.set('location', place);
    go('/careers/' + state.route.firm + (params.toString() ? '?' + params.toString() : ''));
    return;
  }
  if (form.id === 'verifyform') {
    e.preventDefault();
    await startVerification(form.elements.email.value.trim());
    return;
  }
  if (form.id === 'codeform') {
    e.preventDefault();
    state.busy = true; state.error = null; render();
    try {
      await api('/api/applications/verify/confirm', {
        method: 'POST', body: { email: state.verifyEmail, code: form.elements.code.value.trim() }
      });
      state.notice = null;
      await loadApplication();
    } catch (error) { state.error = error.message; }
    finally { state.busy = false; render(); }
    return;
  }
  if (form.id === 'appform') e.preventDefault();
});

async function startVerification(email) {
  state.verifyEmail = String(email || '').trim();
  state.busy = true; state.error = null; state.notice = null;
  render();
  try {
    const out = await api('/api/applications/verify/start', {
      method: 'POST',
      body: { email: state.verifyEmail, firmSlug: state.route.firm, postingSlug: state.route.posting }
    });
    state.verifyStage = 'code';
    state.notice = out.message;
  } catch (error) {
    state.error = error.message;
  } finally {
    state.busy = false;
    render();
  }
}

// Unsaved work is the thing most worth protecting on this page, so it is
// tracked from the first keystroke rather than inferred at navigation time.
document.addEventListener('input', e => {
  if (!e.target.closest('#appform')) return;
  state.dirty = true;
  // Kept on the record as it is typed, so the outstanding list below the form
  // answers for what is on the page rather than for the last thing saved.
  // Patched into the live DOM: re-rendering the form somebody is typing into
  // is how an application loses a paragraph.
  absorb();
  const outstanding = $('.careers__missing');
  if (outstanding) {
    const missing = missingNow();
    outstanding.textContent = missing.length
      ? 'Still needed before you can submit: ' + missing.join('; ') + '.' : '';
  }
  if (state.saveState !== 'dirty') {
    state.saveState = 'dirty';
    const note = $('.careers__savestate');
    if (note) {
      note.textContent = saveStateText();
      note.classList.remove('careers__savestate--bad');
    }
  }
});

window.addEventListener('beforeunload', e => {
  if (!state.dirty) return;
  e.preventDefault();
  e.returnValue = '';
});

/* --- uploads ---------------------------------------------------------------- */

document.addEventListener('change', async e => {
  const input = e.target.closest('.careers__file');
  if (!input || !input.files?.length || !state.application) return;
  const file = input.files[0];
  input.value = '';
  // Keep what is typed before the redraw that follows the upload.
  absorb();
  if (file.size > 8 * 1024 * 1024) { toast('That file is over 8 MB. Attach a smaller PDF.'); return; }
  toast('Attaching ' + file.name + '…');
  try {
    const data = await readAsBase64(file);
    const out = await api('/api/applications/' + state.application.id + '/files', {
      method: 'POST',
      body: { filename: file.name, contentType: file.type || 'application/pdf', data, materialKey: input.dataset.material }
    });
    state.application.files = [...(state.application.files || []), out.file];
    state.application.missing = out.missing;
    toast('Attached. ' + out.file.note);
  } catch (error) {
    toast(error.message);
  }
  render();
});

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

/* --- start ------------------------------------------------------------------ */

window.SlateHelp.configure({ endpoint: '/api/public/help' });
window.SlateHelp.load().catch(() => { /* the drawer says so if it is asked for */ });
boot();
