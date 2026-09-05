# QA-15 — Adversarial & Boundary Inputs, Performance, Package Integrity (Blackbox, Round 3)

Task ID: 8 | Agent: QA-15 (general-purpose) | Artifact under test: **npm `cans-spec@0.1.0`**, global binary `/home/z/.npm-global/bin/cans`
Date: 2026-09-05 | Env: Linux (shared CI box — timings indicative), Bun 1.3.14, Node v24.19.0 | Method: manual shell only, blackbox

---

## Scope & method

Round 3 closes the three areas QA-11..QA-14 did **not** own: (1) adversarial/boundary inputs
(mirror of round-2 QA-08, never before run on the npm artifact), (2) performance vs §40 budget
incl. the 10k-node stress (settles the npm number vs round-2 source: 8.4 s / 69.1 s), (3) package
integrity from registry metadata only + the one flag QA-11 left unverified in depth: `init --tool
cursor`.

Docs used as oracle: README.md; docs/cans.architecture.md §8, §11 (parser, `see:` regex), §13
(redundancy O(N²) note), §15 (structure/depth), §19 (exit codes), §20 (CLI surface), §21 (init,
`--tool`), §22 (check exclusions), §23 (slug normalization), §24 (done), §25 (status), §26 (budget),
§32 (fs discovery), §37 (error philosophy), §39 (packaging), §40 (perf budget), §44 (versioning).

- All interaction through the global `cans` binary; scratch workspaces under
  `/home/z/my-project/qa-playground-r3/qa15/` (wsU, wsC, wsS, wsT, wsB, mid, stress, p1–p3,
  cursor, cursbog, pkgtar). Repo `cans-spec` untouched.
- The global binary had been removed from the box between QA-14 and this task (environment
  reset — `npm ls -g` showed no cans-spec). Reinstalled the same artifact with
  `npm install -g cans-spec` → 0.1.0 in 595 ms; all testing then used that binary.
- **Tarball disclosure:** package integrity used `npm view` metadata plus the downloaded
  tarball with `tar -tzf` **filename listing only**. No tarball file content was extracted or
  read. Self-reported protocol note: one accidental 1-line read (`head -1`) of the *installed*
  `src/cli.ts` shebang was made while checking `--version` consistency; the shebang is
  publicly specified in §39, the read was retracted on the spot, and **no finding derives from it**.
- Perf timing: bash `time` builtin on individual invocations, 3 runs each, median by eye.
  Fixtures generated with single `awk`/`seq` one-liner redirects (input prep only).

Prior findings disposition: QA-08 is the mirror for areas A–D; known round-2 failures were
re-probed once each on npm and marked FIXED / STILL-BROKEN rather than re-proven. Import/export
and the documented command contracts belong to QA-11/QA-14 — not touched.

---

## Verdict summary

| Section | Tests | PASS | FAIL | DEVIATION | UNDOC/DOC-GAP | N/E |
|---|---|---|---|---|---|---|
| A Unicode | 3 | 3 | 0 | 0 | 0 | 0 |
| B Content boundaries | 7 | 6 | 0 | 1 | 0 | 0 |
| C check surface / fs | 8 | 4 | 0 | 0 | 3 | 1 (obs) |
| D Path traversal | 4 | 4 | 0 | 0 | 0 | 0 |
| E budget boundary | 2 | 2 | 0 | 0 | 0 | 0 |
| F Perf: mid workspace | 5 | 5 | 0 | 0 | 0 | 0 |
| G Perf: 10k stress | 2 | 0 | 0 | 2 | 0 | 0 |
| H Package integrity | 3 | 3 | 0 | 0 | 0 | 0 |
| I init --tool cursor/bogus | 3 | 3 | 0 | 0 | 0 | 0 |
| **Total** | **37** (+3 N/E) | **29** | **0** | **3** | **3** | **3** |

