// Integration test: rank-candidates -> fetch-fulltext -> build-evidence-pack
// Uses real Europe PMC search fixtures and LIVE full-text fetches (free, no auth).
//   node test/test-evidence-pipeline.js

const fs = require('fs');
const path = require('path');
const https = require('https');

const load = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const FIX = path.join(__dirname, 'fixtures');

function get(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { Accept: 'application/xml' } }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => (r.statusCode === 200 ? res(d) : rej(new Error('HTTP ' + r.statusCode))));
    }).on('error', rej);
  });
}

(async () => {
  let pass = 0;
  const failures = [];
  const check = (n, c, d) => {
    if (c) { pass++; console.log(`  ok   ${n}`); }
    else { failures.push(n); console.log(`  FAIL ${n}${d !== undefined ? '  -> ' + String(d).slice(0,200) : ''}`); }
  };

  // -- stage 1 --------------------------------------------------------------
  const responses = ['search1.json','search2.json','search3.json'].map((f) =>
    JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'))
  );
  const ranked = new Function('$input','$', load('rank-candidates.js'))(
    { all: () => responses.map((json) => ({ json })) },
    (n) => ({ first: () => ({ json: { output: { year_floor: 2016 } } }) })
  ).map((i) => i.json);
  console.log(`\n== stage 1: ${ranked.length} ranked candidates ==`);

  // -- stage 2 (LIVE) -------------------------------------------------------
  console.log('\n== stage 2: fetching open-access full text (live) ==');
  const ctx = { helpers: { httpRequest: async ({ url }) => get(url) } };
  const withFt = (await new Function('$input', `return (async function(){ ${load('fetch-fulltext.js')} }).call(this)`)
    .call(ctx, { all: () => ranked.map((json) => ({ json })) })).map((i) => i.json);

  const statuses = {};
  withFt.forEach((r) => { const k = String(r.fulltext_status).split(':')[0]; statuses[k] = (statuses[k]||0)+1; });
  console.log('     status breakdown:', JSON.stringify(statuses));
  check('all records returned', withFt.length === ranked.length, `${withFt.length} vs ${ranked.length}`);
  check('at least 5 papers yielded methods or results',
    withFt.filter((r) => r.methods_text || r.results_text).length >= 5,
    withFt.filter((r) => r.methods_text || r.results_text).length);
  check('no record without full text got invented text',
    withFt.filter((r) => r.fulltext_status === 'not_open_access').every((r) => !r.methods_text && !r.results_text));

  // -- stage 3 --------------------------------------------------------------
  const packOut = new Function('$input', load('build-evidence-pack.js'))(
    { all: () => withFt.map((json) => ({ json })) }
  )[0].json;

  console.log('\n== stage 3: evidence pack ==');
  console.log('     stats:', JSON.stringify(packOut.stats));
  console.log('     empirical ref_ids:', packOut.empirical_ref_ids.join(', ') || '(none)');
  console.log('     brief_pack chars:', packOut.brief_pack.length, '| empirical_pack chars:', packOut.empirical_pack.length);

  check('evidence array preserved', packOut.evidence.length === withFt.length);
  check('brief pack non-empty', packOut.brief_pack.length > 2000, packOut.brief_pack.length);
  check('empirical studies found', packOut.empirical_ref_ids.length >= 3, packOut.empirical_ref_ids.length);
  check('every empirical study really has methods or results',
    packOut.empirical_ref_ids.every((id) => {
      const r = withFt.find((x) => x.ref_id === id);
      return (r.methods_text||'').length > 200 || (r.results_text||'').length > 200;
    }));
  check('empirical pack labels text as verbatim', packOut.empirical_pack.includes('verbatim from the paper'));
  check('empirical order is chronological descending', (() => {
    const ys = packOut.empirical_ref_ids.map((id) => withFt.find((x) => x.ref_id === id).year);
    return ys.every((y, i) => i === 0 || ys[i-1] >= y);
  })());
  check('every brief entry carries its ref_id',
    packOut.evidence.every((r) => packOut.brief_pack.includes(`[${r.ref_id}]`)));
  check('packs stay within a sane token budget',
    packOut.brief_pack.length + packOut.empirical_pack.length < 220000,
    packOut.brief_pack.length + packOut.empirical_pack.length);

  // -- stage 4: does the gate accept what the pack offers? -------------------
  console.log('\n== stage 4: gate accepts real ref_ids, rejects an invented one ==');
  const ids = packOut.evidence.slice(0, 4).map((r) => r.ref_id);
  const gate = new Function('$input','$', load('citation-gate.js'))(
    { first: () => ({ json: {
        ch1: `Background claim [${ids[0]}]. Combined finding [${ids[1]}, ${ids[2]}].`,
        ch2: `Empirical work [${ids[3]}]. Fabricated source [E97].`,
        ch3: '' } }) },
    (n) => ({ first: () => ({ json: { evidence: packOut.evidence } }) })
  )[0].json;

  console.log('     ch1 ->', gate.ch1);
  console.log('     refs built:', gate.references.length);
  console.log('     sample ref:', gate.references[0]);
  check('real markers resolved to citations', /\(\w[^)]*, ?\d{4}[a-z]?\)/.test(gate.ch1), gate.ch1);
  check('invented marker rejected',
    gate.citation_report.violations.some((v) => v.ref_id === 'E97'),
    JSON.stringify(gate.citation_report.violations));
  check('reference list matches cited count', gate.references.length === 4, gate.references.length);
  check('every reference has a resolvable link',
    gate.references.every((r) => /https:\/\/(doi\.org|pubmed)/.test(r)), gate.references.find(r=>!/https/.test(r)));

  console.log(`\n${'='.repeat(58)}`);
  if (failures.length) {
    console.log(`FAILED: ${failures.length} check(s), ${pass} passed`);
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log(`ALL PASS: ${pass} checks`);
})();
