/**
 * Issue #68 — the CONTRACT suite: `cans check --codebase` 0.16.0's cleaning
 * pass is ONE-SIDED (5 false "anchor not found" positives on the kelir repo
 * @ 6bc53d3 — the follow-up to #67's 135), pinned end-to-end against the
 * extended `test/fixtures/codebase-workspace/` fixture (its README.md is the
 * line-authoritative oracle — every pointer, its line, its verdict).
 *
 * THE BUG: the slug contract (`_rules.yaml#slug.algorithm`) preserves every
 * non-separator character VERBATIM, so a heading's own trailing sentence
 * punctuation survives into its canonical anchor — `cans slug "SQLite UDS
 * bridge mechanics:"` → `SQLite-UDS-bridge-mechanics:` — and that colon
 * spelling is what the kelir code writes. The ANCHOR side of matching is
 * cleaned at extraction (stripCodebaseAnchorPunct: a trailing run of
 * `)]},.;:!?'"’”…` strips, opener-backed closers repair — so
 * `...(mux-0x0001):` cleans to `...(mux-0x0001)` and `...mechanics:` to
 * `...mechanics`), but the HEADING side was never cleaned at matching
 * (anchorMatches in src/core/refs.ts compared normalized text vs normalized
 * anchor — the heading's own trailing `:` survived normalization). Cleaned
 * vs uncleaned never matched: 5 false AnchorNotFound findings while plain
 * `cans check --json` (no codebase flag) exited 0.
 *
 * THE FROZEN FIX SPEC this suite is written against (the engine half lands
 * on fix/issue-68-engine):
 *
 *   1. src/core/slug.ts exports NEW `stripAnchorTrailingPunct(text)` —
 *      the #67 cleaning pass moved there as the single shared
 *      implementation (identical semantics to codebase.ts's
 *      stripCodebaseAnchorPunct).
 *   2. src/core/codebase.ts's stripCodebaseAnchorPunct becomes a thin
 *      delegate to it (name/signature/module unchanged — the frozen #67
 *      cross-agent seam; the e-block pins that extraction does NOT move).
 *   3. src/core/refs.ts `anchorMatches(nodeText, anchor)` gains a THIRD
 *      clause after the untouched exact and normalized clauses:
 *      `normalizeForAnchor(stripAnchorTrailingPunct(nodeText)) ===
 *       normalizeForAnchor(stripAnchorTrailingPunct(anchor))` —
 *      cleaned-vs-cleaned. One shared matcher seam, so the widening covers
 *      BOTH the codebase engine AND the corpus refs engine.
 *   4. Strictly widening: everything that resolved still resolves; the 5
 *      kelir pointers resolve; misspellings still fail.
 *
 * THE FIXTURE WIRING (the kelir plugin tier — README "The corpus"): the
 * three `cans/plugins/*.md` specs are NOT corpus files (discovery takes
 * root-level `.md` and `index.md` only); they join the checked set the way
 * kelir's do, through the issue #65 plugin tier — `references.aliasing.
 * include: ["plugins/*.md"]` with aliasing enabled in `cans/_rules.yaml`.
 * The tier makes them RESOLVABLE corpus keys for the codebase scanner
 * (AnchorNotFound territory, never FileNotFound — the issue's own
 * evidence), refs-only checked, their hub refs joining the graph.
 *
 * WHAT EACH BLOCK PINS (all blackbox via the real CLI, the issue-66/67
 * integration harness pattern; the fixture is driven from a fresh tmp copy):
 *
 *   a ....... the check scan over the extended fixture: config-on
 *             13 scanned / 32 pointers / EXACTLY the five-record oracle —
 *             the 2 pre-existing TRUE broken records plus the 3 DELIBERATE
 *             issue-#69 artifact ones (the fixture grew again for #69; see
 *             test/issue-69-contract.test.ts) — and ZERO findings from the
 *             three new src/plugins/*.rs sources, the heart of the issue
 *             (a2 repeats it under the pure-default include list with the
 *             plugin tier kept on: 11 files / 30 pointers / the same five
 *             records — the three #68 files are .rs, covered by the default
 *             rs glob; only the yaml-extra variant differs)
 *   b ....... the reverse path, honestly split at the v1 boundary:
 *             b1 the refs COMMAND resolves its node query against
 *             DISCOVERED spec keys only (its own header: the check
 *             engine's promotion loop and plugin tier are deliberately
 *             not reimplemented there), so every plugin-tier query
 *             spelling — colon-anchored, colon-less, file-level — REFUSES
 *             BY NAME (ok:false / exit 1 / "no spec file matches"),
 *             never a silent empty answer (stable pre- and post-merge);
 *             b2/b3 the corpus refs engine (the OTHER engine the frozen
 *             spec's shared-matcher clause 3 covers): a plugin-file see:
 *             with the CANONICAL COLON spelling — and the colon-less
 *             spelling — resolves post-fix (pre-fix BOTH were broken
 *             anchors: the same one-sided seam on the corpus side); b4
 *             the codebase side mirrors it: a colon-LESS pointer spelling
 *             resolves too (both spellings clean to the same targetSlug)
 *   c ....... corpus-side: the three plugin specs joined the corpus
 *             through the aliasing wiring — the plain check stays CLEAN
 *             (exit 0, no findings) with refs.total 8→11 and files 6→9;
 *             the committed _rules.yaml carries the tier block; and the
 *             wiring is LOAD-BEARING — strip the aliasing include and the
 *             five pointers turn FileNotFound (the tier is what makes
 *             `cans/plugins/*.md` resolvable)
 *   d ....... no over-tolerance (spec clause 4): the pre-existing
 *             `#Qutas` typo and `09-observability.md` FileNotFound are
 *             STILL the only true broken records, byte-exact; a
 *             misspelled colon anchor (`#SQLite-UDS-bridge-mechanix:`)
 *             appended to a source file is still EXACTLY +1
 *             AnchorNotFound, and its suggestion proposes the CANONICAL
 *             COLON spelling (`did you mean cans/plugins/db-proxy.md#
 *             SQLite-UDS-bridge-mechanics:?` — anchorSlug of the
 *             colon-titled heading keeps the colon); and the extended
 *             corpus stays plain-check-clean even with the misspell in
 *             the source tree (a codeband mutation can never dirty the
 *             corpus band)
 *   e ....... the extraction wire shape at the unit seam, over the
 *             fixture's own bytes: the five pointers' targetSlug AFTER
 *             the cleaning pass — db-proxy `SQLite-UDS-bridge-mechanics`
 *             (colon stripped), profile
 *             `Inversion-of-Control-configuration-router`, wire-ingress
 *             `Ingress-stream-framing-on-stream-kind-L4-FORWARD-
 *             (mux-0x0001)` (the `):` run strips, the opener-backed `)`
 *             repairs) — `raw` verbatim, `targetFile` as written (the
 *             `cans/` prefix kept), lines pinned. Spec clause 2's proof:
 *             extraction is UNCHANGED by the fix (the anchor side was
 *             always cleaned; the fix cleans the heading side at
 *             matching), so these pins are the stable regression guards.
 *
 * HONESTY NOTE: on the contract branch ALONE (pre-engine-merge) the
 * new-behavior pins are RED by design — the fixture reproduces the bug
 * (7 broken where 2 belong: the 2 true + the 5 false AnchorNotFound of the
 * one-sided cleaning; plus the corpus-side and misspell variants). They
 * turn green against the merged engine that implements the frozen spec
 * above; the two true broken records are pinned byte-exactly so the merge
 * can never silently heal (or duplicate) them.
 *
 * Runtime-neutral: imports the test facade, never 'bun:test' directly;
 * CLI runs are blackbox spawns via ./runtime.ts (CANS_ROOT pinned empty
 * so the walk-up resolution lands on the intended workspace).
 */
