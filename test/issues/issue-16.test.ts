/**
 * Issue #16 regression tests — `cans budget read --limit` greedy packer yields
 * an EMPTY plan whenever the single highest-priority item busts the limit, and
 * the empty-plan error message is factually false.
 *
 * Two defects (§26 step 4 / §19 / §37):
 *   1. buildReadPlan (src/core/token-budget.ts) walks items sorted by score;
 *      the first item that does not fit sets a sticky `cut` flag and every
 *      subsequent (cheaper, lower-scored) item is skipped without
 *      consideration. `--limit 30` on the issue workspace (home 32 tok,
 *      back-ref 12 tok) returns plan: [] even though the back-ref fits.
 *   2. The QA-10 M2b diagnosis (src/commands/budget.ts) unconditionally prints
 *      "--limit N is below the cheapest item (M tok)" — when N >= M the claim
 *      is mathematically wrong and names the wrong cause (issue repro:
 *      "--limit 30 is below the cheapest item (12 tok)").
 *
 * Fixed semantics (§26 step 4): items are sorted by score and packed
 * best-effort — an item that does not fit is skipped (listed in `skipped`),
 * NOT a cut-off; cheaper lower-scored items that still fit are planned. When
 * the plan is empty because no item fits, the §19 user-correctable error names
 * the top-priority item that busts the limit (file + estTokens).
 *
 * Workspace (token costs verified against the real estimator, 3.5 chars/token):
 *   00-overview.md  no connection            → skipped (non-matching)
 *   01-auth.md      canonical home, 32 tok   (score 100)
 *   02-api.md       see: back-ref, 12 tok    (score 60)
 *   03-notes.md     mentions concept, 8 tok  (score 20)
 *
 * Test map:
 *   a (direct unit)  limit 30 → plan is NOT empty: [02-api.md (12 tok)] while
 *                    01-auth.md (32) is skipped — the walk must not cut.
 *   b (direct unit)  limit 12 (the issue's cheapest-item case) → plan exactly
 *                    [02-api.md]; totalTokens 12.
 *   c (direct unit)  limit 32 → plan exactly [01-auth.md]: score order is
 *                    preserved (top-priority first), 02-api no longer fits.
 *   d (direct unit)  limit 20 → plan [02-api.md, 03-notes.md]: the walk
 *                    continues past a skipped item AND packs later items.
 *   e (CLI)          --limit 12 / 21 / 30 (loop): exit 0, ok:true, plan
 *                    contains 02-api.md; the old bug exited 1 with a false
 *                    "plan empty" for all three.
 *   f (CLI human)    --limit 12 → success-shaped "Reading plan for:" output
 *                    listing 02-api.md; never "plan empty".
 *   g (CLI)          --limit 10 (below EVERY item incl. the cheapest) →
 *                    exit 1 §19 user-correctable; error names the top-priority
 *                    item 01-auth.md (32 tok) and the limit value; never the
 *                    false "no files match" and never the "below the cheapest
 *                    item" wording.
 *   h (CLI --json)   --limit 10 --json → ok:false, plan:[], budgetLimit:10
 *                    (truthful envelope), error names 01-auth.md + 32 tok.
 *
 * Round 6 (QA-17, issues #15/#16 re-verification) — test map:
 *   f50-a (CLI)      estimate_chars_per_token: 0 → §19 user-correctable error
 *                    naming the key, exit 1; NEVER "Infinity tok" estimates or
 *                    unsatisfiable "raise the limit" advice.
 *   f50-b (CLI --json) same → ok:false envelope carrying the error.
 *   f50-c (CLI)      estimate_chars_per_token: -1 → same rejection shape.
 *   f25-a (CLI --json) skipped lists EVERY file not in the plan: a task file
 *                    with no connection to the concept appears in skipped
 *                    (was invisible — in neither plan nor skipped).
 *   f25-b (CLI human) the Skipped: section lists the no-connection task file.
 *   f25-c (CLI --json) a mentioning task file that does not fit stays in
 *                    skipped (F46 behavior preserved) alongside the
 *                    no-connection task file.
 *   f28-a (direct)   the §26 "forward ref (40)" tier is reachable: the target
 *                    of a see: ref made FROM the canonical home scores 40.
 *   f28-b (CLI --json) end-to-end: home refs 03-pw.md → 03-pw.md planned at
 *                    score 40 with reason "forward ref", after back-refs.
 *   f28-c (direct)   back-pointer (60) outranks forward ref (40) when a file
 *                    is both (mutual refs) — highest applicable score wins.
 *   f28-d (direct)   forward ref (40) outranks mentions concept (20) when a
 *                    file is both a home ref target AND mentions the concept.
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

import { parseOutline } from '../../src/core/outline.ts';
import { buildRefGraph } from '../../src/core/refs.ts';
import { buildReadPlan } from '../../src/core/token-budget.ts';
import { defaultRules } from '../../src/core/rules.ts';
import type { OutlineNode } from '../../src/types.ts';
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

/** A small "mentions concept" file (score 20, 8 tok) so a limit can afford
 *  items at multiple score tiers while the top item busts it. */
