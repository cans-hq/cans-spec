// Plugin-plane transaction helpers (issue #67: anchors that carry punctuation).
// Begin, commit, and rollback paths: see: cans/09-plugins.md#Invariants-and-policy-(transaction)
// Inode metadata is authoritative: see: 09-plugins.md#FsInodeAttr-carries-full-mode,-uid,-gid,-size,-content
// Namespace identity: see: 09-plugins.md#UID/GID-mapping-isolation
// JIT gate: see: 09-plugins.md#Dynamic-W^X-JIT-execution-mediation

pub fn begin() -> u32 {
    1
}
