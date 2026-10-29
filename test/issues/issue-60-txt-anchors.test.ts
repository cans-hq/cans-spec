/**
 * Issue #60 unit tests — the plain-text section-heading vocabulary
 * (src/core/text-anchors.ts), independent of the ref engine, plus one
 * integration-preview pin of the §12 anchorMatches contract the #60 wiring
 * (checkArtifactAnchor in src/core/refs.ts) depends on: extractTextHeadings
 * returns RAW heading texts, and `CREATION FLOW` ↔ `creation-flow` resolves
 * through the existing normalization — exactly the extractYamlKeys pattern.
 *
 * The module under test is hand-rolled and dependency-free (repo law: zero
 * runtime deps on BOTH runtimes): one forward scan, three mutually-exclusive
 * recognition rules (underlined/setext, ALL-CAPS section lines, ATX), every
 * guard pinned below. Over-extraction is fail-safe (a false heading can only
 * turn a would-be miss into a hit) — but precision still matters, so the
 * prose/sentence/box guards are pinned as negatives, not assumed.
 *
 * Test map:
 *   s1-s8   underlined (setext-style): `=` and `-` forms; ≥ 3 chars required;
 *           blank-line-then-`---` is a SEPARATOR, non-blank-then-`---` is an
 *           underline (decided; holds for `=` runs too); whitespace around
 *           text and underline; pure `=`/`-` runs never heading text (borders,
 *           stacked underlines); consecutive pairs; `=-=` is not an underline;
 *           blank line between text and underline breaks the pair
 *   c1-c9   ALL-CAPS section lines: the issue's literal CREATION FLOW /
 *           DIRECTORY TREE examples; mixed-case prose; sentence punctuation
 *           (. , ; ! ? :); ASCII-art boxes (`|`, `+`, `--` runs); 8-vs-9 word
 *           boundary; 72-vs-73 char boundary; blank-line/file-start
 *           predecessor (underline and prose lines count as NON-blank
 *           predecessors); letter/case edges (digits-only, lone `-`/`=`,
 *           accented caps, lowercase); `#nospace` not a heading
 *   a1-a5   ATX: levels 1–6; 7 `#`s / `#nospace` / bare `#` / empty text all
 *           rejected; closing `#`s kept verbatim; indented ATX + trailing
 *           whitespace; ATX beats an underline below (`# Title\n====` → Title)
 *   g1-g5   document-level: CRLF ≡ LF over all three forms; empty/blank/
 *           separator-only sources; duplicates preserved in order; trailing
 *           newline irrelevant; the issue's realistic data-flow.txt composite
 *   t1-t2   isTextArtifact truth table (.txt/.text/.TXT/.Text/.TEXT true;
 *           .md/.yaml/.json/no-extension/.textile/trailing-slash false)
 *   i1-i2   integration preview (read-only import of refs.ts):
 *           anchorMatches('CREATION FLOW', 'creation-flow') === true and the
 *           §12 folding boundary; the extracted vocabulary resolves the
 *           issue's anchors end-to-end
 */
import { describe, test, expect } from '../testing.ts';

import { extractTextHeadings, isTextArtifact } from '../../src/core/text-anchors.ts';
import { anchorMatches } from '../../src/core/refs.ts';

// ── Rule 1: underlined (setext-style) headings ──

