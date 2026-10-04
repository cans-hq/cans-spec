import { readFileSync } from 'fs';
import { join } from 'path';
import type { OutlineNode, RefTarget, BackPointer, Issue } from '../types.ts';
import { flattenNodes, parseOutline } from './outline.ts';
import { resolveSpecFile, toRelative, isFile, dirExists, exists } from './fs.ts';

export interface RefGraph {
  forward: Map<string, RefTarget[]>;
  back: BackPointer[];
}

/** Does a raw ref target `name` point at workspace file `key`?
 *  Handles flat (`02-auth.md`) and folder (`02-auth/index.md`) layouts.
 *  Issue #22: trailing-slash folder forms are equivalent spellings —
 *  `auth/`, `auth` and `auth/index.md` all name the same folder-layout
 *  target, so trailing slashes are trimmed before every comparison. */
export function targetMatchesKey(name: string, key: string): boolean {
  const n = name.toLowerCase().replace(/\/+$/, '');
  const k = key.toLowerCase();
  if (n === k) return true;
  const nBase = n.endsWith('.md') ? n.slice(0, -3) : n;
  const kBase = k.endsWith('/index.md') ? k.slice(0, -9) : k.endsWith('.md') ? k.slice(0, -3) : k;
  if (nBase === kBase) return true;
  if (n.endsWith('.md') && k === `${nBase}/index.md`) return true;
  if (k.endsWith('.md') && n === `${kBase}/index.md`) return true;
  return false;
}

/** Issue #10 (round-6 port of 3adbc91): does a raw see: target escape the
 *  workspace — an absolute path or a `..` segment? Such targets can never
 *  name a workspace spec file, so their broken-ref message is workspace-scoped
 *  and their advice never proposes creating a path outside the workspace
 *  (no more `create /etc/hosts`). Conservative by design: ANY `..` segment
 *  flags — the label only affects messaging; actual resolution is decided by
 *  resolveSpecFile's containment guard, so interior `..` that normalizes back
 *  inside the root still resolves. */
export function refEscapesWorkspace(name: string): boolean {
  return name.startsWith('/') || name.split('/').includes('..');
}

/** Map a raw ref target to the loaded files-map key, if the target is loaded or resolvable on disk. */
function loadedKeyFor(files: Map<string, OutlineNode[]>, root: string, name: string): string | null {
  // Issue #22: normalize the trailing-slash folder form up front so every
  // probe below (`auth/`, `auth`, `auth/index.md`) agrees with targetMatchesKey.
  const target = name.replace(/\/+$/, '');
  if (target === '') return null;
  if (files.has(target)) return target;
  // Round 6 (QA-19 F51): §11 flat-first covers extensionless FLAT targets
  // too — `see 02-b` resolves to `02-b.md` exactly like `see auth` resolves
  // to `auth/index.md` (folders already had this). Probed BEFORE the folder
  // index so flat wins when both spellings exist.
  if (!target.endsWith('.md') && files.has(`${target}.md`)) return `${target}.md`;
  if (target.endsWith('.md') && files.has(`${target.slice(0, -3)}/index.md`)) return `${target.slice(0, -3)}/index.md`;
  if (!target.endsWith('.md') && files.has(`${target}/index.md`)) return `${target}/index.md`;
  const p = resolveSpecFile(root, target);
  if (p === null) return null;
  const rel = toRelative(root, p);
  if (files.has(rel)) return rel;
  for (const key of files.keys()) if (targetMatchesKey(target, key)) return key;
  return null; // exists on disk but is not part of the loaded set
}

/** Anchor ↔ node-text equivalence (§12 docs' own `#Data-protection` convention):
 *  case-insensitive, hyphens/underscores ↔ spaces. Not fuzzy — exact after
 *  normalization. */
export function anchorMatches(nodeText: string, anchor: string): boolean {
  if (nodeText === anchor) return true;
  const norm = (s: string): string =>
    s.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return norm(nodeText) === norm(anchor);
}

/** Does an UNRESOLVED ref target look like an intended spec reference
 *  (broken-ref error territory) or like English prose that merely contains
 *  the word "see" (warning territory)? (issue #4)
 *
 *  The §11 ref regex intentionally keeps minting refs from any `see <token>`
 *  prose ("see the runbook", "see below") so banner counts and deep-hop/orphan
 *  machinery stay centralized in the graph. Classification happens only at
 *  resolution time, in checkRefs: a target that itself looks spec-shaped keeps
 *  the documented broken-ref error; anything else is prose, not a dangling
 *  spec pointer. */
