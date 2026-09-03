import type { OutlineNode, Issue, StructureRules } from '../types';

export function checkStructure(
  nodes: OutlineNode[],
  file: string,
  rules: StructureRules,
): Issue[] {
  throw new Error('not implemented');
}
