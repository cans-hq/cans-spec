# QA-19 — refs round 6 (issue #22 blackbox re-verify)

- Repo: cans-hq/cans-spec @ 23156fa (agent-work branch, READ-ONLY checkout)
- Agent: QA 4-c (refs) — Task ID 4-c
- Method: blackbox CLI + filesystem only. `node /home/z/my-project/cans-spec/bin/cans.js <cmd>` from scratch workspaces under /home/z/my-project/qa-scratch/qa19/. No `src/` reads, no `bun test`, no fixes.
- Spec truth: docs/cans.architecture.md §11 (flat/folder resolution, trailing-slash equivalence), §12 (refs engine: resolution, back-pointers, deep-hop detection + advice contract, edge cases, orphans), §22 (check output), §37 (error message philosophy, exit codes via §19).
- Coordinator claim under test: issue #22 CLOSED — (a) deep-hop advice must not recommend a duplicate ref; (b) trailing-slash folder targets resolve.

## Probe record

F01 | `cans init --bare` creates skeleton (overview, _rules.yaml, AGENTS.md)
  cmd: cd /home/z/my-project/qa-scratch/qa19/w1 && node /home/z/my-project/cans-spec/bin/cans.js init --bare
  expected: §21 workspace skeleton, exit 0
  observed: `+ _rules.yaml + AGENTS.md + 00-overview.md`, exit=0
  verdict: PASS

F02 | Canonical issue #22 workspace built (auth folder + overview 2 refs + api 1 ref)
  cmd: rm cans/00-overview.md; mkdir cans/auth; write auth/index.md, 00-overview.md (`see auth#Sessions`, `see 01-api.md`), 01-api.md (`see auth/index.md#Sessions`)
  expected: fixture per task A
  observed: files written as specified
  verdict: PASS

