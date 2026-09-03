import type { OutlineNode, BackPointer } from '../types';

export function parseOutline(source: string, file: string): OutlineNode[] {
  throw new Error('not implemented');
}

export function flattenNodes(nodes: OutlineNode[]): OutlineNode[] {
  throw new Error('not implemented');
}

export function extractBackPointers(source: string, file: string): BackPointer[] {
  throw new Error('not implemented');
}

export function countNodes(nodes: OutlineNode[]): number {
  throw new Error('not implemented');
}

export function maxDepth(nodes: OutlineNode[], current?: number): number {
  throw new Error('not implemented');
}
