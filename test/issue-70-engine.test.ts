/**
 * Issue #70 — the ENGINE half: the addressable-leaf widening of
 * `cans check --codebase` artifact anchors (reported against cans 0.18.0,
 * after #69 made artifact targets checkable at all).
 *
 *   the defect — on the kelir repo (1523 codebase `see:` pointers) 16
 *   errors + 19 warnings held anchors whose targets DO contain the named
 *   thing, in shapes the #60 vocabularies never minted:
 *     A. declarations the extractor missed — trait methods
 *        (`async fn configure_runtime(&mut self)` inside `pub trait
 *        ContainerService`, container-service.rs lines 28/33/43) and
 *        non-pub unit structs (`struct UserOracle;`, autonomous-swe-
 *        agent.rs:712 — no `pub`). multi-vm-swarm.rs has ONLY non-pub
 *        column-0 items (`enum WorkerAction`, `const SWARM_REGION`,
 *        `fn swarm_builder`, `async fn main`) — an empty vocabulary, which
 *        is exactly why its pointers drew no-target warnings.
 *     B. referenced names and diagram lines — anchors that exist in their
 *        target files as use/import names (`#LedgerPlugin`, `#LedgerCtx`,
 *        `#binary_blake3`, `#FinalizeRequest`, `#FinalReceipt`;
 *        `#PgWireRewrite`, `#DbProxyConfig`) or as text/tree lines
 *        (`project-structure.txt#kelir-shim` at the `│   ├── kelir-shim/`
 *        entry, `four-ring-bus.txt#virtio-shm` at the `[virtio-shm]` box
 *        entry, `host-runtime.txt#driver-rustvmm` — a pure box-drawing
 *        file, no headings → no-target warnings). The reporter's
 *        convention quote is the repo's established reading: "a pointer
 *        to an example means 'this file demonstrates the symbol', and a
 *        pointer into a diagram means 'this entry of the diagram'".
 *
 *   the fix — three additive tiers at the shared #68/#69 seam:
 *    1. RUST GRAMMAR v2 (code-anchors.ts): `pub` optional at column 0
 *       (pub(crate)/pub(super) still rejected — the regex fails on the
 *       paren) and a trait-block tracker minting indented trait items
 *       (methods, associated types/consts; multi-line signatures mint
 *       from their first line; the one-line compact trait mints only the
 *       trait name — the pre-existing r1/r2 pins stay green).
 *    2. extractCodeLeafNames: every identifier-shaped token of a code
 *       artifact — declarations, imports, uses, call sites, field
 *       accesses, comment text — the "tokens as leaves" convention.
 *    3. extractTextLeafTokens: the text tokens of .txt/.text lines
 *       (length ≥ 2, at least one letter; box drawing never joins), so
 *       `kelir-shim`, `driver-rustvmm` and `virtio-shm` are single
 *       addressable tokens.
 *    All three resolve through checkArtifactAnchor (frozen #69
 *    signature): declarations ranked before leaves, the miss suggestion
 *    passes the UNION (a typo of a referenced name deserves the same
 *    did-you-mean quality), and the no-target downgrade condition extends
 *    to the leaf vocabularies with the parenthetical message widened to
 *    "…, referenced names, text tokens)". .md targets (neither
 *    isTextArtifact nor isCodeArtifact) and schematic targets (leaf [])
 *    are untouched — spec-node anchors never become leaf-addressable.
 *
 *   v1-v8 .... Rust grammar v2 (pure, no fs): the REAL container-service.rs
 *              mint list; the non-pub column-0 set; pub(crate)/pub(super)
 *              still nothing; the one-line compact trait; where-clause +
 *              late `{` + associated types/consts + const-fn backtracking;
 *              default-bodied + multi-line-signature methods; trait closes
 *              ⇒ impl methods mint nothing; r# raw identifiers
 *   l1-l4 .... extractCodeLeafNames (pure): the kelir referenced names;
 *              dedupe first-occurrence document order; tsjs `$` mints /
 *              rust grammar excludes `$`; unknown ext → []; empty → []
 *   t1-t6 .... extractTextLeafTokens (pure): the REAL four-ring-bus.txt
 *              token list; kelir-shim tree entry; driver-rustvmm box-tree
 *              entry; pure numbers + single chars excluded; dedupe; empty
 *   e1-e13 ... resolution over tmp workspaces (checkCodebaseRefs): every
 *              kelir anchor class resolves (trait method, non-pub unit
 *              struct, referenced names, python imports, tree/box tokens);
 *              the typo suggestions (configure_runtim, LedgerPlugn — the
 *              canonical anchorSlug spelling, which resolves through §12
 *              normalization); the far miss (no near match); the UPDATED
 *              no-target warning bytes; the camelCase guard
 *              (#ledger-plugin does NOT resolve against LedgerPlugin)
 *   s1-s4 .... the seam guards: the corpus refs engine inherits the
 *              widening (ONE shared verdict); a prose .md target keeps
 *              bullets-only behavior (the anchor word sits in the prose
 *              and still does not resolve); a schematic target gets no
 *              leaf tier (a VALUE anchor stays a truthful error); the
 *              codebase engine's .md tier keeps corpus-node resolution
 *
 * Runtime-neutral: imports the test facade, never 'bun:test' directly.
 */
import { describe, test, expect, afterEach } from './testing.ts';
import { join, dirname } from 'path';
import { mkdirSync, writeFileSync } from 'fs';

import { checkCodebaseRefs } from '../src/core/codebase.ts';
import { defaultCodebaseRules } from '../src/core/rules.ts';
import { parseOutline, flattenNodes } from '../src/core/outline.ts';
import { extractCodeSymbols, extractCodeLeafNames } from '../src/core/code-anchors.ts';
import { extractTextLeafTokens } from '../src/core/text-anchors.ts';
import { checkArtifactAnchor, checkRefs, buildRefGraph } from '../src/core/refs.ts';
import { makeTmpDir, cleanTmpDir, makeCansWorkspace } from './helpers.ts';
import type { CodebaseRules, OutlineNode } from '../src/types.ts';

