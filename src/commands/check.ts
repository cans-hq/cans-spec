import type { CheckResult } from '../types';

export interface CheckArgs {
  fix: boolean;
  strict: boolean;
  refsOnly: boolean;
  noRedundancy: boolean;
  file: string | null;
  json: boolean;
}

export function parseCheckArgs(args: string[]): CheckArgs {
  throw new Error('not implemented');
}

export function checkWorkspace(root: string, opts: CheckArgs): Promise<CheckResult> {
  throw new Error('not implemented');
}

export function run(args: string[]): Promise<CheckResult> {
  throw new Error('not implemented');
}
