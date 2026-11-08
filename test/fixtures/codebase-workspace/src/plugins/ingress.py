"""Ingress-plane helpers (issue #67: suffix-carrying spec nodes)."""

# Connection parking on suspend: see: cans/09-plugins.md#Connection-parking-on-suspend
def park(conn):
    return conn.parked

# L7 pgwire rewrite and 2PC commit: see: cans/09-plugins.md#L7-pgwire-rewrite-and-2PC-commit
def rewrite(msg):
    return msg

# CoW swarm mesh federation: see: cans/09-plugins.md#CoW-swarm-mesh-federation
def federate(mesh):
    return mesh
