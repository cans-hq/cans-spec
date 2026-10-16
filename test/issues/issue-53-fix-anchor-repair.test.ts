/**
 * Issue #53 Part 2.4 regression tests — `cans check --fix` anchor repair.
 *
 * Defect: `--fix` rewrote only ref-by comments and left broken anchors
 * alone even when the intended target was unambiguous — the user had to
 * retype the anchor by hand, exactly the class of typo the fuzzy layer
 * (nearSlugMatches, Part 1.1) can already identify.
 *
 * Fix (transactional, mirroring the ref-by discipline of issues #6/#11/#19/
 * #21): `--fix` PROPOSES pure anchor rewrites in the report; `--fix --yes`
 * APPLIES them; `--fix --dry-run` previews every change (anchors AND ref-by)
 * and writes nothing. A repair happens only when ALL hold:
 *   1. the target file exists and is parseable (loadedKeyFor/resolveSpecFile,
 *      the same resolution path as checkRefs — YAML keys count too),
 *   2. EXACTLY ONE distinct node/key text fuzzy-matches the failing anchor at
 *      ≥ SLUG_SUGGEST_THRESHOLD (0.8) — two siblings one letter apart stay
 *      plain errors, never a coin flip,
 *   3. the fix is a pure anchor substitution in the `see:` token — node text,
 *      and every other byte on the line, is preserved (fence-safe, EOL-safe).
 *
 * Test map:
 *   a–e ... flag surface: --yes/--dry-run gate on --fix (§20 usage errors,
 *          exit 2 via checkFail), help lists them
 *   f–k ... repairAnchors unit: the pure byte-level rewriter (EOL
 *          preservation, raw-token disambiguation, fence guard, edge cases)
 *   l..... unambiguous one-letter-off anchor + em-dash node: plain check →
 *          error exit 2; plain --fix → proposal, referrer bytes unchanged,
 *          ref-by cleanup still writes; --fix --yes → only the anchor
 *          segment changes (full-file byte assert), refs.broken 0, exit < 2
 *   m..... CRLF referrer: every other byte preserved through the repair
 *   n..... --fix --dry-run writes NOTHING (anchors AND ref-by previewed)
 *   o..... ambiguous siblings → no proposal, no rewrite, error stays
 *   p..... unparseable target → skipped cleanly
 *   q..... [file] filter scopes proposals and writes to matched referrers
 *   r..... multiple see: refs on one line → only the broken one's anchor
 *   s..... --json: anchorFixes carries from/to/applied; dryRun when active
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { rmSync, readFileSync } from 'fs';

import { repairAnchors, parseCheckArgs } from '../../src/commands/check.ts';
import { spawnCli, REPO } from '../runtime.ts';
import { makeCansWorkspace } from '../helpers.ts';

// ── CLI scaffolding (mirrors test/issues/issue-53-slug-core.test.ts) ──

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-53-fix-anchor-repair');
const createdDirs: string[] = [];

afterEach(() => {
  while (createdDirs.length > 0) {
    rmSync(createdDirs.pop()!, { recursive: true, force: true });
  }
});

/** issue-50.test.ts scaffolding: the CLI runs from the PARENT of cans/ (the
 *  workspace is discovered below cwd); writes target the cans root itself. */
function makeWs(name: string, files: Record<string, string>): { tmp: string; root: string } {
  const tmp = join(SCRATCH, `${name}-${createdDirs.length + 1}`);
  createdDirs.push(tmp);
  const root = makeCansWorkspace(tmp, files);
  return { tmp, root };
}

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

/** Raw bytes of a spec file (byte-level "cmp" evidence, issue #11 style). */
function bytes(root: string, rel: string): Buffer {
  return readFileSync(join(root, rel));
}

// ── Flag surface: --yes / --dry-run gate on --fix (§20) ──

