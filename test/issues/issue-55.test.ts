/**
 * Issue #55 — inter-repo pointerization: `see:` targets in a sibling repo
 * via declared `external_roots`.
 *
 * `cans check` only pointerized inside one `cans/` workspace. This issue adds
 * explicitly declared external roots (`references.external_roots` in
 * `cans/_rules.yaml`) and the `name://sub/path` pointer syntax, so a spec can
 * share concepts/examples with a sibling repo — the example lives in exactly
 * one place and the spec still gets a machine-checked pointer to it.
 *
 * Binding decisions (resolved upstream, documented in §12/§18/§22):
 *   - anchor: the root PATH resolves from the PROJECT root (the parent of
 *     the cans/ workspace) — `"../ext/kelir-cans"` is a sibling checkout;
 *   - absent declared root = WARNING (one per referenced root, pointers into
 *     it unverified) — CI that only clones the spec repo stays usable;
 *   - NO .md promotion across repos: inter-repo pointers are artifact-style
 *     TERMINAL targets (one hop, no chaining, no back-pointers).
 *
 * Test map:
 *   u1 .... grammar: externalPointerParts (name:// form; http/https are URLs,
 *           never pointers; c:/x and mailto: and plain paths stay legacy)
 *   u2 .... resolution: containment is lexical AND realpath (symlink escapes
 *           rejected), interior `..` that normalizes inside still resolves,
 *           absolute sub-paths and `../..` escapes rejected, dirs are not
 *           valid targets
 *   happy . declared root present, file exists → 0 errors, terminal hop
 *           under max_hops: 1, both issue-syntax primitives share one file
 *   anchor  anchored external pointers resolve against the external file's
 *           addressable vocabulary (bullets + YAML keys, issue #49 parity);
 *           a miss is refs.broken.anchor, a no-target file downgrades
 *   miss ... orphan_check: true → missing file under a PRESENT root is a
 *           broken ref counted in refs.broken; orphan_check: false → the
 *           verification is off
 *   absent . absent declared root → ONE warning for TWO pointers, pointers
 *           unverified, exit 1 / ok true
 *   undecl . undeclared root name → broken ref with the dedicated message
 *   escape . `root://../..`, `root://../../etc/passwd` and a symlink pointing
 *           outside → escape errors, never resolutions outside the root
 *   ws10 ... ordinary `../` escape WITHOUT external_roots → still the issue
 *           #10 broken ref (regression pin)
 *   ws10b .. ordinary `../` escape EVEN WITH external_roots declared → still
 *           the issue #10 broken ref (the feature must not reopen the hole)
 *   hop .... external pointer is terminal: a → b → kelir://x is NOT a deep
 *           hop under max_hops: 1; the same shape with a local spec target
 *           still deep-hops (control)
 *   dup .... duplicate_home_check across roots: same sub-path in the
 *           workspace (or another external root) + pointer → the existing
 *           structure.duplicate_home error shape; off-switch respected;
 *           repo-root spelling (`cans/...` sub-path, project-root probe)
 *   dup-sf . duplicate-home probes compare realpaths: a root declared as the
 *           project root itself, and a workspace symlink at the same
 *           sub-path, land on the SAME file — one home, never a duplicate
 *   cfg .... malformed external_roots entries → line-numbered config errors
 *           (bad name, empty value, numeric value, non-mapping)
 *   http ... http:// and https:// targets keep their exact pre-#55 treatment
 *   fix .... back_pointers: true + --fix: no mark is required or written in
 *           the external repo; backPointersUpdated stays 0
 *   noprom  external .md target is NOT promoted (issue #54 stays in-repo):
 *           its own see: refs are invisible to the graph, files unchanged
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join, dirname } from 'path';
import { mkdirSync, rmSync, writeFileSync, symlinkSync, readFileSync } from 'fs';

import {
  externalPointerParts, resolveExternalTarget,
} from '../../src/core/refs.ts';
import { spawnCli, REPO } from '../runtime.ts';
import { makeCansWorkspace } from '../helpers.ts';

// ── CLI scaffolding (mirrors test/issues/issue-22.test.ts) ──

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-55');
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
 *  <base>/ext/<dir>. Root paths in _rules.yaml are declared relative to the
 *  PROJECT root (`../ext/<dir>`), exactly like the issue's sibling-repo
 *  example. */
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

/** The issue's proposed config: the full references section (a §18 curated
 *  file — every unlisted section turns off, so ref findings are the whole
 *  report) plus the external root declaration. */
