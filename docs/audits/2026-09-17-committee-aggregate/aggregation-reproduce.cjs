'use strict';
// Offline audit only. Run from repository root with node <this path>.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const c = require('../../../server/committee');
const integrity = require('../../../server/integrity');
const evidence = [];
const item = (label, weight=3, kind='skill', note='') => ({ label, weight, kind, note });
const search = rows => ({ members: rows.map((_, i) => ({userId: 'u'+i, searchRole: i === 0 ? 'manager' : 'committee'})), intake: { status:'open', submissions: Object.fromEntries(rows.map((r,i)=>['u'+i,c.normalizeSubmission({submitted:true,...r},null,'2026-09-17T12:00:00Z')])) } });
const record = (id, expected, actual) => evidence.push({id, expected, actual});

let s=search([{items:[item('Strong financial management skills',5)]},{items:[item('Financial management',4)]},{items:[item('financial management.',3)]},{items:[item('Other',5)]},{items:[item('Other',5)]},{submitted:false,items:[item('Financial management',1)]}]);
let a=c.aggregate(s);
assert.equal(a.submitted,5); assert.equal(a.byKind.skill[0].mentions,3); assert.equal(a.byKind.skill[0].avgWeight,4); assert.equal(a.byKind.skill[0].share,0.6); assert.equal(a.byKind.skill[0].consensus,'strong');
record('A01-core-math','Five submitted; 3/5 support; average 4; more mentions outrank higher average; draft excluded',{submitted:a.submitted,asked:a.asked,rank:a.byKind.skill.map(({label,mentions,share,avgWeight,consensus})=>({label,mentions,share,avgWeight,consensus}))});

s=search([{items:[item('Community engagement',1),item('Strong community engagement skills',5)]}]); a=c.aggregate(s);
assert.equal(a.byKind.skill[0].mentions,1); assert.equal(a.byKind.skill[0].avgWeight,1);
record('A02-duplicate-first-wins','Duplicate within one response contributes one vote; first weight survives',a.byKind.skill[0]);

s=search([{items:[item('Good governance',5)]},{items:[item('Governance',1)]},{items:[item('Budgeting',5)]},{items:[item('Financial management',5)]}]); a=c.aggregate(s);
assert.equal(a.byKind.skill.length,3);
record('A03-normalization','Lexical normalization merges Good governance/Governance, but Budgeting/Financial management remain separate',a.byKind.skill.map(({label,mentions,avgWeight,contested})=>({label,mentions,avgWeight,contested})));

s=search([{items:[item('Decisiveness',5,'trait','Need fast decisions.')]},{items:[item('Decisiveness',1,'trait','Avoid rushed decisions.')]}]); a=c.aggregate(s); let merged=c.mergeIntoCriteria([],a);
assert.equal(a.byKind.trait[0].contested,true); assert.equal(merged[0].weight,3); assert.equal(merged[0].contested,undefined); assert.ok(!merged[0].note.includes('rushed'));
record('A04-contested-loss','Diagnostic expectation: preserve disagreement in adopted evidence; actual direct adoption keeps first note and midpoint weight',{aggregate:a.byKind.trait[0],adopted:merged[0]});

s=search([{items:[item('Old priority',5)]},{items:[item('Old priority',4)]}]); const initial=c.mergeIntoCriteria([],c.aggregate(s));
s.intake.submissions.u0=c.normalizeSubmission({submitted:true,items:[item('New priority',5)]},s.intake.submissions.u0,'2026-09-17T13:00:00Z');
s.intake.submissions.u1=c.normalizeSubmission({submitted:true,items:[item('New priority',4)]},s.intake.submissions.u1,'2026-09-17T13:00:00Z');
a=c.aggregate(s); merged=c.mergeIntoCriteria(initial,a); assert.ok(merged.some(e=>e.label==='Old priority'&&e.note.includes('2 of 2')));
record('A05-withdrawn-priority-retained','Diagnostic expectation: refreshed profile explicitly distinguishes withdrawn evidence; actual retained line still claims 2 of 2 support',{currentAggregate:a.byKind.skill,adopted:merged});

