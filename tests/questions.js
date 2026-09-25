'use strict';
const assert = require('assert/strict');
// ai.js imports the store during module initialization. A direct invocation
// must be as isolated as tests/run.js, before loading any runtime module.
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(),'slate-question-tests-'));
const questions = require('../server/questions');
const ai = require('../server/ai');
const desk = require('../server/desk');

(async () => {
  const search = { package:'executive', client:'Test City', position:'City Manager', criteria:[], artifacts:{} };
  const bundle = {
    survey1:{name:'Initial survey', questions:[{n:1,prompt:'Describe your budget experience.'}]},
    survey2:{name:'Semifinalist survey', questions:[{n:1,prompt:'Describe how you handled a council disagreement.'}]},
    guide:{questions:[{n:1,stem:'How would you respond to a service outage?'}],scenarios:[]}
  };
  assert.equal(questions.validate(search,bundle,{complete:true}),null);
  assert.match(questions.validate(search,{survey1:bundle.survey1},{complete:true}),/every question stage/);
  assert.match(questions.validate({...search,package:'basic'},bundle),/not included/);
  const repeated = structuredClone(bundle);
  repeated.survey2.questions[0].prompt = 'DESCRIBE your budget experience!';
  assert.match(questions.validate(search,repeated),/Repeated question/);
  assert(desk.review('questions',repeated,search,[]).some(f=>f.code==='questions'));
  // Exercise the actual prompt builder with a local provider substitute.
  // No API credentials or paid calls are used.
  let calls=0;
  const result=await ai.generate('questions',search,{call:async request=>{
    calls++;
    assert.match(request.messages[0].content,/survey1, survey2, guide/);
    assert.match(request.messages[0].content,/Do not repeat a question/);
    return {content:[{type:'text',text:JSON.stringify(bundle)}],usage:{input_tokens:1,output_tokens:1}};
  }});
  assert.deepEqual(result.json,bundle);
  assert(calls>0);
  console.log('Question plan: scope, duplicate checks, complete generation and prompt execution passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
