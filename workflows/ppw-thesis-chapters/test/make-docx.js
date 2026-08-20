// Generates a .docx from docx-generator.js using realistic input, for the
// python validator (and for a human to open).
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'docx-generator.js'), 'utf8');

const input = {
  meta: {
    project_title: 'Assessment of Radiography Students\u2019 Knowledge on Justification Criteria for Intravenous Urography (IVU) Using Conventional X-rays Versus CT Imaging',
    programme: 'Bachelor of Radiography',
    department: 'Radiography',
    faculty: 'Faculty of Allied Health Sciences',
    institution: 'Bayero University, Kano',
    student_name: 'Aisha Mohammed Bello',
    reg_number: 'BUK/17/RAD/1234',
    supervisor: 'Dr. I. Yisau',
    hod: 'Prof. M. Sani',
    degree: 'Bachelor of Radiography',
    month_year: 'August 2026',
  },
  format_rules: {
    font: 'Times New Roman', fontSizePt: 12, lineSpacingChapters: 2.0,
    lineSpacingPrelim: 1.5, pageSize: 'A4',
    marginsInches: { top: 1, right: 1, bottom: 1, left: 1.5 },
  },
  abstract:
    'Background: Justification of radiological examinations is a core radiation-protection duty.\n\n' +
    'Aim: To assess knowledge of justification criteria among radiography students.\n\n' +
    'Methods: A descriptive cross-sectional design will be used.\n\n' +
    'Conclusion: Findings will inform curriculum review.',
  ch1:
    '# CHAPTER ONE\n\n## 1.1 BACKGROUND OF THE STUDY\n\n' +
    'Computed Tomography (CT) has largely displaced conventional Intravenous Urography (IVU) ' +
    'in many centres (Zhong & Chow, 2026). The International Commission on Radiological Protection (ICRP) ' +
    'requires that every exposure be justified (Nocum et al., 2026).\n\n' +
    'Table 2.1: Distribution of respondents by level of study\n\n' +
    'Figure 2.1: Conceptual framework of justification decision-making\n\n' +
    '## 1.2 STATEMENT OF THE RESEARCH PROBLEM\n\n' +
    'The ideal is full compliance (Ahsan, 2025). Reality diverges. Consequences follow.\n\n' +
    '- First bulleted objective\n- Second bulleted objective\n\n' +
    'Special characters that must survive escaping: R&D, 5 < 10, 10 > 5, "quoted", \u2018curly\u2019.',
  ch2:
    '## 2.0 INTRODUCTION\n\nThis chapter reviews the literature.\n\n' +
    '## 2.1 CONCEPTUAL REVIEW\n\n### 2.1.1 Justification\n\nJustification is defined as (Ahsan, 2025).\n\n' +
    '## 2.2 EMPIRICAL REVIEW\n\nA study of 106 participants used SAS 9.4 (Zhong & Chow, 2026).',
  ch3:
    '3.1 RESEARCH DESIGN\n\nA descriptive cross-sectional design will be adopted.\n\n' +
    '3.6 SAMPLE SIZE DETERMINATION\n\nThe Yamane formula will be applied.\n\n' +
    '3.9.1 Validity\n\nContent validity will be established by expert review.',
  references: [
    'Ahsan, Z. (2025). Integrating artificial intelligence into medical education. *BMC Medical Education*, *25*(1), 1187. https://doi.org/10.1186/s12909-025-07744-0',
    'Nocum, D. J., Robinson, J., & Halaki, M. (2026). Justification of imaging referrals. *Radiography*, *32*(2), 45-52. https://doi.org/10.1016/j.radi.2026.01.004',
    'Zhong, Y., & Chow, J. (2026). CT urography versus intravenous urography. *Urology Case Reports*, *58*, 103358. https://doi.org/10.1016/j.eucr.2026.103358',
  ],
};

const out = new Function('$input', SRC)({ first: () => ({ json: input }) })[0];
fs.writeFileSync(path.join(__dirname, 'out.docx'), Buffer.from(out.binary.data.data, 'base64'));
console.log(JSON.stringify(out.json, null, 2));
