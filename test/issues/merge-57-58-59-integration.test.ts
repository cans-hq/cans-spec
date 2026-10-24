/**
 * Merge integration: issue #57 (pointer aliasing) × issue #58 (schematic
 * artifact anchors) × issue #59 (slug-hints default-off) — the cross-feature
 * contracts none of the features' own suites can pin alone.
 *
 *   m1 ... an alias DEFINITION may target a schematic leaf anchor: `see: [1]`
 *          with `- [1]: artifacts/config.json#database.host` passes when the
 *          leaf exists and fails refs.broken.anchor when it does not — the
 *          #58 leaf-path vocabulary applies through #57's indirection, in
 *          every supported format (JSON pinned here; YAML/TOML ride m2/m3)
 *   m2 ... a FLAT single-segment anchor behind an alias on an ambiguous key
 *          (port under two parents) is refs.anchor.ambiguous with full-path
 *          suggestions — through the alias, same verdict as the direct
 *          spelling (#57 must not launder #58's ambiguity check away)
 *   m3 ... bracket-index anchors compose with alias definitions:
 *          `- [1]: artifacts/config.yaml#items[0]` and `#items.1` both
 *          resolve through `see: [1]` / `see: [2]` — the merged
 *          stripRefTrailingPunct bracket repair (from #58) keeps a
 *          definition-line anchor's brackets intact while #57's definition
 *          grammar still accepts the shape
 *   m4 ... #59's default-off composes with alias + schematic features: a
 *          green run carrying aliases AND verified schematic anchors prints
 *          no info band, --json excludes info items while refs.hintCount
 *          carries the count; --hints restores the cheatsheet (opt-in path
 *          stacks with the other two features)
 *   m5 ... one _rules.yaml carrying BOTH new config surfaces
 *          (references.aliasing + output.slug_hints) parses clean and
 *          enforces both; a typo in EITHER rejects line-numbered (strict
 *          #56 validation covers the two new surfaces in one parse)
 */
import { describe, test, expect, afterEach } from '../testing.ts';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

import { spawnCli, REPO } from '../runtime.ts';

const SCRATCH = join(REPO, '.tmp', 'issues', 'merge-57-58-59');

const createdDirs: string[] = [];
let wsSeq = 0;

interface Ws { root: string; cans: string }

/** Fresh scratch workspace under repo/.tmp (gitignored). */
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

