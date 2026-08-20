// Offline unit tests for citation-gate.js
//
// Loads the EXACT n8n Code-node source and executes it with mocked n8n globals,
// so there is no drift between what is tested here and what runs in the node.
//
//   node test/test-citation-gate.js

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'citation-gate.js'), 'utf8');

function runGate(chapters, evidence) {
  const $input = { first: () => ({ json: chapters }) };
  const $ = (nodeName) => {
    if (nodeName === 'Build Evidence Pack') {
      return { first: () => ({ json: { evidence } }) };
    }
    throw new Error(`unexpected $('${nodeName}')`);
  };
  // Top-level `return` is legal inside a Function body.
  const fn = new Function('$input', '$', SRC);
  return fn($input, $)[0].json;
}

// ------------------------------------------------------------- fixtures ----
const REC = (over) =>
  Object.assign(
    {
      ref_id: 'E01',
      authors: [{ lastName: 'Smith', initials: 'AB' }],
      year: 2021,
      title: 'A study of something important',
      journal: 'Journal of Radiography',
      volume: '12',
      issue: '3',
      pages: '45-52',
      doi: '10.1000/abc123',
      pmid: '11111111',
      pub_types: ['research-article'],
      abstract: 'x',
      methods_text: 'y',
      results_text: 'z',
    },
    over
  );

