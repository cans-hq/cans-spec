/**
 * Issue #53 Part 1.1 regression tests — the canonical anchor-slug algorithm
 * (Option A) and its publication.
 *
 * Defect: the slug algorithm was implicit — authors had to reverse-engineer
 * the slugifier by trial and error. Node `Layer 1 — C authorizer` (em-dash
 * U+2014) was referenced as `#Layer-1-C-authorizer`, failed, and the error
 * suggested renaming the NODE to match the ref.
 *
 * Fix (Option A, as the issue recommends): every character of the dash-like
 * family is a separator exactly like `-` and `_`; a separator run collapses
 * to one `-`; everything else is preserved verbatim, case included. The
 * algorithm is published in `templates/_rules.yaml#slug`, and
 * `anchorMatches` now normalizes through the same single source of truth
 * (core/slug.ts), widened to the full dash family.
 *
 * Test map:
 *   a ..... anchorSlug: the issue's exact repro (`Layer 1 — C authorizer`
 *          → `Layer-1-C-authorizer`, case preserved)
 *   b ..... anchorSlug: the full dash family collapses to single hyphens
 *   c ..... anchorSlug: verbatim preservation (punctuation, case, CJK) and
 *          mixed separator runs
 *   d ..... anchorSlug: underscore and NBSP are separators; zero-width
 *          characters are NOT (documented — flagged by slugConfusables)
 *   e ..... anchorSlug: trim / empty / separators-only edge cases
 *   f ..... normalizeForAnchor: the §12 matching contract, including the
 *          issue #50 dash family (superset — regression pins)
 *   g ..... anchorMatches: still exact-after-normalization, never fuzzy
 *   h ..... slugSimilarity / nearSlugMatches: ranking, threshold, ambiguity
 *   i ..... slugConfusables / charLabel: the Part 1.5 safe-set scan
 *   j ..... publication: templates/_rules.yaml carries an inert `slug:`
 *          section that parses and never changes check behavior
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { rmSync, readFileSync, writeFileSync } from 'fs';

import {
  DASH_FAMILY,
  anchorSlug,
  normalizeForAnchor,
  slugSimilarity,
  nearSlugMatches,
  slugConfusables,
  charLabel,
  SLUG_SUGGEST_THRESHOLD,
} from '../../src/core/slug.ts';
import { anchorMatches } from '../../src/core/refs.ts';
import { parseMinimalYaml } from '../../src/core/rules.ts';
import { spawnCli, REPO } from '../runtime.ts';
import { makeCansWorkspace } from '../helpers.ts';

// ── The dash-like family, as escapes so the codepoints stay explicit ──

const FIG = '\u2012';   // figure dash
const EN = '\u2013';    // en dash
const EM = '\u2014';    // em dash
const HB = '\u2015';    // horizontal bar
const MINUS = '\u2212'; // minus sign
const NBSP = '\u00A0';  // non-breaking space
const ZWJ = '\u200D';   // zero-width joiner

// ── Unit: the canonical algorithm ──

describe('issue #53 1.1: anchorSlug — the canonical Option A slug', () => {
  test('a: the issue repro — em-dash title slugs to single hyphens, case preserved', () => {
    expect(anchorSlug(`Layer 1 ${EM} C authorizer`)).toBe('Layer-1-C-authorizer');
  });

  test('b: every dash-family member is a separator collapsing to one hyphen', () => {
    for (const dash of DASH_FAMILY) {
      expect(anchorSlug(`Layer 1 ${dash} C authorizer`)).toBe('Layer-1-C-authorizer');
    }
    // The full zoo in one run still collapses to a single hyphen.
    expect(anchorSlug(`A -${EM}${EN}${FIG}${HB}${MINUS} B`)).toBe('A-B');
  });

  test('c: non-separator characters are preserved verbatim, case included', () => {
    expect(anchorSlug('Data protection')).toBe('Data-protection'); // §12 convention
    expect(anchorSlug("What's Next?")).toBe("What's-Next?");
    expect(anchorSlug('API (v2)')).toBe('API-(v2)');
    expect(anchorSlug('データ保護')).toBe('データ保護'); // non-ASCII passes through
    expect(anchorSlug('HTTPS/TLS termination')).toBe('HTTPS/TLS-termination');
  });

  test('d: underscore and NBSP are separators; zero-widths are not (flagged instead)', () => {
    expect(anchorSlug('Data_protection')).toBe('Data-protection');
    expect(anchorSlug(`Layer 1${NBSP}C authorizer`)).toBe('Layer-1-C-authorizer');
    // Documented: zero-width characters are preserved verbatim — they are
    // not separators, and slugConfusables (Part 1.5) is what surfaces them.
    expect(anchorSlug(`A${ZWJ}B`)).toBe(`A${ZWJ}B`);
  });

  test('e: edge cases — trimming, whitespace-only, empty', () => {
    expect(anchorSlug('  Sessions  ')).toBe('Sessions');
    expect(anchorSlug(' -—- ')).toBe('');
    expect(anchorSlug('')).toBe('');
  });
});

// ── Unit: the matching normalization (single source of truth) ──

describe('issue #53 1.1: normalizeForAnchor — the §12 matching contract', () => {
  test('f: case-insensitive, separator-insensitive, run-collapsing (incl. #50 family)', () => {
    // The §12 docs' own convention.
    expect(normalizeForAnchor('Data protection')).toBe(normalizeForAnchor('data-protection'));
    expect(normalizeForAnchor('Data_protection')).toBe('data protection');
    // The issue #50 pins — the widened family still folds every member.
    for (const dash of ['\u2010', '\u2011', FIG, EN, EM, HB, '\u2043', MINUS, '\uFE58', '\uFE63', '\uFF0D']) {
      expect(normalizeForAnchor(`Layer 1 ${dash} C`)).toBe('layer 1 c');
    }
    // A mixed run collapses to one space; case folds; edges trim.
    expect(normalizeForAnchor(`  A -_${EM} B `)).toBe('a b');
  });

  test('g: anchorMatches stays exact-after-normalization — never fuzzy', () => {
    // Issue #50 regression pins (all still green through the shared core).
    expect(anchorMatches(`Layer 1 ${EM} C authorizer`, 'Layer-1-C-authorizer')).toBe(true);
    expect(anchorMatches('Layer 1-C authorizer', `Layer-1${EM}C-authorizer`)).toBe(true);
    expect(anchorMatches('Data protection', 'data_protection')).toBe(true);
    // Not fuzzy: a one-letter difference is a miss (that is Part 1.3's job).
    expect(anchorMatches(`Layer 1 ${EM} C authorizer`, 'Layer-1-D-authorizer')).toBe(false);
  });
});

// ── Unit: the fuzzy layer for suggestions / gated --fix repair ──

describe('issue #53 1.1: slugSimilarity and nearSlugMatches', () => {
  test('h: ranking, threshold gate and ambiguity surface', () => {
    // Identical after normalization scores exactly 1.
    expect(slugSimilarity(`Layer 1 ${EM} C authorizer`, 'Layer-1-C-authorizer')).toBe(1);
    // The typo case: one letter off is still ~0.95 — a "did you mean".
    const typo = slugSimilarity(`Layer 1 ${EM} C authorizer`, 'Layer-1-D-authorizer');
    expect(typo).toBeGreaterThanOrEqual(SLUG_SUGGEST_THRESHOLD);
    expect(typo).toBeLessThan(1);
    // Genuinely different is below the floor.
    expect(slugSimilarity('Audit spine', 'Totally different node')).toBeLessThan(SLUG_SUGGEST_THRESHOLD);

    const ranked = nearSlugMatches(
      [`Layer 1 ${EM} C authorizer`, 'Token hygiene', 'Layer 1 - C authorizor'],
      'Layer-1-C-authorizer',
    );
    expect(ranked.length).toBe(2);
    expect(ranked[0]!.score).toBeGreaterThanOrEqual(ranked[1]!.score);
    expect(ranked.map(m => m.text)).toContain(`Layer 1 ${EM} C authorizer`);
    // Conservative floor: a genuinely DIFFERENT word (authorization vs
    // authorizer, ratio ≈ 0.79) stays below the threshold — the fuzzy layer
    // suggests typos, never a lookalike concept.
    expect(nearSlugMatches(['Layer 1 - C authorization'], 'Layer-1-C-authorizer')).toEqual([]);
    // Two near candidates = ambiguous — callers must see both, not a coin
    // flip (the realistic shape: sibling nodes one letter apart).
    const ambiguous = nearSlugMatches(
      [`Layer 1 ${EM} C authorizer`, `Layer 1 ${EM} D authorizer`],
      'Layer-1-X-authorizer',
    );
    expect(ambiguous.length).toBe(2);
    // Nothing close → empty (the "truly no node matches" branch of Part 1.3).
    expect(nearSlugMatches(['Token hygiene'], 'Layer-1-C-authorizer')).toEqual([]);
  });
});

// ── Unit: the Part 1.5 safe-set scan ──

describe('issue #53 1.5 groundwork: slugConfusables and charLabel', () => {
  test('i: non-ASCII and invisible characters are flagged; plain ASCII is not', () => {
    expect(slugConfusables('Sessions and tokens')).toEqual([]);
    expect(slugConfusables("What's Next? (v2)")).toEqual([]);
    expect(slugConfusables(`Layer 1 ${EM} C authorizer`)).toEqual([EM]);
    expect(slugConfusables(`A${NBSP}B${ZWJ}C`)).toEqual([NBSP, ZWJ]);
    expect(slugConfusables('Café “quotes”')).toEqual(['é', '“', '”']);
    // Labels name the invisible ones; printable non-ASCII shows both forms.
    expect(charLabel(ZWJ)).toBe('ZWJ(U+200D)');
    expect(charLabel(NBSP)).toBe('NBSP(U+00A0)');
    expect(charLabel(EM)).toBe(`—(U+2014)`);
    expect(charLabel('A')).toBe('A');
  });
});

// ── Publication: templates/_rules.yaml#slug ──

describe('issue #53 1.1: the algorithm is published in _rules.yaml', () => {
  test('j: the template carries an inert slug: section that parses cleanly', () => {
    const template = readFileSync(join(REPO, 'templates', '_rules.yaml'), 'utf-8');
    const parsed = parseMinimalYaml(template);
    expect((parsed.slug as Record<string, unknown>).algorithm).toBe('dash-normalized');
    expect((parsed.slug as Record<string, unknown>).example).toBe(`Layer 1 ${EM} C authorizer -> Layer-1-C-authorizer`);
    // The checkable sections are untouched by the new documentation block.
    expect((parsed.structure as Record<string, unknown>).node_length).toEqual({ min: 3, max: 120 });
  });
});

// ── CLI end-to-end: the published section never changes check behavior ──

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-53-slug-core');
const createdDirs: string[] = [];

afterEach(() => {
  while (createdDirs.length > 0) {
    rmSync(createdDirs.pop()!, { recursive: true, force: true });
  }
});

/** issue-50.test.ts scaffolding: the CLI runs from the PARENT of cans/ (the
 *  workspace is discovered below cwd); writes target the cans root itself. */
