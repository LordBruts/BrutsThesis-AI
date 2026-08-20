# PPW · Intake & Delivery

Front end for the thesis generator. Validates a Tally submission, records it, optionally applies a
departmental guideline, calls the thesis sub-workflow, and delivers the `.docx`.

Takes submissions **either** from Tally’s webhook **or** by polling the Google Sheet Tally writes
into — the second needs no tunnel, which is what makes it runnable from localhost.

**Triggers:** Tally webhook POST `/PPW`, or Google Sheets polling · **Active:** no

Calls [`PPW · Thesis Chapters 1–3`](../ppw-thesis-chapters/README.md); its workflow id goes in
`config.local.json` as `subWorkflowId`.

---

## Flow

```
Webhook (POST /PPW, X-PPW-Token header auth)  ─┐   instant, needs a public URL
Sheet Trigger (polls the Tally sheet, rowAdded) ┤   ~1 min, needs NO tunnel
                                                ↓
  → Normalize Submission ────────── maps BY LABEL, computes missing_required[]
  → Submission Valid?
      ├ false → Sheet · Mark Incomplete → Respond 400 (names the missing fields)
      └ true  → Sheet · Record Submission (status "Received")
                → Clear Sheet Error           ← drops the error flag a failed write attaches
                → Respond 202 Accepted        ← answers in seconds; run continues past here
                → Has Guideline?
                    ├ true  → Download Guideline → Extract Guideline Text → A2 Guideline Analyzer ┐
                    └ false ───────────────────────────────────────────────────────────────────── ┤
                → Normalize Format Rules  ←── all paths converge here, incl. every error output ───┘
                → Call Thesis Chapters (waitForSubWorkflow)
                → Assemble Document Input
                → Generate DOCX
                → Drive · Upload Thesis
                → Sheet · Mark Complete (status, output_link, citation_count, unverified_count)
                → Gmail · Send Thesis (.docx attached)

  error outputs of Call Thesis Chapters and Drive · Upload → Sheet · Mark Failed
```

---

## What changed from `PPW Final Version`, and why

| Old | New |
|---|---|
| `Edit Fields` read `fields[N].value`, wrote a field *named* `fields[N].label` — destroying every value, so **every** submission failed validation | `Normalize Submission` maps **by label**, so reordering the form is harmless |
| `A1 Validator` LLM decided completeness; detected via `contains "VALIDATED"` — false-passes when the model writes that word while listing what is missing | Required-field checking is deterministic code. No tokens, no ambiguity |
| Guideline analysed, then **discarded** (fed a Merge nothing read) | `format_rules` is passed to the sub-workflow and drives the DOCX styles |
| `Merge` in append mode with both IF outputs wired in → **2 items → whole agent chain ran twice** | No Merge node. Branches converge on `Normalize Format Rules` |
| Webhook held open for the entire multi-minute run → client timeout | `Respond 202` fires in seconds; work continues behind it |
| Email hardcoded to one address; form collected none | Sends to `student_email`; degrades gracefully if absent |
| 2 error outputs declared, **wired to nothing** | All 5 error outputs wired; failures land in the sheet |
| Webhook unauthenticated in front of ~15 LLM calls | Header auth (`X-PPW-Token`, credential `PPW Webhook Token`) |

---

## Connecting Tally

The reference form is a Tally form titled "Project Submission Form". Point `YOUR_TALLY_FORM_ID`
at your own copy — the field **labels** below are what the normaliser matches on, not the form id.
Its twelve fields all map correctly — verified against the real labels in `test-normalize.js` test 10:

| # | Form label | Required | → field |
|---|---|---|---|
| 1 | Email | yes | `student_email` |
| 2 | Project Title | yes | `project_title` |
| 3 | Programme of Study | yes | `programme` → `department` + `degree` |
| 4 | Faculty | yes | `faculty` |
| 5 | Institution | yes | `institution` |
| 6 | Student Full Name | yes | `student_name` |
| 7 | Registration/Matriculation Number | yes | `reg_number` (via the `matric` alternative) |
| 8 | Supervisor's Name and Title | yes | `supervisor` |
| 9 | Head of Department (HOD) Name and Title | yes | `hod` |
| 10 | Study Location | no | `study_location` |
| 11 | Proposed Study Duration | no | `study_duration` |
| 12 | Departmental Project Guideline | no | `guideline_url` |

Two label collisions are load-bearing and are why `MAP` order matters: #9 and #12 both contain
"department", so both must be tested before the `programme` pattern or they get swallowed by it.

All twelve are `INPUT_TEXT`/`INPUT_EMAIL`/`FILE_UPLOAD` today — no dropdowns — so the option-id
issue below does not currently bite. It is handled anyway, in case a field is later converted.

