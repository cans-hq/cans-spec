/**
 * QA-04 red-test verification — `new` / `done` / `status` workflow commands.
 *
 * Each non-control test asserts the DOCUMENTED contract (docs/cans.architecture.md,
 * § citations inline) that the implementation currently violates, and therefore
 * FAILS (red) as an assertion failure, confirming the mapped QA-04 finding.
 * No assertions encode current buggy behavior; no failure-swallowing; no skips.
 *
 * Mapping (test → QA-04 finding):
 *   F1a/F1b/F1c ... finding 1  (flags swallowed into `new` names/titles; §20/§23/§35)
 *   F2 ........... finding 2  (`new task` silently overwrites an existing task file; §21/§37)
 *   F3 ........... finding 3  (same-day re-archive silently overwrites history; §24)
 *   F4a/F4b ...... finding 4  (done failures misdiagnosed as "cans check failed"; §37)
 *   F5a/F5b ...... finding 5  (status --unclaimed/--blocked/--owners are no-ops; §20/§25)
 *   F6 ........... finding 6  (`new adr` with no args prints a bare `✗ `; §37)
 *   F10 .......... finding 10 (done never updates back-pointers; §24/§35 done-success)
 *   control ...... harness pin (gate order: human gate blocks done; §24 r1)
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { join } from 'path';
import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'fs';

const REPO = join(import.meta.dir, '..', '..');
const CLI = join(REPO, 'src', 'cli.ts');
const FIXTURE_PROJECT = join(REPO, 'test', 'fixtures', 'flat-project');
const SCRATCH = join(REPO, '.tmp', 'qa-verify', 'qa-04');

interface Ws { root: string; cans: string }

const createdDirs: string[] = [];
let wsSeq = 0;

/** Fresh scratch workspace under repo/.tmp/qa-verify/qa-04 (gitignored). */
function makeWs(name: string, withCans = true): Ws {
  const root = join(SCRATCH, `${name}-${++wsSeq}`);
  mkdirSync(root, { recursive: true });
  const cans = join(root, 'cans');
  if (withCans) mkdirSync(cans, { recursive: true });
  createdDirs.push(root);
  return { root, cans };
}

/** Workspace built from the flat-project fixture, wrapped in cans/ (QA-04 workspace convention: spec files live directly inside cans/). */
function fixtureWs(name: string): Ws {
  const ws = makeWs(name);
  cpSync(FIXTURE_PROJECT, ws.cans, { recursive: true });
  return ws;
}

