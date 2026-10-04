# QA-17 — Budget engine blackbox (issues #15/#16 re-verification, round 6)

- Target: cans-hq/cans-spec @ 23156fa (READ-ONLY checkout at /home/z/my-project/cans-spec)
- CLI under test: `node /home/z/my-project/cans-spec/bin/cans.js` (Bun re-runs via `bun .../bin/cans.js` for dual-runtime probes)
- Agent: QA 4-a (Task 4-a). Date: 2026-09-05.
- Method: blackbox CLI + filesystem probes only. No src/ reads, no test harness, no fixes.
- Contract sources: docs/cans.architecture.md §19 (exit codes), §26 (budget), §18 (token_budget rules), §35 (budget JSON fixtures), §36 (budget human output), §37 (error philosophy); closed issues #15/#16 Expected behaviors.

## Canonical workspace (A-track)

Built via `cans init --bare`, removed 00-overview.md, then:
- cans/01-auth.md: `- Authentication\n  - Sessions\n    - Expire after 24 hours\n    - Refresh allowed for 30 days\n  - Sign up\n    - Email requires verification\n`
- cans/02-api.md: `- API\n  - Session rules: see 01-auth.md#Sessions\n`

---

## Probes

F01 | Unbounded reference run: plan, scoring, token math (human + JSON)
  cmd: cd qa-scratch/qa17/canon && node .../bin/cans.js budget read sessions [--json]
  expected: §26: canonical home 01-auth.md (score 100, anchor Sessions), 02-api.md holds see:-ref into home → scored like §35 fixture 04-api.md (reason "see: back-ref"); JSON keys ok/command/exitCode/concept/plan[]/skipped/totalTokens/budgetLimit/usagePercent; exit 0
  observed: human: `1. 01-auth.md#Sessions ← canonical home (32 tok) / 2. 02-api.md ← see: back-ref (12 tok) / Budget: 44 / 4096 tokens (1.1%)`, exit 0. JSON matches fixture keys exactly; scores 100/60; skipped []; totalTokens 44; budgetLimit 4096; usagePercent 1.1
  verdict: PASS

F02 | --limit 30 best-effort packing skips expensive top item, keeps cheap one
  cmd: node .../bin/cans.js budget read sessions --limit 30
  expected: issue #16 + §26 step 4: item that does not fit is skipped, walk NOT cut; plan [02-api.md], 01-auth.md in skipped, exit 0 (partial plan = SUCCESS)
  observed: plan `1. 02-api.md ← see: back-ref (12 tok)`, `Skipped:\n  01-auth.md`, `Budget: 12 / 30 tokens (40%)`, exit 0. No "below the cheapest item" claim.
  verdict: PASS

F03 | --limit 12 exact-fit boundary + warn_threshold fires
  cmd: node .../bin/cans.js budget read sessions --limit 12 (2>/tmp/f03err.txt)
  expected: issue #16: plan [02-api.md]; §18 warn_threshold 0.8 → warning when usage ≥ 80%; §19: warning must not change exit code
  observed: plan `1. 02-api.md ← see: back-ref (12 tok)`, exit 0; stderr: `⚠ warning: plan usage 100% of 12 tokens exceeds token_budget.warn_threshold (80%) — trim the plan or raise default_limit in _rules.yaml` (note: advice names default_limit though limit source was --limit — content of warn text not contract-bound; flagged as observation)
  verdict: PASS

F04 | --limit 10 empty plan → truthful message naming top-priority item, exit 1
  cmd: node .../bin/cans.js budget read sessions --limit 10
  expected: §26 empty-plan contract: `✗ plan empty: --limit 10 is below the top-priority item 01-auth.md (32 tok) — raise the limit`, exit 1 (user-correctable). No "below the cheapest item" false claim, no spelling-error claim.
  observed: `✗ plan empty: --limit 10 is below the top-priority item 01-auth.md (32 tok) — raise the limit`, exit 1
  verdict: PASS

