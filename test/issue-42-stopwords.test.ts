/**
 * Issue #42 — unquoted numeric stopwords are inert (YAML Number vs string).
 *
 * Bug: the `_rules.yaml` block-array entry `- 10` parses (rules.ts scalar())
 * to the Number 10, but redundancy.ts tokenize() produces STRING tokens
 * ("10" out of `see: 10-sdk.md`). `stopwords.includes("10")` can never match
 * a Number entry, so numeric stopwords silently do nothing — `cans check`
 * still reports `"10" × N nodes (threshold: 4)`.
 *
 * Fix under test: loadRules() coerces every entry of a well-formed
 * `redundancy.stopwords` array (and every member of a well-formed synonym
 * group — the same token-type class of bug) with `.map(String)` after the
 * merge/normalization pass. Non-array shapes (empty `stopwords:`, scalar
 * `stopwords: 10`) keep their current behavior; only arrays are coerced.
 *
 * Runtime-neutral: imports the test facade, never 'bun:test' directly.
 */
import { describe, test, expect, afterEach } from './testing.ts';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

import { spawnCli, REPO, writeTextSync } from './runtime.ts';
import { loadRules, defaultRules } from '../src/core/rules.ts';
import { checkRedundancy } from '../src/core/redundancy.ts';
import { parseOutline } from '../src/core/outline.ts';
import { makeTmpDir, cleanTmpDir } from './helpers.ts';

// ── unit: loadRules coerces numeric entries to strings ───────────────────

describe('issue #42 — loadRules coerces unquoted numeric stopwords/synonyms', () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    while (tmpDirs.length > 0) cleanTmpDir(tmpDirs.pop()!);
  });

  const load = (yaml: string) => {
    const tmp = makeTmpDir('issue42-load');
    tmpDirs.push(tmp);
    mkdirSync(tmp, { recursive: true });
    writeTextSync(join(tmp, '_rules.yaml'), yaml);
    return loadRules(tmp);
  };

  test('block-array stopword `- 10` loads as the STRING "10" (issue repro shape)', () => {
    const rules = load(['redundancy:', '  word_frequency_threshold: 4', '  stopwords:', '    - 10', ''].join('\n'));
    expect(rules.redundancy.stopwords).toEqual(['10']);
    expect(rules.redundancy.stopwords.every(w => typeof w === 'string')).toBe(true);
  });

  test('inline-array stopwords coerce the same way (mixed numeric/string entries)', () => {
    const rules = load('redundancy:\n  stopwords: [10, sdk]\n');
    expect(rules.redundancy.stopwords).toEqual(['10', 'sdk']);
  });

  test('numeric synonym group members coerce (same token-type class of bug)', () => {
    // `- 10` inside a synonym group failed identically: the group carried the
    // Number 10 while tokens are strings, so `group.includes("10")` missed.
    const rules = load('redundancy:\n  synonyms: [[10, ten]]\n');
    expect(rules.redundancy.synonyms).toEqual([['10', 'ten']]);
  });

  test('numeric stopword actually filters: "10" × 4 nodes is NOT flagged at threshold 4', () => {
    const rules = load(['redundancy:', '  word_frequency_threshold: 4', '  stopwords:', '    - 10', ''].join('\n'));
    const files = new Map([
      ['00-overview.md', parseOutline(
        [
          '- Versions',
          '  - 10 alpha',
          '  - 10 bravo',
          '  - 10 charlie',
          '  - 10 delta',
          '',
        ].join('\n'),
        '00-overview.md',
      )],
    ]);
    const issues = checkRedundancy(files, rules.redundancy);
    // Pre-fix: `"10" × 4 nodes (threshold: 4)` fired despite the stopword.
    expect(issues.filter(i => i.rule === 'redundancy.keyword' && /"10"/.test(i.message))).toEqual([]);
  });

  test('numeric synonym group actually merges: "10"/"ten" collapse to one canonical word', () => {
    // With the group [10, ten] both spellings normalize to the head "10";
    // the merged word appears in 4 nodes ≥ threshold 4 → flagged as "10".
    // Pre-fix the Number member never matched, leaving 2+2 < 4 → silent.
    const rules = load(['redundancy:', '  word_frequency_threshold: 4', '  synonyms:', '    - [10, ten]', ''].join('\n'));
    const files = new Map([
      ['00-overview.md', parseOutline(
        [
          '- Counting',
          '  - ten alpha',
          '  - ten bravo',
          '  - 10 charlie',
          '  - 10 delta',
          '',
        ].join('\n'),
        '00-overview.md',
      )],
    ]);
    const issues = checkRedundancy(files, rules.redundancy);
    const merged = issues.find(i => i.rule === 'redundancy.keyword' && /"10" × 4 nodes/.test(i.message));
    expect(merged).toBeDefined();
  });

  test('guard: non-array shapes keep their current behavior (only arrays are coerced)', () => {
    // `stopwords:` with nothing under it parses to null — preserved as null
    // (the layers read null as "no stopword filtering").
    expect(load('redundancy:\n  stopwords:\n').redundancy.stopwords).toBeNull();
    // A scalar `stopwords: 10` is a type-inconsistent shape, not an array —
    // the coercion must not invent an array for it (issue #42 fixes the
    // token type of well-formed array entries only). `unknown` on purpose:
    // the declared type is string[] but the runtime value is the Number 10.
    const scalar: unknown = load('redundancy:\n  stopwords: 10\n').redundancy.stopwords;
    expect(Array.isArray(scalar)).toBe(false);
    expect(scalar).toBe(10);
  });

  test('defaults are untouched: every default stopword/synonym member is a string', () => {
    const d = defaultRules().redundancy;
    expect(d.stopwords.every(w => typeof w === 'string')).toBe(true);
    expect(d.synonyms.every(g => g.every(w => typeof w === 'string'))).toBe(true);
  });
});