import { describe, test, expect, afterEach } from './testing.ts';
import { join } from 'path';
import { readFileSync, writeFileSync } from 'fs';

import { spawnCli } from './runtime.ts';
import { makeTmpDir, cleanTmpDir, copyFixtureToTmp, readFixture } from './helpers.ts';
import { extractCodebasePointers } from '../src/core/codebase.ts';

// ── harness (the issue66-integration pattern, verbatim) ─────────────────────

const tmps: string[] = [];

/** Fresh copy of the fixture into tmp: <tmp>/codebase-workspace/{cans,src}. */
function ws(name: string): string {
  const tmp = makeTmpDir(`issue68-contract-${name}`);
  tmps.push(tmp);
  return copyFixtureToTmp('codebase-workspace', tmp);
}

/** Blackbox spawn pinned to the copied project root. CANS_ROOT is pinned
 *  EMPTY so resolveWorkspaceRoot walks up from cwd and lands on the copied
 *  fixture's cans/ — never some ancestor workspace. */
function runCli(args: string[], projectDir: string) {
  return spawnCli(args, projectDir, { ...process.env, CANS_ROOT: '' });
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
  return parsed;
}

afterEach(() => {
  while (tmps.length > 0) {
    cleanTmpDir(tmps.pop()!);
  }
});

