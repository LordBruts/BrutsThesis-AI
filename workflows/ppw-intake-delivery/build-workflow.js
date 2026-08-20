// Generates workflow.json for "PPW · Intake & Delivery".
//
// Code-node sources live in their own .js files and are inlined here, so the
// tested source and the deployed source are identical by construction.
//
//   node build-workflow.js

const fs = require('fs');
const path = require('path');
const code = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

// --------------------------------------------------------------- constants ----
// Instance-specific values live in config.local.json, which is gitignored.
// config.example.json ships the same keys with placeholders, so this file is
// byte-identical here and in the public repository and cannot drift between
// them -- the property that made the last round of bugs findable at all.
//
// The sheet is the one Tally itself writes into. The workflow adds its own
// tracking columns to the right of Tally's and UPDATES the row Tally created,
// rather than keeping a second register that has to be reconciled.
const CFG_LOCAL = path.join(__dirname, 'config.local.json');
const CFG = JSON.parse(fs.readFileSync(
  fs.existsSync(CFG_LOCAL) ? CFG_LOCAL : path.join(__dirname, 'config.example.json'),
  'utf8'
));

const SHEET_ID = CFG.sheetId;
const SHEET_NAME = CFG.sheetName;
const SUB_WORKFLOW_ID = CFG.subWorkflowId;

// Credential ids are per-instance and cannot be carried between installations,
// so a null entry simply omits the block and the credential is attached in the
// n8n UI instead. The Google Sheets and Drive credentials are always attached
// that way, because OAuth needs a browser consent flow.
const cred = (type, c) => (c ? { [type]: { id: c.id, name: c.name } } : undefined);
const CRED = {
  header: cred('httpHeaderAuth', CFG.credentials.header),
  gmail: cred('gmailOAuth2', CFG.credentials.gmail),
  openrouter: cred('openRouterApi', CFG.credentials.openrouter),
};
const COLUMNS = [
  'submission_id', 'timestamp', 'student_name', 'reg_number', 'project_title',
  'programme', 'faculty', 'institution', 'supervisor', 'hod', 'study_location',
  'study_duration', 'student_email', 'guideline_uploaded', 'status',
  'output_link', 'citation_count', 'unverified_count', 'notes',
];

const sheetSchema = () =>
  [{
    id: 'row_number', displayName: 'row_number', required: false, defaultMatch: false,
    display: true, type: 'number', canBeUsedToMatch: true, readOnly: true, removed: false,
  }].concat(COLUMNS.map((id) => ({
    id, displayName: id, required: false, defaultMatch: false,
    display: true, type: 'string', canBeUsedToMatch: true, removed: false,
  })));

// Rows are matched on row_number, not submission_id.
//
// Tally owns this sheet and writes the response row; the workflow only fills in
// its own columns on that same row. row_number is the one key both sides agree
// on without any column-naming coordination -- the Sheets Trigger hands it to us
// directly. On the webhook path there is no row yet, so row_number is empty,
// nothing matches, and appendOrUpdate appends instead. Both behave correctly
// with a single set of nodes.
const MATCH_ON = ['row_number'];

// ----------------------------------------------------------------- helpers ----
const nodes = [];
const connections = {};

function node(name, type, typeVersion, parameters, position, extra) {
  nodes.push(Object.assign({ parameters, name, type, typeVersion, position }, extra || {}));
  return name;
}
function connect(from, to, fromIndex, type, toIndex) {
  type = type || 'main';
  fromIndex = fromIndex || 0;
  toIndex = toIndex || 0;
  connections[from] = connections[from] || {};
  connections[from][type] = connections[from][type] || [];
  while (connections[from][type].length <= fromIndex) connections[from][type].push([]);
  connections[from][type][fromIndex].push({ node: to, type, index: toIndex });
}
const codeNode = (name, file, pos, extra) =>
  node(name, 'n8n-nodes-base.code', 2, { jsCode: code(file) }, pos, extra);

