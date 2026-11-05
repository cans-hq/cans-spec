/**
 * Issue #63 — `agent_guardrails`: the guardrails ENGINE
 * (checkAgentGuardrails, src/core/guardrails.ts) at unit level — every
 * predicate of the four checks, positive and negative, over scratch
 * workspaces. The checkWorkspace wiring, gates, severities and the
 * byte-identical pre-#63 contract live in issue-63-integration.test.ts.
 *
 * Predicates pinned here (the engine contract):
 *   - master switch: null / undefined / enabled:false → [] — the engine is
 *     silent for every pre-#63 config, whatever violations exist;
 *   - isolation (mode 'require-target-prefix'):
 *       (a) every ACTIVE task `_tasks/*.md` yaml-ish declaration
 *           (`target:` / `output:` / `build_dir:`, bullet-optional) must
 *           string-prefix-match the configured prefix after path
 *           normalization (`\`→`/`, `//` collapse, one `./` strip, trailing
 *           `/` trim); empty values, URIs and fenced lines declare nothing;
 *           archived tasks (`_tasks/_archive/`) are not active;
 *       (b) a root-level default build dir (`target/`, `dist/`, `build/`,
 *           `out/` — exactly these spellings, directories) is contention,
 *           EXCEPT the prefix's own root segment (`target/agent-` →
 *           `target/` is legal);
 *   - manifests.atomic_writes_only:
 *       (a) the devlog's `touched_files` section (case-insensitive heading,
 *           fence-aware, ends at the next heading of level <= its own)
 *           listing a protected manifest — path-boundary delimited, so
 *           `crates/Cargo.toml` never counts for root `Cargo.toml`;
 *       (b) residue files `<path>.bak|.orig|~|.tmp` beside a protected
 *           manifest (files only — a directory named `Cargo.toml.bak` is
 *           not residue evidence);
 *   - devlog.enabled: the file must exist and carry every required_sections
 *     entry as a Markdown heading (any #..###### level, case-insensitive
 *     after trim); missing file → one finding, missing sections → ONE
 *     finding naming them;
 *   - negative_invariants.required: AGENTS.md must exist, carry a heading
 *     EXACTLY equal to the anchor (case-sensitive — check 3 is the
 *     case-insensitive one, per the issue's differing spellings), with at
 *     least one non-empty content line beneath it before the next heading
 *     of level <= its own;
 *   - severity 'error' → level error, 'warn' → warning; every finding:
 *     category 'structure', `guardrails.*` rule key, message naming the
 *     file + violated `_rules.yaml` key, non-empty suggestion; deterministic
 *     order (task files sorted, fixed dir/suffix orders, config-order
 *     manifests).
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

import { checkAgentGuardrails } from '../../src/core/guardrails.ts';
import { loadRules } from '../../src/core/rules.ts';
import type { AgentGuardrailsRules, Issue } from '../../src/types.ts';
import { REPO } from '../runtime.ts';

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-63-engine');
const createdDirs: string[] = [];
let wsSeq = 0;

/** Fresh scratch workspace (the cans/ root the engine takes). */
function makeWs(name: string, files: Record<string, string> = {}, dirs: string[] = []): string {
  const root = join(SCRATCH, `${name}-${++wsSeq}`);
  mkdirSync(root, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, content, 'utf8');
  }
  for (const d of dirs) mkdirSync(join(root, d), { recursive: true });
  createdDirs.push(root);
  return root;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    rmSync(createdDirs.pop()!, { recursive: true, force: true });
  }
});

/** The documented default block (core/rules.ts defaultAgentGuardrails), with
 *  the master switch ON — everything fires. Used by g1/g8 (whole-engine
 *  behavior); the per-check suites use `only()` below. */
function cfg(over?: Partial<AgentGuardrailsRules>): AgentGuardrailsRules {
  return {
    enabled: true,
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
    ...over,
  };
}

/** cfg with every SUB-CHECK off except the ones `over` turns on — the
 *  per-check predicate suites stay isolated from the other checks' verdicts. */
