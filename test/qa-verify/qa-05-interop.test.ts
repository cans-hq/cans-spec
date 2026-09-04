/**
 * QA-05 red-test verification — `cans import` / `cans export` interop.
 * Report: agents/qa/QA-05-interop-import-export.md
 * Doc:    docs/cans.architecture.md (§3, §4, §19, §20, §27, §28, §31, §34, §35, §36, §37, §45)
 *
 * Every test asserts the DOCUMENTED contract (cited § + finding ID). Because the
 * implementation currently violates it, every non-control test MUST fail with an
 * assertion failure demonstrating the finding. No assertion encodes current
 * buggy behavior; no try/catch swallows failures; nothing is skipped.
 *
 * Method: blackbox CLI spawn (Bun.spawnSync) against scratch workspaces under
 * repo/.tmp/qa-verify/qa-05 (gitignored). Fixtures are read-only and copied in.
 */
import { describe, expect, test, afterAll } from 'bun:test';
import { join, dirname } from 'path';
import {
  mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync,
} from 'fs';

const REPO = join(import.meta.dir, '..', '..');
const CLI = join(REPO, 'src', 'cli.ts');
const IMPORT_FIXTURES = join(REPO, 'test', 'fixtures', 'import-fixtures');
const FLAT_PROJECT = join(REPO, 'test', 'fixtures', 'flat-project');
const BASE = join(REPO, '.tmp', 'qa-verify', 'qa-05');

