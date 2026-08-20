// Generates workflow.json for "PPW · Thesis Chapters 1-3".
//
// The Code-node sources live in their own .js files so they can be unit-tested
// offline (see test/). This script inlines them, which keeps the tested source
// and the deployed source identical by construction.
//
//   node build-workflow.js

const fs = require('fs');
const path = require('path');
const code = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

// ------------------------------------------------------------------ models ----
const STRONG = 'anthropic/claude-sonnet-5';   // writers + consistency checker
const UTILITY = 'deepseek/deepseek-v4-flash'; // planner, brief builder, abstract
const FIXER = 'openai/gpt-5-mini';            // repairs malformed structured output

// ------------------------------------------------------- shared prompt rules ----
// This block is prepended to every writer. It is the prompt-side half of the
// anti-hallucination design; the Citation Gate is the half that enforces it.
const RULES = [
  '# EVIDENCE PROTOCOL — THESE RULES OVERRIDE EVERY OTHER INSTRUCTION',
  '',
  '1. You have NO search tools and NO memory. The EVIDENCE PACK in the user message is',
  '   the ONLY source of factual information available to you. There is nothing else.',
  '2. To cite a source, write its marker exactly: [E07]. Nothing else counts as a citation.',
  '3. NEVER write an author-year citation yourself. Do not write "(Smith, 2020)",',
  '   "Smith et al. (2020)", "according to Smith", or any author name at all. A downstream',
  '   validator converts markers into citations and REJECTS any author-year text you write.',
  '4. NEVER invent a marker. Only marker IDs that appear in the EVIDENCE PACK are valid.',
  '   A marker that is not in the pack fails validation and blocks the whole document.',
  '5. Do NOT write a reference list. References are generated automatically from the pack.',
  '6. State ONLY what the evidence text actually says. If a detail is not in the text,',
  '   OMIT IT ENTIRELY. Do not write "not reported", do not estimate, do not infer,',
  '   do not fill gaps from general knowledge.',
  '7. If no source in the pack supports a claim, do not make the claim. Write only what',
  '   the evidence supports, even if that means a shorter section.',
  '8. Use formal academic English suitable for an undergraduate medical or allied-health thesis.',
  '9. Use markdown headings (##, ###) for section headings. Do not wrap output in code fences.',
].join('\n');

// ------------------------------------------------------------------ helpers ----
const nodes = [];
const connections = {};

function node(name, type, typeVersion, parameters, position, extra) {
  nodes.push(Object.assign({ parameters, name, type, typeVersion, position }, extra || {}));
  return name;
}
function connect(from, to, type, fromIndex, toIndex) {
  type = type || 'main';
  fromIndex = fromIndex || 0;
  toIndex = toIndex || 0;
  connections[from] = connections[from] || {};
  connections[from][type] = connections[from][type] || [];
  while (connections[from][type].length <= fromIndex) connections[from][type].push([]);
  connections[from][type][fromIndex].push({ node: to, type, index: toIndex });
}

const LM = '@n8n/n8n-nodes-langchain.lmChatOpenRouter';
const AGENT = '@n8n/n8n-nodes-langchain.agent';
const PARSER = '@n8n/n8n-nodes-langchain.outputParserStructured';
const CODE = 'n8n-nodes-base.code';

function model(name, slug, temperature, pos) {
  return node(name, LM, 1, { model: slug, options: temperature != null ? { temperature } : {} }, pos);
}
function agent(name, prompt, system, pos, opts) {
  opts = opts || {};
  const params = {
    promptType: 'define',
    text: prompt,
    options: { systemMessage: '=' + system },
  };
  if (opts.hasOutputParser) params.hasOutputParser = true;
  return node(name, AGENT, 3.1, params, pos, { onError: 'stopWorkflow', retryOnFail: true, maxTries: 2 });
}
function codeNode(name, file, pos, extra) {
  return node(name, CODE, 2, { jsCode: code(file) }, pos, extra);
}

let X = 0;
const step = () => (X += 260);
const P = (y) => [step(), y || 0];

// =============================================================== the graph ====

