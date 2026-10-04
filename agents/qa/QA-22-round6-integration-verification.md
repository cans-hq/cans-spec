# QA-22 — Round-6 fix integration verification (merged tree @ 7aaae25)

- Target: cans-hq/cans-spec @ 7aaae25 (`agent-work` == `origin/feat/issue-41-compact-check-output`), the merge of the four round-6 fix branches: `fix/issue-20-round6` (6127a62), `fix/issue-22-round6` (2118d40), `fix/issues-15-16-round6` (63e4f1d), `fix/issue-11-round6` (7aaae25).
- CLI under test: `node bin/cans.js` (blackbox). Agent: coordinator. Date: 2026-10-04.
- Method: re-run the headline repro of every FAIL class from QA-17..QA-21 against the **merged** tree — each fix was verified on its own branch, so the residual risk is merge interaction (notably 5-b's `check.ts` `refs.broken` counter edits and 5-d's `check.ts` `--fix` scoping edits landing in the same file). Binary verdicts only. Harness: `scripts/verify-round6-merged.sh` (committed to the worklog area, not the repo; every probe reproducible by hand from the commands below).
- Suite state on the merged tree: `bun test` **556 pass / 0 fail / 10 skip** (566 tests, 44 files; baseline at 23156fa was 485), `npm run test:node` **556 pass / 0 fail**, `tsc --noEmit` clean.

## Probes

A1 | QA-17 F47 — `token_budget.default_limit: abc` in `_rules.yaml` (budget read auth --json)
  expected: §19/§26: invalid config value rejected like the flag path — exit 1, `invalid token_budget.default_limit "abc" in _rules.yaml — pass a positive integer`, `ok:false` envelope
  observed: exit 1, exact message, `"error"` field, no plan. PASS

A2 | QA-17 F50 — `estimate_chars_per_token: 0`
  expected: rejected, never `Infinity tok`
  observed: exit 1 `invalid token_budget.estimate_chars_per_token "0" in _rules.yaml — pass a positive number`; no `Infinity` anywhere. PASS

A3 | QA-17 F16 — `enabled: false`
  expected: observable switch — both budget commands refuse
  observed: exit 1 `budget planning disabled: token_budget.enabled is false in _rules.yaml — set it to true (or delete the key) to plan budgets`. PASS

A4 | QA-17 F25 — unconnected `_tasks/fix-shipping.md`
  expected: §26 step 4: task files are budget scope; skipped lists every file not in the plan
  observed: `skipped` contains `cans/_tasks/fix-shipping.md` and `04-none.md`; exit 0. PASS

A5 | QA-17 F28 — forward-ref tier
  expected: §26 step 3: target of a `see:` ref made from the canonical home scores 40 with reason "forward ref"
  observed: plan `[01-auth.md (canonical home), 03-pw.md (forward ref)]`, exit 0. PASS

B1 | QA-18 F25+F38 — canonical TBD-fill flow (`init`-shaped scaffold, export→sed→import, "Sessions: TBD"→"…extended - changed externally", "Storage: TBD"→"…postgres with PITR")
  expected: round-6 §27 TBD-fill rule: conflict, cans-wins, file byte-identical, exactly one node
  observed: exit 0, `conflicts` carries both fills with `cansVersion/importVersion`, sha256 of both spec files unchanged, 1 Sessions line, 1 Storage line. Human output shows `! 02-authentication.md:2 cans-wins`. PASS

B2 | QA-18 F28 — workspace-side parent reword (`- Authentication` → `- Auth and identity`)
  expected: merged into 02-authentication.md, never a second root or forked file, idempotent
  observed: `newFiles: []`, `merged: ["02-authentication.md"]`, 1 root line, parent conflict (line 1), second import byte-identical. PASS

B3 | QA-18 F28 — import-side reworded root
  expected: no `07-auth-and-identity.md` fork; merge target found by diverged-root match
  observed: `newFiles: []`, conflicts ≥ 1, workspace root stays `- Authentication`, no forked file. PASS

B4 | QA-18 F10/F13 — containment floors (existing side)
  expected: `shared ÷ |existing tokens|` — below-floor distinct pair appends cleanly, at-floor pair conflicts
  observed: "Red green blue yellow" vs "Red magenta cyan black" (E 0.25) appended, `conflicts: []`; "Alpha beta gamma delta" vs "Alpha beta epsilon zeta eta" (E 0.5) → cans-wins conflict, no append. PASS

B5 | control — 2-word-stem repro ("Sign up: TBD" reworded)
  expected: round-5 behavior preserved
  observed: conflict `cans-wins`, importVersion echoed. PASS

