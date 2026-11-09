/**
 * Issue #70 — the CONTRACT suite: `cans check --codebase` 0.18.0 on kelir
 * mints 16 `codebase.broken_reference` errors + 19 `codebase.anchor.
 * no-target` warnings for pointers that were RIGHT — anchors that exist in
 * their targets as trait methods, no-`pub` unit structs, referenced names
 * (imports / uses / field accesses) and text tokens (tree entries, box
 * lines) — pinned end-to-end against the extended
 * `test/fixtures/codebase-workspace/` fixture (its README.md is the
 * line-authoritative oracle — every pointer, its line, its verdict).
 *
 * THE BUG, two engine halves:
 *   A. DECLARATIONS the #60 Rust grammar misses: it mints `pub` column-0
 *      items only, so a trait method (`async fn configure_runtime(&mut
 *      self)` inside `pub trait ContainerService` — the REAL 53-line file
 *      is in the fixture verbatim) and a no-`pub` column-0 unit struct
 *      (`struct UserOracle;`) are invisible → `#configure_runtime`,
 *      `#mount_scratch`, `#ingest_image`, `#UserOracle` all false
 *      AnchorNotFound.
 *   B. REFERENCED NAMES and DIAGRAM LINES: no vocabulary at all addresses
 *      a name that merely APPEARS in the target — `#LedgerPlugin`
 *      `#binary_blake3` `#FinalizeRequest` `#FinalReceipt` (the swarm
 *      agent's imports/uses), `#PgWireRewrite` `#DbProxyConfig` (the db
 *      example's imports/constructs), `#MeshPlugin` `#SupplyChainPlugin`
 *      (the swarm's use-tree), `#kelir-shim` (a project-structure tree
 *      entry), `#virtio-shm` (a four-ring-bus box entry), `#driver-avf`/
 *      `#driver-rustvmm` (host-runtime tree entries) — each miss lands on
 *      a target with SOME vocabulary → the ERROR path (on kelir the
 *      no-vocabulary targets took the no-target WARNING path instead).
 *
 * THE FROZEN FIX SPEC this suite is written against (the engine half lands
 * on fix/issue-70-engine):
 *
 *   1. ENGINE: the Rust symbol grammar v2 — non-`pub` column-0
 *      declarations mint (`struct UserOracle;` → `UserOracle`) and trait
 *      methods mint inside `pub trait X {` blocks (`async fn
 *      configure_runtime` → `configure_runtime`); `pub(crate)`/`pub(super)`
 *      and impl-methods still mint nothing.
 *   2. ENGINE: a NEW leaf tier through the shared checkArtifactAnchor —
 *      every identifier token of a code target and every
 *      `[A-Za-z0-9][A-Za-z0-9_\-]*` token (≥ 2 chars, ≥ 1 letter) of a
 *      `.txt` target.
 *   3. ENGINE: the no-target message gains the parenthetical `(bullets,
 *      schematic key paths, text headings, code symbols, referenced
 *      names, text tokens)` — advisory semantics unchanged.
 *   4. ENGINE: miss suggestions rank the union (declaration + leaf): the
 *      typo `#configure_runtim` proposes `configure_runtime`, `#LedgerPlugn`
 *      proposes `LedgerPlugin`.
 *   5. EXIT LADDER unchanged (issue class C is documentation/pins only):
 *      0 clean / 1 warnings / 2 errors — `ok: true` with warnings-only
 *      still exits 1. The d-block pins it engine-independently.
 *
 * THE FIXTURE WIRING (README "issue #70 extension"): the REAL kelir shapes
 * under `cans/artifacts/` — `code/container-service.rs` (verbatim),
 * `examples/swarm-agent.rs` + `examples/db-runtime.py` (compact
 * miniatures preserving the cited lines), the `examples/multi-vm-swarm.rs`
 * and `diagrams/host-runtime.txt` EXTENSIONS (every pre-#70 byte kept),
 * `config/project-structure.txt`, `diagrams/four-ring-bus.txt`,
 * `diagrams/empty-metrics.txt` (the EMPTY target) — plus the scanned
 * source `src/plugins/trait-wiring.rs` carrying EIGHTEEN pointers at
 * pinned lines 15/22/27/34/41/46/51/56/63/68/75/80/88/93/98/106/109/115:
 * fifteen VALID (one per cited shape), two near-miss typos kept broken on
 * purpose, one at the empty target (the advisory class).
 *
 * COUNT NOTE (a deliberate deviation, documented): the task brief's
 * arithmetic note says "13 valid + 2 typos + 1 warning = 16 pointers", but
 * its own enumeration lists FIFTEEN valid anchors (three trait methods —
 * and the brief's own c-block pins the `#mount_scratch` reverse query,
 * which requires the pointer to exist — five swarm-agent names, two
 * db-runtime names, two swarm plugin names, three text tokens). The
 * enumeration wins: 15 + 2 + 1 = 18 pointers, census 50 (32 + 18), and
 * the verified pre-fix red pattern is 22 broken (5 + 15 + 2), not 20.
 *
 * WHAT EACH BLOCK PINS (all blackbox via the real CLI, the issue-66/67/68/
 * 69 integration harness pattern; the fixture is driven from a fresh tmp
 * copy):
 *
 *   a ....... the check scan over the extended fixture: config-on
 *             14 scanned / 50 pointers / EXACTLY the SEVEN broken records
 *             byte-pinned in the deterministic order (the 5 pre-existing
 *             byte-pinned ones from #69 + the 2 new typos) and EXACTLY
 *             ONE warning (the empty-metrics no-target advisory, rule
 *             codebase.anchor.no-target) and ZERO findings for the
 *             fifteen VALID pointers — the heart of the issue
 *   b ....... the --json wire: the two new records carry targetFile and
 *             targetSlug VERBATIM with reason AnchorNotFound (green pre-
 *             merge — selected by written span, the findings exist with
 *             the same shape, only the fifteen VALID pointers' verdicts
 *             are wrong); the human output (`--show refs`) carries BOTH
 *             did-you-mean lines (red pre-merge: the suggestion pool is
 *             empty without the v2/leaf vocabularies)
 *   c ....... the reverse path, the refs ARTIFACT tier (green pre-merge —
 *             a query answers WRITERS, never verdicts): the six named
 *             anchored queries answer their exact trait-wiring.rs lines;
 *             the TYPO spelling answers its writer line too (the #69
 *             `#federateNope` precedent — the reverse path is a query,
 *             not a verdict; the brief's "zero matches" reading is pinned
 *             instead through `#LedgerCtx`, a name that EXISTS in the
 *             target but no source writes); the file-level query into
 *             container-service.rs answers ALL FOUR of its pointers; the
 *             empty-metrics advisory pointer answers too; a `.md`
 *             regression query still answers its pre-existing matches
 *   d ....... the exit-code ladder (issue class C — ENGINE-INDEPENDENT,
 *             green on this branch alone): a minimal in-test workspace
 *             (one clean spec file + the codebase block + one src file
 *             whose ONLY pointer is the empty-metrics class) reports
 *             ok:true / errors 0 / warnings 1 and EXITS 1; adding one
 *             broken typo pointer at a vocabulary-bearing artifact →
 *             exit 2; the clean file-level spelling → exit 0
 *   e ....... the corpus band is untouched: the plain check (no flag)
 *             stays clean with NO codebase key, refs.total 11 / files 9 —
 *             the extension added workspace ARTIFACT files and one
 *             scanned source, never a corpus file
 *
 * HONESTY NOTE (RED by design, the #68/#69 contract model): on the
 * contract branch ALONE — before the fix/issue-70-engine merge — 3 of the
 * 15 pins are red, all of them the widened-vocabulary half: a1 (the
 * census reads 22 broken, not 7 — the fifteen VALID pointers are the
 * issue's false positives, verified by running: 14 scanned / 50 pointers /
 * 22 broken + 1 warning), a2 (twenty-two findings ride sections.refs as
 * codebase.broken_reference, not seven), b2 (no did-you-mean lines exist:
 * the pre-fix suggestion pool of both typo targets is empty, every
 * suggestion reads "no near match … add the … node there" — and the fold
 * reads 22×, not 7×). The 12 green pins are the contract half that must
 * STAY green across the merge: a3 (the warnings class — the empty-metrics
 * advisory, rule and count, engine-independent), b1 (the two new records'
 * wire shape, selected by written span), c1–c6 (the reverse path answers
 * writers regardless of verdicts), d1/d2/d3 (the exit ladder — issue
 * class C, engine-independent by construction), e1 (the corpus band
 * untouched). Merge order: engine first, then this branch — the full suite
 * goes green only against the merged engine (verified at the merge
 * commit).
 *
 * Runtime-neutral: imports the test facade, never 'bun:test' directly;
 * CLI runs are blackbox spawns via ./runtime.ts (CANS_ROOT pinned empty
 * so the walk-up resolution lands on the intended workspace).
 */
