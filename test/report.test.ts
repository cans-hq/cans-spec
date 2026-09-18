import { describe, test, expect } from './testing.ts';
import {
  buildReport,
  checkReportJson,
  estimateTokens,
  formatLocations,
  topGroups,
} from '../src/core/report.ts';
import type { CheckReport, CheckResultLike, IssueLike, SectionReport } from '../src/core/report.ts';

/** issue #41: every scenario entry pairs a raw issue (no `rule`) with the
 *  vocabulary id the rule-annotation pass adds — so the rule path and the
 *  fallback path can be asserted to agree on the SAME inputs. */
type Scenario = Array<[IssueLike, string]>;

let seq = 0;
function issue(partial: Partial<IssueLike> & { message: string; category: string }): IssueLike {
  seq++;
  return {
    file: 'a.md',
    line: seq,
    level: 'warning',
    ...partial,
  };
}

// ── Scenario builders (mirror the real issue #41 workload) ──

/** 61 sibling-min warnings scattered across 10 files (one duplicate spot). */
function siblingMinScenario(): Scenario {
  const msg = '"Inspect format" has 2 children (min 3).';
  const entries: Scenario = [];
  // action.md first: lines 143, 30, 111, 30 (dup), 201, 246, 300 → 6 unique
  for (const line of [143, 30, 111, 30, 201, 246, 300]) {
    entries.push([issue({ file: 'action.md', line, category: 'structure', message: msg }), 'structure.siblings.min']);
  }
  const rest = ['budget.md', 'claims.md', 'design.md', 'auth.md', 'export.md', 'gates.md', 'hooks.md', 'index.md', 'joins.md'];
  for (let i = 0; i < 54; i++) {
    entries.push([issue({ file: rest[i % 9]!, line: 10 + i * 5, category: 'structure', message: msg }), 'structure.siblings.min']);
  }
  return entries; // 7 + 54 = 61
}

/** 91 broken refs across 4 distinct missing targets: 72/16/2/1. */
function brokenFileScenario(): Scenario {
  const targets: Array<[string, number]> = [
    ['artifacts/governance.yaml', 72],
    ['artifacts/interfaces.yaml', 16],
    ['glossary.md', 2],
    ['99-future.md', 1],
  ];
  const entries: Scenario = [];
  let line = 1;
  for (const [target, count] of targets) {
    for (let i = 0; i < count; i++) {
      const file = `f${(line % 7) + 1}.md`;
      entries.push([
        issue({
          file,
          line,
          level: 'error',
          category: 'refs',
          message: `broken ref: see ${target} — file not found`,
          suggestion: `create ${target} or fix the ref target`,
        }),
        'refs.broken.file',
      ]);
      line++;
    }
  }
  return entries;
}

/** 112 keyword warnings across 5 dominant keywords: 40/30/20/15/7. */
function keywordScenario(): Scenario {
  const words: Array<[string, number]> = [
    ['artifacts', 40],
    ['interface', 30],
    ['budget', 20],
    ['spec', 15],
    ['tasks', 7],
  ];
  const entries: Scenario = [];
  let line = 1;
  for (const [word, count] of words) {
    for (let i = 0; i < count; i++) {
      entries.push([
        issue({
          file: 'action.md',
          line: line++,
          category: 'redundancy',
          message: `"${word}" × ${count} nodes (threshold: 12)`,
          suggestion: `pick one canonical home for "${word}" and see: it from the others`,
        }),
        'redundancy.keyword',
      ]);
    }
  }
  return entries;
}

/** 75 overlaps: 22 exact (100%) + 53 fuzzy (<100%). */
function overlapScenario(): Scenario {
  const entries: Scenario = [];
  for (let i = 0; i < 22; i++) {
    entries.push([
      issue({
        file: `x${i}.md`,
        line: i + 1,
        category: 'redundancy',
        message: `100% overlap: x${i}.md:${i + 1} ↔ y${i}.md:${i + 100}`,
        suggestion: 'merge the duplicated bullets or see: the canonical one',
      }),
      'redundancy.overlap.exact',
    ]);
  }
  for (let i = 0; i < 53; i++) {
    const pct = 70 + (i % 30); // 70..99, 99 present
    entries.push([
      issue({
        file: `p${i}.md`,
        line: i + 1,
        category: 'redundancy',
        message: `${pct}% overlap: p${i}.md:${i + 1} ↔ q${i}.md:${i + 200}`,
        suggestion: 'merge the duplicated bullets or see: the canonical one',
      }),
      'redundancy.overlap.fuzzy',
    ]);
  }
  return entries;
}

