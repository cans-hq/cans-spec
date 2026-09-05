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

/** `[[X]]` → `see: X.md`; `[[X#Y]]` → `see: X.md#Y`; labels (`|label`) are discarded.
 *  §4/§27 canonical ref form carries the `.md` suffix — a `.md`-less target is a
 *  guaranteed broken ref (QA-08 E7). Pages that already name a file with an
 *  extension (attachments, `X.md`) are kept verbatim. Same-line whitespace right
 *  after the link is consumed and re-emitted as a single separator, keeping the
 *  ref token clean and trailing prose as node content (QA-05 F3). Newlines are
 *  never consumed. */
export function convertWikiLinks(text: string): string {
  return text.replace(
    /\[\[([^[\]|#]*)(?:#([^[\]|#]*))?(?:\|[^[\]]*)?\]\]([ \t]*)/g,
    (_m, page: string, anchor: string | undefined, trail: string) => {
      const target = /\.[A-Za-z0-9]{1,8}$/.test(page) ? page : `${page}.md`;
      const ref = anchor ? `see: ${target}#${anchor}` : `see: ${target}`;
      return trail.length > 0 ? `${ref} ` : ref;
    }
  );
}

/** Logseq `[[Page/Anchor]]` is the §28 export encoding of CANS `see: Page.md#Anchor`.
 *  Rewrite it to `[[Page#Anchor]]` — splitting on the FIRST `/` so `[[X/Y]]` becomes
 *  page `X`, anchor `Y` — before the generic wiki-link conversion runs (QA-09 D8:
 *  the slashed form must never leak into the workspace as the dead ref
 *  `see: X/Y.md`). Plain page links without a slash are untouched. */
export function logseqSlashLinks(text: string): string {
  return text.replace(
    /\[\[([^[\]|#/]+)\/([^[\]|]+?)\]\]/g,
    (_m, page: string, anchor: string) => `[[${page}#${anchor.trim()}]]`,
  );
}

/** §28 import inverse for owner/gate markers (QA-09 D5): external task-state
 *  emoji must come back as CANS owner arrows, or round-trips destroy
 *  owner/gate state. Obsidian: `🤖 agent-1` → `← agent-1`, `⏳ Human` → `← @human`.
 *  Logseq shares the human-gate row: `⏳ Human` → `← @human`. */
export function convertOwnerMarkers(text: string, format: string): string {
  const f = format.toLowerCase();
  let s = text;
  if (f === 'obsidian') {
    s = s.replace(/🤖\s*(\S+)/g, '← $1');
  }
  if (f === 'obsidian' || f === 'logseq') {
    s = s.replace(/⏳\s*Human/i, '← @human');
  }
  return s;
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

/** §27 "Extract code blocks → overflow files" (§16: extracted to a separate file
 *  and referenced via see:). A proper fence state machine — every fence shape
 *  that appears in imported outline notes is handled, and NO line is ever
 *  silently dropped (QA-08 E9 / QA-05 F4+F5):
 *    - plain fence lines (    ```json … ```) hanging under a bullet,
 *    - fence-as-bullet (`  - ```python … ```) used by Obsidian/Logseq notes,
 *    - interior lines at any indentation, closing fences at any indentation,
 *    - unterminated fences at EOF (flushed, not swallowed).
 *  Each fence is extracted to `<baseSlug>/<node-slug>.<ext>` and replaced by a
 *  `see:` reference node, so the fence's presence survives and content AFTER
 *  the closing fence keeps parsing as normal bullets. Returns the cleaned
 *  bullet source plus the extractions to write. */
export function extractOverflowContent(
  source: string,
  baseSlug: string,
): { cleanedSource: string; extractions: OverflowExtraction[] } {
  const lines = source.split(/\r?\n/);
  const outLines: string[] = [];
  const extractions: OverflowExtraction[] = [];
  const usedNames = new Set<string>();

  let inFence = false;
  let fenceLang = '';
  let fenceBody: string[] = [];
  let fenceAsBullet = false;  // fence opened on a `- ```lang` bullet line
  let fenceBulletIndent = ''; // indent of that bullet line
  let lastBulletText = '';    // text of the last bullet seen outside fences
  let lastBulletIdx = -1;     // index of that bullet within outLines
  let extractionIndex = 0;

  /** Overflow paths are workspace-relative and collision-free (two fences under
   *  the same bullet must never overwrite each other's extraction). */
  const uniqueOverflowFile = (slug: string, ext: string): string => {
    let name = `${baseSlug}/${slug}.${ext}`;
    let n = 2;
    while (usedNames.has(name)) name = `${baseSlug}/${slug}-${n++}.${ext}`;
    usedNames.add(name);
    return name;
  };

  /** Close the open fence: extract the body to an overflow file and leave a
   *  `see:` reference where the fence hung. */
  const closeFence = (): void => {
    // Sanitize the fence language into a safe file extension: plain
    // alphanumerics only (a crafted fence like ``` ../../../evil must
    // never escape the workspace overflow directory).
    const rawExt = fenceLang !== '' ? fenceLang : 'md';
    const ext = /^[A-Za-z0-9]{1,12}$/.test(rawExt) ? rawExt : 'md';
    const slug = lastBulletText !== '' ? slugFor(lastBulletText) : `block-${extractionIndex}`;
    const overflowFile = uniqueOverflowFile(slug, ext);
    extractions.push({
      overflowFile,
      content: fenceBody.join('\n'),
      parentText: lastBulletText,
    });
    if (fenceAsBullet) {
      // The fence was itself a bullet → that bullet becomes the see: reference
      // node, at the fence bullet's own indent (hierarchy preserved).
      outLines.push(`${fenceBulletIndent}- see ${overflowFile}`);
    } else if (lastBulletIdx >= 0 && lastBulletIdx === outLines.length - 1) {
      // Fence hangs directly under the last bullet → reference replaces it.
      const indent = outLines[lastBulletIdx].match(/^\s*/)?.[0] ?? '';
      outLines[lastBulletIdx] = `${indent}- ${lastBulletText}: see ${overflowFile}`;
    } else {
      // Fence detached from any bullet → reference after the block.
      const anchorLine = outLines[outLines.length - 1] ?? '';
      const indent = anchorLine.match(/^\s*/)?.[0] ?? '';
      const label = lastBulletText !== '' ? `${lastBulletText}: ` : '';
      outLines.push(`${indent}- ${label}see ${overflowFile}`);
    }
    // A following fence must never clobber the reference just written.
    lastBulletIdx = -1;
    extractionIndex++;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (inFence) {
      if (/^`{3,}\s*$/.test(trimmed)) {
        closeFence();
        inFence = false;
        fenceBody = [];
      } else {
        fenceBody.push(line);
      }
      continue;
    }
    // Fence-as-bullet: `- ```lang` — the fence line is itself an outline bullet.
    const bulletFence = line.match(/^(\s*)-\s+(`{3,}.*)$/);
    if (bulletFence !== null) {
      inFence = true;
      fenceAsBullet = true;
      fenceBulletIndent = bulletFence[1] ?? '';
      fenceLang = (bulletFence[2] ?? '').slice(3).trim();
      fenceBody = [];
      continue;
    }
    // Plain fence line (possibly indented).
    if (trimmed.startsWith('```')) {
      inFence = true;
      fenceAsBullet = false;
      fenceLang = trimmed.slice(3).trim();
      fenceBody = [];
      continue;
    }
    const bulletMatch = line.match(/^\s*-\s+(.*)/);
    if (bulletMatch) {
      lastBulletText = bulletMatch[1].trim();
      lastBulletIdx = outLines.length;
    }
    outLines.push(line);
  }
  if (inFence) {
    // Unterminated fence at EOF: flush the extraction rather than dropping it.
    closeFence();
  }

  return { cleanedSource: outLines.join('\n'), extractions };
}
