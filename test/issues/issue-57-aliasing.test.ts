/**
 * Issue #57 — pointer aliasing: footnote-style short aliases for repeated
 * `see:` targets.
 *
 * One verified definition per file (`- [1]: full/target.md#Anchor`,
 * footnote-style at the end), short fully-counted uses (`see: [1]`). The
 * checker contract under test (issue #57, "the non-negotiables"):
 *
 *   1. An alias resolves EXACTLY like the full pointer it stands for: file
 *      existence, anchor match, declared external root, traversal
 *      containment, duplicate-home and orphan_check all apply, with the same
 *      error rules. A broken alias definition fails the run, not just the
 *      uses.
 *   2. Every alias use counts as a ref for graph, hop, SCC and orphan
 *      purposes, exactly as if the full target were written.
 *   3. Undefined alias = broken-ref error. Unused alias = warning.
 *   4. Scope is the defining file only. No cross-file leakage.
 *   5. Definition lines are file metadata, never outline nodes: they never
 *      count against node_length, sibling caps, depth, style or redundancy.
 *   6. Backwards compatible: full pointers stay valid, aliasing is opt-in,
 *      existing files need no changes.
 *
 * Plus the addendum contracts: `references.aliasing` config (enabled /
 * scope / style / min_uses) enforced — never ignored, unknown keys rejected
 * under the #56 strict schema — and the `cans alias expand|collapse`
 * programmatic switch (lossless, idempotent, graph-identical, safe
 * failures).
 *
 * Test map:
 *   u1 ....... grammar: aliasUseName / legalAliasName / aliasNameStyle
 *              (numeric, named, and the deliberately-NOT-alias shapes:
 *              `[a]b`, `[Bad_Name]`, `[^1]`, `[]`, non-brackets)
 *   u2 ....... matchAliasDefinition shape (bullet, `]:`, single target
 *              token + optional anchor, punctuation-stripped; non-shapes
 *              stay ordinary content)
 *   u3 ....... extractAliases: numeric + named, fence-aware, CRLF/CR input,
 *              first-def-wins duplicates, illegal names, alias-shaped
 *              targets classified for the issue pass
 *   u4 ....... parseOutline exclusion: definition lines mint no nodes (node
 *              count, indent, text) wherever they appear outside fences
 *   x1 ....... resolution equivalence: the aliased and expanded forms of
 *              one corpus produce IDENTICAL check --json (minus elapsedMs):
 *              same refs.total, broken, deepHops, sections, counts — the
 *              graph-identity contract
 *   x2 ....... node_length measures the WRITTEN spelling: a use whose full
 *              target would exceed the limit passes as `see: [1]`; the
 *              definition line itself (long target) never trips either
 *   x3 ....... sibling caps / node count: definitions are not nodes and not
 *              siblings
 *   x4 ....... broken target via alias = broken ref (counted in refs.broken,
 *              exit 2), same message shape as a full spelling
 *   x5 ....... broken anchor via alias: error at the USE line, message names
 *              the resolved target; did-you-mean suggestion works through
 *              the alias
 *   x6 ....... unused alias → warning; its broken TARGET still fails the
 *              run (contract 1: "not just the uses") — verified through the
 *              same refs.broken machinery, definition line as location
 *   x7 ....... undefined alias → refs.alias.undefined error, dropped from
 *              the graph (no second see-like-prose report)
 *   x8 ....... aliasing disabled + use → error; + definition-only → error
 *              (stranded syntax never silently passes; expand is the fix)
 *   x9 ....... scope: no cross-file leakage (a use does not see another
 *              file's definitions; aux _tasks/ files resolve their own)
 *   x10 ...... style enforcement: numeric/named/both; a style violation
 *              still resolves (no broken ref, no orphan) — the error is
 *              about the spelling, not the target
 *   x11 ...... min_uses: uses + full spellings of the same target count;
 *              below-threshold alias → error; zero-use → warning only
 *   x12 ...... external roots (#55) through aliases: kelir:// target on a
 *              definition resolves; undeclared root → dedicated error;
 *              traversal escape via a definition → broken ref
 *   x13 ...... graph participation: orphan detection (an alias-only
 *              referenced file is not an orphan), deep-hop chain through an
 *              aliased edge, self-reference via alias
 *   x14 ...... ref-by marks: an alias use earns its target's ref-by comment
 *              (--fix writes it), aux task files included
 *   c1..c9 ... config validation (#56 strict): typo sub-key, bad enum,
 *              wrong type, min_uses 0/1.5, scope repo, non-mapping block,
 *              empty block = defaults, partial block merges, absent block =
 *              disabled defaults with a full-pointer corpus unchanged
 *   e1..e11 .. `cans alias expand|collapse`: lossless rewrite + definitions
 *              removed/added, deterministic first-use numbering, min_uses
 *              eligibility (one-off targets stay full pointers), named
 *              style derivation, existing definitions kept (no renumbering
 *              churn), idempotence (byte-identical no-ops), round trips
 *              (expand∘collapse and collapse∘expand), CRLF preservation,
 *              --dry-run writes nothing, [file] filter
 *   r1..r6 ... safe failures: expand refuses on undefined/anchored/
 *              duplicate/illegal definitions; collapse refuses on style
 *              conflicts, min_uses violations, unterminated fences, and
 *              under a disabled config — files left byte-identical,
 *              problems named, exit 1/2 per the §19 classes
 *   p1..p4 ... prose safety: bracketed text that is not alias-shaped keeps
 *              its pre-#57 treatment (see-like prose warning), non-see
 *              brackets are invisible, parenthesized uses resolve
 *   w1....... export resolves aliases: wikilinks carry the full target,
 *              never `[1]` (consumers outside the workspace cannot see the
 *              definitions)
 *   j1....... check --json: refs.alias.* findings land in sections.refs
 *              with the grouped report shape; alias --json wire shape
 *   f1....... --fix anchor repair targets the DEFINITION line: one rewrite
 *              resolves every use of the alias
 *   b1....... help text lists the alias command
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';

import {
  aliasUseName, aliasNameStyle, legalAliasName, extractAliases,
  expandAliases, collapseAliases, defaultAliasing,
} from '../../src/core/alias.ts';
import { matchAliasDefinition, parseOutline, flattenNodes } from '../../src/core/outline.ts';
import { spawnCli, REPO } from '../runtime.ts';

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-57-aliasing');

const createdDirs: string[] = [];
let wsSeq = 0;

interface Ws { root: string; cans: string }

/** Fresh scratch workspace under repo/.tmp (gitignored). */
function makeWs(name: string): Ws {
  const root = join(SCRATCH, `${name}-${++wsSeq}`);
  mkdirSync(join(root, 'cans'), { recursive: true });
  createdDirs.push(root);
  return { root, cans: join(root, 'cans') };
}

/** Blackbox CLI spawn — isolated from any ambient CANS_ROOT. */
function runCli(args: string[], cwd: string) {
  return spawnCli(args, cwd, { ...process.env, CANS_ROOT: '' });
}

/** JSON-mode output must be a single JSON document; a parse failure is itself an assertion failure. */
function parseJsonOut(out: string): any {
  let parsed: unknown = null;
  let parseError: unknown = null;
  try {
    parsed = JSON.parse(out);
  } catch (e) {
    parseError = e;
  }
  expect(parseError).toBeNull();
  return parsed;
}

function write(ws: Ws, rel: string, content: string): void {
  const p = join(ws.cans, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, content, 'utf8');
}

function read(ws: Ws, rel: string): string {
  return readFileSync(join(ws.cans, rel), 'utf8');
}

/** The minimal aliasing-enabled ruleset (back_pointers off for focus). */
const RULES_ON = 'references:\n  back_pointers: false\n  aliasing:\n    enabled: true\n';
const RULES_OFF = 'references:\n  back_pointers: false\n';

afterEach(() => {
  while (createdDirs.length > 0) {
    rmSync(createdDirs.pop()!, { recursive: true, force: true });
  }
});

