/** Schematic anchors — issue #58: a parsed, path-aware anchor vocabulary for
 *  JSON, YAML and TOML artifact targets.
 *
 *  WHY THIS MODULE EXISTS. Before #58, an anchored ref (`see:
 *  artifacts/config.yaml#database.host`) aimed at a schematic artifact was
 *  either never verified (JSON/TOML → the `refs.anchor.no-target` advisory)
 *  or verified only FLAT and PATHLESS (YAML → extractYamlKeys, a line regex
 *  with no nesting): `#port` matched `database.port` and `server.port` alike
 *  and proved neither, while the real path form `#database.host` — the shape
 *  users actually write — false-negatived as a broken anchor. This module
 *  replaces both halves with REAL PARSERS producing a tree, and one
 *  path-addressable vocabulary shared by every supported format.
 *
 *  THE ANCHOR FORM (one form, identical across formats — the same anchor
 *  resolves in the JSON, YAML and TOML spelling of the same schema):
 *    database.host      dot path from the document root
 *    items.0            sequence/array item by index — `items[0]` is the
 *                       equivalent bracket spelling, and the two compose:
 *                       `matrix[0][1]`, `items.0.name`, `items[1].tags.2`
 *    a\.b               a key CONTAINING a dot, escaped with a backslash
 *                       (`\\` escapes a literal backslash, `\[`/`\]` a
 *                       bracket, any `\X` reads as X)
 *    maintenance        a single-segment anchor keeps the issue #49 flat
 *                       meaning: it must match exactly ONE key anywhere in
 *                       the document (see resolveSchematicAnchor)
 *  Path SEGMENTS resolve against keys with the same §12 anchor normalization
 *  as flat anchors (case-insensitive, separator-insensitive — exact spellings
 *  win first); array indices are exact integers.
 *
 *  THE PARSERS are hand-rolled, recursive, and dependency-free by design (the
 *  repo has zero runtime deps and keeps that law on both runtimes). JSON is a
 *  strict RFC-8259 recursive-descent parser — the builtin JSON.parse was the
 *  upstream sketch, but it silently last-wins duplicate keys (issue #58
 *  contract: duplicates are an explicit parse error) and reports no line
 *  numbers, so the same hand-rolled approach serves all three formats.
 *
 *  SUPPORTED SUBSET (per format; a construct BEYOND it is an explicit
 *  unsupported-error at the pointer site, never a silent pass):
 *    JSON   objects, arrays, strings (full escape set incl. \uXXXX and
 *           surrogate pairs), numbers, true/false/null. No comments, no
 *           trailing commas, no duplicate keys, no trailing content.
 *    YAML   block mappings and sequences (any nesting), scalars
 *           (plain/quoted, typed like YAML 1.2 core: bool/null/int/float),
 *           comments, block scalars (| and > with -/+ chomping), flow
 *           collections ({a: 1, b: [x]} — single- or multi-line), quoted and
 *           plain keys, a leading `---`, duplicate-key rejection, tab-
 *           indentation rejection. NOT supported: anchors/aliases/tags
 *           (&x *x !!t), merge keys (<<:), complex keys (?), multi-document
 *           input (v1 addresses the FIRST document — a later `---` ends it),
 *           explicit-indent block indicators (|2), multi-line quoted scalars.
 *    TOML   [tables], [[arrays-of-tables]], dotted keys, inline tables and
 *           arrays (multi-line arrays allowed), basic and literal strings
 *           (single- and multi-line), integers/floats (underscores, 0x/0o/0b,
 *           inf/nan), booleans, datetimes (read as string scalars), comments,
 *           duplicate-key and duplicate-table rejection, out-of-order
 *           super-tables, no static-array extension.
 *
 *  Values are checked for EXISTENCE only — this is not a schema or type
 *  validator (issue #58 "What this is not").
 *
 *  Standalone by design: string/regex work only, no imports outside slug.ts. */

import { normalizeForAnchor } from './slug.ts';

// ── The parsed tree ──

/** One mapping entry. A LIST (not a map) because duplicate keys are rejected
 *  at parse time — the list preserves document order for vocabulary walks. */
export interface SchematicEntry {
  key: string;
  value: SchematicValue;
  /** 1-based source line of the key (best effort for flow/inline values:
   *  the line the construct started on). */
  line: number;
}

export type SchematicValue =
  | { kind: 'scalar'; value: string | number | boolean | null }
  | { kind: 'object'; entries: SchematicEntry[] }
  | { kind: 'array'; items: SchematicValue[] };

export type SchematicFormat = 'json' | 'yaml' | 'toml';

/** Parse outcome: the tree, or a 1-based line + human message. A construct
 *  beyond the supported subset reports ok:false exactly like malformed input
 *  — the caller's finding says "unsupported" either way, never silently. */
export type SchematicParse =
  | { ok: true; root: SchematicValue }
  | { ok: false; line: number; message: string };

/** Internal control flow for parse failures — caught at each parse entry. */
class SchematicSyntaxError extends Error {
  constructor(readonly line: number, message: string) {
    super(message);
  }
}

function fail(line: number, message: string): never {
  throw new SchematicSyntaxError(line, message);
}

function scalar(value: string | number | boolean | null): SchematicValue {
  return { kind: 'scalar', value };
}

// ── Shared scanning helpers ──

/** Strip a `#` comment: the cut happens at a `#` at column 0 or preceded by
 *  whitespace, OUTSIDE single/double-quoted spans (single quotes escape by
 *  doubling '', double by backslash). Shared by the YAML and TOML line
 *  preprocessors — the same comment rule both formats use. A `#` butted
 *  against a bare token (`key: a#b`) is content, not a comment. */
function stripHashComment(text: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inSingle) {
      if (c === "'") {
        if (text[i + 1] === "'") i++;
        else inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      if (c === '\\') i++;
      else if (c === '"') inDouble = false;
      continue;
    }
    if (c === "'") inSingle = true;
    else if (c === '"') inDouble = true;
    else if (c === '#' && (i === 0 || text[i - 1] === ' ' || text[i - 1] === '\t')) {
      return text.slice(0, i);
    }
  }
  return text;
}

/** Scan a quoted scalar starting at text[start] (the quote char itself).
 *  Returns the decoded value, the index just past the CLOSING quote and the
 *  index where the content after the colon-prefixed key begins, or null when
 *  the string does not terminate inside `text`. `line` feeds error reports. */
function scanQuoted(text: string, start: number, line: number): { value: string; end: number } | null {
  const quote = text[start]!;
  if (quote === "'") {
    let body = '';
    for (let i = start + 1; i < text.length; i++) {
      const c = text[i]!;
      if (c !== "'") {
        body += c;
        continue;
      }
      if (text[i + 1] === "'") {
        body += "'";
        i++;
        continue;
      }
      return { value: body, end: i + 1 };
    }
    return null;
  }
  // Double-quoted: collect the raw body, then decode escapes.
  let body = '';
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i]!;
    if (c === '\\') {
      if (i + 1 >= text.length) return null;
      body += c + text[i + 1]!;
      i++;
      continue;
    }
    if (c === '"') return { value: decodeEscapes(body, line), end: i + 1 };
    body += c;
  }
  return null;
}

/** Decode double-quote escape sequences (shared by JSON, YAML and TOML basic
 *  strings — the same set). `line` is only used for error reporting. */
