# Sample Input

A submission as it arrives from the Tally form. The normaliser matches on the **label** in the left
column, not on position — reordering the form does not shift anything.

| Question label | Example value |
|---|---|
| Project Title | Assessment of Radiography Students' Knowledge on Justification Criteria for Intravenous Urography (IVU) Using Conventional X-rays Versus CT Imaging |
| Programme of Study | Bachelor of Radiography |
| Faculty | Faculty of Allied Health Sciences |
| Institution | Sample University |
| Student Full Name | Jane Doe |
| Registration / Matriculation Number | RAD/20/00123 |
| Supervisor's Name | Dr. John Smith |
| Head of Department (HOD) Name | Prof. Mary Johnson |
| Study Location | Sample City |
| Study Duration | 8 months |
| Email | jane.doe@example.com |
| Departmental Project Guideline | Project-Manual.pdf *(optional)* |

The first eight are required. A submission missing any of them is answered with a 400 naming exactly
which — no partial thesis is generated.

---

## What the normaliser derives

Two fields are computed rather than collected, because the document needs the programme in two
different grammatical positions:

| Derived | From the example above |
|---|---|
| `department` | `Radiography` → cover page reads **DEPARTMENT OF RADIOGRAPHY** |
| `degree` | `Bachelor of Radiography` → title page reads **…FOR THE AWARD OF BACHELOR OF RADIOGRAPHY** |

Deriving one from the other naively gives either *"Bachelor of Science in Bachelor of Radiography"*
or *"DEPARTMENT OF BACHELOR OF RADIOGRAPHY"*, so they are computed separately. A programme entered
as a plain department name — "Medical Radiography" — is left alone and given a degree title.

---

## A note on choice fields

For dropdowns, multiple choice, checkboxes and ranking, Tally does **not** send the selected text.
It sends option UUIDs plus a separate `options` array:

```json
{
  "label": "Programme of Study",
  "type": "DROPDOWN",
  "value": ["e7bfbbc6-c2e6-4a1f-9f3e-2b8d1c4a5e90"],
  "options": [
    { "id": "e7bfbbc6-c2e6-4a1f-9f3e-2b8d1c4a5e90", "text": "Medical Radiography" }
  ]
}
```

Taking `value` at face value writes a UUID into the thesis. It is resolved against `options` before
use. File uploads instead arrive as an array of objects carrying a `url`.

---

## Data source

Tally collects the submission and either posts it to the n8n webhook or writes it to a Google Sheet
that n8n polls. Both routes reach the same normaliser.
