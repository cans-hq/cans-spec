/**
 * Issue #61 (config schema) — `structure.node_length` becomes a granular,
 * composable check, and the dead all-or-nothing config grows a sibling
 * `structure.multiline` policy section. This file pins the CONFIG side only
 * (src/core/rules.ts): parsing, strict §18 validation, and loadRules
 * normalization. The engine (structure.ts) and CLI (check.ts --structure /
 * --structure=strict) semantics are pinned by the sibling issue-61 suites.
 *
 * The granular surface (all members optional — a bare { min, max } keeps
 * parsing and behaving identically to v0.10):
 *   structure.node_length: min / max / unit (chars|words|tokens) /
 *     scope (title|body|total) / strip_references / severity
 *     (error|warn|off)
 *   structure.multiline:    mode (allow|forbid|fold) / max_lines
 *     (integer >= 1, null = no cap) / indent_aligned / severity
 *
 * §18 reconciliation split (the issue #47 convention):
 *   - node_length's four new members are PARAMETERS: deleted/omitted → the
 *     documented default, never flipping the check off;
 *   - structure.multiline is a CHECK SWITCH: absent, deleted, or explicitly
 *     empty (`multiline:` / `multiline: null`) → null → the policy is OFF.
 *
 * Everything invalid — unknown members of either mapping, out-of-domain
 * enums, wrong types, non-integer or < 1 max_lines — is a LINE-NUMBERED
 * config error exactly like every issue #56 key (rule config.invalid on
 * _rules.yaml, exit 2 — one CLI-level pin included here).
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';

import { spawnCli, REPO } from '../runtime.ts';
import { loadRules, defaultRules } from '../../src/core/rules.ts';
import { STRUCTURE_CHARS_PER_TOKEN } from '../../src/types.ts';

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-61-config');

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

/** loadRules that MUST succeed — fails the test on any config error. */
function loadOk(yaml: string): ReturnType<typeof loadRules> {
  const { rules, error } = load(yaml);
  expect(error).toBeNull();
  expect(rules).not.toBeNull();
  return rules!;
}

/** loadRules that MUST fail — returns the (line-numbered) message. */
function loadErr(yaml: string): string {
  const { rules, error } = load(yaml);
  expect(rules).toBeNull();
  expect(error).not.toBeNull();
  expect(error!.message).toMatch(/line \d+/);
  return error!.message;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    rmSync(createdDirs.pop()!, { recursive: true, force: true });
  }
});

/** The issue's proposed granular config, fully spelled out (block form). */
const KITCHEN_SINK = [
  'structure:',
  '  node_length:',
  '    min: 3',
  '    max: 90',
  '    unit: words',
  '    scope: total',
  '    strip_references: true',
  '    severity: error',
  '  multiline:',
  '    mode: fold',
  '    max_lines: 4',
  '    indent_aligned: true',
  '    severity: error',
  '',
].join('\n');

/** A template-shaped v0.10 structure section — all five keys, no multiline. */
const V090_STRUCTURE = [
  'structure:',
  '  node_length: { min: 3, max: 120 }',
  '  siblings: { min: 1, max: 12 }',
  '  depth: { min: 1, max: 5 }',
  '  single_child_collapse: true',
  '  empty_nodes: false',
  '',
].join('\n');

// ── backcompat: the v0.10 surface is unchanged ─────────────────────────────

