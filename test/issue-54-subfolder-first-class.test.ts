/**
 * Issue #54 — subfolder spec files are not first-class.
 *
 * A `.md` file inside a subdirectory of `cans/` could never participate in
 * the spec graph as a first-class file (0.6.0):
 *   1. Not discovered: discovery was root `*.md` + depth-1 `<dir>/index.md`
 *      only — `cans/plugins/pty.md` was classified as an §16 overflow target
 *      (leaf content), its nodes excluded from summary/counts.
 *   2. Cannot be pointed to: a spec file that itself has an incoming ref
 *      deep-hops when it refs the subfolder leaf (§5 max_hops: 1).
 *   3. Cannot point back: any `see:` inside the subfolder file was a
 *      refs.chaining error (§16) — catch-22 with (2).
 *   4. Deeper nesting invisible: `cans/plugins/topic/index.md` (depth-2
 *      folder index) was neither spec file nor overflow target — silently
 *      ignored, files count unchanged.
 *   5. The only working pattern was an UNREFERENCED depth-1
 *      `cans/plugins/index.md` catalog holding the `see:` refs; referencing
 *      that catalog immediately produced deep-hop errors.
 *
 * Fix (binding design):
 *   - recursive folder-index discovery (any-depth `<dir>/index.md`);
 *   - transitive promotion: a subfolder .md pointed at by a loaded SPEC file
 *     is promoted to a first-class spec file (fixpoint over spec-file refs;
 *     aux _tasks/_adr refs and the `done` extraReferrer never promote);
 *   - the §16 no-chaining target set shrinks to the UNREFERENCED subfolder
 *     .md files;
 *   - deep-hop semantics (§5) UNCHANGED by design: under max_hops: 1 a
 *     referenced file pointing at a leaf still deep-hops. The catch-22 is
 *     broken because a PROMOTED file may point back (mutual back-reference
 *     mesh = the documented pattern, never a deep hop). Case 1 as literally
 *     written (leaf, no back-ref, max_hops: 1) and case 5 (referencing a
 *     catalog that refs out) remain errors BY DESIGN — the sanctioned fixes
 *     are the back-pointer mesh or configuring references.max_hops.
 *
 * Documented delta from the issue's 0.6.0 figures: in case 4 the catalog's
 * own `see: plugins/pty.md` now PROMOTES pty.md, so files is 4 (0.6.0
 * reported 3 because pty.md was invisible overflow-target content). The
 * workaround still passes (ok: true) — and the leaf it pointerizes is now
 * counted and checked. That is the fix working, not a regression.
 *
 * Test map (CLI-level, makeCansWorkspace + CANS_ROOT='' + check --json):
 *   baseline ..... the issue's exact baseline: ok, files 2, refs 2/0/0
 *   case3 ........ depth-2 plugins/topic/index.md discovered (files 3) +
 *                  `cans status` lists it (discovery-only, no promotion)
 *   case3b ....... default rules: the depth-2 index gets orphan-checked
 *                  (first-class graph citizen)
 *   mesh ......... cases 1+2 combined: 01-core → pty.md AND pty.md →
 *                  01-core.md (back-ref) → ok, pty counted, no chaining,
 *                  no deep hop; an ANCHORED ref INTO the promoted file
 *                  resolves
 *   leaf ......... case 1 literal: pty does NOT point back, max_hops: 1 →
 *                  deep_hop error REMAINS (documented §5 behavior) but pty
 *                  is counted (files 3) and NOT a chaining error
 *   leaf-hops2 ... same workspace, references.max_hops: 2 → ok
 *   catalog ...... case 4: unreferenced plugins/index.md catalog → ok
 *                  (workaround still works), files 4 (promotion delta)
 *   catalog-ref .. case 5: referencing the catalog → deep_hop error REMAINS
 *                  (documented §5 behavior)
 *   transitive ... spec → guides/render.md → guides/nested/buffers.md:
 *                  both promoted transitively, mesh, ok
 *   structure .... an over-long node inside the promoted pty.md flags
 *                  structure.node_length.max (full checks apply)
 *   file-filter .. `--file plugins/pty.md` scopes the per-file checks to
 *                  the promoted file (it is --file-filterable)
 *   fix .......... `--fix` ref-by rewrite writes INTO the promoted file
 *                  (specSources wired)
 *   overflow ..... unreferenced 04-api/request-schema.md with a see: inside
 *                  → refs.chaining §16 error (overflow class preserved)
 *   aux .......... a _tasks/ ref to pty.md does NOT promote it (still an
 *                  overflow target; §16 still applies)
 */
