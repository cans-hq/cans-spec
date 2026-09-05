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
| Runtime | Bun ≥ 1.0 | Native TS execution, built-in fs/path/glob |
| Language | TypeScript | Type safety without compilation ceremony |
| Dependencies | **Zero** | No commander, no yaml parser, no zod, no chalk |
| Config format | YAML (`_rules.yaml`) | Human-editable, Bun parses natively |
| Spec format | Markdown outlines | Universal, git-friendly, agent-native |
| Coordination | Git | Branch per change, merge when done |
| CLI dispatch | Manual `Bun.argv` parsing | 10 commands don't need a framework |

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

Folder mode alternative: `02-authentication/index.md` instead of `02-authentication.md`. Flat wins over folder. If both exist, `cans check` flags error.

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
│   │   ├── overflow.ts        # code fence / table / length detection
│   │   ├── rules.ts           # load + validate _rules.yaml
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
│   ├── overflow.test.ts
│   ├── budget.test.ts
│   ├── converters.test.ts
│   ├── rules.test.ts
│   ├── commands.test.ts
│   └── fixtures/
│       ├── flat-project/
│       ├── folder-project/
│       ├── overflow-project/
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
  category: 'structure' | 'style' | 'refs' | 'redundancy' | 'overflow';
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
- `see:` parsed via regex: `/see:\s*(\S+?)(?:#(\S+))?/g`
- Owner parsed via regex: `/←\s*(@?\S+)/`
- Stack-based parent attachment by indent level.

**Flat vs folder resolution:** Try `cans/02-authentication.md` first. Then `cans/02-authentication/index.md`. Flat wins. Both existing = error.

---

## 12. Refs Engine

### Resolution
- Find target file (flat then folder).
- If no anchor → file-level ref, resolved.
- If anchor → find node by exact text match, then case-insensitive fallback.
- No fuzzy anchor matching. Not found = broken ref error.

### Back-pointers
HTML comments in target file: `<!-- ref-by: 04-api.md, 05-frontend.md -->`
Rebuilt from scratch every `--fix` run. Not incremental. Not authoritative.

### Deep-hop detection
For every file that IS referenced (has incoming refs): if it ALSO has outgoing refs → deep hop error. Report the full chain and suggest the fix.

**Example:**
```
✗ DEEP HOP: 04-api.md → 02-authentication.md → 06-operations.md
Fix: add "see: 06-operations.md#Data-protection" directly to 04-api.md
```

### Edge cases

| Case | Behavior |
|---|---|
| File not found | Broken ref error |
| Lowercase anchor | Case-insensitive fallback |
| No anchor | Valid file-level ref |
| Ref to `_tasks/` | Warning (transient) |
| Ref to `_collab/` | Error (not spec) |
| Self-reference | Error |
| `see:` inside `see:` target | Deep hop error |
| Multiple `see:` on one line | Both parsed, both validated |

### Orphan detection
Files with no incoming AND no outgoing refs (except `00-overview.md`) → warning.

---

## 13. Redundancy Engine

Four layers. All deterministic. No ML.

**Layer 1 — Word frequency:** Normalize words (lowercase, strip punctuation, expand synonyms, filter stopwords). Flag words appearing in ≥ threshold nodes.

**Layer 2 — Phrase overlap:** Pairwise compare all bullet texts. Normalized word set overlap ≥ 70% → flag.

**Layer 3 — Fuzzy edit distance:** Levenshtein ≤ 2 for words > 4 chars not already synonym-matched → possible typo warning.

**Layer 4 — Cross-file canonicality:** Same concept at depth 0–1 in 2+ files without `see:` between them → flag.

**Normalization:** lowercase → strip punctuation → synonym expansion (e.g., postgres/postgresql/pg → "postgres"). Stopwords filtered.

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

Checks: node length (min/max chars), sibling count per parent, depth (min/max), single-child collapse, empty nodes.

