/** Issue #10 regression tests — see: ref targets must stay inside the workspace.
 *
 *  Contracts pinned here:
 *  - resolveSpecFile NEVER resolves outside the workspace root, even when the
 *    target physically exists there (`../outside.md`, absolute paths). null is
 *    the standard "not resolvable" answer, feeding the broken-ref machinery.
 *  - Escaping targets (absolute, or a `..` segment) get a workspace-scoped
 *    broken-ref message and a suggestion that never proposes creating a path
 *    outside the workspace (the old text suggested `create /etc/hosts`).
 *  - Ordinary missing in-workspace targets keep the exact historical
 *    message/suggestion (back-compat pin).
 *  - In-workspace refs keep resolving — the containment guard never
 *    over-blocks flat files, folder index fallbacks, or interior `..` paths
 *    that normalize back inside the root.
 *
 *  Control tests (absolute-target nulls, positives, back-compat pin, clean
 *  workspace) pass both before and after the fix; the escape-path tests were
 *  RED against the pre-fix code and are documented in worklog Task 4-b.
 */
import { describe, test, expect } from './testing.ts';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { makeTmpDir, cleanTmpDir } from './helpers.ts';
import { parseOutline } from '../src/core/outline.ts';
import { buildRefGraph, checkRefs } from '../src/core/refs.ts';
import { resolveSpecFile } from '../src/core/fs.ts';
import type { Issue } from '../src/types.ts';

/** Issue repro layout: outside.md sits one level ABOVE the cans/ workspace root. */
function makeEscapeLayout(name: string): { tmp: string; root: string } {
  const tmp = makeTmpDir(name);
  const root = join(tmp, 'cans');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(tmp, 'outside.md'), '- Outside\n');
  return { tmp, root };
}

/** refs-category errors for a single spec file checked against `root`. */
function refsErrors(root: string, spec: string): Issue[] {
  const files = new Map<string, any[]>();
  files.set('01-a.md', parseOutline(spec, '01-a.md'));
  const graph = buildRefGraph(files, root);
  return checkRefs(files, graph, root).filter(i => i.category === 'refs' && i.level === 'error');
}

describe('issue #10: resolveSpecFile containment', () => {
  test('returns null for a ../ target even though the outside file exists', () => {
    const { tmp, root } = makeEscapeLayout('issue10-unit-escape');
    try {
      expect(resolveSpecFile(root, '../outside.md')).toBeNull();
    } finally {
      cleanTmpDir(tmp);
    }
  });

  test('returns null for absolute targets outside the workspace', () => {
    const { tmp, root } = makeEscapeLayout('issue10-unit-absolute');
    try {
      expect(resolveSpecFile(root, '/etc/hostname')).toBeNull();
      // A real, existing file beyond the root is still refused in absolute form.
      expect(resolveSpecFile(root, join(tmp, 'outside.md'))).toBeNull();
    } finally {
      cleanTmpDir(tmp);
    }
  });

  test('containment positives: flat file and folder index still resolve', () => {
    const tmp = makeTmpDir('issue10-unit-positive');
    try {
      const root = join(tmp, 'cans');
      mkdirSync(join(root, '02-authentication'), { recursive: true });
      writeFileSync(join(root, '01-a.md'), '- Root\n');
      writeFileSync(join(root, '02-authentication', 'index.md'), '- Authentication\n');
      writeFileSync(join(root, '03-c.md'), '- C\n');

      const flat = resolveSpecFile(root, '01-a.md');
      expect(flat).not.toBeNull();
      expect(flat!.endsWith('01-a.md')).toBe(true);

      const folder = resolveSpecFile(root, '02-authentication.md');
      expect(folder).not.toBeNull();
      expect(folder!.endsWith(join('02-authentication', 'index.md'))).toBe(true);

      // Interior ".." that normalizes back INSIDE the root is not over-blocked.
      expect(resolveSpecFile(root, 'x/../03-c.md')).not.toBeNull();
    } finally {
      cleanTmpDir(tmp);
    }
  });

  test('refEscapesWorkspace flags absolute and .. targets, nothing else', async () => {
    const { refEscapesWorkspace } = await import('../src/core/refs.ts');
    expect(refEscapesWorkspace('../outside.md')).toBe(true);
    expect(refEscapesWorkspace('..')).toBe(true);
    expect(refEscapesWorkspace('a/../../b.md')).toBe(true);
    expect(refEscapesWorkspace('/etc/hostname')).toBe(true);
    expect(refEscapesWorkspace('01-a.md')).toBe(false);
    expect(refEscapesWorkspace('02-auth/index.md')).toBe(false);
    // Conservative by design: ANY ".." segment flags (the helper only labels
    // broken refs); actual containment is decided by resolveSpecFile's guard,
    // so interior ".." that normalizes inside the root still resolves.
    expect(refEscapesWorkspace('a/../01-a.md')).toBe(true);
  });
});

