# PPW · Thesis Chapters 1–3

Sub-workflow. Takes validated submission details, gathers real literature, writes Chapters 1–3 plus
an abstract, and returns them with a machine-built reference list.

**Trigger:** Execute Workflow (called by `PPW · Intake & Delivery`) · **Active:** no

Called by [`PPW · Intake & Delivery`](../ppw-intake-delivery/README.md). Not useful standalone.

---

## Why this workflow exists in this shape

It replaces the sub-workflow `Chapter 1 - 3`, whose design forced fabrication. The single worst
defect: `A4c Empirical Review Writer` was instructed to report **study design, duration, location,
sampling technique, sample size, instruments, data collection, analysis method, findings and
conclusions** for 10–15 studies — while its only input was a source list containing nothing but
author, year, title, journal and DOI. No abstract, methods or results text ever entered the
workflow. Every one of those thirteen fields *had* to be invented. No prompt wording can fix a node
that has been given no facts.

Three structural changes follow from that:

| Change | Effect |
|---|---|
| Evidence is **fetched deterministically**, including Methods and Results from open-access full text | The empirical review has real facts to report |
| Writers have **no search tools and no memory** — only the evidence pack | The model cannot reach outside supplied evidence |
| Citations are **opaque markers** resolved by a Code node; the reference list is **computed, never written** | An invented reference is unrepresentable, not merely discouraged |

---

## Flow

```
Start (typed inputs incl. format_rules)
  → A0 Query Planner ─────────── structured output: {queries[], year_floor}
  → Build Search Requests ────── one item per query (max 10)
  → Europe PMC Search ────────── resultType=core: abstract, DOI, PMID, PMCID, pubTypes, OA flag
  → Dedupe & Rank Candidates ─── dedupe, year filter, rank, cap 30, assign ref_id E01…E30
  → Fetch & Extract Full Text ── OA full text → verbatim Methods + Results
  → Build Evidence Pack ──────── brief_pack (all) + empirical_pack (primary studies only)
  → A3 Chapter 1 Writer
  → A4b Conceptual Review
  → A4c Empirical Review ─────── sees empirical_pack ONLY
  → A4d Chapter 2 Assembler
  → A5a Methodology Brief
  → A5 Chapter 3 Writer
  → Collect Chapters ─────────── keeps ch1/ch2/ch3 as separate named fields
  → A6 Consistency Checker ───── structured output: find/replace edits, not a rewrite
  → Apply Corrections ────────── applies them deterministically
  → Citation Gate ────────────── THE CONTROL. resolves markers, builds references
  → A8 Abstract
  → Return
```

Models (shared sub-nodes, so three model nodes serve nine agents):

| Node | Model | Used by |
|---|---|---|
| `Model · Strong` | `anthropic/claude-sonnet-5` | the six writers + consistency checker |
| `Model · Utility` | `deepseek/deepseek-v4-flash` | planner, methodology brief, abstract |
| `Model · Fixer` | `openai/gpt-5-mini` | `autoFix` repair on both output parsers |

Roughly **$0.50 per thesis** at current OpenRouter pricing.

---

## The Citation Gate

Writers may only cite by emitting `[E07]`. They are told — and it is true — that writing
`(Smith, 2020)` themselves will be rejected. [`citation-gate.js`](citation-gate.js) then:

1. extracts every marker and **fails any ID not in the evidence pack**;
2. flags any author-year string a writer wrote anyway (`FREETEXT_CITATION`);
3. drops uncited pack entries from the reference list;
4. **builds each APA-7 reference from the structured record** — authors, year, title, journal,
   volume, pages, DOI — so a malformed or invented reference cannot exist;
5. substitutes markers with computed `(Author, Year)`, handling 1/2/3+ authors, grouped citations
   and `2021a`/`2021b` disambiguation;
6. emits `citation_report` with every violation, surfaced to the sheet's `unverified_count`.

---

## Traps and decisions worth remembering

- **Cross-node references use `.first()`, never `.item`, and this is enforced.** The evidence
  pipeline fans one item out to 10 searches and 30 candidates, then collapses back to a single
  pack. None of the Code nodes emit `pairedItem`, so n8n cannot trace an item through that waist
  and `$('Start').item.json.project_title` fails with "Paired item data ... is unavailable" —
  blaming `Dedupe & Rank Candidates`, which is merely where the trail went cold. `A3 Chapter 1
  Writer` died on exactly this. Every node these expressions reach holds one item, so `.first()`
  says what is meant and cannot break. `build-workflow.js` refuses to write `workflow.json` if a
  `).item.json` reappears.

- **`Start` uses `inputSource: passthrough`, deliberately.** A declared input schema reads better
  but acts as a filter: anything the parent sends that is not on the list is dropped without a
  warning. The parent forwards `department`, `degree`, `month_year` and `student_email` beyond the
  twelve that would be declared. The parent's Execute Workflow node maps every field explicitly, so
  the contract is documented there.

