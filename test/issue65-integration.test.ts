/**
 * Issue #65 — integration: the plugin tier END-TO-END on the merged
 * engine (check.ts) + CLI (alias.ts) halves.
 *
 * The engine suite pins the tier's internals; the CLI suite pins the
 * transforms. This suite pins the CROSS-CUTTING contract the issue states
 * and neither half can prove alone:
 *
 *   - Graph-identity across the alias forms INCLUDING `#leaf` targets
 *     (contract point 5): `cans check` on the expanded and collapsed forms
 *     of a workspace gives an identical REF layer — refs counted, broken,
 *     deep hops, and the full issues array — because resolution replaces
 *     each use's target with the full pointer's before the graph is built.
 *   - The round trip is lossless in bytes: expand(collapse(expanded)) ===
 *     expanded (non-pointer text untouched, no renumber churn).
 *   - The issue's two concrete refusals are gone: `cans check
 *     cans/plugins/profile.md` checks the named plugin file (refs layer,
 *     files: 1) instead of "0 files checked", and `cans alias collapse
 *     cans/plugins/profile.md --dry-run` proposes aliasing instead of
 *     "no spec file matches".
 *   - collapse does NOT skip `#leaf` targets: repeated leaves are aliased
 *     exactly like plain .md targets, below-min_uses leaves stay full.
 *   - Scope stays file-only across the tier boundary: a corpus file's
 *     `[1]` use NEVER resolves against a plugin file's definition (and
 *     vice versa) — no cross-file alias leakage.
 *   - Graph participation end-to-end: a spec target referenced ONLY from a
 *     plugin file is orphan-relieved; drop the include (or disable
 *     aliasing) and the same workspace orphans it again — the pre-#65
 *     identity the backwards-compat clause demands.
 *
 * Runtime-neutral: imports the test facade, never 'bun:test' directly.
 */
import { describe, test, expect, afterEach } from './testing.ts';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { spawnCli } from './runtime.ts';
import { makeTmpDir, cleanTmpDir, makeCansWorkspace } from './helpers.ts';

/** Workspaces live at <tmp>/cans (the production convention: the workspace
 *  IS a cans/ directory), so the CLI must run with cwd = tmp — the walk-up
 *  in resolveWorkspaceRoot then lands on the workspace root. */
const tmps: string[] = [];
interface Ws { tmp: string; root: string }
const scratch = (name: string, files: Record<string, string>): Ws => {
  const t = makeTmpDir(`issue65-integration-${name}`);
  tmps.push(t);
  return { tmp: t, root: makeCansWorkspace(t, files) };
};

afterEach(() => {
  while (tmps.length > 0) cleanTmpDir(tmps.pop()!);
});

// The CLI resolves its workspace through CANS_ROOT before walking up — pin it
// to empty so every run walks up from the given cwd (the workspace root).
function runCli(args: string[], cwd: string) {
  return spawnCli(args, cwd, { ...process.env, CANS_ROOT: "" });
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
  const j = parsed as Record<string, unknown> | null;
  if (j !== null && typeof j === 'object' && (j as any).sections !== undefined && (j as any).issues === undefined) {
    (j as any).issues = Object.entries((j as any).sections as Record<string, any[]>).flatMap(([category, arr]) =>
      arr.map((i) => ({ ...i, category, message: i.detail })),
    );
  }
  return parsed;
}

/** The kelir-style YAML artifact (#58 leaf machinery): `#invariants.*`
 *  dot paths resolve to scalar leaves. */
const KELIR_YAML = [
  'invariants:',
  '  default_zero_capability: true',
  '  no_silent_writes: true',
  '  atomic_handoff: true',
  '',
].join('\n');

const LEAF_A = 'artifacts/examples/fixtures/kelir.yaml#invariants.default_zero_capability';
const LEAF_B = 'artifacts/examples/fixtures/kelir.yaml#invariants.no_silent_writes';

/** The expanded-form plugin file: leaf A twice (alias-eligible at
 *  min_uses 2), leaf B once (stays a full pointer — below the threshold). */
const PROFILE_EXPANDED = [
  '- Kelir profile',
  '  - default zero: see: ' + LEAF_A,
  '  - zero again: see: ' + LEAF_A,
  '  - silent writes: see: ' + LEAF_B,
  '',
].join('\n');

