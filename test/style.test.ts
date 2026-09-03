import { describe, test, expect } from 'bun:test';
import { parseOutline } from '../src/core/outline';
import { checkStyle } from '../src/core/style';
import { defaultRules } from '../src/core/rules';
import { readFixture } from './helpers';

const rules = defaultRules().style;

describe('style enforcement', () => {
  test('flags siblings needing nested grouping', () => {
    const src = readFixture('style-project', '04-api-nested.md');
    const nodes = parseOutline(src, '04-api-nested.md');
    const issues = checkStyle(nodes, '04-api-nested.md', rules);
    const nested = issues.find(i => i.message.includes('nested'));
    expect(nested).toBeDefined();
  });

  test('flags nested needing sibling collapse', () => {
    const src = readFixture('style-project', '04-api-sibling.md');
    const nodes = parseOutline(src, '04-api-sibling.md');
    const issues = checkStyle(nodes, '04-api-sibling.md', rules);
    const sibling = issues.find(i => i.message.includes('sibling') || i.message.includes('Collapse'));
    expect(sibling).toBeDefined();
  });

  test('detects shared prefix', () => {
    const src = readFixture('style-project', '04-api-nested.md');
    const nodes = parseOutline(src, '04-api-nested.md');
    const issues = checkStyle(nodes, '04-api-nested.md', rules);
    expect(issues.some(i => i.message.includes('Returns'))).toBe(true);
  });

  test('no style issues for clean file', () => {
    const src = '- API\n  - Auth\n  - Users\n  - Billing\n';
    const nodes = parseOutline(src, 'test.md');
    const issues = checkStyle(nodes, 'test.md', rules);
    expect(issues.length).toBe(0);
  });
});
