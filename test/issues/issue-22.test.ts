/**
 * Issue #22 regression tests — deep-hop advice must never recommend a
 * duplicate ref, and trailing-slash folder targets must resolve.
 *
 * Defect 1 (deep-hop duplicate advice): detectDeepHops suggested
 * `add "see: auth/index.md#Sessions" directly to 00-overview.md` without
 * consulting 00-overview.md's existing refs. The referrer already linked the
 * SAME node under an equivalent spelling (`see auth#Sessions` —
 * targetMatchesKey('auth', 'auth/index.md') is true), so following the advice
 * appended a SECOND ref to one node and the deep hop itself stayed in place.
 * The advice also never said the intermediate ref has to go — adding a direct
 * ref alone does not remove the hop.
 *
 * Defect 2 (trailing-slash folder target): `see: auth/#Sessions` did not
 * resolve — targetMatchesKey/loadedKeyFor handled `auth` and `auth/index.md`
 * but NOT `auth/` — and the broken-ref suggestion proposed `create auth/`:
 * a directory that already exists. Suggestion hygiene family of #10.
 *
 * Test map:
 *   a ..... targetMatchesKey: trailing-slash folder forms are equivalent keys
 *   b ..... checkRefs: `see auth/#Sessions` resolves (0 broken, anchor hits)
 *   c ..... checkRefs: broken-ref create-* advice never proposes an existing
 *          path — folder without index.md → create auth/index.md; folder WITH
 *          index.md (unresolvable deeper dir) → fix the target only
 *   d ..... rebuildBackPointers: trailing-slash refs group under the loaded key
 *   e ..... detectDeepHops: equivalent-spelling duplicate → "already refs"
 *          advice quoting the existing ref (issue repro)
 *   f ..... detectDeepHops: anchored existing ref ≠ a file-level suggested ref
 *          (round 6: the guard is anchor-aware — F55's mirror image)
 *   g ..... detectDeepHops: normal advice now states the hop removal
 *   h ..... detectDeepHops: trailing-slash referrer → same guard fires
 *   i ..... CLI end-to-end: the issue's repro workspace
 *   j ..... CLI end-to-end: the trailing-slash variant
 *   k ..... CLI end-to-end (control, green pre-fix): removing the referrer's
 *          intermediate ref clears the deep hop — the graph machinery the new
 *          advice finally points at.
 *
 * Round 6 (QA-19, blackbox re-verification) — new contracts pinned here:
 *   r1-r4 . the duplicate guard treats two refs as equivalent only when they
 *          resolve to the same target KEY and the same anchor NODE (or both
 *          file-level) — F54/F55: same-file/different-node and file-level
 *          over-triggers are gone; case-insensitive anchor equivalence and
 *          the true file-level duplicate still fire the guard.
 *   s1-s3 . deep-hop advice names the EXACT edge to remove — the referrer's
 *          raw ref and its line — so a multi-referrer shape never leaves the
 *          user guessing which `see:` to delete (F26).
 *   u1-u6 . broken-ref advice and resolution never leave the workspace:
 *          absolute/`..` targets report "file not found in workspace" with no
 *          create-* proposal, a ref to an existing file beyond the root is
 *          broken (3adbc91 semantics, issue #10), interior `..` that
 *          normalizes inside the root still resolves (F13/F45/F53).
 *   v1-v5 . §11 flat-first covers extensionless FLAT targets: `see 02-b`
 *          resolves to 02-b.md (folders already did); the create advice for a
 *          missing extensionless stem proposes the .md file (F51).
 *   w1-w2 . §11 "both existing = error" is slug-agnostic: auth.md +
 *          auth/index.md is a duplicate home, numbered or not (F15/F17–19).
 *   x1 ... refs.broken counts broken anchors (errorCount 1, ok:false must
 *          never coexist with refs.broken: 0 — F40b).
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

import { parseOutline } from '../../src/core/outline.ts';
import {
  targetMatchesKey, buildRefGraph, checkRefs, detectDeepHops, rebuildBackPointers,
} from '../../src/core/refs.ts';
import { resolveSpecFile, detectFlatFolderConflicts } from '../../src/core/fs.ts';
import type { OutlineNode } from '../../src/types.ts';
import { spawnCli, REPO } from '../runtime.ts';
import { makeCansWorkspace } from '../helpers.ts';

// ── The issue's repro workspace (folder-layout ref target) ──

const REPRO_FILES = {
  '00-overview.md': '- Overview\n  - Auth lives in: see auth#Sessions\n  - API details: see 01-api.md\n',
  '01-api.md': '- API\n  - Uses auth sessions: see auth/index.md#Sessions\n',
  'auth/index.md': '- Authentication\n  - Sessions\n    - Expire after 24 hours\n',
};

/** Same workspace, referrer spelled with the trailing-slash folder form. */
const TRAILING_SLASH_FILES = {
  ...REPRO_FILES,
  '00-overview.md': '- Overview\n  - Auth lives in: see auth/#Sessions\n  - API details: see 01-api.md\n',
};

/** Referrer holds the suggested target under the EXACT anchored spelling —
 *  but the flagged file's outgoing ref is FILE-LEVEL. Round 6 (F55's mirror):
 *  an anchored ref is not a file-level spelling of the same target, so the
 *  guard must NOT fire — the advice is the plain add+remove. */
