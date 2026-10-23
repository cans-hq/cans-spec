/**
 * Issue #46 — redundancy layers count tokens from `see:` ref TARGETS as
 * content words.
 *
 * Bug: redundancy.ts excluded the ref-SYNTAX tokens `see`/`md`
 * (REF_SYNTAX_TOKENS) but NOT the target-path tokens: `see: 10-sdk.md#primitives`
 * contributed `10`, `sdk`, `primitives` to the node's word set. At scale,
 * file-stem words dominate word_frequency (`"10" × N nodes (threshold: 4)`)
 * and inflate phrase_overlap between thin pointers to the same target.
 *
 * Fix under test: the `see:` ref span (keyword + separator + file target +
 * anchor) is stripped from node text BEFORE tokenization for the text-
 * comparison layers (L1 word frequency, L2 phrase overlap, L3 fuzzy typos) —
 * ref syntax is structural, not content (§8/§13, QA-02 F3). Label words
 * still count. Layer 4 (crossFileCanonicality) deliberately keeps comparing
 * the FULL node text: it detects identical concepts verbatim, and stripping
 * would change duplicate-home semantics (pinned below).
 *
 * Runtime-neutral: imports the test facade, never 'bun:test' directly.
 */
import { describe, test, expect, afterEach } from './testing.ts';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

import { spawnCli, REPO } from './runtime.ts';
import { checkRedundancy, fuzzyDistance } from '../src/core/redundancy.ts';
import { parseOutline, stripRefSyntax } from '../src/core/outline.ts';
import { defaultRules } from '../src/core/rules.ts';
import type { RedundancyRules } from '../src/types.ts';

const baseRedundancy = (): RedundancyRules => ({ ...defaultRules().redundancy });

const spec = (name: string, lines: string[]): Map<string, ReturnType<typeof parseOutline>> => {
  const files = new Map();
  files.set(name, parseOutline(lines.join('\n'), name));
  return files;
};

// ── stripRefSyntax: the shared helper derives from the parser's own RE ────

describe('issue #46 — stripRefSyntax removes exactly the parser-minted ref spans', () => {
  test('colon form: file + anchor span removed, label kept', () => {
    expect(stripRefSyntax('alpha: see 10-sdk.md#primitives')).toBe('alpha: ');
  });

  test('no-colon form (`see TARGET`) removed too', () => {
    expect(stripRefSyntax('pointers see 10-sdk.md here')).toBe('pointers  here');
  });

  test('multiple refs on one line all removed', () => {
    expect(stripRefSyntax('a: see 01-x.md and see: 02-y.md#z b')).toBe('a:  and  b');
  });

  test('"seed" and other prose never match (whitespace-required no-colon form)', () => {
    expect(stripRefSyntax('the seed grows')).toBe('the seed grows');
  });

  test('pure-punctuation prose ("see .") is NOT a ref — kept verbatim (issue #48 parity)', () => {
    // Same validation as parseOutline: a match whose FILE token strips to
    // empty is prose, not a ref. The bare `see` token stays excluded from
    // the layers by REF_SYNTAX_TOKENS.
    expect(stripRefSyntax('Nothing to see .')).toBe('Nothing to see .');
  });

  test('issue #48 shape: glued trailing `)` goes with the span (tokenization-safe)', () => {
    const out = stripRefSyntax('(see effect.md#Audit-spine)');
    expect(out).not.toContain('effect');
    expect(out).not.toContain('Audit');
  });

  test('idempotent: stripping already-stripped text is a no-op', () => {
    const once = stripRefSyntax('alpha: see 10-sdk.md#primitives');
    expect(stripRefSyntax(once)).toBe(once);
  });
});

// ── Layer 1: word frequency no longer counts ref-target tokens ───────────

