'use strict';

/**
 * Public job postings.
 *
 * A posting is modelled separately from the search it advertises, and
 * deliberately so. A search is the firm's working file: research changes, ads
 * get redrafted, facts are corrected all week. None of that may reach a page
 * members of the public are reading. So publishing takes a *snapshot* of
 * approved fields, and the live page serves that snapshot until somebody
 * publishes a new one.
 *
 * Three rules hold this together, and every function below exists to enforce
 * one of them:
 *
 *  1. Nothing is public until a search manager publishes it. There is no
 *     default-public state, and the migration leaves every existing search
 *     unpublished.
 *  2. The public projection is an allowlist. `publicView()` names every field
 *     it emits. Serializing a search and deleting the private parts afterwards
 *     is how a field added next year becomes a leak, so it is not done here.
 *  3. Posting state and search state are separate. Closing recruitment stops
 *     new applications while staff carry on evaluating; closing or archiving
 *     the search stops intake regardless, and restoring it republishes
 *     nothing.
 */

const crypto = require('crypto');

const STATES = ['draft', 'published', 'paused', 'closed'];

// What each state means to somebody reading the job page, in the words the
// portal uses. Held here so the client and the server say the same thing.
const STATE_PUBLIC = {
  draft: null,
  published: 'Accepting applications',
  paused: 'Not accepting applications right now',
  closed: 'Closed to new applications'
};

const DEADLINE_KINDS = ['hard', 'open'];

// A posting is text, and text has to be bounded or a single record can grow
// until the store is unusable. These are generous for real postings and
// nowhere near enough to be a denial of service.
const LIMITS = {
  title: 160, employer: 160, location: 160, compensation: 400,
  summary: 4000, responsibilities: 8000, qualifications: 8000,
  applicationInstructions: 4000, privacyNotice: 6000,
  supportEmail: 200, supportPhone: 60, supportHours: 200,
  question: 500, questionHelp: 500, materialLabel: 120, materialNote: 400,
  questions: 20, materials: 10
};

function now() { return new Date().toISOString(); }

