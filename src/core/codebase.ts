/** Issue #66 — the codebase inbound-references scanner (RFC: "Codebase
 *  Inbound References: Extract and Validate Embedded `see:` Pointers in
 *  Source Files").
 *
 *  CANS enforces graph integrity inside the markdown corpus (the cans/
 *  workspace). Real implementations annotate functions, types and logic
 *  with pointers back to canonical spec nodes — `// see:
 *  02-auth.md#Session-validation` in Rust, `# see: 04-api.md#Routing` in
 *  Python, block comments in Go, YAML keys — and until now those rotted
 *  silently: no check failed when a spec node was renamed, and no query
 *  could trace which source files reference a node (the
 *  reverse-traceability gap).
 *
 *  This module is the ENGINE half of the RFC. The layers:
 *
 *    1. EXTRACTION (language-agnostic, §2): files are scanned purely as
 *       text — no ASTs, no toolchains, no language runtimes (acceptance 1).
 *       SEE_POINTER_RE finds embedded `see: <file>[#<slug>]` pointers
 *       regardless of surrounding prose, trailing notes, parentheses or
 *       block-comment context (acceptance 2). NOTE for maintainers: a
 *       literal double-star glob can never be written inside a block
 *       comment — the star-slash in it closes the comment (this file's
 *       history is the proof).
 *    2. RESOLUTION (§2.3): `<file>` resolves against the loaded spec-graph
 *       keys (the optional `cans/` prefix is stripped; both `01-spec.md` and
 *       `cans/01-spec.md` spellings resolve to the same corpus file).
 *       `#<slug>` resolves with the SAME tolerant anchor matching the corpus
 *       refs engine uses (anchorMatches → normalizeForAnchor, the
 *       `_rules.yaml#slug.algorithm` contract) — never fuzzy (acceptance 3;
 *       fuzzy stays a suggestion-only layer via nearSlugMatches).
 *    3. FILE SELECTION (§3): the `codebase` block of `_rules.yaml` decides
 *       which trees to scan (roots, resolved from the PROJECT root — the
 *       parent of the workspace, the same convention as
 *       `references.external_roots`) and which files join the scan
 *       (include/exclude globs in the core/glob.ts grammar). Files inside
 *       the workspace itself are ALWAYS skipped: corpus refs verify in the
 *       refs engine, never twice.
 *
 *  The CLI half (`cans check --codebase`, `cans refs <node> --codebase`,
 *  the additive `codebase` wire block) lives in src/commands/check.ts,
 *  src/commands/refs.ts and src/core/report.ts. The `codebase` config block
 *  is a PARAMETER block (absent = OFF), validated strictly in core/rules.ts.
 *
 *  Dependency-free by design (report.ts/slug.ts are the model): string/
 *  regex work + node:fs walking only, portable across the Bun and Node
 *  runtimes. THIS COMMIT IS THE FROZEN CROSS-AGENT CONTRACT: the exported
 *  signatures below are the seam the engine, CLI and docs layers build
 *  against and MUST NOT drift; the bodies land with the engine layer. */

import type { CodebaseRules, CodebaseScan } from '../types.ts';
import type { OutlineNode } from '../types.ts';
import { readdirSync } from 'node:fs';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { globToRegExp } from './glob.ts';

/** §2.1 — the matching rule, verbatim from the RFC (character classes
 *  rewritten in explicit-range spelling; semantics identical):
 *
 *      see:\s+(?:cans\/)?([a-zA-Z0-9_\-\/]+\.md)(?:#([a-zA-Z0-9_\-]+))?
 *
 *  Group 1 = the target file (`01-protocol.md`, `sub/dir/spec.md`, with an
 *  optional `cans/` workspace-qualified spelling), group 2 = the optional
 *  `#slug` anchor fragment. Surrounding prose ("Initial handshake logic;",
 *  trailing " - fails with ENOSPC when exceeded", `/* block comments *​/`,
 *  YAML keys) is invisible to the pattern — §2.2's tolerance contract.
 *  GLOBAL: consumers match per-line (fresh string per line ⇒ fresh lastIndex
 *  state), never on multi-line blobs. */
