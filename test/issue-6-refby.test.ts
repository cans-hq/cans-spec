/**
 * Issue #6 regression tests — `check --fix` corrupting non-bullet content.
 *
 * Two documented gaps (GitHub issue #6, cans-spec 0.1.2):
 *   1. Fence-blind: extractBackPointers (src/core/outline.ts) and rewriteRefBy
 *      (src/commands/check.ts) scanned raw lines with no code-fence awareness —
 *      a ref-by comment inside a fenced example counted as a real back-pointer
 *      (false stale warning) and --fix rewrote INSIDE the fence.
 *   2. Whole-line deletion: for a non-bullet hit, rewriteRefBy nulled the whole
 *      line — a prose sentence merely containing a ref-by comment was deleted
 *      entire instead of just the comment substring.
 *
 * Contracts under test:
 *   - Lines inside ``` fences are byte-for-byte preserved by --fix, are never
 *     back-pointer hits, and fenced "- fake bullets" are never insertion anchors.
 *   - Non-bullet hits: only the comment substring is stripped (seam double space
 *     collapsed, trailing whitespace trimmed); the line is dropped only when
 *     nothing but the comment remains. Bullet lines keep the strip-and-keep
 *     behavior unchanged.
 *   - Insertion after the first root bullet outside any fence; appended at end
 *     when no such bullet exists — but never inside an unterminated fence.
 */
import { describe, test, expect, afterEach } from './testing.ts';
import { join } from 'path';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';

import { parseOutline, extractBackPointers, flattenNodes } from '../src/core/outline.ts';
import { rewriteRefBy } from '../src/commands/check.ts';
import { spawnCli, REPO } from './runtime.ts';

/** Repro 1 shape: a fenced ```markdown example quoting the ref-by syntax. */
const FENCED_DOC = [
  '- Overview',
  '  - First aspect of the outline',
  '  - Second aspect of the outline',
  '',
  '```markdown',
  '# Worked example',
  '',
  '<!-- ref-by: 99-legacy.md -->',
  '```',
  '',
  '  - Third aspect of the outline',
].join('\n');

const FENCE_BLOCK = [
  '```markdown',
  '# Worked example',
  '',
  '<!-- ref-by: 99-legacy.md -->',
  '```',
].join('\n');

// ── extractBackPointers: fence awareness ──

describe('issue #6: extractBackPointers is fence-aware', () => {
  test('ref-by comment inside a fenced example is never a back-pointer (repro 1)', () => {
    expect(extractBackPointers(FENCED_DOC, '01-x.md')).toEqual([]);
  });

  test('fence awareness applies after EOL normalization (CRLF input)', () => {
    expect(extractBackPointers(FENCED_DOC.replace(/\n/g, '\r\n'), '01-x.md')).toEqual([]);
  });

  test('comments outside fences still extract, with comma lists and 1-based lines', () => {
    const src = [
      '- Overview <!-- ref-by: 02-y.md -->',
      '```md',
      '<!-- ref-by: 99-legacy.md -->',
      '```',
      '- Another <!-- ref-by: 03-z.md, 04-w.md -->',
    ].join('\n');
    const bps = extractBackPointers(src, '01-x.md');
    expect(bps.map(b => b.fromFile)).toEqual(['02-y.md', '03-z.md', '04-w.md']);
    expect(bps.map(b => b.fromLine)).toEqual([1, 5, 5]);
    expect(bps.every(b => b.toFile === '01-x.md')).toBe(true);
  });

  test('nothing after an unterminated fence opener counts', () => {
    const src = ['```markdown', '<!-- ref-by: 99-legacy.md -->', 'still fenced'].join('\n');
    expect(extractBackPointers(src, '01-x.md')).toEqual([]);
  });

  test('the fence marker line itself never counts, even when it carries a comment', () => {
    const src = ['```markdown <!-- ref-by: 99-x.md -->', 'body', '```'].join('\n');
    expect(extractBackPointers(src, '01-x.md')).toEqual([]);
  });
});

// ── rewriteRefBy: fence awareness + prose preservation ──

