/** Runtime-neutral test facade (issue #12).
 *
 *  Re-exports the bun:test API under Bun and the node:test-based compat shim
 *  (./node-compat.ts) under Node, so the SAME suite runs green on both
 *  runtimes: `bun test` (primary) and `npm run test:node` (fallback).
 *
 *  Test files import from this module instead of 'bun:test' directly; the
 *  exported types are still bun:test's, so tsc checks tests exactly as before.
 */
const IS_BUN = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';

// Non-literal specifier: under Bun this resolves 'bun:test'; under Node it
// resolves the local shim. Keeping it a variable also keeps tsc (running with
// bun types) from trying to resolve 'node:test' statically.
const spec = IS_BUN ? 'bun:test' : new URL('./node-compat.ts', import.meta.url).href;
const api: Record<string, unknown> = await import(spec);

import type {
  describe as BunDescribe,
  test as BunTest,
  expect as BunExpect,
  beforeEach as BunBeforeEach,
  afterEach as BunAfterEach,
  afterAll as BunAfterAll,
} from 'bun:test';

function pick(name: string): unknown {
  const v = api[name];
  if (v === undefined) throw new Error(`testing facade: missing export "${name}"`);
  return v;
}

export const describe = pick('describe') as typeof BunDescribe;
export const test = pick('test') as typeof BunTest;
export const expect = pick('expect') as typeof BunExpect;
export const beforeEach = pick('beforeEach') as typeof BunBeforeEach;
export const afterEach = pick('afterEach') as typeof BunAfterEach;
export const afterAll = pick('afterAll') as typeof BunAfterAll;
