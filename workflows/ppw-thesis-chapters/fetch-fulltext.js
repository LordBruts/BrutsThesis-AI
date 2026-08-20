// n8n Code node: "Fetch & Extract Full Text"
// MODE: Run Once for All Items   LANGUAGE: JavaScript
//
// Pulls Europe PMC open-access full text for every candidate that has one, and
// extracts the Methods and Results sections verbatim.
//
// This node is why the empirical review no longer has to invent study details.
// Previously the writers were asked for design / sample size / instruments /
// analysis / findings while being given nothing but titles and DOIs. Here those
// facts are fetched from the actual paper, and anything the paper does not
// report is simply left absent — never filled in.
//
// A Code node (rather than an HTTP Request node) is deliberate: this is N
// parallel fetches plus XML sectioning plus a merge back onto the candidate
// records. Doing it natively would need a split, an IF, a per-item HTTP node
// and an index-fragile re-join. One node with explicit per-record error
// handling is both simpler and safer.
//
// Input  : $input.all() -> candidate records from "Dedupe & Rank Candidates"
// Output : the same records, each gaining methods_text / results_text /
//          fulltext_status.

const EPMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest';
const CONCURRENCY = 4; // be polite to EBI
const MAX_SECTION_CHARS = 4000;

// ------------------------------------------------------------ XML helpers ----

// Elements whose text must never reach a writer:
//  - xref  : renders as bare "12", which looks like a citation we did not issue
//  - table-wrap / fig / formulae / supplementary : layout noise, not prose
const DROP_ELEMENTS = [
  'xref',
  'table-wrap',
  'fig',
  'disp-formula',
  'inline-formula',
  'supplementary-material',
  'graphic',
  'media',
  'label',
];

function dropElements(xml) {
  let out = xml;
  for (const el of DROP_ELEMENTS) {
    // paired form
    out = out.replace(new RegExp(`<${el}\\b[^>]*>[\\s\\S]*?</${el}>`, 'gi'), ' ');
    // self-closing / empty form
    out = out.replace(new RegExp(`<${el}\\b[^>]*/?>`, 'gi'), ' ');
  }
  return out;
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x2019;/g, '’')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

// The source paper's own in-text citations must not survive into our evidence
// text. They point at works that are NOT in our evidence pack, so a writer who
// copies one would produce a citation the gate cannot resolve. Stripping <xref>
// also leaves husks like "(Mackenzie & Knipe, )" with the year removed, which is
// worse than useless. Remove the whole parenthetical.
//
// Written as a regex literal + .source so there is no double-escaping to get
// wrong. Deliberately narrow: it requires Capitalised-surname + comma, so real
// data in parentheses -- (n = 32), (95% CI 1.2-3.4), (SD 1.2), (Table 1) -- is
// left untouched.
const CITE_ITEM =
  /[A-Z][A-Za-z'\u2019\-]+(?:\s+(?:et\s+al\.?|(?:&|and)\s+[A-Z][A-Za-z'\u2019\-]+))*\s*,\s*(?:(?:19|20)\d{2}[a-z]?)?/
    .source;
const CITE_PAREN = new RegExp(
  String.raw`\(\s*` + CITE_ITEM + String.raw`(?:\s*;\s*` + CITE_ITEM + String.raw`)*\s*\)`,
  'g'
);

function stripSourceCitations(str) {
  return str
    .replace(CITE_PAREN, ' ')
    .replace(/\(\s*[,;]\s*\)/g, ' ')  // husks left behind
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/[ \t\u00a0]{2,}/g, ' ');
}

