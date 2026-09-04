# QA-05 — Interop: `cans import` / `cans export` (Task 3-e)

- Agent: qa-interop (blackbox manual QA)
- Repo: /home/z/my-project/cans-spec @ branch `impl/full-engines`, commit `54b0b52` (repo untouched except this report)
- Date: session of QA cycle 3

## Scope & docs covered

- `docs/cans.architecture.md`: §19 (Output System, exit codes), §20 (CLI Commands/arg parsing), §27 (import), §28 (export), §31 (Converter Internals: shared utils, OPML, Logseq, Obsidian), §32 (filesystem discovery), §34 (import fixtures: dynalist-export.opml, logseq-page.md, obsidian-note.md), §35 (output/import.json, output/export.json), §36 (help text), §37 (Error Message Philosophy).
- `README.md` (Commands / Formats).
- `cans help` output (matches §36 verbatim).
- Fixtures used as input data only (copied to scratch): `test/fixtures/import-fixtures/*`, `test/fixtures/flat-project/*`.

## Environment

- bun 1.3.14; CLI invoked as `bun run /home/z/my-project/cans-spec/src/cli.ts <cmd>`; Linux sandbox.
- Scratch workspaces under `/home/z/my-project/qa-playground/qa-interop/` (ws1–ws9, m-*, exp1, exp2, rt1, brk, confirm, nows, customout, fixtures/).
- Workspace convention discovered: every command operates on `./cans/` under the current working directory (created by `cans init`; import writes `cans/NN-name.md`; export writes `cans-export/<format>/` under cwd). `help` confirms: "Config: cans/_rules.yaml", "Agents: cans/AGENTS.md".

## Test matrix

Verdicts: PASS / FAIL / DEVIATION (works but contradicts a documented contract) / UNDOCUMENTED. All exit codes observed.

