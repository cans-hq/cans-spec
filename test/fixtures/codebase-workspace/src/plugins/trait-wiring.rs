// Trait wiring (issue #70 fixture): the plugin plane binds onto the
// workspace's artifact files through the vocabularies issue #70 adds — the
// Rust declaration grammar v2 (trait methods inside `pub trait` blocks,
// the no-pub column-0 unit struct) and the LEAF tier (referenced names in
// imports/uses/field accesses of code targets, text tokens of tree and box
// lines). Each wiring comment below carries one `see:` pointer at a pinned
// line: fifteen are VALID post-#70 (pre-#70 0.18.0 they were the issue's
// false `codebase.broken_reference` errors), two are near-miss typos kept
// broken on purpose, one rides an empty target (the no-target advisory).

use std::path::PathBuf;

/// The container plugin's trait surface: the lifecycle methods this wiring
/// drives at boot, scratch-mount and image-ingest time:
// see: cans/artifacts/code/container-service.rs#configure_runtime
pub fn wire_container_runtime(cfg: PathBuf) -> PathBuf {
    cfg
}

/// The scratch mount and the pre-cached image ingest follow the same
/// trait contract:
// see: cans/artifacts/code/container-service.rs#mount_scratch
pub fn wire_container_scratch(dev: PathBuf) -> PathBuf {
    dev
}

// see: cans/artifacts/code/container-service.rs#ingest_image
pub fn wire_container_ingest(tarball: PathBuf) -> PathBuf {
    tarball
}

/// The agent example's oracle is the example-local unit struct (no `pub`,
/// column 0 — the declaration grammar v2 class):
// see: cans/artifacts/examples/swarm-agent.rs#UserOracle
pub fn wire_oracle(oracle: PathBuf) -> PathBuf {
    oracle
}

/// The ledger plugin joins through its import name, and the receipt chain
/// rides the field accesses and the finalize types:
// see: cans/artifacts/examples/swarm-agent.rs#LedgerPlugin
pub fn wire_ledger(store: PathBuf) -> PathBuf {
    store
}

// see: cans/artifacts/examples/swarm-agent.rs#binary_blake3
pub fn wire_trap_hash(hex: PathBuf) -> PathBuf {
    hex
}

// see: cans/artifacts/examples/swarm-agent.rs#FinalizeRequest
pub fn wire_finalize_req(req: PathBuf) -> PathBuf {
    req
}

// see: cans/artifacts/examples/swarm-agent.rs#FinalReceipt
pub fn wire_receipt(receipt: PathBuf) -> PathBuf {
    receipt
}

/// The db-backed example's pgwire rewrite and its proxy config, both
/// referenced names of the builder body:
// see: cans/artifacts/examples/db-runtime.py#PgWireRewrite
pub fn wire_pgwire(upstream: PathBuf) -> PathBuf {
    upstream
}

// see: cans/artifacts/examples/db-runtime.py#DbProxyConfig
pub fn wire_db_proxy(cfg: PathBuf) -> PathBuf {
    cfg
}

/// The swarm example wires the mesh and supply-chain plugins through their
/// use-tree names:
// see: cans/artifacts/examples/multi-vm-swarm.rs#MeshPlugin
pub fn wire_mesh(mesh: PathBuf) -> PathBuf {
    mesh
}

// see: cans/artifacts/examples/multi-vm-swarm.rs#SupplyChainPlugin
pub fn wire_supply_chain(policy: PathBuf) -> PathBuf {
    policy
}

/// The project layout names the guest micro-init crate as a tree entry
/// token; the four-ring bus diagram names its shared-memory box the same
/// way; the host runtime tree names its default driver:
// see: cans/artifacts/config/project-structure.txt#kelir-shim
pub fn wire_shim(shim: PathBuf) -> PathBuf {
    shim
}

// see: cans/artifacts/diagrams/four-ring-bus.txt#virtio-shm
pub fn wire_shm_ring(ring: PathBuf) -> PathBuf {
    ring
}

// see: cans/artifacts/diagrams/host-runtime.txt#driver-rustvmm
pub fn wire_rustvmm(driver: PathBuf) -> PathBuf {
    driver
}

/// Below this line: the issue's near-miss typos, kept broken on purpose
/// (the did-you-mean layer knows both answers post-#70), and the
/// empty-target advisory class:
// see: cans/artifacts/code/container-service.rs#configure_runtim
pub fn broken_trait_method_probe() {}

// see: cans/artifacts/examples/swarm-agent.rs#LedgerPlugn
pub fn broken_import_name_probe() {}

/// The metrics diagram is an EMPTY target: nothing addressable by any
/// vocabulary, so the anchored pointer is the no-target ADVISORY (rule
/// codebase.anchor.no-target), never a finding:
// see: cans/artifacts/diagrams/empty-metrics.txt#anything
pub fn wire_metrics_probe(metrics: PathBuf) -> PathBuf {
    metrics
}
