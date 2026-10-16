/**
 * Issue #53 Part 1.2 regression tests — the `cans slug` subcommand.
 *
 * Defect: the anchor-slug algorithm was undocumented (Part 1.1) and there was
 * no way to ASK the tool for a node's anchor — authors reverse-engineered
 * `Layer 1 — C authorizer` → `#Layer-1-C-authorizer` by trial and error, and
 * every miss minted a broken ref the old (inverted) suggestion then tried to
 * "fix" by renaming the node.
 *
 * Fix: `cans slug` prints the canonical fragment from the single source of
 * truth (core/slug.ts anchorSlug). Two input modes:
 *   - TEXT: `cans slug <text...>` — args joined with a single space (the
 *     `new` convention), so quoting is optional. No workspace needed.
 *   - FILE:LINE: `cans slug <file>:<line>` — parses the spec file and prints
 *     the slug of the node on EXACTLY that line (the issue's --explain-anchor
 *     ask, folded into a query command instead of a flag on check.ts).
 *
 * Test map:
 *   a ..... text mode: the issue's exact repro (quoted) → bare fragment
 *   b ..... text mode: multi-arg joining — unquoted words, same slug
 *   c ..... text mode: the dash family through the CLI (en/minus + mixed run)
 *   d ..... text mode: case preservation and punctuation verbatim
 *   e ..... text mode: no input → §37 usage error (human ✗, JSON error field)
 *   f ..... text mode: separators-only input → empty-slug diagnosis (`new` mirror)
 *   g ..... text mode: --json result shape (ok/command/input/slug)
 *   h ..... text mode: no workspace required (runs from an empty dir)
 *   i ..... parseSlugTarget unit: mode classification (text / file / bad-line)
 *   j ..... file:line mode: node line → the em-dash node's exact slug
 *   k ..... file:line mode: --json carries input and nodeText
 *   l ..... file:line mode: prose/blank line → §37 error listing node lines
 *   m ..... file:line mode: many nodes → first..last range form
 *   n ..... file:line mode: leading table line is NOT a node line (synthetic
 *          placeholder nodes excluded, issue #8)
 *   o ..... file:line mode: missing file → §37 error
 *   p ..... file:line mode: no workspace → check.ts's diagnosis, exit 1
 *   q ..... file:line mode: malformed line numbers (0 / -14 / abc / 014)
 *   r ..... file:line mode: folder form + flat spelling resolving to it (§12)
 *   s ..... help: the command list shows the slug line
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { rmSync, mkdirSync } from 'fs';

import { parseSlugTarget } from '../../src/commands/slug.ts';
import { spawnCli, REPO } from '../runtime.ts';
import { makeCansWorkspace } from '../helpers.ts';

// ── The dash-like family, as escapes so the codepoints stay explicit ──

const EN = '\u2013';    // en dash
const EM = '\u2014';    // em dash
const MINUS = '\u2212'; // minus sign

// ── Workspaces (§11 spec files: /^\d{2}-.+\.md$/) ──

/** The issue's shape with prose scaffolding: lines 1–2 are heading/blank, so
 *  the node lines of 02-authentication.md are 3, 4, 5 — line 4 is the
 *  em-dash node the issue's ref points at. */
const AUTH_FILES = {
  '00-overview.md': `- Overview\n  - Authorizer: see 02-authentication.md#Layer-1-C-authorizer\n  - Scope\n`,
  '02-authentication.md': `# Authentication\n\n- Authentication\n  - Layer 1 ${EM} C authorizer\n  - Token hygiene\n`,
};

/** >8 nodes so the not-a-node-line diagnosis takes the `first..last (N nodes)`
 *  range form instead of the full list. */
const MANY_FILES = {
  '03-many.md': `# Many\n\n${Array.from({ length: 10 }, (_, i) => `- Node number ${i + 1}`).join('\n')}\n`,
};

/** A leading table mints a synthetic `(table)` placeholder node (issue #8) —
 *  table rows must NOT read as node lines. Real nodes: 3, 4. */
const TABLE_FILES = {
  '04-table.md': `| column | header |\n|---|---|\n- Real node\n- Another node\n`,
};

/** Folder-layout twin of AUTH_FILES: only 02-authentication/index.md exists,
 *  so the flat spelling must resolve to it (§12 flat-then-folder). */
const FOLDER_FILES = {
  '00-overview.md': `- Overview\n  - Scope\n`,
  '02-authentication/index.md': `# Authentication\n\n- Authentication\n  - Layer 1 ${EM} C authorizer\n  - Token hygiene\n`,
};

