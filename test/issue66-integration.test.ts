/**
 * Issue #66 — integration: the codebase inbound-references scanner END-TO-END
 * on the merged engine (core/codebase.ts) + CLI (check.ts / refs.ts) halves,
 * driven blackbox against the real CLI and the `test/fixtures/
 * codebase-workspace/` fixture (its README.md is the line-authoritative
 * oracle this suite pins — every pointer, its line, its verdict).
 *
 * The contract under test (RFC "Codebase Inbound References" + the frozen
 * cross-agent types in src/types.ts):
 *
 *   a ....... `check --codebase` on a broken-pointer workspace: non-zero
 *             exit, the additive top-level `codebase` JSON block with
 *             issues[] entries carrying EXACTLY { type, file, line, raw,
 *             targetFile, targetSlug, reason }, and the broken counts
 *             matching the fixture oracle (issue #67 extended the fixture,
 *             issue #68 extended it again, issue #69 extended it a third
 *             time with the artifact-target tier, issue #70 extended it a
 *             fourth time with the grammar-v2/leaf-tier shapes, and issue
 *             #71 extended it a fifth time with the phrase-entry carriers:
 *             16 scanned / 54 pointers / 8 broken: AnchorNotFound on the
 *             `#Qutas` typo, FileNotFound on the missing
 *             `09-observability.md`, plus the three deliberate #69
 *             artifact records, the two #70 typos and the #71 phrase typo;
 *             every #67/#68 pointer, the three valid #69 artifact
 *             pointers, the fifteen valid #70 pointers AND the three valid
 *             #71 phrase/control pointers is VALID; see the
 *             issue-67/-68/-69/-70/-71 contract suites)
 *   b ....... after fixing the broken pointers IN THE TMP COPY (all eight
 *             since #71: the two pre-existing, the three deliberate
 *             artifact ones, the two #70 typos and the #71 phrase typo) the
 *             same command exits
 *             0 with `codebase.issues` empty — silent rot is a diff, not a
 *             life sentence
 *   c ....... `refs "<file>#<slug>" --codebase` lists the exact fixture
 *             hits (file asc, line asc, the line text as written) and exits
 *             0; a file-level query answers every anchor; a no-match query
 *             is exit 0 with zero matches (an empty answer is an answer)
 *   d ....... `refs` without `--codebase` refuses non-zero with guidance
 *             (§20 — a flag that silently does nothing is a typo hiding in
 *             plain sight)
 *   e ....... scanner-OFF workspace (no `codebase` block, no flag): plain
 *             `check --json` has NO `codebase` key — the pre-#66 wire
 *             shape, byte-for-byte (the additive-block contract)
 *   f ....... flag-on with NO codebase config block still scans (the
 *             defaults): the RFC §3 code-extension set only — 14 files /
 *             52 pointers / 9 broken (the 8 + the `cans/_rules.yaml#
 *             codebase.enabled` pointer, which breaks HERE because the
 *             variant's own rules rewrite drops the codebase block the
 *             anchor names — the artifact tier validates the file's
 *             CURRENT content) — proving both the default include list
 *             (no `*.yaml`) and that the scan itself needs no config (the
 *             #68 plugin tier stays on in the variant so the fixture's
 *             cans/plugins/*.md corpus keys keep resolving; the #69/#70/
 *             #71 artifact pointers live in the .rs sources, covered by the
 *             default *.rs include)
 *
 * DELIBERATE DEVIATION (the suite's one, by design): the RFC's example text
 * shows exit code 1 for a broken-pointer run; this repo's error-band
 * convention is exit 2 for ANY error-level finding (`0` clean · `1`
 * warnings · `2` errors — the check contract everywhere else), and the
 * fixture ships `severity: error`. The suite pins exit 2. Everything else
 * follows the frozen contract verbatim.
 *
 * Runtime-neutral: imports the test facade, never 'bun:test' directly; CLI
 * runs are blackbox spawns via ./runtime.ts (CANS_ROOT pinned empty so the
 * walk-up resolution lands on the intended workspace).
 */
import { describe, test, expect, afterEach } from './testing.ts';
import { join } from 'path';
import { readFileSync, writeFileSync } from 'fs';

import { spawnCli } from './runtime.ts';
import { makeTmpDir, cleanTmpDir, copyFixtureToTmp } from './helpers.ts';

