/**
 * Issue #68 — the ENGINE half: the cleaning pass goes SYMMETRIC at the
 * shared anchorMatches seam (reported against v0.16.0 on the kelir repo @
 * 6bc53d3: `cans check --codebase --json` exits 2 with 5 false `anchor not
 * found` errors — all five anchors correct per `cans slug` — while plain
 * `cans check --json` exits 0; the #67 fix had resolved 130 of 0.15.0's
 * 135 errors, and these 5 are the same defect class at a new seam, the
 * 0.16.0 cleaning pass).
 *
 *   the defect — ONE-SIDED cleaning. The ANCHOR side is cleaned at
 *   extraction (codebase.ts stripCodebaseAnchorPunct strips one trailing
 *   run of `)]},.;:!?'"’”…`, repairing opener-backed closers) and the
 *   corpus side does the same at outline parse (stripRefTrailingPunct —
 *   frozen #48/#57/#58 behavior). But the HEADING side was never cleaned
 *   at matching: refs.ts anchorMatches compared normalizeForAnchor(
 *   nodeText) against normalizeForAnchor(anchor), and the slug contract
 *   (`_rules.yaml#slug.algorithm`, core/slug.ts) preserves every
 *   non-separator character VERBATIM — `:` is not a separator — so the
 *   heading `SQLite UDS bridge mechanics:` keeps its colon forever. The
 *   canonical anchor `SQLite-UDS-bridge-mechanics:` (exactly what
 *   `cans slug` prints) minted a false positive the moment the extractor
 *   stripped the colon from the captured anchor: cleaned anchor vs
 *   uncleaned heading never matches.
 *
 *   the fix — clause 3 in anchorMatches: compare CLEANED-vs-CLEANED, both
 *   sides through slug.ts stripAnchorTrailingPunct (the #67 pass moved to
 *   the anchor-matching single-source module — same strip set, same
 *   opener-aware repair, codebase.ts now delegates). Clauses 1 (exact) and
 *   2 (normalized) are untouched, so the fix is STRICTLY WIDENING:
 *   everything that resolved before still resolves, the kelir five
 *   resolve, genuine misspellings still fail. And because anchorMatches
 *   is the ONE shared matching seam, the symmetry also closes the
 *   corpus-side latent class: a spec ref written with the canonical colon
 *   spelling has its anchor token colon-stripped at outline parse while
 *   the heading keeps its colon — pre-fix, the same false positive.
 *
 *   a1-a8 .... stripAnchorTrailingPunct (slug.ts, the moved pass): the
 *             sentence-punct endings of the kelir anchors, glued runs,
 *             opener-backed survivors, the paren+colon `):` ending of the
 *             wire-ingress anchor (the run strips, the structural `)`
 *             repairs), the wrapped-prose double, schematic index
 *             brackets, empty-after-strip, idempotence
 *   b1-b7 .... anchorMatches: the three kelir headings vs their canonical
 *             colon anchors AND vs the colon-stripped spellings, the full
 *             written wire-ingress spelling, the corpus-shaped
 *             colon-stripped anchor exactly as outline.ts parse mints it,
 *             the strictly-widening guard (clauses 1-2 still carry every
 *             pre-#68 resolution), misspellings still false, a different
 *             heading still false
 *   c1-c2 .... end-to-end checkCodebaseRefs over a scratch mini
 *             workspace: the kelir five resolve (0 findings, 5 pointers,
 *             verbatim written spellings); one misspelled colon anchor
 *             STILL reports — exactly one AnchorNotFound finding whose
 *             suggestion proposes the canonical colon spelling
 *   d1 ....... the corpus-side twin: a spec ref written with the canonical
 *             colon spelling resolves through buildRefGraph + checkRefs
 *             (pre-fix: the same latent false positive, pinned resolving)
 *
 * Runtime-neutral: imports the test facade, never 'bun:test' directly.
 */
import { describe, test, expect, afterEach } from './testing.ts';
import { join, dirname } from 'path';
import { mkdirSync, writeFileSync } from 'fs';

