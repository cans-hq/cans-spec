/**
 * Issue #60 unit tests — code-symbol anchors (src/core/code-anchors.ts),
 * independent of the ref-engine wiring that consumes them.
 *
 * The module under test is the addressable top-level-symbol vocabulary for
 * CODE artifact targets: a line-based, best-effort extractor (repo law:
 * zero runtime deps — the schematic.ts hand-rolled-subset discipline
 * applied to code). It returns RAW identifier names; resolution against a
 * `#anchor` is deliberately NOT this module's job — it happens via the §12
 * anchorMatches normalization in refs.ts, which the a-tests pin below so
 * the wiring agent (checkArtifactAnchor) inherits a fixed contract.
 *
 * Test map:
 *   t1-t6  TS/JS family: every declaration kind in document order;
 *          modifiers (async, default+name, abstract, declare, const enum,
 *          generator); generics never in the name; the non-forms
 *          (anonymous defaults, re-exports, export =) mint nothing;
 *          nested/indented declarations excluded; all 8 extensions share
 *          one grammar
 *   r1-r4  Rust: pub item forms; generic/lifetime stripping; modifier
 *          runs (async fn, const fn, unsafe extern "C", static mut);
 *          non-pub / pub(crate) / indented methods excluded (the
 *          documented exported-only call)
 *   p1-p2  Python: def/async def/class at column 0 in order; methods,
 *          nested defs, assignments, shebangs and comments excluded
 *   g1-g4  Go: func/type/const/var forms; method receivers (incl.
 *          generic receivers); generics after the name; the grouped
 *          const()/var() documented limit
 *   c1-c2  Comment exclusion (all languages): full-line //, #, /// doc
 *          comments, single-line and multi-line block comments
 *   d1     dedupe keeps the FIRST occurrence at its document position
 *          (TS overloads, interface declaration merging)
 *   f1     realistic artifacts per language — the issue's
 *          artifacts/code/parse.ts#createRule shape — exact ordered lists
 *   i1-i2  isCodeArtifact truth table (10 extensions, case-insensitive,
 *          path-suffix; non-code and extensionless false) + agreement
 *          with extractCodeSymbols ([] wherever isCodeArtifact is false)
 *   e1     edges: unknown extension → []; empty/whitespace source → [];
 *          BOM; CRLF line endings
 *   a1-a2  §12 anchorMatches integration preview (read-only import from
 *          src/core/refs.ts): raw names resolve exactly — case folds,
 *          dash/underscore/space separator runs fold, camelCase does NOT
 *          (the pinned wiring contract)
 */
import { describe, test, expect } from '../testing.ts';

import { extractCodeSymbols, isCodeArtifact } from '../../src/core/code-anchors.ts';
import { anchorMatches } from '../../src/core/refs.ts';

// ── TS/JS family ──

