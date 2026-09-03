import type { Rules } from '../types';

export function loadRules(root: string): Rules {
  throw new Error('not implemented');
}

export function defaultRules(): Rules {
  throw new Error('not implemented');
}

export function parseMinimalYaml(source: string): Record<string, unknown> {
  throw new Error('not implemented');
}
