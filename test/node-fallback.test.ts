/**
 * Node.js fallback runtime — contract tests (issue #12).
 *
 * Pins the acceptance criteria of the dual-runtime support:
 *   1. the runtime shim (`src/core/runtime.ts`) is the ONLY place in src/
 *      touching Bun.* globals (grep audit — self-enforcing, runs on BOTH
 *      runtimes);
 *   2. `import.meta.dir` (Bun-only) never reappears in src/;
 *   3. shim read/write round-trip, parent-dir creation on write (Bun.write
 *      parity), and glob semantics match Bun.Glob (single-segment + recursive
 *      forms, sorted relative paths, files only);
 *   4. the whole CLI surface works when spawned under the CURRENT runtime —
 *      Bun fast path under `bun test`, Node fallback under `node --test` —
 *      via the same blackbox runner the other suites use.
 */
import { describe, test, expect, afterEach } from './testing.ts';
import { join, basename } from 'path';
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import {
  readText, writeText, globFiles, RUNTIME, argv, dirFromUrl,
} from '../src/core/runtime.ts';
import { spawnCli, REPO, TEST_RUNTIME } from './runtime.ts';

const SCRATCH = join(REPO, '.tmp', 'node-fallback');

const created: string[] = [];

function scratchDir(name: string): string {
  const dir = join(SCRATCH, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  created.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of created.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('issue #12: runtime shim source audit', () => {
  test(`grep audit: "Bun." appears only in src/core/runtime.ts (running under ${RUNTIME})`, () => {
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.ts')) hits.push(p);
      }
    };
    walk(join(REPO, 'src'));
    const offenders: string[] = [];
    for (const file of hits) {
      const text = readFileSync(file, 'utf8');
      if (/Bun\./.test(text) && basename(file) !== 'runtime.ts') {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('Bun-only import.meta.dir never appears in src/ (shim doc aside)', () => {
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.ts')) hits.push(p);
      }
    };
    walk(join(REPO, 'src'));
    const offenders = hits.filter(
      f => basename(f) !== 'runtime.ts' && readFileSync(f, 'utf8').includes('import.meta.dir'),
    );
    expect(offenders).toEqual([]);
  });

  test('shim picks the expected runtime for this process', () => {
    expect(RUNTIME).toBe(TEST_RUNTIME);
  });

  test('argv() is process.argv.slice(2) on both runtimes', () => {
    expect(argv()).toEqual(process.argv.slice(2));
  });

  test('dirFromUrl matches the module file directory', () => {
    // import.meta.url of THIS file → its directory is <repo>/test
    expect(basename(dirFromUrl(import.meta.url))).toBe('test');
  });
});

describe('issue #12: shim file IO + glob parity', () => {
  test('writeText → readText round-trips UTF-8 content', async () => {
    const dir = scratchDir('roundtrip');
    const p = join(dir, 'spec.md');
    const content = '# 00-overview\n\n- the outline is the spec\n- 多字节 content ✓\n';
    await writeText(p, content);
    expect(await readText(p)).toBe(content);
    expect(readFileSync(p, 'utf8')).toBe(content);
  });

  test('writeText creates missing parent directories (Bun.write parity)', async () => {
    const dir = scratchDir('mkdir-parent');
    const p = join(dir, '_tasks', 'nested', '01-write-parent.md');
    await writeText(p, '- [ ] task\n');
    expect(statSync(p).isFile()).toBe(true);
    expect(await readText(p)).toBe('- [ ] task\n');
  });

  test('readText rejects on a missing file (both runtimes throw)', async () => {
    const dir = scratchDir('missing');
    let threw = false;
    try {
      await readText(join(dir, 'nope.md'));
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test('globFiles: single-segment *.md matches files only, sorted, relative', () => {
    const dir = scratchDir('glob-flat');
    writeTextSyncForTest(join(dir, '02-b.md'), 'x');
    writeTextSyncForTest(join(dir, '01-a.md'), 'x');
    writeTextSyncForTest(join(dir, '_private.md'), 'x');
    writeTextSyncForTest(join(dir, 'notes.txt'), 'x');
    mkdirSync(join(dir, 'sub'));
    writeTextSyncForTest(join(dir, 'sub', '99-nested.md'), 'x');
    expect(globFiles(dir, '*.md')).toEqual(['01-a.md', '02-b.md', '_private.md']);
    expect(globFiles(join(dir, 'sub'), '*.md')).toEqual(['99-nested.md']);
  });

  test('globFiles: **/*.md is recursive and includes root-level files', () => {
    const dir = scratchDir('glob-recursive');
    writeTextSyncForTest(join(dir, '01-root.md'), 'x');
    mkdirSync(join(dir, 'sub'));
    writeTextSyncForTest(join(dir, 'sub', '02-nested.md'), 'x');
    expect(globFiles(dir, '**/*.md')).toEqual(['01-root.md', 'sub/02-nested.md']);
  });

  test('globFiles: nonexistent directory returns [] (unchanged discovery contract)', () => {
    expect(globFiles(join(SCRATCH, 'does-not-exist'), '*.md')).toEqual([]);
  });
});

describe('issue #12: CLI end-to-end under the current runtime', () => {
  test('spawned CLI drives the full init → check → status → done cycle', () => {
    const dir = scratchDir(`e2e-${TEST_RUNTIME}`);
    const env = { ...process.env, CANS_ROOT: '' };

    const init = spawnCli(['init'], dir, env);
    expect(init.exit).toBe(0);
    expect(init.out).toContain('Workspace:');

    const check = spawnCli(['check'], dir, env);
    expect(check.exit).toBe(1); // issue #41: warnings-only → exit 1 (was 0 pre-#41)
    // issue #41: report opens with the severity + shape + timing line; the old
    // "N errors, M warnings." footer is gone (severity lives on line 1 + $?).
    expect(check.out).toMatch(/[⚠✓] \d+ files · \d+ nodes · depth \d+ · \d+ms/);

    const newTask = spawnCli(['new', 'task', 'verify-fallback'], dir, env);
    expect(newTask.exit).toBe(0);
    expect(newTask.out).toContain('Created _tasks/verify-fallback.md');

    // Complete the task's checkboxes and @human gate — `done` must then pass.
    const taskPath = join(dir, 'cans', '_tasks', 'verify-fallback.md');
    writeFileSync(taskPath, readFileSync(taskPath, 'utf8').replaceAll('- [ ]', '- [x]'), 'utf8');

    const status = spawnCli(['status', '--json'], dir, env);
    expect(status.exit).toBe(0);
    const parsed = JSON.parse(status.out) as { ok: boolean; activeTasks: number };
    expect(parsed.ok).toBe(true);
    expect(parsed.activeTasks).toBe(1);

    const done = spawnCli(['done', 'verify-fallback'], dir, env);
    expect(done.exit).toBe(0);
    expect(done.out).toContain('Archived');
  });

  test('version still derives from package.json on both runtimes', () => {
    const dir = scratchDir(`version-${TEST_RUNTIME}`);
    const r = spawnCli(['version'], dir, { ...process.env, CANS_ROOT: '' });
    expect(r.exit).toBe(0);
    expect(r.out.trim()).toMatch(/^cans \d+\.\d+\.\d+$/);
  });
});

/** Local sync write helper (keeps this file's writes deterministic). */
function writeTextSyncForTest(path: string, content: string): void {
  writeFileSync(path, content, 'utf8');
}
