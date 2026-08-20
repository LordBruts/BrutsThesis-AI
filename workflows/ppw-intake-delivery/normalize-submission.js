// n8n Code node: "Normalize Submission"
// MODE: Run Once for All Items   LANGUAGE: JavaScript
//
// Replaces BOTH the old "Edit Fields" node and the "A1 Validator" agent.
//
// The old Edit Fields read fields[N].value and wrote a field NAMED
// fields[N].label, which destroyed every value in the payload -- the defect that
// made the entire workflow route every submission to "Missing Fields".
//
// The old validator was an LLM asked to check that eight fields were non-empty,
// with the result detected by testing whether its prose contained the word
// "VALIDATED". That false-passes whenever the model writes "VALIDATED" while
// explaining what is missing. Required-field checking is deterministic, so it
// is done here in code: no tokens, no ambiguity, no false pass.
//
// Fields are matched BY LABEL, not by position, so reordering the form no
// longer silently shifts every column.

// Accepts BOTH intake shapes, because the same form reaches n8n two ways:
//
//   1. Tally webhook  -> body.data.fields[] = [{ label, type, value, options }]
//   2. Google Sheets  -> a flat row whose COLUMN HEADERS are the question labels
//
// Tally's sheet columns are the question labels, and the matcher below is
// label-based, so one MAP serves both. The sheet route matters because it needs
// no inbound connectivity: n8n polls Google outbound, so it works from
// localhost with no tunnel.
const item = $input.first().json || {};
const body = item.body || {};
const data = body.data || {};
const isWebhook = Array.isArray(data.fields);

// Sheet columns Tally or n8n own, which are not questions and must not be
// reported as unmatched form labels.
const META_COLUMNS = /^(row_number|submission[ _]?id|respondent[ _]?id|form[ _]?id|form[ _]?name|submitted[ _]?at|created[ _]?at|timestamp|status|output[ _]?link|citation[ _]?count|unverified[ _]?count|notes)$/i;

// -> [{ label, field }] where field is a Tally field object or a { value } shim
const entries = isWebhook
  ? data.fields
      .filter(Boolean)
      .map((f) => ({ label: String(f.label || f.key || f.title || ''), field: f }))
  : Object.keys(item)
      .filter((k) => !META_COLUMNS.test(k))
      .map((k) => ({ label: k, field: { value: item[k] } }));

// The Sheets Trigger supplies row_number, which is the only reliable key for
// updating the row Tally just wrote. On the webhook path there is no row yet.
const row_number = isWebhook ? '' : item.row_number === undefined ? '' : item.row_number;

// label pattern -> canonical name. First match wins, so ORDER IS LOAD-BEARING:
// the most specific labels must be tested first. "Head of Department" and
// "Departmental Project Guideline" both contain the word "department", so both
// have to be matched before any pattern that looks for a department/programme.
// Getting this order wrong silently drops fields, which is the same class of
// failure as the original workflow's label/value swap.
const MAP = [
  ['guideline_url',   /guideline|departmental\s*(project\s*)?(guide|format|template)|upload|attachment|\bfile\b/i],
  ['student_email',   /e-?mail/i],
  ['hod',             /\bhod\b|head\s*of\s*(the\s*)?depart/i],
  ['supervisor',      /supervisor/i],
  ['reg_number',      /reg(istration)?[^a-z]*(number|no)\b|matric|admission\s*number|student\s*(id|number)/i],
  ['student_name',    /(student|your|full|candidate)[^a-z]*name|^name$/i],
  ['project_title',   /(project|research|study|thesis|dissertation)\s*(title|topic)|^title$/i],
  ['faculty',         /faculty|\bcollege\b|school\s*of/i],
  ['institution',     /institution|university|polytechnic/i],
  ['programme',       /programme|\bprogram\b|course\s*of\s*study|^department\b/i],
  ['study_location',  /(study|research)\s*(location|site|setting|area)|^location/i],
  ['study_duration',  /(study|research|project)\s*duration|^duration|time\s*frame|timeline/i],
];

const REQUIRED = [
  ['project_title',  'Project Title'],
  ['programme',      'Programme of Study'],
  ['faculty',        'Faculty'],
  ['institution',    'Institution'],
  ['student_name',   'Student Full Name'],
  ['reg_number',     'Registration/Matriculation Number'],
  ['supervisor',     "Supervisor's Name"],
  ['hod',            'Head of Department (HOD) Name'],
];

