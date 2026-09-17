/**
 * Issue #5 regression tests — detectDeepHops mesh/cycle semantics.
 *
 * The shipped detector (cans-spec 0.1.2, templates/_rules.yaml max_hops: 1)
 * had three defects, all pinned here:
 *
 *   1. Every mutually-referenced pair was an error: hop count for b was
 *      (longest incoming chain into b) + 1, so any file that both receives and
 *      issues a see: ref hit hop count ≥ 2 — yet mutual back-references are
 *      the documented mesh shape the rest of the engine encourages.
 *   2. The suggestion was self-defeating: for a 2-cycle it advised
 *      `add "see: 02-b.md" directly to 02-b.md` — a self-reference, which
 *      checkRefs reports as level:error. Following the fix advice converted a
 *      deep-hop error into a self-reference error.
 *   3. Verdicts were iteration-order dependent: depthOf memoized values
 *      computed after its cycle guard truncated the recursion, so in a mutual
 *      pair the file the DFS entered first got depth 2, the other depth 1 —
 *      at max_hops: 2 exactly one error, always on the alphabetically-first
 *      file.
 *
 * Contract under test (the fix's semantics):
 *   - Strongly-connected meshes never produce deep-hop issues for refs that
 *     stay inside the mesh; only refs leaving a file's own mesh extend a chain.
 *   - Hop count for such a file = longest simple ref chain ending at it + 1.
 *   - Verdicts are a pure function of graph topology — renaming files or
 *     reordering insertion must not change them.
 *   - Suggestions never propose an edit checkRefs would reject (no
 *     self-references, ever).
 */
import { describe, test, expect } from './testing.ts';
import { parseOutline } from '../src/core/outline.ts';
import { buildRefGraph, detectDeepHops } from '../src/core/refs.ts';
import type { OutlineNode, Issue } from '../src/types.ts';

/** Inline workspace: file key → outline source, parsed exactly like `check` does. */
function filesOf(spec: Record<string, string>): Map<string, OutlineNode[]> {
  const map = new Map<string, OutlineNode[]>();
  for (const [name, body] of Object.entries(spec)) map.set(name, parseOutline(body, name));
  return map;
}

function hops(spec: Record<string, string>, maxHops: number | null = 1): Issue[] {
  return detectDeepHops(buildRefGraph(filesOf(spec), '.'), maxHops);
}

// ── shared graph corpus (individual assertions below + property test) ──

const MUTUAL_PAIR = {
  '01-a.md': '- File A\n  - see: 02-b.md\n',
  '02-b.md': '- File B\n  - see: 01-a.md\n',
};

const MUTUAL_PAIR_RENAMED = {
  '01-b.md': '- File B\n  - see: 02-a.md\n',
  '02-a.md': '- File A\n  - see: 01-b.md\n',
};

const CHAIN_A_B_C = {
  '01-a.md': '- A\n  - see: 02-b.md\n',
  '02-b.md': '- B\n  - see: 03-c.md\n',
  '03-c.md': '- C\n',
};

const CHAIN_A_B_C_RENAMED = {
  '05-x.md': '- X\n  - see: 03-y.md\n',
  '03-y.md': '- Y\n  - see: 01-z.md\n',
  '01-z.md': '- Z\n',
};

const CYCLE_3 = {
  '01-a.md': '- A\n  - see: 02-b.md\n',
  '02-b.md': '- B\n  - see: 03-c.md\n',
  '03-c.md': '- C\n  - see: 01-a.md\n',
};

const MESH_PLUS_EXIT = {
  '01-a.md': '- A\n  - see: 02-b.md\n',
  '02-b.md': '- B\n  - see: 01-a.md\n  - see: 03-c.md\n',
  '03-c.md': '- C\n',
};

const CHAIN_A_B_C_D = {
  '01-a.md': '- A\n  - see: 02-b.md\n',
  '02-b.md': '- B\n  - see: 03-c.md\n',
  '03-c.md': '- C\n  - see: 04-d.md\n',
  '04-d.md': '- D\n',
};

const FOLDER_LAYOUT = {
  '01-a.md': '- A\n  - see: 02-auth.md\n',
  '02-auth/index.md': '- Auth\n  - see: 03-c.md\n',
  '03-c.md': '- C\n',
};

