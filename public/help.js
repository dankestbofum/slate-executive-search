'use strict';

/**
 * The user guide in the browser.
 *
 * One runtime, loaded by both the staff application and the public careers
 * portal, reading one catalog from the server. It renders three things from
 * that catalog and holds no content of its own:
 *
 *  - a drawer, opened from "Help with this page" beside the work,
 *  - a full help screen with search, a role filter, and the glossary,
 *  - a print view of the same articles.
 *
 * The drawer is the reason this is a separate file rather than more of app.js.
 * Opening help must never cost somebody a half-written answer, so the drawer is
 * built against the live DOM and appended to <body>: it never triggers the
 * application's render, which replaces the page and would take the form with
 * it. Closing it puts focus back on the control that opened it.
 *
 * Everything it draws is escaped here. Article text is authored content, not
 * user input, but it arrives over HTTP like everything else and there is no
 * reason for this file to be the one place that trusts a server response.
 */

(function (global) {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /**
   * Bold runs written as **like this** in the catalog.
   *
   * Articles quote the actual button labels, and a label needs to stand out
   * from the sentence around it. This is the only markup the content uses, and
   * it is applied after escaping so the source can never inject an element.
   */
  function rich(text) {
    return esc(text).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  }

  const state = {
    endpoint: '/api/help',
    token: null,        // () => Promise<string|null>, for the staff catalog
    catalog: null,
    loading: null,
    error: null,
    role: null,         // the reader's chosen role, or null for everything
    drawer: null,
    returnFocus: null,
    onKeydown: null
  };

  function configure(options) {
    if (options.endpoint) state.endpoint = options.endpoint;
    if (options.token) state.token = options.token;
    if (options.role !== undefined) state.role = options.role;
  }

  /**
   * Fetch the catalog once and remember it.
   *
   * A failure is remembered too, and retried on the next call rather than
   * cached as an empty guide: help that silently shows nothing is worse than
   * help that says it could not load.
   */
  async function load() {
    if (state.catalog) return state.catalog;
    if (state.loading) return state.loading;
    state.loading = (async () => {
      const headers = { accept: 'application/json' };
      if (state.token) {
        const token = await state.token();
        if (token) headers.authorization = 'Bearer ' + token;
      }
      const res = await fetch(state.endpoint, { credentials: 'include', headers });
      if (!res.ok) throw new Error('The user guide could not be loaded.');
      const body = await res.json();
      state.catalog = body;
      state.error = null;
      return body;
    })();
    try {
      return await state.loading;
    } catch (error) {
      state.error = error.message;
      throw error;
    } finally {
      state.loading = null;
    }
  }

  function articles() {
    return state.catalog?.articles || [];
  }

  function find(id) {
    return articles().find(a => a.id === id) || null;
  }

  /** The article that answers "help with this page" for a view key. */
  function forScreen(screen) {
    const id = state.catalog?.screens?.[screen];
    return id ? find(id) : null;
  }

  function matching({ role = null, query = '' } = {}) {
    const needle = String(query || '').trim().toLowerCase();
    return articles().filter(article => {
      if (role && !(article.audience || []).includes(role)) return false;
      if (!needle) return true;
      return searchText(article).includes(needle);
    });
  }

  // What a search matches against: everything a reader can see in the article,
  // so searching for a button label finds the article that names it.
  function searchText(article) {
    const parts = [
      article.title, article.summary, article.who,
      ...(article.checklist || []),
      ...(article.before || []),
      ...(article.doThis || []).flatMap(s => [s.do, s.note]),
      ...(article.worked || []), ...(article.whoSees || []), ...(article.recovery || [])
    ];
    return parts.filter(Boolean).join(' ').toLowerCase();
  }

  /* --- rendering -------------------------------------------------------- */

  function list(items, className = '') {
    if (!items || !items.length) return '';
    return `<ul class="help__list${className ? ' ' + className : ''}">${items.map(i => `<li>${rich(i)}</li>`).join('')}</ul>`;
  }

  function section(heading, body) {
    if (!body) return '';
    return `<section class="help__sec"><h4 class="help__h">${esc(heading)}</h4>${body}</section>`;
  }

  /**
   * One article, in the template every article uses.
   *
   * The order is fixed here rather than in the content, which is what stops an
   * article from being written without saying who sees the result.
   */
  function articleHtml(article, { level = 3, links = true } = {}) {
    if (!article) return '<p class="help__empty">That help article is not in this guide.</p>';
    const h = 'h' + level;
    const steps = (article.doThis || []).map(entry => `<li>
      <span class="help__step">${rich(entry.do)}</span>
      ${entry.note ? `<span class="help__note">${rich(entry.note)}</span>` : ''}
    </li>`).join('');

    const next = links && (article.next || []).length
      ? `<ul class="help__list help__list--links">${(article.next || []).map(link => {
        const id = link.article || link;
        const label = link.label || find(id)?.title || id;
        return `<li><button type="button" class="help__link" data-help-article="${esc(id)}">${esc(label)}</button></li>`;
      }).join('')}</ul>`
      : '';

    const related = links && (article.related || []).length
      ? `<ul class="help__list help__list--links">${(article.related || []).map(id =>
        `<li><button type="button" class="help__link" data-help-article="${esc(id)}">${esc(find(id)?.title || id)}</button></li>`).join('')}</ul>`
      : '';

    return `<article class="help__article" id="help-article-${esc(article.id)}" data-help-id="${esc(article.id)}">
      <${h} class="help__title">${esc(article.title)}</${h}>
      <p class="help__summary">${esc(article.summary)}</p>
      ${article.checklist?.length ? `<div class="help__checklist">
        <h4 class="help__h">In short</h4>
        <ol class="help__list help__list--check">${article.checklist.map(i => `<li>${rich(i)}</li>`).join('')}</ol>
      </div>` : ''}
      ${section('Who this is for', `<p>${rich(article.who)}</p>`)}
      ${section('Before you start', list(article.before))}
      ${section('Do this', steps ? `<ol class="help__list help__list--steps">${steps}</ol>` : '')}
      ${section('How to know it worked', list(article.worked))}
      ${section('Who sees the result', list(article.whoSees))}
      ${section('If something goes wrong', list(article.recovery))}
      ${next ? section('Next', next) : ''}
      ${related ? section('Related', related) : ''}
      <p class="help__stamp">Reviewed ${esc(article.reviewed)}.</p>
    </article>`;
  }

  function glossaryHtml() {
    const terms = state.catalog?.glossary || [];
    if (!terms.length) return '';
    return `<section class="help__sec help__glossary" id="help-glossary">
      <h3 class="help__h2">Glossary</h3>
      <dl class="help__dl">${terms.map(t => `
        <dt>${esc(t.term)}</dt>
        <dd>${esc(t.meaning)}${t.article ? ` <button type="button" class="help__link" data-help-article="${esc(t.article)}">Read more</button>` : ''}</dd>
      `).join('')}</dl>
    </section>`;
  }

  function provenanceHtml() {
    if (!state.catalog) return '';
    return `<p class="help__stamp help__stamp--doc">${esc(state.catalog.verificationNote || '')}</p>`;
  }

  /**
   * The full help screen.
   *
   * Returned as a string so the application can put it inside its own shell
   * and keep one page layout. The screen owns no state of its own: the role
   * and the query are passed in and echoed back through data attributes, which
   * is what lets the application re-render it without losing either.
   */
  function pageHtml({ role = null, query = '', articleId = null } = {}) {
    if (state.error) {
      return `<div class="help__page"><div class="notice notice--stop" role="alert"><div>
        <div class="notice__t">The user guide could not be loaded</div>
        <div class="notice__b">${esc(state.error)}
        <button type="button" class="btn btn--secondary btn--sm" data-help-retry>Try again</button></div>
      </div></div></div>`;
    }
    if (!state.catalog) return `<div class="help__page"><p class="help__empty">Loading the user guide…</p></div>`;

    const open = articleId ? find(articleId) : null;
    const found = matching({ role, query });
    const audiences = state.catalog.audiences || [];

    return `<div class="help__page">
      <div class="help__controls">
        <div class="help__find">
          <label class="help__findlabel" for="help-search">Search the guide</label>
          <input class="input" id="help-search" type="search" data-help-search
            placeholder="A task, or a button label" value="${esc(query)}"
            autocomplete="off" aria-describedby="help-found">
          <p class="t-small" id="help-found" role="status">${found.length} article${found.length === 1 ? '' : 's'}${query ? ' match “' + esc(query) + '”' : ''}.</p>
        </div>
        ${audiences.length ? `<div class="help__roles" role="group" aria-label="Show explanations for">
          <span class="help__roleslabel">Show explanations for</span>
          <button type="button" class="help__role" data-help-role="" aria-pressed="${!role}">Everyone</button>
          ${audiences.map(a => `<button type="button" class="help__role" data-help-role="${esc(a.id)}"
            aria-pressed="${role === a.id}" title="${esc(a.lede)}">${esc(a.label)}</button>`).join('')}
        </div>
        <p class="t-small">Choosing a role changes the explanations you are shown. It never changes what you are allowed to do.</p>` : ''}
        <div class="help__pageacts">
          <button type="button" class="btn btn--secondary btn--sm" data-help-print>Print this guide</button>
        </div>
      </div>

      <div class="help__body">
        <nav class="help__index" aria-label="Guide contents">
          <h3 class="help__h2">Articles</h3>
          ${found.length ? `<ul class="help__list help__list--index">${found.map(a => `<li>
            <button type="button" class="help__indexlink${open?.id === a.id ? ' help__indexlink--on' : ''}"
              data-help-article="${esc(a.id)}" ${open?.id === a.id ? 'aria-current="true"' : ''}>
              <span class="help__indext">${esc(a.title)}</span>
              <span class="help__indexs">${esc(a.summary)}</span>
            </button></li>`).join('')}</ul>`
            : `<p class="help__empty">Nothing in the guide matches that. Clear the search, or choose Everyone above.</p>`}
          <p class="t-small"><a class="help__link" href="#help-glossary">Jump to the glossary</a></p>
        </nav>
        <div class="help__reading">
          ${open ? articleHtml(open, { level: 2 })
            : `<div class="help__placeholder"><h2 class="help__title">Slate user guide</h2>
               <p class="help__summary">Choose an article, or search for the task you are trying to finish.
               Every screen also has a <b>Help with this page</b> control that opens the right article beside your work.</p></div>`}
          ${glossaryHtml()}
          ${provenanceHtml()}
        </div>
      </div>
    </div>`;
  }

  /* --- the drawer ------------------------------------------------------- */

  /**
   * Open help beside the work, without disturbing the work.
   *
   * Nothing here goes through the application's renderer. The drawer is built
   * and appended directly, so a half-typed answer, the caret, and the scroll
   * position are all exactly where they were when it closes.
   */
  async function openDrawer({ articleId = null, screen = null, trigger = null } = {}) {
    state.returnFocus = trigger || document.activeElement;
    if (!state.catalog) {
      mountDrawer('<p class="help__empty">Loading the user guide…</p>', 'Help');
      try { await load(); }
      catch (error) {
        mountDrawer(`<p class="help__empty">${esc(error.message)}</p>`, 'Help');
        return;
      }
    }
    const article = articleId ? find(articleId) : (screen ? forScreen(screen) : null);
    if (!article) {
      mountDrawer(`<p class="help__empty">There is no article for this screen yet.
        Open <b>Help &amp; user guide</b> from the navigation to search the whole guide.</p>`, 'Help');
      return;
    }
    mountDrawer(articleHtml(article, { level: 3 }), article.title);
  }

  function mountDrawer(inner, title) {
    let el = state.drawer;
    if (!el) {
      el = document.createElement('div');
      el.className = 'helpdrawer';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'false');
      el.setAttribute('aria-label', 'Help');
      document.body.appendChild(el);
      state.drawer = el;
      state.onKeydown = event => {
        if (event.key === 'Escape') { event.stopPropagation(); closeDrawer(); }
        else if (event.key === 'Tab') keepFocus(event);
      };
      el.addEventListener('keydown', state.onKeydown);
      el.addEventListener('click', onDrawerClick);
    }
    el.innerHTML = `<div class="helpdrawer__card">
      <div class="helpdrawer__hd">
        <span class="helpdrawer__kicker">Help</span>
        <h2 class="helpdrawer__t">${esc(title)}</h2>
        <button type="button" class="helpdrawer__x" data-help-close aria-label="Close help">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>
        </button>
      </div>
      <div class="helpdrawer__bd" tabindex="0">${inner}</div>
      <div class="helpdrawer__ft">
        <button type="button" class="btn btn--ghost btn--sm" data-help-open-guide>Open the full guide</button>
        <span class="t-small">Your work on the page behind this is untouched.</span>
      </div>
    </div>`;
    document.documentElement.classList.add('has-helpdrawer');
    el.querySelector('.helpdrawer__x')?.focus();
  }

  /**
   * Keep Tab inside the drawer while it is open.
   *
   * It is deliberately not aria-modal: the page behind stays readable, because
   * the whole point is to explain the control the reader is looking at. But a
   * keyboard user who tabs out of it and cannot find their way back has lost
   * the drawer, so the cycle is closed.
   */
  function keepFocus(event) {
    const focusable = [...state.drawer.querySelectorAll('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])')]
      .filter(el => !el.disabled && el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function onDrawerClick(event) {
    const close = event.target.closest('[data-help-close]');
    if (close) { closeDrawer(); return; }
    const guide = event.target.closest('[data-help-open-guide]');
    if (guide) {
      closeDrawer();
      global.dispatchEvent(new CustomEvent('slate:help-open-guide'));
      return;
    }
    const link = event.target.closest('[data-help-article]');
    if (link) {
      const article = find(link.dataset.helpArticle);
      if (article) mountDrawer(articleHtml(article, { level: 3 }), article.title);
    }
  }

  function closeDrawer() {
    if (!state.drawer) return;
    state.drawer.remove();
    state.drawer = null;
    document.documentElement.classList.remove('has-helpdrawer');
    const back = state.returnFocus;
    state.returnFocus = null;
    if (back && document.contains(back)) back.focus();
  }

  function drawerOpen() {
    return Boolean(state.drawer);
  }

  /* --- print ------------------------------------------------------------ */

  /**
   * A printable copy of the same articles.
   *
   * Written into a container the print stylesheet shows and the screen does
   * not, rather than opening a new window: a popup is blocked often enough
   * that "Print this guide" would be an unreliable control, and a second
   * document would be a second place this content could be rendered from.
   */
  function print({ role = null } = {}) {
    if (!state.catalog) return;
    const chosen = matching({ role });
    let host = document.getElementById('helpprint');
    if (!host) {
      host = document.createElement('div');
      host.id = 'helpprint';
      host.className = 'helpprint';
      document.body.appendChild(host);
    }
    const roleLabel = role ? (state.catalog.audiences || []).find(a => a.id === role)?.label : null;
    host.innerHTML = `<div class="helpprint__in">
      <h1>Slate user guide</h1>
      <p>${roleLabel ? esc(roleLabel) + ' edition. ' : ''}${esc(state.catalog.verificationNote || '')}</p>
      <nav><h2>Contents</h2><ol>${chosen.map(a => `<li>${esc(a.title)}</li>`).join('')}</ol></nav>
      ${chosen.map(a => articleHtml(a, { level: 2, links: false })).join('')}
      ${glossaryHtml()}
    </div>`;
    document.documentElement.dataset.print = 'help';
    const done = () => {
      delete document.documentElement.dataset.print;
      host.innerHTML = '';
      global.removeEventListener('afterprint', done);
    };
    global.addEventListener('afterprint', done);
    global.print();
    setTimeout(done, 1500);
  }

  global.SlateHelp = {
    configure, load, articleHtml, pageHtml, glossaryHtml,
    openDrawer, closeDrawer, drawerOpen, print,
    find, forScreen, matching,
    get catalog() { return state.catalog; },
    get error() { return state.error; }
  };
})(window);
