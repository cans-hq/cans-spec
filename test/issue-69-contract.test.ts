/**
 * Issue #69 — the CONTRACT suite: `cans check --codebase` silently ignores
 * `see:` pointers to non-`.md` targets and `cans refs` rejects them as
 * malformed — pinned end-to-end against the extended
 * `test/fixtures/codebase-workspace/` fixture (its README.md is the
 * line-authoritative oracle — every pointer, its line, its verdict).
 *
 * THE BUG: the cans layout puts field layouts, schemas, wire formats,
 * pipeline diagrams and example code under `cans/artifacts/` — and code
 * points at them (`// see: cans/artifacts/code/plugin-trait.rs#PluginError`,
 * `// see: cans/artifacts/diagrams/host-runtime.txt#driver-avf`, a YAML key
 * under `cans/_rules.yaml`). The #66 pointer grammar captured `.md` targets
 * only, so `check --codebase` never even SAW the class (on the reporter's
 * repo 114 of 1523 codebase pointers, 25 distinct files: .rs, .ts, .py,
 * .yaml, .txt, plus `cans/_rules.yaml` — all unvalidated, a broken anchor or
 * a missing file rotting silently), and the refs QUERY grammar mirrored the
 * same narrow class, refusing artifact queries as `malformed node`.
 *
 * THE FROZEN FIX SPEC this suite is written against (the engine half lands
 * on fix/issue-69-engine; the seam — CODEBASE_TARGET_EXTS and
 * codebaseTargetExtAlt(), the longest-first alternation — is already on
 * main @ ef8dd81):
 *
 *   1. ENGINE (fix/issue-69-engine): SEE_POINTER_RE's file group widens
 *      from `\.md` to `\.(?:<codebaseTargetExtAlt()>)` — the union of the
 *      addressable vocabularies (corpus .md + #58 schematic + #60 text and
 *      code tiers). A file type NO vocabulary can address (`.csv`) stays
 *      uncapturable — the extension table is the over-capture guard.
 *   2. ENGINE: checkCodebaseRefs gains the ARTIFACT tier — a non-`.md`
 *      target resolves via resolveSpecFile against the WORKSPACE (cans/):
 *      a missing file ⇒ reason 'FileNotFound' (… — artifact target not
 *      found in the cans workspace); an anchored target validates through
 *      the shared checkArtifactAnchor (code symbols / schematic dot paths /
 *      text headings) with misses ⇒ 'AnchorNotFound' + a did-you-mean.
 *   3. CONTRACT (this branch, src/commands/refs.ts): QUERY_RE builds from
 *      the SAME shared table (a query must name everything a pointer can —
 *      the two grammars cannot drift); a non-`.md` query resolves against
 *      the workspace filesystem (cans/-stripped, resolveSpecFile) refusing
 *      unknown files with the spec-or-artifact family message; matching
 *      never crosses the tiers (.md query ⇔ corpus pointers, artifact
 *      query ⇔ artifact pointers, resolved-path equality); the malformed
 *      guidance names BOTH forms while the pinned
 *      `malformed node "<q>" — use <file>.md or <file>.md#Slug` prefix and
 *      family stay byte-intact (test/issue66-cli.test.ts D2/D3).
 *
 * THE FIXTURE WIRING (README "issue #69 extension"): the artifact target
 * `cans/artifacts/diagrams/host-runtime.txt` (underlined `driver-avf` /
 * `driver-virtio` headings — the #60 text vocabulary) and the scanned
 * source `src/plugins/artifact-wiring.rs` carrying six pointers at pinned
 * lines 14/21/28/36/40/46 — three VALID (one per anchor tier: the code
 * symbol `#federate` over `pub fn federate`, the text heading
 * `#driver-avf`, the schematic dot path `cans/_rules.yaml#codebase.enabled`
 * — the fixture's own rules file parses with the #58 YAML subset parser,
 * verified, so no fallback config artifact is needed) and three BROKEN
 * (the issue's own spellings: `#federateNope`, `#driver-avf-nope`, the
 * missing `cans/artifacts/code/plugin-trait.rs#PluginError`).
 *
 * WHAT EACH BLOCK PINS (all blackbox via the real CLI, the issue-66/67/68
 * integration harness pattern; the fixture is driven from a fresh tmp copy):
 *
 *   a ....... the check scan over the extended fixture: config-on
 *             13 scanned (12 pre-#69 + the new .rs source) / 32 pointers
 *             (26 + the six artifact pointers — pre-#69 the census did not
 *             even SEE them) / EXACTLY the FIVE broken records byte-pinned
 *             in the deterministic order (the 2 pre-existing true records
 *             + the 3 new deliberate ones), and ZERO findings for the
 *             three VALID artifact pointers — the heart of the issue
 *   b ....... the --json wire: the artifact findings carry targetFile and
 *             targetSlug VERBATIM (the `cans/` prefix kept, the anchor as
 *             captured) with reasons AnchorNotFound / FileNotFound; and
 *             the human output (`--show refs`) carries the did-you-mean
 *             for the `#federateNope` miss
 *   c ....... the reverse path, the refs ARTIFACT tier: the anchored query
 *             answers its exact pointer (the anchor comparison is never
 *             fuzzy — `#federate` and `#federateNope` answer separately);
 *             the file-level query answers EVERY pointer into the file
 *             regardless of anchor (the valid + the broken); the
 *             schematic dot-path query answers; a `.md` regression query
 *             still answers its pre-existing matches (and ONLY those — the
 *             tiers never cross-match); an unknown artifact file refuses
 *             naming the spec-or-artifact boundary; malformed queries
 *             (bare stem, `.csv`, empty slug, trailing garbage) refuse
 *             with the `malformed node` family intact, and the `.md`
 *             unknown-file refusal keeps its own message (the artifact
 *             tier loosened nothing on the corpus side)
 *   d ....... the corpus band is untouched: the plain check (no flag)
 *             stays clean with NO codebase key, refs.total 11 / files 9 —
 *             the extension added workspace ARTIFACT files and one scanned
 *   source, never a corpus file
 *
 * HONESTY NOTE (RED by design, the issue #68 contract model): on the
 * contract branch ALONE — before the fix/issue-69-engine merge — 9 of the
 * 14 pins are red, all of them the widened-extraction half: a1/a2 (the
 * census counts 13 scanned / 26 pointers / 2 broken — the six artifact
 * pointers are invisible to the .md-only extractor, the silent-skip half
 * of the issue, so the five-record oracle and the sections.refs rides
 * cannot match), b1/b2 (no artifact findings exist to pin, hence no
 * did-you-mean in the human report), c1–c5 (artifact queries answer zero
 * matches: the extractor still captures `.md` only). The 5 green pins are
 * the contract half that landed on THIS branch and must STAY green across
 * the merge: c6 (the `.md` regression query over the extended fixture),
 * c7/c8/c9 (the artifact-query refusals and the malformed family — the
 * refs-side tier), d1 (the corpus band untouched). Merge order: engine
 * first, then this branch — the full suite goes green only against the
 * merged engine (verified at the merge commit).
 *
 * Runtime-neutral: imports the test facade, never 'bun:test' directly;
 * CLI runs are blackbox spawns via ./runtime.ts (CANS_ROOT pinned empty
 * so the walk-up resolution lands on the intended workspace).
 */
