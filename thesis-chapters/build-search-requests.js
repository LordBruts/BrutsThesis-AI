// n8n Code node: "Build Search Requests"
// MODE: Run Once for All Items   LANGUAGE: JavaScript
//
// Fans the query planner's output into one item per Europe PMC search, so the
// HTTP Request node that follows runs once per query.
//
// Search is deliberately NOT an agent tool here. In the original workflow the
// writers held the search tools themselves, which meant the model decided what
// evidence existed, how much to look for, and when to stop -- and could simply
// not call them. Making the search a plain, always-executed HTTP step removes
// that discretion entirely.

// An Agent carrying a structured output parser nests its parsed object under
// `output`: $json.output.queries, NOT $json.queries. Reading the top level
// yields [] silently and trips the guard below -- which is how a planner that
// returned ten perfectly good queries was reported as returning none
// (sub-execution 149). The top-level fallback keeps pinned fixtures and any
// parser-less variant working.
const planned = $input.first().json || {};
const parsed =
  planned.output && typeof planned.output === 'object' ? planned.output : planned;
const queries = Array.isArray(parsed.queries) ? parsed.queries : [];

const clean = [];
const seen = {};
for (const q of queries) {
  const t = String(q || '').replace(/\s+/g, ' ').trim();
  if (t.length < 3) continue;
  const k = t.toLowerCase();
  if (seen[k]) continue;
  seen[k] = true;
  clean.push(t);
}

if (!clean.length) {
  throw new Error(
    'Query planner returned no usable search queries. Refusing to continue: ' +
      'writing chapters without an evidence pack is exactly the failure mode this workflow exists to prevent.'
  );
}

// Cap the fan-out so a runaway planner cannot spray the API.
return clean.slice(0, 10).map((query) => ({ json: { query } }));
