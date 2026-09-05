/**
 * QA round-2 red tests — §18 rules engine & redundancy configuration (Task 5-a).
 *
 * Each non-control test asserts the DOCUMENTED contract (docs/cans.architecture.md,
 * § citations inline) that the implementation currently violates, and therefore
 * FAILS (red) as an assertion failure, confirming the mapped round-2 QA finding.
 * No assertions encode current buggy behavior; no failure-swallowing; no skips;
 * no `||` cop-outs.
 *
 * Mapping (test → finding):
 *   R1a .......... QA-09 E8 / QA-03 F1 family — §18 "Delete a key = check turns off":
 *                  deleting `structure.node_length` must disable the node-length check;
 *                  instead the deleted key silently reverts to the 120 default.
 *   R1b .......... QA-03 F1 family — same §18 contract at section level: deleting the
 *                  whole `structure:` section must disable all structure checks.
 *   R2a .......... QA-09 B9 — §18 rules key `references.back_pointers: false` is
 *                  ignored by `check --fix`: ref-by comments are written anyway.
 *   R2b .......... QA-03 F1 family — deleting the `back_pointers` key must likewise
 *                  turn back-pointer writing off; it is ignored as well.
 *   control-E7 ... CONTROL (green): §18 partial override still applies (QA-09 E7 PASS) —
 *                  also proves the node-length engine itself fires, so R1a/R1b cannot
 *                  pass vacuously.
 *   control-syn .. CONTROL (green) documenting QA-03 #13 + QA-07 NEW-3 as
 *                  NOT-REPRODUCIBLE at this HEAD: user-configured
 *                  `redundancy.synonyms` (§18 template syntax) DO merge and DO
 *                  suppress the fuzzy typo warning, exactly as §13 documents.
 *   control-fix .. CONTROL (green, QA-07 B2): with default rules `check --fix` DOES
 *                  write ref-by comments — proves the fix mechanism works, so R2a/R2b
 *                  red can only be caused by the rules key being ignored.
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { join } from 'path';
import {
  mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'fs';

const REPO = join(import.meta.dir, '..', '..');
const CLI = join(REPO, 'src', 'cli.ts');
const SCRATCH = join(REPO, '.tmp', 'qa-round2', 'rules-config');

interface Ws { root: string; cans: string }

const createdDirs: string[] = [];
let wsSeq = 0;

/** Fresh scratch workspace under repo/.tmp/qa-round2/rules-config (gitignored). */
function makeWs(name: string): Ws {
  const root = join(SCRATCH, `${name}-${++wsSeq}`);
  mkdirSync(join(root, 'cans'), { recursive: true });
  createdDirs.push(root);
  return { root, cans: join(root, 'cans') };
}

