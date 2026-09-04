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

/** A fenced code block extracted during import into an overflow file (§27). */
export interface OverflowExtraction {
  /** Overflow file path relative to the workspace (e.g. `cb-note/request-schema.json`). */
  overflowFile: string;
  /** The raw fenced body. */
  content: string;
  /** The bullet text the fence hung under. */
  parentText: string;
}

/** `[[X]]` → `see: X`; `[[X#Y]]` → `see: X#Y`; labels (`|label`) are discarded.
 *  Mechanical format translation only — the importer canonicalizes spec-slug
 *  targets to the §4 `.md` form when writing workspace files (QA-05 F2).
 *  Same-line whitespace right after the link is consumed and re-emitted as a
 *  single separator, keeping the ref token clean and trailing prose as node
 *  content (QA-05 F3). Newlines are never consumed. */
export function convertWikiLinks(text: string): string {
  return text.replace(
    /\[\[([^[\]|#]*)(?:#([^[\]|#]*))?(?:\|[^[\]]*)?\]\]([ \t]*)/g,
    (_m, page: string, anchor: string | undefined, trail: string) => {
      const ref = anchor ? `see: ${page}#${anchor}` : `see: ${page}`;
      return trail.length > 0 ? `${ref} ` : ref;
    }
  );
}

/** Inverse of convertWikiLinks: `see: X.md#Y` → `[[X#Y]]` (`.md` stripped for wiki form). */
export function reverseWikiLinks(text: string): string {
  return text.replace(/\bsee:\s+([^\s]+)/g, (_m, target: string) => {
    const cleaned = target.replace(/\.md(?=#|$)/, '');
    return `[[${cleaned}]]`;
  });
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
      // §31: OPML `_note` content is spec content — emit as indented child nodes.
      if (n.metadata?.note !== undefined && n.metadata.note !== '') {
        for (const nl of n.metadata.note.split('\n')) {
          if (nl.trim() === '') continue;
          lines.push('  '.repeat(n.indent + 1) + '- ' + nl.trim());
        }
      }
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

function slugFor(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** §27 "Extract code blocks → overflow files": fenced blocks under bullets are
 *  overflow, never inline spec content. Each fence is extracted to
 *  `<baseSlug>/<node-slug>.<ext>` and replaced by a `see:` reference on the
 *  owning bullet (QA-05 F5 — fenced content must survive import).
 *  Returns the cleaned bullet source plus the extractions to write. */
export function extractOverflowContent(
  source: string,
  baseSlug: string,
): { cleanedSource: string; extractions: OverflowExtraction[] } {
  const lines = source.split(/\r?\n/);
  const outLines: string[] = [];
  const extractions: OverflowExtraction[] = [];
  let inFence = false;
  let fenceLang = '';
  let fenceBody: string[] = [];
  let lastBulletText = '';
  let lastBulletIdx = -1; // index of the last bullet line within outLines
  let fenceDirectlyUnderBullet = false;
  let extractionIndex = 0;

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (!inFence) {
        inFence = true;
        fenceLang = line.trim().slice(3).trim();
        fenceBody = [];
        fenceDirectlyUnderBullet = lastBulletIdx >= 0 && lastBulletIdx === outLines.length - 1;
      } else {
        // End of fence → extract body to an overflow file, reference via see:
        inFence = false;
        const ext = fenceLang !== '' ? fenceLang : 'md';
        const slug = lastBulletText !== '' ? slugFor(lastBulletText) : `block-${extractionIndex}`;
        const overflowFile = `${baseSlug}/${slug}.${ext}`;
        extractions.push({
          overflowFile,
          content: fenceBody.join('\n'),
          parentText: lastBulletText,
        });
        const replaceIdx = fenceDirectlyUnderBullet ? lastBulletIdx : -1;
        const anchorLine = replaceIdx >= 0 ? outLines[replaceIdx] : (outLines[outLines.length - 1] ?? '');
        const indent = anchorLine.match(/^\s*/)?.[0] ?? '';
        const refLine = `${indent}- ${lastBulletText}: see ${overflowFile}`;
        if (replaceIdx >= 0) outLines[replaceIdx] = refLine;
        else outLines.push(refLine);
        lastBulletText = `${lastBulletText}: see ${overflowFile}`;
        lastBulletIdx = replaceIdx >= 0 ? replaceIdx : outLines.length - 1;
        extractionIndex++;
      }
      continue;
    }
    if (inFence) {
      fenceBody.push(line);
      continue;
    }
    const bulletMatch = line.match(/^\s*-\s+(.*)/);
    if (bulletMatch) {
      lastBulletText = bulletMatch[1].trim();
      lastBulletIdx = outLines.length;
    }
    outLines.push(line);
  }

  return { cleanedSource: outLines.join('\n'), extractions };
}