function text(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

/**
 * The URL segment a posting is reached by.
 *
 * Derived from the title but never *only* from it: two "City Manager" postings
 * in one firm would collide, and a collision on a public address is somebody's
 * application going to the wrong job. The random tail makes it unique without
 * needing a uniqueness scan, and it is stable once assigned.
 */
function slugify(value, fallback = 'position') {
  const base = String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return (base || fallback) + '-' + crypto.randomBytes(3).toString('hex');
}

/**
 * The firm's own public segment.
 *
 * Organizations get one the first time one of their postings is published, so
 * a workspace that never advertises never acquires a public identity at all.
 */
function firmSlug(organization) {
  if (!organization) return null;
  if (organization.publicSlug) return organization.publicSlug;
  organization.publicSlug = slugify(organization.name, 'firm');
  return organization.publicSlug;
}

/** The empty posting a search starts with. Unpublished, with nothing approved. */
function blank() {
  return {
    state: 'draft',
    slug: null,
    version: 0,
    createdAt: now(),
    updatedAt: now(),
    // What staff are editing. Never served to the public.
    draft: {
      title: '', employer: '', location: '', compensation: '',
      summary: '', responsibilities: '', qualifications: '',
      applicationInstructions: '', privacyNotice: '',
      supportEmail: '', supportPhone: '', supportHours: '',
      deadline: { kind: 'open', closesAt: '', firstReviewOn: '', timezone: '' },
      questions: [],
      materials: []
    },
    // The snapshot the public reads. Null until somebody publishes.
    published: null,
    // One line per state change, so "who published this, and when" is a
    // question the record answers rather than one the activity log approximates.
    log: []
  };
}

/**
 * The posting to write to, created on the search if it has none.
 *
 * Only for a request that is already changing the search. A read must use
 * `of()` instead: server/integrity.js compares the whole record against the
 * copy taken at the last save and bumps the revision when they differ, so a
 * GET that quietly attached a field here would invalidate the revision the
 * client is holding and turn somebody's next save into a spurious conflict.
 */
function ensure(search) {
  if (!search.posting || typeof search.posting !== 'object') search.posting = blank();
  search.posting.draft ||= blank().draft;
  search.posting.log ||= [];
  return search.posting;
}

/**
 * The posting to read, without touching the search.
 *
 * A search written before postings existed, or one created by a code path that
 * has not been updated, reads as an empty unpublished posting rather than as a
 * missing field every caller has to guard against.
 */
function of(search) {
  const posting = search?.posting;
  if (!posting || typeof posting !== 'object') return blank();
  if (!posting.draft || !posting.log) return { ...blank(), ...posting, draft: posting.draft || blank().draft, log: posting.log || [] };
  return posting;
}

/* ------------------------------------------------------------------ *
 * Validation
 *
 * Two levels, because they answer different questions. `validateDraft` asks
 * "is this storable" and is forgiving: staff save half-finished postings all
 * day. `readinessOf` asks "may this be published", and is not.
 * ------------------------------------------------------------------ */

function validateDraft(body) {
  if (!body || typeof body !== 'object') return 'Provide the posting details.';

  const deadline = body.deadline;
  if (deadline !== undefined) {
    if (!deadline || typeof deadline !== 'object') return 'Provide a deadline policy.';
    if (!DEADLINE_KINDS.includes(String(deadline.kind))) {
      return 'Choose a closing date or open until filled.';
    }
    for (const field of ['closesAt', 'firstReviewOn']) {
      const value = String(deadline[field] || '').trim();
      if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Dates look like 2026-11-30.';
    }
  }

  if (body.questions !== undefined) {
    if (!Array.isArray(body.questions)) return 'Provide the application questions as a list.';
    if (body.questions.length > LIMITS.questions) return 'A posting can ask at most ' + LIMITS.questions + ' questions.';
    for (const question of body.questions) {
      if (!question || typeof question !== 'object') return 'Each question needs a prompt.';
      if (!String(question.prompt || '').trim()) return 'Each question needs a prompt.';
    }
  }

  if (body.materials !== undefined) {
    if (!Array.isArray(body.materials)) return 'Provide the required materials as a list.';
    if (body.materials.length > LIMITS.materials) return 'A posting can require at most ' + LIMITS.materials + ' materials.';
    for (const material of body.materials) {
      if (!material || typeof material !== 'object') return 'Each material needs a label.';
      if (!String(material.label || '').trim()) return 'Each material needs a label.';
    }
  }
  return null;
}

/** Normalise a submitted draft into exactly the fields a posting holds. */
function applyDraft(posting, body) {
  const draft = posting.draft;
  const set = (key, max) => {
    if (body[key] !== undefined) draft[key] = text(body[key], max);
  };
  set('title', LIMITS.title);
  set('employer', LIMITS.employer);
  set('location', LIMITS.location);
  set('compensation', LIMITS.compensation);
  set('summary', LIMITS.summary);
  set('responsibilities', LIMITS.responsibilities);
  set('qualifications', LIMITS.qualifications);
  set('applicationInstructions', LIMITS.applicationInstructions);
  set('privacyNotice', LIMITS.privacyNotice);
  set('supportEmail', LIMITS.supportEmail);
  set('supportPhone', LIMITS.supportPhone);
  set('supportHours', LIMITS.supportHours);

  if (body.deadline !== undefined) {
    const kind = String(body.deadline.kind);
    draft.deadline = {
      kind,
      // Only the field the chosen policy uses is kept. Storing both is how an
      // advisory review date ends up enforced as a cutoff by a later change.
      closesAt: kind === 'hard' ? text(body.deadline.closesAt, 10) : '',
      firstReviewOn: kind === 'open' ? text(body.deadline.firstReviewOn, 10) : '',
      timezone: text(body.deadline.timezone, 60)
    };
  }

  if (body.questions !== undefined) {
    // A stable identity that survives rewording and reordering. Applicants'
    // answers are stored against it, so a half-finished application still
    // lines up with the form after staff tidy up a prompt or move a question.
    //
    // A caller that sends the key back keeps it. One that does not — a script,
    // an older client, somebody posting the fields by hand — falls back to
    // matching on the prompt, because losing an applicant's paragraph because
    // a request omitted a field they have never heard of is not an acceptable
    // way to fail. Only a genuinely new question gets a new key.
    const byKey = new Map((draft.questions || []).map(q => [q.key, q]));
    const byPrompt = new Map((draft.questions || []).map(q => [q.prompt, q.key]));
    // A key is handed out once. Two questions with the same wording are two
    // questions, and giving them one key would merge two people's answers.
    const used = new Set();
    draft.questions = body.questions.slice(0, LIMITS.questions).map((question, index) => {
      const prompt = text(question.prompt, LIMITS.question);
      const given = String(question.key || '');
      let key = byKey.has(given) && !used.has(given) ? given : null;
      if (!key) {
        const matched = byPrompt.get(prompt);
        key = matched && !used.has(matched) ? matched : 'q-' + crypto.randomBytes(4).toString('hex');
      }
      used.add(key);
      return {
        key,
        n: index + 1,
        prompt,
        help: text(question.help, LIMITS.questionHelp),
        required: Boolean(question.required)
      };
    });
  }

  if (body.materials !== undefined) {
    draft.materials = body.materials.slice(0, LIMITS.materials).map((material, index) => ({
      key: text(material.key, 40) || 'material-' + (index + 1),
      label: text(material.label, LIMITS.materialLabel),
      note: text(material.note, LIMITS.materialNote),
      required: Boolean(material.required)
    }));
  }

  posting.updatedAt = now();
  return draft;
}

/**
 * What a posting still needs before it may go public.
 *
 * Returned as a list rather than a boolean so the screen can say what is
 * missing. Every entry here is something an applicant needs in order to decide
 * whether to apply, or something the firm needs to have said before collecting
 * somebody's personal information.
 */
const REQUIRED = [
  ['title', 'A position title'],
  ['employer', 'The employer or jurisdiction'],
  ['location', 'Where the position is'],
  ['summary', 'A short description of the position'],
  ['qualifications', 'The qualifications applicants are measured against'],
  ['applicationInstructions', 'What applicants have to provide'],
  ['privacyNotice', 'An approved privacy notice']
];

function readinessOf(posting) {
  const draft = posting.draft || {};
  const missing = [];
  for (const [field, label] of REQUIRED) {
    if (!String(draft[field] || '').trim()) missing.push(label);
  }
  // Somebody who cannot complete the application, or who needs an
  // accommodation, must have a person to reach. A posting without one is a
  // dead end published at people.
  if (!String(draft.supportEmail || '').trim() && !String(draft.supportPhone || '').trim()) {
    missing.push('A support contact applicants can reach');
  }
  const deadline = draft.deadline || {};
  if (deadline.kind === 'hard' && !deadline.closesAt) missing.push('A closing date, or open until filled instead');
  if (!String(deadline.timezone || '').trim()) missing.push('The timezone the dates are stated in');
  return { ready: missing.length === 0, missing };
}

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

function record(posting, action, actor, detail = {}) {
  posting.log.push({
    at: now(), action,
    by: actor?.id || null, byName: actor?.name || null,
    ...detail
  });
  posting.updatedAt = now();
}

/**
 * Publish, or republish, the current draft.
 *
 * The snapshot is a deep copy taken now. Editing the draft afterwards changes
 * nothing that the public can see until this runs again, which is the whole
 * contract the rest of the file depends on.
 */
function publish(search, organization, actor) {
  const posting = ensure(search);
  const readiness = readinessOf(posting);
  if (!readiness.ready) {
    return { error: 'This posting is not ready to publish.', missing: readiness.missing };
  }
  posting.slug ||= slugify(posting.draft.title);
  posting.version += 1;
  posting.published = {
    version: posting.version,
    at: now(),
    by: actor?.id || null,
    byName: actor?.name || null,
    firmSlug: firmSlug(organization),
    fields: JSON.parse(JSON.stringify(posting.draft))
  };
  posting.state = 'published';
  record(posting, posting.version === 1 ? 'published' : 'republished', actor, { version: posting.version });
  return { posting };
}

/**
 * Move a published posting between accepting, paused, and closed.
 *
 * A posting that has never been published cannot be paused or closed: there is
 * nothing out there to pause. Reopening from `closed` to `published` is
 * allowed and recorded, because a deadline extended by a client is an ordinary
 * event and refusing it would only push staff into republishing under a new
 * address that the advertisements do not name.
 */
function setState(search, next, actor) {
  const posting = ensure(search);
  if (!STATES.includes(next)) return { error: 'Unknown posting state.' };
  if (next === 'draft') return { error: 'A posting cannot be returned to draft once it has been published. Close it instead.' };
  if (!posting.published) return { error: 'Publish this posting before changing whether it accepts applications.' };
  if (posting.state === next) return { posting };
  posting.state = next;
  record(posting, next, actor);
  return { posting };
}

/**
 * Take a posting out of intake because the search's lifecycle moved.
 *
 * Visibility is derived — `isLive` asks whether the search is frozen or
 * archived — which is right while it stays that way and wrong the moment it
 * stops. A closed search hides its posting; reopening the search would have
 * handed the withdrawn advertisement straight back to the public and started
 * accepting applications again, with nobody having decided to publish
 * anything. The same was true of restoring an archive.
 *
 * So the state is written down rather than inferred. The posting drops to
 * `closed`: the page a candidate has a link to still answers and says it is
 * closed to new applications, rather than becoming a 404 that implies the job
 * never existed, and returning it to `published` is the search manager's
 * deliberate act under the `publishPosting` authority. This is the same
 * reasoning that revokes candidate links at closeout and refuses to reissue
 * them on restore.
 */
function suspendForLifecycle(search, actor, reason) {
  const posting = search?.posting;
  if (!posting?.published) return false;
  if (posting.state === 'closed') return false;
  posting.state = 'closed';
  record(posting, 'closed', actor, { reason });
  return true;
}

/**
 * Whether the posting is reachable by the public at all.
 *
 * Search lifecycle wins over posting state, in both directions that matter: a
 * closed, cancelled, or archived search is not advertising anything, whatever
 * its posting last said. This is why the caller passes the lifecycle in rather
 * than the posting deciding for itself from a field it does not own.
 */
function isLive(posting, { searchFrozen = false, archived = false } = {}) {
  if (!posting?.published) return false;
  if (archived || searchFrozen) return false;
  return posting.state === 'published' || posting.state === 'paused' || posting.state === 'closed';
}

/** Whether a new application may be started or submitted against it. */
function acceptsApplications(posting, { searchFrozen = false, archived = false, at = new Date() } = {}) {
  if (!isLive(posting, { searchFrozen, archived })) return false;
  if (posting.state !== 'published') return false;
  return !pastDeadline(posting, at);
}

/**
 * Has a hard closing date passed?
 *
 * Only a hard deadline closes anything. An advisory first-review date is
 * displayed and never enforced — the existing semifinalist questionnaire makes
 * the same promise, and a date that quietly becomes a cutoff is the failure
 * mode this guards against.
 *
 * The comparison is to the end of the stated day. A closing date of the 30th
 * means applications are taken on the 30th, which is what an applicant reading
 * it will assume.
 */
function pastDeadline(posting, at = new Date()) {
  const deadline = posting?.published?.fields?.deadline;
  if (!deadline || deadline.kind !== 'hard' || !deadline.closesAt) return false;
  const end = Date.parse(deadline.closesAt + 'T23:59:59.999Z');
  if (!Number.isFinite(end)) return false;
  return at.getTime() > end;
}

/* ------------------------------------------------------------------ *
 * The public projection
 *
 * Everything below this line can be read by anybody on the internet. It is
 * built field by field from the published snapshot. It never takes a search,
 * a candidate, a member, or a draft as an argument, so there is nothing
 * private in scope to leak by accident.
 * ------------------------------------------------------------------ */

function publicSummary(posting, { searchFrozen = false, archived = false } = {}) {
  if (!isLive(posting, { searchFrozen, archived })) return null;
  const f = posting.published.fields;
  return {
    firmSlug: posting.published.firmSlug,
    slug: posting.slug,
    title: f.title,
    employer: f.employer,
    location: f.location,
    state: posting.state,
    stateLabel: STATE_PUBLIC[posting.state],
    accepting: posting.state === 'published' && !pastDeadline(posting),
    closesAt: f.deadline.kind === 'hard' ? f.deadline.closesAt : null,
    firstReviewOn: f.deadline.kind === 'open' ? (f.deadline.firstReviewOn || null) : null,
    timezone: f.deadline.timezone || null,
    publishedAt: posting.published.at
  };
}

function publicView(posting, { searchFrozen = false, archived = false } = {}) {
  const summary = publicSummary(posting, { searchFrozen, archived });
  if (!summary) return null;
  const f = posting.published.fields;
  return {
    ...summary,
    version: posting.published.version,
    compensation: f.compensation || null,
    summaryText: f.summary,
    responsibilities: f.responsibilities,
    qualifications: f.qualifications,
    applicationInstructions: f.applicationInstructions,
    privacyNotice: f.privacyNotice,
    deadline: {
      kind: f.deadline.kind,
      closesAt: f.deadline.kind === 'hard' ? f.deadline.closesAt : null,
      firstReviewOn: f.deadline.kind === 'open' ? (f.deadline.firstReviewOn || null) : null,
      timezone: f.deadline.timezone || null,
      // Said rather than left to be inferred, exactly as the existing
      // semifinalist questionnaire says it.
      enforced: f.deadline.kind === 'hard',
      note: f.deadline.kind === 'hard'
        ? 'Applications close at the end of this date. After that this page stops accepting them.'
        : 'This position is open until filled. Any review date shown is when the search team plans to begin reading applications; it does not close them.'
    },
    support: {
      email: f.supportEmail || null,
      phone: f.supportPhone || null,
      hours: f.supportHours || null,
      configured: Boolean(f.supportEmail || f.supportPhone)
    },
    materials: (f.materials || []).map(m => ({
      key: m.key, label: m.label, note: m.note, required: m.required
    })),
    questions: (f.questions || []).map(q => ({
      key: q.key, n: q.n, prompt: q.prompt, help: q.help, required: q.required
    }))
  };
}

/**
 * What the staff screen shows: the draft, the live snapshot, and the state.
 *
 * Separate from `publicView` on purpose. Two functions that cannot be confused
 * for each other is worth more than the handful of lines they share.
 */
function staffView(posting, { searchFrozen = false, publicBase = '' } = {}) {
  const readiness = readinessOf(posting);
  const live = isLive(posting, { searchFrozen });
  return {
    state: posting.state,
    slug: posting.slug,
    version: posting.version,
    draft: posting.draft,
    readiness,
    published: posting.published
      ? {
        version: posting.published.version,
        at: posting.published.at,
        byName: posting.published.byName,
        fields: posting.published.fields
      }
      : null,
    live,
    accepting: acceptsApplications(posting, { searchFrozen }),
    // Empty until published, because there is no address before then and
    // showing a guess would have somebody advertising a 404.
    publicUrl: posting.published && posting.published.firmSlug && posting.slug
      ? publicBase + '/careers/' + posting.published.firmSlug + '/' + posting.slug
      : null,
    frozenBySearch: searchFrozen && Boolean(posting.published),
    log: posting.log.slice(-40).reverse(),
    // What the draft would change if it were published now. A published
    // posting whose draft has moved on is the state most likely to surprise
    // somebody, so it is named rather than implied.
    unpublishedChanges: Boolean(posting.published)
      && JSON.stringify(posting.draft) !== JSON.stringify(posting.published.fields)
  };
}

module.exports = {
  STATES, STATE_PUBLIC, DEADLINE_KINDS, LIMITS, REQUIRED,
  blank, ensure, of, slugify, firmSlug,
  validateDraft, applyDraft, readinessOf,
  publish, setState, suspendForLifecycle, isLive, acceptsApplications, pastDeadline,
  publicSummary, publicView, staffView
};