// -- trigger -------------------------------------------------------------------
// The trigger takes PASSTHROUGH, not a declared input schema.
//
// A declared schema is the tidier documentation, but it is also a filter: any
// field the parent sends that is not on the list is silently dropped. The
// parent currently forwards department, degree, month_year and student_email
// on top of the twelve that would be declared, and losing those without a
// warning is exactly the class of failure this rebuild exists to remove.
// Passthrough cannot drop anything. The parent's Execute Workflow node still
// maps each field explicitly, so the contract is documented there instead.
node('Start', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, {
  inputSource: 'passthrough',
}, P(0));

// -- shared models -------------------------------------------------------------
model('Model · Strong', STRONG, 0.3, [520, 460]);
model('Model · Utility', UTILITY, 0.2, [780, 460]);
model('Model · Fixer', FIXER, 0, [1040, 460]);

// -- phase 1: evidence ---------------------------------------------------------
const PROJECT = [
  'PROJECT DETAILS',
  'Title: {{ $(\'Start\').first().json.project_title }}',
  'Programme: {{ $(\'Start\').first().json.programme }}',
  'Faculty: {{ $(\'Start\').first().json.faculty }}',
  'Institution: {{ $(\'Start\').first().json.institution }}',
  'Study location: {{ $(\'Start\').first().json.study_location }}',
  'Study duration: {{ $(\'Start\').first().json.study_duration }}',
].join('\n');

agent('A0 Query Planner',
  '=Produce literature search queries for this undergraduate thesis.\n\n' + PROJECT,
  'You plan literature searches for a medical / allied-health thesis. You do not write prose.\n\n' +
  'From the project title and programme, produce 6-10 Europe PMC search queries that between them cover:\n' +
  '- the core clinical or professional topic\n' +
  '- the population being studied\n' +
  '- the outcome, knowledge area or comparison in the title\n' +
  '- the wider context needed for a background chapter\n\n' +
  'Query rules:\n' +
  '- Plain keyword phrases of 2-6 words. No boolean operators, no field tags, no quotes.\n' +
  '- Vary the wording; near-duplicate queries waste a search slot.\n' +
  '- Use recognised clinical terminology, including MeSH-style terms where natural.\n\n' +
  'Also return year_floor: the earliest publication year worth including. Default to 10 years ' +
  'before the current year unless the topic is fast-moving, in which case use 5.\n\n' +
  'Today is {{ $now.format(\'yyyy-MM-dd\') }}.',
  P(0), { hasOutputParser: true });

node('Planner Schema', PARSER, 1.3, {
  schemaType: 'manual',
  autoFix: true,
  inputSchema: JSON.stringify({
    type: 'object',
    properties: {
      queries: { type: 'array', minItems: 3, maxItems: 10, items: { type: 'string' } },
      year_floor: { type: 'integer' },
    },
    required: ['queries', 'year_floor'],
  }, null, 2),
}, [780, 620]);

codeNode('Build Search Requests', 'build-search-requests.js', P(0));

node('Europe PMC Search', 'n8n-nodes-base.httpRequest', 4.4, {
  url: 'https://www.ebi.ac.uk/europepmc/webservices/rest/search',
  sendQuery: true,
  queryParameters: {
    parameters: [
      { name: 'query', value: '={{ $json.query }}' },
      { name: 'format', value: 'json' },
      { name: 'pageSize', value: '25' },
      // resultType=core is what returns abstractText, authorList, journalInfo,
      // pubTypeList and isOpenAccess in a single call.
      { name: 'resultType', value: 'core' },
    ],
  },
  options: { timeout: 30000 },
}, P(0), { retryOnFail: true, maxTries: 3, waitBetweenTries: 2000, onError: 'continueRegularOutput' });

codeNode('Dedupe & Rank Candidates', 'rank-candidates.js', P(0));
codeNode('Fetch & Extract Full Text', 'fetch-fulltext.js', P(0));
codeNode('Build Evidence Pack', 'build-evidence-pack.js', P(0));

// -- phase 2: writing ----------------------------------------------------------
const PACK = '\n\n# EVIDENCE PACK\n\n{{ $(\'Build Evidence Pack\').first().json.brief_pack }}';
const EMPIRICAL_PACK = '\n\n# EVIDENCE PACK (empirical studies, with the methods and results the papers actually reported)\n\n' +
  '{{ $(\'Build Evidence Pack\').first().json.empirical_pack }}';