const NOTES_MD = [
  '- Notes',
  '  - Sessions are stateless',
  '',
].join('\n');

const OVERVIEW_MD = [
  '- Overview',
  '  - Purpose',
  '  - Scope',
  '',
].join('\n');

/** estTokens verified against the real estimator (3.5 chars/token). */
const TOK = { auth: 32, api: 12, notes: 8 } as const;

const RULES_4096 = [
  'token_budget:',
  '  default_limit: 4096',
  '  estimate_chars_per_token: 3.5',
  '  warn_threshold: 0.8',
  '',
].join('\n');

// ── Direct-unit scaffolding (mirrors test/budget.test.ts) ──

function specFiles(withNotes: boolean): Map<string, OutlineNode[]> {
  const entries: Array<[string, string]> = withNotes
    ? [
        ['00-overview.md', OVERVIEW_MD],
        ['01-auth.md', AUTH_MD],
        ['02-api.md', API_MD],
        ['03-notes.md', NOTES_MD],
      ]
    : [
        ['00-overview.md', OVERVIEW_MD],
        ['01-auth.md', AUTH_MD],
        ['02-api.md', API_MD],
      ];
  return new Map(entries.map(([f, md]) => [f, parseOutline(md, f)]));
}

const rules = defaultRules().token_budget;

// ── CLI-level scaffolding (mirrors test/issues/issue-1.test.ts) ──

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-16');

interface Ws {
  root: string;
  cans: string;
}

const createdDirs: string[] = [];
let wsSeq = 0;

