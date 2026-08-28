'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { fetchCitySite } = require('./site');
const { PLACE_KEYS, GOV_KEYS } = require('./brochure');

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';
const PREMIUM = process.env.CLAUDE_MODEL_PREMIUM || 'claude-opus-5';

const SYSTEM = `You are the writing desk inside Slate, software used by a local-government executive-search firm.

Write the way this firm writes:
- Plain, specific, professional. No marketing fluff. No exclamation points.
- Do not use em dashes (—) or en dashes (–). Use a comma, a colon, a period, or parentheses.
- Name the jurisdiction, the form of government, and the actual work.
- Every recruiting claim must be supportable from the profile or the notes you were given. Do not invent census figures, budget numbers, or awards.
- Tie interview questions and survey items to named profile criteria (use the criterion ids).
- ARE format means Approach, Results, Experience — three follow-ups under one stem.
- Return ONLY valid JSON matching the schema described. No markdown fences.`;

function client(){
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    const err = new Error('ANTHROPIC_API_KEY is not set. Add it locally in .env or as a platform variable.');
    err.code = 'NO_KEY';
    throw err;
  }
  return new Anthropic({ apiKey: key });
}

function pickModel(wantPremium){
  return wantPremium ? PREMIUM : MODEL;
}

function normalizeClaudeError(err){
  if (!err || err.code) return err;
  if (err instanceof Anthropic.AuthenticationError) err.code = 'AUTH_ERROR';
  else if (err instanceof Anthropic.RateLimitError) err.code = 'RATE_LIMIT';
  else if (err instanceof Anthropic.APIConnectionError) err.code = 'CONNECTION_ERROR';
  return err;
}

function packSearch(search){
  return {
    client: search.client,
    position: search.position,
    state: search.state,
    website: search.website,
    fog: search.fog,
    population: search.population,
    budget: search.budget,
    salary: search.salary,
    firstReview: search.firstReview,
    notes: search.notes,
    research: search.research ? {
      at: search.research.at,
      city: search.research.city,
      website: search.research.website,
      sources: search.research.sources
    } : null,
    criteria: (search.criteria||[]).map(c => ({
      id:c.id, kind:c.kind, label:c.label, weight:c.weight, note:c.note
    }))
  };
}

function extractText(msg){
  return (msg.content||[])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();
}

function parseJson(text){
  const clean = String(text||'').replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('Claude did not return JSON.');
  return JSON.parse(clean.slice(start, end+1));
}

function asText(v){
  if (v == null || v === false) return '';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join('\n');
  if (typeof v === 'object') {
    if (v.v != null) return asText(v.v);
    if (v.value != null) return asText(v.value);
    if (v.text != null) return asText(v.text);
    if (v.range != null) return asText(v.range);
    if (v.min != null && v.max != null) return asText(v.min)+'–'+asText(v.max);
  }
  return '';
}

function putFact(facts, key, value){
  const v = asText(value);
  if (!v) return;
  const k = String(key||'').toLowerCase().replace(/[_-]+/g, ' ').trim();
  const compact = k.replace(/[^a-z]/g, '');
  if (!facts.client && /^(client|jurisdiction|name|city|town|county|officialname)$/.test(compact)) facts.client = v;
  else if (!facts.state && (compact === 'state' || compact === 'st')) facts.state = v;
  else if (!facts.fog && (/fog|formofgovernment|governmentform/.test(compact) || k.includes('form of government'))) facts.fog = v;
  else if (!facts.population && (/^pop/.test(compact) || compact === 'census')) facts.population = v;
  else if (!facts.budget && /budget|generalfund|operatingfund/.test(compact)) facts.budget = v;
  else if (!facts.salary && /salary|compensation|payrange/.test(compact)) facts.salary = v;
  else if (/^notes?$/.test(compact)) facts.notes = facts.notes ? facts.notes+'\n'+v : v;
}

function harvestFacts(raw, facts){
  if (!raw) return;
  if (Array.isArray(raw)) {
    for (const row of raw) {
      if (!row || typeof row !== 'object') continue;
      putFact(facts, row.k || row.key || row.label || row.name, row.v ?? row.value ?? row.text);
    }
    return;
  }
  if (typeof raw === 'object') {
    for (const [k, val] of Object.entries(raw)) putFact(facts, k, val);
  }
}