describe('issue #60: TS/JS family — exported top-level declarations', () => {
  test('t1: every declaration kind, exact document order', () => {
    const src = [
      'export function createRule(name: string): Rule {',
      '  return { name };',
      '}',
      'export const SEVERITIES = ["error", "warning"] as const;',
      'export let mutable = 1;',
      'export var legacy = 2;',
      'export class RuleTable { }',
      'export abstract class Base { }',
      'export interface Rule { name: string }',
      'export type Severity = "error" | "warning";',
      'export enum Level { Low, High }',
      'export const enum Compact { A, B }',
      'export namespace Validation { }',
      'export module Legacy { }',
    ].join('\n');
    expect(extractCodeSymbols('parse.ts', src)).toEqual([
      'createRule', 'SEVERITIES', 'mutable', 'legacy', 'RuleTable', 'Base',
      'Rule', 'Severity', 'Level', 'Compact', 'Validation', 'Legacy',
    ]);
  });

  test('t2: modifiers — async, default-with-name, abstract, declare, generator', () => {
    const src = [
      'export async function save(path: string): Promise<void> { }',
      'export default function boot(): void { }',    // default WITH a name → the name
      'export default class Main extends Base { }',  // default WITH a name → the name
      'export default async function* streams() { }',
      'export declare const API_BASE: string;',
      'export const $dollar = 1;',
      'export function _under() { }',
    ].join('\n');
    expect(extractCodeSymbols('boot.ts', src)).toEqual([
      'save', 'boot', 'Main', 'streams', 'API_BASE', '$dollar', '_under',
    ]);
  });

  test('t3: generics are never part of the name (captured before < = ( extends {)', () => {
    const src = [
      'export function make<T>(x: T): T { return x; }',
      'export interface Registry<T> extends Map<string, T> { }',
      'export class Store<T = unknown> extends Base<T> { }',
      'export type Result<T> = Ok<T> | Err<T>;',
      'export const pair = <T, U>(a: T, b: U): [T, U] => [a, b];',
    ].join('\n');
    expect(extractCodeSymbols('generic.ts', src)).toEqual([
      'make', 'Registry', 'Store', 'Result', 'pair',
    ]);
  });

  test('t4: non-forms mint nothing — anonymous defaults, re-exports, export =', () => {
    const src = [
      'export default { };',                        // anonymous object
      'export default function () { }',             // anonymous function
      'export default class extends Base { }',      // anonymous class + heritage keyword
      'export default 42;',                         // scalar
      'export * from "./other.ts";',                // star re-export
      'export { createRule } from "./rules.ts";',   // named re-export (from)
      'export { createRule };',                     // named re-export (local)
      'export = legacy;',                           // TS legacy assignment export
      'function privateHelper(): void { }',         // not exported
      'const alsoPrivate = 1;',                     // not exported
    ].join('\n');
    expect(extractCodeSymbols('reexports.ts', src)).toEqual([]);
  });

  test('t5: nested/indented declarations are NOT captured (column-0 anchor)', () => {
    const src = [
      'export namespace Validation {',
      '  export function inner(): void { }',
      '  export const nested = 1;',
      '}',
      'class Outer {',
      '  export function method() { }',
      '}',
      'export function topLevel() { }',
    ].join('\n');
    expect(extractCodeSymbols('nested.ts', src)).toEqual(['Validation', 'topLevel']);
  });

  test('t6: all 8 family extensions select the same grammar', () => {
    const src = 'export function createRule() { }';
    for (const ext of ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs']) {
      expect(extractCodeSymbols(`parse.${ext}`, src)).toEqual(['createRule']);
    }
  });
});

// ── Rust ──

