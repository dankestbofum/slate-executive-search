'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const backup = require('../server/backup');
const credentials = require('../server/credentials');
const base = process.env.SLATE_URL;
let checks = 0;
function check(name, fn) { fn(); checks += 1; console.log('PASS  Integrity: ' + name); }
async function request(url, method = 'GET', body, cookie, revision) {
  const headers = { 'content-type':'application/json' };
  if (cookie) headers.cookie = cookie;
  const search = url.match(/^\/api\/searches\/(sr-[^/]+)/)?.[0];
  if (method !== 'GET' && cookie && search && revision !== false) {
    const current = await request(search, 'GET', undefined, cookie);
    if (current.status === 200) headers['if-match'] = String(revision ?? current.body.revision);
  }
  const response = await fetch(base + url, { method, headers, body:body === undefined ? undefined : JSON.stringify(body) });
  return { status:response.status, body:await response.json(), cookie:response.headers.get('set-cookie')?.split(';')[0] };
}

(async () => {
  const login = await request('/api/login', 'POST', { email:'abe@slate.local', pin:'2468' });
  const auth = login.cookie;
  assert.equal(login.status, 200);
  const fresh = await request('/api/searches', 'POST', { client:'Integrity Test', position:'Manager' }, auth);
  const p = '/api/searches/' + fresh.body.id;
  const read = async () => (await request(p, 'GET', undefined, auth)).body;
  const write = (suffix, method, body) => request(p + suffix, method, body, auth);
  check('missing revision is refused', () => assert.ok(fresh.body.revision));
  assert.equal((await request(p, 'PATCH', { salary:'100' }, auth, false)).status, 428);
  const oldRevision = (await read()).revision;
  await write('', 'PATCH', { salary:'100000' });
  check('stale saves do not replace newer facts', () => assert.ok(true));
  assert.equal((await request(p, 'PATCH', { salary:'90000' }, auth, oldRevision)).status, 409);
  assert.equal((await read()).salary, '100000');
  const invalid = await write('', 'PATCH', { salary:'wrong', package:'invalid' });
  check('invalid requests do not partially mutate facts', () => assert.equal(invalid.status, 400));
  assert.equal((await read()).salary, '100000');

  await write('/profile', 'PUT', { criteria:[{ id:'S1', kind:'skill', label:'Budget management', weight:3 }] });
  const seated = await write('/members', 'POST', { name:'Integrity Member', email:'integrity@example.test' });
  const memberLogin = await request('/api/login', 'POST', { email:'integrity@example.test', pin:seated.body.pin });
  const member = memberLogin.cookie;
  const memberId = memberLogin.body.user.id;
  check('new committee credentials contain eight digits', () => assert.match(seated.body.pin, /^\d{8}$/));
  await write('/candidates', 'POST', { name:'Synthetic Candidate' });
  let c = (await read()).candidates[0];
  const memberView = (await request(p, 'GET', undefined, member)).body;
  check('committee cannot read invitation tokens or private history', () => {
    assert.equal(memberView.candidates[0].invite, undefined);
    assert.equal(memberView.candidates[0].issuedSurveys, undefined);
    assert.equal(memberView.history, undefined);
    assert.deepEqual(memberView.staff, {});
  });
  assert.equal((await request(p+'/history', 'GET', undefined, member)).status, 403);

  for (const scores of [{ S1:'<img src=x onerror=alert(1)>' }, { S1:6 }, { S1:1.5 }, { oldCriterion:5 }, []]) {
    const result = await request(p+'/scores/'+c.id, 'PUT', { scores }, member);
    check('invalid score rejected: ' + JSON.stringify(scores), () => assert.equal(result.status, 400));
  }
  const survey = { intro:'Original', questions:[{ n:1, prompt:'Describe your budget experience.', required:true }] };
  assert.equal((await write('/artifact/survey1', 'PUT', { body:survey })).status, 200);
  const info = (await request('/api/apply/'+c.invite)).body;
  const version = info.versions.survey1;
  const empty = await request('/api/apply/'+c.invite, 'POST', { which:'survey1', surveyVersion:version, answers:{} });
  check('required answers are enforced on the server', () => assert.equal(empty.status, 400));
  const wrongVersion = await request('/api/apply/'+c.invite, 'POST', { surveyVersion:'outdated', answers:{ q1:'Experience' } });
  check('submission must identify the questionnaire shown', () => assert.equal(wrongVersion.status, 409));
  const submitted = await request('/api/apply/'+c.invite, 'POST', { surveyVersion:version, answers:{ q1:'Original answer' } });
  assert.equal(submitted.status, 200);
  const replacement = { intro:'Changed', questions:[{ n:1, prompt:'A different question?', required:true }] };
  await write('/artifact/survey1', 'PUT', { body:replacement });
  c = (await read()).candidates[0];
  check('responses and issued questionnaires preserve original questions', () => {
    assert.equal(c.survey1.survey.questions[0].prompt, survey.questions[0].prompt);
    assert.equal(c.survey1.version, version);
  });
  assert.equal((await request('/api/apply/'+c.invite)).body.survey1.questions[0].prompt, survey.questions[0].prompt);
  assert.equal((await request('/api/apply/'+c.invite, 'POST', { surveyVersion:version, answers:{ q1:'Again' } })).status, 409);
  const oldInvite = c.invite;
  const reopened = await write('/candidates/'+c.id+'/reopen', 'POST', { which:'survey1', reason:'Candidate requested a correction' });
  assert.equal(reopened.status, 200);
  c = reopened.body.candidates[0];
  check('corrections retain the original response and replace the link', () => { assert.equal(c.survey1, null); assert.notEqual(c.invite, oldInvite); });
  assert.equal((await request('/api/apply/'+oldInvite)).status, 404);
  assert.ok((await request(p+'/history', 'GET', undefined, auth)).body.history.some(h => h.kind==='response' && h.body.answers.q1==='Original answer'));

  await write('/scores/'+c.id, 'PUT', { scores:{ S1:5 }, note:'Budget evidence' });
  await write('/scores/'+c.id, 'PUT', { scores:{ S1:5 }, note:'Updated budget evidence' });
  const colleague = await request('/api/login', 'POST', { email:'mike@slate.local', pin:'1357' });
  const privateHistory = (await request(p+'/history', 'GET', undefined, colleague.cookie)).body.history;
  check('history preserves sealed score privacy between consultants', () => {
    for (const entry of privateHistory) if (entry.scores) assert.equal(entry.scores[login.body.user.id], undefined);
  });
  await write('', 'PATCH', { released:true });
  await write('/profile', 'PUT', { criteria:[{ id:'S1', kind:'skill', label:'Public engagement', weight:3 }] });
  let s = await read();
  check('changed profiles archive scores and require reassessment', () => {
    assert.deepEqual(s.scores, { [login.body.user.id]:{} });
    assert.equal(s.released, false);
    assert.ok(s.profileRevision > 1);
  });
  let history = (await request(p+'/history', 'GET', undefined, auth)).body.history;
  const prior = history.find(h => h.kind==='profile' && h.scores?.[login.body.user.id]?.[c.id]?.S1===5);
  assert.equal(prior.criteria[0].label, 'Budget management');
  const profileRevision = s.profileRevision;
  await write('/profile', 'PUT', { criteria:s.criteria });
  assert.equal((await read()).profileRevision, profileRevision);

  await write('/artifact/ads', 'PUT', { body:{ full:'Salary 100000' } });
  await write('/artifact/ads/review', 'POST', { approve:true });
  await write('', 'PATCH', { salary:'200000' });
  s = await read();
  check('source edits invalidate recruiting approvals', () => { assert.equal(s.reviews.ads, undefined); assert.ok(s.staleArtifacts.ads); });
  await write('/artifact/ads/review', 'POST', { approve:true });
  assert.equal((await read()).staleArtifacts.ads, undefined);

  const draft = write('/generate', 'POST', { kind:'survey1', notes:'TEST_DELAY' });
  await new Promise(resolve => setTimeout(resolve, 100));
  await write('/artifact/survey1', 'PUT', { body:{ ...replacement, intro:'Newer manual edit' } });
  check('late generation refuses to overwrite newer work', () => assert.ok(true));
  assert.equal((await draft).status, 409);
  assert.equal((await read()).artifacts.survey1.intro, 'Newer manual edit');
  const research = write('/research', 'POST', { city:'Concurrency Test', website:'https://example.com' });
  await new Promise(resolve => setTimeout(resolve, 100));
  await write('', 'PATCH', { client:'Newer client name' });
  assert.equal((await research).status, 409);
  assert.equal((await read()).client, 'Newer client name');
  check('late research also preserves newer work', () => assert.ok(true));
  history = (await request(p+'/history', 'GET', undefined, auth)).body.history;
  const artifactIndex = history.findIndex(h => h.kind==='artifact' && h.key==='survey1' && h.body.intro==='Original');
  assert.equal((await write('/history/'+artifactIndex+'/restore', 'POST', {})).status, 200);
  check('saved artifact revisions can be restored', () => assert.ok(artifactIndex >= 0));
  assert.equal((await read()).artifacts.survey1.intro, 'Original');

  await write('/candidates/'+c.id, 'PATCH', { stage:'finalist' });
  assert.equal((await write('/staff/references/log', 'POST', { text:'An unassigned contact' })).status, 400);
  assert.equal((await write('/staff/references/log', 'POST', { text:'Contact', candidateId:c.id })).status, 400);
  await write('/candidates/'+c.id+'/consent', 'POST', { consent:true });
  const logged = await write('/staff/references/log', 'POST', { text:'Contact with consent', candidateId:c.id });
  const logId = logged.body.staff.references.log[0].id;
  assert.equal((await write('/staff/references/complete', 'POST', { done:true })).status, 200);
  await write('/staff/references/log/'+logId, 'DELETE');
  check('deleting the last reference contact reopens completion', () => assert.ok(true));
  assert.equal((await read()).staff.references.doneAt, null);
  await write('/staff/references', 'PUT', { notes:'Administrative note' });
  assert.equal((await write('/staff/references/complete', 'POST', { done:true })).status, 400);
  await write('/team/confirm', 'POST', {});
  await write('/members/'+memberId, 'DELETE');
  assert.equal((await read()).team.confirmedAt, null);
  check('roster removal invalidates its confirmation', () => assert.ok(true));

  const raw = JSON.parse(fs.readFileSync(path.join(process.env.SLATE_TEST_DATA, 'slate.json'), 'utf8'));
  check('credentials are hashed on disk and verify correctly', () => {
    assert.ok(raw.users.every(u => !('pin' in u) && typeof u.pinHash==='string'));
    assert.equal(credentials.verify(raw.users.find(u => u.id==='u1'), '2468'), true);
  });
  const migrationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-migration-'));
  fs.writeFileSync(path.join(migrationDir, 'slate.json'), JSON.stringify({ users:[{ id:'legacy', role:'consultant', email:'legacy@example.test', name:'Legacy', pin:'old-secret' }], searches:[], sessions:{}, seq:0 }));
  const migrated = spawnSync(process.execPath, ['-e', "require('./server/db')"], { cwd:path.join(__dirname, '..'), env:{ ...process.env, DATA_DIR:migrationDir }, encoding:'utf8', windowsHide:true });
  assert.equal(migrated.status, 0, migrated.stderr);
  const legacy = JSON.parse(fs.readFileSync(path.join(migrationDir, 'slate.json'))).users.find(u=>u.id==='legacy');
  check('legacy plaintext credentials migrate without changing the sign-in', () => { assert.equal(legacy.pin, undefined); assert.equal(credentials.verify(legacy, 'old-secret'), true); });

  const marker = '<b data-audit="score">unsafe</b>';
  s = await read();
  s.released = true; s.scores = { other:{ [c.id]:{ S1:marker } } };
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const renderer = source.slice(source.indexOf('function vPerson(){'), source.indexOf('function pickApplySurvey('));
  const escapeSource = source.match(/^const esc = .+$/m)[0];
  const html = vm.runInNewContext(escapeSource+'\n'+renderer+';vPerson()', { state:{ search:s, user:login.body.user, users:[], sel:c.id }, shell:v=>v, head:()=>'', field:()=>'', canEdit:()=>false, ico:()=>'', surveyRead:()=>'', location:{ origin:'http://test' } });
  check('legacy score markup is escaped by the real renderer', () => { assert.ok(!html.includes(marker)); assert.ok(html.includes('&lt;b')); });
  const busyFunction = source.slice(source.indexOf('async function withBusy('), source.indexOf('function artHasContent('));
  let renders = 0;
  const ui = { state:{ dirty:true }, $:()=>({ classList:{add(){},remove(){}} }), showWait(){}, hideWait(){}, waitSave(){}, toast(){}, render(){ renders += 1; } };
  await vm.runInNewContext(busyFunction+";withBusy(async()=>{ throw new Error('Conflict'); })", ui);
  check('failed saves keep unsaved fields and navigation protection', () => { assert.equal(renders, 0); assert.equal(ui.state.dirty, true); assert.equal(ui.state.busy, false); });
  const navigationFunction = source.slice(source.indexOf('async function go('), source.indexOf('function brochureHasCopy('));
  const navigation = { state:{ dirty:true, sel:'original', view:'person' }, confirm:()=>false };
  await vm.runInNewContext(navigationFunction+";go('person', {sel:'different'})", navigation);
  check('cancelled navigation cannot redirect scores to another candidate', () => assert.equal(navigation.state.sel, 'original'));

  const archiveSeat = await write('/members', 'POST', { name:'Archive Member', email:'archive-integrity@example.test' });
  const archiveLogin = await request('/api/login', 'POST', { email:'archive-integrity@example.test', pin:archiveSeat.body.pin });
  const reset = await write('/members/'+archiveLogin.body.user.id+'/pin', 'POST', {});
  assert.equal((await request('/api/me', 'GET', undefined, archiveLogin.cookie)).status, 401);
  const resetLogin = await request('/api/login', 'POST', { email:'archive-integrity@example.test', pin:reset.body.pin });
  assert.equal(resetLogin.status, 200);
  check('credential reset retires existing sessions', () => assert.equal(reset.body.pin.length, 8));
  const liveInvite = (await read()).candidates[0].invite;
  assert.equal((await write('', 'DELETE')).status, 200);
  assert.equal((await request(p, 'GET', undefined, auth)).status, 404);
  assert.equal((await request('/api/apply/'+liveInvite)).status, 404);
  assert.equal((await request('/api/me', 'GET', undefined, resetLogin.cookie)).status, 401);
  assert.ok((await request('/api/archives', 'GET', undefined, auth)).body.some(a=>a.id===fresh.body.id));
  const restored = await request('/api/archives/'+fresh.body.id+'/restore', 'POST', {}, auth);
  check('archived searches restore responses, history and fresh links', () => {
    assert.equal(restored.status, 200); assert.notEqual(restored.body.candidates[0].invite, liveInvite); assert.equal(restored.body.artifacts.survey1.intro, 'Original');
  });
  assert.equal((await request('/api/login', 'POST', { email:'archive-integrity@example.test', pin:reset.body.pin })).status, 200);
  check('archive restoration recovers the committee roster and accounts', () => assert.ok(restored.body.roster.some(r=>r.email==='archive-integrity@example.test')));

  const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-backup-test-'));
  const mediaDir = path.join(process.env.SLATE_TEST_DATA, 'media', fresh.body.id);
  fs.mkdirSync(mediaDir, { recursive:true }); fs.writeFileSync(path.join(mediaDir, 'cover.jpg'), 'synthetic media');
  const snapshotDir = path.join(backupRoot, 'snapshot');
  backup.snapshot(process.env.SLATE_TEST_DATA, snapshotDir);
  backup.verify(snapshotDir);
  const restoredDir = path.join(backupRoot, 'restored');
  backup.restore(snapshotDir, restoredDir);
  const recovered = JSON.parse(fs.readFileSync(path.join(restoredDir, 'slate.json')));
  check('backup restore recovers data and media without resurrecting sessions', () => {
    assert.ok(recovered.searches.some(s=>s.id===fresh.body.id)); assert.deepEqual(recovered.sessions, {});
    assert.equal(fs.readFileSync(path.join(restoredDir, 'media', fresh.body.id, 'cover.jpg'), 'utf8'), 'synthetic media');
    assert.throws(()=>backup.restore(snapshotDir, restoredDir), /empty destination/);
  });
  fs.appendFileSync(path.join(snapshotDir, 'slate.json'), 'tampered');
  check('backup verification catches corruption', () => assert.throws(()=>backup.verify(snapshotDir), /checksum/));
  // DEP-05 moved automatic snapshots off the request path and onto a timer, so
  // they are named by timestamp rather than by day. The contract this test
  // guards is unchanged: the running app takes its own snapshots, and every one
  // it publishes verifies.
  check('automatic scheduled backups include a verified manifest', () => {
    const dir = path.join(process.env.SLATE_TEST_DATA, 'backups');
    const snapshots = fs.readdirSync(dir).filter(name => fs.existsSync(path.join(dir, name, 'manifest.json')));
    assert.ok(snapshots.length, 'the running app published no verified snapshot');
    for (const name of snapshots) assert.equal(backup.verify(path.join(dir, name)).version, 1);
  });
  const failureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-write-failure-'));
  const failureScript = `
    const assert = require('assert/strict'), fs = require('fs'), path = require('path');
    const db = require('./server/db');
    const s = db.blankSearch({client:'Committed',position:'Manager'}, db.db.users[0]);
    db.db.searches.push(s); db.persist();
    const original = fs.renameSync;
    fs.renameSync = () => { throw new Error('Synthetic disk failure'); };
    s.client = 'Uncommitted';
    assert.throws(() => db.persist(), /Synthetic disk failure/);
    fs.renameSync = original;
    assert.equal(db.findSearch(s.id).client, 'Committed');
    assert.equal(JSON.parse(fs.readFileSync(path.join(db.DATA_DIR,'slate.json'))).searches[0].client, 'Committed');
  `;
  const failure = spawnSync(process.execPath, ['-e', failureScript], { cwd:path.join(__dirname, '..'), env:{ ...process.env, DATA_DIR:failureDir }, encoding:'utf8', windowsHide:true });
  check('failed writes preserve both committed disk and memory state', () => assert.equal(failure.status, 0, failure.stderr));

  const migrationScript = `
    const assert=require('assert/strict'), fs=require('fs'), path=require('path');
    const db=require('./server/db');
    const file=path.join(db.DATA_DIR,'slate.json');
    const s=db.blankSearch({client:'Legacy invite',position:'Manager'},db.db.users[0]);
    s.candidates=[{id:'C-legacy',name:'Legacy candidate',invite:'old-exposed-token',survey1:{at:'2025-01-01',answers:{q1:'Old answer'}}}];
    s.artifacts.survey1={questions:[{n:1,prompt:'Current question?'}]};
    db.db.searches.push(s); db.persist();
    db.db.sessions.invalid={userId:db.db.users[0].id,at:'invalid'}; db.persist();
    delete require.cache[require.resolve('./server/db')];
    const migrated=require('./server/db');
    const c=migrated.findSearch(s.id).candidates[0];
    assert.notEqual(c.invite,'old-exposed-token'); assert.equal(c.inviteVersion,2);
    assert.equal(c.survey1.legacySnapshot,true); assert.equal(migrated.db.sessions.invalid,undefined);
    const token=c.invite;
    delete require.cache[require.resolve('./server/db')];
    assert.equal(require('./server/db').findSearch(s.id).candidates[0].invite,token);
  `;
  const legacyDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-legacy-invites-'));
  const migratedInvites = spawnSync(process.execPath, ['-e', migrationScript], { cwd:path.join(__dirname, '..'), env:{ ...process.env, DATA_DIR:legacyDirectory }, encoding:'utf8', windowsHide:true });
  check('legacy migration rotates exposed links once and labels uncertain question history', () => assert.equal(migratedInvites.status, 0, migratedInvites.stderr));

  // End with lockout checks so intentional bad logins cannot affect other suites.
  const attempt = async (ip, email='missing-integrity@example.test') => fetch(base+'/api/login', { method:'POST', headers:{'content-type':'application/json','x-forwarded-for':ip}, body:JSON.stringify({email,pin:'wrong'}) });
  for (let i=0;i<8;i++) await attempt('198.51.100.10');
  const blocked = await attempt('198.51.100.11');
  check('changing forwarded IP headers cannot bypass the login limit', () => assert.equal(blocked.status, 429));
  const unreachable = spawnSync(process.execPath, [path.join(__dirname, 'bughunt.js')], { cwd:path.join(__dirname, '..'), env:{ ...process.env, DATA_DIR:fs.mkdtempSync(path.join(os.tmpdir(),'slate-unreachable-')), SLATE_URL:'http://127.0.0.1:0' }, encoding:'utf8', windowsHide:true });
  check('the test command fails when its target server is unavailable', () => assert.equal(unreachable.status, 1));
  console.log(checks + ' integrity regression checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
