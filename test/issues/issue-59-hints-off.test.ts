/**
 * Issue #59 — the slug-hint cheatsheet is OPT-IN.
 *
 * The ask (0.8.0 evidence, kelir corpus, green run): `cans check` printed
 * refs.slug.hint info notes by default — 41 hints, 59.9% of the --json
 * output, over half the text output of a clean run — with no off switch,
 * because hint count scales with confusable NODES (arrows, unicode, math
 * symbols, dashes), not with problems found. The cleaner and larger the
 * corpus, the noisier the default. Backwards for the primary consumer
 * (agents reading check output into a token budget — exactly what #41
 * was about).
 *
 * The contract (implemented at the ENGINE: checkWorkspace emits no
 * refs.slug.hint items unless `--hints` or `_rules.yaml output.slug_hints`
 * asks for them; the count is computed on every run):
 *
 *  - default (text): NO hint items, NO hint group header, NO `ℹ N notes`
 *    count, NO `more → cans check --show refs` pointer. The REFS header
 *    shows only real state. A green run is quiet.
 *  - default (--json): info items are EXCLUDED from sections; the refs
 *    section carries ONE discoverability integer, hintCount. Error/warning
 *    groups, `ok`, exit codes, `--strict` are unchanged.
 *  - `--show refs` does NOT implicitly turn hints on — --show expands
 *    findings only.
 *  - `--hints` restores the 0.8.0 behavior exactly: folded to 6 by default,
 *    fully with `--show refs`, included in `--json` when combined.
 *  - `_rules.yaml output.slug_hints: true` enables the band per-workspace;
 *    flag or config — either enables (there is no --no-hints; off is the
 *    default everywhere).
 *  - The new key falls under #56's strict validation: a typo'd or wrongly
 *    typed value is a line-numbered config error, never a silent no-op.
 *
 * NOT changed (pinned here where cheap): the slug algorithm, error/warning
 * counts, exit codes, `ok`, `--strict`, per-error fix suggestions (a broken
 * anchor's `did you mean …?` rides on a real finding), `cans slug`.
 *
 * Test map:
 *   a ..... green corpus, plain check: quiet — no REFS block, no ℹ, 2 lines
 *   b ..... failing corpus, plain check: the real error + did-you-mean
 *          survive; the hint band does not print
 *   c ..... default --json: zero info items in every section, hintCount
 *          present and correct; counts/ok/exit untouched
 *   d ..... default --json on a hint-FREE corpus: NO hintCount key — the
 *          wire shape is byte-identical to pre-#59 (additive)
 *   e ..... unit: opts.hints off vs on — identical verdicts; the ONLY delta
 *          is the info band; hintCount === emitted item count
 *   f ..... --hints (text): the 0.8.0 band — REFS `· ℹ N notes`, group,
 *          items — stacked on the failing run without changing its counts
 *   g ..... --hints folding: 8 items fold to 6 + `↳ 2 more → --show refs`;
 *          --hints --show refs prints all 8 with the fix hint
 *   h ..... --hints --json: info items ride sections.refs AND
 *          hintCount === the item count (the identity)
 *   i ..... --show refs WITHOUT --hints: findings expand, hints stay off
 *          (green corpus: still nothing at all)
 *   j ..... config output.slug_hints: true → the band, identical to --hints
 *   k ..... either enables: config false + --hints → on; config true +
 *          --hints → on; config false + no flag → off
 *   l ..... an output-only config is NOT a curated config: engines keep
 *          their defaults (a structure warning still fires) — the display
 *          switch never joins the §18 delete/override reconciliation
 *   m/p/q/r  strict validation: typo `slug_hint` → line-numbered
 *          unrecognized key (exit 2, config envelope); wrong type → domain
 *          error; empty value → domain error; `references.slug_hints`
 *          (wrong section) → unrecognized key
 *   s ..... --refs-only --hints: still no hint items (refs-only has never
 *          included the per-file band; #59 changes visibility only)
 *   t ..... verdict identity on a failing corpus: ok/exitCode/errorCount/
 *          warningCount identical with and without --hints
 *   u ..... help documents --hints (flag list + the opt-in description)
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { rmSync, writeFileSync } from 'fs';

import { checkWorkspace, type CheckArgs } from '../../src/commands/check.ts';
import type { CheckResult } from '../../src/types.ts';
import { spawnCli, REPO } from '../runtime.ts';
import { makeCansWorkspace } from '../helpers.ts';

const EM = '\u2014'; // em dash — the canonical confusable

// ── Corpora ──

/** Green corpus with two confusable nodes (one per file) and one healthy
 *  ref — under 0.8.0 this printed a REFS block whose only content was the
 *  hint band; post-#59 a plain check is quiet. */
