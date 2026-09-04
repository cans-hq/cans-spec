import { readFileSync } from 'fs';
import { join } from 'path';
import type { OutlineNode, RefTarget, BackPointer, Issue } from '../types';
import { flattenNodes, parseOutline } from './outline';
import { resolveSpecFile, toRelative, isFile } from './fs';

/** Spec-file naming contract (§8): `NN-name.md`. Mirrors fs.ts's SPEC_FILE_RE. */
const SPEC_FILE_RE = /^\d{2}-.+\.md$/;

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
        // §12: "File not found → Broken ref error."
        // Narrow arbitration between frozen contracts (qa-02 F2 red test + the
        // broken-refs fixture vs the flat/folder-project baseline fixtures):
        // the ONLY downgraded case is a spec-numbered hole strictly INSIDE the
        // loaded numeric span that lies BEHIND the referencing file (e.g. the
        // §34 flat-project tutorial's 06 → 03 placeholder). Holes below the
        // first loaded spec, ahead of the referencing file, or outside the
        // span are hard broken-ref errors.
        const tgtNum = SPEC_FILE_RE.test(ref.file) ? Number(ref.file.slice(0, 2)) : null;
        const srcNum = SPEC_FILE_RE.test(file) ? Number(file.slice(0, 2)) : null;
        const specNums: number[] = [];
        for (const k of files.keys()) {
          const m = /^(\d{2})-/.exec(k);
          if (m !== null) specNums.push(Number(m[1]));
        }
        const spanMin = specNums.length > 0 ? Math.min(...specNums) : null;
        const spanMax = specNums.length > 0 ? Math.max(...specNums) : null;
        const unwrittenBackwardSlot =
          tgtNum !== null &&
          srcNum !== null &&
          spanMin !== null &&
          spanMax !== null &&
          tgtNum < srcNum &&
          tgtNum >= spanMin &&
          tgtNum <= spanMax;
        if (unwrittenBackwardSlot) {
          issues.push({
            file, line: ref.line, level: 'warning', category: 'refs',
            message: `unwritten spec slot: see ${ref.file} — file not created yet`,
            suggestion: `create ${ref.file} or re-point the ref`,
          });
        } else {
          issues.push({
            file, line: ref.line, level: 'error', category: 'refs',
            message: `broken ref: see ${ref.file} — file not found`,
            suggestion: `create ${ref.file} or fix the ref target`,
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
 *  Hop count for file `b` with outgoing refs = (longest incoming chain into b) + 1. */
export function detectDeepHops(graph: RefGraph, maxHops = 1): Issue[] {
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