function only(over: Partial<AgentGuardrailsRules> = {}): AgentGuardrailsRules {
  return cfg({
    manifests: { atomic_writes_only: false, protected: ['Cargo.toml'] },
    devlog: { enabled: false, path: 'log/devlog.md', required_sections: ['touched_files'] },
    negative_invariants: { required: false, anchor: 'Negative Invariants' },
    ...over,
  });
}

/** The isolation check, on, with a configurable prefix. */
function isolationCfg(prefix = 'target/agent-'): AgentGuardrailsRules {
  return only({ isolation: { mode: 'require-target-prefix', prefix } });
}

/** The manifests check, on, with the documented default protected list. */
function manifestsOnly(over: Partial<AgentGuardrailsRules> = {}): AgentGuardrailsRules {
  return only({
    manifests: { atomic_writes_only: true, protected: ['Cargo.toml', 'package.json', 'pyproject.toml'] },
    ...over,
  });
}

const REQUIRES_PREFIX = { mode: 'require-target-prefix' } as const;

// ── g1: the master switch ────────────────────────────────────────────────────

describe('issue #63 g1 — the master switch: disabled / absent / null is silent', () => {
  // A maximally violating workspace: every check would fire if enabled.
  const files = {
    '_tasks/build-api.md': '# build-api\n- target: target/debug\n',
    'log/devlog.md': '# Devlog\n',
    'Cargo.toml.bak': '[package]\n',
    // AGENTS.md deliberately absent; default build dirs created via dirs.
  };

  test('null / undefined → []', () => {
    const root = makeWs('g1-null', files, ['target', 'dist']);
    expect(checkAgentGuardrails(root, null)).toEqual([]);
    expect(checkAgentGuardrails(root, undefined)).toEqual([]);
  });

  test('enabled: false → [] even with violations in every check', () => {
    const root = makeWs('g1-off', files, ['target', 'dist', 'build']);
    expect(checkAgentGuardrails(root, cfg({ enabled: false }))).toEqual([]);
  });
});

// ── g2: isolation (a) — active task build-dir declarations ───────────────────

