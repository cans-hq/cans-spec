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
 *   f ..... detectDeepHops: exact-spelling duplicate → same guard
 *   g ..... detectDeepHops: normal advice now states the hop removal
 *   h ..... detectDeepHops: trailing-slash referrer → same guard fires
 *   i ..... CLI end-to-end: the issue's repro workspace
 *   j ..... CLI end-to-end: the trailing-slash variant
 *   k ..... CLI end-to-end (control, green pre-fix): removing the referrer's
 *          intermediate ref clears the deep hop — the graph machinery the new
 *          advice finally points at.
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

import { parseOutline } from '../../src/core/outline.ts';
import {
  targetMatchesKey, buildRefGraph, checkRefs, detectDeepHops, rebuildBackPointers,
} from '../../src/core/refs.ts';
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

/** Referrer already holds the target under the EXACT suggested spelling. */
const DUP_EXACT_FILES = {
  '00-overview.md': '- Overview\n  - Auth lives in: see auth/index.md#Sessions\n  - API details: see 01-api.md\n',
  '01-api.md': '- API\n  - Uses auth sessions: see auth\n',
  'auth/index.md': '- Authentication\n  - Sessions\n    - Expire after 24 hours\n',
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
    expect(broken[0]!.suggestion).not.toContain('create auth/');
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
    expect(back.get('auth/index.md')).toBe('01-api.md');
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
    // following it actually removes the deep hop.
    expect(issue.suggestion).toBe(
      '00-overview.md already refs auth/index.md#Sessions as "see auth#Sessions" — remove the intermediate hop via 01-api.md',
    );
  });

  test('f: exact spelling — the referrer already holds the suggested target verbatim', () => {
    const files = loadFiles(DUP_EXACT_FILES);
    const issues = detectDeepHops(buildRefGraph(files, '.'), 1);
    expect(issues).toHaveLength(1);
    const issue = issues[0]!;
    expect(issue.suggestion).not.toContain('add "see: auth"');
    expect(issue.suggestion).toBe(
      '00-overview.md already refs auth/index.md as "see auth/index.md#Sessions" — remove the intermediate hop via 01-api.md',
    );
  });

  test('g: no existing ref — the plain advice still says the hop must be removed', () => {
    const files = loadFiles(CHAIN_FILES);
    const issues = detectDeepHops(buildRefGraph(files, '.'), 1);
    expect(issues).toHaveLength(1);
    const issue = issues[0]!;
    expect(issue.message).toBe('DEEP HOP: 01-a.md → 02-b.md → 03-c.md');
    // Core of the original advice, plus the removal the issue demands: adding
    // the direct ref alone leaves the deep hop in place.
    expect(issue.suggestion).toBe(
      'add "see: 03-c.md" directly to 01-a.md and remove the intermediate hop via 02-b.md',
    );
  });

  test('h: trailing-slash referrer — the same already-refs guard fires on the equivalent spelling', () => {
    const files = loadFiles(TRAILING_SLASH_FILES);
    const issues = detectDeepHops(buildRefGraph(files, '.'), 1);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.suggestion).toBe(
      '00-overview.md already refs auth/index.md#Sessions as "see auth/#Sessions" — remove the intermediate hop via 01-api.md',
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