**Example output:**
```
✗ 03-data.md:12 — Node too long (140 > 120). Split or move to file.
✗ 04-api.md:8 — "Returns" has exactly 1 child. Collapse.
⚠ 02-authentication.md:3 — "Sessions" has 14 children (max 12).
✗ 06-operations.md:20 — Depth 6 exceeds max 5. Flatten.
```

---

## 16. Overflow Engine

Detects content that doesn't belong in a bullet: code fences (``` blocks), tables (| ... |), nodes exceeding `max_node_chars`.

Overflow content should be extracted to a separate file and referenced via `see:`.

Overflow target files must NOT contain their own `see:` refs (no chaining).

Inline code spans (`POST /users`), short key-values, arrow syntax → fine. Not flagged.

---

## 17. Engine Execution Order

```
1. Parse all files → OutlineNode[][]
2. Build RefGraph
3. checkStructure()
4. checkStyle()
5. checkRefs()
6. checkRedundancy() (all 4 layers)
7. checkOverflow()
8. Collect all Issue[]
9. Format output (JSON or text)
10. Exit code
```

Each engine is pure. No side effects. Only `--fix` triggers writes (back-pointers only).

---

## 18. Rules System (`_rules.yaml`)

Minimal YAML parser (~60 lines, no dependency). Supports nested objects, inline arrays `[a,b,c]`, inline objects `{min: 3, max: 120}`, arrays via `- item`.

**Loading:** Missing file = all defaults. Partial file = only listed keys override. Delete a key = check turns off. Invalid YAML = print line number, exit 1.

**Default rules:**

```yaml
structure:
  node_length: { min: 3, max: 120 }
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
redundancy:
  enabled: true
  word_frequency_threshold: 4
  phrase_overlap_threshold: 0.7
  cross_file_threshold: 2
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
overflow:
  max_node_chars: 200
  force_file_for: [code_block, table, diagram]
```

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
cans check [--fix] [--strict] [--refs-only] [--no-redundancy] [file] [--json]
cans new adr <title>
cans new task <name>
cans done <name> [--allow-incomplete] [--skip-check] [--json]
cans status [--unclaimed] [--blocked] [--owners] [--json]
cans budget read <concept> [--limit <tokens>] [--change <name>] [--json]
cans budget write <concept> [--json]
cans import <format> <path> [--out <path>] [--dry-run] [--merge-strategy <s>] [--json]
cans export <format> [--from <path>] [--include-tasks] [--vault <path>] [--dry-run] [--json]
cans help
```

### Command contract
- Each command is a single exported async function returning a `CommandResult` subtype.
- Commands parse only their own args.
- Commands do not import each other.
- Core logic in `core/`, not command files.
- `checkWorkspace()` shared internally by `check` and `done`.
- No framework. `Bun.argv` + switch.

### Arg parsing
Primitive. `--flag value` only. No `--flag=value`, no short flags, no combined flags. `Bun.argv` handles shell quoting.

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
**Writes:** Nothing by default. `--fix` updates back-pointer comments only.
**Excludes:** `_collab/`, `AGENTS.md`, `_rules.yaml` from structural checks.

**`--fix` scope (strictly limited):** Add/remove/rewrite `<!-- ref-by: ... -->` comments. Nothing else. No text changes, no node moves, no style fixes, no splits.

**Report sections (fixed order):** Structure → Style → References → Redundancy → Overflow → Rules → Summary.

**JSON result:**
```ts
{ ok, command: 'check', exitCode, files, nodes, maxDepth,
  refs: { total, broken, deepHops },
  backPointers: { total, current, stale },
  issues: Issue[], errorCount, warningCount, backPointersUpdated }
