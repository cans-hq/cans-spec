# CANS Agent Instructions

You are working in a CANS project. Specs live in `cans/`.

## Reading

Find concept → read canonical home → follow `see:` ONE hop. Never chain.

```
# GOOD: read canonical, then one ref
cans/02-authentication.md  →  "Sessions" node
cans/04-api.md             →  "Session rules: see 02-authentication.md#Sessions"

# FORBIDDEN: following a see: inside the referenced file
04-api.md → see 02-auth.md → see 06-ops.md   ← DEEP HOP, stop at 02-auth.md
```

Read surrounding hierarchy for context, not just the leaf:

```
# You need "Refresh allowed for 30 days"
# Read the parent chain:
- Authentication          ← context
  - Sessions              ← parent
    - Expire after 24 hours
    - Refresh allowed for 30 days   ← target
```

## Writing

One canonical home per concept. Reference, don't duplicate.

```
# GOOD: 04-api.md references the canonical home
- Authentication
  - Session rules: see 02-authentication.md#Sessions

# BAD: duplicating session rules in 04-api.md
- Authentication
  - Sessions expire after 24 hours    ← DUPLICATE, use see: instead
  - Refresh allowed for 30 days       ← DUPLICATE
```

Preserve real identifiers exactly:

```
# GOOD
- POST /users
- packages/api
- users.created_at

# BAD
- post-users
- packages-api
- users-created-at
```

Mark unknowns as TBD. Don't guess:

```
# GOOD
- Rate limit: TBD (waiting on infra decision)

# BAD
- Rate limit: 1000 req/min   ← invented, no source
```

If a level adds no meaning, don't create it:

```
# BAD (filler)
- Authentication
  - Capability
    - Behavior
      - Sign up

# GOOD (dense)
- Authentication
  - Sign up
```

## Changing

Find canonical home → update there → check references → verify affected code.

```
# Changing session expiry from 24h to 48h:
1. Edit cans/02-authentication.md  →  "Expire after 48 hours"
2. Run: cans check --refs-only
3. Verify back-pointers still valid
4. Do NOT edit 04-api.md (it only has see:, not the value)
```

Never silently resolve conflicts. Report them:

```
# If you disagree with a spec:
- Add to _collab/conflicts.md
- Format: - status: unresolved | file: 04-api.md | issue: <description>
- Do NOT overwrite the spec
```

Smallest correct change. Don't restructure what isn't broken.

## ADRs

Decisions get an ADR. ADRs record WHY. Specs are the truth.

```
cans new adr "postgres-over-mysql"
# Creates: _adr/003-postgres-over-mysql.md
# Fill: Context → Decision → Alternatives → Consequences
# Reference spec: see 03-data.md#Storage
```

## Tasks

Implementation tracking via task files:

```
cans new task "add-dark-mode"
# Creates: _tasks/add-dark-mode.md
```

Task file structure:

```markdown
# add-dark-mode
- Owner: agent-1
- ADR: _adr/001-css-variables-over-tailwind.md
- Tasks
  - [x] Add ThemeContext provider ← agent-1
  - [ ] Create toggle component ← agent-1
  - [ ] Test: no FOUC ← agent-2
- Review
  - [ ] Spec approved ← @human
```

When done: `cans done add-dark-mode`
Blocks if `← @human` gates unchecked. Always.

## Collaboration

One owner per task file. Claim before editing.

```
# If task has ← agent-3, do NOT edit it
# If you need to hand off, add to _collab/handoffs.md:
- from: agent-1 → to: agent-3 | task: add-dark-mode | context: color audit pending
```

## Agent Execution Policy

How to execute work when this workspace opts in to agent guardrails
(`agent_guardrails:` in `_rules.yaml` — off by default; when on, `cans check`
enforces exactly what the workspace enabled, at its configured severity).

Build where your task says. When build isolation is required
(`isolation.mode: require-target-prefix`), every build output goes under the
declared prefix — `target/agent-<name>/` — never into the shared root
directories (`target/`, `dist/`, `build/`, `out/`):

```
# GOOD: build outputs in target/agent-auth/   ← prefixed, no contention
# BAD:  build outputs in target/              ← shared, two agents collide
```

Never rewrite a protected manifest in place (`Cargo.toml`, `package.json`,
`pyproject.toml` by default). A half-written manifest breaks every concurrent
reader. Copy → modify → atomic swap:

```
cp package.json package.json.new    # edit the copy, not the original
mv package.json.new package.json    # atomic swap: readers see old or new
```

No residue: a leftover `package.json.bak`, `.orig`, `~` or `.tmp` next to a
protected manifest is reported as an in-place mutation.

Leave a breadcrumb when you stop. Before a session ends — normally or by
eviction — APPEND a dated entry to the devlog (`log/devlog.md`, append-only:
add at the end, never rewrite or prune what is already there) with all three
sections. The next agent inherits from this log, not from your context:

```markdown
## 2026-02-01 — add-dark-mode — agent-1

### touched_files

- cans/02-authentication.md
- src/middleware/session.ts

### test_outcomes

- bun test: 42 pass / 0 fail

### still_open

- refresh-token rotation: untested edge case
```

## Negative Invariants

Strictly forbidden in this workspace — patterns, dependencies and
implementations the workspace AUTHOR bans up front. Everything listed here is
a hard boundary, not a preference: do not implement, import, or work around
any of it. If a task or ADR seems to require something listed below, stop and
report the conflict in `_collab/conflicts.md` — never resolve it silently.

This section must exist and stay non-empty: the guardrails engine (when
`agent_guardrails.negative_invariants.required` is on in `_rules.yaml`)
checks that AGENTS.md carries this heading with content beneath it. The
workspace author curates the list; replace the examples below with this
workspace's real boundaries:

- No new runtime dependency without an ADR recording why (ADR first, manifest second).
- No hand-edited generated artifacts — regenerate instead (`dist/`, lockfiles, minified bundles).
- No spec rule duplicated into another file — one canonical home, point at it with `see:`.

## Token Budget

Before reading:

```bash
cans budget read "sessions" --json
# Returns scored plan. Read ONLY listed files, in order.
```

Before writing:

```bash
cans budget write "sessions" --json
# Returns canEdit[] and mustNotEdit[].
# ONLY edit files in canEdit. Never touch mustNotEdit.
```

Example budget read output:

```json
{
  "plan": [
    { "file": "02-authentication.md", "anchor": "Sessions", "score": 100 },
    { "file": "04-api.md", "anchor": null, "score": 60 }
  ],
  "skipped": ["00-overview.md", "03-data.md"],
  "totalTokens": 180,
  "budgetLimit": 4096
}
```

Read files in plan order. Stop at budgetLimit.

## Machine Output

Use `--json` for structured output. Parse JSON, never human text.

```bash
cans check --json          # structured issues
cans status --json         # workspace state
cans done add-dark-mode --json  # gate results
```

All JSON has `ok: boolean` and `exitCode: number` at top level.

## Quality Checklist

Before finalizing any change:

- [ ] Is each concept in exactly one place?
- [ ] Does indentation add meaning? (No filler levels)
- [ ] Can anything be simpler?
- [ ] Did I duplicate an authoritative rule? (Use `see:` instead)
- [ ] Did I invent anything? (Mark TBD if unsure)
- [ ] Is ambiguity visible? (Don't hide unknowns)
- [ ] Did I create a deep hop? (FORBIDDEN: A→B→C)
- [ ] Did I preserve real identifiers exactly?
- [ ] Did I run `cans check` after editing?
