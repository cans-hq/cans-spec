/**
 * Issue #1 regression tests — `cans check` never enforced structure.siblings.min
 * or structure.depth.min.
 *
 * _rules.yaml accepted both minima and the rules banner printed the ranges with
 * a green check, but only the .max side of `siblings` and `depth` was ever
 * checked — while node_length.min WAS enforced (src/core/structure.ts), making
 * the behavior inconsistent even within the same check function.
 *
 * Maintainer decision (issue option 1): enforce both minima as warnings —
 *   - a parent with 0 < children < siblings.min is a violation;
 *   - a file whose max node depth (depth = indent + 1) is < depth.min is a
 *     violation, reported once per file.
 * Defaults (siblings.min: 1, depth.min: 1) can never fire: `0 < count < 1` is
 * impossible and any non-empty file has max depth ≥ 1 — so every frozen fixture
 * stays green. The final test pins that regression guarantee at the CLI level.
 *
 * Test map:
 *   a ........ direct unit: siblings {min:3,max:12} on the issue's demo tree
 *              → 3 warnings (children counts 2/1/2), 0 errors, each "min 3".
 *   b ........ direct unit: depth {min:5,max:7} → 1 warning for max depth 3 < 5;
 *              a depth-5 tree produces no depth-min warning.
 *   c ........ direct unit: §18 delete-key semantics — siblings.min deleted
 *              (null) → no min warning; depth.min deleted (null) → no warning.
 *   d ........ CLI end-to-end: temp workspace with the issue's demo.md +
 *              _rules.yaml, `check --json` → warningCount ≥ 4
 *              (3 siblings-min + 1 depth-min), errorCount 0, exit 0.
 *   e ........ regression: default rules (no _rules.yaml) → no siblings/depth
 *              min warnings on a healthy workspace.
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

import { parseOutline } from '../../src/core/outline.ts';
import { checkStructure } from '../../src/core/structure.ts';
import { defaultRules } from '../../src/core/rules.ts';
import type { StructureRules } from '../../src/types.ts';
import { spawnCli, REPO } from '../runtime.ts';

/** The issue's demo tree, verbatim: children counts are 2 (root) / 1 / 2 and the
 *  max depth is 3 — every branch violates siblings.min: 3, the file violates
 *  depth.min: 5. */
const DEMO_MD = [
  '- Demo root',
  '  - Branch one',
  '    - Only child of branch one',
  '  - Branch two',
  '    - First child of branch two',
  '    - Second child of branch two',
  '',
].join('\n');

/** A chain exactly 5 levels deep — satisfies depth {min:5,max:7} and, with
 *  sibling/min:1, triggers nothing else (all node texts ≥ 3 chars). */
const DEEP5_MD = [
  '- Level one root',
  '  - Level two branch',
  '    - Level three node',
  '      - Level four node',
  '        - Level five leaf',
  '',
].join('\n');

/** The issue's _rules.yaml: both minima raised, advisories off. */
const ISSUE_RULES = [
  'structure:',
  '  node_length: { min: 3, max: 120 }',
  '  siblings: { min: 3, max: 12 }',
  '  depth: { min: 5, max: 7 }',
  '  single_child_collapse: false',
  '  empty_nodes: false',
  '',
].join('\n');

/** The issue's rules as a direct StructureRules object (for unit-level tests). */
function issueRules(): StructureRules {
  return {
    ...defaultRules().structure,
    siblings: { min: 3, max: 12 },
    depth: { min: 5, max: 7 },
    single_child_collapse: false,
    empty_nodes: false,
  };
}

// ── CLI-level scaffolding (mirrors test/qa-round2/rules-config.test.ts) ──

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-1');

interface Ws {
  root: string;
  cans: string;
}

const createdDirs: string[] = [];
let wsSeq = 0;

/** Fresh scratch workspace under repo/.tmp/issues/issue-1 (gitignored). */
function makeWs(name: string): Ws {
  const root = join(SCRATCH, `${name}-${++wsSeq}`);
  mkdirSync(join(root, 'cans'), { recursive: true });
  createdDirs.push(root);
  return { root, cans: join(root, 'cans') };
}

/** Blackbox CLI spawn, isolated from any ambient CANS_ROOT. */
function runCli(args: string[], cwd: string) {
  return spawnCli(args, cwd, { ...process.env, CANS_ROOT: '' });
}

/** JSON-mode output must be a single JSON document; a parse failure is itself
 *  an assertion failure. */