// ── harness ──────────────────────────────────────────────────────────────────

const tmps: string[] = [];

/** Fresh copy of the fixture into tmp: <tmp>/codebase-workspace/{cans,src}. */
function ws(name: string): string {
  const tmp = makeTmpDir(`issue66-integration-${name}`);
  tmps.push(tmp);
  return copyFixtureToTmp('codebase-workspace', tmp);
}

/** Blackbox spawn pinned to the copied project root. CANS_ROOT is pinned
 *  EMPTY so resolveWorkspaceRoot walks up from cwd and lands on the copied
 *  fixture's cans/ — never some ancestor workspace (the issue65 pattern). */
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

// ── the fixture oracle, as numbers and records ───────────────────────────────
// (test/fixtures/codebase-workspace/README.md is the human-readable source
// of these — keep the two in sync; the files as committed are authoritative.)

/** routes.ts:3 — the broken slug: file resolves, `Qutas` matches no node of
 *  03-storage.md (near miss of Quotas → suggestion, never a pass). */
const BROKEN_ANCHOR = {
  type: 'CodebaseBrokenReference',
  file: 'src/api/routes.ts',
  line: 3,
  raw: 'see: 03-storage.md#Qutas',
  targetFile: '03-storage.md',
  targetSlug: 'Qutas',
  reason: 'AnchorNotFound',
};

/** quota.py:7 — the broken file: no corpus key `09-observability.md`, with
 *  or without a cans/ prefix. */
const BROKEN_FILE = {
  type: 'CodebaseBrokenReference',
  file: 'src/storage/quota.py',
  line: 7,
  raw: 'see: 09-observability.md',
  targetFile: '09-observability.md',
  targetSlug: null,
  reason: 'FileNotFound',
};

/** artifact-wiring.rs:36 — the broken artifact code-symbol anchor (issue
 *  #69's deliberate near-miss spelling): the target FILE exists under the
 *  workspace, `federateNope` matches no symbol of it. */
const BROKEN_ARTIFACT_SYMBOL = {
  type: 'CodebaseBrokenReference',
  file: 'src/plugins/artifact-wiring.rs',
  line: 36,
  raw: 'see: cans/artifacts/examples/multi-vm-swarm.rs#federateNope',
  targetFile: 'cans/artifacts/examples/multi-vm-swarm.rs',
  targetSlug: 'federateNope',
  reason: 'AnchorNotFound',
};

/** artifact-wiring.rs:40 — the broken artifact text-heading anchor (issue
 *  #69's deliberate misspelled diagram heading). */
const BROKEN_ARTIFACT_HEADING = {
  type: 'CodebaseBrokenReference',
  file: 'src/plugins/artifact-wiring.rs',
  line: 40,
  raw: 'see: cans/artifacts/diagrams/host-runtime.txt#driver-avf-nope',
  targetFile: 'cans/artifacts/diagrams/host-runtime.txt',
  targetSlug: 'driver-avf-nope',
  reason: 'AnchorNotFound',
};

/** artifact-wiring.rs:46 — the broken artifact FILE (issue #69's exact
 *  spelling from the report): at #69 time no `cans/artifacts/code/`
 *  directory existed on the fixture; since the #70 extension the
 *  directory exists (it holds the REAL container-service.rs) but
 *  `plugin-trait.rs` still does not — the verdict is byte-unchanged. */
const BROKEN_ARTIFACT_FILE = {
  type: 'CodebaseBrokenReference',
  file: 'src/plugins/artifact-wiring.rs',
  line: 46,
  raw: 'see: cans/artifacts/code/plugin-trait.rs#PluginError',
  targetFile: 'cans/artifacts/code/plugin-trait.rs',
  targetSlug: 'PluginError',
  reason: 'FileNotFound',
};

/** artifact-wiring.rs:28 — the schematic pointer into the workspace's own
 *  rules file, `cans/_rules.yaml#codebase.enabled`. VALID against the
 *  committed fixture (the codebase block exists there), but BROKEN in the
 *  pure-default variants: those subtests REWRITE _rules.yaml without a
 *  codebase block, and the artifact tier validates the file's CURRENT
 *  content — the rewrite deletes the very key this pointer names, so the
 *  pointer breaks (the feature working exactly as intended: a config
 *  rewrite that orphans a pointer into the config is a diff, not silence). */
