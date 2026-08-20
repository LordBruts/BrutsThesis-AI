// n8n Code node: "Assemble Document Input"
// MODE: Run Once for All Items   LANGUAGE: JavaScript
//
// Joins the sub-workflow's chapters to the submission metadata and format rules,
// producing the single object the DOCX generator consumes.
//
// Keeping this join explicit is what lets docx-generator.js be unit-tested
// offline against a plain object (see ../ppw-thesis-chapters/test/).

const thesis = $input.first().json || {};
const ctx = $('Normalize Format Rules').first().json || {};

const report = thesis.citation_report || {};
const violations = report.violations || [];

return [
  {
    json: {
      meta: {
        project_title: ctx.project_title,
        programme: ctx.programme,
        faculty: ctx.faculty,
        institution: ctx.institution,
        student_name: ctx.student_name,
        reg_number: ctx.reg_number,
        supervisor: ctx.supervisor,
        hod: ctx.hod,
        department: ctx.department,
        degree: ctx.degree,
        month_year: ctx.month_year,
      },
      format_rules: ctx.format_rules,
      ch1: thesis.ch1,
      ch2: thesis.ch2,
      ch3: thesis.ch3,
      abstract: thesis.abstract,
      references: thesis.references,

      // carried through for the sheet, so a run with citation problems is
      // visible rather than silently shipped
      submission_id: ctx.submission_id,
      student_email: ctx.student_email,
      guideline_status: ctx.guideline_status,
      citation_count: report.unique_refs_cited || 0,
      unverified_count: violations.length,
      citation_violations: violations
        .map((v) => v.type + (v.ref_id ? ' ' + v.ref_id : '') + ' in ' + v.chapter)
        .join('; ')
        .slice(0, 480),
      evidence_stats: thesis.evidence_stats || {},
    },
  },
];
