// Tests normalize-submission.js, including a replay of the ORIGINAL payload
// shape that the old workflow mishandled.
//   node test-normalize.js
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/normalize-submission.js', 'utf8');
const run = (body) => new Function('$input', SRC)({ first: () => ({ json: { body } }) })[0].json;

let pass = 0;
const fails = [];
const check = (n, c, d) => {
  if (c) { pass++; console.log('  ok   ' + n); }
  else { fails.push(n); console.log('  FAIL ' + n + (d !== undefined ? '  -> ' + JSON.stringify(d).slice(0, 200) : '')); }
};

const F = (label, value) => ({ key: 'q_' + label.replace(/\W/g, ''), label, type: 'INPUT_TEXT', value });

console.log('\n== 1. complete submission (original 11-field form + email) ==');
{
  const r = run({ data: { submissionId: 'sub_123', createdAt: '2026-08-19T10:00:00Z', fields: [
    F('Project Title', 'Assessment of Radiography Students Knowledge on IVU Justification'),
    F('Programme of Study', 'Medical Radiography'),
    F('Faculty', 'Faculty of Allied Health Sciences'),
    F('Institution', 'Bayero University, Kano'),
    F('Student Full Name', 'Aisha Mohammed Bello'),
    F('Registration Number', 'BUK/17/RAD/1234'),
    F("Supervisor's Name", 'Dr. I. Yisau'),
    F('Head of Department', 'Prof. M. Sani'),
    F('Study Location', 'Aminu Kano Teaching Hospital'),
    F('Proposed Study Duration', '6 months'),
    F('Your Email Address', 'aisha@example.com'),
    { key: 'q_g', label: 'Departmental Project Guideline', type: 'FILE_UPLOAD',
      value: [{ url: 'https://files.example.com/guide.pdf', name: 'guide.pdf' }] },
  ] } });
  check('valid', r.is_valid === true, r.missing_required);
  check('title mapped', r.project_title.startsWith('Assessment of Radiography'), r.project_title);
  check('programme mapped', r.programme === 'Medical Radiography', r.programme);
  check('faculty mapped', r.faculty === 'Faculty of Allied Health Sciences', r.faculty);
  check('institution mapped', r.institution === 'Bayero University, Kano', r.institution);
  check('student name mapped', r.student_name === 'Aisha Mohammed Bello', r.student_name);
  check('reg number mapped', r.reg_number === 'BUK/17/RAD/1234', r.reg_number);
  check('supervisor mapped', r.supervisor === 'Dr. I. Yisau', r.supervisor);
  check('hod mapped', r.hod === 'Prof. M. Sani', r.hod);
  check('location mapped', r.study_location === 'Aminu Kano Teaching Hospital', r.study_location);
  check('duration mapped', r.study_duration === '6 months', r.study_duration);
  check('email mapped', r.student_email === 'aisha@example.com', r.student_email);
  check('file URL extracted from array-of-objects', r.guideline_url === 'https://files.example.com/guide.pdf', r.guideline_url);
  check('guideline_uploaded flag', r.guideline_uploaded === 'Yes');
  check('submission id', r.submission_id === 'sub_123');
  check('degree derived', r.degree === 'Bachelor of Science in Medical Radiography', r.degree);
  check('month_year derived', /^[A-Z][a-z]+ \d{4}$/.test(r.month_year), r.month_year);
  check('nothing unmatched', r.unmatched_form_labels.length === 0, r.unmatched_form_labels);
}

console.log('\n== 2. THE OLD BUG: fields reordered -> still maps correctly ==');
{
  const r = run({ data: { submissionId: 's2', fields: [
    F('Head of Department', 'Prof. M. Sani'),
    F('Institution', 'Bayero University, Kano'),
    F('Project Title', 'Some Title'),
    F("Supervisor's Name", 'Dr. I. Yisau'),
    F('Student Full Name', 'Aisha Bello'),
    F('Faculty', 'Allied Health'),
    F('Registration Number', 'BUK/1'),
    F('Programme of Study', 'Radiography'),
  ] } });
  check('reordered form still valid', r.is_valid === true, r.missing_required);
  check('title not confused with student name',
    r.project_title === 'Some Title' && r.student_name === 'Aisha Bello',
    { t: r.project_title, s: r.student_name });
  check('hod vs supervisor kept distinct',
    r.hod === 'Prof. M. Sani' && r.supervisor === 'Dr. I. Yisau', { h: r.hod, s: r.supervisor });
}

