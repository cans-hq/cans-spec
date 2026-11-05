/**
 * Issue #63 — `agent_guardrails`: the INTEGRATION contract — the engine's
 * place in checkWorkspace and on both output surfaces (the engine unit
 * predicates live in issue-63-engine.test.ts).
 *
 * Pinned here:
 *   - the pre-#63 byte-identical contract: a workspace whose _rules.yaml has
 *     NO agent_guardrails section, one with the section explicitly EMPTY
 *     (null → NULL_OK OFF) and one with `enabled: false` produce identical
 *     runs — same issues, same ok/exitCode, and human/JSON output identical
 *     once the wall-clock duration (the one legitimately volatile field) is
 *     normalized. The guardrails engine must never reshape any pre-#63
 *     surface (the issue #59 additive-optional-key discipline);
 *   - the gates: the engine runs ONLY in full checks — zero guardrails
 *     findings under --refs-only and under --structure, findings present in
 *     the plain run of the same workspace; workspace-GLOBal (a [file] filter
 *     never scopes it — the devlog/AGENTS.md/_tasks state is not a spec
 *     file), mirroring refs;
 *   - one workspace per violation class → exactly the expected finding;
 *   - severity: 'error' → level error, fails the run (exit 2, ok false);
 *     'warn' → warnings only, ok stays true, exit 1;
 *   - clean workspace (every switch on, everything compliant) → zero
 *     guardrails findings, ok, exit 0;
 *   - END-TO-END visibility (the output-surface decision): findings carry
 *     category 'structure' with `guardrails.*` rule keys — visible in the
 *     human STRUCTURE section (header counts, per-file locations, the fix
 *     hint) and lossless in --json under sections.structure (rule + detail +
 *     suggestion per entry). No new section key: report.ts's sectionFor
 *     routes the unknown rule prefix by the issue's category, so zero files
 *     outside this engine's ownership change and pre-#63 output stays
 *     byte-identical.
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';

import { checkWorkspace, type CheckArgs } from '../../src/commands/check.ts';
import { spawnCli, REPO } from '../runtime.ts';

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-63-integration');

interface Ws { root: string; cans: string }

const createdDirs: string[] = [];
let wsSeq = 0;

function makeWs(name: string): Ws {
  const root = join(SCRATCH, `${name}-${++wsSeq}`);
  mkdirSync(join(root, 'cans'), { recursive: true });
  createdDirs.push(root);
  return { root, cans: join(root, 'cans') };
}

function write(ws: Ws, rel: string, content: string): void {
  const p = join(ws.cans, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, content, 'utf8');
}

function mkdir(ws: Ws, rel: string): void {
  mkdirSync(join(ws.cans, rel), { recursive: true });
}

function read(ws: Ws, rel: string): string {
  return readFileSync(join(ws.cans, rel), 'utf8');
}

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
  return parsed;
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

// ── fixtures ─────────────────────────────────────────────────────────────────

/** The full compliant `agent_guardrails` block (§18 documented defaults,
 *  enabled) — every switch on. */
const GUARDRAILS_ON = [
  'agent_guardrails:',
  '  enabled: true',
  '  severity: error',
  '  isolation:',
  '    mode: require-target-prefix',
  '    prefix: "target/agent-"',
  '  manifests:',
  '    atomic_writes_only: true',
    '    protected: [Cargo.toml, package.json, pyproject.toml]',
  '  devlog:',
  '    enabled: true',
  '    path: "log/devlog.md"',
  '    required_sections: [touched_files, test_outcomes, still_open]',
  '  negative_invariants:',
  '    required: true',
  '    anchor: "Negative Invariants"',
  '',
].join('\n');

/** References hygiene — keeps every OTHER engine quiet so the guardrails
 *  verdicts (ok/exitCode/counts) are exact. 3 of the 4 check keys spelled:
 *  max_hops reads as deleted (majority-covered) → deep hops off, orphan and
 *  duplicate-home checks off, back-pointer sweep off. */
