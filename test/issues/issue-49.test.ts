/**
 * Issue #49 regression tests — anchors on YAML / non-bullet targets can
 * never resolve.
 *
 * Defect: for a target not in the loaded set, checkRefs ran parseOutline on
 * the raw file and matched the anchor against BULLET NODES ONLY. YAML files
 * (and prose docs) contain no bullets, so every #anchor on them was a
 * guaranteed refs.broken.anchor error — 56 in the reporter's tree
 * (`artifacts/governance.yaml#maintenance`, `artifacts/policy.yaml#query`,
 * `artifacts/cicd.yaml#trinity`, …) even though those keys exist in the YAML.
 * Only /^\d{2}-.+\.md$/ spec files are ever loaded, so YAML targets always
 * took the read-from-disk branch — where the answer was structurally "broken".
 *
 * Fix (one coherent root-cause change, both directions the issue suggests):
 *  (a) YAML mapping keys are addressable anchors: extractYamlKeys() reads the
 *      `key:` vocabulary of a .yaml/.yml target and anchor matching runs
 *      against bullet nodes AND keys, with the SAME §12 anchorMatches
 *      normalization (#Data-protection matches key `data protection:`,
 *      #maintenance matches `maintenance:`). Key matching is strictly
 *      ADDITIVE — parseOutline keeps minting bullet nodes from YAML block
 *      sequences (`- item` lines are bullet-shaped), that behavior stays.
 *  (b) zero addressable targets (prose .md, empty yaml, anything with no
 *      bullets and no keys) → NO refs.broken.anchor error; a WARNING with the
 *      new rule refs.anchor.no-target (anchors are only meaningful on
 *      outline-shaped targets; a file-level ref is valid on any target).
 *      When addressable targets EXIST but none match, the refs.broken.anchor
 *      ERROR stays — now truthful, because the key/node genuinely isn't there.
 *
 * Test map:
 *   k1-k4 . extractYamlKeys units: nested keys at any depth; quoted keys
 *          (single/double, quotes stripped); keys inside sequence items;
 *          comments / URLs / plain scalars / colons-without-space never keys
 *   a ..... the reporter's exact repro: artifacts/*.yaml#<key> resolves —
 *          refs.broken 0, zero refs issues (unit)
 *   a2 .... same workspace, §12 anchor normalization across the key path
 *          (#Data-protection ↔ key `data protection:`)
 *   a3 .... extension variants: .yml and uppercase .YAML resolve through the
 *          same key path; empty yaml → the (b) downgrade
 *   b ..... yaml#nonexistent-key → truthful refs.broken.anchor ERROR (nodes
 *          and keys exist, none match)
 *   c ..... prose .md#anchor (docs/notes.md, no bullets) → refs.anchor.no-
 *          target WARNING, not an error, NOT counted in refs.broken (CLI --json)
 *   c2 .... loaded prose-only spec .md (zero nodes) → same warning downgrade
 *   d ..... yaml with block sequences: bullet-node matching still works
 *          (pre-existing behavior), keys are strictly additive
 *   e ..... `cans check --fix` writes NOTHING into YAML targets (no
 *          <!-- ref-by --> comment injected into YAML — that would corrupt
 *          it) and mints no stale-back-pointer warning
 *   g ..... CLI end-to-end --json parity on the repro workspace:
 *          refs.broken 0, no refs.anchor.no-target (keys resolve)
 *   h ..... control: normal .md#anchor behavior completely unchanged
 *          (hit → no issue; miss → refs.broken.anchor error; missing file →
 *          refs.broken.file error)
 *   f ..... report.ts classification pin lives in test/report.test.ts
 *          (the rule path and the message-shape fallback path MUST agree —
 *          module header contract): one added miscScenario row + key/pattern
 *          assertions.
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { rmSync, readFileSync } from 'fs';

import { parseOutline } from '../../src/core/outline.ts';
import {
  extractYamlKeys, buildRefGraph, checkRefs, rebuildBackPointers,
} from '../../src/core/refs.ts';
import type { OutlineNode } from '../../src/types.ts';
import { spawnCli, REPO } from '../runtime.ts';
import { makeCansWorkspace } from '../helpers.ts';

// ── The issue's repro workspace (numbered spec files + artifacts/*.yaml) ──

const REPRO_FILES = {
  '00-overview.md': '- Overview\n  - Governance: see artifacts/governance.yaml#maintenance\n  - Policy: see artifacts/policy.yaml#query\n',
  '01-cicd.md': '- CI/CD\n  - Deploy pipeline: see artifacts/cicd.yaml#trinity\n',
  'artifacts/governance.yaml': 'governance:\n  maintenance:\n    window: weekly\n    owner: platform\n',
  'artifacts/policy.yaml': 'policy:\n  query:\n    timeout: 30s\n',
  'artifacts/cicd.yaml': 'deploy:\n  trinity:\n    stages: [build, test, ship]\n',
};

/** Same shape plus a quoted key with spaces — the §12 `#Data-protection`
 *  convention must work across the YAML-key path too. */
