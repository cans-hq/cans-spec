import { describe, test, expect } from 'bun:test';
import { join } from 'path';
import { mkdirSync, existsSync, writeFileSync, renameSync } from 'fs';
import { makeTmpDir, cleanTmpDir, copyFixtureToTmp, readFixture, fixturePath } from './helpers';
import { parseOutline, extractBackPointers, flattenNodes, countNodes, maxDepth } from '../src/core/outline';
import {
  resolveSpecFile, discoverSpecFiles, discoverActiveTasks,
  discoverArchivedTasks, discoverAdrs, globFiles,
} from '../src/core/fs';
import { buildRefGraph, detectOrphans, rebuildBackPointers, detectDeepHops } from '../src/core/refs';
import { normalizeWord, phraseOverlap, wordFrequency } from '../src/core/redundancy';
import { estimateTokens } from '../src/core/token-budget';
import { defaultRules } from '../src/core/rules';
import { slugify, nextAdrNumber } from '../src/commands/new';

const redundancyRules = defaultRules().redundancy;

// ── fs: folder layout + discovery ──

describe('fs discovery', () => {
  test('discovers folder-mode spec files as <dir>/index.md', () => {
    const files = discoverSpecFiles(fixturePath('folder-project'));
    expect(files).toEqual(['02-authentication/index.md', '04-api/index.md', '06-operations/index.md']);
  });

  test('resolves flat ref target to flat file', () => {
    const p = resolveSpecFile(fixturePath('flat-project'), '02-authentication.md');
    expect(p).not.toBeNull();
    expect(p!.endsWith('02-authentication.md')).toBe(true);
  });

  test('resolves flat-named ref target to folder index.md', () => {
    const p = resolveSpecFile(fixturePath('folder-project'), '02-authentication.md');
    expect(p).not.toBeNull();
    expect(p!.endsWith(join('02-authentication', 'index.md'))).toBe(true);
  });

  test('returns null for unresolvable target', () => {
    expect(resolveSpecFile(fixturePath('flat-project'), '99-nonexistent.md')).toBeNull();
  });

  test('globFiles on missing dir returns empty (no throw)', () => {
    expect(globFiles('/definitely/not/here', '*.md')).toEqual([]);
  });

  test('discovers active tasks, archived tasks and ADRs', () => {
    const root = fixturePath('flat-project');
    expect(discoverActiveTasks(root)).toEqual([join('_tasks', 'add-dark-mode.md')]);
    expect(discoverArchivedTasks(root)).toEqual([]);
    expect(discoverAdrs(root)).toEqual([]);
  });
});

// ── outline: back-pointers, multi-refs, line numbers ──

describe('outline extras', () => {
  test('extracts ref-by back-pointers with comma lists', () => {
    const src = readFixture('flat-project', '02-authentication.md');
    const bps = extractBackPointers(src, '02-authentication.md');
    expect(bps.length).toBe(2);
    expect(bps.map(b => b.fromFile).sort()).toEqual(['04-api.md', '05-frontend.md']);
    expect(bps.every(b => b.toFile === '02-authentication.md')).toBe(true);
    expect(bps[0].fromLine).toBe(1);
  });

  test('parses multiple see: refs on one line (both validated)', () => {
    const nodes = parseOutline('- Links: see 02-a.md#X and see 03-b.md\n', 'test.md');
    expect(nodes[0].refs.length).toBe(2);
    expect(nodes[0].refs[0].file).toBe('02-a.md');
    expect(nodes[0].refs[0].anchor).toBe('X');
    expect(nodes[0].refs[1].file).toBe('03-b.md');
    expect(nodes[0].refs[1].anchor).toBeNull();
  });

  test('records 1-based source line numbers', () => {
    const src = '# Title\n\n- First\n- Second\n';
    const nodes = parseOutline(src, 'test.md');
    expect(nodes[0].line).toBe(3);
    expect(nodes[1].line).toBe(4);
  });

  test('folder-mode files parse identically to flat-mode', () => {
    const flat = parseOutline(readFixture('flat-project', '02-authentication.md'), 'a.md');
    const folder = parseOutline(readFixture('folder-project', '02-authentication', 'index.md'), 'a.md');
    expect(countNodes(flat)).toBe(countNodes(folder));
    expect(maxDepth(flat)).toBe(maxDepth(folder));
  });
});