// ── CLI scaffolding (mirrors test/issues/issue-53-slug-core.test.ts) ──

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-53-slug-command');
const createdDirs: string[] = [];

afterEach(() => {
  while (createdDirs.length > 0) {
    rmSync(createdDirs.pop()!, { recursive: true, force: true });
  }
});

/** issue-50.test.ts scaffolding: the CLI runs from the PARENT of cans/ (the
 *  workspace is discovered below cwd). */
function makeWs(name: string, files: Record<string, string>): { tmp: string; root: string } {
  const tmp = join(SCRATCH, `${name}-${createdDirs.length + 1}`);
  createdDirs.push(tmp);
  const root = makeCansWorkspace(tmp, files);
  return { tmp, root };
}

/** An EMPTY dir: no cans/ at any ancestor and no .tmp/ scratch below — the
 *  no-workspace precondition for text-mode-needs-nothing / file:line-fails
 *  tests (CANS_ROOT:'' kills the env override). */
function makeEmptyDir(name: string): string {
  const tmp = join(SCRATCH, `${name}-${createdDirs.length + 1}`);
  mkdirSync(tmp, { recursive: true });
  createdDirs.push(tmp);
  return tmp;
}

function runCli(args: string[], cwd: string) {
  return spawnCli(args, cwd, { ...process.env, CANS_ROOT: '' });
}

// ── Unit: the mode-disambiguation contract (parseSlugTarget) ──

describe('issue #53 1.2: parseSlugTarget — text vs file:line vs malformed', () => {
  test('i: plain prose is text mode; multi-args join with a single space', () => {
    expect(parseSlugTarget([])).toEqual({ mode: 'text', text: '' });
    expect(parseSlugTarget(['Data protection'])).toEqual({ mode: 'text', text: 'Data protection' });
    expect(parseSlugTarget(['Layer', '1', EM, 'C', 'authorizer']))
      .toEqual({ mode: 'text', text: `Layer 1 ${EM} C authorizer` });
    // Colons without an `.md:` tail are prose, never lookups.
    expect(parseSlugTarget(['see:', 'sessions'])).toEqual({ mode: 'text', text: 'see: sessions' });
    expect(parseSlugTarget(['note.md and', 'more'])).toEqual({ mode: 'text', text: 'note.md and more' });
  });

  test('i: the strict <file>.md:<line> form is file mode (folders included)', () => {
    expect(parseSlugTarget(['02-authentication.md:14']))
      .toEqual({ mode: 'file', file: '02-authentication.md', line: 14 });
    // Folder spelling: the `.+` before `.md` spans `/` — no separate case.
    expect(parseSlugTarget(['04-api/request-schema.md:3']))
      .toEqual({ mode: 'file', file: '04-api/request-schema.md', line: 3 });
    expect(parseSlugTarget(['a.md:1'])).toEqual({ mode: 'file', file: 'a.md', line: 1 });
    // Joining inserts single spaces, so a colon SPLIT across args breaks the
    // `.md:` adjacency — `cans slug 04-api.md :12` is text mode, not a lookup.
    expect(parseSlugTarget(['04-api.md', ':12'])).toEqual({ mode: 'text', text: '04-api.md :12' });
    // A multi-arg input whose joined form ends in `.md:<line>` is still file
    // mode — the file token is the whole joined prefix (spaces included),
    // which then fails resolution LOUDLY instead of slugging nonsense.
    expect(parseSlugTarget(['see', '04-api.md:12']))
      .toEqual({ mode: 'file', file: 'see 04-api.md', line: 12 });
  });

  test('i: an .md: tail that is not a clean 1-based integer is bad-line', () => {
    expect(parseSlugTarget(['02-authentication.md:0']))
      .toEqual({ mode: 'bad-line', file: '02-authentication.md', raw: '0' });
    expect(parseSlugTarget(['02-authentication.md:-14']))
      .toEqual({ mode: 'bad-line', file: '02-authentication.md', raw: '-14' });
    expect(parseSlugTarget(['02-authentication.md:abc']))
      .toEqual({ mode: 'bad-line', file: '02-authentication.md', raw: 'abc' });
    // Leading zeros are refused — `014` would silently mean 14 otherwise.
    expect(parseSlugTarget(['02-authentication.md:014']))
      .toEqual({ mode: 'bad-line', file: '02-authentication.md', raw: '014' });
    expect(parseSlugTarget(['02-authentication.md:1x4']))
      .toEqual({ mode: 'bad-line', file: '02-authentication.md', raw: '1x4' });
    // A bare `.md:` with nothing after the colon is an aborted lookup.
    expect(parseSlugTarget(['auth.md:'])).toEqual({ mode: 'bad-line', file: 'auth.md', raw: '' });
  });
});