describe('issue #63 g2 — isolation (a): task build dirs must sit under the prefix', () => {
  test('the violating declaration: file, line, rule, message, suggestion', () => {
    const root = makeWs('g2-basic', {
      '_tasks/build-api.md': '# build-api\n- Owner: agent-1\n- target: target/debug\n',
    });
    const issues = checkAgentGuardrails(root, isolationCfg());
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      file: '_tasks/build-api.md',
      line: 3,
      rule: 'guardrails.isolation.task_build_dir',
      category: 'structure',
      level: 'error',
    });
    expect(issues[0]!.message).toContain('target/debug');
    expect(issues[0]!.message).toContain('agent_guardrails.isolation.prefix');
    expect(issues[0]!.message).toContain('target/agent-');
    expect(issues[0]!.suggestion).toContain('target/agent-');
  });

  test('all three key spellings fire; bullet and bare forms both read', () => {
    const root = makeWs('g2-keys', {
      '_tasks/a.md': '- target: dist\n',
      '_tasks/b.md': 'output: out/\n',
      '_tasks/c.md': '  build_dir: "build/x"\n',
    });
    const issues = checkAgentGuardrails(root, isolationCfg());
    expect(issues).toHaveLength(3);
    expect(issues.map(i => i.file)).toEqual(['_tasks/a.md', '_tasks/b.md', '_tasks/c.md']); // discoverActiveTasks order
    expect(issues.map(i => i.line)).toEqual([1, 1, 1]);
    expect(issues.map(i => i.message)).toEqual([
      expect.stringContaining('declares target: dist'),
      expect.stringContaining('declares output: out'),
      expect.stringContaining('declares build_dir: build/x'),
    ]);
  });

  test('normalization: ./, //, trailing slash and quotes all satisfy the prefix; a prefixed value never fires', () => {
    const root = makeWs('g2-normalize', {
      '_tasks/a.md': '- target: ./target/agent-a\n',
      '_tasks/b.md': '- output: target//agent-b/\n',
      '_tasks/c.md': '- build_dir: "target/agent-c/"\n',
      '_tasks/d.md': '- target: target/agent-\n', // the prefix itself is legal
    });
    expect(checkAgentGuardrails(root, isolationCfg())).toEqual([]);
  });

  test('declares nothing: empty value, URI value, fenced example — all skipped', () => {
    const root = makeWs('g2-nothing', {
      '_tasks/a.md': [
        '- target:',
        '- output: https://example.invalid/out',
        '```',
        'target: target/debug   # fenced _rules.yaml example — prose, not a declaration',
        '```',
        '',
      ].join('\n'),
    });
    expect(checkAgentGuardrails(root, isolationCfg())).toEqual([]);
  });

  test('archived tasks are not active: _tasks/_archive/*.md is never scanned', () => {
    const root = makeWs('g2-archive', {
      '_tasks/_archive/done-thing.md': '- target: target/debug\n',
    });
    expect(checkAgentGuardrails(root, isolationCfg())).toEqual([]);
  });

  test('mode off (default) → silent even with violating declarations', () => {
    const root = makeWs('g2-off', { '_tasks/build-api.md': '- target: target/debug\n' });
    expect(checkAgentGuardrails(root, only())).toEqual([]); // isolation.mode 'off'
  });

  test('a custom prefix re-aims the predicate', () => {
    const root = makeWs('g2-custom', {
      '_tasks/a.md': '- output: out/agents-a\n',
      '_tasks/b.md': '- output: build/x\n',
    });
    const issues = checkAgentGuardrails(root, isolationCfg('out/agents-'));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.file).toBe('_tasks/b.md');
    expect(issues[0]!.message).toContain('prefix is "out/agents-"');
  });

  test('multiple violations: deterministic order (task file, then source line)', () => {
    const root = makeWs('g2-order', {
      '_tasks/b.md': '- target: dist\n- output: out\n',
      '_tasks/a.md': '- target: build\n',
    });
    const issues = checkAgentGuardrails(root, isolationCfg());
    expect(issues.map(i => `${i.file}:${i.line}`)).toEqual([
      '_tasks/a.md:1',
      '_tasks/b.md:1',
      '_tasks/b.md:2',
    ]);
  });

  test('the same task file may violate twice — one finding per offending declaration', () => {
    const root = makeWs('g2-twice', {
      '_tasks/a.md': '- target: dist\n- output: out\n',
    });
    const issues = checkAgentGuardrails(root, isolationCfg());
    expect(issues).toHaveLength(2);
    expect(issues[0]!.line).toBe(1);
    expect(issues[1]!.line).toBe(2);
  });
});

// ── g3: isolation (b) — shared default build dirs at the root ────────────────

