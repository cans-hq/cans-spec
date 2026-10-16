/**
 * Issue #53 Part 1.3 regression tests — the broken-anchor suggestion must
 * follow the node, never the other way around.
 *
 * Defect: when an anchored ref missed, refs.ts suggested
 * `fix the anchor or add a "<anchor>" node to <file>` — inviting the author
 * to RENAME (or duplicate) spec nodes to satisfy a bad ref. The outline is
 * the source of truth; THE REF SHOULD FOLLOW THE NODE.
 *
 * Fix (checkRefs → brokenAnchorSuggestion, on top of the Part 1.1 slug core):
 * on a broken anchor with addressable targets present, the target's real
 * node texts + YAML keys are fuzzy-ranked against the failing anchor
 * (nearSlugMatches ≥ SLUG_SUGGEST_THRESHOLD — resolution itself stays
 * exact-after-normalization, the fuzzy layer exists only for suggestions):
 *   ONE near node → `did you mean <file>#<canonical slug>? — fix the ref
 *   anchor`, with the anchorSlug spelling (the form `cans slug` prints).
 *   TWO+ near nodes → name them (top 3 + …) — ambiguity surfaced, never a
 *   coin flip.
 *   ZERO near nodes → add-the-node advice, worded so it never invites
 *   renaming existing nodes.
 *
 * Test map:
 *   a ..... unit: em-dash-titled node + one-letter-off anchor → did-you-mean
 *          with the canonical slug `Layer-1-C-authorizer` (rule and message
 *          unchanged — only the advice turns around)
 *   b ..... unit: two one-letter-apart siblings + off anchor → suggestion
 *          names BOTH canonical anchors
 *   c ..... unit: genuinely-missing node → add-node wording, NO did-you-mean
 *   d ..... unit: YAML-key near-match (#querry → key `query:`) → did-you-mean
 *          proposes the key's canonical anchor
 *   e ..... unit: synthetic placeholder nodes are never suggested (a
 *          "(table)" phantom cannot be what the author meant)
 *   f ..... CLI end-to-end --json: sections.refs carries the suggestion
 *          verbatim; refs.broken counts it; exit stays 2
 *   g ..... CLI end-to-end human output: the grouped REFS block surfaces the
 *          did-you-mean both folded (group hint) and expanded (--show refs:
 *          per-item fixes appended to every member line)
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { rmSync } from 'fs';

import { parseOutline } from '../../src/core/outline.ts';
import { buildRefGraph, checkRefs } from '../../src/core/refs.ts';
import type { OutlineNode } from '../../src/types.ts';
import { spawnCli, REPO } from '../runtime.ts';
import { makeCansWorkspace } from '../helpers.ts';

// ── The dash-like family, as escapes so the codepoints stay explicit ──

const EM = '\u2014'; // em dash

/** The issue's shape: the target node title carries a spaced em-dash; the ref
 *  is ONE LETTER OFF (`D` for `C`) — a typo, not a different concept. */
const NEAR_MATCH_FILES = {
  '00-overview.md': `- Overview\n  - Authorizer: see 02-authentication.md#Layer-1-D-authorizer\n  - Scope\n`,
  '02-authentication.md': `- Authentication\n  - Layer 1 ${EM} C authorizer\n  - Token hygiene\n`,
};

/** Two sibling nodes one letter apart (C vs D, same dash style) — an off
 *  anchor (`X`) is genuinely ambiguous, and the suggestion must say so, not
 *  pick one. (Same dash on both siblings: the ranked order is then the
 *  stable alphabetical tiebreak — C before D.) */
const AMBIGUOUS_FILES = {
  '00-overview.md': `- Overview\n  - Authorizer: see 02-authentication.md#Layer-1-X-authorizer\n  - Scope\n`,
  '02-authentication.md': `- Authentication\n  - Layer 1 ${EM} C authorizer\n  - Layer 1 ${EM} D authorizer\n`,
};

/** Nothing in the target is anywhere near the anchor — the add-node branch. */
const MISSING_FILES = {
  '00-overview.md': `- Overview\n  - Billing: see 02-authentication.md#Totally-unrelated-node\n  - Scope\n`,
  '02-authentication.md': `- Authentication\n  - Sessions\n  - Token hygiene\n`,
};

