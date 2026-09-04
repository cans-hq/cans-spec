# QA-01 — `cans init` & Workspace Lifecycle (Blackbox)

Task ID: 3-a | Agent: qa-init | Date: 2026-09-03
Resolution: verified 2026-09-04 on fix/qa-red-tests-green @ e628ff2 — 8/12 findings RESOLVED, 0 PARTIAL, 4 DOC-GAP, 0 OPEN; mapped suite qa-01-init-lifecycle 9/9 green.

## Scope & docs covered

- `docs/cans.architecture.md`: §8 Workspace Structure (L143-172), §21 `cans init` (L508-522), §18 Rules System / default `_rules.yaml` (L411-462), §33 AGENTS.md Template ~800 tokens (L778-839), §35 `output/init.json` fixture (L1226-1234), §19 exit codes (L475), §29 comparison-table row "String-replace for tool name" (L29).
- `README.md` (Quick Start: `mkdir my-project && cd my-project; cans init; cans check; cans status`).
- `templates/**`: `AGENTS.md`, `_rules.yaml`, `adr-template.md`, `task-template.md`.
- Discovered convention (from README + `help` footer "Config: cans/_rules.yaml" + §35 `"root": "./cans"`): **init creates the workspace in `./cans/` relative to the current working directory.**

## Environment

- bun 1.3.14; repo `/home/z/my-project/cans-spec` @ `impl/full-engines` `54b0b52` (clean, only `agents/` untracked).
- Invocation: `bun run /home/z/my-project/cans-spec/src/cli.ts <command>` from scratch dirs under `/home/z/my-project/qa-playground/qa-init/`.
- Blackbox: no `src/` files read, no `bun test`, no scripts — manual shell only.

## Test matrix

