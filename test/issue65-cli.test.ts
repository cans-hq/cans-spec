/**
 * Issue #65 — the CLI half: `cans alias expand|collapse` operates on
 * configured plugin files under the SAME rules as the spec corpus.
 *
 * #57's alias switch stopped at the corpus boundary: the file set was spec +
 * aux (_tasks/_adr) only, so `cans alias collapse cans/plugins/profile.md`
 * refused with `no spec file matches` — the kelir profile.md case (133
 * `#leaf` refs into a YAML artifact) could never be collapsed or expanded.
 * The merged contract (f1c3450) added `references.aliasing.include` +
 * `discoverAliasingFiles`; this suite pins the command behavior on top:
 *
 *   a ....... enabled + include: collapse rewrites the repeated full pointer
 *             (uses + full spellings ≥ min_uses) and appends the footnote
 *             definition IN the plugin file; --dry-run proposes without
 *             writing a byte
 *   b ....... below-min_uses alias in a plugin file → refused, file
 *             byte-identical, exit 1 (per-file safe failure)
 *   c ....... expand on a collapsed plugin file restores the original
 *             expanded text byte-identically (lossless round trip)
 *   d ....... idempotency: collapse twice / expand twice — the second run is
 *             a zero-rewrite no-op (collapse keeps counting definitionsKept)
 *   e ....... lossless: labels, prose, node order, fenced code and
 *             below-threshold one-offs are untouched by BOTH directions
 *   f ....... the enhanced refusal: a named file that physically exists
 *             inside the workspace as .md but matches no loaded key gets the
 *             corpus-boundary message with the include knob; a name that
 *             exists nowhere keeps the historical message byte-identical;
 *             escaping paths and directories never earn the hint
 *   g ....... expand with aliasing DISABLED on an existing outside-corpus
 *             file: the old-style could-not-run refusal (exit 2, nothing
 *             processed) with the knob hint included — the hint does not
 *             depend on the knob's state
 *   h ....... collapse with aliasing disabled: the dedicated refusal,
 *             unchanged, and still FIRST in order (a named plugin file does
 *             not get past it)
 *   i ....... mixed run: a spec file processes fine while a broken plugin
 *             file refuses — per-file refusal semantics, ok:false, exit 1
 *   j ....... plugin files respect the style config: style: numeric rejects
 *             an existing [name] definition in a plugin file
 *   k ....... gating: enabled but include empty → the plugin tier does not
 *             join the set (corpus+aux only, the pre-#65 behavior)
 *   m ....... dry-run chars-saved accounting works for plugin files
 *             (target-agnostic: source.length − transformed.length)
 *
 * Workspace layout mirrors the contract suite (test/issue65-contract.test.ts):
 * the workspace root holds `_rules.yaml` + root-level specs, and the plugin
 * tier lives at `cans/plugins/*.md` UNDER the root — so every CLI spawn pins
 * CANS_ROOT to the intended root (the nested `cans/` directory would
 * otherwise win the walk-up resolution and shrink the workspace out from
 * under the test). Runtime-neutral: imports the test facade, never
 * 'bun:test' directly; CLI runs are blackbox spawns via ./runtime.ts.
 */
import { describe, test, expect, afterEach } from './testing.ts';
import { join } from 'path';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';

import { spawnCli } from './runtime.ts';
import { makeTmpDir, cleanTmpDir, makeCansWorkspace } from './helpers.ts';

// ── fixtures ────────────────────────────────────────────────────────────────

/** The issue's motivating shape: repeated `#leaf`-style refs into a YAML
 *  artifact (kelir's profile.md had 133). The transforms never resolve
 *  targets — collapse/expand are purely textual — so the YAML spelling is
 *  exercised end to end without a fixture artifact on disk. */
const TGT = 'cans/artifacts/examples/fixtures/kelir.yaml#invariants.default_zero_capability';
const TGT2 = 'cans/artifacts/examples/fixtures/kelir.yaml#traits.other_rule';

const RULES_ON_INCLUDE = [
  'references:',
  '  back_pointers: false',
  '  aliasing:',
  '    enabled: true',
  '    include:',
  '      - cans/plugins/*.md',
  '',
].join('\n');