describe('issue #61 — backcompat: defaults and the bare v0.10 form', () => {
  test('defaultRules carries the granular node_length members and multiline: null', () => {
    expect(defaultRules().structure.node_length).toEqual({
      min: 3,
      max: 120,
      unit: 'chars',
      scope: 'title',
      strip_references: false,
      severity: 'warn',
    });
    // the multiline policy default is OFF — no policy without a section
    expect(defaultRules().structure.multiline).toBeNull();
  });

  test('the bare { min, max } form parses and normalizes with granular defaults filled', () => {
    const r = loadOk('structure:\n  node_length: { min: 5, max: 200 }\n');
    expect(r.structure.node_length).toEqual({
      min: 5,
      max: 200,
      unit: 'chars',
      scope: 'title',
      strip_references: false,
      severity: 'warn',
    });
    expect(r.structure.multiline).toBeNull();
  });

  test('a template-shaped v0.10 structure section loads identical to the defaults', () => {
    // No multiline key anywhere: the section is neither turned on nor an
    // error — the five listed keys reconcile exactly as pre-#61.
    const r = loadOk(V090_STRUCTURE);
    expect(r.structure).toEqual(defaultRules().structure);
  });

  test('STRUCTURE_CHARS_PER_TOKEN === the rules.ts token_budget default (3.5)', () => {
    // The canonical estimate node_length.unit:'tokens' measures with —
    // pinned against the token_budget default so the two can never drift.
    expect(STRUCTURE_CHARS_PER_TOKEN).toBe(defaultRules().token_budget.estimate_chars_per_token);
    expect(STRUCTURE_CHARS_PER_TOKEN).toBe(3.5);
  });
});

// ── every legal value parses and normalizes ────────────────────────────────