import { stripAnchorTrailingPunct, anchorSlug } from '../src/core/slug.ts';
import { anchorMatches, buildRefGraph, checkRefs } from '../src/core/refs.ts';
import { checkCodebaseRefs } from '../src/core/codebase.ts';
import { defaultCodebaseRules } from '../src/core/rules.ts';
import { parseOutline } from '../src/core/outline.ts';
import { makeTmpDir, cleanTmpDir, makeCansWorkspace } from './helpers.ts';
import type { CodebaseRules, OutlineNode } from '../src/types.ts';

// ── Scaffolding (the issue #67 engine suite's shape) ────────────────────────

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
  const project = makeTmpDir(`issue68-engine-${name}`);
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

// The issue's five false positives, verbatim: three kelir-shaped headings
// whose own trailing `:` the slug contract preserves into the canonical
// anchor (what `cans slug` prints), and the five embedded pointers at them.
const DB_HEADING = '- SQLite UDS bridge mechanics:\n';
const PROFILE_HEADING = '- Inversion-of-Control configuration router:\n';
const WIRE_HEADING = '- Ingress stream framing on stream kind L4_FORWARD (mux 0x0001):\n';
const KELIR_CORPUS: Array<[string, string]> = [
  ['plugins/db-proxy.md', DB_HEADING],
  ['plugins/profile.md', PROFILE_HEADING],
  ['plugins/wire-ingress.md', WIRE_HEADING],
];
// The written spellings from the issue's table — db-proxy and wire-ingress
// each appear TWICE in the reporter's tree (lib.rs:42,141 and 18,85).
const DB_POINTER = '// see: cans/plugins/db-proxy.md#SQLite-UDS-bridge-mechanics:';
const PROFILE_POINTER = '// see: cans/plugins/profile.md#Inversion-of-Control-configuration-router:';
const WIRE_POINTER =
  '// see: cans/plugins/wire-ingress.md#Ingress-stream-framing-on-stream-kind-L4-FORWARD-(mux-0x0001):';
const KELIR_SOURCES: Record<string, string> = {
  'crates/kelir-plugins/plugin-db-proxy/src/lib.rs': `${DB_POINTER}\n${DB_POINTER}\n`,
  'crates/kelir-plugins/plugin-profile/src/lib.rs': `${PROFILE_POINTER}\n`,
  'crates/kelir-plugins/plugin-wire-ingress/src/lib.rs': `${WIRE_POINTER}\n${WIRE_POINTER}\n`,
};

// ── A. stripAnchorTrailingPunct (slug.ts — the moved single-source pass) ────