export function looksLikeSpecRef(target: string, hasAnchor: boolean): boolean {
  if (hasAnchor) return true;                      // see X#anchor — explicit anchor intent
  if (/\.md$/i.test(target)) return true;           // explicit markdown target
  if (/^_/.test(target)) return true;               // workspace service dirs (_tasks/, _collab/, ...)
  if (target.includes('/')) return true;            // path-like
  if (/^\d/.test(target)) return true;              // numeric-prefix spec stems (02-auth)
  return false;
}

export function buildRefGraph(
  files: Map<string, OutlineNode[]>,
  root: string,
): RefGraph {
  void root; // graph is purely structural; root retained for signature stability
  const forward = new Map<string, RefTarget[]>();
  const back: BackPointer[] = [];
  for (const [file, nodes] of files) {
    const targets: RefTarget[] = [];
    for (const node of flattenNodes(nodes)) {
      for (const ref of node.refs) targets.push(ref);
    }
    forward.set(file, targets);
    for (const ref of targets) {
      back.push({ fromFile: file, fromLine: ref.line, toFile: ref.file, toAnchor: ref.anchor });
    }
  }
  return { forward, back };
}

/** Issue #22: broken-ref create-* advice must never propose creating a path
 *  that already exists (file or directory — same hygiene family as #10's
 *  `create /etc/hosts`), and (round 6, issue #10 port) never a path outside
 *  the workspace. A trailing-slash target (`see auth/`) reaches this branch
 *  only when no spec file sits behind it: if the bare folder exists without
 *  an index.md, the actionable creation target is the folder's spec file; if
 *  the folder is already complete (a deeper, non-spec index.md), the only fix
 *  is the ref target itself. Plain missing targets keep the exact legacy
 *  `create <target> or fix the ref target` advice — and (round 6, QA-19 F51)
 *  a missing extensionless stem proposes its §11 flat-first file `<stem>.md`,
 *  never an extensionless file. */
function brokenRefSuggestion(root: string, target: string): string {
  // Defense in depth: checkRefs classifies escapes before calling here, but
  // the contract holds for ANY caller — an escaping target never earns a
  // create-* proposal.
  if (refEscapesWorkspace(target)) {
    return 'fix the ref target — see: targets must name spec files inside the workspace (no ../ or absolute paths)';
  }
  const clean = target.replace(/\/+$/, '');
  if (clean === '') return 'fix the ref target';
  if (dirExists(join(root, clean))) {
    if (!exists(join(root, clean, 'index.md'))) {
      return `create ${clean}/index.md or fix the ref target`;
    }
    return `fix the ref target — ${clean}/ is a folder, not a spec file`;
  }
  if (isFile(join(root, clean))) {
    return `fix the ref target — ${clean} is not a spec file`;
  }
  if (clean.endsWith('.md')) {
    return `create ${clean} or fix the ref target`;
  }
  return clean !== target
    ? `create ${clean}/index.md or fix the ref target`
    : `create ${clean}.md or fix the ref target`;
}

