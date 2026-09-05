/**
 * QA-06 CLI surface contracts — RED verification tests.
 *
 * Method: blackbox CLI spawn (`bun run src/cli.ts <args>`, cwd = scratch dir).
 * Every non-control test asserts the DOCUMENTED contract and therefore MUST
 * currently FAIL (assertion failure confirming the QA-06 finding). Controls pass.
 *
 * Findings encoded here (see agents/qa/QA-06-cli-surface-contracts.md):
 *   finding 2  (MAJOR) missing required args → blank-filled success-shaped output   [§37]
 *   finding 3  (MAJOR) unknown command / no args → bare message-less JSON           [§37, §19]
 *   finding 4  (MAJOR) malformed/unknown flags silently swallowed                   [§20 "Primitive. --flag value only.", §37]
 *   finding 6  (MAJOR) no-workspace handling inconsistent / auto-vivifying          [§25, §37]
 *   finding 9  (MINOR) malformed workspace entries silently tolerated by check      [§37]
 *   finding 11 (UX)   no --help / --version shortcuts                               [§44, §20]
 *   finding 12 (UX)   dry-run claims a completed side effect                        [§19 spirit]
 *
 * Out of scope here (owned by sibling agents): `done` diagnosis + `new --json`
 * flag-swallowing (QA-04), init/workspace lifecycle (QA-01), budget engine
 * internals + budget no-workspace (QA-03).
 *
 * Scratch dirs live under <repo>/.tmp/qa-verify/qa06-* (gitignored). NOTE: names
 * deliberately avoid words that double as assertion keywords (e.g. "dry-run",
 * "concept") because some CLI outputs embed cwd paths.
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { join } from 'path';
import { mkdirSync, rmSync, existsSync } from 'node:fs';

const REPO = join(import.meta.dir, '..', '..');
const CLI = join(REPO, 'src', 'cli.ts');
const SCRATCH_BASE = join(REPO, '.tmp', 'qa-verify');

/** Neutralize any ambient CANS_ROOT so workspace resolution is purely cwd-driven. */
const SPAWN_ENV: Record<string, string | undefined> = { ...process.env, CANS_ROOT: '' };