const BROKEN_RULES_KEY = {
  type: 'CodebaseBrokenReference',
  file: 'src/plugins/artifact-wiring.rs',
  line: 28,
  raw: 'see: cans/_rules.yaml#codebase.enabled',
  targetFile: 'cans/_rules.yaml',
  targetSlug: 'codebase.enabled',
  reason: 'AnchorNotFound',
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
 *  line asc) — the two pre-existing true ones plus the three deliberate
 *  issue #69 artifact records, the two issue #70 typos and — since the #71
 *  extension — the #71 phrase typo LAST (trap.rs sorts after quota.py;
 *  issues #69/#70/#71 extended the fixture; trait-wiring.rs sorts after
 *  artifact-wiring.rs, so the #70 records slot in exactly here). */
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

/** The pure-default variant's oracle: the eight records PLUS the
 *  `cans/_rules.yaml#codebase.enabled` pointer as AnchorNotFound — the
 *  variant's own rules rewrite drops the codebase block the anchor names
 *  (see BROKEN_RULES_KEY above), one MORE broken than the config-on run. */
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

/** The exact wire keys a CodebaseIssueRecord may carry — no more, no fewer. */
const ISSUE_KEYS = ['type', 'file', 'line', 'raw', 'targetFile', 'targetSlug', 'reason'].sort();

// ── a: the broken-pointer run ────────────────────────────────────────────────

describe('issue #66 a — check --codebase on the broken-pointer workspace', () => {
  test('a1: non-zero exit, codebase block present, oracle counts exact', () => {
    const p = ws('a1');
    const r = runCli(['check', '--codebase', '--json'], p);
    // severity: error → the repo error-band convention: exit 2 (the suite's
    // one deliberate deviation from the RFC's example exit of 1 — see header).
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(false);
    expect(j.exitCode).toBe(2);
    expect(j.codebase).toBeDefined();
    expect(j.codebase.scanned).toBe(16); // 5 pre-#67 + the 4 src/plugins/ files (#67) + the 3 .rs sources (#68) + the artifact-wiring .rs source (#69) + the trait-wiring .rs source (#70) + the trap/transport .rs carriers (#71); cans/ always skipped
    expect(j.codebase.pointers).toBe(54); // 10 pre-#67 + the 11 kelir-shaped #67 pointers + the kelir five (#68) + the six artifact pointers (#69) + the eighteen #70 pointers + the four #71 pointers
    expect(j.codebase.broken).toBe(8);
    expect(j.codebase.issues).toEqual(ORACLE_ISSUES);
  });

  test('a2: every issue record carries EXACTLY the RFC §4.1 wire keys', () => {
    const p = ws('a2');
    const j = parseJsonOut(runCli(['check', '--codebase', '--json'], p).out);
    expect((j.codebase.issues as any[]).length).toBe(8);
    for (const issue of j.codebase.issues as any[]) {
      expect(Object.keys(issue).sort()).toEqual(ISSUE_KEYS);
    }
    // Order is part of the contract: file asc, line asc (the three #69
    // artifact records interleave by file between routes.ts and quota.py,
    // and since #70 so do the two #70 typos between artifact-wiring.rs
    // and quota.py; since #71 the phrase typo lands LAST — trap.rs sorts
    // after quota.py).
    expect((j.codebase.issues as any[]).map((i) => `${i.file}:${i.line}`)).toEqual([
      'src/api/routes.ts:3',
      'src/plugins/artifact-wiring.rs:36',
      'src/plugins/artifact-wiring.rs:40',
      'src/plugins/artifact-wiring.rs:46',
      'src/plugins/trait-wiring.rs:106',
      'src/plugins/trait-wiring.rs:109',
      'src/storage/quota.py:7',
      'src/trap.rs:7',
    ]);
  });

  test('a3: the findings ride sections.refs as codebase.broken_reference errors', () => {
    const p = ws('a3');
    const j = parseJsonOut(runCli(['check', '--codebase', '--json'], p).out);
    const rides = (j.sections.refs as any[]).filter(
      (i) => i.rule === 'codebase.broken_reference' && i.level === 'error',
    );
    expect(rides.length).toBe(8);
    expect(rides.map((i) => `${i.file}:${i.line}`).sort()).toEqual([
      'src/api/routes.ts:3',
      'src/plugins/artifact-wiring.rs:36',
      'src/plugins/artifact-wiring.rs:40',
      'src/plugins/artifact-wiring.rs:46',
      'src/plugins/trait-wiring.rs:106',
      'src/plugins/trait-wiring.rs:109',
      'src/storage/quota.py:7',
      'src/trap.rs:7',
    ]);
    // And they count like every band: error-level findings in errorCount.
    expect(j.counts.errors).toBeGreaterThanOrEqual(8);
  });

  test('a4: human output names the broken pointers (no JSON needed to see the rot)', () => {
    const p = ws('a4');
    const r = runCli(['check', '--codebase'], p);
    expect(r.exit).toBe(2);
    // The folded view names the family with its count and the first member's
    // diagnosis + did-you-mean fix (the report compaction contract, issue
    // #41 — one member per group in the fold):
    expect(r.out + r.err).toContain('8× broken codebase ref'); // 8 since #71 (7 + the phrase typo)
    expect(r.out + r.err).toContain('src/api/routes.ts');
    // `--show refs` unfolds: EVERY member names its source file.
    const ex = runCli(['check', '--codebase', '--show', 'refs'], p);
    expect(ex.exit).toBe(2);
    expect(ex.out + ex.err).toContain('src/api/routes.ts');
    expect(ex.out + ex.err).toContain('src/plugins/artifact-wiring.rs');
    expect(ex.out + ex.err).toContain('src/storage/quota.py');
  });
});

