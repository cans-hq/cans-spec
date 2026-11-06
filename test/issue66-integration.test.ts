/**
 * Issue #66 — integration: the codebase inbound-references scanner END-TO-END
 * on the merged engine (core/codebase.ts) + CLI (check.ts / refs.ts) halves,
 * driven blackbox against the real CLI and the `test/fixtures/
 * codebase-workspace/` fixture (its README.md is the line-authoritative
 * oracle this suite pins — every pointer, its line, its verdict).
 *
 * The contract under test (RFC "Codebase Inbound References" + the frozen
 * cross-agent types in src/types.ts):
 *
 *   a ....... `check --codebase` on a broken-pointer workspace: non-zero
 *             exit, the additive top-level `codebase` JSON block with
 *             issues[] entries carrying EXACTLY { type, file, line, raw,
 *             targetFile, targetSlug, reason }, and the broken counts
 *             matching the fixture oracle (5 scanned / 10 pointers / 2
 *             broken: AnchorNotFound on the `#Qutas` typo, FileNotFound on
 *             the missing `09-observability.md`)
 *   b ....... after fixing the broken pointers IN THE TMP COPY the same
 *             command exits 0 with `codebase.issues` empty — silent rot is
 *             a diff, not a life sentence
 *   c ....... `refs "<file>#<slug>" --codebase` lists the exact fixture
 *             hits (file asc, line asc, the line text as written) and exits
 *             0; a file-level query answers every anchor; a no-match query
 *             is exit 0 with zero matches (an empty answer is an answer)
 *   d ....... `refs` without `--codebase` refuses non-zero with guidance
 *             (§20 — a flag that silently does nothing is a typo hiding in
 *             plain sight)
 *   e ....... scanner-OFF workspace (no `codebase` block, no flag): plain
 *             `check --json` has NO `codebase` key — the pre-#66 wire
 *             shape, byte-for-byte (the additive-block contract)
 *   f ....... flag-on with NO config block still scans (the defaults): the
 *             RFC §3 code-extension set only — 4 files / 9 pointers / the
 *             same 2 broken — proving both the default include list (no
 *             `*.yaml`) and that the scan itself needs no config
 *
 * DELIBERATE DEVIATION (the suite's one, by design): the RFC's example text
 * shows exit code 1 for a broken-pointer run; this repo's error-band
 * convention is exit 2 for ANY error-level finding (`0` clean · `1`
 * warnings · `2` errors — the check contract everywhere else), and the
 * fixture ships `severity: error`. The suite pins exit 2. Everything else
 * follows the frozen contract verbatim.
 *
 * Runtime-neutral: imports the test facade, never 'bun:test' directly; CLI
 * runs are blackbox spawns via ./runtime.ts (CANS_ROOT pinned empty so the
 * walk-up resolution lands on the intended workspace).
 */
import { describe, test, expect, afterEach } from './testing.ts';
import { join } from 'path';
import { readFileSync, writeFileSync } from 'fs';

import { spawnCli } from './runtime.ts';
import { makeTmpDir, cleanTmpDir, copyFixtureToTmp } from './helpers.ts';

// ── harness ──────────────────────────────────────────────────────────────────

const tmps: string[] = [];

/** Fresh copy of the fixture into tmp: <tmp>/codebase-workspace/{cans,src}. */
function ws(name: string): string {
  const tmp = makeTmpDir(`issue66-integration-${name}`);
  tmps.push(tmp);
  return copyFixtureToTmp('codebase-workspace', tmp);
}

/** Blackbox spawn pinned to the copied project root. CANS_ROOT is pinned
 *  EMPTY so resolveWorkspaceRoot walks up from cwd and lands on the copied
 *  fixture's cans/ — never some ancestor workspace (the issue65 pattern). */
function runCli(args: string[], projectDir: string) {
  return spawnCli(args, projectDir, { ...process.env, CANS_ROOT: '' });
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
  return parsed;
}

afterEach(() => {
  while (tmps.length > 0) {
    cleanTmpDir(tmps.pop()!);
  }
});

// ── the fixture oracle, as numbers and records ───────────────────────────────
// (test/fixtures/codebase-workspace/README.md is the human-readable source
// of these — keep the two in sync; the files as committed are authoritative.)

/** routes.ts:3 — the broken slug: file resolves, `Qutas` matches no node of
 *  03-storage.md (near miss of Quotas → suggestion, never a pass). */
const BROKEN_ANCHOR = {
  type: 'CodebaseBrokenReference',
  file: 'src/api/routes.ts',
  line: 3,
  raw: 'see: 03-storage.md#Qutas',
  targetFile: '03-storage.md',
  targetSlug: 'Qutas',
  reason: 'AnchorNotFound',
};

/** quota.py:7 — the broken file: no corpus key `09-observability.md`, with
 *  or without a cans/ prefix. */
const BROKEN_FILE = {
  type: 'CodebaseBrokenReference',
  file: 'src/storage/quota.py',
  line: 7,
  raw: 'see: 09-observability.md',
  targetFile: '09-observability.md',
  targetSlug: null,
  reason: 'FileNotFound',
};