// ── the fixture oracle, as numbers and records ──────────────────────────────
// (test/fixtures/codebase-workspace/README.md is the human-readable source of
// these — keep the two in sync; the files as committed are authoritative.)

/** routes.ts:3 — the pre-existing broken slug, UNCHANGED by the #68 fix: the
 *  regression guard at the heart of spec clause 4 (no over-tolerance). */
const BROKEN_ANCHOR = {
  type: 'CodebaseBrokenReference',
  file: 'src/api/routes.ts',
  line: 3,
  raw: 'see: 03-storage.md#Qutas',
  targetFile: '03-storage.md',
  targetSlug: 'Qutas',
  reason: 'AnchorNotFound',
};

/** quota.py:7 — the pre-existing broken file, UNCHANGED by the #68 fix. */
const BROKEN_FILE = {
  type: 'CodebaseBrokenReference',
  file: 'src/storage/quota.py',
  line: 7,
  raw: 'see: 09-observability.md',
  targetFile: '09-observability.md',
  targetSlug: null,
  reason: 'FileNotFound',
};

/** artifact-wiring.rs:36 — the broken artifact code-symbol anchor, one of
 *  issue #69's three DELIBERATE broken records (the fixture grew again for
 *  the artifact-target tier; see test/issue-69-contract.test.ts). */
const BROKEN_ARTIFACT_SYMBOL = {
  type: 'CodebaseBrokenReference',
  file: 'src/plugins/artifact-wiring.rs',
  line: 36,
  raw: 'see: cans/artifacts/examples/multi-vm-swarm.rs#federateNope',
  targetFile: 'cans/artifacts/examples/multi-vm-swarm.rs',
  targetSlug: 'federateNope',
  reason: 'AnchorNotFound',
};

/** artifact-wiring.rs:40 — the broken artifact text-heading anchor (#69). */
const BROKEN_ARTIFACT_HEADING = {
  type: 'CodebaseBrokenReference',
  file: 'src/plugins/artifact-wiring.rs',
  line: 40,
  raw: 'see: cans/artifacts/diagrams/host-runtime.txt#driver-avf-nope',
  targetFile: 'cans/artifacts/diagrams/host-runtime.txt',
  targetSlug: 'driver-avf-nope',
  reason: 'AnchorNotFound',
};

/** artifact-wiring.rs:46 — the broken artifact FILE, the issue's exact
 *  missing-artifact spelling (#69). */
const BROKEN_ARTIFACT_FILE = {
  type: 'CodebaseBrokenReference',
  file: 'src/plugins/artifact-wiring.rs',
  line: 46,
  raw: 'see: cans/artifacts/code/plugin-trait.rs#PluginError',
  targetFile: 'cans/artifacts/code/plugin-trait.rs',
  targetSlug: 'PluginError',
  reason: 'FileNotFound',
};

/** The five issues, in the contract's deterministic order (file asc, line
 *  asc): every issue-#68 pointer is VALID post-fix, so the broken set is
 *  the pre-#67 pair plus — since the #69 fixture extension — the three
 *  DELIBERATE artifact records (issue #69's own repro, pinned by the #69
 *  suite; listed here because the #68 oracle pins the FULL broken set). */
const ORACLE_ISSUES = [
  BROKEN_ANCHOR,
  BROKEN_ARTIFACT_SYMBOL,
  BROKEN_ARTIFACT_HEADING,
  BROKEN_ARTIFACT_FILE,
  BROKEN_FILE,
];

