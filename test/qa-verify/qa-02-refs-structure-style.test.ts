/**
 * QA-02 red-test verification — refs / structure / style engines of `cans check`.
 *
 * Each test encodes the DOCUMENTED contract from docs/cans.architecture.md and
 * cites the QA-02 finding ID it verifies. Because the implementation currently
 * violates the contract, every non-control test MUST currently FAIL with an
 * assertion failure (confirming the red). No src/ fixes are part of this task.
 *
 * Method: blackbox CLI spawn (`bun run src/cli.ts check ...`) from a scratch
 * workspace containing a hand-built `cans/` dir under .tmp/qa-verify/ (gitignored).
 */
import { describe, test, expect, afterAll } from 'bun:test';
import { join, dirname } from 'path';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';

const REPO = join(import.meta.dir, '..', '..');
const CLI = join(REPO, 'src', 'cli.ts');
const SCRATCH_ROOT = join(REPO, '.tmp', 'qa-verify', 'qa-02-refs');

interface Issue {
  file: string;
  line: number;
  level: string;
  category: string;
  message: string;
  suggestion?: string;
}

interface CheckJson {
  ok: boolean;
  command: string;
  exitCode: number;
  files: number;
  nodes: number;
  maxDepth: number;
  refs: { total: number; broken: number; deepHops: number };
  backPointers: { total: number; current: number; stale: number };
  issues: Issue[];
  errorCount: number;
  warningCount: number;
  backPointersUpdated: number;
}

