/**
 * Issue #72 — the CONTRACT suite: `cans check --codebase` 0.20.0 on kelir
 * reports one remaining error for a pointer that is RIGHT — a bracketed
 * diagram entry SHARING its line with other bracketed entries:
 *   · `crates/kelir-transport/src/lib.rs:3` —
 *     `see: cans/artifacts/diagrams/wire-plane.txt#
 *     USERSPACE-SMOLTCP-INGRESS-RING`, whose target line 5 IS
 *     `[USERSPACE SMOLTCP INGRESS RING] [on_net_outbound] [on_net_inbound]`.
 * #71 minted every physical .txt/.text line as an entry but strips ONE
 * outermost ASCII `[…]` pair ONLY when it is the only one — a line with
 * three bracketed groups strips nothing, so the entry is the WHOLE row
 * (all three groups plus brackets) and the phrase anchor naming the FIRST
 * group matches no single node: `broken anchor: … — no node matches`, the
 * issue's error. The issue's minimal repro:
 *   · `t.txt` line 1 `  [FOO BAR BAZ] [other one]` — `#FOO-BAR-BAZ`
 *     fails on 0.20.0 (two groups → no strip → the whole line is the
 *     entry), while line 2 `  [SOLO ENTRY HERE]` — `#SOLO-ENTRY-HERE` —
 *     resolves (one group → the #71 strip, the control).
 *
 * THE FROZEN FIX SPEC this suite is written against (the engine half
 * lands on fix/issue-72-engine): `extractTextEntries` in
 * src/core/text-anchors.ts, per physical line after trim and
 * leading-decoration strip:
 *   1. SINGLE-PAIR case (unchanged #71): text starts `[`, ends `]`,
 *      exactly one of each → entry = interior, trimmed;
 *   2. ALL OTHER cases: the whole cleaned line mints VERBATIM (unchanged)
 *      AND each maximal flat bracket group (regex `/\[([^\[\]]*)\]/g`,
 *      left-to-right) mints its trimmed interior as its OWN entry if it
 *      passes the guards (≥ 2 chars, has a letter). Emission order:
 *      whole-line first, then groups left-to-right; existing
 *      first-occurrence dedupe;
 *   3. everything else byte-unchanged — headings, leaf tokens, the
 *      seven-vocabulary no-target message, the refs.ts seam, codebase.ts,
 *      report.ts. Purely additive — the widening never narrows.
 * Consequences: `#USERSPACE-SMOLTCP-INGRESS-RING` resolves against the
 * three-group row via the group entry `USERSPACE SMOLTCP INGRESS RING`;
 * `#FOO-BAR-BAZ` resolves against `  [FOO BAR BAZ] [other one]` via the
 * group entry `FOO BAR BAZ`; `#SOLO-ENTRY-HERE` resolves on BOTH sides of
 * the merge (single-pair rule — the control); `#SMOLTCP` keeps resolving
 * through the #70 leaf tier (a word token of the same row).
 *
 * THE FIXTURE WIRING (README "issue #72 extension"): the #71 diagram
 * `cans/artifacts/diagrams/wire-plane.txt` grows its line 5 into the
 * issue's verbatim three-group row `[USERSPACE SMOLTCP INGRESS RING]
 * [on_net_outbound] [on_net_inbound]` (column 0; every other byte of the
 * file intact — the #71 single-pair control `[KERNEL VIRTIO NETQUEUE
 * PAIR]` at line 8 keeps its world), the NEW
 * `cans/artifacts/diagrams/t.txt` carries the issue's minimal repro
 * verbatim (line 1 `  [FOO BAR BAZ] [other one]` — a bracketed entry
 * SHARING its line; line 2 `  [SOLO ENTRY HERE]` — the lone-span
 * control), and the NEW scanned carrier `src/net-refs.rs` (the
 * trap.rs/transport.rs shape: the repro pointer
 * `// see: cans/artifacts/diagrams/t.txt#FOO-BAR-BAZ` at line 3, the
 * control pointer `// see: cans/artifacts/diagrams/t.txt#SOLO-ENTRY-HERE`
 * at line 8) rides the committed `**/*.rs` glob AND the RFC §3 default.
 *
 * CENSUS ARITHMETIC (verified by RUNNING under the engine spec, never
 * assumed): scanned 16 → 17 (the net-refs.rs carrier, covered by the
 * committed `*.rs` include glob AND the RFC §3 default), pointers 54 → 56
 * (the two #72 pointers), broken EXACTLY 8 post-#72 — the SAME eight #71
 * records in the SAME deterministic file-asc/line-asc order (net-refs.rs
 * adds NO broken record; `src/net-refs.rs` sorts between `src/api/
 * routes.ts` and `src/plugins/…`, so on the bare engine its false record
 * slots in SECOND), warnings exactly 1 still (the empty-metrics advisory
 * — the t.txt target carries leaf-token vocabulary, so its pre-fix miss
 * is an ERROR, the issue's report, never a warning), exit 2. On the BARE
 * 0.20.0 engine: 17 / 56 / 10 broken (the 8 + TWO false errors —
 * `src/net-refs.rs:3` #FOO-BAR-BAZ over the multi-group t.txt line and
 * `src/transport.rs:3` #USERSPACE-SMOLTCP-INGRESS-RING over the
 * now-three-group wire-plane row, the issue's report at fixture scale) +
 * the same 1 warning. Pure defaults (no codebase block): 15 scanned /
 * 54 pointers / 9 broken post-#72 (the 8 + the rules-key pointer —
 * net-refs.rs is a `.rs` source, so the DEFAULT include list covers it;
 * **11 pre-#72**). The corpus band is untouched: plain `check` stays
 * clean, refs.total 11 / files 9.
 *
 * WHAT EACH BLOCK PINS (all blackbox via the real CLI, the issue-66/67/68/
 * 69/70/71 integration harness pattern; the fixture is driven from a fresh
 * tmp copy):
 *
 *   a ....... the check scan over the extended fixture: config-on
 *             17 scanned / 56 pointers / EXACTLY the EIGHT broken records
 *             byte-pinned in the deterministic file-asc line-asc order
 *             (the #71 eight, unchanged — the extension adds no broken
 *             record) and EXACTLY ONE warning (the empty-metrics
 *             no-target advisory, rule codebase.anchor.no-target) and
 *             ZERO findings for the two repro pointers and the control —
 *             the heart of the issue; a2 the eight rides on
 *             sections.refs; a3 the warnings class (engine-independent);
 *             a4 the pure-defaults census 15 / 54 / 9 — the carrier joins
 *             the DEFAULT scan too, so the repro resolves without any
 *             config block
 *   b ....... the wire + the human report: the #71 typo record (selected
 *             by written span, green pre-merge by selection) carries
 *             targetFile/targetSlug VERBATIM with reason AnchorNotFound
 *             and the frozen 7-key shape; the folded view reads
 *             `8× broken codebase ref` and `--show refs` carries the #71
 *             typo's phrase did-you-mean while the two FALSE records'
 *             spans appear NOWHERE in the unfolded findings (red
 *             pre-merge: the fold reads `10×` and both false spans ride
 *             the findings with no near match)
 *   c ....... the reverse path, the refs ARTIFACT tier (green pre-merge —
 *             a query answers WRITERS, never verdicts): the two repro
 *             anchored queries and the control answer their exact carrier
 *             lines; the t.txt and wire-plane file-level queries answer
 *             ALL their pointers; a TRUNCATED phrase answers ZERO matches
 *             (never fuzzy); a group name that EXISTS in the diagram but
 *             no source writes answers ZERO; a `.md` regression query
 *             still answers its pre-existing matches over the 17-file scan
 *   d ....... the exit-code ladder re-pinned over the SHIFTED census: the
 *             raw fixture exits 2 (8 errors + 1 warning, ok:false);
 *             healing the EIGHT error records in the tmp copy — the #71
 *             heal set, unchanged (NO new typo pointer was added for
 *             #72, so there is no #72 heal) — leaves the warnings-only
 *             band, ok:true, errors 0, warnings 1, EXIT 1; healing the
 *             advisory too (the empty-metrics pointer to its file-level
 *             spelling) is band 0 — EXIT 0
 *   e ....... the corpus band is untouched: the plain check (no flag)
 *             stays clean with NO codebase key, refs.total 11 / files 9 —
 *             the extension added one workspace ARTIFACT file and one
 *             scanned source, never a corpus file
 *
 * HONESTY NOTE (RED by design, the #68/#69/#70/#71 contract model): on
 * the contract branch ALONE — before the fix/issue-72-engine merge — the
 * pins that count the two repro pointers as RESOLVED are red, verified by
 * running (bare census: 17 scanned / 56 pointers / 10 broken + the 1
 * warning; the ten records in the deterministic order are the eight below
 * PLUS `src/net-refs.rs:3` (after routes.ts:3, before the plugins) and
 * `src/transport.rs:3` (after quota.py:7, before trap.rs:7)):
 * a1 (the census reads 10 broken, not 8, and the oracle list gains the
 * two false records), a2 (TEN findings ride sections.refs, not eight),
 * a4 (the pure-defaults census reads 11 broken, not 9), b2 (the fold
 * reads `10×` and both false spans DO ride the unfolded findings —
 * neither carries a near match on the bare engine), d2/d3 (the healed
 * tree still carries the two false errors, so both rungs read exit 2,
 * not 1/0). The green-on-bare pins are the contract half that must STAY
 * green across the merge: a3 (the warnings class — rule and count and
 * the advisory's line, engine-independent), b1 (the #71 typo record's
 * wire shape, selected by written span — it exists with the same shape
 * on both engines), c1–c6 (the reverse path answers writers regardless
 * of verdicts), d1 (the raw fixture's error band — exit 2 either way),
 * e1 (the corpus band untouched). Merge order: engine first, then this
 * branch — the full suite goes green only against the merged engine.
 *
 * Runtime-neutral: imports the test facade, never 'bun:test' directly;
 * CLI runs are blackbox spawns via ./runtime.ts (CANS_ROOT pinned empty
 * so the walk-up resolution lands on the intended workspace).
 */
import { describe, test, expect, afterEach } from './testing.ts';
import { join } from 'path';
import { readFileSync, writeFileSync } from 'fs';

import { spawnCli } from './runtime.ts';
import { makeTmpDir, cleanTmpDir, copyFixtureToTmp } from './helpers.ts';

// ── harness (the issue-69/#70/#71 contract pattern, verbatim) ──────────────

const tmps: string[] = [];

/** Fresh copy of the fixture into tmp: <tmp>/codebase-workspace/{cans,src}. */
function ws(name: string): string {
  const tmp = makeTmpDir(`issue72-contract-${name}`);
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

/** routes.ts:3 — the pre-existing broken slug, UNCHANGED by the #72 fix: the
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
 *  UNCHANGED by the #72 fix (the per-group widening adds .txt entries
 *  only; this .rs target's vocabulary gains nothing). */
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

/** artifact-wiring.rs:46 — the #69 broken artifact FILE. */
const BROKEN_ARTIFACT_FILE = {
  type: 'CodebaseBrokenReference',
  file: 'src/plugins/artifact-wiring.rs',
  line: 46,
  raw: 'see: cans/artifacts/code/plugin-trait.rs#PluginError',
  targetFile: 'cans/artifacts/code/plugin-trait.rs',
  targetSlug: 'PluginError',
  reason: 'FileNotFound',
};

/** trait-wiring.rs:106 — the issue #70 trait-method typo, UNCHANGED. */
const BROKEN_70_TYPO_METHOD = {
  type: 'CodebaseBrokenReference',
  file: 'src/plugins/trait-wiring.rs',
  line: 106,
  raw: 'see: cans/artifacts/code/container-service.rs#configure_runtim',
  targetFile: 'cans/artifacts/code/container-service.rs',
  targetSlug: 'configure_runtim',
  reason: 'AnchorNotFound',
};

/** trait-wiring.rs:109 — the issue #70 import-name typo, UNCHANGED. */
const BROKEN_70_TYPO_NAME = {
  type: 'CodebaseBrokenReference',
  file: 'src/plugins/trait-wiring.rs',
  line: 109,
  raw: 'see: cans/artifacts/examples/swarm-agent.rs#LedgerPlugn',
  targetFile: 'cans/artifacts/examples/swarm-agent.rs',
  targetSlug: 'LedgerPlugn',
  reason: 'AnchorNotFound',
};

/** quota.py:7 — the pre-existing broken file, UNCHANGED by the #72 fix. */
const BROKEN_FILE = {
  type: 'CodebaseBrokenReference',
  file: 'src/storage/quota.py',
  line: 7,
  raw: 'see: 09-observability.md',
  targetFile: '09-observability.md',
  targetSlug: null,
  reason: 'FileNotFound',
};

/** trap.rs:7 — the issue #71 PHRASE typo, UNCHANGED by the #72 fix: the
 *  per-group widening mints `Kernel seccomp-unotify triggers` (line 8 of
 *  trap-flow.txt) on BOTH engines — the #71 single-pair/unbracketed rules
 *  are byte-unchanged — so the entry spelling keeps its did-you-mean in
 *  b2 and the heal in d. */
const BROKEN_71_TYPO_PHRASE = {
  type: 'CodebaseBrokenReference',
  file: 'src/trap.rs',
  line: 7,
  raw: 'see: cans/artifacts/diagrams/trap-flow.txt#Kernel-seccomp-unotify-trigger',
  targetFile: 'cans/artifacts/diagrams/trap-flow.txt',
  targetSlug: 'Kernel-seccomp-unotify-trigger',
  reason: 'AnchorNotFound',
};

/** The EIGHT broken records, in the contract's deterministic order (file
 *  asc, line asc): the #71 eight, byte-identical — the #72 extension adds
 *  NO broken record. `src/net-refs.rs` would sort between `src/api/
 *  routes.ts` and `src/plugins/…` (n: a < n < p), so on the BARE 0.20.0
 *  engine the false `src/net-refs.rs:3` record slots in SECOND and the
 *  false `src/transport.rs:3` record slots in NINTH (after quota.py:7,
 *  before trap.rs:7 — `transport` < `trap` at the fourth char). Every
 *  VALID pointer — the two #72 repro pointers and the #72 control
 *  included — is missing from this set. */
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

/** The three VALID #72 pointers' written spans — none may be reported
 *  broken post-#72 (the heart of the issue: each bracketed group on a
 *  line is its own entry, so the group a phrase names answers it; the
 *  lone span keeps the #71 single-pair strip — the widening never
 *  narrows). */
const VALID_72_RAWS = [
  'see: cans/artifacts/diagrams/t.txt#FOO-BAR-BAZ',
  'see: cans/artifacts/diagrams/t.txt#SOLO-ENTRY-HERE',
  'see: cans/artifacts/diagrams/wire-plane.txt#USERSPACE-SMOLTCP-INGRESS-RING',
];

/** The carrier's pointer lines, byte-authoritative (README table). The
 *  issue's repro at line 3; the single-pair CONTROL at line 8 (the
 *  trap.rs/transport.rs shape — a three-line doc block above it). */
const NET_REFS = {
  l3: '// see: cans/artifacts/diagrams/t.txt#FOO-BAR-BAZ',
  l8: '// see: cans/artifacts/diagrams/t.txt#SOLO-ENTRY-HERE',
};
const TRANSPORT = {
  l3: '// see: cans/artifacts/diagrams/wire-plane.txt#USERSPACE-SMOLTCP-INGRESS-RING',
  l7: '// see: cans/artifacts/diagrams/wire-plane.txt#SMOLTCP',
};

/** The e1-shaped rules (no codebase block) + the fixture's own plugin-tier
 *  wiring and redundancy knobs — the RULES_NO_CODEBASE variant the #67/#68
 *  a2 pins drive the pure-defaults census with (the codebase block is
 *  dropped so the RFC §3 DEFAULT include list governs the scan). */
const RULES_NO_CODEBASE = [
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
].join('\n');

// ── a: the check scan — the per-group widening validates, never mints ──────

describe('issue #72 a — check --codebase: the two pointers join the census, the groups resolve, nothing new breaks', () => {
  test('a1: config-on — 17 scanned / 56 pointers / EXACTLY the 8 broken records, zero findings for the repro pointers and the control', () => {
    const p = ws('a1');
    const r = runCli(['check', '--codebase', '--json'], p);
    expect(r.exit).toBe(2); // severity: error → the error band (8 true findings)
    const j = parseJsonOut(r.out);
    expect(j.codebase).toBeDefined();
    // 16 post-#71 sources + the net-refs.rs carrier (the .txt targets live
    // under cans/ — workspace files are never scanned).
    expect(j.codebase.scanned).toBe(17);
    // 54 post-#71 pointers + the two #72 ones (the repro + the control).
    expect(j.codebase.pointers).toBe(56);
    expect(j.codebase.broken).toBe(8);
    expect(j.counts.errors).toBe(8);
    // THE pin: the broken set is byte-exactly the eight records above, in
    // the deterministic order (file asc, line asc) — the SAME eight as
    // #71 (the extension adds no broken record; net-refs.rs would sort
    // between routes.ts and the plugins, and it is NOT there).
    expect(j.codebase.issues).toEqual(ORACLE_ISSUES);
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
    // And made explicit — the heart of the issue: ZERO findings for the
    // two repro pointers and the CONTROL (`#FOO-BAR-BAZ` through the
    // per-group entry `FOO BAR BAZ`, `#USERSPACE-SMOLTCP-INGRESS-RING`
    // through the per-group entry `USERSPACE SMOLTCP INGRESS RING`,
    // `#SOLO-ENTRY-HERE` through the #71 single-pair strip — the control
    // resolves on BOTH sides of the merge).
    for (const raw of VALID_72_RAWS) {
      expect((j.codebase.issues as any[]).some((i) => i.raw === raw)).toBe(false);
    }
    // The two carriers of the #72 pointers carry NO finding at all —
    // net-refs.rs is clean, and transport.rs is clean too (its #71
    // repro pointer resolves through the per-group entry over the
    // now-three-group wire-plane row).
    const netRefsIssues = (j.codebase.issues as any[]).filter((i) => i.file === 'src/net-refs.rs');
    expect(netRefsIssues).toEqual([]);
    const transportIssues = (j.codebase.issues as any[]).filter((i) => i.file === 'src/transport.rs');
    expect(transportIssues).toEqual([]);
  });

  test('a2: the eight findings ride sections.refs as codebase.broken_reference errors', () => {
    const p = ws('a2');
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
    expect(j.counts.errors).toBeGreaterThanOrEqual(8);
  });

  test('a3: EXACTLY ONE warning — still the empty-metrics advisory, never a finding', () => {
    const p = ws('a3');
    // The warnings class, engine-independent: the #72 extension adds NO
    // empty target and NO vocabulary-less pointer — the t.txt target
    // carries leaf-token vocabulary (FOO, BAR, BAZ, …), so its pre-fix
    // miss was an ERROR (the issue's report), never a warning. The one
    // warning of the run is the #70-era empty-metrics advisory, rule
    // codebase.anchor.no-target, line 115 — pinned by RULE and LINE,
    // never by wording (the engine branch owns the message enumeration).
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

  test('a4: pure defaults (no config block) — 15 scanned / 54 pointers / 9 broken, the repro resolves without any config', () => {
    const p = ws('a4');
    // net-refs.rs is a `.rs` source, so the RFC §3 DEFAULT include list
    // covers it (the #67 a2 variant's rules rewrite drops the codebase
    // block): the census grows to 15 / 54 and the rules-key pointer
    // `cans/_rules.yaml#codebase.enabled` breaks HERE — the rewrite
    // deleted the key it names (the #69 honesty rule, one MORE broken
    // than config-on). The two #72 pointers resolve in this world too —
    // the per-group widening is engine config, never scan config.
    writeFileSync(join(p, 'cans', '_rules.yaml'), RULES_NO_CODEBASE, 'utf8');
    const r = runCli(['check', '--codebase', '--json'], p);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.codebase.scanned).toBe(15); // 14 post-#71 + net-refs.rs (the .rs default)
    expect(j.codebase.pointers).toBe(54); // 52 post-#71 + the two #72 pointers
    expect(j.codebase.broken).toBe(9); // the 8 + the rules-key pointer
    expect(j.counts.errors).toBe(9);
    // The two repro pointers and the control resolve under the pure
    // defaults too — zero findings for their written spans.
    for (const raw of VALID_72_RAWS) {
      expect((j.codebase.issues as any[]).some((i) => i.raw === raw)).toBe(false);
    }
    expect((j.codebase.issues as any[]).map((i) => `${i.file}:${i.line}`)).toEqual([
      'src/api/routes.ts:3',
      'src/plugins/artifact-wiring.rs:28', // the rules-key pointer, this variant's own break
      'src/plugins/artifact-wiring.rs:36',
      'src/plugins/artifact-wiring.rs:40',
      'src/plugins/artifact-wiring.rs:46',
      'src/plugins/trait-wiring.rs:106',
      'src/plugins/trait-wiring.rs:109',
      'src/storage/quota.py:7',
      'src/trap.rs:7',
    ]);
    // The yaml carriers stay out (no *.yaml in the default list) — and
    // net-refs.rs is IN (the default *.rs).
    expect((j.codebase.issues as any[]).some((i) => i.file === 'src/plugins/mounts.yaml')).toBe(false);
  });
});