const QUOTED_KEY_FILES = {
  '00-overview.md': '- Overview\n  - Privacy: see artifacts/policy.yaml#Data-protection\n',
  'artifacts/policy.yaml': "policy:\n  'data protection': strict\n  query:\n    timeout: 30s\n",
};

/** YAML with block sequences: parseOutline mints bullet nodes from `- item`
 *  lines (pre-existing), keys are the additive vocabulary. */
const SEQ_YAML_FILES = {
  '00-overview.md': '- Overview\n  - Rollout: see artifacts/rollout.yaml#window\n  - Canary: see artifacts/rollout.yaml#canary\n  - Full: see artifacts/rollout.yaml#full-ship\n  - Missing: see artifacts/rollout.yaml#nightly\n',
  'artifacts/rollout.yaml': 'rollout:\n  window: nightly\n  steps:\n    - canary\n    - full ship\n',
};

/** Prose doc in a subfolder (not a spec file — the issue's "prose docs"). */
const PROSE_FILES = {
  '00-overview.md': '- Overview\n  - Notes: see docs/notes.md#anything\n  - Second child\n',
  'docs/notes.md': 'These are prose notes.\n\nNo bullets here, only paragraphs.\n\nAn anchor can never resolve to a node.\n',
};

/** Loaded prose-only spec file: zero bullet nodes, zero keys. */
const EMPTY_SPEC_FILES = {
  '00-overview.md': '- Overview\n  - Draft: see 02-draft.md#scope\n  - Second child\n',
  '02-draft.md': 'This spec file is still prose only.\n\nNo outline yet.\n',
};

function loadFiles(spec: Record<string, string>): Map<string, OutlineNode[]> {
  const map = new Map<string, OutlineNode[]>();
  for (const [name, body] of Object.entries(spec)) map.set(name, parseOutline(body, name));
  return map;
}

// ── CLI scaffolding (mirrors test/issues/issue-22.test.ts) ──

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-49');
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

// ── Unit: extractYamlKeys (issue #49 fix half (a)) ──

describe('issue #49: extractYamlKeys — mapping keys at any depth', () => {
  test('k1: unquoted keys at every indentation level, values ignored', () => {
    const yaml = [
      'governance:',              // depth 0, nested block value
      '  maintenance:',           // depth 1, nested block value
      '    window: weekly',       // depth 2, scalar value
      '    owner: platform team', // scalar value with spaces
      'policy:',                  // depth 0 again
      '  query:',                 // depth 1
      '    timeout: 30s',         // depth 2
    ].join('\n');
    expect(extractYamlKeys(yaml)).toEqual([
      'governance', 'maintenance', 'window', 'owner', 'policy', 'query', 'timeout',
    ]);
  });

  test('k2: quoted keys (single and double) are unquoted before use', () => {
    const yaml = [
      "'maintenance window': weekly",
      '"query": SELECT * FROM claims',
      'nested:',
      '  "data protection": strict',
    ].join('\n');
    expect(extractYamlKeys(yaml)).toEqual(['maintenance window', 'query', 'nested', 'data protection']);
  });

  test('k3: keys inside sequence items are addressable', () => {
    const yaml = [
      'artifacts:',
      '  - name: governance',
      '    path: artifacts/governance.yaml',
      "  - 'name': policy",
      'plain:',
      '  - just a scalar item',
    ].join('\n');
    expect(extractYamlKeys(yaml)).toEqual(['artifacts', 'name', 'path', 'name', 'plain']);
  });

  test('k4: comments, URLs, colon-without-space and prose are never keys', () => {
    const yaml = [
      '# a comment line is not a key',
      '  # indented comment either',
      'trinity: a b c # trailing comment — key still extracted',
      'visit: http://example.com/x',   // value URL; the KEY is `visit`
      'plain scalar with no colon',
      'nospace:value',                 // YAML plain scalar, not a mapping
      '---',
      '...',
      '',
      '  - # comment inside a sequence item',
    ].join('\n');
    expect(extractYamlKeys(yaml)).toEqual(['trinity', 'visit']);
  });

  test('k4b: empty source yields zero keys', () => {
    expect(extractYamlKeys('')).toEqual([]);
    expect(extractYamlKeys('\n\n')).toEqual([]);
  });
});

