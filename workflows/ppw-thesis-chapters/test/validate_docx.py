# Independently validates the generated .docx: real zip, intact CRCs,
# well-formed XML in every part, and the content that must be present.
import sys, zipfile, re
from xml.dom import minidom

DOCX = 'out.docx'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

npass, fails = 0, []
def check(name, cond, detail=''):
    global npass
    if cond:
        npass += 1; print('  ok   ' + name)
    else:
        fails.append(name); print('  FAIL ' + name + (('  -> ' + str(detail)[:220]) if detail else ''))

print('\n== zip integrity ==')
z = zipfile.ZipFile(DOCX)
bad = z.testzip()
check('zip opens and all CRCs valid', bad is None, bad)

names = z.namelist()
expected = ['[Content_Types].xml','_rels/.rels','word/_rels/document.xml.rels','word/document.xml',
            'word/styles.xml','word/settings.xml','word/numbering.xml','word/footer1.xml','word/footer2.xml']
for e in expected:
    check('part present: ' + e, e in names)
check('no unexpected parts', set(names) == set(expected), set(names) ^ set(expected))

print('\n== XML well-formedness (every part) ==')
parts = {}
for n in names:
    raw = z.read(n)
    try:
        minidom.parseString(raw); ok = True; err = ''
    except Exception as ex:
        ok = False; err = str(ex)
    check('parses as XML: ' + n, ok, err)
    parts[n] = raw.decode('utf-8')

doc = parts['word/document.xml']

print('\n== document structure ==')
d = minidom.parseString(doc.encode('utf-8'))
paras = d.getElementsByTagNameNS(W, 'p')
check('paragraphs present', len(paras) > 60, len(paras))
sectPrs = d.getElementsByTagNameNS(W, 'sectPr')
check('exactly two sections (roman + arabic)', len(sectPrs) == 2, len(sectPrs))
nums = d.getElementsByTagNameNS(W, 'pgNumType')
fmts = [n.getAttributeNS(W, 'fmt') for n in nums]
check('roman then decimal numbering', fmts == ['lowerRoman', 'decimal'], fmts)

def text_of(xml):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', xml))
body = ' '.join((n.firstChild.nodeValue or '') for n in d.getElementsByTagNameNS(W, 't') if n.firstChild)

print('\n== required content ==')
for label, needle in [
    ('cover: project title',        'ASSESSMENT OF RADIOGRAPHY STUDENTS'),
    ('cover: institution',          'BAYERO UNIVERSITY, KANO'),
    ('cover: department, not degree','DEPARTMENT OF RADIOGRAPHY'),
    ('title page: degree award',    'AWARD OF'),
    ('title page: student name',    'AISHA MOHAMMED BELLO'),
    ('title page: reg number',      'BUK/17/RAD/1234'),
    ('certification page',          'CERTIFICATION'),
    ('approval page',               'APPROVAL PAGE'),
    ('dedication',                  'DEDICATION'),
    ('acknowledgement',             'ACKNOWLEDGEMENT'),
    ('table of contents',           'TABLE OF CONTENTS'),
    ('list of tables',              'LIST OF TABLES'),
    ('list of figures',             'LIST OF FIGURES'),
    ('list of abbreviations',       'LIST OF ABBREVIATIONS'),
    ('abstract',                    'ABSTRACT'),
    ('CHAPTER ONE present',         'CHAPTER ONE'),
    ('CHAPTER TWO present',         'CHAPTER TWO'),
    ('CHAPTER THREE present',       'CHAPTER THREE'),
    ('references heading',          'REFERENCES'),
    ('ch1 body text',               'Computed Tomography'),
    ('ch2 body text',               'This chapter reviews the literature'),
    ('ch3 body text',               'descriptive cross-sectional design will be adopted'),
    ('reference entry rendered',    'BMC Medical Education'),
    ('extracted abbreviation CT',   'Computed Tomography'),
    ('extracted table caption',     'Distribution of respondents'),
    ('extracted figure caption',    'Conceptual framework'),
]:
    check(label, needle in body, body[:120])

print('\n== regression guards ==')
check('NO hardcoded IVU fallback title leaked from old generator',
      'JUSTIFICATION CRITERIA FOR INTRAVENOUS UROGRAPHY (IVU) USING CONVENTIONAL X-RAYS VERSUS CT IMAGING' not in body.replace(
          'ASSESSMENT OF RADIOGRAPHY STUDENTS\u2019 KNOWLEDGE ON JUSTIFICATION CRITERIA FOR INTRAVENOUS UROGRAPHY (IVU) USING CONVENTIONAL X-RAYS VERSUS CT IMAGING',''),
      'stale hardcoded cover title present')
check('no unresolved [Exx] markers', not re.search(r'\[E\d+\]', body), re.findall(r'\[E\d+\]', body)[:5])
check('no raw markdown headings left', '##' not in body, [l for l in body.split() if l.startswith('##')][:5])
check('XML entities escaped, not doubled', '&amp;amp;' not in doc)
check('NO double-prefixed degree', 'BACHELOR OF SCIENCE IN BACHELOR' not in body.upper())
check('NO "DEPARTMENT OF BACHELOR"', 'DEPARTMENT OF BACHELOR' not in body.upper())
check('ampersand preserved as text', 'R&D' in body)
check('angle brackets survived escaping', '5 < 10' in body and '10 > 5' in body)

print('\n== formatting ==')
check('hanging indent on references', 'w:hanging="720"' in doc)
check('double spacing in chapters', 'w:line="480"' in doc)
check('1.5 spacing in prelims', 'w:line="360"' in doc)
check('left margin 1.5in = 2160 twips', 'w:left="2160"' in doc)
check('A4 page size', 'w:w="11906"' in doc and 'w:h="16838"' in doc)
check('Times New Roman set', 'Times New Roman' in parts['word/styles.xml'])
check('12pt = 24 half-points', 'w:sz w:val="24"' in parts['word/styles.xml'])
check('heading styles declared', all(h in parts['word/styles.xml'] for h in ['Heading1','Heading2','Heading3']))
check('italic runs present (journal titles)', '<w:i/>' in doc)
check('bold runs present', '<w:b/>' in doc)
check('TOC field present', 'TOC \o' in doc)
check('PAGE field in footer', 'PAGE' in parts['word/footer1.xml'])
check('bullet numbering wired', 'w:numId w:val="1"' in doc and 'abstractNumId' in parts['word/numbering.xml'])
check('updateFields set so ToC refreshes on open', 'updateFields' in parts['word/settings.xml'])

print('\n' + '=' * 58)
if fails:
    print('FAILED: %d check(s), %d passed' % (len(fails), npass))
    for f in fails: print('  - ' + f)
    sys.exit(1)
print('ALL PASS: %d checks' % npass)
