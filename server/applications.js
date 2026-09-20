'use strict';

/**
 * Applications from the public portal.
 *
 * An application is modelled separately from a candidate, and a draft
 * separately from a submission, because they are three different things with
 * three different audiences:
 *
 *   draft      — the applicant's own work in progress. Not an application.
 *                Invisible to staff and to the committee, absent from every
 *                export, and it expires.
 *   submitted  — a frozen snapshot with a receipt. Immutable. A correction
 *                makes a new version and keeps the original.
 *   candidate  — what staff accept onto the search, after which the existing
 *                screening and scoring workflow takes over unchanged.
 *
 * Applications live in their own table rather than inside a search. A draft
 * stored on the search would be one forgotten filter away from appearing in a
 * committee's candidate list or a permitted-records export, and "we remembered
 * to exclude it everywhere" is not a property you can check. Here, the search
 * has to ask for them.
 *
 * Every read is scoped by the workspace *and* the search, resolved from the
 * server's own records. Nothing trusts a submitted organization or search id,
 * so an applicant to one firm cannot be seen by another, and an applicant
 * cannot address an application at a workspace they were never offered.
 */

const crypto = require('crypto');
const postings = require('./postings');

// The same fourteen days the existing candidate questionnaire drafts use.
// Reused rather than invented so there is one answer to "how long does Slate
// keep something I did not send".
const DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const LIMITS = {
  name: 160, email: 254, phone: 60, location: 160,
  background: 8000, answer: 8000,
  perApplicant: 40
};

function now() { return new Date().toISOString(); }

function ensureTables(store) {
  store.applications ||= [];
  return store;
}

