# CANS Blackbox QA — Findings Index

- Repo: cans-hq/cans-spec @ `impl/full-engines` (commit 54b0b52); **re-verified 2026-09-04 on `fix/qa-red-tests-green` @ e628ff2**
- Method: manual Blackbox QA, shell commands only, no scripting, no fixes.
- Spec source of truth: `docs/cans.architecture.md`, `README.md`, `templates/`.
- CLI under test: `bun run /home/z/my-project/cans-spec/src/cli.ts <command>`
- Scratch workspaces live outside the repo at `/home/z/my-project/qa-playground/`.

## Rules every QA agent followed

1. BLACKBOX: behavior tested only through the CLI surface and filesystem results. Source in `src/` was never read; repo test suite (`bun test`) never run.
2. Manual shell commands only — no test harnesses or scripts were written.
3. No fixes — bugs are reported, never patched.
4. Every test records: command run, expected behavior (with doc reference), actual behavior, verdict PASS/FAIL/DEVIATION.

## Reports

| Report | Area | Docs sections |
|---|---|---|
| QA-01-init-workspace-lifecycle.md | init / workspace skeleton / idempotency | §8, §21 |
| QA-02-check-engines-refs-structure-style.md | refs, structure, style engines | §12, §15-17, §22 |
| QA-03-check-engines-redundancy-overflow-rules.md | redundancy, overflow, rules, token-budget | §13, §14, §16, §18, §26 |
| QA-04-workflow-new-done-status.md | new adr/task, done, status | §23-25, §29, §30 |
| QA-05-interop-import-export.md | import/export, converters | §27, §28, §31 |
| QA-06-cli-surface-contracts.md | help, errors, exit codes, arg parsing, JSON contracts | §19, §20, §35-37, §41 |

Each report contains its own verdict summary (PASS/FAIL counts) and detailed findings with severity ratings.

## Aggregate verdict

Pre-fix (2026-09-04, branch impl/full-engines @ 54b0b52):

| Report | Tests | PASS | FAIL | DEVIATION | UNDOC |
|---|---|---|---|---|---|
| QA-01 init | 26 | 15 | 1 | 5 | 3 |
| QA-02 refs/structure/style | ~35 | 24 | 3 | 7 | 6 |
| QA-03 redundancy/overflow/rules/budget | 74 | 47 | 10 | 10 | 7 |
| QA-04 new/done/status | 41 | 26 | 8 | 4 | 3 |
| QA-05 import/export | 45 | 14 | 15 | 6 | 5 |
| QA-06 CLI surface | 68 | 32 | 24 | 4 | 8 |
| **Total** | **~289** | **158** | **61** | **36** | **32** |

Post-fix re-verification (2026-09-04, branch `fix/qa-red-tests-green` @ e628ff2): every finding in QA-01..06 was re-verified by parallel agents — each via its mapped `test/qa-verify/` red-test suite (all green) plus blackbox CLI re-runs of the original repros.

| Report | Findings tracked | RESOLVED | PARTIAL | DOC-GAP | OPEN | Mapped suite |
|---|---|---|---|---|---|---|
| QA-01 init | 12 | 8 | 0 | 4 | 0 | qa-01 9/9 green |
| QA-02 refs/structure/style | 18 | 13 | 2 | 1 | 2 | qa-02 11/11 green |
| QA-03 redundancy/overflow/rules/budget | 17 | 16 | 0 | 1 | 0 | qa-03 16/16 green |
| QA-04 new/done/status | 10 | 10 | 0 | 0 | 0 | qa-04 12/12 green |
| QA-05 import/export | 19 | 13 | 2 | 3 | 1 | qa-05 14/14 green |
| QA-06 CLI surface | 13 | 8 | 3 | 2 | 0 | qa-06 16/16 green |
| **Total** | **89** | **68** | **7** | **11** | **3** | **78/78 green; repo `bun test` 192/192** |

Status legend: RESOLVED = fixed and verified on this branch · PARTIAL = main fix landed, a concrete remainder is named in the report · DOC-GAP = implementation correct, residual is a docs-internal inconsistency/omission · OPEN = still reproduces.

### Top cross-cutting issues — resolution status (verified 2026-09-04 on fix/qa-red-tests-green)

1. **BLOCKER — import merge corruption** (QA-05 F8/F9): **RESOLVED** — cans-wins no longer appends conflicting nodes; conflicts[] populated with file/line/both-versions/resolution (red tests F8a/F8b green + blackbox repro).
2. **MAJOR — false-success error reporting** (QA-05 F1, QA-04, QA-06): **RESOLVED** — all failure paths print §37 what/why/fix and set JSON `error`; the false "BLOCKED: cans check failed" line no longer reproduces.
3. **MAJOR — flags swallowed into arguments** (QA-04, QA-06): **RESOLVED (one PARTIAL remainder)** — unknown/equals-form/short/missing-value flags rejected with exit 1; `new` never builds titles from flags. Remainder: `import --merge-strategy=<bogus>` equals form still silently defaults (QA-06 #4).
4. **MAJOR — §18 "delete a key = check turns off" not implemented** (QA-03 F1/F2): **RESOLVED** — deleted sections/keys disable their checks; malformed `_rules.yaml` → line-numbered error, exit 1.
5. **MAJOR — doc/impl contract gaps** (§8/§12/§25/§27/§28): **largely RESOLVED** — duplicate-home flagged (QA-02 F1), backward refs within span now error (QA-02 F2 PARTIAL: heuristic remains for backward in-span targets), status filters real (QA-04 #5), `import --out` honored (QA-05 F11), OPML checkboxes preserved (QA-05 F14), callouts/code fences preserved (QA-05 F4/F5).
6. **MAJOR — `done` misdiagnosis** (QA-04): **RESOLVED** — not-found / no-workspace / already-archived each name the real cause; JSON carries `error`.
7. Systemic UX: **RESOLVED** — status filters work, `--help`/`--version` present, redundancy word-freq layer no longer counts `see:`/filename tokens (QA-02 F3, QA-03 F7), fuzzy skips synonym-matched pairs (QA-03 F8), grammar fixed ("exactly 1 child"). Two noisy-layer items remain OPEN by design choice of the docs: mixed all-leaf collapse groups unflagged (QA-02 F6) and fuzzy layer still fires on natural vocabulary pairs (QA-02 F15) — both need a coordinated docs+impl decision.

Remaining non-RESOLVED tail: 7 PARTIAL (concrete remainders named inline in each report), 11 DOC-GAP (docs-internal: §8 `_adr/_template.md` ghost, §33 token claim, §21 `--force`/`--bare --folders` scope, §14/§15/§36 ✗→⚠ severity sync, §26 budget matching semantics, §27/§45 roundtrip contradiction, §28 `_adr/` export exclusion, §19 stream discipline, §36/README flag drift, §20 `--refs-only` prose), 3 OPEN (QA-02 F6 mixed collapse groups, QA-02 F15 fuzzy natural-vocabulary noise, QA-05 F15 `--from` semantics).

### What held up

Core check pipeline (parse → refs → structure → style), `--fix` strictly back-pointer-only and idempotent, JSON shapes match §35 fixtures key-for-key, exit-code triad 0/1/2 including EACCES → 2, warnings-vs-`--strict` contract, budget read/write plans per §26, fresh imports of all three formats preserve hierarchy exactly, perf 27–37 ms vs §40 budget, init idempotency + skeleton fidelity.
