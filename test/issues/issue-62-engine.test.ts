/**
 * Issue #62 — `references.forbidden_targets`: the layering-guard ENGINE
 * (checkForbiddenTargets, src/core/refs.ts) plus its checkWorkspace wiring
 * gates, pinned at both levels.
 *
 * The issue: a core spec pointing into plugin leaves is a VALID ref
 * (checkRefs resolves it) yet architecturally wrong — an abstraction leak
 * no rule could express. The fix adds per-source bans on pointer targets:
 * a glob selecting the SOURCE files, a regex banning TARGET shapes
 * (SEARCH semantics, `^`/`$` authored), severity error|warning, an
 * optional verbatim message, and optional `except` source exemptions.
 *
 * Pinned verdicts (the checker contract):
 *   - match AFTER alias expansion (#57): the graph's RefTargets already
 *     carry the expanded target; aliasing can never dodge a ban, and the
 *     default message appends `, via alias "[name]"`.
 *   - match on the FILE part, path-normalized: `//` runs collapse, ONE
 *     leading `./` and ONE leading `cans/` strip (both sides — rule globs
 *     may be written workspace-qualified), trailing slashes trim (the
 *     #22 folder form: `plugins/` ≡ `plugins` as target spellings, so the
 *     ban for one catches the other — `^plugins(/|$)`).
 *   - INDEPENDENT of target validity: no filesystem consultation; a
 *     forbidden target is reported even when the ref is also broken.
 *   - severity per rule: error fails the run, warning does not.
 *   - one finding per MATCHING rule per ref; rule key refs.forbidden_target,
 *     category 'refs'; NOT counted in the refs.broken JSON counter (the
 *     refs.self / refs.deep_hop treatment); graph consequences (refs.total,
 *     deep hops, orphans, duplicate-home) unchanged.
 *   - `name://` external pointers (#55) offer BOTH candidates — `name://` +
 *     the normalized subPath AND the bare normalized subPath; http(s) URLs
 *     get no special casing (no bare-path candidate).
 *
 * Test map (engine unit unless marked checkWorkspace):
 *   e1 ..... the issue's example: exact default message string, level,
 *           rule key, file/line, suggestion; the full issue rule (custom
 *           message + severity) reported verbatim
 *   e2 ..... severity: omitted → 'error', explicit 'warning' → 'warning'
 *   e3 ..... once-per-matching-rule: two rules → two findings ordered by
 *           rule index; one rule × two refs → sorted by line; cross-file
 *           sort by file regardless of files-map insertion order
 *   e4 ..... source glob semantics: `*` stays in a segment, `**` crosses,
 *           `?` one char, `[!…]` negation, case-sensitive
 *   e5 ..... `cans/`-prefix normalization on BOTH sides + target spellings:
 *           `cans/plugins/leaf.md`, `./plugins/leaf.md`, `plugins//leaf.md`,
 *           trailing slash on a full path, folder form `plugins/`
 *   e6 ..... anchors never reach the matcher (`plugins/leaf.md#Anchor`
 *           banned by a `$`-anchored full-path pattern)
 *   e7 ..... alias dodge (contract 1): expanded target + `, via alias "[1]"`
 *   e8 ..... external pointers: `^kelir://plugins/` AND `^plugins/` both
 *           fire; http(s) URLs get no candidates except the URL itself
 *   e9 ..... except: exempted keys skip the rule, others do not
 *   e10 .... aux files: a `_tasks/` referrer hits when the glob matches
 *   e11 .... contract 3: fires on a missing target; checkRefs unaffected
 *   e12 .... empty/undefined/null rules → []; malformed pattern/source
 *           skipped per-rule without throwing; malformed except never
 *           exempts (fail-safe direction)
 *   e13 .... determinism: two files-map insertion orders → identical output
 *   w1 ..... checkWorkspace (REAL): no forbidden_targets config → zero
 *           findings, the pre-#62 surface unchanged
 *   w2–w4 .. checkWorkspace (REAL — the config side, feat/issue-62-config's
 *           §18 schema + block-list parsing, is merged into this branch, so
 *           the old FORBIDDEN_SUPPORTED skip gate is gone): the loadRules
 *           seam, plain-run severities (error → exit 2 / ok false, warning
 *           → exit 1 / ok true), broken+forbidden+deep-hop coexistence with
 *           truthful counters, the --refs-only / --structure gates
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

import { parseOutline } from '../../src/core/outline.ts';
import {
  buildRefGraph, checkForbiddenTargets, checkRefs,
} from '../../src/core/refs.ts';
import { defaultAliasing, extractAliases, resolveFileAliases } from '../../src/core/alias.ts';
import { checkWorkspace, type CheckArgs } from '../../src/commands/check.ts';
import { loadRules } from '../../src/core/rules.ts';
import { makeCansWorkspace } from '../helpers.ts';
import { REPO } from '../runtime.ts';
import type { ForbiddenTargetRule, Issue, OutlineNode } from '../../src/types.ts';

// ── Engine scaffolding (mirrors test/refs.test.ts) ──────────────────────────

/** A files map over inline sources — keys are workspace-relative paths. */
function filesOf(entries: Array<[string, string]>): Map<string, OutlineNode[]> {
  const m = new Map<string, OutlineNode[]>();
  for (const [key, src] of entries) m.set(key, parseOutline(src, key));
  return m;
}