function makeWs(name: string, files: Record<string, string>): { tmp: string; root: string } {
  const tmp = join(SCRATCH, `${name}-${createdDirs.length + 1}`);
  createdDirs.push(tmp);
  const root = makeCansWorkspace(tmp, files);
  return { tmp, root };
}

function runCli(args: string[], cwd: string) {
  return spawnCli(args, cwd, { ...process.env, CANS_ROOT: '' });
}

describe('issue #53 1.1: check with the published slug section (blackbox)', () => {
  test('k: a workspace whose _rules.yaml carries the slug: section checks clean', () => {
    const template = readFileSync(join(REPO, 'templates', '_rules.yaml'), 'utf-8');
    const ws = makeWs('slug-section', {
      '00-overview.md': '- Overview\n  - Authorizer: see 02-authentication.md#Layer-1-C-authorizer\n  - Scope\n',
      '02-authentication.md': `- Authentication\n  - Layer 1 ${EM} C authorizer\n  - Token hygiene\n`,
    });
    // Replace the workspace rules file with the FULL published template
    // (slug: section included) — loading must stay clean and the em-dash
    // anchor must resolve.
    writeFileSync(join(ws.root, '_rules.yaml'), template);
    const r = runCli(['check', '--json'], ws.tmp);
    expect(r.exit).toBe(0);
    const j = JSON.parse(r.out);
    expect(j.refs.broken).toBe(0);
    expect(j.counts.errors).toBe(0);
  });

  test('l: the slug section is inert for rules diagnostics (delete-mode untouched)', () => {
    // A sparse override file with ONLY the slug: section = all defaults —
    // the documentation section must not trigger delete-key semantics.
    const ws = makeWs('slug-only', {
      '00-overview.md': '- Overview\n  - Authorizer: see 02-authentication.md#Sessions\n  - Scope\n',
      '02-authentication.md': '- Authentication\n  - Sessions\n  - Token hygiene\n',
    });
    writeFileSync(join(ws.root, '_rules.yaml'), `slug:\n  algorithm: dash-normalized\n`);
    const r = runCli(['check', '--json'], ws.tmp);
    expect(r.exit).toBe(0);
    const j = JSON.parse(r.out);
    // structure checks ran with defaults (no delete-mode wipe): the
    // workspace shape reports normally, not as "off".
    expect(j.counts.errors).toBe(0);
  });
});