// Reduce any Tally field value to a trimmed string.
//
// The trap: for DROPDOWN, MULTIPLE_CHOICE, CHECKBOXES and RANKING, Tally does
// NOT send the chosen text. It sends an array of option UUIDs, and a separate
// `options` array mapping id -> text:
//
//   { type: "DROPDOWN", value: ["e7bfbbc6-c2e6-..."],
//     options: [{ id: "e7bfbbc6-c2e6-...", text: "Medical Radiography" }] }
//
// Taking `value` at face value writes a UUID into the thesis. Resolve it.
// FILE_UPLOAD instead sends an array of objects carrying `url`.
function toValue(f) {
  const v = f ? f.value : null;
  if (v === null || v === undefined) return '';

  const opts = f && Array.isArray(f.options) ? f.options : null;
  const resolve = (x) => {
    if (opts) {
      const hit = opts.find((o) => o && o.id === x);
      if (hit) return String(hit.text === undefined ? '' : hit.text).trim();
    }
    // Not an option id (free-text "Other", or a plain value) — keep as-is.
    return String(x).trim();
  };

  if (Array.isArray(v)) {
    if (!v.length) return '';
    if (typeof v[0] === 'object' && v[0] !== null) {
      // file upload / signature: take the first attachment's URL
      return String(v[0].url || v[0].value || v[0].label || v[0].name || '').trim();
    }
    return v.map(resolve).filter(Boolean).join(', ');
  }
  if (typeof v === 'object') return String(v.url || v.value || v.label || '').trim();
  return resolve(v);
}

const out = {};
const unmatched = [];

for (const e of entries) {
  const value = toValue(e.field);
  if (!value) continue;
  const hit = MAP.find(([, re]) => re.test(e.label));
  if (hit) {
    if (!out[hit[0]]) out[hit[0]] = value;   // first non-empty match wins
  } else {
    unmatched.push(e.label);
  }
}

const missing_required = REQUIRED.filter(([k]) => !out[k]).map(([, human]) => human);

// A guideline value only counts if it is actually a fetchable URL.
const guideline_url = /^https?:\/\//i.test(out.guideline_url || '') ? out.guideline_url : '';

// The form asks for "Programme of Study" and prompts with "e.g. Bachelor of
// Radiography", so students type a DEGREE, not a department. The document needs
// both, in different places:
//
//   cover page  -> "DEPARTMENT OF RADIOGRAPHY"
//   title page  -> "...FOR THE AWARD OF BACHELOR OF RADIOGRAPHY"
//
// Blindly prefixing gives "Bachelor of Science in Bachelor of Radiography", and
// using the raw value as a department gives "DEPARTMENT OF BACHELOR OF
// RADIOGRAPHY". Derive the two separately.
// The trailing "(of|in)" must be allowed independently of "of science",
// otherwise "Bachelor of Radiography" strips only "Bachelor" and leaves
// "of Radiography" as the department name.
const DEGREE_LEAD =
  /^\s*(b\.?\s?sc\.?|m\.?\s?sc\.?|b\.?a\.?|m\.?a\.?|ph\.?\s?d\.?|b\.?[a-z]{2,4}\.?|bachelor(\s+of\s+science)?(\s+(of|in))?|master(\s+of\s+science)?(\s+(of|in))?|doctor(\s+of\s+philosophy)?(\s+(of|in))?|degree\s+in)\s+/i;

const LOOKS_LIKE_DEGREE =
  /^\s*(b\.?\s?sc|m\.?\s?sc|b\.?a\b|m\.?a\b|ph\.?\s?d|b\.?[a-z]{2,4}\b|bachelor|master|doctor)/i;

const programme = out.programme || '';
// Department: strip any leading degree phrase. "Bachelor of Radiography" ->
// "Radiography"; "Medical Radiography" is left alone.
const stripped = programme.replace(DEGREE_LEAD, '').trim();
const department = stripped || programme;
// Degree: already a degree title? use it verbatim. Otherwise name one.
const degree = !programme
  ? ''
  : LOOKS_LIKE_DEGREE.test(programme)
  ? programme
  : 'Bachelor of Science in ' + programme;

const now = new Date();
const monthYear =
  ['January','February','March','April','May','June','July','August','September','October','November','December'][now.getMonth()] +
  ' ' + now.getFullYear();

return [
  {
    json: {
      trigger_source: isWebhook ? 'webhook' : 'sheet',
      row_number,
      submission_id: String(
        data.submissionId || data.responseId || data.id ||
        item['Submission ID'] || item.submission_id ||
        (row_number !== '' ? 'row-' + row_number : '')
      ),
      created_at: String(
        data.createdAt || item['Submitted at'] || item.timestamp || now.toISOString()
      ),
      project_title: out.project_title || '',
      programme: out.programme || '',
      faculty: out.faculty || '',
      institution: out.institution || '',
      student_name: out.student_name || '',
      reg_number: out.reg_number || '',
      supervisor: out.supervisor || '',
      hod: out.hod || '',
      study_location: out.study_location || '',
      study_duration: out.study_duration || '',
      student_email: out.student_email || '',
      guideline_url,
      guideline_uploaded: guideline_url ? 'Yes' : 'No',
      department,
      degree,
      month_year: monthYear,
      missing_required,
      is_valid: missing_required.length === 0,
      unmatched_form_labels: unmatched,
    },
  },
];
