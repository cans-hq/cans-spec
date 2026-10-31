/**
 * Issue #61 — CLI surface: the `--structure` / `--structure=strict`
 * execution gates.
 *
 * The issue adds explicit execution gates to `cans check` without overriding
 * `_rules.yaml` severities:
 *   - `--structure` runs ONLY the structural lint cluster (checkStructure
 *     incl. the new structure.multiline policy + checkTbdPolicy — content
 *     rules are category 'structure'), the exact mirror of `--refs-only`:
 *     style, refs (broken/deep-hop/orphan/alias/back-pointer stale) and
 *     redundancy findings are suppressed; the ref graph is still built so
 *     files/nodes/refs.total stay populated; no --fix rewrites happen.
 *   - `--structure=strict` promotes every remaining category:'structure'
 *     warning to level:'error' IN the issues array BEFORE the counts, so the
 *     exit code, errorCount and the --json levels can never disagree.
 *   - `--refs-only` keeps its clean 0-hop graph-only gate contract.
 *
 * Test map:
 *   a–d ... args.ts: the generic opt-in `--flag=value` spelling — boolean
 *          flag bare/=value/`a=b`/empty edges, value-flag alias, and the
 *          §20 rejection every NON-opt-in flag keeps (QA-06 F4 / QA-14 F3)
 *   e–h ... parseCheckArgs: bare/strict parse, the three pinned usage errors
 *          (structure+refs-only, structure+fix, --structure=<not strict>),
 *          plain-run zero change, positional-after-gate = [file] filter
 *   i–m ... the gate end-to-end (spawned CLI, --json + human): only
 *          structure+content findings in a mixed workspace, count fields
 *          coherent (refs.total populated, finding-derived refs counters 0),
 *          content findings ride the gate, --refs-only regression guard
 *   n–q ... strict promotion: exit 2 / ok:false / counts move with the
 *          levels, JSON levels == counts, promotion needs the gate (plain
 *          run unchanged), content.tbd promotes too (category 'structure')
 *   r–s ... help documents both spellings; default rulesSummary byte-identical
 *   t ..... granular rulesSummary knob brackets — gated on the #61 config
 *          keys being accepted by loadRules (sibling branch
 *          fix/issue-61-config): explicit SKIP until that merge, never a
 *          silent green
 */
import { describe, test, expect, afterEach, afterAll } from '../testing.ts';
import { join } from 'path';
import { rmSync, readFileSync } from 'fs';

import { parseCheckArgs } from '../../src/commands/check.ts';
import { parseArgs, type FlagSpec } from '../../src/core/args.ts';
import { loadRules } from '../../src/core/rules.ts';
import { spawnCli, REPO } from '../runtime.ts';
import { makeCansWorkspace } from '../helpers.ts';

// ── CLI scaffolding (mirrors test/issues/issue-53-fix-anchor-repair.test.ts) ──

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-61-cli');
const createdDirs: string[] = [];

/** issue-50.test.ts scaffolding: the CLI runs from the PARENT of cans/ (the
 *  workspace is discovered below cwd). */
function makeWs(name: string, files: Record<string, string>): { tmp: string; root: string } {
  const tmp = join(SCRATCH, `${name}-${createdDirs.length + 1}`);
  const root = makeCansWorkspace(tmp, files);
  createdDirs.push(tmp);
  return { tmp, root };
}

function runCli(args: string[], cwd: string) {
  return spawnCli(args, cwd, { ...process.env, CANS_ROOT: '' });
}

/** JSON-mode output must be a single JSON document; a parse failure is itself
 *  an assertion failure. Reconstitutes the flat issues view from sections. */
function parseJsonOut(out: string): any {
  let parsed: unknown = null;
  let parseError: unknown = null;
  try {
    parsed = JSON.parse(out);
  } catch (e) {
    parseError = e;
  }
  expect(parseError).toBeNull();
  const j = parsed as Record<string, unknown> | null;
  if (j !== null && typeof j === 'object' && (j as any).sections !== undefined && (j as any).issues === undefined) {
    (j as any).issues = Object.entries((j as any).sections as Record<string, any[]>).flatMap(([category, arr]) =>
      arr.map((i) => ({ ...i, category, message: i.detail })),
    );
  }
  return parsed;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    rmSync(createdDirs.pop()!, { recursive: true, force: true });
  }
});
afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

// ── Corpora ──

