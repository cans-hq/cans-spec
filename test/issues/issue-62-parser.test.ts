/**
 * Issue #62 (parser half) — block-form LISTS OF OBJECTS in the `_rules.yaml`
 * subset parser: `- key: value` items with deeper-indented continuation keys,
 * the YAML shape `references.forbidden_targets` needs. Pre-#62 the first
 * `- source:` line of the issue's example config threw
 * `line N: malformed value (unexpected ':')` — the parser supported inline
 * objects (`- {a: b}`) but not the block form. This file pins the VALUE TREE
 * (parseMinimalYaml, the public surface) and the LINE-NUMBER truth (asserted
 * through loadRules error messages — keyLines is internal, but every §18
 * domain error names the tracked line).
 *
 * Pins:
 *   - the issue's exact example config parses to the expected array of
 *     mappings (multi-entry, multi-member);
 *   - mixed lists (inline `- {…}` entries beside block entries) parse;
 *   - continuation members at deeper indent, and a member with its own
 *     deeper block value (an `except:` sub-list inside an entry), parse;
 *   - a list interleaved with comments/blank lines keeps correct line
 *     numbers (the `- source:` line for the entry and its first member, each
 *     continuation member its own line);
 *   - REGRESSIONS: scalar lists, inline arrays, inline objects, nested
 *     arrays, the synonyms block/map forms and QUOTED scalars containing a
 *     ':' parse identically to before (a quoted item never opens a block
 *     mapping — only a bare `key:` does);
 *   - the previously-throwing `- see: the runbook` item under `stopwords:`
 *     now surfaces the wordList domain error (line-numbered), NOT
 *     `malformed value` — a mapping where the key demands scalars is a
 *     better error, still line-numbered.
 *
 * The §18 strict-validation surface of the new key is pinned by the sibling
 * issue-62-config suite; the refs engine by the #62 engine suites.
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

import { REPO } from '../runtime.ts';
import { parseMinimalYaml, loadRules } from '../../src/core/rules.ts';

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-62-parser');

const createdDirs: string[] = [];
let seq = 0;

/** loadRules on a yaml string; returns the rules or the thrown Error. */
function load(yaml: string): { rules: ReturnType<typeof loadRules> | null; error: Error | null } {
  const dir = join(SCRATCH, `unit-${++seq}`);
  mkdirSync(dir, { recursive: true });
  createdDirs.push(dir);
  writeFileSync(join(dir, '_rules.yaml'), yaml);
  try {
    return { rules: loadRules(dir), error: null };
  } catch (e) {
    return { rules: null, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

afterEach(() => {
  while (createdDirs.length > 0) {
    rmSync(createdDirs.pop()!, { recursive: true, force: true });
  }
});

/** parseMinimalYaml that MUST succeed — fails the test on a parse error. */
function parseOk(yaml: string): Record<string, unknown> {
  return parseMinimalYaml(yaml);
}

/** loadRules that MUST fail — returns the (line-numbered) message. */
function loadErr(yaml: string): string {
  const { rules, error } = load(yaml);
  expect(rules).toBeNull();
  expect(error).not.toBeNull();
  expect(error!.message).toMatch(/line \d+/);
  return error!.message;
}

/** The issue's exact example config (§ Config shape of issue #62). */
const ISSUE_EXAMPLE = [
  'references:',
  '  mode: pointer',
  '  forbidden_targets:',
  '    - source: "cans/[0-9]*.md"',
  '      pattern: "^(cans/)?plugins/.*"',
  '      severity: error',
  '      message: "Abstraction leak: Core plane specs cannot reference individual plugin files."',
  '',
].join('\n');

// ── the block list of objects parses to the expected value tree ────────────

describe('issue #62 parser — block-form lists of objects', () => {
  test("the issue's exact example parses to one mapping entry with every member", () => {
    expect(parseOk(ISSUE_EXAMPLE)).toEqual({
      references: {
        mode: 'pointer',
        forbidden_targets: [
          {
            source: 'cans/[0-9]*.md',
            pattern: '^(cans/)?plugins/.*',
            severity: 'error',
            message: 'Abstraction leak: Core plane specs cannot reference individual plugin files.',
          },
        ],
      },
    });
  });

  test('multi-entry, multi-member lists parse in document order (severity defaults to nothing here — parse only)', () => {
    // Parser layer: NO defaults, NO validation — the raw value tree keeps
    // exactly what was written (severity defaulting is the loadRules
    // completion pass, pinned in issue-62-config).
    const v = parseOk([
      'references:',
      '  forbidden_targets:',
      '    - source: "cans/[0-9]*.md"',
      '      pattern: "^(cans/)?plugins/.*"',
      '      severity: warning',
      '      message: Core must not point at plugin leaves',
      '    - source: "plugins/**"',
      '      pattern: "^cans/[0-9]"',
      '      except:',
      '        - "plugins/index.md"',
      '',
    ].join('\n'));
    expect(v).toEqual({
      references: {
        forbidden_targets: [
          {
            source: 'cans/[0-9]*.md',
            pattern: '^(cans/)?plugins/.*',
            severity: 'warning',
            message: 'Core must not point at plugin leaves',
          },
          {
            source: 'plugins/**',
            pattern: '^cans/[0-9]',
            except: ['plugins/index.md'],
          },
        ],
      },
    });
    // document order preserved (no member sorting, no completion)
    expect(Object.keys((v.references as any).forbidden_targets[0])).toEqual([
      'source',
      'pattern',
      'severity',
      'message',
    ]);
  });

  test('mixed lists: inline object entries beside block entries parse together', () => {
    const v = parseOk([
      'references:',
      '  forbidden_targets:',
      '    - {source: a.md, pattern: "^p/"}',
      '    - source: b.md',
      '      pattern: "^q/"',
      '    - {source: c.md, pattern: "^r/", severity: warning}',
      '',
    ].join('\n'));
    expect(v).toEqual({
      references: {
        forbidden_targets: [
          { source: 'a.md', pattern: '^p/' },
          { source: 'b.md', pattern: '^q/' },
          { source: 'c.md', pattern: '^r/', severity: 'warning' },
        ],
      },
    });
  });

  test('a member with its own deeper block value parses (except: sub-list inside an entry)', () => {
    const v = parseOk([
      'references:',
      '  forbidden_targets:',
      '    - source: x.md',
      '      pattern: "^plugins/"',
      '      except:',
      '        - "plugins/catalog.md"',
      '        - "plugins/overview.md"',
      '      severity: error',
      '',
    ].join('\n'));
    expect(v).toEqual({
      references: {
        forbidden_targets: [
          {
            source: 'x.md',
            pattern: '^plugins/',
            except: ['plugins/catalog.md', 'plugins/overview.md'],
            severity: 'error',
          },
        ],
      },
    });
  });

  test('an except sub-list written at the entry members’ own indent also parses (YAML sibling form)', () => {
    const v = parseOk([
      'references:',
      '  forbidden_targets:',
      '    - source: x.md',
      '      pattern: "^plugins/"',
      '      except:',
      '      - "plugins/catalog.md"',
      '',
    ].join('\n'));
    expect(v).toEqual({
      references: { forbidden_targets: [{ source: 'x.md', pattern: '^plugins/', except: ['plugins/catalog.md'] }] },
    });
  });

  test('member values keep the inline grammar: unquoted pattern, quoted message with an inner colon', () => {
    // The item-level rewrite changes nothing about how a member's VALUE
    // parses — parseMap's rest handling is byte-identical to pre-#62.
    const v = parseOk([
      'references:',
      '  forbidden_targets:',
      '    - source: 00-overview.md',
      '      pattern: ^plugins/.*',
      '      message: "layering: core must stay abstract"',
      '',
    ].join('\n'));
    expect(v).toEqual({
      references: {
        forbidden_targets: [
          { source: '00-overview.md', pattern: '^plugins/.*', message: 'layering: core must stay abstract' },
        ],
      },
    });

    // An UNQUOTED value containing a colon keeps the pre-#62 scalar failure
    // — the same error the whole block-form entry used to hit.
    let threw: Error | null = null;
    try {
      parseMinimalYaml([
        'references:',
        '  forbidden_targets:',
        '    - source: a.md',
        '      pattern: p',
        '      message: layering: core must stay abstract',
        '',
      ].join('\n'));
    } catch (e) {
      threw = e instanceof Error ? e : new Error(String(e));
    }
    expect(threw).not.toBeNull();
    expect(threw!.message).toBe('line 5: malformed value (unexpected \':\'): layering: core must stay abstract');
  });
});

// ── line-number truth, asserted through loadRules error messages ───────────

describe('issue #62 parser — line-number tracking of block-form entries', () => {
  test('the entry and its first member track the - source: line; pattern its own line', () => {
    // ISSUE_EXAMPLE lines: 1 references, 2 mode, 3 forbidden_targets,
    // 4 - source:, 5 pattern, 6 severity, 7 message.
    //
    // [0].pattern on its own line (5): an invalid regex there names line 5.
    const badPattern = ISSUE_EXAMPLE.replace('      pattern: "^(cans/)?plugins/.*"', '      pattern: "("');
    expect(loadErr(badPattern)).toBe(
      'line 5 — "references.forbidden_targets[0].pattern" must be a valid JavaScript regular expression, ' +
        `got "(" (${reWhy('(')})`,
    );

    // [0].source on the - source: line (4): an empty source names line 4.
    const emptySource = ISSUE_EXAMPLE.replace('    - source: "cans/[0-9]*.md"', '    - source: ""');
    expect(loadErr(emptySource)).toBe(
      'line 4 — "references.forbidden_targets[0].source" must be a non-empty glob (* ? [class] **), got ""',
    );

    // The ENTRY path [0] also tracks the - source: line (4): dropping the
    // required pattern reports the missing member at the entry's line.
    const noPattern = ISSUE_EXAMPLE.replace('      pattern: "^(cans/)?plugins/.*"\n', '');
    expect(loadErr(noPattern)).toBe(
      'line 4 — "references.forbidden_targets[0]" is missing the required "pattern" regex',
    );
  });

  test('the second entry’s members track the SECOND - source: line, not the first', () => {
    const yaml = [
      'references:',
      '  forbidden_targets:',
      '    - source: a.md',
      '      pattern: "^p/"',
      '    - source: b.md',
      '      pattern: "(*"',
      '',
    ].join('\n');
    expect(loadErr(yaml)).toBe(
      'line 6 — "references.forbidden_targets[1].pattern" must be a valid JavaScript regular expression, ' +
        `got "(*" (${reWhy('(*')})`,
    );
  });

  test('inline entries track the - { … } line for the entry AND every member', () => {
    // The pre-#62 inline convention (parseYamlTracked: inline-object members
    // share the enclosing key's line) extends to entries of the new list.
    const yaml = 'references:\n  forbidden_targets:\n    - {source: a.md, pattern: "("}\n';
    expect(loadErr(yaml)).toBe(
      'line 3 — "references.forbidden_targets[0].pattern" must be a valid JavaScript regular expression, ' +
        `got "(" (${reWhy('(')})`,
    );
  });

  test('comments and blank lines interleaved in a list keep the ORIGINAL line numbers', () => {
    const yaml = [
      'references:',
      '',
      '  # the layering guard (issue #62)',
      '  forbidden_targets:',
      '',
      '    - source: "00-overview.md"',
      '      # the catalog exemption',
      '      pattern: "^plugins/"',
      '      severity: warning',
      '',
      '    # a second, tighter ban',
      '    - source: "cans/[0-9]*.md"',
      '      pattern: "(*"',
      '',
    ].join('\n');
    // Lines: 1 references, 3 forbidden_targets, 6 - source:, 8 pattern,
    // 9 severity, 12 second - source:, 13 its pattern — the invalid regex
    // on line 13 must name line 13 (comments/blanks never shift tracking).
    expect(loadErr(yaml)).toBe(
      'line 13 — "references.forbidden_targets[1].pattern" must be a valid JavaScript regular expression, ' +
        `got "(*" (${reWhy('(*')})`,
    );
    // …and the missing-required pin of the FIRST entry lands on line 6 when
    // its pattern is removed entirely (line numbers still comment-aware).
    const noPattern = yaml.replace('      pattern: "^plugins/"\n', '');
    expect(loadErr(noPattern)).toBe(
      'line 6 — "references.forbidden_targets[0]" is missing the required "pattern" regex',
    );
  });
});

// ── regressions: every previously parseable input parses identically ───────

describe('issue #62 parser — regressions: the pre-#62 surface is unchanged', () => {
  test('scalar lists (stopwords), inline arrays, inline objects, nested arrays, numbers', () => {
    const v = parseOk([
      'redundancy:',
      '  stopwords:',
      '    - the',
      '    - a',
      '    - 10',
      '  synonyms:',
      '    - [postgres, postgresql, pg]',
      '    -',
      '      - api',
      '      - endpoint',
      'structure:',
      '  node_length: { min: 3, max: 120 }',
      '  siblings: { min: 1, max: 12 }',
      '',
    ].join('\n'));
    expect(v).toEqual({
      redundancy: {
        stopwords: ['the', 'a', 10],
        synonyms: [['postgres', 'postgresql', 'pg'], ['api', 'endpoint']],
      },
      structure: {
        node_length: { min: 3, max: 120 },
        siblings: { min: 1, max: 12 },
      },
    });
  });

  test('QUOTED scalars containing a colon stay scalars — a quoted item never opens a block mapping', () => {
    // `- "see: the runbook"` was always one word-list word; the block-form
    // rewrite is gated on a BARE key exactly so this keeps parsing as-is.
    const v = parseOk('redundancy:\n  stopwords:\n    - "see: the runbook"\n    - \'see: the other one\'\n');
    expect(v).toEqual({ redundancy: { stopwords: ['see: the runbook', 'see: the other one'] } });
  });

  test('the synonyms map form and the inline synonyms list parse identically', () => {
    expect(parseOk('redundancy:\n  synonyms: { vehicle: [car, auto] }\n')).toEqual({
      redundancy: { synonyms: { vehicle: ['car', 'auto'] } },
    });
    expect(parseOk('redundancy:\n  synonyms: [[flavour, flavor]]\n')).toEqual({
      redundancy: { synonyms: [['flavour', 'flavor']] },
    });
  });

  test('a bare `-` item and a `- key:` item with a nested block still behave (empty-item branch untouched)', () => {
    // `-` alone → null or the deeper block (pre-#62 machinery); the new
    // branch only diverts NON-EMPTY bare-key items.
    const v = parseOk([
      'x:',
      '  -',
      '    - a',
      '    - b',
      '  -',
      '',
    ].join('\n'));
    expect(v).toEqual({ x: [['a', 'b'], null] });
  });

  test('a scalar item containing a colon WITHOUT a bare-key shape keeps the (still throwing) inline parse', () => {
    // `foo bar: baz` — no bare key (space inside), so no block mapping; the
    // item stays an inline scalar and keeps failing on the ':' exactly as
    // pre-#62. (The un-parseable inputs that stay un-parseable.)
    let threw: Error | null = null;
    try {
      parseMinimalYaml('redundancy:\n  stopwords:\n    - foo bar: baz\n');
    } catch (e) {
      threw = e instanceof Error ? e : new Error(String(e));
    }
    expect(threw).not.toBeNull();
    expect(threw!.message).toBe('line 3: malformed value (unexpected \':\'): foo bar: baz');
  });
});

// ── the pinned behavior change: scalar-list colon items ─────────────────────

describe('issue #62 parser — the `- see: the runbook` behavior change', () => {
  test('a bare-key item under a scalar-list key now surfaces the wordList domain error, not malformed value', () => {
    // Pre-#62: `line 3: malformed value (unexpected ':'): see: the runbook`
    // (a parse crash). Post-#62 the item parses as a mapping and the §18
    // validator rejects it with the KEY's own line-numbered domain error —
    // a better error, still line-numbered (the item's line).
    const msg = loadErr('redundancy:\n  stopwords:\n    - see: the runbook\n');
    expect(msg).toBe('line 3 — "redundancy.stopwords" entries must be words, got a mapping');
    expect(msg).not.toContain('malformed value');
  });

  test('the same shape under synonyms gives the synonymGroups entry error (line-numbered)', () => {
    const msg = loadErr('redundancy:\n  synonyms:\n    - see: the runbook\n');
    expect(msg).toBe(
      'line 3 — "redundancy.synonyms[0]" must be a list of words, got a mapping',
    );
    expect(msg).not.toContain('malformed value');
  });
});

/** The current runtime's own RegExp diagnosis for a pattern that must not
 *  compile — embedded in the #62 pattern error parenthetically. Computed
 *  live (JSC and V8 word the SyntaxError differently), so the EXACT pin of
 *  the config message stays green on both `bun test` and `npm run
 *  test:node` while still asserting the full wording. */
function reWhy(pattern: string): string {
  try {
    new RegExp(pattern);
    throw new Error(`test bug: ${pattern} compiles — pick a broken pattern`);
  } catch (e) {
    return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
}