function sheet(name, operation, values, pos, extra) {
  // row_number is the match key, so every write carries it
  values = Object.assign({ row_number: values.row_number || "={{ $('Normalize Submission').item.json.row_number }}" }, values);
  return node(name, 'n8n-nodes-base.googleSheets', 4.7, {
    operation,
    // mode 'id', NOT 'list': the From-List picker resolves through the Google
    // DRIVE API (spreadSheetsSearch), which fails with 403 unless Drive is
    // enabled in the Cloud project. By-ID needs only the Sheets API.
    documentId: { __rl: true, mode: 'id', value: SHEET_ID },
    sheetName: { __rl: true, mode: 'id', value: SHEET_NAME },
    columns: {
      mappingMode: 'defineBelow',
      value: values,
      matchingColumns: MATCH_ON,
      schema: sheetSchema(),
      attemptToConvertTypes: false,
      convertFieldsToString: true,
    },
    options: {},
  }, pos, extra);
}

function respond(name, code_, body, pos) {
  // On the Sheets-trigger path there is no webhook to answer; without this the
  // node throws and takes the whole run down.
  return node(name, 'n8n-nodes-base.respondToWebhook', 1.5, {
    respondWith: 'json',
    responseBody: body,
    options: { responseCode: code_ },
  }, pos, { onError: 'continueRegularOutput' });
}

// ================================================================= graph ======

// -- 1. intake -----------------------------------------------------------------
node('Webhook', 'n8n-nodes-base.webhook', 2.1, {
  httpMethod: 'POST',
  path: 'PPW',
  authentication: 'headerAuth',
  responseMode: 'responseNode',
  options: {},
}, [0, 300], { webhookId: 'c045f8f3-a5c9-4edf-ac7d-4171113c7a22', credentials: CRED.header });

// Second, independent entry point. n8n POLLS Google outbound, so this needs no
// tunnel, no public URL and no inbound connectivity at all -- which is what
// makes the workflow usable from localhost today. Both triggers feed the same
// Normalize Submission node, which detects the shape it was handed.
//
// Needs its own credential: googleSheetsTriggerOAuth2Api is a DIFFERENT type
// from googleSheetsOAuth2Api used by the write nodes.
node('Sheet Trigger', 'n8n-nodes-base.googleSheetsTrigger', 1, {
  documentId: { __rl: true, mode: 'id', value: SHEET_ID },
  sheetName: { __rl: true, mode: 'id', value: SHEET_NAME },
  event: 'rowAdded',
  options: {},
}, [0, 120]);

codeNode('Normalize Submission', 'normalize-submission.js', [220, 300]);

node('Submission Valid?', 'n8n-nodes-base.if', 2.3, {
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{
      id: 'valid-1',
      leftValue: '={{ $json.is_valid }}',
      rightValue: '',
      operator: { type: 'boolean', operation: 'true', singleValue: true },
    }],
    combinator: 'and',
  },
  options: {},
}, [440, 300]);

// -- 2a. rejected: record and answer 400 ---------------------------------------
sheet('Sheet · Mark Incomplete', 'appendOrUpdate', {
  submission_id: '={{ $json.submission_id }}',
  timestamp: '={{ $json.created_at }}',
  student_name: '={{ $json.student_name }}',
  reg_number: '={{ $json.reg_number }}',
  project_title: '={{ $json.project_title }}',
  programme: '={{ $json.programme }}',
  faculty: '={{ $json.faculty }}',
  institution: '={{ $json.institution }}',
  supervisor: '={{ $json.supervisor }}',
  hod: '={{ $json.hod }}',
  student_email: '={{ $json.student_email }}',
  guideline_uploaded: '={{ $json.guideline_uploaded }}',
  status: 'Incomplete',
  notes: '=Missing: {{ $json.missing_required.join(", ") }}',
}, [660, 480], { onError: 'continueRegularOutput' });

respond('Respond 400 Incomplete', 400,
  '={{ JSON.stringify({ status: "incomplete", message: "Some required fields are missing. Please resubmit with them completed.", missing: $(\'Normalize Submission\').item.json.missing_required }) }}',
  [880, 480]);

// -- 2b. accepted: record, then answer IMMEDIATELY -----------------------------
// The thesis run takes many minutes. The original workflow left the form client
// waiting for all of it behind responseMode:responseNode and timed out every
// time. Responding here and continuing afterwards is the fix.
sheet('Sheet · Record Submission', 'appendOrUpdate', {
  submission_id: '={{ $json.submission_id }}',
  timestamp: '={{ $json.created_at }}',
  student_name: '={{ $json.student_name }}',
  reg_number: '={{ $json.reg_number }}',
  project_title: '={{ $json.project_title }}',
  programme: '={{ $json.programme }}',
  faculty: '={{ $json.faculty }}',
  institution: '={{ $json.institution }}',
  supervisor: '={{ $json.supervisor }}',
  hod: '={{ $json.hod }}',
  study_location: '={{ $json.study_location }}',
  study_duration: '={{ $json.study_duration }}',
  student_email: '={{ $json.student_email }}',
  guideline_uploaded: '={{ $json.guideline_uploaded }}',
  status: 'Received',
  output_link: '',
  notes: '',
}, [660, 120], { onError: 'continueRegularOutput' });

