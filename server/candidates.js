'use strict';

// Candidate-facing record keeping: submission receipts, recoverable drafts,
// external document references, and the manual communication log.
//
// The person on the other end of these routes is an applicant, usually on a
// phone, often someone who has not told their current employer they are
// looking. Two consequences run through this file:
//
//  - Losing their work is not an acceptable failure mode. A dropped connection
//    must never cost them a long answer, and must never make them think they
//    have to send it again.
//  - Nothing here claims more than it knows. Slate does not send messages, so
//    the log records that staff say they made contact, not that a provider
//    delivered anything.

const crypto = require('crypto');

/* ------------------------------------------------------------------ *
 * Receipts
 *
 * Proof, for the candidate, that a submission arrived. Derived from the
 * submission rather than stored separately, so it cannot drift from it or
 * survive a correction that replaced the response.
 * ------------------------------------------------------------------ */
function receiptOf(candidate, which) {
  const response = candidate?.[which];
  if (!response?.at) return null;
  const id = crypto.createHash('sha256')
    .update([candidate.id, which, response.at, response.version ?? ''].join('|'))
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();
  return {
    id,
    submittedAt: response.at,
    questionnaire: which,
    questionVersion: response.version ?? null,
    questionCount: response.survey?.questions?.length ?? null
  };
}

function receipts(candidate) {
  const out = {};
  for (const which of ['survey1', 'survey2']) {
    const receipt = receiptOf(candidate, which);
    if (receipt) out[which] = receipt;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Drafts
 *
 * A long answer typed on a phone is easy to lose: the tab is suspended, the
 * connection drops, the browser is closed. Keeping it only in localStorage
 * would leave a candidate's answers sitting on a possibly shared device with
 * nothing expiring them, which is worse than the problem it solves.
 *
 * So drafts live on the server, scoped to one candidate and one questionnaire,
 * and expire. They are never part of the submitted record: a draft cannot
 * modify a response that has already been submitted.
 * ------------------------------------------------------------------ */
const DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const DRAFT_MAX_CHARS = 20000;

function saveDraft(candidate, which, answers) {
  if (candidate[which]) return { error: 'This questionnaire was already submitted. Drafts no longer apply to it.' };
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return { error: 'Provide draft answers.' };

  const cleaned = {};
  for (const [key, value] of Object.entries(answers)) {
    if (!/^q\d+$/.test(key)) return { error: 'Unexpected draft field.' };
    if (typeof value !== 'string' || value.length > DRAFT_MAX_CHARS) return { error: 'Draft answers must be text under 20,000 characters.' };
    cleaned[key] = value;
  }

  candidate.drafts ||= {};
  candidate.drafts[which] = {
    answers: cleaned,
    at: new Date().toISOString(),
    expiresAt: new Date(Date.now() + DRAFT_TTL_MS).toISOString()
  };
  return { saved: candidate.drafts[which] };
}

function readDraft(candidate, which) {
  const draft = candidate?.drafts?.[which];
  if (!draft) return null;
  if (Date.parse(draft.expiresAt) <= Date.now()) return null;
  if (candidate[which]) return null; // submitted; the draft is spent
  return draft;
}

function clearDraft(candidate, which) {
  if (candidate?.drafts) delete candidate.drafts[which];
}

/** Remove drafts that have expired or whose questionnaire was submitted. */
function pruneDrafts(search) {
  let removed = 0;
  for (const candidate of search?.candidates || []) {
    for (const which of Object.keys(candidate.drafts || {})) {
      const draft = candidate.drafts[which];
      if (candidate[which] || Date.parse(draft.expiresAt) <= Date.now()) {
        delete candidate.drafts[which];
        removed += 1;
      }
    }
  }
  return removed;
}

/* ------------------------------------------------------------------ *
 * External documents
 *
 * Resumes live in the county-approved repository, not here. Slate records that
 * a document was received and where it is, and refuses to become a way of
 * making a restricted document publicly reachable.
 * ------------------------------------------------------------------ */
const ALLOWED_SCHEMES = new Set(['https:']);

function validateDocument(body) {
  if (!body || typeof body !== 'object') return 'Provide the document details.';
  const kind = String(body.kind || '').trim();
  if (!['resume', 'application', 'supporting', 'reference', 'background'].includes(kind)) {
    return 'Choose a document type.';
  }
  const label = String(body.label || '').trim();
  if (!label || label.length > 200) return 'Give the document a short label.';

  const url = String(body.url || '').trim();
  if (url) {
    let parsed;
    try { parsed = new URL(url); } catch { return 'That is not a valid link.'; }
    // http, file, data and everything else are refused. A record that points at
    // a document must point at one the repository still controls.
    if (!ALLOWED_SCHEMES.has(parsed.protocol)) return 'Use an https link to the approved document repository.';
    if (url.length > 2000) return 'That link is too long.';
  }
  if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 2000)) {
    return 'Keep the note under 2,000 characters.';
  }
  return null;
}