// ── Scaffolding (the issue #67/#68/#69 engine suites' shape) ──────────────────

const tmps: string[] = [];

afterEach(() => {
  while (tmps.length > 0) cleanTmpDir(tmps.pop()!);
});

const cbCfg = (over: Partial<CodebaseRules> = {}): CodebaseRules => ({
  ...defaultCodebaseRules(),
  ...over,
});

/** A PROJECT directory: `files` become the cans/ workspace, `projectFiles`
 *  sit beside it — the scanner's turf (the #69 suite's makeProject). */
function makeProject(
  name: string,
  files: Record<string, string> = {},
  projectFiles: Record<string, string> = {},
): { project: string; root: string } {
  const project = makeTmpDir(`issue70-engine-${name}`);
  tmps.push(project);
  const root = makeCansWorkspace(project, files);
  for (const [rel, content] of Object.entries(projectFiles)) {
    const p = join(project, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content, 'utf8');
  }
  return { project, root };
}

/** A corpus map the way check.ts's specFiles is shaped (the #69 shape). */
function corpusOf(entries: Array<[string, string]>): Map<string, OutlineNode[]> {
  return new Map(entries.map(([key, src]) => [key, parseOutline(src, key)]));
}

const CORPUS: Array<[string, string]> = [
  ['00-overview.md', '- Overview\n- Session validation\n'],
];

// ── The issue's REAL artifacts (kelir shapes, inlined verbatim or shaped) ─────

/** The REAL cans/artifacts/code/container-service.rs — the issue's class-A
 *  repro: a `pub trait ContainerService` whose five trait methods were all
 *  reported broken (#configure_runtime, #mount_scratch, #ingest_image). */
const CONTAINER_SERVICE_RS = [
  '// crates/kelir-plugins/plugin-container/src/service.rs',
  '//',
  '// The ContainerService surface: what the container plugin exposes',
  '// through PipelineBinder for container lifecycle tracking. Each method',
  '// is one behavior from the plugin spec; the plugin invokes them from',
  '// its LifecycleParticipant and TrapInterposer implementations, never',
  '// from the guest. No nested hypervisor is involved at any point:',
  '// images come from pre-cached host tarballs and the runtime is',
  '// rootless Podman/crun inside the microVM.',
  '//',
  '// Owned by: cans/plugins/container.md#Service-exports-(container)',
  '',
  'use async_trait::async_trait;',
  'use std::ops::Range;',
  'use std::path::Path;',
  'use kelir_interface::plugin::PluginError;',
  '',
  '/// Container lifecycle service. Implemented by the container plugin;',
  '/// the guest workload runs containers with plain `podman run` inside',
  '/// the microVM once this service has prepared the environment.',
  '/// Privileged escape attempts and raw device mounts never reach the',
  '/// service: the trap filter rejects them with EPERM',
  '/// (Verdict::Drop { errno: Some("EPERM") }).',
  '#[async_trait]',
  'pub trait ContainerService: Send + Sync {',
  '    /// Configures the rootless Podman and crun runtime environments',
  '    /// inside the microVM.',
  '    async fn configure_runtime(&mut self) -> Result<(), PluginError>;',
  '',
  '    /// Mounts the ephemeral scratch device at /var/lib/containers,',
  '    /// isolating storage diffs from the guest root filesystem.',
  '    /// `scratch` is the host scratch device path.',
  '    async fn mount_scratch(&mut self, scratch: &Path) -> Result<(), PluginError>;',
  '',
  '    /// Constructs the synthetic cgroup v2 delegation hierarchy.',
  '    /// Invoked from on_vm_ready, before any container starts.',
  '    async fn build_cgroup_delegation(&mut self) -> Result<(), PluginError>;',
  '',
  '    /// Ingests one pre-cached OCI image tarball from the host package',
  '    /// cache. Returns the image reference the workload passes to',
  '    /// `podman run`. No image translation runs; the tarball is used',
  '    /// as cached.',
  '    async fn ingest_image(&mut self, tarball: &Path) -> Result<String, PluginError>;',
  '',
  '    /// Pins the subuid and subgid ranges to unprivileged guest user',
  '    /// ranges. newuidmap/newgidmap allocations outside the pinned',
  '    /// ranges are intercepted by the trap filter and rejected.',
  '    async fn pin_id_map(',
  '        &mut self,',
  '        subuid: Range<u32>,',
  '        subgid: Range<u32>,',
  '    ) -> Result<(), PluginError>;',
  '}',
  '',
].join('\n');

/** The REAL examples/multi-vm-swarm.rs declaration set (lines 1-42 + the
 *  entry points) — the issue's no-pub-declarations file: non-pub column-0
 *  items only, which under #60 minted NOTHING (empty vocabulary → the
 *  no-target warnings on #MeshPlugin/#SupplyChainPlugin). */
