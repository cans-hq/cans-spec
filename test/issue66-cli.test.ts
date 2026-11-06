/**
 * Issue #66 — the CLI half: `cans check --codebase` and
 * `cans refs <node> --codebase` (the codebase inbound-references scanner).
 *
 * The RFC's three surfaces are wired here:
 *
 *   A ....... `cans check --codebase` — the flag-or-config opt-in (the
 *             --hints convention): plain runs never scan source files and
 *             their --json wire shape stays byte-identical to the pre-#66
 *             format (no `codebase` key); the additive `codebase` block
 *             (scanned/pointers/broken/issues, RFC §4.1) appears ONLY when
 *             the phase ran
 *   B ....... severity banding — broken pointers are ordinary band findings:
 *             `codebase.severity: 'error'` → errorCount > 0 → ok:false AND
 *             EXIT 2 (the repo's error-band convention, 0 clean · 1 warnings
 *             · 2 errors). DELIBERATE DEVIATION, pinned here: the RFC §4.1
 *             example JSON shows exitCode 1 for the error case, but this
 *             repo's contract has always been exit 2 for any error-level
 *             finding (issue #41) — the convention wins, the RFC example is
 *             illustrative only. `severity: 'warning'` → the exit-1 band
 *   C ....... gates — codebase findings are REFS-layer findings: kept under
 *             `--refs-only`, suppressed under `--structure` (the #61 gates)
 *   D ....... `cans refs <node> --codebase` — the reverse-traceability query:
 *             RFC §4.2 human shape (node line, two-space-indented
 *             `  <file>:<line>: <text>` matches, `scanned N source file(s)`),
 *             anchor-insensitive matching (normalizeForAnchor), file-only
 *             queries matching every pointer into the file, 0-match exit 0,
 *             and the §20 refusals (no `--codebase` → exit 1 naming the
 *             flag; malformed query → exit 1 usage; unknown file → exit 1
 *             naming the corpus boundary)
 *   E ....... --json of the refs command — the frozen RefsResult shape
 *             (ok/command/exitCode/node/scanned/matches), nothing more
 *
 * Workspace layout mirrors the issue-65 CLI suite: the workspace root holds
 * `_rules.yaml` + root-level specs, and the scanned codebase lives OUTSIDE
 * the workspace as a sibling directory (`src/` under the project root —
 * the parent of the workspace, the same convention as
 * `references.external_roots`), so every CLI spawn pins CANS_ROOT to the
 * intended workspace root. Runtime-neutral: imports the test facade, never
 * 'bun:test' directly; CLI runs are blackbox spawns via ./runtime.ts.
 */
import { describe, test, expect, afterEach } from './testing.ts';
import { join } from 'path';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';

import { spawnCli } from './runtime.ts';
import { makeTmpDir, cleanTmpDir, makeCansWorkspace } from './helpers.ts';
import { checkReportJson } from '../src/core/report.ts';

// ── fixtures ────────────────────────────────────────────────────────────────

/** A minimal clean spec pair: cross-referenced, no orphans, no warnings. */
const OVERVIEW = '# Overview\n\n- Intro: see: 02-auth.md\n';
const AUTH = '# Auth\n\n- Sessions: handled below\n- Passwords: see: 01-overview.md\n';

/** The default rules file for these fixtures: back-pointers off so no
 *  ref-by comments are ever required; no codebase block (the plain corpus). */
const RULES_PLAIN = 'references:\n  back_pointers: false\n';

/** Rust source the RFC's own example shape: an embedded pointer with
 *  surrounding prose (§2.2 tolerance), plus a clean line without one. */
const AUTH_RS = [
  '// Session validation — see: 02-auth.md#Sessions for the canonical rules.',
  'fn validate_session(token: &str) -> bool {',
  '    token.len() > 0 // checked at the boundary',
  '}',
  '',
].join('\n');

// ── harness ─────────────────────────────────────────────────────────────────

const tmps: string[] = [];

/** Fresh project: the cans/ workspace at `<tmp>/cans`, sources as siblings. */
function makeProject(
  name: string,
  files: Record<string, string>,
  sources: Record<string, string> = {},
): { tmp: string; root: string } {
  const tmp = makeTmpDir(`issue66-cli-${name}`);
  tmps.push(tmp);
  const root = makeCansWorkspace(tmp, files);
  for (const [rel, content] of Object.entries(sources)) {
    const p = join(tmp, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, content, 'utf8');
  }
  return { tmp, root };
}