F03 | Core deep-hop advice — no duplicate-ref recommendation, names existing ref, says remove hop
  cmd: node /home/z/my-project/cans-spec/bin/cans.js check
  expected: §12 deep-hop advice (issue #22): must NOT recommend adding a ref the referrer already holds; must name existing ref verbatim + instruct removing intermediate hop; exit nonzero w/ error (README: 2 errors)
  observed: REFS ✗ 1 deep-hop → `01-api:2 / ↳ 00-overview.md already refs auth/index.md#Sessions as "see auth#Sessions" — remove the intermediate hop via 01-api.md`; no `add "see: ..."` advice; exit=2
  verdict: PASS

F04 | check --json shape for core repro
  cmd: node /home/z/my-project/cans-spec/bin/cans.js check --json
  expected: §22 JSON: refs.deepHops=1, suggestion field on refs.deep_hop issue, ok:false, exitCode nonzero
  observed: `ok:false, exitCode:2, refs:{total:3,broken:0,deepHops:1}`, refs section issue `refs.deep_hop` with detail `DEEP HOP: 00-overview.md → 01-api.md → auth/index.md` and suggestion naming existing ref; no add-advice
  verdict: PASS

F05 | Follow-the-advice loop (core repro): delete intermediate `see 01-api.md` line → re-check
  cmd: printf '- Overview\n  - Auth lives in: see auth#Sessions\n' > cans/00-overview.md; node .../cans.js check
  expected: deep hop gone (refs.deepHops=0), no broken refs; exit per README warnings-only contract (single-child warnings remain → 1; task brief said exit 0, README §exit-codes is truth: 1 warnings)
  observed: `refs:{total:2,broken:0,deepHops:0}`, ok:true, exitCode:1 (4 structure warnings remain — REFS section gone entirely)
  verdict: PASS (deep hop cleared; exit 1 = warnings-only per README exit triad, not 0 — noting the brief's exit-0 expectation assumes a warning-free workspace)

F06 | Trailing-slash variant of core repro (`see auth/#Sessions` + chain)
  cmd: w2: same fixture as F02 but overview ref `see auth/#Sessions`
  expected: §11/§12 (issue #22): `auth/#Sessions` resolves like `auth#Sessions` (0 broken refs); advice names existing ref verbatim, no add-advice, no `create auth/`
  observed: `REFS ✗ 1 deep-hop — 01-api:2 ↳ 00-overview.md already refs auth/index.md#Sessions as "see auth/#Sessions" — remove the intermediate hop via 01-api.md`; broken=0; exit=2 (error)
  verdict: PASS

F07 | Pure trailing-slash file-level ref `see auth/` (no chain)
  cmd: w3: overview `Entry: see auth/`; check --json
  expected: §12 edge table: `see: auth/` resolves like auth — 0 broken
  observed: refs {total:1, broken:0, deepHops:0}, no refs issues
  verdict: PASS

F08 | Matrix: `auth`, `auth//`, `auth/index.md`, `auth/index.md/` (folder w/ index.md present)
  cmd: loop rewriting overview ref; check --json each
  expected: §11 trailing slashes trimmed in target-key resolution — all four equivalent spellings resolve
  observed: all four → broken:0, deepHops:0, no refs issues
  verdict: PASS

F09 | Matrix: `auth#Sessions`, `auth/#Sessions`, `auth/index.md#Sessions`
  cmd: same loop
  expected: §12: anchored folder refs resolve (anchor exact match on node `Sessions`); trailing-slash equivalence (issue #22)
  observed: all three → broken:0 (no broken anchor), no refs issues
  verdict: PASS

F10 | Matrix: `./auth`, `./auth/` (dot-slash prefix)
  cmd: same loop
  expected: §12: dot-prefixed spellings are not documented as resolvable; if broken, suggestion must be truthful/actionable, never propose creating an existing path
  observed: both broken (`refs.broken.file`) with SUGG `fix the ref target — ./auth/ is a folder, not a spec file`; no create-proposal. Wording odd (folder w/ index.md IS a spec target per §11) but no hygiene violation
  verdict: PASS (with wording note)

F11 | Matrix: `AUTH` (case), `Auth/`, `auth\`
  cmd: same loop, colonless `see <spelling>`
  observed: `see AUTH` → refs.prose warning `see-like prose: "see AUTH" did not resolve…` (NOT a broken-ref error, broken:0, ok:true); `see Auth/` → broken ref error, SUGG `create Auth/index.md or fix the ref target` (Auth/ does not exist — no existing-path proposal); `see auth\` → refs.prose warning
  expected: §12 `File not found → Broken ref error`; §12 hygiene row
  verdict: FAIL (MINOR) — bare-word unresolvable targets (AUTH, auth\, auth2, auht) are downgraded to a warning-level undocumented "see-like prose" rule (ok:true, exit 1) instead of the §12 broken-ref error. `Auth/` itself is handled correctly.

F12 | Matrix colon variants: `see: #Sessions`, `see: AUTH`, `see: auht`
  cmd: same loop with colon
  expected: §11 regex `see:\s*(\S+?)(?:#(\S+))?` would parse `see: #Sessions` (file part `#`) → §12 broken ref error; §12 file-not-found = error
  observed: `see: #Sessions` → refs.total=0, silently ignored (no ref, no warning, no error); `see: AUTH`/`see: auht` → refs.prose warning downgrade (total:1, broken:0)
  verdict: FAIL (MINOR) — same-file anchor `#Sessions` silently dropped (no signal) vs documented §11 parse; bare-word missing targets downgraded (same family as F11)

F13 | Matrix: absolute `/tmp/whatever` and traversal `../escape`
  cmd: same loop, `see /tmp/whatever`, `see ../escape`
  expected: hygiene family (issue #10, task scope B): escape/absolute targets must never get create-* advice proposing paths outside the workspace; commit 3adbc91 (issue #10, unmerged branch origin/fix/issues-8-11-implementation) contract: report "file not found in workspace", suggestion never proposes creating outside paths ("no more 'create /etc/hosts'")
  observed: both → `refs.broken.file`, detail `broken ref: see /tmp/whatever — file not found`, SUGG `create /tmp/whatever or fix the ref target` (and `create ../escape or fix the ref target` for the traversal form)
  verdict: FAIL (MAJOR) — suggestion proposes creating absolute/traversal paths outside the spec workspace; issue #10 fix (3adbc91) is NOT an ancestor of HEAD 23156fa, so the hygiene hole is open on the build under test

F14 | Matrix: target with spaces `see my file.md`; unicode `see 权限/#会话`
  cmd: w3 loop; separate unicode folder cans/权限/index.md (node 会话)
  expected: §11 regex captures first token only (`my`); unicode dir/anchor resolution per §12 (no restriction on unicode)
  observed: spaces → ref target `my`, refs.prose warning (first-token parse is §11-consistent; severity downgrade = F11 family). unicode `权限/#会话` → broken:0, resolves cleanly
  verdict: FAIL (MINOR, spaces — same F11 prose-downgrade family) / PASS (unicode)

F15 | §11 both flat+folder exist → error (unnumbered slug): auth.md + auth/index.md
  cmd: w4: cans/auth.md + cans/auth/index.md (+ ref `see auth`); also identical-roots variant; also 3-file and no-ref variants (w6)
  expected: §11 "Flat wins. Both existing = error."
  observed: NO error in any variant — ref resolves (flat wins), only redundancy warnings (exact overlap, Layer-4 duplicate home as ⚠); exit 1
  verdict: FAIL (MAJOR) — flat-vs-folder conflict error does not fire for unnumbered slugs

F16 | §11 both flat+folder exist → error (numbered slug): 02-authentication.md + 02-authentication/index.md (QA-07 r2f1 repro)
  cmd: w5: exact QA-07 r2f1 repro (02-authentication pair + 04-api/index.md + ref)
  expected: §11 both existing = error (QA-02 F1 RESOLVED contract: `✗ duplicate home: both … exist — flat wins, remove the folder`, error)
  observed: `STRUCTURE ✗ 1× duplicate home — 02-authentication.md ↳ delete 02-authentication/index.md (or merge its content into 02-authentication.md)`, exit=2
  verdict: PASS (numbered slug fires; unnumbered does not — see F15)

F17/F18/F19 | Isolation of the duplicate-home trigger (file count, root text, refs presence)
  cmd: w4 variants (identical roots, +04-api/index.md, no refs), w6 (no refs at all)
  expected: §11 both existing = error regardless of slug naming
  observed: error fires ONLY for `NN-`-prefixed slug pairs (02-authentication*); never for auth.md+auth/index.md regardless of root-text identity, extra files, or refs
  verdict: FAIL (MAJOR) — trigger is slug-pattern-gated, not the documented generic both-existing condition (F15 root cause)

F20 | Task C: folder without index (`nofolder/` exists, no index.md)
  cmd: w7: `see: nofolder/`, `see: nofolder/#X`, `see: nofolder`
  expected: §12 hygiene row + task C: suggestion must be `create nofolder/index.md or fix the ref target`-style — actionable, existing-path-aware, never `create nofolder/`
  observed: `see: nofolder/` and `see: nofolder/#X` → broken error, SUGG `create nofolder/index.md or fix the ref target` ✓; `see: nofolder` (bare) → refs.prose warning downgrade (F11 family)
  verdict: PASS (slash forms) / FAIL (MINOR, bare form — F11 family)

F21 | Nested missing targets inside existing folder: `auth/sub/`, `auth/index2.md`, `auth/sub`
  cmd: w7 loop
  expected: §12: names the missing spec file or says fix the target; never propose an existing path
  observed: `create auth/sub/index.md or fix the ref target` / `create auth/index2.md or fix the ref target` / `create auth/sub or fix the ref target` — none propose existing paths
  verdict: PASS (note: bare nested `auth/sub` advice says create `auth/sub`, a file with no extension — imprecise but hygiene-clean)

F22 | 2-hop chain, no existing direct ref (advice must state hop removal)
  cmd: w8: overview→01-a.md→02-b.md; check
  expected: §12/§37 (issue #22): advice = add direct ref AND remove intermediate hop
  observed: `↳ add "see: 02-b.md" directly to 00-overview.md and remove the intermediate hop via 01-a.md`
  verdict: PASS

F23 | E-loop shape 1 (2-hop): follow advice exactly
  cmd: overview rewritten to `Alpha: see 02-b.md` (direct ref added, hop removed); check
  expected: deepHops 1→0, no new broken refs
  observed: deepHops=0, REFS section gone, exit 1 (structure warnings only)
  verdict: PASS

F24 | 3-hop chain (overview→01-a→02-b→03-c)
  cmd: w9; check --json
  expected: §12: every referenced file with outgoing refs flagged; full chain reported
  observed: deepHops=2 — `00-overview→01-a→02-b` and `01-a→02-b→03-c`, each with 2-part advice
  verdict: PASS

F25 | E-loop shape 2 step 1 (3-hop): follow first advice
  cmd: overview → `see 02-b.md` (added direct, removed overview→01-a); check
  expected: error count strictly decreases
  observed: deepHops 2→1 (remaining: `00-overview→02-b→03-c`)
  verdict: PASS

F26 | E-loop shape 2 step 2 (3-hop, multi-referrer state): follow printed advice exactly
  cmd: overview → `see 03-c.md` (added direct, removed overview→02-b per advice); check
  expected: advice sufficient — count strictly decreases or clears
  observed: deepHops stayed 1 (1→1): 02-b still referenced by 01-a; advice names only ONE referrer of the intermediate file, so the exact-follow leaves the hop; a third iteration (F27) clears it. (Other reading of "remove the hop via 02-b" — delete 02-b's outgoing ref — would clear immediately; advice does not disambiguate which edge.)
  verdict: FAIL (MINOR — advice insufficient for one exact-follow in multi-referrer shape; converges over iterations)

F27 | E-loop shape 2 step 3 (3-hop): follow remaining advice
  cmd: 01-a → `see 03-c.md`, remove 01-a→02-b; check
  expected: deepHops=0
  observed: deepHops=0, broken=0
  verdict: PASS

F28 | Self-loop (A refs A, referenced by overview)
  cmd: w10; check
  expected: §12 edge table: Self-reference = Error
  observed: `✗ 1× self reference — 01-a:2 ↳ remove the self-reference; point at the canonical file instead`, exit 2
  verdict: PASS

F29 | Mutual pair A↔B (overview→01-a)
  cmd: w11; check
  expected: §12 literal text would flag both (referenced + outgoing); repo-adjudicated issue #5 contract (QA-16 P5): SCC back-refs are never deep hops
  observed: clean — no refs issues, exit 1 (structure warnings only)
  verdict: PASS (per issue #5 contract; NOTE: §12 text still lacks the mesh/SCC exception — doc-gap)

F30 | Deep-hop config toggle in _rules.yaml
  cmd: w12: `references: max_hops: 2` then `references: deep_hop: false`
  expected: §18 documents `references.max_hops` (default 1) as the refs rule; no `deep_hop` key documented
  observed: max_hops: 2 → deepHops=0 (toggle honored); undocumented `deep_hop: false` → still deepHops=1 (inert, as undocumented)
  verdict: PASS

F31 | Deep-hop chain with anchor targets (overview→01-a#Beta; 01-a→02-b#Delta)
  cmd: w13; check
  expected: §12 deep hop fires; advice carries anchored target
  observed: `↳ add "see: 02-b.md#Delta" directly to 00-overview.md and remove the intermediate hop via 01-a.md`
  verdict: PASS

F32 | Duplicate-guard across anchor case variants (existing `02-b.md#delta`, suggested `02-b.md#Delta`)
  cmd: w14; check
  expected: §12 (issue #22): equivalent spelling recognized (anchors case-insensitive per §12), advice names existing ref verbatim
  observed: `00-overview.md already refs 02-b.md#Delta as "see 02-b.md#delta" — remove the intermediate hop via 01-a.md`
  verdict: PASS

F33 | Self-loop with anchor (`see 01-a.md#Beta`), referenced + unreferenced variants
  cmd: w15; check (both variants)
  expected: §12 self-reference = error
  observed: `✗ 1× self reference` in both variants (exit 2; errors=1 even when unreferenced)
  verdict: PASS

F34 | E-loop shapes 3 (anchor chain) + 4 (trailing-slash guard case): follow advice
  cmd: w13 overview→`see 02-b.md#Delta`; w2 overview→`see auth/#Sessions` only; check
  expected: deepHops=0, broken=0 after following advice
  observed: both → deepHops=0, broken=0, ok:true
  verdict: PASS

F35 | check --fix writes marks (file-level + anchored, mixed spellings incl. trailing slash)
  cmd: w16: overview `see auth/` + `see auth/index.md#Sessions`, 01-api `see auth#Sessions`; check --fix
  expected: §22/§12 (issues #19/#22): standalone mark after first root bullet for file-level; inline mark on Sessions node grouping ALL equivalent anchored spellings
  observed: auth/index.md → `- Authentication` / `<!-- ref-by: 00-overview.md -->` / `  - Sessions <!-- ref-by: 00-overview.md, 01-api.md -->` — correct placement, `auth#Sessions` and `auth/index.md#Sessions` grouped in one mark
  verdict: PASS

F36 | Post-fix consistency + idempotency (§22)
  cmd: check --json; check --fix --json
  expected: §22: refs unchanged by --fix; backPointers consistent; re-fix idempotent
  observed: refs {total:3,broken:0,deepHops:0} pre and post; backPointers {total:3,current:3,stale:0}; backPointersUpdated=0 on re-run
  verdict: PASS

F37 | Anchor retarget to nonexistent anchor (broken anchor + stale mark)
  cmd: w16: 01-api `see auth#Rotation` (no exact node); check
  expected: §12: no fuzzy anchor matching — broken anchor error, actionable suggestion; old mark can never read current
  observed: `✗ 1× broken anchor — 01-api.md:3 → auth#Rotation ↳ fix the anchor or add a "Rotation" node to auth`; stale back-pointer warning for the old mark; exit 2
  verdict: PASS (note: `refs.broken` counter stays 0 while a broken-anchor ERROR is present — see F40b)

F38 | Anchor retarget to existing node (stale mark path)
  cmd: w16: marks written, then 01-api `#Sessions`→`#Rotation`; check
  expected: §12 (issue #19): old mark STALE → warning + --fix rewrite
  observed: `⚠ 1× stale back-pointer — auth/index:3 ← 01-api`; backPointers {total:3,current:2,stale:1}; exit 1
  verdict: PASS

F39 | --fix rewrites stale mark (moves to new node)
  cmd: w16: check --fix
  expected: §12/§22: mark moved to Rotation node, stale=0, updated≥1
  observed: `backPointersUpdated=1, {total:3,current:3,stale:0}`; Sessions mark loses 01-api, `  - Rotation <!-- ref-by: 01-api.md -->` gained
  verdict: PASS

F40 | Broken anchor + existing mark ("earns no mark at all")
  cmd: w16: 01-api `see auth#Ghostnode`; check
  expected: §12 (issue #19): broken anchor = error, old mark stale (never current)
  observed: `✗ 1× broken anchor` + `⚠ 1× stale back-pointer — 01-api.md no longer refs auth/index.md#Rotation`; exit 2; --fix then removed the stale entry (updated=1, total 2, stale 0)
  verdict: PASS

F40b | refs.broken counter excludes broken anchors
  cmd: w16 (F37/F40 state): check --json
  expected: §12 calls a not-found anchor "broken ref error"; §22 `refs:{total,broken,deepHops}` — broken should reflect broken refs
  observed: broken anchor ERROR present, errorCount=1, ok:false, exit 2 — but `refs.broken: 0` (only file-level misses counted)
  verdict: FAIL (MINOR — machine consumers filtering on refs.broken miss broken-anchor errors; doc-ambiguous counter semantics)

F41 | --fix mark removal + trailing-slash referrer grouping (23156fa merge invariant)
  cmd: w16: --fix after broken anchor (removes stale 01-api mark); add 02-ui `see auth/#Sessions`; check --fix
  expected: 23156fa: trailing-slash refs group under the loaded key, never raw 'auth/' form; broken anchor earns no mark
  observed: stale entry removed; Sessions inline mark = `<!-- ref-by: 00-overview.md, 01-api.md, 02-ui.md -->` — `auth/#Sessions` grouped with `auth#Sessions` and `auth/index.md#Sessions`
  verdict: PASS

F42 | Exit triad: warnings-only and --strict
  cmd: w17 (fresh default `cans init`): check, check --strict --json
  expected: README exit contract: 0 clean · 1 warnings · 2 errors; --strict flips ok on warnings
  observed: default template → exit 1 (9 warnings: 6 orphan + 3 redundancy); --strict → ok:false, exitCode 1
  verdict: PASS (note: default template is not warning-free — pre-existing template-quality item, QA-01 territory)

F43 | Exit triad: clean workspace → 0
  cmd: w18 minimal clean workspace; check; check --strict
  expected: exit 0 both
  observed: `✓ 2 files · 6 nodes · depth 2 · 6ms`, exit 0; --strict exit 0
  verdict: PASS

F44 | G: bun runtime — core repro deep-hop advice
  cmd: w19 (canonical fixture); `bun .../bin/cans.js check`
  expected: identical to node behavior (F03)
  observed: identical advice `00-overview.md already refs auth/index.md#Sessions as "see auth#Sessions" — remove the intermediate hop via 01-api.md`, exit 2
  verdict: PASS

F45 | G: bun runtime — trailing slash resolves + absolute-path advice
  cmd: w20: `see auth/` + `see /tmp/whatever`; `bun .../bin/cans.js check`
  expected: auth/ resolves (0 broken for it); /tmp advice must not propose outside-workspace creation (issue #10 family)
  observed: auth/ resolved (only /tmp broken) ✓; SUGG `create /tmp/whatever or fix the ref target` — same hygiene bug under bun
  verdict: PASS (trailing slash) / FAIL (hygiene advice — F13 family reproduces under bun)

F46 | G: bun runtime — --fix grouping invariant
  cmd: w21: overview `see auth/` + `auth/index.md#Sessions`, 02-ui `see auth/#Sessions`; `bun .../bin/cans.js check --fix`
  expected: same marks as node (F35/F41)
  observed: `- Authentication` / `<!-- ref-by: 00-overview.md -->` / `  - Sessions <!-- ref-by: 00-overview.md, 02-ui.md -->`; backPointers {total:3,current:3,stale:0}
  verdict: PASS

F47 | Duplicate-guard NEGATIVE: referrer holds an unrelated existing ref
  cmd: w22: overview refs 01-a + 03-c; 01-a→02-b; check
  expected: plain add+remove advice; no false "already refs" claim
  observed: `add "see: 02-b.md" directly to 00-overview.md and remove the intermediate hop via 01-a.md`
  verdict: PASS

F48 | §12 edge rows: _tasks/ (warning), _collab/ (error), multiple see: on one line
  cmd: w22: overview refs `_tasks/t1.md`, `_collab/handoffs.md`, `see 02-b.md and see 03-c.md`; check
  expected: §12 edge table: _tasks → warning; _collab → error; both refs on one line parsed+validated
  observed: `⚠ transient ref: see _tasks/t1.md … re-point at a spec file when the task lands`; `✗ ref to _collab/ — collab notes are not spec`; refs.total=5 (both line-4 refs counted); exit 2
  verdict: PASS

F49 | §12 edge row: `see:` inside `see:` target
  cmd: w22: `- Weird: see see:02-b.md`; check
  expected: §12 edge table: "see: inside see: target → Deep hop error"
  observed: `broken ref: see see:02-b.md — file not found | create see:02-b.md or fix the ref target` (broken-file error, not deep hop)
  verdict: FAIL (MINOR — documented edge-row behavior not implemented as specified; observed error is truthful but a different class)

F50 | `auth/index` and `auth/index/` spellings (auth/index.md exists)
  cmd: w20 loop; check --json
  expected: not documented equivalent spellings (§12 set = auth/, auth, auth/index.md); if broken, hygiene-clean advice
  observed: both broken; `create auth/index or fix the ref target` / `create auth/index/index.md or fix the ref target` — no existing-path proposals
  verdict: PASS (with wording-quality note: `see auth/index` not resolving to the existing auth/index.md is surprising UX)

F51 | Extensionless flat-file target `see 02-b` (02-b.md exists, no folder)
  cmd: w22: overview `see 02-b`; check --json (detail confirmed in F52)
  expected: §11 flat-then-folder for extensionless stems ("Try cans/02-authentication.md first") — should resolve to 02-b.md
  observed: `broken ref: see 02-b — file not found | create 02-b or fix the ref target` — extensionless resolves for FOLDER targets (see auth ✓ F08) but not flat files
  verdict: FAIL (MINOR — §11 flat-first not implemented for extensionless flat targets; asymmetric with folder spelling)

F53 | Escape refs to files that exist OUTSIDE the workspace (`/etc/hosts`, `../w20/cans/auth/index.md`)
  cmd: w20; check --json
  expected: issue #10: targets must never resolve outside the workspace; advice must never propose creating outside paths (commit 3adbc91 — NOT merged into HEAD)
  observed: both correctly BROKEN (resolution contained ✓ — refs graph never points outside the spec root on this build); BUT SUGG `create /etc/hosts or fix the ref target` and `create ../w20/cans/auth/index.md or fix the ref target` — proposes creating an EXISTING file (/etc/hosts exists) and outside-workspace paths
  verdict: FAIL (MAJOR — advice hygiene; resolution-containment itself holds)

F54 | Deep-hop duplicate-guard ignores ANCHORS: referrer holds a ref to the same FILE but a DIFFERENT node
  cmd: w23: 00-overview `- Auth: see auth#Passwords / - API: see 01-api.md`; 01-api `- Session use: see auth#Sessions`; auth/index.md has both Sessions and Passwords nodes; `node .../bin/cans.js check --json` (identical under `bun`)
  expected: §12 (issue #22): guard fires only when the referrer's existing ref "resolves to the same target under an equivalent spelling" (`see auth#Sessions` vs `see: auth/index.md#Sessions`); advice "names that existing ref verbatim". `auth#Passwords` resolves to a different node than the suggested `auth/index.md#Sessions` → plain add+remove advice expected
  observed: `SUGG: 00-overview.md already refs auth/index.md#Sessions as "see auth#Passwords" — remove the intermediate hop via 01-api.md` — self-contradictory (names target #Sessions, quotes a #Passwords ref); the referrer does NOT hold the Sessions ref the advice assumes. Following the advice's premise (remove hop, add nothing) silently drops the Sessions linkage from the overview graph; if 01-api.md is later deleted the ref is gone though the user was told it existed
  verdict: FAIL (MAJOR — new #22 guard over-triggers on file-key match, anchor ignored)

F55 | Same guard over-trigger for a FILE-LEVEL existing ref
  cmd: w24: 00-overview `- Auth area: see auth / - API: see 01-api.md`; 01-api `- Session use: see auth#Sessions`; check
  expected: §12 duplicate-guard is for equivalent spellings of the SAME (anchored) target; a file-level `see auth` is not an anchored spelling of `auth/index.md#Sessions`
  observed: `00-overview.md already refs auth/index.md#Sessions as "see auth" — remove the intermediate hop via 01-api.md` — claims an anchored ref the user does not hold (arguably mitigated by §12's file-level-satisfies-any-mark currency rule, but the advice text misstates the existing ref)
  verdict: FAIL (MINOR — advice text overstates the existing ref)

---

## Summary

Total probe rows: 53 (F01–F55; F17–F19 combined into one isolation row, F52 folded into F51, F54b folded into F54). Four rows carry split verdicts (F14, F20, F45, F53) → 57 verdict components: **42 PASS / 15 FAIL** (6 MAJOR-class components, 9 MINOR-class components).

### Distinct defect classes

| # | Class | Findings | Severity | Repro |
|---|---|---|---|---|
| C1 | create-* advice proposes absolute/traversal/outside-workspace paths (issue #10 hygiene family; fix 3adbc91 exists ONLY on unmerged branch `origin/fix/issues-8-11-implementation`) | F13, F45, F53 | MAJOR | `see /tmp/whatever` → SUGG `create /tmp/whatever or fix the ref target`; `see /etc/hosts` → `create /etc/hosts` (proposes creating an EXISTING file); `see ../escape` → `create ../escape` |
| C2 | Deep-hop duplicate-guard matches on loaded FILE key, ignores the anchor → false "already refs" claims | F54 (MAJOR), F55 (MINOR) | MAJOR | overview `see auth#Passwords` + `see 01-api.md`; 01-api `see auth#Sessions` → advice: `already refs auth/index.md#Sessions as "see auth#Passwords"` |
| C3 | §11 "Both existing = error" not implemented for unnumbered slugs (fires only for `NN-`-prefixed pairs) | F15, F17/18/19 | MAJOR | `cans/auth.md` + `cans/auth/index.md` both exist → no error, exit 1 (warnings only); `02-authentication.md` + `02-authentication/index.md` → error fires (F16) |
| C4 | §12 "File not found → Broken ref error" downgraded to warning-level undocumented `refs.prose` for bare-word targets; `see: #Sessions` (same-file anchor) silently dropped (refs.total=0, no signal) | F11, F12, F14(spaces), F20(bare) | MINOR | `see: AUTH` / `see: auht` / `see: auth2` → `refs.prose` warning, ok:true; `see: #Sessions` → ignored entirely. NOTE: the prose downgrade is the adjudicated issue #4 contract (QA-16 P4: "prose downgraded to see-like prose warnings"); §12 was never synced — doc-gap |
| C5 | Advice-following loop can plateau for one step in multi-referrer deep-hop shapes (advice names only one referrer of the intermediate file; "remove the intermediate hop via X" does not say which edge) | F26 | MINOR | 3-hop chain, follow advice step-by-step: 2→1→1→0 |
| C6 | `refs.broken` JSON counter excludes broken-anchor errors (§22 `refs:{total,broken,deepHops}` vs §12 "Not found = broken ref error") | F40b | MINOR | broken anchor error present, errorCount=1, ok:false — `refs.broken: 0` |
| C7 | §12 edge-row `see:` inside `see:` target documented as Deep hop error; observed broken-file error | F49 | MINOR | `- Weird: see see:02-b.md` |
| C8 | §11 flat-first resolution not implemented for extensionless FLAT targets (works for folders: `see auth` ✓; `see 02-b` with 02-b.md present → broken) | F51/F52 | MINOR | `see 02-b`, `cans/02-b.md` exists → `broken ref: see 02-b — file not found` |

### Verdict on the coordinator's issue #22 closure claim

**PARTIAL — the two headline repros are genuinely fixed, but the claim does not fully hold.**

What holds (verified on both runtimes):
- Trailing-slash folder targets resolve everywhere tested: `auth/`, `auth//`, `auth/index.md/`, `auth/#Sessions` — broken refs, anchors, deep-hop edges, back-pointer grouping all agree (F06–F09, F35, F41, F44–F46), including the 23156fa merge invariant (trailing-slash referrers group under the loaded key, never the raw `auth/` form — F41).
- The canonical repro's advice no longer recommends a duplicate: it names the existing ref verbatim and instructs removing the intermediate hop, and following it clears the deep hop (F03–F05, F44). Plain no-existing-ref advice states the hop removal (F22, F24, F31, F47).

What breaks the claim:
- The new duplicate-guard itself misfires (C2/F54): for a referrer holding `see auth#Passwords`, the advice asserts `already refs auth/index.md#Sessions as "see auth#Passwords"` — a false, self-contradictory claim that violates §12's own "resolves to the same target" and "names that existing ref verbatim" contract. This is issue #22's own feature, not a pre-existing hole.
- The #22 commit's hygiene claim ("brokenRefSuggestion — same hygiene family as #10 — sanitizes create-* advice") is incomplete: absolute/traversal targets still get create-outside-workspace advice, including "create" proposals for files that exist (/etc/hosts) (C1/F13/F53). Issue #10's fix (commit 3adbc91) was never merged into this branch; only its resolution-containment half happens to hold.

Adjacent §11/§12 gaps found while testing (not #22 regressions): C3 (both-existing error unnumbered), C4 (prose downgrade, intended per issue #4 but undocumented), C5–C8.

Exit-code triad (README: 0 clean · 1 warnings · 2 errors) verified end-to-end (F42, F43; errors → 2 throughout). §22 --fix scope/back-pointer consistency/idempotency verified (F35–F41). §12 edge rows verified: self-reference (F28/F33), _tasks/ warning + _collab/ error + multi-see-per-line (F48), case-insensitive anchors (F32), mutual-pair SCC exemption per issue #5 (F29). Runtime parity node/bun confirmed on 4 key probes (F44–F46, F54).
