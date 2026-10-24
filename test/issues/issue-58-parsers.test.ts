/**
 * Issue #58 unit tests — the schematic parsers and the anchor path grammar
 * (src/core/schematic.ts), independent of the ref engine.
 *
 * The module under test is a hand-rolled, dependency-free (repo law: zero
 * runtime deps on BOTH runtimes — no Bun.TOML, no js-yaml) recursive-descent
 * trio: strict RFC-8259 JSON, a practical YAML subset (block + flow), and a
 * TOML subset (tables, [[arrays-of-tables]], dotted keys, inline/multiline
 * values). Beyond-subset constructs are EXPLICIT unsupported errors — never a
 * silent pass (the module's SchematicParse outcome folds them into ok:false).
 *
 * Test map:
 *   p1-p4   JSON: strictness (trailing comma, duplicate key, trailing
 *           content, comments-as-jsonc rejected), escapes (\uXXXX +
 *           surrogate pair), value typing round-trip
 *   y1-y10  YAML: nested block mappings/sequences (indented AND flush
 *           sequence style), flow collections (single- and multi-line),
 *           block scalars (| and >-, chomping indifference), quoted keys,
 *           plain-scalar typing (YAML 1.2 core), comments, duplicate keys,
 *           tab indentation, the unsupported subset (& * !, <<:, ?, |2,
 *           multi-line quoted), multi-document (v1 = first document)
 *   t1-t8   TOML: [tables], [[arrays-of-tables]] (+ subtables under the
 *           last element, second [[...]] item), dotted keys, quoted keys,
 *           inline tables and arrays, multi-line arrays, multiline strings,
 *           integers (underscores, 0x/0o/0b), inf/nan, datetimes-as-string,
 *           duplicate key/table rejection, out-of-order super-tables
 *   g1-g5   parseAnchorPath: dot / bracket / mixed spellings, escapes,
 *           malformed paths (empty segment, trailing dot, lone backslash,
 *           non-digit bracket)
 *   r1-r9   resolveSchematicAnchor: leaf, object, ambiguous (flat name ×
 *           multiple leaves), missing, flat-unique at depth, flat inside
 *           sequences, §12 case/separator normalization per segment, index
 *           forms, escaped dotted keys
 *   a1-a2   schematicAddresses (escaped paths + flat names, document order)
 *           and schematicFormatFor (extension table, case-insensitive)
 */
import { describe, test, expect } from '../testing.ts';

import {
  parseJson, parseYaml, parseToml, parseSchematic,
  schematicFormatFor, parseAnchorPath, resolveSchematicAnchor, schematicAddresses,
} from '../../src/core/schematic.ts';

// ── JSON ──

describe('issue #58: parseJson — strict RFC 8259', () => {
  test('p1: objects, arrays, strings, numbers, literals; nesting round-trips', () => {
    const p = parseJson('{"a": [1, 2.5, -3e2], "b": {"c": "x\\ny", "d": true, "e": null}}');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.root).toEqual({
      kind: 'object',
      entries: [
        { key: 'a', value: { kind: 'array', items: [{ kind: 'scalar', value: 1 }, { kind: 'scalar', value: 2.5 }, { kind: 'scalar', value: -300 }] }, line: 1 },
        { key: 'b', value: { kind: 'object', entries: [
          { key: 'c', value: { kind: 'scalar', value: 'x\ny' }, line: 1 },
          { key: 'd', value: { kind: 'scalar', value: true }, line: 1 },
          { key: 'e', value: { kind: 'scalar', value: null }, line: 1 },
        ] }, line: 1 },
      ],
    });
  });

  test('p2: \\uXXXX escapes and surrogate pairs decode to one code point', () => {
    const p = parseJson('{"k": "\\u00e9 \\ud83d\\ude00"}');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const v = p.root.kind === 'object' ? p.root.entries[0]!.value : null;
    expect(v && v.kind === 'scalar' ? v.value : null).toBe('é 😀');
  });

  test('p3: strictness — trailing comma, duplicate key, trailing content, comments all reject with a line', () => {
    const trailingComma = parseJson('{"a": 1,}');
    expect(trailingComma.ok).toBe(false);
    if (!trailingComma.ok) expect(trailingComma.line).toBe(1);

    // Duplicate keys are an explicit parse error (issue #58 open question,
    // decided: ambiguous documents are rejected, never silently last-wins).
    const dup = parseJson('{\n  "a": 1,\n  "a": 2\n}');
    expect(dup.ok).toBe(false);
    if (!dup.ok) {
      expect(dup.line).toBe(3);
      expect(dup.message).toContain('duplicate key "a"');
    }

    const junk = parseJson('{"a": 1} oops');
    expect(junk.ok).toBe(false);
    if (!junk.ok) expect(junk.message).toContain('trailing content');

    // JSONC (comments) is NOT a v1 format — rejected, never silently passed.
    const comments = parseJson('{\n// note\n"a": 1}');
    expect(comments.ok).toBe(false);
    if (!comments.ok) expect(comments.message).toContain('quoted object key');
  });

  test('p4: empty document and bare scalars are handled (root need not be an object)', () => {
    expect(parseJson('').ok).toBe(false); // an empty file is not valid JSON
    const arr = parseJson('[1, 2]');
    expect(arr.ok).toBe(true);
    if (arr.ok) expect(arr.root.kind).toBe('array');
  });
});