// ── b: the wire shape + the human report ───────────────────────────────────

describe('issue #72 b — the findings on the wire and in the human report', () => {
  test('b1: --json carries targetFile/targetSlug VERBATIM with reason AnchorNotFound, the frozen 7-key shape', () => {
    const p = ws('b1');
    const j = parseJsonOut(runCli(['check', '--codebase', '--json'], p).out);
    // The #71 typo record, selected by its WRITTEN span (unique in the
    // fixture): the pin is stable pre- and post-merge — the record exists
    // with the same wire shape on BOTH engines (the #72 widening never
    // narrows: the unbracketed trap-flow line 8 keeps minting its entry,
    // so the singular typo stays a near miss with the same shape). The
    // two FALSE records' wire shape was verified by running on the bare
    // engine — same frozen 7 keys — but they are ABSENT post-merge (the
    // heart of the issue), so they cannot be the selection here.
    const trapIssues = (j.codebase.issues as any[]).filter(
      (i) => i.raw === 'see: cans/artifacts/diagrams/trap-flow.txt#Kernel-seccomp-unotify-trigger',
    );
    expect(trapIssues.map((i) => [i.targetFile, i.targetSlug, i.reason])).toEqual([
      ['cans/artifacts/diagrams/trap-flow.txt', 'Kernel-seccomp-unotify-trigger', 'AnchorNotFound'],
    ]);
    // The 7-key wire shape holds for every record exactly as always (the
    // frozen #66 contract, issue66-integration a2).
    const ISSUE_KEYS = ['type', 'file', 'line', 'raw', 'targetFile', 'targetSlug', 'reason'].sort();
    for (const issue of j.codebase.issues as any[]) {
      expect(Object.keys(issue).sort()).toEqual(ISSUE_KEYS);
    }
  });

  test('b2: the human report folds EIGHT and the false records appear NOWHERE — the show output carries only true findings', () => {
    const p = ws('b2');
    // The folded view names the family with its count (8 broken, the #71
    // eight — the #72 extension adds none); --show refs unfolds every
    // member (the issue66-integration a4 pattern). The two FALSE records
    // and the control appear NOWHERE in the unfolded findings — the
    // repro pointers resolve, so they are not findings at all — while
    // the #71 typo keeps its phrase did-you-mean (the entry spelling,
    // unchanged by the per-group widening).
    const folded = runCli(['check', '--codebase'], p);
    expect(folded.exit).toBe(2);
    expect(folded.out + folded.err).toContain('8× broken codebase ref');
    const ex = runCli(['check', '--codebase', '--show', 'refs'], p);
    expect(ex.exit).toBe(2);
    expect(ex.out + ex.err).toContain('Kernel-seccomp-unotify-trigger');
    expect(ex.out + ex.err).toContain(
      'did you mean cans/artifacts/diagrams/trap-flow.txt#Kernel-seccomp-unotify-triggers? — fix the ref anchor',
    );
    // The heart, made explicit: neither repro span nor the control rides
    // the human findings — the multi-group t.txt line and the
    // three-group wire-plane row answer their phrase anchors, and the
    // lone span keeps its #71 resolution.
    expect(ex.out + ex.err).not.toContain('t.txt#FOO-BAR-BAZ');
    expect(ex.out + ex.err).not.toContain('t.txt#SOLO-ENTRY-HERE');
    expect(ex.out + ex.err).not.toContain('wire-plane.txt#USERSPACE-SMOLTCP-INGRESS-RING');
    expect(ex.out + ex.err).not.toContain('src/net-refs.rs');
  });
});

