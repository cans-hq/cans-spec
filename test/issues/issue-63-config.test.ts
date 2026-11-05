/**
 * Issue #63 (config half) — strict §18 validation of `agent_guardrails`, the
 * workspace-only agent execution policy block (the engine half lives in
 * src/core/guardrails.ts + src/commands/check.ts and is pinned by the sibling
 * issue-63 engine suites).
 *
 * Contract (src/core/rules.ts at base 49b9feb): `agent_guardrails` is a NEW
 * top-level PARAMETER section in RULES_SCHEMA — never in CHECK_SECTIONS, so
 * never in SECTION_KEYS and never a participant in the delete/override
 * reconciliation (pre-#63 configs reconcile byte-identically). Members:
 *   enabled (boolean) / severity (exactly 'error' | 'warn' — NOT #62's
 *   per-entry 'warning' spelling) / isolation (guardIsolation: mode
 *   'require-target-prefix' | 'off' + prefix) / manifests (guardManifests:
 *   atomic_writes_only + protected) / devlog (guardDevlog: enabled, path,
 *   required_sections) / negative_invariants (guardInvariants: required +
 *   anchor). Every block rejects unknown members under the issue #56 typo
 *   discipline, and every member error carries the member's own tracked line.
 * Paths shared by isolation.prefix / devlog.path / manifests.protected go
 * through validateWorkspaceRelativePath: non-empty, POSIX, no leading '/',
 * no '..' segment, no '\'.
 *
 * NULL_OK_SECTIONS = new Set(['agent_guardrails']): an explicit EMPTY section
 * (`agent_guardrails:` with nothing under it, parsed as null) and the
 * explicit `agent_guardrails: null` scalar are both legal = the documented
 * OFF state; loadRules deep-merges the null over the defaults so
 * Rules.agent_guardrails === null (engine silent). A partial block
 * deep-merges every omitted member to defaultAgentGuardrails().
 *
 * Pins:
 *   - the issue's full RFC example block loads to exactly those values;
 *   - partial blocks deep-merge to the documented defaults; custom legal
 *     values round-trip (validation is not defaults-only);
 *   - both OFF spellings (explicitly empty / explicit null) load to null;
 *   - EVERY rejection with the exact message and line number — the §18
 *     line-numbered shapes the rest of the toolchain re-uses verbatim;
 *   - reconciliation neutrality: listing agent_guardrails never curates a
 *     check section (the external_roots #55 / aliasing #57 /
 *     forbidden_targets #62 convention);
 *   - pre-#63 compatibility: defaultRules() ships the inert block
 *     (enabled: false) and a workspace without the section loads it too;
 *   - `cans init` output (templates/_rules.yaml) is strictly valid.
 *
 * Levels: engine unit (loadRules throws with the line number) and one CLI
 * blackbox pin (exit 2, --json sections.config envelope, the issue #43/#56
 * scaffolding).
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';

import { spawnCli, REPO } from '../runtime.ts';
import { loadRules, defaultRules, defaultAgentGuardrails } from '../../src/core/rules.ts';

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-63-config');

const createdDirs: string[] = [];
let wsSeq = 0;

/** Fresh scratch workspace under repo/.tmp/issues/issue-63-config (gitignored). */
function makeWs(name: string): { root: string; cans: string } {
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

/** The issue's full RFC example block — every member spelled, block form so
 *  every member carries its own tracked line. Lines: 1 agent_guardrails,
 *  2 enabled, 3 severity, 4 isolation, 5 mode, 6 prefix, 7 manifests,
 *  8 atomic_writes_only, 9 protected, 10-12 the three manifest paths,
 *  13 devlog, 14 enabled, 15 path, 16 required_sections, 17-19 the three
 *  section names, 20 negative_invariants, 21 required, 22 anchor. */
const RFC_BLOCK = [
  'agent_guardrails:',
  '  enabled: true',
  '  severity: error',
  '  isolation:',
  '    mode: require-target-prefix',
  '    prefix: "target/agent-"',
  '  manifests:',
  '    atomic_writes_only: true',
  '    protected:',
  '      - Cargo.toml',
  '      - package.json',
  '      - pyproject.toml',
  '  devlog:',
  '    enabled: true',
  '    path: "log/devlog.md"',
  '    required_sections:',
  '      - touched_files',
  '      - test_outcomes',
  '      - still_open',
  '  negative_invariants:',
  '    required: true',
  '    anchor: "Negative Invariants"',
  '',
].join('\n');

/** The RFC example as a Rules value, spelled literally (the pin is against
 *  the DOCUMENTED values, not against defaultAgentGuardrails() — one test
 *  below additionally pins defaultAgentGuardrails() to this literal). */
const RFC_VALUE = {
  enabled: true,
  severity: 'error' as const,
  isolation: { mode: 'require-target-prefix' as const, prefix: 'target/agent-' },
  manifests: {
    atomic_writes_only: true,
    protected: ['Cargo.toml', 'package.json', 'pyproject.toml'],
  },
  devlog: {
    enabled: true,
    path: 'log/devlog.md',
    required_sections: ['touched_files', 'test_outcomes', 'still_open'],
  },
  negative_invariants: { required: true, anchor: 'Negative Invariants' },
};

// ── legal shapes: the RFC block, deep-merge, custom values ─────────────────

describe('issue #63 config — the RFC example block loads to exactly its values', () => {
  test('the full RFC block loads verbatim: every member present, nothing defaulted away', () => {
    const rules = loadOk(RFC_BLOCK);
    expect(rules.agent_guardrails).toEqual(RFC_VALUE);
  });

  test('defaultAgentGuardrails() IS the RFC example with the engine off (the documented defaults, pinned literally)', () => {
    expect(defaultAgentGuardrails()).toEqual({
      enabled: false,
      severity: 'error',
      isolation: { mode: 'off', prefix: 'target/agent-' },
      manifests: {
        atomic_writes_only: true,
        protected: ['Cargo.toml', 'package.json', 'pyproject.toml'],
      },
      devlog: {
        enabled: true,
        path: 'log/devlog.md',
        required_sections: ['touched_files', 'test_outcomes', 'still_open'],
      },
      negative_invariants: { required: true, anchor: 'Negative Invariants' },
    });
    expect(defaultAgentGuardrails().enabled).toBe(false); // inert by construction
  });

  test('both legal severity spellings load ("error" and "warn" — the §63 scale, not #62\'s "warning")', () => {
    const warn = loadOk('agent_guardrails:\n  severity: warn\n');
    expect(warn.agent_guardrails!.severity).toBe('warn');
    const error = loadOk('agent_guardrails:\n  severity: error\n');
    expect(error.agent_guardrails!.severity).toBe('error');
  });

  test('custom legal values round-trip — validation is in-domain, not defaults-only', () => {
    const rules = loadOk(
      [
        'agent_guardrails:',
        '  enabled: true',
        '  severity: warn',
        '  isolation:',
        '    mode: require-target-prefix',
        '    prefix: "build/agents/wip-"',
        '  manifests:',
        '    atomic_writes_only: false',
        '    protected:',
        '      - bun.lock',
        '      - Cargo.lock',
        '  devlog:',
        '    enabled: false',
        '    path: "notes/agent-handoff.md"',
        '    required_sections:',
        '      - summary',
        '  negative_invariants:',
        '    required: false',
        '    anchor: "Banned Patterns"',
        '',
      ].join('\n'),
    );
    expect(rules.agent_guardrails).toEqual({
      enabled: true,
      severity: 'warn',
      isolation: { mode: 'require-target-prefix', prefix: 'build/agents/wip-' },
      manifests: { atomic_writes_only: false, protected: ['bun.lock', 'Cargo.lock'] },
      devlog: { enabled: false, path: 'notes/agent-handoff.md', required_sections: ['summary'] },
      negative_invariants: { required: false, anchor: 'Banned Patterns' },
    });
  });

  test('inline-object forms stay legal (§18 inline convention) and validate identically', () => {
    const rules = loadOk('agent_guardrails: { enabled: true, severity: warn }\n');
    expect(rules.agent_guardrails!.enabled).toBe(true);
    expect(rules.agent_guardrails!.severity).toBe('warn');
    // omitted block members still deep-merge through the inline form
    expect(rules.agent_guardrails!.isolation).toEqual(defaultAgentGuardrails().isolation);
  });
});

describe('issue #63 config — partial blocks deep-merge to defaultAgentGuardrails()', () => {
  test('only `enabled: true` — every omitted member lands on the documented default', () => {
    const rules = loadOk('agent_guardrails:\n  enabled: true\n');
    expect(rules.agent_guardrails).toEqual({ ...defaultAgentGuardrails(), enabled: true });
    // and the defaults themselves are the documented ones (RFC minus the switch)
    expect(rules.agent_guardrails!.isolation).toEqual({ mode: 'off', prefix: 'target/agent-' });
    expect(rules.agent_guardrails!.manifests).toEqual({
      atomic_writes_only: true,
      protected: ['Cargo.toml', 'package.json', 'pyproject.toml'],
    });
    expect(rules.agent_guardrails!.devlog).toEqual({
      enabled: true,
      path: 'log/devlog.md',
      required_sections: ['touched_files', 'test_outcomes', 'still_open'],
    });
    expect(rules.agent_guardrails!.negative_invariants).toEqual({
      required: true,
      anchor: 'Negative Invariants',
    });
  });

  test('a partial sub-block merges member-wise: isolation.mode set, prefix keeps its default', () => {
    const rules = loadOk('agent_guardrails:\n  isolation:\n    mode: require-target-prefix\n');
    expect(rules.agent_guardrails!.isolation).toEqual({
      mode: 'require-target-prefix',
      prefix: 'target/agent-',
    });
  });

  test('each remaining sub-block merges member-wise too', () => {
    const rules = loadOk(
      [
        'agent_guardrails:',
        '  manifests:',
        '    protected:',
        '      - deno.lock',
        '  devlog:',
        '    path: "log/handoff.md"',
        '  negative_invariants:',
        '    anchor: "Never Do"',
        '',
      ].join('\n'),
    );
    const d = defaultAgentGuardrails();
    expect(rules.agent_guardrails!.manifests).toEqual({ ...d.manifests, protected: ['deno.lock'] });
    expect(rules.agent_guardrails!.devlog).toEqual({ ...d.devlog, path: 'log/handoff.md' });
    expect(rules.agent_guardrails!.negative_invariants).toEqual({ ...d.negative_invariants, anchor: 'Never Do' });
    // sibling blocks the file never mentioned keep the full default
    expect(rules.agent_guardrails!.isolation).toEqual(d.isolation);
    expect(rules.agent_guardrails!.enabled).toBe(false);
    expect(rules.agent_guardrails!.severity).toBe('error');
  });
});

// ── the OFF states: NULL_OK_SECTIONS — explicitly empty / null → null ──────

describe('issue #63 config — the documented OFF states: explicitly empty and explicit null → null', () => {
  test('explicit empty (`agent_guardrails:` with nothing under it) → agent_guardrails === null, no error', () => {
    const rules = loadOk('agent_guardrails:\n');
    expect(rules.agent_guardrails).toBeNull();
    // every other section stays at its default — the null merges over, nothing else moves
    const dr = defaultRules();
    expect(rules.structure).toEqual(dr.structure);
    expect(rules.references).toEqual(dr.references);
    expect(rules.output).toEqual(dr.output);
  });

  test('explicit null scalar (`agent_guardrails: null`) → agent_guardrails === null, no error', () => {
    const rules = loadOk('agent_guardrails: null\n');
    expect(rules.agent_guardrails).toBeNull();
  });

  test('both OFF spellings alongside other config: the rest of the file still applies', () => {
    const rules = loadOk('structure:\n  depth: { min: 1, max: 3 }\nagent_guardrails:\n');
    expect(rules.agent_guardrails).toBeNull();
    expect(rules.structure.depth).toEqual({ min: 1, max: 3 });
  });
});

// ── rejections: unknown members under the issue #56 typo discipline ────────

describe('issue #63 config — unknown members reject (issue #56 typo discipline, line-numbered)', () => {
  const SUFFIX = ' (issue #56: _rules.yaml is validated strictly — §18 documents the legal keys)';

  test('section-level typo `enabld` rejects, named with its own line', () => {
    // Lines: 1 agent_guardrails, 2 the typo.
    expect(loadErr('agent_guardrails:\n  enabld: true\n')).toBe(
      'line 2 — unrecognized key "agent_guardrails.enabld"' + SUFFIX,
    );
  });

  test('section-level typo `severety` rejects too — a typo\'d severity must never read as the default', () => {
    expect(loadErr('agent_guardrails:\n  severety: warn\n')).toBe(
      'line 2 — unrecognized key "agent_guardrails.severety"' + SUFFIX,
    );
  });

  test('unknown member inside isolation (`prefx`) rejects at its own line', () => {
    // Lines: 1 section, 2 isolation, 3 mode, 4 the typo.
    expect(loadErr('agent_guardrails:\n  isolation:\n    mode: off\n    prefx: x\n')).toBe(
      'line 4 — unrecognized key "agent_guardrails.isolation.prefx"' + SUFFIX,
    );
  });

  test('unknown member inside manifests (`prottected`) rejects at its own line', () => {
    expect(loadErr('agent_guardrails:\n  manifests:\n    prottected: [Cargo.toml]\n')).toBe(
      'line 3 — unrecognized key "agent_guardrails.manifests.prottected"' + SUFFIX,
    );
  });

  test('unknown member inside devlog (`paths`) rejects at its own line', () => {
    expect(loadErr('agent_guardrails:\n  devlog:\n    paths: log/devlog.md\n')).toBe(
      'line 3 — unrecognized key "agent_guardrails.devlog.paths"' + SUFFIX,
    );
  });

  test('unknown member inside negative_invariants (`reqired`) rejects at its own line', () => {
    expect(loadErr('agent_guardrails:\n  negative_invariants:\n    reqired: true\n')).toBe(
      'line 3 — unrecognized key "agent_guardrails.negative_invariants.reqired"' + SUFFIX,
    );
  });

  test('unknown members in DIFFERENT blocks each report at their own line (first offender wins)', () => {
    // Lines: 2 isolation (ok), 4 manifests typo — the walk hits isolation's
    // valid members first, then manifests' typo at line 4.
    expect(
      loadErr('agent_guardrails:\n  isolation:\n    mode: off\n  manifests:\n    prottected: [x]\n'),
    ).toBe('line 5 — unrecognized key "agent_guardrails.manifests.prottected"' + SUFFIX);
  });
});

// ── rejections: the severity enum is exactly 'error' | 'warn' ──────────────

describe('issue #63 config — severity members are exactly "error" | "warn" ("warning" rejects)', () => {
  test("severity: 'warning' REJECTS — deliberate pin: the §63 section scale differs from #62's per-entry spelling", () => {
    // #62's forbidden_targets entries spell 'error' | 'warning'; the #63
    // section-level severity spells 'error' | 'warn' (the structure.severity
    // convention minus 'off' — an off guardrails block is `enabled: false`).
    expect(loadErr('agent_guardrails:\n  severity: warning\n')).toBe(
      'line 2 — "agent_guardrails.severity" must be "error" or "warn", got "warning"',
    );
  });

  test("severity: 'off' rejects too — the OFF state is spelled `enabled: false`, never a severity", () => {
    expect(loadErr('agent_guardrails:\n  severity: off\n')).toBe(
      'line 2 — "agent_guardrails.severity" must be "error" or "warn", got "off"',
    );
  });

  test('non-string severity (number) rejects with the got-value convention', () => {
    expect(loadErr('agent_guardrails:\n  severity: 3\n')).toBe(
      'line 2 — "agent_guardrails.severity" must be "error" or "warn", got "3"',
    );
  });

  test('an explicit empty severity (null) is out-of-domain — the enum has no empty meaning', () => {
    expect(loadErr('agent_guardrails:\n  severity:\n')).toBe(
      'line 2 — "agent_guardrails.severity" must be "error" or "warn", got null (empty value)',
    );
  });
});

// ── rejections: scalars, section shape, and every block's domain ───────────

describe('issue #63 config — scalar domains and section shape reject line-numbered', () => {
  test('enabled: non-boolean rejects with the boolean expectation', () => {
    expect(loadErr('agent_guardrails:\n  enabled: yes\n')).toBe(
      'line 2 — "agent_guardrails.enabled" must be true or false, got "yes"',
    );
    expect(loadErr('agent_guardrails:\n  enabled: 1\n')).toBe(
      'line 2 — "agent_guardrails.enabled" must be true or false, got "1"',
    );
  });

  test('enabled: explicit empty (null) rejects — an empty value is a typo, not a documented state', () => {
    expect(loadErr('agent_guardrails:\n  enabled:\n')).toBe(
      'line 2 — "agent_guardrails.enabled" must be true or false, got null (empty value)',
    );
  });

  test('section value non-mapping rejects with the §18 shape error (typeof naming at the top level)', () => {
    // The section-level shape check names the value's TYPE (boolean/string/
    // number), unlike the leaf got-value convention — confirmed and pinned.
    expect(loadErr('agent_guardrails: true\n')).toBe(
      'line 1 — "agent_guardrails" must be a mapping, got boolean',
    );
    expect(loadErr('agent_guardrails: banana\n')).toBe(
      'line 1 — "agent_guardrails" must be a mapping, got string',
    );
    expect(loadErr('agent_guardrails: 42\n')).toBe(
      'line 1 — "agent_guardrails" must be a mapping, got number',
    );
    expect(loadErr('agent_guardrails:\n  - a\n')).toBe(
      'line 1 — "agent_guardrails" must be a mapping, got a list',
    );
  });
});

describe('issue #63 config — isolation block: shape and domain rejections', () => {
  test('non-mapping isolation rejects with the block expectation spelled once', () => {
    expect(loadErr('agent_guardrails:\n  isolation: banana\n')).toBe(
      'line 2 — "agent_guardrails.isolation" must be a mapping like ' +
        '{ mode: require-target-prefix, prefix: "target/agent-" }, got "banana"',
    );
    expect(loadErr('agent_guardrails:\n  isolation: 7\n')).toBe(
      'line 2 — "agent_guardrails.isolation" must be a mapping like ' +
        '{ mode: require-target-prefix, prefix: "target/agent-" }, got "7"',
    );
  });

  test('an explicit empty isolation member (null) is out-of-domain — only the SECTION is null-ok', () => {
    expect(loadErr('agent_guardrails:\n  isolation:\n')).toBe(
      'line 2 — "agent_guardrails.isolation" must be a mapping like ' +
        '{ mode: require-target-prefix, prefix: "target/agent-" }, got null (empty value)',
    );
  });

  test("mode: 'required-target-prefix' (the near-miss spelling) rejects with the member set", () => {
    expect(loadErr('agent_guardrails:\n  isolation:\n    mode: required-target-prefix\n')).toBe(
      'line 3 — "agent_guardrails.isolation.mode" must be "require-target-prefix" or "off", ' +
        'got "required-target-prefix"',
    );
  });

  test("mode: 'on' / mode: true reject — the switch spellings are exactly 'require-target-prefix' | 'off'", () => {
    expect(loadErr('agent_guardrails:\n  isolation:\n    mode: on\n')).toBe(
      'line 3 — "agent_guardrails.isolation.mode" must be "require-target-prefix" or "off", got "on"',
    );
    expect(loadErr('agent_guardrails:\n  isolation:\n    mode: true\n')).toBe(
      'line 3 — "agent_guardrails.isolation.mode" must be "require-target-prefix" or "off", got "true"',
    );
  });

  test('an explicit empty mode (null) rejects', () => {
    expect(loadErr('agent_guardrails:\n  isolation:\n    mode:\n')).toBe(
      'line 3 — "agent_guardrails.isolation.mode" must be "require-target-prefix" or "off", ' +
        'got null (empty value)',
    );
  });
});

describe('issue #63 config — manifests block: shape and domain rejections', () => {
  test('non-mapping manifests rejects with the block expectation', () => {
    expect(loadErr('agent_guardrails:\n  manifests: 7\n')).toBe(
      'line 2 — "agent_guardrails.manifests" must be a mapping like ' +
        '{ atomic_writes_only: true, protected: [package.json] }, got "7"',
    );
  });

  test('atomic_writes_only: non-boolean and explicit empty reject', () => {
    expect(loadErr('agent_guardrails:\n  manifests:\n    atomic_writes_only: "true"\n')).toBe(
      'line 3 — "agent_guardrails.manifests.atomic_writes_only" must be true or false, got "true"',
    );
    expect(loadErr('agent_guardrails:\n  manifests:\n    atomic_writes_only:\n')).toBe(
      'line 3 — "agent_guardrails.manifests.atomic_writes_only" must be true or false, ' +
        'got null (empty value)',
    );
  });

  test('protected: empty list rejects — an empty guard list would silently protect nothing', () => {
    expect(loadErr('agent_guardrails:\n  manifests:\n    protected: []\n')).toBe(
      'line 3 — "agent_guardrails.manifests.protected" must be a non-empty list of ' +
        'workspace-relative manifest paths, got a list',
    );
  });

  test('protected: non-list rejects (a scalar is a typo, not a one-manifest list)', () => {
    expect(loadErr('agent_guardrails:\n  manifests:\n    protected: Cargo.toml\n')).toBe(
      'line 3 — "agent_guardrails.manifests.protected" must be a non-empty list of ' +
        'workspace-relative manifest paths, got "Cargo.toml"',
    );
  });

  test('protected: empty/absolute/escaping entries reject at their own indexed lines', () => {
    expect(loadErr('agent_guardrails:\n  manifests:\n    protected:\n      - ""\n')).toBe(
      'line 4 — "agent_guardrails.manifests.protected[0]" must be a non-empty workspace-relative path, got ""',
    );
    expect(loadErr('agent_guardrails:\n  manifests:\n    protected:\n      - /etc/pkg\n')).toBe(
      'line 4 — "agent_guardrails.manifests.protected[0]" must be a workspace-relative POSIX path ' +
        '(no leading "/", no ".." segment, no "\\"), got "/etc/pkg"',
    );
    expect(loadErr('agent_guardrails:\n  manifests:\n    protected:\n      - ../pkg\n')).toBe(
      'line 4 — "agent_guardrails.manifests.protected[0]" must be a workspace-relative POSIX path ' +
        '(no leading "/", no ".." segment, no "\\"), got "../pkg"',
    );
  });

  test('the index in a protected-entry error counts real entries (the offender is [1], not [0])', () => {
    expect(loadErr('agent_guardrails:\n  manifests:\n    protected: [Cargo.toml, /abs/x]\n')).toBe(
      'line 3 — "agent_guardrails.manifests.protected[1]" must be a workspace-relative POSIX path ' +
        '(no leading "/", no ".." segment, no "\\"), got "/abs/x"',
    );
  });
});

describe('issue #63 config — devlog block: shape and domain rejections', () => {
  test('non-mapping devlog rejects with the block expectation (list and scalar forms)', () => {
    expect(loadErr('agent_guardrails:\n  devlog: []\n')).toBe(
      'line 2 — "agent_guardrails.devlog" must be a mapping like ' +
        '{ enabled: true, path: "log/devlog.md", required_sections: [touched_files, test_outcomes, still_open] }, ' +
        'got a list',
    );
    expect(loadErr('agent_guardrails:\n  devlog: log.md\n')).toBe(
      'line 2 — "agent_guardrails.devlog" must be a mapping like ' +
        '{ enabled: true, path: "log/devlog.md", required_sections: [touched_files, test_outcomes, still_open] }, ' +
        'got "log.md"',
    );
  });

  test('devlog.enabled: non-boolean rejects', () => {
    expect(loadErr('agent_guardrails:\n  devlog:\n    enabled: "yes"\n')).toBe(
      'line 3 — "agent_guardrails.devlog.enabled" must be true or false, got "yes"',
    );
  });

  test('required_sections: empty list and non-list reject with the list expectation', () => {
    expect(loadErr('agent_guardrails:\n  devlog:\n    required_sections: []\n')).toBe(
      'line 3 — "agent_guardrails.devlog.required_sections" must be a non-empty list of ' +
        'section names, got a list',
    );
    expect(loadErr('agent_guardrails:\n  devlog:\n    required_sections: touched_files\n')).toBe(
      'line 3 — "agent_guardrails.devlog.required_sections" must be a non-empty list of ' +
        'section names, got "touched_files"',
    );
  });

  test('required_sections: empty-string and non-string entries reject at their own indexed lines', () => {
    expect(loadErr('agent_guardrails:\n  devlog:\n    required_sections:\n      - ""\n')).toBe(
      'line 4 — "agent_guardrails.devlog.required_sections[0]" must be a non-empty section name, got ""',
    );
    expect(loadErr('agent_guardrails:\n  devlog:\n    required_sections:\n      - 5\n')).toBe(
      'line 4 — "agent_guardrails.devlog.required_sections[0]" must be a non-empty section name, got "5"',
    );
    expect(loadErr('agent_guardrails:\n  devlog:\n    required_sections:\n      - touched_files\n      - [x]\n')).toBe(
      'line 5 — "agent_guardrails.devlog.required_sections[1]" must be a non-empty section name, got a list',
    );
  });
});

describe('issue #63 config — negative_invariants block: shape and domain rejections', () => {
  test('non-mapping negative_invariants rejects with the block expectation', () => {
    expect(loadErr('agent_guardrails:\n  negative_invariants: true\n')).toBe(
      'line 2 — "agent_guardrails.negative_invariants" must be a mapping like ' +
        '{ required: true, anchor: "Negative Invariants" }, got "true"',
    );
  });

  test('required: non-boolean and explicit empty reject', () => {
    expect(loadErr('agent_guardrails:\n  negative_invariants:\n    required: 1\n')).toBe(
      'line 3 — "agent_guardrails.negative_invariants.required" must be true or false, got "1"',
    );
    expect(loadErr('agent_guardrails:\n  negative_invariants:\n    required:\n')).toBe(
      'line 3 — "agent_guardrails.negative_invariants.required" must be true or false, ' +
        'got null (empty value)',
    );
  });

  test('anchor: empty string and non-string reject with the heading-text expectation', () => {
    expect(loadErr('agent_guardrails:\n  negative_invariants:\n    anchor: ""\n')).toBe(
      'line 3 — "agent_guardrails.negative_invariants.anchor" must be a non-empty heading text, got ""',
    );
    expect(loadErr('agent_guardrails:\n  negative_invariants:\n    anchor: 9\n')).toBe(
      'line 3 — "agent_guardrails.negative_invariants.anchor" must be a non-empty heading text, got "9"',
    );
    expect(loadErr('agent_guardrails:\n  negative_invariants:\n    anchor:\n')).toBe(
      'line 3 — "agent_guardrails.negative_invariants.anchor" must be a non-empty heading text, ' +
        'got null (empty value)',
    );
  });
});

// ── the shared workspace-relative path discipline ──────────────────────────

describe('issue #63 config — validateWorkspaceRelativePath: one message shape across all three path surfaces', () => {
  const POSIX_EXPECTATION =
    'must be a workspace-relative POSIX path (no leading "/", no ".." segment, no "\\")';
  const EMPTY_EXPECTATION = 'must be a non-empty workspace-relative path';

  test('isolation.prefix: empty string → the non-empty expectation; absolute / ".." / backslash → the POSIX expectation', () => {
    expect(loadErr('agent_guardrails:\n  isolation:\n    prefix: ""\n')).toBe(
      'line 3 — "agent_guardrails.isolation.prefix" ' + EMPTY_EXPECTATION + ', got ""',
    );
    expect(loadErr('agent_guardrails:\n  isolation:\n    prefix: /abs/target\n')).toBe(
      'line 3 — "agent_guardrails.isolation.prefix" ' + POSIX_EXPECTATION + ', got "/abs/target"',
    );
    expect(loadErr('agent_guardrails:\n  isolation:\n    prefix: ../out\n')).toBe(
      'line 3 — "agent_guardrails.isolation.prefix" ' + POSIX_EXPECTATION + ', got "../out"',
    );
    expect(loadErr('agent_guardrails:\n  isolation:\n    prefix: "target\\agent"\n')).toBe(
      'line 3 — "agent_guardrails.isolation.prefix" ' + POSIX_EXPECTATION + ', got "target\\agent"',
    );
  });

  test('devlog.path: the SAME POSIX discipline (empty / absolute / ".." escape)', () => {
    expect(loadErr('agent_guardrails:\n  devlog:\n    path: ""\n')).toBe(
      'line 3 — "agent_guardrails.devlog.path" ' + EMPTY_EXPECTATION + ', got ""',
    );
    expect(loadErr('agent_guardrails:\n  devlog:\n    path: /log/devlog.md\n')).toBe(
      'line 3 — "agent_guardrails.devlog.path" ' + POSIX_EXPECTATION + ', got "/log/devlog.md"',
    );
    expect(loadErr('agent_guardrails:\n  devlog:\n    path: ../log/devlog.md\n')).toBe(
      'line 3 — "agent_guardrails.devlog.path" ' + POSIX_EXPECTATION + ', got "../log/devlog.md"',
    );
  });

  test('the engine joins these onto the workspace root verbatim — a nested ".." segment escapes too', () => {
    // not just a LEADING ../ — a '..' buried mid-path is the same escape
    expect(loadErr('agent_guardrails:\n  devlog:\n    path: log/../secrets.md\n')).toBe(
      'line 3 — "agent_guardrails.devlog.path" ' + POSIX_EXPECTATION + ', got "log/../secrets.md"',
    );
  });

  test('legal workspace-relative paths load: nested directories, dots in names, deep prefixes', () => {
    const rules = loadOk(
      [
        'agent_guardrails:',
        '  isolation:',
        '    prefix: "build/wip.agents-"',
        '  devlog:',
        '    path: "log/agents/2025/handoff.md"',
        '  manifests:',
        '    protected:',
        '      - "sub.dir/Cargo.toml"',
        '',
      ].join('\n'),
    );
    expect(rules.agent_guardrails!.isolation.prefix).toBe('build/wip.agents-');
    expect(rules.agent_guardrails!.devlog.path).toBe('log/agents/2025/handoff.md');
    expect(rules.agent_guardrails!.manifests.protected).toEqual(['sub.dir/Cargo.toml']);
  });
});

// ── line-number discipline: the member's own line reports ──────────────────

describe('issue #63 config — line-number discipline: errors inside multi-line blocks name the member line', () => {
  test('a bad value deep in a multi-line block reports the offending member line (not the section line)', () => {
    // Lines: 1 section, 2 devlog, 3 enabled, 4 path, 5 required_sections,
    // 6 touched_files, 7 the empty entry, 8 still_open.
    expect(
      loadErr(
        'agent_guardrails:\n  devlog:\n    enabled: true\n    path: log/devlog.md\n' +
          '    required_sections:\n      - touched_files\n      - ""\n      - still_open\n',
      ),
    ).toBe(
      'line 7 — "agent_guardrails.devlog.required_sections[1]" must be a non-empty section name, got ""',
    );
  });

  test('a member AFTER valid siblings reports its own line (mode ok on line 3, prefix bad on line 4)', () => {
    expect(loadErr('agent_guardrails:\n  isolation:\n    mode: require-target-prefix\n    prefix: /abs\n')).toBe(
      'line 4 — "agent_guardrails.isolation.prefix" must be a workspace-relative POSIX path ' +
        '(no leading "/", no ".." segment, no "\\"), got "/abs"',
    );
  });

  test('inline-object members share the enclosing key line (parseYamlTracked convention)', () => {
    expect(loadErr('agent_guardrails:\n  isolation: { mode: off, prefix: ../out }\n')).toBe(
      'line 2 — "agent_guardrails.isolation.prefix" must be a workspace-relative POSIX path ' +
        '(no leading "/", no ".." segment, no "\\"), got "../out"',
    );
  });

  test('a fully inline section maps member errors to the section line', () => {
    expect(loadErr('agent_guardrails: { enabled: "yes" }\n')).toBe(
      'line 1 — "agent_guardrails.enabled" must be true or false, got "yes"',
    );
  });
});
