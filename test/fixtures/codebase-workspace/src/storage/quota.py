"""Quota enforcement helpers for the storage plane."""

# Timeouts bound every storage call: see: 07-network.md
def check_quota(user):
    return user.quota

# Sweep metrics live in the observability spec: see: 09-observability.md
def emit_metrics():
    return None
