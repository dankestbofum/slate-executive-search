'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const jurisdictions = require('../server/jurisdictions');
const { generate } = require('../server/ai');
const { reconcile } = require('../server/integrity');
let checks = 0;
function check(name, fn) { fn(); checks++; console.log('PASS  County: ' + name); }
let cookie;
async function request(url, method='GET', body) {
  const headers = { 'content-type':'application/json' };
  if (cookie) headers.cookie = cookie;
  if (method === 'PATCH') headers['if-match'] = String((await request(url)).body.revision);
  const response = await fetch(process.env.SLATE_URL + url, { method, headers, body:body === undefined ? undefined : JSON.stringify(body) });
  return { status:response.status, body:await response.json(), cookie:response.headers.get('set-cookie')?.split(';')[0] };
}
(async () => {
  const login = await request('/api/login', 'POST', { email:'abe@slate.local', pin:'2468' });
  assert.equal(login.status, 200);
  cookie = login.cookie;
  const config = (await request('/api/config')).body;
  check('setup offers city/town and county', () => assert.deepEqual(config.jurisdictionTypes.map(t=>t.key), ['municipality','county']));
  const created = await request('/api/searches', 'POST', { client:'Example County', jurisdictionType:'county', position:'County Administrator', state:'AZ' });
  assert.ok(created.status < 300);
  const url = '/api/searches/' + created.body.id;
  let saved = (await request(url)).body;
  check('county choice and government default survive reload', () => {
    assert.equal(saved.jurisdictionType, 'county');
    assert.equal(saved.fog, 'Board–Administrator');
  });
  const listing = (await request('/api/searches')).body;
  check('search summaries retain the type', () => assert.equal(listing.find(s=>s.id===saved.id).jurisdictionType, 'county'));
  const invalid = await request(url, 'PATCH', { jurisdictionType:'invalid', client:'Wrong' });
  saved = (await request(url)).body;
  check('invalid type cannot partially modify search facts', () => { assert.equal(invalid.status,400); assert.equal(saved.client,'Example County'); });
  const invalidCreate = await request('/api/searches', 'POST', { jurisdictionType:'invalid', client:'Wrong', position:'Administrator' });
  check('invalid type cannot create a search', () => assert.equal(invalidCreate.status,400));
  const invalidArray = await request('/api/searches', 'POST', { jurisdictionType:['county'], client:'Wrong', position:'Administrator' });
  check('type must be a string', () => assert.equal(invalidArray.status,400));
  await request(url, 'PATCH', { jurisdictionType:'municipality' });
  saved = (await request(url)).body;
  check('switching type updates only the default government', () => assert.equal(saved.fog,'Council–Manager'));
  await request(url, 'PATCH', { fog:'Custom official structure' });
  await request(url, 'PATCH', { jurisdictionType:'county' });
  saved = (await request(url)).body;
  check('custom government and position are preserved', () => { assert.equal(saved.fog,'Custom official structure'); assert.equal(saved.position,'County Administrator'); });
  const legacy = await request('/api/searches', 'POST', { client:'Example Town', position:'Town Manager' });
  check('omitting type preserves municipal behavior', () => assert.equal(legacy.body.jurisdictionType,'municipality'));

  const before = { ...saved, artifacts:{ guide:{ questions:[] } }, reviews:{ guide:{ approved:true } } };
  const changed = JSON.parse(JSON.stringify(before));
  changed.jurisdictionType = 'municipality';
  reconcile(changed, before);
  check('type changes preserve copy but invalidate its approval', () => {
    assert.deepEqual(changed.artifacts, before.artifacts);
    assert.match(changed.staleArtifacts.guide, /jurisdiction type changed/);
    assert.equal(changed.reviews.guide, undefined);
    assert.ok(changed.history.some(h=>h.kind==='facts' && h.body.jurisdictionType==='county'));
  });
  for (const kind of ['survey1','plan','bar']) {
    let prompt;
    await generate(kind, saved, { call:async input => {
      prompt ||= input.messages[0].content;
      return { content:[{type:'text', text:JSON.stringify({ questions:[], rows:[], behavior:[], actions:[], results:[], governance:[] })}], usage:{} };
    } });
    check(kind + ' drafts receive Arizona county context', () => {
      assert.match(prompt, /COUNTY search for County Administrator/);
      assert.match(prompt, /Board of Supervisors/);
      assert.match(prompt, /separately elected offices/);
      assert.match(prompt, /"jurisdictionType": "county"/);
      if (kind==='plan') assert.match(prompt, /Include ICMA, relevant county associations/);
    });
  }
  check('other states do not inherit Arizona board naming', () => assert.equal(jurisdictions.governingBody({...saved,state:'CO'}),'county governing board'));

  const source = fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
  const state = { health:config, search:saved, newJurisdiction:'county', open:{} };
  const ui = vm.createContext({
    state, esc:String, field:(label,hint,control)=>label+control, shell:x=>x, head:()=>'', packages:()=>[],
    // Shared primitives these two screens are assembled from. Stubbed so the
    // assertion stays about county wording, not about page furniture.
    sectionHead:()=>'', actionBar:(a,b)=>String(a)+String(b||''), emptyState:()=>'',
    withTip:h=>h, TIPS:{}, packageChoice:()=>'', packageLabel:k=>String(k||'')
  });
  vm.runInContext(source.slice(source.indexOf('function jurisdictionInfo('),source.indexOf('function nextHint(')),ui);
  vm.runInContext(source.slice(source.indexOf('function vFacts('),source.indexOf('function seatPill(')),ui);
  ui.stepNo = ()=>1;
  for (const render of ['vNew','vFacts']) check(render + ' renders a selected county option', () => {
    const html = vm.runInContext(render+'()', ui);
    assert.match(html, /value="county" selected/);
    assert.match(html, /County website/);
    assert.match(html, /County Administrator/);
  });
  const controls = { jurisdictionType:{value:'county'}, client:{value:'Entered County'}, position:{value:'Chief Administrative Officer'}, fog:{value:'Council–Manager'} };
  const label = {textContent:'City or town website'};
  controls.website = { closest:()=>({querySelector:()=>label}) };
  ui.form = { id:'newsearch', dataset:{}, querySelector:selector=>controls[selector.match(/name="([^"]+)"/)[1]] };
  state.newJurisdiction = 'municipality';
  vm.runInContext('updateJurisdictionFields(form)',ui);
  check('dropdown change updates examples without clearing entered values', () => {
    assert.equal(controls.client.value,'Entered County');
    assert.equal(controls.position.value,'Chief Administrative Officer');
    assert.equal(controls.position.placeholder,'County Administrator');
    assert.equal(controls.fog.value,'Board–Administrator');
    assert.equal(label.textContent,'County website');
    assert.equal(state.newJurisdiction,'county');
  });
  controls.fog.value = 'Custom government';
  controls.jurisdictionType.value = 'municipality';
  vm.runInContext('updateJurisdictionFields(form)',ui);
  check('switching back preserves custom facts', () => { assert.equal(controls.fog.value,'Custom government'); assert.equal(controls.position.placeholder,'City Manager'); });

  /* ---------------- DEP-07: county site discovery ---------------- */

  const site = require('../server/site');
  const countyHtml = [
    '<a href="/news">News</a>',
    '<a href="/city-manager">City Manager</a>',
    '<a href="/board-of-supervisors">Board of Supervisors</a>',
    '<a href="/elected-officials">Elected Officials</a>',
    '<a href="/organizational-chart">Org Chart</a>',
    '<a href="/adopted-budget">Adopted Budget</a>',
    '<a href="/strategic-plan">Strategic Plan</a>',
    '<a href="/departments">Departments</a>'
  ].join('');

  // Synthetic HTML only. CI must never depend on a live county website.
  const countyPaths = site.extractLinks(countyHtml, 'https://example.gov/', 'county')
    .map(u => new URL(u).pathname);
  check('county discovery finds board, elected offices and org chart', () => {
    for (const wanted of ['/board-of-supervisors', '/elected-officials', '/organizational-chart']) {
      assert.ok(countyPaths.includes(wanted), 'county discovery missed ' + wanted);
    }
  });
  check('county discovery ranks county pages ahead of municipal ones', () => {
    assert.ok(countyPaths.indexOf('/board-of-supervisors') < countyPaths.indexOf('/city-manager'),
      'a city-manager page outranked the board of supervisors on a county search');
  });

  const municipalPaths = site.extractLinks(countyHtml, 'https://example.gov/', 'municipality')
    .map(u => new URL(u).pathname);
  check('municipal discovery is unchanged and still prefers the city manager', () => {
    assert.equal(municipalPaths[0], '/city-manager');
  });

  check('boilerplate paths differ by jurisdiction', () => {
    const county = site.extraPaths('county');
    const municipal = site.extraPaths('municipality');
    assert.ok(county.includes('/board-of-supervisors'));
    assert.ok(county.includes('/county-administrator'));
    assert.ok(municipal.includes('/city-manager'));
    assert.ok(!municipal.includes('/board-of-supervisors'), 'a municipal search would fetch county pages');
  });

  check('discovery survives a relative redirect target', () => {
    const relative = site.extractLinks('<a href="board-of-supervisors/members">M</a>', 'https://example.gov/government/', 'county');
    assert.equal(new URL(relative[0]).pathname, '/government/board-of-supervisors/members');
  });

  /* ---------------- DEP-07: fact verification ---------------- */

  check('county authority facts start unconfirmed', () => {
    const status = jurisdictions.factStatus({ jurisdictionType:'county' });
    assert.equal(status.applies, true);
    assert.equal(status.confirmedCount, 0);
    assert.equal(status.readyToPublish, false, 'an empty search reported itself ready to publish');
    assert.ok(status.outstanding.includes('Separately elected offices'));
  });

  check('a material fact needs a source, a date and a confirmer', () => {
    const asserted = jurisdictions.factStatus({
      jurisdictionType:'county',
      verification: { governingBody: { value:'Board of Supervisors' } }
    });
    const field = asserted.fields.find(f => f.key === 'governingBody');
    assert.equal(field.state, 'unverified', 'a bare assertion counted as confirmed');
    assert.deepEqual(field.needs, ['source', 'date the source was current', 'who confirmed it']);
  });

  check('a fully evidenced fact is confirmed', () => {
    const status = jurisdictions.factStatus({
      jurisdictionType:'county',
      verification: { governingBody: {
        value:'Board of Supervisors', source:'https://example.gov/board', asOf:'2026-09-01', confirmedBy:'County HR Director'
      } }
    });
    assert.equal(status.fields.find(f => f.key === 'governingBody').state, 'confirmed');
    assert.equal(status.confirmedCount, 1);
  });

  const verifyUrl = url + '/verification';
  async function putVerification(body) {
    const revision = String((await request(url)).body.revision);
    const response = await fetch(process.env.SLATE_URL + verifyUrl, {
      method: 'PUT',
      headers: { 'content-type':'application/json', cookie, 'if-match': revision },
      body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  }
  const recorded = await putVerification({
    governingBody: { value:'Board of Supervisors', source:'https://example.gov/board', asOf:'2026-09-01', confirmedBy:'County HR Director' },
    separatelyElected: { value:'Sheriff, Assessor, Recorder, Treasurer, County Attorney' }
  });
  check('recorded facts persist and are reported on the search', () => {
    assert.equal(recorded.status, 200);
    const status = recorded.body.factStatus;
    assert.equal(status.fields.find(f => f.key === 'governingBody').state, 'confirmed');
    assert.equal(status.fields.find(f => f.key === 'separatelyElected').state, 'unverified');
  });

  check('the server stamps who confirmed a fact, not the client', () => {
    const field = recorded.body.factStatus.fields.find(f => f.key === 'governingBody');
    assert.ok(field.confirmedAt, 'no confirmation timestamp was recorded');
    assert.ok(Date.parse(field.confirmedAt) > 0, 'the confirmation timestamp is not a real date');
  });

  const badField = await putVerification({ notARealFact: { value:'x' } });
  const badProp = await putVerification({ governingBody: { sneaky:'x' } });
  check('the verification endpoint validates its input', () => {
    assert.equal(badField.status, 400);
    assert.equal(badProp.status, 400);
  });

  check('a municipal search does not carry county fact requirements', () => {
    const status = jurisdictions.factStatus({ jurisdictionType:'municipality' });
    assert.equal(status.applies, false);
  });

  console.log(checks + ' county checks passed');
})().catch(error=>{ console.error(error); process.exitCode=1; });