// ── YAML ──

describe('issue #58: parseYaml — the practical block+flow subset', () => {
  test('y1: nested block mappings, indented AND flush sequence style', () => {
    const src = [
      'database:',
      '  host: db.local',
      '  port: 5432',
      'items:',            // flush style: dash at the key's own indent
      '- name: a',
      '  tags:',
      '    - x',
      '    - y',
      '- name: b',
    ].join('\n');
    const p = parseYaml(src);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const db = p.root.kind === 'object' ? p.root.entries.find(e => e.key === 'database') : undefined;
    expect(db && db.value.kind === 'object' ? db.value.entries.map(e => e.key) : null).toEqual(['host', 'port']);
    const items = p.root.kind === 'object' ? p.root.entries.find(e => e.key === 'items') : undefined;
    expect(items && items.value.kind === 'array' ? items.value.items.length : null).toBe(2);
    const first = items && items.value.kind === 'array' ? items.value.items[0] : null;
    expect(first && first.kind === 'object' ? first.entries.map(e => e.key) : null).toEqual(['name', 'tags']);
    const tags = first && first.kind === 'object' ? first.entries.find(e => e.key === 'tags') : undefined;
    expect(tags && tags.value.kind === 'array' ? tags.value.items.map(i => i.kind === 'scalar' ? i.value : null) : null).toEqual(['x', 'y']);
  });

  test('y2: flow collections, single- and multi-line, nested', () => {
    const p = parseYaml('a: {b: 1, c: [x, y]}\nd:\n  {\n    e: 2\n  }\n');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const a = p.root.kind === 'object' ? p.root.entries.find(x => x.key === 'a') : undefined;
    expect(a && a.value.kind === 'object'
      ? a.value.entries.map(e => [e.key, e.value.kind === 'scalar' ? e.value.value : e.value.kind])
      : null).toEqual([['b', 1], ['c', 'array']]);
    const d = p.root.kind === 'object' ? p.root.entries.find(x => x.key === 'd') : undefined;
    expect(d && d.value.kind === 'object' ? d.value.entries.map(e => e.key) : null).toEqual(['e']);
  });

  test('y3: block scalars | and >-, comments inside are content', () => {
    const p = parseYaml('desc: |\n  line one\n  # not a comment\nnext: 1\nfold: >-\n  a\n  b\n');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const scalarOf = (k: string): string | null => {
      if (p.root.kind !== 'object') return null;
      const e = p.root.entries.find(x => x.key === k);
      return e !== undefined && e.value.kind === 'scalar' && typeof e.value.value === 'string'
        ? e.value.value
        : null;
    };
    expect(scalarOf('desc')).toBe('line one\n# not a comment\n'); // clip: one trailing newline
    expect(scalarOf('fold')).toBe('a b'); // folded, strip chomping
    expect(scalarOf('next')).toBeNull(); // 1 is a number, not a string — but present:
    expect(p.root.kind === 'object' ? p.root.entries.some(e => e.key === 'next') : false).toBe(true);
  });

  test('y4: quoted keys, quoted scalars, plain-scalar typing (YAML 1.2 core)', () => {
    const p = parseYaml([
      "'maintenance window': weekly",
      '"data protection": strict',
      'n1: 42',
      'n2: 0x1f',
      'f1: 3.5',
      'b: true',
      'b2: TRUE',
      'nul: null',
      'tilde: ~',
      'str: not-a-number',
      'url: http://example.com/x',
    ].join('\n'));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const val = (k: string): unknown => {
      const e = p.root.kind === 'object' ? p.root.entries.find(x => x.key === k) : undefined;
      return e && e.value.kind === 'scalar' ? e.value.value : e ? e.value.kind : undefined;
    };
    expect(p.root.kind === 'object' ? p.root.entries.map(e => e.key) : null).toEqual([
      'maintenance window', 'data protection', 'n1', 'n2', 'f1', 'b', 'b2', 'nul', 'tilde', 'str', 'url',
    ]);
    expect(val('n1')).toBe(42);
    expect(val('n2')).toBe(31);
    expect(val('f1')).toBe(3.5);
    expect(val('b')).toBe(true);
    expect(val('b2')).toBe(true);
    expect(val('nul')).toBe(null);
    expect(val('tilde')).toBe(null);
    expect(val('str')).toBe('not-a-number');
    // `nospace:value` (colon without a space) is a plain SCALAR, not a key —
    // as the document root it parses as a scalar document, exactly like a URL.
    const bare = parseYaml('nospace:value');
    expect(bare.ok).toBe(true);
    if (bare.ok) expect(bare.root).toEqual({ kind: 'scalar', value: 'nospace:value' });
  });

  test('y5: comments and blank lines never carry structure', () => {
    const p = parseYaml('# top\n\na: 1  # trailing\n\n# between\nb: 2\n');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.root.kind === 'object' ? p.root.entries.map(e => e.key) : null).toEqual(['a', 'b']);
  });

  test('y6: duplicate keys are a parse error with the first line named', () => {
    const p = parseYaml('a: 1\nb: 2\na: 3\n');
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(p.line).toBe(3);
      expect(p.message).toContain("duplicate key 'a'");
      expect(p.message).toContain('line 1');
    }
  });

  test('y7: tab indentation is rejected (YAML forbids tabs for structure)', () => {
    const p = parseYaml('a:\n\tb: 1\n');
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.message).toContain('tab indentation');
  });

  test('y8: beyond-subset constructs are EXPLICIT unsupported errors, never silent', () => {
    const cases: Array<[string, string, RegExp]> = [
      ['a: &x 1', 'anchor definition', /anchors\/aliases\/tags/],
      ['a: *x', 'alias use', /anchors\/aliases\/tags/],
      ['a: !!str 1', 'tag', /anchors\/aliases\/tags/],
      ['x: 1\n<<: 2', 'merge key', /merge keys/],
      ['? complex\n: value', 'complex key', /complex mapping keys/],
      ['a: |2\n    x', 'explicit-indent block scalar', /explicit indent/],
      ['a: "unterminated', 'unterminated quote', /unterminated/],
    ];
    for (const [src, what, re] of cases) {
      const p = parseYaml(src);
      expect(p.ok).toBe(false);
      if (!p.ok) expect(p.message).toMatch(re);
      void what;
    }
  });

  test('y9: multi-document input — v1 addresses the FIRST document (a later --- ends it)', () => {
    const p = parseYaml('a: 1\n---\nb: 2\n');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.root.kind === 'object' ? p.root.entries.map(e => e.key) : null).toEqual(['a']);
    // A leading --- is consumed; ... terminates like ---
    const q = parseYaml('---\na: 1\n...\n');
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    expect(q.root.kind === 'object' ? q.root.entries.map(e => e.key) : null).toEqual(['a']);
  });

  test('y10: an empty document is valid (null root), CRLF tolerated', () => {
    const empty = parseYaml('');
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.root).toEqual({ kind: 'scalar', value: null });
    const crlf = parseYaml('a: 1\r\nb: 2\r\n');
    expect(crlf.ok).toBe(true);
    if (!crlf.ok) return;
    expect(crlf.root.kind === 'object' ? crlf.root.entries.map(e => e.key) : null).toEqual(['a', 'b']);
  });
});