describe('issue #46 — L1 word frequency ignores see: target tokens', () => {
  test('`- label: see 10-sdk.md#primitives` does not contribute 10/sdk/primitives', () => {
    const files = spec('00-overview.md', [
      '- Entry points',
      '  - alpha: see 10-sdk.md#primitives',
      '  - bravo: see 10-sdk.md#primitives',
      '  - charlie: see 10-sdk.md#primitives',
      '  - delta: see 10-sdk.md#primitives',
      '',
    ]);
    const issues = checkRedundancy(files, baseRedundancy());
    // Pre-fix all three target tokens hit the ×4 threshold.
    expect(issues.filter(i => i.rule === 'redundancy.keyword' && /"(10|sdk|primitives)"/.test(i.message))).toEqual([]);
  });

  test('label words are still counted (label × 4 ≥ threshold still flags)', () => {
    const files = spec('00-overview.md', [
      '- Entry points',
      '  - intake: see 10-sdk.md#primitives',
      '  - intake: see 10-sdk.md#primitives',
      '  - intake: see 10-sdk.md#primitives',
      '  - intake: see 10-sdk.md#primitives',
      '',
    ]);
    const issues = checkRedundancy(files, baseRedundancy());
    const label = issues.find(i => i.rule === 'redundancy.keyword' && /"intake" × 4 nodes/.test(i.message));
    expect(label).toBeDefined();
  });
});

// ── Layer 2: thin pointers to the same target no longer phrase-overlap ────

describe('issue #46 — L2 phrase overlap ignores see: target tokens', () => {
  test('two thin pointers with different labels/anchors no longer overlap (threshold 0.5)', () => {
    // Pre-fix sets {a,10,sdk,x} vs {b,10,sdk,y}: 2/4 = 50% ≥ 0.5 → flagged.
    // Post-fix only the label words remain: {a} vs {b} → 0%.
    const files = spec('00-overview.md', [
      '- Pointers',
      '  - a: see 10-sdk.md#x',
      '  - b: see 10-sdk.md#y',
      '',
    ]);
    const rules = { ...baseRedundancy(), phrase_overlap_threshold: 0.5 };
    const issues = checkRedundancy(files, rules);
    expect(issues.filter(i => i.rule === 'redundancy.overlap.exact' || i.rule === 'redundancy.overlap.fuzzy')).toEqual([]);
  });

  test('same-target same-anchor pointers no longer overlap at the default 0.7', () => {
    // Pre-fix sets {a,10,sdk,shared} vs {b,10,sdk,shared}: 3/4 = 75% ≥ 70%.
    const files = spec('00-overview.md', [
      '- Pointers',
      '  - a: see 10-sdk.md#shared',
      '  - b: see 10-sdk.md#shared',
      '',
    ]);
    const issues = checkRedundancy(files, baseRedundancy());
    expect(issues.filter(i => i.rule === 'redundancy.overlap.exact' || i.rule === 'redundancy.overlap.fuzzy')).toEqual([]);
  });

  test('control: genuinely duplicated label words still overlap', () => {
    // Non-ref prose duplication must keep flagging — the fix only removes
    // the ref span, never the content around it.
    const files = spec('00-overview.md', [
      '- Pointers',
      '  - alpha bravo charlie delta echo',
      '  - alpha bravo charlie delta foxtrot',
      '',
    ]);
    const issues = checkRedundancy(files, baseRedundancy());
    const overlap = issues.find(i => i.rule === 'redundancy.overlap.exact' || i.rule === 'redundancy.overlap.fuzzy');
    expect(overlap).toBeDefined();
  });
});

// ── Layer 3: ref-target words no longer pair up as typos ─────────────────

describe('issue #46 — L3 fuzzy typos ignore see: target tokens', () => {
  test('a typo of a ref-target word is no longer flagged (governance ↔ goverance)', () => {
    const files = spec('00-overview.md', [
      '- Audit',
      '  - see artifacts/governance.yaml',
      '  - goverance review board',
      '',
    ]);
    const issues = checkRedundancy(files, baseRedundancy());
    expect(issues.filter(i => i.rule === 'redundancy.typo')).toEqual([]);
  });

  test('fuzzyDistance called directly with raw node text also strips the ref span', () => {
    // Defense in depth: the layer's own word collection strips refs, so
    // hand-built NodeRefs (bypassing checkRedundancy) behave the same.
    const nodes = [
      { text: 'see artifacts/governance.yaml', file: 'a.md', line: 1 },
      { text: 'goverance review board', file: 'a.md', line: 2 },
    ];
    expect(fuzzyDistance(nodes, baseRedundancy())).toEqual([]);
  });

  test('control: genuine label-word typos still flag (flavour ↔ flavor)', () => {
    const files = spec('00-overview.md', [
      '- Goods',
      '  - the flavour profile is bold',
      '  - the flavor profile is mild',
      '',
    ]);
    const issues = checkRedundancy(files, baseRedundancy());
    const typo = issues.find(i => i.rule === 'redundancy.typo');
    expect(typo).toBeDefined();
  });
});

