/**
 * Issue #51 regression tests — single-child nodes are double-counted in the
 * structure total.
 *
 * Reported bug (GitHub issue #51): a node with exactly 1 child emitted TWO
 * warnings for the SAME node — `structure.siblings.min` (`"X" has 1 children
 * (min 4).`) AND `structure.single_child` (`"X" has exactly 1 child.
 * Collapse.`). The reporter's remediation run (15 files, 5847 nodes) showed
 * 192 structure issues of which 12 were 6 nodes counted twice — the section
 * header total (`errorCount + warningCount`, printed as `STRUCTURE  ⚠ N`)
 * was inflated vs. the number of distinct offending nodes.
 *
 * Fix under test: when count === 1 AND single_child_collapse is enabled, the
 * collapse advisory SUBSUMES the min-fan-out warning — siblings.min must not
 * fire (one node, one actionable warning; "collapse" is the strictly more
 * actionable remediation). When the advisory is OFF (§18 config — explicit
 * `single_child_collapse: false`, or the key deleted from a listed structure
 * section), siblings.min remains the only signal for that node and STILL
 * fires. Defaults (`siblings: { min: 1 }`) can never trip the min check
 * (`1 < 1` is false), so default-rule workspaces are unaffected — pinned by
 * test e (and by the file-level comment in src/core/structure.ts).
 *
 * Test map:
 *   a ........ unit repro: siblings min 4 + collapse ON + node with exactly
 *              1 child → exactly ONE issue, structure.single_child (no
 *              structure.siblings.min)
 *   b ........ unit: collapse OFF + min 2 + 1 child → structure.siblings.min
 *              fires (advisory off → the min check is the only signal)
 *   c ........ unit: min 4 + 2 or 3 children (collapse ON) → siblings.min
 *              only — counts ≠ 1 are untouched by the subsumption
 *   d ........ unit: min 4 + 5 children + max 7 → clean
 *   e ........ unit regression: DEFAULT rules + 1 child → single_child only
 *              (existing behavior; siblings.min 1 can never fire)
 *   f ........ unit: max side untouched — min 2, max 3, 5 children →
 *              structure.siblings.max fires, no min, no single_child
 *   g ........ unit: §18 delete-key — siblings.min null + 1 child + collapse
 *              ON → single_child only
 *   h ........ CLI end-to-end: 6 single-child parents + _rules.yaml
 *              (siblings min 4, collapse ON) → `STRUCTURE  ⚠ 6` header,
 *              exactly 6 structure.single_child findings on 6 distinct
 *              lines, 0 siblings.min — the issue's "192 total / 12
 *              double-counted" shape reduced to distinct findings
 */
import { describe, test, expect } from '../testing.ts';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';

import { parseOutline } from '../../src/core/outline.ts';
import { checkStructure } from '../../src/core/structure.ts';
import { defaultRules } from '../../src/core/rules.ts';
import type { StructureRules } from '../../src/types.ts';
import { spawnCli, REPO } from '../runtime.ts';
import { makeCansWorkspace } from '../helpers.ts';

// ── unit layer ──────────────────────────────────────────────────────────

/** Default §18 structure rules with targeted overrides (siblings range,
 *  single_child_collapse switch). */
function rulesWith(overrides: Partial<StructureRules>): StructureRules {
  return { ...defaultRules().structure, ...overrides };
}

/** The issue's minimal repro shape: one parent with exactly 1 child. */
const ONE_CHILD_MD = '- Alpha parent\n  - Only child node\n';

