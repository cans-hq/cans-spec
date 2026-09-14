#!/usr/bin/env node
/**
 * Portable launcher for the `cans` bin (issue #12).
 *
 * Priority: Bun stays the primary runtime.
 *   1. Already executing under Bun (`bunx cans-spec`, `bun run`) → run the CLI
 *      in-process; the runtime shim's Bun fast paths apply.
 *   2. Bun on PATH but this launcher was started by Node (`npm i -g cans-spec`
 *      then `cans ...`) → re-exec `bun src/cli.ts` so Bun fast paths apply.
 *   3. No Bun → run the CLI in-process on Node, stripping TypeScript via
 *      Node's builtin `stripTypeScriptTypes` through bin/ts-loader.mjs (Node's
 *      default stripping refuses files under node_modules — see issue #12 QA).
 *
 * This file is plain JavaScript ON PURPOSE: it must execute on any Node that
 * npm can provide, before any TypeScript capability is available.
 */
import { spawnSync } from 'node:child_process';
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', 'src', 'cli.ts');
const args = process.argv.slice(2);

/** Run cli.ts in the current process; it calls process.exit() itself, but a
 *  load-time failure (unreadable package.json, syntax) must still report. */
async function runInProcess() {
  try {
    await import(pathToFileURL(cli).href);
    process.exit(process.exitCode ?? 0);
  } catch (e) {
    console.error(`✗ Internal error: ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }
}

// 1. Already under Bun — in-process, Bun fast paths.
if (typeof globalThis.Bun !== 'undefined') {
  await runInProcess();
}

// 2. Bun on PATH — re-exec so Bun stays the primary runtime.
const probe = spawnSync('bun', ['--version'], { stdio: 'ignore' });
if (!probe.error && probe.status === 0) {
  const r = spawnSync('bun', [cli, ...args], { stdio: 'inherit' });
  if (r.error) {
    console.error(`✗ Internal error: failed to launch bun: ${r.error.message}`);
    process.exit(2);
  }
  process.exit(r.status ?? 130);
}

// 3. Node fallback — needs node:module.stripTypeScriptTypes (Node ≥23.2; made
//    stable in 23.6). Termux `pkg install nodejs` ships 26.x, which qualifies.
//    Namespace access (not a named import) so older Nodes link this file fine.
const { stripTypeScriptTypes } = await import('node:module');
if (typeof stripTypeScriptTypes !== 'function') {
  console.error(
    `✗ cans requires Bun >= 1.0 (primary) or Node >= 23.2 with builtin TypeScript stripping; found Node ${process.versions.node} without Bun.`,
  );
  console.error('  Install Bun: https://bun.sh — Termux: pkg install nodejs.');
  process.exit(1);
}

// Node prints an ExperimentalWarning for stripTypeScriptTypes on every run;
// suppress just that one and pass everything else through untouched.
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w && w.name === 'ExperimentalWarning' && String(w.message).includes('stripTypeScriptTypes')) return;
  console.error(`(node:${process.pid}) [${w?.name ?? 'Warning'}] ${w?.message ?? w}`);
});

// 4. Register the .ts loader hook, then execute the CLI in-process.
register(new URL('./ts-loader.mjs', import.meta.url));
await runInProcess();
