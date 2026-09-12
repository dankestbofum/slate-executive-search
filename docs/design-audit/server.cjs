'use strict';

/**
 * The audit server, in its own terminal.
 *
 *   node docs/design-audit/server.cjs
 *
 * A throwaway store, no AI credentials, and the fixture identity that
 * capture.cjs, followup.cjs and verify.cjs sign in with. Set DATA_DIR to
 * reuse an earlier audit store instead of starting on an empty one.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { serverEnv } = require('./identity.cjs');

const dataDir = process.env.DATA_DIR
  || fs.mkdtempSync(path.join(os.tmpdir(), 'slate-design-audit-'));
console.log('Audit store: ' + dataDir);

spawn(process.execPath, [path.join(__dirname, '..', '..', 'server', 'index.js')], {
  env: {
    ...process.env,
    NODE_ENV: 'test', PORT: '4190', HOST: '127.0.0.1', DATA_DIR: dataDir,
    ANTHROPIC_API_KEY: '', SLATE_SUPPORT_EMAIL: 'recruitment@example.gov',
    ...serverEnv
  },
  stdio: 'inherit', windowsHide: true
});
