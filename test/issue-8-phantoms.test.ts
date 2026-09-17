/**
 * Issue #8 regression tests — synthetic "(table)" / "(code fence)" phantom nodes.
 *
 * parseOutline materializes a placeholder root node when a table or code fence
 * appears BEFORE the first bullet of a file. Those phantoms are indistinguishable
 * from real nodes downstream: they inflate check's node counts, compare as
 * content in every redundancy layer (100% overlap, cross-file "canonical home",
 * word-frequency), and can trip structure/style checks that name the phantom.
 *
 * Fix contract (tag + filter, materialization preserved):
 *   - synthetic nodes carry `synthetic: true` and keep carrying hasTable /
 *     hasCodeFence (overflow detection on leading tables still works).
 *   - redundancy inputs, reported node counts, and budget token estimates
 *     exclude them.
 *   - flattenNodes itself is UNCHANGED (still includes synthetic nodes) —
 *     tree shape is parser output, not a report.
 *
 * Portable imports only (runs green under `bun test` and `npm run test:node`).
 */
import { describe, test, expect, afterEach } from './testing.ts';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

import {
  parseOutline, flattenNodes, isSyntheticNode, realNodes,
} from '../src/core/outline.ts';
import { checkRedundancy } from '../src/core/redundancy.ts';
import { checkStructure } from '../src/core/structure.ts';
import { checkStyle } from '../src/core/style.ts';
import { defaultRules } from '../src/core/rules.ts';
import {
  estimateTokens, findCanonicalHome, buildReadPlan,
} from '../src/core/token-budget.ts';
import { checkWorkspace } from '../src/commands/check.ts';
import { spawnCli, REPO } from './runtime.ts';
import type { OutlineNode } from '../src/types.ts';

const STRUCTURE_RULES = defaultRules().structure;
const STYLE_RULES = defaultRules().style;
const BUDGET_RULES = defaultRules().token_budget;

const LEADING_TABLE = [
  '| Key | Value |',
  '|-----|-------|',
  '| a   | 1     |',
  '',
].join('\n');

const LEADING_FENCE = [
  '```text',
  'literal code line',
  '```',
  '',
].join('\n');

// ── parser-level: materialization preserved + tagged ──

describe('issue #8: synthetic node materialization is preserved and tagged', () => {
  test('leading table produces a "(table)" root with synthetic === true', () => {
    const nodes = parseOutline(`${LEADING_TABLE}- Real root\n`, 'a.md');
    expect(nodes.length).toBe(2); // phantom root + real root (siblings)
    const phantom = nodes[0]!;
    expect(phantom.text).toBe('(table)');
    expect(phantom.synthetic).toBe(true);
    expect(isSyntheticNode(phantom)).toBe(true);
    expect(phantom.hasTable).toBe(true); // overflow signal must survive
    const real = nodes[1]!;
    expect(real.text).toBe('Real root');
    expect(real.synthetic).toBe(false); // makeNode initializes false
    expect(isSyntheticNode(real)).toBe(false);
  });

  test('leading fence produces a "(code fence)" root with synthetic === true', () => {
    const nodes = parseOutline(`${LEADING_FENCE}- Real root\n`, 'b.md');
    expect(nodes.length).toBe(2);
    const phantom = nodes[0]!;
    expect(phantom.text).toBe('(code fence)');
    expect(phantom.synthetic).toBe(true);
    expect(phantom.hasCodeFence).toBe(true);
    expect(isSyntheticNode(nodes[1]!)).toBe(false);
  });

  test('real bullets are never synthetic (plain file, no leading table/fence)', () => {
    const nodes = parseOutline('- Parent\n  - Child\n', 'c.md');
    for (const n of flattenNodes(nodes)) {
      expect(n.synthetic).toBe(false);
      expect(isSyntheticNode(n)).toBe(false);
    }
  });

  test('non-leading tables still attach hasTable to the previous real node (unchanged)', () => {
    const src = [
      '- Node with table',
      '  | a | b |',
      '  |---|---|',
      '- Node after table',
      '  | c | d |',
      '  |---|---|',
      '',
    ].join('\n');
    const nodes = parseOutline(src, 'd.md');
    expect(nodes.length).toBe(2);
    expect(nodes[0]!.hasTable).toBe(true);
    expect(nodes[1]!.hasTable).toBe(true);
    expect(nodes[0]!.synthetic).toBe(false);
    expect(nodes[1]!.synthetic).toBe(false);
  });

  test('flattenNodes still includes synthetic nodes (parser output unchanged)', () => {
    const nodes = parseOutline(`${LEADING_TABLE}- Real root\n`, 'e.md');
    expect(flattenNodes(nodes).length).toBe(2);
    expect(realNodes(nodes).length).toBe(1); // helper filters the phantom
    expect(realNodes(nodes)[0]!.text).toBe('Real root');
  });
});

