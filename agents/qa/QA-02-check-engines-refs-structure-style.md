# QA-02 — `cans check` Engines I: Outline Parser, Refs, Structure, Style

Task ID: 3-b · Agent: qa-refs-structure-style · Date: 2025 QA session
Repo: /home/z/my-project/cans-spec @ impl/full-engines, commit 54b0b52 (untouched; only this report file written)
Method: BLACKBOX manual shell QA. No src/ read, no tests read, no `bun test`/`typecheck`. All inputs copied to /home/z/my-project/qa-playground/qa-refs/ (scratch, outside repo).

## 1. Scope & docs covered

- docs/cans.architecture.md §4 (one-hop principle), §8 (flat vs folder), §11 (Outline Parser), §12 (Refs Engine: resolution, back-pointers, deep-hop, edge cases, orphans), §14 (Style Engine), §15 (Structure Engine), §17 (Engine Execution Order, --fix scope), §18 (rules defaults incl. `max_hops`, `orphan_check`, `duplicate_home_check`), §19 (exit codes), §22 (`cans check` contract), §34 (input fixtures), §35 (check JSON fixtures), §36 (human text examples); README.md; templates/AGENTS.md.
- Engines under test: Outline Parser, Refs Engine, Structure Engine, Style Engine (+ their flags/JSON/exit-code surface). Redundancy/Overflow issues were observed incidentally (owned by Task 3-c) and are reported only where they collide with my area (clean-project contract, ref-token noise).

## 2. Environment

- bun 1.3.14; CLI invoked as `bun run /home/z/my-project/cans-spec/src/cli.ts <command>`.
- Workspace convention (discovered empirically; docs imply it via README quickstart + §21 "refuses if already inside a `cans/` directory"): **the CLI must be run from the directory that CONTAINS `cans/`**. Run inside a fixture-like dir → `✗ :0 — no cans workspace found — run \`cans init\` or cd into a project with a cans/ directory`, exit 1. Test fixtures therefore were copied to `<scratch>/tXX/cans/`.
- All fixtures used read-only; copies in scratch only. Scratch preserved under /home/z/my-project/qa-playground/qa-refs/ (t01…t18) for reproduction.

## 3. Test matrix

