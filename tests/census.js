'use strict';
const assert = require('node:assert/strict');
const { populationEvidence, matchName, YEAR } = require('../server/census');

(async () => {
  assert.equal(YEAR, 2024);
  assert.equal(matchName('Phoenix city, Arizona', 'City of Phoenix', 'Arizona', false), true);
  assert.equal(matchName('Phoenix city, Arizona', 'City of Phoenix', 'New Mexico', false), false);
  let called = 0;
  const fetcher = async url => {
    called++;
    assert.equal(url.hostname, 'api.census.gov');
    assert.equal(url.searchParams.get('in'), 'state:04');
    assert.equal(url.searchParams.get('for'), 'place:*');
    return { ok:true, headers:new Headers(), text:async () => JSON.stringify([
      ['NAME','B01003_001E','state','place'],
      ['Phoenix city, Arizona','1651000','04','55000'],
      ['Phoenix city, New Mexico','100','35','55000']
    ]) };
  };
  const source = await populationEvidence({ city:'City of Phoenix', state:'AZ',
    jurisdictionType:'municipality', key:'12345678901234567890', fetcher });
  assert.equal(called, 1);
  assert.equal(source.documentDate, '2024');
  assert.match(source.text, /1,651,000/);
  assert.ok(!source.url.includes('12345678901234567890'), 'API key never becomes a citation');
  assert.equal(await populationEvidence({ city:'Phoenix', state:'AZ',
    jurisdictionType:'municipality', key:'', fetcher }), null);
  console.log('Census: versioned estimate, exact geography, and key privacy passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