import { describe, test, expect, afterEach } from './testing.ts';
import { join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';

import { spawnCli } from './runtime.ts';
import { makeTmpDir, cleanTmpDir, copyFixtureToTmp } from './helpers.ts';

// ── harness (the issue-69 contract pattern, verbatim) ─────────────────────

const tmps: string[] = [];

/** Fresh copy of the fixture into tmp: <tmp>/codebase-workspace/{cans,src}. */
function ws(name: string): string {
  const tmp = makeTmpDir(`issue70-contract-${name}`);
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

// ── the fixture oracle, as numbers and records ─────────────────────────────
// (test/fixtures/codebase-workspace/README.md is the human-readable source of
// these — keep the two in sync; the files as committed are authoritative.)

/** routes.ts:3 — the pre-existing broken slug, UNCHANGED by the #70 fix: the
 *  regression guard at the heart of the no-over-tolerance contract. */
const BROKEN_ANCHOR = {
  type: 'CodebaseBrokenReference',
  file: 'src/api/routes.ts',
  line: 3,
  raw: 'see: 03-storage.md#Qutas',
  targetFile: '03-storage.md',
  targetSlug: 'Qutas',
  reason: 'AnchorNotFound',
};

/** artifact-wiring.rs:36 — the #69 broken artifact code-symbol anchor,
 *  UNCHANGED by the #70 fix (near miss of `federate`; the extension adds
 *  leaf tokens to the suggestion pool but `federateNope` stays ≥ distance 4
 *  from every one of them — its finding keeps no suggestion post-merge
 *  either, verified against the engine spec's similarity floor of 0.8). */
const BROKEN_ARTIFACT_SYMBOL = {
  type: 'CodebaseBrokenReference',
  file: 'src/plugins/artifact-wiring.rs',
  line: 36,
  raw: 'see: cans/artifacts/examples/multi-vm-swarm.rs#federateNope',
  targetFile: 'cans/artifacts/examples/multi-vm-swarm.rs',
  targetSlug: 'federateNope',
  reason: 'AnchorNotFound',
};

/** artifact-wiring.rs:40 — the #69 broken artifact text-heading anchor. */
const BROKEN_ARTIFACT_HEADING = {
  type: 'CodebaseBrokenReference',
  file: 'src/plugins/artifact-wiring.rs',
  line: 40,
  raw: 'see: cans/artifacts/diagrams/host-runtime.txt#driver-avf-nope',
  targetFile: 'cans/artifacts/diagrams/host-runtime.txt',
  targetSlug: 'driver-avf-nope',
  reason: 'AnchorNotFound',
};

/** artifact-wiring.rs:46 — the #69 broken artifact FILE. Since the #70
 *  extension the `cans/artifacts/code/` DIRECTORY exists (it holds the
 *  real container-service.rs), but `plugin-trait.rs` still does not — the
 *  verdict is byte-unchanged. */
const BROKEN_ARTIFACT_FILE = {
  type: 'CodebaseBrokenReference',
  file: 'src/plugins/artifact-wiring.rs',
  line: 46,
  raw: 'see: cans/artifacts/code/plugin-trait.rs#PluginError',
  targetFile: 'cans/artifacts/code/plugin-trait.rs',
  targetSlug: 'PluginError',
  reason: 'FileNotFound',
};

/** trait-wiring.rs:106 — the issue #70 typo, class A: a one-letter miss of
 *  the trait method the grammar v2 mints (`async fn configure_runtime`
 *  inside `pub trait ContainerService` of the REAL 53-line file). Post-fix
 *  similarity ≈ 0.94 ≥ the 0.8 suggestion floor → the did-you-mean in b2;
 *  resolution never auto-heals. */
const BROKEN_TYPO_TRAIT_METHOD = {
  type: 'CodebaseBrokenReference',
  file: 'src/plugins/trait-wiring.rs',
  line: 106,
  raw: 'see: cans/artifacts/code/container-service.rs#configure_runtim',
  targetFile: 'cans/artifacts/code/container-service.rs',
  targetSlug: 'configure_runtim',
  reason: 'AnchorNotFound',
};

/** trait-wiring.rs:109 — the issue #70 typo, class B: a one-letter miss of
 *  the leaf-tier import token (`LedgerPlugin` of the agent miniature's
 *  indented use-tree). Post-fix similarity ≈ 0.92 → the did-you-mean in
 *  b2. */
const BROKEN_TYPO_IMPORT_NAME = {
  type: 'CodebaseBrokenReference',
  file: 'src/plugins/trait-wiring.rs',
  line: 109,
  raw: 'see: cans/artifacts/examples/swarm-agent.rs#LedgerPlugn',
  targetFile: 'cans/artifacts/examples/swarm-agent.rs',
  targetSlug: 'LedgerPlugn',
  reason: 'AnchorNotFound',
};

/** quota.py:7 — the pre-existing broken file, UNCHANGED by the #70 fix. */
const BROKEN_FILE = {
  type: 'CodebaseBrokenReference',
  file: 'src/storage/quota.py',
  line: 7,
  raw: 'see: 09-observability.md',
  targetFile: '09-observability.md',
  targetSlug: null,
  reason: 'FileNotFound',
};

/** The SEVEN broken records, in the contract's deterministic order
 *  (file asc, line asc): the five byte-pinned #69 ones plus the two new
 *  #70 typos — trait-wiring.rs sorts after artifact-wiring.rs and before
 *  quota.py, so the new records slot between them. Every VALID pointer —
 *  all fifteen #70 ones included — is missing from this set. */
const ORACLE_ISSUES = [
  BROKEN_ANCHOR,
  BROKEN_ARTIFACT_SYMBOL,
  BROKEN_ARTIFACT_HEADING,
  BROKEN_ARTIFACT_FILE,
  BROKEN_TYPO_TRAIT_METHOD,
  BROKEN_TYPO_IMPORT_NAME,
  BROKEN_FILE,
];

/** The fifteen VALID #70 pointers' written spans — none may be reported
 *  broken post-#70 (the heart of the issue: anchors that exist in the
 *  target as trait methods, no-pub unit structs, referenced names and
 *  text tokens stop being false positives). */
const VALID_70_RAWS = [
  'see: cans/artifacts/code/container-service.rs#configure_runtime',
  'see: cans/artifacts/code/container-service.rs#mount_scratch',
  'see: cans/artifacts/code/container-service.rs#ingest_image',
  'see: cans/artifacts/examples/swarm-agent.rs#UserOracle',
  'see: cans/artifacts/examples/swarm-agent.rs#LedgerPlugin',
  'see: cans/artifacts/examples/swarm-agent.rs#binary_blake3',
  'see: cans/artifacts/examples/swarm-agent.rs#FinalizeRequest',
  'see: cans/artifacts/examples/swarm-agent.rs#FinalReceipt',
  'see: cans/artifacts/examples/db-runtime.py#PgWireRewrite',
  'see: cans/artifacts/examples/db-runtime.py#DbProxyConfig',
  'see: cans/artifacts/examples/multi-vm-swarm.rs#MeshPlugin',
  'see: cans/artifacts/examples/multi-vm-swarm.rs#SupplyChainPlugin',
  'see: cans/artifacts/config/project-structure.txt#kelir-shim',
  'see: cans/artifacts/diagrams/four-ring-bus.txt#virtio-shm',
  'see: cans/artifacts/diagrams/host-runtime.txt#driver-rustvmm',
];

/** The trait-wiring.rs comment lines, byte-authoritative (README table). */
const TW = {
  l15: '// see: cans/artifacts/code/container-service.rs#configure_runtime',
  l22: '// see: cans/artifacts/code/container-service.rs#mount_scratch',
  l27: '// see: cans/artifacts/code/container-service.rs#ingest_image',
  l106: '// see: cans/artifacts/code/container-service.rs#configure_runtim',
  l115: '// see: cans/artifacts/diagrams/empty-metrics.txt#anything',
};

// ── a: the check scan — the v2/leaf vocabularies validate, never mint ─────

describe('issue #70 a — check --codebase: the eighteen pointers join the census, fifteen resolve, two break, one warns', () => {
  test('a1: config-on — 14 scanned / 50 pointers / EXACTLY the 7 broken records, zero findings for the valid fifteen', () => {
    const p = ws('a1');
    const r = runCli(['check', '--codebase', '--json'], p);
    expect(r.exit).toBe(2); // severity: error → the error band (7 true findings)
    const j = parseJsonOut(r.out);
    expect(j.codebase).toBeDefined();
    // 13 pre-#70 sources + the new .rs source (the artifact targets live
    // under cans/ — workspace files are never scanned).
    expect(j.codebase.scanned).toBe(14);
    // 32 pre-#70 pointers + the eighteen #70 pointers (15 valid + 2 typos
    // + the empty-metrics advisory one).
    expect(j.codebase.pointers).toBe(50);
    expect(j.codebase.broken).toBe(7);
    // THE pin: the broken set is byte-exactly the seven records above, in
    // the deterministic order (file asc, line asc) — the two new records
    // slot in file order (trait-wiring.rs sorts after artifact-wiring.rs).
    expect(j.codebase.issues).toEqual(ORACLE_ISSUES);
    expect((j.codebase.issues as any[]).map((i) => `${i.file}:${i.line}`)).toEqual([
      'src/api/routes.ts:3',
      'src/plugins/artifact-wiring.rs:36',
      'src/plugins/artifact-wiring.rs:40',
      'src/plugins/artifact-wiring.rs:46',
      'src/plugins/trait-wiring.rs:106',
      'src/plugins/trait-wiring.rs:109',
      'src/storage/quota.py:7',
    ]);
    // And made explicit — the heart of the issue: ZERO findings for the
    // fifteen VALID pointers (the trait methods, the unit struct, the
    // referenced names and the text tokens all resolve through the v2
    // grammar and the leaf tier).
    for (const raw of VALID_70_RAWS) {
      expect((j.codebase.issues as any[]).some((i) => i.raw === raw)).toBe(false);
    }
    // The trait-wiring.rs file carries findings ONLY at its two typo lines
    // — neither the fifteen valid pointers nor the empty-metrics advisory
    // pointer (line 115) is ever a finding.
    const twIssues = (j.codebase.issues as any[]).filter((i) => i.file === 'src/plugins/trait-wiring.rs');
    expect(twIssues.map((i) => i.line)).toEqual([106, 109]);
  });

  test('a2: the seven findings ride sections.refs as codebase.broken_reference errors', () => {
    const p = ws('a2');
    const j = parseJsonOut(runCli(['check', '--codebase', '--json'], p).out);
    const rides = (j.sections.refs as any[]).filter(
      (i) => i.rule === 'codebase.broken_reference' && i.level === 'error',
    );
    expect(rides.length).toBe(7);
    expect(rides.map((i) => `${i.file}:${i.line}`).sort()).toEqual([
      'src/api/routes.ts:3',
      'src/plugins/artifact-wiring.rs:36',
      'src/plugins/artifact-wiring.rs:40',
      'src/plugins/artifact-wiring.rs:46',
      'src/plugins/trait-wiring.rs:106',
      'src/plugins/trait-wiring.rs:109',
      'src/storage/quota.py:7',
    ]);
    expect(j.counts.errors).toBeGreaterThanOrEqual(7);
  });

  test('a3: EXACTLY ONE warning — the empty-metrics no-target advisory, never a finding', () => {
    const p = ws('a3');
    // The warnings-only class, engine-independent: an EMPTY target has
    // nothing addressable by ANY vocabulary (old or new), so the anchored
    // pointer is the issue #49/#69 advisory — rule
    // codebase.anchor.no-target, level warning — and never a finding.
    // (The #70 engine widens the message's parenthetical to name the new
    // vocabularies; this pin holds on both sides of the merge because it
    // pins the RULE and the COUNT, not the wording.)
    const j = parseJsonOut(runCli(['check', '--codebase', '--json'], p).out);
    expect(j.counts.warnings).toBe(1);
    const warn = (j.sections.refs as any[]).filter(
      (i) => i.rule === 'codebase.anchor.no-target' && i.level === 'warning',
    );
    expect(warn.length).toBe(1);
    expect(warn[0]!.file).toBe('src/plugins/trait-wiring.rs');
    expect(warn[0]!.line).toBe(115);
    expect(warn[0]!.detail).toContain('cans/artifacts/diagrams/empty-metrics.txt#anything');
    // ...and it is the ONLY warning-class ride of the whole run.
    expect((j.sections.refs as any[]).filter((i) => i.level === 'warning').length).toBe(1);
  });
});

// ── b: the wire shape + the human suggestions ──────────────────────────────

describe('issue #70 b — the two new findings on the wire and in the human report', () => {
  test('b1: --json carries targetFile/targetSlug VERBATIM with reason AnchorNotFound', () => {
    const p = ws('b1');
    const j = parseJsonOut(runCli(['check', '--codebase', '--json'], p).out);
    // The two new records, selected by their WRITTEN spans (each is unique
    // in the file, so the pin is stable pre- and post-merge: pre-merge the
    // findings exist with the same wire shape, only the fifteen VALID
    // pointers' verdicts are wrong). The `cans/` prefix kept as written,
    // the anchors as captured (no truncation at the underscore, no case
    // folding), the reason the frozen two-tier verdict vocabulary.
    const twIssues = (j.codebase.issues as any[]).filter(
      (i) =>
        i.raw === 'see: cans/artifacts/code/container-service.rs#configure_runtim' ||
        i.raw === 'see: cans/artifacts/examples/swarm-agent.rs#LedgerPlugn',
    );
    expect(twIssues.map((i) => [i.targetFile, i.targetSlug, i.reason])).toEqual([
      ['cans/artifacts/code/container-service.rs', 'configure_runtim', 'AnchorNotFound'],
      ['cans/artifacts/examples/swarm-agent.rs', 'LedgerPlugn', 'AnchorNotFound'],
    ]);
    // The 7-key wire shape holds for the new records exactly as for every
    // other (the frozen #66 contract, issue66-integration a2).
    const ISSUE_KEYS = ['type', 'file', 'line', 'raw', 'targetFile', 'targetSlug', 'reason'].sort();
    for (const issue of twIssues) {
      expect(Object.keys(issue).sort()).toEqual(ISSUE_KEYS);
    }
  });

  test('b2: the human report (--show refs) carries BOTH did-you-mean lines', () => {
    const p = ws('b2');
    // The folded view names the family with its count; --show refs unfolds
    // every member (the issue66-integration a4 pattern), so both typos and
    // their suggestions are visible without JSON.
    const folded = runCli(['check', '--codebase'], p);
    expect(folded.exit).toBe(2);
    expect(folded.out + folded.err).toContain('7× broken codebase ref');
    const ex = runCli(['check', '--codebase', '--show', 'refs'], p);
    expect(ex.exit).toBe(2);
    expect(ex.out + ex.err).toContain('configure_runtim');
    expect(ex.out + ex.err).toContain('LedgerPlugn');
    // The suggestion layer knows BOTH answers (engine spec clause 4: the
    // miss ranking runs over the union of declaration + leaf candidates):
    // `configure_runtim` ≈ 0.94 from the trait method, `LedgerPlugn`
    // ≈ 0.92 from the import token. The proposal spelling may keep the
    // symbol's underscore (`#configure_runtime`, the spec's own spelling)
    // or fold it the anchorSlug way (`#configure-runtime`) — both RESOLVE
    // (the §12 normalization folds the separator family), so the pin
    // accepts either and rejects neither.
    expect(ex.out + ex.err).toMatch(
      /did you mean cans\/artifacts\/code\/container-service\.rs#configure[-_]runtime\? — fix the ref anchor/,
    );
    expect(ex.out + ex.err).toContain(
      'did you mean cans/artifacts/examples/swarm-agent.rs#LedgerPlugin? — fix the ref anchor',
    );
  });
});

// ── c: the reverse path — the refs artifact query tier ─────────────────────

describe('issue #70 c — refs <artifact> --codebase: the v2/leaf anchors answer their writers', () => {
  test('c1: the six named anchored queries answer their exact pointer lines (never fuzzy)', () => {
    const p = ws('c1');
    // One pinned query per cited shape class: the trait method (x2), the
    // leaf-tier import name, and the three text tokens. The reverse path
    // matches WRITERS by anchor equality — it answers whatever a source
    // wrote, valid or broken, so these pins are engine-independent (green
    // pre-merge: extraction is untouched by the vocabulary fix).
    const queries: Array<[string, number, string]> = [
      ['cans/artifacts/code/container-service.rs#configure_runtime', 15, TW.l15],
      ['cans/artifacts/code/container-service.rs#mount_scratch', 22, TW.l22],
      ['cans/artifacts/examples/swarm-agent.rs#LedgerPlugin', 41, '// see: cans/artifacts/examples/swarm-agent.rs#LedgerPlugin'],
      ['cans/artifacts/config/project-structure.txt#kelir-shim', 88, '// see: cans/artifacts/config/project-structure.txt#kelir-shim'],
      ['cans/artifacts/diagrams/four-ring-bus.txt#virtio-shm', 93, '// see: cans/artifacts/diagrams/four-ring-bus.txt#virtio-shm'],
      ['cans/artifacts/diagrams/host-runtime.txt#driver-rustvmm', 98, '// see: cans/artifacts/diagrams/host-runtime.txt#driver-rustvmm'],
    ];
    for (const [q, line, text] of queries) {
      const r = runCli(['refs', q, '--codebase', '--json'], p);
      expect(r.exit).toBe(0);
      const j = parseJsonOut(r.out);
      expect(j.ok).toBe(true);
      expect(j.command).toBe('refs');
      expect(j.node).toBe(q); // the query AS WRITTEN
      expect(j.scanned).toBe(14);
      expect(j.matches).toEqual([{ file: 'src/plugins/trait-wiring.rs', line, text }]);
    }
  });

  test('c2: the TYPO spelling answers its writer line too — the reverse path is a query, not a verdict', () => {
    const p = ws('c2');
    // `check` reports this pointer broken; `refs` still traces WHO writes
    // it — the two commands answer different questions over one engine
    // (the #69 `#federateNope` precedent, pinned here for the #70 typo).
    // The brief's "typo query answers ZERO matches" reading cannot hold
    // under that frozen contract — the typo IS a written pointer — so the
    // zero-match half is pinned through the shape that truly has no
    // writer: `#LedgerCtx`, a name that EXISTS in the target's use-tree
    // but that no source file points at.
    const j = parseJsonOut(
      runCli(['refs', 'cans/artifacts/code/container-service.rs#configure_runtim', '--codebase', '--json'], p).out,
    );
    expect(j.exitCode).toBe(0);
    expect(j.matches).toEqual([
      { file: 'src/plugins/trait-wiring.rs', line: 106, text: TW.l106 },
    ]);
    const z = parseJsonOut(
      runCli(['refs', 'cans/artifacts/examples/swarm-agent.rs#LedgerCtx', '--codebase', '--json'], p).out,
    );
    expect(z.exitCode).toBe(0);
    expect(z.ok).toBe(true);
    expect(z.matches).toEqual([]); // zero matches IS an answer — no writer, no line
  });

  test('c3: the file-level query into container-service.rs answers ALL its pointers, regardless of anchor', () => {
    const p = ws('c3');
    // File-level (no #slug): the three valid trait methods AND the typo
    // all answer — the file is the same; anchors are irrelevant at this
    // query shape (the #66 c2 contract, artifact side).
    const j = parseJsonOut(
      runCli(['refs', 'cans/artifacts/code/container-service.rs', '--codebase', '--json'], p).out,
    );
    expect(j.exitCode).toBe(0);
    expect(j.matches).toEqual([
      { file: 'src/plugins/trait-wiring.rs', line: 15, text: TW.l15 },
      { file: 'src/plugins/trait-wiring.rs', line: 22, text: TW.l22 },
      { file: 'src/plugins/trait-wiring.rs', line: 27, text: TW.l27 },
      { file: 'src/plugins/trait-wiring.rs', line: 106, text: TW.l106 },
    ]);
  });

  test('c4: the empty-metrics advisory pointer answers too — the verdict is the check\'s, never the query\'s', () => {
    const p = ws('c4');
    // The no-target advisory is a CHECK verdict; `refs` traces the writer
    // like any other pointer (the warning class is visible from both
    // directions, never silently skipped).
    const j = parseJsonOut(
      runCli(['refs', 'cans/artifacts/diagrams/empty-metrics.txt#anything', '--codebase', '--json'], p).out,
    );
    expect(j.exitCode).toBe(0);
    expect(j.matches).toEqual([
      { file: 'src/plugins/trait-wiring.rs', line: 115, text: TW.l115 },
    ]);
  });

  test('c5: the file-level .txt queries answer their extended pointer sets — and no .md pointers (tiers never cross)', () => {
    const p = ws('c5');
    // multi-vm-swarm.rs: the two pre-#70 pointers (valid #federate +
    // broken #federateNope) PLUS the two new leaf-tier ones; host-
    // runtime.txt: its two pre-#70 pointers plus the box-tree one.
    const swarm = parseJsonOut(
      runCli(['refs', 'cans/artifacts/examples/multi-vm-swarm.rs', '--codebase', '--json'], p).out,
    );
    expect(swarm.exitCode).toBe(0);
    expect(swarm.matches.map((m: any) => `${m.file}:${m.line}`)).toEqual([
      'src/plugins/artifact-wiring.rs:14',
      'src/plugins/artifact-wiring.rs:36',
      'src/plugins/trait-wiring.rs:75',
      'src/plugins/trait-wiring.rs:80',
    ]);
    const host = parseJsonOut(
      runCli(['refs', 'cans/artifacts/diagrams/host-runtime.txt', '--codebase', '--json'], p).out,
    );
    expect(host.exitCode).toBe(0);
    expect(host.matches.map((m: any) => `${m.file}:${m.line}`)).toEqual([
      'src/plugins/artifact-wiring.rs:21',
      'src/plugins/artifact-wiring.rs:40',
      'src/plugins/trait-wiring.rs:98',
    ]);
  });

  test('c6: the .md regression query still answers its pre-existing matches (and ONLY those)', () => {
    const p = ws('c6');
    // The #66 c1 pin, re-run over the extended fixture: the .md tier is
    // untouched by the #70 vocabularies — same three matches, and no
    // artifact pointer leaks into a corpus query (the non-crossing pin).
    const j = parseJsonOut(runCli(['refs', '01-auth.md#Sessions', '--codebase', '--json'], p).out);
    expect(j.exitCode).toBe(0);
    expect(j.scanned).toBe(14);
    expect(j.matches.map((m: any) => `${m.file}:${m.line}`)).toEqual([
      'src/api/routes.ts:2',
      'src/api/routes.ts:6',
      'src/session.rs:2',
    ]);
  });
});

// ── d: the exit-code ladder (issue class C — engine-independent) ───────────

describe('issue #70 d — the exit ladder: 0 clean / 1 warnings / 2 errors', () => {
  /** The minimal in-test workspace (the #68/#69 minimal-tree pattern): a
   *  cans/ corpus of ONE spec file that checks clean, the codebase block
   *  (RFC §3 defaults), an EMPTY .txt artifact (the warnings-class target),
   *  and — for the exit-2 variant — a one-symbol code artifact. Returns
   *  the PROJECT root (the parent of cans/). */
  function ladderWs(name: string, wiring: string, extra: Record<string, string> = {}): string {
    const project = makeTmpDir(`issue70-contract-${name}`);
    tmps.push(project);
    const put = (rel: string, content: string): void => {
      const target = join(project, rel);
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, content, 'utf8');
    };
    // The corpus: the fixture's own clean index shape (verified: exit 0 on
    // the plain check over every variant below).
    put('cans/00-overview.md', [
      '- Gateway service overview',
      '  - The numbered files spec each plane',
      '  - Cross-plane concerns live in their own document',
      '  - This index answers every back-pointer',
      '',
    ].join('\n'));
    put('cans/_rules.yaml', [
      'references:',
      '  back_pointers: false',
      'codebase:',
      '  enabled: true',
      '  roots: ["."]',
      '  include:',
      '    - "**/*.rs"',
      '    - "**/*.ts"',
      '    - "**/*.js"',
      '    - "**/*.py"',
      '    - "**/*.go"',
      '    - "**/*.c"',
      '    - "**/*.cpp"',
      '  exclude:',
      '    - "**/target/**"',
      '    - "**/node_modules/**"',
      '    - "**/.git/**"',
      '    - "**/dist/**"',
      '  severity: error',
      '',
    ].join('\n'));
    put('cans/artifacts/diagrams/empty.txt', ''); // the EMPTY target
    for (const [rel, content] of Object.entries(extra)) put(rel, content);
    put('src/wiring.rs', wiring);
    return project;
  }

  test('d1: warnings-ONLY — ok:true, errors 0, warnings 1, EXIT CODE 1', () => {
    // The issue's class C, the minimal tree: the ONLY pointer is the
    // empty-metrics class (an anchored pointer at an empty .txt artifact).
    // The advisory is a warning, warnings never dirty `ok`, and the #41
    // exit ladder puts a warnings-only run in band 1 — NOT 0 and NOT 2.
    const p = ladderWs(
      'd1',
      [
        '// Metrics wiring: the empty diagram owns nothing addressable.',
        '// see: cans/artifacts/diagrams/empty.txt#anything',
        '',
      ].join('\n'),
    );
    const r = runCli(['check', '--codebase', '--json'], p);
    expect(r.exit).toBe(1);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect(j.exitCode).toBe(1);
    expect(j.counts.errors).toBe(0);
    expect(j.counts.warnings).toBe(1);
    expect(j.codebase).toBeDefined();
    expect(j.codebase.scanned).toBe(1);
    expect(j.codebase.pointers).toBe(1);
    expect(j.codebase.broken).toBe(0);
    expect(j.codebase.issues).toEqual([]);
    const warn = (j.sections.refs as any[]).filter((i) => i.rule === 'codebase.anchor.no-target');
    expect(warn.length).toBe(1);
    expect(warn[0]!.file).toBe('src/wiring.rs');
  });

  test('d2: warnings + ONE broken typo — the error band wins, EXIT CODE 2', () => {
    // Same tree plus a one-symbol code artifact and one typo pointer at
    // it: the typo target HAS vocabulary (`pub fn boot`), so the miss is a
    // truthful AnchorNotFound ERROR (not another advisory) — errors trump
    // warnings in the ladder, exit 2, ok:false.
    const p = ladderWs(
      'd2',
      [
        '// Metrics wiring: the empty diagram owns nothing addressable.',
        '// see: cans/artifacts/diagrams/empty.txt#anything',
        '// The boot path is a typo kept broken for the exit-2 variant:',
        '// see: cans/artifacts/code/boot.rs#bootNope',
        '',
      ].join('\n'),
      { 'cans/artifacts/code/boot.rs': 'pub fn boot() {}\n' },
    );
    const r = runCli(['check', '--codebase', '--json'], p);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(false);
    expect(j.exitCode).toBe(2);
    expect(j.counts.errors).toBe(1);
    expect(j.counts.warnings).toBe(1); // the advisory still rides along
    expect(j.codebase.broken).toBe(1);
    expect(j.codebase.issues).toEqual([
      {
        type: 'CodebaseBrokenReference',
        file: 'src/wiring.rs',
        line: 4,
        raw: 'see: cans/artifacts/code/boot.rs#bootNope',
        targetFile: 'cans/artifacts/code/boot.rs',
        targetSlug: 'bootNope',
        reason: 'AnchorNotFound',
      },
    ]);
  });

  test('d3: the CLEAN spelling — EXIT CODE 0, not a warning in sight', () => {
    // The same pointer, spelled the way the advisory prescribes: file-
    // level (no anchor). Nothing to verify, nothing to warn about — band 0.
    const p = ladderWs(
      'd3',
      [
        '// Metrics wiring: file-level ref only — the empty diagram owns',
        '// nothing addressable, and a file-level ref is valid on any target.',
        '// see: cans/artifacts/diagrams/empty.txt',
        '',
      ].join('\n'),
    );
    const r = runCli(['check', '--codebase', '--json'], p);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect(j.exitCode).toBe(0);
    expect(j.counts.errors).toBe(0);
    expect(j.counts.warnings).toBe(0);
    expect(j.codebase.pointers).toBe(1);
    expect(j.codebase.broken).toBe(0);
  });
});

// ── e: the corpus band is untouched ─────────────────────────────────────────

describe('issue #70 e — the extension adds artifacts and a source, never a corpus file', () => {
  test('e1: the plain check stays clean with NO codebase key and the #68 corpus counts unchanged', () => {
    const p = ws('e1');
    // The committed _rules.yaml carries `codebase.enabled: true`, so the
    // corpus-band comparison strips the block first (the #68 c1 / #69 d1
    // variant: aliasing tier kept on — the plugin specs stay loaded —
    // redundancy knobs the README documents, no codebase block). Over that
    // workspace the plain check never scans: the #70 artifact targets and
    // the trait-wiring.rs source are invisible to the corpus band, so the
    // #68 c1 pins hold verbatim: exit 0, no codebase key, refs 11, files 9.
    writeFileSync(
      join(p, 'cans', '_rules.yaml'),
      [
        'references:',
        '  back_pointers: false',
        '  aliasing:',
        '    enabled: true',
        '    include:',
        '      - plugins/*.md',
        'redundancy:',
        '  word_frequency_threshold: 5',
        '  fuzzy: false',
        '',
      ].join('\n'),
      'utf8',
    );
    const r = runCli(['check', '--json'], p);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect('codebase' in j).toBe(false);
    expect(j.counts.errors).toBe(0);
    expect(j.counts.warnings).toBe(0);
    expect(j.refs).toEqual({ total: 11, broken: 0, deepHops: 0 });
    expect(j.summary.files).toBe(9);
  });
});
