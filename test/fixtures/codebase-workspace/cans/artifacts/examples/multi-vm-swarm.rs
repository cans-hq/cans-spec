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
