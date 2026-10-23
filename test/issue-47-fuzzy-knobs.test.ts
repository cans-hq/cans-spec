/**
 * Issue #47 — the fuzzy typo layer (redundancy layer 3) is unconfigurable.
 *
 * Bug: fuzzyDistance hardcodes Levenshtein ≤ 2 and words > 4 chars
 * (`a.text.length <= 4 → skip`, `d <= 2 → flag`). At ~7,500-node scale this
 * produces 650+ false positives per file (content↔concept, public↔publish,
 * verbs↔terms); the only lever is `fuzzy: false`, which loses typo
 * detection entirely.
 *
 * Fix under test: two §18-style PARAMETERS in the redundancy section —
 *   fuzzy_max_distance   (default 2)  — max Levenshtein distance for a pair
 *   fuzzy_min_word_length (default 5) — words shorter than this never pair
 * (the layer's CHECK switch remains `fuzzy`). Parameters keep their
 * defaults when deleted/omitted (§18) and count towards a section's
 * SECTION_KEYS coverage without ever being flipped OFF.
 *
 * Runtime-neutral: imports the test facade, never 'bun:test' directly.
 */
import { describe, test, expect, afterEach } from './testing.ts';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

import { spawnCli, REPO, writeTextSync } from './runtime.ts';
import { fuzzyDistance, checkRedundancy } from '../src/core/redundancy.ts';
import { parseOutline } from '../src/core/outline.ts';
import { defaultRules, loadRules } from '../src/core/rules.ts';
import type { RedundancyRules } from '../src/types.ts';
import { makeTmpDir, cleanTmpDir } from './helpers.ts';

const baseRedundancy = (): RedundancyRules => ({ ...defaultRules().redundancy });

/** Knob view of the rules — the fields land with the fix (issue #47). */
const knobs = (r: RedundancyRules): Record<string, unknown> => r as unknown as Record<string, unknown>;

/** base rules + issue #47 knob overrides. */
const withKnobs = (over: Record<string, unknown>): RedundancyRules =>
  ({ ...baseRedundancy(), ...over }) as RedundancyRules;

/** The issue's false-positive pair: content ↔ concept (both 7 chars, Levenshtein 2). */
const CONTENT_CONCEPT_NODES = [
  { text: 'content strategy', file: 'demo.md', line: 2 },
  { text: 'concept strategy', file: 'demo.md', line: 3 },
];

/** The issue's second false-positive pair: public ↔ publish (Levenshtein 2). */
const PUBLIC_PUBLISH_NODES = [
  { text: 'public endpoints', file: 'demo.md', line: 2 },
  { text: 'publish endpoints', file: 'demo.md', line: 3 },
];

/** A genuine distance-1 typo pair (flavour ↔ flavor). */
const FLAVOUR_NODES = [
  { text: 'flavour profile', file: 'demo.md', line: 2 },
  { text: 'flavor profile', file: 'demo.md', line: 3 },
];

// ── Layer 3 honors the knobs ──────────────────────────────────────────────

describe('issue #47 — fuzzyDistance honors fuzzy_min_word_length', () => {
  test('control: defaults (min 5) still flag content ↔ concept (both len 7, d=2)', () => {
    const issues = fuzzyDistance(CONTENT_CONCEPT_NODES, baseRedundancy());
    expect(issues.length).toBe(1);
    expect(issues[0]!.message).toContain('possible typo');
  });

  test('fuzzy_min_word_length: 8 suppresses content ↔ concept (both len 7)', () => {
    expect(fuzzyDistance(CONTENT_CONCEPT_NODES, withKnobs({ fuzzy_min_word_length: 8 }))).toEqual([]);
  });

  test('fuzzy_min_word_length keeps shorter words pairable when lowered', () => {
    // min 4 lets 4-letter words pair: "tabs" ↔ "tube" (d=2, no inflection
    // relation — lightStem folds "tabs"→"tab", "tube"→"tub", different).
    const nodes = [
      { text: 'tabs here', file: 'demo.md', line: 1 },
      { text: 'tube there', file: 'demo.md', line: 2 },
    ];
    expect(fuzzyDistance(nodes, baseRedundancy())).toEqual([]); // default min 5 skips len-4 words
    const issues = fuzzyDistance(nodes, withKnobs({ fuzzy_min_word_length: 4 }));
    expect(issues.length).toBe(1);
    expect(issues[0]!.message).toContain('tabs');
    expect(issues[0]!.message).toContain('tube');
  });
});

