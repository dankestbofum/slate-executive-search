'use strict';

const { validateSurvey } = require('./integrity');
const { stepsFor } = require('./steps');
const KEYS = ['survey1', 'survey2', 'guide'];
const LABELS = { survey1: 'Initial survey', survey2: 'Semifinalist survey', guide: 'Interview guide' };
const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function keys(search) {
  const included = new Set(stepsFor(search.package).map(step => step.key));
  return KEYS.filter(key => included.has(key));
}

function validate(search, bundle, { complete=false }={}) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle) || !Object.keys(bundle).length) return 'Provide at least one question set.';
  if (complete && keys(search).some(key => !Object.hasOwn(bundle, key))) return 'The generated plan must include every question stage.';
  for (const [key, value] of Object.entries(bundle)) {
    if (!keys(search).includes(key)) return 'That question set is not included in this workflow.';
    if (key !== 'guide') {
      const error = validateSurvey(value);
      if (error) return LABELS[key] + ': ' + error;
    } else if (!value || !Array.isArray(value.questions) || value.questions.some(q => !q || typeof q.stem !== 'string' || !q.stem.trim())) {
      return 'Interview questions need question text.';
    }
  }
  const seen = new Map();
  const all = { ...search.artifacts, ...bundle };
  for (const key of keys(search)) {
    for (const q of all[key]?.questions || []) {
      const text = normalize(q.prompt || q.stem);
      if (!text) continue;
      if (seen.has(text)) return 'Repeated question in ' + seen.get(text) + ' and ' + LABELS[key] + '. Keep it in one stage or rewrite it to ask for different evidence.';
      seen.set(text, LABELS[key]);
    }
  }
  return null;
}

module.exports = { keys, validate };