function asSections(raw, keys, fallback){
  const out = {};
  for (const k of keys) out[k] = '';
  if (!raw) {
    if (fallback) out[keys[0]] = fallback;
    return out;
  }
  if (typeof raw === 'string') {
    out[keys[0]] = asText(raw);
    return out;
  }
  if (typeof raw === 'object') {
    for (const k of keys) out[k] = asText(raw[k]);
    if (fallback && !Object.values(out).some(Boolean)) out[keys[0]] = fallback;
  }
  return out;
}

function sectionsHaveText(obj){
  return obj && typeof obj === 'object' && Object.values(obj).some(v => asText(v));
}

function normalizeCommunity(raw, facts){
  if (typeof raw === 'string') {
    raw = { lede: raw };
  }
  raw = raw && typeof raw === 'object' ? raw : {};
  const list = Array.isArray(raw.facts)
    ? raw.facts.map(f => ({
        k: String((f && (f.k || f.key || f.label)) || '').trim(),
        v: asText(f && (f.v ?? f.value))
      })).filter(f => f.k || f.v)
    : [];
  const extras = [
    ['population', 'Population'],
    ['budget', 'Budget'],
    ['fog', 'Form of government'],
    ['state', 'State'],
    ['salary', 'Salary']
  ];
  for (const [key, label] of extras) {
    if (facts[key] && !list.some(x => x.k.toLowerCase().includes(label.split(' ')[0].toLowerCase()))) {
      list.unshift({ k: label, v: facts[key] });
    }
  }
  const placeFallback = asText(raw.community || raw.place);
  const govFallback = asText(typeof raw.government === 'string' ? raw.government : raw.gov);
  return {
    lede: asText(raw.lede || raw.summary || raw.intro),
    facts: list,
    government: asSections(raw.government || raw.gov, GOV_KEYS, govFallback),
    community: asSections(raw.community || raw.place, PLACE_KEYS, placeFallback),
    organization: asText(raw.organization || raw.org),
    why: asText(raw.why || raw.whyHere)
  };
}

function normalizeResearch(json){
  const facts = { client:'', state:'', fog:'', population:'', budget:'', salary:'', notes:'' };
  if (!json || typeof json !== 'object') {
    return { facts, community: normalizeCommunity({}, facts), sources: [] };
  }
  harvestFacts(json.facts, facts);
  harvestFacts(json.search, facts);
  if (json.community && Array.isArray(json.community.facts)) harvestFacts(json.community.facts, facts);
  for (const k of ['client','state','fog','population','budget','salary','notes']) {
    if (!facts[k] && json[k] != null) putFact(facts, k, json[k]);
  }
  const community = normalizeCommunity(json.community || json.community_profile || json.profile, facts);
  const sources = Array.isArray(json.sources) ? json.sources.filter(Boolean) : [];
  return { facts, community, sources };
}

function researchGaps(file, attempt){
  const facts = (file && file.facts) || {};
  const community = (file && file.community) || {};
  const missing = [];
  if (!asText(facts.client)) missing.push('official jurisdiction name');
  if (!asText(facts.state)) missing.push('state');
  if (!asText(facts.fog)) missing.push('form of government');
  if (!asText(facts.population)) missing.push('population (Census or ACS, with year)');
  if (!asText(facts.budget)) missing.push('operating or general-fund budget');
  const wroteUp = asText(community.lede)
    || sectionsHaveText(community.government)
    || sectionsHaveText(community.community)
    || asText(community.organization)
    || asText(community.why)
    || asText(community.government)
    || asText(community.community);
  if (!wroteUp) missing.push('community / government write-up');
  if (attempt >= 2) {
    return missing.filter(m => !/population|budget/.test(m));
  }
  return missing;
}