/** The three issue-#68 sources (the kelir plugin crates at fixture scale). */
const NEW_SOURCES = [
  'src/plugins/db-proxy.rs',
  'src/plugins/profile.rs',
  'src/plugins/wire-ingress.rs',
];

/** The five kelir pointers' written spans — none may be reported broken. */
const KELIR_FIVE_RAWS = [
  'see: cans/plugins/db-proxy.md#SQLite-UDS-bridge-mechanics:',
  'see: cans/plugins/profile.md#Inversion-of-Control-configuration-router:',
  'see: cans/plugins/wire-ingress.md#Ingress-stream-framing-on-stream-kind-L4-FORWARD-(mux-0x0001):',
];

/** The e1-shaped rules (no codebase block) + the fixture's own redundancy
 *  knobs + the #68 plugin-tier wiring — the corpus-clean shape with the
 *  three plugin specs still loaded, so the pure-default scan below differs
 *  from the config-on one ONLY in the include-list dimension. */
const RULES_NO_CODEBASE = [
  'references:',
  '  back_pointers: false',
  '  aliasing:', // the issue #68 plugin tier (the fixture's own wiring)
  '    enabled: true',
  '    include:',
  '      - plugins/*.md',
  'redundancy:',
  '  word_frequency_threshold: 5',
  '  fuzzy: false',
  '',
].join('\n');

/** The b2/b3 corpus-side variant: RULES_NO_CODEBASE plus `max_hops: 2` —
 *  the transient plugin→plugin see: chains through the target's own hub ref
 *  (plugins/profile.md → plugins/db-proxy.md → 00-overview.md, a two-edge
 *  chain, one above the default ceiling of 1). The variant lifts the
 *  ceiling so the pin isolates the ANCHOR dimension, not the hop depth. */
const RULES_PLAIN_HOPS2 = RULES_NO_CODEBASE.replace(
  "  back_pointers: false\n",
  "  back_pointers: false\n  max_hops: 2\n",
);

// ── a: the check scan — zero broken refs for the kelir five ─────────────────

describe('issue #68 a — check --codebase: the kelir five all resolve', () => {
  test('a1: config-on — 13 scanned / 32 pointers / EXACTLY the 5 broken, zero findings from the new sources', () => {
    const p = ws('a1');
    const r = runCli(['check', '--codebase', '--json'], p);
    expect(r.exit).toBe(2); // severity: error → the error band (5 true findings)
    const j = parseJsonOut(r.out);
    expect(j.codebase).toBeDefined();
    expect(j.codebase.scanned).toBe(13); // 9 pre-#68 + the three new .rs sources + the artifact-wiring .rs source (#69)
    expect(j.codebase.pointers).toBe(32); // 21 pre-#68 + the kelir five + the six artifact pointers (#69)
    expect(j.codebase.broken).toBe(5);
    // THE pin: the broken set is byte-exactly the five records — the 2 true
    // pre-existing plus the 3 DELIBERATE #69 artifact ones — and none of the
    // five kelir colon-anchor pointers (db-proxy.rs:42+141, profile.rs:21,
    // wire-ingress.rs:18+85) is reported broken.
    expect(j.codebase.issues).toEqual(ORACLE_ISSUES);
    // And made explicit — the heart of the issue: ZERO findings from the
    // three new src/plugins/*.rs files (pre-fix they carried all five
    // false AnchorNotFound findings).
    const issueFiles = (j.codebase.issues as any[]).map((i) => i.file);
    expect(issueFiles.some((f: string) => NEW_SOURCES.includes(f))).toBe(false);
    for (const raw of KELIR_FIVE_RAWS) {
      expect((j.codebase.issues as any[]).some((i) => i.raw === raw)).toBe(false);
    }
  });

  test('a2: pure defaults (no codebase block, tier kept on) — 11 files / 30 pointers / the same 5 broken', () => {
    const p = ws('a2');
    writeFileSync(join(p, 'cans', '_rules.yaml'), RULES_NO_CODEBASE, 'utf8');
    const r = runCli(['check', '--codebase', '--json'], p);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    // The RFC §3 default include list has no *.yaml: src/net.yaml AND
    // src/plugins/mounts.yaml stay out — but the three new sources are .rs
    // (covered by the default *.rs include) and the plugin tier is corpus-side
    // wiring, so the five kelir pointers still resolve: 11 files, 30
    // pointers, the same five broken records (2 true + 3 deliberate #69).
    expect(j.codebase.scanned).toBe(11);
    expect(j.codebase.pointers).toBe(30);
    expect(j.codebase.broken).toBe(5);
    expect(j.codebase.issues).toEqual(ORACLE_ISSUES);
    expect((j.codebase.issues as any[]).some((i) => i.file === 'src/plugins/mounts.yaml')).toBe(false);
    expect((j.codebase.issues as any[]).some((i) => i.file === 'src/net.yaml')).toBe(false);
  });
});