/** A YAML target whose mapping key is one edit away from the anchor. */
const YAML_NEAR_FILES = {
  '00-overview.md': `- Overview\n  - Policy: see artifacts/policy.yaml#querry\n  - Second child\n`,
  'artifacts/policy.yaml': 'policy:\n  query:\n    timeout: 30s\n',
};

// ── Unit scaffolding (mirrors test/issues/issue-49.test.ts) ──

function loadFiles(spec: Record<string, string>): Map<string, OutlineNode[]> {
  const map = new Map<string, OutlineNode[]>();
  for (const [name, body] of Object.entries(spec)) map.set(name, parseOutline(body, name));
  return map;
}

// ── CLI scaffolding (mirrors test/issues/issue-53-slug-core.test.ts) ──

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-53-suggestions');
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

// ── Unit: the suggestion follows the node ──

describe('issue #53 1.3: broken-anchor suggestions (checkRefs unit)', () => {
  test('a: em-dash node + one-letter-off anchor → did-you-mean with the canonical slug', () => {
    const ws = makeWs('unit-near', NEAR_MATCH_FILES);
    const files = loadFiles(NEAR_MATCH_FILES);
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);

    const anchorIssues = issues.filter(i => i.rule === 'refs.broken.anchor');
    expect(anchorIssues).toHaveLength(1);
    // The error itself is unchanged: level, rule, message — only the ADVICE
    // turns around.
    expect(anchorIssues[0]!.level).toBe('error');
    expect(anchorIssues[0]!.message).toBe('broken anchor: 02-authentication.md#Layer-1-D-authorizer — no node matches');
    // The ref follows the node: the CANONICAL slug of the near node (the
    // exact form `cans slug` prints), not a node rename.
    expect(anchorIssues[0]!.suggestion).toBe(
      'did you mean 02-authentication.md#Layer-1-C-authorizer? — fix the ref anchor',
    );
    // The inverted wording is gone — no invitation to add/rename nodes here.
    expect(anchorIssues[0]!.suggestion).not.toContain('add a "');
  });

  test('b: two one-letter-apart siblings + off anchor → suggestion names BOTH', () => {
    const ws = makeWs('unit-ambiguous', AMBIGUOUS_FILES);
    const files = loadFiles(AMBIGUOUS_FILES);
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);

    const anchorIssues = issues.filter(i => i.rule === 'refs.broken.anchor');
    expect(anchorIssues).toHaveLength(1);
    // Ambiguity surfaced, never a coin flip: both canonical anchors named
    // (score order, alphabetical tiebreak), comma-separated.
    expect(anchorIssues[0]!.suggestion).toBe(
      'did you mean 02-authentication.md#Layer-1-C-authorizer, 02-authentication.md#Layer-1-D-authorizer? — fix the ref anchor',
    );
  });

  test('c: genuinely-missing node → add-node advice, no did-you-mean', () => {
    const ws = makeWs('unit-missing', MISSING_FILES);
    const files = loadFiles(MISSING_FILES);
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);

    const anchorIssues = issues.filter(i => i.rule === 'refs.broken.anchor');
    expect(anchorIssues).toHaveLength(1);
    // Truly nothing matches: adding the node IS the fix — but the wording
    // must never invite renaming the nodes that DO exist.
    expect(anchorIssues[0]!.suggestion).toBe(
      'no near match in 02-authentication.md — add the "Totally-unrelated-node" node there, or fix the anchor spelling',
    );
    expect(anchorIssues[0]!.suggestion).not.toContain('did you mean');
    expect(anchorIssues[0]!.suggestion).not.toContain('or add a "');
  });

  test('d: YAML-key near-match → did-you-mean proposes the key anchor', () => {
    const ws = makeWs('unit-yaml', YAML_NEAR_FILES);
    const files = loadFiles({ '00-overview.md': YAML_NEAR_FILES['00-overview.md']! });
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);

    const anchorIssues = issues.filter(i => i.rule === 'refs.broken.anchor');
    expect(anchorIssues).toHaveLength(1);
    expect(anchorIssues[0]!.message).toBe('broken anchor: artifacts/policy.yaml#querry — no node matches');
    // The addressable vocabulary of a YAML target is its mapping keys — the
    // one-edit key `query:` is the near match, and its canonical slug is the
    // proposed anchor.
    expect(anchorIssues[0]!.suggestion).toBe('did you mean artifacts/policy.yaml#query? — fix the ref anchor');
  });

  test('e: synthetic placeholder nodes are never suggested', () => {
    // A table before the first bullet mints a synthetic "(table)" node
    // (issue #8). A near anchor must not propose it — the placeholder is a
    // parser artifact, not content a human could have meant — so the miss
    // falls through to the add-node advice instead.
    const files = {
      '00-overview.md': `- Overview\n  - Sessions: see 02-notes.md#table\n  - Scope\n`,
      '02-notes.md': `| col | col |\n|---|---|\n| a | b |\n\n- Notes\n  - Real table node\n  - Other node\n`,
    };
    const ws = makeWs('unit-synthetic', files);
    const map = loadFiles(files);
    // "(table)" scores 1.0 against anchor "table" ONLY if it were a
    // candidate — it is not, and the real nodes are nowhere near.
    const issues = checkRefs(map, buildRefGraph(map, ws.root), ws.root);
    const anchorIssues = issues.filter(i => i.rule === 'refs.broken.anchor');
    expect(anchorIssues).toHaveLength(1);
    expect(anchorIssues[0]!.suggestion).not.toContain('#(table)');
    expect(anchorIssues[0]!.suggestion).toBe(
      'no near match in 02-notes.md — add the "table" node there, or fix the anchor spelling',
    );
  });
});

