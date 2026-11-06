/**
 * Issue #66 — the ENGINE half: the codebase inbound-references scanner.
 *
 * The contract commit (7abd7f3) landed the frozen `CodebaseRules /
 * CodebasePointer / CodebaseFinding / CodebaseScan` types, the §2.1
 * SEE_POINTER_RE and the three-signature seam in core/codebase.ts, plus the
 * `codebase` PARAMETER seam in src/types.ts. This suite pins what the ENGINE
 * does with them — real files, real walking, real resolution, no faking:
 *
 *   a1-a12 .. extraction (§2.1/§2.2): every language spelling (TS/Python/
 *             Go block/Rust/YAML), prose+trailing-note tolerance, exact-span
 *             raw, as-written targets (cans/ prefix kept), no-anchor
 *             pointers, multi-occurrence lines, punctuation padding, folder
 *             targets, document order, 1-based CRLF lines, the frozen
 *             pattern's negatives (no space, case-sensitive, slug stops at
 *             the first foreign char)
 *   b1-b9 .. file selection (§3): project-root resolution, include/exclude,
 *             workspace subtree ALWAYS skipped, overlapping-roots dedupe,
 *             deterministic sort, missing roots empty, single-star stays in
 *             its segment, a workspace-named root selects nothing
 *   c1-c10 .. resolution (§2.3): tolerant anchorMatches (case/separator/
 *             em-dash variants), FileNotFound, AnchorNotFound with and
 *             without a did-you-mean, multi-candidate ambiguity, cans/
 *             stripping, file-level pointers, counters, deterministic order,
 *             the unreadable-file codebase.io warning
 *   d1-d11 .. config: defaultCodebaseRules shape, absent/empty/partial/
 *             full blocks, the §18 strict validation error shapes (each
 *             rule line-numbered), pre-#66 configs load byte-identically,
 *             listing codebase never joins the delete/override
 *             reconciliation
 *   e1 ...... engine+config wiring: loadRules' normalized block drives
 *             checkCodebaseRefs end to end
 *
 * Runtime-neutral: imports the test facade, never 'bun:test' directly.
 */
import { describe, test, expect, afterEach } from './testing.ts';
import { join, dirname } from 'path';
import { mkdirSync, writeFileSync, chmodSync, readFileSync } from 'fs';

import {
  SEE_POINTER_RE,
  extractCodebasePointers,
  collectSourceFiles,
  checkCodebaseRefs,
} from '../src/core/codebase.ts';
import { defaultCodebaseRules, loadRules, defaultRules } from '../src/core/rules.ts';
import { parseOutline } from '../src/core/outline.ts';
import { makeTmpDir, cleanTmpDir, makeCansWorkspace } from './helpers.ts';
import type { CodebaseRules, CodebaseScan, OutlineNode } from '../src/types.ts';

// ── Scaffolding ─────────────────────────────────────────────────────────────

const tmps: string[] = [];

afterEach(() => {
  while (tmps.length > 0) cleanTmpDir(tmps.pop()!);
});

const cbCfg = (over: Partial<CodebaseRules> = {}): CodebaseRules => ({
  ...defaultCodebaseRules(),
  ...over,
});

/** A PROJECT directory: `files` become the cans/ workspace (workspace-
 *  relative), `projectFiles` sit beside it (project-relative) — the scanner's
 *  own turf. Returns both roots. */
function makeProject(
  name: string,
  files: Record<string, string> = {},
  projectFiles: Record<string, string> = {},
): { project: string; root: string } {
  const project = makeTmpDir(`issue66-engine-${name}`);
  tmps.push(project);
  const root = makeCansWorkspace(project, files);
  for (const [rel, content] of Object.entries(projectFiles)) {
    const p = join(project, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content, 'utf8');
  }
  return { project, root };
}

/** A corpus map the way check.ts's specFiles is shaped: workspace-relative
 *  keys → parsed outlines (real parsing — node titles are bullet texts). */
