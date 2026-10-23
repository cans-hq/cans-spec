/**
 * Issue #44 regression tests — detectDeepHops counted refs to on-disk
 * NON-SPEC targets as mesh-exiting hops.
 *
 * Defect: the `outgoing` classification in detectDeepHops resolved ref
 * targets through resolveKey, which only matches LOADED SPEC FILES. A see:
 * ref from a spec file to a target that exists on disk but is not a spec
 * file (e.g. `see: artifacts/final-chain.ts` — it resolves through
 * resolveSpecFile, so checkRefs does NOT report it as broken) always fell
 * through to "mesh-exiting". Any spec file that both receives refs and
 * points at non-spec content was permanently flagged: the reporter's hub
 * file (`00-overview.md`, back-referenced by every file) could never pass
 * `cans check` while holding its example-artifact pointer.
 *
 * Fix (issue #44, binding design): a ref whose target exists on disk inside
 * the workspace (resolveSpecFile !== null) but is NOT a loaded spec file
 * (resolveKey === null) is NOT mesh-exiting — such a target can never form
 * an A→B→C spec chain by construction, because the chain machinery walks
 * loaded spec files only. The exemption is opt-in via a new optional third
 * parameter `root` (null default keeps the legacy two-argument behavior);
 * `cans check` passes the workspace root. A target missing on disk KEEPS the
 * mesh-exiting classification — it is a broken ref checkRefs reports, and
 * this check never downgrades that signal.
 *
 * Test map (targets are deliberately NON-.md — .ts/.txt/.yaml — to stay
 * orthogonal to issue #54's subfolder-.md promotion):
 *   a ..... the issue's exact repro (unit): hub with incoming back-refs +
 *          on-disk artifacts/final-chain.ts → NO deep-hop issue
 *   b ..... same graph, artifact MISSING on disk → still flagged (unit) and
 *          checkRefs reports refs.broken.file (layering pin)
 *   c ..... root null (legacy two-argument signature) → old behavior
 *          preserved: still flagged even with the artifact on disk
 *   d ..... regression guard: a genuine 3-file spec chain A→B→C still flags
 *          with root passed (the exemption never swallows real hops)
 *   e ..... mixed outgoing: an exempt non-spec ref does not mask the REAL
 *          spec hop on the same file — the flag names the spec target
 *   f ..... exemption covers other on-disk non-spec flavors: examples/
 *          notes.txt (file-level) and artifacts/governance.yaml#maintenance
 *          (anchored, the issue #49 neighbor)
 *   g ..... escaping targets (../) never earn the exemption — resolveSpecFile
 *          containment holds, the ref stays mesh-exiting
 *   h/i ... CLI end-to-end (--json): hub + real artifacts/final-chain.ts →
 *          ok:true, exit 0, refs.deepHops 0; artifact missing → deepHops 1,
 *          refs.broken 1, exit 2
 */
import { describe, test, expect, afterEach } from './testing.ts';
import { join, dirname } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

import { parseOutline } from '../src/core/outline.ts';
import { buildRefGraph, checkRefs, detectDeepHops } from '../src/core/refs.ts';
import type { OutlineNode } from '../src/types.ts';
import { spawnCli, REPO } from './runtime.ts';
import { makeCansWorkspace } from './helpers.ts';

// ── Unit scaffolding: inline graph + real files on disk ──

/** Inline workspace: file key → outline source, parsed exactly like `check` does. */
function filesOf(spec: Record<string, string>): Map<string, OutlineNode[]> {
  const map = new Map<string, OutlineNode[]>();
  for (const [name, body] of Object.entries(spec)) map.set(name, parseOutline(body, name));
  return map;
}

const createdDirs: string[] = [];

/** Scratch dir with real on-disk files (the artifact targets the issue is about). */
function makeDiskWs(name: string, diskFiles: Record<string, string>): string {
  const tmp = join(REPO, '.tmp', 'issue-44', `${name}-${createdDirs.length + 1}`);
  mkdirSync(tmp, { recursive: true });
  for (const [rel, content] of Object.entries(diskFiles)) {
    const p = join(tmp, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content, 'utf8');
  }
  createdDirs.push(tmp);
  return tmp;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    rmSync(createdDirs.pop()!, { recursive: true, force: true });
  }
});

/** The issue's exact shape: a hub every file back-references, which also
 *  points at an example artifact. `.ts` target on purpose — non-spec,
 *  non-.md, orthogonal to issue #54's subfolder-.md promotion. */
const HUB_SPEC = {
  '00-overview.md': '- Overview\n  - Final chain example code: see artifacts/final-chain.ts\n',
  '01-auth.md': '- Auth\n  - see: 00-overview.md\n',
  '02-data.md': '- Data\n  - see: 00-overview.md\n',
};

const ARTIFACT_TS = 'export function finalChainExample(): void {\n  // the A → B → C chain, coded\n}\n';

/** A plain 3-file spec chain — nothing non-spec about it. */
const CHAIN_A_B_C = {
  '01-a.md': '- A\n  - see: 02-b.md\n',
  '02-b.md': '- B\n  - see: 03-c.md\n',
  '03-c.md': '- C\n',
};