const before={...structuredClone(s),criteria:initial,revision:1,profileRevision:1,history:[],staleArtifacts:{},scores:{},notesBy:{},artifacts:{brochure:{text:'Old priority'}},reviews:{}};
before.intake.submissions=search([{items:[item('Old priority',5)]},{items:[item('Old priority',4)]}]).intake.submissions;
const after=structuredClone(before); after.intake=structuredClone(s.intake); integrity.reconcile(after,before);
assert.deepEqual(after.staleArtifacts,{}); assert.equal(after.profileRevision,1);
record('A06-intake-change-not-stale','Diagnostic expectation: adopted profile signals source change; actual source revision alone creates no profile/derived-artifact stale flag',{revision:after.revision,profileRevision:after.profileRevision,staleArtifacts:after.staleArtifacts,history:after.history});

const existing=c.KINDS.flatMap(kind=>[1,2,3].map(n=>({id:c.PREFIX[kind]+n,kind,label:kind+' existing '+n,weight:3,note:''})));
a=c.aggregate(search([{items:[item('New priority',5)]}])); merged=c.mergeIntoCriteria(existing,a); const gaps=c.adoptionGaps(a);
assert.ok(c.KINDS.every(k=>merged.filter(e=>e.kind===k).length>=3)); assert.equal(gaps.length,4);
record('A07-false-gap-warning','Diagnostic expectation: UI says short only when final profile is short; actual four gaps returned despite all categories having >=3',{finalCounts:Object.fromEntries(c.KINDS.map(k=>[k,merged.filter(e=>e.kind===k).length])),returnedGaps:gaps});

s=search([{items:[item('Strong',5)]},{items:[item('Good',4)]}]); a=c.aggregate(s); merged=c.mergeIntoCriteria([{id:'S1',kind:'skill',label:'Strong',weight:3}],a);
assert.equal(new Set(merged.map(e=>e.id)).size,1); assert.equal(merged.length,2);
record('A08-empty-normalized-id-collision','Diagnostic expectation: unique criterion ids even for accepted short labels; actual Strong and Good both reuse S1',{aggregateKeys:a.byKind.skill.map(e=>e.key),adopted:merged});

s=search([{items:Array.from({length:9},(_,i)=>item('Priority '+i,5))},{items:Array.from({length:9},(_,i)=>item('Priority '+i,1))}]); a=c.aggregate(s); const packed=c.packForPrompt(a);
assert.equal(packed.skills.length,8); assert.equal(packed.contested.length,9); assert.equal(c.mergeIntoCriteria([],a).length,5);
record('A09-contested-prompt-cap-conflict','AI instructed to retain every contested item, but nine contested skills exceed five-item schema cap and main source list contains only eight',{rankedCount:a.byKind.skill.length,promptSkills:packed.skills.length,promptContested:packed.contested.length,directAdopted:c.mergeIntoCriteria([],a).length,missingFromMainList:packed.contested.filter(e=>!packed.skills.some(k=>k.label===e.label))});

s=search([{items:[item('Communication',5)],mustHave:'Municipal budgeting expertise',dealBreaker:'No local government experience'}]); a=c.aggregate(s);
record('A10-prose-and-coverage-tradeoffs','Direct adoption considers structured items only; free text remains separate and is available to AI',{directAdopted:c.mergeIntoCriteria([],a),promptVoices:c.packForPrompt(a).inTheirWords,categoryDenominator:a.submitted});

fs.writeFileSync(path.join(__dirname,'aggregation-evidence.json'),JSON.stringify({generatedAt:new Date().toISOString(),mode:'offline real production modules; synthetic data; no server or paid calls',scenarioCount:evidence.length,scenarios:evidence},null,2)+'\n');
console.log('Passed '+evidence.length+' reproducible audit scenarios. Evidence written beside this script.');