// ── b: the reverse path — the v1 boundary + the corpus-side widening ────────

describe('issue #68 b — reverse queries: the plugin-tier boundary and the both-spellings resolution', () => {
  test('b1: refs <plugin-tier node> --codebase REFUSES at the documented v1 corpus boundary — every spelling, by name', () => {
    const p = ws('b1');
    // The refs command resolves its node query against DISCOVERED spec keys
    // only (root-level .md + index.md — its own header: "the check engine's
    // subfolder promotion and plugin tier are NOT reimplemented here"), so
    // the plugin-tier files are outside the v1 QUERY corpus. Every legal
    // spelling of the kelir five's reverse query refuses with the boundary
    // NAMED — never a crash, never a silent empty answer. The `node` echo
    // proves the query GRAMMAR accepts the colon spelling (the #67 mirror);
    // the refusal is purely at file resolution.
    const queries = [
      'cans/plugins/db-proxy.md#SQLite-UDS-bridge-mechanics:', // canonical colon
      'cans/plugins/db-proxy.md#SQLite-UDS-bridge-mechanics', // colon-less
      'cans/plugins/profile.md', // file-level
    ];
    for (const q of queries) {
      const r = runCli(['refs', q, '--codebase', '--json'], p);
      expect(r.exit).toBe(1);
      const j = parseJsonOut(r.out);
      expect(j.ok).toBe(false);
      expect(j.command).toBe('refs');
      expect(j.exitCode).toBe(1);
      expect(j.node).toBe(q); // the query AS WRITTEN
      expect(j.scanned).toBe(0);
      expect(j.matches).toEqual([]);
      expect(j.error).toContain(`no spec file matches "cans/plugins/`);
      expect(j.error).toContain('resolves against the workspace corpus');
    }
  });

  test('b2: the corpus refs engine resolves the CANONICAL COLON spelling (shared matcher, clause 3)', () => {
    const p = ws('b2');
    // A plugin-file see: written with the canonical colon spelling — the
    // exact form `cans slug` prints. The corpus side cleans the anchor
    // token at parse (outline.ts stripRefTrailingPunct) while the heading
    // keeps its colon: pre-fix this was a broken anchor (the one-sided
    // seam on the OTHER engine); post-fix clause 3 compares
    // cleaned-vs-cleaned and it resolves.
    const prof = join(p, 'cans', 'plugins', 'profile.md');
    writeFileSync(
      prof,
      readFileSync(prof, 'utf8') +
        '  - Bridge contract: see: plugins/db-proxy.md#SQLite-UDS-bridge-mechanics:\n',
      'utf8',
    );
    writeFileSync(join(p, 'cans', '_rules.yaml'), RULES_PLAIN_HOPS2, 'utf8');
    const r = runCli(['check', '--json'], p);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect(j.counts.errors).toBe(0);
    expect(j.counts.warnings).toBe(0);
    // The ref is counted (11 hub refs + the colon ref) and NONE is broken.
    expect(j.refs).toEqual({ total: 12, broken: 0, deepHops: 0 });
    expect((j.sections.refs as any[]).filter((i) => i.file === 'plugins/profile.md')).toEqual([]);
  });

  test('b3: the corpus refs engine resolves the colon-LESS spelling too (both spellings, one node)', () => {
    const p = ws('b3');
    // The colon-less spelling ALSO needs clause 3: the heading's own
    // trailing colon blocked it pre-fix exactly the same way. Both
    // spellings clean to the same target and resolve post-fix.
    const prof = join(p, 'cans', 'plugins', 'profile.md');
    writeFileSync(
      prof,
      readFileSync(prof, 'utf8') +
        '  - Bridge contract: see: plugins/db-proxy.md#SQLite-UDS-bridge-mechanics\n',
      'utf8',
    );
    writeFileSync(join(p, 'cans', '_rules.yaml'), RULES_PLAIN_HOPS2, 'utf8');
    const r = runCli(['check', '--json'], p);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.counts.errors).toBe(0);
    expect(j.counts.warnings).toBe(0);
    expect(j.refs).toEqual({ total: 12, broken: 0, deepHops: 0 });
  });

  test('b4: the codebase side mirrors it — a colon-LESS pointer spelling resolves too', () => {
    const p = ws('b4');
    // Both spellings clean to the same targetSlug: the committed five
    // carry the canonical colon spelling; a colon-less spelling appended
    // to a source file resolves post-fix and changes nothing but the
    // pointer census.
    const rs = join(p, 'src', 'plugins', 'db-proxy.rs');
    writeFileSync(
      rs,
      readFileSync(rs, 'utf8') + '\n// see: cans/plugins/db-proxy.md#SQLite-UDS-bridge-mechanics\n',
      'utf8',
    );
    const r = runCli(['check', '--codebase', '--json'], p);
    expect(r.exit).toBe(2); // still the 5 fixture findings
    const j = parseJsonOut(r.out);
    expect(j.codebase.scanned).toBe(13);
    expect(j.codebase.pointers).toBe(33); // 32 + the appended colon-less spelling
    expect(j.codebase.broken).toBe(5);
    expect(j.codebase.issues).toEqual(ORACLE_ISSUES);
  });
});