function text(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

/* ------------------------------------------------------------------ *
 * Finding applications
 *
 * Every lookup takes the scope it is allowed to see. There is deliberately no
 * "find by id" that does not.
 * ------------------------------------------------------------------ */

function byId(store, id) {
  return (store.applications || []).find(a => a.id === id) || null;
}

/** One applicant's application to one posting, whatever state it is in. */
function forApplicant(store, { applicantId, searchId }) {
  return (store.applications || []).find(a =>
    a.applicantId === applicantId && a.searchId === searchId && a.state !== 'withdrawn') || null;
}

/** Everything submitted against one search, for staff. Drafts are not included. */
function submittedFor(store, search) {
  return (store.applications || [])
    .filter(a => a.searchId === search.id
      && a.organizationId === search.organizationId
      && a.state === 'submitted')
    .sort((a, b) => String(b.submitted.at).localeCompare(String(a.submitted.at)));
}

function countsFor(store, search) {
  const all = submittedFor(store, search);
  return {
    submitted: all.length,
    awaiting: all.filter(a => !a.staff?.acceptedAt).length,
    accepted: all.filter(a => a.staff?.acceptedAt).length
  };
}

/* ------------------------------------------------------------------ *
 * Starting a draft
 * ------------------------------------------------------------------ */

/**
 * The form an application is being filled against.
 *
 * Frozen into the draft the moment it starts. Staff editing the posting
 * afterwards must not change the questions under somebody who is half way
 * through answering them.
 */
function freezeForm(posting) {
  const fields = posting.published.fields;
  return {
    postingVersion: posting.published.version,
    questions: (fields.questions || []).map(q => ({
      key: q.key, n: q.n, prompt: q.prompt, help: q.help, required: Boolean(q.required)
    })),
    materials: (fields.materials || []).map(m => ({
      key: m.key, label: m.label, note: m.note, required: Boolean(m.required)
    }))
  };
}

function start(store, { search, posting, applicant, prefillEmail }) {
  ensureTables(store);
  const existing = forApplicant(store, { applicantId: applicant.id, searchId: search.id });
  if (existing) return { application: existing, created: false };

  const mine = (store.applications || []).filter(a => a.applicantId === applicant.id);
  if (mine.length >= LIMITS.perApplicant) {
    return { error: 'You have reached the number of applications this service will hold for one address. Contact the search team.' };
  }

  const application = {
    id: 'apl-' + crypto.randomBytes(8).toString('hex'),
    // Resolved from the search record, never from the request.
    organizationId: search.organizationId,
    searchId: search.id,
    postingSlug: posting.slug,
    applicantId: applicant.id,
    state: 'draft',
    createdAt: now(),
    updatedAt: now(),
    expiresAt: new Date(Date.now() + DRAFT_TTL_MS).toISOString(),
    form: freezeForm(posting),
    answers: {
      name: '', email: prefillEmail || '', phone: '', location: '', background: '',
      responses: {}
    },
    files: [],
    submitted: null,
    corrections: [],
    staff: { acceptedAt: null, acceptedBy: null, candidateId: null }
  };
  store.applications.push(application);
  return { application, created: true };
}

/* ------------------------------------------------------------------ *
 * Saving a draft
 * ------------------------------------------------------------------ */

function validateDraft(application, body) {
  if (!body || typeof body !== 'object') return 'Provide your answers.';
  if (body.responses !== undefined) {
    if (!body.responses || typeof body.responses !== 'object' || Array.isArray(body.responses)) {
      return 'Provide your answers.';
    }
    const allowed = new Set((application.form.questions || []).map(q => q.key));
    for (const [key, value] of Object.entries(body.responses)) {
      if (!allowed.has(key)) return 'That answer does not belong to this application form. Reload the page.';
      if (typeof value !== 'string' || value.length > LIMITS.answer) {
        return 'Answers have to be text under ' + LIMITS.answer.toLocaleString('en-US') + ' characters.';
      }
    }
  }
  return null;
}

function saveDraft(application, body) {
  if (application.state !== 'draft') {
    return { error: 'This application was already submitted. It cannot be edited.' };
  }
  const invalid = validateDraft(application, body);
  if (invalid) return { error: invalid };

  const answers = application.answers;
  if (body.name !== undefined) answers.name = text(body.name, LIMITS.name);
  if (body.phone !== undefined) answers.phone = text(body.phone, LIMITS.phone);
  if (body.location !== undefined) answers.location = text(body.location, LIMITS.location);
  if (body.background !== undefined) answers.background = text(body.background, LIMITS.background);
  // The email is the verified address and is not editable here. Letting an
  // applicant change it in the form would detach the application from the
  // identity that proves it is theirs.
  if (body.responses !== undefined) {
    answers.responses = { ...answers.responses, ...body.responses };
  }

  application.updatedAt = now();
  // Every save is an act of interest. Extending the expiry from the last save
  // rather than from the start is what stops a long, carefully written
  // application from expiring while it is being written.
  application.expiresAt = new Date(Date.now() + DRAFT_TTL_MS).toISOString();
  return { application };
}

/* ------------------------------------------------------------------ *
 * A posting that changed under a draft
 *
 * Rule: never silently discard an answer, and never add a required question
 * somebody has not seen. So the two kinds of change are told apart, and only
 * one of them stops a submission.
 * ------------------------------------------------------------------ */

function formDrift(frozen, posting) {
  const none = { changed: false, material: false, added: [], removed: [], reworded: [], nowRequired: [], materials: [] };
  const current = posting?.published ? freezeForm(posting) : null;
  if (!current) return none;
  if (current.postingVersion === frozen.postingVersion) return none;
  // A new posting version is not by itself a changed form. Staff republish to
  // correct a salary line or a closing date far more often than they touch the
  // questions, and telling an applicant their form changed when it did not is
  // a reason to distrust the message that matters.
  if (JSON.stringify({ q: current.questions, m: current.materials })
      === JSON.stringify({ q: frozen.questions, m: frozen.materials })) {
    return { ...none, current };
  }

  const before = new Map((frozen.questions || []).map(q => [q.key, q]));
  const after = new Map((current.questions || []).map(q => [q.key, q]));

  const added = [...after.values()].filter(q => !before.has(q.key));
  const removed = [...before.values()].filter(q => !after.has(q.key));
  const reworded = [...after.values()].filter(q => {
    const was = before.get(q.key);
    return was && (was.prompt !== q.prompt || was.help !== q.help);
  });
  // A question that became required is as material as a new required one: the
  // applicant chose not to answer it under a rule that has since changed.
  const nowRequired = [...after.values()].filter(q => {
    const was = before.get(q.key);
    return was && !was.required && q.required;
  });
  const beforeMaterials = new Map((frozen.materials || []).map(m => [m.key, m]));
  const newRequiredMaterials = (current.materials || []).filter(m =>
    m.required && (!beforeMaterials.has(m.key) || !beforeMaterials.get(m.key).required));

  const material = added.some(q => q.required)
    || nowRequired.length > 0
    || removed.length > 0
    || newRequiredMaterials.length > 0;

  return {
    changed: true,
    material,
    current,
    added, removed, reworded,
    nowRequired,
    materials: newRequiredMaterials
  };
}

/**
 * Move a draft onto the current form, keeping every answer that still has a
 * question to belong to.
 *
 * Answers to a question that was removed are kept in `orphanedAnswers` rather
 * than deleted: the applicant wrote them, and quietly dropping somebody's
 * paragraph is exactly what rule four exists to prevent. Staff never see them
 * unless the applicant answers something they belong to again.
 */
function adoptForm(application, posting) {
  const drift = formDrift(application.form, posting);
  if (!drift.changed) return { application, drift };
  const keep = new Set((drift.current.questions || []).map(q => q.key));
  const orphaned = {};
  for (const [key, value] of Object.entries(application.answers.responses || {})) {
    if (!keep.has(key) && String(value || '').trim()) orphaned[key] = value;
  }
  if (Object.keys(orphaned).length) {
    application.orphanedAnswers = { ...(application.orphanedAnswers || {}), ...orphaned };
  }
  const responses = {};
  for (const key of keep) {
    if (application.answers.responses?.[key] !== undefined) {
      responses[key] = application.answers.responses[key];
    }
  }
  application.answers.responses = responses;
  application.form = drift.current;
  application.updatedAt = now();
  return { application, drift };
}

/* ------------------------------------------------------------------ *
 * Submission
 * ------------------------------------------------------------------ */

function missingFor(application) {
  const missing = [];
  const a = application.answers;
  if (!a.name.trim()) missing.push('Your name');
  if (!a.email.trim()) missing.push('A verified email address');
  for (const question of application.form.questions || []) {
    if (question.required && !String(a.responses?.[question.key] || '').trim()) {
      missing.push(question.prompt);
    }
  }
  for (const material of application.form.materials || []) {
    if (!material.required) continue;
    const attached = (application.files || []).some(f => f.materialKey === material.key);
    if (!attached) missing.push(material.label);
  }
  return missing;
}

function digestOf(application) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({
      name: application.answers.name,
      phone: application.answers.phone,
      location: application.answers.location,
      background: application.answers.background,
      responses: application.answers.responses,
      files: (application.files || []).map(f => f.sha256).sort()
    }))
    .digest('hex');
}

