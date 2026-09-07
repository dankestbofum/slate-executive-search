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
module.exports = { TYPES, typeOf, governingBody, context };
