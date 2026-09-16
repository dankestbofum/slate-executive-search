'use strict';

// The complete record of one search, for county records review.
//
// Two audiences: a machine-readable bundle that preserves timestamps, version
// relationships and provenance, and a readable report someone can understand
// without the application running. A records officer asked to classify these
// materials should not have to be given a login to read them.
//
// Three rules shape what comes out:
//
//  1. The export is not an alternate route to something the requester could
//     not already read. Sealed scores stay sealed. It is a different format
//     for the same authority, never a wider one.
//  2. Nothing that grants access travels with the record. Credential hashes,
//     sessions, invitation tokens and API keys are excluded, so a bundle
//     handed to counsel cannot be used to sign in as anyone or to open a
//     candidate's questionnaire.
//  3. What is missing is stated. External documents live in a repository this
//     app does not control, and saying so is part of a complete record.

const path = require('path');
const media = require('./media');
const jurisdictions = require('./jurisdictions');
const disposition = require('./disposition');

const FORMAT_VERSION = 1;

// Anything matching these never leaves the app, at any nesting depth.
const FORBIDDEN_KEYS = new Set(['pin', 'pinHash', 'invite', 'sessions', 'apiKey', 'token']);

/**
 * Remove access-granting fields wherever they appear.
 *
 * A deny-list is normally the weaker choice, but the shape here is a record
 * whose fields are known and whose omissions would be noticed. The test suite
 * asserts on the output, not on this list.
 */
function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    out[key] = scrub(item);
  }
  return out;
}

/**
 * Classify who or what produced an entry.
 *
 * A county reviewing a hiring decision needs to tell an authenticated
 * consultant's decision apart from a candidate's own submission and from
 * something the software did on its own. Entries written before actor ids were
 * recorded say so rather than being presented as attributed.
 */
function attribute(entry, lookupUser) {
  const id = entry?.by || null;
  const user = id ? lookupUser(id) : null;
  if (!id) {
    return {
      actorId: null,
      actorName: entry?.who || null,
      actorRole: null,
      attribution: 'name-only',
      note: 'Recorded before stable actor ids were kept. The name is as written at the time.'
    };
  }
  return {
    actorId: id,
    actorName: user?.name || entry.who || null,
    actorRole: user?.role || entry.role || null,
    // The shared firm sign-in is a real account, but it is not a person. Saying
    // so prevents the record from asserting an individual approved something.
    attribution: id === 'u0' ? 'shared-account' : 'account',
    note: id === 'u0'
      ? 'Taken under the shared firm sign-in. It identifies the firm, not an individual.'
      : undefined
  };
}

function candidateRecord(candidate, { includeContact, superseded = [] }) {
  const surveys = {};
  for (const key of ['survey1', 'survey2']) {
    const response = candidate[key];
    if (!response) continue;
    surveys[key] = {
      // The stored response names its own timestamp `at`, and keeps the frozen
      // copy of the questionnaire under `survey`. This read those as
      // `submittedAt` and `questions`, which are not fields the record has: the
      // export shipped answers with no questions beside them and no submission
      // date, which is the one thing this section exists to carry. Found by the
      // B09 rehearsal; the sealed-score declaration below was never affected.
      submittedAt: response.at || response.submittedAt || null,
      version: response.version ?? null,
      // The questions as they were asked, kept with the answers. An answer
      // without its question is not a record of anything.
      questions: response.survey?.questions || response.questions || null,
      profileRevision: response.profileRevision ?? null,
      criteria: response.criteria || null,
      answers: response.answers || null
      // `correctedAt` and `supersedes` used to sit here and were always null:
      // a response is never edited in place, so nothing ever set them. A
      // correction replaces the response and files the original in the search
      // history, which is what `supersededResponses` below carries. A field
      // that is always null implies a concept the record does not have.
    };
  }
  return {
    id: candidate.id,
    name: candidate.name,
    currentRole: candidate.cur || null,
    organization: candidate.org || null,
    yearsExperience: candidate.yrs ?? null,
    email: includeContact ? (candidate.email || null) : '[withheld]',
    stage: candidate.stage || null,
    addedAt: candidate.addedAt || null,
    referenceConsentAt: candidate.referenceConsentAt || null,
    referenceConsentBy: candidate.referenceConsentBy || null,
    responses: surveys,
    // The inventory of material held elsewhere, and the contact staff recorded
    // making. Both have been on the candidate since DEP-08; the export was
    // still describing them as future work and shipping neither.
    documents: (candidate.documents || []).map(doc => ({
      id: doc.id, kind: doc.kind, label: doc.label,
      // Where it is, never a way in. A repository link is a location; if it
      // carries a sharing credential it is scrubbed with everything else.
      location: doc.url || null,
      note: doc.note || '', receivedAt: doc.receivedAt || null,
      restricted: Boolean(doc.restricted),
      recordedBy: doc.recordedByName || null, recordedAt: doc.recordedAt || null
    })),
    communications: (candidate.communications || []).map(entry => ({
      id: entry.id, at: entry.at, channel: entry.channel, purpose: entry.purpose,
      summary: entry.summary, followUpOn: entry.followUpOn || null,
      actorName: entry.actorName || null, recordedAt: entry.recordedAt || null,
      evidence: entry.evidence, evidenceNote: entry.evidenceNote
    })),
    // Responses replaced when a questionnaire was reopened. The current answers
    // above are not the whole of what this person submitted, and a record that
    // showed only the latest would misrepresent a correction as an original.
    // The bodies live in the search history; they are repeated here so both the
    // bundle and the readable report carry them beside the person they concern.
    supersededResponses: superseded.map(entry => ({
      questionnaire: entry.key || null,
      submittedAt: entry.body?.at || null,
      replacedAt: entry.at || null,
      reason: entry.reason || null,
      reopenedBy: entry.who || null,
      version: entry.body?.version ?? null,
      questions: entry.body?.survey?.questions || null,
      answers: entry.body?.answers || null
    }))
  };
}

