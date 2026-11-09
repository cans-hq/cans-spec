//! examples/swarm-agent.rs — issue #70 fixture miniature of the real
//! autonomous-swe-agent.rs: the cited shapes verbatim (the pub decls that
//! form the file's pre-#70 addressable surface, the INDENTED use tree
//! inside main, the binary_blake3 field-access lines, the finalize chain,
//! and the example-local `struct UserOracle;` — no `pub`, column 0).
//! Workspace artifact: never spec, never scanned (cans/ is always skipped).

use std::sync::Arc;
use async_trait::async_trait;
use kelir::{FinalizeRequest, KelirBuilder, VmConfig};

/// Deserialization target for every `spawn()` call in this file. Any
/// handler that calls `.params::<SpawnAction>(…)` forces serde to validate
/// the inbound JSON against this shape before dispatch.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub enum SpawnAction {
    FixStripeWebhook { repo: String, issue_id: String },
}

async fn build_runtime(oracle: Arc<UserOracle>) -> Result<KelirBuilder, Box<dyn std::error::Error + Send + Sync>> {
    Ok(KelirBuilder::new(VmConfig { vcpus: 4, memory_mb: 4096 }))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let oracle: Arc<UserOracle> = Arc::new(UserOracle::new());
    let session = build_runtime(Arc::clone(&oracle)).await?.boot().await?;
    {
        use kelir::{plugins::{ledger::{FinalReceipt, LedgerCtx, LedgerPlugin,},},};

        // Binary hash integrity — the agent cannot fake this. Receipt is
        // hex of the trap's raw [u8; 32] digest.
        let trap_hex: String = c.trap.binary_blake3.iter()
            .map(|b| format!("{:02x}", b)).collect();
        if receipt.binary_blake3 != trap_hex {
            c.vm.rollback(&pre).await?;
        }

        // Phase 5: signed Merkle receipt (§12.3)
        let receipt: FinalReceipt = session.ctx::<LedgerCtx>().finalize(FinalizeRequest {
            include_merkle_root: true,
        }).await?;
    }
    session.terminate().await?;
    Ok(())
}

// 5. ORACLE (user-supplied post-condition verification engine)
// Example-local evaluator, not a core trait. UserOracle is a plain struct.

pub struct IntentAnalysis {
    pub is_hypothesis_valid: bool,
    pub falsification_reason: Option<String>,
}

struct UserOracle;
impl UserOracle { fn new() -> Self { Self } }

#[async_trait]
impl UserOracle {
    async fn analyze_intent(&self, _trap: &TrapEvent) -> Result<IntentAnalysis, Box<dyn std::error::Error + Send + Sync>> {
        Ok(IntentAnalysis { is_hypothesis_valid: true, falsification_reason: None })
    }
}
