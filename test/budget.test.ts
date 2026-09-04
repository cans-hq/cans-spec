import { describe, test, expect } from 'bun:test';
import { parseOutline } from '../src/core/outline';
import { buildRefGraph } from '../src/core/refs';
import { buildReadPlan, buildWritePlan, estimateTokens, findCanonicalHome } from '../src/core/token-budget';
import { defaultRules } from '../src/core/rules';
import { outputFixture } from './helpers';
import { readFixture } from './helpers';

const rules = defaultRules().token_budget;

function loadBudgetProject(): Map<string, any[]> {
  const files = new Map();
  for (const f of ['02-authentication.md', '04-api.md', '06-operations.md']) {
    files.set(f, parseOutline(readFixture('budget-project', f), f));
  }
  return files;
}

describe('estimateTokens', () => {
  test('uses chars-per-token ratio', () => {
    expect(estimateTokens('hello world!', 3.5)).toBe(Math.ceil(12 / 3.5));
  });
});

describe('findCanonicalHome', () => {
  test('finds highest child count at lowest depth', () => {
    const files = loadBudgetProject();
    const home = findCanonicalHome('sessions', files);
    expect(home).not.toBeNull();
    expect(home!.file).toBe('02-authentication.md');
    expect(home!.anchor).toBe('Sessions');
  });
});

describe('budget read', () => {
  test('produces scored plan', () => {
    const files = loadBudgetProject();
    const graph = buildRefGraph(files, '.');
    const result = buildReadPlan('sessions', files, graph.back, rules);
    expect(result.plan.length).toBeGreaterThan(0);
    expect(result.plan[0].file).toBe('02-authentication.md');
    expect(result.plan[0].score).toBe(100);
    expect(result.plan[0].reason).toBe('canonical home');
  });

  test('respects token limit', () => {
    const files = loadBudgetProject();
    const graph = buildRefGraph(files, '.');
    const result = buildReadPlan('sessions', files, graph.back, rules, 200);
    expect(result.totalTokens).toBeLessThanOrEqual(200);
    expect(result.budgetLimit).toBe(200);
  });

  test('matches output fixture', () => {
    const expected = outputFixture('budget-read.json');
    const files = loadBudgetProject();
    const graph = buildRefGraph(files, '.');
    const result = buildReadPlan('sessions', files, graph.back, rules);
    expect(result.plan[0].file).toBe((expected as any).plan[0].file);
    expect(result.plan[0].score).toBe((expected as any).plan[0].score);
  });
});

describe('budget write', () => {
  test('allows canonical home + active tasks', () => {
    const files = loadBudgetProject();
    const graph = buildRefGraph(files, '.');
    const result = buildWritePlan('sessions', files, graph.back, []);
    expect(result.canEdit.some(e => e.file === '02-authentication.md')).toBe(true);
    expect(result.mustNotEdit.some(e => e.file === '04-api.md')).toBe(true);
  });
});
