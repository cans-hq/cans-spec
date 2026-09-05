/**
 * QA-08 (round-2) red-test verification — adversarial inputs & parser robustness.
 *
 * Each non-control test asserts the DOCUMENTED contract (docs/cans.architecture.md,
 * § citations inline) that the implementation currently violates, and therefore
 * FAILS (red) as an assertion failure, confirming the mapped QA-08 finding.
 * No assertions encode current buggy behavior; no failure-swallowing; no skips.
 *
 * Mapping (test → QA-08 finding, agents/qa/QA-08-adversarial-boundary-inputs.md):
 *   A13/A14 ...... majors 1 (`done <name>` accepts filesystem-traversal task names;
 *                  gates evaluated outside _tasks/, archive rename crashes with raw
 *                  ENOENT exit 2; §24 + §37 demand the not-found-in-_tasks error)
 *   A5 ........... minor 2 (300-char ADR title dies with raw ENAMETOOLONG exit 2;
 *                  §23/§37: user-correctable input → exit 1 + ✗ what/fix)
 *   B5 ........... major 2 (CRLF line endings make a spec file silently parse as
 *                  0 nodes — false-clean check; §11 bullets + §45 Windows/CRLF)
 *   E14/E15 ...... majors 4, 5 (export output/vault path occupied by a FILE → raw
 *                  ENOTDIR exit 2; §28/§37/§19: user-correctable → exit 1 + ✗ fix)
 *   control ...... harness pin (plain missing task name already errors correctly; §24/§37)
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { join } from 'path';
import {
  existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from 'fs';

const REPO = join(import.meta.dir, '..', '..');
const CLI = join(REPO, 'src', 'cli.ts');
const SCRATCH = join(REPO, '.tmp', 'qa-round2', 'adversarial');

interface Ws { root: string; cans: string }

const createdDirs: string[] = [];
let wsSeq = 0;

/** Fresh scratch dir under repo/.tmp/qa-round2/adversarial (gitignored). */
function makeDir(name: string): string {
  const dir = join(SCRATCH, `${name}-${++wsSeq}`);
  mkdirSync(dir, { recursive: true });
  createdDirs.push(dir);
  return dir;
}

