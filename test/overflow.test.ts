import { describe, test, expect } from './testing.ts';
import { parseOutline } from '../src/core/outline.ts';
import { checkOverflow } from '../src/core/overflow.ts';
import { defaultRules } from '../src/core/rules.ts';
import { readFixture } from './helpers.ts';

const rules = defaultRules().overflow;

describe('overflow detection', () => {
  test('flags code fence before the first bullet (flag moves to the first real node)', () => {
    // Issue #8: a leading fence must no longer synthesize a phantom "(code
    // fence)" node — the flag lands on the first real node that follows, so the
    // error's line is the first bullet's line, not the fence's.
    const src = [
      '```json',
      '{ "alpha": 1 }',
      '```',
      '',
      '- First real bullet',
      '- Second real bullet',
    ].join('\n');
    const nodes = parseOutline(src, 'request-schema.md');
    const issues = checkOverflow(nodes, 'request-schema.md', rules);
    const fenceIssues = issues.filter(i => i.message.includes('code fence detected'));
    expect(fenceIssues.length).toBe(1);
    expect(fenceIssues[0].line).toBe(5);
  });

  test('flags table before the first bullet (flag moves to the first real node)', () => {
    // Issue #8: same as above for leading tables — exactly one "table detected"
    // error, on the first bullet's line.
    const src = [
      '| Name | Value |',
      '|---|---|',
      '| alpha | 1 |',
      '',
      '- First real bullet',
      '- Second real bullet',
    ].join('\n');
    const nodes = parseOutline(src, 'error-handling.md');
    const issues = checkOverflow(nodes, 'error-handling.md', rules);
    const tableIssues = issues.filter(i => i.message.includes('table detected'));
    expect(tableIssues.length).toBe(1);
    expect(tableIssues[0].line).toBe(5);
  });

  test('table-only / fence-only files yield no nodes and no overflow issues (issue #8)', () => {
    // The overflow-project fixture targets are content-only (no bullets); with
    // phantom synthesis gone they parse to zero nodes, so there is nothing for
    // checkOverflow to flag. Provenance flags only exist on real nodes.
    for (const name of ['request-schema.md', 'error-handling.md']) {
      const src = readFixture('overflow-project', '04-api', name);
      const nodes = parseOutline(src, name);
      expect(nodes).toEqual([]);
      expect(checkOverflow(nodes, name, rules)).toEqual([]);
    }
  });

  test('mid-file table after a bullet still flags the preceding node (pin)', () => {
    const src = [
      '- Error handling',
      '  - Status codes follow',
      '',
      '| Code | Meaning |',
      '|---|---|',
      '| 400 | Malformed request |',
    ].join('\n');
    const nodes = parseOutline(src, 'error-handling.md');
    const issues = checkOverflow(nodes, 'error-handling.md', rules);
    const tableIssues = issues.filter(i => i.message.includes('table detected'));
    expect(tableIssues.length).toBe(1);
    expect(tableIssues[0].line).toBe(2);
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
