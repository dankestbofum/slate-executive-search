// Follow-up evidence using the synthetic search created by capture.cjs.
const { chromium } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('fs');
const path = require('path');
const { installClerk } = require('./identity.cjs');
const out=path.join(__dirname,'evidence');
(async()=>{
 const browser=await chromium.launch();
 const context=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:'light'});
 await installClerk(context);
 const page=await context.newPage();
 const metrics=[];
 const snap=async(name,axe=true)=>{
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});
  const m=await page.evaluate(()=>({viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,heading:document.querySelector('h1')?.textContent,headingTop:document.querySelector('h1')?.getBoundingClientRect().top+scrollY,mainTop:document.querySelector('main')?.getBoundingClientRect().top+scrollY,clientFieldTop:document.querySelector('[name="client"]')?.getBoundingClientRect().top+scrollY,tableWidth:document.querySelector('table')?.getBoundingClientRect().width,tableViewport:document.querySelector('.tablewrap')?.getBoundingClientRect().width}));
  if(axe){const a=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();m.violations=a.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));}
  metrics.push({name,...m});fs.writeFileSync(path.join(out,'followup-metrics.json'),JSON.stringify(metrics,null,2));console.log(name,m.documentWidth,m.headingTop,m.violations?.map(v=>v.id).join(','));
 };
 const nav=async(v)=>{await page.locator('[data-go="'+v+'"]').first().click();await page.waitForTimeout(200);await page.evaluate(()=>scrollTo(0,0));};
 await page.goto('http://127.0.0.1:4190');await page.waitForLoadState('networkidle');
 await page.locator('[data-act="start"]').first().click();await page.locator('[data-open]').first().waitFor();
 const tail=process.argv.includes('--tail');
 if(!tail){
 await snap('desktop-home-refreshed');
 await page.locator('[data-open]').first().click();await page.getByRole('heading',{name:'City Manager',exact:true}).waitFor();
 await snap('desktop-overview');
 await page.setViewportSize({width:390,height:844});await snap('mobile-overview');
 for(const v of ['team','profile','screen']){await nav(v);await snap('mobile-'+v);}
 await page.setViewportSize({width:768,height:1024});await nav('overview');await snap('tablet-overview');
 await page.setViewportSize({width:1440,height:1000});await page.locator('[data-theme="dark"]').click();await snap('dark-overview');await page.locator('[data-theme="light"]').click();
 const searches=await(await context.request.get('http://127.0.0.1:4190/api/searches')).json();const api='http://127.0.0.1:4190/api/searches/'+searches[0].id;
 const put=async(suffix,data,method='put')=>{const s=await(await context.request.get(api)).json();const r=await context.request[method](api+suffix,{headers:{'if-match':String(s.revision)},data});if(!r.ok())throw Error(suffix+' '+await r.text());return r.json();};
 await put('/profile',{criteria:['skill','trait','chall','opp'].flatMap((kind,k)=>['Financial stewardship','Collaborative leadership','Community trust'].map((label,i)=>({id:['S','T','C','O'][k]+(i+1),kind,label:label+' '+kind,weight:i+3,note:'Evidence of results in a local government setting.'})))});
 await put('/members',{name:'Dana Reyes',email:'dana-audit@example.gov',title:'Council member',seat:'committee'},'post');
 await put('/team/confirm',{},'post');await put('/intake/status',{status:'open'},'post');
 await page.locator('[data-act="reload-search"]').click();await nav('profile');await snap('desktop-profile-populated');
 await page.setViewportSize({width:390,height:844});await snap('mobile-profile-populated');
 await page.setViewportSize({width:1440,height:1000});await nav('survey1');await snap('desktop-survey-populated');
 await nav('screen');await page.locator('[data-cand]').first().click();await snap('desktop-scorecard-populated');
 }
 await nav('home');await nav('new');await snap('desktop-new-measured',false);
 await nav('home');await nav('packages');
 for(const pkg of ['basic','enhanced','executive']){await page.locator('[role="tab"][data-pkg="'+pkg+'"]').click();await snap('package-'+pkg,false);}
 const list=await(await context.request.get('http://127.0.0.1:4190/api/searches')).json();
 const s=await(await context.request.get('http://127.0.0.1:4190/api/searches/'+list[0].id)).json();
 await page.goto('http://127.0.0.1:4190/apply/'+s.candidates[0].invite);await page.waitForLoadState('networkidle');await snap('candidate-desktop');
 await page.setViewportSize({width:390,height:844});await snap('candidate-mobile');
 await page.locator('textarea').nth(0).fill('I worked with the council and department directors to prioritize essential services.');
 await page.locator('textarea').nth(1).fill('Listen to staff, council, and residents, then agree on near-term priorities.');
 await page.getByRole('button',{name:'Submit questionnaire'}).click();await page.getByRole('heading',{name:'Received',exact:true}).waitFor();await snap('candidate-receipt');
 await page.reload();await page.waitForLoadState('networkidle');await snap('candidate-receipt-reload',false);
 await installClerk(context,{email:'dana-audit@example.gov'});
 await page.setViewportSize({width:1440,height:1000});await page.goto('http://127.0.0.1:4190');await page.waitForLoadState('networkidle');await snap('committee-home');
 await page.locator('[data-open]').first().click();await page.locator('[data-go="intake"]').first().waitFor();await nav('intake');await snap('committee-intake');
 await page.setViewportSize({width:390,height:844});await snap('committee-intake-mobile');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