describe('issue #63 g3 — isolation (b): root-level default build dirs are contention', () => {
  test('target/ is exempt under the target/agent- prefix; every other default fires', () => {
    const root = makeWs('g3-exempt', {}, ['target', 'dist', 'build', 'out']);
    const issues = checkAgentGuardrails(root, isolationCfg());
    // Exactly the four spellings, root level only; 'target' hosts the
    // prefixed agent dirs → legal. Order: the issue's fixed list.
    expect(issues.map(i => i.file)).toEqual(['dist/', 'build/', 'out/']);
    for (const i of issues) {
      expect(i.line).toBe(0);
      expect(i.rule).toBe('guardrails.isolation.default_build_dir');
      expect(i.message).toContain('agent_guardrails.isolation.mode');
    }
  });

  test('exactly these four spellings — a lookalike dir (targets/, Target/, output/) is not one', () => {
    const root = makeWs('g3-spellings', {}, ['targets', 'Target', 'output']);
    expect(checkAgentGuardrails(root, isolationCfg())).toEqual([]);
  });

  test('the exemption follows the prefix: out/agents- exempts out/, flags target/', () => {
    const root = makeWs('g3-custom-prefix', {}, ['out', 'target']);
    const issues = checkAgentGuardrails(root, isolationCfg('out/agents-'));
    expect(issues.map(i => i.file)).toEqual(['target/']);
  });

  test('nested defaults are not root-level: a/dist/ is out of scope', () => {
    const root = makeWs('g3-nested', {}, ['a/dist']);
    expect(checkAgentGuardrails(root, isolationCfg())).toEqual([]);
  });

  test('mode off → no dir findings even with all four present', () => {
    const root = makeWs('g3-off', {}, ['target', 'dist', 'build', 'out']);
    expect(checkAgentGuardrails(root, only())).toEqual([]);
  });

  test('isolated: an isolated ON check ignores devlog/AGENTS.md state entirely', () => {
    // The g2/g3 workspaces carry no devlog and no AGENTS.md on purpose: the
    // finding list above proves the other sub-checks stayed silent.
    const root = makeWs('g3-iso', { '_tasks/x.md': '- target: target/agent-x\n' }, ['dist']);
    const issues = checkAgentGuardrails(root, isolationCfg());
    expect(issues.map(i => i.rule)).toEqual(['guardrails.isolation.default_build_dir']);
  });
});

// ── g4: manifests (a) — devlog touched_files listing a protected manifest ────

describe('issue #63 g4 — manifests (a): devlog touched_files listing a protected manifest', () => {
  const DEVLOG = [
    '# Devlog',
    '',
    '## touched_files',
    '- Cargo.toml (added a dependency)',
    '- src/main.rs',
    '',
    '## notes',
    '- also peeked at package.json here — but this is BELOW a same-level heading',
    '',
  ].join('\n');

  test('the listing: one finding per manifest, at the listing line, naming the manifest', () => {
    const root = makeWs('g4-basic', { 'log/devlog.md': DEVLOG });
    const issues = checkAgentGuardrails(root, manifestsOnly());
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      file: 'log/devlog.md',
      line: 4,
      rule: 'guardrails.manifests.devlog_touched',
      category: 'structure',
      level: 'error',
    });
    expect(issues[0]!.message).toContain('Cargo.toml');
    expect(issues[0]!.message).toContain('agent_guardrails.manifests.atomic_writes_only');
    expect(issues[0]!.suggestion).toContain('copy-modify-swap');
  });

  test('path boundaries: crates/Cargo.toml and Cargo.toml.bak never count for root Cargo.toml', () => {
    const root = makeWs('g4-boundary', {
      'log/devlog.md': [
        '## touched_files',
        '- crates/Cargo.toml',
        '- Cargo.toml.bak (renamed away)',
        '- my-package.jsonx',
        '',
      ].join('\n'),
    });
    expect(checkAgentGuardrails(root, manifestsOnly())).toEqual([]);
  });

  test('punctuation-delimited spellings count: "- package.json", "(pyproject.toml)", "Cargo.toml:"', () => {
    const root = makeWs('g4-delimited', {
      'log/devlog.md': [
        '## touched_files',
        '- edited package.json',
        'wrote (pyproject.toml) by hand',
        'Cargo.toml: bumped the dep',
        '',
      ].join('\n'),
    });
    const issues = checkAgentGuardrails(root, manifestsOnly());
    expect(issues).toHaveLength(3);
    // Findings iterate the PROTECTED config order (Cargo.toml, package.json,
    // pyproject.toml); each carries its own first listing line.
    expect(issues.map(i => i.line)).toEqual([4, 2, 3]);
    expect(issues.map(i => i.message)).toEqual([
      expect.stringContaining('lists Cargo.toml'),
      expect.stringContaining('lists package.json'),
      expect.stringContaining('lists pyproject.toml'),
    ]);
  });

  test('the section ends at the next heading of level <= its own; deeper headings stay inside', () => {
    const root = makeWs('g4-sections', {
      'log/devlog.md': [
        '## touched_files',
        '### nested entry',
        '- package.json listed under a deeper heading — still the section',
        '',
        '## next section',
        '- pyproject.toml listed OUTSIDE the section — never counts',
        '',
      ].join('\n'),
    });
    const issues = checkAgentGuardrails(root, manifestsOnly());
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('package.json');
    expect(issues[0]!.message).not.toContain('pyproject.toml');
  });

  test('fenced lines are prose, not listings', () => {
    const root = makeWs('g4-fence', {
      'log/devlog.md': [
        '## touched_files',
        '```',
        '- Cargo.toml   # example snippet, not a listing',
        '```',
        '',
      ].join('\n'),
    });
    expect(checkAgentGuardrails(root, manifestsOnly())).toEqual([]);
  });

  test('multiple protected manifests listed → findings in protected config order', () => {
    const root = makeWs('g4-order', {
      'log/devlog.md': [
        '## touched_files',
        '- package.json and Cargo.toml and pyproject.toml',
        '',
      ].join('\n'),
    });
    const issues = checkAgentGuardrails(root, manifestsOnly());
    expect(issues).toHaveLength(3);
    expect(issues.map(i => i.line)).toEqual([2, 2, 2]); // one finding per manifest
    expect(issues.map(i => i.message)).toEqual([
      expect.stringContaining('lists Cargo.toml'),
      expect.stringContaining('lists package.json'),
      expect.stringContaining('lists pyproject.toml'),
    ]);
  });

  test('switch off / no devlog file / custom devlog path', () => {
    const violated = '## touched_files\n- Cargo.toml\n';
    expect(checkAgentGuardrails(
      makeWs('g4-off', { 'log/devlog.md': violated }),
      only({ manifests: { atomic_writes_only: false, protected: ['Cargo.toml'] } }),
    )).toEqual([]);
    // No devlog file: nothing to inspect for (a) — check 3 owns the missing-file finding.
    expect(checkAgentGuardrails(makeWs('g4-absent'), manifestsOnly())).toEqual([]);
    // The devlog path is the configured one even when devlog.enabled is false:
    // a file sitting at the canonical location is still evidence.
    const custom = manifestsOnly({ devlog: { enabled: false, path: 'log/agent-log.md', required_sections: ['touched_files'] } });
    const root = makeWs('g4-custom', { 'log/agent-log.md': violated });
    const issues = checkAgentGuardrails(root, custom);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.file).toBe('log/agent-log.md');
  });
});

