# QA-12 — `cans check` Engines I: Structure, Style, References (+ back-pointers, check flags, flat-vs-folder)

Task ID: 5-b · Agent: QA-12 (general-purpose) · Round 3 · Date: 2026-09-05
Target: **npm-published package `cans-spec@0.1.0`**, global binary `/home/z/.npm-global/bin/cans` (`cans version` → `cans 0.1.0`); `npm ls -g` confirms `cans-spec@0.1.0`. Repo /home/z/my-project/cans-spec @ main e4cecda used ONLY for docs/fixtures (never modified, never executed).
Env: Bun 1.3.14 · Node v24.19.0 · Linux · manual shell only (no scripts, no harnesses, no src//node_modules/test-*.ts reads).
Method: BLACKBOX. Scratch workspaces t01…t12 under /home/z/my-project/qa-playground-r3/qa12/ (preserved for reproduction). Fixtures copied read-only from test/fixtures/ where noted. All exit codes observed directly (no pipes) where they matter.

Prior-round cross-references: QA-02 (round 1) + QA-07 (round 2 verification). Where a round-1/2 finding reproduces on the npm binary it is marked **STILL-BROKEN (ref QA-02 F#)**; where a prior fix is re-confirmed it is marked **FIXED-holds**; two round-2 residuals are **now FIXED in the npm build** (see §5).

## 1. Scope & docs covered

docs/cans.architecture.md §8 (flat/folder), §10–§12 (types, parser, refs engine), §14–§15 (style, structure), §17 (engine order, --fix scope), §18 (defaults incl. `empty_nodes: false`, `max_node_chars`), §19 (exit codes), §20 (CLI grammar, `--flag value` only), §22 (`cans check` contract + JSON), §34 (input fixtures), §35 (check JSON fixtures), §36 (human-text examples), §37 (error-message philosophy); README.md (Validation section, install contract).
Engines under test: **Structure, Style, References** (+ back-pointers, `--fix`, `--strict`, `--refs-only`, single-`file` arg, flat-vs-folder, tab rejection, exit-code/JSON contract for these). Redundancy/overflow issues were observed incidentally and are ignored unless they collide with my area (noted where relevant). `_rules.yaml` config semantics NOT tested (QA-13's area).

## 2. Environment / conventions

- Commands run from the directory containing `cans/` (workspace convention, as established in QA-02).
- File arguments are workspace-relative spec names (`04-api.md`, not `cans/04-api.md`).
- All workspaces created via `cans init` then spec files overwritten/added with heredoc content (normal manual usage).
- ~55 test invocations across t01-clean, t02-structure, t03-style, t04-refs, t05-deephop, t06-fix, t07-nofix, t08-folder, t09-both, t09b-both, t10-tabs, t11-prose, t12-boundary.

## 3. Test matrix

| # | Command (cwd = scratch ws) | Expected (doc §) | Actual | Verdict |
|---|---|---|---|---|
| 1 | `cans version` | — | `cans 0.1.0`, exit 0 | PASS (env) |
| 2 | t01 `cans check` (handcrafted clean 4-file ws) | §36 clean run: summary, refs line, back-pointers line, `0 errors, 0 warnings.`, exit 0 | `4 files, 37 nodes, max depth 3` / `3 see: refs, 0 broken, 0 deep hops` / `back-pointers: 3/3 current` / `0 errors, 0 warnings.`; exit 0 — but the three summary lines carry **no `✓` prefix** (docs show `✓ 6 files…`, `✓ 12 see: refs…`, `✓ back-pointers: 12/12 current`); Redundancy/Overflow/Rules lines DO have `✓` | PASS + **DEVIATION D1** |
| 3 | t01 `cans check --json` | §22/§35 keys {ok, command, exitCode, files, nodes, maxDepth, refs{total,broken,deepHops}, backPointers{total,current,stale}, issues[], errorCount, warningCount, backPointersUpdated} | all keys present and correct; **additive key `rulesSummary`** (string) not in §35 | PASS (+ UNDOC N1) |
| 4 | t01 `check` **before** any `--fix` (3 refs, no `ref-by` comments) | §35 check-clean implies backPointers total=current=refs.total | `back-pointers: 0/0 current`, backPointers{0,0,0}, **no warning** — missing comments are silently not counted | UNDOC (F4) |
| 5 | t01 `check --strict` (clean) | §19 | exit 0 | PASS |
| 6 | t02 `check` — 161-char node | §15 `Node too long (N > 120). Split or move to file.` | `✗ 01-long.md:2 — Node too long (161 > 120). Split or move to file.` (✗, count exact) | PASS |
| 7 | t12 boundary: node of exactly 120 / 121 chars | §18 node_length.max 120 | 120 → no flag; 121 → `✗ … Node too long (121 > 120). Split or move to file.` | PASS |
| 8 | t02 2-char node `Ok` | §15/§18 min 3 | `⚠ 02-short.md:2 — Node too short (2 < 3).` (warning; level undocumented) | PASS |
| 9 | t02 `- ` empty node (§18 `empty_nodes: false`) | QA-02 precedent | `⚠ 06-empty.md:2 — Node too short (0 < 3).`, no crash | PASS |
| 10 | t02 7-level chain | §15 `Depth N exceeds max 5. Flatten.` | `✗ 03-depth.md:6/11 — Depth 6 exceeds max 5. Flatten.` + `✗ :7–10 — Depth 7 exceeds max 5. Flatten.` (per offending node, line-accurate); JSON `maxDepth: 7` (1-based — QA-02 F8 FIXED-holds) | PASS |
| 11 | t02 13 siblings | §15 `⚠ "X" has N children (max 12).` | `⚠ 04-siblings.md:1 — "Board" has 13 children (max 12).` (⚠ per docs; JSON level warning, category structure) | PASS |
| 12 | t02 node with exactly 1 child | §15/§36 show `✗ … has exactly 1 child. Collapse.` | `⚠ 05-single.md:2 — "Only" has exactly 1 child. Collapse.` — text exact, **level ⚠ not ✗**; no style double-report (QA-02 F16 FIXED-holds) | STILL-BROKEN (QA-02 F7, minor doc) |
| 13 | t02 `--json` issue shape | §10/§35 | `{file, line, level, category: "structure", message}` line-accurate | PASS |
| 14 | t03 7×`Returns` siblings (style-project/04-api-nested.md) | §14 `7 siblings share prefix "Returns". Group under nested style.` | `⚠ 04-api-nested.md:2 — 7 siblings share prefix "Returns". Group under nested style.` (line = parent "POST /users"; ⚠ not ✗) | PASS text / STILL-BROKEN QA-02 F7 severity |
| 15 | t03 exactly 5 shared-prefix siblings | §14 flag only at ≥ `force_nested_above: 6` | not flagged | PASS |
| 16 | t03 exactly 6 shared-prefix siblings | §14 boundary ≥6 | `⚠ 06-six.md:2 — 6 siblings share prefix "Serves". Group under nested style.` | PASS |
| 17 | t03 parent with 2 leaf children (style-project/04-api-sibling.md) | §14 `Collapse to sibling style.` | `⚠ 05-api-sibling.md:3 — "Returns" has 2 children. Collapse to sibling style.` (⚠ not ✗) | PASS text / STILL-BROKEN QA-02 F7 severity |
| 18 | t03 parent with exactly 3 leaf children | §14 "≤ force_sibling_below (3) → flag" (QA-02 F5 fix) | `⚠ 07-three.md:2 — "Handler" has 3 children. Collapse to sibling style.` — ≤ semantics hold on npm | PASS (mission brief's "should NOT flag" expectation contradicts §14; doc wins) |
| 19 | t03 parent with 4 leaf children | §14 >3 → no flag | not flagged | PASS |
| 20 | t03 depth-0 root with 2 leaf children | §14 (no depth distinction) | not flagged — root-level parents exempt from style collapse (QA-02 NEW-2) | STILL UNDOC (minor) |
| 21 | t04 ref to out-of-span missing file `see 99-nonexistent.md` | §12/§37 broken ref error | `✗ 08-multi.md:3 — broken ref: see 99-nonexistent.md — file not found` + `create 99-nonexistent.md or fix the ref target`; JSON refs.broken +1, exit 1. Wording differs from §37 example (no `Did you mean …?` hint) → **DEVIATION D3** | PASS + DEVIATION |
| 22 | t04 broken anchor `see 02-authentication.md#Nope` | §12 "Not found = broken ref error" | `✗ 04-api.md:2 — broken anchor: 02-authentication.md#Nope — no node matches` + suggestion; note: **not counted in `refs.broken`** (JSON broken counts file-not-found only) | PASS (+ UNDOC N2) |
| 23 | t04 lowercase anchor `#sessions` vs node `Sessions` | §12 case-insensitive fallback | resolves, 0 broken | PASS |
| 24 | t04 no-anchor file-level ref `see 06-operations.md` | §12 valid file-level | resolves | PASS |
| 25 | t04 self-ref `see 11-selfref.md` inside 11-selfref.md | §12 self-reference → error | `✗ 11-selfref.md:2 — self-reference: 11-selfref.md → 11-selfref.md` + suggestion | PASS |
| 26 | t05 deep-hop fixture (deep-hop-project/) | §34 `✗ DEEP HOP: 04-api.md → 02-authentication.md → 06-operations.md` + fix line; **no** spurious broken anchor (QA-02 F4 fix) | `✗ 02-authentication.md:3 — DEEP HOP: 04-api.md → 02-authentication.md → 06-operations.md` + `add "see: 06-operations.md#Data-protection" directly to 04-api.md` — chain exact, hyphen anchor normalized, JSON `refs.deepHops: 1`, `suggestion` field present. Continuation line lacks the `Fix:` prefix shown in §36 → **DEVIATION D2**. Also ran with **no `_rules.yaml`/AGENTS.md present** → defaults, no crash (§18 "missing file = all defaults") | PASS + DEVIATION |
| 27 | t04 `see _tasks/add-dark-mode.md` | §12 warning (transient) | `⚠ 01-architecture.md:2 — transient ref: … _tasks/ files are transient, not spec` | PASS |
| 28 | t04 `see _collab/handoffs.md` | §12 error | `✗ 01-architecture.md:3 — ref to _collab/: … collab notes are not spec`, exit 1 | PASS |
| 29 | t04 orphan file + 00-overview exemption | §12 orphan warning | `⚠ 07-orphan.md — orphan: … no incoming or outgoing refs` + suggestion; 00-overview exempt | PASS |
| 30 | t04 file whose only ref is a self-ref | §12 "no incoming AND no outgoing" | 11-selfref.md **also** flagged `⚠ orphan` although it has an outgoing (self) ref — orphan check ignores self-refs | UNDOC (F5, minor) |
| 31 | t04 two `see:` on one line (one valid pair, one valid+broken pair) | §12 both parsed, both validated | refs.total 16 = exactly the 16 authored refs incl. 4 from 08-multi.md; the broken one reported with correct line | PASS |
| 32 | t04 `see:02-authentication.md#Sessions` (no space) | §11 regex `/see:\s*(\S+?)(?:#(\S+))?/g` | parsed & resolved (QA-02 F10 FIXED-holds) | PASS |
| 33 | t04 `see 02-authentication.md#Sessions` (no colon) | §11 regex requires `see:` | parsed & resolved — lenience beyond documented regex | UNDOC (minor) |
| 34 | t04 forward in-span missing file (03-data.md → `see 05-frontend.md`, 05 deleted) | §12 broken ref error (QA-02 F2 forward half) | `✗ … broken ref … file not found`, exit 1 | PASS |
| 35 | t04 **backward** in-span missing file (10-span.md → `see 05-frontend.md`, 5 < 10, in-span) | §12 broken ref error; round-2 residual downgraded this to `⚠ unwritten spec slot` | **`✗ 10-span.md:2 — broken ref: see 05-frontend.md — file not found`**, exit 1 — no downgrade. The QA-02 F2 PARTIAL residual is **FIXED in the npm build** (false-success path from QA-09 E2 no longer reachable via this route) | PASS (prior residual resolved) |
| 36 | t11 `see:` in prose, `# heading`, fenced block | §11 non-bullet lines ignored | refs.total 1 (only the real bullet ref parsed) | PASS |
| 37 | t06 `<!-- ref-by: 09-gone.md -->` with referrer removed | §12 stale back-pointer | `back-pointers: 0/1 current` + `⚠ 03-stale.md:2 — stale back-pointer: 09-gone.md no longer refs 03-stale.md` + `remove the ref-by comment (or re-run cans check --fix)`; JSON backPointers{total:1,current:0,stale:1} | PASS |
| 38 | t06 `check --fix` (1 stale + 2 missing comments) | §22/§17: rewrite ref-by comments ONLY | md5: exactly 01-auth.md, 02-data.md, 03-stale.md changed; sources (00-overview.md, 04-extra.md) byte-identical; stale comment deleted, correct ones inserted as standalone line after target node; multi-referrer format `<!-- ref-by: 00-overview.md, 04-extra.md -->` per §12; node text untouched | PASS |
| 39 | t06 `check --fix --json` same run | §35 check-fix.json: post-fix state, `backPointersUpdated` >0 | `backPointers{3,3,0}`, `backPointersUpdated: 3`, ok/exitCode 0 (QA-02 F18 FIXED-holds: report shows POST-fix state) | PASS |
| 40 | t06/t01 second `check --fix` | §12 "rebuilt from scratch", idempotent | `backPointersUpdated: 0`, all md5 unchanged | PASS |
| 41 | t07 `check --fix` on init workspace with **0 refs** | §22 --fix scope | `backPointersUpdated: 0`, all files byte-identical (no-op) | PASS |
| 42 | t07 `check --strict` on 9-warnings/0-errors ws | §19 warnings escalate exit under --strict | exit 1; JSON `ok:false, exitCode:1, errorCount:0 (unchanged), warningCount:9`; human summary still `0 errors, 9 warnings.` — escalation is **exit-code-only** (counts/output unchanged; README's "warnings become errors" is not literal) | PASS §19 (+ DEVIATION D4 vs README wording) |
| 43 | t04 `check --refs-only` | §20/§22 flag scope | Structure/Style/Redundancy/Overflow sections omitted entirely; References + Rules printed; structure/style issues absent; counts 7 errors / 3 warnings (refs-only) (QA-06 #13 FIXED-holds) | PASS |
| 44 | t04 `check 04-api.md` | §22 `[file]` scope | per-file issues filtered to 04-api.md (other files' structure/style issues gone); refs issues remain graph-global (incl. other files' errors) and structure summary stays global (11 files/33 nodes); exit 1 | PASS (QA-02 9d behavior holds) |
| 45 | t04 `check 99-missing.md` | QA-02 F13 fix | `✗ no spec file matches "99-missing.md" — pass a spec filename like 04-api.md or run \`cans status\` to list files`, exit 1 | PASS |
| 46 | t04 `check --bogus` | §20 flags; QA-06 #4/M3 residual (round 2: silently swallowed, exit 0) | `✗ unknown flag "--bogus"` + `Run \`cans help\` for valid check flags.`, exit 1 — **round-2 MAJOR residual FIXED in npm build**; `check -x` → `✗ unknown flag "-x" — no short flags supported` | PASS (prior residual resolved) |
| 47 | t04 `check --bogus --json` | §19/§35 | envelope `ok:false, exitCode:1, error:"…"` + issue `{file:"", line:0, level:"error", category:"refs", message}` with zeroed stats; category `refs` for a CLI usage error; shape undocumented | UNDOC (N3) |
| 48 | t04 `check --fix=true` | §20 "`--flag value` only. No `--flag=value`" | `✗ invalid flag form "--fix=true" — use "--fix <value>"`, exit 1 | PASS |
| 49 | t04 `check --fix true` (space form on boolean) | §20 | `true` consumed as file arg → `✗ no spec file matches "true"`, exit 1 (no accidental fix) | UNDOC-benign |
| 50 | t08 folder-only (`02-authentication/index.md`, flat removed) | §8/§11 folder form resolves | 2 files counted; `see 02-authentication.md#Sessions` resolves (0 broken); issues carry folder paths with accurate lines | PASS |
| 51 | t09 BOTH `02-authentication.md` and `02-authentication/index.md` | §8/§11 "both existing = error" (QA-02 F1 fix) | `✗ 02-authentication.md — duplicate home: both 02-authentication.md and 02-authentication/index.md exist — flat wins, remove the folder` + `delete 02-authentication/index.md (or merge its content into 02-authentication.md)`, exit 1 | PASS |
| 52 | t09b flat (init template) + folder both exist, ref carries `#Sessions` | §11 "Flat wins" for resolution | anchor looked up in the **flat** file (template has `Sessions: TBD`) → `✗ broken anchor` even though folder variant has `Sessions` — consistent with flat-wins, no duplicate-home suppression (error still fired) | PASS w/ note |
| 53 | t10 tab-indented spec | §11 tabs rejected | `✗ 01-tabbed.md — parse error: 01-tabbed.md: tab indentation rejected (use 2 spaces)`, whole file dropped (0 files/0 nodes counted), exit 1; path still printed twice (QA-02 F14 residual) | PASS / STILL-BROKEN QA-02 F14 (minor) |
| 54 | t04 `check --refs-only --json` | §22 JSON contract | full contract retained; issues[] contains only refs-category entries | PASS |
| 55 | t11 spec file `chmod 000` → `check` | §19 exit 2 = internal error only | graceful `✗ 02-authentication.md — unreadable spec file: EACCES: permission denied…`, exit 1, no stack trace | UNDOC-benign |
| 56 | t08 `check 02-authentication/index.md` (folder path as file arg) | — | accepted, per-file scoping applied, exit 0 | UNDOC-benign |
| 57 | exit-code matrix across t01/t02/t04/t05/t07/t09/t10 | §19 | clean=0 · warnings-only=0 · errors=1 · --strict warnings=1 · flag/usage errors=1 · JSON `ok` ⇔ `exitCode 0` in every observed run | PASS |

## 4. Findings

No FAIL-severity violations of the documented contracts were found in this area on the npm binary. Four cosmetic DEVIATIONS, three carried-over STILL-BROKEN doc/impl gaps, and several minor undocumented behaviors follow.

**D1 · MINOR (cosmetic) · §36 clean-run summary lines lack the documented `✓` prefix.**
Docs §36 (and README "See it in action") show `✓ 6 files, 84 nodes, max depth 4`, `✓ 12 see: refs, 0 broken, 0 deep hops`, `✓ back-pointers: 12/12 current`. Actual clean run:
```
Structure
  4 files, 37 nodes, max depth 3
References
  3 see: refs, 0 broken, 0 deep hops
  back-pointers: 3/3 current
```
while Redundancy/Overflow/Rules lines DO print `✓`. Inconsistent between sections and vs docs. (Agent-parsing impact: none — same text otherwise.)

**D2 · MINOR (cosmetic) · deep-hop fix line lacks the `Fix:` prefix (§36).**
§36 example: `  Fix: add "see: 06-ops.md" directly to 05-frontend.md`. Actual continuation line: `    add "see: 06-operations.md#Data-protection" directly to 04-api.md`. JSON `suggestion` field matches docs text exactly.

**D3 · MINOR (cosmetic) · broken-ref message wording differs from §37 example.**
§37: `✗ Broken ref: 04-api.md:12 → 02-auth.md` / `File not found. Did you mean 02-authentication.md?`. Actual: `✗ 03-data.md:2 — broken ref: see 05-frontend.md — file not found` / `create 05-frontend.md or fix the ref target`. The §37 what/where/what-to-do philosophy is honored, but the fuzzy "Did you mean" hint does not exist.

**D4 · MINOR (doc) · README's "`cans check --strict` — warnings become errors" is not literal.**
Under `--strict` on a warnings-only workspace: exit 1 and `ok:false`, but `errorCount` stays 0, `warningCount` unchanged, human output identical (`0 errors, 9 warnings.`). §19's normative wording ("Warnings never affect exit code unless `--strict`") is satisfied exactly; only the README phrase overpromises. Agents relying on README semantics would misread strict output.

**F-A · STILL-BROKEN (minor, doc) · style/structure severity: docs show ✗, npm emits ⚠ (QA-02 F7).**
Reproduced on npm for all three cases: `7 siblings share prefix… Group under nested style.` (§14 example ✗), `"Returns" has 2 children. Collapse to sibling style.` (§14 ✗), `"Only" has exactly 1 child. Collapse.` (§15/§36 ✗) — all ⚠ warnings; style-only workspaces exit 0. Docs §14/§15/§36 remain unsynced (docs untouched since creation, per QA-02).

**F-B · STILL-BROKEN (minor) · style collapse requires an all-leaf sibling group (QA-02 F6).**
Reproduced on npm: t02 `03-depth.md` node `L5` (depth 5) with children `L6` (non-leaf) + `L6b` (leaf) → no style flag; §14 "parent with ≤3 leaf children" is only enforced when ALL children are leaves.

**F-C · STILL-BROKEN (minor) · parse-error line prints the path twice (QA-02 F14 remainder).**
`✗ 01-tabbed.md — parse error: 01-tabbed.md: tab indentation rejected (use 2 spaces)`. (`:0` is gone — the fixed half of F14 holds.)

**F4 · UNDOC (minor) · missing back-pointer comments are silently not counted (matrix #4).**
With N valid refs and no `ref-by` comments, check reports `back-pointers: 0/0 current`, no warning, exit 0. The §35 `check-clean.json` contract (backPointers total=current=refs.total=12) is therefore only reachable after a `--fix`. §12's "not authoritative" makes this defensible, but nothing documents that a never-fixed workspace looks fully clean.

**F5 · UNDOC (minor) · orphan check ignores self-references.**
A file whose only ref is a self-ref (11-selfref.md) gets both the self-reference error AND the orphan warning; per §12's literal wording it has an outgoing ref and should not be an orphan.

**N1 · UNDOC (additive) · check JSON carries extra key `rulesSummary`** (e.g. `"node_length: 3–120 | siblings: 1–12 | depth: 1–5"`) not present in §35 fixtures. Additive (QA-10 already flagged the additive `error` field); harmless to consumers parsing documented keys.

**N2 · UNDOC · `refs.broken` counts only file-not-found refs;** broken anchors, `_collab` errors and self-refs are separate issues not reflected in any `refs.*` counter (t04: refs.broken=4 while 7 total errors). §35 fixtures don't disambiguate; document or rename.

**N3 · UNDOC · usage-error JSON shape.** Flag errors emit a zeroed envelope (files/nodes/refs all 0) plus `error` field plus an issue with `file:"", line:0, category:"refs"` — `refs` is a mislabel for a CLI-usage error.

**N4 · UNDOC (minor, confirmed QA-02 NEW-2) · depth-0 parents are exempt from the style collapse rule** (t03 `Rootish` with 2 leaves unflagged; every depth-1 equivalent flags). §14 distinguishes no such case.

**N5 · UNDOC (minor) · `see X` (colon-less) is accepted** beyond §11's documented `see:` regex; combined with the documented unspaced `see:X` form there are three accepted spellings, only two of which are documented anywhere.

**N6 · benign UNDOC ·** unreadable spec file (chmod 000) → graceful `✗ … unreadable spec file: EACCES…`, exit 1 (no exit-2/stack trace, per §37 spirit); folder-path accepted as the `[file]` argument; `--fix true` consumes `true` as the file argument (no accidental write).

**Cosmetic observation:** singular not handled in the summary line — `1 errors, 3 warnings.` (t05).

## 5. What held up (incl. prior-finding status on the npm binary)

**Prior-round fixes re-confirmed FIXED on npm cans-spec@0.1.0 (14):**
QA-02 F1 (duplicate home error, exit 1) · F4 (deep-hop fixture clean, hyphen anchor normalization) · F5 (`force_sibling_below` ≤ semantics, 3 leaf children flag) · F8 (`maxDepth` 1-based) · F10 (`see:TARGET` unspaced parsed) · F11-adjacent (odd-indent warning not re-tested; out of scope) · F13 (file-arg validation, exit 1) · F16 (no single-child double-report) · F17 (`Rules (_rules.yaml)` section prints) · F18 (--fix reports post-fix state) · QA-06 #13 (`--refs-only` scope).

**Round-2 residuals now FIXED in the npm build (2) — npm is ahead of the round-2-verified source:**
- **QA-02 F2 residual (MAJOR in round 2):** backward in-span missing-file refs no longer downgrade to the undocumented `⚠ unwritten spec slot` — `10-span.md → see 05-frontend.md` (5 < 10, in-span) reports `✗ broken ref … file not found`, exit 1. The QA-09 E2 false-success flow (rm a mid-span spec → check exits 0 → done archives) is closed via this route on the npm binary.
- **QA-06 #4 residual M3 (MAJOR in round 2):** `check --bogus` / `check -x` no longer swallowed — `✗ unknown flag …`, exit 1. Equals-form `--fix=true` also rejected per §20.

**Core engine behavior that held up end-to-end:** structure thresholds byte-exact incl. the 120/121 boundary; per-node depth errors with 1-based `maxDepth`; sibling max warning; single-child collapse; style shared-prefix boundary (5 no / 6 yes) and collapse thresholds (2/3 flag, 4 no); refs resolution incl. case-insensitive anchors, file-level refs, self-ref, deep-hop chain text + suggestion, `_tasks` warning vs `_collab` error, orphan detection with 00-overview exemption, multi-`see:` lines; `--fix` strictly limited to `<!-- ref-by: … -->` comments (md5-verified), comma-list format per §12, idempotent (second run `backPointersUpdated: 0`), no-op on ref-less workspaces; stale back-pointer detection with correct JSON counters; `--refs-only` and single-file scoping; flat-vs-folder resolution, folder-only anchor matching, duplicate-home error; tab rejection; JSON §35 contract (plus N1) and exit codes (§19) consistent in every run. Engine order, report sections and the Rules section match §22/§36; a truly clean workspace (0 errors/0 warnings, exit 0, 3/3 back-pointers after one `--fix`) is straightforwardly authorable — no redundancy workarounds needed this round for my fixtures (fuzzy-typo noise from QA-02 F15 was visible only in its known forms, e.g. `sessions ↔ session`, and belongs to QA-13's area).

## 6. Verdict summary

- ~55 test cases (matrix rows 1–57, several multi-assert). **PASS 40 · PASS+DEVIATION 4 (D1–D4) · STILL-BROKEN 3 (F-A, F-B, F-C, all minor) · UNDOC 8 (F4, F5, N1–N6) · FAIL 0.**
- **No FAIL-severity findings.** The npm binary matches the documented check contracts (§8, §11, §12, §14, §15, §19, §20, §22, §35, §36) in every semantic dimension tested; residual gaps are cosmetic output deltas (D1–D3), a README wording overpromise (D4), and three known minor doc/impl gaps carried from rounds 1–2.
- **Highlights:** two round-2 MAJOR residuals (QA-02 F2 backward-in-span downgrade; QA-06 M3 check unknown-flag swallowing) are verified FIXED on the npm-published package; 11 further prior fixes re-confirmed.
- Reproduction: scratch workspaces preserved under /home/z/my-project/qa-playground-r3/qa12/t01…t12.
