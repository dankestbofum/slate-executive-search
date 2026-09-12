// Local design-audit evidence. Run only against the isolated audit server on 4190.
const { chromium } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('fs');
const path = require('path');
const { installClerk } = require('./identity.cjs');
const out = path.join(__dirname, 'evidence');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
  // The landing page is one of the screenshots, so this starts at the door.
  await installClerk(context, { signedIn: false });
  const page = await context.newPage();
  const metrics = [];
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const snap = async (name, axe = false) => {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(out, name + '.png'), fullPage: true });
    const m = await page.evaluate(() => ({
      viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      mainTop: document.querySelector('main')?.getBoundingClientRect().top + scrollY,
      headingTop: document.querySelector('h1')?.getBoundingClientRect().top + scrollY,
      heading: document.querySelector('h1')?.textContent,
      primaryActions: [...document.querySelectorAll('.btn--primary')].map(x => x.textContent.trim()),
      smallControls: [...document.querySelectorAll('button,input,select,a')].filter(x => {
        const r=x.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24);
      }).map(x => ({text: (x.textContent || x.getAttribute('aria-label') || x.name).trim().slice(0,70), width:x.getBoundingClientRect().width, height:x.getBoundingClientRect().height})),
      overflows: [...document.querySelectorAll('body *')].filter(x => x.getBoundingClientRect().right > innerWidth + 1).slice(0,12).map(x => x.tagName+'.'+x.className)
    }));
    if (axe) {
      const result = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
      m.violations = result.violations.map(v=>({id:v.id, impact:v.impact, help:v.help, nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));
    }
    metrics.push({name,...m});
    fs.writeFileSync(path.join(out,'metrics.json'),JSON.stringify({metrics, errors},null,2));
    console.log(name, m.documentWidth, m.headingTop, m.violations?.map(v=>v.id).join(','));
  };
  const nav = async view => {
    await page.locator('[data-go="'+view+'"]').first().click();
    await page.waitForTimeout(150);
    await page.evaluate(()=>scrollTo(0,0));
  };
  await page.goto('http://127.0.0.1:4190');
  await page.waitForLoadState('networkidle');
  await snap('01-landing-desktop',true);
  await page.locator('[data-act="sign-in"]').first().click();
  // Signed in now, so the tool's own API calls carry the session too.
  await installClerk(context);
  await page.locator('[data-go="new"]').first().waitFor();
  await snap('02-home-empty',true);
  await nav('new');
  await snap('03-new-desktop',true);
  await page.locator('[name="client"]').fill('City of Ridgeline');
  await page.locator('[name="position"]').fill('City Manager');
  await page.locator('[name="state"]').fill('Arizona');
  await page.locator('[data-act="create"]').click();
  await page.locator('[data-go="facts"]').waitFor();
  await snap('04-created-search-team',true);
  for (const view of ['facts','team','intake','profile','community','survey1','guide','survey2','plan','brochure','ads','sourcing','screen','send2','video','finalists','schedule','references','contract','bar','history']) {
    await nav(view);
    await snap('desktop-'+view,['facts','team','profile','screen'].includes(view));
  }
  const searches = await (await context.request.get('http://127.0.0.1:4190/api/searches')).json();
  const id = searches[0].id;
  const api = 'http://127.0.0.1:4190/api/searches/'+id;
  const put = async (suffix,data,method='put') => {
    const s = await (await context.request.get(api)).json();
    const r = await context.request[method](api+suffix,{headers:{'if-match':String(s.revision)},data});
    if(!r.ok()) throw new Error(suffix+' '+r.status()+' '+await r.text());
    return r.json();
  };
  await put('/artifact/survey1',{body:{intro:'Tell us about your experience leading a local government organization.',questions:[{n:1,prompt:'Describe how you managed a difficult budget decision and its results.',required:true},{n:2,prompt:'How would you approach your first ninety days as City Manager?',required:true},{n:3,prompt:'What else should the committee know?',required:false}]}});
  let populated;
  for(const c of [{name:'Jordan Avery',cur:'Assistant City Manager',org:'City of Pine Valley',email:'jordan@example.gov'},{name:'Morgan Ellis',cur:'Deputy County Administrator',org:'Cedar County',email:'morgan@example.gov'},{name:'Taylor Bennett',cur:'City Manager',org:'Town of Westhaven',email:'taylor@example.gov'}]) populated=await put('/candidates',c,'post');
  await nav('overview');
  await page.locator('[data-act="reload-search"]').click();
  await nav('screen');
  await snap('desktop-screen-populated',true);
  await page.locator('[data-cand]').first().click();
  await snap('desktop-person',true);
  await nav('home'); await snap('desktop-home-stale');
  await nav('archives'); await snap('desktop-archives');
  await nav('packages'); await snap('desktop-packages');
  await page.setViewportSize({width:390,height:844});
  await nav('home'); await snap('mobile-home-stale',true);
  await nav('new'); await snap('mobile-new',true);
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
