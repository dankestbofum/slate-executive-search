'use strict';
const assert = require('node:assert/strict');
const core = require('../server/research-core');
const cache = require('../server/research-cache');

(async () => {
  const site = { canonical:'https://example.gov', pages:[
    { url:'https://example.gov/about', text:'City of Example, Arizona. Council-manager government. Population 12,000 in 2025. A welcoming desert community.' },
    { url:'https://example.gov/budget', text:'Adopted FY 2026 general fund budget: $20 million.' }
  ] };
  const item = (value,evidenceId,year='') => ({ value,evidenceId,year });
  const answer = { facts:{ client:item('City of Example','E1'), state:item('Arizona','E1'),
    fog:item('Council-manager','E1'), population:item('12,000','E1','2025'),
    budget:item('$20 million general fund','E2','2026'), salary:item('',''), notes:item('','') },
    community:{ lede:item('A welcoming desert community.','E1'),
      government:item('Council-manager government.','E1'), community:item('','') } };
  const wrong = structuredClone(answer);
  wrong.facts.budget.evidenceId = 'E999';
  wrong.facts.population.year = '2024';
  assert.ok(core.validate(wrong, core.evidenceFor(site), { city:'Example',state:'Arizona',position:'City Manager' }).errors.length >= 2);
  let calls = 0;
  const op = { usage:{input_tokens:0,output_tokens:0}, usageKnown:false,
    throwIfDone(){}, stageIs(){}, useRound(){}, roundBudget(){return 2000;}, record(){},
    addUsage(usage){ this.usage={input_tokens:this.usage.input_tokens+usage.input_tokens,
      output_tokens:this.usage.output_tokens+usage.output_tokens};this.usageKnown=true; } };
  const out = await core.extract({ site, city:'Example', state:'Arizona', jurisdictionType:'municipality',
    position:'City Manager', model:'claude-opus-5-5', op,
    call:async request => { calls++; assert.equal(request.output_config.effort,'low');
      return { content:[{type:'text',text:JSON.stringify(calls===1?wrong:answer)}],
        usage:{input_tokens:100,output_tokens:40} }; } });
  assert.equal(calls,2,'one evidence-only repair is allowed');
  assert.equal(out.json.facts.budget,'$20 million general fund');
  assert.equal(out.fieldEvidence.budget.url,'https://example.gov/budget');
  assert.equal(out.partial,true,'all core findings wait for review');
  assert.equal(out.usage.input_tokens,200);

  const store = { researchEvidence:[], researchResults:[] };
  let now = Date.now();
  const db = { db:store, persist(){} };
  const c = cache.create({ db, clock:()=>now });
  c.saveEvidence('org-a',site.canonical,'municipality',site);
  assert.equal(c.evidence('org-a',site.canonical,'municipality').pages.length,2);
  assert.equal(c.evidence('org-b',site.canonical,'municipality'),null);
  const key = c.resultKey({ organizationId:'org-a',city:'Example',state:'Arizona',
    jurisdictionType:'municipality', position:'City Manager',model:'claude-opus-5-5',site });
  c.saveResult(key,out);
  assert.ok(c.result(key));
  assert.notEqual(key,c.resultKey({ organizationId:'org-a',city:'Example',state:'Arizona',
    jurisdictionType:'municipality', position:'Police Chief',model:'claude-opus-5-5',site }));
  now += cache.TTL_MS + 1;
  assert.equal(c.evidence('org-a',site.canonical,'municipality'),null);
  console.log('Research core: citations, bounded repair, review, workspace cache and freshness passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
