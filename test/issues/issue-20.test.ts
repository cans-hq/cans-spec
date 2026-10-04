/**
 * Issue #20 — `cans import` (default cans-wins) silently appends a re-imported
 * node that was reworded beyond the three match layers as a NEW duplicate
 * sibling: conflicts: [], exit 0, "(merged)".
 *
 * Reported repro (v0.3.0, still broken at b859e30):
 *   cans init
 *   cans export logseq
 *   sed -i 's/- Sign up: TBD/- Sign up: DONE - changed externally/' \
 *     cans-export/logseq/02-authentication.md
 *   cans import logseq cans-export/logseq/02-authentication.md
 *   → cans/02-authentication.md gains "Sign up: DONE - changed externally" as a
 *     4th sibling while keeping "Sign up: TBD" — the concept forks silently on
 *     both sides. Word overlap {sign, up} / max(3, 5) = 0.4 < 0.5, so the exact
 *     (normalized) → near-match (≥ 0.75) → positional counterpart (≥ 0.5) layers
 *     all miss and the fall-through "new node" branch appends it.
 *
 * Fix under test (§27 merge semantics + the §35 import.json conflicts[] shape):
 *   a FINAL same-parent diverged-sibling guard before the append — an import
 *   node that shares the leading stem (first two significant words) with an
 *   existing sibling under the SAME parent AND corroborating word overlap
 *   (token-Jaccard ≥ 0.3, or ≥ half of the existing sibling's significant
 *   tokens surviving — robust to lengthening) is a CONFLICT: record
 *   { file, line, cansVersion, importVersion, resolution }, never a silent
 *   duplicate sibling.
 *
 * Why the conjunction (documented in code + §27): the repro pair has Jaccard
 * 0.33 while the genuinely distinct "Sign up: TBD" vs "Sign in: TBD" has
 * Jaccard 0.50 — no Jaccard-only floor separates them; the two-word stem does
 * ("sign up" ≠ "sign in"), and the overlap metrics corroborate the stem.
 *
 * Method: blackbox CLI spawn (test/runtime.ts spawnCli) against scratch
 * workspaces under repo/.tmp/issues/issue-20 (gitignored), afterEach cleanup.
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';

import { spawnCli, REPO } from '../runtime.ts';

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-20');

/** The default scaffold's 02-authentication.md (exact bytes, trailing newline). */
const AUTH_SCAFFOLD = '- Authentication\n  - Sign up: TBD\n  - Sessions: TBD\n  - Passwords: TBD\n';

/** The issue's rewording: word overlap 0.4 with "Sign up: TBD" (< 0.5). */
const REWORDED = 'Sign up: DONE - changed externally';

interface Ws { root: string; cans: string; page: string }

const createdDirs: string[] = [];
let wsSeq = 0;

function makeWs(name: string): Ws {
  const root = join(SCRATCH, `${name}-${++wsSeq}`);
  mkdirSync(root, { recursive: true });
  createdDirs.push(root);
  return { root, cans: join(root, 'cans'), page: '' };
}

/** Blackbox CLI spawn, isolated from any ambient CANS_ROOT. */
function runCli(args: string[], cwd: string) {
  return spawnCli(args, cwd, { ...process.env, CANS_ROOT: '' });
}

/** The issue's exact repro flow: `cans init` → `cans export logseq` → external
 *  edit of the exported page → re-import that page. `reworded` replaces the
 *  "- Sign up: TBD" line of the export. */
function reproWs(name: string, reworded: string): Ws {
  const ws = makeWs(name);
  const init = runCli(['init'], ws.root);
  if (init.exit !== 0) throw new Error(`setup: init failed: ${init.out}${init.err}`);
  const exp = runCli(['export', 'logseq'], ws.root);
  if (exp.exit !== 0) throw new Error(`setup: export failed: ${exp.out}${exp.err}`);
  const page = join(ws.root, 'cans-export', 'logseq', '02-authentication.md');
  const before = readFileSync(page, 'utf-8');
  if (!before.includes('- Sign up: TBD')) throw new Error('setup: exported page lacks "- Sign up: TBD"');
  writeFileSync(page, before.replace('- Sign up: TBD', `- ${reworded}`));
  ws.page = page;
  return ws;
}