| # | Command (cwd = scratch workspace) | Expected (doc ref) | Actual | Verdict |
|---|---|---|---|---|
| 0a | `check` inside fixture dir (no `cans/` parent) | — (convention discovery) | error "no cans workspace found", exit 1 | UNDOCUMENTED (convention = cwd contains `cans/`) |
| 0b | `check` from parent of `cans/` | §22 reads workspace | parses 3 files/38 nodes | PASS |
| 1a | t01 flat-project: `check` | §34 clean-ish fixture | 0 errors, **17 warnings** (9 style, 1 structure, 2 refs, 5 redundancy), exit 0 | DEVIATION (docs' "clean" fixture is warning-heavy; see F3/F7) |
| 1b | t01: `check --json` | §22/§35 JSON contract | all contract keys present, `ok:true`, exitCode 0, 17 issues | PASS |
| 2a | t02 broken-refs: `check` | §34: 2 broken refs + 1 self-ref error | exactly: `broken ref: see 02-auth.md — file not found`, `broken ref: see 99-nonexistent.md — file not found`, `self-reference: 04-api.md → 04-api.md`; refs.broken=2; exit 1 | PASS |
| 2b | t02b span probe (02,06 exist; refs to 04/05/99) | §12 "File not found = broken ref error" | 04/05 (inside numeric span of existing files) → **warning** `unwritten spec slot: … file not created yet`; 99 → error `broken ref` | FAIL (F2) |
| 3 | t03 deep-hop fixture: `check` | §34: `✗ DEEP HOP: 04-api.md → 02-authentication.md → 06-operations.md` + fix suggestion | deep hop error with exact chain + suggestion `add "see: 06-operations.md#Data-protection" directly to 04-api.md`; **plus** unexpected `broken anchor: 06-operations.md#Data-protection — no node matches` | DEVIATION (F4) |
| 4a | t04: `check --fix` with stale `ref-by: 09-stale.md` + 2 real referrers | §17/§22: rewrite ref-by comments only | 02 file now `<!-- ref-by: 04-api.md, 06-operations.md -->`; other 2 files byte-identical (md5); exit 0 | PASS |
| 4b | t04b fresh `check --fix --json` | §35 check-fix.json | `backPointersUpdated: 1`; idempotent on rerun (0 updated, md5 stable) | PASS |
| 5a | t05: orphan + 00-overview exemption | §12 orphan warning, 00-overview exempt | `orphan: … no incoming or outgoing refs` (⚠, line :0) for ref-less file; 00-overview silent | PASS |
| 5b | t05: ref to `_tasks/add-dark-mode.md` | §12 warning (transient) | `transient ref: … _tasks/ files are transient, not spec`, ⚠ | PASS |
| 5c | t05: ref to `_collab/handoffs.md` | §12 error | `ref to _collab/: … collab notes are not spec`, ✗, exit 1 | PASS |
| 5d | t05: "Sessions" canonical in 02 + 07 (both referenced) | §18 duplicate_home_check | Layer-4 warning `"sessions" at depth 0-1 in 2+ files without see: (…)`; no dedicated refs-engine error | PASS w/ note (F9: rules key dead) |
| 6 | t06: `02-authentication.md` AND `02-authentication/index.md` both present | §8/§11: flat wins, both existing = **error** | both parsed as separate specs (3 files incl. folder-only 04-api/index.md); only indirect redundancy warnings; **no conflict error**; exit 0 | FAIL (F1) |
| 7a | t07a 157-char node | §15 `Node too long (N > 120). Split or move to file.` | `✗ 03-data.md:3 — Node too long (157 > 120). Split or move to file.` | PASS |
| 7b | t07b 2-char node | §15/§18 min 3 | `⚠ Node too short (2 < 3).` (warning, not error) | PASS w/ note (F7) |
| 7c | t07c 13 siblings | §15 `has 14 children (max 12)` ⚠ | `⚠ "Storage" has 13 children (max 12).` | PASS |
| 7d | t07d 7-level chain | §15 depth max 5 | `✗ Depth 6 exceeds max 5. Flatten.` + `✗ Depth 7 exceeds max 5. Flatten.`; but JSON `maxDepth: 6` | DEVIATION (F8) |
| 7e | t07e/t01 single child | §15 `"Returns" has exactly 1 child. Collapse.` | `⚠ "Google" has exactly 1 child. Collapse.` + duplicate style warning `"Google" has 1 children` | PASS w/ notes (F7, F16) |
| 7f | t07f `- ` empty node | §18 empty_nodes false | parsed, `⚠ Node too short (0 < 3).`, no crash | PASS |
| 8a | t08a style fixtures (7 "Returns" siblings; "Returns" + 2 children) | §14: both flagged `✗` | `⚠ 7 siblings share prefix "Returns". Group under nested style.` + `⚠ "Returns" has 2 children. Collapse to sibling style.` | DEVIATION (F7 severity; texts match) |
| 8b | t08b 6 shared-prefix siblings | §14 group ≥ 6 flags | flagged (6) | PASS |
| 8c | t08c 5 shared-prefix siblings | no flag below 6 | not flagged | PASS |
| 8d | t08d root with 2 leaf children | §14 ≤3 → flag | flagged | PASS |
| 8e | t08e depth-1 parent with exactly 3 leaf children | §14 ≤3 → flag | **not flagged** | FAIL (F5) |
| 8f | t08f parent with 2 children, one non-leaf | §14 "≤N leaf children" | **not flagged** (style only fires when ALL children are leaves) | FAIL (F6) |
| 9a | t01: `check --refs-only` | §22 flag | only refs issues reported (2 vs 17); other sections print ✓ placeholders | PASS w/ note |
| 9b | t01: `check --no-redundancy` | §22 flag | 5 redundancy issues suppressed | PASS |
| 9c | t01: `check --strict` (17 warnings) | §19 warnings → exit 1 under --strict | exit 1 | PASS |
| 9d | t01: `check 04-api.md` | §22 `[file]` scope | per-file issues filtered to 04-api.md; global refs issues from other files still shown; structure summary still global | PASS w/ note (F13) |
| 9e | t01: `check 99-missing.md` / `check cans/04-api.md` | — | silently accepted, partial filtering, exit 0, no diagnostic | UNDOCUMENTED (F13) |
| 10a | t10 tab-indented file | §11 tabs rejected | `✗ parse error: …tab indentation rejected (use 2 spaces)`; whole file dropped (0 nodes), exit 1 | PASS w/ note (F14) |
| 10b | t10b headings/prose/blank lines/numbered lists | §11 non-bullet lines ignored | clean parse (4 nodes), no crash | PASS |
| 10c | t10c/d 1-space & 3-space indent | §11 (only tabs rejected) | accepted but **silently re-parented**: 1-space node becomes a ROOT sibling (2 roots, maxDepth 0); 3-space floors to parent | UNDOCUMENTED (F11) |
| 10d | t10e/g/n/p ref syntax: `see X`, `see: X`, `see:X`, 2 refs/line, lowercase anchor | §11 regex, §12 case-insensitive + multi-see | `see X` ✓, `see: X` ✓, `see:X` ✗ silently ignored (0 refs); 2 refs/line both parsed+validated ✓; `#sessions` → resolves case-insensitively ✓ | PASS + DEVIATION (F10) |
| 10e | t10h-m ref counting | §12 both validated | per-node refs counted; duplicate `(target, anchor)` pairs from same file kept (t10l=2); all resolved refs consistent | PASS |
| 11 | exit-code matrix | §19 | clean t12=0; warnings t01=0; errors t02/t03/t05/t13/t14b=1; --strict warnings=1; no-workspace=1; empty `cans/`=0 | PASS |
| 12 | t12 handcrafted clean 6-file project: `check` + `--json` + `--fix` | §35 check-clean.json | achievable: 0 errors/0 warnings, exit 0; JSON identical in shape to §35; `--fix` no-op (md5 unchanged) | PASS (after F3/F15 workarounds) |
| 13 | t13 refs inside `_adr/*.md` and `_tasks/*.md` | §22 ref check | broken refs in both reported as errors; valid `_adr → spec#anchor` resolved; no structure/style on those files | PASS |
| 14a | t14a `_rules.yaml` overrides (node_length.max 60, force_sibling_below 4) | §18 partial override | honored: `Node too long (81 > 60)`, `"Branch" has 3 children` flagged | PASS |
| 14b | t14b invalid `_rules.yaml` | §18 line number + exit 1 | `✗ :0 — invalid _rules.yaml: line 2: unbalanced inline object…`, exit 1 | PASS |
| 15 | t15 folder-project fixture e2e | §8 folder mode | index.md files parsed; `see 02-authentication.md#Sessions` resolved via folder; parity with flat (same 17 warnings) | PASS |
| 16 | t16 empty `cans/` | — | `0 files, 0 nodes`, exit 0, no crash | UNDOCUMENTED (benign) |
| 17a | t17b `references.orphan_check: false` | §18 | orphan warning suppressed | PASS |
| 17b | t17 `references.duplicate_home_check: false` | §18 | Layer-4 duplicate-home warning **still fired** | FAIL (F9) |
| 17c | t17b `references.max_hops: 2` | §18 default max_hops 1 | deep hop **still flagged** (deepHops 1) | FAIL w/ note (F9; principle-safe) |
| 18 | t18 directory named `04-api.md/` inside cans/ | — | silently skipped from file count; no error; exit 0 | UNDOCUMENTED (F12) |
| 19 | t14a full output with `_rules.yaml` present | §22/§36 "Rules (_rules.yaml)" section | section never printed (with or without rules file) | DEVIATION (F17) |

## 4. Findings

**F1 · MAJOR · flat-vs-folder conflict not detected (§8/§11).**
Repro: scratch `t06/`: `cans/02-authentication.md` + `cans/02-authentication/index.md` (+ `04-api/index.md`), run `cans check`.
Expected: "Flat wins over folder. If both exist, `cans check` flags error." (§8 line 170, §11 line 291).
Actual: both parsed as separate spec files (files=3); no error; exit 0. The conflict surfaces only indirectly as redundancy noise ("100% overlap", depth-0-1 duplicate warning). A workspace can silently carry two divergent copies of the same concept.

**F2 · MAJOR · file-not-found is a warning for in-range `NN-` targets, contradicting §12.**
Repro: `t02b-span/` (files 02-authentication.md, 06-operations.md; refs `see 04-api.md`, `see 05-frontend.md`, `see 99-zzz.md`).
Expected: §12 edge case table — "File not found → Broken ref error" (error ⇒ exit 1).
Actual: targets whose number falls inside the numeric span [min…max] of existing spec files produce ⚠ `unwritten spec slot: see 04-api.md — file not created yet` (exit stays 0); only out-of-span targets (99) get ✗ `broken ref`. The term "unwritten spec slot" appears nowhere in the docs. Consequence: a genuinely broken ref can exit 0 in CI when the number happens to be in-range (also affects §34 flat-project: `see 03-data.md` → warning, refs.broken=0).

**F3 · MAJOR · ref tokens ("see", "md", filenames) counted by redundancy word-frequency make the documented clean contract unreachable.**
Repro: any project with ≥4 `see:` lines (e.g. t05: 5 refs → ⚠ `"see" × 5 nodes`, ⚠ `"md" × 5 nodes`, plus target-filename tokens like `"db" × 5` via synonym expansion of "storage").
Expected: §35 `check-clean.json` shows `refs.total: 12` with `issues: []`.
Actual: every ref line contributes `see`/`md`/target tokens; at ≥4 ref lines word-frequency warnings are unavoidable (threshold 4). Either ref text must be excluded from Layer 1 or the docs' clean fixture is impossible. (Docs and implementation co-deviate; flagging for engine owner.)

**F4 · MAJOR · §34 deep-hop fixture produces an extra `broken anchor` error.**
Repro: `t03-deephop/` — `see 06-operations.md#Data-protection` targeting node `Data protection`.
Expected: §34 says the fixture's expected output is only `✗ DEEP HOP: 04-api.md → 02-authentication.md → 06-operations.md`.
Actual: additionally `✗ broken anchor: 06-operations.md#Data-protection — no node matches`. Anchor normalization (hyphen↔space, as the docs' own `#Data-protection` convention implies) is not implemented and §12 only promises exact + case-insensitive matching. Docs fixtures and §12 resolution rules are mutually inconsistent; as shipped, the documented tutorial scenario reports a spurious error.

**F5 · MINOR · style `force_sibling_below` off-by-one (§14).**
Expected: "Parent with ≤ `force_sibling_below` (3) leaf children → flag" ⇒ 3 children flagged.
Actual: 3 leaf children NOT flagged (t02b, t08e, t01 "Data protection"); 2 are. With override `force_sibling_below: 4`, 3 children flag (t14a) — semantics are `< N`, not `≤ N`.

**F6 · MINOR · style collapse flag requires an all-leaf sibling group (§14 wording).**
Repro: t08f `Root → BranchA(has 1 child) + LeafB`.
Expected: "parent with ≤3 leaf children" ⇒ flagged (has 1 leaf child).
Actual: no flag. The engine only flags parents whose children are ALL leaves. Mixed groups of ≤2 children escape detection (structure single-child still catches the 1-child subset).

**F7 · MINOR · severity mismatches vs docs (§14/§15/§36).** Docs show ✗ (error) for style flags ("✗ … Collapse to sibling style.", "✗ … Group under nested style.") and for single-child collapse ("✗ … has exactly 1 child. Collapse."); implementation emits ⚠ warnings for all style findings, single-child, siblings-over-max, node-too-short, orphan. ✗ is reserved for node-too-long, depth>max, and refs errors. Net effect: a doc-example-shaped output (3 errors incl. two style ✗) is unreachable; exit codes stay 0 for style-only problems. (Arguably defensible, but the human-text contract in §36 does not match.)

**F8 · MINOR · JSON `maxDepth` uses 0-based depth while depth errors are 1-based (§35).**
Repro: t07d 7-level chain → errors `Depth 6`/`Depth 7` (1-based) but JSON `maxDepth: 6`. §35 clean fixture (4-level project) reports `maxDepth: 4`, i.e. 1-based. Off-by-one inconsistency inside one result object.

**F9 · MINOR · rules keys `duplicate_home_check` and `max_hops` are not honored (§18).** `orphan_check: false` works; `duplicate_home_check: false` still emits the depth-0-1 duplicate warning (t17); `max_hops: 2` still flags deep hops (t17b — principle-3-safe behavior, but the documented key is dead).

**F10 · MINOR · ref syntax: `see:TARGET` (colon, no space) silently not parsed.** `see X` and `see: X` work; `see:X` yields 0 refs with no diagnostic (t10n). §11's stated regex `/see:\s*(\S+?)(?:#(\S+))?/g` would match it, while it would NOT match the colon-less form used by every docs example (which the implementation does accept). Regex doc ↔ implementation disagree in both directions.

**F11 · MINOR · non-2-space indentation silently re-parents nodes (§11).** 1-space indented line becomes a **root-level sibling of its parent** (t10d: `- Root` + ` - X` → 2 roots, maxDepth 0); 3-space floors into the previous level (t10c). No diagnostic; tabs are the only rejected case. A "weird-but-legal" file silently changes meaning.

**F12 · MINOR · a directory named like a spec file (`cans/04-api.md/`) is silently skipped** from the file count with no error (t18). Also: empty `cans/` → clean exit 0 (t16), while missing `cans/` → error exit 1 — reasonable but undocumented.

**F13 · UX · `[file]` argument has no validation and partial scoping.** `check 99-missing.md` and `check cans/04-api.md` (wrong base path) run a filtered check with exit 0 and no "file not found" diagnostic; refs issues from *other* files and the global structure summary still print (refs are graph-global). Users get no signal their argument matched nothing.

**F14 · MINOR · parse errors are all-or-nothing with odd formatting.** One tab in an otherwise fine file drops the whole file (0 nodes, t10) with message `10-weird-a.md:0 — parse error: 10-weird-a.md: tab indentation rejected…` (path twice, line :0). Invalid `_rules.yaml` likewise reports under `✗ :0 —`. File-level issues use empty file + line 0.

**F15 · UX · fuzzy-typo layer (§13 L3, Levenshtein ≤2 for >4-char words) is extremely noisy on natural vocabulary.** t12 clean-project authoring required renaming to avoid `reading↔loading`, `service↔device`, `binding↔billing`, `hashed↔based`, `storage↔store`, and t07c flags `seven↔eleven`. A 0-warning workspace is achievable but demands unnatural word choices; docs' own fixtures all trigger it.

**F16 · UX · double-reporting + grammar on single-child nodes.** A 1-child node yields both `structure ⚠ "X" has exactly 1 child. Collapse.` and `style ⚠ "X" has 1 children. Collapse to sibling style.` (grammar: "1 children"). Same node, two categories, no added information.

**F17 · MINOR · `Rules (_rules.yaml)` report section never printed (§22 fixed order, §36 example).** Output sections are Structure → Style → References → Redundancy → Overflow → summary line; the Rules section and its `✓ node_length: 3–120 | …` line are absent even when `_rules.yaml` exists and is honored.

**F18 · UX · `check --fix` prints the PRE-fix state.** During the fixing run, the report still shows `back-pointers: 0/1 current`, the stale-back-pointer warning, and JSON `backPointers.current: 0, stale: 1` even though the same run rewrote them (only `backPointersUpdated: 1` reveals the write). §35 `check-fix.json` implies post-fix state (`current: 12`). Also: --fix may INSERT a standalone `<!-- ref-by: … -->` line, shifting subsequent line numbers (t10l) — within "back-pointers only" scope but worth knowing.

## 5. Observations (non-finding)

- Workspace convention: commands run from the parent of `cans/`; file arguments are relative to `cans/` (e.g. `04-api.md`, not `cans/04-api.md`).
- Structure/style/redundancy never run on `_tasks/`/`_collab/`/`_adr/` files, but refs *inside* `_tasks/` and `_adr/` are validated (§22 honored; t13).
- Messages include the quoted node text and accurate line numbers (verified against file contents repeatedly); no hierarchical path is given, so same-named nodes in one file are disambiguated only by line.
- Refs engines correctly caught my own authoring mistakes during t12 (missing ref, stale ref-by, orphans) — good real-world signal beyond the fixtures.
- `--refs-only`/`--no-redundancy` restrict *issues*, not report sections; sections always print with ✓ placeholders.
- No exit-code-2 path observed in ~40 invocations (bad YAML, parse errors, missing workspace all exit 0/1).
- A genuinely clean 6-file project (0 errors/0 warnings/exit 0, back-pointers 3/3) IS achievable — see scratch `t12-clean/` — but requires working around F3 and F15.

## 6. Verdict summary

- ~35 test cases executed. PASS ≈ 24 · FAIL 3 (F1 flat/folder conflict, F2 in-range broken-ref downgrade, F5/F6 style-threshold semantics counted here as 2 of the FAILs) · DEVIATION 7 · UNDOCUMENTED 6 · remainder PASS-with-notes. (Exact per-row verdicts in the matrix; some rows carry a PASS + linked finding.)
- Core refs machinery is solid: broken/self/deep-hop/transient/_collab/orphan detection, case-insensitive anchors, multi-ref lines, back-pointer rebuild (`--fix` scope strictly honored, idempotent), folder-mode resolution, `_adr`/`_tasks` ref checks, rules overrides for thresholds, JSON contract (§22/§35) and exit codes (§19) all behave.
- Highest-priority fixes: F1 (documented error case missing entirely), F2 (broken refs can exit 0), F3/F15 (noise makes the documented clean contract unreachable), F4 (docs' own tutorial fixture emits a spurious error).