// ── CLI end-to-end: text mode ──

describe('issue #53 1.2: cans slug — text mode', () => {
  test('a: the issue repro — quoted em-dash title prints the bare fragment', () => {
    const ws = makeWs('text-repro', AUTH_FILES);
    const r = runCli(['slug', `Layer 1 ${EM} C authorizer`], ws.tmp);
    expect(r.exit).toBe(0);
    // BARE fragment on its own stdout line — shell-composable, no decoration.
    expect(r.out).toBe('Layer-1-C-authorizer\n');
  });

  test('b: unquoted multi-arg words join with a single space — same slug', () => {
    const ws = makeWs('text-multiarg', AUTH_FILES);
    const r = runCli(['slug', 'Layer', '1', EM, 'C', 'authorizer'], ws.tmp);
    expect(r.exit).toBe(0);
    expect(r.out).toBe('Layer-1-C-authorizer\n');
  });

  test('c: the dash family collapses through the CLI; a mixed run makes one hyphen', () => {
    const ws = makeWs('text-dashes', AUTH_FILES);
    for (const dash of [EN, MINUS]) {
      const r = runCli(['slug', `Layer 1 ${dash} C authorizer`], ws.tmp);
      expect(r.exit).toBe(0);
      expect(r.out).toBe('Layer-1-C-authorizer\n');
    }
    const mixed = runCli(['slug', `A -${EM}${EN}${MINUS} B`], ws.tmp);
    expect(mixed.exit).toBe(0);
    expect(mixed.out).toBe('A-B\n');
  });

  test('d: case is preserved and punctuation passes through verbatim', () => {
    const ws = makeWs('text-verbatim', AUTH_FILES);
    expect(runCli(['slug', 'Data protection'], ws.tmp).out).toBe('Data-protection\n');
    expect(runCli(['slug', "What's Next?"], ws.tmp).out).toBe("What's-Next?\n");
    expect(runCli(['slug', 'API (v2)'], ws.tmp).out).toBe('API-(v2)\n');
  });

  test('e: no input is a §37 usage error naming the invocation', () => {
    const ws = makeWs('text-empty', AUTH_FILES);
    const r = runCli(['slug'], ws.tmp);
    expect(r.exit).toBe(1);
    expect(r.out).toContain('✗ no text given');
    expect(r.out).toContain('cans slug "<node text>"');
    // The JSON shape carries the same diagnosis in `error`.
    const j = runCli(['slug', '--json'], ws.tmp);
    expect(j.exit).toBe(1);
    const parsed = JSON.parse(j.out) as Record<string, unknown>;
    expect(parsed.ok).toBe(false);
    expect(parsed.command).toBe('slug');
    expect(parsed.error).toContain('no text given');
  });

  test('f: separators-only input gets the `new`-style empty-slug diagnosis', () => {
    const ws = makeWs('text-seponly', AUTH_FILES);
    const r = runCli(['slug', ` -${EM}- `], ws.tmp);
    expect(r.exit).toBe(1);
    expect(r.out).toContain('✗ empty slug from');
    expect(r.out).toContain('provide non-empty node text');
  });

  test('g: --json result shape — ok/command/exitCode/input/slug, no nodeText', () => {
    const ws = makeWs('text-json', AUTH_FILES);
    const r = runCli(['slug', 'Data protection', '--json'], ws.tmp);
    expect(r.exit).toBe(0);
    const j = JSON.parse(r.out) as Record<string, unknown>;
    expect(j.ok).toBe(true);
    expect(j.command).toBe('slug');
    expect(j.exitCode).toBe(0);
    expect(j.input).toBe('Data protection');
    expect(j.slug).toBe('Data-protection');
    expect(j.nodeText).toBeUndefined();
  });

  test('h: text mode needs no workspace (empty dir, no cans/ anywhere up)', () => {
    const dir = makeEmptyDir('text-nows');
    const r = runCli(['slug', 'Data protection'], dir);
    expect(r.exit).toBe(0);
    expect(r.out).toBe('Data-protection\n');
  });
});

// ── CLI end-to-end: file:line mode ──