// ── refs: orphans, back-pointer rebuild, no-hop guards ──

describe('refs extras', () => {
  test('orphan detection exempts 00-overview.md', () => {
    const files = new Map<string, any[]>();
    files.set('00-overview.md', parseOutline('- Overview\n  - Product: TBD\n', '00-overview.md'));
    files.set('orphan.md', parseOutline('- Lonely node\n', 'orphan.md'));
    const graph = buildRefGraph(files, '.');
    const issues = detectOrphans(files, graph);
    expect(issues.length).toBe(1);
    expect(issues[0].file).toBe('orphan.md');
    expect(issues[0].message).not.toContain('00-overview.md');
  });

  test('rebuildBackPointers groups incoming refs per target', () => {
    const files = new Map<string, any[]>();
    for (const f of ['02-authentication.md', '04-api.md', '06-operations.md']) {
      files.set(f, parseOutline(readFixture('flat-project', f), f));
    }
    const graph = buildRefGraph(files, '.');
    const rebuilt = rebuildBackPointers(files, graph);
    expect(rebuilt.get('02-authentication.md')).toBe('04-api.md');
    expect(rebuilt.get('03-data.md')).toBe('06-operations.md');
  });

  test('no deep hops when middle file has no outgoing refs', () => {
    const files = new Map<string, any[]>();
    files.set('04-api.md', parseOutline(readFixture('flat-project', '04-api.md'), '04-api.md'));
    files.set('02-authentication.md', parseOutline(readFixture('flat-project', '02-authentication.md'), '02-authentication.md'));
    const graph = buildRefGraph(files, '.');
    expect(detectDeepHops(graph).length).toBe(0);
  });

  test('broken refs alone do not create deep hops', () => {
    const files = new Map<string, any[]>();
    files.set('04-api.md', parseOutline(readFixture('broken-refs-project', '04-api.md'), '04-api.md'));
    const graph = buildRefGraph(files, '.');
    expect(detectDeepHops(graph).length).toBe(0);
  });
});

// ── redundancy: normalization + threshold boundaries ──

describe('redundancy extras', () => {
  test('normalizeWord handles case + punctuation + synonyms', () => {
    expect(normalizeWord('PostgreSQL', redundancyRules.synonyms)).toBe('postgres');
    expect(normalizeWord('PG.', redundancyRules.synonyms)).toBe('postgres');
    expect(normalizeWord('API!', redundancyRules.synonyms)).toBe('api');
    expect(normalizeWord('frontend', redundancyRules.synonyms)).toBe('frontend');
  });

  test('word frequency respects threshold boundary', () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({
      text: `alpha detail ${i}`, file: 'a.md', line: i + 1,
    }));
    expect(wordFrequency(mk(3), redundancyRules).length).toBe(0); // 3 < 4
    const flagged = wordFrequency(mk(4), redundancyRules); // both shared words hit 4
    expect(flagged.length).toBe(2);
    expect(flagged.every(i => i.level === 'warning')).toBe(true);
    expect(flagged.some(i => i.message.includes('"alpha"'))).toBe(true);
    expect(flagged.some(i => i.message.includes('"detail"'))).toBe(true);
  });

  test('phrase overlap ignores disjoint bullets', () => {
    const nodes = [
      { text: 'Cats and dogs play together', file: 'a.md', line: 1 },
      { text: 'Systems need nightly backups', file: 'b.md', line: 2 },
    ];
    expect(phraseOverlap(nodes, 0.7).length).toBe(0);
  });

  test('phrase overlap flags exact cross-file duplicates with location', () => {
    const nodes = [
      { text: 'Sessions expire after 24 hours', file: '02-a.md', line: 4 },
      { text: 'Sessions expire after 24 hours', file: '04-b.md', line: 12 },
    ];
    const issues = phraseOverlap(nodes, 0.7);
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('02-a.md:4');
    expect(issues[0].message).toContain('04-b.md:12');
  });
});

// ── token budget edges ──

