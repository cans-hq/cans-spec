/**
 * Issue #62 QA (adversarial pass, pre-merge) — the spelling-dodge regression
 * suite for `references.forbidden_targets` path normalization.
 *
 * The bug this pins: a `see:` spelling that the ref engines RESOLVE to a
 * banned file could dodge the ban, because normalizeBanPath only collapsed
 * `//`, stripped one leading `./` and one leading `cans/`, and trimmed a
 * trailing `/` — while resolveSpecFile's join-then-contain resolution
 * (pinned since issue #22 u5: `sub/../02-b.md` is a VALID ref to `02-b.md`)
 * folds `.`/`..` segments on disk. Concretely, with the issue's own example
 * rule (`source "cans/[0-9]*.md"`, `pattern "^(cans/)?plugins/.*"`):
 *
 *   see: cans/../plugins/leaf.md    — VALID (join pops the cans/ segment it
 *                                     just saw) but normalized to
 *                                     `../plugins/leaf.md` → the anchored
 *                                     ban MISSED it;
 *   see: ../cans/plugins/leaf.md    — VALID whenever the workspace dir is
 *                                     canonically named `cans/` (discovery
 *                                     §3: join pops the workspace's own
 *                                     name and re-enters) but a leading-`..`
 *                                     path lexically → the anchored ban
 *                                     MISSED it.
 *
 * The fix (src/core/refs.ts): normalizeBanPath now resolves `.`/`..`
 * segments lexically — the mirror of the ref engines' own resolution — and
 * banCandidates offers the `../cans/…` re-entry's folded workspace-relative
 * spelling beside the lexical one (the same both-forms answer external
 * roots get, #55). What these tests pin:
 *
 *   q1 ..... every `.`/`..` spelling of a banned target fires under the
 *             issue's own ANCHORED rule, while the message quotes each
 *             ref's WRITTEN spelling (the s11/e5 convention);
 *   q2 ..... the `../cans/` re-entry fold: the re-entry spelling fires, a
 *             `../other/` escape (a genuinely different tree — the ref is
 *             broken, issue #10/#22) keeps ONLY the lexical candidate;
 *   q3 ..... the pins that must NOT move: the folder form (`plugins/` ≡
 *             `plugins`, `^plugins/` alone still misses the bare stem),
 *             `cans/`-qualified source globs, and unaffected sibling
 *             spellings like `cans/cans/x.md` (a nested cans/ dir is a
 *             real dir, not a prefix to strip);
 *   q4 ..... CLI end-to-end: the four-spelling workspace — every ref
 *             resolves (refs.broken 0, so nothing but the bans can fail
 *             the run) and all four findings report, exit 2.
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

import {
  buildRefGraph, checkForbiddenTargets,
} from '../../src/core/refs.ts';
import { checkWorkspace, type CheckArgs } from '../../src/commands/check.ts';
import { spawnCli, REPO } from '../runtime.ts';
import type { OutlineNode } from '../../src/types.ts';
import { parseOutline } from '../../src/core/outline.ts';

// ── engine scaffolding (mirrors issue-62-engine.test.ts) ────────────────────

/** A files map over inline sources — keys are workspace-relative paths. */
function filesOf(entries: Array<[string, string]>): Map<string, OutlineNode[]> {
  const m = new Map<string, OutlineNode[]>();
  for (const [key, src] of entries) m.set(key, parseOutline(src, key));
  return m;
}

function graphOf(entries: Array<[string, string]>): ReturnType<typeof buildRefGraph> {
  return buildRefGraph(filesOf(entries), '.');
}

// ── checkWorkspace scaffolding (scratch workspaces under repo/.tmp) ─────────

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-62-qa');
const createdDirs: string[] = [];
let wsSeq = 0;

afterEach(() => {
  while (createdDirs.length > 0) {
    rmSync(createdDirs.pop()!, { recursive: true, force: true });
  }
});

const BASE_OPTS: CheckArgs = {
  fix: false,
  strict: false,
  refsOnly: false,
  noRedundancy: false,
  file: null,
  json: false,
};

/** Blackbox CLI spawn — isolated from any ambient CANS_ROOT. */
function runCli(args: string[], cwd: string) {
  return spawnCli(args, cwd, { ...process.env, CANS_ROOT: '' });
}

// ── q1: `.`/`..` spellings resolve to the canonical candidate ───────────────

