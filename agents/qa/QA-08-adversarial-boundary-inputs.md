# QA-08 — Adversarial & Boundary Inputs (Blackbox)

Task ID: 4-b | Agent: qa-adversarial | Repo: cans-spec @ fix/qa-red-tests-green, commit e628ff2
Date: 2026-09-04 | Method: manual shell only, blackbox (no src/, no tests read)

---

## Scope & prior-round exclusions

NEW adversarial/boundary coverage only. Already covered (and NOT retested here except where the
new branch could plausibly have changed a recorded PASS): init idempotency/`--force` clobber
(QA-01 #7–9), unknown init flags (QA-01 #19), slug basics `../../evil`/`has/slash` (QA-04 #4),
`new` flag-swallowing (QA-04/QA-06 #5), tab indentation (QA-02 #10a), 1/3-space indent (QA-02
#10c), dir-named-`.md` (QA-06 #58), 64-byte binary file (QA-06 #61), OPML garbage/empty/dir-path
(QA-05 #21–23), Obsidian callout + code-block drop (QA-05 F4/F5), `--out`/`--vault` basics
(QA-05 #18/#32), no-workspace surfaces (QA-06 H). Full FAIL/DEVIATION regression re-testing is
QA-07's mandate (task 4-a).

Docs used as oracle: README.md; docs/cans.architecture.md §5 (no frontmatter), §8, §10–12
(parser/refs), §13 (redundancy), §15 (structure), §16 (overflow), §18 (rules), §19 (exit codes
0/1/2), §20 (arg parsing), §21 (init), §22 (check `[file]`), §23 (slug normalization), §24
(done), §25 (status), §26 (budget), §27 (import), §28 (export), §31 (converters), §32 (fs
discovery), §37 (error philosophy), §40 (perf budget: "No operation exceeds 500ms").

CLI: `bun run /home/z/my-project/cans-spec/src/cli.ts <cmd>` (bun 1.3.14). All scratch under
`/home/z/my-project/qa-playground/qa-08/` (wsA…wsF3, fix/, outside.md). Repo untouched.

---

## Verdict summary

| Section | Tests | PASS | FAIL | DEVIATION | UNDOC |
|---|---|---|---|---|---|
| A Filenames & titles | 14 | 9 | 2 | 0 | 3 |
| B File content | 14 | 12 | 1 | 1 | 0 |
| C check surface | 9 | 5 | 0 | 0 | 4 |
| D budget | 11 | 8 | 1 | 1 | 1 |
| E import/export | 16 | 8 | 4 | 1 | 3 |
| F init | 8 | 6 | 0 | 1 | 1 |
| **Total** | **72** | **48** | **8** | **4** | **12** |

Findings: **0 BLOCKER · 5 MAJOR · 7 MINOR · several NIT**. Every FAIL row below carries its
severity. No stack traces observed anywhere; all raw-error cases are single-line
`✗ Internal error: <OS error>` with exit 2.

---

## A. Filenames & titles (wsA: fresh `cans init`)

| # | Command | Expected (doc ref) | Actual | Verdict | Exit |
|---|---|---|---|---|---|
| A1 | `new adr "认证设计 Authentication 🔐"` | §23 slug rules; non-ASCII undefined | `_adr/001-authentication.md`; CJK+emoji stripped from slug, body `# ADR-001: 认证设计 Authentication 🔐` preserves title | UNDOC | 0 |
| A2 | `new adr 'Use "quoted" strings here'` | strip quotes (§23) | `002-use-quoted-strings-here.md` | PASS | 0 |
| A3 | `new adr 'Cost $100 and \`tick\` back'` | non-alnum → hyphen (§23) | `003-cost-100-and-tick-back.md` | PASS | 0 |
| A4 | 200-char title (`python3 -c "print('x'*200)"`) | graceful | `004-` + full 200-char slug created (207-byte filename, no cap) | PASS | 0 |
| A5 | 300-char title | graceful §37 error | `✗ Internal error: ENAMETOOLONG: name too long, open '…/_adr/005-yyy….md'` — raw OS error for a user-correctable input; no slug-length guard | **FAIL (MINOR)** | 2 |
| A6 | `new task "Fix Auth"` while `_tasks/fix-auth.md` exists (user content `# Fix-Auth`) | §23 lowercase slug ⇒ collision; expect refusal | `✗ refusing to overwrite existing _tasks/fix-auth.md — it already has content; delete it or use a different name`; existing file intact | PASS | 1 |
| A7 | `new adr '!!! ??? ---'` / `new adr "   "` / `new task ""` | reject empty slug (§23) + §37 message | `✗ empty slug from "…" — provide a non-empty title`, exit 1 (well-formed; QA-04 #5's bare `✗` is fixed) | PASS | 1 |
| A8 | `new task "$(printf 'line1\nline2')"` | §23 non-alnum → hyphen | `_tasks/line1-line2.md` created | PASS | 0 |
| A9 | `new task --weird` / `new task -leading-dash` | UNDOCUMENTED (name-vs-flag for leading dashes) | `✗ unknown flag "--weird"` / `✗ unknown flag "-leading-dash" — no short flags supported`, exit 1; graceful rejection (not a name) | UNDOC | 1 |
| A10 | `new task "  spaced  name  "` | trim (§23) | `_tasks/spaced-name.md` | PASS | 0 |
| A11 | `done ../../evil` | §37 not-found error | `✗ task "../../evil" not found in _tasks/ — run \`cans status\` to list active tasks` | PASS | 1 |
| A12 | `done "sub/dir"` | §37 not-found | same graceful not-found | PASS | 1 |
| A13 | `done ../_adr/001-authentication` (traversal to real file) | task names should resolve only inside `_tasks/` | **Traversal accepted**: gates of the ADR file were evaluated (`✗ BLOCKED: 1 unchecked ← @human gate — _tasks/../_adr/001-authentication.md:27`) | **FAIL (MAJOR)** | 1 |
| A14 | `done ../_collab/escape` where `cans/_collab/escape.md` is a fully-completed no-gate task | refuse: task not in `_tasks/` | **`✗ Internal error: ENOENT: … rename '…/cans/_collab/escape.md' -> '…/cans/_tasks/_archive/2026-09-04-../_collab/escape.md'`** — done accepted the traversal name, ran its gates, then crashed building the archive path from the raw name; source file left un-moved | **FAIL (MAJOR)** | 2 |

A-findings:
1. **MAJOR — `done <name>` accepts filesystem-traversal names.** `done ../_collab/escape`
   resolved and gate-checked a file outside `_tasks/` (A13/A14). Archive never completes (dest
   path `_archive/2026-09-04-../…` is unopenable), so no data loss/corruption today, but the
   gate logic runs on arbitrary files and the failure is a raw exit-2 internal error instead of
   "task not found in _tasks/" (§24 + §37).
2. MINOR — no slug length cap; 300-char title dies with ENAMETOOLONG exit 2 (A5). §37 expects
   user-correctable errors as exit 1 with a fix hint.

---

## B. File content (wsB: fresh `cans init`, probes written into `cans/00-overview.md`)

| # | Command / input | Expected (doc ref) | Actual | Verdict | Exit |
|---|---|---|---|---|---|
| B1 | `: > cans/00-overview.md; check` | graceful | file counted (7 files), 0 nodes, no issues | PASS | 0 |
| B2 | frontmatter-only file (`---\ntitle…\n---`) | §5/§11: no frontmatter concept; non-bullets ignored | 0 nodes, orphan warning only | PASS | 0 |
| B3 | unclosed `---` + malformed YAML w/ tab | §11 tabs rejected, §37 message | `✗ 08-brokenfm.md — parse error: …tab indentation rejected (use 2 spaces)`, exit 1 | PASS | 1 |
| B4 | UTF-8 BOM at file start (printf '\xEF\xBB\xBF- Overview…') | graceful | both bullets parsed (nodes 28→30), no warnings about BOM | PASS | 0 |
| B5 | CRLF endings (`- Overview\r\n  - CRLF node one\r\n…`, verified `cat -A` shows `^M$`) | §11: bullet lines parse (Bun supports Windows per §45) | **All 3 bullets silently unparsed: nodes stay 28 (= empty file), `budget read "CRLF"` finds nothing, exit 0 — whole file invisible, no warning** | **FAIL (MAJOR)** | 0 |
| B6 | mixed 2/4/6-space + one tab line | §11 tab rejected | parse error names file + fix, exit 1 | PASS | 1 |
| B7 | pure 4/8-space increments | §11 2-space unit (floor semantics per QA-02) | 3 nodes nested correctly (depth 3), structure checks applied | PASS | 0 |
| B8 | 20-level deep chain | §15 depth > 5 errors | 15 depth errors (`Depth 6…20 exceeds max 5`), no crash, `maxDepth: 20` | PASS | 1 |
| B9 | 100 002-byte single line | §15/§16 both fire | `Node too long (99999 > 120)` + `node exceeds max chars (99999 > 200)`, 58 ms | PASS | 1 |
| B10 | 10 000-node file (`- node number i about topic i%97`), `check` | §40 "No operation exceeds 500ms" | **8.4 s text / 69.1 s `--json`** (515 233 warnings; counts correct: 10028 nodes; no crash) | **DEVIATION (MINOR)** | 0 |
| B11 | same, §19 exit code with 0 errors | warnings ⇒ exit 0 | 4 re-runs all exit 0; one earlier identical-output run had exited 1 (one-off, unconfirmed — see Observations) | PASS | 0 |
| B12 | duplicate node text ×2 | §13 L2 | `⚠ 00-overview.md:2 — 100% overlap: 00-overview.md:2 ↔ 00-overview.md:3` | PASS | 0 |
| B13 | duplicate headings (`# Heading One` ×2 + `##` variant) | §11 headings ignored | all ignored; 3 bullets parsed | PASS | 0 |
| B14 | nodes with trailing spaces / trailing tab | UNDOCUMENTED | trimmed, no issues | PASS | 0 |
| B15 | 2 KB /dev/urandom + Windows-1251 bytes then a valid bullet | §11 non-bullets ignored | binary ignored, bullet parsed (29 nodes), exit 0 (extends QA-06 #61) | PASS | 0 |

B-findings:
1. **MAJOR — CRLF files silently parse as empty (B5).** A Windows-authored outline contributes
   0 nodes with no warning and exit 0; `cans check` reports a false-clean workspace and budget
   can't find any of its concepts. Expected: strip `\r` (or warn), per §11's "indentation unit /
   bullets" contract and §45's Windows support.
2. MINOR — 10k-node check takes 8.4 s (text) / 69 s (JSON) vs §40's absolute "no operation
   exceeds 500ms". §13 itself warns phrase-overlap is O(N²) "fine < 500 nodes", so this is a
   documented design-envelope boundary, but the JSON path is 8× slower than text and both blow
   the stated budget (B10).
3. NIT — `--json` on the 515k-warning workspace is the worst case; JSON rendering dominates.

---

## C. check surface (wsC: fresh `cans init` + probes)

| # | Command | Expected (doc ref) | Actual | Verdict | Exit |
|---|---|---|---|---|---|
| C1 | `check cans/sub` (subdirectory as `[file]`) | §37-style rejection | `✗ no spec file matches "cans/sub" — pass a spec filename like 04-api.md or run \`cans status\` to list files` | PASS | 1 |
| C2 | symlink `cans/07-link.md → 02-authentication.md`; `check` | UNDOCUMENTED | **NOT EXECUTABLE: sandbox denies symlink creation.** Hard-link substitute (`ln 02-authentication.md 07-link.md`): counted as separate file (8 files/36 nodes), graceful | UNDOC | 0 |
| C3 | symlink loop (`a.md↔b.md`) | UNDOCUMENTED | NOT EXECUTABLE (same sandbox limit) | UNDOC | — |
| C4 | `check ../outside.md` and absolute path (file exists outside workspace) | not a spec; graceful reject | same "no spec file matches" message; file not read into graph | PASS | 1 |
| C5 | `check notes.txt` (txt exists in cans/) | reject non-md positional | "no spec file matches" | PASS | 1 |
| C6 | `cans/09-notmd.txt` + `cans/notes.txt` present; `check` | §32 `*.md` only | both ignored (7 files) | PASS | 0 |
| C7 | `cans/.hidden.md` present; `check` | UNDOCUMENTED (dotfiles) | **discovered and checked** (8 files; orphan + style warnings for `.hidden.md`) | UNDOC | 0 |
| C8 | `_tasks/notes.txt`, `_tasks/subdir/nested.md`, `_tasks/readme.tmp`; `status` + `check` | §32 `_tasks/*.md` flat only | all ignored: `0 tasks`, no check noise, exit 0 | PASS | 0 |
| C9 | `check cans/02-authentication.md` (valid path form) vs `check 02-authentication.md` | §20 `[file]` (path form unspecified) | path form rejected `✗ no spec file matches "cans/02-authentication.md"`; bare name works (exit 0) — matcher accepts only bare spec filenames | UNDOC | 1 / 0 |

C-findings: none beyond notes. Notable positive: positional `[file]` validation now exists
(QA-06 #68's silently-ignored positional is fixed on this branch), though it only accepts bare
filenames, not the `cans/…` path form the CLI itself prints elsewhere (NIT).

---

## D. budget (wsD: `cans/` = test/fixtures/budget-project/*.md; baseline `budget read "Sessions"` → 02(100)/04(60)/06(60), exit 0)

| # | Command | Expected (doc ref) | Actual | Verdict | Exit |
|---|---|---|---|---|---|
| D1 | `budget read "sign up"` (space) | §26 normalize concept | canonical home `02-authentication.md#Sign up` + 2 back-refs | PASS | 0 |
| D2 | `budget read "認証"` | §37 no-match error | `✗ no files match concept "認証" — check spelling or run \`cans status\`` | PASS | 1 |
| D3 | `budget read "SESSIONS" --json` | §26 normalize | same plan as "Sessions" (case-insensitive) | PASS | 0 |
| D4 | 4 000-char concept (500× "sessions ") | graceful | graceful no-match, exit 1 (echoes the entire 4k string — NIT) | PASS | 1 |
| D5 | `budget write "02-authentication" --json` (concept = filename) | §26: canonical home; MUST NOT edit see:-only files | `canEdit:[{file:"04-api.md", anchor:"Session rules: see 02-authentication.md#Sessions", reason:"canonical home"}]`, `mustNotEdit:[]` — **the canonical home landed on the see:-referrer's ref line; 04-api.md is a see:-only file yet is declared editable, and the real `02-authentication.md` appears nowhere** | **DEVIATION (MINOR)** | 0 |
| D6 | `--limit 0` | UNDOCUMENTED | ok:false, budgetLimit 0, empty plan, exit 1 (graceful) | PASS | 1 |
| D7 | `--limit -5` | UNDOCUMENTED | ok:false, budgetLimit −5 echoed, empty plan (no reason field in JSON — known §35 gap) | PASS | 1 |
| D8 | `--limit 1000000000` | sane | ok:true, full plan (92 tok) | PASS | 0 |
| D9 | `--limit abc` | §37: reject non-numeric | **silently ignored: budgetLimit 4096 default, full plan, exit 0, no warning** (variant of QA-06 #18; still unfixed for non-numeric values) | **FAIL (MINOR)** | 0 |
| D10 | `--limit 3.5` | UNDOCUMENTED | float accepted as limit → plan empty, ok:false (graceful) | UNDOC | 1 |
| D11 | `budget write "02-authentication"` anchor form | §35 anchor = short node text | anchor is the entire 50-char node text incl. `see:` syntax (cosmetic) | NIT | 0 |

D-findings:
1. MINOR — non-numeric `--limit` silently falls back to default with exit 0 (D9). Wrong-value
   inputs should be rejected (§20/§37), not ignored.
2. MINOR — a concept that collides with a filename steers `budget write` into declaring a
   see:-only referrer file editable, contradicting §26's "MUST NOT edit files with only see:
   references" (D5). Text-token matching has no filename-awareness.

---

## E. import/export (wsE: fresh `cans init`; fixtures in wsE/fix/)

| # | Command | Expected (doc ref) | Actual | Verdict | Exit |
|---|---|---|---|---|---|
| E1 | `import opml fix/truncated.opml` (cut mid-attribute) | §37 reject | `✗ invalid OPML in truncated.opml — invalid OPML: <opml> element is not closed` (QA-05 F12 fixed) | PASS | 1 |
| E2 | `import opml fix/wrongroot.opml` (`<list>` root) | §37 reject | `✗ invalid OPML … missing <opml> root element (not XML)` | PASS | 1 |
| E3 | `text="R&amp;D &lt;team&gt; &quot;q&quot; &apos;a&apos;"` | §31 entity decode | decoded exactly: `- R&D <team> "q" 'a'` | PASS | 0 |
| E4 | numeric entity `&#x1F600;` in text | UNDOCUMENTED (§31 lists only `&<>"'`) | left literal `&#x1F600;` in node; slug consumed it as `-x1f600` | UNDOC | 0 |
| E5 | raw unescaped `&` in attribute | UNDOCUMENTED (regex parser) | tolerated: `- raw & unescaped` | PASS | 0 |
| E6 | `[[99-nowhere#Missing anchor|dangling link]]` (obsidian) | §27/§31 wikilink→see: | `see: 99-nowhere.md#Missing anchor` (`.md` now appended — QA-05 F2 fixed for wikilinks); check flags broken ref correctly | PASS | 0 |
| E7 | `![[some-embed]]` (obsidian) | §31 embeds→see: | `see: some-embed` — **no `.md`** (inconsistent with E6) ⇒ guaranteed broken ref | **DEVIATION (MINOR)** | 0 |
| E8 | HTML comment inside a bullet | UNDOCUMENTED | preserved verbatim as node text (only `ref-by:` comments are metadata per §11) | UNDOC | 0 |
| E9 | code fence with list-like interior lines inside an Obsidian bullet (```python, 2 interior lines, closing fence, then `- normal child`, then `> [!warning]` callout ×2) | §27 "Extract code blocks → overflow files"; §31 callouts handled | **Fence became node text `- ```python` with the 2 interior lines as child nodes; the closing ```, the real bullet `- normal child`, and both callout lines were silently dropped (file is 8 lines vs 11 inputs; no overflow file). Callout drop = QA-05 F4 still open.** | **FAIL (MAJOR)** | 0 |
| E10 | Logseq `- collapsed:: true`, `- empty-prop::`, `- id:: ((abc-123))` | §31 strip `key:: value` | all stripped cleanly | PASS | 0 |
| E11 | Logseq `- multi word prop:: has spaces and stuff` | §31 strip property | **leftover garbage node `- multi word` created** (partial strip of a multi-word key) | **FAIL (MINOR)** | 0 |
| E12 | Logseq `- nested:: value` with an indented child | §31 strip properties | property line stripped; child re-parented, parseable | PASS | 0 |
| E13 | `import opml fix/big.opml` (10 000 `<outline>` pairs, 816 KB) | §27 preserve hierarchy; §40 < 200 ms | **91 ms**, 20 000 lines written, first/last nodes exact (`Item number 0…Detail 9999`) | PASS | 0 |
| E14 | `export obsidian --vault /tmp/vaultfile` (vault path is an existing FILE) | §37 user error | `✗ Internal error: ENOTDIR: not a directory, mkdir '/tmp/vaultfile/obsidian'` — raw OS error, internal-error framing | **FAIL (MAJOR)** | 2 |
| E15 | `export opml` in ws where `cans-export` exists as a FILE | §37 user error | `✗ Internal error: ENOTDIR … mkdir '…/cans-export/opml'` | **FAIL (MAJOR)** | 2 |
| E16 | `import opml fix/renamed.txt` (valid OPML content, .txt extension) | UNDOCUMENTED | imports fine (`+ 11-txt-ext-import.md`) — format arg decides, extension not checked | UNDOC | 0 |

E-findings:
1. **MAJOR — Obsidian import silently loses content after a code fence (E9).** Closing fence, a
   real sibling bullet (`- normal child`) and the callout block vanish; no overflow extraction
   (§27), no warning. Data loss on the interop path; includes the still-open QA-05 F4 callout
   drop.
2. MAJOR — `export` crashes with raw ENOTDIR exit 2 when the output/vault path is occupied by a
   file (E14/E15). Expected §37 exit-1 user error ("path is not a directory").
3. MINOR — embed refs (`![[x]]`) still lack `.md` while wikilinks now have it (E7) ⇒ every
   embed import is a guaranteed broken ref.
4. MINOR — multi-word Logseq property keys leave a truncated garbage node behind (E11).

---

## F. init (wsF1–wsF3)

| # | Command | Expected (doc ref) | Actual | Verdict | Exit |
|---|---|---|---|---|---|
| F1 | `init` in dir containing a FILE named `cans` | §19 internal error | `✗ Internal error: EEXIST … mkdir '…/cans'` (matches QA-01 #24 and §19 exit-2 contract; NIT: no "rename the file" hint) | PASS | 2 |
| F2 | `init` in `chmod 555` directory | brief expectation: graceful §37 error | `✗ Internal error: EACCES: permission denied, mkdir '…/cans'` — single line, no stack trace, but classified internal (exit 2) for a user-correctable condition; no "check permissions / sudo" hint | **DEVIATION (MINOR)** | 2 |
| F3 | `init --bare` then `ls cans/` | §21 "minimal" (set undefined) | only `00-overview.md` + `_rules.yaml` — **`AGENTS.md` no longer created** (QA-01 #10 recorded `_rules.yaml, AGENTS.md, 00-overview.md` on the old branch); help still advertises "Agents: cans/AGENTS.md" | UNDOC | 0 |
| F4 | `check` in bare ws | clean | `0 errors, 0 warnings.` | PASS | 0 |
| F5 | `status` in bare ws | §25 | `Files: 1 specs, 0 tasks…` | PASS | 0 |
| F6 | `budget read "overview"` in bare ws | §26 | canonical home found (14 tok), exit 0 | PASS | 0 |
| F7 | `new task bare-test` in bare ws | §23 | created `cans/_tasks/bare-test.md` | PASS | 0 |
| F8 | `done bare-test` (template has open `← @human`) | §24 gate 1 | `✗ BLOCKED: 1 unchecked ← @human gate — _tasks/bare-test.md:11 …` (correct file:line now shown — QA-04 #13's generic line fixed) | PASS | 1 |

F-findings: none new beyond the AGENTS.md-from-bare behavior change (F3, UNDOC — §21 never
enumerates `--bare`, but a workspace without `cans/AGENTS.md` contradicts the help footer and
§33's "Agents read cans/AGENTS.md").

---

## Findings register (severity order)

**BLOCKER: none.**

**MAJOR (5):**
1. `done ../_collab/escape` — path-traversal task names accepted; gates evaluated on a file
   outside `_tasks/`; archive rename then dies with raw `ENOENT` exit 2 (A13/A14).
2. CRLF line endings make an entire spec file silently parse as 0 nodes — false-clean check,
   exit 0, no warning (B5).
3. Obsidian import: content after a code fence (closing fence, real bullets, callouts) silently
   dropped; no overflow extraction; QA-05 F4 callout drop still present (E9).
4. `export obsidian --vault <existing file>` → raw `ENOTDIR` exit 2 (E14).
5. `export opml` with `cans-export` occupied by a file → raw `ENOTDIR` exit 2 (E15).

**MINOR (7):** 300-char ADR title → ENAMETOOLONG exit 2 (A5); 10k-node check 8.4 s/69 s vs §40
(B10); non-numeric `--limit` silently ignored (D9); filename-colliding concept steers
`budget write` into declaring a see:-only file editable (D5); embed `![[x]]` refs lack `.md` ⇒
guaranteed broken refs (E7); multi-word Logseq property leaves garbage node (E11); read-only-dir
`init` reports user-correctable EACCES as internal error exit 2 without a fix hint (F2).

**NIT:** empty-slug message echoes raw title (fine, by design); 4k concept echoed in full (D4);
positional `[file]` rejects the `cans/…` path form (C9); `&#xNNNN;` entities left literal (E4);
budget anchor = whole node text (D11).

**Fixed-on-this-branch observations (new-branch confirmations of old FAILs, owned by QA-07):**
positional `check <file>` now validates and errors on no-match (vs QA-06 #68); `new task`
refuses to overwrite existing files (vs QA-04 #2); `new`/`done`/missing-arg errors now have
real §37 messages with file:line and remedies (vs QA-04 #4/#5, QA-06 #1/#2); OPML rejects
truncated/wrong-root input (vs QA-05 F12); wikilink refs carry `.md` (vs QA-05 F2).

## Observations

- **No stack traces in ~150 invocations.** Worst case is the single-line
  `✗ Internal error: <OS errno text>` + exit 2 — §37-compliant in form, but applied to several
  user-correctable conditions (A5, E14, E15, F2).
- **B11 flake note:** the first 10k-node text-mode run exited 1 while printing
  `0 errors, 515233 warnings.`; 4 subsequent byte-identical runs (md5-equal output, 74.9 MB
  report) all exited 0, as did `--json` (ok:true, exitCode:0). Unconfirmed one-off; flagging
  for watchability, not counted as a finding.
- Sandbox limitation: symlink creation denied → C2/C3 executed only via hard-link substitute.
- 10k-node check emits a 74.9 MB text report / 515 233 warnings (~51 per node) — the O(N²)
  redundancy layers dominate; consistent with §13's "< 500 nodes" design note.
- Import naming stays deterministic at scale (`10-item-number-0-topic-0.md`, 20 000 lines);
  multi-root sources still collapse into one file (QA-05 #10, unchanged).
- Exit-code triad holds everywhere else: all graceful failures exit 1, all successes 0.

## Verdict summary

- **72 checks: 48 PASS · 8 FAIL · 4 DEVIATION · 12 UNDOC.**
- No blockers; the 5 majors are two export-path crash classes (one root cause), one CRLF
  silent-data-loss parser bug, one Obsidian import data-loss cluster, and the `done` traversal
  acceptance.
- No repo files modified; all evidence reproducible under `/home/z/my-project/qa-playground/qa-08/`.
