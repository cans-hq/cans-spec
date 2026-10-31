import { STRUCTURE_CHARS_PER_TOKEN } from '../types.ts';
import type { OutlineNode, Issue, StructureRules, ContentRules } from '../types.ts';
import { flattenNodes, isSyntheticNode, stripRefSyntax } from './outline.ts';

/** Issue #61: the folded node string — title + continuation texts joined
 *  with single spaces (node_length scope 'total', and the
 *  multiline.mode 'fold' override). Degenerates to the title itself for a
 *  node with no continuations. */
function foldNodeText(node: OutlineNode): string {
  return [node.text, ...(node.continuations ?? []).map(c => c.text)].join(' ');
}

/** Issue #61: measure an evaluation string in the configured unit — 'chars'
 *  (string length, the pre-#61 semantics), 'words' (whitespace-split token
 *  count) or 'tokens' (ceil(chars / STRUCTURE_CHARS_PER_TOKEN), the
 *  CANONICAL estimate: a per-workspace token_budget.estimate_chars_per_token
 *  override does not re-calibrate this estimator — types.ts pins the const). */
function measureNodeLength(text: string, unit: 'chars' | 'words' | 'tokens'): number {
  if (unit === 'words') return text.split(/\s+/).filter(w => w.length > 0).length;
  if (unit === 'tokens') return Math.ceil(text.length / STRUCTURE_CHARS_PER_TOKEN);
  return text.length;
}