describe('issue #51: single_child subsumes siblings.min at count === 1', () => {
  test('a (unit repro): min 4 + collapse ON + 1 child → exactly ONE issue, structure.single_child', () => {
    const nodes = parseOutline(ONE_CHILD_MD, 'test.md');
    const issues = checkStructure(nodes, 'test.md', rulesWith({ siblings: { min: 4, max: 12 } }));
    // Pre-fix: 2 issues for the SAME node — siblings.min + single_child.
    expect(issues.length).toBe(1);
    expect(issues[0]!.rule).toBe('structure.single_child');
    expect(issues[0]!.level).toBe('warning');
    expect(issues[0]!.message).toBe('"Alpha parent" has exactly 1 child. Collapse.');
    expect(issues.some(i => i.rule === 'structure.siblings.min')).toBe(false);
  });

  test('b (unit): collapse OFF + min 2 + 1 child → siblings.min fires (no single_child)', () => {
    const nodes = parseOutline(ONE_CHILD_MD, 'test.md');
    const issues = checkStructure(
      nodes,
      'test.md',
      rulesWith({ siblings: { min: 2, max: 12 }, single_child_collapse: false }),
    );
    // With the advisory off, the min check is the node's only signal.
    const minIssues = issues.filter(i => i.rule === 'structure.siblings.min');
    expect(minIssues.length).toBe(1);
    expect(minIssues[0]!.message).toBe('"Alpha parent" has 1 children (min 2).');
    expect(issues.some(i => i.rule === 'structure.single_child')).toBe(false);
    expect(issues.length).toBe(1);
  });

  test('c (unit): min 4 + 2 or 3 children (collapse ON) → siblings.min only, unchanged', () => {
    const two = parseOutline('- Alpha parent\n  - First child node\n  - Second child node\n', 'test.md');
    const twoIssues = checkStructure(two, 'test.md', rulesWith({ siblings: { min: 4, max: 12 } }));
    expect(twoIssues.length).toBe(1);
    expect(twoIssues[0]!.rule).toBe('structure.siblings.min');
    expect(twoIssues[0]!.message).toBe('"Alpha parent" has 2 children (min 4).');
    expect(twoIssues.some(i => i.rule === 'structure.single_child')).toBe(false);

    const three = parseOutline(
      '- Alpha parent\n  - First child node\n  - Second child node\n  - Third child node\n',
      'test.md',
    );
    const threeIssues = checkStructure(three, 'test.md', rulesWith({ siblings: { min: 4, max: 12 } }));
    expect(threeIssues.length).toBe(1);
    expect(threeIssues[0]!.rule).toBe('structure.siblings.min');
    expect(threeIssues[0]!.message).toBe('"Alpha parent" has 3 children (min 4).');
  });

  test('d (unit): min 4 + 5 children + max 7 → clean', () => {
    const src = ['- Alpha parent', ...Array.from({ length: 5 }, (_, i) => `  - Worker child number ${i + 1}`), ''].join('\n');
    const nodes = parseOutline(src, 'test.md');
    const issues = checkStructure(nodes, 'test.md', rulesWith({ siblings: { min: 4, max: 7 } }));
    expect(issues).toEqual([]);
  });

  test('e (unit regression): DEFAULT rules + 1 child → single_child only (existing behavior)', () => {
    const nodes = parseOutline(ONE_CHILD_MD, 'test.md');
    const issues = checkStructure(nodes, 'test.md', defaultRules().structure);
    // Default siblings.min: 1 — `1 < 1` is false, so the min check can never
    // fire for a 1-child node; only the advisory reports it (as before #51).
    expect(issues.length).toBe(1);
    expect(issues[0]!.rule).toBe('structure.single_child');
  });

  test('f (unit): max side untouched — min 2, max 3, 5 children → structure.siblings.max', () => {
    const src = ['- Alpha parent', ...Array.from({ length: 5 }, (_, i) => `  - Worker child number ${i + 1}`), ''].join('\n');
    const nodes = parseOutline(src, 'test.md');
    const issues = checkStructure(nodes, 'test.md', rulesWith({ siblings: { min: 2, max: 3 } }));
    expect(issues.length).toBe(1);
    expect(issues[0]!.rule).toBe('structure.siblings.max');
    expect(issues[0]!.message).toBe('"Alpha parent" has 5 children (max 3).');
    expect(issues.some(i => i.rule === 'structure.siblings.min')).toBe(false);
    expect(issues.some(i => i.rule === 'structure.single_child')).toBe(false);
  });

  test('g (unit): §18 delete-key — siblings.min null + 1 child + collapse ON → single_child only', () => {
    const nodes = parseOutline(ONE_CHILD_MD, 'test.md');
    const issues = checkStructure(nodes, 'test.md', rulesWith({ siblings: { min: null, max: 12 } }));
    expect(issues.length).toBe(1);
    expect(issues[0]!.rule).toBe('structure.single_child');
    expect(issues.some(i => i.rule === 'structure.siblings.min')).toBe(false);
  });
});

