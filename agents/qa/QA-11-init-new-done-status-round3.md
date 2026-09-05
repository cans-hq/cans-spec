# QA-11 — Lifecycle: `init` / `new` / `done` / `status` / help+version (Blackbox, Round 3 — npm package)

Task ID: 5-a | Agent: QA-11 (general-purpose) | Date: 2026-09-05

**Round 3. CLI under test: the npm-published package `cans-spec@0.1.0`, global binary at `/home/z/.npm-global/bin/cans` (installed from npmjs.com/package/cans-spec).** Env: Bun 1.3.14, Node v24.19.0, Linux; npm install dir `/home/z/.npm-global/lib/node_modules/cans-spec` (package.json confirms 0.1.0). Method: manual blackbox shell only — no scripts, no test harnesses, no reads of `src/`, `node_modules/`, or `test/*.test.ts`, no repo writes, no fixes. Spec of truth: `docs/cans.architecture.md` (§8, §19-25, §29-30, §35-37, §40, §44), `README.md`, `templates/**`, `test/fixtures/**`, prior reports in `agents/qa/`.

## Scope & docs covered

- §8 Workspace Structure, §19 Output/exit codes, §20 CLI commands, §21 `init`, §23 `new adr|task`, §24 `done` gates, §25 `status`, §29 ADR Format, §30 Task File Format, §35 JSON fixtures (`init.json`, `new.json`, `done-success.json`, `done-blocked-human.json`, `status.json`), §36 human-text examples (help, done-blocked, status), §37 error philosophy, §33/§40/§44 spot checks.
- Prior-round findings used as baselines (re-verified only where still plausible): QA-01 #1-#9, QA-04 #1-#10, QA-09 F4, QA-10 A1/A5/A7/M1/D10.
- Excluded per partition: `check` engines (QA-12/13), `import/export/budget` (QA-14). `check` was invoked only as a `done`-gate precondition.

## Environment