const REFS_HYGIENE = [
  'references:',
  '  back_pointers: false',
  '  orphan_check: false',
  '  duplicate_home_check: false',
  '',
].join('\n');

const DEVLOG_FULL = [
  '# Devlog',
  '',
  '## touched_files',
  '- 01-core.md',
  '',
  '## test_outcomes',
  '- all green',
  '',
  '## still_open',
  '- nothing',
  '',
].join('\n');

const AGENTS_FULL = [
  '# Agent instructions',
  '',
  '## Negative Invariants',
  '- never edit Cargo.toml in place',
  '- no database drivers',
  '',
  '## Workflow',
  '- always run cans check',
  '',
].join('\n');

/** Spec fixtures with TWO children each — a single child would trip the
 *  default single_child_collapse advisory (structure.single_child, warning)
 *  and blur the exact-count pins. */
const OVERVIEW = '- Overview hub\n  - points: see: 01-core.md\n  - reviewed: yes\n';
const CORE = '- Core model\n  - back: see: 00-overview.md\n  - frozen: no\n';

/** The fully compliant workspace: every guardrails switch ON, every predicate
 *  satisfied. Everything else is kept quiet by the fixtures themselves. */
function cleanWs(name: string): Ws {
  const ws = makeWs(name);
  write(ws, '_rules.yaml', REFS_HYGIENE + '\n' + GUARDRAILS_ON);
  write(ws, '00-overview.md', OVERVIEW);
  write(ws, '01-core.md', CORE);
  write(ws, '_tasks/build-ui.md', '# build-ui\n- Owner: agent-1\n- target: target/agent-build-ui\n');
  write(ws, 'log/devlog.md', DEVLOG_FULL);
  write(ws, 'AGENTS.md', AGENTS_FULL);
  return ws;
}

function guardrails(j: any): any[] {
  return j.sections.structure.filter((f: any) => f.rule.startsWith('guardrails.'));
}

/** Human output with the wall-clock duration normalized — the one field
 *  legitimately different between two runs of the SAME bytes. */
function humanStable(out: string): string {
  return out.replace(/[0-9]+ms/g, 'Xms');
}

// ── w1: the pre-#63 byte-identical contract ──────────────────────────────────

describe('issue #63 w1 — disabled is invisible: the pre-#63 surface is byte-identical', () => {
  // A maximally violating workspace (bad task target, default build dir,
  // residue, missing devlog, missing AGENTS.md) rendered three ways.
  const VIOLATIONS = (ws: Ws): void => {
    write(ws, '00-overview.md', OVERVIEW);
    write(ws, '01-core.md', CORE);
    write(ws, '_tasks/build-api.md', '# build-api\n- target: target/debug\n');
    mkdir(ws, 'dist');
    write(ws, 'Cargo.toml.bak', '[package]\n');
    // log/devlog.md and AGENTS.md deliberately absent.
  };

  const run3 = (yamlTail: string): { human: string; json: any } => {
    const ws = makeWs(`w1-${wsSeq}`);
    write(ws, '_rules.yaml', REFS_HYGIENE + yamlTail);
    VIOLATIONS(ws);
    const human = runCli(['check'], ws.root);
    const json = runCli(['check', '--json'], ws.root);
    return { human: humanStable(human.out), json: parseJsonOut(json.out) };
  };

  test('no section vs empty section vs enabled:false — identical human output, identical JSON (duration normalized)', () => {
    const absent = run3('');
    const empty = run3('agent_guardrails:\n'); // explicit EMPTY = the documented OFF (NULL_OK)
    const off = run3('agent_guardrails:\n  enabled: false\n');
    expect(empty.human).toBe(absent.human);
    expect(off.human).toBe(absent.human);
    const stripMs = (j: any): string => JSON.stringify({ ...j, summary: { ...j.summary, elapsedMs: 0 } });
    expect(stripMs(empty.json)).toBe(stripMs(absent.json));
    expect(stripMs(off.json)).toBe(stripMs(absent.json));
  });

  test('the violating pre-#63 workspace reports ZERO guardrails rules anywhere in the JSON', () => {
    const { json } = run3('');
    for (const [section, entries] of Object.entries<any>(json.sections)) {
      for (const e of entries) {
        expect(`${section}:${e.rule}`).not.toContain('guardrails.');
      }
    }
  });

  test('same verdict at the checkWorkspace level: no section → zero findings, exit unchanged', async () => {
    const ws = makeWs('w1-direct');
    write(ws, '_rules.yaml', REFS_HYGIENE);
    VIOLATIONS(ws);
    const r = await checkWorkspace(ws.cans, BASE_OPTS);
    expect(r.issues.filter(i => i.rule!.startsWith('guardrails.'))).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.exitCode).toBe(0); // mutual refs resolve; nothing else fires
  });
});