console.log('\n== 3. missing required fields are named, not guessed ==');
{
  const r = run({ data: { submissionId: 's3', fields: [F('Project Title', 'T'), F('Programme', 'Radiography')] } });
  check('flagged invalid', r.is_valid === false);
  check('lists exactly the 6 missing', r.missing_required.length === 6, r.missing_required);
  check('names them in human terms',
    r.missing_required.includes('Faculty') && r.missing_required.includes("Supervisor's Name"), r.missing_required);
  check('present fields still captured', r.project_title === 'T' && r.programme === 'Radiography');
}

console.log('\n== 4. empty-string values count as missing ==');
{
  const r = run({ data: { fields: [F('Project Title', '   '), F('Programme', 'R'), F('Faculty', 'F'),
    F('Institution', 'I'), F('Student Full Name', 'N'), F('Registration Number', 'R1'),
    F("Supervisor's Name", 'S'), F('Head of Department', 'H')] } });
  check('whitespace-only title is missing',
    r.is_valid === false && r.missing_required[0] === 'Project Title', r.missing_required);
}

console.log('\n== 5. guideline edge cases ==');
{
  const a = run({ data: { fields: [F('Project Title', 'T')] } });
  check('no guideline -> empty + No', a.guideline_url === '' && a.guideline_uploaded === 'No');

  const b = run({ data: { fields: [{ key: 'g', label: 'Departmental Guideline', value: 'I will send it later' }] } });
  check('non-URL guideline value rejected', b.guideline_url === '' && b.guideline_uploaded === 'No', b.guideline_url);

  const c = run({ data: { fields: [{ key: 'g', label: 'Guideline upload', value: 'https://x.test/g.pdf' }] } });
  check('plain string URL accepted', c.guideline_url === 'https://x.test/g.pdf', c.guideline_url);
}

console.log('\n== 6. malformed payloads do not throw ==');
{
  check('empty body', run({}).is_valid === false);
  check('no data key', run({ other: 1 }).is_valid === false);
  check('fields not an array', run({ data: { fields: 'nope' } }).is_valid === false);
  let ok = false;
  try { ok = run({ data: { fields: [null, F('Project Title', 'T')] } }).project_title === 'T'; } catch (e) { ok = false; }
  check('null field entries', ok);
  const m = run({ data: { fields: [{ key: 'f', label: 'Faculty', value: ['Allied Health', 'Sciences'] }] } });
  check('multi-select array value joined', m.faculty === 'Allied Health, Sciences', m.faculty);
}

console.log('\n== 7. unrecognised labels are reported, not silently dropped ==');
{
  const r = run({ data: { fields: [F('Project Title', 'T'), F('Favourite colour', 'blue')] } });
  check('unknown label surfaced', r.unmatched_form_labels.includes('Favourite colour'), r.unmatched_form_labels);
}

