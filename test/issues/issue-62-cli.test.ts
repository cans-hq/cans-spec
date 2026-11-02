/**
 * Issue #62 — `references.forbidden_targets`: per-source bans on pointer
 * targets (the layering guard), CLI blackbox contract.
 *
 * A rule is `{ source, pattern, severity?, message?, except? }`:
 *   - `source` (required): a glob over the referrer's workspace-relative
 *     path — a single leading `cans/` segment is stripped on BOTH sides
 *     (`cans/[0-9]*.md` ≡ `[0-9]*.md`); `*` stays inside one segment,
 *     `**` crosses segments, `?` is one char, `[...]` a class,
 *     case-sensitive.
 *   - `pattern` (required): a JavaScript regex with SEARCH semantics over
 *     the alias-expanded target's file part, normalized (leading `cans/`
 *     and `./` stripped, `//` collapsed, trailing `/` trimmed, anchor
 *     stripped); an external `name://sub/path` target offers BOTH the
 *     written form and the bare `sub/path`.
 *   - `severity` (optional, default `error`), `message` (reported
 *     verbatim), `except` (globs exempting source files from this rule).
 *
 * The pinned finding shape (in `sections.refs` of `--json`):
 *   rule  `refs.forbidden_target`, file = referrer path, line = the
 *   `see:` line, and — unless a custom `message` replaces it byte-for-byte
 *   — detail EXACTLY
 *     `forbidden target: <file>:<line> → <target> — references.forbidden_targets[<i>] (source "<source>", pattern "<pattern>")`
 *   with `, via alias "[<name>]"` appended after the closing paren when
 *   the ref was an alias use. Suggestion EXACTLY
 *     `remove the see: pointer — or, if this target is legitimate, rescope references.forbidden_targets[<i>] (source/except)`
 *
 * Severity: `error` (and the default when omitted) → level 'error',
 * exit 2, ok:false. `warning` → level 'warning', exit 1, ok:true. `warn`
 * (the pre-#62 spelling) is NOT a member value: line-numbered config
 * error (exit 2, sections.config[0].rule === 'config.invalid').
 *
 * Config rejections (all exit 2 + sections.config, the issue #43/#56
 * envelope): missing `source`; missing `pattern`; unknown member (e.g.
 * `severety`); a `pattern` that is not a valid regex (`"(`); a non-list
 * `forbidden_targets` value.
 *
 * Gates: `--refs-only` INCLUDES the findings; `--structure` and
 * `--structure=strict` SUPPRESS all refs findings. Backwards compatible:
 * without the key the workspace checks exactly as before (feature off).
 *
 * These are contract-first tests on the integration branch: until the
 * four-way merge lands the config and engine halves of #62, every rules
 * file carrying the key rejects as a config error — so the tests below
 * fail with CLEAN assertion failures (missing finding / wrong exit
 * code), never crashes. The block-shaped list-of-maps spelling
 * (`- source: "…"` with the further members indented under the dash) is
 * the pinned YAML form.
 *
 * Test map (scenarios 1–8 of the #62 QA plan):
 *   s1+2 ..... the issue's repro — severity OMITTED pins the error
 *              default: exit 2, ok:false, exactly ONE sections.refs
 *              entry, rule/level/file/line right, detail + suggestion
 *              byte-exact, and the human (non-json) run carries the
 *              message.
 *   s3 ....... severity: warning → exit 1, ok:true, level 'warning'.
 *   s4 ....... severity: warn → line-numbered config error.
 *   s5 ....... custom message → detail equals it byte-for-byte (and the
 *              human run carries the custom message).
 *   s6a–e .... config rejections: missing source / missing pattern /
 *              unknown member severety / invalid regex "(" / non-list
 *              value {a: b}.
 *   s7 ....... gates: --refs-only includes; --structure and
 *              --structure=strict suppress (sections.refs empty).
 *   s8 ....... backwards compat: same workspace, rules file WITHOUT the
 *              key → exit 0, ok:true, no refs findings. (Green already:
 *              the feature is additive and off by default.)
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

import { spawnCli, REPO } from '../runtime.ts';

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-62-cli');

interface Ws { root: string; cans: string }

const createdDirs: string[] = [];
let wsSeq = 0;

/** Fresh scratch workspace under repo/.tmp/issues/issue-62-cli (gitignored). */
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

// ── the issue's repro workspace ─────────────────────────────────────────────

/** The issue's shape: an overview hub, a core spec that reaches into the
 * plugin layer (`see: plugins/leaf.md`, line 3), the plugin leaf, and a
 * glossary both numbered files may point at. Everything except the banned
 * ref is deliberately quiet: no structure/style/redundancy/orphan/deep-hop
 * findings, so the forbidden-target finding is the whole report. */
