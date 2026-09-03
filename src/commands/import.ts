import type { ImportResult, ImportFormat, MergeStrategy } from '../types';

export interface ImportArgs {
  format: ImportFormat;
  path: string;
  out: string | null;
  dryRun: boolean;
  mergeStrategy: MergeStrategy;
}

export function parseImportArgs(args: string[]): ImportArgs {
  throw new Error('not implemented');
}

export function run(args: string[]): Promise<ImportResult> {
  throw new Error('not implemented');
}