// ── Unit: checkRefs resolution (both halves, disk branch) ──

describe('issue #49: checkRefs — YAML mapping keys as addressable anchors', () => {
  test('a: the reporter’s exact repro — artifacts/*.yaml#<key> resolves, 0 refs issues', () => {
    const ws = makeWs('unit-repro', REPRO_FILES);
    const files = loadFiles({
      '00-overview.md': REPRO_FILES['00-overview.md']!,
      '01-cicd.md': REPRO_FILES['01-cicd.md']!,
    });
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);

    // The three exact refs from the issue — all resolve against YAML keys.
    expect(issues.filter(i => i.category === 'refs')).toHaveLength(0);
  });

  test('a2: §12 anchor normalization works across the key path (#Data-protection ↔ ‘data protection:’)', () => {
    const ws = makeWs('unit-quoted', QUOTED_KEY_FILES);
    const files = loadFiles({ '00-overview.md': QUOTED_KEY_FILES['00-overview.md']! });
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
    expect(issues.filter(i => i.category === 'refs')).toHaveLength(0);
  });

  test('a3: extension variants (.yml, uppercase .YAML) and empty yaml', () => {
    const ws = makeWs('unit-ext', {
      '00-overview.md': '- Overview\n  - A: see artifacts/config.yml#Data-protection\n  - B: see up/gov.YAML#maintenance\n  - C: see artifacts/empty.yaml#anything\n',
      'artifacts/config.yml': "deploy:\n  'data protection': strict\n",
      'up/gov.YAML': 'maintenance: weekly\n',
      'artifacts/empty.yaml': '',
    });
    const files = loadFiles({ '00-overview.md': '- Overview\n  - A: see artifacts/config.yml#Data-protection\n  - B: see up/gov.YAML#maintenance\n  - C: see artifacts/empty.yaml#anything\n' });
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);

    // .yml and .YAML targets resolve through the same key path (extension
    // test is case-insensitive); an EMPTY yaml has no keys and no nodes, so
    // its anchor takes the zero-addressable-target downgrade instead.
    expect(issues.filter(i => i.message.includes('config.yml'))).toHaveLength(0);
    expect(issues.filter(i => i.message.includes('gov.YAML'))).toHaveLength(0);
    const downgraded = issues.filter(i => i.rule === 'refs.anchor.no-target');
    expect(downgraded).toHaveLength(1);
    expect(downgraded[0]!.message).toBe(
      'anchor on non-outline target: artifacts/empty.yaml#anything — target has no addressable nodes (bullets or YAML keys); use a file-level ref',
    );
  });

  test('b: yaml#nonexistent-key stays a truthful refs.broken.anchor ERROR', () => {
    const ws = makeWs('unit-broken-key', REPRO_FILES);
    const spec = {
      '00-overview.md': '- Overview\n  - Governance: see artifacts/governance.yaml#nosuchkey\n  - Second child\n',
    };
    const files = loadFiles(spec);
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
    const anchorIssues = issues.filter(i => i.rule === 'refs.broken.anchor');
    expect(anchorIssues).toHaveLength(1);
    expect(anchorIssues[0]!.level).toBe('error');
    expect(anchorIssues[0]!.message).toBe('broken anchor: artifacts/governance.yaml#nosuchkey — no node matches');
  });

  test('d: yaml block sequences still mint bullet nodes; keys are additive', () => {
    const ws = makeWs('unit-seq', SEQ_YAML_FILES);
    const files = loadFiles({ '00-overview.md': SEQ_YAML_FILES['00-overview.md']! });
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
    const anchorIssues = issues.filter(i => i.rule === 'refs.broken.anchor');
    // `#window` resolves via KEY (no node matches), `#canary` and `#full-ship`
    // via parseOutline's bullet nodes (`- canary`, `- full ship` — §12
    // normalization), `#nightly` is a VALUE, not a key or node → the one
    // truthful error.
    expect(anchorIssues).toHaveLength(1);
    expect(anchorIssues[0]!.message).toBe('broken anchor: artifacts/rollout.yaml#nightly — no node matches');
  });
});

