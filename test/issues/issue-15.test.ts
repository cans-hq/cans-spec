/**
 * Issue #15 regression tests — `cans budget read <concept>` with a small
 * token_budget.default_limit in _rules.yaml exits 1 with the FALSE cause
 * "no files match concept" although the concept matches: the QA-10 M2b
 * empty-plan diagnosis (src/commands/budget.ts) only ran when the limit came
 * from an explicit --limit flag, and its "unbounded" comparison plan silently
 * fell back to the same small default_limit — so a config-derived limit fell
 * straight through to noMatchError() (§19/§26/§37).
 *
 * Fixed semantics: whenever the plan is empty AND a truly unbounded plan for
 * the same concept is non-empty, the error must report the limit problem and
 * name the actual source — `--limit N` or
 * `token_budget.default_limit (N) in _rules.yaml` — plus the top-priority item
 * that busts it (file + estTokens). With the issue #16 best-effort packer, a
 * default_limit that can afford the back-ref yields a NON-empty partial plan
 * (success + skipped list), so "no match" vs "limit too small" must stay
 * correct in BOTH the empty-plan and the partial-plan case.
 *
 * Workspace (token costs verified against the real estimator, 3.5 chars/token):
 *   00-overview.md  no connection            → skipped (non-matching)
 *   01-auth.md      canonical home, 32 tok   (score 100)
 *   02-api.md       see: back-ref, 12 tok    (score 60)
 *
 * Test map:
 *   a (CLI)          default_limit 10 (below every item), no flag → exit 1
 *                    error names token_budget.default_limit (10) in
 *                    _rules.yaml + the top-priority item 01-auth.md (32 tok)
 *                    + the remedy; never the false "no files match".
 *   b (CLI --json)   same → ok:false, budgetLimit 10, plan [], truthful error
 *                    string naming the config source.
 *   c (CLI)          source truthfulness + equivalence: explicit --limit 10 on
 *                    a default_limit 4096 workspace gets the same diagnosis
 *                    naming --limit 10 (not _rules.yaml); the two paths to the
 *                    identical limit value behave identically.
 *   d (CLI --json)   default_limit 25 (the issue's sed repro value) → the
 *                    back-ref (12 tok) is affordable → partial plan, exit 0,
 *                    ok:true, skipped lists 01-auth.md; "no files match"
 *                    never appears.
 *   e (CLI)          genuine no-match preserved: unknown concept + small
 *                    default_limit → still "no files match concept" (the
 *                    distinction remains correct when nothing matches).
 *
 * Round 6 (QA-17, issues #15/#16 re-verification) — test map:
 *   f47-a (CLI)       default_limit: abc → §19 user-correctable error naming
 *                     the key and file, exit 1 — never `Budget: 44 / abc tokens`
 *                     with ok:true and a STRING budgetLimit.
 *   f47-b (CLI --json) same → ok:false envelope carrying the error.
 *   f47-c (CLI)       default_limit: -5 → rejected as an invalid VALUE (flag
 *                     parity: --limit -5 is rejected), not swallowed into the
 *                     empty-plan message.
 *   f47-d (CLI --json) default_limit: 2.5 → fractional value rejected (flag
 *                     parity: --limit 2.5 is rejected as non-integer).
 *   f47-e (CLI)       flag≡config parity for bogus values: the same bogus
 *                     value through both sources → equivalent rejection.
 *   f47-f (CLI)       a VALID --limit never launders a garbage config limit:
 *                     default_limit: abc + --limit 4096 → still exit 1 naming
 *                     the config key (never silently ignored).
 *   f47-g (CLI)       degenerate 0 keeps flag≡config parity: both sources
 *                     accept 0 and give the truthful empty-plan diagnosis.
 *   f16-a (CLI)       enabled: false → budget read refuses, §19 error naming
 *                     token_budget.enabled and _rules.yaml (the switch is no
 *                     longer dead config).
 *   f16-b (CLI)       enabled: false → budget write refuses the same way.
 *   f16-c (CLI --json) enabled: false → ok:false envelope with the error.
 *   f16-d (CLI)       enabled key deleted (section intact) → planning stays
 *                     ON (§18 planning switch: delete ≠ off, parameter keeps
 *                     its default) — pin the delete-key semantics.
 *   f16-e (CLI)       enabled: "false" (string, not boolean) → §19 type error
 *                     — a truthy string must never silently keep planning ON.
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

import { spawnCli, REPO } from '../runtime.ts';

/** The issue repro's spec files (verbatim). */
const AUTH_MD = [
  '- Authentication',
  '  - Sessions',
  '    - Expire after 24 hours',
  '    - Refresh allowed for 30 days',
  '  - Sign up',
  '    - Email requires verification',
  '',
].join('\n');

