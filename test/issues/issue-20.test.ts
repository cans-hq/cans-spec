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
 *   root cause 1 — Logseq/Obsidian parsers yield a FLAT indent-annotated list,
 *     which mergeInto walked as if every node were a ROOT: the sibling-level
 *     layers (near-match, positional counterpart) never saw the real sibling
 *     set below the root, so any diverged nested node fell straight to the
 *     append branch (it only LOOKED correctly placed because serializeToCans
 *     writes by `indent`). Fixed by normalizing the flat parse into a tree
 *     (toTree) before the merge walk.
 *   root cause 2 — a rewording below 0.5 word overlap escapes all three match
 *     layers even on a correct tree. Fixed by a FINAL same-parent
 *     diverged-sibling guard before the append: an import node that shares the
 *     leading stem (first two significant words) with an existing sibling
 *     under the SAME parent AND corroborating word overlap (token-Jaccard
 *     ≥ 0.3, or ≥ half of the existing sibling's significant tokens surviving —
 *     robust to lengthening) is a CONFLICT: record
 *     { file, line, cansVersion, importVersion, resolution }, never a silent
 *     duplicate sibling.
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
import { mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'fs';

import { spawnCli, REPO } from '../runtime.ts';
import { isDivergedSibling } from '../../src/commands/import.ts';

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

/** Generalized repro flow (round 6): `cans init` → `cans export logseq` →
 *  external edit replacing `needle` with `replacement` in the exported page
 *  `file` → re-import that page. */
function reproWsEdit(name: string, file: string, needle: string, replacement: string): Ws {
  const ws = makeWs(name);
  const init = runCli(['init'], ws.root);
  if (init.exit !== 0) throw new Error(`setup: init failed: ${init.out}${init.err}`);
  const exp = runCli(['export', 'logseq'], ws.root);
  if (exp.exit !== 0) throw new Error(`setup: export failed: ${exp.out}${exp.err}`);
  const page = join(ws.root, 'cans-export', 'logseq', file);
  const before = readFileSync(page, 'utf-8');
  if (!before.includes(needle)) throw new Error(`setup: exported page lacks "${needle}"`);
  writeFileSync(page, before.replace(needle, replacement));
  ws.page = page;
  return ws;
}

/** The issue's exact repro flow: `cans init` → `cans export logseq` → external
 *  edit of the exported page → re-import that page. `reworded` replaces the
 *  "- Sign up: TBD" line of the export. */
function reproWs(name: string, reworded: string): Ws {
  return reproWsEdit(name, '02-authentication.md', '- Sign up: TBD', `- ${reworded}`);
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

describe('issue #20 — unit: diverged-sibling guard predicate (isDivergedSibling)', () => {
  test('the repro pair fires: leading stem "sign up" + token-Jaccard 2/6 ≈ 0.33', () => {
    expect(isDivergedSibling('Sign up: TBD', 'Sign up: DONE - changed externally')).toBe(true);
  });

  test('lengthening the rewording still fires (containment path — Jaccard decays below the floor)', () => {
    // shared {sign, up} / min(3, 12) = 0.67 ≥ 0.5 while Jaccard is 2/13 ≈ 0.15.
    // This is the "I finished this and recorded what happened" edit: the more
    // the node is lengthened, the guard must NOT grow more uncertain.
    expect(isDivergedSibling(
      'Sign up: TBD',
      'Sign up: DONE and the ops team also recorded the external migration notes',
    )).toBe(true);
  });

  test('genuinely distinct scaffold siblings never fire (pairwise stems differ)', () => {
    expect(isDivergedSibling('Sign up: TBD', 'Sessions: TBD')).toBe(false);
    expect(isDivergedSibling('Sign up: TBD', 'Passwords: TBD')).toBe(false);
    expect(isDivergedSibling('Sessions: TBD', 'Passwords: TBD')).toBe(false);
    expect(isDivergedSibling('Sign up: TBD', 'Email verification: TBD')).toBe(false);
  });

  test('the warned counterexample: "Sign in: TBD" is NOT "Sign up: TBD" despite Jaccard 0.50', () => {
    // A Jaccard-only floor cannot separate this pair from the repro (0.33 vs
    // 0.50); the two-word stem ("sign up" ≠ "sign in") is what keeps it clean.
    expect(isDivergedSibling('Sign up: TBD', 'Sign in: TBD')).toBe(false);
    expect(isDivergedSibling('Sign in: TBD', 'Sign up: DONE - changed externally')).toBe(false);
  });

  test('stem-equal but word-disjoint texts stay distinct (corroboration is required)', () => {
    // First two words match ("rate limits") but no further shared vocabulary:
    // Jaccard 2/11 ≈ 0.18 < 0.3 and containment 2/6 ≈ 0.33 < 0.5 → not diverged.
    expect(isDivergedSibling(
      'Rate limits apply per api key',
      'Rate limits window resets at midnight utc',
    )).toBe(false);
  });

  test('short nodes: one-significant-word siblings compare on that stem', () => {
    // "Sessions" elaborated to "Sessions rotate keys every quarter" — same
    // concept (stem falls back to 1 word, containment 1/1 = 1.0).
    expect(isDivergedSibling('Sessions', 'Sessions rotate keys every quarter')).toBe(true);
    // ... but a different single word stays distinct.
    expect(isDivergedSibling('Sessions', 'Passwords rotate keys every quarter')).toBe(false);
  });

  test('empty/significant-token-less text never fires', () => {
    expect(isDivergedSibling('', 'Sign up: TBD')).toBe(false);
    expect(isDivergedSibling('a b', 'Sign up: TBD')).toBe(false); // 1-char tokens dropped
  });
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
    // ("sign up" ≠ "sign in") keeps it distinct for the guard. It is placed in
    // the SECOND slot so the PRE-EXISTING positional layer (unchanged, ≥ 0.5
    // overlap on the same slot) is not exercised — this test pins the GUARD's
    // non-interference, not the positional layer's semantics.
    const ws = seededWs('new-siblings');
    const page = join(ws.root, 'incoming.md');
    writeFileSync(page, '- Authentication\n  - Email verification: TBD\n  - Sign in: TBD\n');
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
      '  - Email verification: TBD',
      '  - Sign in: TBD',
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

// ── round 6 (QA-18, issue #20 reopened) ────────────────────────────────────
// Blackbox round 6 proved the round-5 guard incomplete: the leading-2-word-stem
// test misses the CANONICAL TBD-fill shape — in "Concept: TBD" the placeholder
// occupies the stem's second slot, so any real content replacing it changes
// stem word 2 and escapes ALL layers (F25/F26/F38 CRITICAL: 22 of 25 default
// scaffold child nodes unprotected). Also: root children are siblings too, so
// a reworded parent ("Authentication" → "Auth and identity") duplicated the
// whole subtree as a second root with conflicts: [] (F28 MAJOR); and the
// containment arm measured shared/min(|E|,|I|) instead of the documented
// existing-sibling side, firing below the floors (F10/F13 MINOR).

describe('issue #20 round 6 — unit: TBD-fill rule (isDivergedSibling)', () => {
  test('F25/F26/F38: "X: TBD" filled with real content fires — concept head repeated as leading words', () => {
    expect(isDivergedSibling('Sessions: TBD', 'Sessions: extended - changed externally')).toBe(true);
    expect(isDivergedSibling('Passwords: TBD', 'Passwords: rotated monthly by policy')).toBe(true);
    expect(isDivergedSibling('Storage: TBD', 'Storage: postgres with PITR')).toBe(true);
  });

  test('a 2-word concept head fill also fires (the round-5 shape, now via the TBD rule)', () => {
    expect(isDivergedSibling('Rate limits: TBD', 'Rate limits: one hundred per key')).toBe(true);
  });

  test('precision: "Sign in: social OAuth" is NOT a fill of "Sign up: TBD" (concept heads differ)', () => {
    expect(isDivergedSibling('Sign up: TBD', 'Sign in: social OAuth')).toBe(false);
  });

  test('TBD not in the trailing slot does not arm the rule (falls back to stem + overlap)', () => {
    // "TBD" here is mid-text, so the node is not an unfinished "Concept: TBD"
    // node; the stem test then fails on word 2 ("tbd" vs "extended").
    expect(isDivergedSibling('Sessions: TBD now resolved', 'Sessions: extended')).toBe(false);
  });

  test('a bare-TBD node (empty concept head) never fires via the TBD rule', () => {
    expect(isDivergedSibling('TBD', 'Sessions: extended')).toBe(false);
  });
});

describe('issue #20 round 6 — unit: parent-prefix signal (F28) — root children are siblings too', () => {
  test('F28: "Authentication" vs "Auth and identity" fires BOTH directions (≥4-char first-word prefix)', () => {
    expect(isDivergedSibling('Authentication', 'Auth and identity')).toBe(true);
    expect(isDivergedSibling('Auth and identity', 'Authentication')).toBe(true);
  });

  test('a prefix below the ≥4-char floor carries no match ("api" ≁ "apis")', () => {
    expect(isDivergedSibling('API', 'APIs')).toBe(false);
  });

  test('a first-word prefix does not rescue a differing second stem word', () => {
    // "auth" ≈ "authentication", but word 2 differs ("flows" vs "tokens") →
    // distinct concepts, no fire.
    expect(isDivergedSibling('Auth flows: TBD', 'Authentication tokens')).toBe(false);
  });

  test('the default scaffold roots stay pairwise distinct (no false-positive second roots)', () => {
    const roots = ['Overview', 'Architecture', 'Authentication', 'Data', 'API', 'Frontend', 'Operations'];
    for (const a of roots) {
      for (const b of roots) {
        if (a !== b) expect(isDivergedSibling(a, b)).toBe(false);
      }
    }
  });
});

describe('issue #20 round 6 — unit: containment measured on the EXISTING side (F10/F13)', () => {
  test('F13 boundary: exactly half of the existing sibling\u2019s tokens surviving fires (2/4)', () => {
    // Jaccard 2/7 ≈ 0.286 < 0.3, existing-containment 2/4 = 0.5 ≥ 0.5 → fire.
    expect(isDivergedSibling('Alpha beta gamma delta', 'Alpha beta epsilon zeta eta')).toBe(true);
  });

  test('F10: below the floor does not fire — Jaccard 0.2, existing-containment 0.25', () => {
    // shared {cache, ttl} of E=8/I=4 → J 2/10 = 0.2, existing-side 2/8 = 0.25.
    // The OLD min-side (2/4 = 0.5) fired this pair — over-broad.
    expect(isDivergedSibling('Cache TTL one two three four five six', 'Cache TTL seven eight')).toBe(false);
  });

  test('adjacent below: Jaccard 0.286 and existing-containment 0.33 stay distinct', () => {
    expect(isDivergedSibling('Migrate schema online without downtime window', 'Migrate schema nightly')).toBe(false);
  });

  test('lengthening still fires via the existing-side containment (2/3 ≥ 0.5)', () => {
    expect(isDivergedSibling(
      'Sign up: TBD',
      'Sign up: DONE and the ops team also recorded the external migration notes',
    )).toBe(true);
  });
});

describe('issue #20 round 6 — CLI: TBD fills are conflicts, never silent duplicates (F25/F26/F38)', () => {
  test('(a) F25: "Sessions: extended - changed externally" conflicts against "Sessions: TBD" — no duplicate', () => {
    const ws = makeWs('f25-mix');
    const init = runCli(['init'], ws.root);
    if (init.exit !== 0) throw new Error(`setup: init failed: ${init.out}${init.err}`);
    const before = readFileSync(join(ws.cans, '02-authentication.md'), 'utf-8');
    const page = join(ws.root, 'mix.md');
    writeFileSync(page, '- Authentication\n  - Sessions: extended - changed externally\n');
    const r = runCli(['import', 'logseq', page, '--json'], ws.root);
    expect(r.exit).toBe(0);
    const j = JSON.parse(r.out);
    expect(j.merged).toEqual(['02-authentication.md']);
    expect(j.conflicts.length).toBe(1);
    expect(j.conflicts[0]).toEqual({
      file: '02-authentication.md',
      line: 3, // the "Sessions: TBD" line of the canonical file
      cansVersion: 'Sessions: TBD',
      importVersion: 'Sessions: extended - changed externally',
      resolution: 'cans-wins',
    });
    // cans-wins keeps the CANS text; NO duplicate sibling appended.
    const after = readFileSync(join(ws.cans, '02-authentication.md'), 'utf-8');
    expect(after).toBe(before);
    expect((after.match(/- Sessions: TBD/g) ?? []).length).toBe(1);
    expect(after).not.toContain('extended - changed externally');
    // Human output carries the "!" conflict marker, not just "(merged)".
    const human = runCli(['import', 'logseq', page], ws.root);
    expect(human.out).toMatch(/!\s+02-authentication\.md:3\s+cans-wins/);
  });

  test('(b) F26: real-flow repro on "Passwords: TBD" (init → export → edit → import) — single node remains', () => {
    const ws = reproWsEdit('f26-passwords', '02-authentication.md',
      '- Passwords: TBD', '- Passwords: rotated monthly by policy');
    const before = readFileSync(join(ws.cans, '02-authentication.md'), 'utf-8');
    expect(before).toBe(AUTH_SCAFFOLD);
    const r = runCli(['import', 'logseq', ws.page, '--json'], ws.root);
    expect(r.exit).toBe(0);
    const j = JSON.parse(r.out);
    expect(j.conflicts.length).toBe(1);
    expect(j.conflicts[0].cansVersion).toBe('Passwords: TBD');
    expect(j.conflicts[0].importVersion).toBe('Passwords: rotated monthly by policy');
    expect(j.conflicts[0].line).toBe(4);
    const after = readFileSync(join(ws.cans, '02-authentication.md'), 'utf-8');
    expect(after).toBe(before); // byte-identical — no "rotated monthly" duplicate
  });

  test('(c) F38: 03-data.md "Storage: TBD" → "Storage: postgres with PITR" — conflict, no append', () => {
    const ws = reproWsEdit('f38-storage', '03-data.md',
      '- Storage: TBD', '- Storage: postgres with PITR');
    const before = readFileSync(join(ws.cans, '03-data.md'), 'utf-8');
    expect(before).toBe('- Data\n  - Storage: TBD\n  - Schema: TBD\n  - Backups: TBD\n  - Retention: TBD\n');
    const r = runCli(['import', 'logseq', ws.page, '--json'], ws.root);
    expect(r.exit).toBe(0);
    const j = JSON.parse(r.out);
    expect(j.conflicts.length).toBe(1);
    expect(j.conflicts[0].file).toBe('03-data.md');
    expect(j.conflicts[0].line).toBe(2);
    expect(j.conflicts[0].cansVersion).toBe('Storage: TBD');
    expect(j.conflicts[0].importVersion).toBe('Storage: postgres with PITR');
    const after = readFileSync(join(ws.cans, '03-data.md'), 'utf-8');
    expect(after).toBe(before);
  });

  test('(d) idempotency: re-importing the same diverged file twice → the SAME single conflict, still no append', () => {
    const ws = reproWsEdit('f25-idem', '02-authentication.md',
      '- Sessions: TBD', '- Sessions: extended - changed externally');
    const before = readFileSync(join(ws.cans, '02-authentication.md'), 'utf-8');
    for (let i = 0; i < 2; i++) {
      const r = runCli(['import', 'logseq', ws.page, '--json'], ws.root);
      expect(r.exit).toBe(0);
      const j = JSON.parse(r.out);
      expect(j.conflicts.length).toBe(1);
      expect(j.conflicts[0].cansVersion).toBe('Sessions: TBD');
      expect(j.conflicts[0].importVersion).toBe('Sessions: extended - changed externally');
      expect(readFileSync(join(ws.cans, '02-authentication.md'), 'utf-8')).toBe(before);
    }
  });
});

describe('issue #20 round 6 — CLI: parent divergence (F28) — subtree never duplicated', () => {
  test('(a) workspace parent reworded + diverged export child: conflicts recorded, one root remains', () => {
    const ws = makeWs('f28-parent-reworded');
    const init = runCli(['init'], ws.root);
    if (init.exit !== 0) throw new Error(`setup: init failed: ${init.out}${init.err}`);
    const exp = runCli(['export', 'logseq'], ws.root);
    if (exp.exit !== 0) throw new Error(`setup: export failed: ${exp.out}${exp.err}`);
    // External workspace edit: the PARENT node is reworded.
    const cansFile = join(ws.cans, '02-authentication.md');
    writeFileSync(cansFile, readFileSync(cansFile, 'utf-8')
      .replace('- Authentication', '- Auth and identity'));
    // External export edit: the CHILD diverges.
    const page = join(ws.root, 'cans-export', 'logseq', '02-authentication.md');
    writeFileSync(page, readFileSync(page, 'utf-8')
      .replace('- Sign up: TBD', '- Sign up: DONE - changed externally'));
    ws.page = page;
    const r = runCli(['import', 'logseq', page, '--json'], ws.root);
    expect(r.exit).toBe(0);
    const j = JSON.parse(r.out);
    expect(j.merged).toEqual(['02-authentication.md']);
    // Parent divergence IS surfaced as a conflict (root children are siblings
    // too), plus the diverged child underneath.
    expect(j.conflicts.length).toBe(2);
    expect(j.conflicts[0]).toEqual({
      file: '02-authentication.md',
      line: 1,
      cansVersion: 'Auth and identity',
      importVersion: 'Authentication',
      resolution: 'cans-wins',
    });
    expect(j.conflicts[1]).toEqual({
      file: '02-authentication.md',
      line: 2,
      cansVersion: 'Sign up: TBD',
      importVersion: 'Sign up: DONE - changed externally',
      resolution: 'cans-wins',
    });
    // The subtree merged under the EXISTING root — no second root, no duplicate.
    const after = readFileSync(cansFile, 'utf-8');
    expect(after).toBe('- Auth and identity\n  - Sign up: TBD\n  - Sessions: TBD\n  - Passwords: TBD\n');
    expect((after.match(/^- /gm) ?? []).length).toBe(1);
  });

  test('(b) import-side reworded parent ("Auth and identity" in the import file): subtree merges under the existing root', () => {
    const ws = reproWsEdit('f28-import-reworded', '02-authentication.md',
      '- Authentication', '- Auth and identity');
    // Diverge the child as well (the export already carries the reworded root).
    writeFileSync(ws.page, readFileSync(ws.page, 'utf-8')
      .replace('- Sign up: TBD', '- Sign up: DONE - changed externally'));
    const r = runCli(['import', 'logseq', ws.page, '--json'], ws.root);
    expect(r.exit).toBe(0);
    const j = JSON.parse(r.out);
    expect(j.conflicts.length).toBe(2);
    expect(j.conflicts[0].cansVersion).toBe('Authentication');
    expect(j.conflicts[0].importVersion).toBe('Auth and identity');
    expect(j.conflicts[0].line).toBe(1);
    // cans-wins keeps the workspace root; the whole subtree stays single.
    const after = readFileSync(join(ws.cans, '02-authentication.md'), 'utf-8');
    expect(after).toBe(AUTH_SCAFFOLD);
    expect(after).not.toContain('Auth and identity');
  });

  test('(c) idempotency: second import of the parent-diverged file → same conflicts, still a single root', () => {
    const ws = makeWs('f28-idem');
    const init = runCli(['init'], ws.root);
    if (init.exit !== 0) throw new Error(`setup: init failed: ${init.out}${init.err}`);
    if (runCli(['export', 'logseq'], ws.root).exit !== 0) throw new Error('setup: export failed');
    const cansFile = join(ws.cans, '02-authentication.md');
    writeFileSync(cansFile, readFileSync(cansFile, 'utf-8')
      .replace('- Authentication', '- Auth and identity'));
    const page = join(ws.root, 'cans-export', 'logseq', '02-authentication.md');
    writeFileSync(page, readFileSync(page, 'utf-8')
      .replace('- Sign up: TBD', '- Sign up: DONE - changed externally'));
    ws.page = page;
    for (let i = 0; i < 2; i++) {
      const r = runCli(['import', 'logseq', page, '--json'], ws.root);
      expect(r.exit).toBe(0);
      const j = JSON.parse(r.out);
      expect(j.conflicts.length).toBe(2);
      const after = readFileSync(cansFile, 'utf-8');
      expect(after).toBe('- Auth and identity\n  - Sign up: TBD\n  - Sessions: TBD\n  - Passwords: TBD\n');
    }
  });

  test('(d) a genuinely new top-level root still appends cleanly as a new file (no false positive)', () => {
    const ws = seededWs('f28-new-root');
    const page = join(ws.root, 'billing.md');
    writeFileSync(page, '- Billing\n  - Invoices: TBD\n');
    const r = runCli(['import', 'logseq', page, '--json'], ws.root);
    expect(r.exit).toBe(0);
    const j = JSON.parse(r.out);
    expect(j.conflicts).toEqual([]);
    expect(j.newFiles).toEqual(['07-billing.md']);
    expect(readFileSync(join(ws.cans, '07-billing.md'), 'utf-8')).toBe('- Billing\n  - Invoices: TBD\n');
  });
});

describe('issue #20 round 6 — CLI: containment floor honored end-to-end (F10/F13)', () => {
  test('(a) below-floor same-stem pair APPENDS cleanly (J 0.2, existing-containment 0.25)', () => {
    const ws = makeWs('f10-ladder');
    mkdirSync(ws.cans, { recursive: true });
    writeFileSync(join(ws.cans, '08-guard-ladder.md'), [
      '- Guard ladder',
      '  - Cache TTL one two three four five six',
      '  - Alpha beta gamma delta',
      '',
    ].join('\n'));
    const page = join(ws.root, 'ladder.md');
    writeFileSync(page, [
      '- Guard ladder',
      '  - Cache TTL seven eight',
      '  - Alpha beta epsilon zeta eta',
      '',
    ].join('\n'));
    const r = runCli(['import', 'logseq', page, '--json'], ws.root);
    expect(r.exit).toBe(0);
    const j = JSON.parse(r.out);
    // Only the exactly-at-floor pair (existing-containment 2/4 = 0.5) is a
    // conflict; the below-floor pair (J 0.2, E-c 0.25) is distinct → appended.
    expect(j.conflicts.length).toBe(1);
    expect(j.conflicts[0]).toEqual({
      file: '08-guard-ladder.md',
      line: 3,
      cansVersion: 'Alpha beta gamma delta',
      importVersion: 'Alpha beta epsilon zeta eta',
      resolution: 'cans-wins',
    });
    const after = readFileSync(join(ws.cans, '08-guard-ladder.md'), 'utf-8');
    expect(after).toBe([
      '- Guard ladder',
      '  - Cache TTL one two three four five six',
      '  - Alpha beta gamma delta',
      '  - Cache TTL seven eight',
      '',
    ].join('\n'));
  });

  test('(b) full default scaffold re-import with NO edits → zero conflicts, every file byte-identical', () => {
    const ws = makeWs('f-scaffold-control');
    const init = runCli(['init'], ws.root);
    if (init.exit !== 0) throw new Error(`setup: init failed: ${init.out}${init.err}`);
    if (runCli(['export', 'logseq'], ws.root).exit !== 0) throw new Error('setup: export failed');
    const before = new Map<string, string>();
    for (const f of readdirSync(ws.cans).filter(n => /^\d{2}-.*\.md$/.test(n))) {
      before.set(f, readFileSync(join(ws.cans, f), 'utf-8'));
    }
    expect(before.size).toBe(7); // the default spec scaffold
    const r = runCli(['import', 'logseq', join(ws.root, 'cans-export', 'logseq'), '--json'], ws.root);
    expect(r.exit).toBe(0);
    const j = JSON.parse(r.out);
    expect(j.ok).toBe(true);
    expect(j.conflicts).toEqual([]); // the guard must NOT fire on its own scaffold
    expect(j.newFiles).toEqual([]);
    expect(j.merged.length).toBe(7);
    for (const [f, content] of before) {
      expect(readFileSync(join(ws.cans, f), 'utf-8')).toBe(content); // byte-identical
    }
  });
});