function referenceOf(application, at) {
  return crypto.createHash('sha256')
    .update([application.id, at, application.form.postingVersion].join('|'))
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();
}

function receiptOf(application) {
  const submitted = application?.submitted;
  if (!submitted) return null;
  return {
    reference: submitted.reference,
    submittedAt: submitted.at,
    timezone: submitted.timezone || null,
    postingVersion: submitted.postingVersion,
    materials: (submitted.files || []).map(f => ({ label: f.label, uploadedAt: f.uploadedAt })),
    version: submitted.version,
    // Said on the receipt itself, every time it is rendered, because the one
    // thing a receipt gets misread as is a hiring status.
    note: 'This confirms your application arrived. It is not a decision about it.'
  };
}

/**
 * Commit the application.
 *
 * Everything this touches is in memory; the caller persists once afterwards,
 * which is what makes the whole commit atomic against the store's write. A
 * retry, a double-click, or a lost response that the applicant sends again all
 * land in the duplicate branch and get the same receipt back rather than a
 * second application or an error that invites a third attempt.
 */
function submit(application, { posting, timezone, at = new Date() }) {
  const stamp = at.toISOString();
  const digest = digestOf(application);

  if (application.state === 'submitted') {
    // Same answers: this is a retry of a commit that already happened, and the
    // applicant never saw the response. Their work is safe, so say so.
    if (application.submitted.digest === digest) {
      return { duplicate: true, receipt: receiptOf(application) };
    }
    return {
      error: 'This application was already submitted, and what is on this page is different from what was received. '
        + 'Your submitted application is safe. Contact the search team if you need to correct it.',
      receipt: receiptOf(application)
    };
  }

  // Re-checked at commit, not only when the page was drawn. A posting can be
  // paused, closed, or past its deadline during the minutes somebody spends on
  // a review screen, and the honest answer is to keep their work and tell them
  // how to reach a person — never to claim a receipt that does not exist.
  if (!postings.acceptsApplications(posting, { at })) {
    return {
      closed: true,
      error: postings.pastDeadline(posting, at)
        ? 'This posting closed while you were completing your application. Nothing you wrote has been lost, and it has not been submitted. Use the contact below to reach the search team.'
        : 'This posting has stopped accepting applications. Nothing you wrote has been lost, and it has not been submitted. Use the contact below to reach the search team.'
    };
  }

  const drift = formDrift(application.form, posting);
  if (drift.material) {
    return {
      formChanged: true,
      drift: {
        added: drift.added.map(q => q.prompt),
        nowRequired: (drift.nowRequired || []).map(q => q.prompt),
        removed: drift.removed.map(q => q.prompt),
        materials: drift.materials.map(m => m.label)
      },
      error: 'This application form changed while you were completing it. Review what changed and confirm before submitting; nothing you have written has been lost.'
    };
  }

  const missing = missingFor(application);
  if (missing.length) {
    return { error: 'This application is not complete yet.', missing };
  }

  const version = (application.corrections?.length || 0) + 1;
  application.submitted = {
    at: stamp,
    version,
    reference: referenceOf(application, stamp),
    digest,
    timezone: timezone || null,
    postingVersion: application.form.postingVersion,
    // A frozen copy. The live fields stay where they are so a correction can
    // be built from them, but nothing after this point changes what arrived.
    form: JSON.parse(JSON.stringify(application.form)),
    answers: JSON.parse(JSON.stringify(application.answers)),
    files: JSON.parse(JSON.stringify(application.files || []))
  };
  application.state = 'submitted';
  application.updatedAt = stamp;
  // A submitted application is a record, not a draft. It stops expiring.
  delete application.expiresAt;
  return { receipt: receiptOf(application) };
}

