# CANS Architecture

## Canonical Agent-Native Spec — Complete System Design

---

## 1. Identity

**CANS** = Canonical Agent-Native Spec. A spec-driven development system where dense hierarchical outlines ARE the product. No schema engine. No artifact pipeline. No adapter registry. The outline is the spec, the state, the task board, and the coordination protocol.

Ships as a Bun CLI (`cans`) via npm. Zero runtime dependencies. ~1080 lines of TypeScript total.

---

## 2. Why CANS Exists

OpenSpec (`@fission-ai/openspec`) enforces spec-driven workflows via 200+ files, 4-artifact pipelines, Zod validation, DAG resolution, 30+ tool adapters, delta-spec merges, SHALL/MUST enforcement, ~50k–100k tokens per invocation.

**CANS solves every OpenSpec problem by deletion:**

| OpenSpec does | CANS verdict |
|---|---|
| 4-artifact pipeline (proposal→specs→design→tasks) | Edit spec in place. ADR records why. Tasks track work. |
| Zod + DAG + 30 adapter files | Structural lint. No schema. |
| Delta-spec merge at archive | `see:` references + git diff. |
| SHALL/MUST, Scenario, WHEN/THEN | Natural language. Dense outline. |
| ~3000 tokens per skill × 12 skills | ~800 tokens total agent instructions. |
| `openspec status --json` for state | Agents read the file. The file IS the state. |
| 30+ tool-specific command formatters | One prompt block. String-replace for tool name. |
| YAML frontmatter + markdown headers | Zero ceremony. Bullets only. |
| Custom merge logic | Git handles merge. Humans resolve conflicts. |
| Telemetry, stores, registries | None. |

**Token cost:** OpenSpec single invocation: 50k–100k+ tokens. CANS entire agent instruction block: ~800 tokens, loaded once. CANS spec files are 3–5× denser than OpenSpec markdown.

---

## 3. Core Mental Model

**The outline IS everything.**

- The outline is the **spec** (requirements, constraints, decisions)
- The outline is the **state machine** (indentation = dependency, checkboxes = progress)
- The outline is the **task board** (`- [ ]` / `- [x]` with `← agent-name`)
- The outline is the **coordination protocol** (ownership, handoffs, review gates)
- The outline is the **reference graph** (`see:` links, one hop max)
- Git is the **transport layer** (branch per change, merge when done)
- Files are the **workflow engine** (no CLI needed for collaboration itself)

There is no separate "project state" to query. An agent reads the outline and knows everything.

---

## 4. Five Principles

**1. Dense over verbose.** Every bullet earns its place. No filler levels. No manufactured identifiers.

```markdown
# BAD (filler levels)
- Authentication
  - Capability
    - Behavior
      - Sign up

# GOOD (dense)
- Authentication
  - Sign up
```

**2. Canonical over duplicated.** Every concept has exactly one authoritative home. Everywhere else uses `see:` to point at it.

```markdown
# 02-authentication.md (canonical home)
- Sessions
  - Expire after 24 hours
  - Refresh allowed for 30 days

# 04-api.md (reference, not duplication)
- Authentication
  - Session rules: see 02-authentication.md#Sessions
```

**3. One hop. Never chain.** If file A references file B, file B must NOT contain `see:` pointing to file C. Reference C directly from A.

```markdown
# FORBIDDEN: A → B → C
# CORRECT: flat references from A to both B and C
```

**4. Unknowns are first-class.** `TBD` is valid. Don't guess. Don't block. Mark it, move on, resolve later.

**5. Structure emerges from subject.** No fixed hierarchy. No required vocabulary. If a concept has one child, collapse the level. Preserve real identifiers exactly (`POST /users`, `packages/api`, `users.created_at`). Don't kebab-case reality.

---

## 5. What CANS Deliberately Does NOT Do

- ❌ No schema.yaml / artifact DAG / topological sort
- ❌ No Zod validation of requirement text
- ❌ No SHALL/MUST keyword enforcement
- ❌ No scenario counting (WHEN/THEN/GIVEN)
- ❌ No 30 tool adapters / adapter registry
- ❌ No YAML frontmatter in spec files
- ❌ No "delta operations" (ADDED/MODIFIED/REMOVED)
- ❌ No telemetry
- ❌ No store/registry system for multi-repo
- ❌ No requirement-block parsing
- ❌ No phase gates (proposal → specs → design → tasks)
- ❌ No NLP / embeddings / vector DB / ML
- ❌ No LLM-powered redundancy detection
- ❌ No automatic fixing (flags only, human decides)
- ❌ No devcontainer / CI/CD pipeline
- ❌ No lockfile worship (Bun native)
- ❌ No merge pipeline (agent edits specs directly)
- ❌ No "change file owns concepts" pattern

**CANS trusts the outline. The outline IS the contract.**

---

## 6. Target User / Non-Target

**Target:** Solo dev or small team using AI agents for implementation. Already paying for LLM subscriptions. Wants spec discipline without ceremony. Uses git. May use Obsidian/Logseq/Dynalist.

**Non-target:** Enterprise compliance audit trails. Jira/Linear as source of truth. Legally binding spec contracts. Auto-generate/auto-validate without human review.

---

## 7. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Bun ≥ 1.0 (primary), Node.js ≥ 23.2 (fallback, issue #12) | Native TS execution on both — Bun fast paths, node: builtins fallback |
| Language | TypeScript | Type safety without compilation ceremony |
| Dependencies | **Zero** | No commander, no yaml parser, no zod, no chalk |
| Config format | YAML (`_rules.yaml`) | Human-editable, minimal custom parser |
| Spec format | Markdown outlines | Universal, git-friendly, agent-native |
| Coordination | Git | Branch per change, merge when done |
| CLI dispatch | Manual `process.argv` parsing | 10 commands don't need a framework |

---

## 8. Workspace Structure

```
cans/
├── _rules.yaml
├── AGENTS.md
├── 00-overview.md
├── 01-architecture.md
├── 02-authentication.md
├── 03-data.md
├── 04-api.md
├── 05-frontend.md
├── 06-operations.md
├── _adr/
│   ├── _template.md
│   ├── 001-css-variables-over-tailwind.md
│   ├── 002-postgres-over-mysql.md
│   └── _archive/
├── _tasks/
│   ├── add-dark-mode.md
│   └── fix-auth-bug.md
└── _collab/
    ├── handoffs.md
    ├── conflicts.md
    └── decisions.md
```

