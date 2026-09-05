import type { OutlineNode, Issue, StructureRules, ContentRules } from '../types';
import { flattenNodes } from './outline';

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

/** §18 content rules — TBD policy per file (QA-13 F4: the knobs were inert).
 *  `tbd_allowed: false` → any TBD node is flagged; otherwise `max_tbd_per_file`
 *  caps the number of TBD nodes per file (deleted key → null → no cap). One
 *  warning per file: §4 keeps TBDs first-class, so exceeding the policy is
 *  advisory and never affects the exit code (§19). */
export function checkTbdPolicy(
  nodes: OutlineNode[],
  file: string,
  rules: ContentRules,
): Issue[] {
  const tbdNodes = flattenNodes(nodes).filter(n => /\bTBD\b/i.test(n.text));
  if (tbdNodes.length === 0) return [];
  if (!rules.tbd_allowed) {
    return [
      {
        file,
        line: tbdNodes[0]!.line,
        level: 'warning',
        category: 'structure',
        message: 'TBD used but content.tbd_allowed is false',
        suggestion: 'resolve the TBD nodes or set content.tbd_allowed: true',
      },
    ];
  }
  if (rules.max_tbd_per_file !== null && tbdNodes.length > rules.max_tbd_per_file) {
    return [
      {
        file,
        line: tbdNodes[0]!.line,
        level: 'warning',
        category: 'structure',
        message: `${tbdNodes.length} TBD nodes exceed content.max_tbd_per_file (${rules.max_tbd_per_file})`,
        suggestion: 'resolve the TBD nodes or raise content.max_tbd_per_file',
      },
    ];
  }
  return [];
}
