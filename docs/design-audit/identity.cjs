'use strict';

/**
 * One identity for the audit tools.
 *
 * Slate has a single way in, a Clerk session, and these tools have to hold one
 * like anybody else. They use the same fixture the test suite does: a throwaway
 * key pair the audit server verifies for real, with Clerk's own script stubbed
 * in the browser. Some tools start their own server and some attach to one
 * another terminal started, so the key pair is written once and read back
 * rather than regenerated per process.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const identity = require('../../tests/identity');
const { installClerk, authHeaders } = require('../../tests/browser/clerk');

const keyFile = path.join(os.tmpdir(), 'slate-audit-clerk-v1.json');
if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, JSON.stringify(identity.serverEnv()));
const fixture = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
process.env.SLATE_TEST_CLERK_KEY = fixture.privateKey;

module.exports = { serverEnv: fixture.server, installClerk, authHeaders };