const GREEN_FILES = {
  '00-overview.md': `- Overview\n  - Layer 1 ${EM} C authorizer\n  - Scope\n`,
  '02-auth.md': `- Authentication\n  - Token ${EM} hygiene\n  - Sessions\n  - see: 00-overview.md\n`,
};

/** Hint-free green corpus — the additive-wire control: its default --json
 *  has no hintCount key at all (byte-identical to pre-#59). */
const ASCII_FILES = {
  '00-overview.md': `- Overview\n  - Scope\n  - Charter\n`,
  '02-auth.md': `- Authentication\n  - Sessions\n  - see: 00-overview.md\n`,
};

/** Failing corpus: one broken anchor (whose did-you-mean must survive) plus
 *  two confusable nodes (whose hints must not print by default). */
const FAIL_FILES = {
  '00-overview.md': `- Overview\n  - Sessions\n  - Charter ${EM} scope\n`,
  '04-api.md': `- API\n  - Login goes: see 00-overview.md#Sesions\n  - Keys ${EM} rotation\n`,
};

/** Eight confusable nodes across two files → one 8-item hint group: the
 *  --hints fold (6 shown + `2 more`) and its --show refs expansion. */
function manyFiles(): Record<string, string> {
  const files: Record<string, string> = {
    '00-overview.md': ['- Overview', '  - Alpha ${EM} one', '  - Bravo ${EM} one', '  - Charlie ${EM} one', '  - Delta ${EM} one', ''].join('\n'),
    '02-auth.md': ['- Auth', '  - Echo ${EM} two', '  - Foxtrot ${EM} two', '  - Golf ${EM} two', '  - Hotel ${EM} two', ''].join('\n'),
  };
  // interpolate the em dash (kept as an escape so the codepoint stays explicit)
  for (const k of Object.keys(files)) files[k] = files[k]!.replaceAll('${EM}', EM);
  return files;
}

// ── Unit scaffolding ──

const OFF_OPTS: CheckArgs = {
  fix: false,
  strict: false,
  refsOnly: false,
  noRedundancy: false,
  file: null,
  json: false,
  // hints deliberately UNSET — the default-off contract under test.
};

// ── CLI scaffolding ──

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-59-hints-off');
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
  return parsed;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    rmSync(createdDirs.pop()!, { recursive: true, force: true });
  }
});

/** The issue #43 config-error contract for strict-validation pins. */
function expectConfigError(r: { exit: number | null; out: string }, message: string): void {
  expect(r.exit).toBe(2);
  const j = parseJsonOut(r.out);
  expect(j.ok).toBe(false);
  expect(j.error).toBe(`invalid _rules.yaml: ${message}`);
  expect(j.sections.config).toHaveLength(1);
  expect(j.sections.config[0].rule).toBe('config.invalid');
}

// ── Default-off: human output ────────────────────────────────────────────────

