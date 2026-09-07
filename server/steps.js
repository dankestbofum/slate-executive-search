'use strict';

/**
 * The process catalog: the phases a search moves through and the steps inside
 * them. Kept in its own module because both the store and the writing desk read
 * it, and neither should have to load the other to know what Step 3 is called.
 */

// Three phases now. The old flow opened on the candidate profile, which meant
// one consultant wrote down what the governing body wanted from memory. Phase 0
// puts the committee on the file first and collects each member's own answer
// before anybody drafts a profile.
const PHASES = [
  { id:0, key:'convene', t:'Seat the committee and hear them', lede:'Who is on this search, who runs it, and what each member is actually looking for. The profile is built from their answers, not from one person recalling the workshop.' },
  { id:1, key:'recruit', t:'Prepare and post', lede:'Profile, community, surveys, and the ad plan. Then the brochure and ads you actually post.' },
  { id:2, key:'people', t:'Once there are candidates', lede:'Screening is where applicants enter the file. Everything after that waits until someone is on it.' }
];

// The three service packages the firm sells. A search carries one, chosen when
// the file is opened, and it decides how much of the process runs. The
// committee is never the thing that scales: every package seats the people who
// will hire and builds the profile from their answers. What a cheaper package
// leaves out is the later work (community research, brochure, assessment
// center, contract, evaluation), not the room.
//
// `services` is the proposal language, including work the app does not model
// as a step yet (sourcing, video interviews, reference checks). It is shown to
// the consultant so the file matches what the client was sold.
const PACKAGE_ORDER = ['basic', 'enhanced', 'executive'];
const PACKAGES = {
  basic: {
    key: 'basic',
    rank: 0,
    label: 'Basic',
    fee: '$3,500 to $5,000',
    lede: 'Post, track, screen, recommend. The committee still writes the profile; the firm runs the announcement and the applicant file.',
    services: [
      'Position profile', 'Job announcement', 'Online advertising', 'Applicant tracking',
      'Resume screening', 'AI candidate screening', 'Candidate recommendation'
    ],
    // How the search reads on its overview. A Basic file is a posting and a
    // screen, so it opens on an applicant dashboard rather than a nineteen-step
    // production plan. Panels are drawn by the client in this order; the step
    // list underneath is a one-line strip.
    view: {
      layout: 'dashboard',
      kicker: 'Posting and screen',
      lede: 'Announce the job, track who applies, screen them against the profile the committee adopted, and hand the client a recommendation.',
      panels: ['committee', 'posting', 'applicants', 'recommendation'],
      steps: 'strip'
    }
  },
  enhanced: {
    key: 'enhanced',
    rank: 1,
    label: 'Enhanced',
    fee: '$7,500 to $12,500',
    lede: 'Basic plus active sourcing, a recruitment packet, an assessment process, and interviews.',
    services: [
      'Everything in Basic',
      'Active candidate sourcing', 'Passive candidate recruitment', 'Community profile and brochure',
      'Online assessment', 'Video interviews', 'Finalist interview and assessment center'
    ],
    // Recruited, not just posted: the dashboard adds outreach and interviews,
    // and the full phase list sits underneath because there is more to run.
    view: {
      layout: 'dashboard',
      kicker: 'Recruited search',
      lede: 'Post and recruit. Work the market by hand, screen and interview on video, then put finalists through an assessment day.',
      panels: ['committee', 'posting', 'sourcing', 'applicants', 'interviews', 'recommendation'],
      steps: 'phases'
    }
  },
  executive: {
    key: 'executive',
    rank: 2,
    label: 'Executive',
    fee: '$15,000 to $25,000+',
    lede: 'The full retained search: everything in Enhanced, plus reference checks, the employment agreement, and the first-year evaluation.',
    services: [
      'Everything in Enhanced',
      'Reference checks', 'Executive recruitment', 'Model employment contract',
      'Annual executive performance evaluation'
    ],
    // Reference checks, sourcing, and video interviews are staff steps in the
    // catalog below. "Executive recruitment" is the whole retained process, not
    // a step of its own.
    //
    // The retained search keeps the step-by-step spec: every phase, every
    // step, the roster, and the packet. It is the process the client bought.
    view: {
      layout: 'spec',
      kicker: 'Retained executive search',
      lede: 'The full process. Seat the committee, build the profile from their answers, research and post, recruit, screen, interview, check references, and hand over a contract and a first-year evaluation.',
      panels: [],
      steps: 'phases'
    }
  }
};
const DEFAULT_PACKAGE = 'executive';

// The proposal table: one row per service, `pkg` is the cheapest engagement
// that includes it. The UI draws this as a comparison matrix so a consultant
// can see, at each fee, what the client actually bought. Keep the wording
// aligned with `services` above; the cards and the matrix are the same offer.
const COMPARE_BANDS = [
  { key: 'basic', t: 'On every engagement' },
  { key: 'enhanced', t: 'Enhanced and Executive add' },
  { key: 'executive', t: 'Executive only' }
];
const COMPARE = [
  { t: 'Position profile', pkg: 'basic' },
  { t: 'Job announcement', pkg: 'basic' },
  { t: 'Online advertising', pkg: 'basic' },
  { t: 'Applicant tracking', pkg: 'basic' },
  { t: 'Resume screening', pkg: 'basic' },
  { t: 'AI candidate screening', pkg: 'basic' },
  { t: 'Candidate recommendation', pkg: 'basic' },
  { t: 'Active candidate sourcing', pkg: 'enhanced' },
  { t: 'Passive candidate recruitment', pkg: 'enhanced' },
  { t: 'Community profile and brochure', pkg: 'enhanced' },
  { t: 'Online assessment', pkg: 'enhanced' },
  { t: 'Video interviews', pkg: 'enhanced' },
  { t: 'Finalist interview and assessment center', pkg: 'enhanced' },
  { t: 'Reference checks', pkg: 'executive' },
  { t: 'Executive recruitment', pkg: 'executive' },
  { t: 'Model employment contract', pkg: 'executive' },
  { t: 'Annual executive performance evaluation', pkg: 'executive' }
];

