/**
 * Issue #43 — an invalid `_rules.yaml` must be reported as a CONFIG error,
 * never as a refs-category finding.
 *
 * Bug (reported against 0.5.0, live on main @ 0414cd2): when `_rules.yaml`
 * failed to parse, checkFail() carried its diagnosis as a synthetic issue
 * with category 'refs' and file '' — so `cans check --json` surfaced it as
 * sections.refs[0] with rule "refs.other", file "", line 0, while summary
 * reported files: 0, nodes: 0. Agents filtering findings by category
 * mis-handled a check-level configuration error as a refs finding.
 *
 * Fix contract (binding design, worklog 2026-10-23):
 *   - dedicated `config` issue category: the invalid-rules catch emits
 *     { file: '_rules.yaml', line: 0, level: 'error', category: 'config',
 *       rule: 'config.invalid' };
 *   - exitCode stays 2 (issue #41: the check could not run = error class)
 *     and the top-level `error` field stays (§37 standalone diagnosis);
 *   - JSON wire: sections.config carries the entry, sections.refs stays
 *     empty for the config error;
 *   - ADDITIVE wire discipline (§35): a run with NO config error keeps the
 *     exact five pinned section keys (test/report.test.ts pins
 *     Object.keys(sections) === ['structure','style','refs','redundancy',
 *     'other']) — 'config' appears ONLY when a config error
 *     exists, so every untouched run stays byte-identical;
 *   - other checkFail paths (unknown flag, no workspace, unmatched file
 *     filter) keep the current shape (category 'refs', derived
 *     'refs.other') — deliberately out of scope.
 *
 * Levels: CLI blackbox (the issue's repro), engine unit (checkWorkspace),
 * and report-core unit (checkReportJson/buildReport).
 */
import { describe, test, expect, afterEach } from './testing.ts';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

import { spawnCli, REPO } from './runtime.ts';
import { checkWorkspace } from '../src/commands/check.ts';
import { checkReportJson, buildReport, type CheckResultLike } from '../src/core/report.ts';
import type { CheckResult } from '../src/types.ts';

const SCRATCH = join(REPO, '.tmp', 'issue-43-config-error');

interface Ws { root: string; cans: string }

const createdDirs: string[] = [];
let wsSeq = 0;

/** Fresh scratch workspace under repo/.tmp/issue-43-config-error (gitignored). */
function makeWs(name: string): Ws {
  const root = join(SCRATCH, `${name}-${++wsSeq}`);
  mkdirSync(join(root, 'cans'), { recursive: true });
  createdDirs.push(root);
  return { root, cans: join(root, 'cans') };
}

/** Blackbox CLI spawn — isolated from any ambient CANS_ROOT. */
function runCli(args: string[], cwd: string) {
  return spawnCli(args, cwd, { ...process.env, CANS_ROOT: '' });
}

/** JSON-mode output must be a single JSON document; a parse failure is itself an assertion failure. */
function parseJsonOut(out: string): any {
  let parsed: unknown = null;
  let parseError: unknown = null;
  try {
    parsed = JSON.parse(out);
  } catch (e) {
    parseError = e;
  }
  expect(parseError).toBeNull();
  return parsed;
}

afterEach(() => {
  for (const d of createdDirs) rmSync(d, { recursive: true, force: true });
  createdDirs.length = 0;
});

/** A well-formed rules file — the malformed repro appends ONE bad line to it. */
const VALID_RULES = [
  'structure:',
  '  node_length: { min: 3, max: 120 }',
  '  siblings: { min: 1, max: 12 }',
  '  depth: { min: 1, max: 5 }',
  '  single_child_collapse: true',
  '  empty_nodes: false',
  '',
].join('\n');

/** The issue's repro shape: `    - oops` at 4-space indentation, outside any
 *  section — parseMinimalYaml rejects it as "line 7: unexpected indentation". */
const MALFORMED_RULES = VALID_RULES + '    - oops\n';

/** Deterministic two-file workspace with real findings (structure + refs
 *  orphans) so the additive-wire pin below exercises non-empty sections.
 *  No _rules.yaml → all documented defaults (§18 missing-file clause). */
