/**
 * Issue #61 — the granular structure engine, unit level (parser + engine).
 *
 * The problem: `structure.node_length: { min: 3, max: 90 }` was an
 * all-or-nothing, uncalibrated rule — single-line titles, wrapped prose
 * continuations and `see: ...` reference syntax lumped into one ambiguous
 * char count that ran as dead, unenforced configuration. The fix is additive:
 * node_length grows unit/scope/strip_references/severity knobs, and a new
 * `structure.multiline` policy governs the wrapped prose the parser now
 * RECORDS (never joins into the tree).
 *
 * Test map (engine contract pinned here; config-side loading/normalization
 * and CLI wiring live in their own suites):
 *   p1-p9   parser: continuation recording — deep-indented prose attaches to
 *           the most recent bullet (deeper bullets included); prose at/above
 *           the bullet column is humans-only; fences/content, tables,
 *           alias definitions and ref-by comments are never prose; blanks
 *           neither record nor break attachment; pre-bullet prose records on
 *           nothing; tree shape/counts/depth/refs/warnings byte-identical;
 *           odd-indent ownership by RAW column; CRLF ≡ LF; a leading-fence
 *           file records on the synthetic placeholder (skipped by checks).
 *   n1-n8   node_length: bare {min,max} = chars/title with BOTH sides
 *           warnings (severity decoupled from the old max:'error'/
 *           min:'warning' pair); unit words/tokens (ceil(chars/3.5));
 *           scope body (no continuations ⇒ not evaluated) and total
 *           (single-space folding); strip_references in every scope
 *           (stripRefSyntax, issue #46/#48 trailing punctuation); severity
 *           error/warn/off.
 *   m1-m10  multiline: absent ⇒ no policy (no findings, no fold); allow ⇒
 *           no mode finding; forbid ⇒ one finding per wrapped node on the
 *           title line; fold ⇒ node_length measures the folded text
 *           regardless of scope (a parameter — survives severity 'off');
 *           max_lines actual-vs-max; indent_aligned canonical text column
 *           (indent·2+2) with the FIRST offender's line; §18 null = off;
 *           synthetic placeholders never flagged; one finding per node per
 *           rule (stacking, never multiplying).
 */
import { describe, test, expect } from '../testing.ts';

import {
  parseOutline,
  flattenNodes,
  countNodes,
  maxDepth,
  isSyntheticNode,
  type ParseWarning,
} from '../../src/core/outline.ts';
import { checkStructure } from '../../src/core/structure.ts';
import { defaultRules } from '../../src/core/rules.ts';
import { STRUCTURE_CHARS_PER_TOKEN } from '../../src/types.ts';
import type {
  StructureRules,
  NodeLengthRules,
  MultilineRules,
  OutlineNode,
} from '../../src/types.ts';

const BASE = defaultRules().structure;

/** node_length overrides on the default structure rules — multiline stays
 *  absent (the §18 "no policy" state) unless a test says otherwise. */
function nl(over: Partial<NodeLengthRules>): StructureRules {
  return { ...BASE, node_length: { ...BASE.node_length, ...over } };
}

/** A PRESENT multiline policy plus optional node_length overrides. */
function ml(over: Partial<MultilineRules>, nodeLength: Partial<NodeLengthRules> = {}): StructureRules {
  return {
    ...BASE,
    node_length: { ...BASE.node_length, ...nodeLength },
    multiline: { ...over },
  };
}

/** Every continuation entry in tree order — the "nothing else recorded" pins. */
function allContinuations(
  nodes: OutlineNode[],
): Array<{ text: string; line: number; indent: number }> {
  return flattenNodes(nodes).flatMap(n => n.continuations ?? []);
}

function run(nodes: OutlineNode[], rules: StructureRules) {
  return checkStructure(nodes, 'fixture.md', rules);
}

// ── Parser: recording wrapped-prose continuations ──────────────────────────

