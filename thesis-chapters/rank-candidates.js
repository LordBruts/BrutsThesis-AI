// n8n Code node: "Dedupe & Rank Candidates"
// MODE: Run Once for All Items   LANGUAGE: JavaScript
//
// Turns the raw Europe PMC search responses into the canonical evidence-record
// shape, deduplicates them, ranks them, caps the set, and assigns the stable
// ref_id (E01, E02, ...) that every writer must cite by.
//
// The ref_id is the load-bearing idea of this workflow: writers never see or
// write an author-year string, so they cannot invent one. They emit [E07], and
// the Citation Gate is the only thing that can turn that into a citation.
//
// A record with no abstract is dropped outright. An abstract is the minimum
// evidence needed to say anything about a study, and admitting a bare
// title+DOI is precisely what forced the old workflow to fabricate.
//
// Input  : $input.all() -> one item per search query, each a Europe PMC response
//          $('A0 Query Planner').first().json.output.year_floor
// Output : one item per surviving candidate.

const MAX_CANDIDATES = 30;
const DEFAULT_YEAR_FLOOR = new Date().getFullYear() - 10;

let yearFloor = DEFAULT_YEAR_FLOOR;
try {
  // Same nesting as Build Search Requests: the agent's parsed object lives
  // under `output`. Falling through to the top level keeps test fixtures and
  // pinned data working.
  const pj = $('A0 Query Planner').first().json || {};
  const src = pj.output && typeof pj.output === 'object' ? pj.output : pj;
  const planned = Number(src.year_floor);
  if (planned && planned > 1900 && planned <= new Date().getFullYear()) yearFloor = planned;
} catch (e) {
  // planner unavailable in isolated tests; default stands
}

// ------------------------------------------------------------- normalise ----
function norm(raw) {
  const ji = raw.journalInfo || {};
  const journal = ji.journal || {};
  const authors = ((raw.authorList || {}).author || []).map((a) => ({
    lastName: a.lastName || null,
    firstName: a.firstName || null,
    initials: a.initials || null,
    fullName: a.fullName || a.collectiveName || null,
  }));

  const year = parseInt(raw.pubYear || ji.yearOfPublication, 10) || null;

  return {
    ref_id: null, // assigned after ranking
    source_id: raw.id || null,
    pmid: raw.pmid || null,
    pmcid: raw.pmcid || null,
    doi: raw.doi || null,
    title: (raw.title || '').replace(/\s+/g, ' ').replace(/\.$/, '').trim(),
    authors,
    year,
    journal: journal.title || journal.medlineAbbreviation || null,
    volume: ji.volume || null,
    issue: ji.issue || null,
    pages: raw.pageInfo || null,
    abstract: (raw.abstractText || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    pub_types: ((raw.pubTypeList || {}).pubType || []).map((t) => String(t).toLowerCase()),
    cited_by: parseInt(raw.citedByCount, 10) || 0,
    oa: raw.isOpenAccess === 'Y' && !!raw.pmcid,
  };
}

// --------------------------------------------------------------- gather ----
const raw = [];
for (const item of $input.all()) {
  const body = item.json || {};
  const list = ((body.resultList || {}).result) || [];
  for (const r of list) raw.push(r);
}

// ------------------------------------------------ filter, dedupe, rank ----
const EXCLUDE_TYPES = ['retracted publication', 'retraction of publication', 'comment', 'editorial'];

function keyOf(rec) {
  if (rec.doi) return 'doi:' + String(rec.doi).toLowerCase();
  if (rec.pmid) return 'pmid:' + rec.pmid;
  return 'ttl:' + rec.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
}

const seen = new Map();
for (const r of raw) {
  const rec = norm(r);
  if (!rec.title || !rec.abstract) continue;          // no abstract -> no evidence
  if (!rec.year || rec.year < yearFloor) continue;
  if (rec.pub_types.some((t) => EXCLUDE_TYPES.includes(t))) continue;

  const k = keyOf(rec);
  const prev = seen.get(k);
  // On a duplicate keep the richer record (OA beats non-OA, longer abstract wins).
  if (!prev || (rec.oa && !prev.oa) || rec.abstract.length > prev.abstract.length) {
    seen.set(k, rec);
  }
}

const thisYear = new Date().getFullYear();
function score(rec) {
  let s = 0;
  if (rec.pub_types.includes('research-article')) s += 5;
  if (rec.oa) s += 4;                                  // OA == methods & results are retrievable
  s += Math.max(0, 6 - (thisYear - rec.year)) * 0.8;   // recency
  s += Math.min(4, Math.log10(rec.cited_by + 1) * 2);  // influence, damped
  if (rec.abstract.length > 900) s += 1;
  return s;
}

const ranked = Array.from(seen.values())
  .map((rec) => ({ rec, s: score(rec) }))
  .sort((a, b) => b.s - a.s || (b.rec.year || 0) - (a.rec.year || 0))
  .slice(0, MAX_CANDIDATES)
  .map((x, i) => {
    x.rec.ref_id = 'E' + String(i + 1).padStart(2, '0');
    x.rec.rank_score = Math.round(x.s * 100) / 100;
    return x.rec;
  });

return ranked.map((json) => ({ json }));