// ── w2: the gates + workspace-global scoping ─────────────────────────────────

describe('issue #63 w2 — the engine runs only in full checks, workspace-global', () => {
  const violating = (): Ws => {
    const ws = makeWs('w2-violating');
    write(ws, '_rules.yaml', REFS_HYGIENE + '\n' + GUARDRAILS_ON);
    write(ws, '00-overview.md', OVERVIEW);
    write(ws, '01-core.md', CORE);
    write(ws, '_tasks/build-api.md', '# build-api\n- target: target/debug\n');
    mkdir(ws, 'dist');
    write(ws, 'log/devlog.md', DEVLOG_FULL);
    write(ws, 'AGENTS.md', AGENTS_FULL);
    return ws;
  };

  test('plain run: both isolation findings; --refs-only and --structure: zero', async () => {
    const plain = await checkWorkspace(violating().cans, BASE_OPTS);
    const rules = plain.issues.filter(i => i.rule!.startsWith('guardrails.')).map(i => i.rule).sort();
    expect(rules).toEqual(['guardrails.isolation.default_build_dir', 'guardrails.isolation.task_build_dir']);

    const refsOnly = await checkWorkspace(violating().cans, { ...BASE_OPTS, refsOnly: true });
    expect(refsOnly.issues.filter(i => i.rule!.startsWith('guardrails.'))).toEqual([]);

    const gated = await checkWorkspace(violating().cans, { ...BASE_OPTS, structure: true });
    expect(gated.issues.filter(i => i.rule!.startsWith('guardrails.'))).toEqual([]);
    // the gate itself stays green (the fixtures are structurally clean)
    expect(gated.ok).toBe(true);
    expect(gated.exitCode).toBe(0);
  });

  test('a [file] filter never scopes the engine (devlog/AGENTS.md/_tasks are not spec files)', async () => {
    const ws = violating();
    const filtered = await checkWorkspace(ws.cans, { ...BASE_OPTS, file: '01-core.md' });
    const rules = filtered.issues.filter(i => i.rule!.startsWith('guardrails.')).map(i => i.rule).sort();
    expect(rules).toEqual(['guardrails.isolation.default_build_dir', 'guardrails.isolation.task_build_dir']);
  });
});

// ── w3: clean workspace — every switch on, zero findings ─────────────────────

describe('issue #63 w3 — the compliant workspace is green end-to-end', () => {
  test('zero guardrails findings; ok true; exit 0 (CLI)', async () => {
    const ws = cleanWs('w3-clean');
    const r = await checkWorkspace(ws.cans, BASE_OPTS);
    expect(r.issues.filter(i => i.rule!.startsWith('guardrails.'))).toEqual([]);
    expect(r.issues).toEqual([]); // the whole run is quiet, not just guardrails
    expect(r.ok).toBe(true);
    expect(r.exitCode).toBe(0);

    const cli = runCli(['check', '--json'], ws.root);
    expect(cli.exit).toBe(0);
    const j = parseJsonOut(cli.out);
    expect(guardrails(j)).toEqual([]);
    expect(j.ok).toBe(true);
  });
});