describe('issue #60: extractTextHeadings — underlined (setext-style) headings', () => {
  test('s1: `=` and `-` underlines both mint headings, in document order', () => {
    const src = 'DATA FLOW\n=================\n\nOverview\n------------------\n';
    expect(extractTextHeadings(src)).toEqual(['DATA FLOW', 'Overview']);
  });

  test('s2: the underline needs ≥ 3 chars — `==` is not one', () => {
    // Title One survives no rule (mixed case), so nothing is extracted.
    expect(extractTextHeadings('Title One\n==\n')).toEqual([]);
  });

  test('s3: blank-line-then-`---` is a separator; non-blank-then-`---` is an underline', () => {
    // The `---` below a BLANK line decorates nothing (decided: markdown's
    // own reading — and `=` runs after a blank line behave identically).
    expect(extractTextHeadings('Intro prose\n\n---\n\nNEXT SECTION\n')).toEqual(['NEXT SECTION']);
    expect(extractTextHeadings('Intro\n\n====\n')).toEqual([]);
    // The issue's dash-underlined form: non-blank line above the `---` run.
    expect(extractTextHeadings('CREATION FLOW\n--------------\n')).toEqual(['CREATION FLOW']);
  });

  test('s4: whitespace around the text and the underline is tolerated/trimmed', () => {
    expect(extractTextHeadings('   Trimmed Heading   \n   ========   \n')).toEqual(['Trimmed Heading']);
    expect(extractTextHeadings('   Trimmed Heading   \n------   \n')).toEqual(['Trimmed Heading']);
    expect(extractTextHeadings('CREATION FLOW   \n')).toEqual(['CREATION FLOW']);
  });

  test('s5: pure `=`/`-` runs are never heading text (borders, stacked underlines)', () => {
    expect(extractTextHeadings('--------\n--------\n')).toEqual([]);
    // ATX wins the `#`-led line; BOTH stacked underlines are consumed as
    // decoration — one heading, not three.
    expect(extractTextHeadings('# Title\n========\n========\n')).toEqual(['Title']);
  });

  test('s6: consecutive setext pairs each mint one heading', () => {
    expect(extractTextHeadings('One\n===\nTwo\n---\n')).toEqual(['One', 'Two']);
  });

  test('s7: a mixed `=-=` line is not an underline', () => {
    expect(extractTextHeadings('Title One\n=-=\n')).toEqual([]);
  });

  test('s8: a blank line between text and underline breaks the pair', () => {
    // `Title One` is not immediately followed by the `====` run, and its
    // mixed case keeps rule 2 from claiming it; the orphan `====` is a
    // pure run, never text.
    expect(extractTextHeadings('Title One\n\n========\n')).toEqual([]);
  });
});

// ── Rule 2: ALL-CAPS section lines ──

describe('issue #60: extractTextHeadings — ALL-CAPS section lines', () => {
  test('c1: the issue\'s literal CREATION FLOW / DIRECTORY TREE examples', () => {
    const src = [
      'The artifact describes the pipeline.',
      '',
      'CREATION FLOW',
      '',
      'Step one creates the spec.',
      '',
      'DIRECTORY TREE',
      '',
      'The tree lives in the repo.',
    ].join('\n');
    expect(extractTextHeadings(src)).toEqual(['CREATION FLOW', 'DIRECTORY TREE']);
  });

  test('c2: mixed-case prose is never extracted', () => {
    expect(extractTextHeadings('Creation flow happens here\nAnd continues on this line\n')).toEqual([]);
    expect(extractTextHeadings('Creation Flow\n')).toEqual([]);
  });

  test('c3: sentence punctuation rejects the line in every listed form', () => {
    expect(extractTextHeadings('THIS IS A SENTENCE.\n')).toEqual([]);
    expect(extractTextHeadings('THIS ONE TOO, WITH A COMMA\n')).toEqual([]);
    expect(extractTextHeadings('SEMI; COLON: BANG! QMARK?\n')).toEqual([]);
  });

  test('c4: ASCII-art box lines are not extracted', () => {
    const box = [
      '+----------------------------------+',
      '|          CREATION FLOW           |',
      '+----------------------------------+',
    ].join('\n');
    expect(extractTextHeadings(box)).toEqual([]);
    // A run of two or more `-`/`=` INSIDE a line reads as border drawing too.
    expect(extractTextHeadings('SECTION -- NOTES\n')).toEqual([]);
    expect(extractTextHeadings('A == B\n')).toEqual([]);
  });

  test('c5: 8 words pass, 9 words are shouty prose, not a section title', () => {
    expect(extractTextHeadings('ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT\n'))
      .toEqual(['ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT']);
    expect(extractTextHeadings('ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE\n')).toEqual([]);
  });

  test('c6: the 72-char boundary is inclusive on the trimmed line', () => {
    const seventy2 = 'X'.repeat(72);
    expect(extractTextHeadings(seventy2)).toEqual([seventy2]);
    expect(extractTextHeadings('X'.repeat(73))).toEqual([]);
  });

  test('c7: preceded by blank line or file start only — underline/prose predecessors do not qualify', () => {
    // File start qualifies (and the SECOND shouty line, mid-paragraph, does not).
    expect(extractTextHeadings('LEADS WITH SHOUTY PROSE\nFOLLOWS WITH MORE SHOUTING\n'))
      .toEqual(['LEADS WITH SHOUTY PROSE']);
    // Blank line above qualifies.
    expect(extractTextHeadings('intro\n\nNOTE THE CAPS LINE\n')).toEqual(['NOTE THE CAPS LINE']);
    // An underline line above counts as NON-blank: OVERVIEW is a paragraph
    // glued to the heading, not a standalone section line (markdown agrees).
    expect(extractTextHeadings('SETUP\n=====\nOVERVIEW\n')).toEqual(['SETUP']);
  });

  test('c8: letter/case edges — digits-only, lone `-`/`=`, accented caps, lowercase', () => {
    expect(extractTextHeadings('42\n')).toEqual([]);              // no letter at all
    expect(extractTextHeadings('***\n')).toEqual([]);             // no letter at all
    expect(extractTextHeadings('VERSION 2\n')).toEqual(['VERSION 2']); // digits ride along
    // DECIDED: a LONE `-`/`=` is not box drawing — only runs (c4) are.
    expect(extractTextHeadings('DATA-FLOW\n')).toEqual(['DATA-FLOW']);
    expect(extractTextHeadings('KEY = VALUE\n')).toEqual(['KEY = VALUE']);
    // Accented uppercase is uppercase; lowercase anywhere rejects.
    expect(extractTextHeadings('ÉCOLE SUPÉRIEURE\n')).toEqual(['ÉCOLE SUPÉRIEURE']);
    expect(extractTextHeadings('école SUPÉRIEURE\n')).toEqual([]);
  });

  test('c9: `#nospace` is not a heading (rule 2\'s `#` guard)', () => {
    expect(extractTextHeadings('#nospace\n')).toEqual([]);
  });
});

