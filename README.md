# CANS

**Canonical Agent-Native Spec.**

Dense markdown outlines ARE your spec, state machine, task board, and coordination protocol. No schema engine. No artifact pipeline. No adapter registry. The file is the truth. Git is the transport. Agents read the file and know everything.

~1080 lines of TypeScript. Zero runtime dependencies. No build step.

---

## Why

OpenSpec enforces spec-driven workflows via 200+ files, 4-artifact pipelines, Zod validation, DAG resolution, 30+ tool adapters, and 50k–100k tokens per invocation.

CANS solves every one of those problems by deletion.

| OpenSpec | CANS |
|---|---|
| 4-artifact pipeline | Edit spec in place. ADR records why. |
| Zod + DAG + 30 adapters | Structural lint. No schema. |
| Delta-spec merge | `see:` refs + git diff |
| SHALL/MUST/WHEN/THEN | Natural language. Dense bullets. |
| ~36k tokens of agent instructions | ~800 tokens. Loaded once. |
| `openspec status --json` for state | Agents read the file. The file IS the state. |

---

## Install

```sh
bun install -g cans
# or
npm install -g cans
```

Requires [Bun](https://bun.sh) ≥ 1.0. No build. Source IS distribution.

---

## Quick start

```sh
mkdir my-project && cd my-project
cans init
```

Creates:

```
cans/
├── _rules.yaml          # validation config
├── AGENTS.md            # ~800-token agent instructions
├── 00-overview.md       # start here
├── 01-architecture.md
├── 02-authentication.md
├── 03-data.md
├── 04-api.md
├── 05-frontend.md
├── 06-operations.md
├── _adr/                # decisions (permanent)
├── _tasks/              # work tracking (transient)
└── _collab/             # handoffs, conflicts, decisions
```

Write specs as dense bullet outlines:

```markdown
- Authentication
  - Sign up
    - Email: requires verification
    - Google: uses provider verification
  - Sessions
    - Expire after 24 hours
    - Refresh allowed for 30 days
```

Reference, don't duplicate:

```markdown
# 04-api.md
- Authentication
  - Session rules: see 02-authentication.md#Sessions
```

Validate:

```sh
cans check
```

---

## Five principles

1. **Dense over verbose.** Every bullet earns its place. No filler levels.
2. **Canonical over duplicated.** One home per concept. Everywhere else uses `see:`.
3. **One hop. Never chain.** A→B is fine. A→B→C is forbidden.
4. **Unknowns are first-class.** `TBD` is valid. Don't guess. Mark it, move on.
5. **Structure emerges from subject.** No fixed hierarchy. No required vocabulary.

---

## Commands

```
cans init          scaffold workspace
cans check         validate structure, refs, style, redundancy, overflow
cans new adr       create a decision record
cans new task      create a task file
cans done          archive completed task (gated on ← @human approval)
cans status        workspace summary
cans budget read   token-budgeted reading plan for a concept
cans budget write  what you can/can't edit for a concept
cans import        bring in OPML / Logseq / Obsidian
cans export        push out to OPML / Logseq / Obsidian
```

All commands support `--json` for agent consumption.

```sh
cans check --json
cans budget read "sessions" --limit 2000 --json
cans status --json
```

---

## How agents work with CANS

Agents read `cans/AGENTS.md` (~800 tokens). That's it.

- **Read:** find canonical home → follow `see:` (one hop) → read hierarchy for context
- **Write:** update canonical home only → check refs → smallest correct change
- **Decide:** create an ADR (`cans new adr "title"`)
- **Track:** create a task (`cans new task "name"`), edit specs directly
- **Finish:** `cans done "name"` — blocks until `← @human` gates are checked

No pipeline. No phases. No artifacts. The outline is the contract.

---

## What CANS does NOT do

No schema validation. No SHALL/MUST enforcement. No scenario counting. No tool adapters. No YAML frontmatter in specs. No delta operations. No telemetry. No LLM-powered anything. No auto-fixing (flags only, human decides). No merge pipeline (agents edit directly). No plugin system. No web UI. No database. No versioned migrations.

**CANS is advisory, not coercive.** Agents follow the rules because the rules are simple and the file is readable. `cans check` catches drift. Humans resolve it.

---

## Validation engines

`cans check` runs five deterministic engines:

| Engine | Catches |
|---|---|
| **Structure** | Node length, depth, sibling count, single-child collapse, empty nodes |
| **Style** | Sibling vs nested grouping, shared prefix detection |
| **References** | Broken `see:`, deep hops (A→B→C), self-refs, orphans, stale back-pointers |
| **Redundancy** | Word frequency, phrase overlap, fuzzy typos, cross-file duplication |
| **Overflow** | Code fences, tables, oversized nodes that belong in separate files |

Configure thresholds in `cans/_rules.yaml`. Delete a key to disable that check.

```sh
cans check              # human-readable
cans check --json       # machine-readable
cans check --fix        # rebuild back-pointer comments (nothing else)
cans check --strict     # warnings become errors
cans check 04-api.md    # single file
```

---

## Token budget

Before reading or writing, agents ask CANS what to look at:

```sh
cans budget read "sessions" --json
```

Returns a scored, ordered reading plan capped at your token limit. Canonical home first (100), active tasks (80), back-refs (60), forward refs (40), mentions (20). Files outside the plan are skipped.

```sh
cans budget write "sessions" --json
```

Returns which files you CAN edit (canonical home + active tasks) and which you MUST NOT (files with only `see:` references).

---

## Requirements

- [Bun](https://bun.sh) ≥ 1.0
- Git (for coordination, not required by CANS itself)

No other dependencies. None. Zero. The package.json `dependencies` field does not exist.

---

## License

MIT