// ── b: fixing the pointers heals the run ─────────────────────────────────────

describe('issue #66 b — the fixed workspace exits 0 with an empty issues list', () => {
  test('b1: patch the broken pointers and the advisory in the tmp copy → exit 0, broken 0, issues []', () => {
    const p = ws('b1');
    // The fix the oracle prescribes: repair the slug (Quotas exists),
    // repoint the missing file at a real one, — since the #69 extension —
    // heal the three deliberate artifact records the same way (the
    // misspelled symbol and heading get their real spellings, the missing
    // artifact target is repointed at the example that exists), — since
    // #70 — heal the two typos the same way (the trait method and the
    // import token get their real spellings), — since #71 — heal the
    // phrase typo (the singular gets its entry spelling) and drop the
    // empty-target
    // advisory pointer's anchor (the #41 ladder exits 1 on warnings-only,
    // so a fully-healed tree must heal the warning class too — the
    // file-level spelling of the same pointer is valid on any target).
    // The typo patterns are NEWLINE-ANCHORED: `#configure_runtim` is a
    // prefix of the VALID `#configure_runtime` pointer at line 15 and
    // `#Kernel-seccomp-unotify-trigger` of the VALID
    // `#Kernel-seccomp-unotify-triggers` at trap.rs:3, so a
    // bare replace would corrupt the valid occurrence first (the
    // merge-commit lesson — String.replace takes the first hit).
    const routesPath = join(p, 'src', 'api', 'routes.ts');
    writeFileSync(routesPath, readFileSync(routesPath, 'utf8').replace('#Qutas', '#Quotas'), 'utf8');
    const quotaPath = join(p, 'src', 'storage', 'quota.py');
    writeFileSync(
      quotaPath,
      readFileSync(quotaPath, 'utf8').replace('see: 09-observability.md', 'see: 07-network.md'),
      'utf8',
    );
    const awPath = join(p, 'src', 'plugins', 'artifact-wiring.rs');
    const aw = readFileSync(awPath, 'utf8');
    writeFileSync(
      awPath,
      aw
        .replace('see: cans/artifacts/examples/multi-vm-swarm.rs#federateNope', 'see: cans/artifacts/examples/multi-vm-swarm.rs#federate')
        .replace('see: cans/artifacts/diagrams/host-runtime.txt#driver-avf-nope', 'see: cans/artifacts/diagrams/host-runtime.txt#driver-avf')
        .replace('see: cans/artifacts/code/plugin-trait.rs#PluginError', 'see: cans/artifacts/examples/multi-vm-swarm.rs#federate'),
      'utf8',
    );
    const twPath = join(p, 'src', 'plugins', 'trait-wiring.rs');
    const tw = readFileSync(twPath, 'utf8');
    writeFileSync(
      twPath,
      tw
        .replace(
          'see: cans/artifacts/code/container-service.rs#configure_runtim\n',
          'see: cans/artifacts/code/container-service.rs#configure_runtime\n',
        )
        .replace('see: cans/artifacts/examples/swarm-agent.rs#LedgerPlugn', 'see: cans/artifacts/examples/swarm-agent.rs#LedgerPlugin')
        .replace(
          'see: cans/artifacts/diagrams/empty-metrics.txt#anything',
          'see: cans/artifacts/diagrams/empty-metrics.txt',
        ),
      'utf8',
    );
    const trapPath = join(p, 'src', 'trap.rs');
    writeFileSync(
      trapPath,
      readFileSync(trapPath, 'utf8').replace(
        'see: cans/artifacts/diagrams/trap-flow.txt#Kernel-seccomp-unotify-trigger\n',
        'see: cans/artifacts/diagrams/trap-flow.txt#Kernel-seccomp-unotify-triggers\n',
      ),
      'utf8',
    );
    const r = runCli(['check', '--codebase', '--json'], p);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect(j.exitCode).toBe(0);
    // The phase ran (config-on) — the block is present with a clean outcome.
    expect(j.codebase).toBeDefined();
    expect(j.codebase.scanned).toBe(16);
    expect(j.codebase.pointers).toBe(54);
    expect(j.codebase.broken).toBe(0);
    expect(j.codebase.issues).toEqual([]);
  });
});