describe('issue #60: Rust — pub top-level items', () => {
  test('r1: every pub item form, exact document order', () => {
    const src = [
      'pub fn parse(source: &str) -> Vec<&str> {',
      '    vec![]',
      '}',
      'pub const MAX_DEPTH: usize = 8;',
      'pub static VERSION: &str = "0.9.0";',
      'pub struct Graph { nodes: Vec<String> }',
      'pub enum Visit { Enter, Exit }',
      'pub trait Walker { fn walk(&self); }',
      'pub type Table = HashMap<String, usize>;',
      'pub mod util;',
      'pub union Untagged { a: u32, b: f32 }',
    ].join('\n');
    expect(extractCodeSymbols('graph.rs', src)).toEqual([
      'parse', 'MAX_DEPTH', 'VERSION', 'Graph', 'Visit', 'Walker', 'Table',
      'util', 'Untagged',
    ]);
  });

  test('r2: generics and lifetimes are stripped from the name', () => {
    const src = [
      "pub fn parse<'a, T: Clone>(src: &'a [T]) -> Vec<&'a T> {",
      '    vec![]',
      '}',
      'pub struct Wrapper<T: Clone> { inner: T }',
      "pub trait Factory<'a> { type Out; }",
      "pub type Alias<'a> = &'a str;",
    ].join('\n');
    expect(extractCodeSymbols('lifetimes.rs', src)).toEqual([
      'parse', 'Wrapper', 'Factory', 'Alias',
    ]);
  });

  test('r3: modifier runs — async fn, const fn, unsafe, extern "C", static mut', () => {
    const src = [
      'pub async fn fetch_all() -> Vec<String> { Vec::new() }',
      'pub const fn size_of_item() -> usize { 0 }',
      'pub unsafe fn from_raw(ptr: *mut u8) -> Self { }',
      'pub unsafe extern "C" fn callback(c: u8) -> u8 { c }',
      'pub static mut COUNTER: u32 = 0;',
    ].join('\n');
    expect(extractCodeSymbols('modifiers.rs', src)).toEqual([
      'fetch_all', 'size_of_item', 'from_raw', 'callback', 'COUNTER',
    ]);
  });

  test('r4: exported-only call — bare fn, pub(crate), non-pub items and impl methods mint nothing', () => {
    const src = [
      'fn helper() {}',                       // private — not the exported surface
      'pub(crate) fn crate_only() {}',        // crate-restricted — not exported
      'pub(super) fn parent_only() {}',       // parent-restricted — not exported
      'struct Private { }',                   // private type
      'impl Graph {',
      '    pub fn method(&self) {}',          // indented method — not top level
      '}',
      'use std::collections::HashMap;',       // not an item declaration
      'pub fn public() {}',
    ].join('\n');
    expect(extractCodeSymbols('private.rs', src)).toEqual(['public']);
  });
});

// ── Python ──

describe('issue #60: Python — column-0 def/async def/class', () => {
  test('p1: top-level defs and classes in document order (no export marker: top level IS the surface)', () => {
    const src = [
      '#!/usr/bin/env python3',
      '# -*- coding: utf-8 -*-',
      'import re',
      '',
      'SEVERITIES = ("error", "warning")',
      '',
      'class Stage:',
      '    def run(self, text):',
      '        return []',
      '',
      'def load_stages(path):',
      '    return [Stage()]',
      '',
      'async def run_all(stages, text):',
      '    out = []',
      '    return out',
      '',
      'def _private():',
      '    pass',
    ].join('\n');
    // SEVERITIES (module assignment, not a named unit) and the indented
    // method run() are absent; shebang/encoding comments never mint.
    expect(extractCodeSymbols('pipeline.py', src)).toEqual([
      'Stage', 'load_stages', 'run_all', '_private',
    ]);
  });

  test('p2: methods, nested defs, decorators and comments mint nothing', () => {
    const src = [
      '@app.route("/")',
      'def handler():',
      '    return 1',
      '',
      'class Box:',
      '    def method(self):',
      '        async def nested():',
      '            pass',
      '        return nested',
      '',
      '# def commented_out():',
      '#     pass',
      '',
      '    def indented_after_comment(self):',
      '        pass',
    ].join('\n');
    // Box IS a column-0 class (minted); its method/nested def are not.
    expect(extractCodeSymbols('excluded.py', src)).toEqual(['handler', 'Box']);
  });
});

// ── Go ──