const RULES_EXT = [
  'references:',
  '  mode: pointer',
  '  back_pointers: false',
  '  max_hops: 1',
  '  orphan_check: true',
  '  duplicate_home_check: true',
  '  external_roots:',
  '    kelir: "../ext/kelir-cans"',
  '',
].join('\n');

/** The issue's real spec shape: a per-primitive exercise map whose example
 *  files live in the sibling repo (two primitives share one example). */
const LIFECYCLE_MAP = [
  '- Lifecycle',
  '  - map_shared_region: see: kelir://artifacts/examples/multi-vm-swarm.rs',
  '  - register_veto: see: kelir://artifacts/examples/multi-vm-swarm.rs',
  '',
].join('\n');

const KELIR_CANS = {
  'artifacts/examples/multi-vm-swarm.rs': 'fn swarm() {}\n',
  'artifacts/examples/db-backed-runtime.py': 'def runtime():\n    pass\n',
  'artifacts/examples/serverless-webhook.ts': 'export const hook = () => {};\n',
};

// ── Unit: the pointer grammar ──

describe('issue #55: externalPointerParts — the name:// grammar', () => {
  test('u1: name://sub/path parses; URLs and plain paths never do', () => {
    expect(externalPointerParts('kelir://artifacts/examples/multi-vm-swarm.rs')).toEqual({
      root: 'kelir',
      subPath: 'artifacts/examples/multi-vm-swarm.rs',
    });
    expect(externalPointerParts('a-b_2://x/y.md')).toEqual({ root: 'a-b_2', subPath: 'x/y.md' });
    // http/https are URLs — case-insensitive — and keep their legacy treatment.
    expect(externalPointerParts('http://example.com/docs')).toBeNull();
    expect(externalPointerParts('https://example.com/docs')).toBeNull();
    expect(externalPointerParts('HTTP://example.com/docs')).toBeNull();
    expect(externalPointerParts('HTTPS://example.com/docs')).toBeNull();
    // No `://` — not the pointer form.
    expect(externalPointerParts('c:/Users/x.md')).toBeNull();
    expect(externalPointerParts('mailto:someone@example.com')).toBeNull();
    expect(externalPointerParts('../escape.md')).toBeNull();
    expect(externalPointerParts('02-auth.md')).toBeNull();
    expect(externalPointerParts('auth')).toBeNull();
    // Empty sub-path (`kelir://`) — degenerate, keeps the legacy path.
    expect(externalPointerParts('kelir://')).toBeNull();
  });
});

// ── Unit: containment + resolution ──

describe('issue #55: resolveExternalTarget — containment', () => {
  test('u2: escapes rejected lexically and after realpath; interior .. resolves', () => {
    const base = join(SCRATCH, `unit-resolution-${++wsSeq}`);
    createdDirs.push(base);
    const rootDir = join(base, 'root');
    mkdirSync(join(rootDir, 'sub'), { recursive: true });
    writeFileSync(join(rootDir, 'real-file.rs'), 'x', 'utf8');
    writeFileSync(join(base, 'outside.rs'), 'x', 'utf8');

    // The issue's adversarial sub-paths: never a resolution outside the root.
    expect(resolveExternalTarget(rootDir, '../..')).toEqual({ kind: 'escape' });
    expect(resolveExternalTarget(rootDir, '../../etc/passwd')).toEqual({ kind: 'escape' });
    expect(resolveExternalTarget(rootDir, '..')).toEqual({ kind: 'escape' });
    expect(resolveExternalTarget(rootDir, '/etc/passwd')).toEqual({ kind: 'escape' });
    expect(resolveExternalTarget(rootDir, 'sub/../../outside.rs')).toEqual({ kind: 'escape' });

    // Missing file (present root): the orphan_check-gated broken ref case.
    expect(resolveExternalTarget(rootDir, 'nope.rs')).toEqual({ kind: 'missing' });
    // A directory is not a valid external target — targets are files.
    expect(resolveExternalTarget(rootDir, 'sub/')).toEqual({ kind: 'missing' });

    // A real file resolves, with the sub-path normalized.
    expect(resolveExternalTarget(rootDir, 'real-file.rs')).toEqual({
      kind: 'ok',
      path: join(rootDir, 'real-file.rs'),
      subPath: 'real-file.rs',
    });
    // Interior `..` that normalizes back inside the root still resolves — the
    // same lexical-containment semantics the workspace resolver applies
    // (issue #10: interior `..` is only a label, resolution decides).
    expect(resolveExternalTarget(rootDir, 'sub/../real-file.rs')).toEqual({
      kind: 'ok',
      path: join(rootDir, 'real-file.rs'),
      subPath: 'real-file.rs',
    });

    // Symlink escape: lexically inside, realpath outside → escape, never a
    // resolution. (Skipped only on filesystems that forbid symlinks.)
    let linked = false;
    try {
      symlinkSync('../../outside.rs', join(rootDir, 'sub', 'link-out.rs'));
      linked = true;
    } catch {
      linked = false;
    }
    if (linked) {
      expect(resolveExternalTarget(rootDir, 'sub/link-out.rs')).toEqual({ kind: 'escape' });
    }
  });
});

