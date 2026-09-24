'use strict';

/**
 * Search committee intake and consensus.
 *
 * Step 2 asks everyone on the search what they are looking for in the executive,
 * privately and in their own words. This module turns those independent
 * submissions into one ranked matrix the consultant can adopt as the Step 3
 * candidate profile. Nothing here writes; callers decide what to keep.
 */

const crypto = require('crypto');
const questionnaire = require('../content/committee-questionnaire');

const KINDS = ['skill', 'trait', 'chall', 'opp'];
const KIND_LABEL = {
  skill: 'Essential skills',
  trait: 'Leadership and personality traits',
  chall: 'Current challenges',
  opp: 'Future opportunities'
};
const PREFIX = { skill: 'S', trait: 'T', chall: 'C', opp: 'O' };

// A profile kind holds 3 to 5 items. Consensus never proposes more than the
// ceiling, so adopting cannot push the profile out of range on its own.
const KIND_CAP = 5;
const KIND_FLOOR = 3;

const SEARCH_ROLES = ['manager', 'consultant', 'committee'];
const SEARCH_ROLE_LABEL = {
  manager: 'Account manager',
  consultant: 'Consultant',
  committee: 'Committee member'
};

// Everyone on the search is asked to fill out intake, including the
// consultants: their read on the job is part of the record the profile is
// built from.
const INTAKE_ROLES = new Set(['manager', 'consultant', 'committee']);

function clampWeight(w){
  const n = (w === '' || w === null || w === undefined) ? 3 : Number(w);
  return Math.max(1, Math.min(5, Number.isFinite(n) ? n : 3));
}

function searchRoleOf(searchRole){
  return SEARCH_ROLES.includes(searchRole) ? searchRole : 'committee';
}

