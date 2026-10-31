/**
 * Issue #56 — strict `_rules.yaml` validation, and the overflow bypass removal.
 *
 * Part 1 (unknown keys/values): pre-#56 an unrecognized key in _rules.yaml was
 * silently ignored — loadRules documented "File absent, empty, or listing only
 * unknown keys → all defaults" — and only style.prefer / references.mode
 * (issue #2) were validated. A typo in a key name (node_lenght, max_hop,
 * force_file_fro) therefore silently meant "no such rule" while the author
 * believed a limit was enforced. Post-#56 every top-level and nested key must
 * be a known §18 key, and every value must sit inside its documented domain
 * (RULES_SCHEMA in src/core/rules.ts is the single source of truth); any
 * violation is a LINE-NUMBERED config error — the same treatment prefer/mode
 * already got: rule `config.invalid` on file `_rules.yaml`, exit 2 from
 * `cans check`, `--json` sections.config, standalone `✗ invalid _rules.yaml:
 * line N: …` human diagnosis (issue #43).
 *
 * Part 2 (overflow removal): the §16 overflow engine — and the
 * `overflow.max_node_chars` budget that let an agent route unbounded prose one
 * `see:` away from every node-length/depth/redundancy limit — is REMOVED
 * (feat commit on this branch; semantics pinned in test/issue-45-double-report
 * .test.ts). These tests pin the #56 config-side consequences:
 *   - `overflow.*` keys reject as UNRECOGNIZED (they are dead config now, and
 *     dead config must error, not linger);
 *   - the limit the author actually configured BINDS: a 12,000-char node
 *     under `structure.node_length.max: 30` is flagged by the one surviving
 *     budget — there is no second engine to route the content into;
 *   - a short `see: artifacts/b.txt` pointer at a 12,000-char artifact is
 *     ordinary non-spec content (§16 post-#56 model): the check runs clean —
 *     the tool no longer sanctions an alternative budget, but referencing
 *     repo artifacts was never illegal (the refs engine only checks the
 *     target exists).
 *
 * Also pins the SURVIVING lenience that is deliberate §18 behavior:
 * "File absent or empty → all defaults" stays valid; the documented
 * empty-value/null semantics per key (check OFF / default / no filtering)
 * stay legal, now also via the YAML null literals; ratio thresholds above 1
 * (the historical never-fires spelling, e.g. the issue #3 repro's 1.1) stay
 * legal; the inert slug: documentation section (issue #53) stays legal.
 *
 * Levels: engine unit (loadRules throws with the line number) and CLI
 * blackbox (exit code, human line, --json sections.config envelope).
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';

import { spawnCli, REPO } from '../runtime.ts';
import { loadRules, defaultRules } from '../../src/core/rules.ts';

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-56-strict-rules');

interface Ws { root: string; cans: string }

const createdDirs: string[] = [];
let wsSeq = 0;

/** Fresh scratch workspace under repo/.tmp/issues/issue-56-strict-rules (gitignored). */
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