// ── Rule 3: ATX headings ──

describe('issue #60: extractTextHeadings — ATX headings', () => {
  test('a1: levels 1–6 all mint headings with the text after the space', () => {
    const src = '# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six\n';
    expect(extractTextHeadings(src)).toEqual(['One', 'Two', 'Three', 'Four', 'Five', 'Six']);
  });

  test('a2: 7 `#`s, `#nospace`, bare `#`, and empty ATX text are all rejected', () => {
    expect(extractTextHeadings('####### Seven\n#nospace\n#\n# \n')).toEqual([]);
  });

  test('a3: closing `#` sequences are kept verbatim (decided: no CommonMark stripping)', () => {
    expect(extractTextHeadings('## Title ##\n')).toEqual(['Title ##']);
  });

  test('a4: leading/trailing whitespace on the line is trimmed before every rule', () => {
    expect(extractTextHeadings('   # Indented   \n')).toEqual(['Indented']);
  });

  test('a5: ATX beats an underline below — `# Title` + `====` is one ATX heading', () => {
    expect(extractTextHeadings('# Title\n========\n')).toEqual(['Title']);
    expect(extractTextHeadings('## Sub\n------\n')).toEqual(['Sub']);
  });
});

// ── Document-level behavior ──

describe('issue #60: extractTextHeadings — document-level behavior', () => {
  test('g1: CRLF input behaves identically to LF across all three forms', () => {
    const lf = 'TITLE\n=====\n\nCREATION FLOW\n\n## Markdown\n\n---\n\nFINAL SECTION\n';
    const crlf = lf.split('\n').join('\r\n');
    const expected = ['TITLE', 'CREATION FLOW', 'Markdown', 'FINAL SECTION'];
    expect(extractTextHeadings(lf)).toEqual(expected);
    expect(extractTextHeadings(crlf)).toEqual(expected);
  });

  test('g2: empty, blank, and separator-only sources have no headings', () => {
    expect(extractTextHeadings('')).toEqual([]);
    expect(extractTextHeadings('\n\n\n')).toEqual([]);
    expect(extractTextHeadings('   \n\t\n')).toEqual([]);
    expect(extractTextHeadings('---\n')).toEqual([]);
    expect(extractTextHeadings('====\n')).toEqual([]);
  });

  test('g3: duplicate texts are preserved, in document order', () => {
    expect(extractTextHeadings('OVERVIEW\n\nintro\n\nOVERVIEW\n')).toEqual(['OVERVIEW', 'OVERVIEW']);
  });

  test('g4: a trailing newline (LF or CRLF) changes nothing', () => {
    expect(extractTextHeadings('OVERVIEW')).toEqual(['OVERVIEW']);
    expect(extractTextHeadings('OVERVIEW\n')).toEqual(['OVERVIEW']);
    expect(extractTextHeadings('OVERVIEW\r\n')).toEqual(['OVERVIEW']);
  });

  test('g5: the issue\'s realistic data-flow.txt — all three forms in one document', () => {
    const src = [
      'DATA FLOW',
      '',
      'How data moves through the system.',
      'Maintained by the platform team.',
      '',
      'CREATION FLOW',
      '',
      'A spec is created from a template.',
      '',
      'DIRECTORY TREE',
      '-------------',
      '',
      'The tree lives in the repository.',
      '',
      '# Maintenance Notes',
      '',
      'Notes are sporadic.',
    ].join('\n');
    expect(extractTextHeadings(src))
      .toEqual(['DATA FLOW', 'CREATION FLOW', 'DIRECTORY TREE', 'Maintenance Notes']);
  });
});

