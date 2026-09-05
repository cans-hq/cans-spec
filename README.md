<p align="center">
  <strong style="font-size: 2em;">CANS</strong><br>
  <em>Canonical Agent-Native Spec</em>
</p>

<p align="center">
  <b>The outline is the spec. The outline is the state. The outline is the task board.<br>
  There is nothing else.</b>
</p>

<p align="center">
  <code>~1080 lines</code> · <code>0 dependencies</code> · <code>no build step</code> · <code>no schema</code> · <code>no pipeline</code>
</p>

---

## The pitch

Your spec is a markdown file with bullets. Your AI agent reads it and knows everything. Your state lives in checkboxes. Your coordination protocol is indentation and `see:` links. Your transport layer is git.

There is no registry. There is no adapter. There is no artifact DAG. There is no Zod schema validating your English sentences. There is no telemetry phoning home. There is no 4-phase pipeline gating your Tuesday afternoon.

There is a file. You edit it. `cans check` tells you if it's healthy. That's the whole product.

---

## Why this exists

We used [OpenSpec](https://github.com/Fission-AI/OpenSpec). It's a fine project. It also ships 200+ files, 30+ tool adapters, a 4-artifact pipeline, Zod validation, DAG resolution, delta-spec merges, SHALL/MUST keyword enforcement, scenario counting, a telemetry system, a store/registry layer, and burns 50k–100k tokens per invocation.

We tried deleting things. Everything kept working.

So we kept deleting.

| OpenSpec ships | CANS ships |
|---|---|
| 4-artifact pipeline (proposal → specs → design → tasks) | Edit the spec. ADR records why. Task tracks work. |
| Zod schemas + DAG resolver + 30 adapter files | Structural lint on markdown bullets |
| Delta-spec merge engine at archive time | `see:` references + `git diff` |
| SHALL / MUST / WHEN / THEN / GIVEN keywords | Natural language. Dense bullets. |
| ~36,000 tokens of agent instructions across 12 skills | ~800 tokens. One file. Loaded once. |
| `openspec status --json` to query project state | Agents read the file. The file IS the state. |
| 30+ tool-specific command formatters | One prompt block. String-replace the tool name. |
| YAML frontmatter + markdown headers + requirement blocks | Bullets. Just bullets. |
| Custom merge logic for spec reconciliation | Git merges. Humans resolve conflicts. |
| Telemetry, stores, registries, profiles | None. |
| **50,000–100,000 tokens per invocation** | **~800 tokens, loaded once** |

OpenSpec is a framework. CANS is a file with a linter.

---

## See it in action

```text
You: cans init
     ✓ Created cans/ with 7 spec files, _adr/, _tasks/, _collab/

You:  (write your spec as dense bullets)
      - Authentication
        - Sign up
          - Email: requires verification
          - Google: uses provider verification
        - Sessions
          - Expire after 24 hours
          - Refresh allowed for 30 days

You: cans check
     ✓ 7 files, 42 nodes, max depth 3
     ✓ 3 see: refs, 0 broken, 0 deep hops
     ✓ back-pointers: 3/3 current
     0 errors, 0 warnings.

You: cans new task add-dark-mode
     ✓ Created _tasks/add-dark-mode.md

You:  (agent implements, checks off tasks, edits specs directly)

You: cans done add-dark-mode
     ✓ Archived to _tasks/_archive/2025-09-03-add-dark-mode.md
```

No `/opsx:propose`. No `/opsx:apply`. No `/opsx:archive`. No pipeline. No phases. You edit the file. The agent edits the file. `cans check` keeps it honest.

<details>
<summary><b>What do the specs actually look like?</b></summary>

Bullets. Indented. Dense. No special syntax. No keywords. No scenario blocks.

```markdown
- Authentication
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

Reference, don't duplicate:

```markdown
# in 04-api.md
- Authentication
  - Session rules: see 02-authentication.md#Sessions
  - Requires Bearer token
```

That's it. That's the whole spec format. Your agent reads this and knows what to build.

</details>

---

## Five principles

**1. Dense over verbose.** Every bullet earns its place. No filler levels. No manufactured identifiers.

```markdown
# bad                          # good
- Authentication               - Authentication
  - Capability                   - Sign up
    - Behavior
      - Sign up
```

**2. Canonical over duplicated.** Every concept has one home. Everywhere else uses `see:`.

**3. One hop. Never chain.** A→B is fine. A→B→C is forbidden. `cans check` catches it.

**4. Unknowns are first-class.** `TBD` is valid. Don't guess. Don't block. Mark it, move on.

**5. Structure emerges from subject.** No fixed hierarchy. No required vocabulary. No kebab-casing reality.

---

## What CANS does NOT do

This is the most important section.

- ❌ No schema.yaml / artifact DAG / topological sort
- ❌ No Zod validation of requirement text
- ❌ No SHALL / MUST keyword enforcement
- ❌ No scenario counting (WHEN / THEN / GIVEN)
- ❌ No 30 tool adapters / adapter registry
- ❌ No YAML frontmatter in spec files
- ❌ No "delta operations" (ADDED / MODIFIED / REMOVED)
- ❌ No telemetry. None. Ever.
- ❌ No store / registry system for multi-repo
- ❌ No requirement-block parsing
- ❌ No phase gates (proposal → specs → design → tasks)
- ❌ No LLM-powered anything (CANS is deterministic; LLMs *use* CANS)
- ❌ No auto-fixing (flags only, human decides)
- ❌ No plugin system (10 commands, no extension points)
- ❌ No web UI / dashboard
- ❌ No database backend (files ARE the state)
- ❌ No merge pipeline (agent edits specs directly)
- ❌ No versioned schema migrations (delete a config key = disable that check)

**CANS is advisory, not coercive.** The outline is the contract. `cans check` catches drift. Humans resolve it.

---

## Install

Requires [Bun](https://bun.sh) ≥ 1.0. No build step. Source IS distribution.

```bash
bun install -g cans
```

```bash
cd your-project
cans init
```

Done. You have a `cans/` directory. Start writing bullets.

---

## Commands

```
cans init          scaffold workspace
cans check         validate everything (structure, refs, style, redundancy, overflow)
cans new adr       create a decision record
cans new task      create a task file
cans done          archive completed task (blocks on ← @human gates)
cans status        workspace summary
cans budget read   token-budgeted reading plan for a concept
cans budget write  what you can / can't edit for a concept
cans import        bring in OPML / Logseq / Obsidian
cans export        push out to OPML / Logseq / Obsidian
```

Every command supports `--json` for agent consumption.

```bash
cans check --json
cans budget read "sessions" --limit 2000 --json
cans status --json
```

---

## How agents work with CANS

Agents read one file: `cans/AGENTS.md`. It's ~800 tokens. Here's the gist:

> **Reading:** Find the concept → read its canonical home → follow `see:` (one hop only) → read surrounding hierarchy for context.
>
> **Writing:** One canonical home per concept. Reference, don't duplicate. Preserve real identifiers. Mark unknowns as TBD. Smallest correct change.
>
> **Deciding:** Create an ADR. ADRs are permanent. Specs are the truth. ADRs record WHY.
>
> **Tracking:** Create a task. Agent edits specs directly. When done: `cans done <name>`. Blocks until `← @human` gates are checked.
>
> **Token budget:** Before reading: `cans budget read "<concept>" --json`. Read ONLY the files in the plan. Before writing: `cans budget write "<concept>" --json`. Only edit files in `canEdit`.

That's the entire agent instruction surface. No 12 skills. No 30 adapters. No slash commands.

---

## Validation

`cans check` runs five deterministic engines. No ML. No LLM. No embeddings.

| Engine | Catches |
|---|---|
| **Structure** | Node length, depth, sibling count, single-child collapse, empty nodes |
| **Style** | Sibling vs nested grouping, shared prefix detection |
| **References** | Broken `see:`, deep hops (A→B→C), self-refs, orphans, stale back-pointers |
| **Redundancy** | Word frequency, phrase overlap, fuzzy typos, cross-file duplication |
| **Overflow** | Code fences, tables, oversized nodes that belong in separate files |

Configure in `cans/_rules.yaml`. Delete a key to disable that check. No migration.

```bash
cans check              # human-readable
cans check --json       # machine-readable
cans check --fix        # rebuild back-pointer comments (nothing else)
cans check --strict     # warnings become errors
cans check 04-api.md    # single file
```

---

## Workspace layout

```
cans/
├── _rules.yaml              # validation config
├── AGENTS.md                # ~800-token agent instructions
├── 00-overview.md
├── 01-architecture.md
├── 02-authentication.md
├── 03-data.md
├── 04-api.md
├── 05-frontend.md
├── 06-operations.md
├── _adr/                    # decisions (permanent)
│   ├── 001-css-variables-over-tailwind.md
│   └── 002-postgres-over-mysql.md
├── _tasks/                  # work tracking (transient)
│   └── add-dark-mode.md
└── _collab/                 # handoffs, conflicts, decision index
```

---

## How we compare

**vs. [OpenSpec](https://github.com/Fission-AI/OpenSpec)** — Comprehensive but heavy. 200+ files, 4-artifact pipelines, 30+ adapters, 50k–100k tokens per invocation. CANS is 1080 lines, zero deps, 800 tokens. You don't need a framework. You need a file.

**vs. [Spec Kit](https://github.com/github/spec-kit)** (GitHub) — Rigid phase gates, Python setup, lots of Markdown. CANS has no phases. You edit the spec. That's the workflow.

**vs. [Kiro](https://kiro.dev)** (AWS) — Locked to their IDE, limited to Claude. CANS is a CLI that reads markdown files. Works with any agent, any editor, any model.

**vs. nothing** — AI coding without specs means vague prompts and drift. CANS gives you a contract in 800 tokens of agent instructions instead of 36,000.

---

## Requirements

- [Bun](https://bun.sh) ≥ 1.0
- Git (for coordination; not required by CANS itself)
- An AI agent that can read markdown (all of them)

No Node.js. No Python. No `package-lock.json`. No `node_modules`. The `dependencies` field in `package.json` does not exist.

---

## Contributing

The entire codebase is ~1080 lines of TypeScript across 20 files. Read it in an afternoon.

- `bun test` runs the suite (~95 tests)
- No build step. Edit `src/`, run `bun test`, done.
- PRs that add features get closed. PRs that delete code get merged.
- If you want a new command, open an issue and justify it. Most get rejected. That's the point.

---

## License

MIT