describe('issue #53 1.2: cans slug — file:line mode', () => {
  test('j: a node line prints that node’s exact anchor slug', () => {
    const ws = makeWs('file-node', AUTH_FILES);
    // Line 4 of 02-authentication.md is `  - Layer 1 — C authorizer`.
    const r = runCli(['slug', '02-authentication.md:4'], ws.tmp);
    expect(r.exit).toBe(0);
    expect(r.out).toBe('Layer-1-C-authorizer\n');
    // A plain node too — the root bullet on line 3.
    expect(runCli(['slug', '02-authentication.md:3'], ws.tmp).out).toBe('Authentication\n');
  });

  test('k: --json carries the raw input and the source node’s text', () => {
    const ws = makeWs('file-json', AUTH_FILES);
    const r = runCli(['slug', '02-authentication.md:4', '--json'], ws.tmp);
    expect(r.exit).toBe(0);
    const j = JSON.parse(r.out) as Record<string, unknown>;
    expect(j.ok).toBe(true);
    expect(j.command).toBe('slug');
    expect(j.input).toBe('02-authentication.md:4');
    expect(j.slug).toBe('Layer-1-C-authorizer');
    expect(j.nodeText).toBe(`Layer 1 ${EM} C authorizer`);
  });

  test('l: a prose/blank line is a §37 error listing the real node lines', () => {
    const ws = makeWs('file-prose', AUTH_FILES);
    for (const line of [1, 2]) {
      const r = runCli(['slug', `02-authentication.md:${line}`], ws.tmp);
      expect(r.exit).toBe(1);
      expect(r.out).toContain(`✗ line ${line} is not a node line`);
      expect(r.out).toContain('node lines: 3, 4, 5');
    }
  });

  test('m: many nodes → the first..last range form with the node count', () => {
    const ws = makeWs('file-many', MANY_FILES);
    const r = runCli(['slug', '03-many.md:2'], ws.tmp);
    expect(r.exit).toBe(1);
    expect(r.out).toContain('line 2 is not a node line');
    expect(r.out).toContain('node lines: 3..12 (10 nodes)');
  });

  test('n: a leading table line is NOT a node line (synthetic placeholders excluded)', () => {
    const ws = makeWs('file-table', TABLE_FILES);
    const r = runCli(['slug', '04-table.md:1'], ws.tmp);
    expect(r.exit).toBe(1);
    expect(r.out).toContain('line 1 is not a node line');
    expect(r.out).toContain('node lines: 3, 4');
    // The real nodes after the table still slug.
    expect(runCli(['slug', '04-table.md:3'], ws.tmp).out).toBe('Real-node\n');
  });

  test('o: a missing file is a §37 error naming what was asked for', () => {
    const ws = makeWs('file-missing', AUTH_FILES);
    const r = runCli(['slug', '09-nonexistent.md:3'], ws.tmp);
    expect(r.exit).toBe(1);
    expect(r.out).toContain('✗ file not found: 09-nonexistent.md');
  });

  test('p: no workspace → check.ts’s diagnosis, exit 1', () => {
    const dir = makeEmptyDir('file-nows');
    const r = runCli(['slug', '02-authentication.md:4'], dir);
    expect(r.exit).toBe(1);
    expect(r.out).toContain('✗ no cans workspace found');
  });

  test('q: malformed line numbers (0 / negative / non-numeric / leading zero)', () => {
    const ws = makeWs('file-badline', AUTH_FILES);
    for (const bad of ['02-authentication.md:0', '02-authentication.md:-14', '02-authentication.md:abc', '02-authentication.md:014']) {
      const r = runCli(['slug', bad], ws.tmp);
      expect(r.exit).toBe(1);
      expect(r.out).toContain('✗ malformed line number');
      expect(r.out).toContain(bad);
    }
  });

  test('r: folder form works, and the flat spelling resolves to the folder index', () => {
    const ws = makeWs('file-folder', FOLDER_FILES);
    // Explicit folder spelling…
    expect(runCli(['slug', '02-authentication/index.md:4'], ws.tmp).out).toBe('Layer-1-C-authorizer\n');
    // …and the §12 flat-then-folder resolution: only index.md exists.
    expect(runCli(['slug', '02-authentication.md:4'], ws.tmp).out).toBe('Layer-1-C-authorizer\n');
  });
});

// ── Help surface ──

describe('issue #53 1.2: cans slug — help listing', () => {
  test('s: `cans help` shows the slug command line', () => {
    const ws = makeWs('help', AUTH_FILES);
    const r = runCli(['help'], ws.tmp);
    expect(r.exit).toBe(0);
    expect(r.out).toContain('slug "<node text>" | <file>:<line>');
  });
});
