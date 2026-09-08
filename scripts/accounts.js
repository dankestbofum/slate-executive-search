'use strict';

// Administrative account management for named consultant accounts.
//
// Deliberately a CLI and not an HTTP route. Account administration is the
// authority that grants every other authority, and the app has no role above
// consultant to hold it. Exposing it over HTTP would mean any compromised
// consultant session could mint or reset accounts; requiring shell access to
// the deployment keeps it behind whatever controls the hosting account has.
//
// Run inside the deployment, against its DATA_DIR:
//   node scripts/accounts.js list
//   node scripts/accounts.js create "Dana Ruiz" dana@firm.example "Search consultant"
//   node scripts/accounts.js rename u3 "Dana Ruiz-Alvarez"
//   node scripts/accounts.js reset u3
//   node scripts/accounts.js disable u3
//   node scripts/accounts.js enable u3
//
// create and reset print a generated PIN once. It is not stored in readable
// form and cannot be printed again; reset issues a new one.

const db = require('../server/db');
const credentials = require('../server/credentials');

const [action, ...rest] = process.argv.slice(2);

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function show(user) {
  return [
    user.id.padEnd(10),
    (user.role || '').padEnd(10),
    (user.disabled ? 'disabled' : 'active').padEnd(9),
    (user.email || '').padEnd(28),
    user.name || ''
  ].join(' ');
}

function find(id) {
  const user = db.findUserById(id) || db.findUserByEmail(id);
  if (!user) fail('No account matches "' + id + '".');
  return user;
}

const actions = {
  list() {
    console.log('id         role       state     email                        name');
    for (const user of db.db.users) console.log(show(user));
    console.log('\n' + db.db.users.length + ' accounts. Data directory: ' + db.DATA_DIR);
  },

  create([name, email, title]) {
    if (!name || !email) return fail('Usage: create "Full Name" email@example.com ["Title"]');
    if (db.findUserByEmail(email)) return fail('An account already uses ' + email + '.');
    const { user, pin } = db.createUser({ name, email, title, role: 'consultant' });
    db.persist();
    console.log('Created ' + user.id + ' (' + user.email + ')');
    console.log('PIN: ' + pin);
    console.log('Give this to the person directly. It is not recoverable; use reset to issue another.');
  },

  rename([id, name]) {
    if (!id || !name) return fail('Usage: rename <id|email> "New Name"');
    const user = find(id);
    if (!user) return;
    user.name = String(name).trim();
    user.init = db.initials(user.name);
    db.persist();
    console.log('Renamed ' + user.id + ' to ' + user.name);
  },

  reset([id]) {
    if (!id) return fail('Usage: reset <id|email>');
    const user = find(id);
    if (!user) return;
    const pin = db.makePin();
    credentials.set(user, pin);
    const revoked = db.revokeSessions(user.id);
    db.persist();
    console.log('Reset ' + user.id + ' (' + user.email + ')');
    console.log('PIN: ' + pin);
    console.log('Revoked ' + revoked + ' active session(s). The previous PIN no longer works.');
  },

  disable([id]) {
    if (!id) return fail('Usage: disable <id|email>');
    const user = find(id);
    if (!user) return;
    // The account stays in the store. History records who made each decision,
    // and removing the account would break that attribution.
    db.setDisabled(user, true, 'cli');
    db.persist();
    console.log('Disabled ' + user.id + ' (' + user.email + '). Sessions revoked; record and history retained.');
  },

  enable([id]) {
    if (!id) return fail('Usage: enable <id|email>');
    const user = find(id);
    if (!user) return;
    db.setDisabled(user, false, 'cli');
    db.persist();
    console.log('Enabled ' + user.id + ' (' + user.email + '). Issue a new PIN with reset if it may be known.');
  },

  audit() {
    // Hashing an old weak PIN does not make it strong. This reports accounts
    // whose credential predates the strength policy so an operator can decide
    // whether to reset them, rather than assuming migration fixed it.
    const flagged = [];
    for (const user of db.db.users) {
      for (const guess of [...credentials.DEV_DEFAULTS]) {
        if (credentials.verify(user, guess)) flagged.push({ user, reason: 'published development PIN' });
      }
    }
    if (!flagged.length) {
      console.log('No account authenticates with a known development PIN.');
      console.log('This does not prove remaining PINs are strong; it only rules out the published ones.');
      return;
    }
    console.log('Accounts using a published development PIN:');
    for (const { user, reason } of flagged) console.log('  ' + show(user) + '  <- ' + reason);
    console.log('\nReset each with: node scripts/accounts.js reset <id>');
    process.exitCode = 1;
  }
};

if (!action || !Object.hasOwn(actions, action)) {
  console.error('Usage: node scripts/accounts.js <list|create|rename|reset|disable|enable|audit> [args]');
  console.error('Operates on DATA_DIR (currently ' + db.DATA_DIR + ').');
  process.exitCode = 1;
} else {
  actions[action](rest);
}
