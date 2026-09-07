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
  const state = { health:config, search:saved, newJurisdiction:'county' };
  const ui = vm.createContext({ state, esc:String, field:(label,hint,control)=>label+control, shell:x=>x, head:()=>'', packages:()=>[] });
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
  console.log(checks + ' county checks passed');
})().catch(error=>{ console.error(error); process.exitCode=1; });
