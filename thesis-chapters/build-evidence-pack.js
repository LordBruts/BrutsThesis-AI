// n8n Code node: "Build Evidence Pack"
// MODE: Run Once for All Items   LANGUAGE: JavaScript
//
// Final assembly of the evidence the writers are allowed to use, and the ONLY
// thing they are given. No writer has a search tool; no writer has memory. If a
// fact is not in this pack, there is nowhere for it to come from except the
// model's imagination -- which is what the Citation Gate then catches.
//
// Produces three things:
//   evidence        - the structured array (consumed by the Citation Gate)
//   brief_pack      - abstract-level rendering for Chapter 1 / conceptual review
//   empirical_pack  - methods+results rendering for the empirical review, and
//                     ONLY for records that actually have them
//
// The empirical split is the fix for the original workflow's worst defect: it
// asked for study design, sample size, instruments and findings for 10-15
// studies while supplying nothing but titles and DOIs. Here a study can only
// reach the empirical writer if the paper genuinely reported those things.

const MAX_ABSTRACT = 1600;
const MAX_METHODS = 2500;
const MAX_RESULTS = 2500;
const MAX_EMPIRICAL_STUDIES = 15;

const records = $input.all().map((i) => i.json);

function clip(s, n) {
  const t = (s || '').trim();
  if (t.length <= n) return t;
  return t.slice(0, n).replace(/\s\S*$/, '') + ' […]';
}

function authorLine(rec) {
  const names = (rec.authors || [])
    .map((a) => {
      const sn = a.lastName || a.fullName || '';
      const ini = (a.initials || '').replace(/[.\s]/g, '');
      return sn ? (ini ? `${sn} ${ini}` : sn) : '';
    })
    .filter(Boolean);
  if (!names.length) return 'Unknown author';
  if (names.length <= 6) return names.join(', ');
  return names.slice(0, 6).join(', ') + ', et al.';
}

function header(rec) {
  const bits = [`[${rec.ref_id}] ${authorLine(rec)} (${rec.year || 'n.d.'}). ${rec.title}.`];
  if (rec.journal) bits.push(`Journal: ${rec.journal}${rec.volume ? ', ' + rec.volume : ''}.`);
  if (rec.doi) bits.push(`DOI: ${rec.doi}.`);
  else if (rec.pmid) bits.push(`PMID: ${rec.pmid}.`);
  return bits.join(' ');
}

// ------------------------------------------------------------- brief pack ----
const brief = records
  .map((rec) => `${header(rec)}\nABSTRACT: ${clip(rec.abstract, MAX_ABSTRACT)}`)
  .join('\n\n---\n\n');

// --------------------------------------------------------- empirical pack ----
// Admission test: a primary study that actually reported methods or results.
const NON_EMPIRICAL = ['review', 'systematic review', 'meta-analysis', 'case reports', 'editorial', 'comment'];

// Europe PMC types many reviews as 'research-article', so pub_types alone lets
// secondary literature into the empirical review. The title is the reliable
// signal. A review has no primary sample of its own to report.
const REVIEW_TITLE = /\b(?:systematic|narrative|scoping|integrative|umbrella|literature|rapid)\s+review\b|\bmeta[- ]analys/i;

const empiricalRecs = records
  .filter((rec) => {
    const hasEvidence = (rec.methods_text || '').length > 200 || (rec.results_text || '').length > 200;
    const isPrimary =
      rec.pub_types.includes('research-article') ||
      !rec.pub_types.some((t) => NON_EMPIRICAL.includes(t));
    const isReview = REVIEW_TITLE.test(rec.title || '');
    return hasEvidence && isPrimary && !isReview;
  })
  .sort((a, b) => (b.year || 0) - (a.year || 0)) // chronological descending, as the chapter requires
  .slice(0, MAX_EMPIRICAL_STUDIES);

const empirical = empiricalRecs
  .map((rec) => {
    const parts = [header(rec)];
    if (rec.abstract) parts.push(`ABSTRACT: ${clip(rec.abstract, MAX_ABSTRACT)}`);
    if (rec.methods_text) parts.push(`METHODS (verbatim from the paper):\n${clip(rec.methods_text, MAX_METHODS)}`);
    if (rec.results_text) parts.push(`RESULTS (verbatim from the paper):\n${clip(rec.results_text, MAX_RESULTS)}`);
    return parts.join('\n');
  })
  .join('\n\n---\n\n');

// -------------------------------------------------------------- statistics ----
const stats = {
  candidates: records.length,
  with_fulltext: records.filter((r) => (r.methods_text || r.results_text || '').length > 0).length,
  empirical_studies: empiricalRecs.length,
  open_access: records.filter((r) => r.oa).length,
  year_range: records.length
    ? `${Math.min(...records.map((r) => r.year || 9999))}-${Math.max(...records.map((r) => r.year || 0))}`
    : 'n/a',
  fulltext_failures: records.filter((r) => String(r.fulltext_status || '').startsWith('error:')).length,
};

return [
  {
    json: {
      evidence: records,
      brief_pack: brief,
      empirical_pack: empirical,
      empirical_ref_ids: empiricalRecs.map((r) => r.ref_id),
      stats,
    },
  },
];