describe('token budget edges', () => {
  test('empty text estimates to zero tokens', () => {
    expect(estimateTokens('', 3.5)).toBe(0);
  });

  test('estimate rounds up to whole tokens', () => {
    expect(estimateTokens('abcdef', 4)).toBe(2); // 6/4 = 1.5 → 2
  });
});

// ── new: slugs + ADR numbering ──

describe('new extras', () => {
  test('slugify normalizes punctuation and spacing', () => {
    expect(slugify('PostgreSQL vs MySQL!!')).toBe('postgresql-vs-mysql');
    expect(slugify('  ')).toBe('');
    expect(slugify('Add "Dark Mode" Now')).toBe('add-dark-mode-now');
  });

  test('nextAdrNumber starts at 1 and skips gaps', () => {
    const tmp = makeTmpDir('next-adr');
    try {
      expect(nextAdrNumber(tmp)).toBe(1);
      mkdirSync(join(tmp, '_adr'), { recursive: true });
      writeFileSync(join(tmp, '_adr', '001-one.md'), '# ADR-001\n');
      writeFileSync(join(tmp, '_adr', '003-three.md'), '# ADR-003\n');
      expect(nextAdrNumber(tmp)).toBe(4);
    } finally {
      cleanTmpDir(tmp);
    }
  });
});

// ── command integration: init variants ──

describe('cans init variants', () => {
  test('--folders creates NN/index.md layout', async () => {
    const tmp = makeTmpDir('init-folders');
    try {
      const { run } = await import('../src/commands/init');
      const result = await run(['--folders']);
      expect(result.ok).toBe(true);
      expect(result.created).toContain('02-authentication/index.md');
      expect(result.created).not.toContain('02-authentication.md');
      expect(result.created).toContain('00-overview.md');
      expect(existsSync(join(result.root, '02-authentication', 'index.md'))).toBe(true);
    } finally {
      cleanTmpDir(tmp);
    }
  });

  test('--bare creates only 3 entries', async () => {
    const tmp = makeTmpDir('init-bare');
    try {
      const { run } = await import('../src/commands/init');
      const result = await run(['--bare']);
      expect(result.ok).toBe(true);
      expect(result.created.sort()).toEqual(['00-overview.md', 'AGENTS.md', '_rules.yaml']);
    } finally {
      cleanTmpDir(tmp);
    }
  });

  test('init is idempotent: second run skips all 14 files at same root', async () => {
    const tmp = makeTmpDir('init-idem');
    try {
      const { run } = await import('../src/commands/init');
      const first = await run(['--flat']);
      const second = await run(['--flat']);
      expect(first.ok).toBe(true);
      expect(first.created.length).toBe(14);
      expect(second.ok).toBe(true);
      expect(second.root).toBe(first.root);
      expect(second.created.length).toBe(0);
      expect(second.skipped.length).toBe(14);
      // no nested cans/ workspace inside _adr or _tasks
      expect(existsSync(join(first.root, '_adr', 'cans'))).toBe(false);
      expect(existsSync(join(first.root, '_tasks', 'cans'))).toBe(false);
    } finally {
      cleanTmpDir(tmp);
    }
  });

  test('--force re-creates files but keeps existing dirs as skipped', async () => {
    const tmp = makeTmpDir('init-force');
    try {
      const { run } = await import('../src/commands/init');
      await run(['--flat']);
      const forced = await run(['--flat', '--force']);
      expect(forced.ok).toBe(true);
      expect(forced.created).toContain('00-overview.md');
      expect(forced.created).toContain('_rules.yaml');
      expect(forced.skipped).toContain('_adr/');
    } finally {
      cleanTmpDir(tmp);
    }
  });

  test('--tool claude emits CLAUDE.md from AGENTS.md', async () => {
    const tmp = makeTmpDir('init-tool');
    try {
      const { run } = await import('../src/commands/init');
      const result = await run(['--flat', '--tool', 'claude']);
      expect(result.ok).toBe(true);
      expect(result.created).toContain('CLAUDE.md');
      const agents = await Bun.file(join(result.root, 'AGENTS.md')).text();
      const claude = await Bun.file(join(result.root, 'CLAUDE.md')).text();
      expect(claude).toBe(agents);
    } finally {
      cleanTmpDir(tmp);
    }
  });

  test('init templates are check-clean (all engines pass)', async () => {
    const tmp = makeTmpDir('init-clean');
    try {
      const { run: initRun } = await import('../src/commands/init');
      const { run: checkRun } = await import('../src/commands/check');
      const init = await initRun(['--flat']);
      const check = await checkRun([]);
      expect(init.ok).toBe(true);
      expect(check.errorCount).toBe(0);
      expect(check.ok).toBe(true);
    } finally {
      cleanTmpDir(tmp);
    }
  });
});

