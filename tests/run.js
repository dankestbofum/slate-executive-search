'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork, spawn } = require('child_process');
const identity = require('./identity');
const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-tests-'));
// The suite signs its own Clerk sessions. The server verifies them for real
// against this key pair, so the tests exercise the only sign-in Slate has.
const fixture = identity.serverEnv();
const env = { ...process.env, NODE_ENV:'test', PORT:'0', HOST:'127.0.0.1', DATA_DIR:path.join(directory, 'server'),
  TRUST_PROXY:'', ANTHROPIC_API_KEY:'', ...fixture.server,
  SLATE_EMAIL_TEAM:'team@slate.local', SLATE_EMAIL_ABE:'abe@slate.local', SLATE_EMAIL_MIKE:'mike@slate.local' };
const server = fork(path.join(__dirname, 'server.js'), [], { cwd:root, env, stdio:['ignore', 'ignore', 'inherit', 'ipc'], windowsHide:true });
async function suite(file, suiteEnv) {
  const child = spawn(process.execPath, [path.join(__dirname, file)], { cwd:root, env:suiteEnv, stdio:'inherit', windowsHide:true });
  return new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
}
(async () => {
  try {
    const ready = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Test server did not start.')), 15000);
      server.once('message', message => { clearTimeout(timeout); resolve(message); });
      server.once('exit', () => { clearTimeout(timeout); reject(new Error('Test server exited before startup.')); });
      server.once('error', error => { clearTimeout(timeout); reject(error); });
    });
    const base = 'http://127.0.0.1:' + ready.port;
    // One firm workspace, stood up through the same routes the product uses, so
    // the suites that are about the work rather than about the boundary between
    // firms have somewhere to do it. tests/organizations.js builds its own
    // second workspace to test the boundary itself.
    process.env.SLATE_TEST_CLERK_KEY = fixture.privateKey;
    const orgId = await identity.bootstrapWorkspace(base, {
      owner: 'abe@slate.local', staff: ['mike@slate.local', 'team@slate.local']
    });
    const suiteEnv = { ...env, SLATE_URL:base, SLATE_TEST_DATA:env.DATA_DIR,
      DATA_DIR:path.join(directory, 'units'), SLATE_TEST_CLERK_KEY:fixture.privateKey,
      SLATE_TEST_ORG_ID:orgId };
    const organizationsSuite = await suite('organizations.js', suiteEnv);
    const auth = await suite('auth.js', suiteEnv);
    const clerkAuth = await suite('clerk-auth.js', suiteEnv);
    const baseline = await suite('bughunt.js', suiteEnv);
    const counties = await suite('jurisdictions.js', suiteEnv);
    const security = await suite('security.js', suiteEnv);
    const roles = await suite('roles.js', suiteEnv);
    const authority = await suite('authority.js', suiteEnv);
    const storage = await suite('storage.js', suiteEnv);
    const recover = await suite('recovery.js', suiteEnv);
    const monitoring = await suite('monitoring.js', suiteEnv);
    const exports_ = await suite('export.js', suiteEnv);
    const cands = await suite('candidates.js', suiteEnv);
    const dispo = await suite('disposition.js', suiteEnv);
    const aichecks = await suite('aireliability.js', suiteEnv);
    const researchChecks = await suite('research.js', suiteEnv);
    const regression = await suite('integrity.js', suiteEnv);
    process.exitCode = organizationsSuite || auth || clerkAuth || baseline || counties || regression || security || roles || authority || storage || recover || monitoring || exports_ || cands || dispo || aichecks || researchChecks;
    console.log('Isolated test data: ' + directory);
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { server.kill(); }
})();
