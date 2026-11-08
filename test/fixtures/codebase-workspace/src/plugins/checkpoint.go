package plugins

/*
Checkpoint coordinator (issue #67: the :: anchor, plus glued closers).

The spec side of this plane:
see: cans/10-lifecycle.md#Native-checkpoint-plane-(kelir-core::checkpoint)
*/
func coordinate() {}

/* (see: cans/09-plugins.md#Invariants-and-policy-(transaction)) */
func invariants() {}

// Glued prose closers never reach the anchor: see: 09-plugins.md#UID/GID-mapping-isolation);
func mapIds() {}
