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
  { id:0, key:'convene', t:'Part 1 \u00b7 Committee input', lede:'Who is on this search, who runs it, and what each member is actually looking for. The profile is built from their answers, not from one person recalling the workshop.' },
  { id:1, key:'recruit', t:'Part 2 \u00b7 Prepare and post', lede:'Profile, community, surveys, and the ad plan. Then the brochure and ads you actually post.' },
  { id:2, key:'people', t:'Part 3 \u00b7 Candidate evaluation', lede:'Screening is where applicants enter the file. Everything after that waits until someone is on it.' }
];

// Operational workflows retain the persisted package keys for existing searches.
// Commercial plans and pricing are owned by Clerk; the original catalog is
// preserved in docs/audits/2026-09-19-user-guidance-candidate-portal/CLERK_PLAN_MIGRATION.json.
const PACKAGE_ORDER = ["basic","enhanced","executive"];
const PACKAGES = {
  "basic": {
    "key": "basic",
    "rank": 0,
    "label": "Posting and screening",
    "lede": "Committee input, position profile, advertising, applicant screening and recommendations.",
    "services": [
      "Position profile",
      "Job announcement",
      "Online advertising",
      "Applicant tracking",
      "Resume screening",
      "Candidate screening workspace (human decisions)",
      "Candidate recommendation"
    ],
    "view": {
      "layout": "dashboard",
      "kicker": "Posting and screen",
      "lede": "Announce the job, track who applies, screen them against the profile the committee adopted, and hand the client a recommendation.",
      "panels": [
        "committee",
        "posting",
        "applicants",
        "recommendation"
      ],
      "steps": "strip"
    }
  },
  "enhanced": {
    "key": "enhanced",
    "rank": 1,
    "label": "Recruited search",
    "lede": "Posting and screening with community research, sourcing, assessments and interviews.",
    "services": [
      "Position profile",
      "Job announcement",
      "Online advertising",
      "Applicant tracking",
      "Resume screening",
      "Candidate screening workspace (human decisions)",
      "Candidate recommendation",
      "Active candidate sourcing",
      "Passive candidate recruitment",
      "Community profile and brochure",
      "Online assessment",
      "Video interviews",
      "Finalist interview and assessment center"
    ],
    "view": {
      "layout": "dashboard",
      "kicker": "Recruited search",
      "lede": "Post and recruit. Work the market by hand, screen and interview on video, then put finalists through an assessment day.",
      "panels": [
        "committee",
        "posting",
        "sourcing",
        "applicants",
        "interviews",
        "recommendation"
      ],
      "steps": "phases"
    }
  },
  "executive": {
    "key": "executive",
    "rank": 2,
    "label": "Full search",
    "lede": "The complete search workflow, including references, contract and first-year evaluation.",
    "services": [
      "Position profile",
      "Job announcement",
      "Online advertising",
      "Applicant tracking",
      "Resume screening",
      "Candidate screening workspace (human decisions)",
      "Candidate recommendation",
      "Active candidate sourcing",
      "Passive candidate recruitment",
      "Community profile and brochure",
      "Online assessment",
      "Video interviews",
      "Finalist interview and assessment center",
      "Reference checks",
      "Executive recruitment",
      "Model employment contract",
      "Annual executive performance evaluation"
    ],
    "view": {
      "layout": "spec",
      "kicker": "Retained executive search",
      "lede": "The full process. Assemble the committee, build the profile from their answers, research and post, recruit, screen, interview, check references, and hand over a contract and a first-year evaluation.",
      "panels": [],
      "steps": "phases"
    }
  }
};
const DEFAULT_PACKAGE = 'executive';

// `pkg` is the smallest package that includes the step. Steps a package leaves
// out are not "optional" there; they are not on the file at all.
//
// `kind:'staff'` marks work the firm does by hand and records on the file:
// calling sitting managers, running video interviews, checking references.
// Nothing is drafted for these; a consultant logs what was done and marks the
// step complete. Slate is the record, not the worker.
const STEPS = [
  { n:1,  key:'team',       t:'Add the search committee and name the account manager', opt:false, phase:0, needs:[], pkg:'basic' },
  { n:2,  key:'intake',     t:'Committee questionnaire', opt:false, phase:0, needs:['team'], pkg:'basic' },
  { n:3,  key:'profile',    t:'Adopt the candidate profile', opt:false, phase:0, needs:['intake'], pkg:'basic' },
  { n:4,  key:'community',  t:'Develop community and form-of-government profile', opt:false, phase:1, needs:['profile'], pkg:'enhanced' },
  { n:5,  key:'survey1',    t:'Prepare candidate questions', opt:false, phase:1, needs:['profile'], pkg:'basic' },
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

module.exports = { PHASES, STEPS, STAFF_STEPS, STAFF_STAGES, PACKAGES, PACKAGE_ORDER, DEFAULT_PACKAGE, packageOf, includes, stepsFor };
