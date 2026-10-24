/**
 * Issue #58 contract tests — schematic anchors through the ref engine
 * (checkRefs + the CLI), covering the checker contract numbered in the issue:
 *
 *   1. A missing leaf path is a refs.broken.anchor ERROR in every supported
 *      format (JSON, YAML, TOML) — never the old warning-and-pass.
 *   2. An existing leaf path passes in every supported format.
 *   3. A flat single-segment anchor matching multiple leaves is ambiguous —
 *      an ERROR listing the full paths, suggesting the dot form.
 *   4. An intermediate object path is a valid address that passes, but is
 *      never presented as leaf proof (it resolves as `object`, no error).
 *   5. A malformed schematic file is a parse-error finding AT THE POINTER
 *      SITE — not a broken-anchor false positive, not a warning-and-pass.
 *   6. Backwards compatibility: unique flat YAML anchors keep resolving;
 *      name:// external targets get the SAME vocabulary through the SAME
 *      code path (no per-format special cases).
 *   7. Performance: only files actually pointed at with an anchor are
 *      parsed — file-level pointers to a malformed schematic stay clean.
 *
 * The mini-repro matrix (the issue's evidence table) runs for all three
 * formats against the SAME content: database {host, port}, cache {ttl},
 * server {port} — `port` deliberately exists under two parents.
 *
 * Test map:
 *   m1-m3   the mini-repro matrix × JSON/YAML/TOML (contracts 1-4)
 *   s1-s3   sequence items: items.0 and items[0] (incl. the #48 punctuation
 *           repair), composed matrix[0][1], TOML [[aot]] items
 *   e1      escaped keys (a\.b) resolve; the unescaped path misses with a
 *           suggestion that spells the ESCAPED form
 *   x1-x4   malformed JSON/YAML/TOML → refs.anchor.parse-error (contract 5);
 *           duplicate keys are a parse error (decided open question);
 *           multi-document YAML addresses the first document (decided);
 *           an unsupported construct (&anchor) is an explicit error
 *   b1-b3   backward compat: unique flat YAML key, §12 normalization across
 *           the key path, YAML block-sequence bullet anchors still resolve
 *   f1-f2   file-level pointers: still valid on any target, and they never
 *           trigger schematic parsing (contract 7)
 *   n1-n3   name:// external targets: the same matrix on external JSON and
 *           TOML targets — the shared path (contract 6)
 *   u1      unsupported format (.ini): the issue #49 advisory downgrade —
 *          explicit, never a silent pass, never a false broken-anchor
 *   c1-c4   CLI end-to-end --json: refs.broken counts the new errors, exit
 *           codes, the ambiguous suggestion, the parse-error message shape
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { rmSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

import { parseOutline } from '../../src/core/outline.ts';
import { buildRefGraph, checkRefs } from '../../src/core/refs.ts';
import type { OutlineNode } from '../../src/types.ts';
import { spawnCli, REPO } from '../runtime.ts';
import { makeCansWorkspace } from '../helpers.ts';

// ── The mini repro, three spellings of the same document ──

const MINI = {
  json: '{"database": {"host": "db.local", "port": 5432}, "cache": {"ttl": 30}, "server": {"port": 8080}}',
  yaml: 'database:\n  host: db.local\n  port: 5432\ncache:\n  ttl: 30\nserver:\n  port: 8080\n',
  toml: '[database]\nhost = "db.local"\nport = 5432\n\n[cache]\nttl = 30\n\n[server]\nport = 8080\n',
} as const;

function miniFile(fmt: keyof typeof MINI): string {
  return `artifacts/config.${fmt}`;
}

// ── Scaffolding (mirrors test/issues/issue-49.test.ts) ──

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-58');
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

// ── The mini-repro matrix (contracts 1-4), per format ──

describe('issue #58: checkRefs — the mini-repro matrix', () => {
  for (const fmt of ['json', 'yaml', 'toml'] as const) {
    test(`m1 (${fmt}): #database (object) and #database.host (leaf) PASS — no issue at all`, () => {
      const target = miniFile(fmt);
      const ws = makeWs(`matrix-${fmt}`, {
        '00-overview.md': `- Overview\n  - DB: see ${target}#database\n  - Host: see ${target}#database.host\n`,
        [target]: MINI[fmt],
      });
      const files = loadFiles({
        '00-overview.md': `- Overview\n  - DB: see ${target}#database\n  - Host: see ${target}#database.host\n`,
      });
      const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
      expect(issues).toEqual([]); // contract 2 + 4: leaf passes; object address passes, silently
    });

    test(`m2 (${fmt}): #port — ambiguous flat anchor → ERROR listing both full paths, dot form suggested`, () => {
      const target = miniFile(fmt);
      const ws = makeWs(`ambig-${fmt}`, {
        '00-overview.md': `- Overview\n  - Port: see ${target}#port\n`,
        [target]: MINI[fmt],
      });
      const files = loadFiles({ '00-overview.md': `- Overview\n  - Port: see ${target}#port\n` });
      const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
      expect(issues).toHaveLength(1);
      const issue = issues[0]!;
      expect(issue.level).toBe('error'); // contract 3: never a silent pass
      expect(issue.rule).toBe('refs.anchor.ambiguous');
      expect(issue.message).toBe(
        `ambiguous anchor: ${target}#port — flat name matches multiple leaves: database.port, server.port`,
      );
      expect(issue.suggestion).toBe('use the full path form: ' +
        `${target}#database.port or ${target}#server.port`);
    });

    test(`m3 (${fmt}): #NoSuchLeaf → refs.broken.anchor ERROR (contract 1)`, () => {
      const target = miniFile(fmt);
      const ws = makeWs(`missing-${fmt}`, {
        '00-overview.md': `- Overview\n  - Gone: see ${target}#NoSuchLeaf\n`,
        [target]: MINI[fmt],
      });
      const files = loadFiles({ '00-overview.md': `- Overview\n  - Gone: see ${target}#NoSuchLeaf\n` });
      const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
      const anchorIssues = issues.filter(i => i.rule === 'refs.broken.anchor');
      expect(anchorIssues).toHaveLength(1);
      expect(anchorIssues[0]!.level).toBe('error');
      expect(anchorIssues[0]!.message).toBe(`broken anchor: ${target}#NoSuchLeaf — no node matches`);
    });
  }

  test('m4: the SAME anchor resolves in the JSON, YAML and TOML spellings of one schema', () => {
    // One form across formats (the issue's portability requirement).
    const ws = makeWs('portable', {
      '00-overview.md': [
        '- Overview',
        '  - a: see artifacts/a.json#database.host',
        '  - b: see artifacts/a.yaml#database.host',
        '  - c: see artifacts/a.toml#database.host',
        '',
      ].join('\n'),
      'artifacts/a.json': MINI.json,
      'artifacts/a.yaml': MINI.yaml,
      'artifacts/a.toml': MINI.toml,
    });
    const spec = {
      '00-overview.md': [
        '- Overview',
        '  - a: see artifacts/a.json#database.host',
        '  - b: see artifacts/a.yaml#database.host',
        '  - c: see artifacts/a.toml#database.host',
        '',
      ].join('\n'),
    };
    const issues = checkRefs(loadFiles(spec), buildRefGraph(loadFiles(spec), ws.root), ws.root);
    expect(issues).toEqual([]);
  });
});

// ── Sequence items and escapes ──

describe('issue #58: checkRefs — sequence items, index forms, escaped keys', () => {
  test('s1: items.0 AND items[0] (bracket form survives the #48 punctuation strip), composed paths', () => {
    const yaml = 'items:\n  - name: a\n    tags: [x, y]\n  - name: b\nmatrix:\n  - [1, 2]\n  - [3, 4]\n';
    const spec = [
      '- Overview',
      '  - a: see artifacts/seq.yaml#items.0.name',
      '  - b: see artifacts/seq.yaml#items[1].name',
      '  - c: see artifacts/seq.yaml#matrix[0][1]',
      '  - d: (see artifacts/seq.yaml#items[0].tags[1])',
      '  - e: see artifacts/seq.yaml#items[0]',
      '  - f: see artifacts/seq.yaml#items[2]',
      '',
    ].join('\n');
    const ws = makeWs('seq', { '00-overview.md': spec, 'artifacts/seq.yaml': yaml });
    const issues = checkRefs(loadFiles({ '00-overview.md': spec }), buildRefGraph(loadFiles({ '00-overview.md': spec }), ws.root), ws.root);
    // a-e resolve (items[0] is an object ADDRESS — valid, passes); only the
    // out-of-range index errors.
    const anchorIssues = issues.filter(i => i.rule === 'refs.broken.anchor');
    expect(anchorIssues).toHaveLength(1);
    expect(anchorIssues[0]!.message).toBe('broken anchor: artifacts/seq.yaml#items[2] — no node matches');
    expect(issues.filter(i => i.rule === 'refs.anchor.ambiguous')).toHaveLength(0);
  });

  test('s2: JSON arrays and TOML [[arrays-of-tables]] address by the same index forms', () => {
    const json = '{"users": [{"name": "ann"}, {"name": "ben"}]}';
    const toml = '[[users]]\nname = "ann"\n[[users]]\nname = "ben"\n';
    const spec = [
      '- Overview',
      '  - a: see artifacts/u.json#users[0].name',
      '  - b: see artifacts/u.json#users.1.name',
      '  - c: see artifacts/u.toml#users[0].name',
      '  - d: see artifacts/u.toml#users.1.name',
      '',
    ].join('\n');
    const ws = makeWs('idx', {
      '00-overview.md': spec, 'artifacts/u.json': json, 'artifacts/u.toml': toml,
    });
    const files = loadFiles({ '00-overview.md': spec });
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
    expect(issues).toEqual([]);
  });

  test('s3: ambiguous flat name inside sequences lists the indexed paths', () => {
    const yaml = 'items:\n  - name: a\n  - name: b\n';
    const spec = '- Overview\n  - x: see artifacts/dup.yaml#name\n';
    const ws = makeWs('seq-ambig', { '00-overview.md': spec, 'artifacts/dup.yaml': yaml });
    const files = loadFiles({ '00-overview.md': spec });
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.rule).toBe('refs.anchor.ambiguous');
    expect(issues[0]!.message).toBe(
      'ambiguous anchor: artifacts/dup.yaml#name — flat name matches multiple leaves: items.0.name, items.1.name',
    );
    expect(issues[0]!.suggestion).toBe('use the full path form: artifacts/dup.yaml#items.0.name or artifacts/dup.yaml#items.1.name');
  });

  test('e1: a key containing a dot resolves only in escaped form; the miss suggests the escape', () => {
    const yaml = '"a.b": 1\nc: 2\n';
    const spec = [
      '- Overview',
      '  - hit: see artifacts/esc.yaml#a\\.b',
      '  - miss: see artifacts/esc.yaml#a.b',
      '',
    ].join('\n');
    const ws = makeWs('esc', { '00-overview.md': spec, 'artifacts/esc.yaml': yaml });
    const files = loadFiles({ '00-overview.md': spec });
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
    const anchorIssues = issues.filter(i => i.rule === 'refs.broken.anchor');
    expect(anchorIssues).toHaveLength(1);
    expect(anchorIssues[0]!.message).toBe('broken anchor: artifacts/esc.yaml#a.b — no node matches');
    // The suggestion spells the ESCAPED form — the only anchor that resolves.
    expect(anchorIssues[0]!.suggestion).toBe('did you mean artifacts/esc.yaml#a\\.b? — fix the ref anchor');
  });
});

// ── Malformed and beyond-subset schematics (contract 5 + the decided open questions) ──

describe('issue #58: checkRefs — parse errors at the pointer site', () => {
  test('x1: malformed JSON / YAML / TOML → refs.anchor.parse-error, not a broken-anchor false positive', () => {
    const cases: Array<[string, string, string]> = [
      ['json', '{"database": ', 'expecting'],
      ['yaml', 'database:\n  host: [unterminated\n', 'unterminated'],
      ['toml', '[database\nhost = 1\n', 'unterminated table header'],
    ];
    for (const [fmt, broken, msgPart] of cases) {
      const target = `artifacts/broken.${fmt}`;
      const spec = `- Overview\n  - x: see ${target}#database\n`;
      const ws = makeWs(`broken-${fmt}`, { '00-overview.md': spec, [target]: broken });
      const files = loadFiles({ '00-overview.md': spec });
      const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
      expect(issues).toHaveLength(1);
      const issue = issues[0]!;
      expect(issue.level).toBe('error'); // contract 5: never warning-and-pass
      expect(issue.rule).toBe('refs.anchor.parse-error');
      expect(issue.message).toContain(`schematic parse error: ${target}#database — `);
      expect(issue.message).toMatch(new RegExp(`(JSON|YAML|TOML) line \\d+: `));
      expect(issue.message).toContain(msgPart);
      expect(issue.message).not.toContain('no node matches'); // not a broken-anchor shape
      void msgPart;
    }
  });

  test('x2: duplicate keys are a parse error (decided: ambiguous documents are rejected)', () => {
    const spec = '- Overview\n  - x: see artifacts/dup.yaml#a\n';
    const ws = makeWs('dup-keys', { '00-overview.md': spec, 'artifacts/dup.yaml': 'a: 1\na: 2\n' });
    const files = loadFiles({ '00-overview.md': spec });
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.rule).toBe('refs.anchor.parse-error');
    expect(issues[0]!.message).toContain("duplicate key 'a'");
  });

  test('x3: multi-document YAML — v1 addresses the FIRST document (a later --- ends it)', () => {
    const yaml = 'first: 1\n---\nsecond: 2\n';
    const spec = [
      '- Overview',
      '  - a: see artifacts/md.yaml#first',
      '  - b: see artifacts/md.yaml#second',
      '',
    ].join('\n');
    const ws = makeWs('multidoc', { '00-overview.md': spec, 'artifacts/md.yaml': yaml });
    const files = loadFiles({ '00-overview.md': spec });
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
    const anchorIssues = issues.filter(i => i.rule === 'refs.broken.anchor');
    expect(anchorIssues).toHaveLength(1); // #second lives in the SECOND document — out of v1 scope
    expect(anchorIssues[0]!.message).toBe('broken anchor: artifacts/md.yaml#second — no node matches');
    expect(anchorIssues[0]!.suggestion).toBe('no near match in artifacts/md.yaml — add the "second" key there, or fix the anchor path');
  });

  test('x4: a beyond-subset construct is an EXPLICIT unsupported error, never a silent pass', () => {
    const spec = '- Overview\n  - x: see artifacts/anc.yaml#a\n';
    const ws = makeWs('anchor-syntax', { '00-overview.md': spec, 'artifacts/anc.yaml': 'a: &val 1\n' });
    const files = loadFiles({ '00-overview.md': spec });
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.rule).toBe('refs.anchor.parse-error');
    expect(issues[0]!.level).toBe('error');
    expect(issues[0]!.message).toContain('outside the supported subset');
  });
});

// ── Backwards compatibility (contract 6) ──

describe('issue #58: checkRefs — backwards compatibility', () => {
  test('b1: a UNIQUE flat YAML anchor at depth keeps resolving (the issue #49 behavior)', () => {
    const yaml = 'governance:\n  maintenance:\n    window: weekly\n';
    const spec = '- Overview\n  - g: see artifacts/governance.yaml#maintenance\n';
    const ws = makeWs('flat-unique', { '00-overview.md': spec, 'artifacts/governance.yaml': yaml });
    const files = loadFiles({ '00-overview.md': spec });
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
    expect(issues).toEqual([]);
  });

  test('b2: §12 normalization across the schematic path (#Data-protection ↔ `data protection:`)', () => {
    const yaml = "policy:\n  'data protection': strict\n";
    const spec = '- Overview\n  - p: see artifacts/policy.yaml#Data-protection\n';
    const ws = makeWs('norm', { '00-overview.md': spec, 'artifacts/policy.yaml': yaml });
    const files = loadFiles({ '00-overview.md': spec });
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
    expect(issues).toEqual([]);
  });

  test('b3: YAML block sequences still mint bullet nodes (#canary on `- canary`), values still miss', () => {
    const yaml = 'rollout:\n  window: nightly\n  steps:\n    - canary\n    - full ship\n';
    const spec = [
      '- Overview',
      '  - w: see artifacts/rollout.yaml#window',
      '  - c: see artifacts/rollout.yaml#canary',
      '  - f: see artifacts/rollout.yaml#full-ship',
      '  - n: see artifacts/rollout.yaml#nightly',
      '',
    ].join('\n');
    const ws = makeWs('bullets', { '00-overview.md': spec, 'artifacts/rollout.yaml': yaml });
    const files = loadFiles({ '00-overview.md': spec });
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
    const anchorIssues = issues.filter(i => i.rule === 'refs.broken.anchor');
    expect(anchorIssues).toHaveLength(1); // only #nightly (a VALUE) misses
    expect(anchorIssues[0]!.message).toBe('broken anchor: artifacts/rollout.yaml#nightly — no node matches');
  });

  test('b4: path-form near-miss suggests the PATH (never a slug that would not resolve)', () => {
    const yaml = 'policy:\n  maintenance window:\n    timeout: 30s\n';
    const spec = '- Overview\n  - p: see artifacts/policy.yaml#maintenance-windo\n';
    const ws = makeWs('path-suggest', { '00-overview.md': spec, 'artifacts/policy.yaml': yaml });
    const files = loadFiles({ '00-overview.md': spec });
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
    const anchorIssues = issues.filter(i => i.rule === 'refs.broken.anchor');
    expect(anchorIssues).toHaveLength(1);
    // Flat `maintenance-window` resolves uniquely (§12) → proposed as-is.
    expect(anchorIssues[0]!.suggestion).toBe('did you mean artifacts/policy.yaml#maintenance-window? — fix the ref anchor');
    // …and for a dotted near-miss the PATH form is proposed, dots intact:
    const spec2 = '- Overview\n  - p: see artifacts/policy2.yaml#maintenance.window.timeou\n';
    const ws2 = makeWs('path-suggest2', { '00-overview.md': spec2, 'artifacts/policy2.yaml': 'maintenance:\n  window:\n    timeout: 30s\n' });
    const issues2 = checkRefs(loadFiles({ '00-overview.md': spec2 }), buildRefGraph(loadFiles({ '00-overview.md': spec2 }), ws2.root), ws2.root);
    const a2 = issues2.filter(i => i.rule === 'refs.broken.anchor');
    expect(a2).toHaveLength(1);
    expect(a2[0]!.suggestion).toBe('did you mean artifacts/policy2.yaml#maintenance.window.timeout? — fix the ref anchor');
  });
});

// ── File-level pointers + laziness (contract 7) ──

describe('issue #58: checkRefs — file-level pointers and parse laziness', () => {
  test('f1: a file-level pointer (no #) stays valid on ANY target — including malformed schematics', () => {
    const spec = '- Overview\n  - cfg: see artifacts/broken.json\n';
    const ws = makeWs('file-level', { '00-overview.md': spec, 'artifacts/broken.json': '{"database": ' });
    const files = loadFiles({ '00-overview.md': spec });
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
    expect(issues).toEqual([]);
  });

  test('f2: laziness — a malformed schematic is parsed ONLY when a pointer anchors into it', () => {
    // Same workspace, two runs: the file-level ref is clean (f1); the
    // anchored one parses and reports. A sibling UNREFERENCED broken file
    // never produces a finding either — no corpus-wide schematic parsing.
    const spec = [
      '- Overview',
      '  - clean: see artifacts/broken.json',
      '  - also: see artifacts/never-touched.toml',
      '',
    ].join('\n');
    const ws = makeWs('lazy', {
      '00-overview.md': spec,
      'artifacts/broken.json': '{"database": ',
      'artifacts/never-touched.toml': '[broken',
    });
    const files = loadFiles({ '00-overview.md': spec });
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
    expect(issues).toEqual([]);
    // …and the moment a pointer anchors into broken.json, it is parsed:
    const spec2 = '- Overview\n  - x: see artifacts/broken.json#database\n';
    const files2 = loadFiles({ '00-overview.md': spec2 });
    const issues2 = checkRefs(files2, buildRefGraph(files2, ws.root), ws.root);
    expect(issues2).toHaveLength(1);
    expect(issues2[0]!.rule).toBe('refs.anchor.parse-error');
  });
});

// ── Unsupported formats stay explicit (issue #49 behavior, unchanged) ──

describe('issue #58: checkRefs — formats outside v1', () => {
  test('u1: an .ini target with an anchor → the issue #49 advisory downgrade (explicit, never silent)', () => {
    const spec = '- Overview\n  - x: see artifacts/app.ini#port\n';
    const ws = makeWs('ini', {
      '00-overview.md': spec,
      'artifacts/app.ini': '[database]\nhost = db.local\n',
    });
    const files = loadFiles({ '00-overview.md': spec });
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
    const downgraded = issues.filter(i => i.rule === 'refs.anchor.no-target');
    expect(downgraded).toHaveLength(1);
    expect(downgraded[0]!.level).toBe('warning');
    expect(issues.filter(i => i.rule === 'refs.broken.anchor')).toHaveLength(0);
    expect(issues.filter(i => i.rule === 'refs.anchor.parse-error')).toHaveLength(0);
  });
});

// ── name:// external targets — the shared path (contract 6) ──

describe('issue #58: checkRefs — external name:// targets share the vocabulary', () => {
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

  test('n1: the mini-repro matrix over a name:// JSON target — same verdicts as on disk', () => {
    const spec = [
      '- Lifecycle',
      '  - obj: see: kelir://artifacts/config.json#database',
      '  - leaf: see: kelir://artifacts/config.json#database.host',
      '  - ambig: see: kelir://artifacts/config.json#port',
      '  - miss: see: kelir://artifacts/config.json#NoSuchLeaf',
      '',
    ].join('\n');
    const ws = makeExtWs('matrix', spec, { 'artifacts/config.json': MINI.json });
    const r = runCli(['check', '--json'], ws.projectRoot);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.refs).toEqual({ total: 4, broken: 2, deepHops: 0 });
    const ambiguous = j.issues.find((i: any) => i.rule === 'refs.anchor.ambiguous');
    expect(ambiguous.detail).toBe(
      'ambiguous anchor: kelir://artifacts/config.json#port — flat name matches multiple leaves: database.port, server.port',
    );
    expect(ambiguous.suggestion).toBe(
      'use the full path form: kelir://artifacts/config.json#database.port or kelir://artifacts/config.json#server.port',
    );
    const broken = j.issues.find((i: any) => i.rule === 'refs.broken.anchor');
    expect(broken.detail).toBe('broken anchor: kelir://artifacts/config.json#NoSuchLeaf — no node matches');
  });

  test('n2: a name:// TOML target addresses [[array-of-tables]] items by index', () => {
    const spec = [
      '- Lifecycle',
      '  - a: see: kelir://artifacts/users.toml#users[0].name',
      '  - b: see: kelir://artifacts/users.toml#users.1.name',
      '  - c: see: kelir://artifacts/users.toml#users[2].name',
      '',
    ].join('\n');
    const ws = makeExtWs('toml-idx', spec, {
      'artifacts/users.toml': '[[users]]\nname = "ann"\n[[users]]\nname = "ben"\n',
    });
    const r = runCli(['check', '--json'], ws.projectRoot);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.refs).toEqual({ total: 3, broken: 1, deepHops: 0 });
    const broken = j.issues.find((i: any) => i.rule === 'refs.broken.anchor');
    expect(broken.detail).toBe('broken anchor: kelir://artifacts/users.toml#users[2].name — no node matches');
  });

  test('n3: a malformed name:// schematic → the same parse-error at the pointer site', () => {
    const spec = '- Lifecycle\n  - x: see: kelir://artifacts/broken.yaml#database\n';
    const ws = makeExtWs('broken', spec, { 'artifacts/broken.yaml': 'database:\n  host: [oops\n' });
    const r = runCli(['check', '--json'], ws.projectRoot);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.refs.broken).toBe(1); // the parse-error counts in the truthful counter
    const parseErr = j.issues.find((i: any) => i.rule === 'refs.anchor.parse-error');
    expect(parseErr.detail).toContain('schematic parse error: kelir://artifacts/broken.yaml#database — YAML line 2');
  });
});

// ── CLI end-to-end ──

describe('issue #58: cans check end-to-end', () => {
  test('c1: the mini repro — ambiguous + missing leaves fail the run (exit 2), leaves and objects pass', () => {
    const spec = [
      '- Overview',
      '  - DB: see artifacts/config.yaml#database',
      '  - Host: see artifacts/config.yaml#database.host',
      '  - Port: see artifacts/config.yaml#port',
      '  - Gone: see artifacts/config.yaml#NoSuchLeaf',
      '',
    ].join('\n');
    const ws = makeWs('cli-matrix', { '00-overview.md': spec, 'artifacts/config.yaml': MINI.yaml });
    const r = runCli(['check', '--json'], ws.tmp);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.counts.errors).toBe(2);
    expect(j.refs).toEqual({ total: 4, broken: 2, deepHops: 0 }); // ambiguous + parse-error family count
    const rules = j.issues.map((i: any) => i.rule);
    expect(rules).toContain('refs.anchor.ambiguous');
    expect(rules).toContain('refs.broken.anchor');
    expect(rules).not.toContain('refs.anchor.no-target'); // nothing warning-and-passes
  });

  test('c2: malformed schematic — parse error, exit 2, message names the file, format, line and cause', () => {
    const spec = '- Overview\n  - x: see artifacts/bad.json#database\n';
    const ws = makeWs('cli-broken', { '00-overview.md': spec, 'artifacts/bad.json': '{"database": ' });
    const r = runCli(['check', '--json'], ws.tmp);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.refs.broken).toBe(1);
    const err = j.issues.find((i: any) => i.rule === 'refs.anchor.parse-error');
    expect(err).toBeDefined();
    expect(err.detail).toContain('schematic parse error: artifacts/bad.json#database — JSON line 1');
    expect(err.suggestion).toContain('drop the #database anchor');
  });

  test('c3: human output groups the new rules under REFS with their suggestions', () => {
    const spec = [
      '- Overview',
      '  - Port: see artifacts/config.yaml#port',
      '  - Gone: see artifacts/config.yaml#NoSuchLeaf',
      '',
    ].join('\n');
    const ws = makeWs('cli-human', { '00-overview.md': spec, 'artifacts/config.yaml': MINI.yaml });
    const r = runCli(['check'], ws.tmp);
    expect(r.exit).toBe(2);
    expect(r.out).toContain('ambiguous anchor');
    expect(r.out).toContain('use the full path form: artifacts/config.yaml#database.port or artifacts/config.yaml#server.port');
    expect(r.out).toContain('broken anchor');
    expect(r.out).toContain('artifacts/config.yaml#NoSuchLeaf');
  });

  test('c4: a clean anchored schematic run exits 0 with zero refs issues', () => {
    const spec = [
      '- Overview',
      '  - a: see artifacts/config.json#database.host',
      '  - b: see artifacts/config.toml#cache.ttl',
      '  - c: see artifacts/config.yaml#server',
      '',
    ].join('\n');
    const ws = makeWs('cli-clean', {
      '00-overview.md': spec,
      'artifacts/config.json': MINI.json,
      'artifacts/config.toml': MINI.toml,
      'artifacts/config.yaml': MINI.yaml,
    });
    const r = runCli(['check', '--json'], ws.tmp);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect(j.refs).toEqual({ total: 3, broken: 0, deepHops: 0 });
  });
});
