/**
 * Issue #19 regression tests — "refby ignores anchor node".
 *
 * The back-pointer system treated `see: 01-auth.md#Sessions` as a FILE-LEVEL
 * reference only. Three visible consequences (GitHub issue #19, v0.3.0):
 *   1. `check --fix` wrote the `<!-- ref-by: … -->` comment at the file's FIRST
 *      ROOT BULLET instead of next to the referenced #Node — the reader at the
 *      exact node finds nothing, and the root gets a misleading credit.
 *   2. Retargeting the anchor (…#Sessions → …#Passwords, same file) kept the
 *      old back-pointer "current" — the anchor was invisible to the currency
 *      check, so no stale warning and no rewrite.
 *   3. A BROKEN anchor (…#NoSuchNode) still earned a current back-pointer:
 *      checkRefs flagged `broken anchor` while the target's back-pointer count
 *      reported 1/1 current and --fix kept writing the mark.
 *
 * Root cause: rebuildBackPointers (src/core/refs.ts) grouped incoming refs by
 * resolved target file only and never read BackPointer.toAnchor; check.ts's
 * currency tests compared file-level equality only; rewriteRefBy had no
 * anchor-node targeting.
 *
 * Contracts under test (new, documented in docs/cans.architecture.md §12/§22):
 *   - A ref WITH an anchor earns its ref-by mark INLINE on the anchor node's
 *     bullet line (the node found via the §12 anchorMatches resolution). A
 *     plain file-level ref keeps the historical placement: a standalone
 *     comment line right after the first root bullet (issue #6).
 *   - Comment form defines what it answers: an INLINE comment (on a bullet)
 *     answers "who refs this node?"; a STANDALONE comment (own line) answers
 *     "who refs this file?".
 *   - Currency: a standalone mark is current only for file-level refs; an
 *     inline mark on node X is current for refs whose anchor resolves to X,
 *     or for file-level refs (the mark is at least as precise as the ref —
 *     keeps issue #6's replace-in-place contract convergent).
 *   - Retargeting the anchor makes the old mark stale (warning + --fix move).
 *   - A broken anchor earns NO current mark: not counted current, not written
 *     by --fix (the ref is already a checkRefs error).
 *   - Fence safety (issue #6) and the [file] filter (issue #11) do not regress.
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';

import { parseOutline, extractBackPointers, flattenNodes } from '../../src/core/outline.ts';
import { buildRefGraph, rebuildBackPointers } from '../../src/core/refs.ts';
import { rewriteRefBy } from '../../src/commands/check.ts';
import { spawnCli, REPO } from '../runtime.ts';

// ── CLI-level scaffolding (mirrors test/issues/issue-1.test.ts) ──

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-19');

interface Ws {
  root: string;
  cans: string;
}

const createdDirs: string[] = [];
let wsSeq = 0;

/** Fresh scratch workspace under repo/.tmp/issues/issue-19 (gitignored). */
function makeWs(name: string): Ws {
  const root = join(SCRATCH, `${name}-${++wsSeq}`);
  mkdirSync(join(root, 'cans'), { recursive: true });
  createdDirs.push(root);
  return { root, cans: join(root, 'cans') };
}

/** Blackbox CLI spawn, isolated from any ambient CANS_ROOT. */
function runCli(args: string[], cwd: string) {
  return spawnCli(args, cwd, { ...process.env, CANS_ROOT: '' });
}

/** JSON-mode output must be a single JSON document; a parse failure is itself
 *  an assertion failure. Reconstitutes the flat issues view from sections. */
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
    const dir = createdDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Unit: extractBackPointers records the served anchor (inline vs standalone) ──