function runCli(args: string[], cwd: string) {
  const p = Bun.spawnSync(['bun', 'run', CLI, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  return { exit: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}

/** Create a scratch workspace dir with an empty `cans/` inside. */
function makeWs(name: string): string {
  const dir = join(SCRATCH_ROOT, name);
  mkdirSync(join(dir, 'cans'), { recursive: true });
  return dir;
}

/** Write a spec file (or `_rules.yaml`) into the workspace's `cans/` dir. */
function writeSpec(ws: string, rel: string, content: string): void {
  const p = join(ws, 'cans', rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

/** Copy a spec file from test/fixtures/<fixture>/ into the workspace (read-only source). */
function copyFixtureSpec(ws: string, fixture: string, file: string): void {
  writeFileSync(join(ws, 'cans', file), readFileSync(join(REPO, 'test', 'fixtures', fixture, file)));
}

function checkJson(ws: string, extraArgs: string[] = []): { exit: number; json: CheckJson } {
  const res = runCli(['check', '--json', ...extraArgs], ws);
  return { exit: res.exit, json: JSON.parse(res.out) as CheckJson };
}

afterAll(() => {
  rmSync(SCRATCH_ROOT, { recursive: true, force: true });
});

describe('QA-02 red verification — refs/structure/style engines (documented contracts, currently violated)', () => {
  // F1 (QA-02) — §8: "Flat wins over folder. If both exist, `cans check` flags error."
  //              §11: "Both existing = error."
  // A flat spec file and a folder index for the same NN-slug must be flagged as
  // an ERROR (→ exit 1). Currently both parse as separate specs, exit 0.
  test('F1: flat + folder duplicate home for the same slug is flagged as an error (§8/§11)', () => {
    const ws = makeWs('f1-dup-home');
    // Two divergent copies of the same concept — the exact hazard the docs call out.
    writeSpec(ws, '02-authentication.md', '- Authentication\n  - Sign up\n    - Email\n    - Google\n');
    writeSpec(ws, '02-authentication/index.md', '- Authentication\n  - Sessions\n    - Expire after 24 hours\n');

    const { exit, json } = checkJson(ws);
    const errs = json.issues.filter((i) => i.level === 'error');
    expect(errs.length).toBeGreaterThan(0); // §8: "flags error"
    expect(errs.some((i) => /02-authentication/.test(i.message))).toBe(true); // names the conflicting home
    expect(exit).toBe(1); // §19: errors → exit 1
  });

  // F2 (QA-02) — §12 edge-case table: "File not found → Broken ref error".
  // A ref to a missing file is an ERROR regardless of whether its NN- number
  // falls inside the numeric span of existing files. Currently in-span missing
  // targets (04, 05 within span 02..06) are downgraded to a warning
  // ("unwritten spec slot" — a term that appears nowhere in the docs) and
  // refs.broken only counts the out-of-span target.
  test('F2: ref to a non-existent spec file is a broken-ref ERROR even when its number is in-span (§12)', () => {
    const ws = makeWs('f2-span-broken');
    writeSpec(
      ws,
      '02-authentication.md',
      '- Authentication\n  - Rules: see 04-api.md\n  - Views: see 05-frontend.md\n  - Missing: see 99-zzz.md\n',
    );
    writeSpec(ws, '06-operations.md', '- Operations\n  - Data protection\n');

    const { exit, json } = checkJson(ws);
    // 04-api.md and 05-frontend.md do not exist → both are broken refs per §12.
    expect(json.refs.broken).toBeGreaterThanOrEqual(2);
    // The missing in-span target must be reported at error level (broken ref),
    // not downgraded to a warning.
    expect(
      json.issues.some((i) => i.level === 'error' && /04-api\.md/.test(i.message)),
    ).toBe(true);
    expect(exit).toBe(1);
  });

  // F4 (QA-02) — §34 deep-hop fixture: the documented expected output contains
  // ONLY "✗ DEEP HOP: 04-api.md → 02-authentication.md → 06-operations.md".
  // The anchor `06-operations.md#Data-protection` targets node "Data protection"
  // (the docs' own #Data-protection convention), so it must NOT additionally
  // produce a "broken anchor" error. Currently a spurious
  // "broken anchor: 06-operations.md#Data-protection — no node matches" fires
  // because hyphen↔space anchor normalization is missing.
  test('F4: §34 deep-hop fixture — anchor #Data-protection resolves against node "Data protection" (no broken-anchor error)', () => {
    const ws = makeWs('f4-deep-hop-anchor');
    copyFixtureSpec(ws, 'deep-hop-project', '02-authentication.md');
    copyFixtureSpec(ws, 'deep-hop-project', '04-api.md');
    copyFixtureSpec(ws, 'deep-hop-project', '06-operations.md');

    const { json } = checkJson(ws);
    // Scenario pin: the deep-hop violation itself is detected.
    expect(json.refs.deepHops).toBeGreaterThanOrEqual(1);
    // §34: the documented output for this fixture contains ONLY the deep-hop
    // error — the anchor must resolve (hyphen↔space normalization), so no
    // broken-anchor issue for #Data-protection may be reported.
    const brokenAnchorIssues = json.issues.filter(
      (i) => /broken anchor/i.test(i.message) && /Data-protection/i.test(i.message),
    );
    expect(brokenAnchorIssues).toHaveLength(0);
  });

  // F5 (QA-02) — §14: "Unnecessary nesting: Parent with ≤ force_sibling_below
  // leaf children → flag 'collapse to sibling style.'" Default
  // force_sibling_below is 3 (§18), so a parent with EXACTLY 3 leaf children
  // must be flagged ("≤ N" semantics). Currently 3 are NOT flagged (only 2
  // are) — the implementation uses "< N" semantics.
  test('F5: parent with exactly 3 leaf children is flagged "collapse to sibling style" (§14, force_sibling_below=3, ≤ semantics)', () => {
    const ws = makeWs('f5-force-sibling-3');
    writeSpec(
      ws,
      '02-authentication.md',
      '- Authentication\n  - Sessions\n    - Alpha details here\n    - Beta details here\n    - Gamma details here\n',
    );

    const { json } = checkJson(ws);
    const styleFlags = json.issues.filter((i) => i.category === 'style' && /Sessions/.test(i.message));
    expect(styleFlags.length).toBeGreaterThan(0); // §14: ≤ 3 leaf children → flag
  });

  // F8 (QA-02) — §35 check-clean.json: a 4-level project reports `maxDepth: 4`,
  // i.e. maxDepth is 1-based (and §15 depth errors are 1-based too). Currently
  // a 4-level chain reports maxDepth: 3 (0-based) — off-by-one inside the
  // documented JSON contract.
  test('F8: JSON maxDepth is 1-based — a 4-level chain reports maxDepth 4 (§35)', () => {
    const ws = makeWs('f8-maxdepth');
    writeSpec(ws, '01-deep.md', '- Level one\n  - Level two\n    - Level three\n      - Level four\n');

    const { json } = checkJson(ws);
    // Scenario pin: 4 levels is within structure.depth.max (5), so no depth error.
    const depthErrors = json.issues.filter(
      (i) => i.category === 'structure' && /Depth \d+ exceeds/.test(i.message),
    );
    expect(depthErrors).toHaveLength(0);
    // §35: 1-based maxDepth (4-level project → maxDepth 4).
    expect(json.maxDepth).toBe(4);
  });

  // F9a (QA-02) — §18 rules system: keys under `references:` are honored;
  // default `duplicate_home_check: true` can be overridden. With
  // `references: { duplicate_home_check: false }` the cross-file duplicate-home
  // warning ("<term> at depth 0-1 in 2+ files without see:") must be
  // suppressed. Currently the key is dead and the warning still fires.
  test('F9a: _rules.yaml references.duplicate_home_check: false suppresses the duplicate-home warning (§18)', () => {
    const ws = makeWs('f9a-dup-home-rule');
    writeSpec(ws, '_rules.yaml', 'references:\n  duplicate_home_check: false\n');
    writeSpec(
      ws,
      '02-authentication.md',
      '- Authentication\n  - Sessions\n    - Expire after 24 hours\n  - Sign up\n    - Email\n    - Google\n  - Passwords\n    - Minimum 12 characters\n',
    );
    writeSpec(
      ws,
      '07-billing.md',
      '- Billing\n  - Sessions\n    - Billing per session\n  - Invoices\n    - Sent monthly\n  - Payments\n    - Via card only\n',
    );

    const { json } = checkJson(ws);
    // Scenario pin: the _rules.yaml must parse (invalid YAML → parse error, exit 1).
    expect(json.issues.some((i) => /invalid _rules\.yaml/.test(i.message))).toBe(false);
    // §18: the duplicate-home check must be OFF — no "at depth 0-1 in 2+ files
    // without see:" warning may be emitted.
    const dupHomeIssues = json.issues.filter((i) => /at depth 0-1 in 2\+ files/.test(i.message));
    expect(dupHomeIssues).toHaveLength(0);
  });

  // F9b (QA-02) — §18 rules system: `references.max_hops` defaults to 1 and can
  // be overridden. With `references: { max_hops: 2 }` a 2-hop ref chain
  // (04 → 02 → 06) must NOT produce a deep-hop error. Currently the key is
  // dead and the chain is still flagged.
  test('F9b: _rules.yaml references.max_hops: 2 allows a 2-hop ref chain without deep-hop error (§18)', () => {
    const ws = makeWs('f9b-max-hops-rule');
    writeSpec(ws, '_rules.yaml', 'references:\n  max_hops: 2\n');
    writeSpec(ws, '04-api.md', '- API\n  - Authentication\n    - Session rules: see 02-authentication.md\n');
    writeSpec(ws, '02-authentication.md', '- Sessions\n  - Expire after 24 hours\n  - Storage rules: see 06-operations.md\n');
    writeSpec(ws, '06-operations.md', '- Data protection\n  - Encrypted at rest\n');

    const { json } = checkJson(ws);
    // §18: max_hops 2 → a chain of 2 hops is within budget → no deep hop.
    expect(json.refs.deepHops).toBe(0);
    expect(json.issues.some((i) => i.category === 'refs' && /DEEP HOP/i.test(i.message))).toBe(false);
  });

  // F10 (QA-02) — §11: refs are parsed via regex `/see:\s*(\S+?)(?:#(\S+))?/g`.
  // `\s*` matches zero spaces, so `see:TARGET` (colon, NO space) is valid ref
  // syntax per the documented regex. Currently it yields 0 refs and is
  // silently ignored.
  test('F10: ref syntax "see:TARGET" (colon, no space) is parsed as a ref (§11 regex)', () => {
    const ws = makeWs('f10-see-colon');
    writeSpec(ws, '02-authentication.md', '- Authentication\n  - Sessions\n    - Expire after 24 hours\n');
    writeSpec(ws, '04-api.md', '- API\n  - Detail see:02-authentication.md\n');

    const { json } = checkJson(ws);
    // §11 regex: `see:02-authentication.md` matches (\s* allows 0 spaces) → parsed.
    expect(json.refs.total).toBeGreaterThanOrEqual(1);
    // The ref target exists, so the parsed ref must also validate cleanly
    // (it must not vanish, and it must not be broken).
    expect(json.refs.broken).toBe(0);
  });

  // F16 (QA-02) — a node with exactly 1 child is reported TWICE: structure
  // "X has exactly 1 child. Collapse." AND style "X has 1 children. Collapse
  // to sibling style." Same node, two categories, no added information.
  // There must be at most one such finding for the same node.
  test('F16: single-child node is not double-reported by structure AND style (≤ 1 finding per node)', () => {
    const ws = makeWs('f16-single-child-double');
    writeSpec(ws, '02-authentication.md', '- Google\n  - Uses provider verification\n');

    const { json } = checkJson(ws);
    const singleChildFindings = json.issues.filter(
      (i) => /Google/.test(i.message) && /(1 child|1 children|Collapse)/i.test(i.message),
    );
    expect(singleChildFindings.length).toBeLessThanOrEqual(1);
  });

  // F18 (QA-02) — §35 check-fix.json shows the POST-fix state:
  // `backPointers: { total: N, current: N, stale: 0 }` alongside
  // `backPointersUpdated`. Currently `check --fix --json` reports the PRE-fix
  // back-pointer state (current: 0, stale: 1) even though the same run
  // rewrote the comments.
  test('F18: check --fix --json reports post-fix backPointers (current === total, stale === 0) (§35)', () => {
    const ws = makeWs('f18-fix-json-poststate');
    writeSpec(
      ws,
      '02-authentication.md',
      '- Authentication <!-- ref-by: 09-stale.md -->\n  - Sessions\n    - Expire after 24 hours\n  - Sign up\n    - Email\n    - Google\n',
    );
    writeSpec(ws, '04-api.md', '- API\n  - Auth rules: see 02-authentication.md#Sessions\n');

    const { json } = checkJson(ws, ['--fix']);
    // Scenario pin: the run actually rewrote the stale back-pointer comment.
    expect(json.backPointersUpdated).toBe(1);
    // §35 check-fix.json: the reported backPointers reflect the post-fix state.
    expect(json.backPointers.total).toBeGreaterThanOrEqual(1);
    expect(json.backPointers.current).toBe(json.backPointers.total);
    expect(json.backPointers.stale).toBe(0);
  });

  // control (expected PASS) — pins the harness: broken-ref detection works on
  // the shipped broken-refs-project fixture (§34: 2 broken refs + 1 self-ref).
  // QA-02 matrix row 2a: PASS. This test is expected to pass TODAY.
  test('control (expected PASS): broken-refs fixture yields refs.broken >= 2 and exit 1 (§34)', () => {
    const ws = makeWs('ctl-broken-refs');
    copyFixtureSpec(ws, 'broken-refs-project', '04-api.md');

    const { exit, json } = checkJson(ws);
    expect(json.refs.broken).toBeGreaterThanOrEqual(2);
    expect(exit).toBe(1);
  });
});