import { describe, test, expect, afterEach } from './testing.ts';
import { join } from 'path';
import { writeFileSync } from 'fs';

import { spawnCli } from './runtime.ts';
import { makeTmpDir, cleanTmpDir, copyFixtureToTmp } from './helpers.ts';

// ── harness (the issue-68 contract pattern, verbatim) ─────────────────────

const tmps: string[] = [];

/** Fresh copy of the fixture into tmp: <tmp>/codebase-workspace/{cans,src}. */
function ws(name: string): string {
  const tmp = makeTmpDir(`issue69-contract-${name}`);
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

/** routes.ts:3 — the pre-existing broken slug, UNCHANGED by the #69 fix: the
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

/** artifact-wiring.rs:36 — the broken artifact CODE-SYMBOL anchor (the
 *  issue's own near-miss spelling): the target FILE exists under the
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

/** artifact-wiring.rs:40 — the broken artifact TEXT-HEADING anchor: the
 *  diagram exists, `driver-avf-nope` matches no underlined heading of it. */
const BROKEN_ARTIFACT_HEADING = {
  type: 'CodebaseBrokenReference',
  file: 'src/plugins/artifact-wiring.rs',
  line: 40,
  raw: 'see: cans/artifacts/diagrams/host-runtime.txt#driver-avf-nope',
  targetFile: 'cans/artifacts/diagrams/host-runtime.txt',
  targetSlug: 'driver-avf-nope',
  reason: 'AnchorNotFound',
};

/** artifact-wiring.rs:46 — the broken artifact FILE (the issue's EXACT
 *  spelling): no `cans/artifacts/code/` directory exists on the fixture,
 *  so the artifact target is missing from the cans workspace. */
const BROKEN_ARTIFACT_FILE = {
  type: 'CodebaseBrokenReference',
  file: 'src/plugins/artifact-wiring.rs',
  line: 46,
  raw: 'see: cans/artifacts/code/plugin-trait.rs#PluginError',
  targetFile: 'cans/artifacts/code/plugin-trait.rs',
  targetSlug: 'PluginError',
  reason: 'FileNotFound',
};

/** quota.py:7 — the pre-existing broken file, UNCHANGED by the #69 fix. */
const BROKEN_FILE = {
  type: 'CodebaseBrokenReference',
  file: 'src/storage/quota.py',
  line: 7,
  raw: 'see: 09-observability.md',
  targetFile: '09-observability.md',
  targetSlug: null,
  reason: 'FileNotFound',
};

/** The FIVE broken records, in the contract's deterministic order
 *  (file asc, line asc): the two pre-existing true ones plus the three
 *  deliberate issue-#69 ones — every VALID artifact pointer (and every
 *  #67/#68 pointer) is missing from this set. */
const ORACLE_ISSUES = [
  BROKEN_ANCHOR,
  BROKEN_ARTIFACT_SYMBOL,
  BROKEN_ARTIFACT_HEADING,
  BROKEN_ARTIFACT_FILE,
  BROKEN_FILE,
];

/** The three VALID artifact pointers' written spans — none may be reported
 *  broken (the heart of the issue: code pointing at workspace artifacts
 *  stops being silently unvalidated AND stops being false-positived). */
const VALID_ARTIFACT_RAWS = [
  'see: cans/artifacts/examples/multi-vm-swarm.rs#federate',
  'see: cans/artifacts/diagrams/host-runtime.txt#driver-avf',
  'see: cans/_rules.yaml#codebase.enabled',
];

/** The artifact-wiring.rs comment lines, byte-authoritative (README table). */
const AW = {
  l14: '// see: cans/artifacts/examples/multi-vm-swarm.rs#federate',
  l21: '// see: cans/artifacts/diagrams/host-runtime.txt#driver-avf',
  l28: '// see: cans/_rules.yaml#codebase.enabled',
  l36: '// see: cans/artifacts/examples/multi-vm-swarm.rs#federateNope',
  l40: '// see: cans/artifacts/diagrams/host-runtime.txt#driver-avf-nope',
  l46: '// see: cans/artifacts/code/plugin-trait.rs#PluginError',
};

// ── a: the check scan — the artifact tier validates, neither skips nor mints ─

describe('issue #69 a — check --codebase: the six artifact pointers join the census, three resolve, three break', () => {
  test('a1: config-on — 13 scanned / 32 pointers / EXACTLY the 5 broken records, zero findings for the valid three', () => {
    const p = ws('a1');
    const r = runCli(['check', '--codebase', '--json'], p);
    expect(r.exit).toBe(2); // severity: error → the error band (5 true findings)
    const j = parseJsonOut(r.out);
    expect(j.codebase).toBeDefined();
    // 12 pre-#69 sources + the new .rs source (the .txt artifact lives under
    // cans/ — workspace files are never scanned).
    expect(j.codebase.scanned).toBe(13);
    // 26 pre-#69 pointers + the six artifact pointers: pre-#69 the census
    // did not even SEE this class (the silent-skip half of the issue).
    expect(j.codebase.pointers).toBe(32);
    expect(j.codebase.broken).toBe(5);
    // THE pin: the broken set is byte-exactly the five records above, in
    // the deterministic order (file asc, line asc).
    expect(j.codebase.issues).toEqual(ORACLE_ISSUES);
    expect((j.codebase.issues as any[]).map((i) => `${i.file}:${i.line}`)).toEqual([
      'src/api/routes.ts:3',
      'src/plugins/artifact-wiring.rs:36',
      'src/plugins/artifact-wiring.rs:40',
      'src/plugins/artifact-wiring.rs:46',
      'src/storage/quota.py:7',
    ]);
    // And made explicit — the heart of the issue in the other direction:
    // ZERO findings for the three VALID artifact pointers (the code symbol,
    // the text heading, the schematic dot path all resolve).
    for (const raw of VALID_ARTIFACT_RAWS) {
      expect((j.codebase.issues as any[]).some((i) => i.raw === raw)).toBe(false);
    }
    // Every pre-#69 pointer file is still clean too — the tier neither
    // skipped anything new nor minted a false positive anywhere else.
    const issueFiles = new Set((j.codebase.issues as any[]).map((i: any) => i.file));
    for (const clean of [
      'src/session.rs',
      'src/worker/sweep.go',
      'src/net.yaml',
      'src/plugins/transaction.rs',
      'src/plugins/checkpoint.go',
      'src/plugins/ingress.py',
      'src/plugins/mounts.yaml',
      'src/plugins/db-proxy.rs',
      'src/plugins/profile.rs',
      'src/plugins/wire-ingress.rs',
    ]) {
      expect(issueFiles.has(clean)).toBe(false);
    }
  });

  test('a2: the five findings ride sections.refs as codebase.broken_reference errors', () => {
    const p = ws('a2');
    const j = parseJsonOut(runCli(['check', '--codebase', '--json'], p).out);
    const rides = (j.sections.refs as any[]).filter(
      (i) => i.rule === 'codebase.broken_reference' && i.level === 'error',
    );
    expect(rides.length).toBe(5);
    expect(rides.map((i) => `${i.file}:${i.line}`).sort()).toEqual([
      'src/api/routes.ts:3',
      'src/plugins/artifact-wiring.rs:36',
      'src/plugins/artifact-wiring.rs:40',
      'src/plugins/artifact-wiring.rs:46',
      'src/storage/quota.py:7',
    ]);
    expect(j.counts.errors).toBeGreaterThanOrEqual(5);
  });
});

// ── b: the wire shape + the human suggestion ───────────────────────────────

describe('issue #69 b — the artifact findings on the wire and in the human report', () => {
  test('b1: --json carries targetFile/targetSlug VERBATIM with the artifact reasons', () => {
    const p = ws('b1');
    const j = parseJsonOut(runCli(['check', '--codebase', '--json'], p).out);
    // The three artifact records: the `cans/` prefix kept as written, the
    // anchors as captured (no truncation at the dot, no case folding), the
    // reasons exactly the two-tier verdict vocabulary.
    const artifactIssues = (j.codebase.issues as any[]).filter((i) => i.file === 'src/plugins/artifact-wiring.rs');
    expect(artifactIssues.map((i) => [i.targetFile, i.targetSlug, i.reason])).toEqual([
      ['cans/artifacts/examples/multi-vm-swarm.rs', 'federateNope', 'AnchorNotFound'],
      ['cans/artifacts/diagrams/host-runtime.txt', 'driver-avf-nope', 'AnchorNotFound'],
      ['cans/artifacts/code/plugin-trait.rs', 'PluginError', 'FileNotFound'],
    ]);
    // The 7-key wire shape holds for artifact records exactly as for .md
    // ones (the frozen #66 contract, issue66-integration a2).
    const ISSUE_KEYS = ['type', 'file', 'line', 'raw', 'targetFile', 'targetSlug', 'reason'].sort();
    for (const issue of artifactIssues) {
      expect(Object.keys(issue).sort()).toEqual(ISSUE_KEYS);
    }
  });

  test('b2: the human report (--show refs) carries the did-you-mean for #federateNope', () => {
    const p = ws('b2');
    // The folded view names the family with its count; --show refs unfolds
    // every member (the issue66-integration a4 pattern), so the artifact
    // miss and its suggestion are visible without JSON.
    const folded = runCli(['check', '--codebase'], p);
    expect(folded.exit).toBe(2);
    expect(folded.out + folded.err).toContain('5× broken codebase ref');
    const ex = runCli(['check', '--codebase', '--show', 'refs'], p);
    expect(ex.exit).toBe(2);
    expect(ex.out + ex.err).toContain('federateNope');
    expect(ex.out + ex.err).toContain('driver-avf-nope');
    // The suggestion layer knows the answer: the near miss of `federate`
    // proposes the symbol that exists (advice only — resolution never
    // auto-heals; the wire record stays AnchorNotFound).
    expect(ex.out + ex.err).toContain('did you mean');
    expect(ex.out + ex.err).toContain('#federate');
  });
});

// ── c: the reverse path — the refs artifact query tier ─────────────────────

describe('issue #69 c — refs <artifact> --codebase: anchored, file-level, schematic, and the refusals', () => {
  test('c1: the anchored artifact query answers its exact pointer (anchor comparison never fuzzy)', () => {
    const p = ws('c1');
    const r = runCli(['refs', 'cans/artifacts/examples/multi-vm-swarm.rs#federate', '--codebase', '--json'], p);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect(j.command).toBe('refs');
    expect(j.node).toBe('cans/artifacts/examples/multi-vm-swarm.rs#federate'); // AS WRITTEN
    expect(j.scanned).toBe(13);
    // ONLY the valid pointer answers: the `#federateNope` spelling at line
    // 36 does NOT (normalizeForAnchor('federateNope') !== 'federate' — no
    // fuzzy healing, the #67 d4 precedent on the artifact tier).
    expect(j.matches).toEqual([
      { file: 'src/plugins/artifact-wiring.rs', line: 14, text: AW.l14 },
    ]);
  });

  test('c2: the BROKEN spelling answers too — the reverse path is a query, not a verdict', () => {
    const p = ws('c2');
    // `check` reports this pointer broken; `refs` still traces WHO writes
    // it — the two commands answer different questions over one engine.
    const j = parseJsonOut(
      runCli(['refs', 'cans/artifacts/examples/multi-vm-swarm.rs#federateNope', '--codebase', '--json'], p).out,
    );
    expect(j.exitCode).toBe(0);
    expect(j.matches).toEqual([
      { file: 'src/plugins/artifact-wiring.rs', line: 36, text: AW.l36 },
    ]);
  });

  test('c3: the file-level artifact query answers EVERY pointer into the file, regardless of anchor', () => {
    const p = ws('c3');
    // File-level (no #slug): the valid #federate pointer AND the broken
    // #federateNope one both answer — the file is the same; anchors are
    // irrelevant at this query shape (the #66 c2 contract, artifact side).
    const j = parseJsonOut(
      runCli(['refs', 'cans/artifacts/examples/multi-vm-swarm.rs', '--codebase', '--json'], p).out,
    );
    expect(j.exitCode).toBe(0);
    expect(j.matches).toEqual([
      { file: 'src/plugins/artifact-wiring.rs', line: 14, text: AW.l14 },
      { file: 'src/plugins/artifact-wiring.rs', line: 36, text: AW.l36 },
    ]);
  });

  test('c4: the file-level .txt query answers both txt pointers — and no .md pointers (tiers never cross)', () => {
    const p = ws('c4');
    const j = parseJsonOut(
      runCli(['refs', 'cans/artifacts/diagrams/host-runtime.txt', '--codebase', '--json'], p).out,
    );
    expect(j.exitCode).toBe(0);
    // EXACTLY the two txt pointers: line 21 (valid) + line 40 (broken). If
    // a .md pointer could ever match an artifact query, this set would be
    // larger — resolveSpecFile of an .md target is an .md path and can
    // never equal the .txt query path (the non-crossing pin).
    expect(j.matches).toEqual([
      { file: 'src/plugins/artifact-wiring.rs', line: 21, text: AW.l21 },
      { file: 'src/plugins/artifact-wiring.rs', line: 40, text: AW.l40 },
    ]);
  });

  test('c5: the schematic dot-path query into cans/_rules.yaml answers its pointer', () => {
    const p = ws('c5');
    // The reporter's own class: code pointing at a YAML key of the
    // workspace's rules file. The query grammar accepts the dotted anchor
    // (the full slug alphabet), the artifact tier resolves it.
    const j = parseJsonOut(
      runCli(['refs', 'cans/_rules.yaml#codebase.enabled', '--codebase', '--json'], p).out,
    );
    expect(j.exitCode).toBe(0);
    expect(j.matches).toEqual([
      { file: 'src/plugins/artifact-wiring.rs', line: 28, text: AW.l28 },
    ]);
  });

  test('c6: the .md regression query still answers its pre-existing matches (and ONLY those)', () => {
    const p = ws('c6');
    // The #66 c1 pin, re-run over the extended fixture: the .md tier is
    // untouched by the artifact tier — same three matches, and no artifact
    // pointer leaks into a corpus query (the non-crossing pin, other
    // direction: an artifact target is never a corpus key).
    const j = parseJsonOut(runCli(['refs', '01-auth.md#Sessions', '--codebase', '--json'], p).out);
    expect(j.exitCode).toBe(0);
    expect(j.scanned).toBe(13);
    expect(j.matches.map((m: any) => `${m.file}:${m.line}`)).toEqual([
      'src/api/routes.ts:2',
      'src/api/routes.ts:6',
      'src/session.rs:2',
    ]);
  });

  test('c7: an unknown artifact file refuses, naming the spec-or-artifact boundary', () => {
    const p = ws('c7');
    const r = runCli(['refs', 'cans/artifacts/nope.rs', '--codebase', '--json'], p);
    expect(r.exit).toBe(1);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(false);
    expect(j.command).toBe('refs');
    expect(j.exitCode).toBe(1);
    expect(j.node).toBe('cans/artifacts/nope.rs'); // the query AS WRITTEN
    expect(j.scanned).toBe(0);
    expect(j.matches).toEqual([]);
    expect(j.error).toContain('no spec or artifact file matches "cans/artifacts/nope.rs"');
    expect(j.error).toContain('resolves against the workspace corpus (cans/) and its artifact files');
    // The `cans/`-less spelling of the same missing file refuses the same
    // way (the prefix is optional in both directions).
    const r2 = runCli(['refs', 'artifacts/nope.rs', '--codebase'], p);
    expect(r2.exit).toBe(1);
    expect(r2.out + r2.err).toContain('no spec or artifact file matches "artifacts/nope.rs"');
  });

  test('c8: malformed artifact queries refuse with the `malformed node` family, both forms named', () => {
    const p = ws('c8');
    // A bare stem (the pinned #66 D2 shape), an extension no anchor
    // vocabulary can address, an empty slug, and trailing garbage — all
    // usage refusals, never a fuzzy match. The pinned prefix survives.
    const bad = [
      '02-auth',
      'foo.csv#x',
      'cans/artifacts/diagrams/host-runtime.txt#',
      'cans/artifacts/diagrams/host-runtime.txt#driver-avf#more',
    ];
    for (const q of bad) {
      const r = runCli(['refs', q, '--codebase'], p);
      expect(r.exit).toBe(1);
      expect(r.out + r.err).toContain(`malformed node "${q}"`);
    }
    // The guidance names BOTH forms — the .md family the #66 pins hold on
    // to (`<file>.md or <file>.md#Slug`, test/issue66-cli.test.ts D2) and
    // the artifact form the widened grammar just learned.
    const r = runCli(['refs', '02-auth', '--codebase'], p);
    expect(r.out + r.err).toContain('<file>.md or <file>.md#Slug');
    expect(r.out + r.err).toContain('<file>.<ext> or <file>.<ext>#Slug');
  });

  test('c9: an unknown .md file keeps its own refusal — the artifact tier loosened NOTHING on the corpus side', () => {
    const p = ws('c9');
    // The #66 D7 pin over the extended fixture: a `.md` query against a
    // missing spec file still refuses with the corpus-boundary message
    // (the two families are disjoint — no artifact fallback for `.md`).
    const r = runCli(['refs', '99-missing.md', '--codebase'], p);
    expect(r.exit).toBe(1);
    expect(r.out + r.err).toContain('no spec file matches "99-missing.md"');
    expect(r.out + r.err).not.toContain('no spec or artifact file matches');
  });
});

// ── d: the corpus band is untouched ─────────────────────────────────────────

describe('issue #69 d — the extension adds artifacts and a source, never a corpus file', () => {
  test('d1: the plain check stays clean with NO codebase key and the #68 corpus counts unchanged', () => {
    const p = ws('d1');
    // The committed _rules.yaml carries `codebase.enabled: true`, so the
    // corpus-band comparison strips the block first (the #68 c1 variant:
    // aliasing tier kept on — the plugin specs stay loaded — redundancy
    // knobs the README documents, no codebase block). Over that workspace
    // the plain check never scans: the host-runtime.txt artifact and the
    // artifact-wiring.rs source are invisible to the corpus band (the
    // artifact is never discovered; the source is never scanned without
    // consent), so the #68 c1 pins hold verbatim: exit 0, no codebase key,
    // refs 11, files 9.
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
