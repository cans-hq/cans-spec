/**
 * Issue #4 — any prose containing the word 'see' followed by a non-file token
 * produced a false broken-ref error (exit 1).
 *
 * The §11 ref regex intentionally keeps minting refs from `see <token>` prose
 * ("see the runbook", "see below") so banner counts and deep-hop/orphan
 * machinery stay centralized; the fix lives at RESOLUTION time (checkRefs):
 * an unresolved target that itself looks like an intended spec reference
 * (anchored, .md, _-prefixed, path-like, numeric-prefix — looksLikeSpecRef)
 * keeps the documented §12 broken-ref ERROR; anything else is English prose
 * and downgrades to a `see-like prose` WARNING that never inflates
 * `refs.broken` (the counter in src/commands/check.ts filters error-level
 * issues whose message starts with "broken ref:").
 *
 * Non-goals pinned by other suites (unchanged here): self-reference errors,
 * transient _tasks/ warnings, _collab/ errors, broken-anchor errors, deep-hop
 * detection, and every frozen broken-ref fixture (all use .md targets).
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

import { parseOutline } from '../../src/core/outline.ts';
import { buildRefGraph, checkRefs, looksLikeSpecRef } from '../../src/core/refs.ts';
import { spawnCli, REPO } from '../runtime.ts';

// ── Unit-test scaffolding (conventions from test/refs.test.ts) ──

function filesOf(entries: Array<[string, string]>): Map<string, ReturnType<typeof parseOutline>> {
  const map = new Map();
  for (const [name, source] of entries) map.set(name, parseOutline(source, name));
  return map;
}

function runCheckRefs(entries: Array<[string, string]>) {
  const files = filesOf(entries);
  const graph = buildRefGraph(files, '.');
  return checkRefs(files, graph, '.');
}

/** The issue's verbatim repro file. */
const DEMO_MD = [
  '- Operations',
  '  - Session rules: see the runbook for the rotation details',
  '  - Escalation: see below for the paging ladder',
  '',
].join('\n');

// ── CLI-test scaffolding (pattern from test/qa-round2/refs-done.test.ts) ──

const SCRATCH = join(REPO, '.tmp', 'issues', 'issue-4');

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
  // Isolate from any ambient CANS_ROOT other suites might leave behind ('' is falsy → ignored).
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
  // issue #41: reconstitute the flat issues view from sections.{category}[]
  // (wire shape moved from a flat issues array to sections buckets).
  const j = parsed as Record<string, unknown> | null;
  if (j !== null && typeof j === 'object' && (j as any).sections !== undefined && (j as any).issues === undefined) {
    (j as any).issues = Object.entries((j as any).sections as Record<string, any[]>).flatMap(([category, arr]) =>
      arr.map((i) => ({ ...i, category, message: i.detail })),
    );
  }
  return parsed;
}

