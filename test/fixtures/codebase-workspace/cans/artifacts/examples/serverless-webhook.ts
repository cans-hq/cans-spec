// Example: a serverless webhook runtime (issue #67 fixture).
//
// Non-spec artifact content under the workspace: the `see:` target of the
// `Connection parking on suspend` spec node in 09-plugins.md. Never
// discovered as a spec file (no index.md anywhere above it) and never
// scanned by the codebase phase (everything inside cans/ is always
// skipped) — it exists so the corpus ref resolves as a file-level
// artifact pointer, the issue #49/#60 terminal-target class.
export function parkConnection(conn) {
  conn.parked = true;
  return conn;
}
