'use strict';

/**
 * The user guide.
 *
 * One catalog, read by the in-app help drawer, the searchable help screen, the
 * printable guide, and the candidate portal. See ./schema.js for the template
 * every article follows and for the checks that keep it matching the build.
 *
 * Wording rule: numbered steps quote the control the user will actually see,
 * in the capitalisation the interface uses. When a label is conditional the
 * article says both forms rather than picking one, because a reader looking at
 * the other one has no way to tell the guide is talking about their screen.
 *
 * `reviewed` is the date the article was last written against the code. It is
 * deliberately not a claim that anybody ran the described steps on a deployed
 * build: `verifiedRelease` stays null until someone does that and records
 * which release they did it on.
 */

const REVIEWED = '2026-09-19';

// Nothing in this file has been walked through against a running deployment
// yet. The help screen prints this state rather than implying verification
// that has not happened.
const VERIFIED_RELEASE = null;

const articles = [
  /* --- Start here ------------------------------------------------------- */
  {
    id: 'first-sign-in',
    title: 'Sign in for the first time',
    summary: 'Get into the right workspace and find the work that is waiting for you.',
    audience: ['admin', 'consultant', 'committee'],
    screens: ['home'],
    checklist: [
      'Create an account, or sign in with the address your invitation was sent to.',
      'Confirm your name and choose how you will use Slate.',
      'Create or join the right organization workspace.',
      'Open your assigned search, or start your first search on Home.'
    ],
    who: 'Anyone opening Slate for the first time, in any role.',
    before: [
      'An email address for your account. Select **Sign up** if you are new. Creating an account does not buy a subscription or grant access to another organization.',
      'The address the invitation was sent to. Signing in with a different one puts you in an account with no workspace.'
    ],
    doThis: [
      { do: 'Open the link in the invitation, or go to the application and select **Sign in**.' },
      { do: 'Sign in with the invited email address.', note: 'If you already have an account on another address, use **Sign out** and try again, or select **Use a different account** on the invitation screen.' },
      { do: 'Complete account setup with your name and how you will use Slate, then select **Continue**.', note: 'Organizations and consultants create or join a workspace. Committee members join their invited workspace. Candidates choose **Browse openings** and verify their email on a job posting; no staff workspace is needed.' },
      { do: 'If an invitation is waiting, select **Accept and open**.', note: 'If none appears, select **Check invitations**. An invitation that has not been accepted is not membership.' },
      { do: 'For a new organization, enter a **Workspace name** and select **Create a workspace** when available.', note: 'Some deployments require an invitation. Creating a workspace makes you its administrator. Subscription prices and checkout are not yet available in the app; see **Subscriptions** for details.' },
      { do: 'Read the workspace name in the bar at the top of the page.', note: 'Firms are separate. A search you expect to see is not missing if you are in the wrong workspace — it is simply somewhere else.' },
      { do: 'On Home, select the search you were added to, or select **Start your first search** if you can create searches and the workspace is empty.' }
    ],
    worked: [
      'The top bar shows the firm name, and the left navigation lists Home.',
      'Home lists at least one search, or tells you plainly that nothing has been assigned to you yet.'
    ],
    whoSees: [
      'Nothing you do here is visible to anyone else. Signing in does not notify the search team.'
    ],
    next: [
      { article: 'navigate-a-search', label: 'Find your way around a search' },
      { article: 'submit-committee-input', label: 'Committee members: answer your questionnaire' },
      { article: 'create-a-search', label: 'Consultants: open a new search' }
    ],
    recovery: [
      'Signed in but no workspace: select **Check my workspaces**, then **My access** in the left navigation to see exactly what you hold.',
      'Signed in, in a workspace, but no searches: your workspace membership is real and your search assignment has not been made. Select **Check for assignments**, then ask the search manager.',
      'Wrong workspace: use the workspace name in the left navigation to switch, or **Switch workspace** on the access screen.'
    ],
    related: ['no-assignment', 'glossary-orientation'],
    reviewed: REVIEWED
  },

  {
    id: 'navigate-a-search',
    title: 'Find your way around a search',
    summary: 'What the overview tells you, what the sections in the left navigation are for, and how to find the next thing to do.',
    audience: ['admin', 'consultant', 'committee'],
    // The most-opened screen in the application, and the three windows onto it.
    screens: ['overview', 'process', 'activity', 'documents', 'interviews'],
    checklist: [
      'The overview answers one question: what to do next.',
      'The getting-started checklist lists what is outstanding for you.',
      'The left navigation groups the work into sections.',
      'Process checklist shows every step and what each one is waiting on.'
    ],
    who: 'Anyone who has opened a search and is not sure where to look.',
    before: ['Nothing. This is orientation.'],
    doThis: [
      { do: 'Read the action at the top of the overview.', note: 'It names one next step and opens it. If there is nothing for you to do, the page says so rather than leaving you to read an empty screen as a fault.' },
      { do: 'Work down the <b>Getting started</b> list.', note: 'It is built from the state of this search, for your role, and it only lists what is genuinely outstanding. Hiding it is per search; <b>Help & user guide</b> brings it back.' },
      { do: 'Use the sections in the left navigation to reach work that already exists.', note: 'Candidates, Interviews, Committee, Documents and Activity are windows onto the same file. A section you cannot see has nothing on this search that you are entitled to open.' },
      { do: 'Open <b>Process checklist</b> for the whole sequence.', note: 'Every step shows its state and, when it is waiting, which earlier step it is waiting on.' },
      { do: 'Open <b>Activity</b> to see what has happened and who did it.' }
    ],
    worked: [
      'You can name the next thing to do without asking anybody.',
      'You can tell a step that is blocked from one that is simply not on this search.'
    ],
    whoSees: [
      'Nothing. Reading a search is not recorded against you, and moving around it changes nothing.'
    ],
    next: [{ article: 'no-assignment', label: 'When something you expected is not there' }],
    recovery: [
      'A step is missing entirely: the service package decides which steps are on the file. The overview names what is not on this search.',
      'A step is there but will not open: it is waiting on an earlier one, and the page says which.',
      'An action is missing rather than disabled: some decisions belong to the search manager, and the screen names who holds the account.'
    ],
    related: ['no-assignment', 'glossary-orientation'],
    reviewed: REVIEWED
  },

  /* --- Consultant and manager ------------------------------------------- */
  {
    id: 'create-a-search',
    title: 'Open a new search',
    summary: 'Create the file, choose the package that matches what the client bought, and enter the facts the rest of the process is built from.',
    audience: ['consultant', 'admin'],
    screens: ['new', 'facts'],
    checklist: [
      'Select New search.',
      'Enter the client, the position, and the jurisdiction type.',
      'Open Search facts to choose the search workflow.',
      'Save, then fill in the search facts.'
    ],
    who: 'A consultant or administrator in a workspace that allows creating searches. Committee members do not see this screen.',
    before: [
      'The scope of work, so the search workflow includes the steps your team needs. Organization subscriptions are managed separately.',
      'The jurisdiction name, its type (city, county, town, district), and its official website.'
    ],
    doThis: [
      { do: 'Select **New search** in the left navigation.' },
      { do: 'Enter the client and the position being filled.' },
      { do: 'Choose the jurisdiction type.', note: 'This sets the vocabulary the rest of the file uses — council or board, manager or administrator.' },
      { do: 'After saving, choose the search workflow on **Search facts**: Posting and screening, Recruited search, or Full search.', note: 'Steps a package leaves out are not hidden, they are not on the file. Changing it later on **Search facts** adds or removes steps, so choose from the engagement rather than from habit.' },
      { do: 'Save the search.' },
      { do: 'Open **Search facts** from Search settings in the left navigation and fill in population, budget, salary, and the official website.', note: 'Select **Save facts** when you are done.' }
    ],
    worked: [
      'The top of the page shows the search number, the position, and the package.',
      'Home lists the new search, and you are shown on its roster as the account manager.'
    ],
    whoSees: [
      'Everyone in the firm\'s workspace who can open searches. Committee members see nothing until you add them to the roster.',
      'No candidate and no member of the public can see any of it. Nothing is published by creating a search.'
    ],
    next: [{ article: 'assemble-a-committee', label: 'Add the search committee' }],
    recovery: [
      'Wrong package: open **Search facts** and change it. Work already saved against a step that the new package leaves off the file stays stored and stops being shown.',
      'Created in the wrong workspace: a search cannot be moved between firms. Archive it and create it again in the right workspace.'
    ],
    related: ['close-and-archive'],
    reviewed: REVIEWED
  },

  {
    id: 'assemble-a-committee',
    title: 'Add the search committee and name the account manager',
    summary: 'Put the people who will hire on the file before anybody writes a profile.',
    audience: ['consultant', 'admin'],
    screens: ['team', 'committee'],
    steps: ['team'],
    checklist: [
      'Add each committee member by name and email.',
      'Name one account manager.',
      'Select Roster is set.',
      'Check whether anyone is still shown as a held place.'
    ],
    who: 'The account manager for the search. Other consultants can read the roster; adding and removing people is the manager\'s.',
    before: [
      'The list of committee members and their email addresses.',
      'Agreement on who runs the account. There is exactly one account manager per search.'
    ],
    doThis: [
      { do: 'Open the search, then **Committee** in the left navigation, then the roster.' },
      { do: 'Add each member with their name, email, and role on this search.', note: 'A place is held against the email address of anyone who is not yet in the workspace. A held place is not access: they get nothing until they accept a workspace invitation and sign in.' },
      { do: 'If the account should sit with someone else, select **Hand over the account** beside their name.', note: 'An administrator sees **Reassign the account** instead and can use it when the manager is unreachable.' },
      { do: 'When the roster is complete, select **Roster is set**.', note: 'This is what unlocks the intake window. Selecting **Reopen the roster** puts it back.' }
    ],
    worked: [
      'Every member is listed with a role, and exactly one row reads as the account manager.',
      'The committee step reads as done, and the intake window can be opened.'
    ],
    whoSees: [
      'Committee members see the roster and each other once they can open the search.',
      'Adding someone sends nothing by itself. Slate has no mail server for staff invitations; the workspace invitation from **Team & access** is what actually reaches them.'
    ],
    next: [{ article: 'submit-committee-input', label: 'Open the intake window and collect input' }],
    recovery: [
      'Somebody cannot see the search: check whether they are a held place rather than a member. A held place shows their email, not their name.',
      'Wrong person added: select **Remove** beside them. Anything they already submitted stays on the record under their name.',
      'Nobody can act because the manager has left: a workspace administrator can reassign the account.'
    ],
    related: ['invite-and-roles', 'no-assignment'],
    reviewed: REVIEWED
  },

  {
    id: 'invite-and-roles',
    title: 'Invite someone to the workspace and set their role',
    summary: 'Workspace membership opens the door. A search assignment is what puts work in front of them.',
    audience: ['admin'],
    screens: ['team-access'],
    checklist: [
      'Open Team & access.',
      'Send the invitation from the Invitations tab.',
      'Check the role you chose is the one you meant.',
      'Have the search manager add them to the search.'
    ],
    who: 'A workspace administrator. Consultants and committee members do not see this screen.',
    before: [
      'The person\'s email address.',
      'A decision about their role: administrator, consultant, or committee member. They cannot choose a different one when they accept.'
    ],
    doThis: [
      { do: 'Select **Team & access** in the left navigation.' },
      { do: 'Open the **Invitations** tab.' },
      { do: 'Enter the email address, choose the role, and select **Send invitation**.' },
      { do: 'Once they accept, ask the search manager to add them to the search they are needed on.', note: 'These are two separate things. Membership without an assignment is the most common reason somebody signs in to an empty Home.' }
    ],
    worked: [
      'The invitation appears in the Invitations tab marked "Invitation sent".',
      'After they accept, they move to the Members tab with the role you chose.'
    ],
    whoSees: [
      'Other administrators see the member and invitation lists.',
      'The invited person receives an email from the identity provider.'
    ],
    next: [{ article: 'assemble-a-committee', label: 'Add them to a search' }],
    recovery: [
      'Invited the wrong address: select **Revoke** beside the invitation. Revoking does not remove anybody who already accepted, and it does not release a place held for that address on a search.',
      'Wrong role: change it in the Members tab. A role change takes effect on that person\'s next request.',
      'Removing a member ends their access to every search in this workspace. Their scores, notes, and history stay on the record under their name.'
    ],
    related: ['no-assignment', 'first-sign-in'],
    reviewed: REVIEWED
  },

  /* --- Committee --------------------------------------------------------- */
  {
    id: 'submit-committee-input',
    title: 'Save and submit your committee input',
    summary: 'In Step 2, contribute the skills, traits, challenges, and opportunities you want in the candidate profile. The search manager reviews the committee’s answers and adopts the profile in Step 3.',
    audience: ['committee', 'consultant'],
    screens: ['intake', 'intake-mine', 'committee'],
    steps: ['intake'],
    checklist: [
      'Open your questionnaire from the search.',
      'Name your priorities for the four candidate profile categories and rate how much each matters.',
      'Use Save and finish later while you are still thinking.',
      'Use Submit my answers when you want them counted.'
    ],
    who: 'Every member of the search committee, including the consultants on the file. Your own answers are counted in the tally too.',
    before: [
      'The organization administrator may skip the committee questionnaire for this search. If the screen says it was skipped, no response is required; you can still review candidates later.',
      'The intake window has to be open. If it is not, the screen says so and the search manager opens it.',
      'Nothing else. There is no preparation and no right answer; the profile is built from what the room actually says.'
    ],
    doThis: [
      { do: 'Open the search and select **Answer your questionnaire**, or **Open your questionnaire** if you have started one.' },
      { do: 'If you are managing Step 2, confirm the roster and open the response window. The standard questionnaire supplies the same qualities for everyone; administrators do not select the ballot.', note: 'Four questions cover skills, leadership traits, community challenges, and opportunities. Every listed quality needs a 1–5 rating before submission. Existing questionnaires with saved answers retain their original questions.' },
      { do: 'If you are managing Step 2, select **Add my profile input**, or **Review my profile input** after submitting.', note: 'The response window must be open. These are your individual priorities; the shared candidate profile is reviewed and adopted in Step 3.' },
      { do: 'Answer the four questions: what this person must already know how to do, what kind of person works here, what they are walking into, and what they could build. For each quality, click an importance rating from 1 (nice to have) to 5 (decisive), and use **Explain why** to give the reason for your rating.' },
      { do: 'Select **Save and finish later** at any point.', note: 'This is a private draft. It changes nothing that you have already submitted, and nobody else can read it.' },
      { do: 'When you are ready, select **Submit my answers**.', note: 'After a first submission the same control reads **Update my answers**. Updating replaces your submitted answer; the previous one stays in the record.' }
    ],
    worked: [
      'The page states that your answers were submitted, with the time.',
      'The committee screen counts you among the members who have responded.'
    ],
    whoSees: [
      'A private draft: nobody but you.',
      'A submitted answer while the window is open: the firm\'s staff on this search.',
      'After the window closes: everyone on this search, including the other committee members. Say it the way you would be willing to have it read.'
    ],
    next: [{ article: 'adopt-the-profile', label: 'What happens to your answers next' }],
    recovery: [
      'You changed your mind before anybody reads it: select **Withdraw my answers**. The submission is retracted and your draft stays.',
      'You have the same questionnaire open in two places: Slate detects the conflict and asks you to choose **Keep what is on this page** or **Use the version saved elsewhere**. Nothing is discarded until you pick.',
      'A save failed: your text stays in the form. Copy it somewhere safe before reloading the page.'
    ],
    related: ['recover-unsaved-work', 'adopt-the-profile'],
    reviewed: REVIEWED
  },

  {
    id: 'adopt-the-profile',
    title: 'Adopt the candidate profile',
    summary: 'Build the criteria every candidate is scored against, using committee input when the questionnaire is included.',
    audience: ['consultant'],
    screens: ['profile', 'intake'],
    steps: ['profile', 'intake'],
    checklist: [
      'Close the intake window.',
      'Select Build from committee.',
      'Review what adoption would change before saving.',
      'Save the profile.'
    ],
    who: 'The search manager adopts the profile. Consultants can prepare and preview it.',
    before: [
      'The questionnaire is optional per search. After confirming the roster, an organization administrator can select **Skip questionnaire and continue** in Step 2. Write and weight the profile directly, then select **Save profile**. To collect input later, return to Step 2 and select **Include committee questionnaire**, then have the account manager open the window.',
      'When collecting committee input, enough members have submitted that the tally means something. The screen shows who has and has not.',
      'The intake window closed, using **Close and read the room**. Rebuilding from committee is unavailable while it is open.'
    ],
    doThis: [
      { do: 'Open **Committee**, then the intake screen, and select **Close and read the room**.', note: 'Closing also makes submitted answers readable by everyone on the search. Tell the committee before you do it.' },
      { do: 'Open Step 3, **Review committee input**. Compare the combined ratings and every explanation, including current challenges, future opportunities, and members’ written context.', note: 'Step 2 collects individual answers. Step 3 is the administrator’s review and adoption step; committee members see a read-only profile once it is available.' },
      { do: 'Review the score-ranked qualities. The score is the average submitted 1–5 rating, and the top five in each category are initially selected. Choose 3–5 favorites per category, then select **Review what this would change**.', note: 'Review the response count, explanations, and disagreements. Tied scores are shown alphabetically; that ordering does not imply stronger agreement. Private drafts are never scored.' },
      { do: 'Read the preview. It names which committee priorities become criteria and what an adoption would change.', note: 'The same review is available from **Review what this would change** without committing anything.' },
      { do: 'Select **Save this profile**, then finalize the wording, explanations, and importance ratings. You can select suggested qualities or add your own.', note: 'If the questionnaire was skipped, Step 3 opens directly to profile writing. Suggestions remain visible while you choose; Hide suggestions collapses them when you are finished.' }
    ],
    worked: [
      'The profile lists criteria with weights, and each line that came from the committee says so.',
      'The profile revision number increases, and the adoption is recorded with the evidence it rested on at that moment.'
    ],
    whoSees: [
      'Everyone on the search. The adopted profile is the committee\'s product.',
      'Candidates never see it. It is the scoring standard, not a published document.'
    ],
    next: [{ article: 'research-and-sources', label: 'Research the community' }],
    recovery: [
      'Adopted too early: reopen the intake window, collect the rest, and rebuild. The earlier adoption stays in history with its own evidence.',
      'Restoring an older profile from **History and recovery** clears current scores, because those scores were given against different criteria. The page says so before you do it.'
    ],
    related: ['submit-committee-input', 'score-and-release', 'recover-unsaved-work'],
    reviewed: REVIEWED
  },

  {
    id: 'research-and-sources',
    title: 'Research the community and review what came back',
    summary: 'Read public sources into the community profile and the search facts, then check them before anything is drafted from them.',
    audience: ['consultant'],
    screens: ['community', 'verify', 'facts'],
    steps: ['community'],
    packages: ['enhanced', 'executive'],
    checklist: [
      'Enter the jurisdiction and its official website.',
      'Run the research.',
      'Review each fact against its source.',
      'Save the facts you have checked.'
    ],
    who: 'A consultant on the file. This step is on Recruited search and Full search workflows; Posting and screening does not include it.',
    before: [
      'The jurisdiction\'s official website. Research without it reads whatever it can find, which is how a neighbouring town ends up in the brochure.',
      'Time to check the result. Nothing here is authoritative until a person has read it against a source.'
    ],
    doThis: [
      { do: 'Open **Documents**, then the community profile.' },
      { do: 'Enter the jurisdiction and its official website.' },
      { do: 'Start the research and leave the page if you want to.', note: 'The operation runs on the server and keeps running. Coming back to the search shows the same job rather than starting a new one.' },
      { do: 'When it finishes, select **Apply what it found**, or **Leave it for now** to keep the current text.' },
      { do: 'Open **County fact verification** and check each figure against the source named beside it.', note: 'Select **Save these facts** when you have checked them.' }
    ],
    worked: [
      'The community profile has text in each section, and the search facts carry population, budget, and salary.',
      'The verification screen shows no remaining gap.'
    ],
    whoSees: [
      'Everyone on the search. Research output is internal until it is deliberately used in a brochure or an advertisement.',
      'Nothing is published to candidates or to the public by running research.'
    ],
    next: [{ article: 'add-and-contact-candidates', label: 'Bring candidates onto the file' }],
    recovery: [
      'The research failed: select **Try research again**, or **Check what happened** to see how far it got. **Fill the facts by hand** is always available and is not a lesser outcome.',
      'It ran but the result is wrong: **Leave it for now** discards nothing you already had. Editing the community profile by hand is the normal fix.',
      'It appears stuck: **Reload this search** shows the current state of the job rather than the state the page was painted with.'
    ],
    related: ['recover-unsaved-work'],
    reviewed: REVIEWED
  },

  {
    id: 'add-and-contact-candidates',
    title: 'Add candidates, share questionnaires, and record contact',
    summary: 'Put applicants on the file, give them a questionnaire link, and keep an honest record of who was contacted.',
    audience: ['consultant'],
    screens: ['screen', 'person', 'people', 'send2', 'finalists'],
    steps: ['screen', 'send2'],
    checklist: [
      'Add the candidate.',
      'Copy their questionnaire link and send it yourself.',
      'Record the contact you made.',
      'Watch for the receipt when they submit.'
    ],
    who: 'A consultant on the file. Committee members read the candidate list and score; they do not add to it.',
    before: [
      'The initial candidate survey has to exist before a questionnaire link is worth sharing.',
      'A way to reach the candidate. Slate does not send mail to candidates: you send the link from your own email.'
    ],
    doThis: [
      { do: 'Open **Candidates** and add the candidate\'s name and contact details.' },
      { do: 'Select **Copy invite link**, or **Copy invite** on the candidate\'s own screen.', note: 'This copies the link. It does not send an email and it does not notify the candidate.' },
      { do: 'Send the link from your own email, then select **Record this contact** on the candidate and say what you sent.', note: 'The log records that staff say they made contact. Slate has no delivery confirmation and does not claim one.' },
      { do: 'For semifinalists, select **Open questionnaire** on the candidate, or **Open for all semifinalists** from the list.', note: 'Opening access does not send anything either. Copy the link and contact them.' },
      { do: 'Record externally held documents with **Record this document**.', note: 'Slate stores the reference and where the document lives; the document itself stays in the approved repository.' }
    ],
    worked: [
      'The candidate appears in the list with a stage and a questionnaire state.',
      'When they submit, the candidate shows a receipt with the time it arrived.'
    ],
    whoSees: [
      'Everyone on the search sees the candidate list. Committee members see candidates and their submitted responses.',
      'The candidate sees only their own questionnaire. They cannot see other candidates, the committee, notes, or scores.'
    ],
    next: [{ article: 'score-and-release', label: 'Score candidates and release scores' }],
    recovery: [
      'The link went to the wrong person: select **Replace candidate link**. The old link stops working immediately, and you share the new one.',
      'A candidate needs to change a submitted answer: select **Reopen initial questionnaire** or **Reopen semifinalist questionnaire**. Their original response stays in history.',
      'A candidate says they submitted and you cannot see it: ask them to reload their link. The receipt is shown on their page, and it is the same submission you are looking for.'
    ],
    related: ['review-applications', 'score-and-release'],
    reviewed: REVIEWED
  },

  {
    id: 'score-and-release',
    title: 'Score candidates and release scores to the committee',
    summary: 'Everyone scores privately. Releasing is a deliberate, named decision that makes the panel visible.',
    audience: ['consultant', 'committee'],
    screens: ['person', 'screen'],
    steps: ['screen'],
    checklist: [
      'Open the candidate.',
      'Rate each criterion and write your note.',
      'Select Save my scores.',
      'The search manager selects Release scores when the panel should see each other.'
    ],
    who: 'Every member of the search scores. Only the search manager releases or reseals.',
    before: [
      'An adopted candidate profile. The criteria you score against come from it.',
      'Whatever the candidate submitted, which is shown beside the scorecard.'
    ],
    doThis: [
      { do: 'Open **Candidates** and select the candidate.' },
      { do: 'Rate each criterion from 1 to 5 and add your note.', note: 'On a narrow screen the evidence and the scorecard are two panels; switching between them keeps your unsaved entries.' },
      { do: 'Select **Save my scores**.' },
      { do: 'When the panel should see each other, the search manager selects **Release scores**.', note: 'The same control reads **Seal scores** afterwards.' }
    ],
    worked: [
      'Your scores are shown as saved, with your note beside them.',
      'After release, every member on the search sees the whole panel rather than only their own marks.'
    ],
    whoSees: [
      'Before release: you see your own scores. Staff see the panel.',
      'After release: everyone on the search sees everyone\'s scores and notes.',
      'Resealing hides them again, but it cannot recall an export somebody already took. The confirmation says so.'
    ],
    next: [{ article: 'close-and-archive', label: 'Record outcomes and close the search' }],
    recovery: [
      'Scored against the wrong profile: adopting a new profile is recorded with a revision, and history shows which revision each set of scores was given against.',
      'Released too early: **Seal scores** hides them again. Assume the committee has already read them.',
      'A save failed: your entries stay on the page. Do not reload until you have copied anything long.'
    ],
    related: ['adopt-the-profile', 'recover-unsaved-work'],
    reviewed: REVIEWED
  },

  /* --- Recovery and closure ---------------------------------------------- */
  {
    id: 'recover-unsaved-work',
    title: 'Recover unsaved, conflicting, or failed work',
    summary: 'What Slate does when a save fails, when two people edit the same thing, and when you are about to lose something.',
    audience: ['consultant', 'committee', 'admin'],
    screens: ['history', 'intake', 'profile'],
    checklist: [
      'Do not reload a page that is showing an error until you have copied anything long.',
      'Read which of the two messages you got: unsaved, or conflicting.',
      'Use History and recovery for anything that was saved and then replaced.'
    ],
    who: 'Anyone. Every role can hit these states.',
    before: [
      'Nothing. This article is for when something has already gone wrong.'
    ],
    doThis: [
      { do: 'If the page warns you about leaving with unsaved edits, stay and save first.', note: 'The warning appears on navigation, including browser Back. It is the last thing between you and losing what is in the form.' },
      { do: 'If a save fails, copy your text out of the form before doing anything else.', note: 'The text stays in the form on a failure. Reloading is what discards it.' },
      { do: 'If you are told the search changed since you opened it, copy your edits, select **Reload search**, and reapply them.', note: 'This is a genuine conflict: somebody else saved while you were typing, and overwriting them silently would lose their work instead of yours.' },
      { do: 'If your own answers were saved somewhere else, choose **Keep what is on this page** or **Use the version saved elsewhere**.', note: 'Nothing is discarded until you choose.' },
      { do: 'For anything that was saved and then replaced, open **History and recovery** from Search settings and select **Restore this copy**, **Restore this profile**, or **Restore this facts**.' }
    ],
    worked: [
      'The page stops showing the error and the save state reads as saved with a time.',
      'A restored revision becomes the current one, and the version it replaced appears in the history list.'
    ],
    whoSees: [
      'A restore is recorded in the activity log with your name.',
      'Restoring a profile clears current scores, which every scorer will see.'
    ],
    next: [{ article: 'close-and-archive', label: 'Close and archive when the search is finished' }],
    recovery: [
      'A draft you saved is gone: candidate and committee drafts expire. The expiry date is shown on the page that holds the draft.',
      'The whole search looks wrong: **History and recovery** lists previous revisions of documents, profiles, and facts, with who changed each one.',
      'Nothing in history covers it: contact the firm. Snapshots of the whole store are taken on a schedule and are an operator restore, not a self-service one.'
    ],
    related: ['submit-committee-input', 'adopt-the-profile'],
    reviewed: REVIEWED
  },

  {
    id: 'close-and-archive',
    title: 'Close the search, export the record, and archive it',
    summary: 'End the search deliberately, take the record you are entitled to, and file it where it can be restored.',
    audience: ['consultant', 'admin'],
    screens: ['closeout', 'archives', 'home'],
    checklist: [
      'Record the outcome for each candidate.',
      'Close the search.',
      'Export the record.',
      'Archive it from Home when the file is finished.'
    ],
    who: 'The search manager closes, reopens, and archives. Any consultant can export. An administrator can restore an archived search if the manager is unreachable.',
    before: [
      'Outcomes recorded for the candidates who need one. Recording an outcome is the manager\'s decision.',
      'Agreement that the search is over. Closing refuses every ordinary edit afterwards, which is the point.'
    ],
    doThis: [
      { do: 'Open the candidate and select **Record this outcome** for each candidate who needs one.' },
      { do: 'Open **Closeout and reopening** from the search overview and select **Close this search**.', note: 'A closed search refuses ordinary writes. Candidate questionnaires stop accepting responses and say so.' },
      { do: 'Select **Download the report** for the readable record, or **Download the data bundle** for the structured one.' },
      { do: 'From Home, select **Archive search** when the file should leave the book.', note: 'On the list, **Archive** and **Archive selected** do the same thing for one or several searches.' }
    ],
    worked: [
      'The search shows as closed at the top of every screen, and Save controls explain rather than silently failing.',
      'The archived search appears under **Archived searches**.'
    ],
    whoSees: [
      'Everyone on the search sees that it is closed.',
      'Archiving removes the search from Home for everyone in the workspace. Nothing is deleted.'
    ],
    next: [{ article: 'create-a-search', label: 'Open the next search' }],
    recovery: [
      'Closed too early: select **Reopen this search**. Reopening restores ordinary editing. It does not restore candidate links that were revoked, and it does not republish anything that was published.',
      'Archived by mistake: open **Archived searches** and select **Restore search**. Restoring grants no new membership and no candidate access; candidate links stay revoked and are reissued separately.',
      'A restored search does not reopen a public posting. Publishing again is a deliberate act.'
    ],
    related: ['publish-a-posting', 'recover-unsaved-work'],
    reviewed: REVIEWED
  },

  /* --- Public posting and applications (portal) --------------------------- */
  {
    id: 'publish-a-posting',
    title: 'Prepare and publish a public job posting',
    summary: 'Build the public job page from approved content, preview it, and publish it as a deliberate, versioned act.',
    audience: ['consultant', 'admin'],
    screens: ['posting'],
    checklist: [
      'Fill in every required field on Public posting.',
      'Preview the page exactly as an applicant sees it.',
      'The search manager selects Publish posting.',
      'Check the live address, and share that.'
    ],
    who: 'Consultants prepare and preview. Only the search manager publishes, pauses, closes, or republishes.',
    before: [
      'A decision that this search should be advertised publicly at all. Nothing is public until somebody publishes it.',
      'Approved wording for the position, the employer, the requirements, the application materials, the deadline policy, the support contact, and the privacy notice. The posting refuses to publish without them.'
    ],
    doThis: [
      { do: 'Open the search and select **Public posting**.' },
      { do: 'Fill in the posting fields. The screen lists what is still missing.', note: 'Workspace defaults fill in the support contact and privacy notice where the firm has set them; you can override either for this posting.' },
      { do: 'Choose the deadline policy: a hard closing date, or open until filled with an advisory first-review date.', note: 'Only the policy you choose is enforced. An advisory review date never closes applications.' },
      { do: 'Select **Preview posting** and read the page as an applicant would.' },
      { do: 'The search manager selects **Publish posting**.', note: 'This publishes a snapshot of the approved fields. Later edits to research, drafts, or search facts do not change the live page.' },
      { do: 'Copy the public address from the posting screen and use that in advertisements.' }
    ],
    worked: [
      'The posting screen shows a published state with a version number and the time it was published.',
      'Opening the public address in a signed-out browser shows the job page.'
    ],
    whoSees: [
      'Anyone with the address, with no account. That is the point of publishing.',
      'Only the fields on the posting. Internal research, notes, committee input, candidates, and scores are never part of it.'
    ],
    next: [{ article: 'review-applications', label: 'Review applications as they arrive' }],
    recovery: [
      'Published with a mistake: fix the field and select **Publish changes**. A published posting does not change until you republish it, so editing alone is safe.',
      'Need to stop applications temporarily: select **Pause applications**. The page stays readable and says it is not accepting applications.',
      'Recruitment is over but evaluation is not: select **Close applications**. The search stays open and you continue working the candidates you have.',
      'Closing or archiving the search stops public intake on its own. Restoring the search does not republish the posting.'
    ],
    related: ['review-applications', 'close-and-archive'],
    reviewed: REVIEWED
  },

  {
    id: 'review-applications',
    title: 'Review applications that arrive from the public portal',
    summary: 'Find new applications, read what was submitted, and bring an applicant into the ordinary candidate workflow.',
    audience: ['consultant'],
    screens: ['applications', 'screen'],
    checklist: [
      'Open New applications under Candidates.',
      'Read the submission and any materials.',
      'Reconcile it if it looks like someone already on the file.',
      'Accept it onto the candidate list.'
    ],
    who: 'A consultant on the file. Committee members see candidates once they are on the list, not applications before that.',
    before: [
      'A published posting that has received at least one submitted application.',
      'Nothing else. An application arrives complete or it says what is outstanding.'
    ],
    doThis: [
      { do: 'Open **Candidates**, then **New applications**.' },
      { do: 'Select an application to read the submitted answers, the materials, and the receipt.', note: 'You are reading a frozen snapshot of what was submitted. You do not need, and never see, the applicant\'s own recovery credential.' },
      { do: 'If Slate flags a possible match with an existing candidate, read both and choose.', note: 'Slate never merges records or reveals an existing candidate because somebody entered the same address. The decision is yours.' },
      { do: 'Select **Accept onto the candidate list**.', note: 'From there the applicant is an ordinary candidate: stages, questionnaires, screening, and scoring all work as they always have.' }
    ],
    worked: [
      'The application shows as accepted and the person appears in the candidate list with a source of "Public portal".',
      'The applicant\'s receipt is unchanged. Accepting is an internal step and is not a status message to them.'
    ],
    whoSees: [
      'Staff on the search see applications. Committee members do not see them until they are accepted onto the candidate list.',
      'Applicants see their own receipt only. They never learn whether they were accepted onto the list, scored, or shortlisted from anything in the portal.',
      'A draft application that was never submitted is not visible to staff or to the committee, and is not in any export.'
    ],
    next: [{ article: 'add-and-contact-candidates', label: 'Contact the candidate and share a questionnaire' }],
    recovery: [
      'Accepted the wrong application: remove the candidate in the ordinary way. The application record and its receipt stay.',
      'A material is shown as pending a virus scan: it is not available to reviewers until the scan completes. That is deliberate, and the state is honest rather than hidden.',
      'An applicant asks to correct a submitted application: a submitted application is a frozen snapshot. A staff-authorised correction creates a new version and keeps the original.'
    ],
    related: ['publish-a-posting', 'add-and-contact-candidates'],
    reviewed: REVIEWED
  },

  /* --- Candidate (public) ------------------------------------------------- */
  {
    id: 'candidate-apply',
    title: 'Apply for an opening',
    summary: 'Find a job, verify your email, save your application as you go, and submit it.',
    audience: ['candidate'],
    public: true,
    checklist: [
      'Read the job page, including the requirements and the closing date.',
      'Select Apply for this position.',
      'Verify your email address.',
      'Fill in the application, save as you go, and select Submit application.'
    ],
    who: 'Anyone applying for an advertised position. You do not need an account and you will never need an invitation.',
    before: [
      'An email address you can receive mail at. It is how you get back to a saved application.',
      'Any materials the posting requires. The job page lists them before you start.'
    ],
    doThis: [
      { do: 'Open the job page and read the requirements, the materials, and the deadline.' },
      { do: 'Select **Apply for this position**.' },
      { do: 'Enter your email address and the code that is sent to it.', note: 'The code proves the address is yours. It is the only thing standing between your saved application and anyone else who guesses the link.' },
      { do: 'Fill in the application. Select **Save draft** whenever you like.', note: 'Saving is not applying. Your application is not submitted until you select Submit application.' },
      { do: 'Read the review page, then select **Submit application**.' },
      { do: 'Keep the reference number on the confirmation.' }
    ],
    worked: [
      'The confirmation page shows a reference number and the exact time your application was received, with the timezone.',
      'Returning to the posting shows your receipt instead of an empty form.'
    ],
    whoSees: [
      'The search team at the recruiting firm sees your submitted application and your materials.',
      'A draft you never submit is not visible to them. It is not an application.',
      'Your application is not visible to other applicants, and applying to one firm tells no other firm anything.'
    ],
    next: [{ article: 'candidate-return', label: 'Come back to your application' }],
    recovery: [
      'The page closed before you submitted: open the posting again and verify your email. Your draft is there until it expires, and the page shows the expiry date.',
      'You submitted twice, or the page did not respond after you submitted: your application was received once. The confirmation shows the same reference number both times.',
      'The posting closed while you were filling it in: your work is preserved and the page gives you the contact for the search team. It does not claim your application was received.',
      'You need to correct something you already submitted, or you need an accommodation: use the support contact on the posting.'
    ],
    related: ['candidate-return'],
    reviewed: REVIEWED
  },

  {
    id: 'candidate-return',
    title: 'Come back to an application you started',
    summary: 'Reopen a saved draft, see your receipt, and understand what your application status does and does not mean.',
    audience: ['candidate'],
    public: true,
    checklist: [
      'Open the same job page.',
      'Verify your email address again.',
      'Your draft or your receipt is shown.'
    ],
    who: 'Anyone who has started or submitted an application.',
    before: [
      'Access to the email address you used. There is no password to remember and no password to lose.'
    ],
    doThis: [
      { do: 'Open the job page you applied through.' },
      { do: 'Select **Return to my application**.' },
      { do: 'Enter your email address and the code that is sent to it.' },
      { do: 'If you had a draft, it opens where you left it. If you submitted, your receipt is shown.' }
    ],
    worked: [
      'You see either your saved answers or your reference number and submission time.'
    ],
    whoSees: [
      'Only you. Verification is what proves the application is yours, and an unverified request is told nothing about whether an application exists.'
    ],
    next: [{ article: 'candidate-apply', label: 'How applying works' }],
    recovery: [
      'The code did not arrive: check spam, then request another. There is a limit on how often a code can be resent, and the page says when you can try again.',
      'Your draft has expired: drafts are kept for a limited time and the expiry is shown while the draft exists. You can start again.',
      'A receipt is not a hiring status. It means your application arrived. It does not mean you are under review, shortlisted, or rejected, and the portal will never imply otherwise. The search team contacts you directly.'
    ],
    related: ['candidate-apply'],
    reviewed: REVIEWED
  },

  /* --- Troubleshooting ---------------------------------------------------- */
  {
    id: 'no-assignment',
    title: 'You are signed in but there is nothing to work on',
    summary: 'The four separate things that have to be true before a search appears, and how to tell which one is missing.',
    audience: ['committee', 'consultant', 'admin'],
    screens: ['home'],
    checklist: [
      'Are you in the right workspace?',
      'Has your invitation been accepted, or is it still pending?',
      'Does your role allow what you are trying to do?',
      'Has the search manager added you to the search?'
    ],
    who: 'Anyone who signed in and found an empty Home, or an action that is not there.',
    before: ['Nothing.'],
    doThis: [
      { do: 'Select **My access** in the left navigation.', note: 'It states your workspaces, your role in each, and the searches you are on. It is the fastest way to tell these four states apart.' },
      { do: 'If a workspace is missing, select **Check my workspaces**.' },
      { do: 'If an invitation is pending, accept it. A pending invitation is not membership.' },
      { do: 'If the workspace and role are right but no searches are listed, select **Check for assignments**, then ask the search manager to add you.' }
    ],
    worked: [
      'My access names a workspace, a role, and at least one search.',
      'Home lists that search.'
    ],
    whoSees: [
      'Nothing you do here is visible to anyone else.'
    ],
    next: [{ article: 'first-sign-in', label: 'Signing in for the first time' }],
    recovery: [
      'An action is missing rather than disabled: some decisions belong to the search manager, and the screen names who holds the account.',
      'A step is not on the file at all: the service package decides which steps exist. The overview lists what is not on this file and why.',
      'Still stuck: an administrator can see your membership and role on **Team & access**.'
    ],
    related: ['invite-and-roles', 'glossary-orientation'],
    reviewed: REVIEWED
  },

  {
    id: 'glossary-orientation',
    title: 'What the words mean',
    summary: 'The terms Slate uses that do not mean what they might somewhere else.',
    audience: ['admin', 'consultant', 'committee'],
    checklist: [
      'Workspace is the firm. Search is one engagement. Roster is who is on it.',
      'Intake is what the committee said. The profile is what was adopted from it.',
      'Released means the panel can see each other. Archived means filed, not deleted.'
    ],
    who: 'Anyone, at any point. The glossary on the help screen has the full list.',
    before: ['Nothing.'],
    doThis: [
      { do: 'Open **Help & user guide** and read the glossary at the foot of the page.' },
      { do: 'Use the role picker at the top to see the explanations written for your role.', note: 'Choosing a role changes the wording only. It never changes what you are allowed to do.' }
    ],
    worked: ['You can tell a held place from a member, and a draft from a submission.'],
    whoSees: ['Nobody. Reading help is not recorded against you.'],
    next: [{ article: 'no-assignment', label: 'When something is missing' }],
    recovery: ['A term that is not in the glossary and not obvious is a documentation bug. Tell the content owner.'],
    related: ['no-assignment'],
    reviewed: REVIEWED
  }
];