// ── c: the corpus side — the plugin tier joined, clean, and load-bearing ────

describe('issue #68 c — the three plugin specs join the corpus (clean, wired, load-bearing)', () => {
  test('c1: the plain check over the extended corpus stays CLEAN and the counts moved', () => {
    const p = ws('c1');
    // No codebase block, no flag — the plain check with the plugin tier
    // loaded: the three plugin specs are checked at the refs layer, their
    // hub refs join the graph, and the extension smuggles in NO finding:
    // exit 0, no codebase key, refs 8→11 (one hub ref each), files 6→9.
    writeFileSync(join(p, 'cans', '_rules.yaml'), RULES_NO_CODEBASE, 'utf8');
    const r = runCli(['check', '--json'], p);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect('codebase' in j).toBe(false);
    expect(j.counts.errors).toBe(0);
    expect(j.counts.warnings).toBe(0);
    expect(j.refs).toEqual({ total: 11, broken: 0, deepHops: 0 });
    expect(j.summary.files).toBe(9); // 6 spec + the 3 plugin-tier files
  });

  test('c2: the wiring is pinned in the fixture — the issue #65 aliasing-include tier block', () => {
    // The committed _rules.yaml carries the plugin-tier wiring verbatim
    // (the authentic kelir route: references.aliasing.include with the
    // workspace-relative glob, aliasing enabled gating the tier).
    const rules = readFixture('codebase-workspace', 'cans', '_rules.yaml');
    expect(rules).toContain(
      ['  aliasing:', '    enabled: true', '    include:', '      - plugins/*.md', ''].join('\n'),
    );
  });

  test('c3: the wiring is LOAD-BEARING — drop the include and the five turn FileNotFound', () => {
    const p = ws('c3');
    // Same fixture, same config-on rules, ONLY the aliasing block stripped:
    // the plugin files leave the checked set, `cans/plugins/*.md` is no
    // longer a resolvable key, and the five kelir pointers become
    // FileNotFound (the issue's pointers were AnchorNotFound precisely
    // because kelir's wiring loads the tier). Stable pre- and post-fix —
    // the tier, not the matcher, is what makes the files resolvable.
    const rulesPath = join(p, 'cans', '_rules.yaml');
    writeFileSync(
      rulesPath,
      readFileSync(rulesPath, 'utf8').replace(
        ['  aliasing:', '    enabled: true', '    include:', '      - plugins/*.md', ''].join('\n'),
        '',
      ),
      'utf8',
    );
    const r = runCli(['check', '--codebase', '--json'], p);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.codebase.scanned).toBe(13);
    expect(j.codebase.pointers).toBe(32);
    expect(j.codebase.broken).toBe(10); // the 2 true + the five FileNotFound + the 3 #69 artifact broken
    expect((j.codebase.issues as any[]).map((i) => [i.file, i.line, i.reason])).toEqual([
      ['src/api/routes.ts', 3, 'AnchorNotFound'],
      ['src/plugins/artifact-wiring.rs', 36, 'AnchorNotFound'],
      ['src/plugins/artifact-wiring.rs', 40, 'AnchorNotFound'],
      ['src/plugins/artifact-wiring.rs', 46, 'FileNotFound'],
      ['src/plugins/db-proxy.rs', 42, 'FileNotFound'],
      ['src/plugins/db-proxy.rs', 141, 'FileNotFound'],
      ['src/plugins/profile.rs', 21, 'FileNotFound'],
      ['src/plugins/wire-ingress.rs', 18, 'FileNotFound'],
      ['src/plugins/wire-ingress.rs', 85, 'FileNotFound'],
      ['src/storage/quota.py', 7, 'FileNotFound'],
    ]);
  });
});