const SWARM_RS = [
  '//! examples/multi-vm-swarm.rs',
  '//!',
  '//! Cooperative agent swarm: N workers share a warm base microVM over a',
  '//! host memfd, acquire repository locks via lock-broker, and exchange',
  '//! peer streams over the mesh. A session Fork veto holds until the',
  '//! shared fixture cache is hydrated.',
  '//!',
  '//! Mounts:     mesh, supply-chain, ledger.',
  '//! Primitives: map_shared_region, register_veto(Fork).',
  '',
  'use std::sync::{Arc, atomic::{AtomicBool, Ordering}};',
  'use std::time::Duration;',
  '',
  'use serde::Deserialize;',
  'use tokio::task::JoinSet;',
  '',
  'use kelir::{',
  '    driver::{DriverPolicy, WxPolicy}, KelirBuilder, Session, VmConfig,',
  '    plugin::VetoEvent,',
  '    planes::storage::{LockBrokerConfig, LockScope, LockMode},',
  '    plugins::{',
  '        ledger::{LedgerConfig, LedgerCtx, LedgerPlugin, ReceiptConfig},',
  '        mesh::{MeshConfig, MeshCtx, MeshPlugin, PeerIdentity, TraceParentPropagation},',
  '        supply_chain::{',
  '            LifecyclePolicy, PackageManager, SupplyChainConfig, SupplyChainPlugin,',
  '        },',
  '    },',
  '};',
  '',
  '#[derive(Clone, Deserialize)]',
  '#[serde(tag = "action", rename_all = "kebab-case")]',
  'enum WorkerAction {',
  '    RunShard { shard_id: u32, total_shards: u32, repo: String, base_sha: String },',
  '}',
  '',
  'const SWARM_REGION: &str = "swarm-coordination";',
  'const SWARM_BYTES: usize = 32;',
  '',
  'fn swarm_builder() -> KelirBuilder {',
  '    KelirBuilder::new(VmConfig {',
  '        vcpus: 4, memory_mb: 8192,',
  '        kernel_path: "./fixtures/vmlinux-6.6-aarch64-kelir".into(),',
  '        rootfs_erofs_path: "./fixtures/rootfs-swarm.erofs".into(),',
  '        tsc_locked: true, enable_watchdog: true,',
  '    })',
  '    .lock_broker(LockBrokerConfig {',
  '        scope: LockScope::Globs(vec![',
  '            "**/Cargo.lock".into(),',
  '        ]),',
  '        default_mode: LockMode::Exclusive,',
  '    })',
  '}',
  '',
  'async fn boot_swarm() -> Result<Session, Box<dyn std::error::Error + Send + Sync>> {',
  '    let session = swarm_builder().seal().boot().await?;',
  '    Ok(session)',
  '}',
  '',
  'async fn run_shard(',
  '    parent: &Session,',
  '    shard_id: u32,',
  ') -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {',
  '    let child = parent.vm.fork().await?;',
  '    let mapped = child.vm.map_shared_region(SWARM_REGION, SWARM_BYTES).await?;',
  '    child.ctx::<MeshCtx>().publish(&mapped, shard_id).await?;',
  '    child.terminate().await?;',
  '    Ok(true)',
  '}',
  '',
  '#[tokio::main]',
  'async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {',
  '    let session = boot_swarm().await?;',
  '    let chain_denials = session.ctx::<LedgerCtx>().count_by_kind("supply-chain-deny").await?;',
  '    eprintln!("[kelir] supply-chain denials={chain_denials}");',
  '    session.terminate().await?;',
  '    Ok(())',
  '}',
  '',
].join('\n');

/** Shaped from the REAL examples/autonomous-swe-agent.rs — the class-B
 *  referenced-names repro: the ledger names arrive as a use-tree (line 36
 *  of the real file), FinalizeRequest/FinalReceipt are consumed at the
 *  finalize call, binary_blake3 at the trap comparison, and `struct
 *  UserOracle;` (real line 712) is the non-pub unit struct. */
const SWARM_AGENT_RS = [
  '//! examples/autonomous-swe-agent.rs (shaped excerpt)',
  '//!',
  '//! Composition example: ledger plugin + example-local oracle.',
  '',
  'use std::path::{Path, PathBuf};',
  'use std::sync::Arc;',
  '',
  'use kelir::{',
  '    handler, FinalizeRequest, HandlerCtx, Session, Verdict,',
  '    plugin::{AnyPlugin, KelirPlugin, PluginError},',
  '    plugins::ledger::{FinalReceipt, LedgerConfig, LedgerCtx, LedgerPlugin, ReceiptConfig},',
  '};',
  '',
  '// Example-local evaluator, not a core trait. UserOracle is a plain struct.',
  'struct UserOracle;',
  'impl UserOracle { fn new() -> Self { Self } }',
  '',
  'async fn build_runtime(',
  '    oracle: Arc<UserOracle>,',
  ') -> Result<KelirBuilder, Box<dyn std::error::Error + Send + Sync>> {',
  '    let snoop = |path: PathBuf, raw: Vec<u8>, c: HandlerCtx| {',
  '        let blake3 = c.ctx::<LedgerCtx>().blake3_of_producing_process(&path);',
  '        oracle.ingest_harness_event(&path, &raw, &blake3);',
  '    };',
  '    let builder = KelirBuilder::new(VmConfig { tsc_locked: true })',
  '        .plugin(LedgerPlugin::new(LedgerConfig {',
  '            store: ".kelir/swe-audit.merkle.db".into(),',
  '        }));',
  '    Ok(builder)',
  '}',
  '',
  'async fn run(oracle: Arc<UserOracle>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {',
  '    let session = build_runtime(oracle).await?.seal().boot().await?;',
  '    let receipt: FinalReceipt = session',
  '        .ctx::<LedgerCtx>()',
  '        .finalize(FinalizeRequest {',
  '            session_id: "swe-1".into(),',
  '        })',
  '        .await?;',
  '    let trap_hex: String = session.trap.binary_blake3.iter()',
  '        .map(|b| format!("{b:02x}"))',
  '        .collect();',
  '    if receipt.binary_blake3 != trap_hex {',
  '        return Ok(());',
  '    }',
  '    Ok(())',
  '}',
  '',
].join('\n');

/** Shaped from the REAL examples/db-backed-runtime.py — the python half of
 *  class B: PgWireRewrite/DbProxyConfig imported (real lines 37-38) and
 *  constructed (real lines 71-72). */