export function checkRefs(
  files: Map<string, OutlineNode[]>,
  graph: RefGraph,
  root: string,
): Issue[] {
  const issues: Issue[] = [];
  for (const [file, targets] of graph.forward) {
    for (const ref of targets) {
      if (ref.file === file) {
        issues.push({
          file, line: ref.line, level: 'error', category: 'refs',
          message: `self-reference: ${file} → ${ref.file}`,
          rule: 'refs.self', // issue #41: machine-readable rule key
          suggestion: 'remove the self-reference; point at the canonical file instead',
        });
        continue;
      }
      if (ref.file.startsWith('_tasks/')) {
        issues.push({
          file, line: ref.line, level: 'warning', category: 'refs',
          message: `transient ref: see ${ref.file} — _tasks/ files are transient, not spec`,
          rule: 'refs.transient', // issue #41: machine-readable rule key
          suggestion: 're-point at a spec file when the task lands',
        });
        continue;
      }
      if (ref.file.startsWith('_collab/')) {
        issues.push({
          file, line: ref.line, level: 'error', category: 'refs',
          message: `ref to _collab/: see ${ref.file} — collab notes are not spec`,
          rule: 'refs.collab', // issue #41: machine-readable rule key
          suggestion: 'move the content into a spec file and ref that',
        });
        continue;
      }

      const key = loadedKeyFor(files, root, ref.file);
      if (key === null && resolveSpecFile(root, ref.file) === null) {
        // Issue #10 (round-6 port of 3adbc91): ../ and absolute targets
        // escape the workspace — say so, and never suggest creating a path
        // outside it (`create /etc/hosts` proposed creating an EXISTING file
        // beyond the root; `create ../escape` proposed a traversal path).
        // Checked before the issue #4 prose exemption: an escaping target is
        // never English prose. (Resolution itself is contained by
        // resolveSpecFile's isInsideRoot guard — this is the reporting half.)
        if (refEscapesWorkspace(ref.file)) {
          issues.push({
            file, line: ref.line, level: 'error', category: 'refs',
            message: `broken ref: see ${ref.file} — file not found in workspace`,
            rule: 'refs.broken.file', // issue #41: machine-readable rule key
            suggestion: 'fix the ref target — see: targets must name spec files inside the workspace (no ../ or absolute paths)',
          });
          continue;
        }
        // §12 edge cases: "File not found → Broken ref error." There is NO
        // span/direction exemption — forward or backward, inside or outside the
        // loaded numeric span, a missing file is always a level:error broken
        // ref. (The former "unwritten spec slot" backward in-span downgrade
        // violated §12 and masked real holes as warnings — removed.)
        //
        // Issue #4 prose exemption: that error contract applies to targets that
        // THEMSELVES look like intended spec references (looksLikeSpecRef —
        // anchored, .md, workspace-service-dir, path-like, or numeric-prefix).
        // English prose that merely contains the word "see" ("see the runbook",
        // "see below") mints a ref target that resolves to nothing and is not
        // spec-shaped — downgraded to a see-like-prose warning so natural
        // language no longer fails the run. Genuinely malformed real refs
        // (.md targets, anchors, paths, numeric stems) keep the exact error.
        if (looksLikeSpecRef(ref.file, ref.anchor !== null)) {
          issues.push({
            file, line: ref.line, level: 'error', category: 'refs',
            message: `broken ref: see ${ref.file} — file not found`,
          rule: 'refs.broken.file', // issue #41: machine-readable rule key
            suggestion: brokenRefSuggestion(root, ref.file),
          });
        } else {
          issues.push({
            file, line: ref.line, level: 'warning', category: 'refs',
            message: `see-like prose: "see ${ref.file}" did not resolve to a spec file — rephrase or link explicitly`,
          rule: 'refs.prose', // issue #41: machine-readable rule key
            suggestion: 'use "see: <file>.md" (or "see: <file>.md#<anchor>") to link a spec file, or reword the sentence',
          });
        }
        continue;
      }

      const anchor = ref.anchor;
      if (anchor !== null) {
        let nodes: OutlineNode[] | null = null;
        if (key !== null) {
          nodes = flattenNodes(files.get(key)!);
        } else {
          const p = resolveSpecFile(root, ref.file);
          if (p !== null) {
            try {
              nodes = flattenNodes(parseOutline(readFileSync(p, 'utf-8'), p));
            } catch {
              nodes = null;
            }
          }
        }
        if (nodes !== null) {
          // §12: exact text match, then case-insensitive fallback; the docs' own
          // anchor convention (`#Data-protection` for node "Data protection") also
          // matches via hyphen/space normalization.
          const hit = nodes.some(n => anchorMatches(n.text, anchor));
          if (!hit) {
            issues.push({
              file, line: ref.line, level: 'error', category: 'refs',
              message: `broken anchor: ${ref.file}#${anchor} — no node matches`,
          rule: 'refs.broken.anchor', // issue #41: machine-readable rule key
              suggestion: `fix the anchor or add a "${anchor}" node to ${ref.file}`,
            });
          }
        }
      }
    }
  }
  return issues;
}

