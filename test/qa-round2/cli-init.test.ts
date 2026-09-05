/**
 * QA round-2, task 5-d — CLI arg-surface contracts & `init` — RED verification tests.
 *
 * Method: blackbox CLI spawn (`bun run src/cli.ts <args>`, cwd = scratch dir).
 * Every "red" test asserts the DOCUMENTED contract and therefore MUST currently
 * FAIL (assertion failure confirming the round-2 finding). "Control" tests pin
 * behavior that is already correct at HEAD and must pass.
 *
 * Findings encoded here (blackbox-verified at HEAD 09e16e5, see
 * agents/qa/QA-07/QA-09/QA-10 and the worklog entry for task 5-d):
 *
 *   QA-10 M1  (MAJOR)  status misdiagnoses rejected flags as "No cans workspace
 *                      found" in HUMAN mode, inside a valid workspace (C5/C7).
 *                      JSON mode of the same calls tells the truth.        [§37]
 *   QA-10 M2  (MAJOR)  budget read --limit value validation: `--limit abc`
 *                      silently ignored (default 4096, ok:true, exit 0);
 *                      `--limit -5` / tiny `--limit` exit 1 with the FALSE cause
 *                      `no files match concept "…"` although the concept
 *                      matches at `--limit 200`. (also QA-08 D9)  [§20/§37/§26]
 *   QA-10 M3  (MAJOR)  check silently swallows unknown long flags (`--bogus`
 *                      runs a full check, exit 0) and misparses short flags as
 *                      the [file] positional (`no spec file matches "-x"`).
 *                      Sibling commands (new/done/status) reject.      [§20]
 *   QA-10 A12 (DEVIATION) check --help silently runs a full check. --help must
 *                      show help or error, never silently execute.     [§37]
 *   QA-10 C19 (DEVIATION) budget --json read <concept>: the subcommand slot
 *                      eats `--json` → concept:"--json", ok:false. §20 flag
 *                      position flexibility (C2 verified the reverse order).
 *   QA-07 QA-01 #10 (REGRESSED) init --bare no longer creates cans/AGENTS.md
 *                      (file lands beside cans/ instead) while `cans help`
 *                      still advertises "Agents: cans/AGENTS.md". [§21/§36]
 *   QA-09 E1 / QA-01 #9 (MAJOR) init --force silently clobbers _collab/*
 *                      back to skeleton — §29 declares _collab/decisions.md
 *                      the APPEND-ONLY index; exit 0, no warning.     [§29/§21]
 *   QA-09 F4  (MAJOR)  init --tool claude poisons the workspace it just
 *                      created: CLAUDE.md discovered as a spec file → check
 *                      reports 2 hard errors, status counts 8 specs, export
 *                      emits CLAUDE.opml. Tool artifacts are instruction
 *                      files, not specs (AGENTS.md is already excluded).
 *                                                                         [§21/§22/§28]
 *   QA-10 A5  (MINOR)  help text drift: omits `--change` on the budget read
 *                      line and `[--json]` on the import/export lines although
 *                      §20:488–491 specify them and the flags work.
 *                                                                         [§20/§36]
 *
 * Out of scope here (owned by sibling agents): import/export round-trips,
 * refs/done semantics, rules engines, parser internals.
 *
 * Scratch dirs live under <repo>/.tmp/qa-round2/cli-init (gitignored). Names
 * are neutral (q5d-NN) so that directory paths can never collide with
 * assertion keywords embedded in CLI output.
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { join } from 'path';
import { mkdirSync, rmSync, existsSync, copyFileSync, readdirSync, appendFileSync, readFileSync } from 'node:fs';

const REPO = join(import.meta.dir, '..', '..');
const CLI = join(REPO, 'src', 'cli.ts');
const FIXTURES = join(REPO, 'test', 'fixtures');
const SCRATCH_BASE = join(REPO, '.tmp', 'qa-round2', 'cli-init');

/** Neutralize any ambient CANS_ROOT so workspace resolution is purely cwd-driven. */
const SPAWN_ENV: Record<string, string | undefined> = { ...process.env, CANS_ROOT: '' };

