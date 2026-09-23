'use strict';

// The 2024 ACS five-year detailed table is the latest published adapter
// configured here. Change the version only after checking the new dataset's
// variable and geography definitions against Census documentation.
const YEAR = 2024;
const VARIABLE = 'B01003_001E';
const STATES = `Alabama:AL:01|Alaska:AK:02|Arizona:AZ:04|Arkansas:AR:05|California:CA:06|Colorado:CO:08|Connecticut:CT:09|Delaware:DE:10|District of Columbia:DC:11|Florida:FL:12|Georgia:GA:13|Hawaii:HI:15|Idaho:ID:16|Illinois:IL:17|Indiana:IN:18|Iowa:IA:19|Kansas:KS:20|Kentucky:KY:21|Louisiana:LA:22|Maine:ME:23|Maryland:MD:24|Massachusetts:MA:25|Michigan:MI:26|Minnesota:MN:27|Mississippi:MS:28|Missouri:MO:29|Montana:MT:30|Nebraska:NE:31|Nevada:NV:32|New Hampshire:NH:33|New Jersey:NJ:34|New Mexico:NM:35|New York:NY:36|North Carolina:NC:37|North Dakota:ND:38|Ohio:OH:39|Oklahoma:OK:40|Oregon:OR:41|Pennsylvania:PA:42|Rhode Island:RI:44|South Carolina:SC:45|South Dakota:SD:46|Tennessee:TN:47|Texas:TX:48|Utah:UT:49|Vermont:VT:50|Virginia:VA:51|Washington:WA:53|West Virginia:WV:54|Wisconsin:WI:55|Wyoming:WY:56`
  .split('|').map(row => row.split(':'));

function stateOf(value) {
  const input = String(value || '').trim().toLowerCase();
  return STATES.find(([name, abbreviation]) => input === name.toLowerCase() || input === abbreviation.toLowerCase()) || null;
}
function baseName(value, county) {
  let name = String(value || '').trim().replace(/^(city|town|village|county) of /i, '');
  if (county) name = name.replace(/ county$/i, '');
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function matchName(value, city, state, county) {
  const [place, region] = String(value || '').split(',').map(s => s.trim());
  if (region !== state) return false;
  const stem = county ? place.replace(/ county$/i, '') : place.replace(/ (city|town|village|municipality|borough|CDP)$/i, '');
  return baseName(stem, county) === baseName(city, county);
}

async function populationEvidence({ city, state, jurisdictionType, key = process.env.SLATE_CENSUS_API_KEY,
  fetcher = fetch }) {
  if (!key || !/^[A-Za-z0-9]{20,80}$/.test(key)) return null;
  const region = stateOf(state);
  if (!region || !baseName(city, jurisdictionType === 'county')) return null;
  const [stateName, , stateFips] = region;
  const county = jurisdictionType === 'county';
  const geography = county ? 'county' : 'place';
  const url = new URL(`https://api.census.gov/data/${YEAR}/acs/acs5`);
  url.searchParams.set('get', `NAME,${VARIABLE}`);
  url.searchParams.set('for', `${geography}:*`);
  url.searchParams.set('in', `state:${stateFips}`);
  url.searchParams.set('key', key);
  const response = await fetcher(url, { signal:AbortSignal.timeout(6000), redirect:'error' });
  if (!response.ok || Number(response.headers.get('content-length') || 0) > 250000) return null;
  const raw = await response.text();
  if (raw.length > 250000) return null;
  const table = JSON.parse(raw);
  if (!Array.isArray(table) || table.length < 2) return null;
  const columns = table[0];
  const nameAt = columns.indexOf('NAME');
  const valueAt = columns.indexOf(VARIABLE);
  if (nameAt < 0 || valueAt < 0) return null;
  const matched = table.slice(1).filter(row => matchName(row[nameAt], city, stateName, county));
  if (matched.length !== 1) return null;
  const value = Number(matched[0][valueAt]);
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  const name = matched[0][nameAt];
  return { url:`https://api.census.gov/data/${YEAR}/acs/acs5.html`,
    documentDate:String(YEAR), sourceType:'census-acs5',
    text:`${name}. ${YEAR} American Community Survey five-year estimate, total population (${VARIABLE}): ${value.toLocaleString('en-US')}. Geography: ${geography}, state FIPS ${stateFips}.` };
}

module.exports = { YEAR, VARIABLE, stateOf, matchName, populationEvidence };
