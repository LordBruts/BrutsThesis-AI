# Bruts-Thesis AI

> Generates an undergraduate medical thesis proposal — preliminary pages, Chapters 1–3, abstract and
> references — as a Word document, from a form submission.

Built on n8n, OpenRouter, Europe PMC, Tally Forms, Google Sheets, Google Drive and Gmail.

The point of the project is not that a model can write three chapters. It is that **the references
are real**. Every citation resolves to a paper that an HTTP node actually fetched from Europe PMC,
and the reference list is computed from structured records rather than written by a model — so an
invented source is not discouraged, it is unrepresentable.

If you read one thing here, read **[docs/anti-hallucination.md](docs/anti-hallucination.md)**.

---

## Status

**v2.0 — rebuilt.** v1.0 is preserved in [`legacy/v1/`](legacy/v1/README.md) and does not work; its
second node destroyed every submitted value, so every submission routed to "Missing Fields" and the
thesis chain was never reached. That folder documents the eleven defects and, more usefully, the
architectural reason it had to be replaced rather than patched.

What the rebuild has actually done, on a real submission:

| Stage | Status |
|---|---|
| Intake — Tally webhook and Google Sheets poll | verified |
| Guideline PDF download, extraction and analysis | verified |
| Evidence — 30 candidates, 30 with full text, 0 fetch failures | verified |
| Chapters 1–3 + abstract — 9,617 / 26,132 / 11,800 / 2,693 chars | verified, 9m 41s |
| Citation Gate — 98 markers → 29 references, **0 violations** | verified |
| `.docx` generation from the real generated chapters | verified |
| Google Drive upload | verified |
| Gmail delivery | **fix deployed, confirming run pending** |
| Google Sheets status columns | **pending — columns not yet added to the sheet** |

The Gmail entry is honest rather than aspirational. The email node sat at the end of a chain running
through Drive and Sheets, neither of which forwards binary, so the attachment was never present and
every send failed. It now hangs directly off the document node; that change is deployed and
validated but has not yet been through a confirming run.

Offline test suites: **200 checks**, all passing from a bare clone with no API key.

---

## How it works

```
Tally form  ──┐
Sheets poll ──┴→ normalise → validate → acknowledge in seconds
                                            ↓
                          departmental guideline PDF → formatting rules
                                            ↓
      ┌─────────────────────────────────────────────────────────┐
      │  plan queries → Europe PMC → rank → fetch full text      │
      │       → evidence pack (abstract + Methods + Results)     │
      │       → six writers, no tools, no memory, cite [E07]     │
      │       → consistency check → Citation Gate → abstract     │
      └─────────────────────────────────────────────────────────┘
                                            ↓
                        .docx → email to student + Drive + sheet row
```

Full node-by-node walkthrough: **[docs/architecture.md](docs/architecture.md)**.

### Why the references hold up

- **Evidence is fetched by code, not by an agent.** Search is a plain HTTP node that always runs, so
  the model cannot decide not to look and answer from memory instead.
- **Writers get no search tools and no memory.** They see the evidence pack and nothing else.
- **Writers never write a citation.** They emit opaque markers — `[E07]` — and a deterministic Code
  node converts them into APA-7 references built from the structured Europe PMC records.
- **Anything unreported is omitted.** A study's sample size is written only if it was actually
  extracted from that paper's Methods section. No placeholders, no "not reported" filler.
- **Records without an abstract are dropped**, and only research articles with real extracted
  Methods or Results reach the empirical review — so the node that would invent a sample size never
  receives a record lacking one.

---

## Repository layout

```
workflows/
  ppw-intake-delivery/     form intake, guideline analysis, DOCX, delivery
  ppw-thesis-chapters/     evidence pipeline, six writers, Citation Gate
    test/                  200 offline checks + real Europe PMC fixtures
docs/
  architecture.md          node-by-node design
  anti-hallucination.md    the citation design, and what it does not catch
legacy/v1/                 the original workflow and why it never ran
examples/                  a sample submission
```

Each workflow folder holds a `build-workflow.js` that generates `workflow.json`, inlining each Code
node's source from its own file. The tested source and the deployed source are therefore identical
by construction, and the test suites load exactly what n8n executes.

---

## Running it

See **[Installation Guide.md](Installation%20Guide.md)**.

In short: import both `workflow.json` files into n8n, attach your own credentials in the UI, copy
`config.example.json` to `config.local.json` and fill in your Google Sheet id, then add the tracking
columns to the sheet. The committed exports carry placeholders, not working ids — credential ids are
per-instance and cannot be carried between installations.

Roughly **$0.50 per thesis** in OpenRouter credit, using a strong model for the writers and cheaper
models for the utility steps.

---

## Limits

**This produces a first draft.** It should be read before it is submitted.

The one failure mode the design does not catch is **misattribution** — a real finding credited to
the wrong real paper. The citation is well-formed, the marker is valid, the reference exists, and
nothing about it is detectable by the gate. Closing that would take a per-claim verification pass,
which is not built. This is stated in full in
[docs/anti-hallucination.md](docs/anti-hallucination.md#what-this-does-not-catch).

Users remain responsible for verifying factual accuracy, reviewing citations, complying with
institutional guidelines and ensuring academic integrity.

---

## Roadmap

**Delivered in v2.0**

- ✅ Deterministic evidence retrieval from Europe PMC, including open-access full text
- ✅ Citation integrity enforced in code, with a machine-readable `citation_report`
- ✅ Comprehensive error handling and error branches on fallible nodes
- ✅ Deterministic input validation, by field label rather than position
- ✅ Formatting driven by the department's own uploaded guideline
- ✅ Asynchronous acknowledgement; no more form timeouts
- ✅ 200 offline checks over the exact deployed source

**Next**

- ⬜ Confirming run for Gmail delivery, and the sheet tracking columns
- ⬜ Duplicate submission detection
- ⬜ Per-claim verification against the cited record (the misattribution gap)
- ⬜ Export to PDF
- ⬜ Multiple proposal templates and institution profiles
- ⬜ Chapters 4 and 5

---

## Licence

MIT. See [LICENSE](LICENSE).
