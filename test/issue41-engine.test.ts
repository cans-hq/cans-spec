/**
 * issue #41 — engine-side data contract for `cans check` (Task ID: 1-a).
 *
 * Pins the three engine-surface additions the compact-report work builds on:
 *   1. every Issue emitted by checkWorkspace carries a machine-readable dotted
 *      `rule` key (vocabulary: <engine>.<check>[.<side>]);
 *   2. CheckResult.elapsedMs is a whole-ms wall-clock duration (0 on the
 *      static checkFail paths);
 *   3. the 0/1/2 exit-code contract: 0 clean · 1 warnings · 2 errors —
 *      strict affects `ok`, never the exit code, and checkFail (the check
 *      could not run) is the error class → 2.
 *
 * Runtime-neutral: imports the test facade, never 'bun:test' directly.
 */
import { describe, test, expect } from './testing.ts';
import { fixturePath, makeTmpDir, cleanTmpDir, makeCansWorkspace } from './helpers.ts';
import { checkWorkspace, run, type CheckArgs } from '../src/commands/check.ts';
import type { CheckResult } from '../src/types.ts';

// Dotted rule vocabulary: lowercase segments joined by dots (issue #41).
const RULE_RE = /^[a-z_]+\.[a-z_.]+$/;

const BASE_OPTS: CheckArgs = {
  fix: false,
  strict: false,
  refsOnly: false,
  noRedundancy: false,
  file: null,
  json: false,
};

/** Check a fixture workspace in place (fixtures ARE cans/ workspace roots). */
async function checkFixture(name: string, opts: Partial<CheckArgs> = {}): Promise<CheckResult> {
  return checkWorkspace(fixturePath(name), { ...BASE_OPTS, ...opts });
}

describe('issue #41 — every engine issue carries a machine-readable rule key', () => {
  const FIXTURES = [
    'broken-refs-project',
    'redundancy-project',
    'overflow-project',
    'flat-project',
  ];

  for (const fixture of FIXTURES) {
    test(`all issues from ${fixture} have a dotted non-empty rule`, async () => {
      const r = await checkFixture(fixture);
      expect(r.issues.length).toBeGreaterThan(0); // fixture self-consistency
      for (const issue of r.issues) {
        expect(typeof issue.rule).toBe('string');
        expect(issue.rule!.length).toBeGreaterThan(0);
        expect(issue.rule).toMatch(RULE_RE);
      }
    });
  }

  test('dictated vocabulary: broken-refs fixture emits refs.broken.file and refs.self', async () => {
    const r = await checkFixture('broken-refs-project');
    const rules = new Set(r.issues.map(i => i.rule));
    expect(rules.has('refs.broken.file')).toBe(true);
    expect(rules.has('refs.self')).toBe(true);
  });

  test('rules stay stable per emission site: identical messages keep identical rules', async () => {
    const r = await checkFixture('flat-project');
    const byMessage = new Map<string, string>();
    for (const issue of r.issues) {
      const seen = byMessage.get(issue.message);
      if (seen !== undefined) {
        expect(issue.rule).toBe(seen); // same message → same machine key
      } else {
        byMessage.set(issue.message, issue.rule!);
      }
    }
  });
});

describe('issue #41 — exit codes 0 clean · 1 warnings · 2 errors', () => {
  test('a clean workspace exits 0', async () => {
    const tmp = makeTmpDir('issue41-clean');
    try {
      const root = makeCansWorkspace(tmp, {
        '_rules.yaml': [
          'structure:',
          '  single_child_collapse: false',
          'style:',
          '  shared_prefix_detection: false',
          'references:',
          '  orphan_check: false',
          '  back_pointers: false',
          'redundancy:',
          '  enabled: false',
          '',
        ].join('\n'),
        '01-alpha.md': '- Alpha overview hub\n  - Zephyr ledger details\n  - Quartz marlin notes\n',
        '02-beta.md': '- Beta overview hub\n  - Cobalt beacon details\n  - Amber harbor notes\n',
      });
      const r = await checkWorkspace(root, BASE_OPTS);
      expect(r.errorCount).toBe(0);
      expect(r.warningCount).toBe(0);
      expect(r.ok).toBe(true);
      expect(r.exitCode).toBe(0);
    } finally {
      cleanTmpDir(tmp);
    }
  });

  test('a warnings-only workspace exits 1 (and stays 1 under --strict: strict affects ok, not the exit code)', async () => {
    // flat-project: 0 errors, 19 warnings (single-child collapses, stale
    // back-pointers, redundancy sprawl) → the warnings band of the contract.
    const r = await checkFixture('flat-project');
    expect(r.errorCount).toBe(0);
    expect(r.warningCount).toBeGreaterThan(0);
    expect(r.ok).toBe(true);
    expect(r.exitCode).toBe(1);

    const strict = await checkFixture('flat-project', { strict: true });
    expect(strict.errorCount).toBe(0);
    expect(strict.warningCount).toBeGreaterThan(0);
    expect(strict.ok).toBe(false); // strict flips ok…
    expect(strict.exitCode).toBe(1); // …but never the exit code (issue #41)
  });

  test('a workspace with a broken ref exits 2', async () => {
    const r = await checkFixture('broken-refs-project');
    expect(r.errorCount).toBeGreaterThan(0);
    expect(r.refs.broken).toBeGreaterThanOrEqual(2);
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(2);
  });

  test('checkFail paths exit 2: unknown flag via parseCheckArgs → run', async () => {
    // Arg errors are diagnosed before any workspace resolution, so this is
    // cwd-independent: the check could not run = error class.
    const r = await run(['--bogus']);
    expect(r.ok).toBe(false);
    expect(r.errorCount).toBe(1);
    expect((r as CheckResult & { error: string }).error).toContain('unknown flag');
    expect(r.exitCode).toBe(2);
  });

  test('checkFail paths exit 2: unmatched file filter', async () => {
    const r = await checkFixture('flat-project', { file: 'zzz-no-such-spec.md' });
    expect(r.ok).toBe(false);
    expect((r as CheckResult & { error: string }).error).toContain('no spec file matches');
    expect(r.exitCode).toBe(2);
  });
});

describe('issue #41 — elapsedMs timing on CheckResult', () => {
  test('success results carry an integer elapsedMs ≥ 0', async () => {
    for (const fixture of ['flat-project', 'broken-refs-project']) {
      const r = await checkFixture(fixture);
      expect(typeof r.elapsedMs).toBe('number');
      expect(Number.isInteger(r.elapsedMs)).toBe(true);
      expect(r.elapsedMs).toBeGreaterThanOrEqual(0);
    }
  });

  test('the static checkFail paths report elapsedMs 0 (nothing was measured)', async () => {
    const fail = await checkFixture('flat-project', { file: 'zzz-no-such-spec.md' });
    expect(fail.elapsedMs).toBe(0);
    const flagFail = await run(['--bogus']);
    expect(flagFail.elapsedMs).toBe(0);
  });
});
