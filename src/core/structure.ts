import type { OutlineNode, Issue, StructureRules, ContentRules } from '../types.ts';
import { flattenNodes, maxDepth as outlineMaxDepth } from './outline.ts';

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
          rule: 'structure.node_length.max', // issue #41: machine-readable rule key
        });
      } else if (nl !== null && nl.min !== null && len < nl.min) {
        issues.push({
          file,
          line: node.line,
          level: 'warning',
          category: 'structure',
          message: `Node too short (${len} < ${nl.min}).`,
          rule: 'structure.node_length.min', // issue #41
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
          rule: 'structure.depth.max', // issue #41
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
          rule: 'structure.siblings.max', // issue #41
        });
      }

      // issue #41: §15 documents "sibling count per parent" as a min/max check,
      // but only max was enforced — siblings.min was an inert knob. Fire for
      // parents with 2..min-1 children (2+ avoids double-reporting the 1-child
      // case the single_child_collapse check owns; 0 children is a leaf).
      const siblingsMin = rules.siblings !== null ? rules.siblings.min : null;
      if (siblingsMin !== null && count >= 2 && count < siblingsMin) {
        issues.push({
          file,
          line: node.line,
          level: 'warning',
          category: 'structure',
          message: `"${node.text}" has ${count} children (min ${siblingsMin}).`,
          rule: 'structure.siblings.min', // issue #41
        });
      }

      if (rules.single_child_collapse && count === 1) {
        issues.push({
          file,
          line: node.line,
          level: 'warning',
          category: 'structure',
          message: `"${node.text}" has exactly 1 child. Collapse.`,
          rule: 'structure.single_child', // issue #41
        });
      }

      if (rules.empty_nodes && node.text.trim() === '') {
        issues.push({
          file,
          line: node.line,
          level: 'warning',
          category: 'structure',
          message: 'Empty node.',
          rule: 'structure.empty_node', // issue #41
        });
      }

      walk(node.children);
    }
  };

  walk(nodes);

  // issue #41: §15 documents depth (min/max) — enforce the documented minimum.
  // Per-file, warning-level (the issue's scenario: `Max depth 4 is below min 5`
  // at agent.md:1), skipped for empty files; depth is 1-based like §35 maxDepth.
  const depthMin = rules.depth !== null ? rules.depth.min : null;
  if (depthMin !== null && nodes.length > 0) {
    const d = outlineMaxDepth(nodes) + 1;
    if (d < depthMin) {
      issues.push({
        file,
        line: nodes[0]?.line ?? 0,
        level: 'warning',
        category: 'structure',
        message: `Max depth ${d} is below min ${depthMin}. Deepen the outline.`,
        suggestion: 'deepen the outline or lower structure.depth.min in _rules.yaml',
        rule: 'structure.depth.min', // issue #41
      });
    }
  }

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
        rule: 'content.tbd.disallowed', // issue #41
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
        rule: 'content.tbd.max', // issue #41
      },
    ];
  }
  return [];
}