// ── u1: the alias-name grammar ──────────────────────────────────────────────

describe('issue #57 u1 — alias name grammar', () => {
  test('numeric and named names are legal; style classification', () => {
    expect(legalAliasName('1')).toBe(true);
    expect(legalAliasName('42')).toBe(true);
    expect(legalAliasName('hyper')).toBe(true);
    expect(legalAliasName('a')).toBe(true);
    expect(legalAliasName('a-b_c2')).toBe(true);
    expect(legalAliasName('Bad')).toBe(false);       // uppercase
    expect(legalAliasName('bad name')).toBe(false);  // space (never matches the shape anyway)
    expect(legalAliasName('bad.name')).toBe(false);
    expect(legalAliasName('1a')).toBe(false);        // mixed digits-then-letters: neither all-digits nor letter-led
    expect(legalAliasName('')).toBe(false);
    expect(aliasNameStyle('1')).toBe('numeric');
    expect(aliasNameStyle('42')).toBe('numeric');
    expect(aliasNameStyle('hyper')).toBe('named');
  });

  test('aliasUseName accepts whole-token brackets only', () => {
    expect(aliasUseName('[1]')).toBe('1');
    expect(aliasUseName('[hyper]')).toBe('hyper');
    // NOT alias uses — bracketed prose and degenerate shapes keep their
    // pre-#57 treatment (never a silent rewrite target):
    expect(aliasUseName('[]')).toBeNull();           // too short
    expect(aliasUseName('[1')).toBeNull();           // unclosed (the #48 strip shape)
    expect(aliasUseName('1]')).toBeNull();           // not bracket-led
    expect(aliasUseName('[a]b')).toBeNull();         // trailing chars after ]
    expect(aliasUseName('[Bad_Name]')).toBeNull();   // illegal name grammar
    expect(aliasUseName('[^1]')).toBeNull();        // markdown footnote form — unsupported, deliberate
    expect(aliasUseName('01-arch.md')).toBeNull();   // an ordinary target
  });
});

// ── u2: the definition-line shape ───────────────────────────────────────────

describe('issue #57 u2 — matchAliasDefinition shape', () => {
  test('bullet + [name]: + single target token (+ optional anchor)', () => {
    expect(matchAliasDefinition('- [1]: 02-beta.md')).toEqual({
      name: '1', target: '02-beta.md', anchor: null,
    });
    expect(matchAliasDefinition('- [hyper]: 02-beta.md#Anchor')).toEqual({
      name: 'hyper', target: '02-beta.md', anchor: 'Anchor',
    });
    expect(matchAliasDefinition('  - [9]: kelir://sub/path.md#A-B')).toEqual({
      name: '9', target: 'kelir://sub/path.md', anchor: 'A-B',
    });
    // Trailing sentence punctuation on the target strips like a see: token
    // (the §48 set), so a definition ending a sentence still parses clean:
    expect(matchAliasDefinition('- [1]: 02-beta.md.')).toEqual({
      name: '1', target: '02-beta.md', anchor: null,
    });
  });

  test('non-shapes are ordinary content, not definitions', () => {
    expect(matchAliasDefinition('- [1]:')).toBeNull();              // no target token
    expect(matchAliasDefinition('- [1] 02-beta.md')).toBeNull();    // no colon
    expect(matchAliasDefinition('[1]: 02-beta.md')).toBeNull();     // not a bullet
    expect(matchAliasDefinition('- see: 02-beta.md')).toBeNull();   // an ordinary node
    expect(matchAliasDefinition('- [x] checkbox task')).toBeNull(); // checkbox syntax (no ]:)
    expect(matchAliasDefinition('- Label: see: 02-beta.md')).toBeNull(); // label node
  });
});

// ── u3: alias-table extraction ──────────────────────────────────────────────

describe('issue #57 u3 — extractAliases', () => {
  test('numeric + named definitions, first-wins duplicates, line numbers', () => {
    const src = [
      '- Alpha: see: [1]',
      '',
      '- [1]: 02-beta.md#Anchor',
      '- [hyper]: 03-data.md',
      '- [1]: 04-other.md',       // duplicate — first wins
    ].join('\n');
    const t = extractAliases(src);
    expect(t.lines).toHaveLength(3);
    expect(t.defs.get('1')).toMatchObject({ target: '02-beta.md', anchor: 'Anchor', line: 3 });
    expect(t.defs.get('hyper')).toMatchObject({ target: '03-data.md', anchor: null, line: 4 });
    expect(t.defs.has('04-other.md')).toBe(false);
    // classification flags for the config-aware issue pass:
    expect(t.lines[2]).toMatchObject({ name: '1', primary: false });  // the duplicate
    expect(t.lines.find(l => l.name === 'hyper')!.primary).toBe(true);
  });

  test('illegal names and alias-shaped targets are flagged, not silently dropped', () => {
    const t = extractAliases('- [Bad_Name]: 02-beta.md\n- [2]: [1]\n');
    expect(t.lines[0]).toMatchObject({ name: 'Bad_Name', nameLegal: false, primary: false });
    expect(t.lines[1]).toMatchObject({ name: '2', nameLegal: true, targetLegal: false });
    expect(t.defs.size).toBe(0); // neither resolves
  });

  test('fence-aware: a definition quoted in a code fence is documentation', () => {
    const src = [
      '- Alpha: see: [1]',
      '',
      '```',
      '- [1]: fenced-target.md',
      '```',
      '',
      '- [1]: real-target.md',
    ].join('\n');
    const t = extractAliases(src);
    expect(t.lines).toHaveLength(1);
    expect(t.defs.get('1')!.target).toBe('real-target.md');
  });

  test('CRLF and lone-CR input normalize (§45 parity)', () => {
    const crlf = '- [1]: a.md\r\n- x: see: [1]\r\n';
    const t = extractAliases(crlf);
    expect(t.defs.get('1')!.line).toBe(1);
    const cr = '- [1]: a.md\r- x: see: [1]\r';
    expect(extractAliases(cr).defs.get('1')!.target).toBe('a.md');
  });
});

// ── u4: definitions never join the outline ──────────────────────────────────

describe('issue #57 u4 — definition lines are file metadata, never nodes', () => {
  test('parseOutline skips definition lines wherever they appear', () => {
    const src = [
      '- Alpha: see: [1]',
      '- [1]: 02-beta.md#Anchor',   // mid-file definition — still metadata
      '- Beta',
      '',
      '- [2]: 03-data.md',          // end-of-file definitions (the convention)
    ].join('\n');
    const nodes = flattenNodes(parseOutline(src, 'x.md'));
    expect(nodes.map(n => n.text)).toEqual(['Alpha: see: [1]', 'Beta']);
    expect(nodes.every(n => n.refs.length === 0 || n.text.startsWith('Alpha'))).toBe(true);
  });

  test('a fenced definition-shaped line is neither node nor definition', () => {
    const src = ['- Real', '', '```', '- [1]: doc-only.md', '```'].join('\n');
    expect(flattenNodes(parseOutline(src, 'x.md')).map(n => n.text)).toEqual(['Real']);
    expect(extractAliases(src).lines).toHaveLength(0);
  });
});

// ── x1: resolution equivalence / graph identity ─────────────────────────────