// ── Unit: the exemption (issue #44 fix) ──

describe('issue #44: detectDeepHops non-spec target exemption', () => {
  test('a: the repro — hub with back-refs + on-disk artifacts/final-chain.ts → no deep hop', () => {
    const root = makeDiskWs('unit-repro', { 'artifacts/final-chain.ts': ARTIFACT_TS });
    const graph = buildRefGraph(filesOf(HUB_SPEC), root);
    // The ref is valid (checkRefs is silent about it) …
    expect(checkRefs(filesOf(HUB_SPEC), graph, root).filter(i => i.category === 'refs')).toEqual([]);
    // … so the hub must not deep-hop over it: the artifact is on disk, not a
    // loaded spec file — it cannot form an A→B→C spec chain by construction.
    expect(detectDeepHops(graph, 1, root)).toEqual([]);
  });

  test('b: same graph, artifact MISSING on disk → still mesh-exiting (+ refs.broken.file at the checkRefs layer)', () => {
    const root = makeDiskWs('unit-missing', {}); // nothing on disk
    const files = filesOf(HUB_SPEC);
    const graph = buildRefGraph(files, root);
    const issues = detectDeepHops(graph, 1, root);
    // Deep-hop classification for non-existent targets is unchanged: the ref
    // is mesh-exiting in deep-hop terms …
    expect(issues.length).toBe(1);
    expect(issues[0]!.file).toBe('00-overview.md');
    expect(issues[0]!.rule).toBe('refs.deep_hop');
    expect(issues[0]!.level).toBe('error');
    expect(issues[0]!.message).toBe('DEEP HOP: 01-auth.md → 00-overview.md → artifacts/final-chain.ts');
    // … and the missing target is separately a broken ref at the checkRefs
    // layer — the exemption must never downgrade that signal.
    const refIssues = checkRefs(files, graph, root).filter(i => i.category === 'refs');
    expect(refIssues.some(i => i.rule === 'refs.broken.file' && i.message.includes('artifacts/final-chain.ts'))).toBe(true);
  });

  test('c: root null (legacy signature) keeps the pre-#44 classification — still flagged', () => {
    const root = makeDiskWs('unit-legacy', { 'artifacts/final-chain.ts': ARTIFACT_TS });
    const graph = buildRefGraph(filesOf(HUB_SPEC), root);
    // Two-argument call (existing callers/tests) and explicit null: the
    // artifact is on disk, but without a root the detector cannot know that
    // — the legacy mesh-exiting verdict is preserved verbatim.
    const twoArg = detectDeepHops(graph, 1);
    const explicitNull = detectDeepHops(graph, 1, null);
    expect(twoArg.length).toBe(1);
    expect(explicitNull.length).toBe(1);
    expect(twoArg[0]!.file).toBe('00-overview.md');
    expect(twoArg[0]!.message).toBe('DEEP HOP: 01-auth.md → 00-overview.md → artifacts/final-chain.ts');
    expect(explicitNull[0]).toEqual(twoArg[0]!);
  });

  test('d: regression guard — a genuine spec chain A→B→C still flags when root is passed', () => {
    const root = makeDiskWs('unit-chain', { 'artifacts/final-chain.ts': ARTIFACT_TS });
    const issues = detectDeepHops(buildRefGraph(filesOf(CHAIN_A_B_C), root), 1, root);
    expect(issues.length).toBe(1);
    expect(issues[0]!.file).toBe('02-b.md');
    expect(issues[0]!.message).toBe('DEEP HOP: 01-a.md → 02-b.md → 03-c.md');
  });

  test('e: an exempt non-spec ref does not mask the REAL spec hop on the same file', () => {
    const root = makeDiskWs('unit-mixed', { 'artifacts/final-chain.ts': ARTIFACT_TS });
    // The hub holds BOTH the artifact pointer (exempt) and a spec-file exit
    // (03-c.md) — dropping the artifact from `outgoing` must surface the
    // genuine chain 01-a → 00-overview → 03-c, not silence the file.
    const spec = {
      '00-overview.md': '- Overview\n  - Final chain example code: see artifacts/final-chain.ts\n  - see: 03-c.md\n',
      '01-a.md': '- A\n  - see: 00-overview.md\n',
      '03-c.md': '- C\n',
    };
    const issues = detectDeepHops(buildRefGraph(filesOf(spec), root), 1, root);
    expect(issues.length).toBe(1);
    expect(issues[0]!.file).toBe('00-overview.md');
    expect(issues[0]!.message).toBe('DEEP HOP: 01-a.md → 00-overview.md → 03-c.md');
  });

  test('f: exemption covers other on-disk non-spec flavors — examples/notes.txt and an anchored artifacts/*.yaml', () => {
    const root = makeDiskWs('unit-flavors', {
      'examples/notes.txt': 'plain text notes, no outline\n',
      'artifacts/governance.yaml': 'governance:\n  maintenance:\n    window: weekly\n',
    });
    const spec = {
      '00-overview.md': '- Overview\n  - Notes: see examples/notes.txt\n  - Governance: see artifacts/governance.yaml#maintenance\n',
      '01-a.md': '- A\n  - see: 00-overview.md\n',
    };
    // File-level .txt and anchored .yaml targets are the same class: on disk,
    // not loaded spec files → never mesh-exiting.
    expect(detectDeepHops(buildRefGraph(filesOf(spec), root), 1, root)).toEqual([]);
  });

  test('g: escaping targets (../) never earn the exemption — containment holds', () => {
    const parent = makeDiskWs('unit-escape', { 'outside.md': 'outside the workspace\n' });
    const root = join(parent, 'ws');
    mkdirSync(root, { recursive: true });
    const spec = {
      '00-overview.md': '- Overview\n  - see: ../outside.md\n',
      '01-a.md': '- A\n  - see: 00-overview.md\n',
    };
    // The ../ target physically exists on disk, but resolveSpecFile's
    // containment guard (issue #10) rejects it — the ref stays mesh-exiting
    // exactly as before.
    const issues = detectDeepHops(buildRefGraph(filesOf(spec), root), 1, root);
    expect(issues.length).toBe(1);
    expect(issues[0]!.file).toBe('00-overview.md');
    expect(issues[0]!.message).toBe('DEEP HOP: 01-a.md → 00-overview.md → ../outside.md');
  });
});