// ── redundancy-level: phantom text is not content ──

function filesWithPhantoms(marker: string, realTexts: string[]): Map<string, OutlineNode[]> {
  const files = new Map<string, OutlineNode[]>();
  realTexts.forEach((text, i) => {
    const name = `0${i + 1}-f.md`;
    files.set(name, parseOutline(`${marker}${text}\n`, name));
  });
  return files;
}

describe('issue #8: redundancy layers ignore synthetic nodes', () => {
  test('two files opening with a table: no 100% overlap, no "(table)" canonical-home issue', () => {
    const files = filesWithPhantoms(LEADING_TABLE, [
      '- Zephyr alpha conduit',
      '- Quartz bravo dossier',
    ]);
    const issues = checkRedundancy(files, defaultRules().redundancy);
    // Pre-fix: both "(table)" phantoms compare as identical content.
    expect(issues.some(i => i.message.includes('100% overlap'))).toBe(false);
    expect(issues.some(i => i.message.includes('"(table)" at depth 0-1'))).toBe(false);
    expect(issues.some(i => i.message.includes('(table)'))).toBe(false);
  });

  test('two files opening with a fence: same exclusion for "(code fence)"', () => {
    const files = filesWithPhantoms(LEADING_FENCE, [
      '- Onyx charlie ember',
      '- Delta falcon griffin',
    ]);
    const issues = checkRedundancy(files, defaultRules().redundancy);
    expect(issues.some(i => i.message.includes('100% overlap'))).toBe(false);
    expect(issues.some(i => i.message.includes('"(code fence)" at depth 0-1'))).toBe(false);
    expect(issues.some(i => i.message.includes('(code fence)'))).toBe(false);
  });

  test('word frequency: 4 leading-table phantoms must NOT push "table" to threshold 4', () => {
    // Pre-fix, each "(table)" root contributes the token "table" — four files
    // collect "table" × 4 nodes, exactly the default word_frequency_threshold.
    const files = filesWithPhantoms(LEADING_TABLE, [
      '- Zephyr alpha conduit',
      '- Quartz bravo dossier',
      '- Onyx charlie ember',
      '- Delta falcon griffin',
    ]);
    const issues = checkRedundancy(files, defaultRules().redundancy);
    expect(issues.some(i => i.message.includes('"table"'))).toBe(false);
    expect(issues.some(i => i.message.includes('(table)'))).toBe(false);
  });
});

// ── structure / style: the phantom must not be named as a parent ──

