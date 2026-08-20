# Changelog

## v2.0.0 — rebuilt around verifiable citations

v1.0 never completed a run. This release replaces it rather than patching it, because the reason it
produced fabricated study details was architectural rather than a bug. See
[legacy/v1/README.md](legacy/v1/README.md) for the full post-mortem.

### Added

- **Deterministic evidence pipeline.** Europe PMC is queried over plain HTTP, candidates are ranked
  and capped, and open-access full text is fetched so Methods and Results arrive verbatim. Search is
  no longer an agent tool, so the model cannot decide not to look.
- **The Citation Gate.** A Code node — not a model — resolves `[Exx]` markers into APA-7 references
  computed from the structured records, rejects unknown markers, flags any author-year string a
  model wrote by hand, drops uncited entries and emits a machine-readable `citation_report`.
- **Guideline-driven formatting.** An uploaded departmental project guideline is parsed into
  formatting rules that drive the document; defaults apply when none is supplied.
- **Both a webhook and a Google Sheets trigger**, served by one label-based normaliser. The Sheets
  route polls outbound, so it works from `localhost` without a tunnel.
- **Error branches on every fallible node**, converging on a single failure path.
- **200 offline checks** across five suites, loading the exact source n8n executes, with fixtures
  copied from real Europe PMC responses and real execution payloads.
- `config.local.json` / `config.example.json` so instance-specific ids never enter the repository.

### Fixed

- Every submission previously routed to "Missing Fields": the second node read each value and wrote
  it to a field *named* after the label, destroying the payload.
- The departmental guideline was downloaded, parsed, analysed — then discarded by a `Merge` node
  whose output nothing read.
- That same `Merge`, in `append` mode, sent two items into the sub-workflow call and ran the whole
  agent chain twice.
- The consistency checker's corrections were thrown away by an assembler reading the wrong nodes.
- Chapter One was silently omitted from the document, because the generator searched for headings no
  prompt emitted.
- A hardcoded fallback cover page stamped one specific student's title onto any thesis whose section
  parse missed.
- Every thesis was emailed to a single hardcoded address; the form collected no email at all.
- The form client was held open for the entire multi-minute run and timed out on every submission.
- The webhook was unauthenticated on a path that triggers a chain of paid model calls.
- Field access was positional, so reordering a form question silently shifted every column.

### Changed

- Required-field validation moved from an LLM to code. The previous check tested whether the model's
  prose contained the word "VALIDATED", which passes whenever it writes that word while listing what
  is missing.
- Writers run with no search tools and no memory. The shared `Simple Memory` between two agents, and
  the instruction to begin "by checking if there are sources in memory", are both gone.
- Agent nodes pinned to a current `typeVersion`; two were four major versions behind.
- Models tiered — a strong model for the writers and consistency checker, cheaper ones for planning,
  guideline analysis and the abstract.
- The reference list is no longer written by a model at any point.

---

## v1.0.0

Initial release. Preserved in [`legacy/v1/`](legacy/v1/README.md); non-functional.

- Tally form integration
- DOCX export
- Gmail delivery
- Google Sheets logging
