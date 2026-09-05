# QA-10 — CLI Surface Round 2 (Blackbox)

Task ID: 4-d | Agent: qa-surface2 | Repo: cans-spec @ fix/qa-red-tests-green, commit e628ff2
Date: 2026-09-04 | Method: manual shell only, blackbox (no src/, no tests read)

---

## Scope & method

Round-2 outermost-surface QA targeting **what the hardening changed** (shared arg parser,
error-aware output surface, help/version/unknown-command guidance, `--refs-only` scoping,
`check [file]` no-match error) **plus gaps QA-06 did not cover**. QA-06's exact cases were not
re-run except where a changed behavior needed verification (noted inline).

Oracle: `docs/cans.architecture.md` §19 (output/exit codes), §20 (CLI contracts + arg parsing),
§21/§24-28 (commands), §35 (JSON fixtures), §36 (human text), §37 (error philosophy), §40 (perf),
§41 (removed commands), §44 (versioning); `README.md`; `package.json` (version 0.1.0).
CLI: `bun run /home/z/my-project/cans-spec/src/cli.ts <command>` (bun 1.3.14).
Scratch workspaces (all under `/home/z/my-project/qa-playground/qa-10/`):
`wsA` (flat-project fixture + created tasks), `wsB` (broken-refs fixture → 3 errors),
`wsE` (pristine flat-project, 0 errors / 18 warnings), init/export/import/concurrency scratch dirs,
read-only/deep/symlink env dirs. Fixture files were `cp`-copied from `test/fixtures/**` only.

Verdicts: PASS / FAIL / DEVIATION / UNDOC. "exit" = CLI exit code. "stderrB" = stderr bytes.

---

## Verdict summary

| Section | Tests | PASS | FAIL | DEVIATION | UNDOC |
|---|---|---|---|---|---|
| A. Help/version accuracy | 14 | 7 | 0 | 4 | 3 |
| B. Unknown command/subcommand guidance | 16 | 16 | 0 | 0 | 0 |
| C. Arg parsing edge cases | 19 | 8 | 4 | 3 | 4 |
| D. Stream & JSON discipline | 12 | 6 | 0 | 2 | 4 |
| E. Flag interaction matrix | 11 | 11 | 0 | 0 | 0 |
| F. Environment robustness (+perf) | 14 | 12 | 0 | 1 | 1 |
| **Total** | **86** | **60** | **4** | **10** | **12** |

**No BLOCKERs. 3 MAJOR findings (all in error-message paths of the new parser surface).**
The hardening commit 67c8285 + e628ff2 fixed the bulk of QA-06's majors: usage errors now speak
§37, `new` no longer swallows flags into names, `--flag=value` is rejected, `--refs-only` scopes,
no-workspace handling is uniform, `done` diagnoses correctly, help/version shortcuts exist.

---

## A. Help / version accuracy (§36, §20, §39, §44)

