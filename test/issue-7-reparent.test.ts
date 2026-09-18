import { describe, test, expect } from './testing.ts';
import { parseOutline, type ParseWarning } from '../src/core/outline.ts';
import { checkStructure } from '../src/core/structure.ts';
import { defaultRules } from '../src/core/rules.ts';

const structureRules = defaultRules().structure;

/** Issue #7: a bullet that dedents below the stack bottom (e.g. the file's
 *  first bullet is indented under a `#` heading, a later bullet sits at
 *  column 0) must become a ROOT SIBLING, not a child of the shallower node.
 *  The old stack loop stopped popping at `stack.length > 1`, so the column-0
 *  bullet fell into the "indented jump deeper" fallback and silently
 *  re-parented the whole tree (A -> B -> C chain instead of [A, B -> C]). */
describe('issue #7 — dedent-to-root re-parenting', () => {
  test('issue repro: column-0 bullet becomes a root sibling, no warnings', () => {
    const warnings: ParseWarning[] = [];
    const roots = parseOutline('  - A first\n- B second\n  - C child of B\n', '01-a.md', warnings);
    expect(roots.length, 'A and B must be siblings at the root level').toBe(2);
    const a = roots[0];
    const b = roots[1];
    expect(a.text).toBe('A first');
    expect(a.indent).toBe(1);
    expect(a.children.length).toBe(0);
    expect(b.text).toBe('B second');
    expect(b.indent).toBe(0);
    expect(b.children.length).toBe(1);
    expect(b.children[0]!.text).toBe('C child of B');
    expect(b.children[0]!.indent).toBe(1);
    // All indents here are 2-space multiples — no parse diagnostics expected.
    expect(warnings).toEqual([]);
  });

  test('stack fully drains: every shallower level becomes a root', () => {
    const roots = parseOutline('    - Deep\n  - Mid\n- Root\n', 'drain.md');
    expect(roots.length).toBe(3);
    expect(roots.map(n => n.text)).toEqual(['Deep', 'Mid', 'Root']);
    expect(roots.map(n => n.indent)).toEqual([2, 1, 0]);
    for (const r of roots) expect(r.children.length).toBe(0);
  });

  test('dedent to a middle level keeps the deeper-jump fallback semantics', () => {
    // B (indent 2) is an indented jump under A (indent 0); C (indent 1)
    // dedents into the gap with no exact match on the stack — the existing
    // fallback rule attaches it under the nearest shallower node (A).
    const roots = parseOutline('- A\n    - B\n  - C\n', 'fallback.md');
    expect(roots.length).toBe(1);
    expect(roots[0]!.text).toBe('A');
    expect(roots[0]!.children.map(n => n.text)).toEqual(['B', 'C']);
  });

  test('normal dedent across levels still yields a root sibling', () => {
    const roots = parseOutline('- A\n  - B\n- C\n', 'normal.md');
    expect(roots.length).toBe(2);
    expect(roots[0]!.text).toBe('A');
    expect(roots[0]!.children.map(n => n.text)).toEqual(['B']);
    expect(roots[1]!.text).toBe('C');
    expect(roots[1]!.children.length).toBe(0);
  });

  test('sibling chains at depth are unaffected', () => {
    const roots = parseOutline('- A\n  - B\n  - C\n', 'chain.md');
    expect(roots.length).toBe(1);
    expect(roots[0]!.children.map(n => n.text)).toEqual(['B', 'C']);
  });

  test('leading indented bullet alone stays a root', () => {
    const roots = parseOutline('  - A\n', 'solo.md');
    expect(roots.length).toBe(1);
    expect(roots[0]!.indent).toBe(1);
    expect(roots[0]!.children.length).toBe(0);
  });

  test('downstream: no phantom single-child warning on the mis-parented ancestor', () => {
    // Old tree: A(1 child) -> B(1 child) -> C produced two "exactly 1 child"
    // warnings. Correct tree: [A, B -> C] — only B genuinely has 1 child.
    const nodes = parseOutline('  - A first\n- B second\n  - C child of B\n', '01-a.md');
    const issues = checkStructure(nodes, '01-a.md', { ...structureRules, single_child_collapse: true });
    expect(issues.filter(i => i.message.includes('"A first"'))).toEqual([]);
    expect(issues.filter(i => i.message.includes('1 child')).length).toBe(1);
    expect(issues[0]!.message).toContain('"B second"');
  });

  test('downstream: corrected tree with two children under B is fully clean', () => {
    const nodes = parseOutline('  - A first\n- B second\n  - C child of B\n  - D second child\n', '01-b.md');
    const issues = checkStructure(nodes, '01-b.md', structureRules);
    expect(issues).toEqual([]);
  });

  test('CRLF line endings: repro parses identically to LF', () => {
    const warnings: ParseWarning[] = [];
    const roots = parseOutline('  - A first\r\n- B second\r\n  - C child of B\r\n', '01-crlf.md', warnings);
    expect(roots.length).toBe(2);
    expect(roots[0]!.text).toBe('A first');
    expect(roots[0]!.children.length).toBe(0);
    expect(roots[1]!.text).toBe('B second');
    expect(roots[1]!.children.map(n => n.text)).toEqual(['C child of B']);
    expect(warnings).toEqual([]);
  });
});
