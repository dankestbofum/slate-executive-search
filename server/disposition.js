'use strict';

// Candidate outcomes and the search's own lifecycle.
//
// These are two different questions and were previously one. `stage` says
// where someone sits in the pipeline; it cannot say that a finalist withdrew,
// or that one of them was hired. Archive was doing duty as both "this search
// is over" and "put this away", which means a completed search and an
// abandoned one looked the same.
//
// The rules that shape this file:
//
//  - A decision is an event, not a field. Correcting one adds a new event; the
//    original stays. A hiring record that can be silently rewritten is not a
//    record, and the county may need to show what was decided and when.
//  - An outcome constrains what can happen next. Someone who withdrew must not
//    be advanced or newly scored, and their submission link must stop working.
//  - Nothing is erased. Evaluations of a withdrawn candidate remain part of
//    the search's history, because they are evidence of how the committee
//    worked, not just of that person.

const crypto = require('crypto');

/* ------------------------------------------------------------------ *
 * Candidate outcomes
 * ------------------------------------------------------------------ */
const OUTCOMES = {
  withdrawn: {
    key: 'withdrawn',
    label: 'Withdrew',
    // A withdrawal is the candidate's decision, recorded by staff. Slate has no
    // candidate-initiated route, so the record says who reported it.
    staffRecorded: true,
    final: true,
    revokesAccess: true,
    needsEvidence: false
  },
  'not-selected': {
    key: 'not-selected',
    label: 'Not selected',
    final: true,
    revokesAccess: true,
    // A non-selection is a hiring decision. It has to point at the job-related
    // basis it was made on.
    needsEvidence: true
  },
  selected: {
    key: 'selected',
    label: 'Selected',
    final: true,
    revokesAccess: false,
    needsEvidence: true
  },
  'declined-offer': {
    key: 'declined-offer',
    label: 'Declined the offer',
    staffRecorded: true,
    final: true,
    revokesAccess: true,
    needsEvidence: false
  }
};

const FINAL_OUTCOMES = new Set(Object.values(OUTCOMES).filter(o => o.final).map(o => o.key));

function validateDisposition(body) {
  if (!body || typeof body !== 'object') return 'Provide the decision.';
  const outcome = String(body.outcome || '');
  if (!Object.hasOwn(OUTCOMES, outcome)) {
    return 'Choose an outcome: ' + Object.keys(OUTCOMES).join(', ') + '.';
  }
  const reason = String(body.reason || '').trim();
  if (!reason) return 'Record why this decision was made.';
  if (reason.length > 4000) return 'Keep the reason under 4,000 characters.';

  const evidence = String(body.evidence || '').trim();
  if (OUTCOMES[outcome].needsEvidence && !evidence) {
    return 'Record the job-related evidence this decision rests on.';
  }
  if (evidence.length > 4000) return 'Keep the evidence under 4,000 characters.';
  if (body.correction !== undefined && typeof body.correction !== 'boolean') {
    return 'Correction must be true or false.';
  }
  return null;
}

/**
 * Record an outcome as a new event.
 *
 * The previous decision is never edited or removed. A correction is another
 * entry that names what it supersedes, so the record shows both what was
 * decided and that it was later changed.
 */
function recordDisposition(candidate, body, actor) {
  candidate.dispositions ||= [];
  const previous = candidate.dispositions[candidate.dispositions.length - 1] || null;

  const entry = {
    id: 'dsp-' + crypto.randomBytes(4).toString('hex'),
    outcome: String(body.outcome),
    reason: String(body.reason).trim(),
    evidence: String(body.evidence || '').trim(),
    at: new Date().toISOString(),
    actorId: actor?.id || null,
    actorName: actor?.name || null,
    // Present only on a correction, and it names the entry it replaces rather
    // than replacing it.
    supersedes: body.correction && previous ? previous.id : null,
    // Withdrawals and declined offers are reported to staff by the candidate.
    // Saying so keeps a candidate's decision from reading as the firm's.
    source: OUTCOMES[String(body.outcome)].staffRecorded ? 'staff-recorded-from-candidate' : 'consultant-decision'
  };

  candidate.dispositions.push(entry);
  candidate.disposition = entry.outcome;
  candidate.dispositionAt = entry.at;
  return entry;
}

function currentDisposition(candidate) {
  const list = candidate?.dispositions || [];
  return list.length ? list[list.length - 1] : null;
}

function isConcluded(candidate) {
  const current = currentDisposition(candidate);
  return Boolean(current && FINAL_OUTCOMES.has(current.outcome));
}