/** Blackbox CLI spawn pinned to the workspace root (see file header). */
function runCli(args: string[], root: string) {
  return spawnCli(args, root, { ...process.env, CANS_ROOT: root });
}

function readWs(root: string, rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
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

/** The standard two-spec workspace (clean: exit 0 on a plain check). */
function baseProject(name: string, sources: Record<string, string> = {}, rules = RULES_PLAIN) {
  return makeProject(name, { '_rules.yaml': rules, '01-overview.md': OVERVIEW, '02-auth.md': AUTH }, sources);
}

afterEach(() => {
  while (tmps.length > 0) {
    cleanTmpDir(tmps.pop()!);
  }
});

// ── A: the additive wire — plain runs stay byte-identical ───────────────────

describe('issue #66 A — the codebase-off fast path keeps the pre-#66 wire shape', () => {
  test('A1: a plain check --json has NO codebase key — exact top-level shape', () => {
    const ws = baseProject('a1');
    const j = parseJsonOut(runCli(['check', '--json'], ws.root).out);
    expect(j.exitCode).toBe(0);
    expect('codebase' in j).toBe(false);
    // exact key set AND order — the §35 fixture contract, now pinned for #66:
    // the additive block would slot after backPointersUpdatedFiles.
    expect(Object.keys(j)).toEqual([
      'ok', 'command', 'exitCode', 'summary', 'refs', 'backPointers',
      'counts', 'sections', 'backPointersUpdated', 'backPointersUpdatedFiles', 'rulesSummary',
    ]);
    // no new section name either — codebase findings ride sections.refs.
    expect(Object.keys(j.sections)).toEqual(['structure', 'style', 'refs', 'redundancy', 'other']);
  });

  test('A2: the workspace stays clean (exit 0) and no source file is ever touched', () => {
    const ws = baseProject('a2', { 'src/auth.rs': AUTH_RS });
    const before = readFileSync(join(ws.tmp, 'src/auth.rs'), 'utf8');
    const r = runCli(['check'], ws.root);
    expect(r.exit).toBe(0);
    expect(readFileSync(join(ws.tmp, 'src/auth.rs'), 'utf8')).toBe(before); // read-only phase
  });
});

describe('issue #66 A — parse-layer wiring (§20)', () => {
  test('A3: --codebase=<value> is rejected — the flag is boolean, the equals form is a typo', () => {
    const ws = baseProject('a3');
    const r = runCli(['check', '--codebase=strict'], ws.root);
    expect(r.exit).toBe(2);
    expect(r.out).toContain('invalid flag form "--codebase=strict"');
  });

  test('A4: --codebase parses (no unknown-flag error) and is a no-op under --structure', () => {
    // The --structure gate suppresses the phase — so this run proves the flag
    // itself is ACCEPTED at the parse layer without needing the scan engine.
    const ws = baseProject('a4', { 'src/auth.rs': AUTH_RS });
    const j = parseJsonOut(runCli(['check', '--structure', '--codebase', '--json'], ws.root).out);
    expect(j.ok).toBe(true);
    expect('codebase' in j).toBe(false); // gate wins: no scan, no block
  });
});

// ── report.ts: the additive block's position contract (unit-level) ──────────

describe('issue #66 report — the additive codebase block mirrors the anchorFixes convention', () => {
  const baseResult = {
    ok: false,
    exitCode: 2,
    files: 2,
    nodes: 3,
    maxDepth: 1,
    elapsedMs: 7,
    refs: { total: 2, broken: 0, deepHops: 0 },
    backPointers: { total: 0, current: 0, stale: 0 },
    errorCount: 1,
    warningCount: 0,
    backPointersUpdated: 0,
    backPointersUpdatedFiles: [],
    rulesSummary: 'node_length: 3–120 | siblings: 1–12 | depth: 1–5',
    issues: [] as never[],
  };
  const codebaseBlock = {
    scanned: 4,
    pointers: 3,
    broken: 1,
    issues: [
      {
        type: 'CodebaseBrokenReference' as const,
        file: 'src/auth.rs',
        line: 1,
        raw: 'see: 02-auth.md#Sessions',
        targetFile: '02-auth.md',
        targetSlug: 'Sessions',
        reason: 'AnchorNotFound' as const,
      },
    ],
  };

  test('R1: present → top-level key exactly when the phase ran, positioned after backPointersUpdatedFiles', () => {
    const json = checkReportJson({ ...baseResult, codebase: codebaseBlock }) as Record<string, unknown>;
    const keys = Object.keys(json);
    expect(keys).toContain('codebase');
    expect(keys.indexOf('codebase')).toBe(keys.indexOf('backPointersUpdatedFiles') + 1);
    // verbatim pass-through — the RFC §4.1 wire shape, byte for byte
    expect(json['codebase']).toEqual(codebaseBlock);
  });

  test('R2: position holds with anchorFixes too — codebase BEFORE the --fix conditional', () => {
    const json = checkReportJson({
      ...baseResult,
      codebase: codebaseBlock,
      anchorFixes: [{ file: '01-overview.md', line: 3, from: 'Sesion', to: 'Sessions', applied: false }],
    }) as Record<string, unknown>;
    const keys = Object.keys(json);
    expect(keys.indexOf('codebase')).toBe(keys.indexOf('backPointersUpdatedFiles') + 1);
    expect(keys.indexOf('codebase')).toBeLessThan(keys.indexOf('anchorFixes'));
  });

  test('R3: absent → no codebase key (the plain-run pin, mirror of A1 at the unit level)', () => {
    const json = checkReportJson(baseResult) as Record<string, unknown>;
    expect('codebase' in json).toBe(false);
  });
});

// ── D: the refs command — §20 refusals (no scan engine needed) ──────────────

describe('issue #66 D — cans refs refusals fire before any scan', () => {
  test('D1: without --codebase the command refuses, naming the flag and what it does', () => {
    const ws = baseProject('d1');
    const r = runCli(['refs', '02-auth.md'], ws.root);
    expect(r.exit).toBe(1);
    expect(r.out).toContain('"--codebase" is required');
    expect(r.out).toContain('cans refs <node> --codebase');
    const j = parseJsonOut(runCli(['refs', '02-auth.md', '--json'], ws.root).out);
    expect(j.ok).toBe(false);
    expect(j.exitCode).toBe(1);
    expect(j.command).toBe('refs');
    expect(j.node).toBe('02-auth.md');
    expect(j.scanned).toBe(0);
    expect(j.matches).toEqual([]);
    expect(j.error).toContain('"--codebase" is required');
  });

  test('D2: a bare stem without .md is a malformed query — usage message, never a fuzzy match', () => {
    const ws = baseProject('d2');
    const r = runCli(['refs', '02-auth', '--codebase'], ws.root);
    expect(r.exit).toBe(1);
    expect(r.out).toContain('malformed node "02-auth"');
    expect(r.out).toContain('<file>.md or <file>.md#Slug');
  });

  test('D3: an empty slug (`#` with nothing after) is malformed, and so is trailing garbage', () => {
    const ws = baseProject('d3');
    for (const bad of ['02-auth.md#', '02-auth.md#Sessions#More']) {
      const r = runCli(['refs', bad, '--codebase'], ws.root);
      expect(r.exit).toBe(1);
      expect(r.out).toContain(`malformed node "${bad}"`);
    }
  });

  test('D4: no node at all is the usage refusal', () => {
    const ws = baseProject('d4');
    const r = runCli(['refs', '--codebase'], ws.root);
    expect(r.exit).toBe(1);
    expect(r.out).toContain('no node given');
  });

  test('D5: a second positional is rejected — one query per invocation', () => {
    const ws = baseProject('d5');
    const r = runCli(['refs', '02-auth.md', '01-overview.md', '--codebase'], ws.root);
    expect(r.exit).toBe(1);
    expect(r.out).toContain('unexpected argument "01-overview.md"');
  });

  test('D6: an unknown flag is a §20 user error (never silently ignored)', () => {
    const ws = baseProject('d6');
    const r = runCli(['refs', '02-auth.md', '--codebas'], ws.root);
    expect(r.exit).toBe(1);
    expect(r.out).toContain('unknown flag "--codebas"');
  });

  test('D7: an unknown file refuses, naming it and the corpus boundary', () => {
    const ws = baseProject('d7');
    const r = runCli(['refs', '99-missing.md', '--codebase'], ws.root);
    expect(r.exit).toBe(1);
    expect(r.out).toContain('no spec file matches "99-missing.md"');
    expect(r.out).toContain('workspace corpus');
    // the cans/ spelling of a real file resolves; a cans/ spelling of a
    // missing file refuses the same way
    const r2 = runCli(['refs', 'cans/99-missing.md', '--codebase'], ws.root);
    expect(r2.exit).toBe(1);
    expect(r2.out).toContain('no spec file matches "cans/99-missing.md"');
  });
});