const DUP_EXACT_FILES = {
  '00-overview.md': '- Overview\n  - Auth lives in: see auth/index.md#Sessions\n  - API details: see 01-api.md\n',
  '01-api.md': '- API\n  - Uses auth sessions: see auth\n',
  'auth/index.md': '- Authentication\n  - Sessions\n    - Expire after 24 hours\n',
};

/** Round 6 (F54): the referrer's existing ref targets the same FILE but a
 *  DIFFERENT node — the old guard matched the loaded file key and ignored the
 *  anchor, emitting the self-contradictory "already refs auth/index.md#Sessions
 *  as `see auth#Passwords`" claim. */
const ANCHOR_MISMATCH_FILES = {
  '00-overview.md': '- Overview\n  - Auth: see auth#Passwords\n  - API: see 01-api.md\n',
  '01-api.md': '- API\n  - Session use: see auth#Sessions\n',
  'auth/index.md': '- Authentication\n  - Sessions\n  - Passwords\n',
};

/** Round 6 (F55): a file-level `see auth` is not an anchored spelling of
 *  auth/index.md#Sessions — the guard must not fire. */
const FILELEVEL_EXISTING_FILES = {
  '00-overview.md': '- Overview\n  - Auth area: see auth\n  - API: see 01-api.md\n',
  '01-api.md': '- API\n  - Session use: see auth#Sessions\n',
  'auth/index.md': '- Authentication\n  - Sessions\n',
};

/** Round 6 (positive control): BOTH the existing ref and the suggested ref
 *  are file-level — the guard legitimately fires. */
const DUP_FILELEVEL_FILES = {
  '00-overview.md': '- Overview\n  - Auth area: see auth\n  - API: see 01-api.md\n',
  '01-api.md': '- API\n  - Session use: see auth\n',
  'auth/index.md': '- Authentication\n  - Sessions\n',
};

/** Round 6 (F32 control): case-insensitive anchor equivalence across the
 *  guard — existing `#delta`, suggested `#Delta`. */
const ANCHOR_CASE_FILES = {
  '00-overview.md': '- Overview\n  - B: see 02-b.md#delta\n  - A: see 01-a.md\n',
  '01-a.md': '- A\n  - Ref: see 02-b.md#Delta\n',
  '02-b.md': '- B\n  - Delta\n',
};

/** Round 6 (F26): multi-referrer 3-hop chain state — after the first
 *  advice-follow, TWO files ref the intermediate 02-b. */
const MULTI_REFERRER_FILES = {
  '00-overview.md': '- Overview\n  - see: 02-b.md\n',
  '01-a.md': '- A\n  - see: 02-b.md\n',
  '02-b.md': '- B\n  - see: 03-c.md\n',
  '03-c.md': '- C\n',
};

/** Plain a → b → c chain (issue #5 corpus shape): no existing direct ref. */
const CHAIN_FILES = {
  '01-a.md': '- A\n  - see: 02-b.md\n',
  '02-b.md': '- B\n  - see: 03-c.md\n',
  '03-c.md': '- C\n',
};

function loadFiles(spec: Record<string, string>): Map<string, OutlineNode[]> {
  const map = new Map<string, OutlineNode[]>();
  for (const [name, body] of Object.entries(spec)) map.set(name, parseOutline(body, name));
  return map;
}

// ── CLI scaffolding (mirrors test/issues/issue-1.test.ts) ──

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-22');
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

// ── Unit: target-key resolution (defect 2) ──