// Tags out, paragraph structure preserved.
function toText(xml) {
  let s = dropElements(xml);
  s = s.replace(/<\/(p|title|sec|abstract)>/gi, '\n\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  s = stripSourceCitations(s);
  return s
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Depth-aware scan for top-level <sec> blocks inside a container.
// Nested subsections (e.g. Methods > Study design > Sampling) stay INSIDE their
// parent, which is what we want — the whole methods section, not its first line.
function topLevelSections(xml) {
  const secs = [];
  const re = /<sec\b[^>]*?\/>|<sec\b[^>]*>|<\/sec\s*>/gi;
  let m;
  let depth = 0;
  let start = -1;
  while ((m = re.exec(xml)) !== null) {
    const tag = m[0];
    if (/^<sec\b[^>]*\/>$/i.test(tag)) continue; // self-closing, no content
    if (tag[1] === '/') {
      depth--;
      if (depth === 0 && start >= 0) {
        secs.push(xml.slice(start, m.index + tag.length));
        start = -1;
      }
      if (depth < 0) depth = 0;
    } else {
      if (depth === 0) start = m.index;
      depth++;
    }
  }
  return secs;
}

function sectionTitle(secXml) {
  const m = secXml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? toText(m[1]).replace(/\s+/g, ' ').trim() : '';
}

function sectionType(secXml) {
  const m = secXml.match(/^<sec\b[^>]*\bsec-type\s*=\s*"([^"]*)"/i);
  return m ? m[1].toLowerCase() : '';
}

const METHODS_RE =
  /^(materials?\s*(and|&)\s*methods?|methods?(\s*(and|&)\s*materials?)?|methodology|research\s+methods?(\s+and\s+design)?|patients?\s*(and|&)\s*methods?|subjects?\s*(and|&)\s*methods?|study\s+design(\s+and\s+methods?)?|experimental(\s+(section|methods?|procedures?))?|design\s+and\s+methods?)\b/i;

const RESULTS_RE = /^(results?|findings?|results?\s*(and|&)\s*discussion)\b/i;

function matchSections(sections, re, typeKeys) {
  const hits = [];
  for (const sec of sections) {
    const title = sectionTitle(sec);
    const stype = sectionType(sec);
    if ((title && re.test(title)) || (stype && typeKeys.includes(stype))) {
      hits.push(sec);
    }
  }
  return hits;
}

// Pull Methods / Results from the article body; fall back to a structured
// abstract when the body is unavailable or unsectioned.
function extractSections(xml) {
  const bodyMatch = xml.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const absMatch = xml.match(/<abstract\b[^>]*>([\s\S]*?)<\/abstract>/i);

  const result = { methods_text: '', results_text: '', source: 'none' };

  const harvest = (container, label) => {
    const secs = topLevelSections(container);
    if (!secs.length) return false;
    const m = matchSections(secs, METHODS_RE, ['methods', 'materials|methods']);
    const r = matchSections(secs, RESULTS_RE, ['results']);
    if (!m.length && !r.length) return false;
    if (m.length) result.methods_text = m.map(toText).join('\n\n');
    if (r.length) result.results_text = r.map(toText).join('\n\n');
    result.source = label;
    return true;
  };

  if (bodyMatch && harvest(bodyMatch[1], 'body')) {
    // body won
  } else if (absMatch) {
    harvest(absMatch[1], 'structured-abstract');
  }

  for (const k of ['methods_text', 'results_text']) {
    if (result[k].length > MAX_SECTION_CHARS) {
      result[k] = result[k].slice(0, MAX_SECTION_CHARS).replace(/\s\S*$/, '') + ' […]';
    }
  }
  return result;
}

// ------------------------------------------------------------------ main ----
const records = $input.all().map((i) => i.json);

async function fetchOne(rec) {
  if (!rec.pmcid || rec.oa !== true) {
    return Object.assign({}, rec, {
      methods_text: '',
      results_text: '',
      fulltext_status: 'not_open_access',
    });
  }
  try {
    const xml = await this.helpers.httpRequest({
      method: 'GET',
      url: `${EPMC}/${rec.pmcid}/fullTextXML`,
      json: false,
      timeout: 30000,
      headers: { Accept: 'application/xml' },
    });
    const sections = extractSections(String(xml || ''));
    return Object.assign({}, rec, {
      methods_text: sections.methods_text,
      results_text: sections.results_text,
      fulltext_status:
        sections.methods_text || sections.results_text
          ? `ok:${sections.source}`
          : 'fetched_no_sections',
    });
  } catch (err) {
    // A failed fetch must never fabricate content — it just yields less evidence.
    return Object.assign({}, rec, {
      methods_text: '',
      results_text: '',
      fulltext_status: `error:${(err && err.message ? err.message : String(err)).slice(0, 120)}`,
    });
  }
}

const boundFetch = fetchOne.bind(this);
const out = [];
for (let i = 0; i < records.length; i += CONCURRENCY) {
  const batch = records.slice(i, i + CONCURRENCY);
  const settled = await Promise.all(batch.map(boundFetch));
  out.push(...settled);
}

return out.map((json) => ({ json }));