| # | Command (cwd context) | Expected (doc ref) | Actual | Verdict |
|---|---|---|---|---|
| 1 | `help` | import/export lines per §36/§20 | Matches §36 verbatim; but §20 lists `--json` for import+export and `--include-tasks` for export — none shown in help; README shows `--json` for export but omits import `--json` and export `--include-tasks` | UNDOCUMENTED (doc drift §20 vs help vs README) |
| 2 | `init --bare` (setup) | creates `./cans/` (§21) | `cans/` with `_rules.yaml`, `AGENTS.md`, `00-overview.md` | PASS |
| 3 | `import opml ../fixtures/dynalist-export.opml` (fresh ws, relative path) | preserve hierarchy (§27), nesting per §34 | `cans/07-authentication.md`: Authentication→Sign up→Email/Google, Authentication→Sessions→Expire after 24 hours, Dashboard→Requires verified account; hierarchy exact; `+ 07-authentication.md`; exit 0 | PASS |
| 4 | same, `--json` | §35 import.json shape | `{ok, command:'import', exitCode, format, source, newFiles:[07-authentication.md], merged:[], conflicts:[]}` | PASS |
| 5 | same, absolute path (in ws3), and relative from unrelated cwd | same as #3/#4 | absolute: works, exit 0. From cwd without `cans/`: exit 1, JSON `ok:false` with **no error field**; human line says "Imported opml from …" (false success), nothing written | absolute PASS; no-workspace FAIL (see F1) |
| 6 | `import logseq ../fixtures/logseq-page.md` (§34) | §31: TODO/DONE→checkboxes, wiki-links→see:, strip `((block-refs))`, `key:: value` | `07-implement-auth-flow.md`: `- [ ] Implement auth flow` ✓, `- [x] Add Google OAuth` ✓, `id::`/`((block-ref-123))` stripped ✓; but `[[02-authentication#Sessions]] expire after 24 hours` → `see: 02-authentication#Sessions expire after 24 hours` (trailing text glued into ref target, no `.md`) → `cans check`: "1 broken ref"; `agent-1:: assigned` dropped (owner lost) | DEVIATION→FAIL (F2, F3) |
| 7 | `import obsidian ../fixtures/obsidian-note.md` (§34) | §31: strip frontmatter/tags, wiki-links+embeds→see:, keep checkboxes, handle callouts | frontmatter stripped ✓, `- [ ]` kept ✓, `[[02-authentication#Sessions|Session rules]]` → `see: 02-authentication#Sessions` (alias dropped, no `.md` → broken ref), `![[error-codes]]` → `see: error-codes` ✓-ish; **callout `> [!note] Decision / Use token bucket algorithm` silently dropped** | FAIL (F2, F4) |
| 8 | import md with fenced code block (obsidian + logseq, ws9) | §27: "Extract code blocks → overflow files" | fenced `json`/`yaml` blocks silently deleted; no overflow file created; node "Request schema" left childless | FAIL (F5) |
| 9 | import opml with `_note="details here"` | §31: OPML handles `text` + `_note` | `_note` content silently dropped | DEVIATION (minor, F6) |
| 10 | multi-root OPML (2 top-level outlines) | unspecified | both roots merged into ONE file named after first root (`07-authentication.md` holds Authentication + Dashboard) | UNDOCUMENTED |
| 11 | `--dry-run` (opml, logseq, obsidian) + md5sum/ls before/after | preview, nothing written | nothing written (files unchanged, no new files) ✓ exit 0; but human text and `--json` are byte-identical to a real run (no "dry run" marker, no `dryRun` field) | PASS on effect; DEVIATION-minor on output (F7) |
| 12 | `import dynalist …` alias | §27 dynalist = alias of opml | works; `format: "dynalist"` in output | PASS |
| 13 | import same opml twice, default (cans-wins), no edits | cans-wins "only adds new nodes" (§27) | 2nd run: `merged:[07-authentication.md]`, file unchanged, exit 0 | PASS |
| 14 | cans-wins with real conflict (edit node to `CHANGED-BY-HUMAN`, re-import) | conflict reported (§35 conflicts[] with `resolution`), CANS version kept, import version not added | CANS text kept in place ✓ BUT import node **appended as child of the last node of the file** (`Dashboard → Requires verified account → Expire after 24 hours`): structural corruption + duplicate concept; `conflicts: []` | FAIL (F8, blocker-level data corruption) |
| 15 | `--merge-strategy import-wins` with conflict | overwrites on conflict (§27) | file replaced with import tree (correct outcome); `conflicts:[]` never populated | DEVIATION (F9) |
| 16 | `--merge-strategy ask` with conflict | "report conflicts, don't merge" (§27) | does not merge ✓; but nothing reported: human output silent, `conflicts:[]` | FAIL (F9) |
| 17 | `--merge-strategy banana` | invalid enum → §37-style error | silently accepted, behaves as default, exit 0 | FAIL (minor, F10) |
| 18 | `--out ../customout` | README/§20/§36 advertise `--out <path>` | flag ignored: file still written to `cans/07-authentication.md`, `../customout` left empty | FAIL (F11, major) |
| 19 | `import workflowy x.md` | unknown format → §37 error ("say what happened, why, how to fix"), list valid formats | exit 1; first line "Imported workflowy from x.md" (false success); no reason, no valid-format list; JSON `ok:false` with no message field | FAIL (F1) |
| 20 | `import opml nope.opml` (nonexistent) | §37 error | exit 1; "Imported opml from nope.opml" false success; silent otherwise | FAIL (F1) |
| 21 | empty file (opml / logseq) | unspecified | exit 0, "Imported …", zero files created, no warning | UNDOCUMENTED (silent no-op success) |
| 22 | garbage `.opml` (non-XML text) | §31 regex XML parse → should reject invalid OPML (§37) | exit 0, "Imported …" success, zero files; no error | FAIL (minor, F12) |
| 23 | `import opml adir` / `import obsidian adir` (directory) | §37 error | exit 1; false-success line; silent | FAIL (F1) |
| 24 | `import` / `import opml` / `export` (missing args) | usage message (§37) | exit 1; messages "Imported  from " / "Exported  →  (0 files)" | FAIL (F1) |
| 25 | `export opml` (flat-project in `exp1/cans`) | §28 + §35 export.json (outputDir `cans-export/opml`) | `cans-export/opml/*.opml` (cwd-relative), 3 files, hierarchy preserved, `<!-- ref-by -->` stripped, `see: X.md#Y` → `→ X.md#Y` per §28 table, valid OPML XML | PASS |
| 26 | `export logseq` / `export obsidian` | §28 table: `[[X/Y]]`, `[[X#Y]]` | exact match | PASS |
| 27 | `export dynalist` / `export all` | §28 formats | dynalist = opml output; all → 4 subdirs, 12 files | PASS |
| 28 | `export opml --json` | §35: `{ok, command, exitCode, format, outputDir, filesExported}` | shape matches; `outputDir` absolute where fixture shows relative `cans-export/opml`; with `--vault` it echoes the literal arg (`../myvault/obsidian`) — inconsistent formatting | DEVIATION (minor, F13) |
| 29 | `export opml --dry-run` (clean dir) | nothing written | no `cans-export/` created ✓ exit 0; message identical to real run | PASS on effect; minor output issue (F7) |
| 30 | `export opml --include-tasks` | task file exported; §28 "Preserve … checkboxes" + table (`- [ ] task` → `- [ ] task` for OPML) | `add-dark-mode.opml` created; owners `← agent-1`→`[agent-1]` ✓, `← @human`→`⏳ Human` ✓; **checkbox state `[ ]`/`[x]` dropped entirely in OPML** (done vs open indistinguishable). Logseq (`TODO/DONE`, `agent-1:: assigned`, `⏳ Human`) and Obsidian (`[x]`, `🤖 agent-1`, `⏳ Human`) correct | OPML FAIL (F14); logseq/obsidian PASS |
| 31 | `export opml --from ../exp2` (workspace root) vs `--from ../exp2/cans` | §20 `[--from <path>]` (semantics undocumented) | workspace root → 0 files; must point at the `cans/` dir itself → 1 file ✓; `--from /nonexistent` → `ok:true, filesExported:0`, exit 0 (no error); prior output files left stale in `cans-export/opml/` | DEVIATION (F15) |
| 32 | `export obsidian --vault ../myvault` | only in usage strings, not §28 | output redirected to `../myvault/obsidian/` ✓; `--vault` with no value silently ignored (default dir used), exit 0 | PASS (feature); UNDOCUMENTED (semantics) + minor arg-handling gap (F10) |
| 33 | Round-trip: export opml (exp1) → import into fresh rt1 → diff | §45 "OPML/Logseq/Obsidian roundtrips pass" | nesting + node text identical (only diff: original `<!-- ref-by -->` comment, correctly stripped); `see:` refs return as literal `→` text — `cans check` on rt1: **0 see: refs** (refs lost) + resulting orphan/redundancy warnings | DEVIATION (lossy refs, F16) |
| 34 | import/export on structurally broken workspace (node >120 chars, broken ref) | §27 "Let cans check report issues after" | both proceed unguarded, exit 0; broken ref exported as literal `→ nowhere.md` | PASS (per spec: no guard expected) |
| 35 | `export opml` in empty workspace (`cans/` with 0 spec files) | unspecified | `ok:true, filesExported:0`, exit 0, no output dir created, no warning | UNDOCUMENTED |
| 36 | `export OPML` / `import OPML` (uppercase) | formats listed lowercase; §37 error quality | exit 1; `format:"OPML"` echoed; messages "Exported OPML →  (0 files)" / "Imported OPML from …" (false success, no valid-format list); JSON has no error field | FAIL (F1, F17) |
| 37 | export exclusions (`_collab/`, `_adr/`, `_rules.yaml`, `AGENTS.md`, `_adr/_archive/` present) | §28 excludes `_collab/`, `_adr/_archive/`, `_rules.yaml`, `AGENTS.md` — implying active `_adr/` IS exported | `_collab/`, `_rules.yaml`, `AGENTS.md`, `_adr/_archive/` excluded ✓; but active `_adr/001-test.md` also excluded | DEVIATION (minor, F18) |

