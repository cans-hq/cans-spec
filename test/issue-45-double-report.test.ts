/**
 * Issue #45 — a single over-limit node was double-reported as BOTH
 * structure.node_length.max AND overflow.node_chars when
 * structure.node_length.max === overflow.max_node_chars (the natural
 * one-char-budget-everywhere config).
 *
 * Both checks compare the SAME quantity (node.text.length) against their
 * threshold, so equal thresholds flag the identical node set twice — every
 * violation counted twice in errorCount and rendered twice:
 *
 *     structure | 04-decisions.md:16 | Node too long (91 > 90). Split or move to file.
 *     overflow  | 04-decisions.md:16 | node exceeds max chars (91 > 90)
 *
 * Fix contract (binding design, worklog 2026-10-23): when both budgets are
 * set and EQUAL, the overflow.node_chars check is skipped —
 * structure.node_length.max is the authoritative home for the same-value
 * config. DISTINCT values are genuinely different budgets and still both
 * fire (each at its own threshold). A config with node_length off (deleted,
 * §18) keeps the overflow check intact.
 *
 * Levels: engine unit (checkWorkspace — the dedup lives in its overflow
 * loop) and CLI blackbox (--json: sections + counts must not double-report).
 */
import { describe, test, expect, afterEach } from './testing.ts';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

import { spawnCli, REPO } from './runtime.ts';
import { checkWorkspace, type CheckArgs } from '../src/commands/check.ts';

const SCRATCH = join(REPO, '.tmp', 'issue-45-double-report');

interface Ws { root: string; cans: string }

const createdDirs: string[] = [];
let wsSeq = 0;

/** Fresh scratch workspace under repo/.tmp/issue-45-double-report (gitignored). */
function makeWs(name: string): Ws {
  const root = join(SCRATCH, `${name}-${++wsSeq}`);
  mkdirSync(join(root, 'cans'), { recursive: true });
  createdDirs.push(root);
  return { root, cans: join(root, 'cans') };
}

/** Blackbox CLI spawn — isolated from any ambient CANS_ROOT. */
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
  for (const d of createdDirs) rmSync(d, { recursive: true, force: true });
  createdDirs.length = 0;
});

const BASE_OPTS: CheckArgs = {
  fix: false,
  strict: false,
  refsOnly: false,
  noRedundancy: false,
  file: null,
  json: false,
};

/** Curated (§18 delete-mode) rules: the two char budgets under test, every
 *  other check-key deleted (structure lists a section → template-shaped
 *  file → unlisted sections and omitted keys are OFF). */
function rules(nodeLengthMax: number | null, maxNodeChars: number | null): string {
  const lines: string[] = [];
  if (nodeLengthMax === null) {
    // structure listed WITHOUT node_length → delete-key semantics → OFF.
    lines.push('structure:', '  siblings: { min: 1, max: 12 }');
  } else {
    lines.push('structure:', `  node_length: { min: 3, max: ${nodeLengthMax} }`);
  }
  if (maxNodeChars !== null) {
    lines.push('overflow:', `  max_node_chars: ${maxNodeChars}`);
  }
  return lines.join('\n') + '\n';
}

/** 92 chars — crosses the 90 budget, stays under the 200 budget. */
const NODE_92 =
  'Quarterly platform consolidation wraps up next cycle pending vendor signature and the budget';
/** 223 chars — crosses both the 90 and the 200 budget. */
const NODE_223 = `${'Quarterly platform consolidation wraps up next cycle pending vendor signature and budget confirmation from the finance group staff'} ${NODE_92}`;

expect(NODE_92.length).toBe(92); // fixture pin
expect(NODE_223.length).toBe(223); // fixture pin

/** Spec file: one root bullet per given node text (line = index + 1). */
function specWith(...nodes: string[]): string {
  return nodes.map((n) => `- ${n}`).join('\n') + '\n';
}

