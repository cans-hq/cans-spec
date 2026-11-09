// Trap interception (issue #71 fixture carrier): the kelir-shim trap path
// rides the unotify flow the trap-flow diagram draws, entry by entry:
// see: cans/artifacts/diagrams/trap-flow.txt#Kernel-seccomp-unotify-triggers

/// The near-miss phrase typo, kept broken on purpose — post-#71 the
/// did-you-mean layer knows the entry spelling (the singular):
// see: cans/artifacts/diagrams/trap-flow.txt#Kernel-seccomp-unotify-trigger

pub fn handle_unotify(notify_fd: i32) -> i32 {
    notify_fd
}