describe('issue #61: parser records wrapped-prose continuations', () => {
  test('p1: deep-indented prose attaches to the most recent bullet — including a deeper bullet', () => {
    const src = [
      '- Alpha hub',
      '  wrapped prose one',
      '    deeper prose',
      '  - Child node',
      '    child wrap text',
      '- Beta leaf',
      'prose at column zero',
    ].join('\n');
    const roots = parseOutline(src, 'f.md');

    // Tree shape: prose NEVER joins (three bullets, one nested).
    expect(roots.map(n => n.text)).toEqual(['Alpha hub', 'Beta leaf']);
    expect(roots[0]!.children.map(n => n.text)).toEqual(['Child node']);

    // Attachment follows lastNode: lines 2-3 follow the root bullet (col 0),
    // line 5 follows the CHILD bullet (col 2) — the most recent bullet owns
    // the wrap, exactly like every other post-bullet consumer.
    expect(roots[0]!.continuations).toEqual([
      { text: 'wrapped prose one', line: 2, indent: 2 },
      { text: 'deeper prose', line: 3, indent: 4 },
    ]);
    expect(roots[0]!.children[0]!.continuations).toEqual([
      { text: 'child wrap text', line: 5, indent: 4 },
    ]);
    // Prose at the root bullet's own column (line 7, col 0) is humans-only,
    // and Beta has no wrap: absent, not an empty array.
    expect(roots[1]!.continuations).toBeUndefined();
    expect(allContinuations(roots)).toHaveLength(3);
  });

  test("p2: prose at or above the owning bullet's column stays humans-only (unrecorded)", () => {
    const src = [
      '- Root node',
      '  - Deep child',
      '  back at the child bullet column',
      'at column zero',
    ].join('\n');
    const roots = parseOutline(src, 'f.md');
    expect(roots[0]!.children[0]!.continuations).toBeUndefined();
    expect(roots[0]!.continuations).toBeUndefined();
    expect(allContinuations(roots)).toHaveLength(0);
  });

  test('p3: fence markers/content, table rows, alias definitions and ref-by comments are never continuations', () => {
    const src = [
      '- Node A',
      '  ```ts',
      '  const fenced = "not prose";',
      '  ```',
      '  | col | col |',
      '  - [1]: some/target.md#Anchor',
      '  <!-- ref-by: other.md -->',
      '  real prose survives',
    ].join('\n');
    const roots = parseOutline(src, 'f.md');
    // The infrastructure lines keep their EXISTING parse signals (fence flag,
    // table flag, alias definition excluded from the tree) and mint no nodes.
    expect(roots).toHaveLength(1);
    expect(roots[0]!.hasCodeFence).toBe(true);
    expect(roots[0]!.hasTable).toBe(true);
    expect(countNodes(roots)).toBe(1);
    // Only the genuine prose line records.
    expect(roots[0]!.continuations).toEqual([{ text: 'real prose survives', line: 8, indent: 2 }]);
  });

  test('p4: blank lines neither record nor break attachment', () => {
    const src = ['- Node A', '  first wrap', '', '  second wrap'].join('\n');
    const roots = parseOutline(src, 'f.md');
    expect(roots[0]!.continuations).toEqual([
      { text: 'first wrap', line: 2, indent: 2 },
      { text: 'second wrap', line: 4, indent: 2 },
    ]);
  });

  test('p5: prose before the first bullet is recorded on nothing', () => {
    const src = [
      '# Doc heading',
      '  indented prose with no owner yet',
      '- First node',
      '  owned prose',
    ].join('\n');
    const roots = parseOutline(src, 'f.md');
    expect(roots).toHaveLength(1);
    expect(allContinuations(roots)).toEqual([{ text: 'owned prose', line: 4, indent: 2 }]);
  });

  test('p6: node counts, depth, tree shape, refs and parse warnings are unchanged by continuations', () => {
    const withProse = parseOutline(
      '- Alpha hub\n  wrapped prose follows the bullet\n  - Child node\n    child wrap\n',
      'a.md',
    );
    // Same bullet LINES with BLANKS where the prose sat: identical tree —
    // the wrap is additive metadata, invisible to every pre-#61 consumer.
    const withBlanks = parseOutline('- Alpha hub\n\n  - Child node\n\n', 'b.md');
    expect(countNodes(withProse)).toBe(2);
    expect(countNodes(withBlanks)).toBe(2);
    expect(maxDepth(withProse)).toBe(maxDepth(withBlanks));
    const shape = (ns: OutlineNode[]): Array<Record<string, unknown>> =>
      ns.map(n => ({ text: n.text, line: n.line, indent: n.indent, children: shape(n.children) }));
    expect(shape(withProse)).toEqual(shape(withBlanks));
    expect(flattenNodes(withProse).every(n => n.refs.length === 0)).toBe(true);
    const warnings: ParseWarning[] = [];
    parseOutline('- Alpha hub\n  wrapped prose follows the bullet\n  - Child node\n', 'c.md', warnings);
    expect(warnings).toHaveLength(0); // even-indented prose mints no odd-indent warning
    // And the wraps still record — on their owning bullets.
    expect(withProse[0]!.continuations).toEqual([
      { text: 'wrapped prose follows the bullet', line: 2, indent: 2 },
    ]);
    expect(withProse[0]!.children[0]!.continuations).toEqual([
      { text: 'child wrap', line: 4, indent: 4 },
    ]);
    expect(allContinuations(withBlanks)).toHaveLength(0);
  });

  test('p7: an odd-indented bullet owns prose strictly past its RAW column', () => {
    const src = [
      '   - Odd bullet', // 3 spaces → indent level 1, raw column 3 (warned)
      '    prose at column four is deeper',
      '   prose at column three is not',
    ].join('\n');
    const warnings: ParseWarning[] = [];
    const roots = parseOutline(src, 'f.md', warnings);
    expect(warnings).toHaveLength(1); // the odd-indent re-parenting warning, unchanged
    expect(warnings[0]!.line).toBe(1);
    expect(roots[0]!.continuations).toEqual([
      { text: 'prose at column four is deeper', line: 2, indent: 4 },
    ]);
  });

  test('p8: CRLF sources record identical continuations (§45 boundary)', () => {
    const lf = ['- Node A', '  first wrap', '  second wrap'].join('\n');
    const crlf = ['- Node A', '  first wrap', '  second wrap'].join('\r\n');
    expect(parseOutline(crlf, 'f.md')[0]!.continuations).toEqual(
      parseOutline(lf, 'f.md')[0]!.continuations,
    );
  });

  test('p9: deep prose after a leading fence attaches to the synthetic placeholder (recorded, never checked)', () => {
    const src = [
      '```text',
      'fenced body',
      '```',
      '  deep prose after the leading fence',
      '- Real bullet',
    ].join('\n');
    const roots = parseOutline(src, 'f.md');
    expect(roots.map(n => n.text)).toEqual(['(code fence)', 'Real bullet']);
    expect(isSyntheticNode(roots[0]!)).toBe(true);
    // lastNode at that point is the placeholder; the wrap records on it —
    // the engine's synthetic guard (issue #8) keeps it from ever flagging
    // (pinned in the multiline block below).
    expect(roots[0]!.continuations).toEqual([
      { text: 'deep prose after the leading fence', line: 4, indent: 2 },
    ]);
    expect(roots[1]!.continuations).toBeUndefined();
  });
});

