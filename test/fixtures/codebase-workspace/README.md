# codebase-workspace — the issue #66 e2e oracle (extended for issues #67, #68, #69 and #70)

A realistic mini project: the CANS workspace `cans/` sits next to a source
tree `src/` — exactly the layout the codebase inbound-references scanner
(issue #66) targets. `cans/_rules.yaml` enables the `codebase` block
(`roots: ["."]`, the RFC §3 default include/exclude lists spelled out
verbatim **plus one deliberate extra `**/*.yaml`** so the YAML-comment
variants in `src/net.yaml` and `src/plugins/mounts.yaml` join the scan; the
pure default set covers only `*.rs *.ts *.js *.py *.go *.c *.cpp`),
`severity: error`.

This file is the human-readable oracle for `test/issue66-integration.test.ts`,
`test/issue-67-contract.test.ts`, `test/issue-68-contract.test.ts`,
`test/issue-69-contract.test.ts` and `test/issue-70-contract.test.ts`: every
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

**The issue #69 extension** (the artifact-target tier): the cans layout
breeds a second pointer class the corpus-only grammar could not even see —
code pointing at the workspace's NON-SPEC artifact files (`// see:
cans/artifacts/code/plugin-trait.rs#PluginError`, a YAML key under
`cans/_rules.yaml`, a diagram heading). On the reporter's repo 114 of 1523
codebase `see:` pointers target non-`.md` files (25 distinct: `.rs`, `.ts`,
`.py`, `.yaml`, `.txt`, plus `cans/_rules.yaml`) — all silently unvalidated:
`check --codebase` skipped them and `cans refs` refused their queries as
malformed, the issue's exact repro. The extension adds the artifact target
`cans/artifacts/diagrams/host-runtime.txt` (underlined `driver-avf` /
`driver-virtio` section headings — the #60 text-heading vocabulary) and the
scanned source `src/plugins/artifact-wiring.rs` carrying six pointers, one
per comment line: three VALID (one per anchor tier — a #60 code symbol, a
#60 text heading, a #58 schematic dot path into `cans/_rules.yaml`) and
three BROKEN (the issue's own spellings). Every pre-#69 file and its
verdict is unchanged below; the extension only ADDS content, and it adds
NO new corpus files: the artifact targets are WORKSPACE files, never
scanned (the scan never enters `cans/`) and never corpus — `cans refs`
reaches them through the artifact query tier (issue #69), but discovery
never loads them.

**The issue #70 extension** (the kelir-shaped repro, round three): 0.18.0 on
kelir minted 16 `codebase.broken_reference` errors + 19 `codebase.anchor.
no-target` warnings for pointers that were RIGHT — anchors that exist in
their targets as trait methods, no-`pub` unit structs, referenced names
(imports/uses/field accesses) and text tokens (tree entries, box lines).
The #60 code-symbol grammar minted `pub` column-0 items ONLY, so a trait
method (`async fn configure_runtime` inside `pub trait ContainerService`)
and a no-`pub` unit struct (`struct UserOracle;`) were invisible; and no
vocabulary at all addressed a name that merely APPEARS in the target (an
import token, a field access) or a text token inside a tree/box line —
so those anchors hit either a false `AnchorNotFound` error (target has
SOME vocabulary) or the no-target advisory (target has none). The
extension adds the REAL kelir artifact shapes — `cans/artifacts/code/
container-service.rs` (the 53-line trait file, verbatim), `cans/artifacts/
examples/swarm-agent.rs` + `db-runtime.py` (compact miniatures preserving
the cited lines verbatim), the multi-vm-swarm.rs and host-runtime.txt
EXTENSIONS (every pre-#70 byte kept — the #69 pins ride `pub fn federate`
and the underlined `driver-avf`/`driver-virtio` headings), `cans/artifacts/
config/project-structure.txt` (the tree miniature with the verbatim
kelir-shim line and the trailing ATX section), `cans/artifacts/diagrams/
four-ring-bus.txt` (the real 10-line diagram, verbatim) and `cans/artifacts/
diagrams/empty-metrics.txt` (the EMPTY target — the warnings-only class) —
plus the scanned source `src/plugins/trait-wiring.rs` carrying eighteen
pointers, one per cited shape: fifteen VALID (three trait methods, the unit
struct, four referenced names of the agent example, two of the db example,
two plugin names of the swarm example, three text tokens), two near-miss
typos kept broken on purpose, one at the empty target (the advisory class).
Every pre-#70 file and its verdict is unchanged below; the extension only
ADDS content, and it adds NO new corpus files: all the new targets are
WORKSPACE artifacts under `cans/` — never scanned, never spec — and the
one new source is `src/`, exactly the #69 pattern.

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
match them). They are terminal file-level targets (issues #44/#60). The
issue #69 extension adds one more artifact in the same class:
`cans/artifacts/diagrams/host-runtime.txt`, a plain-text diagram whose
underlined section headings (`driver-avf`, `driver-virtio`) make it an
ANCHORED target (the #60 text-heading vocabulary) — same rules, never
spec, never scanned.

`cans/` itself is ALWAYS skipped by the scanner (corpus refs verify in the
refs engine, never twice) — note `cans/_rules.yaml` matches the
`**/*.yaml` include glob and must therefore prove the skip rule: with the
config block on, exactly the thirteen `src/` files below are scanned.

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

### `src/plugins/artifact-wiring.rs` — Rust line comments; the artifact-target pointers (issue #69)

The issue's pointer class at fixture scale: six `see:` pointers at
non-`.md` workspace targets, one per comment line. Post-#69 the artifact
tier validates them (file via the workspace filesystem, anchor via the
shared artifact vocabularies); pre-#69 (0.17.0) all six were invisible —
`check --codebase` counted 26 pointers, not 32, and reported none of the
broken ones.

| line | written span | verdict |
|---|---|---|
| 14 | `see: cans/artifacts/examples/multi-vm-swarm.rs#federate` | VALID — the CODE-SYMBOL anchor: the artifact exists under the workspace (`pub fn federate` sits at `cans/artifacts/examples/multi-vm-swarm.rs:7`), and the symbol resolves through the #60 code vocabulary |
| 21 | `see: cans/artifacts/diagrams/host-runtime.txt#driver-avf` | VALID — the TEXT-HEADING anchor: the artifact's underlined `driver-avf` section heading (the #60 text vocabulary) |
| 28 | `see: cans/_rules.yaml#codebase.enabled` | VALID — the SCHEMATIC anchor: the fixture's own rules file parses with the #58 YAML subset parser and the dot path resolves to a scalar leaf (verified: no fallback config file needed) |
| 36 | `see: cans/artifacts/examples/multi-vm-swarm.rs#federateNope` | **BROKEN — AnchorNotFound.** File resolves; `federateNope` matches no symbol of the artifact (near miss of `federate` → `did you mean` suggestion, resolution never auto-heals) |
| 40 | `see: cans/artifacts/diagrams/host-runtime.txt#driver-avf-nope` | **BROKEN — AnchorNotFound.** File resolves; `driver-avf-nope` matches no heading |
| 46 | `see: cans/artifacts/code/plugin-trait.rs#PluginError` | **BROKEN — FileNotFound.** The issue's exact spelling: at #69 time no `cans/artifacts/code/` directory existed on this fixture at all; since the #70 extension the directory exists (it holds `container-service.rs`) but the FILE still does not — the verdict is unchanged, the artifact target is still missing from the cans workspace |

6 pointers, 3 broken (post-#69). The three VALID pointers produce no
findings; the three BROKEN ones are the issue's own repro, kept broken on
purpose.

### `src/plugins/trait-wiring.rs` — Rust line comments; the grammar-v2 and leaf-tier pointers (issue #70)

The issue #70 pointer classes at fixture scale: eighteen `see:` pointers at
the new artifact targets, one per comment line, spread over plausible
wiring prose. Post-#70 the declaration grammar v2 (trait methods inside
`pub trait` blocks, no-`pub` column-0 declarations) and the LEAF tier
(every identifier token of a code target, every `[A-Za-z0-9][A-Za-z0-9_\-]*`
token of a `.txt` target) resolve the fifteen VALID ones; pre-#70 (0.18.0)
ALL FIFTEEN were false `codebase.broken_reference` errors — every one of
their targets has SOME pre-#70 vocabulary (a `pub` declaration, a Python
def, a text heading), so each miss took the ERROR path, exactly the issue's
class-A/class-B-error report. The two typos are near misses kept broken on
purpose, and the empty-metrics pointer is the issue's warnings-only class
(the no-target advisory — an EMPTY target has nothing addressable by ANY
vocabulary, so no anchor could ever resolve there by construction).

| line | written span | verdict |
|---|---|---|
| 15 | `see: cans/artifacts/code/container-service.rs#configure_runtime` | VALID (post-#70) — the TRAIT-METHOD anchor: `async fn configure_runtime(&mut self)` inside `pub trait ContainerService` (the real 53-line file, verbatim); grammar v2 mints the method |
| 22 | `see: cans/artifacts/code/container-service.rs#mount_scratch` | VALID (post-#70) — same class, the scratch-mount method |
| 27 | `see: cans/artifacts/code/container-service.rs#ingest_image` | VALID (post-#70) — same class, the image-ingest method |
| 34 | `see: cans/artifacts/examples/swarm-agent.rs#UserOracle` | VALID (post-#70) — the NO-`pub` COLUMN-0 unit struct: `struct UserOracle;` at the miniature's end, verbatim from the real file |
| 41 | `see: cans/artifacts/examples/swarm-agent.rs#LedgerPlugin` | VALID (post-#70) — the leaf tier: the import token of the INDENTED use-tree inside `main` (`use kelir::{plugins::{ledger::{FinalReceipt, LedgerCtx, LedgerPlugin,},},};`) |
| 46 | `see: cans/artifacts/examples/swarm-agent.rs#binary_blake3` | VALID (post-#70) — the leaf tier: the field-access identifier (`c.trap.binary_blake3.iter()`, `receipt.binary_blake3 != trap_hex`) |
| 51 | `see: cans/artifacts/examples/swarm-agent.rs#FinalizeRequest` | VALID (post-#70) — the leaf tier: the type-position token of the finalize chain |
| 56 | `see: cans/artifacts/examples/swarm-agent.rs#FinalReceipt` | VALID (post-#70) — the leaf tier: the let-binding type token (`let receipt: FinalReceipt = session.ctx::<LedgerCtx>().finalize(FinalizeRequest {`) |
| 63 | `see: cans/artifacts/examples/db-runtime.py#PgWireRewrite` | VALID (post-#70) — the leaf tier: the indented-paren import / `postgres=PgWireRewrite(` constructor token |
| 68 | `see: cans/artifacts/examples/db-runtime.py#DbProxyConfig` | VALID (post-#70) — same class: `.plugin(DbProxyPlugin(DbProxyConfig(` |
| 75 | `see: cans/artifacts/examples/multi-vm-swarm.rs#MeshPlugin` | VALID (post-#70) — the leaf tier: the use-tree name (`mesh::{MeshConfig, MeshPlugin,}`) and the `.plugin(MeshPlugin::new(MeshConfig {` line |
| 80 | `see: cans/artifacts/examples/multi-vm-swarm.rs#SupplyChainPlugin` | VALID (post-#70) — same class: `supply::{SupplyChainPlugin,}` / `.plugin(SupplyChainPlugin::new(SupplyChainConfig {` |
| 88 | `see: cans/artifacts/config/project-structure.txt#kelir-shim` | VALID (post-#70) — the `.txt` LEAF-TOKEN tier: the tree-entry token of `│   ├── kelir-shim/                    # Guest Paravirtual Micro-Init (<50KB musl PID 1)` (the real line-136 shape, verbatim) |
| 93 | `see: cans/artifacts/diagrams/four-ring-bus.txt#virtio-shm` | VALID (post-#70) — the `.txt` leaf-token tier: the box-entry token of `[virtio-shm] ───┴────────── [virtio-blk / wdt / balloon]` (the real 10-line file, verbatim) |
| 98 | `see: cans/artifacts/diagrams/host-runtime.txt#driver-rustvmm` | VALID (post-#70) — the `.txt` leaf-token tier: the box-tree token of the appended `│  ├── driver-rustvmm (DEFAULT Linux, Rust VMM)` line (the real diagram's tree shape; the pre-#70 bytes — the underlined `driver-avf`/`driver-virtio` headings the #69 pins ride — are kept byte-intact above it) |
| 106 | `see: cans/artifacts/code/container-service.rs#configure_runtim` | **BROKEN — AnchorNotFound.** The near miss of `configure_runtime` (post-#70 similarity ≈ 0.94 ≥ the 0.8 suggestion floor → `did you mean` proposing the trait method, resolution never auto-heals) |
| 109 | `see: cans/artifacts/examples/swarm-agent.rs#LedgerPlugn` | **BROKEN — AnchorNotFound.** The near miss of `LedgerPlugin` (≈ 0.92 → `did you mean` proposing the import token) |
| 115 | `see: cans/artifacts/diagrams/empty-metrics.txt#anything` | **WARNING — `codebase.anchor.no-target`, never a finding.** The target is the EMPTY file: no bullets, no schematic paths, no headings, no symbols, no tokens — the advisory class (the issue's 19 warnings), and the exit-ladder probe of issue class C |

18 pointers, 2 broken + 1 warning (post-#70). Pre-#70 the fifteen VALID
ones are ALL false AnchorNotFound errors (their targets each carry some
pre-#70 vocabulary — `pub trait ContainerService`, the `pub enum`/`pub
struct` of the agent miniature, the Python defs, `pub fn federate`, the
project-structure ATX heading, the four-ring-bus caps heading, the
host-runtime underlined headings), so the census reads 22 broken / 1
warning on 0.18.0 — the issue's report at fixture scale, the red-by-design
pattern the #70 contract suite documents.

## Expected scanner outcomes (the numbers the suites pin)

| scenario | scanned | pointers | broken |
|---|---|---|---|
| config block on (this `_rules.yaml`) | 14 (the 13 pre-#70 files plus `src/plugins/trait-wiring.rs`) | 50 (32 + the 18 #70 pointers) | 7 post-#70 — the 5 pre-#70 plus the two #70 typos; **22 pre-#70** (0.18.0: the 15 valid #70 pointers error too). Warnings: exactly 1 in both worlds — the empty-metrics no-target advisory |
| flag on, no config block (pure defaults, plugin tier kept on) | 12 (same minus `src/net.yaml` and `src/plugins/mounts.yaml` — the new file is `.rs`, covered by the default `**/*.rs`) | 48 | 8 post-#70 — the 7 plus the `cans/_rules.yaml#codebase.enabled` pointer, which breaks HERE because the variant's own rules rewrite drops the codebase block the anchor names: the artifact tier validates the rules file's CURRENT content, so a rewrite that deletes the key a pointer names is a reported diff, not silence. **23 pre-#70** (the 22 + the rules-key pointer). Warnings: 1 |
| aliasing include dropped (tier off, config block kept) | 14 | 50 | 12 post-#70 — the 2 true, the five #68 pointers as FileNotFound, the 3 #69 artifact broken and the 2 #70 typos (the artifact tier resolves against the workspace filesystem, not the corpus, so dropping the aliasing tier moves none of the #69/#70 artifact pointers; the `codebase:` block survives this variant's rewrite, so the rules-key pointer still resolves). **27 pre-#70** (the 12 + the 15 valid-as-broken) |
| pointers fixed (routes.ts:3 → `#Quotas`, quota.py:7 → `see: 07-network.md`, artifact-wiring.rs:36 → `#federate`, :40 → `#driver-avf`, :46 → `see: cans/artifacts/examples/multi-vm-swarm.rs#federate`, trait-wiring.rs:106 → `#configure_runtime`, :109 → `#LedgerPlugin`) | 14 | 50 | 0 post-#70 (pre-#70: 15 — the valid-as-broken class) |

The 7 broken (post-#70) are the pre-#67 pair PLUS the three deliberate
issue-#69 records PLUS the two issue-#70 typos — every issue-#67 pointer
(both bug classes), every issue-#68 pointer, the three VALID issue-#69
pointers and the fifteen VALID issue-#70 pointers resolve post-#70.
Pre-#69 the census counted 26 pointers and 2 broken: the six artifact
targets never parsed as pointers at all (the silent-skip half of the
issue). Pre-#70 (0.18.0, the issue #70 report at fixture scale): 50
pointers, 22 broken + 1 warning — the 15 valid #70 anchors all false
AnchorNotFound errors (the class-A/class-B repro) and the empty-metrics
pointer the one warning. Broken-pointer wire records (exact 7-key shape,
deterministic order — file asc, line asc):

```json
[
  { "type": "CodebaseBrokenReference", "file": "src/api/routes.ts", "line": 3,
    "raw": "see: 03-storage.md#Qutas", "targetFile": "03-storage.md",
    "targetSlug": "Qutas", "reason": "AnchorNotFound" },
  { "type": "CodebaseBrokenReference", "file": "src/plugins/artifact-wiring.rs", "line": 36,
    "raw": "see: cans/artifacts/examples/multi-vm-swarm.rs#federateNope",
    "targetFile": "cans/artifacts/examples/multi-vm-swarm.rs",
    "targetSlug": "federateNope", "reason": "AnchorNotFound" },
  { "type": "CodebaseBrokenReference", "file": "src/plugins/artifact-wiring.rs", "line": 40,
    "raw": "see: cans/artifacts/diagrams/host-runtime.txt#driver-avf-nope",
    "targetFile": "cans/artifacts/diagrams/host-runtime.txt",
    "targetSlug": "driver-avf-nope", "reason": "AnchorNotFound" },
  { "type": "CodebaseBrokenReference", "file": "src/plugins/artifact-wiring.rs", "line": 46,
    "raw": "see: cans/artifacts/code/plugin-trait.rs#PluginError",
    "targetFile": "cans/artifacts/code/plugin-trait.rs",
    "targetSlug": "PluginError", "reason": "FileNotFound" },
  { "type": "CodebaseBrokenReference", "file": "src/plugins/trait-wiring.rs", "line": 106,
    "raw": "see: cans/artifacts/code/container-service.rs#configure_runtim",
    "targetFile": "cans/artifacts/code/container-service.rs",
    "targetSlug": "configure_runtim", "reason": "AnchorNotFound" },
  { "type": "CodebaseBrokenReference", "file": "src/plugins/trait-wiring.rs", "line": 109,
    "raw": "see: cans/artifacts/examples/swarm-agent.rs#LedgerPlugn",
    "targetFile": "cans/artifacts/examples/swarm-agent.rs",
    "targetSlug": "LedgerPlugn", "reason": "AnchorNotFound" },
  { "type": "CodebaseBrokenReference", "file": "src/storage/quota.py", "line": 7,
    "raw": "see: 09-observability.md", "targetFile": "09-observability.md",
    "targetSlug": null, "reason": "FileNotFound" }
]
```

`severity: error` → all seven findings are errors → `cans check --codebase`
exits **2** (the repo error-band convention; the RFC's example text shows 1
— that one-number difference is the integration suite's one deliberate
deviation, documented in its header). Issue #70 adds the warnings-only
band pin (issue class C, the #41 exit ladder — engine-independent): a
warnings-ONLY run — errors 0, warnings ≥ 1 — reports `ok: true` but exits
**1** (0 clean / 1 warnings / 2 errors); the empty-metrics pointer above
is the fixture's warnings-class probe, and the #70 contract suite builds
a minimal warnings-only workspace in-test to pin the whole ladder.

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

Issue #69 widens the query grammar symmetrically with the pointer grammar
(both build their extension alternation from the shared
CODEBASE_TARGET_EXTS table): an ARTIFACT query — `<file>.<ext>` with any
extension a pointer can carry, optionally `#Slug` — resolves against the
workspace FILESYSTEM through the same containment-guarded resolveSpecFile
the corpus refs engine uses for on-disk targets (both `cans/…` and
`cans/`-less spellings name one file), and matching never crosses the
tiers: a `.md` query answers corpus pointers only, an artifact query
artifact pointers only. An unknown artifact file refuses — `ok:false`,
exit 1, `no spec or artifact file matches "…" — refs --codebase resolves
against the workspace corpus (cans/) and its artifact files` — and a
query whose extension no anchor vocabulary can address (`foo.csv#x`), a
bare stem, an empty slug or trailing garbage all refuse with the
`malformed node` usage family.

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
| `cans/artifacts/examples/multi-vm-swarm.rs#federate` (artifact, anchored) | `src/plugins/artifact-wiring.rs:14` — the `#federateNope` spelling does NOT answer (the anchor comparison is never fuzzy) |
| `cans/artifacts/examples/multi-vm-swarm.rs#federateNope` (artifact, the broken spelling) | `src/plugins/artifact-wiring.rs:36` — the reverse path answers for broken pointers too (a query, not a verdict) |
| `cans/artifacts/examples/multi-vm-swarm.rs` (artifact, file-level) | `src/plugins/artifact-wiring.rs:14`, `src/plugins/artifact-wiring.rs:36` and — since #70 — `src/plugins/trait-wiring.rs:75`, `src/plugins/trait-wiring.rs:80` (the `#MeshPlugin` / `#SupplyChainPlugin` pointers) |
| `cans/artifacts/diagrams/host-runtime.txt` (artifact, file-level) | `src/plugins/artifact-wiring.rs:21`, `src/plugins/artifact-wiring.rs:40` and — since #70 — `src/plugins/trait-wiring.rs:98` (the `#driver-rustvmm` pointer) |
| `cans/_rules.yaml#codebase.enabled` (artifact, schematic dot-path anchor) | `src/plugins/artifact-wiring.rs:28` |
| `cans/artifacts/code/container-service.rs#configure_runtime` (artifact, the trait-method anchor) | `src/plugins/trait-wiring.rs:15` |
| `cans/artifacts/code/container-service.rs#mount_scratch` (artifact, trait method) | `src/plugins/trait-wiring.rs:22` |
| `cans/artifacts/code/container-service.rs#ingest_image` (artifact, trait method) | `src/plugins/trait-wiring.rs:27` |
| `cans/artifacts/code/container-service.rs#configure_runtim` (artifact, the TYPO spelling) | `src/plugins/trait-wiring.rs:106` — the reverse path answers for broken pointers too (a query, not a verdict; the #69 `#federateNope` precedent) |
| `cans/artifacts/code/container-service.rs` (artifact, file-level) | all four into it: `src/plugins/trait-wiring.rs:15`, `:22`, `:27`, `:106` (the three valid trait methods + the typo — anchors are irrelevant at the file level) |
| `cans/artifacts/examples/swarm-agent.rs#UserOracle` / `#LedgerPlugin` / `#binary_blake3` / `#FinalizeRequest` / `#FinalReceipt` (artifact, the grammar-v2 + leaf anchors) | `src/plugins/trait-wiring.rs:34` / `:41` / `:46` / `:51` / `:56` — each its own line, the anchor comparison never fuzzy |
| `cans/artifacts/examples/swarm-agent.rs#LedgerPlugn` (artifact, the TYPO spelling) | `src/plugins/trait-wiring.rs:109` |
| `cans/artifacts/examples/swarm-agent.rs#LedgerCtx` (a name that EXISTS in the target — the use-tree — but no source points at) | none — zero matches is an answer: the reverse path traces WRITERS, not resolvability |
| `cans/artifacts/examples/db-runtime.py#PgWireRewrite` / `#DbProxyConfig` (artifact, leaf anchors) | `src/plugins/trait-wiring.rs:63` / `:68` |
| `cans/artifacts/config/project-structure.txt#kelir-shim` (artifact, the tree-entry token) | `src/plugins/trait-wiring.rs:88` |
| `cans/artifacts/diagrams/four-ring-bus.txt#virtio-shm` (artifact, the box-entry token) | `src/plugins/trait-wiring.rs:93` |
| `cans/artifacts/diagrams/host-runtime.txt#driver-rustvmm` (artifact, the box-tree token) | `src/plugins/trait-wiring.rs:98` |
| `cans/artifacts/diagrams/empty-metrics.txt#anything` (artifact, the empty-target advisory pointer) | `src/plugins/trait-wiring.rs:115` — the reverse path answers it like any other writer line (the no-target verdict is the CHECK's, not the query's) |