describe('issue #22: trailing-slash folder targets resolve to the same key', () => {
  test('a: targetMatchesKey treats auth/, auth and auth/index.md as one target', () => {
    // Folder-layout equivalence — the three spellings of the same target.
    expect(targetMatchesKey('auth', 'auth/index.md')).toBe(true); // control (pre-existing)
    expect(targetMatchesKey('auth/', 'auth/index.md')).toBe(true);
    expect(targetMatchesKey('auth//', 'auth/index.md')).toBe(true);
    expect(targetMatchesKey('auth/index.md/', 'auth/index.md')).toBe(true);
    // Flat files keep their equivalence, trailing slash included.
    expect(targetMatchesKey('04-api.md/', '04-api.md')).toBe(true);
    expect(targetMatchesKey('auth/', 'auth.md')).toBe(true);
    // Non-matching targets stay non-matching.
    expect(targetMatchesKey('auth/', 'billing/index.md')).toBe(false);
    expect(targetMatchesKey('auth/', '04-api.md')).toBe(false);
  });

  test('b: checkRefs resolves `see auth/#Sessions` exactly like `see auth#Sessions` (0 broken refs, anchor hits)', () => {
    const ws = makeWs('unit-trailing', TRAILING_SLASH_FILES);
    // Only the referrer + target: no chain, no deep hop — pure resolution.
    const spec = {
      '00-overview.md': TRAILING_SLASH_FILES['00-overview.md']!,
      'auth/index.md': TRAILING_SLASH_FILES['auth/index.md']!,
    };
    const files = loadFiles(spec);
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);

    // The whole point of defect 2: same verdict as the slash-less spelling —
    // no broken-ref error, no broken-anchor error.
    const refIssues = issues.filter(i => i.category === 'refs');
    expect(refIssues).toHaveLength(0);
  });

  test('c: broken-ref create-* advice never proposes a path that already exists', () => {
    // Folder exists, index.md missing → the actionable creation target is the
    // spec file, never the directory itself.
    const ws = makeWs('unit-dir-no-index', { '04-api.md': '- API\n  - Storage: see auth/#Rules\n' });
    mkdirSync(join(ws.root, 'auth')); // the folder exists; no index.md inside
    let files = loadFiles({ '04-api.md': '- API\n  - Storage: see auth/#Rules\n' });
    let issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
    let broken = issues.filter(i => i.message.startsWith('broken ref:'));
    expect(broken).toHaveLength(1);
    expect(broken[0]!.message).toBe('broken ref: see auth/ — file not found');
    // The exact unactionable v0.3.0 advice — proposing the existing directory.
    expect(broken[0]!.suggestion).not.toBe('create auth/ or fix the ref target');
    expect(broken[0]!.suggestion).toBe('create auth/index.md or fix the ref target');

    // Trailing-slash intent with NOTHING on disk → folder-layout target,
    // not a bare directory name.
    const ws2 = makeWs('unit-dir-absent', { '04-api.md': '- API\n  - Storage: see auth/#Rules\n' });
    files = loadFiles({ '04-api.md': '- API\n  - Storage: see auth/#Rules\n' });
    issues = checkRefs(files, buildRefGraph(files, ws2.root), ws2.root);
    broken = issues.filter(i => i.message.startsWith('broken ref:'));
    expect(broken).toHaveLength(1);
    expect(broken[0]!.suggestion).toBe('create auth/index.md or fix the ref target');

    // Folder complete with an (overflow) index.md deeper in the tree — a spec
    // file cannot be created out of it; the only fix is the target spelling.
    const ws3 = makeWs('unit-dir-complete', { '04-api.md': '- API\n  - Storage: see auth/sub/#Rules\n' });
    mkdirSync(join(ws3.root, 'auth', 'sub'), { recursive: true });
    writeFileSync(join(ws3.root, 'auth', 'sub', 'index.md'), '- Overflow content\n', 'utf8');
    files = loadFiles({ '04-api.md': '- API\n  - Storage: see auth/sub/#Rules\n' });
    issues = checkRefs(files, buildRefGraph(files, ws3.root), ws3.root);
    broken = issues.filter(i => i.message.startsWith('broken ref:'));
    expect(broken).toHaveLength(1);
    expect(broken[0]!.suggestion).not.toContain('create auth/sub/');
    expect(broken[0]!.suggestion).toContain('fix the ref target');
  });

  test('d: back-pointer grouping maps a trailing-slash ref to the loaded key', () => {
    const spec = {
      '01-api.md': '- API\n  - see: auth/\n',
      'auth/index.md': '- Auth\n',
    };
    const files = loadFiles(spec);
    const back = rebuildBackPointers(files, buildRefGraph(files, '.'));
    // The ref earns auth/index.md its back-pointer group — same as `auth`.
    // (Issue #19 made groups anchor-aware: Map<string, RefByGroup[]> — the
    // trailing-slash ref must land in the LOADED key's group, never `auth/`.)
    const groups = back.get('auth/index.md') ?? [];
    expect(groups).toHaveLength(1);
    expect(groups[0]!.node).toBe(null); // file-level ref → node-less group
    expect(groups[0]!.fromFiles).toEqual(['01-api.md']);
    expect(back.has('auth/')).toBe(false);
  });
});

// ── Unit: deep-hop suggestion (defect 1) ──