function decodeEscapes(body: string, line: number): string {
  if (!body.includes('\\')) return body;
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c !== '\\') {
      out += c;
      continue;
    }
    const e = body[i + 1];
    if (e === undefined) fail(Math.max(line, 1), 'trailing backslash in string');
    switch (e) {
      case '"': out += '"'; break;
      case '\\': out += '\\'; break;
      case '/': out += '/'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'n': out += '\n'; break;
      case 'r': out += '\r'; break;
      case 't': out += '\t'; break;
      case 'u': {
        const hex = body.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          fail(line, `invalid \\u escape in string`);
        }
        i += 4;
        let code = parseInt(hex, 16);
        // Surrogate pairs: a high surrogate followed by a \uXXXX low surrogate
        // combines into one code point (JSON/TOML basic/YAML double all allow).
        if (code >= 0xd800 && code <= 0xdbff && body.slice(i + 1, i + 3) === '\\u') {
          const hex2 = body.slice(i + 3, i + 7);
          if (/^[0-9a-fA-F]{4}$/.test(hex2)) {
            const low = parseInt(hex2, 16);
            if (low >= 0xdc00 && low <= 0xdfff) {
              code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
              i += 6;
            }
          }
        }
        out += String.fromCodePoint(code);
        break;
      }
      default:
        fail(line, `invalid escape '\\${e}' in string`);
    }
    i++;
  }
  return out;
}

/** Classify a YAML plain (unquoted) scalar per YAML 1.2 core: true/false,
 *  null/Null/NULL/~/empty, decimal/hex/octal integers, floats. Everything
 *  else (including .inf/.nan and datetimes) stays a string — anchors check
 *  existence, never the type. */
function classifyPlain(text: string): string | number | boolean | null {
  const t = text.trim();
  if (t === '' || t === '~' || t === 'null' || t === 'Null' || t === 'NULL') return null;
  if (t === 'true' || t === 'True' || t === 'TRUE') return true;
  if (t === 'false' || t === 'False' || t === 'FALSE') return false;
  if (/^[-+]?[0-9]+$/.test(t)) return parseInt(t, 10);
  const radix = /^[-+]?(0x[0-9a-fA-F]+|0o[0-7]+)$/.exec(t);
  if (radix !== null) {
    const neg = t.startsWith('-');
    const digits = t.replace(/^[-+]?/, '');
    const v = parseInt(digits.slice(2), digits.startsWith('0x') ? 16 : 8);
    return neg ? -v : v;
  }
  if (/^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/.test(t)) {
    const v = Number(t);
    if (Number.isFinite(v)) return v;
  }
  return t;
}

// ── JSON (strict RFC 8259 recursive descent) ──

class JsonParser {
  private pos = 0;
  private line = 1;

  constructor(private readonly src: string) {}

  parseDocument(): SchematicValue {
    this.skipWs();
    if (this.pos >= this.src.length) fail(1, 'empty document is not valid JSON');
    const value = this.parseValue();
    this.skipWs();
    if (this.pos < this.src.length) {
      fail(this.line, `trailing content after the JSON value ('${this.peekAhead()}')`);
    }
    return value;
  }

  private peekAhead(): string {
    return this.src.slice(this.pos, this.pos + 12).replace(/\n.*/s, '…');
  }

  private skipWs(): void {
    while (this.pos < this.src.length) {
      const c = this.src[this.pos]!;
      if (c === '\n') {
        this.line++;
        this.pos++;
      } else if (c === ' ' || c === '\t' || c === '\r') {
        this.pos++;
      } else {
        break;
      }
    }
  }

  private parseValue(): SchematicValue {
    if (this.pos >= this.src.length) fail(this.line, 'unexpected end of input, expecting a value');
    const c = this.src[this.pos]!;
    if (c === '{') return this.parseObject();
    if (c === '[') return this.parseArray();
    if (c === '"') return scalar(this.parseString());
    if (c === 't') {
      this.expectLiteral('true');
      return scalar(true);
    }
    if (c === 'f') {
      this.expectLiteral('false');
      return scalar(false);
    }
    if (c === 'n') {
      this.expectLiteral('null');
      return scalar(null);
    }
    if (c === '-' || (c >= '0' && c <= '9')) return scalar(this.parseNumber());
    fail(this.line, `unexpected character '${c}' where a value was expected`);
  }

  private parseObject(): SchematicValue {
    const line = this.line;
    this.pos++; // {
    const entries: SchematicEntry[] = [];
    this.skipWs();
    if (this.src[this.pos] === '}') {
      this.pos++;
      return { kind: 'object', entries };
    }
    for (;;) {
      this.skipWs();
      if (this.src[this.pos] !== '"') {
        fail(this.line, `expecting a quoted object key, found '${this.peekAhead()}'`);
      }
      const keyLine = this.line;
      const key = this.parseString();
      this.skipWs();
      if (this.src[this.pos] !== ':') fail(this.line, `expecting ':' after key "${key}"`);
      this.pos++;
      this.skipWs();
      const value = this.parseValue();
      // Issue #58 contract: duplicate keys make the document ambiguous — an
      // explicit parse error, never a silent last-wins.
      if (entries.some(e => e.key === key)) {
        fail(keyLine, `duplicate key "${key}" (first defined at line ${findLine(entries, key)})`);
      }
      entries.push({ key, value, line: keyLine });
      this.skipWs();
      const c = this.src[this.pos];
      if (c === ',') {
        this.pos++;
        this.skipWs();
        if (this.src[this.pos] === '}') fail(this.line, 'trailing comma in object');
        continue;
      }
      if (c === '}') {
        this.pos++;
        return { kind: 'object', entries };
      }
      fail(this.line, `expecting ',' or '}' in object, found '${this.peekAhead()}'`);
    }
  }

  private parseArray(): SchematicValue {
    this.pos++; // [
    const items: SchematicValue[] = [];
    this.skipWs();
    if (this.src[this.pos] === ']') {
      this.pos++;
      return { kind: 'array', items };
    }
    for (;;) {
      this.skipWs();
      items.push(this.parseValue());
      this.skipWs();
      const c = this.src[this.pos];
      if (c === ',') {
        this.pos++;
        this.skipWs();
        if (this.src[this.pos] === ']') fail(this.line, 'trailing comma in array');
        continue;
      }
      if (c === ']') {
        this.pos++;
        return { kind: 'array', items };
      }
      fail(this.line, `expecting ',' or ']' in array, found '${this.peekAhead()}'`);
    }
  }

  private parseString(): string {
    // Caller guarantees src[pos] === '"'.
    this.pos++;
    let body = '';
    while (this.pos < this.src.length) {
      const c = this.src[this.pos]!;
      if (c === '"') {
        this.pos++;
        return decodeEscapes(body, this.line);
      }
      if (c === '\\') {
        if (this.pos + 1 >= this.src.length) fail(this.line, 'unterminated string');
        body += c + this.src[this.pos + 1]!;
        this.pos += 2;
        continue;
      }
      if (c === '\n') fail(this.line, 'unterminated string (raw newline inside a JSON string)');
      body += c;
      this.pos++;
    }
    fail(this.line, 'unterminated string');
  }

  private parseNumber(): number {
    const start = this.pos;
    if (this.src[this.pos] === '-') this.pos++;
    if (!/[0-9]/.test(this.src[this.pos] ?? '')) fail(this.line, 'invalid number');
    if (this.src[this.pos] === '0') {
      this.pos++;
    } else {
      while (/[0-9]/.test(this.src[this.pos] ?? '')) this.pos++;
    }
    if (this.src[this.pos] === '.') {
      this.pos++;
      if (!/[0-9]/.test(this.src[this.pos] ?? '')) fail(this.line, 'invalid number (no digits after the decimal point)');
      while (/[0-9]/.test(this.src[this.pos] ?? '')) this.pos++;
    }
    if (this.src[this.pos] === 'e' || this.src[this.pos] === 'E') {
      this.pos++;
      if (this.src[this.pos] === '+' || this.src[this.pos] === '-') this.pos++;
      if (!/[0-9]/.test(this.src[this.pos] ?? '')) fail(this.line, 'invalid number exponent');
      while (/[0-9]/.test(this.src[this.pos] ?? '')) this.pos++;
    }
    const text = this.src.slice(start, this.pos);
    const v = Number(text);
    if (!Number.isFinite(v)) fail(this.line, `invalid number '${text}'`);
    return v;
  }

