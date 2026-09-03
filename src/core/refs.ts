import type { OutlineNode, RefTarget, BackPointer, Issue } from '../types';

export interface RefGraph {
  forward: Map<string, RefTarget[]>;
  back: BackPointer[];
}

export function buildRefGraph(
  files: Map<string, OutlineNode[]>,
  root: string,
): RefGraph {
  throw new Error('not implemented');
}

export function checkRefs(
  files: Map<string, OutlineNode[]>,
  graph: RefGraph,
  root: string,
): Issue[] {
  throw new Error('not implemented');
}

export function detectDeepHops(graph: RefGraph): Issue[] {
  throw new Error('not implemented');
}

export function detectOrphans(
  files: Map<string, OutlineNode[]>,
  graph: RefGraph,
): Issue[] {
  throw new Error('not implemented');
}

export function rebuildBackPointers(
  files: Map<string, OutlineNode[]>,
  graph: RefGraph,
): Map<string, string> {
  throw new Error('not implemented');
}
