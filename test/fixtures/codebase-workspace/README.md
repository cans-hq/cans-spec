# codebase-workspace — the issue #66 e2e oracle

A realistic mini project: the CANS workspace `cans/` sits next to a source
tree `src/` — exactly the layout the codebase inbound-references scanner
(issue #66) targets. `cans/_rules.yaml` enables the `codebase` block
(`roots: ["."]`, the RFC §3 default include/exclude lists spelled out
verbatim **plus one deliberate extra `**/*.yaml`** so the YAML-comment
variant in `src/net.yaml` joins the scan; the pure default set covers only
`*.rs *.ts *.js *.py *.go *.c *.cpp`), `severity: error`.

This file is the human-readable oracle for `test/issue66-integration.test.ts`:
every embedded pointer, its line, and the outcome the real CLI must produce.
Line numbers below are byte-authoritative for the files as committed.

## The corpus (`cans/`)

Workspace-relative keys (what `<file>` in a pointer resolves against):
`00-overview.md`, `01-auth.md`, `03-storage.md`, `07-network.md`.

Canonical anchor slugs (`cans slug "<node text>"`):

| file            | node text          | slug               |
|-----------------|--------------------|--------------------|
| 01-auth.md      | Sessions           | `Sessions`         |
| 01-auth.md      | Token validation   | `Token-validation` |
| 03-storage.md   | Quotas             | `Quotas`           |
| 07-network.md   | Timeouts           | `Timeouts`         |

Matching is the corpus refs engine's tolerant rule (case- and
separator-insensitive): `#token_validation` also resolves against node
`Token validation`. Resolution is never fuzzy — a near miss earns a
suggestion, never a pass. Each numbered file refs `00-overview.md` (the
orphan-relief hub, no deep hops) and `references.back_pointers: false`
keeps the corpus check-clean, so the suite's exit codes isolate the
codebase band.

`cans/` itself is ALWAYS skipped by the scanner (corpus refs verify in the
refs engine, never twice) — note `cans/_rules.yaml` matches the
`**/*.yaml` include glob and must therefore prove the skip rule: with the
config block on, exactly the five `src/` files below are scanned.

## The source tree (`src/`) — every pointer and its verdict

### `src/session.rs` — Rust line comments; leading prose + trailing notes

| line | written span | verdict |
|---|---|---|
| 2 | `see: 01-auth.md#Sessions` | VALID — file+slug, leading prose `Initial handshake logic;` and trailing `for the canonical flow.` invisible to the match |
| 6 | `see: 01-auth.md#Token-validation` | VALID — canonical slug of node `Token validation`, trailing note `before every retry.` |
| 11 | `see: 01-auth.md#token_validation` | VALID — tolerant match: `token_validation` normalizes equal to `Token-validation` (case- and separator-insensitive); trailing note `- fails closed when the grant is stale` |

3 pointers, 0 broken.

### `src/api/routes.ts` — the `cans/`-prefixed spelling + the broken slug

| line | written span | verdict |
|---|---|---|
| 2 | `see: cans/01-auth.md#Sessions` | VALID — the `cans/`-prefixed spelling; `raw` keeps the written span verbatim, and the file resolves after ONE optional leading `cans/` is stripped (`01-auth.md` and `cans/01-auth.md` are the same target) |
| 3 | `see: 03-storage.md#Qutas` | **BROKEN — AnchorNotFound.** File resolves; `Qutas` matches no node of `03-storage.md` (near miss of `Quotas`, similarity ≈ 0.83 ≥ the 0.8 suggestion floor → `did you mean` suggestion on the finding, resolution never auto-heals) |
| 6 | `see: 01-auth.md#Sessions` | VALID — file+slug |

3 pointers, 1 broken.

### `src/worker/sweep.go` — the Go block-comment variant

| line | written span | verdict |
|---|---|---|
| 7 | `see: 03-storage.md#Quotas` | VALID — sits inside a `/* … */` block comment; the scanner is text-only, comment syntax is invisible |

1 pointer, 0 broken.

### `src/storage/quota.py` — Python comments; file-only ref + the broken file

| line | written span | verdict |
|---|---|---|
| 3 | `see: 07-network.md` | VALID — file-only ref (no `#slug`; a file-level pointer needs no anchor) |
| 7 | `see: 09-observability.md` | **BROKEN — FileNotFound.** `09-observability.md` is no corpus key with or without a `cans/` prefix |

2 pointers, 1 broken.

### `src/net.yaml` — the YAML-comment variant (joins ONLY via the extra `**/*.yaml`)

| line | written span | verdict |
|---|---|---|
| 2 | `see: 07-network.md#Timeouts` | VALID — a trailing comment on a mapping line; leading `timeout_s: 30` prose invisible |

1 pointer, 0 broken. Under the pure default include list (the
`cans check --codebase` flag with no config block) this file does NOT join
the scan and its pointer is invisible.

## Expected scanner outcomes (the numbers the suite pins)

| scenario | scanned | pointers | broken |
|---|---|---|---|
| config block on (this `_rules.yaml`) | 5 (`src/session.rs`, `src/api/routes.ts`, `src/worker/sweep.go`, `src/storage/quota.py`, `src/net.yaml`) | 10 | 2 |
| flag on, no config block (pure defaults) | 4 (same minus `src/net.yaml`) | 9 | 2 |
| pointers fixed (routes.ts:3 → `#Quotas`, quota.py:7 → `see: 07-network.md`) | 5 | 10 | 0 |

Broken-pointer wire records (exact 7-key shape, deterministic order — file
asc, line asc):

```json
[
  { "type": "CodebaseBrokenReference", "file": "src/api/routes.ts", "line": 3,
    "raw": "see: 03-storage.md#Qutas", "targetFile": "03-storage.md",
    "targetSlug": "Qutas", "reason": "AnchorNotFound" },
  { "type": "CodebaseBrokenReference", "file": "src/storage/quota.py", "line": 7,
    "raw": "see: 09-observability.md", "targetFile": "09-observability.md",
    "targetSlug": null, "reason": "FileNotFound" }
]
```

`severity: error` → both findings are errors → `cans check --codebase`
exits **2** (the repo error-band convention; the RFC's example text shows 1
— that one-number difference is the integration suite's one deliberate
deviation, documented in its header).

Reverse traceability (`cans refs <node> --codebase`, exit 0 either way):

| query | matches (file asc, line asc) |
|---|---|
| `01-auth.md#Sessions` | `src/api/routes.ts:2`, `src/api/routes.ts:6`, `src/session.rs:2` |
| `01-auth.md` (file-level) | `src/api/routes.ts:2`, `src/api/routes.ts:6`, `src/session.rs:2`, `src/session.rs:6`, `src/session.rs:11` |
| `03-storage.md#Timeouts` (no such pointer) | none |
