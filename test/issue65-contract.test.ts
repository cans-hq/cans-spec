/**
 * Issue #65 — the shared contract: `references.aliasing.include` (config)
 * and `discoverAliasingFiles` (discovery).
 *
 * The corpus-boundary gap: #57 aliasing and #58 leaf-anchor verification
 * both stop at the spec corpus. `cans/plugins/*.md` files (the kelir
 * `profile.md` case: 133 `#leaf` refs into a YAML fixture) are never
 * loaded, so their refs cannot be verified and their targets cannot be
 * aliased. The contract the rest of the issue's work builds on:
 *
 *   - `references.aliasing.include`: workspace-relative glob patterns (the
 *     core/glob.ts grammar) of files OUTSIDE the spec corpus that join the
 *     checked file set when aliasing is enabled. A PARAMETER (like
 *     scope/style/min_uses): absent/empty = corpus-only, byte-identical to
 *     the pre-#65 behavior, never part of the §18 delete reconciliation.
 *   - Strict §18 validation (issue #56 discipline): a non-list shape, an
 *     empty member, or a glob that does not compile is a line-numbered
 *     config error — an include pattern can never be silently inert.
 *   - `discoverAliasingFiles(root, include, exclude)`: the walk shared by
 *     the check engine and the alias CLI — same exclusions as
 *     discoverSpecFiles (`_`-prefixed segments, tool artifacts), anchored
 *     whole-path matching, `exclude` (the loaded corpus/aux keys) wins.
 *
 * Runtime-neutral: imports the test facade, never 'bun:test' directly.
 */
import { describe, test, expect, afterEach } from './testing.ts';
import { join } from 'path';

import { loadRules, defaultRules } from '../src/core/rules.ts';
import { defaultAliasing } from '../src/core/alias.ts';
import { discoverAliasingFiles, discoverSpecFiles } from '../src/core/fs.ts';
import { makeTmpDir, cleanTmpDir, makeCansWorkspace } from './helpers.ts';

const tmps: string[] = [];
const scratch = (name: string, files: Record<string, string>): string => {
  const t = makeTmpDir(`issue65-contract-${name}`);
  tmps.push(t);
  return makeCansWorkspace(t, files);
};

afterEach(() => {
  while (tmps.length > 0) cleanTmpDir(tmps.pop()!);
});

/** A corpus file: minimal, valid spec shape (parse + checks untouched here). */
const CORPUS = '# 01 Overview\n\n## Intro\n\nBody text.\n';

// ── Defaults: absent = corpus-only, byte-identical ─────────────────────────

describe('issue #65 contract — defaults', () => {
  test('defaultAliasing() carries include: []', () => {
    const a = defaultAliasing();
    expect(a.enabled).toBe(false);
    expect(a.scope).toBe('file');
    expect(a.style).toBe('both');
    expect(a.min_uses).toBe(2);
    expect(a.include).toEqual([]);
  });

  test('defaultRules() references.aliasing carries include: []', () => {
    expect(defaultRules().references.aliasing?.include).toEqual([]);
  });

  test('a _rules.yaml WITHOUT include loads with include: [] (pre-#65 configs untouched)', () => {
    const root = scratch('no-include', {
      '_rules.yaml': [
        'references:',
        '  aliasing:',
        '    enabled: true',
        '    scope: file',
        '    style: both',
        '    min_uses: 2',
        '',
      ].join('\n'),
      '01-overview.md': CORPUS,
    });
    const rules = loadRules(root);
    expect(rules.references.aliasing?.enabled).toBe(true);
    expect(rules.references.aliasing?.include).toEqual([]);
  });

  test('a valid include list loads through verbatim', () => {
    const root = scratch('valid-include', {
      '_rules.yaml': [
        'references:',
        '  aliasing:',
        '    enabled: true',
        '    include:',
        '      - cans/plugins/*.md',
        '      - docs/guides/**/*.md',
        '',
      ].join('\n'),
      '01-overview.md': CORPUS,
    });
    const rules = loadRules(root);
    expect(rules.references.aliasing?.include).toEqual([
      'cans/plugins/*.md',
      'docs/guides/**/*.md',
    ]);
  });
});

// ── Strict §18 validation (issue #56 discipline) ───────────────────────────