/**
 * Build the export.
 *
 * `viewer` decides what may be included, exactly as it does in the running
 * app. Callers must already have established that this person may edit the
 * search; this function enforces the narrower rules within that.
 */
function build(search, { viewer, users, dataDir, release }) {
  const lookupUser = id => (users || []).find(u => u.id === id) || null;
  const sealed = !search.released;

  const photos = search.artifacts?.brochure?.photos || {};
  const photoDir = dataDir ? path.join(dataDir, 'media', search.id) : null;

  const bundle = {
    format: {
      version: FORMAT_VERSION,
      generatedAt: new Date().toISOString(),
      generatedBy: { actorId: viewer?.id || null, actorName: viewer?.name || null },
      release: release || 'dev',
      // Said plainly, because a county may otherwise assume otherwise.
      audit: 'This is recoverable history kept by the application, not a tamper-evident audit log. '
        + 'Anyone with write access to the underlying store could alter it without leaving a trace here. '
        + 'If the county requires tamper-evident audit, that is separate infrastructure Slate does not provide.'
    },

    search: {
      id: search.id,
      number: search.no || null,
      client: search.client,
      jurisdictionType: search.jurisdictionType,
      position: search.position,
      state: search.state,
      formOfGovernment: search.fog,
      population: search.population,
      budget: search.budget,
      salary: search.salary,
      openedOn: search.opened,
      firstReview: search.firstReview,
      notes: search.notes,
      package: search.package,
      revision: search.revision,
      profileRevision: search.profileRevision,
      createdAt: search.createdAt,
      updatedAt: search.updatedAt,
      createdBy: attribute({ by: search.createdBy }, lookupUser)
    },

    // Which authority facts a person confirmed, with the source and the date
    // that source was current. This is the evidence for every material public
    // claim in the recruiting material.
    factVerification: jurisdictions.factStatus(search),

    // How the search concluded, and every outcome decision with its reason,
    // evidence and actor. Corrections appear as additional entries naming what
    // they supersede; nothing is rewritten.
    lifecycle: disposition.summary(search),
    dispositions: (search.candidates || []).map(c => ({
      candidateId: c.id,
      name: c.name,
      stage: c.stage || null,
      current: disposition.currentDisposition(c),
      history: c.dispositions || []
    })),

    // Where factual claims came from, so a reviewer can check them.
    sources: {
      website: search.website || null,
      research: search.research
        ? { at: search.research.at || null, model: search.research.model || null, sources: search.research.sources || [] }
        : null
    },

    committee: {
      roster: (search.members || []).map(member => {
        const user = lookupUser(member.userId);
        return {
          actorId: member.userId,
          name: user?.name || 'Removed account',
          role: user?.role || null,
          searchRole: member.searchRole,
          addedAt: member.addedAt,
          disabled: Boolean(user?.disabled)
        };
      }),
      confirmedAt: search.team?.confirmedAt || null,
      intake: {
        status: search.intake?.status || null,
        openedAt: search.intake?.openedAt || null,
        closedAt: search.intake?.closedAt || null,
        prompt: search.intake?.prompt || null,
        submissions: search.intake?.submissions || {}
      }
    },

    // The adopted criteria and the revision they belong to. Scores are only
    // meaningful against the profile version they were given under.
    profile: {
      revision: search.profileRevision,
      criteria: search.criteria || [],
      released: Boolean(search.released)
    },

    artifacts: Object.fromEntries(Object.entries(search.artifacts || {}).map(([key, body]) => [key, {
      body,
      approved: search.reviews?.[key] || null,
      staleReason: search.staleArtifacts?.[key] || null
    }])),

    candidates: (search.candidates || []).map(c => candidateRecord(c, {
      includeContact: true,
      superseded: (search.history || []).filter(h => h.kind === 'response' && h.candidateId === c.id)
    })),

    evaluation: sealed
      ? {
        sealed: true,
        // Withheld rather than omitted: a reader must know scoring exists.
        note: 'Scoring is sealed. Individual scores are not released to other reviewers yet, and the '
          + 'export does not bypass that. Release the scores in the application to include them, which '
          + 'is itself a recorded decision.',
        scorerCount: Object.keys(search.scores || {}).length
      }
      : {
        sealed: false,
        scores: search.scores || {},
        explanations: search.notesBy || {},
        scorers: Object.keys(search.scores || {}).map(id => attribute({ by: id }, lookupUser))
      },

    // The firm's own working record: sourcing calls, interviews, references.
    staffWork: Object.fromEntries(Object.entries(search.staff || {}).map(([key, record]) => [key, {
      log: record.log || [],
      notes: record.notes || '',
      completedAt: record.doneAt || null,
      completedBy: record.doneBy ? attribute({ by: record.doneBy, who: record.doneByName }, lookupUser) : null,
      access: 'restricted',
      accessNote: 'Reference and sourcing material is narrower than the rest of the record. It contains '
        + 'the firm\'s notes about people who may not have told their current employer they are looking.'
    }])),

    history: (search.history || []).map(entry => ({
      at: entry.at,
      kind: entry.kind,
      key: entry.key || null,
      actor: attribute(entry, lookupUser),
      body: entry.body ?? null,
      priorScores: entry.scores ?? undefined,
      priorNotes: entry.notesBy ?? undefined,
      priorCriteria: entry.criteria ?? undefined,
      // Which profile the marks were given against, so a scoring entry that
      // does not carry its own copy of the criteria can still be read against
      // the profile entry for the same revision.
      profileRevision: entry.revision ?? undefined,
      // A delta entry records what that one save replaced. A reader
      // reconstructing the full picture starts from the profile revision's
      // baseline and applies the deltas after it; an entry without this flag
      // carries the complete map as it stood.
      scope: entry.kind === 'scores' ? (entry.delta ? 'changed-only' : 'complete-snapshot') : undefined
    })),

    activity: (search.activity || []).map(entry => ({
      at: entry.at,
      what: entry.x,
      actor: attribute(entry, lookupUser)
    })),

    documents: {
      media: Object.entries(photos).map(([slot, url]) => ({
        slot,
        file: path.basename(String(url).split('?')[0]),
        present: photoDir ? media.present(photoDir, url) : null
      })),
      external: {
        note: 'Resumes, application materials and background check results are held in the county-approved '
          + 'external repository, not in Slate. They must be exported from that system to complete this '
          + 'record. Slate holds only the references recorded above.',
        // Every reference recorded against a candidate, gathered so a records
        // custodian can reconcile this file against the repository holding the
        // documents themselves without reading the whole bundle.
        references: (search.candidates || []).flatMap(c => (c.documents || []).map(doc => ({
          candidateId: c.id, candidateName: c.name,
          kind: doc.kind, label: doc.label, location: doc.url || null,
          receivedAt: doc.receivedAt || null, restricted: Boolean(doc.restricted)
        })))
      }
    },

    aiUsage: {
      totals: search.aiUsage || null,
      note: 'Token counts for drafting done on this search. Drafts are advisory; every published claim '
        + 'was reviewed by a person before approval.'
    },

    completeness: {
      // Named gaps, so the absence of a section is never read as an absence of
      // the underlying activity.
      missing: [
        sealed ? 'Individual scores and their explanations (sealed).' : null,
        'External documents held outside Slate (see documents.external).',
        'The documents themselves. Slate records what exists and where it is held, never the file.',
        'Delivery confirmation for candidate contact. Every entry is staff-recorded; Slate sends nothing.'
      ].filter(Boolean),
      unconfirmedFacts: jurisdictions.factStatus(search).outstanding
    }
  };

  return scrub(bundle);
}

