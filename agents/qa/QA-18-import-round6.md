# QA-18 — Import/Export Interop, Round 6 (issue #20 fix verification)

- Agent: QA 4-b (Task ID 4-b), blackbox round.
- Target: cans-hq/cans-spec @ **23156fa**, checkout `/home/z/my-project/cans-spec` (READ-ONLY).
- CLI: `node /home/z/my-project/cans-spec/bin/cans.js <cmd>` (bun re-runs for dual-runtime probes).
- Scratch: `/home/z/my-project/qa-scratch/qa18/`.
- Contracts: issue #20 (diverged re-import must conflict, never append); docs §27 (import/merge matching + conflict semantics), §28 (export), §31 (converter internals), §35 (JSON fixtures incl. output/import.json), §36 (human output, help), §37 (error philosophy).
- Key §27 text under test: "A layer-2/3/4 hit with differing text is a conflict recorded in `conflicts[]` and resolved by the merge strategy — never a silent duplicate sibling appended. Logseq/Obsidian sources are normalized from their flat indent-annotated parse into a tree before the merge walk, so the sibling layers match against the real parent's children." Diverged-sibling guard: leading stem (first two significant words) identical AND token-Jaccard ≥ 0.3, or ≥ half of the existing sibling's significant tokens survive.

## Probes