const SUBMIT_TOOL = {
  name: 'submit_research',
  description: 'Write the finished research onto the search file. Call this when the checklist is complete. Use empty strings for unpublished figures. Do not invent numbers.',
  input_schema: {
    type: 'object',
    required: ['facts', 'community'],
    properties: {
      facts: {
        type: 'object',
        required: ['client','state','fog','population','budget','salary','notes'],
        properties: {
          client: { type: 'string', description: 'Official jurisdiction name' },
          state: { type: 'string' },
          fog: { type: 'string', description: 'Form of government' },
          population: { type: 'string', description: 'Figure with year, or empty' },
          budget: { type: 'string', description: 'Operating/general fund with FY, or empty' },
          salary: { type: 'string', description: 'Range for this position if published, else empty' },
          notes: { type: 'string', description: 'Short bullets that help write the candidate profile' }
        }
      },
      community: {
        type: 'object',
        required: ['lede','government','community','why'],
        properties: {
          lede: { type: 'string', description: '2-3 sentences answering why a candidate would want to live here and lead this organization' },
          facts: {
            type: 'array',
            items: {
              type: 'object',
              properties: { k: { type: 'string' }, v: { type: 'string' } }
            }
          },
          government: {
            type: 'object',
            properties: {
              form: { type: 'string' },
              elected: { type: 'string', description: 'Number and titles of elected officials' },
              roles: { type: 'string' },
              managerRole: { type: 'string' },
              employees: { type: 'string' },
              budget: { type: 'string' },
              departments: { type: 'string' },
              electedStaff: { type: 'string' }
            }
          },
          community: {
            type: 'object',
            properties: {
              history: { type: 'string' },
              qualityOfLife: { type: 'string' },
              housing: { type: 'string' },
              schools: { type: 'string' },
              parksArts: { type: 'string' },
              economy: { type: 'string' },
              healthcare: { type: 'string' },
              transportation: { type: 'string' },
              climate: { type: 'string' },
              growth: { type: 'string' }
            }
          },
          organization: { type: 'string' },
          why: { type: 'string' }
        }
      },
      sources: {
        type: 'array',
        items: {
          type: 'object',
          properties: { title: { type: 'string' }, url: { type: 'string' } }
        }
      }
    }
  }
};

const RESEARCH_AGENT = `You are a research agent inside Slate, used by a local-government executive-search firm.

Fill a search file from public sources. Use tools. Do not guess.

Checklist — every item gets a sourced value or "":
1. Official jurisdiction name
2. State
3. Form of government (Council-Manager, Mayor-Council, or other)
4. Population with year (Census or ACS)
5. Operating or general-fund budget with fiscal year, if published
6. Salary range for THIS position only if an official or recruiting page publishes it
7. Form of government detail: number of elected officials, roles of mayor/council/board, role of the manager, employee count, major departments, elected-staff relationship
8. Community: history and identity, quality of life, housing/cost of living, schools, parks/arts, employers/economy, healthcare, transportation, climate/outdoors, growth and major projects — only from sources
9. Why a strong manager would want this job — grounded in facts, not hype

Rules:
- Empty string is better than a guess. Never invent census, budget, or salary figures.
- Do not use em dashes (—) or en dashes (–) in any written field. Use a comma, a colon, a period, or parentheses.
- Prefer the official city site, Census/ACS, and adopted budget documents.
- When the checklist is done, call submit_research. Do not submit until you have searched for any still-empty figure.`;

function toolUses(msg, name){
  return (msg.content || []).filter(b => b.type === 'tool_use' && (!name || b.name === name));
}

function addUsage(sum, usage){
  if (!usage) return sum || { input_tokens: 0, output_tokens: 0 };
  return {
    input_tokens: (sum && sum.input_tokens || 0) + (usage.input_tokens || 0),
    output_tokens: (sum && sum.output_tokens || 0) + (usage.output_tokens || 0)
  };
}

async function runResearchAgent(anthropic, request){
  const messages = request.messages.map(m => ({ role: m.role, content: m.content }));
  const transcripts = [];
  let usage = { input_tokens: 0, output_tokens: 0 };
  let submitted = null;
  let submits = 0;
  let last = null;

  for (let i = 0; i < 6; i++) {
    last = await anthropic.messages.create({ ...request, messages }, { timeout: 180000 });
    usage = addUsage(usage, last.usage);
    transcripts.push(last);

    if (last.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: last.content });
      continue;
    }

    const calls = toolUses(last);
    if (calls.length) {
      messages.push({ role: 'assistant', content: last.content });
      const results = [];
      for (const use of calls) {
        if (use.name !== 'submit_research') {
          results.push({
            type: 'tool_result',
            tool_use_id: use.id,
            content: 'Unknown tool.',
            is_error: true
          });
          continue;
        }
        submits += 1;
        const file = normalizeResearch(use.input || {});
        const missing = researchGaps(file, submits);
        if (missing.length) {
          results.push({
            type: 'tool_result',
            tool_use_id: use.id,
            content: 'Not saved. Still missing: '+missing.join('; ')+'. Search those sources, then call submit_research again. Use "" only if the figure is unpublished.'
          });
        } else {
          submitted = file;
          results.push({
            type: 'tool_result',
            tool_use_id: use.id,
            content: 'Saved to the search file. You are done.'
          });
        }
      }
      messages.push({ role: 'user', content: results });
      if (submitted) break;
      continue;
    }

    const text = extractText(last);
    if (text) {
      try {
        const file = normalizeResearch(parseJson(text));
        submits += 1;
        const missing = researchGaps(file, submits);
        if (!missing.length) {
          submitted = file;
          break;
        }
        messages.push({ role: 'assistant', content: last.content });
        messages.push({
          role: 'user',
          content: 'Still missing: '+missing.join('; ')+'. Keep researching, then call submit_research. Use "" only if unpublished.'
        });
        continue;
      } catch { /* not JSON yet */ }
    }

    messages.push({ role: 'assistant', content: last.content });
    messages.push({
      role: 'user',
      content: 'Call submit_research with the checklist filled. Empty string if a figure is unpublished. Do not invent numbers.'
    });
  }

  return { submitted, last, transcripts, usage };
}