export const SEE_POINTER_RE: RegExp =
  /see:\s+(?:cans\/)?([A-Za-z0-9_\-/]+\.md)(?:#([A-Za-z0-9_\-]+))?/g;

/** One embedded pointer extracted from a source file (§2). `raw` is the
 *  exact matched span (no surrounding prose), `targetFile`/`targetSlug` are
 *  AS WRITTEN — the optional `cans/` prefix and slug normalization happen at
 *  resolution time, so `refs --codebase` can echo the written spelling. */
// export interface CodebasePointer — see src/types.ts (frozen contract).

/** Extract every embedded pointer from ONE source file's text, in document
 *  order (line asc, then left-to-right). Lines are 1-based. Trailing prose
 *  on the same line never fails the match (§2.3.4). Multi-occurrence lines
 *  yield one pointer per occurrence. */
export function extractCodebasePointers(
  text: string,
): Array<Omit<import('../types.ts').CodebasePointer, 'file'>> {
  const out: Array<Omit<import('../types.ts').CodebasePointer, 'file'>> = [];
  // §45 line normalization (outline.ts's normalizeEol convention): CRLF and
  // lone CR are line terminators just like LF, so line numbers agree with
  // every other consumer's 1-based counting.
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    // Per-line matching (the §2.1 contract): a fresh reset per line, so the
    // global regex's lastIndex state can never leak ACROSS lines while the
    // exec loop below still finds every occurrence WITHIN one line.
    SEE_POINTER_RE.lastIndex = 0;
    for (;;) {
      const m = SEE_POINTER_RE.exec(lines[i]!);
      if (m === null) break;
      // targetFile AS WRITTEN: group 1 excludes the optional `cans/` prefix
      // (the regex matches it outside the capture), so reconstruct the
      // written spelling when the span carries it — resolution strips it
      // again, `refs --codebase` echoes it.
      const targetFile = /^see:\s+cans\//.test(m[0]) ? `cans/${m[1]}` : m[1]!;
      out.push({
        line: i + 1,
        raw: m[0],
        targetFile,
        targetSlug: m[2] ?? null,
      });
    }
  }
  return out;
}

/** §3 file selection: walk `cfg.roots` (each root resolved from the PROJECT
 *  root — dirname(workspaceRoot)), collect files matching any `include` glob
 *  and no `exclude` glob (core/glob.ts grammar, matched against the
 *  project-root-relative `/`-separated path), always skipping everything
 *  inside the workspace root itself. Results are deterministic: sorted
 *  ascending by path, duplicates removed when roots overlap. Missing roots
 *  are an empty result, never a throw (the CLI reports a dedicated warning
 *  for a root that matches no include glob at all). */
export async function collectSourceFiles(
  root: string,
  cfg: CodebaseRules,
): Promise<string[]> {
  const projectRoot = dirname(root);
  // The globs decide (defense-in-depth compile like discoverAliasingFiles:
  // the §18 validator rejects malformed patterns before discovery runs, so a
  // null here can never be the documented path — it simply never matches).
  const include: RegExp[] = [];
  for (const g of cfg.include) {
    const re = globToRegExp(g);
    if (re !== null) include.push(re);
  }
  const exclude: RegExp[] = [];
  for (const g of cfg.exclude) {
    const re = globToRegExp(g);
    if (re !== null) exclude.push(re);
  }
  // TRUE when `candidate` IS `dir` or lives under it (the containment shape
  // fs.ts's isInsideRoot uses, widened with equality: the workspace root
  // itself counts as inside).
  const inside = (dir: string, candidate: string): boolean => {
    const rel = relative(dir, candidate);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  };
  const found = new Set<string>();
  for (const r of cfg.roots) {
    // Each root resolves from the PROJECT root (dirname of the workspace —
    // the references.external_roots convention); "." names the whole project.
    const absRoot = join(projectRoot, r);
    if (inside(root, absRoot)) continue; // the workspace itself: never scanned
    walk(absRoot);
  }
  // Deterministic: ascending by project-relative path, duplicates from
  // overlapping roots collapsed by the Set.
  return [...found].sort();

  function walk(dir: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // missing/unreadable root or subtree: empty, never a throw
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (inside(root, abs)) continue; // never descend into the workspace
        walk(abs);
      } else if (entry.isFile()) {
        if (inside(root, abs)) continue; // corpus refs verify in the refs engine
        // The matched spelling is the PROJECT-root-relative path with `/`
        // separators (the glob grammar's own convention, on every runtime).
        const rel = relative(projectRoot, abs).split('\\').join('/');
        if (!include.some(re => re.test(rel))) continue;
        if (exclude.some(re => re.test(rel))) continue;
        found.add(rel);
      }
    }
  }
}

/** §2.3 full validation pass: select files (collectSourceFiles), extract
 *  pointers, resolve each against the loaded spec graph:
 *    - corpus keys = `corpus` (the workspace-relative key set check.ts
 *      already loaded — spec files, promoted subfolder files, plugin tier);
 *    - `<file>` → key: exact match, else `cans/`-stripped match; no match →
 *      reason 'FileNotFound';
 *    - `#<slug>` → anchorMatches(title, slug) over the key's nodes (YAML
 *      leaf anchors are NOT probed here — v1 scope is spec nodes); no match
 *      → reason 'AnchorNotFound' with a `did you mean` suggestion from
 *      nearSlugMatches when the fuzzy layer finds one ≥ threshold.
 *  Unreadable files surface as `warnings` (rule 'codebase.io', level
 *  'warning') — reported, never silently skipped. Findings are deterministic
 *  (file asc, line asc, raw order within a line). `scanned`/`pointers` count
 *  files and extracted pointers regardless of outcome. */
export async function checkCodebaseRefs(
  root: string,
  cfg: CodebaseRules,
  corpus: ReadonlyMap<string, OutlineNode[]>,
): Promise<CodebaseScan> {
  throw new Error('issue #66: not implemented (engine layer)');
}
