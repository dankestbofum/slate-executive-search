'use strict';

const PACK_THEMES = ['photo', 'split', 'classic', 'banner', 'masthead'];
const PACK_SCHEMES = ['navy', 'forest', 'burgundy', 'charcoal', 'municipal'];

function packTheme(v){
  return PACK_THEMES.includes(v) ? v : 'photo';
}

function packScheme(v){
  return PACK_SCHEMES.includes(v) ? v : 'navy';
}

function applyBrochureDefaults(next, prev, opts={}){
  prev = prev || {};
  if (!next.photos) next.photos = prev.photos || {};
  const theme = opts.preferPrev ? (prev.theme || next.theme) : (next.theme || prev.theme);
  const scheme = opts.preferPrev ? (prev.scheme || next.scheme) : (next.scheme || prev.scheme);
  next.theme = packTheme(theme);
  next.scheme = packScheme(scheme);
  return next;
}

// Canonical key+label pairs for the community and government profile
// sections. This is the single source of truth for both realms: ai.js
// consumes the bare keys to iterate the schema, index.js serves the full
// pairs at /api/config, and the browser (public/app.js) renders/edits those
// fields from that response instead of hardcoding its own copy.
const PLACE_FIELDS = [
  ['history', 'History and identity'],
  ['qualityOfLife', 'Quality of life'],
  ['housing', 'Housing and cost of living'],
  ['schools', 'Schools'],
  ['parksArts', 'Parks, arts, and culture'],
  ['economy', 'Employers and economic base'],
  ['healthcare', 'Healthcare'],
  ['transportation', 'Transportation'],
  ['climate', 'Climate and outdoors'],
  ['growth', 'Growth and major projects']
];
const GOV_FIELDS = [
  ['form', 'Form of government'],
  ['elected', 'Elected officials'],
  ['roles', 'Roles of mayor, council, or board'],
  ['managerRole', 'Role of the manager'],
  ['employees', 'Employees'],
  ['budget', 'Budget'],
  ['departments', 'Major departments'],
  ['electedStaff', 'Elected officials and staff']
];
const PLACE_KEYS = PLACE_FIELDS.map(([k]) => k);
const GOV_KEYS = GOV_FIELDS.map(([k]) => k);

function text(v){
  return String(v == null ? '' : v).trim();
}

function paras(block, keys){
  if (!block) return '';
  if (typeof block === 'string') return text(block);
  return (keys || Object.keys(block)).map(k => text(block[k])).filter(Boolean).join('\n\n');
}

function ofKind(search, kind){
  return (search.criteria || []).filter(c => c.kind === kind && text(c.label));
}

function asList(rows){
  return rows.map(c => {
    const note = text(c.note);
    return note ? c.label.trim() + ': ' + note : c.label.trim();
  }).join('; ');
}

function factLines(facts){
  if (!Array.isArray(facts)) return '';
  return facts.map(f => {
    const k = text(f && f.k);
    const v = text(f && f.v);
    if (!k && !v) return '';
    return k && v ? k + ': ' + v : (k || v);
  }).filter(Boolean).join('\n');
}

function assembleBrochure(search){
  const prev = (search.artifacts && search.artifacts.brochure) || {};
  const c = (search.artifacts && search.artifacts.community) || {};
  const position = text(search.position) || 'Position';
  const client = text(search.client) || 'the jurisdiction';
  const skills = ofKind(search, 'skill');
  const traits = ofKind(search, 'trait');
  const chall = ofKind(search, 'chall');
  const opps = ofKind(search, 'opp');
  const place = paras(c.community, PLACE_KEYS);
  const gov = paras(c.government, GOV_KEYS);
  const org = text(c.organization);
  const why = text(c.why);
  const lede = text(c.lede);
  const salary = text(search.salary);
  const firstReview = text(search.firstReview);
  const fog = text(search.fog) || text(c.government && c.government.form);
  const managerRole = text(c.government && c.government.managerRole);

  const thePlace = place || factLines(c.facts);
  const theOrganization = [org, gov].filter(Boolean).join('\n\n');
  const theOpportunity = why || lede || ('The ' + client + ' is recruiting a ' + position + '.');
  const leadershipOpportunity = managerRole
    || ('This ' + position + ' works with ' + (fog || 'the governing body') + ' and leads the organization.');

  const parts = [];
  if (skills.length) parts.push('Essential skills: ' + asList(skills) + '.');
  if (traits.length) parts.push('Leadership traits: ' + asList(traits) + '.');

  const howToApply = firstReview
    ? 'Submit a letter, resume, and the initial candidate survey at the link in the advertisement. First review: ' + firstReview + '. Applications stay confidential to the extent state law allows until finalists are named.'
    : 'Submit a letter, resume, and the initial candidate survey at the link in the advertisement. Applications stay confidential to the extent state law allows until finalists are named.';

  return {
    title: position + ': ' + client,
    lede: lede || why,
    theOpportunity,
    thePlace,
    theOrganization,
    leadershipOpportunity,
    challenges: asList(chall),
    opportunities: asList(opps),
    ideal: parts.join(' '),
    theJob: managerRole || ('Lead the organization as ' + position + ' for ' + client + '.'),
    compensation: salary
      ? 'Salary: ' + salary + '. Details of the benefits package are confirmed with the client before posting.'
      : 'Compensation and benefits are confirmed with the client before posting.',
    whyConsider: why || lede || thePlace,
    howToApply,
    photos: prev.photos && typeof prev.photos === 'object' ? prev.photos : {},
    theme: packTheme(prev.theme),
    scheme: packScheme(prev.scheme)
  };
}

module.exports = {
  assembleBrochure, applyBrochureDefaults,
  PLACE_KEYS, GOV_KEYS, PLACE_FIELDS, GOV_FIELDS,
  PACK_THEMES, PACK_SCHEMES, packTheme, packScheme
};
