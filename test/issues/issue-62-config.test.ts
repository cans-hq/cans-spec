/**
 * Issue #62 (config half) — strict §18 validation of
 * `references.forbidden_targets`, the layering / abstraction-leak guard's
 * rule list (the parser half — block-form lists of objects — is pinned by the
 * sibling issue-62-parser suite; the refs engine by the #62 engine suites).
 *
 * Contract (§ Config shape of issue #62): `forbidden_targets` is a PARAMETER
 * list, not a check switch — absent / empty / null = the feature is OFF, and
 * it never counts as a "curated references section" for the §18
 * delete/override reconciliation (reconcile: false, the external_roots #55 /
 * aliasing #57 convention). Each entry is a mapping — `source` (REQUIRED
 * non-empty valid glob, core/glob.ts grammar), `pattern` (REQUIRED non-empty
 * string compiling as a JavaScript RegExp), `severity` (OPTIONAL, exactly
 * 'error' | 'warning', DEFAULT 'error' — the issue's spelling; 'warn'
 * REJECTS), `message` (OPTIONAL non-empty string), `except` (OPTIONAL list of
 * non-empty valid globs) — unknown members reject under the issue #56 typo
 * discipline, and a present member's error reports BEFORE the
 * missing-required errors. loadRules completes a present list with each
 * entry's severity defaulted to 'error' (issue #47 parameter convention).
 *
 * Pins:
 *   - the issue's example config loads verbatim; a severity-less entry is
 *     completed to 'error', `message`/`except` stay ABSENT (undefined), and
 *     document order is preserved;
 *   - every off state (absent key / absent section / explicit empty /
 *     explicit null / empty list) loads without error;
 *   - EVERY rejection with the exact message and line number — the §18
 *     line-numbered shapes the rest of the toolchain (CLI envelope, issue
 *     #43) re-uses verbatim;
 *   - pre-#62 compat: a config that predates the key loads with
 *     forbidden_targets undefined and every other section identical;
 *   - CLI blackbox: an invalid entry is a config error — exit 2,
 *     `config.invalid` on `_rules.yaml`, never a refs finding;
 *   - the reconcile contract: a sparse config listing ONLY forbidden_targets
 *     does not curate the references section (back_pointers & co. keep their
 *     defaults — no deletions fire).
 *
 * Levels: engine unit (loadRules throws with the line number) and CLI
 * blackbox (exit code, --json sections.config envelope), the issue #56
 * scaffolding.
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

import { spawnCli, REPO } from '../runtime.ts';
import { loadRules, defaultRules } from '../../src/core/rules.ts';

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-62-config');

interface Ws { root: string; cans: string }

const createdDirs: string[] = [];
let wsSeq = 0;

/** Fresh scratch workspace under repo/.tmp/issues/issue-62-config (gitignored). */
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

afterEach(() => {
  while (createdDirs.length > 0) {
    rmSync(createdDirs.pop()!, { recursive: true, force: true });
  }
});

// ── unit scaffolding: loadRules against a scratch _rules.yaml ──────────────