describe('issue #59: hints are opt-in — default-off human output', () => {
  test('a: green corpus, plain check → quiet: no REFS block, no ℹ, no notes count, no --show pointer', () => {
    const ws = makeWs('green-quiet', GREEN_FILES);
    const r = runCli(['check'], ws.tmp);
    expect(r.exit).toBe(0);

    // The whole hint vocabulary is absent…
    expect(r.out).not.toContain('ℹ');
    expect(r.out).not.toContain('non-obvious slug');
    expect(r.out).not.toContain('note');
    expect(r.out).not.toContain('cans check --show refs');
    // …and the green run is QUIET: summary line + RULES, nothing else (under
    // 0.8.0 the hints were the only refs-category content, so the REFS block
    // left with them — an ASCII-clean corpus already printed none).
    const lines = r.out.split('\n').filter(l => l.trim() !== '');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^✓ 2 files · 7 nodes · depth 2 · \d+ms$/);
    expect(lines[1]).toMatch(/^RULES  ✓ /);
  });

  test('b: failing corpus, plain check → the real error (and its did-you-mean) print; the hint band does not', () => {
    const ws = makeWs('fail-quiet', FAIL_FILES);
    const r = runCli(['check'], ws.tmp);
    expect(r.exit).toBe(2);

    // The finding that needs fixing is fully present…
    expect(r.out).toContain('REFS  ✗ 1 broken');
    expect(r.out).toContain('1× broken anchor');
    expect(r.out).toContain('04-api.md:2 → 00-overview.md#Sesions');
    // …including the per-error fix suggestion — it rides on a REAL finding
    // (issue #59 changes hint visibility, not fix advice).
    expect(r.out).toContain('did you mean 00-overview.md#Sessions? — fix the ref anchor');
    // And the cheatsheet is gone: no notes count in the header, no group.
    expect(r.out).not.toContain('ℹ');
    expect(r.out).not.toContain('non-obvious slug');
    expect(r.out).not.toContain('Charter'); // the confusable node texts do not leak
  });
});

// ── Default-off: --json ──────────────────────────────────────────────────────

describe('issue #59: hints are opt-in — default-off --json', () => {
  test('c: info items excluded from sections; refs.hintCount is the discoverability signal', () => {
    const ws = makeWs('json-off', GREEN_FILES);
    const r = runCli(['check', '--json'], ws.tmp);
    expect(r.exit).toBe(0);

    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect(j.exitCode).toBe(0);
    // Zero info items anywhere — the ~60% token tax is gone by default.
    for (const arr of Object.values(j.sections) as any[][]) {
      expect(arr.filter(i => i.level === 'info')).toHaveLength(0);
    }
    // The single discoverability integer: 2 confusable nodes exist.
    expect(j.refs.hintCount).toBe(2);
    expect(j.counts).toEqual({ errors: 0, warnings: 0 });
    expect(j.sections.refs).toEqual([]);
  });

  test('d: hint-free corpus → NO hintCount key (additive wire: byte-identical to pre-#59)', () => {
    const ws = makeWs('json-ascii', ASCII_FILES);
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect(j.refs).toEqual({ total: 1, broken: 0, deepHops: 0 });
    expect(JSON.stringify(j.refs)).not.toContain('hintCount');
  });

  test('e: unit — verdicts identical off vs on; the ONLY delta is the info band; hintCount === item count', async () => {
    const ws = makeWs('unit-delta', FAIL_FILES);
    const off: CheckResult = await checkWorkspace(ws.root, OFF_OPTS);
    const on: CheckResult = await checkWorkspace(ws.root, { ...OFF_OPTS, hints: true });

    // The engine verdict never moves…
    expect(off.ok).toBe(on.ok);
    expect(off.exitCode).toBe(on.exitCode);
    expect(off.errorCount).toBe(on.errorCount);
    expect(off.warningCount).toBe(on.warningCount);
    expect(off.refs).toEqual({ ...on.refs }); // includes hintCount on both
    // …the only delta is the band: off emits zero info items, on emits both.
    expect(off.issues.filter(i => i.level === 'info')).toHaveLength(0);
    expect(on.issues.filter(i => i.level === 'info')).toHaveLength(2);
    expect(off.infoCount ?? 0).toBe(0);
    expect(on.infoCount).toBe(2);
    // The discoverability integer equals what --hints would emit…
    expect(off.refs.hintCount).toBe(2);
    // …and the same real finding is present either way.
    expect(off.issues.some(i => i.rule === 'refs.broken.anchor')).toBe(true);
    expect(on.issues.some(i => i.rule === 'refs.broken.anchor')).toBe(true);
  });
});