describe('issue #53 2.4: --yes and --dry-run are --fix-gated flags', () => {
  test('a: --yes without --fix is a usage error (exit 2, checkFail diagnosis)', () => {
    const ws = makeWs('flag-yes-alone', {
      '00-overview.md': '- Overview\n  - Scope\n',
    });
    const r = runCli(['check', '--yes'], ws.tmp);
    expect(r.exit).toBe(2);
    expect(r.out).toContain('"--yes" requires --fix');
    expect(r.out).toContain('Run `cans help` for valid check flags.');
  });

  test('b: --dry-run without --fix is a usage error (exit 2)', () => {
    const ws = makeWs('flag-dryrun-alone', {
      '00-overview.md': '- Overview\n  - Scope\n',
    });
    const r = runCli(['check', '--dry-run'], ws.tmp);
    expect(r.exit).toBe(2);
    expect(r.out).toContain('"--dry-run" requires --fix');
    expect(r.out).toContain('Run `cans help` for valid check flags.');
  });

  test('c: --fix --yes --dry-run is a usage error (mutually exclusive)', () => {
    const ws = makeWs('flag-both', {
      '00-overview.md': '- Overview\n  - Scope\n',
    });
    const r = runCli(['check', '--fix', '--yes', '--dry-run'], ws.tmp);
    expect(r.exit).toBe(2);
    expect(r.out).toContain('mutually exclusive');
  });

  test('d: parseCheckArgs carries yes/dryRun and rejects the same shapes (unit)', () => {
    const ok = parseCheckArgs(['--fix', '--yes']);
    expect(ok.errors).toEqual([]);
    expect(ok.fix).toBe(true);
    expect(ok.yes).toBe(true);
    expect(ok.dryRun).toBe(false);
    const dry = parseCheckArgs(['--fix', '--dry-run']);
    expect(dry.errors).toEqual([]);
    expect(dry.yes).toBe(false);
    expect(dry.dryRun).toBe(true);
    // The gate: neither flag means anything without --fix.
    expect(parseCheckArgs(['--yes']).errors.length).toBe(1);
    expect(parseCheckArgs(['--dry-run']).errors.length).toBe(1);
    expect(parseCheckArgs(['--fix', '--yes', '--dry-run']).errors.length).toBe(1);
  });

  test('e: the arg diagnosis precedes workspace resolution (§37: name the real problem)', () => {
    // No cans/ workspace anywhere above the scratch dir — a naked `--yes`
    // must still report the FLAG problem, never the missing workspace.
    const scratch = join(SCRATCH, 'no-ws-flag-order');
    createdDirs.push(scratch);
    rmSync(scratch, { recursive: true, force: true });
    const r = runCli(['check', '--yes'], join(scratch, '..'));
    expect(r.exit).toBe(2);
    expect(r.out).toContain('"--yes" requires --fix');
    expect(r.out).not.toContain('no cans workspace found');
  });

  test('f: help lists the new flags and the --yes/--dry-run semantics', () => {
    const r = runCli(['help'], SCRATCH);
    expect(r.out).toContain('--yes');
    expect(r.out).toContain('--dry-run');
    expect(r.out).toMatch(/--yes.*appl|appl.*--yes/);
  });
});

// ── Unit: repairAnchors — the pure byte-level rewriter ──