/** Blackbox CLI spawn — primary verification method. */
function runCli(args: string[], cwd: string) {
  const p = Bun.spawnSync(['bun', 'run', CLI, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    // Isolate from any ambient CANS_ROOT other suites might leave behind ('' is falsy → ignored).
    env: { ...process.env, CANS_ROOT: '' },
  });
  return { exit: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
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

/** Recursive snapshot of every file under `dir`, keyed by workspace-relative path. */
function snapshotFiles(dir: string, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix !== '' ? `${prefix}/${entry.name}` : entry.name;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(out, snapshotFiles(full, rel));
    else out[rel] = readFileSync(full, 'utf-8');
  }
  return out;
}

/** Exactly 130 chars — 10 over the documented default `node_length.max` of 120 (§18). */
const LONG_NODE =
  'Quarterly platform consolidation wraps up next cycle pending vendor signature and budget confirmation from the finance group staff';

/** Workspace with one spec file whose only possible defect is the 130-char node:
 *  two roots × two children (no single-child collapse), no refs (orphan check
 *  explicitly disabled), no code fences/tables, redundancy explicitly disabled. */
function lengthWs(name: string, rulesYaml: string): Ws {
  const ws = makeWs(name);
  writeFileSync(join(ws.cans, '01-spec.md'), [
    '- Overview',
    '  - Alpha squad handles intake and triage',
    '  - Bravo squad handles scheduling escalations',
    '- Details',
    `  - ${LONG_NODE}`,
    '  - Rollout timing depends on vendor readiness',
    '',
  ].join('\n'));
  writeFileSync(join(ws.cans, '_rules.yaml'), rulesYaml);
  return ws;
}

/** Workspace where 04-api.md points at 02-authentication.md#Sessions (§12) and the
 *  target has NO `<!-- ref-by: ... -->` comment yet. */
function refPairWs(name: string, rulesYaml: string | null): Ws {
  const ws = makeWs(name);
  writeFileSync(join(ws.cans, '02-authentication.md'), [
    '- Authentication',
    '  - Sessions',
    '    - Token expires after 24 hours',
    '  - Login flow',
    '    - Uses email and password',
    '',
  ].join('\n'));
  writeFileSync(join(ws.cans, '04-api.md'), [
    '- API',
    '  - Endpoints',
    '    - Sessions: see 02-authentication.md#Sessions',
    '  - Errors',
    '    - Standard error codes',
    '',
  ].join('\n'));
  if (rulesYaml !== null) writeFileSync(join(ws.cans, '_rules.yaml'), rulesYaml);
  return ws;
}

/** Workspace where "flavour" and "flavor" each appear in 3 nodes (§13 fuzzy layer
 *  fires `possible typo: "flavour" ↔ "flavor"` when they are NOT synonym-matched —
 *  verified: without the rules file the typo warning fires). Word shapes chosen to
 *  avoid stopword, fuzzy (Levenshtein ≤ 2) and phrase-overlap noise. */
function synonymWs(name: string): Ws {
  const ws = makeWs(name);
  writeFileSync(join(ws.cans, '01-product.md'), [
    '- Goods',
    '  - UK customers prefer the flavour of vanilla beans',
    '  - Australia stock uses flavour echoes from local honey',
    '  - Tasting notes describe flavour as rich and rounded',
    '- Catalog',
    '  - US catalog lists every flavor variant available',
    '  - Marketing copy should mention flavor sparingly',
    '  - Ice cream products highlight flavor during summer',
    '',
  ].join('\n'));
  writeFileSync(join(ws.cans, '_rules.yaml'), [
    'references:',
    '  orphan_check: false',
    'redundancy:',
    '  enabled: true',
    '  word_frequency_threshold: 4',
    '  phrase_overlap_threshold: 0.7',
    '  cross_file_threshold: 2',
    '  stopwords: [the, a, an, of, to, in, for, and, or, with, must, shall, requires]',
    '  synonyms:',
    '    - [flavour, flavor]',
    '',
  ].join('\n'));
  return ws;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('QA round-2 red verification: §18 rules engine & redundancy config', () => {
  test('R1a (§18 / QA-09 E8, QA-03 F1 family): deleting `structure.node_length` from _rules.yaml turns the node-length check OFF — a 130-char node is unflagged, exit 0', () => {
    // §18: "Partial file = only listed keys override. Delete a key = check turns off."
    // The rules file lists the remaining structure keys but OMITS `node_length:` —
    // documented behavior: no node-length error at all (130 chars is fine), exit 0.
    // Actual (QA-09 E8): the deleted key silently reverts to the default max 120.
    expect(LONG_NODE.length).toBe(130); // fixture pin: exactly 10 over the default
    const ws = lengthWs('r1a-delete-node-length', [
      'structure:',
      '  siblings: { min: 1, max: 12 }',
      '  depth: { min: 1, max: 5 }',
      '  single_child_collapse: true',
      '  empty_nodes: false',
      'references:',
      '  mode: pointer',
      '  back_pointers: true',
      '  max_hops: 1',
      '  orphan_check: false',
      '  duplicate_home_check: true',
      'redundancy:',
      '  enabled: false',
      'overflow:',
      '  max_node_chars: 200',
      '',
    ].join('\n'));

    const r = runCli(['check', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    // §18 delete-key contract: the node-length check is OFF → zero errors, exit 0 (§19).
    expect(r.exit).toBe(0);
    expect(j.exitCode).toBe(0);
    expect(j.errorCount).toBe(0);
    const nodeLengthIssues = j.issues.filter((i: any) => i.message.includes('Node too long'));
    expect(nodeLengthIssues).toEqual([]);
  });

  test('R1b (§18 / QA-03 F1 family): deleting the whole `structure:` section turns structure checks OFF — a 130-char node is unflagged, exit 0', () => {
    // §18: "Delete a key = check turns off." A top-level section is a key: with
    // `structure:` absent, every structure check (node_length included) is off.
    expect(LONG_NODE.length).toBe(130); // fixture pin
    const ws = lengthWs('r1b-delete-structure-section', [
      'references:',
      '  mode: pointer',
      '  back_pointers: true',
      '  max_hops: 1',
      '  orphan_check: false',
      '  duplicate_home_check: true',
      'redundancy:',
      '  enabled: false',
      'overflow:',
      '  max_node_chars: 200',
      '',
    ].join('\n'));

    const r = runCli(['check', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(0);
    expect(j.exitCode).toBe(0);
    expect(j.errorCount).toBe(0);
    const nodeLengthIssues = j.issues.filter((i: any) => i.message.includes('Node too long'));
    expect(nodeLengthIssues).toEqual([]);
  });

  test('R2a (§18 / QA-09 B9): `references.back_pointers: false` must disable ref-by writes in `check --fix` — backPointersUpdated 0, no file touched', () => {
    // §18 documents `back_pointers: true` as the rules default; false turns the
    // back-pointer check off. §17: only --fix writes, back-pointers only — with the
    // check off, --fix must write NOTHING (QA-09 B9: it writes the comment anyway).
    const ws = refPairWs('r2a-back-pointers-false', [
      'references:',
      '  mode: pointer',
      '  back_pointers: false',
      '  max_hops: 1',
      '  orphan_check: true',
      '  duplicate_home_check: true',
      '',
    ].join('\n'));
    const before = snapshotFiles(ws.cans);

    const r = runCli(['check', '--fix', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(0);
    expect(j.backPointersUpdated).toBe(0);
    const after = snapshotFiles(ws.cans);
    expect(after).toEqual(before); // byte-identical: no `<!-- ref-by -->` inserted anywhere
    expect(after['02-authentication.md']).not.toContain('ref-by');
  });

  test('R2b (§18 / QA-03 F1 family): DELETING the `back_pointers` key from `references:` must disable ref-by writes in `check --fix` — backPointersUpdated 0, no file touched', () => {
    // §18: "Delete a key = check turns off." The `back_pointers` key is deleted from
    // an otherwise-complete `references:` section → the back-pointer check is off →
    // --fix must not write. Actual: the deletion is ignored and defaults restored.
    const ws = refPairWs('r2b-delete-back-pointers-key', [
      'references:',
      '  mode: pointer',
      '  max_hops: 1',
      '  orphan_check: true',
      '  duplicate_home_check: true',
      '',
    ].join('\n'));
    const before = snapshotFiles(ws.cans);

    const r = runCli(['check', '--fix', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(0);
    expect(j.backPointersUpdated).toBe(0);
    const after = snapshotFiles(ws.cans);
    expect(after).toEqual(before);
    expect(after['02-authentication.md']).not.toContain('ref-by');
  });

  test('CONTROL (§18 / QA-09 E7): an explicit `node_length: { min: 3, max: 60 }` override still applies — 130-char node flagged, exit 1', () => {
    // CONTROL, marked as such: partial override is the WORKING half of the same §18
    // loading contract (QA-09 E7 recorded PASS). It also proves the node-length
    // engine itself fires on this fixture, so R1a/R1b cannot pass vacuously.
    expect(LONG_NODE.length).toBe(130); // fixture pin
    const ws = lengthWs('control-e7-partial-override', [
      'structure:',
      '  node_length: { min: 3, max: 60 }',
      '',
    ].join('\n'));

    const r = runCli(['check', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(1);
    const flagged = j.issues.filter((i: any) => i.message.includes('Node too long (130 > 60)'));
    expect(flagged.length).toBe(1);
  });

  test('CONTROL (§13 L1/L3, §18 / QA-03 #13 + QA-07 NEW-3 NOT-REPRODUCIBLE): user-configured synonyms via the §18 template syntax merge word-frequency and suppress the fuzzy typo warning', () => {
    // CONTROL, marked as such — this test is GREEN at HEAD on purpose.
    // QA-07 NEW-3 claimed "ALL user-configured redundancy.synonyms (any supported
    // syntax) are inert". Blackbox repro at this HEAD disproves it for every
    // documented syntax (template block-of-inline-arrays, top-level inline
    // [[a, b]], inline object): the declared group merges and the typo warning is
    // suppressed. §13 L3: fuzzy layer skips "already synonym-matched" words; §13 L1
    // normalization "expand synonyms" counts the group as one concept (6 nodes).
    // Undocumented syntaxes fail loudly per §18 (nested block arrays, `-[a, b]`
    // without space) — no silent degradation, so no red surface remains here.
    const ws = synonymWs('control-user-synonyms');

    const r = runCli(['check', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(0);
    // §13 L3: declared synonyms are "already synonym-matched" → no possible-typo pair.
    const typoIssues = j.issues.filter(
      (i: any) => i.message.includes('possible typo') && /flavou?r/.test(i.message),
    );
    expect(typoIssues).toEqual([]);
    // §13 L1: the group merges — "flavour" × 6 nodes (3 flavour + 3 flavor ≥ 4).
    const merged = j.issues.filter(
      (i: any) => /"flavour" × 6 nodes \(threshold: 4\)/.test(i.message),
    );
    expect(merged.length).toBe(1);
  });

  test('CONTROL (§17, §18 default / QA-07 B2): with default rules `check --fix` DOES write the missing ref-by comment — the fix mechanism works', () => {
    // CONTROL, marked as such: with no _rules.yaml (all defaults, back_pointers true),
    // --fix writes exactly one ref-by comment (QA-07 B2 PASS). This isolates R2a/R2b:
    // their red can only come from the rules key being ignored, not from --fix being
    // globally broken.
    const ws = refPairWs('control-default-back-pointers', null);

    const r = runCli(['check', '--fix', '--json'], ws.root);
    const j = parseJsonOut(r.out);
    expect(r.exit).toBe(0);
    expect(j.backPointersUpdated).toBe(1);
    const target = readFileSync(join(ws.cans, '02-authentication.md'), 'utf-8');
    expect(target).toContain('<!-- ref-by: 04-api.md -->');
  });
});
