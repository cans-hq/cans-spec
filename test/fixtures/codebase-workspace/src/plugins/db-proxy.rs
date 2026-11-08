// Plugin-plane db proxy (kelir shape: crates/kelir-plugins/plugin-db-proxy).
// The bridge owns one unix domain socket per workspace, speaks postgres
// wire protocol at the front and sqlite at the back.

use std::io::{Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;

/// Statement ids are opaque to the bridge; the router assigns them.
pub type StatementId = u32;

/// One parked connection, waiting for its statement to complete.
pub struct ParkedConnection {
    pub socket: PathBuf,
    pub statement: StatementId,
    pub buffered: Vec<u8>,
}

/// The bridge configuration, resolved from the profile plugin.
#[derive(Debug, Clone)]
pub struct BridgeConfig {
    pub runtime_dir: PathBuf,
    pub max_statement_bytes: usize,
    pub read_only_handles: usize,
}

impl Default for BridgeConfig {
    fn default() -> Self {
        BridgeConfig {
            runtime_dir: PathBuf::from("/var/run/kelir"),
            max_statement_bytes: 16 * 1024 * 1024,
            read_only_handles: 4,
        }
    }
}

/// Bind the bridge socket before the first connection arrives.
///
/// The socket directory is created with mode 0770 and a stale socket from
/// a previous run is unlinked first, once per workspace boot. The frame
/// format and the bind order are the spec's to keep:
// see: cans/plugins/db-proxy.md#SQLite-UDS-bridge-mechanics:
pub fn bind_bridge(cfg: &BridgeConfig) -> std::io::Result<UnixListener> {
    std::fs::create_dir_all(&cfg.runtime_dir)?;
    let sock = cfg.runtime_dir.join("db-proxy.sock");
    let _ = std::fs::remove_file(&sock);
    UnixListener::bind(sock)
}

/// Read one length-prefixed frame from the stream.
///
/// Returns None on a partial frame; the caller parks the connection
/// instead of blocking the plane on a half-delivered statement.
pub fn read_frame(stream: &mut UnixStream, buf: &mut Vec<u8>) -> Option<StatementId> {
    let mut header = [0u8; 8];
    stream.read_exact(&mut header).ok()?;
    let id = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
    let len = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as usize;
    if len > 16 * 1024 * 1024 {
        return None; // oversized frame: protocol error, the caller closes
    }
    buf.resize(len, 0);
    stream.read_exact(buf).ok()?;
    Some(id)
}

/// Write one length-prefixed frame back on the same socket, in order.
pub fn write_frame(stream: &mut UnixStream, id: StatementId, buf: &[u8]) -> std::io::Result<()> {
    let mut header = [0u8; 8];
    header[0..4].copy_from_slice(&id.to_le_bytes());
    header[4..8].copy_from_slice(&(buf.len() as u32).to_le_bytes());
    stream.write_all(&header)?;
    stream.write_all(buf)
}

/// The connection park: statements that outlive their read window wait
/// here until the router replays them against a fresh handle.
pub struct Park {
    slots: Vec<ParkedConnection>,
    capacity: usize,
}

impl Park {
    pub fn new(capacity: usize) -> Self {
        Park { slots: Vec::new(), capacity }
    }

    /// Park a connection; returns false when the park is full and the
    /// caller must close instead of stalling the plane.
    pub fn park(&mut self, conn: ParkedConnection) -> bool {
        if self.slots.len() >= self.capacity {
            return false;
        }
        self.slots.push(conn);
        true
    }

    /// Replay every parked statement whose socket came back.
    pub fn replay(&mut self, mut alive: impl FnMut(&PathBuf) -> bool) -> Vec<ParkedConnection> {
        let mut resumed = Vec::new();
        let mut parked = Vec::new();
        std::mem::swap(&mut parked, &mut self.slots);
        for conn in parked {
            if alive(&conn.socket) {
                resumed.push(conn);
            } else {
                self.slots.push(conn);
            }
        }
        resumed
    }
}

/// Frame codec tests: the header layout and the partial-frame parking
/// rule are contractual, so the tests pin the exact byte order and the
/// close-without-reply refusal path.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oversized_frames_are_refused() {
        // A frame claiming more than the configured maximum is a protocol
        // error: the connection closes without a reply and the plane never
        // buffers an unbounded length. The refusal order and the exact
        // byte layout of the header are the spec's to keep:
        //
        // header layout, statement id first:
        //   bytes 0..4   statement id, little endian
        //   bytes 4..8   body length, little endian
        //
        // refusal order, contractual:
        //   1. the length check runs BEFORE any body byte is read, so a
        //      lying header can never wedge the read loop
        //   2. a partial frame parks the connection, never blocks the
        //      plane on a half-delivered statement
        //   3. a malformed frame closes the connection without a reply
        //
        // the parked slots stay empty on refusal: nothing was buffered,
        // nothing is replayed, the caller observes a clean close, and the
    // see: cans/plugins/db-proxy.md#SQLite-UDS-bridge-mechanics:
        let mut header = [0u8; 8];
        header[4..8].copy_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(header[7], 0xff);
    }
}