function write(ws: Ws, rel: string, content: string): void {
  const p = join(ws.cans, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, content, 'utf8');
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

/** Both new config surfaces, legal and enabled — m5's happy path. */
const RULES_BOTH_ON = [
  'references:',
  '  back_pointers: false',
  '  aliasing:',
  '    enabled: true',
  'output:',
  '  slug_hints: true',
].join('\n') + '\n';

/** Aliasing focused on ANCHOR verification (m1-m3): min_uses 1, so a
 *  single-use alias is legal and the pin isolates the #58 vocabulary.
 *  (min_uses enforcement itself is #57's own suite's job.) */
const RULES_ANCHOR_FOCUS = [
  'references:',
  '  back_pointers: false',
  '  aliasing:',
  '    enabled: true',
  '    min_uses: 1',
].join('\n') + '\n';

afterEach(() => {
  while (createdDirs.length > 0) {
    rmSync(createdDirs.pop()!, { recursive: true, force: true });
  }
});

// ── m1: alias definitions target schematic leaf anchors ─────────────────────

describe('merge #57 × #58: alias definitions resolve schematic leaf anchors', () => {
  test('m1: see: [1] with a JSON leaf-path definition passes; a missing leaf is refs.broken.anchor through the alias', () => {
    const ws = makeWs('m1');
    write(ws, '_rules.yaml', RULES_ANCHOR_FOCUS);
    write(ws, '00-overview.md', [
      '- Overview',
      '  - Host: see: [1]',
      '  - Cache: see: [2]',
      '',
      '- [1]: artifacts/config.json#database.host',
      '- [2]: artifacts/config.json#cache.nope',
    ].join('\n') + '\n');
    write(ws, 'artifacts/config.json', JSON.stringify({
      database: { host: 'db.local', port: 5432 },
      cache: { ttl: 60 },
    }, null, 2) + '\n');

    const r = runCli(['check', '--json'], ws.root);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(false);
    // The good leaf passes through the alias; the missing one is the #58
    // broken-anchor ERROR, not the pre-#58 no-target warning.
    const broken = j.sections.refs.filter((i: any) => i.rule === 'refs.broken.anchor');
    expect(broken).toHaveLength(1);
    expect(broken[0].detail).toContain('cache.nope');
    expect(j.sections.refs.filter((i: any) => i.rule === 'refs.anchor.no-target')).toHaveLength(0);

    // Control: fix the leaf, the same corpus goes green (exit 0, refs 2).
    write(ws, '00-overview.md', [
      '- Overview',
      '  - Host: see: [1]',
      '  - Cache: see: [2]',
      '',
      '- [1]: artifacts/config.json#database.host',
      '- [2]: artifacts/config.json#cache.ttl',
    ].join('\n') + '\n');
    const g = runCli(['check', '--json'], ws.root);
    expect(g.exit).toBe(0);
    const jg = parseJsonOut(g.out);
    expect(jg.ok).toBe(true);
    expect(jg.refs).toEqual({ total: 2, broken: 0, deepHops: 0 });
  });
});

// ── m2: ambiguity is not laundered by aliasing ──────────────────────────────

describe('merge #57 × #58: ambiguous flat anchors stay ambiguous through aliases', () => {
  test('m2: see: [1] on #port (port under two parents) → refs.anchor.ambiguous with full-path suggestions', () => {
    const ws = makeWs('m2');
    write(ws, '_rules.yaml', RULES_ANCHOR_FOCUS);
    write(ws, '00-overview.md', [
      '- Overview',
      '  - Port setting: see: [1]',
      '',
      '- [1]: artifacts/config.yaml#port',
    ].join('\n') + '\n');
    write(ws, 'artifacts/config.yaml', [
      'database:',
      '  host: db.local',
      '  port: 5432',
      'server:',
      '  port: 8080',
    ].join('\n') + '\n');

    const r = runCli(['check', '--json'], ws.root);
    expect(r.exit).toBe(2);
    const j = parseJsonOut(r.out);
    const amb = j.sections.refs.filter((i: any) => i.rule === 'refs.anchor.ambiguous');
    expect(amb).toHaveLength(1);
    // The suggestion teaches the full paths — through the alias exactly as
    // the direct spelling would get them.
    expect(amb[0].detail).toContain('database.port');
    expect(amb[0].detail).toContain('server.port');
  });
});

// ── m3: bracket-index anchors inside alias definitions ──────────────────────

describe('merge #57 × #58: bracket-index anchors compose with alias definitions', () => {
  test('m3: #items[0] and #items.1 definitions both resolve through their alias uses', () => {
    const ws = makeWs('m3');
    write(ws, '_rules.yaml', RULES_ANCHOR_FOCUS);
    write(ws, '00-overview.md', [
      '- Overview',
      '  - First item: see: [1]',
      '  - Second item: see: [2]',
      '',
      // The bracket spelling survives the definition grammar AND the merged
      // trailing-punct strip (the `]` is structural, not glued prose).
      '- [1]: artifacts/config.yaml#items[0]',
      '- [2]: artifacts/config.yaml#items.1',
    ].join('\n') + '\n');
    write(ws, 'artifacts/config.yaml', [
      'items:',
      '  - alpha',
      '  - beta',
    ].join('\n') + '\n');

    const r = runCli(['check', '--json'], ws.root);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    expect(j.refs).toEqual({ total: 2, broken: 0, deepHops: 0 });
  });
});

// ── m4: #59 default-off composes with #57 + #58 ─────────────────────────────

describe('merge #59 × #57/#58: hints stay opt-in beside aliases and schematic anchors', () => {
  test('m4: green corpus (aliases + verified schematic anchors + confusable titles) → quiet by default, --hints restores', () => {
    const ws = makeWs('m4');
    // slug_hints stays at its default (false) — only aliasing is on.
    write(ws, '_rules.yaml', 'references:\n  back_pointers: false\n  aliasing:\n    enabled: true\n');
    write(ws, '00-overview.md', [
      `- Overview`,
      `  - Layer 1 — C authorizer`,
      `  - Token — hygiene: see: [1]`,
      `  - Session — hygiene: see: [1]`,
      '',
      '- [1]: artifacts/config.json#database.host',
    ].join('\n') + '\n');
    write(ws, 'artifacts/config.json', JSON.stringify({ database: { host: 'db.local' } }) + '\n');

    // Default: quiet text — the em-dash titles would have printed the
    // cheatsheet under 0.8.0; beside alias + schematic features they don't.
    const plain = runCli(['check'], ws.root);
    expect(plain.exit).toBe(0);
    expect(plain.out).not.toContain('ℹ');
    expect(plain.out).not.toContain('non-obvious slug');
    expect(plain.out).not.toContain('cans check --show refs');

    // Default --json: no info items anywhere, but the count survives.
    const r = runCli(['check', '--json'], ws.root);
    expect(r.exit).toBe(0);
    const j = parseJsonOut(r.out);
    expect(j.ok).toBe(true);
    for (const arr of Object.values(j.sections) as any[][]) {
      expect(arr.filter(i => i.level === 'info')).toHaveLength(0);
    }
    expect(j.refs.hintCount).toBeGreaterThanOrEqual(1);
    expect(j.refs).toMatchObject({ total: 2, broken: 0, deepHops: 0 });

    // Opt-in: the cheatsheet comes back, alias + anchor still green.
    const h = runCli(['check', '--hints', '--json'], ws.root);
    expect(h.exit).toBe(0);
    const jh = parseJsonOut(h.out);
    const info = jh.sections.refs.filter((i: any) => i.level === 'info');
    expect(info.length).toBe(jh.refs.hintCount);
    expect(info.length).toBeGreaterThanOrEqual(1);
  });
});

// ── m5: both new config surfaces in one _rules.yaml ─────────────────────────

describe('merge #57/#58/#59: references.aliasing + output.slug_hints coexist under strict validation', () => {
  test('m5: both blocks parse and enforce; a typo in either rejects line-numbered', () => {
    // Happy path: both blocks legal → parses, engines behave (two children:
    // no single-child structure warning — exit must be a clean 0).
    const ws = makeWs('m5a');
    write(ws, '_rules.yaml', RULES_BOTH_ON);
    write(ws, '00-overview.md', `- Overview\n  - Scope\n  - Charter\n`);
    const ok = runCli(['check'], ws.root);
    expect(ok.exit).toBe(0);

    // Typo in the aliasing block → the #56 line-numbered config error.
    const ws2 = makeWs('m5b');
    write(ws2, '_rules.yaml', 'references:\n  back_pointers: false\n  aliasing:\n    enbled: true\n');
    write(ws2, '00-overview.md', `- Overview\n  - Scope\n`);
    const bad1 = runCli(['check', '--json'], ws2.root);
    expect(bad1.exit).toBe(2);
    const j1 = parseJsonOut(bad1.out);
    expect(j1.error).toContain('invalid _rules.yaml');
    expect(j1.error).toContain('enbled');
    expect(j1.error).toMatch(/line \d+/);

    // Typo in the output block → same rejection in the same parse.
    const ws3 = makeWs('m5c');
    write(ws3, '_rules.yaml', 'references:\n  back_pointers: false\noutput:\n  slug_hint: true\n');
    write(ws3, '00-overview.md', `- Overview\n  - Scope\n`);
    const bad2 = runCli(['check', '--json'], ws3.root);
    expect(bad2.exit).toBe(2);
    const j2 = parseJsonOut(bad2.out);
    expect(j2.error).toContain('invalid _rules.yaml');
    expect(j2.error).toContain('slug_hint');
    expect(j2.error).toMatch(/line \d+/);
  });
});
