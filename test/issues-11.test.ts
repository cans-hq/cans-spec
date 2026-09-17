/**
 * Issue #11 regression tests — `cans check --fix` must honor the [file] filter.
 *
 * Reported bug: `cans check 02-b.md --fix` rewrote `<!-- ref-by: ... -->`
 * comments in EVERY spec file instead of only the files matched by the
 * [file] positional — e.g. it inserted `<!-- ref-by: 03-c.md -->` into
 * 01-a.md although the user scoped the run to 02-b.md. The post-fix report
 * also unconditionally dropped ALL stale back-pointer warnings, hiding the
 * ones in files the run never touched.
 *
 * Contract pinned here (issue #11 Expected, §20/§22 semantics):
 *   - --fix with [file] writes ONLY into files matched by the filter (refs
 *     stay global — only the ref-by WRITES are scoped);
 *   - files the run did not rewrite keep their stale back-pointer warnings;
 *   - the report names the files actually rewritten:
 *     `backPointersUpdatedFiles` (JSON, sorted spec-relative paths) and a
 *     `--fix updated ref-by in: ...` line in human output; help documents it;
 *   - unfiltered `--fix` (and `cans done`, which fixes with file: null)
 *     behaves exactly as before.
 *
 * Method: blackbox CLI spawn (same harness as the qa-verify tests) from a
 * scratch workspace under .tmp/issues-11/ (gitignored).
 */
import { describe, test, expect, afterAll } from './testing.ts';
import { join, dirname } from 'path';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';

import { spawnCli, REPO } from './runtime.ts';

const SCRATCH_ROOT = join(REPO, '.tmp', 'issues-11');

/** The issue's exact repro files: 01-a see:s 02-b, 03-c see:s 01-a. */
const A = '- File A\n  - see: 02-b.md\n';
const B = '- File B\n  - Intro\n';
const C = '- File C\n  - see: 01-a.md\n';
/** 01-a.md seeded with a stale ref-by comment (09-gone.md does not exist). */
const A_STALE = '- File A <!-- ref-by: 09-gone.md -->\n  - see: 02-b.md\n';
const Z = '- Z\n  - Detail\n';

interface CheckJson {
  ok: boolean;
  command: string;
  exitCode: number;
  backPointers: { total: number; current: number; stale: number };
  issues: Array<{ file: string; line: number; level: string; category: string; message: string }>;
  errorCount: number;
  warningCount: number;
  backPointersUpdated: number;
  backPointersUpdatedFiles: string[];
}

/** Scratch workspace with a `cans/` dir pre-populated from `files`.
 *  Any leftover from an earlier (crashed) run is wiped first — every test
 *  starts from exactly the files it passes. */
