/**
 * Issue #60 regression tests — the deep-hop / terminal-ref half: see: refs
 * to NON-SPEC files (txt/json/yaml/ts/rs/py) must be 0-hop terminals, and an
 * anchor failure on such a target must never be stacked under a spurious
 * deep-hop error.
 *
 * Defect (filed against npm 0.5.1): detectDeepHops counted a ref whose
 * target is a non-spec file inside the workspace as a mesh-exiting hop, so a
 * spec file that both receives refs and points at an on-disk artifact
 * (diagram, config, example code) was permanently flagged `refs.deep_hop` —
 * and the #leaf anchor on that target could not resolve, stacking an anchor
 * failure under the false hop. The hop half was fixed by issue #44 (the
 * on-disk non-spec exemption); this file re-pins it for the issue #60 flavor
 * matrix and the issue's exact repro graph, and pins the layering contract
 * the anchor-vocabulary half must compose with.
 *
 * Contract under test:
 *   1. TERMINALITY — a ref whose target exists on disk inside the workspace
 *      but is not a loaded spec file is a 0-hop TERMINAL: never a
 *      mesh-exiting outgoing ref for deep-hop purposes, whatever the file
 *      extension. Only refs between loaded spec files can form hops.
 *   2. LAYERING — when an anchor on such a target genuinely matches
 *      nothing, the anchor failure is the ONLY finding; a deep-hop error is
 *      never stacked on top of it.
 *   3. PRECISION — the exemption never over-reaches: a target missing on
 *      disk stays mesh-exiting (and is a refs.broken.file at the checkRefs
 *      layer), escaping targets (../, absolute) never earn it, root=null
 *      keeps the legacy two-argument classification, and genuine spec
 *      chains are never swallowed.
 *
 * POST-INTEGRATION CONTRACTS (red until the issue #60 anchor-vocabulary
 * branches land): subtest i2 — the issue's exact anchored repro must be
 * FULLY green (#creation-flow resolving against the natural addressable
 * units of a .txt target; exit 0, zero findings). Subtest h pins the
 * current honest anchor behavior (the refs.anchor.no-target warning) with
 * the post-integration evolution stated in place; its zero-deep-hop
 * invariant is green today and must survive that change.
 *
 * Test map (unit level unless marked CLI):
 *   a ..... the issue's exact repro graph (hub 00-overview receiving refs +
 *          01-topology receiving + pointing at the on-disk artifact),
 *          file-level AND anchored, across all seven target flavors the
 *          issue names — .txt .json .yaml .toml .ts .rs .py → NO deep-hop
 *          issue (anchored json/yaml/toml also resolve cleanly today via
 *          the issue #58 dot-path vocabulary)
 *   b ..... max_hops 1 (default) and 2 both clean on the repro; maxHops null
 *          (§18 check-off) → no issues at all; boundary at max_hops 2: a
 *          genuine 4-file spec chain flags, the artifact-terminated chain
 *          does not
 *   c ..... artifact MISSING on disk → still mesh-exiting AND checkRefs
 *          reports refs.broken.file — the exemption never downgrades broken
 *   d ..... regression guard: a genuine 3-file spec chain A→B→C (all loaded
 *          .md) still flags with root passed
 *   e ..... mixed outgoing: B holds BOTH an exempt on-disk artifact ref AND
 *          a real spec hop → still flagged, and the error names the SPEC
 *          target, never the artifact
 *   f ..... escaping targets (../ and absolute) never earn the exemption
 *   g ..... root null (legacy two-argument call) preserves the old
 *          classification — still flagged even with the artifact on disk
 *   h ..... layering pin: an anchor that matches nothing in an on-disk .txt
 *          target is the ONLY finding — no deep-hop stacked on top (green
 *          today as the refs.anchor.no-target warning; POST-INTEGRATION the
 *          miss becomes the truthful refs.broken.anchor error, still the
 *          only finding)
 *   i1 .... CLI (--json): file-level .txt artifact refs → ok:true, exit 0,
 *          refs.deepHops 0 (green today)
 *   i2 .... CLI (--json): the issue's exact anchored repro → fully green —
 *          POST-INTEGRATION CONTRACT, RED until the anchor-vocabulary
 *          branches land
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join, dirname } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

import { parseOutline } from '../../src/core/outline.ts';
import { buildRefGraph, checkRefs, detectDeepHops } from '../../src/core/refs.ts';
import type { OutlineNode } from '../../src/types.ts';
import { spawnCli, REPO } from '../runtime.ts';
import { makeCansWorkspace } from '../helpers.ts';

// ── Unit scaffolding: inline graph + real files on disk (mirrors
//    test/issue-44-non-spec-hops.test.ts, the sibling exemption suite) ──

/** Inline workspace: file key → outline source, parsed exactly like `check` does. */
function filesOf(spec: Record<string, string>): Map<string, OutlineNode[]> {
  const map = new Map<string, OutlineNode[]>();
  for (const [name, body] of Object.entries(spec)) map.set(name, parseOutline(body, name));
  return map;
}

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-60');
const createdDirs: string[] = [];

