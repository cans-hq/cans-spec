import { describe, test, expect } from 'bun:test';
import { parseOutline } from '../src/core/outline';
import { checkOverflow } from '../src/core/overflow';
import { defaultRules } from '../src/core/rules';
import { readFixture } from './helpers';

const rules = defaultRules().overflow;

describe('overflow detection', () => {
  test('flags code fence in bullet', () => {
    const src = readFixture('overflow-project', '04-api', 'request-schema.md');
    const nodes = parseOutline(src, 'request-schema.md');
    const issues = checkOverflow(nodes, 'request-schema.md', rules);
    expect(issues.some(i => i.message.includes('code') || i.message.includes('fence'))).toBe(true);
  });

  test('flags table in bullet', () => {
    const src = readFixture('overflow-project', '04-api', 'error-handling.md');
    const nodes = parseOutline(src, 'error-handling.md');
    const issues = checkOverflow(nodes, 'error-handling.md', rules);
    expect(issues.some(i => i.message.includes('table'))).toBe(true);
  });

  test('allows inline code spans', () => {
    const src = '- Use `POST /users` for creation\n';
    const nodes = parseOutline(src, 'test.md');
    const issues = checkOverflow(nodes, 'test.md', rules);
    expect(issues.length).toBe(0);
  });

  test('flags node exceeding max chars', () => {
    const long = '- ' + 'x'.repeat(250);
    const nodes = parseOutline(long, 'test.md');
    const issues = checkOverflow(nodes, 'test.md', rules);
    expect(issues.some(i => i.message.includes('200') || i.message.includes('max'))).toBe(true);
  });
});
