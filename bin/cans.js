#!/usr/bin/env node
/**
 * Portable launcher for the `cans` bin (issue #12; warning hygiene per issue #41).
 *
 * Priority: Bun stays the primary runtime.
 *   1. Already executing under Bun (`bunx cans-spec`, `bun run`) → run the CLI
 *      in-process; the runtime shim's Bun fast paths apply. No hooks needed.
 *   2. Bun on PATH but this launcher was started by Node (`npm i -g cans-spec`
 *      then `cans ...`) → re-exec `bun src/cli.ts` so Bun fast paths apply.
 *   3. No Bun → run the CLI in-process on Node, stripping TypeScript via
 *      Node's builtin `stripTypeScriptTypes`, installed in this order:
 *        a. `module.registerHooks()` (Node ≥ 23.5) — in-process SYNCHRONOUS
 *           hooks. No loader thread, so Node never prints the loader-thread
 *           ExperimentalWarning, and `module.register()` is never called —
 *           so Node ≥ 26 can never emit its
 *           "`module.register()` is deprecated. Use `module.registerHooks()`"
 *           DeprecationWarning (issue #41: that line leaked into users'
 *           captured stdout pipelines). The fix is by construction, not by
 *           filtering.
 *        b. `module.register()` fallback (Node 23.2–23.4, no registerHooks) —
 *           spawns bin/ts-loader.mjs in a loader thread; both the
 *           stripTypeScriptTypes ExperimentalWarning and any
 *           `module.register` DeprecationWarning are suppressed below
 *           (CANS_DEBUG_WARNINGS=1 restores them).
 *        c. Neither hook API → actionable error, exit 1.
 *
 * Warning policy (issue #41 design rule 6): runtime warnings NEVER reach
 * stdout. The stripTypeScriptTypes ExperimentalWarning is always suppressed;
 * every other warning goes to stderr via console.error — never stdout.
 *
 * Node's builtin stripping refuses files under node_modules — bin/ts-loader.mjs
 * documents why the stripping lives here (issue #12 QA).
 *
 * This file is plain JavaScript ON PURPOSE: it must execute on any Node that
 * npm can provide, before any TypeScript capability is available.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

// 1. Already under Bun — in-process, Bun fast paths. Bun prints no runtime
//    warnings for this workload; no hooks or filters are installed here.
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
const nodeModule = await import('node:module');
const { stripTypeScriptTypes } = nodeModule;
if (typeof stripTypeScriptTypes !== 'function') {
  console.error(
    `✗ cans requires Bun >= 1.0 (primary) or Node >= 23.2 with builtin TypeScript stripping; found Node ${process.versions.node} without Bun.`,
  );
  console.error('  Install Bun: https://bun.sh — Termux: pkg install nodejs.');
  process.exit(1);
}

// Warning policy (issue #41, design rule 6): keep runtime warnings off stdout.
//  - The stripTypeScriptTypes ExperimentalWarning is always suppressed: it
//    describes Node's own machinery, not the user's spec. It fires once per
//    process on the first strip call (registerHooks path) or inside the loader
//    thread (register path — silenced there too, see bin/ts-loader.mjs).
//  - The `module.register()` DeprecationWarning can only exist when register()
//    is actually called (fallback b, Node 23.2–23.4); suppressing it here as
//    well is by-construction safe — path (a) never calls register(), so the
//    warning cannot exist there.
//  - Anything else still goes to stderr (console.error) — never stdout.
//  - CANS_DEBUG_WARNINGS=1 restores every warning on both paths (escape hatch).
process.removeAllListeners('warning');
process.on('warning', (w) => {
  const msg = String(w?.message ?? w ?? '');
  if (process.env.CANS_DEBUG_WARNINGS === '1') {
    console.error(`(node:${process.pid}) [${w?.name ?? 'Warning'}] ${msg}`);
    return;
  }
  if (w?.name === 'ExperimentalWarning' && /striptypescript|type.?stripping/i.test(msg)) return;
  if (w?.name === 'DeprecationWarning' && msg.includes('module.register')) return;
  console.error(`(node:${process.pid}) [${w?.name ?? 'Warning'}] ${msg}`);
});

// 4a. Preferred: in-process synchronous hooks (Node ≥ 23.5). Same
//     load(url, context, nextLoad) contract as the register() loader, but no
//     loader thread → no ExperimentalWarning, and no register() call → no
//     DeprecationWarning on Node ≥ 26. registerHooks hooks must be
//     SYNCHRONOUS (Node validates the returned source synchronously), so this
//     is the sync twin of bin/ts-loader.mjs's load hook — keep the two
//     logic-for-byte equivalent.
if (typeof nodeModule.registerHooks === 'function') {
  nodeModule.registerHooks({
    load(url, context, nextLoad) {
      if (url.endsWith('.ts')) {
        const file = fileURLToPath(url);
        // Node ≥23.2 returns an object ({ source }); some versions return the
        // stripped string directly — accept both shapes (same as ts-loader).
        const result = stripTypeScriptTypes(readFileSync(file, 'utf8'), { sourceUrl: file });
        const source = typeof result === 'string' ? result : result?.source;
        return { format: 'module', source, shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });
  await runInProcess();
}

// 4b. Fallback: loader-thread register() (Node 23.2–23.4, no registerHooks).
//     bin/ts-loader.mjs performs the same stripping inside the thread (where
//     the thread's own ExperimentalWarning is silenced, unless
//     CANS_DEBUG_WARNINGS=1).
if (typeof nodeModule.register === 'function') {
  nodeModule.register(new URL('./ts-loader.mjs', import.meta.url));
  await runInProcess();
}

// 4c. Neither hook API exists — too old to run the CLI without Bun.
console.error(
  `✗ cans needs module.registerHooks (Node >= 23.5) or module.register (Node >= 23.2) to run without Bun; found Node ${process.versions.node}.`,
);
console.error('  Install Bun: https://bun.sh — Termux: pkg install nodejs.');
process.exit(1);