describe('issue #19: extractBackPointers is anchor-aware (comment form → toAnchor)', () => {
  test('inline comment on a bullet records the node text as toAnchor', () => {
    const src = [
      '- Authentication',
      '  - Sessions <!-- ref-by: 02-api.md -->',
      '    - Expire after 24 hours',
    ].join('\n');
    const bps = extractBackPointers(src, '01-auth.md');
    expect(bps.length).toBe(1);
    expect(bps[0]!.fromFile).toBe('02-api.md');
    expect(bps[0]!.toFile).toBe('01-auth.md');
    expect(bps[0]!.fromLine).toBe(2);
    expect(bps[0]!.toAnchor).toBe('Sessions'); // the node the comment annotates
  });

  test('inline comment on a checkbox bullet records the text after the checkbox', () => {
    const src = '- [x] Ship sessions <!-- ref-by: 02-api.md -->\n';
    const bps = extractBackPointers(src, '01-auth.md');
    expect(bps[0]!.toAnchor).toBe('Ship sessions');
  });

  test('standalone comment line stays file-level (toAnchor null)', () => {
    const src = ['- Authentication', '<!-- ref-by: 02-api.md -->', '  - Sessions'].join('\n');
    const bps = extractBackPointers(src, '01-auth.md');
    expect(bps.length).toBe(1);
    expect(bps[0]!.toAnchor).toBeNull();
  });

  test('comma lists on an inline comment all serve the same node anchor', () => {
    const src = '  - Sessions <!-- ref-by: 02-api.md, 03-ops.md -->\n';
    const bps = extractBackPointers(src, '01-auth.md');
    expect(bps.map(b => b.toAnchor)).toEqual(['Sessions', 'Sessions']);
  });
});

// ── Unit: rebuildBackPointers keys groups by (target file, anchor node) ──

describe('issue #19: rebuildBackPointers groups by file AND anchor node', () => {
  function graphFor(files: Record<string, string>) {
    const map = new Map<string, any[]>();
    for (const [name, content] of Object.entries(files)) {
      map.set(name, parseOutline(content, name));
    }
    return { map, graph: buildRefGraph(map, '.') };
  }

  test('anchored ref produces a group with the resolved node; file-level ref a node-less group', () => {
    const { map, graph } = graphFor({
      '01-auth.md': '- Authentication\n  - Sessions\n    - Expire after 24 hours\n  - Passwords\n    - Minimum 12 characters\n',
      '02-api.md': '- API\n  - Session rules: see 01-auth.md#Sessions\n',
      '03-ops.md': '- Ops\n  - Auth policy: see 01-auth.md\n',
    });
    const rebuilt = rebuildBackPointers(map, graph);
    const groups = rebuilt.get('01-auth.md') ?? [];
    // one file-level group (03-ops.md) and one anchored group (node Sessions)
    expect(groups.length).toBe(2);
    const fileLevel = groups.find(g => g.node === null);
    const anchored = groups.find(g => g.node !== null);
    expect(fileLevel?.fromFiles).toEqual(['03-ops.md']);
    expect(anchored?.node?.text).toBe('Sessions');
    expect(anchored?.node?.line).toBe(2); // 1-based source line of `- Sessions`
    expect(anchored?.fromFiles).toEqual(['02-api.md']);
  });

  test('two referrers at the same anchor merge into one group', () => {
    const { map, graph } = graphFor({
      '01-auth.md': '- Authentication\n  - Sessions\n  - Passwords\n',
      '02-api.md': '- API\n  - Session rules: see 01-auth.md#Sessions\n',
      '03-ops.md': '- Ops\n  - Session ops: see 01-auth.md#sessions\n', // case-insensitive §12
    });
    const rebuilt = rebuildBackPointers(map, graph);
    const groups = rebuilt.get('01-auth.md') ?? [];
    const anchored = groups.filter(g => g.node !== null);
    expect(anchored.length).toBe(1);
    expect(anchored[0]!.node!.text).toBe('Sessions');
    expect(anchored[0]!.fromFiles.sort()).toEqual(['02-api.md', '03-ops.md']);
  });

  test('broken anchor (no matching node) earns NO group — no mark is written for it', () => {
    const { map, graph } = graphFor({
      '01-auth.md': '- Authentication\n  - Sessions\n',
      '02-api.md': '- API\n  - Session rules: see 01-auth.md#NoSuchNode\n',
    });
    const rebuilt = rebuildBackPointers(map, graph);
    const groups = rebuilt.get('01-auth.md') ?? [];
    expect(groups.filter(g => g.node !== null)).toEqual([]); // broken anchor dropped
  });

  test('anchor resolution follows §12 hyphen/space normalization (#Data-protection)', () => {
    const { map, graph } = graphFor({
      '01-auth.md': '- Authentication\n  - Data protection\n    - Encrypted at rest\n',
      '02-api.md': '- API\n  - Privacy: see 01-auth.md#Data-protection\n',
    });
    const rebuilt = rebuildBackPointers(map, graph);
    const groups = rebuilt.get('01-auth.md') ?? [];
    expect(groups.length).toBe(1);
    expect(groups[0]!.node!.text).toBe('Data protection');
    expect(groups[0]!.node!.line).toBe(2);
  });
});