/**
 * The glossary. `article` links a term to the article that explains it in full,
 * so a definition is a doorway rather than a dead end.
 */
const glossary = [
  { term: 'Workspace', meaning: 'One recruiting firm. Searches, members, and postings belong to exactly one workspace and never move between them.', article: 'first-sign-in' },
  { term: 'Search', meaning: 'One engagement: a client, a position, and the process the package includes.', article: 'create-a-search' },
  { term: 'Package', meaning: 'The saved search workflow: Posting and screening, Recruited search, or Full search. It decides which steps are on the file. Subscription plans and payments are managed on Subscriptions.', article: 'create-a-search' },
  { term: 'Account manager', meaning: 'The one person who runs a search. Rostering, closing the intake window, adopting the profile, releasing scores, closing, and archiving are theirs.', article: 'assemble-a-committee' },
  { term: 'Roster', meaning: 'Everyone on a search, including the account manager. A place held against an email address is not a roster member yet.', article: 'assemble-a-committee' },
  { term: 'Held place', meaning: 'A seat reserved for somebody who has been invited but has not accepted and signed in. It grants no access.', article: 'invite-and-roles' },
  { term: 'Intake', meaning: 'What each committee member says they are looking for, in their own words, before anyone drafts a profile.', article: 'submit-committee-input' },
  { term: 'Draft (committee)', meaning: 'A private answer saved but not submitted. Nobody else can read it, and saving one never retracts an answer you already submitted.', article: 'submit-committee-input' },
  { term: 'Adopted profile', meaning: 'The criteria and weights built from committee input and saved. It is what candidates are scored against, and it carries a revision number.', article: 'adopt-the-profile' },
  { term: 'Semifinalist', meaning: 'A candidate stage. Reaching it opens the semifinalist questionnaire step; it is not a decision that anything has been offered.', article: 'add-and-contact-candidates' },
  { term: 'Released scores', meaning: 'Panel scores made visible to everyone on the search. Until release each person sees only their own. Resealing hides them again but cannot recall an export.', article: 'score-and-release' },
  { term: 'Archive', meaning: 'A search filed off the book. Nothing is deleted and it can be restored. Restoring grants no new membership and reissues no candidate links.', article: 'close-and-archive' },
  { term: 'Posting', meaning: 'A public job page published from a search. It is a versioned snapshot of approved fields, separate from the search itself.', article: 'publish-a-posting' },
  { term: 'Posting closed', meaning: 'The posting stops accepting new applications. The search stays open and staff keep evaluating the applicants they have.', article: 'publish-a-posting' },
  { term: 'Application draft', meaning: 'An application an applicant has saved but not submitted. It is not an application, it is not visible to staff, and it expires.', article: 'candidate-apply' },
  { term: 'Receipt', meaning: 'Proof that a submission arrived, with a reference number and a time. It is not a hiring status and never implies one.', article: 'candidate-apply' }
];

/**
 * Which article opens when somebody selects "Help with this page".
 *
 * Built from the articles rather than maintained beside them, so an article
 * that names a screen is reachable from it and there is no second list to fall
 * out of date. First article wins where several name the same screen.
 */
function screenIndex() {
  const index = {};
  for (const article of articles) {
    for (const screen of article.screens || []) {
      if (!index[screen]) index[screen] = article.id;
    }
  }
  return index;
}

module.exports = { articles, glossary, screenIndex, REVIEWED, VERIFIED_RELEASE };
