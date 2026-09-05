import type { ExternalNode } from '../types';
import {
  convertOwnerMarkers, convertWikiLinks, logseqSlashLinks, parseCheckbox,
  parseIndent, reverseWikiLinks, stripMetadata,
} from './shared';

/** Logseq page → flat ExternalNode list (document order; hierarchy via `indent`).
 *  Drops pure `key:: value` property lines (keys may contain spaces — only `::`
 *  marks the property, QA-08 E11), strips `((block-refs))`, `[[wiki]]` → `see:`
 *  (with `[[X/Y]]` → `see: X.md#Y` per §28, QA-09 D8), TODO/DONE → isTask/isDone,
 *  `⏳ Human` → `← @human` (QA-09 D5). */
export function parseLogseq(source: string): ExternalNode[] {
  const nodes: ExternalNode[] = [];
  for (const raw of source.split(/\r?\n/)) {
    if (!/^\s*-\s/.test(raw)) continue; // logseq pages are bullets only
    const { isTask, isDone, clean } = parseCheckbox(raw);
    if (/^[\w\s-]+::/.test(clean)) continue; // pure property line → drop
    const text = stripMetadata(
      convertWikiLinks(
        convertOwnerMarkers(logseqSlashLinks(clean.replace(/\(\([\w-]+\)\)/g, '')), 'logseq'),
      ),
      'logseq',
    );
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
