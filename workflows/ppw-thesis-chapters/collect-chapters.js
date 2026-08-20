// n8n Code node: "Collect Chapters"
// MODE: Run Once for All Items   LANGUAGE: JavaScript
//
// Gathers the three finished chapters into one item so the consistency checker
// can see them together and the correction/gate steps have a single source.
//
// Chapters are kept as SEPARATE NAMED FIELDS from here to the DOCX. The original
// workflow concatenated everything into one string and then tried to find the
// boundaries again with regex, which is why Chapter One disappeared.

const ch1 = $('A3 Chapter 1 Writer').first().json.output || '';
const ch2 = $('A4d Chapter 2 Assembler').first().json.output || '';
const ch3 = $('A5 Chapter 3 Writer').first().json.output || '';

const strip = (s) =>
  String(s)
    .replace(/^\s*```[a-z]*\s*\n?/i, '')   // stray code fences
    .replace(/\n?```\s*$/i, '')
    .trim();

const out = { ch1: strip(ch1), ch2: strip(ch2), ch3: strip(ch3) };

const empty = Object.keys(out).filter((k) => out[k].length < 200);
if (empty.length) {
  throw new Error(
    'Chapter(s) missing or too short: ' + empty.join(', ') +
    '. Refusing to assemble a partial thesis -- this is the failure the old workflow shipped silently.'
  );
}

return [{ json: out }];