// A failed sheet write must not condemn the rest of the run. See the node
// source for the mechanism -- n8n forwards an already-errored item to the
// next error output it finds, which made a perfectly successful guideline
// download report as a failure on execution 147.
node('Clear Sheet Error', 'n8n-nodes-base.code', 2,
  { mode: 'runOnceForAllItems', jsCode: code('clear-sheet-error.js') }, [880, 288]);

respond('Respond 202 Accepted', 202,
  '={{ JSON.stringify({ status: "accepted", submission_id: $(\'Normalize Submission\').item.json.submission_id, message: "Submission received. Your thesis proposal is being generated and will be emailed to you when it is ready." }) }}',
  [880, 120]);

// -- 3. departmental guideline (optional) --------------------------------------
node('Has Guideline?', 'n8n-nodes-base.if', 2.3, {
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{
      id: 'guide-1',
      leftValue: '={{ $(\'Normalize Submission\').item.json.guideline_url }}',
      rightValue: '',
      operator: { type: 'string', operation: 'notEmpty', singleValue: true },
    }],
    combinator: 'and',
  },
  options: {},
}, [1100, 120]);

node('Download Guideline', 'n8n-nodes-base.httpRequest', 4.4, {
  url: '={{ $(\'Normalize Submission\').item.json.guideline_url }}',
  options: { response: { response: { responseFormat: 'file' } }, timeout: 60000 },
}, [1320, 0], { retryOnFail: true, maxTries: 3, waitBetweenTries: 2000, onError: 'continueErrorOutput' });

node('Extract Guideline Text', 'n8n-nodes-base.extractFromFile', 1.1, {
  operation: 'pdf',
  binaryPropertyName: 'data',
  options: {},
}, [1540, 0], { onError: 'continueErrorOutput' });

node('Model · Guideline', '@n8n/n8n-nodes-langchain.lmChatOpenRouter', 1, {
  model: 'deepseek/deepseek-v4-flash',
  options: { temperature: 0 },
}, [1760, 300], { credentials: CRED.openrouter });

node('A2 Guideline Analyzer', '@n8n/n8n-nodes-langchain.agent', 3.1, {
  promptType: 'define',
  text: '=Extract the formatting rules from this departmental project guideline.\n\n{{ $json.text.slice(0, 24000) }}',
  hasOutputParser: true,
  options: {
    systemMessage:
      'You extract document-formatting rules from a university departmental project guideline.\n\n' +
      'Return ONLY rules the document explicitly states. If the document does not mention a setting, ' +
      'return null for it so the system default is kept. Never guess a value, and never copy the ' +
      'example values from this instruction.\n\n' +
      'Units: fontSizePt in points; line spacing as a number (1, 1.5, 2); margins in inches ' +
      '(convert from cm by dividing by 2.54); pageSize as A4 or Letter.',
  },
}, [1760, 0], { onError: 'continueErrorOutput', retryOnFail: true, maxTries: 2 });

node('Guideline Schema', '@n8n/n8n-nodes-langchain.outputParserStructured', 1.3, {
  schemaType: 'manual',
  autoFix: true,
  inputSchema: JSON.stringify({
    type: 'object',
    properties: {
      font: { type: ['string', 'null'] },
      fontSizePt: { type: ['number', 'null'] },
      pageSize: { type: ['string', 'null'] },
      lineSpacingPrelim: { type: ['number', 'null'] },
      lineSpacingChapters: { type: ['number', 'null'] },
      citationStyle: { type: ['string', 'null'] },
      alignment: { type: ['string', 'null'] },
      marginsInches: {
        type: ['object', 'null'],
        properties: {
          top: { type: ['number', 'null'] }, right: { type: ['number', 'null'] },
          bottom: { type: ['number', 'null'] }, left: { type: ['number', 'null'] },
        },
      },
    },
    required: [],
  }, null, 2),
}, [1980, 300]);

