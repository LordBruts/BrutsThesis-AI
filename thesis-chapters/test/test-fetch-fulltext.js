// Offline tests for fetch-fulltext.js against REAL Europe PMC full-text XML.
// Loads the exact n8n Code-node source and mocks this.helpers.httpRequest to
// serve the fixture files, so network is not required and results are stable.
//
//   node test/test-fetch-fulltext.js

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'fetch-fulltext.js'), 'utf8');
const FIX = path.join(__dirname, 'fixtures');

async function run(records, opts = {}) {
  const $input = { all: () => records.map((json) => ({ json })) };
  const ctx = {
    helpers: {
      httpRequest: async ({ url }) => {
        if (opts.fail) throw new Error('ECONNRESET simulated');
        const pmcid = url.match(/(PMC\d+)/)[1];
        const f = path.join(FIX, pmcid + '.xml');
        if (!fs.existsSync(f)) throw new Error('404 not found');
        return fs.readFileSync(f, 'utf8');
      },
    },
  };
  const fn = new Function('$input', `return (async function(){ ${SRC} }).call(this)`);
  const out = await fn.call(ctx, $input);
  return out.map((i) => i.json);
}

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { failures.push(name); console.log(`  FAIL ${name}${detail ? '  -> ' + String(detail).slice(0,200) : ''}`); }
}

(async () => {

console.log('\n== 1. research article: real methods + results extracted ==');
{
  const [r] = await run([{ ref_id: 'E01', pmcid: 'PMC12869448', oa: true }]);
  console.log('     status:', r.fulltext_status);
  console.log('     methods[0:220]:', JSON.stringify(r.methods_text.slice(0, 220)));
  console.log('     results[0:180]:', JSON.stringify(r.results_text.slice(0, 180)));
  check('status ok', r.fulltext_status.startsWith('ok:'), r.fulltext_status);
  check('methods non-trivial (>800 chars)', r.methods_text.length > 800, r.methods_text.length);
  check('results non-trivial (>800 chars)', r.results_text.length > 800, r.results_text.length);
  check('captured nested subsections (sampling)', /sampl/i.test(r.methods_text), 'no sampling text');
  check('captured study design', /design/i.test(r.methods_text));
  check('captured a real sample size', /\b10[0-9]\b/.test(r.methods_text + r.results_text));
  check('captured analysis software/stats', /(SAS|SPSS|Kruskal|Wilcoxon|chi)/i.test(r.methods_text + r.results_text));
  check('no XML tags leaked', !/<[a-z\/][^>]*>/i.test(r.methods_text + r.results_text));
  check('no bare xref citation numbers injected', !/\[\s*\d+\s*\]/.test(r.methods_text));
  check('entities decoded', !/&(amp|lt|gt|#x?\d+);/.test(r.methods_text + r.results_text));
  const both = r.methods_text + r.results_text;
  check('source-paper citations stripped', !/\([A-Z][A-Za-z]+(\s+(et al\.?|&\s*[A-Z][A-Za-z]+))?\s*,\s*((19|20)\d{2})?\s*\)/.test(both), both.match(/\([^)]{0,40}\)/g));
  check('no dangling "(Name, )" husks', !/,\s*\)/.test(both));
  check('numeric data in parens PRESERVED', /\(\s*n\s*=|\(\d|%\)/.test(both), 'lost numeric parentheticals');
}

console.log('\n== 2. case report: no methods section -> stays EMPTY, never invented ==');
{
  const [r] = await run([{ ref_id: 'E02', pmcid: 'PMC12906102', oa: true }]);
  console.log('     status:', r.fulltext_status);
  check('methods empty', r.methods_text === '', JSON.stringify(r.methods_text.slice(0,120)));
  check('results empty', r.results_text === '', JSON.stringify(r.results_text.slice(0,120)));
  check('status records the miss', r.fulltext_status === 'fetched_no_sections', r.fulltext_status);
}

console.log('\n== 3. two further real research articles ==');
{
  const rs = await run([
    { ref_id: 'E03', pmcid: 'PMC13107998', oa: true },
    { ref_id: 'E04', pmcid: 'PMC13238678', oa: true },
  ]);
  for (const r of rs) {
    console.log(`     ${r.pmcid} status=${r.fulltext_status} methods=${r.methods_text.length} results=${r.results_text.length}`);
    check(`${r.pmcid} extracted methods`, r.methods_text.length > 400, r.methods_text.length);
    check(`${r.pmcid} extracted results`, r.results_text.length > 400, r.results_text.length);
    check(`${r.pmcid} no tags leaked`, !/<[a-z\/][^>]*>/i.test(r.methods_text + r.results_text));
  }
}

console.log('\n== 4. non-OA records are skipped without a fetch ==');
{
  const [r] = await run([{ ref_id: 'E05', pmcid: null, oa: false }]);
  check('skipped cleanly', r.fulltext_status === 'not_open_access', r.fulltext_status);
  check('no fabricated text', r.methods_text === '' && r.results_text === '');
}

console.log('\n== 5. fetch failure degrades to empty, never throws ==');
{
  const [r] = await run([{ ref_id: 'E06', pmcid: 'PMC12869448', oa: true }], { fail: true });
  check('error captured in status', r.fulltext_status.startsWith('error:'), r.fulltext_status);
  check('no partial/fabricated text', r.methods_text === '' && r.results_text === '');
  check('record still returned', r.ref_id === 'E06');
}

console.log('\n== 6. original record fields are preserved ==');
{
  const [r] = await run([{ ref_id: 'E07', pmcid: 'PMC12869448', oa: true, title: 'Keep me', doi: '10.1/x', year: 2026 }]);
  check('title preserved', r.title === 'Keep me');
  check('doi preserved', r.doi === '10.1/x');
  check('year preserved', r.year === 2026);
  check('ref_id preserved', r.ref_id === 'E07');
}

console.log('\n== 7. batch ordering and count preserved ==');
{
  const input = ['PMC12869448','PMC12906102','PMC13107998','PMC13238678','PMC12869448','PMC13107998']
    .map((p, i) => ({ ref_id: 'E' + String(i+1).padStart(2,'0'), pmcid: p, oa: true }));
  const rs = await run(input);
  check('count preserved across batches', rs.length === 6, rs.length);
  check('order preserved', rs.map(r=>r.ref_id).join() === 'E01,E02,E03,E04,E05,E06', rs.map(r=>r.ref_id).join());
}

console.log(`\n${'='.repeat(58)}`);
if (failures.length) {
  console.log(`FAILED: ${failures.length} check(s) failed, ${pass} passed`);
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log(`ALL PASS: ${pass} checks`);

})();
