import type { ExternalNode } from '../types';

/** Escape the five XML entities. `&` first so output is never double-encoded. */
export function encodeXmlEntity(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Inverse of encodeXmlEntity. `&amp;` last so `&amp;lt;` decodes to literal `&lt;`. */
export function decodeXmlEntity(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

function readAttr(attrs: string, name: string): string | undefined {
  const m =
    attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`, 'i')) ??
    attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*'([^']*)'`, 'i'));
  return m ? m[1] : undefined;
}

/** §31: OPML is XML — reject non-OPML input with a real diagnosis instead of
 *  silently returning an empty outline (QA-05 F12). Regex-based strictness,
 *  no XML parser dependency: root element must exist and outline tags must
 *  balance. Throws Error with an `invalid OPML: …` message. */
function assertOpml(source: string): void {
  if (!/<opml[\s>]/i.test(source)) {
    throw new Error('invalid OPML: missing <opml> root element (not XML)');
  }
  if (!/<opml\b[^>]*>[\s\S]*<\/opml\s*>/i.test(source)) {
    throw new Error('invalid OPML: <opml> element is not closed');
  }
  const opens = (source.match(/<outline\b(?![^>]*\/\s*>)[^>]*>/gi) ?? []).length;
  const closes = (source.match(/<\/outline\s*>/gi) ?? []).length;
  if (opens !== closes) {
    throw new Error(`invalid OPML: unbalanced <outline> tags (${opens} opened, ${closes} closed)`);
  }
}

/** Regex-based OPML walk: top level = outlines directly under `<body>`; nesting from tag structure.
 *  Throws on non-OPML / malformed XML input (see assertOpml). */
export function parseOpml(source: string): ExternalNode[] {
  assertOpml(source);
  const body = source.match(/<body[^>]*>([\s\S]*?)<\/body\s*>/i);
  const region = body ? body[1] : source;
  const roots: ExternalNode[] = [];
  const stack: ExternalNode[] = [];
  const tag = /<outline\b[^>]*>|<\/outline\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(region)) !== null) {
    if (m[0][1] === '/') {
      stack.pop();
      continue;
    }
    const selfClosing = /\/\s*>$/.test(m[0]);
    const inner = m[0].slice(8, -1);
    const node: ExternalNode = {
      text: decodeXmlEntity(readAttr(inner, 'text') ?? ''),
      indent: stack.length,
      isTask: false,
      isDone: false,
      children: [],
      metadata: {},
    };
    const note = readAttr(inner, '_note') ?? readAttr(inner, 'note');
    if (note !== undefined) node.metadata.note = decodeXmlEntity(note);
    (stack.length > 0 ? stack[stack.length - 1].children : roots).push(node);
    if (!selfClosing) stack.push(node);
  }
  return roots;
}

/** Accept a tree (children) or a flat indent-based list; rebuild a proper tree for tag nesting. */
function normalizeTree(nodes: ExternalNode[]): ExternalNode[] {
  const flat: ExternalNode[] = [];
  const dfs = (list: ExternalNode[]): void => {
    for (const n of list) {
      flat.push(n);
      dfs(n.children);
    }
  };
  dfs(nodes);
  const roots: ExternalNode[] = [];
  const stack: ExternalNode[] = [];
  for (const n of flat) {
    const node: ExternalNode = { ...n, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].indent >= node.indent) stack.pop();
    (stack.length > 0 ? stack[stack.length - 1].children : roots).push(node);
    stack.push(node);
  }
  return roots;
}

/** ExternalNode tree → valid OPML 2.0 document (leaves self-close, parents pair). */
export function serializeOpml(nodes: ExternalNode[], title: string): string {
  const outline = (n: ExternalNode, depth: number): string => {
    const pad = '  '.repeat(depth);
    const note = n.metadata?.note;
    // §28: checkbox state survives the round-trip (`- [ ] task` → `- [ ] task` in text)
    const textContent = n.isTask ? (n.isDone ? '[x] ' : '[ ] ') + n.text : n.text;
    const attrs = `text="${encodeXmlEntity(textContent)}"${note !== undefined ? ` _note="${encodeXmlEntity(note)}"` : ''}`;
    if (n.children.length === 0) return `${pad}<outline ${attrs}/>\n`;
    return `${pad}<outline ${attrs}>\n${n.children.map((c) => outline(c, depth + 1)).join('')}${pad}</outline>\n`;
  };
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n` +
    `<head><title>${encodeXmlEntity(title)}</title></head>\n<body>\n` +
    normalizeTree(nodes)
      .map((n) => outline(n, 1))
      .join('') +
    `</body>\n</opml>\n`
  );
}