const RULES_ON_NO_INCLUDE = [
  'references:',
  '  back_pointers: false',
  '  aliasing:',
  '    enabled: true',
  '',
].join('\n');

const RULES_OFF = 'references:\n  back_pointers: false\n';

const RULES_NUMERIC = [
  'references:',
  '  back_pointers: false',
  '  aliasing:',
  '    enabled: true',
  '    style: numeric',
  '    include:',
  '      - cans/plugins/*.md',
  '',
].join('\n');

/** A minimal valid spec file (root-level, corpus tier). */
const OVERVIEW = '# Overview\n\n## Intro\n\nBody text about the plan.\n';

const PROFILE = [
  '# Profile',
  '',
  '## Traits',
  '',
  `- Traits: see: ${TGT}`,
  `- More: see: ${TGT}`,
  '',
].join('\n');

const PROFILE_COLLAPSED = [
  '# Profile',
  '',
  '## Traits',
  '',
  '- Traits: see: [1]',
  '- More: see: [1]',
  '',
  `- [1]: ${TGT}`,
  '',
].join('\n');

/** The lossless fixture: labels, prose, a below-threshold one-off, plain
 *  nodes, and a fenced code block containing a full pointer AND a
 *  definition-shaped line — none of which may ever be rewritten. */
const LOSSLESS = [
  '# Profile',
  '',
  '## Traits',
  '',
  `- Traits: see: ${TGT}`,
  `- Named: see: ${TGT}`,
  `- One-off: see: ${TGT2}`,
  '- Prose note: see the runbook for details',
  '- Plain node without refs',
  '```code',
  `- Fenced: see: ${TGT}`,
  `- [1]: ${TGT}`,
  '```',
  '',
  `- After: see: ${TGT}`,
  `- Also: see: ${TGT}`,
  '',
].join('\n');

const LOSSLESS_COLLAPSED = [
  '# Profile',
  '',
  '## Traits',
  '',
  '- Traits: see: [1]',
  '- Named: see: [1]',
  `- One-off: see: ${TGT2}`,
  '- Prose note: see the runbook for details',
  '- Plain node without refs',
  '```code',
  `- Fenced: see: ${TGT}`,
  `- [1]: ${TGT}`,
  '```',
  '',
  '- After: see: [1]',
  '- Also: see: [1]',
  '',
  `- [1]: ${TGT}`,
  '',
].join('\n');

// ── harness ─────────────────────────────────────────────────────────────────

const tmps: string[] = [];

/** Fresh workspace: corpus at the root, plugin tier under cans/plugins/. */
function makeWs(name: string, files: Record<string, string>): { tmp: string; root: string } {
  const tmp = makeTmpDir(`issue65-cli-${name}`);
  tmps.push(tmp);
  const root = makeCansWorkspace(tmp, files);
  return { tmp, root };
}

/** Blackbox CLI spawn pinned to the workspace root (see file header: the
 *  nested cans/ dir would otherwise win walk-up resolution). */
function runCli(args: string[], root: string) {
  return spawnCli(args, root, { ...process.env, CANS_ROOT: root });
}

