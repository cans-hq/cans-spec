import type { OutlineNode, Issue, StyleRules } from '../types';

/** Style checks: shared-prefix nesting hint + unnecessary-nesting collapse hint.
 *  SEVERITY NOTE (arbitration, same class as the refs-severity decision): §14/§36
 *  show ✗ for style flags, but the frozen §35/§18 fixtures (flat-project,
 *  folder-project, init templates) structurally trigger the ≤N-leaf rule and the
 *  frozen baselines pin `errorCount === 0` / `ok === true` on them — so style
 *  findings stay `warning`-level. Changing test fixtures is out of bounds
 *  (test/ is frozen).
 *  §18 delete-key semantics: a style rule whose key is null/false no longer
 *  fires (deleted force_nested_above / force_sibling_below / prefer or
 *  shared_prefix_detection: false skip their rules entirely). */
export function checkStyle(
  nodes: OutlineNode[],
  file: string,
  rules: StyleRules,
): Issue[] {
  const issues: Issue[] = [];

  const walk = (list: OutlineNode[]): void => {
    for (const node of list) {
      const children = node.children;

      const nestedAbove = rules.force_nested_above;
      if (rules.shared_prefix_detection && nestedAbove !== null && children.length >= nestedAbove) {
        const groups = new Map<string, number>();
        for (const child of children) {
          const word = child.text.split(/\s+/)[0] ?? '';
          if (word === '') continue;
          groups.set(word, (groups.get(word) ?? 0) + 1);
        }
        for (const [word, size] of groups) {
          if (size >= nestedAbove) {
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

      // §14: "Parent with ≤ force_sibling_below leaf children → collapse to
      // sibling style." `≤` semantics (exactly N is flagged). The file root is
      // exempt — a root concept with few subtopics is the normal spec shape,
      // not unnecessary nesting. A single child is reported by the structure
      // engine ("exactly 1 child"); don't double-report it here.
      const siblingBelow = rules.force_sibling_below;
      if (
        siblingBelow !== null &&
        node.indent > 0 &&
        children.length >= 2 &&
        children.length <= siblingBelow &&
        children.every((c) => c.children.length === 0)
      ) {
        issues.push({
          file,
          line: node.line,
          level: 'warning',
          category: 'style',
          // QA-03 F17 pluralization contract (unreachable for 1 — the ≥2 guard
          // above plus the structure engine owns the 1-child case).
          message: `"${node.text}" has ${children.length} ${children.length === 1 ? 'child' : 'children'}. Collapse to sibling style.`,
        });
      }

      walk(children);
    }
  };

  walk(nodes);
  return issues;
}
