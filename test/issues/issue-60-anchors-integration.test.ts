/**
 * Issue #60 integration contracts — anchors into non-spec artifact targets
 * through the SHARED verdict path (checkArtifactAnchor) and the CLI.
 *
 * The issue: `see:` refs to non-spec files (txt/json/yaml/toml/ts/rs/py…)
 * were already terminal for deep-hop purposes (the issue #44 exemption in
 * detectDeepHops — pinned here, not re-fixed), but `#anchors` on those
 * targets could not resolve: the shared verdict function knew bullet nodes
 * and schematic key paths only, so `artifacts/diagrams/data-flow.txt
 * #creation-flow` earned a spurious `refs.anchor.no-target` warning (exit 1)
 * instead of resolving against the file's natural addressable units.
 *
 * Post-fix contract (the integration layer over the text-heading and
 * code-symbol vocabularies wired into checkArtifactAnchor):
 *   1. A see: ref to a non-spec file inside the workspace is TERMINAL
 *      (0-hop) — never mesh-exiting for deep-hop.
 *   2. `#leaf` anchors resolve against the natural addressable units of
 *      every file kind: .txt section headings (`CREATION FLOW` →
 *      `#creation-flow`); .json object keys incl. nested (#58); .yaml/.yml
 *      mapping keys; .toml tables/keys; code files' top-level symbols
 *      (.ts/.js/.rs/.py/.go — exported functions, types, consts, modules).
 *   3. An anchor that genuinely matches nothing is the ONLY failure — a
 *      `refs.broken.anchor` error, never stacked under a spurious deep-hop
 *      error; a target with NOTHING addressable keeps the issue #49
 *      `refs.anchor.no-target` downgrade.
 *
 * Test map:
 *   a ..... the issue's EXACT repro e2e: 00-overview → 01-topology holding
 *           see: artifacts/diagrams/data-flow.txt#creation-flow, artifact
 *           on disk with a CREATION FLOW heading, _rules.yaml {mode:
 *           pointer, max_hops: 1} → zero issues, exit 0 (pre-fix: the
 *           refs.anchor.no-target warning, exit 1)
 *   b ..... unit: one anchored ref per file kind — txt#creation-flow and
 *           #directory-tree, json#database.host + flat #database,
 *           yaml#maintenance, toml#rules.max_hops + #rules-tree,
 *           ts#createRule, rs#parse_header, py#register_hook — checkRefs
 *           silent on every one
 *   c/c2 .. unit: an anchor MISS on a target that HAS a vocabulary →
 *           refs.broken.anchor ERROR (c: txt, c2: ts), and NO
 *           refs.deep_hop issue — the only-failure discipline
 *   d ..... unit: a near-miss on a txt target suggests the heading —
 *           `did you mean …#CREATION-FLOW?` (the suggestion pool includes
 *           heading texts)
 *   e ..... unit: a target with NOTHING addressable (.csv, empty .txt)
 *           keeps the refs.anchor.no-target downgrade — warning, never a
 *           fabricated broken anchor
 *   f ..... unit: the terminal pin — the hub every file back-references
 *           holds its anchored artifact pointer: checkRefs silent AND
 *           detectDeepHops silent (the #44 layer under the #60 scenario)
 *   g ..... CLI e2e: the txt anchor miss — exit 2, refs.broken 1,
 *           deepHops 0, no refs.deep_hop on the wire; the broken anchor is
 *           the only refs finding
 *   h ..... CLI e2e: --fix proposes the heading candidate for a txt target
 *           (#CREATION-FLO → #CREATION-FLOW); --fix --yes applies it,
 *           refs.broken 0, exit 0, artifact bytes untouched
 *   n ..... CLI e2e: an external name:// txt target with an anchor
 *           resolves through the shared verdict path (checkExternalRef →
 *           checkArtifactAnchor) — clean run
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { rmSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';

import { parseOutline } from '../../src/core/outline.ts';
import { buildRefGraph, checkRefs, detectDeepHops } from '../../src/core/refs.ts';
import type { OutlineNode } from '../../src/types.ts';
import { spawnCli, REPO } from '../runtime.ts';
import { makeCansWorkspace } from '../helpers.ts';

// ── The issue's artifacts — real on-disk files, one per addressable kind ──

/** The issue's exact artifact: a plain-text diagram addressed by its
 *  section headings (`CREATION FLOW` → `#creation-flow`). */