describe('issue #47 — fuzzyDistance honors fuzzy_max_distance', () => {
  test('fuzzy_max_distance: 1 suppresses distance-2 pairs (content↔concept, public↔publish)', () => {
    const rules = withKnobs({ fuzzy_max_distance: 1 });
    expect(fuzzyDistance(CONTENT_CONCEPT_NODES, rules)).toEqual([]);
    expect(fuzzyDistance(PUBLIC_PUBLISH_NODES, rules)).toEqual([]);
  });

  test('fuzzy_max_distance: 1 still catches distance-1 typos (flavour ↔ flavor)', () => {
    const issues = fuzzyDistance(FLAVOUR_NODES, withKnobs({ fuzzy_max_distance: 1 }));
    expect(issues.length).toBe(1);
    expect(issues[0]!.message).toContain('flavour');
    expect(issues[0]!.message).toContain('flavor');
  });

  test('control: defaults (max 2) still flag public ↔ publish', () => {
    const issues = fuzzyDistance(PUBLIC_PUBLISH_NODES, baseRedundancy());
    expect(issues.length).toBe(1);
    expect(issues[0]!.message).toContain('public');
    expect(issues[0]!.message).toContain('publish');
  });

  test('the length-difference pre-filter follows fuzzy_max_distance (optimization bound)', () => {
    // |len diff| 3 = d 3 ("abcde" → "abcdefgh" is 3 inserts): skipped at the
    // default max 2 (by the pre-filter AND by distance), but flagged once
    // fuzzy_max_distance is raised to 3 — proving the pre-filter uses the
    // knob instead of a hardcoded 2 (a hardcoded bound would skip the pair
    // before the Levenshtein comparison could ever run).
    const nodes = [
      { text: 'abcde marker', file: 'demo.md', line: 1 },
      { text: 'abcdefgh marker', file: 'demo.md', line: 2 },
    ];
    expect(fuzzyDistance(nodes, baseRedundancy())).toEqual([]);
    const issues = fuzzyDistance(nodes, withKnobs({ fuzzy_max_distance: 3 }));
    expect(issues.length).toBe(1);
    expect(issues[0]!.message).toContain('abcde');
  });
});

describe('issue #47 — checkRedundancy end-to-end with the knobs', () => {
  const files = new Map([
    ['00-overview.md', parseOutline('- Usage\n  - content strategy\n  - concept strategy\n', '00-overview.md')],
  ]);

  test('defaults flag content ↔ concept through the full layer stack', () => {
    const issues = checkRedundancy(files, baseRedundancy());
    const typo = issues.find(i => i.rule === 'redundancy.typo');
    expect(typo).toBeDefined();
    expect(typo!.message).toContain('content');
  });

  test('fuzzy_min_word_length: 8 suppresses it through the full layer stack', () => {
    const issues = checkRedundancy(files, withKnobs({ fuzzy_min_word_length: 8 }));
    expect(issues.filter(i => i.rule === 'redundancy.typo')).toEqual([]);
  });
});

// ── §18 semantics: parameters, not check switches ─────────────────────────

describe('issue #47 — §18 parameter semantics via loadRules', () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    while (tmpDirs.length > 0) cleanTmpDir(tmpDirs.pop()!);
  });

  const load = (yaml: string) => {
    const tmp = makeTmpDir('issue47-load');
    tmpDirs.push(tmp);
    mkdirSync(tmp, { recursive: true });
    writeTextSync(join(tmp, '_rules.yaml'), yaml);
    return loadRules(tmp);
  };

  test('defaults are fuzzy_max_distance 2 and fuzzy_min_word_length 5', () => {
    const r = defaultRules().redundancy;
    expect(knobs(r).fuzzy_max_distance).toBe(2);
    expect(knobs(r).fuzzy_min_word_length).toBe(5);
  });

  test('omitted keys keep their defaults (partial file, §18 parameters)', () => {
    const rules = load('redundancy:\n  word_frequency_threshold: 3\n');
    expect(knobs(rules.redundancy).fuzzy_max_distance).toBe(2);
    expect(knobs(rules.redundancy).fuzzy_min_word_length).toBe(5);
  });

  test('template-shaped file omitting the knobs keeps them (never flipped OFF, §18)', () => {
    // structure listed → delete-key mode: omitted CHECK keys turn off, but
    // the issue #47 knobs are parameters — they keep their defaults.
    const rules = load([
      'structure:',
      '  node_length: { min: 3, max: 120 }',
      '  siblings: { min: 1, max: 12 }',
      '  depth: { min: 1, max: 5 }',
      '  single_child_collapse: true',
      '  empty_nodes: false',
      'redundancy:',
      '  enabled: true',
      '  word_frequency_threshold: 4',
      '  phrase_overlap_threshold: 0.7',
      '  cross_file_threshold: 2',
      '  fuzzy: true',
      '  stopwords: [the, a]',
      '  synonyms: [[zzz, qqq]]',
      '',
    ].join('\n'));
    expect(knobs(rules.redundancy).fuzzy_max_distance).toBe(2);
    expect(knobs(rules.redundancy).fuzzy_min_word_length).toBe(5);
    // sanity: the file is template-shaped, so a deleted CHECK key would be off
    expect(rules.redundancy.fuzzy).toBe(true); // listed → stays on
  });

  test('explicit values override the defaults', () => {
    const rules = load('redundancy:\n  fuzzy_max_distance: 1\n  fuzzy_min_word_length: 8\n');
    expect(knobs(rules.redundancy).fuzzy_max_distance).toBe(1);
    expect(knobs(rules.redundancy).fuzzy_min_word_length).toBe(8);
  });

  test('the knobs count towards SECTION_KEYS coverage (majority-rule denominator is now 9)', () => {
    // 5 of 9 keys listed → majority (10 ≥ 9) → the unlisted check key
    // `fuzzy` is deleted (off). 4 of 9 → below majority (8 < 9) → `fuzzy`
    // keeps its default. This pins the §18 coverage convention extended by
    // the two new parameter keys.
    const five = load([
      'redundancy:',
      '  enabled: true',
      '  word_frequency_threshold: 4',
      '  phrase_overlap_threshold: 0.7',
      '  cross_file_threshold: 2',
      '  stopwords: [the]',
      '',
    ].join('\n'));
    expect(five.redundancy.fuzzy).toBe(false); // majority-covered section → deleted key = off
    const four = load([
      'redundancy:',
      '  enabled: true',
      '  word_frequency_threshold: 4',
      '  phrase_overlap_threshold: 0.7',
      '  cross_file_threshold: 2',
      '',
    ].join('\n'));
    expect(four.redundancy.fuzzy).toBe(true); // 8 < 9 → not majority → default kept
  });
});