## Findings

### F1 — BLOCKER (ux/§37): all import/export failures print a false-success line and give no reason
- Repro (any of): run `cans import opml nope.opml` (or `import workflowy x`, path=directory, uppercase format, missing args, or import from a cwd without `cans/`) → first output line is always `Imported <format> from <path>` / `Exported <format> →  (0 files)`, then exit 1 with no explanation; `--json` returns `ok:false` with **no error/message field anywhere**.
- Expected: §37 — `✗ <what> / <where>: <detail> / <what to do>`; e.g. "✗ No CANS workspace found in <cwd>. Run `cans init` first." Unknown format should list valid formats (`opml, dynalist, logseq, obsidian` / + `all` for export); missing args should print usage.
- Actual: misleading success text + silent failure. Users/agents get zero actionable information; the JSON contract (§35) has no place signaling why.

### F2 — MAJOR: generated `see:` refs never include `.md` → guaranteed broken refs
- Repro: `cans import logseq test/fixtures/import-fixtures/logseq-page.md` (or obsidian fixture) in a fresh workspace, then `cans check`.
- Expected: §3/§4 canonical ref form `see 02-authentication.md#Sessions`; §45 "roundtrips pass".
- Actual: `see: 02-authentication#Sessions` → `cans check`: "broken ref: see 02-authentication — file not found" (verified: adding `.md` by hand fixes it). Every wiki-link import produces a broken ref unless the target filename coincidentally has no `.md`.