function graphOf(entries: Array<[string, string]>): ReturnType<typeof buildRefGraph> {
  return buildRefGraph(filesOf(entries), '.');
}

/** The issue's own rule — source glob workspace-qualified, root-or-bare
 *  target pattern, error severity, custom message. */
const ISSUE_RULE: ForbiddenTargetRule = {
  source: 'cans/[0-9]*.md',
  pattern: '^(cans/)?plugins/.*',
  severity: 'error',
  message: 'Abstraction leak: Core plane specs cannot reference individual plugin files.',
};

// ── checkWorkspace scaffolding (scratch workspaces under repo/.tmp) ─────────

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-62-engine');
const createdDirs: string[] = [];
let wsSeq = 0;

/** Fresh scratch workspace (the cans/ root checkWorkspace takes). */
function makeWs(name: string, files: Record<string, string>): string {
  const root = join(SCRATCH, `${name}-${++wsSeq}`);
  mkdirSync(root, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, content, 'utf8');
  }
  createdDirs.push(root);
  return root;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    rmSync(createdDirs.pop()!, { recursive: true, force: true });
  }
});

const BASE_OPTS: CheckArgs = {
  fix: false,
  strict: false,
  refsOnly: false,
  noRedundancy: false,
  file: null,
  json: false,
};

/** A `references.forbidden_targets` _rules.yaml block — the issue's own
 *  block-list shape (quoted strings, inline `except` array). */
function forbiddenYaml(rules: ForbiddenTargetRule[], backPointers = false): string {
  const lines = ['references:'];
  if (backPointers) lines.push('  back_pointers: true');
  else lines.push('  back_pointers: false');
  lines.push('  forbidden_targets:');
  for (const r of rules) {
    lines.push(`    - source: "${r.source}"`);
    lines.push(`      pattern: "${r.pattern}"`);
    if (r.severity !== undefined) lines.push(`      severity: ${r.severity}`);
    if (r.message !== undefined) lines.push(`      message: "${r.message}"`);
    if (r.except !== undefined) {
      lines.push(`      except: [${r.except.map(e => `"${e}"`).join(', ')}]`);
    }
  }
  return lines.join('\n') + '\n';
}

/** The issue's exact example block, used by the config probe. */
const ISSUE_RULES_YAML = [
  'references:',
  '  forbidden_targets:',
  '    - source: "cans/[0-9]*.md"',
  '      pattern: "^(cans/)?plugins/.*"',
  '      severity: error',
  '      message: "Abstraction leak: Core plane specs cannot reference individual plugin files."',
  '',
].join('\n');

// ── e1: the issue's example — the exact finding shape ───────────────────────