/** The two issues, in the contract's deterministic order (file asc, line asc). */
const ORACLE_ISSUES = [BROKEN_ANCHOR, BROKEN_FILE];

/** The exact wire keys a CodebaseIssueRecord may carry — no more, no fewer. */
const ISSUE_KEYS = ['type', 'file', 'line', 'raw', 'targetFile', 'targetSlug', 'reason'].sort();

// ── a: the broken-pointer run ────────────────────────────────────────────────

describe('issue #66 a — check --codebase on the broken-pointer workspace', () => {
  test('a1: non-zero exit, codebase block present, oracle counts exact', () => {
    const p = ws('a1');
    const r = runCli(['check', '--codebase', '--json'], p);
    // severity: error → the repo error-band convention: exit 2 (the suite's
    // one deliberate deviation from the RFC's example exit of 1 — see header).
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(false);
    expect(j.exitCode).toBe(2);
    expect(j.codebase).toBeDefined();
    expect(j.codebase.scanned).toBe(5); // rs + ts + go + py + yaml; cans/ always skipped
    expect(j.codebase.pointers).toBe(10);
    expect(j.codebase.broken).toBe(2);
    expect(j.codebase.issues).toEqual(ORACLE_ISSUES);
  });

  test('a2: every issue record carries EXACTLY the RFC §4.1 wire keys', () => {
    const p = ws('a2');
    const j = parseJsonOut(runCli(['check', '--codebase', '--json'], p).out);
    expect((j.codebase.issues as any[]).length).toBe(2);
    for (const issue of j.codebase.issues as any[]) {
      expect(Object.keys(issue).sort()).toEqual(ISSUE_KEYS);
    }
    // Order is part of the contract: file asc, line asc.
    expect((j.codebase.issues as any[]).map((i) => `${i.file}:${i.line}`)).toEqual([
      'src/api/routes.ts:3',
      'src/storage/quota.py:7',
    ]);
  });

  test('a3: the findings ride sections.refs as codebase.broken_reference errors', () => {
    const p = ws('a3');
    const j = parseJsonOut(runCli(['check', '--codebase', '--json'], p).out);
    const rides = (j.sections.refs as any[]).filter(
      (i) => i.rule === 'codebase.broken_reference' && i.level === 'error',
    );
    expect(rides.length).toBe(2);
    expect(rides.map((i) => `${i.file}:${i.line}`).sort()).toEqual([
      'src/api/routes.ts:3',
      'src/storage/quota.py:7',
    ]);
    // And they count like every band: error-level findings in errorCount.
    expect(j.counts.errors).toBeGreaterThanOrEqual(2);
  });

  test('a4: human output names the broken pointers (no JSON needed to see the rot)', () => {
    const p = ws('a4');
    const r = runCli(['check', '--codebase'], p);
    expect(r.exit).toBe(2);
    expect(r.out + r.err).toContain('src/api/routes.ts');
    expect(r.out + r.err).toContain('src/storage/quota.py');
  });
});

// ── b: fixing the pointers heals the run ─────────────────────────────────────

describe('issue #66 b — the fixed workspace exits 0 with an empty issues list', () => {
  test('b1: patch the two broken pointers in the tmp copy → exit 0, broken 0, issues []', () => {
    const p = ws('b1');
    // The fix the oracle prescribes: repair the slug (Quotas exists) and
    // repoint the missing file at a real one.
    const routesPath = join(p, 'src', 'api', 'routes.ts');
    writeFileSync(routesPath, readFileSync(routesPath, 'utf8').replace('#Qutas', '#Quotas'), 'utf8');
    const quotaPath = join(p, 'src', 'storage', 'quota.py');
    writeFileSync(
      quotaPath,
      readFileSync(quotaPath, 'utf8').replace('see: 09-observability.md', 'see: 07-network.md'),
      'utf8',
    );
    const r = runCli(['check', '--codebase', '--json'], p);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect(j.exitCode).toBe(0);
    // The phase ran (config-on) — the block is present with a clean outcome.
    expect(j.codebase).toBeDefined();
    expect(j.codebase.scanned).toBe(5);
    expect(j.codebase.pointers).toBe(10);
    expect(j.codebase.broken).toBe(0);
    expect(j.codebase.issues).toEqual([]);
  });
});

// ── c: the reverse-traceability query ────────────────────────────────────────