describe('issue #22: deep-hop advice never recommends a duplicate ref', () => {
  test('e: equivalent spelling — advice names the existing ref, not an "add" (the issue repro)', () => {
    const files = loadFiles(REPRO_FILES);
    const issues = detectDeepHops(buildRefGraph(files, '.'), 1);
    expect(issues).toHaveLength(1);
    const issue = issues[0]!;
    expect(issue.message).toBe('DEEP HOP: 00-overview.md → 01-api.md → auth/index.md');
    // The old advice — appending a second ref to a node 00-overview.md
    // already refs — must be gone.
    expect(issue.suggestion).not.toContain('add "see: auth/index.md#Sessions"');
    // The advice names the existing equivalent ref and the hop to remove, so
    // following it actually removes the deep hop. Round 6 (F26): the removal
    // names the EXACT edge — the referrer's raw ref and its line.
    expect(issue.suggestion).toBe(
      '00-overview.md already refs auth/index.md#Sessions as "see auth#Sessions" — remove the intermediate hop via 01-api.md: delete 00-overview.md\'s "see 01-api.md" (line 3)',
    );
  });

  test('f: anchored existing ref is not a file-level spelling — the guard stays off (round 6, F55 mirror)', () => {
    const files = loadFiles(DUP_EXACT_FILES);
    const issues = detectDeepHops(buildRefGraph(files, '.'), 1);
    expect(issues).toHaveLength(1);
    const issue = issues[0]!;
    // Round 6: the referrer holds an ANCHORED ref (auth/index.md#Sessions),
    // the flagged file's outgoing ref is FILE-LEVEL (`see auth`) — not
    // equivalent spellings, so the advice must be the plain add+remove, never
    // a claim that the referrer "already refs" the file-level target.
    expect(issue.suggestion).not.toContain('already refs');
    expect(issue.suggestion).toBe(
      'add "see: auth" directly to 00-overview.md and remove the intermediate hop via 01-api.md: delete 00-overview.md\'s "see 01-api.md" (line 3)',
    );
  });

  test('g: no existing ref — the plain advice still says the hop must be removed', () => {
    const files = loadFiles(CHAIN_FILES);
    const issues = detectDeepHops(buildRefGraph(files, '.'), 1);
    expect(issues).toHaveLength(1);
    const issue = issues[0]!;
    expect(issue.message).toBe('DEEP HOP: 01-a.md → 02-b.md → 03-c.md');
    // Core of the original advice, plus the removal the issue demands: adding
    // the direct ref alone leaves the deep hop in place. Round 6 (F26): the
    // removal names the exact edge — file, raw ref, line.
    expect(issue.suggestion).toBe(
      'add "see: 03-c.md" directly to 01-a.md and remove the intermediate hop via 02-b.md: delete 01-a.md\'s "see: 02-b.md" (line 2)',
    );
  });

  test('h: trailing-slash referrer — the same already-refs guard fires on the equivalent spelling', () => {
    const files = loadFiles(TRAILING_SLASH_FILES);
    const issues = detectDeepHops(buildRefGraph(files, '.'), 1);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.suggestion).toBe(
      '00-overview.md already refs auth/index.md#Sessions as "see auth/#Sessions" — remove the intermediate hop via 01-api.md: delete 00-overview.md\'s "see 01-api.md" (line 3)',
    );
  });
});

// ── CLI end-to-end (blackbox) ──

describe('issue #22: cans check end-to-end', () => {
  test('i: issue repro workspace — 0 broken, 1 deep hop with already-refs advice, no duplicate "add"', () => {
    const ws = makeWs('cli-repro', REPRO_FILES);
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);

    // 3 see: refs, 0 broken, 1 deep hop — the deep hop is a real error.
    expect(r.exit).toBe(2);
    expect(j.refs.total).toBe(3);
    expect(j.refs.broken).toBe(0);
    expect(j.refs.deepHops).toBe(1);

    const hop = j.issues.find((i: any) => i.rule === 'refs.deep_hop');
    expect(hop).toBeDefined();
    expect(hop.message).toBe('DEEP HOP: 00-overview.md → 01-api.md → auth/index.md');
    // Following the suggestion must not append a second ref to one node.
    expect(hop.suggestion).not.toContain('add "see: auth/index.md#Sessions"');
    expect(hop.suggestion).toContain('already refs auth/index.md#Sessions as "see auth#Sessions"');
    expect(hop.suggestion).toContain('remove the intermediate hop via 01-api.md');
  });

  test('j: trailing-slash variant — `see auth/#Sessions` resolves: 0 broken refs, deep hop remains with equivalent-spelling advice', () => {
    const ws = makeWs('cli-trailing', TRAILING_SLASH_FILES);
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);

    // The trailing-slash ref resolves exactly like `see auth#Sessions`:
    // 3 refs, 0 broken (was 1 in v0.3.0), 1 deep hop.
    expect(j.refs.total).toBe(3);
    expect(j.refs.broken).toBe(0);
    expect(j.refs.deepHops).toBe(1);
    expect(j.issues.some((i: any) => /broken ref: see auth\/ /i.test(i.message))).toBe(false);

    const hop = j.issues.find((i: any) => i.rule === 'refs.deep_hop');
    expect(hop).toBeDefined();
    // The referrer's existing ref is quoted verbatim, trailing slash and all.
    expect(hop.suggestion).toContain('as "see auth/#Sessions"');
    expect(hop.suggestion).not.toContain('add "see: auth/index.md#Sessions"');
  });

  test('k: following the advice removes the deep hop (0 deep hops, 0 broken, no errors)', () => {
    const ws = makeWs('cli-follow', REPRO_FILES);
    let r = runCli(['check', '--json'], ws.tmp);
    let j = parseJsonOut(r.out);
    expect(j.refs.deepHops).toBe(1);

    // Follow the advice: 00-overview.md already refs auth/index.md#Sessions —
    // remove the intermediate hop via 01-api.md (drop the referrer's
    // see 01-api.md line).
    writeFileSync(
      join(ws.root, '00-overview.md'),
      '- Overview\n  - Auth lives in: see auth#Sessions\n',
      'utf8',
    );
    r = runCli(['check', '--json'], ws.tmp);
    j = parseJsonOut(r.out);
    // The deep hop is gone; nothing broke; no error-class findings remain.
    expect(j.refs.deepHops).toBe(0);
    expect(j.refs.broken).toBe(0);
    expect(j.counts.errors).toBe(0);
  });
});

// ── Round 6 (QA-19) — blackbox re-verification of the #22 fix machinery ──

