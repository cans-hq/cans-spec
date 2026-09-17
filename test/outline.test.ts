import { describe, test, expect } from './testing.ts';
import { parseOutline, flattenNodes, countNodes, maxDepth } from '../src/core/outline.ts';
import { readFixture } from './helpers.ts';

describe('parseOutline', () => {
  const src = readFixture('flat-project', '02-authentication.md');
  const nodes = parseOutline(src, '02-authentication.md');

  test('parses top-level node', () => {
    expect(nodes.length).toBe(1);
    expect(nodes[0].text).toBe('Authentication');
    expect(nodes[0].indent).toBe(0);
    expect(nodes[0].file).toBe('02-authentication.md');
  });

  test('parses nested children', () => {
    const auth = nodes[0];
    expect(auth.children.length).toBe(3); // Sign up, Sessions, Passwords
    expect(auth.children[0].text).toBe('Sign up');
    expect(auth.children[1].text).toBe('Sessions');
    expect(auth.children[2].text).toBe('Passwords');
  });

  test('tracks indent levels', () => {
    const auth = nodes[0];
    const signUp = auth.children[0];
    expect(signUp.indent).toBe(1);
    const email = signUp.children[0];
    expect(email.indent).toBe(2);
    expect(email.children[0].indent).toBe(3);
  });

  test('parses tasks with checkboxes', () => {
    const taskSrc = readFixture('flat-project', '_tasks', 'add-dark-mode.md');
    const taskNodes = parseOutline(taskSrc, 'add-dark-mode.md');
    const flat = flattenNodes(taskNodes);
    const doneTask = flat.find(n => n.text.includes('Add ThemeContext provider'));
    expect(doneTask).toBeDefined();
    expect(doneTask!.isTask).toBe(true);
    expect(doneTask!.isDone).toBe(true);
  });

  test('parses owner arrows', () => {
    const taskSrc = readFixture('flat-project', '_tasks', 'add-dark-mode.md');
    const taskNodes = parseOutline(taskSrc, 'add-dark-mode.md');
    const flat = flattenNodes(taskNodes);
    const owned = flat.find(n => n.text.includes('Create toggle component'));
    expect(owned!.owner).toBe('agent-1');
  });

  test('parses human gates', () => {
    const taskSrc = readFixture('flat-project', '_tasks', 'add-dark-mode.md');
    const taskNodes = parseOutline(taskSrc, 'add-dark-mode.md');
    const flat = flattenNodes(taskNodes);
    const gate = flat.find(n => n.text.includes('Spec approved'));
    expect(gate!.isHumanGate).toBe(true);
    expect(gate!.owner).toBe('@human');
  });

  test('parses see: references', () => {
    const apiSrc = readFixture('flat-project', '04-api.md');
    const apiNodes = parseOutline(apiSrc, '04-api.md');
    const flat = flattenNodes(apiNodes);
    const refNode = flat.find(n => n.text.includes('Session rules'));
    expect(refNode!.refs.length).toBe(1);
    expect(refNode!.refs[0].file).toBe('02-authentication.md');
    expect(refNode!.refs[0].anchor).toBe('Sessions');
  });

  test('strips back-pointer comments from text', () => {
    expect(nodes[0].text).not.toContain('ref-by');
    expect(nodes[0].text).toBe('Authentication');
  });

  test('ignores non-bullet lines', () => {
    const src = '# Heading\n\nSome prose\n- Actual bullet\n';
    const parsed = parseOutline(src, 'test.md');
    expect(parsed.length).toBe(1);
    expect(parsed[0].text).toBe('Actual bullet');
  });

  test('rejects tabs', () => {
    const src = '- Parent\n\t- Child\n';
    expect(() => parseOutline(src, 'test.md')).toThrow();
  });

  test('countNodes counts recursively', () => {
    expect(countNodes(nodes)).toBeGreaterThan(5);
  });

  test('maxDepth returns deepest level', () => {
    expect(maxDepth(nodes)).toBe(3);
  });
});

// ── Issue #8: no synthetic "(table)" / "(code fence)" nodes ──