/** The collapsed form the CLI is expected to produce: leaf A's two uses
 *  become `[1]`, the footnote definition lands at the end, leaf B
 *  untouched. (Built by construction in the round-trip test; spelled here
 *  for the dry-run proposal shape.) */
const PROFILE_COLLAPSED = [
  '- Kelir profile',
  '  - default zero: see: [1]',
  '  - zero again: see: [1]',
  '  - silent writes: see: ' + LEAF_B,
  '',  // the #57 transform separates the footnote block with a blank line
  '- [1]: ' + LEAF_A,
  '',
].join('\n');

/** A clean two-file corpus (mutual refs, no findings). */
const OVERVIEW = '- Overview: see 01-core.md\n';
const CORE = '- Core\n  - Back: see 00-overview.md\n  - Ledger item alpha\n';

/** The ruleset: aliasing ON, the kelir plugin glob, min_uses 2. */
const RULES = [
  'references:',
  '  orphan_check: true',
  '  aliasing:',
  '    enabled: true',
  '    min_uses: 2',
  '    include:',
  '      - cans/plugins/*.md',
  '',
].join('\n');

function baseFiles(profile: string, rules: string): Record<string, string> {
  return {
    '_rules.yaml': rules,
    '00-overview.md': OVERVIEW,
    '01-core.md': CORE,
    'artifacts/examples/fixtures/kelir.yaml': KELIR_YAML,
    'cans/plugins/profile.md': profile,
  };
}

/** The REF layer the contract calls graph-identical: refs, issues (rule +
 *  file + message), and counts. Deliberately excludes presentation fields
 *  that may name the written spelling. */
function refLayer(r: { exit: number | null; out: string }): {
  refs: unknown;
  issues: unknown[];
  counts: unknown;
  files: unknown;
} {
  const j = parseJsonOut(r.out);
  return {
    refs: j.refs,
    issues: (j.issues as any[]).map((i) => ({ file: i.file, rule: i.rule, message: i.message })),
    counts: j.counts,
    files: j.summary?.files,
  };
}


// ── The two legal named-file spellings (kelir's production layout) ──────────

describe('issue #65 integration — workspace- and cwd-relative named files', () => {
  /** The kelir production layout: the workspace IS a cans/ directory inside
   *  the project (resolveWorkspaceRoot's walk-up), the corpus at its root,
   *  plugins at <workspace>/plugins/*.md. An author at the project root
   *  spells the plugin file `cans/plugins/profile.md` — the issue's own
   *  command spellings; workspace-relative the same file is
   *  `plugins/profile.md`. */
  /** The kelir spelling of the include glob: the plugin keys are
   *  workspace-relative `plugins/*.md` here (no nested cans/ inside the
   *  workspace). */
  const RULES_KELIR = RULES.replace('- cans/plugins/*.md', '- plugins/*.md');
  const kelirLayoutFiles = (rules: string): Record<string, string> => ({
    '_rules.yaml': rules,
    '00-overview.md': OVERVIEW,
    '01-core.md': CORE,
    'artifacts/examples/fixtures/kelir.yaml': KELIR_YAML,
    'plugins/profile.md': PROFILE_EXPANDED,
  });

  test("`cans check cans/plugins/profile.md` from the project root checks the file (cwd-relative spelling)", () => {
    const ws = scratch('kelir-layout', kelirLayoutFiles(RULES_KELIR));
    const r = runCli(['check', 'cans/plugins/profile.md', '--json'], ws.tmp);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.summary.files).toBe(1);
    // Refs stay global (pre-#65 filter precedent): corpus 2 + plugin 3.
    expect(j.refs).toEqual({ total: 5, broken: 0, deepHops: 0 });
  });

  test('`cans alias collapse cans/plugins/profile.md` from the project root transforms the file', () => {
    const ws = scratch('kelir-layout-alias', kelirLayoutFiles(RULES_KELIR));
    const r = runCli(['alias', 'collapse', 'cans/plugins/profile.md', '--dry-run', '--json'], ws.tmp);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect((j.results as any[]).map((x) => x.file)).toEqual(['plugins/profile.md']);
    expect((j.results as any[])[0].usesRewritten).toBe(2);
  });

  test('the workspace-relative spelling works from inside the workspace too', () => {
    const ws = scratch('kelir-layout-inside', kelirLayoutFiles(RULES_KELIR));
    const r = runCli(['check', 'plugins/profile.md', '--json'], ws.root);
    expect(r.exit).toBe(0);
    expect(parseJsonOut(r.out).summary.files).toBe(1);
  });

  test('without include, the cwd-relative spelling still names the knob (existence via normalization)', () => {
    const ws = scratch('kelir-layout-hint', kelirLayoutFiles(RULES_KELIR));
    writeFileSync(join(ws.root, '_rules.yaml'), RULES_KELIR.replace('    include:\n      - plugins/*.md\n', ''));
    const r = runCli(['check', 'cans/plugins/profile.md', '--json'], ws.tmp);
    expect(r.exit).toBe(2);
    expect(r.out).toContain('the file exists but is outside the spec corpus');
    expect(r.out).toContain('references.aliasing.include');
  });
});

