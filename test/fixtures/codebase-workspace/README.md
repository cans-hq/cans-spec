# codebase-workspace — the issue #66 e2e oracle (extended for issues #67 and #68)

A realistic mini project: the CANS workspace `cans/` sits next to a source
tree `src/` — exactly the layout the codebase inbound-references scanner
(issue #66) targets. `cans/_rules.yaml` enables the `codebase` block
(`roots: ["."]`, the RFC §3 default include/exclude lists spelled out
verbatim **plus one deliberate extra `**/*.yaml`** so the YAML-comment
variants in `src/net.yaml` and `src/plugins/mounts.yaml` join the scan; the
pure default set covers only `*.rs *.ts *.js *.py *.go *.c *.cpp`),
`severity: error`.

This file is the human-readable oracle for `test/issue66-integration.test.ts`,
`test/issue-67-contract.test.ts` and `test/issue-68-contract.test.ts`: every
embedded pointer, its line, and the outcome the real CLI must produce. Line
numbers below are byte-authoritative for the files as committed.

**The issue #67 extension** (the kelir-shaped repro): the four `src/plugins/`
files and the two new spec files reproduce, at fixture scale, the 135 false
"anchor not found" positives the kelir repo hit — Bug 1 (anchors truncated
at `(`, `)`, `,`, `:`, `/`, `^` by the frozen #66 anchor class) and Bug 2
(spec nodes whose `see:` pointer rides as a TITLE SUFFIX never resolve,
because the matcher slugified the whole node line). Every pre-#67 file and
its verdict is unchanged below; the extension only ADDS content.

**The issue #68 extension** (the kelir-shaped repro, round two): the three
`cans/plugins/*.md` spec files and the three `src/plugins/*.rs` sources
reproduce the five remaining false "anchor not found" positives (0.16.0 on
the kelir repo @ 6bc53d3) — the SAME defect class at a new seam: the 0.16.0
cleaning pass is ONE-SIDED. The slug algorithm preserves every
non-separator character verbatim, so a heading's own trailing `:` survives
into its canonical anchor (`cans slug "SQLite UDS bridge mechanics:"` →
`SQLite-UDS-bridge-mechanics:`) — that colon spelling is what the kelir
code writes. The ANCHOR side is cleaned at extraction (the trailing run
strips: `...(mux-0x0001):` → `...(mux-0x0001)`, `...mechanics:` →
`...mechanics`), but the HEADING side is never cleaned at matching —
cleaned vs uncleaned never matches. Post-#68 the matcher compares like
with like (cleaned-vs-cleaned) and all five resolve; pre-#68 they were the
five false AnchorNotFound findings. Every pre-#68 file and its verdict is
unchanged below; the extension only ADDS content.

## The corpus (`cans/`)

Workspace-relative keys (what `<file>` in a pointer resolves against):
`00-overview.md`, `01-auth.md`, `03-storage.md`, `07-network.md`,
`09-plugins.md`, `10-lifecycle.md` — plus the issue #68 PLUGIN TIER:
`plugins/db-proxy.md`, `plugins/profile.md`, `plugins/wire-ingress.md`.
Those three are NOT spec files (discovery takes root-level `.md` and
`index.md` only); they join the checked set the way kelir's plugin specs do
— through the issue #65 plugin tier: `cans/_rules.yaml` carries
`references.aliasing.include: ["plugins/*.md"]` with aliasing enabled (the
spelling the #65 refusal hint and kelir's own `_rules.yaml` use). The tier
is refs-only — plugin files get no structure/style/redundancy checks, but
their refs join the graph and they are RESOLVABLE corpus keys for the
codebase scanner, which is exactly the precondition the kelir five assume:
a broken pointer into `cans/plugins/db-proxy.md` is AnchorNotFound, never
FileNotFound. The `cans/plugins/` glob never overlaps the spec corpus, so
the tier can never double-load a file (the #65 exclude rule).

Canonical anchor slugs (`cans slug "<node text>"`):

| file            | node text          | slug               |
|-----------------|--------------------|--------------------|
| 01-auth.md      | Sessions           | `Sessions`         |
| 01-auth.md      | Token validation   | `Token-validation` |
| 03-storage.md   | Quotas             | `Quotas`           |
| 07-network.md   | Timeouts           | `Timeouts`         |
| 09-plugins.md   | Invariants and policy (transaction) | `Invariants-and-policy-(transaction)` |
| 09-plugins.md   | FsInodeAttr carries full mode, uid, gid, size, content | `FsInodeAttr-carries-full-mode,-uid,-gid,-size,-content` |
| 09-plugins.md   | UID/GID mapping isolation | `UID/GID-mapping-isolation` |
| 09-plugins.md   | Dynamic W^X JIT execution mediation | `Dynamic-W^X-JIT-execution-mediation` |
| 09-plugins.md   | Connection parking on suspend (title before the `: see:` suffix) | `Connection-parking-on-suspend` |
| 09-plugins.md   | L7 pgwire rewrite and 2PC commit (title before the `: see:` suffix) | `L7-pgwire-rewrite-and-2PC-commit` |
| 09-plugins.md   | CoW swarm mesh federation (title before the `: see:` suffix) | `CoW-swarm-mesh-federation` |
| 10-lifecycle.md | Native checkpoint plane (kelir-core::checkpoint) | `Native-checkpoint-plane-(kelir-core::checkpoint)` |
| plugins/db-proxy.md (plugin tier) | SQLite UDS bridge mechanics: | `SQLite-UDS-bridge-mechanics:` — the trailing `:` IS the canonical slug, `cans slug` preserves it (issue #68) |
| plugins/profile.md (plugin tier) | Inversion-of-Control configuration router: | `Inversion-of-Control-configuration-router:` |
| plugins/wire-ingress.md (plugin tier) | Ingress stream framing on stream kind L4_FORWARD (mux 0x0001): | `Ingress-stream-framing-on-stream-kind-L4-FORWARD-(mux-0x0001):` |

Matching is the corpus refs engine's tolerant rule (case- and
separator-insensitive): `#token_validation` also resolves against node
`Token validation`. Resolution is never fuzzy — a near miss earns a
suggestion, never a pass. Each numbered file refs `00-overview.md` (the
orphan-relief hub, no deep hops) and `references.back_pointers: false`
keeps the corpus check-clean, so the suite's exit codes isolate the
codebase band.

The three `: see:`-suffixed nodes of `09-plugins.md` (verbatim from the
issue) point at NON-SPEC artifact targets — `artifacts/examples/
serverless-webhook.ts`, `db-backed-runtime.py`, `multi-vm-swarm.rs`. Those
three files exist under `cans/artifacts/examples/` (the corpus ref engine
resolves `see:` targets against the workspace root), where they are plain
non-spec content: never discovered as spec files (no `index.md` above
them, not root-level `.md`) and never scanned by the codebase phase
(everything inside `cans/` is always skipped — they are the living proof
of that skip rule, since `**/*.ts`/`**/*.rs`/`**/*.py` would otherwise
match them). They are terminal file-level targets (issues #44/#60).

`cans/` itself is ALWAYS skipped by the scanner (corpus refs verify in the
refs engine, never twice) — note `cans/_rules.yaml` matches the
`**/*.yaml` include glob and must therefore prove the skip rule: with the
config block on, exactly the twelve `src/` files below are scanned.

### The redundancy knobs in `cans/_rules.yaml` (issue #67)

The extension is verbatim where the issue is verbatim, and the pre-#67
corpus is frozen — so the mini-corpus reuses function words and near-form
words by construction: the kelir headings alone push `on` to four nodes
(`parking on suspend` + three pre-existing) and collide at exactly the
typo layer's default distance (`native`↔`active`, `rewrite`↔`write` —
Levenshtein 2, the issue #47 false-positive class). A warning there would
muddy the exit-code bands this fixture isolates, so the §18 knobs carry
`word_frequency_threshold: 5` (one notch of headroom; the layer stays
armed) and `fuzzy: false` (the near-miss layer off). Every other check
stays on; the corpus remains check-clean. The issue #68 plugin-tier files
add nothing here either way: the tier is refs-only, so their vocabulary
never reaches the redundancy layers at all.

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

### `src/plugins/transaction.rs` — Rust line comments; the punctuation anchors (issue #67, Bug 1)

Anchors as written in the kelir source, full punctuation spellings:

| line | written span | verdict |
|---|---|---|
| 2 | `see: cans/09-plugins.md#Invariants-and-policy-(transaction)` | VALID — the PAREN anchor, `cans/`-prefixed kelir spelling; the heading `Invariants and policy (transaction)` exists verbatim as a spec node |
| 3 | `see: 09-plugins.md#FsInodeAttr-carries-full-mode,-uid,-gid,-size,-content` | VALID — the COMMA-LIST anchor (heading verbatim in `09-plugins.md`) |
| 4 | `see: 09-plugins.md#UID/GID-mapping-isolation` | VALID — the SLASH anchor |
| 5 | `see: 09-plugins.md#Dynamic-W^X-JIT-execution-mediation` | VALID — the CARET anchor |

4 pointers, 0 broken (post-#67). Pre-#67 the frozen anchor class
`[A-Za-z0-9_-]+` truncated every one of them at the first `(` / `,` / `/`
/ `^` — `Invariants-and-policy-`, `FsInodeAttr-carries-full-mode`, `UID`,
`Dynamic-W` — four false AnchorNotFound findings, the Bug 1 repro.

### `src/plugins/checkpoint.go` — Go block + line comments; the `::` anchor and the glued closers (issue #67, Bug 1)

| line | written span | verdict |
|---|---|---|
| 7 | `see: cans/10-lifecycle.md#Native-checkpoint-plane-(kelir-core::checkpoint)` | VALID — the `::`-CONTAINING anchor inside a block comment; the closer `)` is backed by the unmatched `(` and stays part of the anchor |
| 11 | `see: cans/09-plugins.md#Invariants-and-policy-(transaction))` | VALID — the GLUED-CLOSER case inside `/* (see: …)) */`: `raw` keeps the verbatim matched span (double `)`), while the captured anchor strips the trailing closer run and RESTORES the one `)` backed by the unmatched `(` → `Invariants-and-policy-(transaction)` |
| 14 | `see: 09-plugins.md#UID/GID-mapping-isolation);` | VALID — GLUED PROSE CLOSERS `);` with no unmatched opener: they strip fully from the anchor (→ `UID/GID-mapping-isolation`), `raw` keeps them verbatim |

3 pointers, 0 broken (post-#67). Pre-#67: lines 7/11 truncated at `(` and
line 14 at `/` — three false AnchorNotFound findings.

### `src/plugins/ingress.py` — Python comments; the suffix-node targets (issue #67, Bug 2)

Code points at the BARE titles of the `: see:`-suffixed spec nodes:

| line | written span | verdict |
|---|---|---|
| 3 | `see: cans/09-plugins.md#Connection-parking-on-suspend` | VALID — the node `Connection parking on suspend: see: artifacts/examples/serverless-webhook.ts` resolves by its title with the trailing `: see: <token>` suffix stripped |
| 7 | `see: cans/09-plugins.md#L7-pgwire-rewrite-and-2PC-commit` | VALID — same class, node `L7 pgwire rewrite and 2PC commit: see: artifacts/examples/db-backed-runtime.py` |
| 11 | `see: cans/09-plugins.md#CoW-swarm-mesh-federation` | VALID — same class, node `CoW swarm mesh federation: see: artifacts/examples/multi-vm-swarm.rs` |

3 pointers, 0 broken (post-#67). Pre-#67 the anchors extracted whole, but
node-title matching slugified the ENTIRE node line (suffix included), so
all three were false AnchorNotFound findings — the Bug 2 repro.

### `src/plugins/mounts.yaml` — the YAML-comment variant, punctuation anchor (joins ONLY via the extra `**/*.yaml`)

| line | written span | verdict |
|---|---|---|
| 2 | `see: 09-plugins.md#FsInodeAttr-carries-full-mode,-uid,-gid,-size,-content` | VALID — the comma-list anchor via the YAML trailing-comment variant; leading `fsinode_mode: full` prose invisible |

1 pointer, 0 broken (post-#67; pre-#67 truncated at `,`). Like
`src/net.yaml`, this file joins ONLY through the config's extra
`**/*.yaml` — under the pure default include list it is invisible.

### `src/plugins/db-proxy.rs` — Rust line comments; the colon-titled heading anchor, twice (issue #68)

Anchors as written in the kelir source — the CANONICAL colon spellings
(`cans slug "SQLite UDS bridge mechanics:"` returns the colon verbatim):

| line | written span | verdict |
|---|---|---|
| 42 | `see: cans/plugins/db-proxy.md#SQLite-UDS-bridge-mechanics:` | VALID (post-#68) — the COLON anchor at the kelir line; `cans/plugins/db-proxy.md` resolves through the issue #65 plugin tier (AnchorNotFound territory, never FileNotFound), the heading `SQLite UDS bridge mechanics:` exists verbatim at `cans/plugins/db-proxy.md:19` |
| 141 | `see: cans/plugins/db-proxy.md#SQLite-UDS-bridge-mechanics:` | VALID (post-#68) — the SAME spelling again in the test module (the kelir double occurrence) |

2 pointers, 0 broken (post-#68). Pre-#68: the anchor side is cleaned at
extraction (`...mechanics:` → `...mechanics`) while the heading side
keeps its own trailing `:` — cleaned vs uncleaned never matched — two
false AnchorNotFound findings, the one-sided-cleaning repro.

### `src/plugins/profile.rs` — Rust line comments; the hyphen-chained colon anchor (issue #68)

| line | written span | verdict |
|---|---|---|
| 21 | `see: cans/plugins/profile.md#Inversion-of-Control-configuration-router:` | VALID (post-#68) — the colon anchor over the heading `Inversion-of-Control configuration router:` at `cans/plugins/profile.md:17`; note the heading hyphenates `Inversion-of-Control` while the anchor hyphenates every separator — both normalize equal |

1 pointer, 0 broken (post-#68). Pre-#68: one false AnchorNotFound
finding — the same cleaned-vs-uncleaned seam.

### `src/plugins/wire-ingress.rs` — Rust line comments; the colon-over-bracket anchor, twice (issue #68)

| line | written span | verdict |
|---|---|---|
| 18 | `see: cans/plugins/wire-ingress.md#Ingress-stream-framing-on-stream-kind-L4-FORWARD-(mux-0x0001):` | VALID (post-#68) — the kelir spelling with the trailing `):` run: the extraction cleaning strips the run and RESTORES the opener-backed `)` → targetSlug `Ingress-stream-framing-on-stream-kind-L4-FORWARD-(mux-0x0001)`; the heading `Ingress stream framing on stream kind L4_FORWARD (mux 0x0001):` sits verbatim at `cans/plugins/wire-ingress.md:23` (its `L4_FORWARD` underscore and the anchor's `L4-FORWARD` hyphen normalize equal) |
| 85 | `see: cans/plugins/wire-ingress.md#Ingress-stream-framing-on-stream-kind-L4-FORWARD-(mux-0x0001):` | VALID (post-#68) — the same spelling at the second kelir occurrence, in the encoder's contract comment |

2 pointers, 0 broken (post-#68). Pre-#68: two false AnchorNotFound
findings — the heading's own `):` is slug-preserved and was never cleaned
on the matching side.

## Expected scanner outcomes (the numbers the suites pin)

| scenario | scanned | pointers | broken |
|---|---|---|---|
| config block on (this `_rules.yaml`) | 12 (the 9 pre-#68 files plus `src/plugins/db-proxy.rs`, `src/plugins/profile.rs`, `src/plugins/wire-ingress.rs`) | 26 | 2 |
| flag on, no config block (pure defaults, plugin tier kept on) | 10 (same minus `src/net.yaml` and `src/plugins/mounts.yaml` — the three new files are `.rs`, covered by the default `**/*.rs`) | 24 | 2 |
| aliasing include dropped (tier off, config block kept) | 12 | 26 | 7 — the 2 true plus the five #68 pointers as FileNotFound (the tier is what makes `cans/plugins/*.md` resolvable) |
| pointers fixed (routes.ts:3 → `#Quotas`, quota.py:7 → `see: 07-network.md`) | 12 | 26 | 0 |

The 2 broken are exactly the PRE-#67 pair — every issue-#67 pointer
(both bug classes) AND every issue-#68 pointer is VALID post-#68.
Pre-#68 the broken count is 7: the 2 true plus the five false
AnchorNotFound findings of the one-sided cleaning (db-proxy.rs:42/141,
profile.rs:21, wire-ingress.rs:18/85 — each earns a `did you mean
cans/plugins/…#<colon spelling>:?` suggestion, the fuzzy layer already
knew the answer). Broken-pointer wire records (exact 7-key shape,
deterministic order — file asc, line asc):

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

Reverse traceability (`cans refs <node> --codebase`, exit 0 either way).
The #68 plugin-tier files are OUTSIDE the v1 query corpus: `cans refs`
resolves its node query against DISCOVERED spec keys only (root-level
`.md` + `index.md` — the command's header documents that the check
engine's promotion loop and plugin tier are deliberately not
reimplemented there), so a query naming `cans/plugins/db-proxy.md` (or
its workspace-relative spelling, with or without the colon anchor)
REFUSES: `ok:false`, exit 1, `no spec file matches "cans/plugins/
…" — refs --codebase resolves against the workspace corpus (cans/)`.
That refusal — not a silent empty answer — is the pinned v1 boundary;
the corpus-side colon resolution the #68 matcher widening delivers is
pinned instead through a transient plugin-file `see:` (both spellings,
colon and colon-less, resolve post-#68; pre-#68 both were broken anchors
— the same one-sided seam on the corpus refs engine).

| query | matches (file asc, line asc) |
|---|---|
| `01-auth.md#Sessions` | `src/api/routes.ts:2`, `src/api/routes.ts:6`, `src/session.rs:2` |
| `01-auth.md` (file-level) | `src/api/routes.ts:2`, `src/api/routes.ts:6`, `src/session.rs:2`, `src/session.rs:6`, `src/session.rs:11` |
| `03-storage.md#Timeouts` (no such pointer) | none |
| `09-plugins.md#Invariants-and-policy-(transaction)` | `src/plugins/checkpoint.go:11`, `src/plugins/transaction.rs:2` |
| `09-plugins.md#FsInodeAttr-carries-full-mode,-uid,-gid,-size,-content` | `src/plugins/mounts.yaml:2`, `src/plugins/transaction.rs:3` |
| `09-plugins.md#UID/GID-mapping-isolation` | `src/plugins/checkpoint.go:14`, `src/plugins/transaction.rs:4` |
| `09-plugins.md#Dynamic-W^X-JIT-execution-mediation` | `src/plugins/transaction.rs:5` |
| `10-lifecycle.md#Native-checkpoint-plane-(kelir-core::checkpoint)` | `src/plugins/checkpoint.go:7` |
| `09-plugins.md#Connection-parking-on-suspend` | `src/plugins/ingress.py:3` |
| `09-plugins.md#L7-pgwire-rewrite-and-2PC-commit` | `src/plugins/ingress.py:7` |
| `09-plugins.md#CoW-swarm-mesh-federation` | `src/plugins/ingress.py:11` |
| `09-plugins.md` (file-level) | all ten into `09-plugins.md`: `src/plugins/checkpoint.go:11`, `src/plugins/checkpoint.go:14`, `src/plugins/ingress.py:3`, `src/plugins/ingress.py:7`, `src/plugins/ingress.py:11`, `src/plugins/mounts.yaml:2`, `src/plugins/transaction.rs:2`, `src/plugins/transaction.rs:3`, `src/plugins/transaction.rs:4`, `src/plugins/transaction.rs:5` |
| `09-plugins.md#Invariants-and-policy` (truncated spelling — no fuzzy healing) | none |