// ── d: no over-tolerance (spec clause 4) ────────────────────────────────────

describe('issue #68 d — genuinely broken anchors are still reported', () => {
  test('d1: the pre-existing #Qutas typo is STILL AnchorNotFound, record byte-exact', () => {
    const p = ws('d1');
    const r = runCli(['check', '--codebase', '--json'], p);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    const qutas = (j.codebase.issues as any[]).filter((i) => i.raw === 'see: 03-storage.md#Qutas');
    expect(qutas.length).toBe(1);
    expect(qutas[0]).toEqual(BROKEN_ANCHOR);
  });

  test('d2: the pre-existing 09-observability.md is STILL FileNotFound, record byte-exact', () => {
    const p = ws('d2');
    const j = parseJsonOut(runCli(['check', '--codebase', '--json'], p).out);
    const missing = (j.codebase.issues as any[]).filter((i) => i.raw === 'see: 09-observability.md');
    expect(missing.length).toBe(1);
    expect(missing[0]).toEqual(BROKEN_FILE);
  });

  test('d3: a misspelled colon anchor appended to a source file is still EXACTLY +1 AnchorNotFound', () => {
    const p = ws('d3');
    // `mechanix` — a near miss shaped exactly like the kelir anchor
    // (similarity ≈ 0.89 ≥ the 0.8 suggestion floor). Widening the matcher
    // must not widen the VERDICT: the pointer stays AnchorNotFound, and
    // its suggestion proposes the CANONICAL COLON spelling — anchorSlug of
    // the colon-titled heading keeps the colon, so the proposal is
    // `…#SQLite-UDS-bridge-mechanics:?`, the spelling that resolves.
    const rs = join(p, 'src', 'plugins', 'db-proxy.rs');
    writeFileSync(
      rs,
      readFileSync(rs, 'utf8') + '\n// see: cans/plugins/db-proxy.md#SQLite-UDS-bridge-mechanix:\n',
      'utf8',
    );
    const r = runCli(['check', '--codebase', '--json'], p);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.codebase.pointers).toBe(33); // 32 + the misspell
    expect(j.codebase.broken).toBe(6); // the 5 fixture broken + the misspell, no more
    const near = (j.codebase.issues as any[]).filter((i) => i.file === 'src/plugins/db-proxy.rs');
    expect(near.length).toBe(1);
    expect(near[0]).toEqual({
      type: 'CodebaseBrokenReference',
      file: 'src/plugins/db-proxy.rs',
      line: 148,
      raw: 'see: cans/plugins/db-proxy.md#SQLite-UDS-bridge-mechanix:',
      targetFile: 'cans/plugins/db-proxy.md',
      targetSlug: 'SQLite-UDS-bridge-mechanix',
      reason: 'AnchorNotFound',
    });
    // The suggestion rides the refs section item (advice only — the wire
    // record keeps its frozen 7-key shape) and names the colon spelling.
    const item = (j.sections.refs as any[]).find((i: any) => i.detail.includes('mechanix'));
    expect(item).toBeDefined();
    expect(item.suggestion).toBe(
      'did you mean cans/plugins/db-proxy.md#SQLite-UDS-bridge-mechanics:? — fix the ref anchor',
    );
  });

  test('d4: the extended corpus stays plain-check-clean even with the misspell in the source tree', () => {
    const p = ws('d4');
    // The misspell is a CODEBASE-band finding; the corpus band over the
    // same workspace (tier on, codebase off) stays exit 0 — the extension
    // smuggles in no corpus finding, mutation or not.
    const rs = join(p, 'src', 'plugins', 'db-proxy.rs');
    writeFileSync(
      rs,
      readFileSync(rs, 'utf8') + '\n// see: cans/plugins/db-proxy.md#SQLite-UDS-bridge-mechanix:\n',
      'utf8',
    );
    writeFileSync(join(p, 'cans', '_rules.yaml'), RULES_NO_CODEBASE, 'utf8');
    const r = runCli(['check', '--json'], p);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect('codebase' in j).toBe(false);
    expect(j.counts.errors).toBe(0);
    expect(j.counts.warnings).toBe(0);
  });
});

