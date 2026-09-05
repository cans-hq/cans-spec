import type { OutlineNode, Issue, OverflowRules } from '../types';
import { flattenNodes } from './outline';

/** Overflow checks: code fences, tables, over-long nodes. All errors.
 *  §18: `force_file_for` lists the content categories forced into files —
 *  `code_block` gates code-fence flags, `table` gates table flags. Empty list
 *  = nothing forced = no content-type flags; null (deleted key) = same.
 *  §18 delete-key semantics: `max_node_chars` null (deleted) → the char-length
 *  check is OFF — skipped entirely, never compared against null. */
export function checkOverflow(
  nodes: OutlineNode[],
  file: string,
  rules: OverflowRules,
): Issue[] {
  const issues: Issue[] = [];
  const forceSet = new Set(rules.force_file_for ?? []);

  const walk = (list: OutlineNode[]): void => {
    for (const node of list) {
      if (node.hasCodeFence && forceSet.has('code_block')) {
        issues.push({
          file,
          line: node.line,
          level: 'error',
          category: 'overflow',
          message: 'code fence detected — extract to file and reference via see:',
        });
      }
      if (node.hasTable && forceSet.has('table')) {
        issues.push({
          file,
          line: node.line,
          level: 'error',
          category: 'overflow',
          message: 'table detected — extract to file and reference via see:',
        });
      }
      if (rules.max_node_chars !== null && node.text.length > rules.max_node_chars) {
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

/** §16 no-chaining: "Overflow target files must NOT contain their own see: refs."
 *  `targets` maps overflow target file → parsed nodes (files inside spec
 *  subfolders, e.g. `04-api/request-schema.md`). */
export function checkNoChaining(targets: Map<string, OutlineNode[]>): Issue[] {
  const issues: Issue[] = [];
  for (const [file, nodes] of targets) {
    for (const node of flattenNodes(nodes)) {
      for (const ref of node.refs) {
        issues.push({
          file,
          line: ref.line,
          level: 'error',
          category: 'overflow',
          message: `no chaining: overflow target ${file} must not contain its own see: refs (found see ${ref.file})`,
          suggestion: `remove the see: ref inside ${file} — overflow targets are leaf content, reference them from a spec file instead`,
        });
      }
    }
  }
  return issues;
}