/** Scratch dir with real on-disk files (the artifact targets the issue is about). */
function makeDiskWs(name: string, diskFiles: Record<string, string>): string {
  const tmp = join(SCRATCH, `${name}-${createdDirs.length + 1}`);
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

/** The issue's on-disk target: a plain-text diagram artifact. Prose + indented
 *  continuation lines, NO markdown bullets and no schematic structure — under
 *  today's vocabulary (bullets / schematic keys) it has nothing addressable,
 *  which is exactly why the reporter's #creation-flow anchor could not resolve. */
const DATA_FLOW_TXT = [
  'Data flow (plain-text diagram artifact)',
  '',
  'creation flow',
  '  intake API → normalization → claims hub',
  '',
  'retention flow',
  '  nightly snapshots → cold storage',
  '',
].join('\n');

/** The issue's exact graph shape: the hub (00-overview) receives the topology
 *  file's back-ref, and 01-topology — the file that both receives (from the
 *  hub) and points at the on-disk artifact — is the file 0.5.1 flagged with
 *  `DEEP HOP: 00-overview.md → 01-topology.md → artifacts/diagrams/data-flow.txt`. */
function reproSpec(target: string): Record<string, string> {
  return {
    '00-overview.md': '- Overview\n  - Topology: see 01-topology.md\n',
    '01-topology.md': `- Topology\n  - Workspace map: see 00-overview.md\n  - Creation flow: see ${target}\n`,
  };
}

const REPRO_TXT = 'artifacts/diagrams/data-flow.txt';

/** The seven non-spec target flavors the issue names. `schematic` marks the
 *  json/yaml/toml kinds whose #leaf anchors already resolve today via the
 *  issue #58 dot-path vocabulary; txt/ts/rs/py are the anchor-vocabulary
 *  half owned by the other #60 branches (post-integration). */
interface Flavor {
  readonly ext: string;
  readonly path: string;
  readonly content: string;
  readonly anchor: string;
  readonly schematic: boolean;
}

const FLAVORS: readonly Flavor[] = [
  {
    ext: 'txt', path: 'artifacts/diagrams/data-flow.txt', content: DATA_FLOW_TXT,
    anchor: 'creation-flow', schematic: false,
  },
  {
    ext: 'json', path: 'artifacts/config.json',
    content: '{"creation": {"flow": "intake"}}\n',
    anchor: 'creation.flow', schematic: true,
  },
  {
    ext: 'yaml', path: 'artifacts/governance.yaml',
    content: 'creation:\n  flow: intake\n',
    anchor: 'creation.flow', schematic: true,
  },
  {
    ext: 'toml', path: 'artifacts/registry.toml',
    content: '[creation]\nflow = "intake"\n',
    anchor: 'creation.flow', schematic: true,
  },
  {
    ext: 'ts', path: 'artifacts/final-chain.ts',
    content: 'export function finalChain(): void {\n  // the A → B → C chain, coded\n}\n',
    anchor: 'final-chain', schematic: false,
  },
  {
    ext: 'rs', path: 'artifacts/parser.rs',
    content: 'pub fn parse_intake(line: &str) -> Intake {\n    parse(line)\n}\n',
    anchor: 'parse-intake', schematic: false,
  },
  {
    ext: 'py', path: 'artifacts/ingest.py',
    content: 'def ingest_record(record):\n    return normalize(record)\n',
    anchor: 'ingest-record', schematic: false,
  },
];

// ── Unit: the terminal-ref contract (the deep-hop half of issue #60) ──

describe('issue #60: terminal refs to non-spec files — detectDeepHops', () => {
  for (const f of FLAVORS) {
    test(`a (${f.ext}): the repro graph — on-disk ${f.ext} target is a 0-hop terminal, file-level AND anchored`, () => {
      const root = makeDiskWs(`unit-${f.ext}`, { [f.path]: f.content });

      // Anchored variant (the issue's exact shape): 01-topology both receives
      // the hub's ref and points at the artifact WITH a #leaf anchor. The
      // target is on disk inside the workspace but not a loaded spec file —
      // it can never form an A→B→C spec chain by construction, so it must
      // never count as a mesh-exiting outgoing ref.
      const files = filesOf(reproSpec(`${f.path}#${f.anchor}`));
      const graph = buildRefGraph(files, root);
      expect(detectDeepHops(graph, 1, root)).toEqual([]);
      if (f.schematic) {
        // json/yaml/toml: the issue #58 dot-path vocabulary already resolves
        // #leaf anchors on schematic targets today, so the anchored terminal
        // ref is clean at BOTH layers — no hop, no broken anchor.
        expect(checkRefs(files, graph, root).filter(i => i.category === 'refs')).toEqual([]);
      } else {
        // txt/ts/rs/py: the anchor half of issue #60 is the post-integration
        // contract owned by the anchor-vocabulary branches (today it surfaces
        // as the refs.anchor.no-target warning pinned in subtest h). The
        // deep-hop verdict above — the half this file owns — is
        // extension-agnostic and green now.
      }

      // File-level variant: the terminal ref is not a hop AND not a broken
      // ref — a valid pointer at on-disk non-spec content, for every flavor.
      const flatFiles = filesOf(reproSpec(f.path));
      const flatGraph = buildRefGraph(flatFiles, root);
      expect(detectDeepHops(flatGraph, 1, root)).toEqual([]);
      expect(checkRefs(flatFiles, flatGraph, root).filter(i => i.category === 'refs')).toEqual([]);
    });
  }

  test('b: max_hops 1 (default) and 2 both clean; maxHops null (check off) → no issues at all', () => {
    const root = makeDiskWs('unit-maxhops', { [REPRO_TXT]: DATA_FLOW_TXT });
    const graph = buildRefGraph(filesOf(reproSpec(`${REPRO_TXT}#creation-flow`)), root);
    expect(detectDeepHops(graph, 1, root)).toEqual([]);
    expect(detectDeepHops(graph, 2, root)).toEqual([]);
    // §18 delete-key semantics: maxHops null → the check is OFF, entirely.
    expect(detectDeepHops(graph, null, root)).toEqual([]);

    // Boundary at max_hops 2 — only refs BETWEEN LOADED SPEC FILES form hops:
    // a genuine 4-file chain flags …
    const chain = {
      '00-overview.md': '- Overview\n  - see: 01-topology.md\n',
      '01-topology.md': '- Topology\n  - see: 02-operations.md\n',
      '02-operations.md': '- Operations\n  - see: 03-archive.md\n',
      '03-archive.md': '- Archive\n',
    };
    const chainIssues = detectDeepHops(buildRefGraph(filesOf(chain), root), 2, root);
    expect(chainIssues.length).toBe(1);
    expect(chainIssues[0]!.file).toBe('02-operations.md');
    expect(chainIssues[0]!.message).toBe('DEEP HOP: 01-topology.md → 02-operations.md → 03-archive.md');
    // … while the same chain terminated by the on-disk artifact is clean:
    // the artifact hop is 0-hop, so the chain never reaches 3 spec hops.
    const terminated = {
      '00-overview.md': '- Overview\n  - see: 01-topology.md\n',
      '01-topology.md': '- Topology\n  - see: 02-operations.md\n',
      '02-operations.md': `- Operations\n  - see: ${REPRO_TXT}\n`,
    };
    expect(detectDeepHops(buildRefGraph(filesOf(terminated), root), 2, root)).toEqual([]);
  });

  test('c: artifact MISSING on disk → still mesh-exiting AND refs.broken.file (the exemption never downgrades broken)', () => {
    const root = makeDiskWs('unit-missing', {}); // the artifact never lands on disk
    const files = filesOf(reproSpec(`${REPRO_TXT}#creation-flow`));
    const graph = buildRefGraph(files, root);
    const issues = detectDeepHops(graph, 1, root);
    // A missing target is mesh-exiting in deep-hop terms, exactly as before …
    expect(issues.length).toBe(1);
    expect(issues[0]!.file).toBe('01-topology.md');
    expect(issues[0]!.rule).toBe('refs.deep_hop');
    expect(issues[0]!.level).toBe('error');
    expect(issues[0]!.message).toBe('DEEP HOP: 00-overview.md → 01-topology.md → artifacts/diagrams/data-flow.txt');
    // … and the missing target is separately a broken ref at the checkRefs
    // layer — the exemption must never downgrade that signal.
    const refIssues = checkRefs(files, graph, root).filter(i => i.category === 'refs');
    expect(refIssues.some(i => i.rule === 'refs.broken.file' && i.level === 'error' && i.message.includes(REPRO_TXT))).toBe(true);
    // The file-level spelling of the same missing target keeps the verdict.
    expect(detectDeepHops(buildRefGraph(filesOf(reproSpec(REPRO_TXT)), root), 1, root).length).toBe(1);
  });

  test('d: regression guard — a genuine 3-file spec chain still flags with root passed', () => {
    const root = makeDiskWs('unit-chain', { [REPRO_TXT]: DATA_FLOW_TXT });
    const chain = {
      '00-overview.md': '- Overview\n  - see: 01-topology.md\n',
      '01-topology.md': '- Topology\n  - see: 02-operations.md\n',
      '02-operations.md': '- Operations\n',
    };
    const issues = detectDeepHops(buildRefGraph(filesOf(chain), root), 1, root);
    expect(issues.length).toBe(1);
    expect(issues[0]!.file).toBe('01-topology.md');
    expect(issues[0]!.rule).toBe('refs.deep_hop');
    expect(issues[0]!.message).toBe('DEEP HOP: 00-overview.md → 01-topology.md → 02-operations.md');
  });

  test('e: mixed outgoing — the exempt artifact ref never masks the REAL spec hop; the error names the SPEC target', () => {
    const root = makeDiskWs('unit-mixed', { [REPRO_TXT]: DATA_FLOW_TXT });
    // The hub holds BOTH the artifact pointer (exempt, 0-hop) and a spec-file
    // exit (02-operations.md) — the exemption must surface the genuine chain
    // 01-topology → 00-overview → 02-operations and name the spec target.
    const spec = {
      '00-overview.md': `- Overview\n  - Data flow: see ${REPRO_TXT}\n  - see: 02-operations.md\n`,
      '01-topology.md': '- Topology\n  - Workspace map: see 00-overview.md\n',
      '02-operations.md': '- Operations\n',
    };
    const issues = detectDeepHops(buildRefGraph(filesOf(spec), root), 1, root);
    expect(issues.length).toBe(1);
    expect(issues[0]!.file).toBe('00-overview.md');
    expect(issues[0]!.message).toBe('DEEP HOP: 01-topology.md → 00-overview.md → 02-operations.md');
    expect(issues[0]!.message.includes('data-flow')).toBe(false); // never the artifact
  });

  test('f: escaping targets (../, absolute) never earn the exemption', () => {
    const parent = makeDiskWs('unit-escape', { 'outside.md': 'outside the workspace\n' });
    const root = join(parent, 'ws');
    mkdirSync(root, { recursive: true });

    // ../ — the target physically exists one level up; resolveSpecFile's
    // containment guard (issue #10) rejects it, so the ref stays mesh-exiting.
    const dotdot = {
      '00-overview.md': '- Overview\n  - see: ../outside.md\n',
      '01-topology.md': '- Topology\n  - Workspace map: see 00-overview.md\n',
    };
    const dotdotIssues = detectDeepHops(buildRefGraph(filesOf(dotdot), root), 1, root);
    expect(dotdotIssues.length).toBe(1);
    expect(dotdotIssues[0]!.file).toBe('00-overview.md');
    expect(dotdotIssues[0]!.message).toBe('DEEP HOP: 01-topology.md → 00-overview.md → ../outside.md');

    // Absolute — the very same file spelled absolutely; on disk, still
    // outside the root, still mesh-exiting.
    const absPath = join(parent, 'outside.md');
    const abs = {
      '00-overview.md': `- Overview\n  - see: ${absPath}\n`,
      '01-topology.md': '- Topology\n  - Workspace map: see 00-overview.md\n',
    };
    const absIssues = detectDeepHops(buildRefGraph(filesOf(abs), root), 1, root);
    expect(absIssues.length).toBe(1);
    expect(absIssues[0]!.file).toBe('00-overview.md');
    expect(absIssues[0]!.message).toBe(`DEEP HOP: 01-topology.md → 00-overview.md → ${absPath}`);
  });

  test('g: root null (legacy two-argument call) preserves the old classification — still flagged with the artifact on disk', () => {
    const root = makeDiskWs('unit-legacy', { [REPRO_TXT]: DATA_FLOW_TXT });
    const graph = buildRefGraph(filesOf(reproSpec(`${REPRO_TXT}#creation-flow`)), root);
    // Two-argument call (existing callers/tests) and explicit null: the
    // artifact is on disk, but without a root the detector cannot know that
    // — the legacy pre-#44 mesh-exiting verdict is preserved verbatim.
    const twoArg = detectDeepHops(graph, 1);
    const explicitNull = detectDeepHops(graph, 1, null);
    expect(twoArg.length).toBe(1);
    expect(explicitNull.length).toBe(1);
    expect(twoArg[0]!.file).toBe('01-topology.md');
    expect(twoArg[0]!.message).toBe('DEEP HOP: 00-overview.md → 01-topology.md → artifacts/diagrams/data-flow.txt');
    expect(explicitNull[0]).toEqual(twoArg[0]!);
  });

  test('h: layering — an anchor that matches nothing is the ONLY finding; no deep-hop error stacked on top', () => {
    const root = makeDiskWs('unit-layering', { [REPRO_TXT]: DATA_FLOW_TXT });
    const files = filesOf(reproSpec(`${REPRO_TXT}#no-such-flow`));
    const graph = buildRefGraph(files, root);
    const deepHops = detectDeepHops(graph, 1, root);

    // The half this file owns, green today and green forever after: a
    // terminal artifact ref NEVER stacks a deep-hop error under the anchor
    // failure — the target is 0-hop by construction, anchor or no anchor.
    expect(deepHops).toEqual([]);

    // The anchor failure itself, phrased per the CURRENT honest behavior:
    // the target is on disk but has no addressable nodes under today's
    // vocabulary (bullets / schematic keys), so checkRefs reports the
    // issue #49 advisory downgrade — and nothing else.
    const refIssues = checkRefs(files, graph, root).filter(i => i.category === 'refs');
    expect(refIssues.length).toBe(1);
    expect(refIssues[0]!.rule).toBe('refs.anchor.no-target');
    expect(refIssues[0]!.level).toBe('warning');
    expect(refIssues[0]!.file).toBe('01-topology.md');
    expect(refIssues[0]!.message).toBe(
      `anchor on non-outline target: ${REPRO_TXT}#no-such-flow — target has no addressable nodes (bullets or YAML keys); use a file-level ref`,
    );

    // POST-INTEGRATION CONTRACT (issue #60 anchor-vocabulary branches): once
    // #leaf anchors resolve against the natural addressable units of every
    // file kind, this same miss becomes the truthful refs.broken.anchor
    // error — still the ONLY failure, still with zero deep-hop issues beside
    // it. The two invariants that must survive that change are the ones
    // pinned above: exactly one anchor finding, and detectDeepHops === [].
    expect([...refIssues, ...deepHops].filter(i => i.rule === 'refs.deep_hop')).toEqual([]);
  });
});

// ── CLI scaffolding (mirrors test/issue-44-non-spec-hops.test.ts) ──

const cliDirs: string[] = [];

function makeWs(name: string, files: Record<string, string>): { tmp: string; root: string } {
  const tmp = join(SCRATCH, `cli-${name}-${cliDirs.length + 1}`);
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

/** The issue's exact repro workspace: the hub every spec file back-references,
 *  both spec files pointing at the on-disk plain-text diagram WITH the
 *  #creation-flow anchor, and the reporter's `_rules.yaml`
 *  (references.max_hops: 1). Modeled on the init template stubs (parents with
 *  2+ children, distinct short texts, no TBD floods) so no OTHER check fires —
 *  the deep-hop/anchor verdicts are the only things under test. */
const CLI_REPRO_FILES = {
  '00-overview.md': [
    '- Overview',
    '  - Product: draft specification for the claims hub',
    '  - Users: adjusters and policy admins',
    '  - Status: active development',
    '  - Topology map: see 01-topology.md',
    `  - Data flow: see ${REPRO_TXT}#creation-flow`,
    '',
  ].join('\n'),
  '01-topology.md': [
    '- Topology',
    '  - Services: intake, normalization, claims hub',
    '  - Links: point-to-point over TLS',
    '  - Workspace map: see 00-overview.md',
    `  - Creation flow: see ${REPRO_TXT}#creation-flow`,
    '',
  ].join('\n'),
  [REPRO_TXT]: DATA_FLOW_TXT,
  '_rules.yaml': 'references:\n  mode: pointer\n  max_hops: 1\n',
};

/** The same workspace with the anchors stripped — the file-level control the
 *  issue contrasts against (clean pass today). */
const CLI_REPRO_FILES_FILE_LEVEL: Record<string, string> = Object.fromEntries(
  Object.entries(CLI_REPRO_FILES).map(([name, body]) => [
    name,
    name.endsWith('.md') ? body.split('#creation-flow').join('') : body,
  ]),
);

describe('issue #60: cans check end-to-end', () => {
  test('i1: file-level .txt artifact refs — ok:true, exit 0, refs.deepHops 0', () => {
    const ws = makeWs('cli-file-level', CLI_REPRO_FILES_FILE_LEVEL);
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);

    // The terminal refs resolve on disk, cost zero hops, and break nothing:
    // the file-level flavor of the issue's workspace passes `cans check`.
    expect(j.ok).toBe(true);
    expect(r.exit).toBe(0);
    expect(j.refs.total).toBe(4);
    expect(j.refs.broken).toBe(0);
    expect(j.refs.deepHops).toBe(0);
    expect(j.issues.some((i: any) => i.rule === 'refs.deep_hop')).toBe(false);
    expect(j.issues.some((i: any) => i.rule.startsWith('refs.anchor.'))).toBe(false);
  });

  test('i2: POST-INTEGRATION — the issue\'s exact anchored repro is fully green (red until the #60 anchor-vocabulary branches land)', () => {
    const ws = makeWs('cli-anchored', CLI_REPRO_FILES);
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);

    // The terminal-ref half of issue #60 is already green on main and must
    // never regress: the anchored artifact refs are 0-hop terminals, so the
    // run never reports a deep hop and never reports a broken ref.
    expect(j.refs.total).toBe(4);
    expect(j.refs.broken).toBe(0);
    expect(j.refs.deepHops).toBe(0);
    expect(j.issues.some((i: any) => i.rule === 'refs.deep_hop')).toBe(false);

    // The full-green contract the anchor-vocabulary branches must deliver:
    // #creation-flow resolves against the natural addressable units of
    // data-flow.txt, so the run has zero findings at all and exits 0. RED
    // today — the run exits 1 with two refs.anchor.no-target warnings (the
    // anchor half of issue #60, owned by the parallel branches).
    expect(j.ok).toBe(true);
    expect(r.exit).toBe(0);
    expect(j.counts.errors).toBe(0);
    expect(j.counts.warnings).toBe(0);
    expect(j.issues.some((i: any) => i.rule.startsWith('refs.anchor.'))).toBe(false);
  });
});

// ── CLI scratch cleanup ──
afterEach(() => {
  while (cliDirs.length > 0) {
    rmSync(cliDirs.pop()!, { recursive: true, force: true });
  }
});
