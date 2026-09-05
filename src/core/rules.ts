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

/** Normalize CRLF (Windows) and lone-CR (classic Mac) line terminators to \n.
 *  Same read/split-boundary normalization as outline.ts — user-authored config
 *  must parse identically on every platform (§45). */
function normalizeEol(source: string): string {
  return source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** Minimal YAML subset parser: 2-space nested objects, inline objects/arrays,
 *  block arrays (`- item`, items may be inline arrays), scalars, comments. */
export function parseMinimalYaml(source: string): Record<string, unknown> {
  const lines: YLine[] = [];
  const rawLines = normalizeEol(source).split('\n');
  for (let i = 0; i < rawLines.length; i++) {
    // §18: invalid YAML = line-numbered error. YAML forbids tab indentation.
    const leadWs = rawLines[i].match(/^[\t ]*/);
    if (leadWs !== null && leadWs[0].includes('\t')) {
      throw new Error(`line ${i + 1}: tab indentation (use 2 spaces)`);
    }
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

/** 1-based line number where a top-level `key:` is defined in the raw source (0 when absent). */
function topLevelKeyLine(source: string, key: string): number {
  const rawLines = normalizeEol(source).split('\n');
  for (let i = 0; i < rawLines.length; i++) {
    const m = rawLines[i].match(/^([A-Za-z0-9_-]+):/);
    if (m !== null && m[1] === key) return i + 1;
  }
  return 0;
}

/** Validate that the merged rules object has the expected top-level shape.
 *  Catches values like `structure: 42` or empty sections that parse without
 *  YAML syntax errors but produce type-inconsistent rules (§18: invalid config
 *  = line-numbered `_rules.yaml` error, exit 1 — never an internal crash). */
function validateRulesShape(merged: Record<string, unknown>, source: string): void {
  const sections: Array<[string, string[]]> = [
    ['structure', ['node_length', 'siblings', 'depth']],
    ['style', ['prefer', 'force_nested_above', 'force_sibling_below']],
    ['content', ['tbd_allowed']],
    ['references', ['mode', 'max_hops', 'orphan_check']],
    ['redundancy', ['enabled', 'word_frequency_threshold']],
    ['token_budget', ['enabled', 'default_limit']],
    ['overflow', ['max_node_chars']],
  ];

  for (const [section, requiredKeys] of sections) {
    const val = merged[section];
    if (val === undefined) continue; // absent = section delete-key semantics apply instead
    const line = topLevelKeyLine(source, section);
    const at = line > 0 ? `line ${line}` : 'line 1';
    if (typeof val !== 'object' || val === null || Array.isArray(val)) {
      const got = val === null ? 'empty value (nothing under the key)' : typeof val;
      throw new Error(`${at} — "${section}" must be a mapping, got ${got}`);
    }
    const obj = val as Record<string, unknown>;
    for (const key of requiredKeys) {
      if (!(key in obj)) continue;
      const v = obj[key];
      if (
        (key === 'node_length' || key === 'siblings' || key === 'depth') &&
        (typeof v !== 'object' || v === null || Array.isArray(v))
      ) {
        throw new Error(`${at} — "${section}.${key}" must be a mapping like { min: 3, max: 120 }`);
      }
    }
  }
}

/** Load rules from `<root>/_rules.yaml` deep-merged over defaults.
 *  Missing file → all defaults.
 *  File exists → §18 "Delete a key = check turns off": sections/keys absent
 *  from the file disable their checks instead of keeping defaults.
 *  Invalid YAML or type-inconsistent shape → Error carrying the line number. */
export function loadRules(root: string): Rules {
  const p = join(root, '_rules.yaml');
  if (!existsSync(p)) return defaultRules();
  const source = readFileSync(p, 'utf-8');
  const parsed = parseMinimalYaml(source);
  const merged = deepMerge(defaultRules(), parsed) as Record<string, unknown>;
  validateRulesShape(merged, source);

  const rules = merged as unknown as Rules;
  const topLevel = new Set(Object.keys(parsed));

  // §18 "Delete a key = check turns off" — applied AFTER validation, so every
  // absent check-key is flipped from its deep-merged default to its OFF state:
  //   boolean switch   → false   (single_child_collapse, empty_nodes, tbd_allowed,
  //                               shared_prefix_detection, back_pointers,
  //                               orphan_check, duplicate_home_check, redundancy.enabled;
  //                               an explicit `false` stays false — same OFF result)
  //   mapping/numeric  → null    (node_length, siblings, depth, max_tbd_per_file,
  //                               force_nested_above, force_sibling_below, max_hops,
  //                               word_frequency_threshold, phrase_overlap_threshold,
  //                               cross_file_threshold, warn_threshold, max_node_chars,
  //                               force_file_for, prefer)
  //   parameters (NOT checks — keep defaults when deleted, §18 overrides only
  //   what the file lists for these): mode, stopwords, synonyms,
  //   estimate_chars_per_token, default_limit; token_budget.enabled is a
  //   planning switch, not a check switch, so it too keeps its default.
  // A FULL rules file (every key present) finds every key listed below and is
  // returned byte-identical to the old deep-merge behavior; a MISSING file
  // never reaches this pass (early return above).
  const offRange = (): { min: null; max: null } => ({ min: null, max: null });
  const has = (section: string, key: string): boolean => {
    const s = parsed[section];
    return isPlainObject(s) && key in s;
  };

  // structure: node_length / siblings / depth / single_child_collapse / empty_nodes
  if (!topLevel.has('structure')) {
    rules.structure = {
      node_length: offRange(),
      siblings: offRange(),
      depth: offRange(),
      single_child_collapse: false,
      empty_nodes: false,
    };
  } else {
    if (!has('structure', 'node_length')) {
      rules.structure = { ...rules.structure, node_length: offRange() };
    }
    if (!has('structure', 'siblings')) {
      rules.structure = { ...rules.structure, siblings: offRange() };
    }
    if (!has('structure', 'depth')) {
      rules.structure = { ...rules.structure, depth: offRange() };
    }
    if (!has('structure', 'single_child_collapse')) {
      rules.structure = { ...rules.structure, single_child_collapse: false };
    }
    if (!has('structure', 'empty_nodes')) {
      rules.structure = { ...rules.structure, empty_nodes: false };
    }
  }

  // style: prefer / force_nested_above / force_sibling_below / shared_prefix_detection
  if (!topLevel.has('style')) {
    rules.style = {
      prefer: null,
      force_nested_above: null,
      force_sibling_below: null,
      shared_prefix_detection: false,
    };
  } else {
    if (!has('style', 'prefer')) {
      rules.style = { ...rules.style, prefer: null };
    }
    if (!has('style', 'force_nested_above')) {
      rules.style = { ...rules.style, force_nested_above: null };
    }
    if (!has('style', 'force_sibling_below')) {
      rules.style = { ...rules.style, force_sibling_below: null };
    }
    if (!has('style', 'shared_prefix_detection')) {
      rules.style = { ...rules.style, shared_prefix_detection: false };
    }
  }

  // content: tbd_allowed / max_tbd_per_file
  if (!topLevel.has('content')) {
    rules.content = { tbd_allowed: false, max_tbd_per_file: null };
  } else {
    if (!has('content', 'tbd_allowed')) {
      rules.content = { ...rules.content, tbd_allowed: false };
    }
    if (!has('content', 'max_tbd_per_file')) {
      rules.content = { ...rules.content, max_tbd_per_file: null };
    }
  }

  // references: back_pointers / max_hops / orphan_check / duplicate_home_check.
  // `mode` is a parameter — keeps its default when deleted. max_hops deleted →
  // null → the deep-hop check is skipped entirely (§18 strict: deleted = off;
  // the old deleted → 1 (default) special case violated "delete = off").
  if (!topLevel.has('references')) {
    rules.references = {
      mode: 'pointer',
      back_pointers: false,
      max_hops: null,
      orphan_check: false,
      duplicate_home_check: false,
    };
  } else {
    if (!has('references', 'back_pointers')) {
      rules.references = { ...rules.references, back_pointers: false };
    }
    if (!has('references', 'max_hops')) {
      rules.references = { ...rules.references, max_hops: null };
    }
    if (!has('references', 'orphan_check')) {
      rules.references = { ...rules.references, orphan_check: false };
    }
    if (!has('references', 'duplicate_home_check')) {
      rules.references = { ...rules.references, duplicate_home_check: false };
    }
  }

  // redundancy: enabled / word_frequency_threshold / phrase_overlap_threshold /
  // cross_file_threshold. `stopwords`/`synonyms` are parameters (§13 inputs) —
  // they keep their defaults when deleted so the remaining layers still
  // normalize text exactly as documented.
  if (!topLevel.has('redundancy')) {
    rules.redundancy = {
      ...rules.redundancy,
      enabled: false,
      word_frequency_threshold: null,
      phrase_overlap_threshold: null,
      cross_file_threshold: null,
    };
  } else {
    if (!has('redundancy', 'enabled')) {
      rules.redundancy = { ...rules.redundancy, enabled: false };
    }
    if (!has('redundancy', 'word_frequency_threshold')) {
      rules.redundancy = { ...rules.redundancy, word_frequency_threshold: null };
    }
    if (!has('redundancy', 'phrase_overlap_threshold')) {
      rules.redundancy = { ...rules.redundancy, phrase_overlap_threshold: null };
    }
    if (!has('redundancy', 'cross_file_threshold')) {
      rules.redundancy = { ...rules.redundancy, cross_file_threshold: null };
    }
  }

  // token_budget: warn_threshold deleted → null → no usage warning. Planning
  // parameters (enabled / default_limit / estimate_chars_per_token) keep their
  // defaults when deleted — §18 budget planning must not change.
  if (!topLevel.has('token_budget')) {
    rules.token_budget = { ...rules.token_budget, warn_threshold: null };
  } else if (!has('token_budget', 'warn_threshold')) {
    rules.token_budget = { ...rules.token_budget, warn_threshold: null };
  }

  // overflow: max_node_chars / force_file_for — both are check keys.
  if (!topLevel.has('overflow')) {
    rules.overflow = { max_node_chars: null, force_file_for: null };
  } else {
    if (!has('overflow', 'max_node_chars')) {
      rules.overflow = { ...rules.overflow, max_node_chars: null };
    }
    if (!has('overflow', 'force_file_for')) {
      rules.overflow = { ...rules.overflow, force_file_for: null };
    }
  }

  return rules;
}