Folder mode alternative: `02-authentication/index.md` instead of `02-authentication.md` — at ANY depth (issue #54: `plugins/topic/index.md` is a first-class spec file, discovered like a root file; 0.6.0 only looked one level deep). Flat wins over folder. If both exist, `cans check` flags error — for any slug, numbered or plain (round 6). The duplicate-home error class is root-level by design; a deeper flat/folder collision simply loads both, flat winning ref resolution.

Subfolder content files (issue #54): any OTHER `.md` inside a subfolder (`plugins/pty.md`, `04-api/request-schema.md`) is plain non-spec content by default (issue #56 removed the §16 overflow-target class with the overflow engine). When a loaded SPEC file references one (`see: plugins/pty.md`), the check engine PROMOTES it transitively to a first-class spec file (counted in files/nodes, subject to every engine, a ref-graph node, `--file`-filterable, `--fix`-rewritable); unreferenced subfolder `.md` files stay leaf content. Refs from `_tasks/`/`_adr/` files never promote — aux pointers are transient/decisional.

---

## 9. Source Structure

```
cans-cli/
├── .github/workflows/test.yml
├── src/
│   ├── cli.ts                 # entry, shebang, dispatch, emit()
│   ├── types.ts               # all interfaces + Result types
│   ├── commands/
│   │   ├── init.ts
│   │   ├── check.ts
│   │   ├── new.ts
│   │   ├── done.ts
│   │   ├── status.ts
│   │   ├── budget.ts
│   │   ├── import.ts
│   │   └── export.ts
│   ├── core/
│   │   ├── output.ts          # emit() + printHuman() (~80 lines)
│   │   ├── outline.ts         # parse .md → OutlineNode[]
│   │   ├── refs.ts            # see: resolution, back-pointers, deep-hop
│   │   ├── structure.ts       # node length, siblings, depth
│   │   ├── style.ts           # sibling vs nested enforcement
│   │   ├── redundancy.ts      # word freq, overlap, synonyms, fuzzy
│   │   ├── rules.ts           # load + strictly validate _rules.yaml
│   │   ├── token-budget.ts    # estimate tokens, build reading plan
│   │   └── fs.ts              # exists, mkdirp, glob, read/write
│   └── converters/
│       ├── shared.ts
│       ├── opml.ts
│       ├── logseq.ts
│       └── obsidian.ts
├── templates/
│   ├── AGENTS.md
│   ├── _rules.yaml
│   ├── adr-template.md
│   └── task-template.md
├── test/
│   ├── helpers.ts
│   ├── outline.test.ts
│   ├── refs.test.ts
│   ├── structure.test.ts
│   ├── style.test.ts
│   ├── redundancy.test.ts
│   ├── budget.test.ts
│   ├── converters.test.ts
│   ├── rules.test.ts
│   ├── commands.test.ts
│   └── fixtures/
│       ├── flat-project/
│       ├── folder-project/
│       ├── broken-refs-project/
│       ├── deep-hop-project/
│       ├── redundancy-project/
│       ├── style-project/
│       ├── import-fixtures/
│       ├── budget-project/
│       └── output/            # JSON output fixtures
├── package.json
├── README.md
├── LICENSE
└── .gitignore
```

**~1080 lines production. ~400 lines tests. ~200 lines templates. ~300 lines fixtures.**

Module dependency: no circular imports. `types.ts` imports nothing. `core/` never imports `commands/`. `converters/` never imports `core/` except `shared.ts`.

---

## 10. Core Types

```ts
interface OutlineNode {
  text: string; line: number; indent: number;
  children: OutlineNode[]; file: string;
  isTask: boolean; isDone: boolean;
  owner: string | null;        // from "← agent-1"
  isHumanGate: boolean;        // "← @human"
  refs: RefTarget[];
  hasCodeFence: boolean; hasTable: boolean;
}

interface RefTarget {
  raw: string; file: string;
  anchor: string | null; line: number;
}

interface BackPointer { fromFile: string; fromLine: number; toFile: string; toAnchor: string | null; }

interface Issue {
  file: string; line: number;
  level: 'error' | 'warning';
  category: 'structure' | 'style' | 'refs' | 'redundancy' | 'config';
  message: string; suggestion?: string;
}

interface CommandResult { ok: boolean; command: string; exitCode: number; }
```

---

## 11. Outline Parser

**Input:** Markdown bullets. **Output:** `OutlineNode[]` tree.

**Rules:**
- Indentation unit: 2 spaces. Hardcoded. Tabs rejected.
- Non-bullet lines ignored (prose, headings, blanks exist for humans only).
- `<!-- ref-by: ... -->` stripped from text, recorded as back-pointer metadata.
- Alias-definition lines (`- [1]: target#Anchor`, issue #57) are file METADATA, never nodes — skipped by the same shape regex every alias consumer shares (§12); outside code fences only.
- `see:` parsed via regex: `/see:\s*(\S+?)(?:#(\S+))?/g`
- Owner parsed via regex: `/←\s*(@?\S+)/`
- Stack-based parent attachment by indent level.

**Flat vs folder resolution:** Try `cans/02-authentication.md` first. Then `cans/02-authentication/index.md`. Flat wins. Both existing = error — for ANY slug, numbered (`02-authentication.md` + `02-authentication/`) or plain (`auth.md` + `auth/`): a duplicate home is a `structure.duplicate_home` error, flat wins.

**Extensionless targets (§11 flat-first, round 6):** a ref target without an extension resolves like its spelled-out form, flat first: `see 02-b` → `cans/02-b.md` when it exists, then `cans/02-b/index.md` (same rule folders already followed: `see auth` → `auth/index.md`). Flat wins when both exist.

**Workspace containment (issue #10, round 6):** ref targets can never resolve outside the workspace root — `../` traversal and absolute paths are broken refs (`file not found in workspace`) even when the file physically exists beyond the root. Interior `..` segments that normalize back inside the root still resolve.

**Trailing-slash folder targets (issue #22):** `see: auth/`, `see: auth` and `see: auth/index.md` are equivalent spellings of one folder-layout target — trailing slashes are trimmed in target-key resolution (targetMatchesKey / loadedKeyFor / resolveSpecFile), so all ref consumers (broken refs, anchors, deep-hop edges, orphans, back-pointer grouping, token budgets) treat them identically.

**Subfolder .md targets (issue #54):** a `see:` that resolves to a non-index `.md` inside a subfolder (`see: plugins/pty.md`, extensionless stems included via the §11 flat-first order) PROMOTES that file to a first-class spec file during `cans check` — transitively (a promoted file's own refs promote further targets, iterated to a fixpoint), from SPEC files' refs only (`_tasks/`/`_adr/` aux refs and the `done` archived-task referrer never promote). Promotion is a check-flow feature: `cans status` and `cans export` list discovered files (root `.md` + any-depth `index.md`) without it.

---

## 12. Refs Engine

### Resolution
- Find target file (flat then folder). Extensionless stems follow the same order: `<stem>.md` first, then `<stem>/index.md` (round 6).
- Trailing-slash folder forms are equivalent spellings: `auth/` = `auth` = `auth/index.md` (issue #22) — never a broken ref on slash spelling alone.
- Targets never resolve outside the workspace root: absolute and `../` targets are broken refs — `file not found in workspace` (issue #10, round 6).
- If no anchor → file-level ref, resolved.
- If anchor → find node by exact text match, then case-insensitive fallback.
- If anchor on a JSON/YAML/TOML target → the schematic anchor vocabulary
  below: dot paths down to leaves, one form identical across formats (issue #58).
- If anchor on a `.txt`/`.text` or code-file target (`.ts`, `.js`, `.rs`,
  `.py`, `.go`, …) → the target's natural addressable units: section
  headings for text artifacts, top-level symbols for code files (issue #60),
  resolved by the same §12 normalization and first-match rule as bullets.
- No fuzzy anchor matching. Not found = broken ref error — the `refs.broken` JSON counter counts these broken-anchor errors too (round 6).

### Schematic anchors — JSON / YAML / TOML (issue #58)

A schematic file is exactly where a precise pointer matters — a config, a
schema, a test vector, a manifest. Anchored refs into `.json`, `.yaml`,
`.yml` and `.toml` targets are verified DOWN TO LEAVES: the file is parsed
(hand-rolled recursive-descent parsers in `src/core/schematic.ts` — the
repo's zero-runtime-dependency law holds on both runtimes; no `js-yaml`, no
`Bun.TOML`) and its key paths become the addressable vocabulary, through the
SAME code path for on-disk targets and `name://` external targets (no
per-format special cases).

**The anchor form** (one form, identical across formats — the same anchor
resolves in the JSON, YAML and TOML spelling of the same schema):

```text
#database.host     dot path from the document root
#items.0           sequence/array item by index
#items[0]          the same index in bracket spelling — the two compose:
                    #matrix[0][1], #items[1].tags.2, #items.0.name
#a\.b              a key CONTAINING a dot, escaped with a backslash
                    (\\ a literal backslash, \\[ / \\] literal brackets,
                    any \X reads as X)
#maintenance       a single-segment anchor keeps the issue #49 flat meaning:
                    it must match exactly ONE key anywhere in the document
```

Path segments resolve with the same §12 normalization as node anchors
(case-insensitive, separator-insensitive — exact spellings win first); array
indices are exact integers.

**Verdicts** (the issue's checker contract):

| Anchor | Verdict |
|---|---|
| Existing leaf path (`#database.host`) | Resolves — in every supported format |
| Intermediate object path (`#database`) | A VALID ADDRESS that resolves — but never presented as leaf proof |
| Flat name matching MULTIPLE leaves (`#port` under `database` and `server`) | `refs.anchor.ambiguous` ERROR listing the full paths, suggesting the dot form |
| Missing leaf path (`#NoSuchLeaf`) | `refs.broken.anchor` ERROR — in every supported format |
| Flat name matching exactly one key (the #49 behavior) | Resolves — backwards compatible |
| Flat name matching zero keys but a bullet node (YAML block sequences mint bullets) | Resolves via the bullet — the #49 additive behavior stays |
| Malformed / beyond-subset schematic | `refs.anchor.parse-error` ERROR at the pointer site — never a silent pass, a warning, or a broken-anchor false positive |
| Target with nothing addressable (prose `.md`, empty schematic, empty `.txt`, unknown format like `.csv`) | `refs.anchor.no-target` advisory downgrade (issues #49, #60) — explicit, never silent |

The two new rules count in the `refs.broken` JSON counter beside
`refs.broken.file` / `refs.broken.anchor` (the QA-19 F40b truthfulness
contract: an error-level refs finding never sits beside `refs.broken: 0`).

**Supported subsets** (a construct beyond them is an explicit error at the
pointer site, never a silent pass):

- **JSON** — strict RFC 8259: objects, arrays, strings (full escape set incl.
  `\uXXXX` + surrogate pairs), numbers, `true`/`false`/`null`. No comments,
  no trailing commas, no trailing content; **duplicate keys are a parse
  error** (decided: ambiguous documents are rejected, never silently
  last-wins).
- **YAML** — block mappings and sequences (any nesting, indented or flush
  style), flow collections (single- or multi-line), scalars typed per YAML
  1.2 core, comments, block scalars (`|`, `>` with `-`/`+` chomping), quoted
  keys. NOT supported: YAML's own `&anchors`/`*aliases`/`!tags`, merge keys
  (`<<:`), complex keys (`?`), explicit-indent block indicators (`|2`),
  multi-line quoted scalars, tab indentation. **Multi-document input:** v1
  addresses the FIRST document — a later `---` (or `...`, only at column 0)
  ends it and the rest is out of scope.
- **TOML** — `[tables]`, `[[arrays-of-tables]]` (subtables attach to the last
  element), dotted keys, inline tables and arrays (multi-line arrays
  allowed), basic and literal strings (single- and multi-line), integers
  (underscores, `0x`/`0o`/`0b`), `inf`/`nan`, booleans; datetimes read as
  string scalars. Duplicate keys/tables are parse errors; static (inline)
  arrays cannot be extended by `[[…]]`.

**Laziness** (contract 7): a schematic file is read and parsed ONLY when a
pointer actually carries an anchor into it — file-level pointers to any
target (including a malformed schematic) stay clean, and unreferenced files
are never parsed. No corpus-wide schematic parsing.

**Suggestions** follow the issue #53 rule (the ref follows the content, never
the other way around), extended to path form: a near-miss path is proposed
VERBATIM (`did you mean cfg.yaml#database.host?` — never slugified to
`database-host`, which would not resolve), the unescaped spelling of a dotted
key is taught the escape (`#a.b` → `#a\.b`), flat names are proposed only
when they resolve uniquely, and bullet texts keep the canonical slug form.

### Text and code anchors — .txt and code files (issue #60)

A `see:` ref to a non-spec file inside the workspace is a TERMINAL target —
0 hops for deep-hop purposes (issue #44: it can never form an A→B→C spec
chain), and its anchor resolves against the file's natural addressable
units, exactly the way a bullet or a schematic key path does:

```text
artifacts/diagrams/data-flow.txt#creation-flow   a .txt section heading:
                                                   `CREATION FLOW` answers it
artifacts/diagrams/data-flow.txt#directory-tree   same file, second heading
artifacts/rules.ts#createRule                     a code file's top-level symbol
artifacts/registry.rs#parse_header                .rs / .py / .go likewise
```

- **Text artifacts (`.txt`, `.text`)**: section heading lines are the
  vocabulary; §12 normalization applies, so `CREATION FLOW` answers
  `#creation-flow`, `#Creation-Flow` and `#creation_flow` alike.
- **Code files (`.ts`/`.tsx`/`.mts`/`.cts`/`.js`/`.jsx`/`.mjs`/`.cjs`,
  `.rs`, `.py`, `.go`)**: top-level symbols — exported functions, types,
  consts, modules — are the vocabulary, extracted line-based without
  parsing (the zero-dependency law holds; over-extraction can only add
  addressable names, never silence a miss).
- **Resolution is the bullet model**: exact-after-normalization, first
  match in document order, no new ambiguity error class — a name that
  appears twice in a text file addresses the first, like a duplicated
  bullet text would.
- **A miss is the only failure**: an anchor that matches nothing is the
  `refs.broken.anchor` error, never stacked under a spurious deep-hop
  error (the target is terminal, so no hop exists to stack). Its
  suggestion ranks the heading/symbol texts like bullet texts (issue #53).
- **Nothing addressable** (an empty `.txt`, a `.csv`, any format outside
  the vocabulary) keeps the `refs.anchor.no-target` advisory downgrade of
  issue #49 — explicit, never a silent pass.
- **The `--fix` anchor repair** proposes heading/symbol candidates for
  these targets too, mirroring the resolution vocabulary (below).
- **External `name://` targets** resolve through the same shared verdict
  path, so a pointer at `ext://notes/runbook.txt#creation-flow` behaves
  exactly like the on-disk form.

### Broken-anchor suggestions (issue #53)
A broken anchor keeps its `refs.broken.anchor` error — but the ADVICE follows
the node, never the other way around (the old `fix the anchor or add a
"<anchor>" node` wording invited renaming spec nodes to satisfy a bad ref).
On a miss, the target's addressable vocabulary — real bullet texts + YAML
mapping keys +, since issue #60, text headings and code symbols — synthetic
placeholder nodes excluded (issue #8) — is
fuzzy-ranked against the failing anchor (`nearSlugMatches`, normalized
similarity ≥ 0.8; resolution itself stays exact-after-normalization, the
fuzzy layer exists only for suggestions and the gated `--fix` repair):
- **one near candidate** → `did you mean <file>#<slug>? — fix the ref
  anchor`, with the CANONICAL `anchorSlug` spelling (the same form
  `cans slug` prints) — a pure ref fix.
- **two or more** → named, capped at 3 + `…` (`did you mean <file>#a,
  <file>#b? — fix the ref anchor`) — the ambiguity is surfaced, never
  resolved by coin flip.
- **zero** → `no near match in <file> — add the "<anchor>" node there, or
  fix the anchor spelling` — add-node advice that never invites renaming
  the nodes that do exist.

Per-ref reachability: every `refs.broken.anchor` group item carries its own
fix (report.ts `GroupItem.suggestion`); the folded view shows the group hint
(first member's fix), `--show refs` appends each member's did-you-mean to
its line.

### Slug-safety notes (issue #53, Part 1.5; opt-in since issue #59)
`cans check` can additionally emit an INFO-level note (`refs.slug.hint`) on
every real node whose text contains characters outside the slug-safe set —
typographic dashes, NBSP, zero-width/format characters, curly quotes, any
non-ASCII letter — because all of them produce anchors a human cannot
predict from the prose. The message names the node's EXACT canonical anchor
and the offending characters by label:

```
non-obvious slug: "Layer 1 — C authorizer" → #Layer-1-C-authorizer (contains —(U+2014))
```

Capped at 5 notes per file plus one summary line naming the counts (the
issue #41 compact-output budget). Info is a hint band, NOT a finding: it
never affects `ok`, exit codes, `--strict` or the error/warning counts —
JSON entries carry `level: "info"` while `counts` stays `{errors,
warnings}`; human output marks them `ℹ` without changing any ✓/⚠/✗ mark.

**Opt-in (issue #59):** the band is OFF by default — the notes are computed
but emitted only when the run asks for them via the `--hints` flag or the
`_rules.yaml` key `output.slug_hints: true` (§18; flag or config — either
enables, and there is no `--no-hints` because off is the default). Hint
count scales with confusable NODES, not with problems found, so a default-on
cheatsheet taxed the cleanest corpora hardest (59.9% of a green run's
`--json`). Default surface: no hint items, no `ℹ N notes` count, no `more →
--show refs` pointer in text; no info items in `--json` — only the
`refs.hintCount` integer (present when non-zero) says the hints exist.
`--show refs` expands FINDINGS only and never implies hints. The on-demand
path for a single anchor is `cans slug "<node text>"` — no flag needed.

### Back-pointers
HTML comments in target file: `<!-- ref-by: 04-api.md, 05-frontend.md -->`
Rebuilt from scratch every `--fix` run (the desired-marks map is computed
from the whole ref graph) — but the WRITES are scoped by the `[file]` filter
(issue #11): a filtered `check --fix <file>` rewrites ref-by comments ONLY
in the filter-matched spec files. A referrer filter (e.g. `04-api.md`)
therefore leaves its targets' marks untouched that run — re-run with the
target's filter, or unfiltered, to write them. Not incremental. Not
authoritative.

**Anchor-aware marks (issue #19):** a comment's FORM defines what it answers.
- A ref WITH an anchor (`see: 02-authentication.md#Sessions`) earns its mark
  INLINE on the referenced node's bullet line — the §34 convention:
  `  - Sessions <!-- ref-by: 04-api.md -->`. The node is the first §12
  anchorMatches hit in document order (exact → case-insensitive →
  hyphen/space normalization).
- A plain file-level ref (`see: 03-data.md`) earns the mark as a STANDALONE
  comment line right after the target's first root bullet (issue #6 form —
  never inside a code fence).
- Currency: a standalone mark is current only while its referrer still holds
  a FILE-LEVEL ref at the file; an inline mark on node X is current while the
  referrer's anchor resolves to X, or while it refs the file itself (a
  file-level ref satisfies any mark — the mark is at least as precise as the
  ref). Retargeting an anchor (`#Sessions` → `#Passwords`) therefore turns
  the old mark STALE — warning + `--fix` rewrite; a BROKEN anchor earns no
  mark at all (it is already a `broken anchor` error) and can never read as
  current. `back-pointers: N/M current` counts comments at this granularity.

### Deep-hop detection
For every file that IS referenced (has incoming refs): if it ALSO has outgoing refs → deep hop error. Report the full chain and suggest the fix.

**Non-spec targets are exempt (issue #44):** the hop classification only counts refs whose target is a loaded spec file. A ref whose target exists on disk inside the workspace but is not a spec file (`see: artifacts/final-chain.ts`, an example the hub points at) is never mesh-exiting — such a target cannot form an A→B→C spec chain by construction, and the ref is valid (it resolves, so it is not a broken ref either). Before #44 a hub that every file back-referenced could never pass `cans check` while holding its artifact pointers. A target that does NOT exist on disk still counts as mesh-exiting in deep-hop terms — it is a broken ref, reported (with its fix advice) by the broken-ref check; `../` and absolute targets never earn the exemption (resolution is containment-guarded, issue #10). The exemption is keyed to the workspace root the `check` command passes to the detector; library callers that omit the root keep the legacy classification. Such a target is TERMINAL — 0 hops — and since issue #60 an anchored ref into it (`artifacts/diagrams/data-flow.txt#creation-flow`) resolves against the file's natural heading/symbol vocabulary (§12), so the anchor verdict stands alone: a genuine miss is the only failure, never stacked under a deep-hop error that cannot exist for a terminal target.

**Subfolder files and deep hops (issue #54):** the §5 semantics are unchanged — under `max_hops: 1` a referenced file that refs out still deep-hops, promoted or not. What issue #54 removed is the catch-22: a PROMOTED subfolder file may now point BACK at its referrer, and a mutual back-reference cluster is one strongly-connected mesh — never a hop. The sanctioned patterns: the mesh (A → B, B → A), or raising `references.max_hops`. A leaf that does not point back still errors by design, and so does referencing a catalog that refs out (catalogs stay unreferenced roots).

The suggested fix is two-part and never a duplicate (issue #22): adding the direct ref alone leaves the hop in place, so the advice also says to remove the intermediate hop via the flagged file — naming the EXACT edge to delete (the referrer's raw `see:` and its source line), so a multi-referrer workspace never leaves the user guessing which ref feeds the hop (round 6). And before recommending any `add`, the engine checks the deepest direct referrer's existing refs — if one already resolves to the same target KEY and the same anchor NODE under an equivalent spelling (`see auth#Sessions` vs `see: auth/index.md#Sessions`; anchors compare case-insensitively, both file-level counts as its own equivalence), the advice names that existing ref instead of appending a second `see:` to the same node. A same-file/different-node ref (`see auth#Passwords` beside a suggested `auth/index.md#Sessions`) or a file-level ref beside an anchored suggestion is NOT a duplicate — the advice stays the plain add+remove (round 6).

**Example:**
```
✗ DEEP HOP: 04-api.md → 02-authentication.md → 06-operations.md
Fix: add "see: 06-operations.md#Data-protection" directly to 04-api.md and remove the intermediate hop via 02-authentication.md: delete 04-api.md's "see: 02-authentication.md" (line 3)
```

### External roots / inter-repo pointers (issue #55)

A `see:` target of the form `name://sub/path` is an inter-repo pointer: it
resolves `sub/path` under the external root declared as `name` in
`references.external_roots` (§18). `http://` and `https://` targets are URLs,
never pointers — they keep their exact pre-#55 treatment (broken-ref
classification, create-advice, deep-hop mesh classification).

**Anchor (binding decision):** the root PATH resolves from the PROJECT root —
the parent directory of the `cans/` workspace — so `"../kelir-cloud/cans"`
names a sibling checkout:

```yaml
# cans/_rules.yaml
references:
  mode: pointer
  back_pointers: false
  max_hops: 1
  orphan_check: true
  duplicate_home_check: true
  external_roots:
    kelir-cloud: "../kelir-cloud/cans"
```

```text
# cans/07-lifecycle.md — a per-primitive exercise map whose examples live in the sibling repo
- map_shared_region: see: kelir-cloud://artifacts/examples/multi-vm-swarm.rs
- register_veto: see: kelir-cloud://artifacts/examples/multi-vm-swarm.rs
```

The sub-path is always relative to the DECLARED root — declare the sibling's
repo root (`"../kelir-cloud"`) and spell `kelir-cloud://cans/artifacts/…`, or
declare its cans/ dir and spell `kelir-cloud://artifacts/…`; both work.

Verdicts, in order:

1. **Undeclared root** (`ghost://x` with no `ghost` in `external_roots`) →
   broken ref error, `refs.broken.file`, message `undeclared external root
   'ghost'` — counted in `refs.broken`. Fires whether or not any
   `external_roots` map is configured.
2. **Absent root** (declared but not checked out locally) → ONE warning per
   referenced root per run (`refs.external.absent`), attached to the first
   pointer into it; pointers into the root are NOT verified that run —
   neither broken nor resolved. Binding decision: a warning, never an error —
   CI that only clones the spec repo must stay usable. An absent root that
   nothing points at is silent.
3. **Escape** → broken ref error, always (security, never optional): the
   sub-path must stay INSIDE the resolved root, checked twice — lexically
   (`root://../..`, `root://../../etc/passwd`, absolute sub-paths are
   rejected; interior `..` that normalizes back inside the root still
   resolves, the same lexical-containment semantics the workspace resolver
   applies) and after realpath (a symlink inside the root pointing outside is
   an escape, never a resolution). The ROOT value itself may traverse — it is
   author-declared; only the pointer sub-path is containment-guarded. This
   extends the issue #10 discipline to external roots: an undeclared `../`
   target in an ordinary `see:` stays exactly the broken ref it was, and a
   sibling file that exists on disk beyond an ordinary `../` target still
   never resolves.
4. **Missing file** (present root, contained sub-path, no file) → broken ref
   error (`file not found under external root 'name'`), gated by
   `orphan_check` like the issue's proposed config; with
   `orphan_check: false` the missing-file verification is off. Directories
   are not valid targets — external pointers resolve to files.
5. **Resolved** → a valid terminal ref. `duplicate_home_check` then applies
   ACROSS roots: if the pointer's (normalized) sub-path also names an
   existing file under the workspace root, the project root, or another
   present declared root — the migration-leftover shape where the example
   still exists locally AND in the sibling repo — the existing
   `structure.duplicate_home` error shape fires (`duplicate home: both
   artifacts/examples/multi-vm-swarm.rs and
   kelir-cloud://artifacts/examples/multi-vm-swarm.rs exist — keep exactly
   one home`). One issue per offending pointer; roots that alias the same
   directory (same realpath) are one root with two names, not two homes — and
   every probe compares realpaths per file, so a probe that lands on the very
   file the pointer resolved to (a root declared as the project root itself,
   `"."`, pointing at repo files outside `cans/`; a workspace symlink at the
   same sub-path) is one home with two spellings, never a duplicate.
6. **Anchors** resolve against the external target's addressable vocabulary
   through the same shared path as an on-disk target — bullet nodes plus,
   for JSON/YAML/TOML, the full schematic dot-path vocabulary of issue #58,
   and, for `.txt`/code files, the heading/symbol vocabulary of issue #60
   (issue #49 parity). A miss is `refs.broken.anchor`, an ambiguous flat
   name is `refs.anchor.ambiguous`, an unparseable target is
   `refs.anchor.parse-error`, and a target with nothing addressable
   downgrades to the `refs.anchor.no-target` advisory.

**Terminal-target semantics (binding decision):** an inter-repo pointer is an
artifact-style TERMINAL target, one hop like `see: artifacts/final-chain.ts`
(issue #44):

- never a deep hop — it can never name a loaded spec file (its resolution
  domain is a different root), so it can never form an A→B→C spec chain and
  is never mesh-exiting;
- never promoted into the spec graph — the #54 promotion applies to files
  inside THIS repo's workspace only, so an external `.md` target is not
  loaded, its own `see:` refs are invisible to the graph, and §16 chaining
  never applies to it;
- never requires a back-pointer — the external repo is not owned by this
  check run; `--fix` writes nothing there (and `back_pointers` never applies
  to external targets in either direction).

### Pointer aliasing (issue #57)

A repeated `see:` target inside one file can be spelled ONCE and referenced
by short footnote-style aliases: a definitions block at the end of the file
(`- [1]: full/target.md#Anchor`, markdown link-reference shape), short
fully-counted uses on the nodes (`see: [1]`, `see: [hyper]`). Both forms
are legal at all times — full pointers never stop being valid; aliasing is
OPT-IN via `references.aliasing.enabled` (§18, default `false`).

**Grammar:** a definition line is a bullet of the exact shape
`- [name]: target[#anchor]` — the whole rest after `]:` is one pointer
token plus an optional anchor, trailing sentence punctuation stripped like
a `see:` token (§11/issue #48). Names are `[1]`-style all-digit numbers
(the footnote form) or lowercase `[a-z][a-z0-9_-]*` words; the markdown
footnote form `[^1]` and any other shape is NOT an alias (an illegal-name
definition is a line-numbered error, never a silent skip). A use is a
`see:` whose ENTIRE file token is the bracketed alias: `(see: [1])`
resolves (the closing `]` is structural and survives the §48 strip),
`see: [1]x` and `see [the appendix]` are NOT uses — they keep their exact
pre-#57 treatment (see-like-prose warning). A use may not carry its own
anchor (`see: [1]#X` is an error — anchors live on the definition), and a
definition target must be the FULL pointer (`- [2]: [1]` is an error — one
level of indirection, no chains).

**Definitions are file metadata, never outline nodes** (§11 skips the same
shape): wherever a definition line appears outside a code fence it is
excluded from node_length, sibling caps, depth, style and redundancy — the
90-char problem is not relocated from N use sites to one definition site.
A definition quoted inside a ``` fence is documentation, not a definition
(same fence rule as the parser). Use sites measure their WRITTEN spelling
(`label: see: [1]`): the structure/style/content/redundancy engines see
what the author wrote, so a long target plus a label no longer forces the
pointer onto a bare child node — while the REFS engine resolves the alias
BEFORE the graph is built (the use's `RefTarget` becomes the definition's
target, with an `alias` marker recording the spelling for `--fix`
diagnostics), so refs.total, deep hops, SCC/mesh classification, orphans,
back-pointers and every refs.broken verdict are IDENTICAL to the expanded
form's. `raw` keeps the written spelling — deep-hop advice quotes what is
on the line (`delete 01-near.md's "see: [m]" (line 1)`).

**Resolution = the full pointer's, exactly:** file existence, anchor match,
external roots (`kelir://…` definitions included, §55), traversal
containment, duplicate-home, `orphan_check`, self-reference, transient/
`_collab` classification — same error rules, same messages. A broken
DEFINITION fails the run even with zero uses (each zero-use definition is
verified through the same `checkRefs` machinery a full pointer would hit,
with the definition line as the location — and never counted in
`refs.total`: definitions are the spelling, uses are the refs). A
`--fix` anchor repair behind an alias targets the DEFINITION line — one
rewrite resolves every use.

**The alias-layer verdicts** (`category: refs`, grouped like every refs
family): undefined use → error `refs.alias.undefined` (dropped from the
graph — never also a see-like-prose warning); unused definition → warning
`refs.alias.unused`; aliasing disabled + any use or definition present →
error `refs.alias.disabled` (stranded syntax never silently passes — the
fix is `cans alias expand`); style violation (`style: numeric` + a named
use) → error `refs.alias.style` that still RESOLVES (the error is about
the spelling, not the target); a used alias below `min_uses` (uses + full
spellings of the same target, per file) → error `refs.alias.min_uses` at
the definition — indirection with no saving; anchored use → error
`refs.alias.bad-use`; duplicate definition / illegal name / alias-shaped
target → errors `refs.alias.duplicate` / `.bad-name` / `.bad-target` at
the definition site.

**Scope is the defining file only** (footnote-like): a use never sees
another file's definitions, inside the spec set or in the aux ref holders
(`_tasks/`, `_adr/` — a task file's aliases resolve against its own
definitions and earn its targets' ref-by marks; the `done` extra-referrer
pass resolves the archived task's aliases from its pre-archive source).
There are no global aliases in `_rules.yaml` in v1.

**Rendering:** `cans export` swaps each resolvable alias use for its full
pointer before serializing (config-independent — an export is a view of
the resolved graph for consumers that cannot see the workspace's
definitions); `cans budget` follows resolved refs like `cans check`, so
the two commands never disagree about what a file points at.

### Edge cases

| Case | Behavior |
|---|---|
| File not found (spec-shaped target: anchored, `.md`, path-like, `_`-service dir, numeric stem) | Broken ref error |
| Unresolved plain-word target (`see the runbook`) | `refs.prose` warning — see-like prose, not a spec pointer (issue #4) |
| Same-file anchor `see: #Sessions` | No ref minted — the §11 regex's file part can never start with `#` (round 6 sync) |
| Absolute or `../` target | Broken ref error — `file not found in workspace`; resolution and create advice never leave the workspace root (issue #10, round 6) |
| Trailing slash `see: auth/` | Resolves like `auth` / `auth/index.md` (issue #22) |
| Ref to an on-disk non-spec file (`artifacts/final-chain.ts`, `.txt`, `.yaml`) | Valid file-level ref — and TERMINAL for deep hops: 0 hops, it can never form an A→B→C spec chain (issues #44, #60) |
| Anchored ref into a text artifact (`artifacts/diagrams/data-flow.txt#creation-flow`) | Resolves against the file's section headings, §12 normalization — `CREATION FLOW` answers `#creation-flow` (issue #60) |
| Anchored ref into a code file (`artifacts/rules.ts#createRule`; `.rs`/`.py`/`.go` likewise) | Resolves against top-level symbols (exported functions, types, consts, modules), first §12 match in document order (issue #60) |
| Anchor matching nothing in a target that HAS a vocabulary | `refs.broken.anchor` error — the ONLY failure reported, never stacked under a spurious deep-hop error (issue #60) |
| Anchored ref into a schematic file (`artifacts/config.yaml#database.host`) | Leaf-path verification down to the key (issue #58): existing leaf/object address resolves; missing leaf is `refs.broken.anchor`; ambiguous flat name is `refs.anchor.ambiguous` |
| Anchored ref into a malformed schematic (invalid JSON/YAML/TOML, or beyond the supported subset) | `refs.anchor.parse-error` error at the pointer site — never warning-and-pass, never a broken-anchor false positive (issue #58) |
| Flat anchor matching several leaves (`#port` under `database` and `server`) | `refs.anchor.ambiguous` error listing the full paths, suggesting the dot form (issue #58) |
| Anchored ref into an unsupported format (`.ini`, `.jsonc`, `.xml`, `.csv`; an empty `.txt`) | `refs.anchor.no-target` advisory (issues #49, #60) — explicit, never silently verified |
| Ref to a missing non-spec target | Broken ref error — and still mesh-exiting in deep-hop terms (issue #44 never downgrades the broken-ref signal) |
| Extensionless flat target `see: 02-b` | Resolves flat-first to `02-b.md`, then `02-b/index.md` (§11, round 6) |
| Subfolder `.md` target `see: plugins/pty.md` | Promoted to a first-class spec file by `cans check` (issue #54); its own `see:` refs are ordinary edges — §5 deep-hop rules apply |
| External pointer `see: kelir-cloud://sub/path` (declared root, present, file exists) | Valid terminal ref — one hop like an artifact target; anchors resolve against the target's natural vocabulary (bullets, schematic key paths, text headings, code symbols), the same shared vocabulary as on-disk targets (issues #55, #49, #58, #60) |
| External pointer, undeclared root name | Broken ref error — `undeclared external root 'name'` (issue #55) |
| External pointer, declared root not checked out | ONE warning per referenced root; pointers into it unverified that run (issue #55) |
| External pointer, sub-path escaping the root (`root://../..`, symlink out) | Broken ref error — containment is lexical AND realpath; never resolves outside the declared root (issue #55, extends #10) |
| External pointer, missing file under a present root | Broken ref error under `orphan_check: true` (`file not found under external root 'name'`); verification off with `orphan_check: false` (issue #55) |
| External `.md` target | NOT promoted — terminal target only; its own `see:` refs are invisible (issue #55 decision 3) |
| `see: http://…` / `see: https://…` | URLs, never external-root pointers — exact pre-#55 treatment (broken ref error when unresolved) (issue #55) |
| Alias use `see: [1]` with aliasing on and `[1]` defined | Resolves to the definition's full target — identical refs-layer verdicts to the expanded spelling (issue #57) |
| Alias use, aliasing disabled | Error `refs.alias.disabled` — never a silent pass nor a prose downgrade; fix is `cans alias expand` (issue #57) |
| Alias use, `[name]` not defined in THIS file | Error `refs.alias.undefined` at the use line; the ref is dropped (issue #57) |
| Alias definition, never used | Warning `refs.alias.unused`; its target still verified (a broken definition fails the run) (issue #57) |
| Bracketed prose `see [the appendix]`, `see: [1]x` | NOT alias uses — pre-#57 see-like-prose warning (issue #57) |
| Anchored alias use `see: [1]#X` | Error `refs.alias.bad-use` — anchors live on the definition (issue #57) |
| Broken-ref suggestion | Never proposes creating an existing path (file or dir) or any path outside the workspace — names the missing spec file or says fix the target |
| Broken-anchor suggestion (issue #53) | Follows the node: one near match → `did you mean <file>#<canonical slug>?`; several → all named (top 3 + `…`); none → add-the-node advice that never invites renaming existing nodes |
| Lowercase anchor | Case-insensitive fallback |
| No anchor | Valid file-level ref |
| Ref to `_tasks/` | Warning (transient) |
| Ref to `_collab/` | Error (not spec) |
| Self-reference | Error |
| `see:` inside `see:` target (`see see:02-b.md`) | Broken ref error — the §11 regex captures `see:02-b.md` as one target token; a ref target is a filename, never a nested `see:` (round 6 sync) |
| Multiple `see:` on one line | Both parsed, both validated |

### Orphan detection
Files with no incoming AND no outgoing refs (except `00-overview.md`) → warning.

---

## 13. Redundancy Engine

Four layers. All deterministic. No ML.

**Layer 1 — Word frequency:** Normalize words (lowercase, strip punctuation, expand synonyms, filter stopwords). Flag words appearing in ≥ threshold nodes.

**Layer 2 — Phrase overlap:** Pairwise compare all bullet texts. Normalized word set overlap ≥ 70% → flag.

**Layer 3 — Fuzzy edit distance:** Levenshtein ≤ `redundancy.fuzzy_max_distance` (default 2) for words ≥ `redundancy.fuzzy_min_word_length` chars (default 5) not already synonym-matched → possible typo warning. Both are §18 parameters (issue #47): at ~7,500-node scale the old hardcoded pair produced 650+ false positives per file (content↔concept, public↔publish) — tune the knobs instead of losing the layer via `fuzzy: false`.

**Layer 4 — Cross-file canonicality:** Same concept at depth 0–1 in 2+ files without `see:` between them → flag.

**Ref targets are not content (issue #46):** layers 1–3 tokenize label words only — the whole `see:` span (keyword + file target + anchor) is stripped from node text before tokenization, using the same `REF_RE` + issue-#48 validation as the outline parser (`stripRefSyntax` in outline.ts). File-stem words therefore never dominate word frequency (`see: 10-sdk.md#primitives` contributes nothing) and thin pointers to the same target no longer phrase-overlap. Layer 4 deliberately compares the FULL node text, ref span included: it detects identical concepts verbatim, and stripping there would change duplicate-home semantics.

**Normalization:** lowercase → strip punctuation → synonym expansion (e.g., postgres/postgresql/pg → "postgres"). Stopwords filtered. Stopword/synonym list entries are coerced to strings at load time, so an unquoted numeric entry (`- 10` under `stopwords:`) filters the token `"10"` exactly like a quoted one (issue #42).

**Performance:** O(N) word freq, O(N²) phrase overlap (fine < 500 nodes), O(W²) edit distance (fine < 1000 words). Total < 50ms for 6-file project.

---

## 14. Style Engine

**Shared prefix detection:** Group siblings by first word. If group ≥ `force_nested_above` → flag "group under nested style."

**Unnecessary nesting:** Parent with ≤ `force_sibling_below` leaf children → flag "collapse to sibling style."

**Example:**
```
✗ 04-api.md:8 — 7 siblings share prefix "Returns". Group under nested style.
✗ 04-api.md:8 — "Returns" has 2 children. Collapse to sibling style.
```

---

## 15. Structure Engine

Checks: node length (min/max over a configurable unit and scope, issue #61), the multiline policy over wrapped prose continuation lines (issue #61), sibling count per parent, depth (min/max), single-child collapse, empty nodes.

**Example output:**
```
✗ 03-data.md:12 — Node too long (140 > 120). Split or move to file.
✗ 04-api.md:8 — "Returns" has exactly 1 child. Collapse.
⚠ 02-authentication.md:3 — "Sessions" has 14 children (max 12).
✗ 06-operations.md:20 — Depth 6 exceeds max 5. Flatten.
```

### Node length — granular, composable knobs (issue #61)

`structure.node_length: { min: 3, max: 90 }` alone was an all-or-nothing,
uncalibrated rule: one chars range lumping single-line node titles, wrapped
prose continuations and `see: ...` reference syntax into one ambiguous check.
The fix is granular knobs, additive and non-breaking — every member below is
OPTIONAL, a bare `{ min, max }` (the only form v0.10 and earlier accepted)
stays legal, and the defaults reproduce the v0.10 measurement (chars, title
scope, refs kept):

```yaml
structure:
  node_length:
    min: 3
    max: 90
    unit: words              # chars | words | tokens (default: chars)
    scope: title             # title | body | total (default: title)
    strip_references: true   # strip `see: ...` spans before measuring
    severity: error          # error | warn | off (default: warn)
  multiline:
    mode: allow              # allow | forbid | fold (default: allow)
    max_lines: 4             # ceiling on continuation lines (null = no cap)
    indent_aligned: true     # continuations must align with the bullet text
    severity: error          # error | warn | off (default: warn)
```

**Scope — what gets measured:** `title` (default) is the bullet's line,
exactly the node text every pre-#61 consumer saw. `body` is the node's
continuation lines only (§15 multiline, below); a node WITHOUT continuations
is not evaluated at all — no body, no verdict, never a zero-length phantom.
`total` is title + continuations folded with single spaces into one string.
`multiline.mode: fold` overrides the evaluation string to the folded text
REGARDLESS of `node_length.scope`: fold is the statement that the wrapped node
is one logical unit, so its length is the folded length.

**Units:** `chars` = string length. `words` = whitespace-split count.
`tokens` = `ceil(chars / 3.5)` — the canonical estimate
(`STRUCTURE_CHARS_PER_TOKEN`, matching `token_budget.estimate_chars_per_token`'s
default). A per-workspace `token_budget.estimate_chars_per_token` override
does NOT re-calibrate this estimator: node_length tokens always use the
canonical 3.5, so a "90-token" node means the same thing in every workspace.

**strip_references** strips `see: <target>` pointer spans from the evaluation
string before measuring — the same `stripRefSyntax` the redundancy engine
uses (§13), trailing-punctuation aware (issue #48), so
`(see effect.md#Audit-spine)` contributes nothing. Why: a node's length budget
should police the author's WORDS, not the filesystem's paths — a long target
plus a short label is a thin pointer, not a bloated node. Default false (the
v0.10 behavior measured the written spelling).

**severity — the band is decoupled from the finding (migration note):** v0.10
hardcoded node_length.max → error and node_length.min → warning. `severity`
replaces that pair and applies to BOTH findings. `warn` (default): min and
max findings are warnings — structured diagnostics, the exit-1 band, `ok`
untouched. `error`: both are errors — exit 2, `ok: false`. `off`: the whole
check is skipped (§18). A CI run that relied on over-max nodes failing the
build must set `severity: error` or run `cans check --structure=strict` (§20)
to restore fatal.

Rule keys stay the stable vocabulary: `structure.node_length.max` /
`structure.node_length.min` (issue #41, unchanged).

**Worked example — words + strip_references:**

```markdown
- Session rules: see 02-authentication.md#Sessions
```

Under `{ min: 3, unit: words, strip_references: true }` the evaluation string
strips to `Session rules:` → 2 words → `structure.node_length.min` fires.
With `strip_references: false` (the default) the same node measures 4 words
and passes — the knob, not the author, decided.

**Worked example — tokens:** a 350-char node under `{ max: 90, unit: tokens }`
measures `ceil(350 / 3.5)` = 100 tokens > 90 → `structure.node_length.max`.

### The multiline policy (`structure.multiline`, issue #61)

Wrapped prose continuation lines — non-bullet, non-blank lines indented
deeper than the owning node's bullet — were invisible to every engine: the
parser skipped them (§11), so nothing capped them and nothing measured them.
The parser now RECORDS them per node (`OutlineNode.continuations`), but they
still never join the outline tree: node counts, depth, sibling caps and every
pre-#61 consumer are unchanged. A continuation line is: non-bullet,
non-blank, non-fence, non-table, non-alias-definition, non-ref-by-comment,
indented strictly deeper than the most recent node's bullet — attached to
that node.

The policy block (§18: section absent or deleted → the whole multiline
policy is OFF — `mode: allow` with no cap and no alignment check is the
v0.10 non-policy):

- **mode `allow`** (default): continuations permitted, no mode finding. The
  `max_lines` ceiling and `indent_aligned` check still apply if configured.
- **mode `forbid`**: ANY continuation on a node is a policy violation →
  `structure.multiline.forbid`. The fix is folding the text into the bullet
  or moving it to prose outside the outline.
- **mode `fold`**: continuations permitted, and node_length evaluates the
  FOLDED title+continuation text regardless of `node_length.scope`.

- **max_lines**: ceiling on continuation lines per node →
  `structure.multiline.max_lines` when a node's continuation count exceeds
  it. null/absent → no cap.
- **indent_aligned**: continuation lines must start at the bullet's text
  column — the column where the title text begins, after the list marker —
  → `structure.multiline.indent_aligned` when a continuation starts
  elsewhere. Default false.
- **severity**: the issue band for ALL multiline findings, the same mapping
  as node_length's — `warn` (default) → warning, `error` → exit 2 / `ok:
  false`, `off` → the multiline checks are skipped (§18).

**Worked example — the wrapped node:**

```markdown
- Token budget: every reading plan respects the
  workspace default_limit and warns
  at the configured threshold
```

Under `{ mode: forbid }` → `structure.multiline.forbid`. Under
`{ max_lines: 2 }` no finding (2 ≤ 2); under `{ max_lines: 1 }` →
`structure.multiline.max_lines` (2 > 1). Under `node_length: { max: 70 }`
with `{ mode: fold }` the folded 106-char string trips
`structure.node_length.max` regardless of `scope` — with `scope: title`
alone the 45-char title passes and the continuation is invisible to
node_length.

**Worked example — indent alignment:**

```markdown
- Token budget: plans respect default_limit
  and warn at the threshold      ← aligned: starts at the text column (2)
     and stay under budget       ← misaligned: starts elsewhere
```

`indent_aligned: true` flags the deeper line;
`indent_aligned: false` (default) accepts both.

---

## 16. Overflow Engine (REMOVED — issue #56)

The overflow engine is GONE (issue #56). It used to flag code fences, tables
and over-long nodes (`overflow.max_node_chars`, `overflow.force_file_for`)
and push their content into referenced files — but those referenced files
were not spec nodes, so nothing capped their size: a limit that could be
routed around with one short `see:` pointer was not a limit. An agent that
wanted to write unbounded spec prose only had to move it one `see:` away.

The post-#56 model:

- Spec content lives in spec nodes, subject to the limits the author actually
  configured. `structure.node_length` (§15) is the single node-text-length
  limit — there is no second char budget, so the issue #45 same-value
  double-report (and its dedup) is structurally impossible.
- `overflow.*` keys in `_rules.yaml` reject as unrecognized under the strict
  §18 validation (issue #56) — a line-numbered config error, the check
  does not run.
- Subfolder `.md` files keep their issue #54 semantics unchanged: one a spec
  file references is PROMOTED to a first-class spec file (counted, fully
  checked, its `see:` refs ordinary graph edges); an UNREFERENCED one is
  plain non-spec content — invisible to every engine, like any non-spec
  repo file. The old §16 no-chaining rule was retired with the engine: a
  dead `see:` inside an unreferenced file is inert, and the fix for a file
  you want checked is to reference it from a spec file (promotion), not to
  extract content out of the outline.
- The `see:` refs system itself is untouched (§4/§12): referencing an
  artifact file (e.g. `see: artifacts/b.txt`) stays legal — it is an
  ordinary repo file reference, exactly like referencing any other
  non-spec material, and the refs engine only checks that the target
  exists.

---

## 17. Engine Execution Order

```
1. Parse all files → OutlineNode[][] (discovered root .md + any-depth
   index.md, plus issue #54's transitive promotion of referenced subfolder
   .md files — iterated to a fixpoint before anything else runs; alias
   definitions extracted as file metadata and every alias USE resolved to
   its full target BEFORE any consumer sees the nodes — issue #57, §12;
   wrapped prose continuation lines recorded per node — issue #61, §15 —
   never tree members)
2. Build RefGraph
3. checkStructure() (node_length granular knobs + the multiline policy,
   issue #61 — §15)
4. checkStyle()
5. checkRefs() (+ the issue #57 definition-level finish pass: unused-alias
   warnings, min_uses audit, zero-use-definition verification — a broken
   definition fails the run)
6. checkRedundancy() (all 4 layers)
7. Collect all Issue[]
8. Format output (JSON or text)
9. Exit code
```

Each engine is pure. No side effects. Only `--fix` triggers writes (back-pointers only).

---

## 18. Rules System (`_rules.yaml`)

Minimal YAML parser (~60 lines, no dependency). Supports nested objects, inline arrays `[a,b,c]`, inline objects `{min: 3, max: 120}`, arrays via `- item`.

**Loading:** Missing file = all defaults. Partial file = only listed keys override. Delete a key = check turns off. Invalid YAML = line-numbered error, exit 2 (the check could not run — error class, issue #41), reported as a **config error** (issue #43): rule `config.invalid` on file `_rules.yaml`, never as an engine finding — `--json` buckets it under `sections.config` (an additive section; every normal run keeps the six fixed section keys), and the human output prints the standalone `✗ invalid _rules.yaml: …` diagnosis with no report body.

**Strict validation (issue #56):** the legal surface is exactly the keys listed under Default rules below (plus the inert `slug:` documentation section, issue #53 — accepted so `cans init` output is valid, never read by engines). An unrecognized top-level or nested key — a typo like `node_lenght`/`max_hop`, or a removed one like `overflow.max_node_chars` — and any value outside its documented domain (wrong type, out-of-range or non-integer number, unknown enum member, malformed list/range shape, a contradictory `min > max`, an explicit empty value where none is documented) is the same line-numbered config error as invalid YAML: `line N — "section.key" must be …, got …`, exit 2, the check does not run. A missing or EMPTY file keeps all defaults; a file "listing only unknown keys" is no longer silently defaults — a typo'd key name must never read as "no such rule" while the author believes a limit is enforced.

The explicit empty value (`key:` with nothing under it, or the YAML null literals `null`/`~`) is legal exactly where its meaning is documented, and out-of-domain everywhere else: for scalar check keys it means the check is OFF (`style.prefer`/`force_nested_above`/`force_sibling_below`, `content.max_tbd_per_file`, `references.max_hops`, the redundancy thresholds, `token_budget.warn_threshold`; `redundancy.stopwords` = no filtering); for the parameters `references.mode` and `token_budget.enabled` it means the documented default. Range keys must stay mappings — write `{ min: 3, max: null }` (a null member = that side of the range is OFF) or delete the key; boolean switches take `false` as their off state; tuning parameters (`fuzzy_max_distance`, `fuzzy_min_word_length`, `default_limit`, `estimate_chars_per_token`, `synonyms`) keep their defaults when OMITTED, and an explicit empty value is a typo that rejects. Value domains: boolean switches are `true`/`false`; counts (`max_tbd_per_file`, `max_hops`, `default_limit`, range members) are integers `>= 0`; `depth` and the thresholds `word_frequency_threshold`/`cross_file_threshold`/`fuzzy_max_distance`/`fuzzy_min_word_length` are integers `>= 1`; ratios (`phrase_overlap_threshold`, `warn_threshold`, `estimate_chars_per_token`) are numbers `> 0` with no upper bound (a ratio above 1 can never fire — the historical disable spelling); `stopwords` is a list of words (numeric entries are coerced to strings, issue #42), `synonyms` a list of groups (`- [a, b]`) or a `head: [words]` mapping. The parser also honors `#` comments, quoted strings, and inline objects/arrays everywhere.

**Default rules:**

```yaml
structure:
  node_length: { min: 3, max: 120 }
  # issue #61 — granular node_length (§15). Every member optional; a bare
  # { min, max } — the only form v0.10 and earlier accepted — means
  # unit: chars / scope: title / strip_references: false / severity: warn.
  #   unit: chars | words | tokens — tokens = ceil(chars / 3.5), the
  #     canonical estimate; token_budget.estimate_chars_per_token does not
  #     re-calibrate it
  #   scope: title | body | total — title = the bullet line; body = the
  #     continuation lines only (nodes without continuations are not
  #     evaluated); total = title + continuations folded with single spaces
  #   strip_references: strip `see: <target>` spans before measuring (§13's
  #     stripRefSyntax, issue #48 trailing-punctuation aware)
  #   severity: error | warn | off — the band for BOTH min and max findings
  #     (default warn, replacing v0.10's hardcoded max: error / min:
  #     warning pair — severity: error or `cans check --structure=strict`
  #     restore fatal)
  # multiline:              # issue #61 — the wrapped-prose policy (§15).
  #   mode: allow           # Absent/deleted section → policy OFF.
  #   max_lines: 4          # ceiling on continuation lines (null = no cap)
  #   indent_aligned: true  # continuations must start at the bullet's text
  #   severity: warn        # column; severity: band for ALL multiline
  #                         # findings (error | warn | off, default warn)
  siblings: { min: 1, max: 12 }
  depth: { min: 1, max: 5 }
  single_child_collapse: true
  empty_nodes: false
style:
  prefer: sibling
  force_nested_above: 6
  force_sibling_below: 3
  shared_prefix_detection: true
content:
  tbd_allowed: true
  max_tbd_per_file: 5
references:
  mode: pointer
  back_pointers: true
  max_hops: 1
  orphan_check: true
  duplicate_home_check: true
  # external_roots: {}     # issue #55 — inter-repo pointer roots; default: none
  # aliasing:               # issue #57 — per-file pointer aliasing; default: disabled
  #   enabled: false
  #   scope: file
  #   style: both
  #   min_uses: 2
redundancy:
  enabled: true
  word_frequency_threshold: 4
  phrase_overlap_threshold: 0.7
  cross_file_threshold: 2
  fuzzy: true
  fuzzy_max_distance: 2
  fuzzy_min_word_length: 5
  stopwords: [the, a, an, of, to, in, for, and, or, with, must, shall, requires]
  synonyms:
    - [postgres, postgresql, pg]
    - [auth, authentication, sign-in, signin]
    - [api, endpoint, route]
    - [frontend, client, ui]
    - [db, database, storage]
token_budget:
  enabled: true
  default_limit: 4096
  estimate_chars_per_token: 3.5
  warn_threshold: 0.8
# issue #59 — output preferences (display switches, not checks):
# omitted keys keep these defaults; the section never joins the
# delete/override reconciliation.
output:
  slug_hints: false
```

`redundancy` parameter notes: `stopwords`/`synonyms` entries are coerced to strings at load time, so an unquoted numeric entry (`- 10` under `stopwords:`) filters the token `"10"` exactly like a quoted one — previously numeric entries were silently inert (issue #42). `fuzzy_max_distance` / `fuzzy_min_word_length` (issue #47) are parameters, not check switches: they tune layer 3 (max Levenshtein distance; minimum pairing word length) but keep their defaults (2 / 5) when deleted or omitted, and only `fuzzy` switches the layer off. Like every §18 parameter they count towards their section's coverage without ever being flipped OFF.

`references.external_roots` (issue #55) maps root names to paths for inter-repo `see:` pointers (`name://sub/path` — §12). It is a PARAMETER, not a check switch: absent/empty = no external roots (every `name://` target is an `undeclared external root` broken ref), and it never participates in the delete/override reconciliation. Rules:

- **Anchor:** the path resolves from the PROJECT root — the parent directory of the `cans/` workspace — so `"../kelir-cloud/cans"` names a sibling checkout. Any non-empty string is accepted (absolute paths included — the root is author-declared and only the POINTER sub-path is containment-guarded, §12).
- **Name grammar:** `^[a-z][a-z0-9_-]*$` — case-sensitive, no slashes, no dots.
- **Validation:** malformed entries are line-numbered config errors like every §18 key: a non-mapping `external_roots` (`line N — "references.external_roots" must be a mapping of root names to paths, got …`), an invalid name (`line N — invalid external root name "Kelir" — must match ^[a-z][a-z0-9_-]*$`), or a non-string/empty value (`line N — external root "kelir" must be a non-empty path string, got …`). A declared root that is not checked out locally is NOT a config error — it is a runtime warning (§12).
- Both spellings work (§12): declare the sibling's repo root and spell `name://cans/artifacts/…`, or declare its cans/ dir and spell `name://artifacts/…` — the sub-path is always relative to the declared root.

`references.aliasing` (issue #57) configures per-file pointer aliasing (§12): `enabled` (boolean, default `false` — aliasing is OPT-IN, and disabled plus any alias use or definition present is an error, never a silent pass), `scope` (`"file"` — the only legal value in v1; anything else is a line-numbered config error), `style` (`"numeric"` | `"named"` | `"both"`, default `both`; a use of the other style is an error that still resolves), `min_uses` (integer `>= 1`, default `2` — only targets referenced at least that many times per file, alias uses plus full spellings, are alias-eligible; a hand-written alias below the threshold is an error at the definition). It is a PARAMETER, not a check switch: absent/empty = the documented defaults, and it never participates in the delete/override reconciliation. Unknown sub-keys reject under the same strict #56 discipline as unknown top-level keys — a typo'd `enabledd` must never silently mean "no such knob" while the author believes aliasing is on. Partial blocks merge over the defaults (`aliasing: { enabled: true }` keeps `style: both`).

`structure.node_length` (issue #61) grows four optional members, measured, scoped and banded per §15: `unit` (`"chars"` | `"words"` | `"tokens"`, default `chars`), `scope` (`"title"` | `"body"` | `"total"`, default `title`), `strip_references` (boolean, default `false`), and `severity` (`"error"` | `"warn"` | `"off"`, default `warn`). A bare `{ min, max }` — the only form v0.10 and earlier accepted — is exactly the defaults, so every pre-#61 config stays legal; the one deliberate behavior change is the severity migration (over-max findings were hardcoded errors in v0.10 and are warnings under the default `warn` — restore fatal with `severity: error` or `cans check --structure=strict`, §20). `structure.multiline` (issue #61, new) is the wrapped-prose policy block of §15: absent, deleted or null (§18) → the whole policy is OFF; present, its members are `mode` (`"allow"` | `"forbid"` | `"fold"`, default `allow`), `max_lines` (a count — the §18 count domain, integers `>= 0`; null/absent → no cap), `indent_aligned` (boolean, default `false`) and `severity` (the same enum and meaning as node_length's, default `warn`). All of it is strictly validated like every §18 key — an unknown sub-key (a typo'd `severety`), a wrong type, or an unknown enum member is the line-numbered config error, and the `min > max` contradiction check covers the node_length range members unchanged.

`token_budget` values are validated by the budget commands (§26): `default_limit` must be a non-negative integer (the same validation `--limit` applies), `estimate_chars_per_token` a positive number, `enabled` a boolean. `enabled: false` observably disables budget planning — `budget read` / `budget write` refuse with a §19 error (exit 1); deleted or omitted it keeps its default `true` (it is a planning switch, not a check switch, so "delete a key = check turns off" does not turn budget planning off). Invalid values are §19 user-correctable errors naming the key and the file.

`output` (issue #59) is the output-preference section — display switches,
not checks. Its one key today: `slug_hints` (boolean, default **false**),
the per-workspace opt-in for the slug-hint info band (§12; the one-run
override is `cans check --hints`, and flag or config — either enables).
Strictly validated like every §18 key (a typo like `slug_hint`, a
non-boolean value, or an explicit empty value is the line-numbered config
error), but the section deliberately never participates in the
delete/override reconciliation: it is not a check surface, so listing
`output:` alone must never read as a curated config (which would flip every
unlisted engine off), and an omitted key simply keeps its documented
default — off.

---

## 19. Output System

**JSON is the primary machine interface. Text is the human view. Both derive from the same Result object.**

Every command builds a typed `CommandResult` subtype. `emit()` in `cli.ts` handles formatting + exit code. Commands never call `console.log` or `process.exit` directly.

| Flag | Output |
|---|---|
| (default) | Human-readable text |
| `--json` | Structured JSON for agents |

**Exit codes:** `0` = success. `1` = user-correctable failure. `2` = internal unexpected error (top-level catch only). Warnings never affect exit code unless `--strict`.

---

## 20. CLI Commands

```
cans init [--flat|--folders] [--bare] [--force] [--tool <name>]
cans check [--fix] [--yes] [--dry-run] [--strict] [--refs-only] [--structure[=strict]] [--no-redundancy] [--show <section>] [--hints] [file] [--json]
cans new adr <title>
cans new task <name>
cans done <name> [--allow-incomplete] [--skip-check] [--json]
cans status [--unclaimed] [--blocked] [--owners] [--json]
cans budget read <concept> [--limit <tokens>] [--change <name>] [--json]
cans budget write <concept> [--json]
cans import <format> <path> [--out <path>] [--dry-run] [--merge-strategy <s>] [--json]
cans export <format> [--from <path>] [--include-tasks] [--vault <path>] [--dry-run] [--json]
cans slug "<node text>" | <file>:<line>
cans alias expand|collapse [file] [--dry-run] [--json]
cans help
```

`check --yes` / `check --dry-run` (issue #53 Part 2.4) refine `--fix`'s
anchor-repair transaction: `--yes` applies the proposed repairs, `--dry-run`
previews every `--fix` change without writing. Both are usage errors without
`--fix` (and mutually exclusive with each other) — a flag that silently does
nothing is a typo hiding in plain sight.

`check --hints` (issue #59) opts the run into the slug-hint info band
(§12/§22). It is opt-in only — there is no `--no-hints` because off is the
default; the per-workspace spelling is `output.slug_hints: true` in
`_rules.yaml` (§18), and either path enables. `--hints` never changes a
verdict: ok, exit codes, `--strict` and the error/warning counts are
identical with the band on or off.

`check --structure` / `check --structure=strict` (issue #61) is the
structure-only gate — the inverse of `--refs-only`: the run reports
structure and content findings only, with style, refs and redundancy
suppressed (a workspace with broken refs and style noise still gets its
structure verdict). `--structure` enforces the DECLARED structure
severities (§15/§18); `--structure=strict` additionally promotes
structure-category warnings to errors IN PLACE before counting, so a
warn-severity node_length or multiline finding fails the run (exit 2,
`ok: false`) without touching the workspace's `_rules.yaml` — the CI
spelling of `severity: error`. `--structure` is the one flag that takes an
`=value` modifier; any value other than `strict` is a usage error, as are
`--structure` together with `--refs-only` (opposite gates) or with `--fix`
(a gate run never mutates files). The exit contract is unchanged:
`0` clean · `1` warnings · `2` errors, and plain `cans check` orchestration
is untouched.

### Command contract
- Each command is a single exported async function returning a `CommandResult` subtype.
- Commands parse only their own args.
- Commands do not import each other.
- Core logic in `core/`, not command files.
- `checkWorkspace()` shared internally by `check` and `done`.
- No framework. `process.argv` + switch (runtime-portable via the shim, issue #12).

### Arg parsing
Primitive. `--flag value` only. No `--flag=value`, no short flags, no combined flags. `process.argv` handles shell quoting.

---

## 21. `cans init`

Creates workspace skeleton. Idempotent. Skips existing files unless `--force`.

**Flags:** `--flat` (default), `--folders`, `--bare` (minimal), `--force`, `--tool <name>` (emits CLAUDE.md or .cursorrules from AGENTS.md).

**Refuses** if already inside a `cans/` directory.

**JSON result:**
```ts
{ ok, command: 'init', exitCode, created: string[], skipped: string[], root: string }
```

---

## 22. `cans check`

Runs all validation engines. The most-used command.

**Reads:** `_rules.yaml`, spec files, `_tasks/*.md` (light ref check only), `_adr/*.md` (ref check).
**Writes:** Nothing by default. `--fix` updates back-pointer comments; `--fix --yes` additionally repairs broken ref anchors (issue #53 Part 2.4, below). `--fix --dry-run` writes nothing at all.
**Excludes:** `_collab/`, `AGENTS.md`, `_rules.yaml` from structural checks.

**Structure gate (`--structure` / `--structure=strict`, issue #61):** the
inverse of `--refs-only` — structure and content findings only, style, refs
and redundancy suppressed, so a workspace with refs/style noise still gets
its structure verdict (§15/§20 for the full flag contract: `--structure`
enforces the declared structure severities; `=strict` promotes
structure-category warnings to errors in place before counting — exit 2,
`ok: false` — and the two usage errors, `--structure --refs-only` and
`--structure --fix`, reject before any workspace is read).

**External roots (issue #55):** with `references.external_roots` declared
(§18), `see: name://sub/path` pointers verify against the sibling checkouts
— `check` READS them (existence, containment, and — for anchored pointers —
the one target file's natural vocabulary: bullets, YAML keys, schematic key
paths, text headings, code symbols) and never writes anything there:
`--fix` writes spec files only, external targets earn no back-pointers, and
the external repo's own `see:` graph is never entered (terminal targets,
§12). A declared root that is not checked out is a warning, so CI that only
clones the spec repo keeps working. JSON output needs no new fields: external
pointers count in `refs.total`, their verdicts surface as issues with the
existing rule keys (`refs.broken.file` for undeclared/escape/missing,
`refs.external.absent` for the absent-root warning, `structure.duplicate_home`
for the cross-root duplicate home), and the absent-root warning lands in
`sections.refs` like every other refs warning.

**`--fix` scope (strictly limited):** Add/remove/rewrite `<!-- ref-by: ... -->` comments. Nothing else. No text changes, no node moves, no style fixes, no splits. (The one exception, gated behind `--fix --yes`: pure anchor-segment rewrites inside `see:` tokens — see the anchor-repair contract below. Node text is never touched.)

**`--fix` honors the [file] filter (issue #11):** with a filter active,
`--fix` rewrites ref-by comments ONLY in the filter-matched spec files —
never in other files (the ref graph itself stays global, so ref findings
still see the whole workspace). A referrer filter (e.g. `04-api.md`)
therefore leaves its targets' marks untouched that run; re-run with the
target's filter, or unfiltered, to write them. Unfiltered runs and
`cans done` rewrite every spec source as before. Stale back-pointer
warnings are dropped only for files the run actually rewrote — a stale
comment still on disk stays reported. The report names the rewritten files:
`backPointersUpdatedFiles` (sorted, JSON) and the human line
`--fix updated ref-by in: ...` (printed under References).

**`--fix` placement (issue #19):** an anchored ref's mark lands INLINE on the
referenced node's bullet line (`  - Sessions <!-- ref-by: ... -->`); a
file-level ref's mark stays the issue #6 form — a standalone comment line
right after the first root bullet outside any fence. Misplaced marks (e.g. a
root-level mark for a ref that points at `#Sessions`) are moved, not kept.

**`--fix` writes are byte-preserving (issue #21):** rewrites split the raw
source per line, keeping each line's own terminator. Replaced or stripped
comments never touch the line's `\r\n` / `\n`; a dropped comment line vanishes
with its terminator; only INSERTED comment lines mint a new terminator, which
is the file's DOMINANT EOL. A CRLF spec file stays fully CRLF through `--fix`,
an LF file stays fully LF — no mixed line endings, no normalization warnings.
(The parser is CRLF-tolerant by §45, so silence alone never proved integrity —
byte-level preservation does.) Anchor repairs share the same per-line
discipline (they only ever edit a line's text, never its terminator).

**`--fix` anchor repair (issue #53 Part 2.4):** a broken ref anchor is
repaired ONLY when ALL of these hold for the failing `see: <file>#<anchor>`:

1. **Target resolvable and parseable** — the same path checkRefs used
   (loaded workspace key, or the file on disk via the spec resolver; YAML
   mapping keys, and since issue #60 the text headings and code symbols of
   non-schematic artifacts, count as addressable candidates — the repair
   vocabulary mirrors the resolution vocabulary, issue #49). Missing or
   unparseable targets are skipped cleanly — they keep their own findings.
2. **Unambiguous intent** — EXACTLY ONE distinct node/key text in the target
   fuzzy-matches the failing anchor at ≥ the suggestion threshold (0.8,
   `nearSlugMatches` in `core/slug.ts`; synthetic placeholder nodes are
   excluded). Two lookalike siblings one letter apart = ambiguous = no
   repair, no proposal — the plain `refs.broken.anchor` error stays, never a
   coin flip. Duplicate node texts collapse to one candidate: they spell the
   same anchor, so the rewrite is still uniquely determined.
3. **Pure anchor substitution** — the fix replaces ONLY the anchor segment of
   the ref's `see:` token with the canonical slug (`anchorSlug`) of the
   matched node. Node text, the file token, everything else on the line, and
   the line's own EOL bytes survive verbatim. Lines inside ``` fences are
   never touched (fence guard). A rewrite the engine cannot express as a
   single anchor token (whitespace/`#` in the slug) or that would not resolve
   is skipped.

Transaction shape ("print each proposed rewrite first, require `--yes` to
commit"):

- **`cans check --fix`** — ref-by cleanup runs exactly as before, and anchor
  repairs are PROPOSED in the report only (`anchorFixes` with
  `applied:false`; the human line `--fix would rewrite: <file>:<line>
  #<from> → #<to>`, folded to `--fix would rewrite anchors in: <files> (N) —
  run with --yes to apply` when there are more than three). No anchor byte
  is written.
- **`cans check --fix --yes`** — ref-by cleanup PLUS the proposed anchor
  rewrites, applied. The report reflects the POST-fix state: applied repairs
  drop their `refs.broken.anchor` issues, `refs.broken` and the exit code
  improve accordingly (2 → 0/1 when every error was a repaired anchor), and
  the rebuilt ref graph feeds the ref-by phase in the SAME run — a repaired
  ref earns its target's inline mark immediately. The human report names the
  rewritten referrers: `--fix rewrote anchors in: <file> (N)`.
- **`cans check --fix --dry-run`** — NO writes at all: anchor repairs and
  ref-by rewrites are both previewed (`--fix would rewrite ref-by in: ...`;
  `anchorFixes` all `applied:false`; `dryRun:true` on the JSON marks that
  `backPointersUpdated*` describe WOULD-BE writes). Stale back-pointer
  warnings stay (nothing was written, so nothing was resolved).
- `--yes` or `--dry-run` without `--fix`, or both together, is a §20 usage
  error (exit 2).

The `[file]` filter scopes anchor proposals AND writes to the filter-matched
referrer files (issue #11 discipline, same as ref-by): a broken anchor in a
non-matched referrer is neither proposed nor rewritten; a matched referrer's
TARGET files keep their ref-by marks untouched that run. `cans done`'s fix
pass never sets `--yes` — it keeps today's ref-by-only behavior.

**Report sections (fixed order):** Structure → Style → References → Redundancy → Rules → Summary (the Overflow section was removed with its engine, issue #56). A check-level configuration failure (invalid `_rules.yaml`, issue #43) renders NONE of them: the human output is the standalone `✗` diagnosis alone (§37), and `--json` carries the single config entry under `sections.config` (rule `config.invalid`, file `_rules.yaml`) plus the top-level `error` field, with a zeroed summary.

**JSON result:**
```ts
{ ok, command: 'check', exitCode, files, nodes, maxDepth,
  refs: { total, broken, deepHops, hintCount? },   // broken = broken ref targets + broken anchors (round 6);
                                                   // hintCount (issue #59) = refs.slug.hint items the workspace
                                                   // holds — present only when > 0, the opt-in discoverability
                                                   // signal while the info band is off by default
  backPointers: { total, current, stale },
  issues: Issue[], errorCount, warningCount, infoCount?, backPointersUpdated,
  backPointersUpdatedFiles,
  anchorFixes?,   // issue #53 (Part 2.4): [{file, line, from, to, applied}] — present on --fix runs only
  dryRun?         // issue #53 (Part 2.4): true when --fix --dry-run previewed the run
}
```
`backPointersUpdatedFiles`: sorted spec-relative paths of the files `--fix`
actually rewrote (issue #11) — empty without `--fix` or when nothing needed
a write; with a `[file]` filter only matching files can ever appear there.
Under `--dry-run` the same fields describe the WOULD-BE writes (`dryRun: true`
marks the distinction; no byte changes on disk).

**Info notes (issue #53 Part 1.5; opt-in since issue #59):** `infoCount`
(optional, additive) counts level:'info' hints present in the result —
`refs.slug.hint` slug-safety notes naming a node's exact canonical anchor
when its text contains slug-confusable characters. The band is OPT-IN:
without `--hints` (or `output.slug_hints: true`, §18) the result carries NO
info items at all — human output prints no hint group, no `ℹ N notes`
count and no `more → --show refs` pointer, and `--json` sections carry no
info entries; only `refs.hintCount` (above) records that the hints exist.
With the band on, each `--json` hint entry carries `level: "info"` while
`counts` stays `{errors, warnings}`; info never affects `ok`, exit codes or
`--strict`. `--show refs` expands findings only — it never implies hints.

---

## 23. `cans new adr <title>` / `cans new task <name>`

**ADR:** Creates `_adr/NNN-<slug>.md` from template. Auto-increments NNN.

**Task:** Creates `_tasks/<slug>.md` from template.

Slug normalization: lowercase, strip quotes, non-alphanumeric → hyphen, trim hyphens. Reject empty slug.

No git operations. No branch creation.

**JSON result:**
```ts
{ ok, command: 'new', exitCode, change: string, file: string }
```

---

## 23a. `cans slug`

Prints the canonical anchor fragment for a node — the exact spelling a
`see:` ref's `#anchor` must use (issue #53, Part 1.2). The fragment comes
from `core/slug.ts` `anchorSlug` (Option A, published in
`_rules.yaml#slug`): every dash-family character, `_`, and whitespace run
collapses to one `-`; all other characters are verbatim, case preserved.
`Layer 1 — C authorizer` → `Layer-1-C-authorizer`. Before this command
authors reverse-engineered that mapping by trial and error — every miss
minted a broken ref.

**Text mode:** `cans slug "<node text>"` — all positional args joined with
a single space (the `new` convention), so quoting is optional:
`cans slug Layer 1 — C authorizer` and the quoted spelling print the same
fragment. No workspace needed. Empty or separator-only input is rejected
with the `new`-style empty-slug diagnosis.

**File:line mode:** `cans slug <file>:<line>` (e.g.
`cans slug 02-authentication.md:14`, folder spellings like
`04-api/request-schema.md:3` included) — resolves the workspace, parses
the file (§12 flat-then-folder resolution, containment-guarded), and prints
the slug of the node whose bullet sits EXACTLY on that line; `nodeText` in
the JSON result names the node found. This is the issue's
`--explain-anchor` ask, delivered as a query command instead of a flag on
`check` (which stays a pure validator). A non-node line is a §37 error
naming the file's node lines — the full list when few, `first..last (N
nodes)` when many; synthetic `(table)`/`(code fence)` placeholder lines
are not node lines (issue #8). Requires a workspace.

**Disambiguation** (`parseSlugTarget`, exported for tests): the joined
input is a file:line target iff it ends in `.md:<line>`. An `.md:` tail
whose line part is not a clean 1-based integer (`0`, `-14`, `abc`, `014`)
is a malformed-line-number error — never silently slugged as prose.

**Output:** the BARE fragment on its own stdout line — shell-composable:
`see: 02-authentication.md#$(cans slug "Layer 1 — C authorizer")`.

**JSON result:**
```ts
{ ok, command: 'slug', exitCode, input: string, slug: string, nodeText?: string }
```

---

## 23b. `cans alias expand|collapse [file]`

The programmatic switch between full-pointer form and aliased form (issue
#57) — migrating a corpus by hand is error-prone, and turning aliasing off
later would otherwise strand aliased files. The transforms are pure
byte-level line surgery in `core/alias.ts` (`expandAliases` /
`collapseAliases`); the command resolves the workspace, loads the rules,
discovers the check file set (spec files + the aux ref holders `_tasks/`,
`_adr/` — so disabling aliasing later has a complete expand path) and
writes.

- **`expand`** — alias uses become full targets, definitions are removed.
Always allowed (even under a disabled config — it IS the migration path);
unused definitions are simply removed (expand is the cleanup path for dead
weight).
- **`collapse`** — repeated full targets become definitions plus short
uses, following the `_rules.yaml` aliasing config: only targets referenced
`>= min_uses` times in the file (full spellings + existing alias uses) are
eligible, one-offs stay full pointers; numeric style numbers NEW aliases
after the highest existing number in first-use order (`[1]`, `[2]`, … —
deterministic); named style derives a name from the target (the anchor, else
the file stem with numeric prefix stripped, sanitized into the name grammar,
`-2`/`-3` suffixed on collision). Existing definitions are KEPT in place and
reused — no renumbering churn; only new targets get new names appended to
the (continued or fresh, after exactly one blank separator) definitions
block at EOF. REFUSES outright under `references.aliasing.enabled: false`
(§19 could-not-run, exit 2): collapse would mint files the checker rejects.

**Contract for both directions** (issue #57): lossless for non-pointer text
(only `see:` tokens and alias definition lines change; prose, labels, node
order and structure untouched; CRLF files stay CRLF); idempotent (a second
run is a byte-identical no-op — `Nothing to expand/collapse`); and SAFE
FAILURES — a file with an undefined or anchored alias use, a duplicate /
illegal / alias-targeting definition, a style conflict with the config, a
`min_uses` violation an existing alias perpetrates, or an unterminated code
fence at EOF is REFUSED: left byte-identical, each problem named with its
`file:line`, exit 1 (§19 user-correctable file content) while the other
files are still processed. Graph-identity is the round-trip guarantee:
`expand(collapse(f))` is `f` in full-pointer form and
`collapse(expand(f))` is `f` in aliased form, and `cans check`'s refs layer
is identical on both (§12).

**Flags:** `--dry-run` (preview, no byte written), `--json`, optional
`[file]` filter (check's UX — `cans alias collapse 07-lifecycle.md`).
Plain runs WRITE (the import/export migration-command pattern).

**JSON result:**
```ts
{ ok, command: 'alias', exitCode, direction: 'expand'|'collapse',
  results: Array<{ file, changed, usesRewritten, definitionsRemoved,
                    definitionsAdded, definitionsKept, charsSaved, problems: string[] }>,
  dryRun?: true, error?: string }
```

---

## 24. `cans done <name>`

Archives a completed task file after gates pass. **No merge logic.** Agent edits specs directly.

**Gate rules (checked in order):**
1. Human gates (`← @human` unchecked) → ALWAYS blocks. Never skippable.
2. All tasks checked → blocks unless `--allow-incomplete`.
3. Final `cans check` passes → blocks unless `--skip-check`.

**Action:** Moves `_tasks/<name>.md` → `_tasks/_archive/YYYY-MM-DD-<name>.md`. Updates back-pointers if needed.

**Does NOT:** merge concepts, create git commits, call LLMs, auto-resolve conflicts, parse delta blocks.

**JSON result:**
```ts
{ ok, command: 'done', exitCode, change,
  gates: { human, humanOpen, tasks, tasksOpen },
  archived: string | null, backPointersUpdated }
```

---

## 25. `cans status`

Read-only workspace summary. Never modifies.

**Includes:** spec file count, active tasks, archived tasks, ADR count, unclaimed tasks, blocked gates, owners, per-task progress, conflict count.

**Conflict detection:** Lines matching `/status:\s*unresolved/i` in `_collab/conflicts.md`.

Always exits 0 if it can print. Only exits 1 if `cans/` missing.

**JSON result:**
```ts
{ ok, command: 'status', exitCode, specFiles, activeTasks, archivedTasks, adrCount,
  tasks: { total, done, unclaimed, blocked },
  owners: Record<string, { tasks, done }>,
  taskFiles: [{ name, tasksDone, tasksTotal, gatesDone, gatesTotal, blocked }],
  conflicts: number }
```

---

## 26. `cans budget`

Token budget planner. Deterministic. No LLM.

### `budget read <concept>`
1. Normalize concept. Find matching nodes.
2. Pick canonical home: highest child count → lowest depth → earliest file sort.
3. Score all files: canonical home (100), active task mentioning (80), back-pointer (60), forward ref (40), mentions concept (20), no connection (0). A **back-pointer** is a file holding a `see:` ref into the canonical home; a **forward ref** is a file the canonical home points to (the target of a `see:` ref made from the home file). A file matching several tiers keeps the highest (back-pointer 60 beats forward ref 40 beats mentions concept 20).
4. Sort by score. Pack best-effort (issues #15/#16): take each item in order while it fits under the token limit. An item that does not fit is skipped (listed in `skipped`) — it does NOT cut the walk, so cheaper lower-scored items that still fit are planned. `skipped` lists every file not in the plan (didn't fit, or no connection to the concept). Budget scope is the spec files plus the active `_tasks/*.md` files (AGENTS.md is out of scope, §22) — so a task file with no connection to the concept is listed in `skipped`, never invisible.
5. Print plan.

**Empty plan (§19/§37, issues #15/#16):** if the plan is empty while a truly unbounded plan for the same concept is non-empty, the concept matches — the limit is simply below every matching item. The user-correctable failure (exit 1) names the actual source of the limit and the top-priority item that busts it, never a spelling problem:

```
✗ plan empty: --limit 10 is below the top-priority item 01-auth.md (32 tok) — raise the limit
✗ plan empty: token_budget.default_limit (10) in _rules.yaml is below the top-priority item 01-auth.md (32 tok) — raise default_limit or pass --limit
```

Both limit sources (`--limit` flag and `token_budget.default_limit`) get the same diagnosis — and the same VALUE validation (see **Config** below): non-numeric, negative or fractional limit values are rejected with `✗ invalid …` (exit 1) whichever source they came from, and the validation runs even when a valid `--limit` overrides the config value. A concept that matches nothing is still reported as `no files match concept "…" — check spelling or run \`cans status\``. A limit that can afford some but not all matching items is a SUCCESS: the partial plan is printed with the unaffordable files in `skipped`.

### `budget write <concept>`
1. Find canonical home.
2. CAN edit: canonical home + active task files mentioning concept.
3. MUST NOT edit: files with only `see:` references.
4. List back-pointers that need updating if node text changes.

### `budget read --change <name>`
Centered on a task file. Add its refs (1 hop). Reject deep-hop expansion. Apply budget.

**Token estimate:** `Math.ceil(text.length / charsPerToken)`. Default 3.5 chars/token.

**Config (§18 `token_budget`):** both budget commands validate the `token_budget` values at load — the same validation the `--limit` flag applies (issue #15 flag≡config parity). Invalid values are §19 user-correctable errors (exit 1, `ok:false`) that name the key and the file, never silently-ignored dead config:

- `default_limit` — a non-negative integer. 0 is a degenerate limit that affords nothing (the truthful empty-plan diagnosis names it, exactly like `--limit 0`); non-numeric, negative or fractional values fail: `✗ invalid token_budget.default_limit "abc" in _rules.yaml — pass a positive integer`
- `estimate_chars_per_token` — a positive number (default 3.5). 0 or less would make every estimate `Infinity` and no limit could fix that, so it fails instead: `✗ invalid token_budget.estimate_chars_per_token "0" in _rules.yaml — pass a positive number`
- `enabled` — a boolean. `false` observably disables budget planning: `budget read` and `budget write` refuse (exit 1): `✗ budget planning disabled: token_budget.enabled is false in _rules.yaml — set it to true (or delete the key) to plan budgets`. Deleted or omitted, `enabled` keeps its default `true` — it is a planning switch, not a check switch, so §18's "delete a key = check turns off" does not apply to it. A non-boolean value fails: `✗ invalid token_budget.enabled "false" in _rules.yaml — pass true or false`

**JSON result (read):**
```ts
{ ok, command: 'budget-read', exitCode, concept,
  plan: [{ file, anchor, reason, score, estTokens }],
  skipped: string[], totalTokens, budgetLimit, usagePercent }
```

**JSON result (write):**
```ts
{ ok, command: 'budget-write', exitCode, concept,
  canEdit: [{ file, anchor, reason }],
  mustNotEdit: [{ file, reason }],
  backPointersToUpdate: [{ fromFile, fromLine, toFile }] }
```

---

## 27. `cans import <format> <path>`

**Formats:** `opml`, `dynalist` (alias for opml), `logseq`, `obsidian`.

**Merge strategies:** `cans-wins` (default, only adds new nodes), `import-wins` (overwrites on conflict), `ask` (report conflicts, don't merge).

**Import rules:** Preserve hierarchy. Convert bullets to `- `. Convert tasks. Strip app metadata. Preserve real identifiers. Convert `[[wiki-links]]` → `see:`. Strip YAML frontmatter. Extract code blocks → separate extracted files (referenced via `see:`). Do NOT invent refs. Do NOT deduplicate. Let `cans check` report issues after.

**Merge matching (conflict semantics):** when a target spec already exists, each imported node is matched in order: (1) exact normalized text; (2) near-match — word overlap ≥ 0.75 against any sibling under the same parent; (3) positional counterpart — overlap ≥ 0.5 on the same sibling slot; (4) diverged-sibling guard — the same concept reworded, by either signal: (a) *TBD-fill*: the existing node is unfinished (its trailing significant token is the `TBD` placeholder) and the incoming node repeats the existing node's concept head — the existing text minus the trailing TBD — verbatim as its leading words ("Sessions: TBD" → "Sessions: extended - changed externally"); or (b) *leading stem + overlap*: the first two significant words are identical ("sign up" == "sign up") — or the first word matches by prefix, one word being a ≥ 4-character prefix of the other's first word ("auth" ≈ "authentication") — AND corroboration: token-Jaccard ≥ 0.3, or at least half of the EXISTING sibling's distinct significant tokens survive in the import (shared ÷ |existing tokens| ≥ 0.5; a first-word prefix match is its own corroboration). The stem — not an overlap floor — is the discriminator: "Sign up: TBD" vs "Sign in: TBD" has Jaccard 0.50 yet is a genuinely distinct sibling (the concept heads differ), while "Sign up: DONE - changed externally" (Jaccard 0.33) and "Storage: TBD" → "Storage: postgres with PITR" (TBD fill) are the same concepts reworded. Root children are siblings too: the guard applies identically at the top level, and the merge target for a whole file falls back to the spec file whose ROOT guard-matches the imported root — so a diverged parent ("Authentication" reworded to "Auth and identity", on either side) records a conflict and its subtree merges under the matched parent, never a silently duplicated second root or forked duplicate file. A layer-2/3/4 hit with differing text is a conflict recorded in `conflicts[]` and resolved by the merge strategy — never a silent duplicate sibling appended. Logseq/Obsidian sources are normalized from their flat indent-annotated parse into a tree before the merge walk, so the sibling layers match against the real parent's children.

**JSON result:**
```ts
{ ok, command: 'import', exitCode, format, source,
  newFiles: string[], merged: string[],
  conflicts: [{ file, line, cansVersion, importVersion, resolution }] }
```

---

## 28. `cans export <format>`

**Formats:** `opml`, `dynalist`, `logseq`, `obsidian`, `all`.

**Transformations:**

| CANS | Dynalist/OPML | Logseq | Obsidian |
|---|---|---|---|
| `see: X.md#Y` | `→ X.md#Y` | `[[X/Y]]` | `[[X#Y]]` |
| `← agent-1` | `[agent-1]` | `agent-1:: assigned` | `🤖 agent-1` |
| `← @human` | `⏳ Human` | `⏳ Human` | `⏳ Human` |
| `- [ ] task` | `- [ ] task` | `- TODO task` | `- [ ] task` |

**Rules:** Preserve indentation, checkboxes, owner arrows. Do NOT follow refs. Do NOT inline referenced content. Exclude `_collab/`, `_adr/_archive/`, `_rules.yaml`, `AGENTS.md`.

**JSON result:**
```ts
{ ok, command: 'export', exitCode, format, outputDir, filesExported }
```

---

## 29. ADR Format

```markdown
# ADR-001: CSS Variables over Tailwind
- Status: accepted
- Date: 2025-01-20
- Decided by: @human
- Supersedes: none
- Context
  - Dark mode needed
  - Zero runtime cost required
  - Team unfamiliar with Tailwind
- Decision
  - Use CSS custom properties
  - Toggle via class on <html>
  - Persist in localStorage
- Alternatives considered
  - Tailwind dark: variant
    - Rejected: runtime cost, learning curve
  - Styled-components
    - Rejected: bundle size
- Consequences
  - All colors become variables
  - No FOUC constraint
  - see 05-frontend.md#Theme
- Review
  - [x] Spec impact approved ← @human
  - [x] Design approved ← agent-1
```

**ADRs are permanent records.** They live in `_adr/`. They reference specs via `see:`. They have `← @human` review gates. They are NOT transient.

`_collab/decisions.md` is the append-only index:
```markdown
- 2025-01-20: CSS variables over Tailwind → see _adr/001-css-variables-over-tailwind.md
- 2025-01-22: PostgreSQL over MySQL → see _adr/002-postgres-over-mysql.md
```

---

## 30. Task File Format

```markdown
# add-dark-mode
- Owner: agent-1
- ADR: _adr/001-css-variables-over-tailwind.md
- Tasks
  - [x] Add ThemeContext provider ← agent-1
  - [ ] Create toggle component ← agent-1
  - [ ] Migrate colors to variables ← agent-3
  - [ ] Test: no FOUC ← agent-2
- Blocked
  - Waiting on agent-3 finishing color audit
- Handoff
  - Context: CSS variables, not Tailwind
  - Constraint: zero flash on load
```

**Tasks reference the ADR. The ADR references the spec. The spec is the truth.** Tasks are transient. Archived on `cans done`.

---

## 31. Converter Internals

### Shared utilities (~40 lines)
- `parseIndent()`: tabs → 2 spaces, floor divide by 2.
- `parseCheckbox()`: handles `- [ ]`, `- [x]`, `TODO`, `DONE`, `DOING`.
- `stripMetadata()`: removes Logseq `::` properties, Dynalist `^block-ids`, Obsidian `#tags`, bold/italic markers.
- `serializeToCans()`: ExternalNode tree → CANS markdown string.
- `parseFromCans()`: CANS markdown → ExternalNode tree.

### OPML converter
Regex-based XML parse (no XML parser dependency). Handles `<outline text="..." _note="..."/>` and nested `<outline>` tags. Entity encode/decode for `&`, `<`, `>`, `"`, `'`.

### Logseq converter
Strips `((block-refs))`, `key:: value` properties. Converts `[[wiki-links]]` → `see:`. Converts `TODO/DONE` → checkboxes.

### Obsidian converter
Strips YAML frontmatter. Converts `[[wiki-links]]` and `![[embeds]]` → `see:`. Strips `#tags`. Handles callout markers (`> [!note]`). Preserves native checkboxes.

---

## 32. Filesystem Helpers

- `readText()` / `writeText()` / `globFiles()` / `argv()` / `dirFromUrl()`: **runtime shim** (`core/runtime.ts`, issue #12) — Bun fast path (`Bun.file`/`Bun.write`/`Bun.Glob`), `node:` builtins fallback. The ONLY module allowed to touch Bun APIs.
- `exists()`: `fs.existsSync`
- `dirExists()`: `fs.stat` + isDirectory
- `mkdirp()`: recursive directory creation
- `discoverSpecFiles()`: flat `*.md` + folder `index.md` at ANY depth (issue #54), excluding `_` prefixed and `AGENTS.md` at every level; `/`-joined relative keys
- `promotableSpecKey()`: issue #54 — maps a raw `see:` target to the relative key of a promotable subfolder `.md` (§11 flat-first resolution, `.md`-only, inside-root, no `_`/tool-artifact segments)
- `discoverActiveTasks()`: `_tasks/*.md`
- `discoverArchivedTasks()`: `_tasks/_archive/*.md`
- `discoverAdrs()`: `_adr/*.md` excluding `_template.md`

---

## 33. AGENTS.md Template (~800 tokens)

```markdown
# CANS Agent Instructions
You are working in a CANS project. Specs live in `cans/`.

## Reading
- Find the concept → read its canonical home → follow `see:` references
- References are ONE hop only. Do NOT follow `see:` inside the referenced file.
- Read surrounding hierarchy for context, not just the leaf node
- Constraints live near the concept they govern

## Writing
- One canonical home per concept. Reference, don't duplicate.
- Use the project's existing vocabulary and structure
- Preserve real identifiers (paths, endpoints, names)
- Mark unknowns as TBD, don't guess
- If a level adds no meaning, don't create it
- NEVER create a deep hop: if A references B, B must not contain see: to C.

## Changing
- Find canonical home → update there → check references → verify affected code
- Never silently resolve conflicts. Report them.
- Smallest correct change. Don't restructure what isn't broken.

## ADRs
- Decisions get an ADR: `cans new adr <title>`
- ADRs are permanent. Specs are the truth. ADRs record WHY.

## Tasks
- Implementation tracking: `cans new task <name>`
- Tasks reference the ADR. Agent edits specs directly.
- When done: `cans done <name>`

## Collaboration
- One owner per task file. Claim before editing.
- If a task has ← another-agent, do not edit it.
- If you disagree with a spec, add to _collab/conflicts.md. Never overwrite.

## Token Budget
- Before reading: `cans budget read "<concept>" --json`
- Read ONLY files listed in the plan, in order
- Before writing: `cans budget write "<concept>" --json`
- Only edit files in the "canEdit" section

## Machine Output
- Use `--json` flag for structured output
- Parse JSON programmatically. Do NOT parse human text.
- All JSON has `ok: boolean` and `exitCode: number` at top level.

## Quality check before finalizing
- Is each concept in the right place?
- Does indentation add meaning?
- Can anything be simpler?
- Did I duplicate an authoritative rule?
- Did I invent anything?
- Is ambiguity visible?
- Did I create a deep hop reference? (FORBIDDEN)
```

---

## 34. Test Fixtures — Input

### `flat-project/02-authentication.md`
```markdown
- Authentication <!-- ref-by: 04-api.md, 05-frontend.md -->
  - Sign up
    - Email
      - Requires verification
      - Creates user account
    - Google
      - Uses provider verification
  - Sessions
    - Expire after 24 hours
    - Refresh allowed for 30 days
  - Passwords
    - Never stored in plaintext
    - Minimum 12 characters
```

### `flat-project/04-api.md`
```markdown
- API
  - Authentication
    - Session rules: see 02-authentication.md#Sessions
    - Requires Bearer token
  - POST /users
    - Returns 201 on success
    - Returns 409 for duplicate email
    - Returns 422 for validation error
  - GET /users/:id
    - Returns 200 with user object
    - Returns 404 if not found
  - Rate limiting
    - 100 requests per minute per IP
    - 429 when exceeded
```

### `flat-project/06-operations.md`
```markdown
- Operations
  - Data protection
    - Production database: see 03-data.md
    - Encrypted at rest
    - Encrypted in transit
  - Backups
    - Every 6 hours
    - Retention: 30 days
  - Deployment
    - Draft → Tested → Approved → Released
    - Rollback → Tested
```

### `flat-project/_tasks/add-dark-mode.md`
```markdown
# add-dark-mode
- Owner: agent-1
- ADR: _adr/001-css-variables-over-tailwind.md
- Tasks
  - [x] Add ThemeContext provider ← agent-1
  - [ ] Create toggle component ← agent-1
  - [ ] Migrate colors to variables ← agent-3
  - [ ] Test: no FOUC ← agent-2
- Review
  - [ ] Spec approved ← @human
  - [x] Design approved ← agent-1
- Handoff
  - Context: CSS variables, not Tailwind. System preference default.
  - Constraint: zero flash on load
```

### `deep-hop-project/`

**04-api.md:**
```markdown
- API
  - Authentication
    - Session rules: see 02-authentication.md#Sessions
```

**02-authentication.md (THE VIOLATION):**
```markdown
- Sessions
  - Expire after 24 hours
  - Storage rules: see 06-operations.md#Data-protection
```

**06-operations.md:**
```markdown
- Data protection
  - Encrypted at rest
  - Encrypted in transit
```

Expected: `✗ DEEP HOP: 04-api.md → 02-authentication.md → 06-operations.md`

### `broken-refs-project/04-api.md`
```markdown
- API
  - Auth rules: see 02-auth.md#Sessions
  - Data rules: see 99-nonexistent.md
  - Self ref: see 04-api.md
```

Expected: 2 broken refs + 1 self-reference error.

### `redundancy-project/02-authentication.md`
```markdown
- Authentication
  - Sign up with email
  - Sign up with Google
  - Authentication required for dashboard
  - Authentication tokens expire after 24 hours
```

### `redundancy-project/04-api.md`
```markdown
- API
  - Authentication header required
  - Authentication tokens validated per request
  - Session authentication: see 02-authentication.md
```

Expected: "authentication" × 6 nodes warning + phrase overlap warning.

### `style-project/04-api-sibling.md`
```markdown
- API
  - POST /users
    - Returns
      - 201 on success
      - 409 for duplicate email
```

With `force_sibling_below: 3` → "Collapse to sibling style."

### `style-project/04-api-nested.md`
```markdown
- API
  - POST /users
    - Returns 201 on success
    - Returns 409 for duplicate email
    - Returns 422 for validation error
    - Returns 429 for rate limit
    - Returns 500 for server error
    - Returns 502 for upstream timeout
    - Returns 503 for maintenance
```

With `force_nested_above: 6` → "Group under nested style."

### `import-fixtures/dynalist-export.opml`
```xml
<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
<head><title>Project Backlog</title></head>
<body>
  <outline text="Authentication">
    <outline text="Sign up">
      <outline text="Email"/>
      <outline text="Google"/>
    </outline>
    <outline text="Sessions">
      <outline text="Expire after 24 hours"/>
    </outline>
  </outline>
  <outline text="Dashboard">
    <outline text="Requires verified account"/>
  </outline>
</body>
</opml>
```

### `import-fixtures/logseq-page.md`
```markdown
- TODO Implement auth flow
- [[02-authentication#Sessions]] expire after 24 hours
- DONE Add Google OAuth
  - agent-1:: assigned
- Token validation
  - id:: ((block-ref-123))
```

### `import-fixtures/obsidian-note.md`
```markdown
---
title: API Design
tags: [api, backend]
---
- API
  - [[02-authentication#Sessions|Session rules]]
  - POST /users
    - Returns 201
  - ![[error-codes]]
  - [ ] Implement rate limiting
> [!note] Decision
> Use token bucket algorithm
```

### `budget-project/02-authentication.md`
```markdown
- Authentication
  - Sessions
    - Expire after 24 hours
    - Refresh allowed for 30 days
  - Sign up
    - Email
    - Google
  - Passwords
    - Never stored in plaintext
```

### `budget-project/04-api.md`
```markdown
- API
  - Authentication
    - Session rules: see 02-authentication.md#Sessions
  - POST /users
    - Returns 201
```

### `budget-project/06-operations.md`
```markdown
- Operations
  - Data protection
    - Session storage: see 02-authentication.md#Sessions
    - Encrypted at rest
```

---

## 35. Test Fixtures — JSON Output

### `output/check-clean.json`
```json
{
  "ok": true, "command": "check", "exitCode": 0,
  "files": 6, "nodes": 84, "maxDepth": 4,
  "refs": { "total": 12, "broken": 0, "deepHops": 0 },
  "backPointers": { "total": 12, "current": 12, "stale": 0 },
  "issues": [], "errorCount": 0, "warningCount": 0, "backPointersUpdated": 0
}
```

### `output/check-errors.json`
```json
{
  "ok": false, "command": "check", "exitCode": 1,
  "files": 6, "nodes": 84, "maxDepth": 4,
  "refs": { "total": 12, "broken": 0, "deepHops": 1 },
  "backPointers": { "total": 12, "current": 10, "stale": 2 },
  "issues": [
    { "file": "03-data.md", "line": 12, "level": "error", "category": "structure", "message": "node too long (140 > 120)" },
    { "file": "04-api.md", "line": 8, "level": "error", "category": "structure", "message": "\"Returns\" has exactly 1 child. Collapse." },
    { "file": "05-frontend.md", "line": 5, "level": "error", "category": "refs", "message": "DEEP HOP: 05-frontend.md → 02-auth.md → 06-ops.md", "suggestion": "add \"see: 06-ops.md\" directly to 05-frontend.md and remove the intermediate hop via 02-auth.md: delete 05-frontend.md's \"see: 02-auth.md\" (line 3)" },
    { "file": "02-auth.md", "line": 4, "level": "warning", "category": "redundancy", "message": "\"authentication\" × 7 nodes (threshold: 4)" },
    { "file": "04-api.md", "line": 12, "level": "warning", "category": "redundancy", "message": "85% overlap: 02-auth.md:4 ↔ 04-api.md:12" }
  ],
  "errorCount": 3, "warningCount": 2, "backPointersUpdated": 0
}
```

### `output/check-fix.json`
```json
{
  "ok": true, "command": "check", "exitCode": 0,
  "files": 6, "nodes": 84, "maxDepth": 4,
  "refs": { "total": 12, "broken": 0, "deepHops": 0 },
  "backPointers": { "total": 12, "current": 12, "stale": 0 },
  "issues": [], "errorCount": 0, "warningCount": 0, "backPointersUpdated": 3,
  "backPointersUpdatedFiles": ["01-auth.md", "03-data.md", "04-api.md"]
}
```
Issue #53 (Part 2.4): a `--fix` run additionally carries `anchorFixes`
(`[{file, line, from, to, applied}]` — proposals `applied:false`, `--yes`
rewrites `applied:true`; empty array when no anchor needed repair), and a
`--fix --dry-run` run carries `dryRun: true` (the `backPointersUpdated*`
figures then describe WOULD-BE writes). Both fields are ADDITIVE and appear
only in `--fix` modes — plain-check JSON (like the fixtures above) is
byte-identical to the pre-#53 wire shape, so the pinned fixtures stand
unchanged.

Issue #43: the `--json` sections object gains a `config` bucket — but
ADDITIVELY, exactly like the #53 fields above. The five fixed keys
(`structure`, `style`, `refs`, `redundancy`, `other`; `overflow` left the
set with its engine, issue #56) are pinned by `test/report.test.ts` and
these fixtures, so `config` appears ONLY when a config-category issue exists
(an invalid `_rules.yaml`: rule `config.invalid`, file `_rules.yaml`, line
0). Every run with a parseable rules file keeps the same wire shape.

### `output/status.json`
```json
{
  "ok": true, "command": "status", "exitCode": 0,
  "specFiles": 6, "activeTasks": 2, "archivedTasks": 4, "adrCount": 3,
  "tasks": { "total": 12, "done": 5, "unclaimed": 3, "blocked": 1 },
  "owners": {
    "agent-1": { "tasks": 4, "done": 3 },
    "agent-2": { "tasks": 2, "done": 1 },
    "agent-3": { "tasks": 2, "done": 1 }
  },
  "taskFiles": [
    { "name": "add-dark-mode", "tasksDone": 3, "tasksTotal": 5, "gatesDone": 1, "gatesTotal": 2, "blocked": true },
    { "name": "fix-auth-bug", "tasksDone": 2, "tasksTotal": 7, "gatesDone": 0, "gatesTotal": 1, "blocked": true }
  ],
  "conflicts": 1
}
```

### `output/budget-read.json`
```json
{
  "ok": true, "command": "budget-read", "exitCode": 0, "concept": "sessions",
  "plan": [
    { "file": "02-authentication.md", "anchor": "Sessions", "reason": "canonical home", "score": 100, "estTokens": 120 },
    { "file": "04-api.md", "anchor": null, "reason": "see: back-ref", "score": 60, "estTokens": 60 },
    { "file": "06-operations.md", "anchor": null, "reason": "see: back-ref", "score": 40, "estTokens": 40 },
    { "file": "_tasks/add-dark-mode.md", "anchor": null, "reason": "active task mentions concept", "score": 20, "estTokens": 30 }
  ],
  "skipped": ["00-overview.md", "01-architecture.md", "03-data.md", "05-frontend.md"],
  "totalTokens": 250, "budgetLimit": 4096, "usagePercent": 6.1
}
```

### `output/budget-read-limit.json`
```json
{
  "ok": true, "command": "budget-read", "exitCode": 0, "concept": "sessions",
  "plan": [
    { "file": "02-authentication.md", "anchor": "Sessions", "reason": "canonical home", "score": 100, "estTokens": 120 },
    { "file": "04-api.md", "anchor": null, "reason": "see: back-ref", "score": 60, "estTokens": 60 }
  ],
  "skipped": ["06-operations.md", "_tasks/add-dark-mode.md", "00-overview.md", "01-architecture.md", "03-data.md", "05-frontend.md"],
  "totalTokens": 180, "budgetLimit": 200, "usagePercent": 90.0
}
```

### `output/budget-write.json`
```json
{
  "ok": true, "command": "budget-write", "exitCode": 0, "concept": "sessions",
  "canEdit": [
    { "file": "02-authentication.md", "anchor": "Sessions", "reason": "canonical home" },
    { "file": "_tasks/add-dark-mode.md", "anchor": null, "reason": "active task" }
  ],
  "mustNotEdit": [
    { "file": "04-api.md", "reason": "only has see: reference" },
    { "file": "06-operations.md", "reason": "only has see: reference" }
  ],
  "backPointersToUpdate": [
    { "fromFile": "04-api.md", "fromLine": 12, "toFile": "02-authentication.md" },
    { "fromFile": "06-operations.md", "fromLine": 5, "toFile": "02-authentication.md" }
  ]
}
```

### `output/done-success.json`
```json
{
  "ok": true, "command": "done", "exitCode": 0, "change": "add-dark-mode",
  "gates": { "human": 2, "humanOpen": 0, "tasks": 5, "tasksOpen": 0 },
  "archived": "_tasks/_archive/2025-09-03-add-dark-mode.md",
  "backPointersUpdated": 2
}
```

### `output/done-blocked-human.json`
```json
{
  "ok": false, "command": "done", "exitCode": 1, "change": "add-dark-mode",
  "gates": { "human": 2, "humanOpen": 1, "tasks": 5, "tasksOpen": 0 },
  "archived": null, "backPointersUpdated": 0
}
```

### `output/new.json`
```json
{ "ok": true, "command": "new", "exitCode": 0, "change": "add-dark-mode", "file": "_tasks/add-dark-mode.md" }
```

### `output/init.json`
```json
{
  "ok": true, "command": "init", "exitCode": 0,
  "created": ["_rules.yaml", "AGENTS.md", "00-overview.md", "01-architecture.md", "02-authentication.md", "03-data.md", "04-api.md", "05-frontend.md", "06-operations.md", "_adr/", "_tasks/", "_collab/handoffs.md", "_collab/conflicts.md", "_collab/decisions.md"],
  "skipped": [], "root": "./cans"
}
```

### `output/import.json`
```json
{
  "ok": true, "command": "import", "exitCode": 0,
  "format": "obsidian", "source": "./vault",
  "newFiles": ["07-billing.md"], "merged": ["02-authentication.md"],
  "conflicts": [
    { "file": "02-authentication.md", "line": 4, "cansVersion": "Session expires after 24 hours", "importVersion": "Sessions expire after 24h", "resolution": "cans-wins" }
  ]
}
```

### `output/export.json`
```json
{ "ok": true, "command": "export", "exitCode": 0, "format": "opml", "outputDir": "cans-export/opml", "filesExported": 6 }
```

---

## 36. Human Text Output Examples

### `cans check` (errors present)
```
Structure
  ✓ 6 files, 84 nodes, max depth 4
  ✗ 03-data.md:12 — node too long (140 > 120)
  ✗ 04-api.md:8 — "Returns" has exactly 1 child. Collapse.
Style
  ✗ 04-api.md:8 — "Returns" has 2 children. Collapse to sibling style.
References
  ✓ 12 see: refs, 0 broken, 0 deep hops
  ✓ back-pointers: 12/12 current
  ✗ 05-frontend.md:5 → 02-auth.md → 06-ops.md — DEEP HOP
    Fix: add "see: 06-ops.md" directly to 05-frontend.md and remove the intermediate hop via 02-auth.md
Redundancy
  ⚠ "authentication" × 7 nodes (threshold: 4)
  ⚠ 85% overlap: 02-auth.md:4 ↔ 04-api.md:12
Rules (_rules.yaml)
  ✓ node_length: 3–120 | siblings: 1–12 | depth: 1–5

3 errors, 2 warnings.
```

### `cans check` (info note present — exit 0, summary mark unchanged)
```
✓ 2 files · 6 nodes · depth 2 · 7ms

REFS  ✓ 1 refs · ℹ 1 note
  ℹ 1× non-obvious slug
      02-authentication.md:3 — "Layer 1 — C authorizer" → #Layer-1-C-authorizer
      ↳ the anchor above is the exact form see: refs must use — cans slug prints it for any text

RULES  ✓ len 3–120 · sib 1–12 · depth 1–5
```
Info notes (issue #53 Part 1.5) mark their group with `ℹ` and append
`· ℹ N notes` to the REFS header — they never change the summary-line
✓/⚠/✗, the exit code, or the error/warning counts.

### `cans done` (blocked)
```
✗ BLOCKED: 1 unchecked ← @human gate
  _tasks/add-dark-mode.md:12 — Spec approved ← @human
```

### `cans budget read sessions`
```
Reading plan for: sessions

  1. 02-authentication.md#Sessions ← canonical home (120 tok)
  2. 04-api.md ← see: back-ref (60 tok)
  3. 06-operations.md ← see: back-ref (40 tok)
  4. _tasks/add-dark-mode.md ← active task mentions sessions (30 tok)

Skipped:
  00-overview.md
  01-architecture.md
  03-data.md
  05-frontend.md

Budget: 250 / 4096 tokens (6.1%)
```

### `cans status`
```
Files: 6 specs, 2 tasks, 4 archived, 3 ADRs
Tasks: 5/12 done, 3 unclaimed, 1 blocked
Owners: agent-1, agent-2, agent-3

add-dark-mode:
    Tasks: 3/5
    Gates: 1/2 ← @human
    ⚠ BLOCKED

fix-auth-bug:
    Tasks: 2/7
    Gates: 0/1 ← @human
    ⚠ BLOCKED

Conflicts: 1 unresolved in _collab/conflicts.md
```

### `cans help`
```
CANS — Canonical Agent-Native Spec

Usage: cans <command> [args]

Commands:
  init [--flat|--folders] [--bare] [--force] [--tool <name>]
  check [--fix] [--strict] [--refs-only] [--structure[=strict]] [--no-redundancy] [file] [--json]
  new adr <title>
  new task <name>
  done <name> [--allow-incomplete] [--skip-check] [--json]
  status [--unclaimed] [--blocked] [--owners] [--json]
  budget read <concept> [--limit <tokens>] [--json]
  budget write <concept> [--json]
  import <format> <path> [--out <path>] [--dry-run] [--merge-strategy <s>]
  export <format> [--from <path>] [--vault <path>] [--dry-run]
  help

Formats: opml, dynalist, logseq, obsidian
Config:  cans/_rules.yaml
Agents:  cans/AGENTS.md
```

---

## 37. Error Message Philosophy

Pattern: `✗ <what> \n <where>: <detail> \n <what to do>`

```
✗ Broken ref: 04-api.md:12 → 02-auth.md
  File not found. Did you mean 02-authentication.md?

✗ BLOCKED: 1 unchecked ← @human gate
  _tasks/add-dark-mode.md:12 — Spec approved ← @human
  Check the gate, then re-run cans done.

✗ DEEP HOP: 04-api.md → 02-auth.md → 06-ops.md
  Fix: add "see: 06-ops.md" directly to 04-api.md and remove the intermediate hop via 02-auth.md
```

Never: stack traces for expected errors, "An unexpected error occurred", error codes without messages.

---

## 38. Testing Strategy

**Framework:** Bun native test runner (primary); node:test via `test/node-compat.ts` (fallback, issue #12). The same suite runs green on both: `bun test` / `npm run test:node`. Blackbox suites spawn `src/cli.ts` through `test/runtime.ts spawnCli`, which picks the CURRENT runtime — so the Node job executes the real fallback path.

| File | Tests | Covers |
|---|---:|---|
| outline.test.ts | ~12 | Parse bullets, indent, tasks, owners, refs |
| refs.test.ts | ~10 | Resolution, deep-hop, back-pointers, orphans |
| structure.test.ts | ~8 | Length, depth, siblings, collapse |
| style.test.ts | ~8 | Sibling/nested enforcement |
| redundancy.test.ts | ~10 | All 4 layers |
| budget.test.ts | ~8 | Read plan, write scope, scoring |
| converters.test.ts | ~12 | OPML, Logseq, Obsidian roundtrip |
| rules.test.ts | ~6 | YAML parse, defaults, merge |
| commands.test.ts | ~15 | All commands, JSON fixtures |

**Isolation:** Each test creates temp `cans/` directory. `beforeEach`/`afterEach` cleanup.

**JSON fixture testing:** Commands return Result objects. Tests compare against `test/fixtures/output/*.json`.

---

## 39. Packaging & Shipping

```json
{
  "name": "cans",
  "version": "0.1.0",
  "bin": { "cans": "./bin/cans.js" },
  "type": "module",
  "engines": { "bun": ">=1.0.0", "node": ">=23.2.0" },
  "scripts": { "test": "bun test", "test:node": "node --test ..." },
  "files": ["bin/", "src/", "templates/", "README.md", "LICENSE"]
}
```

No build step. No `dist/`. No `tsc` emit. Source IS distribution — on BOTH runtimes.

`bin/cans.js` is a plain-JS launcher (issue #12): under Bun it runs the CLI in-process; with Bun on PATH it re-execs Bun; otherwise it registers `bin/ts-loader.mjs` (builtin `stripTypeScriptTypes` — Node's default stripping refuses files under `node_modules`) and runs the TS sources directly.

Install: `npm install -g cans-spec` or `bun install -g cans-spec` (bin: `cans`).

CI: GitHub Actions → `test-bun` (`bun install` → `bun test`) + `test-node` (Node 22/24 matrix → `npm run test:node`). Nothing else.

---

## 40. Performance Budget

| Operation | Target |
|---|---|
| `cans check` (6 files, 84 nodes) | < 100ms |
| `cans check` (20 files, 500 nodes) | < 500ms |
| `cans budget read` | < 50ms |
| `cans status` | < 50ms |
| `cans done` | < 200ms |
| `cans import` (100 nodes) | < 200ms |
| `cans init` | < 50ms |

No operation exceeds 500ms. If it does, the algorithm is wrong.

---

## 41. Removed Commands

| Dropped | Replacement |
|---|---|
| `cans search` | `grep -rn "term" cans/` |
| `cans graph` | Reference summary in `cans check` |
| `cans context` | `cans budget read <concept>` |
| `cans diff` | `git diff` |
| `cans refs` | Merged into `cans check` |
| `cans validate` | Merged into `cans check` |
| `cans stats` | Summary in `cans check` / `status` |
| `cans apply` | Does not exist. Agent edits directly. |

---

## 42. Non-Goals (Final)

| Non-goal | Why |
|---|---|
| LLM-powered spec generation | CANS is deterministic. LLMs USE CANS. |
| Auto-fixing structure issues | Flags only. Human decides. |
| Real-time collaboration / WebSocket | Git IS the transport. |
| Database backend | Files ARE the state. |
| Web UI / dashboard | CLI + editor is enough. |
| Plugin system | 10 commands. No extension points. |
| Multi-repo orchestration | Git submodules. Not our problem. |
| Requirement traceability matrix | The outline IS the matrix. |
| Custom artifact types | There are no artifacts. There are files. |
| Versioned schema migrations | Delete `_rules.yaml` key = disable check. |
| Telemetry / analytics | None. Ever. |
| Merge/apply pipeline | Agent edits specs directly. No delta system. |

---

## 43. Future Extensions (NOT Day 1)

| Extension | Trigger | Complexity |
|---|---|---|
| `cans check --watch` | Dev loop demands live validation | ~30 lines |
| `cans import roam` | Roam users show up | ~80 lines |
| `cans export html` | Static spec site request | ~60 lines |
| Folder auto-split suggestion | Files exceed ~200 nodes | ~50 lines |
| `cans init --template <name>` | Community shares templates | ~30 lines |

None ship until someone asks AND justifies.

---

## 44. Versioning

```
0.1.0  — Day 1 ship. All commands. All engines. All converters.
0.1.x  — Bug fixes. No new commands.
0.2.0  — Genuinely new capability (not a flag).
1.0.0  — API stable, 10+ projects using daily.
```

---

## 45. Ship Checklist

- [ ] All commands implemented
- [ ] All engines pass on flat-project fixture
- [ ] Deep-hop detection works
- [ ] Back-pointers auto-update with `--fix`
- [ ] Style enforcement works
- [ ] Redundancy (4 layers) works
- [ ] OPML/Logseq/Obsidian roundtrips pass
- [ ] Token budget produces correct plans
- [ ] `cans done` blocks on human gates
- [ ] ADR creation with auto-increment works
- [ ] Task creation + archive works
- [ ] `--json` output matches all fixtures
- [ ] `bun test` passes (95+ tests)
- [ ] `npm publish` dry-run succeeds
- [ ] No runtime dependencies
- [ ] No build step
- [ ] Works on macOS, Linux, Windows (via Bun)

---

**END OF ARCHITECTURE.**
