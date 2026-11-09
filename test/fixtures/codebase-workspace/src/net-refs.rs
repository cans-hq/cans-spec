// Net refs (issue #72 fixture carrier): the minimal repro of the report —
// a bracketed entry SHARING its line with other bracketed groups:
// see: cans/artifacts/diagrams/t.txt#FOO-BAR-BAZ

/// The single-pair control: line 2 is a lone bracketed span, resolved by
/// the #71 one-outermost-pair strip on BOTH sides of the merge — the
/// per-group widening never narrows it:
// see: cans/artifacts/diagrams/t.txt#SOLO-ENTRY-HERE

pub fn net_refs(frame: &[u8]) -> usize {
    frame.len()
}
