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
  writeFileSync(join(cans, '_rules.yaml'), rulesYaml(defaultLimit), 'utf8');
  return { root, cans };
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
