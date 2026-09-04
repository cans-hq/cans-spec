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

---

# Round 2 (2026-09-04, branch fix/qa-red-tests-green @ e628ff2)

Method unchanged: manual blackbox QA, shell only, no scripting, no `src/`/`test/` reads, no fixes.
Four parallel agents: fix-regression verification + three new-coverage tracks. Reports QA-07..QA-10.

| Report | Area | Tests | Result |
|---|---|---|---|
| QA-07-fix-regression-verification.md | re-test of every QA-01..06 FAIL/DEVIATION finding | 89 findings | 63 FIXED · 17 STILL-BROKEN · 6 PARTIAL · 1 REGRESSED · 2 NOT-REPROD |
| QA-08-adversarial-boundary-inputs.md | unicode/edge inputs, corrupt imports, symlinks, 10k-node perf | 72 | 48 PASS · 8 FAIL · 4 DEV · 12 UNDOC |
| QA-09-stateful-sequences-interactions.md | lifecycle chains, --fix convergence, round-trips, destructive flows | 70 | 54 PASS · 7 FAIL · 8 DEV · 1 UNDOC |
| QA-10-cli-surface-round2.md | help/version accuracy, arg parser edges, stream/JSON discipline, env robustness | 86 | 60 PASS · 4 FAIL · 10 DEV · 12 UNDOC |

New-coverage tracks total: 228 tests — 162 PASS / 19 FAIL / 22 DEVIATION / 25 UNDOC. Severity across round 2: 0 BLOCKER / 15 MAJOR.

## Round-2 headline: fix verification (QA-07)

Both round-1 BLOCKERs confirmed fixed (QA-05 F8 import merge corruption, false-success error surface), plus the §37 unknown-command guidance, `new` flag-into-title, `--refs-only` scoping, OPML checkbox state, `done` gate diagnosis chain, and 25–40 ms perf claims. But 17 findings are STILL-BROKEN, 6 PARTIAL, 1 REGRESSED — the fix branch is not at 100% of round-1 findings despite 192/192 suite green (suite scope ≠ QA finding scope).

## Top cross-cutting issues still open / new (round 2)

1. **MAJOR — backward in-span missing refs still downgraded** to "unwritten spec slot" warning → false-clean `check`, and `done` archives tasks with dangling refs (QA-07, QA-09 E2).
2. **MAJOR — §18 "delete a key = check turns off" still unimplemented**; user `redundancy.synonyms` silently inert in all syntaxes (QA-07, QA-09 E8).
3. **MAJOR — import/export fidelity gaps persist**: Obsidian callouts + post-fence content silently dropped, logseq round-trip mints dead `[[X/Y]]` refs, `--merge-strategy ask` honors don't-merge but reports nothing (QA-07, QA-08 E, QA-09 D).
4. **MAJOR — init hazards**: `--tool claude` manufactures a failing workspace (CLAUDE.md parsed as 8th spec file); `--force` silently clobbers `_collab/{handoffs,conflicts,decisions}.md` (QA-09 A/E, QA-07).
5. **MAJOR — arg-parser inconsistency**: `status -j/--bogus/-abc` misdiagnose as "no workspace" in human mode (JSON mode is correct); `check --bogus` silently swallowed; `budget read --limit abc/-5` misreports cause (QA-10 C/M1–M3).
6. **MAJOR — adversarial surfaces**: `done ../_collab/escape` accepts path traversal then crashes raw ENOENT; CRLF-only file parses as 0 nodes (false-clean, invisible to budget); `export` path collisions raise raw `ENOTDIR` exit 2 as "Internal error" (QA-08).
7. **REGRESSED — `init --bare` no longer creates AGENTS.md** while help still advertises it (QA-07).
8. **PERF — 10k-node check 8.4 s (69 s with `--json`)** vs §40 budget; normal workspaces remain 25–40 ms (QA-08 F).

## What held up (round 2)

Round-1 BLOCKER fixes verified green; unknown-command/typo guidance 16/16 (QA-10 B); flag-interaction matrix clean 11/11 (QA-10 E); lifecycle chain 16/17 PASS; `check --fix` converges to a stable fixpoint and is idempotent; budget write/read state machine coherent (10/12); export→import round-trips preserve hierarchy for opml/dynalist; fresh imports of all three formats still exact; no data-loss BLOCKER found anywhere in round 2.
