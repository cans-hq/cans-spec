/**
 * Issue #11 regression tests (round 6) — "check --fix ignores the [file]
 * filter and rewrites ref-by comments in every spec file".
 *
 * QA-20 (round 6) F19/F25: on the 23156fa line the [file] positional scopes
 * the REPORT and the exit code but not the WRITES — a filtered
 * `cans check --fix <file>` rewrote ref-by marks in EVERY spec file with
 * incoming refs (filtering 01-auth.md also rewrote 03-data.md; filtering the
 * referrer 04-api.md rewrote both of its targets), and neither the JSON nor
 * the human report named the files actually rewritten. The issue #11 fix
 * (reference commit 099e858) was never merged into this line; these tests
 * port its contract onto the issue #19/#21 anchor-aware, byte-preserving
 * rewrite machinery.
 *
 * Scoping semantics (docs §12/§22, pinned here):
 *   - With a [file] filter active, `--fix` rewrites back-pointer marks ONLY
 *     in the spec files the filter matches. The desired-marks map is still
 *     computed from the GLOBAL ref graph (refs stay global by design) — only
 *     the WRITES are scoped.
 *   - A referrer filter (e.g. `04-api.md`) therefore leaves its TARGETS'
 *     marks untouched this run (targets are not filter-matched); the user
 *     re-runs with the target's filter, or unfiltered, to write them.
 *   - Without a filter every spec source is fixable — exactly the QA-20
 *     PASS set (inline anchored placement, standalone file-level placement,
 *     byte-preserving EOL writes, idempotent second runs) must hold.
 *   - Stale back-pointer warnings are dropped ONLY for files the run
 *     actually rewrote: an unfiltered file's stale comment is still on
 *     disk, so it stays stale and stays reported.
 *   - The JSON gains `backPointersUpdatedFiles` (sorted, spec-relative list
 *     of actually-rewritten files); the human report names the rewritten
 *     files as `--fix updated ref-by in: ...` (099e858 wording).
 *   - The [file] filter's scoping of the REPORT and the EXIT CODE (issues
 *     from non-matching files suppressed) is issue-#11-sanctioned behavior
 *     and must NOT change (QA-20 F25 note).
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';

import { spawnCli, REPO } from '../runtime.ts';

// ── CLI-level scaffolding (mirrors test/issues/issue-19.test.ts) ──

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-11-round6');

interface Ws {
  root: string;
  cans: string;
}

const createdDirs: string[] = [];
let wsSeq = 0;

/** Fresh scratch workspace under repo/.tmp/issues/issue-11-round6 (gitignored). */
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

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Raw bytes of a spec file (byte-level "cmp" evidence). */
function bytes(ws: Ws, rel: string): Buffer {
  return readFileSync(join(ws.cans, rel));
}

// The QA-20 e2/e3 shape: 01-auth.md and 03-data.md are both targets of
// anchored refs held by 04-api.md (the referrer).
const AUTH = [
  '- Authentication',
  '  - Sessions',
  '    - Expire after 24 hours',
].join('\n') + '\n';
const DATA = [
  '- Data',
  '  - Storage',
  '    - Postgres primary',
].join('\n') + '\n';
const API = [
  '- API',
  '  - Auth: see 01-auth.md#Sessions',
  '  - Data: see 03-data.md#Storage',
].join('\n') + '\n';

/** The QA-20 e2/e3 workspace: two targets, one referrer, no marks yet. */
function twoTargetsWs(name: string): Ws {
  const ws = makeWs(name);
  writeFileSync(join(ws.cans, '01-auth.md'), AUTH, 'utf8');
  writeFileSync(join(ws.cans, '03-data.md'), DATA, 'utf8');
  writeFileSync(join(ws.cans, '04-api.md'), API, 'utf8');
  return ws;
}

// ── F19: filter on a TARGET file scopes the writes ──