/** Workspace produced by the documented setup command `cans init` (§21). */
function initWs(name: string): Ws {
  const ws = makeWs(name, false); // init creates the cans/ workspace itself
  const r = runCli(['init', '--json'], ws.root);
  expect(r.exit).toBe(0);
  const j = parseJsonOut(r.out);
  expect(j.ok).toBe(true);
  return ws;
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

/** Fully-completed hand-written task file (all checkboxes checked, incl. the ← @human gate). */
function writeCompletedTask(ws: Ws, name: string, contextMarker: string): void {
  mkdirSync(join(ws.cans, '_tasks'), { recursive: true });
  const body = [
    `# ${name}`,
    '- Owner: agent-1',
    '- ADR:',
    '- Tasks',
    '  - [x] completed item ← agent-1',
    '- Review',
    '  - [x] Spec approved ← @human',
    '- Handoff',
    `  - Context: ${contextMarker}`,
    '  - Constraint:',
    '',
  ].join('\n');
  writeFileSync(join(ws.cans, '_tasks', `${name}.md`), body);
}

function writeRawTask(ws: Ws, name: string, body: string): void {
  mkdirSync(join(ws.cans, '_tasks'), { recursive: true });
  writeFileSync(join(ws.cans, '_tasks', `${name}.md`), body);
}

/** Three-task scenario for the status filter flags:
 *  - apple-task: open UNCLAIMED items (no agent after ←), gate open;
 *  - banana-task: open ASSIGNED item (← agent-9), gate checked;
 *  - cherry-task: fully assigned AND fully done → neither unclaimed nor blocked. */
function statusFilterWs(name: string): Ws {
  const ws = makeWs(name);
  writeRawTask(ws, 'apple-task', [
    '# apple-task',
    '- Owner:',
    '- ADR:',
    '- Tasks',
    '  - [ ] unassigned item one ←',
    '  - [ ] unassigned item two ←',
    '- Review',
    '  - [ ] Spec approved ← @human',
    '- Handoff',
    '  - Context:',
    '  - Constraint:',
    '',
  ].join('\n'));
  writeRawTask(ws, 'banana-task', [
    '# banana-task',
    '- Owner: agent-9',
    '- ADR:',
    '- Tasks',
    '  - [ ] assigned open item ← agent-9',
    '- Review',
    '  - [x] Spec approved ← @human',
    '- Handoff',
    '  - Context:',
    '  - Constraint:',
    '',
  ].join('\n'));
  writeRawTask(ws, 'cherry-task', [
    '# cherry-task',
    '- Owner: agent-7',
    '- ADR:',
    '- Tasks',
    '  - [x] finished item ← agent-7',
    '- Review',
    '  - [x] Spec approved ← @human',
    '- Handoff',
    '  - Context:',
    '  - Constraint:',
    '',
  ].join('\n'));
  return ws;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('QA-04 red verification: new / done / status', () => {
  test('F1a: `new adr "Postgres over MySQL" --json` keeps the flag out of slug/file/title (§20, §23, §35)', () => {
    // §20: "Commands parse only their own args" — `--json` is a flag, never part of the
    // title. §23: file = _adr/NNN-<slug of title>.md. §35 new.json: clean `file` field.
    const ws = makeWs('f1a');
    const r = runCli(['new', 'adr', 'Postgres over MySQL', '--json'], ws.root);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    // Documented artifact: clean slug `postgres-over-mysql`, no flag pollution.
    expect(j.file).toBe('_adr/001-postgres-over-mysql.md');
    expect(existsSync(join(ws.cans, '_adr', '001-postgres-over-mysql.md'))).toBe(true);
  });

  test('F1b: `new adr --json "Flag First Title"` parses the flag, keeps the title clean (§20, §23, §35)', () => {
    // Flag-first arg order: documented slug of "Flag First Title" is `flag-first-title`;
    // the flag must be parsed as a flag (§20 arg parsing), not absorbed into the name.
    const ws = makeWs('f1b');
    const r = runCli(['new', 'adr', '--json', 'Flag First Title'], ws.root);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect(j.change).toBe('flag-first-title');
    expect(j.file).toBe('_adr/001-flag-first-title.md');
    expect(existsSync(join(ws.cans, '_adr', '001-flag-first-title.md'))).toBe(true);
  });

  test('F1c: `new task add-dark-mode --json` → _tasks/add-dark-mode.md; nameless `new task --json` errors (§23, §35, §37)', () => {
    const ws = makeWs('f1c');
    // (c) Documented artifact is _tasks/<slug>.md with the slug of the name only —
    // no `-json` pollution in the created file.
    const r = runCli(['new', 'task', 'add-dark-mode', '--json'], ws.root);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect(j.file).toBe('_tasks/add-dark-mode.md');
    expect(existsSync(join(ws.cans, '_tasks', 'add-dark-mode.md'))).toBe(true);
    expect(existsSync(join(ws.cans, '_tasks', 'add-dark-mode-json.md'))).toBe(false);

    // QA-06 #19/20 variant: `new task` with no name must FAIL (§23: `new task <name>`
    // requires a name; §37: real error message) — never exit 0 creating a task
    // literally named `json` from the swallowed flag.
    const r2 = runCli(['new', 'task', '--json'], ws.root);
    expect(r2.exit).not.toBe(0);
    expect(existsSync(join(ws.cans, '_tasks', 'json.md'))).toBe(false);
  });

  test('F2: `new task` on an existing task file must refuse or preserve content, never silently reset it (§21, §37)', () => {
    // §21 precedent: init "Skips existing files unless --force". §37 error philosophy +
    // §30 (the file IS the state) imply refusal/warning over silently overwriting the
    // existing task file with the blank template. (QA-04 #11)
    const ws = fixtureWs('f2'); // has _tasks/add-dark-mode.md with real checkbox state
    const taskPath = join(ws.cans, '_tasks', 'add-dark-mode.md');
    const before = readFileSync(taskPath, 'utf-8');
    expect(before).toContain('Create toggle component'); // fixture sanity: real content present
    const r = runCli(['new', 'task', 'add-dark-mode'], ws.root);
    const after = readFileSync(taskPath, 'utf-8');
    const refused = r.exit !== 0;               // acceptable: command fails loudly
    const preserved = after.includes('Create toggle component'); // acceptable: content survives
    expect(refused || preserved).toBe(true);
  });

  test('F3: same-day re-archive must not overwrite the earlier archived record (§24)', () => {
    // §24: done moves the task to _tasks/_archive/YYYY-MM-DD-<name>.md; §30: tasks are
    // transient and the archive is the only history `done` keeps. A second same-day done
    // of a recreated task must keep the first record (distinct entry) or be refused. (QA-04 #23)
    const ws = makeWs('f3');
    writeCompletedTask(ws, 'do-thing', 'FIRST-ARCHIVE-MARKER-AAA');
    const r1 = runCli(['done', 'do-thing', '--json'], ws.root);
    const j1 = parseJsonOut(r1.out);
    expect(j1.ok).toBe(true); // setup sanity: first done completes and archives
    const archiveDir = join(ws.cans, '_tasks', '_archive');
    expect(existsSync(archiveDir)).toBe(true);

    writeCompletedTask(ws, 'do-thing', 'SECOND-ARCHIVE-MARKER-BBB');
    const r2 = runCli(['done', 'do-thing', '--json'], ws.root);
    const j2 = parseJsonOut(r2.out);

    // Documented contract: previous archived content must survive — either the second
    // done fails, or the archive holds distinct entries including the first content.
    const archiveFiles = existsSync(archiveDir)
      ? readdirSync(archiveDir).filter(f => f.endsWith('.md') && f.includes('do-thing'))
      : [];
    const archiveContents = archiveFiles
      .map(f => readFileSync(join(archiveDir, f), 'utf-8'))
      .join('\n');
    expect(j2.ok === false || archiveContents.includes('FIRST-ARCHIVE-MARKER-AAA')).toBe(true);
  });

  test('F4a: `done no-such-task` in a healthy workspace names the real cause, not "cans check failed" (§37)', () => {
    const ws = initWs('f4a');
    // Precondition (§22): the workspace is healthy — check exits 0 with 0 errors.
    const c = runCli(['check', '--json'], ws.root);
    const cj = parseJsonOut(c.out);
    expect(c.exit).toBe(0);
    expect(cj.errorCount).toBe(0);

    const r = runCli(['done', 'no-such-task'], ws.root);
    expect(r.exit).toBe(1);
    // §37: the failure must name the ACTUAL problem (task does not exist) and what to do —
    // never the false "cans check failed" diagnosis printed while check is green.
    expect(r.out).not.toContain('cans check failed');
    const namesRealCause =
      /not found|no such|unknown task|does not exist|cannot find|no task named/i.test(r.out) ||
      r.out.includes('no-such-task');
    expect(namesRealCause).toBe(true);
  });

  test('F4b: `done` without a cans workspace reports the missing workspace, not "cans check failed" (§37)', () => {
    // §37: name the actual cause. There is no workspace here at all — the message must
    // say so (e.g. "no cans workspace found — run cans init"), not misdiagnose. (QA-04 #34)
    const ws = makeWs('f4b', false); // plain directory: no cans/, no .tmp fallback
    const r = runCli(['done', 'whatever'], ws.root);
    expect(r.exit).toBe(1);
    expect(r.out).not.toContain('cans check failed'); // wrong diagnosis (currently printed)
    expect(/workspace|cans\/|missing|not found|no such|init/i.test(r.out)).toBe(true);
  });

  test('F5a: `status --unclaimed` and `status --blocked` filter to the matching subset (§20, §25)', () => {
    // §20 documents the flags; §25 defines the data they act on. Filtered output must
    // differ from default status and reflect only the filtered subset. (QA-04 #26: no-ops)
    const ws = statusFilterWs('f5a');
    const d = runCli(['status'], ws.root);
    const u = runCli(['status', '--unclaimed'], ws.root);
    const b = runCli(['status', '--blocked'], ws.root);
    expect(d.exit).toBe(0);
    expect(u.exit).toBe(0);
    expect(b.exit).toBe(0);

    // --unclaimed: only tasks holding unclaimed items.
    expect(u.out).not.toBe(d.out);              // RED: currently byte-identical to default
    expect(u.out).toContain('apple-task');      // the unclaimed items live here
    expect(u.out).not.toContain('cherry-task'); // fully assigned & done → not unclaimed

    // --blocked: only tasks with open (unfinished) work.
    expect(b.out).not.toBe(d.out);              // RED: currently byte-identical to default
    expect(b.out).toContain('banana-task');     // open assigned work → blocked
    expect(b.out).not.toContain('cherry-task'); // nothing open → not blocked
  });

  test('F5b: `status --owners` presents an owners view, not a byte-copy of default (§20, §25)', () => {
    // §20/§25: --owners is a filter flag; §25 includes owners in status. The filtered
    // view must differ from the unfiltered report. (QA-04 #26: byte-identical no-op)
    const ws = statusFilterWs('f5b');
    const d = runCli(['status'], ws.root);
    const o = runCli(['status', '--owners'], ws.root);
    expect(d.exit).toBe(0);
    expect(o.exit).toBe(0);
    expect(o.out).not.toBe(d.out);      // RED: currently byte-identical to default
    expect(o.out).toContain('agent-9'); // owners view must list the owners
  });

  test('F6: `new adr` with no title prints a real error message, not a bare ✗ (§37)', () => {
    // §37 pattern: `✗ <what>` (+ where / what to do). Exit 1 alone is not enough — the
    // message body after ✗ must be non-empty and actionable. (QA-04 #5)
    const ws = makeWs('f6');
    const r = runCli(['new', 'adr'], ws.root);
    expect(r.exit).toBe(1);
    const m = r.out.match(/✗\s?(.*)/);
    expect(m).not.toBeNull();                                        // a ✗ line exists
    expect(m![1].trim().length).toBeGreaterThan(0);                  // RED: currently empty
    expect(/title|usage|required|argument|missing|expected|name/i.test(r.out)).toBe(true);
  });

  test('F10: done updates back-pointers for see: refs whose targets lack ref-by comments (§24, §35 done-success)', () => {
    // §24: done "Updates back-pointers if needed". §35's done-success fixture reports
    // backPointersUpdated: 2 — a completable done must add missing <!-- ref-by --> marks
    // (or at least report the update). (QA-04 #30: backPointersUpdated: 0, nothing written)
    const ws = makeWs('f10');
    const auth = readFileSync(join(FIXTURE_PROJECT, '02-authentication.md'), 'utf-8')
      .replace(/ <!-- ref-by:[^>]* -->/g, ''); // ref TARGET lacks its ref-by comment
    const api = readFileSync(join(FIXTURE_PROJECT, '04-api.md'), 'utf-8'); // holds `see 02-authentication.md#Sessions`
    writeFileSync(join(ws.cans, '02-authentication.md'), auth);
    writeFileSync(join(ws.cans, '04-api.md'), api);
    writeCompletedTask(ws, 'update-sessions', 'back-pointer-probe');

    // Precondition (§22): healthy workspace so the done check gate passes.
    const c = runCli(['check', '--json'], ws.root);
    const cj = parseJsonOut(c.out);
    expect(cj.errorCount).toBe(0);

    const r = runCli(['done', 'update-sessions', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    const target = readFileSync(join(ws.cans, '02-authentication.md'), 'utf-8');
    // RED: currently backPointersUpdated: 0 and the target file is left untouched.
    expect(j.backPointersUpdated >= 1 || target.includes('ref-by')).toBe(true);
  });

  test('control (expected PASS): done blocks on an unchecked ← @human gate (§24 r1)', () => {
    // Pins the harness: on the flat-project fixture, done must be blocked by gate 1
    // (human gates ALWAYS block, never skippable) — ok:false, humanOpen ≥ 1, exit 1,
    // nothing archived. This behavior is documented AND currently correct.
    const ws = fixtureWs('control');
    const r = runCli(['done', 'add-dark-mode', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(1);
    expect(j.ok).toBe(false);
    expect(j.gates.human).toBeGreaterThanOrEqual(1);
    expect(j.gates.humanOpen).toBeGreaterThanOrEqual(1);
    expect(j.archived).toBeNull();
    expect(existsSync(join(ws.cans, '_tasks', 'add-dark-mode.md'))).toBe(true);
  });
});
