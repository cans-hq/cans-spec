/**
 * Integration regression tests for GitHub issues #8 and #9 (cans-hq/cans-spec).
 *
 *   #8 — synthetic '(table)' / '(code fence)' nodes leaked into node counts,
 *        redundancy layers and token-budget estimates. After the fix, leading
 *        tables/fences park their provenance flag on the first REAL node that
 *        follows; content-only files parse to zero nodes and the phantom node
 *        text never appears anywhere.
 *   #9 — an unclosed code fence silently removed the remainder of the file
 *        from every check. The swallowing parse behavior is unchanged (§11:
 *        fence content is overflow, never bullets), but `cans check` now
 *        surfaces a structure warning naming the opening line (via the
 *        ParseWarning channel that check.ts already converts into issues).
 *
 * Workspaces are built with the shared helpers (test/helpers.ts) and the check
 * command runs in-process via CANS_ROOT, mirroring the established pattern.
 */
import { describe, test, expect } from './testing.ts';
import { makeTmpDir, cleanTmpDir, makeCansWorkspace } from './helpers.ts';

describe('issue #9 integration: unclosed fence surfaces as a check warning', () => {
  test('check reports the unclosed-fence warning and only the pre-fence nodes', async () => {
    const tmp = makeTmpDir('issues-8-9-fence');
    const prevRoot = process.env.CANS_ROOT;
    try {
      const cansRoot = makeCansWorkspace(tmp, {
        '01-a.md': [
          '- Alpha service owns ingest',
          '- Beta service owns routing',
          '```',
          '- Gamma service owns billing',
          '- Delta service owns storage',
          '- Epsilon service owns search',
        ].join('\n'),
      });
      process.env.CANS_ROOT = cansRoot;
      const { run } = await import('../src/commands/check.ts');
      const result = await run(['--json']);

      // ≥1 warning carrying the documented message (line of the opening fence).
      const fenceWarnings = result.issues.filter(
        i => i.level === 'warning' && i.message.includes('unclosed code fence'),
      );
      expect(fenceWarnings.length).toBeGreaterThanOrEqual(1);
      expect(fenceWarnings[0].file).toBe('01-a.md');
      expect(fenceWarnings[0].line).toBe(3);
      expect(fenceWarnings[0].message).toContain('unclosed code fence opened at line 3');
      expect(fenceWarnings[0].category).toBe('structure');

      // Parse behavior unchanged: bullets after the stray fence are excluded,
      // so the reported node count is 2, not 5.
      expect(result.nodes).toBe(2);
    } finally {
      if (prevRoot === undefined) delete process.env.CANS_ROOT;
      else process.env.CANS_ROOT = prevRoot;
      cleanTmpDir(tmp);
    }
  });

  test('properly closed fences stay warning-free', async () => {
    const tmp = makeTmpDir('issues-8-9-closed-fence');
    const prevRoot = process.env.CANS_ROOT;
    try {
      const cansRoot = makeCansWorkspace(tmp, {
        '01-a.md': [
          '- Alpha service owns ingest',
          '```',
          'const alpha = 1;',
          '```',
          '- Beta service owns routing',
        ].join('\n'),
      });
      process.env.CANS_ROOT = cansRoot;
      const { run } = await import('../src/commands/check.ts');
      const result = await run(['--json']);
      expect(result.issues.filter(i => i.message.includes('unclosed code fence'))).toEqual([]);
      expect(result.nodes).toBe(2);
    } finally {
      if (prevRoot === undefined) delete process.env.CANS_ROOT;
      else process.env.CANS_ROOT = prevRoot;
      cleanTmpDir(tmp);
    }
  });
});

describe('issue #8 integration: leading tables leave no phantom traces in check', () => {
  test('two table-topped files: no phantom-table warnings, real-bullet node counts only', async () => {
    const tmp = makeTmpDir('issues-8-9-tables');
    const prevRoot = process.env.CANS_ROOT;
    try {
      const cansRoot = makeCansWorkspace(tmp, {
        '01-a.md': [
          '| Field | Value |',
          '|---|---|',
          '| alpha | xray |',
          '',
          '- Alpha renderer streams delta packets',
          '- Zephyr cache warms quickly',
        ].join('\n'),
        '02-b.md': [
          '| Field | Value |',
          '|---|---|',
          '| beta | yankee |',
          '',
          '- Orchard logistics tracks cranes',
          '- Quartz vault hums nightly',
        ].join('\n'),
      });
      process.env.CANS_ROOT = cansRoot;
      const { run } = await import('../src/commands/check.ts');
      const result = await run(['--json']);

      // No phantom-driven redundancy warnings of any shape.
      expect(result.issues.filter(i => i.message.includes('(table)'))).toEqual([]);
      expect(result.issues.filter(i => i.message.includes('100% overlap'))).toEqual([]);
      expect(result.issues.filter(i => i.suggestion?.includes('(table)'))).toEqual([]);
      // Only the 4 real bullets count — the phantom '(table)' nodes are gone.
      expect(result.nodes).toBe(4);
    } finally {
      if (prevRoot === undefined) delete process.env.CANS_ROOT;
      else process.env.CANS_ROOT = prevRoot;
      cleanTmpDir(tmp);
    }
  });
});
