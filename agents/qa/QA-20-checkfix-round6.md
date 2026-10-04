# QA-20 — check --fix blackbox (issues #19 anchor-aware marks + #21 byte-preserving EOL writes)

Task ID: 4-d | Agent: QA 4-d | Repo: cans-spec @ 23156fa (READ-ONLY)
CLI: `node /home/z/my-project/cans-spec/bin/cans.js <cmd>` (Bun re-runs in section F)
Method: manual shell probes only, no src/ reads, no bun test, no fixes. Scratch: /home/z/my-project/qa-scratch/qa20/
Spec truth: docs/cans.architecture.md §12 (Back-pointers, anchor-aware marks), §22 (`--fix` placement + byte-preserving writes), §19 (exit codes), README.

## Probe record

F01 | A-core: anchored ref earns INLINE mark on referenced node
  cmd: cd qa20/a (init --bare, rm 00-overview.md, printf 01-auth.md + 02-api.md w/ `see 01-auth.md#Sessions`) ; node .../cans.js check --fix ; od -c cans/01-auth.md
  expected: `  - Sessions <!-- ref-by: 02-api.md -->` inline on the Sessions bullet; rest byte-identical (§12 anchor-aware marks, §22 --fix placement)
  observed: od shows `  -   S e s s i o n s   < ! - - r e f - b y :   0 2 - a p i . m d - - > \n` inserted before that line's \n; all other bytes untouched; JSON backPointers 1/1 current
  verdict: PASS

F02 | A-core: retarget makes old mark STALE (not current), --fix MOVES it
  cmd: sed -i 's|#Sessions|#Passwords|' cans/02-api.md ; check --json ; check --fix ; od -c cans/01-auth.md ; check --json
  expected: old mark stale (warning + --fix rewrite per §12 Currency); mark lands on `- Passwords`; re-check 1/1 current
  observed: backPointers {total:1,current:0,stale:1} + rule refs.backpointer.stale "02-api.md no longer refs 01-auth.md#Sessions"; after --fix mark on `- Passwords <!-- ref-by: 02-api.md -->`, Sessions line restored; re-check 1/1 current, no stale
  verdict: PASS

F03 | A-core: broken anchor flagged, earns no mark, --fix writes nothing for it
  cmd: sed -i 's|#Passwords|#NoSuchNode|' cans/02-api.md ; check --json ; check --fix ; od -c cans/01-auth.md ; check --json
  expected: §12 — broken anchor = error, earns no mark, can never read as current; --fix must not write a mark
  observed: refs.broken.anchor error (exit 2); old mark read stale; after --fix the old mark was REMOVED and file restored to original 104-byte content (od identical to pre-test); backPointers {total:0,current:0,stale:0}; exit 2 (remaining error → nonzero)
  verdict: PASS

F04 | B: CRLF target, inline anchored mark — line terminator preserved
  cmd: cd qa20/b1 (printf CRLF 01-api.md `- API\r\n  - Rate limits\r\n    - 100 requests per minute\r\n`; 02-auth.md `see 01-api.md#Rate-limits`) ; check --fix ; od -c cans/01-api.md
  expected: §22 byte-preserving — inserted mark text goes before the line's own `\r\n`; every other byte untouched
  observed: `  -   R a t e   l i m i t s   < ! - - r e f - b y :   0 2 - a u t h . m d - - >  \r \n` then original `\r\n` lines; `- API\r\n` and `    - 100 requests per minute\r\n` byte-identical
  verdict: PASS

F05 | B: CRLF target, standalone (file-level) inserted line mints `\r\n`
  cmd: cd qa20/b2 (01-api.md all-CRLF; 02-ops.md `see 01-api.md`) ; check --fix ; od -c cans/01-api.md
  expected: §22 — only INSERTED comment lines mint the file's DOMINANT EOL (CRLF here); CRLF file stays fully CRLF
  observed: inserted `<!-- ref-by: 02-ops.md -->  \r \n` right after first root bullet; zero `\n`-only bytes introduced; all original bytes untouched
  verdict: PASS