describe('issue #11 (round 6): [file] filter scopes --fix WRITES — F19 target filter', () => {
  test('filtering 01-auth.md rewrites ONLY 01-auth.md; 03-data.md stays byte-identical', () => {
    const ws = twoTargetsWs('f19-target-filter');
    const r = runCli(['check', '--fix', '01-auth.md', '--json'], ws.root);
    const j = parseJsonOut(r.out);

    // Only the filter-matched file was rewritten, and the report says so.
    expect(j.backPointersUpdated).toBe(1);
    expect(j.backPointersUpdatedFiles).toEqual(['01-auth.md']);

    // 01-auth.md got its (issue #19) inline anchored mark.
    expect(readFileSync(join(ws.cans, '01-auth.md'), 'utf-8')).toBe(
      '- Authentication\n  - Sessions <!-- ref-by: 04-api.md -->\n    - Expire after 24 hours\n',
    );

    // 03-data.md was NOT filter-matched: byte-identical to the original —
    // no mark, no EOL minting, nothing.
    expect(bytes(ws, '03-data.md').equals(Buffer.from(DATA, 'utf8'))).toBe(true);
    expect(readFileSync(join(ws.cans, '03-data.md'), 'utf-8')).not.toContain('ref-by');
  });

  test('F19 report/exit scoping is unchanged: issues of non-matching files stay suppressed', () => {
    const ws = twoTargetsWs('f19-report-scoping');
    // Both target files have single-child warnings (2 each). The filter on
    // 01-auth.md scopes the report to that file: 03-data.md's structure
    // warnings must not appear, and the exit code is the filtered file's.
    const r = runCli(['check', '--fix', '01-auth.md', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(1); // warnings (01-auth.md's own) → 1
    const structureFiles = j.issues
      .filter((i: any) => i.category === 'structure')
      .map((i: any) => i.file);
    expect(structureFiles.length).toBeGreaterThan(0);
    expect(structureFiles.every((f: string) => f === '01-auth.md')).toBe(true);
  });

  test('human report names the rewritten files: "--fix updated ref-by in: 01-auth.md"', () => {
    const ws = twoTargetsWs('f19-human-report');
    const r = runCli(['check', '--fix', '01-auth.md'], ws.root);
    expect(r.out).toContain('--fix updated ref-by in: 01-auth.md');
    expect(r.out).not.toContain('03-data.md');
    // The REFS block carries the line even when the refs engine has no
    // findings of its own (the healthy state) — the fix line is what makes
    // the run's writes visible.
    expect(r.out).toMatch(/REFS/);

    // A plain (non-fix) check never prints the line.
    const plain = runCli(['check', '01-auth.md'], ws.root);
    expect(plain.out).not.toContain('--fix updated ref-by in:');
  });

  test('JSON always carries backPointersUpdatedFiles (empty without --fix or when nothing was rewritten)', () => {
    const ws = twoTargetsWs('f19-json-shape');
    const plain = parseJsonOut(runCli(['check', '01-auth.md', '--json'], ws.root).out);
    expect(plain.backPointersUpdated).toBe(0);
    expect(plain.backPointersUpdatedFiles).toEqual([]);
  });
});

// ── F25: filter on the REFERRER scopes the writes (targets untouched) ──

describe('issue #11 (round 6): [file] filter scopes --fix WRITES — F25 referrer filter', () => {
  test('filtering the referrer 04-api.md writes NOTHING; both targets stay byte-identical', () => {
    const ws = twoTargetsWs('f25-referrer-filter');
    const r = runCli(['check', '--fix', '04-api.md', '--json'], ws.root);
    const j = parseJsonOut(r.out);

    // The filter names the referrer; its TARGETS are not filter-matched, so
    // no back-pointer file is rewritten this run.
    expect(j.backPointersUpdated).toBe(0);
    expect(j.backPointersUpdatedFiles).toEqual([]);
    expect(bytes(ws, '01-auth.md').equals(Buffer.from(AUTH, 'utf8'))).toBe(true);
    expect(bytes(ws, '03-data.md').equals(Buffer.from(DATA, 'utf8'))).toBe(true);

    // Issue-#11-sanctioned behavior (QA-20 F25 note): the filter scopes the
    // report + exit code — unfiltered files' warnings are suppressed → 0.
    expect(r.exit).toBe(0);

    // Convergence: an unfiltered --fix (or a run filtered on each target)
    // still writes both marks afterwards.
    const all = parseJsonOut(runCli(['check', '--fix', '--json'], ws.root).out);
    expect(all.backPointersUpdated).toBe(2);
    expect(all.backPointersUpdatedFiles).toEqual(['01-auth.md', '03-data.md']); // sorted
    expect(readFileSync(join(ws.cans, '01-auth.md'), 'utf-8')).toContain('  - Sessions <!-- ref-by: 04-api.md -->');
    expect(readFileSync(join(ws.cans, '03-data.md'), 'utf-8')).toContain('  - Storage <!-- ref-by: 04-api.md -->');
  });

  test('filtering the referrer twice changes zero bytes anywhere; the follow-up unfiltered fix converges once', () => {
    const ws = twoTargetsWs('f25-referrer-idempotent');
    runCli(['check', '--fix', '04-api.md', '--json'], ws.root);
    const afterFirst = [bytes(ws, '01-auth.md'), bytes(ws, '03-data.md'), bytes(ws, '04-api.md')];
    const second = parseJsonOut(runCli(['check', '--fix', '04-api.md', '--json'], ws.root).out);
    expect(second.backPointersUpdated).toBe(0);
    expect(second.backPointersUpdatedFiles).toEqual([]);
    expect(bytes(ws, '01-auth.md').equals(afterFirst[0]!)).toBe(true);
    expect(bytes(ws, '03-data.md').equals(afterFirst[1]!)).toBe(true);
    expect(bytes(ws, '04-api.md').equals(afterFirst[2]!)).toBe(true);

    // One unfiltered run writes both marks; a second unfiltered run is a
    // byte-level no-op (QA-20 F06/F07 idempotency contract, unfiltered).
    const fix = parseJsonOut(runCli(['check', '--fix', '--json'], ws.root).out);
    expect(fix.backPointersUpdated).toBe(2);
    const once = [bytes(ws, '01-auth.md'), bytes(ws, '03-data.md')];
    runCli(['check', '--fix', '--json'], ws.root);
    expect(bytes(ws, '01-auth.md').equals(once[0]!)).toBe(true);
    expect(bytes(ws, '03-data.md').equals(once[1]!)).toBe(true);
  });
});

// ── Filtered-run idempotency + byte preservation of unfiltered files ──

describe('issue #11 (round 6): filtered --fix idempotency and byte preservation', () => {
  test('second filtered --fix run changes zero bytes in the filtered file; the unfiltered CRLF file stays byte-identical through BOTH runs', () => {
    const ws = makeWs('filtered-idempotent-crlf');
    writeFileSync(join(ws.cans, '01-auth.md'), AUTH, 'utf8');
    // 03-data.md is CRLF and also has an incoming anchored ref — the filter
    // never matches it, so its bytes (CRLF included) must survive intact.
    const dataCrlf = '- Data\r\n  - Storage\r\n    - Postgres primary\r\n';
    writeFileSync(join(ws.cans, '03-data.md'), dataCrlf, 'utf8');
    writeFileSync(join(ws.cans, '04-api.md'), API, 'utf8');

    const first = parseJsonOut(runCli(['check', '--fix', '01-auth.md', '--json'], ws.root).out);
    expect(first.backPointersUpdated).toBe(1);
    expect(first.backPointersUpdatedFiles).toEqual(['01-auth.md']);
    const afterFirst = bytes(ws, '01-auth.md');

    const second = parseJsonOut(runCli(['check', '--fix', '01-auth.md', '--json'], ws.root).out);
    expect(second.backPointersUpdated).toBe(0);
    expect(second.backPointersUpdatedFiles).toEqual([]);
    expect(bytes(ws, '01-auth.md').equals(afterFirst)).toBe(true); // zero byte changes
    // Unfiltered file untouched through BOTH runs (cmp evidence).
    expect(bytes(ws, '03-data.md').equals(Buffer.from(dataCrlf, 'utf8'))).toBe(true);
    expect(readFileSync(join(ws.cans, '03-data.md'), 'utf-8')).not.toContain('ref-by');
  });
});

// ── 099e858 semantics: the stale-warning drop is guarded by the rewritten set ──

describe('issue #11 (round 6): unrewritten files keep their stale back-pointer warnings', () => {
  test('a stale mark outside the filter stays stale and stays reported; the comment is still on disk', () => {
    const ws = makeWs('stale-retention');
    writeFileSync(join(ws.cans, '01-auth.md'), AUTH, 'utf8');
    // 03-data.md carries a STALE mark (09-gone.md no longer refs it) and has
    // a real incoming file-level ref from 04-api.md.
    writeFileSync(join(ws.cans, '03-data.md'), '- Data\n<!-- ref-by: 09-gone.md -->\n  - Storage\n    - Postgres primary\n', 'utf8');
    writeFileSync(
      join(ws.cans, '04-api.md'),
      '- API\n  - Auth: see 01-auth.md#Sessions\n  - Data: see 03-data.md\n',
      'utf8',
    );
    const dataBefore = bytes(ws, '03-data.md');

    // Filtered on 01-auth.md: only 01-auth.md is rewritten; 03-data.md's
    // stale comment is still on disk, so its warning must stay in the report.
    const r = runCli(['check', '--fix', '01-auth.md', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(j.backPointersUpdated).toBe(1);
    expect(j.backPointersUpdatedFiles).toEqual(['01-auth.md']);
    const stale = j.issues.filter((i: any) => i.rule === 'refs.backpointer.stale');
    expect(stale.length).toBe(1);
    expect(stale[0]!.file).toBe('03-data.md');
    expect(j.backPointers.stale).toBe(1); // post-fix recount sees it still
    expect(bytes(ws, '03-data.md').equals(dataBefore)).toBe(true); // untouched

    // The filtered file's own stale/fresh state converges: 01-auth got its mark.
    expect(readFileSync(join(ws.cans, '01-auth.md'), 'utf-8')).toContain('  - Sessions <!-- ref-by: 04-api.md -->');

    // An unfiltered --fix then rewrites 03-data.md: warning gone, mark replaced.
    const all = parseJsonOut(runCli(['check', '--fix', '--json'], ws.root).out);
    expect(all.backPointersUpdated).toBe(1);
    expect(all.backPointersUpdatedFiles).toEqual(['03-data.md']);
    const staleAfter = all.issues.filter((i: any) => i.rule === 'refs.backpointer.stale');
    expect(staleAfter).toEqual([]);
    expect(readFileSync(join(ws.cans, '03-data.md'), 'utf-8')).toBe(
      '- Data\n<!-- ref-by: 04-api.md -->\n  - Storage\n    - Postgres primary\n',
    );
  });
});

// ── Unfiltered non-regression: the QA-20 PASS behavior must hold ──

describe('issue #11 (round 6): unfiltered --fix keeps the QA-20 PASS behavior', () => {
  test('unfiltered fix rewrites both targets, names them sorted, and is idempotent (zero byte changes)', () => {
    const ws = twoTargetsWs('unfiltered-nonregression');
    const fix = parseJsonOut(runCli(['check', '--fix', '--json'], ws.root).out);
    expect(fix.backPointersUpdated).toBe(2);
    expect(fix.backPointersUpdatedFiles).toEqual(['01-auth.md', '03-data.md']); // sorted
    expect(readFileSync(join(ws.cans, '01-auth.md'), 'utf-8')).toBe(
      '- Authentication\n  - Sessions <!-- ref-by: 04-api.md -->\n    - Expire after 24 hours\n',
    );
    expect(readFileSync(join(ws.cans, '03-data.md'), 'utf-8')).toBe(
      '- Data\n  - Storage <!-- ref-by: 04-api.md -->\n    - Postgres primary\n',
    );
    const once = [bytes(ws, '01-auth.md'), bytes(ws, '03-data.md')];
    const second = parseJsonOut(runCli(['check', '--fix', '--json'], ws.root).out);
    expect(second.backPointersUpdated).toBe(0);
    expect(second.backPointersUpdatedFiles).toEqual([]);
    expect(bytes(ws, '01-auth.md').equals(once[0]!)).toBe(true);
    expect(bytes(ws, '03-data.md').equals(once[1]!)).toBe(true);
  });

  test('unfiltered human report names ALL rewritten files, comma-separated and sorted', () => {
    const ws = twoTargetsWs('unfiltered-human-names');
    const r = runCli(['check', '--fix'], ws.root);
    expect(r.out).toContain('--fix updated ref-by in: 01-auth.md, 03-data.md');
  });
});

// ── Folder-mode scoping (099e858 test family) ──

describe('issue #11 (round 6): folder-mode filter scoping', () => {
  test('filtering the folder form 04-api rewrites only 04-api/index.md; the flat target stays untouched', () => {
    const ws = makeWs('folder-mode');
    writeFileSync(join(ws.cans, '01-auth.md'), AUTH, 'utf8');
    mkdirSync(join(ws.cans, '04-api'), { recursive: true });
    const apiOne = '- API\n  - Auth: see 01-auth.md#Sessions\n';
    writeFileSync(join(ws.cans, '04-api', 'index.md'), apiOne, 'utf8');

    // Filter on the folder form (no .md, no /index.md): matches 04-api/index.md.
    const r = runCli(['check', '--fix', '04-api', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).not.toBe(2); // filter matched — no check-fail
    // The referrer is the filter match; its target 01-auth.md is not — no writes.
    expect(j.backPointersUpdated).toBe(0);
    expect(j.backPointersUpdatedFiles).toEqual([]);
    expect(bytes(ws, '01-auth.md').equals(Buffer.from(AUTH, 'utf8'))).toBe(true);

    // Filtering the TARGET by its flat spelling writes only the target. The
    // referrer is a folder-mode file: the mark body names the loaded key
    // `04-api/index.md` (issue #22 grouping invariant), never a raw form.
    const t = runCli(['check', '--fix', '01-auth.md', '--json'], ws.root);
    const tj = parseJsonOut(t.out);
    expect(tj.backPointersUpdated).toBe(1);
    expect(tj.backPointersUpdatedFiles).toEqual(['01-auth.md']);
    expect(readFileSync(join(ws.cans, '01-auth.md'), 'utf-8')).toContain('  - Sessions <!-- ref-by: 04-api/index.md -->');
    expect(readFileSync(join(ws.cans, '04-api', 'index.md'), 'utf-8')).toBe(apiOne); // untouched
  });
});
