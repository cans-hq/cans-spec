/**
 * Issue #65 — the CHECK ENGINE half: the plugin tier.
 *
 * The contract commit (f1c3450) landed `references.aliasing.include` +
 * `discoverAliasingFiles`. This suite pins what the ENGINE does with them:
 * configured plugin files (`cans/plugins/*.md`, the kelir profile.md case)
 * join the checked file set and their refs/aliases verify exactly like
 * corpus files' do — real parsing, real graph participation, real
 * verification, no faking.
 *
 * Test map:
 *   a1-a2 .. a plugin file's `#leaf` refs into a YAML fixture artifact are
 *           counted (refs.total) and verified — a missing leaf errors
 *           refs.broken.anchor naming the FULL resolved target; no
 *           structure/style finding exists for the plugin file
 *   b1-b2 .. orphan relief through the graph: a target referenced ONLY from
 *           a plugin file is not orphaned; with the include removed it is —
 *           proving graph participation, not message cosmetics
 *   c1-c3 .. finishAliasChecks covers the tier: a broken zero-use definition
 *           fails the run (exit 2, resolved target named); an unused valid
 *           definition is a warning; a use below min_uses is an error
 *   d1 ..... alias-identity: a plugin file written with alias uses produces
 *           the SAME refs layer as its expanded twin (same totals, same
 *           issues, same exit) — graph-identity of the refs layer
 *   e1 ..... plugin refs never promote a subfolder .md target (the promotion
 *           loop walks specFiles only) — the target stays outside the
 *           corpus, never structure-checked, while the ref still counts
 *   f1-f2 .. named-file check on a plugin file proceeds: files: 1, its
 *           refs-layer findings, correct exit; the pathless spelling agrees
 *   g1-g2 .. the enhanced §37 refusal: an existing outside-corpus workspace
 *           .md names the knob (references.aliasing.include); a missing
 *           file, a `_tasks/` file and AGENTS.md keep the classic message
 *   h1-h2 .. byte-identical pre-#65 behavior: aliasing enabled WITHOUT
 *           include, and aliasing disabled WITH include — the plugin file
 *           is not loaded (even a tab-broken one stays silent), refs stay
 *           corpus-only
 *   i1-i2 .. --fix never rewrites plugin sources: plain --fix (propose) and
 *           --fix --yes (apply) both leave the plugin file byte-identical;
 *           the apply run's post-repair graph rebuild keeps the tier, so the
 *           plugin referrer's ref-by mark lands on the spec target
 *   j1-j2 .. definitions are file metadata, never nodes: a >120-char
 *           definition line trips no node_length (and a clean tier is a
 *           clean run); a tab-broken plugin file is an explicit parse.error
 *           while the same breakage in an aux file skips silently (the
 *           hardening)
 *   k1-k2 .. the gates: --refs-only includes the plugin findings (they ARE
 *           refs-layer); --structure suppresses them while the graph — and
 *           refs.total — still describe the tier
 *
 * Runtime-neutral: imports the test facade, never 'bun:test' directly.
 */
import { describe, test, expect, afterEach } from './testing.ts';
import { join } from 'path';
import { readFileSync, rmSync } from 'fs';

import { spawnCli, REPO } from './runtime.ts';
import { makeCansWorkspace } from './helpers.ts';

// ── Scaffolding (mirrors test/issues/issue-58-anchors.test.ts) ──────────────

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-65-engine');
const createdDirs: string[] = [];

function makeWs(name: string, files: Record<string, string>): { tmp: string; root: string } {
  const tmp = join(SCRATCH, `${name}-${createdDirs.length + 1}`);
  const root = makeCansWorkspace(tmp, files);
  createdDirs.push(tmp);
  return { tmp, root };
}

function runCli(args: string[], cwd: string) {
  return spawnCli(args, cwd, { ...process.env, CANS_ROOT: '' });
}

function parseJsonOut(out: string): any {
  let parsed: unknown = null;
  let parseError: unknown = null;
  try {
    parsed = JSON.parse(out);
  } catch (e) {
    parseError = e;
  }
  expect(parseError).toBeNull();
  // issue #41: check --json emits sections.{category}[] entries
  // ({file,line,level,rule,detail}); reconstitute a flat issues view so the
  // assertions read like the engine's own Issue[].
  const j = parsed as Record<string, unknown> | null;
  if (j !== null && typeof j === 'object' && (j as any).sections !== undefined && (j as any).issues === undefined) {
    (j as any).issues = Object.entries((j as any).sections as Record<string, any[]>).flatMap(([category, arr]) =>
      arr.map((i) => ({ ...i, category, message: i.detail })),
    );
  }
  return parsed;
}

