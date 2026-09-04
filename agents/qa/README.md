# CANS Blackbox QA — Findings Index

- Repo: cans-hq/cans-spec @ `impl/full-engines` (commit 54b0b52)
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

## Aggregate verdict (2026-09-04, branch impl/full-engines @ 54b0b52)

| Report | Tests | PASS | FAIL | DEVIATION | UNDOC |
|---|---|---|---|---|---|
| QA-01 init | 26 | 15 | 1 | 5 | 3 |
| QA-02 refs/structure/style | ~35 | 24 | 3 | 7 | 6 |
| QA-03 redundancy/overflow/rules/budget | 74 | 47 | 10 | 10 | 7 |
| QA-04 new/done/status | 41 | 26 | 8 | 4 | 3 |
| QA-05 import/export | 45 | 14 | 15 | 6 | 5 |
| QA-06 CLI surface | 68 | 32 | 24 | 4 | 8 |
| **Total** | **~289** | **158** | **61** | **36** | **32** |

### Top cross-cutting issues (no fixes applied, per mandate)

1. **BLOCKER — import merge corruption**: default `cans-wins` strategy appends conflicting nodes as a child of the last node of the file; `conflicts[]` never populated (QA-05 F8/F9).
2. **MAJOR — false-success error reporting**: import/export/done/budget failures print success-shaped lines ("Imported X from Y", "✗ BLOCKED: cans check failed") with no §37 what/why/fix; unknown commands emit message-less JSON (QA-05 F1, QA-04, QA-06).
3. **MAJOR — flags swallowed into arguments**: `new adr "T" --json` creates `…-json` titled ADR; `--limit=10` / `--bogus` / `-j` silently ignored, exit 0 (QA-04, QA-06).
4. **MAJOR — §18 "delete a key = check turns off" not implemented**: deleted rules keys silently fall back to defaults; tab-indented `_rules.yaml` crashes exit 2 instead of line-number + exit 1 (QA-03 F1/F2).
5. **MAJOR — doc/impl contract gaps**: flat+folder duplicate home never flagged (§8), broken refs downgraded to "unwritten spec slot" (§12), `status --unclaimed/--blocked/--owners` are no-ops (§25), `import --out` no-op, OPML export drops checkbox state (§28), Obsidian callouts and code fences silently lost on import (§27).
6. **MAJOR — `done` misdiagnosis**: every non-gate failure reported as `check failed` even when check passes (QA-04).
7. Systemic UX: status filters no-op, `--version`/`--help` absent, redundancy word-freq layer counts `see:`/filename tokens (clean contract unreachable), fuzzy layer noisy on natural vocabulary, "has 1 children" grammar.

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