// ── TOML ──

describe('issue #58: parseToml — tables, arrays of tables, dotted keys', () => {
  test('t1: [tables], keys, value typing (ints with underscores/radix, floats, bools)', () => {
    const p = parseToml([
      '[database]',
      'host = "db.local"',
      'port = 5432',
      'big = 1_000_000',
      'hex = 0x1f',
      'oct = 0o17',
      'bin = 0b101',
      'ratio = 0.5',
      'exp = 1e3',
      'on = true',
      'off = false',
      'when = 1979-05-27T07:32:00Z',
    ].join('\n'));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const val = (k: string): unknown => {
      const e = p.root.kind === 'object' ? p.root.entries.find(x => x.key === 'database') : undefined;
      const inner = e && e.value.kind === 'object' ? e.value.entries.find(x => x.key === k) : undefined;
      return inner && inner.value.kind === 'scalar' ? inner.value.value : undefined;
    };
    expect(val('port')).toBe(5432);
    expect(val('big')).toBe(1000000);
    expect(val('hex')).toBe(31);
    expect(val('oct')).toBe(15);
    expect(val('bin')).toBe(5);
    expect(val('ratio')).toBe(0.5);
    expect(val('exp')).toBe(1000);
    expect(val('on')).toBe(true);
    expect(val('off')).toBe(false);
    // Datetimes (and any exotic scalar) read as strings — existence is the
    // check, never the type (issue #58 "What this is not").
    expect(val('when')).toBe('1979-05-27T07:32:00Z');
  });

  test('t2: [[arrays-of-tables]] — items, subtables under the LAST element, second item', () => {
    const p = parseToml([
      '[[products]]',
      'name = "hammer"',
      '[products.physical]',
      'weight = 5',
      '[[products]]',
      'name = "nail"',
    ].join('\n'));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const products = p.root.kind === 'object' ? p.root.entries.find(e => e.key === 'products') : undefined;
    expect(products && products.value.kind === 'array' ? products.value.items.length : null).toBe(2);
    const first = products && products.value.kind === 'array' ? products.value.items[0] : null;
    expect(first && first.kind === 'object' ? first.entries.map(e => e.key) : null).toEqual(['name', 'physical']);
    const second = products && products.value.kind === 'array' ? products.value.items[1] : null;
    expect(second && second.kind === 'object' ? second.entries.map(e => e.key) : null).toEqual(['name']);
  });

  test('t3: dotted keys, quoted keys (spaces), out-of-order super-tables', () => {
    const p = parseToml([
      '[owner]',
      '"full name" = "Ann"',
      'dotted.key = 1',
      '[a.b]',
      'x = 1',
      '[a]',
      'y = 2',
    ].join('\n'));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const owner = p.root.kind === 'object' ? p.root.entries.find(e => e.key === 'owner') : undefined;
    expect(owner && owner.value.kind === 'object' ? owner.value.entries.map(e => e.key) : null).toEqual(['full name', 'dotted']);
    const a = p.root.kind === 'object' ? p.root.entries.find(e => e.key === 'a') : undefined;
    expect(a && a.value.kind === 'object' ? a.value.entries.map(e => e.key) : null).toEqual(['b', 'y']);
  });

  test('t4: inline tables and arrays, multi-line arrays with comments', () => {
    const p = parseToml([
      'inline = {a = 1, b = [2, 3]}',
      'nums = [1, 2,',
      '  3,  # comment inside',
      ']',
    ].join('\n'));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const val = (k: string) => {
      if (p.root.kind !== 'object') return undefined;
      return p.root.entries.find(x => x.key === k)?.value;
    };
    const inline = val('inline');
    expect(inline !== undefined && inline.kind === 'object' ? inline.entries.map(e => e.key) : null).toEqual(['a', 'b']);
    const nums = val('nums');
    expect(nums !== undefined && nums.kind === 'array'
      ? nums.items.map(i => (i.kind === 'scalar' ? i.value : null)) : null).toEqual([1, 2, 3]);
  });

  test('t5: multiline basic and literal strings; escapes in basic strings', () => {
    const p = parseToml([
      'basic = """',
      'line one',
      'line two"""',
      "literal = '''",
      'raw \\n stays',
      "'''",
      'esc = "a\\tb"',
    ].join('\n'));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const val = (k: string): unknown => {
      const e = p.root.kind === 'object' ? p.root.entries.find(x => x.key === k) : undefined;
      return e && e.value.kind === 'scalar' ? e.value.value : undefined;
    };
    expect(val('basic')).toBe('line one\nline two');
    expect(val('literal')).toBe('raw \\n stays\n'); // the newline before ''' is content (TOML)
    expect(val('esc')).toBe('a\tb');
  });

  test('t6: duplicate keys and duplicate tables are parse errors', () => {
    const dupKey = parseToml('a = 1\na = 2\n');
    expect(dupKey.ok).toBe(false);
    if (!dupKey.ok) expect(dupKey.message).toContain("duplicate key 'a'");
    const dupTable = parseToml('[a]\nx = 1\n[a]\ny = 2\n');
    expect(dupTable.ok).toBe(false);
    if (!dupTable.ok) expect(dupTable.message).toContain('defined twice');
    // A dotted-key-created table may not be re-opened by a [header].
    const dotted = parseToml('a.b = 1\n[a]\nc = 2\n');
    expect(dotted.ok).toBe(false);
    if (!dotted.ok) expect(dotted.message).toContain('dotted keys');
  });

  test('t7: malformed input reports a line — missing value, bad key, unterminated array', () => {
    const missing = parseToml('[a]\nb = \n');
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.line).toBe(2);
    const badKey = parseToml('[a]\nbad key = 1\n');
    expect(badKey.ok).toBe(false);
    const unterminated = parseToml('x = [1, 2\n');
    expect(unterminated.ok).toBe(false);
  });

  test('t8: inf/nan tolerated (typed as numbers), comments stripped outside strings', () => {
    const p = parseToml('a = inf\nb = -inf\nc = nan\ns = "not # a comment" # but this is\n');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const val = (k: string): unknown => {
      const e = p.root.kind === 'object' ? p.root.entries.find(x => x.key === k) : undefined;
      return e && e.value.kind === 'scalar' ? e.value.value : undefined;
    };
    expect(val('a')).toBe(Infinity);
    expect(val('b')).toBe(-Infinity);
    expect(Number.isNaN(val('c') as number)).toBe(true);
    expect(val('s')).toBe('not # a comment');
  });
});