// Two members typing "Financial management" and "financial management." are
// naming the same thing. Fold case, punctuation, and the filler words people
// add when they are writing fast, so the counts reflect agreement rather than
// typing style.
function normLabel(label){
  return String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(the|a|an|and|of|for|in|to|with|strong|good|great|solid|proven|excellent)\b/g, ' ')
    .replace(/\b(skills?|abilities|ability|experience)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * One identity for a named priority, used everywhere.
 *
 * "Strong" and "Good" both normalize to nothing, so the fallback to the raw
 * label is what keeps them apart. Grouping used the fallback and criterion-ID
 * reuse did not, which let two different priorities claim the same criterion
 * ID (CA-07). Everything that asks "is this the same thing" asks here.
 */
function groupKey(kind, label){
  return kind + ':' + (normLabel(label) || String(label || '').trim().toLowerCase());
}

function cleanItems(items){
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(items) ? items : []) {
    if (!raw) continue;
    const kind = KINDS.includes(raw.kind) ? raw.kind : 'skill';
    const label = String(raw.label || '').trim();
    if (!label) continue;
    const key = groupKey(kind, label);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind,
      label,
      weight: clampWeight(raw.weight),
      note: String(raw.note || '').trim().slice(0, 600)
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The response record
 *
 * A member's working copy and their committed answer are two different
 * things. Saving a draft used to overwrite the submission, which quietly took
 * the member out of the tally (CA-04); the tally, the AI input, and everything
 * the rest of the committee reads now come from `submitted` alone, and `draft`
 * never leaves its author.
 * ------------------------------------------------------------------ */

function emptyResponse(){
  return { revision: 1, draft: null, submitted: null };
}

function responsesOf(search){
  return (search.intake && search.intake.responses) || {};
}

function responseFor(search, userId){
  return responsesOf(search)[userId] || null;
}

/** The answer itself, without the draft/submitted bookkeeping around it. */
function normalizeAnswer(body, prev, now){
  return {
    items: cleanItems(body && body.items),
    mustHave: String((body && body.mustHave) || '').trim().slice(0, 2000),
    dealBreaker: String((body && body.dealBreaker) || '').trim().slice(0, 2000),
    context: String((body && body.context) || '').trim().slice(0, 2000),
    at: (prev && prev.at) || now,
    updatedAt: now
  };
}

function membersForIntake(search){
  return (search.members || []).filter(m => INTAKE_ROLES.has(searchRoleOf(m.searchRole)));
}

// Only committed answers feed consensus. A half-filled draft would drag the
// denominator down and make real agreement look weaker than it is.
function finishedSubmissions(search){
  const responses = responsesOf(search);
  const asked = new Set(membersForIntake(search).map(m => m.userId));
  return Object.entries(responses)
    .filter(([uid, r]) => r && r.submitted && asked.has(uid))
    .map(([uid, r]) => ({ userId: uid, ...r.submitted }));
}

/**
 * What one viewer may read of everybody's intake.
 *
 * Returns only permitted fields rather than spreading the stored record and
 * deleting from it, so a field added later is withheld until somebody decides
 * it should be shared (CA-01).
 *
 * - The author always reads their own draft and their own submission.
 * - Workspace staff read committed answers while the window is open, because
 *   they facilitate; that is the same material the running tally already shows
 *   them, and the interface says so.
 * - Everybody else on the search reads committed answers once the window is
 *   closed, and never reads anybody else's draft.
 */
function visibleResponses(search, viewer){
  const { userId = null, staff = false, member = false } = viewer || {};
  const closed = (search.intake || {}).status === 'closed';
  const out = {};
  for (const [uid, record] of Object.entries(responsesOf(search))) {
    if (!record) continue;
    const mine = uid === userId;
    const mayReadSubmitted = mine || staff || (member && closed);
    if (!mayReadSubmitted) continue;
    const view = { revision: record.revision || 1, submitted: record.submitted || null };
    if (mine) {
      view.draft = record.draft || null;
      if (record.withdrawnAt) view.withdrawnAt = record.withdrawnAt;
    }
    out[uid] = view;
  }
  return out;
}

/** Who has committed an answer. Safe to show while the window is open. */
function answeredBy(search){
  const out = {};
  for (const m of membersForIntake(search)) {
    out[m.userId] = Boolean(responseFor(search, m.userId)?.submitted);
  }
  return out;
}

function bucket(share, mentions, submitted){
  if (submitted <= 1) return mentions ? 'single' : 'none';
  if (share >= 0.999) return 'unanimous';
  if (share >= 0.6) return 'strong';
  if (mentions === 1) return 'single';
  return 'split';
}

/**
 * Roll every committed answer into one ranked list per profile kind.
 *
 * `nameOf` maps a userId to a display name so the caller keeps control of who
 * is visible; pass a function that returns '' to aggregate anonymously.
 */
function aggregate(search, nameOf){
  const name = typeof nameOf === 'function' ? nameOf : () => '';
  const finished = finishedSubmissions(search);
  const submitted = finished.length;
  const asked = membersForIntake(search);
  const done = new Set(finished.map(f => f.userId));

  const groups = new Map();
  for (const sub of finished) {
    for (const item of sub.items || []) {
      const key = groupKey(item.kind, item.label);
      let g = groups.get(key);
      if (!g) {
        g = { key, kind: item.kind, labels: new Map(), voters: [] };
        groups.set(key, g);
      }
      g.labels.set(item.label, (g.labels.get(item.label) || 0) + 1);
      g.voters.push({
        userId: sub.userId,
        name: name(sub.userId),
        weight: item.weight,
        note: item.note
      });
    }
  }

  const byKind = {};
  for (const k of KINDS) byKind[k] = [];

  for (const g of groups.values()) {
    const weights = g.voters.map(v => v.weight);
    const mentions = g.voters.length;
    const share = submitted ? mentions / submitted : 0;
    const min = Math.min(...weights);
    const max = Math.max(...weights);
    const highRatings = weights.filter(w => w >= 4).length;
    // The label most members typed wins. Ties fall to the shortest, since the
    // words normLabel strips as filler ("strong", "skills", "the") are exactly
    // what makes one member's phrasing longer than another's for the same idea,
    // and then to the one that was capitalized, so the adopted profile does not
    // read as though it were typed in a hurry.
    const capped = s => /^[A-Z]/.test(s) ? 0 : 1;
    const label = [...g.labels.entries()]
      .sort((a, b) =>
        b[1] - a[1] ||
        a[0].length - b[0].length ||
        capped(a[0]) - capped(b[0]) ||
        a[0].localeCompare(b[0]))[0][0];
    byKind[g.kind].push({
      key: g.key,
      kind: g.kind,
      label,
      mentions,
      share,
      highRatings,
      avgWeight: weights.reduce((a, b) => a + b, 0) / mentions,
      minWeight: min,
      maxWeight: max,
      spread: max - min,
      // Named by several people who disagree sharply on how much it matters.
      // Worth a conversation before it is adopted or dropped.
      contested: mentions > 1 && (max - min) >= 3,
      consensus: search.intake?.questionnaireVersion ? (highRatings ? bucket(highRatings / submitted, highRatings, submitted) : 'none') : bucket(share, mentions, submitted),
      voters: g.voters.slice().sort((a, b) => b.weight - a.weight),
      notes: g.voters.filter(v => v.note).map(v => ({ userId: v.userId, name: v.name, weight: v.weight, note: v.note }))
    });
  }

  for (const k of KINDS) {
    byKind[k].sort((a, b) =>
      (search.intake?.questionnaireVersion ? b.avgWeight - a.avgWeight : b.mentions - a.mentions) ||
      (search.intake?.questionnaireVersion ? b.mentions - a.mentions : b.avgWeight - a.avgWeight) ||
      a.label.localeCompare(b.label));
    byKind[k].forEach((entry, i, list) => {
      entry.rank = i && entry.avgWeight === list[i-1].avgWeight && entry.mentions === list[i-1].mentions ? list[i-1].rank : i+1;
    });
  }

  return {
    submitted,
    asked: asked.length,
    pending: asked.filter(m => !done.has(m.userId)).map(m => ({
      userId: m.userId,
      name: name(m.userId),
      searchRole: searchRoleOf(m.searchRole)
    })),
    byKind,
    contested: KINDS.flatMap(k => byKind[k].filter(e => e.contested)),
    voices: finished
      .map(f => ({
        userId: f.userId,
        name: name(f.userId),
        mustHave: f.mustHave,
        dealBreaker: f.dealBreaker,
        context: f.context,
        at: f.at
      }))
      .filter(v => v.mustHave || v.dealBreaker || v.context)
  };
}

/* ------------------------------------------------------------------ *
 * Adoption: what the profile was built from, and when
 * ------------------------------------------------------------------ */

/**
 * A fingerprint of everything an adopted profile claims to describe.
 *
 * It moves when a committed answer, a weight, a reason, a narrative, or the
 * roster moves, because each of those changes what "named by 2 of 3" means. It
 * does not move for a private draft keystroke or an unrelated search fact, so
 * a member typing in their own form does not mark the published profile stale.
 */
function sourceFingerprint(search){
  const roster = membersForIntake(search)
    .map(m => m.userId + ':' + searchRoleOf(m.searchRole))
    .sort();
  const answers = finishedSubmissions(search)
    .map(s => ({
      userId: s.userId,
      items: (s.items || []).map(i => [i.kind, normLabel(i.label) || i.label, i.weight, i.note]),
      mustHave: s.mustHave || '',
      dealBreaker: s.dealBreaker || '',
      context: s.context || ''
    }))
    .sort((a, b) => a.userId.localeCompare(b.userId));
  return crypto.createHash('sha256')
    .update(JSON.stringify({ roster, answers }))
    .digest('hex')
    .slice(0, 32);
}

/**
 * May the profile be written from committee input right now?
 *
 * One answer for direct adoption, manual profile saves and AI profile writes,
 * so changing a button cannot open a path the API still allows (CA-02). Input
 * a member has not finished giving is not published to the rest of the
 * committee through a criterion note, and a committee whose roster moved is
 * confirmed again before its answers are published as that committee's.
 *
 * Returns null when publishing is allowed, and the refusal otherwise. Routes
 * ask before doing any work and again immediately before writing, because a
 * window can reopen while a draft is being generated.
 */
function publicationBlock(search){
  const intake = (search && search.intake) || {};
  if (intake.status === 'open') {
    return { status: 409, code: 'INTAKE_OPEN',
      error: 'Committee input is still being collected. Close the window before building or saving the profile, '
        + 'so nobody reads another member’s answer early.' };
  }
  if (intake.status === 'closed' && (search.members || []).length && !search.team?.confirmedAt) {
    return { status: 409, code: 'ROSTER_UNCONFIRMED',
      error: 'The roster changed after intake was confirmed. Confirm who is on the search again before publishing the profile.' };
  }
  return null;
}

/** The evidence one adopted line rests on, frozen at the moment of adoption. */
function groupSnapshot(entry, submitted, asked){
  return {
    key: entry.key,
    kind: entry.kind,
    label: entry.label,
    mentions: entry.mentions,
    respondents: submitted,
    participants: asked,
    avgWeight: Number(entry.avgWeight.toFixed(2)),
    minWeight: entry.minWeight,
    maxWeight: entry.maxWeight,
    contested: Boolean(entry.contested),
    consensus: entry.consensus,
    // Every reason, not the first one. One member's explanation is not the
    // committee's rationale (CA-05).
    reasons: entry.notes.map(n => ({ name: n.name || '', weight: n.weight, note: n.note }))
  };
}

/**
 * The note on an adopted line: participation and disagreement, nothing else.
 *
 * The reasons live in the adoption record, where they stay attached to the
 * person who wrote them and cannot read as a committee position.
 */
function critNote(entry, submitted){
  const parts = [];
  if (submitted) parts.push('Named by ' + entry.mentions + ' of ' + submitted + ' who answered.');
  if (entry.contested) {
    parts.push('Rated as low as ' + entry.minWeight + ' and as high as ' + entry.maxWeight
      + '; the committee is divided on how much it matters.');
  }
  return parts.join(' ').slice(0, 600);
}

function labelOf(c){
  return String((c && c.label) || '').trim();
}

/** The canonical key an existing criterion answers to. */
function critKey(c){
  return (c && c.source && c.source.key) || groupKey(c.kind, labelOf(c));
}

/**
 * What adopting would do, before it does it.
 *
 * Returns the proposed criteria plus the decision the manager is being asked
 * to make: what arrives, what changes, what is proposed for removal because
 * nobody names it any more, what a consultant wrote and is being kept, and
 * what the five-item cap excludes. Callers show this and then apply the same
 * function's `criteria` (CA-03, CA-06).
 */
function adoptionPreview(existing, agg, options = {}){
  const retain = new Set(options.retain || []);
  const selected = options.selectedKeys ? new Set(options.selectedKeys) : null;
  const adoptionId = options.adoptionId || null;
  const at = options.at || new Date().toISOString();
  const prior = (existing || []).filter(c => c && KINDS.includes(c.kind) && labelOf(c));

  const criteria = [];
  const added = [];
  const changed = [];
  const removed = [];
  const retained = [];
  const kept = [];
  const excluded = [];
  const groups = [];

  const used = new Set(prior.map(c => c.id).filter(Boolean));
  const counter = { skill: 0, trait: 0, chall: 0, opp: 0 };
  const nextId = kind => {
    let id;
    do { id = PREFIX[kind] + (++counter[kind]); } while (used.has(id));
    // Reserved the moment it is handed out, so a second row in the same pass
    // cannot be given the same ID (CA-07).
    used.add(id);
    return id;
  };

  for (const kind of KINDS) {
    const supported = agg.byKind[kind] || [];
    const mine = prior.filter(c => c.kind === kind);
    const claimed = new Set();
    const keep = [];

    // 1. What the committee named, in rank order, up to the cap.
    for (const entry of supported) {
      if (selected && !selected.has(entry.key)) {
        excluded.push({kind, label:entry.label, key:entry.key, reason:'decision', mentions:entry.mentions, why:'Not selected during profile review.'});
        continue;
      }
      if (keep.length >= KIND_CAP) {
        excluded.push({ kind, label: entry.label, key: entry.key, reason: 'cap',
          mentions: entry.mentions, why: 'Ranked below the five that fit this category.' });
        continue;
      }
      // Identity first, wording second: a criterion the consultant renamed is
      // still the same criterion, and keeps its ID and its history (CA-08).
      const match = mine.find(c => c.source?.key === entry.key && !claimed.has(c.id))
        || mine.find(c => !claimed.has(c.id) && !c.source?.key && groupKey(kind, labelOf(c)) === entry.key);
      if (match) claimed.add(match.id);
      const id = match?.id || nextId(kind);
      const renamed = Boolean(match && match.source?.key === entry.key);
      const next = {
        id,
        kind,
        // A consultant's edited wording survives re-adoption; the committee's
        // own phrasing is only used for a line that is arriving now.
        label: renamed ? labelOf(match) : entry.label,
        weight: clampWeight(Math.round(entry.avgWeight)),
        note: critNote(entry, agg.submitted),
        from: 'committee',
        source: { key: entry.key, adoptionId, at, support: 'current' }
      };
      keep.push(next);
      groups.push(groupSnapshot(entry, agg.submitted, agg.asked));
      const record = { id, kind, label: next.label, key: entry.key, mentions: entry.mentions,
        respondents: agg.submitted, contested: Boolean(entry.contested) };
      if (match) changed.push({ ...record, was: { label: labelOf(match), weight: match.weight } });
      else added.push(record);
    }

    // 2. Everything already on the profile that the committee did not name.
    for (const c of mine) {
      if (claimed.has(c.id)) continue;
      const key = critKey(c);
      const wasCommittee = c.from === 'committee';
      const record = { id: c.id, kind, label: labelOf(c), key, from: c.from || 'consultant' };
      if (selected && supported.some(e => e.key === key) && !selected.has(key)) {
        removed.push({...record, why:'Not selected during profile review.'});
        continue;
      }
      // Two lines that reduce to the same priority, and step 1 has already
      // given the committee's answer to one of them. The other is a duplicate,
      // and saying so is better than quietly not carrying it forward.
      if (supported.some(e => e.key === key)) {
        removed.push({ ...record, why: 'Another line on this profile already carries the committee’s answer for this.' });
        continue;
      }
      if (wasCommittee && !retain.has(c.id)) {
        // Nobody names it any more. Proposing removal is the honest reading;
        // silently carrying it forward with its old "named by 2 of 2" is not
        // (CA-03).
        removed.push({ ...record, why: 'No current committee answer names this.' });
        continue;
      }
      if (keep.length >= KIND_CAP) {
        excluded.push({ kind, label: labelOf(c), key, reason: 'cap', from: record.from,
          why: 'The committee-named items fill this category.' });
        continue;
      }
      claimed.add(c.id);
      const next = {
        id: c.id,
        kind,
        label: labelOf(c),
        weight: clampWeight(c.weight),
        note: String(c.note || ''),
        from: c.from || 'consultant'
      };
      if (wasCommittee) {
        // Kept because the manager said so, not because the room still says
        // so. The support it carries is historical and dated as such.
        next.source = {
          ...(c.source || { key }),
          support: 'historical',
          retainedAt: at,
          retainedBy: options.actor || null,
          retainReason: String(options.retainReasons?.[c.id] || '').slice(0, 400)
        };
        retained.push({ ...record, why: 'Kept by decision; its support describes earlier answers.' });
      } else {
        if (c.source) next.source = c.source;
        kept.push(record);
      }
      keep.push(next);
    }

    criteria.push(...keep);
  }

  return {
    criteria,
    changes: { added, changed, removed, retained, kept, excluded },
    groups,
    // Contested priorities the cap left out still deserve a conversation; they
    // go on a discussion list rather than being forced into five slots (CA-09).
    discussion: discussionList(agg, criteria)
  };
}

/** Contested or excluded nominations that are worth discussing off-profile. */
function discussionList(agg, criteria){
  const onProfile = new Set((criteria || []).map(critKey));
  return KINDS.flatMap(kind => (agg.byKind[kind] || [])
    .filter(e => !onProfile.has(e.key))
    .filter(e => e.contested || e.mentions > 1)
    .map(e => ({
      key: e.key,
      kind: e.kind,
      label: e.label,
      mentions: e.mentions,
      respondents: agg.submitted,
      avgWeight: Number(e.avgWeight.toFixed(1)),
      minWeight: e.minWeight,
      maxWeight: e.maxWeight,
      contested: Boolean(e.contested),
      reasons: e.notes.map(n => ({ name: n.name || '', weight: n.weight, note: n.note }))
    })));
}

/**
 * Merge consensus into the Step 3 matrix.
 *
 * Kept as the shape earlier callers expect; the decision it makes is
 * adoptionPreview's.
 */
function mergeIntoCriteria(existing, agg, options){
  return adoptionPreview(existing, agg, options).criteria;
}

/** Kinds where the committee's own answers do not reach the 3-item floor. */
function coverageGaps(agg){
  return KINDS
    .filter(k => (agg.byKind[k] || []).length < KIND_FLOOR)
    .map(k => ({ kind: k, label: KIND_LABEL[k], have: (agg.byKind[k] || []).length, need: KIND_FLOOR }));
}

/**
 * Kinds the finished profile is still short in.
 *
 * Different question from coverageGaps: "only one opportunity was nominated"
 * is not "your profile needs two more opportunities" when three were already
 * written by hand (CA-06).
 */
function profileGaps(criteria){
  const counted = kind => (criteria || []).filter(c => c && c.kind === kind && labelOf(c)).length;
  return KINDS
    .filter(k => counted(k) < KIND_FLOOR)
    .map(k => ({ kind: k, label: KIND_LABEL[k], have: counted(k), need: KIND_FLOOR }));
}

/** Kept under its old name for callers that mean committee coverage. */
const adoptionGaps = coverageGaps;

/**
 * The slice of consensus worth putting in a Claude prompt.
 *
 * `selected` is what may go on the capped profile and carries the full
 * evidence for each item. `discussion` is everything else the committee is
 * divided about, with the same evidence, so the model is never asked to
 * mention an item it was given no detail for (CA-09).
 */
function packForPrompt(agg, options = {}){
  if (!agg || !agg.submitted) return null;
  const cap = Number.isInteger(options.cap) ? options.cap : KIND_CAP;
  const detail = e => ({
    key: e.key,
    label: e.label,
    namedBy: e.mentions,
    outOf: agg.submitted,
    avgWeight: Number(e.avgWeight.toFixed(1)),
    lowWeight: e.minWeight,
    highWeight: e.maxWeight,
    consensus: e.consensus,
    contested: e.contested || undefined,
    reasons: e.notes.slice(0, 5).map(n => n.note)
  });
  // Bounded packing, stated rather than implied: the ranked items that can fit
  // the profile, and every remaining contested item, each with its detail.
  const pick = k => (agg.byKind[k] || []).slice(0, cap).map(detail);
  const selected = { skills: pick('skill'), traits: pick('trait'), challenges: pick('chall'), opportunities: pick('opp') };
  const chosen = new Set(Object.values(selected).flat().map(e => e.key));
  return {
    submissions: agg.submitted,
    asked: agg.asked,
    ...selected,
    discussion: agg.contested.filter(e => !chosen.has(e.key)).map(detail),
    inTheirWords: agg.voices.map(v => ({
      mustHave: v.mustHave || undefined,
      dealBreaker: v.dealBreaker || undefined,
      context: v.context || undefined
    }))
  };
}

module.exports = {
  questionnaire,
  KINDS, KIND_LABEL, KIND_CAP, KIND_FLOOR,
  SEARCH_ROLES, SEARCH_ROLE_LABEL, INTAKE_ROLES, PREFIX,
  normLabel, groupKey, critKey, cleanItems, normalizeAnswer, clampWeight, searchRoleOf,
  emptyResponse, responsesOf, responseFor, visibleResponses, answeredBy,
  membersForIntake, finishedSubmissions,
  aggregate, sourceFingerprint, publicationBlock, adoptionPreview, discussionList, mergeIntoCriteria,
  coverageGaps, adoptionGaps, profileGaps, packForPrompt
};
