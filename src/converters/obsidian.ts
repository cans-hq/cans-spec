import type { ExternalNode } from '../types';
import {
  convertOwnerMarkers, convertWikiLinks, parseCheckbox, parseIndent,
  reverseWikiLinks, stripMetadata,
} from './shared';

/** Remove a leading YAML frontmatter block (`---` fences at very top), fences included. */
export function stripFrontmatter(source: string): string {
  const m = source.match(/^[ \t]*---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
  return m ? source.slice(m[0].length) : source;
}

/** Obsidian callout line classifier (§31 "Handles callout markers").
 *  `> [!type] Title` → { kind: 'header', type, title }
 *  `> body text`     → { kind: 'body', text }
 *  null for non-callout lines and empty `>` lines. */
function parseCalloutLine(
  line: string,
): { kind: 'header'; type: string; title: string } | { kind: 'body'; text: string } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('>')) return null;
  const content = trimmed.replace(/^>\s*/, '');
  const headerMatch = content.match(/^\[!(\w+)\]\s*(.*)/);
  if (headerMatch) {
    return { kind: 'header', type: headerMatch[1], title: headerMatch[2].trim() };
  }
  if (content.trim() !== '') {
    return { kind: 'body', text: content.trim() };
  }
  return null; // empty `>` line — skip
}

/** Obsidian note → flat ExternalNode list (document order; hierarchy via `indent`).
 *  Frontmatter stripped, `[[wiki]]`/`![[embeds]]` → `see:`, `#tags` stripped,
 *  callouts (`> [!type]` + body) preserved as nodes (QA-05 F4 — no silent drop),
 *  native `- [ ]` checkboxes preserved. */
export function parseObsidian(source: string): ExternalNode[] {
  const nodes: ExternalNode[] = [];
  let calloutIndent = 0; // callout content attaches at the last bullet's level

  for (const raw of stripFrontmatter(source).split(/\r?\n/)) {
    // Callout lines (`> …`) become nodes instead of vanishing
    const callout = parseCalloutLine(raw);
    if (callout !== null) {
      if (callout.kind === 'header') {
        // `> [!note] Decision` → node "Decision" (the callout type is metadata, not content)
        const text = callout.title !== '' ? callout.title : callout.type;
        if (text !== '') {
          nodes.push({
            text, indent: calloutIndent, isTask: false, isDone: false,
            children: [], metadata: { callout: callout.type },
          });
        }
      } else {
        // `> body text` → child node under the callout header
        const text = convertWikiLinks(
          stripMetadata(convertOwnerMarkers(callout.text, 'obsidian'), 'obsidian'),
        );
        if (text !== '') {
          nodes.push({
            text, indent: calloutIndent + 1, isTask: false, isDone: false,
            children: [], metadata: {},
          });
        }
      }
      continue;
    }

    if (!/^\s*-\s/.test(raw)) continue; // bullets only
    const { isTask, isDone, clean } = parseCheckbox(raw);
    // strip #tags before link conversion so anchors (`X#Y`) are never eaten; `![[embed]]` → plain link.
    // §28 inverse: `🤖 agent-1` / `⏳ Human` come back as owner/gate arrows (QA-09 D5).
    const text = convertWikiLinks(
      stripMetadata(convertOwnerMarkers(clean.replace(/!\[\[/g, '[['), 'obsidian'), 'obsidian'),
    );
    if (!text) continue;
    calloutIndent = parseIndent(raw); // track last bullet indent for callout attachment
    nodes.push({ text, indent: parseIndent(raw), isTask, isDone, children: [], metadata: {} });
  }
  return nodes;
}

/** CANS → Obsidian: `see: X#Y` → `[[X#Y]]`, native `- [ ]`/`- [x]` checkboxes kept as-is. */
export function serializeObsidian(nodes: ExternalNode[]): string {
  const lines: string[] = [];
  const walk = (list: ExternalNode[]): void => {
    for (const n of list) {
      const box = n.isTask ? (n.isDone ? '[x] ' : '[ ] ') : '';
      lines.push('  '.repeat(n.indent) + '- ' + box + reverseWikiLinks(n.text));
      walk(n.children);
    }
  };
  walk(nodes);
  return lines.length > 0 ? lines.join('\n') + '\n' : '';
}