const API_MD = [
  '- API',
  '  - Session rules: see 01-auth.md#Sessions',
  '',
].join('\n');

const OVERVIEW_MD = [
  '- Overview',
  '  - Purpose',
  '  - Scope',
  '',
].join('\n');

/** estTokens verified against the real estimator (3.5 chars/token). */
const TOK = { auth: 32, api: 12 } as const;

function rulesYaml(defaultLimit: number): string {
  return [
    'token_budget:',
    `  default_limit: ${defaultLimit}`,
    '  estimate_chars_per_token: 3.5',
    '  warn_threshold: 0.8',
    '',
  ].join('\n');
}

// ── CLI-level scaffolding (mirrors test/issues/issue-1.test.ts) ──

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-15');

interface Ws {
  root: string;
  cans: string;
}

const createdDirs: string[] = [];
let wsSeq = 0;

function makeWs(name: string, defaultLimit: number): Ws {
  return makeWsRules(name, rulesYaml(defaultLimit));
}

/** Round-6 helper: same spec files, arbitrary token_budget rules body. */
function makeWsRules(name: string, rulesYamlText: string): Ws {
  const root = join(SCRATCH, `${name}-${++wsSeq}`);
  const cans = join(root, 'cans');
  mkdirSync(cans, { recursive: true });
  createdDirs.push(root);
  for (const [f, content] of [
    ['00-overview.md', OVERVIEW_MD],
    ['01-auth.md', AUTH_MD],
    ['02-api.md', API_MD],
  ] as Array<[string, string]>) {
    writeFileSync(join(cans, f), content, 'utf8');
  }
  writeFileSync(join(cans, '_rules.yaml'), rulesYamlText, 'utf8');
  return { root, cans };
}

