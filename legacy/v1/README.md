# v1 — Medical Thesis Proposal Writer (superseded)

`medical-thesis-writer.json` is the original workflow, kept for the record. It is **not
functional** and should not be imported except to read it.

It is preserved because the gap between what it looked like and what it did is the most useful
thing in this repository. It validated cleanly. It had sensible node names. It produced nothing.

---

## Why it never ran

The second node, `Edit Fields`, read each submitted value with
`{{ $json.body.data.fields[N].value }}` and wrote it to a field *named*
`body.data.fields[N].label`. Value in, label out. After that node, `fields[N].value` did not exist
anywhere in the item, and `includeOtherFields` was off, so the original webhook body was discarded
along with it.

Everything downstream followed from that one swap:

- `A1 Validator` read `fields[N].value` for all eleven fields, got empty strings, and reported every
  required field missing. **Every submission routed to "Missing Fields."** The thesis chain was
  never reached — not intermittently, not for malformed input. Never.
- `If1` and `HTTP Request` read
  `$('Append or update row in sheet').item.json.body.data.fields[10].value[0].url` → `undefined[0]`
  → a hard TypeError. Latent only because nothing ever got that far. Doubly broken, in fact: a
  Google Sheets node outputs the row it wrote, so `.body` does not exist on it either.

No error was surfaced to the student. The webhook stayed open until the client gave up, and the
spreadsheet sat on `Recieved` (sic).

---

## The other defects

Found while tracing the above. Each one would have produced wrong output on its own.

| # | Defect | Effect |
|---|---|---|
| 1 | `A2 Analyzer` + `Edit Fields1` fed a `Merge` whose output nothing read | The departmental guideline was downloaded, parsed, analysed — then discarded |
| 2 | `Merge` in `append` mode, `If1`-true wired to **both** `HTTP Request` and `Edit Fields1` | Two items reached `Call Chapter 1 - 3`, running the entire agent chain **twice** |
| 3 | `Final Assembler` read `A3`/`A4d`/`A5`, never `A6` | The consistency checker ran, cost tokens, and its corrections were **thrown away** |
| 4 | `output_slice` = `{{ …output.slice }}` — the *function*, uncalled — then `A3b` called `output_slice(0,1500)` | `is not a function` → node failure |
| 5 | `Generate DOCX` searched for `# CHAPTER ONE`, `## Chapter 2`, `# CHAPTER THREE`; no prompt emitted those | `ch1S === -1` → **Chapter One silently omitted from the document** |
| 6 | The fallback cover page hardcoded a specific IVU/radiography title | Stamped another student's title onto any thesis whose section parse missed |
| 7 | `Send a message` hardcoded one recipient; the form collected no email address | Every student's thesis went to the same inbox |
| 8 | `responseMode: responseNode` in front of a multi-minute agent chain | The form client timed out long before `Respond - Success` |
| 9 | `onError: continueErrorOutput` on two nodes with the error output wired nowhere; no error branches anywhere else | Silent death: webhook never answered, sheet stuck on `Recieved` |
| 10 | Webhook unauthenticated on a path that triggered ~15 LLM calls | Anyone who found the URL could spend the account's credit |
| 11 | Field access was positional (`fields[0]`…`fields[10]`) | Reordering a question in the form silently shifted every column |

---

## Why it was rebuilt rather than repaired

Defects 1–11 are fixable. The architecture underneath them was not.

`A4c Empirical Review Writer` was instructed to report the design, duration, location, sampling
technique, sample size, instruments, data collection method, analysis, findings and conclusion for
ten to fifteen studies. Its only input was `A4a`, which was instructed to return author, year,
title, journal, DOI/PMID, type and relevance — and nothing else.

**No abstract, no methods text and no results text ever entered the workflow.** Every one of those
fields had to be invented, and the workflow had no way to tell an invented one from a real one,
because all citation control was prompt-level instruction to a model that could not check its own
claims.

Two smaller leaks pointed the same way: `A3` and `A4a` shared one `Simple Memory` with the same
session key, and `A4a` was told to begin "by checking if there are sources in memory" — an explicit
invitation to recycle unverified prose as though it were a retrieved result.

The replacement makes fabrication structurally impossible rather than discouraged. See
[docs/anti-hallucination.md](../../docs/anti-hallucination.md).
