import type { ExternalNode } from '../types';

/** Leading whitespace → indent units. 2 spaces per level; each tab counts as 2 spaces. */
export function parseIndent(raw: string): number {
  let spaces = 0;
  for (const ch of raw) {
    if (ch === ' ') spaces += 1;
    else if (ch === '\t') spaces += 2;
    else break;
  }
  return Math.floor(spaces / 2);
}

/** Input includes the leading `- ` prefix. `- [ ]`/`- [x]`/`- [X]` and TODO/DOING/DONE markers. */
export function parseCheckbox(text: string): { isTask: boolean; isDone: boolean; clean: string } {
  const s = text.replace(/^\s*-\s+/, '');
  const box = s.match(/^\[([ xX])\]\s?/);
  if (box) return { isTask: true, isDone: box[1] !== ' ', clean: s.slice(box[0].length).trim() };
  const kw = s.match(/^(TODO|DOING|DONE)\b\s?/);
  if (kw) return { isTask: true, isDone: kw[1] === 'DONE', clean: s.slice(kw[0].length).trim() };
  return { isTask: false, isDone: false, clean: s };
}

/** `[[X]]` → `see: X`; `[[X#Y]]` → `see: X#Y`; labels (`|label`) are discarded. */
export function convertWikiLinks(text: string): string {
  return text.replace(
    /\[\[([^[\]|#]*)(?:#([^[\]|#]*))?(?:\|[^[\]]*)?\]\]/g,
    (_m, page: string, anchor?: string) => `see: ${anchor ? `${page}#${anchor}` : page}`
  );
}

/** Inverse of convertWikiLinks: `see: X#Y` → `[[X#Y]]`. */
export function reverseWikiLinks(text: string): string {
  return text.replace(/\bsee:\s+([^\s]+)/g, (_m, target: string) => `[[${target}]]`);
}

/** Remove app cruft: logseq `key:: value` props, dynalist `^block-ids`, obsidian `#tags`, `*`/`_` emphasis. */
export function stripMetadata(text: string, format: string): string {
  const f = format.toLowerCase();
  const lenient = f !== 'logseq' && f !== 'opml' && f !== 'dynalist' && f !== 'obsidian';
  let s = text;
  if (f === 'logseq' || lenient) s = s.replace(/\s*[\w-]+::(?:\s.*|$)/g, '');
  if (f === 'opml' || f === 'dynalist' || lenient) s = s.replace(/(?:\s*\^[\w-]+)+$/g, '');
  if (f === 'obsidian' || f === 'dynalist' || lenient) s = s.replace(/(^|\s)#[\w/-]+/g, '$1');
  s = s
    .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1');
  return s.replace(/\s{2,}/g, ' ').trim();
}

/** ExternalNode tree → CANS markdown bullets. DFS; each node at `'  '.repeat(node.indent)`. */
export function serializeToCans(nodes: ExternalNode[]): string {
  const lines: string[] = [];
  const walk = (list: ExternalNode[]): void => {
    for (const n of list) {
      const box = n.isTask ? (n.isDone ? '[x] ' : '[ ] ') : '';
      lines.push('  '.repeat(n.indent) + '- ' + box + n.text);
      walk(n.children);
    }
  };
  walk(nodes);
  return lines.length > 0 ? lines.join('\n') + '\n' : '';
}

/** CANS markdown → ExternalNode tree (reverse of serializeToCans; stack-attach by indent). */
export function parseFromCans(source: string): ExternalNode[] {
  const roots: ExternalNode[] = [];
  const stack: ExternalNode[] = [];
  for (const raw of source.split(/\r?\n/)) {
    const m = raw.match(/^\s*-\s+(.*)$/);
    if (!m) continue;
    const { isTask, isDone, clean } = parseCheckbox(raw);
    const node: ExternalNode = { text: clean, indent: parseIndent(raw), isTask, isDone, children: [], metadata: {} };
    while (stack.length > 0 && stack[stack.length - 1].indent >= node.indent) stack.pop();
    (stack.length > 0 ? stack[stack.length - 1].children : roots).push(node);
    stack.push(node);
  }
  return roots;
}
