import type { OutlineNode, Issue, StructureRules } from '../types';

/** Structure checks: node length, depth, sibling count, single-child collapse, empty nodes. */
export function checkStructure(
  nodes: OutlineNode[],
  file: string,
  rules: StructureRules,
): Issue[] {
  const issues: Issue[] = [];

  const walk = (list: OutlineNode[]): void => {
    for (const node of list) {
      const len = node.text.length;
      if (len > rules.node_length.max) {
        issues.push({
          file,
          line: node.line,
          level: 'error',
          category: 'structure',
          message: `Node too long (${len} > ${rules.node_length.max}). Split or move to file.`,
        });
      } else if (len < rules.node_length.min) {
        issues.push({
          file,
          line: node.line,
          level: 'warning',
          category: 'structure',
          message: `Node too short (${len} < ${rules.node_length.min}).`,
        });
      }

      const depth = node.indent + 1;
      if (depth > rules.depth.max) {
        issues.push({
          file,
          line: node.line,
          level: 'error',
          category: 'structure',
          message: `Depth ${depth} exceeds max ${rules.depth.max}. Flatten.`,
        });
      }

      const count = node.children.length;
      if (count > rules.siblings.max) {
        issues.push({
          file,
          line: node.line,
          level: 'warning',
          category: 'structure',
          message: `"${node.text}" has ${count} children (max ${rules.siblings.max}).`,
        });
      }

      if (rules.single_child_collapse && count === 1) {
        issues.push({
          file,
          line: node.line,
          level: 'warning',
          category: 'structure',
          message: `"${node.text}" has exactly 1 child. Collapse.`,
        });
      }

      if (rules.empty_nodes && node.text.trim() === '') {
        issues.push({
          file,
          line: node.line,
          level: 'warning',
          category: 'structure',
          message: 'Empty node.',
        });
      }

      walk(node.children);
    }
  };

  walk(nodes);
  return issues;
}
