# QA-06 — CLI Surface Contracts (Blackbox)

Task ID: 3-f | Agent: qa-cli-surface | Repo: cans-spec @ impl/full-engines, commit 54b0b52
Date: 2026-09-03 | Method: manual shell only, blackbox (no src/, no tests read)

---

## Scope & docs covered

The CLI's outermost surface: help text, exit codes, arg parsing, error-message philosophy, JSON
output contracts, stream discipline, removed commands, version surface, performance budget,
weird-environment behavior.

Docs used as spec:
- README.md (command list; note: import line omits `--out <path>`)
- docs/cans.architecture.md §19 (Output System, exit codes, strict), §20 (CLI Commands, command
  contract, arg parsing), §21 (init JSON), §25 (status exit rule), §10 (tabs rejected),
  §35 (JSON output fixtures), §36 (human text examples incl. `cans help`), §37 (error message
  philosophy), §40 (performance budget), §41 (removed commands), §44 (versioning — defines no
  version flag).

CLI invocation: `bun run /home/z/my-project/cans-spec/src/cli.ts <command>` from cwd; workspace =
`cans/` dir resolved relative to cwd (verified: also found when cwd IS a `cans/` dir).

## Environment

- bun 1.3.14, Linux. All scratch under `/home/z/my-project/qa-playground/qa-cli/` (ws-clean,
  ws-errors, ws-warn=ws-clean clone, badyaml, eisdir, binws, tabws, empty, ghost, lockws — all
  built via `cans init` + fixture files copied from test/fixtures/**; originals untouched).
- ws-clean: 7 files / 32 nodes, check = 0 errors, 9 warnings, exit 0.
- ws-errors: ws-clean with broken-refs fixture's 04-api.md → 2 errors, 10 warnings, exit 1.

---

## Test matrix

Verdicts: PASS / FAIL / DEVIATION / UNDOCUMENTED. "exit" = CLI exit code.

### A. Help (§36, §20)

| # | command | expected (doc ref) | actual | verdict | exit |
|---|---|---|---|---|---|
| 1 | `cans help` | Output byte-identical to §36 fixture (lines 1325–1344) | `diff` of extracted doc block vs stdout: **IDENTICAL**, incl. `Formats/Config/Agents` trailer | PASS | 0 |
| 2 | `cans help` flag lists vs §20 | Help flags match §20 | Help line for `export` omits `[--json]` (§20:490 lists it); CLI *does* accept `export --json` (see #47). Help `import` includes `--out <path>` = §20; README:31 omits `--out` | DEVIATION | 0 |
| 3 | `cans help` streams | Human text on stdout | stdout 688 B, stderr 0 B | PASS | 0 |
| 4 | `cans help frobnicate` / `cans help --json` | Undocumented | Extra args ignored, help shown; `help --json` prints `{ok:true,command:"help",exitCode:0}` | UNDOCUMENTED | 0 |

### B. Exit codes (§19)

| # | command | expected | actual | verdict | exit |
|---|---|---|---|---|---|
| 5 | `check`, `status`, `budget read sessions`, `export opml`, `init`, `help` in healthy ws | 0 = success | all 0 | PASS | 0 |
| 6 | `cans check` in ws-errors | 1 = user-correctable failure ("2 errors") | 1, report on stdout | PASS | 1 |
| 7 | `cans check` / `status` with `chmod 000 cans/` | 2 = internal unexpected error (top-level catch) | 2; stderr: `✗ Internal error: EACCES: permission denied, scandir '…/cans'`; stdout empty | PASS | 2 |
| 8 | run from deleted cwd (dir rm'd while cwd) | Undocumented | bun runtime intercepts: `error: The current working directory was deleted…` on stderr | UNDOCUMENTED | 1 |
| 9 | `check` on warnings-only ws (0 errors, 9 warnings) | Warnings never affect exit code | 0 | PASS | 0 |
| 10 | same + `--strict` | Strict turns warnings into failure | 1 (human report still printed) | PASS | 1 |
| 11 | `check --strict --json` warnings-only | ok:false, exitCode 1 | `{ok:false,exitCode:1,errorCount:0,warningCount:9}` | PASS | 1 |

### C. Arg parsing contract (§20 "Primitive. `--flag value` only.")

| # | command | expected | actual | verdict | exit |
|---|---|---|---|---|---|
| 12 | `budget read sessions --limit 10` | Space form applies | Plan empty (16-tok item pushed to skipped) | PASS | 0 |
| 13 | `budget read sessions --limit=10` | Equals form NOT accepted → error or treated as value | **Silently ignored**: full plan returned as if no limit; no warning, exit 0 | FAIL | 0 |
| 14 | `import … --merge-strategy=cans-wins` | Equals form not accepted | Silently ignored, proceeds with default | FAIL | 0 |
| 15 | `status --bogus` | Unknown flag should error | Silently ignored, normal status | FAIL | 0 |
| 16 | `status -j` | No short flags → should error | Silently ignored → **human** output while user asked JSON | FAIL | 0 |
| 17 | `check -fs` | No combined flags → should error | Silently ignored, plain check | FAIL | 0 |
| 18 | `budget read sessions --limit` (missing value) | Malformed → should error | Silently ignored (default limit), exit 0 | FAIL | 0 |
| 19 | `new task add-dark-mode --json` | Flag parsed as flag | **`--json` swallowed into name**: creates `_tasks/add-dark-mode-json.md` (JSON is emitted, but slug polluted; §35 `new.json` change name unreachable as documented) | FAIL | 0 |
| 20 | `new task --json` (no name) | Should error "name required" | Exit **0**, creates `_tasks/json.md` (flag became the name) | FAIL | 0 |

### D. Unknown command / no args / version (§37, §41, §44)

| # | command | expected | actual | verdict | exit |
|---|---|---|---|---|---|
| 21 | `cans frobnicate` | §37: say what happened, why, how to fix (e.g. "Unknown command… run `cans help`") | stdout: bare JSON `{"ok":false,"command":"frobnicate","exitCode":1}` — **no message at all**, and JSON despite default-human-text mode | FAIL | 1 |
| 22 | `cans` (no args) | Undocumented; matrix expectation: help shown | Bare JSON `{"ok":false,"command":"unknown","exitCode":1}`; no help | UNDOCUMENTED | 1 |
| 23 | `cans version` / `--version` / `-v` / `-h` / `--help` | §44 defines no version flag; `-h/--help` conventional | All treated as unknown commands (#21 behavior). No version surface exists | UNDOCUMENTED | 1 |
| 24 | `search`, `graph`, `context`, `diff`, `refs`, `validate`, `stats`, `apply` (§41) | Removed → rejected cleanly, not executed | All exit 1, never execute; but rejection message = same bare JSON (no text) | PASS | 1 |
| 25 | `cans import csv <file>` (bad format) | §37 message naming valid formats | exit 1, prints `Imported csv from <path>` (success-looking, blanks for results), no message | FAIL | 1 |

### E. Missing required args (§37)

| # | command | expected | actual | verdict | exit |
|---|---|---|---|---|---|
| 26 | `cans done` | "usage: cans done <name>" style error | `✗ BLOCKED: cans check failed (--skip-check to override)` — **false diagnosis**: `check` exits 0 in same ws | FAIL | 1 |
| 27 | `done foo` (no such task) | "task not found" | Same false "check failed" message | FAIL | 1 |
| 28 | `done plain-name` (already archived) | "task not found" | Same false message | FAIL | 1 |
| 29 | `done foo --skip-check` | Remedy works or better message | Byte-identical false message; remedy changes nothing | FAIL | 1 |
| 30 | `budget read` | "concept required" | exit 1, prints success-shaped `Reading plan for: ` + `Budget: 0 / 0 tokens (0%)` | FAIL | 1 |
| 31 | `budget read zzz-not-a-concept` | "concept not found" + hint | exit 1, success-shaped empty plan, no message | FAIL | 1 |
| 32 | `budget write` | "concept required" | exit 1, success-shaped `Writing scope for: ` with empty sections | FAIL | 1 |
| 33 | `cans import` / `import obsidian` | "format/path required" | exit 1, `Imported  from ` / `Imported obsidian from ` (success-shaped blanks) | FAIL | 1 |
| 34 | `cans export` | "format required" | exit 1, `Exported  →  (0 files)` (success-shaped blanks) | FAIL | 1 |
| 35 | `cans new` / `new adr` / `new task` | "kind/title required" | exit 1, error message is literally **`✗ `** (empty) | FAIL | 1 |

### F. JSON contract (§19, §35)

| # | command | expected | actual | verdict | exit |
|---|---|---|---|---|---|
| 36 | `check --json` (clean ws) | §35 check-clean.json shape | Keys exact: ok,command,exitCode,files,nodes,maxDepth,refs{total,broken,deepHops},backPointers{total,current,stale},issues[{file,line,level,category,message,suggestion?}],errorCount,warningCount,backPointersUpdated | PASS | 0 |
| 37 | `check --json` (ws-errors) | §35 check-errors shape | VALID JSON, ok:false, exitCode:1, errorCount 2 / warningCount 10 | PASS | 1 |
| 38 | `check --fix --json` | §35 check-fix shape (backPointersUpdated) | VALID, field present | PASS | 0 |
| 39 | `status --json` (tasks exist) | §35 status.json shape incl. tasks{}, owners{}, taskFiles[{name,tasksDone,tasksTotal,gatesDone,gatesTotal,blocked}], conflicts | Keys + nesting exact | PASS | 0 |
| 40 | `budget read sessions --json` | §35 budget-read.json: command:"budget-read", plan[{file,anchor,reason,score,estTokens}], skipped[], totals | Keys exact | PASS | 0 |
| 41 | `budget write sessions --json` | §35 budget-write.json | Keys exact: canEdit, mustNotEdit, backPointersToUpdate | PASS | 0 |
| 42 | `done <task> --json` (completed) | §35 done-success.json: gates{human,humanOpen,tasks,tasksOpen}, archived, backPointersUpdated | Keys exact; archived `_tasks/_archive/<date>-<name>.md` | PASS | 0 |
| 43 | `done <task> --json` (blocked) | §35 done-blocked-human.json | ok:false, exitCode:1, archived:null, gates counts correct | PASS | 1 |
| 44 | `new task/adr --json` | §35 new.json {ok,command,exitCode,change,file} | Keys exact (name-pollution bug tracked in #19) | PASS | 0 |
| 45 | `init --json` | §21/§35: created[], skipped[], root | Keys exact; root = absolute path (fixture shows `./cans`; acceptable) | PASS | 0 |
| 46 | `import obsidian <f> --json --dry-run` | §35 import.json | Keys exact: format,source,newFiles[],merged[],conflicts[] | PASS | 0 |
| 47 | `export opml --json` | §35 export.json | Keys exact: format,outputDir,filesExported | PASS | 0 |
| 48 | error paths with `--json` (done/export/budget/import missing args, status no-ws) | JSON-parseable even on failure | All VALID JSON, ok:false + exitCode:1 — but **no message/error field anywhere**, payloads all zeros/empty | PASS | 1 |
| 49 | `budget read zzz --json` | §35 shape + failure indicated | VALID, ok:false, exitCode:1, empty plan — again no reason field | PASS | 1 |

### G. Stream discipline (§19 — undocumented detail)

| # | command | expected | actual | verdict | exit |
|---|---|---|---|---|---|
| 50 | `help` / `check` / `check --json` / error-path `check` / `done` blocked / unknown command: `1>/dev/null` vs `2>/dev/null` splits | — | **All user-level output AND all user-level errors on stdout; stderr 0 bytes in every case.** Only the top-level internal-error handler (#7) writes stderr | UNDOCUMENTED | — |

### H. Weird environments

| # | command | expected | actual | verdict | exit |
|---|---|---|---|---|---|
| 51 | `check` in dir with no `cans/` | §37-quality message | exit 1 with good message embedded as issue: `✗ :0 — no cans workspace found — run \`cans init\` or cd into a project with a cans/ directory` (cosmetic `:0` file:line; rest of report renders zeros) | PASS | 1 |
| 52 | `status` in dir with no `cans/` | §25: "only exits 1 if cans/ missing" — exit correct | exit 1 **but success-looking** `Files: 0 specs…` with zero explanation | FAIL | 1 |
| 53 | `budget read sessions`, no `cans/` | Error message | exit 1, success-shaped `Reading plan for: sessions / Budget: 0 / 0 tokens (0%)` | FAIL | 1 |
| 54 | `new task foo`, no `cans/` | Refuse: no workspace | exit **0**; silently **creates partial workspace** `cans/_tasks/foo.md` and prints `Created _tasks/foo.md` (hides `cans/` prefix) | FAIL | 0 |
| 55 | `export opml`, no `cans/` | Refuse: no workspace | exit 0, `Exported opml → …/cans-export/opml (0 files)`, nothing created | DEVIATION | 0 |
| 56 | `check`/`status` with cwd **inside** `cans/` | Undocumented | Both work normally (workspace still resolved) | UNDOCUMENTED | 0 |
| 57 | `init` inside `cans/` (§21 "refuses") | Clear refusal message | exit 1 — but the entire message is **`Workspace: `** (empty root, no reason, no fix) | FAIL | 1 |
| 58 | `check` with spec file replaced by a **directory** (`cans/02-authentication.md/`) | Flag malformed entry | Silently skipped: 6 files instead of 7, check passes, no warning | DEVIATION | 0 |
| 59 | `check` with invalid `_rules.yaml` (bad YAML) | §37 message + fix | exit 1: `✗ :0 — invalid _rules.yaml: line 3: unbalanced inline array: [unclosed` (good cause, no fix hint, `:0` cosmetic) | PASS | 1 |
| 60 | `check` with tab-indented spec file | §10: tabs rejected | exit 1: `✗ 07-tabs.md:0 — parse error: … tab indentation rejected (use 2 spaces)` | PASS | 1 |
| 61 | `check` with 64 random bytes as spec file | Undocumented | exit 0; counted as file + orphan warning; no parse complaint (non-bullet lines ignored per §10) | UNDOCUMENTED | 0 |

### I. Performance (§40) & misc

| # | command | expected | actual | verdict | exit |
|---|---|---|---|---|---|
| 62 | `time` (7 files/32 nodes ws) | §40: check<100ms, status<50ms, budget read<50ms, init<50ms | check 37ms, check --json 36ms, status 27ms, budget read 30ms, init 32ms; `help` baseline (bun startup) 16ms. All comfortably within budget | PASS | 0 |
| 63 | `import … --dry-run` twice + md5sum | Dry-run mutates nothing | `cans/04-api.md` md5 unchanged | PASS | 0 |
| 64 | `export opml --dry-run` | Dry-run mutates nothing | No dir created; but text says "Exported … (7 files)" — misleading verb | PASS | 0 |
| 65 | `check --no-redundancy` | Redundancy engine off | Redundancy warnings gone (9→6 warnings) | PASS | 0 |
| 66 | `check --refs-only` | Undocumented semantics | Does NOT limit output to refs; only suppresses the Redundancy section; Structure/Style/Overflow still printed | UNDOCUMENTED | 0 |
| 67 | `status --unclaimed --blocked --owners` | Flags accepted | exit 0, runs | PASS | 0 |
| 68 | `check cans/04-api.md` / `check nope.md` (positional file arg, §20) | Per-file check or error | Both silently run full-workspace check, exit 0 (nonexistent file ignored) | DEVIATION | 0 |

---

## Findings

Severity scale: blocker / major / minor / ux.

1. **MAJOR — `done` misdiagnoses every failure as "check failed".**
   Repro: `cans done` (no name), `cans done nonexistent`, `done <archived>`, `done … --skip-check`,
   or any `done` in a dir without `cans/` → all print `✗ BLOCKED: cans check failed (--skip-check
   to override)`, exit 1. Expected (§37): the real cause ("no task name given", "task not found",
   "no cans workspace"). The message is *false* — `cans check` exits 0 in the same workspace — and
   the printed remedy (`--skip-check`) changes nothing (byte-identical output).

2. **MAJOR — Missing required args produce blank-filled success-shaped output or an empty error.**
   `budget read` → `Reading plan for: ` (exit 1); `budget write` → `Writing scope for: `;
   `import [format]` → `Imported  from `; `export` → `Exported  →  (0 files)`; `new`/`new adr`/
   `new task` → literally `✗ ` with nothing after it. All exit 1 with stderr empty. Violates §37
   ("say what happened… never error codes without messages"): a user/agent cannot tell what went
   wrong; the output looks like success with blanks.

3. **MAJOR — Unknown command / no args / bad format: bare JSON, no message, wrong stream+mode.**
   `cans frobnicate`, `cans` (no args), all §41 removed commands, `cans import csv …` → stdout:
   `{"ok":false,"command":"<name>","exitCode":1}`. No human hint ("Unknown command, run `cans
   help`"), and JSON is emitted although `--json` was not passed (contradicts §19 default human
   text). Same bare-JSON shape (no message field) on every `--json` error path — agents can detect
   failure but never the reason.

4. **MAJOR — Arg parser silently swallows malformed/unknown flags** (§20 says these forms are not
   supported; actual behavior is silent ignore, not rejection):
   - `--flag=value` ignored: `budget read sessions --limit=10` returns the *unlimited* plan, exit 0;
   - unknown flags ignored: `status --bogus` runs normally, exit 0;
   - short flags ignored: `status -j` prints human text, exit 0 (user asked for JSON);
   - combined flags ignored: `check -fs` runs as plain check;
   - flag with missing value ignored: `budget read sessions --limit` → default limit, exit 0.
   Risk: typos (`--jsoo`, `--strct`) silently degrade behavior with exit 0. Expected: error per
   §20/§37, or at minimum a warning.

5. **MAJOR — `new` appends flags into the created name.** `cans new task add-dark-mode --json`
   creates `_tasks/add-dark-mode-json.md`; `cans new adr "Use postgres" --json` creates
   `_adr/001-use-postgres-json.md`; `cans new task --json` (no name) exits **0** creating
   `_tasks/json.md`. `new` does not parse flags at all — everything after the kind is joined into
   the title, yet `--json` is *also* honored for output mode. Makes the §35 `new.json` contract
   unreachable without polluting the name.

6. **MAJOR — No-workspace handling is inconsistent across commands.**
   - `check`: good message, exit 1 (PASS);
   - `status`: exit 1 (per §25) but prints a success-looking all-zeros status, no explanation;
   - `budget read`: exit 1, success-shaped output, no message;
   - `export`: exit 0, "Exported … (0 files)" — exports nothing from nothing;
   - `new task`: exit 0 and **auto-vivifies a partial workspace** (`cans/_tasks/foo.md`) while
     printing `Created _tasks/foo.md` (hides the `cans/` prefix). No other command creates `cans/`;
     only `init` should.
   Expected: uniform "no cans workspace found — run `cans init`" + exit 1 (the `check` message).

7. **MINOR — `init` refusal inside a `cans/` directory has a broken message.** §21 requires
   refusal (behavior correct, exit 1) but the whole output is `Workspace: ` — no root, no reason,
   no fix.

8. **MINOR — Stream asymmetry.** All user-level errors (missing args, unknown command, broken refs,
   blocked done) go to **stdout** with empty stderr; only internal errors (EACCES → exit 2) go to
   stderr. Self-consistent for agents (one stream), but undocumented in §19 and unfriendly to
   `2>/dev/null`-style shell hygiene.

9. **MINOR — Malformed workspace entries silently tolerated by `check`.** A directory named
   `02-authentication.md` (EISDIR case) is skipped without warning (6 files counted vs 7); a binary
   file passes as an empty spec (orphan warning only). Combined with #10: a mistyped positional
   (`check nope.md`) is ignored and the full workspace is checked with exit 0.

10. **MINOR — Doc/CLI inconsistencies (documentation bugs, not code).** §36 help text omits
    `[--json]` on the `export` line while §20:491 lists it (CLI accepts `export --json`);
    README's `import` line omits `[--out <path>]` while §20 and the actual help include it. Help
    itself is byte-identical to the §36 fixture.

11. **UX — No version or help shortcuts.** `--version`/`-v`/`version`/`-h`/`--help` are all
    rejected as unknown commands (bare JSON, exit 1). §44 defines versioning but no flag; `-h` /
    `--help` are conventional gaps.

12. **UX — Dry-run verbs.** `import/export --dry-run` print "Imported…/Exported…" and, for
    `export`, a file count — reads like a completed side-effect (no mutation actually occurs;
    verified via md5/dir listing).

13. **UX — `--refs-only` naming.** Suppresses only the Redundancy section; Structure/Style/Overflow
    still reported. Semantics undocumented in §20.

---

## Observations (non-findings)

- Help output is **byte-identical** to the §36 fixture — rare and excellent.
- Every §35 JSON fixture shape tested (check clean/errors/fix, status, budget read/write, done
  success/blocked, new, init, import, export) matches key-for-key and nesting-for-nesting.
- Exit-code triad (0/1/2) is real: EACCES on `cans/` reliably produces exit 2 via a top-level
  handler (`✗ Internal error: …` on stderr); user-correctable failures produce 1; success 0.
- `--strict` semantics per §19 work in both text and JSON modes (`ok:false` with 0 errors).
- Deleted-cwd and EACCES cases degrade gracefully (bun runtime message / `✗ Internal error`).
- `--strict` on warnings-only ws: report still fully printed to stdout — good.
- JSON payloads contain no message/error field on failure paths; §35 fixtures don't define one,
  so this is a spec gap worth closing (e.g. optional `"message"` on error results).
- `status`/`check` work when cwd is *inside* `cans/` — undocumented but handy; worth documenting.

## Verdict summary

- Tests recorded: **68** matrix rows (≈100+ individual CLI invocations across multi-command rows).
- **PASS: 32 | FAIL: 24 | DEVIATION: 4 (#2, #55, #58, #68) | UNDOCUMENTED: 8 (#4, #8, #22, #23, #50, #56, #61, #66)**.
- The core plumbing is solid: exit-code triad, JSON fixture fidelity, strict semantics, help text,
  performance. The outermost error surface is where the implementation diverges hardest from
  §37: silent flag swallowing (#4, #5), blank/false error messages (#1, #2, #3), and inconsistent
  no-workspace behavior (#6).
- No blockers found; 6 majors, all in error/diagnostic paths rather than happy paths.