const RULES_EXPR = RULES.replace(/\{\{/g, '{ {');

agent('A3 Chapter 1 Writer',
  '=Write Chapter One (Introduction) for this thesis.\n\n' + PROJECT + PACK,
  RULES_EXPR + '\n\n# TASK\n\nWrite Chapter One with these sections, in order:\n\n' +
  '## 1.1 BACKGROUND OF THE STUDY\n4-5 developed paragraphs moving from general context to the specific problem. ' +
  'Every clinical, statistical or epidemiological claim carries a marker. No single marker may appear more than three times in the chapter.\n\n' +
  '## 1.2 STATEMENT OF THE RESEARCH PROBLEM\nExactly one paragraph of exactly three sentences: the ideal situation; the current gap; the consequence. Each sentence carries at least one marker.\n\n' +
  '## 1.3 AIM OF THE STUDY\nOne sentence restating the project title as an aim.\n\n' +
  '## 1.4 RESEARCH OBJECTIVES\nSMART objectives as a numbered list, aligned to the title.\n\n' +
  '## 1.5 RESEARCH QUESTIONS\nExactly one question per objective, in the same order.\n\n' +
  '## 1.6 SIGNIFICANCE OF THE STUDY\nSignificance for patients, professionals, researchers, policymakers and the institution.\n\n' +
  '## 1.7 SCOPE OF THE STUDY\nOne paragraph: population, location, duration, brief inclusion criteria. ' +
  'Use the project details supplied; do not invent a location or duration that was not given.',
  P(0));

agent('A4b Conceptual Review',
  '=Write sections 2.0 and 2.1 of Chapter Two.\n\n' + PROJECT + PACK +
  '\n\n# CHAPTER ONE (for alignment only — do not repeat it)\n\n{{ $(\'A3 Chapter 1 Writer\').first().json.output.slice(0, 3000) }}',
  RULES_EXPR + '\n\n# TASK\n\nWrite ONLY these two sections:\n\n' +
  '## 2.0 INTRODUCTION\nOne concise paragraph introducing the literature review and naming the concepts covered.\n\n' +
  '## 2.1 CONCEPTUAL REVIEW\nBreak the topic into logical subheadings (###) derived from the title, aim and objectives. ' +
  'Explain each concept and support every substantive claim with a marker.\n\n' +
  'Do not write the empirical review — another writer handles section 2.2.',
  P(0));

agent('A4c Empirical Review',
  '=Write section 2.2 (Empirical Review) of Chapter Two.\n\n' + PROJECT + EMPIRICAL_PACK,
  RULES_EXPR + '\n\n# TASK\n\nWrite ONLY:\n\n## 2.2 EMPIRICAL REVIEW\n\n' +
  'One continuous paragraph per study, arranged chronologically DESCENDING (newest first). ' +
  'Review every study in the evidence pack and no others.\n\n' +
  'For each study, report only what the supplied METHODS and RESULTS text actually states. Where the text ' +
  'gives them, cover: study design, duration, location, sampling technique, sample size, instrument, ' +
  'data collection, analysis method, key findings, and relevance to the present study.\n\n' +
  'CRITICAL: if the supplied text does not state one of those details, simply do not mention it. ' +
  'Do not write "not reported", do not leave a placeholder, and above all do not supply a plausible ' +
  'value. A sample size, p-value or instrument name that is not in the text in front of you does not exist.\n\n' +
  'Do not begin consecutive paragraphs with the same marker. ' +
  'End with one paragraph identifying the research gap and linking it to the present study.',
  P(0));

agent('A4d Chapter 2 Assembler',
  '=Assemble the final Chapter Two from the two drafts below.\n\n' +
  '# CONCEPTUAL DRAFT\n\n{{ $(\'A4b Conceptual Review\').first().json.output }}\n\n' +
  '# EMPIRICAL DRAFT\n\n{{ $(\'A4c Empirical Review\').first().json.output }}',
  RULES_EXPR + '\n\n# TASK\n\nCombine the two drafts into one clean Chapter Two in this order: ' +
  '2.0 Introduction, 2.1 Conceptual Review, 2.2 Empirical Review, research-gap paragraph.\n\n' +
  'You are editing, not writing. Fix flow, remove duplication, and make the numbering consistent. ' +
  'Do NOT add claims, and do NOT add, remove or renumber any [Exx] marker — every marker in the drafts ' +
  'must survive verbatim into your output, attached to the same claim it came from.',
  P(0));

agent('A5a Methodology Brief',
  '=Extract a methodology brief.\n\n' + PROJECT +
  '\n\n# CHAPTER ONE\n\n{{ $(\'A3 Chapter 1 Writer\').first().json.output }}',
  'You extract the parameters needed to write a methodology chapter. Return a compact brief under 400 words ' +
  'with these fields: study aim; research objectives; research questions; key variables; study population; ' +
  'study location; likely study design; source of data; sampling technique; inclusion criteria; exclusion criteria; ' +
  'data collection instrument; data collection procedure; statistical software; objective-to-analysis mapping.\n\n' +
  'Use only what the project details and Chapter One state. Where something was not supplied, write "not specified". ' +
  'Never invent an institution, ethics committee, date or sample size. Do not copy citations or markers.',
  P(0));

agent('A5 Chapter 3 Writer',
  '=Write Chapter Three (Methodology).\n\n# METHODOLOGY BRIEF\n\n{{ $(\'A5a Methodology Brief\').first().json.output }}' + PACK,
  RULES_EXPR + '\n\n# TASK\n\nWrite Chapter Three with these sections, using ## for numbered sections and ### for sub-sections:\n\n' +
  '3.1 RESEARCH DESIGN — state and justify it.\n' +
  '3.2 SOURCE OF DATA — primary or secondary, and why.\n' +
  '3.3 STUDY LOCATION — describe only what was supplied. Invent no wards, addresses or facility details.\n' +
  '3.4 STUDY POPULATION\n' +
  '3.5 SAMPLING TECHNIQUE — state and justify.\n' +
  '3.6 SAMPLE SIZE DETERMINATION — present an appropriate formula (Cochran, Yamane or Fisher), define every ' +
  'variable, and show the calculation step by step, including a 10% attrition adjustment. If population size, ' +
  'prevalence, confidence level or margin of error were not supplied, say so explicitly and give a fillable ' +
  'template with the symbols left as symbols. Do NOT substitute invented numbers.\n' +
  '3.7 ETHICAL CONSIDERATION — approval, consent, confidentiality, voluntary participation, right to withdraw. ' +
  'Name no ethics committee unless one was supplied.\n' +
  '3.8 SUBJECT SELECTION CRITERIA — 3.8.1 Inclusion and 3.8.2 Exclusion, as bullet lists.\n' +
  '3.9 INSTRUMENTS OF DATA COLLECTION — with 3.9.1 Validity and 3.9.2 Reliability. Invent no Cronbach alpha ' +
  'values or pilot sample sizes.\n' +
  '3.10 METHOD OF DATA COLLECTION — step by step.\n' +
  '3.11 DATA ANALYSIS — with 3.11.1 Data Cleaning, 3.11.2 Normality Test, 3.11.3 Statistical Analysis. ' +
  'Map a specific test to each objective. Use SPSS and p < 0.05 unless the brief says otherwise.\n\n' +
  'Methodological statements need markers only where the evidence pack genuinely supports them; ' +
  'an uncited methodological convention is fine. Mark anything genuinely missing as [DETAIL NEEDED: item].',
  P(0));

codeNode('Collect Chapters', 'collect-chapters.js', P(0));

agent('A6 Consistency Checker',
  '=Audit these three chapters for internal consistency.\n\n' + PROJECT +
  '\n\n# CHAPTER ONE\n\n{{ $(\'Collect Chapters\').first().json.ch1 }}' +
  '\n\n# CHAPTER TWO\n\n{{ $(\'Collect Chapters\').first().json.ch2 }}' +
  '\n\n# CHAPTER THREE\n\n{{ $(\'Collect Chapters\').first().json.ch3 }}',
  'You are a thesis quality-assurance checker. You do NOT rewrite chapters. You return a list of findings, ' +
  'each with a precise find/replace edit that another process applies.\n\n' +
  'Check each of these and return one issue object per check:\n' +
  '1. project_title — identical wherever it appears\n' +
  '2. aim — matches the project title\n' +
  '3. objectives — each supports the aim\n' +
  '4. research_questions — exactly one per objective, same order\n' +
  '5. methodology_coverage — the methodology addresses every objective\n' +
  '6. variables — consistent across chapters\n' +
  '7. study_location — the same everywhere\n' +
  '8. study_population — the same everywhere\n' +
  '9. sample_size — the same number everywhere\n' +
  '10. analysis_match — statistical tests suit the stated design\n' +
  '11. ethics — appropriate to the methodology\n' +
  '12. citation_spread — no single [Exx] marker used more than three times in one chapter\n' +
  '13. heading_numbering — section numbers run in order with no gaps or repeats\n\n' +
  'For each: verdict PASS or FAIL. For FAIL, set chapter (ch1/ch2/ch3), find (a VERBATIM substring of that ' +
  'chapter, long enough to be unique but under 300 characters) and replace (the corrected text).\n\n' +
  'HARD CONSTRAINTS on every replace value:\n' +
  '- Preserve every [Exx] marker that appears in the find text, unchanged.\n' +
  '- Never introduce a new [Exx] marker, and never write an author-year citation.\n' +
  '- Never introduce a fact, number or name that is not already in the chapters.\n' +
  'If you cannot fix an issue within those constraints, return it as FAIL with find and replace both empty ' +
  'and explain why in explanation.',
  P(0), { hasOutputParser: true });

node('Consistency Schema', PARSER, 1.3, {
  schemaType: 'manual',
  autoFix: true,
  inputSchema: JSON.stringify({
    type: 'object',
    properties: {
      issues: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            category: { type: 'string' },
            verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
            severity: { type: 'string', enum: ['low', 'medium', 'high'] },
            chapter: { type: 'string', enum: ['ch1', 'ch2', 'ch3', ''] },
            explanation: { type: 'string' },
            find: { type: 'string' },
            replace: { type: 'string' },
          },
          required: ['category', 'verdict', 'explanation'],
        },
      },
    },
    required: ['issues'],
  }, null, 2),
}, [3400, 620]);

