# QA-09 — Stateful Sequences & Cross-Command Interactions (Blackbox)

Task ID: 4-c | Agent: qa-stateful | Repo: cans-spec @ fix/qa-red-tests-green, commit e628ff2
Date: 2026-09-04 | Method: manual shell only, blackbox (no src/, no tests read)

---

## Scope & method

- Mandate: NEW ground vs QA-01..QA-06 — multi-command **stateful sequences** and **cross-command interactions**, not single-command behavior. Single-command contracts (help text, JSON shapes, arg parsing, engine thresholds) were owned by QA-01..06 and are only touched here where a *sequence* exposes them.
- Oracle: `docs/cans.architecture.md` (§ refs below), `README.md`, `templates/`. Prior coverage taken from `agents/qa/QA-01..06`.
- CLI: `bun run /home/z/my-project/cans-spec/src/cli.ts <command>` (bun 1.3.14). Workspace = `cans/` resolved from cwd; commands run from the parent of `cans/`.
- Scratch workspaces (all outside the repo, all reproducible): `/home/z/my-project/qa-playground/qa-09/{A,B,C,D,E,F}/…`. Fixtures copied with `cp` only; files mutated **by hand** (sed/echo/cat/rm/mv) between commands — that hand-mutation is the test.
- Verdicts: PASS / FAIL (violates a documented contract) / DEVIATION (doc–impl mismatch in detail) / UNDOC (no doc answer). Severity: BLOCKER (data loss/corruption) / MAJOR (wrong state, false success, wrong exit) / MINOR / NIT.

## Verdict summary

| Group | Scenario | Tests | PASS | FAIL | DEVIATION | UNDOC |
|---|---|---:|---:|---:|---:|---:|
| A | Lifecycle chain init→new→edit→status→done→check | 17 | 16 | 0 | 1 | 0 |
| B | `check --fix` convergence & idempotency | 9 | 7 | 1 | 0 | 1 |
| C | Budget state transitions across file edits | 12 | 10 | 0 | 2 | 0 |
| D | Import/export round-trips + merge strategies | 14 | 8 | 3 | 3 | 0 |
| E | Destructive / edge flows | 10 | 6 | 2 | 2 | 0 |
| F | `--tool` interleaving | 8 | 7 | 1 | 0 | 0 |
| **Total** | | **70** | **54** | **7** | **8** | **1** |

**Blockers found: 0. Majors: 7.** The round-1 BLOCKER (QA-05 F8 cans-wins merge corruption) was re-tested and is **fixed** at e628ff2 (see D10). Several round-1 MAJORs were incidentally re-verified inside sequences and are fixed (done misdiagnosis, `new task` overwrite, status filters, rules-crash); they are listed under "Fixed since round 1" at the end — QA-07 owns the formal regression matrix.

---

## Group A — Lifecycle chain (A/w1)

Sequence: `init --flat` → `new adr` ×3 → `new task add-dark-mode` → hand-edit task frontmatter/checkboxes (claim per §23–25, §30) → `status` (default + all filters) → `done` (gate ladder) → `done --allow-incomplete` → `status` → `check` → second/third task with check-gate failure → `done --skip-check` → negative `done` probes.

