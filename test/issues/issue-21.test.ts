/**
 * Issue #21 regression tests — "fix mixed line endings crlf".
 *
 * `cans check --fix` inserted the `<!-- ref-by: … -->` line with a hard-coded
 * `\n` and re-joined the whole file with `\n` (split('\n') / join('\n')), so
 * any CRLF spec file that received a back-pointer became MIXED line endings:
 * the original lines kept `\r\n`, the inserted comment line ended with a
 * bare `\n`. No warning fired — the parser strips `\r` (normalizeEol, §45),
 * so `cans check` stayed green on the corrupted file: silent by construction.
 *
 * Contracts under test (documented in docs/cans.architecture.md §22):
 *   - Byte-preserving --fix writes: every ORIGINAL line keeps its own
 *     terminator (CRLF or LF); a line whose comment content is replaced or
 *     stripped keeps its terminator; a dropped line disappears WITH its
 *     terminator.
 *   - INSERTED lines (fresh ref-by comment lines) use the file's dominant
 *     EOL — CRLF files get a CRLF comment line, LF files an LF one.
 *   - Inline anchored marks (issue #19) never touch the line's terminator.
 *   - Idempotent: a second --fix run leaves the file byte-identical.
 *
 * All assertions are BYTE-level (readFileSync + exact string / Buffer
 * comparison, or EOL-scanning regexes) — a text-level .toContain would pass
 * on corrupted output.
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';

import { rewriteRefBy } from '../../src/commands/check.ts';
import { spawnCli, REPO } from '../runtime.ts';

// ── byte-level helpers ──

/** True when every `\n` in `s` is preceded by `\r` (fully CRLF, no bare LF). */
function allLinesCrlf(s: string): boolean {
  return !/(?<!\r)\n/.test(s);
}

/** True when `s` contains no `\r` at all (fully LF). */
function allLinesLf(s: string): boolean {
  return !s.includes('\r');
}

// ── CLI-level scaffolding (mirrors test/issues/issue-1.test.ts) ──

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-21');

interface Ws {
  root: string;
  cans: string;
}

const createdDirs: string[] = [];
let wsSeq = 0;

/** Fresh scratch workspace under repo/.tmp/issues/issue-21 (gitignored). */
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

// ── Unit: rewriteRefBy preserves per-line terminators ──