// ── isTextArtifact ──

describe('issue #60: isTextArtifact — the .txt/.text truth table', () => {
  test('t1: .txt and .text, any case, anywhere in a path', () => {
    expect(isTextArtifact('artifacts/diagrams/data-flow.txt')).toBe(true);
    expect(isTextArtifact('notes.text')).toBe(true);
    expect(isTextArtifact('README.TXT')).toBe(true);
    expect(isTextArtifact('notes.Text')).toBe(true);
    expect(isTextArtifact('NOTES.TEXT')).toBe(true);
    expect(isTextArtifact('a/b/c/ глубокий.txt')).toBe(true);
  });

  test('t2: every other spelling is false', () => {
    expect(isTextArtifact('README.md')).toBe(false);
    expect(isTextArtifact('artifacts/config.yaml')).toBe(false);
    expect(isTextArtifact('schema.json')).toBe(false);
    expect(isTextArtifact('data.toml')).toBe(false);
    expect(isTextArtifact('README')).toBe(false);          // no extension
    expect(isTextArtifact('notes.textile')).toBe(false);  // .textile ≠ .text ($-anchored)
    expect(isTextArtifact('dir/notes.txt/')).toBe(false); // trailing slash — like schematicFormatFor
    expect(isTextArtifact('')).toBe(false);
  });
});

// ── Integration preview: the contract the #60 wiring depends on ──

describe('issue #60: integration preview — anchorMatches resolves the raw texts', () => {
  test('i1: §12 normalization — CREATION FLOW ↔ creation-flow (the wiring contract)', () => {
    expect(anchorMatches('CREATION FLOW', 'creation-flow')).toBe(true);
    expect(anchorMatches('DIRECTORY TREE', 'directory-tree')).toBe(true);
    expect(anchorMatches('DATA FLOW', 'DATA-FLOW')).toBe(true);
    expect(anchorMatches('CREATION FLOW', 'creation_flow')).toBe(true);
    // Folding is separator-level, never deletion — and a miss stays a miss.
    expect(anchorMatches('CREATION FLOW', 'creationflow')).toBe(false);
    expect(anchorMatches('CREATION FLOW', 'nonexistent')).toBe(false);
  });

  test('i2: the extracted vocabulary resolves the issue\'s anchors end-to-end', () => {
    const src = 'DATA FLOW\n\nprose line here\n\nCREATION FLOW\n\nDIRECTORY TREE\n-------------\n\n# Maintenance Notes\n';
    const headings = extractTextHeadings(src);
    expect(headings.some(h => anchorMatches(h, 'creation-flow'))).toBe(true);
    expect(headings.some(h => anchorMatches(h, 'directory-tree'))).toBe(true);
    expect(headings.some(h => anchorMatches(h, 'data-flow'))).toBe(true);
    expect(headings.some(h => anchorMatches(h, 'maintenance-notes'))).toBe(true);
    expect(headings.some(h => anchorMatches(h, 'no-such-section'))).toBe(false);
  });
});
