/**
 * Issue #63 (docs + templates half) — the documentation and template pins for
 * the agent-guardrails deliverable. The schema and strict validation live in
 * src/types.ts / src/core/rules.ts (the contract commit); the engine wiring
 * lands in src/core/guardrails.ts + src/commands/check.ts (the engine commit).
 * This suite pins the three shipped ARTIFACTS that teach agents and workspace
 * authors the contract:
 *
 *   - templates/_rules.yaml ships `agent_guardrails:` fully COMMENTED OUT —
 *     the RFC example block verbatim, inert (no uncommented key), so a
 *     `cans init` workspace stays strictly valid under the issue #56
 *     validator and unsupervised until the author opts in (§18 NULL_OK:
 *     absent / empty / enabled: false all mean OFF);
 *   - templates/AGENTS.md standardizes the implementation in AGENTS.md: the
 *     `## Negative Invariants` anchor (the default
 *     agent_guardrails.negative_invariants.anchor, non-empty beneath it) and
 *     the agent execution policy — prefixed build dirs (target/agent-*),
 *     atomic copy-modify-swap on protected manifests, the append-only
 *     log/devlog.md handoff devlog (touched_files / test_outcomes /
 *     still_open);
 *   - docs/cans.architecture.md §18 documents every contract key (enabled,
 *     severity, isolation, manifests, devlog, negative_invariants,
 *     require-target-prefix, target/agent-) and §17 names the engine.
 *
 * Plus the end-to-end guarantee the issue demands: a freshly `cans init`-ed
 * workspace — new template included — loads (loadRules = the documented
 * defaults, agent_guardrails enabled: false) and checks clean (init + check
 * happy path, blackbox CLI).
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs';

import { spawnCli, REPO, readTextSync } from '../runtime.ts';
import {
  loadRules,
  defaultAgentGuardrails,
  parseMinimalYaml,
} from '../../src/core/rules.ts';

const REPO_DOCS = join(REPO, 'docs', 'cans.architecture.md');
const TEMPLATE_RULES = join(REPO, 'templates', '_rules.yaml');
const TEMPLATE_AGENTS = join(REPO, 'templates', 'AGENTS.md');

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-63-docs');

const createdDirs: string[] = [];
let wsSeq = 0;

afterEach(() => {
  while (createdDirs.length > 0) {
    rmSync(createdDirs.pop()!, { recursive: true, force: true });
  }
});

/** Fresh scratch dir for an `init` run (the CLI creates the cans/ skeleton). */
function makeScratch(name: string): string {
  const root = join(SCRATCH, `${name}-${++wsSeq}`);
  mkdirSync(root, { recursive: true });
  createdDirs.push(root);
  return root;
}

/** Blackbox CLI spawn — isolated from any ambient CANS_ROOT. */
function runCli(args: string[], cwd: string) {
  return spawnCli(args, cwd, { ...process.env, CANS_ROOT: '' });
}

/** templates/_rules.yaml with the commented `agent_guardrails` example block
 *  uncommented — what an author gets by deleting the comment markers §21/§18
 *  tell them to delete. Returns null when the template ships no such block. */