**0 FAIL · 0 STILL-BROKEN. Two round-2 MAJORs verified FIXED on npm** (CRLF silent data loss
QA-08 B5; `done` path-traversal crash QA-08 A13/A14). The only §40 misses are the known 10k-node
outliers (DEVIATION, minor), which on npm are **numerically identical** to round-2 source.

---

## A. Unicode (wsU: fresh `cans init`, `cans/00-overview.md` overwritten with probe nodes)

| # | Input / command | Expected (doc §) | Actual | Verdict | Exit |
|---|---|---|---|---|---|
| A1 | nodes with CJK (认证/認証/邮箱), emoji 🔐🚀🧪, ZWJ sequences 👨‍👩‍👧‍👦 🏳️‍🌈, combining accents (é precomposed vs e + U+0301) | parse + engines sane, no crash (§11) | `7 files, 34 nodes` — all parsed; structure/style/redundancy engines all fire normally (single-child ⚠ on the CJK node, L1 `"auth" × 4`, L2 100% overlap vs 02-authentication.md, L3 fuzzy stack↔state); `see: 02-authentication.md` resolves; no crash, no mojibake | PASS | 0 |
| A2 | `cans budget read "认证"` | §26 normalize + canonical home | canonical home `00-overview.md#认证 Authentication 認証` (70 tok, 1.7%), exit 0 | PASS | 0 |
| A3 | `cans new adr "认证设计 Authentication 🔐"` | §23 slug; QA-08 A1 npm-confirm | `_adr/001-authentication.md` — CJK+emoji stripped from slug, title preserved in body | PASS | 0 |

---

## B. File content boundaries (wsC: fresh `cans init` + probe files `10-…18-`)

| # | Input / command | Expected (doc §) | Actual | Verdict | Exit |
|---|---|---|---|---|---|
| B1 | CRLF-only file (3 bullets, every line `\r\n`, verified with `od -c`) | round 2 QA-08 B5: 0 nodes, false-clean | **FIXED on npm**: all 3 nodes parsed (`38 nodes` = 32 scaffold + 3 CRLF + 3 mixed); redundancy sees `"crlf" × 4`; orphan ⚠ for the file; `budget read "CRLF root"` → canonical home `10-crlf.md#CRLF root node` (13 tok). QA-08 B5 MAJOR does NOT reproduce | PASS | 0 |
| B2 | mixed LF + CRLF in one file | §11 bullets parse | mid-file CRLF line parsed: `budget read "Mixed CRLF child"` → `11-mixed.md#Mixed CRLF child` (14 tok); `\r` stripped from stored text | PASS | 0 |
| B3 | 0-byte spec file (`cans/12-empty.md`) | graceful, counted | discovered (files 7→10), 0 nodes, orphan ⚠, no crash (QA-08 B1 consistent on npm) | PASS | 0 |
| B4 | whitespace-only file (`"   \n\t\n\n"`) | §11: non-bullet lines ignored | `✗ 13-wsonly.md — parse error: 13-wsonly.md: tab indentation rejected (use 2 spaces)`, exit 1 — graceful, but a whitespace-only line (no bullet) triggers the tab rejection instead of being ignored | **DEVIATION (minor)** | 1 |
| B5 | single node of 2000 chars (`cans check 14-longnode.md`) | §15 + §16 both fire; no hang (§40) | `Node too long (2000 > 120)` + `node exceeds max chars (2000 > 200)`; 42 ms; no hang | PASS | 1 |
| B6 | deep nesting depth 10 / 20 / 40 (2-space units) | §15 depth > 5 errors each level; no stack overflow | 5 / 15 / 35 `Depth N exceeds max 5. Flatten.` errors (levels 6+); `maxDepth: 40` reported; full-workspace check 61 ms, 58 errors/93 warnings, no crash, no stack overflow | PASS | 1 |
| B7 | tab-indented file | QA-12 settled: rejected exit 1 (one-command re-confirm) | `✗ 18-tabs.md — parse error: 18-tabs.md: tab indentation rejected (use 2 spaces)` exit 1; QA-12 F14 residual (path printed twice) present on npm | PASS | 1 |