// ── Opt-in: --hints restores the 0.8.0 band exactly ─────────────────────────

describe('issue #59: --hints restores the band exactly', () => {
  test('f: --hints on the failing corpus → hints stack beside the error, counts unchanged', () => {
    const ws = makeWs('fail-on', FAIL_FILES);
    const r = runCli(['check', '--hints'], ws.tmp);
    expect(r.exit).toBe(2); // hints never escalate

    // The 0.8.0 shape: REFS header gains `· ℹ N notes` beside the real state…
    expect(r.out).toContain('REFS  ✗ 1 broken · ℹ 2 notes');
    // …the hint group with its items…
    expect(r.out).toContain('ℹ 2× non-obvious slug');
    expect(r.out).toContain(`00-overview.md:3 — "Charter ${EM} scope" → #Charter-scope`);
    expect(r.out).toContain(`04-api.md:3 — "Keys ${EM} rotation" → #Keys-rotation`);
    // …and the real finding + its did-you-mean, unchanged.
    expect(r.out).toContain('did you mean 00-overview.md#Sessions? — fix the ref anchor');
  });

  test('g: folding is preserved — 8 items fold to 6 + `↳ 2 more`; --show refs expands all 8', () => {
    const ws = makeWs('fold', manyFiles());
    const folded = runCli(['check', '--hints'], ws.tmp);
    expect(folded.exit).toBe(1); // the corpus carries an orphan warning — unchanged

    expect(folded.out).toContain('ℹ 8× non-obvious slug');
    expect(folded.out).toContain(`00-overview.md:2 — "Alpha ${EM} one" → #Alpha-one`);
    expect(folded.out).toContain(`02-auth.md:3 — "Foxtrot ${EM} two" → #Foxtrot-two`);
    // The issue #41/#53 fold budget: 6 shown, 2 hidden behind the pointer.
    expect(folded.out).not.toContain(`02-auth.md:4 — "Golf ${EM} two"`);
    expect(folded.out).toContain('↳ 2 more → cans check --show refs');

    const expanded = runCli(['check', '--hints', '--show', 'refs'], ws.tmp);
    expect(expanded.out).toContain(`02-auth.md:4 — "Golf ${EM} two" → #Golf-two`);
    expect(expanded.out).toContain(`02-auth.md:5 — "Hotel ${EM} two" → #Hotel-two`);
    expect(expanded.out).not.toContain('more → cans check --show refs');
    expect(expanded.out).toContain('↳ the anchor above is the exact form see: refs must use');
  });

  test('h: --hints --json → info items ride sections.refs; hintCount === item count', () => {
    const ws = makeWs('json-on', GREEN_FILES);
    const r = runCli(['check', '--hints', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);

    const infos = (j.sections.refs as any[]).filter(i => i.level === 'info');
    expect(infos).toHaveLength(2);
    expect(infos.every(i => i.rule === 'refs.slug.hint')).toBe(true);
    // The identity: the discoverability integer is exactly the emitted count.
    expect(j.refs.hintCount).toBe(infos.length);
    expect(infos[0].detail).toBe(
      `non-obvious slug: "Layer 1 ${EM} C authorizer" → #Layer-1-C-authorizer (contains ${EM}(U+2014))`,
    );
    // counts stays {errors, warnings} — info is not a finding.
    expect(j.counts).toEqual({ errors: 0, warnings: 0 });
  });
});

// ── --show refs independence ────────────────────────────────────────────────

describe('issue #59: --show refs does not imply hints', () => {
  test('i: --show refs without --hints → findings expand, hints stay off', () => {
    // Green corpus: asking to see refs prints NOTHING extra (there are no
    // refs findings — and the cheatsheet no longer rides along).
    const green = makeWs('show-green', GREEN_FILES);
    const g = runCli(['check', '--show', 'refs'], green.tmp);
    expect(g.exit).toBe(0);
    expect(g.out).not.toContain('ℹ');
    expect(g.out).not.toContain('non-obvious slug');
    expect(g.out.split('\n').filter(l => l.trim() !== '')).toHaveLength(2);

    // Failing corpus: the real refs findings expand (detail lines), and the
    // hints are still absent — --show expands FINDINGS only.
    const fail = makeWs('show-fail', FAIL_FILES);
    const f = runCli(['check', '--show', 'refs'], fail.tmp);
    expect(f.exit).toBe(2);
    expect(f.out).toContain('REFS  ✗ 1 broken');
    expect(f.out).toContain('did you mean 00-overview.md#Sessions?');
    expect(f.out).not.toContain('ℹ');
    expect(f.out).not.toContain('non-obvious slug');
  });
});

// ── Config: output.slug_hints ───────────────────────────────────────────────

describe('issue #59: config key output.slug_hints', () => {
  test('j: output.slug_hints: true enables the band (human output identical to --hints)', () => {
    const ws = makeWs('config-on', GREEN_FILES);
    writeFileSync(join(ws.root, '_rules.yaml'), 'output:\n  slug_hints: true\n');

    const viaConfig = runCli(['check'], ws.tmp);
    expect(viaConfig.exit).toBe(0);
    expect(viaConfig.out).toContain('REFS  ✓ 1 refs · ℹ 2 notes');
    expect(viaConfig.out).toContain('ℹ 2× non-obvious slug');
    expect(viaConfig.out).toContain(`00-overview.md:2 — "Layer 1 ${EM} C authorizer" → #Layer-1-C-authorizer`);

    // The same shape as the flag path (modulo timing).
    const viaFlag = runCli(['check', '--hints'], ws.tmp);
    expect(stripMs(viaFlag.out)).toBe(stripMs(viaConfig.out));

    // And the JSON path too: items + the count.
    const j = parseJsonOut(runCli(['check', '--json'], ws.tmp).out);
    expect((j.sections.refs as any[]).filter(i => i.level === 'info')).toHaveLength(2);
    expect(j.refs.hintCount).toBe(2);
  });

  test('k: either enables — config false + --hints → on; config true + --hints → on; config false alone → off', () => {
    const ws = makeWs('either', GREEN_FILES);

    writeFileSync(join(ws.root, '_rules.yaml'), 'output:\n  slug_hints: false\n');
    const off = runCli(['check'], ws.tmp);
    expect(off.out).not.toContain('ℹ');
    const flagOverFalse = runCli(['check', '--hints'], ws.tmp);
    expect(flagOverFalse.out).toContain('ℹ 2× non-obvious slug');

    writeFileSync(join(ws.root, '_rules.yaml'), 'output:\n  slug_hints: true\n');
    const flagOverTrue = runCli(['check', '--hints'], ws.tmp);
    expect(flagOverTrue.out).toContain('ℹ 2× non-obvious slug');
  });

  test('l: an output-only config is NOT a curated config — engines keep their defaults', () => {
    // The delete/override reconciliation (#56) must never consult the
    // display section: listing ONLY `output:` would, if it counted as a
    // "complete section", flip every unlisted engine OFF. Single-child
    // collapse stays on → the warning still fires.
    const files = { '00-overview.md': '- Overview\n  - only child here\n' };
    const ws = makeWs('output-only', files);
    writeFileSync(join(ws.root, '_rules.yaml'), 'output:\n  slug_hints: true\n');

    const r = runCli(['check'], ws.tmp);
    expect(r.exit).toBe(1); // the structure warning is alive
    expect(r.out).toContain('STRUCTURE  ⚠ 1');
    expect(r.out).toContain('1× single child (collapse)');
  });
});

// ── Strict validation of the new key (#56 discipline) ───────────────────────

describe('issue #59: strict validation of output.slug_hints (issue #56)', () => {
  test('m: typo slug_hint → line-numbered unrecognized key, exit 2, config envelope', () => {
    const ws = makeWs('typo', GREEN_FILES);
    writeFileSync(join(ws.root, '_rules.yaml'), 'output:\n  slug_hint: true\n');

    expectConfigError(
      runCli(['check', '--json'], ws.tmp),
      'line 2 — unrecognized key "output.slug_hint" (issue #56: _rules.yaml is validated strictly — §18 documents the legal keys)',
    );
  });

  test('p: wrong type → line-numbered domain error (a quoted boolean is a string)', () => {
    const ws = makeWs('type', GREEN_FILES);
    writeFileSync(join(ws.root, '_rules.yaml'), 'output:\n  slug_hints: "true"\n');

    expectConfigError(
      runCli(['check', '--json'], ws.tmp),
      'line 2 — "output.slug_hints" must be true or false, got "true"',
    );
  });

  test('q: explicit empty value → domain error (write false, or omit the key)', () => {
    const ws = makeWs('null', GREEN_FILES);
    writeFileSync(join(ws.root, '_rules.yaml'), 'output:\n  slug_hints:\n');

    expectConfigError(
      runCli(['check', '--json'], ws.tmp),
      'line 2 — "output.slug_hints" must be true or false, got null (empty value)',
    );
  });

  test('r: wrong-section spelling references.slug_hints → unrecognized key (location is part of the contract)', () => {
    const ws = makeWs('wrong-section', GREEN_FILES);
    writeFileSync(join(ws.root, '_rules.yaml'), 'references:\n  slug_hints: true\n');

    expectConfigError(
      runCli(['check', '--json'], ws.tmp),
      'line 2 — unrecognized key "references.slug_hints" (issue #56: _rules.yaml is validated strictly — §18 documents the legal keys)',
    );
  });
});

// ── Unchanged scope discipline ──────────────────────────────────────────────

describe('issue #59: unchanged scope discipline', () => {
  test('s: --refs-only --hints → still no hint items (refs-only has never carried the per-file band)', () => {
    const ws = makeWs('refs-only', FAIL_FILES);
    const r = runCli(['check', '--refs-only', '--hints'], ws.tmp);
    expect(r.exit).toBe(2);
    expect(r.out).toContain('REFS  ✗ 1 broken'); // real refs findings print
    expect(r.out).not.toContain('ℹ');
    expect(r.out).not.toContain('non-obvious slug');
  });

  test('t: verdict identity on the failing corpus — ok/exit/counts identical with and without --hints', () => {
    const ws = makeWs('verdicts', FAIL_FILES);
    const off = parseJsonOut(runCli(['check', '--json'], ws.tmp).out);
    const on = parseJsonOut(runCli(['check', '--hints', '--json'], ws.tmp).out);
    expect(off.ok).toBe(on.ok);
    expect(off.exitCode).toBe(on.exitCode);
    expect(off.counts).toEqual(on.counts);
    expect(off.refs.broken).toBe(on.refs.broken);
    expect(off.summary.files).toBe(on.summary.files);
    // The delta is exactly the info items + nothing else.
    expect(on.refs.hintCount).toBe(2);
    expect(off.refs.hintCount).toBe(2);
  });

  test('u: help documents --hints', () => {
    const ws = makeWs('help', ASCII_FILES);
    const r = runCli(['help'], ws.tmp);
    expect(r.exit).toBe(0);
    expect(r.out).toContain('[--show <section>] [--hints] [file] [--json]');
    expect(r.out).toContain('--hints shows slug-hint info notes (opt-in; off by default');
    expect(r.out).toContain('output.slug_hints');
  });
});

/** Elide the varying elapsedMs so two runs of the same workspace compare byte-for-byte. */
function stripMs(out: string): string {
  return out.replace(/· \d+ms/, '· Nms');
}
