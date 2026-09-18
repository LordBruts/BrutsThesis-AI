// n8n Code node: "Apply Corrections"
// MODE: Run Once for All Items   LANGUAGE: JavaScript
//
// Applies the consistency checker's edits deterministically.
//
// The original A6 was told to "output the COMPLETE corrected thesis". Asking a
// model to re-emit three full chapters is both expensive and lossy -- long
// outputs get truncated, and whole sections vanish inside what is nominally a
// correction step. Worse, its output was then discarded entirely: the final
// assembler read the ORIGINAL chapters, so the QA pass changed nothing.
//
// Here A6 returns a small structured list of find/replace edits, and this node
// applies them. Output stays small and reliable, every edit is auditable, and
// nothing can be silently dropped.

const chapters = $('Collect Chapters').first().json;
const review = $input.first().json || {};
const issues = Array.isArray(review.issues) ? review.issues : [];

const out = { ch1: chapters.ch1 || '', ch2: chapters.ch2 || '', ch3: chapters.ch3 || '' };
const applied = [];
const skipped = [];

for (const issue of issues) {
  const key = String(issue.chapter || '').toLowerCase();
  if (!['ch1', 'ch2', 'ch3'].includes(key)) { skipped.push({ issue, why: 'unknown chapter' }); continue; }
  if (String(issue.verdict || '').toUpperCase() !== 'FAIL') continue;   // PASS items need no edit

  const find = String(issue.find || '');
  const replace = String(issue.replace || '');
  if (!find) { skipped.push({ issue, why: 'no find text' }); continue; }
  if (!out[key].includes(find)) { skipped.push({ issue, why: 'find text not present' }); continue; }

  // A correction must never delete a citation marker. If the replacement drops
  // one, keep the original text and report it rather than losing the evidence.
  const lost = (find.match(/\[E\d+\]/g) || []).filter((m) => !replace.includes(m));
  if (lost.length) { skipped.push({ issue, why: 'replacement would drop markers ' + lost.join(',') }); continue; }

  out[key] = out[key].split(find).join(replace);
  applied.push({ chapter: key, category: issue.category || 'unspecified', reason: issue.explanation || '' });
}

return [
  {
    json: {
      ch1: out.ch1,
      ch2: out.ch2,
      ch3: out.ch3,
      consistency_report: {
        checked: issues.length,
        failed: issues.filter((i) => String(i.verdict || '').toUpperCase() === 'FAIL').length,
        applied: applied.length,
        skipped: skipped.length,
        applied_detail: applied,
        skipped_detail: skipped,
      },
    },
  },
];
