'use strict';
// Only the isolated test runner uses this entry point. Production imports no mocks.
const ai = require('../server/ai');
const generate = ai.generate;
ai.generate = async (kind, search, options) => {
  if (options.notes !== 'TEST_DELAY') return generate(kind, search, options);
  await new Promise(resolve => setTimeout(resolve, 400));
  return { json:{ intro:'Delayed test draft', questions:[{ n:1, prompt:'Test question?', required:true }] }, model:'test', usage:{}, desk:{ open:[] } };
};
const researchCity = ai.researchCity;
ai.researchCity = async options => {
  if (options.city !== 'Concurrency Test') return researchCity(options);
  await new Promise(resolve => setTimeout(resolve, 400));
  return { json:{ facts:{ client:'Older research result' }, community:{} }, sources:[], model:'test', usage:{} };
};
require('../server/index');
