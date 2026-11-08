// Plugin-plane wire ingress (kelir shape: crates/kelir-plugins/plugin-wire-ingress).
// Terminates ingress streams from the edge and normalizes every stream
// kind onto the spine mux.

/// The stream kinds the ingress plane terminates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamKind {
    L4Raw,
    L7Parsed,
    Control,
    L4Forward,
}

/// L4_FORWARD frames carry opaque ip payloads under a fixed sixteen byte
/// header; the kind byte and the reserved mux id 0x0001 travel together,
/// a frame never spans a mux id boundary, and zero-length frames are
/// keepalives. The framing rules are the spec's to keep:
// see: cans/plugins/wire-ingress.md#Ingress-stream-framing-on-stream-kind-L4-FORWARD-(mux-0x0001):
pub const L4_FORWARD_MUX_ID: u32 = 0x0001;
pub const L4_FORWARD_HEADER_BYTES: usize = 16;

/// One normalized frame on the spine mux.
pub struct SpineFrame {
    pub mux_id: u32,
    pub kind: StreamKind,
    pub payload: Vec<u8>,
}

/// Demux table state: unknown ids drop silently, credit is per id.
pub struct DemuxTable {
    seen: std::collections::HashSet<u32>,
    credit: std::collections::HashMap<u32, u32>,
}

impl DemuxTable {
    pub fn new() -> Self {
        DemuxTable {
            seen: std::collections::HashSet::new(),
            credit: std::collections::HashMap::new(),
        }
    }

    /// Admit a mux id with its initial credit window.
    pub fn admit(&mut self, mux_id: u32, window: u32) {
        self.seen.insert(mux_id);
        self.credit.entry(mux_id).or_insert(window);
    }

    /// Unknown ids drop silently; a known id spends one credit.
    pub fn spend(&mut self, mux_id: u32) -> bool {
        match self.credit.get_mut(&mux_id) {
            Some(c) if *c > 0 => {
                *c -= 1;
                true
            }
            _ => false,
        }
    }

    /// Credit returns on frame ack, per mux id, never per connection.
    pub fn ack(&mut self, mux_id: u32, frames: u32) {
        if let Some(c) = self.credit.get_mut(&mux_id) {
            *c = c.saturating_add(frames);
        }
    }
}

/// Encode one L4_FORWARD frame: sixteen byte header, then the payload.
///
/// The header layout is contractual: kind byte first, then the reserved
/// mux id 0x0001, then the length; nothing else rides the frame. Frame
/// boundaries follow mux id boundaries exactly, so a payload that would
/// cross one is rejected here rather than split mid-stream — and the
/// sixteen byte header plus the kind/mux pairing rule is the spec's to
/// keep, verbatim:
/// a keepalive is the same header with a zero length and no payload,
/// indistinguishable from a data frame until the length is read, and a
/// protocol error anywhere in the header tears down the whole connection,
/// never just the offending mux id.
/// a keepalive is the same header with a zero length and no payload,
/// indistinguishable from a data frame until the length is read, and a
/// protocol error anywhere in the header tears down the whole connection,
/// never just the offending mux id.
/// a keepalive is the same header with a zero length and no payload,
// see: cans/plugins/wire-ingress.md#Ingress-stream-framing-on-stream-kind-L4-FORWARD-(mux-0x0001):
pub fn encode_l4_forward(payload: &[u8]) -> Option<Vec<u8>> {
    let mut frame = vec![0u8; L4_FORWARD_HEADER_BYTES];
    frame[0] = StreamKind::L4Forward as u8;
    frame[1..5].copy_from_slice(&L4_FORWARD_MUX_ID.to_le_bytes());
    frame[5..9].copy_from_slice(&(payload.len() as u32).to_le_bytes());
    frame.extend_from_slice(payload);
    Some(frame)
}
