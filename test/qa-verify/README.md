# QA Red-Test Verification Suite

Regression tests that **confirm the red** reported by the blackbox QA cycle in
`agents/qa/QA-01..06` (branch `qa/blackbox-findings`, repo @ `impl/full-engines` 54b0b52).

Every non-control test asserts the **documented contract** from
`docs/cans.architecture.md` (§ reference + QA finding ID in the test comment).
Because the implementation currently violates that contract, these tests are
**expected to fail**. They are deliberate regression specs — each one flips to
green when (and only when) the corresponding finding is fixed. They are not
band-aid tests: nothing here asserts current behavior, swallows failures, or
skips.

## Status

`71 red (expected) / 7 controls pass` — run against `qa/blackbox-findings` @ b3d5b72.

The 7 `// control (expected PASS)` tests pin the harness (documented behavior
that already works), so a red test failing for a setup reason is immediately
visible.

## Run

```bash
bun test test/qa-verify            # the red suite alone (71 fail / 7 pass is CORRECT today)
bun test                           # full suite: 114 baseline pass + 7 controls pass + 71 red
bun test test/qa-verify/qa-05-interop.test.ts   # one report's suite
```

> CI note: until fixes land, `bun test` will report 71 failures. That is the
> honest, intended state — it is the machine-checked form of the QA verdict.
> Fixing a finding turns its tests green.

## Files → QA reports

| File | QA report | Red | Controls |
|---|---|---|---|
| `qa-01-init-lifecycle.test.ts` | QA-01 init / workspace lifecycle | 7 | 2 |
| `qa-02-refs-structure-style.test.ts` | QA-02 refs, structure, style engines | 10 | 1 |
| `qa-03-redundancy-overflow-rules-budget.test.ts` | QA-03 redundancy, overflow, rules, token budget | 15 | 1 |
| `qa-04-workflow.test.ts` | QA-04 new / done / status | 11 | 1 |
| `qa-05-interop.test.ts` | QA-05 import / export | 13 | 1 |
| `qa-06-cli-surface.test.ts` | QA-06 CLI surface contracts | 15 | 1 |

## Finding coverage map

**QA-01** — finding 1 (`--flat --folders` folder twins, §8), 3 (init inside
`cans/` subdir must refuse, §21), 4 (`--json` root `"./cans"`, §35), 6
(unknown/typo flags surfaced, §20/§37), 7 (`--tool windsurf` surfaced), 8
(non-empty refusal reason, §37).
*Not testable per docs:* finding 2 (`_adr/_template.md` — §8 vs §35
doc-internal inconsistency; impl matches the §35 fixture), finding 9
(`--force` clobber scope matches §21 wording; destructive-scope doc gap only).

**QA-02** — F1 (flat+folder duplicate home error, §8/§11), F2 (in-range
file-not-found is a broken-ref error, §12), F4 (§34 deep-hop fixture must not
emit a spurious broken anchor), F5 (`force_sibling_below` ≤ semantics, §14),
F8 (1-based `maxDepth`, §35), F9 (`duplicate_home_check` / `max_hops` honored,
§18), F10 (`see:TARGET` regex form, §11), F16 (single-child double-report),
F18 (`--fix --json` post-fix state, §35).
*Not testable per docs:* F7 (severity ✗/⚠ — docs/impl co-deviation, report
itself flags it as arguable), F3/F15 (redundancy-noise contract, owned by
QA-03's metric tests), F11/F12/F13/F14/F17 (undocumented surfaces / doc bugs).

**QA-03** — F1 ×3 ("delete a key = check off": section deleted, `enabled`
deleted, `orphan_check` deleted, §18), F2 ×2 (malformed `_rules.yaml` →
line-numbered error exit 1, not internal error exit 2, §18/§37), F3 (active
task in `budget read` plan, §26), F4 (`budget write` unknown concept exit 1,
§19), F5 (unknown subcommand errors, §37), F6 (`force_file_for` drives
detection, §18), F7 ×2 (≥ 70% boundary + stopword-filtered overlap metric,
§13), F8 (fuzzy skips synonym-matched pairs, §13), F9 (budget outside
workspace says why, §37), F10 (no-chaining: `see:` in overflow target flagged,
§16), F11 (`token_budget.warn_threshold` emits a warning, §18).

**QA-04** — finding 1 ×3 (flags never swallowed into `new` names/titles, §20 +
`new task --json` no-name must error), 2 (no silent task-file overwrite, §21/§37),
3 (no silent same-day archive clobber, §24), 4 ×2 (`done` names the real cause:
not-found / no-workspace, never false "check failed", §37), 5 ×2
(`status --unclaimed/--blocked/--owners` filter, §20/§25), 6 (non-empty `new`
error, §37), 10 (`done` updates back-pointers, §24).

**QA-05** — F1 ×2 (failures say why + JSON error signal; no false-success
lines, §37), F2 (imported refs carry `.md` and resolve, §3/§4), F3 (logseq
trailing prose stays out of the ref target), F4 (obsidian callouts preserved,
§31), F5 (code fences extracted to overflow files, §27), F8 (cans-wins never
appends the conflicting node — no structural corruption — and populates
`conflicts[]`, §27/§35), F9 (`ask` reports conflicts), F10 (`--merge-strategy`
enum validated, §37), F11 (`import --out` honored, §20), F12 (garbage OPML
rejected), F14 (OPML export keeps checkbox state, §28).

**QA-06** — finding 3 ×2 (unknown command / no args: human guidance or JSON
message field, §37), 4 ×3 (`--flag=value`, unknown/short flags, missing values
rejected or warned — never silently ignored, §20), 2 ×3 (missing required args
name the requirement instead of blank-filled success shapes, §37), 6 ×3
(uniform no-workspace message for `status`/`export`; `new` never auto-vivifies
a workspace), 9 (spec-file-named directory not silently skipped), 11 ×2
(`--help`/`-h`, `version`/`--version`, §44), 12 (`--dry-run` output marked as
such).

## Method notes

- Tests are blackbox: they spawn `src/cli.ts` via `Bun.spawnSync` from isolated
  scratch workspaces under `.tmp/qa-verify/` (gitignored), asserting on exit
  codes, stdout/stderr, file trees and `--json` payloads — the same surface the
  QA cycle exercised.
- Every scratch dir is per-test and cleaned up; no test depends on another.
- The 2 baseline-suite flakes reported during the parallel authoring session
  were cross-process `.tmp` interference between concurrent agent runs — not
  reproducible in a normal sequential `bun test` run from a clean tree.