// ── w4: one workspace per violation class ────────────────────────────────────

describe('issue #63 w4 — one violation class per workspace → exactly the expected finding', () => {
  const expectExactlyOne = async (name: string, mutate: (ws: Ws) => void, rule: string): Promise<void> => {
    const ws = cleanWs(name);
    mutate(ws);
    const r = await checkWorkspace(ws.cans, BASE_OPTS);
    const findings = r.issues.filter(i => i.rule!.startsWith('guardrails.'));
    expect(findings.map(i => i.rule)).toEqual([rule]);
    expect(findings[0]!.level).toBe('error'); // severity defaults to error
    return void 0;
  };

  test('isolation (a): a task declaring a build dir outside the prefix', async () => {
    await expectExactlyOne(
      'v-task',
      ws => write(ws, '_tasks/build-api.md', '# build-api\n- Owner: agent-1\n- target: target/debug\n'),
      'guardrails.isolation.task_build_dir',
    );
  });

  test('isolation (b): a shared default build dir at the workspace root', async () => {
    await expectExactlyOne('v-dist', ws => mkdir(ws, 'dist'), 'guardrails.isolation.default_build_dir');
  });

  test('manifests (a): the devlog touched_files section listing a protected manifest', async () => {
    await expectExactlyOne(
      'v-touched',
      ws => write(ws, 'log/devlog.md', DEVLOG_FULL.replace('## touched_files\n- 01-core.md', '## touched_files\n- 01-core.md\n- package.json')),
      'guardrails.manifests.devlog_touched',
    );
  });

  test('manifests (b): atomic-write residue beside a protected manifest', async () => {
    await expectExactlyOne('v-residue', ws => write(ws, 'package.json.orig', '{}\n'), 'guardrails.manifests.residue');
  });

  test('devlog: the file missing entirely', async () => {
    const ws = cleanWs('v-devlog-missing');
    rmSync(join(ws.cans, 'log', 'devlog.md'));
    const r = await checkWorkspace(ws.cans, BASE_OPTS);
    expect(r.issues.filter(i => i.rule!.startsWith('guardrails.')).map(i => i.rule))
      .toEqual(['guardrails.devlog.missing_file']);
  });

  test('devlog: the file present but missing required sections (ONE finding naming them)', async () => {
    await expectExactlyOne(
      'v-devlog-sections',
      ws => write(ws, 'log/devlog.md', '# Devlog\n## touched_files\n- 01-core.md\n'),
      'guardrails.devlog.missing_sections',
    );
    const ws = cleanWs('v-devlog-sections-2');
    write(ws, 'log/devlog.md', '# Devlog\n## touched_files\n- 01-core.md\n');
    const r = await checkWorkspace(ws.cans, BASE_OPTS);
    const f = r.issues.filter(i => i.rule === 'guardrails.devlog.missing_sections');
    expect(f[0]!.message).toContain('"test_outcomes", "still_open"');
  });

  test('invariants: AGENTS.md missing', async () => {
    const ws = cleanWs('v-agents-missing');
    rmSync(join(ws.cans, 'AGENTS.md'));
    const r = await checkWorkspace(ws.cans, BASE_OPTS);
    expect(r.issues.filter(i => i.rule!.startsWith('guardrails.')).map(i => i.rule))
      .toEqual(['guardrails.invariants.missing_file']);
  });

  test('invariants: anchor heading missing', async () => {
    await expectExactlyOne(
      'v-anchor',
      ws => write(ws, 'AGENTS.md', '# Agent instructions\n- be nice\n'),
      'guardrails.invariants.missing_anchor',
    );
  });

  test('invariants: anchor present but the block empty', async () => {
    await expectExactlyOne(
      'v-empty-block',
      ws => write(ws, 'AGENTS.md', '## Negative Invariants\n## Workflow\n- always run cans check\n'),
      'guardrails.invariants.empty_block',
    );
  });

  test('error severity fails the run: exitCode 2, ok false, errorCount exact', async () => {
    const ws = cleanWs('v-fatal');
    write(ws, '_tasks/build-api.md', '# build-api\n- Owner: agent-1\n- target: target/debug\n');
    const r = await checkWorkspace(ws.cans, BASE_OPTS);
    expect(r.errorCount).toBe(1);
    expect(r.warningCount).toBe(0);
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(2);
  });
});

