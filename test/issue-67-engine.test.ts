/**
 * Issue #67 — the ENGINE half: two false-positive repairs in the codebase
 * inbound-references scanner (both reported against v0.15.0 on the kelir
 * repo: 135 false `anchor not found` positives over 748 valid embedded
 * `see:` pointers).
 *
 *   bug 1 (127/135) — SEE_POINTER_RE's anchor class `[A-Za-z0-9_\-]+`
 *   contradicted the slug contract (`_rules.yaml#slug.algorithm`,
 *   core/slug.ts: every non-separator character preserved VERBATIM, case
 *   included), so real-world anchors truncated at the first `(` `)` `,`
 *   `:` `/` `^` … (`#UID/GID-mapping-isolation` read as `#UID`). Fix: the
 *   anchor group is `([^\s#]+)` — whitespace/`#`-terminated, the exact
 *   §11 REF_RE shape — and the captured anchor is cleaned by
 *   stripCodebaseAnchorPunct (the #48 trailing-punctuation strip + the #58
 *   opener repair, generalized from `]` to `()[]{}`) before storage; `raw`
 *   stays the verbatim written span.
 *
 *   bug 2 (8/135) — spec nodes routinely carry their own pointer as a
 *   suffix (`- Connection parking on suspend: see:
 *   artifacts/examples/serverless-webhook.ts`) while the code points at
 *   the BARE leaf title; slugifying the whole node line matched nothing.
 *   Fix: stripSeeRefSuffix + checkCodebaseRefs matching on the full text
 *   OR the stripped title, with anchorSuggestion proposing the stripped
 *   leaf title's canonical anchorSlug.
 *
 *   a1-a13 .. extraction: the issue's anchor table verbatim, the cleaning
 *             matrix (glued `)` `);` `,` `’`, opener-backed survivors, the
 *             wrapped-prose `))` form, bracket/brace repair), raw-verbatim
 *             spans, empty-after-strip → null, multi-pointer lines with
 *             punctuation, CRLF, no-anchor pointers, `#` termination, the
 *             global flag
 *   b1-b7 .... stripSeeRefSuffix: the issue's three suffixed nodes, both
 *             §11 keyword spellings, no-suffix no-op (not even trimmed),
 *             bare-ref and non-trailing refs untouched, anchor-carrying
 *             suffixes
 *   c1-c7 .... resolution: the three suffixed nodes resolve via the
 *             stripped title, the issue's bug-1 anchor table resolves
 *             end-to-end, suffix-free nodes unaffected, a genuine typo
 *             STILL reports (the over-tolerance regression guard),
 *             suggestion coherence for a suffixed node, the combined
 *             glued+suffixed shape, the `#).` file-level degradation
 *
 * Runtime-neutral: imports the test facade, never 'bun:test' directly.
 */
import { describe, test, expect, afterEach } from './testing.ts';
import { join, dirname } from 'path';
import { mkdirSync, writeFileSync } from 'fs';

import {
  SEE_POINTER_RE,
  extractCodebasePointers,
  checkCodebaseRefs,
  stripCodebaseAnchorPunct,
  stripSeeRefSuffix,
} from '../src/core/codebase.ts';
import { defaultCodebaseRules } from '../src/core/rules.ts';
import { parseOutline } from '../src/core/outline.ts';
import { makeTmpDir, cleanTmpDir, makeCansWorkspace } from './helpers.ts';
import type { CodebaseRules, OutlineNode } from '../src/types.ts';

// ── Scaffolding (the issue #66 engine suite's shape) ────────────────────────

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
 *  own turf. */
