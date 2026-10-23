/**
 * Issue #52 regression tests — text header ref-broken count must agree with
 * `cans check --json`'s `refs.broken` counter.
 *
 * Defect: `cans check` printed `REFS ✗ 1 broken · ⚠ 54 stale · ✗ 115` while
 * `cans check --json` reported `refs.broken: 113` (112 anchors + 1 file). The
 * `✗ N broken` header part summed ONLY `refs.broken.file` groups; broken
 * ANCHORS (`refs.broken.anchor`) fell into the anonymous `✗ M` residue — so
 * the text's "broken" number disagreed with the only machine counter for it.
 *
 * Fix contract (pinned here):
 *   - the header's `✗ N broken` derives from `result.refs.broken` — the EXACT
 *     counter `--json` emits (refs.broken.file + refs.broken.anchor errors,
 *     src/commands/check.ts) — so text and JSON are structurally incapable of
 *     disagreeing (single source of truth);
 *   - `refs.broken.anchor` groups are subtracted from the anonymous residue
 *     (they are now displayed inside the broken count — no double-counting,
 *     honoring printRefsSection's "no finding is ever hidden or
 *     double-counted" rule);
 *   - arithmetic identity: the sum of all displayed REFS header counts ===
 *     the refs category's errorCount + warningCount (broken + stale + orphan
 *     + deep-hop + errOther residue + warnOther residue);
 *   - unchanged: stale/orphan/deep-hop parts, the clean line
 *     `REFS  ✓ N refs · M/N back-ptrs`, and the `--fix updated ref-by in:`
 *     line.
 *
 * Test map:
 *   a ..... repro shape: 1 broken file ref + 3 broken anchors + 2 self-refs
 *          + 1 stale back-pointer → text `✗ 4 broken · ⚠ 1 stale · ✗ 2`
 *          matching json refs.broken: 4; displayed sum === refs-category
 *          errorCount + warningCount (both from --json)
 *   b ..... pure broken anchors: `✗ N broken` === refs.broken with NO
 *          anonymous `✗ M` residue (the old code printed `✗ 2` — anchors
 *          vanished into the residue with no "broken" label at all)
 *   c ..... clean workspace: the healthy `REFS  ✓ N refs · M/N back-ptrs`
 *          line is unchanged (pinned via the --fix path that surfaces it,
 *          issue #11) and carries no broken part
 *   d ..... mixed refs warnings (orphan + see-like prose + transient ref):
 *          named orphan part unchanged, residue accounting still exact
 *   e ..... deep-hop present: the deep-hop part stays `✗ N deep-hop`,
 *          excluded from broken, and the identity still balances
 *   f ..... identity holds across every scenario above by construction:
 *          sum of header counts === refs-category errors + warnings
 *
 * Spec-file discovery rule (src/core/fs.ts SPEC_FILE_RE `/^\d{2}-.+\.md$/`)
 * respected throughout: broken-anchor refs point at an EXISTING
 * `02-authentication.md` whose anchors don't match; self-refs ref their own
 * file; the missing file ref targets `99-nonexistent.md`.
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { rmSync } from 'fs';

import { spawnCli, REPO } from '../runtime.ts';
import { makeCansWorkspace } from '../helpers.ts';

// ── CLI scaffolding (mirrors test/issues/issue-22.test.ts) ──

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-52');
const createdDirs: string[] = [];

function makeWs(name: string, files: Record<string, string>): { tmp: string; root: string } {
  const tmp = join(SCRATCH, `${name}-${createdDirs.length + 1}`);
  const root = makeCansWorkspace(tmp, files);
  createdDirs.push(tmp);
  return { tmp, root };
}

/** Blackbox CLI spawn, isolated from any ambient CANS_ROOT. */
function runCli(args: string[], cwd: string) {
  return spawnCli(args, cwd, { ...process.env, CANS_ROOT: '' });
}

/** JSON-mode output must be a single JSON document; a parse failure is itself
 *  an assertion failure. Reconstitutes the flat issues view from sections. */
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

/** The `REFS  …` header line from a text `cans check` run (first match). */
function refsHeader(out: string): string {
  const m = out.match(/^REFS  .*$/m);
  expect(m).not.toBeNull();
  return m![0]!;
}

/** Sum of every `✗ N` / `⚠ N` count displayed on the REFS header line —
 *  including the labeled parts (`✗ 4 broken`, `⚠ 1 stale`) and the anonymous
 *  residue parts (`✗ 2` / `⚠ 2`). This is the identity the fix must keep
 *  exact: it always equals the refs category's errorCount + warningCount. */
function headerCountsSum(header: string): number {
  const nums = [...header.matchAll(/[✗⚠] (\d+)/g)].map(m => Number(m[1]));
  expect(nums.length).toBeGreaterThan(0);
  return nums.reduce((a, n) => a + n, 0);
}