describe('issue #53 2.4: repairAnchors — pure anchor substitution', () => {
  test('g: rewrites only the anchor segment; every other byte of the line survives', () => {
    const src = '- Overview\n  - Authorizer: see 02-authentication.md#Layer-1-D-authorizer\n  - Scope\n';
    const out = repairAnchors(src, [{ line: 2, from: 'Layer-1-D-authorizer', to: 'Layer-1-C-authorizer' }]);
    expect(out).toBe('- Overview\n  - Authorizer: see 02-authentication.md#Layer-1-C-authorizer\n  - Scope\n');
  });

  test('h: CRLF file stays fully CRLF — each line keeps its own terminator (issue #21)', () => {
    const crlf = '- API\r\n  - Auth: see 01-auth.md#Sesions\r\n  - Data: see 03-data.md#Storage\r\n';
    const out = repairAnchors(crlf, [{ line: 2, from: 'Sesions', to: 'Sessions' }]);
    expect(out).toBe('- API\r\n  - Auth: see 01-auth.md#Sessions\r\n  - Data: see 03-data.md#Storage\r\n');
    // No bare LF was minted anywhere: every terminator is the original \r\n.
    expect(out.split('\r\n').join('')).not.toContain('\n');
    // Mixed terminators stay mixed: only the target line is touched.
    const mixed = '- API\n  - Auth: see 01-auth.md#Sesions\r\n  - Data\r\n';
    expect(repairAnchors(mixed, [{ line: 2, from: 'Sesions', to: 'Sessions' }]))
      .toBe('- API\n  - Auth: see 01-auth.md#Sessions\r\n  - Data\r\n');
  });

  test('i: raw disambiguates multiple see: refs on one line — the RIGHT one changes (§11)', () => {
    // Two refs spelling the SAME anchor on one line: only the second is the
    // broken one (its target lacks the node). The ref's raw token pins the
    // exact occurrence; the raw-less fallback documents its first-match
    // behavior. Also pins the boundary rule: a raw that stops mid-token
    // (a stale prefix of a longer anchor) never corrupts the longer anchor.
    const src = '- N: see 01-a.md#Old and see 02-b.md#Old\n';
    expect(repairAnchors(src, [{ line: 1, from: 'Old', to: 'New', raw: 'see 02-b.md#Old' }]))
      .toBe('- N: see 01-a.md#Old and see 02-b.md#New\n');
    expect(repairAnchors(src, [{ line: 1, from: 'Old', to: 'New' }]))
      .toBe('- N: see 01-a.md#New and see 02-b.md#Old\n');
    // Mid-token raw (a prefix of `#Sessions-v2`): falls to the #from scan,
    // never rewrites inside the longer anchor.
    const src2 = '- N: see 01-a.md#Sessions and see 02-b.md#Sessions-v2\n';
    expect(repairAnchors(src2, [{ line: 1, from: 'Sessions-v2', to: 'Fixed', raw: 'see 02-b.md#Sessions' }]))
      .toBe('- N: see 01-a.md#Sessions and see 02-b.md#Fixed\n');
  });

  test('j: fence guard — a fix targeting a fenced (or marker) line is skipped, bytes identical', () => {
    // By construction a graph-derived fix can never sit inside a fence
    // (parseOutline is fence-blind), but the rewriter GUARDS anyway: a
    // pathological caller must never corrupt a fenced example.
    const fenced = '- Real\n```md\nsee 99-x.md#Brokne\n```\n- Tail\n';
    expect(repairAnchors(fenced, [{ line: 3, from: 'Brokne', to: 'Broken' }])).toBe(fenced);
    // The fence marker line itself is equally untouchable.
    expect(repairAnchors(fenced, [{ line: 2, from: 'md', to: 'xx' }])).toBe(fenced);
    // A fix AFTER a closed fence still lands (fence state is positional).
    const src = '```\nsee 99-x.md#Brokne\n```\n- Real: see 02-y.md#Sesions\n';
    expect(repairAnchors(src, [{ line: 4, from: 'Sesions', to: 'Sessions' }]))
      .toBe('```\nsee 99-x.md#Brokne\n```\n- Real: see 02-y.md#Sessions\n');
  });

  test('k: edge cases — no fixes, out-of-range line, degenerate from===to, fragment not found', () => {
    expect(repairAnchors('a\nb\n', [])).toBe('a\nb\n');
    expect(repairAnchors('a\nb\n', [{ line: 99, from: 'x', to: 'y' }])).toBe('a\nb\n');
    expect(repairAnchors('a\nb\n', [{ line: 0, from: 'x', to: 'y' }])).toBe('a\nb\n');
    // Degenerate: the anchor is already the canonical spelling — nothing to do.
    expect(repairAnchors('a\nsee x.md#Same\n', [{ line: 2, from: 'Same', to: 'Same' }])).toBe('a\nsee x.md#Same\n');
    // The `#from` fragment is not on the line → skip, never a blind rewrite.
    expect(repairAnchors('a\nsee x.md#Other\n', [{ line: 2, from: 'Nope', to: 'Yep' }])).toBe('a\nsee x.md#Other\n');
    expect(repairAnchors('a\nno ref here\n', [{ line: 2, from: 'Nope', to: 'Yep' }])).toBe('a\nno ref here\n');
  });

  test('l: issue #48 shape — trailing prose punctuation glued to the anchor survives the rewrite', () => {
    // The raw token captured `(see 02-effect.md#Audit-spine)` including the
    // closing paren; the parsed anchor is `Audit-spine`. The paren belongs to
    // the sentence, not the anchor — only the anchor prefix is replaced.
    const src = '- Audit (see 02-effect.md#Audit-spine)\n';
    expect(repairAnchors(src, [{ line: 1, from: 'Audit-spine', to: 'Audit-spine-v2', raw: 'see 02-effect.md#Audit-spine)' }]))
      .toBe('- Audit (see 02-effect.md#Audit-spine-v2)\n');
    // Same shape through the raw-less scan path.
    expect(repairAnchors('- X: see 02-effect.md#Audit-spine)\n', [{ line: 1, from: 'Audit-spine', to: 'Fixed' }]))
      .toBe('- X: see 02-effect.md#Fixed)\n');
  });

  test('m: several fixes across several lines land independently', () => {
    const src = [
      '- Overview',
      '  - A: see 01-a.md#Sesions',
      '  - B: see 02-b.md#Storge',
      '  - C: see 03-c.md#Fine',
    ].join('\n') + '\n';
    expect(repairAnchors(src, [
      { line: 2, from: 'Sesions', to: 'Sessions' },
      { line: 3, from: 'Storge', to: 'Storage' },
    ])).toBe([
      '- Overview',
      '  - A: see 01-a.md#Sessions',
      '  - B: see 02-b.md#Storage',
      '  - C: see 03-c.md#Fine',
    ].join('\n') + '\n');
  });
});

