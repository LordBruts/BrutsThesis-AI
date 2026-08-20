// n8n Code node: "Clear Sheet Error"
// MODE: Run Once for All Items   LANGUAGE: JavaScript
//
// Sheet writes are bookkeeping, not the deliverable, so "Sheet · Record
// Submission" runs with onError: continueRegularOutput -- a spreadsheet problem
// must not cost the student their thesis.
//
// The catch is that n8n does not simply carry on. The item that node emits has
// the failure attached to it (json.error plus an item-level error object), and
// n8n forwards an already-flagged item straight to the ERROR output of the next
// node that has one. Observed on execution 147: the sheet write failed on
// missing columns, and "Download Guideline" then fetched the PDF perfectly --
// 2.29 MB of real binary -- yet still reported on its error branch, because the
// item was condemned before it ever arrived.
//
// Rebuilding the item from the normalizer discards both the flag and the
// wreckage of the json, so a failed write stays where it happened and is
// recorded, instead of derailing every node downstream of it.
const clean = $('Normalize Submission').first().json;
const incoming = $input.first().json || {};
const err = incoming.error;

return [
  {
    json: {
      ...clean,
      // '' when the write succeeded. Surfaced so the run can report a partial
      // success later rather than claiming the sheet is up to date.
      sheet_write_error: err ? String(err.message || err) : '',
    },
    // Single item, and downstream nodes resolve $('Normalize Submission').item
    // through the paired-item chain -- breaking it here would break them.
    pairedItem: { item: 0 },
  },
];
