'use strict';

/**
 * The desk editor.
 *
 * Claude drafts; this module reads the draft before it lands on the file and
 * says what is wrong with it in terms Claude can act on. It is deterministic:
 * no model call, no judgment about prose quality. It checks the things the
 * firm's rules make checkable in code:
 *
 *   - house style: no em or en dashes, no exclamation points
 *   - criterion ids point at criteria that exist on this profile
 *   - dollar and population-scale figures appear somewhere in the search facts,
 *     the research, or copy already on file (nothing invented)
 *   - the JSON has the shape and counts the schema asked for
 *
 * `generate` in ai.js runs the review, sends the findings back to Claude, and
 * repeats a bounded number of times. Nothing here writes.
 */

const { KINDS, KIND_CAP, KIND_FLOOR, PREFIX } = require('./committee');

const DASH_RE = /[\u2013\u2014]/;
const URL_RE = /\bhttps?:\/\/\S+|\b[\w.+-]+@[\w-]+\.[\w.-]+/gi;

// Paths (indices folded to []) where a figure is a working estimate rather
// than a fact about the jurisdiction. Ad costs are quotes the consultant will
// firm up; BAR targets are set with the Council, not researched.
const SKIP_NUMBERS = {
  plan: ['rows[].cost'],
  bar: ['results[].target']
};

// Per kind: top-level keys that must be present, and array lengths the schema
// prompt asked for. A count that is off by one is worth one retry.
const SHAPE = {
  profile:   { keys: ['criteria'] },
  community: { keys: ['lede', 'government', 'community', 'why'] },
  brochure:  { keys: ['title', 'lede', 'theOpportunity', 'thePlace', 'theOrganization', 'ideal', 'theJob', 'howToApply'] },
  ads:       { keys: ['full', 'short', 'social', 'association'] },
  plan:      { keys: ['rows'], min: { rows: 1 } },
  survey1:   { keys: ['name', 'questions'], exact: { questions: 8 } },
  survey2:   { keys: ['name', 'questions'], exact: { questions: 5 } },
  guide:     { keys: ['questions', 'scenarios'], exact: { questions: 6, scenarios: 4 } },
  schedule:  { keys: ['days'], min: { days: 1 } },
  contract:  { keys: ['title', 'sections'], min: { sections: 1 } },
  bar:       { keys: ['behavior', 'actions', 'results', 'governance', 'cadence'], min: { behavior: 1, actions: 1, results: 1 } }
};

function isObj(v){
  return v && typeof v === 'object' && !Array.isArray(v);
}

function fold(path){
  return path.replace(/\[\d+\]/g, '[]');
}

/** Visit every string leaf with its dotted path. */
function walkStrings(value, path, visit){
  if (typeof value === 'string') {
    visit(value, path);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => walkStrings(v, path + '[' + i + ']', visit));
  } else if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) walkStrings(v, path ? path + '.' + k : k, visit);
  }
}

function snippet(text, index, span){
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + span + 30);
  return (start > 0 ? '...' : '') + text.slice(start, end).replace(/\s+/g, ' ') + (end < text.length ? '...' : '');
}

// ---- numbers -------------------------------------------------------------

const MULT = { thousand: 1e3, k: 1e3, million: 1e6, m: 1e6, mm: 1e6, billion: 1e9, b: 1e9 };

// Dollar figures, "41 million" style figures, and any bare number at or above
// 1,000. Years are skipped: a fiscal year or a founding date is not a fact
// the desk can verify against the file and Claude is allowed to write them.
const DRAFT_NUM_RE = /\$\s?(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|mm|k|m|b)?\b|\b(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion)\b|\b(\d{1,3}(?:,\d{3})+|\d{4,})\b/gi;
const SOURCE_NUM_RE = /(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|mm|k|m|b)?\b/gi;
// A US phone number is a fact too, and one Claude has been known to make up.
// Compared by its ten digits so formatting differences do not matter.
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;

function phoneDigits(raw){
  return String(raw).replace(/\D/g, '').slice(-10);
}

function sourcePhones(sources){
  const out = new Set();
  const visit = text => {
    for (const m of stripLinks(text).match(PHONE_RE) || []) out.add(phoneDigits(m));
  };
  for (const src of sources || []) {
    if (src != null && typeof src !== 'number') walkStrings(src, '', visit);
  }
  return out;
}

function draftPhones(text){
  const out = [];
  const clean = stripLinks(text);
  let m;
  PHONE_RE.lastIndex = 0;
  while ((m = PHONE_RE.exec(clean))) out.push({ raw: m[0].trim(), digits: phoneDigits(m[0]), index: m.index });
  return out;
}