describe('issue #68 engine — stripAnchorTrailingPunct (the moved pass)', () => {
  test('a1: the kelir sentence-punct endings strip — the trailing `:` of the canonical anchors', () => {
    // The #68 defect in miniature: the canonical anchor carries the
    // heading's own `:` (slug-preserved); the captured token must not.
    expect(stripAnchorTrailingPunct('SQLite-UDS-bridge-mechanics:')).toBe('SQLite-UDS-bridge-mechanics');
    expect(stripAnchorTrailingPunct('Inversion-of-Control-configuration-router:')).toBe('Inversion-of-Control-configuration-router');
    // The #48 classics stay in the family: commas, glued closers,
    // typographic apostrophes.
    expect(stripAnchorTrailingPunct('Sessions:')).toBe('Sessions');
    expect(stripAnchorTrailingPunct('Sessions,')).toBe('Sessions');
    expect(stripAnchorTrailingPunct('Audit-spine’')).toBe('Audit-spine');
  });

  test('a2: glued runs strip whole — `);` in one pass', () => {
    expect(stripAnchorTrailingPunct('Sessions);')).toBe('Sessions');
    expect(stripAnchorTrailingPunct('Routing)).')).toBe('Routing');
  });

  test('a3: opener-backed closers survive verbatim (the #58 repair over ()[]{})', () => {
    // Structural endings are strip-then-repair fixed points: the trailing
    // run eats the closer, the unclosed opener backs it, it comes back.
    expect(stripAnchorTrailingPunct('Invariants-and-policy-(transaction)')).toBe('Invariants-and-policy-(transaction)');
    expect(stripAnchorTrailingPunct('Native-checkpoint-plane-(kelir-core::checkpoint)')).toBe('Native-checkpoint-plane-(kelir-core::checkpoint)');
  });

  test('a4: the paren+colon ending — the `):` run strips, the structural `)` repairs', () => {
    // The wire-ingress anchor's own shape: strip BOTH trailing chars, then
    // the opener-backed `)` is restored — the colon alone is glue.
    expect(stripAnchorTrailingPunct('Ingress-stream-framing-on-stream-kind-L4-FORWARD-(mux-0x0001):'))
      .toBe('Ingress-stream-framing-on-stream-kind-L4-FORWARD-(mux-0x0001)');
    // …and the heading-side text cleans identically (the symmetry itself).
    expect(stripAnchorTrailingPunct('Ingress stream framing on stream kind L4_FORWARD (mux 0x0001):'))
      .toBe('Ingress stream framing on stream kind L4_FORWARD (mux 0x0001)');
  });

  test('a5: the wrapped-prose double keeps exactly its structural half', () => {
    expect(stripAnchorTrailingPunct('API-(v2))')).toBe('API-(v2)');
  });

  test('a6: schematic index brackets survive (the #58 anchor syntax)', () => {
    expect(stripAnchorTrailingPunct('items[0]')).toBe('items[0]');
    expect(stripAnchorTrailingPunct('matrix[0][1]')).toBe('matrix[0][1]');
  });

  test('a7: pure-punctuation fragments clean to empty (the file-level degradation input)', () => {
    expect(stripAnchorTrailingPunct(').')).toBe('');
    expect(stripAnchorTrailingPunct(':')).toBe('');
  });

  test('a8: idempotence — applying the pass twice equals applying it once', () => {
    for (const token of [
      'SQLite-UDS-bridge-mechanics:',
      'Ingress-stream-framing-on-stream-kind-L4-FORWARD-(mux-0x0001):',
      'API-(v2))',
      'Invariants-and-policy-(transaction)',
      'Sessions);',
      'items[0]',
    ]) {
      const once = stripAnchorTrailingPunct(token);
      expect(stripAnchorTrailingPunct(once)).toBe(once);
    }
  });
});

// ── B. anchorMatches (clause 3: cleaned-vs-cleaned at the shared seam) ──────