describe('issue #10: broken-ref reporting for escaping targets', () => {
  test('relative escape: broken-ref error scoped to the workspace, safe suggestion', () => {
    const { tmp, root } = makeEscapeLayout('issue10-refs-escape');
    try {
      const issues = refsErrors(root, '- Root\n  - Relative escape: see: ../outside.md\n');
      expect(issues.length).toBe(1);
      expect(issues[0].message).toContain('broken ref');
      expect(issues[0].message).toContain('../outside.md');
      expect(issues[0].message).toContain('file not found in workspace');
      expect(issues[0].suggestion).not.toContain('create ../outside.md');
      expect(issues[0].suggestion).toContain('inside the workspace');
    } finally {
      cleanTmpDir(tmp);
    }
  });

  test('absolute escape: broken-ref error, never suggests creating the outside path', () => {
    const { tmp, root } = makeEscapeLayout('issue10-refs-absolute');
    try {
      const issues = refsErrors(root, '- Root\n  - Absolute: see: /etc/hostname\n');
      expect(issues.length).toBe(1);
      expect(issues[0].message).toContain('/etc/hostname');
      expect(issues[0].message).toContain('file not found in workspace');
      expect(issues[0].suggestion).not.toContain('create /etc/');
      expect(issues[0].suggestion).toContain('inside the workspace');
    } finally {
      cleanTmpDir(tmp);
    }
  });

  test('ordinary missing target keeps the exact historical message and suggestion', () => {
    const { tmp, root } = makeEscapeLayout('issue10-refs-missing');
    try {
      const issues = refsErrors(root, '- Root\n  - Missing: see: 99-nonexistent.md\n');
      expect(issues.length).toBe(1);
      expect(issues[0].message).toBe('broken ref: see 99-nonexistent.md — file not found');
      expect(issues[0].suggestion).toBe('create 99-nonexistent.md or fix the ref target');
    } finally {
      cleanTmpDir(tmp);
    }
  });
});

describe('issue #10: dot-dot edge targets', () => {
  test('see: .. and see: a/../../b.md are broken refs, never valid', () => {
    const tmp = makeTmpDir('issue10-edge');
    try {
      const root = join(tmp, 'cans');
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, '01-a.md'), '- Root\n');
      // b.md deliberately does NOT exist (a/../../b.md normalizes to root/b.md).

      for (const target of ['..', 'a/../../b.md']) {
        const files = new Map<string, any[]>();
        files.set('01-a.md', parseOutline(`- Root\n  - Edge: see: ${target}\n`, '01-a.md'));
        const graph = buildRefGraph(files, root);
        const issues = checkRefs(files, graph, root).filter(
          i => i.category === 'refs' && i.level === 'error',
        );
        expect(issues.length, `target ${target}`).toBe(1);
        expect(issues[0].message, `target ${target}`).toContain('file not found in workspace');
        expect(issues[0].suggestion, `target ${target}`).not.toContain(`create ${target}`);
      }
    } finally {
      cleanTmpDir(tmp);
    }
  });

  test('dot-dot that stays inside the root still resolves (no over-blocking)', () => {
    const tmp = makeTmpDir('issue10-edge-inside');
    try {
      const root = join(tmp, 'cans');
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, '01-a.md'), '- Root\n');
      writeFileSync(join(root, '02-b.md'), '- B\n');
      const files = new Map<string, any[]>();
      files.set('01-a.md', parseOutline('- Root\n  - Inside: see: sub/../02-b.md\n', '01-a.md'));
      files.set('02-b.md', parseOutline('- B\n', '02-b.md'));
      const graph = buildRefGraph(files, root);
      const issues = checkRefs(files, graph, root).filter(
        i => i.category === 'refs' && i.level === 'error',
      );
      expect(issues.length).toBe(0);
    } finally {
      cleanTmpDir(tmp);
    }
  });
});

