/**
 * Issue #71 — the CONTRACT suite: `cans check --codebase` 0.19.0 on kelir
 * still reports two errors for pointers that are RIGHT — multi-word
 * hyphenated PHRASE anchors into `.txt` diagram targets:
 *   · `crates/kelir-shim/src/trap.rs:3` —
 *     `see: cans/artifacts/diagrams/trap-flow.txt#
 *     Kernel-seccomp-unotify-triggers`, whose target line 8 IS
 *     `Kernel seccomp-unotify triggers`;
 *   · `crates/kelir-transport/src/lib.rs:3` —
 *     `see: cans/artifacts/diagrams/wire-plane.txt#
 *     USERSPACE-SMOLTCP-INGRESS-RING`, whose target line 5 IS
 *     `[USERSPACE SMOLTCP INGRESS RING]`.
 * Both miss: the #60 heading tier addresses section titles only (the
 * entries are mixed-case flow lines and mid-box bracket lines, never
 * headings), the #70 leaf-token tier addresses single tokens only (no
 * token is the whole phrase) — `broken anchor: … — no node matches`,
 * the issue's two errors. Single-token anchors into the same files
 * (`#kelir-shim`, `#virtio-shm`, `#driver-avf`) already resolve.
 *
 * THE FROZEN FIX SPEC this suite is written against (the engine half lands
 * on fix/issue-71-engine): a NEW ENTRY tier for `.txt`/`.text` targets —
 * `extractTextEntries(source)` in src/core/text-anchors.ts: per physical
 * line, trim; strip LEADING runs of Unicode box-drawing chars (U+2500–
 * U+257F) + whitespace; strip ONE outermost ASCII `[…]` pair only when
 * the text contains exactly one `[` and one `]`; skip if < 2 chars or no
 * letter (`/\p{L}/u`); dedupe first-occurrence document order. Wired into
 * refs.ts checkArtifactAnchor between the heading tier and the leaf-token
 * tier (probe `[...extraVocab, ...entryVocab, ...leafVocab]`, the same
 * widened union for miss suggestions; the no-target condition gains
 * entries-empty; the no-target message enumeration gains `text entries, `
 —
 * engine-owned wording, never pinned here). Consequence:
 * `#Kernel-seccomp-unotify-triggers` resolves against the line `Kernel
 * seccomp-unotify triggers` (normalizeForAnchor already folds `-`↔space)
 * and `#USERSPACE-SMOLTCP-INGRESS-RING` resolves against `[USERSPACE
 * SMOLTCP INGRESS RING]`. Everything else unchanged: the broken-anchor
 * message `broken anchor: <display>#<anchor> — no node matches`, the
 * suggestion shapes, the exit ladder, the wire shape.
 *
 * THE FIXTURE WIRING (README "issue #71 extension"), kelir-shaped after
 * the issue's live tree: `cans/artifacts/diagrams/trap-flow.txt` (line 8
 * EXACTLY `Kernel seccomp-unotify triggers` under a `THE UNOTIFY TRAP
 * FLOW` all-caps heading — so the file carries heading vocabulary and the
 * pre-fix miss is an ERROR, the issue's shape, never a no-target warning)
 * and `cans/artifacts/diagrams/wire-plane.txt` (line 5 EXACTLY
 * `[USERSPACE SMOLTCP INGRESS RING]`, physically BELOW a NON-blank
 * box-drawing line — the #60 standalone-paragraph guard keeps it a
 * non-heading by design, exactly the kelir reality), plus the scanned
 * carriers `src/trap.rs` (the repro phrase pointer at line 3, mirroring
 * the issue's trap.rs:3, and the near-miss SINGULAR typo
 * `#Kernel-seccomp-unotify-trigger` at line 7) and `src/transport.rs`
 * (the bracketed repro at line 3, mirroring lib.rs:3, and the
 * single-token CONTROL `#SMOLTCP` at line 7 — a word token of the very
 * same box line, resolved by the #70 leaf tier on BOTH sides of the
 * merge: the entry tier widens the vocabulary, never narrows it).
 *
 * CENSUS ARITHMETIC (verified by RUNNING under the engine spec, never
 * assumed): scanned 14 → 16 (the two .rs carriers, covered by the
 * committed `*.rs` include glob AND the RFC §3 default), pointers 50 → 54
 * (the four #71 pointers), broken 7 → 8 post-#71 (the seven #70-era
 * records PLUS the #71 phrase typo at trap.rs:7, which sorts AFTER
 * quota.py — file asc, line asc, the deterministic order; NOT insertion
 * order, the #70 merge-fixup lesson), warnings exactly 1 still (the
 * empty-metrics advisory — the repro targets have vocabulary, so their
 * pre-fix misses are ERRORS, the issue's report). On the BARE 0.19.0
 * engine: 16 / 54 / 10 broken (the 8 + the two repro phrase pointers as
 * FALSE errors) + the same 1 warning.
 * RE-PINNED for #72 (fixture growth only, no verdict moved): the #72
 * extension adds the net-refs.rs carrier (+1 scanned, +2 pointers — both
 * VALID, resolved by the #72 per-group widening the engine merge brings)
 * and grows wire-plane.txt line 5 into a three-group row (its #71 repro
 * pointer keeps resolving, through the group entry now) — so the pins
 * below read 17 scanned / 56 pointers; the EIGHT broken records, the
 * fold, the rides and the ladder rungs are UNCHANGED (net-refs.rs adds no
 * broken record, and `#SMOLTCP`/`#SOLO-ENTRY-HERE`-class single-pair and
 * leaf controls keep their world).
 *
 * WHAT EACH BLOCK PINS (all blackbox via the real CLI, the issue-66/67/68/
 * 69/70 integration harness pattern; the fixture is driven from a fresh tmp
 * copy):
 *
 *   a ....... the check scan over the extended fixture: config-on
 *             16 scanned / 54 pointers / EXACTLY the EIGHT broken records
 *             byte-pinned in the deterministic file-asc line-asc order
 *             (the seven #70-era ones + the #71 phrase typo, LAST —
 *             trap.rs sorts after quota.py) and EXACTLY ONE warning (the
 *             empty-metrics no-target advisory, rule
 *             codebase.anchor.no-target) and ZERO findings for the two
 *             repro phrase pointers and the control — the heart of the
 *             issue
 *   b ....... the wire + the human report: the new record carries
 *             targetFile/targetSlug VERBATIM with reason AnchorNotFound
 *             and the frozen 7-key shape (green pre-merge — selected by
 *             written span, the finding exists with the same shape on the
 *             bare engine, only the two repro pointers' verdicts are
 *             wrong); the folded view reads `8× broken codebase ref` and
 *             `--show refs` carries the EXACT did-you-mean
 *             `did you mean cans/artifacts/diagrams/trap-flow.txt#
 *             Kernel-seccomp-unotify-triggers? — fix the ref anchor`
 *             (red pre-merge: the bare suggestion pool of the typo target
 *             is empty — headings and tokens only, nothing within
 *             Levenshtein of the phrase)
 *   c ....... the reverse path, the refs ARTIFACT tier (green pre-merge —
 *             a query answers WRITERS, never verdicts): the two repro
 *             anchored queries answer their exact carrier lines; the TYPO
 *             spelling answers its writer line too (the #69 `#federateNope`
 *             / #70 `#configure_runtim` precedent); the file-level queries
 *             answer ALL their pointers; a TRUNCATED phrase answers ZERO
 *             matches (never fuzzy); a `.md` regression query still
 *             answers its pre-existing matches over the 17-file scan
 *   d ....... the exit-code ladder re-pinned over the SHIFTED census: the
 *             raw fixture exits 2 (8 errors + 1 warning, ok:false);
 *             healing ALL EIGHT error records in the tmp copy (the #71
 *             typo heal NEWLINE-ANCHORED — `#Kernel-seccomp-unotify-
 *             trigger` is a PREFIX of the valid `…-triggers` pointer at
 *             line 3, so a bare String.replace would corrupt the valid
 *             occurrence first, the #70 merge-fixup lesson) leaves the
 *             warnings-only band — ok:true, errors 0, warnings 1, EXIT 1;
 *             healing the advisory too (the empty-metrics pointer to its
 *             file-level spelling) is band 0 — EXIT 0
 *   e ....... the corpus band is untouched: the plain check (no flag)
 *             stays clean with NO codebase key, refs.total 11 / files 9 —
 *             the extension added workspace ARTIFACT files and two
 *             scanned sources, never a corpus file
 *
 * HONESTY NOTE (RED by design, the #68/#69/#70 contract model): on the
 * contract branch ALONE — before the fix/issue-71-engine merge — the pins
 * that count the two repro phrase pointers as RESOLVED are red, verified
 * by running (bare census: 16 scanned / 54 pointers / 10 broken + the 1
 * warning, the repro records at src/transport.rs:3 and src/trap.rs:3):
 * a1 (the census reads 10 broken, not 8, and the oracle list gains the
 * two false records), a2 (ten findings ride sections.refs, not eight),
 * b2 (the fold reads `10×` and NO did-you-mean line exists — the bare
 * suggestion pool of the typo target is empty), d2/d3 (the healed tree
 * still carries the two false errors + the healed-as-written typo, so
 * both rungs read exit 2, not 1/0). The green-on-bare pins are the
 * contract half that must STAY green across the merge: a3 (the warnings
 * class — rule and count and the advisory's line, engine-independent),
 * b1 (the new record's wire shape, selected by written span), c1–c6 (the
 * reverse path answers writers regardless of verdicts), d1 (the raw
 * fixture's error band — exit 2 either way), e1 (the corpus band
 * untouched). Merge order: engine first, then this branch — the full
 * suite goes green only against the merged engine.
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

// ── harness (the issue-69/#70 contract pattern, verbatim) ─────────────────

const tmps: string[] = [];

/** Fresh copy of the fixture into tmp: <tmp>/codebase-workspace/{cans,src}. */
function ws(name: string): string {
  const tmp = makeTmpDir(`issue71-contract-${name}`);
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

/** routes.ts:3 — the pre-existing broken slug, UNCHANGED by the #71 fix: the
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
 *  UNCHANGED by the #71 fix (the entry tier adds .txt entries only; the
 *  suggestion pool of this .rs target gains nothing, `federateNope` stays
 *  ≥ distance 4 from every candidate — verified: no suggestion either). */
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

/** quota.py:7 — the pre-existing broken file, UNCHANGED by the #71 fix. */
const BROKEN_FILE = {
  type: 'CodebaseBrokenReference',
  file: 'src/storage/quota.py',
  line: 7,
  raw: 'see: 09-observability.md',
  targetFile: '09-observability.md',
  targetSlug: null,
  reason: 'FileNotFound',
};

/** trap.rs:7 — the issue #71 PHRASE typo: the SINGULAR near miss of the
 *  trap-flow diagram's line-8 entry `Kernel seccomp-unotify triggers`.
 *  Post-#71 similarity = 1 − 1/31 ≈ 0.97 ≥ the 0.8 suggestion floor → the
 *  did-you-mean in b2; resolution never auto-heals. Pre-#71 the target's
 *  suggestion pool is headings + tokens only — nothing within Levenshtein
 *  of the 30-char phrase — so the finding carries NO suggestion on the
 *  bare engine (the red-by-design half of b2). */
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
 *  asc, line asc): the seven #70-era ones PLUS the #71 phrase typo —
 *  `src/trap.rs` sorts AFTER `src/storage/quota.py` (t > s) and BEFORE
 *  `src/worker/sweep.go` (t < w), so the new record slots in LAST among
 *  the findings. Every VALID pointer — the two #71 repro phrase pointers
 *  and the #71 control included — is missing from this set. */
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

