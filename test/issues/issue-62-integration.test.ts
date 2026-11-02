/**
 * Issue #62 — `references.forbidden_targets`: the cross-feature integration
 * contract (QA plan scenarios 9–17; the CLI surface lives in
 * issue-62-cli.test.ts).
 *
 * What these pin, beyond the CLI suite:
 *   - contract 3 (independence): a forbidden target that is ALSO broken
 *     yields BOTH findings — `refs.broken.file` beside
 *     `refs.forbidden_target` (missing target), `refs.broken.anchor` beside
 *     it (missing anchor) — and the `refs.broken` counter counts only the
 *     broken one;
 *   - contract 2 (normalization): `cans/plugins/leaf.md`,
 *     `./plugins/leaf.md` and `plugins/leaf.md` are ONE target — a single
 *     `^plugins/` rule bans all three spellings (matching runs on the
 *     normalized form; the detail quotes each ref's written spelling);
 *   - contract 1 (aliasing, #57): a bracketed short use resolves to its
 *     full target FIRST — the ban fires on the resolved target and the
 *     detail ends `, via alias "[1]"` — aliasing cannot dodge a ban;
 *   - external roots (#55): a `kelir://plugins/leaf.md` pointer is banned
 *     by EITHER the written form (`^kelir://plugins/`) or the bare
 *     root-relative sub-path (`^plugins/`);
 *   - the issue's kelir scoping need: `except` exempts the catalog and the
 *     overview index from an otherwise blanket numbered-files ban;
 *   - source-glob scoping end-to-end: `plugins/**` bans refs FROM plugin
 *     files; `[0-9]*.md` does not treat a plugin file as a source;
 *   - contract 6 (graph citizenship): a banned ref still counts in
 *     `refs.total`, a deep-hop chain whose final edge is banned still
 *     reports `refs.deep_hop`, and the ban neither hides nor invents graph
 *     edges — the banned ref still counts as incoming for orphan purposes
 *     (its target is NOT an orphan), while an unlinked file still is one;
 *   - no auto-fix: `--fix` neither removes nor rewrites forbidden refs —
 *     a layering violation is an author decision, the finding stays and
 *     the `see:` line stays on disk.
 *
 * Contract-first on the integration branch: until the four-way merge lands
 * the config and engine halves, every rules file carrying the key rejects
 * as a config error — the tests fail with clean assertion failures, never
 * crashes.
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';

import { spawnCli, REPO } from '../runtime.ts';

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-62-integration');

interface Ws { root: string; cans: string }

const createdDirs: string[] = [];
let wsSeq = 0;

/** Fresh scratch workspace under repo/.tmp/issues/issue-62-integration (gitignored). */
function makeWs(name: string): Ws {
  const root = join(SCRATCH, `${name}-${++wsSeq}`);
  mkdirSync(join(root, 'cans'), { recursive: true });
  createdDirs.push(root);
  return { root, cans: join(root, 'cans') };
}

/** Blackbox CLI spawn — isolated from any ambient CANS_ROOT. */
function runCli(args: string[], cwd: string) {
  return spawnCli(args, cwd, { ...process.env, CANS_ROOT: '' });
}

/** JSON-mode output must be a single JSON document; a parse failure is itself an assertion failure. */
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

/** All refs.forbidden_target findings, in report order. */
function forbidden(j: any): any[] {
  return j.sections.refs.filter((f: any) => f.rule === 'refs.forbidden_target');
}

/** All findings with the given rule key. */
function byRule(j: any, rule: string): any[] {
  return j.sections.refs.filter((f: any) => f.rule === rule);
}

/** A quiet plugin leaf (promoted to a spec file the moment a spec refs it). */
const LEAF = '- Leaf holder\n  - gamma shape\n  - delta rate\n';

/** Write `path` under the workspace cans/ root, creating parent dirs. */
function write(ws: Ws, rel: string, content: string): void {
  const p = join(ws.cans, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, content, 'utf8');
}