// ── command integration: check --fix + folder-mode check ──

describe('cans check --fix and folder mode', () => {
  test('--fix rewrites stale back-pointer comments only', async () => {
    const tmp = makeTmpDir('check-fix');
    try {
      copyFixtureToTmp('flat-project', tmp);
      const { run } = await import('../src/commands/check');
      const fixed = await run(['--fix']);
      expect(fixed.ok).toBe(true);
      expect(fixed.backPointersUpdated).toBeGreaterThanOrEqual(1);
      const content = await Bun.file(join(tmp, 'flat-project', '02-authentication.md')).text();
      expect(content.split('\n')[0]).toContain('ref-by: 04-api.md');
      expect(content.split('\n')[0]).not.toContain('05-frontend.md');
      // re-check: no stale back-pointers remain
      const after = await run([]);
      expect(after.backPointers.stale).toBe(0);
      expect(after.backPointers.current).toBe(after.backPointers.total);
    } finally {
      cleanTmpDir(tmp);
    }
  });

  test('folder-mode workspace resolves refs and stays clean', async () => {
    const tmp = makeTmpDir('check-folder');
    try {
      copyFixtureToTmp('folder-project', tmp);
      const { run } = await import('../src/commands/check');
      const result = await run([]);
      expect(result.ok).toBe(true);
      expect(result.errorCount).toBe(0);
      expect(result.files).toBe(3);
      expect(result.refs.broken).toBe(0);
    } finally {
      cleanTmpDir(tmp);
    }
  });

  test('workspace with no spec files reports zero-file result', async () => {
    const tmp = makeTmpDir('check-empty');
    try {
      mkdirSync(join(tmp, 'empty-ws'), { recursive: true });
      writeFileSync(join(tmp, 'empty-ws', '_rules.yaml'), 'structure:\n  node_length: { min: 3, max: 120 }\n');
      const { run } = await import('../src/commands/check');
      const result = await run([]);
      expect(result.ok).toBe(true);
      expect(result.files).toBe(0);
      expect(result.nodes).toBe(0);
    } finally {
      cleanTmpDir(tmp);
    }
  });
});

// ── command integration: done gates ──

describe('cans done gate enforcement', () => {
  async function loadDone() {
    return (await import('../src/commands/done')).run;
  }

  test('human gate blocks even with --allow-incomplete (never skippable)', async () => {
    const tmp = makeTmpDir('done-human');
    try {
      copyFixtureToTmp('flat-project', tmp);
      const done = await loadDone();
      const result = await done(['add-dark-mode', '--allow-incomplete']);
      expect(result.ok).toBe(false);
      expect(result.gates.humanOpen).toBe(1);
      expect(result.archived).toBeNull();
    } finally {
      cleanTmpDir(tmp);
    }
  });

  test('all gates checked: task archives to _tasks/_archive/YYYY-MM-DD-<name>.md', async () => {
    const tmp = makeTmpDir('done-success');
    try {
      copyFixtureToTmp('flat-project', tmp);
      const taskPath = join(tmp, 'flat-project', '_tasks', 'add-dark-mode.md');
      let task = await Bun.file(taskPath).text();
      task = task.replace(/- \[ \]/g, '- [x]');
      writeFileSync(taskPath, task);
      const done = await loadDone();
      const result = await done(['add-dark-mode']);
      expect(result.ok).toBe(true);
      expect(result.gates.humanOpen).toBe(0);
      expect(result.gates.tasksOpen).toBe(0);
      expect(result.archived).toContain('_tasks/_archive/');
      expect(result.archived).toMatch(/\d{4}-\d{2}-\d{2}-add-dark-mode\.md$/);
      expect(existsSync(join(tmp, 'flat-project', result.archived!))).toBe(true);
      expect(existsSync(taskPath)).toBe(false);
    } finally {
      cleanTmpDir(tmp);
    }
  });

  test('open tasks block without --allow-incomplete, archive with it', async () => {
    const tmp = makeTmpDir('done-incomplete');
    try {
      copyFixtureToTmp('flat-project', tmp);
      const taskPath = join(tmp, 'flat-project', '_tasks', 'add-dark-mode.md');
      let task = await Bun.file(taskPath).text();
      task = task.replace('- [ ] Spec approved ← @human', '- [x] Spec approved ← @human'); // only gate checked
      writeFileSync(taskPath, task);
      const done = await loadDone();
      const blocked = await done(['add-dark-mode']);
      expect(blocked.ok).toBe(false);
      expect(blocked.gates.tasksOpen).toBeGreaterThan(0);
      expect(blocked.archived).toBeNull();
      const allowed = await done(['add-dark-mode', '--allow-incomplete']);
      expect(allowed.ok).toBe(true);
      expect(allowed.archived).toContain('add-dark-mode');
    } finally {
      cleanTmpDir(tmp);
    }
  });

  test('missing task file fails without archiving', async () => {
    const tmp = makeTmpDir('done-missing');
    try {
      copyFixtureToTmp('flat-project', tmp);
      const done = await loadDone();
      const result = await done(['no-such-task']);
      expect(result.ok).toBe(false);
      expect(result.archived).toBeNull();
    } finally {
      cleanTmpDir(tmp);
    }
  });
});