describe('issue #68 engine — anchorMatches (the symmetric comparison)', () => {
  test('b1: the three kelir headings match their canonical colon anchors — what `cans slug` prints', () => {
    // The canonical spelling carries the heading's own trailing `:`
    // (anchorSlug preserves it — `:` is not a separator).
    expect(anchorSlug('SQLite UDS bridge mechanics:')).toBe('SQLite-UDS-bridge-mechanics:');
    expect(anchorSlug('Inversion-of-Control configuration router:')).toBe('Inversion-of-Control-configuration-router:');
    expect(anchorSlug('Ingress stream framing on stream kind L4_FORWARD (mux 0x0001):'))
      .toBe('Ingress-stream-framing-on-stream-kind-L4-FORWARD-(mux-0x0001):');
    expect(anchorMatches('SQLite UDS bridge mechanics:', 'SQLite-UDS-bridge-mechanics:')).toBe(true);
    expect(anchorMatches('Inversion-of-Control configuration router:', 'Inversion-of-Control-configuration-router:')).toBe(true);
    expect(anchorMatches('Ingress stream framing on stream kind L4_FORWARD (mux 0x0001):', 'Ingress-stream-framing-on-stream-kind-L4-FORWARD-(mux-0x0001):')).toBe(true);
  });

  test('b2: the colon-stripped spellings ALSO match — the #68 defect, now tolerant', () => {
    // Pre-#68 these were the five false positives: the extractors clean the
    // captured anchor (trailing `:` stripped) while the heading keeps its
    // own — clause 3 compares cleaned-vs-cleaned, so both directions
    // resolve.
    expect(anchorMatches('SQLite UDS bridge mechanics:', 'SQLite-UDS-bridge-mechanics')).toBe(true);
    expect(anchorMatches('Inversion-of-Control configuration router:', 'Inversion-of-Control-configuration-router')).toBe(true);
    expect(anchorMatches('Ingress stream framing on stream kind L4_FORWARD (mux 0x0001):', 'Ingress-stream-framing-on-stream-kind-L4-FORWARD-(mux-0x0001)')).toBe(true);
  });

  test('b3: the wire-ingress heading vs the FULL written codebase spelling (colon included, verbatim from the issue table)', () => {
    // The exact fragment the reporter's lib.rs carries — capture, colon and
    // all — resolves against its heading without any pre-cleaning by the
    // caller: the seam cleans both sides itself.
    expect(anchorMatches(
      'Ingress stream framing on stream kind L4_FORWARD (mux 0x0001):',
      'Ingress-stream-framing-on-stream-kind-L4-FORWARD-(mux-0x0001):',
    )).toBe(true);
  });

  test('b4: the corpus-shaped anchor — exactly what outline.ts parse mints — matches the colon heading', () => {
    // The corpus-side twin of the defect: REF_RE captures the canonical
    // colon spelling, stripRefTrailingPunct (frozen #48) strips the `:` at
    // parse, the heading keeps its own — the parsed anchor must resolve.
    const files = new Map<string, OutlineNode[]>([
      ['01-spec.md', parseOutline('- Proxy layer: see: plugins/db-proxy.md#SQLite-UDS-bridge-mechanics:\n', '01-spec.md')],
      ['plugins/db-proxy.md', parseOutline(DB_HEADING, 'plugins/db-proxy.md')],
    ]);
    const graph = buildRefGraph(files, '/workspace-root-ignored-by-parse');
    const ref = graph.forward.get('01-spec.md')![0]!;
    // The frozen outline.ts behavior, pinned: the anchor token arrives
    // colon-stripped while the raw span keeps the written colon spelling.
    expect(ref.anchor).toBe('SQLite-UDS-bridge-mechanics');
    expect(ref.raw).toBe('see: plugins/db-proxy.md#SQLite-UDS-bridge-mechanics:');
    // …and the symmetric matcher resolves it against the colon heading.
    expect(anchorMatches('SQLite UDS bridge mechanics:', ref.anchor!)).toBe(true);
  });

  test('b5: strictly widening — clauses 1-2 still carry every pre-#68 resolution', () => {
    // The exact and normalized clauses are untouched: punctuation-free
    // spellings, case folds and separator variants resolve exactly as
    // they always did, without ever reaching clause 3.
    expect(anchorMatches('Sessions', 'Sessions')).toBe(true);
    expect(anchorMatches('Data protection', 'Data-protection')).toBe(true);
    expect(anchorMatches('Layer 1 — C authorizer', 'Layer-1-C-authorizer')).toBe(true);
    expect(anchorMatches('What\'s Next?', 'What\'s-Next?')).toBe(true);
    expect(anchorMatches('FsInodeAttr carries full mode, uid, gid, size, content', 'FsInodeAttr-carries-full-mode,-uid,-gid,-size,-content')).toBe(true);
  });

  test('b6: genuine misspellings still fail — the over-tolerance regression guard', () => {
    // The fix must widen matching, not dissolve it: a near-miss of a colon
    // heading fails on BOTH sides of the cleaning (the misspelled letters
    // are mid-token, where the pass never touches).
    expect(anchorMatches('Quotas:', 'Qutas')).toBe(false);
    expect(anchorMatches('Invariants and policy (transaction)', 'Invariants-and-policy-(transakshun)')).toBe(false);
    expect(anchorMatches('SQLite UDS bridge mechanics:', 'SQLite-UDS-bridge-mechanix')).toBe(false);
  });

  test('b7: a DIFFERENT heading still fails — the colon tolerance is not a wildcard', () => {
    expect(anchorMatches('Sessions:', 'Timeouts')).toBe(false);
    expect(anchorMatches('Timeouts', 'Sessions:')).toBe(false);
  });
});