/**
 * Whether a candidate may still be advanced or newly evaluated.
 *
 * A withdrawn or not-selected candidate keeps every score already recorded —
 * those are evidence of how the committee worked. What stops is new activity
 * that would contradict the outcome.
 */
function blocksAdvancement(candidate) {
  const current = currentDisposition(candidate);
  if (!current) return null;
  if (!FINAL_OUTCOMES.has(current.outcome)) return null;
  if (current.outcome === 'selected') return null; // the hire continues through contracting
  return OUTCOMES[current.outcome].label;
}

/* ------------------------------------------------------------------ *
 * Search lifecycle
 *
 * Separate from Archive. Archive is filing; closing is the statement that the
 * work concluded, and how.
 * ------------------------------------------------------------------ */
const LIFECYCLE = {
  active: { key: 'active', label: 'Active', frozen: false },
  closed: { key: 'closed', label: 'Closed', frozen: true },
  cancelled: { key: 'cancelled', label: 'Cancelled', frozen: true }
};

function lifecycleOf(search) {
  const status = search?.lifecycle?.status;
  return Object.hasOwn(LIFECYCLE, status || '') ? status : 'active';
}

function isFrozen(search) {
  return LIFECYCLE[lifecycleOf(search)].frozen;
}

function validateClose(body) {
  if (!body || typeof body !== 'object') return 'Provide the closeout details.';
  const status = String(body.status || '');
  if (!['closed', 'cancelled'].includes(status)) return 'Choose closed or cancelled.';
  const reason = String(body.reason || '').trim();
  if (!reason) return 'Record why the search is being closed.';
  if (reason.length > 4000) return 'Keep the reason under 4,000 characters.';
  return null;
}

function close(search, body, actor) {
  search.lifecycle ||= { history: [] };
  search.lifecycle.history ||= [];
  const entry = {
    id: 'lc-' + crypto.randomBytes(4).toString('hex'),
    status: String(body.status),
    reason: String(body.reason).trim(),
    at: new Date().toISOString(),
    actorId: actor?.id || null,
    actorName: actor?.name || null
  };
  search.lifecycle.history.push(entry);
  search.lifecycle.status = entry.status;
  search.lifecycle.at = entry.at;
  return entry;
}

/**
 * Reopen a closed search.
 *
 * Deliberate and reasoned, and it does not resurrect anything. Candidate links
 * revoked at closeout stay revoked; reissuing one is a separate, explicit act,
 * so reopening a search never quietly puts a live bearer URL back into the
 * world months later.
 */
function reopen(search, body, actor) {
  search.lifecycle ||= { history: [] };
  search.lifecycle.history ||= [];
  const entry = {
    id: 'lc-' + crypto.randomBytes(4).toString('hex'),
    status: 'active',
    reason: String(body.reason || '').trim(),
    at: new Date().toISOString(),
    actorId: actor?.id || null,
    actorName: actor?.name || null,
    reopened: true
  };
  search.lifecycle.history.push(entry);
  search.lifecycle.status = 'active';
  search.lifecycle.at = entry.at;
  return entry;
}

/**
 * A summary of how the search concluded, for closeout and for the export.
 */
function summary(search) {
  const people = search?.candidates || [];
  const byOutcome = {};
  for (const candidate of people) {
    const current = currentDisposition(candidate);
    const key = current?.outcome || 'in-process';
    byOutcome[key] = (byOutcome[key] || 0) + 1;
  }
  const selected = people.filter(c => currentDisposition(c)?.outcome === 'selected');
  return {
    status: lifecycleOf(search),
    frozen: isFrozen(search),
    closedAt: search?.lifecycle?.at || null,
    reason: (search?.lifecycle?.history || []).slice(-1)[0]?.reason || null,
    reopenCount: (search?.lifecycle?.history || []).filter(h => h.reopened).length,
    candidates: people.length,
    byOutcome,
    selected: selected.map(c => ({ id: c.id, name: c.name })),
    undecided: people.filter(c => !currentDisposition(c)).map(c => ({ id: c.id, name: c.name })),
    finalDocuments: Object.keys(search?.artifacts || {})
  };
}

module.exports = {
  OUTCOMES, FINAL_OUTCOMES, LIFECYCLE,
  validateDisposition, recordDisposition, currentDisposition, isConcluded, blocksAdvancement,
  lifecycleOf, isFrozen, validateClose, close, reopen, summary
};