/** 8 stale back-pointers to one target (budget.md) from 3 referrers. */
function staleBackPointerScenario(): Scenario {
  const plan: Array<[string, number[]]> = [
    ['agent.md', [2, 5, 8]],
    ['research.md', [11, 14, 17]],
    ['notes.md', [20, 23]],
  ];
  const entries: Scenario = [];
  for (const [from, lines] of plan) {
    for (const line of lines) {
      entries.push([
        issue({
          file: 'budget.md',
          line,
          category: 'refs',
          message: `stale back-pointer: ${from} no longer refs budget.md`,
          suggestion: 'remove the ref-by comment (or re-run cans check --fix)',
        }),
        'refs.backpointer.stale',
      ]);
    }
  }
  return entries;
}

/** One issue per remaining engine message format (rule + fallback coverage). */
function miscScenario(): Scenario {
  return [
    [issue({ file: 'a.md', line: 3, level: 'error', category: 'structure', message: 'Depth 6 exceeds max 5. Flatten.' }), 'structure.depth.max'],
    [issue({ file: 'a.md', line: 4, level: 'error', category: 'structure', message: 'Max depth 4 is below min 5 — the outline is too flat.' }), 'structure.depth.min'],
    [issue({ file: 'a.md', line: 9, level: 'error', category: 'structure', message: 'Node too long (130 > 120). Split or move to file.' }), 'structure.node_length.max'],
    [issue({ file: 'a.md', line: 11, category: 'structure', message: 'Node too short (4 < 10).' }), 'structure.node_length.min'],
    [issue({ file: 'a.md', line: 12, category: 'structure', message: 'Empty node.' }), 'structure.empty_node'],
    [issue({ file: 'a.md', line: 13, category: 'structure', message: '"Solo" has exactly 1 child. Collapse.' }), 'structure.single_child'],
    [issue({ file: 'a.md', line: 14, category: 'structure', message: '"Auth" has 14 children (max 12).' }), 'structure.siblings.max'],
    [issue({ file: 'a.md', line: 15, category: 'style', message: '3 siblings share prefix "configure". Group under nested style.' }), 'style.prefix.shared'],
    [issue({ file: 'a.md', line: 16, category: 'style', message: '"Auth" has 2 children. Collapse to sibling style.' }), 'style.nesting.prefer'],
    [issue({ file: 'b.md', line: 20, level: 'error', category: 'refs', message: 'broken anchor: interface.md#Refusals — no node matches', suggestion: 'fix the anchor or add a "Refusals" node to interface.md' }), 'refs.broken.anchor'],
    [issue({ file: 'b.md', line: 4, level: 'error', category: 'refs', message: 'self-reference: b.md → b.md', suggestion: 'remove the self-reference; point at the canonical file instead' }), 'refs.self'],
    [issue({ file: 'c.md', line: 0, category: 'refs', message: 'orphan: c.md has no incoming or outgoing refs', suggestion: 'link it from a related spec file, or fold it into one' }), 'refs.orphan'],
    [issue({ file: 'd.md', line: 7, level: 'error', category: 'refs', message: 'DEEP HOP: a.md → b.md → c.md', suggestion: 'add "see: c.md" directly to a.md' }), 'refs.deep_hop'],
    [issue({ file: 'e.md', line: 2, level: 'error', category: 'overflow', message: 'no chaining: overflow target e.md must not contain its own see: refs (found see b.md)', suggestion: 'remove the see: ref inside e.md — overflow targets are leaf content, reference them from a spec file instead' }), 'refs.chaining'],
    [issue({ file: 'f.md', line: 1, level: 'error', category: 'overflow', message: 'code fence detected — extract to file and reference via see:' }), 'overflow.code_fence'],
    [issue({ file: 'f.md', line: 2, level: 'error', category: 'overflow', message: 'table detected — extract to file and reference via see:' }), 'overflow.table'],
    [issue({ file: 'f.md', line: 3, level: 'error', category: 'overflow', message: 'node exceeds max chars (150 > 120)' }), 'overflow.node_chars'],
    [issue({ file: 'g.md', line: 0, level: 'error', category: 'structure', message: 'parse error: g.md: tab indentation rejected (use 2 spaces)' }), 'parse.error'],
    [issue({ file: 'g.md', line: 5, category: 'structure', message: 'odd indentation (3 spaces) — nodes may be re-parented unexpectedly; use 2-space multiples' }), 'parse.indent'],
    [issue({ file: 'h.md', line: 0, level: 'error', category: 'structure', message: 'unreadable spec file: EACCES: permission denied, open h.md' }), 'io.unreadable'],
    [issue({ file: '05-dir.md', line: 0, category: 'structure', message: 'malformed workspace entry: directory "05-dir.md" looks like a spec file — rename it or use folder mode (05-dir/index.md)', suggestion: 'remove or rename the directory cans/05-dir.md' }), 'structure.malformed_dir'],
    [issue({ file: '06-x.md', line: 0, level: 'error', category: 'structure', message: 'duplicate home: both 06-x.md and 06-x/index.md exist — flat wins, remove the folder', suggestion: 'delete 06-x/index.md (or merge its content into 06-x.md)' }), 'structure.duplicate_home'],
    [issue({ file: 'i.md', line: 8, category: 'structure', message: '5 TBD nodes exceed content.max_tbd_per_file (3)', suggestion: 'resolve the TBD nodes or raise content.max_tbd_per_file' }), 'content.tbd.max'],
    [issue({ file: 'j.md', line: 9, category: 'structure', message: 'TBD used but content.tbd_allowed is false', suggestion: 'resolve the TBD nodes or set content.tbd_allowed: true' }), 'content.tbd.disallowed'],
    [issue({ file: 'k.md', line: 21, category: 'redundancy', message: 'possible typo: "artefacts" (k.md:21) ↔ "artifacts" (k.md:22) — Levenshtein 1', suggestion: 'unify the spelling or map the variant as a synonym' }), 'redundancy.typo'],
    [issue({ file: 'l.md', line: 3, category: 'redundancy', message: '"budget gates" at depth 0-1 in 3+ files without see: (l.md, m.md, n.md)', suggestion: 'keep "budget gates" in one canonical file and see: it from the others' }), 'redundancy.duplicate_home'],
    [issue({ file: '', line: 0, level: 'error', category: 'refs', message: 'no cans workspace found — run `cans init` or cd into a project with a cans/ directory' }), 'refs.other'],
    [issue({ file: 'z.md', line: 1, category: 'refs', message: 'transient ref: see _tasks/02-auth.md — _tasks/ files are transient, not spec', suggestion: 're-point at a spec file when the task lands' }), 'refs.other'],
  ];
}