/** Mixed corpus: 2 structure warnings (single_child, node_length.min on
 *  "zz"), 1 style warning (collapse-to-sibling under "Subsystem map"), 1 refs
 *  error (broken file target gone.md), 1 valid file-level ref (graph counts),
 *  and 1 slug-confusable node (em dash → exactly 1 hint for the plain run's
 *  refs.hintCount discoverability signal, which the gate must NOT count). */
const MIXED_FILES = {
  '00-overview.md': [
    '- Product overview',
    '  - Subsystem map',
    '    - Leaf alpha',
    '    - Leaf beta',
    '- zz',
    '',
  ].join('\n'),
  '01-auth.md': [
    '- Authentication module (see: 00-overview.md)',
    '- Token \u2014 hygiene',
    '- Session storage (see: gone.md)',
    '',
  ].join('\n'),
};

/** Content corpus: six TBD nodes exceed content.max_tbd_per_file (default
 *  5) → one content.tbd.max warning (category 'structure' — rides the gate
 *  and the strict promotion). The plain run also carries one orphan warning
 *  (refs) and one keyword-sprawl warning ("tbd" × 6, redundancy) — exactly
 *  the two clusters the gate suppresses. All other words are distinct so the
 *  sprawl corpus stays a single deterministic warning. */
const TBD_FILES = {
  '02-tbd.md': [
    '- TBD alpha migration',
    '- TBD bravo rollout',
    '- TBD charlie sequence',
    '- TBD delta mapping',
    '- TBD echo ledger',
    '- TBD foxtrot charter',
    '',
  ].join('\n'),
};

/** Refs-clean corpus with a structure warning: the plain run warns
 *  (single_child), the --refs-only gate is clean — pinning "Preserves
 *  `cans check --refs-only` as a clean 0-hop graph-only gate". */
const REFS_CLEAN_FILES = {
  '00-alpha.md': '- Alpha root\n  - Solo child\n',
  '00-beta.md': '- Beta home (see: 00-alpha.md)\n',
};

/** issue #61 knob config: every granular key non-default. The full structure
 *  section is spelled out so §18 curated-config delete semantics keep
 *  siblings/depth at their defaults (a listed section's omitted check-keys
 *  read as deleted → off — not what this corpus wants to show). */
const KNOB_RULES = [
  'structure:',
  '  node_length:',
  '    min: 3',
  '    max: 60',
  '    unit: words',
  '    scope: title',
  '    strip_references: true',
  '    severity: error',
  '  siblings:',
  '    min: 1',
  '    max: 12',
  '  depth:',
  '    min: 1',
  '    max: 5',
  '  single_child_collapse: true',
  '  empty_nodes: false',
  '  multiline:',
  '    mode: forbid',
  '    max_lines: 4',
  '    indent_aligned: true',
  '    severity: error',
  '',
].join('\n');

/** issue #61: the granular knob keys (node_length unit/scope/strip/severity,
 *  structure.multiline) are accepted by loadRules only once the #61 config
 *  normalization lands (sibling branch fix/issue-61-config merges into this
 *  one; before that, strict §18 validation rejects them as unrecognized
 *  keys). Probe once with a throwaway workspace — the knob-summary test runs
 *  for real when supported and reports as an explicit SKIP before that,
 *  never a silent green. */
