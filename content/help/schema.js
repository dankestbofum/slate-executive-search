'use strict';

/**
 * The shape of a help article, and the rules that keep the catalog honest.
 *
 * One source produces three things: the in-app drawer, the searchable help
 * screen, and the printable guide. If they could disagree, the printed copy a
 * committee member is handed would eventually stop matching the button they
 * are looking at, so nothing downstream is allowed to hold content of its own
 * — they all read this catalog and render it.
 *
 * Every article uses the same template, and the template is fields rather than
 * free-form sections so an author cannot quietly drop the half that says who
 * sees the result. The order below is the order they are rendered in:
 *
 *   who this is for -> before you start -> numbered steps using the actual
 *   button labels -> how to know it worked -> who sees the result -> next step
 *   -> recovery and help.
 *
 * `validate()` runs in the test suite and at server boot. A catalog that names
 * a screen this build cannot render, a step that is not in server/steps.js, or
 * an article that links to an id nobody wrote is a broken help link waiting to
 * be found by a user, so it fails loudly here instead.
 */

// The roles a reader can be. These change the explanations, never permissions:
// selecting "Administrator" in the role picker shows administrator wording, it
// does not grant administrator anything.
const AUDIENCES = ['admin', 'consultant', 'committee', 'candidate'];

const AUDIENCE_LABEL = {
  admin: 'Administrator',
  consultant: 'Consultant or search manager',
  committee: 'Committee member',
  candidate: 'Candidate'
};

// What a reader picking a role is told they will get.
const AUDIENCE_LEDE = {
  admin: 'Membership, roles, invitations, and getting someone unstuck.',
  consultant: 'Running a search from the first screen to the archive.',
  committee: 'Your input, your scores, and what happens to them.',
  candidate: 'Finding an opening, applying, and coming back to your application.'
};

const REQUIRED_TEXT = ['id', 'title', 'summary', 'who', 'reviewed'];
const REQUIRED_LISTS = ['audience', 'checklist', 'before', 'doThis', 'worked', 'whoSees', 'recovery'];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Check a catalog against the application it describes.
 *
 * `known` supplies the facts this module must not duplicate: the view keys the
 * client can render and the step keys the process catalog defines. Passing
 * them in rather than importing them keeps the content free of a dependency on
 * the server, so the same file can be read by a build script or a reviewer.
 */
function validate(catalog, known = {}) {
  const problems = [];
  const screens = known.screens ? new Set(known.screens) : null;
  const steps = known.steps ? new Set(known.steps) : null;
  const packages = known.packages ? new Set(known.packages) : null;

  const articles = catalog?.articles;
  if (!Array.isArray(articles) || !articles.length) {
    return ['The help catalog has no articles.'];
  }

  const ids = new Set();
  for (const article of articles) {
    const at = 'article ' + (article?.id || '(no id)');
    for (const field of REQUIRED_TEXT) {
      if (!isNonEmptyString(article?.[field])) problems.push(at + ': ' + field + ' is required.');
    }
    for (const field of REQUIRED_LISTS) {
      if (!Array.isArray(article?.[field]) || !article[field].length) {
        problems.push(at + ': ' + field + ' must list at least one entry.');
      }
    }
    if (ids.has(article?.id)) problems.push(at + ': duplicate article id.');
    ids.add(article?.id);

    if (!/^[a-z0-9-]+$/.test(String(article?.id || ''))) {
      problems.push(at + ': an article id is lower-case letters, digits and hyphens, because it is a permanent link.');
    }
    for (const role of article?.audience || []) {
      if (!AUDIENCES.includes(role)) problems.push(at + ': unknown audience "' + role + '".');
    }
    // A public article is shown to applicants in the portal. It must never be
    // written for staff, because the portal has no workspace behind it and no
    // private search information belongs on that page at all.
    if (article?.public && (article.audience || []).some(role => role !== 'candidate')) {
      problems.push(at + ': a public article is written for candidates only.');
    }
    if (screens) {
      for (const screen of article?.screens || []) {
        if (!screens.has(screen)) problems.push(at + ': names screen "' + screen + '", which this build does not render.');
      }
    }
    if (steps) {
      for (const step of article?.steps || []) {
        if (!steps.has(step)) problems.push(at + ': names step "' + step + '", which is not in the process catalog.');
      }
    }
    if (packages && article?.packages) {
      for (const pkg of article.packages) {
        if (!packages.has(pkg)) problems.push(at + ': names package "' + pkg + '", which does not exist.');
      }
    }
    for (const entry of article?.doThis || []) {
      if (!isNonEmptyString(entry?.do)) problems.push(at + ': every numbered step needs wording.');
    }
  }

  // Cross-links last, once every id is known.
  for (const article of articles) {
    for (const link of [...(article?.next || []), ...(article?.related || [])]) {
      const target = typeof link === 'string' ? link : link?.article;
      if (target && !ids.has(target)) {
        problems.push('article ' + article.id + ': links to "' + target + '", which is not in the catalog.');
      }
    }
  }

  for (const term of catalog?.glossary || []) {
    if (!isNonEmptyString(term?.term) || !isNonEmptyString(term?.meaning)) {
      problems.push('glossary: every entry needs a term and a meaning.');
    }
    if (term?.article && !ids.has(term.article)) {
      problems.push('glossary "' + term.term + '": links to an article that is not in the catalog.');
    }
  }

  return problems;
}

module.exports = { AUDIENCES, AUDIENCE_LABEL, AUDIENCE_LEDE, validate };