| # | command | expected (doc ref) | actual | verdict | exit |
|---|---|---|---|---|---|
| A1 | `cans help` | byte-identical to §36 fixture (lines 1325–1344) | byte-diff vs doc block: **one added line `  version`** after `help`; everything else identical | DEVIATION (doc not updated for new command) | 0 |
| A2 | `cans help` streams | human text on stdout | stdout 741 B, stderrB=0 | PASS | 0 |
| A3 | help command list completeness | every listed command exists and runs | init/check/new/done/status/budget read/budget write/import/export/help/version — all verified implemented; no phantom commands listed | PASS | 0 |
| A4 | every listed flag works | §20 flag set | verified behaviorally: `init --flat/--folders/--bare/--force/--tool claude` (§21), `check --fix/--strict/--refs-only/--no-redundancy/[file]/--json` (§22), `done --allow-incomplete/--skip-check/--json` (§24), `status --unclaimed/--blocked/--owners/--json` (§25), `budget read --limit` (§26), `import --out/--dry-run/--merge-strategy` (§27), `export --from/--vault/--dry-run` (§28). No listed flag is a no-op | PASS | 0 |
| A5 | help omissions vs §20 | §20:488–491 | help omits `budget read [--change <name>]` (flag **is** implemented, see A-note below), and omits `[--json]` on the `import`/`export` lines (both accept `--json`) | DEVIATION (help text incomplete vs §20) — MINOR | 0 |
| A6 | `cans version` / `cans --version` | package.json version (§39: version 0.1.0) | `cans 0.1.0` — matches package.json; both forms exit 0, stdout-only | PASS | 0 |
| A7 | `version` in §20/§36 | §44 defines no version flag/command | `version` command exists (new since hardening) but is absent from §20 contract and §36 fixture (only surfaced in help output) | UNDOC | 0 |
| A8 | `cans version --json` | §35 has no version fixture | `{"ok":true,"command":"version","exitCode":0,"version":"0.1.0"}` — VALID JSON, sensible shape | UNDOC | 0 |
| A9 | `cans -v` | conventional short version | `✗ unknown command "-v" — run \`cans help\`` exit 1. `-h`/`--help` exist but no `-v` — asymmetric shortcut set | DEVIATION — NIT | 1 |
| A10 | `cans -h` / `cans --help` | conventional help shortcuts | full help, exit 0, stdout-only (new since hardening; QA-06 #23 FAIL fixed) | PASS | 0 |
| A11 | `cans help check` | per-command help? | generic full help printed; extra arg silently ignored; no per-command help exists anywhere | UNDOC | 0 |
| A12 | `cans check --help` | `--help` should show help or error | **silently runs a full check** (0 errors/18 warnings, exit 0) — `--help` swallowed by check's flag handling | DEVIATION — MINOR | 0 |
| A13 | `status --unclaimed` / `--blocked` | §25/§20 | no longer no-ops: they filter the per-task-file listing (e.g. `--unclaimed` drops files whose tasks are all owner-claimed); summary header still global. Semantics undocumented | PASS | 0 |
| A14 | `status --owners` | §25 owners view | dedicated "Owners view:" section listing per-agent task/done counts — works (QA-04 no-op finding does not reproduce) | PASS | 0 |

A-note: `budget read sessions --change add-dark-mode` works per §20:488 (plan re-centers on the
task file: `1. cans/_tasks/add-dark-mode.md ← active task (126 tok)`), so the flag is implemented;
only the help line omits it.

---

## B. Unknown command / subcommand guidance (§37, §19, §41)

All rows run in `wsA`. Expected for every row: §37 pattern (what + fix), human text on stdout,
exit 1; with `--json`: JSON envelope incl. `error` field.

| # | command | actual (stdout) | verdict | exit |
|---|---|---|---|---|
| B1 | `cans foo` | `✗ unknown command "foo" — run \`cans help\`` | PASS | 1 |
| B2 | `cans chek` (typo) | `✗ unknown command "chek" — run \`cans help\`` (no did-you-mean "check"; NIT only) | PASS | 1 |
| B3 | `cans` (no args) | `✗ no command given — run \`cans help\`` | PASS | 1 |
| B4 | `cans new` | `✗ usage: cans new <adr|task> <name>` | PASS | 1 |
| B5 | `cans new foo x` | `✗ unknown kind "foo" — use "adr" or "task"` | PASS | 1 |
| B6 | `cans budget` | `✗ usage: cans budget <read|write> <concept>` | PASS | 1 |
| B7 | `cans budget frobnicate` | `✗ unknown subcommand "frobnicate" — valid: read, write` | PASS | 1 |
| B8 | `cans import` | `✗ usage: cans import <format> <path>` + `Formats: opml, dynalist, logseq, obsidian` | PASS | 1 |
| B9 | `cans import foo /etc/hostname` | `✗ unknown format "foo" — valid formats: opml, dynalist, logseq, obsidian` | PASS | 1 |
| B10 | `cans export foo` | `✗ unknown format "foo" — valid: opml, dynalist, logseq, obsidian, all` | PASS | 1 |
| B11 | `cans done` | `✗ usage: cans done <task-name>` (QA-06 #26 false-diagnosis fixed) | PASS | 1 |
| B12 | `cans new adr` / `new task` | `✗ empty slug from "" — provide a non-empty title` | PASS | 1 |
| B13 | `cans budget read` / `budget write` | `✗ usage: cans budget read <concept>` + `Example: cans budget read sessions` (same for write) | PASS | 1 |
| B14 | `cans import obsidian` | `✗ usage: cans import <format> <path>` + Formats list | PASS | 1 |
| B15 | same errors with `--json` (`foo`, `new`, `done`, `import`, `export foo`, `budget`, `search`) | VALID JSON, `ok:false`, `exitCode:1`, plus **`"error": "<what — fix>"`** field carrying the exact human message; stderrB=0 in all cases | PASS | 1 |
| B16 | §41 removed commands (spot: `cans search`) | same §37 unknown-command guidance; JSON variant has `error` field (QA-06 #21/#24 bare-JSON-no-message fixed) | PASS | 1 |

Exception: `cans budget --json` returns envelope `"command":"budget-read"`, `"concept":"--json"`
with a subcommand error — see C19.

---

## C. Arg parsing edge cases (§20 "Primitive. `--flag value` only.", §37)

| # | command | expected | actual | verdict | exit |
|---|---|---|---|---|---|
| C1 | `cans --json status` | flag before command → clean rejection | `✗ unknown command "--json" — run \`cans help\`` | PASS | 1 |
| C2 | `--json` after/before positionals: `check --json`, `check --json 02-authentication.md`, `check 02-authentication.md --json`, `new task --json name2`, `budget read --json sessions` | flag position flexible | all work; JSON emitted in every case | PASS | 0 |
| C3 | `budget read sessions --limit=200`; `init --tool=claude` | equals form rejected per §20 | `✗ invalid flag form "--limit=200" — use "--limit <value>"` / `✗ invalid flag form "--tool=claude" — use "--tool <value>"`, exit 1 (QA-06 #13/#14 silently-ignored fixed) | PASS | 1 |
| C4 | `check --fix --fix`, `check --strict --strict` | repeated flags | tolerated, effect idempotent (`--fix` twice: backPointersUpdated 1 then 0) | UNDOC | 0 |
| C5 | `cans status -j` (human mode) | unknown flag → §37 error | **`✗ No cans workspace found. / Run \`cans init\` or cd into a project with a cans/ directory.`** — FALSE diagnosis in a valid workspace; exit 1 | **FAIL — MAJOR (M1)** | 1 |
| C6 | `cans check -j` (and `-h`, `-x`) | short flag → error | treated as the `[file]` positional: `✗ no spec file matches "-j" — pass a spec filename like 04-api.md …` exit 1. §37-shaped but misreads a flag as a file | DEVIATION — MINOR | 1 |
| C7 | `status --bogus` / `--abc` / `--owners=me` / `--` (human mode) | unknown flag → §37 error | identical FALSE "No cans workspace found." message (JSON mode tells the truth: `unknown flag "--bogus"`, `invalid flag form "--owners=me"`, `unknown flag "--"`). Root cause shared with C5 | **FAIL — MAJOR (M1)** | 1 |
| C8 | `--` separator across commands | consistent behavior | `check -- 02-authentication.md` → works (separator tolerated); `new task -- --json` → `✗ unknown flag "--"`; `status --` → workspace misdiagnosis (C7). Three commands, three behaviors | DEVIATION — MINOR | 0/1 |
| C9 | `cans new task -- --json` | `--json` must not become the title | `✗ unknown flag "--"` exit 1 — nothing created (QA-06 #19/#20 flag-into-name fixed) | PASS | 1 |
| C10 | `cans new adr ""`; `cans done ""` | empty-string args | `✗ empty slug from "" — provide a non-empty title` / `✗ usage: cans done <task-name>` | PASS | 1 |
| C11 | `check 02-authentication.md 04-api.md` (2 positionals) | 1 expected | no error; issue scope = union of named files (8 warnings vs 7 for one file vs 18 full), while Structure summary still reports the whole workspace (3 files, 38 nodes). Scoping semantics undocumented | UNDOC | 0 |
| C12 | `status extra1 extra2` | status takes no positionals | silently ignored, normal status, exit 0 | UNDOC — NIT | 0 |
| C13 | `budget read sessions --limit abc` | non-numeric value → §37 error | **silently ignored**: default 4096 budget, full plan, `ok:true` JSON, exit 0 | **FAIL — MAJOR (M2)** | 0 |
| C14 | `budget read sessions --limit -5` / `--limit 1` | negative/tiny limit → clear error or empty plan | `✗ no files match concept "sessions" — check spelling or run \`cans status\`` exit 1 — **FALSE cause**: concept exists (plan non-empty at `--limit 200`); failure is actually "budget smaller than first item". Misleads user into a spelling check | **FAIL — MAJOR (M2)** | 1 |
| C15 | `budget read sessions --limit 999999999999` | huge value | accepted as budgetLimit, exit 0 | PASS | 0 |
| C16 | `cans new adr --json` / `new task --json` | flag must not become title | JSON error envelope `✗ empty slug from ""` — `--json` parsed as flag; `new task name --json` → clean name `_tasks/name.md`, §35 new.json now reachable | PASS | 0/1 |
| C17 | `new task "Trailing Junk" --json extra-arg` | trailing positional after title | extra positional silently glued into slug: `trailing-junk-extra-arg`. Lenient multi-word acceptance; flags correctly excluded | UNDOC — NIT | 0 |
| C18 | `new task --bogus name-x`; `done foo --bogus` | unknown flags rejected | `✗ unknown flag "--bogus"` exit 1 (before consuming the name) | PASS | 1 |
| C19 | `cans budget --json read sessions` | flag before subcommand | JSON envelope `command:"budget-read"`, `concept:"--json"`, ok:false exit 1 — the subcommand slot eats `--json` | DEVIATION — MINOR | 1 |

---

## D. Stream & JSON discipline (§19, §35, §37)

Tested per command in clean ws (`wsA`/`wsE`) and error ws (`wsB`, no-ws dir, EACCES dir).
JSON validity verified with `bun -e "JSON.parse(readFileSync(0))"` (observation only).

| # | case | expected | actual | verdict | exit |
|---|---|---|---|---|---|
| D1 | stream split, all commands, success + failure (human mode) | — | **all user-level output and user-level errors on stdout; stderr 0 bytes in every case** (help/check/status/budget/done blocked/usage errors/no-ws/unknown command). Only the internal EACCES path writes stderr | UNDOC (consistent single-stream design; §19 silent) | — |
| D2 | EACCES on `cans/_tasks` (`new task` with dir chmod 555) | §19 exit 2 = internal | exit 2, stdout empty, stderr: `✗ Internal error: EACCES: permission denied, open '…/_tasks/ro2.md'` | PASS | 2 |
| D3 | `--json` success paths: check (clean), status, budget read/write, init, version, help, new task/adr, export, import | VALID single JSON document, §35 shapes | all VALID JSON; status/init/done/new/import/export match §35 key-for-key | PASS | 0 |
| D4 | `--json` failure paths: usage errors (B15), `done add-dark-mode --json` (blocked), no-ws `status/check/budget/done/export/new --json`, unknown command | VALID JSON, ok:false, exit 1 preserved | all VALID JSON with correct exit codes | PASS | 1 |
| D5 | `error` field in JSON failure envelopes | §35 defines no error field (QA-06 observation asked for one) | all failure envelopes now carry `"error": "<what — fix>"`; §35 fixtures not updated to document it | UNDOC | — |
| D6 | exit codes preserved with `--json` (§19) | 0/1/2 | 0 success, 1 user-correctable, 2 EACCES — same with and without `--json` | PASS | — |
| D7 | `check --json` shape vs §35 check-clean.json | §35 keys | **extra top-level key `rulesSummary: "node_length: 3–120 \| siblings: 1–12 \| depth: 1–5"`** — additive §35 shape drift (QA-06 #36 was key-exact PASS; hardening added this) | DEVIATION — MINOR | 0 |
| D8 | EACCES + `--json` | JSON on internal error? | exit 2, plain text on stderr; `--json` ignored on the top-level catch path | UNDOC — NIT | 2 |
| D9 | `check --json` with no workspace | error envelope like sibling commands | message embedded as an issue: `{file:"",line:0,level:"error",category:"refs",message:"no cans workspace found…"}` instead of an `error` field; cosmetic `:0` file:line | DEVIATION — NIT | 1 |
| D10 | `help --json` | machine-readable help? | envelope only `{ok,command,exitCode}` — no commands/flags content; agents cannot consume help as data | UNDOC — NIT | 0 |
| D11 | no-workspace handling across commands (human + JSON) | §37 message + exit 1 | **uniform**: `check`/`status`/`budget read`/`budget write`/`export`/`new task` all exit 1 with `✗ no cans workspace found — run \`cans init\`…` (message wording varies slightly per command; `new task` no longer auto-vivifies a partial workspace — QA-06 #52–#55 family fixed) | PASS | 1 |
| D12 | `done add-dark-mode --json` (human-gate blocked) | §35 done-blocked-human.json | VALID, ok:false, exitCode 1, gates counts, archived:null, backPointersUpdated 0 | PASS | 1 |

---

## E. Flag interaction matrix (§16/§19/§20/§24, README)

All rows in `wsE` (0 errors / 18 warnings baseline) unless noted.

| # | combo | expected (doc ref) | actual | verdict | exit |
|---|---|---|---|---|---|
| E1 | `check --refs-only` | refs-only scoping (hardening commit e628ff2) | **only References (+Rules config echo) sections printed; warnings 18 → 2** (unwritten slot + stale back-pointer). Structure/Style/Redundancy/Overflow engines skipped. QA-06 #13/#66 fixed | PASS | 0 |
| E2 | `check --refs-only --strict` | §19: strict turns warnings into failure | exit 1 with the 2 refs warnings (report still printed) | PASS | 1 |
| E3 | `check --strict` | §19 | exit 1, 18 warnings, full report on stdout | PASS | 1 |
| E4 | `check --strict --no-redundancy` | §19 + §16 | 13 warnings (5 redundancy warnings removed), exit 1 | PASS | 1 |
| E5 | `check --refs-only --no-redundancy` | — | identical to `--refs-only` alone (redundancy not in scope anyway), exit 0 — no contradiction | PASS | 0 |
| E6 | `check --no-redundancy` | §20 | 13 warnings vs 18 — redundancy engine truly off | PASS | 0 |
| E7 | `check --fix --strict` | §22 fix scope + §19 strict | fix applied (stale ref-by removed; 18→17 warnings), then strict exit 1 for remaining warnings — both semantics preserved in one run | PASS | 1 |
| E8 | `check --fix --json` (fresh copy) | §35 check-fix.json | VALID JSON, `backPointersUpdated: 1`; second run `backPointersUpdated: 0` (idempotent) | PASS | 0 |
| E9 | `done add-dark-mode --skip-check` / `--allow-incomplete` / both (human gate open) | §24 rule 1: human gates never skippable | all three blocked: `✗ BLOCKED: 1 unchecked ← @human gate` + `_tasks/add-dark-mode.md:10 — Spec approved ← @human` + `Check the gate, then re-run cans done.`; nothing archived | PASS | 1 |
| E10 | gate ordering: `done qa-partial` (open task, no human gate) then `--skip-check` then `--allow-incomplete`; `done qa-checkgate` in `wsB` (check fails, all tasks checked) | §24 rules 2–3 in order | open task blocks with `--allow-incomplete to override` (and `--skip-check` does NOT bypass gate 2); `--allow-incomplete` archives when check clean; in wsB, failing check blocks with `--skip-check to override`, `--skip-check` archives | PASS | 0/1 |
| E11 | `done nonexistent-zzz` | §37 | `✗ task "nonexistent-zzz" not found in _tasks/ — run \`cans status\` to list active tasks` (QA-06 #27 fixed) | PASS | 1 |
| E12 | `done` blocked human text vs §36 fixture | §36 | `✗ BLOCKED: …` + file:line + remedy line — matches the §36 example pattern (line number real, not `:0`) | PASS | 1 |

---

## F. Environment robustness (+ perf §40)

| # | scenario | expected | actual | verdict | exit |
|---|---|---|---|---|---|
| F1 | cwd inside dir whose parent is chmod 555 (workspace itself writable) | no impact | check/status/new all exit 0 (writes only touch `cans/` subtree) | PASS | 0 |
| F2 | `cans/_tasks` chmod 555 → `new task` | EACCES surfaced | exit 2, stderr `✗ Internal error: EACCES…`, stdout empty (§19 internal bucket; whether EACCES is "user-correctable=1" is undocumented — prior-round behavior retained) | PASS | 2 |
| F3 | cwd **inside** `cans/` itself: check/status/budget | workspace resolved (QA-06 #56) | all work normally | PASS | 0 |
| F4 | `init` inside `cans/` (§21 refuses) | §37 refusal | `✗ already inside a cans/ workspace — cd to the project root first` exit 1; JSON variant: `error` field, `root:""` (QA-06 #57 broken `Workspace: ` message fixed) | PASS | 1 |
| F5 | HOME unset / `HOME=/nonexistent-xyz` / read-only HOME | robust | status/check exit 0, no crash, no output on stderr | PASS | 0 |
| F6 | `check 04-api.md` (bare basename) | scoped check (§20 `[file]`) | issues filtered to that file (7 warnings); Structure summary stays workspace-wide; no-match semantics from commit 146bc10 | PASS (semantics UNDOC) | 0 |
| F7 | path-form file args: `check cans/04-api.md`, `./cans/04-api.md`, absolute, `../wsE/cans/04-api.md` | reasonable to accept paths | all rejected: `✗ no spec file matches "cans/04-api.md" — pass a spec filename like 04-api.md …` exit 1. Message self-explains the basename-only rule, but the rule itself is undocumented and unfriendly | DEVIATION — MINOR | 1 |
| F8 | `check nope.md` / `check cans` (dir) | §37 error (commit 146bc10) | `✗ no spec file matches "nope.md" …` exit 1 — silent full-workspace-check from QA-06 #68 fixed | PASS | 1 |
| F9 | very deep cwd (12 nested long-named dirs) | robust | check/status/budget write all fine | PASS | 0 |
| F10 | workspace via symlinked dir (`ln -s wsE ws-link; cd ws-link`) | robust | check/status fine | PASS | 0 |
| F11 | symlinked spec file (`00-symlink-spec.md → 04-api.md`) and dangling symlink inside `cans/` | flag or tolerate? | silently tolerated — no crash, no warning, output unchanged | UNDOC | 0 |
| F12 | `LC_ALL=C` / `C.UTF-8` / `POSIX` / `tr_TR.UTF-8` | unicode output stable | `check`/`status` outputs byte-identical across locales incl. `⚠ ✗ ✓ ↔ ←` glyphs; stderr 0 | PASS | 0 |
| F13 | 2× parallel `cans new adr` | no slug collision (§23 auto-increment) | `001-beta-race.md` + `002-alpha-race.md`, both created (single sample) | PASS | 0 |
| F14 | 2× parallel `init`; 3× parallel `new task`; `budget read/write` ×2 back-to-back | no corruption | init idempotent twice (both print `Workspace: <abs path>`); 3 tasks created; budget commands are pure-read planners (no FS writes → no last-writer-wins surface). Single-sample caveat | PASS | 0 |
| F15 | perf §40 (7-file init workspace; bun startup ≈13 ms) | check<100ms, status<50ms, budget read<50ms, init<50ms | check 38–40 ms, status 25 ms, budget read 31 ms, init 26 ms, help baseline 13 ms — all comfortably within budget | PASS | 0 |

---

## Findings (severity-ordered)

**BLOCKER: none.**

### MAJOR

1. **M1 — `status` misdiagnoses rejected flags as "No cans workspace found" (human mode).**
   Repro (in a valid workspace): `cans status -j`, `status --bogus`, `status -abc`,
   `status --owners=me`, `status --` → stdout `✗ No cans workspace found.` + advice to run
   `cans init`, exit 1. Expected (§37): say what actually happened. The JSON mode of the *same*
   invocations returns the true error (`unknown flag "-j" — no short flags supported`,
   `invalid flag form "--owners=me"`, `unknown flag "--"`), so the human emitter replaces the
   real usage error with a false workspace diagnosis — including actively harmful advice.
   Related NIT: the `--owners=me` remedy suggestion `--owners <value>` is wrong (flag takes no value).

2. **M2 — `budget read --limit` value validation: silent ignore + false diagnosis.**
   `--limit abc` is silently ignored (default 4096 budget, `ok:true`, exit 0 — typo degrades
   silently). `--limit -5` and any limit below the first item's cost (`--limit 1`) exit 1 with
   `✗ no files match concept "sessions" — check spelling or run \`cans status\`` — a false cause:
   the concept matches at `--limit 200`; the real condition is "budget exhausted before first
   item". Expected (§37): reject non-numeric/negative limits with what/fix; report budget
   exhaustion truthfully (or return an empty plan with ok:true).

3. **M3 — `check` still silently swallows unknown long flags (and misparses short ones).**
   `cans check --bogus` / `--abc` → full check, exit 0, no complaint (QA-06 #15 behavior
   persists in check). `cans check -j` / `-h` / `-x` → short flags are treated as the `[file]`
   positional ("no spec file matches \"-j\""). `new`, `done`, `status` all reject unknown flags
   (C18/C5) — check is the inconsistent outlier. Risk: `cans check --strcit` silently downgrades
   to non-strict in CI with exit 0. Expected: uniform rejection per §20/§37.

### MINOR

4. **Help text drift (doc/impl).** `cans help` now contains a `version` line, so it is no longer
   byte-identical to the §36 fixture (A1); help omits `budget read [--change <name>]` (§20:488,
   flag implemented) and `[--json]` on import/export lines (§20:490–491, both accepted) (A5).
5. **No per-command help; `--help` swallowed by check.** `cans help check` prints generic help;
   `cans check --help` silently runs a check (A11/A12).
6. **`--` separator inconsistent:** tolerated by `check`, rejected by `new`/`done`, and hits the
   M1 misdiagnosis on `status` (C8/C7).
7. **`check --json` adds undocumented top-level `rulesSummary`** — §35 fixture shapes no longer
   key-exact (additive drift) (D7).
8. **`budget --json read sessions`**: subcommand slot eats `--json`; envelope mislabels
   `command:"budget-read"`, `concept:"--json"` (C19).
9. **`export --from /nonexistent-dir`** → exit 0, `Exported opml → cans-export/opml (0 files)`
   — success-shaped export of nothing (D/F).
10. **`check [file]` accepts bare basenames only**; any path form (relative-with-dir, absolute)
    errors despite the file existing; multi-positionals silently folded into scope (F7/C11).
11. **`check --json` no-workspace envelope** embeds the message as an issue (`file:"",line:0`)
    instead of the `error` field every other command uses (D9).
12. **`-v` unsupported** while `-h`/`--help`/`version`/`--version` exist — asymmetric shortcuts (A9).

### NIT

13. Grammar: `1 errors` (check no-ws summary), `Exported opml … (1 files)`.
14. No did-you-mean for near-miss commands (`chek`) — generic guidance only (B2).
15. `check --json` no-ws cosmetic `file:"",line:0` issue entry (D9).
16. `help --json` returns an envelope with no content — agents can't machine-read the command
    list (D10).
17. EACCES/exit-2 path ignores `--json` (text on stderr) (D8).
18. Budget plan path rendering inconsistent: task files shown as `cans/_tasks/x.md`, spec files
    without the `cans/` prefix (A-note).

---

## What held up (changed-surface confirmations)

- **Unknown-command/usage guidance is now uniformly §37-quality** (section B: 16/16 PASS) —
  what + fix on stdout, exit 1, and JSON envelopes carry an `error` field with exit code preserved.
- **`new` no longer pollutes names with flags**; `--flag=value` and unknown flags are rejected
  on new/done/status/budget (§20 primitive parser now enforced — except check, see M3).
- **`done` diagnosis chain correct**: usage → not-found → human gate → open tasks → check,
  with correct remedies; human gates unskippable; §36 blocked-text pattern matches.
- **`--refs-only` truly scopes to the refs engine** (18→2 warnings); strict/no-redundancy/fix
  interactions all behave per §19/§22.
- **No-workspace handling is uniform** across commands (exit 1 + what/fix, human and JSON);
  `init` inside `cans/` refuses with a proper message; `new task` no longer auto-vivifies.
- **Streams**: single-stream (stdout) design is consistent everywhere except the internal
  exit-2 path (stderr) — stable and predictable for agents.
- **JSON fixture fidelity** for status/init/done/new/import/export; all `--json` output parses.
- **Robustness**: locales (incl. tr_TR), symlinks, deep paths, HOME variants, read-only dirs,
  and concurrent invocations (single sample) — no crashes, no corruption, unicode stable.
- **Performance** comfortably inside §40 (worst observed: check 40 ms incl. ~13 ms bun startup).

## Suggested next actions (for the fix branch, not done here)

1. Route `status` human-mode flag errors through the same renderer as JSON mode (fix M1).
2. Validate `--limit` (positive integer; truthful empty-plan message) (fix M2).
3. Make `check` reject unknown long flags like its sibling commands (fix M3).
4. Update §36/§35 docs: add `version` line, `rulesSummary` key, `error` field on failure
   envelopes, `budget read --change`, import/export `--json` in help; define `check [file]`
   basename-only + multi-positional scoping; define `--refs-only` semantics.