  private expectLiteral(word: string): void {
    if (this.src.startsWith(word, this.pos)) {
      this.pos += word.length;
      return;
    }
    fail(this.line, `invalid literal (expecting '${word}')`);
  }
}

function findLine(entries: SchematicEntry[], key: string): number {
  return entries.find(e => e.key === key)?.line ?? 0;
}

export function parseJson(source: string): SchematicParse {
  const src = stripBom(source);
  try {
    return { ok: true, root: new JsonParser(src).parseDocument() };
  } catch (e) {
    if (e instanceof SchematicSyntaxError) return { ok: false, line: e.line, message: e.message };
    throw e;
  }
}

// ── YAML (block + flow, the practical subset) ──

/** One physical line, with lazily computed (and, for sequence-item rewrites,
 *  mutable) structural view: indent + comment-stripped right-trimmed text. */
interface YLine {
  raw: string;
  no: number;
  indent: number;
  content: string;
  blank: boolean;
  computed: boolean;
}

class YamlParser {
  private lines: YLine[];
  private pos = 0;

  constructor(source: string) {
    this.lines = stripBom(source).split(/\r?\n/).map((raw, i) => ({
      raw,
      no: i + 1,
      indent: 0,
      content: '',
      blank: false,
      computed: false,
    }));
  }

  // ── line view ──

  private ensure(i: number): YLine {
    const l = this.lines[i]!;
    if (l.computed) return l;
    const stripped = stripHashComment(l.raw).trimEnd();
    const content = stripped.trim();
    if (content !== '') {
      // Structural line: indentation is SPACES ONLY (YAML forbids tabs).
      let n = 0;
      while (l.raw[n] === ' ') n++;
      if (l.raw[n] === '\t') {
        fail(l.no, 'tab indentation is not allowed in YAML (use spaces)');
      }
      l.indent = n;
      // Content is INDENT-STRIPPED: every dispatcher (isDashItem,
      // startsWith, splitYamlKey, flow columns) works on the bare text, with
      // l.indent carrying the column separately.
      l.content = content;
    } else {
      l.indent = -1; // blank / comment-only — never structural
      l.content = '';
    }
    l.blank = content === '';
    l.computed = true;
    return l;
  }

  /** First structural line at index >= this.pos (blank/comment lines are
   *  skipped for good — they carry no structure). Returns null at EOF. */
  private nextStructural(): number | null {
    while (this.pos < this.lines.length) {
      const l = this.ensure(this.pos);
      if (!l.blank) return this.pos;
      this.pos++;
    }
    return null;
  }

  // ── document ──

  parseDocument(): SchematicValue {
    let i = this.nextStructural();
    if (i === null) return scalar(null); // empty document: valid (null) YAML
    if (this.lines[i]!.indent === 0 && this.lines[i]!.content === '---') {
      this.pos++;
      i = this.nextStructural();
      if (i === null) return scalar(null);
    }
    const root = this.parseNode(0, -1);
    // Multi-document YAML: v1 addresses the FIRST document — a later `---`
    // (or the `...` end marker, both only at column 0) terminates it and the
    // rest is ignored.
    const j = this.nextStructural();
    if (j !== null) {
      const l = this.lines[j]!;
      if (l.indent === 0 && l.content !== '---' && l.content !== '...') {
        fail(l.no, `unexpected content ('${l.content.slice(0, 24)}') — not part of the first YAML document`);
      }
    }
    return root;
  }

  // ── block nodes ──

  /** Parse the node starting at the current structural line. `parentIndent`
   *  is the indent of the ENCLOSING block (mapping/sequence/document root,
   *  -1 at the root) — plain-scalar continuation lines may sit at any indent
   *  greater than it. */
  private parseNode(minIndent: number, parentIndent: number): SchematicValue {
    const i = this.nextStructural();
    if (i === null) return scalar(null);
    const l = this.ensure(i);
    const d = l.indent;
    if (d < minIndent) {
      fail(l.no, `internal: node below its minimum indent`); // callers guard this
    }
    const text = l.content;
    if (isDashItem(text)) return this.parseSequence(d);
    if (text.startsWith('{') || text.startsWith('[')) return this.parseFlowAt(i, 0);
    if (text.startsWith('?')) fail(l.no, 'complex mapping keys (? …) are outside the supported YAML subset');
    if (text.startsWith('&') || text.startsWith('*') || text.startsWith('!')) {
      fail(l.no, 'YAML anchors/aliases/tags (& * !) are outside the supported subset');
    }
    if (blockIndicator(text) !== null) return this.parseBlockScalar(parentIndent, text, l.no);
    const kv = splitYamlKey(text);
    if (kv !== null) return this.parseMapping(d);
    return this.parsePlainOrQuoted(text, parentIndent, l.no);
  }

  /** A mapping whose keys sit at indentation exactly `d`. */
  private parseMapping(d: number): SchematicValue {
    const entries: SchematicEntry[] = [];
    // True when the PREVIOUS key had no inline value — the only legal way a
    // `- ` item can appear at the mapping's own indent (YAML allows block
    // sequences at the parent key's indentation).
    let lastWasKeyOnly = false;
    for (;;) {
      const i = this.nextStructural();
      if (i === null) break;
      const l = this.ensure(i);
      if (l.indent < d) break;
      if (l.indent > d) fail(l.no, `unexpected indentation (${l.indent} spaces) at line ${l.no}`);
      const text = l.content;
      // Multi-document YAML: v1 addresses the FIRST document — a `---` (or
      // `...`, only at column 0) at the mapping's own indent ends it; the
      // rest is ignored.
      if (l.indent === 0 && (text === '---' || text === '...')) break;
      if (isDashItem(text)) {
        if (!lastWasKeyOnly) {
          fail(l.no, `unexpected sequence item ('${text.slice(0, 16)}') where a mapping key was expected`);
        }
        entries[entries.length - 1]!.value = this.parseSequence(d);
        lastWasKeyOnly = false;
        continue;
      }
      const kv = splitYamlKey(text);
      if (kv === null) {
        fail(l.no, `expected a 'key: value' mapping entry, found '${text.slice(0, 24)}'`);
      }
      if (kv.key === '<<') {
        fail(l.no, 'merge keys (<<) are outside the supported YAML subset');
      }
      const keyLine = l.no;
      this.pos++; // consume the key line
      let value: SchematicValue;
      if (kv.rest === '') {
        // Value on following lines: a deeper block, or a sequence at this
        // same indent (filled in by the dash case above), or null.
        const j = this.nextStructural();
        if (j === null) {
          value = scalar(null);
          lastWasKeyOnly = false;
        } else if (this.ensure(j).indent > d) {
          value = this.parseNode(this.ensure(j).indent, d);
          lastWasKeyOnly = false;
        } else if (this.ensure(j).indent === d && isDashItem(this.ensure(j).content)) {
          value = scalar(null); // placeholder — the dash case replaces it
          lastWasKeyOnly = true;
        } else {
          value = scalar(null);
          lastWasKeyOnly = false;
        }
      } else {
        const bi = blockIndicator(kv.rest);
        if (bi !== null) {
          value = this.parseBlockScalar(d, kv.rest, keyLine);
        } else {
          value = this.parseInlineValue(kv.rest, d, i, kv.restCol, keyLine);
        }
        lastWasKeyOnly = false;
      }
      if (entries.some(e => e.key === kv.key)) {
        fail(keyLine, `duplicate key '${kv.key}' (first defined at line ${entries.find(e => e.key === kv.key)!.line})`);
      }
      entries.push({ key: kv.key, value, line: keyLine });
    }
    return { kind: 'object', entries };
  }

