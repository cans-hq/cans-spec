// Artifact wiring (issue #69 fixture): the plugin plane binds its drivers
// onto the workspace's ARTIFACT files — the layouts, diagrams and example
// code under cans/artifacts/ — exactly the pointer class the issue reports:
// until #69 these were silently skipped by `check --codebase` and rejected
// as malformed by `cans refs`. Each wiring comment below carries one
// `see:` pointer at a pinned line; three are valid (one per anchor tier —
// code symbol, text heading, schematic dot path) and three are the issue's
// own broken spellings, kept broken on purpose.

use std::path::PathBuf;

/// The swarm federation example is the reference federation loop; the
/// mesh-join order it pins is the spec's to keep:
// see: cans/artifacts/examples/multi-vm-swarm.rs#federate
pub fn wire_swarm(mesh_dir: PathBuf) -> PathBuf {
    mesh_dir
}

/// The host runtime diagram owns the driver topology; the avf plane is
/// pinned there, underlined heading and all:
// see: cans/artifacts/diagrams/host-runtime.txt#driver-avf
pub fn wire_avf(runtime_dir: PathBuf) -> PathBuf {
    runtime_dir
}

/// The scan config itself is addressable: the enabled flag the codebase
/// block carries is the knob this wiring honors at boot:
// see: cans/_rules.yaml#codebase.enabled
pub fn scan_enabled(cfg: PathBuf) -> bool {
    cfg.is_file()
}

/// Below this line are the issue's broken spellings, kept broken on
/// purpose. First, a misspelled code symbol (near miss of `federate` —
/// the did-you-mean layer knows the answer):
// see: cans/artifacts/examples/multi-vm-swarm.rs#federateNope
pub fn broken_symbol_probe() {}

/// Second, a misspelled diagram heading (near miss of `driver-avf`):
// see: cans/artifacts/diagrams/host-runtime.txt#driver-avf-nope
pub fn broken_heading_probe() {}

/// Third, the issue's exact missing-artifact spelling: the code/ directory
/// does not exist on this fixture (the example code lives under
/// artifacts/examples/), so the FILE is the broken half:
// see: cans/artifacts/code/plugin-trait.rs#PluginError
pub fn broken_file_probe() {}