// `pkg` is the smallest package that includes the step. Steps a package leaves
// out are not "optional" there; they are not on the file at all.
//
// `kind:'staff'` marks work the firm does by hand and records on the file:
// calling sitting managers, running video interviews, checking references.
// Nothing is drafted for these; a consultant logs what was done and marks the
// step complete. Slate is the record, not the worker.
const STEPS = [
  { n:1,  key:'team',       t:'Seat the search committee and name the account manager', opt:false, phase:0, needs:[], pkg:'basic' },
  { n:2,  key:'intake',     t:'Collect what each member is looking for', opt:false, phase:0, needs:['team'], pkg:'basic' },
  { n:3,  key:'profile',    t:'Adopt the candidate profile', opt:false, phase:1, needs:['intake'], pkg:'basic' },
  { n:4,  key:'community',  t:'Develop community and form-of-government profile', opt:false, phase:1, needs:['profile'], pkg:'enhanced' },
  { n:5,  key:'survey1',    t:'Develop initial candidate survey', opt:false, phase:1, needs:['profile'], pkg:'basic' },
  { n:6,  key:'guide',      t:'Develop interview questions and assessment scenarios', opt:false, phase:1, needs:['profile'], pkg:'enhanced' },
  { n:7,  key:'survey2',    t:'Develop semifinalist survey', opt:true,  phase:1, needs:['guide'], pkg:'enhanced' },
  { n:8,  key:'plan',       t:'Develop recruitment and advertising locations', opt:false, phase:1, needs:['profile'], pkg:'basic' },
  { n:9,  key:'brochure',   t:'Develop recruitment brochure', opt:false, phase:1, needs:['profile','community','plan'], pkg:'enhanced' },
  { n:10, key:'ads',        t:'Develop recruitment advertisement', opt:false, phase:1, needs:['plan','brochure'], pkg:'basic' },
  { n:11, key:'sourcing',   t:'Source and recruit candidates', opt:false, phase:1, needs:['plan'], pkg:'enhanced', kind:'staff' },
  { n:12, key:'screen',     t:'Screen candidate surveys', opt:false, phase:2, needs:['survey1'], pkg:'basic' },
  { n:13, key:'send2',      t:'Send semifinalist survey', opt:true,  phase:2, needs:['survey2'], needsCandidates:true, pkg:'enhanced' },
  { n:14, key:'video',      t:'Hold video interviews with semifinalists', opt:false, phase:2, needs:['screen'], needsCandidates:true, pkg:'enhanced', kind:'staff' },
  { n:15, key:'finalists',  t:'Select finalists', opt:false, phase:2, needs:['screen'], needsCandidates:true, pkg:'basic' },
  { n:16, key:'schedule',   t:'Develop finalist interview and assessment center process', opt:false, phase:2, needs:['finalists','guide'], needsCandidates:true, pkg:'enhanced' },
  { n:17, key:'references', t:'Check finalist references', opt:false, phase:2, needs:['finalists'], needsCandidates:true, pkg:'executive', kind:'staff' },
  { n:18, key:'contract',   t:'Develop model employment contract', opt:true,  phase:2, needs:['finalists'], needsCandidates:true, pkg:'executive' },
  { n:19, key:'bar',        t:'Develop annual executive performance evaluation process', opt:true,  phase:2, needs:['profile'], needsCandidates:true, pkg:'executive' }
];

const STAFF_STEPS = new Set(STEPS.filter(s => s.kind === 'staff').map(s => s.key));

// Which candidates a staff step's log entries may be tied to. Sourcing is
// outreach to people who are not on the file yet, so it takes no candidate.
const STAFF_STAGES = {
  video: ['semifinalist', 'finalist'],
  references: ['finalist']
};

function packageOf(value){
  return PACKAGES[value] ? value : DEFAULT_PACKAGE;
}

function includes(pkg, step){
  return PACKAGES[packageOf(pkg)].rank >= PACKAGES[step.pkg || 'basic'].rank;
}

/**
 * The steps a package runs, with `needs` trimmed to steps that are also on the
 * file. A Basic search has no brochure, so its ads cannot wait on one; the ad
 * plan is what gates them there.
 */
function stepsFor(pkg){
  const list = STEPS.filter(s => includes(pkg, s));
  const keys = new Set(list.map(s => s.key));
  return list.map(s => ({ ...s, needs: (s.needs || []).filter(k => keys.has(k)) }));
}

module.exports = { PHASES, STEPS, STAFF_STEPS, STAFF_STAGES, PACKAGES, PACKAGE_ORDER, DEFAULT_PACKAGE, COMPARE, COMPARE_BANDS, packageOf, includes, stepsFor };