console.log('\n== 8. REAL TALLY PAYLOAD: option IDs must resolve to text ==');
{
  // Tally sends option UUIDs for DROPDOWN / MULTIPLE_CHOICE / CHECKBOXES, with a
  // separate options[] mapping id -> text. Taking value at face value would put a
  // UUID into the thesis cover page.
  const r = run({
    eventId: 'evt_1',
    eventType: 'FORM_RESPONSE',
    createdAt: '2026-08-19T10:00:00.000Z',
    data: {
      responseId: 'resp_abc',
      submissionId: 'sub_abc123',
      respondentId: 'rsp_1',
      formId: 'wgpXYZ',
      formName: 'Thesis Request',
      createdAt: '2026-08-19T10:00:00.000Z',
      fields: [
        { key: 'question_1', label: 'Project Title', type: 'INPUT_TEXT',
          value: 'Assessment of Radiography Students Knowledge on IVU Justification' },
        { key: 'question_2', label: 'Programme of Study', type: 'DROPDOWN',
          value: ['e7bfbbc6-c2e6-4821-8670-72ed1cb31cd5'],
          options: [
            { id: 'e7bfbbc6-c2e6-4821-8670-72ed1cb31cd5', text: 'Medical Radiography' },
            { id: 'aaaaaaaa-0000-0000-0000-000000000000', text: 'Nursing Science' },
          ] },
        { key: 'question_3', label: 'Faculty', type: 'MULTIPLE_CHOICE',
          value: ['bbbbbbbb-1111-1111-1111-111111111111'],
          options: [{ id: 'bbbbbbbb-1111-1111-1111-111111111111', text: 'Faculty of Allied Health Sciences' }] },
        { key: 'question_4', label: 'Institution', type: 'INPUT_TEXT', value: 'Bayero University, Kano' },
        { key: 'question_5', label: 'Student Full Name', type: 'INPUT_TEXT', value: 'Aisha Mohammed Bello' },
        { key: 'question_6', label: 'Registration Number', type: 'INPUT_TEXT', value: 'BUK/17/RAD/1234' },
        { key: 'question_7', label: "Supervisor's Name", type: 'INPUT_TEXT', value: 'Dr. I. Yisau' },
        { key: 'question_8', label: 'Head of Department', type: 'INPUT_TEXT', value: 'Prof. M. Sani' },
        { key: 'question_9', label: 'Your Email Address', type: 'INPUT_EMAIL', value: 'aisha@example.com' },
        { key: 'question_10', label: 'Study Duration', type: 'CHECKBOXES',
          value: ['cccccccc-2222-2222-2222-222222222222', 'dddddddd-3333-3333-3333-333333333333'],
          options: [
            { id: 'cccccccc-2222-2222-2222-222222222222', text: '6 months' },
            { id: 'dddddddd-3333-3333-3333-333333333333', text: 'extendable' },
            { id: 'eeeeeeee-4444-4444-4444-444444444444', text: '12 months' },
          ] },
        { key: 'question_11', label: 'Departmental Project Guideline', type: 'FILE_UPLOAD',
          value: [{ id: 'f1', name: 'guide.pdf', url: 'https://storage.tally.so/private/guide.pdf',
                    mimeType: 'application/pdf', size: 123456 }] },
      ],
    },
  });

  check('dropdown UUID resolved to text', r.programme === 'Medical Radiography', r.programme);
  check('multiple-choice UUID resolved', r.faculty === 'Faculty of Allied Health Sciences', r.faculty);
  check('checkboxes resolve and join', r.study_duration === '6 months, extendable', r.study_duration);
  check('unselected option not included', !r.study_duration.includes('12 months'), r.study_duration);
  check('no raw UUID anywhere in output',
    !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(JSON.stringify(r)),
    JSON.stringify(r).match(/[0-9a-f-]{36}/));
  check('file upload URL extracted', r.guideline_url === 'https://storage.tally.so/private/guide.pdf', r.guideline_url);
  check('tally submissionId used', r.submission_id === 'sub_abc123', r.submission_id);
  check('tally createdAt used', r.created_at === '2026-08-19T10:00:00.000Z', r.created_at);
  check('submission is valid', r.is_valid === true, r.missing_required);
  check('degree derived from resolved programme',
    r.degree === 'Bachelor of Science in Medical Radiography', r.degree);
}

console.log('\n== 9. option-id edge cases ==');
{
  // A free-text "Other" answer is not an option id and must survive untouched.
  const a = run({ data: { fields: [
    { key: 'q', label: 'Programme', type: 'DROPDOWN', value: ['Other: Radiotherapy'],
      options: [{ id: 'xyz', text: 'Medical Radiography' }] } ] } });
  check('unmatched value passes through', a.programme === 'Other: Radiotherapy', a.programme);

  // options present but empty
  const b = run({ data: { fields: [
    { key: 'q', label: 'Faculty', type: 'DROPDOWN', value: ['Allied Health'], options: [] } ] } });
  check('empty options array is harmless', b.faculty === 'Allied Health', b.faculty);

  // an option whose text is an empty string must not be treated as present
  const c = run({ data: { fields: [
    { key: 'q', label: 'Institution', type: 'DROPDOWN', value: ['id1'],
      options: [{ id: 'id1', text: '' }] } ] } });
  check('blank option text counts as missing', c.institution === '', JSON.stringify(c.institution));
}

