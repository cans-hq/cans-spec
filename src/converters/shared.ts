import type { ExternalNode } from '../types';

export function parseIndent(raw: string): number {
  throw new Error('not implemented');
}

export function parseCheckbox(text: string): { isTask: boolean; isDone: boolean; clean: string } {
  throw new Error('not implemented');
}

export function stripMetadata(text: string, format: string): string {
  throw new Error('not implemented');
}

export function serializeToCans(nodes: ExternalNode[]): string {
  throw new Error('not implemented');
}

export function parseFromCans(source: string): ExternalNode[] {
  throw new Error('not implemented');
}

export function convertWikiLinks(text: string): string {
  throw new Error('not implemented');
}