// ── CLI end-to-end layer ────────────────────────────────────────────────

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-51');

/** Six roots, each with EXACTLY one child — the issue's "6 nodes counted
 *  twice" shape. All texts ≥ 3 chars, depth 2, clean 2-space indentation, so
 *  structure.siblings/single_child are the only possible findings. */
const SINGLETONS_MD = [
  '- Onboarding flow',
  '  - Single step account creation',
  '- Backup flow',
  '  - Single step data export',
  '- Notifications',
  '  - Single digest email channel',
  '- Billing flow',
  '  - Single flat rate plan',
  '- Search flow',
  '  - Single keyword index',
  '- Audit trail',
  '  - Single append-only event log',
  '',
].join('\n');

/** Template-shaped structure section (siblings.min 4, collapse ON). Listing
 *  `structure:` makes the file a curated config (§18 delete-mode), so every
 *  other section is intentionally absent → all other engines OFF (no
 *  orphan/style/redundancy noise — the structure total is exactly the six
 *  findings under test). */
const ISSUE_RULES = [
  'structure:',
  '  node_length: { min: 3, max: 120 }',
  '  siblings: { min: 4, max: 12 }',
  '  depth: { min: 1, max: 5 }',
  '  single_child_collapse: true',
  '  empty_nodes: false',
  '',
].join('\n');

/** Blackbox CLI spawn, isolated from any ambient CANS_ROOT. */
function runCli(args: string[], cwd: string) {
  return spawnCli(args, cwd, { ...process.env, CANS_ROOT: '' });
}

/** JSON-mode output must be a single JSON document; reconstitute the flat
 *  issues view from sections.{category}[] (issue #41 wire shape). */
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

describe('issue #51: CLI end-to-end — structure total counts distinct nodes', () => {
  test('h: 6 single-child parents + siblings min 4 → STRUCTURE ⚠ 6, 6× single_child, 0× siblings.min', () => {
    const root = join(SCRATCH, 'cli-repro');
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
    try {
      // 00-overview.md: orphan-exempt name (refs engine is OFF here anyway —
      // belt and braces, so the run can only ever show structure findings).
      makeCansWorkspace(root, {
        '00-overview.md': SINGLETONS_MD,
        '_rules.yaml': ISSUE_RULES,
      });

      // Human output: the section header derives from the issues array
      // (errorCount + warningCount) — dedupe at EMISSION time must show the
      // distinct-node count (6), not the pre-fix double-count (12).
      const text = runCli(['check'], root);
      expect(text.exit).toBe(1); // warnings-only → exit 1 (issue #41 contract)
      expect(text.out).toMatch(/^STRUCTURE  ⚠ 6$/m);
      expect(text.out).toMatch(/6× single child \(collapse\)/);
      expect(text.out).not.toMatch(/<min children/);

      // JSON output: exactly 6 structure findings, all single_child, on 6
      // distinct lines — zero siblings.min for those nodes.
      const r = runCli(['check', '--json'], root);
      const j = parseJsonOut(r.out);
      expect(r.exit).toBe(1);
      expect(j.exitCode).toBe(1);
      expect(j.counts.errors).toBe(0);
      expect(j.counts.warnings).toBe(6);
      const structure = j.sections.structure;
      expect(structure.length).toBe(6);
      expect(structure.every((i: any) => i.rule === 'structure.single_child')).toBe(true);
      expect(structure.filter((i: any) => i.rule === 'structure.siblings.min')).toEqual([]);
      // 6 distinct offending nodes (the issue's inflated-total complaint):
      const lines = new Set(structure.map((i: any) => i.line));
      expect(lines.size).toBe(6);
      for (const i of structure) {
        expect(i.level).toBe('warning');
        expect(i.file).toBe('00-overview.md');
        expect(i.detail).toBe(
          `"${SINGLETONS_MD.split('\n')[i.line - 1]!.replace(/^- /, '')}" has exactly 1 child. Collapse.`,
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