const DATA_FLOW_TXT = [
  'CREATION FLOW',
  '',
  'The claim enters the hub, is validated, then routed',
  'to the adjuster queue.',
  '',
  'DIRECTORY TREE',
  '',
  'overview -> topology -> authentication',
  '',
].join('\n');

const CONFIG_JSON = '{"database": {"host": "db.local", "port": 5432}, "cache": {"ttl": 30}}';
const GOVERNANCE_YAML = 'governance:\n  maintenance:\n    window: weekly\n  query:\n    owner: platform\n';
const RULES_TOML = '[rules]\nmax_hops = 1\n\n[rules-tree]\ndepth = 3\n';

/** Code artifacts: top-level symbols are the addressable units — the
 *  ref targets the exported function, never an import or a local. */
const RULES_TS = [
  'import type { Rule } from "../types.ts";',
  '',
  'export function createRule(name: string, check: () => void): Rule {',
  '  return { name, check } as Rule;',
  '}',
  '',
  'export const MAX_RULES = 64;',
  '',
  'export interface RuleSet { rules: Rule[] }',
  '',
].join('\n');

const REGISTRY_RS = [
  'use std::collections::HashMap;',
  '',
  'pub fn parse_header(line: &str) -> Option<(String, String)> {',
  '    let (k, v) = line.split_once(\':\')?;',
  '    Some((k.trim().to_string(), v.trim().to_string()))',
  '}',
  '',
  'pub struct Registry {',
  '    headers: HashMap<String, String>,',
  '}',
  '',
].join('\n');

const HOOKS_PY = [
  '"""Lifecycle hooks for the claims hub."""',
  '',
  'def register_hook(name, handler):',
  '    _HOOKS[name] = handler',
  '',
  'def unregister_hook(name):',
  '    _HOOKS.pop(name, None)',
  '',
  '_HOOKS = {}',
  '',
].join('\n');

// ── Scaffolding (mirrors test/issues/issue-58-anchors.test.ts) ──

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-60');
const createdDirs: string[] = [];

function makeWs(name: string, files: Record<string, string>): { tmp: string; root: string } {
  const tmp = join(SCRATCH, `${name}-${createdDirs.length + 1}`);
  const root = makeCansWorkspace(tmp, files);
  createdDirs.push(tmp);
  return { tmp, root };
}

