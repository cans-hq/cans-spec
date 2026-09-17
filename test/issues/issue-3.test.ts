/**
 * Issue #3 — fuzzy-typo layer (redundancy layer 3) config + normalization.
 *
 * Reported bugs (GitHub issue #3):
 *   1. `fuzzyDistance` tokenized with its own loop and applied ONLY synonym
 *      normalization — the configured `redundancy.stopwords` and the
 *      `REF_SYNTAX_TOKENS` (`see`, `md`) exclusion used by layers 1/2/4 were
 *      ignored, so an explicit stopword like "approved" still produced
 *      `possible typo: "approved" ↔ "approve"` warnings.
 *   2. Layer 3 flagged English suffix inflections (approved/approve,
 *      sessions/session, denied/deny, manifests/manifest) as typos — 3,036 of
 *      3,881 real-corpus warnings, nearly all inflections, not typos.
 *   3. Layer 3 had no `_rules.yaml` key: the §18 delete-key contract ("delete
 *      a key = check turns off") could not target it; the only off-switch was
 *      `redundancy.enabled: false` / `--no-redundancy`, which also silence
 *      layers 1, 2 and 4.
 *
 * Fix under test:
 *   - Part 1: layer 3 collects words through the same filter as `wordSet()`
 *     (synonym normalization → skip empty → skip `see`/`md` → skip stopwords).
 *   - Part 2: `isInflectionOf` skips pairs that differ only by a common English
 *     suffix (light stem: iterative ing/ers/er/ed/es/s/ly strip + trailing-e
 *     strip + trailing i↔y fold) BEFORE the Levenshtein comparison.
 *   - Part 3: new `redundancy.fuzzy` check key (default true, §18 delete-key
 *     semantics: deleted → false) gates layer 3 independently.
 *
 * §18 note (verified here from both sides): SECTION_KEYS.redundancy grew 6→7,
 * so a template-shaped file listing the 6 pre-#3 keys now has `fuzzy` omitted
 * → deleted → layer 3 OFF, while a 7-key file with `fuzzy: true` keeps it ON.
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

import { spawnCli, REPO, writeTextSync } from '../runtime.ts';
import {
  fuzzyDistance, checkRedundancy, normalizeWord, isInflectionOf,
} from '../../src/core/redundancy.ts';
import { parseOutline } from '../../src/core/outline.ts';
import { defaultRules, loadRules } from '../../src/core/rules.ts';
import type { RedundancyRules } from '../../src/types.ts';
import { makeTmpDir, cleanTmpDir } from '../helpers.ts';

// ── shared fixtures ─────────────────────────────────────────────────────

const baseRedundancy = (): RedundancyRules => ({ ...defaultRules().redundancy });

/** The issue's two-node repro: layer 3 flagged approved ↔ approve (Levenshtein 1). */
const REPRO_NODES = [
  { text: 'approved refunds flow step one', file: 'demo.md', line: 2 },
  { text: 'approve refunds flow step two', file: 'demo.md', line: 3 },
];

// ── CLI harness (pattern copied from test/qa-round2/rules-config.test.ts) ──

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-3');

interface Ws { root: string; cans: string }

const createdDirs: string[] = [];
let wsSeq = 0;

function makeWs(name: string): Ws {
  const root = join(SCRATCH, `${name}-${++wsSeq}`);
  mkdirSync(join(root, 'cans'), { recursive: true });
  createdDirs.push(root);
  return { root, cans: join(root, 'cans') };
}

/** Blackbox CLI spawn, isolated from any ambient CANS_ROOT. */
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

/** Workspace with a fuzzy-eligible NON-stopword typo pair (flavour ↔ flavor,
 *  Levenshtein 1, no suffix relation) plus "cache" in exactly 3 nodes so the
 *  word-frequency layer (layer 1) has its own trigger. No refs, no fences,
 *  all groups ≥ 2 children, roots exempt from the collapse hint. */
function typoWs(name: string, rulesYaml: string): Ws {
  const ws = makeWs(name);
  writeFileSync(join(ws.cans, '01-goods.md'), [
    '- Goods',
    '  - UK customers prefer the flavour of vanilla beans',
    '  - Tasting notes describe flavour as rich',
    '  - Export lists every flavor variant available',
    '- Cache',
    '  - Cache warms on deploy quickly',
    '  - Cache purges nightly without drama',
    '',
  ].join('\n'));
  writeFileSync(join(ws.cans, '_rules.yaml'), rulesYaml);
  return ws;
}