- Invocation: `cans <command>` from scratch dirs under `/home/z/my-project/qa-playground-r3/qa11/` (t01, t03-t18, t-help, t-nows, t-git). Repo untouched.
- System date observed by CLI: **2026-09-05** (archive names use it, matching this QA round's date).
- npm binary is NEWER than the repo state rounds 1-2 tested (`e628ff2`): several round-1/2 FAILs are already fixed in the npm artifact — see "Still-broken check".

## Test matrix

Verdicts: PASS / FAIL / DEVIATION / UNDOC. "exit" = CLI exit code.

### A. help / version sanity (§36, §20, §44)

| # | Command | Expected (doc ref) | Actual | Verdict | exit |
|---|---|---|---|---|---|
| A1 | `cans help` | §36 fixture (L1325-1344) | Content differs from §36 in 4 lines: `budget read` adds `[--change <name>]`, `import`/`export` add `[--json]`, `export` adds `[--include-tasks]`, plus a `version` line — the first four deltas are **§20-exact** (L488-491; §36 is doc-lag); `version` remains undocumented in §20/§36 | DEVIATION (doc-lag; QA-10 A5 omissions now FIXED) | 0 |
| A2 | `cans version` / `cans --version` | §39/§44: 0.1.0 | `cans 0.1.0` both forms; npm package.json = 0.1.0 | PASS | 0 |
| A3 | `cans help` streams | — | stdout 752 B, stderr 0 B | PASS | 0 |
| A4 | `cans` (no args) | §37 guidance | `✗ no command given — run \`cans help\`` | PASS | 1 |
| A5 | `cans version --json` | §35: no fixture | `{ok,command:"version",exitCode,version:"0.1.0"}` — sensible | UNDOC | 0 |
| A6 | `cans help --json` | — | `{ok,command,exitCode}` only — no machine-readable command list (QA-10 D10 persists) | UNDOC | 0 |

### B. `cans init` (§8, §21, §35 init.json)

| # | Command (empty dir unless noted) | Expected (doc ref) | Actual | Verdict | exit |
|---|---|---|---|---|---|
| B1 | `init` | §8/§21 skeleton; §35 fixture list | 14 entries: `_rules.yaml`, `AGENTS.md`, 00-06 specs, `_adr/`, `_tasks/`, `_collab/{handoffs,conflicts,decisions}.md`; `_adr/`/`_tasks/` empty (no `_template.md` — QA-01 #2 DOC-GAP persists: §8 shows it, §35 fixture omits it, impl matches fixture) | PASS | 0 |
| B2 | `init` (2nd run) | Idempotent (§21) | All 14 `= (exists, skipped)` | PASS | 0 |
| B3 | `init --json` (fresh) | §35 init.json | Key-for-key match: `{ok,command,exitCode,created[14],skipped[],root:"./cans"}`; created[] order = fixture exactly | PASS | 0 |
| B4 | `init --json` (2nd run) | skipped[] populated | `created:[]`, all 14 in `skipped[]` | PASS | 0 |
| B5 | `init --folders` | §8 `02-authentication/index.md` | 01-06 → `<name>/index.md`, `00-overview.md` flat, content correct | PASS | 0 |
| B6 | `init --bare` | §21 "minimal" | Only `_rules.yaml`, `AGENTS.md`, `00-overview.md` | PASS | 0 |
| B7 | `init --flat --folders` (fresh, both orders) | Single-mode workspace (QA-01 #1 must stay fixed) | Both orders → folders-mode only, no `index.md` twins beside flat files | PASS | 0 |
| B8 | `init --folders --flat` precedence | — | Folders wins regardless of order; not documented in §21 | UNDOC | 0 |
| B9 | `init --bare --folders` | — | Bare wins (QA-01 #12 DOC-GAP persists) | UNDOC | 0 |
| B10 | edit `03-data.md` + `_collab/handoffs.md`, then `init --force` | §21 "skips existing unless --force" | Specs/AGENTS.md/_rules.yaml recreated (`+`), **user edit to `03-data.md` silently clobbered, no confirmation/backup**; `_collab/*` now `(exists, skipped)` **even under --force** — user handoff line survived (QA-01 #9's _collab data-loss concern FIXED on npm; literal §21 wording now deviates for _collab) | PASS w/ DEVIATION (minor; §21 silent on --force's _collab exemption) | 0 |
| B11 | `init --tool claude` | §21: emits CLAUDE.md from AGENTS.md | `cans/CLAUDE.md` created, md5-identical to AGENTS.md, AGENTS.md kept, listed in created[] | PASS | 0 |
| B12 | after B11: `check` + `status` | QA-09 F4: CLAUDE.md must NOT pollute | `check`: **7 files, 32 nodes, 0 errors** (exit 0); `status`: **7 specs** — CLAUDE.md excluded from spec discovery. QA-09 F4 (round-2 MAJOR) **RESOLVED on npm** | PASS | 0 |
| B13 | root-level `CLAUDE.md` (outside cans/) + check/status | No pollution | 7 specs, 7 files, exit 0 | PASS | 0 |
| B14 | `init --tool cursor` | §21: .cursorrules | `cans/.cursorrules` created; not counted by check/status (non-.md) | PASS | 0 |
| B15 | `init --tool windsurf` | §37-style rejection | `✗ unknown tool "windsurf" — supported tools: claude, cursor`, nothing created | PASS | 1 |
| B16 | `init` inside `cans/` | §21 refuse | `✗ already inside a cans/ workspace — cd to the project root first` | PASS | 1 |
| B17 | `init` inside `cans/_collab/` and `cans/_tasks/sub/deeper/` | §21 refuse at any depth | Same §37 refusal, exit 1 (QA-01 #3 fix holds) | PASS | 1 |
| B18 | B16 with `--json` | error field | `{ok:false,exitCode:1,created:[],skipped:[],root:"",error:"already inside a cans/ workspace…"}` | PASS | 1 |
| B19 | `init --bogus` | §20/§37 | `✗ unknown flag "--bogus"` (QA-01 #6 fix holds) | PASS | 1 |
| B20 | `init --tool=claude` | §20: no `--flag=value` | `✗ invalid flag form "--tool=claude" — use "--tool <value>"` | PASS | 1 |
| B21 | `diff cans/_rules.yaml templates/_rules.yaml`; `diff cans/AGENTS.md templates/AGENTS.md` | Created = bundled templates | Byte-identical both; AGENTS.md = 737 words / 4728 chars (§33 "~800 tokens" DOC-GAP persists, unchanged since round 1) | PASS w/ DOC-GAP | – |
| B22 | README Quick Start in dir with stray `README.md`/`.gitignore` | No collision; check/status work | Stray files untouched; check 0 errors/9 warnings exit 0 (§19: warnings don't fail); status exit 0 | PASS | 0 |

### C. `cans new adr` (§23, §29, §35 new.json)

| # | Command | Expected (doc ref) | Actual | Verdict | exit |
|---|---|---|---|---|---|
| C1 | `new adr "CSS Variables over Tailwind"` ×3 | `_adr/NNN-<slug>.md`, auto-increment (§23) | `001-css-variables-over-tailwind.md`, `002-postgres-over-mysql.md`, `003-my-cool-decision.md` | PASS | 0 |
| C2 | inspect ADR-001 | §29 sections: Status/Date/Decided by/Supersedes/Context/Decision/Alternatives considered/Consequences/Review | All present, from template with `{NNN}`/`{Title}`/`{YYYY-MM-DD}` → `ADR-001: CSS Variables over Tailwind`, `Date: 2026-09-05`, Review gates `← @human` unchecked. `Status: proposed` (template) vs §29 example `accepted` — doc-internal (§23 promises "from template") | PASS | – |
| C3 | `_collab/decisions.md` after 3 ADRs | §29 calls it "the append-only index" | **NOT updated** (still stub `- decisions`); §23 never assigns `new` that duty — doc doesn't say who writes the index | UNDOC | – |
| C4 | `new adr '"Quoted" Thing & More!!'` | §23 slug rules | `004-quoted-thing-more.md` (quotes stripped, symbols → hyphen, trimmed) | PASS | 0 |
| C5 | `new adr "has/slash"` / `"../../evil"` | No traversal (§23) | `005-has-slash.md`, `006-evil.md` — flat inside `_adr/` | PASS | 0 |
| C6 | `new adr ""` / `new adr` / `new adr '--- !!!'` | §37 error, exit 1 | `✗ empty slug from "" — provide a non-empty title` (first two); arg starting `--` → `✗ unknown flag "--- !!!"` | PASS | 1 |
| C7 | `new adr "JSON Test Title" --json` | §35 new.json, no flag pollution (QA-04 #1) | `{ok:true,command:"new",exitCode:0,change:"json-test-title",file:"_adr/007-json-test-title.md"}` — title clean | PASS | 0 |

### D. `cans new task` (§23, §30, §35 new.json)

| # | Command | Expected (doc ref) | Actual | Verdict | exit |
|---|---|---|---|---|---|
| D1 | `new task add-dark-mode` | `_tasks/<slug>.md` from template (§23) | Created; content = task-template.md: `# add-dark-mode`, Owner:, ADR:, Tasks (2 unchecked w/ bare `←`), Review w/ `← @human`, Handoff. No `- Blocked` section (§30 example has one) — template/§30 doc-internal gap | PASS | 0 |
| D2 | `new task "Fix Auth Bug!"` / `"has/slash"` / `"../../evil"` | §23 slug rules | `fix-auth-bug.md`, `has-slash.md`, `evil.md` | PASS | 0 |
| D3 | `new task add-dark-mode` after editing the file (ticked a box) | Refusal, no destruction (QA-04 #2 fix) | `✗ refusing to overwrite existing _tasks/add-dark-mode.md — it already has content; delete it or use a different name`, exit 1, md5 unchanged | PASS | 1 |
| D4 | `new task <name>` on a **pristine-template** duplicate | Init precedent = skip (§21) | stdout `Created …` + JSON `ok:true` — but file **not rewritten** (inode+mtime unchanged): benign no-op with misleading "Created" message; no data loss possible | DEVIATION (minor UX) | 0 |
| D5 | `new task` / `new adr` in dir without `cans/` | No auto-vivify (QA-04 #7 fix) | `✗ no cans workspace found — run \`cans init\` first`, exit 1, nothing created | PASS | 1 |
| D6 | `new task add-dark-mode --json` | §35 new.json | `{ok,command:"new",exitCode,change:"add-dark-mode",file:"_tasks/add-dark-mode.md"}` — key-for-key | PASS | 0 |
| D7 | `new task "  padded name  "` / `"thing.md"` | Sensible slugs | `padded-name.md` (trimmed), `thing-md.md` (dot → hyphen, no double extension) | PASS | 0 |

### E. `cans done` gates & diagnostics (§24, §35 done-*.json, §36, §37)

| # | Command / setup | Expected (doc ref) | Actual | Verdict | exit |
|---|---|---|---|---|---|
| E1 | task all-checked except `← @human`; `done` | Human gate blocks (§24 r1); §36 text | `✗ BLOCKED: 1 unchecked ← @human gate` + `_tasks/ship-login.md:10 — Spec approved ← @human` + remedy line; nothing archived | PASS | 1 |
| E2 | same + `--allow-incomplete --skip-check` (BOTH) | Human gate NEVER skippable (§24 r1) | Same block, exit 1 | PASS | 1 |
| E3 | E2 with `--json` | §35 done-blocked-human.json | Shape match: `{ok:false,exitCode:1,change,gates{human:1,humanOpen:1,tasks:2,tasksOpen:0},archived:null,backPointersUpdated:0}` + **additive undocumented `gateDetails:[{file,line,text}]`** | PASS w/ DEVIATION (minor additive key) | 1 |
| E4 | human checked, 1 task open; `done` | §24 r2 | `✗ BLOCKED: 1 open task (--allow-incomplete to override)` + file:line detail | PASS | 1 |
| E5 | E4 + `--skip-check` | `--skip-check` must NOT bypass gate 2 | Still blocked by open task | PASS | 1 |
| E6 | E4 + `--allow-incomplete` (workspace clean) | Archives; §35 done-success.json | `{ok:true,gates{human:1,humanOpen:0,tasks:2,tasksOpen:1},archived:"_tasks/_archive/2026-09-05-ship-login.md",backPointersUpdated:0}` | PASS | 0 |
| E7 | after E6 | Move per §24 | Original gone from `_tasks/`; content intact in `_tasks/_archive/2026-09-05-ship-login.md` (today's date) | PASS | – |
| E8 | workspace with broken ref (`see: 99-nonexistent.md`); fully-checked task; `done` | §24 r3 | `✗ BLOCKED: cans check failed (--skip-check to override)`, exit 1, not archived (precondition: `check` = 1 error, exit 1) | PASS | 1 |
| E9 | E8 + `--allow-incomplete` | Per-gate flags | Still blocked — `--allow-incomplete` does NOT bypass check | PASS | 1 |
| E10 | E8 + `--skip-check` | Archives (§24 r3) | `{ok:true,…,archived:"_tasks/_archive/2026-09-05-fail-check-task.md"}` | PASS | 0 |
| E11 | E10's JSON on a gate-3 block (from E8 `--json`) | §37: name the cause | JSON carries **no `error` field and no reason** for the check-gate block (human text does); gate-1/2 blocks do carry `gateDetails` | UNDOC (minor) | 1 |
| E12 | `done no-such-task` | §37 names real cause (QA-04 #4 fix) | `✗ task "no-such-task" not found in _tasks/ — run \`cans status\` to list active tasks` | PASS | 1 |
| E13 | `done fail-check-task` (already archived) | §37 | `✗ task "fail-check-task" is already archived (_tasks/_archive/2026-09-05-fail-check-task.md)` | PASS | 1 |
| E14 | `done` (no args) / `done whatever` (no workspace) | §37 | `✗ usage: cans done <task-name>` / `✗ no cans workspace found — run \`cans init\` first` | PASS | 1 |
| E15 | archive task, recreate same name same day, archive again (clean ws) | Distinct archive entry (QA-04 #3 fix) | `2026-09-05-dup-test-2.md` created beside `2026-09-05-dup-test.md`; BOTH contents preserved; original gone; exit 0 | PASS | 0 |
| E16 | workspace with `see:` ref lacking `ref-by`; done | backPointersUpdated ≥1 (§24, §35 fixture: 2; QA-04 #10 fix) | `backPointersUpdated:1`; `<!-- ref-by: 04-api.md -->` written into target file | PASS | 0 |
| E17 | git repo (1 commit, branch main) + `done` | §24: no git operations | Commit count unchanged (1→1), branch unchanged, changes only as untracked files; no merge, no spec edits | PASS | 0 |
| E18 | NOTE — an apparent "archive data-loss" probe in t12b was **invalid tester sequencing** (a blocked `done` inside an `&&` chain short-circuited the file rewrite, so the "second incarnation" never existed). Superseded by E15's clean test. Not a finding. | — | — | (retracted) | – |

### F. `cans status` (§25, §35 status.json, §36)

| # | Command / setup | Expected (doc ref) | Actual | Verdict | exit |
|---|---|---|---|---|---|
| F1 | ws: 2 active tasks (1 blocked by unchecked `← @human`, 1 fully claimed+checked), 1 unclaimed item, 1 archived task, 2 ADRs, 1 `status: unresolved` line | §36 format | Byte-pattern match to §36 example: `Files: 7 specs, 2 tasks, 1 archived, 2 ADRs` / `Tasks: 3/5 done, 1 unclaimed, 1 blocked` / `Owners: agent-1, agent-2` / multi-line per-task block with `Tasks: 1/3`, `Gates: 0/1 ← @human`, `⚠ BLOCKED` / `Conflicts: 1 unresolved in _collab/conflicts.md` | PASS | 0 |
| F2 | `status --json` | §35 status.json | Shape match incl. `tasks{total:5,done:3,unclaimed:1,blocked:1}`, `owners{agent-1:{tasks:1,done:1},agent-2:{tasks:3,done:2}}`, `taskFiles[{name,tasksDone,tasksTotal,gatesDone,gatesTotal,blocked}]`, `conflicts:1` + **additive undocumented `unclaimed` field inside each taskFiles entry** | PASS w/ DEVIATION (minor additive key) | 0 |
| F3 | `status --unclaimed` | §20/§25 filter | Listing narrowed to files with unclaimed items (clear-task dropped); header stays global (QA-10 A13 semantics, still undocumented) | PASS | 0 |
| F4 | `status --blocked` | §20/§25 | Only blocked task file listed | PASS | 0 |
| F5 | `status --owners` | §25 owners view | Dedicated `Owners view:` section (`agent-1: 1 task(s), 1 done` …) | PASS | 0 |
| F6 | md5+mtime snapshot; 3× status (human/JSON/--blocked) | §25 "Never modifies" | All md5s and mtimes identical after 3 runs | PASS | – |
| F7 | `status` in dir without `cans/` | §25 exit 1 | `✗ no cans workspace found — run \`cans init\` first` (QA-04 #8 fix holds) | PASS | 1 |
| F8 | F7 with `--json` | — | Zeroed §35 shape + `ok:false` + `error` field | PASS | 1 |
| F9 | `status --bogus` / `status -j` in valid ws | §37 true error (QA-10 M1 must be fixed) | `✗ unknown flag "--bogus"` / `✗ unknown flag "-j" — no short flags supported` — **true diagnosis in human mode; QA-10 M1 RESOLVED on npm** | PASS | 1 |
| F10 | conflicts variants: `Status:UNRESOLVED`, `status: resolved`, `status: unresolved …` | §25 regex `/status:\s*unresolved/i` | conflicts 1→3: case-insensitive, zero-space after colon counted, `resolved` not counted | PASS | 0 |
| F11 | fresh workspace status | §25 | `Files: 7 specs, 0 tasks, 0 archived, 0 ADRs`, exit 0 | PASS | 0 |
| F12 | cwd = inside `cans/` (bare ws) | QA-04 resolution convention | Works; counts relative to cwd (1 spec); `new task` also resolves inside | PASS | 0 |

### G. Lifecycle chain end-to-end (§24/§30 flow)

| # | Steps | Expected | Actual | Verdict | exit |
|---|---|---|---|---|---|
| G1 | init → edit specs (add `see:` + anchor) → `new adr` → `new task` → status → `done` | Blocked: human gate first | status `0/2 done … ⚠ BLOCKED`; done → `✗ BLOCKED: 1 unchecked ← @human gate` w/ file:line | PASS | 1 |
| G2 | tick all boxes incl. `← @human` → `done` → status | Archive + status reflects | `✓ Archived _tasks/_archive/2026-09-05-add-dark-mode.md`; status `0 tasks, 1 archived`; `ref-by` comment written | PASS | 0 |

### H. Misc (perf §40, naming edges)

| # | Command | Expected | Actual | Verdict | exit |
|---|---|---|---|---|---|
| H1 | timed init/status/done/help | §40: <50/<50/<200ms | init 31ms, status 27ms, done 42ms, help 14ms | PASS | – |
| H2 | `done` on slash-derived task name | Archives cleanly | `_archive/2026-09-05-has-slash.md` | PASS | 0 |

Totals: **~75 probes → 0 FAIL, 0 BLOCKER/MAJOR; 4 DEVIATION (all minor), 8 UNDOC/DOC-GAP notes, several PASS-with-doc-gap annotations.**

## Findings

No FAIL-severity findings. All issues below are minor; none blocks any documented lifecycle flow.

1. **MINOR (DEVIATION) — §35 JSON fixtures are no longer key-exact (additive keys).**
   Repro: `cans done <blocked-task> --json` → extra `gateDetails:[{file,line,text}]`; `cans status --json` → extra `unclaimed` inside each `taskFiles[]` entry.
   Expected: §35 fixture shapes. Actual: additive, non-breaking, arguably useful; same drift class QA-10 already reported for `check.rulesSummary`. §35 needs updating, not the CLI.
2. **MINOR (DEVIATION) — `help` vs §36 fixture.**
   Repro: `diff <(sed -n '1325,1344p' docs/cans.architecture.md) <(cans help)`.
   Actual: 4 §20-conformant additions (`budget read [--change]`, import/export `[--json]`, export `[--include-tasks]`) + undocumented `version` command line. §36 fixture is stale; `version` is missing from §20's command list (QA-10 A7 persists).
3. **MINOR (DEVIATION) — `new task` on an existing pristine-template file reports `Created` + `ok:true` (no-op).**
   Repro: `cans new task fix-auth-bug` twice → second run prints `Created _tasks/fix-auth-bug.md`, exit 0, file untouched (inode+mtime identical). The QA-04 #2 refusal only fires when content differs from the template. Init's precedent prints `(exists, skipped)`. Cosmetic; no data loss.
4. **MINOR (DEVIATION) — `init --force` now skips `_collab/*` (and `_adr/`/`_tasks/`), contradicting §21's letter ("skips existing files unless --force") while being safer.**
   Repro: append a line to `cans/_collab/handoffs.md`, run `cans init --force` → `_collab/*` listed `(exists, skipped)`, user line survives; spec files/AGENTS.md/_rules.yaml ARE recreated from templates (user edits silently clobbered, no backup — per §21, destructive scope still undocumented for those). Doc should state --force's exact scope.
5. **MINOR (UNDOC) — `_collab/decisions.md` is not maintained by `cans new adr`.**
   Repro: 3× `cans new adr …` → decisions.md still the `- decisions` stub. §29 calls it "the append-only index" but never assigns a writer; an agent following §29 literally may expect `new` to append.
6. **MINOR (UNDOC) — `done` gate-3 (check) blocks carry no reason in `--json`.**
   Repro: broken-ref workspace + completable task → `done x --json` = `{ok:false,…,gateDetails:[],archived:null}` with no `error`/reason, while the human text says `✗ BLOCKED: cans check failed`. Agents consuming JSON can't distinguish check-block from other causes (QA-04 #4's human-side fix does not extend to JSON for this gate).
7. **UNDOC — flag-precedence pairs** `--flat --folders` (folders wins, both orders) and `--bare --folders` (bare wins) are deterministic but undocumented in §21 (QA-01 #12 class).
8. **DOC-GAP (persisting from rounds 1-2, unchanged):** `_adr/_template.md` in §8 never created (impl matches §35 fixture); §33 "~800 tokens" for AGENTS.md (actual 737 words / 4728 chars); §36 help fixture stale (see F2); status filter-flag semantics undocumented.

## Still-broken check (vs rounds 1-2, this area)

**Nothing still broken in QA-11's area.** Round-1/2 findings re-tested on the npm binary and confirmed FIXED:

- QA-01 #1 (`--flat --folders` twin creation) — B7: fixed.
- QA-01 #3/#8 (init refusal at depth, message) — B16-B18: fixed.
- QA-01 #4 (JSON `root:"./cans"`) — B3: fixed.
- QA-01 #6/#7 (unknown flags/tools silently ignored) — B15/B19/B20: fixed.
- QA-04 #1 (`--json` swallowed into `new` names) — C7/D6: fixed.
- QA-04 #2 (`new task` overwrites edits) — D3: fixed (pristine-duplicate cosmetic case = F3 above, new/minor).
- QA-04 #3 (same-day re-archive destroys prior archive) — E15: fixed (`-2` suffix).
- QA-04 #4 (done misdiagnoses everything as check failure) — E12-E14: fixed.
- QA-04 #5 (status filters no-op) — F3-F5: fixed.
- QA-04 #6/#7/#8 (empty errors; workspace auto-vivify; silent status no-ws) — C6/D5/F7-F8: fixed.
- QA-04 #10 (done never updates back-pointers) — E16: fixed (`backPointersUpdated:1`, comment written).
- QA-09 F4 (**MAJOR**: `init --tool claude` manufactures failing workspace; CLAUDE.md parsed as 8th spec) — B12/B13: **RESOLVED on npm** (check/status see 7 files, 0 errors).
- QA-10 M1 (status human-mode flag errors misdiagnosed as missing workspace) — F9: **RESOLVED on npm**.
- QA-10 A5 (help omits `--change`, import/export `--json`) — A1: **RESOLVED on npm** (help now §20-exact).

## What held up

- **npm artifact quality is high in this lifecycle area: zero FAIL findings.** Every §21/§23/§24/§25 promise tested behaves as documented, and the npm 0.1.0 binary contains the round-1/2 hardening (in some cases ahead of the repo docs).
- init: §35 fixture-exact JSON (incl. `root:"./cans"`), idempotency, flat/folders/bare/tool modes, depth-correct refusal, template byte-fidelity; `_collab` state now survives `--force`.
- new: correct slug pipeline incl. traversal safety; §35 `new.json` key-exact; refuses existing modified task files and missing workspaces without side effects.
- done: gate order human → tasks → check enforced exactly; per-gate override flags never leak across gates; human gate unskippable even with both overrides; archive move correct with today's date; same-day `-2` collision handling; back-pointer updates; real-cause diagnostics in text; no git operations.
- status: §36-format human output; §35 JSON contract (minus one additive key); working filter flags; provably read-only (md5+mtime stable); conflict regex per §25; truthful flag-error and no-workspace handling.
- help/version: §20-exact command+flag list; version matches npm 0.1.0 (§44); clean stdout-only streams; all JSON parses.
- Perf comfortably inside §40 (worst: done 42ms).