```

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
3. Score all files: canonical home (100), active task mentioning (80), back-pointer (60), forward ref (40), mentions concept (20), no connection (0).
4. Sort by score. Greedily include until token limit.
5. Print plan.

### `budget write <concept>`
1. Find canonical home.
2. CAN edit: canonical home + active task files mentioning concept.
3. MUST NOT edit: files with only `see:` references.
4. List back-pointers that need updating if node text changes.

### `budget read --change <name>`
Centered on a task file. Add its refs (1 hop). Reject deep-hop expansion. Apply budget.

**Token estimate:** `Math.ceil(text.length / charsPerToken)`. Default 3.5 chars/token.

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

**Import rules:** Preserve hierarchy. Convert bullets to `- `. Convert tasks. Strip app metadata. Preserve real identifiers. Convert `[[wiki-links]]` → `see:`. Strip YAML frontmatter. Extract code blocks → overflow files. Do NOT invent refs. Do NOT deduplicate. Let `cans check` report issues after.

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

- `exists()`: `Bun.file(p).exists()`
- `dirExists()`: `fs.stat` + isDirectory
- `mkdirp()`: recursive directory creation
- `globFiles()`: `Bun.Glob` scanSync
- `discoverSpecFiles()`: flat `*.md` + folder `*/index.md`, excluding `_` prefixed and `AGENTS.md`
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

### `overflow-project/04-api.md`
```markdown
- API
  - POST /users
    - Returns 201 on success
    - Request schema: see 04-api/request-schema.md
    - Error handling: see 04-api/error-handling.md
```

### `overflow-project/04-api/request-schema.md`
```markdown
```json
{
  "type": "object",
  "properties": {
    "email": { "type": "string", "format": "email" },
    "password": { "type": "string", "minLength": 8 },
    "name": { "type": "string" }
  },
  "required": ["email", "password"]
}
```
```

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
    { "file": "05-frontend.md", "line": 5, "level": "error", "category": "refs", "message": "DEEP HOP: 05-frontend.md → 02-auth.md → 06-ops.md", "suggestion": "add \"see: 06-ops.md\" directly to 05-frontend.md" },
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
  "issues": [], "errorCount": 0, "warningCount": 0, "backPointersUpdated": 3
}
```

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
    Fix: add "see: 06-ops.md" directly to 05-frontend.md
Redundancy
  ⚠ "authentication" × 7 nodes (threshold: 4)
  ⚠ 85% overlap: 02-auth.md:4 ↔ 04-api.md:12
Overflow
  ✓ no code blocks, tables, or oversized nodes
Rules (_rules.yaml)
  ✓ node_length: 3–120 | siblings: 1–12 | depth: 1–5

3 errors, 2 warnings.
```

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
  check [--fix] [--strict] [--refs-only] [--no-redundancy] [file] [--json]
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
  Fix: add "see: 06-ops.md" directly to 04-api.md
```

Never: stack traces for expected errors, "An unexpected error occurred", error codes without messages.

---

## 38. Testing Strategy

**Framework:** Bun native test runner. ~95 tests.

| File | Tests | Covers |
|---|---:|---|
| outline.test.ts | ~12 | Parse bullets, indent, tasks, owners, refs |
| refs.test.ts | ~10 | Resolution, deep-hop, back-pointers, orphans |
| structure.test.ts | ~8 | Length, depth, siblings, collapse |
| style.test.ts | ~8 | Sibling/nested enforcement |
| redundancy.test.ts | ~10 | All 4 layers |
| overflow.test.ts | ~6 | Fences, tables, length |
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
  "bin": { "cans": "./src/cli.ts" },
  "type": "module",
  "engines": { "bun": ">=1.0.0" },
  "scripts": { "test": "bun test", "prepublishOnly": "bun test" },
  "files": ["src/", "templates/", "README.md", "LICENSE"]
}
```

No build step. No `dist/`. No `tsc`. Shebang: `#!/usr/bin/env bun`. Source IS distribution.

Install: `npm install -g cans-spec` or `bun install -g cans-spec` (bin: `cans`).

CI: GitHub Actions → `oven-sh/setup-bun@v2` → `bun install` → `bun test`. Nothing else.

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
- [ ] Overflow detection works
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