const DB_RUNTIME_PY = [
  '# examples/db-backed-runtime.py (shaped excerpt)',
  '',
  'from __future__ import annotations',
  '',
  'import os',
  'from typing import Literal',
  '',
  'from pydantic import BaseModel, Field',
  '',
  'import kelir',
  'from kelir import HandlerContext, KelirBuilder, Session, Verdict',
  'from kelir.plugins.db_proxy import (',
  '    DbProxyConfig, DbProxyPlugin, EphemeralCredentials,',
  '    PgWireRewrite, SqliteOverVsock,',
  ')',
  '',
  '',
  'class MigrateParams(BaseModel, frozen=True):',
  '    action: Literal["migrate"]',
  '    schema_name: str',
  '',
  '',
  'def build_runtime(pg_host: str, pg_secret: str) -> KelirBuilder:',
  '    builder = kelir.builder(',
  '        vcpus=2, memory_mb=2048, driver="auto",',
  '    )',
  '    builder.plugin(DbProxyPlugin(DbProxyConfig(',
  '        postgres=PgWireRewrite(',
  '            listen_port=5432,',
  '            upstream=f"{pg_host}:5432",',
  '        ),',
  '    )))',
  '    return builder',
  '',
  '',
  'async def main() -> None:',
  '    session = build_runtime("db.local", "secret").seal().boot()',
  '',
].join('\n');

/** The REAL artifacts/diagrams/four-ring-bus.txt — the `[virtio-shm]` box
 *  entry (line 10) is the issue's diagram-line repro. */
const FOUR_RING_BUS_TXT = [
  'THE VIRTIO DEVICE COMPLEX',
  '                                     │',
  '      ┌──────────────────┬───────────┴───────────┬──────────────────┐',
  '      ▼                  ▼                       ▼                  ▼',
  ' [virtio-vsock]  [virtio-console]          [virtio-fs]        [virtio-net]',
  '  CONTROL PLANE   TERMINAL PLANE          STORAGE PLANE        WIRE PLANE',
  '  Control &       Multiplexed             FUSE Inode &         Userspace smoltcp',
  '  Multiplexed IPC Character Streams       File Data            ingress-ring frames',
  '                         │                       │',
  '         [virtio-shm] ───┴────────── [virtio-blk / wdt / balloon]',
  '',
].join('\n');

/** Shaped from the REAL config/project-structure.txt — the `│   ├──
 *  kelir-shim/` tree entry (line 136) is the issue's tree-line repro. */
const PROJECT_STRUCTURE_TXT = [
  'cans-ws/',
  '│',
  '├── crates/',
  '│   ├── kelir-shim/                    # Guest Paravirtual Micro-Init (<50KB musl PID 1)',
  '│   │   ├── Cargo.toml                 # Dependencies: blake3, ciborium, kelir-interface, libc',
  '│   │   └── src/',
  '│   │       ├── codec.rs               # Raw slice bit-shift frame codec',
  '│   │       └── main.rs                # Guest PID 1 reaper & loop',
  '│   │',
  '│   └── kelir-drivers/                 # Pluggable Virtualization Implementations',
  '│       ├── driver-rustvmm/            # Bare-metal Linux KVM via kvm-ioctls',
  '│       ├── driver-hvf/                # Native macOS Apple Silicon HVF',
  '│       ├── driver-openvmm/            # Windows WHP + ConPTY',
  '│       ├── driver-avf/                # Android Virtualization Framework via /dev/avf',
  '│       └── driver-proot/              # Termux ptrace emulation',
  '',
].join('\n');

/** Shaped from the REAL diagrams/host-runtime.txt driver box — pure
 *  box-drawing, no headings (extractTextHeadings mints nothing), so under
 *  #60 the whole file was an empty vocabulary. */
const HOST_RUNTIME_TXT = [
  '┌───────────────────────────────────────────────────────────────────────────────────┐',
  '│                           kelir-drivers (Pluggable Backends)                      │',
  '│   ├── driver-rustvmm (DEFAULT Linux): KVM + userfaultfd CoW + CUDA CDI            │',
  '│   │   CPUID synthetic filter: invariant TSC, Leaf 0x1 TSC-deadline,               │',
  '│   ├── driver-hvf (DEFAULT macOS): Native HVF + direct Mach vm_copy CoW            │',
  '│   ├── driver-openvmm: Windows WHP + ConPTY + HV_SOCKET + Azure Linux MSHV         │',
  '│   ├── driver-avf: Android Virtualization Framework via /dev/avf & pKVM            │',
  '│   ├── driver-bwrap: Unprivileged Linux user namespaces + seccomp-unotify fallback │',
  '│   └── driver-proot: Unprivileged Android/Termux ptrace emulation fallback         │',
  '└───────┬──────────────┬──────────────┬──────────────┬──────────────┬───────────────┘',
  '',
].join('\n');

// ── A. Rust grammar v2 (extractCodeSymbols, pure) ─────────────────────────────