/** Deep-hop detection: a file that both receives refs and issues them extends
 *  the ref chain. `maxHops` (§18 references.max_hops, default 1) is the number
 *  of allowed hops.
 *
 *  Semantics (issue #5):
 *  - Nodes are the loaded file keys; an edge a → b exists when a holds a see:
 *    ref resolving to loaded file b (targetMatchesKey, flat and folder
 *    layouts). Self-refs never form edges — checkRefs reports those.
 *  - Strongly-connected meshes (2-cycles, 3-cycles, any mutual back-reference
 *    cluster — the shape the engine's own redundancy guidance encourages) are
 *    collapsed via Tarjan's SCC. A ref from b back into b's own mesh is the
 *    documented back-reference pattern and is never a hop; only refs LEAVING
 *    b's mesh extend a chain, so a pure mesh can never be flagged.
 *  - For a file b with a mesh-exiting outgoing ref, the hop count is the
 *    longest chain of refs ending at b (counted over simple paths, so a mesh
 *    cannot poison the count) + 1 for b's outgoing edge. Chains are counted
 *    with a cycle-safe bounded search: nothing is memoized from a truncated
 *    traversal (the old depthOf cached values computed under its cycle guard,
 *    making symmetric graphs flag asymmetrically depending on iteration
 *    order); only confirmed saturations at maxHops are cached, and those hold
 *    for every caller. Hop count above maxHops flags b.
 *  - The suggested fix never recommends a ref the deepest direct referrer
 *    already holds (issue #22): `from`'s outgoing refs are resolved through
 *    the same resolveKey, and an existing equivalent spelling (see auth vs
 *    see: auth/index.md) flips the advice to "already refs … — remove the
 *    intermediate hop via <b>" — following the "add" advice would have
 *    appended a second see: to one node while leaving the hop in place.
 *    Round 6 (QA-19 F54/F55): the guard is ANCHOR-aware — two refs name the
 *    same target only when they resolve to the same target key AND the same
 *    anchor node (case-insensitive §12 anchorMatches), or when both are
 *    file-level. A same-file/different-node ref (`see auth#Passwords` vs the
 *    suggested `auth/index.md#Sessions`) and a file-level ref beside an
 *    anchored suggestion are NOT duplicates — the old file-key-only guard
 *    emitted false, self-contradictory "already refs" claims.
 *    The plain (no-existing-ref) advice likewise states the intermediate hop
 *    must be removed, not just the direct ref added: from ≠ b holds because
 *    incoming lists exclude self, and from = out would place from, b and out
 *    in one SCC — guarded defensively anyway, so the advice can never convert
 *    a deep-hop error into a checkRefs self-reference error.
 *    Round 6 (QA-19 F26): the removal names the EXACT edge — `from`'s raw
 *    ref to b with its line — so a multi-referrer workspace never leaves the
 *    user guessing which `see:` to delete ("remove the intermediate hop via
 *    X" alone is ambiguous when several files ref X).
 *  - §18 delete-key semantics: maxHops null (key deleted) → the check is OFF —
 *    skipped entirely. */
