import type { StatusResult } from '../types';

export interface StatusArgs {
  unclaimed: boolean;
  blocked: boolean;
  owners: boolean;
  json: boolean;
}

export function parseStatusArgs(args: string[]): StatusArgs {
  throw new Error('not implemented');
}

export function run(args: string[]): Promise<StatusResult> {
  throw new Error('not implemented');
}
