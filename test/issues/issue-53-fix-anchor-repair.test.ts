/**
 * Issue #53 Part 2.4 regression tests — `cans check --fix` anchor repair.
 *
 * Defect: `--fix` rewrote only ref-by comments and left broken anchors
 * alone even when the intended target was unambiguous — the user had to
 * retype the anchor by hand, exactly the class of typo the fuzzy layer
 * (nearSlugMatches, Part 1.1) can already identify.
 *
 * Fix (transactional, mirroring the ref-by discipline of issues #6/#11/#19/
 * #21): `--fix` PROPOSES pure anchor rewrites in the report; `--fix --yes`
 * APPLIES them; `--fix --dry-run` previews every change (anchors AND ref-by)
 * and writes nothing. A repair happens only when ALL hold:
 *   1. the target file exists and is parseable (loadedKeyFor/resolveSpecFile,
 *      the same resolution path as checkRefs — YAML keys count too),
 *   2. EXACTLY ONE distinct node/key text fuzzy-matches the failing anchor at
 *      ≥ SLUG_SUGGEST_THRESHOLD (0.8) — two siblings one letter apart stay
 *      plain errors, never a coin flip,
 *   3. the fix is a pure anchor substitution in the `see:` token — node text,
 *      and every other byte on the line, is preserved (fence-safe, EOL-safe).
 *
 * Test map:
 *   a–e ... flag surface: --yes/--dry-run gate on --fix (§20 usage errors,
 *          exit 2 via checkFail), help lists them
 *   f–k ... repairAnchors unit: the pure byte-level rewriter (EOL
 *          preservation, raw-token disambiguation, fence guard, edge cases)
 *   l..... unambiguous one-letter-off anchor + em-dash node: plain check →
 *          error exit 2; plain --fix → proposal, referrer bytes unchanged,
 *          ref-by cleanup still writes; --fix --yes → only the anchor
 *          segment changes (full-file byte assert), refs.broken 0, exit < 2
 *   m..... CRLF referrer: every other byte preserved through the repair
 *   n..... --fix --dry-run writes NOTHING (anchors AND ref-by previewed)
 *   o..... ambiguous siblings → no proposal, no rewrite, error stays
 *   p..... unparseable target → skipped cleanly
 *   q..... [file] filter scopes proposals and writes to matched referrers
 *   r..... multiple see: refs on one line → only the broken one's anchor
 *   s..... --json: anchorFixes carries from/to/applied; dryRun when active
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { rmSync, readFileSync } from 'fs';

import { parseCheckArgs } from '../../src/commands/check.ts';
import { spawnCli, REPO } from '../runtime.ts';
import { makeCansWorkspace } from '../helpers.ts';

// ── CLI scaffolding (mirrors test/issues/issue-53-slug-core.test.ts) ──

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-53-fix-anchor-repair');
const createdDirs: string[] = [];

afterEach(() => {
  while (createdDirs.length > 0) {
    rmSync(createdDirs.pop()!, { recursive: true, force: true });
  }
});

/** issue-50.test.ts scaffolding: the CLI runs from the PARENT of cans/ (the
 *  workspace is discovered below cwd); writes target the cans root itself. */
function makeWs(name: string, files: Record<string, string>): { tmp: string; root: string } {
  const tmp = join(SCRATCH, `${name}-${createdDirs.length + 1}`);
  createdDirs.push(tmp);
  const root = makeCansWorkspace(tmp, files);
  return { tmp, root };
}

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

/** Raw bytes of a spec file (byte-level "cmp" evidence, issue #11 style). */
function bytes(root: string, rel: string): Buffer {
  return readFileSync(join(root, rel));
}

// ── Flag surface: --yes / --dry-run gate on --fix (§20) ──

describe('issue #53 2.4: --yes and --dry-run are --fix-gated flags', () => {
  test('a: --yes without --fix is a usage error (exit 2, checkFail diagnosis)', () => {
    const ws = makeWs('flag-yes-alone', {
      '00-overview.md': '- Overview\n  - Scope\n',
    });
    const r = runCli(['check', '--yes'], ws.tmp);
    expect(r.exit).toBe(2);
    expect(r.out).toContain('"--yes" requires --fix');
    expect(r.out).toContain('Run `cans help` for valid check flags.');
  });

  test('b: --dry-run without --fix is a usage error (exit 2)', () => {
    const ws = makeWs('flag-dryrun-alone', {
      '00-overview.md': '- Overview\n  - Scope\n',
    });
    const r = runCli(['check', '--dry-run'], ws.tmp);
    expect(r.exit).toBe(2);
    expect(r.out).toContain('"--dry-run" requires --fix');
    expect(r.out).toContain('Run `cans help` for valid check flags.');
  });

  test('c: --fix --yes --dry-run is a usage error (mutually exclusive)', () => {
    const ws = makeWs('flag-both', {
      '00-overview.md': '- Overview\n  - Scope\n',
    });
    const r = runCli(['check', '--fix', '--yes', '--dry-run'], ws.tmp);
    expect(r.exit).toBe(2);
    expect(r.out).toContain('mutually exclusive');
  });

  test('d: parseCheckArgs carries yes/dryRun and rejects the same shapes (unit)', () => {
    const ok = parseCheckArgs(['--fix', '--yes']);
    expect(ok.errors).toEqual([]);
    expect(ok.fix).toBe(true);
    expect(ok.yes).toBe(true);
    expect(ok.dryRun).toBe(false);
    const dry = parseCheckArgs(['--fix', '--dry-run']);
    expect(dry.errors).toEqual([]);
    expect(dry.yes).toBe(false);
    expect(dry.dryRun).toBe(true);
    // The gate: neither flag means anything without --fix.
    expect(parseCheckArgs(['--yes']).errors.length).toBe(1);
    expect(parseCheckArgs(['--dry-run']).errors.length).toBe(1);
    expect(parseCheckArgs(['--fix', '--yes', '--dry-run']).errors.length).toBe(1);
  });

  test('e: the arg diagnosis precedes workspace resolution (§37: name the real problem)', () => {
    // No cans/ workspace anywhere above the scratch dir — a naked `--yes`
    // must still report the FLAG problem, never the missing workspace.
    const scratch = join(SCRATCH, 'no-ws-flag-order');
    createdDirs.push(scratch);
    rmSync(scratch, { recursive: true, force: true });
    const r = runCli(['check', '--yes'], join(scratch, '..'));
    expect(r.exit).toBe(2);
    expect(r.out).toContain('"--yes" requires --fix');
    expect(r.out).not.toContain('no cans workspace found');
  });

  test('f: help lists the new flags and the --yes/--dry-run semantics', () => {
    const r = runCli(['help'], SCRATCH);
    expect(r.out).toContain('--yes');
    expect(r.out).toContain('--dry-run');
    expect(r.out).toMatch(/--yes.*appl|appl.*--yes/);
  });
});
