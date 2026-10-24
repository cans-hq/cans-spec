/**
 * Issue #53 Part 1.5 regression tests — author-time info-level slug-safety
 * notes.
 *
 * The ask: "cans check could emit an info-level note on any node containing
 * characters outside a 'safe for slugging' set, pointing to the correct
 * anchor. Not a hard failure — just a hint."
 *
 * Fix: the level vocabulary gains 'info' (types.ts IssueLevel; report.ts
 * IssueLike/IssueGroup/SectionReport.infoCount — counted in its OWN bucket,
 * never folded into errorCount/warningCount). checkWorkspace emits
 * refs.slug.hint per real (non-synthetic) node whose text contains
 * slugConfusables characters, naming the node's EXACT canonical anchor
 * (anchorSlug — the form `cans slug` prints), capped at 5 per file plus one
 * summary line. Info never touches ok, exit codes, --strict or the
 * error/warning counts.
 *
 * Issue #59 (this suite's current contract): the band is OPT-IN. Every test
 * below pins the EMISSION semantics with hints enabled — `hints: true` in
 * CheckArgs / `--hints` on the CLI — because that is the only mode where
 * hint items exist at all. The default-off surface (plain check quiet,
 * --json excludes info items, hintCount discoverability, --show refs
 * independence, config gating) is pinned by test/issues/issue-59-hints-off
 * .test.ts. Test b (ASCII → silence) covers the only hint behavior that is
 * mode-independent: zero confusables → zero hints, on or off.
 *
 * Test map:
 *   a ..... unit (checkWorkspace, hints on): em-dash node → exactly one info
 *          issue with the exact message (anchor #Layer-1-C-authorizer, label
 *          —(U+2014)) and the fix hint; infoCount 1; ok true; exitCode 0
 *   b ..... unit: ASCII-only workspace → zero info issues (silence)
 *   c ..... unit: warningCount is UNCHANGED by info notes (paired
 *          workspaces, em-dash vs ASCII hyphen, same warning shape)
 *   d ..... unit: --strict ignores info (ok stays true, exitCode 0)
 *   e ..... unit: cap — 6 confusable nodes → 5 notes + 1 summary line
 *          naming the counts
 *   f ..... unit: the [file] filter scopes hints to the filter-matched file
 *          (issue #11 discipline)
 *   g ..... unit: invisible characters label by NAME (NBSP(U+00A0),
 *          ZWJ(U+200D)) and the anchor preserves zero-widths verbatim
 *   h ..... CLI --hints --json: sections.refs carries level 'info' +
 *          rule refs.slug.hint with the exact anchor and char label; exit 0;
 *          counts stay {errors, warnings} — no info key
 *   i ..... CLI --hints human: ✓ summary mark UNCHANGED; REFS header gains
 *          `· ℹ 1 note`; the ℹ group line + item name the anchor
 *   j ..... CLI --hints human: the cap renders as `ℹ 6× non-obvious slug`
 *          with the `+N more (M total)` summary item
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { rmSync } from 'fs';

import { checkWorkspace, type CheckArgs } from '../../src/commands/check.ts';
import type { CheckResult } from '../../src/types.ts';
import { spawnCli, REPO } from '../runtime.ts';
import { makeCansWorkspace } from '../helpers.ts';

// ── The confusable zoo, as escapes so the codepoints stay explicit ──

const EM = '\u2014';   // em dash
const NBSP = '\u00A0'; // non-breaking space
const ZWJ = '\u200D';  // zero-width joiner

/** Structure-clean single-file workspace whose one node slugs non-obviously.
 *  No refs, no orphans (00-overview.md is excepted), no style/redundancy
 *  findings — the ONLY issue on this tree is the info note, which is what
 *  makes "exit 0 with info present" a meaningful assertion. */
const EM_DASH_FILES = {
  '00-overview.md': `- Overview\n  - Layer 1 ${EM} C authorizer\n  - Scope\n`,
};

/** Same shape, ASCII hyphen — the control that stays fully silent. */
const ASCII_FILES = {
  '00-overview.md': `- Overview\n  - Layer 1 - C authorizer\n  - Scope\n`,
};

/** Six confusable children (distinct words — the keyword-sprawl threshold is
 *  4) → 5 notes + 1 cap-summary line. */
const CAP_FILES = {
  '00-overview.md': [
    '- Overview',
    `  - Alpha ${EM} one`,
    `  - Bravo ${EM} two`,
    `  - Charlie ${EM} three`,
    `  - Delta ${EM} four`,
    `  - Echo ${EM} five`,
    `  - Foxtrot ${EM} six`,
    '',
  ].join('\n'),
};

/** Two spec files, each with one confusable node — for [file] filter scoping
 *  (02-auth.md is an orphan here, which is beside the point being pinned). */
const FILTER_FILES = {
  '00-overview.md': `- Overview\n  - Layer 1 ${EM} C authorizer\n  - Scope\n`,
  '02-auth.md': `- Authentication\n  - Token ${EM} hygiene\n  - Sessions\n`,
};

// ── Unit scaffolding (checkWorkspace direct, mirrors issue41-engine.test.ts) ──

