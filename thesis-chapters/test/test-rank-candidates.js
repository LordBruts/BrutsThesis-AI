// Offline tests for rank-candidates.js against 75 REAL Europe PMC records.
//   node test/test-rank-candidates.js

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'rank-candidates.js'), 'utf8');
const FIX = path.join(__dirname, 'fixtures');

function run(responses, yearFloor) {
  const $input = { all: () => responses.map((json) => ({ json })) };
  const $ = (n) => {
    // The REAL shape: an agent with a structured output parser nests its
    // parsed object under 'output'. The old fixture put year_floor at the top
    // level, which is why this suite passed while production read undefined.
    if (n === 'A0 Query Planner') return { first: () => ({ json: { output: { year_floor: yearFloor } } }) };
    throw new Error('unexpected node ' + n);
  };
  return new Function('$input', '$', SRC)($input, $).map((i) => i.json);
}

const responses = ['search1.json', 'search2.json', 'search3.json'].map((f) =>
  JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'))
);

let pass = 0;
const failures = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { failures.push(name); console.log(`  FAIL ${name}${detail !== undefined ? '  -> ' + String(detail).slice(0,200) : ''}`); }
};

console.log('\n== 1. normalisation against real records ==');
const out = run(responses, 2016);
console.log(`     ${out.length} candidates from 75 raw records`);
console.log('     top 3:');
out.slice(0, 3).forEach((r) =>
  console.log(`       ${r.ref_id} score=${r.rank_score} ${r.year} oa=${r.oa} cites=${r.cited_by} :: ${r.title.slice(0, 62)}`)
);

check('produced candidates', out.length > 0, out.length);
check('capped at 30', out.length <= 30, out.length);
check('every record has a ref_id', out.every((r) => /^E\d{2}$/.test(r.ref_id)));
check('ref_ids sequential from E01', out[0].ref_id === 'E01' && out[out.length-1].ref_id === 'E' + String(out.length).padStart(2,'0'));
check('every record has an abstract', out.every((r) => r.abstract && r.abstract.length > 20));
check('every record has a title', out.every((r) => r.title && r.title.length > 5));
check('every record has a year', out.every((r) => Number.isInteger(r.year)));
check('every record has authors', out.every((r) => Array.isArray(r.authors) && r.authors.length > 0));
check('authors carry surnames', out.every((r) => r.authors.some((a) => a.lastName || a.fullName)));
check('journal captured where present', out.filter((r) => r.journal).length >= out.length * 0.9);
check('no HTML left in abstracts', out.every((r) => !/<[a-z\/][^>]*>/i.test(r.abstract)));

console.log('\n== 2. year floor is enforced ==');
check('nothing older than floor', out.every((r) => r.year >= 2016), out.map(r=>r.year).filter(y=>y<2016));
const strict = run(responses, 2024);
check('raising floor to 2024 shrinks/holds set', strict.length <= out.length, `${strict.length} vs ${out.length}`);
check('strict set respects 2024', strict.every((r) => r.year >= 2024), strict.map(r=>r.year).filter(y=>y<2024));

console.log('\n== 3. deduplication ==');
const dup = run([...responses, ...responses], 2016);
check('duplicate feed does not duplicate records', dup.length === out.length, `${dup.length} vs ${out.length}`);
const keys = out.map((r) => r.doi || r.pmid || r.title.toLowerCase());
check('no duplicate doi/pmid in output', new Set(keys).size === keys.length);

console.log('\n== 4. ranking prefers usable evidence ==');
check('scores descend', out.every((r, i) => i === 0 || out[i-1].rank_score >= r.rank_score));
const topTen = out.slice(0, 10);
const oaTop = topTen.filter((r) => r.oa).length / topTen.length;
const oaAll = out.filter((r) => r.oa).length / out.length;
check('ranking lifts OA above baseline', oaTop >= oaAll, `top10 ${(oaTop*100).toFixed(0)}% vs overall ${(oaAll*100).toFixed(0)}%`);
check('research articles favoured', topTen.filter((r) => r.pub_types.includes('research-article')).length >= 5, topTen.filter(r=>r.pub_types.includes('research-article')).length);
check('OA records carry a pmcid for full text', out.filter((r) => r.oa).every((r) => !!r.pmcid));

console.log('\n== 5. records with no abstract are rejected ==');
{
  const fake = { resultList: { result: [
    { id:'X1', title:'No abstract here', pubYear:'2024', authorList:{author:[{lastName:'A',initials:'B'}]}, pmid:'1' },
    { id:'X2', title:'Has abstract', abstractText:'Something substantive about the study design.', pubYear:'2024', authorList:{author:[{lastName:'C',initials:'D'}]}, pmid:'2' },
  ] } };
  const r = run([fake], 2016);
  check('abstract-less record dropped', r.length === 1 && r[0].title === 'Has abstract', JSON.stringify(r.map(x=>x.title)));
}

console.log('\n== 6. retractions and editorials excluded ==');
{
  const fake = { resultList: { result: [
    { id:'R1', title:'Retracted work', abstractText:'x'.repeat(60), pubYear:'2024', pmid:'10', authorList:{author:[{lastName:'A'}]}, pubTypeList:{pubType:['Retracted Publication']} },
    { id:'R2', title:'An editorial', abstractText:'x'.repeat(60), pubYear:'2024', pmid:'11', authorList:{author:[{lastName:'B'}]}, pubTypeList:{pubType:['Editorial']} },
    { id:'R3', title:'Good study', abstractText:'x'.repeat(60), pubYear:'2024', pmid:'12', authorList:{author:[{lastName:'C'}]}, pubTypeList:{pubType:['research-article']} },
  ] } };
  const r = run([fake], 2016);
  check('only the good study survives', r.length === 1 && r[0].title === 'Good study', JSON.stringify(r.map(x=>x.title)));
}

console.log('\n== 7. empty / malformed input does not throw ==');
check('empty input ok', run([], 2016).length === 0);
check('missing resultList ok', run([{}], 2016).length === 0);
check('null result array ok', run([{ resultList: {} }], 2016).length === 0);

console.log(`\n${'='.repeat(58)}`);
if (failures.length) {
  console.log(`FAILED: ${failures.length} check(s) failed, ${pass} passed`);
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log(`ALL PASS: ${pass} checks`);
