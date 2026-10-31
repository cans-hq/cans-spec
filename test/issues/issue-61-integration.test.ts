/**
 * Issue #61 integration contracts — granular node_length, the multiline
 * policy, and the CLI structure gates, pinned END TO END through real
 * workspaces (`cans check` blackbox) plus the rules loader.
 *
 * The issue: `structure.node_length: { min: 3, max: 90 }` was an
 * all-or-nothing, uncalibrated chars range lumping node titles, wrapped
 * prose continuations and `see:` reference syntax into one ambiguous check.
 * The fix is additive knobs (unit/scope/strip_references/severity on
 * node_length; mode/max_lines/indent_aligned/severity on a new
 * structure.multiline block) plus two CLI gates.
 *
 * Pinned verdicts (the shared contract, verbatim semantics):
 *   - backcompat: a bare v0.10-style `{ min, max }` still parses; BOTH
 *     findings are warnings now (severity default 'warn' replaces the
 *     hardcoded max:'error'/min:'warning' pair — the deliberate migration;
 *     severity:'error' or --structure=strict restore fatal).
 *   - severity: 'error' → level error, exit 2, ok:false; 'warn' → level
 *     warning, exit 1 band, ok untouched; 'off' → check skipped, clean.
 *   - unit: chars = string length; words = whitespace-split count; tokens
 *     = ceil(chars / 3.5) — the CANONICAL estimate: a per-workspace
 *     token_budget.estimate_chars_per_token override does NOT re-calibrate.
 *   - scope: 'title' = bullet line; 'body' = continuation lines only (a
 *     node WITHOUT continuations is not evaluated); 'total' = title +
 *     continuations folded with single spaces. multiline.mode:'fold'
 *     overrides the evaluation string to the folded text regardless of
 *     scope.
 *   - strip_references: `see: <target>` spans stripped (issue #48
 *     trailing-punctuation aware) before measuring.
 *   - multiline: forbid flags any continuation; max_lines caps the
 *     continuation count; indent_aligned requires the bullet's text
 *     column; section absent → the whole policy is OFF (§18).
 *   - CLI: `--structure` = structure + content findings only
 *     (style/refs/redundancy suppressed); `--structure=strict` promotes
 *     structure-category warnings to errors IN PLACE before counting
 *     (exit 2, ok:false); `--refs-only` unchanged; usage errors:
 *     --structure with --refs-only, --structure with --fix,
 *     --structure=<bad value>; exit contract 0/1/2 unchanged everywhere.
 *
 * Test map:
 *   a ..... backcompat: bare `{ min, max }` parses (loadRules unit, members
 *           normalized to the documented defaults-or-absent) and the CLI
 *           run shows the migration — max AND min findings are warnings,
 *           exit 1, ok true; the granular block parses with every knob set
 *   b ..... severity verdicts e2e: error → 2 errors/exit 2/ok:false; warn
 *           → 2 warnings/exit 1/ok:true; off → clean/exit 0; and
 *           `--structure` enforces the DECLARED error severity
 *   c ..... unit math e2e: words (4-word min trip, 9-word max trip) and
 *           tokens = ceil(chars/3.5) — 36 chars → 11 tokens > 10; the
 *           token_budget.estimate_chars_per_token: 7 override does NOT
 *           re-calibrate (the 36-char node still trips)
 *   d ..... scope: body measures the continuation ONLY (title and
 *           continuation-less nodes are not evaluated — control run under
 *           scope title flags both titles); total measures the folded
 *           title+continuation string (55 chars > 50 while the 15-char
 *           title alone passes)
 *   e ..... strip_references e2e: a 48-char `see:`-carrying node trips
 *           max 40 when false (default), clean when true (the label alone
 *           is 15 chars)
 *   f ..... multiline verdicts: forbid (1 warning; severity error → exit
 *           2; section absent → OFF/clean), max_lines boundary (2 lines:
 *           cap 1 flags, cap 2 clean), indent_aligned (3-space
 *           continuation flags, 2-space aligned clean), fold (folded
 *           106-char string trips max 70 with scope title — the override)
 *   g ..... CLI gates on a workspace with refs/style/redundancy noise:
 *           plain check (1 refs error + 4 warnings), --structure (ONLY
 *           structure+content findings: 2 warnings, exit 1, ok true),
 *           --structure=strict (both promoted to errors: exit 2, ok
 *           false), --refs-only (the refs error alone — unchanged)
 *   h ..... usage errors: --structure with --refs-only, --structure with
 *           --fix, --structure=<bad value> — exit 2, diagnosis precedes
 *           workspace resolution (no-workspace cwd); help lists the gate
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import { loadRules } from '../../src/core/rules.ts';
import type { NodeLengthRules } from '../../src/types.ts';
import { spawnCli, REPO } from '../runtime.ts';
import { makeCansWorkspace } from '../helpers.ts';

// ── Scaffolding (mirrors test/issues/issue-60-anchors-integration.test.ts) ──

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-61');
const createdDirs: string[] = [];

function makeWs(name: string, files: Record<string, string>): { tmp: string; root: string } {
  const tmp = join(SCRATCH, `${name}-${createdDirs.length + 1}`);
  const root = makeCansWorkspace(tmp, files);
  createdDirs.push(tmp);
  return { tmp, root };
}

/** Blackbox CLI spawn — isolated from any ambient CANS_ROOT. */
function runCli(args: string[], cwd: string) {
  return spawnCli(args, cwd, { ...process.env, CANS_ROOT: '' });
}