import { describe, test, expect, afterEach } from './testing.ts';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';

import { spawnCli, REPO } from './runtime.ts';
import { makeCansWorkspace } from './helpers.ts';

// ── The issue's repro workspace shapes ──

/** "cans/_rules.yaml sets only structure + references.max_hops: 1".
 *  §18 delete-key semantics: listing `structure:` makes this a curated file,
 *  so every unlisted section (style/content/redundancy/overflow and the
 *  unlisted references switches orphan_check/back_pointers/duplicate_home)
 *  turns OFF — exactly the issue's minimal validation surface. */
const RULES_MAX1 = [
  'structure:',
  '  node_length: { min: 3, max: 120 }',
  '  siblings: { min: 1, max: 12 }',
  '  depth: { min: 1, max: 5 }',
  'references:',
  '  max_hops: 1',
  '',
].join('\n');

/** Same surface, but the deep-hop budget allows one intermediate hop — the
 *  issue's documented escape hatch for the leaf-literal shape (case 1). */
const RULES_MAX2 = RULES_MAX1.replace('max_hops: 1', 'max_hops: 2');

/** Same surface with back-pointers ON — the `--fix` ref-by phase needs it. */
const RULES_FIX = [
  'structure:',
  '  node_length: { min: 3, max: 120 }',
  '  siblings: { min: 1, max: 12 }',
  '  depth: { min: 1, max: 5 }',
  'references:',
  '  max_hops: 1',
  '  back_pointers: true',
  '',
].join('\n');

const OVERVIEW_BASE = '- Core: see 01-core.md\n';

const CORE_BASE = [
  '- Core',
  '  - Overview link: see 00-overview.md',
  '  - Filler item alpha',
  '  - Filler item beta',
  '',
].join('\n');

/** Case 1 adds the plugin pointer to 01-core.md. */
const CORE_WITH_PTY = [
  '- Core',
  '  - Overview link: see 00-overview.md',
  '  - plugin-pty: see plugins/pty.md',
  '  - Filler item alpha',
  '  - Filler item beta',
  '',
].join('\n');

/** pty.md as a leaf: no refs (the issue's case 1 literal). */
const PTY_LEAF = [
  '- Pty plugin notes',
  '  - Raw mode handling',
  '  - Signal forwarding',
  '',
].join('\n');

/** pty.md pointing back at 01-core.md (the issue's case 2 back-ref) — with
 *  the anchored form, so anchor resolution INTO a normal spec file from a
 *  promoted file is exercised too. */
const PTY_BACKREF = [
  '- Pty plugin notes',
  '  - Core link: see 01-core.md#Core',
  '  - Raw mode handling',
  '  - Signal forwarding',
  '',
].join('\n');

/** The issue's case 3 shape: a depth-2 folder index with 5 nodes. */
const TOPIC_INDEX = [
  '- Topic index',
  '  - Alpha ledger',
  '  - Beta marlin',
  '  - Gamma harbor',
  '  - Delta cobalt',
  '',
].join('\n');

/** The issue's case 4 catalog: unreferenced depth-1 index holding the ref. */
const PLUGINS_CATALOG = [
  '- Plugins catalog',
  '  - plugin-pty: see plugins/pty.md',
  '',
].join('\n');

/** Transitive promotion chain: spec → guides/render.md (depth-1 .md, not an
 *  index) → guides/nested/buffers.md (depth-2 .md). Mutual back-refs keep
 *  the whole cluster one mesh (no deep hops, the documented pattern). */
const RENDER_GUIDE = [
  '- Render pipeline',
  '  - Core link: see 01-core.md',
  '  - Buffer rules: see guides/nested/buffers.md',
  '',
].join('\n');

const BUFFERS = [
  '- Buffer store',
  '  - Render link: see guides/render.md',
  '  - Double buffer swap',
  '  - Padded buffer tail',
  '',
].join('\n');

// ── CLI scaffolding (mirrors test/issues/issue-22.test.ts) ──

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-54');
const createdDirs: string[] = [];