// ---------------------------------------------------------------- runner ----
let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? '  -> ' + detail : ''}`);
  }
}

console.log('\n== 1. happy path: markers become citations ==');
{
  const pack = [
    REC({ ref_id: 'E01' }),
    REC({
      ref_id: 'E02',
      authors: [
        { lastName: 'Jones', initials: 'C' },
        { lastName: 'Patel', initials: 'D' },
      ],
      year: 2019,
      title: 'Two author paper',
    }),
    REC({
      ref_id: 'E03',
      authors: [
        { lastName: 'Okoro', initials: 'E' },
        { lastName: 'Bello', initials: 'F' },
        { lastName: 'Yusuf', initials: 'G' },
      ],
      year: 2020,
      title: 'Three author paper',
    }),
  ];
  const r = runGate(
    { ch1: 'One author [E01]. Two authors [E02]. Three authors [E03].', ch2: '', ch3: '' },
    pack
  );
  check('single author -> (Smith, 2021)', r.ch1.includes('(Smith, 2021)'), r.ch1);
  check('two authors -> (Jones & Patel, 2019)', r.ch1.includes('(Jones & Patel, 2019)'), r.ch1);
  check('three authors -> (Okoro et al., 2020)', r.ch1.includes('(Okoro et al., 2020)'), r.ch1);
  check('no markers survive', !/\[E\d+\]/.test(r.ch1), r.ch1);
  check('3 references built', r.references.length === 3, JSON.stringify(r.references));
  check('report passes', r.citation_report.passed === true, JSON.stringify(r.citation_report));
}

console.log('\n== 2. THE CRITICAL TEST: invented marker is caught ==');
{
  const r = runGate(
    { ch1: 'Real source [E01]. Invented source [E99]. More text.', ch2: '', ch3: '' },
    [REC({ ref_id: 'E01' })]
  );
  const v = r.citation_report.violations.filter((x) => x.type === 'UNKNOWN_REF_ID');
  check('violation raised for [E99]', v.length === 1, JSON.stringify(r.citation_report.violations));
  check('violation names the bad id', v[0] && v[0].ref_id === 'E99');
  check('report marked failed', r.citation_report.passed === false);
  check('bad marker stripped from text', !r.ch1.includes('E99'), r.ch1);
  check('only the real ref is listed', r.references.length === 1, JSON.stringify(r.references));
}

console.log('\n== 3. model writing its own author-year citation is caught ==');
{
  const r = runGate(
    {
      ch1: 'Prior work (Adeyemi et al., 2018) reported gains. Verified claim [E01].',
      ch2: 'Another one (Bello & Musa, 2020).',
      ch3: '',
    },
    [REC({ ref_id: 'E01' })]
  );
  const v = r.citation_report.violations.filter((x) => x.type === 'FREETEXT_CITATION');
  check('two free-text citations flagged', v.length === 2, JSON.stringify(v));
  check('flagged in the right chapters', v[0].chapter === 'ch1' && v[1].chapter === 'ch2');
  check('report marked failed', r.citation_report.passed === false);
}

console.log('\n== 4. uncited pack entries are dropped from references ==');
{
  const r = runGate({ ch1: 'Only cites [E01].', ch2: '', ch3: '' }, [
    REC({ ref_id: 'E01' }),
    REC({ ref_id: 'E02', authors: [{ lastName: 'Zulu', initials: 'Z' }], title: 'Never cited' }),
  ]);
  check('one reference only', r.references.length === 1, JSON.stringify(r.references));
  check('uncited id reported', r.citation_report.uncited_refs.join() === 'E02');
  check('uncited work absent from list', !r.references.join(' ').includes('Never cited'));
  check('no violation for merely-uncited', r.citation_report.passed === true);
}

console.log('\n== 5. same author + year disambiguated (2021a / 2021b) ==');
{
  const r = runGate({ ch1: 'First [E01]. Second [E02].', ch2: '', ch3: '' }, [
    REC({ ref_id: 'E01', title: 'Alpha paper' }),
    REC({ ref_id: 'E02', title: 'Beta paper' }),
  ]);
  check('in-text 2021a present', r.ch1.includes('(Smith, 2021a)'), r.ch1);
  check('in-text 2021b present', r.ch1.includes('(Smith, 2021b)'), r.ch1);
  check(
    'reference list carries suffixes',
    r.references.some((x) => x.includes('(2021a)')) && r.references.some((x) => x.includes('(2021b)')),
    JSON.stringify(r.references)
  );
}

console.log('\n== 6. grouped markers collapse into one parenthetical ==');
{
  const r = runGate({ ch1: 'Several studies [E01, E02] agree. Adjacent [E01][E02] too.', ch2: '', ch3: '' }, [
    REC({ ref_id: 'E01' }),
    REC({ ref_id: 'E02', authors: [{ lastName: 'Jones', initials: 'C' }], year: 2019, title: 'Other' }),
  ]);
  check('comma group -> semicolon parenthetical', r.ch1.includes('(Smith, 2021; Jones, 2019)'), r.ch1);
  check('adjacent group also collapses', (r.ch1.match(/\(Smith, 2021; Jones, 2019\)/g) || []).length === 2, r.ch1);
}

console.log('\n== 7. APA 7 reference string is well formed ==');
{
  const r = runGate({ ch1: '[E01]', ch2: '', ch3: '' }, [
    REC({
      ref_id: 'E01',
      authors: [
        { lastName: 'Duarsa', initials: 'GWK' },
        { lastName: 'Putri', initials: 'NLSA' },
      ],
      year: 2026,
      title: 'Bilateral ureteric obstruction following IVU',
      journal: 'Urology Case Reports',
      volume: '58',
      issue: null,
      pages: '103358',
      doi: '10.1016/j.eucr.2026.103358',
    }),
  ]);
  const ref = r.references[0];
  console.log('     ' + ref);
  check('initials spaced with dots', ref.includes('Duarsa, G. W. K.'), ref);
  check('ampersand before final author', ref.includes('& Putri, N. L. S. A.'), ref);
  check('year in parentheses', ref.includes('(2026).'), ref);
  check('acronym IVU preserved', ref.includes('IVU'), ref);
  check('journal italicised for DOCX', ref.includes('*Urology Case Reports*'), ref);
  check('volume italicised', ref.includes('*58*'), ref);
  check('no empty issue parens', !ref.includes('()'), ref);
  check('doi as https link', ref.includes('https://doi.org/10.1016/j.eucr.2026.103358'), ref);
}

console.log('\n== 8. references sorted alphabetically by first author ==');
{
  const r = runGate({ ch1: '[E01][E02][E03]', ch2: '', ch3: '' }, [
    REC({ ref_id: 'E01', authors: [{ lastName: 'Zulu', initials: 'Z' }], title: 'Z paper' }),
    REC({ ref_id: 'E02', authors: [{ lastName: 'Adeyemi', initials: 'A' }], title: 'A paper' }),
    REC({ ref_id: 'E03', authors: [{ lastName: 'Mensah', initials: 'M' }], title: 'M paper' }),
  ]);
  const surnames = r.references.map((x) => x.split(',')[0]);
  check('sorted A-Z', surnames.join() === 'Adeyemi,Mensah,Zulu', surnames.join());
}

console.log('\n== 9. edge cases do not throw ==');
{
  const r = runGate({ ch1: '', ch2: '', ch3: '' }, []);
  check('empty input survives', r.references.length === 0 && r.citation_report.passed === true);

  const r2 = runGate({ ch1: 'No year [E01].', ch2: '', ch3: '' }, [
    REC({ ref_id: 'E01', year: null, doi: null, pmid: '99999', journal: null, volume: null, pages: null }),
  ]);
  check('missing year -> n.d.', r2.ch1.includes('n.d.'), r2.ch1);
  check('falls back to pubmed url', r2.references[0].includes('pubmed.ncbi.nlm.nih.gov/99999'), r2.references[0]);
}

// ---------------------------------------------------------------- result ----
console.log(`\n${'='.repeat(58)}`);
if (failures.length) {
  console.log(`FAILED: ${failures.length} check(s) failed, ${pass} passed`);
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log(`ALL PASS: ${pass} checks`);
