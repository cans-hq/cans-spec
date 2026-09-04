/**
 * QA-01 red-test verification — `cans init` & workspace lifecycle.
 *
 * Every non-control test encodes the DOCUMENTED contract from
 * docs/cans.architecture.md (§ cited per test) and therefore MUST currently
 * FAIL (red) because the implementation violates it. Control tests pin the
 * harness (expected PASS). No src/ fixes here — tests only.
 *
 * Findings under test (agents/qa/QA-01-init-workspace-lifecycle.md):
 *   #1  MAJOR       --flat --folders creates duplicate-home twins (§8)
 *   #3  DEVIATION   init from inside cans/ subdir does not refuse (§21)
 *   #4  DEVIATION   init --json root is absolute, fixture says "./cans" (§35)
 *   #6  UNDOCUMENTED unknown flags silently ignored (§20/§37 spirit)
 *   #7  UNDOCUMENTED --tool <unknown> silently ignored (§21/§37 spirit)
 *   #8  UX          refusal inside cans/ prints empty reason (§21/§37)
 */
import { describe, test, expect, afterEach, afterAll } from 'bun:test';
import { join } from 'path';
import {
  mkdirSync,
  rmSync,
  existsSync,
  readdirSync,
  readFileSync,
} from 'fs';

const REPO = join(import.meta.dir, '..', '..');
const CLI = join(REPO, 'src', 'cli.ts');