describe('issue #62 e1 — the issue\'s example, exact finding shape', () => {
  const GRAPH = graphOf([['01-core.md', '- Core plane: see: plugins/leaf.md\n']]);

  test('default message, level, rule key, file/line, suggestion — byte-exact', () => {
    const issues = checkForbiddenTargets(GRAPH, [
      { source: 'cans/[0-9]*.md', pattern: '^(cans/)?plugins/.*' },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toEqual({
      file: '01-core.md',
      line: 1,
      level: 'error',
      category: 'refs',
      rule: 'refs.forbidden_target',
      message: 'forbidden target: 01-core.md:1 → plugins/leaf.md — references.forbidden_targets[0]'
        + ' (source "cans/[0-9]*.md", pattern "^(cans/)?plugins/.*")',
      suggestion: 'remove the see: pointer — or, if this target is legitimate,'
        + ' rescope references.forbidden_targets[0] (source/except)',
    } satisfies Issue);
  });

  test('the full issue rule — custom message VERBATIM, severity error', () => {
    const issues = checkForbiddenTargets(GRAPH, [ISSUE_RULE]);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toBe('Abstraction leak: Core plane specs cannot reference individual plugin files.');
    expect(issues[0].level).toBe('error');
    expect(issues[0].rule).toBe('refs.forbidden_target');
    // custom message replaces ONLY the message — the suggestion is the fixed advice
    expect(issues[0].suggestion).toBe('remove the see: pointer — or, if this target is legitimate,'
      + ' rescope references.forbidden_targets[0] (source/except)');
  });
});

// ── e2: severity ────────────────────────────────────────────────────────────

describe('issue #62 e2 — severity per rule', () => {
  const GRAPH = graphOf([['01-core.md', '- Core plane: see: plugins/leaf.md\n']]);

  test('omitted severity → error (the engine default; loadRules also defaults it)', () => {
    const issues = checkForbiddenTargets(GRAPH, [
      { source: '[0-9]*.md', pattern: '^plugins/' },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe('error');
  });

  test("explicit 'warning' → warning", () => {
    const issues = checkForbiddenTargets(GRAPH, [
      { source: '[0-9]*.md', pattern: '^plugins/', severity: 'warning' },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe('warning');
  });
});

// ── e3: once per matching rule; deterministic ordering ──────────────────────

describe('issue #62 e3 — once per matching rule, ordered output', () => {
  test('two rules both matching → two findings ordered by rule index', () => {
    const issues = checkForbiddenTargets(
      graphOf([['01-core.md', '- Core plane: see: plugins/leaf.md\n']]),
      [
        { source: 'cans/[0-9]*.md', pattern: '^(cans/)?plugins/.*' }, // index 0
        { source: '01-core.md', pattern: '^plugins/' },               // index 1
      ],
    );
    expect(issues).toHaveLength(2);
    expect(issues.map(i => i.line)).toEqual([1, 1]); // same ref — rule order decides
    expect(issues[0].message).toContain('references.forbidden_targets[0]');
    expect(issues[1].message).toContain('references.forbidden_targets[1]');
    expect(issues[1].message).toBe(
      'forbidden target: 01-core.md:1 → plugins/leaf.md — references.forbidden_targets[1]'
      + ' (source "01-core.md", pattern "^plugins/")',
    );
  });

  test('one rule matching twice on two refs → two findings sorted by line', () => {
    const issues = checkForbiddenTargets(
      graphOf([['01-core.md', '- Late point: see: plugins/b.md\n- Early point: see: plugins/a.md\n']]),
      [{ source: '[0-9]*.md', pattern: '^plugins/' }],
    );
    expect(issues).toHaveLength(2);
    expect(issues.map(i => i.line)).toEqual([1, 2]); // document order, not ref order
  });

  test('cross-file: sorted by file regardless of files-map insertion order', () => {
    const issues = checkForbiddenTargets(
      graphOf([
        ['02-late.md', '- Point: see: plugins/b.md\n'],
        ['01-early.md', '- Point: see: plugins/a.md\n'],
      ]),
      [{ source: '[0-9]*.md', pattern: '^plugins/' }],
    );
    expect(issues.map(i => i.file)).toEqual(['01-early.md', '02-late.md']);
  });
});

// ── e4: source glob semantics ───────────────────────────────────────────────

describe('issue #62 e4 — source glob semantics (core/glob.ts through the engine)', () => {
  test('`*` stays inside one segment — [0-9]*.md does not select plugins/leaf.md', () => {
    const graph = graphOf([['plugins/leaf.md', '- Leaf: see: secret/plan.md\n']]);
    expect(checkForbiddenTargets(graph, [{ source: '[0-9]*.md', pattern: '^secret/' }])).toEqual([]);
    // control: a glob that DOES select the file fires
    expect(checkForbiddenTargets(graph, [{ source: 'plugins/*.md', pattern: '^secret/' }])).toHaveLength(1);
  });

  test('`**` crosses segments', () => {
    const graph = graphOf([['plugins/deep/leaf.md', '- Leaf: see: secret/plan.md\n']]);
    expect(checkForbiddenTargets(graph, [{ source: 'plugins/*.md', pattern: '^secret/' }])).toEqual([]);
    expect(checkForbiddenTargets(graph, [{ source: 'plugins/**/*.md', pattern: '^secret/' }])).toHaveLength(1);
    expect(checkForbiddenTargets(graph, [{ source: 'plugins/**', pattern: '^secret/' }])).toHaveLength(1);
  });

  test('`?` is exactly one character', () => {
    const issues = checkForbiddenTargets(
      graphOf([
        ['01-core.md', '- A: see: secret/plan.md\n'],
        ['011-core.md', '- B: see: secret/plan.md\n'],
      ]),
      [{ source: '0?-core.md', pattern: '^secret/' }],
    );
    expect(issues.map(i => i.file)).toEqual(['01-core.md']); // 011- needs two ?
  });

  test('`[!…]` negates', () => {
    const issues = checkForbiddenTargets(
      graphOf([
        ['a-core.md', '- A: see: secret/plan.md\n'],
        ['0-core.md', '- B: see: secret/plan.md\n'],
      ]),
      [{ source: '[!0]*.md', pattern: '^secret/' }],
    );
    expect(issues.map(i => i.file)).toEqual(['a-core.md']);
  });

  test('source matching is case-sensitive', () => {
    const graph = graphOf([['Plugins/leaf.md', '- Leaf: see: secret/plan.md\n']]);
    expect(checkForbiddenTargets(graph, [{ source: 'plugins/*.md', pattern: '^secret/' }])).toEqual([]);
    expect(checkForbiddenTargets(graph, [{ source: 'Plugins/*.md', pattern: '^secret/' }])).toHaveLength(1);
  });
});

// ── e5: cans/ prefix on both sides + target spellings ───────────────────────

describe('issue #62 e5 — cans/ normalization on BOTH sides, target spellings', () => {
  test('rule source cans/[0-9]*.md and [0-9]*.md select the same key', () => {
    const graph = graphOf([['00-overview.md', '- Hub: see: plugins/leaf.md\n']]);
    expect(checkForbiddenTargets(graph, [{ source: 'cans/[0-9]*.md', pattern: '^plugins/' }])).toHaveLength(1);
    expect(checkForbiddenTargets(graph, [{ source: '[0-9]*.md', pattern: '^plugins/' }])).toHaveLength(1);
  });

  test('target spellings: cans/-prefixed, ./-prefixed, // runs, trailing slash', () => {
    const issues = checkForbiddenTargets(
      graphOf([
        ['01-a.md', '- A: see: cans/plugins/leaf.md\n'],
        ['02-b.md', '- B: see: ./plugins/leaf.md\n'],
        ['03-c.md', '- C: see: plugins//leaf.md\n'],
        ['04-d.md', '- D: see: plugins/leaf.md/\n'],
      ]),
      [{ source: '[0-9]*.md', pattern: '^plugins/' }],
    );
    expect(issues.map(i => i.file)).toEqual(['01-a.md', '02-b.md', '03-c.md', '04-d.md']);
    // the message quotes the target AS WRITTEN (ref.file verbatim)…
    expect(issues[0].message).toContain('→ cans/plugins/leaf.md');
    expect(issues[1].message).toContain('→ ./plugins/leaf.md');
    // …while the MATCH ran on the normalized form (all four banned by ^plugins/)
  });

  test('folder form: trailing slash trims to the bare stem (the #22 equivalence)', () => {
    const graph = graphOf([['05-e.md', '- E: see: plugins/\n']]);
    // `plugins/` ≡ `plugins` as target spellings: a ban written for one
    // catches the other — `^plugins(/|$)` covers both the folder and the tree.
    expect(checkForbiddenTargets(graph, [{ source: '[0-9]*.md', pattern: '^plugins(/|$)' }])).toHaveLength(1);
    expect(checkForbiddenTargets(graph, [{ source: '[0-9]*.md', pattern: '^plugins$' }])).toHaveLength(1);
    // Pinned consequence of the trailing trim: the bare stem `plugins` does
    // not carry a `/`, so a tree-shaped `^plugins/` alone does NOT catch the
    // folder-form spelling — write `^plugins(/|$)` for that (documented).
    expect(checkForbiddenTargets(graph, [{ source: '[0-9]*.md', pattern: '^plugins/' }])).toEqual([]);
  });
});

// ── e6: anchors never reach the matcher ─────────────────────────────────────

describe('issue #62 e6 — the anchor is a separate field, never in the match', () => {
  test('see: plugins/leaf.md#Anchor banned by a $-anchored full-path pattern', () => {
    const issues = checkForbiddenTargets(
      graphOf([['01-core.md', '- Core: see: plugins/leaf.md#Anchor\n']]),
      [{ source: '[0-9]*.md', pattern: '^plugins/leaf\\.md$' }],
    );
    expect(issues).toHaveLength(1);
    // the message names the FILE part only — the anchor never appears
    expect(issues[0].message).toBe(
      'forbidden target: 01-core.md:1 → plugins/leaf.md — references.forbidden_targets[0]'
      + ' (source "[0-9]*.md", pattern "^plugins/leaf\\.md$")',
    );
  });
});

// ── e7: alias dodge (contract 1) ────────────────────────────────────────────

describe('issue #62 e7 — aliasing cannot dodge a ban (contract 1)', () => {
  test('an alias use resolves to the expanded target and the ban fires with the alias suffix', () => {
    const src = [
      '- First point: see: [1]',
      '- Second point: see: [1]',
      '',
      '- [1]: plugins/leaf.md',
      '',
    ].join('\n');
    const nodes = parseOutline(src, '01-core.md');
    const table = extractAliases(src);
    const cfg = { ...defaultAliasing(), enabled: true };
    expect(resolveFileAliases(nodes, table, '01-core.md', cfg)).toEqual([]); // both uses resolve
    const graph = buildRefGraph(new Map([['01-core.md', nodes]]), '.');
    // the graph carries the EXPANDED target + the alias marker — matching runs on it
    const expanded = graph.forward.get('01-core.md')!;
    expect(expanded.map(r => r.file)).toEqual(['plugins/leaf.md', 'plugins/leaf.md']);
    expect(expanded.every(r => r.alias !== undefined && r.alias.name === '1')).toBe(true);

    const issues = checkForbiddenTargets(graph, [{ source: 'cans/[0-9]*.md', pattern: '^plugins/' }]);
    expect(issues).toHaveLength(2);
    expect(issues.map(i => i.line)).toEqual([1, 2]);
    for (const issue of issues) {
      expect(issue.message).toBe(
        `forbidden target: 01-core.md:${issue.line} → plugins/leaf.md`
        + ' — references.forbidden_targets[0] (source "cans/[0-9]*.md", pattern "^plugins/")'
        + ', via alias "[1]"',
      );
    }
  });
});

// ── e8: external pointers and URLs ──────────────────────────────────────────

describe('issue #62 e8 — external pointers (#55) and http(s) URLs', () => {
  test('kelir://plugins/leaf.md fires on BOTH candidates', () => {
    const graph = graphOf([['01-core.md', '- Core: see: kelir://plugins/leaf.md\n']]);
    // candidate 1: name:// + normalized subPath
    expect(checkForbiddenTargets(graph, [{ source: '[0-9]*.md', pattern: '^kelir://plugins/' }])).toHaveLength(1);
    // candidate 2: the bare normalized subPath
    expect(checkForbiddenTargets(graph, [{ source: '[0-9]*.md', pattern: '^plugins/' }])).toHaveLength(1);
  });

  test('http(s) URLs get NO special casing — no bare-path candidate', () => {
    const graph = graphOf([['01-core.md', '- Core: see: https://example.com/plugins/leaf.md\n']]);
    // externalPointerParts returns null for http/https: the plugins/ path
    // inside the URL is NOT offered as a candidate.
    expect(checkForbiddenTargets(graph, [{ source: '[0-9]*.md', pattern: '^plugins/' }])).toEqual([]);
    // The URL rides the ordinary single-candidate path through the SHARED
    // normalization (`//` collapse included — no URL special casing in the
    // other direction either): a pattern matching the normalized string fires.
    expect(checkForbiddenTargets(graph, [
      { source: '[0-9]*.md', pattern: '^https:/example\\.com/plugins/' },
    ])).toHaveLength(1);
  });
});

// ── e9: except ──────────────────────────────────────────────────────────────

describe('issue #62 e9 — except exempts source files from the rule', () => {
  test('excepted keys skip, others fire', () => {
    const issues = checkForbiddenTargets(
      graphOf([
        ['00-overview.md', '- Hub: see: plugins/leaf.md\n'],
        ['01-core.md', '- Core: see: plugins/leaf.md\n'],
        ['02-plugin-model.md', '- Model: see: plugins/leaf.md\n'],
      ]),
      [{
        source: '[0-9]*.md',
        pattern: '^plugins/',
        except: ['cans/02-plugin-model.md', 'cans/00-overview.md'],
      }],
    );
    expect(issues.map(i => i.file)).toEqual(['01-core.md']);
  });
});

// ── e10: aux files are referrers too ────────────────────────────────────────

describe('issue #62 e10 — _tasks/ aux referrers hit when the glob matches', () => {
  test('source _tasks/** selects the aux key', () => {
    const issues = checkForbiddenTargets(
      graphOf([
        ['_tasks/add-dark-mode.md', '- Task: see: plugins/leaf.md\n'],
        ['01-core.md', '- Core: see: plugins/leaf.md\n'],
      ]),
      [{ source: '_tasks/**', pattern: '^plugins/' }],
    );
    expect(issues.map(i => i.file)).toEqual(['_tasks/add-dark-mode.md']);
  });
});

// ── e11: independence from target validity (contract 3) ─────────────────────

describe('issue #62 e11 — forbidden verdict independent of validity (contract 3)', () => {
  test('missing target: the ban fires AND checkRefs reports the broken ref', () => {
    const files = filesOf([['01-core.md', '- Core: see: plugins/no-such-leaf-62.md\n']]);
    const graph = buildRefGraph(files, '.');
    // the engine never consults the filesystem — the ban fires regardless
    expect(checkForbiddenTargets(graph, [{ source: '[0-9]*.md', pattern: '^plugins/' }])).toHaveLength(1);
    // …and checkRefs is unaffected: the same ref is ALSO a broken ref
    const refsIssues = checkRefs(files, graph, '.');
    expect(refsIssues.filter(i => i.rule === 'refs.broken.file')).toHaveLength(1);
  });
});

// ── e12: empty / undefined / malformed rules ────────────────────────────────

describe('issue #62 e12 — no rules, and garbage rules, are inert — never a throw', () => {
  const GRAPH = graphOf([['01-core.md', '- Core: see: plugins/leaf.md\n']]);

  test('empty array / undefined / omitted / null → []', () => {
    expect(checkForbiddenTargets(GRAPH, [])).toEqual([]);
    expect(checkForbiddenTargets(GRAPH, undefined)).toEqual([]);
    expect(checkForbiddenTargets(GRAPH)).toEqual([]);
    expect(checkForbiddenTargets(GRAPH, null)).toEqual([]);
  });

  test('malformed pattern and malformed source glob are skipped per-rule', () => {
    expect(checkForbiddenTargets(GRAPH, [{ source: '**', pattern: '(' }])).toEqual([]);
    expect(checkForbiddenTargets(GRAPH, [{ source: '[', pattern: '^plugins/' }])).toEqual([]);
    // a skipped rule never mutes its siblings — and never renumbers them
    const issues = checkForbiddenTargets(GRAPH, [
      { source: '**', pattern: '(' },                   // index 0 — garbage
      { source: '[0-9]*.md', pattern: '^plugins/' },   // index 1 — fires as [1]
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('references.forbidden_targets[1]');
  });

  test('a malformed except entry never exempts (fail-safe: the rule keeps applying)', () => {
    expect(checkForbiddenTargets(GRAPH, [
      { source: '[0-9]*.md', pattern: '^plugins/', except: ['['] },
    ])).toHaveLength(1);
  });
});

// ── e13: determinism ────────────────────────────────────────────────────────

describe('issue #62 e13 — deterministic output across graph insertion orders', () => {
  test('two insertion orders of the same files map → identical sorted findings', () => {
    const rules: ForbiddenTargetRule[] = [
      { source: 'cans/[0-9]*.md', pattern: '^plugins/' },
      { source: '01-core.md', pattern: '^plugins/' },
    ];
    const entries: Array<[string, string]> = [
      ['01-core.md', '- A: see: plugins/leaf.md\n- B: see: plugins/other.md\n'],
      ['00-overview.md', '- Hub: see: plugins/root.md\n'],
    ];
    const forward = checkForbiddenTargets(buildRefGraph(filesOf(entries), '.'), rules);
    const reversed = checkForbiddenTargets(
      buildRefGraph(filesOf([entries[1]!, entries[0]!]), '.'),
      rules,
    );
    expect(forward).toEqual(reversed);
    // …and the order is (file, line, rule index): the overview line first
    // (rule [0] selects every numeric key, rule [1] only 01-core.md), then
    // each core line firing TWICE — rules [0] and [1] in config order.
    expect(forward.map(i => `${i.file}:${i.line}`)).toEqual([
      '00-overview.md:1',
      '01-core.md:1',
      '01-core.md:1',
      '01-core.md:2',
      '01-core.md:2',
    ]);
    expect(forward.filter(i => i.line === 1 && i.file === '01-core.md').map(i => i.message))
      .toEqual([
        'forbidden target: 01-core.md:1 → plugins/leaf.md — references.forbidden_targets[0]'
          + ' (source "cans/[0-9]*.md", pattern "^plugins/")',
        'forbidden target: 01-core.md:1 → plugins/leaf.md — references.forbidden_targets[1]'
          + ' (source "01-core.md", pattern "^plugins/")',
      ]);
  });
});

// ── checkWorkspace level ────────────────────────────────────────────────────

describe('issue #62 w1 — checkWorkspace: feature OFF by default (no config)', () => {
  test('no forbidden_targets config → zero findings, the pre-#62 surface unchanged', async () => {
    const root = makeWs('w1-off', {
      '_rules.yaml': 'references:\n  back_pointers: false\n',
      '01-core.md': '- Core plane: see: plugins/leaf.md\n',
      'plugins/leaf.md': '- Leaf plugin\n',
    });
    const r = await checkWorkspace(root, BASE_OPTS);
    expect(r.issues.filter(i => i.rule === 'refs.forbidden_target')).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.refs).toEqual({ total: 1, broken: 0, deepHops: 0 });
  });

  test('the issue chain workspace is clean of forbidden findings without the rule (the w3 baseline)', async () => {
    const root = makeWs('w1-chain', {
      '_rules.yaml': 'references:\n  back_pointers: false\n',
      '00-overview.md': '- Overview: see: 01-core.md\n',
      '01-core.md': '- Core plane: see: plugins/leaf.md\n',
      // plugins/leaf.md deliberately ABSENT: the ref is broken + a deep hop
    });
    const r = await checkWorkspace(root, BASE_OPTS);
    expect(r.issues.filter(i => i.rule === 'refs.forbidden_target')).toEqual([]);
    // the baseline verdicts w3 builds on, verified for real:
    expect(r.refs.total).toBe(2);
    expect(r.refs.broken).toBe(1);   // only the missing file — not the (absent) ban
    expect(r.refs.deepHops).toBe(1); // 00 → 01 → plugins/leaf.md still reports
    expect(r.issues.some(i => i.rule === 'refs.broken.file')).toBe(true);
    expect(r.issues.some(i => i.rule === 'refs.deep_hop')).toBe(true);
    expect(r.exitCode).toBe(2);
  });
});

/** The wiring suite: REAL — the config side (feat/issue-62-config's §18
 *  schema entry, block-list parsing and validation) is merged into this
 *  branch, so `_rules.yaml` forbidden_targets blocks flow through loadRules
 *  into checkWorkspace. w2 pins that seam first; a regression in either
 *  direction (config drops the key / wiring stops reading it) fails these
 *  tests loudly, never silently skips. */
describe('issue #62 w2–w4 — checkWorkspace wiring (gates, severities, counters)', () => {
  test('w2 preamble — the loadRules seam: the issue\'s block parses to the rule list, severity defaulted', () => {
    const dir = join(SCRATCH, 'w2-seam');
    const root = makeCansWorkspace(dir, {
      '_rules.yaml': ISSUE_RULES_YAML,
      '00-overview.md': '- Overview\n',
    });
    createdDirs.push(dir); // afterEach removes it
    expect(loadRules(root).references.forbidden_targets).toEqual([
      {
        source: 'cans/[0-9]*.md',
        pattern: '^(cans/)?plugins/.*',
        severity: 'error', // omitted in the YAML — loadRules' completion pass
        message: 'Abstraction leak: Core plane specs cannot reference individual plugin files.',
      },
    ]);
  });

  /** Valid-target workspace where the ONLY possible finding is the ban. */
  const BANNED_WS = (name: string, yaml: string): string => makeWs(name, {
    '_rules.yaml': yaml,
    '01-core.md': '- Core plane: see: plugins/leaf.md\n',
    'plugins/leaf.md': '- Leaf plugin\n',
  });

  test('w2: plain run — error severity → exitCode 2 / ok false; warning → exitCode 1 / ok true', async () => {
    const err = await checkWorkspace(
      BANNED_WS('w2-err', forbiddenYaml([{ source: 'cans/[0-9]*.md', pattern: '^plugins/' }])),
      BASE_OPTS,
    );
    const errFindings = err.issues.filter(i => i.rule === 'refs.forbidden_target');
    expect(errFindings).toHaveLength(1);
    expect(errFindings[0].level).toBe('error');
    expect(err.errorCount).toBe(1);
    expect(err.exitCode).toBe(2);
    expect(err.ok).toBe(false);

    const warn = await checkWorkspace(
      BANNED_WS('w2-warn', forbiddenYaml([
        { source: 'cans/[0-9]*.md', pattern: '^plugins/', severity: 'warning' },
      ])),
      BASE_OPTS,
    );
    const warnFindings = warn.issues.filter(i => i.rule === 'refs.forbidden_target');
    expect(warnFindings).toHaveLength(1);
    expect(warnFindings[0].level).toBe('warning');
    expect(warn.errorCount).toBe(0);
    expect(warn.warningCount).toBe(1);
    expect(warn.exitCode).toBe(1);
    expect(warn.ok).toBe(true);
  });

  test('w3: broken + forbidden + deep hop coexist; refs.broken counts ONLY the broken one (contracts 3/6)', async () => {
    const root = makeWs('w3-chain', {
      '_rules.yaml': forbiddenYaml([{ source: 'cans/[0-9]*.md', pattern: '^plugins/' }]),
      '00-overview.md': '- Overview: see: 01-core.md\n',
      '01-core.md': '- Core plane: see: plugins/leaf.md\n',
      // plugins/leaf.md deliberately ABSENT: banned AND broken AND the deep hop's final edge
    });
    const r = await checkWorkspace(root, BASE_OPTS);
    // BOTH findings present — the ban is independent of target validity
    expect(r.issues.some(i => i.rule === 'refs.broken.file')).toBe(true);
    expect(r.issues.filter(i => i.rule === 'refs.forbidden_target')).toHaveLength(1);
    // the deep hop still reports (graph consequences unchanged)
    expect(r.issues.some(i => i.rule === 'refs.deep_hop')).toBe(true);
    // truthful counters: the forbidden finding is NOT in refs.broken…
    expect(r.refs.broken).toBe(1);
    // …the ref still counts in refs.total, the hop still in deepHops
    expect(r.refs.total).toBe(2);
    expect(r.refs.deepHops).toBe(1);
    // 3 errors: broken ref + deep hop + forbidden target (error severity)
    expect(r.errorCount).toBe(3);
    expect(r.exitCode).toBe(2);
  });

  test('w4: --refs-only includes the finding; the --structure gate suppresses it', async () => {
    const files: Record<string, string> = {
      '_rules.yaml': forbiddenYaml([{ source: 'cans/[0-9]*.md', pattern: '^plugins/' }]),
      '01-core.md': '- Core plane: see: plugins/leaf.md\n',
      'plugins/leaf.md': '- Leaf plugin\n',
    };
    // --refs-only: the refs cluster runs — the finding is present
    const refsOnly = await checkWorkspace(makeWs('w4-refs', files), { ...BASE_OPTS, refsOnly: true });
    expect(refsOnly.issues.filter(i => i.rule === 'refs.forbidden_target')).toHaveLength(1);
    expect(refsOnly.errorCount).toBe(1);
    expect(refsOnly.exitCode).toBe(2);
    // --structure: the refs cluster is suppressed — the finding is absent
    // (the workspace is structurally clean, so the gated run is fully green)
    const gated = await checkWorkspace(makeWs('w4-gate', files), { ...BASE_OPTS, structure: true });
    expect(gated.issues.filter(i => i.rule === 'refs.forbidden_target')).toEqual([]);
    expect(gated.issues.filter(i => i.category === 'refs')).toEqual([]);
    expect(gated.errorCount).toBe(0);
    expect(gated.exitCode).toBe(0);
    expect(gated.ok).toBe(true);
    // plain run control: the same workspace DOES carry the finding
    const plain = await checkWorkspace(makeWs('w4-plain', files), BASE_OPTS);
    expect(plain.issues.filter(i => i.rule === 'refs.forbidden_target')).toHaveLength(1);
  });
});