  /** A block sequence whose `- ` items sit at indentation exactly `d`. */
  private parseSequence(d: number): SchematicValue {
    const items: SchematicValue[] = [];
    for (;;) {
      const i = this.nextStructural();
      if (i === null) break;
      const l = this.ensure(i);
      if (l.indent < d) break;
      if (l.indent > d) fail(l.no, `unexpected indentation (${l.indent} spaces) inside a sequence`);
      if (!isDashItem(l.content)) break; // end of the sequence — caller continues
      if (l.content === '-') {
        // Item content on following (deeper) lines, or an empty item.
        this.pos++;
        const j = this.nextStructural();
        if (j !== null && this.ensure(j).indent > d) {
          items.push(this.parseNode(this.ensure(j).indent, d));
        } else {
          items.push(scalar(null));
        }
        continue;
      }
      // `- name: x` / `- - x` / `- scalar`: rewrite the line so the content
      // after the dash becomes a structural line at its own column, then
      // re-dispatch — the standard trick for inline-started block nodes.
      // (Columns are CONTENT-relative here: content[0] is the dash itself.)
      const content = l.content;
      let c = 1;
      while (content[c] === ' ') c++;
      const restCol = l.indent + c;
      l.indent = restCol;
      l.content = content.slice(c);
      items.push(this.parseNode(restCol, d));
    }
    return { kind: 'array', items };
  }

  /** An inline (after `key:`) or bare value: flow collection, quoted scalar,
   *  or plain scalar with continuation absorption. `restCol` is the column
   *  (within the key line's content) where `rest` starts — the flow parser
   *  needs it to read from the right place on the right line. */
  private parseInlineValue(rest: string, parentIndent: number, keyLineIdx: number, restCol: number, line: number): SchematicValue {
    if (rest.startsWith('{') || rest.startsWith('[')) {
      return this.parseFlowAt(keyLineIdx, restCol);
    }
    return this.parsePlainOrQuoted(rest, parentIndent, line);
  }

  /** A scalar value: quoted (single/double) or plain (typed + continuation
   *  absorption — plain scalars legally continue on lines more indented than
   *  the enclosing block). */
  private parsePlainOrQuoted(text: string, parentIndent: number, line: number): SchematicValue {
    if (text.startsWith('&') || text.startsWith('*') || text.startsWith('!')) {
      fail(line, 'YAML anchors/aliases/tags (& * !) are outside the supported subset');
    }
    if (text.startsWith("'") || text.startsWith('"')) {
      const q = scanQuoted(text, 0, line);
      if (q === null) fail(line, 'unterminated quoted scalar (multi-line quoted scalars are not supported)');
      if (q.end < text.length) {
        fail(line, `unexpected content after a quoted scalar ('${text.slice(q.end, q.end + 16).trim()}')`);
      }
      return scalar(q.value);
    }
    if (text === '<<') fail(line, 'merge keys (<<) are outside the supported subset');
    // Plain scalar: absorb continuation lines (structural, more indented than
    // the enclosing block) as folded text — document markers end the value.
    let value = text;
    for (;;) {
      const j = this.nextStructural();
      if (j === null) break;
      const l = this.ensure(j);
      if (l.indent <= parentIndent) break;
      if (l.indent === 0 && (l.content === '---' || l.content === '...')) break;
      value += ' ' + l.content;
      this.pos = j + 1;
    }
    return scalar(classifyPlain(value));
  }

  /** A `|`/`>` block scalar. Content: raw following lines more indented than
   *  the ENCLOSING block (parentIndent) — comments inside are content. */
  private parseBlockScalar(parentIndent: number, indicator: string, line: number): SchematicValue {
    const bi = blockIndicator(indicator);
    if (bi === 'unsupported') {
      fail(line, `block scalar indicator '${indicator.split(/\s/)[0]}' (explicit indent) is outside the supported subset`);
    }
    if (this.pos < this.lines.length && this.ensure(this.pos).no === line) this.pos++;
    const start = this.pos;
    let end = start;
    while (end < this.lines.length) {
      const raw = this.lines[end]!.raw;
      if (raw.trim() === '') {
        end++;
        continue;
      }
      if (leadingSpaces(raw) > parentIndent) {
        end++;
        continue;
      }
      break;
    }
    // Trailing blank runs are not content (chomping detail — value fidelity
    // beyond existence is not this module's contract).
    let last = end;
    while (last > start && this.lines[last - 1]!.raw.trim() === '') last--;
    const body: string[] = [];
    let contentIndent = -1;
    for (let i = start; i < last; i++) {
      const raw = this.lines[i]!.raw;
      if (raw.trim() === '') {
        body.push('');
        continue;
      }
      if (contentIndent < 0) contentIndent = leadingSpaces(raw);
      body.push(raw.slice(Math.min(contentIndent, leadingSpaces(raw))));
    }
    this.pos = end;
    return scalar(body.join(bi!.fold ? ' ' : '\n'));
  }

  // ── flow collections (possibly spanning lines) ──

  /** Parse a flow collection starting at line `li`, column `col` of its
   *  content. Consumes every line it spans (comment-stripped structural
   *  view); trailing content after the collection is an error. */
  private parseFlowAt(li: number, col: number): SchematicValue {
    const startNo = this.ensure(li).no;
    const chunks: string[] = [this.ensure(li).content.slice(col)];
    let lastLi = li;
    let text = chunks[0]!;
    for (;;) {
      const end = scanFlowComplete(text);
      if (end !== null) {
        const value = parseFlowText(text.slice(0, end), startNo);
        if (text.slice(end).trim() !== '') {
          fail(startNo, `unexpected content after a flow collection ('${text.slice(end).trim().slice(0, 16)}')`);
        }
        this.pos = lastLi + 1;
        return value;
      }
      // Unbalanced: pull the next structural line (flow may span lines).
      const j = this.nextStructuralFrom(lastLi + 1);
      if (j === null) fail(startNo, 'unterminated flow collection');
      lastLi = j;
      chunks.push(' ' + this.ensure(j).content);
      text = chunks.join('');
    }
  }

  /** nextStructural over an explicit start index (does not disturb pos). */
  private nextStructuralFrom(from: number): number | null {
    let i = from;
    while (i < this.lines.length) {
      if (!this.ensure(i).blank) return i;
      i++;
    }
    return null;
  }
}

function leadingSpaces(raw: string): number {
  let n = 0;
  while (raw[n] === ' ') n++;
  return n;
}

function isDashItem(text: string): boolean {
  return text === '-' || text.startsWith('- ');
}

/** `|`, `|-`, `|+`, `>`, `>-`, `>+` block-scalar indicators: {fold, chomp} for
 *  a supported one, 'unsupported' for explicit-indent forms (|2), null when
 *  the text is not an indicator at all. */
function blockIndicator(text: string): { fold: boolean; chomp: string } | 'unsupported' | null {
  const token = text.split(/\s/)[0] ?? '';
  if (token === '' || (token[0] !== '|' && token[0] !== '>')) return null;
  const rest = token.slice(1);
  if (rest === '' || rest === '-' || rest === '+') {
    return { fold: token[0] === '>', chomp: rest };
  }
  return 'unsupported';
}

/** Split a structural line into mapping key + inline value rest, or null when
 *  the line is not mapping-shaped. Mirrors YAML's rules: the colon must be
 *  followed by a space or end-of-line (so `nospace:value` and URLs stay plain
 *  scalars), and quoted keys unquote before use. `restCol` is the CONTENT
 *  column where the value starts. */
function splitYamlKey(text: string): { key: string; rest: string; restCol: number } | null {
  const first = text[0]!;
  if (first === "'" || first === '"') {
    const q = scanQuoted(text, 0, 0);
    if (q === null) return null; // unterminated — the scalar path reports it
    let i = q.end;
    while (text[i] === ' ') i++;
    if (text[i] !== ':') return null;
    if (i + 1 < text.length && text[i + 1] !== ' ') return null;
    return { key: q.value, rest: text.slice(i + 1).trim(), restCol: i + 1 };
  }
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ':' && (i + 1 === text.length || text[i + 1] === ' ')) {
      const key = text.slice(0, i).trimEnd();
      if (key === '') return null;
      return { key, rest: text.slice(i + 1).trim(), restCol: i + 1 };
    }
  }
  return null;
}