function makeProject(
  name: string,
  files: Record<string, string> = {},
  projectFiles: Record<string, string> = {},
): { project: string; root: string } {
  const project = makeTmpDir(`issue67-engine-${name}`);
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

// The issue's bug-2 corpus, verbatim: three spec nodes that carry their
// pointer as a `: see:` suffix, and the code pointing at the bare titles.
const WIRE_SRC = '- Connection parking on suspend: see: artifacts/examples/serverless-webhook.ts\n';
const DB_SRC = '- L7 pgwire rewrite and 2PC commit: see: artifacts/examples/db-backed-runtime.py\n';
const SWARM_SRC = '- CoW swarm mesh federation: see: artifacts/examples/multi-vm-swarm.rs\n';
const SUFFIX_CORPUS: Array<[string, string]> = [
  ['plugins/wire-ingress.md', WIRE_SRC],
  ['plugins/db-runtime.md', DB_SRC],
  ['plugins/swarm.md', SWARM_SRC],
];

// ── A. Extraction: the full-alphabet anchor + the cleaning pass ─────────────

describe('issue #67 engine — extraction (bug 1: the anchor alphabet)', () => {
  test('a1: the issue\'s anchor table extracts verbatim — no truncation at ( ) , : / ^', () => {
    // Every row: a pointer spelling from the kelir bug report, with the
    // anchor EXACTLY as the slug contract produces it. Pre-#67 the narrow
    // class read each as the truncated form in the trailing comment.
    const table: Array<[string, string, string, string]> = [
      // [source line, raw span, targetFile, targetSlug]
      ['// see: cans/plugins/transaction.md#Invariants-and-policy-(transaction)',
        'see: cans/plugins/transaction.md#Invariants-and-policy-(transaction)',
        'cans/plugins/transaction.md', 'Invariants-and-policy-(transaction)'], // was #Invariants-and-policy-
      ['// see: cans/02-plugin-model.md#FsInodeAttr-carries-full-mode,-uid,-gid,-size,-content',
        'see: cans/02-plugin-model.md#FsInodeAttr-carries-full-mode,-uid,-gid,-size,-content',
        'cans/02-plugin-model.md', 'FsInodeAttr-carries-full-mode,-uid,-gid,-size,-content'], // was #FsInodeAttr-carries-full-mode
      ['// see: cans/plugins/container.md#UID/GID-mapping-isolation',
        'see: cans/plugins/container.md#UID/GID-mapping-isolation',
        'cans/plugins/container.md', 'UID/GID-mapping-isolation'], // was #UID
      ['// see: cans/plugins/supply-chain.md#Dynamic-W^X-JIT-execution-mediation',
        'see: cans/plugins/supply-chain.md#Dynamic-W^X-JIT-execution-mediation',
        'cans/plugins/supply-chain.md', 'Dynamic-W^X-JIT-execution-mediation'], // was #Dynamic-W
      ['// see: cans/08-lifecycle.md#Native-checkpoint-plane-(kelir-core::checkpoint)',
        'see: cans/08-lifecycle.md#Native-checkpoint-plane-(kelir-core::checkpoint)',
        'cans/08-lifecycle.md', 'Native-checkpoint-plane-(kelir-core::checkpoint)'], // was #Native-checkpoint-plane-
    ];
    for (const [line, raw, file, slug] of table) {
      const out = extractCodebasePointers(line);
      expect(out.length).toBe(1);
      expect(out[0]!.raw).toBe(raw);
      expect(out[0]!.targetFile).toBe(file);
      expect(out[0]!.targetSlug).toBe(slug);
    }
  });

  test('a2: the cleaning matrix — glued punctuation strips, opener-backed closers survive, mid-token never touched', () => {
    // [captured anchor, cleaned targetSlug] — the required-behavior table
    // from the issue, plus the ]/} halves of the generalized #58 repair.
    const table: Array<[string, string]> = [
      // Opener-backed closers are STRUCTURAL: strip then repair restores
      // them verbatim.
      ['Invariants-and-policy-(transaction)', 'Invariants-and-policy-(transaction)'],
      ['Native-checkpoint-plane-(kelir-core::checkpoint)', 'Native-checkpoint-plane-(kelir-core::checkpoint)'],
      ['Notes[0]', 'Notes[0]'],
      ['matrix[0][1]', 'matrix[0][1]'],
      ['Flags{strict}', 'Flags{strict}'],
      // Mid-token punctuation is not a trailing run: untouched (the slug
      // contract preserves it verbatim).
      ['FsInodeAttr-carries-full-mode,-uid,-gid,-size,-content', 'FsInodeAttr-carries-full-mode,-uid,-gid,-size,-content'],
      ['UID/GID-mapping-isolation', 'UID/GID-mapping-isolation'],
      ['Dynamic-W^X-JIT-execution-mediation', 'Dynamic-W^X-JIT-execution-mediation'],
      ['Session.v2', 'Session.v2'],
      // Glued prose punctuation has no opener backing it: stays stripped.
      ['Routing)', 'Routing'],
      ['Sessions);', 'Sessions'],
      ['Sessions,', 'Sessions'],
      ['Sessions:', 'Sessions'],
      ['Audit-spine’', 'Audit-spine'],
      ['items[0])', 'items[0]'],
      ['Flags{strict})', 'Flags{strict}'],
      // The wrapped-prose double: one structural closer, one glued —
      // exactly the structural half survives.
      ['API-(v2))', 'API-(v2)'],
      ['Routing-(v2))', 'Routing-(v2)'],
      // Pure punctuation: nothing left after the strip (the caller turns
      // '' into a file-level pointer — a7).
      [').', ''],
      // A trailing dash is NOT punctuation (the #48 rule: legitimate slug
      // ending) — the truncated spelling pre-#67 minted stays EXACTLY as
      // written, so it keeps failing to resolve instead of silently
      // "healing" into the full anchor.
      ['Invariants-and-policy-', 'Invariants-and-policy-'],
    ];
    for (const [anchor, cleaned] of table) {
      expect(stripCodebaseAnchorPunct(anchor)).toBe(cleaned);
    }
  });

  test('a3: glued `)` in prose — raw keeps the written span, targetSlug cleans', () => {
    const out = extractCodebasePointers('verify(x); /* (see: 02-auth.md#Routing) as above */');
    expect(out.length).toBe(1);
    // The #48 convention: raw quotes the WRITTEN spelling (glued `)`
    // included); only the resolved token is cleaned.
    expect(out[0]!.raw).toBe('see: 02-auth.md#Routing)');
    expect(out[0]!.targetFile).toBe('02-auth.md');
    expect(out[0]!.targetSlug).toBe('Routing');
  });

  test('a4: glued `);` — one trailing run strips whole', () => {
    const out = extractCodebasePointers('x = f(); /* (see: 02-auth.md#Sessions); */');
    expect(out.length).toBe(1);
    expect(out[0]!.raw).toBe('see: 02-auth.md#Sessions);');
    expect(out[0]!.targetSlug).toBe('Sessions');
  });

  test('a5: glued `,` — mid-token commas survive, a trailing one strips', () => {
    // Trailing glue: the anchor is `Sessions,` (cleaned to `Sessions`).
    const out = extractCodebasePointers('# see: 02-auth.md#Sessions, as noted above');
    expect(out.length).toBe(1);
    expect(out[0]!.raw).toBe('see: 02-auth.md#Sessions,');
    expect(out[0]!.targetSlug).toBe('Sessions');
    // Mid-token commas (the issue's FsInodeAttr row) are NOT a trailing run.
    const mid = extractCodebasePointers('// see: 02-auth.md#A,-b,-c');
    expect(mid[0]!.raw).toBe('see: 02-auth.md#A,-b,-c');
    expect(mid[0]!.targetSlug).toBe('A,-b,-c');
  });

  test('a6: the wrapped-prose double `))` — structural closer repaired, glued one gone', () => {
    const out = extractCodebasePointers('// wrap(see: 02-auth.md#API-(v2))');
    expect(out.length).toBe(1);
    expect(out[0]!.raw).toBe('see: 02-auth.md#API-(v2))');
    expect(out[0]!.targetSlug).toBe('API-(v2)');
  });

  test('a7: an anchor that cleans to empty degrades to a file-level pointer (targetSlug null)', () => {
    const out = extractCodebasePointers('// see: 02-auth.md#).');
    expect(out.length).toBe(1);
    expect(out[0]!.raw).toBe('see: 02-auth.md#).');
    expect(out[0]!.targetFile).toBe('02-auth.md');
    expect(out[0]!.targetSlug).toBeNull(); // the file target is real; the fragment was pure glue
  });

  test('a8: multi-pointer lines with punctuation — one entry each, left-to-right', () => {
    const out = extractCodebasePointers(
      '// see: 02-auth.md#Routing) and see: 03-b.md#Sessions); then see: cans/04-c.md#API-(v2))',
    );
    expect(out.length).toBe(3);
    expect(out[0]!.raw).toBe('see: 02-auth.md#Routing)');
    expect(out[0]!.targetSlug).toBe('Routing');
    expect(out[1]!.raw).toBe('see: 03-b.md#Sessions);');
    expect(out[1]!.targetSlug).toBe('Sessions');
    expect(out[2]!.raw).toBe('see: cans/04-c.md#API-(v2))');
    expect(out[2]!.targetFile).toBe('cans/04-c.md');
    expect(out[2]!.targetSlug).toBe('API-(v2)');
  });

  test('a9: CRLF input — glued punctuation cleans per line, line numbers stay 1-based', () => {
    const out = extractCodebasePointers('a\r\n// see: 02-auth.md#Sessions);\r\nb\r\n// see: 03-b.md#API-(v2))\r\n');
    expect(out.length).toBe(2);
    expect(out[0]!.line).toBe(2);
    expect(out[0]!.raw).toBe('see: 02-auth.md#Sessions);');
    expect(out[0]!.targetSlug).toBe('Sessions');
    expect(out[1]!.line).toBe(4);
    expect(out[1]!.raw).toBe('see: 03-b.md#API-(v2))');
    expect(out[1]!.targetSlug).toBe('API-(v2)');
  });

  test('a10: no-anchor pointers are unchanged — targetSlug null, cans/ spelling kept', () => {
    const out = extractCodebasePointers('// see: 02-auth.md\n# see: cans/03-b.md\n');
    expect(out.length).toBe(2);
    expect(out[0]!.targetFile).toBe('02-auth.md');
    expect(out[0]!.targetSlug).toBeNull();
    expect(out[1]!.raw).toBe('see: cans/03-b.md');
    expect(out[1]!.targetFile).toBe('cans/03-b.md');
    expect(out[1]!.targetSlug).toBeNull();
  });

  test('a11: the anchor terminates at `#` and the global flag survives (the frozen shape)', () => {
    // `#` is the only non-whitespace terminator: a second fragment never
    // joins the anchor (the §11 REF_RE group shape, kept byte-identical).
    const out = extractCodebasePointers('// see: 02-auth.md#Sessions#draft');
    expect(out.length).toBe(1);
    expect(out[0]!.raw).toBe('see: 02-auth.md#Sessions');
    expect(out[0]!.targetSlug).toBe('Sessions');
    expect(SEE_POINTER_RE.global).toBe(true); // per-line consumers rely on it
  });

  test('a12: punctuation-free anchors keep the exact pre-#67 behavior (the healthy corpus)', () => {
    // The 748 VALID pointers on the reporter's corpus were never the
    // problem — they must extract byte-identically after the fix.
    const out = extractCodebasePointers([
      '// see: 02-auth.md#Sessions',
      '// Initial handshake logic; see: 01-protocol.md#Handshake - note',
      '// see: cans/plugins/leaf.md#Leaf',
      '',
    ].join('\n'));
    expect(out.map(p => [p.line, p.raw, p.targetFile, p.targetSlug])).toEqual([
      [1, 'see: 02-auth.md#Sessions', '02-auth.md', 'Sessions'],
      [2, 'see: 01-protocol.md#Handshake', '01-protocol.md', 'Handshake'],
      [3, 'see: cans/plugins/leaf.md#Leaf', 'cans/plugins/leaf.md', 'Leaf'],
    ]);
  });

  test('a13: the extractor output type carries the cleaned slug but the verbatim raw', () => {
    // The wire contract in one pin: `raw` is written spelling, `targetSlug`
    // is the resolvable token (the seam the CLI's --json block rides).
    const out = extractCodebasePointers('fn f() { g(/* (see: 08-lifecycle.md#Native-checkpoint-plane-(kelir-core::checkpoint)) */) }');
    expect(out.length).toBe(1);
    expect(out[0]!.raw).toBe('see: 08-lifecycle.md#Native-checkpoint-plane-(kelir-core::checkpoint))');
    expect(out[0]!.targetFile).toBe('08-lifecycle.md');
    expect(out[0]!.targetSlug).toBe('Native-checkpoint-plane-(kelir-core::checkpoint)');
    expect(out[0]!.line).toBe(1);
  });
});

// ── B. stripSeeRefSuffix (bug 2: the node-title side) ───────────────────────

describe('issue #67 engine — stripSeeRefSuffix (bug 2: the suffix strip)', () => {
  test('b1: the issue\'s three suffixed node lines strip to their bare titles', () => {
    expect(stripSeeRefSuffix(
      'Connection parking on suspend: see: artifacts/examples/serverless-webhook.ts',
    )).toBe('Connection parking on suspend');
    expect(stripSeeRefSuffix(
      'L7 pgwire rewrite and 2PC commit: see: artifacts/examples/db-backed-runtime.py',
    )).toBe('L7 pgwire rewrite and 2PC commit');
    expect(stripSeeRefSuffix(
      'CoW swarm mesh federation: see: artifacts/examples/multi-vm-swarm.rs',
    )).toBe('CoW swarm mesh federation');
  });

  test('b2: both §11 keyword spellings (`see:` / `see `) and glued `:see:` strip', () => {
    expect(stripSeeRefSuffix('Retries: see 07-network.md')).toBe('Retries');
    expect(stripSeeRefSuffix('Retries: see: 07-network.md')).toBe('Retries');
    expect(stripSeeRefSuffix('Map:see: 00-overview.md')).toBe('Map'); // zero-space separator
  });

  test('b3: no suffix → the input is returned UNCHANGED, not even trimmed', () => {
    const plain = '  Session validation  ';
    expect(stripSeeRefSuffix(plain)).toBe(plain);
    expect(stripSeeRefSuffix('Passwords')).toBe('Passwords');
    expect(stripSeeRefSuffix('')).toBe('');
  });

  test('b4: a bare `- see: x.md` node (no separator colon before the keyword) is not a suffix', () => {
    // The colon BEFORE `see` is the title|pointer split marker; a node that
    // is nothing but its ref has no title side to strip.
    expect(stripSeeRefSuffix('see: 02-auth.md')).toBe('see: 02-auth.md');
    expect(stripSeeRefSuffix('see 02-auth.md')).toBe('see 02-auth.md');
  });

  test('b5: a ref that is NOT trailing is not a suffix — prose after the token blocks the strip', () => {
    expect(stripSeeRefSuffix('Session notes: see: 02-auth.md and beyond')).toBe(
      'Session notes: see: 02-auth.md and beyond',
    );
  });

  test('b6: a suffix carrying an anchor token strips whole', () => {
    expect(stripSeeRefSuffix('Map: see: 00-overview.md#Layout')).toBe('Map');
    expect(stripSeeRefSuffix('Deep dive: see: plugins/leaf.md#Leaf')).toBe('Deep dive');
  });

  test('b7: the remainder is trimmed; text before a mid-line suffix is preserved verbatim', () => {
    expect(stripSeeRefSuffix('Title :  see: 00-overview.md')).toBe('Title');
    expect(stripSeeRefSuffix('UID/GID mapping: see: 00-overview.md')).toBe('UID/GID mapping');
  });
});

// ── C. Resolution (§2.3): suffixed titles + the full anchor alphabet ────────

describe('issue #67 engine — resolution (bug 1 + bug 2, end to end)', () => {
  test('c1: the issue\'s three `: see:`-suffixed nodes resolve via the stripped title', async () => {
    const { root } = makeProject('suffix-resolve', {
      'plugins/wire-ingress.md': WIRE_SRC,
      'plugins/db-runtime.md': DB_SRC,
      'plugins/swarm.md': SWARM_SRC,
    }, {
      'src/hook.ts': '// see: cans/plugins/wire-ingress.md#Connection-parking-on-suspend\n',
      'src/db.py': '# see: plugins/db-runtime.md#L7-pgwire-rewrite-and-2PC-commit\n',
      'src/swarm.rs': '// see: plugins/swarm.md#CoW-swarm-mesh-federation\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(SUFFIX_CORPUS));
    expect(scan.findings).toEqual([]); // the 8 false positives, gone
    expect(scan.scanned).toBe(3);
    expect(scan.pointers).toBe(3);
  });

  test('c2: the issue\'s bug-1 anchor table resolves end to end against verbatim headings', async () => {
    // Headings titled EXACTLY as the reporter's: the slug contract turns
    // each into the anchor the code points at. Pre-#67 every row below was
    // a false `anchor not found` (the truncated slug matched nothing).
    const corpusFiles: Record<string, string> = {
      'plugins/transaction.md': '- Invariants and policy (transaction)\n',
      '02-plugin-model.md': '- FsInodeAttr carries full mode, uid, gid, size, content\n',
      'plugins/container.md': '- UID/GID mapping isolation\n',
      'plugins/supply-chain.md': '- Dynamic W^X JIT execution mediation\n',
      '08-lifecycle.md': '- Native checkpoint plane (kelir-core::checkpoint)\n',
    };
    const { root } = makeProject('alphabet-resolve', corpusFiles, {
      'src/transaction.rs': [
        '// see: cans/plugins/transaction.md#Invariants-and-policy-(transaction)',
        '// see: cans/02-plugin-model.md#FsInodeAttr-carries-full-mode,-uid,-gid,-size,-content',
        '// see: cans/plugins/container.md#UID/GID-mapping-isolation',
        '// see: cans/plugins/supply-chain.md#Dynamic-W^X-JIT-execution-mediation',
        '// see: cans/08-lifecycle.md#Native-checkpoint-plane-(kelir-core::checkpoint)',
        '',
      ].join('\n'),
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(Object.entries(corpusFiles)));
    expect(scan.findings).toEqual([]); // the 127 false positives, gone
    expect(scan.pointers).toBe(5);
  });

  test('c3: suffix-free nodes are unaffected — plain titles still resolve and plain typos still fail', async () => {
    const corpus: Array<[string, string]> = [
      ['plugins/wire-ingress.md', `${WIRE_SRC}- Retry policy\n`],
    ];
    const { root } = makeProject('mixed', {
      'plugins/wire-ingress.md': corpus[0]![1],
    }, {
      'src/a.ts': '// see: plugins/wire-ingress.md#Connection-parking-on-suspend\n',
      'src/b.ts': '// see: plugins/wire-ingress.md#Retry-policy\n',
      'src/c.ts': '// see: plugins/wire-ingress.md#Totally-Unrelated\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(corpus));
    expect(scan.pointers).toBe(3);
    expect(scan.findings.length).toBe(1); // only the genuinely unrelated anchor
    expect(scan.findings[0]!.reason).toBe('AnchorNotFound');
    expect(scan.findings[0]!.file).toBe('src/c.ts');
  });

  test('c4: over-tolerance guard — a genuine typo against a SUFFIXED node is STILL reported', async () => {
    // The fix must widen matching, not dissolve it: a near-miss of the
    // bare title fails against BOTH the full text and the stripped title.
    const { root } = makeProject('typo-guard', {
      'plugins/wire-ingress.md': WIRE_SRC,
    }, {
      'src/hook.ts': '// see: plugins/wire-ingress.md#Connection-parking-on-suspen\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(SUFFIX_CORPUS));
    expect(scan.findings.length).toBe(1);
    expect(scan.findings[0]!.reason).toBe('AnchorNotFound');
    expect(scan.findings[0]!.file).toBe('src/hook.ts');
    expect(scan.findings[0]!.targetSlug).toBe('Connection-parking-on-suspen');
  });

  test('c5: suggestion coherence — a suffixed node proposes its bare title\'s canonical anchorSlug', async () => {
    const { root } = makeProject('suffix-suggest', {
      'plugins/wire-ingress.md': WIRE_SRC,
    }, {
      'src/hook.ts': '// see: plugins/wire-ingress.md#Connection-parking-on-suspen\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(SUFFIX_CORPUS));
    expect(scan.findings.length).toBe(1);
    // The proposal is the canonical slug of the STRIPPED leaf title — not
    // the suffixed line's slug (which nobody could resolve), and not the
    // artifacts pointer the node itself carries.
    expect(scan.findings[0]!.suggestion).toBe(
      'did you mean plugins/wire-ingress.md#Connection-parking-on-suspend? — fix the ref anchor',
    );
    expect(scan.findings[0]!.suggestion).not.toContain('artifacts');
  });

  test('c6: the combined shape — glued punctuation on a parenthesized SUFFIXED title resolves', async () => {
    const { root } = makeProject('combined', {
      '04-api.md': '- Routing (v2): see: artifacts/examples/router.ts\n',
    }, {
      'src/routes.ts': '// wrap(see: 04-api.md#Routing-(v2))\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf([['04-api.md', '- Routing (v2): see: artifacts/examples/router.ts\n']]));
    expect(scan.findings).toEqual([]); // bug 1 (glued `)`) + bug 2 (the suffix) in one pointer
    expect(scan.pointers).toBe(1);
  });

  test('c7: `#).` resolves as a file-level pointer — the emptied anchor never becomes a finding', async () => {
    const { root } = makeProject('empty-anchor', {
      '02-auth.md': '- Session validation\n',
    }, {
      'src/a.rs': '// see: 02-auth.md#).\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf([['02-auth.md', '- Session validation\n']]));
    expect(scan.pointers).toBe(1);
    expect(scan.findings).toEqual([]); // the file target is real; the fragment was pure glue
  });
});