/** Issue-repro spec shape: the Payments bullets from the issue report. */
function reproWs(name: string, specName: string, rulesYaml: string): Ws {
  const ws = makeWs(name);
  writeFileSync(join(ws.cans, specName), [
    '- Payments',
    '  - approved refunds flow step one',
    '  - approve refunds flow step two',
    '',
  ].join('\n'));
  writeFileSync(join(ws.cans, '_rules.yaml'), rulesYaml);
  return ws;
}

/** The issue's _rules.yaml, verbatim (all six pre-#3 redundancy keys). */
const ISSUE_RULES = [
  'redundancy:',
  '  enabled: true',
  '  word_frequency_threshold: 999',
  '  phrase_overlap_threshold: 1.1',
  '  cross_file_threshold: 99',
  '  stopwords: [approved, refunds]',
  '  synonyms: [[zzz, qqq]]',
  '',
].join('\n');

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Part 1: layer 3 honors stopwords + REF_SYNTAX_TOKENS ────────────────

describe('issue #3 part 1 — fuzzy layer normalization (stopwords + ref-syntax tokens)', () => {
  test('normalizeWord lowercases first, so stopword lists catch capitalized variants', () => {
    expect(normalizeWord('Approved', [])).toBe('approved');
  });

  test('unit: the issue repro pair is silenced when "approved"/"refunds" are configured stopwords', () => {
    // Pre-fix this produced: possible typo: "approved" ↔ "approve" — Levenshtein 1.
    const rules: RedundancyRules = { ...baseRedundancy(), stopwords: ['approved', 'refunds'] };
    const issues = fuzzyDistance(REPRO_NODES, rules);
    expect(issues).toEqual([]);
  });

  test('unit: a stopworded word is not collected at all — "flavor" (stopword) cannot pair with "flavour"', () => {
    // flavour/flavor is NOT an inflection pair, so this isolates the collection
    // filter: with "flavor" stopworded the pair cannot form from either side.
    const nodes = [
      { text: 'flavour', file: 'a.md', line: 1 },
      { text: 'flavor', file: 'b.md', line: 2 },
    ];
    expect(fuzzyDistance(nodes, { ...baseRedundancy(), stopwords: ['flavor'] })).toEqual([]);
    // guard: without the stopword the same corpus DOES flag (fixture sanity)
    const unfiltered = fuzzyDistance(nodes, { ...baseRedundancy(), stopwords: [] });
    expect(unfiltered.length).toBe(1);
    expect(unfiltered[0]!.message).toContain('possible typo');
  });

  test('unit: stopworded "table" leaves "tables" with no pair partner at all', () => {
    const nodes = [
      { text: 'table', file: 'a.md', line: 1 },
      { text: 'tables', file: 'a.md', line: 2 },
    ];
    const issues = fuzzyDistance(nodes, { ...baseRedundancy(), stopwords: ['table'] });
    expect(issues).toEqual([]);
  });

  test('unit: `see`/`md` ref-syntax tokens never produce typo pairs (§8/§13 exclusion)', () => {
    // see/md are below layer 3's >4-char floor for direct pairing; the contract
    // requirement is that they are FILTERED FROM COLLECTION like layers 1/2/4 —
    // ref-token-heavy text must yield zero layer-3 noise.
    const nodes = [
      { text: 'see md', file: 'a.md', line: 1 },
      { text: 'see: specs and md anchors', file: 'a.md', line: 2 },
    ];
    const issues = fuzzyDistance(nodes, baseRedundancy());
    expect(issues).toEqual([]);
  });
});

// ── Part 2: suffix-inflection pairs are skipped before Levenshtein ──────