function parseJsonOut(out: string): any {
  let parsed: unknown = null;
  let parseError: unknown = null;
  try {
    parsed = JSON.parse(out);
  } catch (e) {
    parseError = e;
  }
  expect(parseError).toBeNull();
  // issue #41: reconstitute the flat issues view from sections.{category}[]
  // (wire shape moved from a flat issues array to sections buckets).
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
    const dir = createdDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('issue #1: structure.siblings.min and structure.depth.min are enforced', () => {
  test('a (direct unit): siblings {min:3,max:12} on the demo tree → 3 warnings (counts 2/1/2), no errors, each says "min 3"', () => {
    const nodes = parseOutline(DEMO_MD, 'demo.md');
    const issues = checkStructure(nodes, 'demo.md', issueRules());

    const minIssues = issues.filter(i => i.message.includes('(min 3)'));
    expect(minIssues.length).toBe(3);
    for (const i of minIssues) {
      expect(i.level).toBe('warning');
      expect(i.category).toBe('structure');
      expect(i.file).toBe('demo.md');
    }
    // Root (2 children) and both branches (1 and 2 children) — exact message
    // wording follows the max-side convention `"...text..." has N children (min M).`
    expect(minIssues.map(i => i.message).sort()).toEqual([
      '"Branch one" has 1 children (min 3).',
      '"Branch two" has 2 children (min 3).',
      '"Demo root" has 2 children (min 3).',
    ]);
    expect(issues.filter(i => i.level === 'error').length).toBe(0);
  });

  test('b (direct unit): depth {min:5,max:7} → exactly 1 warning for max depth 3 < 5, attached to line 1; a depth-5 tree gets no warning', () => {
    // Max depth 3 < min 5 → one file-level warning.
    const shallowNodes = parseOutline(DEMO_MD, 'demo.md');
    const shallowIssues = checkStructure(shallowNodes, 'demo.md', issueRules());
    const depthMin = shallowIssues.filter(i => i.message.includes('below min 5'));
    expect(depthMin.length).toBe(1);
    expect(depthMin[0]!.level).toBe('warning');
    expect(depthMin[0]!.category).toBe('structure');
    expect(depthMin[0]!.file).toBe('demo.md');
    expect(depthMin[0]!.line).toBe(1); // first root node's line
    expect(depthMin[0]!.message).toBe('Max depth 3 is below min 5. Deepen the outline.');
    // The demo tree's other violation is siblings.min — beyond it, nothing else fires.
    expect(shallowIssues.length).toBe(1 + 3);

    // Max depth exactly 5 → satisfies min 5 → no depth-min warning at all.
    // siblings {min:1} — the chain's single-child parents would otherwise trip
    // siblings.min (a separate check); this case isolates the depth minimum.
    const deepNodes = parseOutline(DEEP5_MD, 'deep.md');
    const deepIssues = checkStructure(deepNodes, 'deep.md', {
      ...issueRules(),
      siblings: { min: 1, max: 12 },
    });
    expect(deepIssues.length).toBe(0);
  });

  test('c (direct unit, §18 delete-key semantics): siblings.min null → no min warning; depth.min null → no min warning', () => {
    const nodes = parseOutline(DEMO_MD, 'demo.md');

    // siblings.min deleted → no siblings-min warning (depth-min still fires).
    const noSibMin: StructureRules = {
      ...issueRules(),
      siblings: { min: null, max: 12 },
    };
    const sibIssues = checkStructure(nodes, 'demo.md', noSibMin);
    expect(sibIssues.filter(i => i.message.includes('children (min')).length).toBe(0);
    expect(sibIssues.filter(i => i.message.includes('below min 5')).length).toBe(1);

    // depth.min deleted → no depth-min warning (siblings-min still fires ×3).
    const noDepthMin: StructureRules = {
      ...issueRules(),
      depth: { min: null, max: 7 },
    };
    const depthIssues = checkStructure(nodes, 'demo.md', noDepthMin);
    expect(depthIssues.filter(i => i.message.includes('below min')).length).toBe(0);
    expect(depthIssues.filter(i => i.message.includes('(min 3)')).length).toBe(3);
  });

  test('d (CLI end-to-end): issue repro workspace → check --json reports warningCount ≥ 4 (3 siblings-min + 1 depth-min), errorCount 0, exit 0', () => {
    const ws = makeWs('cli-repro');
    writeFileSync(join(ws.cans, 'demo.md'), DEMO_MD, 'utf8');
    writeFileSync(join(ws.cans, '_rules.yaml'), ISSUE_RULES, 'utf8');

    const r = runCli(['check', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    // issue #41: warnings-only → exit 1 (§19 superseded by the issue's
    // three-class exit contract: 0 clean / 1 warnings / 2 errors).
    expect(r.exit).toBe(1);
    expect(j.exitCode).toBe(1);
    expect(j.counts.errors).toBe(0);
    expect(j.counts.warnings).toBeGreaterThanOrEqual(4);
    // The exact breakdown: 3 siblings-min warnings + 1 depth-min warning.
    const sibMin = j.issues.filter((i: any) => i.message.includes('(min 3)'));
    expect(sibMin.length).toBe(3);
    const depthMin = j.issues.filter((i: any) => i.message.includes('below min 5'));
    expect(depthMin.length).toBe(1);
    expect(depthMin[0]!.file).toBe('demo.md');
  });

  test('e (regression): default rules (no _rules.yaml) on a healthy workspace → zero siblings/depth min warnings', () => {
    const ws = makeWs('default-regression');
    // Healthy tree (3 children per root, depth 2) — with the default
    // siblings.min: 1 / depth.min: 1 the new checks can never fire. Named
    // 00-overview.md so the default orphan check does not add noise either.
    writeFileSync(
      join(ws.cans, '00-overview.md'),
      '- Auth\n  - Sign up\n  - Sessions\n  - Passwords\n- Billing\n  - Invoices\n  - Payments\n',
      'utf8',
    );

    const r = runCli(['check', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(0); // healthy workspace: no findings at all → 0
    expect(j.counts.errors).toBe(0);
    const minWarnings = j.issues.filter(
      (i: any) => i.message.includes('children (min') || i.message.includes('below min'),
    );
    expect(minWarnings).toEqual([]);
  });
});
