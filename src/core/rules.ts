import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Rules } from '../types.ts';
import { defaultAliasing } from './alias.ts';

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

function scalar(s: string, lineNo: number): string | number | boolean | null {
  const t = s.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  // YAML 1.1 null literals (issue #56): the explicit spelling of the §18
  // empty/delete value — `max_hops: null` means the same as an empty
  // `max_hops:` (or omitting the key from a template-shaped file): the check
  // is OFF. The match is on the full raw token, so a QUOTED 'null' / "null"
  // (quote characters included) falls through to the unwrapping below and
  // stays the STRING "null".
  if (t === 'null' || t === 'Null' || t === 'NULL' || t === '~') return null;
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

/** Parse result carrying the line-number index issue #56's strict
 *  validation needs: every parsed key — as a dotted path (e.g.
 *  "token_budget.default_limit", array elements as
 *  "redundancy.stopwords[0]") — maps to the 1-based line it was defined
 *  on. Inline-object members map to their enclosing key's line. The VALUE
 *  tree is exactly what parseMinimalYaml has always returned. */
interface TrackedYaml {
  value: Record<string, unknown>;
  keyLines: Map<string, number>;
}

function parseYamlTracked(source: string): TrackedYaml {
  const lines: YLine[] = [];
  const keyLines = new Map<string, number>();
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

  /** Record `path` (and every nested member of an inline value) at `lineNo`.
   *  Block-form children record their own paths with their own lines while
   *  parsing; inline values are flat, so their members share the line. */
  const track = (path: string, value: unknown, lineNo: number): void => {
    keyLines.set(path, lineNo);
    if (isPlainObject(value)) {
      for (const [k, v] of Object.entries(value)) track(`${path}.${k}`, v, lineNo);
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => track(`${path}[${i}]`, v, lineNo));
    }
  };

  const parseMap = (indent: number, path: string): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    while (pos < lines.length && lines[pos].indent >= indent) {
      const ln = lines[pos];
      if (ln.indent > indent) throw new Error(`line ${ln.lineNo}: unexpected indentation`);
      if (isItem(ln.text)) throw new Error(`line ${ln.lineNo}: list item outside array context`);
      const m = ln.text.match(/^([^:\s]+):\s*(.*)$/);
      if (!m) throw new Error(`line ${ln.lineNo}: malformed line: ${ln.text}`);
      const key = m[1];
      const childPath = path === '' ? key : `${path}.${key}`;
      const rest = m[2].trim();
      if (rest === '') {
        keyLines.set(childPath, ln.lineNo);
        pos++;
        const next = pos < lines.length ? lines[pos] : undefined;
        if (
          next &&
          (next.indent > indent || (next.indent === indent && isItem(next.text)))
        ) {
          out[key] = isItem(next.text)
            ? parseArray(next.indent, childPath)
            : parseMap(next.indent, childPath);
        } else {
          out[key] = null;
        }
      } else {
        out[key] = parseInlineValue(rest, ln.lineNo);
        track(childPath, out[key], ln.lineNo);
        pos++;
      }
    }
    return out;
  };

  const parseArray = (indent: number, path: string): unknown[] => {
    const out: unknown[] = [];
    while (pos < lines.length && lines[pos].indent === indent && isItem(lines[pos].text)) {
      const ln = lines[pos];
      const item = ln.text === '-' ? '' : ln.text.slice(2).trim();
      const idx = out.length;
      const itemPath = `${path}[${idx}]`;
      if (item === '') {
        keyLines.set(itemPath, ln.lineNo);
        pos++;
        const next = pos < lines.length ? lines[pos] : undefined;
        if (next && next.indent > indent) {
          out.push(isItem(next.text) ? parseArray(next.indent, itemPath) : parseMap(next.indent, itemPath));
        } else {
          out.push(null);
        }
      } else {
        out.push(parseInlineValue(item, ln.lineNo));
        track(itemPath, out[out.length - 1], ln.lineNo);
        pos++;
      }
    }
    return out;
  };

  if (lines.length === 0) return { value: {}, keyLines };
  if (lines[0].indent !== 0) throw new Error(`line ${lines[0].lineNo}: unexpected indentation`);
  const result = parseMap(0, '');
  if (pos < lines.length) {
    throw new Error(`line ${lines[pos].lineNo}: unexpected content: ${lines[pos].text}`);
  }
  return { value: result, keyLines };
}

/** Minimal YAML subset parser: 2-space nested objects, inline objects/arrays,
 *  block arrays (`- item`, items may be inline arrays), scalars, comments.
 *  (Issue #56 keeps this public surface; the strict validator uses the
 *  line-tracking variant above.) */