function readWs(root: string, rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

/** JSON-mode output must be a single JSON document; a parse failure is itself an assertion failure. */
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

/** The standard workspace: one corpus spec + the plugin file. */
function baseWs(name: string, rules: string, profile: string = PROFILE): { tmp: string; root: string } {
  return makeWs(name, {
    '_rules.yaml': rules,
    '01-overview.md': OVERVIEW,
    'cans/plugins/profile.md': profile,
  });
}

// The two refusal texts, pinned as exact byte strings (issue #65 keeps the
// historical message byte-identical for names that exist nowhere).
const ENHANCED = (file: string): string =>
  `no spec file matches "${file}" — the file exists but is outside the spec corpus; ` +
  `add a references.aliasing.include glob (e.g. cans/plugins/*.md) in _rules.yaml to alias plugin files (issue #65)`;
const HISTORICAL = (file: string): string =>
  `no spec file matches "${file}" — pass a spec filename like 04-api.md or run \`cans status\` to list files`;

// ── a: collapse on a plugin file — the motivating case ──────────────────────

describe('issue #65 a — collapse rewrites plugin-file uses and appends the definition', () => {
  test('a1: the repeated YAML #leaf target collapses inside cans/plugins/profile.md', () => {
    const ws = baseWs('a1', RULES_ON_INCLUDE);
    const r = runCli(['alias', 'collapse'], ws.root);
    expect(r.exit).toBe(0);
    expect(r.out).toContain('Collapsed 1 file');
    expect(r.out).toContain('cans/plugins/profile.md');
    // the plugin file itself: uses rewritten, definition appended at EOF —
    // the same canonical shape a corpus file gets (issue #57 e1)
    expect(readWs(ws.root, 'cans/plugins/profile.md')).toBe(PROFILE_COLLAPSED);
    // and the corpus file is untouched by the same run
    expect(readWs(ws.root, '01-overview.md')).toBe(OVERVIEW);
  });

  test('a2: --json reports the plugin file outcome with the same counters', () => {
    const ws = baseWs('a2', RULES_ON_INCLUDE);
    const j = parseJsonOut(runCli(['alias', 'collapse', '--json'], ws.root).out);
    expect(j.ok).toBe(true);
    expect(j.exitCode).toBe(0);
    const pf = j.results.find((x: any) => x.file === 'cans/plugins/profile.md');
    expect(pf).toBeDefined();
    expect(pf.changed).toBe(true);
    expect(pf.usesRewritten).toBe(2);
    expect(pf.definitionsAdded).toBe(1);
    expect(pf.definitionsRemoved).toBe(0);
    expect(pf.problems).toEqual([]);
    // the corpus file rides along unchanged in the same report
    const ov = j.results.find((x: any) => x.file === '01-overview.md');
    expect(ov.changed).toBe(false);
  });

  test('a3: --dry-run proposes the rewrite without writing a byte', () => {
    const ws = baseWs('a3', RULES_ON_INCLUDE);
    const r = runCli(['alias', 'collapse', '--dry-run'], ws.root);
    expect(r.exit).toBe(0);
    expect(r.out).toContain('[dry-run]');
    expect(r.out).toContain('Would collapse 1 file');
    expect(readWs(ws.root, 'cans/plugins/profile.md')).toBe(PROFILE); // untouched
    const j = parseJsonOut(runCli(['alias', 'collapse', '--dry-run', '--json'], ws.root).out);
    expect(j.dryRun).toBe(true);
    expect(j.results.find((x: any) => x.file === 'cans/plugins/profile.md').changed).toBe(true);
    expect(readWs(ws.root, 'cans/plugins/profile.md')).toBe(PROFILE); // still untouched
  });
});

// ── b: below-min_uses plugin file is refused ────────────────────────────────

describe('issue #65 b — a below-min_uses alias in a plugin file refuses', () => {
  test('b1: 1 use < min_uses 2 → per-file refusal, byte-identical file, exit 1', () => {
    const ws = baseWs('b1', RULES_ON_INCLUDE, `- Trait: see: [1]\n\n- [1]: ${TGT}\n`);
    const src = readWs(ws.root, 'cans/plugins/profile.md');
    const r = runCli(['alias', 'collapse'], ws.root);
    expect(r.exit).toBe(1);
    expect(readWs(ws.root, 'cans/plugins/profile.md')).toBe(src); // byte-identical
    expect(r.out).toContain('refused');
    expect(r.out).toContain('below references.aliasing.min_uses');
    const j = parseJsonOut(runCli(['alias', 'collapse', '--json'], ws.root).out);
    expect(j.ok).toBe(false);
    expect(j.exitCode).toBe(1);
    const pf = j.results.find((x: any) => x.file === 'cans/plugins/profile.md');
    expect(pf.changed).toBe(false);
    expect(pf.problems.some((p: string) => p.includes('below references.aliasing.min_uses'))).toBe(true);
  });
});

// ── c: expand restores the expanded form byte-identically ───────────────────

describe('issue #65 c — expand on a collapsed plugin file round-trips', () => {
  test('c1: expand(collapse fixture) = the original full-pointer text, byte-identical', () => {
    const ws = baseWs('c1', RULES_ON_INCLUDE, PROFILE_COLLAPSED);
    const r = runCli(['alias', 'expand'], ws.root);
    expect(r.exit).toBe(0);
    expect(r.out).toContain('Expanded 1 file');
    expect(readWs(ws.root, 'cans/plugins/profile.md')).toBe(PROFILE);
  });
});

// ── d: idempotency — second runs are zero-rewrite no-ops ────────────────────

describe('issue #65 d — idempotency on plugin files', () => {
  test('d1: collapse twice → the second run rewrites nothing and keeps the definition', () => {
    const ws = baseWs('d1', RULES_ON_INCLUDE);
    runCli(['alias', 'collapse'], ws.root);
    const once = readWs(ws.root, 'cans/plugins/profile.md');
    const r2 = runCli(['alias', 'collapse'], ws.root);
    expect(r2.exit).toBe(0);
    expect(readWs(ws.root, 'cans/plugins/profile.md')).toBe(once);
    expect(r2.out).toContain('Nothing to collapse');
    const j = parseJsonOut(runCli(['alias', 'collapse', '--json'], ws.root).out);
    const pf = j.results.find((x: any) => x.file === 'cans/plugins/profile.md');
    expect(pf.changed).toBe(false);
    expect(pf.usesRewritten).toBe(0);
    expect(pf.definitionsAdded).toBe(0);
    // the existing definition is counted as KEPT — the no-renumbering-churn
    // contract from issue #57 e6, now pinned for the plugin tier
    expect(pf.definitionsKept).toBe(1);
    expect(pf.charsSaved).toBe(0);
  });

  test('d2: expand twice → the second run rewrites nothing', () => {
    const ws = baseWs('d2', RULES_ON_INCLUDE, PROFILE_COLLAPSED);
    runCli(['alias', 'expand'], ws.root);
    const once = readWs(ws.root, 'cans/plugins/profile.md');
    expect(once).toBe(PROFILE);
    const r2 = runCli(['alias', 'expand'], ws.root);
    expect(r2.exit).toBe(0);
    expect(readWs(ws.root, 'cans/plugins/profile.md')).toBe(once);
    expect(r2.out).toContain('Nothing to expand');
    const j = parseJsonOut(runCli(['alias', 'expand', '--json'], ws.root).out);
    const pf = j.results.find((x: any) => x.file === 'cans/plugins/profile.md');
    expect(pf.changed).toBe(false);
    expect(pf.usesRewritten).toBe(0);
    expect(pf.definitionsRemoved).toBe(0);
  });
});

// ── e: losslessness on a plugin file ────────────────────────────────────────

describe('issue #65 e — only see: tokens and definition lines ever change', () => {
  test('e1: collapse touches the 4 eligible uses and nothing else; expand restores bytes', () => {
    const ws = baseWs('e1', RULES_ON_INCLUDE, LOSSLESS);
    runCli(['alias', 'collapse'], ws.root);
    const collapsed = readWs(ws.root, 'cans/plugins/profile.md');
    expect(collapsed).toBe(LOSSLESS_COLLAPSED);
    // byte-level spot checks: labels, prose, order, fence content, one-off
    expect(collapsed).toContain('- Traits: see: [1]'); // label kept
    expect(collapsed).toContain('- Prose note: see the runbook for details'); // prose kept
    expect(collapsed).toContain(`- One-off: see: ${TGT2}`); // below min_uses: stays full
    expect(collapsed).toContain(`- Fenced: see: ${TGT}`); // fenced: never rewritten
    expect(collapsed).toContain(`- [1]: ${TGT}\n\`\`\``); // fenced def-shaped line: content
    runCli(['alias', 'expand'], ws.root);
    expect(readWs(ws.root, 'cans/plugins/profile.md')).toBe(LOSSLESS); // byte-identical round trip
  });
});

// ── f: the enhanced no-match refusal ────────────────────────────────────────

describe('issue #65 f — named [file] refusals: corpus-boundary hint vs historical text', () => {
  test('f1: an existing outside-corpus file gets the exact enhanced message', () => {
    const ws = makeWs('f1', {
      '_rules.yaml': RULES_ON_INCLUDE,
      '01-overview.md': OVERVIEW,
      'cans/plugins/profile.md': PROFILE,
      'cans/other.md': OVERVIEW, // exists, matches NO include glob
    });
    const r = runCli(['alias', 'collapse', 'cans/other.md'], ws.root);
    expect(r.exit).toBe(2);
    expect(r.out).toContain(ENHANCED('cans/other.md'));
    // nothing was processed or written
    expect(readWs(ws.root, 'cans/other.md')).toBe(OVERVIEW);
  });

  test('f2: a name that exists nowhere keeps the historical message byte-identical', () => {
    const ws = baseWs('f2', RULES_ON_INCLUDE);
    const r = runCli(['alias', 'collapse', 'cans/missing.md'], ws.root);
    expect(r.exit).toBe(2);
    expect(r.out).toContain(HISTORICAL('cans/missing.md'));
    expect(r.out).not.toContain('outside the spec corpus');
  });

  test('f3: an escaping path never earns the hint even when the file exists beyond the root', () => {
    const ws = baseWs('f3', RULES_ON_INCLUDE);
    writeFileSync(join(ws.tmp, 'outside.md'), OVERVIEW, 'utf8'); // a sibling of the workspace
    const r = runCli(['alias', 'collapse', '../outside.md'], ws.root);
    expect(r.exit).toBe(2);
    expect(r.out).toContain(HISTORICAL('../outside.md'));
  });

  test('f4: a .md-named DIRECTORY is not "the file" — historical message', () => {
    const ws = baseWs('f4', RULES_ON_INCLUDE);
    mkdirSync(join(ws.root, 'cans', 'dirnote.md'), { recursive: true });
    const r = runCli(['alias', 'collapse', 'cans/dirnote.md'], ws.root);
    expect(r.exit).toBe(2);
    expect(r.out).toContain(HISTORICAL('cans/dirnote.md'));
  });
});

// ── g: expand, aliasing disabled, outside-corpus named file ─────────────────

describe('issue #65 g — expand under a disabled config keeps the could-not-run refusal shape', () => {
  test('g1: the named plugin file exists → refusal WITH the knob hint, nothing processed', () => {
    const ws = baseWs('g1', RULES_OFF);
    const r = runCli(['alias', 'expand', 'cans/plugins/profile.md'], ws.root);
    expect(r.exit).toBe(2);
    // old-style refusal (the fail() gate: no per-file results, exit 2) — and
    // the knob hint IS included, because the file exists but can never join
    // the set: the actionable fix is the _rules.yaml include member
    expect(r.out).toContain(ENHANCED('cans/plugins/profile.md'));
    expect(readWs(ws.root, 'cans/plugins/profile.md')).toBe(PROFILE);
    const j = parseJsonOut(runCli(['alias', 'expand', '--json', 'cans/plugins/profile.md'], ws.root).out);
    expect(j.ok).toBe(false);
    expect(j.results).toEqual([]);
  });
});

// ── h: collapse under a disabled config — the dedicated refusal, first ──────

describe('issue #65 h — collapse under a disabled config refuses exactly as before', () => {
  test('h1: the dedicated message fires for plain and named runs alike (order pin)', () => {
    const ws = baseWs('h1', RULES_OFF);
    for (const args of [['alias', 'collapse'], ['alias', 'collapse', 'cans/plugins/profile.md']]) {
      const r = runCli(args, ws.root);
      expect(r.exit).toBe(2);
      expect(r.out).toContain(
        'references.aliasing.enabled is false — collapse would produce alias uses the checker rejects. ' +
        'Enable aliasing in _rules.yaml first (expand is always allowed).',
      );
      // FIRST in order: the named existing plugin file never reaches the
      // corpus-boundary hint — the disabled refusal wins
      expect(r.out).not.toContain('outside the spec corpus');
    }
    expect(readWs(ws.root, 'cans/plugins/profile.md')).toBe(PROFILE);
  });
});

// ── i: mixed run — per-file refusal semantics ───────────────────────────────

describe('issue #65 i — a spec file processes fine while a broken plugin file refuses', () => {
  test('i1: ok:false, exit 1, the healthy file is rewritten, the broken one byte-identical', () => {
    const ws = makeWs('i1', {
      '_rules.yaml': RULES_ON_INCLUDE,
      '01-alpha.md': '- First: see: 02-target.md#Anchor-node\n- Second: see: 02-target.md#Anchor-node\n',
      '02-target.md': '- Anchor node\n- Other node\n',
      'cans/plugins/profile.md': '- A: see: [nope]\n',
    });
    const broken = readWs(ws.root, 'cans/plugins/profile.md');
    const j = parseJsonOut(runCli(['alias', 'collapse', '--json'], ws.root).out);
    expect(j.ok).toBe(false);
    expect(j.exitCode).toBe(1);
    expect(j.results.find((x: any) => x.file === '01-alpha.md').changed).toBe(true);
    const pf = j.results.find((x: any) => x.file === 'cans/plugins/profile.md');
    expect(pf.changed).toBe(false);
    expect(pf.problems[0]).toContain('undefined alias [nope]');
    // disk state after that same run: the SPEC file got the real transform
    // (per-file semantics, not all-or-nothing), the PLUGIN file is
    // byte-identical
    expect(readWs(ws.root, '01-alpha.md')).toBe(
      '- First: see: [1]\n- Second: see: [1]\n\n- [1]: 02-target.md#Anchor-node\n',
    );
    expect(readWs(ws.root, 'cans/plugins/profile.md')).toBe(broken);
    // and the human-readable report names the refusal (a repeat run refuses
    // the same way — the broken file never heals by rerunning)
    const r = runCli(['alias', 'collapse'], ws.root);
    expect(r.exit).toBe(1);
    expect(r.out).toContain('refused');
    expect(r.out).toContain('undefined alias [nope]');
  });
});

// ── j: style config is enforced on plugin files ─────────────────────────────

describe('issue #65 j — style: numeric rejects a [name] definition in a plugin file', () => {
  test('j1: existing named alias conflicts with the numeric style → refusal', () => {
    const ws = baseWs(
      'j1',
      RULES_NUMERIC,
      `- Trait: see: [anchor]\n- More: see: [anchor]\n\n- [anchor]: ${TGT}\n`,
    );
    const src = readWs(ws.root, 'cans/plugins/profile.md');
    const r = runCli(['alias', 'collapse'], ws.root);
    expect(r.exit).toBe(1);
    expect(readWs(ws.root, 'cans/plugins/profile.md')).toBe(src);
    expect(r.out).toContain('conflicts with references.aliasing.style');
    expect(r.out).toContain('[anchor]');
  });
});

// ── k: gating — the plugin tier needs enabled AND a non-empty include ───────

describe('issue #65 k — enabled without include keeps the corpus+aux set', () => {
  test('k1: no plugin file joins the run; the named plugin file gets the boundary hint', () => {
    const ws = baseWs('k1', RULES_ON_NO_INCLUDE);
    const j = parseJsonOut(runCli(['alias', 'collapse', '--json'], ws.root).out);
    expect(j.ok).toBe(true);
    expect(j.results.some((x: any) => x.file === 'cans/plugins/profile.md')).toBe(false);
    expect(j.results.length).toBe(1); // the corpus spec only — pre-#65 behavior
    // and the named file (existing, outside the corpus) explains the boundary
    const r = runCli(['alias', 'expand', 'cans/plugins/profile.md'], ws.root);
    expect(r.exit).toBe(2);
    expect(r.out).toContain(ENHANCED('cans/plugins/profile.md'));
  });
});

// ── m: dry-run chars-saved accounting for plugin files ──────────────────────

describe('issue #65 m — chars-saved accounting is target-agnostic', () => {
  test('m1: the plugin file reports source.length − transformed.length under --dry-run', () => {
    const ws = baseWs('m1', RULES_ON_INCLUDE);
    const j = parseJsonOut(runCli(['alias', 'collapse', '--dry-run', '--json'], ws.root).out);
    const pf = j.results.find((x: any) => x.file === 'cans/plugins/profile.md');
    expect(pf.charsSaved).toBe(PROFILE.length - PROFILE_COLLAPSED.length);
    expect(pf.charsSaved).toBeGreaterThan(0);
    // and the plain run lands on the same accounting (idempotent fixture)
    const j2 = parseJsonOut(runCli(['alias', 'collapse', '--json'], ws.root).out);
    expect(j2.results.find((x: any) => x.file === 'cans/plugins/profile.md').charsSaved)
      .toBe(PROFILE.length - PROFILE_COLLAPSED.length);
  });
});
