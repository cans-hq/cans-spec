/**
 * QA round-2 red tests — refs engine integrity + `done` command contracts.
 *
 * Each non-control test asserts the DOCUMENTED contract (docs/cans.architecture.md,
 * § citations inline) that the implementation currently violates, and therefore
 * FAILS (red) at HEAD 09e16e5 for that documented-contract reason. Findings
 * verified blackbox first (manual repro under qa-playground/round2/5-b/), then
 * pinned here. No assertions encode current buggy behavior; no failure
 * swallowing; no skips; no weak `||` cop-outs.
 *
 * Mapping (test → finding):
 *   E2a ........... QA-09 E2 / QA-02 F2 residual: a see: target file that does
 *                   not exist must be a broken-ref ERROR (§12 edge cases:
 *                   "File not found → Broken ref error") — there is NO
 *                   forward/backward or in-span exemption. The BACKWARD
 *                   in-span case (06 → missing 02) is currently downgraded to
 *                   an "unwritten spec slot" warning and check exits 0.
 *   E2-fwd ........ control: the FORWARD in-span case (02 → missing 05) is
 *                   documented AND currently correct (QA-07 r2f2 verified the
 *                   forward fix). Pinned as a control guard.
 *   E2b ........... QA-09 E2: with that dangling ref present, `done` of a
 *                   fully-completed gate-free task must be BLOCKED by the
 *                   check gate (§24 gate 3) — currently it archives with a
 *                   dangling ref in the tree.
 *   D8 ............ QA-09 D8 / §28 conversion table: logseq `[[X/Y]]` is the
 *                   encoding of CANS `see: X.md#Y`, so import must reverse it
 *                   to `see: X.md#Y`. Currently imports as the dead ref
 *                   `see: X/Y.md` (slashed path + glued .md), masked by check
 *                   as an "unwritten spec slot" warning, exit 0 (false clean).
 *   #10 ........... QA-04 #10 / QA-07 w5 (STILL-BROKEN): §24 "Updates
 *                   back-pointers if needed" — a completed task whose body
 *                   holds `see: 08-solo.md` must, after done, leave the target
 *                   with its ref-by mark and report backPointersUpdated >= 1.
 *                   Currently backPointersUpdated: 0 and no comment written.
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { join } from 'path';
import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'fs';

const REPO = join(import.meta.dir, '..', '..');
const CLI = join(REPO, 'src', 'cli.ts');
const FIXTURE_PROJECT = join(REPO, 'test', 'fixtures', 'flat-project');
const SCRATCH = join(REPO, '.tmp', 'qa-round2', 'refs-done');

interface Ws { root: string; cans: string }

interface Issue {
  file: string;
  line: number;
  level: string;
  category: string;
  message: string;
}

const createdDirs: string[] = [];
let wsSeq = 0;

/** Fresh scratch workspace under repo/.tmp/qa-round2/refs-done (gitignored). */
function makeWs(name: string): Ws {
  const root = join(SCRATCH, `${name}-${++wsSeq}`);
  mkdirSync(join(root, 'cans'), { recursive: true });
  createdDirs.push(root);
  return { root, cans: join(root, 'cans') };
}

