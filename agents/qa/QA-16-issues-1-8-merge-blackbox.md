# QA-16 — Issues #1–#8 merge: blackbox verification of the merged tree (round 4)

Scope: after squash-merging `fix/issues-1-4-implementation` (closes #1–#4) and
`fix/issues-5-8-impl` (closes #5–#7, re-implements #8) into `main`, the merged
tree was verified blackbox — CLI surface only (`check`, `check --fix`,
`export opml`), no source reads — against the shipped `cans-spec@0.2.0` npm
artifact as the pre-fix baseline (red) and the merged build (green).

## Gate results

| Gate | Result |
|------|--------|
| `tsc --noEmit` (typecheck) | clean |
| `bun test` | 363/363 pass, 1338 expect() calls, 34 files |
| `node --test` (fallback runtime) | 363/363 pass |
| Blackbox probes P1–P8 vs 0.2.0 | 8/8 red→green confirmed |
| `npm pack` tarball install + smoke | clean install, CLI boots, `--version` correct |

## Blackbox probes (public CLI only)

- **P1 / #1 — structure.siblings.min & depth.min enforcement.** Rules
  `siblings: { min: 3 }`, `depth: { min: 3 }` against a shallow tree. 0.2.0:
  silent (only the pre-existing `exactly 1 child` hints). Merged: warns
  `"Overview" has 1 children (min 3)` and `Max depth 2 is below min 3`.
- **P2 / #2 — style.prefer wiring.** Six prefix-sharing siblings under a real
  parent. 0.2.0 (dead config): grouping hint fires despite `prefer: sibling`.
  Merged: suppressed under the default; fires under `prefer: nested`;
  `prefer: flat` is a user-correctable line-numbered rules error (exit 1).
- **P3 / #3 — fuzzy layer stopwords + independent switch.** `network`
  added to `redundancy.stopwords`; `netwrok` present in prose. 0.2.0: fuzzy
  typo pair flagged. Merged: stopword honored (no pair), and
  `redundancy.fuzzy: false` disables layer 3 independently of `enabled`.
  (Probe note: the first fixture used `storage`, which the shipped synonyms
  group `[db, database, storage]` normalizes to `db` — pair silently
  dissolved by design; fixture switched to `network`.)
- **P4 / #4 — see-prose false broken refs.** `Users can see their dashboard`,
  `see the API guide` (non-ref-like), plus `See 99-missing-file.md`
  (ref-like). 0.2.0: all three level:error, exit 1. Merged: prose downgraded
  to `see-like prose` warnings, exit 0; the ref-like missing file stays an
  error; `--strict` exits 1. Exact contract of the fix.
- **P5 / #5 — deep-hop mesh semantics.** Mutual pair (02 → 04 → 02) under
  `max_hops: 1`. 0.2.0: two `DEEP HOP` errors (iteration-order dependent).
  Merged: clean (SCC back-refs are never deep hops). Control: a genuine
  02 → 04 → 06 chain still errors on the merged build.
- **P6 / #6 — `--fix` fence safety.** A stale `<!-- ref-by: 99-wrong.md -->`
  inside a ```text fence plus a prose paragraph, with a real referrer
  present. 0.2.0: rewrites the fenced comment (corruption). Merged: fenced
  comment untouched, prose untouched, zero deletions; the fixer still works
  (adds the legitimate back-pointer outside the fence).
- **P7 / #7 — dedent past stack bottom.** First bullet indented, next bullet
  at column 0. 0.2.0 parse: `A → B → C` mis-parented chain (observable as TWO
  `exactly 1 child` collapse warnings). Merged: `[A, B → C]` (one warning).
  Probe note: `export opml` re-normalizes by indent and masks the difference;
  the structure engine's warnings are the faithful observable.
- **P8 / #8 — phantom node exclusion.** Leading table + two real nodes.
  0.2.0: `nodes = 4` (synthetic `(table)` counted). Merged: `nodes = 3`;
  no phantom output in redundancy/budget/structure/style.

## Merge-conflict reconciliation (recorded for release notes)

Conflicts in `src/core/structure.ts` and `src/core/style.ts` combined the
#1/#2 fixes (siblings.min, prefer modulation) with the #8 synthetic-node
guard: both fixes now live inside `if (!isSyntheticNode(node))`. One test
was reconciled: the #8 control ("same prefix cluster under a REAL parent
still warns") predates the #2 prefer semantics and now runs with
`prefer: null` (documented both-hints-fire mode) — the control verifies
synthetic exclusion, not prefer modulation.

## Verdict

All issue-fix behavior verified red→green on the public CLI; both runtimes
green; no regressions observed. Release gate: PASS.