// ── CLI end-to-end ──

describe('issue #53 1.3: broken-anchor suggestions (CLI blackbox)', () => {
  test('f: check --json carries the did-you-mean in sections.refs.suggestion', () => {
    const ws = makeWs('e2e-near', NEAR_MATCH_FILES);
    const r = runCli(['check', '--json'], ws.tmp);
    expect(r.exit).toBe(2); // still a refs.broken.anchor ERROR — advice only

    const j = parseJsonOut(r.out);
    expect(j.refs.broken).toBe(1);
    expect(j.counts.errors).toBe(1);
    const broken = j.issues.filter((i: any) => i.rule === 'refs.broken.anchor');
    expect(broken).toHaveLength(1);
    expect(broken[0].level).toBe('error');
    expect(broken[0].suggestion).toBe('did you mean 02-authentication.md#Layer-1-C-authorizer? — fix the ref anchor');
    // The canonical slug rides in the machine shape exactly once — agents can
    // copy-paste `file#slug` straight from the suggestion.
    expect(broken[0].suggestion).toContain('Layer-1-C-authorizer');
  });

  test('g: human output surfaces the did-you-mean folded AND expanded', () => {
    const ws = makeWs('e2e-text', AMBIGUOUS_FILES);

    // Folded: the group hint is the first member's fix — visible without
    // any --show flag, and the old "add a node" invitation is gone.
    const folded = runCli(['check', '--refs-only'], ws.tmp);
    expect(folded.exit).toBe(2);
    expect(folded.out).toContain('did you mean 02-authentication.md#Layer-1-C-authorizer, 02-authentication.md#Layer-1-D-authorizer? — fix the ref anchor');
    expect(folded.out).not.toContain('fix the anchor or add a "');

    // Expanded (--show refs): EVERY member line carries its own fix — a
    // multi-anchor group never hides the other refs' did-you-mean advice.
    const expanded = runCli(['check', '--refs-only', '--show', 'refs'], ws.tmp);
    expect(expanded.exit).toBe(2);
    expect(expanded.out).toContain(
      '00-overview.md:2 → 02-authentication.md#Layer-1-X-authorizer — did you mean 02-authentication.md#Layer-1-C-authorizer, 02-authentication.md#Layer-1-D-authorizer? — fix the ref anchor',
    );
  });
});
