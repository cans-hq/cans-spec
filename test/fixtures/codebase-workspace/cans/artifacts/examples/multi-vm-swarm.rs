//! Example: a multi-VM swarm runtime (issue #67 fixture).
//!
//! Non-spec artifact content under the workspace: the `see:` target of
//! the `CoW swarm mesh federation` spec node in 09-plugins.md. Same
//! class as serverless-webhook.ts — resolvable file-level artifact
//! target, never spec, never scanned.
pub fn federate(mesh: &mut Mesh) -> &mut Mesh {
    mesh.join();
    mesh
}

// ── issue #70 extension: the real example's shapes, verbatim where cited ──
// The NO-pub declarations (WorkerAction, SWARM_REGION, swarm_builder,
// main) are exactly the class the pre-#70 grammar missed; the use-tree
// and the .plugin() lines carry the MeshPlugin / SupplyChainPlugin /
// LedgerPlugin referenced names the swarm code points at.

use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
use serde::Deserialize;

#[derive(Clone, Deserialize)]
enum WorkerAction {
    RunShard { shard_id: u32, total_shards: u32, repo: String, base_sha: String },
}

const SWARM_REGION: &str = "swarm-coordination";
const SWARM_BYTES: usize = 32;

fn swarm_builder() -> KelirBuilder {
    KelirBuilder::new(VmConfig {
        vcpus: 4, memory_mb: 8192,
        driver_policy: DriverPolicy {
            require_hardware_vmm: false,
            allow_emulated_fallback: true,
        },
    })
    // Mesh: peer vsock with mTLS + W3C traceparent propagation.
    .plugin(MeshPlugin::new(MeshConfig {
        peer_identity: PeerIdentity::Spiffe {
            trust_domain: "kelir.local".into(),
            workload_prefix: "swarm/worker".into(),
        },
        mtls: true,
    }))
    // Supply-chain: deny lifecycle scripts inside dependency directories.
    .plugin(SupplyChainPlugin::new(SupplyChainConfig {
        managers: vec![PackageManager::Npm, PackageManager::Pip],
        policy: LifecyclePolicy::DenyInDependencyDirs,
    }))
    // Ledger: mounted so session.ctx::<LedgerCtx>() in main() satisfies
    // Has<LedgerCtx>; the swarm's supply-chain denials are counted there.
    .plugin(LedgerPlugin::new(LedgerConfig {
        store: ".kelir/swarm-audit.merkle.db".into(),
        merkle_chain: true,
    }))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use kelir::{
        plugins::{
            mesh::{MeshConfig, MeshPlugin,},
            supply::{SupplyChainPlugin,},
            ledger::{LedgerPlugin,},
        },
    };
    let session = swarm_builder().seal().boot().await?;
    let cache_ready = Arc::new(AtomicBool::new(false));
    session.exec_in_guest("bash", &["-lc", "npm ci --prefer-offline"]).await?;
    cache_ready.store(true, Ordering::SeqCst);
    session.terminate().await?;
    Ok(())
}