describe('issue #66 c — refs <node> --codebase lists the exact fixture hits', () => {
  test('c1: the anchored query answers routes.ts:2+6 and session.rs:2, exit 0', () => {
    const p = ws('c1');
    const r = runCli(['refs', '01-auth.md#Sessions', '--codebase', '--json'], p);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect(j.command).toBe('refs');
    expect(j.node).toBe('01-auth.md#Sessions'); // the query AS WRITTEN
    expect(j.scanned).toBe(5);
    // The `cans/`-prefixed spelling (routes.ts:2) resolves to the same
    // target, so it is among the hits. Order: file asc, line asc.
    expect(j.matches).toEqual([
      {
        file: 'src/api/routes.ts',
        line: 2,
        text: '// Auth middleware: see: cans/01-auth.md#Sessions — every route requires it.',
      },
      { file: 'src/api/routes.ts', line: 6, text: '  // login: see: 01-auth.md#Sessions' },
      {
        file: 'src/session.rs',
        line: 2,
        text: '// Initial handshake logic; see: 01-auth.md#Sessions for the canonical flow.',
      },
    ]);
  });

  test('c2: the file-level query answers every anchor into the file (incl. the tolerant slug)', () => {
    const p = ws('c2');
    const j = parseJsonOut(runCli(['refs', '01-auth.md', '--codebase', '--json'], p).out);
    expect(j.exit).toBe(0);
    expect(j.matches.map((m: any) => `${m.file}:${m.line}`)).toEqual([
      'src/api/routes.ts:2',
      'src/api/routes.ts:6',
      'src/session.rs:2',
      'src/session.rs:6',
      'src/session.rs:11', // `#token_validation` — tolerant match for `Token validation`
    ]);
  });

  test('c3: a no-match query is exit 0 with an empty answer (an empty answer is an answer)', () => {
    const p = ws('c3');
    const r = runCli(['refs', '03-storage.md#Timeouts', '--codebase', '--json'], p);
    expect(r.exit).toBe(0); // Timeouts lives in 07-network.md, not 03-storage.md
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect(j.matches).toEqual([]);
  });

  test('c4: human output lists the hits (file:line, the text as written)', () => {
    const p = ws('c4');
    const r = runCli(['refs', '01-auth.md#Sessions', '--codebase'], p);
    expect(r.exit).toBe(0);
    expect(r.out).toContain('src/api/routes.ts');
    expect(r.out).toContain('src/session.rs');
    expect(r.out).toContain('see: cans/01-auth.md#Sessions'); // the line text rides along
  });
});

// ── d: the flagless refusal ──────────────────────────────────────────────────

describe('issue #66 d — refs without --codebase refuses with guidance', () => {
  test('d1: non-zero exit, guidance names the knob, no matches field to misread', () => {
    const p = ws('d1');
    const r = runCli(['refs', '01-auth.md#Sessions'], p);
    expect(r.exit).not.toBe(0);
    expect(r.exit).not.toBeNull();
    // Guidance wording belongs to the CLI layer; the contract pins that the
    // refusal NAMES the knob so the fix is discoverable.
    expect(/codebase/i.test(r.out + r.err)).toBe(true);
  });
});

// ── e: scanner-off — the pre-#66 wire shape, byte-for-byte ───────────────────

describe('issue #66 e — no codebase block and no flag: the plain-check wire has NO codebase key', () => {
  test('e1: `check --json` (plain rules) is byte-shaped pre-#66: no codebase key, clean run', () => {
    const p = ws('e1');
    // The off-workspace: the SAME fixture minus the codebase block (the
    // corpus is refs-hub-clean, so the whole check is clean — exit 0).
    writeFileSync(
      join(p, 'cans', '_rules.yaml'),
      ['references:', '  back_pointers: false', ''].join('\n'),
      'utf8',
    );
    const r = runCli(['check', '--json'], p);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    // THE byte-shape assertion: the additive block is absent, not empty —
    // `codebase` must not appear at the top level at all.
    expect('codebase' in j).toBe(false);
    expect(j.codebase).toBeUndefined();
  });

  test('e2: with the block DISABLED (enabled: false) and no flag the scanner stays off too', () => {
    const p = ws('e2');
    writeFileSync(
      join(p, 'cans', '_rules.yaml'),
      [
        'references:',
        '  back_pointers: false',
        'codebase:',
        '  enabled: false',
        '',
      ].join('\n'),
      'utf8',
    );
    const r = runCli(['check', '--json'], p);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect('codebase' in j).toBe(false);
  });
});

// ── f: flag-on with no config block scans the defaults ───────────────────────

describe('issue #66 f — check --codebase with no config block still scans (the defaults)', () => {
  test('f1: the RFC §3 default include list — 4 files, 9 pointers, the same 2 broken, no yaml', () => {
    const p = ws('f1');
    writeFileSync(
      join(p, 'cans', '_rules.yaml'),
      ['references:', '  back_pointers: false', ''].join('\n'),
      'utf8',
    );
    const r = runCli(['check', '--codebase', '--json'], p);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.codebase).toBeDefined();
    // The default code-extension set has no *.yaml: src/net.yaml (and its
    // pointer) stay out of the scan — the config-on run sees 5/10 instead.
    expect(j.codebase.scanned).toBe(4);
    expect(j.codebase.pointers).toBe(9);
    expect(j.codebase.broken).toBe(2);
    expect(j.codebase.issues).toEqual(ORACLE_ISSUES);
    expect((j.codebase.issues as any[]).some((i) => i.file === 'src/net.yaml')).toBe(false);
  });
});