/** loadRules on a yaml string; returns the rules or the thrown Error. */
function load(yaml: string): { rules: ReturnType<typeof loadRules> | null; error: Error | null } {
  const dir = join(SCRATCH, `unit-${++wsSeq}`);
  mkdirSync(dir, { recursive: true });
  createdDirs.push(dir);
  writeFileSync(join(dir, '_rules.yaml'), yaml);
  try {
    return { rules: loadRules(dir), error: null };
  } catch (e) {
    return { rules: null, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

/** loadRules that MUST fail — returns the (line-numbered) message. */
function loadErr(yaml: string): string {
  const { rules, error } = load(yaml);
  expect(rules).toBeNull();
  expect(error).not.toBeNull();
  expect(error!.message).toMatch(/line \d+/);
  return error!.message;
}

/** The issue #43 config-error contract, end to end: exit 2, standalone
 *  diagnosis, sections.config[0] = config.invalid on _rules.yaml. */
function expectConfigError(r: { exit: number | null; out: string; err: string }, message: string): void {
  expect(r.exit).toBe(2); // issue #41: the check could not run = error class
  const j = parseJsonOut(r.out);
  expect(j.ok).toBe(false);
  expect(j.error).toBe(`invalid _rules.yaml: ${message}`);
  expect(j.sections.config).toHaveLength(1);
  expect(j.sections.config[0]).toEqual({
    file: '_rules.yaml',
    line: 0,
    level: 'error',
    rule: 'config.invalid',
    detail: `invalid _rules.yaml: ${message}`,
  });
  expect(j.sections.refs).toEqual([]); // never a refs finding (issue #43)
  expect(j.summary.files).toBe(0); // the engines never ran
}

/** The issue's exact example config (§ Config shape of issue #62; the same
 *  fixture as the parser suite). Lines: 1 references, 2 mode,
 *  3 forbidden_targets, 4 - source, 5 pattern, 6 severity, 7 message. */
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

// ── the happy path: the example config loads, parameters completed ─────────

describe('issue #62 config — the example config loads: parameters, completion, document order', () => {
  test("the issue's exact example loads verbatim: every member present, nothing defaulted away", () => {
    const { rules, error } = load(ISSUE_EXAMPLE);
    expect(error).toBeNull();
    expect(rules!.references.forbidden_targets).toEqual([
      {
        source: 'cans/[0-9]*.md',
        pattern: '^(cans/)?plugins/.*',
        severity: 'error',
        message: 'Abstraction leak: Core plane specs cannot reference individual plugin files.',
      },
    ]);
  });

  test('an omitted severity is completed to the documented default "error" (issue #47 parameter convention)', () => {
    const { rules, error } = load([
      'references:',
      '  forbidden_targets:',
      '    - source: "00-overview.md"',
      '      pattern: "^plugins/"',
      '',
    ].join('\n'));
    expect(error).toBeNull();
    expect(rules!.references.forbidden_targets).toEqual([
      { source: '00-overview.md', pattern: '^plugins/', severity: 'error' },
    ]);
    // OPTIONAL members stay ABSENT, not null — `except` and `message` default
    // to undefined, exactly the ForbiddenTargetRule optional surface.
    const entry = rules!.references.forbidden_targets![0]!;
    expect('except' in entry).toBe(false);
    expect('message' in entry).toBe(false);
    expect(entry.except).toBeUndefined();
  });

  test('a multi-entry list completes per entry: explicit severities kept, omitted filled, except lists preserved', () => {
    const { rules, error } = load([
      'references:',
      '  forbidden_targets:',
      '    - source: "cans/[0-9]*.md"',
      '      pattern: "^(cans/)?plugins/.*"',
      '    - source: "plugins/**"',
      '      pattern: "^cans/[0-9]"',
      '      severity: warning',
      '      except:',
      '        - "plugins/index.md"',
      '',
    ].join('\n'));
    expect(error).toBeNull();
    expect(rules!.references.forbidden_targets).toEqual([
      { source: 'cans/[0-9]*.md', pattern: '^(cans/)?plugins/.*', severity: 'error' },
      { source: 'plugins/**', pattern: '^cans/[0-9]', severity: 'warning', except: ['plugins/index.md'] },
    ]);
    // document order preserved through the completion pass
    expect(Object.keys(rules!.references.forbidden_targets![1]!)).toEqual([
      'source',
      'pattern',
      'severity',
      'except',
    ]);
  });

  test('both documented severity spellings load: explicit "error" and "warning"', () => {
    const ok = load([
      'references:',
      '  forbidden_targets:',
      '    - source: a.md',
      '      pattern: "^p/"',
      '      severity: error',
      '    - source: b.md',
      '      pattern: "^q/"',
      '      severity: warning',
      '',
    ].join('\n'));
    expect(ok.error).toBeNull();
    expect(ok.rules!.references.forbidden_targets!.map(e => e.severity)).toEqual(['error', 'warning']);
  });
});

// ── the off states: a PARAMETER list, absent/empty/null = feature OFF ──────

describe('issue #62 config — the off states: absent / empty / null are legal, never an error', () => {
  test('absent key → undefined (a references section without forbidden_targets)', () => {
    const { rules, error } = load('references:\n  mode: pointer\n  back_pointers: false\n');
    expect(error).toBeNull();
    expect(rules!.references.forbidden_targets).toBeUndefined();
  });

  test('absent section → undefined (a config that never mentions references)', () => {
    const { rules, error } = load('structure:\n  depth: { min: 1, max: 3 }\n');
    expect(error).toBeNull();
    expect(rules!.references.forbidden_targets).toBeUndefined();
  });

  test('defaultRules() itself ships forbidden_targets undefined (the default is OFF)', () => {
    expect(defaultRules().references.forbidden_targets).toBeUndefined();
  });

  test('explicit empty (`forbidden_targets:` with nothing under it) → null, no error', () => {
    const { rules, error } = load('references:\n  forbidden_targets:\n');
    expect(error).toBeNull();
    expect(rules!.references.forbidden_targets).toBeNull();
  });

  test('explicit null literal → null, no error', () => {
    const { rules, error } = load('references:\n  forbidden_targets: null\n');
    expect(error).toBeNull();
    expect(rules!.references.forbidden_targets).toBeNull();
  });

  test('explicit empty list → [] (zero rules = the guard is OFF), no error', () => {
    const { rules, error } = load('references:\n  forbidden_targets: []\n');
    expect(error).toBeNull();
    expect(rules!.references.forbidden_targets).toEqual([]);
  });
});

// ── every rejection: exact message + line number ────────────────────────────

describe('issue #62 config — every rejection is a line-numbered §18 error', () => {
  test('missing source names the entry line and the required member', () => {
    // Lines: 1 references, 2 forbidden_targets, 3 the entry (- pattern:).
    expect(loadErr('references:\n  forbidden_targets:\n    - pattern: "^plugins/"\n')).toBe(
      'line 3 — "references.forbidden_targets[0]" is missing the required "source" glob',
    );
  });

  test('missing pattern names the entry line and the required member', () => {
    expect(loadErr('references:\n  forbidden_targets:\n    - source: "00-overview.md"\n')).toBe(
      'line 3 — "references.forbidden_targets[0]" is missing the required "pattern" regex',
    );
  });

  test('missing BOTH required members reports "source" first (checked in the documented order)', () => {
    expect(loadErr('references:\n  forbidden_targets:\n    - message: "no"\n')).toBe(
      'line 3 — "references.forbidden_targets[0]" is missing the required "source" glob',
    );
  });

  test('unknown member (`severety`) rejects under the issue #56 typo discipline', () => {
    // Lines: 4 pattern, 5 the typo — a typo'd severity must never silently
    // read as the default while the author believes a severity is set.
    expect(
      loadErr(
        'references:\n  forbidden_targets:\n    - source: "00-overview.md"\n      pattern: "^plugins/"\n      severety: error\n',
      ),
    ).toBe(
      'line 5 — unrecognized key "references.forbidden_targets[0].severety" ' +
        '(issue #56: _rules.yaml is validated strictly — §18 documents the legal keys)',
    );
  });

  test('invalid regex pattern ("(") names the member line, the RegExp engine’s diagnosis parenthetically', () => {
    expect(
      loadErr('references:\n  forbidden_targets:\n    - source: "00-overview.md"\n      pattern: "("\n'),
    ).toBe(
      'line 4 — "references.forbidden_targets[0].pattern" must be a valid JavaScript regular expression, ' +
        `got "(" (${reWhy('(')})`,
    );
  });

  test('invalid severity ("warn") rejects — the issue’s spelling is "warning", not the warn/off scale', () => {
    expect(
      loadErr(
        'references:\n  forbidden_targets:\n    - source: "00-overview.md"\n      pattern: "^plugins/"\n      severity: warn\n',
      ),
    ).toBe('line 5 — "references.forbidden_targets[0].severity" must be "error" or "warning", got "warn"');
  });

  test('empty source rejects with the glob expectation', () => {
    expect(loadErr('references:\n  forbidden_targets:\n    - source: ""\n      pattern: "^plugins/"\n')).toBe(
      'line 3 — "references.forbidden_targets[0].source" must be a non-empty glob (* ? [class] **), got ""',
    );
  });

  test('empty message rejects with the non-empty-string expectation', () => {
    expect(
      loadErr(
        'references:\n  forbidden_targets:\n    - source: "00-overview.md"\n      pattern: "^plugins/"\n      message: ""\n',
      ),
    ).toBe('line 5 — "references.forbidden_targets[0].message" must be a non-empty string, got ""');
  });

  test('malformed glob (unclosed "[") rejects — a ban can never be silently inert', () => {
    expect(
      loadErr('references:\n  forbidden_targets:\n    - source: "cans/[0-9.md"\n      pattern: "^plugins/"\n'),
    ).toBe('line 3 — "references.forbidden_targets[0].source" is not a valid glob (unclosed "[" or dangling "\\")');
  });

  test('a malformed except entry rejects at its own line, entry-indexed', () => {
    // Lines: 5 except, 6 the good entry, 7 the malformed one.
    expect(
      loadErr(
        'references:\n  forbidden_targets:\n    - source: "00-overview.md"\n      pattern: "^plugins/"\n' +
          '      except:\n        - "ok.md"\n        - "bad[.md"\n',
      ),
    ).toBe(
      'line 7 — "references.forbidden_targets[0].except[1]" is not a valid glob (unclosed "[" or dangling "\\")',
    );
  });

  test('a non-string except entry rejects with the glob expectation', () => {
    expect(
      loadErr(
        'references:\n  forbidden_targets:\n    - source: "00-overview.md"\n      pattern: "^plugins/"\n' +
          '      except:\n        - 5\n',
      ),
    ).toBe('line 6 — "references.forbidden_targets[0].except[0]" must be a non-empty glob (* ? [class] **), got "5"');
  });

  test('except that is not a list rejects with the list expectation', () => {
    expect(
      loadErr(
        'references:\n  forbidden_targets:\n    - source: "00-overview.md"\n      pattern: "^plugins/"\n' +
          '      except: "plugins/index.md"\n',
      ),
    ).toBe('line 5 — "references.forbidden_targets[0].except" must be a list of globs, got "plugins/index.md"');
  });

  test('a non-mapping entry (`- foo`) rejects with the mapping example and the got-value', () => {
    expect(loadErr('references:\n  forbidden_targets:\n    - foo\n')).toBe(
      'line 3 — "references.forbidden_targets[0]" must be a mapping like ' +
        '{ source: "cans/[0-9]*.md", pattern: "^plugins/.*" }, got "foo"',
    );
  });

  test('a null entry (bare `-`) rejects naming the empty value', () => {
    expect(loadErr('references:\n  forbidden_targets:\n    -\n')).toBe(
      'line 3 — "references.forbidden_targets[0]" must be a mapping like ' +
        '{ source: "cans/[0-9]*.md", pattern: "^plugins/.*" }, got null (empty value)',
    );
  });

  test('a non-list value (mapping) rejects at the key with the full expectation spelled once', () => {
    expect(loadErr('references:\n  forbidden_targets: {a: b}\n')).toBe(
      'line 2 — "references.forbidden_targets" must be a list of forbidden-target rules ' +
        '(each a mapping: source, pattern, severity?, message?, except?), got a mapping',
    );
  });

  test('a non-list value (scalar) rejects with the same expectation', () => {
    expect(loadErr('references:\n  forbidden_targets: banana\n')).toBe(
      'line 2 — "references.forbidden_targets" must be a list of forbidden-target rules ' +
        '(each a mapping: source, pattern, severity?, message?, except?), got "banana"',
    );
  });

  test('a present member’s error reports BEFORE the missing-required errors', () => {
    // The entry lacks `source` AND has an invalid severity — the severity
    // error (its own line) must win over the missing-source check, per the
    // contract's "present-member errors report first".
    const msg = loadErr('references:\n  forbidden_targets:\n    - pattern: "^plugins/"\n      severity: warn\n');
    expect(msg).toBe('line 4 — "references.forbidden_targets[0].severity" must be "error" or "warning", got "warn"');
    expect(msg).not.toContain('missing the required');
  });

  test('the inline entry form (`- {…}`, pre-#62 objects) validates under the same rules', () => {
    expect(loadErr('references:\n  forbidden_targets:\n    - {source: "00-overview.md"}\n')).toBe(
      'line 3 — "references.forbidden_targets[0]" is missing the required "pattern" regex',
    );
  });
});

// ── pre-#62 compat: the key is purely additive ──────────────────────────────

describe('issue #62 config — pre-#62 configs load identically (the key is additive)', () => {
  test('a config that predates the key: forbidden_targets undefined, every other section identical', () => {
    // A realistic pre-#62 sparse override file: parameters and check keys,
    // no forbidden_targets. It must load exactly as it always did — the
    // references section is 2-of-5 covered (not majority), so nothing is
    // deleted; redundancy.stopwords is a parameter; untouched sections keep
    // their defaults.
    const { rules, error } = load(
      [
        'references:',
        '  mode: pointer',
        '  back_pointers: false',
        'redundancy:',
        '  stopwords:',
        '    - the',
        '    - a',
        '',
      ].join('\n'),
    );
    expect(error).toBeNull();
    const dr = defaultRules();
    expect(rules!.references.forbidden_targets).toBeUndefined();
    expect(rules!.references).toEqual({ ...dr.references, mode: 'pointer', back_pointers: false });
    expect(rules!.redundancy).toEqual({ ...dr.redundancy, stopwords: ['the', 'a'] });
    expect(rules!.structure).toEqual(dr.structure);
    expect(rules!.style).toEqual(dr.style);
  });
});

// ── the §18 reconciliation is untouched (reconcile: false) ─────────────────

describe('issue #62 config — listing forbidden_targets does not curate the references section', () => {
  test('a sparse config listing ONLY forbidden_targets keeps every references check at its default', () => {
    // The §18 delete/override reconciliation: a sparse override file deletes
    // an omitted check key only when its section is majority-covered.
    // forbidden_targets is NOT a SECTION_KEYS member (reconcile: false — the
    // external_roots #55 / aliasing #57 convention), so this config covers
    // 0-of-5 references check keys: back_pointers & co. keep their defaults.
    const { rules, error } = load(
      'references:\n  forbidden_targets:\n    - source: "00-overview.md"\n      pattern: "^plugins/"\n',
    );
    expect(error).toBeNull();
    const dr = defaultRules();
    expect(rules!.references.back_pointers).toBe(true); // default, NOT deleted to false
    expect(rules!.references.orphan_check).toBe(true);
    expect(rules!.references.duplicate_home_check).toBe(true);
    expect(rules!.references.max_hops).toBe(dr.references.max_hops);
    expect(rules!.references.mode).toBe(dr.references.mode);
    expect(rules!.references).toEqual({
      ...dr.references,
      forbidden_targets: [{ source: '00-overview.md', pattern: '^plugins/', severity: 'error' }],
    });
    // other sections untouched too (the file never mentions them)
    expect(rules!.structure).toEqual(dr.structure);
  });
});

// ── CLI blackbox: an invalid entry is a config error, never a refs finding ──

describe('issue #62 config — CLI blackbox: an invalid entry is a config error (exit 2)', () => {
  test('invalid severity → exit 2, config.invalid on _rules.yaml with the line-numbered detail, refs empty', () => {
    const ws = makeWs('invalid-severity');
    writeFileSync(join(ws.cans, '01-alpha.md'), '- Alpha overview hub\n  - Zephyr ledger details\n');
    writeFileSync(
      join(ws.cans, '_rules.yaml'),
      [
        'references:',
        '  forbidden_targets:',
        '    - source: "00-overview.md"',
        '      pattern: "^plugins/"',
        '      severity: warn',
        '',
      ].join('\n'),
    );

    const r = runCli(['check', '--json'], ws.root);
    expectConfigError(
      r,
      'line 5 — "references.forbidden_targets[0].severity" must be "error" or "warning", got "warn"',
    );
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