| # | Command sequence | Expected (doc ref) | Actual | Verdict |
|---|---|---|---|---|
| A1 | `init --flat` | Skeleton per §8/§21, 14 entries under `./cans/` | Exactly that, exit 0 | PASS |
| A2 | `new adr` ×3, `new task add-dark-mode` | `_adr/001..003-*.md`, `_tasks/add-dark-mode.md` from templates (§23) | All created, auto-number 001→003, exit 0 | PASS |
| A3 | Hand-edit task: check 2 boxes, `← agent-1/2/3`, leave `← @human` open | File IS the state (§3, §30); status reflects on next command | status shows Tasks 2/3, Gates 0/1, Owners agent-1..3, BLOCKED | PASS |
| A4 | `status` / `status --json` | §25/§35 shape and counts | Matches; counts coherent with hand edits. Note: `taskFiles[]` gained an **undocumented `unclaimed` field** (additive, not in §35 fixture) | PASS (+DEVIATION, minor, A17) |
| A5 | `status --unclaimed` / `--blocked` / `--owners` | §20/§25 filters (semantics never defined) | **Filters now functional** (QA-04 #5 said no-ops): `--unclaimed` restricts the per-task listing to tasks containing unclaimed items, `--blocked` to blocked tasks, `--owners` prints an "Owners view" (per-owner tasks/done). Summary lines always print. Semantics undocumented but coherent | PASS |
| A6 | `done add-dark-mode` (human gate open) | §24 r1: ALWAYS blocks; §36 message with `file:line — gate text` | `✗ BLOCKED: 1 unchecked ← @human gate` + `_tasks/add-dark-mode.md:12 — Spec approved ← @human` + advice; exit 1; nothing archived | PASS |
| A7 | `done add-dark-mode --allow-incomplete` (human gate open) | §24 r1: human gate not skippable | Still blocked, exit 1 | PASS |
| A8 | Human gate checked (sed), 1 task open → `done` then `done --allow-incomplete --json` | §24 r2/r3 ladder; §35 done-success.json | Blocked (`1 open task` + file:line) → with flag: `ok:true`, `gates{human:1,humanOpen:0,tasks:3,tasksOpen:1}`, `archived:_tasks/_archive/2026-09-04-add-dark-mode.md` | PASS |
| A9 | `status` after archive | §25 archived count, 0 active | `0 tasks, 1 archived`; `_tasks/` empty except `_archive/` | PASS |
| A10 | `check` after full chain | §22 sections; warnings-only workspace | 0 errors, 9 warnings, exit 0; **`Rules (_rules.yaml)` section now printed** (QA-02 F17 said it never appeared) | PASS |
| A11 | New task, all boxes+gate checked, clean ws → `done` | Archives (§24) | `✓ Archived _tasks/_archive/2026-09-04-fix-auth-bug.md`, exit 0 | PASS |
| A12 | Break `04-api.md` (>120-char node) → `done fix-overflow` → `--skip-check` | §24 r3: check gate blocks unless `--skip-check` | `✗ BLOCKED: cans check failed (--skip-check to override)` exit 1 → with flag archives, exit 0 | PASS |
| A13 | `done` (no args) | §37 usage error | `✗ usage: cans done <task-name>` exit 1 (QA-04 #24 false-diagnosis fixed) | PASS |
| A14 | `done nope` (+ `--json`) | §37 "task not found" | `✗ task "nope" not found in _tasks/ — run cans status to list active tasks`; JSON now carries an `error` field | PASS |
| A15 | `done fix-auth-bug` (already archived) | Clear cause | `✗ task "fix-auth-bug" is already archived (_tasks/_archive/2026-09-04-fix-auth-bug.md)`, exit 1 | PASS |
| A16 | `stat` before/after archive move; mtime probes across the chain | — | `mv`-style archive preserves content mtime; dir mtime updates; no command output depended on mtime ordering at any step | PASS (observation) |
| A17 | `status --json` `taskFiles[]` | §35 fixture keys | Extra `unclaimed` key per entry (additive drift, breaks byte-level fixture equality) | DEVIATION (minor) |

End-to-end state stayed coherent across ~20 commands: counts, gates, archive location, and check results all derived from files at every step; no stale caching observed.

## Group B — `check --fix` convergence (B/w1, B/w2)

B/w1: `test/fixtures/broken-refs-project/*.md` copied to `cans/` (1 file, 2 broken refs + 1 self-ref). B/w2: hand-built 3-file graph (02 ← 04 ← 06 deep hop) + stale `<!-- ref-by: 04-api.md, 99-ghost.md -->`, later mutated by hand (remove a `see:` line, delete whole comment, add/remove `back_pointers` rule).

| # | Command sequence | Expected (doc ref) | Actual | Verdict |
|---|---|---|---|---|
| B1 | `check` on broken-refs fixture | 2 broken + 1 self-ref error, exit 1 (§12) | Exactly that | PASS |
| B2 | `check --fix` run 1 (+ md5) | Writes back-pointer comments only (§17/§22) | `backPointersUpdated:1`; inserted `<!-- ref-by: 04-api.md -->`; file changed; all else untouched | PASS |
| B3 | `check --fix` runs 2,3,4,5 | Fixpoint: no further change | `backPointersUpdated:0`, md5 byte-stable from run 2 on → **converges after 1 write, no oscillation** | PASS |
| B4 | plain `check` after --fix | --fix creates no new problems (§17) | Same 3 pre-existing errors, nothing new; exit 1 | PASS |
| B5 | B/w2: `check` shows stale `99-ghost.md` in ref-by → `check --fix --json` | §17: rebuild ref-by from scratch | Rewrote comment to `<!-- ref-by: 04-api.md -->` (+1 added to 04-api.md), `backPointersUpdated:2`, stale warning gone | PASS |
| B6 | Hand-delete the `see:` line in 04-api.md → `check --fix` ×2 | Stale ref-by removed; idempotent (§17) | Entire now-empty ref-by comment removed from 02; run 2 = no-op; plain check: back-pointers 1/1 current | PASS |
| B7 | Deep-hop error present throughout | --fix scope strictly back-pointers; deep hop untouched | Deep hop still reported, never "fixed" away | PASS |
| B8 | `check --fix` on self-reference (`see 04-api.md` inside 04-api.md) | — | --fix materializes `<!-- ref-by: 04-api.md -->` recording the file's own error-level self-ref as a back-pointer | UNDOC (arguably noise; §17 doesn't address self-refs) |
| B9 | `_rules.yaml` with `references: back_pointers: false` → new referrer file → `check --fix` | §18 rules key `back_pointers: true` is the documented default; false should disable | **--fix still writes `<!-- ref-by: 07-monitoring.md -->`** (`backPointersUpdated:1`) — the rules key is ignored by the write path (QA-03 F1 family) | FAIL (minor) |

## Group C — Budget state transitions (C/w1)

Sequence: `budget write sessions` → `budget read sessions` → hand-edit `02-authentication.md` (add 2 nodes) → read/write again → `--limit 60` / `--limit 10000` → `rm 02-authentication.md` → read/write/check → `new task` mentioning concept → read/write → `--change ghost`.

| # | Command sequence | Expected (doc ref) | Actual | Verdict |
|---|---|---|---|---|
| C1 | `budget write sessions --json` | §26/§35 budget-write.json (canEdit/mustNotEdit/backPointersToUpdate) | Exact shape; canEdit=canonical home, mustNotEdit=04/06 "only has see: reference" | PASS |
| C2 | `budget read sessions --json` | §26 scoring 100/60/…, §35 shape | Exact; scores 100/60/60 | PASS |
| C3 | Append 2 nodes to canonical home → `budget read` | Plan re-derived from files (§26 deterministic) | estTokens 38→52, totalTokens 92→106, usagePercent updates | PASS |
| C4 | `budget read` ×2, diff | Deterministic (§26) | Byte-identical JSON | PASS |
| C5 | `budget read sessions --limit 60 --json` | Greedy include until limit (§26); `warn_threshold 0.8` (§18) | Plan truncated to 1 entry (52/60, 86.7%) **and a warning now fires on stderr**: `plan usage 86.7% … exceeds token_budget.warn_threshold (80%)` (QA-03 F11 said the knob was inert — fixed). Note: warnings to **stderr** while QA-06 observed all output on stdout | PASS (+stream note) |
| C6 | `--limit 10000` | Everything included, skipped [] | totalTokens 106, skipped [] | PASS |
| C7 | `budget write` `backPointersToUpdate.fromLine` vs `cat -n` | Lines of see: back-refs (§26) | 04-api.md:3 and 06-operations.md:3 — both correct after edits | PASS |
| C8 | `rm cans/02-authentication.md` → `budget read sessions --json` | Graceful behavior (§26/§37) | exit 0, but re-elects the **see:-pointer node** `04-api.md#"Session rules: see 02-authentication.md#Sessions"` as new "canonical home" — no hint the real home is gone (check concurrently reports 2 broken refs) | DEVIATION (minor; misleading but deterministic) |
| C9 | Same state → `budget write sessions --json` | §26: MUST NOT edit see:-only files | `canEdit: [04-api.md "canonical home"]` — blesses editing the pointer node; `mustNotEdit: []` | DEVIATION (same root as C8) |
| C10 | `new task tune-sessions` mentioning sessions → `budget read sessions --json` | §26 "active task mentioning" tier; §35 fixture shows task in plan | Task appears in plan, `reason: "active task mentions concept"`, score **80** (QA-03 F3 said tier missing — fixed) | PASS |
| C11 | `budget read --change ghost-task` / bare `budget read` | §37 usage error | `✗ usage: cans budget read <concept>` + example line, exit 1, JSON `error` field | PASS |
| C12 | Task-file path in read/write output | — | `cans/_tasks/tune-sessions.md` — now repo-relative (QA-03 F12 absolute-path leak fixed) | PASS |

## Group D — Round-trips & merge strategies (D/src, D/rt-*, D/merge)

Source workspace `D/src`: init --bare + 3 specs with `see:` refs (incl. a real back-pointer comment) + `_tasks/tune-sessions.md` (checkboxes, owners, `← @human` gate). Exports captured (`cans-export/{opml,dynalist,logseq,obsidian}`), then per format: fresh `init --bare` → `import <format>` per exported file (4–5 sequential imports) → `export <format>` → content-diff against run-1 exports.

| # | Command sequence | Expected (doc ref) | Actual | Verdict |
|---|---|---|---|---|
| D1 | `export opml/dynalist/logseq/obsidian` | §28/§35: `cans-export/<format>/`, filesExported | 4 dirs, correct counts | PASS |
| D2 | Inspect exports | §28 table: `see: X.md#Y`→`→ X.md#Y` (OPML) / `[[X/Y]]` (logseq) / `[[X#Y]]` (obsidian); owners; ⏳ Human | All encodings exact | PASS |
| D3 | obsidian RT: import 5 files → export → diff content per file | §45 "roundtrips pass" | Hierarchy + text **byte-identical** per corresponding file; refs survive: `[[02-authentication#Sessions]]` → CANS `see: 02-authentication.md#Sessions` (import now appends `.md`, QA-05 F2 fixed for obsidian) → re-export identical | PASS |
| D4 | obsidian RT file layout | §27 "Preserve real identifiers" | **File names drift**: `02-authentication.md`→`07-sessions.md`, `04-api.md`→`08-endpoints.md`, task→`10-owner-agent-1.md` (named after first root node). Spec-set identity changes across a round-trip | DEVIATION (minor) |
| D5 | obsidian RT of `_tasks/tune-sessions.md` | §28/§27 owner/checkbox tables | Checkboxes survive (`[x]/[ ]`) but **owner/gate state degrades to literal text**: `← agent-1`→`🤖 agent-1`→ back as literal `🤖 agent-1` in the CANS file; `← @human`→`⏳ Human` literal. Owners unparseable by status; gate lost | FAIL (MAJOR) |
| D6 | obsidian RT: where does the task land? | §27 silent on tasks | Imported as a **spec file** in `cans/` root (not `_tasks/`); shows as orphan spec in check | DEVIATION (minor) |
| D7 | logseq RT: export→import→export diff | §45 | Text/hierarchy byte-identical on re-export (`diff` = 0 for 04-api twin) | PASS |
| D8 | logseq RT: `[[02-authentication/Sessions]]` → CANS → check | §31: convert `[[wiki-links]]`→`see:` | Import produces **malformed ref** `see: 02-authentication/Sessions.md` (slash path + `.md` glued); check reports it as `unwritten spec slot` **warning** ("create 02-authentication/Sessions.md"!), exit 0 — ref is semantically dead in the CANS workspace | FAIL (MAJOR) |
| D9 | OPML RT: import exported .opml → check → export | §45 | Hierarchy/text identical; refs **die** (`→ 02-authentication.md#Sessions` stays literal text, 0 see: refs, orphan warnings) — QA-05 F16 persists; re-export identical except `<title>` | DEVIATION (minor) |
| D10 | merge/cans-wins: fresh import → hand-edit node (`24→48 hours`) → re-import same opml (default) | §27 cans-wins keeps CANS version; §35 conflicts[] | `conflicts:[{file,line:2,cansVersion:"…48 hours",importVersion:"…24 hours",resolution:"cans-wins"}]`; **CANS text kept, no child-append corruption** — round-1 BLOCKER QA-05 F8 is fixed | PASS |
| D11 | Same, `--merge-strategy import-wins` | §27: overwrite on conflict | Import version written; conflict recorded with `resolution:"import-wins"` | PASS |
| D12 | Same, `--merge-strategy ask` | §27: "report conflicts, don't merge" | Doesn't merge ✓ (human `72 hours` kept) but **reports nothing**: `conflicts:[]`, human output just `Imported opml from …`, exit 0 — indistinguishable from a clean no-op import (QA-05 F9 residual, now `ask`-only) | FAIL (MAJOR) |
| D13 | `--merge-strategy banana` | §37-style rejection | `✗ unknown merge strategy "banana" — valid: cans-wins, import-wins, ask`, exit 1 (QA-05 F10 fixed) | PASS |
| D14 | cans-wins with a genuinely NEW node in source | §27 "only adds new nodes" | `Session revocation list` appended as correct last child of `Sessions`; `merged:[07-sessions.md]` | PASS |

(`import dynalist` alias re-verified mid-sequence: `format:"dynalist"`, merge behavior identical to opml.)

## Group E — Destructive / edge flows (E/w1..w3)

| # | Command sequence | Expected (doc ref) | Actual | Verdict |
|---|---|---|---|---|
| E1 | Populate ws (custom `00-overview.md`, `03-data.md`, `_collab/decisions.md`, task with content) → `init --force` | §21: "Skips existing files unless --force" | **Silently clobbers** all spec files + `_collab/{handoffs,conflicts,decisions}.md` back to skeleton (md5s changed), preserves `_tasks/*.md`, `_adr/`; exit 0, no prompt/backup/warning. `_collab/decisions.md` is §29's "append-only" ADR index — multi-agent coordination state destroyed with no warning | FAIL (MAJOR; flag documented, destructive blast radius not) |
| E2 | ws with files 00–06 (02 referenced by 04 via `see 02-authentication.md#Sessions`) → `rm 02-authentication.md` → `check` → `done fix-sessions` | §12: "File not found = broken ref error"; done's check gate should block | `check`: `1 see: refs, 0 broken`, **0 errors, exit 0** — dangling ref downgraded to `unwritten spec slot` warning because target number falls inside the existing files' numeric span (QA-02 F2). `done fix-sessions` then **archives successfully** with a dangling ref in the tree | FAIL (MAJOR — false success in a destructive flow) |
| E3 | `mv cans/02-authentication.md cans/02-auth.md` → `check` → `check --fix` → `mv` back → `check --fix` | §12 resolution is name-based; §37 suggests "Did you mean …?" | Refs to old name → warnings only (in-span downgrade; target's number still in span via `02-auth.md`), exit 0, **no** "did you mean 02-auth.md" suggestion; `--fix` **removes** the renamed file's `<!-- ref-by: 04-api.md -->` (stale relative to new name) — back-pointer history laundered while the referrer's dangling refs remain; after rename-back `--fix` re-adds it. No rename detection anywhere (per docs) but exit 0 masks a broken graph | DEVIATION (minor; severity rides on E2's root cause) |
| E4 | `mv cans/05-frontend.md cans/_tasks/05-frontend.md` → `status` → `done 05-frontend` | §32: `_tasks/*.md` = active tasks | Spec silently reclassified as task (`specFiles 7→6`, `activeTasks 1→2`, `Tasks: 0/0 Gates: 0/0`); `done 05-frontend` **archives the spec** into `_tasks/_archive/` with a success message — a spec file disappears from the spec set silently | DEVIATION (minor; mechanics per §32, no guard/warning) |
| E5 | Task file exists → `new task fix-sessions` | §37 refusal (init precedent) | `✗ refusing to overwrite existing _tasks/fix-sessions.md — it already has content; delete it or use a different name`, exit 1, file untouched (QA-04 #2 silent-overwrite fixed) | PASS |
| E6 | Active + archived task with same name → `done <name>` | — | Active file wins, archives over `_tasks/_archive/YYYY-MM-DD-<name>.md` | PASS |
| E7 | `_rules.yaml`: `node_length.max: 60` → check 130-char node | §18 partial override | `Node too long (130 > 60)` — applied | PASS |
| E8 | Delete the `node_length:` key entirely → check | §18: "**Delete a key = check turns off**" | Falls back to default (130 > 120 flagged, error, exit 1) — deleted key silently re-enables the default check (QA-03 F1 unfixed) | FAIL (MAJOR) |
| E9 | `_rules.yaml` with tab indentation → `check`/`budget read`/`status`/`new task`/`done`/`export` | §18: print line number, exit 1 | `✗ invalid _rules.yaml: line 2: tab indentation (use 2 spaces)`, exit 1 from check + budget; status/new unaffected (exit 0, don't read rules); done blocked via gate order; **no exit-2 crash** (QA-03 F2 fixed) | PASS |
| E10 | `_rules.yaml` = garbage (`this is not yaml at all: {{{` / `???`) → same command battery | §37 graceful everywhere | check + budget: `✗ invalid _rules.yaml: line 1: malformed line: …`, exit 1; status/new exit 0; done reports gate/lookup errors normally; no stack traces, no exit 2 | PASS |

## Group F — `--tool` interleaving (F/w1..w4)

| # | Command sequence | Expected (doc ref) | Actual | Verdict |
|---|---|---|---|---|
| F1 | `init --tool claude --json` | §21: emits CLAUDE.md from AGENTS.md | `cans/CLAUDE.md` created, md5-identical to `AGENTS.md`, listed in `created[]` | PASS |
| F2 | Re-`init --tool cursor` on same ws | §21 idempotent + tool emit | `+ .cursorrules` created (md5-identical to AGENTS.md), everything else `= skipped`, exit 0 — no conflict between tool artifacts | PASS |
| F3 | Re-`init --tool claude` again | §21 idempotent | `= CLAUDE.md (exists, skipped)` | PASS |
| F4 | After `--tool claude`: `check` / `status` / `export opml` | §22 excludes AGENTS.md; §28 excludes AGENTS.md; §21 tool file is an instruction artifact, not a spec | **`CLAUDE.md` is discovered as an 8th spec file**: check `8 files, 42 nodes` with **2 hard errors** — `✗ CLAUDE.md:204 — broken ref: see \` — file not found` (ref regex fires inside inline code in the AGENTS.md template) and `✗ CLAUDE.md:9 — code fence detected`; status `Files: 8 specs`; **export emits `CLAUDE.opml`**. `init --tool claude` manufactures a workspace that fails its own `cans check` and pollutes exports | FAIL (MAJOR) |
| F5 | `.cursorrules` (non-.md) present → check/status/export | §32 spec discovery is `*.md` | Not picked up anywhere | PASS |
| F6 | `budget read`, `status` with tool artifacts present | Unaffected | budget exit 0; status/budget otherwise correct (count inflation covered by F4) | PASS |
| F7 | `init --tool windsurf` (unknown tool) | §37-style error | `✗ unknown tool "windsurf" — supported tools: claude, cursor`, exit 1, no artifact (QA-01 #14 silent-ignore fixed) | PASS |
| F8 | `init --force --tool cursor` over ws containing `CLAUDE.md`, `07-custom.md`, custom ADR, custom `_collab/*` | — | Recreates only its known file set; `07-custom.md`, `CLAUDE.md`, `_adr/001-my-note.md` survive; `_collab/*` clobbered (see E1) | PASS (with E1 caveat) |

---

## Findings (consolidated, by severity)

1. **MAJOR — `init --tool claude` poisons the workspace it just created (F4).** CLAUDE.md is treated as a spec file: 2 hard check errors (bogus `broken ref: see \`` from inline code in the AGENTS.md template; `code fence detected`), inflated `specFiles`, and `CLAUDE.opml` in exports. The README quick-start contract (`init; check` clean) breaks the moment the documented `--tool` flag is used. Fix direction: exclude tool-emitted artifacts from spec discovery/export (as AGENTS.md already is).
2. **MAJOR — deleting a referenced file can be a silent false success (E2).** With the standard file layout (00–06), `rm 02-authentication.md` → `check` exit 0 (`unwritten spec slot` span-downgrade, QA-02 F2 root) → `done` archives the task with a dangling ref. §12 says file-not-found = broken-ref error. The span heuristic turns a data-integrity error into exit 0 exactly in the numeric middle of every real workspace.
3. **MAJOR — logseq round-trip manufactures dead refs, masked as warnings (D8).** `[[X/Y]]` imports as `see: X/Y.md`; check calls it `unwritten spec slot` and suggests creating a slashed filename; exit 0.
4. **MAJOR — obsidian round-trip destroys owner/gate state (D5).** `← agent-1`/`← @human` export to `🤖 agent-1`/`⏳ Human` and re-import as literal emoji text; status can no longer see owners or the human gate. Also the task file re-imports as a root spec file (D6).
5. **MAJOR — `--merge-strategy ask` reports nothing (D12).** Don't-merge is honored, but `conflicts:[]`, silent human output, exit 0 — violates §27 "report conflicts" and strands machine consumers. (cans-wins/import-wins now report correctly — D10/D11.)
6. **MAJOR — `init --force` silently destroys `_collab/*` and all spec content (E1).** Documented flag, undocumented blast radius: §29's append-only `_collab/decisions.md` and every hand-edited spec revert to skeleton with exit 0, no prompt or backup. Only `_tasks/`, `_adr/` and unknown files survive.
7. **MAJOR — §18 "delete a key = check turns off" still not implemented (E8).** Deleting `node_length:` (and by extension the QA-03 F1 family) silently reverts to defaults; the documented disabling mechanism does not exist. (`references.back_pointers: false` is likewise ignored by `check --fix`, B9, minor.)

Minor / notes: file identity drift on round-trip (D4), OPML refs still die on import (D9), budget re-elects a see:-pointer node as "canonical home" after the real home is deleted (C8/C9), `--fix` records back-pointers for error-level self-refs (B8), rename flows launder stale back-pointers while dangling referrer refs stay warnings (E3), spec file silently reclassified as task via `_tasks/` and archived by `done` (E4), `taskFiles[].unclaimed` schema drift (A17), budget over-limit warning goes to **stderr** (C5; QA-06 observed all-user-output-on-stdout — stream discipline drifted).

## Fixed since round 1 (observed incidentally inside sequences; QA-07 owns formal re-verification)

- cans-wins merge corruption (QA-05 F8 BLOCKER): fixed — conflicts[] populated per §35, no wrong-parent append (D10).
- `done` misdiagnosis (QA-04 #4/QA-06 #1): fixed — distinct messages + `error` field for not-found/already-archived/usage (A13–A15).
- `new task` silent overwrite (QA-04 #2): fixed — refuses with cause (E5).
- status filters no-ops (QA-04 #5): fixed — `--unclaimed/--blocked/--owners` filter the per-task view (A5).
- done-blocked human text now includes `file:line — gate text` per §36 (A6/A8).
- `Rules (_rules.yaml)` section now printed by check (QA-02 F17) (A10).
- budget: active-task tier present (QA-03 F3, C10); `warn_threshold` live (QA-03 F11, C5); relative task paths (QA-03 F12, C12).
- invalid `_rules.yaml` (tab indent) no longer crashes exit 2 — line-numbered exit 1 (QA-03 F2, E9/E10).
- `--merge-strategy` validated (QA-05 F10, D13); obsidian import adds `.md` to wiki-link refs (QA-05 F2, D3); `init --tool <unknown>` rejected (QA-01 #14, F7).

## Observations

- State coherence across long chains is good: every command re-derives state from files; no caching/staleness found; determinism verified (budget re-reads byte-identical; `--fix` md5-stable after fixpoint).
- No BLOCKER-severity corruption found anywhere in ~70 sequence probes at e628ff2; the round-1 merge blocker is gone.
- `check --fix` is strictly back-pointer-scoped in every sequence tried (never touched text, nodes, or the deep hop), converges in one writing run, and introduces no new issues.
- mtime/move semantics: archive moves preserve content mtime; nothing in the CLI output depended on timestamps.
- Errors consistently: §37-shaped (`✗ what` + where + what to do) on the paths exercised here; JSON failures now carry an `error` field.
- Performance: all sequence steps well under §40 budgets (each command <50 ms observed).
- Repo untouched except this report; all workspaces reproducible under `/home/z/my-project/qa-playground/qa-09/`.