function makeRepro(name: string): Ws {
  const ws = makeWs(name);
  writeFileSync(join(ws.cans, '00-overview.md'), '- Overview hub\n  - terms index: see: 99-glossary.md\n  - status marker\n');
  writeFileSync(join(ws.cans, '01-core.md'), '- Core model\n  - glossary link: see: 99-glossary.md\n  - plugin wiring: see: plugins/leaf.md\n');
  writeFileSync(join(ws.cans, '99-glossary.md'), '- Glossary\n  - alpha term\n  - beta term\n');
  mkdirSync(join(ws.cans, 'plugins'), { recursive: true });
  writeFileSync(join(ws.cans, 'plugins', 'leaf.md'), '- Leaf holder\n  - gamma shape\n  - delta rate\n');
  return ws;
}

/** `_rules.yaml` with the quieting keys every scenario shares (back-pointer
 * rewriting and duplicate-home reporting off, so refs findings are the
 * whole refs story) plus one forbidden_targets rule — the extra lines
 * appended under `forbidden_targets:`, block-shaped. */
function writeRules(ws: Ws, rule: string[]): void {
  writeFileSync(
    join(ws.cans, '_rules.yaml'),
    ['references:', '  back_pointers: false', '  duplicate_home_check: false', '  forbidden_targets:', ...rule, ''].join('\n'),
  );
}

/** The repro's rule — the issue's layering ban: numbered files must not
 * reach into the plugin layer. Severity omitted (the default under test),
 * `cans/`-qualified source glob (stripped on both sides). */
const ISSUE_RULE = ['    - source: "cans/[0-9]*.md"', '      pattern: "plugins/"'];

/** The pinned default detail for the repro's finding. */
const REPRO_DETAIL =
  'forbidden target: 01-core.md:3 → plugins/leaf.md — references.forbidden_targets[0] (source "cans/[0-9]*.md", pattern "plugins/")';

/** The pinned suggestion, with the rule index. */
const suggestionFor = (i: number): string =>
  `remove the see: pointer — or, if this target is legitimate, rescope references.forbidden_targets[${i}] (source/except)`;

/** All refs.forbidden_target findings, in report order. */
function forbidden(j: any): any[] {
  return j.sections.refs.filter((f: any) => f.rule === 'refs.forbidden_target');
}

/** The issue #43/#56 config-error envelope for a rejected _rules.yaml:
 * exit 2, one config.invalid entry, never a refs finding, engines never
 * ran. The detail is line-numbered; its exact wording belongs to the
 * config side, so only the prefix is pinned here. */
function expectConfigError62(r: { exit: number | null; out: string; err: string }): void {
  expect(r.exit).toBe(2);
  const j = parseJsonOut(r.out);
  expect(j.ok).toBe(false);
  expect(typeof j.error).toBe('string');
  expect(j.error).toStartWith('invalid _rules.yaml: line');
  expect(j.sections.config).toHaveLength(1);
  expect(j.sections.config[0].rule).toBe('config.invalid');
  expect(j.sections.config[0].detail).toStartWith('invalid _rules.yaml: line');
  expect(j.sections.refs).toEqual([]);
  expect(j.summary.files).toBe(0); // the engines never ran
}