// ── Defense in depth: see/md syntax tokens stay excluded ──────────────────

describe('issue #46 — REF_SYNTAX_TOKENS (see/md) exclusions still hold', () => {
  test('ref-syntax-heavy text yields no typo pairs', () => {
    const nodes = [
      { text: 'see md', file: 'a.md', line: 1 },
      { text: 'see: specs and md anchors', file: 'a.md', line: 2 },
    ];
    expect(fuzzyDistance(nodes, baseRedundancy())).toEqual([]);
  });
});

// ── Layer 4: crossFileCanonicality deliberately UNCHANGED ─────────────────

describe('issue #46 — L4 cross-file canonicality keeps comparing FULL node text', () => {
  test('identical see:-carrying concepts in 2 files still flag as duplicate homes', () => {
    // Documented design choice: L4 detects identical concepts verbatim
    // (duplicate-home semantics); stripping the ref span there would let
    // two files carry the same pointer text without a canonical-home flag.
    const files = new Map();
    files.set('01-a.md', parseOutline('- Sessions rule: see 10-sdk.md\n', '01-a.md'));
    files.set('02-b.md', parseOutline('- Sessions rule: see 10-sdk.md\n', '02-b.md'));
    const issues = checkRedundancy(files, baseRedundancy());
    const dup = issues.find(i => i.rule === 'redundancy.duplicate_home');
    expect(dup).toBeDefined();
    expect(dup!.message).toContain('without see:');
  });
});

// ── CLI end-to-end: the issue repro shape ─────────────────────────────────

describe('issue #46 — CLI: ref targets no longer dominate word frequency', () => {
  const SCRATCH = join(REPO, '.tmp', 'issue-46');
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
    // issue #41: reconstitute the flat issues view from sections.{category}[]
    const j = parsed as Record<string, unknown> | null;
    if (j !== null && typeof j === 'object' && (j as any).sections !== undefined && (j as any).issues === undefined) {
      (j as any).issues = Object.entries((j as any).sections as Record<string, any[]>).flatMap(([category, arr]) =>
        arr.map((i) => ({ ...i, category, message: i.detail })),
      );
    }
    return parsed;
  }

  test('4 thin pointers at 10-sdk.md → no "10"/"sdk"/"primitives" keyword warnings; label still counted', () => {
    const root = join(SCRATCH, `repro-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    mkdirSync(join(root, 'cans'), { recursive: true });
    createdDirs.push(root);
    writeFileSync(join(root, 'cans', '00-overview.md'), [
      '- Entry points',
      '  - intake: see 10-sdk.md#primitives',
      '  - intake: see 10-sdk.md#primitives',
      '  - intake: see 10-sdk.md#primitives',
      '  - intake: see 10-sdk.md#primitives',
      '',
    ].join('\n'));
    writeFileSync(join(root, 'cans', '10-sdk.md'), [
      '- SDK',
      '  - Primitives',
      '  - Setup',
      '',
    ].join('\n'));

    const r = runCli(['check', '--json'], root);
    const j = parseJsonOut(r.out);
    const keywords = j.issues.filter((i: any) => i.rule === 'redundancy.keyword');
    expect(keywords.filter((i: any) => /"(10|sdk|primitives)"/.test(i.message))).toEqual([]);
    expect(keywords.some((i: any) => /"intake" × 4 nodes/.test(i.message))).toBe(true);
  });
});
