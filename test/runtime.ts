/** Runtime-aware helpers for the test suite (issue #12).
 *
 *  `spawnCli` picks the CURRENT runtime's binary so the same blackbox suite
 *  exercises the Bun fast path under `bun test` and the Node fallback under
 *  `npm run test:node` — the fallback path is actually executed, not skipped.
 *  Also ports the Bun-only file utilities (Bun.write / Bun.file.text /
 *  import.meta.dir) to node:fs equivalents that behave identically under Bun.
 */
import { spawnSync as nodeSpawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url)); // test/

export const REPO = join(HERE, '..');
export const CLI = join(REPO, 'src', 'cli.ts');

export const TEST_RUNTIME: 'bun' | 'node' =
  typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined' ? 'bun' : 'node';

/** Node <23.6 needs an explicit flag to run TypeScript; ≥23.6 strips types by
 *  default and Bun never needs it. */
const NODE_TS_FLAGS: string[] = (() => {
  if (TEST_RUNTIME === 'bun') return [];
  const [maj, min] = process.versions.node.split('.').map(Number);
  return maj > 23 || (maj === 23 && min >= 6) ? [] : ['--experimental-strip-types'];
})();

export interface CliRun {
  exit: number | null;
  out: string;
  err: string;
}

/** Spawn `src/cli.ts` as a blackbox process under the current runtime. */
export function spawnCli(
  args: string[],
  cwd: string,
  env: Record<string, string | undefined> = { ...process.env },
): CliRun {
  if (TEST_RUNTIME === 'bun') {
    const p = Bun.spawnSync(['bun', 'run', CLI, ...args], {
      cwd,
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return { exit: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
  }
  const p = nodeSpawnSync(process.execPath, [...NODE_TS_FLAGS, CLI, ...args], {
    cwd,
    env,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    exit: p.status,
    out: p.stdout ? p.stdout.toString() : '',
    err: p.stderr ? p.stderr.toString() : '',
  };
}

/** Sync text write — the portable replacement for fire-and-forget `Bun.write`
 *  calls in tests (also deterministic: no unawaited promise races). */
export function writeTextSync(path: string, content: string): void {
  writeFileSync(path, content, 'utf8');
}

/** Sync text read — the portable replacement for `await Bun.file(p).text()`. */
export function readTextSync(path: string): string {
  return readFileSync(path, 'utf8');
}
