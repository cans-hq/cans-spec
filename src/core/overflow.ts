import type { OutlineNode, Issue, OverflowRules } from '../types';

/** Overflow checks: code fences, tables, over-long nodes. All errors.
 *  Inline code spans never set hasCodeFence (parser-level distinction). */
export function checkOverflow(
  nodes: OutlineNode[],
  file: string,
  rules: OverflowRules,
): Issue[] {
  const issues: Issue[] = [];

  const walk = (list: OutlineNode[]): void => {
    for (const node of list) {
      if (node.hasCodeFence) {
        issues.push({
          file,
          line: node.line,
          level: 'error',
          category: 'overflow',
          message: 'code fence detected — extract to file and reference via see:',
        });
      }
      if (node.hasTable) {
        issues.push({
          file,
          line: node.line,
          level: 'error',
          category: 'overflow',
          message: 'table detected — extract to file and reference via see:',
        });
      }
      if (node.text.length > rules.max_node_chars) {
        issues.push({
          file,
          line: node.line,
          level: 'error',
          category: 'overflow',
          message: `node exceeds max chars (${node.text.length} > ${rules.max_node_chars})`,
        });
      }
      walk(node.children);
    }
  };

  walk(nodes);
  return issues;
}