function toValue(digits, mult){
  const n = Number(String(digits).replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const m = mult ? MULT[mult.toLowerCase()] : 1;
  return n * (m || 1);
}

function isYear(raw){
  return /^\d{4}$/.test(raw) && Number(raw) >= 1600 && Number(raw) <= 2100;
}

function stripLinks(text){
  return String(text || '').replace(URL_RE, ' ');
}

/** Every numeric value that appears anywhere in the source material. */
function sourceNumbers(sources){
  const values = [];
  const visit = text => {
    const clean = stripLinks(text);
    let m;
    SOURCE_NUM_RE.lastIndex = 0;
    while ((m = SOURCE_NUM_RE.exec(clean))) {
      const v = toValue(m[1], m[2]);
      if (v != null) values.push(v);
      // "$41.2M" and "41,230,000" should both cover each other, so the bare
      // value goes in as well as the multiplied one.
      if (m[2]) {
        const bare = toValue(m[1], null);
        if (bare != null) values.push(bare);
      }
    }
  };
  for (const src of sources || []) {
    if (src == null) continue;
    if (typeof src === 'number') values.push(src);
    else walkStrings(src, '', visit);
  }
  return values;
}

function supported(value, known){
  for (const k of known) {
    if (k === value) return true;
    if (k > 0 && Math.abs(k - value) / k <= 0.015) return true;
  }
  return false;
}

function draftNumbers(text){
  const out = [];
  const clean = stripLinks(text);
  let m;
  DRAFT_NUM_RE.lastIndex = 0;
  while ((m = DRAFT_NUM_RE.exec(clean))) {
    const raw = m[0];
    let value;
    if (m[1] != null) value = toValue(m[1], m[2]);
    else if (m[3] != null) value = toValue(m[3], m[4]);
    else {
      if (isYear(m[5])) continue;
      value = toValue(m[5], null);
    }
    if (value == null || value < 1000 && !raw.startsWith('$')) continue;
    out.push({ raw: raw.trim(), value, index: m.index });
  }
  return out;
}

// ---- checks --------------------------------------------------------------

function checkStyle(json, add){
  walkStrings(json, '', (text, path) => {
    const dash = text.search(DASH_RE);
    if (dash >= 0) {
      add('style', path, 'replace the em or en dash with a comma, colon, period, or parentheses: "' + snippet(text, dash, 1) + '"');
    }
    const bang = text.indexOf('!');
    if (bang >= 0) {
      add('style', path, 'remove the exclamation point: "' + snippet(text, bang, 1) + '"');
    }
  });
}

function checkNumbers(kind, json, sources, add){
  const known = sourceNumbers(sources);
  const phones = sourcePhones(sources);
  const skip = SKIP_NUMBERS[kind] || [];
  walkStrings(json, '', (text, path) => {
    const folded = fold(path);
    if (skip.some(s => folded === s || folded.startsWith(s + '.'))) return;
    for (const p of draftPhones(text)) {
      if (phones.has(p.digits)) continue;
      add('number', path, '"' + p.raw + '" is a phone number that is not on file. Remove it or use the one from the search facts: "' + snippet(text, p.index, p.raw.length) + '"');
    }
    const seen = new Set();
    for (const n of draftNumbers(text)) {
      if (seen.has(n.raw)) continue;
      seen.add(n.raw);
      if (supported(n.value, known)) continue;
      add('number', path, '"' + n.raw + '" is not in the search facts, the research, or copy already on file. Remove it or use a figure that is: "' + snippet(text, n.index, n.raw.length) + '"');
    }
  });
}

function criterionIds(search){
  return new Set((search && search.criteria || []).map(c => c && c.id).filter(Boolean));
}

function checkCriteriaRefs(json, search, add){
  const ids = criterionIds(search);
  // Nothing adopted yet: there is nothing to check against, and telling Claude
  // every id is unknown would not help it.
  if (!ids.size) return;
  const list = [...ids].join(', ');
  const visit = (value, path) => {
    if (Array.isArray(value)) {
      value.forEach((v, i) => visit(v, path + '[' + i + ']'));
      return;
    }
    if (!isObj(value)) return;
    for (const [k, v] of Object.entries(value)) {
      const p = path ? path + '.' + k : k;
      if (k === 'crit' && Array.isArray(v)) {
        for (const id of v) {
          if (typeof id === 'string' && id && !ids.has(id)) {
            add('criteria', p, '"' + id + '" is not a criterion on this profile. Use one of: ' + list);
          }
        }
      } else if (k === 'from' && typeof v === 'string' && /^[STCO]\d+$/.test(v) && !ids.has(v)) {
        add('criteria', p, '"' + v + '" is not a criterion on this profile. Use one of: ' + list);
      } else {
        visit(v, p);
      }
    }
  };
  visit(json, '');
}

function checkProfile(json, add){
  const list = Array.isArray(json && json.criteria) ? json.criteria : [];
  if (!list.length) {
    add('shape', 'criteria', 'return 3 to 5 criteria of each kind (skill, trait, chall, opp)');
    return;
  }
  const seen = new Set();
  const count = {};
  for (const k of KINDS) count[k] = 0;
  list.forEach((c, i) => {
    const p = 'criteria[' + i + ']';
    if (!isObj(c)) { add('shape', p, 'each criterion is an object with id, kind, label, weight, note'); return; }
    if (!KINDS.includes(c.kind)) add('shape', p + '.kind', '"' + c.kind + '" must be one of skill, trait, chall, opp');
    else count[c.kind] += 1;
    if (!String(c.label || '').trim()) add('shape', p + '.label', 'label is empty');
    const w = Number(c.weight);
    if (!Number.isInteger(w) || w < 1 || w > 5) add('shape', p + '.weight', 'weight must be a whole number from 1 to 5');
    if (c.id) {
      if (seen.has(c.id)) add('shape', p + '.id', '"' + c.id + '" is used twice; ids must be unique');
      seen.add(c.id);
      const want = PREFIX[c.kind];
      if (want && !String(c.id).startsWith(want)) add('shape', p + '.id', '"' + c.id + '" should start with ' + want + ' for kind ' + c.kind);
    }
  });
  for (const k of KINDS) {
    if (count[k] < KIND_FLOOR) add('shape', 'criteria', 'only ' + count[k] + ' of kind ' + k + '; the profile needs ' + KIND_FLOOR + ' to ' + KIND_CAP);
    if (count[k] > KIND_CAP) add('shape', 'criteria', count[k] + ' of kind ' + k + '; the profile takes at most ' + KIND_CAP);
  }
}

function checkShape(kind, json, add){
  if (!isObj(json)) {
    add('shape', '', 'the draft must be a JSON object');
    return;
  }
  if (kind === 'profile') { checkProfile(json, add); return; }
  const spec = SHAPE[kind];
  if (!spec) return;
  for (const k of spec.keys) {
    const v = json[k];
    const empty = v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);
    if (empty) add('shape', k, 'missing or empty; the schema requires it');
  }
  for (const [k, n] of Object.entries(spec.exact || {})) {
    const have = Array.isArray(json[k]) ? json[k].length : 0;
    if (have && have !== n) add('shape', k, 'has ' + have + ' items; the schema asks for exactly ' + n);
  }
  for (const [k, n] of Object.entries(spec.min || {})) {
    const have = Array.isArray(json[k]) ? json[k].length : 0;
    if (have && have < n) add('shape', k, 'has ' + have + ' items; the schema asks for at least ' + n);
  }
  if (kind === 'ads') {
    for (const v of spec.keys) {
      const ad = json[v];
      if (!isObj(ad)) continue;
      if (!String(ad.headline || '').trim()) add('shape', v + '.headline', 'empty');
      if (!String(ad.body || '').trim()) add('shape', v + '.body', 'empty');
    }
    const social = isObj(json.social) ? String(json.social.body || '') : '';
    if (social.length > 500) add('shape', 'social.body', 'is ' + social.length + ' characters; keep it under 500');
  }
  if (kind === 'guide' && Array.isArray(json.questions)) {
    json.questions.forEach((q, i) => {
      if (!isObj(q)) return;
      for (const f of ['stem', 'approach', 'results', 'experience']) {
        if (!String(q[f] || '').trim()) add('shape', 'questions[' + i + '].' + f, 'empty; every ARE question needs a stem and all three follow-ups');
      }
    });
  }
  if ((kind === 'survey1' || kind === 'survey2') && Array.isArray(json.questions)) {
    json.questions.forEach((q, i) => {
      if (isObj(q) && !String(q.prompt || '').trim()) add('shape', 'questions[' + i + '].prompt', 'empty');
    });
  }
}

