'use strict';

// Product-owned ballot: administrators manage collection, not the options.
// Keep an opened search's version and answers intact when this bank changes.
const VERSION = 'candidate-needs-v1';
const CATEGORIES = {
  skill: ['Strategic leadership','Financial management','Organizational management','Community engagement','Economic development','Intergovernmental relations','Staff leadership','Communication'],
  trait: ['Collaborative','Approachable','Ethical','Innovative','Decisive','Strategic thinker','Good listener','Accountable','Resilient','Transparent'],
  chall: ['Financial pressures','Staffing/recruitment','Infrastructure needs','Organizational culture','Growth management','Community divisions','Aging facilities','Public safety','Service delivery challenges'],
  opp: ['Economic development','Organizational innovation','New partnerships','Technology improvements','Community development','Strategic growth','Regional collaboration','Improved employee engagement']
};
const qualities = () => Object.entries(CATEGORIES).flatMap(([kind, labels]) => labels.map(label => ({kind,label})));

function initialize(search){
  const intake = search.intake;
  if (!intake || intake.questionnaireVersion || !['draft','open'].includes(intake.status)
      || Object.keys(intake.responses || {}).length || intake.legacy) return false;
  intake.questionnaireVersion = VERSION;
  intake.qualities = qualities();
  return true;
}

module.exports = { VERSION, CATEGORIES, qualities, initialize };
