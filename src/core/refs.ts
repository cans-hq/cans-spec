import { readFileSync } from 'fs';
import { join } from 'path';
import type { OutlineNode, RefTarget, BackPointer, Issue } from '../types.ts';
import { flattenNodes, parseOutline } from './outline.ts';
import { resolveSpecFile, toRelative, isFile } from './fs.ts';

export interface RefGraph {
  forward: Map<string, RefTarget[]>;
  back: BackPointer[];
}

/** Does a raw ref target `name` point at workspace file `key`?
 *  Handles flat (`02-auth.md`) and folder (`02-auth/index.md`) layouts. */
export function targetMatchesKey(name: string, key: string): boolean {
  const n = name.toLowerCase();
  const k = key.toLowerCase();
  if (n === k) return true;
  const nBase = n.endsWith('.md') ? n.slice(0, -3) : n;
  const kBase = k.endsWith('/index.md') ? k.slice(0, -9) : k.endsWith('.md') ? k.slice(0, -3) : k;
  if (nBase === kBase) return true;
  if (n.endsWith('.md') && k === `${nBase}/index.md`) return true;
  if (k.endsWith('.md') && n === `${kBase}/index.md`) return true;
  return false;
}

/** Map a raw ref target to the loaded files-map key, if the target is loaded or resolvable on disk. */
function loadedKeyFor(files: Map<string, OutlineNode[]>, root: string, name: string): string | null {
  if (files.has(name)) return name;
  if (name.endsWith('.md') && files.has(`${name.slice(0, -3)}/index.md`)) return `${name.slice(0, -3)}/index.md`;
  if (!name.endsWith('.md') && files.has(`${name}/index.md`)) return `${name}/index.md`;
  const p = resolveSpecFile(root, name);
  if (p === null) return null;
  const rel = toRelative(root, p);
  if (files.has(rel)) return rel;
  for (const key of files.keys()) if (targetMatchesKey(name, key)) return key;
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
          suggestion: 'remove the self-reference; point at the canonical file instead',
        });
        continue;
      }
      if (ref.file.startsWith('_tasks/')) {
        issues.push({
          file, line: ref.line, level: 'warning', category: 'refs',
          message: `transient ref: see ${ref.file} — _tasks/ files are transient, not spec`,
          suggestion: 're-point at a spec file when the task lands',
        });
        continue;
      }
      if (ref.file.startsWith('_collab/')) {
        issues.push({
          file, line: ref.line, level: 'error', category: 'refs',
          message: `ref to _collab/: see ${ref.file} — collab notes are not spec`,
          suggestion: 'move the content into a spec file and ref that',
        });
        continue;
      }

      const key = loadedKeyFor(files, root, ref.file);
      if (key === null && resolveSpecFile(root, ref.file) === null) {
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
            suggestion: `create ${ref.file} or fix the ref target`,
          });
        } else {
          issues.push({
            file, line: ref.line, level: 'warning', category: 'refs',
            message: `see-like prose: "see ${ref.file}" did not resolve to a spec file — rephrase or link explicitly`,
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
 *  of allowed hops: a chain whose hop count through `b` exceeds it is flagged.
 *  Hop count for file `b` with outgoing refs = (longest incoming chain into b) + 1.
 *  §18 delete-key semantics: maxHops null (key deleted) → the check is OFF —
 *  skipped entirely. */
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

  // depth(x) = length of the longest incoming chain ending at x (0 = no incoming).
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (x: string): number => {
    const memo = depth.get(x);
    if (memo !== undefined) return memo;
    if (visiting.has(x)) return 0; // cycle guard
    visiting.add(x);
    let d = 0;
    for (const a of incoming.get(x) ?? []) {
      if (a === x) continue;
      d = Math.max(d, depthOf(a) + 1);
    }
    visiting.delete(x);
    depth.set(x, d);
    return d;
  };

  for (const [b, outTargets] of graph.forward) {
    const outgoing = outTargets.filter(r => r.file !== b);
    if (outgoing.length === 0) continue;
    if (depthOf(b) + 1 <= maxHops) continue;
    let from: string | null = null;
    let best = -1;
    for (const a of incoming.get(b) ?? []) {
      const d = depthOf(a);
      if (d > best) {
        best = d;
        from = a;
      }
    }
    if (from === null) continue;
    const out = outgoing[0];
    const anchor = out.anchor !== null ? `#${out.anchor}` : '';
    issues.push({
      file: b, line: out.line, level: 'error', category: 'refs',
      message: `DEEP HOP: ${from} → ${b} → ${out.file}`,
      suggestion: `add "see: ${out.file}${anchor}" directly to ${from}`,
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
      suggestion: 'link it from a related spec file, or fold it into one',
    });
  }
  return issues;
}

export function rebuildBackPointers(
  files: Map<string, OutlineNode[]>,
  graph: RefGraph,
): Map<string, string> {
  const groups = new Map<string, Set<string>>();
  for (const bp of graph.back) {
    let target: string | null = null;
    for (const key of files.keys()) {
      if (targetMatchesKey(bp.toFile, key)) {
        target = key;
        break;
      }
    }
    const name = target ?? bp.toFile;
    let set = groups.get(name);
    if (set === undefined) {
      set = new Set<string>();
      groups.set(name, set);
    }
    set.add(bp.fromFile);
  }
  const out = new Map<string, string>();
  for (const key of [...groups.keys()].sort()) {
    out.set(key, [...groups.get(key)!].sort().join(', '));
  }
  return out;
}