describe('issue #61 — every legal value parses and normalizes', () => {
  test('node_length.unit: chars | words | tokens', () => {
    for (const unit of ['chars', 'words', 'tokens'] as const) {
      const r = loadOk(`structure:\n  node_length: { min: 3, max: 90, unit: ${unit} }\n`);
      expect(r.structure.node_length.unit).toBe(unit);
    }
  });

  test('node_length.scope: title | body | total', () => {
    for (const scope of ['title', 'body', 'total'] as const) {
      const r = loadOk(`structure:\n  node_length: { scope: ${scope} }\n`);
      expect(r.structure.node_length.scope).toBe(scope);
    }
  });

  test('node_length.severity: error | warn | off — "off" parses (§18 skip is the engine contract)', () => {
    for (const severity of ['error', 'warn', 'off'] as const) {
      const r = loadOk(`structure:\n  node_length: { min: 3, max: 90, severity: ${severity} }\n`);
      expect(r.structure.node_length.severity).toBe(severity);
    }
  });

  test('node_length.strip_references: true | false', () => {
    const on = loadOk('structure:\n  node_length: { strip_references: true }\n');
    expect(on.structure.node_length.strip_references).toBe(true);
    const off = loadOk('structure:\n  node_length: { strip_references: false }\n');
    expect(off.structure.node_length.strip_references).toBe(false);
  });

  test('multiline.mode: allow | forbid | fold', () => {
    for (const mode of ['allow', 'forbid', 'fold'] as const) {
      const r = loadOk(`structure:\n  multiline: { mode: ${mode} }\n`);
      expect(r.structure.multiline).not.toBeNull();
      expect(r.structure.multiline!.mode).toBe(mode);
    }
  });

  test('multiline.severity: error | warn | off — "off" parses', () => {
    for (const severity of ['error', 'warn', 'off'] as const) {
      const r = loadOk(`structure:\n  multiline: { severity: ${severity} }\n`);
      expect(r.structure.multiline!.severity).toBe(severity);
    }
  });

  test('multiline.indent_aligned: true | false', () => {
    const aligned = loadOk('structure:\n  multiline: { indent_aligned: true }\n');
    expect(aligned.structure.multiline!.indent_aligned).toBe(true);
    const loose = loadOk('structure:\n  multiline: { indent_aligned: false }\n');
    expect(loose.structure.multiline!.indent_aligned).toBe(false);
  });

  test('multiline.max_lines: any integer >= 1 (boundary values 1 and 99)', () => {
    const one = loadOk('structure:\n  multiline: { max_lines: 1 }\n');
    expect(one.structure.multiline!.max_lines).toBe(1);
    const big = loadOk('structure:\n  multiline: { max_lines: 99 }\n');
    expect(big.structure.multiline!.max_lines).toBe(99);
  });

  test('multiline.max_lines: null via empty value and the YAML null literals → no cap', () => {
    // The nullOk MEMBER: deleted/empty/null all mean "no ceiling", the
    // documented default — never a config error (issue #56 literals).
    const spellings = ['max_lines:', 'max_lines: null', 'max_lines: ~'];
    for (const maxLines of spellings) {
      const r = loadOk(`structure:\n  multiline:\n    mode: forbid\n    ${maxLines}\n`);
      expect(r.structure.multiline).toEqual({
        mode: 'forbid',
        max_lines: null,
        indent_aligned: false,
        severity: 'warn',
      });
    }
  });

  test('quoted enum spellings parse (the YAML scalar unwraps the quotes)', () => {
    const r = loadOk([
      'structure:',
      '  node_length: { min: 3, max: 90, unit: "words", severity: \'off\' }',
      '  multiline: { mode: "fold" }',
      '',
    ].join('\n'));
    expect(r.structure.node_length.unit).toBe('words');
    expect(r.structure.node_length.severity).toBe('off');
    expect(r.structure.multiline!.mode).toBe('fold');
  });

  test('empty inline mappings are PRESENT (on) sections with every default', () => {
    // `node_length: {}` is a listed key whose members all keep defaults —
    // the same semantics `siblings: {}` has had since v0.10.
    const r = loadOk('structure:\n  node_length: {}\n  multiline: {}\n');
    expect(r.structure.node_length).toEqual(defaultRules().structure.node_length);
    expect(r.structure.multiline).toEqual({
      mode: 'allow',
      max_lines: null,
      indent_aligned: false,
      severity: 'warn',
    });
  });

  test('a partial multiline section carries all four members after normalization', () => {
    const r = loadOk('structure:\n  multiline:\n    mode: forbid\n');
    expect(r.structure.multiline).toEqual({
      mode: 'forbid',
      max_lines: null,
      indent_aligned: false,
      severity: 'warn',
    });
  });

  test('the kitchen-sink config round-trips every granular value (block form)', () => {
    const r = loadOk(KITCHEN_SINK);
    expect(r.structure.node_length).toEqual({
      min: 3,
      max: 90,
      unit: 'words',
      scope: 'total',
      strip_references: true,
      severity: 'error',
    });
    expect(r.structure.multiline).toEqual({
      mode: 'fold',
      max_lines: 4,
      indent_aligned: true,
      severity: 'error',
    });
  });

  test('inline form normalizes identically to block form', () => {
    const inline = loadOk([
      'structure:',
      '  node_length: { min: 3, max: 90, unit: words, scope: total, strip_references: true, severity: error }',
      '  multiline: { mode: fold, max_lines: 4, indent_aligned: true, severity: error }',
      '',
    ].join('\n'));
    const block = loadOk(KITCHEN_SINK);
    expect(inline.structure.node_length).toEqual(block.structure.node_length);
    expect(inline.structure.multiline).toEqual(block.structure.multiline);
  });

  test('node_length with ONLY granular members keeps the default bounds (§18 members)', () => {
    // Omitting min/max inside a listed node_length is not deleting the
    // check — members of a present mapping keep their defaults, exactly
    // like `node_length: { min: 200 }` kept max 120 pre-#61.
    const r = loadOk('structure:\n  node_length:\n    unit: words\n');
    expect(r.structure.node_length.min).toBe(3);
    expect(r.structure.node_length.max).toBe(120);
    expect(r.structure.node_length.unit).toBe('words');
  });
});

// ── invalid values are line-numbered config errors ─────────────────────────

