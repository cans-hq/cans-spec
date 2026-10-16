/**
 * Issue #50 regression tests — anchorMatches must normalize the full
 * dash-like family, not just ASCII `-` and `_`.
 *
 * Defect: norm() only mapped ASCII hyphens/underscores to spaces, so a node
 * titled `Layer 1 — C authorizer` (em-dash, U+2014) never matched the anchor
 * `#Layer-1-C-authorizer`. Anchors are written with ASCII hyphens (the §12
 * `#Data-protection` convention) while node titles are prose and routinely
 * use typographic dashes — in the reporter's real tree (15 files, 5847
 * nodes) all 10 dash-titled nodes were false broken anchors.
 *
 * Fix: the normalization class now includes the whole dash-like family —
 * figure dash U+2012, en dash U+2013, em dash U+2014, horizontal bar U+2015,
 * minus sign U+2212 — each maps to a space exactly like `-` and `_`. norm()
 * runs on BOTH sides, so a typographic dash resolves whichever side it sits
 * on (title or anchor).
 *
 * Test map:
 *   a ..... anchorMatches: em-dash title (spaced) vs hyphen anchor — the
 *          exact issue repro (`Layer 1 — C authorizer`)
 *   b ..... anchorMatches: en-dash title vs hyphen anchor
 *   c ..... anchorMatches: em-dash INSIDE the anchor vs plain hyphen title
 *          (dash on the anchor side)
 *   d ..... anchorMatches: tight em-dash without spaces (`Layer 1—C authorizer`)
 *   e ..... anchorMatches: figure-dash / horizontal-bar / minus-sign variants
 *   f ..... controls: exact match, case-insensitivity, `_`↔space — the
 *          pre-existing §12 contracts stay intact
 *   g ..... negative control: genuinely different texts stay false —
 *          equivalence, never fuzzy
 *   h ..... CLI end-to-end: em-dash node title + hyphen-anchor ref → clean
 *          check, refs.broken 0 (broken anchor pre-fix)
 *   i ..... CLI end-to-end: reverse spelling — anchor written WITH the
 *          em-dash resolves against a hyphen title
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { rmSync } from 'fs';

import { anchorMatches } from '../../src/core/refs.ts';
import { spawnCli, REPO } from '../runtime.ts';
import { makeCansWorkspace } from '../helpers.ts';

// ── The dash-like family (U+2012..U+2015, U+2212), as escapes so the
//    codepoints are explicit and can never be visually confused — en and em
//    dashes are near-indistinguishable in most fonts. ──

const FIG = '\u2012';   // figure dash
const EN = '\u2013';    // en dash
const EM = '\u2014';    // em dash
const HB = '\u2015';    // horizontal bar
const MINUS = '\u2212'; // minus sign

// ── The issue's repro workspaces (§11 spec files: /^\d{2}-.+\.md$/) ──

/** The issue's shape: the node title carries a spaced em-dash, the ref
 *  spells the anchor with ASCII hyphens. Before the fix this ref was a
 *  broken anchor (refs.broken.anchor error, exit 2). */
const REPRO_FILES = {
  '00-overview.md': `- Overview\n  - Authorizer: see 02-authentication.md#Layer-1-C-authorizer\n`,
  '02-authentication.md': `- Authentication\n  - Layer 1 ${EM} C authorizer\n`,
};

/** Same shape, reversed: the anchor itself is written with the em-dash and
 *  the node title uses the ASCII hyphen. norm() normalizes both sides, so
 *  this spelling resolves too. */
const REVERSE_FILES = {
  '00-overview.md': `- Overview\n  - Authorizer: see 02-authentication.md#Layer-1${EM}C-authorizer\n`,
  '02-authentication.md': `- Authentication\n  - Layer 1-C authorizer\n`,
};

// ── CLI scaffolding (mirrors test/issues/issue-22.test.ts) ──

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-50');
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

// ── Unit: the normalization class (anchorMatches) ──