/** Does the flow text close a complete top-level value? Returns the index
 *  just past its end, or null when brackets/strings are still open. Quote- and
 *  escape-aware. */
function scanFlowComplete(text: string): number | null {
    let depth = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === "'" || c === '"') {
      const q = scanQuoted(text, i, 0);
      if (q === null) return null;
      i = q.end;
      continue;
    }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return null;
}

/** Parse one complete flow value from `text` (already known balanced). */
function parseFlowText(text: string, line: number): SchematicValue {
  const v = flowValue(text, 0, line);
  return v.value;
}

/** Parse a flow value starting at `pos`; returns the value and the index just
 *  past it. */
function flowValue(text: string, pos: number, line: number): { value: SchematicValue; end: number } {
  let i = pos;
  while (text[i] === ' ') i++;
  const c = text[i]!;
  if (c === '{') {
    const entries: SchematicEntry[] = [];
    i++;
    while (text[i] === ' ') i++;
    if (text[i] === '}') return { value: { kind: 'object', entries }, end: i + 1 };
    for (;;) {
      // key
      let key: string;
      if (text[i] === "'" || text[i] === '"') {
        const q = scanQuoted(text, i, line);
        if (q === null) fail(line, 'unterminated quoted key in flow mapping');
        key = q.value;
        i = q.end;
      } else {
        let j = i;
        while (j < text.length && text[j] !== ':' && text[j] !== ',' && text[j] !== '}' && text[j] !== ']') j++;
        key = text.slice(i, j).trim();
        i = j;
      }
      while (text[i] === ' ') i++;
      if (text[i] !== ':') fail(line, `flow mapping entries need 'key: value' (near '${text.slice(pos, pos + 16)}')`);
      i++;
      const v = flowValue(text, i, line);
      if (entries.some(e => e.key === key)) fail(line, `duplicate key '${key}' in flow mapping`);
      entries.push({ key, value: v.value, line });
      i = v.end;
      while (text[i] === ' ') i++;
      if (text[i] === ',') {
        i++;
        while (text[i] === ' ') i++;
        if (text[i] === '}') fail(line, 'trailing comma in flow mapping');
        continue;
      }
      if (text[i] === '}') return { value: { kind: 'object', entries }, end: i + 1 };
      fail(line, `expecting ',' or '}' in flow mapping (near '${text.slice(i, i + 16)}')`);
    }
  }
  if (c === '[') {
    const items: SchematicValue[] = [];
    i++;
    while (text[i] === ' ') i++;
    if (text[i] === ']') return { value: { kind: 'array', items }, end: i + 1 };
    for (;;) {
      const v = flowValue(text, i, line);
      items.push(v.value);
      i = v.end;
      while (text[i] === ' ') i++;
      if (text[i] === ',') {
        i++;
        while (text[i] === ' ') i++;
        if (text[i] === ']') fail(line, 'trailing comma in flow sequence');
        continue;
      }
      if (text[i] === ']') return { value: { kind: 'array', items }, end: i + 1 };
      fail(line, `expecting ',' or ']' in flow sequence (near '${text.slice(i, i + 16)}')`);
    }
  }
  if (c === "'" || c === '"') {
    const q = scanQuoted(text, i, line);
    if (q === null) fail(line, 'unterminated quoted scalar in flow collection');
    return { value: scalar(q.value), end: q.end };
  }
  // Plain flow scalar: up to the next , } ] (a ':' here means a malformed
  // mapping — caught by the key scan above).
  let j = i;
  while (j < text.length && text[j] !== ',' && text[j] !== '}' && text[j] !== ']') j++;
  return { value: scalar(classifyPlain(text.slice(i, j))), end: j };
}

export function parseYaml(source: string): SchematicParse {
  try {
    return { ok: true, root: new YamlParser(source).parseDocument() };
  } catch (e) {
    if (e instanceof SchematicSyntaxError) return { ok: false, line: e.line, message: e.message };
    throw e;
  }
}

// ── TOML (tables, dotted keys, inline/arrays, multiline strings) ──

class TomlParser {
  private lines: string[];
  private nos: number[];
  private contents: string[];
  private pos = 0;

  constructor(source: string) {
    const raw = stripBom(source).split(/\r?\n/);
    this.lines = raw;
    this.nos = raw.map((_, i) => i + 1);
    this.contents = raw.map(l => stripHashComment(l).trimEnd());
  }

  parse(): SchematicValue {
    const root: SchematicValue = { kind: 'object', entries: [] };
    let current: SchematicValue = root;
    let canonical = '';
    const explicit = new Set<string>();
    const dotted = new Set<string>();
    const inlineArrays = new Set<string>();
    while (this.pos < this.lines.length) {
      const no = this.nos[this.pos]!;
      const text = this.contents[this.pos]!.trim();
      if (text === '') {
        this.pos++;
        continue;
      }
      if (text.startsWith('[[')) {
        const segs = this.headerSegments(text, no, true);
        const res = this.descend(root, segs, 'array', no, explicit, dotted, inlineArrays);
        current = res.node;
        canonical = res.canonical;
        this.pos++;
        continue;
      }
      if (text.startsWith('[')) {
        const segs = this.headerSegments(text, no, false);
        const res = this.descend(root, segs, 'table', no, explicit, dotted, inlineArrays);
        current = res.node;
        canonical = res.canonical;
        this.pos++;
        continue;
      }
      // key = value
      const eq = findUnquotedEq(text, no);
      const keyText = text.slice(0, eq);
      const segs = parseDottedKeyPath(keyText, no);
      const { value, endLi } = this.collectValue(this.pos, eq + 1, text, no);
      this.assign(current, canonical, segs, value, no, dotted, inlineArrays);
      this.pos = endLi + 1;
    }
    return root;
  }

  /** `[a.b]` / `[[a.b]]` → the dotted path segments. */
  private headerSegments(text: string, no: number, arrayForm: boolean): string[] {
    const open = arrayForm ? '[[' : '[';
    const close = arrayForm ? ']]' : ']';
    if (!text.endsWith(close)) {
      fail(no, `unterminated table header ('${text.slice(0, 24)}')`);
    }
    const inner = text.slice(open.length, text.length - close.length);
    if (inner.trim() === '') fail(no, 'empty table header');
    return parseDottedKeyPath(inner, no);
  }