codeNode('Apply Corrections', 'apply-corrections.js', P(0));
codeNode('Citation Gate', 'citation-gate.js', P(0));

agent('A8 Abstract',
  '=Write the abstract.\n\n' + PROJECT +
  '\n\n# CHAPTER ONE\n\n{{ $(\'Citation Gate\').first().json.ch1.slice(0, 6000) }}' +
  '\n\n# CHAPTER THREE\n\n{{ $(\'Citation Gate\').first().json.ch3.slice(0, 5000) }}',
  'Write a structured abstract of 150-300 words for an undergraduate thesis proposal, based only on the ' +
  'chapters supplied.\n\n' +
  'Use these labelled paragraphs: Background, Aim, Methods, Expected Results, Conclusion, Keywords ' +
  '(4-6 keywords, comma separated).\n\n' +
  'The work is proposed, not completed, so write Methods and Expected Results in the future tense.\n\n' +
  'An abstract carries NO citations: remove every [Exx] marker and never write an author name or year. ' +
  'Introduce no fact that is not already in the chapters.',
  P(0));

node('Return', 'n8n-nodes-base.set', 3.4, {
  assignments: {
    assignments: [
      { id: 'r1', name: 'ch1', value: '={{ $(\'Citation Gate\').first().json.ch1 }}', type: 'string' },
      { id: 'r2', name: 'ch2', value: '={{ $(\'Citation Gate\').first().json.ch2 }}', type: 'string' },
      { id: 'r3', name: 'ch3', value: '={{ $(\'Citation Gate\').first().json.ch3 }}', type: 'string' },
      { id: 'r4', name: 'abstract', value: '={{ $(\'A8 Abstract\').first().json.output }}', type: 'string' },
      { id: 'r5', name: 'references', value: '={{ $(\'Citation Gate\').first().json.references }}', type: 'array' },
      { id: 'r6', name: 'citation_report', value: '={{ $(\'Citation Gate\').first().json.citation_report }}', type: 'object' },
      { id: 'r7', name: 'consistency_report', value: '={{ $(\'Apply Corrections\').first().json.consistency_report }}', type: 'object' },
      { id: 'r8', name: 'evidence_stats', value: '={{ $(\'Build Evidence Pack\').first().json.stats }}', type: 'object' },
    ],
  },
  options: {},
}, P(0));