describe('issue #61 — invalid values reject with line numbers (issue #56 discipline)', () => {
  // Flagship pins assert the FULL message (exact line number, path,
  // expectation and got-value); the table pins the message fragment plus
  // the line-number shape, like issue #56's domain table.
  test('block-form member errors carry the member\'s OWN line', () => {
    expect(loadErr('structure:\n  node_length:\n    unit: wordss\n')).toBe(
      'line 3 — "structure.node_length.unit" must be "chars" or "words" or "tokens", got "wordss"',
    );
  });

  test('inline-object member errors carry the key\'s line (parseYamlTracked)', () => {
    expect(loadErr('structure:\n  node_length: { min: 3, unit: wordss }\n')).toBe(
      'line 2 — "structure.node_length.unit" must be "chars" or "words" or "tokens", got "wordss"',
    );
  });

  test('unknown members of either mapping are unrecognized keys', () => {
    expect(loadErr('structure:\n  node_length: { min: 3, word_count: 12 }\n')).toBe(
      'line 2 — unrecognized key "structure.node_length.word_count" ' +
        '(issue #56: _rules.yaml is validated strictly — §18 documents the legal keys)',
    );
    expect(loadErr('structure:\n  multiline:\n    max_line: 4\n')).toBe(
      'line 3 — unrecognized key "structure.multiline.max_line" ' +
        '(issue #56: _rules.yaml is validated strictly — §18 documents the legal keys)',
    );
  });

  test('an explicit empty multiline keeps the §18 shape error for non-mappings', () => {
    expect(loadErr('structure:\n  multiline: allow\n')).toBe(
      'line 2 — "structure.multiline" must be ' +
        'a mapping like { mode: allow, max_lines: 4, indent_aligned: true, severity: warn }, got "allow"',
    );
  });

  test('max_lines below 1 names the domain and the line', () => {
    expect(loadErr('structure:\n  multiline:\n    max_lines: 0\n')).toBe(
      'line 3 — "structure.multiline.max_lines" must be an integer >= 1 (or null for no cap), got "0"',
    );
  });

  test('the full domain table — every documented bound rejects its violations', () => {
    const cases: Array<[string, string]> = [
      // node_length enums / booleans
      ['structure:\n  node_length: { scope: headline }\n', '"structure.node_length.scope" must be "title" or "body" or "total", got "headline"'],
      ['structure:\n  node_length:\n    severity: fatal\n', '"structure.node_length.severity" must be "error" or "warn" or "off", got "fatal"'],
      ['structure:\n  multiline: { severity: silent }\n', '"structure.multiline.severity" must be "error" or "warn" or "off", got "silent"'],
      ['structure:\n  node_length: { strip_references: "yes" }\n', '"structure.node_length.strip_references" must be true or false, got "yes"'],
      ['structure:\n  multiline: { indent_aligned: 1 }\n', '"structure.multiline.indent_aligned" must be true or false, got "1"'],
      // an explicit EMPTY parameter value is a typo, not a documented state
      ['structure:\n  node_length:\n    strip_references:\n', '"structure.node_length.strip_references" must be true or false, got null (empty value)'],
      ['structure:\n  node_length:\n    unit:\n', '"structure.node_length.unit" must be "chars" or "words" or "tokens", got null (empty value)'],
      // multiline enums / max_lines domain
      ['structure:\n  multiline: { mode: folded }\n', '"structure.multiline.mode" must be "allow" or "forbid" or "fold", got "folded"'],
      ['structure:\n  multiline:\n    max_lines: -1\n', '"structure.multiline.max_lines" must be an integer >= 1 (or null for no cap), got "-1"'],
      ['structure:\n  multiline:\n    max_lines: 1.5\n', '"structure.multiline.max_lines" must be an integer >= 1 (or null for no cap), got "1.5"'],
      ['structure:\n  multiline:\n    max_lines: four\n', '"structure.multiline.max_lines" must be an integer >= 1 (or null for no cap), got "four"'],
      // unknown members (typo discipline)
      ['structure:\n  multiline: { severety: error }\n', 'unrecognized key "structure.multiline.severety"'],
      ['structure:\n  node_length: { min: 3, lenght_unit: chars }\n', 'unrecognized key "structure.node_length.lenght_unit"'],
      // shape discipline
      ['structure:\n  node_length: [3, 120]\n', '"structure.node_length" must be a mapping like { min: 3, max: 120 }, got a list'],
      ['structure:\n  multiline: [allow]\n', '"structure.multiline" must be a mapping like { mode: allow, max_lines: 4, indent_aligned: true, severity: warn }, got a list'],
      // the v0.10 range-member discipline is unchanged inside the granular block
      ['structure:\n  node_length: { min: -1 }\n', '"structure.node_length.min" must be an integer >= 0, got "-1"'],
      ['structure:\n  node_length: { max: 2.5 }\n', '"structure.node_length.max" must be an integer >= 0, got "2.5"'],
      // the relational invariant fires with granular members present too
      ['structure:\n  node_length: { min: 5, max: 3, unit: words }\n', '"structure.node_length" min must not exceed max (min 5 > max 3)'],
    ];
    for (const [yaml, message] of cases) {
      expect(loadErr(yaml)).toContain(message);
    }
  });

  test('an explicit empty node_length still rejects exactly as v0.10 (not newly nullOk)', () => {
    // The whole-check off-switch stays the DELETED key / { min: null,
    // max: null } encoding — `node_length:` with nothing under it remains
    // out-of-domain, byte-identical to the pre-#61 message.
    expect(loadErr('structure:\n  node_length:\n')).toBe(
      'line 2 — "structure.node_length" must be a mapping like { min: 3, max: 120 }, got null (empty value)',
    );
  });
});

