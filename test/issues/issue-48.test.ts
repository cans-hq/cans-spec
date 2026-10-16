/**
 * Issue #48 regression tests — REF_RE must not capture trailing punctuation
 * into the file or anchor tokens of a minted ref.
 *
 * Defect: the §11 ref regex captured greedily up to whitespace/`#` and kept
 * sentence punctuation glued to the token. Natural parenthesized writing —
 * `- Audit — _audit (see effect.md#Audit-spine)` — minted anchor
 * `Audit-spine)` and the checker reported `broken anchor: effect.md#Audit-spine)`
 * although the target node `Audit spine` exists (9 false positives in the
 * reporter's 15-file / 5847-node tree, all with existing targets). The FILE
 * token had the identical problem: `(see auth.md)` captured `auth.md)`.
 *
 * Design (why post-match stripping, not a tighter character class): anchors
 * legitimately contain dots mid-token — a node titled `Section 2.1` is
 * addressed by `#Section-2.1`, and anchorMatches normalizes `-`/`_` to
 * spaces, so excluding `.` from the capture class would break real anchors.
 * The capture stays greedy; TRAILING sentence punctuation is stripped from
 * both tokens after the match. `raw` keeps the user's verbatim spelling —
 * the deep-hop advice quotes it (refs.ts detectDeepHops).
 *
 * Test map:
 *   a ..... issue repro (unit): `_audit (see effect.md#Audit-spine)` mints
 *          file `effect.md`, anchor `Audit-spine` (no `)`), raw verbatim
 *   b ..... trailing `,` / `.)` on the anchor stripped down to the anchor
 *   c ..... parenthesized file-level ref `(see auth.md)` mints `auth.md`
 *   d ..... mid-token dot preserved: `#Section-2.1` still mints `Section-2.1`
 *          and still addresses node "Section 2.1" (anchorMatches unchanged)
 *   e ..... trailing slash preserved: `see auth/` mints `auth/`, and
 *          `(see auth/)` mints `auth/` too (issue #22 contract intact)
 *   f ..... typographic closers (’ ” …) and stacked closers (`”).`) stripped
 *          from both tokens
 *   g ..... pure-punctuation prose ("see .") mints NO ref at all
 *   h ..... punctuation-only anchor (`see 02-a.md#)`) degrades to file-level
 *          (anchor null), the ref itself survives
 *   i ..... control: `see: 02-authentication.md#Sessions` mints unchanged
 *   j ..... §12: multiple refs on one line all minted, each stripped
 *   k ..... §12 edge: `see see:02-b.md` still captures `see:02-b.md` whole —
 *          a ref target is a filename, never a nested `see:`
 *   l ..... resolution (unit): the issue workspace reports NO broken refs —
 *          `Audit-spine` resolves against the `Audit spine` node
 *   m ..... CLI end-to-end: the numbered repro workspace — refs.broken 0,
 *          no broken-anchor error, clean run (exit 0)
 *   n ..... CLI negative control: a genuinely missing anchor (no punctuation
 *          involved) is STILL a broken-anchor error — the fix never swallows
 *          real errors
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { rmSync } from 'fs';

import { parseOutline, flattenNodes } from '../../src/core/outline.ts';
import { buildRefGraph, checkRefs, anchorMatches } from '../../src/core/refs.ts';
import type { OutlineNode, RefTarget } from '../../src/types.ts';
import { spawnCli, REPO } from '../runtime.ts';
import { makeCansWorkspace } from '../helpers.ts';

// ── Unit scaffolding: parse a one-bullet source, collect minted refs ──

function refsOf(src: string): RefTarget[] {
  const nodes = parseOutline(src, '01-audit.md');
  return flattenNodes(nodes).flatMap(n => n.refs);
}

// ── CLI scaffolding (mirrors test/issues/issue-22.test.ts) ──

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-48');
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

// ── The issue's repro. The unit tests keep the issue's exact `effect.md`
// spelling (parseOutline does not care about discovery); the workspace
// variants retarget the same parenthesized shape at a numbered spec file —
// only `NN-*.md` files are discovered and resolvable (fs.ts SPEC_FILE_RE). ──

const ISSUE_LINE = '  - Audit — _audit (see effect.md#Audit-spine)\n';
// Workspace variant: same parenthesized shape, retargeted at the numbered
// file — and worded to stay under the default redundancy keyword threshold
// (4 nodes) so the ONLY finding the fix removes is the broken anchor.
const ISSUE_FILES = {
  '01-audit.md': '- Audit\n  - Audit spine (see 02-effect.md#Audit-spine)\n  - Log retention\n',
  '02-effect.md': '- Effects\n  - Audit spine\n  - Side effects\n',
};

// ── Unit: token minting (the defect itself) ──

describe('issue #48: trailing punctuation never lands in the ref tokens', () => {
  test('a: the issue repro — `(see effect.md#Audit-spine)` mints anchor `Audit-spine`, raw verbatim', () => {
    const refs = refsOf(`- Audit\n${ISSUE_LINE}`);
    expect(refs.length).toBe(1);
    expect(refs[0].file).toBe('effect.md');
    expect(refs[0].anchor).toBe('Audit-spine'); // was `Audit-spine)` — the false positive
    // raw keeps the user's spelling verbatim — deep-hop advice quotes it.
    expect(refs[0].raw).toBe('see effect.md#Audit-spine)');
  });

  test('b: trailing `,` and `.)` on the anchor are stripped down to the anchor', () => {
    const comma = refsOf('- Comma: see 02-a.md#Alpha, then continue\n');
    expect(comma[0].file).toBe('02-a.md');
    expect(comma[0].anchor).toBe('Alpha'); // was `Alpha,`

    const stacked = refsOf('- Stacked: see 02-a.md#Alpha.)\n');
    expect(stacked[0].anchor).toBe('Alpha'); // was `Alpha.)`
  });

  test('c: parenthesized file-level ref — `(see auth.md)` mints file `auth.md`', () => {
    const refs = refsOf('- Auth lives elsewhere (see auth.md)\n');
    expect(refs.length).toBe(1);
    expect(refs[0].file).toBe('auth.md'); // was `auth.md)`
    expect(refs[0].anchor).toBeNull();
    expect(refs[0].raw).toBe('see auth.md)');
  });

  test('d: mid-token dot PRESERVED — `#Section-2.1` mints `Section-2.1` and addresses node "Section 2.1"', () => {
    const refs = refsOf('- Plan: see 02-plan.md#Section-2.1\n');
    expect(refs[0].anchor).toBe('Section-2.1'); // the dot stays — a tighter character class would break this
    // And it still resolves: anchorMatches normalizes `-`/`_` to spaces.
    expect(anchorMatches('Section 2.1', 'Section-2.1')).toBe(true);
  });

  test('e: trailing slash PRESERVED — `see auth/` and `(see auth/)` mint `auth/` (issue #22 contract)', () => {
    const bare = refsOf('- Auth: see auth/\n');
    expect(bare[0].file).toBe('auth/');
    expect(bare[0].anchor).toBeNull();

    const wrapped = refsOf('- Auth: (see auth/)\n');
    expect(wrapped[0].file).toBe('auth/'); // `)` stripped, `/` kept
    expect(wrapped[0].anchor).toBeNull();
  });

  test('f: typographic closers (’ ” …) and stacked closers stripped from both tokens', () => {
    const r1 = refsOf('- One: see 02-a.md#Audit-spine’\n');
    expect(r1[0].anchor).toBe('Audit-spine');

    const r2 = refsOf('- Two: see 02-a.md#Audit…\n');
    expect(r2[0].anchor).toBe('Audit');

    const r3 = refsOf('- Three: (see 02-a.md#Audit-spine”.)\n');
    expect(r3[0].file).toBe('02-a.md');
    expect(r3[0].anchor).toBe('Audit-spine'); // was `Audit-spine”.)`

    const r4 = refsOf('- Four: “see auth.md”\n');
    expect(r4[0].file).toBe('auth.md'); // was `auth.md”` — the opening “ is prose, not part of the token
  });

  test('g: pure-punctuation prose ("see .") mints NO ref at all', () => {
    const refs = refsOf('- Nothing to see .\n');
    expect(refs.length).toBe(0); // was a `see-like prose` ref for file `.` — not a ref, just prose
  });

  test('h: punctuation-only anchor (`see 02-a.md#)`) degrades to a file-level ref', () => {
    const refs = refsOf('- Weird: see 02-a.md#)\n');
    expect(refs.length).toBe(1);
    expect(refs[0].file).toBe('02-a.md');
    expect(refs[0].anchor).toBeNull(); // was `)` — an anchor can never be punctuation-only
  });

  test('i: control — `see: 02-authentication.md#Sessions` mints completely unchanged', () => {
    const refs = refsOf('- Session rules: see: 02-authentication.md#Sessions\n');
    expect(refs.length).toBe(1);
    expect(refs[0].file).toBe('02-authentication.md');
    expect(refs[0].anchor).toBe('Sessions');
    expect(refs[0].raw).toBe('see: 02-authentication.md#Sessions');
  });

  test('j: §12 — multiple refs on one line all minted, each stripped', () => {
    const refs = refsOf('- Links: see 01-a.md#Alpha, plus (see 02-b.md#Beta) and see 03-c.md.\n');
    expect(refs.length).toBe(3);
    expect(refs[0]).toMatchObject({ file: '01-a.md', anchor: 'Alpha' });
    expect(refs[1]).toMatchObject({ file: '02-b.md', anchor: 'Beta' });
    expect(refs[2]).toMatchObject({ file: '03-c.md', anchor: null });
  });

  test('k: §12 edge — `see see:02-b.md` still captures `see:02-b.md` whole', () => {
    const refs = refsOf('- Weird: see see:02-b.md\n');
    expect(refs.length).toBe(1);
    expect(refs[0].file).toBe('see:02-b.md'); // mid-token `:` untouched — a ref target is a filename, never a nested see:
    expect(refs[0].anchor).toBeNull();
  });
});

// ── Unit: resolution — the false positive is gone, the ref resolves ──

describe('issue #48: the parenthesized ref resolves (no broken anchor)', () => {
  test('l: the issue workspace reports zero broken refs — `Audit-spine` hits the `Audit spine` node', () => {
    const ws = makeWs('resolve-repro', ISSUE_FILES);
    const files = new Map<string, OutlineNode[]>();
    for (const [name, body] of Object.entries(ISSUE_FILES)) {
      files.set(name, parseOutline(body, name));
    }
    const graph = buildRefGraph(files, ws.root);
    const issues = checkRefs(files, graph, ws.root);

    // The ref mints clean and resolves: no broken file, no broken anchor.
    expect(graph.forward.get('01-audit.md')!.length).toBe(1);
    expect(graph.forward.get('01-audit.md')![0].anchor).toBe('Audit-spine');
    expect(issues.filter(i => i.level === 'error')).toEqual([]);
  });
});

// ── CLI end-to-end ──

describe('issue #48: cans check end-to-end', () => {
  test('m: the issue repro workspace — refs.broken 0, no broken-anchor error, clean run', () => {
    const ws = makeWs('cli-repro', ISSUE_FILES);
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);

    // Pre-fix this reported `broken anchor: 02-effect.md#Audit-spine)` —
    // 9 occurrences of that shape in the reporter's tree, all false positives.
    expect(j.refs.total).toBe(1);
    expect(j.refs.broken).toBe(0);
    expect(j.issues.some((i: any) => i.rule === 'refs.broken.anchor')).toBe(false);
    expect(j.issues.some((i: any) => /Audit-spine\)/.test(i.message ?? ''))).toBe(false);
    expect(j.counts.errors).toBe(0);
    expect(j.ok).toBe(true);
    expect(r.exit).toBe(0);
  });

  test('n: negative control — a genuinely missing anchor (no punctuation) is STILL an error', () => {
    const ws = makeWs('cli-negative', {
      '01-audit.md': '- Audit\n  - Trace (see 02-effect.md#Missing-node)\n  - Log retention\n',
      '02-effect.md': '- Effects\n  - Audit spine\n  - Side effects\n',
    });
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);

    // The punctuation fix must not swallow real errors: this anchor names no
    // node in 02-effect.md, punctuation or not.
    expect(j.refs.broken).toBe(1);
    const broken = j.issues.find((i: any) => i.rule === 'refs.broken.anchor');
    expect(broken).toBeDefined();
    expect(broken.message).toBe('broken anchor: 02-effect.md#Missing-node — no node matches');
    expect(j.counts.errors).toBe(1);
    expect(j.ok).toBe(false);
    expect(r.exit).toBe(2);
  });
});
