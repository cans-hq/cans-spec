import type { BudgetReadResult, BudgetWriteResult } from '../types';

export interface BudgetArgs {
  mode: 'read' | 'write';
  concept: string;
  limit: number | null;
  change: string | null;
  json: boolean;
}

export function parseBudgetArgs(args: string[]): BudgetArgs {
  throw new Error('not implemented');
}

export function run(args: string[]): Promise<BudgetReadResult | BudgetWriteResult> {
  throw new Error('not implemented');
}
