/**
 * Issue #45 — a single over-limit node was double-reported as BOTH
 * structure.node_length.max AND overflow.node_chars when
 * structure.node_length.max === overflow.max_node_chars (the natural
 * one-char-budget-everywhere config).
 *
 * Issue #56 RESOLVED the collision STRUCTURALLY: the overflow engine (and its
 * `overflow.max_node_chars` budget) is REMOVED, so structure.node_length is
 * the ONE node-text-length limit and a double report is no longer possible —
 * there is no second rule to fire. This suite pins that post-#56 contract:
 *
 *   1. an over-limit node is reported EXACTLY ONCE, by
 *      structure.node_length.max (the authoritative and only char budget);
 *   2. several over-limit nodes → one finding each, none double-counted;
 *   3. `--json` carries the finding under sections.structure with
 *      counts.warnings per node (never a second, overflow-shaped entry;
 *      issue #61: default node_length severity 'warn' — warning level);
 *   4. node_length deleted (§18) → the node-length check is OFF — and with
 *      the overflow budget gone there is no second engine to catch it either:
 *      no sanctioned escape hatch exists (`overflow.*` rules keys now reject
 *      as unrecognized — pinned in test/issues/issue-56-strict-rules.test.ts).
 *
 * Levels: engine unit (checkWorkspace) and CLI blackbox (--json).
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

/** Curated (§18 delete-mode) rules: the char budget under test, every other
 *  check-key deleted (structure lists a section → template-shaped file →
 *  unlisted sections and omitted keys are OFF). */
function rules(nodeLengthMax: number | null): string {
  const lines: string[] = [];
  if (nodeLengthMax === null) {
    // structure listed WITHOUT node_length → delete-key semantics → OFF.
    lines.push('structure:', '  siblings: { min: 1, max: 12 }');
  } else {
    lines.push('structure:', `  node_length: { min: 3, max: ${nodeLengthMax} }`);
  }
  return lines.join('\n') + '\n';
}

/** 92 chars — crosses the 90 budget. */
const NODE_92 =
  'Quarterly platform consolidation wraps up next cycle pending vendor signature and the budget';
/** 223 chars — crosses the 90 budget with room to spare. */
const NODE_223 = `${'Quarterly platform consolidation wraps up next cycle pending vendor signature and budget confirmation from the finance group staff'} ${NODE_92}`;

expect(NODE_92.length).toBe(92); // fixture pin
expect(NODE_223.length).toBe(223); // fixture pin

/** Spec file: one root bullet per given node text (line = index + 1). */
function specWith(...nodes: string[]): string {
  return nodes.map((n) => `- ${n}`).join('\n') + '\n';
}

describe('issue #45 (post-#56) — one char budget, each over-limit node reported exactly once', () => {
  test('engine: node_length.max 90 → ONE finding per node, from the single budget', async () => {
    const ws = makeWs('single-budget');
    writeFileSync(join(ws.cans, '_rules.yaml'), rules(90));
    writeFileSync(join(ws.cans, '04-decisions.md'), specWith(NODE_92));

    const r = await checkWorkspace(join(ws.root, 'cans'), BASE_OPTS);
    // The over-limit node is reported ONCE — by the one surviving rule.
    // Issue #61: default node_length severity is 'warn', so the single
    // finding is a warning (exit 1 band), not the pre-#61 hardcoded error.
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]!.rule).toBe('structure.node_length.max');
    expect(r.issues[0]!.category).toBe('structure');
    expect(r.issues[0]!.line).toBe(1);
    expect(r.issues[0]!.level).toBe('warning');
    expect(r.issues[0]!.message).toBe('Node too long (92 > 90). Split or move to file.');
    expect(r.errorCount).toBe(0);
    expect(r.warningCount).toBe(1);
  });

  test('engine: three over-limit nodes → exactly three findings, none double-counted', async () => {
    const ws = makeWs('single-budget-many');
    writeFileSync(join(ws.cans, '_rules.yaml'), rules(90));
    writeFileSync(
      join(ws.cans, '04-decisions.md'),
      specWith(NODE_92, 'short and fine', NODE_223, 'also fine', `${NODE_92} again`),
    );

    const r = await checkWorkspace(join(ws.root, 'cans'), BASE_OPTS);
    const structureHits = r.issues.filter((i) => i.rule === 'structure.node_length.max');
    expect(structureHits).toHaveLength(3); // lines 1, 3, 5
    expect(structureHits.map((i) => i.line)).toEqual([1, 3, 5]);
    expect(r.errorCount).toBe(0);
    expect(r.warningCount).toBe(3);
  });

  test('CLI (--json): sections.structure carries the finding, counts.warnings is per-node', () => {
    const ws = makeWs('single-budget-json');
    writeFileSync(join(ws.cans, '_rules.yaml'), rules(90));
    writeFileSync(join(ws.cans, '04-decisions.md'), specWith(NODE_92));

    const r = runCli(['check', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    // Issue #61: node_length defaults to 'warn' — warnings-only, exit 1
    // (the bug double-counted: 2).
    expect(j.counts.errors).toBe(0);
    expect(j.counts.warnings).toBe(1);
    expect(j.sections.structure).toHaveLength(1);
    expect(j.sections.structure[0].rule).toBe('structure.node_length.max');
    expect(j.sections.structure[0].file).toBe('04-decisions.md');
    expect(j.sections.structure[0].line).toBe(1);
    expect(r.exit).toBe(1);
  });
});

describe('issue #45 (post-#56) — the deleted-key budget has no second engine behind it', () => {
  test('engine: node_length deleted (§18) → no node-length error (the overflow fallback is gone)', async () => {
    const ws = makeWs('budget-off');
    writeFileSync(join(ws.cans, '_rules.yaml'), rules(null));
    writeFileSync(join(ws.cans, '04-decisions.md'), specWith(NODE_92));

    const r = await checkWorkspace(join(ws.root, 'cans'), BASE_OPTS);
    // §18 delete-key contract: the check the author turned off stays off —
    // and with the overflow engine removed (issue #56) there is no silently
    // configured second budget that still fires behind the author's back.
    expect(r.issues).toHaveLength(0);
    expect(r.errorCount).toBe(0);
    expect(r.ok).toBe(true);
  });
});
