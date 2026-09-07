'use strict';

const crypto = require('crypto');
const clone = value => JSON.parse(JSON.stringify(value));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const FACTS = ['jurisdictionType', 'client', 'position', 'state', 'website', 'fog', 'population', 'budget', 'salary', 'opened', 'firstReview', 'notes'];

function profileKey(criteria) {
  return (criteria || []).map(({ id, kind, label, weight, note }) => ({ id, kind, label, weight, note }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function reopen(record) {
  if (record) { record.doneAt = null; record.doneBy = null; record.doneByName = ''; }
}

// One place applies invariants for manual saves, consensus adoption and AI writes.
function reconcile(search, before) {
  search.revision = before?.revision || search.revision || 1;
  search.profileRevision = before?.profileRevision || search.profileRevision || 1;
  search.history ||= [];
  search.staleArtifacts ||= {};
  if (!before) return;
  const at = new Date().toISOString();
  const who = search.activity?.[0]?.who || 'Search team';
  const remember = entry => search.history.push({ at, who, ...clone(entry) });
  const stale = (keys, reason) => {
    for (const key of keys) {
      if (search.artifacts?.[key]) search.staleArtifacts[key] = reason;
      if (search.reviews) delete search.reviews[key];
    }
  };
  if (!equal(profileKey(before.criteria), profileKey(search.criteria))) {
    remember({ kind: 'profile', revision: before.profileRevision || 1, criteria: before.criteria,
      scores: before.scores, notesBy: before.notesBy, released: before.released,
      candidates: (before.candidates || []).map(({ id, name }) => ({ id, name })) });
    search.profileRevision += 1;
    search.scores = {};
    search.notesBy = {};
    search.released = false;
    stale(['survey1', 'survey2', 'guide', 'brochure', 'ads', 'schedule', 'contract', 'bar'], 'The candidate profile changed. Review this copy against the current profile.');
  } else if (!equal(before.scores, search.scores) || !equal(before.notesBy, search.notesBy)) {
    remember({ kind: 'scores', revision: search.profileRevision, criteria: search.criteria,
      scores: before.scores, notesBy: before.notesBy, released: before.released });
  }
  if (FACTS.some(key => !equal(before[key], search[key]))) {
    remember({ kind: 'facts', body: Object.fromEntries(FACTS.map(k => [k, before[k]])) });
    stale(['brochure', 'ads'], 'Search facts changed. Check the recruiting copy before approving it again.');
  }
  if (before.jurisdictionType !== search.jurisdictionType) {
    stale(Object.keys(search.artifacts || {}), 'The jurisdiction type changed. Review existing copy for the new jurisdiction.');
  }
  for (const key of new Set([...Object.keys(before.artifacts || {}), ...Object.keys(search.artifacts || {})])) {
    if (equal(before.artifacts?.[key], search.artifacts?.[key])) continue;
    if (before.artifacts?.[key]) remember({ kind: 'artifact', key, body: before.artifacts[key] });
    // This artifact was deliberately revised. Dependent artifacts still need review.
    delete search.staleArtifacts[key];
    if (search.reviews) delete search.reviews[key];
    if (key === 'community' || key === 'plan') stale(['brochure', 'ads'], 'Source material changed. Review this copy before approving it again.');
    if (key === 'brochure') stale(['ads'], 'The brochure changed. Review the advertisements against it.');
  }
  if (!equal(before.members, search.members)) search.team = { confirmedAt: null, confirmedBy: null };
  for (const [key, record] of Object.entries(search.staff || {})) {
    const prev = before.staff?.[key];
    if (prev && (!equal(prev.log, record.log) || prev.notes !== record.notes)) {
      remember({ kind: 'staff', key, body: prev });
      reopen(record);
    }
  }
  if ((search.candidates || []).some(c => {
    const prev = before.candidates?.find(p => p.id === c.id);
    return prev && (prev.referenceConsentAt !== c.referenceConsentAt || prev.stage !== c.stage);
  })) reopen(search.staff?.references);
  if (!equal(before, search)) search.revision += 1;
}

function validateCriteria(criteria) {
  if (!Array.isArray(criteria) || criteria.length > 100) return 'Provide a list of profile criteria.';
  const ids = new Set();
  for (const c of criteria) {
    if (!c || typeof c !== 'object' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(c.id || '') || ids.has(c.id)) return 'Each criterion needs a unique, valid ID.';
    if (!['skill', 'trait', 'chall', 'opp'].includes(c.kind)) return 'Choose a valid criterion category.';
    ids.add(c.id);
  }
  return null;
}

function validateSurvey(survey) {
  if (!survey || typeof survey !== 'object' || !Array.isArray(survey.questions) || !survey.questions.length || survey.questions.length > 100) return 'A questionnaire needs at least one question.';
  const ids = new Set();
  for (const q of survey.questions) {
    if (!q || !Number.isInteger(q.n) || q.n < 1 || ids.has(q.n) || typeof q.prompt !== 'string' || !q.prompt.trim()) return 'Questions need unique positive numbers and question text.';
    ids.add(q.n);
  }
  return null;
}

function validateAnswers(survey, answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return 'Provide questionnaire answers.';
  const allowed = new Set(survey.questions.map(q => 'q' + q.n));
  for (const [key, value] of Object.entries(answers)) {
    if (!allowed.has(key) || typeof value !== 'string' || value.length > 20000) return 'Answers must match this questionnaire and be no longer than 20,000 characters each.';
  }
  for (const q of survey.questions) if (q.required && !answers['q' + q.n]?.trim()) return 'Answer required question ' + q.n + '.';
  if (!Object.values(answers).some(v => v.trim())) return 'Enter an answer before submitting.';
  return null;
}

module.exports = { clone, digest, reconcile, reopen, validateCriteria, validateSurvey, validateAnswers };
