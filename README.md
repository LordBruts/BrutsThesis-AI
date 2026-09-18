# Bruts-Thesis AI

> An n8n system that drafts Chapters 1–3 of a medical thesis proposal from real literature,
> and is built so that an invented reference is **unrepresentable** rather than merely discouraged.

Built with:

- n8n
- OpenRouter (Claude Sonnet 5 · DeepSeek)
- Europe PMC
- Tally Forms
- Google Sheets
- Google Drive
- Gmail

A student submits their project details through a Tally form. The system validates the
submission, records it, optionally applies a departmental formatting guideline, searches the
literature, writes Chapters 1–3 plus an abstract against evidence it actually fetched, and
delivers a formatted `.docx` by email.

The output is a high-quality **first draft**. It is meant to be reviewed, checked and edited
before submission.

---

## Two workflows

| | What it does |
|---|---|
| [`intake-delivery/`](intake-delivery/) | Front end. Takes the Tally submission by webhook **or** by polling the sheet Tally writes into, validates it, applies the guideline, calls the writer, and delivers the document. |
| [`thesis-chapters/`](thesis-chapters/) | The writer. A sub-workflow: gathers literature, writes the chapters, and returns them with a machine-built reference list. Not useful standalone. |

```
Tally webhook  ─┐
                ├─▶ intake-delivery ──▶ thesis-chapters ──▶ DOCX ──▶ Gmail + Drive + Sheet
Sheet polling  ─┘                       (Execute Workflow)
```

The sheet-polling trigger exists because the webhook needs a public URL. Polling needs no
tunnel, which is what makes the whole system runnable from a local instance.

---

## Why v2 exists

v1 — the *Medical Thesis Proposal Writer* that this repository used to hold — had a defect no
amount of prompt engineering could fix.

Its `A4c Empirical Review Writer` node was instructed to report **study design, duration,
location, sampling technique, sample size, instruments, data collection, analysis method,
findings and conclusions** for 10–15 studies. Its only input was a source list containing
author, year, title, journal and DOI. No abstract, no methods text, no results text ever
entered the workflow.

Every one of those thirteen fields *had* to be invented. A node given no facts will produce
fiction, and asking it more firmly not to changes nothing.

v2 is a structural answer rather than a better prompt:

| Change | Effect |
|---|---|
| Evidence is **fetched deterministically**, including Methods and Results verbatim from open-access full text | The empirical review has real facts to report |
| Writers have **no search tools and no memory** — only the evidence pack | The model cannot reach outside supplied evidence |
| Citations are **opaque markers** resolved by a Code node; the reference list is **computed, never written** | An invented reference is unrepresentable, not merely discouraged |

The v1 workflow export, its screenshots and its installation guide were removed when v2 landed.
They remain in this repository's history.

---

## Setup

Each workflow folder has its own README with the node-by-node detail. In short:

```sh
# 1. Import both workflows into n8n (Import from File)
#    thesis-chapters/workflow.json   <- publish this one FIRST
#    intake-delivery/workflow.json

# 2. Attach credentials in the n8n UI. The exports carry none:
#    credential ids are per-instance and cannot be moved between installations.

# 3. Point the front end at your sheet and your copy of the writer
cd intake-delivery
cp config.example.json config.local.json    # gitignored
#   sheetId        -> the Google Sheet Tally writes into
#   subWorkflowId  -> the id n8n gave thesis-chapters on import
node build-workflow.js                      # writes workflow.local.json
```

`config.local.json` is gitignored, and a build made from it writes **`workflow.local.json`**
rather than overwriting the committed export. That is deliberate: the committed
`workflow.json` is built from `config.example.json`, so it carries placeholder ids and no
credentials, and a rebuild cannot quietly stage a real Sheet id.

**Publish `thesis-chapters` before activating `intake-delivery`.** n8n refuses to activate a
workflow whose Execute Workflow nodes point at unpublished sub-workflows. Publishing the leaf
first is safe — an Execute Workflow trigger registers no webhook and never fires on its own.

---

## Repository layout

```
intake-delivery/    front end: validation, guideline, delivery
thesis-chapters/    the writer sub-workflow
assets/             logo
CHANGELOG.md
```

Both folders hold their Code node bodies as real `.js` files beside the export, with tests
that import and run those exact files. The n8n instance is the source of truth for anything
live; these files are the design record and the importable artifact.

---

## Licence

MIT — see [LICENSE](LICENSE).