`Normalize Submission` is written against Tally's exact payload (`data.submissionId`,
`data.createdAt`, `data.fields[]` with `key` / `label` / `type` / `value` / `options`). Three things
need care.

### 0. "Programme of Study" is a degree, not a department

The field prompts with *"e.g. Bachelor of Radiography"*, so students type a degree title. The
document needs both, in different places — `DEPARTMENT OF RADIOGRAPHY` on the cover and
`AWARD OF BACHELOR OF RADIOGRAPHY` on the title page. Using the raw value for both produces
`DEPARTMENT OF BACHELOR OF RADIOGRAPHY`, and prefixing blindly produces
`BACHELOR OF SCIENCE IN BACHELOR OF RADIOGRAPHY`.

`normalize-submission.js` derives them separately: strip a leading degree phrase for `department`,
and keep the value verbatim for `degree` when it already reads as one. `Medical Radiography` (no
degree prefix) still yields `Bachelor of Science in Medical Radiography`. Test 11 covers seven
input shapes; `validate_docx.py` guards both bad strings.

### 1. Tally sends option IDs, not text

For `DROPDOWN`, `MULTIPLE_CHOICE`, `CHECKBOXES` and `RANKING`, `value` is an array of **option
UUIDs**, with a sibling `options` array mapping `id` → `text`:

```json
{ "label": "Programme of Study", "type": "DROPDOWN",
  "value": ["e7bfbbc6-c2e6-4821-8670-72ed1cb31cd5"],
  "options": [{ "id": "e7bfbbc6-c2e6-4821-8670-72ed1cb31cd5", "text": "Medical Radiography" }] }
```

Reading `value` directly puts a UUID on the thesis cover page. `toValue()` resolves each id against
`options`, joins multi-selects with commas, and passes unmatched values (a free-text "Other")
through untouched. Covered by tests 8 and 9 in `test-normalize.js`.

### 2. Tally cannot reach `localhost`

Tally is a cloud service; `http://localhost:5678` is unreachable from it. A tunnel is required
**for the webhook route only** — the Sheet Trigger avoids this entirely by polling outbound.
The `cloudflared` container already running on this machine points at **searxng**
(`tunnel --url http://searxng:8080`), not n8n, so it does not help as-is.

A **quick tunnel** gets a random hostname that changes on every restart, which means re-editing the
Tally webhook each time. For anything ongoing use a **named tunnel** on a domain you control, and
set `WEBHOOK_URL` on the n8n container to the public base URL — without it n8n keeps displaying
`http://localhost:5678/webhook/PPW` in the editor even though the tunnel works.

### 3. Auth and field setup

- Tally supports custom headers: **Integrations → Webhooks → Add HTTP headers**. Add
  `X-PPW-Token` with the value in the `PPW Webhook Token` credential. This is what the webhook's
  header auth checks.
- Tally also offers a signing secret (`Tally-Signature`, SHA-256 HMAC). Not used here — the shared
  header is sufficient — but it is the stronger option if you want it later.
- The form needs an **email field** and, if you want departmental formatting applied, a **file
  upload** field. Label them anything containing "email" and "guideline"/"upload" respectively;
  matching is by label pattern, not position.
- Tally's uploaded-file URLs (`storage.tally.so/...`) are fetched by `Download Guideline` with no
  auth. Confirm on the first real run that they are publicly retrievable; if not, the guideline
  branch fails soft and the run continues on default formatting.

---

## Two entry points

The workflow has **two triggers feeding one pipeline**. `Normalize Submission` detects which shape
it was handed (`body.data.fields[]` = webhook, otherwise a flat row) and emits the same object
either way, so there is one tested code path, not two.

| | `Webhook` | `Sheet Trigger` |
|---|---|---|
| Needs a tunnel / public URL | **yes** | **no** — n8n polls Google outbound |
| Latency | instant | ~1 min |
| Public attack surface | one endpoint | none |
| Credential | `httpHeaderAuth` (done) | `googleSheetsTriggerOAuth2Api` — a **different type** from the one the write nodes use |
| Rejects incomplete submissions to the student | HTTP 400 | no; status goes to the sheet |

The Sheets route is the one that works from `localhost` today. Leave whichever you are not using
disabled on the canvas, or leave both on — they are independent.

### Row identity

Sheet writes match on **`row_number`**, not `submission_id`. Tally owns this sheet and writes the
response row; the workflow only fills in its own columns on that same row, and `row_number` is the
one key both sides agree on without coordinating column names — the Sheets Trigger hands it over
directly. On the webhook path there is no row yet, so `row_number` is empty, nothing matches, and
`appendOrUpdate` appends instead. One set of nodes, correct on both paths.

---

## Setup still required