// ── Graph-identity across the forms (contract point 5) ─────────────────────

describe('issue #65 integration — graph-identity across alias forms', () => {
  test('expanded and collapsed workspaces give an identical check output (incl. #leaf targets)', () => {
    const expandedWs = scratch('identity-expanded', baseFiles(PROFILE_EXPANDED, RULES));
    const collapsedWs = scratch('identity-collapsed', baseFiles(PROFILE_COLLAPSED, RULES));
    const expanded = refLayer(runCli(['check', '--json'], expandedWs.tmp));
    const collapsed = refLayer(runCli(['check', '--json'], collapsedWs.tmp));
    // Both forms check clean: 3 refs (2 uses + leaf B), zero findings, and
    // the plugin file joins the checked set (2 spec + 1 plugin).
    expect(expanded).toEqual({ refs: { total: 5, broken: 0, deepHops: 0 }, issues: [], counts: expanded.counts, files: 3 });
    expect(expanded.counts).toEqual({ errors: 0, warnings: 0 });
    // THE contract: the two forms are indistinguishable to the checker.
    expect(collapsed).toEqual(expanded);
  });

  test('expand restores the collapsed plugin file to the original expanded bytes', () => {
    const ws = scratch('roundtrip', baseFiles(PROFILE_COLLAPSED, RULES));
    const r = runCli(['alias', 'expand'], ws.tmp);
    expect(r.exit).toBe(0);
    expect(readFileSync(join(ws.root, 'cans/plugins/profile.md'), 'utf8')).toBe(PROFILE_EXPANDED);
    // And back: collapse(expand(collapsed)) === collapsed — the round trip
    // is a fixpoint in BOTH directions.
    const r2 = runCli(['alias', 'collapse'], ws.tmp);
    expect(r2.exit).toBe(0);
    expect(readFileSync(join(ws.root, 'cans/plugins/profile.md'), 'utf8')).toBe(PROFILE_COLLAPSED);
  });

  test('collapse rewrites only the eligible leaf: 2 uses, 1 definition, below-threshold leaf untouched', () => {
    const ws = scratch('collapse', baseFiles(PROFILE_EXPANDED, RULES));
    const r = runCli(['alias', 'collapse', '--dry-run', '--json'], ws.tmp);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    const outcome = (j.results as any[]).find((x) => x.file === 'cans/plugins/profile.md');
    expect(outcome).toBeDefined();
    expect(outcome.changed).toBe(true);
    expect(outcome.usesRewritten).toBe(2);
    expect(outcome.definitionsAdded).toBe(1);
    expect(outcome.problems).toEqual([]);
    // Dry-run wrote nothing.
    expect(readFileSync(join(ws.root, 'cans/plugins/profile.md'), 'utf8')).toBe(PROFILE_EXPANDED);
    // A real run lands exactly the expected collapsed shape.
    const w = runCli(['alias', 'collapse'], ws.tmp);
    expect(w.exit).toBe(0);
    expect(readFileSync(join(ws.root, 'cans/plugins/profile.md'), 'utf8')).toBe(PROFILE_COLLAPSED);
  });
});

// ── The issue's two concrete refusals are gone ─────────────────────────────