function corpusOf(entries: Array<[string, string]>): Map<string, OutlineNode[]> {
  return new Map(entries.map(([key, src]) => [key, parseOutline(src, key)]));
}

const CORPUS_SRC =
  '# 02 Auth\n\n- Session validation\n  The handshake verifies the token.\n\n- Passwords\n  Hashing rules.\n\n- Retry policy\n  Backoff rules.\n\n- Retry policies\n  More backoff.\n';
const CORPUS: Array<[string, string]> = [['02-auth.md', CORPUS_SRC]];

// ── A. Extraction (§2.1/§2.2) ───────────────────────────────────────────────

describe('issue #66 engine — extraction (§2.2 variants)', () => {
  test('a1: TS line comment with leading prose and trailing note — raw is the exact span', () => {
    const out = extractCodebasePointers(
      'let t = handshake(); // Initial handshake logic; see: 02-auth.md#Sessions - fails with ENOSPC when exceeded',
    );
    expect(out.length).toBe(1);
    expect(out[0]!.raw).toBe('see: 02-auth.md#Sessions');
    expect(out[0]!.targetFile).toBe('02-auth.md');
    expect(out[0]!.targetSlug).toBe('Sessions');
    expect(out[0]!.line).toBe(1);
  });

  test('a2: Python comment', () => {
    const out = extractCodebasePointers('# see: 04-api.md#Routing');
    expect(out.length).toBe(1);
    expect(out[0]!.raw).toBe('see: 04-api.md#Routing');
    expect(out[0]!.targetFile).toBe('04-api.md');
    expect(out[0]!.targetSlug).toBe('Routing');
  });

  test('a3: Go block comment spanning lines — per-line matching finds it (no blob scan)', () => {
    const out = extractCodebasePointers([
      'package auth',
      '/*',
      ' Session verification entry point.',
      ' see: 02-auth.md#Sessions',
      '*/',
      'func Verify() {}',
    ].join('\n'));
    expect(out.length).toBe(1);
    expect(out[0]!.line).toBe(4);
    expect(out[0]!.raw).toBe('see: 02-auth.md#Sessions');
  });

  test('a4: YAML comment after a key', () => {
    const out = extractCodebasePointers('retention_days: 30 # see: 05-data.md#Retention');
    expect(out.length).toBe(1);
    expect(out[0]!.targetFile).toBe('05-data.md');
    expect(out[0]!.targetSlug).toBe('Retention');
  });

  test('a5: Rust doc comment', () => {
    const out = extractCodebasePointers('//! Handshake gate — see: 01-protocol.md#Handshake');
    expect(out.length).toBe(1);
    expect(out[0]!.targetFile).toBe('01-protocol.md');
    expect(out[0]!.targetSlug).toBe('Handshake');
  });

  test('a6: cans/-prefixed target is kept AS WRITTEN', () => {
    const out = extractCodebasePointers('// see: cans/02-auth.md#Sessions');
    expect(out.length).toBe(1);
    expect(out[0]!.raw).toBe('see: cans/02-auth.md#Sessions');
    expect(out[0]!.targetFile).toBe('cans/02-auth.md');
    expect(out[0]!.targetSlug).toBe('Sessions');
  });

  test('a7: no-anchor pointer — targetSlug null', () => {
    const out = extractCodebasePointers('// see: 02-auth.md');
    expect(out.length).toBe(1);
    expect(out[0]!.targetFile).toBe('02-auth.md');
    expect(out[0]!.targetSlug).toBeNull();
  });

  test('a8: multiple pointers on one line — one entry each, left-to-right', () => {
    const out = extractCodebasePointers('// see: 02-auth.md#A then see: 03-b.md#B');
    expect(out.length).toBe(2);
    expect(out[0]!.targetFile).toBe('02-auth.md');
    expect(out[0]!.targetSlug).toBe('A');
    expect(out[1]!.targetFile).toBe('03-b.md');
    expect(out[1]!.targetSlug).toBe('B');
  });

  test('a9: punctuation-padded pointers survive', () => {
    const out = extractCodebasePointers('verify(x); /* (see: 02-auth.md#Sessions); */');
    expect(out.length).toBe(1);
    expect(out[0]!.raw).toBe('see: 02-auth.md#Sessions');
  });

  test('a10: document order across lines, 1-based line numbers', () => {
    const out = extractCodebasePointers([
      'fn a() {} // see: 02-auth.md#Sessions',
      '',
      'fn b() {} // see: 01-protocol.md#Handshake',
    ].join('\n'));
    expect(out.length).toBe(2);
    expect(out[0]!.line).toBe(1);
    expect(out[0]!.targetFile).toBe('02-auth.md');
    expect(out[1]!.line).toBe(3);
    expect(out[1]!.targetFile).toBe('01-protocol.md');
  });

  test('a11: no matches — empty text, prose without the pattern, and the shared regex state never leaks between calls', () => {
    expect(extractCodebasePointers('')).toEqual([]);
    expect(extractCodebasePointers('plain prose; see the runbook; see below')).toEqual([]);
    // First call leaves a match at the END of its scan; the second call must
    // still see line-1 pointers (per-line lastIndex reset).
    const text = '// see: 02-auth.md#Sessions\n// see: 03-b.md#B\n';
    expect(extractCodebasePointers(text)).toEqual(extractCodebasePointers(text));
    expect(SEE_POINTER_RE.global).toBe(true); // the frozen §2.1 contract
  });

  test('a12: CRLF and lone CR are line terminators — line numbers stay 1-based', () => {
    const out = extractCodebasePointers('a\r\n// see: 02-auth.md#Sessions\rb // see: 03-b.md#B\n');
    expect(out.length).toBe(2);
    expect(out[0]!.line).toBe(2);
    expect(out[1]!.line).toBe(3);
  });

  test('a13: the frozen pattern\'s negatives — no space, case-sensitive, slug stops at foreign chars, folder targets', () => {
    // `see:` without whitespace never matches (§2.1 requires \s+).
    expect(extractCodebasePointers('// see:02-auth.md')).toEqual([]);
    // The pattern is case-sensitive: `See:` is prose, not a pointer.
    expect(extractCodebasePointers('// See: 02-auth.md')).toEqual([]);
    // Slug characters are [A-Za-z0-9_-]: the fragment stops at the first
    // foreign char (the frozen regex — no post-hoc trimming).
    const dot = extractCodebasePointers('// see: 02-auth.md#Session.v2');
    expect(dot.length).toBe(1);
    expect(dot[0]!.raw).toBe('see: 02-auth.md#Session');
    expect(dot[0]!.targetSlug).toBe('Session');
    // Folder-layout targets keep their path as written.
    const sub = extractCodebasePointers('// see: plugins/deep/spec.md#Leaf');
    expect(sub.length).toBe(1);
    expect(sub[0]!.targetFile).toBe('plugins/deep/spec.md');
    expect(sub[0]!.targetSlug).toBe('Leaf');
  });
});

