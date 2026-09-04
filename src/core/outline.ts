import type { OutlineNode, BackPointer, RefTarget } from '../types';

const BULLET_RE = /^(\s*)-\s+(.*)$/;
const CHECKBOX_RE = /^\[( |x|X)\]\s+/;
const OWNER_RE = /←\s*(@?\S+)/;
const REF_RE = /see:?\s+([^\s#]+)(?:#([^\s#]+))?/g;
const REF_BY_RE = /<!--\s*ref-by:\s*(.*?)\s*-->/;
const FENCE_RE = /^```/;

/** Parse markdown bullet outline into an OutlineNode tree.
 *  Indentation unit: 2 spaces (hardcoded). Tabs rejected.
 *  Non-bullet lines ignored (prose, headings, blanks are for humans only). */
export function parseOutline(source: string, file: string): OutlineNode[] {
  const lines = source.split('\n');
  for (const line of lines) {
    if (line.startsWith('\t')) {
      throw new Error(`${file}: tab indentation rejected (use 2 spaces)`);
    }
  }

  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = []; // stack[i] = most recent node at indent i
  let lastNode: OutlineNode | null = null;
  let fenceOpen = false;
  let fenceStartLine = 0;
  let fencePending = false; // saw a fence; mark next close
  let tableRunOpen = false;

  const makeNode = (text: string, line: number, indent: number): OutlineNode => ({
    text,
    line,
    indent,
    children: [],
    file,
    isTask: false,
    isDone: false,
    owner: null,
    isHumanGate: false,
    refs: [],
    hasCodeFence: false,
    hasTable: false,
  });

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNo = i + 1;

    // Code fence toggling: fence content is overflow, never bullets.
    if (FENCE_RE.test(raw.trimEnd()) && raw.trim() !== '```' + '') {
      // treat any line whose trimmed form starts with ``` as a fence marker
    }
    if (raw.trim().startsWith('```')) {
      if (!fenceOpen) {
        fenceOpen = true;
        fenceStartLine = lineNo;
        fencePending = true;
      } else {
        fenceOpen = false;
        // attach fence flag to last node, or synthesize a node for fence-only files
        if (lastNode) {
          lastNode.hasCodeFence = true;
        } else {
          const n = makeNode('(code fence)', fenceStartLine, 0);
          n.hasCodeFence = true;
          roots.push(n);
          stack.length = 0;
          stack.push(n);
          lastNode = n;
        }
      }
      continue;
    }
    if (fenceOpen) continue; // inside fence: ignore

    // Table rows: runs of consecutive `| ... |` lines
    if (raw.trim().startsWith('|')) {
      if (!tableRunOpen) {
        tableRunOpen = true;
        if (lastNode) {
          lastNode.hasTable = true;
        } else {
          const n = makeNode('(table)', lineNo, 0);
          n.hasTable = true;
          roots.push(n);
          stack.length = 0;
          stack.push(n);
          lastNode = n;
        }
      }
      continue;
    }
    tableRunOpen = false;

    const m = raw.match(BULLET_RE);
    if (!m) continue; // prose / heading / blank — humans only

    const leading = m[1];
    const indent = Math.floor(leading.length / 2);
    let rest = m[2];

    // strip back-pointer comments from text (metadata, not spec)
    rest = rest.replace(REF_BY_RE, '').trim();

    // checkbox
    let isTask = false;
    let isDone = false;
    const cb = rest.match(CHECKBOX_RE);
    if (cb) {
      isTask = true;
      isDone = cb[1].toLowerCase() === 'x';
      rest = rest.slice(cb[0].length).trim();
    }

    // owner arrow
    const ownerMatch = rest.match(OWNER_RE);
    const owner = ownerMatch ? ownerMatch[1] : null;

    // see: references (both "see: X" and "see X" forms)
    const refs: RefTarget[] = [];
    let rm: RegExpExecArray | null;
    REF_RE.lastIndex = 0;
    while ((rm = REF_RE.exec(rest)) !== null) {
      refs.push({ raw: rm[0], file: rm[1], anchor: rm[2] ?? null, line: lineNo });
    }

    const node = makeNode(rest, lineNo, indent);
    node.isTask = isTask;
    node.isDone = isDone;
    node.owner = owner;
    node.isHumanGate = owner === '@human';
    node.refs = refs;

    // stack-based attachment
    if (stack.length === 0) {
      roots.push(node);
      stack.push(node);
    } else {
      const top = stack[stack.length - 1];
      if (indent === top.indent) {
        // sibling of top
        stack.pop();
        const parent = stack[stack.length - 1];
        if (parent) parent.children.push(node);
        else roots.push(node);
        stack.push(node);
      } else if (indent > top.indent) {
        top.children.push(node);
        stack.push(node);
      } else {
        // shallower: pop until we find the parent level
        while (stack.length > 1 && stack[stack.length - 1].indent > indent) {
          stack.pop();
        }
        const candidate = stack[stack.length - 1];
        if (candidate.indent === indent) {
          stack.pop();
          const parent = stack[stack.length - 1];
          if (parent) parent.children.push(node);
          else roots.push(node);
          stack.push(node);
        } else {
          // indented jump deeper than expected under candidate
          candidate.children.push(node);
          stack.push(node);
        }
      }
    }
    lastNode = node;
  }
  void fencePending;
  return roots;
}

export function flattenNodes(nodes: OutlineNode[]): OutlineNode[] {
  const out: OutlineNode[] = [];
  const walk = (ns: OutlineNode[]): void => {
    for (const n of ns) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

export function extractBackPointers(source: string, file: string): BackPointer[] {
  const out: BackPointer[] = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(REF_BY_RE);
    if (!m) continue;
    const entries = m[1].split(',').map(s => s.trim()).filter(Boolean);
    for (const e of entries) {
      out.push({ fromFile: e, fromLine: i + 1, toFile: file, toAnchor: null });
    }
  }
  return out;
}

export function countNodes(nodes: OutlineNode[]): number {
  return flattenNodes(nodes).length;
}

export function maxDepth(nodes: OutlineNode[]): number {
  let max = 0;
  const walk = (ns: OutlineNode[]): void => {
    for (const n of ns) {
      if (n.indent > max) max = n.indent;
      walk(n.children);
    }
  };
  walk(nodes);
  return max;
}