describe('issue #65 integration — the corpus boundary is open', () => {
  test('`cans check cans/plugins/profile.md` checks the named plugin file (was: 0 files checked)', () => {
    const ws = scratch('named-check', baseFiles(PROFILE_EXPANDED, RULES));
    const r = runCli(['check', 'cans/plugins/profile.md', '--json'], ws.tmp);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.summary.files).toBe(1);
    // Refs stay global on a named run (pre-#65 filter precedent): corpus 2 + plugin 3.
    expect(j.refs).toEqual({ total: 5, broken: 0, deepHops: 0 });
    expect(j.counts).toEqual({ errors: 0, warnings: 0 });
  });

  test('`cans alias collapse cans/plugins/profile.md` no longer refuses with "no spec file matches"', () => {
    const ws = scratch('named-collapse', baseFiles(PROFILE_EXPANDED, RULES));
    const r = runCli(['alias', 'collapse', 'cans/plugins/profile.md', '--dry-run', '--json'], ws.tmp);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect((j.results as any[]).map((x) => x.file)).toEqual(['cans/plugins/profile.md']);
    expect((j.results as any[])[0].usesRewritten).toBe(2);
  });
});

// ── Scope stays file-only across the tier boundary ─────────────────────────

describe('issue #65 integration — no cross-file alias leakage', () => {
  test("a corpus file's `[1]` use never resolves against a plugin file's definition", () => {
    const files = baseFiles(PROFILE_COLLAPSED, RULES);
    files['02-extra.md'] = '- Extra\n  - Leaks: see: [1]\n';
    const ws = scratch('leakage', files);
    const r = runCli(['check', '--json'], ws.tmp);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    const leaks = (j.issues as any[]).filter((i) => i.file === '02-extra.md' && i.rule === 'refs.alias.undefined');
    expect(leaks).toHaveLength(1);
    expect(leaks[0].level).toBe('error');
    // The plugin file itself stays clean — its own definition serves only
    // its own uses.
    expect((j.issues as any[]).filter((i) => i.file === 'cans/plugins/profile.md')).toEqual([]);
  });
});

// ── Graph participation end-to-end (orphan relief, pre-#65 identity) ───────

describe('issue #65 integration — the tier participates in the graph', () => {
  test('a spec target referenced only from a plugin file is orphan-relieved; without the tier it orphans', () => {
    const target = '- Target\n  - Nothing local\n';
    // The plugin file's ONLY refs point at the spec target — the relief
    // case the issue demands ("every alias use counts as a ref for …
    // orphan purposes", and plain plugin refs ride the same graph).
    const profileRef = [
      '- Kelir profile',
      '  - target: see: 02-target.md',
      '  - target again: see: 02-target.md',
      '',
    ].join('\n');
    const withTier = baseFiles(profileRef, RULES);
    withTier['02-target.md'] = target;
    const ws = scratch('orphan-relieved', withTier);
    const ok = parseJsonOut(runCli(['check', '--json'], ws.tmp).out);
    // The relief proof is the ABSENCE of the orphan finding (other findings
    // in the fixture corpus are irrelevant to the contract).
    expect((ok.issues as any[]).filter((i) => i.rule === 'refs.orphan')).toEqual([]);

    // Drop the include (aliasing stays enabled): the tier is gone, the
    // same target has zero referrers → the orphan fires. The rest of the
    // workspace is unchanged — the pre-#65 behavior, byte-identical.
    const withoutTier = { ...withTier };
    withoutTier['_rules.yaml'] = RULES.replace('    include:\n      - cans/plugins/*.md\n', '');
    const ws2 = scratch('orphan-bare', withoutTier);
    const bad = runCli(['check', '--json'], ws2.tmp);
    const j = parseJsonOut(bad.out);
    const orphans = (j.issues as any[]).filter((i) => i.rule === 'refs.orphan');
    expect(orphans).toHaveLength(1);
    expect(orphans[0].file).toBe('02-target.md');
    expect(orphans[0].level).toBe('warning');
    // The plugin file's refs left the graph with it (corpus 2 only; the
    // plugin file is no longer among the checked files).
    expect(j.refs.total).toBe(2);
    // 3 spec files (00, 01, 02-target) — the plugin file left the set.
    expect(j.summary.files).toBe(3);

    // Disabling aliasing (include present but inert) orphans identically —
    // the gate is aliasing.enabled, include alone never widens the set.
    const disabled = { ...withTier };
    disabled['_rules.yaml'] = RULES.replace('    enabled: true', '    enabled: false');
    const ws3 = scratch('orphan-disabled', disabled);
    const off = parseJsonOut(runCli(['check', '--json'], ws3.tmp).out);
    expect((off.issues as any[]).filter((i) => i.rule === 'refs.orphan')).toHaveLength(1);
    expect(off.refs.total).toBe(2);
  });
});
