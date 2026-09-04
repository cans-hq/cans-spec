# QA-03 — `cans check` engines II: Redundancy, Overflow, Rules, Token Budget

Task ID: 3-c · Agent: qa-redundancy-overflow-rules · Repo: cans-spec @ impl/full-engines, commit 54b0b52 · Date: 2025-09-03

Resolution: verified 2026-09-04 on fix/qa-red-tests-green @ e628ff2 — 16/17 findings RESOLVED, 0 PARTIAL, 1 DOC-GAP, 0 OPEN; mapped suite qa-03-redundancy-overflow-rules-budget 16/16 green.

## Scope & docs covered

Blackbox manual QA (no source reading, no test runner) of:

- Redundancy Engine — docs/cans.architecture.md §13 (4 layers: word frequency, phrase overlap, fuzzy, cross-file canonicality; normalization incl. synonym expansion + stopword filtering)
- Overflow Engine — §16 (code fences, tables, max_node_chars; force_file_for; extraction advice; no-chaining rule)
- Rules System — §18 (`_rules.yaml` loading contract: missing/partial/delete-key/invalid; mini-parser syntax: inline arrays, inline objects, block arrays) + templates/_rules.yaml
- Token Budget — §26 (`budget read/write/--change`, scoring, token estimate, JSON contracts), §35 budget-read.json / budget-read-limit.json / budget-write.json, §36 human example, §817 AGENTS.md template
- Supporting: §17 engine order, §19 exit codes, §20 CLI surface, §22 check report sections, §34/§35/§36 fixtures, §37 error philosophy

## Environment

- CLI: `bun run /home/z/my-project/cans-spec/src/cli.ts <command>` (bun 1.3.14)
- Scratch (all copies, originals untouched): /home/z/my-project/qa-playground/qa-rules/{redundancy-project→red-ws/cans, overflow-project→ovf-ws/cans, budget-project→bud-ws/cans, probe-*, rules-ws, stop-ws, syn-ws, thresh2-ws}
- Workspace discovery convention (established empirically, consistent with §8 structure & help text "Config: cans/_rules.yaml"): CLI looks for a directory named `cans/` at or above cwd (walks up); the workspace root may also be cwd itself if reached via the walk. Running inside a directory that merely contains spec files but is not named `cans/` and has no `cans/` ancestor fails with "no cans workspace found", exit 1.

## Test matrix

Verdicts: PASS / FAIL (impl violates doc) / DEVIATION (impl–doc mismatch in behavior detail) / UNDOCUMENTED (no doc answer).

### T1 — Redundancy fixture (§34, §13)

| # | Command (in scratch ws cwd) | Expected (doc ref) | Actual | Verdict |
|---|---|---|---|---|
| 1 | `check` in redundancy-project copy (as `cans/`) | "authentication" × 6 nodes warning (§34) | `⚠ 02-authentication.md:1 — "authentication" × 6 nodes (threshold: 4)` | PASS |
| 2 | same | + phrase overlap warning (§34) | no phrase overlap issue | DEVIATION (see F7: §34 expectation unreachable under §13 metric; no fixture pair ≥ threshold) |
| 3 | same | exit 0, warnings don't affect exit code (§19) | exit 0, "0 errors, 1 warnings." | PASS |
| 4 | `check --strict` | warnings ⇒ exit 1 (§19) | exit 1 | PASS |
| 5 | `check --no-redundancy` | redundancy suppressed (README/§20) | "Redundancy ✓ no redundancy detected", exit 0 | PASS |
| 6 | `check --json` | Issue fields file/line/level/category/message/suggestion (§22) | category "redundancy", all fields present, ok=true | PASS |

### T2 — Overflow fixture (§34, §16)

| # | Command | Expected | Actual | Verdict |
|---|---|---|---|---|
| 7 | `check` in overflow-project copy | extracted overflow targets (04-api/request-schema.md fence, 04-api/error-handling.md table) not flagged (§16 pattern); main outline clean | "Overflow ✓ no code blocks, tables, or oversized nodes"; only structure note `"API" has exactly 1 child` | PASS |
| 8 | `check --json` | files/nodes counts (§22) | "1 files, 5 nodes" — only 04-api.md; the 2 sub-file targets parse as 0 nodes (not counted) | UNDOCUMENTED (counting semantics) |

