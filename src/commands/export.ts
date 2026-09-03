import type { ExportResult, ExportFormat } from '../types';

export interface ExportArgs {
  format: ExportFormat;
  from: string | null;
  vault: string | null;
  includeTasks: boolean;
  dryRun: boolean;
}

export function parseExportArgs(args: string[]): ExportArgs {
  throw new Error('not implemented');
}

export function run(args: string[]): Promise<ExportResult> {
  throw new Error('not implemented');
}