describe('issue #56 part 1 — unrecognized keys are line-numbered config errors', () => {
  test('repro (JSON): bogus nested + top-level keys → exit 2, config.invalid, first offender named with its line', () => {
    // The issue's exact repro shape. The walk hits structure.bogus_subkey
    // (line 2) before the top-level totally_bogus_key (line 3) — one
    // line-numbered diagnosis, the check does not run.
    const ws = makeWs('repro');
    writeFileSync(join(ws.cans, '01-alpha.md'), '- Alpha overview hub\n  - Zephyr ledger details\n');
    writeFileSync(
      join(ws.cans, '_rules.yaml'),
      ['structure:', '  bogus_subkey: 999', 'totally_bogus_key: hello', ''].join('\n'),
    );

    const r = runCli(['check', '--json'], ws.root);
    expectConfigError(
      r,
      'line 2 — unrecognized key "structure.bogus_subkey" (issue #56: _rules.yaml is validated strictly — §18 documents the legal keys)',
    );
  });

  test('repro (human): standalone ✗ diagnosis line, no report body', () => {
    const ws = makeWs('repro-human');
    writeFileSync(join(ws.cans, '01-alpha.md'), '- Alpha overview hub\n  - Zephyr ledger details\n');
    writeFileSync(join(ws.cans, '_rules.yaml'), 'totally_bogus_key: hello\n');

    const r = runCli(['check'], ws.root);
    expect(r.exit).toBe(2);
    expect(r.out.trim()).toBe(
      '✗ invalid _rules.yaml: line 1 — unrecognized key "totally_bogus_key" (issue #56: _rules.yaml is validated strictly — §18 documents the legal keys)',
    );
    expect(r.out).not.toContain('files ·');
    expect(r.out).not.toContain('STRUCTURE');
  });

  test('the issue\'s typo examples: node_lenght and max_hop reject as unrecognized', () => {
    // A typo'd key name silently meaning "no such rule" was the issue's core
    // complaint — both spellings now reject with the line number.
    const typo1 = load('structure:\n  node_lenght: { min: 3, max: 120 }\n');
    expect(typo1.error).not.toBeNull();
    expect(typo1.error!.message).toContain('line 2 — unrecognized key "structure.node_lenght"');

    const typo2 = load('references:\n  max_hop: 1\n');
    expect(typo2.error).not.toBeNull();
    expect(typo2.error!.message).toContain('line 2 — unrecognized key "references.max_hop"');
  });

  test('unrecognized members inside a range map and inside the slug: section reject too', () => {
    const rangeMember = load('structure:\n  node_length: { min: 3, avg: 5 }\n');
    expect(rangeMember.error).not.toBeNull();
    expect(rangeMember.error!.message).toContain('unrecognized key "structure.node_length.avg"');

    const slugMember = load('slug:\n  bogus: 1\n');
    expect(slugMember.error).not.toBeNull();
    expect(slugMember.error!.message).toContain('unrecognized key "slug.bogus"');
  });

  test('a non-mapping section keeps its §18 shape error (qa-03 F2a regression guard)', () => {
    const scalar = load('structure: 42\n');
    expect(scalar.error).not.toBeNull();
    expect(scalar.error!.message).toBe('line 1 — "structure" must be a mapping, got number');

    const empty = load('structure:\n');
    expect(empty.error).not.toBeNull();
    expect(empty.error!.message).toBe('line 1 — "structure" must be a mapping, got empty value (nothing under the key)');
  });
});