interface RunResult {
  exit: number | null;
  out: string;
  err: string;
}

function runCli(args: string[], cwd: string): RunResult {
  const p = Bun.spawnSync(['bun', 'run', CLI, ...args], {
    cwd,
    env: SPAWN_ENV,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { exit: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}

const created: string[] = [];

/** Fresh scratch dir (no workspace). */
function scratch(name: string): string {
  const dir = join(SCRATCH_BASE, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  created.push(dir);
  return dir;
}

/**
 * Scratch dir containing a VALID workspace built from a test fixture: the
 * fixture's spec files are copied into <dir>/cans/ (the layout the fixtures
 * model — they are the *contents* of a cans/ workspace).
 */
function fixtureWs(name: string, fixture: 'flat-project' | 'budget-project'): string {
  const dir = scratch(name);
  const cans = join(dir, 'cans');
  mkdirSync(cans, { recursive: true });
  for (const f of readdirSync(join(FIXTURES, fixture))) {
    const src = join(FIXTURES, fixture, f);
    if (f === '_tasks') {
      mkdirSync(join(cans, '_tasks'), { recursive: true });
      for (const t of readdirSync(src)) copyFileSync(join(src, t), join(cans, '_tasks', t));
    } else {
      copyFileSync(src, join(cans, f));
    }
  }
  return dir;
}

/** Scratch dir initialized via the real CLI (`cans init`), asserting setup. */
function initWs(name: string, initArgs: string[] = []): string {
  const dir = scratch(name);
  const r = runCli(['init', ...initArgs], dir);
  if (r.exit !== 0 || !existsSync(join(dir, 'cans'))) {
    throw new Error(`setup: init ${initArgs.join(' ')} failed in ${dir} (exit ${r.exit})\n${r.out}\n${r.err}`);
  }
  return dir;
}

/** Collect contract violations as strings; an empty array means the contract holds. */
function expectNoViolations(violations: string[]): void {
  expect(violations).toEqual([]);
}

afterEach(() => {
  for (const d of created.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe('QA round-2 task 5-d — CLI arg surface & init (red verification)', () => {
  // ── Controls (already correct at HEAD; must PASS) ────────────────────────

  test('control (expected PASS): status --json reports the TRUE flag error for rejected flags (§37; counterpart of QA-10 M1)', () => {
    // QA-10 M1 observed that the JSON emitter names the real usage error while
    // the human emitter replaces it with a false workspace diagnosis. The JSON
    // path is the correct behavior — pinned here so the M1 fix keeps it.
    const dir = fixtureWs('q5d-01-json-flag-errors', 'flat-project');
    const cases: Array<[string[], string]> = [
      [['status', '--bogus', '--json'], 'unknown flag "--bogus"'],
      [['status', '-j', '--json'], 'unknown flag "-j"'],
      [['status', '--', '--json'], 'unknown flag "--"'],
    ];
    for (const [args, expected] of cases) {
      const r = runCli(args, dir);
      expect(r.exit).toBe(1);
      let error = '';
      try {
        const j = JSON.parse(r.out) as { ok?: boolean; error?: string };
        error = j.error ?? '';
        expect(j.ok).toBe(false);
      } catch (e) {
        throw new Error(`\`${args.join(' ')}\` did not emit valid JSON: ${r.out}`);
      }
      expect(error).toContain(expected);
    }
  });

  test('control (expected PASS): cans help advertises "Agents: cans/AGENTS.md" (§36; companion pin for QA-07 QA-01 #10)', () => {
    // §36 help fixture: "Agents:  cans/AGENTS.md". The help text is correct
    // today — the bare init stopped matching it (see red QA-01 #10 test).
    const dir = scratch('q5d-02-help-agents');
    const r = runCli(['help'], dir);
    expect(r.exit).toBe(0);
    expect(r.out).toContain('AGENTS.md');
    expect(r.out).toMatch(/Agents:\s+cans\/AGENTS\.md/);
  });

  test('control (expected PASS): budget read Sessions --limit 200 --json succeeds — concept premise for the M2 red tests (§26)', () => {
    // Proves the concept "Sessions" exists and matches in the budget-project
    // fixture workspace; the M2 red tests rely on this premise (QA-10 C14:
    // "concept exists (plan non-empty at --limit 200)").
    const dir = fixtureWs('q5d-03-budget-premise', 'budget-project');
    const r = runCli(['budget', 'read', 'Sessions', '--limit', '200', '--json'], dir);
    expect(r.exit).toBe(0);
    const j = JSON.parse(r.out) as { ok: boolean; concept: string; plan: unknown[]; budgetLimit: number };
    expect(j.ok).toBe(true);
    expect(j.concept).toBe('Sessions');
    expect(j.budgetLimit).toBe(200);
    expect(j.plan.length).toBeGreaterThanOrEqual(1);
  });

  test('control (expected PASS): plain init (no --tool) yields a check-clean workspace (§21/§22; premise for QA-09 F4 red tests)', () => {
    // README quick-start contract: init then check is clean. Discriminates
    // the F4 red tests: the poisoning comes specifically from --tool claude.
    const dir = initWs('q5d-04-plain-init');
    const r = runCli(['check', '--json'], dir);
    expect(r.exit).toBe(0);
    const j = JSON.parse(r.out) as { ok: boolean; errorCount: number; files: number };
    expect(j.ok).toBe(true);
    expect(j.errorCount).toBe(0);
    expect(j.files).toBe(7);
    expect(r.out).not.toContain('CLAUDE');
  });

  // ── Red: QA-10 M1 — status false workspace diagnosis in human mode ───────

  test('red QA-10 M1 (C5/C7): status -j / --bogus / -- in a VALID workspace must name the flag problem, never diagnose a missing workspace (§37)', () => {
    // §37: "say what happened". In a valid workspace these rejections answer
    // `✗ No cans workspace found.` + "run `cans init`" — a false diagnosis
    // with harmful advice (the JSON mode of the same calls reports the true
    // error, see control above). The human output must state the actual flag
    // problem (unknown flag / short flag / echo the offending flag) and must
    // NOT contain the false workspace diagnosis.
    const dir = fixtureWs('q5d-05-status-human-flags', 'flat-project');
    const cases: Array<[string[], string]> = [
      [['status', '-j'], '-j'],
      [['status', '--bogus'], '--bogus'],
      [['status', '--'], '--'],
    ];
    const v: string[] = [];
    for (const [args, flag] of cases) {
      const r = runCli(args, dir);
      if (r.exit !== 1) v.push(`\`${args.join(' ')}\`: expected user-correctable exit 1, got ${r.exit}`);
      if (/no cans workspace found/i.test(r.out)) {
        v.push(`\`${args.join(' ')}\`: FALSE diagnosis "No cans workspace found." in a valid workspace:\n${r.out}`);
      }
      const namesFlagProblem = /unknown flag|short flag|no short flags/.test(r.out) || r.out.includes(flag);
      if (!namesFlagProblem) {
        v.push(`\`${args.join(' ')}\`: output never mentions the flag problem ('${flag}', "unknown flag", "short flag"):\n${r.out}`);
      }
    }
    expectNoViolations(v);
  });

  // ── Red: QA-10 M2 / QA-08 D9 — budget read --limit value validation ──────

  test('red QA-10 M2a (C13): budget read <concept> --limit abc must exit 1 naming the bad value, not silently apply the default limit (§20/§37)', () => {
    // §20 parser contract + §37 error philosophy: a non-numeric value for
    // `--limit` is user-correctable garbage input and must be rejected with a
    // message naming the offending value. Actual: silently ignored — default
    // 4096 budget, ok:true JSON, exit 0 (a typo degrades silently).
    const dir = fixtureWs('q5d-06-limit-abc', 'budget-project');
    const r = runCli(['budget', 'read', 'Sessions', '--limit', 'abc'], dir);
    const v: string[] = [];
    if (r.exit !== 1) v.push(`expected exit 1 for non-numeric --limit, got ${r.exit}`);
    if (!r.out.includes('abc')) {
      v.push(`error does not name the offending limit value "abc" (§37):\n${r.out}`);
    }
    try {
      const j = JSON.parse(r.out) as { ok?: boolean; plan?: unknown[] };
      if (j.ok === true) v.push(`ok:true success envelope returned for invalid --limit (silent ignore):\n${r.out}`);
    } catch {
      /* human text is an acceptable error path */
    }
    if (/Reading plan for/.test(r.out)) v.push(`success-shaped plan printed for invalid --limit:\n${r.out}`);
    expectNoViolations(v);
  });

  test('red QA-10 M2b (C14): budget read <concept> --limit -5 / --limit 1 must be truthful (invalid limit or empty plan) — never the FALSE "no files match" (§37/§26)', () => {
    // QA-10 C14: with concept "Sessions" matching at --limit 200 (control
    // above), `--limit -5` and `--limit 1` (1 < first item cost) exit 1 with
    // `✗ no files match concept "Sessions" — check spelling or run
    // `cans status`` — a false cause that sends the user spell-checking a
    // perfectly valid concept. Documented: reject the invalid limit with
    // what/fix, or report budget exhaustion / an empty plan truthfully.
    const dir = fixtureWs('q5d-07-limit-negative', 'budget-project');
    const v: string[] = [];
    for (const limit of ['-5', '1']) {
      const r = runCli(['budget', 'read', 'Sessions', '--limit', limit], dir);
      if (r.exit === 2) v.push(`--limit ${limit}: exit 2 (internal) — user-correctable input must be 1`);
      if (/no files match/i.test(r.out)) {
        v.push(`--limit ${limit}: FALSE cause "no files match concept" (concept matches at --limit 200):\n${r.out}`);
      }
      if (r.exit === 1 && !/--limit|\blimit\b|-5\b/.test(r.out)) {
        v.push(`--limit ${limit}: exit-1 error never mentions the invalid limit (§37):\n${r.out}`);
      }
      if (r.exit === 0) {
        // Only acceptable as a truthful empty plan (budget exhausted before
        // the first item) — not as a silently-ignored or "unlimited" limit.
        let truthfulEmpty = false;
        try {
          const j = JSON.parse(r.out) as { ok?: boolean; plan?: unknown[]; budgetLimit?: number };
          truthfulEmpty = j.ok === true && Array.isArray(j.plan) && j.plan.length === 0;
        } catch {
          truthfulEmpty = /empty|no files|0 files/i.test(r.out);
        }
        if (!truthfulEmpty) v.push(`--limit ${limit}: exit 0 without a truthful empty plan (limit silently ignored?):\n${r.out}`);
      }
    }
    expectNoViolations(v);
  });

  // ── Red: QA-10 M3 — check swallows unknown flags / misparses short flags ─

  test('red QA-10 M3a: check --bogus must be rejected with an unknown-flag error — not silently run a full check with exit 0 (§20/§37)', () => {
    // §20: "Primitive. `--flag value` only." — unknown flags are rejected by
    // new/done/status/init/budget (QA-10 C18/C5/C3). check is the outlier:
    // `--bogus` silently triggers a FULL check (exit 0) — a `--strcit` typo
    // would silently downgrade strictness in CI.
    const dir = fixtureWs('q5d-08-check-bogus', 'flat-project');
    const r = runCli(['check', '--bogus'], dir);
    const v: string[] = [];
    if (r.exit !== 1) v.push(`expected exit 1 for unknown flag, got ${r.exit} (full check silently ran?)`);
    if (!/unknown flag|--bogus/.test(r.out)) {
      v.push(`output does not report the unknown flag "--bogus" (§37):\n${r.out}`);
    }
    if (/\d+ errors?, \d+ warnings?/.test(r.out) || /^References\b/m.test(r.out) || /Collapse to sibling style/.test(r.out)) {
      v.push(`a full check report was produced despite the unknown flag:\n${r.out}`);
    }
    expectNoViolations(v);
  });

  test('red QA-10 M3b (C6): check -x must produce a short-flag error — not treat it as the [file] positional "no spec file matches" (§20 "no short flags")', () => {
    // §20: "No short flags, no combined flags." `check -j`/`-h`/`-x` are
    // currently consumed as the [file] positional (`✗ no spec file matches
    // "-x"`) — §37-shaped text but a misread of a flag as a file.
    const dir = fixtureWs('q5d-09-check-short', 'flat-project');
    const r = runCli(['check', '-x'], dir);
    const v: string[] = [];
    if (r.exit !== 1) v.push(`expected exit 1 for short flag, got ${r.exit}`);
    if (/no spec file matches/i.test(r.out)) {
      v.push(`short flag misparsed as a [file] positional ("no spec file matches"):\n${r.out}`);
    }
    if (!/unknown flag|short flag|no short flags/.test(r.out)) {
      v.push(`output does not name the short-flag problem (§20/§37):\n${r.out}`);
    }
    expectNoViolations(v);
  });

  // ── Red: QA-10 A12 — check --help silently executes a full check ─────────

  test('red QA-10 A12: check --help must show help or a flag error — never silently execute a full check (§37 spirit; QA-10 DEVIATION)', () => {
    // `cans --help` shows help and `new --bogus` errors, but `check --help`
    // swallows the flag and runs the whole validation suite (exit 0). A
    // --help invocation must never have side effects or pretend to succeed
    // as a check run.
    const dir = fixtureWs('q5d-10-check-help', 'flat-project');
    const r = runCli(['check', '--help'], dir);
    const v: string[] = [];
    if (r.exit === 2) v.push(`exit 2 (internal) — --help must be help (0) or a flag error (1)`);
    const looksLikeHelpOrError = /usage|help|unknown flag|unsupported|unrecognized/i.test(r.out);
    if (!looksLikeHelpOrError) {
      v.push(`output is neither help nor a flag error for --help:\n${r.out}`);
    }
    if (/\d+ errors?, \d+ warnings?/.test(r.out) || /^References\b/m.test(r.out) || /^Style\b/m.test(r.out)) {
      v.push(`--help silently RAN a full check (summary/report sections present):\n${r.out}`);
    }
    expectNoViolations(v);
  });

  // ── Red: QA-10 C19 — budget subcommand slot eats --json ──────────────────

  test('red QA-10 C19: budget --json read Sessions must behave like budget read Sessions --json — concept must be "Sessions", not "--json" (§20 flag position flexibility)', () => {
    // QA-10 C2 verified `budget read --json <concept>`-style flag-position
    // flexibility; the mirror order `budget --json read <concept>` lets the
    // subcommand slot eat `--json`: envelope `concept:"--json"`, ok:false,
    // exit 1. §20 fixes flag forms, not flag positions.
    const dir = fixtureWs('q5d-11-budget-flag-order', 'budget-project');
    const r = runCli(['budget', '--json', 'read', 'Sessions'], dir);
    let j: { ok?: boolean; concept?: string; error?: string };
    try {
      j = JSON.parse(r.out);
    } catch {
      throw new Error(`did not emit valid JSON:\n${r.out}`);
    }
    expect(j.concept).toBe('Sessions'); // actual: "--json"
    expect(j.ok).toBe(true); // actual: false (unknown subcommand "--json")
    expect(r.exit).toBe(0);
  });

  // ── Red: QA-07 QA-01 #10 REGRESSED — init --bare loses cans/AGENTS.md ────

  test('red QA-07 QA-01 #10 (REGRESSED): init --bare must create cans/AGENTS.md per the §21 skeleton + §36 help contract', () => {
    // QA-01 #10 recorded `init --bare` = _rules.yaml + AGENTS.md +
    // 00-overview.md inside cans/. Now AGENTS.md is emitted BESIDE cans/
    // (project root) while `cans help` still advertises "Agents:
    // cans/AGENTS.md" (control above) — a behavior change that breaks the
    // documented help contract and leaves the bare skeleton inconsistent.
    const dir = initWs('q5d-12-init-bare', ['--bare']);
    const v: string[] = [];
    if (!existsSync(join(dir, 'cans', '_rules.yaml'))) v.push('premise: cans/_rules.yaml missing');
    if (!existsSync(join(dir, 'cans', '00-overview.md'))) v.push('premise: cans/00-overview.md missing');
    if (!existsSync(join(dir, 'cans', 'AGENTS.md'))) {
      v.push(
        'cans/AGENTS.md does not exist after `init --bare` — AGENTS.md was emitted beside cans/ instead; ' +
          'help still advertises "Agents: cans/AGENTS.md" (§21/§36; QA-07 QA-01 #10 REGRESSED)',
      );
    }
    expectNoViolations(v);
  });

  // ── Red: QA-09 E1 / QA-01 #9 — init --force clobbers _collab/* ───────────

  test('red QA-09 E1 (QA-01 #9): init --force must preserve the append-only _collab coordination state (§29/§21)', () => {
    // §29: `_collab/decisions.md` is the APPEND-ONLY ADR index;
    // handoffs/conflicts carry live multi-agent coordination state. §21's
    // --force contract covers regenerating the skeleton — it must not
    // annihilate coordination content with exit 0 and no warning.
    const dir = initWs('q5d-13-init-force-collab');
    const collab = join(dir, 'cans', '_collab');
    appendFileSync(join(collab, 'decisions.md'), '\n- 2026-09-04: marker decision alpha → see _adr/001-alpha.md\n');
    appendFileSync(join(collab, 'handoffs.md'), '\nHANDOFF-MARKER-ALPHA custom handoff context\n');
    appendFileSync(join(collab, 'conflicts.md'), '\nCONFLICT-MARKER-ALPHA status: unresolved\n');

    const v: string[] = [];
    const f = runCli(['init', '--force'], dir);
    // A compliant fix may either preserve the files or refuse/demand
    // confirmation — both keep the markers. Only silent annihilation fails.
    if (f.exit === 2) v.push(`init --force exit 2 (internal error): ${f.out}${f.err}`);

    const decisions = readIfExists(join(collab, 'decisions.md'));
    if (decisions === null || !decisions.includes('marker decision alpha')) {
      v.push(`_collab/decisions.md (§29 APPEND-ONLY index) was reset/clobbered by init --force:\n${decisions ?? '<missing>'}`);
    }
    const handoffs = readIfExists(join(collab, 'handoffs.md'));
    if (handoffs === null || !handoffs.includes('HANDOFF-MARKER-ALPHA')) {
      v.push(`_collab/handoffs.md was reset/clobbered by init --force:\n${handoffs ?? '<missing>'}`);
    }
    const conflicts = readIfExists(join(collab, 'conflicts.md'));
    if (conflicts === null || !conflicts.includes('CONFLICT-MARKER-ALPHA')) {
      v.push(`_collab/conflicts.md was reset/clobbered by init --force:\n${conflicts ?? '<missing>'}`);
    }
    expectNoViolations(v);
  });

  // ── Red: QA-09 F4 — init --tool claude poisons the workspace ─────────────

  test('red QA-09 F4a: after init --tool claude, check must be clean (exit 0, 0 errors) and CLAUDE.md must not be discovered as a spec (§21/§22/§32)', () => {
    // §21 emits CLAUDE.md as an instruction artifact; §22/§32 exclude
    // instruction files (AGENTS.md) from spec discovery. Actual: CLAUDE.md is
    // discovered as an 8th spec — check reports 2 hard errors (bogus broken
    // ref from template inline code + code fence), status counts 8 specs —
    // breaking the README quick-start contract (init; check clean) the moment
    // the documented --tool flag is used.
    const dir = initWs('q5d-14-tool-claude', ['--tool', 'claude']);
    expect(existsSync(join(dir, 'cans', 'CLAUDE.md'))).toBe(true); // premise: artifact emitted

    const c = runCli(['check', '--json'], dir);
    const v: string[] = [];
    if (c.exit !== 0) v.push(`check exit ${c.exit} — a freshly init'ed (--tool claude) workspace must check clean (README quick-start)`);
    try {
      const j = JSON.parse(c.out) as { ok?: boolean; errorCount?: number; files?: number; issues?: Array<{ file?: string; message?: string }> };
      if (j.errorCount !== 0) v.push(`check errorCount ${j.errorCount} (expected 0) — CLAUDE.md parsed as spec: ${JSON.stringify(j.issues?.filter(i => i.file?.includes('CLAUDE')))}`);
      if (j.files !== 7) v.push(`check files ${j.files} (expected 7) — CLAUDE.md counted as a spec file`);
    } catch {
      v.push(`check --json did not emit valid JSON:\n${c.out}`);
    }

    const s = runCli(['status', '--json'], dir);
    try {
      const j = JSON.parse(s.out) as { specFiles?: number };
      if (j.specFiles !== 7) v.push(`status specFiles ${j.specFiles} (expected 7) — tool artifact counted as spec`);
    } catch {
      v.push(`status --json did not emit valid JSON:\n${s.out}`);
    }
    expectNoViolations(v);
  });

  test('red QA-09 F4b: export opml after init --tool claude must not emit any CLAUDE artifact (§28 exclusion rules)', () => {
    // §28 excludes instruction artifacts from export (AGENTS.md is already
    // excluded). Actual: export emits CLAUDE.opml and reports filesExported: 8.
    const dir = initWs('q5d-15-tool-export', ['--tool', 'claude']);
    const r = runCli(['export', 'opml', '--json'], dir);
    const v: string[] = [];
    let filesExported = -1;
    try {
      const j = JSON.parse(r.out) as { ok?: boolean; filesExported?: number };
      if (j.ok !== true) v.push(`export --json not ok:\n${r.out}`);
      filesExported = j.filesExported ?? -1;
    } catch {
      v.push(`export --json did not emit valid JSON:\n${r.out}`);
    }
    const outDir = join(dir, 'cans-export', 'opml');
    if (existsSync(join(outDir, 'CLAUDE.opml'))) {
      v.push('CLAUDE.opml was emitted — tool artifact leaked into export (§28)');
    }
    if (existsSync(outDir)) {
      const leaked = readdirSync(outDir).filter(f => /claude/i.test(f));
      if (leaked.length > 0) v.push(`CLAUDE-named export artifacts present: ${leaked.join(', ')}`);
    }
    if (filesExported !== 7) v.push(`filesExported ${filesExported} (expected 7) — export counted the tool artifact`);
    expectNoViolations(v);
  });

  // ── Red: QA-10 A5 — help text drift vs §20:488-491 ───────────────────────

  test('red QA-10 A5: help must document the working flags --change (budget read) and [--json] (import/export) per §20:488-491', () => {
    // §20:488-491: `budget read <concept> [--limit <tokens>] [--change <name>]
    // [--json]`, import/export lines ending in [--json]. The flags WORK
    // (verified blackbox: `budget read sessions --change add-dark-mode`,
    // `import opml <p> --json`, `export opml --json`) — only help omits them,
    // so agents reading help cannot discover them. Pinned loosely on flag
    // presence near the right command, within a single help line.
    const dir = scratch('q5d-16-help-drift');
    const r = runCli(['help'], dir);
    expect(r.exit).toBe(0);
    const v: string[] = [];
    if (!/budget read <concept>[^\n]*--change/.test(r.out)) {
      v.push('help budget read line omits --change (§20:488; flag is implemented)');
    }
    if (!/import <format> <path>[^\n]*\[--json\]/.test(r.out)) {
      v.push('help import line omits [--json] (§20:490; flag is implemented)');
    }
    if (!/export <format>[^\n]*\[--json\]/.test(r.out)) {
      v.push('help export line omits [--json] (§20:491; flag is implemented)');
    }
    expectNoViolations(v);
  });
});

/** Small helper: read a file or null. */
function readIfExists(p: string): string | null {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}
