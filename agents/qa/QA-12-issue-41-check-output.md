# QA-12 — Agent-friendly check output (issue #41)

**Method:** blackbox CLI QA. The real `bin/cans.js` is spawned as a subprocess
against generated issue-scale workspaces (`test/qa-blackbox/gen-workspace.ts`,
deterministic, ~13 spec files / ~2900 nodes / depth 6) with every violation
class from issue #41 planted by construction. Nothing is asserted from reading
code; every result below was reproduced by execution on both runtimes
(bun 1.3.14 primary, node 24.21.0 registerHooks fallback).

## Scope

- Feature: aggregated, agent-friendly `cans check` output (issue #41).
- Risk: human-report contract drift; `--json` consumer breakage; `--fix`
  regressions; Node runtime warning leakage; exit-code contract change
  (0/1/2) breaking shell pipelines.
- Artifacts under test: `src/core/report.ts` (aggregation core),
  `src/core/output.ts` (human printer + JSON wire shape), `src/commands/check.ts`
  (`--show`, timing, exit codes), `src/core/structure.ts` (documented
  siblings.min / depth.min enforcement), `bin/cans.js` + `bin/ts-loader.mjs`
  (warning hygiene), `src/core/runtime.ts` (untouched).

## Planted scenario (matches the issue's numbers)

| Class | Planted | Observed (`check --json`) |
|---|---|---|
| sibling-count-min violations | 61 | 61 |
| depth-min files | 2 | 2 |
| broken refs → 4 missing files | 91 (72/16/2/1) | 91 (72/16/2/1) |
| broken anchor | 1 | 1 |
| orphan files | 1 | 1 |
| stale back-pointers | 8 | 8 |
| keyword-sprawl warnings | ~115 (top: artifacts:105, db:74, api:66) | 115 |
| overlap warnings | 75 (22 exact / 53 fuzzy) | 22 / 53 |
| typo warnings | 0 (generator is typo-immune by construction) | 0 |

## Acceptance criteria (issue #41) — all verified

| Criterion | Result |
|---|---|
| Default output ≤ 500 tokens for a project of this size | **499 tokens** (1998 chars ÷ 4) for 354 findings — the old reporter needed ~4200 tokens for fewer findings on a smaller workspace |
| Every `file:line` still present (compact comma-list) | ✓ `01-charter:7,47,87,127,167`, `04-budget:2,3,4,5,6,7,8,9` |
| Elapsed ms on the first line | ✓ `✗ 13 files · 2912 nodes · depth 6 · 213ms` |
| `--json` structured sections → `{file, line, rule, detail}` | ✓ lossless superset: `+ level, suggestion?`; `summary.elapsedMs` number |
| `--show <section>` expands a folded group | ✓ default top-5 keywords (`artifacts:105 …`) → all 115 lines; `--show` accepts comma lists and `all` |
| Node deprecation/runtime warnings suppressed (stderr only) | ✓ 0 bytes of `DeprecationWarning` / `ExperimentalWarning` / `(node:` on stdout AND stderr, both runtimes (registerHooks-first launcher — fixed by construction, not filtering) |
| `--fix` still works for stale back-pointers | ✓ `backPointersUpdated ≥ 1`, stale 8 → 0, comments removed from `04-budget.md` |
| Exit codes `0` clean · `1` warnings · `2` errors | ✓ verified on clean / warnings-only / issue-scale workspaces + usage failures (`--bogus`, bad `--show` value → 2) |
| One line per pattern, count prefix | ✓ `61× <min children (2/3)`, `91× missing file`; zero occurrences of the raw per-occurrence sentence |
| Group by root cause | ✓ 91 broken refs → 4 target groups with per-target counts, ONE fix hint |
| Fix hint once per pattern | ✓ verified per group |

## Contract tests added

`test/qa-blackbox/qa-12-check-output.test.ts` (14 tests):
current-behavior block (always on: JSON parses, clean exit 0, noise hygiene,
`--fix`) + target-contract block (the acceptance matrix above, gated by
`CANS_QA_TARGET=1`).

## Implementation findings fixed during QA

| # | Severity | Finding | Resolution |
|---|---|---|---|
| F1 | MAJOR | `structure.siblings.min` and `structure.depth.min` were documented (§15 "sibling count per parent", "depth (min/max)") but never enforced — the issue's own scenario (`61× has 2 children (min 3)`, `2× depth <min`) was unproducible. | Both checks implemented (warning-level, §18 delete-key semantics respected, 1-based depth, single-child case left to `single_child_collapse` to avoid double-reporting). Default rules (min 1) are unaffected. |
| F2 | MAJOR | On Node ≥ 26, `module.register()` (issue #12's loader path) emits a DeprecationWarning that leaked into users' captured output. | `bin/cans.js` now prefers `module.registerHooks()` (Node ≥ 23.5, in-process, no loader thread — the warning cannot exist); `register()` remains only as the 23.2–23.4 fallback with the warning suppressed to stderr. |
| F3 | MINOR | Keyword group metrics (the `×105` node counts) were dropped by the aggregation accumulator, degrading the report to occurrence counts. | Accumulator carries `metric`; rendering and ranking use it (`artifacts:105  yaml:91  db:74 …`). |

## Non-goals respected

No new dependencies; no build step; Bun stays primary; `CheckResult.issues`
(the in-process API used by `done`) unchanged; other commands' `--json` shapes
untouched.