### F3 — MAJOR: logseq wiki-link import glues trailing text into the ref target
- Repro: import `logseq-page.md`; line 2 of output: `see: 02-authentication#Sessions expire after 24 hours`.
- Expected: `[[02-authentication#Sessions]] expire after 24 hours` → ref target `02-authentication.md#Sessions` + remaining text as node content (ref line unambiguous).
- Actual: trailing prose becomes part of the `see:` target → ref unresolvable even after adding `.md` (`02-authentication.md#Sessions expire after 24 hours` is not an anchor).

### F4 — MAJOR (data loss): Obsidian callouts silently dropped on import
- Repro: import `obsidian-note.md` (contains `> [!note] Decision` / `> Use token bucket algorithm`).
- Expected: §31 "Handles callout markers (`> [!note]`)" — content preserved (as node(s)), not deleted.
- Actual: callout content vanishes; no trace in imported file, no warning.

### F5 — MAJOR (data loss): code blocks dropped instead of extracted to overflow files
- Repro: `cans import obsidian codeblock.md` / `cans import logseq cb2.md` where the md contains a fenced `json`/`yaml` block under a bullet.
- Expected: §27 "Extract code blocks → overflow files" (e.g. `Request schema: see 07-api/request-schema.md` + overflow file).
- Actual: fenced content deleted; no overflow file; no warning. Silent loss of exactly the content CANS says must live in overflow files.

### F6 — MINOR: OPML `_note` attribute dropped
- Repro: `<outline text="Auth" _note="details here">` → imported as bare `Auth`.
- Expected: §31 says the OPML converter "handles" `_note`; content should survive (e.g. as child node).
- Actual: discarded silently.

### F7 — MINOR (ux): `--dry-run` output indistinguishable from a real run
- Repro: `import opml X --dry-run` / `export opml --dry-run`.
- Expected (good practice, §19/§36 spirit): preview wording ("would import/export…", "DRY RUN") and/or `dryRun: true` in JSON.
- Actual: byte-identical text and JSON to a real run. Side effects correctly absent (verified via md5sum/ls), but the printed "Imported …" / "Exported → …" claims are literally false under --dry-run.

### F8 — BLOCKER (data corruption): `cans-wins` merge appends conflicting node under the WRONG parent
- Repro (deterministic, 3 steps): fresh ws → `import opml dynalist-export.opml` → edit `Expire after 24 hours` → `Expire after 48 hours` in `cans/07-authentication.md` → re-import with default strategy.
- Expected: §27 cans-wins "only adds new nodes" (conflicting node not added) and §35 conflict entry `{file, line, cansVersion, importVersion, resolution:'cans-wins'}`.
- Actual: import node appended as child of the LAST node of the file (`Dashboard → Requires verified account → Expire after 24 hours`), producing a wrong hierarchy + duplicate concept; `conflicts: []`; exit 0. Re-confirmed with an unrelated edit string.

### F9 — MAJOR: `conflicts[]` is never populated; `ask` doesn't report
- Repro: any conflicting re-import under `cans-wins`, `import-wins`, or `ask`.
- Expected: §27 ("ask: report conflicts") + §35 conflicts shape.
- Actual: `conflicts: []` in all cases; `ask` merges nothing (correct) but reports nothing — a machine consumer cannot learn a conflict happened.

### F10 — MINOR: invalid enum values accepted silently
- Repro: `--merge-strategy banana` (behaves as default, exit 0); `export obsidian --vault` (missing value → flag silently ignored, default output dir used, exit 0).
- Expected: §37-style arg validation ("unknown merge strategy 'banana'; valid: cans-wins, import-wins, ask").
- Actual: no validation anywhere on the interop flags.

### F11 — MAJOR: `import --out <path>` is a no-op
- Repro: `cans import opml ../fixtures/dynalist-export.opml --out ../customout` in fresh ws.
- Expected: README/§20/§36 all advertise `--out <path>` for import (files created at `<path>` instead of workspace default).
- Actual: file written to `cans/07-authentication.md`; `../customout` stays empty; flag accepted without error or effect.

### F12 — MINOR: non-XML "OPML" accepted as success
- Repro: file containing `not xml at all {{{ >>>` → `cans import opml garbage.opml` → exit 0, "Imported opml from garbage.opml", 0 files.
- Expected: reject with §37 message ("not valid OPML/XML …").
- Actual: silent success-no-op; a real Dynalist export that got truncated/corrupted would import nothing while claiming success.

### F13 — MINOR: `export --json` `outputDir` formatting inconsistent + deviates from fixture
- Repro: `export opml --json` → absolute path; `export obsidian --vault ../myvault --json` → literal `../myvault/obsidian`; §35 fixture → relative `cans-export/opml`.
- Impact: machine consumers can't rely on a stable form.