export function detectDeepHops(graph: RefGraph, maxHops: number | null = 1): Issue[] {
  if (maxHops === null) return [];
  const issues: Issue[] = [];
  const keys = [...graph.forward.keys()];

  // Incoming edges among loaded files: b ← { a : a refs b }.
  const incoming = new Map<string, string[]>();
  for (const a of keys) {
    for (const r of graph.forward.get(a) ?? []) {
      for (const key of keys) {
        if (key === a) continue;
        if (targetMatchesKey(r.file, key)) {
          const list = incoming.get(key) ?? [];
          if (!list.includes(a)) list.push(a);
          incoming.set(key, list);
          break;
        }
      }
    }
  }

  // Tarjan's SCC over exactly the edges `incoming` encodes (adjacency is
  // derived from it, so classification and cycle detection cannot disagree).
  // Recursive is fine: spec workspaces are tiny, and traversal depth is
  // bounded by the file count either way.
  const sccId = new Map<string, number>();
  {
    const adj = new Map<string, string[]>();
    for (const [b, referrers] of incoming) {
      for (const a of referrers) {
        const list = adj.get(a) ?? [];
        if (!list.includes(b)) list.push(b);
        adj.set(a, list);
      }
    }
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    let counter = 0;
    let components = 0;
    const strongconnect = (v: string): void => {
      index.set(v, counter);
      low.set(v, counter);
      counter += 1;
      stack.push(v);
      onStack.add(v);
      for (const w of adj.get(v) ?? []) {
        if (!index.has(w)) {
          strongconnect(w);
          low.set(v, Math.min(low.get(v)!, low.get(w)!));
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v)!, index.get(w)!));
        }
      }
      if (low.get(v) === index.get(v)) {
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          sccId.set(w, components);
        } while (w !== v);
        components += 1;
      }
    };
    for (const v of [...keys].sort()) {
      if (!index.has(v)) strongconnect(v);
    }
  }

  // First loaded key a raw ref target matches — the same first-match loop the
  // incoming map uses, so ref classification and edge building always agree.
  const resolveKey = (name: string): string | null => {
    for (const key of keys) {
      if (targetMatchesKey(name, key)) return key;
    }
    return null;
  };

  // depth(x) = longest chain of refs ending at x, over simple paths (no file
  // repeats), saturated at maxHops — the flag decision only ever needs to know
  // whether the chain reaches maxHops. Values are computed per query with a
  // fresh path-visited set; ONLY confirmed saturations are cached, and a
  // saturation is a graph property that holds for every caller.
  const saturated = new Set<string>();
  const explore = (x: string, visited: Set<string>, len: number): number => {
    let best = len;
    if (best >= maxHops) return best;
    for (const u of incoming.get(x) ?? []) {
      if (visited.has(u)) continue;
      visited.add(u);
      best = Math.max(best, explore(u, visited, len + 1));
      visited.delete(u);
      if (best >= maxHops) return best;
    }
    return best;
  };
  const depthOf = (x: string): number => {
    if (saturated.has(x)) return maxHops;
    const d = explore(x, new Set([x]), 0);
    if (d >= maxHops) {
      saturated.add(x);
      return maxHops;
    }
    return d;
  };

  for (const [b, outTargets] of graph.forward) {
    const bScc = sccId.get(b);
    if (bScc === undefined) continue; // unreachable: every key is a Tarjan node
    const outgoing = outTargets.filter(r => {
      if (r.file === b) return false; // self-reference, as before
      const t = resolveKey(r.file);
      if (t !== null && sccId.get(t) === bScc) return false; // back-ref into b's own mesh
      return true;
    });
    if (outgoing.length === 0) continue;
    if (depthOf(b) + 1 <= maxHops) continue;
    // Deepest direct referrer names the chain; ties break by file key sort so
    // the output never depends on map iteration order.
    const referrers = (incoming.get(b) ?? []).slice().sort();
    let from: string | null = null;
    let best = -1;
    for (const a of referrers) {
      const d = depthOf(a);
      if (d > best) {
        best = d;
        from = a;
      }
    }
    if (from === null) continue;
    const out = outgoing[0];
    // Defensive invariant (issue #5 defect 2): the suggested fix must never be
    // a self-reference — checkRefs rejects those, so the advice would turn one
    // error into another. from ≠ b holds by construction; from = out would
    // put from, b and out in one SCC. Skip rather than emit a broken fix.
    if (from === b || from === out.file) continue;
    const anchor = out.anchor !== null ? `#${out.anchor}` : '';
    // Issue #22 defect 1: the advice must never recommend a ref `from`
    // already holds. resolveKey maps equivalent spellings (auth, auth/,
    // auth/index.md) onto one loaded key, so an existing match means the
    // "add" advice would append a SECOND see: to the same target while the
    // deep hop itself stays in place. Name the existing ref (verbatim raw
    // spelling) and the hop to remove instead.
    // Round 6 (QA-19 F54/F55): the file-key match alone is NOT enough — the
    // two refs must also name the same ANCHOR NODE (case-insensitive §12
    // anchorMatches), or both be file-level. Otherwise the referrer holds a
    // ref to a DIFFERENT node of the same file (or a file-level ref beside an
    // anchored suggestion): claiming "already refs" would be false and
    // following its premise silently drops the linkage.
    const outKey = resolveKey(out.file);
    const sameAnchor = (r: RefTarget): boolean => {
      if (out.anchor === null) return r.anchor === null; // both file-level
      return r.anchor !== null && anchorMatches(r.anchor, out.anchor);
    };
    const existing = outKey !== null
      ? (graph.forward.get(from) ?? []).find(r => resolveKey(r.file) === outKey && sameAnchor(r))
      : undefined;
    // Round 6 (QA-19 F26): name the EXACT edge that feeds the hop — from's
    // ref to b (raw spelling + source line). b is a loaded key and from ∈
    // incoming[b], so the ref exists; first match in document order.
    const hopEdge = (graph.forward.get(from) ?? []).find(r => resolveKey(r.file) === b);
    const edge = hopEdge !== undefined
      ? `: delete ${from}'s "${hopEdge.raw}" (line ${hopEdge.line})`
      : '';
    issues.push({
      file: b, line: out.line, level: 'error', category: 'refs',
      message: `DEEP HOP: ${from} → ${b} → ${out.file}`,
          rule: 'refs.deep_hop', // issue #41: machine-readable rule key
      suggestion: outKey !== null && existing !== undefined
        ? `${from} already refs ${outKey}${anchor} as "${existing.raw}" — remove the intermediate hop via ${b}${edge}`
        : `add "see: ${out.file}${anchor}" directly to ${from} and remove the intermediate hop via ${b}${edge}`,
    });
  }
  return issues;
}