// ── The anchor path grammar ──

describe('issue #58: parseAnchorPath — dot paths, index brackets, escapes', () => {
  test('g1: dot paths and both index spellings, composable', () => {
    expect(parseAnchorPath('database.host')).toEqual(['database', 'host']);
    expect(parseAnchorPath('items.0')).toEqual(['items', '0']);
    expect(parseAnchorPath('items[0]')).toEqual(['items', '0']);
    expect(parseAnchorPath('matrix[0][1]')).toEqual(['matrix', '0', '1']);
    expect(parseAnchorPath('items.0.name')).toEqual(['items', '0', 'name']);
    expect(parseAnchorPath('items[1].tags.2')).toEqual(['items', '1', 'tags', '2']);
    expect(parseAnchorPath('[0].x')).toEqual(['0', 'x']); // root-array leading index
  });

  test('g2: escapes — \\. is one segment containing a dot, \\\\ a backslash, any \\X reads as X', () => {
    expect(parseAnchorPath('a\\.b')).toEqual(['a.b']);
    expect(parseAnchorPath('a\\\\b')).toEqual(['a\\b']);
    expect(parseAnchorPath('a\\[0\\]')).toEqual(['a[0]']);
    expect(parseAnchorPath('a\\xb')).toEqual(['axb']);
  });

  test('g3: malformed paths return null (never a wrong walk)', () => {
    expect(parseAnchorPath('')).toBeNull();
    expect(parseAnchorPath('a..b')).toBeNull();       // empty segment
    expect(parseAnchorPath('.a')).toBeNull();          // leading dot
    expect(parseAnchorPath('a.')).toBeNull();          // trailing dot
    expect(parseAnchorPath('a\\')).toBeNull();         // lone trailing backslash
    expect(parseAnchorPath('items[x]')).toBeNull();    // non-digit index
    expect(parseAnchorPath('items[0')).toBeNull();     // unclosed bracket
    expect(parseAnchorPath('a b.c')).toEqual(['a b', 'c']); // spaces are legal key chars
  });
});