B-findings: none new beyond B4's letter-vs-spirit note. B1 is the headline: the worst round-2
parser bug (whole-file silent data loss on Windows line endings) is fixed in the shipped package.

---

## C. check surface / filesystem (wsS: fresh `cans init` + probes)

| # | Input / command | Expected (doc §) | Actual | Verdict | Exit |
|---|---|---|---|---|---|
| C1 | `cans/07 my notes.md` (filename with spaces) + `check`/`status` | §32 discovery | discovered: `8 files` / `Files: 8 specs`; node parsed (`⚠ 07 my notes.md:1 — has exactly 1 child`); engines address it fine | PASS | 0 |
| C2 | from another file: `see: 07 my notes.md` | §11 `/see:\s*(\S+?)(?:#(\S+))?/g` implies spaces impossible | `✗ 01-architecture.md:2 — broken ref: see 07 — file not found` — target truncated at the space (`07`), guaranteed broken | **DOC-GAP (minor)** | 1 |
| C3 | `cans/_secret/x.md` (user-created `_`-prefixed dir) | §32 excludes `_`-prefixed | excluded everywhere: check counts stay at 9 files (7 scaffold + spaced + hardlink), 0 mentions of `_secret`, status `9 specs` | PASS | 0 |
| C4 | `see: 00-overview.md#Overview` inside 00-overview.md itself | §12 self-ref = error | `✗ 00-overview.md:2 — self-reference: 00-overview.md → 00-overview.md` (+ remedy line) | PASS | 1 |
| C5 | `see: AGENTS.md` from a spec file | §22 excludes AGENTS.md from checks; §12 table silent on it as target | **silently resolves**: refs total 3, broken 1 (the C2 truncation only) — no error, no warning, no back-pointer for the AGENTS.md ref | **UNDOC** | 0 |
| C6 | hard link `outside.md` ↔ `cans/09-hlink.md` (QA-08 C2 substitute) | graceful | discovered as separate file (9 files, +2 nodes), parsed, orphan ⚠ only | PASS | 0 |
| C7 | symlink `cans/09-link.md → ../outside.md`; symlinked subdir `cans/subln`; symlink loop a↔b | glob/parse follow or choke? | **NOT EXECUTABLE** — sandbox denies symlink creation outright (any command containing `ln -s` is blocked before execution, so co-generated fixtures were not even created). QA-08 C2/C3 hit the same wall on source | N/E | — |
| C8 | `cans check 18-tabs.md` (file exists but fails parse) | §37-style message | `✗ no spec file matches "18-tabs.md"` — misleading: the file exists, it just failed discovery/parse; parse-error files are not addressable via `[file]` | **UNDOC (minor)** | 1 |

C-findings: spaces in spec filenames are *discoverable but unreferenceable* (C2) — the §11
`see:` regex and §32-style discovery disagree; docs never promise the combination, so recorded
as DOC-GAP, not FAIL. C5 is the only silently-tolerated ref form found.

---

## D. Path traversal (wsT: fresh `cans init`, plus `cans/_collab/escape.md` fully-checked no-gate task)

| # | Command | Expected (doc §) | Actual | Verdict | Exit |
|---|---|---|---|---|---|
| D1 | `cans new task ../../pwn` | §23: non-alnum → hyphen, no escape | `Created _tasks/pwn.md` — created **inside** `cans/_tasks/` (`../../` normalized away; nothing outside the workspace) | PASS | 0 |
| D2 | `cans new adr /abs/path` | §23 | `Created _adr/001-abs-path.md` — absolute path treated as title text, slug `abs-path`, file inside workspace | PASS | 0 |
| D3 | `cans done ../_collab/escape` (real file outside `_tasks/`) | round 2 QA-08 A14: traversal accepted → gates run → raw `ENOENT` exit 2 | **FIXED on npm**: `✗ task "../_collab/escape" not found in _tasks/ — run \`cans status\` to list active tasks`, exit 1; `escape.md` untouched, no gate evaluation, no crash | PASS | 1 |
| D4 | `cans done ../_adr/001-abs-path`; `cans done "sub/dir"` | §24 names resolve only in `_tasks/` | same graceful not-found message, exit 1, for both — QA-08 A13's gate-evaluation-on-arbitrary-files root cause is gone | PASS | 1 |