// ------------------------------------------------------------- main wiring ----
const MAIN = [
  'Start', 'A0 Query Planner', 'Build Search Requests', 'Europe PMC Search',
  'Dedupe & Rank Candidates', 'Fetch & Extract Full Text', 'Build Evidence Pack',
  'A3 Chapter 1 Writer', 'A4b Conceptual Review', 'A4c Empirical Review',
  'A4d Chapter 2 Assembler', 'A5a Methodology Brief', 'A5 Chapter 3 Writer',
  'Collect Chapters', 'A6 Consistency Checker', 'Apply Corrections',
  'Citation Gate', 'A8 Abstract', 'Return',
];
for (let i = 0; i < MAIN.length - 1; i++) connect(MAIN[i], MAIN[i + 1]);

// --------------------------------------------------------- sub-node wiring ----
// NOTE: no ai_tool and no ai_memory connections anywhere. That is deliberate --
// the writers must have no way to reach outside the evidence pack.
const STRONG_USERS = ['A3 Chapter 1 Writer', 'A4b Conceptual Review', 'A4c Empirical Review',
  'A4d Chapter 2 Assembler', 'A5 Chapter 3 Writer', 'A6 Consistency Checker'];
const UTILITY_USERS = ['A0 Query Planner', 'A5a Methodology Brief', 'A8 Abstract'];

