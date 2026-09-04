import type { OutlineNode, Issue, RedundancyRules } from '../types';

export function checkRedundancy(
  allFiles: Map<string, OutlineNode[]>,
  rules: RedundancyRules,
): Issue[] {
  throw new Error('not implemented');
}

export function normalizeWord(word: string, synonyms: string[][]): string {
  throw new Error('not implemented');
}

export function wordFrequency(
  nodes: Array<{ text: string; file: string; line: number }>,
  rules: RedundancyRules,
): Issue[] {
  throw new Error('not implemented');
}

export function phraseOverlap(
  nodes: Array<{ text: string; file: string; line: number }>,
  threshold: number,
): Issue[] {
  throw new Error('not implemented');
}

export function fuzzyDistance(
  nodes: Array<{ text: string; file: string; line: number }>,
): Issue[] {
  throw new Error('not implemented');
}

export function crossFileCanonicality(
  allFiles: Map<string, OutlineNode[]>,
  threshold: number,
): Issue[] {
  throw new Error('not implemented');
}