/** Blackbox CLI spawn: captures exit code + both streams. */
function runCli(args: string[], cwd: string) {
  const p = Bun.spawnSync(['bun', 'run', CLI, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { exit: p.exitCode ?? -1, out: p.stdout.toString(), err: p.stderr.toString() };
}

/** Unique scratch workspace per test, under repo/.tmp/qa-verify (gitignored). */
let scratchCounter = 0;
const scratchDirs: string[] = [];
function makeScratch(name: string): string {
  scratchCounter += 1;
  const dir = join(REPO, '.tmp', 'qa-verify', `qa01-${name}-${scratchCounter}`);
  mkdirSync(dir, { recursive: true });
  scratchDirs.push(dir);
  return dir;
}

function cleanupScratch() {
  for (const d of scratchDirs) rmSync(d, { recursive: true, force: true });
  scratchDirs.length = 0;
}
afterEach(cleanupScratch);
afterAll(cleanupScratch);

/** Recursively list all regular file paths under `root`. */
function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(root);
  return out;
}

function sha256File(p: string): string {
  const h = new Bun.CryptoHasher('sha256');
  h.update(readFileSync(p));
  return h.digest('hex');
}

/** §35 output/init.json fixture: `created` entries (relative to cans/). */
const SKELETON: string[] = [
  '_rules.yaml',
  'AGENTS.md',
  '00-overview.md',
  '01-architecture.md',
  '02-authentication.md',
  '03-data.md',
  '04-api.md',
  '05-frontend.md',
  '06-operations.md',
  '_adr/',
  '_tasks/',
  '_collab/handoffs.md',
  '_collab/conflicts.md',
  '_collab/decisions.md',
];

describe('QA-01 init/workspace lifecycle (red-test verification)', () => {
  // ---------------------------------------------------------------- controls
  test('control (expected PASS): plain init in a fresh dir creates the §21/§35 skeleton and exits 0', () => {
    const ws = makeScratch('control-skeleton');
    const res = runCli(['init'], ws);

    expect(res.err).toBe('');
    expect(res.exit).toBe(0);

    // §35 init.json fixture: the full created[] skeleton lives under ./cans/
    for (const entry of SKELETON) {
      const p = join(ws, 'cans', entry.replace(/\/$/, ''));
      expect(existsSync(p), `missing skeleton entry: ${entry}`).toBe(true);
    }
  });

  test('control (expected PASS): second init is idempotent — exit 0, all files unchanged', () => {
    const ws = makeScratch('control-idempotent');
    runCli(['init'], ws);

    const cans = join(ws, 'cans');
    const before = new Map<string, string>(
      listFiles(cans).map((p) => [p, sha256File(p)]),
    );

    // §21: "Creates workspace skeleton. Idempotent. Skips existing files."
    const res2 = runCli(['init'], ws);
    expect(res2.exit).toBe(0);

    const after = new Map<string, string>(
      listFiles(cans).map((p) => [p, sha256File(p)]),
    );
    expect(after.size).toBe(before.size);
    for (const [p, hash] of before) {
      expect(after.get(p), `file mutated by second init: ${p}`).toBe(hash);
    }
  });

  // ------------------------------------------------------------------- red
  test('red #1: init --flat --folders over a flat workspace must NOT create folder twins beside existing flat specs (§8: "Flat wins over folder")', () => {
    const ws = makeScratch('flat-folders-twins');
    runCli(['init'], ws); // seed flat workspace (flat is the §21 default)

    // QA-01 finding #1: second init with BOTH mode flags currently exits 0 and
    // creates 0X-<name>/index.md twins next to 0X-<name>.md — the exact
    // duplicate-canonical-home state that §8 says `cans check` flags as an
    // error. Documented contract: flat/folder is one deterministic mode
    // ("Flat wins over folder"), so init must refuse or apply flat precedence;
    // it must never manufacture a both-exist workspace.
    runCli(['init', '--flat', '--folders'], ws);

    const specs = [
      '01-architecture',
      '02-authentication',
      '03-data',
      '04-api',
      '05-frontend',
      '06-operations',
    ];
    for (const spec of specs) {
      expect(
        existsSync(join(ws, 'cans', spec, 'index.md')),
        `folder-mode twin created beside existing flat spec ${spec}.md (§8 duplicate canonical home)`,
      ).toBe(false);
    }
    // Flat precedence must leave the original canonical flat specs in place.
    for (const spec of specs) {
      expect(existsSync(join(ws, 'cans', `${spec}.md`))).toBe(true);
    }
  });

  test('red #3: init with cwd inside a subdirectory of cans/ must REFUSE (§21: "Refuses if already inside a cans/ directory")', () => {
    const ws = makeScratch('subdir-refusal');
    runCli(['init'], ws);

    // QA-01 finding #3: from cans/_collab/ the CLI currently walks up,
    // re-targets the ancestor workspace and exits 0 with ok:true. §21 says
    // init refuses when already inside a cans/ directory — regardless of depth.
    const res = runCli(['init'], join(ws, 'cans', '_collab'));

    expect(res.exit).not.toBe(0);
  });

  test('red #4: init --json field `root` must be "./cans" (§35 init.json fixture)', () => {
    const ws = makeScratch('json-root');
    const res = runCli(['init', '--json'], ws);
    expect(res.exit).toBe(0);

    // QA-01 finding #4: fixture pins "root": "./cans"; implementation prints
    // an absolute filesystem path instead.
    const parsed = JSON.parse(res.out) as { root: string };
    expect(parsed.root).toBe('./cans');
  });

  test('red #6a: unknown flag --bogus must not be silently ignored (§20/§37 spirit: say what happened)', () => {
    // NOTE: scratch slug must be regex-neutral — a slug containing 'bogus' or
    // 'unknown' would echo back inside the `Workspace:` path and self-match.
    const ws = makeScratch('flagx');
    const res = runCli(['init', '--bogus'], ws);

    // QA-01 finding #6: --bogus currently produces a normal init, exit 0, and
    // no trace of the flag anywhere. The CLI must either reject it (exit != 0)
    // or at minimum surface a warning naming the unknown flag (§37: the user
    // is told what happened; never silence).
    const surfaced =
      res.exit !== 0 || /bogus|unknown|unrecognized|unexpected|invalid/i.test(res.out + res.err);
    expect(surfaced, 'unknown flag --bogus was silently ignored (exit 0, no warning)').toBe(true);
  });

  test('red #6b: typo flag --folder (singular) must not be silently ignored (§20/§37 spirit)', () => {
    const ws = makeScratch('flagy');
    const res = runCli(['init', '--folder'], ws);

    // QA-01 finding #6 (realistic typo): a user typing --folder silently gets
    // flat mode. Documented contract: unknown/near-miss flags must produce an
    // error or a warning naming the flag.
    const surfaced =
      res.exit !== 0 || /--folder\b|unknown|unrecognized|unexpected|invalid/i.test(res.out + res.err);
    expect(surfaced, 'typo flag --folder was silently ignored (exit 0, no warning)').toBe(true);
  });

  test('red #7: init --tool windsurf (unknown tool) must warn or error (§21/§37 spirit)', () => {
    const ws = makeScratch('toolx');
    const res = runCli(['init', '--tool', 'windsurf'], ws);

    // QA-01 finding #7: --tool windsurf currently exits 0 with no artifact and
    // no warning. §21 documents --tool <name> emitting a tool-specific file
    // (CLAUDE.md / .cursorrules); an unknown tool must be surfaced, not
    // silently dropped (§37: never silence).
    const surfaced =
      res.exit !== 0 || /windsurf/i.test(res.out + res.err);
    expect(surfaced, 'unknown tool "windsurf" was silently ignored (exit 0, no warning, no artifact)').toBe(true);
  });

  test('red #8: refusal inside a cans/ directory must state WHY — non-empty reason (§37 error-message philosophy)', () => {
    // NOTE: neutral slug — 'refus...' must not appear in the workspace path,
    // or the empty-refusal output could self-match the reason regex below.
    const ws = makeScratch('whyprobe');
    mkdirSync(join(ws, 'cans'));
    const res = runCli(['init'], join(ws, 'cans'));

    // §21: "Refuses if already inside a `cans/` directory." The refusal itself
    // happens (exit 1, control holds), but QA-01 finding #8: stdout is
    // literally `Workspace: ` with nothing after it and stderr is empty —
    // the user is told nothing. §37: every error says what/where/what-to-do,
    // so the refusal must carry substantive reason text beyond the bare
    // `Workspace:` header (hence `workspace` is NOT in this alternation —
    // matching the header alone would be asserting the bug).
    expect(res.exit).not.toBe(0);
    const message = (res.out + res.err).trim();
    expect(
      message,
      `refusal carries no reason, only the empty header prefix: ${JSON.stringify(message)}`,
    ).toMatch(/inside|already|refus|within|cannot|existing/i);
  });
});

