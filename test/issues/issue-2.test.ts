/**
 * Issue #2 — `style.prefer` and `references.mode` were dead config: parsed,
 * delete-key-reconciled, shipped in the template, but never read by any check
 * (under an explicit `prefer: nested` the engine still advised "Collapse to
 * sibling style." — the exact opposite of the declared preference).
 *
 * This suite pins the wired behavior:
 *
 *   1. prefer wiring in checkStyle (suppression matrix):
 *        prefer: 'sibling' → shared-prefix "Group under nested style." hint is
 *                             suppressed; the collapse-to-sibling hint fires.
 *        prefer: 'nested'  → "Collapse to sibling style." hint is suppressed;
 *                             the shared-prefix grouping hint fires.
 *        prefer: null (key deleted, §18) → NO prefer-driven modulation — both
 *                             hints fire exactly as before the wiring existed.
 *   2. Value validation (validateRulesShape): `style.prefer` must be
 *      'sibling' | 'nested' (or empty/null) and `references.mode` must be
 *      'pointer' (or empty/null); anything else → line-numbered
 *      `invalid _rules.yaml` error, exit 1 (§18/§19 — never a silent no-op).
 *   3. Regression: the issue's Repro A markdown under the default
 *      `prefer: sibling` now yields exactly ONE style warning (the collapse
 *      hint) instead of two — the "request" shared-prefix warning is gone.
 *
 * Blackbox verification via the CLI, replicating the workspace-building
 * pattern of test/qa-round2/rules-config.test.ts.
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

import { spawnCli, REPO } from '../runtime.ts';

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-2');

interface Ws { root: string; cans: string }

const createdDirs: string[] = [];
let wsSeq = 0;

/** Fresh scratch workspace under repo/.tmp/issues/issue-2 (gitignored). */
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

/** JSON-mode output must be a single JSON document; a parse failure is itself an assertion failure. */
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

/** Issue #2 Repro A: both style hints trigger at once —
 *  - "Prefix parent" has 6 leaf children sharing the first word "request"
 *    (≥ force_nested_above 6 → shared-prefix grouping hint), and
 *  - "Keeper" has exactly 3 leaf children (≤ force_sibling_below 3, indent > 0
 *    → collapse-to-sibling hint). */
const REPRO_A = [
  '- Root',
  '  - Keeper',
  '    - Alpha detail one',
  '    - Beta detail two',
  '    - Gamma detail three',
  '  - Prefix parent',
  '    - request items alpha',
  '    - request items beta',
  '    - request items gamma',
  '    - request items delta',
  '    - request items eps',
  '    - request items zeta',
  '',
].join('\n');

/** Full template-shaped _rules.yaml (every §18 default key listed, so the
 *  delete-key semantics apply to omissions) with the style section supplied
 *  verbatim and the noise engines (redundancy, orphan check) disabled so the
 *  style findings are the ONLY possible issues. */
function templateRules(styleLines: string[]): string {
  return [
    'structure:',
    '  node_length: { min: 3, max: 120 }',
    '  siblings: { min: 1, max: 12 }',
    '  depth: { min: 1, max: 5 }',
    '  single_child_collapse: true',
    '  empty_nodes: false',
    'style:',
    ...styleLines,
    'content:',
    '  tbd_allowed: true',
    '  max_tbd_per_file: 5',
    'references:',
    '  mode: pointer',
    '  back_pointers: true',
    '  max_hops: 1',
    '  orphan_check: false',
    '  duplicate_home_check: true',
    'redundancy:',
    '  enabled: false',
    'overflow:',
    '  max_node_chars: 200',
    '  force_file_for: [code_block, table, diagram]',
    '',
  ].join('\n');
}

function reproWs(name: string, rulesYaml: string): Ws {
  const ws = makeWs(name);
  writeFileSync(join(ws.cans, '01-spec.md'), REPRO_A);
  writeFileSync(join(ws.cans, '_rules.yaml'), rulesYaml);
  return ws;
}