describe('issue #70 engine — Rust grammar v2 (pub optional, trait methods)', () => {
  test('v1: the REAL container-service.rs mints the trait and every trait method — exact list', () => {
    // The issue's class-A repro: #configure_runtime, #mount_scratch and
    // #ingest_image were all reported broken. use-imports (PluginError,
    // Range, Path, async_trait) never mint; the multi-line pin_id_map
    // signature mints from its first line; doc comments never mint.
    expect(extractCodeSymbols('cans/artifacts/code/container-service.rs', CONTAINER_SERVICE_RS)).toEqual([
      'ContainerService', 'configure_runtime', 'mount_scratch', 'build_cgroup_delegation',
      'ingest_image', 'pin_id_map',
    ]);
  });

  test('v2: non-pub column-0 items mint — the multi-vm-swarm.rs declaration set', () => {
    // The issue's empty-vocabulary file: every declaration is non-pub at
    // column 0, so #60 minted nothing. impl blocks and use lines still
    // mint nothing; async fns mint through the modifier run.
    expect(extractCodeSymbols('cans/artifacts/examples/multi-vm-swarm.rs', SWARM_RS)).toEqual([
      'WorkerAction', 'SWARM_REGION', 'SWARM_BYTES', 'swarm_builder', 'boot_swarm',
      'run_shard', 'main',
    ]);
  });

  test('v3: pub(crate)/pub(super) still mint nothing — restricted visibility stays excluded', () => {
    const src = [
      'pub(crate) fn crate_only() {}',
      'pub(super) fn parent_only() {}',
      'pub(in crate::inner) fn path_only() {}',
      'pub fn public() {}',
      'struct Private { }',
    ].join('\n');
    // The `(` after `pub` fails the regex outright — the #60 restricted-
    // visibility rule survives the #70 widening byte for byte.
    expect(extractCodeSymbols('vis.rs', src)).toEqual(['public', 'Private']);
  });

  test('v4: the one-line compact trait mints ONLY the trait name (the documented limit)', () => {
    // The method sits on the decl line, before the block state exists —
    // pinned by issue-60 r1/r2 since #60; #70 must not move it.
    expect(extractCodeSymbols('compact.rs', 'pub trait Walker { fn walk(&self); }')).toEqual(['Walker']);
    expect(extractCodeSymbols('compact2.rs', 'trait Solo { fn go(&self); }')).toEqual(['Solo']);
  });

  test('v5: where-clause with `{` on a later line still opens the block; associated types/consts mint', () => {
    const src = [
      'pub trait Factory<T>',
      '    where T: Clone',
      '{',
      '    type Out;',
      '    fn make(&self) -> Self::Out;',
      '    const MAX: usize = 4;',
      '    const fn cap() -> usize { MAX }',
      '}',
    ].join('\n');
    // `const fn cap` backtracks: const is a MODIFIER and cap mints;
    // `const MAX:` keeps const as the item keyword and MAX mints.
    expect(extractCodeSymbols('factory.rs', src)).toEqual([
      'Factory', 'Out', 'make', 'MAX', 'cap',
    ]);
  });

  test('v6: default-bodied trait methods mint (the name precedes the body braces)', () => {
    const src = [
      'pub trait Visitor {',
      '    fn visit(&mut self, x: u32) -> u32 { x + 1 }',
      '    async fn peek(&self);',
      '}',
    ].join('\n');
    expect(extractCodeSymbols('visitor.rs', src)).toEqual(['Visitor', 'visit', 'peek']);
  });

  test('v7: after the trait closes, a following impl’s indented methods mint nothing', () => {
    const src = [
      'pub trait Visitor {',
      '    fn visit(&mut self);',
      '}',
      '',
      'impl Visitor for Counter {',
      '    fn visit(&mut self) { }',
      '    async fn helper(&self) { }',
      '}',
      '',
      'fn main() {}',
    ].join('\n');
    // `impl … {` never opens trait state; once the trait closes (depth
    // falls back to traitBase) the tracker resets — impl methods stay the
    // leaf tier's net, never this grammar's.
    expect(extractCodeSymbols('after.rs', src)).toEqual(['Visitor', 'visit', 'main']);
  });

  test('v8: r# raw identifiers in trait methods strip the prefix, like everywhere else', () => {
    const src = [
      'pub trait Shape {',
      '    fn r#type(&self) -> &str;',
      '    async fn r#loop(&self);',
      '}',
    ].join('\n');
    // #type addresses `fn r#type` — the #60 rule carried into trait items.
    expect(extractCodeSymbols('raw.rs', src)).toEqual(['Shape', 'type', 'loop']);
  });
});

// ── B. extractCodeLeafNames (the referenced-names tier, pure) ─────────────────

describe('issue #70 engine — extractCodeLeafNames (referenced names as leaves)', () => {
  test('l1: the kelir referenced names are present — imports, uses, field accesses, unit struct', () => {
    const leaves = extractCodeLeafNames('cans/artifacts/examples/autonomous-swe-agent.rs', SWARM_AGENT_RS);
    // The issue's exact class-B names: imported (LedgerPlugin, LedgerCtx,
    // FinalReceipt, FinalizeRequest), used at call sites (binary_blake3 —
    // both the trap field and the receipt field), and the non-pub unit
    // struct (UserOracle). None is a top-level declaration of this file.
    for (const name of [
      'LedgerPlugin', 'LedgerCtx', 'FinalReceipt', 'FinalizeRequest',
      'binary_blake3', 'UserOracle', 'KelirBuilder', 'PluginError',
    ]) {
      expect(leaves).toContain(name);
    }
  });

  test('l2: dedupe keeps the FIRST occurrence at its document position', () => {
    // Use-tree order: handler, FinalizeRequest, …, Verdict, …,
    // FinalReceipt, LedgerCtx, LedgerPlugin — and every later call-site
    // occurrence (LedgerPlugin::new, session.ctx::<LedgerCtx>(),
    // receipt.binary_blake3) collapses into those firsts.
    const leaves = extractCodeLeafNames('x.rs', SWARM_AGENT_RS);
    const order = [
      'handler', 'FinalizeRequest', 'Verdict', 'KelirPlugin', 'FinalReceipt',
      'LedgerCtx', 'LedgerPlugin', 'UserOracle', 'binary_blake3',
    ];
    for (let i = 1; i < order.length; i++) {
      expect(leaves.indexOf(order[i - 1]!)).toBeLessThan(leaves.indexOf(order[i]!));
    }
    expect(new Set(leaves).size).toBe(leaves.length); // no duplicates, ever
    expect(extractCodeLeafNames('x.rs', 'foo bar foo baz foo')).toEqual(['foo', 'bar', 'baz']);
  });

  test('l3: tsjs `$` identifiers mint; the rust/python/go grammar excludes `$`', () => {
    expect(extractCodeLeafNames('x.ts', 'const $dollar = 1; use($dollar); a$b;')).toEqual([
      'const', '$dollar', 'use', 'a$b',
    ]);
    // rust: `$` is not an identifier char — `a$b` is the two tokens a, b.
    expect(extractCodeLeafNames('x.rs', 'let a$b = macro!();')).toEqual(['let', 'a', 'b', 'macro']);
  });

  test('l4: unknown extension → []; empty source → []', () => {
    expect(extractCodeLeafNames('notes.txt', 'LedgerPlugin everywhere')).toEqual([]);
    expect(extractCodeLeafNames('lib.rb', 'class Foo; end')).toEqual([]);
    expect(extractCodeLeafNames('x.rs', '')).toEqual([]);
    expect(extractCodeLeafNames('x.py', '\n\n')).toEqual([]);
  });
});

