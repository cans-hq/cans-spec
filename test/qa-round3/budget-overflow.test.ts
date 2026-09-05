/**
 * QA round-3 red tests — §26 budget + §16 overflow (findings from QA-14/QA-13, npm cans-spec@0.1.0).
 *
 * Each test asserts the DOCUMENTED contract (docs/cans.architecture.md, § citations
 * inline) that the implementation currently violates, and therefore FAILS (red) as
 * an assertion failure, confirming the mapped round-3 QA finding.
 * No assertions encode current buggy behavior; no failure-swallowing; no skips.
 *
 * Mapping (test → finding):
 *   R3-B1 ....... QA-14 F6 — §26 `budget read <concept> --change <name>` centers the
 *                  plan on a task file; a task file that does not exist is a
 *                  user-correctable failure (§19 exit 1) and must be named (§37).
 *                  Actual: the unknown --change is silently ignored and a plain plan
 *                  is returned, ok:true, exit 0.
 *   R3-B2 ....... CONTROL (green at HEAD) + npm-only residual note — §16 "Overflow
 *                  target files must NOT contain their own see: refs (no chaining)"
 *                  and §12 deep-hop table: a referenced overflow target carrying
 *                  outgoing `see:` refs MUST be flagged. Verified green at source
 *                  main for the valid-chain, broken-ref AND colonless variants
 *                  (error, category overflow, "no chaining: overflow target ...").
 *                  QA-13 F3 (npm 0.1.0: nothing flagged, exit 0) therefore does NOT
 *                  reproduce at source main — kept as a regression guard pinning the
 *                  documented behavior so the npm/source divergence cannot regress it.
 *
 * Both workspaces use a FULL §18 rules file (defaults, orphan_check relaxed):
 * full-file overrides behave correctly at HEAD (QA-13), so a red here can only be
 * the mapped finding — not the partial-merge bug (R3-R1a family, rules-config file).
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

const REPO = join(import.meta.dir, '..', '..');
const CLI = join(REPO, 'src', 'cli.ts');
const SCRATCH = join(REPO, '.tmp', 'qa-round3', 'budget-overflow');

interface Ws { root: string; cans: string }

const createdDirs: string[] = [];
let wsSeq = 0;

function makeWs(name: string): Ws {
  const root = join(SCRATCH, `${name}-${++wsSeq}`);
  mkdirSync(join(root, 'cans'), { recursive: true });
  createdDirs.push(root);
  return { root, cans: join(root, 'cans') };
}

function runCli(args: string[], cwd: string) {
  const p = Bun.spawnSync(['bun', 'run', CLI, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, CANS_ROOT: '' },
  });
  return { exit: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
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

const FULL_RULES = [
  'structure:',
  '  node_length: { min: 3, max: 120 }',
  '  siblings: { min: 1, max: 12 }',
  '  depth: { min: 1, max: 5 }',
  '  single_child_collapse: true',
  '  empty_nodes: false',
  'style:',
  '  prefer: sibling',
  '  force_nested_above: 6',
  '  force_sibling_below: 3',
  '  shared_prefix_detection: true',
  'content:',
  '  tbd_allowed: true',
  '  max_tbd_per_file: 5',
  'references:',
  '  mode: pointer',
  '  back_pointers: true',
  '  max_hops: 1',
  '  orphan_check: false',
  '  duplicate_home_check: true',
  'redundancy:',
  '  enabled: true',
  '  word_frequency_threshold: 4',
  '  phrase_overlap_threshold: 0.7',
  '  cross_file_threshold: 2',
  '  stopwords: [the, a, an, of, to, in, for, and, or, with, must, shall, requires]',
  '  synonyms:',
  '    - [postgres, postgresql, pg]',
  '    - [auth, authentication, sign-in, signin]',
  '    - [api, endpoint, route]',
  '    - [frontend, client, ui]',
  '    - [db, database, storage]',
  'token_budget:',
  '  enabled: true',
  '  default_limit: 4096',
  '  estimate_chars_per_token: 3.5',
  '  warn_threshold: 0.8',
  'overflow:',
  '  max_node_chars: 200',
  '  force_file_for: [code_block, table, diagram]',
  '',
].join('\n');

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('QA round-3 red verification: §26 budget + §16 overflow (QA-14 F6, QA-13 F3)', () => {
  test('R3-B1 (§26/§19/§37 / QA-14 F6): budget read --change <unknown> names the missing task file and exits 1', () => {
    const ws = makeWs('r3-b1-change-unknown');
    writeFileSync(join(ws.cans, '_rules.yaml'), FULL_RULES);
    writeFileSync(join(ws.cans, '02-authentication.md'), [
      '- Authentication',
      '  - Sessions',
      '    - Expire after 24 hours',
      '    - Refresh allowed for 30 days',
      '  - Sign up',
      '    - Email',
      '    - Google',
      '',
    ].join('\n'));
    writeFileSync(join(ws.cans, '04-api.md'), [
      '- API',
      '  - Authentication',
      '    - Session rules: see 02-authentication.md#Sessions',
      '  - POST /users',
      '    - Returns 201',
      '',
    ].join('\n'));
    const r = runCli(['budget', 'read', 'sessions', '--change', 'nope', '--json'], ws.root);
    const parsed = parseJsonOut(r.out);
    // §19: user-correctable failure → exit 1; §37: name the real cause.
    expect(parsed.ok).toBe(false);
    expect(r.exit).toBe(1);
    expect(`${r.out}\n${r.err}`).toContain('nope');
  });

  test('control (green at HEAD; QA-13 F3 npm-only residual): an overflow target carrying outgoing see: refs is flagged as a chaining error', () => {
    // 04-api.md references the overflow target; the target itself references
    // 03-data.md. §16 forbids outgoing refs from overflow targets (no chaining);
    // §12's deep-hop table independently calls "see: inside see: target" an
    // error. Verified green at HEAD (source main) for valid-chain, broken-ref
    // and colonless variants — QA-13 F3 (npm 0.1.0: nothing flagged, exit 0)
    // does not reproduce here; this test pins the contract regardless.
    const ws = makeWs('r3-b2-overflow-chain');
    writeFileSync(join(ws.cans, '_rules.yaml'), FULL_RULES);
    writeFileSync(join(ws.cans, '04-api.md'), [
      '- API',
      '  - POST /users',
      '    - Returns 201 on success',
      '    - Request schema: see 04-api/request-schema.md',
      '  - Health check',
      '    - Returns 200',
      '',
    ].join('\n'));
    mkdirSync(join(ws.cans, '04-api'), { recursive: true });
    writeFileSync(join(ws.cans, '04-api', 'request-schema.md'), [
      '- Request schema',
      '  - Email and password required',
      '  - Field rules: see 03-data.md',
      '',
    ].join('\n'));
    writeFileSync(join(ws.cans, '03-data.md'), [
      '- Data',
      '  - Postgres primary store',
      '  - Nightly backups',
      '',
    ].join('\n'));
    const r = runCli(['check', '--json'], ws.root);
    const parsed = parseJsonOut(r.out);
    // Verified at HEAD: error, category overflow, "no chaining: overflow target ..."
    expect(r.exit).toBe(1);
    expect(parsed.issues.some((i: any) => /request-schema/.test(i.file) && i.category === 'overflow' && i.level === 'error')).toBe(true);
  });
});
