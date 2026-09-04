/**
 * QA-03 red-test verification — Redundancy / Overflow / Rules / Token Budget.
 *
 * Each test encodes the DOCUMENTED contract (docs/cans.architecture.md § + QA-03
 * finding ID) via blackbox CLI spawn. Because the implementation currently
 * violates the documented contract, every non-control test MUST currently FAIL
 * with an assertion failure (never a crash, never asserting buggy behavior).
 *
 * Findings under test (agents/qa/QA-03-check-engines-redundancy-overflow-rules.md):
 *   F1  (MAJOR) §18 "delete a key = check turns off" not implemented
 *   F2  (MAJOR) §18 malformed _rules.yaml crashes with internal error, exit 2
 *   F3  (MAJOR) §26 step 3 active-task tier missing from `budget read`
 *   F4  (MAJOR) §19 `budget write <unknown>` exits 0 instead of 1
 *   F5  (MAJOR) §37 unknown `budget` subcommand silently runs as `read`
 *   F6  (MINOR) §16/§18 overflow.force_file_for is inert
 *   F7  (MINOR) §13 phrase overlap: ≥ 70% boundary + stopword normalization
 *   F8  (MINOR) §13 L3 fuzzy fires on synonym-matched pairs
 *   F9  (MINOR) §37 budget outside a workspace gives no explanation
 *   F10 (MINOR) §16 no-chaining rule (see: inside overflow target) not enforced
 *   F11 (MINOR) §18 token_budget.warn_threshold is inert
 */
import { describe, test, expect, afterEach, afterAll } from 'bun:test';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync, cpSync } from 'fs';

const REPO = join(import.meta.dir, '..', '..');
const CLI = join(REPO, 'src', 'cli.ts');
const SCRATCH = join(REPO, '.tmp', 'qa-verify', 'qa-03');
const FIXTURES = join(REPO, 'test', 'fixtures');

// ── helpers ─────────────────────────────────────────────────────────────

/** Strip CANS_ROOT so spawn cwd (never the ambient env) drives workspace discovery. */
function spawnEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== 'CANS_ROOT' && v !== undefined) env[k] = v;
  }
  return env;
}

function runCli(args: string[], cwd: string): { exit: number | null; out: string; err: string } {
  const p = Bun.spawnSync(['bun', 'run', CLI, ...args], { cwd, env: spawnEnv(), stdout: 'pipe', stderr: 'pipe' });
  return { exit: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}

/** Unique scratch workspace per test: <SCRATCH>/<name>/cans/ (gitignored .tmp). */
function freshWs(name: string): string {
  const dir = join(SCRATCH, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'cans'), { recursive: true });
  return dir;
}

function writeSpec(ws: string, name: string, content: string): void {
  writeFileSync(join(ws, 'cans', name), content);
}

function writeRules(ws: string, content: string): void {
  writeFileSync(join(ws, 'cans', '_rules.yaml'), content);
}

function copyFixture(ws: string, fixture: string): void {
  cpSync(join(FIXTURES, fixture), join(ws, 'cans'), { recursive: true });
}

function parseJson(out: string): any {
  return JSON.parse(out);
}