// ── CLI end-to-end ────────────────────────────────────────────────────────

describe('issue #47 — CLI: fuzzy knobs are configurable via _rules.yaml', () => {
  const SCRATCH = join(REPO, '.tmp', 'issue-47');
  const createdDirs: string[] = [];
  afterEach(() => {
    while (createdDirs.length > 0) {
      rmSync(createdDirs.pop()!, { recursive: true, force: true });
    }
  });

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
    const j = parsed as Record<string, unknown> | null;
    if (j !== null && typeof j === 'object' && (j as any).sections !== undefined && (j as any).issues === undefined) {
      (j as any).issues = Object.entries((j as any).sections as Record<string, any[]>).flatMap(([category, arr]) =>
        arr.map((i) => ({ ...i, category, message: i.detail })),
      );
    }
    return parsed;
  }

  /** Both pairs in one tree: content↔concept (d=2), flavour↔flavor (d=1). */
  function makeWs(name: string, rulesYaml: string | null): string {
    const root = join(SCRATCH, `${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    mkdirSync(join(root, 'cans'), { recursive: true });
    createdDirs.push(root);
    writeFileSync(join(root, 'cans', '00-overview.md'), [
      '- Words',
      '  - content strategy',
      '  - concept strategy',
      '  - flavour profile',
      '  - flavor profile',
      '',
    ].join('\n'));
    if (rulesYaml !== null) writeFileSync(join(root, 'cans', '_rules.yaml'), rulesYaml);
    return root;
  }

  const typoIssues = (j: any) =>
    j.issues.filter((i: any) => i.rule === 'redundancy.typo');

  test('control: default rules flag both pairs', () => {
    const j = parseJsonOut(runCli(['check', '--json'], makeWs('default', null)).out);
    const typos = typoIssues(j);
    expect(typos.some((i: any) => /content.*concept|concept.*content/.test(i.message))).toBe(true);
    expect(typos.some((i: any) => /flavour.*flavor|flavor.*flavour/.test(i.message))).toBe(true);
  });

  test('fuzzy_min_word_length: 8 suppresses content↔concept, keeps flavour↔flavor', () => {
    const j = parseJsonOut(runCli(['check', '--json'], makeWs(
      'minlen-8',
      'redundancy:\n  fuzzy_min_word_length: 8\n',
    )).out);
    const typos = typoIssues(j);
    expect(typos.some((i: any) => /content.*concept|concept.*content/.test(i.message))).toBe(false);
    expect(typos.some((i: any) => /flavour.*flavor|flavor.*flavour/.test(i.message))).toBe(true);
  });

  test('fuzzy_max_distance: 1 suppresses the distance-2 pair, keeps the distance-1 pair', () => {
    const j = parseJsonOut(runCli(['check', '--json'], makeWs(
      'maxdist-1',
      'redundancy:\n  fuzzy_max_distance: 1\n',
    )).out);
    const typos = typoIssues(j);
    expect(typos.some((i: any) => /content.*concept|concept.*content/.test(i.message))).toBe(false);
    expect(typos.some((i: any) => /flavour.*flavor|flavor.*flavour/.test(i.message))).toBe(true);
  });
});