function makeWs(name: string, rulesYaml: string, withNotes = true): Ws {
  const root = join(SCRATCH, `${name}-${++wsSeq}`);
  const cans = join(root, 'cans');
  mkdirSync(cans, { recursive: true });
  createdDirs.push(root);
  const files: Array<[string, string]> = withNotes
    ? [
        ['00-overview.md', OVERVIEW_MD],
        ['01-auth.md', AUTH_MD],
        ['02-api.md', API_MD],
        ['03-notes.md', NOTES_MD],
      ]
    : [
        ['00-overview.md', OVERVIEW_MD],
        ['01-auth.md', AUTH_MD],
        ['02-api.md', API_MD],
      ];
  for (const [name, content] of files) writeFileSync(join(cans, name), content, 'utf8');
  writeFileSync(join(cans, '_rules.yaml'), rulesYaml, 'utf8');
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

describe('issue #16: budget read --limit packs best-effort, never a sticky cut', () => {
  test('a (direct unit): limit 30 → plan is NOT empty: the 12-tok back-ref (and every other affordable item) is planned while the 32-tok home is skipped', () => {
    // The issue repro: `cans budget read sessions --limit 30` returned plan: []
    // because the 32-tok canonical home busted the limit and the sticky cut
    // discarded the affordable 12-tok back-ref (and the 8-tok mentions file).
    const files = specFiles(true);
    const graph = buildRefGraph(files, '.');
    const result = buildReadPlan('sessions', files, graph.back, rules, 30);

    expect(result.ok).toBe(true);
    expect(result.plan.map(p => p.file)).toEqual(['02-api.md', '03-notes.md']);
    expect(result.plan[0].estTokens).toBe(TOK.api);
    expect(result.plan[0].score).toBe(60);
    expect(result.plan[0].reason).toBe('see: back-ref');
    expect(result.totalTokens).toBe(TOK.api + TOK.notes);
    expect(result.budgetLimit).toBe(30);
    // The home that busts the limit is reported as skipped — not silently cut.
    expect(result.skipped).toContain('01-auth.md');
    expect(result.skipped).toContain('00-overview.md');
  });

  test('b (direct unit): limit 12 (the issue\'s cheapest-item case) → plan is exactly the 12-tok back-ref', () => {
    // `--limit 12` could afford 02-api.md exactly; the sticky cut returned an
    // empty plan anyway because the walk died at 01-auth.md (32 tok).
    const files = specFiles(true);
    const graph = buildRefGraph(files, '.');
    const result = buildReadPlan('sessions', files, graph.back, rules, 12);

    expect(result.plan.map(p => p.file)).toEqual(['02-api.md']);
    expect(result.totalTokens).toBe(TOK.api);
    expect(result.usagePercent).toBe(100);
  });

  test('c (direct unit): limit 32 → plan is exactly the canonical home — score order is preserved (top-priority first)', () => {
    // With room for the home only, the home is packed first (score 100) and
    // the back-ref no longer fits (32 + 12 > 32) → skipped.
    const files = specFiles(true);
    const graph = buildRefGraph(files, '.');
    const result = buildReadPlan('sessions', files, graph.back, rules, 32);

    expect(result.plan.map(p => p.file)).toEqual(['01-auth.md']);
    expect(result.plan[0].score).toBe(100);
    expect(result.skipped).toContain('02-api.md');
    expect(result.skipped).toContain('03-notes.md');
  });

  test('d (direct unit): limit 20 → plan [02-api.md, 03-notes.md] — the walk continues past a skipped item and packs lower-scored items', () => {
    // 01-auth.md (32) does not fit → skipped; 02-api.md (12) fits; then the
    // score-20 03-notes.md (8) still fits (12 + 8 = 20 ≤ 20) → planned.
    const files = specFiles(true);
    const graph = buildRefGraph(files, '.');
    const result = buildReadPlan('sessions', files, graph.back, rules, 20);

    expect(result.plan.map(p => p.file)).toEqual(['02-api.md', '03-notes.md']);
    expect(result.totalTokens).toBe(TOK.api + TOK.notes);
    expect(result.skipped).toContain('01-auth.md');
    expect(result.skipped).not.toContain('03-notes.md');
  });

  test('e (CLI): --limit 12 / 21 / 30 → exit 0 with every affordable item planned (was: exit 1 + false "plan empty")', () => {
    const ws = makeWs('cli-best-effort', RULES_4096);
    // limit 12 affords exactly the back-ref; 21 and 30 also afford the 8-tok
    // mentions file (12 + 8 = 20 ≤ 21/30); none can afford the 32-tok home.
    const expected: Record<number, string[]> = {
      12: ['02-api.md'],
      21: ['02-api.md', '03-notes.md'],
      30: ['02-api.md', '03-notes.md'],
    };
    for (const limit of [12, 21, 30]) {
      const r = runCli(['budget', 'read', 'sessions', '--limit', String(limit), '--json'], ws.root);
      const j = parseJsonOut(r.out);
      expect(r.exit).toBe(0);
      expect(j.ok).toBe(true);
      expect(j.plan.map((p: any) => p.file)).toEqual(expected[limit]);
      expect(j.budgetLimit).toBe(limit);
      expect(j.skipped).toContain('01-auth.md');
      // The old false claim ("--limit N is below the cheapest item (12 tok)")
      // must be gone: 12/21/30 are all >= the cheapest item (12 tok).
      expect(r.out).not.toContain('plan empty');
      expect(r.out).not.toContain('below the cheapest item');
    }
  });

  test('f (CLI human): --limit 12 → success-shaped plan output listing 02-api.md, never "plan empty"', () => {
    const ws = makeWs('cli-human', RULES_4096, false); // issue repro shape (no notes file)
    const r = runCli(['budget', 'read', 'sessions', '--limit', '12'], ws.root);
    expect(r.exit).toBe(0);
    expect(r.out).toContain('Reading plan for: sessions');
    expect(r.out).toContain('02-api.md ← see: back-ref (12 tok)');
    expect(r.out).toContain('Skipped:');
    expect(r.out).toContain('01-auth.md');
    expect(r.out).toContain('Budget: 12 / 12 tokens (100%)');
    expect(r.out).not.toContain('plan empty');
    expect(r.out).not.toContain('no files match');
  });

  test('g (CLI): --limit 10 (below every item) → exit 1 error names the top-priority item that busts the limit, not a false cause', () => {
    // §19: user-correctable failure → exit 1. §37: name the real cause.
    // Best-effort packing includes every item that fits, so an empty plan now
    // means the limit is below every matching item — the message must name
    // the top-priority item (file + estTokens), never "no files match" and
    // never the old "below the cheapest item" wording.
    const ws = makeWs('cli-empty-truthful', RULES_4096, false);
    const r = runCli(['budget', 'read', 'sessions', '--limit', '10'], ws.root);
    expect(r.exit).toBe(1);
    expect(r.out).toContain('✗');
    expect(r.out).toContain('--limit 10');
    expect(r.out).toContain('01-auth.md');
    expect(r.out).toContain('32 tok');
    expect(r.out).toContain('raise the limit');
    expect(r.out).not.toContain('no files match');
    expect(r.out).not.toContain('below the cheapest item');
  });

  test('h (CLI --json): --limit 10 --json → truthful failure envelope: budgetLimit 10, plan [], error names the top-priority item', () => {
    const ws = makeWs('cli-json-empty', RULES_4096, false);
    const r = runCli(['budget', 'read', 'sessions', '--limit', '10', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(1);
    expect(j.ok).toBe(false);
    expect(j.exitCode).toBe(1);
    expect(j.plan).toEqual([]);
    expect(j.budgetLimit).toBe(10); // truthful: the effective limit, not 0
    expect(j.error).toContain('--limit 10');
    expect(j.error).toContain('01-auth.md');
    expect(j.error).toContain('32 tok');
    expect(j.error).not.toContain('no files match');
  });
});

// ── Round 6 (QA-17): shared scaffolding for F50 / F25 / F28 ──

/** QA-17 F50: rules with a degenerate chars-per-token value. */
function rulesCpt(cpt: string): string {
  return [
    'token_budget:',
    '  default_limit: 4096',
    `  estimate_chars_per_token: ${cpt}`,
    '  warn_threshold: 0.8',
    '',
  ].join('\n');
}

/** QA-17 F28: the canonical home points at 03-pw.md (outbound see: ref). */
const AUTH_FORWARD_MD = [
  '- Authentication',
  '  - Sessions',
  '    - Expire after 24 hours',
  '    - Password policy: see 03-pw.md',
  '',
].join('\n');

const PW_MD = [
  '- Passwords',
  '  - Minimum 12 characters',
  '    - Rotate every 90 days',
  '',
].join('\n');

/** §30-shaped active task files. */
function taskMd(title: string, task: string): string {
  return [
    `# ${title}`,
    '',
    'Owner: agent',
    '',
    '## Tasks',
    '',
    `- [ ] ${task}`,
    '',
  ].join('\n');
}

describe('issue #16 round 6 (QA-17 F50): estimate_chars_per_token is validated — never Infinity', () => {
  // QA-17 F50: `estimate_chars_per_token: 0` made every estimate Infinity
  // (`top-priority item 01-auth.md (Infinity tok)`), produced an unsatisfiable
  // "raise the limit" advice, and never named the real cause. A chars-per-token
  // of 0 or less is invalid config (§18): a §19 user-correctable error naming
  // `token_budget.estimate_chars_per_token`, exit 1 — no limit can ever fix it.

  test('f50-a (CLI): estimate_chars_per_token: 0 → §19 error naming the key, exit 1 — never "Infinity tok"', () => {
    const ws = makeWs('r6-cpt-zero', rulesCpt('0'), false);
    const r = runCli(['budget', 'read', 'sessions', '--limit', '999999999'], ws.root);
    expect(r.exit).toBe(1);
    expect(r.out).toContain('✗');
    expect(r.out).toContain('invalid token_budget.estimate_chars_per_token "0" in _rules.yaml');
    expect(r.out).toContain('pass a positive number');
    // The defect's garbage output is gone: no Infinity estimate, no
    // unsatisfiable limit advice blaming --limit for a config problem.
    expect(r.out).not.toContain('Infinity');
    expect(r.out).not.toContain('raise the limit');
    expect(r.out).not.toContain('Reading plan for');
  });

  test('f50-b (CLI --json): estimate_chars_per_token: 0 → ok:false envelope carrying the error (no Infinity anywhere)', () => {
    const ws = makeWs('r6-cpt-zero-json', rulesCpt('0'), false);
    const r = runCli(['budget', 'read', 'sessions', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(1);
    expect(j.ok).toBe(false);
    expect(j.exitCode).toBe(1);
    expect(j.error).toContain('invalid token_budget.estimate_chars_per_token "0" in _rules.yaml');
    expect(j.error).toContain('pass a positive number');
    expect(r.out).not.toContain('Infinity');
  });

  test('f50-c (CLI): estimate_chars_per_token: -1 → same §19 rejection shape (a negative ratio is equally invalid)', () => {
    const ws = makeWs('r6-cpt-neg', rulesCpt('-1'), false);
    const r = runCli(['budget', 'read', 'sessions'], ws.root);
    expect(r.exit).toBe(1);
    expect(r.out).toContain('invalid token_budget.estimate_chars_per_token "-1" in _rules.yaml');
    expect(r.out).toContain('pass a positive number');
    expect(r.out).not.toContain('Infinity');
    expect(r.out).not.toContain('Reading plan for');
  });
});

describe('issue #16 round 6 (QA-17 F25): skipped lists EVERY file not in the plan', () => {
  // QA-17 F25: a task file with no connection to the concept appeared in
  // NEITHER plan nor skipped — §26 says skipped lists every file not in the
  // plan (didn't fit, or no connection). Budget scope = spec files + active
  // _tasks/*.md files (§22), so every active task file is in plan-or-skipped.

  function makeTaskWs(name: string): Ws {
    const ws = makeWs(name, RULES_4096);
    mkdirSync(join(ws.cans, '_tasks'), { recursive: true });
    // fix-shipping.md: fixture-format task file that never mentions "sessions".
    writeFileSync(join(ws.cans, '_tasks', 'fix-shipping.md'), taskMd('fix-shipping', 'Pick a carrier'), 'utf8');
    // fix-sessions.md: mentions the concept → score-80 tier.
    writeFileSync(join(ws.cans, '_tasks', 'fix-sessions.md'), taskMd('fix-sessions', 'Harden sessions'), 'utf8');
    return ws;
  }

  test('f25-a (CLI --json): no-connection task file is listed in skipped — never invisible', () => {
    const ws = makeTaskWs('r6-task-nomatch');
    const r = runCli(['budget', 'read', 'sessions', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(0);
    expect(j.ok).toBe(true);
    // The mentioning task file is planned (§26 step 3, score 80, after home);
    // the affordable mention file (8 tok) is planned at the bottom.
    expect(j.plan.map((p: any) => p.file)).toEqual(['01-auth.md', 'cans/_tasks/fix-sessions.md', '02-api.md', '03-notes.md']);
    expect(j.plan[1].score).toBe(80);
    expect(j.plan[1].reason).toBe('active task mentions concept');
    // EVERY other file in budget scope is in skipped — including the
    // no-connection task file and the no-connection spec file. (Task files
    // carry cwd-relative absolute keys, so they sort first — the same order
    // QA-17 F46 observed for unaffordable task files.)
    expect(j.skipped).toEqual(['cans/_tasks/fix-shipping.md', '00-overview.md']);
  });

  test('f25-b (CLI human): the Skipped: section lists the no-connection task file', () => {
    const ws = makeTaskWs('r6-task-nomatch-human');
    const r = runCli(['budget', 'read', 'sessions'], ws.root);
    expect(r.exit).toBe(0);
    expect(r.out).toContain('Skipped:');
    expect(r.out).toContain('cans/_tasks/fix-shipping.md');
    expect(r.out).toContain('00-overview.md');
  });

  test('f25-c (CLI --json): a mentioning task file that does not fit stays in skipped alongside the no-connection task file', () => {
    // QA-17 F46 (PASS, must keep working): task files that MATCH but do not
    // fit are listed in skipped. With --limit 12 only the 12-tok back-ref
    // fits; every other scoped file — home, both task files, notes, overview —
    // is in skipped. skipped = plan ⊕ everything else, with no invisible files.
    const ws = makeTaskWs('r6-task-noFit');
    const r = runCli(['budget', 'read', 'sessions', '--limit', '12', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(0);
    expect(j.ok).toBe(true);
    expect(j.plan.map((p: any) => p.file)).toEqual(['02-api.md']);
    expect(j.skipped).toContain('cans/_tasks/fix-sessions.md');
    expect(j.skipped).toContain('cans/_tasks/fix-shipping.md');
    expect(j.skipped).toContain('01-auth.md');
    expect(j.skipped).toContain('00-overview.md');
    expect(j.skipped).toContain('03-notes.md');
  });
});

describe('issue #16 round 6 (QA-17 F28): the forward ref (40) scoring tier is reachable', () => {
  // QA-17 F28: §26 step 3's scoring table lists "forward ref (40)" — a file
  // the canonical home POINTS TO — but the tier never fired: the target of a
  // see: ref made from the home file scored 0 and landed in skipped. The docs
  // table is the contract (implementing is the honest reading): files that
  // are targets of refs FROM the canonical home connect at 40.

  function forwardFiles(): Map<string, OutlineNode[]> {
    const entries: Array<[string, string]> = [
      ['01-auth.md', AUTH_FORWARD_MD],
      ['02-api.md', API_MD],
      ['03-pw.md', PW_MD],
    ];
    return new Map(entries.map(([f, md]) => [f, parseOutline(md, f)]));
  }

  test('f28-a (direct unit): the target of a see: ref made FROM the canonical home scores 40 with reason "forward ref"', () => {
    const files = forwardFiles();
    const graph = buildRefGraph(files, '.');
    const result = buildReadPlan('sessions', files, graph.back, rules);
    expect(result.plan.map(p => p.file)).toEqual(['01-auth.md', '02-api.md', '03-pw.md']);
    const pw = result.plan[2]!;
    expect(pw.file).toBe('03-pw.md');
    expect(pw.score).toBe(40);
    expect(pw.reason).toBe('forward ref');
    // 03-pw.md is no longer an unconnected "skipped" file: it is in the plan.
    expect(result.skipped).not.toContain('03-pw.md');
  });

  test('f28-b (CLI --json): end-to-end — home refs 03-pw.md → 03-pw.md planned at 40 after the 60-tier back-ref', () => {
    const ws = makeWs('r6-forward', RULES_4096, false);
    writeFileSync(join(ws.cans, '01-auth.md'), AUTH_FORWARD_MD, 'utf8');
    writeFileSync(join(ws.cans, '03-pw.md'), PW_MD, 'utf8');
    const r = runCli(['budget', 'read', 'sessions', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(0);
    expect(j.ok).toBe(true);
    expect(j.plan.map((p: any) => p.file)).toEqual(['01-auth.md', '02-api.md', '03-pw.md']);
    expect(j.plan[0].score).toBe(100);
    expect(j.plan[0].reason).toBe('canonical home');
    expect(j.plan[1].score).toBe(60);
    expect(j.plan[1].reason).toBe('see: back-ref');
    expect(j.plan[2].score).toBe(40);
    expect(j.plan[2].reason).toBe('forward ref');
    expect(j.plan[2].estTokens).toBe(15);
    expect(j.totalTokens).toBe(22 + 12 + 15);
    // Human mode shows the tier too.
    const rHuman = runCli(['budget', 'read', 'sessions'], ws.root);
    expect(rHuman.out).toContain('03-pw.md ← forward ref (15 tok)');
    expect(rHuman.out).not.toContain('Skipped:\n  03-pw.md');
  });

  test('f28-c (direct unit): a file that refs the home AND is ref\'d by the home (mutual refs) scores 60 — highest applicable tier wins', () => {
    const files = new Map<string, OutlineNode[]>([
      ['01-auth.md', parseOutline([
        '- Authentication',
        '  - Sessions',
        '    - Expire after 24 hours',
        '    - Helper: see 04-both.md',
        '',
      ].join('\n'), '01-auth.md')],
      ['04-both.md', parseOutline([
        '- Both',
        '  - Session helper: see 01-auth.md#Sessions',
        '',
      ].join('\n'), '04-both.md')],
    ]);
    const graph = buildRefGraph(files, '.');
    const result = buildReadPlan('sessions', files, graph.back, rules);
    const both = result.plan.find(p => p.file === '04-both.md');
    expect(both).toBeDefined();
    expect(both!.score).toBe(60);
    expect(both!.reason).toBe('see: back-ref');
  });

  test('f28-d (direct unit): a home ref target that also mentions the concept scores 40, not 20 — forward outranks mentions', () => {
    const files = new Map<string, OutlineNode[]>([
      ['01-auth.md', parseOutline(AUTH_MD.replace('    - Refresh allowed for 30 days\n', '    - Refresh allowed for 30 days\n    - Hardening: see 05-fw.md\n'), '01-auth.md')],
      ['05-fw.md', parseOutline([
        '- Firewall',
        '  - Sessions are inspected here',
        '',
      ].join('\n'), '05-fw.md')],
    ]);
    const graph = buildRefGraph(files, '.');
    const result = buildReadPlan('sessions', files, graph.back, rules);
    const fw = result.plan.find(p => p.file === '05-fw.md');
    expect(fw).toBeDefined();
    expect(fw!.score).toBe(40);
    expect(fw!.reason).toBe('forward ref');
  });
});
