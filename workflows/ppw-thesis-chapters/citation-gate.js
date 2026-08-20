// n8n Code node: "Citation Gate"
// MODE: Run Once for All Items   LANGUAGE: JavaScript
//
// The deterministic anti-hallucination control for this workflow.
//
// Writers are only ever allowed to emit opaque [Exx] markers. This node is the
// single place where a marker becomes a real citation, and the single place
// where the reference list is built. Because the reference strings are computed
// from the structured Europe PMC records rather than written by a model, an
// invented reference is not "discouraged" — it is unrepresentable.
//
// Input  : $input.first().json = { ch1, ch2, ch3 }         (markers still in place)
//          $('Build Evidence Pack').first().json.evidence  (structured records)
// Output : chapters with markers replaced by (Author, Year), a computed APA-7
//          reference list, and a citation_report naming every violation.

// ---------------------------------------------------------------- input ----
const src = $input.first().json;
const pack = $('Build Evidence Pack').first().json.evidence || [];

const chapters = { ch1: src.ch1 || '', ch2: src.ch2 || '', ch3: src.ch3 || '' };

// ------------------------------------------------------------ utilities ----

// "GWK" / "G.W.K." -> "G. W. K."   Europe PMC is inconsistent about the dots.
function formatInitials(initials, firstName) {
  let raw = (initials || '').replace(/[.\s]/g, '');
  if (!raw && firstName) {
    raw = firstName
      .split(/[\s-]+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join('');
  }
  if (!raw) return '';
  return raw
    .toUpperCase()
    .split('')
    .map((c) => c + '.')
    .join(' ');
}

function authorSurname(a) {
  if (a.lastName) return a.lastName;
  // Collective/consortium authors have only fullName.
  return (a.fullName || a.collectiveName || '').trim();
}

// APA 7 reference-list author string.
function formatAuthorsForReference(authors) {
  const list = (authors || []).filter((a) => authorSurname(a));
  if (!list.length) return '';

  const fmt = (a) => {
    const surname = authorSurname(a);
    const inits = formatInitials(a.initials, a.firstName);
    return inits ? `${surname}, ${inits}` : surname;
  };

  // APA 7: up to 20 listed; 21+ -> first 19, ellipsis, final author.
  if (list.length > 20) {
    const head = list.slice(0, 19).map(fmt).join(', ');
    return `${head}, . . . ${fmt(list[list.length - 1])}`;
  }
  if (list.length === 1) return fmt(list[0]);
  const head = list.slice(0, -1).map(fmt).join(', ');
  return `${head}, & ${fmt(list[list.length - 1])}`;
}

// APA 7 in-text: 1 -> Smith; 2 -> Smith & Jones; 3+ -> Smith et al.
// (APA 7 uses "et al." from the very first citation, so no first/subsequent split.)
function formatAuthorsInText(authors) {
  const names = (authors || []).map(authorSurname).filter(Boolean);
  if (!names.length) return 'Anonymous';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names[0]} et al.`;
}

// Sentence case for article titles, preserving anything that looks like an
// acronym (CT, IVU, WHO) or is already hyphen-joined caps.
function sentenceCase(title) {
  const t = (title || '').trim().replace(/\s+/g, ' ');
  if (!t) return '';
  const words = t.split(' ');
  const out = words.map((w, i) => {
    const bare = w.replace(/[^A-Za-z]/g, '');
    if (bare.length > 1 && bare === bare.toUpperCase()) return w; // acronym
    if (i === 0) return w.charAt(0).toUpperCase() + w.slice(1);
    return w;
  });
  let s = out.join(' ');
  if (!/[.?!]$/.test(s)) s += '.';
  return s;
}

// Asterisks are italics markers consumed by the DOCX generator's makeRuns().
function formatReference(rec, yearLabel) {
  const parts = [];
  const authors = formatAuthorsForReference(rec.authors);
  parts.push(authors ? `${authors} (${yearLabel}).` : `(${yearLabel}).`);
  parts.push(sentenceCase(rec.title));

  if (rec.journal) {
    let loc = `*${rec.journal}*`;
    if (rec.volume) {
      loc += `, *${rec.volume}*`;
      if (rec.issue) loc += `(${rec.issue})`;
    }
    if (rec.pages) loc += `, ${rec.pages}`;
    parts.push(loc + '.');
  }

  if (rec.doi) parts.push(`https://doi.org/${String(rec.doi).replace(/^https?:\/\/doi\.org\//i, '')}`);
  else if (rec.pmid) parts.push(`https://pubmed.ncbi.nlm.nih.gov/${rec.pmid}/`);

  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

// --------------------------------------------------------- build indexes ----
const byId = {};
for (const rec of pack) {
  if (rec && rec.ref_id) byId[rec.ref_id] = rec;
}

// ------------------------------------------------- find & group markers ----
// Accepts [E07], [E07, E12], [E07; E12] and adjacent [E07][E12].
// A run of adjacent/comma-joined markers becomes ONE parenthetical, as APA requires.
const RUN = /(?:\[\s*E\d+(?:\s*[,;]\s*E\d+)*\s*\]\s*)+/g;
const ONE = /E\d+/g;

const cited = new Set();
const violations = [];

function scan(text, chapterName) {
  let m;
  RUN.lastIndex = 0;
  while ((m = RUN.exec(text)) !== null) {
    const ids = m[0].match(ONE) || [];
    for (const id of ids) {
      if (byId[id]) {
        cited.add(id);
      } else {
        violations.push({
          type: 'UNKNOWN_REF_ID',
          chapter: chapterName,
          ref_id: id,
          detail: `Marker [${id}] does not exist in the evidence pack.`,
        });
      }
    }
  }
}

for (const key of ['ch1', 'ch2', 'ch3']) scan(chapters[key], key);

// A free-text citation is a writer bypassing the marker protocol. Flag it —
// these are exactly the strings that used to be invented.
const FREETEXT = /\(([A-Z][A-Za-z'’\-]+(?:\s+(?:et al\.|&\s*[A-Z][A-Za-z'’\-]+))?),\s*(19|20)\d{2}[a-z]?\)/g;
for (const key of ['ch1', 'ch2', 'ch3']) {
  let m;
  FREETEXT.lastIndex = 0;
  while ((m = FREETEXT.exec(chapters[key])) !== null) {
    violations.push({
      type: 'FREETEXT_CITATION',
      chapter: key,
      detail: `Un-sourced author-year citation written directly by the model: "${m[0]}".`,
    });
  }
}

