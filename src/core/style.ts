import type { OutlineNode, Issue, StyleRules } from '../types';

export function checkStyle(
  nodes: OutlineNode[],
  file: string,
  rules: StyleRules,
): Issue[] {
  throw new Error('not implemented');
}
