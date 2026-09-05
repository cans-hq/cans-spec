import type { OutlineNode, Issue, StructureRules } from '../types';

/** Structure checks: node length, depth, sibling count, single-child collapse, empty nodes.
 *  §18 delete-key semantics: a check whose rules key is null/false is OFF — the
 *  check is skipped entirely (never compared against null, which would coerce
 *  to 0 and flag everything). */
export function checkStructure(
  nodes: OutlineNode[],
  file: string,
  rules: StructureRules,
): Issue[] {
  const issues: Issue[] = [];

  const walk = (list: OutlineNode[]): void => {
    for (const node of list) {
      const len = node.text.length;
      const nl = rules.node_length;
      if (nl !== null && nl.max !== null && len > nl.max) {
        issues.push({
          file,
          line: node.line,
          level: 'error',
          category: 'structure',
          message: `Node too long (${len} > ${nl.max}). Split or move to file.`,
        });
      } else if (nl !== null && nl.min !== null && len < nl.min) {
        issues.push({
          file,
          line: node.line,
          level: 'warning',
          category: 'structure',
          message: `Node too short (${len} < ${nl.min}).`,
        });
      }

      const depth = node.indent + 1;
      const depthMax = rules.depth !== null ? rules.depth.max : null;
      if (depthMax !== null && depth > depthMax) {
        issues.push({
          file,
          line: node.line,
          level: 'error',
          category: 'structure',
          message: `Depth ${depth} exceeds max ${depthMax}. Flatten.`,
        });
      }

      const count = node.children.length;
      const siblingsMax = rules.siblings !== null ? rules.siblings.max : null;
      if (siblingsMax !== null && count > siblingsMax) {
        issues.push({
          file,
          line: node.line,
          level: 'warning',
          category: 'structure',
          message: `"${node.text}" has ${count} children (max ${siblingsMax}).`,
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