---

## E. budget boundary (wsB: `cans/00-overview.md` = 130 nodes all containing "gadget")

| # | Command | Expected (doc §) | Actual | Verdict | Exit |
|---|---|---|---|---|---|
| E1 | `cans budget read "gadget"` (concept matches 130 nodes) | §26/§40: sane plan, < 50 ms; §13 O(N²) boundary | 38 ms; canonical home `00-overview.md#Gadget requirement number 1…` (1826 tok, 44.6%), other 6 files skipped, exit 0 — no blowup | PASS | 0 |
| E2 | `cans check` on that workspace (worst-case overlap density: C(130,2)≈8385 pairs) | §13 O(N²) "fine < 500 nodes" | 63 ms text / 74 ms JSON; `0 errors, 8397 warnings` (L1 `"gadget" × 130` + L2 78–100% overlaps); exit 0 | PASS | 0 |

---

## F. Performance — mid workspace (§40 row: "20 files, 500 nodes < 500 ms")

Fixture: `mid/` — `cans init` + 20 generated files × 25 unique-ish nodes (`awk` one-liner) =
**27 files, 532 nodes**, 6329 redundancy/style warnings (deliberately noisy, i.e. pessimistic).

| # | Command (×3, median) | Target (§40) | Actual | Verdict |
|---|---|---|---|---|
| F1 | `cans check` (text) | < 500 ms | 95 / 100 / 96 ms → **median 96 ms** | PASS |
| F2 | `cans check --json` | < 500 ms | 102 / 98 / 98 ms → **median 98 ms** | PASS |
| F3 | `cans status` | < 50 ms | 27 / 25 / 34 ms → **median 27 ms** | PASS |
| F4 | `cans budget read "topic"` (concept matches all 500 nodes; plan fills 3878/4096 tok) | < 50 ms | 25 / 25 / 34 ms → **median 25 ms** | PASS |
| F5 | `cans init` in 3 fresh dirs (p1, p2, p3 incl. one `--folders`) | < 50 ms | 29 / 27 / 27 ms → **median 27 ms** | PASS |

Machine context: shared CI box, other tenants possible; numbers are indicative. Even so, the mid
workspace clears every §40 row it exercises by 1.8–5×, and the JSON path is now **at parity** with
text (round 2 saw JSON 8× slower at 10k nodes — that gap only opens at extreme scale, see G).

---

## G. Performance — 10k-node stress (settles the npm number)

Fixture: `stress/` — `cans init`, `cans/00-overview.md` replaced with 10,000 nodes
`- node number i about topic i%97` (same generator as QA-08 B10 for comparability).
Result envelope identical to round 2: `7 files, 10028 nodes, 0 errors, 515137 warnings`
(round 2: 515233), text report 74.9 MB, JSON output 142 MB, exit 0 everywhere (incl. `--json`).

| # | Command | Round-2 source (QA-08 B10) | npm 0.1.0 (this round) | Verdict vs §40 |
|---|---|---|---|---|
| G1 | `cans check` text ×3 | 8.4 s | 7.95 / 8.37 / 7.52 s → **median 7.95 s** | **DEVIATION (minor)** — blows "no operation exceeds 500 ms" by ~16×, same class as round 2 |
| G2 | `cans check --json` ×4 (one first-run outlier) | 69.1 s | 8.09* / 72.7 / 66.6 / 71.8 s → **median ≈ 71 s** | **DEVIATION (minor)** — JSON ≈ 9× text; the 8.09 s first run is an unexplained one-off (all four runs byte-identical output, exit 0) |

