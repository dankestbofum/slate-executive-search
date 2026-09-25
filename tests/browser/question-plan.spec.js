'use strict';
const { test, expect } = require('@playwright/test');
const { installClerk } = require('./clerk');

async function setup(page, workflow='executive') {
  await installClerk(page);
  const response = await page.request.post('/api/searches', { data:{client:'Question Plan City',position:'City Manager',package:workflow} });
  expect(response.ok()).toBeTruthy();
  return response.json();
}
async function write(page, id, suffix, data, method='put') {
  const search = await (await page.request.get('/api/searches/'+id)).json();
  return page.request[method]('/api/searches/'+id+suffix,{headers:{'if-match':String(search.revision)},data});
}
const survey = prompt => ({questions:[{n:1,prompt,required:true}]});

test('one question page preserves edits across stages and rejects duplicates atomically', async ({page}) => {
  const search = await setup(page);
  await page.goto('/#/s/'+search.id+'/guide');
  await expect(page.locator('#main h1')).toHaveText('Candidate questions');
  for (const key of ['survey1','survey2']) {
    await page.locator('#question-stage-'+key).getByRole('button',{name:'Add a question',exact:true}).first().click();
    await page.locator('#edit-'+key+' [data-path="questions.0.prompt"]').fill(key==='survey1'?'Describe your budget experience.':'Describe how you resolved a council disagreement.');
  }
  await page.locator('#question-stage-guide').getByRole('button',{name:'Add a question',exact:true}).first().click();
  await page.locator('#edit-guide [data-path="questions.0.stem"]').fill('How would you respond to a service outage?');
  await expect(page.locator('#edit-survey1 [data-path="questions.0.prompt"]')).toHaveValue('Describe your budget experience.');
  await expect(page.locator('#edit-survey2 [data-path="questions.0.prompt"]')).toHaveValue('Describe how you resolved a council disagreement.');
  await page.locator('#question-stage-guide').getByRole('button',{name:'Preview',exact:true}).click();
  await expect(page.locator('#edit-survey1 [data-path="questions.0.prompt"]')).toHaveValue('Describe your budget experience.');
  await page.getByRole('button',{name:'Save all questions',exact:true}).click();
  await expect(page.locator('#toast')).toContainText('Question plan saved');
  const saved = await (await page.request.get('/api/searches/'+search.id)).json();
  expect(saved.artifacts.guide.questions[0].stem).toContain('service outage');
  await page.locator('#edit-survey2 [data-path="questions.0.prompt"]').fill('DESCRIBE your budget experience!');
  await page.locator('#edit-survey1 [data-path="intro"]').fill('An edit that must not be saved on failure.');
  await page.getByRole('button',{name:'Save all questions',exact:true}).click();
  await expect(page.locator('#toast')).toContainText('Repeated question');
  const rejected = await (await page.request.get('/api/searches/'+search.id)).json();
  expect(rejected.revision).toBe(saved.revision);
  expect(rejected.artifacts.survey1.intro).not.toContain('must not be saved');
  await expect(page.locator('#edit-survey1 [data-path="intro"]')).toHaveValue('An edit that must not be saved on failure.');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('basic workflow only includes initial questions and rejects later-stage writes', async ({page}) => {
  const search=await setup(page,'basic');
  await page.goto('/#/s/'+search.id+'/survey1');
  await expect(page.locator('#question-stage-survey1')).toBeVisible();
  await expect(page.locator('#question-stage-survey2')).toHaveCount(0);
  const res=await write(page,search.id,'/questions',{body:{survey1:survey('Why this role?'),survey2:survey('Tell us more.')}});
  expect(res.status()).toBe(400);
  const after=await (await page.request.get('/api/searches/'+search.id)).json();
  expect(after.artifacts.survey1).toBeFalsy();
});

test('brochure prints from the first page without workspace controls or clipped content', async ({page}, info) => {
  const search=await setup(page);
  const brochure={title:'City Manager: Question Plan City',lede:'Help a growing community shape its next chapter.',theOpportunity:'Lead an experienced team and work with the council on community priorities.',thePlace:Array(9).fill('Our community brings together local businesses, parks and neighborhoods. Residents value dependable public services and thoughtful planning.').join('\n\n'),theOrganization:'The manager leads the organization and works with the elected council.',compensation:'The salary range is confirmed before posting.',howToApply:'Submit your application through the published recruitment link.'};
  expect((await write(page,search.id,'/artifact/brochure',{body:brochure})).ok()).toBeTruthy();
  await page.goto('/#/s/'+search.id+'/brochure');
  await expect(page.locator('#pack-brochure')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.emulateMedia({media:'print'});
  await expect(page.locator('.secnav')).toBeHidden();
  await expect(page.locator('#edit-brochure')).toBeHidden();
  expect(await page.locator('#pack-brochure').evaluate(el=>getComputedStyle(el).breakInside)).toBe('auto');
  const top=await page.locator('#pack-brochure').evaluate(el=>el.getBoundingClientRect().top);
  expect(top).toBeLessThan(15);
  if(info.project.name==='desktop-chrome') {
    const path=info.outputPath('brochure.pdf');
    await page.pdf({path,format:'Letter',printBackground:true,margin:{top:'0.5in',bottom:'0.5in',left:'0.5in',right:'0.5in'}});
    const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf=await pdfjs.getDocument({data:new Uint8Array(require('fs').readFileSync(path))}).promise;
    const first=(await (await pdf.getPage(1)).getTextContent()).items.map(t=>t.str).join(' ');
    expect(first).toContain('City Manager');
    expect(first).not.toContain('Committee questionnaire');
    const all=[];
    for(let i=1;i<=pdf.numPages;i++) all.push((await (await pdf.getPage(i)).getTextContent()).items.map(t=>t.str).join(' '));
    expect(all.join(' ')).toContain('Submit your application');
    expect(all.every(t=>t.trim().length>60)).toBe(true);
    await page.screenshot({path:info.outputPath('brochure-print.png'),fullPage:true});
  }
});

test('candidate questionnaires appear only when released and keep issued wording', async ({page}) => {
  const search=await setup(page);
  const plan={survey1:survey('Describe your budget experience.'),survey2:survey('Describe your approach to council disagreements.'),guide:{questions:[{n:1,stem:'How would you handle a service outage?',approach:'PANEL ONLY'}],scenarios:[]}};
  expect((await write(page,search.id,'/questions',{body:plan})).ok()).toBeTruthy();
  const added=await write(page,search.id,'/candidates',{name:'Stage Candidate'},'post');
  const candidate=(await added.json()).candidates[0];
  const portal='/api/apply/'+candidate.invite;
  const initial=await (await page.request.get(portal)).json();
  expect(initial.survey1.questions[0].prompt).toBe(plan.survey1.questions[0].prompt);
  expect(initial.survey2).toBeNull();
  expect(JSON.stringify(initial)).not.toContain('PANEL ONLY');
  const refused=await write(page,search.id,'/candidates/'+candidate.id+'/send2',{},'post');
  expect(refused.status()).toBe(400);
  expect((await write(page,search.id,'/candidates/'+candidate.id,{stage:'semifinalist'},'patch')).ok()).toBeTruthy();
  const stillWaiting=await (await page.request.get(portal)).json();
  expect(stillWaiting.survey2).toBeNull();
  expect((await write(page,search.id,'/candidates/'+candidate.id+'/send2',{},'post')).ok()).toBeTruthy();
  const issued=await (await page.request.get(portal)).json();
  expect(issued.survey2.questions[0].prompt).toBe(plan.survey2.questions[0].prompt);
  plan.survey1=survey('Updated initial question for future invitations.');
  plan.survey2=survey('Updated semifinalist question for future invitations.');
  expect((await write(page,search.id,'/questions',{body:plan})).ok()).toBeTruthy();
  const preserved=await (await page.request.get(portal)).json();
  expect(preserved.survey1.questions[0].prompt).toBe(initial.survey1.questions[0].prompt);
  expect(preserved.survey2.questions[0].prompt).toBe(issued.survey2.questions[0].prompt);
  expect(JSON.stringify(preserved)).not.toContain('PANEL ONLY');
});