const SCHEMAS = {
  profile: `{"criteria":[{"id":"S1","kind":"skill|trait|chall|opp","label":"short label","weight":1-5,"note":"why this matters here"}]}
Use S for skills, T for traits, C for challenges, O for opportunities. 3-5 of each kind. Weights 5 = essential.`,
  community: `{"lede":"2-3 sentences answering why a candidate would want to live here and lead this organization","facts":[{"k":"label","v":"value"}],"government":{"form":"","elected":"count and titles","roles":"","managerRole":"","employees":"","budget":"","departments":"","electedStaff":""},"community":{"history":"","qualityOfLife":"","housing":"","schools":"","parksArts":"","economy":"","healthcare":"","transportation":"","climate":"","growth":""},"organization":"paragraph","why":"paragraph"}`,
  brochure: `{"title":"string","lede":"string","theOpportunity":"paragraph","thePlace":"2 paragraphs","theOrganization":"2 paragraphs","leadershipOpportunity":"paragraph","challenges":"paragraph from the profile challenges","opportunities":"paragraph from the profile opportunities","ideal":"desired candidate profile","theJob":"position responsibilities","compensation":"short paragraph","whyConsider":"Why consider this community?","howToApply":"short paragraph"}`,
  ads: `{"openingDate":"","firstReview":"","closing":"closing date or Applications accepted until filled","apply":"website or email","contact":"name and how to reach the search team","full":{"headline":"","body":""},"short":{"headline":"","body":""},"social":{"headline":"","body":"under 500 characters"},"association":{"headline":"","body":""}}
Each body must include position, organization, community, salary, highlights, challenges, opportunities, qualifications, form of government, and how to apply.`,
  plan: `{"rows":[{"outlet":"","audience":"","format":"full|short|social|association","when":"","cost":"","who":"person responsible","status":"planned|posted"}]}`,
  survey1: `{"name":"Initial Candidate Survey","intro":"","dueHint":"","questions":[{"n":1,"prompt":"","type":"short|long|yesno-detail","required":true,"crit":["S1"]}]}
8 questions. First two are administrative (crit []). Remaining questions test the heaviest-weighted criteria.`,
  survey2: `{"name":"Semifinalist Questionnaire","intro":"","dueHint":"","questions":[{"n":1,"prompt":"","type":"are","required":true,"crit":["S1"]}]}
5 ARE questions. Each tests 1-3 criteria. One question should put the candidate inside this jurisdiction's hardest current challenge.`,
  guide: `{"questions":[{"n":1,"stem":"","crit":["C1","S1"],"approach":"","results":"","experience":""}],"scenarios":[{"id":"SCN-1","name":"","mins":45,"who":"Council panel|Staff panel|Search consultant|Community panel","crit":["S1"],"brief":""}]}
6 ARE questions and 4 scenarios (presentation, problem-solving with staff, inbox, leaderless group).`,
  schedule: `{"days":[{"date":"Day 1","title":"","blocks":[{"time":"","what":"","who":""}]}],"note":"Every finalist receives the same core experience.","guide":{"panel":"who sits on the interview panel","council":"council/board interview","staff":"staff meetings","community":"community meetings if used","tour":"facility and community tour","presentation":"presentation exercise","exercises":"other assessment scenarios","sameCore":"statement that each finalist receives the same core experience"}}`,
  contract: `{"title":"Employment Agreement — draft for counsel","sections":[{"h":"heading","body":"prose"}]}
Follow the ICMA model employment agreement structure. Flag local policy choices in the body rather than inventing them as decided.`,
  bar: `{"behavior":[{"id":"B1","t":"","d":"","from":"T2"}],"actions":[{"id":"A1","t":"","due":""}],"results":[{"id":"R1","t":"","target":"","from":"C1"}],"governance":["Council governance survey item"],"cadence":{"beginning":["Establish annual expectations","Establish 5-7 measurable goals","Establish professional development goals","Establish annual work plan","Confirm Council/Manager expectations"],"midyear":["Review progress","Discuss accomplishments","Identify barriers","Clarify expectations","Adjust goals when appropriate"],"annual":["Council completes evaluation","Manager completes self-evaluation","Results are compiled","Council and Manager discuss performance","Strengths and opportunities identified","New goals established"]}}`
};

