import type { OutlineNode, Issue, StructureRules, ContentRules } from '../types.ts';
import { flattenNodes, isSyntheticNode } from './outline.ts';

/** Structure checks: node length, depth, sibling count, single-child collapse, empty nodes.
 *  Both sides of every range are enforced (issue #1 — siblings.min and depth.min
 *  were banner-checked but never enforced): node_length, siblings and depth each
 *  check their `min` (warning) as well as their `max`.
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
      // Issue #8: synthetic "(table)"/"(code fence)" placeholders are not user
      // structure — never flagged themselves (their children, if any, still
      // are: the walk recurses below regardless).
      if (!isSyntheticNode(node)) {
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
          rule: 'structure.node_length.min', // issue #41: machine-readable rule key
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
          rule: 'structure.depth.max', // issue #41: machine-readable rule key
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
          rule: 'structure.siblings.max', // issue #41: machine-readable rule key
          });
        }
        // Issue #1: enforce siblings.min — a parent with 0 < count < min children
        // is under the configured fan-out. Warning level, consistent with the
        // siblings.max side above. The single_child_collapse advisory below is a
        // separate check and may fire for the same node — that is acceptable.
        const siblingsMin = rules.siblings !== null ? rules.siblings.min : null;
        if (siblingsMin !== null && count > 0 && count < siblingsMin) {
          issues.push({
            file,
            line: node.line,
            level: 'warning',
            category: 'structure',
            message: `"${node.text}" has ${count} children (min ${siblingsMin}).`,
          rule: 'structure.siblings.min', // issue #41: machine-readable rule key
          });
        }

        if (rules.single_child_collapse && count === 1) {
          issues.push({
            file,
            line: node.line,
            level: 'warning',
            category: 'structure',
            message: `"${node.text}" has exactly 1 child. Collapse.`,
          rule: 'structure.single_child', // issue #41: machine-readable rule key
          });
        }

        if (rules.empty_nodes && node.text.trim() === '') {
          issues.push({
            file,
            line: node.line,
            level: 'warning',
            category: 'structure',
            message: 'Empty node.',
          rule: 'structure.empty_node', // issue #41: machine-readable rule key
          });
        }
      }

      walk(node.children);
    }
  };

  walk(nodes);

  // Issue #1: enforce depth.min at file level — a file whose deepest node is
  // above the configured minimum is under-specified. Attached to the first
  // root node's line (there is always at least one node when the file has
  // nodes); an empty tree skips the check entirely.
  // LEVEL RATIONALE: depth.min is a warning — a too-shallow file is advisory
  // (depth.max stays an error because it protects the token budget; making
  // shallow files hard-fail would break legitimately shallow summary files).
  // siblings.min is a warning for the same reason: it matches the warning
  // level of the siblings.max side. Defaults (min: 1 both) can never fire —
  // `0 < count < 1` is impossible and any non-empty file has max depth ≥ 1 —
  // so default-rule workspaces stay clean.
  if (nodes.length > 0) {
    const depthMin = rules.depth !== null ? rules.depth.min : null;
    if (depthMin !== null) {
      let maxNodeDepth = 0;
      for (const n of flattenNodes(nodes)) {
        const d = n.indent + 1; // same convention as the per-node depth check above
        if (d > maxNodeDepth) maxNodeDepth = d;
      }
      if (maxNodeDepth < depthMin) {
        issues.push({
          file,
          line: nodes[0]!.line,
          level: 'warning',
          category: 'structure',
          message: `Max depth ${maxNodeDepth} is below min ${depthMin}. Deepen the outline.`,
          suggestion: `add nested sub-levels until the outline reaches depth ${depthMin}, or lower structure.depth.min in _rules.yaml`,
          rule: 'structure.depth.min', // issue #41: machine-readable rule key
        });
      }
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
          rule: 'content.tbd.disallowed', // issue #41: machine-readable rule key
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
          rule: 'content.tbd.max', // issue #41: machine-readable rule key
        suggestion: 'resolve the TBD nodes or raise content.max_tbd_per_file',
      },
    ];
  }
  return [];
}