describe('issue #3 part 2 — inflection skip (isInflectionOf)', () => {
  test('unit: must-skip pairs — approve/approved, session/sessions, manifest/manifests, deny/denied, carry/carries, apply/applies', () => {
    expect(isInflectionOf('approve', 'approved')).toBe(true);
    expect(isInflectionOf('approved', 'approve')).toBe(true); // order-independent
    expect(isInflectionOf('session', 'sessions')).toBe(true);
    expect(isInflectionOf('manifest', 'manifests')).toBe(true);
    expect(isInflectionOf('deny', 'denied')).toBe(true); // deni vs deny (i↔y)
    expect(isInflectionOf('carry', 'carries')).toBe(true); // carri vs carry
    expect(isInflectionOf('apply', 'applies')).toBe(true);
  });

  test('unit: must-NOT-skip pairs — genuine typos have no suffix relation', () => {
    expect(isInflectionOf('flavour', 'flavor')).toBe(false); // Levenshtein 1, no suffix relation
    expect(isInflectionOf('banjo', 'banana')).toBe(false);
    expect(isInflectionOf('table', 'tabble')).toBe(false);
  });

  test('unit: fuzzyDistance no longer flags inflection pairs as typos', () => {
    // approve/approved (d=1) and session/sessions (d=1) fired pre-fix.
    const pairs: Array<[string, string]> = [
      ['approve', 'approved'],
      ['session', 'sessions'],
      ['deny', 'denied'],
    ];
    for (const [a, b] of pairs) {
      const issues = fuzzyDistance(
        [{ text: a, file: 'a.md', line: 1 }, { text: b, file: 'a.md', line: 2 }],
        baseRedundancy(),
      );
      expect(issues).toEqual([]);
    }
  });

  test('unit: fuzzyDistance still flags genuine typo pairs (flavour ↔ flavor)', () => {
    const issues = fuzzyDistance(
      [{ text: 'flavour', file: 'a.md', line: 1 }, { text: 'flavor', file: 'b.md', line: 2 }],
      baseRedundancy(),
    );
    expect(issues.length).toBe(1);
    expect(issues[0]!.message).toContain('possible typo');
    expect(issues[0]!.message).toContain('flavour');
    expect(issues[0]!.message).toContain('flavor');
  });
});

// ── Part 3: `redundancy.fuzzy` — independent layer-3 switch ─────────────

describe('issue #3 part 3 — redundancy.fuzzy gates layer 3 independently', () => {
  test('unit: checkRedundancy with fuzzy: true flags the flavour↔flavor typo (exactly one issue)', () => {
    const files = new Map([
      ['g.md', parseOutline('- Goods\n  - the flavour profile is bold\n  - the flavor profile is mild\n', 'g.md')],
    ]);
    const issues = checkRedundancy(files, baseRedundancy());
    expect(issues.length).toBe(1);
    expect(issues[0]!.message).toContain('possible typo');
  });

  test('unit: checkRedundancy with fuzzy: false skips layer 3 — same workspace is silent', () => {
    const files = new Map([
      ['g.md', parseOutline('- Goods\n  - the flavour profile is bold\n  - the flavor profile is mild\n', 'g.md')],
    ]);
    const issues = checkRedundancy(files, { ...baseRedundancy(), fuzzy: false });
    expect(issues).toEqual([]);
  });

  test('unit: fuzzy: false leaves layer 4 (cross-file canonicality) running', () => {
    const files = new Map([
      ['a.md', parseOutline('- Authentication\n  - Sign up\n', 'a.md')],
      ['b.md', parseOutline('- Authentication\n  - Header required\n', 'b.md')],
    ]);
    const issues = checkRedundancy(files, { ...baseRedundancy(), fuzzy: false });
    const cross = issues.find(i => i.message.includes('without see:'));
    expect(cross).toBeDefined();
    expect(issues.some(i => i.message.includes('possible typo'))).toBe(false);
  });

  test('unit: §18 delete-key — template-shaped file listing the 6 pre-#3 keys turns fuzzy OFF', () => {
    // Template-shaped (structure listed) → omitted check-keys are deletions.
    // `fuzzy` is a check key now: absent from the 6-key template shape → OFF.
    const tmp = makeTmpDir('issue3-six-key-template');
    try {
      writeTextSync(join(tmp, '_rules.yaml'), [
        'structure:',
        '  node_length: { min: 3, max: 120 }',
        '  siblings: { min: 1, max: 12 }',
        '  depth: { min: 1, max: 5 }',
        '  single_child_collapse: true',
        '  empty_nodes: false',
        'redundancy:',
        '  enabled: true',
        '  word_frequency_threshold: 3',
        '  phrase_overlap_threshold: 1.1',
        '  cross_file_threshold: 99',
        '  stopwords: [the, a]',
        '  synonyms: [[zzz, qqq]]',
        '',
      ].join('\n'));
      const rules = loadRules(tmp);
      expect(rules.redundancy.fuzzy).toBe(false);
      // listed keys still override
      expect(rules.redundancy.enabled).toBe(true);
      expect(rules.redundancy.word_frequency_threshold).toBe(3);
    } finally {
      cleanTmpDir(tmp);
    }
  });

  test('unit: §18 — the 7-key template shape with fuzzy: true keeps layer 3 ON', () => {
    const tmp = makeTmpDir('issue3-seven-key-template');
    try {
      writeTextSync(join(tmp, '_rules.yaml'), [
        'structure:',
        '  node_length: { min: 3, max: 120 }',
        '  siblings: { min: 1, max: 12 }',
        '  depth: { min: 1, max: 5 }',
        '  single_child_collapse: true',
        '  empty_nodes: false',
        'redundancy:',
        '  enabled: true',
        '  word_frequency_threshold: 3',
        '  phrase_overlap_threshold: 1.1',
        '  cross_file_threshold: 99',
        '  fuzzy: true',
        '  stopwords: [the, a]',
        '  synonyms: [[zzz, qqq]]',
        '',
      ].join('\n'));
      const rules = loadRules(tmp);
      expect(rules.redundancy.fuzzy).toBe(true);
      // listed keys still override
      expect(rules.redundancy.word_frequency_threshold).toBe(3);
    } finally {
      cleanTmpDir(tmp);
    }
  });

  test('unit: sparse partial file (majority rule) keeps fuzzy at its default true; explicit false is honored', () => {
    const sparse = makeTmpDir('issue3-sparse-partial');
    try {
      // 1 of 7 keys listed → not majority-covered → omitted fuzzy is NOT deleted.
      writeTextSync(join(sparse, '_rules.yaml'), 'redundancy:\n  enabled: true\n');
      expect(loadRules(sparse).redundancy.fuzzy).toBe(true);
    } finally {
      cleanTmpDir(sparse);
    }
    const explicit = makeTmpDir('issue3-sparse-explicit-off');
    try {
      writeTextSync(join(explicit, '_rules.yaml'), 'redundancy:\n  enabled: true\n  fuzzy: false\n');
      const rules = loadRules(explicit);
      expect(rules.redundancy.fuzzy).toBe(false);
      expect(rules.redundancy.enabled).toBe(true);
    } finally {
      cleanTmpDir(explicit);
    }
  });
});