// ── Unit: zero-addressable-target downgrade (fix half (b)) ──

describe('issue #49: checkRefs — zero-addressable-target downgrade', () => {
  test('c: prose .md#anchor → refs.anchor.no-target WARNING, never refs.broken.anchor', () => {
    const ws = makeWs('unit-prose', PROSE_FILES);
    const files = loadFiles({ '00-overview.md': PROSE_FILES['00-overview.md']! });
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);

    const downgraded = issues.filter(i => i.rule === 'refs.anchor.no-target');
    expect(downgraded).toHaveLength(1);
    expect(downgraded[0]!.level).toBe('warning');
    expect(downgraded[0]!.category).toBe('refs');
    expect(downgraded[0]!.message).toBe(
      'anchor on non-outline target: docs/notes.md#anything — target has no addressable nodes (bullets or YAML keys); use a file-level ref',
    );
    expect(downgraded[0]!.suggestion).toBe(
      'drop the #anything anchor (file-level refs are valid on any target), or add the anchor as a node/key in docs/notes.md',
    );
    // The warning replaced the error — no refs.broken.* at all.
    expect(issues.filter(i => i.rule === 'refs.broken.anchor')).toHaveLength(0);
    expect(issues.filter(i => i.rule === 'refs.broken.file')).toHaveLength(0);
  });

  test('c2: loaded prose-only spec .md (zero nodes) → same warning downgrade', () => {
    const ws = makeWs('unit-empty-spec', EMPTY_SPEC_FILES);
    const files = loadFiles({
      '00-overview.md': EMPTY_SPEC_FILES['00-overview.md']!,
      '02-draft.md': EMPTY_SPEC_FILES['02-draft.md']!,
    });
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
    const downgraded = issues.filter(i => i.rule === 'refs.anchor.no-target');
    expect(downgraded).toHaveLength(1);
    expect(downgraded[0]!.message).toBe(
      'anchor on non-outline target: 02-draft.md#scope — target has no addressable nodes (bullets or YAML keys); use a file-level ref',
    );
    expect(issues.filter(i => i.rule === 'refs.broken.anchor')).toHaveLength(0);
  });

  test('c3: rebuildBackPointers earns no mark for an anchored ref to a YAML target', () => {
    const ws = makeWs('unit-bp', REPRO_FILES);
    const files = loadFiles({
      '00-overview.md': REPRO_FILES['00-overview.md']!,
      '01-cicd.md': REPRO_FILES['01-cicd.md']!,
    });
    const groups = rebuildBackPointers(files, buildRefGraph(files, ws.root));
    // YAML targets are never in the loaded map — an anchored ref to one finds
    // no target and earns NO mark (nothing for --fix to write into the YAML).
    expect(groups.has('artifacts/governance.yaml')).toBe(false);
    expect(groups.has('artifacts/policy.yaml')).toBe(false);
    expect(groups.has('artifacts/cicd.yaml')).toBe(false);
  });
});

// ── Unit: control — .md anchor behavior is completely unchanged ──

describe('issue #49: control — normal .md#anchor behavior unchanged', () => {
  test('h: hit → no issue; miss → refs.broken.anchor; missing file → refs.broken.file', () => {
    const ws = makeWs('unit-control', {
      '00-overview.md': '- Overview\n  - Auth: see 02-auth.md#Sessions\n  - Miss: see 02-auth.md#Nope\n  - Gone: see 99-missing.md#x\n',
      '02-auth.md': '- Authentication\n  - Sessions\n    - Expire after 24h\n',
    });
    const files = loadFiles({
      '00-overview.md': '- Overview\n  - Auth: see 02-auth.md#Sessions\n  - Miss: see 02-auth.md#Nope\n  - Gone: see 99-missing.md#x\n',
      '02-auth.md': '- Authentication\n  - Sessions\n    - Expire after 24h\n',
    });
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);

    const hitIssues = issues.filter(i => i.message.includes('02-auth.md#Sessions'));
    expect(hitIssues).toHaveLength(0); // exact + §12-normalized hits stay silent

    const anchorIssues = issues.filter(i => i.rule === 'refs.broken.anchor');
    expect(anchorIssues).toHaveLength(1);
    expect(anchorIssues[0]!.message).toBe('broken anchor: 02-auth.md#Nope — no node matches');
    expect(anchorIssues[0]!.level).toBe('error');

    const fileIssues = issues.filter(i => i.rule === 'refs.broken.file');
    expect(fileIssues).toHaveLength(1);
    expect(fileIssues[0]!.message).toBe('broken ref: see 99-missing.md — file not found');
  });
});

