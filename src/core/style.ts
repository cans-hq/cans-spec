import type { OutlineNode, Issue, StyleRules } from '../types';

/** Style checks: shared-prefix nesting hint + unnecessary-nesting collapse hint. All warnings. */
export function checkStyle(
  nodes: OutlineNode[],
  file: string,
  rules: StyleRules,
): Issue[] {
  const issues: Issue[] = [];

  const walk = (list: OutlineNode[]): void => {
    for (const node of list) {
      const children = node.children;

      if (rules.shared_prefix_detection && children.length >= rules.force_nested_above) {
        const groups = new Map<string, number>();
        for (const child of children) {
          const word = child.text.split(/\s+/)[0] ?? '';
          if (word === '') continue;
          groups.set(word, (groups.get(word) ?? 0) + 1);
        }
        for (const [word, size] of groups) {
          if (size >= rules.force_nested_above) {
            issues.push({
              file,
              line: node.line,
              level: 'warning',
              category: 'style',
              message: `${size} siblings share prefix "${word}". Group under nested style.`,
            });
          }
        }
      }

      if (
        children.length >= 1 &&
        children.length < rules.force_sibling_below &&
        children.every((c) => c.children.length === 0)
      ) {
        issues.push({
          file,
          line: node.line,
          level: 'warning',
          category: 'style',
          message: `"${node.text}" has ${children.length} children. Collapse to sibling style.`,
        });
      }

      walk(children);
    }
  };

  walk(nodes);
  return issues;
}