function validWs(name: string): Ws {
  const ws = makeWs(name);
  writeFileSync(
    join(ws.cans, '01-alpha.md'),
    [
      '- Alpha overview hub',
      '  - Zephyr ledger details',
      '  - Quartz marlin notes',
      '- Decisions',
      '  - Quarterly platform consolidation wraps up next cycle pending vendor signature and budget confirmation from the finance group staff',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(ws.cans, '02-beta.md'),
    ['- Beta overview hub', '  - Cobalt beacon details', '  - Amber harbor notes', ''].join('\n'),
  );
  return ws;
}

describe('issue #43 — invalid _rules.yaml is a config error, not a refs finding', () => {
  test('repro (JSON): malformed _rules.yaml → exit 2, sections.config[0] is config.invalid on _rules.yaml, NO refs entry', () => {
    const ws = makeWs('repro');
    writeFileSync(join(ws.cans, '01-alpha.md'), '- Alpha overview hub\n  - Zephyr ledger details\n');
    writeFileSync(join(ws.cans, '_rules.yaml'), MALFORMED_RULES);

    const r = runCli(['check', '--json'], ws.root);
    const j = parseJsonOut(r.out);

    // issue #41 contract unchanged: the check could not run = error class.
    expect(r.exit).toBe(2);
    expect(j.ok).toBe(false);
    expect(j.exitCode).toBe(2);

    // §37: the top-level error field carries the standalone diagnosis.
    expect(j.error).toBe('invalid _rules.yaml: line 7: unexpected indentation');

    // THE BUG: the diagnosis must NOT appear as a refs-category finding.
    expect(j.sections.refs).toEqual([]);

    // The config error is unambiguous: its own section, rule, and file.
    expect(j.sections.config).toHaveLength(1);
    expect(j.sections.config[0]).toEqual({
      file: '_rules.yaml',
      line: 0,
      level: 'error',
      rule: 'config.invalid',
      detail: 'invalid _rules.yaml: line 7: unexpected indentation',
    });
    // detail and error name the same root cause.
    expect(j.sections.config[0].detail).toBe(j.error);

    // The check never ran: zeroed summary, exactly one error.
    expect(j.summary.files).toBe(0);
    expect(j.summary.nodes).toBe(0);
    expect(j.summary.maxDepth).toBe(0);
    expect(j.counts).toEqual({ errors: 1, warnings: 0 });
  });

  test('repro (human): standalone diagnosis line — no report body, no bogus REFS header', () => {
    const ws = makeWs('repro-human');
    writeFileSync(join(ws.cans, '01-alpha.md'), '- Alpha overview hub\n  - Zephyr ledger details\n');
    writeFileSync(join(ws.cans, '_rules.yaml'), MALFORMED_RULES);

    const r = runCli(['check'], ws.root);
    expect(r.exit).toBe(2);
    // §37: one standalone diagnosis line, never inside a report-shaped body.
    expect(r.out.trim()).toBe('✗ invalid _rules.yaml: line 7: unexpected indentation');
    // No report furniture may render around it (the old shape bucketed the
    // diagnosis as a refs finding with file "" — a bogus refs section).
    expect(r.out).not.toContain('files ·');
    expect(r.out).not.toContain('REFS');
    expect(r.out).not.toContain('REDUNDANCY');
  });

  test('engine unit: checkWorkspace returns the config-category issue (rule, file, exitCode 2, error field)', async () => {
    const ws = makeWs('engine');
    writeFileSync(join(ws.cans, '01-alpha.md'), '- Alpha overview hub\n  - Zephyr ledger details\n');
    writeFileSync(join(ws.cans, '_rules.yaml'), MALFORMED_RULES);

    const r = await checkWorkspace(join(ws.root, 'cans'), {
      fix: false, strict: false, refsOnly: false, noRedundancy: false, file: null, json: false,
    });
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(2);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]!.category).toBe('config');
    expect(r.issues[0]!.rule).toBe('config.invalid');
    expect(r.issues[0]!.file).toBe('_rules.yaml');
    expect(r.issues[0]!.line).toBe(0);
    expect(r.issues[0]!.level).toBe('error');
    expect(r.errorCount).toBe(1);
    expect((r as CheckResult & { error?: string }).error).toBe(
      'invalid _rules.yaml: line 7: unexpected indentation',
    );
  });

  test('additive wire: a valid workspace keeps the exact pre-#43 JSON (six section keys, no config key)', () => {
    const ws = validWs('additive');
    const r = runCli(['check', '--json'], ws.root);
    const j = parseJsonOut(r.out);

    // §35 discipline: the five pinned section keys, in order, no 'config'.
    expect(Object.keys(j.sections)).toEqual([
      'structure', 'style', 'refs', 'redundancy', 'other',
    ]);
    expect('config' in j.sections).toBe(false);

    // Byte-level stability vs the pre-#43 baseline (captured on main @
    // 0414cd2 for this exact workspace): everything except the timing field.
    delete j.summary.elapsedMs;
    expect(j).toEqual({
      ok: false,
      command: 'check',
      exitCode: 2,
      summary: { files: 2, nodes: 8, maxDepth: 2 },
      refs: { total: 0, broken: 0, deepHops: 0 },
      backPointers: { total: 0, current: 0, stale: 0 },
      counts: { errors: 1, warnings: 3 },
      sections: {
        structure: [
          { file: '01-alpha.md', line: 4, level: 'warning', rule: 'structure.single_child', detail: '"Decisions" has exactly 1 child. Collapse.' },
          { file: '01-alpha.md', line: 5, level: 'error', rule: 'structure.node_length.max', detail: 'Node too long (130 > 120). Split or move to file.' },
        ],
        style: [],
        refs: [
          { file: '01-alpha.md', line: 0, level: 'warning', rule: 'refs.orphan', detail: 'orphan: 01-alpha.md has no incoming or outgoing refs', suggestion: 'link it from a related spec file, or fold it into one' },
          { file: '02-beta.md', line: 0, level: 'warning', rule: 'refs.orphan', detail: 'orphan: 02-beta.md has no incoming or outgoing refs', suggestion: 'link it from a related spec file, or fold it into one' },
        ],
        redundancy: [],
        other: [],
      },
      backPointersUpdated: 0,
      backPointersUpdatedFiles: [],
      rulesSummary: 'node_length: 3–120 | siblings: 1–12 | depth: 1–5',
    });
  });

  test('other checkFail paths keep the current shape: unknown flag stays a refs.other entry (out of scope by design)', () => {
    const ws = validWs('unknown-flag');
    const r = runCli(['check', '--bogus', '--json'], ws.root);
    const j = parseJsonOut(r.out);

    expect(r.exit).toBe(2);
    expect(j.error).toContain('unknown flag');
    // Not a config error: no sections.config, and the synthetic issue keeps
    // its legacy home (category refs → derived rule refs.other, file "").
    expect('config' in j.sections).toBe(false);
    expect(j.sections.refs).toHaveLength(1);
    expect(j.sections.refs[0].rule).toBe('refs.other');
    expect(j.sections.refs[0].file).toBe('');
  });
});