describe('issue #6: rewriteRefBy is fence-aware and prose-preserving', () => {
  test('repro 1: fenced region stays byte-identical; real comment inserted after first root bullet', () => {
    // Caller passes the rebuilt desired body — 02-y.md see:-refs this file, so
    // rebuildBackPointers hands rewriteRefBy the body "02-y.md".
    const out = rewriteRefBy(FENCED_DOC, '02-y.md');
    const lines = out.split('\n');
    expect(lines[0]).toBe('- Overview');
    expect(lines[1]).toBe('<!-- ref-by: 02-y.md -->');
    expect(out).toContain(FENCE_BLOCK); // fenced example untouched, legacy comment intact
    expect(lines.slice(2)).toEqual(FENCED_DOC.split('\n').slice(1)); // nothing else moved
  });

  test('repro 2: non-bullet prose line loses only the comment substring', () => {
    const out = rewriteRefBy(
      'Note about history <!-- ref-by: 99-gone.md --> and it ends here',
      null,
    );
    expect(out).toBe('Note about history and it ends here');
  });

  test('non-bullet duplicate hit keeps the prose even when a desired comment exists', () => {
    const out = rewriteRefBy(
      '- Real <!-- ref-by: 02-y.md -->\nHistory note <!-- ref-by: 99-gone.md -->',
      '02-y.md',
    );
    expect(out).toBe('- Real <!-- ref-by: 02-y.md -->\nHistory note');
  });

  test('bare ref-by comment alone on a non-bullet line is dropped (documented new behavior)', () => {
    expect(rewriteRefBy('<!-- ref-by: 99-gone.md -->', null)).toBe('');
    expect(rewriteRefBy('Some prose\n<!-- ref-by: 99-gone.md -->\nMore prose', null))
      .toBe('Some prose\nMore prose');
    expect(rewriteRefBy('Some prose\n   <!-- ref-by: 99-gone.md -->   \nMore prose', null))
      .toBe('Some prose\nMore prose');
  });

  test('bullet lines keep the bullet when stale/duplicate comments are stripped (existing behavior)', () => {
    expect(rewriteRefBy('- Auth <!-- ref-by: old.md -->', null)).toBe('- Auth');
    expect(rewriteRefBy('- Auth <!-- ref-by: 04-api.md, 05-old.md -->', '04-api.md'))
      .toBe('- Auth <!-- ref-by: 04-api.md -->');
    const dup = '- A <!-- ref-by: stale.md -->\n- B <!-- ref-by: stale.md -->';
    expect(rewriteRefBy(dup, null)).toBe('- A\n- B');
    expect(rewriteRefBy(dup, 'new.md')).toBe('- A <!-- ref-by: new.md -->\n- B');
  });

  test('insertion never anchors on fenced fake bullets — appended at end when no real bullet exists', () => {
    const src = [
      'Intro prose paragraph.',
      '',
      '```md',
      '- fake bullet one',
      '- fake bullet two',
      '```',
      '',
      'Outro prose.',
    ].join('\n');
    const out = rewriteRefBy(src, '02-y.md');
    const lines = out.split('\n');
    const fenceStart = lines.findIndex(l => l.trim().startsWith('```'));
    const fenceEnd = lines.findIndex((l, idx) => idx > fenceStart && l.trim() === '```');
    for (let i = fenceStart; i <= fenceEnd; i++) {
      expect(lines[i]).not.toContain('ref-by'); // nothing inserted inside the fence
    }
    expect(out).toContain('```md\n- fake bullet one\n- fake bullet two\n```'); // bytes intact
    expect(lines[lines.length - 1]).toBe('<!-- ref-by: 02-y.md -->'); // appended at end
  });

  test('unterminated fence at EOF: insertion lands before the fence opener, never inside', () => {
    const src = [
      'Some leading prose.',
      '',
      '```md',
      '- fake bullet',
      'still fenced content',
    ].join('\n');
    const out = rewriteRefBy(src, '02-y.md');
    const lines = out.split('\n');
    const opener = lines.findIndex(l => l.trim().startsWith('```'));
    expect(opener).toBeGreaterThan(0);
    expect(lines[opener - 1]).toBe('<!-- ref-by: 02-y.md -->'); // before the opener
    // Fenced bytes intact: the comment shifted indices by one, so the original
    // opener now sits one line later — compare from the original opener on.
    expect(lines.slice(opener)).toEqual(src.split('\n').slice(opener - 1));
    expect(lines.slice(opener).some(l => l.includes('ref-by'))).toBe(false); // nothing fenced
  });

  test('fenced fake bullets before the real bullet: comment goes after the real bullet', () => {
    const src = ['```md', '- fake bullet', '```', '- Real bullet', '  - Real child'].join('\n');
    const out = rewriteRefBy(src, '02-y.md');
    const lines = out.split('\n');
    expect(lines.slice(0, 3)).toEqual(['```md', '- fake bullet', '```']); // fence untouched
    expect(lines[3]).toBe('- Real bullet');
    expect(lines[4]).toBe('<!-- ref-by: 02-y.md -->'); // right after the real root bullet
    expect(lines[5]).toBe('  - Real child');
  });
});

// ── parseOutline fence regression (context from issue #6) ──

describe('issue #6: parseOutline ignores fenced content (no regression)', () => {
  test('fenced example with see: lines yields no nodes and no refs', () => {
    const src = [
      '- Overview',
      '  - Real pointer: see 02-y.md',
      '```markdown',
      '- Fake: see 99-missing.md',
      '```',
      '  - Second real aspect',
    ].join('\n');
    const nodes = parseOutline(src, '01-x.md');
    const all = flattenNodes(nodes);
    expect(all.map(n => n.text)).toEqual([
      'Overview',
      'Real pointer: see 02-y.md',
      'Second real aspect',
    ]);
    expect(all.flatMap(n => n.refs).map(r => r.file)).toEqual(['02-y.md']);
  });
});

// ── CLI blackbox: the archiving flow (`cans check --fix`) end-to-end ──

interface Ws { root: string; cans: string }