afterEach(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

// Documented default rules (§18 / templates/_rules.yaml) minus the whole
// `redundancy:` section — the F1(a) "delete a key" construction.
const TEMPLATE_MINUS_REDUNDANCY = `structure:
  node_length: { min: 3, max: 120 }
  siblings: { min: 1, max: 12 }
  depth: { min: 1, max: 5 }
  single_child_collapse: true
  empty_nodes: false

style:
  prefer: sibling
  force_nested_above: 6
  force_sibling_below: 3
  shared_prefix_detection: true

content:
  tbd_allowed: true
  max_tbd_per_file: 5

references:
  mode: pointer
  back_pointers: true
  max_hops: 1
  orphan_check: true
  duplicate_home_check: true

token_budget:
  enabled: true
  default_limit: 4096
  estimate_chars_per_token: 3.5
  warn_threshold: 0.8

overflow:
  max_node_chars: 200
  force_file_for: [code_block, table, diagram]
`;

// Documented redundancy defaults (§18) with the `enabled` key deleted — F1(b).
const REDUNDANCY_SECTION_NO_ENABLED = `redundancy:
  word_frequency_threshold: 4
  phrase_overlap_threshold: 0.7
  cross_file_threshold: 2
  stopwords: [the, a, an, of, to, in, for, and, or, with, must, shall, requires]
  synonyms:
    - [postgres, postgresql, pg]
    - [auth, authentication, sign-in, signin]
    - [api, endpoint, route]
    - [frontend, client, ui]
    - [db, database, storage]
`;

describe('QA-03 F1 — §18 "delete a key = check turns off"', () => {
  test('F1a: full defaults minus the whole redundancy: section → word-frequency check is OFF', () => {
    const ws = freshWs('f1a-delete-section');
    copyFixture(ws, 'redundancy-project'); // fixture fires "authentication" × 6 with defaults
    writeRules(ws, TEMPLATE_MINUS_REDUNDANCY);

    const r = runCli(['check', '--json'], ws);
    // §19: warnings never affect exit code — the run itself must succeed
    expect(r.exit).toBe(0);
    const data = parseJson(r.out);
    // §18 "Delete a key = check turns off": with the redundancy: section deleted,
    // no redundancy issue may fire (the ×6 "authentication" warning must be gone).
    const redundancyIssues = data.issues.filter((i: any) => i.category === 'redundancy');
    expect(redundancyIssues).toEqual([]);
  });

  test('F1b: redundancy: section present but enabled key deleted → check is OFF', () => {
    const ws = freshWs('f1b-delete-enabled');
    copyFixture(ws, 'redundancy-project');
    writeRules(ws, REDUNDANCY_SECTION_NO_ENABLED);

    const r = runCli(['check', '--json'], ws);
    expect(r.exit).toBe(0);
    const data = parseJson(r.out);
    // §18: `enabled` is a deleted key inside an existing section → check off.
    const redundancyIssues = data.issues.filter((i: any) => i.category === 'redundancy');
    expect(redundancyIssues).toEqual([]);
  });

  test('F1c: references: section with orphan_check deleted → orphan warnings OFF', () => {
    const ws = freshWs('f1c-delete-orphan-check');
    // Two ref-less spec files → both are orphans while orphan_check is on.
    writeSpec(ws, '01-alpha.md', '- Alpha\n  - Alpha setup\n');
    writeSpec(ws, '02-beta.md', '- Beta\n  - Beta setup\n');
    writeRules(
      ws,
      `references:
  mode: pointer
  back_pointers: true
  max_hops: 1
  duplicate_home_check: true
`,
    );

    const r = runCli(['check', '--json'], ws);
    const data = parseJson(r.out);
    // §18: orphan_check key deleted → the orphan check must turn off;
    // no issue may report "orphan: <file> has no incoming or outgoing refs".
    const orphanIssues = data.issues.filter((i: any) => i.message.includes('orphan'));
    expect(orphanIssues).toEqual([]);
  });
});

describe('QA-03 F2 — §18 invalid _rules.yaml: line-numbered config error, exit 1', () => {
  // Both malformed shapes below PARSE as valid mini-YAML but produce a
  // type-inconsistent rules tree; §18 still classes them as invalid config:
  // the user gets a line-numbered `_rules.yaml` error + exit 1 (§19
  // user-correctable), and §37 forbids internal-error leakage.

  test('F2a: `structure: 42` (scalar where a mapping belongs) → exit 1 + _rules.yaml line error', () => {
    const ws = freshWs('f2a-structure-scalar');
    writeSpec(ws, '01-alpha.md', '- Alpha\n  - Alpha setup\n');
    writeRules(ws, 'structure: 42\n');

    const r = runCli(['check'], ws);
    const combined = r.out + r.err;
    expect(r.exit).toBe(1); // §18/§19: config error = user-correctable failure, NOT exit 2
    expect(combined).toContain('_rules.yaml'); // names the offending file
    expect(combined).toMatch(/line \d+/); // §18: "print line number"
    expect(combined).not.toContain('Internal error'); // §37: never leak internal errors
  });

  test('F2b: tab-indented line under `structure:` → exit 1 + _rules.yaml line error', () => {
    const ws = freshWs('f2b-tab-indent');
    writeSpec(ws, '01-alpha.md', '- Alpha\n  - Alpha setup\n');
    writeRules(ws, 'structure:\n\tnode_length: { min: 3, max: 120 }\n');

    const r = runCli(['check'], ws);
    const combined = r.out + r.err;
    expect(r.exit).toBe(1);
    expect(combined).toContain('_rules.yaml');
    expect(combined).toMatch(/line \d+/);
    expect(combined).not.toContain('Internal error');
  });
});

describe('QA-03 F3 — §26 step 3: active-task tier in `budget read`', () => {
  test('F3: _tasks/add-dark-mode.md mentioning "Sessions" appears in the plan', () => {
    const ws = freshWs('f3-active-task');
    copyFixture(ws, 'budget-project');
    // §30 task-file format; content mentions the concept "Sessions".
    mkdirSync(join(ws, 'cans', '_tasks'), { recursive: true });
    writeFileSync(
      join(ws, 'cans', '_tasks', 'add-dark-mode.md'),
      `# add-dark-mode
- Owner: agent-1
- ADR: _adr/001-css-variables-over-tailwind.md
- Tasks
  - [x] Add ThemeContext provider ← agent-1
  - [ ] Create toggle component ← agent-1
  - [ ] Migrate colors to variables ← agent-3
  - [ ] Test: no FOUC ← agent-2
- Review
  - [ ] Spec approved ← @human
  - [x] Design approved ← agent-1
- Handoff
  - Context: Sessions must remember the chosen theme across Sessions
  - Constraint: zero flash on load
`,
    );

    const r = runCli(['budget', 'read', 'sessions', '--json'], ws);
    const data = parseJson(r.out);
    // §26 step 3: "active task mentioning (80)" is a scored tier of the plan;
    // §35 budget-read.json shows _tasks/add-dark-mode.md as a plan entry.
    const inPlan = (data.plan ?? []).some((p: any) => String(p.file).includes('add-dark-mode'));
    const inSkipped = (data.skipped ?? []).some((f: any) => String(f).includes('add-dark-mode'));
    expect(inPlan || inSkipped).toBe(true);
  });
});

describe('QA-03 F4/F5 — budget exit-code & subcommand discipline (§19, §37)', () => {
  test('F4: budget write <unknown-concept> exits non-zero with ok:false (§19 user-correctable failure)', () => {
    const ws = freshWs('f4-write-unknown');
    copyFixture(ws, 'budget-project');

    const r = runCli(['budget', 'write', 'zzzyyynotfound', '--json'], ws);
    const data = parseJson(r.out);
    expect(r.exit).not.toBe(0); // §19: 1 = user-correctable failure; agents rely on exit codes
    expect(data.ok).toBe(false);
  });

  test('F5: unknown budget subcommand errors instead of silently running as read (§37)', () => {
    const ws = freshWs('f5-unknown-subcommand');
    copyFixture(ws, 'budget-project');

    const r = runCli(['budget', 'frobnicate', 'sessions'], ws);
    const combined = r.out + r.err;
    expect(r.exit).not.toBe(0); // §37: a typo'd invocation is a user error, not success
    expect(combined).not.toContain('Reading plan for:'); // must not be success-shaped read output
    expect(combined).toMatch(/frobnicate|unknown|unrecognized|usage/i); // §37: say what happened
  });
});

describe('QA-03 F6 — §16/§18 overflow.force_file_for drives detection', () => {
  test('F6: force_file_for: [] → fenced code block is NOT overflow-flagged', () => {
    const ws = freshWs('f6-force-file-for-empty');
    writeSpec(
      ws,
      '01-api.md',
      `- API
  - Config sample
  \`\`\`json
  {"k": 1}
  \`\`\`
`,
    );
    writeRules(ws, 'overflow:\n  force_file_for: []\n');

    const r = runCli(['check', '--json'], ws);
    const data = parseJson(r.out);
    // §18 semantics: force_file_for lists which content categories are forced
    // into files; an empty list means nothing is forced → no overflow flags.
    const overflowIssues = data.issues.filter((i: any) => i.category === 'overflow');
    expect(overflowIssues).toEqual([]);
  });
});

describe('QA-03 F7 — §13 phrase-overlap metric (boundary + stopword normalization)', () => {
  test('F7a: pair sharing exactly 7/10 tokens (70% ≥ 70%) must be flagged', () => {
    const ws = freshWs('f7a-boundary-7of10');
    // Two 10-token bullets sharing exactly 7 tokens (3 distinct each):
    // overlap = 7/10 = 70% → §13 "Normalized word set overlap ≥ 70% → flag".
    // Words chosen to avoid synonym groups and fuzzy (Levenshtein ≤ 2) noise.
    writeSpec(
      ws,
      '01-pair.md',
      `- Section
  - Alpha bravo charlie delta echo foxtrot golf hotel india juliet
  - Alpha bravo charlie delta echo foxtrot golf kilo lima mike
`,
    );

    const r = runCli(['check', '--json'], ws);
    const data = parseJson(r.out);
    const overlapIssues = data.issues.filter(
      (i: any) => i.category === 'redundancy' && /overlap/.test(i.message),
    );
    expect(overlapIssues.length).toBeGreaterThan(0); // 7/10 = 70% must flag
  });

  test('F7b: pair whose shared tokens include a stopword must be measured AFTER stopword filtering', () => {
    const ws = freshWs('f7b-stopword-normalization');
    // 5/7 shared tokens, but one shared token is the stopword "for"
    // (§18 default stopwords). §13: normalization filters stopwords BEFORE
    // overlap → effective sets are 4 and 6 → 4/6 ≈ 66.7% < 70% → NOT flagged.
    // The current implementation counts "for", inflating the pair to 71%.
    writeSpec(
      ws,
      '01-pair.md',
      `- Section
  - For alpha beta gamma delta
  - For alpha beta gamma delta epsilon zeta
`,
    );

    const r = runCli(['check', '--json'], ws);
    const data = parseJson(r.out);
    const overlapIssues = data.issues.filter(
      (i: any) => i.category === 'redundancy' && /overlap/.test(i.message),
    );
    expect(overlapIssues).toEqual([]); // documented metric: 66.7% < 70% → no flag
  });
});

describe('QA-03 F8 — §13 L3 fuzzy layer must skip synonym-matched pairs', () => {
  test('F8: postgres ↔ postgresql (same synonym group) produces no "possible typo" warning', () => {
    const ws = freshWs('f8-synonym-fuzzy');
    writeSpec(
      ws,
      '01-db.md',
      `- Database
  - Postgres
  - Postgresql
`,
    );
    // Default rules (§18) already carry the synonym group [postgres, postgresql, pg].

    const r = runCli(['check', '--json'], ws);
    const data = parseJson(r.out);
    // §13 L3: "Levenshtein ≤ 2 for words > 4 chars NOT ALREADY SYNONYM-MATCHED".
    // postgres/postgresql map to the same group → no typo warning (the synonym
    // suggestion is already satisfied). Word-frequency ×2 is below threshold 4,
    // so the documented outcome is zero issues mentioning both words.
    const typoIssues = data.issues.filter(
      (i: any) =>
        i.message.includes('possible typo') &&
        i.message.includes('postgres') &&
        i.message.includes('postgresql'),
    );
    expect(typoIssues).toEqual([]);
  });
});

describe('QA-03 F10 — §16 no-chaining rule for overflow targets', () => {
  test('F10: see: line inside overflow target 04-api/request-schema.md must be flagged', () => {
    const ws = freshWs('f10-target-chaining');
    copyFixture(ws, 'overflow-project');
    // Append a see: ref INSIDE an extracted overflow target. §16: "Overflow
    // target files must NOT contain their own see: refs (no chaining)."
    const target = join(ws, 'cans', '04-api', 'request-schema.md');
    const src = require('fs').readFileSync(target, 'utf-8');
    writeFileSync(target, src + '- Schema source: see 04-api.md\n');

    const r = runCli(['check', '--json'], ws);
    const data = parseJson(r.out);
    // §16: the target containing a see: ref must be flagged. (Currently nothing
    // is flagged and the ref is not even counted in refs.total.)
    const chainingIssues = data.issues.filter(
      (i: any) => /request-schema/.test(i.message) && /see|chain/i.test(i.message),
    );
    expect(chainingIssues.length).toBeGreaterThan(0);
  });
});

describe('QA-03 F11 — §18 token_budget.warn_threshold', () => {
  test('F11: warn_threshold 0.5 emits a warning at 92% plan usage', () => {
    const ws = freshWs('f11-warn-threshold');
    copyFixture(ws, 'budget-project');
    writeRules(ws, 'token_budget:\n  default_limit: 100\n  warn_threshold: 0.5\n');

    const r = runCli(['budget', 'read', 'sessions'], ws);
    expect(r.exit).toBe(0);
    // Plan usage is 92/100 = 92% ≥ warn_threshold 50% → §18 requires a warning.
    // Marker-based on purpose: the doc fixes the semantics (a warning), not the
    // exact wording (§37 only prescribes the what/where/what-to-do shape).
    expect(r.out + r.err).toMatch(/⚠|warn|exceed|threshold/i);
  });
});

describe('QA-03 F9 — §37 budget outside a workspace', () => {
  test('F9: budget read in a non-workspace explains the problem instead of success-shaped output', () => {
    // Empty dir with no cans/ at or above it (verified ancestors: qa-verify/.tmp,
    // cans-spec, my-project — none contain a cans/ directory).
    const root = join(SCRATCH, 'f9-nows', 'root');
    mkdirSync(root, { recursive: true });

    const r = runCli(['budget', 'read', 'sessions'], root);
    const combined = r.out + r.err;
    expect(combined).not.toContain('Reading plan for:'); // must NOT be success-shaped
    // §37: say what happened, why, and how to fix (workspace-related reason).
    expect(combined).toMatch(/no cans workspace|workspace|cans init/i);
  });
});

describe('QA-03 control — documented default behavior (expected PASS)', () => {
  // control (expected PASS)
  test('control: redundancy-project reports the ×6 "authentication" word-frequency warning, exit 0', () => {
    const ws = freshWs('control-redundancy-fixture');
    copyFixture(ws, 'redundancy-project');

    const r = runCli(['check', '--json'], ws);
    expect(r.exit).toBe(0); // §19: warnings never affect exit code
    const data = parseJson(r.out);
    // §34 / §13 L1: "authentication" appears in 6 nodes ≥ default threshold 4.
    const freq = data.issues.find(
      (i: any) => i.category === 'redundancy' && i.message.includes('"authentication"'),
    );
    expect(freq).toBeDefined();
    expect(freq.level).toBe('warning');
    expect(freq.message).toContain('× 6');
  });
});
