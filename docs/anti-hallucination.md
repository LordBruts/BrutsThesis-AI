# How this workflow avoids inventing sources

A thesis proposal whose references do not exist is worse than no thesis proposal. The student
submits it, a supervisor checks two citations, and the whole document is discredited.

Telling a model "do not invent citations" does not solve this. The model complies right up until it
doesn't, and nothing downstream can tell the difference. The design below removes the *capability*
instead of asking for restraint.

Three ideas do the work:

1. Evidence is gathered by deterministic code, not by an agent that may decide not to look.
2. Writers never see or write a citation string. They emit opaque markers.
3. A code node — not a model — converts markers into references, and rejects anything it cannot
   account for.

---

## 1. Evidence acquisition is not agentic

In the original workflow the writers held the search tools. That meant the model decided what
evidence existed, how hard to look for it, and when to stop — and it could skip searching entirely
and answer from memory, with no trace that it had done so.

Here, search is a plain HTTP node that always runs:

```
A0 Query Planner  →  Build Search Requests  →  Europe PMC Search
                     (fans out one item per query)   (one call per query)
        ↓
Dedupe & Rank Candidates  →  Fetch & Extract Full Text  →  Build Evidence Pack
```

**Europe PMC** is the backend, queried with `search?resultType=core`. One call returns the abstract,
DOI, PMID, PMCID, journal, volume, pages, author list, publication types and the open-access flag —
replacing the three-call PubMed eutils dance and giving a deterministic article-type filter for free.
For open-access records, `GET /{PMCID}/fullTextXML` then yields Methods and Results **verbatim**.

Two filters matter more than the ranking:

- **No abstract, no entry.** An abstract is the minimum needed to say anything about a study.
  Admitting a bare title and DOI is precisely what forced the old workflow to fabricate.
- **No methods or results text, no empirical review.** Records reach the empirical review section
  only if they are research articles carrying real extracted text. Case reports and reviews
  genuinely have no Methods section; they contribute their abstract and go no further. A study whose
  sample size was never fetched cannot have its sample size misreported, because the node that would
  invent it never receives the record.

Extraction has its own traps, handled in [`fetch-fulltext.js`](../workflows/ppw-thesis-chapters/fetch-fulltext.js):
`sec-type` attributes are frequently absent, so sections are matched on `<title>` text with
`sec-type` as fallback; and `<xref>` elements must be stripped or the source paper's own reference
numbers leak into the extracted text as bare `[12]`.

---

## 2. Writers cite markers, not names

Every record that survives ranking is assigned a stable id — `E01` through `E30` — and the writers
receive the pack and **nothing else**:

- **No search tools.** Nothing to call, nothing to skip calling.
- **No memory.** Every writer is stateless. The old workflow shared one `Simple Memory` between two
  agents and told one of them to start "by checking if there are sources in memory", which is an
  invitation to recycle unverified prose as though it were a retrieved result.

The system prompt every writer carries opens with this, and it is the whole contract:

```
# EVIDENCE PROTOCOL — THESE RULES OVERRIDE EVERY OTHER INSTRUCTION

1. You have NO search tools and NO memory. The EVIDENCE PACK in the user
   message is the ONLY source of factual information available to you.
2. To cite a source, write its marker exactly: [E07]. Nothing else is a citation.
3. NEVER write an author name and year yourself.
4. If a detail is not in the pack, OMIT it. Do not write "not reported".
```

Rule 4 is deliberate. Filling gaps with "not reported" produces a document littered with admissions
of absence; omitting the sentence produces one that simply says less, which is what a careful writer
would have done anyway.

The important consequence of rule 3 is not that the model obeys it. It is that **a writer has no
access to the information needed to break it usefully** — the pack presents study content under a
marker, and constructing a plausible author-year string from it would take a deliberate act that
the next stage catches anyway.

---

## 3. The Citation Gate

[`citation-gate.js`](../workflows/ppw-thesis-chapters/citation-gate.js) runs **last**, after the
consistency checker has made its corrections, and it is ordinary JavaScript. It:

| Step | Behaviour |
|---|---|
| Extracts every `[Exx]` marker from all three chapters | including runs like `[E03][E11]` |
| Rejects markers absent from the pack | recorded as `UNKNOWN_REF_ID` |
| Flags author-year strings the model wrote by hand | `FREETEXT_CITATION` — catches rule 3 being broken |
| Drops pack entries nothing cited | an uncited source is not a reference |
| Builds the reference list from the structured records | APA 7th, computed — never written by a model |
| Substitutes markers with the computed citation | `(Adeyemi et al., 2025)`, with 2025a/2025b disambiguation |
| Emits `citation_report` | `{ total_markers, unique_refs_cited, refs_in_pack, uncited_refs, violations, passed }` |

The ordering is load-bearing. The consistency checker sees text that still carries `[Exx]` markers,
so it cannot introduce a reference of its own; the gate then runs over its corrected output, so no
edit escapes checking.

**Why this makes an invented reference structurally impossible:** every reference string is derived
from a Europe PMC record that a HTTP node actually fetched. There is no code path in which a model's
output becomes a reference. The worst a model can do is cite a marker that does not exist — which is
detected, or one that exists but does not support the claim — which is not.

---

## What this does not catch

**Misattribution.** A real finding credited to the wrong real paper produces a valid marker
resolving to a real reference. The gate cannot see it, because nothing about the citation is
malformed.

This is the residual risk and it is stated plainly rather than papered over. The mitigations in
place are narrow: writers only receive study text that was actually extracted, so there is less
opportunity to mix studies up, and the empirical review is restricted to records whose Methods and
Results were fetched verbatim. Closing it properly would take a per-claim verification pass, which
is not built.

**A thesis proposal from this workflow is a first draft.** It should be read against its own
reference list before submission.

---

## Verified

Sub-execution of the chapters workflow, 9 minutes 41 seconds, on a real submission:

| | |
|---|---|
| Candidates ranked | 30 |
| With full text retrieved | 30 (0 fetch failures) |
| Admitted to the empirical review | 15 |
| Chapters produced | 9,617 + 26,132 + 11,800 characters, plus a 2,693-character abstract |
| Markers written | 98 |
| Resolving to references | 29 |
| Pack entries dropped as uncited | 1 |
| **Violations** | **0 — gate passed** |

Three DOIs from an earlier run were resolved against Crossref by hand and confirmed to be real
papers with the titles and authors the gate had computed.