function loadFiles(spec: Record<string, string>): Map<string, OutlineNode[]> {
  const map = new Map<string, OutlineNode[]>();
  for (const [name, body] of Object.entries(spec)) map.set(name, parseOutline(body, name));
  return map;
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

// ── Unit: the natural anchor vocabulary of every file kind ──

describe('issue #60: checkRefs — natural addressable units per file kind', () => {
  test('b: one anchored ref per kind — txt, json, yaml, toml, ts, rs, py — all resolve, checkRefs silent', () => {
    const spec = {
      '00-overview.md': [
        '- Overview',
        '  - Text flow: see artifacts/diagrams/data-flow.txt#creation-flow',
        '  - Text tree: see artifacts/diagrams/data-flow.txt#directory-tree',
        '  - JSON leaf: see artifacts/config.json#database.host',
        '  - JSON object: see artifacts/config.json#database',
        '  - YAML window: see artifacts/governance.yaml#maintenance',
        '  - TOML path: see artifacts/rules.toml#rules.max_hops',
        '  - TOML table: see artifacts/rules.toml#rules-tree',
        '  - TS symbol: see artifacts/code/rules.ts#createRule',
        '  - Rust symbol: see artifacts/code/registry.rs#parse_header',
        '  - Python symbol: see artifacts/code/hooks.py#register_hook',
        '',
      ].join('\n'),
    };
    const ws = makeWs('kinds', {
      ...spec,
      'artifacts/diagrams/data-flow.txt': DATA_FLOW_TXT,
      'artifacts/config.json': CONFIG_JSON,
      'artifacts/governance.yaml': GOVERNANCE_YAML,
      'artifacts/rules.toml': RULES_TOML,
      'artifacts/code/rules.ts': RULES_TS,
      'artifacts/code/registry.rs': REGISTRY_RS,
      'artifacts/code/hooks.py': HOOKS_PY,
    });
    const files = loadFiles(spec);
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
    expect(issues).toEqual([]); // every file kind answered its anchor
  });

  test('c: a txt anchor MISS on a target that HAS a vocabulary → refs.broken.anchor ERROR, and NO deep-hop issue', () => {
    // The issue's shape: the holder (01-topology) is referenced by
    // 00-overview, so a mesh-exiting artifact ref would deep-hop — but the
    // txt target is terminal, so the genuine miss stands ALONE.
    const spec = {
      '00-overview.md': '- Overview\n  - Product: draft specification for the claims hub\n  - Service layout: see 01-topology.md\n',
      '01-topology.md': '- Topology\n  - Services: api, worker, db\n  - Data flow: see artifacts/diagrams/data-flow.txt#no-such-heading\n',
    };
    const ws = makeWs('miss', { ...spec, 'artifacts/diagrams/data-flow.txt': DATA_FLOW_TXT });
    const files = loadFiles(spec);
    const graph = buildRefGraph(files, ws.root);
    const issues = checkRefs(files, graph, ws.root);
    // The miss is the ONLY refs failure — a truthful error now that the
    // target has headings to match against (not the old advisory
    // downgrade, not silence).
    expect(issues).toHaveLength(1);
    expect(issues[0]!.level).toBe('error');
    expect(issues[0]!.rule).toBe('refs.broken.anchor');
    expect(issues[0]!.message).toBe('broken anchor: artifacts/diagrams/data-flow.txt#no-such-heading — no node matches');
    // The only-failure discipline: no spurious deep-hop error stacked
    // under it (the target is terminal — 0 hops by construction).
    expect(detectDeepHops(graph, 1, ws.root)).toEqual([]);
  });

  test('c2: same discipline for a code target — #NoSuchSymbol on rules.ts → refs.broken.anchor, no deep hop', () => {
    const spec = {
      '00-overview.md': '- Overview\n  - Product: draft specification for the claims hub\n  - Rules code: see artifacts/code/rules.ts#NoSuchSymbol\n',
    };
    const ws = makeWs('miss-code', { ...spec, 'artifacts/code/rules.ts': RULES_TS });
    const files = loadFiles(spec);
    const graph = buildRefGraph(files, ws.root);
    const issues = checkRefs(files, graph, ws.root);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.level).toBe('error');
    expect(issues[0]!.rule).toBe('refs.broken.anchor');
    expect(issues[0]!.message).toBe('broken anchor: artifacts/code/rules.ts#NoSuchSymbol — no node matches');
    expect(detectDeepHops(graph, 1, ws.root)).toEqual([]);
  });

  test('d: a near-miss on a txt target suggests the heading — the suggestion pool includes heading texts', () => {
    const spec = {
      '00-overview.md': '- Overview\n  - Flow: see artifacts/diagrams/data-flow.txt#CREATION-FLO\n  - Scope\n',
    };
    const ws = makeWs('suggest', { ...spec, 'artifacts/diagrams/data-flow.txt': DATA_FLOW_TXT });
    const files = loadFiles(spec);
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.rule).toBe('refs.broken.anchor');
    // The ref follows the content (issue #53): ONE near candidate among the
    // headings → the canonical slug spelling of `CREATION FLOW`.
    expect(issues[0]!.suggestion).toBe('did you mean artifacts/diagrams/data-flow.txt#CREATION-FLOW? — fix the ref anchor');
  });

  test('e: a target with NOTHING addressable (.csv, empty .txt) keeps the refs.anchor.no-target downgrade', () => {
    const spec = {
      '00-overview.md': [
        '- Overview',
        '  - Matrix: see artifacts/matrix.csv#row-count',
        '  - Blank: see artifacts/empty.txt#anything',
        '',
      ].join('\n'),
    };
    const ws = makeWs('nada', {
      ...spec,
      'artifacts/matrix.csv': 'a,b,c\n1,2,3\n',
      'artifacts/empty.txt': '\n',
    });
    const files = loadFiles(spec);
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
    // The issue #49 advisory downgrade is preserved for formats outside the
    // vocabulary: a warning naming the full addressable set, never a
    // fabricated broken-anchor error and never a silent pass.
    const downgraded = issues.filter(i => i.rule === 'refs.anchor.no-target');
    expect(downgraded).toHaveLength(2);
    expect(downgraded.every(i => i.level === 'warning')).toBe(true);
    expect(downgraded[0]!.message).toBe(
      'anchor on non-outline target: artifacts/matrix.csv#row-count — target has no addressable nodes (bullets, schematic key paths, text headings, code symbols); use a file-level ref',
    );
    expect(downgraded[1]!.message).toBe(
      'anchor on non-outline target: artifacts/empty.txt#anything — target has no addressable nodes (bullets, schematic key paths, text headings, code symbols); use a file-level ref',
    );
    expect(issues.filter(i => i.rule === 'refs.broken.anchor')).toHaveLength(0);
  });

  test('f: terminal pin — the hub every file back-references may hold its anchored artifact pointer', () => {
    // The issue #44 hub shape under the #60 scenario: the anchor must
    // RESOLVE (refs layer) and the artifact ref must never count as
    // mesh-exiting (deep-hop layer) — both layers silent together.
    const spec = {
      '00-overview.md': '- Overview\n  - Data flow: see artifacts/diagrams/data-flow.txt#creation-flow\n',
      '01-auth.md': '- Auth\n  - see: 00-overview.md\n',
      '02-data.md': '- Data\n  - see: 00-overview.md\n',
    };
    const ws = makeWs('terminal', { ...spec, 'artifacts/diagrams/data-flow.txt': DATA_FLOW_TXT });
    const files = loadFiles(spec);
    const graph = buildRefGraph(files, ws.root);
    expect(checkRefs(files, graph, ws.root)).toEqual([]);
    expect(detectDeepHops(graph, 1, ws.root)).toEqual([]);
  });
});

