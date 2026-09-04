# QA-04 — Workflow commands: `new adr` / `new task` / `done` / `status`

Task ID: 3-d · Blackbox manual QA · Repo: /home/z/my-project/cans-spec @ impl/full-engines, commit 54b0b52 (clean; only this report file added).

## Scope & docs covered

- docs/cans.architecture.md: §20 CLI commands & arg parsing, §21 init (workspace resolution), §22 check (shared pipeline), **§23 `new adr`/`new task`**, **§24 `done` gates**, **§25 `status`**, **§29 ADR Format**, **§30 Task File Format**, §34 flat-project fixture, **§35 output/new.json, status.json, done-success.json, done-blocked-human.json**, **§36 human text examples**, §37 error philosophy, §19 exit codes/output contract, §8 workspace structure.
- templates/adr-template.md, templates/task-template.md, README.md.
- test/fixtures/flat-project/** used ONLY as input data (copied to scratch; originals untouched, md5 verified 7eef9c7d…).

## Environment

- CLI: `bun run /home/z/my-project/cans-spec/src/cli.ts <command>` (bun 1.3.14). System date observed by CLI: 2026-09-03.
- Scratch workspaces (all outside repo): /home/z/my-project/qa-playground/qa-workflow/{w1-init, w2-fixture, w3-check-gate, w4-empty, w5-fresh}.
- Discovered workspace convention (README quick start + init output): `cans init` creates everything inside a `cans/` subdir; workflow commands resolve the workspace as **cwd/cans** when cwd contains `cans/`, or **cwd itself** when cwd *is* the cans workspace (running inside `cans/` also works). Status exits 1 when neither holds.

## Test matrix

| # | Command (cwd) | Expected (doc ref) | Actual | Verdict | Exit |
|---|---|---|---|---|---|
| 1 | `init` then `status` (w1 parent / inside cans/) | Workspace recognized either way (§21, §25) | Both print `Files: 7 specs, 0 tasks…` | PASS | 0 |
| 2 | `new adr "CSS Variables over Tailwind"` | `_adr/001-css-variables-over-tailwind.md` from template (§23) | Created exactly that; content = adr-template.md with NNN/title/date substituted | PASS | 0 |
| 3 | Inspect `_adr/001-*.md` | §29 structure: Status/Date/Decided by/Supersedes/Context/Decision/Alternatives/Consequences/Review w/ `← @human` gate | Matches template & §29 structure (status `proposed`, date 2026-09-03) | PASS | – |
| 4 | Slug cases: mixed case, `_`, `&`, `!!`, quotes, `../../evil`, `has/slash` | lowercase, quotes stripped, non-alnum→`-`, trimmed, reject empty (§23) | `mixed-case-with-underscores-symbols`, `quoted-thing`, `evil.md` (no traversal), `has-slash`; empty rejected | PASS | 0/1 |
| 5 | `new adr` (no args) / `'--- !!!'` | Error per §37 (`✗ <what> / <where> / <what to do>`), reject empty slug | Exit 1, but prints bare `✗ ` with empty message | FAIL (ux) | 1 |
| 6 | `new adr "Postgres over MySQL" --json` | 002 created; JSON `{ok,command:'new',exitCode,change,file}` (§23, §35) | JSON printed BUT slug/file/title absorbed the flag: `002-postgres-over-mysql-json.md`, `# ADR-002: Postgres over MySQL --json` | FAIL (major) | 0 |
| 7 | `new adr --json "Flag First Title"` | Flag parsed, title clean | Slug `json-flag-first-title`, title `--json Flag First Title` (JSON still emitted) | FAIL (major) | 0 |
| 8 | 2nd/3rd ADRs; delete 001 then `new adr "Gap Fill Test"` | Auto-increment NNN (§23) | 002, 003…; after deleting 001 → 006 (max+1, no gap backfill — reasonable) | PASS | 0 |
| 9 | `new task add-dark-mode` (w1) | `_tasks/add-dark-mode.md` from template (§23, §30) | Created; content = task-template.md (`# add-dark-mode`, Owner:, ADR:, Tasks, Review `← @human`, Handoff) | PASS | 0 |
| 10 | `new task` in dir with no `cans/` | Docs silent (init creates workspace, §21/§23) | Auto-creates `cans/_tasks/` (+file) with no _rules.yaml/AGENTS.md, no warning | UNDOCUMENTED | 0 |
| 11 | `new task add-dark-mode` where `_tasks/add-dark-mode.md` exists (w2) | Docs silent; init precedent = skip existing (§21) | "Created", exit 0, **existing task file overwritten** by blank template (fixture state destroyed) | FAIL (major) | 0 |
| 12 | `done add-dark-mode` — 3 open tasks + 1 open `← @human` gate | Blocks, human gate first (§24 r1); JSON = §35 done-blocked-human shape | `ok:false, exitCode:1, gates{human:1,humanOpen:1,tasks:5,tasksOpen:3}, archived:null`; text `✗ BLOCKED: 1 unchecked ← @human gate` | PASS | 1 |
| 13 | done-blocked human text 2nd line | `_tasks/add-dark-mode.md:12 — Spec approved ← @human` (§36) | Generic `Check the gate, then re-run cans done.` (no file:line, no gate text) | DEVIATION (minor) | 1 |
| 14 | All non-human boxes checked, human gate open, `done --allow-incomplete --skip-check` | Human gate ALWAYS blocks, never skippable (§24 r1) | Still `✗ BLOCKED: 1 unchecked ← @human gate`, nothing archived | PASS | 1 |
| 15 | Human gate checked, 1 task open, `done` | Blocks unless `--allow-incomplete` (§24 r2) | `ok:false, gates{human:1,humanOpen:0,tasks:5,tasksOpen:1}`; text `✗ BLOCKED: 1 open tasks (--allow-incomplete to override)` | PASS | 1 |
| 16 | Same, `done --allow-incomplete` | Bypasses tasks gate only; check still runs (§24) | `ok:true, tasksOpen:1, archived:_tasks/_archive/2026-09-03-add-dark-mode.md` | PASS | 0 |
| 17 | Done success human text / archive move (§24) | Move to `_tasks/_archive/YYYY-MM-DD-<name>.md` | `✓ Archived _tasks/_archive/2026-09-03-parent-done.md`; file moved | PASS | 0 |
| 18 | done success JSON vs §35 done-success.json | `{ok,command,exitCode,change,gates{…},archived,backPointersUpdated}` | Exact shape match (backPointersUpdated 0 — see #30) | PASS | 0 |
| 19 | Spec with structural error (1 error, `check`→exit 1) + fully-completed task, `done` | Blocks unless `--skip-check` (§24 r3, §20 shared checkWorkspace) | `✗ BLOCKED: cans check failed (--skip-check to override)`, not archived | PASS | 1 |
| 20 | Same, `--skip-check` | Archives (§24 r3) | `ok:true, archived:…do-thing.md` | PASS | 0 |
| 21 | Same failing workspace, `--allow-incomplete` alone | Does NOT bypass check gate (§24: flags are per-gate) | Still blocked | PASS | 1 |
| 22 | `done` with `Status: blocked`, `blocked-by:` line, `- Blocked` section, all boxes checked | §24 gates are exhaustive (human/tasks/check) | Archives fine once check passes — none of those lines gate done | PASS (matches docs; UNDOCUMENTED semantics) | 0 |
| 23 | Archive twice same day (recreate `do-thing`, done again) | Docs silent | `✓ Archived …do-thing.md` exit 0 — **silently overwrites previous archive entry** (first content lost) | FAIL (major) | 0 |
| 24 | `done no-such-task` / already-archived `done add-dark-mode` / `done 002-postgres…` (ADR name) / `done` (no args) | Clear "task not found" style error (§37) | ALL print `✗ BLOCKED: cans check failed (--skip-check to override)` although `cans check` = 0 errors/exit 0; `--skip-check` does NOT change it; JSON = `{ok:false, gates all 0, archived:null}` with **no reason field** | FAIL (major) | 1 |
| 25 | `status` with 1 blocked task (w2 fixture) | §35/§36 fields: counts, owners, per-task progress | `Files: 3 specs, 1 tasks, 0 archived, 0 ADRs / Tasks: 2/5 done, 0 unclaimed, 1 blocked / Owners: … / add-dark-mode: tasks 2/5, gates 0/1 ⚠ BLOCKED` | PASS (format deviates, #31) | 0 |
| 26 | `status --unclaimed` / `--blocked` / `--owners` | Flags listed §20/§25 (filter output) | Output **byte-identical** to default in all cases (even with only 1 of 2 tasks blocked) | FAIL (major) | 0 |
| 27 | `status --json` vs §35 status.json | Shape `{specFiles, activeTasks, archivedTasks, adrCount, tasks{total,done,unclaimed,blocked}, owners, taskFiles[{name,tasksDone,tasksTotal,gatesDone,gatesTotal,blocked}], conflicts}` | Exact shape match; counts consistent (see #29 semantics) | PASS | 0 |
| 28 | Conflicts: add `status: unresolved` / `Status: Unresolved` / `status: resolved` lines to `_collab/conflicts.md` | `/status:\s*unresolved/i` (§25), human line per §36 | `Conflicts: 2 unresolved in _collab/conflicts.md`; JSON conflicts:2 (only the 2 unresolved) | PASS | 0 |
| 29 | Counting semantics probes | Docs ambiguous; derived behavior | tasks = non-`@human` checkboxes; gates = `@human` checkboxes; unclaimed = non-gate items with no agent after `←` (missing or empty both count); owners from `← agent` assignments only — `- Owner:` field ignored; task-file `blocked` = any open item (quick-fix gates 1/1 + 2 open tasks → still ⚠ BLOCKED) | UNDOCUMENTED | – |
| 30 | Done with `see:` refs lacking `ref-by` comments | "Updates back-pointers if needed" (§24; fixture backPointersUpdated:2) | backPointersUpdated:0, no `ref-by` comments written, no error | UNDOCUMENTED | 0 |
| 31 | Human text format vs §36 examples | Multi-line per-task block incl. `Gates: 1/2 ← @human` | Single-line `name: tasks x/y, gates a/b ⚠ BLOCKED` (info equivalent, format differs) | DEVIATION (minor) | – |
| 32 | `status` with zero tasks (w1 after archiving) | §25 | `Files: 7 specs, 0 tasks, 2 archived…` exit 0 | PASS | 0 |
| 33 | `status` in dir without `cans/` | exit 1 if cans/ missing (§25) | exit 1, but prints zeroed report with **no error message**; JSON `ok:false` zeros | DEVIATION (minor, ux) | 1 |
| 34 | `done x` in dir without `cans/` | Should say workspace missing | `✗ BLOCKED: cans check failed (--skip-check to override)` (wrong diagnosis) | FAIL (minor, same root as #24) | 1 |
| 35 | State-from-files: edit checkboxes open→done, re-run status/done; manual mv to _archive | File IS the state (§3, §30) | status/done instantly reflect edits; fully-checked task unblocks and archives; archived counts update; no hidden state | PASS | 0/1 |
| 36 | `_adr/_template.md` present | §8 shows _template.md | Not counted in adrCount, not picked by numbering (next = 002) | PASS | 0 |
| 37 | Workspace resolution for `new`/`done` from parent of `cans/` | cwd convention | `new task from-parent` → cans/_tasks/from-parent.md; `done parent-done` from parent OK | PASS | 0 |

## Findings (numbered, severity)

1. **MAJOR — `--json` (and any flag) is swallowed into `new` title/name.**
   Repro: `cans new adr "Postgres over MySQL" --json` → creates `_adr/002-postgres-over-mysql-json.md` headed `# ADR-002: Postgres over MySQL --json`; `cans new adr --json "Flag First Title"` → `003-json-flag-first-title.md`; same for `new task foo --json` → `foo-json.md`. JSON *is* emitted, so agents get `ok:true` while the artifact name is silently corrupted. Expected: flags parsed per §20 ("Commands parse only their own args"), `change`/`file` clean per §35 new.json.
2. **MAJOR — `new task <name>` silently overwrites an existing task file.** Repro: run `new task add-dark-mode` twice (w2). Second run prints "Created", exit 0, and replaces the file with the blank template — all checkbox/owner state destroyed. Docs don't specify, but §21's precedent (init "skips existing files unless --force") and §37's error philosophy imply a refusal or warning.
3. **MAJOR — same-day re-archive silently overwrites `_tasks/_archive/YYYY-MM-DD-<name>.md`.** Repro: complete+archive `do-thing`, recreate it, complete+archive again → previous archived record lost, exit 0, no warning. ADRs are "permanent records"; archived tasks are the only history `done` keeps.
4. **MAJOR — every `done` failure except the three gates is misdiagnosed as "cans check failed".** `done no-such-task`, `done` on an already-archived task, `done` on an ADR name, `done` with no args, and `done` in a workspace-less dir all print `✗ BLOCKED: cans check failed (--skip-check to override)` even when `cans check` exits 0 with 0 errors, and even when `--skip-check` is passed (the flag the message itself suggests does not change the outcome). JSON mode returns `{ok:false, gates:{all 0}, archived:null}` with no reason field — indistinguishable across causes. Expected (§37): name the actual problem (`task not found` / `already archived` / `no workspace`) and what to do.
5. **MAJOR — `status --unclaimed` / `--blocked` / `--owners` are no-ops.** Documented in §20 command list and §25; help text lists them. Output is byte-identical to default status in every scenario tested (including when only 1 of 3 tasks is blocked, so a filter would be observable). Related ambiguity: task-file `blocked` is true whenever *any* checkbox is open, so a task with gates 1/1 but open tasks still shows `⚠ BLOCKED` — §35's fixture (`tasks.blocked:1` while both taskFiles have `blocked:true`) can't disambiguate; docs never define the flag's filter semantics.
6. **MINOR — empty error messages from `new`.** `new adr` / `new adr '--- !!!'` / `new task` (missing or slug-less arg) print a bare `✗ ` (exit 1, stdout). Violates §37's `✗ <what> / <where> / <what to do>` pattern.
7. **MINOR — `new` silently bootstraps a workspace skeleton.** In any dir without `cans/`, `new task x` / `new adr "T"` create `cans/_tasks/` or `cans/_adr/` (+ file) with no `_rules.yaml`/`AGENTS.md`, no warning. Undocumented (§23 says only "No git operations"); surprising side effect when run in an arbitrary directory.
8. **MINOR — `status` without a workspace prints a zeroed report with exit 1 and no message.** §25's "exits 1 if cans/ missing" is honored, but nothing tells the user why (text and JSON both silent about the cause).
9. **MINOR — human-text formats deviate from §36 examples.** (a) status per-task: doc shows multi-line block with `Gates: 1/2 ← @human`; actual is one line `name: tasks x/y, gates a/b    ⚠ BLOCKED` (no `← @human` marker). (b) done-blocked: line 1 matches §36 exactly (`✗ BLOCKED: 1 unchecked ← @human gate`), but line 2 is generic advice instead of the documented `file:line — gate text`. Info content is equivalent; format is not.
10. **MINOR — `done` never updates back-pointers.** Workspace had `see:` refs whose targets lacked `<!-- ref-by -->` comments; `done` on a completable task returned `backPointersUpdated:0` and wrote nothing (§24: "Updates back-pointers if needed"; §35 fixture shows 2). Possibly intentional (back-pointers belong to `check --fix`), but undocumented.

## Observations

- **Workspace resolution (undocumented but coherent):** commands look for `cans/` under cwd; running *inside* the cans dir also works. Spec files live directly in `cans/` (§8). The flat-project fixture only works once its files are wrapped in a `cans/` dir — as shipped, `status` there exits 1 with zeros.
- **Counting semantics (undocumented, consistent):** `tasks` = all non-`@human` checkboxes; `gates` = `← @human` checkboxes; `done` counts checked; `unclaimed` = non-gate items whose `←` has no agent (a bare `←` and no `←` both count as unclaimed); `owners` are derived exclusively from `← agent-name` assignments — the `- Owner:` header field is ignored; `tasks.blocked` = number of task files with any open item; `conflicts` = case-insensitive `status: unresolved` lines in `_collab/conflicts.md`.
- **Gate order verified end-to-end:** human (never skippable) → tasks (`--allow-incomplete`) → check (`--skip-check`). `--allow-incomplete` does not bypass check; `--skip-check` does not bypass tasks; neither bypasses human. Matches §24 exactly.
- **`Status: blocked`, `blocked-by:` lines, and a `- Blocked` section do NOT block `done`** — consistent with §24's exhaustive 3-gate list (the QA matrix's "status: open / blocked-by / done-when" fields don't exist in §30; checkboxes are the state, and file edits are reflected instantly — confirmed).
- **ADR numbering = max existing NNN + 1** (deleting 001 does not cause reuse). `_adr/_template.md` is excluded from numbering and adrCount. Title collisions can't overwrite ADRs via CLI (auto-numbering), unlike tasks (finding 2).
- **JSON result shapes for new/done/status match §35 exactly** (field names, nesting, `exitCode` inside payload, `ok` mirroring exit status). Warnings don't block `done`'s check gate (§19).
- Archive accumulation works (multiple files per day, one per task name); `✓/✗` prefixes and exit codes (0 success / 1 user-correctable) are consistent throughout.

## Verdict summary

- **41 checks executed** across 4 workspaces (37-row matrix above covers 41 command/inspection probes).
- **PASS: 26 · FAIL: 8 · DEVIATION: 4 · UNDOCUMENTED: 3** (rows with dual verdicts counted by primary severity).
- Core workflow mechanics (create ADR/task from templates, slug rules, gate order, archive move, status counting/JSON contracts, state-from-files, exit codes) are solid and doc-conformant.
- The FAIL cluster is concentrated in diagnostics and flag handling: flag-swallowing in `new` (#1), silent destructive behavior (#2, #3), misleading done errors (#4), and dead status filters (#5). All are fixable without touching the engines.
- No repo files modified; all evidence reproducible under /home/z/my-project/qa-playground/qa-workflow/.