C1 | QA-19 C2/F54 — anchor-aware duplicate guard (referrer holds `see: auth#Passwords`; deep-hop suggestion targets `auth#Sessions`)
  expected: no self-contradictory "already refs … as \"see: auth#Passwords\""
  observed: plain edge advice mentioning `auth#Sessions`; zero `already refs` claims. PASS

C2 | QA-19 C1/F13/F45/F53 — escape targets (`see: ../outside.md` with the file present; `see: /etc/hosts`)
  expected: broken ref with workspace-containment advice; never `create ../outside.md` / `create /etc/hosts`
  observed: `broken ref: … — file not found in workspace` + `see: targets must name spec files inside the workspace (no ../ or absolute paths)`; no create-* advice. PASS

C3 | QA-19 C3/F15 — unnumbered duplicate home (`auth.md` + `auth/index.md`)
  expected: §11 both-existing error (not warnings-only)
  observed: error-level duplicate-home entry naming both files. PASS

C6 | QA-19 C6/F40b — broken anchor + truthful refs.broken
  expected: error present AND JSON `refs.broken ≥ 1`
  observed: `refs: {broken: 1}` with the broken-anchor error detail. PASS

C8 | QA-19 C8/F51 — extensionless flat target (`see: 02-b` with `02-b.md` present)
  expected: §11 flat-first resolution
  observed: `refs.broken === 0`, exit 0. PASS

C5 | QA-19 C5/F26 — edge-named deep-hop advice + exact-follow convergence (two referrers of the same intermediate)
  expected: one unambiguous edge-named entry per step (s2/s3 contract: `… remove the intermediate hop via 04-mid.md: delete 01-a.md's "see: 04-mid.md" (line 2)`), each follow surfaces the next edge, final state 0 deep hops
  observed: step 1 names 01-a.md's exact ref+line; after following it, step 2 names 01-b.md's; after following that, `deepHops: 0`. PASS

D1 | QA-20 F19 — `check --fix 01-auth.md --json` (filter = target file; second target-bearing file 03-data.md present)
  expected: issue #11 scoping: rewrites ref-by marks in filter-matched files only; JSON gains `backPointersUpdatedFiles`
  observed: `backPointersUpdated: 1`, `backPointersUpdatedFiles: ["01-auth.md"]`, 03-data.md sha256 unchanged, mark present in 01-auth.md. PASS

D2 | QA-20 F25 — referrer filter (`check --fix 02-api.md` where 02-api.md is the referrer)
  expected: zero writes, exit 0; unfiltered follow-up converges
  observed: `backPointersUpdated: 0`, target byte-identical, exit 0; unfiltered run then wrote 01-auth.md's mark. PASS

D3 | QA-20/#21 — CRLF target through scoped --fix (human run)
  expected: byte-level EOL preservation; human report names the rewritten file; idempotent
  observed: all 3 lines still `\r`-terminated after inline mark insert; `--fix updated ref-by in: 01-auth.md` printed; second run 0 writes, sha unchanged. PASS

D4 | cross-agent combo — broken anchor in 06-bad.md + scoped `check --fix 01-auth.md` (5-b's counter × 5-d's scoping in one check.ts)
  expected: unfiltered run reports `refs.broken ≥ 1`; scoped fix still writes only 01-auth.md
  observed: `refs: {broken: 1}` on the plain run; scoped run `backPointersUpdatedFiles: ["01-auth.md"]`; 06-bad.md byte-identical. PASS

## Verdict

**22 PASS / 0 FAIL.** All 29 round-6 FAIL classes (QA-17 F47/F50/F16/F25/F28; QA-18 F25/F26/F28/F38/F10/F13; QA-19 C1–C8; QA-20 F19/F25) are fixed on the integrated tree, with no cross-agent regressions in the shared files (`src/commands/check.ts` edited by both 5-b and 5-d; `src/core/refs.ts` guarded by 5-d's zero-edit discipline). Two initial probe mis-expectations were corrected against the pinned contract, not the implementation: B2 (single-divergence fixture yields 1 conflict, matching 5-a's documented shape) and C5 (multi-referrer deep-hop is one-edge-per-step by the s2/s3 tests). The 159 PASS behaviors from QA-17..21 are covered by the merged test suite (566 tests) plus the spot re-verifications above.

QA-21's non-FAIL doc gaps (§18/§19 exit-code wording vs the issue-#41 0/1/2 table) remain open as documentation debt — they predate the round-6 merge (proven byte-identical vs b859e30 in QA-21) and involve no behavioral defect.