describe('issue #21: rewriteRefBy is EOL-preserving (unit)', () => {
  test('insertion into a CRLF file uses CRLF for the inserted line (byte-exact)', () => {
    const src = '- API\r\n  - Bearer token required\r\n  - Rate limited per key\r\n';
    const out = rewriteRefBy(src, '00-overview.md');
    expect(out).toBe('- API\r\n<!-- ref-by: 00-overview.md -->\r\n  - Bearer token required\r\n  - Rate limited per key\r\n');
    expect(allLinesCrlf(out)).toBe(true);
  });

  test('insertion into an LF file stays pure LF (byte-exact)', () => {
    const src = '- API\n  - Bearer token required\n  - Rate limited per key\n';
    const out = rewriteRefBy(src, '00-overview.md');
    expect(out).toBe('- API\n<!-- ref-by: 00-overview.md -->\n  - Bearer token required\n  - Rate limited per key\n');
    expect(allLinesLf(out)).toBe(true);
  });

  test('replace path: a rewritten comment on a CRLF line keeps the CR LF terminator', () => {
    const src = '- API <!-- ref-by: 99-gone.md -->\r\n  - Bearer token required\r\n';
    const out = rewriteRefBy(src, '00-overview.md');
    expect(out).toBe('- API <!-- ref-by: 00-overview.md -->\r\n  - Bearer token required\r\n');
    expect(allLinesCrlf(out)).toBe(true);
  });

  test('strip path: a stale comment on a CRLF bullet keeps the bullet and its \\r\\n', () => {
    const src = '- API <!-- ref-by: 99-gone.md -->\r\n  - Bearer token required\r\n';
    const out = rewriteRefBy(src, null);
    expect(out).toBe('- API\r\n  - Bearer token required\r\n');
    expect(allLinesCrlf(out)).toBe(true);
  });

  test('drop path: a bare stale comment line on CRLF vanishes with its terminator', () => {
    const src = '- API\r\n<!-- ref-by: 99-gone.md -->\r\n  - Bearer token required\r\n';
    const out = rewriteRefBy(src, null);
    expect(out).toBe('- API\r\n  - Bearer token required\r\n');
    expect(allLinesCrlf(out)).toBe(true);
  });

  test('anchored inline mark (issue #19) on a CRLF file leaves terminators untouched', () => {
    const src = '- Authentication\r\n  - Sessions\r\n    - Expire after 24 hours\r\n';
    const out = rewriteRefBy(src, null, [{ line: 2, body: '02-api.md' }]);
    expect(out).toBe('- Authentication\r\n  - Sessions <!-- ref-by: 02-api.md -->\r\n    - Expire after 24 hours\r\n');
    expect(allLinesCrlf(out)).toBe(true);
  });

  test('CRLF file with no trailing newline: insertion adds the dominant EOL, no stray bytes', () => {
    const src = '- API\r\n  - Bearer token required'; // unterminated last line
    const out = rewriteRefBy(src, '00-overview.md');
    // The inserted line goes after the first root bullet (not at EOF) here.
    expect(out).toBe('- API\r\n<!-- ref-by: 00-overview.md -->\r\n  - Bearer token required');
    expect(allLinesCrlf(out)).toBe(true);
  });

  test('LF file with no trailing newline: append-at-EOF gains an LF separator, not CRLF', () => {
    const src = 'Intro prose.\n\n```md\n- fake bullet\n```\n\nOutro prose.'; // no root bullet → append at EOF
    const out = rewriteRefBy(src, '02-y.md');
    expect(out.endsWith('\n<!-- ref-by: 02-y.md -->')).toBe(true);
    expect(allLinesLf(out)).toBe(true);
  });

  test('mixed-EOL file: original lines keep their own terminators; the inserted line uses the dominant one', () => {
    // 2 CRLF lines vs 1 LF line → dominant CRLF.
    const src = '- API\r\n  - Bearer token required\r\n  - Rate limited per key\n';
    const out = rewriteRefBy(src, '00-overview.md');
    const lines = out.split('\n');
    expect(lines[0]).toBe('- API\r');
    expect(lines[1]).toBe('<!-- ref-by: 00-overview.md -->\r'); // dominant CRLF
    expect(lines[2]).toBe('  - Bearer token required\r');
    expect(lines[3]).toBe('  - Rate limited per key');
    // Per-line preservation: the originally-LF line is still LF-terminated.
    expect(out).toBe('- API\r\n<!-- ref-by: 00-overview.md -->\r\n  - Bearer token required\r\n  - Rate limited per key\n');
  });

  test('idempotent: applying the same rewrite twice is byte-stable on CRLF input', () => {
    const src = '- API\r\n  - Bearer token required\r\n';
    const once = rewriteRefBy(src, '00-overview.md');
    const twice = rewriteRefBy(once, '00-overview.md');
    expect(twice).toBe(once);
  });
});

// ── CLI blackbox: byte-level end-to-end ──

