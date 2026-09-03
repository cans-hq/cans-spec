import type { DoneResult } from '../types';

export interface DoneArgs {
  name: string;
  allowIncomplete: boolean;
  skipCheck: boolean;
}

export function parseDoneArgs(args: string[]): DoneArgs {
  throw new Error('not implemented');
}

export function run(args: string[]): Promise<DoneResult> {
  throw new Error('not implemented');
}