function makeWs(name: string, files: Record<string, string>): string {
  const ws = join(SCRATCH_ROOT, name);
  rmSync(ws, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    const p = join(ws, 'cans', rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return ws;
}

function specText(ws: string, rel: string): string {
  return readFileSync(join(ws, 'cans', rel), 'utf-8');
}

function checkJson(ws: string, args: string[] = []): CheckJson {
  const res = spawnCli(['check', '--json', ...args], ws);
  return JSON.parse(res.out) as CheckJson;
}

afterAll(() => {
  rmSync(SCRATCH_ROOT, { recursive: true, force: true });
});

describe('issue #11 — check --fix honors the [file] filter', () => {
  // Premise pin (green before AND after the fix): the issue's arg order is a
  // valid §20 invocation — one positional + boolean flags, in any order.
  test('premise: parseCheckArgs accepts ["02-b.md", "--fix"] (positional + flag, any order)', async () => {
    const { parseCheckArgs } = await import('../src/commands/check.ts');
    const parsed = parseCheckArgs(['02-b.md', '--fix']);
    expect(parsed.errors).toEqual([]);
    expect(parsed.file).toBe('02-b.md');
    expect(parsed.fix).toBe(true);
  });

  // THE issue repro: 01-a see:s 02-b; 03-c see:s 01-a. Scoping to 02-b.md must
  // write 02-b.md's missing ref-by comment and NOTHING else — pre-fix, the run
  // also inserted `<!-- ref-by: 03-c.md -->` into 01-a.md.
  test('scoped --fix (02-b.md) writes ONLY the matched file — 01-a.md/03-c.md untouched on disk', () => {
    const ws = makeWs('repro-scoped', { '01-a.md': A, '02-b.md': B, '03-c.md': C });
    const json = checkJson(ws, ['02-b.md', '--fix']);
    // the matched file gets its missing ref-by comment …
    expect(specText(ws, '02-b.md')).toContain('ref-by: 01-a.md');
    // … and nothing leaks into files outside the filter (exact content pins)
    expect(specText(ws, '01-a.md')).toBe(A);
    expect(specText(ws, '03-c.md')).toBe(C);
    // report: exactly the files actually rewritten, count === writes
    expect(json.backPointersUpdatedFiles).toEqual(['02-b.md']);
    expect(json.backPointersUpdated).toBe(1);
    // §35 post-fix recompute stays global: 02-b's fresh comment is current;
    // 01-a's still-missing comment is not a stale warning (comments only).
    expect(json.backPointers).toEqual({ total: 1, current: 1, stale: 0 });
  });

  // Second half of the issue: a stale ref-by comment in a NON-matched file
  // must survive the run — on disk AND in the report. Pre-fix, the run rewrote
  // 01-a.md (replacing the stale comment) and dropped its stale warning.
  test('scoped --fix keeps the stale back-pointer warning of a non-matched file', () => {
    const ws = makeWs('repro-stale-kept', { '01-a.md': A_STALE, '02-b.md': B, '03-c.md': C });
    const json = checkJson(ws, ['02-b.md', '--fix']);
    // 01-a.md was NOT rewritten: the stale comment is still on disk …
    expect(specText(ws, '01-a.md')).toBe(A_STALE);
    // … so its stale back-pointer warning MUST still be in the report.
    expect(
      json.issues.some(
        i => i.category === 'refs' && i.message.startsWith('stale back-pointer: 09-gone.md no longer refs 01-a.md'),
      ),
    ).toBe(true);
    expect(json.backPointers.stale).toBe(1);
  });

  // Unfiltered --fix is unchanged: writes happen wherever needed, and the new
  // report field lists every rewritten file.
  test('unfiltered --fix still rewrites every stale file — and reports all of them, sorted', () => {
    const ws = makeWs('unfiltered-fix', { '01-a.md': A_STALE, '02-b.md': B, '03-c.md': C });
    const json = checkJson(ws, ['--fix']);
    expect(json.backPointersUpdated).toBe(2);
    expect(json.backPointersUpdatedFiles).toEqual(['01-a.md', '02-b.md']); // sorted, spec-relative
    expect(specText(ws, '01-a.md')).toContain('ref-by: 03-c.md');
    expect(specText(ws, '01-a.md')).not.toContain('09-gone.md');
    expect(specText(ws, '02-b.md')).toContain('ref-by: 01-a.md');
    expect(specText(ws, '03-c.md')).toBe(C);
    // §35 post-fix state: the recompute stays global — everything current now.
    expect(json.backPointers).toEqual({ total: 2, current: 2, stale: 0 });
  });

  // backPointersUpdatedFiles carries spec-relative paths (folder mode: the
  // workspace key, never an absolute path), sorted.
  test('backPointersUpdatedFiles holds sorted spec-relative paths (folder mode included)', () => {
    const ws = makeWs('folder-relative', {
      '01-a.md': '- File A\n  - see: 04-z.md\n  - see: 02-sub.md\n',
      '02-sub/index.md': '- Sub\n  - Detail\n',
      '04-z.md': Z,
    });
    const json = checkJson(ws, ['--fix']);
    expect(json.backPointersUpdatedFiles).toEqual(['02-sub/index.md', '04-z.md']);
    for (const f of json.backPointersUpdatedFiles) {
      expect(f.startsWith('/')).toBe(false);
      expect(f).toMatch(/^(\d{2}-[^/]+\.md|\d{2}-[^/]+\/index\.md)$/);
    }
  });

  // targetMatchesKey equivalence extends to the fix scope: filtering on
  // `02-sub.md` matches the folder-mode spec `02-sub/index.md` — and only that.
  test('a folder-mode [file] filter scopes the fix to the matching index.md', () => {
    const ws = makeWs('folder-scoped', {
      '01-a.md': '- File A\n  - see: 04-z.md\n  - see: 02-sub.md\n',
      '02-sub/index.md': '- Sub\n  - Detail\n',
      '04-z.md': Z,
    });
    const json = checkJson(ws, ['02-sub.md', '--fix']);
    expect(specText(ws, '02-sub/index.md')).toContain('ref-by: 01-a.md');
    expect(specText(ws, '04-z.md')).toBe(Z); // outside the filter — untouched
    expect(json.backPointersUpdatedFiles).toEqual(['02-sub/index.md']);
    expect(json.backPointersUpdated).toBe(1);
  });

  // The new JSON field is always present: [] without --fix and when a re-run
  // of the same fix finds nothing left to write (idempotence).
  test('check --json always carries backPointersUpdatedFiles ([] without writes; idempotent re-fix)', () => {
    const ws = makeWs('json-field', { '01-a.md': A, '02-b.md': B, '03-c.md': C });
    const plain = checkJson(ws, []);
    expect(plain.backPointersUpdatedFiles).toEqual([]);
    expect(plain.backPointersUpdated).toBe(0);
    const first = checkJson(ws, ['02-b.md', '--fix']);
    expect(first.backPointersUpdatedFiles).toEqual(['02-b.md']);
    const second = checkJson(ws, ['02-b.md', '--fix']);
    expect(second.backPointersUpdatedFiles).toEqual([]);
    expect(second.backPointersUpdated).toBe(0);
  });

  // Human surface: the References section names the files --fix rewrote.
  test('human output shows the files --fix updated under References', () => {
    const ws = makeWs('human-fix-line', { '01-a.md': A, '02-b.md': B, '03-c.md': C });
    const first = spawnCli(['check', '02-b.md', '--fix'], ws);
    expect(first.out).toContain('--fix updated ref-by in: 02-b.md');
    // Second run writes nothing → no --fix line (and no empty-list noise).
    const second = spawnCli(['check', '02-b.md', '--fix'], ws);
    expect(second.out).not.toContain('--fix updated ref-by in:');
  });

  // Help documents the scoping so the behavior is discoverable.
  test('help documents that --fix + [file] rewrites matching files only', () => {
    const res = spawnCli(['help'], REPO);
    // the pinned §36 usage line is untouched …
    expect(res.out).toContain('check [--fix] [--strict] [--refs-only] [--no-redundancy] [file] [--json]');
    // … and the new usage note sits right beneath it.
    expect(res.out).toContain('rewrites ref-by comments in matching files only');
  });
});
