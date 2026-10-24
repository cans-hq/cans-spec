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

Anchor spelling (`#Sessions`): the node title with every dash, `_`, and
whitespace run collapsed to one `-` — everything else verbatim, case
preserved (`Layer 1 — C authorizer` → `#Layer-1-C-authorizer`). Not sure?
`cans slug "<node text>"` prints the exact fragment; `cans slug
<file>:<line>` prints it for the node on that line.

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

No build step. Source IS distribution. Two runtimes are supported — Bun is the
primary, Node.js is the fallback (issue #12):

- **Bun ≥ 1.0 (recommended, primary)** — fastest path, used automatically when
  Bun is on your PATH.
- **Node.js ≥ 23.2 (fallback)** — for Termux / Android harnesses and any
  environment without Bun. Termux: `pkg install nodejs` (ships Node 26.x ✓).
  Node's builtin TypeScript stripping runs the sources directly; running from
  a source checkout also works on Node ≥ 22.6 via `--experimental-strip-types`.

**npm**

```bash
npm install -g cans-spec
```

**Bun**

```bash
bun install -g cans-spec
```

**One-shot, no install**

```bash
npx -p cans-spec cans init
# or, with Bun installed:
bunx cans-spec init
```

All three give you the same `cans` command:

```bash
cd your-project
cans init
```

Done. You have a `cans/` directory. Start writing bullets.

### How to use it

1. **Scaffold** — `cans init` creates `cans/` with 7 spec files, `_adr/`, `_tasks/`, `_collab/`. Use `cans init --flat` for a flat layout, `--bare` for the minimal skeleton, `--tool claude` to also emit `CLAUDE.md`.
2. **Write your spec as dense bullets** — hierarchy is indentation, cross-links are `see:` references. The outline is the spec; there is nothing else to learn.
3. **Check health** — `cans check` lints structure, broken refs, deep hops, redundancy, and style. `cans check --fix` repairs back-pointers and proposes broken-anchor fixes; `--fix --yes` applies them, `--fix --dry-run` previews everything. Exit codes: `0` clean · `1` warnings · `2` errors — agents read `$?`, skip parsing.
4. **Track work** — `cans new task add-dark-mode` creates a task, `cans status` shows the board, `cans done add-dark-mode` archives it (it blocks on `← @human` gates until a human signs off).
5. **Mind the budget** — `cans budget read <concept>` gives your agent a token-budgeted reading plan; `cans budget write <concept>` says what it may edit.
6. **Interoperate** — `cans export logseq --from cans` and `cans import logseq <path>` round-trip OPML / Dynalist, Logseq, and Obsidian. State lives in git; the transport layer is a plain text format your tools already read.

Everything else — ADRs, ownership arrows (`← agent-1`, `← @human`), rules in `_rules.yaml` — is documented inline by the scaffolded files.

---

## Commands

```
cans init          scaffold workspace
cans check         validate everything (structure, refs, style, redundancy)
cans new adr       create a decision record
cans new task      create a task file
cans done          archive completed task (blocks on ← @human gates)
cans status        workspace summary
cans budget read   token-budgeted reading plan for a concept
cans budget write  what you can / can't edit for a concept
cans import        bring in OPML / Logseq / Obsidian
cans export        push out to OPML / Logseq / Obsidian
cans slug          the canonical #anchor fragment for a node text or file:line
cans alias         expand|collapse pointer aliases (see references.aliasing)
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

`cans check` runs four deterministic engines. No ML. No LLM. No embeddings.

| Engine | Catches |
|---|---|
| **Structure** | Node length, depth, sibling count, single-child collapse, empty nodes |
| **Style** | Sibling vs nested grouping, shared prefix detection |
| **References** | Broken `see:`, broken anchors (incl. schematic leaf paths in JSON/YAML/TOML — issue #58), deep hops (A→B→C; refs to on-disk non-spec files like `artifacts/*.ts` are exempt — issue #44), self-refs, orphans, stale back-pointers |
| **Redundancy** | Word frequency, phrase overlap, fuzzy typos, cross-file duplication |

Configure in `cans/_rules.yaml`. Delete a key to disable that check. No
migration. `structure.node_length.max` is the single node-length budget
(the overflow engine that offered a second one was removed — issue #56:
a limit routable with one short `see:` pointer was not a limit).

`_rules.yaml` is validated STRICTLY (issue #56): an unrecognized key — a
typo like `node_lenght`, or a removed one like `overflow.max_node_chars` —
or a value outside its documented domain (wrong type, out-of-range number,
unknown enum member) is a line-numbered config error and the check does not
run. A missing or empty file keeps all defaults.

Redundancy specifics: `see:` ref targets are structural, not content — the
redundancy layers compare label words only, so a file stem like `10-sdk.md`
never pollutes word frequency or overlap. The fuzzy-typo layer is tunable
without turning it off: `redundancy.fuzzy_max_distance` (default 2) and
`redundancy.fuzzy_min_word_length` (default 5); numeric stopwords
(`- 10`) work unquoted.

Subfolder `.md` files join the same engines: a file a spec points at
(`see: plugins/pty.md`) is promoted to a first-class spec file for the whole
run; unreferenced ones are plain non-spec content (invisible to the
engines, like any non-spec repo file).

Anchors into schematic files are verified down to leaves (issue #58): a
`see: artifacts/config.yaml#database.host` pointer is checked against the
parsed key paths of the target — same for `.json` and `.toml`, one anchor
form across all three formats. Dot paths address nested keys (`items.0` or
`items[0]` for sequence items, `a\.b` for a key containing a dot); an
existing leaf passes, a missing leaf is a `refs.broken.anchor` error, a flat
name matching several leaves (`#port` under `database` and `server`) is an
error listing the full paths, and a malformed schematic is a parse error at
the pointer site — never a silent pass. Schematic files are parsed only when
a pointer actually anchors into them. External `name://` targets get the
same vocabulary through the same code path.

### Inter-repo pointers (`external_roots`)

A spec can point at files in a sibling repo — the example lives in exactly
one place and the spec still gets a machine-checked pointer. Declare the
roots in `cans/_rules.yaml` (paths resolve from the project root, the parent
of `cans/`), then use `name://sub/path` in `see:` targets:

```yaml
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
- export_snapshot, import_snapshot: see: kelir-cloud://artifacts/examples/db-backed-runtime.py
- adjust_balloon: see: kelir-cloud://artifacts/examples/serverless-webhook.ts
```

Semantics: only declared roots resolve (an undeclared `name://` is a broken
ref, and plain `../` escapes stay broken refs — containment is enforced
lexically and after symlink resolution, so a pointer can never read outside
its root). Inter-repo pointers are terminal targets like artifacts: one hop
under `max_hops: 1`, never promoted into the spec graph, no back-pointer
required in the external repo, and `http://`/`https://` targets are URLs,
never pointers. A missing file under a present root is a broken ref
(`orphan_check`), a sub-path that exists in two roots trips
`duplicate_home_check`, and a declared root that is not checked out is a
warning — pointers into it are simply unverified, so CI that only clones the
spec repo stays green.

### Pointer aliasing (`references.aliasing`)

When the same target is pointed at repeatedly inside one file, spell it once
and use short footnote-style aliases. Opt-in, per file (issue #57):

```yaml
references:
  aliasing:
    enabled: true        # opt-in; default false
    scope: file          # the only legal scope in v1
    style: both          # numeric | named | both (which spellings are legal)
    min_uses: 2          # only targets used >= N times in the file are alias-eligible
```

```text
# cans/07-lifecycle.md — six short uses instead of six full targets
- map_shared_region: see: [1]
- register_veto: see: [2]
- export_snapshot, import_snapshot: see: [3]
- adjust_balloon: see: [4]
- set_balloon_target: see: [4]
- teardown_balloon: see: [4]

- [1]: kelir-cloud://artifacts/examples/multi-vm-swarm.rs
- [2]: 02-plugin-model.md#Core-context-keys
- [3]: 01-architecture.md#VirtIO-Device-Complex
- [4]: artifacts/code/plugin-trait.rs
```

Semantics: an alias resolves EXACTLY like the full pointer it stands for —
file existence, anchor match, external roots, containment, duplicate-home
and `orphan_check` all apply, and every use counts as a ref for graph, hop,
SCC and orphan purposes (aliasing cannot hide graph edges or dodge deep-hop
checks; `cans check` output on the aliased and expanded forms of a file is
identical in the refs layer). A broken definition fails the run even with
zero uses; an undefined use is a broken-ref error; an unused definition is a
warning. Scope is the defining file only — no cross-file leakage. Definition
lines are file metadata, never outline nodes: they never count against
`node_length` or sibling caps, and a use site measures its WRITTEN spelling
(`label: see: [1]`), so a long target plus a label no longer forces the
pointer onto a bare child node. Aliasing disabled plus any alias use or
definition present is an ERROR, never a silent pass — the fix is
`cans alias expand`.

`cans alias collapse` migrates a full-pointer corpus (repeated targets →
definitions + short uses, deterministic first-use numbering, per the
`_rules.yaml` config) and `cans alias expand` migrates it back. Both are
lossless for non-pointer text, idempotent, and REFUSE — leaving files
byte-identical, problems named — on undefined or anchored alias uses,
duplicate/illegal definitions, style or `min_uses` conflicts, and prose
that merely looks like an alias (bracketed text that is not alias-shaped
keeps its see-like-prose warning). `--dry-run` previews. `cans export`
renders alias uses as their full targets — consumers outside the workspace
cannot see its definitions.

```bash
cans check                  # human-readable: one line per pattern, count prefixes,
                            # root-cause grouping, timing on the summary line
cans check --json           # machine-readable: sections → {file, line, rule, detail}
cans check --show redundancy  # expand a folded section (structure|style|refs|
                            #   redundancy|all — comma-separated list works)
cans check --hints          # opt in to the slug-hint info notes (off by default)
cans check --fix            # rebuild back-pointer comments; propose anchor repairs
                            #   (--yes applies them, --dry-run previews all changes)
cans check --strict         # warnings flip `ok` to false
cans check 04-api.md        # single file
```

The default report groups repeated findings: `61× <min children (2/3)` instead
of 61 identical lines, `91× missing file` with per-target counts instead of 91
lines + 91 fix hints. Fix hints appear once per pattern; every `file:line`
stays present in compact comma lists. Exit codes: `0` clean · `1` warnings ·
`2` errors.

An invalid `_rules.yaml` is a config error, not a finding: exit `2`, the
diagnosis printed standalone (`✗ invalid _rules.yaml: line N: …`), and in
`--json` a single `sections.config` entry (`rule: "config.invalid"`, `file:
"_rules.yaml"`) plus the top-level `error` field — never filed under `refs`.

Info notes (`ℹ`) are hints, not findings — and since issue #59 they are
OPT-IN. A node whose title slugs non-obviously (`Layer 1 — C authorizer` →
`#Layer-1-C-authorizer`) gets an info-level note naming the exact anchor
only when you ask for the band: `cans check --hints` (folded, fully with
`--show refs`, included in `--json`), or `output.slug_hints: true` in
`cans/_rules.yaml` (flag or config — either enables; default off in both).
Info never changes the exit code, `ok`, or the error/warning counts. A
plain check is quiet, and a plain `--json` excludes info items entirely —
the `refs` section carries a single `hintCount` integer (present only when
non-zero) so agents can see how many hints exist before paying for them.
**Breaking (0.9.0):** scripts parsing `--json` for info items now need
`--hints`. A broken-anchor error still suggests the corrected ref —
`did you mean <file>#<slug>?` — because that advice rides on a real
finding. For one anchor on demand, `cans slug "<node text>"` needs no
flag at all.

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

**Folder mode** works at any depth: `02-authentication/index.md` instead of
`02-authentication.md`, and `plugins/topic/index.md` is discovered like any
root file. Flat wins over folder; when both exist, `cans check` flags a
duplicate home.

**Subfolder content files** — any other `.md` inside a folder, like
`cans/plugins/pty.md` — are plain non-spec content by default: invisible
to the engines, like any non-spec repo file. The moment a spec file points
at one (`see: plugins/pty.md`), `cans check` promotes it transitively to a
first-class spec file: counted in the summary, subject to every engine, and
free to reference back (the mutual back-reference mesh — the sanctioned
pattern under `max_hops: 1`). Want a subfolder file checked? Reference it
from a spec file — that is the promotion trigger. `cans status` and
`cans export` list discovered files (root `.md` plus any-depth `index.md`)
without promotion.

---

## How we compare

**vs. [OpenSpec](https://github.com/Fission-AI/OpenSpec)** — Comprehensive but heavy. 200+ files, 4-artifact pipelines, 30+ adapters, 50k–100k tokens per invocation. CANS is 1080 lines, zero deps, 800 tokens. You don't need a framework. You need a file.

**vs. [Spec Kit](https://github.com/github/spec-kit)** (GitHub) — Rigid phase gates, Python setup, lots of Markdown. CANS has no phases. You edit the spec. That's the workflow.

**vs. [Kiro](https://kiro.dev)** (AWS) — Locked to their IDE, limited to Claude. CANS is a CLI that reads markdown files. Works with any agent, any editor, any model.

**vs. nothing** — AI coding without specs means vague prompts and drift. CANS gives you a contract in 800 tokens of agent instructions instead of 36,000.

---

## Requirements

- [Bun](https://bun.sh) ≥ 1.0 (primary) **or** Node.js ≥ 23.2 (fallback, no Bun needed — Termux: `pkg install nodejs`)
- Git (for coordination; not required by CANS itself)
- An AI agent that can read markdown (all of them)

No Python. No `package-lock.json`. No build step. The `dependencies` field in `package.json` does not exist — zero runtime dependencies on both runtimes.

---

## Contributing

The entire codebase is ~1100 lines of TypeScript across 20 files. Read it in an afternoon.

- `bun test` runs the suite on the primary runtime; `npm run test:node` runs the same suite on the Node fallback (node:test via a tiny bun:test compat shim in `test/node-compat.ts`)
- CI runs both (`test-bun` + `test-node` matrix on Node 22/24)
- All runtime-sensitive IO goes through one shim, `src/core/runtime.ts` — the only file allowed to touch Bun APIs; a self-audit test keeps it that way
- No build step. Edit `src/`, run `bun test`, done.
- PRs that add features get closed. PRs that delete code get merged.
- If you want a new command, open an issue and justify it. Most get rejected. That's the point.

---

## License

MIT
