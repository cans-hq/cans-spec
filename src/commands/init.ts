import type { InitResult } from '../types';

export interface InitArgs {
  flat: boolean;
  folders: boolean;
  bare: boolean;
  force: boolean;
  tool: string | null;
}

export function parseInitArgs(args: string[]): InitArgs {
  throw new Error('not implemented');
}

export function run(args: string[]): Promise<InitResult> {
  throw new Error('not implemented');
}