function readWs(root: string, rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

afterEach(() => {
  while (createdDirs.length > 0) {
    rmSync(createdDirs.pop()!, { recursive: true, force: true });
  }
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** The kelir-style YAML artifact (issue #58 leaf-anchor machinery): the
 *  `#invariants.*` dot paths resolve to scalar leaves. */
const KELIR_YAML = [
  'invariants:',
  '  default_zero_capability: true',
  '  no_silent_writes: true',
  '  atomic_handoff: true',
  '',
].join('\n');

/** A clean two-file corpus: mutual refs (one SCC mesh — no deep hops), no
 *  single-child shapes, no text overlap — refs.total 2, zero findings. */
const OVERVIEW = '- Overview: see 01-core.md\n';
const CORE = '- Core\n  - Back: see 00-overview.md\n  - Ledger item alpha\n';

/** The plugin file under test: two verified leaves + one missing leaf. */
const PROFILE_BROKEN = [
  '- Kelir profile',
  '  - default zero: see: artifacts/examples/fixtures/kelir.yaml#invariants.default_zero_capability',
  '  - silent writes: see: artifacts/examples/fixtures/kelir.yaml#invariants.no_silent_writes',
  '  - gone: see: artifacts/examples/fixtures/kelir.yaml#invariants.missing_leaf',
  '',
].join('\n');

const BROKEN_MSG = 'broken anchor: artifacts/examples/fixtures/kelir.yaml#invariants.missing_leaf — no node matches';

/** The tier's ruleset: aliasing ON (the include gate requires it), the
 *  kelir plugin glob, back-pointers off unless a test needs them. */
function rulesYaml(opts: { include?: string | null; minUses?: number; backPointers?: boolean; aliasing?: boolean } = {}): string {
  const lines = [
    'references:',
    '  max_hops: 1',
    `  back_pointers: ${opts.backPointers === true}`,
    '  orphan_check: true',
    '  aliasing:',
    `    enabled: ${opts.aliasing !== false}`,
    `    min_uses: ${opts.minUses ?? 2}`,
  ];
  if (opts.include !== null) {
    lines.push('    include:', `      - ${opts.include ?? 'cans/plugins/*.md'}`);
  }
  return lines.join('\n') + '\n';
}

/** The (a)-shaped workspace: clean corpus + the kelir fixture + the plugin
 *  file with one broken leaf. */
function kelirWs(name: string, rules = rulesYaml(), profile = PROFILE_BROKEN): { tmp: string; root: string } {
  return makeWs(name, {
    '_rules.yaml': rules,
    '00-overview.md': OVERVIEW,
    '01-core.md': CORE,
    'artifacts/examples/fixtures/kelir.yaml': KELIR_YAML,
    'cans/plugins/profile.md': profile,
  });
}

// ── a1-a2: refs counted, verified, no structure layer ────────────────────────

describe('issue #65 engine — plugin refs are counted and verified', () => {
  test('a1: #leaf refs verify against the YAML fixture; the missing leaf errors naming the full resolved target', () => {
    const ws = kelirWs('verify');
    const r = runCli(['check', '--json'], ws.tmp);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(false);
    // corpus (2) + plugin (3): the tier's refs count like any other ref.
    expect(j.refs).toEqual({ total: 5, broken: 1, deepHops: 0 });
    expect(j.counts.errors).toBe(1);
    // The tier joins the checked file set: 2 spec + 1 plugin.
    expect(j.summary.files).toBe(3);
    const broken = j.issues.filter((i: any) => i.rule === 'refs.broken.anchor');
    expect(broken).toHaveLength(1);
    expect(broken[0]!.file).toBe('cans/plugins/profile.md');
    expect(broken[0]!.line).toBe(4);
    expect(broken[0]!.level).toBe('error');
    expect(broken[0]!.category).toBe('refs');
    expect(broken[0]!.message).toBe(BROKEN_MSG);
  });

  test('a2: the plugin file earns NO structure/style/content finding — the refs layer is its only layer', () => {
    const ws = kelirWs('layers');
    const j = parseJsonOut(runCli(['check', '--json'], ws.tmp).out);
    for (const i of j.issues) {
      expect(i.file).toBe('cans/plugins/profile.md');
      expect(i.category).toBe('refs');
    }
    expect(j.issues).toHaveLength(1); // exactly the broken anchor — nothing else
    expect(j.sections.structure).toEqual([]);
    expect(j.sections.style).toEqual([]);
  });
});

// ── b1-b2: graph participation (orphan relief) ───────────────────────────────

describe('issue #65 engine — the tier participates in the ref graph', () => {
  test('b1: a target referenced ONLY from a plugin file is not orphaned', () => {
    const ws = makeWs('relief', {
      '_rules.yaml': rulesYaml(),
      '00-overview.md': OVERVIEW,
      '01-core.md': CORE,
      '02-lonely.md': '- Lonely\n  - Solo item alpha\n  - Solo item beta\n',
      'cans/plugins/profile.md': '- Kelir profile\n  - lonely: see: 02-lonely.md\n',
    });
    const r = runCli(['check', '--json'], ws.tmp);
    expect(r.exit).toBe(0); // no orphan: the plugin ref gives 02-lonely incoming
    const j = parseJsonOut(r.out);
    expect(j.issues).toEqual([]);
    expect(j.refs.total).toBe(3); // corpus 2 + plugin 1
  });

  test('b2: with the include removed the same target IS orphaned — relief came from the graph, not luck', () => {
    const ws = makeWs('no-relief', {
      '_rules.yaml': rulesYaml({ include: null }),
      '00-overview.md': OVERVIEW,
      '01-core.md': CORE,
      '02-lonely.md': '- Lonely\n  - Solo item alpha\n  - Solo item beta\n',
      'cans/plugins/profile.md': '- Kelir profile\n  - lonely: see: 02-lonely.md\n',
    });
    const r = runCli(['check', '--json'], ws.tmp);
    expect(r.exit).toBe(1);
    const j = parseJsonOut(r.out);
    expect(j.refs.total).toBe(2); // the plugin file was never loaded
    const orphan = j.issues.filter((i: any) => i.rule === 'refs.orphan');
    expect(orphan).toHaveLength(1);
    expect(orphan[0]!.file).toBe('02-lonely.md');
  });
});

// ── c1-c3: finishAliasChecks covers the tier ─────────────────────────────────

describe('issue #65 engine — alias definitions in plugin files finish-checked', () => {
  test('c1: a broken zero-use definition fails the run (exit 2) naming the resolved target', () => {
    const ws = kelirWs('zero-use', rulesYaml(), [
      '- Kelir profile',
      '  - Traits live here',
      '- [1]: artifacts/examples/fixtures/kelir.yaml#invariants.missing_leaf',
      '',
    ].join('\n'));
    const r = runCli(['check', '--json'], ws.tmp);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    const broken = j.issues.filter((i: any) => i.rule === 'refs.broken.anchor');
    expect(broken).toHaveLength(1);
    expect(broken[0]!.file).toBe('cans/plugins/profile.md');
    expect(broken[0]!.line).toBe(3); // the definition line is the location
    expect(broken[0]!.level).toBe('error');
    expect(broken[0]!.message).toBe(BROKEN_MSG);
    // Zero-use definitions are the spelling, never the refs — not counted.
    expect(j.refs.total).toBe(2);
  });

  test('c2: an unused VALID definition is a warning (exit 1), never an error', () => {
    const ws = kelirWs('unused', rulesYaml(), [
      '- Kelir profile',
      '  - Traits live here',
      '- [1]: 01-core.md',
      '',
    ].join('\n'));
    const r = runCli(['check', '--json'], ws.tmp);
    expect(r.exit).toBe(1);
    const j = parseJsonOut(r.out);
    const unused = j.issues.filter((i: any) => i.rule === 'refs.alias.unused');
    expect(unused).toHaveLength(1);
    expect(unused[0]!.level).toBe('warning');
    expect(unused[0]!.file).toBe('cans/plugins/profile.md');
    expect(j.counts.errors).toBe(0);
  });

  test('c3: a used alias below min_uses is an error naming the full target', () => {
    const ws = kelirWs('min-uses', rulesYaml(), [
      '- Kelir profile',
      '  - only once: see: [k]',
      '- [k]: artifacts/examples/fixtures/kelir.yaml#invariants.default_zero_capability',
      '',
    ].join('\n'));
    const r = runCli(['check', '--json'], ws.tmp);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    const below = j.issues.filter((i: any) => i.rule === 'refs.alias.min_uses');
    expect(below).toHaveLength(1);
    expect(below[0]!.level).toBe('error');
    expect(below[0]!.message).toContain('used 1 time');
    expect(below[0]!.message).toContain('artifacts/examples/fixtures/kelir.yaml#invariants.default_zero_capability');
    // The use itself still resolves and verifies as a ref (leaf exists).
    expect(j.refs.total).toBe(3);
  });
});

// ── d1: graph-identity of the alias layer ────────────────────────────────────

describe('issue #65 engine — a plugin alias resolves exactly like the full pointer', () => {
  test('d1: the aliased plugin file and its expanded twin produce the SAME refs layer', () => {
    const target = 'artifacts/examples/fixtures/kelir.yaml#invariants.missing_leaf';
    const aliased = kelirWs('aliased', rulesYaml(), [
      '- Kelir profile',
      '  - a: see: [k]',
      '  - b: see: [k]',
      `- [k]: ${target}`,
      '',
    ].join('\n'));
    const expanded = kelirWs('expanded', rulesYaml(), [
      '- Kelir profile',
      `  - a: see: ${target}`,
      `  - b: see: ${target}`,
      '',
    ].join('\n'));
    const ja = parseJsonOut(runCli(['check', '--json'], aliased.tmp).out);
    const je = parseJsonOut(runCli(['check', '--json'], expanded.tmp).out);
    // Same totals, same counter, same verdict.
    expect(ja.refs).toEqual(je.refs);
    expect(ja.refs).toEqual({ total: 4, broken: 2, deepHops: 0 });
    expect(ja.exitCode).toBe(2);
    expect(je.exitCode).toBe(2);
    // Same findings, in the same order, word for word: the use sites resolve
    // to the same (file, anchor) RefTargets the expanded form mints.
    const pick = (j: any) => j.issues.map((i: any) => ({ file: i.file, line: i.line, level: i.level, rule: i.rule, message: i.message }));
    expect(pick(ja)).toEqual(pick(je));
    expect(pick(ja)).toEqual([
      { file: 'cans/plugins/profile.md', line: 2, level: 'error', rule: 'refs.broken.anchor', message: BROKEN_MSG },
      { file: 'cans/plugins/profile.md', line: 3, level: 'error', rule: 'refs.broken.anchor', message: BROKEN_MSG },
    ]);
  });
});

// ── e1: no promotion through the tier ────────────────────────────────────────

describe('issue #65 engine — plugin refs never promote their targets', () => {
  test('e1: a subfolder .md referenced only from a plugin file stays outside the corpus', () => {
    const ws = makeWs('no-promotion', {
      '_rules.yaml': rulesYaml(),
      '00-overview.md': OVERVIEW,
      '01-core.md': CORE,
      // Would-be promotion target with an odd-indent line: loaded as a spec
      // file it would surface a parse.indent warning; not loaded, silent.
      'plugins/pty.md': '- Pty\n   - three space child\n',
      'cans/plugins/profile.md': '- Kelir profile\n  - pty: see: plugins/pty.md\n',
    });
    const r = runCli(['check', '--json'], ws.tmp);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    // 2 spec + 1 plugin: pty.md did NOT promote (it would be 4).
    expect(j.summary.files).toBe(3);
    expect(j.summary.nodes).toBe(4); // overview 1 + core 3 — the tier is the refs layer, never a node count
    // The ref still counts and resolves on disk (issue #44 treatment)…
    expect(j.refs.total).toBe(3);
    expect(j.issues).toEqual([]); // …without broken-ref noise, promotion, or structure checks
  });
});

// ── f1-f2: named-file check on a plugin file ─────────────────────────────────

describe('issue #65 engine — cans check cans/plugins/profile.md', () => {
  test('f1: the named plugin file is counted as checked (files: 1) with its refs-layer findings', () => {
    const ws = kelirWs('named');
    const r = runCli(['check', 'cans/plugins/profile.md', '--json'], ws.tmp);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(false);
    expect(j.summary.files).toBe(1);
    // Refs stay global: the whole graph's refs (corpus + plugin) count.
    expect(j.refs).toEqual({ total: 5, broken: 1, deepHops: 0 });
    expect(j.issues).toHaveLength(1);
    expect(j.issues[0]!.rule).toBe('refs.broken.anchor');
    expect(j.issues[0]!.file).toBe('cans/plugins/profile.md');
    // No structure/style layer exists for it by construction.
    expect(j.sections.structure).toEqual([]);
    expect(j.sections.style).toEqual([]);
  });

  test('f2: the extensionless path spelling names the same plugin file', () => {
    const ws = kelirWs('named-stem');
    const j = parseJsonOut(runCli(['check', 'cans/plugins/profile', '--json'], ws.tmp).out);
    expect(j.summary.files).toBe(1);
    expect(j.refs.total).toBe(5);
    expect(j.issues).toHaveLength(1);
  });
});

// ── g1-g2: the enhanced §37 refusal ──────────────────────────────────────────

describe('issue #65 engine — the refusal names the knob', () => {
  test('g1: an existing outside-corpus workspace .md gets the include-glob refusal; missing/_tasks/AGENTS keep the classic', () => {
    const ws = makeWs('refusal', {
      '_rules.yaml': rulesYaml({ include: null }), // aliasing on, no include — the knob was never set
      '00-overview.md': OVERVIEW,
      '01-core.md': CORE,
      'cans/plugins/profile.md': '- Kelir profile\n  - x: see: 01-core.md\n',
      '_tasks/t.md': '- Task\n  - do it\n',
      'AGENTS.md': '# Agents\n',
    });
    const enhanced = parseJsonOut(runCli(['check', 'cans/plugins/profile.md', '--json'], ws.tmp).out);
    expect(enhanced.ok).toBe(false);
    expect(enhanced.exitCode).toBe(2);
    expect(enhanced.error).toBe(
      'no spec file matches "cans/plugins/profile.md" — the file exists but is outside the spec corpus; add a references.aliasing.include glob (e.g. cans/plugins/*.md) in _rules.yaml to check plugin files (issue #65)',
    );

    // Missing file: the suggestion would be unactionable — classic message.
    const missing = parseJsonOut(runCli(['check', 'nowhere.md', '--json'], ws.tmp).out);
    expect(missing.error).toBe(
      'no spec file matches "nowhere.md" — pass a spec filename like 04-api.md or run `cans status` to list files',
    );

    // `_`-prefixed segments and tool artifacts never join the tier — classic.
    const task = parseJsonOut(runCli(['check', '_tasks/t.md', '--json'], ws.tmp).out);
    expect(task.error).toBe(
      'no spec file matches "_tasks/t.md" — pass a spec filename like 04-api.md or run `cans status` to list files',
    );
    const agents = parseJsonOut(runCli(['check', 'AGENTS.md', '--json'], ws.tmp).out);
    expect(agents.error).toBe(
      'no spec file matches "AGENTS.md" — pass a spec filename like 04-api.md or run `cans status` to list files',
    );
  });

  test('g2: an include glob that does not match the named file still refuses — naming the knob it can widen', () => {
    const ws = makeWs('refusal-narrow', {
      '_rules.yaml': rulesYaml({ include: 'cans/plugins/other-*.md' }),
      '00-overview.md': OVERVIEW,
      '01-core.md': CORE,
      'cans/plugins/profile.md': '- Kelir profile\n  - x: see: 01-core.md\n',
    });
    const j = parseJsonOut(runCli(['check', 'cans/plugins/profile.md', '--json'], ws.tmp).out);
    expect(j.ok).toBe(false);
    expect(j.error).toContain('add a references.aliasing.include glob');
  });
});

// ── h1-h2: byte-identical pre-#65 behavior ───────────────────────────────────

describe('issue #65 engine — off is off', () => {
  const TAB_PROFILE = '- Kelir profile\n\t- tab child\n'; // would throw parseOutline IF loaded

  test('h1: aliasing enabled WITHOUT include — the tier never loads (even a tab-broken plugin stays silent)', () => {
    const ws = makeWs('off-include', {
      '_rules.yaml': rulesYaml({ include: null }),
      '00-overview.md': OVERVIEW,
      '01-core.md': CORE,
      'artifacts/examples/fixtures/kelir.yaml': KELIR_YAML,
      'cans/plugins/profile.md': TAB_PROFILE,
    });
    const r = runCli(['check', '--json'], ws.tmp);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.summary.files).toBe(2); // corpus only
    expect(j.refs).toEqual({ total: 2, broken: 0, deepHops: 0 });
    expect(j.issues).toEqual([]);
  });

  test('h2: aliasing disabled WITH include — the gate needs both; the tier never loads', () => {
    const ws = makeWs('off-aliasing', {
      '_rules.yaml': rulesYaml({ aliasing: false }),
      '00-overview.md': OVERVIEW,
      '01-core.md': CORE,
      'artifacts/examples/fixtures/kelir.yaml': KELIR_YAML,
      'cans/plugins/profile.md': TAB_PROFILE,
    });
    const r = runCli(['check', '--json'], ws.tmp);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.summary.files).toBe(2);
    expect(j.refs).toEqual({ total: 2, broken: 0, deepHops: 0 });
    expect(j.issues).toEqual([]);
  });
});

// ── i1-i2: --fix never touches plugin sources; the post-repair seam holds ────

describe('issue #65 engine — --fix and the plugin tier', () => {
  function fixWs(name: string): { tmp: string; root: string } {
    return makeWs(name, {
      '_rules.yaml': rulesYaml({ backPointers: true }),
      // 00-overview holds no refs (it is orphan-exempt) so the repaired
      // core→data edge cannot extend a chain THROUGH it into a deep hop —
      // this suite pins the fix transaction, not hop topology.
      '00-overview.md': '- Overview\n  - Standalone intro item\n  - Second intro item\n',
      '01-core.md': '- Core\n  - Data plane: see 02-data.md#Sesions\n  - Ledger item alpha\n',
      '02-data.md': '- Data\n  - Sessions\n  - Users\n',
      'cans/plugins/profile.md': '- Kelir profile\n  - data: see: 02-data.md\n',
    });
  }

  test('i1: --fix --yes repairs the spec anchor, leaves the plugin file byte-identical, and keeps its ref-by mark', () => {
    const ws = fixWs('fix-apply');
    const before = readWs(ws.root, 'cans/plugins/profile.md');
    const r = runCli(['check', '--fix', '--yes', '--json'], ws.tmp);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    // The anchor repair landed in the SPEC file (proposed and applied).
    expect(j.anchorFixes).toEqual([
      { file: '01-core.md', line: 2, from: 'Sesions', to: 'Sessions', applied: true },
    ]);
    expect(readWs(ws.root, '01-core.md')).toContain('see 02-data.md#Sessions');
    // The plugin source was never rewritten — it is not in specSources.
    expect(readWs(ws.root, 'cans/plugins/profile.md')).toBe(before);
    expect(j.backPointersUpdatedFiles).toEqual(['02-data.md']);
    // THE SEAM: the post-repair graph rebuild includes the tier, so the
    // plugin referrer's file-level ref-by mark lands on 02-data.md (and
    // survives — with the tier dropped here it would be stripped as stale).
    expect(readWs(ws.root, '02-data.md')).toContain('<!-- ref-by: cans/plugins/profile.md -->');
    expect(readWs(ws.root, '02-data.md')).toContain('<!-- ref-by: 01-core.md -->');
    // The post-fix report describes the workspace the run leaves behind.
    expect(j.refs).toEqual({ total: 2, broken: 0, deepHops: 0 });
    expect(j.backPointers).toEqual({ total: 2, current: 2, stale: 0 });
  });

  test('i2: plain --fix (propose-only anchors) also leaves the plugin file byte-identical', () => {
    const ws = fixWs('fix-propose');
    const before = readWs(ws.root, 'cans/plugins/profile.md');
    const j = parseJsonOut(runCli(['check', '--fix', '--json'], ws.tmp).out);
    expect(j.anchorFixes).toEqual([
      { file: '01-core.md', line: 2, from: 'Sesions', to: 'Sessions', applied: false },
    ]);
    expect(readWs(ws.root, 'cans/plugins/profile.md')).toBe(before);
    // Nothing was applied: the broken anchor stays reported on the next run.
    const again = parseJsonOut(runCli(['check', '--json'], ws.tmp).out);
    expect(again.counts.errors).toBe(1);
  });
});

// ── j1-j2: definitions are metadata; the hardening ───────────────────────────

describe('issue #65 engine — definitions are metadata, parse failures are explicit', () => {
  test('j1: a >120-char definition line produces no node/style finding — and a clean tier is a clean run', () => {
    const longLeaf = 'default_zero_capability_with_a_very_long_leaf_name_that_would_trip_node_length_if_it_were_node_text';
    const defLine = `- [k]: artifacts/examples/fixtures/kelir.yaml#invariants.${longLeaf}`;
    expect(defLine.length).toBeGreaterThan(120); // the contrast is real
    const ws = makeWs('metadata', {
      '_rules.yaml': rulesYaml(),
      '00-overview.md': OVERVIEW,
      '01-core.md': CORE,
      'artifacts/examples/fixtures/kelir.yaml': `invariants:\n  ${longLeaf}: true\n`,
      'cans/plugins/profile.md': `- Kelir profile\n  - x: see: [k]\n  - y: see: [k]\n${defLine}\n`,
    });
    const r = runCli(['check', '--json'], ws.tmp);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.issues).toEqual([]); // no node_length, no style, nothing
    expect(j.refs).toEqual({ total: 4, broken: 0, deepHops: 0 });
  });

  test('j2: a tab-broken plugin file is an EXPLICIT parse.error — the same breakage in an aux file skips silently', () => {
    const ws = makeWs('hardening', {
      '_rules.yaml': rulesYaml(),
      '00-overview.md': OVERVIEW,
      '01-core.md': CORE,
      'cans/plugins/profile.md': '- Kelir profile\n\t- tab child\n',
      '_tasks/t.md': '- Task\n\t- tab child\n', // aux: the same throw, swallowed
    });
    const r = runCli(['check', '--json'], ws.tmp);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    const parseErrors = j.issues.filter((i: any) => i.rule === 'parse.error');
    expect(parseErrors).toHaveLength(1); // the plugin file only
    expect(parseErrors[0]!.file).toBe('cans/plugins/profile.md');
    expect(parseErrors[0]!.level).toBe('error');
    expect(parseErrors[0]!.category).toBe('structure');
    expect(parseErrors[0]!.message).toContain('tab indentation rejected');
    expect(j.issues.filter((i: any) => i.file === '_tasks/t.md')).toEqual([]);
  });
});

// ── k1-k2: the gates treat plugin findings as what they are ──────────────────

describe('issue #65 engine — --refs-only and --structure gate the tier', () => {
  test('k1: --refs-only keeps the plugin findings (they ARE refs-layer findings)', () => {
    const ws = kelirWs('refs-only');
    const r = runCli(['check', '--refs-only', '--json'], ws.tmp);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.summary.files).toBe(3);
    expect(j.refs).toEqual({ total: 5, broken: 1, deepHops: 0 });
    expect(j.issues).toHaveLength(1);
    expect(j.issues[0]!.rule).toBe('refs.broken.anchor');
    expect(j.issues[0]!.file).toBe('cans/plugins/profile.md');
  });

  test('k2: --structure suppresses the plugin refs findings while the graph still counts the tier', () => {
    const ws = kelirWs('structure');
    const r = runCli(['check', '--structure', '--json'], ws.tmp);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    // The graph is still built: refs.total describes the same workspace a
    // plain run sees — only the findings are scoped.
    expect(j.refs).toEqual({ total: 5, broken: 0, deepHops: 0 });
    expect(j.issues).toEqual([]);
    expect(j.sections.refs).toEqual([]);
  });
});

// ── the fixture helper is honest (compile-time-free sanity) ──────────────────

describe('issue #65 engine — fixture sanity', () => {
  test('the kelir fixture resolves through the #58 machinery on disk', () => {
    const ws = kelirWs('fixture');
    const j = parseJsonOut(runCli(['check', '01-core.md', '--json'], ws.tmp).out);
    // A corpus-filtered run keeps the pre-#65 files shape (the corpus stat,
    // filter-independent) while the plugin findings stay global (refs layer).
    expect(j.summary.files).toBe(2);
    expect(j.issues).toHaveLength(1); // the plugin's broken leaf, unfiltered by the [file] filter
    expect(j.issues[0]!.file).toBe('cans/plugins/profile.md');
  });
});