function uncommentedGuardrailsExample(): string | null {
  const lines = readFileSync(TEMPLATE_RULES, 'utf-8').split('\n');
  const out: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    if (/^# agent_guardrails:/.test(line)) {
      inBlock = true;
      out.push(line.replace(/^# /, ''));
      continue;
    }
    if (inBlock) {
      if (/^#\s/.test(line) || line === '#') {
        out.push(line.replace(/^# ?/, ''));
      } else {
        break; // block ended (non-comment line)
      }
    }
  }
  return inBlock ? out.join('\n') : null;
}

// ── templates/_rules.yaml — the inert commented example ────────────────────

describe('issue #63 — templates/_rules.yaml ships the inert agent_guardrails example', () => {
  test('no uncommented agent_guardrails key parses (init workspaces stay unsupervised)', () => {
    const parsed = parseTemplate(TEMPLATE_RULES);
    // The template ships the block COMMENTED — the strict validator accepts
    // the shipped file, and nothing in it enables supervision.
    expect(parsed['agent_guardrails']).toBeUndefined();
    // Belt and braces: no uncommented `agent_guardrails:` line at all.
    const uncommented = readFileSync(TEMPLATE_RULES, 'utf-8')
      .split('\n')
      .filter(l => /^agent_guardrails:/.test(l));
    expect(uncommented).toEqual([]);
  });

  test('the commented example block is present and mirrors the RFC example', () => {
    const uncommented = uncommentedGuardrailsExample();
    expect(uncommented).not.toBeNull();
    const lines = uncommented!.split('\n');
    // The RFC's example spelling, every member of the §18 contract present:
    for (const key of [
      'agent_guardrails:',
      'enabled: true',
      'severity: error',
      'mode: require-target-prefix',
      'prefix: target/agent-',
      'atomic_writes_only: true',
      'protected: [Cargo.toml, package.json, pyproject.toml]',
      'path: log/devlog.md',
      'required_sections: [touched_files, test_outcomes, still_open]',
      'required: true',
      'anchor: Negative Invariants',
    ]) {
      expect(lines.some(l => l.trim() === key)).toBe(true);
    }
  });

  test('uncommenting the example yields a strictly valid config with the enabled block', () => {
    const example = uncommentedGuardrailsExample();
    expect(example).not.toBeNull();
    const ws = makeScratch('uncommented-example');
    mkdirSync(join(ws, 'cans'), { recursive: true });
    const root = join(ws, 'cans');
    writeTextSync(join(root, '_rules.yaml'), example!);
    const rules = loadRules(root); // throws on any §18 violation
    expect(rules.agent_guardrails).toEqual({
      enabled: true,
      severity: 'error',
      isolation: { mode: 'require-target-prefix', prefix: 'target/agent-' },
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
  });

  test('the shipped template loads to the documented defaults (enabled: false)', () => {
    const ws = makeScratch('template-loads');
    mkdirSync(join(ws, 'cans'), { recursive: true });
    const root = join(ws, 'cans');
    writeTextSync(join(root, '_rules.yaml'), readFileSync(TEMPLATE_RULES, 'utf-8'));
    const rules = loadRules(root);
    expect(rules.agent_guardrails).toEqual(defaultAgentGuardrails());
    expect(rules.agent_guardrails!.enabled).toBe(false);
  });
});

// ── templates/AGENTS.md — the standardized implementation ──────────────────

describe('issue #63 — templates/AGENTS.md standardizes the agent workflow', () => {
  const template = () => readFileSync(TEMPLATE_AGENTS, 'utf-8');

  test('carries the ## Negative Invariants anchor exactly once', () => {
    const md = template();
    const anchors = md.split('\n').filter(l => l.trim() === '## Negative Invariants');
    expect(anchors.length).toBe(1);
  });

  test('the anchor has non-empty content beneath it (the engine predicate)', () => {
    const md = template();
    const lines = md.split('\n');
    const at = lines.findIndex(l => l.trim() === '## Negative Invariants');
    expect(at).toBeGreaterThanOrEqual(0);
    const beneath = lines
      .slice(at + 1)
      .slice(0, lines.findIndex((l, i) => i > at && /^## /.test(l)))
      .filter(l => l.trim() !== '');
    // Prose guidance AND at least one curated ban bullet — the section ships
    // non-empty, so a fresh init workspace satisfies negative_invariants.
    expect(beneath.length).toBeGreaterThanOrEqual(2);
    expect(beneath.some(l => l.trim().startsWith('- '))).toBe(true);
  });

  test('the Negative Invariants guidance matches the #63 framing', () => {
    const md = template();
    const at = md.indexOf('## Negative Invariants');
    const section = md.slice(at, md.indexOf('\n## ', at + 1));
    // Workspace-AUTHOR-curated hard boundaries, conflicts surfaced not
    // resolved — the issue's "omission of negative boundaries" answer.
    expect(section).toContain('AUTHOR');
    expect(section).toContain('forbidden');
    expect(section).toContain('_collab/conflicts.md');
  });

  test('prescribes the workspace guardrails workflow (devlog / manifests / isolation)', () => {
    const md = template();
    // The execution-policy section exists and names the three workflows:
    expect(md).toContain('## Agent Execution Policy');
    // eviction-survival handoff: append-only devlog with all three sections
    expect(md).toContain('log/devlog.md');
    for (const section of ['touched_files', 'test_outcomes', 'still_open']) {
      expect(md).toContain(section);
    }
    expect(md).toContain('append-only');
    // atomic writes on protected root manifests — copy-modify-swap, never
    // in-place rewrites
    expect(md).toContain('atomic swap');
    for (const manifest of ['Cargo.toml', 'package.json', 'pyproject.toml']) {
      expect(md).toContain(manifest);
    }
    // build only under the prefixed target dirs when isolation requires it
    expect(md).toContain('target/agent-');
    expect(md).toContain('require-target-prefix');
  });
});

// ── docs/cans.architecture.md — the §18 contract, every key present ────────

describe('issue #63 — docs/cans.architecture.md documents the shipped contract', () => {
  const doc = () => readFileSync(REPO_DOCS, 'utf-8');

  /** The §18 slice (Rules System) — the contract section for _rules.yaml. */
  function section(from: string, to: string): string {
    const md = doc();
    const a = md.indexOf(from);
    const b = md.indexOf(to, a);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThan(a);
    return md.slice(a, b);
  }

  test('§18 mentions every agent_guardrails contract key', () => {
    const s18 = section('## 18. Rules System', '## 19. Output System');
    for (const key of [
      'agent_guardrails',
      'enabled',
      'severity',
      'isolation',
      'manifests',
      'devlog',
      'negative_invariants',
      'require-target-prefix',
      'target/agent-',
      'atomic_writes_only',
      'protected',
      'log/devlog.md',
      'touched_files',
      'test_outcomes',
      'still_open',
      'Negative Invariants',
    ]) {
      expect(s18).toContain(key);
    }
  });

  test('§18 documents the OFF states and the parameter-section reconciliation exclusion', () => {
    const s18 = section('## 18. Rules System', '## 19. Output System');
    const guard = s18.slice(s18.indexOf('`agent_guardrails` (issue #63)')).replace(/\s+/g, ' ');
    expect(guard).toContain('enabled: false');
    expect(guard).toContain('NULL_OK');
    expect(guard).toContain('delete/override reconciliation');
    expect(guard).toContain('workspace-relative');
    // the four engine checks, with their predicates
    expect(guard).toContain('require-target-prefix');
    expect(guard).toContain('contention');
    expect(guard).toContain('in-place-mutation');
    expect(guard).toContain('Markdown heading');
    expect(guard).toContain('non-empty content beneath');
  });

  test('§17 lists the guardrails engine in the execution order', () => {
    const s17 = section('## 17. Engine Execution Order', '## 18. Rules System');
    expect(s17).toContain('checkAgentGuardrails');
    expect(s17).toContain('agent_guardrails.enabled');
  });

  test('§21 notes init emits the AGENTS.md policy block and the commented _rules.yaml example', () => {
    const s21 = section('## 21. `cans init`', '## 22. `cans check`');
    expect(s21).toContain('Agent Execution Policy');
    expect(s21).toContain('Negative Invariants');
    expect(s21).toContain('COMMENTED OUT');
  });
});

// ── end-to-end: cans init + cans check happy path with the new templates ───

describe('issue #63 — a fresh cans init workspace validates and checks clean', () => {
  test('init emits AGENTS.md + _rules.yaml; check runs with no config error, no errors', () => {
    const ws = makeScratch('init-happy');
    const r = runCli(['init', '--json'], ws);
    expect(r.exit).toBe(0);
    const init = JSON.parse(r.out);
    expect(init.ok).toBe(true);
    expect(init.created).toContain('AGENTS.md');
    expect(init.created).toContain('_rules.yaml');

    // The emitted files ARE the templates.
    expect(readTextSync(join(ws, 'cans', 'AGENTS.md'))).toEqual(readFileSync(TEMPLATE_AGENTS, 'utf-8'));
    expect(readTextSync(join(ws, 'cans', '_rules.yaml'))).toEqual(readFileSync(TEMPLATE_RULES, 'utf-8'));

    // loadRules: strictly valid, agent_guardrails = the documented defaults.
    const rules = loadRules(join(ws, 'cans'));
    expect(rules.agent_guardrails).toEqual(defaultAgentGuardrails());

    // check: the guardrails engine is silent (enabled: false) and the
    // workspace is clean — zero errors, no config section.
    const c = runCli(['check', '--json'], ws);
    expect(c.exit).toBeLessThanOrEqual(1); // warnings allowed, errors not
    const j = JSON.parse(c.out);
    expect(j.ok).toBe(true);
    expect(j.counts.errors).toBe(0);
    expect('config' in j.sections).toBe(false);
    expect(existsSync(join(ws, 'cans', 'log', 'devlog.md'))).toBe(false); // nothing supervised ⇒ nothing demanded
  });

  test('the emitted AGENTS.md satisfies the negative_invariants anchor predicate', () => {
    const ws = makeScratch('init-anchor');
    runCli(['init'], ws);
    const md = readTextSync(join(ws, 'cans', 'AGENTS.md'));
    const at = md.indexOf('## Negative Invariants');
    expect(at).toBeGreaterThanOrEqual(0);
    const beneath = md.slice(at + '## Negative Invariants'.length, md.indexOf('\n## ', at + 1));
    expect(beneath.trim().length).toBeGreaterThan(0);
  });
});

// ── local helpers ──────────────────────────────────────────────────────────

function parseTemplate(path: string): Record<string, unknown> {
  return parseMinimalYaml(readFileSync(path, 'utf-8'));
}

function writeTextSync(path: string, content: string): void {
  writeFileSync(path, content, 'utf8');
}
