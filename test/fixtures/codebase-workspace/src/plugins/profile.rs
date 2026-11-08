// Plugin-plane profile (kelir shape: crates/kelir-plugins/plugin-profile).
// One profile per workspace: providers register capabilities, the router
// resolves them on demand, nobody looks anything up by address.

use std::collections::HashMap;

/// A capability key: what a provider offers, not where it lives.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Capability(pub String);

/// Registration receipt, handed back to the provider.
pub struct Receipt {
    pub capability: Capability,
    pub generation: u32,
}

/// Constructors receive their dependencies as arguments, the router wires
/// them by capability key, and a late registration rebinds on the next
/// resolution pass — nobody looks a dependency up by address. The wiring
/// contract is the spec's to keep:
// see: cans/plugins/profile.md#Inversion-of-Control-configuration-router:
pub struct Router {
    providers: HashMap<Capability, usize>,
    generations: u32,
}

impl Router {
    /// Register a provider under its capability; late registrations are
    /// legal and simply win the next resolution pass.
    pub fn register(&mut self, cap: Capability) -> Receipt {
        self.generations += 1;
        self.providers.insert(cap.clone(), self.generations as usize);
        Receipt { capability: cap, generation: self.generations }
    }

    /// Resolve a capability to its wiring generation; a missing provider
    /// is an error the caller surfaces, never a silent fallback.
    pub fn resolve(&self, cap: &Capability) -> Option<usize> {
        self.providers.get(cap).copied()
    }
}