// ── CLI end-to-end (blackbox) ──

describe('issue #49: cans check end-to-end', () => {
  test('g: repro workspace — refs.broken 0, no refs.anchor.no-target (keys resolve)', () => {
    const ws = makeWs('cli-repro', REPRO_FILES);
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);

    // The 3 exact refs from the issue all resolve — no broken refs, and the
    // downgrade warning must NOT fire (targets have addressable keys).
    expect(j.refs.total).toBe(3);
    expect(j.refs.broken).toBe(0);
    expect(j.issues.some((i: any) => i.rule === 'refs.broken.anchor')).toBe(false);
    expect(j.issues.some((i: any) => i.rule === 'refs.broken.file')).toBe(false);
    expect(j.issues.some((i: any) => i.rule === 'refs.anchor.no-target')).toBe(false);
  });

  test('c: prose .md#anchor → warning (exit 1), NOT counted in refs.broken', () => {
    const ws = makeWs('cli-prose', PROSE_FILES);
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);

    // A warning, not an error: refs.broken stays 0 and no error-class refs
    // finding exists (check.ts's broken counter counts refs.broken.file /
    // refs.broken.anchor only — the new rule is excluded by construction).
    expect(j.refs.broken).toBe(0);
    expect(r.exit).toBe(1); // warnings exit contract: 1
    const warn = j.issues.find((i: any) => i.rule === 'refs.anchor.no-target');
    expect(warn).toBeDefined();
    expect(warn.level).toBe('warning');
    expect(warn.message).toBe(
      'anchor on non-outline target: docs/notes.md#anything — target has no addressable nodes (bullets or YAML keys); use a file-level ref',
    );
    expect(j.issues.some((i: any) => i.rule === 'refs.broken.anchor')).toBe(false);
    expect(j.counts.errors).toBe(0);
  });

  test('b: yaml#nonexistent-key — CLI: refs.broken 1, truthful error, exit 2', () => {
    const ws = makeWs('cli-broken-key', {
      ...REPRO_FILES,
      '00-overview.md': '- Overview\n  - Governance: see artifacts/governance.yaml#nosuchkey\n  - Second child\n',
    });
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(2);
    expect(j.refs.broken).toBe(1);
    expect(j.issues.some((i: any) => i.rule === 'refs.broken.anchor')).toBe(true);
  });

  test('e: `cans check --fix` writes NOTHING into YAML targets, no stale warnings', () => {
    const before = REPRO_FILES['artifacts/governance.yaml']!;
    const ws = makeWs('cli-fix', {
      '00-overview.md': '- Overview\n  - Governance: see artifacts/governance.yaml#maintenance\n  - Second child\n',
      'artifacts/governance.yaml': before,
    });
    const r = runCli(['check', '--fix', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);

    // The anchored ref resolves now, but YAML targets are never loaded spec
    // files: rebuildBackPointers finds no target and earns no mark, so --fix
    // rewrites nothing — injecting <!-- ref-by --> into YAML would corrupt it.
    expect(j.refs.broken).toBe(0);
    expect(j.backPointersUpdated).toBe(0);
    expect(j.backPointersUpdatedFiles).toEqual([]);
    expect(j.issues.some((i: any) => i.rule === 'refs.backpointer.stale')).toBe(false);

    // Byte-for-byte: the YAML on disk is untouched.
    const after = readFileSync(join(ws.root, 'artifacts', 'governance.yaml'), 'utf8');
    expect(after).toBe(before);
  });

  test('h: control — .md#anchor CLI behavior unchanged (broken anchor still exit 2)', () => {
    const ws = makeWs('cli-control', {
      '00-overview.md': '- Overview\n  - Auth: see 02-auth.md#Sessions\n  - Miss: see 02-auth.md#Nope\n',
      '02-auth.md': '- Authentication\n  - Sessions\n    - Expire after 24h\n',
    });
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(2);
    expect(j.refs.broken).toBe(1);
    expect(j.issues.some((i: any) => i.rule === 'refs.broken.anchor')).toBe(true);
    expect(j.issues.some((i: any) => i.rule === 'refs.anchor.no-target')).toBe(false);
  });
});