describe('issue #5: detectDeepHops mesh semantics', () => {
  test('repro A: mutual see: pair at the shipped default max_hops: 1 produces zero issues', () => {
    const issues = hops(MUTUAL_PAIR); // default = 1 = what templates/_rules.yaml ships
    expect(issues.length).toBe(0);
    expect(issues.filter(i => i.message.includes('DEEP HOP')).length).toBe(0);
  });

  test('repro B: a symmetric 2-cycle yields the same (empty) verdict under renaming, even at max_hops: 2', () => {
    // Old code: exactly one error, always on the alphabetically-first file —
    // identical topology, order-dependent verdict.
    const original = hops(MUTUAL_PAIR, 2);
    const renamed = hops(MUTUAL_PAIR_RENAMED, 2);
    expect(original).toEqual([]);
    expect(renamed).toEqual([]);
    expect(original).toEqual(renamed);
  });

  test('renaming files preserves the verdict structure of a flagging graph', () => {
    const issuesA = hops(CHAIN_A_B_C, 1);
    const issuesB = hops(CHAIN_A_B_C_RENAMED, 1);
    expect(issuesA.length).toBe(1);
    expect(issuesB.length).toBe(1);
    // The flagged file is the middle of each chain — a function of topology.
    expect(issuesA[0]!.file).toBe('02-b.md');
    expect(issuesB[0]!.file).toBe('03-y.md');
    const rename: Record<string, string> = {
      '01-a.md': '05-x.md',
      '02-b.md': '03-y.md',
      '03-c.md': '01-z.md',
    };
    const re = /01-a\.md|02-b\.md|03-c\.md/g;
    const mapped: Issue[] = issuesA.map((i): Issue => ({
      ...i,
      file: rename[i.file] ?? i.file,
      message: i.message.replace(re, m => rename[m] ?? m),
      suggestion: (i.suggestion ?? '').replace(re, m => rename[m] ?? m),
    }));
    expect(mapped[0]).toEqual(issuesB[0]);
  });

  test('a plain a → b → c chain is still flagged exactly once, on the middle file, with a non-self fix', () => {
    const issues = hops(CHAIN_A_B_C, 1);
    expect(issues.length).toBe(1);
    const issue = issues[0]!;
    expect(issue.file).toBe('02-b.md');
    expect(issue.level).toBe('error');
    expect(issue.category).toBe('refs');
    expect(issue.message).toBe('DEEP HOP: 01-a.md → 02-b.md → 03-c.md');
    // The engine's fix advice must be actionable: never a self-reference.
    expect(issue.suggestion).toBe('add "see: 03-c.md" directly to 01-a.md');
  });

  test('anchor suffixes are preserved in the suggestion exactly as before', () => {
    const issues = hops({
      '01-a.md': '- A\n  - see: 02-b.md\n',
      '02-b.md': '- B\n  - see: 03-c.md#Data-protection\n',
      '03-c.md': '- Data protection\n',
    }, 1);
    expect(issues.length).toBe(1);
    expect(issues[0]!.message).toBe('DEEP HOP: 01-a.md → 02-b.md → 03-c.md');
    expect(issues[0]!.suggestion).toBe('add "see: 03-c.md#Data-protection" directly to 01-a.md');
  });

  test('a 3-cycle is a mesh, not a deep-hop chain', () => {
    expect(hops(CYCLE_3, 1)).toEqual([]);
  });

  test('mesh member forwarding the chain onward is flagged; the mesh back-reference is not', () => {
    const issues = hops(MESH_PLUS_EXIT, 1);
    expect(issues.length).toBe(1);
    // 02-b is flagged: the chain 01-a → 02-b → 03-c leaves the mesh.
    expect(issues[0]!.file).toBe('02-b.md');
    expect(issues[0]!.message).toBe('DEEP HOP: 01-a.md → 02-b.md → 03-c.md');
    expect(issues[0]!.suggestion).toBe('add "see: 03-c.md" directly to 01-a.md');
    // 01-a is NOT flagged: its out edge stays inside its own mesh.
    expect(issues.some(i => i.file === '01-a.md')).toBe(false);
    // 03-c is NOT flagged: no outgoing refs.
    expect(issues.some(i => i.file === '03-c.md')).toBe(false);
  });

  test('4-chain at max_hops 2 flags only the third file (two edges behind it + outgoing)', () => {
    const issues = hops(CHAIN_A_B_C_D, 2);
    expect(issues.length).toBe(1);
    expect(issues[0]!.file).toBe('03-c.md');
    expect(issues[0]!.message).toBe('DEEP HOP: 02-b.md → 03-c.md → 04-d.md');
    expect(issues.some(i => i.file === '02-b.md')).toBe(false);
    expect(issues.some(i => i.file === '04-d.md')).toBe(false);
  });

  test('4-chain at max_hops 1 flags both middle files', () => {
    const issues = hops(CHAIN_A_B_C_D, 1);
    expect(issues.map(i => i.file).sort()).toEqual(['02-b.md', '03-c.md']);
  });

  test('maxHops null keeps the check off (§18 deleted-key semantics)', () => {
    expect(hops(CHAIN_A_B_C_D, null)).toEqual([]);
    expect(hops(MUTUAL_PAIR, null)).toEqual([]);
  });

  test('folder-layout refs (02-auth/index.md style) resolve through targetMatchesKey', () => {
    const issues = hops(FOLDER_LAYOUT, 1);
    expect(issues.length).toBe(1);
    expect(issues[0]!.file).toBe('02-auth/index.md');
    expect(issues[0]!.message).toBe('DEEP HOP: 01-a.md → 02-auth/index.md → 03-c.md');
    expect(issues[0]!.suggestion).toBe('add "see: 03-c.md" directly to 01-a.md');
  });

  test('property: suggestions never self-reference and verdicts are deterministic across calls', () => {
    const corpus: Array<{ name: string; spec: Record<string, string>; maxHops: number | null }> = [
      { name: 'mutual pair @1', spec: MUTUAL_PAIR, maxHops: 1 },
      { name: 'mutual pair @2', spec: MUTUAL_PAIR, maxHops: 2 },
      { name: 'mutual pair renamed @2', spec: MUTUAL_PAIR_RENAMED, maxHops: 2 },
      { name: 'chain @1', spec: CHAIN_A_B_C, maxHops: 1 },
      { name: 'chain renamed @1', spec: CHAIN_A_B_C_RENAMED, maxHops: 1 },
      { name: '3-cycle @1', spec: CYCLE_3, maxHops: 1 },
      { name: 'mesh+exit @1', spec: MESH_PLUS_EXIT, maxHops: 1 },
      { name: 'mesh+exit @2', spec: MESH_PLUS_EXIT, maxHops: 2 },
      { name: '4-chain @1', spec: CHAIN_A_B_C_D, maxHops: 1 },
      { name: '4-chain @2', spec: CHAIN_A_B_C_D, maxHops: 2 },
      { name: '4-chain @null', spec: CHAIN_A_B_C_D, maxHops: null },
      { name: 'folder layout @1', spec: FOLDER_LAYOUT, maxHops: 1 },
    ];
    for (const c of corpus) {
      const first = hops(c.spec, c.maxHops);
      const second = hops(c.spec, c.maxHops);
      expect(second, `${c.name}: verdict must be deterministic across calls`).toEqual(first);
      for (const issue of first) {
        const label = `${c.name}: [${issue.message}]`;
        expect(issue.suggestion, label).toBeDefined();
        // The suggested edit target (file after "directly to ") is never the
        // flagged file itself, and the suggested ref is never a self-reference.
        const editTarget = /directly to (\S+)$/.exec(issue.suggestion!);
        expect(editTarget, label).not.toBeNull();
        expect(editTarget![1]!, label).not.toBe(issue.file);
        const suggestedRef = /see: (\S+)/.exec(issue.suggestion!);
        expect(suggestedRef, label).not.toBeNull();
        expect(suggestedRef![1]!, label).not.toBe(issue.file);
        // Message shape: DEEP HOP: <from> → <flagged> → <out>, flagged in the
        // middle, endpoints distinct from it.
        const parts = issue.message.replace('DEEP HOP: ', '').split(' → ');
        expect(parts.length, label).toBe(3);
        expect(parts[1], label).toBe(issue.file);
        expect(parts[0], label).not.toBe(parts[1]);
        expect(parts[2], label).not.toBe(parts[1]);
      }
    }
  });
});