const KIND_PROMPTS = {
  profile: (s, extra) => `Draft the Step 1 candidate profile matrix from these notes and search facts. ${SCHEMAS.profile}\n\nSearch:\n${JSON.stringify(packSearch(s),null,2)}\n\nCouncil / staff notes:\n${extra.notes||s.notes||'(none)'}`,
  community: s => `Write the community and form-of-government profile (Step 2). Use the researched facts. Do not invent census, budget, or salary figures. Fill every community and government field you can support; use "" if unpublished. ${SCHEMAS.community}\n\nSearch:\n${JSON.stringify(packSearch(s),null,2)}\n\nPrior research:\n${JSON.stringify(s.research||{},null,2)}`,
  brochure: s => {
    const existing = { ...(s.artifacts.brochure || {}) };
    delete existing.photos;
    delete existing.theme;
    delete existing.scheme;
    return `Tighten the recruitment brochure (Step 3) from the community profile and adopted candidate profile. Use only facts already on file. Do not invent census, budget, or salary figures. Do not include photos, a theme, or a color scheme field. Prefer the existing brochure wording when it already matches the research; shorten and arrange rather than rewriting from scratch. ${SCHEMAS.brochure}\n\nSearch:\n${JSON.stringify(packSearch(s),null,2)}\n\nCommunity profile:\n${JSON.stringify(s.artifacts.community||{},null,2)}\n\nExisting brochure copy:\n${JSON.stringify(existing,null,2)}`;
  },
  ads: s => `Write four advertisement versions (Step 4): full, short, social, association. Include application opening date, first-review date, closing or until-filled statement, apply URL/email, and contact. ${SCHEMAS.ads}\n\nSearch:\n${JSON.stringify(packSearch(s),null,2)}`,
  plan: s => `Write the recruitment and advertising plan (Step 6). Include ICMA, state municipal league, NFBPA/Local Government Hispanic Network if relevant, LinkedIn, the client's site, and one regional paper. ${SCHEMAS.plan}\n\nSearch:\n${JSON.stringify(packSearch(s),null,2)}`,
  survey1: s => `Write the initial candidate survey (Step 5). ${SCHEMAS.survey1}\n\nSearch:\n${JSON.stringify(packSearch(s),null,2)}`,
  survey2: s => `Write the semifinalist questionnaire (Step 8). ${SCHEMAS.survey2}\n\nSearch:\n${JSON.stringify(packSearch(s),null,2)}\n\nInterview guide if present:\n${JSON.stringify(s.artifacts.guide||{},null,2)}`,
  guide: s => `Write the interview guide and assessment scenarios (Step 7). ${SCHEMAS.guide}\n\nSearch:\n${JSON.stringify(packSearch(s),null,2)}`,
  schedule: s => `Draft the finalist interview week and assessment guide (Step 12). Same core experience for every finalist: interview panel, council/board interview, staff meetings, community meetings if used, facility/community tour, presentation, and assessment scenarios from the interview guide. ${SCHEMAS.schedule}\n\nSearch:\n${JSON.stringify(packSearch(s),null,2)}\n\nScenarios:\n${JSON.stringify((s.artifacts.guide||{}).scenarios||[],null,2)}`,
  contract: s => `Draft a customized ICMA-model employment agreement for counsel review (Step 13). ${SCHEMAS.contract}\n\nSearch:\n${JSON.stringify(packSearch(s),null,2)}`,
  bar: s => `Draft the BAR annual evaluation (Step 14) inheriting from the adopted profile. Include Behavior, Actions, Results, a Council governance survey, and the beginning-of-year / mid-year / annual cadence. ${SCHEMAS.bar}\n\nSearch:\n${JSON.stringify(packSearch(s),null,2)}`
};