/** The three VALID #71 pointers' written spans — none may be reported
 *  broken post-#71 (the heart of the issue: a phrase anchor resolves
 *  against the diagram entry it names — the entry is the whole line). */
const VALID_71_RAWS = [
  'see: cans/artifacts/diagrams/trap-flow.txt#Kernel-seccomp-unotify-triggers',
  'see: cans/artifacts/diagrams/wire-plane.txt#USERSPACE-SMOLTCP-INGRESS-RING',
  'see: cans/artifacts/diagrams/wire-plane.txt#SMOLTCP',
];

/** The two carriers' pointer lines, byte-authoritative (README table). */
const TRAP = {
  l3: '// see: cans/artifacts/diagrams/trap-flow.txt#Kernel-seccomp-unotify-triggers',
  l7: '// see: cans/artifacts/diagrams/trap-flow.txt#Kernel-seccomp-unotify-trigger',
};
const TRANSPORT = {
  l3: '// see: cans/artifacts/diagrams/wire-plane.txt#USERSPACE-SMOLTCP-INGRESS-RING',
  l7: '// see: cans/artifacts/diagrams/wire-plane.txt#SMOLTCP',
};

// ── a: the check scan — the entry tier validates, never mints ──────────────

describe('issue #71 a — check --codebase: the four pointers join the census, the phrases resolve, the typo breaks', () => {
  test('a1: config-on — 17 scanned / 56 pointers / EXACTLY the 8 broken records, zero findings for the repro phrases and the control', () => {
    const p = ws('a1');
    const r = runCli(['check', '--codebase', '--json'], p);
    expect(r.exit).toBe(2); // severity: error → the error band (8 true findings)
    const j = parseJsonOut(r.out);
    expect(j.codebase).toBeDefined();
    // 14 post-#70 sources + the two #71 .rs carriers + the #72 net-refs.rs
    // carrier (the .txt targets live under cans/ — workspace files are
    // never scanned).
    expect(j.codebase.scanned).toBe(17);
    // 50 post-#70 pointers + the four #71 ones (2 repro phrases + 1 typo +
    // 1 control) + the two #72 ones (the t.txt repro + its control).
    expect(j.codebase.pointers).toBe(56);
    expect(j.codebase.broken).toBe(8);
    expect(j.counts.errors).toBe(8);
    // THE pin: the broken set is byte-exactly the eight records above, in
    // the deterministic order (file asc, line asc) — the new record slots
    // in LAST (trap.rs sorts after quota.py, before worker/sweep.go).
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
    // two repro PHRASE pointers and the CONTROL (the phrase resolves
    // against the whole diagram line — `Kernel seccomp-unotify triggers`
    // through the `-`↔space fold, `[USERSPACE SMOLTCP INGRESS RING]`
    // through the one-outermost-bracket strip — and the single token
    // through the #70 leaf tier).
    for (const raw of VALID_71_RAWS) {
      expect((j.codebase.issues as any[]).some((i) => i.raw === raw)).toBe(false);
    }
    // The two carriers carry findings ONLY at the typo line — neither
    // repro pointer nor control is ever a finding.
    const trapIssues = (j.codebase.issues as any[]).filter((i) => i.file === 'src/trap.rs');
    expect(trapIssues.map((i) => i.line)).toEqual([7]);
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
    // The warnings class, engine-independent: the #71 extension adds NO
    // empty target and NO vocabulary-less pointer — both repro targets
    // carry vocabulary (the trap-flow heading, the wire-plane heading and
    // tokens), so their pre-fix misses were ERRORS (the issue's report),
    // never warnings. The one warning of the run is the #70-era
    // empty-metrics advisory, rule codebase.anchor.no-target, line 115 —
    // pinned by RULE and LINE, never by wording (the engine branch owns
    // the message enumeration).
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

// ── b: the wire shape + the human suggestion ──────────────────────────────

describe('issue #71 b — the new finding on the wire and in the human report', () => {
  test('b1: --json carries targetFile/targetSlug VERBATIM with reason AnchorNotFound, the frozen 7-key shape', () => {
    const p = ws('b1');
    const j = parseJsonOut(runCli(['check', '--codebase', '--json'], p).out);
    // The new record, selected by its WRITTEN span (unique in the file, so
    // the pin is stable pre- and post-merge: pre-merge the finding exists
    // with the same wire shape, only the two repro pointers' verdicts are
    // wrong). The `cans/` prefix kept as written, the anchor as captured
    // (the full hyphenated phrase, no truncation at any dash), the reason
    // the frozen two-tier verdict vocabulary.
    const trapIssues = (j.codebase.issues as any[]).filter(
      (i) => i.raw === 'see: cans/artifacts/diagrams/trap-flow.txt#Kernel-seccomp-unotify-trigger',
    );
    expect(trapIssues.map((i) => [i.targetFile, i.targetSlug, i.reason])).toEqual([
      ['cans/artifacts/diagrams/trap-flow.txt', 'Kernel-seccomp-unotify-trigger', 'AnchorNotFound'],
    ]);
    // The 7-key wire shape holds for the new record exactly as for every
    // other (the frozen #66 contract, issue66-integration a2).
    const ISSUE_KEYS = ['type', 'file', 'line', 'raw', 'targetFile', 'targetSlug', 'reason'].sort();
    for (const issue of trapIssues) {
      expect(Object.keys(issue).sort()).toEqual(ISSUE_KEYS);
    }
  });

  test('b2: the human report carries the phrase did-you-mean — the entry spelling, EXACT', () => {
    const p = ws('b2');
    // The folded view names the family with its count (8 broken since
    // #71); --show refs unfolds every member (the issue66-integration a4
    // pattern), so the phrase typo and its suggestion are visible without
    // JSON.
    const folded = runCli(['check', '--codebase'], p);
    expect(folded.exit).toBe(2);
    expect(folded.out + folded.err).toContain('8× broken codebase ref');
    const ex = runCli(['check', '--codebase', '--show', 'refs'], p);
    expect(ex.exit).toBe(2);
    expect(ex.out + ex.err).toContain('Kernel-seccomp-unotify-trigger');
    // The suggestion layer knows the answer (engine spec: the miss ranking
    // runs over the widened union — declarations + ENTRIES + leaves): the
    // singular typo is similarity ≈ 0.97 from the entry `Kernel
    // seccomp-unotify triggers`, whose canonical anchorSlug is exactly the
    // entry spelling `#Kernel-seccomp-unotify-triggers` — the spelling the
    // repro pointer at line 3 already writes and that RESOLVES.
    expect(ex.out + ex.err).toContain(
      'did you mean cans/artifacts/diagrams/trap-flow.txt#Kernel-seccomp-unotify-triggers? — fix the ref anchor',
    );
  });
});

// ── c: the reverse path — the refs artifact query tier ─────────────────────

describe('issue #71 c — refs <artifact> --codebase: the phrase anchors answer their writers', () => {
  test('c1: the two repro anchored queries answer their exact carrier lines (never fuzzy)', () => {
    const p = ws('c1');
    // The reverse path matches WRITERS by anchor equality — it answers
    // whatever a source wrote, valid or broken, so these pins are
    // engine-independent (green pre-merge: extraction is untouched by the
    // vocabulary fix).
    const queries: Array<[string, string, number, string]> = [
      ['cans/artifacts/diagrams/trap-flow.txt#Kernel-seccomp-unotify-triggers', 'src/trap.rs', 3, TRAP.l3],
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
      expect(j.scanned).toBe(17); // 16 post-#71 + the #72 net-refs.rs carrier
      expect(j.matches).toEqual([{ file, line, text }]);
    }
  });

  test('c2: the TYPO spelling answers its writer line too — the reverse path is a query, not a verdict', () => {
    const p = ws('c2');
    // `check` reports this pointer broken; `refs` still traces WHO writes
    // it — the two commands answer different questions over one engine
    // (the #69 `#federateNope` / #70 `#configure_runtim` precedent).
    const j = parseJsonOut(
      runCli(['refs', 'cans/artifacts/diagrams/trap-flow.txt#Kernel-seccomp-unotify-trigger', '--codebase', '--json'], p).out,
    );
    expect(j.exitCode).toBe(0);
    expect(j.matches).toEqual([
      { file: 'src/trap.rs', line: 7, text: TRAP.l7 },
    ]);
  });

  test('c3: a TRUNCATED phrase answers ZERO matches — the anchor comparison is never fuzzy', () => {
    const p = ws('c3');
    // The zero-match half of the c-class, through a spelling that truly
    // has no writer: `#USERSPACE-SMOLTCP-INGRESS-RIN` (the ring plural
    // dropped). Zero matches IS an answer — the reverse path traces
    // WRITERS, not resolvability, and it never heals a truncated anchor
    // into the written one (the #67 d4 precedent, phrase edition).
    const j = parseJsonOut(
      runCli(['refs', 'cans/artifacts/diagrams/wire-plane.txt#USERSPACE-SMOLTCP-INGRESS-RIN', '--codebase', '--json'], p).out,
    );
    expect(j.exitCode).toBe(0);
    expect(j.ok).toBe(true);
    expect(j.matches).toEqual([]);
  });

  test('c4: the file-level queries answer ALL their pointers, regardless of anchor', () => {
    const p = ws('c4');
    // File-level (no #slug): the repro phrase AND the typo both answer for
    // trap-flow.txt, the repro phrase AND the control for wire-plane.txt —
    // the file is the same; anchors are irrelevant at this query shape
    // (the #66 c2 contract, artifact side).
    const trap = parseJsonOut(
      runCli(['refs', 'cans/artifacts/diagrams/trap-flow.txt', '--codebase', '--json'], p).out,
    );
    expect(trap.exitCode).toBe(0);
    expect(trap.matches).toEqual([
      { file: 'src/trap.rs', line: 3, text: TRAP.l3 },
      { file: 'src/trap.rs', line: 7, text: TRAP.l7 },
    ]);
    const wire = parseJsonOut(
      runCli(['refs', 'cans/artifacts/diagrams/wire-plane.txt', '--codebase', '--json'], p).out,
    );
    expect(wire.exitCode).toBe(0);
    expect(wire.matches).toEqual([
      { file: 'src/transport.rs', line: 3, text: TRANSPORT.l3 },
      { file: 'src/transport.rs', line: 7, text: TRANSPORT.l7 },
    ]);
  });

  test('c5: a name that EXISTS in the diagram but no source writes answers ZERO matches', () => {
    const p = ws('c5');
    // `Shim-polls-the-notify-fd-and-reads-the-request` IS an entry of
    // trap-flow.txt (its line 9 — the entry tier makes every lettered line
    // addressable), but no source file points at it — zero matches is an
    // answer (the #70 `#LedgerCtx` precedent, entry edition: the
    // vocabulary exists, the writer does not).
    const j = parseJsonOut(
      runCli(['refs', 'cans/artifacts/diagrams/trap-flow.txt#Shim-polls-the-notify-fd-and-reads-the-request', '--codebase', '--json'], p).out,
    );
    expect(j.exitCode).toBe(0);
    expect(j.ok).toBe(true);
    expect(j.matches).toEqual([]);
  });

  test('c6: the .md regression query still answers its pre-existing matches (and ONLY those)', () => {
    const p = ws('c6');
    // The #66 c1 pin, re-run over the extended fixture: the .md tier is
    // untouched by the #71 entry tier — same three matches, and no
    // artifact pointer leaks into a corpus query (the non-crossing pin).
    const j = parseJsonOut(runCli(['refs', '01-auth.md#Sessions', '--codebase', '--json'], p).out);
    expect(j.exitCode).toBe(0);
    expect(j.scanned).toBe(17); // 16 post-#71 + the #72 net-refs.rs carrier
    expect(j.matches.map((m: any) => `${m.file}:${m.line}`)).toEqual([
      'src/api/routes.ts:2',
      'src/api/routes.ts:6',
      'src/session.rs:2',
    ]);
  });
});

// ── d: the exit-code ladder, re-pinned over the shifted census ─────────────

describe('issue #71 d — the exit ladder over the 17/56 census: 0 clean / 1 warnings / 2 errors', () => {
  /** Heal the EIGHT error records of the tmp copy — the oracle the README
   *  prescribes, #66-b1's heal set extended by the #71 phrase typo. The
   *  typo pattern is NEWLINE-ANCHORED: `#Kernel-seccomp-unotify-trigger`
   *  is a PREFIX of the VALID `#Kernel-seccomp-unotify-triggers` pointer
   *  at trap.rs:3, so a bare String.replace would corrupt the valid
   *  occurrence first (String.replace takes the first hit — the #70
   *  merge-commit lesson, pinned here so the heal can never lie). */
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
    // `ok`, and the band is 1, NOT 0 and NOT 2.
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

describe('issue #71 e — the extension adds artifacts and two sources, never a corpus file', () => {
  test('e1: the plain check stays clean with NO codebase key and the #68 corpus counts unchanged', () => {
    const p = ws('e1');
    // The committed _rules.yaml carries `codebase.enabled: true`, so the
    // corpus-band comparison strips the block first (the #68 c1 / #69 d1 /
    // #70 e1 variant: aliasing tier kept on — the plugin specs stay
    // loaded — redundancy knobs the README documents, no codebase block).
    // Over that workspace the plain check never scans: the #71 diagram
    // targets and the two carriers are invisible to the corpus band, so
    // the #68 c1 pins hold verbatim: exit 0, no codebase key, refs 11,
    // files 9.
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