export function parseMinimalYaml(source: string): Record<string, unknown> {
  return parseYamlTracked(source).value;
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
      // Issue #57: per-file pointer aliasing — opt-in, defaults shown. A
      // parameter block (like external_roots): absent/empty keeps these
      // values, and listing it never changes the delete/override
      // reconciliation for configs that predate it.
      aliasing: defaultAliasing(),
    },
    redundancy: {
      enabled: true,
      word_frequency_threshold: 4,
      phrase_overlap_threshold: 0.7,
      cross_file_threshold: 2,
      fuzzy: true,
      // Issue #47: layer 3 tuning parameters (defaults = the previously
      // hardcoded behavior). The check switch stays `fuzzy`.
      fuzzy_max_distance: 2,
      fuzzy_min_word_length: 5,
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

// ── §18 strict _rules.yaml schema (issue #56) ───────────────────────────────
//
// ONE table describing the ENTIRE legal `_rules.yaml` surface: every
// top-level section, every nested key, its value kind and documented domain,
// and — per key — whether an explicit EMPTY value (`key:` with nothing under
// it, parsed as null) is legal and what it means. Everything the strict
// validator enforces, and everything the delete/override reconciliation
// counts (SECTION_KEYS below), derives from this table. Adding a key (e.g.
// issue #55's references.external_roots) is one line here.

/** Value shape of one legal _rules.yaml key.
 *
 *  nullOk documents the §18 empty-value semantics per key — null is legal
 *  exactly where the architecture document defines what it means:
 *  - check keys (thresholds, budgets, ranges): null = the check is OFF
 *    (engines skip it — never compare against null, which coerces to 0);
 *  - style.prefer: null = no prefer-driven modulation (issue #2);
 *  - references.mode / token_budget.enabled: null = the documented default
 *    (the §18 empty-value convention budget.ts follows);
 *  - redundancy.stopwords: null = no stopword filtering (issue #42).
 *  Everywhere else an empty value is out-of-domain and rejects: boolean
 *  switches take `false` as their off state, and parameters (synonyms,
 *  fuzzy knobs, budget planning inputs) keep their defaults when OMITTED —
 *  an explicit empty value is a typo, not a documented state. */
interface KeySpec {
  kind:
    | 'boolean'
    | 'integer'
    | 'number'
    | 'enum'
    | 'range'
    | 'wordList'
    | 'synonymGroups'
    | 'docString'
    | 'rootMap'
    | 'aliasBlock';
  /** integer/number: inclusive lower bound. range: bound for BOTH members. */
  min?: number;
  /** number: inclusive upper bound. */
  max?: number;
  /** min is exclusive (ratios: > 0). */
  minExclusive?: boolean;
  /** enum: the complete member set. */
  members?: string[];
  /** Is an explicit empty value (null) legal for this key? */
  nullOk?: boolean;
  /** Strict-validated by the schema but excluded from SECTION_KEYS (issue
   *  #55: parameters whose presence must not retroactively change the
   *  delete/override reconciliation for configs that predate them). */
  reconcile?: false;
}

const RULES_SCHEMA: Record<string, Record<string, KeySpec>> = {
  structure: {
    // node_length: chars of node text; siblings: children per parent — both
    // 0-based counts. depth is 1-based (a root bullet is depth 1).
    node_length: { kind: 'range', min: 0 },
    siblings: { kind: 'range', min: 0 },
    depth: { kind: 'range', min: 1 },
    single_child_collapse: { kind: 'boolean' },
    empty_nodes: { kind: 'boolean' },
  },
  style: {
    prefer: { kind: 'enum', members: ['sibling', 'nested'], nullOk: true },
    force_nested_above: { kind: 'integer', min: 0, nullOk: true },
    force_sibling_below: { kind: 'integer', min: 0, nullOk: true },
    shared_prefix_detection: { kind: 'boolean' },
  },
  content: {
    tbd_allowed: { kind: 'boolean' },
    max_tbd_per_file: { kind: 'integer', min: 0, nullOk: true },
  },
  references: {
    mode: { kind: 'enum', members: ['pointer'], nullOk: true },
    back_pointers: { kind: 'boolean' },
    max_hops: { kind: 'integer', min: 0, nullOk: true },
    orphan_check: { kind: 'boolean' },
    duplicate_home_check: { kind: 'boolean' },
    // Issue #55: declared inter-repo pointer roots — root name → path from
    // the PROJECT root (§12/§18). A PARAMETER, not a check switch: null =
    // no roots (the default). reconcile: false keeps it out of SECTION_KEYS
    // so listing it never changes what a "complete references section"
    // means for the delete/override reconciliation (pre-#55 configs behave
    // identically); entry validation keeps the issue-#55 message shapes.
    external_roots: { kind: 'rootMap', nullOk: true, reconcile: false },
    // Issue #57: the per-file pointer-aliasing block — enabled/scope/style/
    // min_uses. A PARAMETER, not a check switch: null (an explicit empty
    // `aliasing:`) keeps the documented defaults (disabled/file/both/2), the
    // same convention as references.mode; reconcile: false keeps it out of
    // SECTION_KEYS so listing it never changes what a "complete references
    // section" means for the delete/override reconciliation. Sub-key
    // validation keeps the issue-#56 line-numbered message shapes.
    aliasing: { kind: 'aliasBlock', nullOk: true, reconcile: false },
  },
  redundancy: {
    enabled: { kind: 'boolean' },
    word_frequency_threshold: { kind: 'integer', min: 1, nullOk: true },
    // Ratios are positive numbers with NO upper bound: a value above 1 can
    // never fire (overlap/usage are ≤ 100%) — the historical disable
    // spelling (e.g. the issue #3 repro's 1.1); §18 null is the documented
    // one. 0 or below is out-of-domain: it would flag every pair / warn on
    // every plan.
    phrase_overlap_threshold: { kind: 'number', min: 0, minExclusive: true, nullOk: true },
    cross_file_threshold: { kind: 'integer', min: 1, nullOk: true },
    fuzzy: { kind: 'boolean' },
    // Issue #47 layer-3 tuning parameters — omitted keeps the default.
    fuzzy_max_distance: { kind: 'integer', min: 1 },
    fuzzy_min_word_length: { kind: 'integer', min: 1 },
    stopwords: { kind: 'wordList', nullOk: true },
    synonyms: { kind: 'synonymGroups' },
  },
  token_budget: {
    enabled: { kind: 'boolean', nullOk: true },
    default_limit: { kind: 'integer', min: 0 },
    estimate_chars_per_token: { kind: 'number', min: 0, minExclusive: true },
    warn_threshold: { kind: 'number', min: 0, minExclusive: true, nullOk: true },
  },
  // templates/_rules.yaml ships this inert documentation section (issue #53:
  // the anchor algorithm is fixed, not configurable — the section teaches it).
  // Accepted so `cans init` output is strictly valid; never read by engines.
  slug: {
    algorithm: { kind: 'docString' },
    collapse: { kind: 'docString' },
    case: { kind: 'docString' },
    example: { kind: 'docString' },
  },
};

/** §18 default keys per section — drives the delete/override reconciliation in
 *  loadRules. Derived from RULES_SCHEMA (every key of every rules section;
 *  the inert slug: documentation section is not a rules section) so the
 *  schema stays the single source of truth. Parameters (references.mode,
 *  redundancy.stopwords/synonyms, redundancy.fuzzy_max_distance/
 *  fuzzy_min_word_length (issue #47), token_budget.enabled/default_limit/
 *  estimate_chars_per_token) are listed too: they count towards a section's
 *  coverage but are never flipped OFF — omitted parameters keep their
 *  documented defaults (§18 overrides only what the file lists for them).
 *  The one deliberate exception is references.external_roots (issue #55,
 *  reconcile: false): schema-validated but NOT counted, so listing it never
 *  changes what a "complete" or "majority-covered" references section
 *  means for configs that predate the key. */
const SECTION_KEYS: Record<string, string[]> = Object.fromEntries(
  Object.entries(RULES_SCHEMA)
    .filter(([section]) => section !== 'slug')
    .map(([section, keys]) => [
      section,
      Object.entries(keys)
        .filter(([, spec]) => spec.reconcile !== false)
        .map(([key]) => key),
    ]),
);

/** How an offending value is named in strict-validation errors. Scalars keep
 *  the issue #2 got-value convention (`got "banana"`, `got "42"`); structural
 *  values name their shape; null names itself as the empty value. */
function gotText(v: unknown): string {
  if (v === null) return 'null (empty value)';
  if (Array.isArray(v)) return 'a list';
  if (typeof v === 'object') return 'a mapping';
  return `"${String(v)}"`;
}

/** 1-based line of `path`, walking up (dropping trailing segments / [i]
 *  indices) to the nearest tracked ancestor. Every parsed key is tracked, so
 *  the walk only fires for synthesized sub-paths. */
function lineOf(keyLines: Map<string, number>, path: string): number {
  let cur = path;
  for (;;) {
    const hit = keyLines.get(cur);
    if (hit !== undefined) return hit;
    const stripped = cur.replace(/\[\d+\]$/, '');
    if (stripped !== cur) {
      cur = stripped;
      continue;
    }
    const dot = cur.lastIndexOf('.');
    if (dot <= 0) return 1;
    cur = cur.slice(0, dot);
  }
}

/** The "must be …" expectation text for integer/number specs. */
function numericExpectation(spec: KeySpec): string {
  const lower = spec.minExclusive
    ? `> ${spec.min ?? 0}`
    : spec.min !== undefined
      ? `>= ${spec.min}`
      : undefined;
  const upper = spec.max !== undefined ? `<= ${spec.max}` : undefined;
  const bounds = [lower, upper].filter((p): p is string => p !== undefined).join(' and ');
  const kindText = spec.kind === 'integer' ? 'an integer' : 'a number';
  return bounds === '' ? kindText : `${kindText} ${bounds}`;
}

/** Expectation text shared by the null-rejection branch and synonyms. */
const SYNONYM_GROUPS_EXPECTATION =
  'a list of synonym groups (like "- [flavour, flavor]" or a head: [words] mapping)';

const UNRECOGNIZED_SUFFIX =
  '(issue #56: _rules.yaml is validated strictly — §18 documents the legal keys)';

/** Expectation text for a spec, used when the value is null (out-of-domain
 *  empty) or otherwise needs the kind’s full shape description. */
function numericOrOtherExpectation(spec: KeySpec): string {
  if (spec.kind === 'boolean') return 'true or false';
  if (spec.kind === 'integer' || spec.kind === 'number') return numericExpectation(spec);
  if (spec.kind === 'enum') return (spec.members ?? []).map(m => `"${m}"`).join(' or ');
  if (spec.kind === 'range') return 'a mapping like { min: 3, max: 120 }';
  if (spec.kind === 'wordList') return 'a list of words';
  if (spec.kind === 'synonymGroups') return SYNONYM_GROUPS_EXPECTATION;
  if (spec.kind === 'rootMap') return 'a mapping of root names to paths';
  if (spec.kind === 'aliasBlock') return 'a mapping like { enabled: true, scope: file, style: both, min_uses: 2 }';
  return 'a string';
}

/** Validate one user-supplied value against its KeySpec. Throws the §18
 *  line-numbered config error (same shape/style as the issue #2 reserved
 *  values: `line N — "section.key" must be …, got …`). */
function validateValue(path: string, v: unknown, spec: KeySpec, keyLines: Map<string, number>): void {
  // Explicit annotation: calls to `fail` must narrow (never-returning) so the
  // switch cases below can treat `v` by its validated type afterwards.
  const fail: (expectation: string, at?: string, got?: unknown) => never = (
    expectation,
    at = path,
    got = v,
  ) => {
    throw new Error(`line ${lineOf(keyLines, at)} — "${at}" must be ${expectation}, got ${gotText(got)}`);
  };
  if (v === null) {
    if (spec.nullOk === true) return; // documented empty-value semantics (see KeySpec)
    fail(numericOrOtherExpectation(spec));
  }
  switch (spec.kind) {
    case 'boolean':
      if (typeof v !== 'boolean') fail('true or false');
      return;
    case 'integer':
    case 'number': {
      if (typeof v !== 'number' || !Number.isFinite(v)) fail(numericExpectation(spec));
      if (spec.kind === 'integer' && !Number.isInteger(v)) fail(numericExpectation(spec));
      if (spec.min !== undefined && (spec.minExclusive ? v <= spec.min : v < spec.min)) {
        fail(numericExpectation(spec));
      }
      if (spec.max !== undefined && v > spec.max) fail(numericExpectation(spec));
      return;
    }
    case 'enum': {
      const members = spec.members ?? [];
      if (typeof v !== 'string' || !members.includes(v)) {
        fail(members.map(m => `"${m}"`).join(' or '));
      }
      return;
    }
    case 'range': {
      if (!isPlainObject(v)) fail('a mapping like { min: 3, max: 120 }');
      for (const [member, mv] of Object.entries(v)) {
        const memberPath = `${path}.${member}`;
        if (member !== 'min' && member !== 'max') {
          throw new Error(
            `line ${lineOf(keyLines, memberPath)} — unrecognized key "${memberPath}" ` +
            UNRECOGNIZED_SUFFIX,
          );
        }
        if (mv === null) continue; // null member = that side of the range is OFF (§18)
        if (typeof mv !== 'number' || !Number.isFinite(mv) || !Number.isInteger(mv) || mv < (spec.min ?? 0)) {
          throw new Error(
            `line ${lineOf(keyLines, memberPath)} — "${memberPath}" must be ` +
            `an integer >= ${spec.min ?? 0}, got ${gotText(mv)}`,
          );
        }
      }
      return;
    }
    case 'wordList': {
      if (!Array.isArray(v)) fail('a list of words');
      v.forEach((entry, i) => {
        // Issue #42: scalar entries (numbers, booleans) are legal — coerced to
        // strings at load; only nested structures are malformed.
        if (entry === null || typeof entry === 'object') {
          throw new Error(
            `line ${lineOf(keyLines, `${path}[${i}]`)} — "${path}" entries must be words, ` +
            `got ${gotText(entry)}`,
          );
        }
      });
      return;
    }
    case 'synonymGroups': {
      // Map form (§18 inline objects): { head: [words] } / { head: word }.
      if (isPlainObject(v)) {
        for (const [head, rest] of Object.entries(v)) {
          const at = `${path}.${head}`;
          if (rest === null || typeof rest === 'object') {
            if (rest !== null && Array.isArray(rest)) {
              rest.forEach((w, i) => {
                if (w === null || typeof w === 'object') {
                  throw new Error(
                    `line ${lineOf(keyLines, `${at}[${i}]`)} — "${path}" group entries must be words, ` +
                    `got ${gotText(w)}`,
                  );
                }
              });
              continue;
            }
            throw new Error(
              `line ${lineOf(keyLines, at)} — "${at}" must be a word or a list of words, ` +
              `got ${gotText(rest)}`,
            );
          }
        }
        return;
      }
      if (!Array.isArray(v)) {
        fail(SYNONYM_GROUPS_EXPECTATION);
      }
      v.forEach((group, i) => {
        const at = `${path}[${i}]`;
        if (Array.isArray(group)) {
          group.forEach((w, j) => {
            if (w === null || typeof w === 'object') {
              throw new Error(
                `line ${lineOf(keyLines, `${at}[${j}]`)} — "${path}" group entries must be words, ` +
                `got ${gotText(w)}`,
              );
            }
          });
        } else {
          // A bare word (or nested map) where a group belongs — pre-#56 this
          // reached normalizeWord and crashed/mis-normalized; reject it.
          fail('a list of words', at, group);
        }
      });
      return;
    }
    case 'docString':
      if (typeof v !== 'string') fail('a string (the slug: section is documentation only)');
      return;
    case 'rootMap': {
      // Issue #55: entries are root names → path strings from the PROJECT
      // root (§12/§18). Messages keep the issue-#55 shapes that
      // test/issues/issue-55.test.ts pins (name grammar + got-value text);
      // block-form entries carry their own tracked line, inline members
      // share the key's line (parseYamlTracked).
      if (!isPlainObject(v)) fail('a mapping of root names to paths');
      for (const [name, value] of Object.entries(v)) {
        const at = `${path}.${name}`;
        if (!/^[a-z][a-z0-9_-]*$/.test(name)) {
          throw new Error(
            `line ${lineOf(keyLines, at)} — invalid external root name "${name}" — ` +
              'must match ^[a-z][a-z0-9_-]*$ (lowercase, no slashes, no dots)',
          );
        }
        if (value === null || typeof value !== 'string' || value.trim() === '') {
          const got = value === null ? 'empty value (nothing under the key)' : typeof value;
          throw new Error(
            `line ${lineOf(keyLines, at)} — external root "${name}" must be a non-empty path string, got ${got}`,
          );
        }
      }
      return;
    }
    case 'aliasBlock': {
      // Issue #57: references.aliasing — enabled (boolean), scope ("file",
      // the only legal v1 value), style (numeric|named|both), min_uses
      // (integer >= 1). Unknown sub-keys reject under the same strict §18
      // discipline as unknown top-level keys: a typo'd `enabledd` must never
      // silently mean "no such knob" while the author believes aliasing is
      // on. Block-form members carry their own tracked line; inline-object
      // members share the key's line (parseYamlTracked).
      if (!isPlainObject(v)) fail('a mapping like { enabled: true, scope: file, style: both, min_uses: 2 }');
      for (const [key, mv] of Object.entries(v)) {
        const at = `${path}.${key}`;
        if (key === 'enabled') {
          if (typeof mv !== 'boolean') fail('true or false', at, mv);
        } else if (key === 'scope') {
          if (mv !== 'file') fail('"file" (the only legal aliasing scope in v1 — issue #57)', at, mv);
        } else if (key === 'style') {
          if (mv !== 'numeric' && mv !== 'named' && mv !== 'both') {
            fail('"numeric" or "named" or "both"', at, mv);
          }
        } else if (key === 'min_uses') {
          if (typeof mv !== 'number' || !Number.isInteger(mv) || mv < 1) {
            fail('an integer >= 1', at, mv);
          }
        } else {
          throw new Error(
            `line ${lineOf(keyLines, at)} — unrecognized key "${at}" ${UNRECOGNIZED_SUFFIX}`,
          );
        }
      }
      return;
    }
  }
}

/** Issue #56 strict validation: every top-level and nested key must be a
 *  known §18 key (the only exception-by-design: an ABSENT or EMPTY file keeps
 *  all defaults — an empty parse produces nothing to walk), and every
 *  supplied value must sit inside its documented domain. Relational
 *  invariants the engines assume (range min <= max, on the EFFECTIVE values —
 *  user-set members override, unset members keep their defaults) are checked
 *  too. Any violation throws the §18 line-numbered config error that
 *  checkWorkspace/budget report as rule config.invalid, exit 2/1 — the same
 *  treatment style.prefer and references.mode have received since issue #2. */
function validateRulesStrict(parsed: Record<string, unknown>, keyLines: Map<string, number>): void {
  for (const [section, value] of Object.entries(parsed)) {
    const sectionSpec = RULES_SCHEMA[section];
    if (sectionSpec === undefined) {
      throw new Error(
        `line ${lineOf(keyLines, section)} — unrecognized key "${section}" ${UNRECOGNIZED_SUFFIX}`,
      );
    }
    if (!isPlainObject(value)) {
      const got = value === null
        ? 'empty value (nothing under the key)'
        : Array.isArray(value)
          ? 'a list'
          : typeof value;
      throw new Error(`line ${lineOf(keyLines, section)} — "${section}" must be a mapping, got ${got}`);
    }
    for (const [key, v] of Object.entries(value)) {
      const spec = sectionSpec[key];
      const path = `${section}.${key}`;
      if (spec === undefined) {
        throw new Error(`line ${lineOf(keyLines, path)} — unrecognized key "${path}" ${UNRECOGNIZED_SUFFIX}`);
      }
      validateValue(path, v, spec, keyLines);
    }
  }

  // Relational invariant on EFFECTIVE values: a user-set min above the
  // effective max (user-set, or the §18 default when unset) is a
  // contradictory range — nothing could ever satisfy both sides.
  const defaults = defaultRules();
  for (const key of ['node_length', 'siblings', 'depth'] as const) {
    const user = isPlainObject(parsed.structure) ? parsed.structure[key] : undefined;
    const userRange = isPlainObject(user) ? user : {};
    const effMin = userRange.min !== undefined ? userRange.min : defaults.structure[key].min;
    const effMax = userRange.max !== undefined ? userRange.max : defaults.structure[key].max;
    if (typeof effMin === 'number' && typeof effMax === 'number' && effMin > effMax) {
      const line =
        keyLines.get(`structure.${key}.min`) ??
        keyLines.get(`structure.${key}.max`) ??
        keyLines.get(`structure.${key}`) ??
        keyLines.get('structure') ?? 1;
      throw new Error(
        `line ${line} — "structure.${key}" min must not exceed max (min ${effMin} > max ${effMax})`,
      );
    }
  }
}

/** Load rules from `<root>/_rules.yaml`, reconciling §18's three loading
 *  clauses ("Missing file = all defaults. Partial file = only listed keys
 *  override. Delete a key = check turns off.") with the blackbox contracts of
 *  both QA rounds (QA-13 F1 vs the round-2 delete-key suite):
 *
 *  - File absent or empty → all defaults. (A file listing only unknown keys
 *    is NO LONGER silently defaults — issue #56: an unrecognized key is a
 *    line-numbered config error; a typo'd key name must never read as "no
 *    such rule" while the author believes a limit is enforced.)
 *  - A file that mirrors the template shape — the `structure:` section is
 *    present, or any listed section spells out ALL of its §18 default keys —
 *    is a curated config: deletions are intentional, so an absent section AND
 *    every check-key omitted from a listed section turn OFF (delete contract).
 *  - Any other file is a partial override: absent sections keep their
 *    defaults, and inside a listed section an omitted check-key counts as
 *    deleted only when that section spells out at least half of its default
 *    keys (otherwise the key defaults). Listed keys always apply; parameters
 *    always keep their defaults when omitted.
 *  Invalid YAML, an unrecognized key, or a value outside its documented §18
 *  domain → Error carrying the line number (validateRulesStrict, issue #56). */
export function loadRules(root: string): Rules {
  const p = join(root, '_rules.yaml');
  if (!existsSync(p)) return defaultRules();
  const source = readFileSync(p, 'utf-8');
  const { value: parsed, keyLines } = parseYamlTracked(source);
  validateRulesStrict(parsed, keyLines);
  const merged = deepMerge(defaultRules(), parsed) as Record<string, unknown>;

  // The strict validator admits known-but-inert documentation sections (the
  // template's slug: block, issue #53) — they are not rules sections, so strip
  // them here: the returned object is exactly the Rules surface (SECTION_KEYS
  // = every rules section of RULES_SCHEMA), never read by engines either way.
  for (const section of Object.keys(merged)) {
    if (!(section in SECTION_KEYS)) delete merged[section];
  }

  const rules = merged as unknown as Rules;

  // §18 documents inline objects alongside inline/block arrays ("inline
  // objects {min: 3, max: 120}") — `synonyms: {vehicle: [car, auto]}` is
  // therefore valid config (QA-13 F2): normalize it to group form. Like the
  // block-list syntax, a user list replaces the built-in groups.
  if (isPlainObject(rules.redundancy.synonyms)) {
    rules.redundancy.synonyms = Object.entries(rules.redundancy.synonyms).map(([head, rest]) => [
      head,
      ...(Array.isArray(rest) ? rest.map(String) : [String(rest)]),
    ]);
  }

  // Issue #42: the YAML subset parser types an unquoted `- 10` as the Number
  // 10, but the redundancy layers tokenize node text into STRINGS ("10" out
  // of `see: 10-sdk.md`) — `stopwords.includes("10")` could never match a
  // Number entry, so numeric stopwords (and numeric members of a synonym
  // group, the same token-type class of bug) were silently inert. Coerce
  // well-formed array entries to strings at load time. An empty `stopwords:`
  // (null) keeps its documented meaning (no stopword filtering); a non-list
  // shape now rejects up front in validateRulesStrict (issue #56).
  if (Array.isArray(rules.redundancy.stopwords)) {
    rules.redundancy.stopwords = rules.redundancy.stopwords.map(String);
  }
  if (Array.isArray(rules.redundancy.synonyms)) {
    rules.redundancy.synonyms = rules.redundancy.synonyms.map(
      group => (Array.isArray(group) ? group.map(String) : group),
    );
  }

  const offRange = (): { min: null; max: null } => ({ min: null, max: null });
  const has = (section: string, key: string): boolean => {
    const s = parsed[section];
    return isPlainObject(s) && key in s;
  };
  const listed = (section: string): boolean => isPlainObject(parsed[section]);
  const complete = (section: string): boolean => {
    const s = parsed[section];
    return isPlainObject(s) && SECTION_KEYS[section].every(k => k in s);
  };
  const deleteMode = listed('structure') || Object.keys(SECTION_KEYS).some(complete);
  // An omitted check-key is a deletion (→ OFF) in a template-shaped file; in a
  // sparse override file only when its section is majority-covered.
  const deleted = (section: string, key: string): boolean => {
    if (has(section, key)) return false;
    if (deleteMode) return true;
    const s = parsed[section];
    const covered = isPlainObject(s) ? SECTION_KEYS[section].filter(k => k in s).length : 0;
    return covered * 2 >= SECTION_KEYS[section].length;
  };

  // §18 "Delete a key = check turns off" — every deleted check-key is flipped
  // from its deep-merged default to its OFF state:
  //   boolean switch   → false   (single_child_collapse, empty_nodes, tbd_allowed,
  //                               shared_prefix_detection, back_pointers,
  //                               orphan_check, duplicate_home_check,
  //                               redundancy.enabled, redundancy.fuzzy;
  //                               an explicit `false` stays false — same OFF result)
  //   mapping/numeric  → null    (node_length, siblings, depth, max_tbd_per_file,
  //                               force_nested_above, force_sibling_below, max_hops,
  //                               word_frequency_threshold, phrase_overlap_threshold,
  //                               cross_file_threshold, warn_threshold, prefer)
  //   parameters (NOT checks — keep defaults when omitted): mode, stopwords,
  //   synonyms, fuzzy_max_distance, fuzzy_min_word_length (issue #47),
  //   estimate_chars_per_token, default_limit; token_budget.enabled
  //   is a planning switch, not a check switch. A file mirroring the full
  //   default shape lists every key and is returned identical to the defaults.

  // structure: node_length / siblings / depth / single_child_collapse / empty_nodes
  if (!listed('structure')) {
    if (deleteMode) {
      rules.structure = {
        node_length: offRange(),
        siblings: offRange(),
        depth: offRange(),
        single_child_collapse: false,
        empty_nodes: false,
      };
    }
  } else {
    if (deleted('structure', 'node_length')) {
      rules.structure = { ...rules.structure, node_length: offRange() };
    }
    if (deleted('structure', 'siblings')) {
      rules.structure = { ...rules.structure, siblings: offRange() };
    }
    if (deleted('structure', 'depth')) {
      rules.structure = { ...rules.structure, depth: offRange() };
    }
    if (deleted('structure', 'single_child_collapse')) {
      rules.structure = { ...rules.structure, single_child_collapse: false };
    }
    if (deleted('structure', 'empty_nodes')) {
      rules.structure = { ...rules.structure, empty_nodes: false };
    }
  }

  // style: prefer / force_nested_above / force_sibling_below / shared_prefix_detection
  if (!listed('style')) {
    if (deleteMode) {
      rules.style = {
        prefer: null,
        force_nested_above: null,
        force_sibling_below: null,
        shared_prefix_detection: false,
      };
    }
  } else {
    if (deleted('style', 'prefer')) {
      rules.style = { ...rules.style, prefer: null };
    }
    if (deleted('style', 'force_nested_above')) {
      rules.style = { ...rules.style, force_nested_above: null };
    }
    if (deleted('style', 'force_sibling_below')) {
      rules.style = { ...rules.style, force_sibling_below: null };
    }
    if (deleted('style', 'shared_prefix_detection')) {
      rules.style = { ...rules.style, shared_prefix_detection: false };
    }
  }

  // content: tbd_allowed / max_tbd_per_file — the §18 TBD policy, enforced
  // per file by checkTbdPolicy (§18 knobs were inert: QA-13 F4).
  if (!listed('content')) {
    if (deleteMode) {
      rules.content = { tbd_allowed: false, max_tbd_per_file: null };
    }
  } else {
    if (deleted('content', 'tbd_allowed')) {
      rules.content = { ...rules.content, tbd_allowed: false };
    }
    if (deleted('content', 'max_tbd_per_file')) {
      rules.content = { ...rules.content, max_tbd_per_file: null };
    }
  }

  // references: back_pointers / max_hops / orphan_check / duplicate_home_check.
  // `mode` is a parameter — keeps its default when omitted. max_hops deleted →
  // null → the deep-hop check is skipped entirely (§18 strict: deleted = off;
  // the old deleted → 1 (default) special case violated "delete = off").
  if (!listed('references')) {
    if (deleteMode) {
      rules.references = {
        mode: 'pointer',
        back_pointers: false,
        max_hops: null,
        orphan_check: false,
        duplicate_home_check: false,
        // Issue #57: aliasing is a PARAMETER (like mode) — a deleted
        // references section keeps its documented default (disabled), never
        // silently flips semantics for files that predate the key.
        aliasing: defaultAliasing(),
      };
    }
  } else {
    if (deleted('references', 'back_pointers')) {
      rules.references = { ...rules.references, back_pointers: false };
    }
    if (deleted('references', 'max_hops')) {
      rules.references = { ...rules.references, max_hops: null };
    }
    if (deleted('references', 'orphan_check')) {
      rules.references = { ...rules.references, orphan_check: false };
    }
    if (deleted('references', 'duplicate_home_check')) {
      rules.references = { ...rules.references, duplicate_home_check: false };
    }
  }

  // redundancy: enabled / word_frequency_threshold / phrase_overlap_threshold /
  // cross_file_threshold / fuzzy. `stopwords`/`synonyms` are parameters (§13
  // inputs) — they keep their defaults when omitted so the remaining layers
  // still normalize text exactly as documented. `fuzzy` is layer 3's own check
  // switch (issue #3): deleted → the near-miss layer alone turns OFF while
  // layers 1/2/4 keep running. Issue #47 adds two more PARAMETERS —
  // fuzzy_max_distance / fuzzy_min_word_length — which tune layer 3 but are
  // never flipped OFF by the delete pass (omitted → defaults 2/5).
  if (!listed('redundancy')) {
    if (deleteMode) {
      rules.redundancy = {
        ...rules.redundancy,
        enabled: false,
        word_frequency_threshold: null,
        phrase_overlap_threshold: null,
        cross_file_threshold: null,
        fuzzy: false,
      };
    }
  } else {
    if (deleted('redundancy', 'enabled')) {
      rules.redundancy = { ...rules.redundancy, enabled: false };
    }
    if (deleted('redundancy', 'word_frequency_threshold')) {
      rules.redundancy = { ...rules.redundancy, word_frequency_threshold: null };
    }
    if (deleted('redundancy', 'phrase_overlap_threshold')) {
      rules.redundancy = { ...rules.redundancy, phrase_overlap_threshold: null };
    }
    if (deleted('redundancy', 'cross_file_threshold')) {
      rules.redundancy = { ...rules.redundancy, cross_file_threshold: null };
    }
    if (deleted('redundancy', 'fuzzy')) {
      rules.redundancy = { ...rules.redundancy, fuzzy: false };
    }
  }

  // token_budget: warn_threshold omitted (deleted) → null → no usage warning.
  // Planning parameters (enabled / default_limit / estimate_chars_per_token)
  // keep their defaults — §18 budget planning must not change.
  if (!listed('token_budget')) {
    if (deleteMode) {
      rules.token_budget = { ...rules.token_budget, warn_threshold: null };
    }
  } else if (deleted('token_budget', 'warn_threshold')) {
    rules.token_budget = { ...rules.token_budget, warn_threshold: null };
  }

  return rules;
}