// ── §18 delete/override reconciliation ─────────────────────────────────────

describe('issue #61 — §18 delete/override reconciliation', () => {
  test('multiline absent from a listed structure section → null → policy OFF', () => {
    const r = loadOk(V090_STRUCTURE);
    expect(r.structure.multiline).toBeNull();
  });

  test('multiline absent entirely (sparse file without a structure section) → null', () => {
    const r = loadOk('redundancy:\n  enabled: false\n');
    expect(r.structure.multiline).toBeNull();
    // and the structure defaults are untouched by the new section
    expect(r.structure.node_length.unit).toBe('chars');
  });

  test('explicit empty `multiline:` → null — the documented OFF, not a defaults-filled block', () => {
    // Contrast references.aliasing (issue #57): a PARAMETER block whose
    // empty value keeps defaults. multiline is a CHECK switch — empty IS off.
    const r = loadOk('structure:\n  node_length: { min: 3, max: 120 }\n  multiline:\n');
    expect(r.structure.multiline).toBeNull();
  });

  test('the YAML null literals spell the same OFF: `multiline: null` / `multiline: ~`', () => {
    for (const spelling of ['null', '~', 'Null', 'NULL']) {
      const r = loadOk(`structure:\n  multiline: ${spelling}\n`);
      expect(r.structure.multiline).toBeNull();
    }
  });

  test('a deleted node_length (template-shaped file) → OFF range with the granular parameters defaulted', () => {
    // node_length omitted from the five-key template shape → the check is
    // OFF ({min:null,max:null}); its four PARAMETERS survive the delete
    // pass with defaults so the normalized surface stays complete.
    const r = loadOk([
      'structure:',
      '  siblings: { min: 1, max: 12 }',
      '  depth: { min: 1, max: 5 }',
      '  single_child_collapse: true',
      '  empty_nodes: false',
      '',
    ].join('\n'));
    expect(r.structure.node_length).toEqual({
      min: null,
      max: null,
      unit: 'chars',
      scope: 'title',
      strip_references: false,
      severity: 'warn',
    });
    expect(r.structure.multiline).toBeNull();
  });

  test('a deleted `unit` (and every other granular member) keeps its documented default', () => {
    // The §18 parameter rule: inside a listed node_length, omitted members
    // are defaults — they never read as "check off" and never error.
    const r = loadOk('structure:\n  node_length: { min: 3, max: 90 }\n');
    expect(r.structure.node_length.unit).toBe('chars');
    expect(r.structure.node_length.scope).toBe('title');
    expect(r.structure.node_length.strip_references).toBe(false);
    expect(r.structure.node_length.severity).toBe('warn');
  });

  test('a deleted whole structure section (delete-mode via a complete sibling) → node_length OFF, multiline null', () => {
    const r = loadOk([
      'style:',
      '  prefer: sibling',
      '  force_nested_above: 6',
      '  force_sibling_below: 3',
      '  shared_prefix_detection: true',
      '',
    ].join('\n'));
    expect(r.structure.node_length).toEqual({
      min: null,
      max: null,
      unit: 'chars',
      scope: 'title',
      strip_references: false,
      severity: 'warn',
    });
    expect(r.structure.multiline).toBeNull();
    expect(r.structure.single_child_collapse).toBe(false); // whole section off, as pre-#61
  });

  test('listing multiline changes nothing about the OTHER structure keys (delete-mode untouched)', () => {
    // structure is listed → delete-mode: the unlisted v0.10 keys are OFF
    // exactly as before — the new section joins the section without
    // altering its reconciliation for files that list it.
    const r = loadOk([
      'structure:',
      '  node_length: { min: 3, max: 120 }',
      '  multiline: { mode: forbid, max_lines: 2 }',
      '',
    ].join('\n'));
    expect(r.structure.multiline).toEqual({
      mode: 'forbid',
      max_lines: 2,
      indent_aligned: false,
      severity: 'warn',
    });
    expect(r.structure.siblings.max).toBeNull();
    expect(r.structure.depth.max).toBeNull();
    expect(r.structure.single_child_collapse).toBe(false);
    expect(r.structure.empty_nodes).toBe(false);
  });
});