function addDocument(candidate, body, actor) {
  candidate.documents ||= [];
  const record = {
    id: 'doc-' + crypto.randomBytes(4).toString('hex'),
    kind: String(body.kind).trim(),
    label: String(body.label).trim(),
    // A reference, never the document. Access is whatever the repository
    // grants; recording a link here does not widen it.
    url: String(body.url || '').trim() || null,
    note: String(body.note || '').trim(),
    receivedAt: String(body.receivedAt || '').trim() || new Date().toISOString(),
    recordedBy: actor?.id || null,
    recordedByName: actor?.name || null,
    recordedAt: new Date().toISOString(),
    // Reference and background material is narrower than the rest of the file.
    restricted: ['reference', 'background'].includes(String(body.kind).trim())
  };
  candidate.documents.push(record);
  return record;
}

/* ------------------------------------------------------------------ *
 * Communication log
 *
 * Slate sends nothing. Every message is sent by a person through their own
 * email or phone, and this records that they say they did it. Calling that
 * "delivered" would be a claim the application cannot support, and a search
 * record should not assert a candidate was notified when all it knows is that
 * staff intended to notify them.
 * ------------------------------------------------------------------ */
const CHANNELS = ['email', 'phone', 'letter', 'in-person', 'other'];
const PURPOSES = ['invitation', 'reminder', 'scheduling', 'status', 'decision', 'accommodation', 'other'];

function validateCommunication(body) {
  if (!body || typeof body !== 'object') return 'Provide the contact details.';
  if (!CHANNELS.includes(String(body.channel || ''))) return 'Choose how you contacted them.';
  if (!PURPOSES.includes(String(body.purpose || ''))) return 'Choose what the contact was about.';
  const summary = String(body.summary || '').trim();
  if (!summary) return 'Say briefly what was communicated.';
  if (summary.length > 4000) return 'Keep the summary under 4,000 characters.';
  if (body.followUpOn && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.followUpOn))) {
    return 'A follow-up date must look like 2026-09-30.';
  }
  return null;
}

function addCommunication(candidate, body, actor) {
  candidate.communications ||= [];
  const record = {
    id: 'com-' + crypto.randomBytes(4).toString('hex'),
    at: String(body.at || '').trim() || new Date().toISOString(),
    channel: String(body.channel),
    purpose: String(body.purpose),
    summary: String(body.summary).trim(),
    followUpOn: String(body.followUpOn || '').trim() || null,
    actorId: actor?.id || null,
    actorName: actor?.name || null,
    recordedAt: new Date().toISOString(),
    // The honest label. Slate has no mail server and no delivery receipts.
    evidence: 'staff-recorded',
    evidenceNote: 'Recorded by staff as contact they made. Slate does not send messages and cannot confirm delivery.'
  };
  candidate.communications.push(record);
  return record;
}

/**
 * Who still needs following up.
 *
 * The operational question a consultant asks every morning: who has not been
 * contacted, and whose follow-up date has passed.
 */
function followUps(search, today = new Date()) {
  const due = [];
  const uncontacted = [];
  for (const candidate of search?.candidates || []) {
    const log = candidate.communications || [];
    if (!log.length) {
      uncontacted.push({ id: candidate.id, name: candidate.name, stage: candidate.stage || null });
      continue;
    }
    for (const entry of log) {
      if (!entry.followUpOn) continue;
      if (Date.parse(entry.followUpOn) <= today.getTime()) {
        due.push({
          id: candidate.id, name: candidate.name, stage: candidate.stage || null,
          followUpOn: entry.followUpOn, purpose: entry.purpose, since: entry.at
        });
      }
    }
  }
  return { due, uncontacted, total: due.length + uncontacted.length };
}

module.exports = {
  receiptOf, receipts,
  saveDraft, readDraft, clearDraft, pruneDrafts, DRAFT_TTL_MS,
  validateDocument, addDocument, ALLOWED_SCHEMES,
  validateCommunication, addCommunication, followUps, CHANNELS, PURPOSES
};
