/**
 * Merge integration: issue #56 (strict _rules.yaml validation + overflow
 * removal) × issue #55 (references.external_roots) — the cross-feature
 * contracts neither feature's own suite can pin alone.
 *
 *   both ... one _rules.yaml carrying a VALID external_roots block AND a
 *           leftover overflow key: the strict validator must accept the
 *           #55 key and reject the removed #56 section in the same parse
 *   rec ..... reconcile: false — a sparse references section listing
 *           external_roots + two check keys keeps the OTHER check keys at
 *           their defaults (external_roots never counts towards a
 *           section's coverage, so pre-#55 configs behave identically).
 *           Discriminator: if the key WERE counted, this sparse section
 *           would reach majority coverage and orphan_check would turn OFF
 *           — the missing external file would silently pass instead of
 *           being the broken ref the default demands
 *   null .... external_roots: (empty) is a legal empty value — no roots
 *           configured, every name:// target is an undeclared-root
 *           broken ref, and no config error is raised
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join, dirname } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

import { spawnCli, REPO } from '../runtime.ts';
import { makeCansWorkspace } from '../helpers.ts';

// ── CLI scaffolding (mirrors test/issues/issue-55.test.ts) ──

const SCRATCH = join(REPO, '.tmp', 'issues', 'merge-55-56');
const createdDirs: string[] = [];
let wsSeq = 0;

interface ExtWs {
  /** Scratch base holding BOTH checkouts (cleaned per test). */
  base: string;
  /** The spec repo's project root — the CLI's cwd. */
  projectRoot: string;
  /** The cans/ workspace root. */
  root: string;
}

/** One spec-repo project plus any number of sibling external checkouts under
 *  <base>/ext/<dir>; root paths in _rules.yaml resolve from the PROJECT root
 *  (`../ext/<dir>`), exactly like the issue's sibling-repo example. */
function makeWs(
  name: string,
  spec: Record<string, string>,
  rules: string | null,
  external?: Record<string, Record<string, string>>,
): ExtWs {
  const base = join(SCRATCH, `${name}-${++wsSeq}`);
  const projectRoot = join(base, 'project');
  const root = makeCansWorkspace(projectRoot, spec);
  createdDirs.push(base);
  if (rules !== null) writeFileSync(join(root, '_rules.yaml'), rules, 'utf8');
  for (const [dirName, files] of Object.entries(external ?? {})) {
    for (const [rel, content] of Object.entries(files)) {
      const p = join(base, 'ext', dirName, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content, 'utf8');
    }
  }
  return { base, projectRoot, root };
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

/** Points at a file that does not exist under the (present) kelir root. */
const POINTER_SPEC = [
  '- Lifecycle',
  '  - map_shared_region: see: kelir://artifacts/examples/missing-example.rs',
  '',
].join('\n');

/** The kelir root checked out but WITHOUT the pointed-at file (orphan_check
 *  territory, not absent-root territory). */
const KELIR_EMPTY = { '.keep': '' };

describe('merge #55 × #56: strict validation and external_roots', () => {
  test('both: valid external_roots accepted while a leftover overflow key rejects in the same parse', () => {
    const rules = [
      'references:',
      '  external_roots:',
      '    kelir: "../ext/kelir-cans"',
      'overflow:',
      '  max_node_chars: 30',
      '',
    ].join('\n');
    const ws = makeWs('both', { '07-lifecycle.md': POINTER_SPEC }, rules, { 'kelir-cans': KELIR_EMPTY });
    const r = runCli(['check', '--json'], ws.projectRoot);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(false);
    // The removed overflow section is THE line-numbered config error…
    expect(j.error).toContain('invalid _rules.yaml: line 4');
    expect(j.error).toContain('unrecognized key "overflow"');
    // …and external_roots itself raises nothing.
    expect(j.error ?? '').not.toContain('external_roots');
  });

  test('rec: external_roots never counts towards references coverage — omitted check keys keep defaults', () => {
    // Sparse override: mode + max_hops listed (2 of 5 check keys — under
    // half) plus the roots block. orphan_check keeps its default (ON): the
    // pointer to a missing file under the PRESENT root is a broken ref.
    const sparse = [
      'references:',
      '  mode: pointer',
      '  max_hops: 1',
      '  external_roots:',
      '    kelir: "../ext/kelir-cans"',
      '',
    ].join('\n');
    const ws = makeWs('rec', { '07-lifecycle.md': POINTER_SPEC }, sparse, { 'kelir-cans': KELIR_EMPTY });
    const r = runCli(['check', '--json'], ws.projectRoot);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(2);
    expect(j.ok).toBe(false);
    expect(j.refs).toEqual({ total: 1, broken: 1, deepHops: 0 });
    const broken = j.issues.find((i: any) => i.rule === 'refs.broken.file');
    expect(broken.detail).toBe(
      'broken ref: see kelir://artifacts/examples/missing-example.rs — file not found under external root \'kelir\'',
    );

    // Control: the identical spec + section WITHOUT the roots block keeps
    // the same defaults (orphan_check still on) — the pointer is now the
    // undeclared-root broken ref. Pre-#55 semantics are unchanged by the key.
    const noRoots = sparse.replace('  external_roots:\n    kelir: "../ext/kelir-cans"\n', '');
    const ws2 = makeWs('rec-ctl', { '07-lifecycle.md': POINTER_SPEC }, noRoots);
    const r2 = runCli(['check', '--json'], ws2.projectRoot);
    const j2 = parseJsonOut(r2.out);
    expect(r2.exit).toBe(2);
    expect(j2.ok).toBe(false);
    const broken2 = j2.issues.find((i: any) => i.rule === 'refs.broken.file');
    expect(broken2.detail).toBe(
      'broken ref: see kelir://artifacts/examples/missing-example.rs — undeclared external root \'kelir\'',
    );
  });

  test('null: external_roots: (empty) is legal — no roots, name:// stays an undeclared-root broken ref', () => {
    const rules = ['references:', '  external_roots:', ''].join('\n');
    const ws = makeWs('null', { '07-lifecycle.md': POINTER_SPEC }, rules);
    const r = runCli(['check', '--json'], ws.projectRoot);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(2);
    expect(j.ok).toBe(false);
    const broken = j.issues.find((i: any) => i.rule === 'refs.broken.file');
    expect(broken.detail).toBe(
      'broken ref: see kelir://artifacts/examples/missing-example.rs — undeclared external root \'kelir\'',
    );
    // The empty map is a documented empty value — no config error at all.
    expect(j.error ?? '').not.toContain('_rules.yaml');
  });
});
