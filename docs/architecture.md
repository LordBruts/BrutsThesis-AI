# Architecture

Two n8n workflows. The parent handles intake, formatting rules and delivery; the sub-workflow does
evidence and writing. They are split because the writing half takes minutes and the intake half must
answer a form submission in seconds.

```
┌─ PPW · Intake & Delivery ──────────────────────────────────────────────┐
│                                                                        │
│  Tally webhook  ─┐                                                     │
│  Sheets poll    ─┴→ Normalize Submission → Submission Valid?           │
│                                              ├ no  → Mark Incomplete   │
│                                              │       → Respond 400     │
│                                              └ yes → Record Submission │
│                                                      → Clear Sheet Err │
│                                                      → Respond 202     │
│                                                      → Has Guideline?  │
│      ┌─────────────────────────────────────────────────────┘           │
│      ├ yes → Download → Extract PDF → A2 Guideline Analyzer ─┐          │
│      └ no  ──────────────────────────────────────────────────┤          │
│                                       Normalize Format Rules ┘          │
│                                                    ↓                   │
│                                        Call Thesis Chapters ───────────┼──┐
│                                                    ↓                   │  │
│                                        Assemble Document Input         │  │
│                                                    ↓                   │  │
│                                             Generate DOCX              │  │
│                                              ├→ Gmail · Send Thesis    │  │
│                                              └→ Drive · Upload         │  │
│                                                  → Sheet · Mark Complete│ │
└────────────────────────────────────────────────────────────────────────┘  │
                                                                            │
┌─ PPW · Thesis Chapters 1-3 ───────────────────────────────────────────────┘
│
│  Start → A0 Query Planner → Build Search Requests → Europe PMC Search
│        → Dedupe & Rank → Fetch & Extract Full Text → Build Evidence Pack
│        → A3 Chapter 1 → A4b Conceptual → A4c Empirical → A4d Chapter 2
│        → A5a Brief → A5 Chapter 3 → A6 Consistency Checker
│        → Apply Corrections → Citation Gate → A8 Abstract → Return
└───────────────────────────────────────────────────────────────────────────
```

---

## Two triggers, one normaliser

The same form reaches n8n two ways, and both are supported by one `Normalize Submission` node
because the matcher works on **labels**:

- **Tally webhook** → `body.data.fields[]`, each `{ label, type, value, options }`
- **Google Sheets poll** → a flat row whose column headers are the question labels

The Sheets route exists because it needs no inbound connectivity: n8n polls Google outbound, so it
works from `localhost` with no tunnel. The webhook route needs the instance exposed publicly.

Three things the normaliser handles that are easy to get wrong:

- **Match order is load-bearing.** "Head of Department" and "Departmental Project Guideline" both
  contain the word *department*, so both must be tested before any pattern looking for a department
  or programme. Getting this wrong silently empties two fields.
- **Tally sends option UUIDs**, not the chosen text, for dropdowns, multiple choice, checkboxes and
  ranking. Taking `value` at face value writes a UUID into the thesis; it is resolved against the
  `options` array first.
- **Programme is not a department.** Students type "Bachelor of Radiography" into a field prompting
  for a programme of study. The cover page needs `DEPARTMENT OF RADIOGRAPHY` and the title page needs
  `...FOR THE AWARD OF BACHELOR OF RADIOGRAPHY`. Blind prefixing gives "Bachelor of Science in
  Bachelor of Radiography"; using the raw value as a department gives "DEPARTMENT OF BACHELOR OF
  RADIOGRAPHY". The two are derived separately.

---

## Respond first, work afterwards

`Respond 202 Accepted` sits **mid-flow**. Nodes after a Respond node keep executing, so the form
client gets an answer in seconds while generation continues behind it. The original design held the
connection open through the whole multi-minute run and timed out on every submission.

---

## Guideline handling

If the student uploads a departmental project guideline, it is downloaded, its text extracted, and
`A2 Guideline Analyzer` returns structured formatting rules — font, size, spacing, margins, citation
style. If not, defaults apply. Both paths converge on `Normalize Format Rules`, and so do four error
outputs, so a failed download or an unparseable PDF degrades to defaults rather than stopping.

There is no `Merge` node. The original used one in `append` mode fed by two branches, which sent two
items into the sub-workflow call and ran the entire agent chain twice.

---

## Error handling

The rule is that logging must never cost the student their document.

- Sheets writes run `onError: continueRegularOutput` so a spreadsheet problem cannot abort a run.
- **But n8n attaches the failure to the item**, and the next node that has an error output routes
  that item to its error branch regardless of whether it succeeded. This produced a memorable
  false alarm: a failed sheet write made `Download Guideline` report as failed while it had in fact
  fetched the PDF perfectly — 2.29 MB of real binary sitting in the output panel.
  `Clear Sheet Error` rebuilds the item from the normaliser to drop the flag, preserving
  `pairedItem` so downstream lookups still resolve.
- The email hangs directly off `Generate DOCX` rather than at the end of a chain, so neither the
  Drive upload nor the sheet update can prevent delivery.
- Fallible nodes carry an error branch; the sub-workflow call routes failure to `Sheet · Mark Failed`.

---

## Expressions

Cross-node references use `$('Node').first().json.x`, never `.item`.

The evidence pipeline fans one item out to ten searches and thirty candidates, then collapses back
to a single pack. Code nodes do not emit `pairedItem` unless written to, so n8n cannot trace an item
through that waist and `.item` fails with *"Paired item data … is unavailable"* — naming the node
where the trail went cold, not the node holding the data. Every node these expressions reach holds
exactly one item, so `.first()` is the accurate expression rather than a workaround.
`build-workflow.js` refuses to write `workflow.json` if a `.item` reference reappears.

---

## Models

Tiered, through OpenRouter: a strong model for the six writers and the consistency checker, cheaper
models for the planner, guideline analyser, methodology brief and abstract, and a coding-capable
model as the structured-output auto-fixer. Roughly $0.50 per thesis.

---

## Generated, not hand-edited

Each workflow folder holds a `build-workflow.js` that emits `workflow.json`, inlining each Code
node's source from its own `.js` file — so the tested source and the deployed source are identical
by construction, and the test suites load exactly what n8n runs.

Instance-specific values live in `config.local.json` (gitignored); `config.example.json` ships the
same keys as placeholders. The generator is byte-identical here and in the working copy, which is
what makes drift between the repository and a live instance detectable at all.
