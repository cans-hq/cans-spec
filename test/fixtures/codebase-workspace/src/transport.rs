// Transport plane (issue #71 fixture carrier): the kelir-transport ingress
// path rides the wire-plane diagram's userspace ring (the issue's repro):
// see: cans/artifacts/diagrams/wire-plane.txt#USERSPACE-SMOLTCP-INGRESS-RING

/// The single-token control pointer: the #70 leaf tier already resolves
/// it — the #71 entry tier widens the vocabulary, never narrows it:
// see: cans/artifacts/diagrams/wire-plane.txt#SMOLTCP

pub fn ring_ingress(frame: &[u8]) -> usize {
    frame.len()
}