// ── C. End to end: checkCodebaseRefs over the kelir-shaped mini workspace ──

describe('issue #68 engine — checkCodebaseRefs (the kelir five, end to end)', () => {
  test('c1: the issue\'s five embedded pointers resolve — 0 findings, 5 pointers', async () => {
    // The three kelir-shaped headings (bullet nodes, verbatim from the
    // issue's table) + the five embedded pointers at them (verbatim
    // spellings, two occurrences each for db-proxy and wire-ingress) —
    // pre-#68 all five were `anchor not found` false positives.
    const { root } = makeProject('kelir-five', Object.fromEntries(KELIR_CORPUS), KELIR_SOURCES);
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(KELIR_CORPUS));
    expect(scan.findings).toEqual([]); // the 5 false positives, gone
    expect(scan.scanned).toBe(3);
    expect(scan.pointers).toBe(5);
  });

  test('c2: a misspelled colon anchor still reports — and the suggestion proposes the canonical colon spelling', async () => {
    // Over-tolerance guard + suggestion coherence in one: `mechanix` is a
    // genuine misspelling (clause 3 cannot heal mid-token letters), and
    // anchorSuggestion proposes the heading's canonical anchorSlug — which
    // KEEPS the trailing colon (`cans slug` prints it) — so the advice is
    // an anchor that resolves.
    const sources = {
      ...KELIR_SOURCES,
      'crates/kelir-plugins/plugin-db-proxy/src/lib.rs': [
        DB_POINTER,
        DB_POINTER,
        '// see: cans/plugins/db-proxy.md#SQLite-UDS-bridge-mechanix:',
        '',
      ].join('\n'),
    };
    const { root } = makeProject('kelir-misspell', Object.fromEntries(KELIR_CORPUS), sources);
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(KELIR_CORPUS));
    expect(scan.pointers).toBe(6);
    expect(scan.findings.length).toBe(1); // only the misspelling
    expect(scan.findings[0]!.reason).toBe('AnchorNotFound');
    expect(scan.findings[0]!.file).toBe('crates/kelir-plugins/plugin-db-proxy/src/lib.rs');
    expect(scan.findings[0]!.targetSlug).toBe('SQLite-UDS-bridge-mechanix');
    // The coherent proposal: the canonical COLON spelling, exactly what
    // `cans slug "SQLite UDS bridge mechanics:"` prints.
    expect(scan.findings[0]!.suggestion).toBe(
      'did you mean cans/plugins/db-proxy.md#SQLite-UDS-bridge-mechanics:? — fix the ref anchor',
    );
  });
});

// ── D. The corpus-side twin: the refs engine over the same latent class ─────

describe('issue #68 engine — the corpus refs engine (the latent colon class)', () => {
  test('d1: a spec ref written with the canonical colon spelling resolves through checkRefs', () => {
    // The same defect class, corpus side: the spec author writes the
    // anchor exactly as `cans slug` prints it (`…#SQLite-UDS-bridge-
    // mechanics:`), outline parse colon-strips the anchor token (frozen
    // #48 behavior — pinned in b4), the heading keeps its own colon.
    // Pre-#68 checkRefs minted `refs.broken.anchor` here; post-fix the
    // shared seam resolves it. The workspace is real (buildRefGraph walks
    // the parsed corpus, checkRefs the way check.ts drives it).
    const { root } = makeProject('corpus-colon', {
      '01-spec.md': '- Proxy layer: see: plugins/db-proxy.md#SQLite-UDS-bridge-mechanics:\n',
      'plugins/db-proxy.md': DB_HEADING,
    });
    const files = corpusOf([
      ['01-spec.md', '- Proxy layer: see: plugins/db-proxy.md#SQLite-UDS-bridge-mechanics:\n'],
      ['plugins/db-proxy.md', DB_HEADING],
    ]);
    const issues = checkRefs(files, buildRefGraph(files, root), root);
    expect(issues.filter(i => i.category === 'refs')).toEqual([]);
  });
});