describe('issue #45 — same-value budgets report each over-limit node exactly once', () => {
  test('engine: node_length.max 90 === max_node_chars 90 → ONE error per node, structure wins', async () => {
    const ws = makeWs('same-value');
    writeFileSync(join(ws.cans, '_rules.yaml'), rules(90, 90));
    writeFileSync(join(ws.cans, '04-decisions.md'), specWith(NODE_92));

    const r = await checkWorkspace(join(ws.root, 'cans'), BASE_OPTS);
    // The over-limit node is reported ONCE — by the authoritative structure
    // rule, never also by the same-value overflow rule.
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]!.rule).toBe('structure.node_length.max');
    expect(r.issues[0]!.category).toBe('structure');
    expect(r.issues[0]!.line).toBe(1);
    expect(r.issues[0]!.message).toBe('Node too long (92 > 90). Split or move to file.');
    expect(r.issues.some((i) => i.rule === 'overflow.node_chars')).toBe(false);
    expect(r.errorCount).toBe(1);
  });

  test('engine: three over-limit nodes → exactly three errors, none double-counted', async () => {
    const ws = makeWs('same-value-many');
    writeFileSync(join(ws.cans, '_rules.yaml'), rules(90, 90));
    writeFileSync(
      join(ws.cans, '04-decisions.md'),
      specWith(NODE_92, 'short and fine', NODE_223, 'also fine', `${NODE_92} again`),
    );

    const r = await checkWorkspace(join(ws.root, 'cans'), BASE_OPTS);
    const structureHits = r.issues.filter((i) => i.rule === 'structure.node_length.max');
    const overflowHits = r.issues.filter((i) => i.rule === 'overflow.node_chars');
    expect(structureHits).toHaveLength(3); // lines 1, 3, 5
    expect(structureHits.map((i) => i.line)).toEqual([1, 3, 5]);
    expect(overflowHits).toHaveLength(0);
    expect(r.errorCount).toBe(3);
  });

  test('CLI (--json): sections.structure carries the finding, sections.overflow stays empty, counts.errors is per-node', () => {
    const ws = makeWs('same-value-json');
    writeFileSync(join(ws.cans, '_rules.yaml'), rules(90, 90));
    writeFileSync(join(ws.cans, '04-decisions.md'), specWith(NODE_92));

    const r = runCli(['check', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(j.counts.errors).toBe(1); // the bug double-counted: 2
    expect(j.sections.structure).toHaveLength(1);
    expect(j.sections.structure[0].rule).toBe('structure.node_length.max');
    expect(j.sections.structure[0].file).toBe('04-decisions.md');
    expect(j.sections.structure[0].line).toBe(1);
    expect(j.sections.overflow).toEqual([]); // no same-value duplicate
    expect(r.exit).toBe(2);
  });
});

describe('issue #45 — distinct budgets and one-sided configs keep firing', () => {
  test('engine: 90 vs 200 (distinct) → each threshold fires only where crossed', async () => {
    const ws = makeWs('distinct');
    writeFileSync(join(ws.cans, '_rules.yaml'), rules(90, 200));
    writeFileSync(join(ws.cans, '04-decisions.md'), specWith(NODE_92, NODE_223));

    const r = await checkWorkspace(join(ws.root, 'cans'), BASE_OPTS);
    const structureHits = r.issues.filter((i) => i.rule === 'structure.node_length.max');
    const overflowHits = r.issues.filter((i) => i.rule === 'overflow.node_chars');
    // NODE_92 (92 chars): crosses 90 only → structure alone.
    // NODE_223 (223 chars): crosses both → a genuine pair (different budgets).
    expect(structureHits.map((i) => i.line)).toEqual([1, 2]);
    expect(overflowHits.map((i) => i.line)).toEqual([2]);
    expect(r.errorCount).toBe(3);
  });

  test('engine: node_length deleted (§18) + max_node_chars 90 → overflow still fires', async () => {
    const ws = makeWs('overflow-only');
    writeFileSync(join(ws.cans, '_rules.yaml'), rules(null, 90));
    writeFileSync(join(ws.cans, '04-decisions.md'), specWith(NODE_92));

    const r = await checkWorkspace(join(ws.root, 'cans'), BASE_OPTS);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]!.rule).toBe('overflow.node_chars');
    expect(r.issues[0]!.message).toBe('node exceeds max chars (92 > 90)');
    expect(r.errorCount).toBe(1);
  });

  test('engine: node_length 90 + max_node_chars deleted (§18) → structure alone, as before', async () => {
    const ws = makeWs('structure-only');
    writeFileSync(join(ws.cans, '_rules.yaml'), rules(90, null));
    writeFileSync(join(ws.cans, '04-decisions.md'), specWith(NODE_92));

    const r = await checkWorkspace(join(ws.root, 'cans'), BASE_OPTS);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]!.rule).toBe('structure.node_length.max');
    expect(r.errorCount).toBe(1);
  });

  test('engine: distinct-but-reversed (200 vs 90) is still two budgets — node over both fires both', async () => {
    const ws = makeWs('distinct-reversed');
    writeFileSync(join(ws.cans, '_rules.yaml'), rules(200, 90));
    writeFileSync(join(ws.cans, '04-decisions.md'), specWith(NODE_92, NODE_223));

    const r = await checkWorkspace(join(ws.root, 'cans'), BASE_OPTS);
    const structureHits = r.issues.filter((i) => i.rule === 'structure.node_length.max');
    const overflowHits = r.issues.filter((i) => i.rule === 'overflow.node_chars');
    expect(structureHits.map((i) => i.line)).toEqual([2]); // 223 > 200
    expect(overflowHits.map((i) => i.line)).toEqual([1, 2]); // 92 and 223 > 90
    expect(r.errorCount).toBe(3);
  });
});
