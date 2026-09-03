import { readFileSync } from 'fs';
import { join } from 'path';
import type { OutlineNode, RefTarget, BackPointer, Issue } from '../types';
import { flattenNodes, parseOutline } from './outline';
import { resolveSpecFile, toRelative, isFile } from './fs';

export interface RefGraph {
  forward: Map<string, RefTarget[]>;
  back: BackPointer[];
}

const SPEC_FILE_RE = /^\d{2}-.+\.md$/;

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

/** [min, max] of the numeric prefixes of loaded spec files (workspace spec numbers). */
function specNumberRange(files: Map<string, OutlineNode[]>): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  let seen = false;
  for (const key of files.keys()) {
    const m = key.match(/^(\d{2})-/);
    if (m === null) continue;
    const n = Number(m[1]);
    if (n < min) min = n;
    if (n > max) max = n;
    seen = true;
  }
  return seen ? [min, max] : null;
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
  const range = specNumberRange(files);
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
        const num = SPEC_FILE_RE.test(ref.file) ? Number(ref.file.slice(0, 2)) : null;
        const unwritten = num !== null && range !== null && num >= range[0] && num <= range[1];
        if (unwritten) {
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
          const anchorLower = anchor.toLowerCase();
          const hit =
            nodes.some(n => n.text === anchor) ||
            nodes.some(n => n.text.toLowerCase() === anchorLower);
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

export function detectDeepHops(graph: RefGraph): Issue[] {
  const issues: Issue[] = [];
  for (const [b, outTargets] of graph.forward) {
    const outgoing = outTargets.filter(r => r.file !== b);
    if (outgoing.length === 0) continue;
    let from: string | null = null;
    for (const [a, aTargets] of graph.forward) {
      if (a === b) continue;
      if (aTargets.some(r => targetMatchesKey(r.file, b))) {
        from = a;
        break;
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