function makeWs(name: string, files: Record<string, string>): { tmp: string; root: string } {
  const tmp = join(SCRATCH, `${name}-${createdDirs.length + 1}`);
  const root = makeCansWorkspace(tmp, files);
  createdDirs.push(tmp);
  return { tmp, root };
}

function runCli(args: string[], cwd: string) {
  return spawnCli(args, cwd, { ...process.env, CANS_ROOT: '' });
}

function parseJsonOut(out: string): any {
  let parsed: unknown = null;
  let parseError: unknown = null;
  try {
    parsed = JSON.parse(out);
  } catch (e) {
    parseError = e;
  }
  expect(parseError).toBeNull();
  // issue #41: check --json emits sections.{category}[] entries
  // ({file,line,level,rule,detail}); reconstitute a flat issues view so the
  // assertions read like the engine's own Issue[].
  const j = parsed as Record<string, unknown> | null;
  if (j !== null && typeof j === 'object' && (j as any).sections !== undefined && (j as any).issues === undefined) {
    (j as any).issues = Object.entries((j as any).sections as Record<string, any[]>).flatMap(([category, arr]) =>
      arr.map((i) => ({ ...i, category, message: i.detail })),
    );
  }
  return parsed;
}

/** The issue's baseline workspace (cases add files/lines on top). */
function baseWs(name: string, extra: Record<string, string> = {}, overview = OVERVIEW_BASE, core = CORE_BASE) {
  return makeWs(name, {
    '_rules.yaml': RULES_MAX1,
    '00-overview.md': overview,
    '01-core.md': core,
    ...extra,
  });
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Baseline ──

describe('issue #54: the repro baseline stays green', () => {
  test('baseline: ok, files 2, refs 2 total / 0 broken / 0 deep hops', () => {
    const ws = baseWs('baseline');
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(0);
    expect(j.ok).toBe(true);
    expect(j.summary.files).toBe(2);
    expect(j.summary.nodes).toBe(5); // overview 1 + core 4
    expect(j.refs).toEqual({ total: 2, broken: 0, deepHops: 0 });
    expect(j.counts.errors).toBe(0);
  });
});

// ── Case 3: deeper nesting is no longer invisible ──

describe('issue #54 case 3: depth-2 folder indexes are discovered', () => {
  test('plugins/topic/index.md is counted as a spec file (files 3, its 5 nodes counted)', () => {
    const ws = baseWs('case3', { 'plugins/topic/index.md': TOPIC_INDEX });
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(0);
    expect(j.ok).toBe(true);
    // 0.6.0 reported files: 2 — the depth-2 index was silently ignored.
    expect(j.summary.files).toBe(3);
    expect(j.summary.nodes).toBe(10); // 5 baseline + 5 topic nodes
    expect(j.refs).toEqual({ total: 2, broken: 0, deepHops: 0 });
  });

  test('`cans status` lists the depth-2 index (discovery-level, no promotion involved)', () => {
    // status/export list DISCOVERED files (root .md + any-depth index.md)
    // without promotion — promotion is a check-flow feature only.
    const ws = baseWs('case3-status', { 'plugins/topic/index.md': TOPIC_INDEX });
    const r = runCli(['status', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(0);
    expect(j.ok).toBe(true);
    expect(j.specFiles).toBe(3);
  });

  test('default rules: the depth-2 index gets orphan-checked (first-class graph citizen)', () => {
    // No _rules.yaml → all defaults (orphan_check on). The depth-2 index has
    // no refs in or out → refs.orphan warning — proof it participates in the
    // ref graph exactly like a root-level spec file. 0.6.0: invisible.
    const ws = makeWs('case3-orphan', {
      '00-overview.md': OVERVIEW_BASE,
      '01-core.md': CORE_BASE,
      'plugins/topic/index.md': TOPIC_INDEX,
    });
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true); // warnings only
    expect(r.exit).toBe(1);
    const orphan = j.issues.find((i: any) => i.rule === 'refs.orphan');
    expect(orphan).toBeDefined();
    expect(orphan.file).toBe('plugins/topic/index.md');
  });
});

// ── Cases 1+2: the referenced subfolder .md becomes first-class ──

describe('issue #54 cases 1+2: the mutual back-reference mesh is the sanctioned pattern', () => {
  test('01-core → pty.md AND pty.md → 01-core.md: ok, pty counted, no chaining, no deep hop', () => {
    // The catch-22 killer: under 0.6.0 this shape produced a refs.chaining
    // error on pty.md (§16) AND a deep_hop error on 01-core.md. With
    // promotion, pty.md is a first-class spec file whose back-reference
    // forms one mesh with 01-core — never a deep hop (documented pattern).
    // 00-overview also holds an ANCHORED ref into the promoted file, so
    // anchor resolution into promoted files is exercised end-to-end.
    const ws = baseWs(
      'mesh',
      { 'plugins/pty.md': PTY_BACKREF },
      '- Core: see 01-core.md\n- Pty: see plugins/pty.md#Raw-mode-handling\n',
      CORE_WITH_PTY,
    );
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(0);
    expect(j.ok).toBe(true);
    expect(j.summary.files).toBe(3); // pty.md PROMOTED (0.6.0: 2)
    expect(j.summary.nodes).toBe(11); // overview 2 + core 5 + pty 4
    expect(j.refs).toEqual({ total: 5, broken: 0, deepHops: 0 });
    expect(j.counts.errors).toBe(0);
    expect(j.counts.warnings).toBe(0);
    // §16 chaining must NOT fire: pty.md is no longer an overflow target.
    expect(j.issues.some((i: any) => i.rule === 'refs.chaining')).toBe(false);
  });
});

// ── Case 1 literal: §5 deep-hop semantics unchanged ──

describe('issue #54 case 1 (leaf-literal): deep_hop remains BY DESIGN under max_hops: 1', () => {
  test('pty does NOT point back, max_hops: 1 → deep_hop error remains, but pty is counted and not chaining-flagged', () => {
    // §5 documented rule: "NEVER create a deep hop: if A references B, B
    // must not contain see: to C." Under max_hops: 1 a referenced file
    // pointing at a leaf still deep-hops — that is unchanged by issue #54.
    // What CHANGED: the leaf itself is now a first-class file (counted,
    // checked, graph-visible) and the sanctioned fix (the back-pointer
    // mesh) is now possible.
    const ws = baseWs('leaf', { 'plugins/pty.md': PTY_LEAF }, OVERVIEW_BASE, CORE_WITH_PTY);
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(2);
    expect(j.ok).toBe(false);
    // pty.md is promoted (referenced by spec file 01-core.md) → counted.
    expect(j.summary.files).toBe(3); // 0.6.0: 2 (pty was an overflow target)
    expect(j.summary.nodes).toBe(9); // overview 1 + core 5 + pty 3
    expect(j.refs.total).toBe(3);
    expect(j.refs.deepHops).toBe(1);
    const hop = j.issues.find((i: any) => i.rule === 'refs.deep_hop');
    expect(hop).toBeDefined();
    expect(hop.message).toBe('DEEP HOP: 00-overview.md → 01-core.md → plugins/pty.md');
    // Promoted ≠ overflow target: no §16 chaining error on pty.md.
    expect(j.issues.some((i: any) => i.rule === 'refs.chaining')).toBe(false);
    expect(j.issues.some((i: any) => i.rule === 'refs.broken.file')).toBe(false);
  });

  test('same workspace with references.max_hops: 2 → ok (the documented config escape hatch)', () => {
    const ws = makeWs('leaf-hops2', {
      '_rules.yaml': RULES_MAX2,
      '00-overview.md': OVERVIEW_BASE,
      '01-core.md': CORE_WITH_PTY,
      'plugins/pty.md': PTY_LEAF,
    });
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(0);
    expect(j.ok).toBe(true);
    expect(j.summary.files).toBe(3);
    expect(j.refs).toEqual({ total: 3, broken: 0, deepHops: 0 });
  });
});

// ── Case 4: the unreferenced catalog workaround ──

describe('issue #54 case 4: the unreferenced plugins/index.md catalog still works', () => {
  test('catalog (unreferenced) → ok, no chaining, no deep hop; files 4 — the catalog ref PROMOTES pty.md', () => {
    // The 0.6.0 workaround (unreferenced catalog holding the see: refs)
    // keeps passing. Documented delta from the issue's "files: 3" figure:
    // the catalog is a spec file and its `see: plugins/pty.md` pointerizes
    // pty.md, so promotion loads it as spec file #4 (counted, checked) —
    // under 0.6.0 it was invisible overflow-target content. The catalog
    // stays an unreferenced root, so no deep hop fires (depthOf 0).
    const ws = baseWs('catalog', {
      'plugins/index.md': PLUGINS_CATALOG,
      'plugins/pty.md': PTY_LEAF,
    });
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(0);
    expect(j.ok).toBe(true);
    expect(j.counts.errors).toBe(0);
    expect(j.issues.some((i: any) => i.rule === 'refs.chaining')).toBe(false);
    expect(j.issues.some((i: any) => i.rule === 'refs.deep_hop')).toBe(false);
    expect(j.summary.files).toBe(4); // overview, core, catalog, PROMOTED pty
    expect(j.summary.nodes).toBe(10); // 1 + 4 + 2 + 3
    expect(j.refs).toEqual({ total: 3, broken: 0, deepHops: 0 });
  });
});

// ── Case 5: referencing the catalog ──

describe('issue #54 case 5: referencing the catalog deep-hops BY DESIGN', () => {
  test('00-overview → catalog (which refs out to pty) → deep_hop error remains', () => {
    // §5 unchanged: a referenced catalog that refs out violates "if A
    // references B, B must not contain see: to C" under max_hops: 1.
    // Catalogs stay unreferenced roots (case 4) or max_hops rises.
    const ws = baseWs(
      'catalog-ref',
      {
        'plugins/index.md': PLUGINS_CATALOG,
        'plugins/pty.md': PTY_LEAF,
      },
      '- Core: see 01-core.md\n- Plugins: see plugins/index.md\n',
    );
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(2);
    expect(j.ok).toBe(false);
    expect(j.summary.files).toBe(4);
    expect(j.refs.deepHops).toBe(1);
    const hop = j.issues.find((i: any) => i.rule === 'refs.deep_hop');
    expect(hop).toBeDefined();
    expect(hop.message).toBe('DEEP HOP: 00-overview.md → plugins/index.md → plugins/pty.md');
    expect(j.issues.some((i: any) => i.rule === 'refs.chaining')).toBe(false);
  });
});

// ── Transitive promotion ──

describe('issue #54: promotion is transitive (spec → subfolder .md → deeper .md)', () => {
  test('guides/render.md and guides/nested/buffers.md are both promoted, counted and meshed', () => {
    // buffers.md is only reachable through a PROMOTED file's ref — the
    // fixpoint must keep iterating until a full pass adds nothing.
    const ws = baseWs(
      'transitive',
      {
        'guides/render.md': RENDER_GUIDE,
        'guides/nested/buffers.md': BUFFERS,
      },
      OVERVIEW_BASE,
      [
        '- Core',
        '  - Overview link: see 00-overview.md',
        '  - Render guide: see guides/render.md',
        '  - Filler item alpha',
        '  - Filler item beta',
        '',
      ].join('\n'),
    );
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(0);
    expect(j.ok).toBe(true);
    // 2 discovered + 2 promoted (neither is an index.md).
    expect(j.summary.files).toBe(4);
    expect(j.summary.nodes).toBe(13); // 1 + 5 + 3 + 4
    expect(j.refs).toEqual({ total: 6, broken: 0, deepHops: 0 });
    expect(j.issues.some((i: any) => i.rule === 'refs.chaining')).toBe(false);
  });
});

// ── First-class treatment of promoted files ──

describe('issue #54: promoted files get the full spec-file treatment', () => {
  test('an over-long node inside the promoted pty.md flags structure.node_length.max', () => {
    const ws = baseWs(
      'structure',
      {
        'plugins/pty.md': [
          '- Pty plugin notes',
          '  - Core link: see 01-core.md#Core',
          `  - ${'x'.repeat(250)}`,
          '',
        ].join('\n'),
      },
      OVERVIEW_BASE,
      CORE_WITH_PTY,
    );
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(2);
    // Mesh shape (pty points back) → the ONLY error is the structure one.
    expect(j.counts.errors).toBe(1);
    const long = j.issues.find((i: any) => i.rule === 'structure.node_length.max');
    expect(long).toBeDefined();
    expect(long.file).toBe('plugins/pty.md');
    expect(long.level).toBe('error');
  });

  test('--file plugins/pty.md scopes the per-file checks to the promoted file', () => {
    // Promoted files are --file-filterable: the filter matches the promoted
    // key (not a checkFail "no spec file matches"), and 01-core's own
    // over-long node is out of the filtered scope (refs stay global — the
    // mesh keeps them clean either way).
    const ws = baseWs(
      'file-filter',
      {
        'plugins/pty.md': [
          '- Pty plugin notes',
          '  - Core link: see 01-core.md#Core',
          `  - ${'x'.repeat(250)}`,
          '',
        ].join('\n'),
      },
      OVERVIEW_BASE,
      [
        '- Core',
        '  - Overview link: see 00-overview.md',
        '  - plugin-pty: see plugins/pty.md',
        `  - ${'y'.repeat(250)}`,
        '',
      ].join('\n'),
    );
    // Unfiltered: both over-long nodes flag.
    const all = parseJsonOut(runCli(['check', '--json'], ws.tmp).out);
    expect(all.counts.errors).toBe(2);
    // Filtered to the promoted file: only pty's own node flags.
    const r = runCli(['check', '--json', 'plugins/pty.md'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(false);
    expect(j.counts.errors).toBe(1);
    const long = j.issues.find((i: any) => i.rule === 'structure.node_length.max');
    expect(long.file).toBe('plugins/pty.md');
    expect(j.issues.some((i: any) => i.file === '01-core.md')).toBe(false);
  });

  test('--fix ref-by rewrite writes INTO the promoted file (specSources wired)', () => {
    const ws = makeWs('fix', {
      '_rules.yaml': RULES_FIX,
      '00-overview.md': OVERVIEW_BASE,
      '01-core.md': CORE_WITH_PTY,
      'plugins/pty.md': PTY_BACKREF,
    });
    const ptyPath = join(ws.root, 'plugins', 'pty.md');
    const before = readFileSync(ptyPath, 'utf8');

    const r = runCli(['check', '--fix', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(0);
    expect(j.ok).toBe(true);
    // The promoted file is a --fix target: its earned ref-by marks were
    // rewritten on disk (01-core's file-level ref → standalone mark;
    // 00-overview has none here, so 01-core is the sole referrer... but the
    // mesh gives 01-core a mark too — the assertion is about pty.md).
    expect(j.backPointersUpdated).toBeGreaterThanOrEqual(1);
    expect(j.backPointersUpdatedFiles).toContain('plugins/pty.md');
    const after = readFileSync(ptyPath, 'utf8');
    expect(after).not.toBe(before);
    expect(after).toContain('ref-by: 01-core.md');
  });
});

// ── §16 overflow-target class preserved ──

describe('issue #54: unreferenced subfolder .md files stay §16 overflow targets', () => {
  test('unreferenced 04-api/request-schema.md with a see: inside → refs.chaining error, files unchanged', () => {
    const ws = baseWs('overflow', {
      '04-api/request-schema.md': [
        '- Request schema',
        '  - Field listing: see 01-core.md',
        '',
      ].join('\n'),
    });
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(2);
    expect(j.ok).toBe(false);
    // Not promoted (nothing refs it) → still leaf content → §16 applies.
    expect(j.summary.files).toBe(2);
    const chaining = j.issues.find((i: any) => i.rule === 'refs.chaining');
    expect(chaining).toBeDefined();
    expect(chaining.file).toBe('04-api/request-schema.md');
    expect(chaining.level).toBe('error');
  });

  test('a _tasks/ ref to pty.md does NOT promote it — §16 still applies to the file', () => {
    // Aux files (_tasks/, _adr/) are parsed for ref extraction only; their
    // refs are transient pointers and never change spec membership. pty.md
    // stays unreferenced-by-spec → overflow target → its own see: flags.
    const ws = baseWs(
      'aux',
      { 'plugins/pty.md': PTY_BACKREF },
      OVERVIEW_BASE,
      CORE_BASE, // NOTE: no spec file refs pty.md
    );
    mkdirSync(join(ws.root, '_tasks'), { recursive: true });
    writeFileSync(
      join(ws.root, '_tasks', 'wire-pty.md'),
      '# wire-pty\n\n- [ ] Wire the pty plugin: see plugins/pty.md\n',
      'utf8',
    );
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(2);
    expect(j.ok).toBe(false);
    expect(j.summary.files).toBe(2); // pty.md NOT promoted by the task ref
    const chaining = j.issues.find((i: any) => i.rule === 'refs.chaining');
    expect(chaining).toBeDefined();
    expect(chaining.file).toBe('plugins/pty.md');
    // The task's own ref to pty.md resolves on disk — no broken ref.
    expect(j.issues.some((i: any) => i.rule === 'refs.broken.file')).toBe(false);
  });
});
