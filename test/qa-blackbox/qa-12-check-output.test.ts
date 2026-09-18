/** QA-12 — blackbox CLI contract tests for issue #41 (agent-friendly check output).
 *
 *  Spawns the REAL CLI (bin/cans.js) against generated workspaces
 *  (./gen-workspace.ts) and asserts the issue's acceptance matrix end-to-end.
 *  Runtime-neutral: under `bun test` process.execPath is bun (Bun fast path of
 *  the launcher); under `node --test` it is node (the registerHooks fallback
 *  path, issue #12/#41) — both runtimes exercise their own launcher branch.
 *
 *  TWO blocks:
 *    1. CURRENT-BEHAVIOR — must pass at all times on this branch.
 *    2. TARGET-CONTRACT — the full issue #41 acceptance matrix, gated by
 *       CANS_QA_TARGET=1 so the suite stays green even when run before the
 *       reporter integration lands. QA-12 release gate: CANS_QA_TARGET=1.
 */

import { describe, test, expect, afterAll } from '../testing.ts';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, cpSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateWorkspace, MINOR_KEYWORDS } from './gen-workspace.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const BIN = join(REPO, 'bin', 'cans.js');
const SCRATCH = join(REPO, '.tmp', `qa-blackbox-${typeof process.versions.bun !== 'undefined' ? 'bun' : 'node'}`);