// ── B. File selection (§3) ──────────────────────────────────────────────────

describe('issue #66 engine — file selection (§3)', () => {
  test('b1: include + default excludes, project-root-relative paths', () => {
    const { root } = makeProject('select', { '02-auth.md': CORPUS_SRC }, {
      'src/auth/session.rs': '// see: 02-auth.md#Sessions\n',
      'src/main.rs': 'fn main() {}\n',
      'src/notes.md': 'not source\n',
      'src/target/artifacts.rs': 'junk\n',
    });
    return collectSourceFiles(root, cbCfg()).then((out) => {
      expect(out).toEqual(['src/auth/session.rs', 'src/main.rs']);
    });
  });

  test('b2: everything inside the workspace is skipped — corpus refs verify once, in the refs engine', () => {
    const { root } = makeProject('ws-skip', {
      '02-auth.md': CORPUS_SRC,
      'plugins/leaf.md': '- Leaf\n',
    }, {
      'src/lib.rs': '// see: 02-auth.md#Sessions\n',
    });
    return collectSourceFiles(root, cbCfg()).then((out) => {
      expect(out).toEqual(['src/lib.rs']);
    });
  });

  test('b3: overlapping roots dedupe', () => {
    const { root } = makeProject('overlap', {}, {
      'src/auth/session.rs': 'x\n',
      'src/main.rs': 'x\n',
    });
    return collectSourceFiles(root, cbCfg({ roots: ['src', 'src/auth', '.'] })).then((out) => {
      expect(out).toEqual(['src/auth/session.rs', 'src/main.rs']);
    });
  });

  test('b4: deterministic ascending sort regardless of directory order', () => {
    const { root } = makeProject('sorted', {}, {
      'src/z.rs': 'x\n',
      'src/auth/user.rs': 'x\n',
      'src/main.rs': 'x\n',
    });
    return collectSourceFiles(root, cbCfg({ exclude: [] })).then((out) => {
      expect(out).toEqual(['src/auth/user.rs', 'src/main.rs', 'src/z.rs']);
    });
  });

  test('b5: a missing root is an empty result, never a throw', () => {
    const { root } = makeProject('missing-root', {}, { 'src/main.rs': 'x\n' });
    return collectSourceFiles(root, cbCfg({ roots: ['nope', 'also/missing'] })).then((out) => {
      expect(out).toEqual([]);
    });
  });

  test('b6: multiple roots union', () => {
    const { root } = makeProject('union', {}, {
      'src/main.rs': 'x\n',
      'lib/util.py': '# x\n',
      'docs/readme.md': 'x\n',
    });
    return collectSourceFiles(root, cbCfg({ roots: ['src', 'lib'] })).then((out) => {
      expect(out).toEqual(['lib/util.py', 'src/main.rs']);
    });
  });

  test('b7: a single star stays inside its segment (the core/glob.ts grammar)', () => {
    const { root } = makeProject('segment', {}, {
      'src/main.rs': 'x\n',
      'src/auth/session.rs': 'x\n',
    });
    return collectSourceFiles(root, cbCfg({ include: ['src/*.rs'], exclude: [] })).then((out) => {
      expect(out).toEqual(['src/main.rs']);
    });
  });

  test('b8: exclude wins over include', () => {
    const { root } = makeProject('exclude-wins', {}, {
      'src/keep.rs': 'x\n',
      'src/gen/produced.rs': 'x\n',
    });
    return collectSourceFiles(root, cbCfg({ include: ['src/*.rs', 'src/gen/*.rs'], exclude: ['src/gen/*.rs'] })).then((out) => {
      expect(out).toEqual(['src/keep.rs']);
    });
  });

  test('b9: a root named like the workspace selects nothing (never scanned)', () => {
    const { root } = makeProject('ws-named-root', {
      '02-auth.md': CORPUS_SRC,
      'plugins/leaf.md': '- Leaf\n',
    }, { 'src/main.rs': 'x\n' });
    // The workspace's basename resolved from the project root IS the
    // workspace — inside(root, …) skips it wholesale.
    const wsName = root.split('/').pop()!;
    return collectSourceFiles(root, cbCfg({ roots: [wsName, 'src'] })).then((out) => {
      expect(out).toEqual(['src/main.rs']);
    });
  });
});