// ── c: the reverse-traceability query ────────────────────────────────────────

describe('issue #66 c — refs <node> --codebase lists the exact fixture hits', () => {
  test('c1: the anchored query answers routes.ts:2+6 and session.rs:2, exit 0', () => {
    const p = ws('c1');
    const r = runCli(['refs', '01-auth.md#Sessions', '--codebase', '--json'], p);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect(j.command).toBe('refs');
    expect(j.node).toBe('01-auth.md#Sessions'); // the query AS WRITTEN
    expect(j.scanned).toBe(16); // 14 post-#70 + the two #71 carriers
    // The `cans/`-prefixed spelling (routes.ts:2) resolves to the same
    // target, so it is among the hits. Order: file asc, line asc.
    expect(j.matches).toEqual([
      {
        file: 'src/api/routes.ts',
        line: 2,
        text: '// Auth middleware: see: cans/01-auth.md#Sessions — every route requires it.',
      },
      { file: 'src/api/routes.ts', line: 6, text: '  // login: see: 01-auth.md#Sessions' },
      {
        file: 'src/session.rs',
        line: 2,
        text: '// Initial handshake logic; see: 01-auth.md#Sessions for the canonical flow.',
      },
    ]);
  });

  test('c2: the file-level query answers every anchor into the file (incl. the tolerant slug)', () => {
    const p = ws('c2');
    const j = parseJsonOut(runCli(['refs', '01-auth.md', '--codebase', '--json'], p).out);
    expect(j.exitCode).toBe(0);
    expect(j.matches.map((m: any) => `${m.file}:${m.line}`)).toEqual([
      'src/api/routes.ts:2',
      'src/api/routes.ts:6',
      'src/session.rs:2',
      'src/session.rs:6',
      'src/session.rs:11', // `#token_validation` — tolerant match for `Token validation`
    ]);
  });

  test('c3: a no-match query is exit 0 with an empty answer (an empty answer is an answer)', () => {
    const p = ws('c3');
    const r = runCli(['refs', '03-storage.md#Timeouts', '--codebase', '--json'], p);
    expect(r.exit).toBe(0); // Timeouts lives in 07-network.md, not 03-storage.md
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect(j.matches).toEqual([]);
  });

  test('c4: human output lists the hits (file:line, the text as written)', () => {
    const p = ws('c4');
    const r = runCli(['refs', '01-auth.md#Sessions', '--codebase'], p);
    expect(r.exit).toBe(0);
    expect(r.out).toContain('src/api/routes.ts');
    expect(r.out).toContain('src/session.rs');
    expect(r.out).toContain('see: cans/01-auth.md#Sessions'); // the line text rides along
  });
});

// ── d: the flagless refusal ──────────────────────────────────────────────────

