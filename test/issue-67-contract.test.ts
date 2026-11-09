/**
 * Issue #67 — the CONTRACT suite: `cans check --codebase` false
 * "anchor not found" positives, pinned end-to-end against the extended
 * `test/fixtures/codebase-workspace/` fixture (its README.md is the
 * line-authoritative oracle — every pointer, its line, its verdict).
 *
 * THE BUGS (135 false positives on the kelir repo, 748 valid pointers):
 *
 *   Bug 1 (127) — the frozen #66 anchor class `[A-Za-z0-9_-]+` truncates
 *             anchors at `(`, `)`, `,`, `:`, `/`, `^`. Real anchors that
 *             exist verbatim as spec headings (`#Invariants-and-policy-
 *             (transaction)`, `#FsInodeAttr-carries-full-mode,-uid,-gid,
 *             -size,-content`, `#UID/GID-mapping-isolation`,
 *             `#Dynamic-W^X-JIT-execution-mediation`,
 *             `#Native-checkpoint-plane-(kelir-core::checkpoint)`) were
 *             reported broken.
 *   Bug 2 (8) — spec nodes carrying their pointer as a TITLE SUFFIX
 *             (`- Connection parking on suspend: see: artifacts/…`) never
 *             resolve: the matcher slugified the whole node line, while
 *             the code points at the bare title.
 *
 * THE FROZEN FIX SPEC this suite is written against (the engine half
 * lands on fix/issue-67-engine):
 *
 *   1. Anchor capture widens to the full slug alphabet (`[^\s#]+`,
 *      whitespace/`#`-terminated); a trailing run of `)]},.;:!?'"’”…` is
 *      stripped from the captured anchor, EXCEPT closers backed by an
 *      unmatched opener of `()[]{}` are restored (so
 *      `Invariants-and-policy-(transaction)` survives intact while glued
 *      prose closers like `Sessions);` clean to `Sessions`).
 *      Empty-after-strip → no anchor (file-level pointer). `raw` stays
 *      the verbatim matched span.
 *   2. Node-title matching compares BOTH the full node text AND the text
 *      with a trailing `: see: <token>` suffix stripped.
 *   3. Genuinely broken anchors are STILL reported — no over-tolerance.
 *
 * WHAT EACH BLOCK PINS (all blackbox via the real CLI, the issue-66
 * integration harness pattern; the fixture is driven from a fresh tmp
 * copy exactly like test/issue66-integration.test.ts):
 *
 *   a ....... the check scan over the extended fixture: config-on
 *             16 scanned / 54 pointers / EXACTLY the 8 broken — the 2
 *             pre-#67 true records plus, since #69, the 3 deliberate
 *             artifact ones, since #70, the 2 typos and, since #71, the
 *             phrase typo — zero broken
 *             refs for every new kelir-shaped anchor, both bug classes
 *             (a2 repeats it under the pure-default include list: 14
 *             files / 52 pointers / 9 broken — the yaml pointer
 *             invisible; the #68 extension keeps the plugin tier on in
 *             the variant so its five pointers stay in scope)
 *   b ....... Bug 1 on the REVERSE path: `cans refs <node> --codebase`
 *             finds every punctuation-bearing anchor, including the
 *             glued-closer spellings (pre-fix these queries refuse as
 *             malformed or answer nothing — the truncation also broke
 *             the reverse direction)
 *   c ....... Bug 2: the `: see:`-suffixed nodes resolve by their bare
 *             titles (check scan + reverse query), and the file-level
 *             query answers all ten pointers into 09-plugins.md
 *   d ....... no over-tolerance (spec clause 3): the pre-existing
 *             `#Qutas` typo and `09-observability.md` FileNotFound are
 *             STILL the only broken records; a punctuated NEAR MISS
 *             appended to a source file is still AnchorNotFound; a
 *             truncated spelling answers NOTHING on the reverse path
 *             (no fuzzy healing); and the extended corpus itself stays
 *             check-clean (the extension smuggles in no corpus finding)
 *   e ....... the extraction wire shape (spec clause 1) at the unit
 *             seam, over the fixture's own bytes: targetSlug stripped/
 *             restored per the closer rule, raw verbatim, targetFile as
 *             written (cans/ prefix kept)
 *
 * HONESTY NOTE: on the contract branch ALONE (pre-engine-merge) the
 * new-behavior blocks are RED by design — the fixture reproduces the
 * bugs (13 broken where 2 belong: the 2 true + 11 false). This suite
 * turns green against the merged engine that implements the frozen
 * spec above; the two pre-#67 broken records are pinned byte-exactly so
 * the merge can never silently heal (or duplicate) them.
 *
 * THE #70 SHIFT (this branch — test/issue-70-contract.test.ts owns the
 * extension): the fixture grew again (the trait-wiring .rs source, +18
 * pointers, +2 typos, +1 warning), so the census pins moved once more —
 * a1 13→14 scanned / 32→50 pointers / 5→7 broken, a2 11→12 files /
 * 30→48 pointers / 6→8 broken, c1 5→7, d3 34→52 pointers / 7→9 broken.
 * On THIS branch alone (before the fix/issue-70-engine merge) the
 * engine-dependent pins are red again (a1/a2/c1/d3 read the fifteen
 * VALID #70 pointers as false AnchorNotFound too: config-on 22 broken,
 * defaults 23 — verified by running). The engine-independent pins (b1–b5
 * reverse queries, c2–c5, d1/d2/d4/d5, e1–e3 extraction wire shape)
 * stay green throughout.
 *
 * THE #71 SHIFT (test/issue-71-contract.test.ts owns the extension): the
 * fixture grew the trap/transport phrase carriers (+2 scanned, +4
 * pointers, +1 phrase typo), so the census pins moved once more — a1
 * 14→16 scanned / 50→54 pointers / 7→8 broken, a2 12→14 files / 48→52
 * pointers / 8→9 broken, c1 7→8, d3 52→56 pointers / 9→10 broken.
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
  const tmp = makeTmpDir(`issue67-contract-${name}`);
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

/** routes.ts:3 — the pre-#67 broken slug, UNCHANGED by the #67 fix: the
 *  regression guard at the heart of spec clause 3 (no over-tolerance). */