describe('issue #65 contract — strict validation', () => {
  test('non-list include rejects with the documented expectation', () => {
    const root = scratch('bad-shape', {
      '_rules.yaml': [
        'references:',
        '  aliasing:',
        '    enabled: true',
        '    include: cans/plugins/*.md',
        '',
      ].join('\n'),
      '01-overview.md': CORPUS,
    });
    expect(() => loadRules(root)).toThrow(
      /"references\.aliasing\.include" must be a list of globs/,
    );
  });

  test('an empty include member rejects with the documented expectation', () => {
    const root = scratch('bad-member', {
      '_rules.yaml': [
        'references:',
        '  aliasing:',
        '    enabled: true',
        '    include:',
        '      - "cans/plugins/*.md"',
        '      - ""',
        '',
      ].join('\n'),
      '01-overview.md': CORPUS,
    });
    expect(() => loadRules(root)).toThrow(
      /"references\.aliasing\.include\[1\]" must be a non-empty glob/,
    );
  });

  test('a non-string include member rejects', () => {
    const root = scratch('bad-type', {
      '_rules.yaml': [
        'references:',
        '  aliasing:',
        '    enabled: true',
        '    include:',
        '      - 42',
        '',
      ].join('\n'),
      '01-overview.md': CORPUS,
    });
    expect(() => loadRules(root)).toThrow(
      /"references\.aliasing\.include\[0\]" must be a non-empty glob/,
    );
  });

  test('a malformed glob (unclosed class) rejects with a line-numbered error', () => {
    const root = scratch('bad-glob', {
      '_rules.yaml': [
        'references:',
        '  aliasing:',
        '    enabled: true',
        '    include:',
        '      - "cans/plugins/[0-9.md"',
        '',
      ].join('\n'),
      '01-overview.md': CORPUS,
    });
    expect(() => loadRules(root)).toThrow(
      /"references\.aliasing\.include\[0\]" is not a valid glob/,
    );
  });

  test('an unknown aliasing member still rejects (typo discipline unchanged)', () => {
    const root = scratch('typo', {
      '_rules.yaml': [
        'references:',
        '  aliasing:',
        '    enabled: true',
        '    includ:',
        '      - cans/plugins/*.md',
        '',
      ].join('\n'),
      '01-overview.md': CORPUS,
    });
    expect(() => loadRules(root)).toThrow(/unrecognized key "references\.aliasing\.includ"/);
  });
});

// ── discoverAliasingFiles: the shared walk ─────────────────────────────────

/** The plugin-file fixture: corpus keys, plugin keys, and the exclusion
 *  classes (`_`-prefixed segments, tool artifacts, non-matching siblings). */
const WALK_FILES: Record<string, string> = {
  '01-overview.md': CORPUS,
  'cans/plugins/profile.md': '# Profile\n\n## Traits\n\nsee: artifacts/examples/fixtures/kelir.yaml#invariants.default_zero_capability\n',
  'cans/plugins/extra.md': '# Extra\n\n## More\n\nBody.\n',
  'cans/other.md': '# Other\n\n## Nope\n\nBody.\n',
  'cans/deep/index.md': CORPUS,
  'cans/deep/topic.md': '# Topic\n\n## Deep\n\nBody.\n',
  '_tasks/t.md': '# Task\n\n## Do\n\nBody.\n',
  'AGENTS.md': '# Agents\n',
};

describe('issue #65 contract — discoverAliasingFiles', () => {
  test('matches the whole anchored path and nothing else', () => {
    const root = scratch('walk', WALK_FILES);
    const spec = new Set(discoverSpecFiles(root));
    expect([...spec].sort()).toEqual(['01-overview.md', 'cans/deep/index.md']);
    const out = discoverAliasingFiles(root, ['cans/plugins/*.md'], spec);
    expect(out).toEqual(['cans/plugins/extra.md', 'cans/plugins/profile.md']);
  });

  test('a single * never crosses segments (anchored whole-path match)', () => {
    const root = scratch('anchored', WALK_FILES);
    const spec = new Set(discoverSpecFiles(root));
    expect(discoverAliasingFiles(root, ['plugins/*.md'], spec)).toEqual([]);
  });

  test('** crosses segments', () => {
    const root = scratch('crossing', WALK_FILES);
    const spec = new Set(discoverSpecFiles(root));
    // `**` matches any run INCLUDING `/` but the literal `/` around it still
    // counts: `cans/**/*.md` needs one intermediate segment, so cans/other.md
    // (directly under cans/) is NOT matched.
    expect(discoverAliasingFiles(root, ['cans/**/*.md'], spec)).toEqual([
      'cans/deep/topic.md',
      'cans/plugins/extra.md',
      'cans/plugins/profile.md',
    ]);
  });

  test('exclude (loaded corpus + aux keys) wins over the patterns', () => {
    const root = scratch('exclude', WALK_FILES);
    const loaded = new Set([...discoverSpecFiles(root), '_tasks/t.md']);
    expect(discoverAliasingFiles(root, ['**/*.md'], loaded)).toEqual([
      'cans/deep/topic.md',
      'cans/other.md',
      'cans/plugins/extra.md',
      'cans/plugins/profile.md',
    ]);
  });

  test('`_`-prefixed segments and tool artifacts are skipped at every level', () => {
    const root = scratch('excluded-classes', {
      'cans/plugins/keep.md': CORPUS,
      '_hidden/plugins/ghost.md': CORPUS,
      'AGENTS.md': '# Agents\n',
      'cans/plugins/AGENTS.md': '# Agents\n',
      '_tasks/inner/task.md': CORPUS,
    });
    expect(discoverAliasingFiles(root, ['**/*.md'], new Set())).toEqual([
      'cans/plugins/keep.md',
    ]);
  });

  test('an empty include list yields nothing without touching the walk', () => {
    const root = scratch('empty-include', WALK_FILES);
    expect(discoverAliasingFiles(root, [], new Set())).toEqual([]);
  });

  test('a pattern that matches nothing yields nothing (no second-guessing)', () => {
    const root = scratch('no-match', WALK_FILES);
    expect(discoverAliasingFiles(root, ['nowhere/*.md'], new Set())).toEqual([]);
  });
});