1. **Create three credentials in the n8n UI** (OAuth needs a browser, so MCP cannot create them):
   - `googleSheetsOAuth2Api` → `Sheet · Record Submission`, `Sheet · Mark Incomplete`,
     `Sheet · Mark Complete`, `Sheet · Mark Failed`
   - `googleSheetsTriggerOAuth2Api` → `Sheet Trigger` *(separate type — the Sheets credential will
     not appear in the trigger's dropdown)*
   - `googleDriveOAuth2Api` → `Drive · Upload Thesis`
2. **Add these columns to the Tally sheet**, to the right of Tally's own:
   `submission_id`, `timestamp`, `student_name`, `reg_number`, `project_title`, `programme`,
   `faculty`, `institution`, `supervisor`, `hod`, `study_location`, `study_duration`,
   `student_email`, `guideline_uploaded`, `status`, `output_link`, `citation_count`,
   `unverified_count`, `notes`.
   Tally appends rows and leaves extra columns intact.
3. **Confirm the Email field is included** in Tally's Sheets field mapping — delivery needs it.
4. **Webhook route only:** expose n8n publicly, point Tally's webhook at
   `https://<your-host>/webhook/PPW`, and set the `X-PPW-Token` header.
5. **Assign an Error Workflow** in workflow Settings — UI only, not settable over the API.
6. Activating a polling trigger starts it polling; activating a webhook needs one manual execution
   in the UI first.

> Both workflows set `saveDataSuccessExecution: 'all'`, overriding the container's
> `EXECUTIONS_DATA_SAVE_ON_SUCCESS=none`. Without that override a successful run leaves no execution
> record, so the `citation_report` — the thing worth reading — would be discarded.

---

## Traps worth remembering

- **A failed sheet write used to condemn the whole run.** `Sheet · Record Submission` runs with
  `onError: continueRegularOutput` so a spreadsheet problem cannot cost a student their thesis —
  but n8n attaches the failure to the item, and the next node with an error output routes that item
  to its error branch whether or not it succeeded. On execution 147 the sheet write failed on
  missing columns and `Download Guideline` fetched the PDF perfectly, 2.29 MB of real binary, while
  reporting as failed. `Clear Sheet Error` rebuilds the item from `Normalize Submission`, which
  drops the flag and restores the fields; it keeps `pairedItem` so downstream `.item` lookups still
  resolve, and records the message in `sheet_write_error`.
- **`Respond 202` is mid-flow, not terminal.** Nodes after a Respond node continue to execute; that
  is what makes the async acknowledgement work.
- **`Normalize Format Rules` has five inbound connections** — the no-guideline branch plus four
  error outputs. They are mutually exclusive, so exactly one fires. This replaces the Merge node
  that caused the double-run.
- **The Drive file is not made link-shareable.** It carries the student's personal details, so the
  student receives the `.docx` as an email attachment; the Drive link in the sheet is for the
  workflow owner.
- **A guideline that mentions only a font must not reset the margins.** `normalize-format-rules.js`
  merges per-key over defaults and sanity-bounds every numeric value.
- **Respond nodes carry `onError: continueRegularOutput`.** On the Sheets-trigger path there is
  no HTTP caller to answer, and without this the Respond node throws and takes the run down.
- **Google Sheets output is the written row**, not the input JSON. Downstream nodes read from
  `$('Normalize Submission')` / `$('Assemble Document Input')`, never from the Sheets node — this
  was one of the original workflow's broken assumptions.

---

## Files

| File | Role |
|---|---|
| `workflow.json` | the export (no `credentials` blocks) |
| `build-workflow.js` | regenerates `workflow.json`; reads the sub-workflow ID from `../ppw-thesis-chapters/.workflow-id` |
| `normalize-submission.js` | label-based field mapping + deterministic validation |
| `normalize-format-rules.js` | guideline rules merged over defaults |
| `assemble-document-input.js` | joins chapters to metadata for the DOCX generator |
| `test-normalize.js` | 35 offline checks |

`Generate DOCX` inlines [`../ppw-thesis-chapters/docx-generator.js`](../ppw-thesis-chapters/docx-generator.js).
Edit the `.js` files, then run `node build-workflow.js`.

---

## Verification status

| Check | Status |
|---|---|
| `test-normalize.js` | pass — 91 checks (both intake shapes, real form labels) |
| `validate_workflow` (MCP) | valid: 0 errors, 0 warnings, 27 connections, 60 expressions |
| Connection inspection | verified: 5/5 error outputs wired, 0 Merge nodes, all branches converge correctly |
| Sub-workflow call target | verified: the chapters workflow exists and validates |
| Dual-trigger wiring | verified: 2 triggers, 27 connections, 0 invalid, 60 expressions |
| End-to-end run | **blocked** on the two Google credentials |

The generation half is proven: see the live-run section in
[the sub-workflow README](../ppw-thesis-chapters/README.md#verification-status). What remains
unrun here is Sheets → Drive → Gmail, which needs the Google credentials.