// ── CLI scaffolding (mirrors test/issues/issue-49.test.ts) ──

const SCRATCH = join(REPO, '.tmp', 'issue-44', 'cli');
const cliDirs: string[] = [];

function makeWs(name: string, files: Record<string, string>): { tmp: string; root: string } {
  const tmp = join(SCRATCH, `${name}-${cliDirs.length + 1}`);
  const root = makeCansWorkspace(tmp, files);
  cliDirs.push(tmp);
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
  const j = parsed as Record<string, unknown> | null;
  if (j !== null && typeof j === 'object' && (j as any).sections !== undefined && (j as any).issues === undefined) {
    (j as any).issues = Object.entries((j as any).sections as Record<string, any[]>).flatMap(([category, arr]) =>
      arr.map((i) => ({ ...i, category, message: i.detail })),
    );
  }
  return parsed;
}

/** A check-clean workspace shaped like the issue: the hub every spec file
 *  back-references, plus its example-artifact pointer. Modeled on the init
 *  template stubs (parents with 2+ children, distinct short texts, no TBD
 *  floods) so no OTHER check fires — the deep-hop verdict is the only thing
 *  under test. */
const CLI_REPRO_FILES = {
  '00-overview.md': [
    '- Overview',
    '  - Product: draft specification for the claims hub',
    '  - Users: adjusters and policy admins',
    '  - Status: active development',
    '  - Final chain example code: see artifacts/final-chain.ts',
    '',
  ].join('\n'),
  '02-authentication.md': [
    '- Authentication',
    '  - Sign up: email invitations only',
    '  - Sessions: expire after 24 hours',
    '  - Passwords: argon2id hashing',
    '  - Workspace map: see 00-overview.md',
    '',
  ].join('\n'),
  '03-data.md': [
    '- Data',
    '  - Storage: postgres primary with replicas',
    '  - Schema: jsonb columns for endorsements',
    '  - Backups: nightly snapshots',
    '  - Retention: seven years',
    '  - Hub entry point: see 00-overview.md',
    '',
  ].join('\n'),
  'artifacts/final-chain.ts': ARTIFACT_TS,
};

describe('issue #44: cans check end-to-end', () => {
  test('h: hub + real artifacts/final-chain.ts — ok:true, exit 0, refs.deepHops 0', () => {
    const ws = makeWs('cli-repro', CLI_REPRO_FILES);
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);

    // The exact case from the issue: the hub holds a valid ref to on-disk
    // non-spec content and finally passes `cans check`.
    expect(j.ok).toBe(true);
    expect(r.exit).toBe(0);
    expect(j.refs.total).toBe(3);
    expect(j.refs.broken).toBe(0);
    expect(j.refs.deepHops).toBe(0);
    expect(j.issues.some((i: any) => i.rule === 'refs.deep_hop')).toBe(false);
  });

  test('i: same workspace, artifact missing — deepHops 1, refs.broken 1, exit 2', () => {
    const { 'artifacts/final-chain.ts': _gone, ...rest } = CLI_REPRO_FILES;
    const ws = makeWs('cli-missing', rest);
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);

    // The missing target is a broken ref (checkRefs) and the deep-hop
    // classification for it is unchanged — both layers say what is wrong.
    expect(j.ok).toBe(false);
    expect(r.exit).toBe(2);
    expect(j.refs.broken).toBe(1);
    expect(j.refs.deepHops).toBe(1);
    expect(j.issues.some((i: any) => i.rule === 'refs.deep_hop' && i.file === '00-overview.md')).toBe(true);
    expect(j.issues.some((i: any) => i.rule === 'refs.broken.file' && i.message.includes('artifacts/final-chain.ts'))).toBe(true);
  });
});

// ── CLI scratch cleanup ──
afterEach(() => {
  while (cliDirs.length > 0) {
    rmSync(cliDirs.pop()!, { recursive: true, force: true });
  }
});