describe('issue #10: cans check integration', () => {
  /** Scratch workspace OUTSIDE the repo's shared .tmp — these tests await the
   *  check engine, and interleaved suites' scratch-mode discovery (resolveInit-
   *  Target/scratchRoot rank .tmp dirs by mtime) must never see — or be beaten
   *  by — our dirs. */
  function makeCheckWorkspace(): string {
    return mkdtempSync(join(tmpdir(), 'cans-issues10-'));
  }

  /** run `cans check` against an explicit workspace. The CANS_ROOT override is
   *  only observed by run()'s SYNCHRONOUS prefix (resolveWorkspaceRoot) — it is
   *  set and restored around the CALL, never across an await, so interleaved
   *  test files can never see the override (env races made the shared
   *  set-env-then-await pattern flaky under bun's concurrent file execution). */
  async function runCheck(cans: string) {
    const prevRoot = process.env.CANS_ROOT;
    const { run } = await import('../src/commands/check.ts'); // loaded BEFORE the env touch
    const pending = ((): ReturnType<typeof run> => {
      process.env.CANS_ROOT = cans;
      try {
        return run(['--json']); // sync prefix reads CANS_ROOT, then hits its first await
      } finally {
        if (prevRoot === undefined) delete process.env.CANS_ROOT;
        else process.env.CANS_ROOT = prevRoot;
      }
    })();
    return await pending;
  }

  test('check reports the ../ escape as broken and still resolves the valid ref beside it', async () => {
    const tmp = makeCheckWorkspace();
    const cans = join(tmp, 'cans');
    try {
      mkdirSync(cans, { recursive: true });
      writeFileSync(join(tmp, 'outside.md'), '- Outside\n');
      writeFileSync(
        join(cans, '01-a.md'),
        '- Root\n  - Escape probe: see: ../outside.md\n  - Session rules: see: 02-authentication.md\n',
      );
      writeFileSync(
        join(cans, '02-authentication.md'),
        '- Authentication\n  - Sessions\n    - Expire after 24 hours\n',
      );

      const result = await runCheck(cans);

      // The escape ref is a broken-ref ERROR (pre-fix it counted as a VALID ref
      // in refs.total with zero broken, so check exited 0 — the hole).
      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.refs.broken).toBe(1);
      expect(result.refs.total).toBe(2);

      const escape = result.issues.filter(
        (i: Issue) => i.category === 'refs' && i.level === 'error' && i.message.includes('../outside.md'),
      );
      expect(escape.length).toBe(1);
      expect(escape[0].message).toContain('file not found in workspace');
      expect(escape[0].suggestion).not.toContain('create ../outside.md');
      expect(escape[0].suggestion).not.toContain('create /etc/');

      // No over-blocking: the in-workspace ref beside the escape still resolves.
      expect(
        result.issues.some(
          (i: Issue) => i.message.startsWith('broken ref:') && i.message.includes('02-authentication'),
        ),
      ).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('positive control: a workspace with only in-workspace refs stays clean', async () => {
    const tmp = makeCheckWorkspace();
    const cans = join(tmp, 'cans');
    try {
      mkdirSync(cans, { recursive: true });
      writeFileSync(join(cans, '01-a.md'), '- Root\n  - Session rules: see: 02-authentication.md\n');
      writeFileSync(
        join(cans, '02-authentication.md'),
        '- Authentication\n  - Sessions\n    - Expire after 24 hours\n',
      );

      const result = await runCheck(cans);

      expect(result.ok).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.errorCount).toBe(0);
      expect(result.refs.broken).toBe(0);
      expect(result.refs.total).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