describe('issue #56 part 2 — overflow.* keys reject; the configured limit binds', () => {
  test("the issue's repro rules (node_length.max 30 + overflow.max_node_chars 30) → unrecognized key \"overflow\", exit 2, check does not run", () => {
    // Pre-#56 this file loaded fine and the overflow engine sanctioned
    // routing content out of the outline. Post-#56 the removed engine's keys
    // are dead config — and dead config errors instead of lingering.
    const ws = makeWs('overflow-repro');
    writeFileSync(join(ws.cans, '01-spec.md'), '- Root node\n  - see: artifacts/b.txt\n');
    writeFileSync(
      join(ws.cans, '_rules.yaml'),
      ['structure:', '  node_length: { min: 3, max: 30 }', 'overflow:', '  max_node_chars: 30', ''].join('\n'),
    );

    const r = runCli(['check', '--json'], ws.root);
    expectConfigError(
      r,
      'line 3 — unrecognized key "overflow" (issue #56: _rules.yaml is validated strictly — §18 documents the legal keys)',
    );
  });

  test("the removed engine's other key (overflow.force_file_for, typo'd or not) rejects the same way", () => {
    const ws = makeWs('overflow-force-file');
    writeFileSync(join(ws.cans, '01-spec.md'), '- Root node\n  - Zephyr ledger details\n');
    writeFileSync(
      join(ws.cans, '_rules.yaml'),
      ['overflow:', '  force_file_fro: [fence, table]', ''].join('\n'),
    );

    const r = runCli(['check', '--json'], ws.root);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.error).toContain('unrecognized key "overflow"');
    expect(j.error).toMatch(/line 1/);
  });

  test('the delete-key bypass is gone too: overflow.max_node_chars: null rejects (not an off-switch)', () => {
    // The issue also flagged `overflow.max_node_chars: null` (char check off
    // entirely) as an escape hatch. The whole section is unrecognized now —
    // including its null values.
    const nulled = load('overflow:\n  max_node_chars: null\n');
    expect(nulled.error).not.toBeNull();
    expect(nulled.error!.message).toContain('unrecognized key "overflow"');
  });

  test('the limit the author configured BINDS: a 12,017-char node under node_length.max 30 is flagged exactly once, exit 1', () => {
    // With the overflow engine gone there is no second budget to route the
    // content into — structure.node_length is the single node-text-length
    // limit, and it fires on the spec node itself. Issue #61: the finding
    // carries the default node_length severity 'warn' (warning level, exit 1
    // — no longer the pre-#61 hardcoded error/exit 2).
    const ws = makeWs('long-node-binds');
    // trimEnd: the outline parser trims node text, so the fixture is built
    // pre-trimmed to keep the pin exact.
    const longNode = `Long content node ${'quantum synergy leverage '.repeat(480).trimEnd()}`;
    // fixture pin: "Long content node " (18) + "quantum synergy leverage " (25) × 480 − 1 trailing space
    expect(longNode.length).toBe(12017);
    writeFileSync(join(ws.cans, '01-spec.md'), `- Root node\n  - ${longNode}\n`);
    writeFileSync(join(ws.cans, '_rules.yaml'), 'structure:\n  node_length: { min: 3, max: 30 }\n');

    const r = runCli(['check', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(1); // issue #61: warnings-only (node_length severity 'warn')
    expect(j.counts.errors).toBe(0);
    expect(j.counts.warnings).toBe(1);
    const hits = j.sections.structure.filter((i: any) => i.rule === 'structure.node_length.max');
    expect(hits).toHaveLength(1);
    expect(hits[0].level).toBe('warning');
    expect(hits[0].detail).toBe(`Node too long (${longNode.length} > 30). Split or move to file.`);
    // §35 additive wire: the five pinned section keys — the 'overflow' section
    // left the fixed set with the §16 engine, and no overflow.* rule leaks into
    // another section's group (report.ts normalizers are gone too).
    expect(Object.keys(j.sections)).toEqual(['structure', 'style', 'refs', 'redundancy', 'other']);
    expect(JSON.stringify(j)).not.toContain('overflow');
  });

  test("the issue's see:-pointer workspace (12,000-char artifact) checks clean — non-spec content, no sanctioned alternative budget", () => {
    // The pointer node itself is 22 chars (under max 30) and the artifact is
    // an ordinary repo file: referencing it stays legal (the refs engine only
    // checks the target exists), but nothing measures it against a node budget
    // because it is NOT a spec node — the only way content gets a budget is
    // living in the outline, where node_length binds (previous test).
    const ws = makeWs('artifact-pointer');
    writeFileSync(join(ws.cans, '01-spec.md'), '- Root node\n  - see: artifacts/b.txt\n');
    mkdirSync(join(ws.cans, 'artifacts'), { recursive: true });
    writeFileSync(join(ws.cans, 'artifacts', 'b.txt'), 'x'.repeat(12000));
    writeFileSync(join(ws.cans, '_rules.yaml'), 'structure:\n  node_length: { min: 3, max: 30 }\n');

    const r = runCli(['check', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect(j.exitCode).toBe(0);
    expect(j.refs.broken).toBe(0); // the artifact exists — the ref resolves
    expect(j.summary.files).toBe(1); // the artifact is NOT a spec file
    expect(j.counts.errors).toBe(0);
  });
});

describe('issue #56 — values outside their documented domains reject (line-numbered)', () => {
  // One CLI-level pin per error class (exit-2 config-error wire), then
  // unit-level pins for the full domain table.
  test('CLI: out-of-range number → exit 2, config.invalid, line-numbered diagnosis', () => {
    const ws = makeWs('domain-range');
    writeFileSync(join(ws.cans, '01-alpha.md'), '- Alpha overview hub\n  - Zephyr ledger details\n');
    writeFileSync(join(ws.cans, '_rules.yaml'), 'structure:\n  node_length: { min: 3, max: -5 }\n');

    const r = runCli(['check', '--json'], ws.root);
    expectConfigError(r, 'line 2 — "structure.node_length.max" must be an integer >= 0, got "-5"');
  });

  test('CLI: wrong type → exit 2 (a quoted boolean is a string, not a switch)', () => {
    const ws = makeWs('domain-type');
    writeFileSync(join(ws.cans, '01-alpha.md'), '- Alpha overview hub\n  - Zephyr ledger details\n');
    writeFileSync(join(ws.cans, '_rules.yaml'), 'references:\n  back_pointers: "true"\n');

    const r = runCli(['check', '--json'], ws.root);
    expectConfigError(r, 'line 2 — "references.back_pointers" must be true or false, got "true"');
  });

  test('CLI: relational invariant (min > max) → exit 2, named at the user\'s line', () => {
    const ws = makeWs('domain-relational');
    writeFileSync(join(ws.cans, '01-alpha.md'), '- Alpha overview hub\n  - Zephyr ledger details\n');
    writeFileSync(join(ws.cans, '_rules.yaml'), 'structure:\n  node_length: { min: 5, max: 3 }\n');

    const r = runCli(['check', '--json'], ws.root);
    expectConfigError(r, 'line 2 — "structure.node_length" min must not exceed max (min 5 > max 3)');
  });

  test('unit: the domain table — every documented bound rejects its violations', () => {
    const cases: Array<[string, string]> = [
      // ranges: integer members, 0-based counts, depth 1-based
      ['structure:\n  depth: { min: 0, max: 5 }\n', '"structure.depth.min" must be an integer >= 1, got "0"'],
      ['structure:\n  siblings: { min: 1.5, max: 12 }\n', '"structure.siblings.min" must be an integer >= 0, got "1.5"'],
      // relational: user min above the EFFECTIVE max (unset max keeps 120)
      ['structure:\n  node_length:\n    min: 200\n', '"structure.node_length" min must not exceed max (min 200 > max 120)'],
      // booleans: true/false only — an empty value is out-of-domain (write false, or delete the key)
      ['structure:\n  single_child_collapse:\n', '"structure.single_child_collapse" must be true or false, got null (empty value)'],
      // integers with >= 1 floors (a 0 threshold would flag everything / pair identical words)
      ['references:\n  max_hops: 1.5\n', '"references.max_hops" must be an integer >= 0, got "1.5"'],
      ['redundancy:\n  word_frequency_threshold: 0\n', '"redundancy.word_frequency_threshold" must be an integer >= 1, got "0"'],
      ['redundancy:\n  fuzzy_max_distance: 0\n', '"redundancy.fuzzy_max_distance" must be an integer >= 1, got "0"'],
      ['redundancy:\n  fuzzy_min_word_length: 0\n', '"redundancy.fuzzy_min_word_length" must be an integer >= 1, got "0"'],
      // ratios: strictly positive (0 would flag every pair / warn on every plan)
      ['redundancy:\n  phrase_overlap_threshold: 0\n', '"redundancy.phrase_overlap_threshold" must be a number > 0, got "0"'],
      ['token_budget:\n  warn_threshold: 0\n', '"token_budget.warn_threshold" must be a number > 0, got "0"'],
      ['token_budget:\n  estimate_chars_per_token: 0\n', '"token_budget.estimate_chars_per_token" must be a number > 0, got "0"'],
      // token_budget planning inputs (same domains budget.ts applies, issue #15/#16)
      ['token_budget:\n  default_limit: -1\n', '"token_budget.default_limit" must be an integer >= 0, got "-1"'],
      // list shapes
      ['redundancy:\n  stopwords: [the, [a]]\n', '"redundancy.stopwords" entries must be words, got a list'],
      ['redundancy:\n  synonyms: [flavour, flavor]\n', '"redundancy.synonyms[0]" must be a list of words, got "flavour"'],
      ['redundancy:\n  synonyms:\n', '"redundancy.synonyms" must be a list of synonym groups (like "- [flavour, flavor]" or a head: [words] mapping), got null (empty value)'],
      ['redundancy:\n  synonyms: null\n', '"redundancy.synonyms" must be a list of synonym groups (like "- [flavour, flavor]" or a head: [words] mapping), got null (empty value)'],
      // the slug: documentation section is strings-only
      ['slug:\n  algorithm: 42\n', '"slug.algorithm" must be a string (the slug: section is documentation only), got "42"'],
    ];
    for (const [yaml, message] of cases) {
      const { rules, error } = load(yaml);
      expect(rules).toBeNull();
      expect(error).not.toBeNull();
      expect(error!.message).toContain(message);
      expect(error!.message).toMatch(/line \d+/);
    }
  });
});

describe('issue #56 — the deliberate lenience survives (documented §18 semantics)', () => {
  test('file absent or empty → all defaults, no error', () => {
    const ws = makeWs('empty-file');
    writeFileSync(join(ws.cans, '01-alpha.md'), '- Alpha overview hub\n  - Zephyr ledger details\n');
    writeFileSync(join(ws.cans, '_rules.yaml'), '');

    const r = runCli(['check', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(j.error).toBeUndefined();
    expect('config' in j.sections).toBe(false);
    // defaults ran (structure engine active): the single-child shape warns
    expect(j.counts.warnings).toBeGreaterThanOrEqual(1);

    const commentsOnly = load('# nothing here\n# still nothing\n');
    expect(commentsOnly.error).toBeNull();
    expect(commentsOnly.rules).toEqual(defaultRules());
  });

  test('the published template (slug: section included) is strictly valid', () => {
    const template = readTemplate();
    const { rules, error } = load(template);
    expect(error).toBeNull();
    expect(rules).not.toBeNull();
    // the documentation section never reaches the Rules surface
    expect((rules as unknown as Record<string, unknown>).slug).toBeUndefined();
  });

  test('documented empty-value/null semantics per key stay legal — including the YAML null literals', () => {
    // check keys: null = OFF (issue #2's prefer modulation, §18 thresholds)
    const off = load([
      'style:',
      '  prefer:',
      '  force_nested_above: null',
      '  force_sibling_below: null',
      'token_budget:',
      '  warn_threshold:',
      'redundancy:',
      '  stopwords: null',
      '  word_frequency_threshold: null',
      '',
    ].join('\n'));
    expect(off.error).toBeNull();
    expect(off.rules!.style.prefer).toBeNull(); // no prefer-driven modulation
    expect(off.rules!.style.force_nested_above).toBeNull(); // hint off
    expect(off.rules!.token_budget.warn_threshold).toBeNull(); // warning off
    expect(off.rules!.redundancy.stopwords).toBeNull(); // no stopword filtering
    expect(off.rules!.redundancy.word_frequency_threshold).toBeNull(); // layer off

    // parameters: null = the documented default (mode: pointer; enabled: true).
    // The null marker survives the merge exactly as pre-#56 (issue #2's
    // empty-value convention): consumers treat it as the default — budget.ts
    // proceeds on anything that is not `false`; references.mode is a validated
    // parameter no engine reads.
    const params = load(['references:', '  mode: null', 'token_budget:', '  enabled:', ''].join('\n'));
    expect(params.error).toBeNull();
    expect(params.rules!.references.mode).toBeNull();
    expect(params.rules!.token_budget.enabled).toBeNull();
  });

  test('ratio thresholds above 1 stay legal — the historical never-fires spelling', () => {
    // The issue #3 repro's verbatim config used phrase_overlap_threshold: 1.1
    // as its layer-2 disable; overlap can never exceed 1, so the value is
    // coherent (never fires) and stays in-domain. Only <= 0 rejects.
    const high = load('redundancy:\n  phrase_overlap_threshold: 1.1\n');
    expect(high.error).toBeNull();
    expect(high.rules!.redundancy.phrase_overlap_threshold).toBe(1.1);
  });

  test('the §18 list syntaxes stay legal: inline objects, block lists, numeric entries, map-form synonyms', () => {
    const { rules, error } = load([
      'structure:',
      '  node_length: { min: 3, max: 120 }',
      'redundancy:',
      '  word_frequency_threshold: 4',
      '  stopwords:',
      '    - 10',
      '    - sdk',
      '  synonyms: { vehicle: [car, auto] }',
      '',
    ].join('\n'));
    expect(error).toBeNull();
    expect(rules!.redundancy.stopwords).toEqual(['10', 'sdk']); // issue #42 coercion
    expect(rules!.redundancy.synonyms).toEqual([['vehicle', 'car', 'auto']]); // QA-13 F2 map form
  });
});

/** The shipped template, read from templates/_rules.yaml (cans init output). */
function readTemplate(): string {
  return readFileSync(join(REPO, 'templates', '_rules.yaml'), 'utf-8');
}
