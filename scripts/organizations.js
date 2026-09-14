'use strict';

// Organization migration: mapping an existing store onto firm workspaces.
//
// Deliberately a CLI, and deliberately a dry run first. Deciding which firm
// owns a search that predates organizations is not a decision the application
// can make — there is nothing in an old record that names a workspace, and
// letting the first person to sign in claim the book is exactly the failure
// this whole change exists to prevent. So the destination organization is
// supplied by an operator who can see what they are handing over, and nothing
// is written until they say `--apply`.
//
// Run inside the deployment, against its DATA_DIR:
//
//   node scripts/organizations.js plan
//       What is in the store, and what is still unmapped.
//
//   node scripts/organizations.js adopt --org org_123 --name "Letcher & Co"
//       Show what mapping every unowned search to org_123 would do.
//
//   node scripts/organizations.js adopt --org org_123 --name "Letcher & Co" --apply
//       Do it. Idempotent: a search that already has an owner is never moved.
//
//   node scripts/organizations.js adopt --org org_123 --searches sr-a,sr-b --apply
//       Map only those searches.
//
//   node scripts/organizations.js link --org org_123 --email dana@firm.example --role org:consultant [--apply]
//       Record what role Clerk holds for somebody, so the Members list and the
//       eligibility checks have a name before that person signs in. This
//       is a cache entry, not a grant: their access still comes from the
//       membership Clerk reports on their next request. Create the membership
//       at Clerk itself — this command does not.
//
// The Clerk side of a migration (organizations, memberships, invitations) is
// separate from this file and separate from a database backup. Restoring one
// does not restore the other.

const db = require('../server/db');
const organizations = require('../server/organizations');

const argv = process.argv.slice(2);
const action = argv[0];

function flag(name) {
  const at = argv.indexOf('--' + name);
  return at === -1 ? null : (argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : true);
}
const apply = argv.includes('--apply');

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function orgName(id) {
  const record = organizations.findOrganization(db.db, id);
  return record ? record.name : '(not recorded locally)';
}

function describe(search) {
  return [
    (search.no || search.id).padEnd(14),
    (search.organizationId || '— unowned —').padEnd(22),
    String(search.client || '').slice(0, 24).padEnd(26),
    String(search.position || '').slice(0, 22)
  ].join(' ');
}

