'use strict';

// Deployment-level account management.
//
// Deliberately a CLI and not an HTTP route. What is left here is the authority
// that sits above every workspace — disabling an account entirely, whichever
// firms it belongs to — and the app has no role that should hold it. Requiring
// shell access to the deployment keeps it behind whatever controls the hosting
// account has.
//
// Routine access management is no longer here. Who is in a firm's workspace,
// and what they may do inside it, is an organization administrator's job in
// Team & access, and the membership itself lives at Clerk. There is no longer a
// command that grants firm-wide consultant access, because there is no longer a
// firm-wide consultant. For mapping legacy records onto a workspace, see
// scripts/organizations.js.
//
// Run inside the deployment, against its DATA_DIR:
//   node scripts/accounts.js list
//   node scripts/accounts.js rename u3 "Dana Ruiz-Alvarez"
//   node scripts/accounts.js disable u3
//   node scripts/accounts.js enable u3
//
const db = require('../server/db');
const organizations = require('../server/organizations');

const [action, ...rest] = process.argv.slice(2);

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

/**
 * Which workspaces Slate last saw this account in.
 *
 * Read from the local membership cache, so it is a record of what the provider
 * reported rather than the authority itself. An account can hold a membership
 * this store has not seen yet; it opens on their next request all the same.
 */
function workspacesOf(user) {
  const memberships = organizations.membershipsOfUser(db.db, user.id);
  if (!memberships.length) return 'none';
  return memberships.map(m => {
    const org = organizations.findOrganization(db.db, m.orgId);
    return (org ? org.name : m.orgId) + ':' + String(m.role || '?').replace(/^org:/, '');
  }).join(', ');
}

function show(user) {
  return [
    user.id.padEnd(10),
    (user.disabled ? 'disabled' : 'active').padEnd(9),
    (user.email || '').padEnd(28),
    (user.name || '').padEnd(22),
    workspacesOf(user)
  ].join(' ');
}

function find(id) {
  const user = db.findUserById(id) || db.findUserByEmail(id);
  if (!user) fail('No account matches "' + id + '".');
  return user;
}

const actions = {
  list() {
    console.log('id         state     email                        name                   workspaces');
    for (const user of db.db.users) console.log(show(user));
    console.log('\n' + db.db.users.length + ' accounts. Data directory: ' + db.DATA_DIR);
    console.log('Workspace roles are held at Clerk. What is shown here is the last one Slate verified.');
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
    console.log('Enabled ' + user.id + ' (' + user.email + '). They can sign in with their email.');
  },

};

if (!action || !Object.hasOwn(actions, action)) {
  console.error('Usage: node scripts/accounts.js <list|rename|disable|enable> [args]');
  console.error('Workspace membership and roles: Team & access in the app, or scripts/organizations.js.');
  console.error('Operates on DATA_DIR (currently ' + db.DATA_DIR + ').');
  process.exitCode = 1;
} else {
  actions[action](rest);
}