// ── e: the extraction wire shape (unit seam, over the fixture's own bytes) ──

describe('issue #68 e — extraction: the anchor side of the asymmetry, pinned (the fix must not move it)', () => {
  test('e1: db-proxy.rs — both occurrences, colon stripped at extraction', () => {
    const out = extractCodebasePointers(readFixture('codebase-workspace', 'src', 'plugins', 'db-proxy.rs'));
    expect(out.length).toBe(2);
    // Line 42 and line 141, the SAME canonical colon spelling as written.
    // The cleaning pass strips the trailing `:` → targetSlug without it;
    // raw keeps the verbatim span; targetFile keeps the `cans/` prefix as
    // written. This is the ANCHOR side of the one-sided seam — unchanged
    // by the fix (spec clause 2), so the pin is a stable regression guard.
    expect(out[0]).toEqual({
      line: 42,
      raw: 'see: cans/plugins/db-proxy.md#SQLite-UDS-bridge-mechanics:',
      targetFile: 'cans/plugins/db-proxy.md',
      targetSlug: 'SQLite-UDS-bridge-mechanics',
    });
    expect(out[1]).toEqual({
      line: 141,
      raw: 'see: cans/plugins/db-proxy.md#SQLite-UDS-bridge-mechanics:',
      targetFile: 'cans/plugins/db-proxy.md',
      targetSlug: 'SQLite-UDS-bridge-mechanics',
    });
  });

  test('e2: profile.rs — the hyphen-chained colon anchor, colon stripped', () => {
    const out = extractCodebasePointers(readFixture('codebase-workspace', 'src', 'plugins', 'profile.rs'));
    expect(out.length).toBe(1);
    expect(out[0]).toEqual({
      line: 21,
      raw: 'see: cans/plugins/profile.md#Inversion-of-Control-configuration-router:',
      targetFile: 'cans/plugins/profile.md',
      targetSlug: 'Inversion-of-Control-configuration-router',
    });
  });

  test('e3: wire-ingress.rs — the `):` run strips, the opener-backed `)` repairs', () => {
    const out = extractCodebasePointers(readFixture('codebase-workspace', 'src', 'plugins', 'wire-ingress.rs'));
    expect(out.length).toBe(2);
    // The written anchor ends in `(mux-0x0001):` — the trailing punct run
    // `):` strips whole, then the repair pass re-appends the one `)` backed
    // by the unmatched `(` → the targetSlug keeps the structural closer.
    // (The heading's own `):` gets the SAME treatment at matching post-fix
    // — clause 3 runs both sides through the one shared pass.)
    const expected = {
      raw: 'see: cans/plugins/wire-ingress.md#Ingress-stream-framing-on-stream-kind-L4-FORWARD-(mux-0x0001):',
      targetFile: 'cans/plugins/wire-ingress.md',
      targetSlug: 'Ingress-stream-framing-on-stream-kind-L4-FORWARD-(mux-0x0001)',
    };
    expect(out[0]).toEqual({ line: 18, ...expected });
    expect(out[1]).toEqual({ line: 85, ...expected });
  });
});