- **The planner's object is nested under `output`.** An agent with a structured output parser
  publishes `$json.output.queries`, not `$json.queries`. Reading the top level returns `undefined`
  silently, so `Build Search Requests` threw "Query planner returned no usable search queries" on
  sub-execution 149 while the planner had in fact returned ten good ones. Both readers now accept
  either shape. The reason it went unnoticed: the test fixtures were hand-written at the top level,
  so they agreed with the bug. Fixtures are now copied from real execution payloads.

- **`sec-type` attributes are frequently absent** in Europe PMC full text (PMC12906102 has none).
  The extractor matches on `<title>` text first and treats `sec-type` as a fallback.
- **Case reports and reviews genuinely have no Methods section.** They contribute their abstract and
  are excluded from `empirical_pack`. Europe PMC types many reviews as `research-article`, so the
  title is the reliable signal — hence `REVIEW_TITLE` in `build-evidence-pack.js`.
- **`<xref>` elements are stripped** before text extraction: they render as bare `12`, which reads
  as a citation the workflow never issued. Stripping them leaves husks like `(Mackenzie & Knipe, )`,
  so `stripSourceCitations` removes the whole parenthetical. It is deliberately narrow —
  `(n = 32)`, `(95% CI 1.2-3.4)`, `(SD 1.2)` and `(Table 1)` all survive.
- **Records with no abstract are rejected outright.** Admitting a bare title+DOI is exactly what
  forced the old workflow to fabricate.
- **`A6` returns edits, not a rewrite.** Asking a model to re-emit three chapters is lossy — and in
  the old workflow its output was discarded anyway. `Apply Corrections` refuses any edit whose
  replacement would drop a citation marker.
- **No `ai_tool` or `ai_memory` connections anywhere.** `validate_workflow` suggests adding tools to
  all nine agents; that advice is wrong for this workflow and is deliberately not taken.
- **Chapters stay as separate named fields** from `Collect Chapters` to the DOCX. The old workflow
  concatenated them and re-found the boundaries by regex, which is why Chapter One vanished.

---

## Files

| File | Role |
|---|---|
| `workflow.json` | the export (no `credentials` blocks) |
| `build-workflow.js` | regenerates `workflow.json`, inlining the Code sources below |
| `build-search-requests.js` | planner output → one item per query |
| `rank-candidates.js` | Europe PMC → canonical records, dedupe, rank, `ref_id` |
| `fetch-fulltext.js` | OA full text → verbatim Methods + Results |
| `build-evidence-pack.js` | brief pack + empirical pack + stats |
| `collect-chapters.js` | gathers the three chapters, fails loudly if one is missing |
| `apply-corrections.js` | applies `A6`'s edits deterministically |
| `citation-gate.js` | **the anti-hallucination control** |
| `docx-generator.js` | used by the intake workflow, kept here with its tests |

Edit the `.js` files, then run `node build-workflow.js` — never edit `workflow.json` by hand.

---

## Verification status

Run `node test/test-*.js` and `python test/validate_docx.py`.

| Suite | Checks | Status |
|---|---|---|
| `test-citation-gate.js` | 35 | pass — incl. invented marker rejected, free-text citation caught |
| `test-fetch-fulltext.js` | 33 | pass — against 4 real Europe PMC articles |
| `test-rank-candidates.js` | 25 | pass — against 75 real records |
| `test-build-search-requests.js` | 16 | pass — regression for sub-execution 149 |
| `test-evidence-pipeline.js` | 15 | pass — 3 stages chained, live API |
| `validate_docx.py` | 67 | pass — independent zip/XML validation |
| `validate_workflow` (MCP) | — | valid: 0 errors, 0 warnings, 31 connections |

### Live run on the instance, 2026-08-19

Evidence pipeline executed inside n8n (free — no LLM), confirming the Code-node runtime handles
top-level `await`, `this.helpers.httpRequest` and `$('Node')` references:

| Node | Result |
|---|---|
| Europe PMC Search | 3 queries, 33 s |
| Dedupe & Rank Candidates | 30 candidates |
| Fetch & Extract Full Text | 30 records, 15 s, 0 failures |
| Build Evidence Pack | 28 with full text, 15 empirical studies |

Papers with no Methods section returned **empty** `methods_text` with `fetched_no_sections` — no
fabrication where the source had nothing. The review-title filter excluded three review articles
from the empirical set, live.

### Chapter One written by the real model (metered, ~$0.06)

The decisive test of the marker protocol:

| Measure | Result |
|---|---|
| Markers written by the model | 23 |
| Unique markers | 10 |
| **Markers not in the evidence pack** | **0** |
| Free-text author-year citations | **0** |
| `citation_report.passed` | **true** |
| References built | 10 — matching the 10 cited; 20 uncited pack entries dropped |

Three generated DOIs were spot-checked against Crossref: all resolved, with titles matching the
generated reference strings exactly.

**Still unverified:** Chapters 2 and 3, the consistency checker and the abstract have not been run
against a live model — only Chapter One has. The `.docx` has never been produced from real
generated chapters (only from synthetic fixtures, which the 67 `validate_docx.py` checks cover).