  /** Walk a header path from the root, creating the intermediate tables, and
   *  return the new current table (+ its canonical root path). Enforces the
   *  duplicate rules: explicit [table] twice, [table] over dotted-created
   *  tables, non-table intermediates, [[array]] over static/inline arrays. */
  private descend(
    root: SchematicValue,
    segs: string[],
    kind: 'table' | 'array',
    no: number,
    explicit: Set<string>,
    dotted: Set<string>,
    inlineArrays: Set<string>,
  ): { node: SchematicValue; canonical: string } {
    let node = root;
    let canonical = '';
    for (let s = 0; s < segs.length; s++) {
      const seg = segs[s]!;
      canonical = canonical === '' ? seg : `${canonical}\0${seg}`;
      const last = s === segs.length - 1;
      if (node.kind !== 'object') {
        fail(no, `'${seg}' sits under a non-table value — cannot open a table there`);
      }
      let entry = node.entries.find(e => e.key === seg);
      if (last && kind === 'table') {
        if (entry === undefined) {
          entry = { key: seg, value: { kind: 'object', entries: [] }, line: no };
          node.entries.push(entry);
        } else if (entry.value.kind !== 'object') {
          fail(no, `key '${seg}' is already a value, not a table — cannot define [${segs.join('.')}]`);
        } else if (explicit.has(canonical)) {
          fail(no, `table [${segs.join('.')}] is defined twice`);
        } else if (dotted.has(canonical)) {
          fail(no, `table [${segs.join('.')}] was already defined by dotted keys — redefine is not allowed`);
        }
        explicit.add(canonical);
        node = entry.value;
        continue;
      }
      if (last && kind === 'array') {
        if (entry === undefined) {
          entry = { key: seg, value: { kind: 'array', items: [] }, line: no };
          node.entries.push(entry);
        } else if (entry.value.kind !== 'array') {
          fail(no, `key '${seg}' is already a value, not an array — cannot define [[${segs.join('.')}]]`);
        } else if (inlineArrays.has(canonical)) {
          fail(no, `cannot extend the static (inline) array '${seg}' with [[${segs.join('.')}]]`);
        }
        const table: SchematicValue = { kind: 'object', entries: [] };
        entry.value.items.push(table);
        return { node: table, canonical: `${canonical}\0${entry.value.items.length - 1}` };
      }
      // Intermediate segment: create/verify the sub-table. An array here is
      // an array-of-tables created by [[…]] headers — TOML rule: continue
      // from its LAST element (a static inline array may not be extended).
      if (entry === undefined) {
        entry = { key: seg, value: { kind: 'object', entries: [] }, line: no };
        node.entries.push(entry);
      } else if (entry.value.kind === 'array') {
        if (inlineArrays.has(canonical)) {
          fail(no, `key '${seg}' is a static (inline) array — cannot open [${segs.join('.')}] under it`);
        }
        const item = entry.value.items[entry.value.items.length - 1];
        if (item === undefined || item.kind !== 'object') {
          fail(no, `key '${seg}' is an empty array — cannot open [${segs.join('.')}] under it`);
        }
        node = item;
        continue;
      } else if (entry.value.kind !== 'object') {
        fail(no, `key '${seg}' is not a table — cannot open [${segs.join('.')}] under it`);
      }
      node = entry.value;
    }
    return { node, canonical };
  }

  /** Assign `value` at a (possibly dotted) key path inside `current`. */
  private assign(
    current: SchematicValue,
    currentCanonical: string,
    segs: string[],
    value: SchematicValue,
    no: number,
    dotted: Set<string>,
    inlineArrays: Set<string>,
  ): void {
    let node = current;
    let canonical = currentCanonical;
    for (let s = 0; s < segs.length - 1; s++) {
      const seg = segs[s]!;
      canonical = canonical === '' ? seg : `${canonical}\0${seg}`;
      if (node.kind !== 'object') fail(no, `cannot assign '${segs.join('.')}' under a non-table value`);
      let entry = node.entries.find(e => e.key === seg);
      if (entry === undefined) {
        entry = { key: seg, value: { kind: 'object', entries: [] }, line: no };
        node.entries.push(entry);
        dotted.add(canonical); // dotted-created table: [headers] may not redefine it
      } else if (entry.value.kind !== 'object') {
        fail(no, `key '${seg}' is not a table — cannot use it in the dotted key '${segs.join('.')}'`);
      }
      node = entry.value;
    }
    const last = segs[segs.length - 1]!;
    canonical = canonical === '' ? last : `${canonical}\0${last}`;
    if (node.kind !== 'object') fail(no, `cannot assign '${last}' under a non-table value`);
    if (node.entries.some(e => e.key === last)) {
      fail(no, `duplicate key '${last}'`);
    }
    if (value.kind === 'array') inlineArrays.add(canonical);
    node.entries.push({ key: last, value, line: no });
  }

