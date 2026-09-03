import type {
  OutlineNode, BackPointer, TokenBudgetRules,
  BudgetReadResult, BudgetWriteResult,
} from '../types';

export function estimateTokens(text: string, charsPerToken: number): number {
  throw new Error('not implemented');
}

export function findCanonicalHome(
  concept: string,
  allFiles: Map<string, OutlineNode[]>,
): { file: string; anchor: string | null } | null {
  throw new Error('not implemented');
}

export function buildReadPlan(
  concept: string,
  allFiles: Map<string, OutlineNode[]>,
  backPointers: BackPointer[],
  rules: TokenBudgetRules,
  limit?: number,
  taskFile?: string,
): BudgetReadResult {
  throw new Error('not implemented');
}

export function buildWritePlan(
  concept: string,
  allFiles: Map<string, OutlineNode[]>,
  backPointers: BackPointer[],
  activeTasks: string[],
): BudgetWriteResult {
  throw new Error('not implemented');
}