// ── C. extractTextLeafTokens (the diagram/tree-line tier, pure) ───────────────

describe('issue #70 engine — extractTextLeafTokens (diagram/tree lines as leaves)', () => {
  test('t1: the REAL four-ring-bus.txt — box entries are single tokens, exact list', () => {
    // The issue's repro: #virtio-shm addresses the `[virtio-shm]` box
    // entry. `THE VIRTIO DEVICE COMPLEX` yields four separate tokens;
    // box-drawing never joins; the pure-number-free guard is vacuous here.
    expect(extractTextLeafTokens(FOUR_RING_BUS_TXT)).toEqual([
      'THE', 'VIRTIO', 'DEVICE', 'COMPLEX',
      'virtio-vsock', 'virtio-console', 'virtio-fs', 'virtio-net',
      'CONTROL', 'PLANE', 'TERMINAL', 'STORAGE', 'WIRE',
      'Control', 'Multiplexed', 'FUSE', 'Inode', 'Userspace', 'smoltcp',
      'IPC', 'Character', 'Streams', 'File', 'Data', 'ingress-ring', 'frames',
      'virtio-shm', 'virtio-blk', 'wdt', 'balloon',
    ]);
  });

  test('t2: the project-structure tree entry — kelir-shim is ONE token', () => {
    const tokens = extractTextLeafTokens(PROJECT_STRUCTURE_TXT);
    // `│   ├── kelir-shim/` mints exactly `kelir-shim` — the internal
    // dash preserved, the tree glyphs never joining, the trailing slash
    // ignored — and the driver tree entries behave the same.
    expect(tokens).toContain('kelir-shim');
    expect(tokens).not.toContain('kelir');
    expect(tokens).not.toContain('shim');
    for (const tok of ['driver-rustvmm', 'driver-hvf', 'driver-openvmm', 'driver-avf', 'driver-proot']) {
      expect(tokens).toContain(tok);
    }
  });

  test('t3: the host-runtime box-tree entry — driver-rustvmm is ONE token in a heading-less file', () => {
    // Pure box-drawing: extractTextHeadings mints nothing here (the #60
    // no-target shape); the leaf tier is the file's whole vocabulary.
    const tokens = extractTextLeafTokens(HOST_RUNTIME_TXT);
    expect(tokens).toContain('driver-rustvmm');
    expect(tokens).not.toContain('rustvmm');
    expect(tokens).toContain('driver-avf');
    expect(tokens).toContain('DEFAULT');
    expect(tokens).toContain('Linux');
  });

  test('t4: pure numbers and single characters are excluded', () => {
    // A port (5432), a bare version digit and single chars never address
    // anything — length ≥ 2 AND at least one letter.
    expect(extractTextLeafTokens('listen on 5432, a, b, x1, 7f, ok')).toEqual([
      'listen', 'on', 'x1', '7f', 'ok',
    ]);
    expect(extractTextLeafTokens('42 7 Z q')).toEqual([]);
  });

  test('t5: dedupe keeps the first occurrence, document order', () => {
    expect(extractTextLeafTokens('virtio-shm virtio-shm driver-avf virtio-shm')).toEqual([
      'virtio-shm', 'driver-avf',
    ]);
    expect(extractTextLeafTokens('a-b a-b')).toEqual(['a-b']);
  });

  test('t6: empty source → []', () => {
    expect(extractTextLeafTokens('')).toEqual([]);
    expect(extractTextLeafTokens('\n\n   \n')).toEqual([]);
  });
});

// ── D. Resolution end to end (checkCodebaseRefs over tmp workspaces) ─────────

