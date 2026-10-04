# QA-21 — Regression sweep, round 6 (cross-cutting, everything EXCEPT the six fixed areas)

Task ID: 4-e | Agent: QA 4-e | Date: 2026-09-06
Target: cans-hq/cans-spec @ commit 23156fa (READ-ONLY checkout at /home/z/my-project/cans-spec)
CLI under test: `node /home/z/my-project/cans-spec/bin/cans.js <cmd>` (launcher re-execs Bun when Bun is on PATH — Bun 1.3.14 primary, Node 24.21.0 fallback probed explicitly for issue #12).
Method: blackbox per agents/qa/README.md — CLI + filesystem only, no `src/` reads, no `bun test`, manual shell probes, no fixes.
Scratch: /home/z/my-project/qa-scratch/qa21/
Oracle: docs/cans.architecture.md (§N), README.md, templates/, past QA reports (QA-01/03/04/06/16 as "previously-working" baseline).
Out of scope (covered by agents 4-a..4-d): the six merged issues #15/#16/#19/#20/#21/#22 — refs target resolution details, anchor-aware back-pointers, byte-preserving CRLF --fix, import diverged-sibling guard, budget best-effort packing details, trailing-slash folder targets. This sweep regression-checks everything else those merges could have broken.

## Probe record

F01 | init full scaffold matches templates/ and §8/§35 (14 entries, flat, _adr/ empty)
  cmd: cd qa-scratch/qa21/A/a1 (fresh) && node .../bin/cans.js init; find cans -type f; diff cans/_rules.yaml templates/_rules.yaml; diff cans/AGENTS.md templates/AGENTS.md
  expected: §21/§35 init.json created[]; templates/ are the emitted content (QA-01 rows 1/3/5)
  observed: exit 0; 14 created entries exactly per §35; _rules.yaml + AGENTS.md byte-identical to templates/; 7 TBD seed specs; _adr/ + _tasks/ empty (matches §35, §8 _template.md ghost known DOC-GAP)
  verdict: PASS

F02 | init --json envelope shape (ok/command/exitCode/created/skipped/root)
  cmd: node .../bin/cans.js init --json (fresh dir)
  expected: §21/§35 fixture; root "./cans" (QA-01 F4 resolved)
  observed: {"ok":true,"command":"init","exitCode":0,created:[14 entries],"skipped":[],"root":"./cans"} — exact fixture match
  verdict: PASS

F03 | init --bare minimal skeleton
  cmd: node .../bin/cans.js init --bare
  expected: §21 "minimal"; QA-01 row 10 baseline = _rules.yaml, AGENTS.md, 00-overview.md only
  observed: exactly those 3 files, exit 0
  verdict: PASS

F04 | init idempotent re-run on full workspace (no damage, correct message)
  cmd: md5 before; node .../bin/cans.js init; md5 after; diff
  expected: §21 idempotent, skips existing; QA-01 row 7 baseline (all "= (exists, skipped)", md5s unchanged)
  observed: all 14 entries "= (exists, skipped)", exit 0, md5s byte-identical (no damage). Note: re-running plain init after --bare completes the scaffold (creates missing 01-06/_adr/_tasks/_collab, skips existing 3) — consistent with skip-existing contract, existing files never touched.
  verdict: PASS

F05 | init --force overwrites spec files but no longer clobbers _collab state
  cmd: append EDIT to 02-authentication.md and _collab/handoffs.md; node .../bin/cans.js init --force; grep EDIT
  expected: §21 "skips existing files unless --force" — QA-01 #9 baseline had --force recreating _collab/* (flagged as hazard by QA-09); no regression either direction
  observed: exit 0; specs + _rules + AGENTS recreated (EDIT gone from 02-authentication.md); _adr/_tasks/_collab reported "(exists, skipped)" and handoffs.md EDIT survives — QA-09's clobber hazard is gone; nothing previously-working broken
  verdict: PASS (noted: --force scope narrowed vs QA-01 observation — improvement, matches QA-09 desired direction)

F06 | every command outside a workspace: §19/§37 envelope + exit 1
  cmd: for cmd in check/status/"budget read sessions"/"export opml"/"done foo"/"new task foo" in dir w/o cans/
  expected: uniform "no cans workspace found — run cans init" what/why/fix, exit 1 (§19: 1 = user-correctable; QA-06 F6 resolved baseline)
  observed: all 5 workflow commands print ✗ no-workspace + fix hint, exit 1. check prints the same envelope but exits 2 — consistent with README/issue-#41 check table (0 clean/1 warnings/2 errors) where a missing workspace is an error; §19 general table still says 1 (doc tension noted, not new)
  verdict: PASS (check exit 2 noted — issue #41 exit table supersedes §19 for check; see F30)

F07 | init refusal inside cans/ + unknown flag/tool rejection
  cmd: cd cans/ && init; init --bogus; init --folder; init --tool windsurf
  expected: §21 refuse with reason (QA-01 F3/F8 resolved); unknown flag exit 1 (QA-01 F6 resolved); unknown tool lists valid tools (QA-01 F7 resolved)
  observed: "✗ already inside a cans/ workspace — cd to the project root first" exit 1; "✗ unknown flag "--bogus"" exit 1; "✗ unknown flag "--folder"" exit 1; "✗ unknown tool "windsurf" — supported tools: claude, cursor" exit 1
  verdict: PASS

F08 | new task/adr: file in right place, template outline, slug + NNN auto-increment, --json clean
  cmd: new task add-dark-mode; cat cans/_tasks/add-dark-mode.md; new task verify-clean --json; new adr "CSS Variables over Tailwind"; new adr "Postgres over MySQL"; ls cans/_adr
  expected: §23 (_tasks/<slug>.md, _adr/NNN-<slug>.md, auto-increment), §30/task-template.md outline, §35 new.json {ok,command,exitCode,change,file}; flags never pollute name (QA-04 F1/QA-06 F5 resolved)
  observed: task file = templates/task-template.md verbatim; ADRs 001/002 created, header # ADR-001: CSS Variables over Tailwind / Status: proposed / Date: 2026-10-04; JSON change "verify-clean", file "_tasks/verify-clean.md" (clean)
  verdict: PASS

F09 | new task existing-file guard (content preserved)
  cmd: write real content into _tasks/add-dark-mode.md; new task add-dark-mode; md5 before/after; also re-run on pristine-template file
  expected: QA-04 F2 resolved baseline — "✗ refusing to overwrite existing _tasks/add-dark-mode.md — it already has content", exit 1, md5 unchanged
  observed: real content → exact refusal message, exit 1, md5 unchanged. Pristine-template file → "Created" exit 0 but md5 unchanged (silent no-op, no data loss)
  verdict: PASS (no-op re-create of a still-empty template file is cosmetic)

F10 | done gate chain: human gate (never skippable) → open tasks → archive move
  cmd: done add-dark-mode (1 open @human gate); then check gate, done (1 open task); then all checked, done
  expected: §24 gate order; §36 blocked text w/ file:line — gate text; archive to _tasks/_archive/YYYY-MM-DD-<name>.md
  observed: "✗ BLOCKED: 1 unchecked ← @human gate / _tasks/add-dark-mode.md:11 — Spec approved ← @human / Check the gate, then re-run cans done." exit 1 → "✗ BLOCKED: 1 open task (--allow-incomplete to override) / _tasks/add-dark-mode.md:8 — Create toggle component ← agent-1" exit 1 → "✓ Archived _tasks/_archive/2026-10-04-add-dark-mode.md" exit 0, file moved
  verdict: PASS

F11 | done JSON shapes (blocked + not-found) per §35 + error field
  cmd: done blockme --json (fresh task w/ open gates); done no-such-task --json
  expected: §35 done-blocked-human.json {ok,command,exitCode,change,gates{human,humanOpen,tasks,tasksOpen},archived,backPointersUpdated}; error field names cause (QA-06 F3 resolved)
  observed: blocked JSON exact shape (+ gateDetails[] superset w/ file/line/text); not-found JSON has "error":"task \"no-such-task\" not found in _tasks/ — run `cans status` to list active tasks", archived:null
  verdict: PASS

F12 | status human + --json (counts, exit 0, §35 shape) and filters differ
  cmd: status; status --json; status --unclaimed/--blocked/--owners vs default diff (3-task ws: blockme+verify-clean blocked w/ 4 unclaimed, free-task fully done)
  expected: §25/§36/§35 status.json; filters change output (QA-04 F5 resolved)
  observed: "Files: 7 specs, 2 tasks, 1 archived, 2 ADRs / Tasks: 0/4 done, 4 unclaimed, 2 blocked" + per-task blocks w/ "Gates: 0/1 ← @human / ⚠ BLOCKED", exit 0; JSON exact §35 shape (+unclaimed per taskFile, superset); --unclaimed drops fully-done free-task; --blocked and --owners views differ from default; owners view "agent-9: 2 task(s), 2 done"
  verdict: PASS

F13 | export logseq|obsidian|opml: tree shape, §28 transformation table, exclusions, JSON, idempotency, dry-run
  cmd: (ws w/ see: ref + owner arrow) export logseq; export opml; export obsidian; export opml --json; export all; export logseq --dry-run (fresh copy); find cans-export
  expected: §28: outputDir cans-export/<format>, see:→[[X/Y]]/[[X#Y]]/→ X.md#Y, ← agent-1→agent-1:: assigned/[agent-1]/🤖 agent-1; exclude _collab//_rules.yaml/AGENTS.md; §35 export.json shape; dry-run writes nothing (QA-06 F12 resolved)
  observed: 7 files per format; logseq "Session rules: [[06-operations/Sessions]]" + "Expire after 24 hours agent-1:: assigned"; opml valid XML "→ 06-operations.md#Sessions" + "[agent-1]"; obsidian "[[06-operations#Sessions]]" + "🤖 agent-1"; 0 excluded leaks; JSON exact §35 shape w/ relative outputDir "cans-export/opml"; re-export byte-identical (md5), export all → 4 subdirs; dry-run "[dry-run] Would export logseq → cans-export/logseq (7 files). No files written." + no dir created
  verdict: PASS

F14 | check exit-code triad on clean/warnings/errors workspaces (README/issue #41 contract)
  cmd: d8 (2 files, all parents ≥4 children, valid ref) check; d0 (scaffold, 9 warnings) check; d1 (depth>max + node>chars errors) check
  expected: README "Exit codes: 0 clean · 1 warnings · 2 errors — agents read $?"; QA-12 acceptance matrix
  observed: d8 "✓ 2 files · 16 nodes · depth 3 · 10ms" exit 0, counts {errors:0,warnings:0}; d0 "⚠ ... 10ms" + REFS/REDUNDANCY warnings exit 1; d1 "✗ ... 8ms" (structure.depth.max + overflow.node_chars errors) exit 2, counts {errors:2,warnings:22}
  verdict: PASS

F15 | structure engine: siblings.min, depth.max, single-child — machine rule keys + severity
  cmd: d1 (custom rules siblings min 2, depth max 5, max_node_chars 60) check --json
  expected: §15 checks; QA-16 P1 (#1 fix: min enforcement warns); issue #41 machine rule keys
  observed: structure.siblings.min (warning, "\"Root with one child\" has 1 children (min 2)"), structure.single_child (warning, "has exactly 1 child. Collapse."), structure.depth.max (error, "1× depth >max (6/5)"). Note: with min ≥ 2 the single-child case is reported by BOTH rules (QA-12's "avoid double-reporting" note holds only for default min 1) — noise, not a regression
  verdict: PASS

F16 | style engine: force_sibling_below hint + prefer wiring (#2)
  cmd: f1 ws w/ 6 "Returns *" siblings + parent w/ 2 leaf children; check under prefer: sibling → nested → flat
  expected: §14; QA-16 P2 — grouping hint suppressed under prefer: sibling, fires under prefer: nested, prefer: flat = line-numbered rules error
  observed: prefer: sibling → no STYLE section (hint suppressed); prefer: nested → "1× shared prefix "Returns" 01-prefix:1"; prefer: flat → "✗ invalid _rules.yaml: line 8 — "style.prefer" must be "sibling" or "nested", got "flat"" (line-numbered; exit 2 — see F22). style.nesting.prefer rule key fires for collapse hint (d1: "collapse to sibling (2)" 02-style:9)
  verdict: PASS

F17 | redundancy: word-frequency (keyword sprawl) with synonym/stopword layers alive
  cmd: d1 w/ "authentication" ×5, "returns" ×6 nodes → check; d7 typo pairs
  expected: §13 layer 1 (≥ threshold 4 nodes); QA-03 T3 baseline
  observed: "4× keyword sprawl / returns:6 authentication:5 level:5 user:4" rule redundancy.keyword warning; fuzzy layer "possible typo" rule redundancy.typo with Levenshtein detail + synonym suggestion
  verdict: PASS

F18 | overflow: node > max_node_chars + code fence
  cmd: d1 (104-char node w/ max 60; fenced json block in 04-overflow) check
  expected: §16 (fence/table/max_node_chars flagged w/ extract advice)
  observed: "1× node chars >max (104/60)" overflow.node_chars error 04-overflow:1; f10 "1× code fence (extract to file)" 02-auth:5 (overflow error)
  verdict: PASS

F19 | rules banner: unknown key tolerated, RULES summary line present
  cmd: d5 append "bogus_key: 42" to _rules.yaml → check
  expected: §18 (unknown keys tolerated); QA-03 row 39 baseline (ignored, defaults, exit unchanged); QA-12 RULES section
  observed: no warning, same findings, "RULES ✓ len 3–120 · sib 1–12 · depth 1–5" banner unchanged (rulesSummary in JSON)
  verdict: PASS

F20 | §18 delete-key = check turns off (refs section deleted → orphan check off)
  cmd: d3 (8 files, no refs, custom _rules.yaml WITHOUT references: section) vs d4 (same + full default rules)
  expected: §18 "Delete a key = check turns off"; QA-03 F1 resolved baseline
  observed: d3 → refs section [], no orphan warnings; d4 (references: present) → "7× orphan file" refs.orphan warnings. Delete-key contract holds
  verdict: PASS

F21 | issue #4 spot check: see-prose downgraded to warning, ref-like broken stays error
  cmd: f5 ("Users can see their dashboard", "see the API guide", "See 99-missing-file.md") check; f6 variants (see:/see/lowercase, missing file)
  expected: QA-16 P4 — prose → see-like prose warnings; ref-like missing file → error; --strict escalates
  observed: prose lines → refs.prose warnings w/ fix hint; "see: 99-missing-file.md" → "3× missing file / 99-missing-file.md (3)" error exit 2; --strict exit 1 on warnings-only. Capital "See" (no colon) not parsed as ref — identical at pre-merge b859e30 (not a merge regression)
  verdict: PASS

F22 | issue #1 spot check: siblings.min enforcement (QA-16 P1)
  cmd: d1 rules siblings {min: 2} on 1-child parents
  expected: QA-16 P1 merged behavior — warns "\"Root with one child\" has 1 children (min 2)"
  observed: exactly that (8× <min children (1/2), rule structure.siblings.min, warning level)
  verdict: PASS

F23 | issue #3 spot check: redundancy.fuzzy independent switch
  cmd: f9 ("store"/"stale" pair) check with fuzzy: true then fuzzy: false
  expected: QA-16 P3 — fuzzy: false disables layer 3 independent of enabled; other checks stay
  observed: fuzzy: true → "1× possible typo 01-typo:2" (redundancy.typo); fuzzy: false → typo gone, orphan warning (refs engine) still fires
  verdict: PASS

F24 | issue #5 spot check: deep-hop chain errors, mutual pair clean
  cmd: f7 (02-auth → 04-api → 06-operations chain) check; f8 (02↔04 mutual pair, valid anchors) check
  expected: §12 deep-hop = referenced file that also refs out → error w/ two-part fix; QA-16 P5 — SCC mutual pair never a deep hop
  observed: f7 "1× deep hop chain 04-api:5 ↳ add "see: 06-operations.md#Backup" directly to 02-auth.md and remove the intermediate hop via 04-api.md" (error, exit 2); f8 mutual pair → no deep-hop finding (only unrelated style warning)
  verdict: PASS

F25 | issue #6 spot check: fence-safe --fix (file-level mark form)
  cmd: f10 — target w/ fenced stale "<!-- ref-by: 99-wrong.md -->" + prose, referrer 04-api.md "see: 02-auth.md"; check --fix twice + md5
  expected: QA-16 P6 — fenced comment untouched, prose untouched, legitimate back-pointer added outside fence; idempotent (QA-09: --fix converges)
  observed: fence + its comment byte-preserved; standalone "<!-- ref-by: 04-api.md -->" inserted right after first root bullet "- Auth" (issue #6 form, outside any fence); 2nd --fix run md5 identical; post-fix state bp {total:1,current:1,stale:0}
  verdict: PASS

F26 | issue #12 spot check: Node fallback runtime + Bun primary parity
  cmd: PATH w/o bun (node only): check / version / init --json via node bin/cans.js; bun bin/cans.js + bun src/cli.ts: check on clean ws
  expected: dual-runtime identical behavior, version matches package.json (0.4.0), stderr 0 bytes (QA-11 + QA-12 warning hygiene)
  observed: Node-only PATH: check output identical to Bun path, "cans 0.4.0" exit 0 stderr 0 bytes, init --json works; Bun launcher + direct src/cli.ts: same clean-check output exit 0 as node-invoked (launcher re-exec)
  verdict: PASS

F27 | issue #41 spot check: --show flag contract
  cmd: check --show redundancy / --show refs,overflow / --show all / --show bogus
  expected: README/QA-12 — expands folded section, comma lists + all work, bad value → error + guidance exit 2
  observed: all three valid forms accepted; "--show bogus" → "✗ unknown --show section "bogus" — use structure|style|refs|redundancy|overflow|all / Run `cans help` for valid check flags." exit 2
  verdict: PASS

F28 | OBSERVATION (DOC-GAP, proven NOT a 23156fa regression): invalid _rules.yaml exits 2, §18 says exit 1
  cmd: f2 — unbalanced inline array / "structure: 42" / "prefer: flat" in _rules.yaml → check; same probes on pre-six-merge tree (git archive b859e30)
  expected: §18 L440 "Invalid YAML = print line number, exit 1" + §19 (1 = user-correctable); QA-03 row 37/F2 and QA-16 P2 baselines observed exit 1 (pre-issue-#41)
  observed: all three variants print correct line-numbered ✗ message but exit **2** at 23156fa AND at b859e30 (post-issue-#41, pre-six-merge) — behavior introduced by issue #41's 0/1/2 table (errors → 2), unchanged by the six-issue merge. Same for check-no-workspace (exit 2). Docs §18/§19 were never updated
  verdict: PASS (no merge regression; docs-internal gap: §18/§19 vs issue-#41 exit table — flagging for docs, MINOR)

F29 | --help / help: full command list, exit 0; check line carries --show
  cmd: cans --help; cans help
  expected: §36 help fixture + §20 command list; issue #41 added --show (README documents it)
  observed: all 10 commands + version listed; check line includes [--show <section>]; export line includes --include-tasks/--vault/--dry-run/--json; Formats/Config/Agents trailer; exit 0, stdout-only
  verdict: PASS

F30 | version surface + no-args + unknown/removed commands
  cmd: cans version; cans --version; cans (no args); cans frobnicate; cans search (§41 removed)
  expected: version = package.json (0.4.0) (QA-10 A6); no-args/unknown → §37 guidance exit 1 (QA-06 F3 resolved); removed commands never execute (QA-06 row 24)
  observed: "cans 0.4.0" exit 0 both forms; "✗ no command given — run `cans help`" exit 1; "✗ unknown command "frobnicate" — run `cans help`" exit 1; search → same, exit 1
  verdict: PASS

F31 | unknown flags / short flags / missing args: §37 envelopes + exit 1 (check usage → 2 per issue #41)
  cmd: status --bogus; status -j; check --bogus; done; budget read; budget write; new; new adr; import; import obsidian; export; import csv x.md; budget frobnicate x — exit codes captured without pipeline
  expected: §20 arg parsing (primitive --flag value only, no short flags); §37 what+fix messages; §19 exit 1 user-correctable; QA-06 F2/F4 resolved baselines
  observed: every probe prints actionable ✗ message (usage + example line, valid-format lists, "unknown flag", "no short flags supported"); all exit 1 EXCEPT check --bogus → exit 2 (issue #41 usage-failure→2 design, byte-identical at pre-merge b859e30 — not a merge regression)
  verdict: PASS

F32 | --json error envelopes consistent: ok/command/exitCode/error across commands
  cmd: status --bogus --json; done no-such --json; budget read xyzzy --json; import csv x.md --json; check --json (no ws); init --json (inside cans/); export opml --json (no ws)
  expected: §19 both outputs derive from same Result; failure payloads carry error naming cause (QA-06 F3 resolved: "populated error field")
  observed: all carry ok:false + command + exitCode + error field mirroring the human message; command-specific payload fields kept (§35 shapes); check --json no-ws additionally embeds the error as refs.other issue in sections
  verdict: PASS

F33 | budget read/write basic contracts unchanged (§26/§35 shapes, §36 human format)
  cmd: budget read sessions; budget read sessions --json; budget write sessions --json (b1 scaffold)
  expected: §36 plan format; §35 budget-read.json/budget-write.json key sets; canonical home score 100 (§26 step 3)
  observed: human "Reading plan for: sessions / 1. 02-authentication.md#Sessions: TBD ← canonical home (16 tok) / Budget: 16 / 4096 tokens (0.4%)"; JSON keys exactly per §26; write keys exactly per §35; canEdit[0] canonical home
  verdict: PASS

F34 | check scoping flags: --refs-only, --no-redundancy, positional file, bad positional
  cmd: check --refs-only; check --no-redundancy; check 01-struct.md (d9); check nope.md
  expected: --refs-only → refs section only + rules header (QA-06 F13 fixed baseline); --no-redundancy suppresses redundancy (QA-06 row 65); bad positional is a real error (QA-06 F9)
  observed: --refs-only → REFS + RULES only; --no-redundancy → REDUNDANCY gone; single-file check scopes structure/style/overflow/redundancy to the file (d9: 01-struct findings only) while refs graph stays workspace-wide (4 orphans); nope.md → "✗ no spec file matches "nope.md" — pass a spec filename like 04-api.md or run `cans status` to list files" exit 2 (issue-#41 usage→2, identical at b859e30). Summary header still shows whole-workspace counts on single-file runs (cosmetic, pre-merge identical)
  verdict: PASS

F35 | import (fresh, no merge): hierarchy + §35 import.json + logseq wiki-link→see: with .md
  cmd: import opml dynalist-export.opml (into init --bare ws); import logseq logseq-page.md --json (into bare ws)
  expected: §27/§34 exact hierarchy (QA-05 row 3 baseline); §35 import.json keys; wiki-link target = 02-authentication.md#Sessions with trailing text as content (QA-05 F2/F3 resolved)
  observed: OPML: "+ 07-authentication.md", Authentication→Sign up→Email/Google + Sessions→Expire + Dashboard→Requires verified account — exact §34 nesting; logseq: TODO/DONE→[ ]/[x], ref line "see: 02-authentication.md#Sessions expire after 24 hours" (target token has .md + anchor "Sessions", trailing prose stays content; broken-anchor only because scaffold node is "Sessions: TBD"); JSON {ok,command,exitCode,format,source,newFiles,merged,conflicts} exact
  verdict: PASS

F36 | import with existing target: conflicts reported, never silent (§27 conflicts[])
  cmd: import opml dynalist-export.opml into full scaffold (target 02-authentication.md exists)
  expected: §27 merge matching — conflicts[] with file/line/resolution, no silent duplicate appends (QA-05 F8/F9 resolved baseline; issue #20 is 4-b's deep-dive)
  observed: "~ 02-authentication.md (merged)" + "! 02-authentication.md:2 cans-wins" + "! 02-authentication.md:3 cans-wins" — conflicts surfaced with line numbers and resolution
  verdict: PASS

F37 | done gate 3 (final check) + per-gate flags
  cmd: b3 — spec w/ broken ref (check exit 2), completed task gate3: done; done --skip-check; new task gate4 w/ open item + done --allow-incomplete
  expected: §24 gates in order — check blocks unless --skip-check; --allow-incomplete does NOT bypass check; warnings (check exit 1) don't block (QA-04 rows 19-21)
  observed: "✗ BLOCKED: cans check failed (--skip-check to override)" exit 1 → --skip-check archives exit 0; --allow-incomplete alone still blocked on its own gate; warnings-only workspace (b2) archived without --skip-check
  verdict: PASS

F38 | empty cans/ dir: check/status/export behave
  cmd: g1 — mkdir cans (empty); check; status; export opml
  expected: §25 status "always exits 0 if it can print"; QA-05 row 35 (export 0 files exit 0); no crash
  observed: check "✓ 0 files · 0 nodes · depth 0 · 2ms" exit 0; status zeros exit 0; "Exported opml → cans-export/opml (0 files)" exit 0
  verdict: PASS

F39 | _rules.yaml loading: missing = all defaults; empty = defaults; partial = unlisted keys OFF (delete-key)
  cmd: g4 — no _rules.yaml vs empty vs partial "structure: node_length {min 3,max 200}" + 149-char node; RULES banner
  expected: §18 "Missing file = all defaults. Partial = only listed keys override. Delete a key = check turns off." + README "Delete a key to disable that check"; QA-03 F1 resolved contract (delete-key wins within a present section)
  observed: missing → full defaults (sib 1–12 · depth 1–5, orphan check on, 149-char node NOT flagged at default max 200... flagged only when custom 60); empty → identical; partial (node_length only) → "RULES ✓ len 3–200 · sib off · depth off" — unlisted keys within the present section are OFF (delete-key semantics per README/QA-03-F1-resolved; supersedes §18's "partial = only listed keys override" phrasing — doc-internal tension, behavior matches the README headline contract)
  verdict: PASS (delete-key semantics dominant; §18 partial-file sentence is the stale half — noted, MINOR doc tension)

F40 | folder-mode workspace (auth/index.md layout): init --folders, check, new, status
  cmd: g3 — init --folders; find; check; new task folder-task; status
  expected: §8 folder alternative (QA-01 row 9 baseline: NN-name/index.md, 00-overview stays flat); check parses index.md files; §23/§25 work
  observed: 01..06 as <name>/index.md + flat 00-overview.md; check "7 files · 32 nodes" — same counts as flat scaffold, orphans/typo/tbd warnings identical, names rendered "02-authentication/index.md", exit 1 (warnings); new task created; status counts correct exit 0
  verdict: PASS

F41 | check report plumbing byte-stability across the merge (strongest regression proof)
  cmd: diff full `check --json` (elapsedMs stripped) and human `check` output (ms masked) on d10 (structure+style+refs+redundancy violations), d0 (scaffold warnings), d8 (clean) — HEAD 23156fa vs pre-merge b859e30 (git archive copy, no repo modification)
  expected: six-issue merge touched report plumbing — no observable change to non-fixed-area output
  observed: all three workspaces: JSON wire shape and human output byte-IDENTICAL pre-merge vs HEAD (modulo elapsedMs timing)
  verdict: PASS

F42 | export --include-tasks + OPML checkbox state + exclusions
  cmd: c6/c7 — export opml --include-tasks; plain export opml/logseq on ws with 2 ADRs + tasks; grep "[x]"/"[ ]" in .opml
  expected: §28 preserve checkboxes + owners in OPML (QA-05 F14 RESOLVED baseline); _collab//_rules.yaml/AGENTS.md excluded; active _adr/ implied exported (§28 list excludes only _adr/_archive/)
  observed: opml text="[ ] Spec impact approved ⏳ Human", "[x] All done [agent-9]" — checkbox state preserved; tasks exported only with --include-tasks; active _adr/001+002 exported in all formats (matches §28; note: QA-05 F18 had observed _adr/ excluded at e628ff2 — behavior changed to doc-conformant at/before b859e30, pre-six-merge, verified identical pre-merge vs HEAD); _collab/, AGENTS.md, _rules.yaml never exported
  verdict: PASS

F43 | --fix scope strictly limited: only ref-by marks written
  cmd: d12 — 3 files (target w/ fence + stale fenced comment, referrer, unrelated file); md5 all before/after check --fix
  expected: §22 --fix adds/removes/rewrites <!-- ref-by --> only; no text/style/structure changes
  observed: only 02-auth.md md5 changed (mark inserted at line 2); 04-api.md + 03-other.md byte-identical; fenced stale comment untouched; remaining overflow error still exits 2 (not "fixed")
  verdict: PASS

F44 | new slug normalization + unknown flag on done
  cmd: new task "My Task!!"; done gate4 --bogus
  expected: §23 slug rules (non-alnum → hyphen); unknown flag rejected (QA-06 F4)
  observed: _tasks/my-task.md created; "✗ unknown flag "--bogus"" exit 1
  verdict: PASS

## Summary table

| Metric | Value |
|---|---|
| Probes recorded | 44 |
| PASS | 44 |
| FAIL | 0 |

**FAIL list: none.**

### Notes (non-FAIL observations, all proven NOT introduced by the 23156fa six-issue merge via pre-merge b859e30 comparison where relevant)

1. MINOR (DOC-GAP) — invalid `_rules.yaml` and check usage failures exit **2**; §18 L440 still documents "exit 1" and §19 defines 1 = user-correctable / 2 = internal. Behavior is issue #41's 0/1/2 (clean/warnings/errors) table, verified byte-identical at pre-merge b859e30 — docs were never reconciled. Same applies to check-no-workspace (exit 2). (F06, F28, F31, F34)
2. MINOR (noise) — with `siblings.min ≥ 2` configured, a 1-child parent is double-reported under both `structure.siblings.min` and `structure.single_child` (QA-12's "no double-reporting" note only holds at default min 1). No baseline ever tested min ≥ 2 duplication; cosmetic. (F15)
3. MINOR (doc tension) — §18's "Partial file = only listed keys override" vs README's "delete a key to disable that check": impl applies delete-key semantics within a present section (partial `structure:` → siblings/depth OFF, banner "sib off · depth off"). Matches README/QA-03-F1-resolved contract; §18's partial-file sentence is the stale half. (F39)
4. INFO — `init --force` no longer recreates `_collab/*` (skips them) — improvement over QA-01's observation, in QA-09's desired direction; §21 wording unchanged. (F05)
5. INFO — active `_adr/` files are now exported (QA-05 F18 recorded them excluded at e628ff2); behavior is §28-conformant and pre-dates the six-issue merge (identical at b859e30). (F42)
6. INFO — `new task` on a file that is still the pristine template silently re-creates (no-op, "Created", exit 0); real content is refused. No data loss either way. (F09)
7. INFO — single-file `check <file>` still prints whole-workspace counts in the summary header (sections are correctly file-scoped). Pre-merge identical, cosmetic. (F34)

### Strongest regression evidence

- Full `check --json` wire shape AND human check output byte-identical pre-merge (b859e30) vs HEAD (23156fa) on a violations workspace, the warnings scaffold, and a clean workspace (modulo elapsedMs). (F41)
- All previous-issue spot checks (#1, #2, #3, #4, #5, #6, #12, #41) reproduce their merged/RESOLVED baselines exactly.
- All §35 JSON fixture shapes probed (init/new/done/status/check/budget-read/budget-write/import/export) match key-for-key.
- Exit-code discipline: 0/1 for all commands per §19; check follows the README/issue-#41 table (0 clean / 1 warnings / 2 errors).
- Dual-runtime: Bun (launcher + direct src/cli.ts) and Node-only-PATH fallback produce identical output; stderr 0 bytes on the Node path.

### Coverage map (scope A–G)

- A. init lifecycle: F01–F07 (scaffold fidelity vs templates/, --json, --bare, idempotency, --force, no-workspace envelope, inside-cans refusal, unknown flag/tool)
- B. workflow: F08–F12, F37 (new task/adr, overwrite guard, done gate trilogy incl. --skip-check/--allow-incomplete, status human/JSON/filters)
- C. export/convert: F13, F35, F36, F42 (logseq/obsidian/opml §28 table, --json, dry-run, idempotency, include-tasks, import fresh + conflicts)
- D. check engines (non-refs): F14–F20 (exit triad, structure, style, redundancy, overflow, rules banner, delete-key)
- E. CLI surface: F29–F34 (help/version/unknown/flags/usage/JSON envelopes/budget shapes/scoping flags)
- F. previous-issue spot checks: F21–F28 (issues #1 #2 #3 #4 #5 #6 #12 #41)
- G. edge cases: F38–F40 (empty cans/, rules loading variants, folder-mode)

Out of scope per task (covered by agents 4-a..4-d): issue #15/#16 budget packing + empty-plan diagnosis internals, #19 anchor-aware back-pointer placement/currency, #20 import diverged-sibling guard internals, #21 CRLF byte-preserving --fix, #22 trailing-slash folder-target resolution. Probed only at their previously-working smoke level (budget shapes F33, --fix fence safety F25, import conflicts surface F36, plain folder-mode F40).
