/**
 * QA round-3 red tests — §18 rules/config system (findings from QA-13, npm cans-spec@0.1.0).
 *
 * Each test asserts the DOCUMENTED contract (docs/cans.architecture.md, § citations
 * inline) that the implementation currently violates, and therefore FAILS (red) as
 * an assertion failure, confirming the mapped round-3 QA finding.
 * No assertions encode current buggy behavior; no failure-swallowing; no skips.
 *
 * Mapping (test → finding):
 *   R3-R1a ....... QA-13 F1 (MAJOR) — §18 "Partial file = only listed keys override":
 *                  a _rules.yaml listing ONLY `redundancy.word_frequency_threshold` and
 *                  `references.orphan_check` must keep every unlisted check at its
 *                  default (structure stays ON; the threshold-2 override applies).
 *                  Actual: a partial file silently disables EVERY check (Rules echo
 *                  prints `off`, green report, exit 0).
 *   R3-R1b ....... QA-13 F1 — §18 "Missing file = all defaults": an EMPTY _rules.yaml
 *                  is not a configuration; defaults must apply. Actual: all checks off.
 *   R3-R1c ....... QA-13 F1 — §18: unknown keys are not "listed keys"; a file with only
 *                  `bogus_key: 42` must leave defaults in force. Actual: all checks off.
 *   R3-R2a ....... QA-13 F2 (MAJOR) — §18 documents the inline-object syntax
 *                  (`inline objects {min: 3, max: 120}`); `synonyms: {vehicle: [car, auto]}`
 *                  must therefore parse and apply. Actual: `✗ Internal error:
 *                  {} is not iterable`, exit 2.
 *   R3-R2b ....... CONTROL (green at HEAD): the documented block-list synonym syntax
 *                  (`- [vehicle, car, auto]`) DOES merge and fire — proves the fixture
 *                  itself is sound, so R3-R2a red can only come from inline-object
 *                  handling.
 *   R3-R3a/b ..... QA-13 F4 (MINOR) — §18 `content.max_tbd_per_file` and
 *                  `content.tbd_allowed` are documented rule keys; exceeding the max
 *                  (or disallowing TBD) must produce a non-redundancy finding that
 *                  names the TBD policy. Actual: knobs are inert; the only output is
 *                  the redundancy layer's word-frequency noise (`"tbd" × 6 nodes`).
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

const REPO = join(import.meta.dir, '..', '..');
const CLI = join(REPO, 'src', 'cli.ts');
const SCRATCH = join(REPO, '.tmp', 'qa-round3', 'rules-config');

interface Ws { root: string; cans: string }

const createdDirs: string[] = [];
let wsSeq = 0;

function makeWs(name: string): Ws {
  const root = join(SCRATCH, `${name}-${++wsSeq}`);
  mkdirSync(join(root, 'cans'), { recursive: true });
  createdDirs.push(root);
  return { root, cans: join(root, 'cans') };
}

function runCli(args: string[], cwd: string) {
  const p = Bun.spawnSync(['bun', 'run', CLI, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, CANS_ROOT: '' },
  });
  return { exit: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
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

/** Exactly 130 chars — 10 over the documented default `node_length.max` of 120 (§18). */
const LONG_NODE =
  'Quarterly platform consolidation wraps up next cycle pending vendor signature and budget confirmation from the finance group staff';

/** Workspace exercising three engines at once, so a partial rules file can be
 *  judged on what STAYS on, not only on what changes:
 *    - structure: the 130-char node (only defect the structure engine can report)
 *    - redundancy: "cache" in exactly 3 nodes → silent at default threshold 4,
 *      flagged when the partial override lowers the threshold to 2.
 *  No refs (orphan check off via a LISTED key), no fences/tables, all parents
 *  have 2 children (no single-child collapse), no shared prefixes ≥ 6. */
function mixedWs(name: string, rulesYaml: string | null): Ws {
  const ws = makeWs(name);
  writeFileSync(join(ws.cans, '01-spec.md'), [
    '- Overview',
    '  - Alpha squad handles intake and triage',
    '  - Bravo squad handles scheduling escalations',
    '- Details',
    `  - ${LONG_NODE}`,
    '  - Rollout timing depends on vendor readiness',
    '- Cache',
    '  - Cache warms on deploy',
    '  - Cache purges nightly',
    '',
  ].join('\n'));
  if (rulesYaml !== null) writeFileSync(join(ws.cans, '_rules.yaml'), rulesYaml);
  return ws;
}

expect(LONG_NODE.length).toBe(130); // fixture pin

/** §18 default rules, verbatim values, with orphan_check relaxed to keep the
 *  single-file workspaces free of orphan warnings. */
