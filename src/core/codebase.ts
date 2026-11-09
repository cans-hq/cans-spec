/** Issue #66 — the codebase inbound-references scanner (RFC: "Codebase
 *  Inbound References: Extract and Validate Embedded `see:` Pointers in
 *  Source Files"). Issue #67 — two false-positive repairs to the ENGINE
 *  (135 false `anchor not found` positives over 748 valid pointers on the
 *  reporter's corpus): the extraction anchor group now captures the FULL
 *  slug alphabet with a #48/#58-style cleaning pass (bug 1, 127/135), and
 *  resolution also matches spec nodes by their title with a trailing
 *  `: see:` suffix stripped (bug 2, 8/135). Issue #68 — the cleaning pass
 *  goes SYMMETRIC at the shared matching seam: the five false positives
 *  0.16.0 still minted on the kelir corpus (all anchors correct per
 *  `cans slug`, all five headings carrying their own trailing `:` — which
 *  the slug contract preserves verbatim into the canonical anchor) were
 *  ONE-SIDED cleaning — the anchor side is cleaned at extraction (here and
 *  outline.ts) while the heading side never was, so a canonical colon
 *  anchor (`SQLite-UDS-bridge-mechanics:`) could never match its heading
 *  (`SQLite UDS bridge mechanics:`). The fix lives in refs.ts
 *  anchorMatches — cleaned-vs-cleaned on BOTH sides — over the pass MOVED
 *  to core/slug.ts as the single shared implementation
 *  (stripAnchorTrailingPunct); stripCodebaseAnchorPunct below is now a
 *  thin delegate that keeps this module's #67 export seam frozen.
 *  Issue #69 — the ARTIFACT target tier: `.md` is no longer the only
 *  pointer target. The extractor's file group now accepts every
 *  extension the artifact anchor machinery can address (CODEBASE_TARGET_
 *  EXTS below — the #58 schematic + #60 text/code vocabularies), and
 *  resolution routes those targets at the WORKSPACE filesystem: the file
 *  must exist under cans/ (resolveSpecFile containment, issue #10) and
 *  the anchor resolves through checkArtifactAnchor — the SAME shared
 *  verdict function the corpus refs engine uses for its on-disk artifact
 *  refs — riding the #68 anchorMatches seam. Code pointing at
 *  `cans/artifacts/**` files stops being silently unvalidated.
 *  Issue #70 — the LEAF tier rides the shared verdict: the artifact
 *  anchors #69 made checkable grew two more vocabularies at the same
 *  seam — Rust non-pub column-0 items and trait methods (code-anchors.ts
 *  grammar v2), plus referenced names and diagram/tree text tokens
 *  (extractCodeLeafNames / extractTextLeafTokens) — so `#configure_runtime`
 *  answers a trait method, `#UserOracle` a non-pub unit struct, and
 *  `#kelir-shim` a tree entry, all through checkArtifactAnchor unchanged.
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
 *       block-comment context (acceptance 2). Issue #67: the anchor group
 *       is `([^\s#]+)` — the FULL slug alphabet, whitespace/`#`-terminated
 *       (the §11 REF_RE shape) — and the captured anchor is cleaned by
 *       stripCodebaseAnchorPunct (glued trailing punctuation stripped,
 *       opener-backed closers repaired) before it is stored as
 *       `targetSlug`; `raw` stays the verbatim written span. NOTE for
 *       maintainers: a literal double-star glob can never be written
 *       inside a block comment — the star-slash in it closes the comment
 *       (this file's history is the proof).
 *    2. RESOLUTION (§2.3): `<file>` resolves against the loaded spec-graph
 *       keys (the optional `cans/` prefix is stripped; both `01-spec.md` and
 *       `cans/01-spec.md` spellings resolve to the same corpus file).
 *       `#<slug>` resolves with the SAME tolerant anchor matching the corpus
 *       refs engine uses (anchorMatches → normalizeForAnchor, the
 *       `_rules.yaml#slug.algorithm` contract) — never fuzzy (acceptance 3;
 *       fuzzy stays a suggestion-only layer via nearSlugMatches). Issue
 *       #67: a node matches on its full text OR on its title with a
 *       trailing `: see:` suffix stripped (spec nodes routinely carry their
 *       own pointer as a suffix; the code points at the bare leaf title).
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
 *  runtimes. The #66 contract commit froze the exported signatures below
 *  as the cross-agent seam (engine ↔ CLI ↔ docs); issue #67 extends that
 *  seam ADDITIVELY with stripCodebaseAnchorPunct and stripSeeRefSuffix —
 *  no #66 signature moved, so the layers built against it keep compiling.
 *  Issue #68 kept the seam byte-identical: the cleaning implementation
 *  moved to slug.ts, and this module's export delegates (same name, same
 *  signature, same module — test/issue-67-engine.test.ts and
 *  src/commands/refs.ts keep importing it from HERE). */

