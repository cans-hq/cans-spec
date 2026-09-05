# QA-13 — `cans check` engines II: Redundancy, Overflow, `_rules.yaml` Config (Round 3 — npm package)

Task ID: 5-c · Agent: QA-13 (general-purpose) · Target: npm `cans-spec@0.1.0`, global binary `/home/z/.npm-global/bin/cans` (`cans --version` → 0.1.0)
Date: 2026-09-05 · Env: Bun 1.3.14, Node v24.19.0, Linux · Round: 3 of blackbox QA (rounds 1–2 tested repo source; this round tests what npm users actually get)

Method: manual shell only, blackbox. All interaction via the installed `cans` binary; all fixtures written with heredocs into scratch workspaces under `/home/z/my-project/qa-playground-r3/qa13/` (red-ws, norm-ws, bnd-ws, case-ws, fuzz-ws, phrase-ws, l4-ws, l4b-ws, stop-ws, stop2-ws, ovf-ws, ovf2-ws, ovf3-ws, ovcfg-ws, cfg-ws, syn-ws, tbd-ws, bud-ws, len-ws). Repo source, node_modules, npm install dir and test/*.test.ts never read; docs + fixtures + prior reports used as spec of truth. No fixes applied. Disclosure: one intermediate `_rules.yaml` fixture edit used a python3 one-liner regex substitution (pure text transform, never used against the CLI); the same fixture was immediately rewritten via pure heredoc with identical content and every reported verdict re-observed on the heredoc version — no finding depends on it.

Docs contract used: architecture §13 (redundancy 4 layers), §16 (overflow), §17 (engine order), §18 (rules defaults + loading contract: missing = all defaults, partial = only listed keys override, delete a key = check turns off, invalid YAML = line number + exit 1), §19 (exit codes), §20 (CLI surface incl. `--no-redundancy`), §22 (check report sections/JSON), §26 (budget, config consumer), §34 (redundancy/overflow fixtures + expected output), §35/§36 (output fixtures), README "Delete a key to disable that check".

## Scope

- Redundancy Engine §13 — L1 word frequency (threshold, normalization: synonyms/stopwords/case/punctuation/see:-token exclusion), L2 phrase overlap (≥70% boundary, message format), L3 fuzzy (Levenshtein ≤2, >4 chars, synonym-matched suppression), L4 cross-file canonicality (depth 0–1, `see:` suppression).
- Overflow Engine §16 — code fences, tables, max_node_chars, force_file_for, inline exemptions, no-chaining rule for overflow targets.
- Rules System §18 — template vs defaults drift, loading contract (missing/partial/delete-key/invalid), user synonyms syntaxes, content (TBD) knobs.
- `--no-redundancy` flag (§20) incl. `--json` and `--strict` interplay (§19).
- token_budget as config consumer only (§26 default_limit flow into `budget read`) — budget semantics belong to QA-14.
- Round-1/2 settlement targets: QA-03 #1 (delete-key), QA-03/QA-07 #13+NEW-3 (user synonyms inert), QA-03 #10 (chaining), QA-07 NEW-1 (>50% heuristic).

## Test matrix

Verdicts: PASS / FAIL (impl violates doc) / DEVIATION (impl–doc mismatch in behavior detail) / UNDOCUMENTED. 63 recorded checks: **PASS 53 · FAIL 9 · DEVIATION 1 · UNDOC 0** (rows may combine into findings F1–F6 below).

### A. Redundancy engine (§13, §34; ws: red-ws, bnd-ws, norm-ws, case-ws, fuzz-ws, phrase-ws, l4-ws, l4b-ws, stop-ws)

| # | Command / fixture | Expected (doc §) | Actual (verbatim) | Verdict |
|---|---|---|---|---|
| 1 | `cans check` in red-ws (redundancy-project fixture) | "authentication" × 6 nodes (threshold: 4) warning (§34) | `⚠ 02-authentication.md:1 — "auth" × 6 nodes (threshold: 4)` + suggestion | PASS (count/threshold/level) |
| 2 | same, message text vs §34 fixture | names "authentication" | names synonym-group head **"auth"** | DEVIATION (F5) |
| 3 | same | exit 0; warnings never affect exit (§19) | `0 errors, 1 warnings.`, EXIT=0 | PASS |
| 4 | `cans check --json` | Issue fields file/line/level/category/message/suggestion, category redundancy (§22/§35) | all present; `"category": "redundancy"`, level warning, suggestion present | PASS |
| 5 | "cache" in exactly 3 of 4 nodes (bnd-ws) | < threshold 4 → no flag (§13) | `Redundancy ✓ no redundancy detected` | PASS |
| 6 | "cache" in exactly 4 of 5 nodes | ≥ 4 → flag (§13) | `⚠ "cache" × 4 nodes (threshold: 4)` | PASS |
| 7 | postgres/pg/postgresql spread over 4 nodes (norm-ws) | synonym expansion → one concept ×4 (§13) | `⚠ "postgres" × 4 nodes (threshold: 4)` | PASS |
| 8 | "the" ×5, "must" ×4, shall/requires present (stop2-ws) | stopwords filtered, never flagged (§13) | `✓ no redundancy detected` | PASS |
| 9 | CACHE / "Cache," / "cache!" / root "Cache" (case-ws) | case+punctuation-insensitive normalization (§13) | `⚠ "cache" × 4 nodes (threshold: 4)` | PASS |
| 10 | nodes made of `see: 02-authentication.md#Sessions` etc. — "see"/"md" tokens (norm-ws 04-refs.md; "md" ×4) | ref tokens not counted (round-1 fix claim) | no "see"/"md" frequency warnings (only refs-engine ballast) | PASS |
| 11 | pair sharing 5/6 tokens → 83% (phrase-ws) | ≥70% → `N% overlap: f:l ↔ f:l` (§13) | `⚠ 01-payments.md:2 — 83% overlap: 01-payments.md:2 ↔ 01-payments.md:3` | PASS |
| 12 | 10-token pair sharing exactly 7 → 70.0% (phrase-ws 03-nonce.md) | "≥ 70%" fires (§13; round-1 boundary fix) | `⚠ 03-nonce.md:2 — 70% overlap: 03-nonce.md:2 ↔ 03-nonce.md:3` | PASS |
| 13 | clearly different bullets (phrase-ws 02-misc.md) | no flag | no phrase warning | PASS |
| 14 | "autentication" ↔ "authentication" (lev 1) (fuzz-ws) | possible-typo warning, lev ≤2 >4 chars (§13 L3) | `⚠ possible typo: "autentication" (01-security.md:2) ↔ "authentication" (01-security.md:3) — Levenshtein 1` | PASS |
| 15 | "pasword" ↔ "passwords" (lev 2) | same | `⚠ possible typo: "pasword" … ↔ "passwords" … — Levenshtein 2` | PASS |
| 16 | postgres ↔ postgresql, same synonym group active (norm-ws) | no fuzzy double-fire for synonym-matched words (§13 L3; round-1 F8 fix) | no postgres↔postgresql typo line (grep typo → only records↔seconds, timeouts↔timeout) | PASS |
| 17 | root "- Deploy" in 2 files, no see: (l4-ws) | L4 flag at depth 0–1, threshold 2 (§13) | `⚠ 01-deploy.md:1 — "deploy" at depth 0-1 in 2+ files without see: (01-deploy.md, 02-deploy.md)` | PASS |
| 18 | same concept as depth-1 child in 2 files (l4b-ws) | same | `⚠ 01-a.md:2 — "deploy" at depth 0-1 in 2+ files without see: (01-a.md, 02-b.md)` | PASS |
| 19 | add `see 01-deploy.md` to 02-deploy.md | L4 suppressed when see: present (§13) | L4 line gone (100% phrase overlap remains — separate layer) | PASS |
| 20 | "zulu" ×4 of 8 nodes (exactly 50%), default threshold 4 (stop-ws) | fires at ≥4 if purely count-based (round-2 NEW-1 claimed a >50% node-share heuristic) | `⚠ "zulu" × 4 nodes (threshold: 4)` — **no node-share heuristic on npm** | PASS (NEW-1 closed) |

### B. Overflow engine (§16; ws: ovf-ws, ovf2-ws, ovf3-ws, len-ws, ovcfg-ws)

| # | Command / fixture | Expected (doc §) | Actual (verbatim) | Verdict |
|---|---|---|---|---|
| 21 | overflow-project fixture (JSON-fence target + table target + parent see:) | targets not flagged; main outline clean (§16 pattern) | `Overflow ✓ no code blocks, tables, or oversized nodes` | PASS |
| 22 | node containing ```json fence (ovf2-ws) | flag + extract advice (§16) | `✗ 01-integration.md:2 — code fence detected — extract to file and reference via see:` | PASS |
| 23 | node containing markdown table | flag (§16) | `✗ 01-integration.md:11 — table detected — extract to file and reference via see:` | PASS |
| 24 | 280-char node | overflow flags >200 distinct from structure >120; both may fire | `✗ :16 — node exceeds max chars (280 > 200)` (category overflow) AND structure `✗ Node too long (280 > 120). Split or move to file.` | PASS |
| 25 | inline `` `POST /users` ``, `timeout=30s`, `Retention: 30 days`, `Draft → Tested → Approved` | not flagged (§16 exemptions) | none flagged | PASS |
| 26 | node text exactly 200 vs 201 chars (len-ws) | 200 not > 200; 201 flags (§16/§18) | 200 → clean; 201 → `✗ node exceeds max chars (201 > 200)` | PASS |
| 27 | `check --json` on ovf2-ws | overflow issues carry category/level (§35) | `"category": "overflow"`, `"level": "error"`, message verbatim | PASS |
| 28 | `overflow.max_node_chars: 50` (full file) | override flows (§18) | `✗ node exceeds max chars (280 > 50)` | PASS |
| 29 | `overflow.force_file_for: [table]` (full file) | fence no longer flagged, table still flagged (round-1 F6 fix) | fence silent, `table detected` fires | PASS |
| 30 | delete whole `overflow:` section (full defaults otherwise) | overflow off, other engines unaffected (§18) | `Overflow ✓ no code blocks, tables, or oversized nodes`; structure still errors 280 > 120 | PASS |
| 31 | overflow target `04-api/request-schema.md` containing its own `see:` (chain to parent + to 99-nonexistent.md) | "Overflow target files must NOT contain their own see: refs (no chaining)" (§16) | **nothing flagged anywhere, exit 0**; target's refs not counted at all (`1 see: refs` = parent's only; broken ref inside target invisible) | **FAIL (F3)** — STILL-BROKEN (QA-03 #10) |

### C. Rules defaults & template (§18; ws: red-ws init scaffold, cfg-ws)

| # | Command / fixture | Expected (doc §) | Actual | Verdict |
|---|---|---|---|---|
| 32 | diff `cans init` scaffold vs templates/_rules.yaml vs §18 default block | scaffold == template == §18 defaults (all 7 sections) | **byte-identical** to templates/_rules.yaml; field-by-field equal to §18 (node_length 3–120, siblings 1–12, depth 1–5, single_child_collapse true, empty_nodes false; style prefer sibling/6/3/shared_prefix true; content tbd_allowed true, max_tbd_per_file 5; references pointer/true/1/true/true; redundancy enabled/4/0.7/2/stopwords/5 groups; token_budget enabled/4096/3.5/0.8; overflow 200/[code_block, table, diagram]) | PASS (no drift) |
| 33 | `cans check` report | fixed section order incl. `Rules (_rules.yaml)` echo (§22/§36) | Structure → Style → References → Redundancy → Overflow → Rules → Summary in every run | PASS |
| 34 | no `_rules.yaml` (bnd-ws/norm-ws/etc.) | missing file = all defaults (§18) | `✗ Node too long (199 > 120)`, `⚠ "cache" × 4 (threshold: 4)`, overflow 200 boundary — defaults observed | PASS |
| 35 | `_rules.yaml` = `bogus_key: 42` only | unknown keys tolerated, defaults apply (§18; round-1 row 39 PASS) | Rules echo `✓ node_length: off | siblings: off | depth: off`; **all checks off, exit 0** | **FAIL (F1)** |
| 36 | empty `_rules.yaml` (0 bytes) + 187-char node | empty = degenerate partial → defaults (§18; round-1 row 31 PASS) | **no structure error, 0 issues, exit 0** — all checks off (same content without file: `Node too long (199 > 120)` fires) | **FAIL (F1)** |

### D. Config semantics — partial override & delete-key (§18; ws: cfg-ws)

| # | Command / fixture | Expected (doc §) | Actual | Verdict |
|---|---|---|---|---|
| 37 | partial: `redundancy: { word_frequency_threshold: 2 }` only; word ×4/4 nodes | threshold override fires; everything else unchanged (§18 "Partial file = only listed keys override") | **no flag at all** (key inert) AND Rules echo `node_length: off | siblings: off | depth: off`, structure/overflow silent — **every unlisted check disabled** | **FAIL (F1, MAJOR)** |
| 38 | partial: `structure: { node_length: { min: 3, max: 200 } }` only; 149-char node | node_length override applies; siblings/depth stay default (§18) | echo `node_length: 3–200 | siblings: off | depth: off`; siblings/depth checks dead | **FAIL (F1)** |
| 39 | partial: `redundancy: { enabled: true }` only; word ×4/4 | engine on, layers keep default thresholds (§18) | `✓ no redundancy detected` — frequency layer dead (its threshold key absent) | **FAIL (F1)** |
| 40 | FULL defaults file with only `word_frequency_threshold: 2`; word ×4/4 | fires at threshold 2 (isolates partial-merge from key reading) | `⚠ "webhooks" × 4 nodes (threshold: 2)` | PASS |
| 41 | FULL defaults **minus `redundancy:` section**; word ×4/5 | delete section ⇒ redundancy off, rest on (§18; README) | `Redundancy ✓ no redundancy detected`; structure/refs/overflow still default — **round-2 "delete-key still unimplemented" does NOT reproduce on npm** | PASS (headline settled: FIXED) |
| 42 | FULL defaults minus `overflow:` section | overflow off (§18) | `Overflow ✓ no code blocks, tables, or oversized nodes` with fence/table/280-node present | PASS |
| 43 | structure section with `node_length` key deleted (siblings/depth/booleans listed) | length checks off, siblings/depth still on (§18) | echo `node_length: off | siblings: 1–12 | depth: 1–5`; 186-char node unflagged; `✗ Depth 6 exceeds max 5` still fires; single-child collapse still fires | PASS |
| 44 | overflow section listed with `max_node_chars` but no `force_file_for` | delete sub-key ⇒ that detection off (§18) | fence AND table both unflagged (list-empty) while max-chars still enforced | PASS |
| 45 | invalid YAML: unclosed inline array on line 5 | `✗ invalid _rules.yaml: line 5 …`, exit 1 (§18) | `✗ invalid _rules.yaml: line 5: unbalanced inline array: [the, unclosed`, EXIT=1 | PASS |
| 46 | invalid YAML: `structure: 42` | line number, exit 1 (§18; round-1 F2 fix) | `✗ invalid _rules.yaml: line 1 — "structure" must be a mapping, got number`, EXIT=1 | PASS |
| 47 | invalid YAML: tab indentation line 2 | line number, exit 1 | `✗ invalid _rules.yaml: line 2: tab indentation (use 2 spaces)`, EXIT=1 | PASS |
| 48 | invalid YAML under `check --json` | §19/§35 envelope, exit 1 | `ok:false`, `exitCode:1`, top-level `error` + issue with the line-numbered message (issue `file:""`, `line:0`, **category "refs"** for a config error) | PASS (cosmetic → F6) |
| 49 | `cans budget read sessions` with invalid `_rules.yaml` | config contract holds across commands (§18/§26) | `✗ invalid _rules.yaml: line 2: unbalanced inline array: [4096`, EXIT=1 | PASS |

### E. User-configured synonyms (§18; ws: syn-ws) — settles round-2 "user synonyms silently inert"

| # | Command / fixture | Expected (doc §) | Actual | Verdict |
|---|---|---|---|---|
| 50 | FULL defaults + appended group `- [vehicle, car]` (template syntax); 4 nodes mixing car/vehicle | user group merges car↔vehicle → `"vehicle" × 4` | `⚠ 01-fleet.md:2 — "vehicle" × 4 nodes (threshold: 4)` — **user synonyms WORK in template syntax** | PASS (round-2 claim does NOT reproduce here) |
| 51 | `synonyms:` containing ONLY `- [vehicle, car]` | user list semantics (merge vs replace — undocumented) | group works; **built-in groups gone**: postgres/pg/postgresql no longer merge (no ×4) and fuzzy `possible typo: "postgres" ↔ "postgresql" — Levenshtein 2` fires again | PASS + UNDOC note (replace-not-merge) |
| 52 | nested inline array `synonyms: [[vehicle, car]]` | supported? (§18 inline arrays) | works — `"vehicle" × 4` fires | PASS |
| 53 | inline-object form `synonyms: { vehicle: [car, auto] }` | §18 documents inline objects as supported syntax | **`stderr: ✗ Internal error: {} is not iterable`, EXIT=2 — crash** | **FAIL (F2, MAJOR)** |
| 54 | nested block array `- - vehicle` / `- car` | §18 mini-parser (round-1 F13: must fail loud) | `✗ invalid _rules.yaml: line 29: unexpected indentation`, EXIT=1 | PASS |

### F. TBD / content rules (§18 content; ws: tbd-ws)

| # | Command / fixture | Expected (doc §) | Actual | Verdict |
|---|---|---|---|---|
| 55 | 5 TBD nodes, defaults | ≤ max_tbd_per_file 5 → no finding | clean (only orphan/refs ballast) | PASS |
| 56 | 6 TBD nodes, defaults | >5 per file → reported (§18) | **NO content/TBD finding**; only redundancy noise `⚠ "tbd" × 6 nodes (threshold: 4)` | **FAIL (F4)** |
| 57 | `content: { tbd_allowed: false, max_tbd_per_file: 2 }` (partial file) + 6 TBDs | knobs enforce (§18) | zero effect (no content-category issue ever; grep tbd/content in --json → none). NB: as a *partial* file it also switched every other check off (F1) | **FAIL (F4)** |

### G. `--no-redundancy` + exit codes (§20, §19; ws: red-ws)

| # | Command | Expected (doc §) | Actual | Verdict |
|---|---|---|---|---|
| 58 | `cans check --no-redundancy` on fixture with ×6 finding | redundancy suppressed, other engines still run (§20) | `Redundancy ✓ no redundancy detected`; Structure/References/Overflow/Rules sections all present; `0 errors, 0 warnings.` EXIT=0 | PASS |
| 59 | `check --no-redundancy --json` | JSON reflects suppression (§22) | `issues: []`, errorCount 0, ok true | PASS |
| 60 | `check --strict` (warning present) | warnings ⇒ exit 1 under strict (§19) | EXIT=1 | PASS |
| 61 | `check --strict --no-redundancy` | clean run ⇒ exit 0 | EXIT=0 | PASS |

### H. token_budget as config consumer (§26/§18; ws: bud-ws)

| # | Command | Expected (doc §) | Actual | Verdict |
|---|---|---|---|---|
| 62 | `cans budget read sessions`, no `_rules.yaml` | default_limit 4096 (§26/§18) | `Budget: 81 / 4096 tokens (2%)`, EXIT=0 | PASS |
| 63 | same with full `_rules.yaml`, `token_budget.default_limit: 500` | config flows to budget (§18/§26) | `Budget: 81 / 500 tokens (16.2%)` | PASS |

## Findings

1. **MAJOR — `_rules.yaml` "partial file = only listed keys override" is not implemented on npm 0.1.0: every key/section not explicitly listed is silently DISABLED, and even the listed override can be inert when its section is incomplete.** (rows 35–39; new on npm — round 1 QA-03 rows 31/32/39 passed these exact cases on repo source.)
   Repro A (single override kills everything): workspace with a word in 4/4 nodes; `cans/_rules.yaml` containing only
   ```yaml
   redundancy:
     word_frequency_threshold: 2
   ```
   → `cans check` prints `Redundancy ✓ no redundancy detected`, Rules echo `✓ node_length: off | siblings: off | depth: off`, structure/overflow silent, **exit 0**. Neither the override nor any default check runs.
   Repro B (empty file): zero-byte `_rules.yaml` + 187-char node → 0 issues, exit 0 (no rules file: `✗ Node too long (199 > 120)`).
   Repro C (typo'd file): `bogus_key: 42` → all checks off, green output, exit 0 — a typo in any rules key mass-disables validation with a false-clean pass.
   Characterization: with the FULL template (or a fully-enumerated file) every override works (row 40: threshold 2 fires), so the mini-parser reads keys fine — it simply never merges defaults for a present file. "Delete a key = check turns off" is implemented *so* universally that it swallows the "partial file" half of §18. Consequence for npm users: tuning one knob silently turns off every other check with a green report — false-clean validation risk. Practical mitigation today: always ship the complete scaffolded `_rules.yaml`.
2. **MAJOR — inline-object synonyms crash with an internal error, exit 2 (§18/§19/§37).** (row 53)
   Repro: full `_rules.yaml` with `synonyms: { vehicle: [car, auto] }` → `stderr: ✗ Internal error: {} is not iterable`, exit 2. §18 lists "inline objects `{min: 3, max: 120}`" as supported mini-parser syntax; §19 reserves exit 2 for internal unexpected errors; §37 forbids internal-error leakage for user input errors. Other synonym syntaxes behave: template block-of-inline (works), nested inline `[[a, b]]` (works), nested block `- - a` (loud `invalid _rules.yaml: line 29`, exit 1).
3. **MINOR — §16 no-chaining rule still unenforced; overflow-target files are invisible to the refs engine. STILL-BROKEN (reproduces QA-03 #10; round 2 was PARTIAL).** (row 31)
   Repro: `cans/04-api.md` → `see 04-api/request-schema.md`; `cans/04-api/request-schema.md` contains a JSON fence + `see 04-api.md` + `see 99-nonexistent.md` → check exits 0, no chaining error, refs total stays `1 see: refs` (target's own refs not even counted; the broken ref inside the target is silent). §16: "Overflow target files must NOT contain their own see: refs (no chaining)."
4. **MINOR — §18 `content` rules are inert: no TBD findings, ever.** (rows 55–57)
   Repro: 6 TBD nodes with defaults → no content finding; the only signal is redundancy noise `⚠ "tbd" × 6 nodes (threshold: 4)`. `tbd_allowed: false` / `max_tbd_per_file: 2` produce zero behavioral change. Note: §17's engine list (structure/style/refs/redundancy/overflow) contains no content engine either — doc-internal gap (§18 defines knobs §17 never runs). Either implement the content check or drop the section; also consider exempting "tbd" from word-frequency per README principle 4 ("TBD is valid, first-class").
5. **DEVIATION (minor) — L1 warning text uses the synonym-group head instead of the surface word (§34).** (rows 1–2)
   `⚠ 02-authentication.md:1 — "auth" × 6 nodes (threshold: 4)` vs §34's `"authentication" × 6 nodes`. Count, threshold, level, suggestion and exit code all conform; agents matching on the documented fixture string will not match.
6. **COSMETIC — config errors under `check --json` are filed as category "refs" with empty file/line 0** although the message itself carries the correct line number (row 48). A dedicated `rules`/`config` category would be more truthful.

### Round-1/2 settlement (definitive, on npm cans-spec@0.1.0)

- **§18 "delete a key = check turns off": FIXED on npm.** Whole-section deletion (rows 41–42), single-key deletion (rows 43–44) and sub-list deletion (row 44) all disable exactly that check. The round-2 STILL-BROKEN claim (QA-03 #1 / QA-07 cc QA-09 E8) does NOT reproduce — in fact the mechanism now over-applies and also implements the (wrong) partial-file behavior of F1.
- **"User redundancy.synonyms silently inert": FIXED for the documented/template syntax on npm.** Template `- [vehicle, car]` groups fire (row 50); nested inline works (row 52); nested block fails loud per round-1 fix (row 54). The round-2 claim reproduces only in the degenerate sense that *partial files* disable redundancy entirely (F1) — any full-file synonym config works. New surface: inline-object form crashes (F2). Semantics note: a user `synonyms:` list REPLACES the built-in groups rather than merging (row 51) — undocumented.
- **QA-07 NEW-1 (undocumented >50% node-share heuristic): NOT reproducible on npm.** A word in exactly 4/8 nodes (50%) fires at default threshold 4 (row 20); word-frequency is pure count ≥ threshold.
- **QA-03 F2 (malformed config crashes exit 2): fix holds on npm** — typed line-numbered errors, exit 1 (rows 45–47, 49).

## What held up

- **Redundancy engine is solid end-to-end on npm**: exact ×N/threshold messages; 3-vs-4 boundary exact; built-in synonym expansion (postgres/pg/postgresql → one concept); stopword filtering at scale ("the" ×5, "must" ×4 silent); case/punctuation-insensitive normalization; see:/filename token exclusion (round-1 fix confirmed); phrase overlap with correct format and ≥0.7 boundary (exactly-70% pair fires); fuzzy layer lev ≤2 with synonym-matched suppression; L4 at depth 0 and 1 with `see:` suppression.
- **Overflow engine conforms to §16**: fence/table/max-chars detection with §16 advice text; inline-code/key-value/arrow exemptions; exact 200/201 boundary; `force_file_for` drives detection (round-1 fix holds); `max_node_chars` override flows; JSON category/level verbatim; structure-120 vs overflow-200 fire independently with distinct messages.
- **Config error paths**: invalid YAML (unclosed array / wrong type / tabs) → line-numbered message + exit 1 in both human and JSON modes, and `budget read` enforces the same contract.
- **Scaffolded config has zero drift**: `cans init` writes `_rules.yaml` byte-identical to templates/_rules.yaml and to §18's default block, field by field.
- **`--no-redundancy`**: suppresses only redundancy, other engines and JSON contract intact, `--strict` interplay correct (exit 1 ↔ 0).
- **token_budget config flows**: `default_limit: 500` changes `budget read` output to `81 / 500 tokens (16.2%)`.
- No blockers in the engines themselves; every FAIL is in the config/loader layer (F1, F2, F4) or an unenforced doc rule (F3).

## Verdict summary

- 63 recorded checks across 19 scratch workspaces: **PASS 53 · FAIL 9 · DEVIATION 1 · UNDOC 0**, consolidated into 6 findings: **2 MAJOR (F1 partial-config mass-disabling, F2 inline-object synonyms crash), 2 MINOR FAIL (F3 chaining STILL-BROKEN, F4 content rules inert), 1 minor DEVIATION (F5 message wording), 1 COSMETIC (F6)**.
- Headline settlements: §18 delete-key = check off → **FIXED on npm** (round-2 claim does not reproduce); user synonyms inert → **FIXED for documented syntaxes** (round-2 claim does not reproduce; new crash surface F2); QA-07 NEW-1 heuristic → **not reproducible**; QA-03 #10 chaining → **STILL-BROKEN on npm**.
- Top risk: F1 — any incomplete `_rules.yaml` silently disables every unlisted check with a green, exit-0 report. For npm users the only safe configs today are the untouched scaffold, a fully-enumerated file, or no file at all.
- Repo untouched; all testing in /home/z/my-project/qa-playground-r3/qa13/ (workspaces preserved as reproducers).
