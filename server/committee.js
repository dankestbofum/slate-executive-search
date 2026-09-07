'use strict';

/**
 * Search committee intake and consensus.
 *
 * Step 2 asks every seated member what they are looking for in the executive,
 * privately and in their own words. This module turns those independent
 * submissions into one ranked matrix the consultant can adopt as the Step 3
 * candidate profile. Nothing here writes; callers decide what to keep.
 */

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

const SEATS = ['manager', 'consultant', 'committee'];
const SEAT_LABEL = {
  manager: 'Account manager',
  consultant: 'Consultant',
  committee: 'Committee member'
};

// Everyone seated on the search is asked to fill out intake, including the
// consultants: their read on the job is part of the record the profile is
// built from.
const INTAKE_SEATS = new Set(['manager', 'consultant', 'committee']);

function clampWeight(w){
  const n = (w === '' || w === null || w === undefined) ? 3 : Number(w);
  return Math.max(1, Math.min(5, Number.isFinite(n) ? n : 3));
}

function seatOf(seat){
  return SEATS.includes(seat) ? seat : 'committee';
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

function normalizeSubmission(body, prev, now){
  return {
    items: cleanItems(body && body.items),
    mustHave: String((body && body.mustHave) || '').trim().slice(0, 2000),
    dealBreaker: String((body && body.dealBreaker) || '').trim().slice(0, 2000),
    context: String((body && body.context) || '').trim().slice(0, 2000),
    submitted: Boolean(body && body.submitted),
    at: (prev && prev.at) || now,
    updatedAt: now
  };
}

function seatedForIntake(search){
  return (search.members || []).filter(m => INTAKE_SEATS.has(seatOf(m.seat)));
}

function submissionsOf(search){
  return (search.intake && search.intake.submissions) || {};
}

// Only completed submissions feed consensus. A half-filled draft would drag the
// denominator down and make real agreement look weaker than it is.
function finishedSubmissions(search){
  const subs = submissionsOf(search);
  const seated = new Set(seatedForIntake(search).map(m => m.userId));
  return Object.entries(subs)
    .filter(([uid, s]) => s && s.submitted && seated.has(uid))
    .map(([uid, s]) => ({ userId: uid, ...s }));
}

function bucket(share, mentions, submitted){
  if (submitted <= 1) return mentions ? 'single' : 'none';
  if (share >= 0.999) return 'unanimous';
  if (share >= 0.6) return 'strong';
  if (mentions === 1) return 'single';
  return 'split';
}

/**
 * Roll every finished submission into one ranked list per profile kind.
 *
 * `nameOf` maps a userId to a display name so the caller keeps control of who
 * is visible; pass a function that returns '' to aggregate anonymously.
 */
function aggregate(search, nameOf){
  const name = typeof nameOf === 'function' ? nameOf : () => '';
  const finished = finishedSubmissions(search);
  const submitted = finished.length;
  const seated = seatedForIntake(search);
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
      avgWeight: weights.reduce((a, b) => a + b, 0) / mentions,
      minWeight: min,
      maxWeight: max,
      spread: max - min,
      // Named by several people who disagree sharply on how much it matters.
      // Worth a conversation before it is adopted or dropped.
      contested: mentions > 1 && (max - min) >= 3,
      consensus: bucket(share, mentions, submitted),
      voters: g.voters.slice().sort((a, b) => b.weight - a.weight),
      notes: g.voters.filter(v => v.note).map(v => ({ name: v.name, note: v.note }))
    });
  }

  for (const k of KINDS) {
    byKind[k].sort((a, b) =>
      b.mentions - a.mentions ||
      b.avgWeight - a.avgWeight ||
      a.label.localeCompare(b.label));
  }

  return {
    submitted,
    seats: seated.length,
    pending: seated.filter(m => !done.has(m.userId)).map(m => ({
      userId: m.userId,
      name: name(m.userId),
      seat: seatOf(m.seat)
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

function critNote(entry, submitted){
  const share = submitted ? 'Named by ' + entry.mentions + ' of ' + submitted + ' on the committee.' : '';
  const top = entry.notes.length ? ' ' + entry.notes[0].note : '';
  return (share + top).trim().slice(0, 600);
}

/**
 * Merge consensus into the Step 3 matrix.
 *
 * Consensus leads, existing hand-written criteria fill in behind it, and each
 * kind is capped at 5. Anything the consultant already wrote survives unless
 * five stronger consensus items crowd it out.
 */
function mergeIntoCriteria(existing, agg){
  const out = [];
  const counter = { skill: 0, trait: 0, chall: 0, opp: 0 };
  const used = new Set((existing || []).map(c => c.id));
  const nextId = kind => {
    let id;
    do { id = PREFIX[kind] + (++counter[kind]); } while (used.has(id));
    used.add(id);
    return id;
  };

  for (const kind of KINDS) {
    const taken = new Set();
    const keep = [];

    for (const entry of agg.byKind[kind]) {
      if (keep.length >= KIND_CAP) break;
      taken.add(normLabel(entry.label));
      keep.push({
        kind,
        label: entry.label,
        weight: clampWeight(Math.round(entry.avgWeight)),
        note: critNote(entry, agg.submitted),
        from: 'committee'
      });
    }

    for (const c of (existing || [])) {
      if (!c || c.kind !== kind) continue;
      const label = String(c.label || '').trim();
      if (!label) continue;
      if (taken.has(normLabel(label))) continue;
      if (keep.length >= KIND_CAP) break;
      taken.add(normLabel(label));
      keep.push({
        kind,
        label,
        weight: clampWeight(c.weight),
        note: String(c.note || ''),
        from: c.from || 'consultant'
      });
    }

    for (const c of keep) {
      const previous = (existing || []).find(old => old.kind === kind && normLabel(old.label) === normLabel(c.label));
      out.push({ id: previous?.id || nextId(kind), ...c });
    }
  }

  return out;
}

/** Kinds where consensus alone cannot reach the 3-item floor. */
function adoptionGaps(agg){
  return KINDS
    .filter(k => agg.byKind[k].length < KIND_FLOOR)
    .map(k => ({ kind: k, label: KIND_LABEL[k], have: agg.byKind[k].length, need: KIND_FLOOR }));
}

/** The slice of consensus worth putting in a Claude prompt. */
function packForPrompt(agg){
  if (!agg || !agg.submitted) return null;
  const pick = k => agg.byKind[k].slice(0, 8).map(e => ({
    label: e.label,
    namedBy: e.mentions,
    outOf: agg.submitted,
    avgWeight: Number(e.avgWeight.toFixed(1)),
    consensus: e.consensus,
    contested: e.contested || undefined,
    reasons: e.notes.slice(0, 3).map(n => n.note)
  }));
  return {
    submissions: agg.submitted,
    seats: agg.seats,
    skills: pick('skill'),
    traits: pick('trait'),
    challenges: pick('chall'),
    opportunities: pick('opp'),
    contested: agg.contested.map(e => ({
      label: e.label,
      kind: e.kind,
      low: e.minWeight,
      high: e.maxWeight
    })),
    inTheirWords: agg.voices.map(v => ({
      mustHave: v.mustHave || undefined,
      dealBreaker: v.dealBreaker || undefined,
      context: v.context || undefined
    }))
  };
}

module.exports = {
  KINDS, KIND_LABEL, KIND_CAP, KIND_FLOOR,
  SEATS, SEAT_LABEL, INTAKE_SEATS, PREFIX,
  normLabel, groupKey, cleanItems, normalizeSubmission, clampWeight, seatOf,
  seatedForIntake, finishedSubmissions,
  aggregate, mergeIntoCriteria, adoptionGaps, packForPrompt
};
