# QA-07 — Fix Regression Verification (Blackbox)

Task ID: 4-a | Agent: qa-fix-verify | Repo: cans-spec @ fix/qa-red-tests-green, commit e628ff2
Date: 2026-09-04 | Method: manual shell only, blackbox (no src/, no tests read)

Re-test of every FAIL / DEVIATION finding from QA-01..QA-06 (round 1 @ impl/full-engines 54b0b52)
on the fix branch. Findings already re-verified incidentally by QA-08/09/10 are cross-credited and
NOT re-run (marked `cc:`); everything else was re-executed from scratch in
/home/z/my-project/qa-playground/qa-07/ (workspaces r2*/r3*/w4/w5/g1-g3/wsi, init scenarios i1-i15 reused).

## 1. Verdict summary (per prior report, by finding)

| Prior report | Findings | FIXED | STILL-BROKEN | PARTIAL | REGRESSED | NOT-REPRODUCIBLE |
|---|---|---|---|---|---|---|
| QA-01 init/lifecycle | 12 | 6 | 3 | 0 | 1 | 2 |
| QA-02 check engines I | 18 | 13 | 3 | 2 | 0 | 0 |
| QA-03 check engines II | 17 | 14 | 2 | 1 | 0 | 0 |
| QA-04 workflow | 10 | 9 | 1 | 0 | 0 | 0 |
| QA-05 interop | 19 | 12 | 6 | 1 | 0 | 0 |
| QA-06 CLI surface | 13 | 9 | 2 | 2 | 0 | 0 |
| **TOTAL** | **89** | **63** | **17** | **6** | **1** | **2** |

Headline: the fix branch holds up. The round-1 BLOCKERs (QA-05 F8 merge corruption, QA-05 F1
false-success error surface) are fixed; 63/89 prior findings verified FIXED. 17 findings remain
open (2 of them MAJOR-class residuals re-confirmed this round, the rest cross-credited to
QA-08/09/10), 6 are partially fixed, and there is exactly 1 small regression (QA-01 #10:
`init --bare` no longer emits AGENTS.md). No new BLOCKER found this round.

## 2. Per-finding detail

Legend: repro = command run (cwd = named scratch ws); all exit codes observed. `cc:` = cross-credited
to the QA-08/09/10 round-2 reports instead of re-run.

### QA-01 — init & workspace lifecycle

| ID | Finding (round 1) | Verdict | Evidence |
|---|---|---|---|
| #1 | MAJOR — `init --flat --folders` creates folder twins beside flat specs | **FIXED** | g1b: `init` then `init --flat --folders` → exit 0, `ls cans/ | grep ^0[1-6]` shows only `NN-*.md`, no `NN-name/` dirs created |
| #2 | DEVIATION — `_adr/_template.md` not created (§8 vs §35) | STILL (minor) | g2: `ls cans/_adr/` → empty; unchanged, still matches §35 fixture not §8 |
| #3 | DEVIATION — init from `cans/_collab/` walks up instead of refusing | **FIXED** | g1b/cans/_collab: `init` → exit 1 `✗ already inside a cans/ workspace — cd to the project root first` |
| #4 | DEVIATION — init --json `root` absolute instead of `./cans` | **FIXED** | g1b: `init --json` → `"root": "./cans"` (matches §35) |
| #5 | DEVIATION — AGENTS.md ≈1350 tokens vs §33 "~800" | STILL (minor, doc) | g2: `wc -w cans/AGENTS.md` → 737 words (unchanged) |
| #6 | UNDOC — unknown init flags silently ignored (`--bogus`, `--folder`) | **FIXED** | g2: `init --folder` → exit 1 `✗ unknown flag "--folder"` |
| #7 | UNDOC — `init --tool windsurf` silently ignored | **FIXED** | g2: `✗ unknown tool "windsurf" — supported tools: claude, cursor` exit 1 (also cc: QA-09 F7) |
| #8 | UX — refusal inside `cans/` prints bare `Workspace: ` | **FIXED** | cc: QA-10 F4 — `✗ already inside a cans/ workspace — cd to the project root first` |
| #9 | UX — `--force` silently clobbers `_collab/*` + specs | STILL (MAJOR) | cc: QA-09 (E-round) — confirmed still destructive without confirmation on this branch |
| #10 | `init --bare` = `_rules.yaml, AGENTS.md, 00-overview.md` | **REGRESSED** (minor) | g3: `init --bare` → only `00-overview.md` + `_rules.yaml`; **AGENTS.md no longer created** (QA-08 F3 saw same) while help still advertises "Agents: cans/AGENTS.md" |
| #11 | OBS — `--force` never touches `_adr/`/`_tasks/` | NOT-REPRODUCIBLE | not re-tested; no contrary signal in QA-08/09 |
| #12 | OBS — `--bare --folders` → bare wins | NOT-REPRODUCIBLE | not re-tested |