/** JSON-mode output must be a single JSON document; a parse failure is itself an
 *  assertion failure. The --json wire carries sections (not a flat issues
 *  array); synthesize the flat view exactly like the #60 suite does. */
function parseJsonOut(out: string): any {
  let parsed: unknown = null;
  let parseError: unknown = null;
  try {
    parsed = JSON.parse(out);
  } catch (e) {
    parseError = e;
  }
  expect(parseError).toBeNull();
  const j = parsed as Record<string, unknown> | null;
  if (j !== null && typeof j === 'object' && (j as any).sections !== undefined && (j as any).issues === undefined) {
    (j as any).issues = Object.entries((j as any).sections as Record<string, any[]>).flatMap(([category, arr]) =>
      arr.map((i) => ({ ...i, category, message: i.detail })),
    );
  }
  return parsed;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    rmSync(createdDirs.pop()!, { recursive: true, force: true });
  }
});

// ── Unit scaffolding: loadRules against a scratch _rules.yaml (issue #56) ──

/** loadRules on a yaml string; returns the rules or the thrown Error. */
function load(yaml: string): { rules: ReturnType<typeof loadRules> | null; error: Error | null } {
  const dir = join(SCRATCH, `unit-${createdDirs.length + 1}`);
  mkdirSync(dir, { recursive: true });
  createdDirs.push(dir);
  writeFileSync(join(dir, '_rules.yaml'), yaml);
  try {
    return { rules: loadRules(dir), error: null };
  } catch (e) {
    return { rules: null, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

// ── Shared fixtures ─────────────────────────────────────────────────────────

/** The migration workspace: one over-max title (47 chars) and one under-min
 *  title (2 chars) under a bare v0.10-style { min: 3, max: 40 }. */
const MIGRATION_MD = [
  '- Overview hub',
  '  - Product: draft specification for the claims hub', // 47 chars > 40
  '  - Xy', // 2 chars < 3
  '',
].join('\n');

const BARE_RULES = 'structure:\n  node_length: { min: 3, max: 40 }\n';

/** The wrapped node of §15: title 45 chars, continuations 33 + 26 chars,
 *  folded 106 chars. */
const WRAPPED_MD = [
  '- Token budget: every reading plan respects the',
  '  workspace default_limit and warns',
  '  at the configured threshold',
  '',
].join('\n');

// ── a: backcompat — the bare v0.10 form still parses and works ──────────────

describe('issue #61: backcompat — bare node_length config', () => {
  test('a: loadRules accepts the bare { min, max } form; optional members normalize to the documented defaults', () => {
    const bare = load(BARE_RULES);
    expect(bare.error).toBeNull();
    expect(bare.rules).not.toBeNull();
    const nl = bare.rules!.structure.node_length as NodeLengthRules;
    expect(nl.min).toBe(3);
    expect(nl.max).toBe(40);
    // Every new member is optional: absent (or normalized to) the default —
    // chars / title / false / warn, the v0.10 measurement.
    expect(nl.unit ?? 'chars').toBe('chars');
    expect(nl.scope ?? 'title').toBe('title');
    expect(nl.strip_references ?? false).toBe(false);
    expect(nl.severity ?? 'warn').toBe('warn');
  });

  test('a2: loadRules accepts the full granular block — every knob set', () => {
    const granular = load([
      'structure:',
      '  node_length: { min: 3, max: 90, unit: words, scope: total, strip_references: true, severity: error }',
      '  multiline: { mode: fold, max_lines: 4, indent_aligned: true, severity: warn }',
      '',
    ].join('\n'));
    expect(granular.error).toBeNull();
    const nl = granular.rules!.structure.node_length as NodeLengthRules;
    expect(nl.min).toBe(3);
    expect(nl.max).toBe(90);
    expect(nl.unit).toBe('words');
    expect(nl.scope).toBe('total');
    expect(nl.strip_references).toBe(true);
    expect(nl.severity).toBe('error');
    const ml = granular.rules!.structure.multiline;
    expect(ml).not.toBeNull();
    expect(ml!.mode).toBe('fold');
    expect(ml!.max_lines).toBe(4);
    expect(ml!.indent_aligned).toBe(true);
    expect(ml!.severity).toBe('warn');
  });

  test('a3: the migration — BOTH findings are warnings at the CLI: exit 1, ok true (v0.10 max was an error)', () => {
    const ws = makeWs('backcompat-cli', { '00-overview.md': MIGRATION_MD, '_rules.yaml': BARE_RULES });
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    // The deliberate severity migration: over-max AND under-min findings are
    // BOTH warnings under the default severity — exit 1 band, ok untouched.
    expect(j.ok).toBe(true);
    expect(r.exit).toBe(1);
    expect(j.counts.errors).toBe(0);
    expect(j.counts.warnings).toBe(2);
    const rules = j.issues.map((i: any) => i.rule).sort();
    expect(rules).toEqual(['structure.node_length.max', 'structure.node_length.min']);
    expect(j.issues.every((i: any) => i.level === 'warning' && i.category === 'structure')).toBe(true);
    // Title scope + chars unit are unchanged: the findings sit on the bullet lines.
    const max = j.issues.find((i: any) => i.rule === 'structure.node_length.max');
    expect(max.line).toBe(2);
    const min = j.issues.find((i: any) => i.rule === 'structure.node_length.min');
    expect(min.line).toBe(3);
  });
});

// ── b: severity verdicts e2e ────────────────────────────────────────────────

describe('issue #61: node_length severity verdicts', () => {
  test('b: error → 2 errors, exit 2, ok:false; warn → 2 warnings, exit 1, ok:true; off → clean, exit 0', () => {
    // severity: error — BOTH findings fatal (the v0.10 max behavior restored
    // for both sides).
    const err = makeWs('sev-error', { '00-overview.md': MIGRATION_MD, '_rules.yaml': 'structure:\n  node_length: { min: 3, max: 40, severity: error }\n' });
    const re = runCli(['check', '--json'], err.tmp);
    const je = parseJsonOut(re.out);
    expect(je.ok).toBe(false);
    expect(re.exit).toBe(2);
    expect(je.counts.errors).toBe(2);
    expect(je.counts.warnings).toBe(0);
    expect(je.issues.every((i: any) => i.level === 'error')).toBe(true);
    expect(je.issues.map((i: any) => i.rule).sort()).toEqual(['structure.node_length.max', 'structure.node_length.min']);

    // severity: warn — the default, spelled explicitly: identical verdicts
    // to the bare config (the a3 migration pin).
    const warn = makeWs('sev-warn', { '00-overview.md': MIGRATION_MD, '_rules.yaml': 'structure:\n  node_length: { min: 3, max: 40, severity: warn }\n' });
    const rw = runCli(['check', '--json'], warn.tmp);
    const jw = parseJsonOut(rw.out);
    expect(jw.ok).toBe(true);
    expect(rw.exit).toBe(1);
    expect(jw.counts.errors).toBe(0);
    expect(jw.counts.warnings).toBe(2);

    // severity: off — the whole check is skipped (§18): clean run.
    const off = makeWs('sev-off', { '00-overview.md': MIGRATION_MD, '_rules.yaml': 'structure:\n  node_length: { min: 3, max: 40, severity: off }\n' });
    const ro = runCli(['check', '--json'], off.tmp);
    const jo = parseJsonOut(ro.out);
    expect(jo.ok).toBe(true);
    expect(ro.exit).toBe(0);
    expect(jo.counts.errors).toBe(0);
    expect(jo.counts.warnings).toBe(0);
    expect(jo.issues).toEqual([]);
  });

  test('b2: --structure enforces the DECLARED severities — a severity:error config fails the gate run', () => {
    const ws = makeWs('sev-gate', { '00-overview.md': MIGRATION_MD, '_rules.yaml': 'structure:\n  node_length: { min: 3, max: 40, severity: error }\n' });
    const r = runCli(['check', '--structure', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(false);
    expect(r.exit).toBe(2);
    expect(j.counts.errors).toBe(2);
    expect(j.issues.every((i: any) => i.level === 'error')).toBe(true);
  });
});

// ── c: unit math e2e ────────────────────────────────────────────────────────

describe('issue #61: node_length units', () => {
  test('c: words — whitespace-split count drives both sides (4 words < min 5; 9 words > max 8)', () => {
    const ws = makeWs('unit-words', {
      '00-overview.md': '- Overview hub alpha beta\n  - One two three four five six seven eight nine\n',
      '_rules.yaml': 'structure:\n  node_length: { min: 5, max: 8, unit: words }\n',
    });
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(1);
    expect(j.counts.warnings).toBe(2);
    expect(j.counts.errors).toBe(0);
    const max = j.issues.find((i: any) => i.rule === 'structure.node_length.max');
    expect(max.line).toBe(2); // 9 words > 8
    const min = j.issues.find((i: any) => i.rule === 'structure.node_length.min');
    expect(min.line).toBe(1); // 4 words < 5
  });

  test('c2: tokens = ceil(chars / 3.5) — 36 chars → 11 tokens > max 10; 2 chars → 1 token < min 3', () => {
    const ws = makeWs('unit-tokens', {
      '00-overview.md': '- Alpha beta gamma delta epsilon zetas\n- Ab\n', // 36 chars / 2 chars
      '_rules.yaml': 'structure:\n  node_length: { min: 3, max: 10, unit: tokens }\n',
    });
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(1);
    expect(j.counts.warnings).toBe(2);
    const max = j.issues.find((i: any) => i.rule === 'structure.node_length.max');
    expect(max.line).toBe(1); // ceil(36 / 3.5) = 11 > 10
    const min = j.issues.find((i: any) => i.rule === 'structure.node_length.min');
    expect(min.line).toBe(2); // ceil(2 / 3.5) = 1 < 3
  });

  test('c3: the canonical estimate is NOT re-calibrated — token_budget.estimate_chars_per_token: 7 changes nothing', () => {
    // With the override honored, ceil(36 / 7) = 6 ≤ 10 would pass and the
    // max finding would vanish; the contract pins the canonical 3.5.
    const ws = makeWs('unit-tokens-override', {
      '00-overview.md': '- Alpha beta gamma delta epsilon zetas\n- Ab\n',
      '_rules.yaml': [
        'structure:',
        '  node_length: { min: 3, max: 10, unit: tokens }',
        'token_budget:',
        '  estimate_chars_per_token: 7',
        '',
      ].join('\n'),
    });
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(1);
    expect(j.counts.warnings).toBe(2);
    expect(j.issues.some((i: any) => i.rule === 'structure.node_length.max' && i.line === 1)).toBe(true);
    expect(j.issues.some((i: any) => i.rule === 'structure.node_length.min' && i.line === 2)).toBe(true);
  });
});

// ── d: scope mechanics e2e ──────────────────────────────────────────────────

describe('issue #61: node_length scope', () => {
  /** Node 1: 38-char title + one 33-char continuation; node 2: 46-char
   *  title, NO continuation. Under scope body only node 1's continuation
   *  text is measured (33 > 20); under scope title both titles trip. */
  const SCOPE_MD = [
    '- Alpha hub node title text that is long',
    '  beta gamma delta epsilon zeta eta',
    '- Omega node without any continuation lines here',
    '',
  ].join('\n');

  test('d: body — the continuation only; the title and continuation-less nodes are NOT evaluated', () => {
    const ws = makeWs('scope-body', {
      '00-overview.md': SCOPE_MD,
      '_rules.yaml': 'structure:\n  node_length: { min: 3, max: 20, scope: body }\n',
    });
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(1);
    expect(j.counts.warnings).toBe(1);
    expect(j.counts.errors).toBe(0);
    const hits = j.issues.filter((i: any) => i.rule === 'structure.node_length.max');
    expect(hits).toHaveLength(1); // the 33-char body of node 1
    // The 38-char title of node 1 and the 46-char continuation-less title
    // of node 2 never fire under scope: body.
  });

  test('d2: title (the default) — control run: both titles trip, the continuation is invisible', () => {
    const ws = makeWs('scope-title-control', {
      '00-overview.md': SCOPE_MD,
      '_rules.yaml': 'structure:\n  node_length: { min: 3, max: 20 }\n',
    });
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(1);
    expect(j.counts.warnings).toBe(2);
    const lines = j.issues.filter((i: any) => i.rule === 'structure.node_length.max').map((i: any) => i.line).sort();
    expect(lines).toEqual([1, 3]); // both titles: 38 > 20 and 46 > 20
  });

  test('d3: total — title + continuations folded with single spaces (55 > 50 while the 15-char title passes)', () => {
    const ws = makeWs('scope-total', {
      '00-overview.md': '- Alpha hub title\n  beta gamma delta epsilon zeta eta theta\n', // 15 + 39 → folded 55
      '_rules.yaml': 'structure:\n  node_length: { min: 3, max: 50, scope: total }\n',
    });
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(1);
    expect(j.counts.warnings).toBe(1);
    const hits = j.issues.filter((i: any) => i.rule === 'structure.node_length.max');
    expect(hits).toHaveLength(1); // folded 55 > 50; title alone (15) would pass
  });
});

// ── e: strip_references e2e ─────────────────────────────────────────────────

describe('issue #61: strip_references', () => {
  /** 48 chars with the pointer, 15 chars without it (label only). The target
   *  exists and resolves, so the refs layer stays silent either way. */
  const REF_NODE_MD = '- Session rules: see 02-authentication.md#Sessions\n';
  const TARGET_MD = '- Authentication\n  - Sessions\n';

  test('e: a long see: target trips max when false (default), not when true', () => {
    const ws = makeWs('strip-false', {
      '00-overview.md': REF_NODE_MD,
      '02-authentication.md': TARGET_MD,
      '_rules.yaml': 'structure:\n  node_length: { min: 3, max: 40 }\n',
    });
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    // strip_references: false — the WRITTEN spelling is measured: 48 > 40.
    expect(r.exit).toBe(1);
    expect(j.counts.warnings).toBe(1);
    const hits = j.issues.filter((i: any) => i.rule === 'structure.node_length.max');
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(1);
    expect(j.issues.filter((i: any) => i.category === 'refs')).toHaveLength(0); // target resolves

    const ws2 = makeWs('strip-true', {
      '00-overview.md': REF_NODE_MD,
      '02-authentication.md': TARGET_MD,
      '_rules.yaml': 'structure:\n  node_length: { min: 3, max: 40, strip_references: true }\n',
    });
    const r2 = runCli(['check', '--json'], ws2.tmp);
    const j2 = parseJsonOut(r2.out);
    // strip_references: true — the see: span is stripped (issue #48
    // trailing-punctuation aware) before measuring: the 15-char label passes.
    expect(j2.ok).toBe(true);
    expect(r2.exit).toBe(0);
    expect(j2.counts.errors).toBe(0);
    expect(j2.counts.warnings).toBe(0);
    expect(j2.issues).toEqual([]);
  });
});

// ── f: the multiline policy ─────────────────────────────────────────────────

describe('issue #61: multiline policy verdicts', () => {
  test('f: forbid — ANY continuation is a policy violation (warning, default severity)', () => {
    const ws = makeWs('ml-forbid', {
      '00-overview.md': [
        '- Token budget: every reading plan respects the',
        '  workspace default_limit and warns',
        '- Overview hub',
        '',
      ].join('\n'),
      '_rules.yaml': 'structure:\n  node_length: { min: 3, max: 200 }\n  multiline:\n    mode: forbid\n',
    });
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(1);
    expect(j.counts.warnings).toBe(1);
    expect(j.counts.errors).toBe(0);
    const forbid = j.issues.find((i: any) => i.rule === 'structure.multiline.forbid');
    expect(forbid).toBeDefined();
    expect(forbid.level).toBe('warning');
    expect(forbid.category).toBe('structure');
    expect(j.issues.filter((i: any) => i.rule.startsWith('structure.node_length'))).toHaveLength(0);
  });

  test('f2: forbid + severity error → exit 2, ok:false — the multiline severity maps like node_length\u2019s', () => {
    const ws = makeWs('ml-forbid-error', {
      '00-overview.md': [
        '- Token budget: every reading plan respects the',
        '  workspace default_limit and warns',
        '',
      ].join('\n'),
      '_rules.yaml': 'structure:\n  node_length: { min: 3, max: 200 }\n  multiline:\n    mode: forbid\n    severity: error\n',
    });
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(false);
    expect(r.exit).toBe(2);
    expect(j.counts.errors).toBe(1);
    const forbid = j.issues.find((i: any) => i.rule === 'structure.multiline.forbid');
    expect(forbid.level).toBe('error');
  });

  test('f3: section absent → the whole policy is OFF — wrapped prose stays clean', () => {
    const ws = makeWs('ml-off', {
      '00-overview.md': WRAPPED_MD,
      '_rules.yaml': 'structure:\n  node_length: { min: 3, max: 70 }\n',
    });
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    // No multiline block: no mode/max_lines/indent_aligned checks run — and
    // node_length (scope title, 45 chars ≤ 70) never saw the continuations.
    expect(j.ok).toBe(true);
    expect(r.exit).toBe(0);
    expect(j.issues).toEqual([]);
  });

  test('f4: max_lines — the ceiling (2 continuations: cap 1 flags, cap 2 is clean)', () => {
    const ws = makeWs('ml-maxlines-1', {
      '00-overview.md': WRAPPED_MD,
      '_rules.yaml': 'structure:\n  node_length: { min: 3, max: 200 }\n  multiline:\n    max_lines: 1\n',
    });
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(1);
    expect(j.counts.warnings).toBe(1);
    const cap = j.issues.find((i: any) => i.rule === 'structure.multiline.max_lines');
    expect(cap).toBeDefined();
    expect(cap.level).toBe('warning');

    const ws2 = makeWs('ml-maxlines-2', {
      '00-overview.md': WRAPPED_MD,
      '_rules.yaml': 'structure:\n  node_length: { min: 3, max: 200 }\n  multiline:\n    max_lines: 2\n',
    });
    const r2 = runCli(['check', '--json'], ws2.tmp);
    const j2 = parseJsonOut(r2.out);
    expect(j2.ok).toBe(true); // 2 ≤ 2 — the boundary is inclusive
    expect(r2.exit).toBe(0);
    expect(j2.issues).toEqual([]);
  });

  test('f5: indent_aligned — a deeper-starting continuation flags; the text-column spelling is clean', () => {
    const ws = makeWs('ml-indent-bad', {
      '00-overview.md': '- Token budget: plans respect default_limit\n   and warn at the threshold\n', // 3-space start
      '_rules.yaml': 'structure:\n  node_length: { min: 3, max: 200 }\n  multiline:\n    indent_aligned: true\n',
    });
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(1);
    expect(j.counts.warnings).toBe(1);
    const align = j.issues.find((i: any) => i.rule === 'structure.multiline.indent_aligned');
    expect(align).toBeDefined();
    expect(align.level).toBe('warning');

    const ws2 = makeWs('ml-indent-good', {
      '00-overview.md': '- Token budget: plans respect default_limit\n  and warn at the threshold\n', // text column (2)
      '_rules.yaml': 'structure:\n  node_length: { min: 3, max: 200 }\n  multiline:\n    indent_aligned: true\n',
    });
    const r2 = runCli(['check', '--json'], ws2.tmp);
    const j2 = parseJsonOut(r2.out);
    expect(j2.ok).toBe(true);
    expect(r2.exit).toBe(0);
    expect(j2.issues).toEqual([]);
  });

  test('f6: fold — node_length evaluates the FOLDED text regardless of scope (106 > 70 while the 45-char title passes)', () => {
    const ws = makeWs('ml-fold', {
      '00-overview.md': WRAPPED_MD,
      '_rules.yaml': 'structure:\n  node_length: { min: 3, max: 70 }\n  multiline:\n    mode: fold\n',
    });
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    // scope is title (the default) and the 45-char title alone would pass —
    // fold OVERRIDES the evaluation string to the folded 106-char text.
    expect(r.exit).toBe(1);
    expect(j.counts.warnings).toBe(1);
    const max = j.issues.find((i: any) => i.rule === 'structure.node_length.max');
    expect(max).toBeDefined();
    expect(max.level).toBe('warning');
    // Fold permits the continuations: no multiline finding beside it.
    expect(j.issues.filter((i: any) => i.rule.startsWith('structure.multiline'))).toHaveLength(0);
  });
});

// ── g/h: the CLI gates ──────────────────────────────────────────────────────

describe('issue #61: CLI gates end-to-end', () => {
  /** A workspace with noise in every suppressed engine: an over-max node
   *  (139 chars > 120, structure), 6 TBD nodes (content.tbd.max + the
   *  redundancy word-frequency warning), a style collapse hint, and a broken
   *  ref (refs.broken.file). No _rules.yaml — every default. */
  const GATE_MD = [
    '- Overview hub',
    '  - Product: draft specification for the claims hub including a deliberately long tail of explanatory text that runs past the configured budget',
    '  - Details: see missing.md',
    '  - Alpha: TBD',
    '  - Beta: TBD',
    '  - Gamma: TBD',
    '  - Delta: TBD',
    '  - Epsilon: TBD',
    '  - Zeta: TBD',
    '  - Returns: lists the API surface',
    '    - Returns: JSON payloads',
    '    - Returns: error codes',
    '',
  ].join('\n');

  test('g: --structure emits ONLY structure + content findings; =strict promotes the warnings to errors; --refs-only unchanged', () => {
    const ws = makeWs('gate', { '00-overview.md': GATE_MD });

    // Plain check (the contrast baseline): the refs error plus four
    // warnings across style/content/redundancy — post-#61 the node_length
    // max finding is a WARNING (the severity migration).
    const plain = runCli(['check', '--json'], ws.tmp);
    const jp = parseJsonOut(plain.out);
    expect(plain.exit).toBe(2);
    expect(jp.ok).toBe(false);
    expect(jp.counts.errors).toBe(1); // refs.broken.file
    expect(jp.counts.warnings).toBe(4); // node_length.max + style.nesting + content.tbd.max + redundancy "tbd"
    expect(jp.issues.some((i: any) => i.rule === 'refs.broken.file' && i.level === 'error')).toBe(true);
    expect(jp.issues.some((i: any) => i.rule === 'structure.node_length.max' && i.level === 'warning')).toBe(true);

    // --structure: structure + content findings ONLY — style, refs and
    // redundancy suppressed; exit contract unchanged (0/1/2).
    const gate = runCli(['check', '--structure', '--json'], ws.tmp);
    const jg = parseJsonOut(gate.out);
    expect(jg.ok).toBe(true);
    expect(gate.exit).toBe(1);
    expect(jg.counts.errors).toBe(0);
    expect(jg.counts.warnings).toBe(2);
    expect(jg.issues.filter((i: any) => i.category === 'refs')).toHaveLength(0);
    expect(jg.issues.filter((i: any) => i.category === 'style')).toHaveLength(0);
    expect(jg.issues.filter((i: any) => i.category === 'redundancy')).toHaveLength(0);
    expect(jg.issues.map((i: any) => i.rule).sort()).toEqual(['content.tbd.max', 'structure.node_length.max']);
    expect(jg.issues.every((i: any) => i.level === 'warning')).toBe(true);

    // --structure=strict: the structure-category warnings are promoted to
    // errors IN PLACE before counting — exit 2, ok:false, no _rules.yaml
    // change (the CI spelling of severity: error).
    const strict = runCli(['check', '--structure=strict', '--json'], ws.tmp);
    const js = parseJsonOut(strict.out);
    expect(js.ok).toBe(false);
    expect(strict.exit).toBe(2);
    expect(js.counts.errors).toBe(2);
    expect(js.counts.warnings).toBe(0);
    expect(js.issues.map((i: any) => i.rule).sort()).toEqual(['content.tbd.max', 'structure.node_length.max']);
    expect(js.issues.every((i: any) => i.level === 'error')).toBe(true);

    // --refs-only: the pre-#61 graph-only gate, unchanged — refs findings
    // only, structure/style/redundancy suppressed, exit 2 on the error.
    const refsOnly = runCli(['check', '--refs-only', '--json'], ws.tmp);
    const jr = parseJsonOut(refsOnly.out);
    expect(refsOnly.exit).toBe(2);
    expect(jr.ok).toBe(false);
    expect(jr.counts.errors).toBe(1);
    expect(jr.counts.warnings).toBe(0);
    expect(jr.issues.filter((i: any) => i.category === 'refs')).toHaveLength(1);
    expect(jr.issues[0].rule).toBe('refs.broken.file');
    expect(jr.issues.filter((i: any) => i.category === 'structure' || i.category === 'content')).toHaveLength(0);
  });
});

describe('issue #61: structure-gate usage errors', () => {
  /** A cwd with NO workspace: an arg-level diagnosis proves the usage error
   *  precedes workspace resolution (the issue #53 discipline). */
  function noWsCwd(): string {
    const dir = join(SCRATCH, `nows-${createdDirs.length + 1}`);
    mkdirSync(dir, { recursive: true });
    createdDirs.push(dir);
    return dir;
  }

  test('h: --structure with --refs-only is a usage error (exit 2, arg diagnosis precedes workspace resolution)', () => {
    const r = runCli(['check', '--structure', '--refs-only', '--json'], noWsCwd());
    expect(r.exit).toBe(2);
    expect(r.out).toContain('structure');
    expect(r.out).not.toContain('no cans workspace found');
  });

  test('h2: --structure with --fix is a usage error (a gate run never mutates files)', () => {
    const r = runCli(['check', '--structure', '--fix', '--json'], noWsCwd());
    expect(r.exit).toBe(2);
    expect(r.out).toContain('structure');
    expect(r.out).not.toContain('no cans workspace found');
  });

  test('h3: --structure=<bad value> is a usage error', () => {
    const r = runCli(['check', '--structure=loose', '--json'], noWsCwd());
    expect(r.exit).toBe(2);
    expect(r.out).toContain('structure');
    expect(r.out).not.toContain('no cans workspace found');
  });

  test('h4: help lists the structure gate', () => {
    const r = runCli(['help'], noWsCwd());
    expect(r.exit).toBe(0);
    expect(r.out).toContain('--structure');
  });
});