// ── w5: severity warn — advisory band, ok stays true ─────────────────────────

describe('issue #63 w5 — severity: warn → warnings only, ok untouched', () => {
  test('the same violations report as warnings: exit 1, ok true, errorCount 0', async () => {
    const ws = makeWs('w5-warn');
    write(ws, '_rules.yaml', REFS_HYGIENE + '\n' + GUARDRAILS_ON.replace('severity: error', 'severity: warn'));
    write(ws, '00-overview.md', OVERVIEW);
    write(ws, '01-core.md', CORE);
    write(ws, '_tasks/build-api.md', '# build-api\n- target: target/debug\n');
    mkdir(ws, 'dist');
    write(ws, 'log/devlog.md', DEVLOG_FULL);
    write(ws, 'AGENTS.md', AGENTS_FULL);

    const r = await checkWorkspace(ws.cans, BASE_OPTS);
    const findings = r.issues.filter(i => i.rule!.startsWith('guardrails.'));
    expect(findings).toHaveLength(2);
    expect(findings.every(i => i.level === 'warning')).toBe(true);
    expect(r.errorCount).toBe(0);
    expect(r.warningCount).toBe(2);
    expect(r.ok).toBe(true);
    expect(r.exitCode).toBe(1);

    // --strict reads warningCount: ok flips, the exit code does not (house contract)
    const strict = await checkWorkspace(ws.cans, { ...BASE_OPTS, strict: true });
    expect(strict.ok).toBe(false);
    expect(strict.exitCode).toBe(1);
  });
});

// ── w6: end-to-end on both renderers (the output-surface decision) ───────────

