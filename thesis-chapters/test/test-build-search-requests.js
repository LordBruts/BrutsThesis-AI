// Offline tests for build-search-requests.js.
//   node test/test-build-search-requests.js
//
// This suite exists because of sub-execution 149. "A0 Query Planner" returned
// ten well-formed queries and the node threw "Query planner returned no usable
// search queries" anyway -- it was reading $json.queries while an agent with a
// structured output parser publishes $json.output.queries. The bug survived
// because the earlier fixtures fed the top-level shape, so the tests agreed
// with the code and both were wrong about the live payload. Case 1 below is
// that exact payload, copied from the execution.

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'build-search-requests.js'), 'utf8');
const run = (json) => new Function('$input', SRC)({ first: () => ({ json }) });

let pass = 0;
const failures = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { failures.push(name); console.log(`  FAIL ${name}${detail !== undefined ? '  -> ' + String(detail).slice(0, 200) : ''}`); }
};
const throws = (json) => {
  try { run(json); return null; } catch (e) { return e.message; }
};

// The verbatim payload from sub-execution 149.
const LIVE = {
  output: {
    queries: [
      'malnutrition management children under five',
      'mothers perception malnutrition treatment',
      'maternal involvement child malnutrition',
      'caregiver role malnutrition management children',
      'severe acute malnutrition management children',
      'childhood malnutrition Nigeria Lagos',
      'maternal knowledge malnutrition feeding practices',
      'community management acute malnutrition children',
      'perceived barriers malnutrition treatment mothers',
      'malnutrition intervention children 0 5 years',
    ],
    year_floor: 2016,
  },
};

console.log('\n== 1. the live agent shape (regression: sub-execution 149) ==');
const live = run(LIVE);
check('does not throw on the real planner payload', Array.isArray(live), live);
check('emits one item per query', live.length === 10, live.length);
check('first query survives intact',
  live[0].json.query === 'malnutrition management children under five', live[0].json.query);
check('every item is { json: { query } }',
  live.every((i) => i.json && typeof i.json.query === 'string' && Object.keys(i.json).length === 1));

console.log('\n== 2. top-level fallback still works (pinned data, no parser) ==');
const flat = run({ queries: ['one two three', 'four five six'], year_floor: 2016 });
check('accepts queries at the top level', flat.length === 2, flat.length);
check('top-level content preserved', flat[1].json.query === 'four five six', flat[1].json.query);

console.log('\n== 3. cleaning and dedupe ==');
const messy = run({ output: { queries: [
  '  spaced   out   query  ', 'spaced out query', 'SPACED OUT QUERY',
  'ab', '', null, undefined, 'genuine second query',
] } });
check('collapses internal whitespace', messy[0].json.query === 'spaced out query', messy[0].json.query);
check('dedupes case-insensitively after normalising', messy.length === 2, messy.map((i) => i.json.query));
check('drops queries shorter than 3 chars and empties',
  !messy.some((i) => i.json.query === 'ab' || !i.json.query));

console.log('\n== 4. fan-out cap ==');
const many = run({ output: { queries: Array.from({ length: 25 }, (_, i) => `distinct query number ${i}`) } });
check('caps the fan-out at 10', many.length === 10, many.length);

console.log('\n== 5. the guard still fires when it genuinely should ==');
check('throws on an empty query array', /no usable search queries/.test(throws({ output: { queries: [] } }) || ''));
check('throws when queries is missing', /no usable search queries/.test(throws({ output: { year_floor: 2016 } }) || ''));
check('throws when queries is not an array', /no usable search queries/.test(throws({ output: { queries: 'a, b' } }) || ''));
check('throws on an empty payload', /no usable search queries/.test(throws({}) || ''));
check('throws when every query is unusable', /no usable search queries/.test(throws({ output: { queries: ['', 'ab', null] } }) || ''));

console.log('\n== 6. output is not mistaken for a query source when it is a string ==');
const stringOutput = throws({ output: 'some prose the model wrote', queries: undefined });
check('a string output does not crash, it trips the guard',
  /no usable search queries/.test(stringOutput || ''), stringOutput);

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