// issue #59: hints are opt-in — every hint-emission assertion in this suite
// runs with the band enabled (the flag path; config-key enablement and the
// default-off surface live in issue-59-hints-off.test.ts).
const BASE_OPTS: CheckArgs = {
  fix: false,
  strict: false,
  refsOnly: false,
  noRedundancy: false,
  file: null,
  json: false,
  hints: true,
};

// ── CLI scaffolding (mirrors test/issues/issue-53-slug-core.test.ts) ──

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-53-slug-hints');
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

// ── Unit: the hint emission ──

describe('issue #53 1.5: slug-safety notes (checkWorkspace unit, hints on)', () => {
  test('a: em-dash node → one info note naming the exact anchor; ok/exit untouched', async () => {
    const ws = makeWs('unit-em-dash', EM_DASH_FILES);
    const r: CheckResult = await checkWorkspace(ws.root, BASE_OPTS);

    // The note is the ONLY issue on this tree — and it changes nothing.
    expect(r.issues).toHaveLength(1);
    expect(r.ok).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.errorCount).toBe(0);
    expect(r.warningCount).toBe(0);
    expect(r.infoCount).toBe(1);

    const hint = r.issues[0]!;
    expect(hint.level).toBe('info');
    expect(hint.category).toBe('refs');
    expect(hint.rule).toBe('refs.slug.hint');
    expect(hint.file).toBe('00-overview.md');
    expect(hint.line).toBe(2);
    expect(hint.message).toBe(
      `non-obvious slug: "Layer 1 ${EM} C authorizer" → #Layer-1-C-authorizer (contains —(U+2014))`,
    );
    expect(hint.suggestion).toBe(
      'the anchor above is the exact form see: refs must use — cans slug prints it for any text',
    );
  });

  test('b: ASCII-only workspace → zero info issues (silence, on or off)', async () => {
    const ws = makeWs('unit-ascii', ASCII_FILES);
    const r = await checkWorkspace(ws.root, BASE_OPTS);
    expect(r.issues).toHaveLength(0);
    expect(r.infoCount ?? 0).toBe(0);
    expect(r.ok).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  test('c: warningCount is unchanged by info notes (paired workspaces)', async () => {
    // Same tree shape; the ONLY difference is the em-dash vs ASCII hyphen.
    // The orphan warning on 02-auth.md must be identical in both runs — the
    // info band never leaks into warningCount. (Both files carry two
    // children so the single-child warning stays out of the picture.)
    const files = (dash: string) => ({
      '00-overview.md': `- Overview\n  - Scope\n  - Charter\n`,
      '02-auth.md': `- Authentication\n  - Layer 1 ${dash} C authorizer\n  - Sessions\n`,
    });
    const withEm = makeWs('pair-em', files(EM));
    const withAscii = makeWs('pair-ascii', files('-'));
    const em = await checkWorkspace(withEm.root, BASE_OPTS);
    const ascii = await checkWorkspace(withAscii.root, BASE_OPTS);

    expect(em.warningCount).toBe(1); // the orphan — identical in both
    expect(ascii.warningCount).toBe(1);
    expect(em.errorCount).toBe(0);
    expect(ascii.errorCount).toBe(0);
    expect(em.exitCode).toBe(1); // warnings band, unchanged by the note
    expect(ascii.exitCode).toBe(1);
    // The ONLY delta is the info band.
    expect(em.infoCount).toBe(1);
    expect(ascii.infoCount ?? 0).toBe(0);
    expect(em.issues.filter(i => i.level === 'info')).toHaveLength(1);
    expect(ascii.issues.filter(i => i.level === 'info')).toHaveLength(0);
  });

  test('d: --strict ignores info — ok stays true, exit stays 0', async () => {
    const ws = makeWs('unit-strict', EM_DASH_FILES);
    const r = await checkWorkspace(ws.root, { ...BASE_OPTS, strict: true });
    // Zero errors, zero warnings — strict has nothing to bite on, and the
    // info note is deliberately outside its scope.
    expect(r.ok).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.infoCount).toBe(1);
  });

  test('e: cap — 6 confusable nodes → 5 notes + 1 summary line naming the counts', async () => {
    const ws = makeWs('unit-cap', CAP_FILES);
    const r = await checkWorkspace(ws.root, BASE_OPTS);

    const hints = r.issues.filter(i => i.rule === 'refs.slug.hint');
    expect(hints).toHaveLength(6); // 5 notes + 1 summary — never 6 note lines
    expect(r.infoCount).toBe(6);
    expect(r.ok).toBe(true);
    expect(r.exitCode).toBe(0); // info never escalates, even capped

    const notes = hints.filter(i => i.line > 0);
    const summary = hints.filter(i => i.line === 0);
    expect(notes).toHaveLength(5);
    expect(notes.map(n => n.line)).toEqual([2, 3, 4, 5, 6]); // document order
    for (const n of notes) {
      expect(n.message).toMatch(/^non-obvious slug: ".*" → #.* \(contains —\(U\+2014\)\)$/);
    }
    expect(notes[0]!.message).toBe(`non-obvious slug: "Alpha ${EM} one" → #Alpha-one (contains —(U+2014))`);
    // The summary names both counts: hidden remainder and true total.
    expect(summary).toHaveLength(1);
    expect(summary[0]!.message).toBe('non-obvious slug: 1 more in 00-overview.md (6 total)');
  });

  test('f: the [file] filter scopes hints to the filter-matched file (issue #11)', async () => {
    const ws = makeWs('unit-filter', FILTER_FILES);
    const r = await checkWorkspace(ws.root, { ...BASE_OPTS, file: '02-auth.md' });
    const hints = r.issues.filter(i => i.rule === 'refs.slug.hint');
    expect(hints).toHaveLength(1);
    expect(hints[0]!.file).toBe('02-auth.md');
    expect(hints[0]!.message).toBe(`non-obvious slug: "Token ${EM} hygiene" → #Token-hygiene (contains —(U+2014))`);
  });

  test('g: invisible characters label by NAME and the anchor preserves zero-widths', async () => {
    const ws = makeWs('unit-invisible', {
      '00-overview.md': `- Overview\n  - A${NBSP}B${ZWJ}C node\n  - Scope\n`,
    });
    const r = await checkWorkspace(ws.root, BASE_OPTS);
    const hint = r.issues.find(i => i.rule === 'refs.slug.hint')!;
    expect(hint).toBeDefined();
    // NBSP is a separator (slugs to `-`); ZWJ is NOT — preserved verbatim
    // (documented in core/slug.ts), which is exactly why the note names it.
    expect(hint.message).toBe(
      `non-obvious slug: "A${NBSP}B${ZWJ}C node" → #A-B${ZWJ}C-node (contains NBSP(U+00A0), ZWJ(U+200D))`,
    );
  });
});

// ── CLI end-to-end (issue #59: --hints opts in — the band never prints by
// default; these pin the OPT-IN surface) ──

describe('issue #53 1.5: slug-safety notes (CLI blackbox, --hints)', () => {
  test('h: check --hints --json carries level info + refs.slug.hint; counts stay {errors, warnings}', () => {
    const ws = makeWs('e2e-json', EM_DASH_FILES);
    const r = runCli(['check', '--hints', '--json'], ws.tmp);
    expect(r.exit).toBe(0); // info NEVER escalates the exit code

    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect(j.exitCode).toBe(0);
    // counts is exactly {errors, warnings} — info is not a finding.
    expect(j.counts).toEqual({ errors: 0, warnings: 0 });
    expect(j.counts.info).toBeUndefined();

    const hints = j.issues.filter((i: any) => i.rule === 'refs.slug.hint');
    expect(hints).toHaveLength(1);
    expect(hints[0].level).toBe('info');
    expect(hints[0].file).toBe('00-overview.md');
    expect(hints[0].line).toBe(2);
    expect(hints[0].message).toBe(
      `non-obvious slug: "Layer 1 ${EM} C authorizer" → #Layer-1-C-authorizer (contains —(U+2014))`,
    );
    // The exact anchor and the named char label ride in the machine shape.
    expect(hints[0].message).toContain('#Layer-1-C-authorizer');
    expect(hints[0].message).toContain('—(U+2014)');
    expect(hints[0].suggestion).toContain('cans slug');
  });

  test('i: human output (--hints) shows the note without changing the ✓ summary mark', () => {
    const ws = makeWs('e2e-text', EM_DASH_FILES);
    const r = runCli(['check', '--hints'], ws.tmp);
    expect(r.exit).toBe(0);

    const lines = r.out.split('\n');
    // Summary line still reads ✓ — a hint is advice, not a finding.
    expect(lines[0]!.startsWith('✓ ')).toBe(true);
    expect(lines[0]!.startsWith('⚠')).toBe(false);
    expect(lines[0]!.startsWith('✗')).toBe(false);
    // REFS header gains the note part beside the healthy line...
    expect(r.out).toContain('REFS  ✓ 0 refs · ℹ 1 note');
    // ...and the hint group prints with the ℹ mark, its item naming the
    // exact anchor, plus the fix hint once.
    expect(r.out).toContain('ℹ 1× non-obvious slug');
    expect(r.out).toContain(`00-overview.md:2 — "Layer 1 ${EM} C authorizer" → #Layer-1-C-authorizer`);
    expect(r.out).toContain('↳ the anchor above is the exact form see: refs must use — cans slug prints it for any text');
  });

  test('j: the cap renders as ℹ 6× non-obvious slug with the +N more summary item', () => {
    const ws = makeWs('e2e-cap', CAP_FILES);
    const r = runCli(['check', '--hints'], ws.tmp);
    expect(r.exit).toBe(0);

    expect(r.out.split('\n')[0]!.startsWith('✓ ')).toBe(true);
    expect(r.out).toContain('REFS  ✓ 0 refs · ℹ 6 notes');
    expect(r.out).toContain('ℹ 6× non-obvious slug');
    expect(r.out).toContain(`00-overview.md:2 — "Alpha ${EM} one" → #Alpha-one`);
    // The per-file cap summary rides as the group's last item.
    expect(r.out).toContain('00-overview.md: +1 more (6 total)');
  });
});