const KNOBS_SUPPORTED = (() => {
  const probe = join(SCRATCH, 'knob-probe');
  try {
    const root = makeCansWorkspace(probe, { '_rules.yaml': KNOB_RULES });
    loadRules(root);
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
})();

// ── args.ts: the generic opt-in `--flag=value` spelling ─────────────────────

describe('issue #61: args.ts — opt-in equals spelling (generic §20 capability)', () => {
  const SPEC: FlagSpec[] = [
    { name: 'gate', boolean: true, equals: true },
    { name: 'plain', boolean: true },
    { name: 'pick', boolean: false },
    { name: 'pick-eq', boolean: false, equals: true },
  ];

  test('a: boolean flag with equals — bare is true, =value rides verbatim', () => {
    expect(parseArgs(['--gate'], SPEC).flags.get('gate')).toBe(true);
    expect(parseArgs(['--gate=strict'], SPEC).flags.get('gate')).toBe('strict');
    // the FIRST `=` splits the token: the value itself may contain `=`
    expect(parseArgs(['--gate=a=b'], SPEC).flags.get('gate')).toBe('a=b');
    // empty value stays '' for the command layer to reject — a typo must
    // never silently read as the bare boolean form
    expect(parseArgs(['--gate='], SPEC).flags.get('gate')).toBe('');
  });

  test('b: flags without equals keep the §20 rejection (QA-06 F4 / QA-14 F3)', () => {
    const r = parseArgs(['--plain=1'], SPEC);
    expect(r.errors).toEqual(['invalid flag form "--plain=1" — use "--plain <value>"']);
    expect(r.flags.has('plain')).toBe(false);
  });

  test('c: value flag with equals — the spelling aliases `--flag value`', () => {
    expect(parseArgs(['--pick-eq=one'], SPEC).flags.get('pick-eq')).toBe('one');
    expect(parseArgs(['--pick-eq', 'one'], SPEC).flags.get('pick-eq')).toBe('one');
    // `=value` never eats the next positional
    const r = parseArgs(['--pick-eq=one', 'file.md'], SPEC);
    expect(r.flags.get('pick-eq')).toBe('one');
    expect(r.positional).toEqual(['file.md']);
    // and a bare value flag still requires its value
    expect(parseArgs(['--pick'], SPEC).errors).toEqual(['flag "--pick" requires a value']);
  });

  test('d: unknown flag in equals form keeps the invalid-form diagnosis', () => {
    const r = parseArgs(['--nope=1'], SPEC);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('invalid flag form "--nope=1"');
  });
});

// ── parseCheckArgs: the --structure flag surface ────────────────────────────

describe('issue #61: parseCheckArgs — the --structure gate flags', () => {
  test('e: bare --structure gates on; a plain run carries no gate (zero change)', () => {
    expect(parseCheckArgs(['--structure']).structure).toBe(true);
    expect(parseCheckArgs([]).structure).toBeUndefined();
    expect(parseCheckArgs(['--json']).structure).toBeUndefined();
    expect(parseCheckArgs([]).errors).toEqual([]);
  });

  test('f: --structure=strict is gate + promotion', () => {
    const p = parseCheckArgs(['--structure=strict']);
    expect(p.structure).toBe('strict');
    expect(p.errors).toEqual([]);
  });

  test('g: the three pinned usage errors name the conflict and the legal value', () => {
    const a = parseCheckArgs(['--structure', '--refs-only']);
    expect(a.errors).toEqual([
      '"--structure" and "--refs-only" are mutually exclusive — separate engine gates, pick one',
    ]);
    const b = parseCheckArgs(['--structure=strict', '--fix']);
    expect(b.errors).toEqual([
      '"--structure" and "--fix" are mutually exclusive — the structure gate has no auto-fix',
    ]);
    const c = parseCheckArgs(['--structure=loose']);
    expect(c.errors).toEqual(['unknown --structure value "loose" — use strict']);
    // the empty spelling is a typo, never a silent bare gate
    expect(parseCheckArgs(['--structure=']).errors).toEqual(['unknown --structure value "" — use strict']);
    // a stray `=` inside the value keeps the one-diagnosis shape
    expect(parseCheckArgs(['--structure=strict=x']).errors).toEqual([
      'unknown --structure value "strict=x" — use strict',
    ]);
  });

  test('g2: the usage errors exit 2 end-to-end with the §37 trailer', () => {
    const ws = makeWs('usage-errors', MIXED_FILES);
    for (const [args, needle] of [
      [['check', '--structure', '--refs-only'], 'mutually exclusive'],
      [['check', '--structure=strict', '--fix'], 'no auto-fix'],
      [['check', '--structure=warn'], 'use strict'],
    ] as Array<[string[], string]>) {
      const r = runCli(args, ws.tmp);
      expect(r.exit).toBe(2);
      expect(r.out).toContain(needle);
      expect(r.out).toContain('Run `cans help` for valid check flags.');
    }
  });

  test('h: a positional after --structure is the [file] filter, not a value', () => {
    const p = parseCheckArgs(['--structure', '00-overview.md']);
    expect(p.structure).toBe(true);
    expect(p.file).toBe('00-overview.md');
    expect(p.errors).toEqual([]);
  });
});

// ── The gate end-to-end ─────────────────────────────────────────────────────

describe('issue #61: the structure gate end-to-end (mirror of --refs-only)', () => {
  test('i: bare --structure emits ONLY structure+content findings in a mixed workspace', () => {
    const ws = makeWs('mixed', MIXED_FILES);
    const plain = parseJsonOut(runCli(['check', '--json'], ws.tmp).out);
    // the plain run sees all three engines…
    expect(plain.counts.errors).toBe(1); // refs.broken.file
    expect(plain.counts.warnings).toBe(3); // 2 structure + 1 style
    // …the gate keeps the structural lint cluster only — every emitted
    // issue is category 'structure' by construction (content rules included).
    const gate = parseJsonOut(runCli(['check', '--structure', '--json'], ws.tmp).out);
    expect(gate.exitCode).toBe(1);
    expect(gate.ok).toBe(true);
    expect(gate.counts.errors).toBe(0);
    expect(gate.counts.warnings).toBe(2);
    expect(gate.issues.length).toBe(2);
    for (const i of gate.issues) expect(i.category).toBe('structure');
    expect(gate.issues.map((i: any) => i.rule).sort()).toEqual([
      'structure.node_length.min',
      'structure.single_child',
    ]);
  });

  test('j: the ref graph still counts — refs findings and their counters do not', () => {
    const ws = makeWs('counts', MIXED_FILES);
    const gate = parseJsonOut(runCli(['check', '--structure', '--json'], ws.tmp).out);
    // workspace statistics stay populated (the graph is built)…
    expect(gate.summary.files).toBe(2);
    expect(gate.summary.nodes).toBe(8);
    expect(gate.refs.total).toBe(2); // both see: refs counted, broken one included
    // …finding-derived refs counters stay 0, coherent with the suppressed findings
    expect(gate.refs.broken).toBe(0);
    expect(gate.refs.deepHops).toBe(0);
    expect(gate.backPointers).toEqual({ total: 0, current: 0, stale: 0 });
    // the slug-hint info band is refs-cluster: not counted under the gate —
    // while the plain run's discoverability integer is exactly the 1 hint
    expect(gate.refs.hintCount).toBeUndefined();
    const plain = parseJsonOut(runCli(['check', '--json'], ws.tmp).out);
    expect(plain.refs.hintCount).toBe(1);
  });

  test('k: content findings ride the gate (content rules are category structure)', () => {
    const ws = makeWs('tbd', TBD_FILES);
    const plain = parseJsonOut(runCli(['check', '--json'], ws.tmp).out);
    // tbd.max + orphan (refs) + "tbd" keyword sprawl (redundancy)
    expect(plain.counts.warnings).toBe(3);
    const gate = parseJsonOut(runCli(['check', '--structure', '--json'], ws.tmp).out);
    expect(gate.counts.warnings).toBe(1);
    expect(gate.counts.errors).toBe(0);
    expect(gate.sections.structure).toHaveLength(1);
    expect(gate.sections.structure[0].rule).toBe('content.tbd.max');
  });

  test('l: --refs-only stays the clean graph-only gate (issue #61 regression guard)', () => {
    const ws = makeWs('refs-clean', REFS_CLEAN_FILES);
    const plain = runCli(['check'], ws.tmp);
    expect(plain.exit).toBe(1); // the single_child warning lives in the full run
    const ro = runCli(['check', '--refs-only'], ws.tmp);
    expect(ro.exit).toBe(0); // graph-only: clean, 0 hops
    expect(ro.out).toContain('\u2713'); // ✓ mark
    const j = parseJsonOut(runCli(['check', '--refs-only', '--json'], ws.tmp).out);
    expect(j.ok).toBe(true);
    expect(j.exitCode).toBe(0);
    expect(j.counts.errors).toBe(0);
    expect(j.counts.warnings).toBe(0);
  });

  test('m: human output — the gate scopes sections; nothing rewrites', () => {
    const ws = makeWs('human', MIXED_FILES);
    const before = readBytes(ws.root);
    const bare = runCli(['check', '--structure'], ws.tmp);
    expect(bare.exit).toBe(1);
    expect(bare.out).toContain('STRUCTURE  \u26a0 2');
    expect(bare.out).not.toContain('STYLE');
    expect(bare.out).not.toContain('REFS');
    expect(bare.out).toContain('RULES'); // the §22 line rides every mode
    const strict = runCli(['check', '--structure=strict'], ws.tmp);
    expect(strict.exit).toBe(2);
    expect(strict.out).toContain('STRUCTURE  \u2717 2');
    // no --fix is possible under the gate — bytes identical either way
    expect(readBytes(ws.root)).toEqual(before);
  });
});

// ── Strict promotion ────────────────────────────────────────────────────────

describe('issue #61: --structure=strict promotes structure warnings to fatal', () => {
  test('n: warnings become errors — exit 2, ok false, counts move with the levels', () => {
    const ws = makeWs('strict', MIXED_FILES);
    const bare = parseJsonOut(runCli(['check', '--structure', '--json'], ws.tmp).out);
    const strict = parseJsonOut(runCli(['check', '--structure=strict', '--json'], ws.tmp).out);
    expect(bare.exitCode).toBe(1);
    expect(bare.ok).toBe(true);
    expect(strict.exitCode).toBe(2);
    expect(strict.ok).toBe(false);
    // the promoted set is exactly the bare gate's warning set
    expect(strict.counts.errors).toBe(bare.counts.warnings);
    expect(strict.counts.warnings).toBe(0);
  });

  test('o: the JSON levels are consistent with the counts (one issues array)', () => {
    const ws = makeWs('strict-levels', MIXED_FILES);
    const strict = parseJsonOut(runCli(['check', '--structure=strict', '--json'], ws.tmp).out);
    const entries = Object.values(strict.sections).flat() as any[];
    expect(entries.length).toBe(2);
    for (const e of entries) expect(e.level).toBe('error');
    expect(entries.filter((e: any) => e.level === 'error').length).toBe(strict.counts.errors);
  });

  test('p: promotion needs the gate — a plain check keeps the same findings as warnings', () => {
    const ws = makeWs('no-promote', MIXED_FILES);
    const plain = parseJsonOut(runCli(['check', '--json'], ws.tmp).out);
    expect(plain.exitCode).toBe(2); // the broken ref is the only error
    expect(plain.counts.errors).toBe(1);
    expect(plain.counts.warnings).toBe(3); // structure warnings UNpromoted
    for (const e of plain.sections.structure) expect(e.level).toBe('warning');
  });

  test('q: content.tbd rides the promotion too (category structure)', () => {
    const ws = makeWs('strict-tbd', TBD_FILES);
    const gate = parseJsonOut(runCli(['check', '--structure', '--json'], ws.tmp).out);
    expect(gate.exitCode).toBe(1);
    const strict = parseJsonOut(runCli(['check', '--structure=strict', '--json'], ws.tmp).out);
    expect(strict.exitCode).toBe(2);
    expect(strict.ok).toBe(false);
    expect(strict.counts.errors).toBe(1); // the promoted content.tbd.max
    expect(strict.counts.warnings).toBe(0);
    expect(strict.sections.structure[0].rule).toBe('content.tbd.max');
    expect(strict.sections.structure[0].level).toBe('error');
  });
});

// ── Help + rulesSummary ─────────────────────────────────────────────────────

describe('issue #61: help and rulesSummary surface', () => {
  test('r: help documents --structure and --structure=strict', () => {
    const ws = makeWs('help', MIXED_FILES);
    const h = runCli(['help'], ws.tmp);
    expect(h.exit).toBe(0);
    expect(h.out).toContain('[--refs-only] [--structure[=strict]] [--no-redundancy]');
    expect(h.out).toContain('--structure lints structure only');
    expect(h.out).toContain('--structure=strict promotes every structure warning to a fatal error');
  });

  test('s: default rulesSummary is byte-identical to v0.10 (no knobs, no brackets)', () => {
    const ws = makeWs('default-summary', MIXED_FILES);
    const j = parseJsonOut(runCli(['check', '--json'], ws.tmp).out);
    expect(j.rulesSummary).toBe('node_length: 3\u2013120 | siblings: 1\u201312 | depth: 1\u20135');
  });

  (KNOBS_SUPPORTED ? test : test.skip)(
    't: granular knobs ride the summary when non-default (needs fix/issue-61-config)',
    () => {
      const ws = makeWs('knob-summary', {
        '_rules.yaml': KNOB_RULES,
        '00-overview.md': '- Overview\n  - Scope\n',
      });
      const j = parseJsonOut(runCli(['check', '--json'], ws.tmp).out);
      expect(j.rulesSummary).toBe(
        'node_length[words\u00b7title\u00b7strip\u00b7error]: 3\u201360' +
          ' | siblings: 1\u201312 | depth: 1\u20135' +
          ' | multiline[forbid\u00b7max4\u00b7aligned\u00b7error]',
      );
      // the human compact line keeps the brackets attached to the compact keys
      const h = runCli(['check'], ws.tmp);
      expect(h.out).toContain('len[words\u00b7title\u00b7strip\u00b7error] 3\u201360');
      expect(h.out).toContain('multiline[forbid\u00b7max4\u00b7aligned\u00b7error]');
    },
  );
});

// ── helpers ─────────────────────────────────────────────────────────────────

/** Concatenated spec-file bytes — byte-identity evidence for "no rewrites". */
function readBytes(root: string): string[] {
  return ['00-overview.md', '01-auth.md'].map(rel => readFileSync(join(root, rel), 'utf-8'));
}