async function generate(kind, search, { premium=false, notes='' }={}){
  const build = KIND_PROMPTS[kind];
  if (!build) {
    const err = new Error('Unknown generate kind: '+kind);
    err.code = 'BAD_KIND';
    throw err;
  }
  const anthropic = client();
  const model = pickModel(premium);
  const prompt = build(search, { notes });
  let msg;
  try {
    msg = await anthropic.messages.create({
      model,
      max_tokens: 8000,
      output_config: { effort: premium ? 'medium' : 'low' },
      system: SYSTEM,
      messages: [{ role:'user', content: prompt }]
    });
  } catch (err) {
    throw normalizeClaudeError(err);
  }
  const text = extractText(msg);
  const json = parseJson(text);
  return { kind, model, json, usage: msg.usage };
}

const RESEARCH_CHECKLIST = `Work the checklist, then call submit_research.`;

function collectSources(msg, extra=[]){
  const out = [];
  const seen = new Set();
  const add = (title, url) => {
    const href = String(url || '').trim();
    if (!href || seen.has(href)) return;
    seen.add(href);
    out.push({ title: String(title || href).slice(0, 160), url: href });
  };
  for (const item of extra) add(item.title, item.url);
  const blocks = Array.isArray(msg) ? msg.flatMap(m => m.content || []) : (msg.content || []);
  for (const b of blocks) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      for (const r of b.content) add(r.title, r.url);
    }
    if (b.type === 'web_fetch_tool_result') {
      const url = b.content && (b.content.url || b.content?.content?.url);
      if (url) add('Fetched page', url);
    }
    if (b.type === 'tool_use' && b.name === 'submit_research') {
      for (const s of (b.input && b.input.sources) || []) add(s.title, s.url);
    }
  }
  return out.slice(0, 12);
}

async function researchCity({ city, website, position, state, premium=false }={}){
  const anthropic = client();
  const model = pickModel(premium);
  let site = { canonical: website, pages: [] };
  try { site = await fetchCitySite(website); }
  catch (err) {
    if (err.code === 'BAD_URL') throw err;
  }

  const pageBlock = site.pages.length
    ? site.pages.map(p => `URL: ${p.url}\n${p.text}`).join('\n\n---\n\n')
    : '(Could not read the website. Use web_search and web_fetch.)';

  const prompt = `Research this US local government for an executive search.

Jurisdiction the consultant entered: ${city}
State if known: ${state || 'unknown'}
Position being recruited: ${position || 'unknown'}
Official website they provided: ${site.canonical || website}

Pages already fetched from that website:
${pageBlock}

${RESEARCH_CHECKLIST}`;

  const tools = [
    { type: 'web_search_20250305', name: 'web_search', max_uses: 8 },
    { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 6, max_content_tokens: 20000 },
    SUBMIT_TOOL
  ];

  const request = {
    model,
    max_tokens: 8000,
    output_config: { effort: premium ? 'high' : 'medium' },
    system: [{ type: 'text', text: RESEARCH_AGENT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: prompt }],
    tools
  };

  let out;
  try {
    out = await runResearchAgent(anthropic, request);
  } catch (err) {
    const fallback = String(err.message || '');
    if (/web_search|web_fetch|tool/i.test(fallback)) {
      try {
        out = await runResearchAgent(anthropic, {
          ...request,
          tools: [SUBMIT_TOOL],
          messages: [{
            role: 'user',
            content: prompt + '\n\nWeb tools are unavailable. Use only the pages above, then call submit_research. Empty string if a figure is not on those pages.'
          }]
        });
      } catch (err2) {
        throw normalizeClaudeError(err2);
      }
    } else {
      throw normalizeClaudeError(err);
    }
  }

  if (!out.submitted) {
    const err = new Error('City lookup finished without a usable file. Try again, or fill the facts by hand.');
    err.code = 'BAD_JSON';
    throw err;
  }

  const sources = collectSources(out.transcripts, [
    { title: city + ' website', url: site.canonical || website },
    ...(site.pages || []).map(p => ({ title: 'City site', url: p.url })),
    ...(out.submitted.sources || [])
  ]);
  return {
    model,
    json: {
      facts: out.submitted.facts,
      community: out.submitted.community,
      sources: out.submitted.sources
    },
    sources,
    usage: out.usage
  };
}

module.exports = { generate, researchCity, normalizeResearch, researchGaps, addUsage, MODEL, PREMIUM };