describe('issue #8: structure/style checks do not report the phantom root', () => {
  test('single indented bullet under a leading table: no "(table)" has exactly 1 child', () => {
    // The bullet at indent 1 attaches under the synthetic root (parser
    // attachment is out of scope for this fix) — but the structure engine
    // must not treat the phantom as a collapsible parent.
    const nodes = parseOutline(`${LEADING_TABLE}  - single indented child\n`, 'f.md');
    const issues = checkStructure(nodes, 'f.md', STRUCTURE_RULES);
    expect(issues.some(i => i.message.includes('(table)'))).toBe(false);
  });

  test('control: a REAL root with one child still triggers the collapse hint', () => {
    const nodes = parseOutline('- Parent node here\n  - only child\n', 'g.md');
    const issues = checkStructure(nodes, 'g.md', STRUCTURE_RULES);
    expect(issues.some(i => i.message.includes('exactly 1 child'))).toBe(true);
  });

  test('six prefix-sharing bullets under a leading table: no style warning naming "(table)"', () => {
    const src = LEADING_TABLE + [
      '  - report alpha',
      '  - report beta',
      '  - report gamma',
      '  - report delta',
      '  - report epsilon',
      '  - report zeta',
      '',
    ].join('\n');
    const nodes = parseOutline(src, 'h.md');
    const issues = checkStyle(nodes, 'h.md', STYLE_RULES);
    expect(issues.some(i => i.message.includes('(table)'))).toBe(false);
  });

  test('control: the same prefix cluster under a REAL parent still warns', () => {
    const src = [
      '- Real parent node',
      '  - report alpha',
      '  - report beta',
      '  - report gamma',
      '  - report delta',
      '  - report epsilon',
      '  - report zeta',
      '',
    ].join('\n');
    const nodes = parseOutline(src, 'i.md');
    const issues = checkStyle(nodes, 'i.md', STYLE_RULES);
    expect(issues.some(i => i.message.includes('share prefix "report"'))).toBe(true);
  });
});

// ── budget: token estimates and canonical home exclude phantoms ──

describe('issue #8: budget planning ignores synthetic node text', () => {
  test('findCanonicalHome never returns the "(table)" phantom', () => {
    const files = new Map<string, OutlineNode[]>([
      ['99-table.md', parseOutline(LEADING_TABLE, '99-table.md')],
    ]);
    // Pre-fix: "(table)".includes("table") makes the phantom the canonical home.
    expect(findCanonicalHome('table', files)).toBeNull();
  });

  test('serialized token estimate excludes the phantom line', () => {
    const files = new Map<string, OutlineNode[]>([
      ['01-a.md', parseOutline(`${LEADING_TABLE}- Gamma home node\n`, '01-a.md')],
      ['02-b.md', parseOutline('- Gamma mention node\n', '02-b.md')],
    ]);
    const result = buildReadPlan('gamma', files, [], BUDGET_RULES);
    const item = result.plan.find(p => p.file === '01-a.md');
    expect(item).toBeDefined();
    // Pre-fix the "(table)\n" line inflates the serialized text (22 chars → 7 tok).
    expect(item!.estTokens).toBe(estimateTokens('Gamma home node', BUDGET_RULES.estimate_chars_per_token));
  });
});

// ── workspace-level: check header counts + CLI output ──

// Full §18 template shape (curated config → omitted keys would turn OFF) with
// overflow.force_file_for: [] so leading tables/fences are NOT overflow errors —
// isolating the redundancy/count behavior, as in the issue repro.
const RULES_NO_FORCE_FILE = [
  'structure:',
  '  node_length: { min: 3, max: 120 }',
  '  siblings: { min: 1, max: 12 }',
  '  depth: { min: 1, max: 5 }',
  '  single_child_collapse: true',
  '  empty_nodes: false',
  'style:',
  '  prefer: sibling',
  '  force_nested_above: 6',
  '  force_sibling_below: 3',
  '  shared_prefix_detection: true',
  'content:',
  '  tbd_allowed: true',
  '  max_tbd_per_file: 5',
  'references:',
  '  mode: pointer',
  '  back_pointers: true',
  '  max_hops: 1',
  '  orphan_check: true',
  '  duplicate_home_check: true',
  'redundancy:',
  '  enabled: true',
  '  word_frequency_threshold: 4',
  '  phrase_overlap_threshold: 0.7',
  '  cross_file_threshold: 2',
  '  stopwords: [the, a, an, of, to, in, for, and, or, with, must, shall, requires]',
  '  synonyms:',
  '    - [postgres, postgresql, pg]',
  'token_budget:',
  '  enabled: true',
  '  default_limit: 4096',
  '  estimate_chars_per_token: 3.5',
  '  warn_threshold: 0.8',
  'overflow:',
  '  max_node_chars: 200',
  '  force_file_for: []',
  '',
].join('\n');

