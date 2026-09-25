# Search experience changes

Committee input and adoption of the candidate profile are Part 1. Preparation
and posting are Part 2; candidate evaluation is Part 3.

Candidate questions now open in one editor containing initial screening,
the optional semifinalist questionnaire, and interview questions and scenarios,
as included by the search workflow. Existing question routes open this editor.
The Next action advances past question preparation to the advertising plan.
Persisted artifact keys and candidate answer identifiers are retained.

Save all questions validates and commits the plan in one revision. Repeated
wording, ignoring punctuation and case, is rejected across stages. All questions
can be generated in one request, with instructions to seek different evidence
at each stage and code review of duplicates and document structure. Semantic
overlap still requires consultant review. Generating a new plan does not change
questionnaires already issued to candidates. Semifinalist questions remain
unavailable until staff release them; panel scoring guidance remains private.

The brochure uses a stronger cover, readable contrast, section headings,
and a separate application panel. It avoids repeating the jurisdiction in the
default title and repeating criterion text as chips. Print output removes
workspace controls and allows the brochure to flow across pages instead of
pushing the whole packet after an almost-empty navigation page. The reference
PDF supplied by the user was inspected as evidence of the existing problem.

Verification: syntax/package checks, the isolated server suite, and focused
browser cases covering cross-stage editing, atomic duplicate rejection,
workflow scope, candidate release and snapshot preservation, manual drafting,
and actual PDF content. The 15 focused cases reported passes across Chromium,
WebKit, and mobile Chromium emulation. Both pages of the synthetic brochure
sample were visually inspected. Local Node is 22.18.0; the supported runtime is
Node 24. The Windows browser runner hangs during teardown after reporting case
results, so these results do not claim a clean browser-runner exit or a hosted
release. No paid model call or deployment was performed.

The new standalone question test now creates its temporary store before
importing application modules. Its first standalone run triggered a development
store migration; the automatic pre-migration backup was restored byte-for-byte
and verified before continuing. All subsequent checks use isolated stores.