F05 | --limit 11 (below cheapest 12): empty plan message still truthful
  cmd: node .../bin/cans.js budget read sessions --limit 11
  expected: §26: empty plan exit 1 naming top-priority item 01-auth.md (32 tok); 11 < 32 so claim truthful
  observed: `✗ plan empty: --limit 11 is below the top-priority item 01-auth.md (32 tok) — raise the limit`, exit 1
  verdict: PASS

F06 | Empty-plan JSON envelope is truthful
  cmd: node .../bin/cans.js budget read sessions --limit 10 --json
  expected: issue #16: --json shows truthful plan/skipped/budgetLimit/error, ok:false, exitCode 1; §26 skipped = every file not in plan
  observed: {"ok":false,"command":"budget-read","exitCode":1,"concept":"sessions","plan":[],"skipped":["01-auth.md","02-api.md"],"totalTokens":0,"budgetLimit":10,"usagePercent":0,"error":"plan empty: --limit 10 is below the top-priority item 01-auth.md (32 tok) — raise the limit"} exit 1
  verdict: PASS

F07 | Issue #15 core: config-source default_limit: 25, no flag
  cmd: sed -i 's/default_limit: 4096/default_limit: 25/' cans/_rules.yaml && node .../bin/cans.js budget read sessions
  expected: issue #15: partial plan including 02-api.md, exit 0, truthful output (§26 partial = SUCCESS)
  observed: plan `1. 02-api.md ← see: back-ref (12 tok)`, `Skipped: 01-auth.md`, `Budget: 12 / 25 tokens (48%)`, exit 0
  verdict: PASS

F08 | Issue #15 core: default_limit: 10 → message names config key AND top-priority item (human + JSON)
  cmd: sed -i 's/default_limit: 25/default_limit: 10/' cans/_rules.yaml && budget read sessions [--json]
  expected: §26 example: `✗ plan empty: token_budget.default_limit (10) in _rules.yaml is below the top-priority item 01-auth.md (32 tok) — raise default_limit or pass --limit`, exit 1; --json shows plan/skipped/budgetLimit/error truthfully
  observed: human message exactly the §26 example string, exit 1; JSON: ok:false, exitCode 1, plan [], skipped [01-auth.md, 02-api.md], budgetLimit 10, error names token_budget.default_limit source. PASS both modes.
  verdict: PASS

F09 | Issue #15 consistency: explicit --limit 25 ≡ config-source 25
  cmd: budget read sessions --limit 25 (config 10) → then config 25: diff <(... --limit 25 --json) <(... --json)
  expected: issue #15: identical behavior — same plan, budget numbers, exit code
  observed: human output byte-identical to F07 (`12 / 25 tokens (48%)`, exit 0); JSON of flag-25 vs config-25 diff = IDENTICAL
  verdict: PASS

F10 | No-match concept distinction preserved
  cmd: budget read zzznope [--limit 10] [--json]
  expected: §26: `✗ no files match concept "zzznope" — check spelling or run \`cans status\`` exit 1 — NOT the empty-plan message (concept matches nothing)
  observed: exact spelling-error message in all 3 variants, exit 1; JSON error truthful. Distinction from empty-plan (F04) preserved.
  verdict: PASS

F11 | --limit 0 boundary
  cmd: budget read sessions --limit 0 [--json]
  expected: §26/§37: user-correctable exit 1, truthful diagnosis (NOT the old false "no files match concept" from QA-10 M2)
  observed: `✗ plan empty: --limit 0 is below the top-priority item 01-auth.md (32 tok) — raise the limit`, exit 1; JSON budgetLimit 0, error truthful. NOTE: 0 accepted though CLI's own validation text says "positive integer" (-5/abc rejected, 0 not) — internal inconsistency, benign outcome.
  verdict: PASS

F12 | --limit -5 (negative)
  cmd: budget read sessions --limit -5
  expected: QA-10 M2 fix + §37: reject with what/fix, exit 1 (old behavior: FALSE "no files match concept" spelling error)
  observed: `✗ invalid --limit value "-5" — pass a positive integer`, exit 1
  verdict: PASS