import type { CodebaseRules, CodebaseScan } from '../types.ts';
import type { CodebaseFinding, Issue, OutlineNode } from '../types.ts';
import { readdirSync } from 'node:fs';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { globToRegExp } from './glob.ts';
import { readText } from './runtime.ts';
import { flattenNodes, parseOutline } from './outline.ts';
import { resolveSpecFile } from './fs.ts';
import { anchorMatches, checkArtifactAnchor } from './refs.ts';
import { anchorSlug, nearSlugMatches, stripAnchorTrailingPunct } from './slug.ts';

/** Issue #69 — the addressable target-extension table: the file types a
 *  `see:` pointer in a source file may name BESIDES `.md`. Until #69 the
 *  extractor captured `.md` targets only, so the pointer class the cans
 *  layout actually breeds — code pointing at the workspace's ARTIFACT
 *  files (`// see: cans/artifacts/code/plugin-trait.rs#PluginError`,
 *  `// see: cans/artifacts/diagrams/host-runtime.txt#driver-avf`, a YAML
 *  key under `cans/_rules.yaml`) — was silently skipped by `check
 *  --codebase` and rejected as malformed by `cans refs` (114 of 1523
 *  pointers on the reporter's corpus, 25 distinct artifact files: .rs,
 *  .ts, .py, .yaml, .txt, plus `cans/_rules.yaml` — all unvalidated).
 *
 *  The table is EXACTLY the union of the extensions the artifact anchor
 *  machinery can address — the schematic vocabulary (`.json`/`.yaml`/
 *  `.yml`/`.toml`, core/schematic.ts schematicFormatFor), the text-heading
 *  vocabulary (`.txt`/`.text`, core/text-anchors.ts isTextArtifact), the
 *  code-symbol vocabulary (`.ts`/`.tsx`/`.mts`/`.cts`/`.js`/`.jsx`/
 *  `.mjs`/`.cjs`/`.rs`/`.py`/`.go`, core/code-anchors.ts isCodeArtifact)
 *  — plus `.md` itself (the corpus tier, unchanged). A file type NO
 *  vocabulary can address (`.c`, `.cpp`, `.csv`, `v1.2`, `e.g`) is
 *  deliberately NOT a pointer target: capturing it could only ever mint
 *  unresolvable-anchor noise, never a verified pointer — the extension
 *  table is the grammar's over-capture guard, the target-side twin of
 *  #67's "narrow classes over- and under-capture" lesson. Extensions are
 *  lowercase by the pointer grammar (the `.md` spelling rule; the
 *  resolution-side predicates stay case-insensitive for paths that
 *  arrive by other means). Keep in sync with the three vocabulary
 *  predicates — the engine suite pins the membership matrix. */
export const CODEBASE_TARGET_EXTS: readonly string[] = [
  'md',                                            // the corpus tier (spec files)
  'json', 'yaml', 'yml', 'toml',                   // the schematic vocabulary (#58)
  'txt', 'text',                                   // the text-heading vocabulary (#60)
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'rs', 'py', 'go', // the code-symbol vocabulary (#60)
];

