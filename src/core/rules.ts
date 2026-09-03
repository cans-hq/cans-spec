import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Rules } from '../types';

interface YLine {
  lineNo: number;
  indent: number;
  text: string;
}

const NUM_RE = /^[+-]?\d+(?:\.\d+)?$/;

function stripComment(raw: string): string {
  let sq = false;
  let dq = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === "'" && !dq) sq = !sq;
    else if (c === '"' && !sq) dq = !dq;
    else if (c === '#' && !sq && !dq && (i === 0 || raw[i - 1] === ' ' || raw[i - 1] === '\t')) {
      return raw.slice(0, i);
    }
  }
  return raw;
}

function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let sq = false;
  let dq = false;
  let cur = '';
  for (const c of s) {
    if (c === "'" && !dq) sq = !sq;
    else if (c === '"' && !sq) dq = !dq;
    else if (!sq && !dq) {
      if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') depth--;
      else if (c === sep && depth === 0) {
        parts.push(cur);
        cur = '';
        continue;
      }
    }
    cur += c;
  }
  if (cur.trim() !== '') parts.push(cur);
  return parts;
}

function scalar(s: string, lineNo: number): string | number | boolean {
  const t = s.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (NUM_RE.test(t)) return Number(t);
  if (t.length >= 2) {
    const first = t[0];
    const last = t[t.length - 1];
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      return t.slice(1, -1);
    }
  }
  if (t.includes(':')) {
    throw new Error(`line ${lineNo}: malformed value (unexpected ':'): ${t}`);
  }
  return t;
}

function parseInlineObject(s: string, lineNo: number): Record<string, unknown> {
  const inner = s.trim().slice(1, -1);
  const out: Record<string, unknown> = {};
  for (const part of splitTopLevel(inner, ',')) {
    if (part.trim() === '') continue;
    const idx = part.indexOf(':');
    if (idx < 1) throw new Error(`line ${lineNo}: malformed inline object entry: ${part.trim()}`);
    const key = part.slice(0, idx).trim();
    const rawVal = part.slice(idx + 1).trim();
    if (rawVal === '') throw new Error(`line ${lineNo}: missing value for key '${key}'`);
    out[key] = parseInlineValue(rawVal, lineNo);
  }
  return out;
}

function parseInlineArray(s: string, lineNo: number): unknown[] {
  const inner = s.trim().slice(1, -1);
  const out: unknown[] = [];
  for (const part of splitTopLevel(inner, ',')) {
    if (part.trim() === '') continue;
    out.push(parseInlineValue(part.trim(), lineNo));
  }
  return out;
}

function parseInlineValue(s: string, lineNo: number): unknown {
  const t = s.trim();
  if (t.startsWith('{')) {
    if (!t.endsWith('}')) throw new Error(`line ${lineNo}: unbalanced inline object: ${t}`);
    return parseInlineObject(t, lineNo);
  }
  if (t.startsWith('[')) {
    if (!t.endsWith(']')) throw new Error(`line ${lineNo}: unbalanced inline array: ${t}`);
    return parseInlineArray(t, lineNo);
  }
  return scalar(t, lineNo);
}

function isItem(text: string): boolean {
  return text === '-' || text.startsWith('- ');
}

/** Minimal YAML subset parser: 2-space nested objects, inline objects/arrays,
 *  block arrays (`- item`, items may be inline arrays), scalars, comments. */