/** token_budget section builder for round-6 value-validation cases. */
function tokenBudgetRules(fields: Record<string, string>): string {
  const lines = ['token_budget:'];
  for (const [k, v] of Object.entries(fields)) lines.push(`  ${k}: ${v}`);
  return `${lines.join('\n')}\n`;
}

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
  return parsed;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('issue #15: config-derived default_limit never reports a false "no files match"', () => {
  test('a (CLI): default_limit 10, no --limit → limit-too-small diagnosis naming the _rules.yaml source and the top-priority item', () => {
    // The issue repro: with default_limit small enough that the canonical-home
    // file alone exceeds it, `cans budget read sessions` exited 1 with the
    // FALSE "no files match concept" — the concept matches; the plan is empty
    // only because the config-derived budget cannot afford any item.
    const ws = makeWs('cli-config-empty', 10);
    const r = runCli(['budget', 'read', 'sessions'], ws.root);
    expect(r.exit).toBe(1); // §19: user-correctable failure
    expect(r.out).toContain('✗');
    // §37: name the actual source of the limit...
    expect(r.out).toContain('token_budget.default_limit (10)');
    expect(r.out).toContain('_rules.yaml');
    // ...and the top-priority item that busts it (file + estTokens)...
    expect(r.out).toContain('01-auth.md');
    expect(r.out).toContain('32 tok');
    // ...plus what to do.
    expect(r.out).toContain('raise default_limit or pass --limit');
    // Never the false spelling-problem diagnosis.
    expect(r.out).not.toContain('no files match');
  });

  test('b (CLI --json): default_limit 10 → truthful failure envelope: budgetLimit 10, plan [], error names the config source', () => {
    const ws = makeWs('cli-config-empty-json', 10);
    const r = runCli(['budget', 'read', 'sessions', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(1);
    expect(j.ok).toBe(false);
    expect(j.exitCode).toBe(1);
    expect(j.plan).toEqual([]);
    expect(j.budgetLimit).toBe(10); // truthful: the effective config limit
    expect(j.error).toContain('token_budget.default_limit (10)');
    expect(j.error).toContain('_rules.yaml');
    expect(j.error).toContain('01-auth.md');
    expect(j.error).toContain('32 tok');
    expect(j.error).not.toContain('no files match');
  });

  test('c (CLI): explicit --limit 10 gets the same truthful diagnosis naming the flag (both sources behave consistently)', () => {
    // Two paths to the identical limit value must behave identically: the
    // explicit flag names `--limit 10` (its actual source, not _rules.yaml),
    // and never claims "no files match".
    const wsFlag = makeWs('cli-flag-empty', 4096);
    const rFlag = runCli(['budget', 'read', 'sessions', '--limit', '10'], wsFlag.root);
    expect(rFlag.exit).toBe(1);
    expect(rFlag.out).toContain('--limit 10');
    expect(rFlag.out).toContain('01-auth.md');
    expect(rFlag.out).toContain('32 tok');
    expect(rFlag.out).toContain('raise the limit');
    expect(rFlag.out).not.toContain('no files match');
    // The source named must be the flag, not the config (default_limit here is 4096).
    expect(rFlag.out).not.toContain('_rules.yaml');

    // And the config path with the SAME value gets the same shape of diagnosis
    // (consistency, not just "no longer false").
    const wsConfig = makeWs('cli-config-empty-consistent', 10);
    const rConfig = runCli(['budget', 'read', 'sessions'], wsConfig.root);
    expect(rConfig.exit).toBe(1);
    expect(rConfig.out).toContain('plan empty');
    expect(rConfig.out).not.toContain('no files match');
  });

  test('d (CLI --json): default_limit 25 (the issue\'s sed repro value) → affordable back-ref planned: partial plan, exit 0, no false "no match"', () => {
    // With the issue #16 best-effort packer, default_limit 25 cannot afford the
    // 32-tok canonical home but CAN afford the 12-tok back-ref → the plan is a
    // partial (non-empty) plan: success output with 01-auth.md in `skipped`.
    // "Limit too small for the home" must never masquerade as "no match".
    const ws = makeWs('cli-config-partial', 25);
    const r = runCli(['budget', 'read', 'sessions', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(0);
    expect(j.ok).toBe(true);
    expect(j.plan.map((p: any) => p.file)).toEqual(['02-api.md']);
    expect(j.plan[0].estTokens).toBe(TOK.api);
    expect(j.totalTokens).toBe(TOK.api);
    expect(j.budgetLimit).toBe(25);
    expect(j.skipped).toContain('01-auth.md');
    expect(r.out).not.toContain('no files match');
    // Human mode for the same workspace stays success-shaped too.
    const rHuman = runCli(['budget', 'read', 'sessions'], ws.root);
    expect(rHuman.exit).toBe(0);
    expect(rHuman.out).toContain('Reading plan for: sessions');
    expect(rHuman.out).toContain('02-api.md ← see: back-ref (12 tok)');
    expect(rHuman.out).toContain('01-auth.md');
    expect(rHuman.out).not.toContain('no files match');
  });

  test('e (CLI): unknown concept with small default_limit → still the genuine "no files match" (the distinction stays correct)', () => {
    // A concept that matches nothing is a spelling problem, not a budget
    // problem — the limit-too-small diagnosis must not swallow this case.
    const ws = makeWs('cli-genuine-nomatch', 10);
    const r = runCli(['budget', 'read', 'zzznope'], ws.root);
    expect(r.exit).toBe(1);
    expect(r.out).toContain('no files match concept "zzznope"');
    expect(r.out).not.toContain('plan empty');
    expect(r.out).not.toContain('token_budget.default_limit');
  });
});

describe('issue #15 round 6 (QA-17 F47/F16): token_budget config values are validated and honored like the --limit flag', () => {
  // QA-17 F47 (MAJOR): `default_limit: abc` sailed through — exit 0, human
  // `Budget: 44 / abc tokens (0%)`, --json budgetLimit was the STRING "abc",
  // ok:true — while the --limit flag rejected the same value. Issue #15's own
  // claim ("both limit sources get the same diagnosis") extends to VALUE
  // validation: non-numeric / negative / fractional config limits are §19
  // user-correctable errors naming the key and the file. QA-17 F16 (MINOR):
  // `enabled: false` was a dead switch (zero observable difference) — the
  // switch is now real: budget read/write refuse with a §19 error.

  const VALID_REST = { estimate_chars_per_token: '3.5', warn_threshold: '0.8' };

  test('f47-a (CLI): default_limit: abc → §19 error naming the key and file, exit 1 — never a garbage success', () => {
    const ws = makeWsRules('r6-limit-abc', tokenBudgetRules({ default_limit: 'abc', ...VALID_REST }));
    const r = runCli(['budget', 'read', 'sessions'], ws.root);
    expect(r.exit).toBe(1);
    expect(r.out).toContain('✗');
    expect(r.out).toContain('invalid token_budget.default_limit "abc" in _rules.yaml');
    expect(r.out).toContain('pass a positive integer');
    // Never the defect's garbage success: no plan, no string-limit math.
    expect(r.out).not.toContain('Reading plan for');
    expect(r.out).not.toContain('/ abc tokens');
    expect(r.out).not.toContain('no files match');
  });

  test('f47-b (CLI --json): default_limit: abc → ok:false envelope carrying the error (budgetLimit is never the string "abc")', () => {
    const ws = makeWsRules('r6-limit-abc-json', tokenBudgetRules({ default_limit: 'abc', ...VALID_REST }));
    const r = runCli(['budget', 'read', 'sessions', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(1);
    expect(j.ok).toBe(false);
    expect(j.exitCode).toBe(1);
    expect(j.budgetLimit).not.toBe('abc');
    expect(j.error).toContain('invalid token_budget.default_limit "abc" in _rules.yaml');
    expect(j.error).toContain('pass a positive integer');
    expect(r.out).not.toContain('Infinity');
  });

  test('f47-c (CLI): default_limit: -5 → rejected as an invalid value (flag parity), not swallowed into the empty-plan message', () => {
    // The flag path rejects `--limit -5` with an invalid-value error; the
    // config path must behave the same way for the same value — the old
    // behavior folded -5 into "plan empty: token_budget.default_limit (-5) …".
    const ws = makeWsRules('r6-limit-neg', tokenBudgetRules({ default_limit: '-5', ...VALID_REST }));
    const r = runCli(['budget', 'read', 'sessions'], ws.root);
    expect(r.exit).toBe(1);
    expect(r.out).toContain('invalid token_budget.default_limit "-5" in _rules.yaml');
    expect(r.out).toContain('pass a positive integer');
    expect(r.out).not.toContain('plan empty');
    expect(r.out).not.toContain('below the top-priority item');
  });

  test('f47-d (CLI --json): default_limit: 2.5 → fractional value rejected (flag parity: --limit 2.5 is non-integer)', () => {
    const ws = makeWsRules('r6-limit-frac', tokenBudgetRules({ default_limit: '2.5', ...VALID_REST }));
    const r = runCli(['budget', 'read', 'sessions', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(1);
    expect(j.ok).toBe(false);
    expect(j.error).toContain('invalid token_budget.default_limit "2.5" in _rules.yaml');
    // Flag parity control: the same value through the flag is non-integer too.
    const wsFlag = makeWs('r6-limit-frac-flag', 4096);
    const rFlag = runCli(['budget', 'read', 'sessions', '--limit', '2.5'], wsFlag.root);
    expect(rFlag.exit).toBe(1);
    expect(rFlag.out).toContain('invalid --limit value "2.5"');
  });

  test('f47-e (CLI): flag≡config parity for bogus values — the same bogus value through both sources → equivalent rejection', () => {
    // "abc" through the flag: rejected, exit 1, names the value + fix.
    const wsFlag = makeWs('r6-parity-flag', 4096);
    const rFlag = runCli(['budget', 'read', 'sessions', '--limit', 'abc'], wsFlag.root);
    expect(rFlag.exit).toBe(1);
    expect(rFlag.out).toContain('invalid --limit value "abc"');
    expect(rFlag.out).toContain('pass a positive integer');
    expect(rFlag.out).not.toContain('Reading plan for');
    // "abc" through the config: rejected, exit 1, names the value + fix (and
    // the config key + file, its actual source).
    const wsConfig = makeWsRules('r6-parity-config', tokenBudgetRules({ default_limit: 'abc', ...VALID_REST }));
    const rConfig = runCli(['budget', 'read', 'sessions'], wsConfig.root);
    expect(rConfig.exit).toBe(1);
    expect(rConfig.out).toContain('invalid token_budget.default_limit "abc" in _rules.yaml');
    expect(rConfig.out).toContain('pass a positive integer');
    expect(rConfig.out).not.toContain('Reading plan for');
    // Neither mode ever reports ok:true / a plan for the bogus value.
    const rConfigJson = runCli(['budget', 'read', 'sessions', '--json'], wsConfig.root);
    const j = parseJsonOut(rConfigJson.out);
    expect(j.ok).toBe(false);
  });

  test('f47-f (CLI): a valid --limit never launders a garbage config limit — default_limit: abc + --limit 4096 still exits 1 naming the config key', () => {
    // F47's exact hole was the SILENT pass-through of garbage config values; a
    // flag override must not become a new laundering path for the same garbage.
    const ws = makeWsRules('r6-limit-abc-flagged', tokenBudgetRules({ default_limit: 'abc', ...VALID_REST }));
    const r = runCli(['budget', 'read', 'sessions', '--limit', '4096'], ws.root);
    expect(r.exit).toBe(1);
    expect(r.out).toContain('invalid token_budget.default_limit "abc" in _rules.yaml');
    expect(r.out).not.toContain('Reading plan for');
  });

  test('f47-g (CLI): degenerate 0 keeps flag≡config parity — both sources accept 0 and give the truthful empty-plan diagnosis', () => {
    // QA-17 F11: the FLAG accepts --limit 0 as a degenerate limit (exit 1 with
    // the truthful empty-plan diagnosis, never an invalid-value error). The
    // config source applies the same validation, so 0 behaves identically.
    const wsConfig = makeWsRules('r6-limit-zero-config', tokenBudgetRules({ default_limit: '0', ...VALID_REST }));
    const rConfig = runCli(['budget', 'read', 'sessions'], wsConfig.root);
    expect(rConfig.exit).toBe(1);
    expect(rConfig.out).toContain('plan empty: token_budget.default_limit (0) in _rules.yaml is below the top-priority item 01-auth.md (32 tok) — raise default_limit or pass --limit');
    expect(rConfig.out).not.toContain('invalid token_budget.default_limit');
    expect(rConfig.out).not.toContain('no files match');

    const wsFlag = makeWs('r6-limit-zero-flag', 4096);
    const rFlag = runCli(['budget', 'read', 'sessions', '--limit', '0'], wsFlag.root);
    expect(rFlag.exit).toBe(1);
    expect(rFlag.out).toContain('plan empty: --limit 0 is below the top-priority item 01-auth.md (32 tok) — raise the limit');
    expect(rFlag.out).not.toContain('invalid --limit value');
  });

  test('f16-a (CLI): token_budget.enabled: false → budget read refuses with a §19 error naming the switch and the file', () => {
    // QA-17 F16: `enabled: false` had zero observable effect — a dead switch
    // the docs list in §18. Decision (docs+code made to agree): false
    // observably disables budget planning — both budget commands refuse.
    const ws = makeWsRules('r6-enabled-false', tokenBudgetRules({ enabled: 'false', default_limit: '4096', ...VALID_REST }));
    const r = runCli(['budget', 'read', 'sessions'], ws.root);
    expect(r.exit).toBe(1);
    expect(r.out).toContain('✗');
    expect(r.out).toContain('token_budget.enabled is false in _rules.yaml');
    expect(r.out).toContain('set it to true');
    expect(r.out).not.toContain('Reading plan for');
    // The limit is NOT applied and NOT diagnosed as a budget problem.
    expect(r.out).not.toContain('plan empty');
    expect(r.out).not.toContain('Budget:');
  });

  test('f16-b (CLI): token_budget.enabled: false → budget write refuses the same way (the switch governs both budget commands)', () => {
    const ws = makeWsRules('r6-enabled-false-write', tokenBudgetRules({ enabled: 'false', default_limit: '4096', ...VALID_REST }));
    const r = runCli(['budget', 'write', 'sessions'], ws.root);
    expect(r.exit).toBe(1);
    expect(r.out).toContain('token_budget.enabled is false in _rules.yaml');
    expect(r.out).not.toContain('Writing scope for');
  });

  test('f16-c (CLI --json): token_budget.enabled: false → ok:false envelope with the error', () => {
    const ws = makeWsRules('r6-enabled-false-json', tokenBudgetRules({ enabled: 'false', default_limit: '4096', ...VALID_REST }));
    const r = runCli(['budget', 'read', 'sessions', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(1);
    expect(j.ok).toBe(false);
    expect(j.exitCode).toBe(1);
    expect(j.error).toContain('token_budget.enabled is false in _rules.yaml');
    expect(j.plan).toEqual([]);
  });

  test('f16-d (CLI): enabled key deleted (section intact) → planning stays ON — §18 planning switch: delete ≠ off', () => {
    // §18 "delete a key = check turns off" applies to CHECK switches;
    // token_budget.enabled is a planning switch (a parameter): deleted or
    // omitted it keeps its documented default true, so budget planning runs.
    const ws = makeWsRules('r6-enabled-deleted', tokenBudgetRules({ default_limit: '4096', ...VALID_REST }));
    const r = runCli(['budget', 'read', 'sessions'], ws.root);
    expect(r.exit).toBe(0);
    expect(r.out).toContain('Reading plan for: sessions');
    expect(r.out).toContain('01-auth.md#Sessions ← canonical home');
  });

  test('f16-e (CLI): enabled: "false" (a string, not a boolean) → §19 type error — a truthy string must never silently keep planning ON', () => {
    // YAML would happily hand the budget engine the STRING "false"; a plain
    // `=== false` check would ignore it (dead config again, in the other
    // direction). The switch accepts booleans only.
    const ws = makeWsRules('r6-enabled-string', tokenBudgetRules({ enabled: '"false"', default_limit: '4096', ...VALID_REST }));
    const r = runCli(['budget', 'read', 'sessions'], ws.root);
    expect(r.exit).toBe(1);
    expect(r.out).toContain('invalid token_budget.enabled "false" in _rules.yaml');
    expect(r.out).toContain('pass true or false');
    expect(r.out).not.toContain('Reading plan for');
  });
});