// ── CLI end-to-end ──

describe('issue #60: cans check end-to-end', () => {
  test('a: the issue\'s EXACT repro — anchored txt artifact ref → zero issues, exit 0', () => {
    const ws = makeWs('cli-repro', {
      '00-overview.md': [
        '- Overview',
        '  - Product: draft specification for the claims hub',
        '  - Users: adjusters and policy admins',
        '  - Status: active development',
        '  - Service layout: see 01-topology.md',
        '',
      ].join('\n'),
      '01-topology.md': [
        '- Topology',
        '  - Services: api, worker, db',
        '  - Data flow: see artifacts/diagrams/data-flow.txt#creation-flow',
        '',
      ].join('\n'),
      '_rules.yaml': 'references:\n  mode: pointer\n  max_hops: 1\n',
      'artifacts/diagrams/data-flow.txt': DATA_FLOW_TXT,
    });
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    // The exact case from the issue: fully clean, exit 0 (was: the
    // refs.anchor.no-target warning and exit 1).
    expect(j.ok).toBe(true);
    expect(r.exit).toBe(0);
    expect(j.counts.errors).toBe(0);
    expect(j.counts.warnings).toBe(0);
    expect(j.refs).toEqual({ total: 2, broken: 0, deepHops: 0 });
    expect(j.issues).toEqual([]);
  });

  test('g: the txt anchor miss — exit 2, refs.broken 1, deepHops 0, and the broken anchor is the ONLY refs finding', () => {
    const ws = makeWs('cli-miss', {
      '00-overview.md': [
        '- Overview',
        '  - Product: draft specification for the claims hub',
        '  - Users: adjusters and policy admins',
        '  - Status: active development',
        '  - Service layout: see 01-topology.md',
        '',
      ].join('\n'),
      '01-topology.md': [
        '- Topology',
        '  - Services: api, worker, db',
        '  - Data flow: see artifacts/diagrams/data-flow.txt#no-such-heading',
        '',
      ].join('\n'),
      '_rules.yaml': 'references:\n  mode: pointer\n  max_hops: 1\n',
      'artifacts/diagrams/data-flow.txt': DATA_FLOW_TXT,
    });
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    // The miss is the only failure: one error, no deep-hop finding beside
    // it (the terminal target cannot mint one), exit 2.
    expect(j.ok).toBe(false);
    expect(r.exit).toBe(2);
    expect(j.counts.errors).toBe(1);
    expect(j.refs).toEqual({ total: 2, broken: 1, deepHops: 0 });
    expect(j.issues.some((i: any) => i.rule === 'refs.deep_hop')).toBe(false);
    const broken = j.issues.find((i: any) => i.rule === 'refs.broken.anchor');
    expect(broken).toBeDefined();
    expect(broken.detail).toBe('broken anchor: artifacts/diagrams/data-flow.txt#no-such-heading — no node matches');
    expect(j.issues.filter((i: any) => i.category === 'refs')).toHaveLength(1);
  });

  test('h: --fix proposes the heading candidate for a txt target; --fix --yes applies it', () => {
    const files = {
      '00-overview.md': '- Overview\n  - Flow: see artifacts/diagrams/data-flow.txt#CREATION-FLO\n  - Scope\n',
      'artifacts/diagrams/data-flow.txt': DATA_FLOW_TXT,
    };
    const ws = makeWs('cli-fix', files);
    // Pre-fix: the one-letter-off anchor is a plain broken-anchor error.
    const plain = runCli(['check', '--json'], ws.tmp);
    expect(plain.exit).toBe(2);
    // --fix PROPOSES the heading candidate (the repair candidate vocabulary
    // mirrors the resolution vocabulary — headings are candidates too).
    const propose = runCli(['check', '--fix', '--json'], ws.tmp);
    const jp = parseJsonOut(propose.out);
    expect(propose.exit).toBe(2); // proposing is not fixing
    expect(jp.anchorFixes).toEqual([
      { file: '00-overview.md', line: 2, from: 'CREATION-FLO', to: 'CREATION-FLOW', applied: false },
    ]);
    // --fix --yes APPLIES the pure anchor substitution: error gone, exit 0.
    const apply = runCli(['check', '--fix', '--yes', '--json'], ws.tmp);
    const ja = parseJsonOut(apply.out);
    expect(apply.exit).toBe(0);
    expect(ja.refs.broken).toBe(0);
    expect(ja.counts.errors).toBe(0);
    expect(ja.anchorFixes).toEqual([
      { file: '00-overview.md', line: 2, from: 'CREATION-FLO', to: 'CREATION-FLOW', applied: true },
    ]);
    expect(readFileSync(join(ws.root, '00-overview.md'), 'utf-8'))
      .toBe('- Overview\n  - Flow: see artifacts/diagrams/data-flow.txt#CREATION-FLOW\n  - Scope\n');
    // The artifact is never touched (pure referrer-side repair).
    expect(readFileSync(join(ws.root, 'artifacts/diagrams/data-flow.txt'), 'utf-8')).toBe(DATA_FLOW_TXT);
  });
});