// ── the shipped template ───────────────────────────────────────────────────

describe('issue #61 — the shipped template parses cleanly under the strict validator', () => {
  test('templates/_rules.yaml (cans init output) loads with a fully normalized node_length', () => {
    const template = readFileSync(join(REPO, 'templates', '_rules.yaml'), 'utf-8');
    const r = loadOk(template);
    // the template's v0.10 node_length gains the granular defaults —
    // nothing else about the shipped file may change
    expect(r.structure.node_length).toEqual({
      min: 3,
      max: 120,
      unit: 'chars',
      scope: 'title',
      strip_references: false,
      severity: 'warn',
    });
    // The template is integration-owned and may grow a DOCUMENTED multiline
    // block (the external_roots/aliasing precedent). Either way this must
    // hold: the section is OFF (null) or a complete four-member mapping —
    // never a half-normalized object.
    const ml = r.structure.multiline;
    if (ml !== null && ml !== undefined) {
      // (typing: !-assertions are themselves part of the pin — normalization
      // guarantees all four members on any present multiline mapping)
      expect(Object.keys(ml).sort()).toEqual(['indent_aligned', 'max_lines', 'mode', 'severity']);
      expect(['allow', 'forbid', 'fold']).toContain(ml.mode!);
      expect(['error', 'warn', 'off']).toContain(ml.severity!);
      const cap = ml.max_lines!;
      expect(cap === null || (Number.isInteger(cap) && cap >= 1)).toBe(true);
      expect(typeof ml.indent_aligned).toBe('boolean');
    }
  });
});

// ── CLI end-to-end: the issue #43 config-error wire ────────────────────────

describe('issue #61 — CLI: a granular domain error rides the config wire', () => {
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

  test('unit: wordss → exit 2, config.invalid on _rules.yaml, line-numbered diagnosis', () => {
    const root = join(SCRATCH, `cli-${++seq}`);
    mkdirSync(join(root, 'cans'), { recursive: true });
    createdDirs.push(root);
    writeFileSync(join(root, 'cans', '01-alpha.md'), '- Alpha overview hub\n  - Zephyr ledger details\n');
    writeFileSync(
      join(root, 'cans', '_rules.yaml'),
      ['structure:', '  node_length:', '    unit: wordss', ''].join('\n'),
    );

    const r = runCli(['check', '--json'], root);
    // The issue #43 contract, end to end — same envelope every issue #56
    // domain error produces, carrying the #61 key's line number.
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(false);
    expect(j.error).toBe(
      'invalid _rules.yaml: line 3 — "structure.node_length.unit" must be "chars" or "words" or "tokens", got "wordss"',
    );
    expect(j.sections.config).toHaveLength(1);
    expect(j.sections.config[0]).toEqual({
      file: '_rules.yaml',
      line: 0,
      level: 'error',
      rule: 'config.invalid',
      detail:
        'invalid _rules.yaml: line 3 — "structure.node_length.unit" must be "chars" or "words" or "tokens", got "wordss"',
    });
    expect(j.summary.files).toBe(0); // the engines never ran
  });
});
