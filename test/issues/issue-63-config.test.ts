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