describe('leading table/fence provenance (issue #8)', () => {
  test('table before first bullet: flag lands on the first real node, no "(table)" node', () => {
    const src = [
      '| Name | Value |',
      '|---|---|',
      '| alpha | 1 |',
      '| beta | 2 |',
      '',
      '- First real bullet',
      '- Second real bullet',
      '- Third real bullet',
    ].join('\n');
    const parsed = parseOutline(src, 'test.md');
    const flat = flattenNodes(parsed);
    expect(flat.some(n => n.text === '(table)')).toBe(false);
    expect(countNodes(parsed)).toBe(3);
    expect(parsed[0].text).toBe('First real bullet');
    expect(parsed[0].hasTable).toBe(true);
    expect(parsed[1].hasTable).toBe(false);
    expect(parsed[2].hasTable).toBe(false);
  });

  test('code fence before first bullet: flag lands on the first real node, no "(code fence)" node', () => {
    const src = [
      '```json',
      '{ "alpha": 1 }',
      '```',
      '',
      '- First bullet after fence',
      '- Second bullet after fence',
    ].join('\n');
    const parsed = parseOutline(src, 'test.md');
    const flat = flattenNodes(parsed);
    expect(flat.some(n => n.text === '(code fence)')).toBe(false);
    expect(countNodes(parsed)).toBe(2);
    expect(parsed[0].text).toBe('First bullet after fence');
    expect(parsed[0].hasCodeFence).toBe(true);
    expect(parsed[1].hasCodeFence).toBe(false);
  });

  test('table-only file parses to zero nodes', () => {
    const src = '| A | B |\n|---|---|\n| 1 | 2 |\n';
    expect(parseOutline(src, 'test.md')).toEqual([]);
  });

  test('fence-only file parses to zero nodes', () => {
    const src = '```json\n{ "a": 1 }\n```\n';
    expect(parseOutline(src, 'test.md')).toEqual([]);
  });

  test('fence+table-only file parses to zero nodes', () => {
    const src = '```json\n{ "a": 1 }\n```\n| A | B |\n|---|---|\n| 1 | 2 |\n';
    expect(parseOutline(src, 'test.md')).toEqual([]);
  });

  test('mid-file table still attaches to the preceding node (pin)', () => {
    const src = [
      '- Parent bullet',
      '  - Child note',
      '',
      '| Col A | Col B |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '- After table',
    ].join('\n');
    const parsed = parseOutline(src, 'test.md');
    const flat = flattenNodes(parsed);
    expect(flat.some(n => n.text === '(table)')).toBe(false);
    const child = flat.find(n => n.text === 'Child note');
    expect(child).toBeDefined();
    expect(child!.hasTable).toBe(true);
    expect(flat.find(n => n.text === 'After table')!.hasTable).toBe(false);
  });
});

// ── Issue #9: unclosed code fence warns instead of silently swallowing content ──

describe('unclosed code fence warning (issue #9)', () => {
  test('unclosed fence pushes exactly one warning naming the opening line', () => {
    const src = [
      '- First bullet',
      '- Second bullet',
      '```',
      '- Third bullet',
      '- Fourth bullet',
    ].join('\n');
    const warnings: { line: number; message: string }[] = [];
    parseOutline(src, 'test.md', warnings);
    expect(warnings.length).toBe(1);
    expect(warnings[0].line).toBe(3);
    expect(warnings[0].message).toContain('unclosed code fence opened at line 3');
  });

  test('properly closed fence produces no warning', () => {
    const src = [
      '- First bullet',
      '```',
      'const x = 1;',
      '```',
      '- Second bullet',
    ].join('\n');
    const warnings: { line: number; message: string }[] = [];
    parseOutline(src, 'test.md', warnings);
    expect(warnings).toEqual([]);
  });

  test('swallowing behavior is unchanged: bullets after a stray fence are excluded', () => {
    const src = [
      '- First bullet',
      '- Second bullet',
      '```',
      '- Third bullet',
      '- Fourth bullet',
    ].join('\n');
    const parsed = parseOutline(src, 'test.md');
    const flat = flattenNodes(parsed);
    expect(countNodes(parsed)).toBe(2);
    expect(flat.map(n => n.text)).toEqual(['First bullet', 'Second bullet']);
  });
});