function runCli(args: string[], cwd: string): { exit: number | null; out: string; err: string } {
  const env = { ...process.env } as Record<string, string>;
  delete env.CANS_ROOT; // isolation: the scratch cwd decides the workspace
  const p = Bun.spawnSync(['bun', 'run', CLI, ...args], { cwd, env, stdout: 'pipe', stderr: 'pipe' });
  return { exit: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}

/** Fresh `cans init --bare` workspace under BASE/<name>. */
function makeWorkspace(name: string): string {
  const dir = join(BASE, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const r = runCli(['init', '--bare'], dir);
  if (r.exit !== 0) throw new Error(`setup: cans init --bare failed in ${dir}: ${r.out}${r.err}`);
  return dir;
}

/** Copy fixture content into the scratch workspace (fixtures themselves stay read-only). */
function putFile(dir: string, rel: string, content: string): void {
  const p = join(dir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

function putFixture(ws: string, fixturePath: string, name: string): void {
  putFile(ws, name, readFileSync(fixturePath, 'utf-8'));
}

function readAllFiles(root: string): string {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push(readFileSync(p, 'utf-8'));
    }
  };
  walk(root);
  return out.join('\n');
}

/** §34 fixture: dynalist-export.opml imports as cans/07-authentication.md with this exact hierarchy. */
const OPML_EXPECTED = [
  '- Authentication',
  '  - Sign up',
  '    - Email',
  '    - Google',
  '  - Sessions',
  '    - Expire after 24 hours',
  '- Dashboard',
  '  - Requires verified account',
  '',
].join('\n');

/** F8/F9 scenario (QA-05 matrix row 14/16): import opml → human edits a node → conflicting re-import. */
function seedConflictWorkspace(name: string): string {
  const ws = makeWorkspace(name);
  putFixture(ws, join(IMPORT_FIXTURES, 'dynalist-export.opml'), 'dynalist-export.opml');
  const first = runCli(['import', 'opml', 'dynalist-export.opml'], ws);
  if (first.exit !== 0) throw new Error(`setup: first import failed: ${first.out}${first.err}`);
  const f = join(ws, 'cans', '07-authentication.md');
  const edited = readFileSync(f, 'utf-8').replace('Expire after 24 hours', 'Expire after 48 hours');
  if (!edited.includes('Expire after 48 hours')) throw new Error('setup: conflict edit did not apply');
  writeFileSync(f, edited);
  return ws;
}

afterAll(() => {
  rmSync(BASE, { recursive: true, force: true });
});

describe('QA-05 interop import/export (agents/qa/QA-05-interop-import-export.md)', () => {
  // ── control ──────────────────────────────────────────────────────────────
  test('control (expected PASS): happy-path opml import — fresh bare ws, exact hierarchy, exit 0, newFiles non-empty (§27, §34, §35)', () => {
    const ws = makeWorkspace('control-happy');
    putFixture(ws, join(IMPORT_FIXTURES, 'dynalist-export.opml'), 'dynalist-export.opml');
    const r = runCli(['import', 'opml', 'dynalist-export.opml', '--json'], ws);
    expect(r.exit).toBe(0); // §19: success → 0
    const j = JSON.parse(r.out);
    expect(j.ok).toBe(true);
    expect(j.newFiles).toContain('07-authentication.md');
    expect(j.merged).toEqual([]);
    expect(j.conflicts).toEqual([]);
    const content = readFileSync(join(ws, 'cans', '07-authentication.md'), 'utf-8');
    expect(content).toBe(OPML_EXPECTED); // §27 "Preserve hierarchy" + §34 nesting
  });

  // ── F1 (BLOCKER, §37): failures must say what happened/why/fix — never a false-success line ──
  test('F1a (§37, §19): `import opml <nonexistent>` must fail with a stated reason and must NOT print the success-shaped "Imported … from …" line (human + --json reason field)', () => {
    const ws = makeWorkspace('f1a-nonexistent');
    const r = runCli(['import', 'opml', 'nope.opml'], ws);
    expect(r.exit).toBe(1); // §19: user-correctable failure → 1 (this part holds today)
    // §37: a failed run must not claim success. Current output: "Imported opml from nope.opml".
    expect(r.out).not.toMatch(/Imported\s+\S+\s+from\s+\S/);
    // §37: the failure must say WHY (✗ <what> / <where>: <detail> / <what to do>).
    expect(`${r.out}${r.err}`).toMatch(/✗|not found|no such|does not exist|cannot|unable|invalid/i);
    // §35/§37: the JSON result must carry the reason for machine consumers.
    const rj = runCli(['import', 'opml', 'nope.opml', '--json'], ws);
    const j = JSON.parse(rj.out) as Record<string, unknown>;
    expect(j.ok).toBe(false);
    const reason = j.message ?? j.error;
    expect(typeof reason === 'string' && (reason as string).length > 0).toBe(true);
  });

  test('F1b (§37, §27): unknown import format must fail naming the valid formats (opml, dynalist, logseq, obsidian), never a false-success line', () => {
    const ws = makeWorkspace('f1b-unknown-format');
    const r = runCli(['import', 'workflowy', 'x.md'], ws);
    expect(r.exit).toBe(1); // §19
    // §37: no success-shaped line on a failed run. Current output: "Imported workflowy from x.md".
    expect(r.out).not.toMatch(/Imported\s+\S+\s+from\s+\S/);
    // §37 + §27 (Formats: opml, dynalist, logseq, obsidian): tell the user what IS valid.
    const text = `${r.out}${r.err}`;
    for (const fmt of ['opml', 'dynalist', 'logseq', 'obsidian']) {
      expect(text).toContain(fmt);
    }
  });

  // ── F2 (MAJOR, §3/§4/§31): imported wiki-link refs must use the canonical .md form ──
  test('F2 (§4, §31, §45): logseq wiki-link import must emit a resolvable ref `02-authentication.md#Sessions` (with .md) — `cans check` must report 0 broken refs', () => {
    const ws = makeWorkspace('f2-ref-md');
    // Seed the canonical target so the ref CAN resolve if generated correctly.
    putFile(ws, join('cans', '02-authentication.md'), readFileSync(join(FLAT_PROJECT, '02-authentication.md'), 'utf-8'));
    putFixture(ws, join(IMPORT_FIXTURES, 'logseq-page.md'), 'logseq-page.md');
    const r = runCli(['import', 'logseq', 'logseq-page.md'], ws);
    expect(r.exit).toBe(0);
    const content = readFileSync(join(ws, 'cans', '07-implement-auth-flow.md'), 'utf-8');
    // §4 canonical ref form: `see 02-authentication.md#Sessions`. Current: `see: 02-authentication#Sessions`.
    expect(content).toMatch(/see:?\s+02-authentication\.md#Sessions/);
    // §45/§27: `cans check` must report the imported ref as resolvable (no NEW broken refs).
    const chk = runCli(['check', '--json'], ws);
    const cj = JSON.parse(chk.out);
    expect(cj.refs.broken).toBe(0);
  });

  // ── F3 (MAJOR, §4/§31): ref target is exactly page#anchor; trailing prose stays node content ──
  test('F3 (§4, §31): `[[02-authentication#Sessions]] expire after 24 hours` must import as ref target `02-authentication.md#Sessions` plus remaining prose as node content', () => {
    const ws = makeWorkspace('f3-ref-target');
    putFixture(ws, join(IMPORT_FIXTURES, 'logseq-page.md'), 'logseq-page.md');
    const r = runCli(['import', 'logseq', 'logseq-page.md'], ws);
    expect(r.exit).toBe(0);
    const content = readFileSync(join(ws, 'cans', '07-implement-auth-flow.md'), 'utf-8');
    const refLine = content.split('\n').find(l => /\bsee:?\s/.test(l));
    expect(refLine).toBeDefined();
    const m = refLine!.match(/see:?\s+(\S+)(?:\s(.*))?$/);
    expect(m).not.toBeNull();
    const target = m![1];
    const rest = (m![2] ?? '').trim();
    // §4: the ref TARGET is exactly page.md#anchor. Current: `02-authentication#Sessions` (and the
    // prose hangs off the same ref line, leaving the target token ambiguous per QA-05 F3).
    expect(target).toBe('02-authentication.md#Sessions');
    // The remaining prose must survive as node content, not be swallowed into the ref.
    expect(rest).toBe('expire after 24 hours');
  });

  // ── F4 (MAJOR, §31): Obsidian callouts must be handled — content preserved, not dropped ──
  test('F4 (§31): obsidian callout (`> [!note] Decision` / `> Use token bucket algorithm`) content must survive import', () => {
    const ws = makeWorkspace('f4-callout');
    putFixture(ws, join(IMPORT_FIXTURES, 'obsidian-note.md'), 'obsidian-note.md');
    const r = runCli(['import', 'obsidian', 'obsidian-note.md'], ws);
    expect(r.exit).toBe(0);
    // §31: the Obsidian converter "Handles callout markers (`> [!note]`)" — the callout body is
    // spec content and must appear somewhere in the imported workspace. Currently it vanishes.
    expect(readAllFiles(join(ws, 'cans'))).toMatch(/token bucket/i);
  });

  // ── F5 (MAJOR, §27): fenced code blocks must be EXTRACTED (overflow), never silently deleted ──
  test('F5 (§27, §16): fenced json/yaml code blocks under bullets must be extracted to overflow files — their content must survive import', () => {
    const ws = makeWorkspace('f5-codeblock');
    const cb = [
      '- API',
      '  - Request schema',
      '    ```json',
      '    {"rate": 100, "overflow-json-token-9f3a": true}',
      '    ```',
      '  - Response schema',
      '    ```yaml',
      '    overflow-yaml-token-7c1d: token-bucket',
      '    ```',
      '',
    ].join('\n');
    putFile(ws, 'cb-obsidian.md', cb);
    const r = runCli(['import', 'obsidian', 'cb-obsidian.md'], ws);
    expect(r.exit).toBe(0);
    // §27 import rules: "Extract code blocks → overflow files." Either way, the fenced content
    // must exist in the workspace (overflow file, or carried by a see: ref target that exists).
    const all = readAllFiles(join(ws, 'cans'));
    expect(all).toContain('overflow-json-token-9f3a');
    expect(all).toContain('overflow-yaml-token-7c1d');
  });

  // ── F8 (BLOCKER, §27/§35): default cans-wins merge must only add NEW nodes — no corruption ──
  test('F8a (§27): cans-wins re-import over a human edit must keep the human version and must NOT re-add the conflicting import node anywhere in the file', () => {
    const ws = seedConflictWorkspace('f8a-merge-corruption');
    const r = runCli(['import', 'opml', 'dynalist-export.opml'], ws); // default strategy = cans-wins
    expect(r.exit).toBe(0);
    const content = readFileSync(join(ws, 'cans', '07-authentication.md'), 'utf-8');
    // Human edit must survive untouched.
    expect(content).toContain('Expire after 48 hours');
    // §27: cans-wins "only adds new nodes". The import node contradicts the human-edited node —
    // it must NOT be re-added (today it is appended as a child of the LAST node of the file:
    // `Dashboard → Requires verified account → Expire after 24 hours` — structural corruption +
    // duplicate concept).
    expect(content).not.toContain('Expire after 24 hours');
  });

  test('F8b (§35): the cans-wins conflicting re-import must report the conflict in conflicts[] with resolution "cans-wins"', () => {
    const ws = seedConflictWorkspace('f8b-conflict-shape');
    const r = runCli(['import', 'opml', 'dynalist-export.opml', '--json'], ws);
    const j = JSON.parse(r.out);
    // §35: conflicts: [{ file, line, cansVersion, importVersion, resolution }].
    expect(Array.isArray(j.conflicts)).toBe(true);
    expect(j.conflicts.length).toBeGreaterThan(0); // currently [] — silent corruption
    const c = j.conflicts[0];
    expect(c.resolution).toBe('cans-wins');
    expect(typeof c.cansVersion).toBe('string');
    expect(typeof c.importVersion).toBe('string');
    expect(c.file).toBe('07-authentication.md');
  });

  // ── F9 (MAJOR, §27/§35): `ask` must REPORT conflicts (and not merge) ──
  test('F9 (§27, §35): `--merge-strategy ask` on a conflicting re-import must populate conflicts[] and must not merge', () => {
    const ws = seedConflictWorkspace('f9-ask');
    const before = readFileSync(join(ws, 'cans', '07-authentication.md'), 'utf-8');
    const r = runCli(['import', 'opml', 'dynalist-export.opml', '--merge-strategy', 'ask', '--json'], ws);
    const j = JSON.parse(r.out);
    // §27: ask = "report conflicts, don't merge". A machine consumer must learn a conflict happened.
    expect(j.conflicts.length).toBeGreaterThan(0); // currently [] — reported nothing
    // Must not merge: human version kept, import version absent.
    const after = readFileSync(join(ws, 'cans', '07-authentication.md'), 'utf-8');
    expect(after).toBe(before);
    expect(after).toContain('Expire after 48 hours');
    expect(after).not.toContain('Expire after 24 hours');
  });

  // ── F10 (MINOR, §37): invalid enum values must be rejected, not silently accepted ──
  test('F10 (§37, §27): `--merge-strategy banana` must be rejected with an error naming the valid strategies', () => {
    const ws = makeWorkspace('f10-banana');
    putFixture(ws, join(IMPORT_FIXTURES, 'dynalist-export.opml'), 'dynalist-export.opml');
    const r = runCli(['import', 'opml', 'dynalist-export.opml', '--merge-strategy', 'banana'], ws);
    // §37-style arg validation. Currently silently accepted, behaves as default, exit 0.
    expect(r.exit).not.toBe(0);
    const text = `${r.out}${r.err}`;
    expect(text).toContain('banana'); // the error names the offending value
    // ... and lists the valid strategies (§27: cans-wins | import-wins | ask).
    for (const s of ['cans-wins', 'import-wins', 'ask']) {
      expect(text).toContain(s);
    }
  });

  // ── F11 (MAJOR, §20/§36): `import --out <path>` must create the files under <path> ──
  test('F11 (§20, §36): `import --out <path>` must create the imported file under <path>, not in the default workspace location', () => {
    const ws = makeWorkspace('f11-out-flag');
    putFixture(ws, join(IMPORT_FIXTURES, 'dynalist-export.opml'), 'dynalist-export.opml');
    const r = runCli(['import', 'opml', 'dynalist-export.opml', '--out', 'customout'], ws);
    expect(r.exit).toBe(0); // the flag is advertised usage (§20/§36); the import itself succeeds
    // Documented contract (§20 `cans import <format> <path> [--out <path>]`, §36 help text):
    // files are created at <path> instead of the workspace default.
    expect(existsSync(join(ws, 'customout', '07-authentication.md'))).toBe(true); // currently: customout never created
    expect(existsSync(join(ws, 'cans', '07-authentication.md'))).toBe(false); // currently: written to cans/ instead
  });

  // ── F12 (MINOR, §31/§37): non-XML garbage passed as .opml must be REJECTED ──
  test('F12 (§31, §37): non-XML content passed as `import opml` must be rejected with an invalid-OPML message, not a silent success', () => {
    const ws = makeWorkspace('f12-garbage');
    putFile(ws, 'garbage.opml', 'not xml at all {{{ >>>');
    const r = runCli(['import', 'opml', 'garbage.opml'], ws);
    // §31: the OPML converter parses XML; §37: reject with a proper message. Currently exit 0 +
    // "Imported opml from garbage.opml" with zero files.
    expect(r.exit).not.toBe(0);
    expect(`${r.out}${r.err}`).toMatch(/invalid|not valid|malformed|not well.?formed/i);
    // No silent partial import: no new spec file may appear.
    const specs = readdirSync(join(ws, 'cans')).filter(f => f.endsWith('.md') && f !== '00-overview.md');
    expect(specs).toEqual([]);
  });

  // ── F14 (MAJOR, §28): OPML export must preserve checkbox state ──
  test('F14 (§28): `export opml --include-tasks` must preserve checkbox markers (`[ ]` / `[x]`) for task items', () => {
    const ws = makeWorkspace('f14-opml-checkboxes');
    for (const f of ['02-authentication.md', '04-api.md', '06-operations.md']) {
      putFile(ws, join('cans', f), readFileSync(join(FLAT_PROJECT, f), 'utf-8'));
    }
    putFile(ws, join('cans', '_tasks', 'add-dark-mode.md'), readFileSync(join(FLAT_PROJECT, '_tasks', 'add-dark-mode.md'), 'utf-8'));
    const r = runCli(['export', 'opml', '--include-tasks'], ws);
    expect(r.exit).toBe(0);
    const opmlPath = join(ws, 'cans-export', 'opml', 'add-dark-mode.opml');
    expect(existsSync(opmlPath)).toBe(true); // task file exported at all (holds today)
    const opml = readFileSync(opmlPath, 'utf-8');
    // §28 table: CANS `- [ ] task` → OPML `- [ ] task`. Done vs open must stay distinguishable.
    // The fixture has both states (2 × [x], 4 × [ ]). Currently both markers are dropped entirely.
    expect(opml).toContain('[ ]');
    expect(opml).toContain('[x]');
  });
});