/**
 * Review a draft. Returns findings in the order a reader would fix them:
 * shape first (a missing section makes the rest moot), then facts, then ids,
 * then style.
 *
 * @param {string} kind        artifact kind (profile, brochure, ...)
 * @param {object} json        the parsed draft
 * @param {object} search      the search file (for criterion ids)
 * @param {Array}  sources     material whose figures count as supported
 */
function review(kind, json, search, sources){
  const findings = [];
  const add = (code, path, msg) => findings.push({ code, path, msg: (path ? path + ': ' : '') + msg });
  checkShape(kind, json, add);
  if (isObj(json)) {
    checkNumbers(kind, json, sources || [], add);
    if (kind !== 'profile') checkCriteriaRefs(json, search, add);
    checkStyle(json, add);
  }
  return findings;
}

const MAX_LISTED = 15;

/** The note that goes back to Claude. */
function describe(findings){
  const shown = findings.slice(0, MAX_LISTED);
  const more = findings.length - shown.length;
  return [
    'The desk editor reviewed the draft and found ' + findings.length + ' problem' + (findings.length === 1 ? '' : 's') + ':',
    ...shown.map(f => '- ' + f.msg),
    more > 0 ? '- and ' + more + ' more of the same kinds.' : '',
    '',
    'Return the complete corrected JSON in the same schema, every field present. Fix only what is listed and keep everything else as it was. No markdown fences.'
  ].filter(line => line !== '').join('\n');
}

module.exports = { review, describe, draftNumbers, sourceNumbers, SKIP_NUMBERS, SHAPE };