describe('issue #63 w6 — findings visible END-TO-END: human STRUCTURE section + --json sections.structure', () => {
  test('CLI --json: sections.structure carries the lossless guardrails entries (rule, detail, suggestion, level)', () => {
    const ws = makeWs('w6-json');
    write(ws, '_rules.yaml', REFS_HYGIENE + '\n' + GUARDRAILS_ON);
    write(ws, '00-overview.md', OVERVIEW);
    write(ws, '01-core.md', CORE);
    write(ws, '_tasks/build-api.md', '# build-api\n- Owner: agent-1\n- target: target/debug\n');
    mkdir(ws, 'dist');
    write(ws, 'log/devlog.md', DEVLOG_FULL);
    write(ws, 'AGENTS.md', AGENTS_FULL);

    const r = runCli(['check', '--json'], ws.root);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(false);

    const findings = guardrails(j);
    expect(findings).toHaveLength(2);
    expect(findings.map((f: any) => f.rule).sort())
      .toEqual(['guardrails.isolation.default_build_dir', 'guardrails.isolation.task_build_dir']);
    for (const f of findings) {
      expect(f.level).toBe('error');
      expect(f.file).not.toBe('');
      expect(typeof f.line).toBe('number');
      expect(f.detail).toContain('agent_guardrails.isolation');
      expect(f.suggestion).toContain('target/agent-');
    }
    // the task finding names the task file and the offending path
    const task = findings.find((f: any) => f.rule === 'guardrails.isolation.task_build_dir');
    expect(task.file).toBe('_tasks/build-api.md');
    expect(task.line).toBe(3);
    expect(task.detail).toContain('target/debug');
    // the dir finding names the directory, line 0
    const dir = findings.find((f: any) => f.rule === 'guardrails.isolation.default_build_dir');
    expect(dir.file).toBe('dist/');
    expect(dir.line).toBe(0);
    // fixed section keys: guardrails rides sections.structure — no reshaped wire
    expect(Object.keys(j.sections)).toEqual(['structure', 'style', 'refs', 'redundancy', 'other']);
  });

  test('CLI human: the STRUCTURE section renders the findings with locations and the fix hint', () => {
    const ws = makeWs('w6-human');
    write(ws, '_rules.yaml', REFS_HYGIENE + '\n' + GUARDRAILS_ON);
    write(ws, '00-overview.md', OVERVIEW);
    write(ws, '01-core.md', CORE);
    write(ws, '_tasks/build-api.md', '# build-api\n- Owner: agent-1\n- target: target/debug\n');
    mkdir(ws, 'dist');
    write(ws, 'log/devlog.md', DEVLOG_FULL);
    write(ws, 'AGENTS.md', AGENTS_FULL);

    const r = runCli(['check'], ws.root);
    expect(r.exit).toBe(2);
    // the STRUCTURE header: two errors
    expect(r.out).toContain('STRUCTURE  ✗ 2');
    // the finding's location line (file:line, .md stripped by formatLocations)
    expect(r.out).toContain('_tasks/build-api:3');
    // and the remediation hint, once per group
    expect(r.out).toContain('declare the build/output directory under "target/agent-"');
    // --show structure unfolds the same section (the category is structure)
    const shown = runCli(['check', '--show', 'structure'], ws.root);
    expect(shown.out).toContain('STRUCTURE  ✗ 2');
    expect(shown.out).toContain('declare the build/output directory under "target/agent-"');
  });

  test('a disabled workspace renders byte-identically to a no-section workspace on the CLI (duration normalized)', () => {
    const mk = (tail: string): string => {
      const ws = makeWs(`w6-stable-${wsSeq}`);
      write(ws, '_rules.yaml', REFS_HYGIENE + tail);
      write(ws, '00-overview.md', OVERVIEW);
      write(ws, '01-core.md', CORE);
      write(ws, '_tasks/build-api.md', '# build-api\n- target: target/debug\n');
      mkdir(ws, 'dist');
      return humanStable(runCli(['check'], ws.root).out);
    };
    const absent = mk('');
    expect(mk('agent_guardrails:\n')).toBe(absent);
    expect(mk('agent_guardrails:\n  enabled: false\n')).toBe(absent);
  });
});

// ── w7: the config seam — _rules.yaml blocks flow through loadRules ──────────

describe('issue #63 w7 — the loadRules seam (config agent contract) drives the wiring', () => {
  test('a partial block deep-merges to the documented defaults; empty block = null = OFF', async () => {
    // enabled + isolation only: manifests/devlog/invariants keep their
    // documented defaults — here the compliant devlog/AGENTS.md must keep
    // the run green while the violating task still reports.
    const ws = makeWs('w7-partial');
    write(
      ws,
      '_rules.yaml',
      [
        REFS_HYGIENE,
        'agent_guardrails:',
        '  enabled: true',
        '  isolation:',
        '    mode: require-target-prefix',
        '',
      ].join('\n'),
    );
    write(ws, '00-overview.md', OVERVIEW);
    write(ws, '01-core.md', CORE);
    write(ws, '_tasks/build-api.md', '# build-api\n- target: target/debug\n');
    write(ws, 'log/devlog.md', DEVLOG_FULL);
    write(ws, 'AGENTS.md', AGENTS_FULL);

    const r = await checkWorkspace(ws.cans, BASE_OPTS);
    expect(r.issues.filter(i => i.rule!.startsWith('guardrails.')).map(i => i.rule))
      .toEqual(['guardrails.isolation.task_build_dir']);
    // the deep-merged defaults enforce the protected manifests: residue fires
    write(ws, 'pyproject.toml.tmp', '[project]\n');
    const r2 = await checkWorkspace(ws.cans, BASE_OPTS);
    expect(r2.issues.filter(i => i.rule === 'guardrails.manifests.residue')).toHaveLength(1);
    expect(read(ws, '_tasks/build-api.md')).toContain('target/debug'); // the engine never writes
  });
});