const BROKEN_ANCHOR = {
  type: 'CodebaseBrokenReference',
  file: 'src/api/routes.ts',
  line: 3,
  raw: 'see: 03-storage.md#Qutas',
  targetFile: '03-storage.md',
  targetSlug: 'Qutas',
  reason: 'AnchorNotFound',
};

/** quota.py:7 — the pre-#67 broken file, UNCHANGED by the #67 fix. */
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
 *  missing-artifact spelling (#69). Since the #70 extension the
 *  `cans/artifacts/code/` directory exists (it holds the REAL
 *  container-service.rs), but `plugin-trait.rs` still does not — the
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

/** trait-wiring.rs:106 — the issue #70 trait-method typo (a one-letter
 *  miss of the grammar-v2 `configure_runtime` token; kept broken on
 *  purpose, pinned by test/issue-70-contract.test.ts). */
const BROKEN_70_TYPO_METHOD = {
  type: 'CodebaseBrokenReference',
  file: 'src/plugins/trait-wiring.rs',
  line: 106,
  raw: 'see: cans/artifacts/code/container-service.rs#configure_runtim',
  targetFile: 'cans/artifacts/code/container-service.rs',
  targetSlug: 'configure_runtim',
  reason: 'AnchorNotFound',
};

/** trait-wiring.rs:109 — the issue #70 import-name typo (a one-letter
 *  miss of the leaf-tier `LedgerPlugin` token). */
const BROKEN_70_TYPO_NAME = {
  type: 'CodebaseBrokenReference',
  file: 'src/plugins/trait-wiring.rs',
  line: 109,
  raw: 'see: cans/artifacts/examples/swarm-agent.rs#LedgerPlugn',
  targetFile: 'cans/artifacts/examples/swarm-agent.rs',
  targetSlug: 'LedgerPlugn',
  reason: 'AnchorNotFound',
};

/** trap.rs:7 — the issue #71 PHRASE typo (the SINGULAR near miss of the
 *  trap-flow diagram's line-8 entry `Kernel seccomp-unotify triggers`),
 *  kept broken on purpose, pinned by test/issue-71-contract.test.ts —
 *  the #71 extension of the fixture added it; it slots in LAST (trap.rs
 *  sorts after quota.py). */
const BROKEN_71_TYPO_PHRASE = {
  type: 'CodebaseBrokenReference',
  file: 'src/trap.rs',
  line: 7,
  raw: 'see: cans/artifacts/diagrams/trap-flow.txt#Kernel-seccomp-unotify-trigger',
  targetFile: 'cans/artifacts/diagrams/trap-flow.txt',
  targetSlug: 'Kernel-seccomp-unotify-trigger',
  reason: 'AnchorNotFound',
};

/** The broken records, in the contract's deterministic order (file asc,
 *  line asc): EVERY issue-#67 pointer — both bug classes — is VALID, so
 *  the broken set is the pre-#67 pair plus (since the #69 extension) the
 *  three deliberate artifact records, (since #70) the two #70 typos and
 *  (since #71) the phrase typo LAST (trait-wiring.rs sorts after
 *  artifact-wiring.rs, so they slot in exactly here; trap.rs sorts after
 *  quota.py). */
const ORACLE_ISSUES = [
  BROKEN_ANCHOR,
  BROKEN_ARTIFACT_SYMBOL,
  BROKEN_ARTIFACT_HEADING,
  BROKEN_ARTIFACT_FILE,
  BROKEN_70_TYPO_METHOD,
  BROKEN_70_TYPO_NAME,
  BROKEN_FILE,
  BROKEN_71_TYPO_PHRASE,
];

/** artifact-wiring.rs:28 — the #69 schematic pointer into the workspace's
 *  own rules file. VALID against the committed fixture, but BROKEN in the
 *  pure-default a2 variant: that subtest rewrites _rules.yaml WITHOUT a
 *  codebase block, and the artifact tier validates the file's CURRENT
 *  content — the rewrite deletes the very key `codebase.enabled` the
 *  pointer names, so it honestly breaks (one MORE broken than config-on). */
const BROKEN_RULES_KEY = {
  type: 'CodebaseBrokenReference',
  file: 'src/plugins/artifact-wiring.rs',
  line: 28,
  raw: 'see: cans/_rules.yaml#codebase.enabled',
  targetFile: 'cans/_rules.yaml',
  targetSlug: 'codebase.enabled',
  reason: 'AnchorNotFound',
};

const DEFAULTS_ORACLE_ISSUES = [
  BROKEN_ANCHOR,
  BROKEN_RULES_KEY,
  BROKEN_ARTIFACT_SYMBOL,
  BROKEN_ARTIFACT_HEADING,
  BROKEN_ARTIFACT_FILE,
  BROKEN_70_TYPO_METHOD,
  BROKEN_70_TYPO_NAME,
  BROKEN_FILE,
  BROKEN_71_TYPO_PHRASE,
];

/** The four source files carrying the #67 pointers — none may appear in
 *  the issues (the a1 no-false-positive pin, re-scoped by #69: the new
 *  artifact-wiring.rs source DOES carry deliberate broken records, so the
 *  file-level `src/plugins/` prefix guard no longer holds). */
const S67_SOURCE_FILES = [
  'src/plugins/transaction.rs',
  'src/plugins/checkpoint.go',
  'src/plugins/ingress.py',
  'src/plugins/mounts.yaml',
];

// The fixture's line-authoritative texts (README oracle), reused by the
// reverse-query assertions below.
const GO_L11 = '/* (see: cans/09-plugins.md#Invariants-and-policy-(transaction)) */';
const GO_L14 = '// Glued prose closers never reach the anchor: see: 09-plugins.md#UID/GID-mapping-isolation);';
const PY_L3 = '# Connection parking on suspend: see: cans/09-plugins.md#Connection-parking-on-suspend';
const PY_L7 = '# L7 pgwire rewrite and 2PC commit: see: cans/09-plugins.md#L7-pgwire-rewrite-and-2PC-commit';
const PY_L11 = '# CoW swarm mesh federation: see: cans/09-plugins.md#CoW-swarm-mesh-federation';
const YAML_L2 = 'fsinode_mode: full   # see: 09-plugins.md#FsInodeAttr-carries-full-mode,-uid,-gid,-size,-content';
const RS_L2 = '// Begin, commit, and rollback paths: see: cans/09-plugins.md#Invariants-and-policy-(transaction)';
const RS_L3 = '// Inode metadata is authoritative: see: 09-plugins.md#FsInodeAttr-carries-full-mode,-uid,-gid,-size,-content';
const RS_L4 = '// Namespace identity: see: 09-plugins.md#UID/GID-mapping-isolation';
const RS_L5 = '// JIT gate: see: 09-plugins.md#Dynamic-W^X-JIT-execution-mediation';

/** The e1-shaped rules (no codebase block) + the fixture's own redundancy
 *  knobs — the corpus-clean shape the #66 suite pins, extended with the
 *  knobs the README documents for the kelir-shaped extension, and (issue
 *  #68) the fixture's plugin-tier wiring so the three cans/plugins/*.md
 *  specs stay loaded: without it the #68 pointers would be FileNotFound in
 *  this variant, a different failure than the include-list dimension a2
 *  isolates. */
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

// ── a: the check scan — zero broken refs for every new anchor ──────────────

describe('issue #67 a — check --codebase: the kelir-shaped anchors all resolve', () => {
  test('a1: config-on — 16 scanned / 54 pointers / EXACTLY the 8 broken (both #67 bug classes clean)', () => {
    const p = ws('a1');
    const r = runCli(['check', '--codebase', '--json'], p);
    expect(r.exit).toBe(2); // severity: error → the error band (8 true findings)
    const j = parseJsonOut(r.out);
    expect(j.codebase).toBeDefined();
    expect(j.codebase.scanned).toBe(16); // 9 pre-#68 + the three #68 .rs sources + the artifact-wiring .rs source (#69) + the trait-wiring .rs source (#70) + the trap/transport carriers (#71)
    expect(j.codebase.pointers).toBe(54); // 21 pre-#68 + the kelir five (#68) + the six artifact pointers (#69) + the eighteen #70 pointers + the four #71 pointers
    expect(j.codebase.broken).toBe(8);
    // THE pin: the broken set is byte-exactly the seven records above — none
    // of the 11 new kelir-shaped pointers (4 Bug-1 spellings in transaction.rs, 3 in
    // checkpoint.go incl. both glued-closer cases, 3 Bug-2 suffix targets in
    // ingress.py, 1 yaml comma anchor) is reported broken; the issue #68
    // extension's five colon-anchor pointers (db-proxy.rs, profile.rs,
    // wire-ingress.rs) are in the census too and resolve post-#68. The three
    // #69 records and the two #70 typos are DELIBERATE breaks (issues #69
    // and #70's own repro — the artifact-wiring.rs and trait-wiring.rs
    // sources), not regressions, hence the re-scoped
    // file guard below (the old `src/plugins/` prefix guard no longer holds).
    expect(j.codebase.issues).toEqual(ORACLE_ISSUES);
    expect((j.codebase.issues as any[]).every((i) => !S67_SOURCE_FILES.includes(i.file))).toBe(true);
  });

  test('a2: pure defaults (no config block) — 14 files / 52 pointers / 9 broken (the 8 + the rules-key pointer), yaml pointer invisible', () => {
    const p = ws('a2');
    writeFileSync(join(p, 'cans', '_rules.yaml'), RULES_NO_CODEBASE, 'utf8');
    const r = runCli(['check', '--codebase', '--json'], p);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    // The RFC §3 default include list has no *.yaml: src/net.yaml AND
    // src/plugins/mounts.yaml stay out — 12 files, 48 pointers. EIGHT
    // broken, one more than the config-on run: this variant's rules
    // rewrite drops the codebase block, and the #69 schematic pointer
    // `cans/_rules.yaml#codebase.enabled` validates against the rules
    // file's CURRENT content — the rewrite deleted the key it names, so
    // the pointer honestly breaks (every non-yaml #67 pointer still
    // resolves; the #68 plugin tier stays on in the variant, so the kelir
    // five are in scope and resolve post-#68; the six #69 artifact
    // pointers and the eighteen #70 pointers live in .rs sources, covered
    // by the default *.rs include).
    expect(j.codebase.scanned).toBe(14);
    expect(j.codebase.pointers).toBe(52);
    expect(j.codebase.broken).toBe(9);
    expect(j.codebase.issues).toEqual(DEFAULTS_ORACLE_ISSUES);
    expect((j.codebase.issues as any[]).some((i) => i.file === 'src/plugins/mounts.yaml')).toBe(false);
  });
});

// ── b: Bug 1 on the reverse path ────────────────────────────────────────────

describe('issue #67 b — refs <node> --codebase finds the punctuation anchors', () => {
  test('b1: the paren anchor answers BOTH its spellings — the plain and the glued closer', () => {
    const p = ws('b1');
    const r = runCli(['refs', '09-plugins.md#Invariants-and-policy-(transaction)', '--codebase', '--json'], p);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect(j.node).toBe('09-plugins.md#Invariants-and-policy-(transaction)'); // AS WRITTEN
    expect(j.scanned).toBe(16); // 14 post-#70 + the two #71 carriers
    // The glued `))` spelling (checkpoint.go:11) cleans/restores to the same
    // anchor, so both pointers answer. Order: file asc, line asc.
    expect(j.matches).toEqual([
      { file: 'src/plugins/checkpoint.go', line: 11, text: GO_L11 },
      { file: 'src/plugins/transaction.rs', line: 2, text: RS_L2 },
    ]);
  });

  test('b2: the comma-list anchor answers the Rust and the YAML spellings', () => {
    const p = ws('b2');
    const j = parseJsonOut(
      runCli(
        ['refs', '09-plugins.md#FsInodeAttr-carries-full-mode,-uid,-gid,-size,-content', '--codebase', '--json'],
        p,
      ).out,
    );
    expect(j.exitCode).toBe(0);
    expect(j.matches).toEqual([
      { file: 'src/plugins/mounts.yaml', line: 2, text: YAML_L2 },
      { file: 'src/plugins/transaction.rs', line: 3, text: RS_L3 },
    ]);
  });

  test('b3: the slash anchor answers the plain and the glued-prose-closer spellings', () => {
    const p = ws('b3');
    const j = parseJsonOut(
      runCli(['refs', '09-plugins.md#UID/GID-mapping-isolation', '--codebase', '--json'], p).out,
    );
    expect(j.exitCode).toBe(0);
    // checkpoint.go:14 glues `);` onto the anchor — prose closers strip, and
    // the pointer still answers the query.
    expect(j.matches).toEqual([
      { file: 'src/plugins/checkpoint.go', line: 14, text: GO_L14 },
      { file: 'src/plugins/transaction.rs', line: 4, text: RS_L4 },
    ]);
  });

  test('b4: the caret anchor answers its single occurrence', () => {
    const p = ws('b4');
    const j = parseJsonOut(
      runCli(['refs', '09-plugins.md#Dynamic-W^X-JIT-execution-mediation', '--codebase', '--json'], p).out,
    );
    expect(j.exitCode).toBe(0);
    expect(j.matches).toEqual([{ file: 'src/plugins/transaction.rs', line: 5, text: RS_L5 }]);
  });

  test('b5: the ::-containing anchor with a backed closer answers its occurrence', () => {
    const p = ws('b5');
    const j = parseJsonOut(
      runCli(
        ['refs', '10-lifecycle.md#Native-checkpoint-plane-(kelir-core::checkpoint)', '--codebase', '--json'],
        p,
      ).out,
    );
    expect(j.exitCode).toBe(0);
    expect(j.matches).toEqual([
      {
        file: 'src/plugins/checkpoint.go',
        line: 7,
        text: 'see: cans/10-lifecycle.md#Native-checkpoint-plane-(kelir-core::checkpoint)',
      },
    ]);
  });
});

// ── c: Bug 2 — the : see:-suffixed nodes ────────────────────────────────────

describe('issue #67 c — the : see:-suffixed spec nodes resolve by their bare titles', () => {
  test('c1: none of the three suffix-targeting pointers is reported broken (the a1 pin, made explicit)', () => {
    const p = ws('c1');
    const j = parseJsonOut(runCli(['check', '--codebase', '--json'], p).out);
    expect(j.codebase.broken).toBe(8); // the 2 true + the 3 deliberate #69 artifact records + the 2 #70 typos + the #71 phrase typo
    const suffixRaws = [
      'see: cans/09-plugins.md#Connection-parking-on-suspend',
      'see: cans/09-plugins.md#L7-pgwire-rewrite-and-2PC-commit',
      'see: cans/09-plugins.md#CoW-swarm-mesh-federation',
    ];
    for (const raw of suffixRaws) {
      expect((j.codebase.issues as any[]).some((i) => i.raw === raw)).toBe(false);
    }
  });

  test('c2: Connection parking on suspend — the reverse query finds the source pointer', () => {
    const p = ws('c2');
    const j = parseJsonOut(
      runCli(['refs', '09-plugins.md#Connection-parking-on-suspend', '--codebase', '--json'], p).out,
    );
    expect(j.exitCode).toBe(0);
    expect(j.matches).toEqual([{ file: 'src/plugins/ingress.py', line: 3, text: PY_L3 }]);
  });

  test('c3: L7 pgwire rewrite and 2PC commit — the reverse query finds the source pointer', () => {
    const p = ws('c3');
    const j = parseJsonOut(
      runCli(['refs', '09-plugins.md#L7-pgwire-rewrite-and-2PC-commit', '--codebase', '--json'], p).out,
    );
    expect(j.exitCode).toBe(0);
    expect(j.matches).toEqual([{ file: 'src/plugins/ingress.py', line: 7, text: PY_L7 }]);
  });

  test('c4: CoW swarm mesh federation — the reverse query finds the source pointer', () => {
    const p = ws('c4');
    const j = parseJsonOut(
      runCli(['refs', '09-plugins.md#CoW-swarm-mesh-federation', '--codebase', '--json'], p).out,
    );
    expect(j.exitCode).toBe(0);
    expect(j.matches).toEqual([{ file: 'src/plugins/ingress.py', line: 11, text: PY_L11 }]);
  });

  test('c5: the file-level query answers all ten pointers into 09-plugins.md (every anchor class)', () => {
    const p = ws('c5');
    const j = parseJsonOut(runCli(['refs', '09-plugins.md', '--codebase', '--json'], p).out);
    expect(j.exitCode).toBe(0);
    // File asc, line asc: the two checkpoint.go (glued `))` + glued `);`),
    // the three ingress.py suffix targets, the mounts.yaml comma anchor, the
    // four transaction.rs punctuation spellings — punctuation never splits a
    // pointer off its file-level answer.
    expect(j.matches).toEqual([
      { file: 'src/plugins/checkpoint.go', line: 11, text: GO_L11 },
      { file: 'src/plugins/checkpoint.go', line: 14, text: GO_L14 },
      { file: 'src/plugins/ingress.py', line: 3, text: PY_L3 },
      { file: 'src/plugins/ingress.py', line: 7, text: PY_L7 },
      { file: 'src/plugins/ingress.py', line: 11, text: PY_L11 },
      { file: 'src/plugins/mounts.yaml', line: 2, text: YAML_L2 },
      { file: 'src/plugins/transaction.rs', line: 2, text: RS_L2 },
      { file: 'src/plugins/transaction.rs', line: 3, text: RS_L3 },
      { file: 'src/plugins/transaction.rs', line: 4, text: RS_L4 },
      { file: 'src/plugins/transaction.rs', line: 5, text: RS_L5 },
    ]);
  });
});

// ── d: no over-tolerance (spec clause 3) ────────────────────────────────────

describe('issue #67 d — genuinely broken anchors are still reported', () => {
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

  test('d3: punctuated NEAR MISSES appended to a source file are still AnchorNotFound', () => {
    const p = ws('d3');
    // Two new near misses, both shaped exactly like the Bug-1 anchors: a
    // misspelled paren anchor and a truncated comma anchor. Widening the
    // alphabet must not widen the VERDICT — neither matches any node.
    const rs = join(p, 'src', 'plugins', 'transaction.rs');
    writeFileSync(
      rs,
      readFileSync(rs, 'utf8') +
        '\n// see: 09-plugins.md#Invariants-and-policy-(transakshun)\n// see: 09-plugins.md#FsInodeAttr-carries-full-mode,-uid\n',
      'utf8',
    );
    const r = runCli(['check', '--codebase', '--json'], p);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.codebase.pointers).toBe(56); // 54 + the two appended
    expect(j.codebase.broken).toBe(10); // the 8 fixture broken + the 2 near misses
    const near = (j.codebase.issues as any[]).filter((i) => i.file === 'src/plugins/transaction.rs');
    expect(near.map((i) => [i.line, i.targetSlug, i.reason])).toEqual([
      [11, 'Invariants-and-policy-(transakshun)', 'AnchorNotFound'],
      [12, 'FsInodeAttr-carries-full-mode,-uid', 'AnchorNotFound'],
    ]);
  });

  test('d4: a truncated spelling answers NOTHING on the reverse path — no fuzzy healing', () => {
    const p = ws('d4');
    const r = runCli(['refs', '09-plugins.md#Invariants-and-policy', '--codebase', '--json'], p);
    expect(r.exit).toBe(0); // zero matches is an answer, not a failure
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect(j.matches).toEqual([]);
  });

  test('d5: the extended corpus itself stays check-clean (the extension smuggles in no corpus finding)', () => {
    const p = ws('d5');
    // No codebase block, no flag: the plain pre-#66 check over the corpus
    // with the extension (two new spec files, three artifact refs, the
    // suffix nodes, and — #68 — the three plugin-tier specs with their hub
    // refs, loaded through the variant's aliasing block) — exit 0, no
    // codebase key.
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

describe('issue #67 e — extraction: full-alphabet capture, closer strip/restore, verbatim raw', () => {
  test('e1: checkpoint.go — the :: anchor intact, the glued )) restored, the glued ); stripped', () => {
    const out = extractCodebasePointers(readFixture('codebase-workspace', 'src', 'plugins', 'checkpoint.go'));
    expect(out.length).toBe(3);
    // Line 7: the ::-containing anchor with a closer backed by its opener —
    // captured whole.
    expect(out[0]).toEqual({
      line: 7,
      raw: 'see: cans/10-lifecycle.md#Native-checkpoint-plane-(kelir-core::checkpoint)',
      targetFile: 'cans/10-lifecycle.md', // as written (cans/ prefix kept)
      targetSlug: 'Native-checkpoint-plane-(kelir-core::checkpoint)',
    });
    // Line 11: raw keeps the VERBATIM matched span — the glued `))` included
    // — while the captured anchor strips the closer run and restores the one
    // `)` backed by the unmatched `(`.
    expect(out[1]).toEqual({
      line: 11,
      raw: 'see: cans/09-plugins.md#Invariants-and-policy-(transaction))',
      targetFile: 'cans/09-plugins.md',
      targetSlug: 'Invariants-and-policy-(transaction)',
    });
    // Line 14: glued PROSE closers `);` — no unmatched opener, nothing to
    // restore: they strip from the anchor, raw keeps them.
    expect(out[2]).toEqual({
      line: 14,
      raw: 'see: 09-plugins.md#UID/GID-mapping-isolation);',
      targetFile: '09-plugins.md',
      targetSlug: 'UID/GID-mapping-isolation',
    });
  });

  test('e2: the four transaction.rs spellings capture whole, punctuation and all', () => {
    const out = extractCodebasePointers(readFixture('codebase-workspace', 'src', 'plugins', 'transaction.rs'));
    expect(out.length).toBe(4);
    expect(out.map((p) => [p.line, p.targetSlug])).toEqual([
      [2, 'Invariants-and-policy-(transaction)'],
      [3, 'FsInodeAttr-carries-full-mode,-uid,-gid,-size,-content'],
      [4, 'UID/GID-mapping-isolation'],
      [5, 'Dynamic-W^X-JIT-execution-mediation'],
    ]);
    // The paren anchor ends in a closer backed by its opener — raw and slug
    // agree byte-for-byte.
    expect(out[0]!.raw).toBe('see: cans/09-plugins.md#Invariants-and-policy-(transaction)');
    expect(out[0]!.targetFile).toBe('cans/09-plugins.md');
  });

  test('e3: the Bug-2 pointers and the yaml comma pointer extract with their whole anchors', () => {
    const py = extractCodebasePointers(readFixture('codebase-workspace', 'src', 'plugins', 'ingress.py'));
    expect(py.map((p) => [p.line, p.targetSlug])).toEqual([
      [3, 'Connection-parking-on-suspend'],
      [7, 'L7-pgwire-rewrite-and-2PC-commit'],
      [11, 'CoW-swarm-mesh-federation'],
    ]);
    const yaml = extractCodebasePointers(readFixture('codebase-workspace', 'src', 'plugins', 'mounts.yaml'));
    expect(yaml.length).toBe(1);
    expect(yaml[0]).toEqual({
      line: 2,
      raw: 'see: 09-plugins.md#FsInodeAttr-carries-full-mode,-uid,-gid,-size,-content',
      targetFile: '09-plugins.md',
      targetSlug: 'FsInodeAttr-carries-full-mode,-uid,-gid,-size,-content',
    });
  });
});