describe('issue #43 — report core: config section is additive, rule path and fallback path agree', () => {
  const configIssue = {
    file: '_rules.yaml',
    line: 0,
    level: 'error' as const,
    category: 'config',
    message: 'invalid _rules.yaml: line 7: unexpected indentation',
  };

  function resultWith(issues: unknown[]): CheckResultLike {
    return {
      ok: false,
      exitCode: 2,
      files: 0,
      nodes: 0,
      maxDepth: 0,
      refs: { total: 0, broken: 0, deepHops: 0 },
      backPointers: { total: 0, current: 0, stale: 0 },
      errorCount: 1,
      warningCount: 0,
      backPointersUpdated: 0,
      backPointersUpdatedFiles: [],
      error: 'invalid _rules.yaml: line 7: unexpected indentation',
      issues: issues as CheckResultLike['issues'],
    };
  }

  test('checkReportJson: config-category issue → sections.config entry (with or without explicit rule)', () => {
    // With the engine's explicit rule key (the real path).
    const withRule = checkReportJson(resultWith([{ ...configIssue, rule: 'config.invalid' }])) as {
      sections: Record<string, Array<{ file: string; rule: string; detail: string }>>;
    };
    expect(Object.keys(withRule.sections)).toEqual([
      'structure', 'style', 'refs', 'redundancy', 'config', 'other',
    ]);
    expect(withRule.sections.config).toHaveLength(1);
    expect(withRule.sections.config[0]!.file).toBe('_rules.yaml');
    expect(withRule.sections.config[0]!.rule).toBe('config.invalid');
    expect(withRule.sections.refs).toEqual([]);

    // Fallback path (no explicit rule): the message normalizer must derive
    // the same rule — report.ts's rule/fallback agreement discipline.
    const withoutRule = checkReportJson(resultWith([configIssue])) as {
      sections: Record<string, Array<{ rule: string }>>;
    };
    expect(withoutRule.sections.config![0]!.rule).toBe('config.invalid');
  });

  test('checkReportJson: no config issues → the five pinned keys only (byte-stable wire)', () => {
    const j = checkReportJson(resultWith([])) as { sections: Record<string, unknown[]> };
    expect(Object.keys(j.sections)).toEqual([
      'structure', 'style', 'refs', 'redundancy', 'other',
    ]);
    expect('config' in j.sections).toBe(false);
  });

  test('buildReport: a config issue groups under its own config section (both paths)', () => {
    for (const issues of [[{ ...configIssue, rule: 'config.invalid' }], [configIssue]]) {
      const report = buildReport(issues as CheckResultLike['issues']);
      expect(report.groups).toHaveLength(1);
      expect(report.groups[0]!.category).toBe('config');
      expect(report.groups[0]!.rule).toBe('config.invalid');
      expect(report.sections.config!.errorCount).toBe(1);
    }
  });
});