// ── CLI end-to-end: the exact issue repro ─────────────────────────────────

describe('issue #42 — CLI: numeric stopword silences the word-frequency flag', () => {
  const SCRATCH = join(REPO, '.tmp', 'issue-42');
  const createdDirs: string[] = [];
  afterEach(() => {
    while (createdDirs.length > 0) {
      rmSync(createdDirs.pop()!, { recursive: true, force: true });
    }
  });

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
    // issue #41: reconstitute the flat issues view from sections.{category}[]
    const j = parsed as Record<string, unknown> | null;
    if (j !== null && typeof j === 'object' && (j as any).sections !== undefined && (j as any).issues === undefined) {
      (j as any).issues = Object.entries((j as any).sections as Record<string, any[]>).flatMap(([category, arr]) =>
        arr.map((i) => ({ ...i, category, message: i.detail })),
      );
    }
    return parsed;
  }

  test('`stopwords: [- 10]` + 4 nodes mentioning 10 → no `"10" × N nodes` warning', () => {
    const root = join(SCRATCH, `repro-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    mkdirSync(join(root, 'cans'), { recursive: true });
    createdDirs.push(root);
    writeFileSync(join(root, 'cans', '00-overview.md'), [
      '- Versions',
      '  - 10 alpha',
      '  - 10 bravo',
      '  - 10 charlie',
      '  - 10 delta',
      '',
    ].join('\n'));
    writeFileSync(join(root, 'cans', '_rules.yaml'), [
      'redundancy:',
      '  word_frequency_threshold: 4',
      '  stopwords:',
      '    - 10',
      '',
    ].join('\n'));

    const r = runCli(['check', '--json'], root);
    const j = parseJsonOut(r.out);
    // The stopword must be inert no longer: "10" is filtered from layer 1.
    expect(j.issues.filter(
      (i: any) => i.category === 'redundancy' && i.rule === 'redundancy.keyword' && /"10"/.test(i.message),
    )).toEqual([]);
  });
});