/* ------------------------------------------------------------------ *
 * Readable report
 *
 * Plain text on purpose. It has to survive being emailed to a records officer,
 * printed, and read in ten years without this application existing.
 * ------------------------------------------------------------------ */
function report(bundle) {
  const lines = [];
  const rule = () => lines.push('='.repeat(72));
  const head = title => { lines.push(''); lines.push(title.toUpperCase()); lines.push('-'.repeat(title.length)); };
  const field = (label, value) => lines.push('  ' + String(label + ':').padEnd(24) + (value ?? '—'));

  rule();
  lines.push('SEARCH RECORD — ' + (bundle.search.client || 'Unnamed') + ' — ' + (bundle.search.position || ''));
  rule();
  field('Search number', bundle.search.number);
  field('Record generated', bundle.format.generatedAt);
  field('Generated by', bundle.format.generatedBy.actorName);
  field('Application release', bundle.format.release);
  field('Export format', 'version ' + bundle.format.version);
  lines.push('');
  lines.push('  ' + bundle.format.audit.replace(/(.{1,68})(\s|$)/g, '$1\n  ').trim());

  head('Search facts');
  field('Client', bundle.search.client);
  field('Jurisdiction type', bundle.search.jurisdictionType);
  field('Position', bundle.search.position);
  field('State', bundle.search.state);
  field('Form of government', bundle.search.formOfGovernment);
  field('Population', bundle.search.population);
  field('Budget', bundle.search.budget);
  field('Salary', bundle.search.salary);
  field('Opened', bundle.search.openedOn);
  field('Service package', bundle.search.package);
  field('Revision', bundle.search.revision);
  field('Opened by', bundle.search.createdBy.actorName + ' (' + bundle.search.createdBy.attribution + ')');

  head('Sources');
  field('Official website', bundle.sources.website);
  for (const source of bundle.sources.research?.sources || []) lines.push('  - ' + (source.url || source));
  if (!(bundle.sources.research?.sources || []).length) lines.push('  No recorded research sources.');

  head('Committee');
  for (const member of bundle.committee.roster) {
    lines.push('  ' + member.searchRole.padEnd(10) + member.name + ' [' + member.actorId + ']'
      + (member.disabled ? ' (account disabled)' : ''));
  }
  field('Intake status', bundle.committee.intake.status);
  field('Intake closed', bundle.committee.intake.closedAt);

  head('Adopted candidate profile (revision ' + bundle.profile.revision + ')');
  for (const criterion of bundle.profile.criteria) {
    lines.push('  [' + criterion.id + '] ' + criterion.kind.padEnd(6) + ' w' + (criterion.weight ?? '—') + '  ' + criterion.label);
    if (criterion.note) lines.push('        ' + criterion.note);
  }
  if (!bundle.profile.criteria.length) lines.push('  No criteria adopted.');

  head('Candidates');
  // One shape for a submitted response, used for the current answers and for
  // any the reader has to be able to compare them against.
  const answered = response => {
    for (const question of response.questions || []) {
      lines.push('      Q' + question.n + '. ' + question.prompt);
      lines.push('      A. ' + String(response.answers?.['q' + question.n] || '(no answer)').replace(/\n/g, '\n         '));
    }
    if (!(response.questions || []).length) {
      lines.push('      The questions as asked were not kept with this response.');
    }
  };
  for (const candidate of bundle.candidates) {
    lines.push('  ' + candidate.name + ' [' + candidate.id + '] — ' + (candidate.stage || 'no stage'));
    field('    Organization', candidate.organization);
    field('    Reference consent', candidate.referenceConsentAt);
    for (const [key, response] of Object.entries(candidate.responses)) {
      lines.push('    ' + key + ' submitted ' + (response.submittedAt || 'not submitted')
        + (response.version != null ? ' (question version ' + response.version + ')' : ''));
      answered(response);
    }
    for (const doc of candidate.documents || []) {
      lines.push('    document  ' + doc.kind.padEnd(12) + doc.label
        + (doc.restricted ? '  [restricted]' : '')
        + (doc.location ? '\n      Held at: ' + doc.location : '\n      No location recorded.'));
    }
    for (const entry of candidate.communications || []) {
      lines.push('    contact   ' + String(entry.at).slice(0, 10) + '  ' + entry.channel + ' · ' + entry.purpose
        + (entry.actorName ? ' · ' + entry.actorName : '') + '  [staff-recorded, delivery not confirmed]');
      lines.push('      ' + entry.summary.replace(/\n/g, '\n      '));
    }
    for (const prior of candidate.supersededResponses || []) {
      lines.push('    ' + (prior.questionnaire || 'response') + ' SUPERSEDED — submitted '
        + (prior.submittedAt || 'unknown') + ', replaced ' + (prior.replacedAt || 'unknown')
        + (prior.reopenedBy ? ' by ' + prior.reopenedBy : ''));
      if (prior.reason) lines.push('      Reopened because: ' + prior.reason);
      answered(prior);
    }
  }
  if (!bundle.candidates.length) lines.push('  No candidates recorded.');

  // Outcomes and the lifecycle were in the bundle but never in the readable
  // report, which is the copy a records officer is actually handed: it said who
  // applied and what they answered, and nothing about what was decided. Every
  // decision is printed with its reason, its job-related basis, its author, and
  // — for a correction — the entry it supersedes, which stays above it.
  head('Outcomes');
  for (const person of bundle.dispositions) {
    if (!person.history.length) {
      lines.push('  ' + person.name + ' [' + person.candidateId + '] — no outcome recorded (' + (person.stage || 'no stage') + ')');
      continue;
    }
    lines.push('  ' + person.name + ' [' + person.candidateId + ']');
    for (const entry of person.history) {
      lines.push('    ' + String(entry.at).slice(0, 10) + '  ' + entry.outcome.toUpperCase()
        + (entry.supersedes ? '  (corrects ' + entry.supersedes + ')' : '')
        + '  ' + (entry.actorName || 'unattributed') + ' [' + (entry.actorId || 'no id') + ']'
        + (entry.source === 'staff-recorded-from-candidate' ? '  [reported by the candidate, recorded by staff]' : ''));
      lines.push('      Reason:   ' + entry.reason.replace(/\n/g, '\n                '));
      if (entry.evidence) lines.push('      Evidence: ' + entry.evidence.replace(/\n/g, '\n                '));
    }
  }
  if (!bundle.dispositions.length) lines.push('  No candidates on the file.');

  head('Lifecycle');
  field('Status', bundle.lifecycle.status);
  field('Concluded', bundle.lifecycle.closedAt);
  field('Most recent reason', bundle.lifecycle.reason);
  field('Times reopened', bundle.lifecycle.reopenCount);
  if (bundle.lifecycle.undecided.length) {
    lines.push('  Still undecided when this record was taken: '
      + bundle.lifecycle.undecided.map(p => p.name).join(', '));
  }

  head('Evaluation');
  if (bundle.evaluation.sealed) {
    lines.push('  SEALED — not included in this export.');
    lines.push('  ' + bundle.evaluation.note.replace(/(.{1,68})(\s|$)/g, '$1\n  ').trim());
    field('Reviewers who scored', bundle.evaluation.scorerCount);
  } else {
    for (const scorer of bundle.evaluation.scorers) {
      lines.push('  Scored by ' + scorer.actorName + ' [' + (scorer.actorId || 'unattributed') + ']');
    }
  }

  head('Decision history');
  for (const entry of bundle.history) {
    lines.push('  ' + entry.at + '  ' + String(entry.kind).padEnd(9)
      + (entry.actor.actorName || 'unknown') + ' [' + (entry.actor.actorId || 'no id') + ']'
      + (entry.actor.attribution === 'name-only' ? ' (name only)' : '')
      + (entry.actor.attribution === 'shared-account' ? ' (shared account)' : ''));
  }
  if (!bundle.history.length) lines.push('  No recorded revisions.');

  head('Documents');
  for (const item of bundle.documents.media) {
    lines.push('  ' + item.slot.padEnd(8) + item.file + (item.present === false ? '  [FILE MISSING]' : ''));
  }
  lines.push('');
  lines.push('  ' + bundle.documents.external.note.replace(/(.{1,68})(\s|$)/g, '$1\n  ').trim());
  lines.push('');
  lines.push('  External inventory — what is held elsewhere, and where:');
  for (const item of bundle.documents.external.references) {
    lines.push('  - ' + item.candidateName + ' · ' + item.kind + ' · ' + item.label
      + (item.restricted ? ' [restricted]' : '')
      + (item.location ? '\n      ' + item.location : '\n      No location recorded.'));
  }
  if (!bundle.documents.external.references.length) {
    lines.push('  - Nothing recorded. If material exists outside Slate, this file does not name it.');
  }

  head('Known gaps in this record');
  for (const gap of bundle.completeness.missing) lines.push('  - ' + gap);

  lines.push('');
  rule();
  lines.push('End of record for ' + bundle.search.id);
  rule();
  return lines.join('\n') + '\n';
}

module.exports = { build, report, scrub, attribute, FORMAT_VERSION, FORBIDDEN_KEYS };