| # | Command (in empty scratch dir unless noted) | Expected (doc ref) | Actual | Verdict |
|---|---|---|---|---|
| 1 | `init` | Skeleton per §21+§35: `_rules.yaml`, `AGENTS.md`, 00..06 specs, `_adr/`, `_tasks/`, `_collab/{handoffs,conflicts,decisions}.md` under `./cans/` | Exactly that; exit 0; flat layout; human list uses `+` marks | PASS |
| 2 | `tree` after #1 vs §8 | §8 also shows `_adr/_template.md` | `_adr/` empty — **no `_template.md`** (matches §35 fixture, contradicts §8) | DEVIATION |
| 3 | `diff cans/_rules.yaml templates/_rules.yaml` | Created file = bundled default | Byte-identical | PASS |
| 4 | `diff cans/_rules.yaml` vs §18 block (L419-460) | Same keys/values | Identical except blank separator lines (YAML-equivalent) | PASS |
| 5 | `diff cans/AGENTS.md templates/AGENTS.md` | Emitted from AGENTS.md template | Byte-identical | PASS |
| 6 | `wc -w -c AGENTS.md` vs §33 "~800 tokens" | ~800 tokens | **737 words / 4728 chars** ⇒ ≈1350 tokens at doc's own 3.5 chars/token (§18) | DEVIATION |
| 7 | `init` (2nd run, t01) | Idempotent, skips existing (§21) | exit 0; all 14 entries `= (exists, skipped)`; all md5s unchanged | PASS |
| 8 | edit `02-authentication.md` → `init --force` | `--force` overwrites (§21 documented) | Edit clobbered, md5 back to pristine; ALL files incl. `_collab/*` recreated; exit 0; no confirmation | PASS (per doc) |
| 9 | `init --folders` | §8: `02-authentication/index.md` style | 01–06 become `<name>/index.md`; `00-overview.md` stays flat; content of index.md correct | PASS |
| 10 | `init --bare` | §21: "minimal" (undefined) | Only `_rules.yaml`, `AGENTS.md`, `00-overview.md`; exit 0 | PASS |
| 11 | `init --bare --folders` | — | Same as `--bare` (folders ignored) | PASS (undocumented combo, sensible) |
| 12 | `init --tool claude` | §21: emits CLAUDE.md from AGENTS.md | `cans/CLAUDE.md` created, byte-identical to `AGENTS.md` (AGENTS.md also kept); exit 0 | PASS |
| 13 | `init --tool cursor` | §21: emits `.cursorrules` | `cans/.cursorrules` created, byte-identical to AGENTS.md | PASS |
| 14 | `init --tool windsurf` | — (unspecified) | Silently ignored: no artifact, no warning, exit 0 | UNDOCUMENTED |
| 15 | `init` in dir with stray `README.md` + `.gitignore` | No collision; workspace in `cans/` | Stray files untouched, exit 0 | PASS |
| 16 | `init --json` (fresh) | §35 shape `{ok,command,exitCode,created[],skipped[],root}` | Same 6 keys; created list = §35 fixture exactly | PASS |
| 17 | `init --json` root value | Fixture: `"root": "./cans"` | **Absolute path** (`/home/.../t10/cans`) | DEVIATION |
| 18 | `init --json` (2nd run) | skipped[] populated | `created:[]`, all 14 in `skipped[]` | PASS |
| 19 | `init --bogus` | — (arg parsing §20: `--flag value` only) | Unknown flag silently ignored → normal init, exit 0 | UNDOCUMENTED |
| 20 | `init --flat --folders` | §8: "Flat wins over folder" is a mode, not a merge | No guard: **created folder twins next to existing flat files** (`01-architecture.md` AND `01-architecture/index.md` ×6) | FAIL |
| 21 | `init` with cwd = `cans/` | §21: "Refuses if already inside a `cans/` directory" | exit 1 — but stdout is literally `Workspace: ` (empty), stderr empty, JSON has `root:""`, no reason given | PASS on refusal, UX issue |
| 22 | `init` with cwd = `cans/_collab/` | §21: refuse (inside a cans/ dir) | **Does not refuse**: walks up, re-targets ancestor workspace, all skipped, exit 0, `ok:true` | DEVIATION |
| 23 | `init` with pre-existing empty `cans/` dir | Populate it | Populated correctly, exit 0 | PASS |
| 24 | `init` with a **file** named `cans` present | — | stderr `✗ Internal error: EEXIST ... mkdir ...`, exit 2 | PASS (§19: 2 = internal error) |
| 25 | `init` then `check` then `status` (README Quick Start) | Fresh workspace validates | check: 0 errors / **9 warnings**, exit 0; status exit 0 | PASS (see Obs-1) |
| 26 | `init --folder` (typo, singular) | — | Silently ignored → flat default, exit 0 | UNDOCUMENTED (see #19) |

Totals: **26 checks → 15 PASS, 1 FAIL, 5 DEVIATION, 3 UNDOCUMENTED** (some rows double-annotated).

## Findings

1. **MAJOR — `--flat --folders` accepted; init produces an invalid workspace.**
   > **Status: RESOLVED** — red-test `red #1` (no folder twins beside existing flat specs) is green; blackbox re-run over a flat workspace now skips all 14 concepts (0 created, 0 `index.md` twins, exit 0), and fresh `--flat --folders` in either flag order yields a single-mode folders workspace — a both-exist state is no longer manufacturable.
   Repro: `mkdir t && cd t && cans init && cans init --flat --folders`
   Expected: error/refusal, or deterministic precedence (flat wins per §8). Actual: exit 0, folder twins (`01-architecture/index.md` …) created beside existing `01-architecture.md` — 6 duplicate canonical homes; §8 says `cans check` flags this as an error, so init can manufacture a state its own checker rejects. Also reveals skip-check is per-path, not per-concept.
2. **MINOR (DEVIATION) — `_adr/_template.md` not created.** §8 workspace structure shows it; §35 `init.json` fixture omits it; actual matches the fixture, not §8 (doc-internal inconsistency). No downstream breakage: `cans new adr` still produces a correctly formatted ADR from its own template.
   > **Status: DOC-GAP** — no impl change required and none made: `_adr/` still ships empty (verified 2026-09-04) and `cans new adr` still creates a correctly formatted ADR from its own template; impl matches the §35 fixture. Residual is docs-internal: §8 (L157) and the `discoverAdrs()` note (L774) still reference `_adr/_template.md`, which nothing creates.
3. **MINOR (DEVIATION) — `init` from a subdirectory of `cans/` doesn't refuse.** §21: "Refuses if already inside a `cans/` directory." Only cwd = `cans/` itself refuses (exit 1); from `cans/_collab/` init silently walks up and re-runs idempotently against the ancestor workspace (exit 0, `ok:true`).
   > **Status: RESOLVED** — red-test `red #3` (cwd inside `cans/_collab/` must refuse) is green; blackbox `init` from `cans/_collab/` — and from a deeper `cans/_tasks/deep/deeper/` — now exits 1 with `✗ already inside a cans/ workspace — cd to the project root first`.
4. **MINOR (DEVIATION) — JSON `root` is absolute**, fixture §35 shows `"./cans"`.
   > **Status: RESOLVED** — red-test `red #4` (`root` must be `"./cans"`) is green; blackbox `init --json` now emits `"root": "./cans"` exactly per the §35 fixture.
5. **MINOR (DEVIATION) — §33 "~800 tokens" claim.** `AGENTS.md` = 737 words / 4728 bytes ≈ 1350 tokens at the project's own 3.5 chars-per-token (§18), ≈950–1200 by common tokenizers. Overstated by ~20–70%.
   > **Status: DOC-GAP** — no impl change required and none made: emitted `AGENTS.md` re-measured 2026-09-04 at 737 words / 4728 chars. Residual is the doc claim itself: §33 heading (L778) and the comparison-table rows (L27, L34) still say "~800 tokens".
6. **MINOR (UNDOCUMENTED/UX) — unknown flags silently ignored.** `--bogus`, and the realistic typo `--folder` (singular), produce default behavior with exit 0 and no warning. A typo'ed `--folders` user silently gets flat mode.
   > **Status: RESOLVED** — red-tests `red #6a` (`--bogus`) and `red #6b` (typo `--folder`) are green; blackbox now exits 1 with `✗ unknown flag "--bogus"` / `✗ unknown flag "--folder"` — nothing is silently swallowed.
7. **MINOR (UNDOCUMENTED/UX) — `--tool <unknown>` silently ignored.** `--tool windsurf` → no CLAUDE.md/.cursorrules, no warning, exit 0. Also, emitted CLAUDE.md/.cursorrules are verbatim copies of AGENTS.md (template has no placeholder, so the §29 "string-replace for tool name" concept is not observable — consistent with §21's weaker wording).
   > **Status: RESOLVED** — red-test `red #7` is green; blackbox `--tool windsurf` now exits 1 with `✗ unknown tool "windsurf" — supported tools: claude, cursor`; documented tools unchanged (row-12 regression: `--tool claude` still emits CLAUDE.md, identical to AGENTS.md).
8. **MINOR (UX) — refusal message is empty.** `init` inside `cans/`: stdout `Workspace: ` (nothing after colon), stderr empty, JSON `root:""` with no error/reason field; user is told nothing about why (§21 says only "Refuses").
   > **Status: RESOLVED** — red-test `red #8` (refusal must state WHY) is green; blackbox `init` inside `cans/` now exits 1 with `✗ already inside a cans/ workspace — cd to the project root first` instead of the empty `Workspace: ` header.
9. **MINOR (UX, documented behavior) — `--force` silently clobbers `_collab/{handoffs,conflicts,decisions}.md`** (multi-agent coordination state) plus all specs and `_rules.yaml`, with no confirmation/prompt or backup. Matches §21 wording ("skips existing files unless --force"), but destructive scope is undocumented.
   > **Status: DOC-GAP** — impl matches the documented §21 contract (L510, unchanged on this branch): blackbox `init --force` still recreates `_collab/*` and edited specs from templates (verified 2026-09-04). Remainder is doc-only: §21 does not spell out `--force`'s destructive scope / absence of confirmation or backup.
10. **OBS — exit 2 on `EEXIST` (file named `cans` in cwd):** raw internal error to stderr, exit 2 — matches §19's exit-code contract (2 = internal, top-level catch), not graceful.
    > **Status: RESOLVED** — verified unchanged on this branch: init still exits 2 with stderr `✗ Internal error: EEXIST ... mkdir '.../cans'` — exactly the §19 contract the observation noted; no change was required.
11. **OBS — `--force` never touches `_adr/`/`_tasks/` dirs** (reported "exists, skipped"; never emptied/recreated) — sensible.
    > **Status: RESOLVED** — verified unchanged on this branch: `init --force` still reports `_adr/`/`_tasks/` as `(exists, skipped)` and leaves user files inside them untouched; sensible behavior retained.
12. **OBS — `--bare --folders` → bare wins** (no `01-architecture/` dirs); undocumented but sensible.
    > **Status: DOC-GAP** — impl unchanged and deterministic (verified: bare wins, only `_rules.yaml`/`AGENTS.md`/`00-overview.md`); the combo's precedence remains undocumented in §21's flags line (L512).

## Observations

- **Obs-1 (init-owned, warning noise out of the box):** a freshly-initialized workspace immediately yields 9 `check` warnings: 6 orphan warnings (00–06 have no refs by design), `"tbd" × 24 nodes` frequency warning, and 2 false-positive "typo" warnings (`status`↔`state`, `stack`↔`state`) — the last two between files that init itself generated. The shipped skeleton is not "clean" under the shipped default rules (detailed triage belongs to QA-02/QA-03, but the seed content originates from `init`).
- The human-readable `+` / `=` markers and per-file listing are clear; `Workspace:` header prints the absolute path.
- `created[]` ordering shifts when `--tool` is used (CLAUDE.md appended after `_collab/*`) and `--force` moves dirs into `skipped[]` — cosmetic.
- File contents seeded are minimal TBD outlines (7 specs, 32 nodes, max depth 1) — consistent across flat/folder/bare modes; `_collab/*` files are one-line stubs (`- handoffs` etc.).
- Repo under test stayed clean throughout (only pre-existing untracked `agents/`); all scratch work under `/home/z/my-project/qa-playground/qa-init/`.

## Verdict summary

Pre-fix (historical):
- **15 PASS / 1 FAIL / 5 DEVIATION / 3 UNDOCUMENTED** (26 checks; combos and flag-matrices extend the requested 12-point matrix).
- Blockers: none. Majors: 1 (finding #1). Everything else minor/UX or doc-consistency issues.
- Core §21 promises hold: idempotency, skip-unless-`--force`, `--flat` default, `--folders`/`--bare`/`--tool` variants, refusal inside `cans/`, §35 JSON shape.

Post-fix (2026-09-04, fix/qa-red-tests-green @ e628ff2):
- 8/12 findings RESOLVED, 0 PARTIAL, 4 DOC-GAP (#2, #5, #9, #12), 0 OPEN; mapped red-suite `qa-01-init-lifecycle` 9/9 green (7 red + 2 controls), repo-wide `bun test` 192 pass / 0 fail.
- All implementation findings fixed and blackbox-verified: no duplicate-canonical-home state from `--flat --folders`, refusal inside `cans/` at any depth with a reason, JSON `root: "./cans"`, unknown flags/tools rejected with exit 1.
- Remaining DOC-GAPs are docs-internal with no impl breakage: §8/L774 `_adr/_template.md` ghost entry (#2), §33 "~800 tokens" claim (#5), §21 `--force` destructive scope (#9), §21 `--bare --folders` precedence (#12).