/** Blackbox CLI spawn — primary verification method. */
function runCli(args: string[], cwd: string) {
  const p = Bun.spawnSync(['bun', 'run', CLI, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    // Isolate from any ambient CANS_ROOT other suites might leave behind ('' is falsy → ignored).
    env: { ...process.env, CANS_ROOT: '' },
  });
  return { exit: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
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

function writeSpec(ws: Ws, name: string, content: string): void {
  writeFileSync(join(ws.cans, name), content);
}

/** Fixture spec with its `<!-- ref-by: ... -->` comment stripped (irrelevant to ref targets). */
function fixtureSpecStripped(file: string): string {
  return readFileSync(join(FIXTURE_PROJECT, file), 'utf-8')
    .replace(/ <!-- ref-by:[^>]* -->/g, '');
}

/**
 * QA-09 E2 shape: spec files 00,02,03,04,05,06 (numeric span 00–06).
 * - 04-api.md (fixture) holds the backward ref `see 02-authentication.md#Sessions`.
 * - 06-operations.md holds the backward ref `see: 02-authentication.md#Sessions`
 *   (plus the fixture's backward ref to 03).
 * Deleting 02-authentication.md leaves BOTH refs pointing at a missing file
 * whose number (02) falls inside the existing files' numeric span.
 */
function buildSpanWorkspace(ws: Ws): void {
  writeSpec(ws, '00-overview.md', '- Overview\n  - Project scope\n    - Covers auth and operations\n');
  writeSpec(ws, '02-authentication.md', fixtureSpecStripped('02-authentication.md'));
  writeSpec(ws, '03-data.md', '- Data\n  - Storage\n    - Postgres primary\n');
  writeSpec(ws, '04-api.md', readFileSync(join(FIXTURE_PROJECT, '04-api.md'), 'utf-8'));
  writeSpec(ws, '05-frontend.md', '- Frontend\n  - Views\n    - React SPA\n');
  writeSpec(
    ws,
    '06-operations.md',
    '- Operations\n  - Data protection\n    - Production database: see 03-data.md\n'
      + '    - Session rules: see: 02-authentication.md#Sessions\n',
  );
}

/** Fully-completed gate-free task: every checkbox checked, human gate checked, no open work. */
function writeCompletedGateFreeTask(ws: Ws, name: string, bodyExtraLines: string[] = []): void {
  mkdirSync(join(ws.cans, '_tasks'), { recursive: true });
  const body = [
    `# ${name}`,
    '- Owner: agent-1',
    '- ADR:',
    '- Tasks',
    '  - [x] completed item ← agent-1',
    ...bodyExtraLines,
    '- Review',
    '  - [x] Spec approved ← @human',
    '- Handoff',
    `  - Context: ${name} probe`,
    '  - Constraint:',
    '',
  ].join('\n');
  writeFileSync(join(ws.cans, '_tasks', `${name}.md`), body);
}

/** All spec files in the flat workspace that contain the given needle. */
function flatSpecsContaining(ws: Ws, needle: string): { file: string; content: string }[] {
  return readdirSync(ws.cans)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ file: f, content: readFileSync(join(ws.cans, f), 'utf-8') }))
    .filter((f) => f.content.includes(needle));
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('QA round-2 red verification: refs engine integrity + done contracts', () => {
  test('E2a: backward in-span missing see: target is a broken-ref ERROR with exit 1, not "unwritten spec slot" (§12 edge cases; QA-09 E2, QA-02 F2 residual)', () => {
    // §12 edge-case table: "File not found → Broken ref error." There is NO
    // forward/backward or in-span exemption: rm a mid-span spec (02 of 00–06)
    // and every dangling see: ref to it is a broken-ref error (exit 1).
    const ws = makeWs('e2a');
    buildSpanWorkspace(ws);

    // Setup sanity: with 02 present the workspace has 0 errors, so the rm below
    // is the only ref-graph change (§22).
    const pre = runCli(['check', '--json'], ws.root);
    expect(pre.exit).toBe(0);
    expect(parseJsonOut(pre.out).errorCount).toBe(0);

    rmSync(join(ws.cans, '02-authentication.md'));

    const r = runCli(['check', '--json'], ws.root);
    const j = parseJsonOut(r.out);

    // Documented contract (§12 + §19): dangling refs are broken-ref ERRORS → exit 1.
    expect(r.exit).toBe(1);
    expect(j.refs.broken).toBeGreaterThanOrEqual(1);
    expect(
      j.issues.some((i: Issue) =>
        i.level === 'error'
        && i.category === 'refs'
        && /02-authentication\.md/.test(i.message)
        && /broken ref/i.test(i.message)),
    ).toBe(true);
    // The downgrade term appears nowhere in the docs — a missing FILE is never
    // a warning, regardless of numeric span or ref direction.
    expect(
      j.issues.some((i: Issue) => /unwritten spec slot/i.test(i.message)),
    ).toBe(false);
  });

  test('control (expected PASS): forward in-span missing see: target is a broken-ref ERROR with exit 1 (§12; forward direction verified fixed by QA-07 r2f2)', () => {
    // Same §12 contract, forward direction (02 → missing 05 with span 00–06).
    // QA-07 F2 verified this direction was fixed; pinned here as a control so
    // the surviving backward downgrade (E2a) cannot hide behind it.
    const ws = makeWs('e2fwd');
    writeSpec(ws, '00-overview.md', '- Overview\n  - Project scope\n');
    writeSpec(
      ws,
      '02-authentication.md',
      '- Authentication\n  - Sessions\n    - Session views: see 05-frontend.md\n    - Expire after 24 hours\n',
    );
    writeSpec(ws, '03-data.md', '- Data\n  - Storage\n    - Postgres primary\n');
    writeSpec(
      ws,
      '04-api.md',
      '- API\n  - Authentication\n    - Session rules: see 02-authentication.md\n',
    );
    writeSpec(ws, '06-operations.md', '- Operations\n  - Data protection\n    - Production database: see 03-data.md\n');

    const r = runCli(['check', '--json'], ws.root);
    const j = parseJsonOut(r.out);

    expect(r.exit).toBe(1);
    expect(j.refs.broken).toBeGreaterThanOrEqual(1);
    expect(
      j.issues.some((i: Issue) =>
        i.level === 'error'
        && i.category === 'refs'
        && /05-frontend\.md/.test(i.message)
        && /broken ref/i.test(i.message)),
    ).toBe(true);
    expect(
      j.issues.some((i: Issue) => /unwritten spec slot/i.test(i.message)),
    ).toBe(false);
  });

  test('E2b: done of a fully-completed gate-free task is BLOCKED by the check gate while a dangling backward ref exists — never archives with a dangling ref (§24 gate 3, §12; QA-09 E2)', () => {
    // §24 gate order: "3. Final `cans check` passes → blocks unless
    // --skip-check." With 02-authentication.md deleted, check reports broken
    // refs (§12) and must fail → done blocks. QA-09 E2 actual: the in-span
    // downgrade makes check exit 0 and done ARCHIVES the task with the
    // dangling ref still in the tree.
    const ws = makeWs('e2b');
    buildSpanWorkspace(ws);
    writeCompletedGateFreeTask(ws, 'fix-sessions');

    rmSync(join(ws.cans, '02-authentication.md'));

    const r = runCli(['done', 'fix-sessions', '--json'], ws.root);
    const j = parseJsonOut(r.out);

    // Documented contract: the failing check gate blocks done.
    expect(r.exit).toBe(1);
    expect(j.ok).toBe(false);
    expect(j.archived).toBeNull();
    // The task must stay active — nothing archived, no archive entry created.
    expect(existsSync(join(ws.cans, '_tasks', 'fix-sessions.md'))).toBe(true);
    const archiveDir = join(ws.cans, '_tasks', '_archive');
    const archivedEntries = existsSync(archiveDir)
      ? readdirSync(archiveDir).filter((f) => f.includes('fix-sessions'))
      : [];
    expect(archivedEntries).toHaveLength(0);
  });

  test('D8: logseq [[X/Y]] imports back as CANS `see: X.md#Y` — resolvable, check 0 broken refs, no "unwritten spec slot" masking (§28 conversion table, §27, §31; QA-09 D8)', () => {
    // §28: CANS `see: X.md#Y` ↔ logseq `[[X/Y]]` (page/anchor). §27/§31: import
    // converts `[[wiki-links]]` → `see:` and must preserve real identifiers —
    // i.e. reverse the export encoding exactly. A correct import yields a
    // ref that RESOLVES (§12), so check reports 0 broken refs and no
    // "unwritten spec slot" surrogate warning.
    const src = makeWs('d8-src');
    writeSpec(src, '02-authentication.md', fixtureSpecStripped('02-authentication.md'));
    writeSpec(src, '04-api.md', readFileSync(join(FIXTURE_PROJECT, '04-api.md'), 'utf-8'));

    const x = runCli(['export', 'logseq', '--json'], src.root);
    expect(x.exit).toBe(0);
    const xj = parseJsonOut(x.out);
    expect(xj.ok).toBe(true);
    expect(xj.filesExported).toBe(2);

    // Import ws holds the real 02-authentication.md (with a "Sessions" node),
    // so a correctly-reversed ref resolves against it.
    const imp = makeWs('d8-imp');
    writeSpec(imp, '02-authentication.md', fixtureSpecStripped('02-authentication.md'));

    const exported04 = readFileSync(
      join(src.root, 'cans-export', 'logseq', '04-api.md'), 'utf-8',
    );
    // Export encoding sanity (§28): the see ref round-trips as [[X/Y]].
    expect(exported04).toContain('[[02-authentication/Sessions]]');

    const r = runCli(
      ['import', 'logseq', join(src.root, 'cans-export', 'logseq', '04-api.md'), '--json'],
      imp.root,
    );
    expect(r.exit).toBe(0);
    expect(parseJsonOut(r.out).ok).toBe(true);

    // Exactly one imported spec carries the Session rules node.
    const carriers = flatSpecsContaining(imp, 'Session rules:');
    expect(carriers).toHaveLength(1);
    const imported = carriers[0];

    // Documented contract: the logseq page/anchor link reverses to the CANS
    // file#anchor ref — never a slashed path with a glued .md.
    expect(imported.content).toContain('see: 02-authentication.md#Sessions');
    expect(imported.content).not.toContain('02-authentication/Sessions.md');

    // And the ref must be LIVE: check resolves it (0 broken, no surrogate
    // warning), not a semantically dead ref masked as false-clean.
    const c = runCli(['check', '--json'], imp.root);
    const cj = parseJsonOut(c.out);
    expect(c.exit).toBe(0);
    expect(cj.refs.broken).toBe(0);
    expect(
      cj.issues.some((i: Issue) => /unwritten spec slot/i.test(i.message)),
    ).toBe(false);
  });

  test('#10: done updates back-pointers for see: refs held by the archived task — target gains ref-by AND backPointersUpdated >= 1 (§24 "Updates back-pointers if needed", §35 done-success; QA-04 #10, QA-07 w5)', () => {
    // QA-07 w5 shape: a spec file with NO ref-by comment + a completed task
    // whose body holds `see: 08-solo.md`. §24: done "Updates back-pointers if
    // needed" — the archived task held a see: ref, so the target must gain its
    // ref-by mark and the JSON must report the update (§35 done-success
    // fixture: backPointersUpdated: 2). Both assertions stand independently —
    // no `||` escape hatch.
    const ws = makeWs('w5');
    writeSpec(ws, '08-solo.md', '- Solo\n  - Feature one\n    - Detail of feature one\n');
    writeCompletedGateFreeTask(ws, 'link-solo', [
      '  - [x] wire up solo feature: see: 08-solo.md ← agent-1',
    ]);

    // Setup sanity: the workspace is healthy (§22), so the check gate passes
    // and only the back-pointer contract is under test.
    const pre = runCli(['check', '--json'], ws.root);
    const prej = parseJsonOut(pre.out);
    expect(pre.exit).toBe(0);
    expect(prej.errorCount).toBe(0);
    expect(prej.refs.total).toBeGreaterThanOrEqual(1); // the task's see: ref is seen
    const targetBefore = readFileSync(join(ws.cans, '08-solo.md'), 'utf-8');
    expect(targetBefore).not.toContain('ref-by'); // scenario pin: no ref-by yet

    const r = runCli(['done', 'link-solo', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true); // setup sanity: done completes and archives

    // Documented contract (§24 + §35): back-pointers updated and reported.
    expect(j.backPointersUpdated).toBeGreaterThanOrEqual(1);
    const targetAfter = readFileSync(join(ws.cans, '08-solo.md'), 'utf-8');
    expect(targetAfter).toContain('ref-by');
  });
});