// ── CLI: the issue's semantics ──

describe('issue #55: inter-repo pointers via declared external_roots', () => {
  test('happy: declared root present, file exists → resolved, 0 errors, terminal hop', () => {
    const ws = makeWs('happy', { '07-lifecycle.md': LIFECYCLE_MAP }, RULES_EXT, { 'kelir-cans': KELIR_CANS });
    const r = runCli(['check', '--json'], ws.projectRoot);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect(j.exitCode).toBe(0);
    expect(j.counts.errors).toBe(0);
    expect(j.counts.warnings).toBe(0);
    // Both primitives' pointers count as refs; none broken; terminal under
    // max_hops: 1 (no deep hop, no chaining, no promotion).
    expect(j.refs).toEqual({ total: 2, broken: 0, deepHops: 0 });
    expect(j.summary.files).toBe(1);
    expect(j.issues).toEqual([]);
  });

  test('anchor: external anchors resolve against the target file (issue #49 parity)', () => {
    const spec = [
      '- Lifecycle',
      '  - sessions: see: kelir://docs/auth.md#Sessions',
      '  - policy: see: kelir://conf/policy.yaml#maintenance',
      '  - miss: see: kelir://docs/auth.md#Nope',
      '  - prose-file: see: kelir://docs/plain.md#Whatever',
      '',
    ].join('\n');
    const ws = makeWs('anchor', { '07-lifecycle.md': spec }, RULES_EXT, {
      'kelir-cans': {
        'docs/auth.md': '- Auth\n  - Sessions\n',
        'docs/plain.md': 'no bullets at all\n',
        'conf/policy.yaml': 'maintenance: weekly\n',
      },
    });
    const r = runCli(['check', '--json'], ws.projectRoot);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(false);
    // The .md bullet anchor and the .yaml mapping key both resolve; the miss
    // is a broken anchor counted in refs.broken; the anchor on a file with
    // nothing addressable is the issue #49 advisory downgrade.
    expect(j.refs).toEqual({ total: 4, broken: 1, deepHops: 0 });
    const rules = j.issues.map((i: any) => i.rule);
    expect(rules).toContain('refs.broken.anchor');
    expect(rules).toContain('refs.anchor.no-target');
    expect(rules.filter((x: string) => x === 'refs.broken.file')).toHaveLength(0);
    const broken = j.issues.find((i: any) => i.rule === 'refs.broken.anchor');
    expect(broken.detail).toBe('broken anchor: kelir://docs/auth.md#Nope — no node matches');
  });

  test('miss: orphan_check true → file missing under a present root is a broken ref', () => {
    const spec = '- Lifecycle\n  - adjust_balloon: see: kelir://artifacts/examples/missing.ts\n';
    const ws = makeWs('miss', { '07-lifecycle.md': spec }, RULES_EXT, { 'kelir-cans': KELIR_CANS });
    const r = runCli(['check', '--json'], ws.projectRoot);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(false);
    expect(j.refs).toEqual({ total: 1, broken: 1, deepHops: 0 });
    expect(j.issues).toHaveLength(1);
    expect(j.issues[0].rule).toBe('refs.broken.file');
    expect(j.issues[0].detail).toBe('broken ref: see kelir://artifacts/examples/missing.ts — file not found under external root \'kelir\'');
    expect(j.issues[0].level).toBe('error');
  });

  test('miss-off: orphan_check false → the missing-file verification is off', () => {
    const spec = '- Lifecycle\n  - adjust_balloon: see: kelir://artifacts/examples/missing.ts\n';
    const rules = RULES_EXT.replace('orphan_check: true', 'orphan_check: false');
    const ws = makeWs('miss-off', { '07-lifecycle.md': spec }, rules, { 'kelir-cans': KELIR_CANS });
    const r = runCli(['check', '--json'], ws.projectRoot);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect(j.refs).toEqual({ total: 1, broken: 0, deepHops: 0 });
    expect(j.issues).toEqual([]);
  });

  test('absent: declared root not checked out → ONE warning, pointers unverified', () => {
    const spec = [
      '- Lifecycle',
      '  - one: see: kelir://artifacts/examples/multi-vm-swarm.rs',
      '  - two: see: absent-root://cans/other.rs',
      '  - three: see: absent-root://cans/another.rs',
      '',
    ].join('\n');
    const rules = RULES_EXT.replace('    kelir: "../ext/kelir-cans"', '    kelir: "../ext/kelir-cans"\n    absent-root: "../ext/not-checked-out"');
    // Only kelir-cans is created — absent-root is declared but not checked out.
    const ws = makeWs('absent', { '07-lifecycle.md': spec }, rules, { 'kelir-cans': KELIR_CANS });
    const r = runCli(['check', '--json'], ws.projectRoot);
    expect(r.exit).toBe(1); // warning, never an error — CI stays usable
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect(j.counts).toEqual({ errors: 0, warnings: 1 });
    // The kelir pointer still verifies; the two absent-root pointers are
    // unverified (not broken, not resolved) and share ONE warning.
    expect(j.refs).toEqual({ total: 3, broken: 0, deepHops: 0 });
    const absent = j.issues.filter((i: any) => i.rule === 'refs.external.absent');
    expect(absent).toHaveLength(1);
    expect(absent[0].detail).toContain("external root 'absent-root' is not checked out");
    expect(absent[0].detail).toContain('../ext/not-checked-out from the project root');
    expect(absent[0].level).toBe('warning');
  });

  test('undecl: name:// pointer whose root is not declared → dedicated broken ref', () => {
    const spec = '- Lifecycle\n  - ghost: see: ghost://cans/artifacts/examples/multi-vm-swarm.rs\n';
    const ws = makeWs('undecl', { '07-lifecycle.md': spec }, RULES_EXT, { 'kelir-cans': KELIR_CANS });
    const r = runCli(['check', '--json'], ws.projectRoot);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(false);
    expect(j.refs).toEqual({ total: 1, broken: 1, deepHops: 0 });
    expect(j.issues).toHaveLength(1);
    expect(j.issues[0].rule).toBe('refs.broken.file');
    expect(j.issues[0].detail).toBe('broken ref: see ghost://cans/artifacts/examples/multi-vm-swarm.rs — undeclared external root \'ghost\'');
    expect(j.issues[0].suggestion).toContain("declare 'ghost' under references.external_roots");
    // A shape-invalid name is pointed at the name grammar, not at declaring
    // an invalid key.
    const spec2 = '- Lifecycle\n  - bad: see: Kelir.Cloud://x.rs\n';
    const ws2 = makeWs('undecl-shape', { '07-lifecycle.md': spec2 }, RULES_EXT, { 'kelir-cans': KELIR_CANS });
    const r2 = runCli(['check', '--json'], ws2.projectRoot);
    const j2 = parseJsonOut(r2.out);
    expect(j2.issues[0].detail).toBe('broken ref: see Kelir.Cloud://x.rs — undeclared external root \'Kelir.Cloud\'');
    expect(j2.issues[0].suggestion).toContain('^[a-z][a-z0-9_-]*$');
  });

  test('escape: root://../.., root://../../etc/passwd and symlink escapes are broken refs', () => {
    // `kelir://../secret` is the raw adversarial `../` sub-path; `kelir://../..`
    // exercises it through the §11/issue-48 token hygiene — a trailing `..` is
    // sentence punctuation and stripped before resolution, so the engine sees
    // `kelir://../`, which still escapes (every prefix of a traversal is a
    // traversal when it leaves the root).
    const spec = [
      '- Lifecycle',
      '  - a: see: kelir://../secret',
      '  - b: see: kelir://../../etc/passwd',
      '  - c: see: kelir://../..',
      '',
    ].join('\n');
    const ws = makeWs('escape', { '07-lifecycle.md': spec }, RULES_EXT, { 'kelir-cans': KELIR_CANS });
    const r = runCli(['check', '--json'], ws.projectRoot);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.refs).toEqual({ total: 3, broken: 3, deepHops: 0 });
    const msgs = j.issues.map((i: any) => i.detail).sort();
    expect(msgs).toEqual([
      "broken ref: see kelir://../ — target escapes external root 'kelir'",
      "broken ref: see kelir://../../etc/passwd — target escapes external root 'kelir'",
      "broken ref: see kelir://../secret — target escapes external root 'kelir'",
    ]);

    // Symlink escape at the CLI level: a link inside the root pointing at a
    // file OUTSIDE the root never resolves. (Skipped where symlinks are
    // forbidden.)
    let linked = false;
    try {
      symlinkSync('../../../../smuggled-secret.txt', join(ws.base, 'ext', 'kelir-cans', 'artifacts', 'examples', 'link-out.rs'));
      linked = true;
    } catch {
      linked = false;
    }
    if (linked) {
      writeFileSync(join(ws.base, 'smuggled-secret.txt'), 'secret', 'utf8');
      const spec2 = '- Operations\n  - c: see: kelir://artifacts/examples/link-out.rs\n';
      writeFileSync(join(ws.root, '08-operations.md'), spec2, 'utf8');
      const r2 = runCli(['check', '--json'], ws.projectRoot);
      const j2 = parseJsonOut(r2.out);
      expect(j2.ok).toBe(false);
      // Refs stay global under a [file] filter — collect the symlink probe
      // among all findings by its target.
      const escape2 = j2.issues.filter(
        (i: any) => i.rule === 'refs.broken.file' && i.detail.includes('link-out.rs'),
      );
      expect(escape2).toHaveLength(1);
      expect(escape2[0].detail).toBe("broken ref: see kelir://artifacts/examples/link-out.rs — target escapes external root 'kelir'");
      expect(escape2[0].level).toBe('error');
    }
  });

  test('ws10: ordinary ../ escape without external_roots → still the issue #10 broken ref', () => {
    const spec = '- Lifecycle\n  - a: see: ../outside/cans/06-operations.md\n';
    const rulesNoExt = RULES_EXT.replace('  external_roots:\n    kelir: "../ext/kelir-cans"\n', '');
    const ws = makeWs('ws10', { '07-lifecycle.md': spec }, rulesNoExt, { 'kelir-cans': KELIR_CANS });
    const r = runCli(['check', '--json'], ws.projectRoot);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.issues).toHaveLength(1);
    expect(j.issues[0].rule).toBe('refs.broken.file');
    // The exact issue #10 wording — never a create-* proposal outside the root.
    expect(j.issues[0].detail).toBe('broken ref: see ../outside/cans/06-operations.md — file not found in workspace');
    expect(j.issues[0].suggestion).toBe('fix the ref target — see: targets must name spec files inside the workspace (no ../ or absolute paths)');
  });

  test('ws10b: ordinary ../ escape EVEN WITH external_roots declared → still broken (#10 pin)', () => {
    const spec = '- Lifecycle\n  - a: see: ../ext/kelir-cans/artifacts/examples/multi-vm-swarm.rs\n';
    // The ../ target names a file that REALLY EXISTS (the sibling checkout on
    // disk) — the feature must not turn it into a resolution.
    const ws = makeWs('ws10b', { '07-lifecycle.md': spec }, RULES_EXT, { 'kelir-cans': KELIR_CANS });
    const r = runCli(['check', '--json'], ws.projectRoot);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.issues).toHaveLength(1);
    expect(j.issues[0].detail).toBe('broken ref: see ../ext/kelir-cans/artifacts/examples/multi-vm-swarm.rs — file not found in workspace');
    expect(j.refs.broken).toBe(1);
  });

  test('hop: a → b → kelir://x is NOT a deep hop; the local-spec control still is', () => {
    // External pointer as the only outgoing ref of a REFERENCED file — the
    // exact shape that deep-hopped before #44 for missing targets.
    const spec = {
      '07-lifecycle.md': '- Lifecycle\n  - deep: see: 08-operations.md\n',
      '08-operations.md': '- Operations\n  - example: see: kelir://artifacts/examples/multi-vm-swarm.rs\n',
    };
    const ws = makeWs('hop', spec, RULES_EXT, { 'kelir-cans': KELIR_CANS });
    const r = runCli(['check', '--json'], ws.projectRoot);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect(j.refs).toEqual({ total: 2, broken: 0, deepHops: 0 });

    // Control: the same shape with a LOCAL spec target still deep-hops under
    // max_hops: 1 — the exemption is external-pointer-specific, not a general
    // relaxation of §5.
    const specControl = {
      '07-lifecycle.md': '- Lifecycle\n  - deep: see: 08-operations.md\n',
      '08-operations.md': '- Operations\n  - example: see: 09-local.md\n',
      '09-local.md': '- Local\n',
    };
    const wsControl = makeWs('hop-control', specControl, RULES_EXT, { 'kelir-cans': KELIR_CANS });
    const rControl = runCli(['check', '--json'], wsControl.projectRoot);
    expect(rControl.exit).toBe(2);
    const jControl = parseJsonOut(rControl.out);
    expect(jControl.refs.deepHops).toBe(1);
    expect(jControl.issues.some((i: any) => i.rule === 'refs.deep_hop')).toBe(true);
  });

  test('dup: duplicate_home_check across roots — workspace copy + external pointer', () => {
    // The migration leftover: the example still exists locally AND in the
    // sibling repo, and the spec points at the external one.
    const ws = makeWs('dup', { '07-lifecycle.md': LIFECYCLE_MAP }, RULES_EXT, { 'kelir-cans': KELIR_CANS });
    mkdirSync(join(ws.root, 'artifacts', 'examples'), { recursive: true });
    writeFileSync(join(ws.root, 'artifacts', 'examples', 'multi-vm-swarm.rs'), 'fn swarm() {}\n', 'utf8');
    const r = runCli(['check', '--json'], ws.projectRoot);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    // The existing duplicate-home error shape (structure.duplicate_home) —
    // one per offending pointer, grouped by the report as one root cause.
    const dups = j.issues.filter((i: any) => i.rule === 'structure.duplicate_home');
    expect(dups).toHaveLength(2);
    expect(dups[0].detail).toBe('duplicate home: both artifacts/examples/multi-vm-swarm.rs and kelir://artifacts/examples/multi-vm-swarm.rs exist — keep exactly one home');
    expect(dups[0].level).toBe('error');
    expect(dups[0].suggestion).toContain('workspace (artifacts/examples/multi-vm-swarm.rs)');
    // It is NOT a refs.broken finding — the pointer itself resolves.
    expect(j.refs.broken).toBe(0);

    // Off-switch: duplicate_home_check false → the second home is tolerated.
    const rulesOff = RULES_EXT.replace('duplicate_home_check: true', 'duplicate_home_check: false');
    const wsOff = makeWs('dup-off', { '07-lifecycle.md': LIFECYCLE_MAP }, rulesOff, { 'kelir-cans': KELIR_CANS });
    mkdirSync(join(wsOff.root, 'artifacts', 'examples'), { recursive: true });
    writeFileSync(join(wsOff.root, 'artifacts', 'examples', 'multi-vm-swarm.rs'), 'fn swarm() {}\n', 'utf8');
    const rOff = runCli(['check', '--json'], wsOff.projectRoot);
    const jOff = parseJsonOut(rOff.out);
    expect(jOff.ok).toBe(true);
    expect(jOff.issues).toEqual([]);
  });

  test('dup-repo: root declared as the sibling REPO root — project-root probe (issue spelling)', () => {
    // The issue's verbatim pointer spelling: kelir-cloud://cans/artifacts/...
    // with the root declared as the sibling repo ROOT, and the local copy
    // still inside the local cans/ workspace.
    const rulesRepo = RULES_EXT.replace('    kelir: "../ext/kelir-cans"', '    kelir: "../ext/kelir-repo"');
    const spec = '- Lifecycle\n  - a: see: kelir://cans/artifacts/examples/multi-vm-swarm.rs\n';
    const ws = makeWs('dup-repo', { '07-lifecycle.md': spec }, rulesRepo, {
      'kelir-repo': { 'cans/artifacts/examples/multi-vm-swarm.rs': 'fn swarm() {}\n' },
    });
    mkdirSync(join(ws.root, 'artifacts', 'examples'), { recursive: true });
    writeFileSync(join(ws.root, 'artifacts', 'examples', 'multi-vm-swarm.rs'), 'fn swarm() {}\n', 'utf8');
    const r = runCli(['check', '--json'], ws.projectRoot);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    const dups = j.issues.filter((i: any) => i.rule === 'structure.duplicate_home');
    expect(dups).toHaveLength(1);
    expect(dups[0].detail).toBe('duplicate home: both cans/artifacts/examples/multi-vm-swarm.rs and kelir://cans/artifacts/examples/multi-vm-swarm.rs exist — keep exactly one home');
    expect(dups[0].suggestion).toContain('project root (cans/artifacts/examples/multi-vm-swarm.rs)');
  });

  test('dup-two-roots: the same sub-path under a second external root is a second home', () => {
    const rulesTwo = RULES_EXT.replace('    kelir: "../ext/kelir-cans"', '    kelir: "../ext/kelir-cans"\n    other: "../ext/other-cans"');
    const ws = makeWs('dup-two', { '07-lifecycle.md': LIFECYCLE_MAP }, rulesTwo, {
      'kelir-cans': KELIR_CANS,
      'other-cans': { 'artifacts/examples/multi-vm-swarm.rs': 'fn swarm() {}\n' },
    });
    const r = runCli(['check', '--json'], ws.projectRoot);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    const dups = j.issues.filter((i: any) => i.rule === 'structure.duplicate_home');
    expect(dups).toHaveLength(2);
    expect(dups[0].detail).toBe('duplicate home: both other://artifacts/examples/multi-vm-swarm.rs and kelir://artifacts/examples/multi-vm-swarm.rs exist — keep exactly one home');
    expect(dups[0].suggestion).toContain("external root 'other' (other://artifacts/examples/multi-vm-swarm.rs)");
  });

  test('dup-same-file: a probe landing on the SAME file is one home, not a duplicate', () => {
    // A root declared as the project root itself (".") — pointing at repo
    // files outside cans/ is a legitimate spelling — makes the project-root
    // probe hit the very file the pointer resolves to. One home with two
    // spellings: 0 errors (a naive existence-only probe would false-positive
    // here, "duplicate home" against itself).
    const rulesSelf = RULES_EXT.replace('    kelir: "../ext/kelir-cans"', '    self: "."');
    const spec = '- Lifecycle\n  - a: see: self://docs/example.rs\n';
    const ws = makeWs('dup-same-file', { '07-lifecycle.md': spec }, rulesSelf, {});
    mkdirSync(join(ws.projectRoot, 'docs'), { recursive: true });
    writeFileSync(join(ws.projectRoot, 'docs', 'example.rs'), 'fn e() {}\n', 'utf8');
    const r = runCli(['check', '--json'], ws.projectRoot);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect(j.issues).toEqual([]);
    expect(j.refs).toEqual({ total: 1, broken: 0, deepHops: 0 });

    // A workspace SYMLINK at the same sub-path IS the external target (not a
    // copy): still one home. A real COPY at the same sub-path (control) is the
    // genuine second home the check exists to catch.
    const ws2 = makeWs('dup-symlink', { '07-lifecycle.md': LIFECYCLE_MAP }, RULES_EXT, {
      'kelir-cans': KELIR_CANS,
    });
    mkdirSync(join(ws2.root, 'artifacts', 'examples'), { recursive: true });
    let linked = false;
    try {
      symlinkSync('../../../../ext/kelir-cans/artifacts/examples/multi-vm-swarm.rs', join(ws2.root, 'artifacts', 'examples', 'multi-vm-swarm.rs'));
      linked = true;
    } catch {
      linked = false; // filesystem forbids symlinks — the case cannot arise
    }
    if (linked) {
      const rLink = runCli(['check', '--json'], ws2.projectRoot);
      expect(rLink.exit).toBe(0);
      const jLink = parseJsonOut(rLink.out);
      expect(jLink.ok).toBe(true);
      expect(jLink.issues.filter((i: any) => i.rule === 'structure.duplicate_home')).toEqual([]);
    }
  });

  test('cfg: malformed external_roots entries → line-numbered config errors', () => {
    // Bad root name (uppercase) — the error names the ENTRY's line (8).
    const badName = [
      'references:',
      '  mode: pointer',
      '  back_pointers: false',
      '  max_hops: 1',
      '  orphan_check: true',
      '  duplicate_home_check: true',
      '  external_roots:',
      '    Kelir: "../ext/kelir-cans"',
      '',
    ].join('\n');
    const wsName = makeWs('cfg-name', { '07-lifecycle.md': LIFECYCLE_MAP }, badName);
    const rName = runCli(['check', '--json'], wsName.projectRoot);
    expect(rName.exit).toBe(2);
    const jName = parseJsonOut(rName.out);
    expect(jName.ok).toBe(false);
    expect(jName.error).toContain('invalid _rules.yaml: line 8');
    expect(jName.error).toContain('invalid external root name "Kelir"');
    expect(jName.error).toContain('^[a-z][a-z0-9_-]*$');
    // The config error rides in sections.config (issue #43 shape), never refs.
    expect(jName.sections.config).toHaveLength(1);
    expect(jName.sections.config[0].rule).toBe('config.invalid');
    expect(jName.sections.refs).toEqual([]);

    // Empty value (nothing under the key).
    const badEmpty = RULES_EXT.replace('    kelir: "../ext/kelir-cans"', '    kelir:');
    const wsEmpty = makeWs('cfg-empty', { '07-lifecycle.md': LIFECYCLE_MAP }, badEmpty);
    const rEmpty = runCli(['check', '--json'], wsEmpty.projectRoot);
    const jEmpty = parseJsonOut(rEmpty.out);
    expect(rEmpty.exit).toBe(2);
    expect(jEmpty.error).toContain('line 8');
    expect(jEmpty.error).toContain('external root "kelir" must be a non-empty path string, got empty value');

    // Numeric value — the YAML subset parser types it as a Number.
    const badNum = RULES_EXT.replace('    kelir: "../ext/kelir-cans"', '    kelir: 42');
    const wsNum = makeWs('cfg-num', { '07-lifecycle.md': LIFECYCLE_MAP }, badNum);
    const rNum = runCli(['check', '--json'], wsNum.projectRoot);
    const jNum = parseJsonOut(rNum.out);
    expect(rNum.exit).toBe(2);
    expect(jNum.error).toContain('external root "kelir" must be a non-empty path string, got number');

    // Non-mapping external_roots (a list) — the section-level shape error.
    const badList = RULES_EXT.replace('  external_roots:\n    kelir: "../ext/kelir-cans"\n', '  external_roots: [kelir, other]\n');
    const wsList = makeWs('cfg-list', { '07-lifecycle.md': LIFECYCLE_MAP }, badList);
    const rList = runCli(['check', '--json'], wsList.projectRoot);
    const jList = parseJsonOut(rList.out);
    expect(rList.exit).toBe(2);
    expect(jList.error).toContain('"references.external_roots" must be a mapping of root names to paths, got a list');
  });

  test('http: http:// and https:// targets keep their exact pre-#55 treatment', () => {
    const spec = [
      '- Lifecycle',
      '  - a: see: http://example.com/docs',
      '  - b: see: https://example.com/docs',
      '',
    ].join('\n');
    // With external_roots declared — 'http' must never be read as a root name.
    const ws = makeWs('http', { '07-lifecycle.md': spec }, RULES_EXT, { 'kelir-cans': KELIR_CANS });
    const r = runCli(['check', '--json'], ws.projectRoot);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.refs.broken).toBe(2);
    const details = j.issues.map((i: any) => i.detail).sort();
    expect(details).toEqual([
      'broken ref: see http://example.com/docs — file not found',
      'broken ref: see https://example.com/docs — file not found',
    ]);
    // Never the external-root verdicts.
    for (const i of j.issues) {
      expect(i.detail).not.toContain('external root');
    }
  });

  test('fix: back_pointers true + --fix writes nothing into the external repo', () => {
    const rulesBp = RULES_EXT.replace('back_pointers: false', 'back_pointers: true');
    const ws = makeWs('fix', { '07-lifecycle.md': LIFECYCLE_MAP }, rulesBp, { 'kelir-cans': KELIR_CANS });
    const before = readFileSync(join(ws.base, 'ext', 'kelir-cans', 'artifacts', 'examples', 'multi-vm-swarm.rs'), 'utf8');
    const r = runCli(['check', '--fix', '--json'], ws.projectRoot);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    // No ref-by mark was required or written anywhere: external targets earn
    // no back-pointers (the external repo is not owned by this run).
    expect(j.backPointersUpdated).toBe(0);
    expect(j.backPointersUpdatedFiles).toEqual([]);
    expect(j.counts).toEqual({ errors: 0, warnings: 0 });
    expect(readFileSync(join(ws.base, 'ext', 'kelir-cans', 'artifacts', 'examples', 'multi-vm-swarm.rs'), 'utf8')).toBe(before);
    // And no spec file was rewritten either (no local targets in the graph).
    expect(readFileSync(join(ws.root, '07-lifecycle.md'), 'utf8')).toBe(LIFECYCLE_MAP);
  });

  test('noprom: external .md target is NOT promoted — its see: refs stay invisible', () => {
    // Decision 3: no .md promotion across repos. The external .md is a
    // terminal artifact target: its own see: ref (to a file that does not
    // exist anywhere) is never part of the graph, so it cannot be a broken
    // ref, a chaining error, or a promotion.
    const spec = '- Lifecycle\n  - doc: see: kelir://docs/ext-doc.md\n';
    const ws = makeWs('noprom', { '07-lifecycle.md': spec }, RULES_EXT, {
      'kelir-cans': { 'docs/ext-doc.md': '- External doc\n  - inner: see: 99-ghost.md\n' },
    });
    const r = runCli(['check', '--json'], ws.projectRoot);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect(j.summary.files).toBe(1); // only 07-lifecycle.md — no promotion
    expect(j.refs).toEqual({ total: 1, broken: 0, deepHops: 0 });
    expect(j.issues).toEqual([]);
  });
});
