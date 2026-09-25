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
  TRUST_PROXY:'', ANTHROPIC_API_KEY:'', SLATE_BILLING_MODE:'off', ...fixture.server,
  SLATE_EMAIL_TEAM:'team@slate.local', SLATE_EMAIL_ABE:'abe@slate.local', SLATE_EMAIL_MIKE:'mike@slate.local',
  // The portal needs the three capabilities it refuses to pretend to have.
  // `echo` returns the verification message to the caller so a test can finish
  // a verification without a mailbox; server/mailer.js resolves it to "none"
  // under NODE_ENV=production, so it cannot be turned on by a deployment.
  // `accept-all` marks files openable without scanning and records that it did
  // not scan them, which is what lets the suite exercise a cleared download
  // while the honest default stays "unavailable".
  SLATE_MAIL_TRANSPORT:'echo',
  SLATE_APPLICATION_UPLOADS:'on',
  SLATE_FILE_SCANNER:'accept-all' };
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
    const billing = await suite('billing.js', suiteEnv);
    const projectBilling = await suite('project-billing.js', suiteEnv);
    const projectAccess = await suite('project-access.js', suiteEnv);
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
    const questionChecks = await suite('questions.js', suiteEnv);
    const allowanceChecks = await suite('ai-allowance.js', suiteEnv);
    const researchChecks = await suite('research.js', suiteEnv);
    const retrieval = await suite('retrieval.js', suiteEnv);
    const census = await suite('census.js', suiteEnv);
    const coreResearch = await suite('research-core.js', suiteEnv);
    // The interface around research, run against the real public/app.js in an
    // isolated context. Needs no server, so it stays beside the suite that
    // covers the server half of the same operation.
    const researchUi = await suite('research-ui.js', suiteEnv);
    const regression = await suite('integrity.js', suiteEnv);
    // The committee aggregate findings, as corrected behaviour
    // (docs/audits/2026-09-17-committee-aggregate).
    const committeeChecks = await suite('committee.js', suiteEnv);
    // The user guide, and the public posting and application portal
    // (docs/audits/2026-09-19-user-guidance-candidate-portal).
    const helpChecks = await suite('help.js', suiteEnv);
    const portalChecks = await suite('portal.js', suiteEnv);
    process.exitCode = organizationsSuite || auth || billing || projectBilling || projectAccess || clerkAuth || baseline || counties || regression || security || roles || authority || storage || recover || monitoring || exports_ || cands || dispo || aichecks || questionChecks || allowanceChecks || researchChecks || retrieval || census || coreResearch || researchUi || committeeChecks || helpChecks || portalChecks;
    console.log('Isolated test data: ' + directory);
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { server.kill(); }
})();