// ── c: the reverse path — the refs artifact query tier ─────────────────────

describe('issue #72 c — refs <artifact> --codebase: the group anchors answer their writers', () => {
  test('c1: the two repro anchored queries and the control answer their exact carrier lines (never fuzzy)', () => {
    const p = ws('c1');
    // The reverse path matches WRITERS by anchor equality — it answers
    // whatever a source wrote, valid or broken, so these pins are
    // engine-independent (green pre-merge: extraction is untouched by
    // the vocabulary fix).
    const queries: Array<[string, string, number, string]> = [
      ['cans/artifacts/diagrams/t.txt#FOO-BAR-BAZ', 'src/net-refs.rs', 3, NET_REFS.l3],
      ['cans/artifacts/diagrams/t.txt#SOLO-ENTRY-HERE', 'src/net-refs.rs', 8, NET_REFS.l8],
      ['cans/artifacts/diagrams/wire-plane.txt#USERSPACE-SMOLTCP-INGRESS-RING', 'src/transport.rs', 3, TRANSPORT.l3],
      ['cans/artifacts/diagrams/wire-plane.txt#SMOLTCP', 'src/transport.rs', 7, TRANSPORT.l7],
    ];
    for (const [q, file, line, text] of queries) {
      const r = runCli(['refs', q, '--codebase', '--json'], p);
      expect(r.exit).toBe(0);
      const j = parseJsonOut(r.out);
      expect(j.ok).toBe(true);
      expect(j.command).toBe('refs');
      expect(j.node).toBe(q); // the query AS WRITTEN
      expect(j.scanned).toBe(17);
      expect(j.matches).toEqual([{ file, line, text }]);
    }
  });

  test('c2: the t.txt file-level query answers BOTH its pointers, regardless of anchor', () => {
    const p = ws('c2');
    // File-level (no #slug): the repro AND the control both answer for
    // t.txt — the file is the same; anchors are irrelevant at this query
    // shape (the #66 c2 contract, artifact side — the #71 c4 pattern).
    const j = parseJsonOut(
      runCli(['refs', 'cans/artifacts/diagrams/t.txt', '--codebase', '--json'], p).out,
    );
    expect(j.exitCode).toBe(0);
    expect(j.matches).toEqual([
      { file: 'src/net-refs.rs', line: 3, text: NET_REFS.l3 },
      { file: 'src/net-refs.rs', line: 8, text: NET_REFS.l8 },
    ]);
  });

  test('c3: the wire-plane file-level query answers ALL its pointers, over the three-group row', () => {
    const p = ws('c3');
    // The #71 c4 pin, re-run over the EXTENDED wire-plane line 5: the
    // phrase pointer AND the single-token control both answer — the
    // diagram's growth moved no writer.
    const wire = parseJsonOut(
      runCli(['refs', 'cans/artifacts/diagrams/wire-plane.txt', '--codebase', '--json'], p).out,
    );
    expect(wire.exitCode).toBe(0);
    expect(wire.matches).toEqual([
      { file: 'src/transport.rs', line: 3, text: TRANSPORT.l3 },
      { file: 'src/transport.rs', line: 7, text: TRANSPORT.l7 },
    ]);
  });

  test('c4: a TRUNCATED phrase answers ZERO matches — the anchor comparison is never fuzzy', () => {
    const p = ws('c4');
    // The zero-match half of the c-class, through a spelling that truly
    // has no writer: `#FOO-BAR-BAZZ` (the issue's anchor plus one char).
    // Zero matches IS an answer — the reverse path traces WRITERS, not
    // resolvability, and it never heals a misspelled anchor into the
    // written one (the #67 d4 / #71 c3 precedent).
    const j = parseJsonOut(
      runCli(['refs', 'cans/artifacts/diagrams/t.txt#FOO-BAR-BAZZ', '--codebase', '--json'], p).out,
    );
    expect(j.exitCode).toBe(0);
    expect(j.ok).toBe(true);
    expect(j.matches).toEqual([]);
  });

  test('c5: a group name that EXISTS in the diagram but no source writes answers ZERO matches', () => {
    const p = ws('c5');
    // `other-one` IS an entry of t.txt post-#72 (the second bracket group
    // of line 1, `[other one]` — the per-group widening mints it), but no
    // source file points at it — zero matches is an answer (the #70
    // `#LedgerCtx` / #71 `#Shim-polls…` precedent, group edition: the
    // vocabulary exists, the writer does not).
    const j = parseJsonOut(
      runCli(['refs', 'cans/artifacts/diagrams/t.txt#other-one', '--codebase', '--json'], p).out,
    );
    expect(j.exitCode).toBe(0);
    expect(j.ok).toBe(true);
    expect(j.matches).toEqual([]);
  });

  test('c6: the .md regression query still answers its pre-existing matches (and ONLY those)', () => {
    const p = ws('c6');
    // The #66 c1 pin, re-run over the extended fixture: the .md tier is
    // untouched by the #72 widening — same three matches, and no
    // artifact pointer leaks into a corpus query (the non-crossing pin).
    const j = parseJsonOut(runCli(['refs', '01-auth.md#Sessions', '--codebase', '--json'], p).out);
    expect(j.exitCode).toBe(0);
    expect(j.scanned).toBe(17); // 16 post-#71 + the net-refs.rs carrier
    expect(j.matches.map((m: any) => `${m.file}:${m.line}`)).toEqual([
      'src/api/routes.ts:2',
      'src/api/routes.ts:6',
      'src/session.rs:2',
    ]);
  });
});