function toIssues(scenario: Scenario): IssueLike[] {
  return scenario.map(([iss]) => iss);
}

function toAnnotated(scenario: Scenario): IssueLike[] {
  return scenario.map(([iss, rule]) => ({ ...iss, rule }));
}

describe('report core (issue #41)', () => {
  test('61 sibling-min warnings collapse into ONE group with compact locations', () => {
    const report = buildReport(toIssues(siblingMinScenario()));
    expect(report.groups.length).toBe(1);
    const g = report.groups[0]!;
    expect(g.rule).toBe('structure.siblings.min');
    expect(g.pattern).toBe('<min children (2/3)');
    expect(g.count).toBe(61);
    expect(g.level).toBe('warning');
    expect(g.category).toBe('structure');
    // issue #41: compact per-file locations, lines numerically sorted + deduped
    expect(g.locations[0]).toBe('action:30,111,143,201,246,300');
    expect(g.locations.length).toBe(10);
    const section = report.sections['structure']!;
    expect(section.name).toBe('structure');
    expect(section.warningCount).toBe(61);
    expect(section.errorCount).toBe(0);
    expect(section.groups.length).toBe(1);
  });

  test('91 broken refs across 4 missing targets → 4 groups by count desc', () => {
    const report = buildReport(toIssues(brokenFileScenario()));
    const groups = report.groups;
    expect(groups.length).toBe(4);
    expect(groups.map((g) => g.count)).toEqual([72, 16, 2, 1]);
    expect(groups.map((g) => g.key)).toEqual([
      'artifacts/governance.yaml',
      'artifacts/interfaces.yaml',
      'glossary.md',
      '99-future.md',
    ]);
    for (const g of groups) {
      expect(g.rule).toBe('refs.broken.file');
      expect(g.pattern).toBe('missing file');
      expect(g.category).toBe('refs');
      // issue #41: target shown as the group's single ranked item
      expect(g.items).toEqual([{ label: g.key!, count: g.count }]);
    }
    // fix hint once per group, taken from the members
    expect(groups[0]!.suggestion).toBe('create artifacts/governance.yaml or fix the ref target');
    expect(groups[3]!.suggestion).toBe('create 99-future.md or fix the ref target');
    expect(report.sections['refs']!.errorCount).toBe(91);
    expect(report.sections['refs']!.warningCount).toBe(0);
  });

  test('112 keyword warnings → one group, items ranked desc by node count', () => {
    const report = buildReport(toIssues(keywordScenario()));
    const groups = report.groups;
    expect(groups.length).toBe(1);
    const g = groups[0]!;
    expect(g.rule).toBe('redundancy.keyword');
    expect(g.pattern).toBe('keyword sprawl');
    expect(g.count).toBe(112);
    expect(g.items!.map((it) => it.label)).toEqual(['artifacts', 'interface', 'budget', 'spec', 'tasks']);
    expect(g.items!.map((it) => it.count)).toEqual([40, 30, 20, 15, 7]);
    // per-keyword location available on the items (one per member issue)
    expect(g.items![0]!.locations![0]).toBe('action:1');
    expect(g.items![0]!.locations!.length).toBe(40);
    expect(g.items![4]!.locations![0]).toBe('action:106');
    expect(g.items![4]!.locations!.length).toBe(7);
    expect(g.suggestion).toBe('pick one canonical home for "artifacts" and see: it from the others');
  });

  test('75 overlaps → 2 groups (exact 100% vs fuzzy <100%), fuzzy items ranked by pct', () => {
    const report = buildReport(toIssues(overlapScenario()));
    expect(report.groups.length).toBe(2);
    const [fuzzy, exact] = report.groups;
    expect(fuzzy!.rule).toBe('redundancy.overlap.fuzzy');
    expect(fuzzy!.pattern).toBe('fuzzy overlap (<100%)');
    expect(fuzzy!.count).toBe(53);
    expect(fuzzy!.items!.length).toBe(53);
    expect(fuzzy!.items![0]!.label.endsWith('(99%)')).toBe(true);
    expect(exact!.rule).toBe('redundancy.overlap.exact');
    expect(exact!.pattern).toBe('exact overlap (100%)');
    expect(exact!.count).toBe(22);
    expect(exact!.items![0]!.label).toBe('x0.md:1 ↔ y0.md:100');
    // totals the printer needs: exact vs fuzzy split
    const redundancy = report.sections['redundancy']!;
    expect(redundancy.groups.map((g) => g.count)).toEqual([53, 22]);
  });

  test('8 stale back-pointers to one target → locations + referrer items', () => {
    const report = buildReport(toIssues(staleBackPointerScenario()));
    expect(report.groups.length).toBe(1);
    const g = report.groups[0]!;
    expect(g.rule).toBe('refs.backpointer.stale');
    expect(g.pattern).toBe('stale back-pointer');
    expect(g.key).toBe('budget.md');
    expect(g.count).toBe(8);
    expect(g.locations).toEqual(['budget:2,5,8,11,14,17,20,23']);
    expect(g.items!.map((it) => [it.label, it.count])).toEqual([
      ['agent', 3],
      ['research', 3],
      ['notes', 2],
    ]);
    expect(g.suggestion).toBe('remove the ref-by comment (or re-run cans check --fix)');
  });

  test('rule path and fallback path produce IDENTICAL grouping', () => {
    const scenario = [
      ...siblingMinScenario(),
      ...brokenFileScenario(),
      ...keywordScenario(),
      ...overlapScenario(),
      ...staleBackPointerScenario(),
      ...miscScenario(),
    ];
    const plain = buildReport(toIssues(scenario));
    const annotated = buildReport(toAnnotated(scenario));
    expect(annotated.groups).toEqual(plain.groups);
    expect(annotated.sections).toEqual(plain.sections);
    // sanity: the fallback actually derived the full vocabulary
    const rules = new Set(plain.groups.map((g) => g.rule));
    for (const [, rule] of scenario) expect(rules.has(rule)).toBe(true);
  });

  test('misc formats normalize to their vocabulary sections and patterns', () => {
    const report = buildReport(toIssues(miscScenario()));
    const byRule = new Map(report.groups.map((g) => [g.rule, g]));
    expect(byRule.get('structure.depth.max')!.pattern).toBe('depth >max (6/5)');
    expect(byRule.get('structure.depth.min')!.pattern).toBe('depth <min (4/5)');
    expect(byRule.get('structure.node_length.max')!.pattern).toBe('node chars >max (130/120)');
    expect(byRule.get('structure.node_length.min')!.pattern).toBe('node chars <min (4/10)');
    expect(byRule.get('structure.empty_node')!.pattern).toBe('empty node');
    expect(byRule.get('structure.single_child')!.pattern).toBe('single child (collapse)');
    expect(byRule.get('structure.siblings.max')!.pattern).toBe('>max children (14/12)');
    expect(byRule.get('style.prefix.shared')!.pattern).toBe('shared prefix "configure"');
    expect(byRule.get('style.nesting.prefer')!.pattern).toBe('collapse to sibling (2)');
    expect(byRule.get('refs.broken.anchor')!.detail).toBe('b.md:20 → interface.md#Refusals');
    expect(byRule.get('refs.orphan')!.locations).toEqual(['c.md']);
    expect(byRule.get('refs.deep_hop')!.detail).toBe('a.md → b.md → c.md');
    expect(byRule.get('refs.chaining')!.category).toBe('refs'); // rule prefix wins over engine category
    expect(byRule.get('overflow.code_fence')!.category).toBe('overflow');
    expect(byRule.get('overflow.node_chars')!.pattern).toBe('node chars >max (150/120)');
    expect(byRule.get('parse.error')!.category).toBe('parse');
    expect(byRule.get('parse.indent')!.pattern).toBe('odd indentation (3 spaces)');
    expect(byRule.get('io.unreadable')!.category).toBe('io');
    expect(byRule.get('structure.malformed_dir')!.key).toBe('05-dir.md');
    expect(byRule.get('structure.duplicate_home')!.key).toBe('06-x.md|06-x/index.md');
    expect(byRule.get('content.tbd.max')!.category).toBe('content');
    expect(byRule.get('content.tbd.max')!.pattern).toBe('tbd nodes >max (5/3)');
    expect(byRule.get('content.tbd.disallowed')!.category).toBe('content');
    expect(byRule.get('redundancy.typo')!.items![0]!.label).toBe('"artefacts" ↔ "artifacts"');
    expect(byRule.get('redundancy.duplicate_home')!.key).toBe('budget gates');
    // unknown shapes: <category>.other with the generic stripped pattern
    const refsOther = report.groups.filter((g) => g.rule === 'refs.other');
    expect(refsOther.length).toBe(2); // check-level failure + transient ref
    const failed = refsOther.find((g) => g.pattern.startsWith('no cans workspace found'))!;
    expect(failed.count).toBe(1);
    expect(failed.locations).toEqual([]); // empty-file issue yields no location
    const transient = refsOther.find((g) => g.pattern.startsWith('transient ref'))!;
    expect(transient.locations).toEqual(['z:1']);
    expect(transient.pattern).toMatch(/transient ref: see _tasks\/#-auth\.md/);
  });

  test('formatLocations: dedup, numeric line sort, .md kept on line 0', () => {
    expect(
      formatLocations([
        { file: 'b.md', line: 10 },
        { file: 'a.md', line: 2 },
        { file: 'b.md', line: 2 },
        { file: 'b.md', line: 10 },
        { file: 'c.md', line: 0 },
        { file: 'sub/dir/d.md', line: 7 },
      ]),
    ).toEqual(['b:2,10', 'a:2', 'c.md', 'sub/dir/d:7']);
    expect(formatLocations([])).toEqual([]);
    expect(formatLocations([{ file: '', line: 0 }])).toEqual([]);
  });

  test('estimateTokens: ceil(chars / 4)', () => {
    expect(estimateTokens('x'.repeat(1600))).toBe(400);
    expect(estimateTokens('x'.repeat(5))).toBe(2);
    expect(estimateTokens('')).toBe(0);
  });

  test('checkReportJson: wire shape, lossless sections, unknown category → other', () => {
    const result: CheckResultLike = {
      ok: false,
      exitCode: 1,
      files: 12,
      nodes: 345,
      maxDepth: 4,
      elapsedMs: 12.5,
      refs: { total: 120, broken: 3, deepHops: 1 },
      backPointers: { total: 10, current: 8, stale: 2 },
      errorCount: 2,
      warningCount: 2,
      backPointersUpdated: 0,
      rulesSummary: 'node_length: 3–120 | siblings: 2–12 | depth: 1–5',
      issues: [
        { file: 'a.md', line: 5, level: 'error', category: 'refs', message: 'broken ref: see x.md — file not found', rule: 'refs.broken.file' },
        { file: 'g.md', line: 0, level: 'error', category: 'structure', message: 'parse error: tab indentation rejected (use 2 spaces)' },
        { file: 'a.md', line: 9, level: 'error', category: 'structure', message: 'Node too long (130 > 120). Split or move to file.' },
        { file: 'c.md', line: 2, level: 'warning', category: 'style', message: '"Auth" has 2 children. Collapse to sibling style.' },
        { file: 'd.md', line: 0, level: 'warning', category: 'weird', message: 'mystery shape' },
      ],
    };
    const json = checkReportJson(result) as Record<string, unknown>;
    expect(Object.keys(json)).toEqual([
      'ok', 'command', 'exitCode', 'summary', 'refs', 'backPointers',
      'counts', 'sections', 'backPointersUpdated', 'rulesSummary',
    ]);
    expect(json['ok']).toBe(false);
    expect(json['command']).toBe('check');
    expect(json['exitCode']).toBe(1);
    expect(json['summary']).toEqual({ files: 12, nodes: 345, maxDepth: 4, elapsedMs: 12.5 });
    expect(json['refs']).toEqual({ total: 120, broken: 3, deepHops: 1 });
    expect(json['backPointers']).toEqual({ total: 10, current: 8, stale: 2 });
    expect(json['counts']).toEqual({ errors: 2, warnings: 2 });
    // issue #41 integration: entries are a superset of the acceptance shape
    // (level always present; suggestion only when the issue carries one).
    const sections = json['sections'] as Record<string, Array<{ file: string; line: number; level: string; rule: string; detail: string; suggestion?: string }>>;
    expect(Object.keys(sections)).toEqual(['structure', 'style', 'refs', 'redundancy', 'overflow', 'other']);
    // one entry per raw issue, source order preserved, detail lossless
    expect(sections['refs']!.length).toBe(1);
    // issue #41 integration: entries are a strict superset of the acceptance
    // shape — level always present, suggestion only when the issue carries one.
    expect(sections['refs']![0]).toEqual({
      file: 'a.md', line: 5, level: 'error', rule: 'refs.broken.file', detail: 'broken ref: see x.md — file not found',
    });
    expect(sections['structure']!.length).toBe(2);
    expect(sections['structure']![0]!.rule).toBe('parse.error'); // derived when rule absent
    expect(sections['structure']![1]!.rule).toBe('structure.node_length.max');
    expect(sections['style']![0]!.rule).toBe('style.nesting.prefer');
    expect(sections['other']![0]!.file).toBe('d.md');
    expect(sections['other']![0]!.detail).toBe('mystery shape');
    expect(json['rulesSummary']).toBe('node_length: 3–120 | siblings: 2–12 | depth: 1–5');
  });

  test('checkReportJson: optional fields omitted when absent', () => {
    const json = checkReportJson({
      ok: true,
      exitCode: 0,
      files: 1,
      nodes: 2,
      maxDepth: 2,
      refs: { total: 0, broken: 0, deepHops: 0 },
      backPointers: { total: 0, current: 0, stale: 0 },
      errorCount: 0,
      warningCount: 0,
      backPointersUpdated: 0,
      issues: [],
    }) as { summary: Record<string, number>; rulesSummary?: string };
    expect('elapsedMs' in json.summary).toBe(false);
    expect('rulesSummary' in json).toBe(false);
  });

  test('edge: empty issues → empty report', () => {
    const report: CheckReport = buildReport([]);
    expect(report.groups).toEqual([]);
    expect(report.sections).toEqual({});
  });

  test('edge: suggestion-less issues → no suggestion on the group', () => {
    const report = buildReport([
      issue({ file: 'a.md', line: 3, level: 'error', category: 'structure', message: 'Depth 6 exceeds max 5. Flatten.' }),
      issue({ file: 'a.md', line: 4, level: 'error', category: 'structure', message: 'Depth 7 exceeds max 5. Flatten.' }),
    ]);
    expect(report.groups.length).toBe(2);
    for (const g of report.groups) expect(g.suggestion).toBeUndefined();
  });

  test('edge: identical (file, line) pairs dedupe inside one group', () => {
    const report = buildReport([
      issue({ file: 'a.md', line: 3, level: 'error', category: 'refs', message: 'broken anchor: t.md#X — no node matches' }),
      issue({ file: 'a.md', line: 3, level: 'error', category: 'refs', message: 'broken anchor: t.md#Y — no node matches' }),
    ]);
    expect(report.groups.length).toBe(1);
    expect(report.groups[0]!.count).toBe(2);
    expect(report.groups[0]!.locations).toEqual(['a:3']);
  });

  test('topGroups: top-N shown, folded counts hidden occurrences', () => {
    // 112 distinct missing targets → 112 single-count groups
    const issues: IssueLike[] = [];
    for (let i = 0; i < 112; i++) {
      const target = `missing-${String(i).padStart(3, '0')}.md`;
      issues.push(issue({ file: 'a.md', line: i + 1, level: 'error', category: 'refs', message: `broken ref: see ${target} — file not found` }));
    }
    const report = buildReport(issues);
    const section: SectionReport = report.sections['refs']!;
    expect(section.groups.length).toBe(112);
    // issue #41: top-5 shown, the other 107 occurrences folded
    const { shown, folded } = topGroups(section, 5);
    expect(shown.length).toBe(5);
    expect(folded).toBe(107);
    expect(shown[0]!.key).toBe('missing-000.md');
    // n ≥ group count → nothing folded; n ≤ 0 → everything folded
    expect(topGroups(section, 200)).toEqual({ shown: section.groups, folded: 0 });
    expect(topGroups(section, 0).folded).toBe(112);
    // folded sums issue counts, not group counts
    const synthetic: SectionReport = {
      name: 'refs',
      errorCount: 10,
      warningCount: 0,
      groups: [
        { ...section.groups[0]!, count: 5 },
        { ...section.groups[1]!, count: 3 },
        { ...section.groups[2]!, count: 2 },
      ],
    };
    expect(topGroups(synthetic, 2)).toEqual({ shown: synthetic.groups.slice(0, 2), folded: 2 });
  });

  test('buildReport topN folds section groups but keeps the flat list complete', () => {
    const report = buildReport(toIssues(brokenFileScenario()), { topN: 2 });
    expect(report.groups.length).toBe(4); // flat list: nothing dropped silently
    expect(report.sections['refs']!.groups.length).toBe(2);
    expect(report.sections['refs']!.groups.map((g) => g.count)).toEqual([72, 16]);
    const unfolded = buildReport(toIssues(brokenFileScenario()));
    expect(unfolded.sections['refs']!.groups.length).toBe(4);
  });

  test('generic fallback pattern: quoted strings + digits stripped, capped at 40', () => {
    const report = buildReport([
      issue({ file: 'a.md', line: 1, category: 'style', message: 'weird style thing happened 42 times "quoted"' }),
      issue({ file: 'b.md', line: 2, category: 'overflow', message: `mystery ${'word '.repeat(20)}123` }),
    ]);
    const [styleOther, overflowOther] = report.groups;
    expect(styleOther!.rule).toBe('style.other');
    expect(styleOther!.pattern).toBe('weird style thing happened # times');
    expect(overflowOther!.rule).toBe('overflow.other');
    expect(overflowOther!.pattern.length).toBe(40);
  });
});