/** Issue #69 — the regex-alternation source for CODEBASE_TARGET_EXTS,
 *  LONGEST-FIRST. Order is correctness, not cosmetics: `tsx` starts with
 *  `ts` (and `jsx` with `js`), and a regex alternation takes its FIRST
 *  matching alternative — in table order `driver.tsx#A` would capture the
 *  target as `driver.ts` and strand the `x`, because the optional anchor
 *  group happily matches empty at `x`. Sorting by length descending makes
 *  every prefix pair resolve to its longest member; equal-length entries
 *  are mutually exclusive, so their order is irrelevant. Both consumers
 *  of the table — the extractor's SEE_POINTER_RE (this module) and the
 *  `cans refs` query grammar (src/commands/refs.ts) — build their
 *  alternation through THIS function so the two grammars can never drift
 *  apart (a query must be able to name everything a pointer can). */
export function codebaseTargetExtAlt(): string {
  return [...CODEBASE_TARGET_EXTS].sort((a, b) => b.length - a.length).join('|');
}

/** §2.1 — the matching rule. The RFC #66 §2.1 pattern is the pointer-GRAMMAR
 *  sketch; per issue #67 the ANCHOR group captures the full slug alphabet,
 *  and per issue #69 the FILE group accepts every extension the artifact
 *  anchor machinery can address:
 *
 *      see:\s+(?:cans\/)?([a-zA-Z0-9_\-\/]+\.(?:json|yaml|…|md))(?:#([^\s#]+))?
 *
 *  Group 1 = the target file — `.md` corpus targets (`01-protocol.md`,
 *  `sub/dir/spec.md`) AND, since #69, ARTIFACT targets (`cans/artifacts/
 *  code/plugin-trait.rs`, `cans/artifacts/diagrams/host-runtime.txt`, a
 *  `.yaml`/`.json`/`.toml`/`.ts`/… file), each with an optional `cans/`
 *  workspace-qualified spelling. Why the widening: 114 of 1523 codebase
 *  `see:` pointers on the reporter's corpus target non-`.md` files (25
 *  distinct artifact files — .rs, .ts, .py, .yaml, .txt, plus
 *  `cans/_rules.yaml`) — the cans layout puts field layouts, schemas, wire
 *  formats, pipeline diagrams and example code under `cans/artifacts/`,
 *  code points at them too, and every one of those pointers was silently
 *  unvalidated by `check --codebase` and rejected as malformed by
 *  `cans refs`. The extension table (CODEBASE_TARGET_EXTS →
 *  codebaseTargetExtAlt — the single source BOTH this regex and the
 *  `cans refs` query grammar build their alternation from, so pointer and
 *  query grammars can never drift) is the grammar's OVER-CAPTURE GUARD:
 *  `.c`, `.cpp`, `.csv`, `v1.2`, `e.g` are deliberately NOT targets — no
 *  anchor vocabulary can address them, so capturing them could only mint
 *  unresolvable-anchor noise, never a verified pointer (the #67
 *  narrow-classes-over-and-under-capture lesson, applied to the target
 *  side). Extensions are LOWERCASE by the `.md` spelling rule
 *  (`driver.RS` is prose, not a pointer; the resolution-side predicates
 *  stay case-insensitive for paths that arrive by other means). The .md
 *  tier's captures are byte-identical with the pre-#69 extractor: `md` is
 *  the alternation's last member and every longer member fails on a
 *  `.md`-terminated spelling, so the same group captures the same span.
 *  Group 2 = the optional `#slug` anchor fragment — whitespace- or
 *  `#`-terminated, the EXACT shape of the spec side's §11 REF_RE anchor
 *  group (core/outline.ts). Why the wide anchor class: the slug contract
 *  (`_rules.yaml#slug.algorithm`, core/
 *  slug.ts) preserves every non-separator character VERBATIM — `(`, `)`,
 *  `,`, `:`, `/`, `^` … all survive into real anchors — so the RFC's narrow
 *  `[a-zA-Z0-9_\-]+` sketch truncated at the first such character and
 *  minted 127 false `anchor not found` positives on the reporter's corpus
 *  (`#UID/GID-mapping-isolation` read as `#UID`, `#Dynamic-W^X-JIT-
 *  execution-mediation` as `#Dynamic-W`). The #48 lesson, again: narrow
 *  classes both over- and under-capture; glued prose punctuation is a
 *  CLEANING problem (stripCodebaseAnchorPunct below — for .md and artifact
 *  anchors alike), never a capture problem. Surrounding prose ("Initial
 *  handshake logic;", trailing " -
 *  fails with ENOSPC when exceeded", block comments, YAML keys) is
 *  invisible to the pattern — §2.2's tolerance contract. GLOBAL: consumers
 *  match per-line (fresh string per line ⇒ fresh lastIndex state), never
 *  on multi-line blobs. */
