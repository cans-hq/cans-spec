/**
 * QA round-3 red tests — §27/§28 import interop (findings from QA-14, npm cans-spec@0.1.0).
 *
 * Each test asserts the DOCUMENTED contract (docs/cans.architecture.md, § citations
 * inline) that the implementation currently violates, and therefore FAILS (red) as
 * an assertion failure, confirming the mapped round-3 QA finding.
 * No assertions encode current buggy behavior; no failure-swallowing; no skips.
 *
 * Mapping (test → finding):
 *   R3-I1a ....... QA-14 F1 (MAJOR) — §27 "Strip app metadata" + §31 stripMetadata():
 *                  a logseq line carrying an inline `key:: value` property must lose
 *                  the PROPERTY, not the NODE. Actual: every line containing an inline
 *                  property is dropped silently — including cans' own exported owner
 *                  form (`agent-1:: assigned`, §28 Logseq column), which breaks the
 *                  export→import round-trip.
 *   R3-I1b ....... QA-14 F3 / carries QA-06 #4 STILL-BROKEN — §20 "Arg parsing:
 *                  Primitive. --flag value only. No --flag=value": import must reject
 *                  the equals-form like every other command. Actual: silently behaves
 *                  as default cans-wins, exit 0.
 *   R3-I1c ....... QA-14 F2 — §27 cans-wins + §35 import.json fixture: a conflicting
 *                  node re-imported with diverged wording is a CONFLICT (the §35
 *                  fixture itself shows divergent `cansVersion` vs `importVersion`
 *                  text) and must be reported in conflicts[]. Actual: appended as a
 *                  duplicate sibling, conflicts: [].
 *   control-opml . CONTROL (green at HEAD): space-form flags + a clean fresh import
 *                  work — proves the harness, so R3-I1b red is specifically the
 *                  equals-form path.
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync } from 'fs';

const REPO = join(import.meta.dir, '..', '..');
const CLI = join(REPO, 'src', 'cli.ts');
const SCRATCH = join(REPO, '.tmp', 'qa-round3', 'interop');

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

/** Concatenated content of every .md file under `dir` (recursive). */
function allMarkdown(dir: string, prefix = ''): string {
  let out = '';
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out += allMarkdown(full, `${prefix}${entry.name}/`);
    else if (entry.name.endsWith('.md')) out += readFileSync(full, 'utf-8') + '\n';
  }
  return out;
}

const DYNALIST_OPML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<opml version="2.0">',
  '<head><title>Project Backlog</title></head>',
  '<body>',
  '  <outline text="Authentication">',
  '    <outline text="Sign up">',
  '      <outline text="Email"/>',
  '      <outline text="Google"/>',
  '    </outline>',
  '    <outline text="Sessions">',
  '      <outline text="Expire after 24 hours"/>',
  '    </outline>',
  '  </outline>',
  '</body>',
  '</opml>',
  '',
].join('\n');

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('QA round-3 red verification: §27 import interop (QA-14 F1/F2/F3)', () => {
  test('R3-I1a (§27/§31 / QA-14 F1 MAJOR): logseq import strips inline `key:: value` properties but KEEPS the node', () => {
    // The two task lines mirror cans' own `cans export logseq --include-tasks`
    // owner form (§28 Logseq column: `agent-1:: assigned`), so this doubles as a
    // round-trip guard. Actual (QA-14 F1): any line with an inline property is
    // dropped whole — both task nodes vanish, exit 0.
    const ws = makeWs('r3-i1a-logseq-props');
    writeFileSync(join(ws.cans, '01-spec.md'), '- Overview\n  - Existing spec body\n');
    const page = join(ws.root, 'logseq-page.md');
    writeFileSync(page, [
      '- TODO Implement auth flow agent-1:: assigned',
      '- DONE Add Google OAuth agent-1:: assigned',
      '- Token validation',
      '  - id:: ((block-ref-123))',
      '',
    ].join('\n'));
    const r = runCli(['import', 'logseq', page, '--json'], ws.root);
    const parsed = parseJsonOut(r.out);
    expect(parsed.ok).toBe(true);
    const produced = allMarkdown(ws.cans);
    expect(produced).toContain('Implement auth flow'); // TODO → task node survives
    expect(produced).toContain('Add Google OAuth');    // DONE → done node survives
    expect(produced).not.toContain('agent-1::');       // property stripped (§27/§31)
  });

  test('R3-I1b (§20 / QA-14 F3, carries QA-06 #4): import rejects equals-form `--merge-strategy=ask` like every other command', () => {
    // §20: "--flag value only. No --flag=value." Round-2 QA-06 #4 fixed this for
    // init/budget/check; import still silently accepts it (QA-14 F3).
    const ws = makeWs('r3-i1b-equals-form');
    writeFileSync(join(ws.cans, '01-spec.md'), '- Overview\n  - Existing spec body\n');
    const opml = join(ws.root, 'backlog.opml');
    writeFileSync(opml, DYNALIST_OPML);
    const r = runCli(['import', 'opml', opml, '--merge-strategy=ask'], ws.root);
    expect(r.exit).toBe(1);
    expect(`${r.out}\n${r.err}`).toMatch(/merge-strategy|flag|invalid|unknown/i);
  });

  test('control (green at HEAD): space-form `--merge-strategy ask` performs a fresh import cleanly', () => {
    const ws = makeWs('ctl-space-form');
    writeFileSync(join(ws.cans, '01-spec.md'), '- Overview\n  - Existing spec body\n');
    const opml = join(ws.root, 'backlog.opml');
    writeFileSync(opml, DYNALIST_OPML);
    const r = runCli(['import', 'opml', opml, '--merge-strategy', 'ask', '--json'], ws.root);
    const parsed = parseJsonOut(r.out);
    expect(parsed.ok).toBe(true);
    expect(r.exit).toBe(0);
  });

  test('R3-I1c (§27/§35 / QA-14 F2): cans-wins reports a diverged re-import as a conflict, not a silent duplicate sibling', () => {
    // §35 import.json fixture itself models divergent text as a conflict:
    //   cansVersion "Session expires after 24 hours" vs importVersion
    //   "Sessions expire after 24h" → conflicts[] entry with resolution.
    // Actual (QA-14 F2): the diverged node is appended as a NEW sibling,
    // conflicts: [] — duplicate home, silently.
    const ws = makeWs('r3-i1c-divergent');
    writeFileSync(join(ws.cans, '02-authentication.md'), [
      '- Sessions',
      '  - Expire after 24 hours',
      '  - Refresh allowed for 30 days',
      '',
    ].join('\n'));
    const opml = join(ws.root, 'diverged.opml');
    writeFileSync(opml, [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<opml version="2.0">',
      '<head><title>Diverged</title></head>',
      '<body>',
      '  <outline text="Sessions">',
      '    <outline text="Sessions expire after 24h"/>',
      '  </outline>',
      '</body>',
      '</opml>',
      '',
    ].join('\n'));
    const r = runCli(['import', 'opml', opml, '--json'], ws.root);
    const parsed = parseJsonOut(r.out);
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.conflicts)).toBe(true);
    expect(parsed.conflicts.length).toBeGreaterThanOrEqual(1); // diverged node IS a conflict
    // cans-wins must not clobber the canonical text either way (§27)
    const produced = allMarkdown(ws.cans);
    expect(produced).toContain('Expire after 24 hours');
  });
});