// ── Unit: rewriteRefBy places anchored marks on the anchor node's line ──

describe('issue #19: rewriteRefBy anchored placement', () => {
  const AUTH = [
    '- Authentication',
    '  - Sessions',
    '    - Expire after 24 hours',
    '  - Passwords',
    '    - Minimum 12 characters',
  ].join('\n') + '\n';

  test('anchored placement appends the comment inline on the anchor node bullet', () => {
    const out = rewriteRefBy(AUTH, null, [{ line: 2, body: '02-api.md' }]);
    const lines = out.split('\n');
    expect(lines[0]).toBe('- Authentication'); // root untouched
    expect(lines[1]).toBe('  - Sessions <!-- ref-by: 02-api.md -->'); // ON the node
    expect(lines[2]).toBe('    - Expire after 24 hours');
    expect(lines[3]).toBe('  - Passwords');
  });

  test('file-level body keeps the standalone-after-first-root-bullet form (issue #6)', () => {
    const out = rewriteRefBy(AUTH, '03-ops.md', []);
    const lines = out.split('\n');
    expect(lines[0]).toBe('- Authentication');
    expect(lines[1]).toBe('<!-- ref-by: 03-ops.md -->');
    expect(lines[2]).toBe('  - Sessions');
  });

  test('file-level AND anchored marks coexist in one file', () => {
    const out = rewriteRefBy(AUTH, '03-ops.md', [{ line: 2, body: '02-api.md' }]);
    const lines = out.split('\n');
    expect(lines[0]).toBe('- Authentication');
    expect(lines[1]).toBe('<!-- ref-by: 03-ops.md -->');
    expect(lines[2]).toBe('  - Sessions <!-- ref-by: 02-api.md -->');
  });

  test('an existing inline mark at the anchor line is REPLACED in place, not duplicated', () => {
    const src = '- Authentication\n  - Sessions <!-- ref-by: 09-old.md -->\n    - Expire after 24 hours\n';
    const out = rewriteRefBy(src, null, [{ line: 2, body: '02-api.md' }]);
    const lines = out.split('\n');
    expect(lines[1]).toBe('  - Sessions <!-- ref-by: 02-api.md -->');
    expect(out.match(/<!-- ref-by:/g)?.length).toBe(1);
  });

  test('retarget: the mark MOVES from the old anchor node to the new one', () => {
    // Old state: mark at Sessions (line 2). New desired: anchor at Passwords (line 4).
    const src = '- Authentication\n  - Sessions <!-- ref-by: 02-api.md -->\n    - Expire after 24 hours\n  - Passwords\n    - Minimum 12 characters\n';
    const out = rewriteRefBy(src, null, [{ line: 4, body: '02-api.md' }]);
    const lines = out.split('\n');
    expect(lines[1]).toBe('  - Sessions'); // old mark stripped
    expect(lines[3]).toBe('  - Passwords <!-- ref-by: 02-api.md -->'); // new mark placed
    expect(out.match(/<!-- ref-by:/g)?.length).toBe(1);
  });

  test('a misplaced root-level inline mark is stripped when the ref is anchored elsewhere', () => {
    // v0.3.0 wrote the anchored ref's mark at the root bullet — issue #19 repro 1 shape.
    const src = '- Authentication <!-- ref-by: 02-api.md -->\n  - Sessions\n    - Expire after 24 hours\n';
    const out = rewriteRefBy(src, null, [{ line: 2, body: '02-api.md' }]);
    const lines = out.split('\n');
    expect(lines[0]).toBe('- Authentication'); // misleading root credit removed
    expect(lines[1]).toBe('  - Sessions <!-- ref-by: 02-api.md -->');
  });

  test('fenced fake bullets are never anchor lines (issue #6 fence safety holds)', () => {
    const src = [
      '- Authentication',
      '```md',
      '  - Sessions',
      '```',
      '  - Sessions',
      '    - Expire after 24 hours',
    ].join('\n') + '\n';
    // The REAL `- Sessions` (parsed node, line 5) is the anchor — never the fenced copy.
    const out = rewriteRefBy(src, null, [{ line: 5, body: '02-api.md' }]);
    const lines = out.split('\n');
    expect(lines[1]).toBe('```md');
    expect(lines[2]).toBe('  - Sessions'); // fenced line untouched, no comment
    expect(lines[3]).toBe('```');
    expect(lines[4]).toBe('  - Sessions <!-- ref-by: 02-api.md -->');
  });
});