### T3 — Handcrafted redundancy (ws: probe-*, thresh2-ws)

| # | Command | Expected | Actual | Verdict |
|---|---|---|---|---|
| 9 | word in exactly 4 nodes ("authentication" ×4) | fires at ≥ threshold 4 (§13/§18) | `⚠ "authentication" × 4 nodes (threshold: 4)` | PASS |
| 10 | synonym spread: postgres/pg/postgresql in 4 nodes, 2 files | expansion → one concept ×4 (§13) | `⚠ "postgres" × 4 nodes (threshold: 4)` | PASS |
| 11 | near-duplicate siblings 5/7 shared tokens (incl. stopword "for") | ≥70% → flag (§13) | `⚠ 71% overlap` | PASS |
| 12 | pair with exactly 7/10 = 70.0% overlap | "≥ 70%" → flag (§13) | NOT flagged | DEVIATION (boundary is strict >, not ≥) |
| 13 | inspect metric of #11 | §13: stopwords filtered during normalization | 5/7 = 71% only if stopword "for" counted; overlap computed on unfiltered tokens | DEVIATION (F7) |
| 14 | duplicate identical bullets across files | overlap 100% → flag | `⚠ 100% overlap: 02-db.md:1 ↔ 07-db-replica.md:1` | PASS |
| 15 | same concept word at depth 0–1 in 2 files, no see: | cross-file flag, threshold 2 (§13 L4) | `⚠ "database" at depth 0-1 in 2+ files without see: (02-db.md, 07-db-replica.md)` | PASS |
| 16 | "Database" vs "Database replicas" in 2 files, no see: | "same concept" → flag? (§13) | no L4 flag | UNDOCUMENTED (L4 appears to require exact normalized node-text equality) |
| 17 | similar words >4 chars, lev ≤2 ("store"/"stale") | possible typo warning (§13 L3) | `⚠ possible typo: "store" ↔ "stale" — Levenshtein 2` | PASS |
| 18 | postgres ↔ postgresql (same synonym group) | fuzzy suppressed for synonym-matched words (§13 L3) | `⚠ possible typo: "postgres" ↔ "postgresql" — Levenshtein 2` | FAIL (F8) |
| 19 | `redundancy.word_frequency_threshold: 5` with ×4 | warning disappears (§18 override) | clean | PASS |
| 20 | `redundancy.phrase_overlap_threshold: 0.8` with 71% pair | disappears (§18) | clean; explicit 0.7 fires again | PASS |
| 21 | `redundancy.cross_file_threshold: 3` with 2 files | L4 flag disappears (§18) | L4 gone (phrase-overlap 100% remains) | PASS |

### T4 — Handcrafted overflow (ws: ovf-probe, rules-ws, ovf-ws)