export const SEE_POINTER_RE: RegExp =
  new RegExp(`see:\\s+(?:cans\\/)?([A-Za-z0-9_\\-/]+\\.(?:${codebaseTargetExtAlt()}))(?:#([^\\s#]+))?`, 'g');

/** One embedded pointer extracted from a source file (§2). `raw` is the
 *  exact matched span (no surrounding prose) and `targetFile` is AS
 *  WRITTEN — the optional `cans/` prefix and slug normalization happen at
 *  resolution time, so `refs --codebase` can echo the written spelling.
 *  `targetSlug` is the written anchor AFTER the issue-#67 cleaning pass
 *  (stripCodebaseAnchorPunct): glued trailing punctuation is gone, the
 *  slug-contract characters themselves are preserved verbatim.
 */
// export interface CodebasePointer — see src/types.ts (frozen contract).

/** Issue #67 — clean a captured codebase anchor: outline.ts's issue-#48
 *  stripRefTrailingPunct (trailing prose punctuation) + issue-#58 bracket
 *  repair, generalized to the full bracket family `()[]{}` (strip ONE
 *  trailing run of closer/sentence punctuation, then repair opener-backed
 *  closers; mid-token punctuation never touched; a trailing `-` `_` `/`
 *  and openers `([{` never stripped).
 *
 *  Issue #68: the IMPLEMENTATION now lives in core/slug.ts —
 *  stripAnchorTrailingPunct, the single shared source — because the pass
 *  stopped being this extractor's private cleaning: refs.ts anchorMatches
 *  cleans BOTH sides of the comparison through it (the heading's own
 *  trailing sentence punctuation is slug-preserved, so the canonical
 *  anchor carrying it — `SQLite-UDS-bridge-mechanics:`, exactly what
 *  `cans slug` prints — must resolve; one-sided cleaning minted 0.16.0's
 *  five kelir false positives). This delegate keeps the frozen #67
 *  cross-agent seam: same name, same signature, same module — the
 *  issue-#67 engine suite and src/commands/refs.ts import it from HERE.
 *  The strip set, the bracket pairs and the full a/b semantics (including
 *  idempotence on structural endings like `API-(v2)` and the empty-after-
 *  strip degradation) are documented at the slug.ts source. */
