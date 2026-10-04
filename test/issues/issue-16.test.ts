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