// ── name:// external targets — the shared verdict path ──

describe('issue #60: external name:// txt targets share the vocabulary', () => {
  const RULES_EXT = [
    'references:',
    '  mode: pointer',
    '  back_pointers: false',
    '  max_hops: 1',
    '  orphan_check: true',
    '  duplicate_home_check: true',
    '  external_roots:',
    '    kelir: "../ext/kelir-cans"',
    ''].join('\n');

  function makeExtWs(name: string, spec: string, external: Record<string, string>): { projectRoot: string } {
    const base = join(SCRATCH, `ext-${name}-${createdDirs.length + 1}`);
    const projectRoot = join(base, 'project');
    makeCansWorkspace(projectRoot, { '07-lifecycle.md': spec });
    createdDirs.push(base);
    writeFileSync(join(projectRoot, 'cans', '_rules.yaml'), RULES_EXT, 'utf8');
    for (const [rel, content] of Object.entries(external)) {
      const p = join(base, 'ext', 'kelir-cans', rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content, 'utf8');
    }
    return { projectRoot };
  }

  test('n: an external txt artifact with an anchored pointer resolves — clean run, exit 0', () => {
    const spec = '- Lifecycle\n  - Runbook: see: kelir://artifacts/runbook.txt#creation-flow\n  - Scope\n';
    const ws = makeExtWs('txt', spec, { 'artifacts/runbook.txt': DATA_FLOW_TXT });
    const r = runCli(['check', '--json'], ws.projectRoot);
    const j = parseJsonOut(r.out);
    // checkExternalRef hands the anchor to the same shared verdict function
    // as on-disk targets — the heading vocabulary resolves it there too.
    expect(j.ok).toBe(true);
    expect(r.exit).toBe(0);
    expect(j.refs).toEqual({ total: 1, broken: 0, deepHops: 0 });
    expect(j.issues).toEqual([]);
  });
});