### QA-02 — check engines I: refs, structure, style

| ID | Finding (round 1) | Verdict | Evidence |
|---|---|---|---|
| F1 | MAJOR — flat+folder duplicate home not an error | **FIXED** | r2f1: `check` → exit 1 `✗ 02-authentication.md — duplicate home: both 02-authentication.md and 02-authentication/index.md exist — flat wins, remove the folder` |
| F2 | MAJOR — in-range missing file downgraded to "unwritten spec slot" warning | **PARTIAL** (MAJOR residual) | r2f2 (files 02+06): refs to 04/05/99 now all `✗ broken ref — file not found`, exit 1 (forward refs fixed). r2f2b (files 02+04+06): 02→05 still `✗ broken` but 06→03/05 still `⚠ unwritten spec slot` (backward refs) — cc: QA-09 E2 shows the full false-success flow (`rm 02-authentication.md` → check exit 0 → `done` archives) is still reachable |
| F3 | MAJOR — ref tokens (see/md/filenames) counted by word-frequency | **FIXED** | r2f3 (6 see: refs): no `"see"`/`"md"` frequency warnings; only content words fire |
| F4 | MAJOR — deep-hop fixture yields spurious `broken anchor` | **FIXED** | r2f4: `✗ DEEP HOP: 04-api.md → 02-authentication.md → 06-operations.md` and NO broken-anchor line — `#Data-protection` now matches node "Data protection" (hyphen normalization) |
| F5 | MINOR — style `force_sibling_below` off-by-one (3 leaf children unflagged) | **FIXED** | r2fix (flat-project): `⚠ "Data protection" has 3 children. Collapse to sibling style.` fires at depth 1 with defaults. NEW note: depth-0 (root-level) parents are now exempt (r2style Top2/Top3 unflagged) — undocumented |
| F6 | MINOR — collapse flag requires all-leaf sibling group | STILL-BROKEN (minor) | r2f6: depth-1 "Parent" with Child(non-leaf)+Leaf2+Leaf3 and "P2" with 1 leaf child → no style flag (only single-child warnings); §14 "≤3 leaf children" still not honored for mixed groups |
| F7 | MINOR — style findings ⚠ but docs show ✗ (§14/§36) | STILL-BROKEN (minor, doc) | all style output observed this round is `⚠`; doc examples unreachable |
| F8 | MINOR — JSON `maxDepth` 0-based vs 1-based errors | **FIXED** | r2f8: 7-level chain → errors "Depth 6/7", `check --json` → `"maxDepth": 7` (consistent 1-based) |
| F9 | MINOR — rules keys `duplicate_home_check` / `max_hops` dead | **FIXED** | r2f9b A/B: `duplicate_home_check: false` suppresses L4 warning (1→0); `max_hops: 2` suppresses the r2f4 deep hop (present without rules file) |
| F10 | MINOR — `see:TARGET` (colon, no space) not parsed | **FIXED** | r2syn: `see:03-data.md`, `see: 03-data.md`, `see 03-data.md` → "3 see: refs, 0 broken" |
| F11 | MINOR — 1/3-space indent silently re-parents | **FIXED** | r2ind: `⚠ odd indentation (1 space) — nodes may be re-parented unexpectedly; use 2-space multiples` (diagnostic now exists; 2 files/6 nodes preserved) |
| F12 | MINOR — directory named `NN-x.md/` silently skipped | **FIXED** | r2f12: `⚠ malformed workspace entry: directory "09-dir.md" looks like a spec file — rename it or use folder mode (09-dir/index.md)` (also cc: QA-08 dir-named probe) |
| F13 | UX — positional `[file]` unvalidated, silent partial scoping | **FIXED** | r2f13: `check nope.md` → exit 1 `✗ no spec file matches "nope.md" — pass a spec filename like 04-api.md …`; bare name works (also cc: QA-08 C1/C4/C5/C9, QA-10 F8) |
| F14 | MINOR — parse-error formatting (path twice, `:0`) | **PARTIAL** (improved) | r2f14: `✗ 07-tabs.md — parse error: 07-tabs.md: tab indentation rejected (use 2 spaces)` — `:0` gone; path still printed twice |
| F15 | UX — fuzzy layer noisy on natural vocabulary | STILL-BROKEN (minor) | r2fix: `possible typo: "never" ↔ "every"`, `"protection" ↔ "production"`, `"sessions" ↔ "session"`, `"branch" ↔ "brancha"` all fire |
| F16 | UX — 1-child node double-reported (+ "1 children") | **FIXED** | r2f4/r2style: exactly one `⚠ … has exactly 1 child. Collapse.` per node; `grep -c "1 children"` → 0 (also = QA-03 #17) |
| F17 | MINOR — "Rules (_rules.yaml)" section never printed | **FIXED** | observed in every run with `_rules.yaml` (e.g. r3syn3): `Rules (_rules.yaml)` + `✓ node_length: 3–120 \| siblings: 1–12 \| depth: 1–5` (also cc: QA-09 A10) |
| F18 | UX — `check --fix` prints PRE-fix state | **FIXED** | r2f18b: stale `<!-- ref-by: 09-stale.md -->` → `check --fix` report shows `back-pointers: 1/1 current` (post-fix), file rewritten to `04-api.md`; second run `backPointersUpdated: 0` |

### QA-03 — check engines II: redundancy, overflow, rules, budget

| ID | Finding (round 1) | Verdict | Evidence |
|---|---|---|---|
| 1 | MAJOR — "delete a key = check turns off" not implemented (§18) | STILL-BROKEN (MAJOR) | cc: QA-09 E8 — deleting `node_length:` still silently reverts to defaults (check stays on); `references.back_pointers: false` also ignored by `check --fix` (QA-09 B9) |
| 2 | MAJOR — malformed `_rules.yaml` crashes exit 2 | **FIXED** | r3rules (`structure: 42`): `✗ invalid _rules.yaml: line 1 — "structure" must be a mapping, got number`, exit 1 (also cc: QA-09 E9 tab-indent case) |
| 3 | MAJOR — active-task tier missing from `budget read` | **FIXED** | cc: QA-09 C10 — task appears in plan with `reason: "active task mentions concept"`, score 80 |
| 4 | MAJOR — `budget write <unknown>` exits 0 with empty scope | **FIXED** | r3bud: `budget write xyzzy` → exit 1 `✗ no files match concept "xyzzy" — check spelling or run \`cans status\`` |
| 5 | MAJOR — unknown `budget` subcommand silently runs as `read` | **FIXED** | cc: QA-10 B6/B7 — `✗ usage: cans budget <read|write> <concept>` / `✗ unknown subcommand "frobnicate" — valid: read, write` |
| 6 | MINOR — `overflow.force_file_for` inert in check | **FIXED** | r3ovf A/B: with `force_file_for: [table]` the code fence is NOT flagged (was flagged unconditionally in round 1); with defaults it is. Note: table detection did not fire for `\| h1 \| h2 \|`-style bullets in either config (fixture-sensitive; single-line bullets may not constitute a "table" node) |
| 7 | MINOR — phrase-overlap: strict `>` boundary + stopwords counted | **FIXED** | r3phr: exactly-70% pair now FIRES (`⚠ 70% overlap`); stopword-sharing pair (5/7 raw incl. "for") does NOT fire → consistent with ≥0.7 on stopword-filtered tokens (4/6=67%) |
| 8 | MINOR — fuzzy layer fires on synonym-matched pairs | **FIXED** | r3syn (postgres/pg/postgresql in 5 nodes): `⚠ "postgres" × 5 nodes` fires, NO "possible typo postgres ↔ postgresql" |
| 9 | MINOR — budget outside workspace / zero-match concept: no explanation | **FIXED** | r3bud: `budget read xyzzy` → exit 1 with §37 message (also cc: QA-08 D2, QA-10 D11 for no-workspace uniformity) |
| 10 | MINOR — §16 no-chaining rule not enforced (overflow-target see: ignored) | **PARTIAL** | r3ovf2: `see 04-api/request-schema.md` now COUNTED and resolves (`2 see: refs, 0 broken`); still no chaining error (doc ambiguity noted in round 1) |
| 11 | MINOR — `token_budget.warn_threshold` inert + Rules section absent | **FIXED** | cc: QA-09 C5 — `--limit 60` → warning on stderr `plan usage 86.7% … exceeds token_budget.warn_threshold (80%)`; Rules section fix verified above (QA-02 F17) |
| 12 | MINOR — absolute task-file paths leak into budget output | **FIXED** | cc: QA-09 C12 — `cans/_tasks/tune-sessions.md` repo-relative |
| 13 | MINOR — nested block-array synonyms silently lost | STILL-BROKEN (minor, broader) | r3syn2/r3syn3 matrix: user-configured `redundancy.synonyms` are silently ignored in EVERY syntax tried (template `-[a, b]`, block-of-inline, nested block, top-level); only the built-in default groups (postgres/auth/api/frontend/db) merge. No error, no warning |
| 14 | UX — check no-workspace error rendered inside References section | **FIXED** | cc: QA-10 D11 — uniform `✗ no cans workspace found — run \`cans init\`…` exit 1 |
| 15 | UX — bare `budget` prints success-shaped empty plan | **FIXED** | cc: QA-10 B6/B13 — usage errors with `Example:` hint |
| 16 | UX — substring concept matching elects nonsense canonical homes | **FIXED** | r3bud: `budget read x` → `✗ no files match concept "x"` exit 1 (no "expire" substring hit) |
| 17 | COSMETIC — "has 1 children" grammar | **FIXED** | `grep -rc "1 children"` across all check outputs → 0; text is "has exactly 1 child" |

### QA-04 — workflow: new/done/status

| ID | Finding (round 1) | Verdict | Evidence |
|---|---|---|---|
| 1 | MAJOR — flags swallowed into `new` title/name | **FIXED** | cc: QA-10 C9 — `new task -- --json` → `✗ unknown flag "--"` exit 1, nothing created |
| 2 | MAJOR — `new task` silently overwrites existing task | **FIXED** | cc: QA-09 E5 — `✗ refusing to overwrite existing _tasks/fix-sessions.md …` exit 1 |
| 3 | MAJOR — same-day re-archive silently overwrites archive entry | **FIXED** | w5: complete+`done rearch-test` twice same day → second archive is `2026-09-04-rearch-test-2.md`; first entry byte-intact |
| 4 | MAJOR — every `done` failure misdiagnosed as "check failed" | **FIXED** | cc: QA-09 A13-A15, QA-10 B11/E11 — distinct `✗ usage: cans done <task-name>` / `✗ task "x" not found in _tasks/ …` + JSON `error` field |
| 5 | MAJOR — `status --unclaimed/--blocked/--owners` no-ops | **FIXED** | cc: QA-09 A5, QA-10 A14 — filters restrict the per-task view; Owners view prints |
| 6 | MINOR — `new` errors are bare `✗ ` | **FIXED** | cc: QA-08 A7 — `✗ empty slug from "…" — provide a non-empty title` |
| 7 | MINOR — `new` auto-vivifies partial workspace without cans/ | **FIXED** | cc: QA-10 D11 — `new task` no-workspace now exits 1 with §37 message |
| 8 | MINOR — status without workspace prints zeroed report silently | **FIXED** | cc: QA-10 D11 |
| 9 | MINOR — human formats deviate from §36 (status one-liner; done line 2) | **FIXED** | w4: status prints multi-line per-task block `Tasks: 0/2` / `Gates: 0/1 ← @human` / `⚠ BLOCKED`; done blocked shows `file:line — gate text` (cc: QA-08 F8) |
| 10 | MINOR — `done` never updates back-pointers (§24) | STILL-BROKEN (minor) | w5: spec `08-solo.md` with no ref-by + completed task `see 08-solo.md` → `done` ok:true, `backPointersUpdated: 0`, no comment written (still `check --fix`'s job only) |

### QA-05 — interop: import/export

| ID | Finding (round 1) | Verdict | Evidence |
|---|---|---|---|
| F1 | BLOCKER — all import/export failures print false success, no reason | **FIXED** | cc: QA-08/10 — §37 `✗ what — fix` messages + JSON `error` field on all failure paths |
| F2 | MAJOR — imported wikilink refs lack `.md` → guaranteed broken refs | **FIXED** | cc: QA-08 E6, QA-09 D3 — `[[02-authentication#Sessions]]` → `see: 02-authentication.md#Sessions`; confirmed in wsi (logseq import → `1 see: refs, 0 broken`). Residual (QA-08 E7): `![[embed]]` refs still lack `.md` |
| F3 | MAJOR — logseq trailing text glued into ref target | **FIXED** | wsi: raw line still reads `- see: 02-authentication.md#Sessions expire after 24 hours`, but the parsed ref is `02-authentication.md#Sessions` and check reports 0 broken (cosmetic residue only) |
| F4 | MAJOR — Obsidian callouts silently dropped | STILL-BROKEN (MAJOR) | cc: QA-08 E9 — callout lines still dropped on import |
| F5 | MAJOR — code fences deleted instead of extracted to overflow files | STILL-BROKEN (MAJOR) | cc: QA-08 E9 — no overflow extraction; fence becomes node text and following content is dropped |
| F6 | MINOR — OPML `_note` attribute dropped | **FIXED** | wsi: `<outline text="Auth" _note="details here">` → node `- Auth` with child `- details here` |
| F7 | MINOR — `--dry-run` output indistinguishable from real run | **FIXED** | wsi: `export opml --dry-run` → `[dry-run] Would export opml → cans-export/opml (9 files). No files written.` (also resolves QA-06 #12) |
| F8 | BLOCKER — cans-wins merge appends conflict under wrong parent | **FIXED** | cc: QA-09 D10 — `conflicts[]` populated per §35, CANS text kept, no wrong-parent append |
| F9 | MAJOR — `conflicts[]` never populated; `ask` reports nothing | **PARTIAL** | cans-wins now populates conflicts (cc: QA-09 D10); `--merge-strategy ask` still silently reports nothing (cc: QA-09 D12 — MAJOR residual) |
| F10 | MINOR — invalid enum values accepted silently | **FIXED** | cc: QA-09 D13 — `✗ unknown merge strategy "banana" — valid: cans-wins, import-wins, ask` |
| F11 | MAJOR — `import --out <path>` is a no-op | **FIXED** | wsi: `import opml dynalist-export.opml --out ../customout2` → file written ONLY to `../customout2/07-authentication.md` (137 B); `cans/` untouched |
| F12 | MINOR — non-XML "OPML" accepted as success | **FIXED** | cc: QA-08 E1 — `✗ invalid OPML in truncated.opml — invalid OPML: <opml> element is not closed` |
| F13 | MINOR — export `outputDir` absolute / inconsistent vs §35 | **FIXED** | wsi: `export opml --include-tasks --json` → `"outputDir": "cans-export/opml"` (relative, matches fixture) |
| F14 | MAJOR — OPML export drops checkbox state | **FIXED** | wsi: exported outlines carry `text="[x] Add Google OAuth"`, `text="[ ] Implement auth flow"`, `text="[x] {first task} ←"` — state preserved |
| F15 | MINOR — `--from /nonexistent` → ok:true filesExported:0, no error; stale outputs | STILL-BROKEN (minor) | wsi: `export opml --from /nonexistent --json` → `"ok": true, "filesExported": 0`, exit 0 |
| F16 | DEVIATION — OPML round-trip loses refs (`→` stays literal) | STILL-BROKEN (minor) | cc: QA-09 D9 — refs die on OPML re-import; obsidian/logseq round-trips fine |
| F17 | MINOR — formats case-sensitive with false-success failure | **FIXED** | wsi: `import OPML note.opml` → exit 0, accepted (case-insensitive), output normalizes to `opml` |
| F18 | MINOR — active `_adr/` not exported (§28 excludes only `_adr/_archive/`) | STILL-BROKEN (minor) | wsi: `_adr/001-record.md` present; `cans-export/opml/` = 10 files, no `001-record.opml` |
| F19 | INFO — flag doc drift (help/README/§20) | STILL-BROKEN (minor, doc) | cc: QA-10 A5 — help still omits `budget read [--change]` and `[--json]` on import/export |

### QA-06 — CLI surface contracts

| ID | Finding (round 1) | Verdict | Evidence |
|---|---|---|---|
| 1 | MAJOR — `done` misdiagnoses every failure as "check failed" | **FIXED** | cc: QA-09/QA-10 (see QA-04 #4) |
| 2 | MAJOR — missing required args → blank-filled success-shaped output | **FIXED** | cc: QA-10 B — `✗ usage: …` for done/new/import/export/budget read/write |
| 3 | MAJOR — unknown command / no args → bare JSON, no message | **FIXED** | cc: QA-10 B16 — §37 guidance incl. removed §41 commands; JSON envelopes carry `error` |
| 4 | MAJOR — arg parser silently swallows malformed/unknown flags | **PARTIAL** | `--flag=value` now rejected (`✗ invalid flag form …` — cc: QA-10 C3). Residuals (all cc: QA-10, still MAJOR): `status --bogus` misdiagnosed as "no cans workspace" in human mode (M1); `budget read --limit abc` silently ignored / `--limit -5` → false "no files match concept" (M2); `check --bogus` swallowed exit 0 while short flags misparse as file args (M3) |
| 5 | MAJOR — `new` appends flags into created name | **FIXED** | cc: QA-10 C9 |
| 6 | MAJOR — no-workspace handling inconsistent across commands | **FIXED** | cc: QA-10 D11 — uniform exit 1 + §37 message (check/status/budget/export/new) |
| 7 | MINOR — init refusal inside `cans/` = bare `Workspace: ` | **FIXED** | cc: QA-10 F4 |
| 8 | MINOR — all user errors on stdout (stream asymmetry) | STILL-BROKEN (minor, undocumented) | cc: QA-10 D1 — still single-stream by design; NOTE: budget over-limit warning now goes to **stderr** (QA-09 C5) — discipline drifted since round 1 |
| 9 | MINOR — malformed workspace entries silently tolerated (dir-named-`.md`, binary file) | **PARTIAL** | dir-named-`.md` now warns (verified, r2f12); binary/64-byte file still silently parsed as empty spec (cc: QA-08 B15 — unchanged) |
| 10 | MINOR — help/README/doc flag drift | STILL-BROKEN (minor, doc) | cc: QA-10 A5 |
| 11 | UX — no version/help shortcuts (`-h/--help/version`) | **FIXED** | cc: QA-10 A10 — `version`/`--version` = 0.1.0, `-h/--help` full help |
| 12 | UX — dry-run verbs read as completed actions | **FIXED** | verified via QA-05 F7 (`[dry-run] Would export …`) |
| 13 | UX — `--refs-only` only suppresses Redundancy | **FIXED** | cc: QA-10 E1 — only References + Rules echo printed, warnings 18→2 |

## 3. Remaining bugs (ranked) and new issues

### Still open — MAJOR
1. **Backward in-span missing-file refs still downgrade to `unwritten spec slot` warning** (QA-02 F2 residual; QA-09 E2): forward refs now error, but `rm` a mid-span spec (e.g. 02 of 00-06) → `check` exit 0 → `done` archives with dangling ref. §12 violated in the most common layout. (Re-confirmed shape this round via r2f2b backward cases.)
2. **§18 "delete a key = check turns off" still not implemented** (QA-03 #1; cc: QA-09 E8) — documented disabling/migration mechanism absent; deleted keys silently revert to defaults.
3. **Import data loss** (QA-05 F4/F5; cc: QA-08 E9): Obsidian callouts dropped; code-fence content not extracted to overflow files (content after fences lost).
4. **`--merge-strategy ask` reports nothing** (QA-05 F9 residual; cc: QA-09 D12): machine consumers cannot detect a conflict.
5. **`init --force` silently clobbers `_collab/*` + all specs** (QA-01 #9; cc: QA-09): destructive scope undocumented, no confirmation.
6. **Unknown-flag swallowing family** (QA-06 #4 residuals; cc: QA-10 M1/M2/M3): status human-mode misdiagnosis, budget `--limit` silent-ignore/false-cause, check silent swallow.
7. **NEW (QA-08/09, outside prior IDs)**: `done ../traversal` names (ENOENT exit 2), CRLF spec files false-clean, `export --vault <file>` ENOTDIR exit 2, `init --tool claude` manufactures failing workspace (CLAUDE.md parsed as spec).

### Still open — MINOR
QA-01 #2 (`_adr/_template.md`), #5 (AGENTS.md tokens) — doc deviations; QA-02 F6 (all-leaf collapse), F7 (⚠/✗ severity), F15 (fuzzy noise); QA-03 #13 (user-configured synonyms silently ignored); QA-04 #10 (done never updates back-pointers); QA-05 F15 (`--from` no error), F16 (OPML RT refs die), F18 (`_adr/` not exported), F19 (doc drift); QA-06 #8 (stdout-only errors; stderr drift for budget warn), #10 (doc drift).

### REGRESSED
- **QA-01 #10 (minor): `init --bare` no longer creates `AGENTS.md`** (now only `_rules.yaml` + `00-overview.md`). Help still advertises "Agents: cans/AGENTS.md"; round 1 recorded AGENTS.md in bare mode. Behavior change without doc update.

### NEW (this round)
- **NEW-1 (minor, undocumented):** word-frequency warning appears to require the concept to exceed ~50% of parsed nodes in addition to count ≥ threshold: `"zulu" × 4` fires at 4/6 nodes (67%) but NOT at 4/8 (50%) or 2/6 (33%), even with `word_frequency_threshold: 2`. Lowered threshold overrides can therefore look inert. (Observed r3syn2/r3syn3 matrix.)
- **NEW-2 (minor, undocumented):** depth-0 (root-level) parents are exempt from the style collapse rule — root with 2 or 3 leaf children unflagged while depth-1 equivalents flag (r2style vs r2fix). Interacts with QA-02 F5/F6; §14 distinguishes no such case.
- **NEW-3 (extension of QA-03 #13):** the silent-ignore surface is broader than "nested arrays": ALL user-configured `redundancy.synonyms` (any supported syntax) are inert; only built-in default groups merge. Silent, no warning.
- **NEW-4 (info):** `check` malformed-entry warnings now cover directory-named-`.md` entries (good), but the message says "looks like a spec file" for `09-dir.md` created intentionally — acceptable UX, no action.

### Cross-credit ledger (not re-run this round; verified by parallel round-2 agents)
- To **QA-08**: QA-05 F1/F2/F12 (§37 errors, wikilink `.md`, OPML rejection), QA-02 F13/F12 (positional validation, dir-named), QA-04 #6/#13 (empty slug, gate file:line), QA-06 #61 (binary), QA-05 F4/F5 (callout/fence STILL open), QA-08-new majors (traversal/CRLF/ENOTDIR).
- To **QA-09**: QA-05 F8/F10/F16/F9(ask), QA-03 #1/#3/#11/#12/#2, QA-04 #2/#4/#5/#9, QA-02 F2/F17, QA-01 #9, init `--tool` family, `init --tool claude` new major.
- To **QA-10**: QA-06 #1/#2/#3/#5/#6/#7/#11/#13, QA-06 #4 residuals (M1/M2/M3), QA-03 #5/#14/#15, JSON `error` field (additive §35 drift), perf §40, stream discipline.

## 4. Verdict

The fix branch delivers on its claims for the engine and CLI-surface findings: 63 of 89 prior
findings verified FIXED by direct re-test or credible cross-credit, including every round-1
BLOCKER, the whole §37 error-surface family, the flat/folder + refs + rules-key engine gaps,
and the import/export flag contracts. The 17 survivors cluster in (a) the §18 delete-key
contract, (b) interop import data-loss paths, (c) unknown-flag validation on status/budget/check,
and (d) doc-conformance nits. One minor regression (`init --bare` AGENTS.md) should be either
restored or documented. No new blockers.