const actions = {
  /** An inventory, and a list of everything a migration still has to decide. */
  plan() {
    const active = db.db.searches;
    const archived = db.db.archivedSearches;
    const all = [...active, ...archived];
    const unowned = all.filter(s => !s.organizationId);
    const owners = new Map();
    for (const s of all) {
      if (!s.organizationId) continue;
      owners.set(s.organizationId, (owners.get(s.organizationId) || 0) + 1);
    }

    console.log('Data directory: ' + db.DATA_DIR);
    console.log('Schema version: ' + (db.db.schemaVersion ?? 'unversioned') + '\n');

    console.log('Searches: ' + active.length + ' active, ' + archived.length + ' archived');
    console.log('no             organization           client                     position');
    for (const s of all) console.log(describe(s));

    console.log('\nWorkspaces holding searches:');
    if (!owners.size) console.log('  (none)');
    for (const [id, count] of owners) console.log('  ' + id + '  ' + count + ' search(es)  ' + orgName(id));

    console.log('\nRecorded organizations: ' + (db.db.organizations || []).length);
    for (const o of db.db.organizations || []) console.log('  ' + o.id + '  ' + o.name);

    console.log('\nRecorded memberships: ' + (db.db.memberships || []).length);
    for (const m of db.db.memberships || []) {
      const user = db.findUserById(m.userId);
      console.log('  ' + m.orgId + '  ' + String(m.role).padEnd(16) + '  ' + (user ? user.email : m.userId + ' (no account)'));
    }

    console.log('\nHeld search places: ' + (db.db.pendingAssignments || []).length);
    for (const p of db.db.pendingAssignments || []) {
      console.log('  ' + p.orgId + '  ' + p.searchId + '  ' + p.searchRole.padEnd(10) + '  ' + p.email);
    }

    const accounts = db.db.users;
    const mapped = new Set((db.db.memberships || []).map(m => m.userId));
    console.log('\nAccounts: ' + accounts.length + ', of which ' + mapped.size + ' are mapped to a workspace');
    for (const u of accounts.filter(u => !mapped.has(u.id))) {
      console.log('  unmapped  ' + (u.id).padEnd(12) + (u.disabled ? 'disabled  ' : 'active    ') + u.email);
    }

    console.log('\n' + unowned.length + ' search(es) have no owning organization.');
    if (unowned.length) {
      console.log('They are readable by nobody until they are mapped. Decide the destination');
      console.log('workspace, then rehearse:  node scripts/organizations.js adopt --org <id> --name "<name>"');
    }
  },

  /** Map searches to a workspace an operator has named. */
  adopt() {
    const orgId = flag('org');
    const name = flag('name');
    const only = flag('searches');
    if (typeof orgId !== 'string' || !orgId.trim()) {
      return fail('Usage: adopt --org <organization id> [--name "Firm name"] [--searches id,id] [--apply]\n'
        + 'The organization id comes from Clerk. This command does not create one.');
    }
    const wanted = typeof only === 'string'
      ? new Set(only.split(',').map(s => s.trim()).filter(Boolean))
      : null;

    const all = [...db.db.searches, ...db.db.archivedSearches];
    const candidates = all.filter(s => (wanted ? wanted.has(s.id) || wanted.has(s.no) : true));
    const already = candidates.filter(s => s.organizationId);
    const toMap = candidates.filter(s => !s.organizationId);

    if (wanted) {
      const missing = [...wanted].filter(id => !all.some(s => s.id === id || s.no === id));
      if (missing.length) return fail('No such search: ' + missing.join(', ') + '. Nothing was changed.');
    }

    console.log((apply ? 'Mapping' : 'Would map') + ' ' + toMap.length + ' search(es) to ' + orgId
      + (typeof name === 'string' ? ' (' + name + ')' : '') + ':');
    for (const s of toMap) console.log('  ' + describe(s));

    if (already.length) {
      console.log('\nLeft alone, because they already have an owner (a search does not move between firms):');
      for (const s of already) console.log('  ' + describe(s));
    }

    const conflicting = already.filter(s => s.organizationId !== orgId);
    if (conflicting.length) {
      console.log('\n' + conflicting.length + ' of those belong to a different workspace. Review them before continuing.');
    }

    if (!apply) {
      console.log('\nDry run. Nothing was written. Re-run with --apply to commit.');
      return;
    }
    if (!toMap.length) {
      console.log('\nNothing to do.');
      return;
    }

    if (typeof name === 'string') {
      organizations.rememberOrganization(db.db, { id: orgId, name });
    }
    for (const s of toMap) s.organizationId = orgId;
    db.persist();
    console.log('\nMapped ' + toMap.length + ' search(es) to ' + orgId + '.');
    console.log('Members of that workspace can now open them. Verify with: plan');
  },

  /**
   * Record the role Clerk holds for somebody.
   *
   * A cache entry and a migration mapping. It does not create the membership at
   * Clerk, and on its own it opens nothing: the person's access is decided by
   * the membership the provider reports when they make a request.
   */
  link() {
    const orgId = flag('org');
    const email = organizations.normalizeEmail(flag('email'));
    const role = flag('role');
    if (typeof orgId !== 'string' || !email || typeof role !== 'string') {
      return fail('Usage: link --org <organization id> --email <address> --role <'
        + organizations.ROLES.join('|') + '> [--apply]');
    }
    if (!organizations.isSupportedRole(role)) {
      return fail('Unsupported role "' + role + '". Slate acts on: ' + organizations.ROLES.join(', ') + '.');
    }
    const user = db.findUserByEmail(email);
    if (!user) return fail('No Slate account uses ' + email + '. They get one when they first sign in.');

    console.log((apply ? 'Recording' : 'Would record') + ' ' + user.id + ' (' + email + ') as '
      + organizations.ROLE_LABEL[role] + ' in ' + orgId + ' (' + orgName(orgId) + ').');
    console.log('This is a local mapping. Create the membership at Clerk separately.');
    if (!apply) {
      console.log('\nDry run. Nothing was written. Re-run with --apply to commit.');
      return;
    }
    organizations.rememberMembership(db.db, { orgId, userId: user.id, role });
    db.persist();
    console.log('\nRecorded.');
  }
};

if (!action || !Object.hasOwn(actions, action)) {
  console.error('Usage: node scripts/organizations.js <plan|adopt|link> [options]');
  console.error('Operates on DATA_DIR (currently ' + db.DATA_DIR + ').');
  process.exitCode = 1;
} else {
  actions[action]();
}