F01 | Issue #20 core repro: diverged re-import must conflict, not append (human output)
  cmd: cd ws1; node cans.js init; node cans.js export logseq; sed -i 's/- Sign up: TBD/- Sign up: DONE - changed externally/' cans-export/logseq/02-authentication.md; node cans.js import logseq cans-export/logseq/02-authentication.md
  expected: no duplicate sibling; cans file stays "Sign up: TBD/Sessions: TBD/Passwords: TBD"; conflict surfaced with human marker + resolution (issue #20; §27 "never a silent duplicate sibling appended")
  observed: "  ~ 02-authentication.md (merged)" + "  ! 02-authentication.md:2 cans-wins"; exit 0; cans/02-authentication.md unchanged, 4 lines, no append
  verdict: PASS

F02 | Repeat import idempotent + --json conflicts[] shape (§35 output/import.json)
  cmd: node cans.js import logseq cans-export/logseq/02-authentication.md --json (second run)
  expected: same single conflict {file,line,cansVersion,importVersion,resolution}; no append; JSON shape per §35
  observed: ok:true, exitCode:0, format:logseq, source, newFiles:[], merged:["02-authentication.md"], conflicts:[{file:"02-authentication.md",line:2,cansVersion:"Sign up: TBD",importVersion:"Sign up: DONE - changed externally",resolution:"cans-wins"}]; file still 4 lines
  verdict: PASS
F03 | import-wins replaces diverged node text + conflict recorded
  cmd: node cans.js import logseq cans-export/logseq/02-authentication.md --merge-strategy import-wins
  expected: §27 "import-wins (overwrites on conflict)" — "Sign up: DONE - changed externally" replaces cans text; conflict in conflicts[] with resolution import-wins
  observed: human "  ! 02-authentication.md:2 import-wins"; file now has "Sign up: DONE - changed external edit..." replacing TBD line; exit 0
  verdict: PASS

F04 | Re-import after import-wins is clean (texts now identical)
  cmd: node cans.js import logseq cans-export/logseq/02-authentication.md --json (after F03)
  expected: exact-normalized match → no conflict (§27 layer 1), idempotent no append
  observed: conflicts: [], merged:["02-authentication.md"], file unchanged
  verdict: PASS

F05 | ask strategy: reports conflict, does NOT merge
  cmd: sed second divergence into export file; node cans.js import logseq <file> --merge-strategy ask (human + --json)
  expected: §27 "ask (report conflicts, don't merge)" — conflict listed, cans file untouched, merged empty
  observed: human "  ! 02-authentication.md:2 ask"; JSON merged:[], conflicts[{...,resolution:"ask"}]; file unchanged; exit 0
  verdict: PASS
F06 | B1: genuinely new distinct node appends cleanly (no false positive)
  cmd: ws2: sed adds "  - Sign in: social OAuth added" to export file; import logseq --json
  expected: distinct node → appended, conflicts: [] (issue #20 guard must not fire on new concepts)
  observed: node appended under Authentication at correct indent (last position), conflicts: [], exit 0
  verdict: PASS

F07 | B2 (docs example): "Sign in: TBD" vs existing "Sign up: TBD" → distinct, append
  cmd: ws2b fresh init+export; sed adds "  - Sign in: TBD"; import logseq --json
  expected: §27 "The stem — not an overlap floor — is the discriminator: 'Sign up: TBD' vs 'Sign in: TBD' has Jaccard 0.50 yet is a genuinely distinct sibling" → append, no conflict
  observed: appended as 4th child, conflicts: [], exit 0
  verdict: PASS
F08 | B3a: diverged nested node depth 3, reword changes stem word 2 — SILENT APPEND
  cmd: ws3: cans/07-profile.md has "    - Email requires verification"; export logseq; sed 's/    - Email requires verification/    - Email must be verified externally/'; import logseq --json
  expected: issue #20 contract — diverged re-import is a conflict, not a silent duplicate (task B: "conflict under the matched parent")
  observed: conflicts: [], node silently APPENDED as extra sibling under Account; file now has both "Email requires verification" and "Email must be verified externally"; exit 0. (Indent placement correct — depth 3, not root.)
  verdict: FAIL
  note: docs §27 blesses this boundary (stem "email requires" vs "email must" differ; J=1/7≈0.14) — CLI matches docs-as-written, but the reword is a morphological near-duplicate ("verified"≠"verification" token-exact) that issue #20's contract says must not be silently appended. Boundary escape, reproduces the original bug pattern for stem-altering rewords.

F09 | B3b: same-stem diverged nested node depth 3 (J 0.5) — guard fires
  cmd: ws4: same scaffold; sed reword to "    - Email requires verification via link token"; import logseq --json
  expected: §27 layer 4: stem identical + J 3/6=0.5 ≥ 0.3 → conflict, no append
  observed: conflicts:[{file:"07-profile.md",line:3,cansVersion:"Email requires verification",importVersion:"Email requires verification via link token",resolution:"cans-wins"}]; file unchanged (4 lines); exit 0
  verdict: PASS
F10 | B4 ladder (same-parent reword, controlled overlap): above-floor pairs conflict correctly
  cmd: ws5 crafted 08-guard.md (3 Cache-TTL pairs J 0.43/0.33/0.2 + 3 Migrate-schema pairs J 0.40/0.33/0.29, stem identical in all; + new depth-4 node); import logseq --json
  expected: §27 layer 4: conflict only when stem identical AND (J ≥ 0.3 OR ≥half existing tokens survive). Pair high/mid + Migrate five/six → conflict; Pair low (J 0.20, existing-containment 0.25) and Migrate seven (J 0.286, containment 0.286) → BELOW floor → distinct → append. Monotonic flip at floor.
  observed: ALL SIX same-stem pairs recorded as conflicts (incl. below-floor Pair low + Migrate seven); none appended. New depth-4 node "Resend cooldown applies" appended at correct indent 8 (flat-parse fix works). exit 0, merged:["08-guard.md"]
  verdict: FAIL
  note: below-floor same-stem rewords fire the guard anyway → documented J≥0.3/containment≥0.5 floors not honored; false-positive conflict under cans-wins DROPS the import node (it never lands in cans/08-guard.md). Direction: over-broad guard, not silent-append. Token math: Pair low {cache,ttl} shared of E=8/I=4 tokens → J=2/10=0.2, E-containment 0.25; Migrate seven E=7/I=2 → J=2/7=0.286.
F11 | Layer 2 near-match: stem-differing but J 0.75 → conflict (not append)
  cmd: ws6: E "Alpha beta gamma delta epsilon zeta eta" vs import "Alpha bat gamma delta epsilon zeta eta"; import logseq --json
  expected: §27 layer 2 near-match word overlap ≥ 0.75 → conflict despite stem differing at word 2
  observed: conflicts[{line:4, cansVersion/importVersion as crafted, resolution:"cans-wins"}]; not appended
  verdict: PASS

F12 | Same-stem, near-zero overlap (J 0.17) → correctly distinct (append)
  cmd: ws6: E "Cache TTL default sixty seconds postgres mysql oracle" vs import "Cache TTL zebras unicorns walruses narwhals"; import --json
  expected: §27 layer 4 floors not met (J 0.17 < 0.3, containment 0.25/0.33 < 0.5) → distinct → append
  observed: appended as 2nd child under "Stem zero", conflicts has only the Alpha pair; exit 0
  verdict: PASS
F13 | Containment side mismatch: existing-side 0.5 (documented) vs observed min-side
  cmd: ws6: E "Alpha beta gamma delta" (4 tok) vs import "Alpha beta epsilon zeta eta" (5 tok); shared=2 → J=2/7=0.286<0.3, existing-containment=0.5, import-containment=0.4; import --json
  expected: §27 layer 4 fires only via "at least half of the existing sibling's significant tokens survive" = 2/4 = 0.5 → conflict (docs prediction) — probe designed to separate existing-side vs import-side containment
  observed: CONFLICT (line 2, cans-wins). Combined with F10 (existing-c 0.25 fired via import-c 0.5) and F12 (import-c 0.33 → append), effective impl floor = same-stem AND (J≥0.3 OR shared/min(|E|,|I|)≥0.5), i.e. containment measured on the SHORTER side, not the documented existing side
  verdict: FAIL
  note: MINOR — formula-side mismatch only; both canonical doc examples behave as documented; deviation direction over-flags (never silently appends). Under cans-wins the below-doc-floor import node is dropped rather than appended.
F14 | C1 logseq roundtrip: export→import(dir)→byte-identical, re-export stable
  cmd: ws7: init; export logseq; import logseq cans-export/logseq --json; diff each export file vs cans file; re-export; diff -r
  expected: §27 preserve hierarchy; §28 export rules; roundtrip = identity (no conflicts, no newFiles); re-export stable
  observed: merged all 7 files, conflicts:[], all 7 files byte-identical, re-export diff clean; exit 0
  verdict: PASS

F15 | C2 obsidian roundtrip: export→import(dir)→byte-identical
  cmd: ws8: init; export obsidian; import obsidian cans-export/obsidian --json; per-file diff
  expected: same as F14 for obsidian format
  observed: merged 7, conflicts:[], all byte-identical
  verdict: PASS

F16 | C3 opml roundtrip + dynalist alias
  cmd: ws9: init; export opml; import opml cans-export/opml --json; import dynalist cans-export/opml/04-api.opml --json; content diff
  expected: §27 formats incl. dynalist alias; roundtrip identity
  observed: merged 7, conflicts:[]; 02-authentication.md content exact; dynalist alias accepted (merged 04-api.md, conflicts:[]); exit 0
  verdict: PASS

F17 | C4 fresh import of new nested logseq file → newFiles + depth-4 hierarchy preserved
  cmd: ws11: printf 4-level tree to fresh.md; import logseq fresh.md --json
  expected: §27 preserve hierarchy; newFiles populated (§35 fixture shows newFiles shape)
  observed: newFiles:["07-fresh-tree.md"], file created with exact 4-level tree; repeat import merged cleanly; exit 0
  verdict: PASS
F18 | D1: import nonexistent path — §37-style error, exit 1
  cmd: node cans.js import logseq /nonexistent/file.md (human + --json)
  expected: §37 error with fix hint; JSON ok:false + error; exit 1
  observed: human "✗ source not found: /nonexistent/file.md\n  Check the path and try again."; JSON ok:false, error field present, exitCode 1; exit 1
  verdict: PASS

F19 | D2: empty import file — clean no-op
  cmd: : > empty.md; import logseq empty.md (human + --json)
  expected: no nodes → nothing to merge; not a documented failure path
  observed: ok:true, newFiles/merged/conflicts all empty, exit 0; human prints "Imported logseq from empty.md" (claims import, imports nothing)
  verdict: PASS
  note: minor UX — "Imported" message on an empty source; no contract violated.

F20 | D3: root-only bullet file → newFile with single root
  cmd: printf '- Lone root\n' > rootonly.md; import logseq --json
  expected: §27 preserve hierarchy → single-node file created, newFiles reported
  observed: newFiles:["08-lone-root.md"], cans/08-lone-root.md contains "- Lone root"; exit 0
  verdict: PASS

F21 | D4: import file containing diverged duplicate siblings → both conflicts, no append
  cmd: ws12: file with "Sign up: DONE v1" + "Sign up: DONE v2" under Authentication; import --json
  expected: each diverged node conflicts against cans "Sign up: TBD" (issue #20 contract, no silent appends)
  observed: two conflicts[] entries (both line 2, resolution cans-wins), file unchanged; exit 0
  verdict: PASS

F22 | D4b: exact-duplicate and new-twin duplicates within import file
  cmd: ws12: file with "Sign up: TBD" ×2 → import; then "Brand new node" ×2 → import
  expected: exact twins match existing (no append); "Do NOT deduplicate" (§27) suggests new twins would append twice — exact-match layer may absorb 2nd
  observed: exact twins: no append, conflicts:[]; new twins: appended ONCE (2nd absorbed by exact match vs just-appended sibling); conflicts:[]
  verdict: PASS
  note: import dedupes identical new twins via layer-1 exact match — defensible, deviates from a literal "Do NOT deduplicate" reading.

F23 | D5: CRLF import file (clean + diverged) parses, no \r pollution
  cmd: ws13: CRLF file identical to spec → import; CRLF file with diverged Sign up → import --json
  expected: CRLF normalized (round-2 QA-08 found CRLF-only → 0 nodes; verify import path); conflict recorded without \r in importVersion
  observed: clean CRLF merged no-op; diverged CRLF → conflicts[] entry with clean "Sign up: DONE - changed externally", no append; exit 0
  verdict: PASS

F24 | D6: unicode content (CJK/emoji/accents) — diverged conflict + new unicode node appended
  cmd: ws14: uni.md with "Sign up: DONE — externallý edited ✅" + "新規ユーザー: SSO対応"; import --json
  expected: guard fires on diverged Sign up (existing-c 2/3); unicode new node appended intact
  observed: conflict recorded (clean unicode importVersion); "新規ユーザー: SSO対応" appended; exit 0
  verdict: PASS
F25 | CRITICAL: short "X: TBD" node reworded externally → STILL silently appends (issue #20 core symptom)
  cmd: ws14: mix.md with "  - Sessions: extended - changed externally" under Authentication; import logseq mix.md (human + --json)
  expected: issue #20 / §27: diverged re-import must conflict, never silently append a duplicate sibling
  observed: human output has NO "!" line ("~ 02-authentication.md (merged)" only); JSON conflicts:[]; cans/02-authentication.md gains BOTH "  - Sessions: TBD" and "  - Sessions: extended - changed externally"; exit 0; second import idempotent
  verdict: FAIL

F26 | CRITICAL: real-flow repro with "Passwords: TBD" (init→export→sed→import) — silent duplicate
  cmd: ws15: init; export logseq; sed 's/  - Passwords: TBD/  - Passwords: rotated monthly by policy/'; import logseq cans-export/logseq/02-authentication.md
  expected: issue #20 contract — conflict surfaced, file stays "Passwords: TBD" single sibling
  observed: NO conflict marker, conflicts:[]; file now has "  - Passwords: TBD" AND "  - Passwords: rotated monthly by policy"; exit 0
  verdict: FAIL

F27 | Control: 2-word concept "Rate limits: TBD" reworded → conflict IS caught (root cause = stem length)
  cmd: ws16: init; export; sed 's/  - Rate limits: TBD/  - Rate limits: one hundred per key/'; import --json
  expected: stem "rate limits" preserved → guard fires → conflict, no append
  observed: conflicts[{line:5, cansVersion:"Rate limits: TBD", importVersion:"Rate limits: one hundred per key", resolution:"cans-wins"}]; file unchanged
  verdict: PASS
  note: guard's stem = FIRST TWO significant words. 1-word concepts ("Passwords:", "Sessions:", "Storage:" … the dominant scaffold shape) have "TBD" as stem word 2, so a reword that replaces the TBD value escapes ALL four layers → silent append. 2-word concepts are protected. Root cause of F25/F26.
F28 | D8: parent node diverged in workspace → whole subtree silently duplicated, zero conflicts
  cmd: ws17: init; export; reword workspace parent "- Authentication" → "- Auth and identity"; diverge export child Sign up; import logseq --json
  expected: §27 "never a silent duplicate sibling appended" / issue #20 spirit: parent divergence should surface a conflict (or at minimum the diverged child conflict); §35 silent on parent divergence
  observed: conflicts:[]; entire "Authentication" subtree (incl. diverged "Sign up: DONE - changed externally") appended as a 2nd root under reworded parent; exit 0
  verdict: FAIL

F29 | D9: export into existing dirty export dir — overwrites spec files, leaves foreign files
  cmd: ws17: add 99-junk.md (no bullets) + dirty edit into cans-export/logseq; export logseq; re-import dir
  expected: export writes fresh content (7 files); docs silent on dir cleaning
  observed: 7 spec files regenerated correctly; 99-junk.md survived untouched; "7 files" count accurate; re-import of dirty dir ignores junk (0 nodes) — no newFiles; exit 0
  verdict: PASS
  note: stale files persist in export dir by design; a bullet-bearing stale file WOULD be imported as a new spec file on dir re-import.
F30 | E: import --dry-run reports conflicts but writes nothing
  cmd: ws18: diverged export file; import logseq <file> --dry-run --json; diff cans file
  expected: --dry-run (§36 help) = preview: conflict surfaced, workspace untouched
  observed: conflicts[] identical to real run, extra "dryRun": true field, file byte-identical; exit 0
  verdict: PASS

F31 | E: export --dry-run writes nothing, clear message
  cmd: ws18: export logseq --dry-run
  expected: preview only (§36 help)
  observed: "[dry-run] Would export logseq → cans-export/logseq (7 files). No files written."; exit 0
  verdict: PASS

F32 | E: import --out honored (import lands in target dir)
  cmd: ws18: import logseq <file> --out /tmp/outdir --json
  expected: §36 help [--out <path>]; QA-05 F11 fix
  observed: file imported into /tmp/outdir (as newFile 07-authentication.md since dir had no specs); exit 0
  verdict: PASS

F33 | E: export --json envelope matches §28 shape exactly
  cmd: export obsidian --json
  expected: §28 JSON: { ok, command, exitCode, format, outputDir, filesExported }
  observed: exactly those keys, values sane (7 files); exit 0
  verdict: PASS

F34 | Layer 1 exact match is FILE-WIDE, not same-parent (docs-ambiguous)
  cmd: ws20: cans/07-multi.md has "Other: value B" only under "Root two"; import file adds "Other: value B" under "Root one"; import --json
  expected: §27 layer 1 "(1) exact normalized text" (no parent scope stated; layers 2/3 explicitly same-parent) — ambiguous; parent-scoped reading would append under Root one
  observed: no append, no conflict — import node absorbed by exact text elsewhere in file; exit 0
  verdict: PASS
  note: docs-ambiguous; silently swallows a node whose text exists under a different parent (no conflict, no placement).

F35 | E capstone: mixed import (1 conflict + 1 new node, same file) — markers track JSON; appended node invisible in human output
  cmd: ws21: export file with diverged Sign up + new "MFA: totp and backup codes"; import (human)
  expected: ~ merged, ! conflict markers (§36 style); new node appended
  observed: "  ~ 02-authentication.md (merged)" + "  ! 02-authentication.md:2 cans-wins"; MFA node appended to cans file; exit 0
  verdict: PASS
  note: appended nodes within a merged file get no per-node human marker (only newFiles get "+") — human output doesn't reveal which nodes were added.

F36 | E: dir import envelope with newFiles+merged+conflicts populated together; new-file name derived from content root
  cmd: ws22: dir with diverged 02 + extra 07-extra.md; import logseq cans-export/logseq --json
  expected: §35 import.json shape with all three arrays populated
  observed: newFiles:["07-extra-area.md"], merged:[7 files], conflicts:[1 line-2 cans-wins]; exit 0. Note: new file named from root node "Extra area", not source filename 07-extra.md
  verdict: PASS

F37 | F: dual-runtime bun re-runs (4 key probes)
  cmd: ws19: bun cans.js init/export/import — (a) core repro diverged Sign up; (b) short-node Sessions escape; (c) nonexistent path exit code; (d) Rate limits control
  expected: same behavior as node for all four
  observed: (a) conflict recorded, no append, exit 0 — PASS; (b) "Sessions: extended - changed externally" SILENTLY APPENDED, conflicts:[] — the CRITICAL escape reproduces under bun; (c) exit 1, JSON error field — PASS; (d) conflict caught — PASS
  verdict: PASS for runtime parity (escape reproduces identically — consistent, not a bun-specific issue)
F38 | Third escape repro, different file (03-data.md Storage) + scaffold blast radius
  cmd: ws23: init; export; sed 's/  - Storage: TBD/  - Storage: postgres with PITR/'; import logseq cans-export/logseq/03-data.md
  expected: issue #20 contract — conflict, no append
  observed: NO "!" marker; cans/03-data.md gains both "  - Storage: TBD" and "  - Storage: postgres with PITR"; exit 0
  verdict: FAIL
  note: scaffold blast radius — 25 depth-2 nodes in the default init scaffold; only "Sign up" and "Rate limits" have 2-word stems (guarded). The other 22 "X: TBD" nodes (88%) are unprotected: any external edit that fills in the TBD (the exact scenario of issue #20's repro) silently appends a duplicate.

## Summary

| Metric | Count |
|---|---|
| Total probes | 38 |
| PASS | 31 |
| FAIL | 7 |

### FAIL list

| ID | Severity | One-line | Root cause |
|---|---|---|---|
| F25 | CRITICAL | "Sessions: TBD" externally reworded → silently appended duplicate, conflicts:[] (ws14) | stem word-2 escape |
| F26 | CRITICAL | Real-flow repro: "Passwords: TBD" → "Passwords: rotated monthly by policy" via init→export→sed→import appends duplicate, no conflict (ws15) | stem word-2 escape |
| F38 | CRITICAL | Same escape on 03-data.md "Storage: TBD" → "Storage: postgres with PITR"; 22/25 (88%) scaffold child nodes unprotected | stem word-2 escape |
| F28 | MAJOR | Workspace parent reworded + diverged child import → entire subtree appended as 2nd root, conflicts:[] | parent-divergence unmatched |
| F08 | MAJOR | Depth-3 reword changing stem word 2 ("Email requires verification" → "Email must be verified externally") silently appends | stem word-2 escape (nested shape; docs §27 blesses this boundary — docs contradict issue #20 contract) |
| F10 | MINOR | Same-stem pairs BELOW documented floors (J 0.20 / 0.286, existing-containment 0.25) fired as conflicts → import nodes dropped under cans-wins | containment side mismatch |
| F13 | MINOR | Diagnosis: effective containment = shared/min(|E|,|I|) ≥ 0.5, docs say shared/|existing| ≥ 0.5 | containment side mismatch |

### Root-cause analysis (blackbox-inferred)

1. **Stem word-2 escape (CRITICAL, F25/F26/F38/F08).** The guard requires the first TWO significant words to be identical. For 1-word concepts ("Passwords:", "Sessions:", "Storage:" …) the stem's 2nd word IS the TBD marker, so the exact scenario of issue #20 (an external tool fills in a TBD) changes stem word 2 → all four match layers miss → silent duplicate append, exit 0, no conflict marker. The fix demonstrably works only for the issue's literal repro shape ("Sign up" = 2-word concept). Control F27 proves the asymmetry: "Rate limits: TBD" reword → conflict caught. Issue #20's claim is NOT fixed for the dominant node shape of the scaffolded workspace.
2. **Parent divergence (MAJOR, F28).** When the workspace's parent node text was reworded, the import's parent misses all layers, and the whole child subtree is appended under a second root with conflicts:[] — no marker, exit 0. §27's "never a silent duplicate sibling appended" is violated one level up.
3. **Containment side (MINOR, F10/F13).** Documented "at least half of the existing sibling's significant tokens survive" is implemented as shared/min(|E|,|I|) ≥ 0.5. Over-flagging direction: shortened same-stem imports conflict instead of appending; under cans-wins the import node is dropped (visible in conflicts[], recoverable). Both canonical doc examples behave as documented.

### What held up
Core repro for 2-word concepts (F01/F02 idempotent), import-wins replace semantics, ask report-only semantics, exit 0 with conflicts (matches §35 fixture), JSON envelope key-for-key (§27/§28/§35), near-match layer 2 at J 0.75, stem-near-zero distinct append, depth-4 nested fresh imports, all three format roundtrips byte-identical + re-export stable, CRLF/unicode/duplicate-within-file handling, error path (§37, exit 1), --dry-run/--out honored, human markers (~ ! +) consistent with JSON, dual-runtime parity (node/bun identical on all 4 key probes).

### Verdict on the coordinator's claim
Issue #20 is **NOT fully fixed**. The guard works for the literal repro (stem-preserving rewords) but the same contract is still violated for (a) every 1-word-concept TBD node — 88% of the default scaffold — and (b) reworded parents. Claim should be reopened or scoped to "2-word-stem rewords only".