F06 | B: LF workspace stays pure LF + idempotency
  cmd: cd qa20/b3 (all-LF files) ; check --fix ; od -c ; check --fix again ; cmp
  expected: §22 — LF file stays fully LF; second run changes zero bytes
  observed: mark `  - Rate limits <!-- ref-by: 02-auth.md -->\n`, no `\r` anywhere; `IDEMPOTENT: zero bytes changed`
  verdict: PASS

F07 | B: MIXED-EOL file — dominant EOL for inserted lines, per-line terminators preserved
  cmd: cd qa20/b4 (01-api.md: 3×`\r\n` + 1×`\n` lines; referrer anchored #Rate-limits + referrer file-level) ; check --fix ; od -c
  expected: §22 — inserted standalone line mints dominant EOL (CRLF, 3v1); untouched lines keep their own terminators; inline edit keeps that line's `\r\n`
  observed: inserted `<!-- ref-by: 03-ops.md -->\r\n`; `  - Rate limits <!-- ... 02-auth.md -->\r\n`; `  - Notes\n` kept `\n`; `    - 100 requests per minute\r\n` kept; second --fix = zero byte changes (cmp)
  verdict: PASS

F08 | B: file with no trailing newline — EOF-newline-less property preserved
  cmd: cd qa20/b5 (01-api.md ends `...per minute` no \n; file-level ref) ; check --fix ; od -c
  expected: §22 — no EOL normalization; last line still unterminated; inserted line mints dominant EOL (LF)
  observed: `- API\n<!-- ref-by: 02-ops.md -->\n  - Rate limits\n    - 100 requests per minute` — file still ends with NO terminator; inserted separator/terminator is `\n`; idempotent on re-run
  verdict: PASS (note: single-line unterminated file (b6/01-api.md `- API`) becomes `- API\n<!-- ref-by: ... -->` — one unavoidable minted separator, EOF still unterminated, idempotent)

F09 | B: empty target file — mark written, no crash, idempotent
  cmd: cd qa20/b6 (`: > cans/04-empty.md`; referrer `see 04-empty.md`) ; check --fix ; od -c cans/04-empty.md ; check --fix again ; cmp
  expected: §12/§22 — file-level ref resolved → mark must exist; placement "after first root bullet" undefined (no bullets); no crash, no exit 2
  observed: 0-byte file → `\n<!-- ref-by: 02-ops.md -->` (leading minted `\n`, comment line, no trailing newline); exit 0; idempotent (cmp equal); mark reads current (2/2)
  verdict: PASS (undefined-input observation: mark precedes with a minted `\n` — graceful, no corruption; noted as doc gap)

F10 | B: replace/drop paths keep or consume per-line terminators (mixed EOL)
  cmd: cd qa20/b7 (01-api.md: stale `<!-- ref-by: 09-stale.md -->\n` after root, stale `<!-- ref-by: 08-old.md -->\r\n` mid-file; referrer now 02-ops.md) ; check --json (2/2 stale) ; check --fix ; od -c
  expected: §22 — replaced comment keeps its line's own terminator (`\n` stays `\n` even though dominant is CRLF); dropped comment line vanishes WITH its terminator; result 1/1 current
  observed: `<!-- ref-by: 02-ops.md -->\n` (kept `\n`, NOT normalized); second stale line + its `\r\n` gone entirely (no blank residue); backPointers {total:1,current:1,stale:0}
  verdict: PASS

F11 | B-obs: anchor containing a space is not part of the anchor token
  cmd: cd qa20/b1 first attempt — `see 01-api.md#Rate limits` ; check --fix
  expected: §12 anchorMatches exact→ci→hyphen/space normalization (writer-side space-anchor semantics undocumented)
  observed: anchor parsed as `Rate` → `✗ broken anchor: 01-api.md#Rate — no node matches`; hyphen form `#Rate-limits` works
  verdict: PASS (observation; consistent w/ QA-05 F3 trailing-text tolerance; docs silent on space-in-anchor)

F12 | C: standalone placement = right after FIRST root bullet; multi-referrer list; one inline mark per node
  cmd: cd qa20/c2 (01-data.md roots `- Data`,`- Pipelines`; file-level referrers 03-ops.md + 05-frontend.md; 04-api.md anchors #Storage + #Retention) ; check --fix ; cat cans/01-data.md
  expected: §12 — standalone line right after first root bullet; ref-by list with both referrers; one inline mark per referenced node
  observed: `- Data\n<!-- ref-by: 03-ops.md, 05-frontend.md -->\n  - Storage <!-- ref-by: 04-api.md -->\n    - Postgres primary\n  - Retention <!-- ref-by: 04-api.md -->\n    - 30 days\n- Pipelines` — mark after FIRST root (not last); list sorted (03,05); 2 inline marks
  verdict: PASS

F13 | C: referrer holding BOTH file-level and anchored ref earns BOTH mark forms
  cmd: cd qa20/c3 (02-api.md has `see 01-auth.md` AND `see 01-auth.md#Sessions`) ; check --fix ; cat cans/01-auth.md ; check --json
  expected: §12 — each ref form earns its own mark (file-level→standalone, anchored→inline); both current
  observed: standalone `<!-- ref-by: 02-api.md -->` after root AND `  - Sessions <!-- ref-by: 02-api.md -->`; backPointers {total:2,current:2,stale:0}
  verdict: PASS

F14 | C: anchor on deepest node + duplicate node text → first in document order
  cmd: cd qa20/c4 (01-data.md `#Postgres-primary` at deepest level; TWO nodes texted `Sessions` under Notes/Extra) ; check --fix ; cat cans/01-data.md
  expected: §12 — inline mark lands on the referenced node (any depth); first §12 anchorMatches hit in document order
  observed: `    - Postgres primary <!-- ref-by: 04-api.md -->` (deepest) and mark on `- Notes`'s Sessions (first), `- Extra`'s Sessions untouched; 2/2 current
  verdict: PASS

F15 | C: unicode anchors
  cmd: cd qa20/c5 (nodes `Café limits`, `セッション`; anchors `#Café-limits`, `#セッション`) ; check --fix ; od -c
  expected: §12 anchor resolution exact→ci→hyphen/space norm — unicode node text must match and mark inline
  observed: both nodes got inline marks; UTF-8 bytes intact (é = 303 251, セッション multibyte preserved); 2/2 current; exit 0
  verdict: PASS

F16 | C: node text containing see:-like prose (write path)
  cmd: cd qa20/c6 (target child `    - see: rubric for details`) ; check --fix ; cat cans/01-data.md
  expected: §12/§22 — inline mark on the referenced node; prose line untouched byte-wise
  observed: `  - Conventions <!-- ref-by: 04-api.md -->` inserted; `    - see: rubric for details` untouched. Side effect: prose parsed as outgoing ref → `refs.prose` warning + DEEP HOP error 04-api.md → 01-data.md → rubric, exit 2 (engine semantics beyond #19/#21; §12 edge-table says file-not-found → broken ref, impl uses prose heuristic — noted, not a --fix write defect)
  verdict: PASS (write path); observation recorded

F17 | D: fence between root and target node — marks never inside fence
  cmd: cd qa20/d1 (01-data.md: fence with fake `- Storage` bullets between root and real node; referrer file-level + #Storage) ; check --fix ; od -c
  expected: §12 issue #6 form "never inside a code fence"; §22 — fenced bullets are not nodes
  observed: standalone mark after `- Data` BEFORE the fence opener; inline mark on the REAL `  - Storage` (post-fence), fenced `  - Storage` untouched; fence bytes byte-identical; node count 6 excludes fenced bullets; 2/2 current
  verdict: PASS

F18 | D: fenced content mentioning ref-by — not counted, not stripped
  cmd: cd qa20/d2 (fence contains `<!-- ref-by: 99-gone.md -->`) ; check --json (pre-fix) ; check --fix ; od -c
  expected: fence-aware: fenced ref-by is content, not a mark — not counted in backPointers, never removed by --fix
  observed: pre-fix backPointers {total:0}; after --fix real mark inserted after root, fenced `<!-- ref-by: 99-gone.md -->` byte-identical inside fence
  verdict: PASS

F19 | E: [file] filter does NOT scope --fix writes; report does not name rewritten files (issue #11)
  cmd: cd qa20/e2 (01-auth.md + 03-data.md both need marks) ; node .../cans.js check --fix 01-auth.md --json ; cat both files
  expected: issue #11 — filtered `check --fix <file>` rewrites ref-by comments ONLY in filter-matched files; report names rewritten files (repo's own fix commit 099e858 defines this contract)
  observed: `backPointersUpdated: 2`, no `backPointersUpdatedFiles` key; BOTH 01-auth.md AND 03-data.md rewritten (03-data got its mark despite filter); human report has no "--fix updated ref-by in:" line
  verdict: FAIL (expected per issue #11; note: fix commit 099e858 exists UNMERGED on origin/fix/issues-8-11-implementation; HEAD docs §12 "Rebuilt from scratch every --fix run" actually mandates the observed global rebuild — doc/branch incoherence, not a #19/#21 regression)

F20 | E: exit codes after --fix
  cmd: b6 (all clear) check --fix → $?; e1 (warnings only) → $?; a/d1 (remaining errors) → $?
  expected: §19 + README/QA-12: 0 clean · 1 warnings · 2 errors; --fix leaving remaining errors must exit nonzero
  observed: b6 clean → 0; warnings-only → 1; broken-anchor/overflow errors remaining after --fix → 2 (a: exit 2, d1: exit 2)
  verdict: PASS

F21 | C: currency downgrade — file-level ref satisfies the inline mark
  cmd: cd qa20/g1 (mark inline on Sessions from #Sessions; sed referrer → `see 01-auth.md`) ; check --json ; check --fix ; cat
  expected: §12 Currency — "an inline mark on node X is current while … it refs the file itself (a file-level ref satisfies any mark)"
  observed: {total:1,current:1,stale:0} (NOT stale); after --fix mark kept inline on Sessions, no standalone re-minted; still 1/1 current
  verdict: PASS (note: fixer keeps the more-precise form rather than re-minting the coarser standalone — supported by the "at least as precise" clause)

F22 | B/G: all-CRLF workspace, both mark forms, retarget move path
  cmd: cd qa20/g2 (01-auth.md CRLF; anchored referrer 02-api.md + file-level referrer 03-ops.md) ; check --fix ; od -c ; sed #Sessions→#Passwords ; check --json ; check --fix ; od -c
  expected: §22 — CRLF file stays fully CRLF through both mark forms and the move path; per-line \r\n preserved
  observed: standalone `…03-ops.md -->\r\n` after root + inline `  - Sessions <!-- ref-by: 02-api.md -->\r\n`; after retarget: Sessions restored to original bytes, mark on `  - Passwords <!-- … -->\r\n`; zero `\n`-only bytes ever; 2/2 current
  verdict: PASS

F23 | B: no-op --fix on unreferenced CRLF file
  cmd: cd qa20/g4 (07-solo.md CRLF, no refs) ; check --fix ; cmp
  expected: §22 — --fix writes only ref-by changes; nothing to do → zero bytes
  observed: `no-op fix: ZERO bytes changed` (cmp equal; exit 1 only from orphan warning)
  verdict: PASS

F24 | A: exact byte reconstruction (cmp) of the core #19 insert
  cmd: cd qa20/a (rebuilt from scratch) ; printf expected = original + ` <!-- ref-by: 02-api.md -->` on Sessions line ; cmp expected cans/01-auth.md
  expected: §22 — file = original bytes + inline mark text only
  observed: `a-core EXACT cmp: file == original + inline mark only` (byte-identical otherwise)
  verdict: PASS

F25 | E: [file] filter scopes REPORT + exit code, not writes (filter on referrer)
  cmd: cd qa20/e3 ; node .../cans.js check --fix 04-api.md ; cat 01-auth.md 03-data.md
  expected: issue #11 — writes scoped to filter-matched files
  observed: both TARGET files (01-auth.md, 03-data.md) rewritten although filter named only the referrer 04-api.md; exit 0 (report/exit scoped to filtered file — single-child warnings of unfiltered files suppressed)
  verdict: FAIL (same defect as F19: writes are global; consistent with §12 "Rebuilt from scratch" at HEAD, but not the issue #11 contract on the unmerged branch)

F26 | F: dual runtime — Bun byte-identical to Node
  cmd: cd qa20/f1-f4 ; bun /home/z/my-project/cans-spec/bin/cans.js check --fix ; od -c / cmp
  expected: §39 — same source, both runtimes; EOL verdicts must match Node's
  observed: f1 CRLF-inline = b1 bytes exactly; f2 CRLF-standalone `…-->\r\n`; f3 mixed-EOL identical to b4 (dominant CRLF insert, `  - Notes\n` kept); f4 a-core: inline mark → retarget stale {1,0,1} → moved to `  - Passwords <!-- ref-by: 02-api.md -->` → idempotent (cmp zero bytes). All match Node verdicts
  verdict: PASS

F27 | C: multiple referrers to the SAME anchor — inline mark lists all, sorted
  cmd: cd qa20/g5 (02-web.md, 04-api.md, 06-cli.md all `see 01-auth.md#Sessions`) ; check --fix ; cat cans/01-auth.md
  expected: §12 mark form `<!-- ref-by: 04-api.md, 05-frontend.md -->` — comma+space list of referrers
  observed: `  - Sessions <!-- ref-by: 02-web.md, 04-api.md, 06-cli.md -->` — all three referrers, sorted
  verdict: PASS

## Summary

| Metric | Count |
|---|---|
| Probe records | 27 |
| PASS | 25 |
| FAIL | 2 |

**Issue #19 (anchor-aware back-pointers): VERIFIED FIXED at 23156fa.** Inline placement on the exact referenced node (any depth, unicode, first-in-document-order for duplicate texts), standalone issue-#6 form for file-level refs, currency semantics exactly as §12 documents (retarget→stale, broken anchor→no mark, file-level ref satisfies any mark, misplaced marks moved not kept), fence safety intact, idempotent rebuilds, byte-identical otherwise (cmp-verified).

**Issue #21 (byte-preserving CRLF/mixed-EOL --fix writes): VERIFIED FIXED at 23156fa.** od -c evidence on every write path: inline inserts keep the line's own terminator; inserted standalone lines mint the file's DOMINANT EOL; replaced comments keep their line's terminator (mixed files stay mixed, `\n` line stays `\n` in a CRLF-dominant file); dropped comment lines vanish with their terminators; no-trailing-newline and empty-file degenerate cases handled without corruption; second --fix run changes zero bytes everywhere; no-op files untouched; Bun runtime byte-identical to Node.

### FAIL list
| ID | Severity | Finding |
|---|---|---|
| F19 | MINOR | `check --fix <file>` rewrites ref-by in ALL files, not just filter-matched ones; no rewritten-file list in report/JSON (`backPointersUpdatedFiles` absent). Violates the issue #11 contract — but that fix (commit 099e858) sits UNMERGED on `origin/fix/issues-8-11-implementation`; HEAD's own docs (§12 "Rebuilt from scratch every --fix run") mandate the observed global rebuild. Branch/doc coherence gap, not a #19/#21 regression. |
| F25 | MINOR | Same root cause observed with the filter on the referrer file (both targets rewritten); also shows the filter scopes report+exit code (exit 0 while unfiltered files still have warnings). |

No CRITICAL, no MAJOR failures. Observations (non-blocking): F09 empty-target mark preceded by a minted `\n`; F11 space-in-anchor not part of anchor token; F16 `see:`-prose in a node parses as an outgoing ref → refs.prose warning + DEEP HOP error (exit 2) in a write-clean workspace (engine semantics beyond #19/#21, §12 edge-table drift).