describe('issue #70 engine — resolution (the leaf tier, end to end)', () => {
  test('e1: #configure_runtime resolves — a trait method in the REAL container-service.rs', async () => {
    const { root } = makeProject('trait-method', {
      '00-overview.md': CORPUS[0]![1],
      'artifacts/code/container-service.rs': CONTAINER_SERVICE_RS,
    }, {
      'src/driver.rs': '// see: cans/artifacts/code/container-service.rs#configure_runtime\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings).toEqual([]); // the class-A false positive, now resolving
    expect(scan.warnings).toEqual([]);
    expect(scan.pointers).toBe(1);
  });

  test('e2: #UserOracle resolves — a non-pub unit struct in the swarm-agent shape', async () => {
    const { root } = makeProject('unit-struct', {
      '00-overview.md': CORPUS[0]![1],
      'artifacts/examples/autonomous-swe-agent.rs': SWARM_AGENT_RS,
    }, {
      'src/driver.rs': '// see: cans/artifacts/examples/autonomous-swe-agent.rs#UserOracle\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings).toEqual([]);
    expect(scan.pointers).toBe(1);
  });

  test('e3: #LedgerPlugin resolves via the leaf tier — an imported name, never a declaration', async () => {
    const { root } = makeProject('referenced-name', {
      '00-overview.md': CORPUS[0]![1],
      'artifacts/examples/autonomous-swe-agent.rs': SWARM_AGENT_RS,
    }, {
      'src/driver.rs': [
        '// see: cans/artifacts/examples/autonomous-swe-agent.rs#LedgerPlugin',
        '// see: cans/artifacts/examples/autonomous-swe-agent.rs#LedgerCtx',
        '// see: cans/artifacts/examples/autonomous-swe-agent.rs#FinalReceipt',
        '// see: cans/artifacts/examples/autonomous-swe-agent.rs#FinalizeRequest',
        '',
      ].join('\n'),
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings).toEqual([]); // the class-B errors, now resolving
    expect(scan.pointers).toBe(4);
  });

  test('e4: #binary_blake3 resolves — a field-access token (trap and receipt sides)', async () => {
    const { root } = makeProject('field-access', {
      '00-overview.md': CORPUS[0]![1],
      'artifacts/examples/autonomous-swe-agent.rs': SWARM_AGENT_RS,
    }, {
      'src/driver.rs': '// see: cans/artifacts/examples/autonomous-swe-agent.rs#binary_blake3\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings).toEqual([]);
    expect(scan.pointers).toBe(1);
  });

  test('e5: #PgWireRewrite and #DbProxyConfig resolve on the db-runtime.py shape', async () => {
    const { root } = makeProject('py-imports', {
      '00-overview.md': CORPUS[0]![1],
      'artifacts/examples/db-backed-runtime.py': DB_RUNTIME_PY,
    }, {
      'src/main.py': [
        '# see: cans/artifacts/examples/db-backed-runtime.py#PgWireRewrite',
        '# see: cans/artifacts/examples/db-backed-runtime.py#DbProxyConfig',
        '',
      ].join('\n'),
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings).toEqual([]);
    expect(scan.pointers).toBe(2);
  });

  test('e6: #kelir-shim resolves — a tree entry line in a .txt', async () => {
    const { root } = makeProject('tree-entry', {
      '00-overview.md': CORPUS[0]![1],
      'artifacts/config/project-structure.txt': PROJECT_STRUCTURE_TXT,
    }, {
      'src/driver.rs': '// see: cans/artifacts/config/project-structure.txt#kelir-shim\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings).toEqual([]);
    expect(scan.pointers).toBe(1);
  });

  test('e7: #virtio-shm resolves — the box entry in the REAL four-ring-bus.txt, exact spelling', async () => {
    const { root } = makeProject('box-entry', {
      '00-overview.md': CORPUS[0]![1],
      'artifacts/diagrams/four-ring-bus.txt': FOUR_RING_BUS_TXT,
    }, {
      'src/driver.rs': '// see: cans/artifacts/diagrams/four-ring-bus.txt#virtio-shm\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings).toEqual([]);
    expect(scan.pointers).toBe(1);
  });

  test('e8: #driver-rustvmm resolves — a box-tree entry in the heading-less host-runtime shape', async () => {
    const { root } = makeProject('box-tree', {
      '00-overview.md': CORPUS[0]![1],
      'artifacts/diagrams/host-runtime.txt': HOST_RUNTIME_TXT,
    }, {
      'src/driver.rs': [
        '// see: cans/artifacts/diagrams/host-runtime.txt#driver-rustvmm',
        '// see: cans/artifacts/diagrams/host-runtime.txt#driver-avf',
        '',
      ].join('\n'),
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings).toEqual([]); // the no-target warnings, now resolving
    expect(scan.warnings).toEqual([]);
    expect(scan.pointers).toBe(2);
  });

  test('e9: a trait-method typo still misses — with a did-you-mean over the vocabulary', async () => {
    const { root } = makeProject('typo-method', {
      '00-overview.md': CORPUS[0]![1],
      'artifacts/code/container-service.rs': CONTAINER_SERVICE_RS,
    }, {
      'src/driver.rs': '// see: cans/artifacts/code/container-service.rs#configure_runtim\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings.length).toBe(1);
    const f = scan.findings[0]!;
    expect(f.reason).toBe('AnchorNotFound');
    expect(f.message).toBe(
      'broken codebase ref: src/driver.rs:1 — see: cans/artifacts/code/container-service.rs#configure_runtim — broken anchor: cans/artifacts/code/container-service.rs#configure_runtim — no node matches',
    );
    // The CANONICAL anchorSlug spelling — `configure_runtime` slugs to
    // `configure-runtime` (underscore is a separator), which resolves
    // against the symbol through the same §12 normalization.
    expect(f.suggestion).toBe('did you mean cans/artifacts/code/container-service.rs#configure-runtime? — fix the ref anchor');
  });

  test('e10: a referenced-name typo still misses — the leaf union feeds the suggestion', async () => {
    // The #70 observation: the class-B errors "give no such advice — they
    // read as broken". A typo of a referenced name now earns the same
    // did-you-mean quality (nearSlugMatches' threshold bounds noise).
    const { root } = makeProject('typo-leaf', {
      '00-overview.md': CORPUS[0]![1],
      'artifacts/examples/autonomous-swe-agent.rs': SWARM_AGENT_RS,
    }, {
      'src/driver.rs': '// see: cans/artifacts/examples/autonomous-swe-agent.rs#LedgerPlugn\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings.length).toBe(1);
    const f = scan.findings[0]!;
    expect(f.reason).toBe('AnchorNotFound');
    expect(f.suggestion).toBe('did you mean cans/artifacts/examples/autonomous-swe-agent.rs#LedgerPlugin? — fix the ref anchor');
  });

  test('e11: a far miss (#Qutas shape) — no near match, add-node advice', async () => {
    const { root } = makeProject('far-miss', {
      '00-overview.md': CORPUS[0]![1],
      'artifacts/code/container-service.rs': CONTAINER_SERVICE_RS,
    }, {
      'src/driver.rs': '// see: cans/artifacts/code/container-service.rs#Qutas\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings.length).toBe(1);
    const f = scan.findings[0]!;
    expect(f.reason).toBe('AnchorNotFound');
    // Below SLUG_SUGGEST_THRESHOLD against every vocabulary entry — the
    // suggestion is the add-node advice, never a fabricated near match.
    expect(f.suggestion).toBe('no near match in cans/artifacts/code/container-service.rs — add the "Qutas" node there, or fix the anchor spelling');
  });

  test('e12: an anchored pointer at an EMPTY .txt — the UPDATED no-target warning, byte-pinned', async () => {
    // The downgrade condition now includes the leaf vocabularies; an
    // empty .txt has no tokens, so the advisory survives — with the #70
    // parenthetical naming the full addressable set.
    const { root } = makeProject('no-target', {
      '00-overview.md': CORPUS[0]![1],
      'artifacts/empty.txt': '',
    }, {
      'src/driver.rs': '// see: cans/artifacts/empty.txt#anything\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings).toEqual([]);
    expect(scan.warnings.length).toBe(1);
    const w = scan.warnings[0]!;
    expect(w.rule).toBe('codebase.anchor.no-target');
    expect(w.message).toBe(
      'anchor on artifact target: cans/artifacts/empty.txt#anything — target has no addressable nodes (bullets, schematic key paths, text headings, code symbols, referenced names, text tokens); use a file-level ref',
    );
  });

  test('e13: the camelCase guard stands — #ledger-plugin does NOT resolve against LedgerPlugin', async () => {
    // §12 never folds camelCase humps: `ledger-plugin` normalizes to
    // `ledger plugin`, the token to `ledgerplugin` — a truthful MISS even
    // though the leaf tier mints the token. The fuzzy suggestion layer
    // may still teach the intended spelling (advice, never a verdict).
    const { root } = makeProject('camelcase', {
      '00-overview.md': CORPUS[0]![1],
      'artifacts/examples/autonomous-swe-agent.rs': SWARM_AGENT_RS,
    }, {
      'src/driver.rs': '// see: cans/artifacts/examples/autonomous-swe-agent.rs#ledger-plugin\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings.length).toBe(1);
    const f = scan.findings[0]!;
    expect(f.reason).toBe('AnchorNotFound');
    expect(f.message).toContain('#ledger-plugin — broken anchor');
    expect(f.suggestion).toBe('did you mean cans/artifacts/examples/autonomous-swe-agent.rs#LedgerPlugin? — fix the ref anchor');
  });
});

// ── E. The seam guards (what the widening must NOT touch) ─────────────────────

describe('issue #70 engine — the seam guards', () => {
  test('s1: the corpus refs engine inherits the widening — ONE shared verdict', () => {
    // checkRefs' on-disk artifact path rides the same checkArtifactAnchor
    // (the #68/#69 architecture principle), so a spec `see:` pointing at
    // the referenced name resolves there too — no per-engine drift.
    const project = makeTmpDir('issue70-engine-corpus-seam');
    tmps.push(project);
    const root = makeCansWorkspace(project, {
      '00-overview.md': [
        '- Overview',
        '  - Ledger: see artifacts/examples/autonomous-swe-agent.rs#LedgerPlugin',
        '',
      ].join('\n'),
      'artifacts/examples/autonomous-swe-agent.rs': SWARM_AGENT_RS,
    });
    const spec = {
      '00-overview.md': '- Overview\n  - Ledger: see artifacts/examples/autonomous-swe-agent.rs#LedgerPlugin\n',
    };
    const files = new Map<string, OutlineNode[]>(
      Object.entries(spec).map(([name, body]) => [name, parseOutline(body, name)] as const),
    );
    const issues = checkRefs(files, buildRefGraph(files, root), root);
    expect(issues).toEqual([]); // resolves through the leaf tier, silently
  });

  test('s2: a prose .md target keeps bullets-only behavior — the anchor word in the prose does NOT resolve', () => {
    // Neither isTextArtifact nor isCodeArtifact matches `.md`: the leaf
    // tier never applies to spec-node anchors, so `#Session` over prose
    // containing the word Session is still the #49 no-target advisory.
    const prose = 'Session handling lives in the hub.\nNo bullets here at all.\n';
    const nodes = flattenNodes(parseOutline(prose, 'docs/notes.md'));
    expect(nodes).toHaveLength(0);
    const issues = checkArtifactAnchor(
      '00-overview.md', 3, 'docs/notes.md', 'Session', 'docs/notes.md', prose, nodes,
    );
    expect(issues.length).toBe(1);
    expect(issues[0]!.rule).toBe('refs.anchor.no-target');
    expect(issues[0]!.level).toBe('warning');
    expect(issues[0]!.message).toBe(
      'anchor on non-outline target: docs/notes.md#Session — target has no addressable nodes (bullets, schematic key paths, text headings, code symbols, referenced names, text tokens); use a file-level ref',
    );
  });

  test('s3: a schematic target gets NO leaf tier — a VALUE anchor stays a truthful error', () => {
    // `weekly` is a mapping VALUE in the yaml; schematic resolution
    // (parseSchematic dot paths) never mints it, and the leaf vocabulary
    // of a schematic target is [] by construction — so the anchor errors
    // instead of silently resolving against the file's text tokens.
    const yaml = 'governance:\n  maintenance:\n    window: weekly\nchecklist:\n  - first item\n';
    const nodes = flattenNodes(parseOutline(yaml, 'artifacts/governance.yaml'));
    const issues = checkArtifactAnchor(
      '00-overview.md', 3, 'artifacts/governance.yaml', 'weekly', 'artifacts/governance.yaml', yaml, nodes,
    );
    expect(issues.length).toBe(1);
    expect(issues[0]!.rule).toBe('refs.broken.anchor');
    expect(issues[0]!.level).toBe('error');
    expect(issues[0]!.message).toBe('broken anchor: artifacts/governance.yaml#weekly — no node matches');
  });

  test('s4: the codebase engine’s .md tier keeps corpus-node resolution — prose words are not anchors', async () => {
    // A .md target in the corpus resolves against its OUTLINE nodes, not
    // against its prose tokens: an anchor naming a prose word misses even
    // though the word sits in the file verbatim.
    const corpus: Array<[string, string]> = [
      ...CORPUS,
      ['02-notes.md', 'Session tokens are described in prose only here.\n'],
    ];
    const { root } = makeProject('md-tier', {
      '00-overview.md': CORPUS[0]![1],
      '02-notes.md': corpus[1]![1],
    }, {
      'src/driver.rs': [
        '// see: 02-notes.md#Session',         // prose word — misses
        '// see: 02-notes.md',                 // file-level — resolves
        '',
      ].join('\n'),
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(corpus));
    expect(scan.pointers).toBe(2);
    expect(scan.findings.length).toBe(1);
    expect(scan.findings[0]!.reason).toBe('AnchorNotFound');
    expect(scan.findings[0]!.message).toBe(
      'broken codebase ref: src/driver.rs:1 — see: 02-notes.md#Session — anchor not found in 02-notes.md',
    );
  });
});