### F14 — MAJOR: OPML export drops checkbox state
- Repro: `cans export opml --include-tasks` on flat-project (`_tasks/add-dark-mode.md` has `- [x]`/`- [ ]` items).
- Expected: §28 "Preserve indentation, checkboxes, owner arrows" + table row `- [ ] task` → `- [ ] task` (OPML keeps checkboxes).
- Actual: `<outline text="Add ThemeContext provider [agent-1]"/>` — no `[ ]`/`[x]` marker; done vs open tasks indistinguishable in the OPML export (Logseq and Obsidian exports preserve state correctly).

### F15 — MINOR/DEVIATION: `export --from` semantics undocumented; no error on missing source; stale outputs
- Repro: `--from <workspace-root>` → 0 files; `--from <cans-dir>` → works; `--from /nonexistent` → `ok:true, filesExported:0`, exit 0; previous files in `cans-export/opml/` left untouched (stale mix possible).
- Expected: document that `<path>` is the spec dir (or accept workspace root); error on nonexistent source (§37); ideally clean/segment output per run.

### F16 — DEVIATION: OPML round-trip loses refs (documented as lossy)
- Repro: export `04-api.md` → `Session rules: → 02-authentication.md#Sessions`; re-import → text stays literal `→ …`; `cans check` shows 0 refs; orphan/redundancy warnings follow.
- Expected: §45 "OPML/Logseq/Obsidian roundtrips pass" suggests symmetric conversion; §27/§31 never specify `→` → `see:` on import, so import-side loss is "per docs" but the roundtrip goal fails for refs. Nesting/text round-trip is exact (only `<!-- ref-by -->` comment intentionally stripped).

### F17 — MINOR: formats are case-sensitive with poor failure mode
- Repro: `export OPML`, `import OPML …` → exit 1 + false-success messages (see F1). Valid formats are all-lowercase everywhere in docs.

### F18 — MINOR/DEVIATION: active `_adr/` not exported
- Repro: workspace with `_adr/001-test.md` + `_adr/_archive/000-old.md` → `export opml` exports neither.
- Expected: §28 excludes only `_adr/_archive/` (active ADRs implied exported).
- Actual: all `_`-prefixed dirs excluded (spec discovery per §32 excludes `_`-prefixed). Doc vs implementation mismatch; exported archive loses decision records.

### F19 — INFO: doc drift on flags
- §20: import `--json` + export `--include-tasks`/`--json` exist in the doc but are absent from `help` text and (import `--json`, export `--include-tasks`) from README. All three flags do work when passed (verified). §28 never documents `--vault` or `--from` semantics.

## Observations

- Exit-code discipline is correct throughout: success 0, user-correctable failure 1; no stack traces, no exit 2 observed in ~40 invocations.
- File naming on import: next free `NN-` index derived from first root node slug (`07-authentication.md`, `100-x.md` after `99-broken.md`); deterministic; multi-root sources collapse into one file (undocumented).
- OPML output is well-formed XML with entity-safe text; `<head><title>` = source file name; entity decode on import works (fixtures import cleanly).
- Export destination is always `cans-export/<format>/` relative to CWD (matches §35 fixture), never inside `cans/`; `--vault` overrides the base. Output dir is never cleaned between runs (stale-file risk).
- Nothing I tried made import write outside `cans/`, and no error path created partial files — the failure paths are clean apart from the messaging problem (F1).
- Performance: every command felt instantaneous (<50 ms), consistent with §40 budget for import.

## Verdict summary

- Tests/observations recorded: 37 matrix rows (+8 focused repro/diagnosis runs).
- PASS: 14 · FAIL: 15 (several rows carry both a passing aspect and a defect) · DEVIATION: 6 · UNDOCUMENTED: 5 (rows may carry secondary verdicts; counted by primary verdict).
- Findings: 1 blocker (F8 merge corruption; F1 blocker-class UX on every error path), 6 major (F2, F3, F4, F5, F11, F14), 9 minor (F6, F7, F9-counted-major? no — F9 major, F10, F12, F13, F15, F17, F18, F19 info), rest informational.
- Bottom line: happy-path import (fresh workspace, clean fixtures) and export (all 4 formats + `all`, flags `--include-tasks`, `--vault`, `--dry-run`, `--json`) largely match the documented contracts; the interop edge is undermined by (a) one structural-corruption merge bug under the default strategy, (b) systematically lossy imports (refs, callouts, code blocks, `_note`), (c) OPML checkbox loss, and (d) a uniformly misleading failure/JSON error surface that violates §37.
- Recommended fix order: F8 → F1 (+JSON error field) → F2/F3 → F5 → F4 → F14 → F11 → F9.