afterEach(() => {
  while (createdDirs.length > 0) {
    rmSync(createdDirs.pop()!, { recursive: true, force: true });
  }
});

// ── (a) The issue's repro shape ──────────────────────────────────────────────
// 1 broken FILE ref + 3 broken ANCHOR refs + 2 self-references (other refs
// errors) + 1 stale back-pointer — the reporter's tree in miniature.

const REPRO_FILES = {
  '01-overview.md': [
    '- Overview',
    '  - Auth area: see 02-authentication.md#Sessions',
    '  - Legacy slot: see 99-nonexistent.md',
    '',
  ].join('\n'),
  '02-authentication.md': [
    '- Authentication <!-- ref-by: 09-gone.md -->',
    '  - Sessions',
    '    - Expire after 24 hours',
    '',
  ].join('\n'),
  '03-data.md': [
    '- Data',
    '  - Auth typo anchor: see 02-authentication.md#Nope',
    '  - Loopback: see 03-data.md',
    '',
  ].join('\n'),
  '04-api.md': [
    '- API',
    '  - Auth wrong anchor: see 02-authentication.md#AlsoNope',
    '  - Auth stale anchor: see 02-authentication.md#StillNope',
    '  - Loopback: see 04-api.md',
    '',
  ].join('\n'),
};