export function stripCodebaseAnchorPunct(anchor: string): string {
  return stripAnchorTrailingPunct(anchor);
}

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
      // Issue #67: the anchor is CLEANED before storage — the full-alphabet
      // capture (SEE_POINTER_RE above) means the written fragment can carry
      // glued prose punctuation (`Sessions);`), which is not a resolvable
      // slug. `raw` above stays the verbatim span (the #48 convention); an
      // anchor that cleans to empty (`#).`) degrades to a file-level
      // pointer: the file target is real, exactly how outline.ts's
      // matchAliasDefinition degrades emptied anchor tokens.
      const anchor = m[2] === undefined ? '' : stripCodebaseAnchorPunct(m[2]!);
      out.push({
        line: i + 1,
        raw: m[0],
        targetFile,
        targetSlug: anchor === '' ? null : anchor,
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

/** Issue #67 bug 2 — strip a trailing `: see: <token>` reference suffix
 *  from a spec node's text. Spec nodes routinely carry their own pointer
 *  as a suffix (`- Connection parking on suspend: see:
 *  artifacts/examples/serverless-webhook.ts`) while the code points at
 *  the BARE leaf title (`// see: cans/plugins/wire-ingress.md#
 *  Connection-parking-on-suspend` — `cans slug "Connection parking on
 *  suspend"` is exactly that anchor); slugifying the whole node line
 *  matched nothing, which minted 8 false `anchor not found` positives on
 *  the reporter's corpus.
 *
 *  The suffix shape: the SEPARATOR colon before `see` — the split marker
 *  between title and pointer; a bare `- see: x.md` node has no colon
 *  before the keyword and is left alone — then the §11 REF_RE keyword
 *  tolerance (`see:` with optional space, or `see ` with required
 *  whitespace), then ONE `\S+` target token at end of text (any spelling
 *  the ref grammar can write, `#anchor` included) plus trailing
 *  whitespace. A ref that is NOT trailing (`Title: see: a.md and notes`)
 *  is not a suffix and never matches. Returns the trimmed remainder;
 *  text without such a suffix is returned UNCHANGED — not even trimmed,
 *  the no-suffix/no-edit rule. Consumers: checkCodebaseRefs (matches on
 *  the full text OR the stripped title) and anchorSuggestion (candidates
 *  use the stripped title so a `did you mean` proposes the leaf title's
 *  canonical anchorSlug, never the suffixed line's). */
const SEE_SUFFIX_RE = /:\s*see(?::\s*|\s+)\S+\s*$/;

export function stripSeeRefSuffix(nodeText: string): string {
  const m = nodeText.match(SEE_SUFFIX_RE);
  if (m === null) return nodeText;
  return nodeText.slice(0, m.index).trim();
}

/** §2.3 full validation pass: select files (collectSourceFiles), extract
 *  pointers, resolve each — TWO target tiers since issue #69:
 *    - `.md` targets → the CORPUS: keys = `corpus` (the workspace-relative
 *      key set check.ts already loaded — spec files, promoted subfolder
 *      files, plugin tier); `<file>` → key: exact match, else `cans/`-
 *      stripped match; no match → reason 'FileNotFound' ("file not found in
 *      the spec corpus", the pre-#69 finding byte-unchanged); `#<slug>` →
 *      anchorMatches(title, slug) over the key's nodes (YAML leaf anchors
 *      are NOT probed there — v1 scope is spec nodes); no match → reason
 *      'AnchorNotFound' with a `did you mean` suggestion from
 *      nearSlugMatches when the fuzzy layer finds one ≥ threshold.
 *    - ARTIFACT targets (every CODEBASE_TARGET_EXTS spelling but `.md`) →
 *      the WORKSPACE FILESYSTEM (issue #69): resolveSpecFile containment
 *      (issue #10 — the file must exist under cans/; the pointer grammar's
 *      path class cannot write a `.` at all, so `../` traversal spellings
 *      are unwritable, and a leading `/` spelling joins UNDER the root by
 *      path.join semantics); missing → 'FileNotFound' ("artifact target
 *      not found in the cans workspace"); file-level → resolves, nothing
 *      verified; anchored → the SHARED artifact verdict (refs.ts
 *      checkArtifactAnchor — the same function the corpus refs engine's
 *      on-disk artifact refs and `name://` external refs ride): schematic
 *      dot paths / ambiguity / parse errors, bullet nodes, #60 text
 *      headings and code symbols, all through the #68 anchorMatches seam.
 *      Its error verdicts (refs.broken.anchor / refs.anchor.ambiguous /
 *      refs.anchor.parse-error) map to reason 'AnchorNotFound' — the frozen
 *      RFC §4.1 union {FileNotFound, AnchorNotFound} has no finer grain;
 *      the specific WHY rides the message (the shared verdict's own
 *      wording) and the suggestion. Its refs.anchor.no-target downgrade
 *      (the target has NOTHING addressable — an empty .txt, a prose file)
 *      is an ADVISORY, not a broken pointer: scan.warnings rule
 *      'codebase.anchor.no-target', never a finding.
 *  Unreadable files surface as `warnings` (rule 'codebase.io', level
 *  'warning') — source files AND anchored artifact targets (a read or
 *  outline-parse failure: the anchor is not verified, never fabricated —
 *  the corpus engine's unreadable-target precedent) — reported, never
 *  silently skipped. Findings are deterministic (file asc, line asc, raw
 *  order within a line). `scanned`/`pointers` count files and extracted
 *  pointers regardless of outcome. */
export async function checkCodebaseRefs(
  root: string,
  cfg: CodebaseRules,
  corpus: ReadonlyMap<string, OutlineNode[]>,
): Promise<CodebaseScan> {
  const projectRoot = dirname(root);
  const files = await collectSourceFiles(root, cfg);
  const findings: CodebaseFinding[] = [];
  const warnings: Issue[] = [];
  let pointers = 0;
  // Deterministic order falls out of the inputs: files ascend (sorted by
  // collectSourceFiles), pointers come out in document order (line asc, then
  // raw order within a line), findings append as encountered.
  for (const rel of files) {
    let text: string;
    try {
      // `rel` is project-root-relative; the workspace is never in the scan.
      text = await readText(join(projectRoot, rel));
    } catch (e) {
      // Reported, never silently skipped (the pointer set of an unreadable
      // file is unknowable — its absence is what the warning is for).
      warnings.push({
        file: rel,
        line: 0,
        level: 'warning',
        category: 'refs',
        message: `unreadable source file: ${e instanceof Error ? e.message : String(e)} — pointers in it are not scanned`,
        rule: 'codebase.io',
      });
      continue;
    }
    const extracted = extractCodebasePointers(text);
    pointers += extracted.length;
    for (const p of extracted) {
      const pointer = { ...p, file: rel };
      // File resolution (§2.3): exact match on the written spelling first,
      // then the `cans/`-stripped spelling — both name the same corpus key.
      const stripped = p.targetFile.startsWith('cans/')
        ? p.targetFile.slice('cans/'.length)
        : p.targetFile;
      const key = corpus.has(p.targetFile)
        ? p.targetFile
        : corpus.has(stripped)
          ? stripped
          : null;
      if (key === null) {
        // Two-tier file resolution (issue #69). A `.md` spelling names the
        // CORPUS (the loaded spec graph): the pre-#69 FileNotFound finding,
        // byte-unchanged. Anything else the grammar can capture is an
        // ARTIFACT target (CODEBASE_TARGET_EXTS) — resolved against the
        // WORKSPACE FILESYSTEM below. The case-insensitive `.md` test
        // mirrors refs.ts looksLikeSpecRef (`/\.md$/i`): the grammar itself
        // only writes lowercase `md`, but the branch is spelling-driven, not
        // grammar-driven, so any `.md`-shaped target keeps the corpus
        // treatment whatever case arrived.
        if (/\.md$/i.test(stripped)) {
          findings.push({
            ...pointer,
            resolvedFile: null,
            reason: 'FileNotFound',
            message: `broken codebase ref: ${rel}:${p.line} — ${p.raw} — file not found in the spec corpus`,
          });
          continue;
        }
        // The artifact tier: containment per issue #10 (resolveSpecFile's
        // isInsideRoot guard — the file must exist UNDER the workspace
        // root). Both spellings resolve: `stripped` is the targetFile minus
        // the optional `cans/` prefix, exactly as the .md branch computes,
        // and resolveSpecFile joining the workspace root handles `cans/x.rs`
        // and `x.rs` alike. Escaping spellings cannot reach here: the
        // grammar's path class has no `.` (`../` is unwritable), and a
        // leading `/` joins UNDER the root by path.join semantics — the
        // guard is defense in depth, not the only wall.
        const artPath = resolveSpecFile(root, stripped);
        if (artPath === null) {
          findings.push({
            ...pointer,
            resolvedFile: null,
            reason: 'FileNotFound',
            message: `broken codebase ref: ${rel}:${p.line} — ${p.raw} — artifact target not found in the cans workspace`,
          });
          continue;
        }
        // File-level artifact pointer: the file exists, nothing to verify —
        // no read, no parse (the laziness contract checkArtifactAnchor
        // documents; the .md tier's own file-level branch behaves the same).
        if (p.targetSlug === null) continue;
        // Anchored: read and parse the artifact LAZILY — only now. No
        // caching: the corpus engine's on-disk artifact path (refs.ts
        // checkRefs) doesn't cache either; keep symmetric. The parse feeds
        // the BULLET vocabulary (parseOutline — YAML block sequences keep
        // minting bullet nodes, the #49 additive behavior), exactly the
        // corpus engine's on-disk shape.
        let source: string;
        let nodes: OutlineNode[];
        try {
          source = await readText(artPath);
          nodes = flattenNodes(parseOutline(source, artPath));
        } catch {
          // Unreadable/unparseable target: the anchor is NOT verified and
          // never fabricated (the corpus engine's unreadable-target
          // precedent, refs.ts checkRefs) — reported as a warning so the
          // silence itself is visible, never a silent skip.
          warnings.push({
            file: rel,
            line: p.line,
            level: 'warning',
            category: 'refs',
            message: `unreadable artifact target: ${p.targetFile} — anchor not verified`,
            rule: 'codebase.io',
          });
          continue;
        }
        // The SHARED verdict function — the ONE code path the corpus
        // engine's on-disk artifact refs, its name:// external refs, and now
        // the codebase artifact pointers all ride. display = the WRITTEN
        // targetFile (both spellings resolve), so `did you mean` suggestions
        // echo what the author wrote — the anchorSuggestion writtenTarget
        // convention.
        const verdicts = checkArtifactAnchor(
          rel, p.line, p.targetFile, p.targetSlug, artPath, source, nodes,
        );
        for (const issue of verdicts) {
          if (issue.level === 'warning') {
            // The refs.anchor.no-target downgrade: the target has NOTHING
            // addressable, so no anchor could ever resolve there by
            // construction — an advisory, not a broken pointer (the corpus
            // engine's own downgrade, mirrored; message adapted to the
            // codebase scan's vocabulary).
            warnings.push({
              file: rel,
              line: p.line,
              level: 'warning',
              category: 'refs',
              // Issue #71: the parenthetical gained `text entries, ` beside
              // the headings — lockstep with refs.ts's emission, byte for byte.
              message: `anchor on artifact target: ${p.targetFile}#${p.targetSlug} — target has no addressable nodes (bullets, schematic key paths, text headings, text entries, code symbols, referenced names, text tokens); use a file-level ref`,
              rule: 'codebase.anchor.no-target',
              suggestion: `drop the #${p.targetSlug} anchor (file-level refs are valid on any target), or add the anchor as a node/key in ${p.targetFile}`,
            });
            continue;
          }
          // refs.broken.anchor / refs.anchor.ambiguous / refs.anchor.
          // parse-error all map to AnchorNotFound: the frozen RFC §4.1
          // reason union {FileNotFound, AnchorNotFound} has no finer grain,
          // and the finding is truthful at this vocabulary's granularity —
          // the specific WHY rides the message (the shared verdict's own
          // wording) and the suggestion. resolvedFile = the
          // workspace-relative resolved path (`/` separators, the corpus
          // key convention).
          const finding: CodebaseFinding = {
            ...pointer,
            resolvedFile: relative(root, artPath).split('\\').join('/'),
            reason: 'AnchorNotFound',
            message: `broken codebase ref: ${rel}:${p.line} — ${p.raw} — ${issue.message}`,
          };
          if (issue.suggestion !== undefined) finding.suggestion = issue.suggestion;
          findings.push(finding);
        }
        continue;
      }
      if (p.targetSlug === null) continue; // file-level pointer: resolves, nothing to verify
      // Anchor resolution: the SAME tolerant matching the corpus refs engine
      // uses (anchorMatches → normalizeForAnchor) over the key's node titles
      // — exact after normalization, NEVER fuzzy (the fuzzy layer is
      // suggestion-only, below). YAML leaf anchors are not probed: v1 scope
      // is spec nodes. Issue #67 bug 2: the node matches on its FULL text
      // or on its title with a trailing `: see:` suffix stripped — spec
      // nodes routinely carry their pointer as a suffix while the code
      // points at the bare leaf title. stripSeeRefSuffix is a no-op on
      // suffix-free texts, so the first clause alone already carried every
      // pre-#67 resolution.
      const nodes = flattenNodes(corpus.get(key)!);
      if (
        nodes.some(
          n =>
            anchorMatches(n.text, p.targetSlug!) ||
            anchorMatches(stripSeeRefSuffix(n.text), p.targetSlug!),
        )
      )
        continue;
      const finding: CodebaseFinding = {
        ...pointer,
        resolvedFile: key,
        reason: 'AnchorNotFound',
        message: `broken codebase ref: ${rel}:${p.line} — ${p.raw} — anchor not found in ${key}`,
      };
      const suggestion = anchorSuggestion(p.targetFile, p.targetSlug!, nodes);
      if (suggestion !== null) finding.suggestion = suggestion;
      findings.push(finding);
    }
  }
  return { findings, warnings, scanned: files.length, pointers };
}

/** The `did you mean` layer for a failing codebase anchor — the shape of
 *  brokenAnchorSuggestion in refs.ts, scoped to this engine's suggestion-only
 *  contract: nearSlugMatches ranks the target's real node titles (synthetic
 *  parser placeholders excluded, issue #8; `: see:` suffixes stripped,
 *  issue #67, so the proposal is the leaf title's canonical anchorSlug) at
 *  or above the suggestion threshold (SLUG_SUGGEST_THRESHOLD); candidates
 *  collapse to their canonical anchorSlug and dedupe.
 *  ONE near candidate → a pure ref-anchor fix proposal; two or more → the
 *  ambiguity surfaced (top 3, the rest folded into `…`); none → null, and
 *  the finding simply carries no suggestion (resolution itself never went
 *  fuzzy, so this is advice, never a verdict change). The proposed spelling
 *  echoes the pointer's WRITTEN target (both spellings resolve). */
function anchorSuggestion(
  writtenTarget: string,
  anchor: string,
  nodes: readonly OutlineNode[],
): string | null {
  const candidates: string[] = [];
  for (const n of nodes) {
    // Issue #67: candidates use the suffix-stripped title — proposing the
    // suffixed line's slug (`Connection-parking-on-suspend-see-artifacts-…`)
    // would suggest an anchor nobody can resolve. Suffix-free texts pass
    // through stripSeeRefSuffix unchanged, so nothing else moves.
    if (n.synthetic !== true) candidates.push(stripSeeRefSuffix(n.text));
  }
  const slugs = [...new Set(nearSlugMatches(candidates, anchor).map(m => anchorSlug(m.text)))]
    .filter(s => s !== '');
  if (slugs.length === 1) {
    return `did you mean ${writtenTarget}#${slugs[0]}? — fix the ref anchor`;
  }
  if (slugs.length >= 2) {
    // Top 3 by score (nearSlugMatches order), the rest folded into `…` so the
    // line stays inside the compact-output budget.
    const named = slugs.slice(0, 3).map(s => `${writtenTarget}#${s}`).join(', ');
    const more = slugs.length > 3 ? ', …' : '';
    return `did you mean ${named}${more}? — fix the ref anchor`;
  }
  return null;
}