// ── Resolution ──

/** The issue's mini repro, in all three formats — same tree, same anchors. */
const MINI_JSON = '{"database": {"host": "db.local", "port": 5432}, "cache": {"ttl": 30}, "server": {"port": 8080}}';
const MINI_YAML = 'database:\n  host: db.local\n  port: 5432\ncache:\n  ttl: 30\nserver:\n  port: 8080\n';
const MINI_TOML = '[database]\nhost = "db.local"\nport = 5432\n\n[cache]\nttl = 30\n\n[server]\nport = 8080\n';

function rootOf(src: string, format: 'json' | 'yaml' | 'toml') {
  const p = parseSchematic(format, src);
  expect(p.ok).toBe(true);
  if (!p.ok) throw new Error(`parse failed: ${p.message}`);
  return p.root;
}

describe('issue #58: resolveSchematicAnchor — the verdict table', () => {
  test('r1: the mini-repro matrix is IDENTICAL across JSON, YAML and TOML', () => {
    for (const [format, src] of [['json', MINI_JSON], ['yaml', MINI_YAML], ['toml', MINI_TOML]] as const) {
      const root = rootOf(src, format);
      // #database — an intermediate object: a valid ADDRESS (never leaf proof).
      expect(resolveSchematicAnchor(root, 'database')).toEqual({ status: 'object', path: 'database' });
      // #database.host — an existing leaf: resolves.
      expect(resolveSchematicAnchor(root, 'database.host')).toEqual({ status: 'leaf', path: 'database.host' });
      // #port — flat name, TWO leaves: ambiguous, with the full paths listed.
      expect(resolveSchematicAnchor(root, 'port')).toEqual({
        status: 'ambiguous', name: 'port', matches: ['database.port', 'server.port'],
      });
      // #NoSuchLeaf — missing.
      expect(resolveSchematicAnchor(root, 'NoSuchLeaf')).toEqual({ status: 'missing' });
      // #database.nope — a real parent, missing child.
      expect(resolveSchematicAnchor(root, 'database.nope')).toEqual({ status: 'missing' });
    }
  });

  test('r2: sequence items — items.0 AND items[0], composed and mixed; out-of-range misses', () => {
    const root = rootOf('items:\n  - name: a\n    tags: [x, y]\n  - name: b\nmatrix:\n  - [1, 2]\n  - [3, 4]\n', 'yaml');
    expect(resolveSchematicAnchor(root, 'items.0.name')).toEqual({ status: 'leaf', path: 'items.0.name' });
    expect(resolveSchematicAnchor(root, 'items[1].name')).toEqual({ status: 'leaf', path: 'items.1.name' });
    expect(resolveSchematicAnchor(root, 'items[0].tags[1]')).toEqual({ status: 'leaf', path: 'items.0.tags.1' });
    expect(resolveSchematicAnchor(root, 'matrix[0][1]')).toEqual({ status: 'leaf', path: 'matrix.0.1' });
    expect(resolveSchematicAnchor(root, 'matrix.1.0')).toEqual({ status: 'leaf', path: 'matrix.1.0' });
    expect(resolveSchematicAnchor(root, 'items[0]')).toEqual({ status: 'object', path: 'items.0' });
    expect(resolveSchematicAnchor(root, 'items[2]')).toEqual({ status: 'missing' }); // out of range
    expect(resolveSchematicAnchor(root, 'items.0.name.deeper')).toEqual({ status: 'missing' }); // scalar mid-path
  });

  test('r3: keys containing dots are addressable only in escaped form', () => {
    const root = rootOf('"a.b": 1\nc: 2\n', 'yaml');
    expect(resolveSchematicAnchor(root, 'a\\.b')).toEqual({ status: 'leaf', path: 'a\\.b' });
    expect(resolveSchematicAnchor(root, 'a.b')).toEqual({ status: 'missing' }); // two segments, no key `a`
  });

  test('r4: flat single-segment fallback — unique at any depth resolves, in sequences too', () => {
    const root = rootOf('outer:\n  inner:\n    maintenance: weekly\nseq:\n  - unique: 1\n', 'yaml');
    expect(resolveSchematicAnchor(root, 'maintenance')).toEqual({ status: 'leaf', path: 'outer.inner.maintenance' });
    expect(resolveSchematicAnchor(root, 'unique')).toEqual({ status: 'leaf', path: 'seq.0.unique' });
    expect(resolveSchematicAnchor(root, 'outer')).toEqual({ status: 'object', path: 'outer' }); // flat can name an object
  });

  test('r5: §12 anchor normalization per segment — case and separator insensitive, exact wins first', () => {
    const root = rootOf('data protection: strict\nData-Base:\n  Host: h\n', 'yaml');
    expect(resolveSchematicAnchor(root, 'Data-protection')).toEqual({ status: 'leaf', path: 'data protection' });
    expect(resolveSchematicAnchor(root, 'data_base.Host')).toEqual({ status: 'leaf', path: 'Data-Base.Host' });
    expect(resolveSchematicAnchor(root, 'DATA_BASE.HOST')).toEqual({ status: 'leaf', path: 'Data-Base.Host' });
  });

  test('r6: TOML array-of-tables paths and dotted-key paths resolve like nested objects', () => {
    const root = rootOf('[[products]]\nname = "hammer"\n[products.physical]\nweight = 5\n[[products]]\nname = "nail"\n', 'toml');
    expect(resolveSchematicAnchor(root, 'products.0.name')).toEqual({ status: 'leaf', path: 'products.0.name' });
    expect(resolveSchematicAnchor(root, 'products[1].name')).toEqual({ status: 'leaf', path: 'products.1.name' });
    expect(resolveSchematicAnchor(root, 'products[0].physical.weight')).toEqual({ status: 'leaf', path: 'products.0.physical.weight' });
    expect(resolveSchematicAnchor(root, 'products.0')).toEqual({ status: 'object', path: 'products.0' });
    expect(resolveSchematicAnchor(root, 'name')).toEqual({ status: 'ambiguous', name: 'name', matches: ['products.0.name', 'products.1.name'] });
  });

  test('r7: a JSON root array addresses by leading index', () => {
    const root = rootOf('[{"id": 1}, {"id": 2}]', 'json');
    expect(resolveSchematicAnchor(root, '[1].id')).toEqual({ status: 'leaf', path: '1.id' });
    expect(resolveSchematicAnchor(root, '0.id')).toEqual({ status: 'leaf', path: '0.id' });
    expect(resolveSchematicAnchor(root, 'id')).toEqual({ status: 'ambiguous', name: 'id', matches: ['0.id', '1.id'] });
  });

  test('r8: multi-document YAML — the flat/path vocabulary covers the FIRST document only', () => {
    const root = rootOf('a: 1\n---\nb: 2\n', 'yaml');
    expect(resolveSchematicAnchor(root, 'a')).toEqual({ status: 'leaf', path: 'a' });
    expect(resolveSchematicAnchor(root, 'b')).toEqual({ status: 'missing' }); // second document: out of scope (v1)
  });

  test('r9: an empty tree has no vocabulary — everything is missing', () => {
    const root = rootOf('', 'yaml'); // valid: null root
    expect(resolveSchematicAnchor(root, 'anything')).toEqual({ status: 'missing' });
  });
});

