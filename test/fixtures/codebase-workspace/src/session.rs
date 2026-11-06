// Session lifecycle for the gateway.
// Initial handshake logic; see: 01-auth.md#Sessions for the canonical flow.
use std::time::Duration;

pub fn refresh_token() -> Duration {
    // Renewals are quiet; see: 01-auth.md#Token-validation before every retry.
    Duration::from_secs(30 * 60)
}

pub fn expiry_note() -> &'static str {
    // see: 01-auth.md#token_validation - fails closed when the grant is stale
    "tokens expire after twenty-four hours"
}

pub fn session_scope() -> &'static str {
    "sessions are scoped per device"
}