describe('issue #22 round 6 (QA-19 F54/F55): the duplicate guard is anchor-aware', () => {
  test('r1: same file, different node — plain add+remove advice, never a false "already refs" (F54)', () => {
    const files = loadFiles(ANCHOR_MISMATCH_FILES);
    const issues = detectDeepHops(buildRefGraph(files, '.'), 1);
    expect(issues).toHaveLength(1);
    const issue = issues[0]!;
    // The old guard matched the loaded FILE key and ignored the anchor, so it
    // emitted the self-contradictory claim (target #Sessions, quoted ref
    // #Passwords) whose premise silently drops the Sessions linkage.
    expect(issue.suggestion).not.toContain('already refs');
    expect(issue.suggestion).not.toContain('auth#Passwords');
    expect(issue.suggestion).toBe(
      'add "see: auth#Sessions" directly to 00-overview.md and remove the intermediate hop via 01-api.md: delete 00-overview.md\'s "see 01-api.md" (line 3)',
    );
  });

  test('r2: a file-level existing ref is not an anchored spelling of the target (F55)', () => {
    const files = loadFiles(FILELEVEL_EXISTING_FILES);
    const issues = detectDeepHops(buildRefGraph(files, '.'), 1);
    expect(issues).toHaveLength(1);
    const issue = issues[0]!;
    // `see auth` (file-level) is not `auth/index.md#Sessions` — the advice
    // must not claim the referrer holds the anchored ref it does not hold.
    expect(issue.suggestion).not.toContain('already refs');
    expect(issue.suggestion).toBe(
      'add "see: auth#Sessions" directly to 00-overview.md and remove the intermediate hop via 01-api.md: delete 00-overview.md\'s "see 01-api.md" (line 3)',
    );
  });

  test('r3: two file-level refs to the same target still fire the guard (positive control)', () => {
    const files = loadFiles(DUP_FILELEVEL_FILES);
    const issues = detectDeepHops(buildRefGraph(files, '.'), 1);
    expect(issues).toHaveLength(1);
    const issue = issues[0]!;
    // Both the existing ref and the suggested ref are file-level: equivalent
    // spellings of one target — the advice names the existing ref verbatim.
    expect(issue.suggestion).not.toContain('add "see: auth"');
    expect(issue.suggestion).toBe(
      '00-overview.md already refs auth/index.md as "see auth" — remove the intermediate hop via 01-api.md: delete 00-overview.md\'s "see 01-api.md" (line 3)',
    );
  });

  test('r4: case-insensitive anchor equivalence still fires the guard (F32 control)', () => {
    const files = loadFiles(ANCHOR_CASE_FILES);
    const issues = detectDeepHops(buildRefGraph(files, '.'), 1);
    expect(issues).toHaveLength(1);
    const issue = issues[0]!;
    // Anchors compare case-insensitively (§12): #delta ≡ #Delta. The target is
    // named with the suggested spelling, the existing ref quoted verbatim.
    expect(issue.suggestion).toBe(
      '00-overview.md already refs 02-b.md#Delta as "see 02-b.md#delta" — remove the intermediate hop via 01-a.md: delete 00-overview.md\'s "see 01-a.md" (line 3)',
    );
  });

  test('r5: CLI — the F54 workspace gets the plain add advice, exit 2 (the #22 advice loop stays truthful)', () => {
    const ws = makeWs('cli-anchor-mismatch', ANCHOR_MISMATCH_FILES);
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(2);
    expect(j.refs.deepHops).toBe(1);
    const hop = j.issues.find((i: any) => i.rule === 'refs.deep_hop');
    expect(hop).toBeDefined();
    expect(hop.suggestion).not.toContain('already refs');
    expect(hop.suggestion).toContain('add "see: auth#Sessions" directly to 00-overview.md');
    // Following that advice (add the Sessions ref, delete the named edge)
    // clears the deep hop — the loop the false advice used to break.
    writeFileSync(
      join(ws.root, '00-overview.md'),
      '- Overview\n  - Auth: see auth#Passwords\n  - Session use: see auth#Sessions\n',
      'utf8',
    );
    const r2 = runCli(['check', '--json'], ws.tmp);
    const j2 = parseJsonOut(r2.out);
    expect(j2.refs.deepHops).toBe(0);
    expect(j2.refs.broken).toBe(0);
  });
});

