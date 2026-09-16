'use strict';

// Stand up the synthetic environment for the P2 tabletop.
//
// The rehearsal in docs/late-stage-pilot-plan.md §4 starts at Step 13 with
// three semifinalists already on the file. Getting there means a committee, an
// intake round, an adopted profile, six drafted artifacts, sourcing work, three
// candidates and two sets of scores. Doing that by hand at the start of the
// session costs an hour of the consultant's time and — worse — produces a
// different starting point every time, so two runs of the same script cannot be
// compared.
//
// So this seeds everything upstream of Step 13, and nothing at or after it.
// What the tabletop is there to exercise, the tabletop does:
//
//   seeded      Steps 1-12: committee, intake, profile, community, guide,
//               questionnaires, plan, brochure, advertisement, sourcing,
//               three scored semifinalists.
//   NOT seeded  Steps 13-19, outcomes, export, closeout, reopening, archive.
//               No semifinalist questionnaire is sent. No reference consent is
//               recorded. No finalist is named.
//
// The plan permits this: APIs may prepare upstream fixtures, but may not
// perform the user action whose UI handoff is under test.
//
// Everything it creates is named `[SYNTHETIC <run id>]`, so a later cleanup can
// find it and a screenshot can never be mistaken for a real county's search.
//
// Run it against an isolated deployment, never a pilot volume:
//
//   $env:SLATE_TABLETOP_URL     = 'https://isolated-staging.example'
//   $env:SLATE_TABLETOP_CONFIRM = 'I_AM_USING_SYNTHETIC_STAGING'
//   $env:SLATE_TABLETOP_RUN_ID  = 'tabletop-20260921-a1b2c3'
//   $env:SLATE_TABLETOP_TOKENS  = '<manager>,<consultant>,<reviewer1>,<reviewer2>'
//   node scripts/tabletop.js
//
// The four tokens are session JWTs for four different accounts in one
// workspace, in that order. The first must be able to open a search. The last
// two are the committee reviewers and may hold any role; they are added to the
// roster here.
//
// It prints a manifest at the end: what was seeded, what deliberately was not,
// the URL each participant opens, and each candidate's questionnaire link.
// Keep the manifest with the run record. Do not paste the candidate links into
// anything shared — they are bearer URLs, synthetic or not.

const BASE = String(process.env.SLATE_TABLETOP_URL || '').replace(/\/$/, '');
const CONFIRM = process.env.SLATE_TABLETOP_CONFIRM;
const RUN_ID = String(process.env.SLATE_TABLETOP_RUN_ID || '');
const TOKENS = String(process.env.SLATE_TABLETOP_TOKENS || '').split(',').map(t => t.trim()).filter(Boolean);
// A second workspace, for the isolation check in §4. Optional: without it that
// segment is run by hand, and the manifest says so rather than implying it was
// covered.
const OTHER_FIRM_TOKEN = String(process.env.SLATE_TABLETOP_OTHER_FIRM_TOKEN || '').trim();

function guard() {
  if (CONFIRM !== 'I_AM_USING_SYNTHETIC_STAGING') {
    throw new Error('Set SLATE_TABLETOP_CONFIRM=I_AM_USING_SYNTHETIC_STAGING. This script writes records.');
  }
  if (!/^tabletop-[a-z0-9-]{6,60}$/.test(RUN_ID)) {
    throw new Error('SLATE_TABLETOP_RUN_ID must look like tabletop-20260921-a1b2c3.');
  }
  if (!BASE) throw new Error('Set SLATE_TABLETOP_URL to the isolated deployment.');
  const url = new URL(BASE);
  if (url.protocol !== 'https:' && process.env.SLATE_TABLETOP_ALLOW_HTTP !== 'true') {
    throw new Error('Use HTTPS, or set SLATE_TABLETOP_ALLOW_HTTP=true for a local run.');
  }
  if (TOKENS.length !== 4) {
    throw new Error('SLATE_TABLETOP_TOKENS needs four comma-separated session JWTs: manager, consultant, reviewer, reviewer.');
  }
  if (TOKENS.some(t => t.split('.').length !== 3)) throw new Error('Every SLATE_TABLETOP_TOKENS entry must be a JWT.');
}