  /** Collect the value text starting at line `li` (content column `col`).
   *  Bracketed/quoted values may span lines; bare scalars end at EOL. Returns
   *  the parsed value and the last line index it consumed. */
  private collectValue(li: number, col: number, _lineText: string, no: number): { value: SchematicValue; endLi: number } {
    let text = this.contents[li]!.slice(col);
    let endLi = li;
    const startsCollection = /^[\s]*[[{]/.test(text);
    const startsMultilineString = /^\s*("""|''')/.test(text);
    if (startsCollection || startsMultilineString) {
      for (;;) {
        const end = scanTomlValueEnd(text);
        if (end !== null) {
          return { value: parseTomlValueText(text.slice(0, end), no), endLi };
        }
        // Pull the next content line (comments/blanks skipped — legal inside
        // multiline arrays).
        let j = endLi + 1;
        while (j < this.lines.length && this.contents[j]!.trim() === '') j++;
        if (j >= this.lines.length) fail(no, 'unterminated value (missing closing bracket or quote)');
        endLi = j;
        text += '\n' + this.contents[j]!.trimStart();
      }
    }
    const trimmed = text.trim();
    if (trimmed === '') fail(no, `missing value after '='`);
    return { value: parseTomlValueText(trimmed, no), endLi };
  }
}

/** Find the `=` that separates a key path from its value (quote-aware — an
 *  `=` inside a quoted key segment is literal). */
function findUnquotedEq(text: string, no: number): number {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inSingle) {
      if (c === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (c === '\\') i++;
      else if (c === '"') inDouble = false;
      continue;
    }
    if (c === "'") inSingle = true;
    else if (c === '"') inDouble = true;
    else if (c === '=') return i;
  }
  fail(no, `expected 'key = value', found '${text.slice(0, 24)}'`);
}

/** Parse a dotted key path (`a.b."c d"`), quote-aware, segments trimmed. */
function parseDottedKeyPath(text: string, no: number): string[] {
  const segs: string[] = [];
  let i = 0;
  const skipSpaces = (): void => {
    while (text[i] === ' ' || text[i] === '\t') i++;
  };
  for (;;) {
    skipSpaces();
    const c = text[i];
    if (c === undefined) break;
    if (c === '"' || c === "'") {
      const q = scanQuoted(text, i, no);
      if (q === null) fail(no, `unterminated quoted key segment in '${text.slice(0, 24)}'`);
      segs.push(q.value);
      i = q.end;
    } else {
      let j = i;
      while (/[A-Za-z0-9_-]/.test(text[j] ?? '')) j++;
      if (j === i) fail(no, `invalid key syntax in '${text.slice(0, 24)}'`);
      segs.push(text.slice(i, j));
      i = j;
    }
    skipSpaces();
    const d = text[i];
    if (d === '.') {
      i++;
      continue;
    }
    if (d !== undefined) fail(no, `invalid key syntax in '${text.slice(0, 24)}'`);
    break;
  }
  if (segs.length === 0) fail(no, `empty key in '${text.slice(0, 24)}'`);
  return segs;
}

/** Scan ONE complete TOML value at the head of `text`: returns the index just
 *  past it, or null when it does not terminate inside `text` (the caller pulls
 *  another line). String-aware for both quote styles, including the multiline
 *  `'''`/`"""` delimiters. */
function scanTomlValueEnd(text: string): number | null {
  // Leading spaces between '=' and the value are allowed — skip them before
  // dispatching (a value starting with whitespace is otherwise misread as a
  // bare scalar ending at the first newline).
  let k = 0;
  while (text[k] === ' ' || text[k] === '\t') k++;
  const c = text[k]!;
  if (c === '"' || c === "'") {
    const triple = text.slice(k, k + 3) === c.repeat(3);
    if (triple) {
      const close = findTripleClose(text, k + 3, c);
      return close === null ? null : close;
    }
    // Single-line string: must close before the first newline.
    let i = k + 1;
    while (i < text.length) {
      const d = text[i]!;
      if (d === '\n') return null;
      if (c === '"' && d === '\\') {
        i += 2;
        continue;
      }
      if (d === c) return i + 1;
      i++;
    }
    return null;
  }
  if (c === '[' || c === '{') {
    const closer = c === '[' ? ']' : '}';
    const open = c;
    let depth = 0;
    let i = k;
    while (i < text.length) {
      const d = text[i]!;
      if (d === '"' || d === "'") {
        const end = scanTomlValueEnd(text.slice(i));
        if (end === null) return null;
        i += end;
        continue;
      }
      if (d === open) depth++;
      else if (d === closer) {
        depth--;
        if (depth === 0) return i + 1;
      }
      i++;
    }
    return null;
  }
  // Bare scalar: to end of line.
  const nl = text.indexOf('\n');
  return nl === -1 ? text.length : nl;
}

/** Find the closing triple quote ('"""/'''') starting the search at `from`.
 *  For basic strings (") an escape pair may straddle the delimiter. */
function findTripleClose(text: string, from: number, quote: string): number | null {
  let i = from;
  while (i < text.length) {
    const c = text[i]!;
    if (quote === '"' && c === '\\') {
      i += 2;
      continue;
    }
    if (c === quote && text.slice(i, i + 3) === quote.repeat(3)) return i + 3;
    i++;
  }
  return null;
}

/** Parse one complete TOML value (the collected text of exactly one value). */
function parseTomlValueText(text: string, no: number): SchematicValue {
  const v = tomlValue(text, 0, no);
  let i = v.end;
  while (text[i] === ' ' || text[i] === '\t') i++;
  if (text.slice(0, i).trim() !== text.slice(0, v.end).trim() || v.end < text.length) {
    // Leftover after the value (spaces were skipped — anything else is junk).
    let j = v.end;
    while (j < text.length && (text[j] === ' ' || text[j] === '\t' || text[j] === '\n')) j++;
    if (j < text.length) {
      fail(no, `unexpected content after the value ('${text.slice(j, j + 16)}')`);
    }
  }
  return v.value;
}

/** Recursive TOML value parser over `text` from `pos`. */
function tomlValue(text: string, pos: number, no: number): { value: SchematicValue; end: number } {
  let i = pos;
  while (text[i] === ' ' || text[i] === '\t' || text[i] === '\n') i++;
  const c = text[i]!;
  if (c === undefined) fail(no, 'missing value');
  if (c === '"') {
    if (text.startsWith('"""', i)) {
      const close = findTripleClose(text, i + 3, '"');
      if (close === null) fail(no, 'unterminated multiline basic string');
      const body = text.slice(i + 3, close - 3);
      return { value: scalar(decodeEscapes(body.replace(/\\\n\s*/g, ''), no)), end: close };
    }
    const q = scanQuoted(text, i);
    if (q === null) fail(no, 'unterminated basic string');
    if (q.value.includes('\n')) fail(no, 'raw newline in a single-line basic string');
    return { value: scalar(q.value), end: q.end };
  }
  if (c === "'") {
    if (text.startsWith("'''", i)) {
      const close = findTripleClose(text, i + 3, "'");
      if (close === null) fail(no, 'unterminated multiline literal string');
      return { value: scalar(text.slice(i + 3, close - 3)), end: close };
    }
    const q = scanQuoted(text, i);
    if (q === null) fail(no, 'unterminated literal string');
    if (q.value.includes('\n')) fail(no, 'raw newline in a single-line literal string');
    return { value: scalar(q.value), end: q.end };
  }
  if (c === '[') {
    const items: SchematicValue[] = [];
    i++;
    for (;;) {
      while (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === ',') i++;
      if (text[i] === ']') return { value: { kind: 'array', items }, end: i + 1 };
      if (text[i] === undefined) fail(no, 'unterminated array');
      const v = tomlValue(text, i, no);
      items.push(v.value);
      i = v.end;
      while (text[i] === ' ' || text[i] === '\t' || text[i] === '\n') i++;
      if (text[i] !== ',' && text[i] !== ']') {
        fail(no, `expecting ',' or ']' in array (near '${text.slice(i, i + 16)}')`);
      }
    }
  }
  if (c === '{') {
    const entries: SchematicEntry[] = [];
    i++;
    for (;;) {
      while (text[i] === ' ' || text[i] === '\t' || text[i] === '\n') i++;
      if (text[i] === '}') return { value: { kind: 'object', entries }, end: i + 1 };
      if (text[i] === undefined) fail(no, 'unterminated inline table');
      // key
      let key: string;
      if (text[i] === '"' || text[i] === "'") {
        const q = scanQuoted(text, i);
        if (q === null) fail(no, 'unterminated quoted key in inline table');
        key = q.value;
        i = q.end;
      } else {
        let j = i;
        while (/[A-Za-z0-9_-]/.test(text[j] ?? '')) j++;
        if (j === i) fail(no, `invalid key in inline table (near '${text.slice(i, i + 16)}')`);
        key = text.slice(i, j);
        i = j;
      }
      while (text[i] === ' ' || text[i] === '\t') i++;
      if (text[i] !== '=') fail(no, `expecting '=' in inline table (near '${text.slice(i, i + 16)}')`);
      i++;
      const v = tomlValue(text, i, no);
      if (entries.some(e => e.key === key)) fail(no, `duplicate key '${key}' in inline table`);
      entries.push({ key, value: v.value, line: no });
      i = v.end;
      while (text[i] === ' ' || text[i] === '\t' || text[i] === '\n') i++;
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === '}') return { value: { kind: 'object', entries }, end: i + 1 };
      fail(no, `expecting ',' or '}' in inline table (near '${text.slice(i, i + 16)}')`);
    }
  }
  // Bare token: bool / number / datetime-as-string. (The class escapes `]`:
  // an unescaped `]` would close the character class early and the scan would
  // run to end-of-text — commas and brackets never stopped it.)
  let j = i;
  while (j < text.length && !/[\s,\]}#]/.test(text[j]!)) j++;
  const token = text.slice(i, j);
  if (token === '') fail(no, 'missing value');
  return { value: scalar(classifyTomlBare(token)), end: j };
}

/** Classify a bare TOML token: booleans and numbers typed, datetimes (and
 *  anything else) read as string scalars — existence is the check, not type. */
function classifyTomlBare(token: string): string | number | boolean {
  if (token === 'true') return true;
  if (token === 'false') return false;
  if (/^[+-]?inf$/.test(token)) return token.startsWith('-') ? -Infinity : Infinity;
  if (/^[+-]?nan$/.test(token)) return NaN;
  const cleaned = token.replace(/_/g, '');
  if (/^[+-]?[0-9]+$/.test(cleaned)) return parseInt(cleaned, 10);
  if (/^[+-]?(0x[0-9a-fA-F]+|0o[0-7]+|0b[01]+)$/.test(cleaned)) {
    const neg = cleaned.startsWith('-');
    const digits = cleaned.replace(/^[+-]?/, '');
    const v = parseInt(digits.slice(2), digits.startsWith('0x') ? 16 : digits.startsWith('0o') ? 8 : 2);
    return neg ? -v : v;
  }
  if (/^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$/.test(cleaned)) {
    const v = Number(cleaned);
    if (Number.isFinite(v)) return v;
  }
  return token;
}

export function parseToml(source: string): SchematicParse {
  try {
    return { ok: true, root: new TomlParser(source).parse() };
  } catch (e) {
    if (e instanceof SchematicSyntaxError) return { ok: false, line: e.line, message: e.message };
    throw e;
  }
}

function stripBom(source: string): string {
  return source.startsWith('﻿') ? source.slice(1) : source;
}

// ── Format detection + entry point ──

const SCHEMATIC_EXT_RE = /\.(json|yaml|yml|toml)$/i;

/** Which schematic format (issue #58 v1) a target path is, by extension
 *  (case-insensitive): .json → json, .yaml/.yml → yaml, .toml → toml, null
 *  for everything else. */
export function schematicFormatFor(path: string): SchematicFormat | null {
  const m = SCHEMATIC_EXT_RE.exec(path);
  if (m === null) return null;
  const ext = m[1]!.toLowerCase();
  if (ext === 'json') return 'json';
  if (ext === 'yaml' || ext === 'yml') return 'yaml';
  return 'toml';
}

export function parseSchematic(format: SchematicFormat, source: string): SchematicParse {
  if (format === 'json') return parseJson(source);
  if (format === 'yaml') return parseYaml(source);
  return parseToml(source);
}

// ── The anchor path grammar ──

/** Parse an anchor into path segments (keys stay strings; array indices are
 *  matched as digit strings against the node kind at walk time). Escapes:
 *  `\X` reads as a literal X — so `a\.b` is ONE segment `a.b`, `\\` a literal
 *  backslash, `\[`/`\]` literal brackets. Both `items.0` and `items[0]` are
 *  index spellings and compose (`m[0][1]`, `items.0.name`).
 *  Returns null for malformed paths (empty segment, bad bracket) — callers
 *  fall back to treating the anchor as one literal name. */
export function parseAnchorPath(anchor: string): string[] | null {
  if (anchor === '') return null;
  const segments: string[] = [];
  let i = 0;
  const n = anchor.length;
  // Leading bracket indices on a root array: `[0]`, `[0][1]`.
  while (i < n && anchor[i] === '[') {
    const close = anchor.indexOf(']', i);
    if (close === -1) return null;
    const digits = anchor.slice(i + 1, close);
    if (!/^\d+$/.test(digits)) return null;
    segments.push(digits);
    i = close + 1;
    if (i < n && anchor[i] === '.') {
      i++;
      if (i >= n) return null;
    }
  }
  while (i < n) {
    // One name segment.
    let seg = '';
    while (i < n && anchor[i] !== '.' && anchor[i] !== '[') {
      if (anchor[i] === '\\') {
        if (i + 1 >= n) return null; // trailing lone backslash
        seg += anchor[i + 1]!;
        i += 2;
        continue;
      }
      seg += anchor[i]!;
      i++;
    }
    if (seg === '') return null; // `a..b`, leading/trailing dot
    segments.push(seg);
    // Bracket index suffixes: `items[0]`, `m[0][1]`.
    while (i < n && anchor[i] === '[') {
      const close = anchor.indexOf(']', i);
      if (close === -1) return null;
      const digits = anchor.slice(i + 1, close);
      if (!/^\d+$/.test(digits)) return null;
      segments.push(digits);
      i = close + 1;
    }
    if (i < n && anchor[i] === '.') {
      i++;
      if (i >= n) return null;
      continue;
    }
    if (i < n) return null; // only '.', '[' or end can follow a segment
  }
  return segments;
}

/** Escape a key segment for display/path form: `\` `.` `[` `]` get a
 *  backslash, so parseAnchorPath round-trips. */
function escapeSegment(seg: string): string {
  return seg.replace(/([\\.\[\]])/g, '\\$1');
}

// ── Resolution ──

/** Key ↔ segment equivalence: the SAME §12 anchor normalization as
 *  refs.ts anchorMatches (exact, else case-/separator-insensitive) — mirrored
 *  here so schematic.ts stays free of a refs.ts import cycle. The two must
 *  never diverge. */
function sameAnchorName(a: string, b: string): boolean {
  if (a === b) return true;
  return normalizeForAnchor(a) === normalizeForAnchor(b);
}

export type SchematicAnchorResolution =
  | { status: 'leaf'; path: string }
  | { status: 'object'; path: string }
  | { status: 'ambiguous'; name: string; matches: string[] }
  | { status: 'missing' };

/** Resolve an anchor against a parsed schematic tree.
 *
 *  Order of verdicts (issue #58 checker contract):
 *   1. PATH walk — every segment resolves (exact key first, else a UNIQUE
 *      §12-normalized key match; arrays need digit indices). Completing the
 *      walk resolves the address: a scalar leaf is `leaf`; a map/array is
 *      `object` — a VALID ADDRESS that is never presented as leaf proof.
 *   2. FLAT fallback (single-segment anchors only, the issue #49 behavior):
 *      the segment must match exactly ONE key ANYWHERE in the document —
 *      one match resolves; two or more are `ambiguous` (error listing the
 *      full paths); zero falls through to the caller's bullet vocabulary.
 *   3. Anything else is `missing`. */
export function resolveSchematicAnchor(root: SchematicValue, anchor: string): SchematicAnchorResolution {
  const segments = parseAnchorPath(anchor) ?? [anchor];
  // 1. Path walk.
  let node: SchematicValue = root;
  const walked: string[] = [];
  let pathFailed = false;
  for (const seg of segments) {
    if (node.kind === 'object') {
      const entry = objectEntryFor(node.entries, seg);
      if (entry === null || entry === 'ambiguous') {
        pathFailed = true;
        break;
      }
      walked.push(escapeSegment(entry.key));
      node = entry.value;
      continue;
    }
    if (node.kind === 'array') {
      if (!/^\d+$/.test(seg) || Number(seg) >= node.items.length) {
        pathFailed = true;
        break;
      }
      walked.push(seg);
      node = node.items[Number(seg)]!;
      continue;
    }
    pathFailed = true; // scalar mid-path
    break;
  }
  if (!pathFailed) {
    const path = walked.join('.');
    return node.kind === 'scalar' ? { status: 'leaf', path } : { status: 'object', path };
  }
  // 2. Flat fallback: single-segment only.
  if (segments.length === 1) {
    const name = segments[0]!;
    const matches: Array<{ path: string; node: SchematicValue }> = [];
    collectFlatMatches(root, name, [], matches);
    if (matches.length === 1) {
      const m = matches[0]!;
      return m.node.kind === 'scalar'
        ? { status: 'leaf', path: m.path }
        : { status: 'object', path: m.path };
    }
    if (matches.length >= 2) {
      return { status: 'ambiguous', name, matches: matches.map(m => m.path) };
    }
  }
  // 3. Missing.
  return { status: 'missing' };
}

/** Exact key match first; else the unique §12-normalized match; multiple
 *  normalized matches make the path ambiguous (treated as a miss — the flat
 *  pass or the caller's suggestions take over). */
function objectEntryFor(entries: SchematicEntry[], segment: string): SchematicEntry | 'ambiguous' | null {
  for (const e of entries) {
    if (e.key === segment) return e;
  }
  const norm = entries.filter(e => sameAnchorName(e.key, segment));
  if (norm.length === 1) return norm[0]!;
  if (norm.length >= 2) return 'ambiguous';
  return null;
}

/** Depth-first, document-order walk collecting every object ENTRY whose key
 *  matches `name` (flat, any depth — the issue #49 vocabulary). */
function collectFlatMatches(
  node: SchematicValue,
  name: string,
  prefix: string[],
  out: Array<{ path: string; node: SchematicValue }>,
): void {
  if (node.kind === 'object') {
    for (const e of node.entries) {
      const segs = [...prefix, escapeSegment(e.key)];
      if (sameAnchorName(e.key, name)) {
        out.push({ path: segs.join('.'), node: e.value });
      }
      collectFlatMatches(e.value, name, segs, out);
    }
    return;
  }
  if (node.kind === 'array') {
    for (let i = 0; i < node.items.length; i++) {
      collectFlatMatches(node.items[i]!, name, [...prefix, String(i)], out);
    }
  }
}

// ── The addressable vocabulary ──

export interface SchematicAddresses {
  /** Every addressable path in escaped dot form, document order: object keys
   *  (intermediate and leaf) and array indices — `database`,
   *  `database.host`, `items`, `items.0`, `items.0.name`, … */
  paths: string[];
  /** Every object KEY NAME (unescaped, flat — the issue #49 vocabulary),
   *  document order, duplicates possible. */
  names: string[];
}

export function schematicAddresses(root: SchematicValue): SchematicAddresses {
  const paths: string[] = [];
  const names: string[] = [];
  const walk = (node: SchematicValue, prefix: string): void => {
    if (node.kind === 'object') {
      for (const e of node.entries) {
        const path = prefix === '' ? escapeSegment(e.key) : `${prefix}.${escapeSegment(e.key)}`;
        paths.push(path);
        names.push(e.key);
        walk(e.value, path);
      }
      return;
    }
    if (node.kind === 'array') {
      for (let i = 0; i < node.items.length; i++) {
        const path = prefix === '' ? String(i) : `${prefix}.${i}`;
        paths.push(path);
        walk(node.items[i]!, path);
      }
    }
  };
  walk(root, '');
  return { paths, names };
}