const SIBLING_STYLE = [
  '  prefer: sibling',
  '  force_nested_above: 6',
  '  force_sibling_below: 3',
  '  shared_prefix_detection: true',
];

const NESTED_STYLE = [
  '  prefer: nested',
  '  force_nested_above: 6',
  '  force_sibling_below: 3',
  '  shared_prefix_detection: true',
];

/** prefer DELETED (§18): the style section lists its other three keys; the
 *  file is template-shaped (structure listed), so the omitted `prefer` is a
 *  deletion → reconciled to null → no prefer-driven modulation. */
const DELETED_PREFER_STYLE = [
  '  force_nested_above: 6',
  '  force_sibling_below: 3',
  '  shared_prefix_detection: true',
];

/** Minimal clean spec (no style triggers either way) for the validation tests. */
function rulesWs(name: string, rulesYaml: string): Ws {
  const ws = makeWs(name);
  writeFileSync(join(ws.cans, '01-spec.md'), '- Overview\n  - Alpha detail one\n  - Beta detail two\n');
  writeFileSync(join(ws.cans, '_rules.yaml'), rulesYaml);
  return ws;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('issue #2 — style.prefer wiring in checkStyle', () => {
  test('prefer: nested suppresses "Collapse to sibling style." — the shared-prefix grouping hint still fires', () => {
    const ws = reproWs('prefer-nested', templateRules(NESTED_STYLE));

    const r = runCli(['check', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(0); // style findings are warnings — exit unaffected
    expect(j.errorCount).toBe(0);
    // The issue's contradiction is gone: no collapse advice under prefer: nested.
    const collapse = j.issues.filter((i: any) => /Collapse to sibling style/.test(i.message));
    expect(collapse).toEqual([]);
    // The grouping hint aligns with the declared nested preference — keeps firing.
    const grouped = j.issues.filter(
      (i: any) => i.category === 'style' && /share prefix "request"/.test(i.message),
    );
    expect(grouped.length).toBe(1);
    expect(j.warningCount).toBe(1);
  });

  test('prefer: sibling suppresses "Group under nested style." — the collapse-to-sibling hint still fires', () => {
    const ws = reproWs('prefer-sibling', templateRules(SIBLING_STYLE));

    const r = runCli(['check', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(0);
    expect(j.errorCount).toBe(0);
    const grouped = j.issues.filter((i: any) => /share prefix/.test(i.message));
    expect(grouped).toEqual([]);
    const collapse = j.issues.filter(
      (i: any) =>
        i.category === 'style' &&
        /"Keeper" has 3 children\. Collapse to sibling style\./.test(i.message),
    );
    expect(collapse.length).toBe(1);
    expect(j.warningCount).toBe(1);
  });

  test('prefer deleted (style listed without it, template-shaped file) → null → NO modulation: both hints fire', () => {
    const ws = reproWs('prefer-deleted', templateRules(DELETED_PREFER_STYLE));

    const r = runCli(['check', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(0);
    expect(j.errorCount).toBe(0);
    const grouped = j.issues.filter(
      (i: any) => i.category === 'style' && /share prefix "request"/.test(i.message),
    );
    expect(grouped.length).toBe(1);
    const collapse = j.issues.filter(
      (i: any) => i.category === 'style' && /Collapse to sibling style/.test(i.message),
    );
    expect(collapse.length).toBe(1);
    expect(j.warningCount).toBe(2);
  });
});

describe('issue #2 — regression: default prefer: sibling on the issue Repro A', () => {
  test('template-shaped default-valued rules (prefer: sibling) → exactly ONE warning: the collapse hint; the "request" shared-prefix warning is suppressed', () => {
    const ws = reproWs('repro-a-defaults', templateRules(SIBLING_STYLE));

    const r = runCli(['check', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(0);
    expect(j.errorCount).toBe(0);
    // Before the fix this file produced TWO style warnings; the second one
    // ("6 siblings share prefix "request". Group under nested style.") argued
    // against the declared default sibling preference.
    const styleIssues = j.issues.filter((i: any) => i.category === 'style');
    expect(styleIssues.length).toBe(1);
    expect(styleIssues[0].message).toBe('"Keeper" has 3 children. Collapse to sibling style.');
    expect(j.warningCount).toBe(1);
  });

  test('pure defaults (no _rules.yaml at all) → the style engine reports only the collapse hint, no "share prefix" advice', () => {
    const ws = makeWs('repro-a-no-rules-file');
    writeFileSync(join(ws.cans, '01-spec.md'), REPRO_A);

    const r = runCli(['check', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(0);
    const styleIssues = j.issues.filter((i: any) => i.category === 'style');
    expect(styleIssues.length).toBe(1);
    expect(styleIssues[0].message).toBe('"Keeper" has 3 children. Collapse to sibling style.');
    expect(j.issues.some((i: any) => /share prefix/.test(i.message))).toBe(false);
  });
});

describe('issue #2 — style.prefer / references.mode value validation (validateRulesShape)', () => {
  test('style.prefer: banana → invalid _rules.yaml error naming style.prefer, exit 1', () => {
    const ws = rulesWs('prefer-banana', templateRules(['  prefer: banana', ...DELETED_PREFER_STYLE]));

    const r = runCli(['check', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(1); // §18/§19: invalid config = user-correctable failure
    expect(j.ok).toBe(false);
    expect(j.errorCount).toBe(1);
    expect(j.error).toContain('invalid _rules.yaml');
    expect(j.error).toContain('"style.prefer" must be "sibling" or "nested"');
    expect(j.error).toContain('got "banana"');
    expect(j.error).toMatch(/line \d+/); // §18: line-numbered error
  });

  test('references.mode: banana → invalid _rules.yaml error naming references.mode, exit 1', () => {
    const ws = rulesWs('mode-banana', [
      'references:',
      '  mode: banana',
      '  back_pointers: true',
      '  max_hops: 1',
      '  orphan_check: false',
      '  duplicate_home_check: true',
      '',
    ].join('\n'));

    const r = runCli(['check', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(1);
    expect(j.ok).toBe(false);
    expect(j.errorCount).toBe(1);
    expect(j.error).toContain('invalid _rules.yaml');
    expect(j.error).toContain('"references.mode" must be "pointer"');
    expect(j.error).toContain('got "banana"');
  });

  test('style.prefer: 42 (non-string) fails the same got-value convention', () => {
    const ws = rulesWs('prefer-numeric', templateRules(['  prefer: 42', ...DELETED_PREFER_STYLE]));

    const r = runCli(['check', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(1);
    expect(j.error).toContain('"style.prefer" must be "sibling" or "nested"');
    expect(j.error).toContain('got "42"');
  });

  test('empty `prefer:` / `mode:` parse to null and are accepted (documented defaults)', () => {
    // An empty key must be the LAST key of its section: `prefer:` followed by
    // an indented block would parse that block as the key's value.
    const ws = rulesWs('empty-prefer-mode', [
      'structure:',
      '  node_length: { min: 3, max: 120 }',
      '  siblings: { min: 1, max: 12 }',
      '  depth: { min: 1, max: 5 }',
      '  single_child_collapse: true',
      '  empty_nodes: false',
      'style:',
      '  force_nested_above: 6',
      '  force_sibling_below: 3',
      '  shared_prefix_detection: true',
      '  prefer:',
      'content:',
      '  tbd_allowed: true',
      '  max_tbd_per_file: 5',
      'references:',
      '  back_pointers: true',
      '  max_hops: 1',
      '  orphan_check: false',
      '  duplicate_home_check: true',
      '  mode:',
      'redundancy:',
      '  enabled: false',
      'overflow:',
      '  max_node_chars: 200',
      '  force_file_for: [code_block, table, diagram]',
      '',
    ].join('\n'));

    const r = runCli(['check', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(0);
    expect(j.ok).toBe(true);
    expect(j.errorCount).toBe(0);
    expect(j.issues.some((i: any) => /invalid _rules\.yaml/.test(i.message))).toBe(false);
  });
});
