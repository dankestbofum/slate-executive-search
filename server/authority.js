'use strict';

// Who may make a late-stage decision on a search.
//
// The application already knew two things about a person: whether they are the
// firm's staff in this workspace (`db.canEdit`) and whether they hold the
// account on this particular search (`db.canManage`). What it did not have was
// a single statement of which decisions need the second one. The guards were
// scattered through the routes, several of them reading the legacy account-level
// `user.role` field that organization membership replaced — a check that says
// "consultant" about an account rather than about this workspace, and which a
// person invited into a firm today does not even carry.
//
// This module is that statement. Every late-stage action names its authority
// here, the routes ask, and the client is told the same answers, so the controls
// it draws and the calls the server accepts cannot drift apart.
//
// The values are the matrix proposed in docs/late-stage-pilot-plan.md section 3.
// They are a proposal until the search owner accepts or revises it after the P2
// tabletop; revising one is an edit to the table below and to the case in
// tests/authority.js that pins it, not a hunt through the routes.

const db = require('./db');

// The three authorities a decision can need.
//
//  staff    — any consultant or administrator in the workspace who can open
//             this search. The firm's ordinary working authority.
//  manager  — the person holding the account on this search. One per search.
//  orgAdmin — a workspace administrator, for the case where the manager is
//             unreachable and somebody has to be able to act.
const AUTHORITIES = ['staff', 'manager', 'orgAdmin'];

/**
 * The matrix.
 *
 * `authority` is a floor, not an exact match: a workspace administrator who
 * holds the account satisfies `manager`, and a manager satisfies `staff`.
 * `also` names an alternative authority that is sufficient on its own, which is
 * how handover works — the outgoing manager may hand the account over, and so
 * may an administrator, but an uninvolved consultant may not take it.
 */
const ACTIONS = {
  advanceFinalist: {
    authority: 'manager',
    label: 'Advance a candidate to finalist, or reverse that advancement',
    error: 'Advancing someone to finalist, or reversing it, is the search manager’s decision. Prepare the recommendation and ask them.'
  },
  advanceStage: {
    authority: 'staff',
    label: 'Move a candidate through the earlier stages',
    error: 'A consultant in this workspace advances candidates.'
  },
  releaseScores: {
    authority: 'manager',
    label: 'Release or reseal committee scores',
    error: 'Releasing or resealing scores is the search manager’s decision. Resealing cannot recall an export already taken.'
  },
  recordOutcome: {
    authority: 'manager',
    label: 'Record or correct a candidate outcome',
    error: 'Recording or correcting an outcome is the search manager’s decision. Log the source communication and ask them.'
  },
  certifyReferences: {
    authority: 'manager',
    label: 'Certify or reopen reference completion',
    error: 'Certifying or reopening reference completion is the search manager’s decision. Consultants record the consent and the contacts.'
  },
  certifyStaffWork: {
    authority: 'staff',
    label: 'Certify sourcing or interview work',
    error: 'A consultant in this workspace signs off on staff work.'
  },
  publishPosting: {
    authority: 'manager',
    label: 'Publish, pause, close, or republish the public job posting',
    // The one decision in the application that puts a client's search in front
    // of the general public. Consultants write the posting and preview it; the
    // act of making it reachable belongs to the person accountable for the
    // engagement.
    error: 'Publishing a public job posting, or changing whether it accepts applications, is the search manager’s decision. Prepare the posting and preview it, then ask them.'
  },
  closeSearch: {
    authority: 'manager',
    label: 'Close or cancel the search',
    error: 'Closing or cancelling the search is the search manager’s decision. Prepare the closeout inventory and ask them.'
  },
  reopenSearch: {
    authority: 'manager',
    label: 'Reopen a closed search',
    error: 'Reopening a closed search is the search manager’s decision.'
  },
  archiveSearch: {
    authority: 'manager',
    label: 'Archive the search',
    error: 'Archiving a search is its manager’s decision. Ask them, or have the account handed over first.'
  },
  restoreArchive: {
    authority: 'manager',
    // An archived search cannot be handed over: handover runs against a search
    // on the book, and this one is not. Without an administrator's fallback, a
    // search whose manager has left the firm could never be taken back out of
    // the archive by anybody, which is a deadlock rather than a safeguard.
    also: 'orgAdmin',
    label: 'Restore an archived search',
    error: 'Restoring an archived search is its manager’s decision, or a workspace administrator’s. Restoring grants no new membership and no candidate access.'
  },
  restoreHistory: {
    authority: 'staff',
    label: 'Restore a saved document, profile, or facts revision',
    error: 'A consultant in this workspace restores a saved revision.'
  },
  exportRecords: {
    authority: 'staff',
    label: 'Export the permitted record',
    error: 'Committee members read the search file. A consultant exports it.'
  },
  handoverManager: {
    authority: 'manager',
    also: 'orgAdmin',
    label: 'Hand the account to another consultant',
    error: 'The search manager hands the account over, and a workspace administrator can reassign it if they are unreachable. An uninvolved consultant cannot take it.'
  }
};

for (const [key, action] of Object.entries(ACTIONS)) {
  if (!AUTHORITIES.includes(action.authority)) throw new Error('Unknown authority for ' + key);
  if (action.also && !AUTHORITIES.includes(action.also)) throw new Error('Unknown alternative authority for ' + key);
}

/** Is this context a workspace administrator? Not search-specific. */
function isOrgAdmin(access) {
  return Boolean(access && access.capabilities && access.capabilities.manageMembers);
}

function holds(authority, search, access) {
  if (authority === 'staff') return db.canEdit(search, access);
  if (authority === 'manager') return db.canManage(search, access);
  // A workspace administrator still has to be able to open the file. The
  // capability widens which decisions they may make inside their own firm; it
  // never reaches across one.
  return isOrgAdmin(access) && db.canView(search, access);
}

/** May this context take this action on this search? */
function allows(action, search, access) {
  const rule = ACTIONS[action];
  if (!rule) throw new Error('Unknown late-stage action: ' + action);
  if (holds(rule.authority, search, access)) return true;
  return Boolean(rule.also && holds(rule.also, search, access));
}

/**
 * The refusal, or null.
 *
 * Names the manager where there is one, so a consultant who is told no learns
 * who to ask rather than only that they were refused.
 */
function refusalFor(action, search, access) {
  if (allows(action, search, access)) return null;
  const rule = ACTIONS[action];
  const manager = db.accountManager(search);
  const who = manager ? (db.findUserById(manager.userId)?.name || '') : '';
  return {
    status: 403,
    code: 'AUTHORITY_REQUIRED',
    action,
    requires: rule.authority,
    error: rule.error + (who && rule.authority === 'manager' ? ' ' + who + ' holds this account.' : '')
  };
}

/** Express guard for a route whose whole purpose is one late-stage action. */
function requireAuthority(action) {
  return function (req, res, next) {
    const refusal = refusalFor(action, req.search, req.access);
    if (refusal) return res.status(refusal.status).json(refusal);
    next();
  };
}

/**
 * Every answer at once, for the client.
 *
 * Sent on each read of a search so the controls the browser draws come from the
 * same table the routes enforce. The client disables what this says it cannot
 * do; the server refuses it regardless, because a disabled button is a courtesy
 * and not a permission.
 */
function permissions(search, access) {
  const out = {};
  for (const action of Object.keys(ACTIONS)) out[action] = allows(action, search, access);
  return out;
}

module.exports = {
  ACTIONS, AUTHORITIES, allows, refusalFor, requireAuthority, permissions, isOrgAdmin
};