// ── The addressable vocabulary + format detection ──

describe('issue #58: schematicAddresses + schematicFormatFor', () => {
  test('a1: escaped dot paths and flat names, document order', () => {
    const root = rootOf('database:\n  host: h\nitems:\n  - name: a\n"a.b": 1\n', 'yaml');
    expect(schematicAddresses(root)).toEqual({
      paths: ['database', 'database.host', 'items', 'items.0', 'items.0.name', 'a\\.b'],
      names: ['database', 'host', 'items', 'name', 'a.b'],
    });
  });

  test('a2: format detection — extension table, case-insensitive, null elsewhere', () => {
    expect(schematicFormatFor('a.json')).toBe('json');
    expect(schematicFormatFor('a.JSON')).toBe('json');
    expect(schematicFormatFor('a.yaml')).toBe('yaml');
    expect(schematicFormatFor('a.yml')).toBe('yaml');
    expect(schematicFormatFor('a.YML')).toBe('yaml');
    expect(schematicFormatFor('a.toml')).toBe('toml');
    expect(schematicFormatFor('a.TOML')).toBe('toml');
    expect(schematicFormatFor('a.md')).toBeNull();
    expect(schematicFormatFor('a.jsonc')).toBeNull(); // not a v1 format
    expect(schematicFormatFor('a.ini')).toBeNull();
    expect(schematicFormatFor('noext')).toBeNull();
  });
});