describe('issue #22 round 6 (QA-19 F26): the advice names the exact edge to remove', () => {
  test('s1: plain advice carries the referrer\'s raw ref + line for the hop edge', () => {
    const files = loadFiles(CHAIN_FILES);
    const issues = detectDeepHops(buildRefGraph(files, '.'), 1);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.suggestion).toBe(
      'add "see: 03-c.md" directly to 01-a.md and remove the intermediate hop via 02-b.md: delete 01-a.md\'s "see: 02-b.md" (line 2)',
    );
  });

  test('s2: multi-referrer state — the advice disambiguates WHICH referrer edge feeds the flagged hop', () => {
    const files = loadFiles(MULTI_REFERRER_FILES);
    const issues = detectDeepHops(buildRefGraph(files, '.'), 1);
    expect(issues).toHaveLength(1);
    const issue = issues[0]!;
    expect(issue.message).toBe('DEEP HOP: 00-overview.md → 02-b.md → 03-c.md');
    // Two files ref 02-b; the advice must name the exact edge it means —
    // 00-overview.md's "see: 02-b.md" on line 2 — not just "via 02-b.md".
    expect(issue.suggestion).toBe(
      'add "see: 03-c.md" directly to 00-overview.md and remove the intermediate hop via 02-b.md: delete 00-overview.md\'s "see: 02-b.md" (line 2)',
    );
  });

  test('s3: following the named edge exactly converges — every step is unambiguous (F26 loop)', () => {
    // Step 1: delete the edge the advice names (00-overview's see: 02-b.md).
    let files = loadFiles(MULTI_REFERRER_FILES);
    let issues = detectDeepHops(buildRefGraph(files, '.'), 1);
    expect(issues[0]!.suggestion).toContain('delete 00-overview.md\'s "see: 02-b.md" (line 2)');
    files = loadFiles({
      '00-overview.md': '- Overview\n',
      '01-a.md': MULTI_REFERRER_FILES['01-a.md']!,
      '02-b.md': MULTI_REFERRER_FILES['02-b.md']!,
      '03-c.md': MULTI_REFERRER_FILES['03-c.md']!,
    });
    issues = detectDeepHops(buildRefGraph(files, '.'), 1);
    // The remaining hop is 01-a → 02-b → 03-c; the next advice names THAT edge.
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toBe('DEEP HOP: 01-a.md → 02-b.md → 03-c.md');
    expect(issues[0]!.suggestion).toBe(
      'add "see: 03-c.md" directly to 01-a.md and remove the intermediate hop via 02-b.md: delete 01-a.md\'s "see: 02-b.md" (line 2)',
    );
    // Step 2: delete it — the chain is gone.
    files = loadFiles({
      '00-overview.md': '- Overview\n',
      '01-a.md': '- A\n',
      '02-b.md': MULTI_REFERRER_FILES['02-b.md']!,
      '03-c.md': MULTI_REFERRER_FILES['03-c.md']!,
    });
    issues = detectDeepHops(buildRefGraph(files, '.'), 1);
    expect(issues).toHaveLength(0);
  });
});

describe('issue #22 round 6 (QA-19 F13/F45/F53): broken-ref advice never leaves the workspace', () => {
  const ESCAPE_ADVICE = 'fix the ref target — see: targets must name spec files inside the workspace (no ../ or absolute paths)';

  test('u1: absolute target — workspace-scoped message, never a create proposal (F13)', () => {
    const ws = makeWs('u-absolute', { '01-a.md': '- A\n  - Bad: see: /tmp/whatever\n' });
    const files = loadFiles({ '01-a.md': '- A\n  - Bad: see: /tmp/whatever\n' });
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
    const broken = issues.filter(i => i.message.startsWith('broken ref:'));
    expect(broken).toHaveLength(1);
    expect(broken[0]!.message).toBe('broken ref: see /tmp/whatever — file not found in workspace');
    expect(broken[0]!.suggestion).not.toContain('create');
    expect(broken[0]!.suggestion).toBe(ESCAPE_ADVICE);
  });

  test('u2: traversal target — same containment advice (F13)', () => {
    const ws = makeWs('u-traversal', { '01-a.md': '- A\n  - Bad: see: ../escape\n' });
    const files = loadFiles({ '01-a.md': '- A\n  - Bad: see: ../escape\n' });
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
    const broken = issues.filter(i => i.message.startsWith('broken ref:'));
    expect(broken).toHaveLength(1);
    expect(broken[0]!.message).toBe('broken ref: see ../escape — file not found in workspace');
    expect(broken[0]!.suggestion).toBe(ESCAPE_ADVICE);
  });

  test('u3: an EXISTING file outside the workspace (/etc/hosts) — never "create /etc/hosts" (F53)', () => {
    const ws = makeWs('u-existing-outside', { '01-a.md': '- A\n  - Bad: see: /etc/hosts\n' });
    const files = loadFiles({ '01-a.md': '- A\n  - Bad: see: /etc/hosts\n' });
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
    const broken = issues.filter(i => i.message.startsWith('broken ref:'));
    expect(broken).toHaveLength(1);
    expect(broken[0]!.message).toBe('broken ref: see /etc/hosts — file not found in workspace');
    expect(broken[0]!.suggestion).not.toContain('create /etc/hosts');
    expect(broken[0]!.suggestion).toBe(ESCAPE_ADVICE);
  });

  test('u4: a ref to a file that EXISTS beyond the root is still broken — resolution never escapes (3adbc91)', () => {
    const ws = makeWs('u-outside-exists', { '01-a.md': '- A\n  - Ref: see: ../outside.md\n' });
    writeFileSync(join(ws.tmp, 'outside.md'), '- Outside\n', 'utf8');
    const files = loadFiles({ '01-a.md': '- A\n  - Ref: see: ../outside.md\n' });
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
    const broken = issues.filter(i => i.message.startsWith('broken ref:'));
    // Pre-fix: silently VALID (resolveSpecFile happily returned the outside
    // path) — the ref graph pointed outside the spec root.
    expect(broken).toHaveLength(1);
    expect(broken[0]!.message).toBe('broken ref: see ../outside.md — file not found in workspace');
    expect(broken[0]!.suggestion).toBe(ESCAPE_ADVICE);
  });

  test('u5: interior ".." that normalizes back inside the root still resolves (no over-blocking)', () => {
    const ws = makeWs('u-inside-dotdot', {
      '01-a.md': '- A\n  - Ref: see: sub/../02-b.md\n',
      '02-b.md': '- B\n',
    });
    const files = loadFiles({
      '01-a.md': '- A\n  - Ref: see: sub/../02-b.md\n',
      '02-b.md': '- B\n',
    });
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
    expect(issues.filter(i => i.message.startsWith('broken ref:'))).toHaveLength(0);
  });

  test('u6: resolveSpecFile containment — outside candidates null, inside candidates resolve', () => {
    const ws = makeWs('u-resolve-unit', { '01-a.md': '- A\n', '02-b.md': '- B\n' });
    writeFileSync(join(ws.tmp, 'outside.md'), '- Outside\n', 'utf8');
    expect(resolveSpecFile(ws.root, '../outside.md')).toBeNull();
    expect(resolveSpecFile(ws.root, '/etc/hosts')).toBeNull();
    expect(resolveSpecFile(ws.root, join(ws.tmp, 'outside.md'))).toBeNull();
    expect(resolveSpecFile(ws.root, '02-b.md')).not.toBeNull();
    expect(resolveSpecFile(ws.root, 'sub/../02-b.md')).not.toBeNull();
  });

  test('u7: CLI — escape ref to an existing outside file: refs.broken 1, exit 2', () => {
    const ws = makeWs('cli-outside-exists', { '01-a.md': '- A\n  - Ref: see: ../outside.md\n  - More: content\n' });
    writeFileSync(join(ws.tmp, 'outside.md'), '- Outside\n', 'utf8');
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(2);
    expect(j.ok).toBe(false);
    expect(j.refs.broken).toBe(1);
    const esc = j.issues.find((i: any) => i.message.includes('../outside.md'));
    expect(esc.suggestion).not.toContain('create ../outside.md');
    expect(esc.suggestion).toContain('inside the workspace');
  });

  test('u8: back-compat pin — an ordinary missing in-workspace target keeps the exact legacy advice', () => {
    const ws = makeWs('u-legacy-missing', { '01-a.md': '- A\n  - Ref: see: 99-nonexistent.md\n' });
    const files = loadFiles({ '01-a.md': '- A\n  - Ref: see: 99-nonexistent.md\n' });
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
    const broken = issues.filter(i => i.message.startsWith('broken ref:'));
    expect(broken).toHaveLength(1);
    expect(broken[0]!.message).toBe('broken ref: see 99-nonexistent.md — file not found');
    expect(broken[0]!.suggestion).toBe('create 99-nonexistent.md or fix the ref target');
  });
});