describe('issue #66 d — refs without --codebase refuses with guidance', () => {
  test('d1: non-zero exit, guidance names the knob, no matches field to misread', () => {
    const p = ws('d1');
    const r = runCli(['refs', '01-auth.md#Sessions'], p);
    expect(r.exit).not.toBe(0);
    expect(r.exit).not.toBeNull();
    // Guidance wording belongs to the CLI layer; the contract pins that the
    // refusal NAMES the knob so the fix is discoverable.
    expect(/codebase/i.test(r.out + r.err)).toBe(true);
  });
});

// ── e: scanner-off — the pre-#66 wire shape, byte-for-byte ───────────────────

describe('issue #66 e — no codebase block and no flag: the plain-check wire has NO codebase key', () => {
  test('e1: `check --json` (plain rules) is byte-shaped pre-#66: no codebase key, clean run', () => {
    const p = ws('e1');
    // The off-workspace: the SAME fixture minus the codebase block (the
    // corpus is refs-hub-clean, so the whole check is clean — exit 0). The
    // redundancy knobs are the fixture's own (issue #67: the verbatim
    // kelir-shaped headings collide with the frozen corpus vocabulary at
    // the typo layer's default distance — the README documents both knobs).
    writeFileSync(
      join(p, 'cans', '_rules.yaml'),
      [
        'references:',
        '  back_pointers: false',
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
    // THE byte-shape assertion: the additive block is absent, not empty —
    // `codebase` must not appear at the top level at all.
    expect('codebase' in j).toBe(false);
    expect(j.codebase).toBeUndefined();
  });

  test('e2: with the block DISABLED (enabled: false) and no flag the scanner stays off too', () => {
    const p = ws('e2');
    writeFileSync(
      join(p, 'cans', '_rules.yaml'),
      [
        'references:',
        '  back_pointers: false',
        'redundancy:',
        '  word_frequency_threshold: 5',
        '  fuzzy: false',
        'codebase:',
        '  enabled: false',
        '',
      ].join('\n'),
      'utf8',
    );
    const r = runCli(['check', '--json'], p);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect('codebase' in j).toBe(false);
  });
});

// ── f: flag-on with no config block scans the defaults ───────────────────────

describe('issue #66 f — check --codebase with no config block still scans (the defaults)', () => {
  test('f1: the RFC §3 default include list — 14 files, 52 pointers, 9 broken (the 8 + the rules-key pointer), no yaml', () => {
    const p = ws('f1');
    // No CODEBASE block (the flag is the scan consent) — but the #68
    // plugin-tier wiring stays, mirroring the fixture's committed rules:
    // the aliasing block is corpus-side loading, not scan config, and
    // without it the three cans/plugins/*.md keys would vanish and the
    // #68 pointers would become FileNotFound — a different dimension than
    // the include list this block isolates.
    writeFileSync(
      join(p, 'cans', '_rules.yaml'),
      [
        'references:',
        '  back_pointers: false',
        '  aliasing:',
        '    enabled: true',
        '    include:',
        '      - plugins/*.md',
        '',
      ].join('\n'),
      'utf8',
    );
    const r = runCli(['check', '--codebase', '--json'], p);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.codebase).toBeDefined();
    // The default code-extension set has no *.yaml: src/net.yaml and
    // src/plugins/mounts.yaml (and their pointers) stay out of the scan —
    // the config-on run sees 16/54 instead; the three #68 .rs sources, the
    // #69 artifact-wiring.rs source, the #70 trait-wiring.rs source AND
    // the #71 trap/transport carriers are covered by the default *.rs
    // include, so the six #69 artifact pointers, the eighteen #70 pointers
    // and the four #71 pointers stay in scope.
    expect(j.codebase.scanned).toBe(14);
    expect(j.codebase.pointers).toBe(52);
    // NINE broken, one MORE than the config-on run: this variant's own
    // rules rewrite drops the codebase block, and the #69 schematic
    // pointer `cans/_rules.yaml#codebase.enabled` validates against the
    // rules file's CURRENT content — the rewrite deleted the key it
    // names, so the pointer honestly breaks (the tier is never a rubber
    // stamp).
    expect(j.codebase.broken).toBe(9);
    expect(j.codebase.issues).toEqual(DEFAULTS_ORACLE_ISSUES);
    expect((j.codebase.issues as any[]).some((i) => i.file === 'src/net.yaml')).toBe(false);
    expect((j.codebase.issues as any[]).some((i) => i.file === 'src/plugins/mounts.yaml')).toBe(false);
  });
});
