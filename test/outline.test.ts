import { describe, test, expect } from 'bun:test';
import { parseOutline, flattenNodes, countNodes, maxDepth } from '../src/core/outline';
import { readFixture } from './helpers';

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