| # | Command | Expected | Actual | Verdict |
|---|---|---|---|---|
| 22 | node containing fenced code block | flag, recommend extraction to file (§16) | `✗ code fence detected — extract to file and reference via see:` | PASS |
| 23 | node containing markdown table | flag (§16) | `✗ table detected — extract to file and reference via see:` | PASS |
| 24 | inline code `` `POST /users` ``, `timeout=30s`, `a -> b -> c` | fine, not flagged (§16) | not flagged | PASS |
| 25 | 78-char node with `overflow.max_node_chars: 50` | flag (§16/§18) | `✗ node exceeds max chars (78 > 50)` | PASS |
| 26 | 196-char node with default 200 | no overflow flag | none (structure flags it >120 instead) | PASS |
| 27 | `overflow.force_file_for: [table]` and `[]` | code_block no longer in list → fence not flagged (§18 semantics) | fence AND table still flagged in both cases | FAIL (F6: force_file_for inert in check) |
| 28 | append `see:` line to overflow target 04-api/request-schema.md | target must NOT contain see: — flag (§16) | nothing flagged; the see: isn't even counted in refs | FAIL (F10) |
| 29 | ```mermaid fence | "diagram" category? (§18 force_file_for) | reported as generic "code fence detected" | UNDOCUMENTED (no detectable "diagram" category) |

### T5 — Rules loading contract (§18; ws: rules-ws, stop-ws)

| # | Command | Expected | Actual | Verdict |
|---|---|---|---|---|
| 30 | no _rules.yaml | all defaults (§18) | structure >120 ✗, redundancy ×4 ⚠, overflow fence ✗ — all default thresholds | PASS |
| 31 | empty _rules.yaml | defaults | identical to missing | PASS |
| 32 | partial: `structure.node_length: { min: 3, max: 200 }` only | only listed keys override; 149-char node passes; redundancy+overflow unchanged (§18) | exactly that | PASS |
| 33 | full defaults minus `redundancy:` section | delete key ⇒ check off (§18) | ×4 warning still fires | FAIL (F1) |
| 34 | `redundancy:` section present but `enabled` key deleted | check off (§18) | still fires | FAIL (F1) |
| 35 | `redundancy.enabled: false` | off | "✓ no redundancy detected" | PASS |
| 36 | `references:` section with `orphan_check` deleted | orphan check off (§18) | orphan warning still fires | FAIL (F1) |
| 37 | invalid YAML `stopwords: [the, unclosed` at line 6 | message incl. line number, exit 1 (§18) | `✗ invalid _rules.yaml: line 6: unbalanced inline array: [the, unclosed`, exit 1 | PASS |
| 38 | invalid YAML: tab indentation; `structure: 42` | line number + exit 1 (§18) | `✗ Internal error: undefined is not an object (evaluating 'rules.node_length.max')`, exit 2 | FAIL (F2) |
| 39 | unknown keys only (`bogus_key: 42`) | tolerated | ignored, defaults apply, exit 0 | PASS |

### T6 — Mini-parser syntax (§18)

| # | Command | Expected | Actual | Verdict |
|---|---|---|---|---|
| 40 | inline arrays `force_file_for: [code_block, table, diagram]`, `stopwords: [...]` | parsed | parsed and applied | PASS |
| 41 | inline objects `node_length: { min: 3, max: 200 }` | parsed | applied (149-char node passes) | PASS |
| 42 | block arrays `- item` (stopwords incl. "authentication") | parsed (§18) | ×4 word-freq disappears | PASS |
| 43 | block array of inline arrays (synonyms, template syntax `-[postgres, postgresql, pg]`) | parsed (template uses it) | ×4 preserved | PASS |
| 44 | nested block arrays (`- - postgres` …) | — | synonym grouping silently lost (no ×4) | UNDOCUMENTED (F13) |
| 45 | block objects (nested indented `node_length: / min: / max:`) | parsed | applied | PASS |

### T7 — `budget read` (§26, §35, §36; ws: bud-ws/cans from budget-project + extensions)

| # | Command | Expected | Actual | Verdict |
|---|---|---|---|---|
| 46 | `budget read sessions` | plan per §36 format: canonical home, back-refs, skipped, budget line | `1. 02-authentication.md#Sessions ← canonical home (38 tok)` / `2. 04-api.md ← see: back-ref (26 tok)` / `3. 06-operations.md ← see: back-ref (28 tok)` / `Budget: 92 / 4096 tokens (2.2%)` | PASS |
| 47 | same `--json` | schema §26/§35: ok/command 'budget-read'/exitCode/concept/plan[file,anchor,reason,score,estTokens]/skipped/totalTokens/budgetLimit/usagePercent | exact match; scores 100/60/60; usagePercent 2.2 | PASS |
| 48 | canonical home choice | highest child count → lowest depth → earliest file (§26) | 02-authentication.md#Sessions (2 children) chosen over see:-only mentions | PASS |
| 49 | scoring tiers | canonical 100, back-pointer 60, mentions 20 (§26) | 100 / 60 / 60 / 20 observed | PASS |
| 50 | estTokens | `ceil(len/3.5)` (§26) | 38/26/28 — consistent with ~file text stripped of list syntax; not derivable to any documented text unit (anchor is node "Sessions", estimate is file-sized) | UNDOCUMENTED (granularity) |
| 51 | `budget read sessions --limit 70` | greedy include until limit; skipped rest (§26; mirrors budget-read-limit.json) | plan=[38,26], skipped=[06-operations.md], 64/70 (91.4%) | PASS |
| 52 | usage 91.4% vs `warn_threshold: 0.8` | warning somewhere? (§18 token_budget rules) | no warning in human or JSON at 91.4%, nor with `warn_threshold: 0.5` at 92% | UNDOCUMENTED (F11: knob inert) |
| 53 | concept normalization `session` | normalize (§26 step 1) | same plan as "sessions" | PASS |
| 54 | `_tasks/add-dark-mode.md` mentioning "Sessions" (§30 format) | "active task mentioning" tier in plan (§26 step 3; §35 fixture shows task in plan) | task file NEVER appears in plan (tried 2 formats, `State:` field, `--json`) | FAIL (F3) |
| 55 | file mentioning "sessions" w/o see: (03-data.md) | "mentions concept" (20) (§26) | `20 mentions concept 03-data.md` | PASS |
| 56 | `token_budget.default_limit: 100` | override applies (§18) | `Budget: 92 / 100 tokens (92%)` | PASS |

### T8 — `budget read --change` (§20, §26)

| # | Command | Expected | Actual | Verdict |
|---|---|---|---|---|
| 57 | `budget read --change add-dark-mode` | flag exists (§20); centered on task file (§26) | works: plan = task file (45 tok) | PASS |
| 58 | task file with `see 04-api.md` | add its refs 1 hop (§26) | `2. 04-api.md ← task ref target (26 tok)` | PASS |
| 59 | deep hop via 04-api.md → 02-authentication.md | reject deep-hop expansion (§26) | 02-authentication.md stays skipped | PASS |
| 60 | `budget read sessions --change add-dark-mode` | — | full sessions plan + task promoted to rank 1 | UNDOCUMENTED (hybrid semantics) |
| 61 | task entries in output | relative paths elsewhere | ABSOLUTE local path for _tasks file | DEVIATION (F12, also in write) |

### T9 — `budget write` (§26, §35)

| # | Command | Expected | Actual | Verdict |
|---|---|---|---|---|
| 62 | `budget write sessions --json` | schema §26 write: canEdit/mustNotEdit/backPointersToUpdate | exact match incl. reasons "canonical home"/"active task"/"only has see: reference" | PASS |
| 63 | canEdit / mustNotEdit membership | canonical + active task CAN; see:-only files MUST NOT (§26) | 02-auth + _tasks CAN; 04-api, 06-operations MUST NOT; mentions-only 03-data correctly excluded | PASS |
| 64 | backPointersToUpdate | files+lines of see: back-refs | 04-api.md:3 and 06-operations.md:3 — both line numbers correct | PASS |
| 65 | side effects | planner only | md5sum of all files unchanged before/after | PASS |

### T10 — Budget error paths (§37)

| # | Command | Expected | Actual | Verdict |
|---|---|---|---|---|
| 66 | `budget read xyzzy` (0 matches) | say what/why/how to fix (§37) | prints empty plan + all files skipped, exit 1; no explanation | DEVIATION (F9) |
| 67 | `budget write xyzzy` | error or explicit empty scope; exit contract (§19) | `CAN edit:` / `MUST NOT edit:` empty, **exit 0** | FAIL (F4) |
| 68 | `budget frobnicate x` | unknown subcommand error (§37) | silently executed as `read` for concept "x", exit 0 | FAIL (F5) |
| 69 | `budget read sessions` outside a workspace | say what happened/why/fix (§37) | `Reading plan for: sessions` + `Budget: 0 / 0 tokens (0%)`, exit 1, no error text | FAIL (F9) |
| 70 | bare `budget` | usage or error | `Reading plan for: ` (empty concept), exit 1 | DEVIATION (F15) |
| 71 | concept "x" | — | substring match hits "Expire after 24 hours" → becomes canonical home | UNDOCUMENTED (F16) |

### T11 — check × token budget (§17, §22)

| # | Command | Expected | Actual | Verdict |
|---|---|---|---|---|
| 72 | `check` on budget-project extension | token_budget rules in check? §17 engine list has no budget engine | no token/budget content in output (grep=0) — correct per §17 | PASS (observation) |
| 73 | report section order | Structure → Style → References → Redundancy → Overflow → **Rules** → Summary (§22) | "Rules" section never appears in any run | DEVIATION (F11b) |
| 74 | exit codes across all check runs | 0 ok, 1 errors (§19) | consistently observed incl. strict mode | PASS |

Total: 74 recorded checks — PASS 47 · FAIL 10 · DEVIATION 10 · UNDOCUMENTED 7 (rows may combine; findings consolidated below).

## Findings

1. **MAJOR — "Delete a key = check turns off" not implemented (§18, §40).**
   > **Status: RESOLVED** — Green red-tests `F1a`/`F1b`/`F1c` (whole `redundancy:` section deleted, `enabled` deleted, `orphan_check` deleted → check off). CLI re-check: defaults minus the `redundancy:` section prints "Redundancy ✓ no redundancy detected".

   Removing `redundancy.enabled`, the whole `redundancy:` section, or `references.orphan_check` leaves the checks running with defaults. Only explicit `false` disables. This is the documented migration/disabling mechanism. Repro: rules-ws with `_rules.yaml` = full defaults minus redundancy section → ×4 warning still fires.
2. **MAJOR — Some malformed configs crash with an internal error instead of §18's line-numbered config error.**
   > **Status: RESOLVED** — Green red-tests `F2a`/`F2b`. Observed: `✗ invalid _rules.yaml: line 1 — "structure" must be a mapping, got number`, exit 1 — no "Internal error", no exit 2.

   `structure:` + tab-indented line, or `structure: 42` → `✗ Internal error: undefined is not an object (evaluating 'rules.node_length.max')`, exit 2. §18 says invalid YAML → print line number, exit 1; §37 forbids internal-error leakage for user errors. Unbalanced-bracket YAML is handled correctly (line 6 reported, exit 1), so coverage of the "invalid YAML" path is partial.
3. **MAJOR — Active-task tier missing from `budget read` (§26 step 3, §35 budget-read.json).**
   > **Status: RESOLVED** — Green red-test `F3`. Observed `budget read sessions --json` plan entry `cans/_tasks/add-dark-mode.md — active task mentions concept — score 80` (§26 prose tier).

   A `_tasks/*.md` mentioning the concept (in §30 format, and variants) never appears in the plan ("active task mentioning", 80/20). The same file IS found by `budget write` ("active task") and by `read --change` — so plain `read` alone diverges from the documented scoring.
4. **MAJOR — `budget write` exit-code contract broken for unknown concepts.**
   > **Status: RESOLVED** — Green red-test `F4`. Observed: ``✗ no files match concept "xyzzy" — check spelling or run `cans status` ``, exit 1 (JSON `ok:false`).

   `budget write xyzzy` → exit 0 with empty CAN/MUST-NOT lists; `budget read xyzzy` → exit 1. §19: 1 = user-correctable failure; agents relying on exit codes will treat an empty write scope as success.
5. **MAJOR — Unknown `budget` subcommand silently runs as `read`.**
   > **Status: RESOLVED** — Green red-test `F5`. Observed: `✗ unknown subcommand "frobnicate" — valid: read, write`, exit 1.

   `budget frobnicate x` → `Reading plan for: x`, exit 0. Typo'd invocations are accepted and produce plausible-looking output (violates §37 "say what happened").
6. **MINOR — `overflow.force_file_for` is inert in `cans check`.**
   > **Status: RESOLVED** — Green red-test `F6`. Observed: `[table]` flags only the table, `[]` flags nothing — the list now drives detection. (Docs note: the `diagram` entry still has no matcher — mermaid classifies as code_block; row 29 UNDOCUMENTED persists.)

   `force_file_for: [table]` and even `[]` still flag code fences and tables. The §18 default `[code_block, table, diagram]` implies the list drives detection; it does not (fence/table detection appears hardcoded).
7. **MINOR — Phrase-overlap metric deviates from §13 normalization and boundary.**
   > **Status: RESOLVED** — Green red-tests `F7a` (exactly 7/10 = 70% now flags — ≥ boundary) and `F7b` (stopwords filtered before measuring — 66.7% no longer fires). Docs residual: §34's expected phrase-overlap warning for redundancy-project remains unreachable under the corrected metric (row 2) — §34-vs-§13 doc-internal tension.

   Observed metric is Jaccard over tokens *including stopwords* (5/7 = 71% fires where stopword "for" is shared; §13 says stopwords filtered) and threshold is strict `> 0.7` (exactly 7/10 = 70% does not fire; §13 says "≥ 70%"). Consequence: §34's expected "phrase overlap warning" for redundancy-project is unreachable under any reading of §13 — the fixture produces only the ×6 word-frequency warning.
8. **MINOR — Fuzzy layer fires on synonym-matched pairs.**
   > **Status: RESOLVED** — Green red-test `F8`: postgres ↔ postgresql (same synonym group) no longer yields a "possible typo" warning.

   `postgres` ↔ `postgresql` flagged "possible typo — Levenshtein 2" although both map to the same synonym group; §13 explicitly excludes "already synonym-matched" words, and the suggestion ("map the variant as a synonym") is already satisfied — pure noise.
9. **MINOR — Budget commands outside a workspace give no explanation.**
   > **Status: RESOLVED** — Green red-test `F9` (non-workspace `budget read` explains instead of success-shaped output). Zero-match observed: ``✗ no files match concept "xyzzy" — check spelling or run `cans status` ``, exit 1 (§37 what/why/how, JSON `ok:false`).

   `budget read sessions` from a non-workspace → `Reading plan for: sessions` + `Budget: 0 / 0 tokens (0%)`, exit 1, no "no cans workspace found" hint (unlike `check`). `budget read <zero-match concept>` similarly exits 1 with an empty plan and no "why/how to fix" (§37).
10. **MINOR — §16 no-chaining rule not enforced.**
    > **Status: RESOLVED** — Green red-test `F10`: a `see:` line inside overflow target 04-api/request-schema.md is now flagged.

    Adding a `see:` line to an overflow target (04-api/request-schema.md) produces no error; the ref isn't even counted. (Enforcement point may be intended elsewhere — nowhere documented.)
11. **MINOR — Dead/invisible config surfaces: `token_budget.warn_threshold` and the §22 "Rules" report section.**
    > **Status: RESOLVED** — Green red-test `F11`; observed `⚠ warning: plan usage 91.4% of 70 tokens exceeds token_budget.warn_threshold (80%)` on stderr, and `check` now prints the §22/§36 `Rules (_rules.yaml)` section before the Summary.

    No warning is ever emitted at 91.4% usage with warn_threshold 0.8 (nor 0.5); and check output never contains the documented "Rules" section (fixed order Structure → Style → References → Redundancy → Overflow → Rules → Summary).
12. **MINOR — Absolute local paths leak into budget output for task files**
    > **Status: RESOLVED** — Manual CLI (no dedicated red test): `budget read sessions --change add-dark-mode` and `budget write sessions` (human + `--json` canEdit) now report the task file as workspace-relative `cans/_tasks/add-dark-mode.md`; no absolute paths.

    (`/home/z/.../_tasks/add-dark-mode.md` in `budget read --change`, `budget write` human + JSON canEdit) while all other files are repo-relative — breaks portability/diffability of agent-facing output.
13. **MINOR — Nested block arrays silently ignored by the mini-parser.**
    > **Status: RESOLVED** — Manual CLI: nested block-array synonyms now fail loud per §18 — `✗ invalid _rules.yaml: line 9: unexpected indentation`, exit 1 — no silent degradation; documented block-array-of-inline-arrays syntax still merges (×4 fires).

    `synonyms: [- - postgres, - postgresql, ...]` parses without error but yields no synonym grouping (word-freq count drops 4→below threshold). Undocumented syntax, but silent degradation.
14. **UX — Workspace-not-found error is misplaced and misleading in `check`.**
    > **Status: RESOLVED** — Manual CLI: `check` outside a workspace prints a single error line ``✗ no cans workspace found — run `cans init` or cd into a project with a cans/ directory`` + `1 errors, 0 warnings.`, exit 1 — no phantom ✓ sections, no `:0`-line under References.

    `✗ :0 — no cans workspace found` renders under the *References* section with empty file/line-0, while Structure/Redundancy/Overflow print reassuring "✓/0 files" sections for a workspace that doesn't exist.
15. **UX — Bare `budget` (no subcommand) prints `Reading plan for:` with an empty concept**
    > **Status: RESOLVED** — Manual CLI: bare `budget` → `✗ usage: cans budget <read|write> <concept>`, exit 1.

    instead of usage/error guidance.
16. **UX — Concept matching is substring-based and undocumented.**
    > **Status: DOC-GAP** — Behavior unchanged: `budget read x` still substring-matches ("x" inside "Expire after 24 hours" elected canonical home, exit 0), and §26 step 1 ("Normalize concept. Find matching nodes.") still defines no matching semantics — undocumented surface, no documented contract violated; docs need a §26 matching definition.

    `budget read x` matches "Ex**p**i**r**e…"? — actually matches substring "x" inside "expire" and elects a 0-child leaf as "canonical home". Surprising canonical-home selection for short concepts.
17. **COSMETIC — "has 1 children"**
    > **Status: RESOLVED** — Manual CLI: single-child warning now reads `"Parent" has exactly 1 child. Collapse.`

    grammar in style warnings (observed on budget-project check).

## Observations

- Engine behaviors that match the docs well: word-frequency with synonym expansion and node-count threshold; cross-file canonicality (exact-text, depth 0–1, respects `see:` presence — no false L4 flag on redundancy-project because a `see:` exists); all three redundancy thresholds configurable via `_rules.yaml`; overflow fence/table/oversize detection with §16-style "extract to file and reference via see:" advice; inline code/key-value/arrow exemptions; `--limit` greedy truncation identical in spirit to budget-read-limit.json; `--change` 1-hop expansion with correct deep-hop rejection; `budget write` JSON exactly per contract and side-effect-free (md5-verified).
- Fuzzy Layer 3 as specified (lev ≤ 2, >4 chars) is inherently noisy in practice: "sessions"↔"session" and "google"↔"toggle" warnings appeared on the budget-project check. Per-spec, but worth a product look (morphology handling).
- Task files are ref-checked ("light" per §22): a `see:` in `_tasks/add-dark-mode.md` to 04-api.md correctly produced a DEEP HOP error with a §37-style fix suggestion.
- Doc-internal inconsistencies (docs, not impl): §26 prose scores "active task mentioning (80)" but §35 fixture shows score 20 with reason "active task mentions concept"; §35 shows 06-operations "see: back-ref" with score 40 where §26 defines back-pointer=60/forward-ref=40. Impl chose 60 (consistent with prose).
- Token estimate granularity is effectively per-file (bullets/indentation stripped) even when `anchor` points at a node — with `--limit`, whole-file estimates are consumed per plan entry; fine at this fixture scale but undocumented.
- Empty/missing/unknown-key `_rules.yaml` all behave as "all defaults" — good robustness, matches §18 for missing file.

## Verdict summary

Pre-fix (historical):

- 74 checks: **47 PASS · 10 FAIL · 10 DEVIATION · 7 UNDOCUMENTED** (consolidated into 17 findings).
- Core engine behavior (redundancy layers, overflow detection, budget planning JSON, thresholds configurability, --change semantics, exit-code discipline for check) is solid and doc-aligned.
- The weakest areas are the §18 "delete a key = disable" contract (not implemented, F1), config-error handling (F2), the active-task tier in `budget read` (F3), and budget error-path hygiene (F4, F5, F9).
- No blockers found; 4–5 major findings, all with clear reproducers in /home/z/my-project/qa-playground/qa-rules/.
- Repo left untouched (no modifications/commits); all testing done on copies in scratch.

Post-fix (2026-09-04, fix/qa-red-tests-green @ e628ff2):

- 16/17 findings RESOLVED, 0 PARTIAL, 1 DOC-GAP (F16), 0 OPEN. Mapped red suite `test/qa-verify/qa-03-redundancy-overflow-rules-budget.test.ts` 16/16 green (15 finding tests + 1 control); whole-repo `bun test` 192 pass / 0 fail.
- DOC-GAP F16: concept matching in `budget read`/`budget write` is still undocumented — §26 step 1 says only "Normalize concept. Find matching nodes." Substring matching persists (`budget read x` → "Expire after 24 hours" elected canonical home, exit 0); needs a §26 matching definition, not an undocumented impl tweak.
- Doc-internal residuals (docs untouched on this branch, no impl change required): §34's "phrase overlap warning" for redundancy-project is still unreachable under the corrected §13 metric (row 2); §18's `force_file_for` `diagram` entry still has no detection category (mermaid fences classify as `code_block`, row 29); §26 prose (active task = 80) vs §35 fixture (score 20) inconsistency stands — impl follows §26 prose (verified: score 80).
- Spot-checked FAIL/DEVIATION rows via CLI: 27, 33, 34, 36, 38, 54, 61, 66, 67, 68, 69, 70, 71, 73 all behave per documented contracts now; PASS rows 1, 37, 46/47, 51 re-verified without regression (row 51 additionally exercises the new warn_threshold warning).