/** Structure checks: node length, depth, sibling count, single-child collapse, empty nodes.
 *  Both sides of every range are enforced (issue #1 — siblings.min and depth.min
 *  were banner-checked but never enforced): node_length, siblings and depth each
 *  check their `min` as well as their `max`.
 *  §18 delete-key semantics: a check whose rules key is null/false is OFF — the
 *  check is skipped entirely (never compared against null, which would coerce
 *  to 0 and flag everything). Issue #61 additionally gives node_length a
 *  severity band (default 'warn' — both sides warning; 'error' fatal; 'off'
 *  skipped) and adds the multiline policy (structure.multiline, §18: absent
 *  or null section = no policy at all). */
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
        const nl = rules.node_length;
        const conts = node.continuations ?? [];
        // Issue #61: node_length is granular — unit (chars/words/tokens),
        // scope (title/body/total), strip_references and severity — with a
        // bare {min,max} (the only pre-#61 form) still meaning
        // chars/title/false/'warn'. The severity band deliberately REPLACES
        // the hardcoded max:'error'/min:'warning' pair: BOTH sides follow
        // node_length.severity now, default 'warn' (structured diagnostics,
        // exit 0 band) — severity:'error' restores fatal, 'off' (§18) skips
        // the check entirely. loadRules normalizes absent members; these
        // reads default defensively for raw-node callers.
        if (nl !== null && (nl.severity ?? 'warn') !== 'off') {
          const unit = nl.unit ?? 'chars';
          const scope = nl.scope ?? 'title';
          // multiline.mode 'fold' is a PARAMETER, not a finding: it overrides
          // the evaluation string to the folded title+continuation text for
          // every node WITH continuations regardless of scope — and a
          // multiline severity 'off' mutes the findings, never the fold.
          // rules.multiline null/absent (§18) means no policy at all, so no
          // fold either.
          const foldOn =
            rules.multiline != null && (rules.multiline.mode ?? 'allow') === 'fold' && conts.length > 0;
          // Scope 'body': the continuation text only, folded with single
          // spaces — a node with NO continuations is not evaluated at all
          // (null skips both sides of the range, min included).
          let text: string | null;
          if (foldOn) {
            text = foldNodeText(node);
          } else if (scope === 'title') {
            text = node.text;
          } else if (scope === 'body') {
            text = conts.length > 0 ? conts.map(c => c.text).join(' ') : null;
          } else {
            text = foldNodeText(node); // 'total' — the title itself when unwrapped
          }
          if (text !== null) {
            // strip_references (issue #61): strip `see: <target>` pointer
            // spans BEFORE measuring, in every scope — reusing THE ref
            // stripper (stripRefSyntax, issue #46/#48 semantics: trailing
            // prose punctuation rides with the span, a pure-punctuation
            // match is prose and stays). Reference syntax is structural, not
            // content — the same §8/§13 argument redundancy tokenizes under.
            if (nl.strip_references === true) text = stripRefSyntax(text);
            const len = measureNodeLength(text, unit);
            const level = nl.severity === 'error' ? 'error' : 'warning';
            const unitLabel = unit === 'chars' ? '' : ` ${unit}`;
            if (nl.max !== null && len > nl.max) {
              issues.push({
                file,
                line: node.line,
                level,
                category: 'structure',
                message: `Node too long (${len} > ${nl.max}${unitLabel}). Split or move to file.`,
                rule: 'structure.node_length.max', // issue #41: machine-readable rule key
              });
            } else if (nl.min !== null && len < nl.min) {
              issues.push({
                file,
                line: node.line,
                level,
                category: 'structure',
                message: `Node too short (${len} < ${nl.min}${unitLabel}).`,
                rule: 'structure.node_length.min', // issue #41: machine-readable rule key
              });
            }
          }
        }

        // Issue #61: the multiline policy over the node's recorded wrapped
        // prose — runs only when rules.multiline exists (§18: an absent/null
        // section is no policy at all; mode 'fold' alone never mints a
        // finding). One finding per node per rule; every finding sits on the
        // node's title line except indent_aligned, which names the FIRST
        // offending continuation's own line. Synthetic placeholders never
        // reach here (the isSyntheticNode guard above).
        const ml = rules.multiline;
        if (ml != null && (ml.severity ?? 'warn') !== 'off') {
          const level = ml.severity === 'error' ? 'error' : 'warning';
          if ((ml.mode ?? 'allow') === 'forbid' && conts.length > 0) {
            issues.push({
              file,
              line: node.line,
              level,
              category: 'structure',
              message: `Wrapped prose used but structure.multiline.mode is forbid (${conts.length} continuation line${conts.length === 1 ? '' : 's'}).`,
              suggestion: 'fold the text into the bullet line, or split it into child nodes',
              rule: 'structure.multiline.forbid',
            });
          }
          const maxLines = ml.max_lines ?? null;
          if (maxLines !== null && conts.length > maxLines) {
            issues.push({
              file,
              line: node.line,
              level,
              category: 'structure',
              message: `${conts.length} continuation lines exceed structure.multiline.max_lines (${maxLines})`,
              suggestion: 'wrap shorter, or split the prose into child nodes',
              rule: 'structure.multiline.max_lines',
            });
          }
          if (ml.indent_aligned === true) {
            // The bullet's text column: indent level (2-space units) + the
            // `- ` list-marker width. The CANONICAL column — the node records
            // the indent level, not the raw marker spelling, so a widened
            // marker (`-   text`) or odd indentation aligns to the canonical
            // column like every other 2-space-unit consumer (both are already
            // outside the documented 2-space house style).
            const textCol = node.indent * 2 + 2;
            const offender = conts.find(c => c.indent !== textCol);
            if (offender !== undefined) {
              issues.push({
                file,
                line: offender.line,
                level,
                category: 'structure',
                message: `Continuation indent ${offender.indent} does not match the node text column ${textCol}.`,
                suggestion: `indent continuation lines to column ${textCol} (aligned with the text after "- ")`,
                rule: 'structure.multiline.indent_aligned',
              });
            }
          }
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
        // siblings.max side above. Issue #51: when count === 1 AND the
        // single_child_collapse advisory is enabled, the collapse warning below
        // SUBSUMES the min violation for the same node (both are warnings about
        // the same shape; the collapse advice is the strictly more actionable
        // one) — siblings.min must NOT also fire, or the node is double-counted
        // in the section total. With the advisory OFF (§18 config disabled it),
        // the min check is that node's only remaining signal and still fires.
        // Defaults (siblings.min: 1) never reach the subsumed branch (`1 < 1`
        // is false), so default-rule workspaces are unaffected.
        const siblingsMin = rules.siblings !== null ? rules.siblings.min : null;
        if (
          siblingsMin !== null && count > 0 && count < siblingsMin &&
          !(count === 1 && rules.single_child_collapse)
        ) {
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