// ── CLI: end-to-end layer independence + delete-key contract + repro ────

describe('issue #3 — CLI: layer independence, delete-key contract, exact repro', () => {
  test('fuzzy: false disables layer 3 ONLY — layer 1 (word_frequency_threshold) still fires', () => {
    const ws = typoWs('fuzzy-false-layer1-runs', [
      'redundancy:',
      '  enabled: true',
      '  word_frequency_threshold: 3',
      '  phrase_overlap_threshold: 1.1',
      '  cross_file_threshold: 99',
      '  fuzzy: false',
      '',
    ].join('\n'));
    const r = runCli(['check', '--json'], ws.root);
    const parsed = parseJsonOut(r.out);
    // layer 3 off: no typo pair anywhere
    expect(parsed.issues.filter((i: any) => i.message.includes('possible typo'))).toEqual([]);
    // layer 1 on: cache ×3 ≥ threshold 3
    const freq = parsed.issues.find(
      (i: any) => i.category === 'redundancy' && /"cache" × 3 nodes \(threshold: 3\)/.test(i.message),
    );
    expect(freq).toBeDefined();
    expect(r.exit).toBe(0); // warnings never fail a non-strict check (§19)
  });

  test('control: the same workspace with fuzzy: true fires BOTH the typo and the frequency warning', () => {
    const ws = typoWs('fuzzy-true-control', [
      'redundancy:',
      '  enabled: true',
      '  word_frequency_threshold: 3',
      '  phrase_overlap_threshold: 1.1',
      '  cross_file_threshold: 99',
      '  fuzzy: true',
      '',
    ].join('\n'));
    const r = runCli(['check', '--json'], ws.root);
    const parsed = parseJsonOut(r.out);
    const typo = parsed.issues.find((i: any) => i.message.includes('possible typo'));
    expect(typo).toBeDefined();
    expect(typo.message).toContain('flavour');
    expect(typo.message).toContain('flavor');
    expect(parsed.issues.some(
      (i: any) => i.category === 'redundancy' && /"cache" × 3 nodes/.test(i.message),
    )).toBe(true);
  });

  test('--no-redundancy still kills ALL layers (typo + frequency) while other engines run', () => {
    const ws = typoWs('no-redundancy-flag', [
      'redundancy:',
      '  enabled: true',
      '  word_frequency_threshold: 3',
      '  phrase_overlap_threshold: 1.1',
      '  cross_file_threshold: 99',
      '  fuzzy: true',
      '',
    ].join('\n'));
    const r = runCli(['check', '--json', '--no-redundancy'], ws.root);
    const parsed = parseJsonOut(r.out);
    expect(parsed.issues.filter((i: any) => i.category === 'redundancy')).toEqual([]);
    // non-vacuity: a non-redundancy engine still reported (ref-less single file → orphan)
    const orphan = parsed.issues.find((i: any) => i.message.includes('orphan'));
    expect(orphan).toBeDefined();
  });

  test('§18 delete-key: template-shaped 6-key redundancy section (no fuzzy) → layer 3 off, layer 1 on', () => {
    const ws = typoWs('delete-key-six-key-template', [
      'structure:',
      '  node_length: { min: 3, max: 120 }',
      '  siblings: { min: 1, max: 12 }',
      '  depth: { min: 1, max: 5 }',
      '  single_child_collapse: true',
      '  empty_nodes: false',
      'redundancy:',
      '  enabled: true',
      '  word_frequency_threshold: 3',
      '  phrase_overlap_threshold: 1.1',
      '  cross_file_threshold: 99',
      '  stopwords: [the, a, an, of, to, in, for, and, or, with, must, shall, requires]',
      '  synonyms:',
      '    - [postgres, postgresql, pg]',
      '',
    ].join('\n'));
    const r = runCli(['check', '--json'], ws.root);
    const parsed = parseJsonOut(r.out);
    // fuzzy omitted from a template-shaped file = deleted = layer 3 OFF (issue #3)
    expect(parsed.issues.filter((i: any) => i.message.includes('possible typo'))).toEqual([]);
    // layers 1 (and the rest of the engines) keep running
    expect(parsed.issues.some(
      (i: any) => i.category === 'redundancy' && /"cache" × 3 nodes/.test(i.message),
    )).toBe(true);
  });

  test('§18 delete-key: the same template + fuzzy: true (7 keys) → layer 3 back ON', () => {
    const ws = typoWs('delete-key-seven-key-template', [
      'structure:',
      '  node_length: { min: 3, max: 120 }',
      '  siblings: { min: 1, max: 12 }',
      '  depth: { min: 1, max: 5 }',
      '  single_child_collapse: true',
      '  empty_nodes: false',
      'redundancy:',
      '  enabled: true',
      '  word_frequency_threshold: 3',
      '  phrase_overlap_threshold: 1.1',
      '  cross_file_threshold: 99',
      '  fuzzy: true',
      '  stopwords: [the, a, an, of, to, in, for, and, or, with, must, shall, requires]',
      '  synonyms:',
      '    - [postgres, postgresql, pg]',
      '',
    ].join('\n'));
    const r = runCli(['check', '--json'], ws.root);
    const parsed = parseJsonOut(r.out);
    expect(parsed.issues.some((i: any) => i.message.includes('possible typo'))).toBe(true);
    expect(parsed.issues.some(
      (i: any) => i.category === 'redundancy' && /"cache" × 3 nodes/.test(i.message),
    )).toBe(true);
  });

  test('the exact issue repro (six-key rules, approved/refunds stopwords) exits with 0 warnings', () => {
    // The spec uses the orphan-exempt 00-overview.md name so the reported
    // redundancy noise can be judged in isolation (a ref-less demo.md would
    // add an unrelated refs-orphan warning). Node content + rules file are
    // verbatim from the issue. Silenced twice over, as §18 predicts: the
    // stopwords filter the pair words from layer 3, AND the 6-of-7-key file
    // deletes `fuzzy` (majority rule) turning layer 3 off entirely.
    const ws = reproWs('exact-issue-repro', '00-overview.md', ISSUE_RULES);
    const r = runCli(['check', '--json'], ws.root);
    const parsed = parseJsonOut(r.out);
    expect(r.exit).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.errorCount).toBe(0);
    expect(parsed.warningCount).toBe(0);
    expect(parsed.issues).toEqual([]);
  });
});