// ── d: the exit-code ladder, re-pinned over the shifted census ─────────────

describe('issue #72 d — the exit ladder over the 17/56 census: 0 clean / 1 warnings / 2 errors', () => {
  /** Heal the EIGHT error records of the tmp copy — the #71 heal set,
   *  UNCHANGED (NO new typo pointer was added for #72: net-refs.rs and
   *  the wire-plane row carry only VALID pointers, so there is nothing
   *  new to heal). The typo pattern stays NEWLINE-ANCHORED:
   *  `#Kernel-seccomp-unotify-trigger` is a PREFIX of the VALID
   *  `…-triggers` pointer at trap.rs:3, so a bare String.replace would
   *  corrupt the valid occurrence first (the #70 merge-commit lesson). */
  function healErrors(p: string): void {
    const w = (rel: string, fn: (t: string) => string): void => {
      const target = join(p, rel);
      writeFileSync(target, fn(readFileSync(target, 'utf8')), 'utf8');
    };
    w('src/api/routes.ts', t => t.replace('#Qutas', '#Quotas'));
    w('src/storage/quota.py', t => t.replace('see: 09-observability.md', 'see: 07-network.md'));
    w('src/plugins/artifact-wiring.rs', t => t
      .replace('see: cans/artifacts/examples/multi-vm-swarm.rs#federateNope', 'see: cans/artifacts/examples/multi-vm-swarm.rs#federate')
      .replace('see: cans/artifacts/diagrams/host-runtime.txt#driver-avf-nope', 'see: cans/artifacts/diagrams/host-runtime.txt#driver-avf')
      .replace('see: cans/artifacts/code/plugin-trait.rs#PluginError', 'see: cans/artifacts/examples/multi-vm-swarm.rs#federate'));
    w('src/plugins/trait-wiring.rs', t => t
      .replace('see: cans/artifacts/code/container-service.rs#configure_runtim\n', 'see: cans/artifacts/code/container-service.rs#configure_runtime\n')
      .replace('see: cans/artifacts/examples/swarm-agent.rs#LedgerPlugn', 'see: cans/artifacts/examples/swarm-agent.rs#LedgerPlugin'));
    w('src/trap.rs', t => t
      .replace('see: cans/artifacts/diagrams/trap-flow.txt#Kernel-seccomp-unotify-trigger\n', 'see: cans/artifacts/diagrams/trap-flow.txt#Kernel-seccomp-unotify-triggers\n'));
  }

  test('d1: the RAW fixture — the error band, EXIT CODE 2 (17/56/8+1)', () => {
    const p = ws('d1');
    const r = runCli(['check', '--codebase', '--json'], p);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(false);
    expect(j.exitCode).toBe(2);
    expect(j.codebase.scanned).toBe(17);
    expect(j.codebase.pointers).toBe(56);
    expect(j.codebase.broken).toBe(8);
    expect(j.counts.errors).toBe(8);
    expect(j.counts.warnings).toBe(1); // the empty-metrics advisory rides along
  });

  test('d2: errors healed, advisory kept — ok:true, errors 0, warnings 1, EXIT CODE 1', () => {
    const p = ws('d2');
    healErrors(p);
    // The #41 ladder over the SHIFTED census: the only finding class left
    // is the warnings-only empty-metrics advisory — warnings never dirty
    // `ok`, and the band is 1, NOT 0 and NOT 2. The two #72 repro
    // pointers resolve, so the healed tree is truly clean of errors.
    const r = runCli(['check', '--codebase', '--json'], p);
    expect(r.exit).toBe(1);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect(j.exitCode).toBe(1);
    expect(j.counts.errors).toBe(0);
    expect(j.counts.warnings).toBe(1);
    expect(j.codebase.scanned).toBe(17);
    expect(j.codebase.pointers).toBe(56);
    expect(j.codebase.broken).toBe(0);
    expect(j.codebase.issues).toEqual([]);
  });

  test('d3: the advisory healed too — EXIT CODE 0, not a warning in sight', () => {
    const p = ws('d3');
    healErrors(p);
    // The last heal: the advisory pointer drops to its file-level spelling
    // (valid on any target) — band 0, the fully-healed tree.
    const tw = join(p, 'src', 'plugins', 'trait-wiring.rs');
    writeFileSync(
      tw,
      readFileSync(tw, 'utf8').replace(
        'see: cans/artifacts/diagrams/empty-metrics.txt#anything',
        'see: cans/artifacts/diagrams/empty-metrics.txt',
      ),
      'utf8',
    );
    const r = runCli(['check', '--codebase', '--json'], p);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect(j.exitCode).toBe(0);
    expect(j.counts.errors).toBe(0);
    expect(j.counts.warnings).toBe(0);
    expect(j.codebase.pointers).toBe(56);
    expect(j.codebase.broken).toBe(0);
  });
});

// ── e: the corpus band is untouched ─────────────────────────────────────────

describe('issue #72 e — the extension adds an artifact and one source, never a corpus file', () => {
  test('e1: the plain check stays clean with NO codebase key and the #68 corpus counts unchanged', () => {
    const p = ws('e1');
    // The committed _rules.yaml carries `codebase.enabled: true`, so the
    // corpus-band comparison strips the block first (the #68 c1 / #69 d1 /
    // #70 e1 / #71 e1 variant: aliasing tier kept on — the plugin specs
    // stay loaded — redundancy knobs the README documents, no codebase
    // block). Over that workspace the plain check never scans: the #72
    // diagram target and the carrier are invisible to the corpus band,
    // so the #68 c1 pins hold verbatim: exit 0, no codebase key, refs
    // 11, files 9.
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
