import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { makeTmpDir, cleanTmpDir, outputFixture, copyFixtureToTmp } from './helpers';

describe('cans init', () => {
  test('creates workspace skeleton', async () => {
    const tmp = makeTmpDir('cmd-init');
    try {
      const { run } = await import('../src/commands/init');
      const result = await run(['--flat']);
      expect(result.ok).toBe(true);
      expect(result.command).toBe('init');
      expect(result.created).toContain('00-overview.md');
      expect(result.created).toContain('_rules.yaml');
    } finally {
      cleanTmpDir(tmp);
    }
  });

  test('matches output fixture', async () => {
    const expected = outputFixture('init.json');
    const tmp = makeTmpDir('cmd-init-fixture');
    try {
      const { run } = await import('../src/commands/init');
      const result = await run(['--flat']);
      expect(result.created.length).toBe((expected as any).created.length);
    } finally {
      cleanTmpDir(tmp);
    }
  });
});

describe('cans check', () => {
  test('clean project returns zero issues', async () => {
    const tmp = makeTmpDir('cmd-check-clean');
    try {
      copyFixtureToTmp('flat-project', tmp);
      const { run } = await import('../src/commands/check');
      const result = await run([]);
      expect(result.ok).toBe(true);
      expect(result.errorCount).toBe(0);
    } finally {
      cleanTmpDir(tmp);
    }
  });

  test('detects deep hops', async () => {
    const tmp = makeTmpDir('cmd-check-deephop');
    try {
      copyFixtureToTmp('deep-hop-project', tmp);
      const { run } = await import('../src/commands/check');
      const result = await run([]);
      expect(result.ok).toBe(false);
      expect(result.refs.deepHops).toBe(1);
    } finally {
      cleanTmpDir(tmp);
    }
  });

  test('detects broken refs', async () => {
    const tmp = makeTmpDir('cmd-check-broken');
    try {
      copyFixtureToTmp('broken-refs-project', tmp);
      const { run } = await import('../src/commands/check');
      const result = await run([]);
      expect(result.ok).toBe(false);
      expect(result.refs.broken).toBeGreaterThanOrEqual(2);
    } finally {
      cleanTmpDir(tmp);
    }
  });
});

describe('cans new', () => {
  test('creates task file', async () => {
    const tmp = makeTmpDir('cmd-new-task');
    try {
      const { run } = await import('../src/commands/new');
      const result = await run(['task', 'add-dark-mode']);
      expect(result.ok).toBe(true);
      expect(result.file).toContain('add-dark-mode');
    } finally {
      cleanTmpDir(tmp);
    }
  });

  test('slugifies title', async () => {
    const { slugify } = await import('../src/commands/new');
    expect(slugify('Add Dark Mode!')).toBe('add-dark-mode');
    expect(slugify("What's Next?")).toBe('what-s-next');
  });
});

describe('cans done', () => {
  test('blocks on human gate', async () => {
    const tmp = makeTmpDir('cmd-done-blocked');
    try {
      copyFixtureToTmp('flat-project', tmp);
      const { run } = await import('../src/commands/done');
      const result = await run(['add-dark-mode']);
      expect(result.ok).toBe(false);
      expect(result.gates.humanOpen).toBeGreaterThan(0);
    } finally {
      cleanTmpDir(tmp);
    }
  });
});

describe('cans status', () => {
  test('returns workspace summary', async () => {
    const tmp = makeTmpDir('cmd-status');
    try {
      copyFixtureToTmp('flat-project', tmp);
      const { run } = await import('../src/commands/status');
      const result = await run([]);
      expect(result.ok).toBe(true);
      expect(result.command).toBe('status');
      expect(result.activeTasks).toBeGreaterThan(0);
    } finally {
      cleanTmpDir(tmp);
    }
  });
});

describe('cans budget', () => {
  test('read returns plan', async () => {
    const tmp = makeTmpDir('cmd-budget-read');
    try {
      copyFixtureToTmp('budget-project', tmp);
      const { run } = await import('../src/commands/budget');
      const result = await run(['read', 'sessions']);
      expect(result.ok).toBe(true);
      expect(result.command).toBe('budget-read');
    } finally {
      cleanTmpDir(tmp);
    }
  });
});
