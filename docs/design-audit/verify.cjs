// Read-only measurements of the existing synthetic fixture.
const {chromium}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const fs=require('fs');
const path=require('path');
const {installClerk}=require('./identity.cjs');
(async()=>{
 const browser=await chromium.launch();
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await installClerk(context,{email:'team@slate.local'});
 const page=await context.newPage();await page.goto('http://127.0.0.1:4190');await page.waitForLoadState('networkidle');
 await page.locator('[data-open]').first().click();await page.getByRole('heading',{name:'City Manager',exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});
 const measure=()=>page.evaluate(()=>({headingTop:document.querySelector('h1').getBoundingClientRect().top+scrollY,mainTop:document.querySelector('main').getBoundingClientRect().top+scrollY,viewport:innerWidth,tableWidth:document.querySelector('table')?.getBoundingClientRect().width,tableViewport:document.querySelector('.tablewrap')?.getBoundingClientRect().width}));
 const mobileOverview=await measure();
 await page.locator('[data-go="screen"]').first().click();const mobileScreen=await measure();
 await page.setViewportSize({width:768,height:1024});await page.locator('[data-go="overview"]').first().click();const tablet=await measure();
 await page.setViewportSize({width:1440,height:1000});await page.locator('[data-theme="dark"]').click();
 const darkRoot=await page.locator('html').getAttribute('aria-pressed');
 const scan=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
 const result={mobileOverview,mobileScreen,tablet,darkRoot,violations:scan.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))};
 fs.writeFileSync(path.join(__dirname,'evidence','verified-measurements.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