describe('issue #52: REFS header broken count === --json refs.broken', () => {
  test('a: repro — 1 broken file + 3 broken anchors → `✗ 4 broken · ⚠ 1 stale · ✗ 2`, sum === refs errors + warnings', () => {
    const ws = makeWs('repro', REPRO_FILES);

    const text = runCli(['check', '--refs-only'], ws.tmp);
    const json = parseJsonOut(runCli(['check', '--refs-only', '--json'], ws.tmp).out);

    // Machine counter first (the single source of truth): 1 file + 3 anchors.
    expect(json.refs.broken).toBe(4);
    // The refs category: 6 errors (4 broken + 2 self) + 1 warning (stale BP).
    const refsErrors = json.issues.filter((i: any) => i.category === 'refs' && i.level === 'error').length;
    const refsWarnings = json.issues.filter((i: any) => i.category === 'refs' && i.level === 'warning').length;
    expect(refsErrors).toBe(6);
    expect(refsWarnings).toBe(1);

    // The text header: broken = the JSON counter (file + anchors together),
    // stale unchanged, residue = the 2 self-references only. Before the fix
    // this printed `✗ 1 broken · ⚠ 1 stale · ✗ 5` (anchors hiding in the
    // residue) — disagreeing with refs.broken: 4 on the same tree.
    expect(refsHeader(text.out)).toBe('REFS  ✗ 4 broken · ⚠ 1 stale · ✗ 2');

    // Arithmetic identity (design rule: nothing hidden, nothing double-counted).
    expect(headerCountsSum(refsHeader(text.out))).toBe(refsErrors + refsWarnings);
    expect(text.exit).toBe(2); // 6 refs errors → error band
  });

  test('b: pure broken anchors — `✗ N broken` === refs.broken, NO anonymous residue', () => {
    const ws = makeWs('anchors-only', {
      '02-authentication.md': '- Authentication\n  - Sessions\n    - Expire after 24 hours\n',
      '04-api.md': '- API\n  - Auth typo anchor: see 02-authentication.md#Nope\n  - Auth wrong anchor: see 02-authentication.md#AlsoNope\n',
    });

    const text = runCli(['check', '--refs-only'], ws.tmp);
    const json = parseJsonOut(runCli(['check', '--refs-only', '--json'], ws.tmp).out);

    expect(json.refs.broken).toBe(2);
    // Old behavior: `REFS  ✗ 2` — the anchors were displayed with NO broken
    // label at all. Now every one of them is inside the broken count.
    const header = refsHeader(text.out);
    expect(header).toBe('REFS  ✗ 2 broken');
    // No anonymous residue: nothing else in the refs category.
    expect(header.match(/✗ \d+$/m)).toBeNull();
    const refsErrors = json.issues.filter((i: any) => i.category === 'refs' && i.level === 'error').length;
    const refsWarnings = json.issues.filter((i: any) => i.category === 'refs' && i.level === 'warning').length;
    expect(headerCountsSum(header)).toBe(refsErrors + refsWarnings);
  });

  test('c: clean workspace — healthy `REFS  ✓ N refs · M/N back-ptrs` line unchanged', () => {
    const ws = makeWs('clean', {
      '01-overview.md': '- Overview\n  - Auth area: see 02-authentication.md#Sessions\n',
      '02-authentication.md': '- Authentication\n  - Sessions\n    - Expire after 24 hours\n',
    });

    // The healthy line surfaces on the --fix run that writes the ref-by mark
    // (issue #11) — pinned verbatim, with no broken part anywhere.
    const fixed = runCli(['check', '--fix', '--refs-only'], ws.tmp);
    expect(fixed.out).toContain('REFS  ✓ 1 refs · 1/1 back-ptrs');
    expect(fixed.out).not.toContain('broken');
    expect(fixed.out).toContain('--fix updated ref-by in: 02-authentication.md');

    const json = parseJsonOut(runCli(['check', '--json'], ws.tmp).out);
    expect(json.refs.broken).toBe(0);
    // A fully clean plain check has no REFS findings at all — nothing regressed.
    const plain = runCli(['check', '--refs-only'], ws.tmp);
    expect(plain.out).not.toContain('broken');
  });

  test('d: mixed refs warnings — orphan named part unchanged, residue accounting exact', () => {
    const ws = makeWs('mixed-warnings', {
      '01-overview.md': '- Overview\n  - Read the runbook: see the runbook\n  - Task ref: see _tasks/add-dark-mode.md\n',
      '02-authentication.md': '- Authentication\n  - Sessions\n    - Expire after 24 hours\n',
      '07-lonely.md': '- Lonely\n  - Island node\n',
    });

    const text = runCli(['check', '--refs-only'], ws.tmp);
    const json = parseJsonOut(runCli(['check', '--refs-only', '--json'], ws.tmp).out);

    // 2 orphans (named part, unchanged) + prose + transient (anonymous
    // warnings residue — refs.other / refs.prose are not named buckets).
    expect(json.refs.broken).toBe(0);
    expect(refsHeader(text.out)).toBe('REFS  ⚠ 2 orphan · ⚠ 2');

    const refsErrors = json.issues.filter((i: any) => i.category === 'refs' && i.level === 'error').length;
    const refsWarnings = json.issues.filter((i: any) => i.category === 'refs' && i.level === 'warning').length;
    expect(refsWarnings).toBe(4);
    expect(refsErrors).toBe(0);
    expect(headerCountsSum(refsHeader(text.out))).toBe(refsErrors + refsWarnings);
  });

  test('e: deep-hop present — `✗ N deep-hop` unchanged, excluded from broken', () => {
    const ws = makeWs('deep-hop', {
      '01-a.md': '- A\n  - Next: see 02-b.md\n',
      '02-b.md': '- B\n  - Next: see 03-c.md\n',
      '03-c.md': '- C\n  - Leaf detail node\n',
    });

    const text = runCli(['check', '--refs-only'], ws.tmp);
    const json = parseJsonOut(runCli(['check', '--refs-only', '--json'], ws.tmp).out);

    expect(json.refs.deepHops).toBe(1);
    expect(json.refs.broken).toBe(0); // the hop chain resolves — nothing broken
    expect(refsHeader(text.out)).toBe('REFS  ✗ 1 deep-hop');

    const refsErrors = json.issues.filter((i: any) => i.category === 'refs' && i.level === 'error').length;
    const refsWarnings = json.issues.filter((i: any) => i.category === 'refs' && i.level === 'warning').length;
    expect(refsErrors).toBe(1);
    expect(headerCountsSum(refsHeader(text.out))).toBe(refsErrors + refsWarnings);
  });

  test('f: identity holds on the full repro shape without --refs-only (all sections printed)', () => {
    // The header derivation must not depend on refsOnly — same workspace,
    // full check: the REFS line is identical and still balances.
    const ws = makeWs('full-check', REPRO_FILES);
    const text = runCli(['check'], ws.tmp);
    const json = parseJsonOut(runCli(['check', '--json'], ws.tmp).out);

    expect(refsHeader(text.out)).toBe('REFS  ✗ 4 broken · ⚠ 1 stale · ✗ 2');
    const refsErrors = json.issues.filter((i: any) => i.category === 'refs' && i.level === 'error').length;
    const refsWarnings = json.issues.filter((i: any) => i.category === 'refs' && i.level === 'warning').length;
    expect(headerCountsSum(refsHeader(text.out))).toBe(refsErrors + refsWarnings);
    expect(json.counts.errors).toBe(6); // all 6 errors are refs errors here
    // Issue #46: see: target tokens no longer ride the redundancy layers —
    // the target-driven "authentication" keyword warning and the 80% overlap
    // between the two "Auth … anchor" pointers are gone (the label-driven
    // "auth" × 4 keyword and the loopback↔loopback 100% overlap remain), so
    // the full check carries 6 errors + 5 warnings = 11.
    expect(json.counts.errors + json.counts.warnings).toBeGreaterThanOrEqual(11); // + structure/redundancy warnings
  });
});