// ── CLI end-to-end: the propose → apply → preview transaction ──

const EM = '\u2014';

/** The issue's repro shape: a one-letter-off anchor (D vs C) pointing at an
 *  em-dash node. 04-api.md adds a SECOND, healthy anchored ref so the runs
 *  also have ref-by work to do — proving ref-by writes and anchor proposals
 *  compose without stepping on each other. */
const REPRO_OVERVIEW = [
  '- Overview',
  '  - Authorizer: see 02-authentication.md#Layer-1-D-authorizer',
  '  - Scope',
].join('\n') + '\n';
const REPRO_OVERVIEW_FIXED = [
  '- Overview',
  '  - Authorizer: see 02-authentication.md#Layer-1-C-authorizer',
  '  - Scope',
].join('\n') + '\n';
const REPRO_AUTH = [
  '- Authentication',
  `  - Layer 1 ${EM} C authorizer`,
  '  - Token hygiene',
].join('\n') + '\n';
const REPRO_API = [
  '- API',
  '  - Auth: see 02-authentication.md#Token-hygiene',
  '  - Data',
].join('\n') + '\n';

describe('issue #53 2.4: --fix anchor repair (CLI end-to-end)', () => {
  test('n: plain check — broken anchor error, exit 2; no fix fields on the wire', () => {
    const ws = makeWs('repro-plain', {
      '00-overview.md': REPRO_OVERVIEW,
      '02-authentication.md': REPRO_AUTH,
      '04-api.md': REPRO_API,
    });
    const r = runCli(['check', '--json'], ws.tmp);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.refs.broken).toBe(1);
    expect(j.issues.some((i: any) => i.rule === 'refs.broken.anchor')).toBe(true);
    // Additive-only JSON: a plain check carries neither new field (§35).
    expect(j.anchorFixes).toBeUndefined();
    expect(j.dryRun).toBeUndefined();
  });

  test('o: plain --fix — proposal only: referrer byte-identical, ref-by cleanup still writes', () => {
    const ws = makeWs('repro-propose', {
      '00-overview.md': REPRO_OVERVIEW,
      '02-authentication.md': REPRO_AUTH,
      '04-api.md': REPRO_API,
    });
    const before = bytes(ws.root, '00-overview.md');
    const r = runCli(['check', '--fix', '--json'], ws.tmp);
    // The anchor is still broken — proposing is not fixing.
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.anchorFixes).toEqual([
      { file: '00-overview.md', line: 2, from: 'Layer-1-D-authorizer', to: 'Layer-1-C-authorizer', applied: false },
    ]);
    expect(j.dryRun).toBeUndefined();
    // No anchor write happened: the referrer is byte-identical.
    expect(bytes(ws.root, '00-overview.md').equals(before)).toBe(true);
    // Today's ref-by cleanup ran exactly as before: the healthy ref earned
    // its inline mark on the target.
    expect(readFileSync(join(ws.root, '02-authentication.md'), 'utf-8')).toBe(
      `- Authentication\n  - Layer 1 ${EM} C authorizer\n  - Token hygiene <!-- ref-by: 04-api.md -->\n`,
    );
    expect(j.backPointersUpdatedFiles).toEqual(['02-authentication.md']);

    // Human mode names the proposal with the exact from → to spellings.
    const hws = makeWs('repro-propose-human', {
      '00-overview.md': REPRO_OVERVIEW,
      '02-authentication.md': REPRO_AUTH,
      '04-api.md': REPRO_API,
    });
    const h = runCli(['check', '--fix'], hws.tmp);
    expect(h.exit).toBe(2);
    expect(h.out).toContain('--fix would rewrite: 00-overview.md:2 #Layer-1-D-authorizer → #Layer-1-C-authorizer');
  });

  test('p: --fix --yes — anchor applied, both ref-by marks earned in the same run, exit 0', () => {
    const ws = makeWs('repro-apply', {
      '00-overview.md': REPRO_OVERVIEW,
      '02-authentication.md': REPRO_AUTH,
      '04-api.md': REPRO_API,
    });
    const r = runCli(['check', '--fix', '--yes', '--json'], ws.tmp);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.refs.broken).toBe(0);
    expect(j.counts.errors).toBe(0);
    expect(j.anchorFixes).toEqual([
      { file: '00-overview.md', line: 2, from: 'Layer-1-D-authorizer', to: 'Layer-1-C-authorizer', applied: true },
    ]);
    // Only the anchor segment changed in the referrer — full-file byte assert.
    expect(readFileSync(join(ws.root, '00-overview.md'), 'utf-8')).toBe(REPRO_OVERVIEW_FIXED);
    // The repaired ref now resolves, so it earns its mark in the SAME run —
    // alongside the pre-existing healthy ref's mark (post-fix state, §35).
    expect(readFileSync(join(ws.root, '02-authentication.md'), 'utf-8')).toBe(
      `- Authentication\n  - Layer 1 ${EM} C authorizer <!-- ref-by: 00-overview.md -->\n  - Token hygiene <!-- ref-by: 04-api.md -->\n`,
    );
    expect(j.backPointersUpdatedFiles).toEqual(['02-authentication.md']);

    // Human mode reports the applied anchors alongside the ref-by line.
    const hws = makeWs('repro-apply-human', {
      '00-overview.md': REPRO_OVERVIEW,
      '02-authentication.md': REPRO_AUTH,
      '04-api.md': REPRO_API,
    });
    const h = runCli(['check', '--fix', '--yes'], hws.tmp);
    expect(h.exit).toBe(0);
    expect(h.out).toContain('--fix rewrote anchors in: 00-overview.md (1)');
    expect(h.out).toContain('--fix updated ref-by in: 02-authentication.md');
  });

  test('q: CRLF referrer — only the anchor segment changes, every other byte preserved', () => {
    const crlfOverview = [
      '- Overview',
      '  - Authorizer: see 02-authentication.md#Layer-1-D-authorizer',
      '  - Scope',
    ].join('\r\n') + '\r\n';
    const ws = makeWs('repro-crlf', {
      '00-overview.md': crlfOverview,
      '02-authentication.md': REPRO_AUTH,
    });
    const r = runCli(['check', '--fix', '--yes', '--json'], ws.tmp);
    expect(r.exit).toBe(0);
    const fixed = readFileSync(join(ws.root, '00-overview.md'), 'utf-8');
    expect(fixed).toBe([
      '- Overview',
      '  - Authorizer: see 02-authentication.md#Layer-1-C-authorizer',
      '  - Scope',
    ].join('\r\n') + '\r\n');
    // No bare LF was minted: the CRLF file stayed fully CRLF (issue #21).
    expect(fixed.split('\r\n').join('')).not.toContain('\n');
    // The LF target earns its mark in the file's own (LF) EOL.
    expect(readFileSync(join(ws.root, '02-authentication.md'), 'utf-8')).toBe(
      `- Authentication\n  - Layer 1 ${EM} C authorizer <!-- ref-by: 00-overview.md -->\n  - Token hygiene\n`,
    );
  });

  test('r: --fix --dry-run — NOTHING written (anchors and ref-by both previewed)', () => {
    // A stale back-pointer (99-gone.md) proves the ref-by side is also
    // preview-only: today's --fix would strip it and write the healthy mark.
    const authStale = [
      '- Authentication',
      `  - Layer 1 ${EM} C authorizer <!-- ref-by: 99-gone.md -->`,
      '  - Token hygiene',
    ].join('\n') + '\n';
    const files: Record<string, string> = {
      '00-overview.md': REPRO_OVERVIEW,
      '02-authentication.md': authStale,
      '04-api.md': REPRO_API,
    };
    const ws = makeWs('repro-dryrun', files);
    const before = Object.fromEntries(
      Object.keys(files).map(rel => [rel, bytes(ws.root, rel)]),
    );
    // Pre-state: the broken anchor (error) and the stale mark (warning).
    const plain = runCli(['check', '--json'], ws.tmp);
    expect(plain.exit).toBe(2);

    const r = runCli(['check', '--fix', '--dry-run', '--json'], ws.tmp);
    expect(r.exit).toBe(2); // nothing was fixed — the error must stay
    const j = parseJsonOut(r.out);
    expect(j.dryRun).toBe(true);
    expect(j.anchorFixes).toEqual([
      { file: '00-overview.md', line: 2, from: 'Layer-1-D-authorizer', to: 'Layer-1-C-authorizer', applied: false },
    ]);
    // The ref-by preview rides backPointersUpdated* under the dryRun flag.
    expect(j.backPointersUpdated).toBe(1);
    expect(j.backPointersUpdatedFiles).toEqual(['02-authentication.md']);
    // Both findings stay: nothing was written, so nothing was resolved.
    expect(j.issues.some((i: any) => i.rule === 'refs.broken.anchor')).toBe(true);
    expect(j.issues.some((i: any) => i.rule === 'refs.backpointer.stale')).toBe(true);
    expect(j.counts.errors).toBe(1);
    // Byte-level proof: every file is untouched.
    for (const [rel, b] of Object.entries(before)) {
      expect(bytes(ws.root, rel).equals(b)).toBe(true);
    }

    // Human mode previews both halves of the transaction.
    const hws = makeWs('repro-dryrun-human', files);
    const h = runCli(['check', '--fix', '--dry-run'], hws.tmp);
    expect(h.exit).toBe(2);
    expect(h.out).toContain('--fix would rewrite: 00-overview.md:2 #Layer-1-D-authorizer → #Layer-1-C-authorizer');
    expect(h.out).toContain('--fix would rewrite ref-by in: 02-authentication.md');
    expect(h.out).not.toContain('--fix updated ref-by in:');
  });

  test('s: ambiguous siblings (two one-letter-apart nodes) — no proposal, no rewrite, error stays', () => {
    const ws = makeWs('ambiguous', {
      '00-overview.md': REPRO_OVERVIEW.replace('#Layer-1-D-authorizer', '#Layer-1-X-authorizer'),
      '02-authentication.md': [
        '- Authentication',
        `  - Layer 1 ${EM} C authorizer`,
        `  - Layer 1 ${EM} D authorizer`,
        '  - Token hygiene',
      ].join('\n') + '\n',
    });
    const before = bytes(ws.root, '00-overview.md');
    const plain = runCli(['check', '--json'], ws.tmp);
    expect(plain.exit).toBe(2);
    const r = runCli(['check', '--fix', '--yes', '--json'], ws.tmp);
    expect(r.exit).toBe(2); // ambiguous → untouched → still an error
    const j = parseJsonOut(r.out);
    // Two fuzzy matches ≥ threshold = no repair, not even a proposal.
    expect(j.anchorFixes).toEqual([]);
    expect(j.refs.broken).toBe(1);
    expect(j.issues.some((i: any) => i.rule === 'refs.broken.anchor')).toBe(true);
    expect(bytes(ws.root, '00-overview.md').equals(before)).toBe(true);
  });

  test('t: unparseable target — skipped cleanly, no crash, no proposal', () => {
    const ws = makeWs('parse-fail', {
      '00-overview.md': '- Overview\n  - Pointer: see 03-broken.md#Anything\n  - Scope\n',
      // Tab indentation → parseOutline throws → the target is reported as a
      // parse error and holds no addressable nodes for any anchor.
      '03-broken.md': '- Broken\n\t- Tab indented child\n',
    });
    const before = bytes(ws.root, '00-overview.md');
    const r = runCli(['check', '--fix', '--yes', '--json'], ws.tmp);
    expect(r.exit).toBe(2); // the parse error itself
    const j = parseJsonOut(r.out);
    expect(j.anchorFixes).toEqual([]);
    expect(j.issues.some((i: any) => i.rule === 'parse.error')).toBe(true);
    expect(bytes(ws.root, '00-overview.md').equals(before)).toBe(true);
  });

  test('u: [file] filter scopes proposals and writes to the matched referrers (issue #11)', () => {
    const mk = (): Record<string, string> => ({
      '00-overview.md': REPRO_OVERVIEW,
      '02-authentication.md': REPRO_AUTH,
      '04-api.md': REPRO_API,
    });
    // u1: the broken anchor lives in a NON-matched referrer — not proposed,
    // not rewritten; the error stays global (refs are global by design).
    const ws1 = makeWs('filter-unmatched', mk());
    const before1 = bytes(ws1.root, '00-overview.md');
    const r1 = runCli(['check', '--fix', '--yes', '--json', '04-api.md'], ws1.tmp);
    expect(r1.exit).toBe(2);
    const j1 = parseJsonOut(r1.out);
    expect(j1.anchorFixes).toEqual([]);
    expect(bytes(ws1.root, '00-overview.md').equals(before1)).toBe(true);

    // u2: the matched referrer IS repaired; its target's ref-by marks stay
    // untouched this run (targets are not filter-matched — re-run with the
    // target's filter, or unfiltered, to write them).
    const ws2 = makeWs('filter-matched', mk());
    const beforeTarget = bytes(ws2.root, '02-authentication.md');
    const r2 = runCli(['check', '--fix', '--yes', '--json', '00-overview.md'], ws2.tmp);
    expect(r2.exit).toBe(0);
    const j2 = parseJsonOut(r2.out);
    expect(j2.refs.broken).toBe(0);
    expect(j2.anchorFixes).toEqual([
      { file: '00-overview.md', line: 2, from: 'Layer-1-D-authorizer', to: 'Layer-1-C-authorizer', applied: true },
    ]);
    expect(readFileSync(join(ws2.root, '00-overview.md'), 'utf-8')).toBe(REPRO_OVERVIEW_FIXED);
    expect(bytes(ws2.root, '02-authentication.md').equals(beforeTarget)).toBe(true);
  });

  test('v: multiple see: refs on one line — only the broken one’s anchor changes', () => {
    const ws = makeWs('multi-refs', {
      '00-overview.md': [
        '- Overview',
        '  - Links: see 02-authentication.md#Sessions and see 02-authentication.md#Layer-1-D-authorizer',
        '  - Scope',
      ].join('\n') + '\n',
      '02-authentication.md': [
        '- Authentication',
        '  - Sessions',
        `  - Layer 1 ${EM} C authorizer`,
        '  - Token hygiene',
      ].join('\n') + '\n',
    });
    const r = runCli(['check', '--fix', '--yes', '--json'], ws.tmp);
    expect(r.exit).toBe(0);
    expect(readFileSync(join(ws.root, '00-overview.md'), 'utf-8')).toBe([
      '- Overview',
      '  - Links: see 02-authentication.md#Sessions and see 02-authentication.md#Layer-1-C-authorizer',
      '  - Scope',
    ].join('\n') + '\n');
    // Both refs now resolve and earn their inline marks.
    expect(readFileSync(join(ws.root, '02-authentication.md'), 'utf-8')).toBe([
      '- Authentication',
      '  - Sessions <!-- ref-by: 00-overview.md -->',
      `  - Layer 1 ${EM} C authorizer <!-- ref-by: 00-overview.md -->`,
      '  - Token hygiene',
    ].join('\n') + '\n');
  });

  test('w: many proposals fold into one compact line (issue #41 budget)', () => {
    const ws = makeWs('many-proposals', {
      '00-overview.md': [
        '- Overview',
        '  - One: see 02-a.md#Sesions',
        '  - Two: see 02-a.md#Token-rotation-polcy',
        '  - Scope',
      ].join('\n') + '\n',
      '04-extra.md': [
        '- Extra',
        '  - Three: see 02-a.md#Layer-cake-architecure',
        '  - Four: see 02-a.md#Storge-lifecycle-rules',
      ].join('\n') + '\n',
      '02-a.md': [
        '- A',
        '  - Sessions',
        '  - Token rotation policy',
        '  - Layer cake architecture',
        '  - Storage lifecycle rules',
      ].join('\n') + '\n',
    });
    const r = runCli(['check', '--fix'], ws.tmp);
    expect(r.exit).toBe(2);
    expect(r.out).toContain('--fix would rewrite anchors in: 00-overview.md, 04-extra.md (4) — run with --yes to apply');
    // The folded form replaces — not joins — the individual lines.
    expect(r.out).not.toContain('--fix would rewrite: 00-overview.md:2 #Sesions');
    // JSON keeps every proposal unfolded (lossless wire, §35).
    const jws = makeWs('many-proposals-json', {
      '00-overview.md': [
        '- Overview',
        '  - One: see 02-a.md#Sesions',
        '  - Two: see 02-a.md#Token-rotation-polcy',
        '  - Scope',
      ].join('\n') + '\n',
      '04-extra.md': [
        '- Extra',
        '  - Three: see 02-a.md#Layer-cake-architecure',
        '  - Four: see 02-a.md#Storge-lifecycle-rules',
      ].join('\n') + '\n',
      '02-a.md': [
        '- A',
        '  - Sessions',
        '  - Token rotation policy',
        '  - Layer cake architecture',
        '  - Storage lifecycle rules',
      ].join('\n') + '\n',
    });
    const j = parseJsonOut(runCli(['check', '--fix', '--json'], jws.tmp).out);
    expect(j.anchorFixes.length).toBe(4);
    expect(j.anchorFixes.every((f: any) => f.applied === false && typeof f.from === 'string' && typeof f.to === 'string')).toBe(true);
  });

  test('x: --json anchorFixes entries carry exactly {file, line, from, to, applied}', () => {
    const ws = makeWs('json-shape', {
      '00-overview.md': REPRO_OVERVIEW,
      '02-authentication.md': REPRO_AUTH,
      '04-api.md': REPRO_API,
    });
    const j = parseJsonOut(runCli(['check', '--fix', '--json'], ws.tmp).out);
    expect(Array.isArray(j.anchorFixes)).toBe(true);
    expect(Object.keys(j.anchorFixes[0]).sort()).toEqual(['applied', 'file', 'from', 'line', 'to']);
    // dryRun rides along only when active.
    expect(j.dryRun).toBeUndefined();
    const j2 = parseJsonOut(runCli(['check', '--fix', '--dry-run', '--json'], ws.tmp).out);
    expect(j2.dryRun).toBe(true);
  });
});


