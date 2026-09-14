# QA-11 — Node.js fallback runtime (issue #12)

**Method:** dual-runtime blackbox QA. The whole existing suite (264 tests, incl.
the blackbox QA-01…QA-08 spawns) runs under BOTH runtimes, plus an
install-and-run matrix against the real npm artifact. Nothing is asserted from
reading code; every finding below was reproduced by execution.

## Scope

- Feature: Node.js fallback runtime with Bun kept primary (issue #12).
- Risk: behavior drift on the Bun fast path; Termux/no-Bun path silently broken
  (Node refuses to strip types under `node_modules` — found and fixed, F1).
- Artifacts under test: `src/core/runtime.ts` (shim), `bin/cans.js` +
  `bin/ts-loader.mjs` (launcher), `test/runtime.ts` + `test/testing.ts` +
  `test/node-compat.ts` (harness), `package.json`, `tsconfig.json`, CI, docs.

## Findings

| # | Severity | Finding | Resolution |
|---|---|---|---|
| F1 | **BLOCKER** (found during QA, fixed before release) | Node's builtin type-stripping **refuses files under `node_modules`** ("Stripping types is currently unsupported for files under node_modules") — `npm i -g cans-spec && cans check` with no Bun failed with exit 2. This killed the issue's primary Termux acceptance criterion even with Node ≥23.6. | `bin/cans.js` registers `bin/ts-loader.mjs`, which performs the same erasable-syntax stripping via Node's builtin `node:module.stripTypeScriptTypes` — no deps, no build step — bypassing only the path-based veto. Verified against the installed artifact. |
| F2 | MAJOR | `Bun.CryptoHasher` in `test/qa-verify/qa-01` — a Bun API invisible to the `Bun\.` audit scope of the issue and missed by the initial inventory. | Replaced with `node:crypto` `createHash` (portable). |
| F3 | MAJOR | Node's ESM resolver **requires explicit extensions**; the repo's 178 extensionless relative imports (incl. 33 dynamic `import()`) broke every module load under Node. | Explicit `.ts` extensions across `src/` + `test/` (mechanical, scripted, resolver-verified), `allowImportingTsExtensions: true` in tsconfig. Bun accepts both forms. |
| F4 | MINOR | `test/helpers.ts` used fire-and-forget `Bun.write` (unawaited promise) — latent race on both runtimes. | Sync `writeFileSync` write helper; deterministic. |
| F5 | MINOR | `require('fs')` inside a test file (ESM package) — worked under Bun, illegal under Node ESM. | `readFileSync` import. |
| F6 | COSMETIC | Node prints an `ExperimentalWarning: stripTypeScriptTypes` per invocation from the loader thread. | Suppressed inside `bin/ts-loader.mjs` (thread-scoped, `CANS_DEBUG_WARNINGS=1` escape hatch). Verified stderr is 0 bytes. |

## Verification matrix (all executed)

| Check | Result |
|---|---|
| `bunx tsc --noEmit` (strict, both type surfaces) | clean |
| `bun test` — 264 tests / 26 files | 264 pass, 0 fail |
| `npm run test:node` (node --test, Node 24) — same 264 | 264 pass, 0 fail |
| Self-audit test: `Bun\.` confined to `src/core/runtime.ts` | enforced in-suite (runs on both runtimes) |
| `npm pack` tarball | only `bin/`, `src/`, `templates/`, README, LICENSE — no test/.tmp leakage |
| `npm i -g --prefix <isolated>` + real `cans` bin | install + link OK |
| **No-Bun PATH (Termux sim), all 8 commands**: version, help, init, new task, new adr, check, status, budget read, export, import | all pass; `done` correctly refuses the @human gate (contract) |
| Bun preferred when on PATH | proven via intercepted probe: launcher runs `bun --version` then re-execs `bun src/cli.ts` |
| `bun bin/cans.js` (bun executing launcher) | in-process, Bun fast path |
| **Byte-identical drift check**: `main` (pre-#12) vs branch, same fixture, Bun — `check --json` / export artifacts / created task file | byte-identical |
| Node-fallback output vs pre-#12 Bun output | byte-identical |
| stderr on a plain `cans version` (no-bun path) | 0 bytes |

## Contract tests added

`test/node-fallback.test.ts` (13 tests): shim source audit (Bun APIs confined to
the shim; `import.meta.dir` banned), shim IO round-trip + parent-dir creation
(Bun.write parity), glob parity (single-segment + recursive + missing-dir
contract), and a spawned-CLI end-to-end cycle that runs under whichever runtime
executes the suite.

## Non-goals respected

No runtime dependencies added; no build step/bundler; Bun not dropped; one code
path, two runtimes; no Windows-specific work.