/** Workspace holding the scaffold-shaped 02-authentication.md (no init needed). */
function seededWs(name: string): Ws {
  const ws = makeWs(name);
  mkdirSync(ws.cans, { recursive: true });
  writeFileSync(join(ws.cans, '02-authentication.md'), AUTH_SCAFFOLD);
  return ws;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('issue #20 — CLI: diverged re-import is a conflict, never a silent duplicate', () => {
  test('(a) exact repro: --json reports the divergence in conflicts[] and NO duplicate sibling is appended', () => {
    const ws = reproWs('exact-repro', REWORDED);
    const before = readFileSync(join(ws.cans, '02-authentication.md'), 'utf-8');
    const r = runCli(['import', 'logseq', ws.page, '--json'], ws.root);
    expect(r.exit).toBe(0); // §19: conflicts are reported, the import itself succeeds
    const j = JSON.parse(r.out);
    expect(j.ok).toBe(true);
    expect(j.merged).toEqual(['02-authentication.md']);
    // §35 conflicts[] shape — the diverged node IS the conflict.
    expect(Array.isArray(j.conflicts)).toBe(true);
    expect(j.conflicts.length).toBe(1);
    const c = j.conflicts[0];
    expect(c.file).toBe('02-authentication.md');
    expect(c.line).toBe(2); // the "Sign up: TBD" line in the canonical file
    expect(c.cansVersion).toBe('Sign up: TBD');
    expect(c.importVersion).toBe(REWORDED);
    expect(c.resolution).toBe('cans-wins');
    // cans-wins keeps the CANS text and appends nothing — file byte-identical.
    const after = readFileSync(join(ws.cans, '02-authentication.md'), 'utf-8');
    expect(after).toBe(before);
    expect((after.match(/- Sign up: TBD/g) ?? []).length).toBe(1);
    expect(after).not.toContain('DONE - changed externally');
  });

  test('(a-human) exact repro: human output carries the conflict line, not just "(merged)"', () => {
    const ws = reproWs('human-output', REWORDED);
    const r = runCli(['import', 'logseq', ws.page], ws.root);
    expect(r.exit).toBe(0);
    expect(r.out).toContain('~ 02-authentication.md (merged)');
    // §36 import conflict line: `  ! <file>:<line> <resolution>`
    expect(r.out).toMatch(/!\s+02-authentication\.md:2\s+cans-wins/);
    const after = readFileSync(join(ws.cans, '02-authentication.md'), 'utf-8');
    expect(after).toBe(AUTH_SCAFFOLD);
  });

  test('(b) genuinely distinct new siblings still append cleanly with conflicts: []', () => {
    // "Sign in: TBD" is the issue's warned counterexample: Jaccard vs
    // "Sign up: TBD" is 0.50 (above any low floor) — only the two-word stem
    // ("sign up" ≠ "sign in") keeps it distinct. It MUST stay a clean append.
    const ws = seededWs('new-siblings');
    const page = join(ws.root, 'incoming.md');
    writeFileSync(page, '- Authentication\n  - Sign in: TBD\n  - Email verification: TBD\n');
    const r = runCli(['import', 'logseq', page, '--json'], ws.root);
    expect(r.exit).toBe(0);
    const j = JSON.parse(r.out);
    expect(j.ok).toBe(true);
    expect(j.conflicts).toEqual([]); // nothing flagged — both nodes are genuinely new
    expect(j.merged).toEqual(['02-authentication.md']);
    const after = readFileSync(join(ws.cans, '02-authentication.md'), 'utf-8');
    expect(after).toBe([
      '- Authentication',
      '  - Sign up: TBD',
      '  - Sessions: TBD',
      '  - Passwords: TBD',
      '  - Sign in: TBD',
      '  - Email verification: TBD',
      '',
    ].join('\n'));
  });

  test('(c) repeat import of the same diverged variant is idempotent — same single conflict, still no append', () => {
    const ws = reproWs('idempotent', REWORDED);
    const before = readFileSync(join(ws.cans, '02-authentication.md'), 'utf-8');
    for (let i = 0; i < 2; i++) {
      const r = runCli(['import', 'logseq', ws.page, '--json'], ws.root);
      expect(r.exit).toBe(0);
      const j = JSON.parse(r.out);
      // Each run reports the SAME divergence once — no compounding duplicates
      // AND no compounding conflict entries.
      expect(j.conflicts.length).toBe(1);
      expect(j.conflicts[0].cansVersion).toBe('Sign up: TBD');
      expect(j.conflicts[0].importVersion).toBe(REWORDED);
      expect(j.conflicts[0].resolution).toBe('cans-wins');
      const after = readFileSync(join(ws.cans, '02-authentication.md'), 'utf-8');
      expect(after).toBe(before);
    }
  });

  test('(d) round-trip: `cans export logseq` still works after the guarded import', () => {
    const ws = reproWs('export-after', REWORDED);
    const imp = runCli(['import', 'logseq', ws.page], ws.root);
    expect(imp.exit).toBe(0);
    const x = runCli(['export', 'logseq', '--json'], ws.root);
    expect(x.exit).toBe(0);
    const j = JSON.parse(x.out);
    expect(j.ok).toBe(true);
    expect(j.filesExported).toBeGreaterThanOrEqual(7); // full default scaffold
    // The exported page round-trips the canonical (cans-wins) text.
    const exported = readFileSync(join(ws.root, 'cans-export', 'logseq', '02-authentication.md'), 'utf-8');
    expect(exported).toContain('- Sign up: TBD');
    expect(exported).not.toContain('DONE - changed externally');
  });

  test('(e) import-wins resolves the guard conflict by overwriting the sibling — no duplicate', () => {
    const ws = reproWs('import-wins', REWORDED);
    const r = runCli(['import', 'logseq', ws.page, '--merge-strategy', 'import-wins', '--json'], ws.root);
    expect(r.exit).toBe(0);
    const j = JSON.parse(r.out);
    expect(j.conflicts.length).toBe(1);
    expect(j.conflicts[0].resolution).toBe('import-wins');
    expect(j.conflicts[0].cansVersion).toBe('Sign up: TBD');
    expect(j.conflicts[0].importVersion).toBe(REWORDED);
    // §27: import-wins overwrites on conflict — one node, the import text.
    const after = readFileSync(join(ws.cans, '02-authentication.md'), 'utf-8');
    expect((after.match(/Sign up/g) ?? []).length).toBe(1);
    expect(after).toContain(`- ${REWORDED}`);
    expect(after).not.toContain('- Sign up: TBD');
  });

  test('(f) ask reports the divergence (cansVersion filled) and writes nothing', () => {
    const ws = reproWs('ask', REWORDED);
    const before = readFileSync(join(ws.cans, '02-authentication.md'), 'utf-8');
    const r = runCli(['import', 'logseq', ws.page, '--merge-strategy', 'ask', '--json'], ws.root);
    expect(r.exit).toBe(0);
    const j = JSON.parse(r.out);
    expect(j.merged).toEqual([]); // §27: ask = report, don't merge
    expect(j.conflicts.length).toBe(1);
    // Richer than the plain ask fall-through: the guard names the sibling it
    // diverged from, so a machine consumer can resolve it.
    expect(j.conflicts[0].cansVersion).toBe('Sign up: TBD');
    expect(j.conflicts[0].importVersion).toBe(REWORDED);
    expect(j.conflicts[0].resolution).toBe('ask');
    expect(readFileSync(join(ws.cans, '02-authentication.md'), 'utf-8')).toBe(before);
  });
});
