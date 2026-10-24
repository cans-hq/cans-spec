/**
 * QA round-3 red tests — §26 budget + subfolder leaf content (findings from
 * QA-14/QA-13, npm cans-spec@0.1.0; §16 overflow references updated by issue #56).
 *
 * Each test asserts the DOCUMENTED contract (docs/cans.architecture.md, § citations
 * inline) that the implementation currently violates, and therefore FAILS (red) as
 * an assertion failure, confirming the mapped round-3 QA finding.
 * No assertions encode current buggy behavior; no failure-swallowing; no skips.
 *
 * Mapping (test → finding):
 *   R3-B1 ....... QA-14 F6 — §26 `budget read <concept> --change <name>` centers the
 *                  plan on a task file; a task file that does not exist is a
 *                  user-correctable failure (§19 exit 1) and must be named (§37).
 *                  Actual: the unknown --change is silently ignored and a plain plan
 *                  is returned, ok:true, exit 0.
 *   R3-B2 ....... CONTROL (green at HEAD) + npm-only residual note — the
 *                  §12 deep-hop table: a REFERENCED subfolder .md is promoted
 *                  to a first-class spec file (issue #54) and its see: is the
 *                  documented §5 deep hop — pinned here. The QA-13 F3 residual
 *                  (npm 0.1.0: nothing flagged, exit 0) must never reproduce
 *                  in that shape. Issue #56 removed the §16 overflow engine
 *                  AND its no-chaining rule: an UNREFERENCED subfolder .md is
 *                  now plain non-spec content (invisible to every engine),
 *                  pinned here as well.
 *
 * Both workspaces use a FULL §18 rules file (defaults, orphan_check relaxed):
 * full-file overrides behave correctly at HEAD (QA-13), so a red here can only be
 * the mapped finding — not the partial-merge bug (R3-R1a family, rules-config file).
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

import { spawnCli, REPO } from '../runtime.ts';

const SCRATCH = join(REPO, '.tmp', 'qa-round3', 'budget-subfolder');

interface Ws { root: string; cans: string }

const createdDirs: string[] = [];
let wsSeq = 0;

function makeWs(name: string): Ws {
  const root = join(SCRATCH, `${name}-${++wsSeq}`);
  mkdirSync(join(root, 'cans'), { recursive: true });
  createdDirs.push(root);
  return { root, cans: join(root, 'cans') };
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
  // issue #41: the check --json wire shape moved to sections.{category}[]
  // entries ({file,line,level,rule,detail,suggestion?}). Reconstitute the flat
  // issues view (category + message) so assertions stay readable/unchanged.
  const j = parsed as Record<string, unknown> | null;
  if (j !== null && typeof j === 'object' && (j as any).sections !== undefined && (j as any).issues === undefined) {
    (j as any).issues = Object.entries((j as any).sections as Record<string, any[]>).flatMap(([category, arr]) =>
      arr.map((i) => ({ ...i, category, message: i.detail })),
    );
  }
  return parsed;
}

const FULL_RULES = [
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
  '  orphan_check: false',
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
  '',
].join('\n');

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('QA round-3 red verification: §26 budget + subfolder leaf content (QA-14 F6, QA-13 F3)', () => {
  test('R3-B1 (§26/§19/§37 / QA-14 F6): budget read --change <unknown> names the missing task file and exits 1', () => {
    const ws = makeWs('r3-b1-change-unknown');
    writeFileSync(join(ws.cans, '_rules.yaml'), FULL_RULES);
    writeFileSync(join(ws.cans, '02-authentication.md'), [
      '- Authentication',
      '  - Sessions',
      '    - Expire after 24 hours',
      '    - Refresh allowed for 30 days',
      '  - Sign up',
      '    - Email',
      '    - Google',
      '',
    ].join('\n'));
    writeFileSync(join(ws.cans, '04-api.md'), [
      '- API',
      '  - Authentication',
      '    - Session rules: see 02-authentication.md#Sessions',
      '  - POST /users',
      '    - Returns 201',
      '',
    ].join('\n'));
    const r = runCli(['budget', 'read', 'sessions', '--change', 'nope', '--json'], ws.root);
    const parsed = parseJsonOut(r.out);
    // §19: user-correctable failure → exit 1; §37: name the real cause.
    expect(parsed.ok).toBe(false);
    expect(r.exit).toBe(1);
    expect(`${r.out}\n${r.err}`).toContain('nope');
  });

  test('control (green at HEAD; QA-13 F3 npm-only residual): a REFERENCED subfolder .md is promoted (issue #54) and its see: is the documented §5 deep hop; an UNREFERENCED one is invisible non-spec content (issue #56)', () => {
    // 04-api.md references 04-api/request-schema.md, which references
    // 03-data.md. Issue #54: pointerizing a subfolder .md promotes it to a
    // first-class spec file — its outgoing `see:` is an ordinary graph edge,
    // so under max_hops: 1 the shape is the documented §5 DEEP HOP
    // (04-api.md → 04-api/request-schema.md → 03-data.md). (QA-13 F3,
    // npm 0.1.0: nothing flagged, exit 0 — the regression guard stays:
    // the promoted shape must always flag.)
    const ws = makeWs('r3-b2-overflow-chain');
    writeFileSync(join(ws.cans, '_rules.yaml'), FULL_RULES);
    writeFileSync(join(ws.cans, '04-api.md'), [
      '- API',
      '  - POST /users',
      '    - Returns 201 on success',
      '    - Request schema: see 04-api/request-schema.md',
      '  - Health check',
      '    - Returns 200',
      '',
    ].join('\n'));
    mkdirSync(join(ws.cans, '04-api'), { recursive: true });
    writeFileSync(join(ws.cans, '04-api', 'request-schema.md'), [
      '- Request schema',
      '  - Email and password required',
      '  - Field rules: see 03-data.md',
      '',
    ].join('\n'));
    writeFileSync(join(ws.cans, '03-data.md'), [
      '- Data',
      '  - Postgres primary store',
      '  - Nightly backups',
      '',
    ].join('\n'));

    const r = runCli(['check', '--json'], ws.root);
    const parsed = parseJsonOut(r.out);
    // Promoted shape: the referenced target's outgoing ref is a §5 deep hop
    // (error class, exit 2) — issue #54's documented semantics.
    expect(r.exit).toBe(2);
    expect(parsed.issues.some((i: any) => i.rule === 'refs.deep_hop' && /request-schema/.test(i.file))).toBe(true);
    expect(parsed.issues.some((i: any) => i.rule === 'refs.chaining')).toBe(false);

    // Issue #56 shape: an UNREFERENCED subfolder .md carrying an outgoing
    // see: is plain non-spec content — invisible to every engine (the §16
    // no-chaining rule was retired with the overflow engine). Adding it
    // changes nothing about the report.
    writeFileSync(join(ws.cans, '04-api', 'legacy-notes.md'), [
      '- Legacy notes',
      '  - Old field rules: see 03-data.md',
      '',
    ].join('\n'));
    const r2 = runCli(['check', '--json'], ws.root);
    const parsed2 = parseJsonOut(r2.out);
    expect(r2.exit).toBe(2);
    expect(parsed2.summary.files).toBe(parsed.summary.files); // unchanged
    expect(parsed2.issues.some((i: any) => i.rule === 'refs.chaining')).toBe(false);
    expect(parsed2.issues.some((i: any) => /legacy-notes/.test(i.file))).toBe(false);
    // the promoted shape's finding is untouched by the dead leaf
    expect(parsed2.issues.some((i: any) => i.rule === 'refs.deep_hop' && /request-schema/.test(i.file))).toBe(true);
  });
});