describe('issue #22 round 6 (QA-19 F51): §11 flat-first covers extensionless FLAT targets', () => {
  const FLAT_STEM_FILES = {
    '00-overview.md': '- Overview\n  - B area: see 02-b\n',
    '02-b.md': '- B\n  - Delta\n',
  };

  test('v1: `see 02-b` with 02-b.md loaded — resolves, 0 broken refs', () => {
    const ws = makeWs('v-flat-stem', FLAT_STEM_FILES);
    const files = loadFiles(FLAT_STEM_FILES);
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
    expect(issues.filter(i => i.category === 'refs')).toHaveLength(0);
  });

  test('v2: anchored `see 02-b#Delta` — the anchor is validated against 02-b.md', () => {
    const spec = { '00-overview.md': '- Overview\n  - B area: see 02-b#Delta\n', '02-b.md': '- B\n  - Delta\n' };
    const ws = makeWs('v-flat-stem-anchor', spec);
    let files = loadFiles(spec);
    let issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
    expect(issues.filter(i => i.category === 'refs')).toHaveLength(0);

    // A missing anchor inside the resolved file is a broken ANCHOR error
    // (not a broken file) — resolution happened, the node did not match.
    const bad = { '00-overview.md': '- Overview\n  - B area: see 02-b#Ghost\n', '02-b.md': '- B\n  - Delta\n' };
    const ws2 = makeWs('v-flat-stem-badanchor', bad);
    files = loadFiles(bad);
    issues = checkRefs(files, buildRefGraph(files, ws2.root), ws2.root);
    const anchorIssues = issues.filter(i => i.message.startsWith('broken anchor:'));
    expect(anchorIssues).toHaveLength(1);
    expect(anchorIssues[0]!.message).toBe('broken anchor: 02-b#Ghost — no node matches');
  });

  test('v3: trailing-slash flat `see 02-b/` resolves to the same loaded key (back-pointer grouping)', () => {
    const spec = {
      '01-a.md': '- A\n  - see: 02-b/\n',
      '02-b.md': '- B\n',
    };
    const files = loadFiles(spec);
    const back = rebuildBackPointers(files, buildRefGraph(files, '.'));
    const groups = back.get('02-b.md') ?? [];
    expect(groups).toHaveLength(1);
    expect(groups[0]!.node).toBe(null);
    expect(groups[0]!.fromFiles).toEqual(['01-a.md']);
    expect(back.has('02-b/')).toBe(false);
  });

  test('v4: deep-hop edges treat `see 02-b` as 02-b.md — the chain machinery sees the resolved target', () => {
    const spec = {
      '00-overview.md': '- Overview\n  - see 01-a.md\n',
      '01-a.md': '- A\n  - see: 02-b\n',
      '02-b.md': '- B\n',
    };
    const files = loadFiles(spec);
    const issues = detectDeepHops(buildRefGraph(files, '.'), 1);
    expect(issues).toHaveLength(1);
    // The edge 01-a → 02-b resolves (targetMatchesKey) so the hop fires; the
    // message keeps the referrer's raw spelling, the advice keeps resolving.
    expect(issues[0]!.message).toBe('DEEP HOP: 00-overview.md → 01-a.md → 02-b');
    expect(issues[0]!.suggestion).toBe(
      'add "see: 02-b" directly to 00-overview.md and remove the intermediate hop via 01-a.md: delete 00-overview.md\'s "see 01-a.md" (line 2)',
    );
  });

  test('v5: still-missing extensionless stem — create advice proposes the .md file (§11 flat-first)', () => {
    const spec = { '00-overview.md': '- Overview\n  - B area: see 02-b\n' };
    const ws = makeWs('v-flat-stem-missing', spec);
    const files = loadFiles(spec);
    const issues = checkRefs(files, buildRefGraph(files, ws.root), ws.root);
    const broken = issues.filter(i => i.message.startsWith('broken ref:'));
    expect(broken).toHaveLength(1);
    expect(broken[0]!.message).toBe('broken ref: see 02-b — file not found');
    // Numeric-prefix stems are spec-shaped (issue #4) — and the actionable
    // creation target is the .md file, never an extensionless file.
    expect(broken[0]!.suggestion).toBe('create 02-b.md or fix the ref target');
  });

  test('v6: CLI — `see 02-b` with 02-b.md present: refs.total 1, broken 0, no refs issues', () => {
    const ws = makeWs('cli-flat-stem', FLAT_STEM_FILES);
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(j.refs.total).toBe(1);
    expect(j.refs.broken).toBe(0);
    expect(j.refs.deepHops).toBe(0);
    expect(j.issues.some((i: any) => i.category === 'refs')).toBe(false);
  });
});