F13 | --limit abc (non-numeric)
  cmd: budget read sessions --limit abc [--json]
  expected: QA-10 M2 fix + §37: reject with what/fix, exit 1 (old behavior: silently ignored, default 4096, ok:true, exit 0)
  observed: `✗ invalid --limit value "abc" — pass a positive integer`, exit 1; JSON error carries the same message, budgetLimit 0
  verdict: PASS

F14 | Huge --limit values
  cmd: budget read sessions --limit 999999999 [--json]; --limit 99999999999999 --json
  expected: QA-10 C15: accepted as budgetLimit, full plan, exit 0; no overflow/crash (§37 no stack traces)
  observed: full plan both times, `Budget: 44 / 999999999 tokens (0%)`, exit 0; budgetLimit 99999999999999 serialized correctly, exit 0
  verdict: PASS

F15 | token_budget.default_limit key deleted (partial file)
  cmd: sed -i '/default_limit: 4096/d' cans/_rules.yaml && budget read sessions [--json]
  expected: §18 loading: "Partial file = only listed keys override" → default_limit falls back to documented default 4096 (budgetLimit 4096)
  observed: budgetLimit 4096, full plan, exit 0 (default fills in)
  verdict: PASS

F16 | token_budget.enabled: false — switch silently ignored
  cmd: sed -i 's/enabled: true/enabled: false/' cans/_rules.yaml && budget read sessions [--limit 10] [--json]
  expected: §18 defaults table documents token_budget.enabled as the subsystem switch + "delete a key = check turns off" → disabled planner must behave observably differently (unbounded plan / no limit) or §26 must define it
  observed: NO observable difference vs enabled: true — budgetLimit 4096 still applied, --limit 10 still yields empty-plan exit 1. Switch is dead config.
  verdict: FAIL (DOC-CONTRACT, MINOR — docs document a switch impl ignores; not part of #15/#16 claim)

F17 | token_budget section deleted entirely
  cmd: sed -i '/^token_budget:/,/^overflow:/d' cans/_rules.yaml && budget read sessions [--json] (no flag)
  expected: §18 "Partial file = only listed keys override" → token_budget falls back to defaults (4096)
  observed: `Budget: 44 / 4096 tokens (1.1%)`, budgetLimit 4096, exit 0. §18 internal tension ("delete a key = check turns off" vs partial-file override) noted; loading rule observed = defaults fill in.
  verdict: PASS

F18 | token_budget.enabled key deleted (section intact)
  cmd: sed -i '/^  enabled: true$/d' cans/_rules.yaml && budget read sessions (no flag)
  expected: §18 partial-file override → enabled default true, default_limit 4096
  observed: `Budget: 44 / 4096 tokens (1.1%)` — identical to pristine
  verdict: PASS

F19 | Malformed _rules.yaml (tab indentation)
  cmd: printf 'token_budget:\n  default_limit: [unclosed\n  bad indent\n\t tab\n' >> cans/_rules.yaml && budget read sessions
  expected: §18: invalid YAML → print line number, exit 1
  observed: `✗ invalid _rules.yaml: line 51: tab indentation (use 2 spaces)` — line 51 verified = actual tab line (nl -ba), exit 1
  verdict: PASS

F20 | Malformed _rules.yaml (unbalanced inline array)
  cmd: printf 'foo: [unclosed\n' >> cans/_rules.yaml && budget read sessions
  expected: §18: line number + exit 1
  observed: `✗ invalid _rules.yaml: line 48: unbalanced inline array: [unclosed` (line 48 = appended line, verified), exit 1
  verdict: PASS

F21 | warn_threshold boundary: exactly 80% and just-over fire, under does not, exit unaffected
  cmd: budget read sessions --limit 16 / 15 / 14 (stderr separated)
  expected: §18 warn_threshold 0.8 + §19 warnings never change exit code: warning fires at ≥ threshold (task C: "exactly/just-over — must fire"), silent below
  observed: 75% (16) → no warning; 80% (15) → `⚠ warning: plan usage 80% of 15 tokens exceeds token_budget.warn_threshold (80%)…` on stderr; 85.7% (14) → fires. Exit 0 in all three. (Wording nit: "exceeds" used at exactly-equal.)
  verdict: PASS

F22 | warn_threshold is genuinely read from config (custom values)
  cmd: warn_threshold: 0.4 + --limit 30 (usage exactly 40%); warn_threshold: 1.5 + --limit 12 (usage 100%)
  expected: custom threshold governs firing (§18 rule override); unreachable threshold → silent
  observed: 0.4 → fires at exactly 40%; 1.5 → silent, exit 0
  verdict: PASS

F23 | Multi-file concept match: plan order = priority order, skipped, usage math
  cmd: workspace multi: 01-aaa (Invoices home), 02-bbb (see: ref), 03-ccc ("Invoice export formats"), 04-ddd (no conn), _tasks/fix-invoices.md (bullet-list format, then fixture format) → budget read invoices [--json]
  expected: §26 step 3-4: scores sorted desc — canonical 100, active task mentioning 80, back-ref 60; skipped = every file not in plan; usage% = total/limit
  observed: bullet-list-format task file: plan [01-aaa(100), 02-bbb(60)], skipped [03-ccc, 04-ddd] — task file in NEITHER list. After rewriting task file in §30/§34 fixture format (`# name` H1 + Owner + Tasks): plan [01-aaa(100), _tasks/fix-invoices(80, "active task mentions concept"), 02-bbb(60)], skipped [03-ccc, 04-ddd]. Order correct: 100 > 80 > 60. usagePercent math correct (34/4096 = 0.8).
  verdict: PASS for order/scoring/sorting (with two sub-findings: F24 mention-layer recall, F25 task-file skipped omission + recognition format)

F24 | "mentions concept" layer: exact-word only, no stemming (singular vs plural)
  cmd: workspace match: budget read invoices --json; 02-sing.md nodes "Invoice"/"Single invoice note" vs 03-phrase.md "Archive invoices yearly"
  expected: §26 "mentions concept (20)" — matching normalization unspecified (§26 "Normalize concept. Find matching nodes." undefined) — QA-03 already tracks "§26 budget matching semantics" DOC-GAP
  observed: 03-phrase (exact word "invoices") → planned score 20; 02-sing (only "invoice"/"Invoice") → skipped as no-connection. Exact case-insensitive word match, no stem. Recall gap: "invoices" misses files saying only "Invoice".
  verdict: PASS (behavior coherent; doc gap pre-existing — noted DOC-GAP, not new regression)

F25 | Task files with no connection to concept are omitted from `skipped` entirely
  cmd: workspace match: _tasks/fix-shipping.md (fixture format, mentions shipping only) → budget read invoices --json
  expected: §26: "skipped lists every file not in the plan (didn't fit, or no connection to the concept)" — the task file has no connection → belongs in skipped
  observed: skipped = ["02-sing.md", "04-none.md"]; _tasks/fix-shipping.md appears in neither plan nor skipped
  verdict: FAIL (DOC-CONTRACT, MINOR — skipped is not "every file"; task files are invisible unless planned)

F26 | Singular concept needle (asymmetric substring matching)
  cmd: cd match && budget read invoice --json (workspace has "Invoices" node, "Invoice" node, "Archive invoices yearly")
  expected: §26 "Normalize concept. Find matching nodes." — normalization unspecified (pre-existing DOC-GAP)
  observed: "invoice" matches all three (canonical home on Invoices, mentions on 02-sing + 03-phrase); whereas "invoices" missed 02-sing (F24). Substring needle semantics: shorter needle finds more.
  verdict: PASS (no contract violated; DOC-GAP note reinforced)

F27 | Anchor-only connection: file whose only concept link is `see 01-auth.md#Sessions`
  cmd: cd anchors && budget read sessions --json (03-anchor.md = `- Misc\n  - see 01-auth.md#Sessions\n`)
  expected: §26 scoring: a see:-ref into the concept home connects the file (back-pointer 60 per §12/§35 fixture pattern); planned since it fits
  observed: 03-anchor.md planned, score 60, reason "see: back-ref", estTokens 8. File-level ref (04-flatref.md `see 01-auth.md`, no anchor) also 60. Plan order: home 100 → inbound refs 60 → 60. Exit 0.
  verdict: PASS

F28 | §26 "forward ref (40)" scoring tier unreachable
  cmd: anchors workspace: 01-auth.md Sessions subtree contains `Password policy: see 03-pw.md` (outbound ref from concept node); home-level outbound ref also tested
  expected: §26 step 3 scoring table lists "forward ref (40)" — a file the concept/home points to should connect at 40 and be planned if it fits
  observed: 03-pw.md never in plan, always in skipped (score 0 / no connection) in both constructions (outbound from home file; outbound from Sessions subtree). All reachable tiers observed: 100/80/60/20/0 — the 40 tier is dead.
  verdict: FAIL (DOC-CONTRACT, MINOR — §26 promises a tier the impl never produces; reading-plan recall gap for files the concept points to)

F29 | --json envelope shape consistent across failure paths
  cmd: flag-limit empty (F06), config-limit empty (F08), no-match (F10) JSON envelopes compared
  expected: §26/§35: same budget-read envelope keys (ok, command, exitCode, concept, plan, skipped, totalTokens, budgetLimit, usagePercent) + truthful error
  observed: all three failure envelopes share identical key sets; error names the true cause in each (limit flag / config key / no-match)
  verdict: PASS

F30 | Run outside any cans workspace
  cmd: cd qa-scratch/qa17 (no cans/) && budget read sessions [--json]
  expected: §37 user-correctable what/fix, exit 1; JSON error set
  observed: `✗ no cans workspace found — run \`cans init\` first, or cd into a project with a cans/ directory` exit 1; JSON ok:false, error same. (budgetLimit:0 in envelope — cosmetic.)
  verdict: PASS

F31 | Empty cans/ dir (workspace with zero specs)
  cmd: cd emptydir (mkdir cans, nothing else) && budget read sessions
  expected: §26: concept matches nothing → no-match error, exit 1 (no crash)
  observed: `✗ no files match concept "sessions" — check spelling or run \`cans status\`` exit 1
  verdict: PASS

F32 | Empty spec file in workspace
  cmd: cd emptyfile (cans/01-empty.md, 0 bytes) && budget read sessions [--json]
  expected: §26: no match → exit 1; empty file listed in skipped ("every file not in the plan"); no crash
  observed: no-match error exit 1; JSON skipped ["01-empty.md"], no crash
  verdict: PASS

F33 | Unicode-heavy content + unicode concept needle
  cmd: cd uni (01-uni.md CJK nodes) && budget read sessions --json; budget read 会话 --json
  expected: §26: token estimate Math.ceil(len/charsPerToken) sane positive int; no crash; unicode concept normalized/matched
  observed: concept "sessions" → canonical home 01-uni.md anchor Sessions, estTokens 10 (54-char/94-byte file); concept "会话" → anchor "会话管理" matched, exit 0. No crash/mojibake.
  verdict: PASS

F34 | estimate_chars_per_token config honored (unicode workspace)
  cmd: estimate_chars_per_token: 1.0 → estTokens?; 7.0 → ?
  expected: §26: token estimate scales with configured chars-per-token
  observed: 1.0 → 35; 7.0 → 5; 3.5 → 10 (= ceil(35/3.5)) — formula applied to a 35-char text unit, config honored
  verdict: PASS

F35 | Huge file (189 KB, 4501 nodes) — empty-plan diagnosis at default limit + perf
  cmd: cd huge && budget read huge; --limit 999999 --json; --limit 60000 (warn); + 02-small.md mention file, --limit 5000
  expected: §26/#15: 48861-tok item > 4096 default → truthful empty-plan message naming token_budget.default_limit AND top-priority item, exit 1; big limit → full plan exit 0; warn at ≥80%; best-effort: big item skipped, small mention planned
  observed: default → `✗ plan empty: token_budget.default_limit (4096) in _rules.yaml is below the top-priority item 01-huge.md (48861 tok) — raise default_limit or pass --limit` exit 1, 74 ms; --limit 999999 → plan full, usage 4.9%, exit 0; --limit 60000 → stderr warn (81.4%) exit 0; --limit 5000 with 02-small.md → plan [02-small.md (9 tok, mentions)], skipped [01-huge.md], exit 0 — no false "below cheapest" claim
  verdict: PASS

F36 | `budget --help` / bare `budget` (subcommand surface)
  cmd: budget --help; budget
  expected: §37-shaped usage error exit 1 (no budget-level help surface documented; `cans help` is the help entry)
  observed: both → `✗ usage: cans budget <read|write> <concept>` exit 1
  verdict: PASS

F37 | `cans help` budget line matches §20 command surface
  cmd: cans help
  expected: §20: `budget read <concept> [--limit <tokens>] [--change <name>] [--json]` + `budget write <concept> [--json]`
  observed: both lines verbatim as §20 (§36's older help example omits --change — pre-existing §36 drift, not budget regression)
  verdict: PASS

F38 | budget arg-edge matrix
  cmd: budget read; budget read --limit 10; budget write; budget read sessions extra; budget read sessions --limit; budget bogus sessions
  expected: §20/§37: missing concept → usage error exit 1; missing flag value → error exit 1; unknown subcommand → error exit 1; extra positional undefined by docs
  observed: usage+example errors exit 1 (read/write/no-concept-with-flag); `flag "--limit" requires a value` exit 1; `unknown subcommand "bogus" — valid: read, write` exit 1; `budget read sessions extra` → extra positional SILENTLY IGNORED, full plan exit 0 (UNDOC leniency, mirrors QA-10 C12 status precedent)
  verdict: PASS

F39 | `budget read --change <name>` forms
  cmd: multi ws: budget read --change fix-invoices; budget read invoices --change fix-invoices
  expected: §20 syntax `budget read <concept> [--change <name>]`; §26: plan centered on task file + 1-hop refs, budget applied
  observed: no-concept form → usage error exit 1 (§26's `budget read --change <name>` heading alone is not a standalone form — docs tension §20 vs §26 noted); with concept: plan re-centered: task first (`active task`, 38 tok) → home (10) → back-ref (24), Budget 72/4096, exit 0
  verdict: PASS

F40 | `budget write <concept>` scope + JSON shape
  cmd: multi ws: budget write invoices [--json]
  expected: §26: CAN edit = canonical home + active task mentioning; MUST NOT edit = only-see:-ref files; backPointersToUpdate entries; §35 budget-write.json keys
  observed: canEdit [01-aaa.md canonical home, _tasks/fix-invoices.md active task]; mustNotEdit [02-bbb.md "only has see: reference"]; backPointersToUpdate [{fromFile 02-bbb.md, fromLine 2, toFile 01-aaa.md}]; exit 0; JSON keys match §35 fixture
  verdict: PASS

F41 | DUAL RUNTIME (bun 1.3.14): --limit 30 best-effort packing
  cmd: bun .../bin/cans.js budget read sessions --limit 30 (canon)
  expected: identical to Node (F02): plan [02-api.md], exit 0
  observed: identical output, exit 0
  verdict: PASS

F42 | DUAL RUNTIME: --limit 10 truthful empty plan
  cmd: bun .../bin/cans.js budget read sessions --limit 10
  expected: identical to Node (F04): §26 message, exit 1
  observed: identical message, exit 1
  verdict: PASS

F43 | DUAL RUNTIME: config-source default_limit: 10
  cmd: bun .../bin/cans.js budget read sessions (config 10)
  expected: identical to Node (F08): §26 config-source message, exit 1
  observed: identical message, exit 1
  verdict: PASS

F44 | DUAL RUNTIME: --limit abc rejected
  cmd: bun .../bin/cans.js budget read sessions --limit abc
  expected: identical to Node (F13): invalid value, exit 1
  observed: identical, exit 1
  verdict: PASS

F45 | DUAL RUNTIME: no-match JSON error
  cmd: bun .../bin/cans.js budget read zzznope --json
  expected: identical to Node (F10): no-match error in JSON
  observed: identical error string
  verdict: PASS

F46 | Mid-tier skip + skipped list incl. matching-but-unaffordable task file
  cmd: multi ws: budget read invoices --limit 50; --limit 12 --json
  expected: §26 step 4: walk continues past non-fitting items; skipped lists every non-planned file incl. the 38-tok task that didn't fit; usage math 48/50=96%, 10/12=83.3%; warning at ≥80% (stderr); exit 0
  observed: limit 50 → plan [home 10, task 38] 48/50 (96%), skipped [02-bbb, 03-ccc, 04-ddd], warn 96%, exit 0. limit 12 → plan [home 10] 83.3%, skipped [cans/_tasks/fix-invoices.md, 02-bbb, 03-ccc, 04-ddd], warn, exit 0. (Task file IS in skipped when it matches but doesn't fit — narrows F25 to no-connection task files.)
  verdict: PASS

F47 | Config-source limit values are NOT validated like the flag
  cmd: sed default_limit: abc → budget read sessions [--json]; default_limit: -5 → same
  expected: §26 "Both limit sources (--limit flag and token_budget.default_limit) get the same diagnosis" + issue #15 flag/config parity: non-numeric config limit should be rejected/diagnosed (flag path: `✗ invalid --limit value "abc" — pass a positive integer` exit 1)
  observed: default_limit: abc → SUCCESS: full plan, `Budget: 44 / abc tokens (0%)`, exit 0, JSON budgetLimit is the STRING "abc", usagePercent 0. default_limit: -5 → empty-plan message naming (-5), exit 1 (truthful but not parity with flag's "invalid" rejection).
  verdict: FAIL (MAJOR — config-source "abc": silent garbage limit, ok:true, string budgetLimit in JSON; the exact config-source path issue #15 claimed to fix is unvalidated. -5 sub-case: MINOR parity gap.)

F48 | Canonical-home tie-breaks: earliest file sort; lowest depth
  cmd: tie ws: (01-a.md + 02-b.md, both Sessions 1 child same depth) → home?; then (02-b.md depth-2 Sessions + 03-c.md root Sessions) → home?
  expected: §26 step 2: "highest child count → lowest depth → earliest file sort"
  observed: case 1 → home 01-a.md (earliest), 02-b.md mention 20; case 2 → home 03-c.md (depth beats file sort). Both exit 0.
  verdict: PASS

F49 | Child-count priority + concept case normalization + AGENTS.md scope
  cmd: tie ws + 04-d.md (Sessions 2 children) → home?; canon: budget read Sessions / SESSIONS; budget read handoff / tokens (words present in cans/AGENTS.md)
  expected: §26: child count is first criterion; concept normalized (case-insensitive); scope = spec+task files (§22 excludes AGENTS.md; §35 fixtures show only spec/task files in plans)
  observed: home 04-d.md (2 children beats 02-b's 1 despite later sort); Sessions/SESSIONS → same canonical plan; handoff/tokens → `no files match concept` exit 1 (AGENTS.md not scanned — correct scope)
  verdict: PASS

F50 | estimate_chars_per_token: 0 → Infinity tokens, unsatisfiable advice
  cmd: sed estimate_chars_per_token: 0 → budget read sessions [--limit 999999999] [--json]
  expected: §37: user-correctable error must name the REAL cause; a limit can never fix an invalid chars-per-token
  observed: `✗ plan empty: --limit 999999999 is below the top-priority item 01-auth.md (Infinity tok) — raise the limit` exit 1 — garbage "Infinity tok" estimate; advice unsatisfiable (no finite limit suffices); real cause (estimate_chars_per_token: 0) never named
  verdict: FAIL (MINOR — degenerate config, but a truthfulness hole in the exact #16 diagnosis path)

F51 | Concept whitespace not trimmed; empty concept rejected
  cmd: budget read " sessions "; budget read ""
  expected: §26 "Normalize concept" (normalization semantics unspecified — case normalization observed in F49); empty concept → §37 usage error
  observed: `" sessions "` → no-match error (concept NOT trimmed; message truthful about the searched string); `""` → usage error + example, exit 1
  verdict: PASS (trim not documented/contracted; noted)

---

## Summary

Total probes: 51 — **46 PASS / 5 FAIL** (0 exit-code-2 anomalies observed anywhere; every budget exit was 0 or 1 per §37; Bun re-runs of 5 key probes identical to Node).

### The coordinator's claim (issues #15/#16) — core verdict: HOLDS

Verified working exactly per §26 + issue Expected:
- Best-effort packing: non-fitting item skipped, walk continues, cheaper lower-scored item planned (F02, F03, F46, F35: 48861-tok item skipped, 9-tok mention planned).
- Empty plan (limit below top item): exit 1, message names the actual limit source (`--limit N` OR `token_budget.default_limit (N) in _rules.yaml`) AND the top-priority item with its token count — byte-exact with §26's two example messages (F04, F08).
- The old false messages are gone: no "below the cheapest item" claim in ANY variant (limits 0/10/11/12/25/30/50/5000/999999999/config 10 — whenever limit ≥ cheapest item the plan was non-empty), and no false "no files match concept" for budget-exhaustion (QA-10 M2 regression fixed; `--limit -5`/`abc` now rejected as invalid, exit 1).
- Flag/config parity for valid limits: `--limit 25` ≡ config 25 (JSON byte-identical, F09).
- No-match vs empty-plan distinction preserved (F10), incl. huge-file default-limit case (F35).
- JSON envelopes truthful and shape-consistent across flag-limit/config-limit/no-match (F06, F08, F10, F29); usagePercent math correct; warn_threshold fires at ≥80% incl. exactly-80% boundary, never changes exit code (F21/F22).
- Dual runtime: Bun 1.3.14 ≡ Node on all 5 key probes (F41–F45).

### FAIL list

| id | severity | one-line |
|---|---|---|
| F47 | **MAJOR** | Config-source limit values are not validated like the flag: `default_limit: abc` → ok:true, exit 0, `Budget: 44 / abc tokens (0%)`, JSON `budgetLimit` is the string `"abc"` — silent garbage success in the exact config-source path issue #15 claimed to fix; flag path rejects the same value (`✗ invalid --limit value "abc"`). (`default_limit: -5` sub-case: accepted into the empty-plan message — minor parity gap.) |
| F16 | MINOR (DOC-CONTRACT) | `token_budget.enabled: false` is a dead switch (§18 documents it; no observable effect on budget read). |
| F25 | MINOR (DOC-CONTRACT) | Task files with no connection to the concept are omitted from `skipped` entirely — §26 says skipped lists EVERY file not in the plan. (Matching-but-unaffordable task files ARE listed, F46.) |
| F28 | MINOR (DOC-CONTRACT) | §26's "forward ref (40)" scoring tier is unreachable — files the concept/home points TO never connect (score 0); only 100/80/60/20/0 observed. |
| F50 | MINOR | `estimate_chars_per_token: 0` → "top-priority item 01-auth.md (Infinity tok)" + unsatisfiable "raise the limit" advice; real cause (invalid chars-per-token) never named (§37 truthfulness). |

Non-FAIL observations (pre-existing gaps, not #15/#16 regressions): §26 concept matching is exact-substring, no stemming — "invoices" misses files that only say "Invoice" (F24/F26, QA-03 DOC-GAP family); `budget read sessions extra` silently ignores the extra positional (F38, QA-10 C12 precedent); warn text advises "raise default_limit" even when the limit came from `--limit` (F03); §35 budget fixtures are illustrative-only (task scored 20 vs §26's 80; 06-operations has no real sessions connection) — do not treat them as behavioral truth.