console.log('\n== 10. THE REAL FORM: the live Tally form ==');
{
  // Labels read from the live form definition on 2026-08-19. If the form is
  // edited, re-check these against the MAP patterns.
  const REAL = [
    ['Email', 'INPUT_EMAIL', 'aisha@example.com'],
    ['Project Title', 'INPUT_TEXT', 'Assessment of Radiography Students Knowledge on IVU Justification'],
    ['Programme of Study', 'INPUT_TEXT', 'Bachelor of Radiography'],
    ['Faculty', 'INPUT_TEXT', 'Faculty of Allied Health Sciences'],
    ['Institution', 'INPUT_TEXT', 'Bayero University, Kano'],
    ['Student Full Name', 'INPUT_TEXT', 'Aisha Mohammed Bello'],
    ['Registration/Matriculation Number', 'INPUT_TEXT', 'AHS/22/RAD/00123'],
    ["Supervisor's Name and Title", 'INPUT_TEXT', 'Dr. I. Yisau'],
    ['Head of Department (HOD) Name and Title', 'INPUT_TEXT', 'Prof. M. Sani'],
    ['Study Location', 'INPUT_TEXT', 'Aminu Kano Teaching Hospital'],
    ['Proposed Study Duration', 'INPUT_TEXT', '6 months'],
    ['Departmental Project Guideline', 'FILE_UPLOAD',
      [{ url: 'https://storage.tally.so/private/guide.pdf', name: 'guide.pdf' }]],
  ];
  const r = run({ data: { submissionId: 'sub_real', createdAt: '2026-08-19T10:00:00Z',
    fields: REAL.map(([label, type, value], i) => ({ key: 'question_' + i, label, type, value })) } });

  check('every required field mapped', r.is_valid === true, r.missing_required);
  check('no unmatched labels', r.unmatched_form_labels.length === 0, r.unmatched_form_labels);
  check('"Registration/Matriculation Number" -> reg_number', r.reg_number === 'AHS/22/RAD/00123', r.reg_number);
  check('"Supervisor\'s Name and Title" -> supervisor', r.supervisor === 'Dr. I. Yisau', r.supervisor);
  check('"Head of Department (HOD) Name and Title" -> hod', r.hod === 'Prof. M. Sani', r.hod);
  check('HOD label not swallowed by programme pattern', r.programme === 'Bachelor of Radiography', r.programme);
  check('"Departmental Project Guideline" -> guideline, not programme',
    r.guideline_url === 'https://storage.tally.so/private/guide.pdf', r.guideline_url);
  check('"Email" -> student_email', r.student_email === 'aisha@example.com', r.student_email);
  check('optional fields captured',
    r.study_location === 'Aminu Kano Teaching Hospital' && r.study_duration === '6 months',
    [r.study_location, r.study_duration]);
}

console.log('\n== 11. programme -> department / degree ==');
{
  // The form prompts "e.g. Bachelor of Radiography", so students type a degree.
  // The cover page needs a DEPARTMENT; the title page needs a DEGREE.
  const cases = [
    ['Bachelor of Radiography',            'Radiography',         'Bachelor of Radiography'],
    ['B.Sc Medical Radiography',           'Medical Radiography', 'B.Sc Medical Radiography'],
    ['BSc Nursing Science',                'Nursing Science',     'BSc Nursing Science'],
    ['Bachelor of Science in Physiotherapy', 'Physiotherapy',     'Bachelor of Science in Physiotherapy'],
    ['B.Rad Medical Radiography',          'Medical Radiography', 'B.Rad Medical Radiography'],
    ['Medical Radiography',                'Medical Radiography', 'Bachelor of Science in Medical Radiography'],
    ['Physiotherapy',                      'Physiotherapy',       'Bachelor of Science in Physiotherapy'],
  ];
  for (const [input, wantDept, wantDeg] of cases) {
    const r = run({ data: { fields: [{ key: 'p', label: 'Programme of Study', value: input }] } });
    check('"' + input + '" -> dept "' + r.department + '"', r.department === wantDept, r.department);
    check('"' + input + '" -> degree "' + r.degree + '"', r.degree === wantDeg, r.degree);
  }
  const none = run({ data: { fields: [{ key: 'x', label: 'Faculty', value: 'F' }] } });
  check('no programme -> empty dept and degree', none.department === '' && none.degree === '',
    [none.department, none.degree]);
  check('never double-prefixes',
    !cases.some(([i]) => run({ data: { fields: [{ key: 'p', label: 'Programme', value: i }] } })
      .degree.match(/Bachelor of Science in (Bachelor|B\.|BSc|Master)/i)));
}