describe('issue #22 round 6 (QA-19 F15/F17–19): §11 "both existing = error" is slug-agnostic', () => {
  test('w1: detectFlatFolderConflicts flags the unnumbered auth.md + auth/index.md pair', () => {
    const ws = makeWs('w-unnumbered-unit', {
      'auth.md': '- Auth\n  - Sessions\n',
      'auth/index.md': '- Auth folder\n  - Sessions\n',
      '00-overview.md': '- Overview\n',
    });
    expect(detectFlatFolderConflicts(ws.root)).toEqual([['auth.md', 'auth/index.md']]);
  });

  test('w2: CLI — unnumbered pair is a duplicate-home ERROR (exit 2), numbered control unchanged', () => {
    const unnumbered = {
      'auth.md': '- Auth\n  - Sessions\n',
      'auth/index.md': '- Auth folder\n  - Sessions\n',
      '00-overview.md': '- Overview\n  - A: see auth\n',
    };
    const ws = makeWs('cli-unnumbered-dup', unnumbered);
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(2);
    const dup = j.issues.find((i: any) => i.rule === 'structure.duplicate_home');
    expect(dup).toBeDefined();
    expect(dup.message).toBe('duplicate home: both auth.md and auth/index.md exist — flat wins, remove the folder');
    expect(dup.suggestion).toBe('delete auth/index.md (or merge its content into auth.md)');
    // Flat wins: the ref resolves to auth.md — 0 broken refs.
    expect(j.refs.broken).toBe(0);

    // Control (QA-07 r2f1 shape): the numbered pair already fired pre-round-6.
    const numbered = {
      '02-authentication.md': '- Auth\n',
      '02-authentication/index.md': '- Auth folder\n',
      '00-overview.md': '- Overview\n  - A: see 02-authentication\n',
    };
    const ws2 = makeWs('cli-numbered-dup', numbered);
    const r2 = runCli(['check', '--json'], ws2.tmp);
    const j2 = parseJsonOut(r2.out);
    expect(r2.exit).toBe(2);
    expect(j2.issues.some((i: any) => i.rule === 'structure.duplicate_home')).toBe(true);
  });
});

describe('issue #22 round 6 (QA-19 F40b): refs.broken counts broken anchors', () => {
  test('x1: broken anchor ERROR present → refs.broken 1 (never 0 beside errorCount 1 / ok:false)', () => {
    const spec = {
      '00-overview.md': '- Overview\n  - Auth: see auth#Sessions\n',
      '01-api.md': '- API\n  - A: see auth#Rotation\n',
      'auth/index.md': '- Authentication\n  - Sessions\n',
    };
    const ws = makeWs('cli-broken-anchor-count', spec);
    const r = runCli(['check', '--json'], ws.tmp);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(2);
    expect(j.ok).toBe(false);
    expect(j.counts.errors).toBe(1);
    // The counter is truthful: a broken anchor is a broken ref (§12) — the
    // machine consumer filtering on refs.broken must not miss it.
    expect(j.refs.broken).toBe(1);
    expect(j.issues.some((i: any) => i.rule === 'refs.broken.anchor')).toBe(true);
  });
});