for (const a of STRONG_USERS) connect('Model · Strong', a, 'ai_languageModel');
for (const a of UTILITY_USERS) connect('Model · Utility', a, 'ai_languageModel');

connect('Planner Schema', 'A0 Query Planner', 'ai_outputParser');
connect('Consistency Schema', 'A6 Consistency Checker', 'ai_outputParser');
// autoFix repairs malformed JSON against the schema — a coding-capable model.
connect('Model · Fixer', 'Planner Schema', 'ai_languageModel');
connect('Model · Fixer', 'Consistency Schema', 'ai_languageModel');

// ------------------------------------------------------------------ output ----
const workflow = {
  name: 'PPW · Thesis Chapters 1-3',
  nodes,
  connections,
  settings: {
    executionOrder: 'v1',
    saveExecutionProgress: true,
    saveDataErrorExecution: 'all',
    // env sets EXECUTIONS_DATA_SAVE_ON_SUCCESS=none; override it here, because the
    // citation_report on a successful run is the thing worth inspecting.
    saveDataSuccessExecution: 'all',
    executionTimeout: 3600,
  },
};

// Cross-node .item is banned in this workflow, and the ban is enforced here
// rather than trusted to review.
//
// The evidence pipeline fans 1 item out to 10 searches, then 30 candidates,
// then collapses back to a single pack, and none of the Code nodes emit
// pairedItem. n8n therefore cannot trace an item back through that waist, so
// $('Start').item fails with "Paired item data ... is unavailable" -- which is
// what killed A3 Chapter 1 Writer on the first full run. Every node these
// expressions reach holds exactly one item, so .first() is not a workaround:
// it is the accurate way to say what is meant, and it cannot break.
const serialised = JSON.stringify(workflow, null, 2);
const offenders = serialised.split(').item.json').length - 1;
if (offenders) {
  throw new Error(
    'Refusing to write workflow.json: ' + offenders + " cross-node '.item' " +
      'reference(s) present. Use .first() -- see the note above this check.'
  );
}

fs.writeFileSync(path.join(__dirname, 'workflow.json'), serialised);
console.log('wrote workflow.json');
console.log('  nodes:       ' + nodes.length);
console.log('  agents:      ' + nodes.filter((n) => n.type === AGENT).length);
console.log('  code nodes:  ' + nodes.filter((n) => n.type === CODE).length);
console.log('  ai_tool connections: ' +
  Object.values(connections).filter((c) => c.ai_tool).length + '  (must be 0)');
console.log('  ai_memory connections: ' +
  Object.values(connections).filter((c) => c.ai_memory).length + '  (must be 0)');