// Convergence point for all three guideline paths (analysed / absent / failed).
// Deliberately NOT a Merge node: the original used Merge in append mode with
// both IF outputs feeding it, which produced two items and ran the entire
// agent chain twice on every submission that included a guideline.
codeNode('Normalize Format Rules', 'normalize-format-rules.js', [2200, 120]);

// -- 4. generate ---------------------------------------------------------------
node('Call Thesis Chapters', 'n8n-nodes-base.executeWorkflow', 1.3, {
  workflowId: { __rl: true, mode: 'list', value: SUB_WORKFLOW_ID, cachedResultName: 'PPW · Thesis Chapters 1-3' },
  workflowInputs: {
    mappingMode: 'defineBelow',
    value: {
      submission_id: '={{ $json.submission_id }}',
      project_title: '={{ $json.project_title }}',
      programme: '={{ $json.programme }}',
      faculty: '={{ $json.faculty }}',
      institution: '={{ $json.institution }}',
      student_name: '={{ $json.student_name }}',
      reg_number: '={{ $json.reg_number }}',
      supervisor: '={{ $json.supervisor }}',
      hod: '={{ $json.hod }}',
      study_location: '={{ $json.study_location }}',
      study_duration: '={{ $json.study_duration }}',
      format_rules: '={{ $json.format_rules }}',
    },
    matchingColumns: [],
    schema: [],
    attemptToConvertTypes: false,
    convertFieldsToString: false,
  },
  mode: 'once',
  options: { waitForSubWorkflow: true },
}, [2420, 120], { onError: 'continueErrorOutput' });

codeNode('Assemble Document Input', 'assemble-document-input.js', [2640, 120]);
codeNode('Generate DOCX', path.join('..', 'ppw-thesis-chapters', 'docx-generator.js'), [2860, 120]);

// -- 5. deliver ----------------------------------------------------------------
node('Drive · Upload Thesis', 'n8n-nodes-base.googleDrive', 3, {
  resource: 'file',
  operation: 'upload',
  inputDataFieldName: 'data',
  name: '={{ $json.filename }}',
  driveId: { __rl: true, mode: 'list', value: 'My Drive' },
  folderId: { __rl: true, mode: 'list', value: 'root', cachedResultName: '/ (Root folder)' },
  options: {},
}, [3080, 120], { onError: 'continueErrorOutput', retryOnFail: true, maxTries: 2 });

sheet('Sheet · Mark Complete', 'appendOrUpdate', {
  submission_id: '={{ $(\'Assemble Document Input\').item.json.submission_id }}',
  status: 'Completed',
  output_link: '=https://drive.google.com/file/d/{{ $json.id }}/view',
  citation_count: '={{ $(\'Assemble Document Input\').item.json.citation_count }}',
  unverified_count: '={{ $(\'Assemble Document Input\').item.json.unverified_count }}',
  notes: '={{ $(\'Assemble Document Input\').item.json.unverified_count > 0 ? "CITATION ISSUES: " + $(\'Assemble Document Input\').item.json.citation_violations : $(\'Assemble Document Input\').item.json.guideline_status }}',
}, [3300, 120], { onError: 'continueRegularOutput' });

// The .docx goes to the student as an attachment. The Drive link stays in the
// sheet for the workflow owner: the document carries the student's personal
// details, so it is not made link-shareable.
node('Gmail · Send Thesis', 'n8n-nodes-base.gmail', 2.2, {
  sendTo: '={{ $(\'Assemble Document Input\').item.json.student_email }}',
  subject: '=Your thesis proposal — {{ $(\'Normalize Format Rules\').item.json.project_title }}',
  message:
    '=<p>Dear {{ $(\'Normalize Format Rules\').item.json.student_name }},</p>' +
    '<p>Your thesis proposal (preliminary pages, Chapters 1–3, abstract and references) is attached as a Word document.</p>' +
    '<p>It cites {{ $(\'Assemble Document Input\').item.json.citation_count }} verified sources. Every reference was ' +
    'resolved against Europe PMC and formatted automatically, so the reference list matches the in-text citations exactly.</p>' +
    '<p><strong>Before you submit it:</strong> open the Table of Contents page, right-click and choose ' +
    '“Update Field” to build the contents list. Personalise the Dedication and Acknowledgement pages. ' +
    'Then read the draft critically — it is a starting point for your own work, not a finished submission.</p>' +
    '<p>Regards,<br>Thesis Proposal Generator</p>',
  options: { attachmentsUi: { attachmentsBinary: [{ property: 'data' }] } },
}, [3520, 120], { onError: 'continueRegularOutput', credentials: CRED.gmail });