// ── g5: manifests (b) — atomic-write residue beside a protected manifest ─────

describe('issue #63 g5 — manifests (b): residue files beside a protected manifest', () => {
  test('each residue suffix fires once, file field = the residue path', () => {
    const root = makeWs('g5-basic', {
      'Cargo.toml': '[package]\n',
      'Cargo.toml.bak': '[package]\n',
      'Cargo.toml.orig': '[package]\n',
      'Cargo.toml~': '[package]\n',
      'Cargo.toml.tmp': '[package]\n',
    });
    const issues = checkAgentGuardrails(root, manifestsOnly());
    expect(issues.map(i => i.file)).toEqual([
      'Cargo.toml.bak', 'Cargo.toml.orig', 'Cargo.toml~', 'Cargo.toml.tmp',
    ]); // the fixed suffix order
    for (const i of issues) {
      expect(i.line).toBe(0);
      expect(i.rule).toBe('guardrails.manifests.residue');
      expect(i.message).toContain('agent_guardrails.manifests.atomic_writes_only');
      expect(i.message).toContain('Cargo.toml');
      expect(i.suggestion).not.toBe('');
    }
  });

  test('residue is per protected manifest only: src/main.rs.bak is out of scope', () => {
    const root = makeWs('g5-scope', {
      'package.json': '{}\n',
      'src/main.rs.bak': 'fn main() {}\n',
    });
    expect(checkAgentGuardrails(root, manifestsOnly())).toEqual([]);
  });

  test('a DIRECTORY named Cargo.toml.bak is not residue (files only)', () => {
    const root = makeWs('g5-dir', {}, ['Cargo.toml.bak']);
    expect(checkAgentGuardrails(root, manifestsOnly())).toEqual([]);
  });

  test('switch off → silent even with residue', () => {
    const root = makeWs('g5-off', { 'Cargo.toml.bak': '[package]\n' });
    expect(checkAgentGuardrails(
      root,
      only({ manifests: { atomic_writes_only: false, protected: ['Cargo.toml'] } }),
    )).toEqual([]);
  });
});