describe('issue #62 CLI — references.forbidden_targets', () => {
  test('s1+2: the issue repro (severity omitted → error default) — exit 2, ok:false, one exact refs.forbidden_target finding; human output carries the message', () => {
    const ws = makeRepro('repro');
    writeRules(ws, ISSUE_RULE);

    const r = runCli(['check', '--json'], ws.root);
    expect(r.exit).toBe(2); // error level fails the run (issue #41 exit classes)
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(false);
    expect(j.sections.refs).toHaveLength(1); // the ban is the whole refs report — no orphan/deep-hop noise

    const f = j.sections.refs[0];
    expect(f.file).toBe('01-core.md'); // the referrer
    expect(f.line).toBe(3); // the see: line
    expect(f.level).toBe('error'); // severity omitted → the default is error
    expect(f.rule).toBe('refs.forbidden_target');
    expect(f.detail).toBe(REPRO_DETAIL);
    expect(f.suggestion).toBe(suggestionFor(0));

    // Human (non-json) output contains the message.
    const human = runCli(['check'], ws.root);
    expect(human.exit).toBe(2);
    expect(human.out).toContain(REPRO_DETAIL);
  });

  test('s3: severity: warning → exit 1, ok:true, level warning, same detail/suggestion', () => {
    const ws = makeRepro('severity-warning');
    writeRules(ws, [...ISSUE_RULE, '      severity: warning']);

    const r = runCli(['check', '--json'], ws.root);
    expect(r.exit).toBe(1); // warning does not fail the run
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect(forbidden(j)).toHaveLength(1);
    const f = forbidden(j)[0];
    expect(f.file).toBe('01-core.md');
    expect(f.line).toBe(3);
    expect(f.level).toBe('warning');
    expect(f.detail).toBe(REPRO_DETAIL);
    expect(f.suggestion).toBe(suggestionFor(0));
  });

  test('s4: severity: warn (the pre-#62 spelling) → line-numbered config error, never a finding', () => {
    const ws = makeRepro('severity-warn');
    writeRules(ws, [...ISSUE_RULE, '      severity: warn']);

    const r = runCli(['check', '--json'], ws.root);
    expectConfigError62(r);
  });

  test('s5: custom message → detail equals it byte-for-byte; suggestion unchanged; human output carries it', () => {
    const message = 'core spec must not reach into the plugin layer (01-core.md:3 → plugins/leaf.md)';
    const ws = makeRepro('custom-message');
    writeRules(ws, ['    - source: "cans/01-core.md"', '      pattern: "plugins/"', `      message: "${message}"`]);

    const r = runCli(['check', '--json'], ws.root);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(false);
    expect(forbidden(j)).toHaveLength(1);
    const f = forbidden(j)[0];
    expect(f.detail).toBe(message); // byte-for-byte, no decoration
    expect(f.suggestion).toBe(suggestionFor(0)); // the suggestion is its own member
    expect(f.level).toBe('error');
    expect(f.file).toBe('01-core.md');
    expect(f.line).toBe(3);

    const human = runCli(['check'], ws.root);
    expect(human.out).toContain(message);
  });

  describe('s6: config rejections — every malformed rule is a line-numbered config error (exit 2 + sections.config)', () => {
    test('missing source', () => {
      const ws = makeRepro('no-source');
      writeRules(ws, ['    - pattern: "plugins/"']);
      expectConfigError62(runCli(['check', '--json'], ws.root));
    });

    test('missing pattern', () => {
      const ws = makeRepro('no-pattern');
      writeRules(ws, ['    - source: "cans/[0-9]*.md"']);
      expectConfigError62(runCli(['check', '--json'], ws.root));
    });

    test('unknown member severety (typo never means silently off)', () => {
      const ws = makeRepro('unknown-member');
      writeRules(ws, [...ISSUE_RULE, '      severety: error']);
      expectConfigError62(runCli(['check', '--json'], ws.root));
    });

    test('invalid regex pattern "("', () => {
      const ws = makeRepro('bad-regex');
      writeRules(ws, ['    - source: "cans/[0-9]*.md"', '      pattern: "("']);
      expectConfigError62(runCli(['check', '--json'], ws.root));
    });

    test('non-list value forbidden_targets: {a: b}', () => {
      const ws = makeRepro('non-list');
      writeFileSync(
        join(ws.cans, '_rules.yaml'),
        ['references:', '  back_pointers: false', '  duplicate_home_check: false', '  forbidden_targets: {a: b}', ''].join('\n'),
      );
      expectConfigError62(runCli(['check', '--json'], ws.root));
    });
  });

  test('s7: gates — --refs-only INCLUDES the finding; --structure and --structure=strict SUPPRESS all refs findings', () => {
    const ws = makeRepro('gates');
    writeRules(ws, ISSUE_RULE);

    // --refs-only: the refs report is exactly the ban.
    const refsOnly = runCli(['check', '--refs-only', '--json'], ws.root);
    expect(refsOnly.exit).toBe(2);
    const jro = parseJsonOut(refsOnly.out);
    expect(jro.ok).toBe(false);
    expect(forbidden(jro)).toHaveLength(1);
    expect(forbidden(jro)[0].detail).toBe(REPRO_DETAIL);

    // --structure: no refs findings at all — the ban cannot fail a
    // structure-only run (the workspace is otherwise clean, so exit 0).
    const structure = runCli(['check', '--structure', '--json'], ws.root);
    expect(structure.exit).toBe(0);
    const jst = parseJsonOut(structure.out);
    expect(jst.ok).toBe(true);
    expect(jst.sections.refs).toEqual([]);

    // --structure=strict: same suppression.
    const strict = runCli(['check', '--structure=strict', '--json'], ws.root);
    expect(strict.exit).toBe(0);
    const jsc = parseJsonOut(strict.out);
    expect(jsc.ok).toBe(true);
    expect(jsc.sections.refs).toEqual([]);
  });

  test('s8: backwards compat — same workspace, rules file WITHOUT the key → exit 0, ok:true, no refs findings', () => {
    const ws = makeRepro('backcompat');
    writeFileSync(
      join(ws.cans, '_rules.yaml'),
      ['references:', '  back_pointers: false', '  duplicate_home_check: false', ''].join('\n'),
    );

    const r = runCli(['check', '--json'], ws.root);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect(j.sections.refs).toEqual([]);
    expect(j.refs.total).toBe(3); // all three see: pointers still counted, none banned
  });
});