describe('issue #62 qa q1 — dot/dotdot spellings cannot dodge an anchored ban', () => {
  test('every resolves-the-same way spelling fires under the issue’s own rule', () => {
    // One file per spelling so the findings sort by file and each message
    // can be asserted with its OWN written target.
    const issues = checkForbiddenTargets(
      graphOf([
        ['01-a.md', '- A: see: cans/../plugins/leaf.md\n'],
        ['02-b.md', '- B: see: ./plugins/../plugins/leaf.md\n'],
        ['03-c.md', '- C: see: plugins/./leaf.md\n'],
        ['04-d.md', '- D: see: plugins//leaf.md\n'],
        ['05-e.md', '- E: see: plugins/leaf.md/\n'],
        ['06-f.md', '- F: see: plugins/leaf.md\n'],
      ]),
      [{ source: 'cans/[0-9]*.md', pattern: '^(cans/)?plugins/.*' }],
    );
    expect(issues.map(i => i.file)).toEqual([
      '01-a.md', '02-b.md', '03-c.md', '04-d.md', '05-e.md', '06-f.md',
    ]);
    // the message quotes each target AS WRITTEN while the match ran on the
    // resolved form (the e5/s11 convention) — including the two spellings
    // that used to slip past the anchored pattern.
    expect(issues[0]!.message).toContain('→ cans/../plugins/leaf.md');
    expect(issues[1]!.message).toContain('→ ./plugins/../plugins/leaf.md');
    expect(issues[5]!.message).toContain('→ plugins/leaf.md');
  });

  test('a precise $-anchored pattern also catches the folded spellings', () => {
    const issues = checkForbiddenTargets(
      graphOf([
        ['01-a.md', '- A: see: cans/../plugins/leaf.md\n'],
        ['02-b.md', '- B: see: sub/../plugins/leaf.md\n'],
      ]),
      [{ source: '[0-9]*.md', pattern: '^plugins/leaf\\.md$' }],
    );
    expect(issues.map(i => i.file)).toEqual(['01-a.md', '02-b.md']);
  });
});

// ── q2: the ../cans/ re-entry fold ──────────────────────────────────────────

describe('issue #62 qa q2 — the ../cans/ workspace re-entry is offered both ways', () => {
  test('the re-entry spelling fires under the anchored rule', () => {
    const issues = checkForbiddenTargets(
      graphOf([['01-core.md', '- Core: see: ../cans/plugins/leaf.md\n']]),
      [{ source: 'cans/[0-9]*.md', pattern: '^(cans/)?plugins/.*' }],
    );
    expect(issues).toHaveLength(1);
    // the lexical spelling is quoted as written — the FOLDED candidate is
    // what matched, exactly like the external dual form.
    expect(issues[0]!.message).toContain('→ ../cans/plugins/leaf.md');
    // …and the bare workspace-relative ban catches it too (the folded side).
    expect(checkForbiddenTargets(
      graphOf([['01-core.md', '- Core: see: ../cans/plugins/leaf.md\n']]),
      [{ source: '[0-9]*.md', pattern: '^plugins/' }],
    )).toHaveLength(1);
  });

  test('a ../other/ escape keeps ONLY the lexical candidate — it is a different tree', () => {
    // `../other/plugins/leaf.md` does not re-enter the workspace: on disk it
    // is the issue #10/#22 escape (a broken ref), so no fold is offered and
    // an anchored workspace ban rightly ignores it (the broken-ref finding
    // is that ref's verdict, not the layering guard's).
    expect(checkForbiddenTargets(
      graphOf([['01-core.md', '- Core: see: ../other/plugins/leaf.md\n']]),
      [{ source: '[0-9]*.md', pattern: '^plugins/' }],
    )).toEqual([]);
    // …while an unanchored pattern still sees the lexical string, and a
    // ban written for the escape shape itself works.
    expect(checkForbiddenTargets(
      graphOf([['01-core.md', '- Core: see: ../other/plugins/leaf.md\n']]),
      [{ source: '[0-9]*.md', pattern: '\\.\\./other/' }],
    )).toHaveLength(1);
  });
});

// ── q3: the pins that must not move ─────────────────────────────────────────

describe('issue #62 qa q3 — folder form and cans/ stripping survive the fold', () => {
  test('folder form: `plugins/` trims to the bare stem — ^plugins(/|$) fires, ^plugins/ alone still misses', () => {
    const graph = graphOf([['05-e.md', '- E: see: plugins/\n']]);
    expect(checkForbiddenTargets(graph, [{ source: '[0-9]*.md', pattern: '^plugins(/|$)' }])).toHaveLength(1);
    expect(checkForbiddenTargets(graph, [{ source: '[0-9]*.md', pattern: '^plugins$' }])).toHaveLength(1);
    expect(checkForbiddenTargets(graph, [{ source: '[0-9]*.md', pattern: '^plugins/' }])).toEqual([]);
  });

  test('cans/cans/x.md is a nested cans/ dir, not a prefix — only ONE cans/ strips', () => {
    // A target inside a workspace-nested `cans/cans/` dir keeps one `cans/`
    // segment after the single strip, so a bare `^plugins/` ban does not
    // reach it — the e5 `cans/plugins/leaf.md` pin in the other direction.
    const graph = graphOf([['01-a.md', '- A: see: cans/cans/plugins/leaf.md\n']]);
    expect(checkForbiddenTargets(graph, [{ source: '[0-9]*.md', pattern: '^plugins/' }])).toEqual([]);
    expect(checkForbiddenTargets(graph, [{ source: '[0-9]*.md', pattern: '^cans/plugins/' }])).toHaveLength(1);
  });

  test('`cans/./x` now resolves to `x` (the old comment’s one-strip note is superseded)', () => {
    // Pre-fix this normalized to `./x` (the cans/ strip ran first, leaving
    // the `./`); the lexical resolution folds the `.` segment first, so
    // `cans/./plugins/x.md` is `plugins/x.md` — the same file join() has
    // always resolved it to.
    const graph = graphOf([['01-a.md', '- A: see: cans/./plugins/leaf.md\n']]);
    expect(checkForbiddenTargets(graph, [{ source: '[0-9]*.md', pattern: '^plugins/' }])).toHaveLength(1);
  });
});