// --- second intake shape: a row from the Tally -> Google Sheets integration ---
const runRow = (row) => new Function('$input', SRC)({ first: () => ({ json: row }) })[0].json;

console.log('\n== 12. GOOGLE SHEETS ROW: same labels, flat shape ==');
{
  // Column headers are the Tally question labels, so the same MAP applies.
  const r = runRow({
    row_number: 7,
    'Submission ID': 'sub_sheet_1',
    'Respondent ID': 'rsp_9',
    'Submitted at': '2026-08-19T11:00:00Z',
    'Email': 'aisha@example.com',
    'Project Title': 'Assessment of Radiography Students Knowledge on IVU Justification',
    'Programme of Study': 'Bachelor of Radiography',
    'Faculty': 'Faculty of Allied Health Sciences',
    'Institution': 'Bayero University, Kano',
    'Student Full Name': 'Aisha Mohammed Bello',
    'Registration/Matriculation Number': 'AHS/22/RAD/00123',
    "Supervisor's Name and Title": 'Dr. I. Yisau',
    'Head of Department (HOD) Name and Title': 'Prof. M. Sani',
    'Study Location': 'Aminu Kano Teaching Hospital',
    'Proposed Study Duration': '6 months',
    'Departmental Project Guideline': 'https://storage.tally.so/private/guide.pdf',
  });

  check('recognised as sheet shape', r.trigger_source === 'sheet', r.trigger_source);
  check('row_number carried (the update key)', r.row_number === 7, r.row_number);
  check('valid', r.is_valid === true, r.missing_required);
  check('all eight required mapped',
    !!(r.project_title && r.programme && r.faculty && r.institution &&
       r.student_name && r.reg_number && r.supervisor && r.hod));
  check('email mapped', r.student_email === 'aisha@example.com', r.student_email);
  check('guideline URL from plain cell text',
    r.guideline_url === 'https://storage.tally.so/private/guide.pdf', r.guideline_url);
  check('department derived on sheet path too', r.department === 'Radiography', r.department);
  check('degree not double-prefixed', r.degree === 'Bachelor of Radiography', r.degree);
  check('Submission ID column used', r.submission_id === 'sub_sheet_1', r.submission_id);
  check('Submitted at used as created_at', r.created_at === '2026-08-19T11:00:00Z', r.created_at);
  check('metadata columns not reported as unmatched',
    r.unmatched_form_labels.length === 0, r.unmatched_form_labels);
}

console.log('\n== 13. sheet-row edge cases ==');
{
  // No Submission ID column: fall back to a row-derived id so the sheet write
  // still has something stable to reference.
  const r = runRow({ row_number: 12, 'Project Title': 'T', 'Programme of Study': 'Radiography' });
  check('falls back to row-derived id', r.submission_id === 'row-12', r.submission_id);
  check('incomplete row flagged', r.is_valid === false && r.missing_required.length === 6, r.missing_required);

  // n8n's own tracking columns must never be treated as questions.
  const m = runRow({ row_number: 3, status: 'Received', output_link: 'https://x', notes: 'n',
    citation_count: 4, unverified_count: 0, 'Project Title': 'T' });
  check('workflow columns ignored', m.unmatched_form_labels.length === 0, m.unmatched_form_labels);
  check('status column not mistaken for a field', m.project_title === 'T', m.project_title);

  // Empty cells behave like missing answers.
  const e = runRow({ row_number: 4, 'Project Title': '', 'Faculty': '   ' });
  check('empty cells count as missing', e.is_valid === false && e.project_title === '', e.project_title);

  // A webhook payload must still win over any stray top-level keys.
  const w = run({ data: { fields: [F('Project Title', 'From webhook')] } });
  check('webhook shape still detected', w.trigger_source === 'webhook', w.trigger_source);
  check('webhook has no row_number', w.row_number === '', w.row_number);
}

console.log('\n' + '='.repeat(58));
if (fails.length) {
  console.log('FAILED: ' + fails.length + ' check(s), ' + pass + ' passed');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('ALL PASS: ' + pass + ' checks');
