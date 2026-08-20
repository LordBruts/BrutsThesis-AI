// n8n Code node: "Normalize Format Rules"
// MODE: Run Once for All Items   LANGUAGE: JavaScript
//
// Produces the format_rules object that drives the DOCX styles.
//
// In the original workflow the guideline was downloaded, parsed and analysed --
// and then thrown away: the analyzer fed a Merge node whose output nothing read,
// and the sub-workflow call forwarded only the validator's prose. This node is
// the convergence point that makes the guideline actually reach the document.
//
// It is reached from three paths, and must behave sensibly on all of them:
//   1. guideline analysed successfully  -> guideline values override defaults
//   2. no guideline supplied            -> defaults
//   3. download / extract / analysis failed -> defaults, with the reason recorded
//
// Anything the guideline does not state keeps its default. A guideline that
// mentions only a font must not silently reset the margins.

const DEFAULTS = {
  font: 'Times New Roman',
  fontSizePt: 12,
  pageSize: 'A4',
  lineSpacingPrelim: 1.5,
  lineSpacingChapters: 2.0,
  citationStyle: 'APA 7th Edition',
  alignment: 'justified',
  marginsInches: { top: 1, right: 1, bottom: 1, left: 1.5 },
};

const input = $input.first().json || {};

// The analyzer's structured output arrives under `output`; an error branch
// arrives with an `error` key and no rules at all.
const parsed = input.output && typeof input.output === 'object' ? input.output : null;
const errored = !!input.error;

const rules = JSON.parse(JSON.stringify(DEFAULTS));
const overrides = [];

function take(key, value, coerce) {
  if (value === null || value === undefined || value === '') return;
  const v = coerce ? coerce(value) : value;
  if (v === null || v === undefined || (typeof v === 'number' && !isFinite(v))) return;
  if (JSON.stringify(rules[key]) === JSON.stringify(v)) return;
  rules[key] = v;
  overrides.push(key);
}

const num = (v) => {
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
  return isFinite(n) ? n : null;
};

if (parsed) {
  take('font', parsed.font);
  take('fontSizePt', parsed.fontSizePt, num);
  take('pageSize', parsed.pageSize, (v) => String(v).toUpperCase());
  take('lineSpacingPrelim', parsed.lineSpacingPrelim, num);
  take('lineSpacingChapters', parsed.lineSpacingChapters, num);
  take('citationStyle', parsed.citationStyle);
  take('alignment', parsed.alignment, (v) => String(v).toLowerCase());

  const m = parsed.marginsInches;
  if (m && typeof m === 'object') {
    const merged = Object.assign({}, DEFAULTS.marginsInches);
    let changed = false;
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const v = num(m[side]);
      // sanity-bound: a "margin" of 0 or 9 inches is a parse artefact, not a rule
      if (v !== null && v >= 0.25 && v <= 3 && v !== merged[side]) { merged[side] = v; changed = true; }
    }
    if (changed) { rules.marginsInches = merged; overrides.push('marginsInches'); }
  }
}

// Guard the values the document generator divides and multiplies by.
if (!(rules.fontSizePt >= 8 && rules.fontSizePt <= 16)) rules.fontSizePt = DEFAULTS.fontSizePt;
if (!(rules.lineSpacingChapters >= 1 && rules.lineSpacingChapters <= 3)) rules.lineSpacingChapters = DEFAULTS.lineSpacingChapters;
if (!(rules.lineSpacingPrelim >= 1 && rules.lineSpacingPrelim <= 3)) rules.lineSpacingPrelim = DEFAULTS.lineSpacingPrelim;

const sub = $('Normalize Submission').first().json;

return [
  {
    json: {
      submission_id: sub.submission_id,
      project_title: sub.project_title,
      programme: sub.programme,
      faculty: sub.faculty,
      institution: sub.institution,
      student_name: sub.student_name,
      reg_number: sub.reg_number,
      supervisor: sub.supervisor,
      hod: sub.hod,
      study_location: sub.study_location,
      study_duration: sub.study_duration,
      student_email: sub.student_email,
      department: sub.department,
      degree: sub.degree,
      month_year: sub.month_year,
      format_rules: rules,
      guideline_status: parsed
        ? 'applied (' + (overrides.length ? overrides.join(', ') : 'no differences from default') + ')'
        : errored
        ? 'defaults used - guideline processing failed: ' + String(input.error).slice(0, 200)
        : 'defaults used - no guideline supplied',
    },
  },
];