function writeSpec(ws: Ws, name: string, content: string): void {
  writeFileSync(join(ws.cans, name), content);
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── The looksLikeSpecRef classifier ──

describe('issue #4: looksLikeSpecRef classifier', () => {
  test('ref-like targets keep broken-ref (error) territory', () => {
    expect(looksLikeSpecRef('x.md', false)).toBe(true);           // explicit markdown target
    expect(looksLikeSpecRef('X.MD', false)).toBe(true);           // case-insensitive .md suffix
    expect(looksLikeSpecRef('_tasks/t.md', false)).toBe(true);    // workspace service dirs
    expect(looksLikeSpecRef('_collab/notes.md', false)).toBe(true);
    expect(looksLikeSpecRef('a/b.md', false)).toBe(true);         // path-like
    expect(looksLikeSpecRef('02-auth', false)).toBe(true);        // numeric-prefix spec stems
  });

  test('prose-like targets land in warning territory', () => {
    expect(looksLikeSpecRef('the', false)).toBe(false);           // issue repro: "see the runbook"
    expect(looksLikeSpecRef('below', false)).toBe(false);         // issue repro: "see below"
    expect(looksLikeSpecRef('runbook', false)).toBe(false);       // plain English noun
  });

  test('an explicit anchor always signals ref intent (see X#anchor)', () => {
    expect(looksLikeSpecRef('02-auth', true)).toBe(true);
    expect(looksLikeSpecRef('the', true)).toBe(true);
  });
});

// ── checkRefs behavior: prose downgraded, real refs unchanged ──

describe('issue #4: checkRefs prose exemption', () => {
  test('the issue repro (demo.md) yields two WARNINGS, never broken-ref errors', () => {
    const issues = runCheckRefs([['demo.md', DEMO_MD]]);

    // Both `see the` and `see below` minted refs (graph machinery intact) but
    // surface as warnings only.
    expect(issues.length).toBe(2);
    expect(issues.every(i => i.level === 'warning')).toBe(true);
    expect(issues.every(i => i.category === 'refs')).toBe(true);

    // No issue message may start with "broken ref:" — that prefix feeds the
    // refs.broken counter in src/commands/check.ts.
    expect(issues.every(i => !i.message.startsWith('broken ref:'))).toBe(true);

    // Warning shape: see-like prose diagnosis + explicit relink suggestion.
    const texts = issues.map(i => i.message).sort();
    expect(texts[0]).toBe('see-like prose: "see below" did not resolve to a spec file — rephrase or link explicitly');
    expect(texts[1]).toBe('see-like prose: "see the" did not resolve to a spec file — rephrase or link explicitly');
    expect(issues.map(i => i.line).sort((a, b) => a - b)).toEqual([2, 3]);
    for (const issue of issues) {
      expect(issue.suggestion).toBe('use "see: <file>.md" (or "see: <file>.md#<anchor>") to link a spec file, or reword the sentence');
    }
  });

  test('broken-ref contract preserved: a real missing .md target is still a level:error broken ref', () => {
    const issues = runCheckRefs([
      ['04-api.md', '- API\n  - Session rules: see: 99-nonexistent.md\n'],
    ]);
    expect(issues.length).toBe(1);
    expect(issues[0]!.level).toBe('error');
    expect(issues[0]!.category).toBe('refs');
    expect(issues[0]!.message).toBe('broken ref: see 99-nonexistent.md — file not found');
    expect(issues[0]!.suggestion).toBe('create 99-nonexistent.md or fix the ref target');
  });

  test('anchor intent ⇒ ref-like: unresolved `see 02-auth#Sessions` stays an error', () => {
    // 02-auth.md is ABSENT here — the #Sessions anchor still signals an
    // intended spec reference, so the documented broken-ref error applies.
    const issues = runCheckRefs([
      ['04-api.md', '- API\n  - Session rules: see 02-auth#Sessions\n'],
    ]);
    expect(issues.length).toBe(1);
    expect(issues[0]!.level).toBe('error');
    expect(issues[0]!.message).toBe('broken ref: see 02-auth — file not found');
  });

  test('anchor-less unresolved bare stem downgrades to the prose warning', () => {
    const issues = runCheckRefs([
      ['demo.md', '- Operations\n  - Escalation: see: missing\n'],
    ]);
    expect(issues.length).toBe(1);
    expect(issues[0]!.level).toBe('warning');
    expect(issues[0]!.message).toBe('see-like prose: "see missing" did not resolve to a spec file — rephrase or link explicitly');
  });
});

// ── Edge: the ref regex must not mint refs from "seen" (boundary requirement) ──

describe('issue #4: "seen"-style prose mints no refs at all', () => {
  test('"as seen in the audit" produces zero refs and zero ref issues', () => {
    const source = '- Audit trail: as seen in the audit, the logs are kept\n';
    const nodes = parseOutline(source, 'audit.md');
    const flat = [nodes[0]!, ...nodes[0]!.children];
    expect(flat.every(n => n.refs.length === 0)).toBe(true);

    // With no refs minted, checkRefs has nothing to flag for this file.
    const issues = runCheckRefs([['audit.md', source]]);
    expect(issues.filter(i => i.category === 'refs')).toHaveLength(0);
  });
});

// ── CLI end-to-end (blackbox, runtime-aware) ──

describe('issue #4: cans check end-to-end', () => {
  test('the issue repro workspace exits 0: 0 errors, 2 see-like-prose warnings, refs.broken 0, refs.total 2', () => {
    const ws = makeWs('demo-prose');
    writeSpec(ws, 'demo.md', DEMO_MD);

    const r = runCli(['check', '--json'], ws.root);
    const j = parseJsonOut(r.out);

    // Un-breaking prose: warnings only → ok=true, exit 1 (issue #41).
    expect(r.exit).toBe(1);
    expect(j.ok).toBe(true);
    expect(j.counts.errors).toBe(0);
    expect(j.counts.warnings).toBe(2);

    // Banner counts keep working: both prose refs are still minted (issue #4
    // contract — do NOT stop minting at parse time), but none is "broken".
    expect(j.refs.total).toBe(2);
    expect(j.refs.broken).toBe(0);

    // The two warnings are the see-like prose ones.
    const prose = j.issues.filter((i: any) => i.message.startsWith('see-like prose:'));
    expect(prose).toHaveLength(2);
    expect(prose.every((i: any) => i.level === 'warning' && i.category === 'refs')).toBe(true);
  });

  test('regression guard: a real broken .md ref still exits 1 with refs.broken 1', () => {
    const ws = makeWs('real-broken');
    writeSpec(ws, '04-api.md', '- API\n  - Session rules: see: 99-nonexistent.md\n  - Other rules: documented inline\n');

    const r = runCli(['check', '--json'], ws.root);
    const j = parseJsonOut(r.out);

    // Documented §12 contract preserved: missing spec-shaped file → error.
    // issue #41: error class exits 2 (was 1 pre-#41).
    expect(r.exit).toBe(2);
    expect(j.ok).toBe(false);
    expect(j.counts.errors).toBe(1);
    expect(j.refs.broken).toBe(1);
    expect(j.issues.some((i: any) =>
      i.level === 'error'
      && i.category === 'refs'
      && i.message === 'broken ref: see 99-nonexistent.md — file not found',
    )).toBe(true);
  });
});