// ── command integration: import / export ──

describe('cans import / export', () => {
  test('import opml writes a new numbered CANS spec preserving hierarchy', async () => {
    const tmp = makeTmpDir('import-opml');
    try {
      const out = join(tmp, 'out');
      mkdirSync(out, { recursive: true });
      const { run } = await import('../src/commands/import');
      const result = await run(['opml', fixturePath('import-fixtures', 'dynalist-export.opml'), '--out', out]);
      expect(result.ok).toBe(true);
      expect(result.format).toBe('opml');
      expect(result.newFiles.length).toBe(1);
      expect(result.newFiles[0]).toMatch(/^\d{2}-.+\.md$/);
      const written = await Bun.file(join(out, result.newFiles[0])).text();
      expect(written).toContain('- Authentication');
      expect(written).toContain('  - Sign up');
      expect(written).toContain('    - Email');
      expect(written).toContain('- Dashboard');
    } finally {
      cleanTmpDir(tmp);
    }
  });

  test('import --dry-run reports but writes nothing', async () => {
    const tmp = makeTmpDir('import-dry');
    try {
      const out = join(tmp, 'out');
      const { run } = await import('../src/commands/import');
      const result = await run(['logseq', fixturePath('import-fixtures', 'logseq-page.md'), '--out', out, '--dry-run']);
      expect(result.ok).toBe(true);
      expect(result.newFiles.length).toBe(1);
      expect(existsSync(out)).toBe(false);
    } finally {
      cleanTmpDir(tmp);
    }
  });

  test('export obsidian converts see: refs to wiki-links', async () => {
    const tmp = makeTmpDir('export-obsidian');
    try {
      const vault = join(tmp, 'vault');
      const { run } = await import('../src/commands/export');
      const result = await run(['obsidian', '--from', fixturePath('flat-project'), '--vault', vault]);
      expect(result.ok).toBe(true);
      expect(result.filesExported).toBe(3);
      const api = await Bun.file(join(vault, 'obsidian', '04-api.md')).text();
      expect(api).toContain('[[02-authentication#Sessions]]');
      expect(api).not.toContain('see 02-authentication.md');
    } finally {
      cleanTmpDir(tmp);
    }
  });

  test('export dry-run writes no files', async () => {
    const tmp = makeTmpDir('export-dry');
    try {
      const vault = join(tmp, 'vault');
      const { run } = await import('../src/commands/export');
      const result = await run(['logseq', '--from', fixturePath('flat-project'), '--vault', vault, '--dry-run']);
      expect(result.ok).toBe(true);
      expect(result.filesExported).toBe(3);
      expect(existsSync(vault)).toBe(false);
    } finally {
      cleanTmpDir(tmp);
    }
  });
});