interface Ws { root: string; cans: string }
const createdDirs: string[] = [];
let wsSeq = 0;
const SCRATCH = join(REPO, '.tmp', 'issue-8-phantoms');

function makeWs(name: string): Ws {
  const root = join(SCRATCH, `${name}-${++wsSeq}`);
  mkdirSync(join(root, 'cans'), { recursive: true });
  createdDirs.push(root);
  return { root, cans: join(root, 'cans') };
}

function writeWs(ws: Ws, files: Record<string, string>): void {
  writeFileSync(join(ws.cans, '_rules.yaml'), RULES_NO_FORCE_FILE);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(ws.cans, name), content);
  }
}

function tableSpec(root: string, childA: string, childB: string, childC: string): string {
  return LEADING_TABLE + [
    `- ${root}`,
    `  - ${childA}`,
    `  - ${childB}`,
    `  - ${childC}`,
    '',
  ].join('\n');
}

function fenceSpec(root: string, childA: string, childB: string, childC: string): string {
  return LEADING_FENCE + [
    `- ${root}`,
    `  - ${childA}`,
    `  - ${childB}`,
    `  - ${childC}`,
    '',
  ].join('\n');
}

const TABLE_WS_FILES = {
  '01-a.md': tableSpec('Gamma gateway setup', 'deploy the gateway', 'provision the cache', 'rotate the secrets'),
  '02-b.md': tableSpec('Lambda harbor marina', 'anchor the keel', 'raise the mast', 'coil the rope'),
};

const FENCE_WS_FILES = {
  '01-a.md': fenceSpec('Gamma gateway setup', 'deploy the gateway', 'provision the cache', 'rotate the secrets'),
  '02-b.md': fenceSpec('Lambda harbor marina', 'anchor the keel', 'raise the mast', 'coil the rope'),
};

describe('issue #8: checkWorkspace node counts and issues exclude phantoms', () => {
  test('two leading-table files: nodes == real nodes (8), no phantom redundancy output, ok', async () => {
    const ws = makeWs('ws-table');
    writeWs(ws, TABLE_WS_FILES);
    const result = await checkWorkspace(ws.cans, {
      fix: false, strict: false, refsOnly: false, noRedundancy: false, file: null, json: false,
    });
    // Pre-fix: 10 (6 real + 2 "(table)" phantoms).
    expect(result.nodes).toBe(8);
    expect(result.files).toBe(2);
    expect(result.maxDepth).toBe(2); // depth semantics unchanged (phantom sits at indent 0)
    expect(result.issues.some(i => i.message.includes('100% overlap'))).toBe(false);
    expect(result.issues.some(i => i.message.includes('(table)'))).toBe(false);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  test('fence variant: nodes == real nodes, no "(code fence)" output, ok', async () => {
    const ws = makeWs('ws-fence');
    writeWs(ws, FENCE_WS_FILES);
    const result = await checkWorkspace(ws.cans, {
      fix: false, strict: false, refsOnly: false, noRedundancy: false, file: null, json: false,
    });
    expect(result.nodes).toBe(8);
    expect(result.issues.some(i => i.message.includes('100% overlap'))).toBe(false);
    expect(result.issues.some(i => i.message.includes('(code fence)'))).toBe(false);
    expect(result.ok).toBe(true);
  });

  test('CLI (spawnCli) reports the phantom-free node count and clean exit', async () => {
    const ws = makeWs('cli-table');
    writeWs(ws, TABLE_WS_FILES);
    const r = spawnCli(['check', '--json'], ws.root, { ...process.env, CANS_ROOT: '' });
    expect(r.exit).toBe(0);
    const data = JSON.parse(r.out) as { ok: boolean; nodes: number; issues: Array<{ message: string }> };
    expect(data.ok).toBe(true);
    expect(data.nodes).toBe(8);
    expect(data.issues.some(i => i.message.includes('100% overlap'))).toBe(false);
    expect(data.issues.some(i => i.message.includes('(table)'))).toBe(false);
  });
});

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});