// ------------------------------------------- disambiguate author-year keys ----
// Two different papers by the same first author in the same year must become
// 2020a / 2020b, both in text and in the reference list.
const citedRecs = Array.from(cited).map((id) => byId[id]);

const groups = {};
for (const rec of citedRecs) {
  const key = `${formatAuthorsInText(rec.authors)}|${rec.year}`;
  (groups[key] = groups[key] || []).push(rec);
}

const yearLabel = {}; // ref_id -> "2020" | "2020a"
for (const key of Object.keys(groups)) {
  const recs = groups[key].sort((a, b) =>
    String(a.title || '').localeCompare(String(b.title || ''))
  );
  if (recs.length === 1) {
    yearLabel[recs[0].ref_id] = String(recs[0].year || 'n.d.');
  } else {
    recs.forEach((rec, i) => {
      yearLabel[rec.ref_id] = `${rec.year || 'n.d.'}${String.fromCharCode(97 + i)}`;
    });
  }
}

// ------------------------------------------------------ substitute markers ----
function substitute(text) {
  return text.replace(RUN, (run) => {
    const ids = (run.match(ONE) || []).filter((id) => byId[id]);
    if (!ids.length) return ''; // unknown markers already logged; strip them
    const parts = ids.map(
      (id) => `${formatAuthorsInText(byId[id].authors)}, ${yearLabel[id]}`
    );
    // Deduplicate a run that names the same source twice.
    const seen = [];
    for (const p of parts) if (!seen.includes(p)) seen.push(p);
    return `(${seen.join('; ')})`;
  });
}

const out = {};
for (const key of ['ch1', 'ch2', 'ch3']) {
  out[key] = substitute(chapters[key])
    .replace(/\s+([.,;:])/g, '$1') // marker removal can strand punctuation
    .replace(/[ \t]{2,}/g, ' ');
}

// ------------------------------------------------------- reference list ----
// Only cited records survive. Sorted by first-author surname, then year.
const references = citedRecs
  .slice()
  .sort((a, b) => {
    const an = (authorSurname((a.authors || [])[0] || {}) || '').toLowerCase();
    const bn = (authorSurname((b.authors || [])[0] || {}) || '').toLowerCase();
    if (an !== bn) return an.localeCompare(bn);
    return String(yearLabel[a.ref_id]).localeCompare(String(yearLabel[b.ref_id]));
  })
  .map((rec) => formatReference(rec, yearLabel[rec.ref_id]));

const uncited = pack
  .filter((rec) => rec && rec.ref_id && !cited.has(rec.ref_id))
  .map((rec) => rec.ref_id);

// --------------------------------------------------------------- report ----
const report = {
  total_markers: (function () {
    let n = 0;
    for (const key of ['ch1', 'ch2', 'ch3']) {
      const runs = chapters[key].match(RUN) || [];
      for (const r of runs) n += (r.match(ONE) || []).length;
    }
    return n;
  })(),
  unique_refs_cited: cited.size,
  refs_in_pack: pack.length,
  uncited_refs: uncited,
  violations: violations,
  passed: violations.length === 0,
};

return [
  {
    json: {
      ch1: out.ch1,
      ch2: out.ch2,
      ch3: out.ch3,
      references: references,
      citation_report: report,
    },
  },
];
