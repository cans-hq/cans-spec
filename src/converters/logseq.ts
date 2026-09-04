import type { ExternalNode } from '../types';
import { convertWikiLinks, parseCheckbox, parseIndent, reverseWikiLinks, stripMetadata } from './shared';

/** Logseq page → flat ExternalNode list (document order; hierarchy via `indent`).
 *  Drops pure `key:: value` property lines, strips `((block-refs))`, `[[wiki]]` → `see:`, TODO/DONE → isTask/isDone. */
export function parseLogseq(source: string): ExternalNode[] {
  const nodes: ExternalNode[] = [];
  for (const raw of source.split(/\r?\n/)) {
    if (!/^\s*-\s/.test(raw)) continue; // logseq pages are bullets only
    const { isTask, isDone, clean } = parseCheckbox(raw);
    if (/^[\w-]+::/.test(clean)) continue; // pure property line → drop
    const text = stripMetadata(convertWikiLinks(clean.replace(/\(\([\w-]+\)\)/g, '')), 'logseq');
    if (!text) continue;
    nodes.push({ text, indent: parseIndent(raw), isTask, isDone, children: [], metadata: {} });
  }
  return nodes;
}

/** CANS → Logseq: `- [ ] t` → `- TODO t`, `- [x] t` → `- DONE t`, `see: X#Y` → `[[X#Y]]`. */
export function serializeLogseq(nodes: ExternalNode[]): string {
  const lines: string[] = [];
  const walk = (list: ExternalNode[]): void => {
    for (const n of list) {
      const marker = n.isTask ? (n.isDone ? 'DONE ' : 'TODO ') : '';
      lines.push('  '.repeat(n.indent) + '- ' + marker + reverseWikiLinks(n.text));
      walk(n.children);
    }
  };
  walk(nodes);
  return lines.length > 0 ? lines.join('\n') + '\n' : '';
}