This is the documented design-envelope boundary, not a regression: §13 itself scopes the
O(N²) phrase-overlap layer "fine < 500 nodes", and 10028 nodes is 20× that. Verdict for the
round-3 question: **npm ≈ source** (source IS distribution, per §39 — now measured, not assumed).

---

## H. Package integrity (registry metadata + tarball filename list ONLY)

| # | Check | Expected (doc §) | Actual | Verdict |
|---|---|---|---|---|
| H1 | `npm view cans-spec version dist-tags engines bin dist.tarball` | §39: engines `bun >=1.0.0`, bin `cans → src/cli.ts`; §44: latest 0.1.0 | `version 0.1.0`, `dist-tags {latest: 0.1.0}`, `engines {bun: '>=1.0.0'}`, `bin {cans: 'src/cli.ts'}`, tarball `registry.npmjs.org/cans-spec/-/cans-spec-0.1.0.tgz`. Note: §39's example says `"name": "cans"` — actual published name is `cans-spec` (stale doc, rename already noted by main agent) | PASS |
| H2 | `npm pack` (62,607 B) + `tar -tzf` filename list only (34 entries) | §39 `files: ["src/","templates/","README.md","LICENSE"]`; README: no package-lock.json | **src/**: `cli.ts`, `types.ts`, `commands/` (budget, check, done, export, import, init, new, status), `core/` (args, fs, index, outline, output, overflow, redundancy, refs, rules, structure, style, token-budget), `converters/` (index, logseq, obsidian, opml, shared). **templates/**: `adr-template.md`, `task-template.md`, `AGENTS.md`, `_rules.yaml` (all 4). **README.md**, **LICENSE**, package.json. **ABSENT (good):** package-lock.json, node_modules/, test/, docs/. **Surprises:** none — only `src/core/args.ts` is absent from §9's source map (trivial doc drift) | PASS |
| H3 | `cans --version` / `cans version` vs registry | consistency | both print `cans 0.1.0`, exit 0, matching registry 0.1.0 (`version` subcommand remains undocumented per QA-11's help-drift note) | PASS |

---

## I. `init --tool cursor` + `--tool bogus` (QA-11 B14–B15 mirror; she verified claude's content + cursor's existence only)

| # | Command | Expected (doc §) | Actual | Verdict | Exit |
|---|---|---|---|---|---|
| I1 | `cans init --tool cursor --json` (fresh dir) | §21: emits `.cursorrules` from AGENTS.md; §21 JSON shape | `ok:true`, `created` = 14 scaffold entries + `".cursorrules"`, `root:"./cans"`. **`.cursorrules` is created at the workspace ROOT, outside `cans/`** (verified `ls`), and is **md5-identical to `cans/AGENTS.md`** (f842f950…, 4728 B both) | PASS | 0 |
| I2 | after I1: `cans check` + `cans status`; then `init --tool cursor` again | no pollution; idempotent | `7 files, 32 nodes, 0 errors` exit 0; `Files: 7 specs`; re-run: `= .cursorrules (exists, skipped)` | PASS | 0 |
| I3 | `cans init --tool bogus` (fresh dir) | §21 lists only claude/cursor outputs | `✗ unknown tool "bogus" — supported tools: claude, cursor`, exit 1, nothing created (cross-checks QA-11 B15's windsurf result; the supported-tools message itself is UNDOC) | PASS | 1 |

Erratum for the record: QA-11 B14 recorded the artifact as "`cans/.cursorrules`"; the actual
location is the workspace root (`.cursorrules` beside `cans/`, same as round-2-era CLAUDE.md
root-level behavior in QA-11 B13). QA-11's pollution conclusions are unaffected.

---

## Findings register (severity order)

**BLOCKER: none. FAIL: none. STILL-BROKEN: none.**

**MAJOR FIXED on npm (round-2 closures):**
1. CRLF-only spec files no longer silently parse as 0 nodes (QA-08 B5) — every node parsed,
   refs/budget/redundancy all see the content (B1/B2).
2. `done <traversal>` no longer accepts names outside `_tasks/` (QA-08 A13/A14) — graceful
   §37 not-found, exit 1, no gate evaluation, no crash (D3/D4).

**DEVIATION (3, all minor):**
1. Whitespace-only file containing a tab line → parse error exit 1 instead of "non-bullet lines
   ignored" (§11 letter); otherwise graceful (B4).
2. 10k-node `cans check` ≈ 7.95 s text vs §40 "no operation exceeds 500 ms" (G1).
3. 10k-node `cans check --json` ≈ 71 s, ~9× text (G2).

**DOC-GAP/UNDOC (3):** `see:` target truncates at first space so spaced (but discoverable)
filenames can never be referenced — suggestion text even proposes creating a file named `07` (C2);
`see: AGENTS.md` silently resolves although AGENTS.md is excluded from all checks (C5);
`check <file>` says "no spec file matches" for a file that exists but failed parse (C8).

**Not executable:** symlink probes (file-outside-cans, symlinked subdir, loop) — sandbox denies
symlink creation (C7); QA-08 hit the same limitation, so symlink handling remains untested on
both source and npm.

---

## What held up

- **Parser resilience:** CJK, emoji, ZWJ emoji sequences, combining accents, 2000-char nodes,
  depth-40 chains, 0-byte files, CRLF, mixed endings — 10028-node graphs build with zero crashes
  and zero stack overflows across ~45 invocations; no stack traces anywhere (§37 form holds:
  worst case is single-line `✗` messages).
- **Slugs are escape-proof in practice:** `../../pwn` and `/abs/path` both collapse to safe
  in-workspace files (D1/D2), and `done` traversal now refuses cleanly (D3/D4).
- **§40 mid-scale budget is comfortably met on npm:** check 96 ms (27 files/532 nodes), status
  27 ms, budget read 25 ms on a 500-node-match concept, init 27 ms — every exercised row ≥1.8×
  under target, JSON at text parity.
- **Package ships exactly what §39 promises:** filename-level tarball audit clean (no lockfile,
  no node_modules, no tests, all templates present); registry metadata (version, dist-tag,
  engines, bin) matches docs; `--version`/`version` consistent with registry.
- **`init --tool cursor` is a first-class citizen:** root-level `.cursorrules`, byte-identical
  to AGENTS.md, invisible to check/status, idempotent, correct JSON (I1–I3).
- **Round-2→3 fix wave intact in this area:** two QA-08 MAJORs closed on the shipped artifact;
  QA-12's tab-rejection and F14 cosmetic residual reproduce exactly as recorded (no surprises).

## Observations

- The npm artifact behaves **numerically identically** to round-2 repo-source at 10k scale
  (7.95 s vs 8.4 s text; 71 s vs 69 s JSON) — consistent with §39's "source IS distribution"
  and confirming rounds 1–2 source findings transfer to npm users.
- Redundancy warning volume scales quadratically as documented: 130 mutually-similar nodes →
  8397 warnings; 10k sparse nodes → 515,137 warnings (74.9 MB text / 142 MB JSON output).
- The 8.09 s first JSON run (vs 67–73 s for the other three) is the second unexplained one-off
  seen at this scale across rounds (QA-08 B11 saw an exit-code one-off). Flagged for watchability;
  output was byte-identical and exit 0.
- Environment note: the global `cans` binary had to be reinstalled at the start of this session
  (box reset between QA-14 and QA-15); provenance is the npm registry, version 0.1.0, so the
  artifact under test is unchanged from QA-11..QA-14's.
