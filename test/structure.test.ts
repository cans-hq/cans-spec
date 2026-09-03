import { describe, test, expect } from 'bun:test';
import { parseOutline } from '../src/core/outline';
import { checkStructure } from '../src/core/structure';
import { defaultRules } from '../src/core/rules';

const rules = defaultRules().structure;

describe('structure checks', () => {
  test('flags node too long', () => {
    const long = 'x'.repeat(130);
    const nodes = parseOutline(`- ${long}\n`, 'test.md');
    const issues = checkStructure(nodes, 'test.md', rules);
    const lenIssue = issues.find(i => i.message.includes('too long'));
    expect(lenIssue).toBeDefined();
    expect(lenIssue!.level).toBe('error');
  });

  test('flags single child', () => {
    const nodes = parseOutline('- Parent\n  - Only child\n', 'test.md');
    const issues = checkStructure(nodes, 'test.md', { ...rules, single_child_collapse: true });
    const collapse = issues.find(i => i.message.includes('1 child'));
    expect(collapse).toBeDefined();
  });

  test('flags excessive depth', () => {
    const src = '- a\n  - b\n    - c\n      - d\n        - e\n          - f\n';
    const nodes = parseOutline(src, 'test.md');
    const issues = checkStructure(nodes, 'test.md', { ...rules, depth: { min: 1, max: 5 } });
    const depthIssue = issues.find(i => i.message.includes('Depth') || i.message.includes('depth'));
    expect(depthIssue).toBeDefined();
  });

  test('flags too many siblings', () => {
    const bullets = Array.from({ length: 14 }, (_, i) => `- Parent\n  - child ${i}`).join('\n');
    const src = `- Parent\n${Array.from({ length: 14 }, (_, i) => `  - child ${i}`).join('\n')}\n`;
    const nodes = parseOutline(src, 'test.md');
    const issues = checkStructure(nodes, 'test.md', rules);
    const sibIssue = issues.find(i => i.message.includes('children') || i.message.includes('siblings'));
    expect(sibIssue).toBeDefined();
  });

  test('clean structure produces no issues', () => {
    const src = '- Auth\n  - Sign up\n  - Sessions\n  - Passwords\n';
    const nodes = parseOutline(src, 'test.md');
    const issues = checkStructure(nodes, 'test.md', rules);
    expect(issues.length).toBe(0);
  });
});