describe('issue #62 integration — references.forbidden_targets across features', () => {
  test('s9: broken AND forbidden — missing target file yields both refs.broken.file and refs.forbidden_target; refs.broken counts only the broken one', () => {
    const ws = makeWs('broken-and-forbidden');
    write(ws, '01-core.md', '- Core model\n  - glossary link: see: 99-glossary.md\n  - plugin wiring: see: plugins/leaf.md\n');
    write(ws, '99-glossary.md', '- Glossary\n  - alpha term\n  - beta term\n');
    // plugins/leaf.md deliberately NOT created: the banned ref is also broken.
    write(ws, '_rules.yaml', 'references:\n  back_pointers: false\n  duplicate_home_check: false\n  forbidden_targets:\n    - source: "cans/[0-9]*.md"\n      pattern: "plugins/"\n');

    const r = runCli(['check', '--json'], ws.root);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(false);

    // Both findings coexist (contract 3): fixing the anchor/file must not
    // hide the leak, and removing the leak must not require fixing the file.
    const broken = byRule(j, 'refs.broken.file');
    expect(broken).toHaveLength(1);
    expect(broken[0].file).toBe('01-core.md');
    expect(broken[0].detail).toBe('broken ref: see plugins/leaf.md — file not found');
    const bans = forbidden(j);
    expect(bans).toHaveLength(1);
    expect(bans[0].file).toBe('01-core.md');
    expect(bans[0].line).toBe(3);
    expect(bans[0].detail).toBe(
      'forbidden target: 01-core.md:3 → plugins/leaf.md — references.forbidden_targets[0] (source "cans/[0-9]*.md", pattern "plugins/")',
    );

    // The forbidden finding is NOT a broken pointer: the counter counts
    // exactly the refs.broken.file finding.
    expect(j.refs.broken).toBe(1);
    // Contract 6: the banned ref is still a graph citizen.
    expect(j.refs.total).toBe(2);
  });

  test('s10: broken anchor AND forbidden — refs.broken.anchor beside the ban, both reported at the same see: line', () => {
    const ws = makeWs('broken-anchor-and-forbidden');
    write(ws, '01-core.md', '- Core model\n  - plugin wiring: see: plugins/leaf.md#NoSuchAnchor\n');
    write(ws, 'plugins/leaf.md', LEAF);
    write(ws, '_rules.yaml', 'references:\n  back_pointers: false\n  duplicate_home_check: false\n  forbidden_targets:\n    - source: "cans/[0-9]*.md"\n      pattern: "plugins/"\n');

    const r = runCli(['check', '--json'], ws.root);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(false);

    const anchors = byRule(j, 'refs.broken.anchor');
    expect(anchors).toHaveLength(1);
    expect(anchors[0].line).toBe(2);
    const bans = forbidden(j);
    expect(bans).toHaveLength(1);
    // Anchor stripped (contract 2): the ban matched the FILE part.
    expect(bans[0].detail).toBe(
      'forbidden target: 01-core.md:2 → plugins/leaf.md — references.forbidden_targets[0] (source "cans/[0-9]*.md", pattern "plugins/")',
    );
    expect(j.refs.broken).toBe(1); // the broken anchor, not the ban
  });

  test('s11: path normalization — one ^plugins/ rule bans the cans/-qualified, ./-relative and plain spellings of one target', () => {
    const ws = makeWs('normalization');
    write(
      ws,
      '01-core.md',
      '- Core model\n  - link a: see: cans/plugins/leaf.md\n  - link b: see: ./plugins/leaf.md\n  - link c: see: plugins/leaf.md\n',
    );
    // Both spellings must RESOLVE (the ban is independent of validity, but
    // a clean refs report isolates the three bans): the cans/-qualified
    // form names a file inside a nested cans/ dir of the workspace.
    write(ws, 'cans/plugins/leaf.md', LEAF);
    write(ws, 'plugins/leaf.md', LEAF);
    write(ws, '_rules.yaml', 'references:\n  back_pointers: false\n  duplicate_home_check: false\n  forbidden_targets:\n    - source: "cans/[0-9]*.md"\n      pattern: "^plugins/"\n');

    const r = runCli(['check', '--json'], ws.root);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);

    const bans = forbidden(j);
    expect(bans).toHaveLength(3);
    // Sorted by line; each detail quotes the ref's WRITTEN spelling while
    // the match ran on the normalized form.
    expect(bans[0].line).toBe(2);
    expect(bans[0].detail).toBe(
      'forbidden target: 01-core.md:2 → cans/plugins/leaf.md — references.forbidden_targets[0] (source "cans/[0-9]*.md", pattern "^plugins/")',
    );
    expect(bans[1].line).toBe(3);
    expect(bans[1].detail).toBe(
      'forbidden target: 01-core.md:3 → ./plugins/leaf.md — references.forbidden_targets[0] (source "cans/[0-9]*.md", pattern "^plugins/")',
    );
    expect(bans[2].line).toBe(4);
    expect(bans[2].detail).toBe(
      'forbidden target: 01-core.md:4 → plugins/leaf.md — references.forbidden_targets[0] (source "cans/[0-9]*.md", pattern "^plugins/")',
    );
    expect(j.refs.broken).toBe(0); // all three spellings resolve
    expect(j.refs.total).toBe(3);
  });

  test('s12: aliasing cannot dodge a ban — see: [1] resolves first, the ban fires on the resolved target, detail ends via alias', () => {
    const ws = makeWs('alias-dodge');
    write(
      ws,
      '01-core.md',
      '- Core model\n  - wiring one: see: [1]\n  - wiring two: see: [1]\n- [1]: plugins/leaf.md\n',
    );
    write(ws, 'plugins/leaf.md', LEAF);
    write(ws, '_rules.yaml', 'references:\n  back_pointers: false\n  duplicate_home_check: false\n  aliasing:\n    enabled: true\n  forbidden_targets:\n    - source: "cans/[0-9]*.md"\n      pattern: "plugins/"\n');

    const r = runCli(['check', '--json'], ws.root);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);

    // Both USES are banned (the definition is spelling, not a ref): the
    // alias resolves to the full target first (contract 1), and each use
    // reports with the via-alias suffix naming the written spelling.
    const bans = forbidden(j);
    expect(bans).toHaveLength(2);
    expect(bans[0].line).toBe(2);
    expect(bans[0].detail).toBe(
      'forbidden target: 01-core.md:2 → plugins/leaf.md — references.forbidden_targets[0] (source "cans/[0-9]*.md", pattern "plugins/"), via alias "[1]"',
    );
    expect(bans[1].line).toBe(3);
    expect(bans[1].detail).toBe(
      'forbidden target: 01-core.md:3 → plugins/leaf.md — references.forbidden_targets[0] (source "cans/[0-9]*.md", pattern "plugins/"), via alias "[1]"',
    );
  });

  describe('s13: external roots — the ban names either the written name:// form or the bare root-relative sub-path', () => {
    /** The kelir scenario skeleton: a declared sibling root holding the
     *  plugin leaf, one spec file pointing into it. Returns the ws. */
    const makeExternal = (name: string, pattern: string): Ws => {
      const ws = makeWs(`external-${name}`);
      // The root resolves from the PROJECT root (the parent of cans/):
      // "kelir-cans" names a checkout beside the workspace dir.
      write(ws, '../kelir-cans/plugins/leaf.md', LEAF);
      write(ws, '00-overview.md', '- Overview hub\n  - terms index: see: 99-glossary.md\n');
      write(ws, '01-core.md', '- Core model\n  - plugin wiring: see: kelir://plugins/leaf.md\n');
      write(ws, '99-glossary.md', '- Glossary\n  - alpha term\n  - beta term\n');
      write(
        ws,
        '_rules.yaml',
        'references:\n  back_pointers: false\n  duplicate_home_check: false\n  external_roots:\n    kelir: "kelir-cans"\n  forbidden_targets:\n    - source: "cans/[0-9]*.md"\n'
          + `      pattern: "${pattern}"\n`,
      );
      return ws;
    };

    test('written form: ^kelir://plugins/ bans the pointer as spelled', () => {
      const ws = makeExternal('written', '^kelir://plugins/');
      const r = runCli(['check', '--json'], ws.root);
      expect(r.exit).toBe(2);
      const j = parseJsonOut(r.out);
      const bans = forbidden(j);
      expect(bans).toHaveLength(1);
      expect(bans[0].file).toBe('01-core.md');
      expect(bans[0].detail).toBe(
        'forbidden target: 01-core.md:2 → kelir://plugins/leaf.md — references.forbidden_targets[0] (source "cans/[0-9]*.md", pattern "^kelir://plugins/")',
      );
      // The external pointer itself resolves (terminal artifact target):
      // no broken ref beside the ban.
      expect(j.refs.broken).toBe(0);
    });

    test('bare sub-path: ^plugins/ bans the resolved root-relative form too', () => {
      const ws = makeExternal('bare', '^plugins/');
      const r = runCli(['check', '--json'], ws.root);
      expect(r.exit).toBe(2);
      const j = parseJsonOut(r.out);
      expect(forbidden(j)).toHaveLength(1);
      expect(j.refs.broken).toBe(0);
    });
  });

  test('s14: the kelir scoping need — except exempts the catalog and the overview index from a blanket numbered-files ban', () => {
    const ws = makeWs('except-scoping');
    for (const [file, title] of [
      ['00-overview.md', 'Overview index'],
      ['01-core.md', 'Core model'],
      ['02-plugin-model.md', 'Plugin catalog'],
      ['12-adapters.md', 'Adapter map'],
    ] as const) {
      write(ws, file, `- ${title}\n  - plugin wiring: see: plugins/leaf.md\n`);
    }
    write(ws, 'plugins/leaf.md', LEAF);
    write(
      ws,
      '_rules.yaml',
      'references:\n  back_pointers: false\n  duplicate_home_check: false\n  forbidden_targets:\n    - source: "cans/[0-9]*.md"\n      pattern: "plugins/"\n      except:\n        - "cans/00-overview.md"\n        - "cans/02-plugin-model.md"\n',
    );

    const r = runCli(['check', '--json'], ws.root);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);

    // Only the non-exempt numbered files report — the catalog (02) and the
    // index (00) keep their legitimate pointers, exactly the kelir need
    // the issue motivated, without subtract-globs.
    const bans = forbidden(j);
    expect(bans.map((f: any) => f.file)).toEqual(['01-core.md', '12-adapters.md']);
    expect(bans.every((f: any) => f.level === 'error')).toBe(true);
  });

  test('s15: source-glob scoping end-to-end — plugins/** bans refs FROM plugin files; [0-9]*.md does not treat a plugin file as a source', () => {
    const ws = makeWs('source-scoping');
    write(ws, '00-overview.md', '- Overview hub\n  - leaf link: see: plugins/leaf.md\n  - terms link: see: 99-glossary.md\n');
    write(ws, 'plugins/leaf.md', '- Leaf holder\n  - terms link: see: 99-glossary.md\n');
    write(ws, '99-glossary.md', '- Glossary\n  - alpha term\n  - beta term\n');
    // max_hops 3: the overview → leaf → glossary chain is legal here and
    // must not add deep-hop noise to the source-scoping assertions.
    write(
      ws,
      '_rules.yaml',
      'references:\n  back_pointers: false\n  duplicate_home_check: false\n  max_hops: 3\n  forbidden_targets:\n    - source: "plugins/**"\n      pattern: "glossary"\n    - source: "[0-9]*.md"\n      pattern: "glossary"\n',
    );

    const r = runCli(['check', '--json'], ws.root);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);

    // Rule 0 bans plugin-file refs to the glossary; rule 1 bans
    // numbered-file refs to it. The plugin file matches only rule 0's
    // source; the overview only rule 1's — once per matching rule, the
    // rule index spelled in each detail.
    const bans = forbidden(j);
    expect(bans).toHaveLength(2);
    expect(bans[0].file).toBe('00-overview.md');
    expect(bans[0].detail).toBe(
      'forbidden target: 00-overview.md:3 → 99-glossary.md — references.forbidden_targets[1] (source "[0-9]*.md", pattern "glossary")',
    );
    expect(bans[1].file).toBe('plugins/leaf.md');
    expect(bans[1].detail).toBe(
      'forbidden target: plugins/leaf.md:2 → 99-glossary.md — references.forbidden_targets[0] (source "plugins/**", pattern "glossary")',
    );
  });

  test('s16: graph citizenship — a banned ref still counts in refs.total, its deep hop still reports, its target is no orphan; an unlinked file still is one', () => {
    const ws = makeWs('graph-citizenship');
    // 00-overview points at a QUIET glossary, never down the chain: under
    // the default max_hops: 1 a 3-edge chain 00→01→02→06 fires TWO deep-hop
    // windows (00→01→02 for 01-a's ref and 01→02→06 for 02-b's — the issue
    // #5 per-intermediate-node semantics this engine has always pinned),
    // and this scenario pins ONLY the banned final edge's hop. The glossary
    // keeps refs.total at 3 and 00-overview out of orphan territory without
    // adding a second window.
    write(ws, '00-overview.md', '- Overview hub\n  - a link: see: 99-glossary.md\n');
    write(ws, '99-glossary.md', '- Glossary\n  - alpha term\n  - beta term\n');
    write(ws, '01-a.md', '- A spec\n  - b link: see: 02-b.md\n');
    write(ws, '02-b.md', '- B spec\n  - c link: see: 06-c.md\n');
    write(ws, '06-c.md', '- C leaf\n  - gamma shape\n');
    write(ws, '07-lonely.md', '- Lonely spec\n  - isolated note\n');
    write(ws, '_rules.yaml', 'references:\n  back_pointers: false\n  duplicate_home_check: false\n  forbidden_targets:\n    - source: "cans/[0-9]*.md"\n      pattern: "06-c"\n');

    const r = runCli(['check', '--json'], ws.root);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);

    // The banned final edge (02-b → 06-c) still reports its deep hop —
    // banning a ref must not hide its other consequences (contract 6).
    const hops = byRule(j, 'refs.deep_hop');
    expect(hops).toHaveLength(1);
    expect(hops[0].detail).toBe('DEEP HOP: 01-a.md → 02-b.md → 06-c.md');
    expect(forbidden(j)).toHaveLength(1);
    expect(forbidden(j)[0].file).toBe('02-b.md');

    // The banned ref still counts as incoming for 06-c: it is NOT an
    // orphan. The genuinely unlinked 07-lonely.md still is.
    const orphans = byRule(j, 'refs.orphan');
    expect(orphans.map((f: any) => f.file)).toEqual(['07-lonely.md']);
    // And all three refs — banned one included — count in refs.total.
    expect(j.refs.total).toBe(3);
    expect(j.refs.broken).toBe(0);
  });

  test('s17: no auto-fix — --fix neither removes nor rewrites the forbidden ref; the finding stays in the report and the see: line stays on disk', () => {
    const ws = makeWs('no-autofix');
    write(ws, '01-core.md', '- Core model\n  - plugin wiring: see: plugins/leaf.md\n');
    write(ws, 'plugins/leaf.md', LEAF);
    write(ws, '_rules.yaml', 'references:\n  back_pointers: false\n  duplicate_home_check: false\n  forbidden_targets:\n    - source: "cans/[0-9]*.md"\n      pattern: "plugins/"\n');

    const r = runCli(['check', '--fix', '--json'], ws.root);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(forbidden(j)).toHaveLength(1);
    expect(j.backPointersUpdated).toBe(0); // nothing was rewritten

    // The referrer is byte-identical: a layering violation is an author
    // decision, not a machine-fixable token.
    const after = readFileSync(join(ws.cans, '01-core.md'), 'utf8');
    expect(after).toBe('- Core model\n  - plugin wiring: see: plugins/leaf.md\n');
  });
});