const DEFAULT_RULES = [
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
  '  orphan_check: false',
  '  duplicate_home_check: true',
  'redundancy:',
  '  enabled: true',
  '  word_frequency_threshold: 4',
  '  phrase_overlap_threshold: 0.7',
  '  cross_file_threshold: 2',
  '  stopwords: [the, a, an, of, to, in, for, and, or, with, must, shall, requires]',
  '  synonyms:',
  '    - [postgres, postgresql, pg]',
  '    - [auth, authentication, sign-in, signin]',
  '    - [api, endpoint, route]',
  '    - [frontend, client, ui]',
  '    - [db, database, storage]',
  'token_budget:',
  '  enabled: true',
  '  default_limit: 4096',
  '  estimate_chars_per_token: 3.5',
  '  warn_threshold: 0.8',
  'overflow:',
  '  max_node_chars: 200',
  '  force_file_for: [code_block, table, diagram]',
  '',
].join('\n');

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('QA round-3 red verification: §18 rules system (QA-13 F1/F2/F4)', () => {
  test('control (green at HEAD): with NO _rules.yaml the defaults fire — structure error present, "cache" ×3 silent at threshold 4', () => {
    const ws = mixedWs('ctl-defaults', null);
    const r = runCli(['check', '--json'], ws.root);
    const parsed = parseJsonOut(r.out);
    expect(r.exit).toBe(1); // long node → structure error
    expect(parsed.errorCount).toBeGreaterThanOrEqual(1);
    expect(parsed.issues.some((i: any) => i.category === 'structure' && i.file === '01-spec.md')).toBe(true);
    // word-frequency layer only: "cache" × 3 nodes stays silent at default threshold 4
    // (the fuzzy layer's unrelated cycle↔cache typo warning is NOT a frequency flag)
    expect(parsed.issues.some((i: any) => i.category === 'redundancy' && /"cache" × \d+ nodes/.test(i.message))).toBe(false);
  });

  test('R3-R1a (§18 / QA-13 F1 MAJOR): partial _rules.yaml — unlisted checks stay ON and the listed override applies', () => {
    // §18: "Partial file = only listed keys override." The file lists ONLY
    // redundancy.word_frequency_threshold + references.orphan_check; structure,
    // style, overflow must remain at defaults, and "cache" ×3 must now flag at
    // threshold 2. Actual (QA-13 F1): the partial file turns EVERY check off —
    // green report, exit 0.
    const ws = mixedWs('r3-r1a-partial', [
      'redundancy:',
      '  word_frequency_threshold: 2',
      'references:',
      '  orphan_check: false',
      '',
    ].join('\n'));
    const r = runCli(['check', '--json'], ws.root);
    const parsed = parseJsonOut(r.out);
    expect(r.exit).toBe(1); // unlisted structure engine must still run
    expect(parsed.errorCount).toBeGreaterThanOrEqual(1);
    expect(parsed.issues.some((i: any) => i.category === 'structure' && i.file === '01-spec.md')).toBe(true);
    // the listed override must take effect: cache ×3 ≥ 2 (word-frequency layer)
    expect(parsed.issues.some((i: any) => i.category === 'redundancy' && /"cache" × \d+ nodes/.test(i.message))).toBe(true);
  });

  test('R3-R1b (§18 / QA-13 F1 MAJOR): an EMPTY _rules.yaml is "missing" — all defaults apply', () => {
    const ws = mixedWs('r3-r1b-empty', '');
    const r = runCli(['check', '--json'], ws.root);
    const parsed = parseJsonOut(r.out);
    expect(r.exit).toBe(1);
    expect(parsed.issues.some((i: any) => i.category === 'structure' && i.file === '01-spec.md')).toBe(true);
  });

  test('R3-R1c (§18 / QA-13 F1 MAJOR): unknown top-level keys are not "listed keys" — defaults apply', () => {
    const ws = mixedWs('r3-r1c-unknown', 'bogus_key: 42\n');
    const r = runCli(['check', '--json'], ws.root);
    const parsed = parseJsonOut(r.out);
    expect(r.exit).toBe(1);
    expect(parsed.issues.some((i: any) => i.category === 'structure' && i.file === '01-spec.md')).toBe(true);
  });

  test('R3-R2a (§18 / QA-13 F2 MAJOR): inline-object synonyms parse and apply — no crash', () => {
    // §18: the parser "Supports nested objects, inline arrays [a,b,c], inline
    // objects {min: 3, max: 120}". An inline object for synonyms is therefore
    // documented syntax. Actual (QA-13 F2): `✗ Internal error: {} is not
    // iterable`, exit 2.
    const rules = DEFAULT_RULES.replace(
      '  synonyms:\n    - [postgres, postgresql, pg]\n    - [auth, authentication, sign-in, signin]\n    - [api, endpoint, route]\n    - [frontend, client, ui]\n    - [db, database, storage]',
      '  synonyms: { vehicle: [car, auto] }',
    );
    expect(rules).toContain('synonyms: { vehicle: [car, auto] }'); // fixture pin
    const ws = makeWs('r3-r2a-inline-obj');
    writeFileSync(join(ws.cans, '01-fleet.md'), [
      '- Fleet',
      '  - Vehicle registration is annual',
      '  - Every car gets insurance',
      '  - Vehicle logs are audited monthly',
      '  - Car pooling is encouraged',
      '',
    ].join('\n'));
    writeFileSync(join(ws.cans, '_rules.yaml'), rules);
    const r = runCli(['check', '--json'], ws.root);
    expect(r.out).not.toMatch(/Internal error/i);
    expect(r.exit).not.toBe(2);
    const parsed = parseJsonOut(r.out);
    expect(parsed.ok).toBe(true);
    // vehicle×2 + car×2 merge into the "vehicle" group → ×4 ≥ threshold 4
    expect(parsed.issues.some((i: any) => i.category === 'redundancy' && /vehicle/i.test(i.message))).toBe(true);
  });

  test('control (green at HEAD): block-list synonym syntax merges vehicle/car and fires — proves the R3-R2a fixture', () => {
    const rules = DEFAULT_RULES.replace(
      '  synonyms:\n    - [postgres, postgresql, pg]\n    - [auth, authentication, sign-in, signin]\n    - [api, endpoint, route]\n    - [frontend, client, ui]\n    - [db, database, storage]',
      '  synonyms:\n    - [vehicle, car, auto]',
    );
    const ws = makeWs('r3-r2b-ctl-blocklist');
    writeFileSync(join(ws.cans, '01-fleet.md'), [
      '- Fleet',
      '  - Vehicle registration is annual',
      '  - Every car gets insurance',
      '  - Vehicle logs are audited monthly',
      '  - Car pooling is encouraged',
      '',
    ].join('\n'));
    writeFileSync(join(ws.cans, '_rules.yaml'), rules);
    const r = runCli(['check', '--json'], ws.root);
    const parsed = parseJsonOut(r.out);
    expect(r.exit).toBe(0);
    expect(parsed.issues.some((i: any) => i.category === 'redundancy' && /vehicle/i.test(i.message))).toBe(true);
  });

  test('R3-R3a (§18 / QA-13 F4): content.max_tbd_per_file is enforced — 6 TBDs with max 2 must produce a non-redundancy TBD finding', () => {
    const rules = DEFAULT_RULES.replace('  max_tbd_per_file: 5', '  max_tbd_per_file: 2');
    const ws = makeWs('r3-r3a-tbd-max');
    writeFileSync(join(ws.cans, '01-billing.md'), [
      '- Billing',
      '  - Invoice format: TBD',
      '  - Payment rails: TBD',
      '  - Refund policy: TBD',
      '  - Tax handling: TBD',
      '  - Currency support: TBD',
      '  - Ledger export: TBD',
      '',
    ].join('\n'));
    writeFileSync(join(ws.cans, '_rules.yaml'), rules);
    const r = runCli(['check', '--json'], ws.root);
    const parsed = parseJsonOut(r.out);
    // The redundancy layer's word-frequency noise ("tbd" × 6) does NOT satisfy
    // this — the TBD-policy finding must come from a non-redundancy check.
    expect(parsed.issues.some((i: any) => /TBD/i.test(i.message) && i.category !== 'redundancy')).toBe(true);
  });

  test('R3-R3b (§18 / QA-13 F4): content.tbd_allowed: false — TBD nodes must produce a non-redundancy TBD finding', () => {
    const rules = DEFAULT_RULES.replace('  tbd_allowed: true', '  tbd_allowed: false');
    const ws = makeWs('r3-r3b-tbd-disallowed');
    writeFileSync(join(ws.cans, '01-billing.md'), [
      '- Billing',
      '  - Invoice format: TBD',
      '  - Payment rails: TBD',
      '',
    ].join('\n'));
    writeFileSync(join(ws.cans, '_rules.yaml'), rules);
    const r = runCli(['check', '--json'], ws.root);
    const parsed = parseJsonOut(r.out);
    expect(parsed.issues.some((i: any) => /TBD/i.test(i.message) && i.category !== 'redundancy')).toBe(true);
  });
});
