# Installation

Two workflows are imported separately. The parent calls the sub-workflow by id, so **import the
sub-workflow first** and note the id n8n assigns it.

## Prerequisites

- n8n — self-hosted or cloud
- An OpenRouter account and API key (budget roughly **$0.50 per thesis**)
- A Google account, and a Google Cloud project with **both** the Google Sheets API **and** the
  Google Drive API enabled
- A Tally account
- Node.js, only if you want to regenerate the workflow JSON or run the tests

No Europe PMC account is needed — the literature API is open and unauthenticated.

---

## 1. Clone

```bash
git clone https://github.com/LordBruts/BrutsThesis-AI.git
cd BrutsThesis-AI
```

Optionally confirm everything works before touching n8n — the suites are offline and need no keys:

```bash
node workflows/ppw-thesis-chapters/test/test-citation-gate.js
node workflows/ppw-thesis-chapters/test/test-rank-candidates.js
node workflows/ppw-thesis-chapters/test/test-build-search-requests.js
node workflows/ppw-thesis-chapters/test/test-fetch-fulltext.js
node workflows/ppw-intake-delivery/test-normalize.js
```

200 checks, all should pass.

---

## 2. Enable the Google APIs first

Do this before creating credentials, in your Google Cloud project's **APIs & Services → Library**:

- **Google Sheets API** — every sheet read and write needs it.
- **Google Drive API** — the thesis upload needs it, and so does n8n's "From list" document picker,
  which resolves spreadsheets through Drive even when you only intend to read a sheet.

Skipping the Drive API produces a `403 Forbidden` on the document dropdown that reads exactly like an
authentication failure but is not — the credential is fine, the API is simply switched off. The
workflows here select the spreadsheet **by id** rather than from the list for that reason, but the
upload still needs Drive.

---

## 3. Import the workflows

**Sub-workflow first.** In n8n choose *Import from File*:

```
workflows/ppw-thesis-chapters/workflow.json
```

Open it and copy the workflow id from the URL — `/workflow/<id>`.

**Then the parent:**

```
workflows/ppw-intake-delivery/workflow.json
```

Open its `Call Thesis Chapters` node and set the target to the sub-workflow you just imported.

---

## 4. Credentials

Attach these in the n8n UI. The committed exports deliberately carry no credential blocks —
credential ids are per-instance and cannot be transferred.

| Credential type | Nodes |
|---|---|
| `openRouterApi` | `Model · Guideline`, and every model node in the sub-workflow |
| `googleSheetsOAuth2Api` | `Sheet · Record Submission`, `Mark Incomplete`, `Mark Complete`, `Mark Failed` |
| `googleSheetsTriggerOAuth2Api` | `Sheet Trigger` |
| `googleDriveOAuth2Api` | `Drive · Upload Thesis` |
| `gmailOAuth2` | `Gmail · Send Thesis` — scope: send email |
| `httpHeaderAuth` | `Webhook` — only if you use the webhook trigger |

The Sheets **trigger** takes a different credential type from the Sheets **nodes**. Your existing
Sheets credential will not appear in the trigger's dropdown; create a second one.

---

## 5. Configuration

```bash
cp workflows/ppw-intake-delivery/config.example.json \
   workflows/ppw-intake-delivery/config.local.json
```

Fill in your Google Sheet id — the long string in the sheet URL between `/d/` and `/edit` — and the
sub-workflow id from step 3. `config.local.json` is gitignored. Leave the credential entries `null`
unless you are scripting deployment against one known instance.

Then regenerate and re-import, or just edit the two ids directly in the n8n UI:

```bash
node workflows/ppw-intake-delivery/build-workflow.js
```

---

## 6. The spreadsheet

Point Tally at a Google Sheet, then add these columns to the **right of Tally's own**, in the header
row:

```
submission_id  timestamp  student_name  reg_number  project_title  programme
faculty  institution  supervisor  hod  study_location  study_duration
student_email  guideline_uploaded  status  output_link  citation_count
unverified_count  notes
```

All nineteen. If any are missing the Sheets nodes fail with `Column names were updated after the
node's setup`, and the error names only the subset written via expressions — the rest are missing
just as silently.

Rows are matched on `row_number`: Tally owns the sheet and writes the response row, and the workflow
fills in its own columns on that same row rather than keeping a second register to reconcile.

---

## 7. The form

Create a Tally form with these questions. The normaliser matches on **labels**, so the wording
matters more than the order:

| Question label | Type |
|---|---|
| Project Title | Text |
| Programme of Study | Text or dropdown |
| Faculty | Text |
| Institution | Text |
| Student Full Name | Text |
| Registration / Matriculation Number | Text |
| Supervisor's Name | Text |
| Head of Department (HOD) Name | Text |
| Study Location | Text |
| Study Duration | Text |
| Email | Email |
| Departmental Project Guideline | File upload, optional |

The first eight are required; a submission missing any of them is answered with a 400 naming exactly
which. See [examples/sample-input.md](examples/sample-input.md) for a filled-in submission.

### Choosing a trigger

- **Google Sheets trigger** — Tally writes to the sheet, n8n polls it. Outbound only, so it works on
  `localhost` with no tunnel. The simplest option, and the one to start with.
- **Webhook** — Tally posts directly to n8n. Needs the instance publicly reachable. Point Tally at
  `https://<your-host>/webhook/PPW` and set the `X-PPW-Token` header to match your `httpHeaderAuth`
  credential. Leave it authenticated: the path triggers a chain of paid model calls.

---

## 8. First run

1. Submit the form once.
2. In n8n, open the parent workflow and run it manually — a freshly imported webhook workflow needs
   one manual execution before it can be triggered live.
3. Check, in order: the spreadsheet row appears, the `.docx` reaches the student's inbox, the Drive
   link lands in `output_link`, and `status` reads complete.
4. Open the sub-workflow's last execution and read `citation_report`. **`violations` must be empty.**
   That is the number that says no reference was invented.
5. Assign an **Error Workflow** in the workflow's Settings — that one is UI-only, not settable over
   the API.

Only activate the workflows once a manual run has passed.

### If a long run appears to fail

Chains this long outlast some testing tools' timeouts, which report a failure while the execution is
still going. Check the execution list before believing it — and if you are driving the webhook
directly, allow for it:

```bash
curl -X POST http://localhost:5678/webhook/PPW \
  -H 'X-PPW-Token: <your token>' -d '{}' --max-time 600
```
