# QA-14 — Interop & Token Budget: `cans import` / `cans export` / `cans budget` (Round 3, npm package)

- Task ID: 5-d | Agent: QA-14 (general-purpose) | Round: 3 of blackbox QA
- Target: **npm-published package only** — `cans-spec@0.1.0` installed globally, invoked as `/home/z/.npm-global/bin/cans` (from npmjs.com/package/cans-spec)
- Date: 2026-09-05 | Env: Bun 1.3.14, Node v24.19.0, Linux sandbox | `cans --version` → 0.1.0
- Method: manual blackbox shell only (no scripts/harnesses); scratch under `/home/z/my-project/qa-playground-r3/qa14/` (ws1–ws7, ws2b/2c, ws3b, exp1/exp2, rt1/rt2/rt3, bud/bud2–bud5, nows, customout, fixtures/). Repo untouched. Allowed reading only: README, docs/cans.architecture.md (§20, §26–§28, §31–§32, §34–§37), test/fixtures (copied as inputs), prior reports QA-05/07/08/09/10. Never read src/, node_modules/, test/*.test.ts.
- Angle: rounds 1–2 tested repo source; this round tests what npm users actually get, with emphasis on settling round-2 still-open items in my area (§26–§28, §35).

## Scope & docs covered

- §26 `cans budget` (read/write/--change, scoring 100/80/60/40/20/0, token estimate, §35 JSON shapes)
- §27 `cans import` (formats, merge strategies, import rules), §28 `cans export` (transformation table, rules), §20 (flags, arg parsing), §31 (converter internals), §32 (fs discovery), §34–§35 (fixtures incl. import.json/export.json/budget-*.json), §37 (error philosophy)
- Fixtures used as inputs only: `import-fixtures/{dynalist-export.opml,logseq-page.md,obsidian-note.md}`, `budget-project/*.md`

## Test matrix

Verdicts: PASS / FAIL / DEVIATION / UNDOC. All exit codes observed. ≈64 checks.

### Import — opml/dynalist/logseq/obsidian

| # | Command (cwd) | Expected (doc §) | Actual | Verdict |
|---|---|---|---|---|
| 1 | `import opml ../fixtures/dynalist-export.opml` (ws1, full init) | §27 preserve hierarchy | Merged into scaffold `02-authentication.md`: Authentication→Sign up→Email/Google, Authentication→Sessions→Expire after 24 hours, Dashboard→Requires verified account — hierarchy exact; `~ 02-authentication.md (merged)`; exit 0. Multi-root OPML still collapses into one file (cc QA-05 #10) | PASS |
| 2 | same `--json` | §35 import.json `{ok,command,exitCode,format,source,newFiles,merged,conflicts}` | Exact key-for-key match (`newFiles:[], merged:["02-authentication.md"], conflicts:[]`) | PASS |
| 3 | same into `init --bare` ws (ws1b) | new file created | `cans/07-authentication.md`, tree byte-exact; `newFiles:["07-authentication.md"]`. Note: allocator picked **07** in a ws containing only `00-overview.md` (see F8) | PASS |
| 4 | `import dynalist <same file>` (ws1c) | §27 dynalist = alias of opml | `format:"dynalist"`; `diff` vs ws1b file → IDENTICAL | PASS |
| 5 | `import logseq ../fixtures/logseq-page.md` (ws2) | §31: TODO/DONE→checkboxes, strip `key:: value` lines + `((block-refs))`, `[[wiki-links]]`→`see:` | `- [ ] Implement auth flow` ✓, `- [x] Add Google OAuth` ✓, standalone `agent-1:: assigned` + `id:: ((block-ref-123))` stripped ✓, `- see: 02-authentication.md#Sessions expire after 24 hours` (trailing text glued on the line — cosmetic; anchor parses) | PASS |
| 6 | `check` after #5 + hand-made `02-authentication.md` | ref resolves | `1 see: refs, 0 broken` — `#Sessions` anchor matches node "Sessions" | PASS |
| 7 | `import obsidian ../fixtures/obsidian-note.md` (ws3) | §31: strip frontmatter/tags, wikilinks+embeds→see:, keep checkboxes | frontmatter+tags gone ✓; `[[02-authentication#Sessions|Session rules]]`→`see: 02-authentication.md#Sessions` ✓ (alias dropped); `![[error-codes]]`→`see: error-codes.md` ✓ **(embed now gets `.md` — QA-08 E7 FIXED on npm)**; `- [ ] Implement rate limiting` kept ✓ | PASS |
| 8 | callout in fixture | §31 "Handles callout markers" | `> [!note] Decision` + `> Use token bucket algorithm` → nodes `Decision` → `Use token bucket algorithm` — **callouts no longer dropped: QA-05 F4 / QA-08 E9 FIXED on npm** | PASS |
| 9 | obsidian md with fenced block + post-fence bullet + callout (ws3/fence-note.md) | §27 "Extract code blocks → overflow files" | fence extracted to `cans/fence-note/request-schema.json`; node became `Request schema: see fence-note/request-schema.json` (ref resolves in `check`); `- normal child after fence` AND callout `- Careful → Rate limits apply` all preserved — **QA-05 F5 / QA-08 E9 post-fence data loss FIXED on npm**; naming wart → F8 | PASS (UNDOC naming) |
| 10 | `import OPML …` (uppercase, ws2b) | QA-05 F17 | case-insensitive, `format:"opml"`, exit 0 | PASS |
| 11 | `import opml garbage.opml` | §37 reject non-XML | `✗ invalid OPML in garbage.opml — invalid OPML: missing <opml> root element (not XML)`, exit 1 | PASS |
| 12 | `<outline text="Auth" _note="details here"/>` fresh ws (ws6) | §31 `_note` handled | child node `- details here` created under `- Auth` | PASS |
| 13 | same `_note` opml re-imported over an existing `Auth` node (ws2b) | §27 cans-wins adds new nodes | `merged:["08-auth.md"]` but file UNCHANGED — `details here` not added, no conflict reported (create path honors `_note`, merge path drops it) | **FAIL (F5, minor)** |
| 14 | inline `#urgent #security` tags (obsidian) | §31 strip `#tags` | stripped cleanly | PASS |

### Merge strategies (§27)

| # | Command | Expected | Actual | Verdict |
|---|---|---|---|---|
| 15 | import → sed `Expire after 24 hours`→`Expire after 48 hours` → re-import (default) (ws4b) | §27 cans-wins keeps CANS node; §35 conflicts[] | `conflicts:[{file:"07-authentication.md",line:6,cansVersion:"Expire after 48 hours",importVersion:"Expire after 24 hours",resolution:"cans-wins"}]`; CANS text kept in place, no duplicate, no wrong-parent append — **round-1 BLOCKER QA-05 F8 fix HOLDS on npm** | PASS |
| 16 | same but heavily divergent edit (`Sessions expire after 24h`, then `Renamed by human entirely`) (ws4) | conflict reported per §35 | conflicting node **appended as a NEW sibling** under "Sessions"; `conflicts:[]`; exit 0 — no wrong-parent corruption (round-1 bug gone) but a real conflict silently degrades to "new node" (similarity heuristic, undocumented) | **DEVIATION (F2, minor)** |
| 17 | `--merge-strategy import-wins` with conflict (ws4c) | overwrites on conflict | line 6 now `Expire after 24 hours` ✓; conflicts[] populated with `resolution:"import-wins"` | PASS |
| 18 | `--merge-strategy ask` with conflict (ws4d) | "report conflicts, don't merge" | human: `  ! 07-authentication.md:6 ask`; JSON `conflicts[0].resolution:"ask"`; file byte-unchanged (diff-verified) — **QA-05 F9 residual / QA-09 D12 (`ask` reports nothing) FIXED on npm** | PASS |
| 19 | `--merge-strategy banana` | §37 rejection | `✗ unknown merge strategy "banana" — valid: cans-wins, import-wins, ask`, exit 1 | PASS |
| 20 | `--merge-strategy=ask` (equals form, ws4d) | §20 "no `--flag=value`"; round 2: budget/init reject equals-form | **silently accepted, behaves as default cans-wins** (output `! …:6 cans-wins`, merge performed, exit 0) — QA-06 #4 residual STILL-BROKEN for import | **FAIL (F3, minor)** |
| 21 | `--merge-strategy=banana` (ws4d) | §37 rejection | silently accepted as cans-wins, exit 0 | **FAIL (F3)** |

### Import flags & errors (§20/§27/§37)

| # | Command | Expected | Actual | Verdict |
|---|---|---|---|---|
| 22 | `import opml … --dry-run` (ws5) | nothing written; preview | `[dry-run] Would import opml from … No files written.` + `+ 07-authentication.md`; JSON adds `"dryRun": true`; md5sum before/after identical, no file created | PASS |
| 23 | `import opml … --out ../customout` (ws5) | §20/README `--out <path>` | file written ONLY to `../customout/07-authentication.md`; `cans/` untouched (ls verified) — QA-05 F11 fix HOLDS | PASS |
| 24 | `import opml ../fixtures/nope.opml` | §37 error naming cause | `✗ source not found: ../fixtures/nope.opml / Check the path and try again.` exit 1; JSON carries `"error": …` | PASS |
| 25 | `cans import roam …` | §37 + valid formats | `✗ unknown format "roam" — valid formats: opml, dynalist, logseq, obsidian`, exit 1 | PASS |
| 26 | `cans import opml` / `cans import` (missing args) | usage | `✗ usage: cans import <format> <path> / Formats: …`, exit 1 | PASS |
| 27 | import in dir without `cans/` (nows) | documented behaviour | `✗ no cans workspace found — run \`cans init\` first, or pass --out <dir>` exit 1; and `--out ./extracted` outside a workspace genuinely works (imports to `extracted/07-authentication.md`) — coherent, but undocumented | PASS / UNDOC (F8-adjacent) |

### Export transformations (§28 table)

Workspace exp1: `02-authentication.md` (Sessions subtree), `04-api.md` (`Session rules: see 02-authentication.md#Sessions`), `06-operations.md` (second back-ref), `_tasks/sessions-tuning.md` (`- [ ] Tune session TTL ← agent-1`, `- [x] Document refresh flow ← agent-1`, `- [ ] Spec approved ← @human`).

| # | Command | Expected | Actual | Verdict |
|---|---|---|---|---|
| 28 | `export opml` (+ `--include-tasks`) | §28 row 1: `see:`→`→ X.md#Y`; owners `[agent-1]`; `⏳ Human`; checkboxes preserved; indentation | `text="Session rules: → 02-authentication.md#Sessions"` ✓; `text="[ ] Tune session TTL [agent-1]"` / `text="[x] Document refresh flow [agent-1]"` ✓; `text="[ ] Spec approved ⏳ Human"` ✓; nesting exact | PASS |
| 29 | `export dynalist` | same column as opml | `diff cans-export/dynalist/04-api.opml cans-export/opml/04-api.opml` → identical | PASS |
| 30 | `export logseq --include-tasks` | §28 row 2: `[[X/Y]]`, `agent-1:: assigned`, `TODO/DONE`, `⏳ Human` | `Session rules: [[02-authentication/Sessions]]` ✓; `- TODO Tune session TTL agent-1:: assigned` / `- DONE Document refresh flow agent-1:: assigned` ✓; `- TODO Spec approved ⏳ Human` ✓ | PASS |
| 31 | `export obsidian --include-tasks` | §28 row 3: `[[X#Y]]`, `🤖 agent-1`, `⏳ Human`, native checkboxes | `Session rules: [[02-authentication#Sessions]]` ✓; `- [ ] Tune session TTL 🤖 agent-1` / `- [x] … 🤖 agent-1` ✓; `- [ ] Spec approved ⏳ Human` ✓ | PASS |
| 32 | `export opml --json` | §35 export.json | `{ok,command:"export",exitCode:0,format:"opml",outputDir:"cans-export/opml",filesExported:4}` — cwd-relative, matches fixture | PASS |
| 33 | `cans export all` (+ `--json`) | §28 formats incl. `all` | 4 subdirs, `Exported all → cans-export (16 files)`; JSON `outputDir:"cans-export", filesExported:16, format:"all"` | PASS |

### Export scope & flags (§28 rules)

Workspace exp2 (full init) + `_collab/handoffs.md`, `_adr/001-use-tokens.md` (active), `_adr/_archive/000-old.md`, `_tasks/demo-task.md`, `07-unique.md`.

| # | Command | Expected | Actual | Verdict |
|---|---|---|---|---|
| 34 | `export opml` | §28 excludes `_collab/`, `_adr/_archive/`, `_rules.yaml`, `AGENTS.md` | 9 files; none of the excluded content present (grep sweep = 0) | PASS |
| 35 | active `_adr/001-use-tokens.md` | §28 excludes only `_adr/_archive/` → active ADR implied exported | `001-use-tokens.opml` present with content — **QA-05 F18 (active `_adr/` not exported) FIXED on npm** | PASS |
| 36 | `--include-tasks` vs default | `_tasks/` gated behind flag | default: task files absent; with flag: `demo-task.md` appears (obsidian run) | PASS |
| 37 | `export opml --from .` (workspace root) | semantics undocumented (§20 only) | `Exported opml → cans-export/opml (0 files)` exit 0 — silent zero-file success | **FAIL (F4, minor — QA-05 F15 residual)** |
| 38 | `export opml --from cans` | — | 9 files ✓ (`--from` = spec dir; still never documented as prose) | PASS (UNDOC semantics) |
| 39 | `export opml --from /nonexistent` | QA-05 F15: was `ok:true, filesExported:0` | now `✗ --from directory not found: /nonexistent / Check the path (it must be an existing directory) and try again.` exit 1, JSON `error` field — **F15's missing-source part FIXED on npm** | PASS |
| 40 | stale-output check after #37 | ideally clean/segment per run | `cans-export/opml/` still holds the 9 files from the previous run after the 0-file export — stale-mix risk remains | **FAIL (F4, minor)** |
| 41 | `export opml --dry-run` | preview, nothing written | `[dry-run] Would export opml → cans-export/opml (9 files). No files written.` + `"dryRun": true` | PASS |
| 42 | `export obsidian --vault ../myvault` | README/§36 | writes `../myvault/obsidian/` (9 files); JSON `outputDir:"../myvault/obsidian"` | PASS |
| 43 | `export` in non-ws / `export foo` / `export` | §37 | `✗ no cans workspace found…` / `✗ unknown format "foo" — valid: opml, dynalist, logseq, obsidian, all` / `✗ usage: cans export <format>`, all exit 1 | PASS |

### Round-trips (§45 spirit; QA-05 F16, QA-09 D4/D5/D8/D9)

| # | Flow | Expected | Actual | Verdict |
|---|---|---|---|---|
| 44 | exp1 → `export opml` → fresh rt1 → import all 4 .opml → `check` + normalized diff | §45 "OPML roundtrips pass" | hierarchy+node text byte-identical (only `see:`↔`→` marker differs — the documented encoding); **`→ 02-authentication.md#Sessions` re-imports as `see:` and RESOLVES: `2 see: refs, 0 broken`**; re-export regenerates `→ …` — **QA-05 F16 / QA-09 D9 (OPML RT refs die) FIXED on npm** | PASS |
| 45 | same, task file | owner/gate state survives? | rt1 `07-tasks.md` keeps checkboxes but `[agent-1]` / `⏳ Human` remain **literal text** (no `←` restoration). Obsidian RT *does* restore them (row 47) — asymmetric, import-side conversion unspecified in §27/§28 | DEVIATION (F9, minor) |
| 46 | exp1 → `export logseq` → rt2 → import | §45; QA-09 D8 said `[[X/Y]]` mints dead `see: X/Y.md` | `[[02-authentication/Sessions]]` → `see: 02-authentication.md#Sessions` (proper `.md#anchor` form — **QA-09 D8 FIXED on npm**); refs "broken" in rt2 only because file identity drifted (`02-authentication.md` → `07-authentication.md`), now reported as broken-ref **errors** (no more masked "unwritten spec slot") | PASS (identity drift → F10) |
| 47 | exp1 → `export logseq --include-tasks` → import task file | owned task nodes survive | **`- TODO Tune session TTL agent-1:: assigned` and `- DONE Document refresh flow agent-1:: assigned` VANISH entirely** (file has only `- Tasks` / `- Review` / `⏳ Human`→`← @human` line). Isolated repro: any logseq line containing an inline `key:: value` property is dropped wholesale — and inline `agent-1:: assigned` is exactly what cans' own §28 logseq export emits. Silent, exit 0 | **FAIL (F1, MAJOR)** |
| 48 | exp1 → `export obsidian --include-tasks` → rt3 → import | §45; QA-09 D5 said owner/gate destroyed | `- [ ] Tune session TTL ← agent-1` / `- [x] … ← agent-1` / `- [ ] Spec approved ← @human` — **`🤖`→`← agent-N` and `⏳ Human`→`← @human` restored: QA-09 D5 FIXED on npm**; isolated probe confirms both conversions | PASS |
| 49 | rt2/rt3 file identity | stable names | imported set renumbers (02→07, 04→08, 06→09, task→`10-tasks.md` as a TOP-LEVEL SPEC; `status` shows `0 tasks`) — QA-09 D4/D6 still present | DEVIATION (F10, minor) |
| 50 | rt2 → re-`export logseq` | loop closes | `[[02-authentication/Sessions]]` regenerated byte-identically | PASS |

### Budget read (§26)

Workspace bud = `budget-project/*.md` (02/04/06) + `_tasks/tune-sessions.md` (`Adjust sessions expiry window`, mentions "sessions").

| # | Command | Expected | Actual | Verdict |
|---|---|---|---|---|
| 51 | `cans budget read sessions` | §26 scoring: canonical 100, active task 80, back-pointer 60 | `1. 02-authentication.md#Sessions ← canonical home (38 tok) / 2. cans/_tasks/tune-sessions.md ← active task mentions concept (32 tok) / 3. 04-api.md ← see: back-ref (26 tok) / 4. 06-operations.md ← see: back-ref (28 tok)`; sorted by score; Skipped: 00-overview.md; `Budget: 124 / 4096 (3%)`; exit 0 | PASS |
| 52 | same `--json` | §35 budget-read.json keys | `{ok,command:"budget-read",exitCode,concept,plan:[{file,anchor,reason,score,estTokens}],skipped,totalTokens,budgetLimit,usagePercent}` — key-for-key | PASS |
| 53 | token arithmetic | §26 `ceil(len/3.5)` | controlled probes: `- Beta\n` → estTokens 2 = ceil(7/3.5) ✓; referrer file `- Gamma\n  - Pointer: see 01-target.md\n` → 9 = ceil(31/3.5 node-text) ✓. BUT measured unit is a **node-text serialization, not file bytes**: `04-api.md` and `06-operations.md` are both 114 B yet estTokens 26 vs 28; task-file basis doesn't match raw length either | PASS (F7 DOC-GAP) |
| 54 | canonical home rule | highest child count → lowest depth → earliest file | 02-b (3 children) beat 01-a (1 child); after 01-a grew to 4 children it won — child-count decider confirmed (same depth) | PASS |
| 55 | `--limit 200` / `--limit 80` | greedy include until limit; skipped grows; usagePercent recalculated | limit 200: full plan, `usagePercent: 62` (124/200); limit 80: plan = 38+32=70, next item (26) would exceed → `skipped` grows to [00-overview, 04-api, 06-operations], `usagePercent: 87.5`, plus stderr `⚠ plan usage 87.5% … exceeds token_budget.warn_threshold (80%)` (QA-09 C5 behaviour confirmed) | PASS |
| 56 | `--change tune-sessions` | §26: centered on task file + 1-hop refs | task file FIRST with `reason:"active task", score:100`, then canonical home (100), back-refs (60); plan total unchanged | PASS |
| 57 | `--change fix-gadget` on deep chain (bud4: task→01-widget→02-mid→03-deep) | "Add its refs (1 hop). Reject deep-hop expansion." | plan = task + `01-widget.md` only; `02-mid.md`, `03-deep.md` in skipped — deep hops rejected | PASS |
| 58 | `--change nope` (no such task) | §37-strictness? | **silently ignored** — falls back to the plain read plan (`active task mentions concept`, score 80), exit 0 | **FAIL (F6, minor)** |
| 59 | `budget read xyzzy` (zero matches) | §37 error | `✗ no files match concept "xyzzy" — check spelling or run \`cans status\`` exit 1; JSON `ok:false` + `error` (nit: `skipped` lists all files incl. the would-be canonical home while `plan` is empty) | PASS |
| 60 | `budget read` outside workspace (nows) | §37 | `✗ no cans workspace found — run \`cans init\` first, or cd into a project with a cans/ directory` exit 1 + JSON error | PASS |
| 61 | `budget read SESSIONS` / `budget read "sign up"` | §26 normalize concept | case-insensitive ✓ (concept echoed raw `SESSIONS` — nit); multi-word → canonical home `Sign up` ✓ | PASS |
| 62 | `budget` / `budget read` / `budget write` bare | usage | `✗ usage: cans budget <read|write> <concept>` / `✗ usage: cans budget read <concept> / Example: cans budget read sessions` / same for write; exit 1 | PASS |

### Budget write (§26)

| # | Command | Expected | Actual | Verdict |
|---|---|---|---|---|
| 63 | `cans budget write sessions` (+ `--json`) | §26 + §35 budget-write.json | canEdit = `02-authentication.md` (canonical home, anchor `Sessions`) + `cans/_tasks/tune-sessions.md` (active task); mustNotEdit = `04-api.md` + `06-operations.md` (`only has see: reference`); backPointersToUpdate = `[{fromFile:"04-api.md",fromLine:3,toFile:"02-authentication.md"},{fromFile:"06-operations.md",fromLine:3,…}]` — fromLine 3 verified by grep. JSON shape key-for-key | PASS |
| 64 | `budget write cache` in bud3 (no see:-only referencers) | mustNotEdit empty | `mustNotEdit: []`, `backPointersToUpdate: []` | PASS |
| 65 | `budget write xyzzy` | §37 | `✗ no files match concept "xyzzy" …` exit 1 (QA-03 #4 fix holds) | PASS |
| 66 | `--limit abc` / `--limit -5` / `--limit 3.5` | QA-08 D9: was silently ignored | ALL now rejected: `✗ invalid --limit value "abc" — pass a positive integer` exit 1 (same for `-5`, `3.5`) — **QA-08 D9 FIXED on npm** | PASS |
| 67 | `--limit 0` | sane rejection | passes the integer validator, fails later: `✗ plan empty: --limit 0 is below the cheapest item (26 tok) — raise the limit` exit 1 (inconsistent validation surface vs `-5`; message itself is good) | UNDOC (F7 nit) |

### Config flow (light touch; QA-13 owns `_rules.yaml`)

| # | Command | Expected | Actual | Verdict |
|---|---|---|---|---|
| 68 | `_rules.yaml` `token_budget.default_limit: 500` → `budget read sessions --json` | budgetLimit = 500 | `"budgetLimit": 500`, `usagePercent: 18.4` (92/500) ✓; `--limit 100` overrides config ✓ and config's `warn_threshold: 0.8` fired on stderr at 92% | PASS |

## Findings

### F1 — MAJOR (data loss, NEW): logseq import drops any node whose line carries an inline `key:: value` property — destroying cans' own exported owner form on round-trip
- Repro: exp1 → `cans export logseq --include-tasks` → fresh ws → `cans import logseq <exported task file>` → task children gone. Minimal: file `- Root\n  - TODO Tune session TTL agent-1:: assigned` → imported tree contains only `- Root`.
- Expected: §27 "Convert tasks … Preserve real identifiers" + §28 emits `agent-1:: assigned` — cans' own export format must re-import losslessly; at minimum §37-visible, not silent.
- Actual: whole line silently discarded (exit 0, no warning). Note the round-2 fixture case (property on its OWN child line, e.g. `agent-1:: assigned` under `DONE Add Google OAuth`) strips cleanly — only inline/mid-line properties nuke the node (related: QA-08 E11's partial-strip residue is gone; whole-line drop replaced it). This makes the documented logseq round-trip lossy for every owned task node, masked by exit 0.

### F2 — MINOR (NEW): cans-wins conflict detection is similarity-heuristic; divergent text silently becomes a "new node"
- Repro (ws4): import opml → edit `Expire after 24 hours` → `Sessions expire after 24h` (or `Renamed by human entirely`) → re-import.
- Expected: §27/§35 — a node the human changed should surface in `conflicts[]` with `resolution:"cans-wins"` (as it does for the near-identical `Expire after 48 hours` case, row 15).
- Actual: import text appended as a NEW sibling under the same parent (duplicate concept), `conflicts:[]`, exit 0. The round-1 wrong-parent corruption (QA-05 F8) is gone, but the §35 conflict contract silently degrades to "append" when the edited text diverges enough. Heuristic undocumented.

### F3 — MINOR (STILL-BROKEN, QA-06 #4 residual): import accepts equals-form flags silently
- Repro: `cans import opml <file> --merge-strategy=ask` → behaves as default cans-wins, exit 0, no `✗ invalid flag form` error; `--merge-strategy=banana` likewise silently accepted (row 20/21).
- Expected: §20 "No `--flag=value`"; round 2 (QA-10 C3) recorded `✗ invalid flag form "--limit=200" — use "--limit <value>"` for budget/init. Import/export flags were never given the same validation — the user believes `ask` was applied.

### F4 — MINOR (STILL-BROKEN, QA-05 F15 residual): `export --from` semantics — workspace root silently exports 0 files; stale outputs never cleaned
- Repro: `cans export opml --from .` in workspace root → `Exported opml → cans-export/opml (0 files)` exit 0; `--from cans` works (9 files); after the 0-file run, `cans-export/opml/` still contains the previous 9 files (stale mix).
- SETTLED PART: `--from /nonexistent` now fails properly (✗ + exit 1 + JSON error) — that half of F15 is FIXED on npm. Remaining: undocumented "path must be the spec dir" semantics + no per-run output cleaning.

### F5 — MINOR (NEW): merge path drops `_note`-derived children of pre-existing nodes
- Repro: ws2b — import opml whose root `Auth` exists in the workspace and whose only content is `_note="details here"` → `merged:["08-auth.md"]` but file unchanged, `conflicts:[]`. Fresh import of the same file creates the `- details here` child (row 12); a plain-text new child under an existing root DOES merge (ws7 probe: `Brand new node` appended). So `_note` expansion runs on the create path only.

### F6 — MINOR (NEW): `budget read --change <unknown>` silently ignored
- Repro: `cans budget read sessions --change nope` → plain read plan (task back at score 80), exit 0.
- Expected: §37-consistent refusal (`✗ no task "nope" in _tasks/ …`), matching the strict treatment of unknown concepts (row 59) and of `--limit abc` (row 66).

### F7 — DOC-GAP (minor): token-estimate text basis undefined; `--limit 0` validation inconsistency
- §26 says `ceil(text.length / charsPerToken)` but never defines `text`. Evidence it is a node-text serialization rather than file bytes: `04-api.md` vs `06-operations.md` are byte-identical in length (114 B) yet estTokens 26 vs 28; controlled probes confirm `ceil(len/3.5)` once the right text unit is used (row 53). Also: `--limit 0` passes the "positive integer" validator that rejects `-5`/`3.5`, dying later with "plan empty".

### F8 — UNDOC (minor): import naming quirks
- Next-`NN-` allocator starts at **07** even in a bare workspace containing only `00-overview.md` (07-authentication, 08-api, 09-operations, 10-tasks by import order) — independent of actual existing indices; undocumented (also observed rounds 1–2, never explained).
- Fence-first import: overflow extraction writes `cans/fence-note/request-schema.json` (a bare, non-`NN-`, index-less directory inside `cans/`) and mangles the spec filename from the whole generated node text (`08-request-schema-see-fence-note-request-schema-json.md`). Functional (ref resolves) but layout/naming are undocumented.
- Import outside a workspace + `--out` works and the error hint advertises it (`…or pass --out <dir>`) — undocumented feature.

### F9 — DEVIATION/DOC-GAP (minor): import-side marker conversion is specified for obsidian but not for opml
- Obsidian RT restores owners/gates (`🤖`→`← agent-N`, `⏳ Human`→`← @human`, row 48); OPML RT leaves `[agent-1]` / `⏳ Human` as literal text (row 45). §27/§28 document only the export direction, so each behaviour is "per docs" — but the asymmetry contradicts §45's uniform "roundtrips pass" claim. Doc decision needed (same tension QA-05 F16 identified for refs; refs themselves are now fine on npm).

### F10 — DEVIATION (minor, cc QA-09 D4/D6): round-trip file-identity drift
- Re-imported files renumber (02→07, 04→08, 06→09) and a task file re-imports as a top-level spec (`10-tasks.md`; `status` → `0 tasks`). Refs that are correct in form (`see: 02-authentication.md#Sessions`) report broken purely because the file was renamed. Persisted from round 2; no worse.

## Round-2 open-item settlements (my area)

| Round-2 item | Status on npm 0.1.0 |
|---|---|
| Obsidian callouts dropped (QA-05 F4 / QA-08 E9) | **FIXED** — callout → node + child (row 8) |
| Post-fence content dropped, no overflow extraction (QA-05 F5 / QA-08 E9) | **FIXED** — overflow file + see: ref + post-fence content kept (row 9) |
| Logseq RT mints dead `[[X/Y]]` refs (QA-09 D8) | **FIXED** as ref conversion (`see: X.md#Y`, no more `X/Y.md`, no masked warning); residual is generic identity drift (F10) |
| `--merge-strategy ask` reports nothing (QA-05 F9 / QA-09 D12) | **FIXED** — human `!` line + conflicts[] + no merge (row 18) |
| QA-05 F15 `--from` | **PARTIAL** — missing-dir error FIXED; root→0-files + stale outputs STILL-BROKEN (F4) |
| Import equals-form `--merge-strategy=ask` silently defaults (QA-06 #4) | **STILL-BROKEN** (F3) |
| QA-08 E7 embed `![[x]]` lacks `.md` | **FIXED** (row 7) |
| QA-08 D9 `--limit abc` silently ignored | **FIXED** (row 66) |
| QA-05 F18 active `_adr/` not exported | **FIXED** (row 35) |
| QA-05 F16 / QA-09 D9 OPML RT refs die | **FIXED** — `→` re-imports as `see:` and resolves (row 44) |
| QA-09 D5 obsidian RT destroys owner/gate state | **FIXED** — emoji restored to `←` markers (row 48) |
| QA-09 D4/D6 RT identity drift | still present (F10) |
| QA-05 F8 cans-wins corruption; F1 error surface; F10 invalid enum; F11 `--out`; F14 OPML checkboxes; F7/F12/QA-05 F17 misc | fix claims all HOLD on npm (rows 15, 24–26, 19, 23, 28, 22, 11, 10) |

## What held up

- **Every §35 JSON shape in my area is key-for-key exact**: import.json (incl. conflict entries `{file,line,cansVersion,importVersion,resolution}`), export.json (cwd-relative `outputDir`, `filesExported`), budget-read.json, budget-write.json. Error paths now carry an `error` field everywhere I probed.
- **§26 budget scoring/ordering is exactly as documented**: 100 canonical / 80 active task / 60 back-pointer, greedy `--limit` truncation with `skipped` growth and recalculated `usagePercent`, `--change` recentering with hard 1-hop rejection, `ceil(len/3.5)` arithmetic, canonical-home child-count election, `default_limit` + `warn_threshold` consumed from `_rules.yaml`.
- **§28 export transformation table matches cell-for-cell in all four formats**, including checkboxes in OPML, `agent-1::`/`TODO`/`DONE` in logseq, `🤖`/native checkboxes in obsidian, and indentation everywhere; scope rules (`_collab/`, `_adr/_archive/`, `_rules.yaml`, `AGENTS.md` excluded; `_tasks/` behind `--include-tasks`) hold.
- **§37 error discipline is uniform and genuinely good now**: every failure names the cause + a fix hint, exits 1, no stack traces and no exit 2 in ~70 invocations (a first for this area across rounds).
- **Round-trips materially improved**: OPML and logseq re-exports regenerate byte-identical external files; refs survive OPML RT; owners/gates survive obsidian RT.
- Perf: every operation felt instantaneous (<100 ms), consistent with §40.

## Verdict summary

- ≈64 checks: **PASS 52 · FAIL 7 (F1 ×1 MAJOR; F2 ×1, F3 ×2, F4 ×2, F5 ×1, F6 ×1 minor — rows 20/21 share F3) · DEVIATION 4 (F2-row16/F9/F10 + row 45) · UNDOC/DOC-GAP 3 clusters (F7, F8, row-27 hint)**.
- Headline: the npm package carries essentially all round-1/round-2 interop fixes (both blockers, callouts/fences, `ask`, `--out`, OPML checkboxes, embed `.md`, active `_adr/`, OPML RT refs, obsidian RT owners, `--limit` validation) **plus** budget contracts fully green. New damage found is narrow: **F1 (logseq inline-property line drop = silent round-trip task loss) is the only MAJOR**; the rest are silent-fallback/minor contract gaps (F2–F6) and doc gaps (F7–F9).
- Recommended fix order: F1 (logseq inline-property loss) → F3 (equals-form on import) → F2 (conflict heuristic) → F6 → F4/F5 → docs for F7–F9.