describe('issue #60: Go — top-level func/type/const/var', () => {
  test('g1: every top-level form, exact document order', () => {
    const src = [
      'package main',
      '',
      'import "fmt"',
      '',
      'const BufSize = 4096',
      'var ErrClosed = fmt.Errorf("closed")',
      'type Server struct {',
      '\tName string',
      '}',
      'type Handler func(s *Server) error',
      'type Alias = int',
      'func New() *Server { return &Server{} }',
      'func Shutdown(all []*Server) error { return nil }',
    ].join('\n');
    // The indented struct field Name is not a top-level symbol.
    expect(extractCodeSymbols('server.go', src)).toEqual([
      'BufSize', 'ErrClosed', 'Server', 'Handler', 'Alias', 'New', 'Shutdown',
    ]);
  });

  test('g2: method receivers — the bare NAME is still addressable', () => {
    const src = [
      'func (s *Server) Start() error { return nil }',
      'func (s *Server[T]) Push(v T) { }',
      'func (m map[string]int) Len() int { return 0 }',
    ].join('\n');
    expect(extractCodeSymbols('methods.go', src)).toEqual(['Start', 'Push', 'Len']);
  });

  test('g3: generics sit after the name', () => {
    const src = [
      'func Map[T any](xs []T) []T { return xs }',
      'type Set[T comparable] struct { items map[T]struct{} }',
    ].join('\n');
    expect(extractCodeSymbols('generics.go', src)).toEqual(['Map', 'Set']);
  });

  test('g4: documented limit — grouped const()/var() blocks mint nothing (names live on indented lines)', () => {
    const src = [
      'const (',
      '\tA = 1',
      '\tB = 2',
      ')',
      'var (',
      '\tX = "x"',
      ')',
      'const C = 3',
    ].join('\n');
    expect(extractCodeSymbols('grouped.go', src)).toEqual(['C']);
  });
});

// ── Comment exclusion (all languages) ──

describe('issue #60: comment exclusion — comments never mint symbols', () => {
  test('c1: //, #, ///, single-line and multi-line block comments (TS/JS/Rust shapes)', () => {
    const ts = [
      '// export function fake() {}',
      '  // export const alsoFake = 1',
      '/// export function docFake() {}',
      '/* export const blockFake = 1 */',
      '/*',
      'export function hidden() {}',
      '*/',
      '/**',
      ' * export function jsdocFake() {}',
      ' */',
      'export function real() {}',
    ].join('\n');
    expect(extractCodeSymbols('comments.ts', ts)).toEqual(['real']);

    const rs = [
      '#[derive(Debug)]',
      'pub struct Real { }',
      '# pub fn fake() {}',
      '/* pub fn alsoFake() {} */',
      '// pub fn docFake() {}',
    ].join('\n');
    expect(extractCodeSymbols('comments.rs', rs)).toEqual(['Real']);
  });

  test('c2: # full-line comments (Python/Go shapes)', () => {
    const py = '# def fake():\n#     pass\ndef real():\n    return 1\n';
    expect(extractCodeSymbols('comments.py', py)).toEqual(['real']);

    const go = '# func fake() {}\n// func alsoFake() {}\nfunc real() {}\n';
    expect(extractCodeSymbols('comments.go', go)).toEqual(['real']);
  });
});

// ── Dedupe ──

describe('issue #60: dedupe — first occurrence wins, document order kept', () => {
  test('d1: TS overloads and interface declaration merging collapse to one name at first position', () => {
    const src = [
      'export const alpha = 1;',
      'export function parse(s: string): number;',   // .d.ts overload 1
      'export const beta = 2;',
      'export function parse(n: number): string;',   // overload 2 — deduped
      'export interface Foo { a: number }',
      'export interface Foo { b: string }',          // declaration merging — deduped
    ].join('\n');
    expect(extractCodeSymbols('overloads.d.ts', src)).toEqual([
      'alpha', 'parse', 'beta', 'Foo',
    ]);
  });
});

// ── Realistic artifacts (the issue's artifacts/code/ idea) ──