function runCli(args: string[], cwd: string): { exit: number | null; out: string; err: string } {
  const p = Bun.spawnSync(['bun', 'run', CLI, ...args], {
    cwd,
    env: SPAWN_ENV,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { exit: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}

const created: string[] = [];

/** Fresh empty scratch dir; opts.ws builds a healthy workspace via `cans init` (7 specs). */
function scratch(name: string, opts?: { ws?: boolean }): string {
  const dir = join(SCRATCH_BASE, `qa06-${name}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  created.push(dir);
  if (opts?.ws) {
    const r = runCli(['init'], dir);
    if (r.exit !== 0 || !existsSync(join(dir, 'cans'))) {
      throw new Error(`setup: init failed in ${dir} (exit ${r.exit})\n${r.out}\n${r.err}`);
    }
  }
  return dir;
}

afterEach(() => {
  for (const d of created.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

/** Collect contract violations as strings; an empty array means the contract holds. */
function expectNoViolations(violations: string[]): void {
  expect(violations).toEqual([]);
}

describe('QA-06 CLI surface (red verification)', () => {
  // ── Control ──────────────────────────────────────────────────────────────

  test('control (expected PASS): cans help prints full help text, exit 0 (§36)', () => {
    // §36 fixture contract: `cans help` output starts with the CANS banner,
    // lists every command with its flags, and ends with the Formats trailer.
    const dir = scratch('control-help');
    const r = runCli(['help'], dir);
    expect(r.exit).toBe(0);
    expect(r.out).toContain('CANS — Canonical Agent-Native Spec');
    expect(r.out).toContain('Usage: cans <command> [args]');
    expect(r.out).toContain('check [--fix] [--strict] [--refs-only] [--no-redundancy] [file] [--json]');
    // Updated: help now mirrors §20:488 verbatim — the budget read line
    // documents the (working) --change flag (QA-10 A5).
    expect(r.out).toContain('budget read <concept> [--limit <tokens>] [--change <name>] [--json]');
    expect(r.out).toContain('Formats: opml, dynalist, logseq, obsidian');
    expect(r.err).toBe('');
  });

  // ── Finding 3: unknown command / no args must communicate (§37, §19) ─────

  test('finding 3a: unknown command says what happened and how to fix it (§37)', () => {
    // §37: "say what happened… never error codes without messages". A bare
    // JSON body with no message in default (human) mode communicates nothing:
    // the user must get a human hint (e.g. "Unknown command… run `cans help`")
    // or, at minimum, a JSON payload that carries a message/error field.
    const dir = scratch('f3-unknown');
    const r = runCli(['frobnicate'], dir);
    const v: string[] = [];
    if (r.exit !== 1) v.push(`expected user-correctable exit 1, got ${r.exit}`);
    const humanHint = /help|unknown command|not a (valid )?command/i.test(r.out);
    // JSON.parse failure here is legitimate discrimination (human text is an
    // acceptable fix path), not swallowing: absence of a message field still
    // records a violation below.
    let jsonMessage = false;
    try {
      const j = JSON.parse(r.out) as Record<string, unknown>;
      jsonMessage =
        (typeof j.message === 'string' && j.message.length > 0) ||
        (typeof j.error === 'string' && j.error.length > 0);
    } catch {
      /* not JSON — human text path */
    }
    if (!humanHint && !jsonMessage) {
      v.push(
        `no remedy hint ('help' / 'Unknown command') and no message/error field — ` +
          `bare message-less output: ${JSON.stringify(r.out)}`,
      );
    }
    expectNoViolations(v);
  });

  test('finding 3b: no args shows help or guidance, not bare JSON (§36/§37)', () => {
    // With no command given, the CLI must orient the user (print help or name
    // the remedy), not emit {"ok":false,"command":"unknown"} with no message.
    const dir = scratch('f3-noargs');
    const r = runCli([], dir);
    const v: string[] = [];
    if (r.exit !== 1) v.push(`expected exit 1 for missing command, got ${r.exit}`);
    const guided = /usage:|commands:|help/i.test(r.out);
    let jsonMessage = false;
    try {
      const j = JSON.parse(r.out) as Record<string, unknown>;
      jsonMessage =
        (typeof j.message === 'string' && j.message.length > 0) ||
        (typeof j.error === 'string' && j.error.length > 0);
    } catch {
      /* not JSON — human text path */
    }
    if (!guided && !jsonMessage) {
      v.push(`no help/guidance and no message field in: ${JSON.stringify(r.out)}`);
    }
    expectNoViolations(v);
  });

  // ── Finding 4: malformed/unknown flags must not be silently swallowed ────

  test('finding 4a: budget read sessions --limit=10 is rejected or warned, not ignored (§20)', () => {
    // §20: "Primitive. `--flag value` only. No `--flag=value`." — the equals
    // form is not a supported argument form, so the CLI must reject it or warn
    // about it. Silently returning the UNLIMITED plan with exit 0 (as today)
    // hides a typo from the user/agent.
    const dir = scratch('f4-equals', { ws: true });
    const r = runCli(['budget', 'read', 'sessions', '--limit=10'], dir);
    const v: string[] = [];
    const flagged = /--limit=10|\blimit\b|equals|unsupported|unrecognized|unknown|invalid|malformed|flag|usage/i.test(r.out);
    if (!(r.exit !== 0 || flagged)) {
      v.push(
        `equals-form flag silently ignored: exit 0 with no mention of '--limit=10' — ` +
          `unlimited plan returned as if no flag was passed. stdout:\n${r.out}`,
      );
    }
    expectNoViolations(v);
  });

  test('finding 4b+4c: status --bogus / status -j are rejected or warned, not ignored (§20)', () => {
    // §20 defines no `--bogus` flag and no short flags at all ("No short
    // flags, no combined flags"). Unknown/short flags must error or warn;
    // silently running normal status (exit 0) is worse for `-j`: the user
    // asked for JSON and silently gets human text (§19 flag contract).
    const dir = scratch('f4-statusflags', { ws: true });
    const v: string[] = [];
    const cases: Array<[string[], string]> = [
      [['status', '--bogus'], '--bogus'],
      [['status', '-j'], '-j'],
    ];
    for (const [args, flag] of cases) {
      const r = runCli(args, dir);
      const flagged = new RegExp(
        `${flag.replace(/[-]/g, '\\$&')}|unknown|unrecognized|invalid|unsupported|short flag|flag|usage`,
        'i',
      ).test(r.out);
      if (!(r.exit !== 0 || flagged)) {
        v.push(
          `\`${args.join(' ')}\` silently ignored: exit 0, no mention of '${flag}' — ` +
            `normal human status returned. stdout:\n${r.out}`,
        );
      }
    }
    expectNoViolations(v);
  });

  test('finding 4d: budget read sessions --limit (missing value) is rejected or warned (§20/§37)', () => {
    // §20/§37: a flag with a missing value is malformed input. Silently
    // applying the default limit and exiting 0 hides the mistake.
    const dir = scratch('f4-novalue', { ws: true });
    const r = runCli(['budget', 'read', 'sessions', '--limit'], dir);
    const v: string[] = [];
    const flagged = /--limit|\blimit\b|missing|requires|malformed|invalid|unrecognized|unknown|flag|usage/i.test(r.out);
    if (!(r.exit !== 0 || flagged)) {
      v.push(
        `'--limit' without a value silently ignored: exit 0, no mention of the malformed flag — ` +
          `default (unlimited) plan returned. stdout:\n${r.out}`,
      );
    }
    expectNoViolations(v);
  });

  // ── Finding 2: missing required args need real error messages (§37) ──────

  test('finding 2a: budget read (no concept) states the missing requirement (§37)', () => {
    // §37: errors must say what happened. Currently: success template
    // "Reading plan for: " with a BLANK concept + "Budget: 0 / 0 tokens (0%)".
    const dir = scratch('f2-budget-arg', { ws: true });
    const r = runCli(['budget', 'read'], dir);
    const v: string[] = [];
    if (r.exit !== 1) v.push(`expected exit 1 for missing required arg, got ${r.exit}`);
    if (/^Reading plan for:\s*$/m.test(r.out)) {
      v.push(`success template printed with a BLANK concept ("Reading plan for: ")\nstdout:\n${r.out}`);
    }
    if (!/concept|usage|required|missing|argument/i.test(r.out)) {
      v.push(`message does not state the missing requirement (concept/usage/required)\nstdout:\n${r.out}`);
    }
    expectNoViolations(v);
  });

  test('finding 2b: import (bare) states the missing format/path (§37)', () => {
    // §37: currently "Imported  from " — success-shaped output with blanks.
    // Must be a real usage/error message naming format (and path).
    const dir = scratch('f2-import-bare', { ws: true });
    const r = runCli(['import'], dir);
    const v: string[] = [];
    if (r.exit !== 1) v.push(`expected exit 1 for missing required args, got ${r.exit}`);
    if (/Imported\s+from/.test(r.out)) {
      v.push(`success-shaped output with blanks ("Imported  from ") printed\nstdout:\n${r.out}`);
    }
    if (!/format|path|usage|required|missing|argument/i.test(r.out)) {
      v.push(`message does not name the missing requirement (format/path/usage)\nstdout:\n${r.out}`);
    }
    expectNoViolations(v);
  });

  test('finding 2c: export (bare) states the missing format + valid formats (§37)', () => {
    // §37: currently "Exported  →  (0 files)" — success-shaped blanks. Must
    // be a real usage/error message naming the format requirement.
    const dir = scratch('f2-export-bare', { ws: true });
    const r = runCli(['export'], dir);
    const v: string[] = [];
    if (r.exit !== 1) v.push(`expected exit 1 for missing required arg, got ${r.exit}`);
    if (/Exported\s+→/.test(r.out)) {
      v.push(`success-shaped output with blanks ("Exported  →  (0 files)") printed\nstdout:\n${r.out}`);
    }
    if (!/format|opml|dynalist|logseq|obsidian|usage|required|missing|argument/i.test(r.out)) {
      v.push(`message does not name the missing requirement (format/usage)\nstdout:\n${r.out}`);
    }
    expectNoViolations(v);
  });

  // ── Finding 6: no-workspace handling must be consistent + informative ────

  test('finding 6a: status without workspace explains the missing workspace (§25/§37)', () => {
    // §25: status "only exits 1 if cans/ missing" — exit 1 is correct, but
    // §37 requires it to SAY why. Currently a success-looking all-zeros
    // report with no explanation (check's "no cans workspace found — run
    // `cans init`" is the gold standard).
    const dir = scratch('f6-status');
    const r = runCli(['status'], dir);
    const v: string[] = [];
    if (r.exit !== 1) v.push(`§25: status without cans/ must exit 1, got ${r.exit}`);
    if (!/no cans workspace|workspace not found|cans init/i.test(r.out)) {
      v.push(`no explanation of the missing workspace — success-looking zero report\nstdout:\n${r.out}`);
    }
    expectNoViolations(v);
  });

  test('finding 6b: export opml without workspace refuses, exit != 0 + explanation (§25/§37)', () => {
    // Exporting from a nonexistent workspace must not masquerade as success
    // ("Exported opml → … (0 files)"). Must refuse with the standard
    // "no cans workspace — run `cans init`" guidance.
    const dir = scratch('f6-export');
    const r = runCli(['export', 'opml'], dir);
    const v: string[] = [];
    if (r.exit === 0) {
      v.push(`exit 0 — exporting from no workspace must not report success\nstdout:\n${r.out}`);
    }
    if (!/no cans workspace|cans init/i.test(r.out)) {
      v.push(`no explanation of the missing workspace\nstdout:\n${r.out}`);
    }
    expectNoViolations(v);
  });

  test('finding 6c: new task foo without workspace refuses and does not auto-vivify cans/ (§37)', () => {
    // Only `init` may create cans/ (§21). `new` must refuse with the standard
    // message; it must NOT silently create a partial workspace (cans/_tasks/
    // foo.md) at exit 0.
    const dir = scratch('f6-new');
    const r = runCli(['new', 'task', 'foo'], dir);
    const v: string[] = [];
    if (r.exit === 0) {
      v.push(`exit 0 — new must refuse when no workspace exists\nstdout:\n${r.out}`);
    }
    if (existsSync(join(dir, 'cans'))) {
      v.push(`auto-vivified a partial cans/ workspace (cans/_tasks/foo.md created)`);
    }
    if (!/no cans workspace|cans init/i.test(r.out)) {
      v.push(`no "no cans workspace — run cans init" guidance\nstdout:\n${r.out}`);
    }
    expectNoViolations(v);
  });

  // ── Finding 9: malformed workspace entries must not be silently tolerated ─

  test('finding 9: check reports a directory named like a spec file, not silent skip (§37)', () => {
    // A directory `cans/02-authentication.md/` is a malformed workspace entry
    // (EISDIR trap). Currently check silently skips it: 7 files → 6, exit 0,
    // zero issues. §37: a workspace problem the user can fix must be reported
    // (warning or error naming the entry). The stub workspace has no refs, so
    // any issue mentioning the entry can only be the malformed-entry report.
    const dir = scratch('f9-malformed', { ws: true });
    const cans = join(dir, 'cans');
    rmSync(join(cans, '02-authentication.md')); // swap real file for a directory
    mkdirSync(join(cans, '02-authentication.md'));
    const r = runCli(['check', '--json'], dir);
    const v: string[] = [];
    let issues: Array<{ file?: string; message?: string }> = [];
    let json = true;
    try {
      issues = (JSON.parse(r.out) as { issues?: Array<{ file?: string; message?: string }> }).issues ?? [];
    } catch {
      json = false; // human text fallback below
    }
    const reported =
      issues.some(i => `${i.file ?? ''} ${i.message ?? ''}`.includes('02-authentication.md')) ||
      (!json &&
        /02-authentication\.md/.test(r.out) &&
        /malformed|director|EISDIR|unreadable|skipped|invalid|not a (file|regular)/i.test(r.out));
    if (!reported) {
      v.push(
        `malformed entry cans/02-authentication.md/ silently skipped — no issue names it ` +
          `(${issues.length} issues, none mention the entry), exit ${r.exit}`,
      );
    }
    expectNoViolations(v);
  });

  // ── Finding 11: conventional --help / --version shortcuts (§20/§44) ──────

  test('finding 11a: cans --help prints help and exits 0 (§36/§20)', () => {
    // `-h`/`--help` are conventional. Currently rejected as an unknown command
    // with bare JSON exit 1.
    const dir = scratch('f11-helpflag');
    const r = runCli(['--help'], dir);
    expect(r.exit).toBe(0);
    expect(r.out).toContain('Usage: cans <command> [args]');
  });

  test('finding 11b: cans --version prints a version string, exit 0 (§44)', () => {
    // §44 defines a version line (0.1.0 — Day 1 ship) but the CLI exposes no
    // version surface at all; currently `--version` → bare JSON, exit 1.
    const dir = scratch('f11-version');
    const r = runCli(['--version'], dir);
    expect(r.exit).toBe(0);
    expect(r.out).toMatch(/\d+\.\d+\.\d+/);
  });

  // ── Finding 12: --dry-run must not claim a completed side effect (§19) ───

  test('finding 12: export opml --dry-run output is marked as a dry run (§19 spirit)', () => {
    // A dry run performs no mutation, so its output must not claim one.
    // Currently identical to a real run: "Exported opml → … (N files)".
    // Fix may either mark the human text (DRY RUN / would export) or, in JSON
    // mode, expose dryRun:true.
    const dir = scratch('f12-exportmark', { ws: true });
    const r = runCli(['export', 'opml', '--dry-run'], dir);
    const v: string[] = [];
    const marked = /dry.?run|would (export|write|create)/i.test(r.out);
    let jsonMarked = false;
    try {
      jsonMarked = (JSON.parse(r.out) as Record<string, unknown>).dryRun === true;
    } catch {
      /* human text — marker regex above is the check */
    }
    if (!marked && !jsonMarked) {
      v.push(
        `--dry-run output claims a completed export with no dry-run marker (exit ${r.exit})\nstdout:\n${r.out}`,
      );
    }
    expectNoViolations(v);
  });
});
