import type { ExternalNode } from '../types';

export function parseOpml(source: string): ExternalNode[] {
  throw new Error('not implemented');
}

export function serializeOpml(nodes: ExternalNode[], title: string): string {
  throw new Error('not implemented');
}

export function encodeXmlEntity(s: string): string {
  throw new Error('not implemented');
}

export function decodeXmlEntity(s: string): string {
  throw new Error('not implemented');
}
