import type { ExternalNode } from '../types';
import { convertWikiLinks, parseCheckbox, parseIndent, reverseWikiLinks, stripMetadata } from './shared';

/** Remove a leading YAML frontmatter block (`---` fences at very top), fences included. */
export function stripFrontmatter(source: string): string {
  const m = source.match(/^[ \t]*---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
  return m ? source.slice(m[0].length) : source;
}

/** Obsidian note → flat ExternalNode list (document order; hierarchy via `indent`).
 *  Frontmatter stripped, `[[wiki]]`/`![[embeds]]` → `see:`, `#tags` stripped, callouts (`> …`) ignored,
 *  native `- [ ]` checkboxes preserved. */
export function parseObsidian(source: string): ExternalNode[] {
  const nodes: ExternalNode[] = [];
  for (const raw of stripFrontmatter(source).split(/\r?\n/)) {
    if (!/^\s*-\s/.test(raw)) continue; // bullets only; callout/quote lines (`> …`) fall through
    const { isTask, isDone, clean } = parseCheckbox(raw);
    // strip #tags before link conversion so anchors (`X#Y`) are never eaten; `![[embed]]` → plain link
    const text = convertWikiLinks(stripMetadata(clean.replace(/!\[\[/g, '[['), 'obsidian'));
    if (!text) continue;
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
