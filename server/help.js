'use strict';

/**
 * Serving the user guide.
 *
 * The catalog in content/help is the only copy of this content. This module
 * projects it for two audiences that must not be confused with each other:
 *
 *  - staff, who get everything, and
 *  - the public, who get only the articles deliberately written for applicants.
 *
 * The public projection is an allowlist over `public: true`, not a copy of the
 * catalog with staff articles removed afterwards. Same rule as the posting
 * serializer in server/postings.js, and for the same reason: a field added to
 * an article later must not become public because nobody remembered to add it
 * to a removal list.
 *
 * The catalog is validated at boot against the process catalog it references.
 * A help link that points at a step this build does not have is a broken link
 * in front of a user, so the process refuses to start with one.
 */

const catalog = require('../content/help/catalog');
const schema = require('../content/help/schema');
const { STEPS, PACKAGE_ORDER } = require('./steps');

// The facts the content is checked against. Screens are checked separately, in
// the browser suite, against the client's own knownView(): the server has no
// opinion about which views exist and should not grow a second list of them.
function knownFacts() {
  return {
    steps: STEPS.map(s => s.key),
    packages: PACKAGE_ORDER
  };
}

/** Throw if the catalog does not match this build. Called once, at boot. */
function verify() {
  const problems = schema.validate(catalog, knownFacts());
  if (problems.length) {
    const error = new Error('The help catalog does not match this build:\n  ' + problems.join('\n  '));
    error.code = 'HELP_CATALOG_INVALID';
    throw error;
  }
  return true;
}

// Every field an article publishes. Listed once so both projections agree
// about what an article is, and so adding a field is a deliberate act.
const ARTICLE_FIELDS = [
  'id', 'title', 'summary', 'audience', 'screens', 'steps', 'packages',
  'checklist', 'who', 'before', 'doThis', 'worked', 'whoSees', 'next',
  'recovery', 'related', 'reviewed'
];

function project(article) {
  const out = {};
  for (const field of ARTICLE_FIELDS) {
    const value = article[field];
    if (value === undefined) continue;
    out[field] = value;
  }
  return out;
}

/**
 * What a reviewed date is and is not.
 *
 * Every projection carries it, because an article is only as good as the build
 * it was written against and a reader deserves to know nobody has walked it
 * through on a deployment yet.
 */
function provenance() {
  return {
    reviewed: catalog.REVIEWED,
    verifiedRelease: catalog.VERIFIED_RELEASE,
    verificationNote: catalog.VERIFIED_RELEASE
      ? 'Checked against release ' + catalog.VERIFIED_RELEASE + '.'
      : 'Written against the application source on ' + catalog.REVIEWED
        + '. No release has been walked through against it yet.'
  };
}

/** The whole guide, for somebody signed in to a workspace. */
function staffCatalog() {
  return {
    articles: catalog.articles.map(project),
    glossary: catalog.glossary,
    screens: catalog.screenIndex(),
    audiences: schema.AUDIENCES.map(id => ({
      id,
      label: schema.AUDIENCE_LABEL[id],
      lede: schema.AUDIENCE_LEDE[id]
    })),
    ...provenance()
  };
}

/**
 * The candidate guide, for the portal.
 *
 * Built from `public: true` alone. Nothing about a workspace, a search, a
 * committee, or a candidate reaches this: the articles themselves contain no
 * such content, and the schema check refuses a public article written for any
 * audience but candidates.
 */
function publicCatalog() {
  const articles = catalog.articles.filter(a => a.public).map(project);
  const ids = new Set(articles.map(a => a.id));
  return {
    articles: articles.map(article => ({
      ...article,
      // A public article must not offer a link into the staff guide, which is
      // not served here and would 404 for the reader.
      next: (article.next || []).filter(link => ids.has(link.article || link)),
      related: (article.related || []).filter(id => ids.has(id))
    })),
    glossary: catalog.glossary.filter(term => term.article && ids.has(term.article)),
    ...provenance()
  };
}

module.exports = { verify, staffCatalog, publicCatalog, ARTICLE_FIELDS };