// ── node_length: unit / scope / strip_references / severity ────────────────

describe('issue #61: node_length — unit, scope, strip_references, severity', () => {
  test('n1: bare {min,max} stays chars/title — BOTH sides are warnings now (severity decoupled)', () => {
    const nodes = parseOutline(`- ${'x'.repeat(130)}\n- ab\n`, 'f.md');
    const issues = run(nodes, BASE); // defaultRules: { min: 3, max: 120 }, no multiline
    expect(issues).toHaveLength(2);
    const max = issues.find(i => i.rule === 'structure.node_length.max')!;
    const min = issues.find(i => i.rule === 'structure.node_length.min')!;
    // The deliberate #61 change: default severity 'warn' replaces the old
    // hardcoded max:'error'/min:'warning' pair — structured diagnostics, not
    // a hard fail, unless the workspace opts into severity: error.
    expect(max.level).toBe('warning');
    expect(min.level).toBe('warning');
    expect(max.message).toBe('Node too long (130 > 120). Split or move to file.');
    expect(min.message).toBe('Node too short (2 < 3).');
    expect(max.line).toBe(1);
    expect(min.line).toBe(2);
  });

  test('n2: unit words — whitespace-split token count (multi-space collapses)', () => {
    const nodes = parseOutline('- one two three four five\n- a  b\n', 'f.md');
    const issues = run(nodes, nl({ min: null, max: 4, unit: 'words' }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toBe('Node too long (5 > 4 words). Split or move to file.');
    expect(issues[0]!.level).toBe('warning');
    // 5 words ≤ 5 passes; double-spaced "a  b" is 2 words, not 3.
    expect(run(nodes, nl({ min: null, max: 5, unit: 'words' }))).toHaveLength(0);
    expect(run(parseOutline('- a  b\n', 'f.md'), nl({ min: null, max: 2, unit: 'words' }))).toHaveLength(0);
  });

  test('n3: unit tokens — ceil(chars / STRUCTURE_CHARS_PER_TOKEN): 143 chars → 41 tokens, 140 → exactly 40', () => {
    expect(STRUCTURE_CHARS_PER_TOKEN).toBe(3.5); // contract pin (types.ts)
    const over = parseOutline(`- ${'x'.repeat(143)}\n`, 'f.md');
    const exact = parseOutline(`- ${'x'.repeat(140)}\n`, 'f.md');
    // ceil(143 / 3.5) = ceil(40.857…) = 41 — one char over the boundary.
    const issues = run(over, nl({ min: null, max: 40, unit: 'tokens' }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toBe('Node too long (41 > 40 tokens). Split or move to file.');
    // 140 / 3.5 = 40 exactly — ceil keeps it 40, which does NOT exceed 40.
    expect(run(exact, nl({ min: null, max: 40, unit: 'tokens' }))).toHaveLength(0);
  });

  test('n4: scope body — continuation text only (single-space folded); nodes without continuations are not evaluated at all', () => {
    const BODY_A = 'wrapped body prose line one that is long';
    const BODY_B = 'and line two';
    const folded = `${BODY_A} ${BODY_B}`; // 53 chars — the body measurement
    const nodes = parseOutline(`- Short title\n  ${BODY_A}\n  ${BODY_B}\n- Plain node\n`, 'f.md');
    // max side: only the wrapped node trips, on its TITLE line; the
    // continuation-less "Plain node" is not evaluated (11-char title and all).
    const issues = run(nodes, nl({ min: null, max: folded.length - 1, scope: 'body' }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.rule).toBe('structure.node_length.max');
    expect(issues[0]!.line).toBe(1);
    expect(issues[0]!.message).toBe(`Node too long (${folded.length} > ${folded.length - 1}). Split or move to file.`);
    // min side: the same skip — "Plain node" cannot be "too short" because
    // there is no body to measure.
    const short = run(nodes, nl({ min: 500, max: null, scope: 'body' }));
    expect(short).toHaveLength(1);
    expect(short[0]!.rule).toBe('structure.node_length.min');
    expect(short[0]!.message).toBe(`Node too short (${folded.length} < 500).`);
  });

  test('n5: scope total — title + continuations folded with single spaces (title itself when unwrapped)', () => {
    const nodes = parseOutline('- Tot\n  aaa\n  bbb\n', 'f.md');
    const folded = ['Tot', 'aaa', 'bbb'].join(' '); // 11
    const issues = run(nodes, nl({ min: null, max: folded.length - 1, scope: 'total' }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toBe(`Node too long (${folded.length} > ${folded.length - 1}). Split or move to file.`);
    // Without continuations, total degenerates to the title measurement.
    const bare = parseOutline('- Tiny\n', 'f.md');
    const degenerate = run(bare, nl({ min: 10, max: null, scope: 'total' }));
    expect(degenerate).toHaveLength(1);
    expect(degenerate[0]!.message).toBe('Node too short (4 < 10).');
  });

  test('n6: strip_references — see: spans (incl. issue-#48 glued punctuation) leave the measurement', () => {
    const gateway = `Gateway: see ${'a'.repeat(50)}.md`; // 66 chars with the span
    const nodes = parseOutline(`- ${gateway}\n`, 'f.md');
    // Stripped: 'Gateway: ' (9) — the span is gone before measuring.
    expect(run(nodes, nl({ min: null, max: 40, strip_references: true }))).toHaveLength(0);
    // Default false: the full written spelling trips.
    const keep = run(nodes, nl({ min: null, max: 40 }));
    expect(keep).toHaveLength(1);
    expect(keep[0]!.message).toBe(`Node too long (${gateway.length} > 40). Split or move to file.`);
    // Issue #48 semantics via stripRefSyntax: the glued `)` rides with the
    // span, so 'Effect (see effect.md#Audit-spine)' measures 'Effect (' (8).
    const effect = 'Effect (see effect.md#Audit-spine)'; // 34 chars
    const effectNodes = parseOutline(`- ${effect}\n`, 'f.md');
    expect(run(effectNodes, nl({ min: null, max: 30, strip_references: true }))).toHaveLength(0);
    const effectKeep = run(effectNodes, nl({ min: null, max: 30 }));
    expect(effectKeep).toHaveLength(1);
    expect(effectKeep[0]!.message).toBe(`Node too long (${effect.length} > 30). Split or move to file.`);
  });

  test('n7: strip_references applies in EVERY scope — a body of only a ref measures to zero', () => {
    // body: 'see x.md' → stripped '' → 0 chars.
    const bodyOnly = parseOutline('- T\n  see x.md\n', 'f.md');
    const stripped = run(bodyOnly, nl({ min: 1, max: null, scope: 'body', strip_references: true }));
    expect(stripped).toHaveLength(1);
    expect(stripped[0]!.message).toBe('Node too short (0 < 1).');
    expect(run(bodyOnly, nl({ min: 1, max: null, scope: 'body' }))).toHaveLength(0);
    // total: the folded string strips before measuring too.
    const target = 'very-long-target-file.md'; // 24
    const nodes = parseOutline(`- T\n  see ${target}\n`, 'f.md');
    const folded = `T see ${target}`; // 30 with the span, 'T ' (2) without
    expect(run(nodes, nl({ min: null, max: 5, scope: 'total', strip_references: true }))).toHaveLength(0);
    const keep = run(nodes, nl({ min: null, max: 5, scope: 'total' }));
    expect(keep).toHaveLength(1);
    expect(keep[0]!.message).toBe(`Node too long (${folded.length} > 5). Split or move to file.`);
  });

  test('n8: severity — error makes BOTH sides errors, warn warnings, off skips the check entirely', () => {
    const nodes = parseOutline(`- ${'x'.repeat(130)}\n- ab\n`, 'f.md');
    const errorIssues = run(nodes, nl({ min: 3, max: 120, severity: 'error' }));
    expect(errorIssues.map(i => i.rule)).toEqual(['structure.node_length.max', 'structure.node_length.min']);
    expect(errorIssues.every(i => i.level === 'error')).toBe(true); // min side too — the decoupling
    const warnIssues = run(nodes, nl({ min: 3, max: 120, severity: 'warn' }));
    expect(warnIssues.every(i => i.level === 'warning')).toBe(true);
    // off (§18): the whole check is skipped — neither side fires.
    expect(run(nodes, nl({ min: 3, max: 120, severity: 'off' }))).toHaveLength(0);
  });
});

// ── multiline: mode / max_lines / indent_aligned / severity ────────────────

describe('issue #61: multiline policy — mode, max_lines, indent_aligned, severity', () => {
  // '- Hub' + one 26-char wrap: title 3, folded 'Hub wrapped prose follows here' (30).
  const FOLD_SRC = '- Hub\n  wrapped prose follows here\n';
  const FOLD_NODE = parseOutline(FOLD_SRC, 'f.md');
  const FOLDED = ['Hub', 'wrapped prose follows here'].join(' ');

  test('m1: rules.multiline absent → no policy at all: no findings, and no fold', () => {
    // Wrapped prose present, default rules (multiline key absent).
    const wrapped = parseOutline(FOLD_SRC, 'f.md');
    expect(run(wrapped, BASE).filter(i => (i.rule ?? '').startsWith('structure.multiline.'))).toHaveLength(0);
    // No fold either: scope defaults to title, the 30-char folded string is
    // never measured — only the 3-char title is.
    expect(run(wrapped, nl({ min: null, max: FOLDED.length - 1 }))).toHaveLength(0);
  });

  test('m2: mode allow (default) → continuations permitted, no mode finding', () => {
    const wrapped = parseOutline(FOLD_SRC, 'f.md');
    expect(run(wrapped, ml({ mode: 'allow' }))).toHaveLength(0);
    expect(run(wrapped, ml({}))).toHaveLength(0); // absent mode defaults to allow
  });

  test('m3: mode forbid → one finding per node WITH continuations, on the title line', () => {
    const nodes = parseOutline(
      ['- One wrap', '  single continuation', '- Two wraps', '  first', '  second', '- Clean node'].join('\n'),
      'f.md',
    );
    const issues = run(nodes, ml({ mode: 'forbid' }));
    expect(issues).toHaveLength(2); // 'Clean node' has no wrap — no finding
    expect(issues.map(i => [i.rule, i.line, i.level])).toEqual([
      ['structure.multiline.forbid', 1, 'warning'], // default severity 'warn'
      ['structure.multiline.forbid', 3, 'warning'],
    ]);
    expect(issues[0]!.message).toBe('Wrapped prose used but structure.multiline.mode is forbid (1 continuation line).');
    expect(issues[1]!.message).toBe('Wrapped prose used but structure.multiline.mode is forbid (2 continuation lines).');
    expect(issues.every(i => typeof i.suggestion === 'string')).toBe(true);
  });

  test('m4: mode fold → node_length measures the folded text regardless of scope', () => {
    // scope title (the default) + fold: the 30-char folded string binds, not
    // the 3-char title — exactly the issue's "lumped" measurement, now OPT-IN.
    const folded = run(FOLD_NODE, ml({ mode: 'fold' }, { min: null, max: FOLDED.length - 1, scope: 'title' }));
    expect(folded).toHaveLength(1);
    expect(folded[0]!.rule).toBe('structure.node_length.max');
    expect(folded[0]!.message).toBe(`Node too long (${FOLDED.length} > ${FOLDED.length - 1}). Split or move to file.`);
    // Control: same node_length under mode allow stays title-scoped → clean.
    expect(run(FOLD_NODE, ml({ mode: 'allow' }, { min: null, max: FOLDED.length - 1 }))).toHaveLength(0);
    // scope body + fold: the OVERRIDE holds — body-only would measure 'b' (1),
    // the folded string 'A b' (3) satisfies min 3.
    const ab = parseOutline('- A\n  b\n', 'f.md');
    expect(run(ab, ml({ mode: 'fold' }, { min: 3, max: null, scope: 'body' }))).toHaveLength(0);
    expect(run(ab, nl({ min: 3, max: null, scope: 'body' }))).toHaveLength(1); // 'Node too short (1 < 3).'
    // Fold only re-targets nodes WITH continuations: a continuation-less node
    // keeps its scope behavior (body scope → not evaluated at all).
    const bare = parseOutline('- ab\n', 'f.md');
    expect(run(bare, ml({ mode: 'fold' }, { min: null, max: 2, scope: 'body' }))).toHaveLength(0);
  });

  test('m5: max_lines — actual vs max in the message; equal passes; absent/null = no cap', () => {
    const nodes = parseOutline(
      ['- Three wraps', '  one', '  two', '  three', '- Two wraps', '  one', '  two'].join('\n'),
      'f.md',
    );
    const issues = run(nodes, ml({ mode: 'allow', max_lines: 2 }));
    expect(issues).toHaveLength(1); // 2 ≤ 2 passes
    expect(issues[0]!.rule).toBe('structure.multiline.max_lines');
    expect(issues[0]!.line).toBe(1); // the node's title line
    expect(issues[0]!.level).toBe('warning');
    expect(issues[0]!.message).toBe('3 continuation lines exceed structure.multiline.max_lines (2)');
    expect(run(nodes, ml({ mode: 'allow' }))).toHaveLength(0); // no cap configured
    expect(run(nodes, ml({ mode: 'allow', max_lines: null }))).toHaveLength(0); // explicit null
  });

  test('m6: indent_aligned — canonical text column (indent·2 + 2); first offender line, one finding', () => {
    // Aligned: a root bullet's wraps sit at column 2, a depth-1 child's at
    // column 4 — the text column of the owning bullet, not its marker column.
    const alignedSrc = [
      '- Parent',
      '  - Child node',
      '    child wrap aligned at column four', // Child (indent 1) → text column 4
      '  - Second child',
      '- Aligned root',
      '  root wrap aligned at column two', // root (indent 0) → text column 2
    ].join('\n');
    expect(run(parseOutline(alignedSrc, 'f.md'), ml({ mode: 'allow', indent_aligned: true }))).toHaveLength(0);
    // Misaligned: the finding rides the CONTINUATION's line (2), not the
    // node's title line (1); the later aligned line neither repairs nor
    // re-flags — one finding per node per rule.
    const misaligned = parseOutline(
      ['- Misaligned root', '    too deep by two', '  aligned late'].join('\n'),
      'f.md',
    );
    const issues = run(misaligned, ml({ mode: 'allow', indent_aligned: true }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.rule).toBe('structure.multiline.indent_aligned');
    expect(issues[0]!.line).toBe(2); // first offending continuation's line
    expect(issues[0]!.message).toBe('Continuation indent 4 does not match the node text column 2.');
    expect(issues[0]!.suggestion).toBe('indent continuation lines to column 2 (aligned with the text after "- ")');
  });

  test('m7: multiline severity — error/warn levels; off mutes findings but NEVER the fold parameter', () => {
    const nodes = parseOutline('- One wrap\n  single continuation\n', 'f.md');
    expect(run(nodes, ml({ mode: 'forbid', severity: 'error' }))[0]!.level).toBe('error');
    expect(run(nodes, ml({ mode: 'forbid', severity: 'warn' }))[0]!.level).toBe('warning');
    // off: every multiline finding is skipped — even all three knobs at once.
    const stacked = parseOutline('- Stacked\n    deep one\n      deep two\n      deep three\n', 'f.md');
    expect(
      run(stacked, ml({ mode: 'forbid', max_lines: 2, indent_aligned: true, severity: 'off' })),
    ).toHaveLength(0);
    // But mode 'fold' is a PARAMETER (§18 discipline): with severity off the
    // folded text still governs node_length.
    const folded = run(FOLD_NODE, ml({ mode: 'fold', severity: 'off' }, { min: null, max: FOLDED.length - 1 }));
    expect(folded).toHaveLength(1);
    expect(folded[0]!.rule).toBe('structure.node_length.max');
  });

  test('m8: §18 — multiline: null is no policy at all (findings and fold both off)', () => {
    const rules: StructureRules = {
      ...BASE,
      node_length: { ...BASE.node_length, min: null, max: FOLDED.length - 1 },
      multiline: null,
    };
    const issues = run(FOLD_NODE, rules);
    expect(issues).toHaveLength(0); // no fold (title 3 ≤ max) AND no multiline findings
    const stacked = parseOutline('- Stacked\n    deep one\n      deep two\n', 'f.md');
    expect(
      run(stacked, { ...rules, multiline: null as MultilineRules | null }).filter(i =>
        (i.rule ?? '').startsWith('structure.multiline.'),
      ),
    ).toHaveLength(0);
  });

  test('m9: synthetic placeholders are never flagged (issue #8 guard holds for the new policy)', () => {
    const src = [
      '```text',
      'fenced body',
      '```',
      '  deep prose after the leading fence',
      '- Real bullet',
    ].join('\n');
    const roots = parseOutline(src, 'f.md');
    expect(roots[0]!.continuations).toHaveLength(1); // recorded (p9)…
    // …but every knob stays silent for the placeholder, and the real bullet
    // has no wrap of its own.
    expect(
      run(roots, ml({ mode: 'forbid', max_lines: 0, indent_aligned: true })),
    ).toHaveLength(0);
  });

  test('m10: one finding per node per rule — forbid + max_lines + indent_aligned stack, never multiply', () => {
    const nodes = parseOutline(
      ['- Stacked node', '    deep one', '      deep two', '      deep three'].join('\n'),
      'f.md',
    );
    const issues = run(nodes, ml({ mode: 'forbid', max_lines: 2, indent_aligned: true }));
    expect(issues.map(i => [i.rule, i.line])).toEqual([
      ['structure.multiline.forbid', 1], // title line
      ['structure.multiline.max_lines', 1], // 3 > 2
      ['structure.multiline.indent_aligned', 2], // FIRST offender's line, once
    ]);
    expect(issues.every(i => i.level === 'warning')).toBe(true);
  });
});
