/**
 * Issue #64 — TOML schematic parser false parse-error on valid \n escapes in
 * basic strings (follow-up to #58).
 *
 * The bug: scanQuoted collected the raw body of a basic string (escapes still
 * intact) and decoded it at return (`\n` → a real newline character);
 * tomlValue then ran `q.value.includes('\n')` on the DECODED value. A genuine
 * raw newline can never reach that check — the value text is per-line, so a
 * real one dies earlier as 'unterminated basic string' — meaning the only
 * strings it rejected were VALID ones carrying `\n` / `\u000A` escapes, and
 * every #anchor into such a file false-failed as refs.anchor.parse-error
 * (tomllib parses these fine).
 *
 * The fix: scanQuoted now reports `rawNewline` (did the RAW body contain a
 * real newline, escapes intact) and tomlValue tests that — never the decoded
 * value. Literal strings never decoded; their check moved to the same flag
 * with identical behavior.
 *
 * The checker contract pinned here (the four numbered points from the issue):
 *   1. a basic string holding ONLY escape sequences (\n, \t, \u000A, \", \\)
 *      parses, and anchors into that file verify normally
 *   2. a genuine raw newline inside a single-line basic string still errors
 *      (via the existing 'unterminated basic string' path)
 *   3. a parse error in one value still blocks anchors into that file —
 *      but only for files that are actually malformed
 *   4. no change to file-level refs, JSON/YAML anchors, or the
 *      ambiguous/broken-anchor verdicts from #58
 *
 * Test map:
 *   e1-e4   parser level: the full escape set parses with tomllib-identical
 *           decoded values (incl. trailing comments, arrays, inline tables);
 *           \u000A parses; literal strings stay raw; JSON/YAML untouched
 *   r1      the issue's exact mini repro parses and all four anchors verify
 *   x1-x2   genuine raw newline → unterminated basic string, at the parser
 *           AND at the pointer site (contract 2)
 *   m1      actually malformed TOML still → refs.anchor.parse-error
 *           (contract 3) — while the escape file next to it stays clean
 *   v1-v3   the #58 verdicts unchanged on escape-bearing files: file-level
 *           refs stay clean, ambiguous stays ambiguous, broken stays broken
 *           (contract 4)
 *   c1      CLI end-to-end: the repro workspace checks clean (exit 0)
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { rmSync } from 'fs';
import { join } from 'path';

import { parseToml, parseSchematic, resolveSchematicAnchor } from '../../src/core/schematic.ts';
import { parseOutline } from '../../src/core/outline.ts';
import { buildRefGraph, checkRefs } from '../../src/core/refs.ts';
import type { OutlineNode } from '../../src/types.ts';
import { spawnCli, REPO } from '../runtime.ts';
import { makeCansWorkspace } from '../helpers.ts';

// ── Scaffolding (mirrors test/issues/issue-58-anchors.test.ts) ──

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-64');
const createdDirs: string[] = [];

function makeWs(name: string, files: Record<string, string>): { tmp: string; root: string } {
  const tmp = join(SCRATCH, `${name}-${createdDirs.length + 1}`);
  const root = makeCansWorkspace(tmp, files);
  createdDirs.push(tmp);
  return { tmp, root };
}

function loadFiles(spec: Record<string, string>): Map<string, OutlineNode[]> {
  const map = new Map<string, OutlineNode[]>();
  for (const [name, body] of Object.entries(spec)) map.set(name, parseOutline(body, name));
  return map;
}

function checkAnchors(spec: string, files: Record<string, string>) {
  const ws = makeWs(`ws-${createdDirs.length + 1}`, { '00-overview.md': spec, ...files });
  const loaded = loadFiles({ '00-overview.md': spec });
  return checkRefs(loaded, buildRefGraph(loaded, ws.root), ws.root);
}

function scalarOf(p: Extract<ReturnType<typeof parseToml>, { ok: true }>, key: string): unknown {
  const e = p.root.kind === 'object' ? p.root.entries.find(x => x.key === key) : undefined;
  return e && e.value.kind === 'scalar' ? e.value.value : undefined;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    rmSync(createdDirs.pop()!, { recursive: true, force: true });
  }
});

// ── Parser level: escapes parse, values decode like tomllib (contract 1) ──

describe('issue #64: parseToml — escapes in single-line basic strings are valid TOML', () => {
  test('e1: the full escape set parses; decoded values are tomllib-identical', () => {
    const p = parseToml([
      'note = "line1\\nline2"  # a trailing comment must survive too',
      'tabbed = "a\\tb"',
      'uni = "a\\u000Ab"',
      'quoted = "say \\"hi\\""',
      'winpath = "C:\\\\Users"',
    ].join('\n'));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(scalarOf(p, 'note')).toBe('line1\nline2'); // REAL newline — from the escape, not the source
    expect(scalarOf(p, 'tabbed')).toBe('a\tb');
    expect(scalarOf(p, 'uni')).toBe('a\nb'); // \u000A → LF, same as \n
    expect(scalarOf(p, 'quoted')).toBe('say "hi"');
    expect(scalarOf(p, 'winpath')).toBe('C:\\Users');
  });

  test('e2: escapes inside multi-line arrays and inline tables (scanQuoted is shared)', () => {
    const p = parseToml([
      'arr = [',
      '  "a\\nb",',
      '  "c\\td",  # comment inside the array',
      ']',
      't = { u = "x\\ny" }',
    ].join('\n'));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const arr = p.root.kind === 'object' ? p.root.entries.find(x => x.key === 'arr') : undefined;
    expect(arr !== undefined && arr.value.kind === 'array'
      ? arr.value.items.map(i => (i.kind === 'scalar' ? i.value : null)) : null)
      .toEqual(['a\nb', 'c\td']);
    const t = p.root.kind === 'object' ? p.root.entries.find(x => x.key === 't') : undefined;
    const u = t && t.value.kind === 'object' ? t.value.entries.find(x => x.key === 'u') : undefined;
    expect(u && u.value.kind === 'scalar' ? u.value.value : null).toBe('x\ny');
  });

  test('e3: literal strings still never decode — \\n stays two raw characters', () => {
    const p = parseToml("lit = 'a\\nb'");
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(scalarOf(p, 'lit')).toBe('a\\nb'); // backslash-n, NOT a newline
  });

  test('e4: JSON and YAML escape decoding is untouched by the fix (contract 4)', () => {
    const j = parseSchematic('json', '{"k": "a\\nb"}');
    expect(j.ok).toBe(true);
    if (j.ok) {
      const e = j.root.kind === 'object' ? j.root.entries[0]! : null;
      expect(e && e.value.kind === 'scalar' ? e.value.value : null).toBe('a\nb');
    }
    const y = parseSchematic('yaml', 'k: "a\\nb"\n');
    expect(y.ok).toBe(true);
    if (y.ok) {
      const e = y.root.kind === 'object' ? y.root.entries[0]! : null;
      expect(e && e.value.kind === 'scalar' ? e.value.value : null).toBe('a\nb');
    }
  });
});

// ── The issue's exact mini repro, end-to-end (contract 1) ──

// Backslash-n / backslash-t as TWO characters in the file — tomllib parses
// this fine, and after #64 so do we. (`uni` below is covered by e1/r2.)
const REPRO_TOML = [
  '[database]',
  'host = "db.internal"',
  'note = "line1\\nline2"',
  'tabbed = "a\\tb"',
  '[wire]',
  '[wire.dns]',
  'synthetic_gateway = "192.168.127.1:53"',
].join('\n');

describe('issue #64: the repro file parses and every anchor into it verifies', () => {
  test('r1: parser level — the repro parses; resolveSchematicAnchor resolves all four anchors', () => {
    const p = parseToml(REPRO_TOML);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(resolveSchematicAnchor(p.root, 'database.host')).toEqual({ status: 'leaf', path: 'database.host' });
    expect(resolveSchematicAnchor(p.root, 'database.note')).toEqual({ status: 'leaf', path: 'database.note' });
    expect(resolveSchematicAnchor(p.root, 'database.tabbed')).toEqual({ status: 'leaf', path: 'database.tabbed' });
    expect(resolveSchematicAnchor(p.root, 'wire.dns.synthetic_gateway')).toEqual({
      status: 'leaf', path: 'wire.dns.synthetic_gateway',
    });
  });

  test('r2: engine level — zero findings for anchors into an escape-bearing file (and \\u000A parses)', () => {
    const withUni = REPRO_TOML + '\nuni = "a\\u000Ab"';
    const spec = [
      '- Overview',
      '  - h: see artifacts/config.toml#database.host',
      '  - n: see artifacts/config.toml#database.note',
      '  - t: see artifacts/config.toml#database.tabbed',
      '  - g: see artifacts/config.toml#wire.dns.synthetic_gateway',
      '  - u: see artifacts/config.toml#uni',
      '',
    ].join('\n');
    const issues = checkAnchors(spec, { 'artifacts/config.toml': withUni });
    expect(issues).toEqual([]); // contract 1: anchors verify NORMALLY — no parse-error, no broken-anchor
  });
});

// ── Genuine raw newlines still error (contract 2) ──

describe('issue #64: a genuine raw newline in a single-line basic string still errors', () => {
  test('x1: parser level — the existing unterminated-basic-string path fires', () => {
    // An ACTUAL newline byte inside the quotes: 'host = "db.local' then a new
    // physical line — the per-line reader never sees a closing quote.
    const raw = parseToml('[database]\nhost = "db.local\nport = 5432\n');
    expect(raw.ok).toBe(false);
    if (!raw.ok) {
      expect(raw.line).toBe(2);
      expect(raw.message).toBe('unterminated basic string'); // NOT 'raw newline …'
    }
  });

  test('x2: engine level — the same file reports refs.anchor.parse-error naming the real cause', () => {
    const spec = '- Overview\n  - x: see artifacts/raw.toml#database.host\n';
    const issues = checkAnchors(spec, { 'artifacts/raw.toml': '[database]\nhost = "db.local\nport = 5432\n' });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.rule).toBe('refs.anchor.parse-error');
    expect(issues[0]!.level).toBe('error');
    expect(issues[0]!.message).toContain('schematic parse error: artifacts/raw.toml#database.host — TOML line 2: unterminated basic string');
  });
});

// ── Actually malformed files still block their anchors (contract 3) ──

describe('issue #64: a parse error in one value still blocks anchors — only when truly malformed', () => {
  test('m1: an unterminated array blocks its anchors while the escape file next door stays clean', () => {
    const brokenSpec = '- Overview\n  - x: see artifacts/broken.toml#a\n';
    const broken = checkAnchors(brokenSpec, { 'artifacts/broken.toml': 'a = [1, 2\nb = 3\n' });
    expect(broken).toHaveLength(1);
    expect(broken[0]!.rule).toBe('refs.anchor.parse-error');
    expect(broken[0]!.message).toContain('TOML line 1');
    expect(broken[0]!.message).toContain('unterminated');
    // The escape-bearing file produces NO parse error for the same anchor kind:
    const good = checkAnchors(
      '- Overview\n  - y: see artifacts/ok.toml#a\n',
      { 'artifacts/ok.toml': 'a = "x\\ny"\n' },
    );
    expect(good).toEqual([]);
  });
});

// ── The #58 verdicts are unchanged (contract 4) ──

describe('issue #64: file-level refs and the ambiguous/broken verdicts from #58 are untouched', () => {
  test('v1: a file-level pointer (no #) to an escape-bearing schematic stays clean', () => {
    const issues = checkAnchors('- Overview\n  - cfg: see artifacts/config.toml\n', {
      'artifacts/config.toml': REPRO_TOML,
    });
    expect(issues).toEqual([]);
  });

  test('v2: ambiguous flat anchors still list both paths on an escape-bearing file', () => {
    const toml = '[database]\nport = 5432\nnote = "line1\\nline2"\n\n[server]\nport = 8080\n';
    const spec = '- Overview\n  - p: see artifacts/ambig.toml#port\n';
    const issues = checkAnchors(spec, { 'artifacts/ambig.toml': toml });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.rule).toBe('refs.anchor.ambiguous');
    expect(issues[0]!.message).toBe(
      'ambiguous anchor: artifacts/ambig.toml#port — flat name matches multiple leaves: database.port, server.port',
    );
    expect(issues[0]!.suggestion).toBe(
      'use the full path form: artifacts/ambig.toml#database.port or artifacts/ambig.toml#server.port',
    );
  });

  test('v3: a broken anchor into an escape-bearing file is still a broken-anchor error', () => {
    const spec = '- Overview\n  - g: see artifacts/config.toml#NoSuchLeaf\n';
    const issues = checkAnchors(spec, { 'artifacts/config.toml': REPRO_TOML });
    const broken = issues.filter(i => i.rule === 'refs.broken.anchor');
    expect(broken).toHaveLength(1);
    expect(broken[0]!.level).toBe('error');
    expect(broken[0]!.message).toBe('broken anchor: artifacts/config.toml#NoSuchLeaf — no node matches');
    expect(issues.filter(i => i.rule === 'refs.anchor.parse-error')).toHaveLength(0);
  });
});

// ── CLI end-to-end ──

describe('issue #64: cans check end-to-end', () => {
  test('c1: the repro workspace checks CLEAN — exit 0, zero refs issues', () => {
    const spec = [
      '- Overview',
      '  - h: see artifacts/config.toml#database.host',
      '  - n: see artifacts/config.toml#database.note',
      '  - t: see artifacts/config.toml#database.tabbed',
      '  - g: see artifacts/config.toml#wire.dns.synthetic_gateway',
      '',
    ].join('\n');
    const ws = makeWs('cli-clean', { '00-overview.md': spec, 'artifacts/config.toml': REPRO_TOML });
    const r = spawnCli(['check', '--json'], ws.tmp, { ...process.env, CANS_ROOT: '' });
    expect(r.exit).toBe(0);
    const j = JSON.parse(r.out) as { ok: boolean; refs: { total: number; broken: number } };
    expect(j.ok).toBe(true);
    expect(j.refs).toEqual({ total: 4, broken: 0, deepHops: 0 });
  });
});
