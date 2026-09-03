import { describe, test, expect } from 'bun:test';
import { parseOutline } from '../src/core/outline';
import { buildRefGraph, checkRefs, detectDeepHops, detectOrphans } from '../src/core/refs';
import { readFixture } from './helpers';

function loadFiles(project: string, fileNames: string[]): Map<string, any[]> {
  const map = new Map();
  for (const f of fileNames) {
    const src = readFixture(project, f);
    map.set(f, parseOutline(src, f));
  }
  return map;
}

describe('ref resolution', () => {
  test('resolves valid file+anchor ref', () => {
    const files = loadFiles('flat-project', ['02-authentication.md', '04-api.md']);
    const graph = buildRefGraph(files, '.');
    const issues = checkRefs(files, graph, '.');
    const broken = issues.filter(i => i.category === 'refs' && i.level === 'error');
    expect(broken.length).toBe(0);
  });

  test('detects broken file ref', () => {
    const files = loadFiles('broken-refs-project', ['04-api.md']);
    const graph = buildRefGraph(files, '.');
    const issues = checkRefs(files, graph, '.');
    const broken = issues.filter(i => i.message.includes('99-nonexistent'));
    expect(broken.length).toBe(1);
    expect(broken[0].level).toBe('error');
  });

  test('detects broken anchor ref', () => {
    const files = loadFiles('broken-refs-project', ['04-api.md']);
    const graph = buildRefGraph(files, '.');
    const issues = checkRefs(files, graph, '.');
    const broken = issues.filter(i => i.message.includes('02-auth.md'));
    expect(broken.length).toBe(1);
  });

  test('detects self-reference', () => {
    const files = loadFiles('broken-refs-project', ['04-api.md']);
    const graph = buildRefGraph(files, '.');
    const issues = checkRefs(files, graph, '.');
    const selfRef = issues.filter(i => i.message.includes('Self ref') || i.message.includes('self'));
    expect(selfRef.length).toBe(1);
    expect(selfRef[0].level).toBe('error');
  });
});

describe('deep-hop detection', () => {
  test('detects A → B → C chain', () => {
    const files = loadFiles('deep-hop-project', [
      '04-api.md', '02-authentication.md', '06-operations.md',
    ]);
    const graph = buildRefGraph(files, '.');
    const issues = detectDeepHops(graph);
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('DEEP HOP');
    expect(issues[0].message).toContain('04-api.md');
    expect(issues[0].message).toContain('02-authentication.md');
    expect(issues[0].message).toContain('06-operations.md');
  });

  test('suggests fix', () => {
    const files = loadFiles('deep-hop-project', [
      '04-api.md', '02-authentication.md', '06-operations.md',
    ]);
    const graph = buildRefGraph(files, '.');
    const issues = detectDeepHops(graph);
    expect(issues[0].suggestion).toBeDefined();
    expect(issues[0].suggestion).toContain('06-operations.md');
  });

  test('no deep hop in flat-project', () => {
    const files = loadFiles('flat-project', [
      '02-authentication.md', '04-api.md', '06-operations.md',
    ]);
    const graph = buildRefGraph(files, '.');
    const issues = detectDeepHops(graph);
    expect(issues.length).toBe(0);
  });
});

describe('orphan detection', () => {
  test('flags file with no refs', () => {
    const files = new Map();
    files.set('orphan.md', parseOutline('- Lonely node\n', 'orphan.md'));
    const graph = buildRefGraph(files, '.');
    const issues = detectOrphans(files, graph);
    expect(issues.length).toBe(1);
    expect(issues[0].level).toBe('warning');
  });
});