/** Workspace produced by the documented setup command `cans init` (§21). */
function initWs(name: string): Ws {
  const root = makeDir(name);
  const r = runCli(['init', '--json'], root);
  expect(r.exit).toBe(0);
  const j = parseJsonOut(r.out);
  expect(j.ok).toBe(true);
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

/** §37 errors may land on stdout (✗ user errors) or stderr (top-level catch); judge both. */
function combined(r: { out: string; err: string }): string {
  return r.out + '\n' + r.err;
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

/** Fully-completed hand-written task body (all checkboxes checked, incl. the ← @human gate). */
function completedTaskBody(name: string): string {
  return [
    `# ${name}`,
    '- Owner: agent-1',
    '- ADR:',
    '- Tasks',
    '  - [x] completed item ← agent-1',
    '- Review',
    '  - [x] Spec approved ← @human',
    '- Handoff',
    '  - Context: escape probe',
    '  - Constraint:',
    '',
  ].join('\n');
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('QA-08 red verification: adversarial inputs & parser robustness', () => {
  test('control (expected PASS): `done nope` with a plain missing name errors correctly (§24, §37)', () => {
    // Harness pin: the not-found path itself is documented AND currently correct —
    // exit 1, `✗ task "nope" not found in _tasks/ — run cans status...`, no internal error.
    // The traversal tests below demand exactly this behavior for traversal-shaped names.
    const ws = initWs('control');
    const r = runCli(['done', 'nope'], ws.root);
    expect(r.exit).toBe(1);
    expect(combined(r)).toContain('not found in _tasks/');
    expect(combined(r)).toContain('nope');
    expect(combined(r)).not.toContain('Internal error');
  });

  test('A13: `done ../_adr/001-gate-probe` must refuse a traversal name resolving OUTSIDE _tasks/ — no gate evaluation (§24, §37; QA-08 major 1)', () => {
    // §24: done archives `_tasks/<name>.md` — task names resolve ONLY inside _tasks/.
    // §37: anything else is the user-correctable not-found error. Currently done resolves
    // `../_adr/001-gate-probe` to the real ADR file and runs its gate logic on it
    // (✗ BLOCKED: 1 unchecked ← @human gate — _tasks/../_adr/001-gate-probe.md:NN).
    const ws = initWs('a13');
    const n = runCli(['new', 'adr', 'Gate Probe'], ws.root);
    expect(n.exit).toBe(0); // setup sanity: the ADR (with its ← @human review gates) exists
    const adrPath = join(ws.cans, '_adr', '001-gate-probe.md');
    expect(existsSync(adrPath)).toBe(true);

    const r = runCli(['done', '../_adr/001-gate-probe'], ws.root);

    // Documented contract: not a task in _tasks/ → the plain not-found error, exit 1.
    expect(r.exit).toBe(1);
    expect(combined(r)).toContain('not found in _tasks/');
    expect(combined(r)).toContain('../_adr/001-gate-probe');
    // RED: currently the gates of the OUT-OF-SCOPE ADR file ARE evaluated → BLOCKED line.
    expect(combined(r)).not.toContain('BLOCKED');
    expect(combined(r)).not.toContain('Internal error');
    // The ADR file is not a task: it must be left untouched and un-archived.
    expect(existsSync(adrPath)).toBe(true);
    const archiveDir = join(ws.cans, '_tasks', '_archive');
    const archived = existsSync(archiveDir)
      ? readdirSync(archiveDir).filter(f => f.includes('gate-probe'))
      : [];
    expect(archived).toEqual([]);
  });

  test('A14: `done ../_collab/escape` must refuse the traversal name — no raw ENOENT exit 2, nothing moved (§24, §37, §19; QA-08 major 1)', () => {
    // §24: task names resolve only inside _tasks/. Currently done accepts the traversal
    // name, runs gates on the outside file, then crashes building the archive path:
    // `✗ Internal error: ENOENT ... rename ... _archive/2026-...-../_collab/escape.md` (exit 2).
    // §37/§19: a user-correctable wrong name is the ✗ not-found error with exit 1 —
    // "Internal error" exit 2 is for unexpected internal failures only.
    const ws = initWs('a14');
    const escapePath = join(ws.cans, '_collab', 'escape.md');
    const body = completedTaskBody('escape');
    writeFileSync(escapePath, body); // shaped like a fully-completed no-gate task
    expect(existsSync(escapePath)).toBe(true);

    const r = runCli(['done', '../_collab/escape'], ws.root);

    // Documented contract: refuse with the not-found-in-_tasks error, exit 1.
    expect(r.exit).toBe(1);
    expect(combined(r)).toContain('not found in _tasks/');
    expect(combined(r)).toContain('../_collab/escape');
    // RED: currently a raw internal error (exit 2) with the OS errno text.
    expect(combined(r)).not.toContain('Internal error');
    expect(combined(r)).not.toContain('ENOENT');
    // Nothing moved: the source file survives byte-identical; no archive entry appears.
    expect(existsSync(escapePath)).toBe(true);
    expect(readFileSync(escapePath, 'utf-8')).toBe(body);
    const archiveDir = join(ws.cans, '_tasks', '_archive');
    const archived = existsSync(archiveDir)
      ? readdirSync(archiveDir).filter(f => f.includes('escape'))
      : [];
    expect(archived).toEqual([]);
  });

  test('A5: `new adr` with a 300-char title is handled as user-correctable input — never raw ENAMETOOLONG exit 2 (§23, §37, §19; QA-08 minor 2)', () => {
    // §37: user-correctable input must produce exit 1 + ✗ what/fix; raw OS errors are for
    // internal failures only. Currently: `✗ Internal error: ENAMETOOLONG: name too long,
    // open '.../_adr/001-xxx….md'` with exit 2.
    // Mechanism-agnostic contract: EITHER the slug is capped and the ADR is created
    // (exit 0, reasonable filename), OR the command fails gracefully (exit 1, ✗ message
    // naming the title/slug length problem).
    const ws = initWs('a5');
    const title = 'x'.repeat(300);
    const r = runCli(['new', 'adr', title], ws.root);

    expect(r.exit).not.toBe(2);                       // RED: currently exit 2
    expect(combined(r)).not.toContain('ENAMETOOLONG'); // RED: currently leaks the raw errno
    expect(combined(r)).not.toContain('Internal error');

    if (r.exit === 0) {
      // Acceptable fix A: created with a capped slug → filename stays filesystem-safe.
      const adrDir = join(ws.cans, '_adr');
      expect(existsSync(adrDir)).toBe(true);
      const created = readdirSync(adrDir).filter(f => f.endsWith('.md'));
      expect(created.length).toBe(1);
      expect(created[0]!.length).toBeLessThanOrEqual(250); // OS-safe basename
    } else {
      // Acceptable fix B: graceful §37 rejection naming the problem.
      expect(r.exit).toBe(1);
      expect(combined(r)).toMatch(/✗/);
      expect(combined(r)).toMatch(/too long|length|slug|title|shorten|reduce/i);
    }
  });

  test('B5: a CRLF-terminated spec file parses its bullets — counted by check, findable by budget (§11, §45; QA-08 major 2)', () => {
    // §11: bullet lines parse; §45: Windows (CRLF files) is a supported platform, so a
    // Windows-authored outline contributes its nodes. Currently the whole CRLF file is
    // silently invisible: nodes stay at the empty-file baseline, check exits 0 false-clean,
    // and budget finds none of its concepts (QA-08 B5).
    const ws = initWs('b5');
    const overview = join(ws.cans, '00-overview.md');

    // Baseline: empty overview → the other spec files' node count, no errors.
    writeFileSync(overview, '');
    const r0 = runCli(['check', '--json'], ws.root);
    expect(r0.exit).toBe(0); // setup sanity (QA-08 B1: empty file counted, no issues)
    const j0 = parseJsonOut(r0.out);
    expect(j0.ok).toBe(true);
    const nodes0 = j0.nodes as number; // check --json top-level node count key
    expect(typeof nodes0).toBe('number');

    // Probe: same file with 3 bullets written with CRLF (\r\n) line endings.
    const crlf = [
      '- Overview',
      '  - CRLF probe one zephyr ledger',
      '  - CRLF probe two quartz billing',
      '',
    ].join('\r\n');
    writeFileSync(overview, crlf);
    expect(readFileSync(overview, 'utf-8').includes('\r\n')).toBe(true); // cat -A sanity: ^M$ present

    // Contract 1: the file's bullets are parsed → node count rises by ≥ 3.
    const r1 = runCli(['check', '--json'], ws.root);
    expect(r1.exit).toBe(0);
    const j1 = parseJsonOut(r1.out);
    // RED: currently nodes stay at the empty-file baseline (CRLF bullets contribute 0).
    expect(j1.nodes).toBeGreaterThanOrEqual(nodes0 + 3);

    // Contract 2: concepts living only in the CRLF file are findable by budget (§26).
    const b = runCli(['budget', 'read', 'zephyr', '--json'], ws.root);
    // RED: currently "✗ no files match concept" with exit 1 — the file is invisible.
    expect(b.exit).toBe(0);
    const bj = parseJsonOut(b.out);
    expect(bj.ok).toBe(true);
    expect(Array.isArray(bj.plan)).toBe(true);
    expect(bj.plan.length).toBeGreaterThanOrEqual(1);
  });

  test('E14: `export obsidian --vault <path-that-is-a-FILE>` fails as a user-correctable ✗ exit 1, not raw ENOTDIR exit 2 (§28, §37, §19; QA-08 major 4)', () => {
    // §37/§19: output path occupied by a file is user-correctable → exit 1 + ✗ what + fix
    // hint. Currently: `✗ Internal error: ENOTDIR: not a directory, mkdir '<file>/obsidian'` exit 2.
    const ws = initWs('e14');
    const holder = makeDir('e14-vault-holder');
    const vaultFile = join(holder, 'vaultfile');
    writeFileSync(vaultFile, 'occupied — not a directory');

    const r = runCli(['export', 'obsidian', '--vault', vaultFile], ws.root);

    expect(r.exit).toBe(1);                            // RED: currently exit 2
    expect(combined(r)).toMatch(/✗/);
    expect(combined(r)).toMatch(/fix|use|instead|choose|remove|rename|delete|provide|not a directory|path/i);
    expect(combined(r)).not.toContain('Internal error'); // RED: currently printed
    expect(combined(r)).not.toContain('ENOTDIR');        // RED: currently leaked
  });

  test('E15: `export opml` when `cans-export` exists as a FILE fails as a user-correctable ✗ exit 1, not raw ENOTDIR exit 2 (§28, §37, §19; QA-08 major 5)', () => {
    // Same §37/§19 contract as E14, on the default output dir surface: the workspace root
    // contains a FILE named `cans-export` (no extension). Currently:
    // `✗ Internal error: ENOTDIR ... mkdir '.../cans-export/opml'` exit 2.
    const ws = initWs('e15');
    const occupied = join(ws.root, 'cans-export');
    writeFileSync(occupied, 'occupied — not a directory');
    expect(existsSync(occupied)).toBe(true);

    const r = runCli(['export', 'opml'], ws.root);

    expect(r.exit).toBe(1);                            // RED: currently exit 2
    expect(combined(r)).toMatch(/✗/);
    expect(combined(r)).toMatch(/fix|use|instead|choose|remove|rename|delete|provide|not a directory|path/i);
    expect(combined(r)).not.toContain('Internal error'); // RED: currently printed
    expect(combined(r)).not.toContain('ENOTDIR');        // RED: currently leaked
    // The occupant file must survive the failure untouched.
    expect(readFileSync(occupied, 'utf-8')).toBe('occupied — not a directory');
  });
});