describe('issue #60: realistic artifacts — exact ordered vocabularies', () => {
  test('f1: one small realistic file per language', () => {
    // The issue's exact repro shape: see: artifacts/code/parse.ts#createRule.
    const parseTs = [
      '// artifacts/code/parse.ts — rule parsing for the cans CLI',
      "import { readFileSync } from 'fs';",
      '',
      'export interface Rule { name: string; severity: "error" | "warning"; }',
      '',
      'export const SEVERITIES = ["error", "warning"] as const;',
      '',
      'export function createRule(name: string, severity: "error" | "warning" = "error"): Rule {',
      '  return { name, severity };',
      '}',
      '',
      'export function loadRules(path: string): Rule[] {',
      '  const raw = readFileSync(path, "utf8");',
      '  return raw.split("\\n").filter(Boolean).map(line => createRule(line));',
      '}',
      '',
      'export async function saveRules(path: string, rules: Rule[]): Promise<void> {',
      '  void path; void rules;',
      '}',
      '',
      'export type RuleTable = Map<string, Rule>;',
      '',
      'function localHelper(): void {} // not exported — not addressable',
    ].join('\n');
    expect(extractCodeSymbols('artifacts/code/parse.ts', parseTs)).toEqual([
      'Rule', 'SEVERITIES', 'createRule', 'loadRules', 'saveRules', 'RuleTable',
    ]);

    const graphRs = [
      '// artifacts/code/graph.rs — spec-graph helpers',
      'use std::collections::HashMap;',
      '',
      "pub struct Graph<'a> {",
      '    nodes: Vec<&\'a str>,',
      '}',
      '',
      'pub const MAX_DEPTH: usize = 8;',
      '',
      "pub fn depth<'a, T: Clone>(g: &Graph<'a>, t: &T) -> usize {",
      '    let _ = (g, t);',
      '    0',
      '}',
      '',
      'pub async fn walk(g: &Graph<\'_>) -> Vec<String> {',
      '    let _ = g;',
      '    Vec::new()',
      '}',
      '',
      'pub enum Visit { Enter, Exit }',
      'pub type Table = HashMap<String, usize>;',
      '',
      'pub mod util {',
      '    pub fn hidden() {} // nested — not top level',
      '}',
      '',
      'fn private_helper() {} // not pub — not addressable',
    ].join('\n');
    expect(extractCodeSymbols('artifacts/code/graph.rs', graphRs)).toEqual([
      'Graph', 'MAX_DEPTH', 'depth', 'walk', 'Visit', 'Table', 'util',
    ]);

    const pipelinePy = [
      '# artifacts/code/pipeline.py — lint pipeline stages',
      'import re',
      '',
      'SEVERITIES = ("error", "warning")',
      '',
      'class Stage:',
      '    def run(self, text: str) -> list[str]:',
      '        return []',
      '',
      'def load_stages(path: str) -> list[Stage]:',
      '    return [Stage()]',
      '',
      'async def run_all(stages: list[Stage], text: str) -> list[str]:',
      '    out = []',
      '    for s in stages:',
      '        out.extend(s.run(text))',
      '    return out',
      '',
      '# def commented_out():',
      '#     pass',
    ].join('\n');
    expect(extractCodeSymbols('artifacts/code/pipeline.py', pipelinePy)).toEqual([
      'Stage', 'load_stages', 'run_all',
    ]);

    const serverGo = [
      '// artifacts/code/server.go — check server harness',
      'package main',
      '',
      'import "fmt"',
      '',
      'const BufSize = 4096',
      'var ErrClosed = fmt.Errorf("closed")',
      '',
      'type Server struct {',
      '\tName string',
      '}',
      'type Handler func(s *Server) error',
      '',
      'func New() *Server { return &Server{} }',
      'func (s *Server) Start() error { return nil }',
      'func Shutdown(all []*Server) error { return nil }',
    ].join('\n');
    expect(extractCodeSymbols('artifacts/code/server.go', serverGo)).toEqual([
      'BufSize', 'ErrClosed', 'Server', 'Handler', 'New', 'Start', 'Shutdown',
    ]);
  });
});

// ── isCodeArtifact ──