describe('issue #50: anchorMatches normalizes the dash-like family', () => {
  test('a: em-dash title vs hyphen anchor — the exact issue repro', () => {
    // `Layer 1 — C authorizer` (spaced em-dash) vs `#Layer-1-C-authorizer`.
    expect(anchorMatches(`Layer 1 ${EM} C authorizer`, 'Layer-1-C-authorizer')).toBe(true);
  });

  test('b: en-dash title vs hyphen anchor', () => {
    expect(anchorMatches(`Layer 1 ${EN} C authorizer`, 'Layer-1-C-authorizer')).toBe(true);
  });

  test('c: em-dash INSIDE the anchor vs plain hyphen title', () => {
    // The dash can sit on the anchor side: norm() runs on both sides.
    expect(anchorMatches('Layer 1-C authorizer', `Layer-1${EM}C-authorizer`)).toBe(true);
  });

  test('d: tight em-dash without spaces (`Layer 1—C authorizer`)', () => {
    // No spaces around the dash — the class is a `+` run, so a dash maps
    // straight to the single separating space.
    expect(anchorMatches(`Layer 1${EM}C authorizer`, 'Layer-1-C-authorizer')).toBe(true);
    // Spaced on the title side vs tight on the anchor side, across families.
    expect(anchorMatches(`Layer 1 ${EM} C authorizer`, `Layer-1${EM}C-authorizer`)).toBe(true);
  });

  test('e: figure dash, horizontal bar and minus sign also map to space', () => {
    expect(anchorMatches(`Layer 1 ${FIG} C authorizer`, 'Layer-1-C-authorizer')).toBe(true);   // U+2012
    expect(anchorMatches(`Layer 1 ${HB} C authorizer`, 'Layer-1-C-authorizer')).toBe(true);    // U+2015
    expect(anchorMatches(`Layer 1 ${MINUS} C authorizer`, 'Layer-1-C-authorizer')).toBe(true); // U+2212
  });

  test('f: controls — the pre-existing §12 contracts stay intact', () => {
    // Exact-match fast path.
    expect(anchorMatches('Sessions', 'Sessions')).toBe(true);
    // Case-insensitive + hyphen↔space (the docs' own `#Data-protection`).
    expect(anchorMatches('Data protection', 'data-protection')).toBe(true);
    // Underscore↔space.
    expect(anchorMatches('Data protection', 'data_protection')).toBe(true);
    // Hyphen↔space on the node side, plain anchor.
    expect(anchorMatches('Data-protection', 'data protection')).toBe(true);
  });

  test('g: negative control — genuinely different texts stay false', () => {
    // Not fuzzy: one differing word is a miss, with or without dashes.
    expect(anchorMatches('Audit spine', 'Audit spool')).toBe(false);
    expect(anchorMatches(`Layer 1 ${EM} C authorizer`, 'Layer-1-D-authorizer')).toBe(false);
  });
});

// ── CLI end-to-end (blackbox) ──

describe('issue #50: cans check end-to-end', () => {
  test('h: em-dash title + hyphen-anchor ref → clean check, refs.broken 0 (broken anchor pre-fix)', () => {
    const ws = makeWs('cli-repro', REPRO_FILES);
    // Plain run first: `cans check` must be clean (exit 0 — no errors, no
    // warnings). Before the fix this exited 2 with a broken-anchor error.
    const plain = runCli(['check'], ws.tmp);
    expect(plain.exit).toBe(0);

    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);

    // 1 ref, 0 broken — the em-dash title resolves to the hyphen anchor.
    expect(r.exit).toBe(0);
    expect(j.refs.total).toBe(1);
    expect(j.refs.broken).toBe(0);
    expect(j.issues.some((i: any) => i.rule === 'refs.broken.anchor')).toBe(false);
  });

  test('i: reverse spelling — anchor written WITH the em-dash resolves too', () => {
    const ws = makeWs('cli-reverse', REVERSE_FILES);
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);

    expect(r.exit).toBe(0);
    expect(j.refs.total).toBe(1);
    expect(j.refs.broken).toBe(0);
    expect(j.issues.some((i: any) => i.rule === 'refs.broken.anchor')).toBe(false);
  });
});