describe('issue #57 x1 — the aliased and expanded forms are graph-identical', () => {
  test('identical check --json (minus elapsedMs) for both forms of one corpus', () => {
    const aliased = makeWs('x1-aliased');
    const expanded = makeWs('x1-expanded');
    const rules = 'references:\n  back_pointers: false\n  aliasing:\n    enabled: true\nstructure:\n  node_length:\n    min: 3\n    max: 500\n';
    const target = '- Anchor node\n- Other node\n';
    const aSrc = [
      '- First: see: [arch]',
      '- Second: see: [arch]',
      '- Third: see: 02-target.md#Other-node',
      '',
      '- [arch]: 02-target.md#Anchor-node',
    ].join('\n') + '\n';
    const eSrc = [
      '- First: see: 02-target.md#Anchor-node',
      '- Second: see: 02-target.md#Anchor-node',
      '- Third: see: 02-target.md#Other-node',
    ].join('\n') + '\n';
    for (const ws of [aliased, expanded]) {
      write(ws, '_rules.yaml', rules);
      write(ws, '02-target.md', target);
    }
    write(aliased, '01-alpha.md', aSrc);
    write(expanded, '01-alpha.md', eSrc);

    const ja = parseJsonOut(runCli(['check', '--json'], aliased.root).out);
    const je = parseJsonOut(runCli(['check', '--json'], expanded.root).out);
    delete ja.summary.elapsedMs;
    delete je.summary.elapsedMs;
    // Both forms green: same refs counted, same everything.
    expect(ja.ok).toBe(true);
    expect(je.ok).toBe(true);
    expect(ja).toEqual(je);
    expect(ja.refs).toEqual({ total: 3, broken: 0, deepHops: 0 });
  });

  test('identical ERRORS too: a broken anchor behind an alias reports like the full spelling', () => {
    const aliased = makeWs('x1-broken-a');
    const expanded = makeWs('x1-broken-e');
    const rules = RULES_ON;
    const target = '- Anchor node\n';
    const aSrc = '- First: see: [1]\n- Second: see: [1]\n\n- [1]: 02-target.md#Nope\n';
    const eSrc = '- First: see: 02-target.md#Nope\n- Second: see: 02-target.md#Nope\n';
    for (const ws of [aliased, expanded]) {
      write(ws, '_rules.yaml', rules);
      write(ws, '02-target.md', target);
    }
    write(aliased, '01-alpha.md', aSrc);
    write(expanded, '01-alpha.md', eSrc);

    const ja = parseJsonOut(runCli(['check', '--json'], aliased.root).out);
    const je = parseJsonOut(runCli(['check', '--json'], expanded.root).out);
    delete ja.summary.elapsedMs;
    delete je.summary.elapsedMs;
    expect(ja.ok).toBe(false);
    expect(ja.counts).toEqual({ errors: 2, warnings: 0 });
    expect(ja.refs).toEqual({ total: 2, broken: 2, deepHops: 0 });
    expect(ja).toEqual(je); // the whole report — error text included — is identical
  });
});

// ── x2/x3: the structure engines measure the WRITTEN spelling ───────────────

describe('issue #57 x2/x3 — short uses and metadata definitions vs the structure budgets', () => {
  test('a use whose full target would exceed node_length passes as see: [1]', () => {
    const ws = makeWs('x2');
    write(ws, '_rules.yaml', [
      'references:',
      '  back_pointers: false',
      '  aliasing:',
      '    enabled: true',
      'structure:',
      '  node_length:',
      '    min: 3',
      '    max: 60',
    ].join('\n'));
    write(ws, '02-target.md', '- Anchor node with a very long anchor spelling\n');
    // Full spelling = 78 chars > 60; the aliased use = 21 chars.
    const long = '- Label text: see: 02-target.md#Anchor-node-with-a-very-long-anchor-spelling';
    write(ws, '01-alpha.md', [
      '- Label text: see: [1]',
      '- Second: see: [1]',
      long, // the control: the full spelling DOES trip
      '',
      // The definition holds the longest target in the file and must not
      // trip node_length either (contract 5: the problem is not relocated).
      `- [1]: 02-target.md#Anchor-node-with-a-very-long-anchor-spelling`,
    ].join('\n') + '\n');
    const j = parseJsonOut(runCli(['check', '--json'], ws.root).out);
    const longIssues = j.sections.structure.filter(
      (s: any) => s.rule === 'structure.node_length.max',
    );
    expect(longIssues).toHaveLength(1);
    expect(longIssues[0].file).toBe('01-alpha.md');
    expect(longIssues[0].line).toBe(3); // the full-spelling control, not the use, not the definition
    expect(j.refs).toEqual({ total: 3, broken: 0, deepHops: 0 }); // all three resolve
  });

  test('definitions are not nodes and not siblings', () => {
    const ws = makeWs('x3');
    write(ws, '_rules.yaml', [
      'references:',
      '  back_pointers: false',
      '  aliasing:',
      '    enabled: true',
      'structure:',
      '  siblings:',
      '    min: 1',
      '    max: 3',
    ].join('\n'));
    write(ws, '02-target.md', '- A\n- B\n- C\n');
    // 3 sibling nodes at root + 3 definition lines: if definitions counted
    // as siblings the cap (3) would trip.
    write(ws, '01-alpha.md', [
      '- One: see: [1]',
      '- Two: see: [1]',
      '- Three: see: [1]',
      '',
      '- [1]: 02-target.md#A',
      '- [2]: 02-target.md#B',
      '- [3]: 02-target.md#C',
    ].join('\n') + '\n');
    const j = parseJsonOut(runCli(['check', '--json'], ws.root).out);
    expect(j.ok).toBe(true);
    expect(j.summary.nodes).toBe(6); // 3 + the target's 3 — definitions excluded
    expect(j.sections.structure).toEqual([]);
  });
});

// ── x4–x7: the alias-layer verdicts ─────────────────────────────────────────