// -- 6. failure path -----------------------------------------------------------
sheet('Sheet · Mark Failed', 'appendOrUpdate', {
  submission_id: '={{ $(\'Normalize Submission\').item.json.submission_id }}',
  status: 'Failed',
  notes: '=Generation failed: {{ JSON.stringify($json.error || $json).slice(0, 400) }}',
}, [3080, 420], { onError: 'continueRegularOutput' });

// ------------------------------------------------------------------ wiring ----
connect('Webhook', 'Normalize Submission');
connect('Sheet Trigger', 'Normalize Submission');
connect('Normalize Submission', 'Submission Valid?');

// IF output 0 = true (valid), output 1 = false (incomplete)
connect('Submission Valid?', 'Sheet · Record Submission', 0);
connect('Submission Valid?', 'Sheet · Mark Incomplete', 1);

connect('Sheet · Mark Incomplete', 'Respond 400 Incomplete');
connect('Sheet · Record Submission', 'Clear Sheet Error');
connect('Clear Sheet Error', 'Respond 202 Accepted');
connect('Respond 202 Accepted', 'Has Guideline?');

connect('Has Guideline?', 'Download Guideline', 0);
connect('Has Guideline?', 'Normalize Format Rules', 1);      // no guideline -> defaults
connect('Download Guideline', 'Extract Guideline Text', 0);
connect('Download Guideline', 'Normalize Format Rules', 1);  // download failed -> defaults
connect('Extract Guideline Text', 'A2 Guideline Analyzer', 0);
connect('Extract Guideline Text', 'Normalize Format Rules', 1);
connect('A2 Guideline Analyzer', 'Normalize Format Rules', 0);
connect('A2 Guideline Analyzer', 'Normalize Format Rules', 1);
connect('Model · Guideline', 'A2 Guideline Analyzer', 0, 'ai_languageModel');
connect('Model · Guideline', 'Guideline Schema', 0, 'ai_languageModel');
connect('Guideline Schema', 'A2 Guideline Analyzer', 0, 'ai_outputParser');

connect('Normalize Format Rules', 'Call Thesis Chapters');
connect('Call Thesis Chapters', 'Assemble Document Input', 0);
connect('Call Thesis Chapters', 'Sheet · Mark Failed', 1);
connect('Assemble Document Input', 'Generate DOCX');
// The email hangs directly off the document, in parallel with the upload.
//
// It used to be last in a chain: Generate DOCX -> Drive -> Sheet -> Gmail. Drive
// consumes the binary and neither it nor the Sheets node forwards one, so by the
// time the item reached Gmail the .docx was long gone and every send failed with
// "expects the node's input data to contain a binary file 'data'". Not one
// student ever received an email (execution 199).
//
// Branching here fixes that and settles a priority at the same time: the thesis
// is the deliverable, the Drive copy and the spreadsheet row are bookkeeping. A
// failure in either must not cost the student their document. It also removes
// the last place the error-item poisoning could bite -- with nothing downstream
// of Mark Complete, a failed sheet write has nothing left to derail.
connect('Generate DOCX', 'Drive · Upload Thesis');
connect('Generate DOCX', 'Gmail · Send Thesis');
connect('Drive · Upload Thesis', 'Sheet · Mark Complete', 0);
connect('Drive · Upload Thesis', 'Sheet · Mark Failed', 1);

// ------------------------------------------------------------------ output ----
const workflow = {
  name: 'PPW · Intake & Delivery',
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

fs.writeFileSync(path.join(__dirname, 'workflow.json'), JSON.stringify(workflow, null, 2));
console.log('wrote workflow.json');
console.log('  nodes:      ' + nodes.length);
console.log('  sub-workflow target: ' + SUB_WORKFLOW_ID);
const noCred = nodes.filter((n) => /googleSheets|googleDrive/.test(n.type)).map((n) => n.name);
console.log('  awaiting Google credentials in the UI: ' + noCred.length + ' node(s)');
noCred.forEach((n) => console.log('      - ' + n));