// ── C. Resolution (§2.3) ────────────────────────────────────────────────────

describe('issue #66 engine — resolution (§2.3)', () => {
  test('c1: valid file+slug via the tolerant anchorMatches — case, separator and em-dash variants', async () => {
    const { root } = makeProject('resolve-ok', { '02-auth.md': CORPUS_SRC }, {
      'src/a.rs': [
        '// see: 02-auth.md#session_validation',
        '// see: 02-auth.md#SESSION-VALIDATION',
        '// see: 02-auth.md#Session-validation',
        '',
      ].join('\n'),
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings).toEqual([]);
    expect(scan.scanned).toBe(1);
    expect(scan.pointers).toBe(3);
  });

  test('c2: FileNotFound — missing target, resolvedFile null, message names the source and raw pointer', async () => {
    const { root } = makeProject('resolve-file', { '02-auth.md': CORPUS_SRC }, {
      'src/auth/session.rs': '// see: 99-nope.md#Ghost\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings.length).toBe(1);
    const f = scan.findings[0]!;
    expect(f.reason).toBe('FileNotFound');
    expect(f.resolvedFile).toBeNull();
    expect(f.file).toBe('src/auth/session.rs');
    expect(f.line).toBe(1);
    expect(f.raw).toBe('see: 99-nope.md#Ghost');
    expect(f.targetFile).toBe('99-nope.md');
    expect(f.targetSlug).toBe('Ghost');
    expect(f.message).toBe(
      'broken codebase ref: src/auth/session.rs:1 — see: 99-nope.md#Ghost — file not found in the spec corpus',
    );
    expect(f.suggestion).toBeUndefined();
  });

  test('c3: AnchorNotFound WITH a fuzzy suggestion — refs-engine did-you-mean tone', async () => {
    const { root } = makeProject('resolve-typos', { '02-auth.md': CORPUS_SRC }, {
      'src/auth/session.rs': '// see: 02-auth.md#Sesion-validaton\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings.length).toBe(1);
    const f = scan.findings[0]!;
    expect(f.reason).toBe('AnchorNotFound');
    expect(f.resolvedFile).toBe('02-auth.md');
    expect(f.message).toBe(
      'broken codebase ref: src/auth/session.rs:1 — see: 02-auth.md#Sesion-validaton — anchor not found in 02-auth.md',
    );
    expect(f.suggestion).toBe('did you mean 02-auth.md#Session-validation? — fix the ref anchor');
  });

  test('c4: AnchorNotFound without a near candidate — no suggestion field', async () => {
    const { root } = makeProject('resolve-wayoff', { '02-auth.md': CORPUS_SRC }, {
      'src/auth/session.rs': '// see: 02-auth.md#Totally-Unrelated\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings.length).toBe(1);
    expect(scan.findings[0]!.reason).toBe('AnchorNotFound');
    expect(scan.findings[0]!.suggestion).toBeUndefined();
  });

  test('c5: cans/-prefixed spelling resolves to the same corpus key (stripped)', async () => {
    const { root } = makeProject('resolve-cans', { '02-auth.md': CORPUS_SRC }, {
      'src/a.rs': '// see: cans/02-auth.md#Passwords\n',
      'src/b.rs': '// see: cans/99-nope.md#Ghost\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.pointers).toBe(2);
    expect(scan.findings.length).toBe(1);
    expect(scan.findings[0]!.file).toBe('src/b.rs');
    expect(scan.findings[0]!.reason).toBe('FileNotFound');
  });

  test('c6: file-level pointers (no anchor) resolve silently', async () => {
    const { root } = makeProject('resolve-filelevel', { '02-auth.md': CORPUS_SRC }, {
      'src/a.rs': '// see: 02-auth.md\n// see: cans/02-auth.md\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings).toEqual([]);
    expect(scan.pointers).toBe(2);
  });

  test('c7: two near candidates surface the ambiguity (top-3 list, never a coin flip)', async () => {
    const { root } = makeProject('resolve-ambiguous', { '02-auth.md': CORPUS_SRC }, {
      'src/a.rs': '// see: 02-auth.md#Retry-polices\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings.length).toBe(1);
    expect(scan.findings[0]!.suggestion).toBe(
      'did you mean 02-auth.md#Retry-policies, 02-auth.md#Retry-policy? — fix the ref anchor',
    );
  });

  test('c8: counters — scanned files, extracted pointers regardless of outcome; empty project scans to zeros', async () => {
    const { root } = makeProject('counters', { '02-auth.md': CORPUS_SRC }, {
      'src/a.rs': '// see: 02-auth.md#Passwords\n// see: 99-nope.md#Ghost\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.scanned).toBe(1);
    expect(scan.pointers).toBe(2);
    expect(scan.findings.length).toBe(1);

    const empty = makeProject('counters-empty', { '02-auth.md': CORPUS_SRC });
    const none = await checkCodebaseRefs(empty.root, cbCfg(), corpusOf(CORPUS));
    expect(none.scanned).toBe(0);
    expect(none.pointers).toBe(0);
    expect(none.findings).toEqual([]);
    expect(none.warnings).toEqual([]);
  });

  test('c9: deterministic order — file asc, line asc, raw order within a line', async () => {
    const { root } = makeProject('order', { '02-auth.md': CORPUS_SRC }, {
      'src/z.rs': '// see: 02-auth.md#Totally-Unrelated\n// see: 99-nope.md#Ghost\n',
      'src/auth/user.rs': '// see: 02-auth.md#Totally-Unrelated // see: 99-nope.md#Ghost\n',
      'src/main.rs': '// see: 02-auth.md#Totally-Unrelated\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings.map(f => [f.file, f.line, f.targetFile])).toEqual([
      ['src/auth/user.rs', 1, '02-auth.md'],
      ['src/auth/user.rs', 1, '99-nope.md'],
      ['src/main.rs', 1, '02-auth.md'],
      ['src/z.rs', 1, '02-auth.md'],
      ['src/z.rs', 2, '99-nope.md'],
    ]);
  });

  test('c10: an unreadable source file warns (codebase.io) and is skipped, never silently', async () => {
    const { root } = makeProject('io-warn', { '02-auth.md': CORPUS_SRC }, {
      'src/gated.rs': '// see: 02-auth.md#Passwords\n',
      'src/open.rs': '// see: 02-auth.md#Totally-Unrelated\n',
    });
    const gated = join(dirname(root), 'src', 'gated.rs');
    expect(readFileSync(gated, 'utf-8').length).toBeGreaterThan(0); // it exists
    chmodSync(gated, 0o000);
    try {
      const scan: CodebaseScan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
      expect(scan.warnings.length).toBe(1);
      const w = scan.warnings[0]!;
      expect(w.file).toBe('src/gated.rs');
      expect(w.line).toBe(0);
      expect(w.level).toBe('warning');
      expect(w.category).toBe('refs');
      expect(w.rule).toBe('codebase.io');
      expect(w.message).toMatch(/unreadable source file: /);
      expect(w.message).toMatch(/EACCES|permission denied/i);
      // The gated file contributed no pointers; the readable one still scanned.
      expect(scan.scanned).toBe(2);
      expect(scan.pointers).toBe(1);
      expect(scan.findings.length).toBe(1);
      expect(scan.findings[0]!.file).toBe('src/open.rs');
    } finally {
      chmodSync(gated, 0o644); // let the tmp cleaner unlink the tree
    }
  });
});

// ── D. Config: defaults + strict validation ─────────────────────────────────

describe('issue #66 engine — config defaults', () => {
  test('d1: defaultCodebaseRules() spells the documented defaults', () => {
    expect(defaultCodebaseRules()).toEqual({
      enabled: false,
      roots: ['.'],
      include: ['**/*.rs', '**/*.ts', '**/*.js', '**/*.py', '**/*.go', '**/*.c', '**/*.cpp'],
      exclude: ['**/target/**', '**/node_modules/**', '**/.git/**', '**/dist/**'],
      severity: 'error',
    });
  });

  test('d2: defaultRules() carries the codebase defaults', () => {
    expect(defaultRules().codebase).toEqual(defaultCodebaseRules());
  });

  test('d3: a _rules.yaml WITHOUT the block loads it as the disabled default (pre-#66 = OFF)', () => {
    const { root } = makeProject('cfg-absent', {
      '_rules.yaml': 'output:\n  slug_hints: false\n',
    });
    const rules = loadRules(root);
    expect(rules.codebase).toEqual(defaultCodebaseRules());
    expect(rules.codebase!.enabled).toBe(false);
  });

  test('d4: an explicitly EMPTY `codebase:` block is legal and means OFF (null)', () => {
    const { root } = makeProject('cfg-empty', {
      '_rules.yaml': 'codebase:\n',
    });
    const rules = loadRules(root);
    expect(rules.codebase).toBeNull();
  });

  test('d5: a partial block deep-merges over the documented defaults', () => {
    const { root } = makeProject('cfg-partial', {
      '_rules.yaml': [
        'codebase:',
        '  enabled: true',
        '  roots:',
        '    - src',
        '',
      ].join('\n'),
    });
    const rules = loadRules(root);
    expect(rules.codebase).toEqual({
      enabled: true,
      roots: ['src'],
      include: defaultCodebaseRules().include,
      exclude: defaultCodebaseRules().exclude,
      severity: 'error',
    });
  });

  test('d6: a full block loads verbatim', () => {
    const { root } = makeProject('cfg-full', {
      '_rules.yaml': [
        'codebase:',
        '  enabled: true',
        '  roots:',
        '    - src',
        '    - lib',
        '  include:',
        '    - "src/*.rs"',
        '  exclude:',
        '    - "src/gen/**"',
        '  severity: warning',
        '',
      ].join('\n'),
    });
    expect(loadRules(root).codebase).toEqual({
      enabled: true,
      roots: ['src', 'lib'],
      include: ['src/*.rs'],
      exclude: ['src/gen/**'],
      severity: 'warning',
    });
  });

  test('d7: listing codebase never joins the §18 delete/override reconciliation', () => {
    // `codebase:` is the ONLY listed section — the file is a sparse override,
    // not a curated config: every check engine keeps its defaults.
    const { root } = makeProject('cfg-reconcile', {
      '_rules.yaml': [
        'codebase:',
        '  enabled: true',
        '',
      ].join('\n'),
    });
    const rules = loadRules(root);
    expect(rules.codebase!.enabled).toBe(true);
    expect(rules.structure.node_length.min).toBe(defaultRules().structure.node_length.min);
    expect(rules.structure.node_length.max).toBe(defaultRules().structure.node_length.max);
    expect(rules.references.orphan_check).toBe(true);
    expect(rules.redundancy.enabled).toBe(true);
  });

  test('d8: a pre-#66 _rules.yaml still loads byte-identically', () => {
    const { root } = makeProject('cfg-pre66', {
      '_rules.yaml': [
        'redundancy:',
        '  enabled: true',
        'token_budget:',
        '  enabled: true',
        '',
      ].join('\n'),
    });
    expect(loadRules(root)).toEqual(defaultRules());
  });
});

describe('issue #66 engine — strict validation (issue #56 discipline)', () => {
  const load = (name: string, yaml: string): ReturnType<typeof loadRules> => {
    const { root } = makeProject(name, { '_rules.yaml': yaml });
    return loadRules(root);
  };

  test('d9: enabled must be boolean', () => {
    expect(() => load('v-enabled', 'codebase:\n  enabled: 42\n')).toThrow(
      /"codebase\.enabled" must be true or false, got "42"/,
    );
  });

  test('d10: roots must be a string array; an empty entry rejects', () => {
    expect(() => load('v-roots-shape', 'codebase:\n  roots: src\n')).toThrow(
      /"codebase\.roots" must be a list of project-relative directory paths/,
    );
    expect(() => load('v-roots-empty', 'codebase:\n  roots:\n    - ""\n')).toThrow(
      /"codebase\.roots\[0\]" must be a non-empty project-relative directory path/,
    );
    expect(() => load('v-roots-num', 'codebase:\n  roots:\n    - 42\n')).toThrow(
      /"codebase\.roots\[0\]" must be a non-empty project-relative directory path/,
    );
  });

  test('d11: roots reject absolute, traversing and backslash paths (the guardrails path rules)', () => {
    for (const [name, bad] of [
      ['v-roots-abs', '/etc'],
      ['v-roots-dotdot', 'src/../..'],
      ['v-roots-backslash', 'src\\lib'],
    ] as Array<[string, string]>) {
      expect(() => load(name, `codebase:\n  roots:\n    - '${bad}'\n`)).toThrow(
        /"codebase\.roots\[0\]" must be a project-relative POSIX path \(no leading "\/", no "\.\." segment, no "\\"\)/,
      );
    }
  });

  test('d12: include/exclude must be glob lists — empty members and malformed globs reject', () => {
    expect(() => load('v-inc-shape', 'codebase:\n  include: "src/*.rs"\n')).toThrow(
      /"codebase\.include" must be a list of globs/,
    );
    expect(() => load('v-inc-empty', 'codebase:\n  include:\n    - ""\n')).toThrow(
      /"codebase\.include\[0\]" must be a non-empty glob/,
    );
    expect(() => load('v-inc-unclosed', 'codebase:\n  include:\n    - "src/[0-9.md"\n')).toThrow(
      /"codebase\.include\[0\]" is not a valid glob \(unclosed "\[" or dangling "\\"\)/,
    );
    expect(() => load('v-exc-dangling', "codebase:\n  exclude:\n    - ok\n    - 'a\\'\n")).toThrow(
      /"codebase\.exclude\[1\]" is not a valid glob/,
    );
  });

  test('d13: severity is the forbidden_targets spelling — "error" or "warning"', () => {
    expect(() => load('v-sev', 'codebase:\n  severity: warn\n')).toThrow(
      /"codebase\.severity" must be "error" or "warning", got "warn"/,
    );
    // The other legal spelling loads.
    const rules = load('v-sev-ok', 'codebase:\n  severity: warning\n  enabled: true\n');
    expect(rules.codebase!.severity).toBe('warning');
  });

  test('d14: unknown members inside the block reject (typo discipline)', () => {
    expect(() => load('v-typo', 'codebase:\n  rooots:\n    - src\n')).toThrow(
      /unrecognized key "codebase\.rooots"/,
    );
  });

  test('d15: errors are line-numbered like every other §18 config error', () => {
    expect(() =>
      load(
        'v-line',
        [
          'structure:',
          '  depth: { min: 1, max: 5 }',
          'codebase:',
          '  enabled: banana',
          '',
        ].join('\n'),
      ),
    ).toThrow(/line 4 — "codebase\.enabled" must be true or false/);
  });

  test('d16: an absent block produces no errors and no behavior change (§18 files stay legal)', () => {
    // A fuller pre-#66-style config with unrelated sections must still load.
    const rules = load('v-absent', [
      'structure:',
      '  depth: { min: 1, max: 5 }',
      'references:',
      '  orphan_check: true',
      '',
    ].join('\n'));
    expect(rules.codebase).toEqual(defaultCodebaseRules());
    expect(rules.structure.depth).toEqual({ min: 1, max: 5 });
  });
});

// ── E. Engine + config wiring ───────────────────────────────────────────────

describe('issue #66 engine — loadRules drives checkCodebaseRefs', () => {
  test('e1: the normalized config block feeds the engine end to end', async () => {
    const { root } = makeProject('wiring', {
      '_rules.yaml': [
        'codebase:',
        '  enabled: true',
        '  roots:',
        '    - src',
        '  severity: warning',
        '',
      ].join('\n'),
    }, {
      'src/auth/session.rs': '// see: 02-auth.md#Sesion-validaton\n// see: 02-auth.md#Passwords\n',
      'lib/other.py': '# see: 02-auth.md#Passwords\n', // outside roots — never scanned
    });
    const rules = loadRules(root);
    expect(rules.codebase!.enabled).toBe(true);
    const scan = await checkCodebaseRefs(root, rules.codebase!, corpusOf(CORPUS));
    expect(scan.scanned).toBe(1); // only src/ walked
    expect(scan.pointers).toBe(2);
    expect(scan.findings.length).toBe(1);
    expect(scan.findings[0]!.file).toBe('src/auth/session.rs');
    expect(scan.findings[0]!.reason).toBe('AnchorNotFound');
    expect(scan.findings[0]!.suggestion).toBe('did you mean 02-auth.md#Session-validation? — fix the ref anchor');
  });
});