describe('issue #60: isCodeArtifact — the extension truth table', () => {
  test('i1: the 10 supported extensions, case-insensitive, as path suffixes', () => {
    for (const p of [
      'parse.ts', 'ui.tsx', 'env.mts', 'env.cts', 'main.js', 'ui.jsx',
      'entry.mjs', 'entry.cjs', 'graph.rs', 'pipeline.py', 'server.go',
      'Parse.TS', 'MAIN.GO', 'lib.Rs', 'types.d.ts', 'artifacts/code/parse.ts',
    ]) {
      expect(isCodeArtifact(p)).toBe(true);
    }
    for (const p of [
      'spec.md', 'config.json', 'conf.yaml', 'conf.toml', 'notes.txt',
      'main.c', 'App.java', 'script.sh', 'lib.rb', 'styles.css', 'index.html',
      'Makefile', 'noext', 'ts', '',
    ]) {
      expect(isCodeArtifact(p)).toBe(false);
    }
  });

  test('i2: wherever isCodeArtifact is false, extractCodeSymbols yields [] — even with code-shaped content', () => {
    const code = 'export function createRule() { }\npub fn parse() {}\ndef real(): pass\n';
    for (const p of ['notes.txt', 'lib.rb', 'spec.md', 'noext', 'main.c']) {
      expect(isCodeArtifact(p)).toBe(false);
      expect(extractCodeSymbols(p, code)).toEqual([]);
    }
  });
});

// ── Edges ──

describe('issue #60: edges — empty, unknown, BOM, CRLF', () => {
  test('e1: empty/whitespace source → []; BOM stripped; CRLF handled', () => {
    expect(extractCodeSymbols('parse.ts', '')).toEqual([]);
    expect(extractCodeSymbols('parse.ts', '\n\n   \n\t\n')).toEqual([]);
    expect(extractCodeSymbols('noext', 'export function x() {}')).toEqual([]);
    // A UTF-8 BOM must not hide the first declaration.
    expect(extractCodeSymbols('bom.ts', '\uFEFFexport function first() {}\nexport const second = 2;'))
      .toEqual(['first', 'second']);
    // CRLF line endings behave exactly like LF.
    expect(extractCodeSymbols('crlf.ts', 'export function a() {}\r\nexport const b = 1;\r\n'))
      .toEqual(['a', 'b']);
    expect(extractCodeSymbols('crlf.go', 'func A() {}\r\nconst B = 1\r\n'))
      .toEqual(['A', 'B']);
  });
});

// ── §12 normalization contract (integration preview for the wiring agent) ──

describe('issue #60: anchorMatches — the resolution contract this vocabulary feeds', () => {
  test('a1: raw names resolve exactly; case and separator runs fold; camelCase does NOT', () => {
    // Direct pins of the §12 normalization (read-only import from refs.ts):
    expect(anchorMatches('createRule', 'createRule')).toBe(true);   // exact
    expect(anchorMatches('createRule', 'CreateRule')).toBe(true);   // case-insensitive
    expect(anchorMatches('createRule', 'createrule')).toBe(true);   // case-insensitive
    expect(anchorMatches('create rule', 'create_rule')).toBe(true); // separator runs fold
    expect(anchorMatches('create_rule', 'create-rule')).toBe(true); // dash ↔ underscore
    expect(anchorMatches('create-rule', 'create rule')).toBe(true); // dash ↔ space
    // camelCase humps are NOT separators — the pinned fact:
    expect(anchorMatches('createRule', 'create-rule')).toBe(false);
    expect(anchorMatches('createRule', 'create_rule')).toBe(false);
  });

  test('a2: the issue repro composes — extractCodeSymbols × anchorMatches resolves #createRule', () => {
    const src = 'export function createRule(name: string): Rule {\n  return { name };\n}\n';
    const symbols = extractCodeSymbols('artifacts/code/parse.ts', src);
    // RAW name, not a slug:
    expect(symbols).toEqual(['createRule']);
    // The wiring (checkArtifactAnchor, issue #60) resolves an anchor iff
    // some vocabulary entry anchorMatches it — the exact composition:
    expect(symbols.some(n => anchorMatches(n, 'createRule'))).toBe(true);   // resolves
    expect(symbols.some(n => anchorMatches(n, 'create-rule'))).toBe(false); // camelCase not folded
    expect(symbols.some(n => anchorMatches(n, 'CreateRule'))).toBe(true);   // case folds
    expect(symbols.some(n => anchorMatches(n, 'missing'))).toBe(false);     // truthful miss
  });
});