export function parseMinimalYaml(source: string): Record<string, unknown> {
  const lines: YLine[] = [];
  const rawLines = source.split('\n');
  for (let i = 0; i < rawLines.length; i++) {
    const stripped = stripComment(rawLines[i]);
    if (stripped.trim() === '') continue;
    const indent = stripped.length - stripped.trimStart().length;
    lines.push({ lineNo: i + 1, indent: Math.floor(indent / 2), text: stripped.trim() });
  }

  let pos = 0;

  const parseMap = (indent: number): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    while (pos < lines.length && lines[pos].indent >= indent) {
      const ln = lines[pos];
      if (ln.indent > indent) throw new Error(`line ${ln.lineNo}: unexpected indentation`);
      if (isItem(ln.text)) throw new Error(`line ${ln.lineNo}: list item outside array context`);
      const m = ln.text.match(/^([^:\s]+):\s*(.*)$/);
      if (!m) throw new Error(`line ${ln.lineNo}: malformed line: ${ln.text}`);
      const key = m[1];
      const rest = m[2].trim();
      if (rest === '') {
        pos++;
        const next = pos < lines.length ? lines[pos] : undefined;
        if (
          next &&
          (next.indent > indent || (next.indent === indent && isItem(next.text)))
        ) {
          out[key] = isItem(next.text) ? parseArray(next.indent) : parseMap(next.indent);
        } else {
          out[key] = null;
        }
      } else {
        out[key] = parseInlineValue(rest, ln.lineNo);
        pos++;
      }
    }
    return out;
  };

  const parseArray = (indent: number): unknown[] => {
    const out: unknown[] = [];
    while (pos < lines.length && lines[pos].indent === indent && isItem(lines[pos].text)) {
      const ln = lines[pos];
      const item = ln.text === '-' ? '' : ln.text.slice(2).trim();
      if (item === '') {
        pos++;
        const next = pos < lines.length ? lines[pos] : undefined;
        if (next && next.indent > indent) {
          out.push(isItem(next.text) ? parseArray(next.indent) : parseMap(next.indent));
        } else {
          out.push(null);
        }
      } else {
        out.push(parseInlineValue(item, ln.lineNo));
        pos++;
      }
    }
    return out;
  };

  if (lines.length === 0) return {};
  if (lines[0].indent !== 0) throw new Error(`line ${lines[0].lineNo}: unexpected indentation`);
  const result = parseMap(0);
  if (pos < lines.length) {
    throw new Error(`line ${lines[pos].lineNo}: unexpected content: ${lines[pos].text}`);
  }
  return result;
}

export function defaultRules(): Rules {
  return {
    structure: {
      node_length: { min: 3, max: 120 },
      siblings: { min: 1, max: 12 },
      depth: { min: 1, max: 5 },
      single_child_collapse: true,
      empty_nodes: false,
    },
    style: {
      prefer: 'sibling',
      force_nested_above: 6,
      force_sibling_below: 3,
      shared_prefix_detection: true,
    },
    content: { tbd_allowed: true, max_tbd_per_file: 5 },
    references: {
      mode: 'pointer',
      back_pointers: true,
      max_hops: 1,
      orphan_check: true,
      duplicate_home_check: true,
    },
    redundancy: {
      enabled: true,
      word_frequency_threshold: 4,
      phrase_overlap_threshold: 0.7,
      cross_file_threshold: 2,
      stopwords: ['the', 'a', 'an', 'of', 'to', 'in', 'for', 'and', 'or', 'with', 'must', 'shall', 'requires'],
      synonyms: [
        ['postgres', 'postgresql', 'pg'],
        ['api', 'endpoint', 'route'],
        ['frontend', 'client', 'ui'],
        ['db', 'database', 'storage'],
      ],
    },
    token_budget: {
      enabled: true,
      default_limit: 4096,
      estimate_chars_per_token: 3.5,
      warn_threshold: 0.8,
    },
    overflow: { max_node_chars: 200, force_file_for: ['code_block', 'table', 'diagram'] },
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge(base: unknown, over: unknown): unknown {
  if (isPlainObject(base) && isPlainObject(over)) {
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(over)) {
      out[k] = deepMerge(base[k], v);
    }
    return out;
  }
  return over === undefined ? base : over;
}

/** Load rules from `<root>/_rules.yaml` deep-merged over defaults.
 *  Missing file → defaults. Invalid YAML → Error with line number. */
export function loadRules(root: string): Rules {
  const p = join(root, '_rules.yaml');
  if (!existsSync(p)) return defaultRules();
  const source = readFileSync(p, 'utf-8');
  const parsed = parseMinimalYaml(source);
  return deepMerge(defaultRules(), parsed) as Rules;
}
