/** bun:test → node:test compat shim (issue #12).
 *
 *  Tiny, deliberate surface: ONLY what this suite actually uses. Under Bun the
 *  suite runs on real bun:test via test/testing.ts — this shim exists so the
 *  same suite runs green under `node --test` and exercises the Node fallback.
 *
 *  Covered: describe/test nesting, beforeEach/afterEach/afterAll (file- and
 *  suite-scoped), and expect() with the repo's matchers including `.not` and
 *  the optional message second argument (`expect(x, 'why')`).
 *  Not covered (unused here): mocking, timers, snapshots, expect.extend.
 */
const RUNNER = 'node:test';
const ASSERT = 'node:assert/strict';
const UTIL = 'node:util';
const nt: Record<string, any> = await import(RUNNER);
const assert: Record<string, any> = await import(ASSERT);
const util: Record<string, any> = await import(UTIL);

function deepEqual(a: unknown, b: unknown): boolean {
  try {
    assert.deepStrictEqual(a, b);
    return true;
  } catch {
    return false;
  }
}

function fmt(v: unknown): string {
  try {
    return util.inspect(v, { depth: 4, breakLength: 120 });
  } catch {
    return String(v);
  }
}

function sizeOf(v: unknown): number | undefined {
  if (v === null || v === undefined || typeof v === 'boolean') return undefined;
  if (typeof v === 'string' || Array.isArray(v)) return v.length;
  const len = (v as { length?: unknown }).length;
  if (typeof len === 'number') return len;
  const size = (v as { size?: unknown }).size;
  if (typeof size === 'number') return size;
  return undefined;
}

interface ExpectApi {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toContain(expected: unknown): void;
  toMatch(expected: RegExp | string): void;
  toBeNull(): void;
  toBeDefined(): void;
  toBeUndefined(): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toBeGreaterThan(n: number): void;
  toBeGreaterThanOrEqual(n: number): void;
  toBeLessThan(n: number): void;
  toBeLessThanOrEqual(n: number): void;
  toHaveLength(n: number): void;
  toThrow(expected?: string | RegExp): void;
  readonly not: ExpectApi;
}

function makeExpect(actual: unknown, message?: string): ExpectApi {
  const prefix = message ? `${message}: ` : '';
  const check = (pass: boolean, failMsg: string): void => {
    if (!pass) throw new assert.AssertionError({ message: prefix + failMsg });
  };
  const build = (negated: boolean): ExpectApi => {
    const that = (what: string): string =>
      `expected ${fmt(actual)} ${negated ? 'NOT ' : ''}${what}`;
    return {
      toBe(expected) {
        const pass = Object.is(actual, expected);
        check(negated ? !pass : pass, that(`to be ${fmt(expected)}`));
      },
      toEqual(expected) {
        const pass = deepEqual(actual, expected);
        check(negated ? !pass : pass, that(`to equal ${fmt(expected)}`));
      },
      toContain(expected) {
        let pass: boolean;
        if (typeof actual === 'string') pass = actual.includes(String(expected));
        else if (actual instanceof Set) {
          pass =
            expected !== null && typeof expected === 'object'
              ? [...actual].some(x => deepEqual(x, expected))
              : actual.has(expected);
        } else if (Array.isArray(actual)) pass = actual.some(x => deepEqual(x, expected));
        else pass = false;
        check(negated ? !pass : pass, that(`to contain ${fmt(expected)}`));
      },
      toMatch(expected) {
        const re = expected instanceof RegExp ? expected : new RegExp(expected);
        const pass = re.test(typeof actual === 'string' ? actual : String(actual));
        check(negated ? !pass : pass, that(`to match ${String(expected)}`));
      },
      toBeNull() {
        const pass = actual === null;
        check(negated ? !pass : pass, that('to be null'));
      },
      toBeDefined() {
        const pass = actual !== undefined;
        check(negated ? !pass : pass, that('to be defined'));
      },
      toBeUndefined() {
        const pass = actual === undefined;
        check(negated ? !pass : pass, that('to be undefined'));
      },
      toBeTruthy() {
        const pass = Boolean(actual);
        check(negated ? !pass : pass, that('to be truthy'));
      },
      toBeFalsy() {
        const pass = !actual;
        check(negated ? !pass : pass, that('to be falsy'));
      },
      toBeGreaterThan(n) {
        const pass = typeof actual === 'number' && actual > n;
        check(negated ? !pass : pass, that(`to be greater than ${n}`));
      },
      toBeGreaterThanOrEqual(n) {
        const pass = typeof actual === 'number' && actual >= n;
        check(negated ? !pass : pass, that(`to be greater than or equal to ${n}`));
      },
      toBeLessThan(n) {
        const pass = typeof actual === 'number' && actual < n;
        check(negated ? !pass : pass, that(`to be less than ${n}`));
      },
      toBeLessThanOrEqual(n) {
        const pass = typeof actual === 'number' && actual <= n;
        check(negated ? !pass : pass, that(`to be less than or equal to ${n}`));
      },
      toHaveLength(n) {
        const size = sizeOf(actual);
        const pass = size === n;
        check(
          negated ? !pass : pass,
          `expected length ${n}${negated ? ' NOT' : ''}, got ${fmt(size)}`,
        );
      },
      get not() { return build(!negated); },
      toThrow(expected?: string | RegExp) {
        if (typeof actual !== 'function') {
          throw new assert.AssertionError({ message: `${prefix}toThrow() requires a function actual, got ${typeof actual}` });
        }
        let threw: unknown;
        let didThrow = false;
        try {
          (actual as () => unknown)();
        } catch (e) {
          didThrow = true;
          threw = e;
        }
        let pass = didThrow;
        if (didThrow && expected !== undefined) {
          const msg = threw instanceof Error ? threw.message : String(threw);
          pass = expected instanceof RegExp ? expected.test(msg) : msg.includes(expected);
        }
        check(negated ? !pass : pass, that(didThrow ? `to throw ${expected ?? ''}`.trim() : 'to throw'));
      },
    };
  };
  return build(false);
}

export function expect(actual: unknown, message?: string): ExpectApi {
  return makeExpect(actual, message);
}

export const describe: typeof import('bun:test')['describe'] = nt.describe;
export const test: typeof import('bun:test')['test'] = nt.test;
export const beforeEach: typeof import('bun:test')['beforeEach'] = nt.beforeEach;
export const afterEach: typeof import('bun:test')['afterEach'] = nt.afterEach;
/** bun:test's afterAll is node:test's `after`. */
export const afterAll: typeof import('bun:test')['afterAll'] = nt.after;