// ── q4: CLI end-to-end — the four-spelling workspace ───────────────────────

describe('issue #62 qa q4 — CLI: every resolvable spelling reports, nothing else fails', () => {
  /** A DISCOVERY-shaped scratch workspace: `<dir>/cans/` with the files —
   *  the `../cans/` re-entry spelling only resolves on disk when the
   *  workspace dir carries its canonical `cans/` name (§3), which is the
   *  production layout this scenario is about. Returns [projectRoot, cansRoot]. */
  function makeDiscoveryWs(name: string, files: Record<string, string>): [string, string] {
    const project = join(SCRATCH, `${name}-${++wsSeq}`);
    const cans = join(project, 'cans');
    mkdirSync(cans, { recursive: true });
    for (const [rel, content] of Object.entries(files)) {
      const p = join(cans, rel);
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, content, 'utf8');
    }
    createdDirs.push(project);
    return [project, cans];
  }

  test('checkWorkspace: four spellings, four findings, refs.broken 0, exit 2', async () => {
    const [project, cans] = makeDiscoveryWs('four-spellings', {
      '_rules.yaml': [
        'references:',
        '  back_pointers: false',
        '  duplicate_home_check: false',
        '  forbidden_targets:',
        '    - source: "cans/[0-9]*.md"',
        '      pattern: "^(cans/)?plugins/.*"',
        '',
      ].join('\n'),
      '01-core.md': [
        '- Core model',
        '  - dodge one: see: cans/../plugins/leaf.md',
        '  - dodge two: see: ../cans/plugins/leaf.md',
        '  - dodge three: see: ./plugins/../plugins/leaf.md',
        '  - honest: see: plugins/leaf.md',
        '',
      ].join('\n'),
      'plugins/leaf.md': '- Leaf holder\n  - gamma shape\n  - delta rate\n',
    });
    const r = await checkWorkspace(cans, BASE_OPTS);
    const bans = r.issues.filter(i => i.rule === 'refs.forbidden_target');
    expect(bans.map(i => i.line)).toEqual([2, 3, 4, 5]);
    // every spelling RESOLVES — so refs.broken is 0 and the bans are the
    // only refs findings: nothing but the layering guard fails this run.
    expect(r.refs.broken).toBe(0);
    expect(r.refs.total).toBe(4);
    expect(r.issues.filter(i => i.category === 'refs')).toHaveLength(4);
    expect(r.errorCount).toBe(4);
    expect(r.exitCode).toBe(2);

    // blackbox: the same workspace through the CLI (CWD = the project root,
    // discovery walks into cans/), byte-level detail check.
    const cli = runCli(['check', '--json'], project);
    expect(cli.exit).toBe(2);
    const j = JSON.parse(cli.out);
    expect(j.ok).toBe(false);
    expect(j.refs.broken).toBe(0);
    const details = j.sections.refs.map((f: { detail: string }) => f.detail);
    expect(details).toEqual([
      'forbidden target: 01-core.md:2 → cans/../plugins/leaf.md — references.forbidden_targets[0]'
        + ' (source "cans/[0-9]*.md", pattern "^(cans/)?plugins/.*")',
      'forbidden target: 01-core.md:3 → ../cans/plugins/leaf.md — references.forbidden_targets[0]'
        + ' (source "cans/[0-9]*.md", pattern "^(cans/)?plugins/.*")',
      'forbidden target: 01-core.md:4 → ./plugins/../plugins/leaf.md — references.forbidden_targets[0]'
        + ' (source "cans/[0-9]*.md", pattern "^(cans/)?plugins/.*")',
      'forbidden target: 01-core.md:5 → plugins/leaf.md — references.forbidden_targets[0]'
        + ' (source "cans/[0-9]*.md", pattern "^(cans/)?plugins/.*")',
    ]);
  });
});