describe('issue #57 x4–x7 — broken, unused, undefined, disabled', () => {
  test('x4: broken target via alias = broken ref, counted, exit 2', () => {
    const ws = makeWs('x4');
    write(ws, '_rules.yaml', RULES_ON);
    write(ws, '01-alpha.md', '- A: see: [1]\n- B: see: [1]\n\n- [1]: 02-missing.md\n');
    const r = runCli(['check', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(2);
    expect(j.refs).toEqual({ total: 2, broken: 2, deepHops: 0 });
    const items = j.sections.refs.filter((s: any) => s.rule === 'refs.broken.file');
    expect(items).toHaveLength(2); // one per use — the same shape a full spelling mints
    expect(items[0].detail).toContain('02-missing.md');
  });

  test('x5: broken anchor via alias — error at the use line, naming the resolved target', () => {
    const ws = makeWs('x5');
    write(ws, '_rules.yaml', RULES_ON);
    write(ws, '02-target.md', '- Sessions\n');
    write(ws, '01-alpha.md', '- A: see: [1]\n- B: see: [1]\n\n- [1]: 02-target.md#Sesions\n');
    const r = runCli(['check'], ws.root);
    expect(r.exit).toBe(2);
    expect(r.out).toContain('broken anchor');
    expect(r.out).toContain('02-target.md#Sesions');
    expect(r.out).toContain('did you mean 02-target.md#Sessions?'); // #53 suggestions see through the alias
    const j = parseJsonOut(runCli(['check', '--json'], ws.root).out);
    expect(j.refs.broken).toBe(2);
    const anchorItems = j.sections.refs.filter((s: any) => s.rule === 'refs.broken.anchor');
    expect(anchorItems[0].items ?? anchorItems[0]).toBeTruthy();
  });

  test('x6: unused alias → warning; its broken target still fails the run', () => {
    const ws = makeWs('x6');
    write(ws, '_rules.yaml', RULES_ON);
    write(ws, '01-alpha.md', '- A: see: [1]\n- B: see: [1]\n\n- [1]: 02-target.md\n- [dead]: 02-missing.md\n');
    write(ws, '02-target.md', '- Tee node\n');
    const r = runCli(['check', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(2); // the broken DEFINITION fails the run with zero uses
    expect(j.counts).toEqual({ errors: 1, warnings: 1 });
    const unused = j.sections.refs.filter((s: any) => s.rule === 'refs.alias.unused');
    expect(unused).toHaveLength(1);
    expect(unused[0].line).toBe(5); // the definition line
    const broken = j.sections.refs.filter((s: any) => s.rule === 'refs.broken.file');
    expect(broken).toHaveLength(1); // verified through the ordinary refs machinery
    expect(j.refs.broken).toBe(1);
    expect(j.refs.total).toBe(2); // the two USES — definitions never count in refs.total
  });

  test('x7: undefined alias → error at the use site, dropped from the graph (no double report)', () => {
    const ws = makeWs('x7');
    write(ws, '_rules.yaml', RULES_ON);
    write(ws, '01-alpha.md', '- A: see: [nope]\n');
    const r = runCli(['check', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(2);
    expect(j.counts.errors).toBe(1);
    const items = j.sections.refs.filter((s: any) => s.rule === 'refs.alias.undefined');
    expect(items).toHaveLength(1);
    expect(items[0].file).toBe('01-alpha.md');
    expect(items[0].line).toBe(1);
    expect(j.sections.refs.filter((s: any) => s.rule === 'refs.prose')).toEqual([]);
    expect(j.refs.total).toBe(0); // dropped — it is an error, not a counted ref
  });

  test('x8: aliasing disabled + use or definition present = error, never a silent pass', () => {
    const ws = makeWs('x8');
    write(ws, '_rules.yaml', RULES_OFF); // no aliasing block → disabled defaults
    write(ws, '02-target.md', '- T\n');
    write(ws, '01-alpha.md', '- A: see: [1]\n- B: see: [1]\n\n- [1]: 02-target.md\n');
    const j = parseJsonOut(runCli(['check', '--json'], ws.root).out);
    expect(j.ok).toBe(false);
    const disabled = j.sections.refs.filter((s: any) => s.rule === 'refs.alias.disabled');
    expect(disabled).toHaveLength(3); // 2 uses + 1 definition — all stranded syntax
    expect(j.refs.total).toBe(0);
    expect(j.counts.errors).toBe(3);

    // explicit enabled: false behaves identically
    const ws2 = makeWs('x8-explicit');
    write(ws2, '_rules.yaml', 'references:\n  back_pointers: false\n  aliasing:\n    enabled: false\n');
    write(ws2, '02-target.md', '- Tee node\n');
    write(ws2, '01-alpha.md', '- A: see: [1]\n');
    const j2 = parseJsonOut(runCli(['check', '--json'], ws2.root).out);
    expect(j2.sections.refs.filter((s: any) => s.rule === 'refs.alias.disabled')).toHaveLength(1); // the use — no definition in this file
  });

  test('x9: scope is the defining file — no cross-file leakage, aux files resolve their own', () => {
    const ws = makeWs('x9');
    write(ws, '_rules.yaml', RULES_ON);
    write(ws, '02-target.md', '- Tee node\n');
    // 01 defines [1]; 02-uses.md uses [1] WITHOUT defining it → undefined
    // (footnote-like file scope), even though another file defines it.
    write(ws, '01-alpha.md', '- A: see: [1]\n- B: see: [1]\n\n- [1]: 02-target.md\n');
    write(ws, '03-beta.md', '- B: see: [1]\n- C: see: [1]\n');
    write(ws, '_tasks/fix.md', '- T1: see: [1]\n- T2: see: [1]\n\n- [1]: 02-target.md\n');
    const j = parseJsonOut(runCli(['check', '--json'], ws.root).out);
    const undef = j.sections.refs.filter((s: any) => s.rule === 'refs.alias.undefined');
    expect(undef).toHaveLength(2); // one per use in 03-beta — [1] does not leak from 01-alpha
    expect(undef.every((u: any) => u.file === '03-beta.md')).toBe(true);
    // the task file's own [1] resolved: no undefined error there, and 02-target.md
    // is NOT an orphan (referenced from 01-alpha and the task). 03-beta IS one:
    // its only refs were dropped (undefined) — it has no edges at all.
    const orphans = j.sections.refs.filter((s: any) => s.rule === 'refs.orphan');
    expect(orphans).toHaveLength(1);
    expect(orphans[0].file).toBe('03-beta.md');
    expect(j.refs.total).toBe(4); // 2 (01-alpha) + 0 (03-beta, dropped) + 2 (task)
  });

  test('x10: style enforcement — violation errors but the use still resolves', () => {
    const ws = makeWs('x10');
    write(ws, '_rules.yaml', 'references:\n  back_pointers: false\n  aliasing:\n    enabled: true\n    style: numeric\n');
    write(ws, '02-target.md', '- Tee node\n');
    write(ws, '01-alpha.md', [
      '- A: see: [1]',
      '- B: see: [1]',
      '- C: see: [named]',
      '- D: see: [named]',
      '',
      '- [1]: 02-target.md',
      '- [named]: 02-target.md',
    ].join('\n') + '\n');
    const j = parseJsonOut(runCli(['check', '--json'], ws.root).out);
    const style = j.sections.refs.filter((s: any) => s.rule === 'refs.alias.style');
    expect(style).toHaveLength(2); // one per violating use
    expect(style.every((s: any) => s.line >= 3)).toBe(true);
    // the violated use still resolved: no broken refs, no orphans
    expect(j.refs.broken).toBe(0);
    expect(j.sections.refs.filter((s: any) => s.rule === 'refs.orphan')).toEqual([]);
    expect(j.refs.total).toBe(4);

    // the mirror: style named + a numeric use
    const ws2 = makeWs('x10-mirror');
    write(ws2, '_rules.yaml', 'references:\n  back_pointers: false\n  aliasing:\n    enabled: true\n    style: named\n');
    write(ws2, '02-target.md', '- Tee node\n');
    write(ws2, '01-alpha.md', '- A: see: [1]\n- B: see: [1]\n\n- [1]: 02-target.md\n');
    const j2 = parseJsonOut(runCli(['check', '--json'], ws2.root).out);
    expect(j2.sections.refs.filter((s: any) => s.rule === 'refs.alias.style')).toHaveLength(2); // both numeric uses violate style: named
  });

  test('x11: min_uses — uses + full spellings count; zero-use is the unused warning', () => {
    const ws = makeWs('x11');
    write(ws, '_rules.yaml', RULES_ON); // min_uses: 2 (default)
    write(ws, '02-target.md', '- Tee node\n- Other node\n');
    write(ws, '01-alpha.md', [
      '- One: see: [lonely]',        // 1 use of [lonely] → below threshold → error
      '- Full: see: 02-target.md#Other-node', // a full spelling of [mixed]'s target
      '- Mixed: see: [mixed]',       // 1 use + 1 full = 2 ≥ 2 → clean
      '',
      '- [lonely]: 02-target.md#Tee-node',
      '- [mixed]: 02-target.md#Other-node',
    ].join('\n') + '\n');
    const j = parseJsonOut(runCli(['check', '--json'], ws.root).out);
    const minUses = j.sections.refs.filter((s: any) => s.rule === 'refs.alias.min_uses');
    expect(minUses).toHaveLength(1);
    expect(minUses[0].line).toBe(5); // the definition is the error site
    expect(j.refs.total).toBe(3);
    expect(j.ok).toBe(false);

    // min_uses: 3 — the mixed pair (2 total) now violates
    const ws2 = makeWs('x11-three');
    write(ws2, '_rules.yaml', 'references:\n  back_pointers: false\n  aliasing:\n    enabled: true\n    min_uses: 3\n');
    write(ws2, '02-target.md', '- Tee node\n');
    write(ws2, '01-alpha.md', '- A: see: [1]\n- B: see: [1]\n\n- [1]: 02-target.md\n');
    const j2 = parseJsonOut(runCli(['check', '--json'], ws2.root).out);
    expect(j2.sections.refs.filter((s: any) => s.rule === 'refs.alias.min_uses')).toHaveLength(1);
  });
});

// ── x12: external roots and traversal through definitions ───────────────────

describe('issue #57 x12 — #55 external roots through aliases', () => {
  test('a kelir:// definition target resolves via the declared root', () => {
    const base = makeWs('x12');
    mkdirSync(join(base.root, 'ext'), { recursive: true });
    writeFileSync(join(base.root, 'ext', 'file.md'), '- Ext node\n');
    write(base, '_rules.yaml', [
      'references:',
      '  back_pointers: false',
      '  aliasing:',
      '    enabled: true',
      '  external_roots:',
      '    kelir: ext',
    ].join('\n'));
    write(base, '01-alpha.md', '- A: see: [ext]\n- B: see: [ext]\n\n- [ext]: kelir://file.md#Ext-node\n');
    const j = parseJsonOut(runCli(['check', '--json'], base.root).out);
    expect(j.ok).toBe(true);
    expect(j.refs).toEqual({ total: 2, broken: 0, deepHops: 0 });
  });

  test('an undeclared root name via an alias gets the dedicated #55 error', () => {
    const ws = makeWs('x12-undecl');
    write(ws, '_rules.yaml', RULES_ON);
    write(ws, '01-alpha.md', '- A: see: [1]\n- B: see: [1]\n\n- [1]: kelir://file.md\n');
    const j = parseJsonOut(runCli(['check', '--json'], ws.root).out);
    const broken = j.sections.refs.filter((s: any) => s.rule === 'refs.broken.file');
    expect(broken).toHaveLength(2); // one per use
    expect(broken[0].detail).toContain('undeclared external root');
  });

  test('a traversal-escaping definition target is a broken ref (issue #10 stands)', () => {
    const ws = makeWs('x12-escape');
    write(ws, '_rules.yaml', RULES_ON);
    write(ws, '01-alpha.md', '- A: see: [1]\n- B: see: [1]\n\n- [1]: ../outside.md\n');
    const j = parseJsonOut(runCli(['check', '--json'], ws.root).out);
    const broken = j.sections.refs.filter((s: any) => s.rule === 'refs.broken.file');
    expect(broken).toHaveLength(2);
    expect(j.refs.broken).toBe(2);
  });
});

// ── x13: graph participation ────────────────────────────────────────────────

describe('issue #57 x13 — every use is a graph edge', () => {
  test('orphan detection sees alias-only references', () => {
    const ws = makeWs('x13-orphan');
    write(ws, '_rules.yaml', RULES_ON);
    write(ws, '02-linked.md', '- T\n');
    write(ws, '03-lonely.md', '- U\n');
    write(ws, '01-alpha.md', '- A: see: [1]\n- B: see: [1]\n\n- [1]: 02-linked.md\n');
    const j = parseJsonOut(runCli(['check', '--json'], ws.root).out);
    const orphans = j.sections.refs.filter((s: any) => s.rule === 'refs.orphan');
    expect(orphans).toHaveLength(1);
    expect(orphans[0].file).toBe('03-lonely.md'); // 02-linked is referenced via [1] only
  });

  test('a deep-hop chain through an aliased edge deep-hops, quoting the WRITTEN spelling', () => {
    const ws = makeWs('x13-hop');
    write(ws, '_rules.yaml', 'references:\n  back_pointers: false\n  aliasing:\n    enabled: true\n  max_hops: 1\n');
    // 01-near holds the aliased edge ([m] → 02-mid); 02-mid refs 03-far directly.
    write(ws, '01-near.md', '- Near: see: [m]\n- Near2: see: [m]\n\n- [m]: 02-mid.md\n');
    write(ws, '02-mid.md', '- Mid: see: 03-far.md\n- Mid2: see: 03-far.md\n');
    write(ws, '03-far.md', '- Far node\n');
    const j = parseJsonOut(runCli(['check', '--json'], ws.root).out);
    const hops = j.sections.refs.filter((s: any) => s.rule === 'refs.deep_hop');
    expect(hops).toHaveLength(1);
    expect(j.refs.deepHops).toBe(1);
    expect(j.refs.total).toBe(4);
    expect(hops[0].detail).toContain('DEEP HOP: 01-near.md → 02-mid.md → 03-far.md');
    // the advice names the edge as WRITTEN (the alias spelling on the line)
    expect(hops[0].suggestion).toContain('delete 01-near.md\'s "see: [m]" (line 1)');
  });

  test('a self-referencing alias is the ordinary self-reference error', () => {
    const ws = makeWs('x13-self');
    write(ws, '_rules.yaml', RULES_ON);
    write(ws, '01-alpha.md', '- A: see: [1]\n- B: see: [1]\n\n- [1]: 01-alpha.md\n');
    const j = parseJsonOut(runCli(['check', '--json'], ws.root).out);
    expect(j.sections.refs.filter((s: any) => s.rule === 'refs.self')).toHaveLength(2); // one per use
  });
});

// ── x14: ref-by marks through aliases ───────────────────────────────────────

describe('issue #57 x14 — back-pointers: an alias use earns its target\'s mark', () => {
  test('--fix writes the ref-by comment for alias uses (spec + task referrers)', () => {
    const ws = makeWs('x14');
    write(ws, '_rules.yaml', 'references:\n  back_pointers: true\n  aliasing:\n    enabled: true\n');
    write(ws, '02-target.md', '- Sessions\n');
    write(ws, '01-alpha.md', '- A: see: [1]\n- B: see: [1]\n\n- [1]: 02-target.md#Sessions\n');
    write(ws, '_tasks/fix.md', '- T1: see: [s]\n- T2: see: [s]\n\n- [s]: 02-target.md#Sessions\n');
    const r = runCli(['check', '--fix', '--yes'], ws.root);
    expect(r.exit).toBe(0);
    const marked = read(ws, '02-target.md');
    expect(marked).toBe('- Sessions <!-- ref-by: 01-alpha.md, _tasks/fix.md -->\n');
    // and the run reports the marks it wrote
    expect(r.out).toContain('ref-by');
  });

  test('`cans done` resolves the archived task\'s aliases (the extraReferrer source)', () => {
    const ws = makeWs('x14-done');
    write(ws, '_rules.yaml', 'references:\n  back_pointers: true\n  aliasing:\n    enabled: true\n');
    write(ws, '02-target.md', '- Sessions\n');
    write(ws, '00-overview.md', '- Overview: see: 02-target.md\n- Second: see: 02-target.md\n');
    write(ws, '_tasks/fix-thing.md', [
      '- [x] Do the thing',
      '- Ref: see: [1]',
      '- Ref2: see: [1]',
      '',
      '- [1]: 02-target.md#Sessions',
    ].join('\n') + '\n');
    const r = runCli(['done', 'fix-thing'], ws.root);
    expect(r.exit).toBe(0);
    // the task file is archived; its alias uses still earned the target's
    // ref-by mark (the pre-archive source rides along for resolution)
    expect(read(ws, '02-target.md')).toContain('ref-by: _tasks/fix-thing.md');
  });
});

// ── c1–c9: strict config validation ─────────────────────────────────────────

describe('issue #57 c1–c9 — references.aliasing config (strict #56 schema)', () => {
  function expectConfigError(r: { exit: number | null; out: string; err: string }, message: string): void {
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(false);
    expect(j.error).toBe(`invalid _rules.yaml: ${message}`);
    expect(j.sections.config[0].rule).toBe('config.invalid');
  }

  test('c1: typo sub-key rejects line-numbered', () => {
    const ws = makeWs('c1');
    write(ws, '_rules.yaml', 'references:\n  back_pointers: false\n  aliasing:\n    enabledd: true\n');
    write(ws, '01-alpha.md', '- A\n');
    expectConfigError(
      runCli(['check', '--json'], ws.root),
      'line 4 — unrecognized key "references.aliasing.enabledd" (issue #56: _rules.yaml is validated strictly — §18 documents the legal keys)',
    );
  });

  test('c2: bad style enum rejects', () => {
    const ws = makeWs('c2');
    write(ws, '_rules.yaml', 'references:\n  back_pointers: false\n  aliasing:\n    enabled: true\n    style: numbers\n');
    expectConfigError(
      runCli(['check', '--json'], ws.root),
      'line 5 — "references.aliasing.style" must be "numeric" or "named" or "both", got "numbers"',
    );
  });

  test('c3: wrong type for enabled rejects', () => {
    const ws = makeWs('c3');
    write(ws, '_rules.yaml', 'references:\n  aliasing:\n    enabled: "yes"\n');
    expectConfigError(
      runCli(['check', '--json'], ws.root),
      'line 3 — "references.aliasing.enabled" must be true or false, got "yes"',
    );
  });

  test('c4: min_uses 0 and 1.5 reject (integer >= 1)', () => {
    const ws = makeWs('c4');
    write(ws, '_rules.yaml', 'references:\n  aliasing:\n    enabled: true\n    min_uses: 0\n');
    expectConfigError(
      runCli(['check', '--json'], ws.root),
      'line 4 — "references.aliasing.min_uses" must be an integer >= 1, got "0"',
    );
    const ws2 = makeWs('c4b');
    write(ws2, '_rules.yaml', 'references:\n  aliasing:\n    enabled: true\n    min_uses: 1.5\n');
    expectConfigError(
      runCli(['check', '--json'], ws2.root),
      'line 4 — "references.aliasing.min_uses" must be an integer >= 1, got "1.5"',
    );
  });

  test('c5: scope is file-only in v1', () => {
    const ws = makeWs('c5');
    write(ws, '_rules.yaml', 'references:\n  aliasing:\n    enabled: true\n    scope: repo\n');
    expectConfigError(
      runCli(['check', '--json'], ws.root),
      'line 4 — "references.aliasing.scope" must be "file" (the only legal aliasing scope in v1 — issue #57), got "repo"',
    );
  });

  test('c6: a non-mapping aliasing block rejects', () => {
    const ws = makeWs('c6');
    write(ws, '_rules.yaml', 'references:\n  aliasing: on\n');
    expectConfigError(
      runCli(['check', '--json'], ws.root),
      'line 2 — "references.aliasing" must be a mapping like { enabled: true, scope: file, style: both, min_uses: 2 }, got "on"',
    );
  });

  test('c7: an empty aliasing block is legal and means the documented defaults', () => {
    const ws = makeWs('c7');
    write(ws, '_rules.yaml', 'references:\n  back_pointers: false\n  aliasing:\n');
    write(ws, '02-target.md', '- T\n');
    write(ws, '01-alpha.md', '- A: see: [1]\n'); // default enabled=false → error
    const j = parseJsonOut(runCli(['check', '--json'], ws.root).out);
    expect(j.sections.refs.filter((s: any) => s.rule === 'refs.alias.disabled')).toHaveLength(1);
  });

  test('c8: a partial block merges over the defaults', () => {
    const ws = makeWs('c8');
    write(ws, '_rules.yaml', 'references:\n  back_pointers: false\n  aliasing:\n    enabled: true\n');
    write(ws, '02-target.md', '- T\n');
    // only `enabled` listed: style defaults to both → a named alias is fine
    write(ws, '01-alpha.md', '- A: see: [hyper]\n- B: see: [hyper]\n\n- [hyper]: 02-target.md\n');
    const j = parseJsonOut(runCli(['check', '--json'], ws.root).out);
    expect(j.ok).toBe(true);
    expect(j.refs.total).toBe(2);
  });

  test('c9: no aliasing block at all — a full-pointer corpus is unchanged (contract 6)', () => {
    const ws = makeWs('c9');
    write(ws, '_rules.yaml', RULES_OFF);
    write(ws, '02-target.md', '- T\n');
    write(ws, '01-alpha.md', '- A: see: 02-target.md\n- B: see: 02-target.md\n');
    const j = parseJsonOut(runCli(['check', '--json'], ws.root).out);
    expect(j.ok).toBe(true);
    expect(j.refs).toEqual({ total: 2, broken: 0, deepHops: 0 });
    expect(j.sections.refs).toEqual([]);
  });
});

// ── e1–e11 + r1–r6: the expand/collapse switch ─────────────────────────────

describe('issue #57 e1–e11 — cans alias expand|collapse', () => {
  const FULL = [
    '- First: see: 02-target.md#Anchor-node',
    '- Second: see: 02-target.md#Anchor-node',
    '- Third: see: 02-target.md#Anchor-node',
    '- One-off: see: 02-target.md#Other-node',
    '',
    '- Trailing prose node',
  ].join('\n') + '\n';
  const COLLAPSED = [
    '- First: see: [1]',
    '- Second: see: [1]',
    '- Third: see: [1]',
    '- One-off: see: 02-target.md#Other-node',
    '',
    '- Trailing prose node',
    '',
    '- [1]: 02-target.md#Anchor-node',
  ].join('\n') + '\n';

  function setup(name: string, alpha: string): Ws {
    const ws = makeWs(name);
    write(ws, '_rules.yaml', RULES_ON);
    write(ws, '02-target.md', '- Anchor node\n- Other node\n');
    write(ws, '01-alpha.md', alpha);
    return ws;
  }

  test('e1: collapse aliases only min_uses-eligible targets, first-use numbering, definitions appended', () => {
    const ws = setup('e1', FULL);
    const r = runCli(['alias', 'collapse'], ws.root);
    expect(r.exit).toBe(0);
    expect(read(ws, '01-alpha.md')).toBe(COLLAPSED);
    const j = parseJsonOut(runCli(['alias', 'collapse', '--json'], ws.root).out);
    const alpha = j.results.find((x: any) => x.file === '01-alpha.md');
    expect(j.ok).toBe(true);
    expect(alpha.changed).toBe(false); // already collapsed — idempotent no-op
  });

  test('e2: expand restores full targets and removes definitions', () => {
    const ws = setup('e2', COLLAPSED);
    const r = runCli(['alias', 'expand'], ws.root);
    expect(r.exit).toBe(0);
    expect(read(ws, '01-alpha.md')).toBe(FULL);
  });

  test('e3: round trips — expand(collapse(f)) = f and collapse(expand(f)) = f', () => {
    const ws = setup('e3', FULL);
    runCli(['alias', 'collapse'], ws.root);
    expect(read(ws, '01-alpha.md')).toBe(COLLAPSED);
    runCli(['alias', 'expand'], ws.root);
    expect(read(ws, '01-alpha.md')).toBe(FULL);
    runCli(['alias', 'collapse'], ws.root);
    expect(read(ws, '01-alpha.md')).toBe(COLLAPSED);
  });

  test('e4: idempotence — second runs are byte-identical no-ops', () => {
    const ws = setup('e4', FULL);
    runCli(['alias', 'collapse'], ws.root);
    const once = read(ws, '01-alpha.md');
    const r2 = runCli(['alias', 'collapse'], ws.root);
    expect(read(ws, '01-alpha.md')).toBe(once);
    expect(r2.out).toContain('Nothing to collapse');
    runCli(['alias', 'expand'], ws.root);
    const expanded = read(ws, '01-alpha.md');
    const r4 = runCli(['alias', 'expand'], ws.root);
    expect(read(ws, '01-alpha.md')).toBe(expanded);
    expect(r4.out).toContain('Nothing to expand');
  });

  test('e5: style named derives deterministic names; style numeric numbers', () => {
    const ws = makeWs('e5-named');
    write(ws, '_rules.yaml', 'references:\n  back_pointers: false\n  aliasing:\n    enabled: true\n    style: named\n');
    write(ws, '02-target.md', '- Anchor node\n- Other node\n');
    write(ws, '01-alpha.md', '- A: see: 02-target.md#Anchor-node\n- B: see: 02-target.md#Anchor-node\n');
    runCli(['alias', 'collapse'], ws.root);
    expect(read(ws, '01-alpha.md')).toBe(
      '- A: see: [anchor-node]\n- B: see: [anchor-node]\n\n- [anchor-node]: 02-target.md#Anchor-node\n',
    );

    const ws2 = makeWs('e5-numeric');
    write(ws2, '_rules.yaml', 'references:\n  back_pointers: false\n  aliasing:\n    enabled: true\n    style: numeric\n');
    write(ws2, '02-target.md', '- Anchor node\n- Other node\n');
    write(ws2, '01-alpha.md', '- A: see: 02-target.md#Anchor-node\n- B: see: 02-target.md#Anchor-node\n- C: see: 02-target.md#Other-node\n');
    runCli(['alias', 'collapse'], ws2.root);
    // first-use order: Anchor-node (2 uses, eligible) → [1]; the one-off Other-node stays full
    expect(read(ws2, '01-alpha.md')).toBe(
      '- A: see: [1]\n- B: see: [1]\n- C: see: 02-target.md#Other-node\n\n- [1]: 02-target.md#Anchor-node\n',
    );
  });

  test('e6: existing definitions are kept and reused — no renumbering churn', () => {
    const ws = setup('e6', [
      '- First: see: [7]',
      '- Second: see: [7]',
      '- Third: see: 02-target.md#Other-node',
      '- Fourth: see: 02-target.md#Other-node',
      '',
      '- [7]: 02-target.md#Anchor-node',
    ].join('\n') + '\n');
    runCli(['alias', 'collapse'], ws.root);
    // [7] kept; the Other-node pair (2 uses ≥ min_uses) becomes [8] — numbered AFTER the highest existing
    expect(read(ws, '01-alpha.md')).toBe([
      '- First: see: [7]',
      '- Second: see: [7]',
      '- Third: see: [8]',
      '- Fourth: see: [8]',
      '',
      '- [7]: 02-target.md#Anchor-node',
      '- [8]: 02-target.md#Other-node',
    ].join('\n') + '\n');
  });

  test('e7: CRLF files stay CRLF through both directions', () => {
    const ws = setup('e7', FULL.replace(/\n/g, '\r\n'));
    runCli(['alias', 'collapse'], ws.root);
    const collapsed = read(ws, '01-alpha.md');
    expect(collapsed).toBe(COLLAPSED.replace(/\n/g, '\r\n'));
    expect(collapsed.includes('\r\n')).toBe(true);
    runCli(['alias', 'expand'], ws.root);
    expect(read(ws, '01-alpha.md')).toBe(FULL.replace(/\n/g, '\r\n'));
  });

  test('e8: --dry-run previews and writes nothing', () => {
    const ws = setup('e8', FULL);
    const r = runCli(['alias', 'collapse', '--dry-run'], ws.root);
    expect(r.exit).toBe(0);
    expect(r.out).toContain('[dry-run]');
    expect(r.out).toContain('Would collapse 1 file');
    expect(read(ws, '01-alpha.md')).toBe(FULL); // untouched
    const j = parseJsonOut(runCli(['alias', 'collapse', '--dry-run', '--json'], ws.root).out);
    expect(j.dryRun).toBe(true);
    expect(j.results.find((x: any) => x.file === '01-alpha.md').changed).toBe(true);
    expect(read(ws, '01-alpha.md')).toBe(FULL);
  });

  test('e9: [file] filter scopes the transform', () => {
    const ws = setup('e9', FULL);
    write(ws, '03-gamma.md', '- G: see: 02-target.md#Anchor-node\n- H: see: 02-target.md#Anchor-node\n');
    const r = runCli(['alias', 'collapse', '01-alpha.md'], ws.root);
    expect(r.exit).toBe(0);
    expect(read(ws, '01-alpha.md')).toBe(COLLAPSED);
    expect(read(ws, '03-gamma.md')).toBe('- G: see: 02-target.md#Anchor-node\n- H: see: 02-target.md#Anchor-node\n');
  });

  test('e10: usage errors — no direction, unknown direction, unknown flag, bad file filter', () => {
    const ws = setup('e10', FULL);
    expect(runCli(['alias'], ws.root).exit).toBe(2);
    expect(runCli(['alias', 'sideways'], ws.root).exit).toBe(2);
    expect(runCli(['alias', 'expand', '--bogus'], ws.root).exit).toBe(2);
    expect(runCli(['alias', 'expand', '99-nope.md'], ws.root).exit).toBe(2);
    // no cans workspace: a scratch dir WITHOUT a cans/ child
    const none = join(SCRATCH, `e10-nows-${++wsSeq}`);
    mkdirSync(none, { recursive: true });
    createdDirs.push(none);
    expect(runCli(['alias', 'expand'], none).exit).toBe(2);
  });

  test('e11: unit — collapse refusal cases leave the source byte-identical', () => {
    const refused = [
      '- A: see: [nope]\n',                                     // undefined alias
      '- A: see: [1]#Anchor\n\n- [1]: 02-target.md\n',          // anchored use
      '- A: see: [1]\n\n- [1]: 02-target.md\n- [1]: 03-x.md\n', // duplicate definition
      '- A: see: [1]\n\n- [Bad_Name]: 02-target.md\n',          // illegal name
      '- A: see: [1]\n\n- [1]: [2]\n',                          // alias-chained definition
    ];
    const cfg = defaultAliasing();
    for (const src of refused) {
      const out = collapseAliases(src, 'x.md', { ...cfg, enabled: true });
      expect(out.changed).toBe(false);
      expect(out.source).toBe(src);
      expect(out.problems.length).toBeGreaterThan(0);
      const outE = expandAliases(src, 'x.md');
      expect(outE.changed).toBe(false);
      expect(outE.source).toBe(src);
      expect(outE.problems.length).toBeGreaterThan(0);
    }
  });

  test('r1: expand refuses on an undefined alias — file untouched, problem named, exit 1', () => {
    const ws = setup('r1', '- A: see: [nope]\n');
    const src = read(ws, '01-alpha.md');
    const r = runCli(['alias', 'expand'], ws.root);
    expect(r.exit).toBe(1);
    expect(read(ws, '01-alpha.md')).toBe(src);
    expect(r.out).toContain('refused');
    expect(r.out).toContain('undefined alias [nope]');
  });

  test('r2: collapse refuses on style conflicts with the config', () => {
    const ws = makeWs('r2');
    write(ws, '_rules.yaml', 'references:\n  back_pointers: false\n  aliasing:\n    enabled: true\n    style: numeric\n');
    write(ws, '02-target.md', '- T\n');
    write(ws, '01-alpha.md', '- A: see: [named]\n- B: see: [named]\n\n- [named]: 02-target.md\n');
    const src = read(ws, '01-alpha.md');
    const r = runCli(['alias', 'collapse'], ws.root);
    expect(r.exit).toBe(1);
    expect(read(ws, '01-alpha.md')).toBe(src);
    expect(r.out).toContain('conflicts with references.aliasing.style');
  });

  test('r3: collapse refuses on a min_uses violation an existing alias perpetrates', () => {
    const ws = setup('r3', '- A: see: [1]\n\n- [1]: 02-target.md#Anchor-node\n'); // 1 use < 2
    const src = read(ws, '01-alpha.md');
    const r = runCli(['alias', 'collapse'], ws.root);
    expect(r.exit).toBe(1);
    expect(read(ws, '01-alpha.md')).toBe(src);
    expect(r.out).toContain('below references.aliasing.min_uses');
  });

  test('r4: collapse refuses on an unterminated code fence at EOF', () => {
    const ws = setup('r4', '- A: see: 02-target.md#Anchor-node\n- B: see: 02-target.md#Anchor-node\n\n```\nfenced\n');
    const src = read(ws, '01-alpha.md');
    const r = runCli(['alias', 'collapse'], ws.root);
    expect(r.exit).toBe(1);
    expect(read(ws, '01-alpha.md')).toBe(src);
    expect(r.out).toContain('unterminated code fence');
  });

  test('r5: collapse under a disabled config refuses (never mints files the checker rejects)', () => {
    const ws = makeWs('r5');
    write(ws, '_rules.yaml', RULES_OFF);
    write(ws, '02-target.md', '- T\n');
    write(ws, '01-alpha.md', '- A: see: 02-target.md\n- B: see: 02-target.md\n');
    const r = runCli(['alias', 'collapse'], ws.root);
    expect(r.exit).toBe(2);
    expect(r.out).toContain('references.aliasing.enabled is false');
    expect(read(ws, '01-alpha.md')).toBe('- A: see: 02-target.md\n- B: see: 02-target.md\n');
  });

  test('r6: expand is allowed under a disabled config (it is the migration path)', () => {
    const ws = makeWs('r6');
    write(ws, '_rules.yaml', RULES_OFF);
    write(ws, '02-target.md', '- Tee node\n');
    write(ws, '01-alpha.md', '- A: see: [1]\n- B: see: [1]\n\n- [1]: 02-target.md\n');
    const r = runCli(['alias', 'expand'], ws.root);
    expect(r.exit).toBe(0);
    expect(read(ws, '01-alpha.md')).toBe('- A: see: 02-target.md\n- B: see: 02-target.md\n');
    // and the workspace now checks clean with aliasing disabled
    expect(runCli(['check'], ws.root).exit).toBe(0);
  });
});

// ── p1–p4: prose safety ─────────────────────────────────────────────────────

describe('issue #57 p1–p4 — bracketed prose is never silently rewritten', () => {
  test('p1: multi-word brackets and mid-token brackets keep the pre-#57 prose treatment', () => {
    const ws = makeWs('p1');
    write(ws, '_rules.yaml', RULES_ON);
    write(ws, '01-alpha.md', [
      '- Wordy: see [the appendix]',   // space → token `[the` — not alias-shaped
      '- Midtok: see: [1]x',           // chars after ] — not alias-shaped
      '- Plain [hyper] mode node',     // no see: at all — invisible
    ].join('\n') + '\n');
    const j = parseJsonOut(runCli(['check', '--json'], ws.root).out);
    expect(j.sections.refs.filter((s: any) => s.rule === 'refs.alias.undefined')).toEqual([]);
    const prose = j.sections.refs.filter((s: any) => s.rule === 'refs.prose');
    expect(prose).toHaveLength(2); // lines 1 and 2 — the exact pre-#57 warning
    // collapse/expand leave the file byte-identical (nothing to do, no alias syntax)
    const src = read(ws, '01-alpha.md');
    runCli(['alias', 'collapse'], ws.root);
    runCli(['alias', 'expand'], ws.root);
    expect(read(ws, '01-alpha.md')).toBe(src);
  });

  test('p2: a single-word bracket after see IS an alias use — undefined → the contract-3 error', () => {
    const ws = makeWs('p2');
    write(ws, '_rules.yaml', RULES_ON);
    write(ws, '01-alpha.md', '- Prose-ish: see [appendix]\n');
    const j = parseJsonOut(runCli(['check', '--json'], ws.root).out);
    expect(j.sections.refs.filter((s: any) => s.rule === 'refs.alias.undefined')).toHaveLength(1);
  });

  test('p3: a parenthesized use resolves — the structural ] survives the #48 strip', () => {
    const ws = makeWs('p3');
    write(ws, '_rules.yaml', RULES_ON);
    write(ws, '02-target.md', '- T\n');
    write(ws, '01-alpha.md', '- A: (see: [1])\n- B: (see: [1])\n\n- [1]: 02-target.md\n');
    const j = parseJsonOut(runCli(['check', '--json'], ws.root).out);
    expect(j.ok).toBe(true);
    expect(j.refs.total).toBe(2);
  });

  test('p4: an anchored use is refused, not guessed', () => {
    const ws = makeWs('p4');
    write(ws, '_rules.yaml', RULES_ON);
    write(ws, '02-target.md', '- T\n');
    write(ws, '01-alpha.md', '- A: see: [1]#T\n\n- [1]: 02-target.md\n');
    const j = parseJsonOut(runCli(['check', '--json'], ws.root).out);
    const bad = j.sections.refs.filter((s: any) => s.rule === 'refs.alias.bad-use');
    expect(bad).toHaveLength(1);
    expect(j.refs.total).toBe(0);
  });
});

// ── w1: export resolves aliases ─────────────────────────────────────────────

describe('issue #57 w1 — export renders full targets, never [1]', () => {
  test('logseq/obsidian exports of an aliased file carry the resolved wikilinks', () => {
    const ws = makeWs('w1');
    write(ws, '_rules.yaml', RULES_ON);
    write(ws, '02-target.md', '- Anchor node\n');
    write(ws, '01-alpha.md', '- A: see: [1]\n- B: see: [1]\n\n- [1]: 02-target.md#Anchor-node\n');
    const r = runCli(['export', 'logseq', '--vault', join(ws.root, 'out')], ws.root);
    expect(r.exit).toBe(0);
    const exported = readFileSync(join(ws.root, 'out', 'logseq', '01-alpha.md'), 'utf8');
    expect(exported).toBe('- A: [[02-target/Anchor-node]]\n- B: [[02-target/Anchor-node]]\n');
    expect(exported).not.toContain('[1]');
    // definitions are metadata: they never reach the serializers at all
    expect(exported.trim().split('\n')).toHaveLength(2);
  });
});

// ── j1: the JSON wire shapes ────────────────────────────────────────────────

describe('issue #57 j1 — JSON wire shapes', () => {
  test('check --json groups alias findings in sections.refs; alias --json carries the outcome table', () => {
    const ws = makeWs('j1');
    write(ws, '_rules.yaml', RULES_ON);
    write(ws, '01-alpha.md', '- A: see: [nope]\n- B: see: [dead]\n- C: see: [dead]\n\n- [dead]: 02-missing.md\n- [unused]: 02-missing.md\n');
    const j = parseJsonOut(runCli(['check', '--json'], ws.root).out);
    const rules = [...new Set(j.sections.refs.map((s: any) => s.rule))].sort();
    expect(rules).toEqual(['refs.alias.undefined', 'refs.alias.unused', 'refs.broken.file']);
    // the broken-file items: 2 uses of [dead] + the unused [unused] definition,
    // all through the ordinary refs machinery
    expect(j.sections.refs.filter((s: any) => s.rule === 'refs.broken.file')).toHaveLength(3);
    // the undefined item carries line-level location in the flat wire shape
    const undef = j.sections.refs.find((s: any) => s.rule === 'refs.alias.undefined');
    expect(undef.file).toBe('01-alpha.md');
    expect(undef.line).toBe(1);
    expect(undef.detail).toContain('see [nope] — not defined in this file');

    const aj = parseJsonOut(runCli(['alias', 'expand', '--dry-run', '--json'], ws.root).out);
    expect(aj.command).toBe('alias');
    expect(aj.direction).toBe('expand');
    expect(aj.dryRun).toBe(true);
    expect(aj.ok).toBe(false); // the undefined alias refuses the file
    expect(aj.exitCode).toBe(1);
    const alpha = aj.results.find((x: any) => x.file === '01-alpha.md');
    expect(alpha.problems.length).toBeGreaterThan(0);
    expect(alpha.changed).toBe(false);
  });
});

// ── f1: --fix anchor repair through definitions ─────────────────────────────

describe('issue #57 f1 — --fix repairs the definition, resolving every use', () => {
  test('one definition-line rewrite fixes all uses of the alias', () => {
    const ws = makeWs('f1');
    write(ws, '_rules.yaml', RULES_ON);
    write(ws, '02-target.md', '- Sessions\n');
    write(ws, '01-alpha.md', '- A: see: [1]\n- B: see: [1]\n\n- [1]: 02-target.md#Sesions\n');
    const prop = runCli(['check', '--fix'], ws.root);
    expect(prop.out).toContain('--fix would rewrite: 01-alpha.md:4 #Sesions → #Sessions');
    const applied = runCli(['check', '--fix', '--yes'], ws.root);
    expect(applied.exit).toBe(0);
    expect(read(ws, '01-alpha.md')).toBe('- A: see: [1]\n- B: see: [1]\n\n- [1]: 02-target.md#Sessions\n');
  });
});

// ── b1: help surface ────────────────────────────────────────────────────────

describe('issue #57 b1 — CLI surface', () => {
  test('help lists the alias command with both directions', () => {
    const r = runCli(['help'], REPO);
    expect(r.out).toContain('alias expand|collapse');
    expect(r.out).toContain('expand: alias uses → full targets, definitions removed');
    expect(r.out).toContain('collapse: repeated full targets → definitions + short uses');
  });
});