export function detectOrphans(
  files: Map<string, OutlineNode[]>,
  graph: RefGraph,
): Issue[] {
  const issues: Issue[] = [];
  for (const key of files.keys()) {
    const flatKey = key.replace(/\/index\.md$/, '.md');
    if (flatKey === '00-overview.md') continue;
    const outgoing = (graph.forward.get(key) ?? []).some(r => r.file !== key);
    if (outgoing) continue;
    let incoming = false;
    for (const [a, aTargets] of graph.forward) {
      if (a === key) continue;
      if (aTargets.some(r => targetMatchesKey(r.file, key))) {
        incoming = true;
        break;
      }
    }
    if (incoming) continue;
    issues.push({
      file: key, line: 0, level: 'warning', category: 'refs',
      message: `orphan: ${key} has no incoming or outgoing refs`,
          rule: 'refs.orphan', // issue #41: machine-readable rule key
      suggestion: 'link it from a related spec file, or fold it into one',
    });
  }
  return issues;
}

/** Issue #19: one desired ref-by comment — the referrers that point at one
 *  anchor node (node !== null) or at the file itself (node === null) of one
 *  target file. rebuildBackPointers groups incoming refs by (resolved target
 *  file, anchor node): a ref WITH an anchor earns its mark INLINE on the
 *  referenced node's bullet line, a plain file-level ref keeps the
 *  file-level mark (standalone line after the first root bullet). */
export interface RefByGroup {
  /** Resolved target file key (workspace-relative). */
  file: string;
  /** The anchor node the refs point at (§12 anchorMatches resolution, first
   *  match in document order); null for file-level refs. */
  node: OutlineNode | null;
  /** Sorted unique referrer file names — the comment body. */
  fromFiles: string[];
}

export function rebuildBackPointers(
  files: Map<string, OutlineNode[]>,
  graph: RefGraph,
): Map<string, RefByGroup[]> {
  const groups = new Map<string, RefByGroup[]>();
  for (const bp of graph.back) {
    let target: string | null = null;
    for (const key of files.keys()) {
      if (targetMatchesKey(bp.toFile, key)) {
        target = key;
        break;
      }
    }
    const name = target ?? bp.toFile;
    let node: OutlineNode | null = null;
    if (bp.toAnchor !== null) {
      // Issue #19: the anchor is now part of the group key. Resolve it in the
      // target file's outline (the same §12 anchorMatches resolution
      // checkRefs applies). An anchor that resolves to NO node is a broken
      // anchor — already a checkRefs error — and earns no mark: dropped here
      // so --fix never writes it and it can never read as current.
      if (target === null) continue; // target not loaded: anchor unresolvable
      node = flattenNodes(files.get(target)!).find(n => anchorMatches(n.text, bp.toAnchor!)) ?? null;
      if (node === null) continue; // broken anchor — earns nothing
    }
    let list = groups.get(name);
    if (list === undefined) {
      list = [];
      groups.set(name, list);
    }
    let group = list.find(g => g.node === node);
    if (group === undefined) {
      group = { file: name, node, fromFiles: [] };
      list.push(group);
    }
    if (!group.fromFiles.includes(bp.fromFile)) group.fromFiles.push(bp.fromFile);
  }
  const out = new Map<string, RefByGroup[]>();
  for (const key of [...groups.keys()].sort()) {
    const list = groups.get(key)!;
    // Deterministic order: the file-level group first, then anchored groups by
    // the anchor node's source line (document order).
    list.sort((a, b) => {
      if (a.node === null && b.node === null) return 0;
      if (a.node === null) return -1;
      if (b.node === null) return 1;
      return a.node.line - b.node.line;
    });
    for (const g of list) g.fromFiles.sort();
    out.set(key, list);
  }
  return out;
}