describe('issue #21: check --fix end-to-end (CLI blackbox, bytes)', () => {
  test('repro: CRLF spec file stays FULLY CRLF after --fix writes its back-pointer', () => {
    const ws = makeWs('repro-crlf');
    writeFileSync(join(ws.cans, '00-overview.md'), '- Overview\r\n  - API rules: see 01-api.md\r\n');
    writeFileSync(join(ws.cans, '01-api.md'), '- API\r\n  - Bearer token required\r\n  - Rate limited per key\r\n');

    const r = runCli(['check', '--fix', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(j.backPointersUpdated).toBe(1);

    // BYTE-EXACT: the comment line ends \r\n exactly like every original line.
    const bytes = readFileSync(join(ws.cans, '01-api.md'));
    expect(bytes.toString('binary')).toBe(
      '- API\r\n<!-- ref-by: 00-overview.md -->\r\n  - Bearer token required\r\n  - Rate limited per key\r\n',
    );
    expect(allLinesCrlf(bytes.toString('utf-8'))).toBe(true); // no bare \n anywhere
    // The referrer file is untouched, still CRLF.
    expect(allLinesCrlf(readFileSync(join(ws.cans, '00-overview.md'), 'utf-8'))).toBe(true);
  });

  test('the same workspace with LF files stays fully LF', () => {
    const ws = makeWs('repro-lf');
    writeFileSync(join(ws.cans, '00-overview.md'), '- Overview\n  - API rules: see 01-api.md\n');
    writeFileSync(join(ws.cans, '01-api.md'), '- API\n  - Bearer token required\n  - Rate limited per key\n');

    const r = runCli(['check', '--fix', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(j.backPointersUpdated).toBe(1);
    expect(readFileSync(join(ws.cans, '01-api.md'), 'utf-8')).toBe(
      '- API\n<!-- ref-by: 00-overview.md -->\n  - Bearer token required\n  - Rate limited per key\n',
    );
    expect(allLinesLf(readFileSync(join(ws.cans, '01-api.md'), 'utf-8'))).toBe(true);
  });

  test('replace path on a CRLF file: the replaced line keeps its \\r\\n (no mixed endings)', () => {
    const ws = makeWs('replace-crlf');
    // 01-api.md already carries a stale mark; the ref is live, so --fix REPLACES
    // the comment content on that line instead of inserting a new one.
    writeFileSync(join(ws.cans, '00-overview.md'), '- Overview\r\n  - API rules: see 01-api.md\r\n');
    writeFileSync(
      join(ws.cans, '01-api.md'),
      '- API <!-- ref-by: 99-gone.md -->\r\n  - Bearer token required\r\n',
    );

    const r = runCli(['check', '--fix', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(j.backPointersUpdated).toBe(1);
    const after = readFileSync(join(ws.cans, '01-api.md'), 'utf-8');
    expect(after).toBe('- API <!-- ref-by: 00-overview.md -->\r\n  - Bearer token required\r\n');
    expect(allLinesCrlf(after)).toBe(true);
  });

  test('stale strip + drop on a CRLF file leaves clean CRLF bytes', () => {
    const ws = makeWs('strip-crlf');
    // No live ref → the mark is stale: stripped from the bullet, and the bare
    // comment line is dropped entirely.
    writeFileSync(join(ws.cans, '00-overview.md'), '- Overview\r\n  - Own rules inline\r\n');
    writeFileSync(
      join(ws.cans, '01-api.md'),
      '- API <!-- ref-by: 99-gone.md -->\r\n<!-- ref-by: 98-other.md -->\r\n  - Bearer token required\r\n',
    );

    runCli(['check', '--fix', '--json'], ws.root);
    const after = readFileSync(join(ws.cans, '01-api.md'), 'utf-8');
    expect(after).toBe('- API\r\n  - Bearer token required\r\n');
    expect(allLinesCrlf(after)).toBe(true);
  });

  test('anchored ref into a CRLF file: inline mark keeps the node-line CRLF terminator', () => {
    const ws = makeWs('anchored-crlf');
    // §12 anchor convention: hyphens ↔ spaces, so #Bearer-token-required
    // names the node "Bearer token required".
    writeFileSync(join(ws.cans, '00-overview.md'), '- Overview\r\n  - API rules: see 01-api.md#Bearer-token-required\r\n');
    writeFileSync(
      join(ws.cans, '01-api.md'),
      '- API\r\n  - Bearer token required\r\n  - Rate limited per key\r\n',
    );

    const r = runCli(['check', '--fix', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(j.backPointersUpdated).toBe(1);
    const after = readFileSync(join(ws.cans, '01-api.md'), 'utf-8');
    expect(after).toBe('- API\r\n  - Bearer token required <!-- ref-by: 00-overview.md -->\r\n  - Rate limited per key\r\n');
    expect(allLinesCrlf(after)).toBe(true);
  });

  test('--fix is idempotent on CRLF files (second run: no writes, bytes identical)', () => {
    const ws = makeWs('idempotent-crlf');
    writeFileSync(join(ws.cans, '00-overview.md'), '- Overview\r\n  - API rules: see 01-api.md\r\n');
    writeFileSync(join(ws.cans, '01-api.md'), '- API\r\n  - Bearer token required\r\n  - Rate limited per key\r\n');

    runCli(['check', '--fix', '--json'], ws.root);
    const once = readFileSync(join(ws.cans, '01-api.md'));
    const second = parseJsonOut(runCli(['check', '--fix', '--json'], ws.root).out);
    expect(second.backPointersUpdated).toBe(0);
    expect(readFileSync(join(ws.cans, '01-api.md')).equals(once)).toBe(true);
  });

  test('a CRLF file already carrying the correct comment stays byte-identical under check', () => {
    const ws = makeWs('already-marked-crlf');
    writeFileSync(join(ws.cans, '00-overview.md'), '- Overview\r\n  - API rules: see 01-api.md\r\n');
    writeFileSync(
      join(ws.cans, '01-api.md'),
      '- API\r\n<!-- ref-by: 00-overview.md -->\r\n  - Bearer token required\r\n',
    );

    const r = runCli(['check', '--fix', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(j.backPointersUpdated).toBe(0); // nothing to rewrite
    expect(j.backPointers.current).toBe(1);
    expect(readFileSync(join(ws.cans, '01-api.md'), 'utf-8')).toBe(
      '- API\r\n<!-- ref-by: 00-overview.md -->\r\n  - Bearer token required\r\n',
    );
  });
});