/**
 * A staff-authorised correction.
 *
 * Follows the pattern the questionnaire reopening already uses: the original
 * is kept, a new version is created, and the reason is on the record. The
 * applicant edits and submits again; nothing is edited in place.
 */
function reopen(application, actor, reason) {
  if (application.state !== 'submitted') return { error: 'That application has not been submitted.' };
  application.corrections ||= [];
  application.corrections.push({
    at: now(),
    by: actor?.id || null,
    byName: actor?.name || null,
    reason: text(reason, 2000),
    // The whole submission as it stood. Nothing about the original is lost by
    // the applicant editing afterwards.
    submitted: application.submitted
  });
  application.state = 'draft';
  application.submitted = null;
  application.expiresAt = new Date(Date.now() + DRAFT_TTL_MS).toISOString();
  application.updatedAt = now();
  return { application };
}

/* ------------------------------------------------------------------ *
 * Reconciliation and acceptance
 * ------------------------------------------------------------------ */

/**
 * Candidates on this search who might already be this person.
 *
 * A review task, never an action. Slate does not merge records, does not
 * overwrite one, and does not reveal an existing candidate to the applicant
 * because somebody entered the same address — two people can share a family
 * mailbox, and an address is not proof of identity inside a search file.
 */
function possibleMatches(search, application) {
  const email = String(application.answers.email || '').toLowerCase();
  const name = String(application.answers.name || '').trim().toLowerCase();
  const out = [];
  for (const candidate of search.candidates || []) {
    const sameEmail = email && String(candidate.email || '').toLowerCase() === email;
    const sameName = name && String(candidate.name || '').trim().toLowerCase() === name;
    if (sameEmail || sameName) {
      out.push({
        id: candidate.id,
        name: candidate.name,
        stage: candidate.stage || null,
        on: sameEmail ? 'email' : 'name'
      });
    }
  }
  return out;
}

/**
 * Bring a submitted application onto the candidate list.
 *
 * The candidate record is built by the caller, which owns the shape of a
 * candidate; this only records the link and refuses to do it twice.
 */
function accept(application, candidateId, actor) {
  if (application.state !== 'submitted') return { error: 'Only a submitted application can be accepted.' };
  if (application.staff?.acceptedAt) return { error: 'This application is already on the candidate list.' };
  application.staff = {
    acceptedAt: now(),
    acceptedBy: actor?.id || null,
    acceptedByName: actor?.name || null,
    candidateId
  };
  application.updatedAt = now();
  return { application };
}