const [MANAGER, CONSULTANT, REVIEWER_A, REVIEWER_B] = TOKENS;
const label = suffix => '[SYNTHETIC ' + RUN_ID + '] ' + suffix;

/* ------------------------------------------------------------------ *
 * Talking to the deployment
 * ------------------------------------------------------------------ */

async function call(token, method, route, body, headers = {}) {
  const response = await fetch(BASE + route, {
    method,
    headers: {
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      'content-type': 'application/json', ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000)
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* reported below as raw text */ }
  return { status: response.status, body: parsed, text: text.slice(0, 400) };
}

/** A read, or a clear failure. Seeding half a fixture is worse than none. */
async function get(token, route) {
  const result = await call(token, 'GET', route);
  if (result.status !== 200) throw new Error('GET ' + route + ' returned ' + result.status + ': ' + (result.body?.error || result.text));
  return result.body;
}

/** A write, carrying the current revision, because every save needs one. */
async function write(token, method, route, searchId, body) {
  const current = await get(token, '/api/searches/' + searchId);
  const result = await call(token, method, route, body, { 'if-match': String(current.revision) });
  if (result.status !== 200) {
    throw new Error(method + ' ' + route + ' returned ' + result.status + ': ' + (result.body?.error || result.text));
  }
  return result.body;
}

/* ------------------------------------------------------------------ *
 * The synthetic county
 *
 * Deliberately not a real place, and deliberately not Arizona-shaped by
 * accident: the facts below are the ones a consultant has to check, so they are
 * written out in full rather than left to a default. The tabletop's first job
 * is to notice if any of them read as though a person had confirmed them when
 * nobody has.
 * ------------------------------------------------------------------ */

const COUNTY = {
  client: 'Cottonwood Basin County',
  position: 'County Administrator',
  state: 'Arizona',
  jurisdictionType: 'county',
  fog: 'Board–Administrator',
  population: '96,400',
  budget: '$214M all funds',
  salary: '$205,000 to $245,000',
  opened: '2026-09-21',
  firstReview: '2026-10-26',
  website: 'https://example.gov',
  notes: 'Synthetic rehearsal county. Every fact on this file is invented for the tabletop.'
};

const FACTS = {
  governingBody: { value: 'Board of Supervisors, five members elected by district.', source: 'Synthetic county charter, §2-1.', asOf: '2026-09-01', confirmedBy: 'Rehearsal fact reviewer (synthetic)' },
  reportsTo: { value: 'Reports to the Board as a whole, not to the Chair.', source: 'Synthetic board policy 1.04.', asOf: '2026-09-01', confirmedBy: 'Rehearsal fact reviewer (synthetic)' },
  appointmentAuthority: { value: 'Appointed and removed by majority vote of the Board.', source: 'Synthetic county charter, §4-2.', asOf: '2026-09-01', confirmedBy: 'Rehearsal fact reviewer (synthetic)' },
  separatelyElected: { value: 'Sheriff, Assessor, Recorder, Treasurer, County Attorney, Superintendent of Schools. None report to the Administrator.', source: 'Synthetic county charter, §3.', asOf: '2026-09-01', confirmedBy: 'Rehearsal fact reviewer (synthetic)' },
  serviceResponsibilities: { value: 'Public works, planning, health, community development, general services, finance.', source: 'Synthetic organization chart.', asOf: '2026-09-01', confirmedBy: 'Rehearsal fact reviewer (synthetic)' },
  // Left unconfirmed on purpose. A file where every fact is green teaches the
  // consultant nothing about how an outstanding one is surfaced, and §4 asks
  // the rehearsal to record which prerequisites were seeded.
  employmentTerms: { value: 'Three-year employment agreement, terms to be adopted by the Board.', source: 'Draft only — NOT confirmed with the synthetic county.', asOf: '' },
  applicationMethod: { value: 'Materials received by the firm; county has approved no portal.', source: 'Synthetic engagement letter.', asOf: '2026-09-01', confirmedBy: 'Rehearsal fact reviewer (synthetic)' },
  factReviewer: { value: 'Rehearsal fact reviewer (synthetic)', source: 'Named for the tabletop only.', asOf: '2026-09-01', confirmedBy: 'Rehearsal fact reviewer (synthetic)' }
};

// What each committee member says they are looking for. Different enough to
// produce real consensus and one genuinely contested item, so the adopted
// profile is something a consultant can argue with rather than a flat list.
const INTAKE = {
  manager: {
    items: [
      { kind: 'skill', label: 'Public budgeting', weight: 5, note: 'The structural deficit is the job.' },
      { kind: 'skill', label: 'Board relations', weight: 5, note: 'Five members, five districts.' },
      { kind: 'trait', label: 'Steady under public pressure', weight: 4 },
      { kind: 'chall', label: 'Structural general fund deficit', weight: 5 },
      { kind: 'opp', label: 'Regional water partnership', weight: 3 }
    ],
    mustHave: 'Has actually closed a structural deficit, not just presented one.',
    dealBreaker: 'Cannot explain a budget to a room that is angry about it.',
    context: 'The last administrator left after a failed levy.'
  },
  consultant: {
    items: [
      { kind: 'skill', label: 'Public budgeting', weight: 5 },
      { kind: 'skill', label: 'Intergovernmental relations', weight: 4, note: 'Three incorporated towns and a tribal government.' },
      { kind: 'trait', label: 'Steady under pressure', weight: 4 },
      { kind: 'chall', label: 'Structural deficit', weight: 5 },
      { kind: 'opp', label: 'Water partnership', weight: 4 }
    ],
    mustHave: 'Comfortable in a county, not a city. They are not the same job.',
    dealBreaker: 'Treats separately elected offices as direct reports.',
    context: ''
  },
  reviewerA: {
    items: [
      { kind: 'skill', label: 'Public budgeting', weight: 4 },
      { kind: 'skill', label: 'Board relations', weight: 5 },
      { kind: 'trait', label: 'Listens before deciding', weight: 5 },
      // The contested one: named by two people at opposite ends of the scale.
      { kind: 'trait', label: 'Economic development instinct', weight: 5 },
      { kind: 'chall', label: 'Deferred road maintenance', weight: 4 }
    ],
    mustHave: 'Will come to district meetings, not send a deputy.',
    dealBreaker: '',
    context: 'Our district has not seen an administrator in two years.'
  },
  reviewerB: {
    items: [
      { kind: 'skill', label: 'Board relations', weight: 4 },
      { kind: 'skill', label: 'Workforce retention', weight: 4, note: 'We cannot keep engineers.' },
      { kind: 'trait', label: 'Listens before deciding', weight: 4 },
      { kind: 'trait', label: 'Economic development instinct', weight: 2, note: 'Third priority at most.' },
      { kind: 'chall', label: 'Deferred road maintenance', weight: 5 }
    ],
    mustHave: 'Can keep department heads from leaving.',
    dealBreaker: '',
    context: ''
  }
};

const SURVEY1 = {
  intro: 'Synthetic rehearsal questionnaire. Please answer in your own words.',
  questions: [
    { n: 1, prompt: 'Describe a structural budget deficit you inherited and what you did about it.', required: true },
    { n: 2, prompt: 'How have you worked with a governing board whose members disagree with each other?', required: true },
    { n: 3, prompt: 'Describe your experience with separately elected county officers.', required: false }
  ]
};

const SURVEY2 = {
  intro: 'Synthetic semifinalist questionnaire. Please answer in your own words.',
  questions: [
    { n: 1, prompt: 'What would your first ninety days here look like?', required: true },
    { n: 2, prompt: 'Describe a decision you made that was unpopular with staff and right for the county.', required: true }
  ]
};

// A, B and C. §4 assigns the outcomes the tabletop will record: A hired, B
// withdrawn, C not selected. Nothing here records them — the names only say
// what the script expects the room to do, so the facilitator can follow along.
const PEOPLE = [
  {
    key: 'A', name: 'Ada Whitfield-Osei', cur: 'Deputy County Administrator', org: 'Harlow County', yrs: 14,
    expected: 'to be hired',
    answers: {
      q1: 'Harlow ran a $6M structural gap for three cycles. We rebuilt the five-year forecast, moved four programs to cost recovery, and closed it without a service reduction the board had not voted on.',
      q2: 'Our board split 3-2 on almost everything. I stopped bringing recommendations to open session before every member had heard the options privately and told me what they could not support.',
      q3: 'I staffed the budget for an elected Sheriff and an elected Assessor. They do not report to the administrator, and treating their budgets as mine to cut would have ended the working relationship.'
    }
  },
  {
    key: 'B', name: 'Bo Nakagawa-Ferreira', cur: 'City Manager', org: 'City of Rell', yrs: 11,
    expected: 'to withdraw',
    answers: {
      q1: 'Rell had a deficit driven by a pension contribution schedule. We negotiated a longer amortisation and held three years of flat general fund growth.',
      q2: 'I hold one-on-ones before every agenda. A council member who is surprised in public is a council member who votes no.',
      q3: ''
    }
  },
  {
    key: 'C', name: 'Cyd Bramblewood', cur: 'Assistant County Manager', org: 'Pell County', yrs: 9,
    expected: 'not to be selected',
    answers: {
      q1: 'Pell was structurally balanced when I arrived. My work was on the capital side: a deferred maintenance backlog we retired over six years.',
      q2: 'I brief every member the same way, in writing, at the same time. It is less personal and it has never been called favouritism.',
      q3: 'I worked most closely with the elected Recorder on records modernisation.'
    }
  }
];

/* ------------------------------------------------------------------ *
 * Seeding
 * ------------------------------------------------------------------ */

const seeded = [];
const note = line => { seeded.push(line); console.log('  ' + line); };

async function whoami(token) {
  const me = await get(token, '/api/me');
  return me.user;
}

/** Put somebody on the roster, whether or not they already have an account. */
async function addMember(searchId, name, email, searchRole) {
  const result = await write(MANAGER, 'POST', '/api/searches/' + searchId + '/members', searchId, { name, email, searchRole });
  if (result.added) return { held: false };
  const held = (result.pending || []).find(p => p.email === String(email).toLowerCase());
  return { held: Boolean(held), status: held?.status || 'unknown' };
}

async function seedCommittee(searchId, people) {
  for (const person of people) {
    const outcome = await addMember(searchId, person.name, person.email, person.searchRole);
    note(outcome.held
      ? 'Held a ' + person.searchRole + ' place for ' + person.email + ' (' + outcome.status + ') — they take it on their next sign-in'
      : 'Added ' + person.name + ' as ' + person.searchRole);
  }
  await write(MANAGER, 'POST', '/api/searches/' + searchId + '/team/confirm', searchId, { confirmed: true });
  note('Confirmed the roster');
}

async function seedIntake(searchId) {
  await write(MANAGER, 'POST', '/api/searches/' + searchId + '/intake/status', searchId, {
    status: 'open', dueBy: '2026-09-28',
    prompt: 'Synthetic rehearsal. What are you looking for in the next County Administrator?'
  });
  const answered = [];
  for (const [token, submission, who] of [
    [MANAGER, INTAKE.manager, 'the manager'],
    [CONSULTANT, INTAKE.consultant, 'the second consultant'],
    [REVIEWER_A, INTAKE.reviewerA, 'reviewer A'],
    [REVIEWER_B, INTAKE.reviewerB, 'reviewer B']
  ]) {
    try {
      await write(token, 'PUT', '/api/searches/' + searchId + '/intake', searchId, { ...submission, submitted: true });
      answered.push(who);
    } catch (error) {
      // A reviewer whose place is still held cannot answer yet. Say so rather
      // than failing the seed: the consensus below works with what came in, and
      // the manifest records how many voices are behind the adopted profile.
      note('Intake not answered by ' + who + ': ' + error.message);
    }
  }
  await write(MANAGER, 'POST', '/api/searches/' + searchId + '/intake/status', searchId, { status: 'closed' });
  note('Collected intake from ' + answered.length + ' of 4 and closed the window');

  const adopted = await write(MANAGER, 'POST', '/api/searches/' + searchId + '/intake/adopt', searchId, {});
  const criteria = adopted.search.criteria || [];
  note('Adopted a ' + criteria.length + '-criterion profile from committee input'
    + (adopted.gaps?.length ? ' (thin in: ' + adopted.gaps.map(g => g.label).join(', ') + ')' : ''));
  return criteria;
}

async function seedArtifacts(searchId, criteria) {
  const put = (key, body) => write(MANAGER, 'PUT', '/api/searches/' + searchId + '/artifact/' + key, searchId, { body });

  await put('community', {
    lede: 'A high-desert county of 96,400 across 4,100 square miles, with three incorporated towns.',
    body: 'Synthetic community profile written for the rehearsal. Nothing here describes a real place.'
  });
  await put('guide', {
    intro: 'Synthetic interview guide.',
    questions: criteria.slice(0, 5).map((c, i) => ({
      n: i + 1, prompt: 'Tell us about your work on ' + c.label.toLowerCase() + '.', crit: [c.id]
    })),
    scenario: 'A board member asks you, in open session, to reverse a decision you made last week.'
  });
  await put('survey1', SURVEY1);
  await put('survey2', SURVEY2);
  await put('plan', {
    rows: [
      { where: 'ICMA Job Center', when: '2026-09-22', cost: 'Synthetic' },
      { where: 'State league of counties', when: '2026-09-22', cost: 'Synthetic' },
      { where: 'Direct outreach by the firm', when: 'Ongoing', cost: 'Included' }
    ]
  });
  await put('brochure', {
    title: 'County Administrator',
    subtitle: 'Cottonwood Basin County, Arizona',
    body: 'Synthetic recruitment brochure prepared for the rehearsal.'
  });
  await put('ads', {
    full: {
      headline: 'County Administrator · Cottonwood Basin County, Arizona',
      body: 'Synthetic advertisement copy. Salary $205,000 to $245,000. First review 26 October 2026.'
    }
  });
  note('Drafted the community profile, interview guide, both questionnaires, the recruitment plan, the brochure and the advertisement');

  // The recruiting copy is signed off, because Step 13 is downstream of it and
  // the rehearsal should not open on an unreviewed brochure. Whether the
  // sign-off reads as a real review is one of the things to watch for.
  for (const key of ['brochure', 'ads']) {
    await write(MANAGER, 'POST', '/api/searches/' + searchId + '/artifact/' + key + '/review', searchId, {
      approve: true, note: 'Synthetic rehearsal sign-off.'
    });
  }
  note('Signed off the brochure and the advertisement');
}

async function seedSourcing(searchId) {
  for (const text of [
    'Called four sitting county administrators in the region. Two asked for the brochure; one is watching the salary.',
    'Posted to the state league job board and the ICMA Job Center. Confirmations filed with the engagement record.',
    'Two referrals from a former client. Both contacted; neither is looking this cycle.'
  ]) {
    await write(CONSULTANT, 'POST', '/api/searches/' + searchId + '/staff/sourcing/log', searchId, { text });
  }
  // Deliberately left open. §4 asks the rehearsal to try certifying an empty
  // step and to watch how completion behaves; a step already marked done would
  // hide that.
  note('Logged three sourcing entries and left Step 11 open on purpose');
}

async function seedCandidates(searchId) {
  const links = [];
  for (const person of PEOPLE) {
    const result = await write(MANAGER, 'POST', '/api/searches/' + searchId + '/candidates', searchId, {
      name: person.name, cur: person.cur, org: person.org, yrs: person.yrs,
      email: person.key.toLowerCase() + '.' + RUN_ID + '@example.invalid'
    });
    const candidate = result.candidates.find(c => c.name === person.name);
    links.push({ ...person, id: candidate.id, invite: candidate.invite });
  }
  note('Added three candidates');

  // Through the candidate's own link, unauthenticated, exactly as a real
  // applicant does. The response is then a real one, with the questions frozen
  // against it — which is what the export segment later compares.
  for (const person of links) {
    const page = await get(null, '/api/apply/' + person.invite);
    const submitted = await call(null, 'POST', '/api/apply/' + person.invite, {
      which: 'survey1', surveyVersion: page.versions.survey1, answers: person.answers
    });
    if (submitted.status !== 200) {
      throw new Error('Could not submit for ' + person.name + ': ' + submitted.status + ' ' + (submitted.body?.error || submitted.text));
    }
  }
  note('All three submitted the initial questionnaire through their own links');
  return links;
}

async function seedScores(searchId, links, criteria) {
  // Two reviewers, independently, with different marks — so the released view
  // in the scoring segment has something to disagree about. Scores stay sealed:
  // releasing them is a decision the tabletop makes, not the seed.
  const marks = {
    [REVIEWER_A]: { A: 5, B: 4, C: 3 },
    [REVIEWER_B]: { A: 4, B: 5, C: 4 }
  };
  let saved = 0;
  for (const [token, byPerson] of Object.entries(marks)) {
    for (const person of links) {
      const scores = Object.fromEntries(criteria.map(c => [c.id, byPerson[person.key]]));
      try {
        await write(token, 'PUT', '/api/searches/' + searchId + '/scores/' + person.id, searchId, {
          scores, note: 'Synthetic rehearsal note for ' + person.name + '.'
        });
        saved += 1;
      } catch (error) {
        note('Could not score ' + person.name + ' as one reviewer: ' + error.message);
      }
    }
  }
  note('Saved ' + saved + ' score sheets, sealed — releasing them is the manager\'s decision in the rehearsal');
}

async function advanceToSemifinalist(searchId, links) {
  for (const person of links) {
    await write(MANAGER, 'PATCH', '/api/searches/' + searchId + '/candidates/' + person.id, searchId, { stage: 'semifinalist' });
  }
  note('Advanced all three to semifinalist — the file now opens at Step 13');
}

async function seedOtherFirm() {
  if (!OTHER_FIRM_TOKEN) return null;
  const created = await call(OTHER_FIRM_TOKEN, 'POST', '/api/searches', {
    client: label('Marrow Ridge County (other firm)'), position: 'County Manager',
    jurisdictionType: 'county', package: 'executive'
  });
  if (created.status !== 200) {
    note('Could not seed the second firm: ' + created.status + ' ' + (created.body?.error || created.text));
    return null;
  }
  note('Seeded a second firm\'s search for the isolation check: ' + created.body.id);
  return created.body.id;
}

/* ------------------------------------------------------------------ *
 * The manifest
 * ------------------------------------------------------------------ */

function manifest(searchId, links, participants, otherSearchId) {
  const line = '-'.repeat(72);
  const out = [];
  out.push(line);
  out.push('TABLETOP ENVIRONMENT — ' + RUN_ID);
  out.push(line);
  out.push('Deployment:   ' + BASE);
  out.push('Search:       ' + searchId + '  (' + COUNTY.client + ' · ' + COUNTY.position + ')');
  out.push('Seeded at:    ' + new Date().toISOString());
  out.push('');
  out.push('WHO OPENS WHAT');
  for (const p of participants) {
    out.push('  ' + p.role.padEnd(22) + p.name + '  →  ' + BASE + '/#/s/' + searchId + '/overview');
  }
  out.push('');
  out.push('CANDIDATE LINKS — bearer URLs. Do not paste these into a shared channel.');
  for (const person of links) {
    out.push('  ' + person.key + '. ' + person.name.padEnd(26) + 'expected ' + person.expected);
    out.push('     ' + BASE + '/apply/' + person.invite);
  }
  out.push('');
  out.push('SEEDED');
  for (const item of seeded) out.push('  - ' + item);
  out.push('');
  out.push('NOT SEEDED — this is what the rehearsal is for');
  for (const item of [
    'Step 13: no semifinalist questionnaire has been sent to anybody',
    'Step 14: no video interview work is logged; Step 11 sourcing is left uncertified',
    'Step 15: nobody is a finalist',
    'Step 17: no reference consent and no reference contact are recorded',
    'Steps 18-19: no contract and no evaluation process are drafted',
    'Outcomes: nobody is hired, withdrawn or not selected',
    'Scores are sealed; the export, closeout, reopening and archive are untouched',
    'Employment terms are recorded as an unconfirmed fact, on purpose'
  ]) out.push('  - ' + item);
  out.push('');
  out.push(otherSearchId
    ? 'ISOLATION: second firm search ' + otherSearchId + ' exists. Try to reach it from this workspace.'
    : 'ISOLATION: no second firm was seeded (SLATE_TABLETOP_OTHER_FIRM_TOKEN unset). Run that segment by hand or record it as not covered.');
  out.push('');
  out.push('Script: docs/pilot-runs/TABLETOP-SCRIPT.md');
  out.push('Record the session against docs/pilot-runs/TEMPLATE.md. Keep this manifest with it.');
  out.push(line);
  return out.join('\n');
}

/* ------------------------------------------------------------------ */

(async () => {
  guard();
  console.log('Seeding ' + RUN_ID + ' against ' + BASE + '\n');

  const accounts = await Promise.all(TOKENS.map(whoami));
  const [manager, consultant, reviewerA, reviewerB] = accounts;
  if (new Set(accounts.map(a => a.id)).size !== 4) {
    throw new Error('The four tokens must belong to four different accounts; the rehearsal is about handoffs between people.');
  }
  console.log('  Manager: ' + manager.name + ' · consultant: ' + consultant.name
    + ' · reviewers: ' + reviewerA.name + ', ' + reviewerB.name + '\n');

  const created = await call(MANAGER, 'POST', '/api/searches', {
    ...COUNTY, client: label(COUNTY.client), package: 'executive'
  });
  if (created.status !== 200) {
    throw new Error('Could not open the search: ' + created.status + ' ' + (created.body?.error || created.text));
  }
  const searchId = created.body.id;
  note('Opened ' + searchId + ' on the Executive package');

  await write(MANAGER, 'PATCH', '/api/searches/' + searchId, searchId, {
    state: COUNTY.state, fog: COUNTY.fog, population: COUNTY.population, budget: COUNTY.budget,
    salary: COUNTY.salary, opened: COUNTY.opened, firstReview: COUNTY.firstReview,
    website: COUNTY.website, notes: COUNTY.notes
  });
  await write(MANAGER, 'PUT', '/api/searches/' + searchId + '/verification', searchId, FACTS);
  note('Recorded the county facts, with employment terms left unconfirmed');

  await seedCommittee(searchId, [
    { name: consultant.name, email: consultant.email, searchRole: 'consultant' },
    { name: reviewerA.name, email: reviewerA.email, searchRole: 'committee' },
    { name: reviewerB.name, email: reviewerB.email, searchRole: 'committee' }
  ]);

  const criteria = await seedIntake(searchId);
  await seedArtifacts(searchId, criteria);
  await seedSourcing(searchId);
  const links = await seedCandidates(searchId);
  await seedScores(searchId, links, criteria);
  await advanceToSemifinalist(searchId, links);
  const otherSearchId = await seedOtherFirm();

  console.log('\n' + manifest(searchId, links, [
    { role: 'Search manager', name: manager.name },
    { role: 'Second consultant', name: consultant.name },
    { role: 'Committee reviewer', name: reviewerA.name },
    { role: 'Committee reviewer', name: reviewerB.name }
  ], otherSearchId));
})().catch(error => {
  console.error('\nSeeding stopped: ' + error.message);
  console.error('Nothing is rolled back. Archive the partial search before running again, or use a new run id.');
  process.exitCode = 1;
});
