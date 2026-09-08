'use strict';

const TYPES = {
  municipality: { key:'municipality', label:'City or town', noun:'jurisdiction', clientPlaceholder:'City of Ridgeline', positionPlaceholder:'City Manager', governmentPlaceholder:'Council–Manager' },
  county: { key:'county', label:'County', noun:'county', clientPlaceholder:'Example County', positionPlaceholder:'County Administrator', governmentPlaceholder:'Board–Administrator' }
};
function typeOf(value) { return typeof value === 'string' && Object.hasOwn(TYPES, value) ? value : 'municipality'; }
function governingBody(search) {
  if (typeOf(search.jurisdictionType) !== 'county') return 'governing body';
  return /^(az|arizona)$/i.test(String(search.state || '').trim()) ? 'Board of Supervisors' : 'county governing board';
}
function context(search) {
  if (typeOf(search.jurisdictionType) !== 'county') return 'This is a city or town search. Use the position title and form of government supplied on the file.';
  return `This is a COUNTY search for ${search.position || 'County Administrator'}, reporting to the ${governingBody(search)}.
Use county terminology in all reader-facing text, including headings, interview panels, governance surveys, agreements, and evaluations. Preserve the actual position title; do not call the employer a city or the position a city manager.
Describe the administrator's authority only as supported by the search facts and official sources. Distinguish board-directed departments from separately elected offices; do not assume all county offices report to the administrator. Confirm responsibilities and service areas from county sources instead of importing city-service assumptions.
Use the ${governingBody(search)} in place of council/mayor examples. Existing JSON keys such as council and managerRole stay unchanged; their text must describe this county. For recruiting outlets, consider relevant county associations and administrator networks rather than automatically specifying a municipal league.`;
}
/* ------------------------------------------------------------------ *
 * Facts that must come from a person, not from a draft
 *
 * A county's authority structure cannot be inferred from a position title.
 * Two counties with identically titled administrators can differ on who
 * appoints them, which offices report to them, and which are separately
 * elected. Generated text is a starting point for a conversation with the
 * county, never the answer.
 *
 * So these are recorded explicitly, each with the source it came from and the
 * date that source was current, and each is unconfirmed until a named person
 * confirms it. `material` marks the ones that appear in published recruiting
 * material, where being wrong misleads a candidate about the job.
 * ------------------------------------------------------------------ */
const FACT_FIELDS = [
  { key: 'governingBody', label: 'Governing body', material: true,
    why: 'Who the position answers to. Board of Supervisors in Arizona counties; do not assume a council.' },
  { key: 'reportsTo', label: 'Reporting relationship', material: true,
    why: 'Whether the administrator reports to the whole board, a chair, or someone else.' },
  { key: 'appointmentAuthority', label: 'Appointment and removal authority', material: true,
    why: 'Who appoints and who can remove. This is a statutory question, not a drafting one.' },
  { key: 'separatelyElected', label: 'Separately elected offices', material: true,
    why: 'Sheriff, Assessor, Recorder, Treasurer, County Attorney and others typically do NOT report to the administrator. Claiming otherwise misstates the job.' },
  { key: 'serviceResponsibilities', label: 'Departments and services in scope', material: true,
    why: 'County services differ from municipal ones. Do not import city assumptions.' },
  { key: 'employmentTerms', label: 'Employment terms', material: true,
    why: 'Contract or at-will, term, and any board-adopted terms.' },
  { key: 'applicationMethod', label: 'How candidates apply', material: true,
    why: 'The method the county has approved, including where materials are actually received.' },
  { key: 'factReviewer', label: 'Responsible fact reviewer', material: false,
    why: 'The named person at the county who confirmed these facts. Without this, nothing above is verified.' }
];

const MATERIAL_KEYS = new Set(FACT_FIELDS.filter(f => f.material).map(f => f.key));

/**
 * A single fact is confirmed only when it has a value, a source, the date that
 * source was current, and a person who confirmed it.
 *
 * A value alone is an assertion. The plan requires source and date evidence
 * for material public claims, so a material fact without them is reported as
 * unconfirmed rather than counted.
 */
function factState(record, field) {
  const value = String(record?.value || '').trim();
  if (!value) return { state: 'missing', missing: ['value'] };

  const missing = [];
  if (field.material) {
    if (!String(record?.source || '').trim()) missing.push('source');
    if (!String(record?.asOf || '').trim()) missing.push('date the source was current');
    if (!String(record?.confirmedBy || '').trim()) missing.push('who confirmed it');
  }
  return missing.length ? { state: 'unverified', missing } : { state: 'confirmed', missing: [] };
}

/**
 * What is confirmed, what is asserted without evidence, and what is absent.
 *
 * Reported on every search so the gap is visible while the work is being done,
 * rather than discovered when a county reads the brochure.
 */
function factStatus(search) {
  const verification = search?.verification || {};
  const fields = [];
  for (const field of FACT_FIELDS) {
    const record = verification[field.key] || null;
    const { state, missing } = factState(record, field);
    fields.push({
      key: field.key,
      label: field.label,
      why: field.why,
      material: Boolean(field.material),
      state,
      needs: missing,
      value: record?.value || '',
      source: record?.source || '',
      asOf: record?.asOf || '',
      confirmedBy: record?.confirmedBy || '',
      confirmedAt: record?.confirmedAt || ''
    });
  }

  const confirmed = fields.filter(f => f.state === 'confirmed');
  const material = fields.filter(f => f.material);
  return {
    applies: typeOf(search?.jurisdictionType) === 'county',
    fields,
    confirmedCount: confirmed.length,
    total: fields.length,
    materialConfirmed: material.filter(f => f.state === 'confirmed').length,
    materialTotal: material.length,
    // The single question a consultant needs answered before publishing.
    readyToPublish: material.every(f => f.state === 'confirmed'),
    outstanding: fields.filter(f => f.state !== 'confirmed').map(f => f.label)
  };
}

function validateVerification(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Provide the facts to record.';
  const allowed = new Set(FACT_FIELDS.map(f => f.key));
  for (const [key, record] of Object.entries(body)) {
    if (!allowed.has(key)) return 'Unknown fact: ' + key;
    if (!record || typeof record !== 'object' || Array.isArray(record)) return 'Each fact needs a value and its source.';
    for (const [prop, value] of Object.entries(record)) {
      if (!['value', 'source', 'asOf', 'confirmedBy'].includes(prop)) return 'Unknown field on ' + key + ': ' + prop;
      if (typeof value !== 'string' || value.length > 2000) return 'Fact details must be text under 2,000 characters.';
    }
  }
  return null;
}

module.exports = {
  TYPES, typeOf, governingBody, context,
  FACT_FIELDS, MATERIAL_KEYS, factStatus, validateVerification
};