function runCli(args: string[], cwd: string): { exit: number; out: string; err: string } {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
  return { exit: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const NOISE_RE = /DeprecationWarning|ExperimentalWarning|\(node:/;

// ── Shared generated workspaces (read-only for most tests) ──
mkdirSync(SCRATCH, { recursive: true });
const WS_ISSUE = join(SCRATCH, 'issue');
const WS_WARN = join(SCRATCH, 'warnings-only');
const WS_CLEAN = join(SCRATCH, 'clean');
rmSync(WS_ISSUE, { recursive: true, force: true });
rmSync(WS_WARN, { recursive: true, force: true });
rmSync(WS_CLEAN, { recursive: true, force: true });
generateWorkspace(WS_ISSUE, 'issue');
generateWorkspace(WS_WARN, 'warnings-only');
generateWorkspace(WS_CLEAN, 'clean');

const defaultRun = runCli(['check'], WS_ISSUE);
const defaultJson = runCli(['check', '--json'], WS_ISSUE);

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

// ── 1. CURRENT-BEHAVIOR (always on) ─────────────────────────────────────────

describe('QA-12 current behavior (always on)', () => {
  test('check --json on the issue-scale workspace parses and is lossless-shaped', () => {
    expect(defaultJson.exit).toBe(2);
    const parsed = JSON.parse(defaultJson.out) as Record<string, unknown>;
    expect(parsed.ok).toBe(false);
    expect(parsed.command).toBe('check');
    expect((parsed.sections as Record<string, unknown>).refs).toBeDefined();
  });

  test('clean workspace exits 0 with zero findings', () => {
    const r = runCli(['check'], WS_CLEAN);
    expect(r.exit).toBe(0);
    expect(r.out).toMatch(/✓/);
    expect(NOISE_RE.test(r.out + r.err)).toBe(false);
  });

  test('stdout and stderr carry no Node runtime noise (issue #41 rule 6)', () => {
    for (const r of [defaultRun, defaultJson, runCli(['check'], WS_WARN), runCli(['version'], WS_CLEAN)]) {
      expect(NOISE_RE.test(r.out)).toBe(false);
      expect(NOISE_RE.test(r.err)).toBe(false);
    }
  });

  test('--fix still repairs stale back-pointers (acceptance: --fix keeps working)', () => {
    const ws = join(SCRATCH, 'fix-run');
    rmSync(ws, { recursive: true, force: true });
    cpSync(WS_ISSUE, ws, { recursive: true });
    const before = JSON.parse(runCli(['check', '--json'], ws).out) as { backPointers: { stale: number } };
    expect(before.backPointers.stale).toBe(8);
    const fixed = runCli(['check', '--fix', '--json'], ws);
    expect(fixed.exit).toBe(2); // broken refs remain — but the fix itself ran
    // §35: the fix run's own JSON reports backPointersUpdated (a plain check
    // always reports 0 — the field only exists on the run that wrote).
    const fixJson = JSON.parse(fixed.out) as { backPointersUpdated: number };
    expect(fixJson.backPointersUpdated).toBeGreaterThanOrEqual(1);
    const after = JSON.parse(runCli(['check', '--json'], ws).out) as { backPointers: { stale: number } };
    expect(after.backPointers.stale).toBe(0);
    expect(readFileSync(join(ws, 'cans', '04-budget.md'), 'utf8')).not.toContain('ref-by:');
  });
});

// ── 2. TARGET-CONTRACT (issue #41 acceptance matrix) ────────────────────────

// Gate: the reporter integration must be in place for these to pass. Flip on
// with CANS_QA_TARGET=1 — that is the QA-12 release gate.
const t = process.env.CANS_QA_TARGET === '1' ? describe : describe.skip;

t('QA-12 target contract (issue #41 acceptance)', () => {
  test('default human output stays within the 500-token budget', () => {
    // Our generated workspace is LARGER than the issue's (2912 vs ~1671 nodes),
    // so ≤ 500 tokens here is stricter than the acceptance criterion.
    expect(estimateTokens(defaultRun.out)).toBeLessThanOrEqual(500);
  });

  test('first line = severity mark + shape + elapsed ms', () => {
    expect(defaultRun.out.split('\n')[0]).toMatch(/^[✓⚠✗] \d+ files · \d+ nodes · depth \d+ · \d+ms$/);
  });

  test('one line per pattern — no per-occurrence repetition', () => {
    // The old reporter printed this exact sentence 61 times.
    expect(defaultRun.out.match(/has 2 children \(min 3\)/g)?.length ?? 0).toBe(0);
    // …the aggregated form carries the count prefix instead.
    expect(defaultRun.out).toContain('61× <min children (2/3)');
    expect(defaultRun.out).toContain('91× missing file');
    expect(defaultRun.out).toContain('115× keyword sprawl');
  });

  test('grouped by root cause — 91 broken refs collapse to 4 missing targets', () => {
    expect(defaultRun.out).toContain('artifacts/governance.yaml (72)');
    expect(defaultRun.out).toContain('artifacts/policy.yaml (16)');
    expect(defaultRun.out).toContain('artifacts/system-schema.yaml (2)');
    expect(defaultRun.out).toContain('artifacts/schema.yaml (1)');
    expect(defaultRun.out.match(/create the file or remove the see: ref/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });

  test('every planted file:line stays present in compact comma lists', () => {
    expect(defaultRun.out).toContain('01-charter:7,47,87,127,167');
    expect(defaultRun.out).toContain('04-budget:2,3,4,5,6,7,8,9');
    expect(defaultRun.out).toContain('02-agent:1');
  });

  test('fix hint appears once per pattern, not per occurrence', () => {
    expect(defaultRun.out.match(/remove the ref-by comment/g)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(defaultRun.out).toContain('← 01-charter, 02-agent');
  });

  test('--json emits the structured sections shape with elapsedMs', () => {
    const parsed = JSON.parse(defaultJson.out) as {
      summary: { files: number; nodes: number; maxDepth: number; elapsedMs: number };
      counts: { errors: number; warnings: number };
      sections: Record<string, Array<{ file: string; line: number; level: string; rule: string; detail: string; suggestion?: string }>>;
      exitCode: number;
    };
    expect(typeof parsed.summary.elapsedMs).toBe('number');
    expect(parsed.summary.files).toBe(13);
    expect(parsed.summary.nodes).toBe(2912);
    expect(parsed.exitCode).toBe(2);
    expect(parsed.counts.errors).toBe(92);
    expect(parsed.counts.warnings).toBe(262);
    for (const name of ['structure', 'style', 'refs', 'redundancy', 'overflow']) {
      expect(Array.isArray(parsed.sections[name])).toBe(true);
    }
    for (const arr of Object.values(parsed.sections)) {
      for (const entry of arr) {
        expect(typeof entry.file).toBe('string');
        expect(typeof entry.line).toBe('number');
        expect(entry.level).toMatch(/^(error|warning)$/);
        expect(entry.rule).toMatch(/^[a-z_]+\.[a-z_.]+$/);
        expect(typeof entry.detail).toBe('string');
      }
    }
    // refs bucket = raw refs-category issues: 91 missing + 1 anchor + 8 stale
    // back-pointers + 1 orphan = 101.
    expect(parsed.sections.refs!.length).toBe(101);
  });

  test('--show redundancy expands the folded keyword group', () => {
    const expanded = runCli(['check', '--show', 'redundancy'], WS_ISSUE);
    expect(expanded.out.length).toBeGreaterThan(defaultRun.out.length);
    // Default folds to the metric-ranked top 5 (node counts in the labels)…
    expect(defaultRun.out).toContain('artifacts:105  yaml:91  db:74  governance:72  api:66');
    // …a 13-occurrence minor keyword is folded out of the default view…
    const minor = `${MINOR_KEYWORDS[0]}:13`;
    expect(defaultRun.out).not.toContain(minor);
    expect(expanded.out).toContain(minor);
    // …and the fold hint counts the hidden occurrences.
    expect(defaultRun.out).toContain('↳ 110 more → cans check --show redundancy');
  });

  test('exit codes: 0 clean · 1 warnings · 2 errors · 2 usage', () => {
    expect(runCli(['check'], WS_CLEAN).exit).toBe(0);
    expect(runCli(['check'], WS_WARN).exit).toBe(1);
    expect(runCli(['check'], WS_ISSUE).exit).toBe(2);
    expect(runCli(['check', '--bogus'], WS_CLEAN).exit).toBe(2);
    expect(runCli(['check', '--show', 'nonsense'], WS_CLEAN).exit).toBe(2);
  });

  test('help documents --show and --json', () => {
    const h = runCli(['help'], WS_CLEAN);
    expect(h.out).toContain('--show <section>');
    expect(h.out).toContain('[--json]');
  });
});