// ── g6: devlog — required sections as Markdown headings ──────────────────────

describe('issue #63 g6 — devlog: the handoff log must exist and carry its sections', () => {
  const DEVLOG_SECTIONS = ['touched_files', 'test_outcomes', 'still_open'];

  test('missing file → exactly one finding naming the path', () => {
    const root = makeWs('g6-missing');
    const issues = checkAgentGuardrails(root, only({ devlog: { enabled: true, path: 'log/devlog.md', required_sections: DEVLOG_SECTIONS } }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      file: 'log/devlog.md',
      line: 0,
      rule: 'guardrails.devlog.missing_file',
      category: 'structure',
      level: 'error',
    });
    // the remediation names the required sections
    expect(issues[0]!.suggestion).toContain('touched_files');
    expect(issues[0]!.suggestion).toContain('test_outcomes');
    expect(issues[0]!.suggestion).toContain('still_open');
  });

  test('a file carrying every section (mixed levels, case-insensitive) is clean', () => {
    const root = makeWs('g6-clean', {
      'log/devlog.md': [
        '# Devlog',
        '## TOUCHED_FILES',
        '### test_outcomes', // any #..###### level counts
        '###### Still_Open',
        '',
      ].join('\n'),
    });
    expect(checkAgentGuardrails(root, only({ devlog: { enabled: true, path: 'log/devlog.md', required_sections: DEVLOG_SECTIONS } }))).toEqual([]);
  });

  test('missing sections → ONE finding naming them, in config order', () => {
    const root = makeWs('g6-partial', {
      'log/devlog.md': '# Devlog\n## touched_files\n- 01-core.md\n',
    });
    const issues = checkAgentGuardrails(root, only({ devlog: { enabled: true, path: 'log/devlog.md', required_sections: DEVLOG_SECTIONS } }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.rule).toBe('guardrails.devlog.missing_sections');
    expect(issues[0]!.file).toBe('log/devlog.md');
    expect(issues[0]!.message).toContain('"test_outcomes", "still_open"');
  });

  test('near-miss headings do not count: hyphenated/spaced spellings differ from the section name', () => {
    const root = makeWs('g6-near-miss', {
      'log/devlog.md': [
        '# Devlog',
        '## Touched Files', // space, not underscore — no match (case-insensitive ≠ shape-blind)
        '## test-outcomes',
        '## still open',
        '',
      ].join('\n'),
    });
    const issues = checkAgentGuardrails(root, only({ devlog: { enabled: true, path: 'log/devlog.md', required_sections: DEVLOG_SECTIONS } }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.rule).toBe('guardrails.devlog.missing_sections');
  });

  test('a fenced heading is not a heading (the file exists; every section is fenced prose)', () => {
    const root = makeWs('g6-fence', {
      'log/devlog.md': [
        '```markdown',
        '## touched_files',
        '## test_outcomes',
        '## still_open',
        '```',
        '',
      ].join('\n'),
    });
    const issues = checkAgentGuardrails(root, only({ devlog: { enabled: true, path: 'log/devlog.md', required_sections: DEVLOG_SECTIONS } }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.rule).toBe('guardrails.devlog.missing_sections');
  });

  test('devlog disabled → silent even when the file is absent', () => {
    const root = makeWs('g6-off');
    expect(checkAgentGuardrails(
      root,
      only({ devlog: { enabled: false, path: 'log/devlog.md', required_sections: DEVLOG_SECTIONS } }),
    )).toEqual([]);
  });

  test('a custom path is honored', () => {
    const root = makeWs('g6-custom', {
      'log/agent-log.md': '# Agent log\n## touched_files\n## test_outcomes\n## still_open\n',
    });
    const issues = checkAgentGuardrails(
      root,
      only({ devlog: { enabled: true, path: 'log/agent-log.md', required_sections: DEVLOG_SECTIONS } }),
    );
    expect(issues).toEqual([]);
    // …and the default path stays missing in that same workspace:
    const defaultPath = checkAgentGuardrails(
      root,
      only({ devlog: { enabled: true, path: 'log/devlog.md', required_sections: DEVLOG_SECTIONS } }),
    );
    expect(defaultPath.map(i => i.rule)).toEqual(['guardrails.devlog.missing_file']);
  });
});

// ── g7: negative invariants — the AGENTS.md anchor block ─────────────────────

describe('issue #63 g7 — negative invariants: AGENTS.md anchor with content beneath', () => {
  const INVARIANTS = { required: true, anchor: 'Negative Invariants' } as const;

  test('missing AGENTS.md → one finding', () => {
    const root = makeWs('g7-missing');
    const issues = checkAgentGuardrails(root, only({ negative_invariants: { ...INVARIANTS } }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      file: 'AGENTS.md',
      line: 0,
      rule: 'guardrails.invariants.missing_file',
      category: 'structure',
      level: 'error',
    });
  });

  test('anchor absent → one finding naming the anchor text', () => {
    const root = makeWs('g7-no-anchor', { 'AGENTS.md': '# Agent instructions\n- be nice\n' });
    const issues = checkAgentGuardrails(root, only({ negative_invariants: { ...INVARIANTS } }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.rule).toBe('guardrails.invariants.missing_anchor');
    expect(issues[0]!.message).toContain('Negative Invariants');
  });

  test('anchor text is EXACT (case-sensitive) — lowercase heading does not match', () => {
    const root = makeWs('g7-case', {
      'AGENTS.md': '# negative invariants\n- never edit Cargo.toml in place\n',
    });
    const issues = checkAgentGuardrails(root, only({ negative_invariants: { ...INVARIANTS } }));
    expect(issues.map(i => i.rule)).toEqual(['guardrails.invariants.missing_anchor']);
  });

  test('anchor with content beneath (any level) → clean', () => {
    const root = makeWs('g7-clean', {
      'AGENTS.md': [
        '# Agent instructions',
        '',
        '## Negative Invariants',
        '- never edit Cargo.toml in place',
        '',
        '## Workflow',
        '- always run cans check',
        '',
      ].join('\n'),
    });
    expect(checkAgentGuardrails(root, only({ negative_invariants: { ...INVARIANTS } }))).toEqual([]);
  });

  test('empty block: the heading with nothing beneath before a same/lower-level heading → finding at the anchor line', () => {
    const root = makeWs('g7-empty', {
      'AGENTS.md': '# Agent instructions\n## Negative Invariants\n## Workflow\n- always run cans check\n',
    });
    const issues = checkAgentGuardrails(root, only({ negative_invariants: { ...INVARIANTS } }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      file: 'AGENTS.md',
      line: 2, // the anchor heading's own line
      rule: 'guardrails.invariants.empty_block',
    });
  });

  test('the block extends through deeper headings: content under a ### inside the block counts', () => {
    const root = makeWs('g7-deep', {
      'AGENTS.md': [
        '## Negative Invariants',
        '### Dependencies',
        '- never add a database driver',
        '',
        '## Workflow',
        '- always run cans check',
        '',
      ].join('\n'),
    });
    expect(checkAgentGuardrails(root, only({ negative_invariants: { ...INVARIANTS } }))).toEqual([]);
  });

  test('content AFTER the next same-level heading does not rescue an empty block', () => {
    const root = makeWs('g7-after', {
      'AGENTS.md': [
        '### Negative Invariants',
        '### Workflow',
        '- always run cans check',
        '',
      ].join('\n'),
    });
    const issues = checkAgentGuardrails(root, only({ negative_invariants: { ...INVARIANTS } }));
    expect(issues.map(i => i.rule)).toEqual(['guardrails.invariants.empty_block']);
    expect(issues[0]!.line).toBe(1);
  });

  test('switch off → silent even with AGENTS.md absent', () => {
    const root = makeWs('g7-off');
    expect(checkAgentGuardrails(root, only({ negative_invariants: { required: false, anchor: 'Negative Invariants' } }))).toEqual([]);
  });
});

// ── g8: severity, vocabulary and determinism ─────────────────────────────────

describe('issue #63 g8 — severity band, rule vocabulary, deterministic order', () => {
  // One workspace violating EVERY check at once.
  const files = {
    '_tasks/build-api.md': '- target: target/debug\n',
    'log/devlog.md': '## touched_files\n- package.json\n',
    'Cargo.toml.bak': '[package]\n',
    // AGENTS.md absent; dist/ created via dirs.
  };

  test("severity 'error' → every finding level error; 'warn' → every finding level warning", () => {
    // isolation on too — the workspace violates every check at once.
    const full = { isolation: { mode: 'require-target-prefix', prefix: 'target/agent-' } } as const;
    const err = checkAgentGuardrails(makeWs('g8-err', files, ['dist']), cfg({ ...full, severity: 'error' }));
    expect(err.length).toBeGreaterThanOrEqual(5);
    expect(err.every(i => i.level === 'error')).toBe(true);

    const warn = checkAgentGuardrails(makeWs('g8-warn', files, ['dist']), cfg({ ...full, severity: 'warn' }));
    expect(warn.map(i => i.rule)).toEqual(err.map(i => i.rule)); // identical verdicts, band only
    expect(warn.every(i => i.level === 'warning')).toBe(true);
  });

  test('every finding: category structure, guardrails.* rule, message names the config key, suggestion present', () => {
    const issues = checkAgentGuardrails(
      makeWs('g8-vocab', files, ['dist']),
      cfg({ isolation: { mode: 'require-target-prefix', prefix: 'target/agent-' } }),
    );
    expect(issues.length).toBeGreaterThanOrEqual(5);
    for (const i of issues as Issue[]) {
      expect(i.category).toBe('structure');
      expect(i.rule!.startsWith('guardrails.')).toBe(true);
      expect(i.message).toContain('agent_guardrails.');
      expect(i.suggestion).not.toBe('');
      expect(i.file).not.toBe('');
    }
  });

  test('deterministic: two identical workspaces → identical finding lists', () => {
    const a = checkAgentGuardrails(makeWs('g8-det-a', files, ['dist', 'build']), cfg());
    const b = checkAgentGuardrails(makeWs('g8-det-b', files, ['dist', 'build']), cfg());
    expect(a).toEqual(b);
  });

  test('the rules seam: a real _rules.yaml agent_guardrails block loads and drives the engine (loadRules contract)', () => {
    // Exercises the full seam at unit scope: the YAML block the config agent
    // implemented flows through loadRules into this engine's exact shape.
    const root = makeWs('g8-seam', {
      '_rules.yaml': [
        'agent_guardrails:',
        '  enabled: true',
        '  isolation:',
        `    mode: ${REQUIRES_PREFIX.mode}`,
        '    prefix: "target/agent-"',
        '  devlog:',
        '    enabled: false',
        '  negative_invariants:',
        '    required: false',
        '',
      ].join('\n'),
      '_tasks/build-api.md': '- target: target/debug\n',
    });
    const issues = checkAgentGuardrails(root, loadRules(root).agent_guardrails);
    expect(issues.map(i => i.rule)).toEqual(['guardrails.isolation.task_build_dir']);
  });
});