/* ------------------------------------------------------------------ *
 * Expiry
 * ------------------------------------------------------------------ */

/**
 * Drop drafts nobody came back to.
 *
 * Returns the ids whose files also have to be removed, because the bytes live
 * on disk rather than in the store and deleting the record alone would leave
 * somebody's resume behind with nothing pointing at it.
 */
function pruneDrafts(store, at = Date.now()) {
  ensureTables(store);
  const expired = store.applications.filter(a =>
    a.state === 'draft' && a.expiresAt && Date.parse(a.expiresAt) <= at);
  if (!expired.length) return { removed: 0, ids: [] };
  const ids = expired.map(a => a.id);
  const gone = new Set(ids);
  store.applications = store.applications.filter(a => !gone.has(a.id));
  return { removed: ids.length, ids };
}

/* ------------------------------------------------------------------ *
 * Projections
 * ------------------------------------------------------------------ */

/**
 * What the applicant sees of their own application.
 *
 * Their answers, their materials, their receipt. Nothing about the search,
 * the committee, staff, other applicants, or what anyone thinks of them —
 * none of which is in this record in the first place, which is the point of
 * keeping applications out of the search.
 */
function applicantView(application, { files }) {
  return {
    id: application.id,
    state: application.state,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
    expiresAt: application.expiresAt || null,
    form: application.form,
    answers: application.state === 'submitted' ? application.submitted.answers : application.answers,
    files: (application.state === 'submitted' ? application.submitted.files : application.files || [])
      .map(files.applicantView),
    receipt: receiptOf(application),
    missing: application.state === 'draft' ? missingFor(application) : [],
    corrections: (application.corrections || []).length,
    reopened: (application.corrections || []).length > 0 && application.state === 'draft'
      ? {
        at: application.corrections[application.corrections.length - 1].at,
        reason: application.corrections[application.corrections.length - 1].reason
      }
      : null
  };
}

/** The row staff see in the new-applications list. */
function staffRow(application, search) {
  const submitted = application.submitted;
  return {
    id: application.id,
    name: submitted.answers.name,
    email: submitted.answers.email,
    location: submitted.answers.location || null,
    submittedAt: submitted.at,
    reference: submitted.reference,
    version: submitted.version,
    corrections: (application.corrections || []).length,
    source: 'Public portal',
    postingVersion: submitted.postingVersion,
    materials: (submitted.files || []).length,
    complete: missingForSubmitted(application).length === 0,
    outstanding: missingForSubmitted(application),
    accepted: Boolean(application.staff?.acceptedAt),
    acceptedAt: application.staff?.acceptedAt || null,
    candidateId: application.staff?.candidateId || null,
    possibleMatches: application.staff?.acceptedAt ? [] : possibleMatches(search, application)
  };
}

// Completeness of what actually arrived, measured against the form it arrived
// under — not against a posting that has been edited since.
function missingForSubmitted(application) {
  const submitted = application.submitted;
  if (!submitted) return [];
  const missing = [];
  for (const material of submitted.form.materials || []) {
    if (!material.required) continue;
    if (!(submitted.files || []).some(f => f.materialKey === material.key)) missing.push(material.label);
  }
  return missing;
}

/** The whole submission, for a member of staff reading one application. */
function staffView(application, search, { files }) {
  const submitted = application.submitted;
  return {
    ...staffRow(application, search),
    background: submitted.answers.background || null,
    phone: submitted.answers.phone || null,
    form: submitted.form,
    responses: submitted.answers.responses || {},
    documents: (submitted.files || []).map(files.staffView),
    history: (application.corrections || []).map(correction => ({
      at: correction.at,
      byName: correction.byName,
      reason: correction.reason,
      reference: correction.submitted?.reference || null,
      submittedAt: correction.submitted?.at || null
    }))
  };
}

module.exports = {
  DRAFT_TTL_MS, LIMITS,
  ensureTables, byId, forApplicant, submittedFor, countsFor,
  freezeForm, start, validateDraft, saveDraft,
  formDrift, adoptForm, missingFor, missingForSubmitted,
  digestOf, referenceOf, receiptOf, submit, reopen,
  possibleMatches, accept, pruneDrafts,
  applicantView, staffRow, staffView
};