// The issue's demo target file (LF; EOL preservation is issue #21's territory).
const AUTH_MD = [
  '- Authentication',
  '  - Sessions',
  '    - Expire after 24 hours',
  '  - Passwords',
  '    - Minimum 12 characters',
  '',
].join('\n');

// ── CLI blackbox: the three documented repros, end-to-end ──

describe('issue #19: check --fix end-to-end (CLI blackbox)', () => {

  function authWs(name: string, apiRef: string): Ws {
    const ws = makeWs(name);
    writeFileSync(join(ws.cans, '01-auth.md'), AUTH_MD, 'utf8');
    writeFileSync(join(ws.cans, '02-api.md'), `- API\n  - Session rules: see ${apiRef}\n`, 'utf8');
    return ws;
  }

  test('repro 1: --fix writes the mark at the referenced #Sessions node, not the first root bullet', () => {
    const ws = authWs('repro1-anchor-placement', '01-auth.md#Sessions');
    const r = runCli(['check', '--fix', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(j.backPointersUpdated).toBe(1);
    const after = readFileSync(join(ws.cans, '01-auth.md'), 'utf-8');
    // The mark is attached to the `- Sessions` bullet — a reader AT the node
    // finds "what points here". The root gets no credit it did not earn.
    expect(after).toBe([
      '- Authentication',
      '  - Sessions <!-- ref-by: 02-api.md -->',
      '    - Expire after 24 hours',
      '  - Passwords',
      '    - Minimum 12 characters',
      '',
    ].join('\n'));
    // Reporting stays truthful: 1 back-pointer, current.
    expect(j.backPointers.total).toBe(1);
    expect(j.backPointers.current).toBe(1);
    expect(j.backPointers.stale).toBe(0);
  });

  test('repro 2: retargeting the anchor makes the old mark stale, and --fix moves it', () => {
    const ws = authWs('repro2-retarget', '01-auth.md#Sessions');
    runCli(['check', '--fix', '--json'], ws.root); // mark lands on Sessions
    expect(readFileSync(join(ws.cans, '01-auth.md'), 'utf-8')).toContain('  - Sessions <!-- ref-by: 02-api.md -->');

    // Retarget the anchor: #Sessions → #Passwords (same file).
    writeFileSync(
      join(ws.cans, '02-api.md'),
      '- API\n  - Session rules: see 01-auth.md#Passwords\n',
      'utf8',
    );

    // The old mark must now be STALE — the anchor is visible to the currency check.
    const pre = parseJsonOut(runCli(['check', '--json'], ws.root).out);
    expect(pre.backPointers.stale).toBe(1);
    expect(pre.backPointers.current).toBe(0);
    expect(pre.issues.some((i: any) => i.message.startsWith('stale back-pointer: 02-api.md'))).toBe(true);

    // --fix moves the mark to the new anchor node.
    const fixed = parseJsonOut(runCli(['check', '--fix', '--json'], ws.root).out);
    expect(fixed.backPointersUpdated).toBe(1);
    const after = readFileSync(join(ws.cans, '01-auth.md'), 'utf-8');
    expect(after).toBe([
      '- Authentication',
      '  - Sessions',
      '    - Expire after 24 hours',
      '  - Passwords <!-- ref-by: 02-api.md -->',
      '    - Minimum 12 characters',
      '',
    ].join('\n'));

    // Re-check: 1/1 current, no stale remains.
    const post = parseJsonOut(runCli(['check', '--json'], ws.root).out);
    expect(post.backPointers.stale).toBe(0);
    expect(post.backPointers.current).toBe(1);
    expect(post.backPointers.total).toBe(1);
  });

  test('repro 3: a broken anchor earns NO current back-pointer and no mark', () => {
    const ws = authWs('repro3-broken-anchor', '01-auth.md#NoSuchNode');

    // Before any fix: checkRefs flags the broken anchor; the target must not
    // report a current back-pointer it did not earn.
    const pre = parseJsonOut(runCli(['check', '--json'], ws.root).out);
    expect(pre.issues.some((i: any) => i.message.startsWith('broken anchor:'))).toBe(true);
    expect(pre.backPointers.total).toBe(0);
    expect(pre.backPointers.current).toBe(0);

    // --fix writes NOTHING for the broken anchor (file byte-identical).
    const fix = parseJsonOut(runCli(['check', '--fix', '--json'], ws.root).out);
    expect(fix.backPointersUpdated).toBe(0);
    expect(readFileSync(join(ws.cans, '01-auth.md'), 'utf-8')).toBe(AUTH_MD);
    expect(readFileSync(join(ws.cans, '01-auth.md'), 'utf-8')).not.toContain('ref-by');
  });

  test('broken anchor after a previous fix: the now-unearned mark is stripped, not kept current', () => {
    const ws = authWs('repro3b-broken-after-fix', '01-auth.md#Sessions');
    runCli(['check', '--fix', '--json'], ws.root); // mark lands on Sessions
    // The anchor breaks (node renamed away in the ref).
    writeFileSync(
      join(ws.cans, '02-api.md'),
      '- API\n  - Session rules: see 01-auth.md#NoSuchNode\n',
      'utf8',
    );

    const pre = parseJsonOut(runCli(['check', '--json'], ws.root).out);
    expect(pre.backPointers.total).toBe(1);
    expect(pre.backPointers.current).toBe(0); // NOT current — broken anchors earn nothing
    expect(pre.backPointers.stale).toBe(1);

    const fix = parseJsonOut(runCli(['check', '--fix', '--json'], ws.root).out);
    expect(fix.backPointersUpdated).toBe(1);
    expect(readFileSync(join(ws.cans, '01-auth.md'), 'utf-8')).toBe(AUTH_MD); // mark removed
  });

  test('file-level ref (no anchor) keeps the first-root-bullet placement (issue #6 non-regression)', () => {
    const ws = makeWs('file-level-unchanged');
    writeFileSync(join(ws.cans, '01-auth.md'), AUTH_MD, 'utf8');
    writeFileSync(join(ws.cans, '02-api.md'), '- API\n  - Auth policy: see 01-auth.md\n', 'utf8');
    const r = runCli(['check', '--fix', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(j.backPointersUpdated).toBe(1);
    const after = readFileSync(join(ws.cans, '01-auth.md'), 'utf-8');
    expect(after).toBe([
      '- Authentication',
      '<!-- ref-by: 02-api.md -->',
      '  - Sessions',
      '    - Expire after 24 hours',
      '  - Passwords',
      '    - Minimum 12 characters',
      '',
    ].join('\n'));
    expect(j.backPointers.current).toBe(1);
  });

  test('--fix is idempotent under the new placement (second run writes nothing)', () => {
    const ws = authWs('idempotent', '01-auth.md#Sessions');
    runCli(['check', '--fix', '--json'], ws.root);
    const once = readFileSync(join(ws.cans, '01-auth.md'), 'utf-8');
    const second = parseJsonOut(runCli(['check', '--fix', '--json'], ws.root).out);
    expect(second.backPointersUpdated).toBe(0);
    expect(readFileSync(join(ws.cans, '01-auth.md'), 'utf-8')).toBe(once);
  });

  test('[file] filter (issue #11): refs stay global — the anchored mark is still written when filtering another file', () => {
    const ws = authWs('file-filter', '01-auth.md#Sessions');
    writeFileSync(join(ws.cans, '03-misc.md'), '- Misc\n  - Filler content\n', 'utf8');
    const r = runCli(['check', '03-misc.md', '--fix', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(j.exitCode).not.toBe(2); // filter matched — no check-fail
    const auth = readFileSync(join(ws.cans, '01-auth.md'), 'utf-8');
    expect(auth).toContain('  - Sessions <!-- ref-by: 02-api.md -->');
  });
});

// ── parse-level sanity: anchors resolve through the parsed outline ──

describe('issue #19: anchor node resolution reaches the parsed outline', () => {
  test('flattenNodes exposes the node line rebuildBackPointers needs', () => {
    const nodes = parseOutline(AUTH_MD, '01-auth.md');
    const sessions = flattenNodes(nodes).find(n => n.text === 'Sessions');
    expect(sessions).toBeDefined();
    expect(sessions!.line).toBe(2);
    expect(sessions!.indent).toBe(1);
  });
});