const SCRATCH = join(REPO, '.tmp', 'issue-6');
const createdDirs: string[] = [];
let wsSeq = 0;

function makeWs(name: string): Ws {
  const root = join(SCRATCH, `${name}-${++wsSeq}`);
  mkdirSync(join(root, 'cans'), { recursive: true });
  createdDirs.push(root);
  return { root, cans: join(root, 'cans') };
}

/** Deterministic workspace resolution: CANS_ROOT '' (falsy → ignored) makes the
 *  cwd walk-up find <root>/cans — no reliance on .tmp mtime discovery. */
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
  return parsed;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    rmSync(createdDirs.pop()!, { recursive: true, force: true });
  }
});

describe('issue #6: check --fix end-to-end (CLI blackbox)', () => {
  test('repro 1 e2e: fenced example never reported stale; --fix leaves fence bytes intact', () => {
    const ws = makeWs('repro1-cli');
    const spec02Y = ['- Consumer', '  - Reads the overview: see 01-x.md', '  - Tracks progress locally', ''].join('\n');
    writeFileSync(join(ws.cans, '01-x.md'), FENCED_DOC + '\n');
    writeFileSync(join(ws.cans, '02-y.md'), spec02Y);
    // §18: an empty `force_file_for` list turns the code-fence overflow flag off
    // (otherwise the fenced EXAMPLE itself is an unrelated error under default
    // rules and would mask the ref-by behavior under test). Everything else
    // stays at the template defaults — back_pointers stays on.
    writeFileSync(join(ws.cans, '_rules.yaml'), [
      'structure:',
      '  node_length: { min: 3, max: 120 }',
      '  siblings: { min: 1, max: 12 }',
      '  depth: { min: 1, max: 5 }',
      '  single_child_collapse: true',
      '  empty_nodes: false',
      'style:',
      '  prefer: sibling',
      '  force_nested_above: 6',
      '  force_sibling_below: 3',
      '  shared_prefix_detection: true',
      'content:',
      '  tbd_allowed: true',
      '  max_tbd_per_file: 5',
      'references:',
      '  mode: pointer',
      '  back_pointers: true',
      '  max_hops: 1',
      '  orphan_check: true',
      '  duplicate_home_check: true',
      'redundancy:',
      '  enabled: true',
      '  word_frequency_threshold: 4',
      '  phrase_overlap_threshold: 0.7',
      '  cross_file_threshold: 2',
      '  stopwords: [the, a, an, of, to, in, for, and, or, with, must, shall, requires]',
      '  synonyms:',
      '    - [postgres, postgresql, pg]',
      '    - [auth, authentication, sign-in, signin]',
      '    - [api, endpoint, route]',
      '    - [frontend, client, ui]',
      '    - [db, database, storage]',
      'token_budget:',
      '  enabled: true',
      '  default_limit: 4096',
      '  estimate_chars_per_token: 3.5',
      '  warn_threshold: 0.8',
      'overflow:',
      '  max_node_chars: 200',
      '  force_file_for: []',
      '',
    ].join('\n'));

    // BEFORE --fix: the fenced legacy comment must not surface as a stale
    // back-pointer (it is not a real back-pointer).
    const pre = runCli(['check', '--json'], ws.root);
    const prej = parseJsonOut(pre.out);
    expect(pre.exit).toBe(0);
    const preStale = prej.issues.filter((i: any) => i.message.startsWith('stale back-pointer:'));
    expect(preStale).toEqual([]);

    // --fix: fence byte-identical, real comment inserted after first root bullet.
    const fix = runCli(['check', '--fix', '--json'], ws.root);
    const fixj = parseJsonOut(fix.out);
    expect(fixj.backPointersUpdated).toBe(1);
    const expectedAfter = [
      '- Overview',
      '<!-- ref-by: 02-y.md -->',
      ...FENCED_DOC.split('\n').slice(1),
    ].join('\n') + '\n';
    expect(readFileSync(join(ws.cans, '01-x.md'), 'utf-8')).toBe(expectedAfter);
    expect(readFileSync(join(ws.cans, '02-y.md'), 'utf-8')).toBe(spec02Y); // untouched

    // The back-pointer report reflects only real comments: 1 total, all current.
    expect(fixj.backPointers.total).toBe(1);
    expect(fixj.backPointers.current).toBe(1);
    expect(fixj.backPointers.stale).toBe(0);
    const postStale = fixj.issues.filter((i: any) => i.message.startsWith('stale back-pointer:'));
    expect(postStale).toEqual([]);
  });

  test('repro 2 e2e: --fix strips only the comment from a prose line, never the sentence', () => {
    const ws = makeWs('repro2-cli');
    writeFileSync(
      join(ws.cans, '01-x.md'),
      'Note about history <!-- ref-by: 99-gone.md --> and it ends here\n',
    );

    const fix = runCli(['check', '--fix', '--json'], ws.root);
    const fixj = parseJsonOut(fix.out);
    expect(fixj.backPointersUpdated).toBe(1);
    expect(readFileSync(join(ws.cans, '01-x.md'), 'utf-8'))
      .toBe('Note about history and it ends here\n');
  });
});
