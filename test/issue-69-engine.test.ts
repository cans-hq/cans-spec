/**
 * Issue #69 — the ENGINE half: the ARTIFACT target tier of the codebase
 * inbound-references scanner (reported against cans 0.17.0).
 *
 *   the defect — `cans check --codebase` validated pointers whose target is
 *   a `.md` file and SILENTLY IGNORED every pointer whose target is any
 *   other file type, while `cans refs` rejected those targets outright as
 *   malformed. The cans layout puts field layouts, schemas, wire formats,
 *   pipeline diagrams and example code under `cans/artifacts/` — code points
 *   at them too (`// see: cans/artifacts/code/plugin-trait.rs#PluginError`,
 *   `// see: cans/artifacts/diagrams/host-runtime.txt#driver-avf`): on the
 *   reporter's corpus 114 of 1523 codebase `see:` pointers target non-`.md`
 *   files (25 distinct artifact files: .rs, .ts, .py, .yaml, .txt, plus
 *   `cans/_rules.yaml`) — all 114 unvalidated. Break both anchors of the
 *   repro and `check --codebase --json` still reported 0 errors.
 *
 *   the fix — two pieces, both riding seams the tree already owns:
 *    1. EXTRACTION: SEE_POINTER_RE's file group is built from the shared
 *       seam (CODEBASE_TARGET_EXTS → codebaseTargetExtAlt, longest-first)
 *       instead of the `.md` literal — the union of the addressable
 *       vocabularies (.md corpus + #58 schematic + #60 text + #60 code),
 *       and NOTHING more: the extension table is the over-capture guard
 *       (.c/.cpp/.csv/`v1.2`/`e.g` deliberately not targets — no vocabulary
 *       can address them). The .md tier's captures stay byte-identical.
 *    2. RESOLUTION: checkCodebaseRefs grows the artifact tier — a non-`.md`
 *       target resolves against the WORKSPACE FILESYSTEM (resolveSpecFile
 *       containment, issue #10), and an anchored pointer rides
 *       checkArtifactAnchor, the ONE shared verdict function the corpus
 *       refs engine already uses for on-disk artifact refs and `name://`
 *       external refs (exported for exactly this, signature frozen) —
 *       schematic dot paths/ambiguity/parse errors, bullets, #60 text
 *       headings and code symbols, all through the #68 anchorMatches seam.
 *       Its error verdicts map onto the frozen reason union
 *       {FileNotFound, AnchorNotFound} with the WHY riding message +
 *       suggestion; its refs.anchor.no-target downgrade becomes a
 *       scan.warnings ADVISORY (rule 'codebase.anchor.no-target'), never a
 *       finding.
 *
 *   a1-a8 .... extraction (pure, no fs): the full 18-ext matrix, the
 *             tsx/ts alternation trap (and jsx/js, text/txt), the
 *             over-capture guard negatives, the `.md5` stranding (the .md
 *             tier byte-identical), mixed-tier multi-pointer lines, the
 *             cans/ prefix preserved as written, the #67 cleaning pass on
 *             artifact anchors
 *   b1-b3 .... the grammar single-source: codebaseTargetExtAlt longest-
 *             first, SEE_POINTER_RE built FROM it, the membership table
 *             pinned, the table = the union of the vocabularies
 *   c1-c14 ... resolution over tmp workspaces: every vocabulary resolves
 *             (code symbol, text heading, schematic dot path/object, flat
 *             leaf, yaml bullets), file-level pointers, both spellings,
 *             FileNotFound for a missing artifact, the did-you-mean
 *             suggestion echoing the WRITTEN target, the ambiguous flat
 *             name, the schematic parse-error (never a silent pass, never
 *             a crash), the no-target ADVISORY in warnings not findings,
 *             the counters, determinism, and the #68 seam riding (glued
 *             punctuation and the canonical colon spelling both resolve)
 *   d1 ....... the regression pin: a .md pointer beside artifact pointers
 *             extracts and resolves exactly as before — FileNotFound
 *             message byte-identical with the pre-#69 engine
 *
 * Runtime-neutral: imports the test facade, never 'bun:test' directly.
 */
import { describe, test, expect, afterEach } from './testing.ts';
import { join, dirname } from 'path';
import { mkdirSync, writeFileSync } from 'fs';

import {
  SEE_POINTER_RE,
  CODEBASE_TARGET_EXTS,
  codebaseTargetExtAlt,
  extractCodebasePointers,
  checkCodebaseRefs,
} from '../src/core/codebase.ts';
import { defaultCodebaseRules } from '../src/core/rules.ts';
import { parseOutline } from '../src/core/outline.ts';
import { schematicFormatFor } from '../src/core/schematic.ts';
import { isTextArtifact } from '../src/core/text-anchors.ts';
import { isCodeArtifact } from '../src/core/code-anchors.ts';
import { makeTmpDir, cleanTmpDir, makeCansWorkspace } from './helpers.ts';
import type { CodebaseRules, OutlineNode } from '../src/types.ts';

// ── Scaffolding (the issue #67/#68 engine suites' shape) ────────────────────

const tmps: string[] = [];

afterEach(() => {
  while (tmps.length > 0) cleanTmpDir(tmps.pop()!);
});

const cbCfg = (over: Partial<CodebaseRules> = {}): CodebaseRules => ({
  ...defaultCodebaseRules(),
  ...over,
});

/** A PROJECT directory: `files` become the cans/ workspace (workspace-
 *  relative — spec files AND the `artifacts/` tree the pointers name),
 *  `projectFiles` sit beside it (project-relative) — the scanner's turf. */
function makeProject(
  name: string,
  files: Record<string, string> = {},
  projectFiles: Record<string, string> = {},
): { project: string; root: string } {
  const project = makeTmpDir(`issue69-engine-${name}`);
  tmps.push(project);
  const root = makeCansWorkspace(project, files);
  for (const [rel, content] of Object.entries(projectFiles)) {
    const p = join(project, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content, 'utf8');
  }
  return { project, root };
}

/** A corpus map the way check.ts's specFiles is shaped: workspace-relative
 *  keys → parsed outlines (real parsing — node titles are bullet texts). */
function corpusOf(entries: Array<[string, string]>): Map<string, OutlineNode[]> {
  return new Map(entries.map(([key, src]) => [key, parseOutline(src, key)]));
}

// The mini corpus every resolution test rides: one spec file, two nodes —
// enough for the .md tier's pointers to resolve or miss on real anchors.
const CORPUS: Array<[string, string]> = [
  ['00-overview.md', '- Overview\n- Session validation\n'],
];

// ── Shared artifact fixtures (the vocabularies of the repro's shapes) ───────

/** A code artifact: top-level symbols are the addressable units (#60). */
const RS_SRC = [
  'use std::collections::HashMap;',
  '',
  'pub fn federate(h: &mut HashMap<String, String>) {',
  '    h.insert("k".into(), "v".into());',
  '}',
  '',
  'pub struct Registry {',
  '    headers: HashMap<String, String>,',
  '}',
  '',
].join('\n');

/** A text artifact: underlined section headings are the addressable units
 *  (#60) — `driver-avf` plain, `retries:` carrying its own trailing colon
 *  (the #68 canonical-spelling shape, slug-preserved into the heading). */
const TXT_SRC = [
  'driver-avf',
  '----------',
  'AVF driver bring-up sequence.',
  '',
  'retries:',
  '---------',
  'exponential backoff',
  '',
].join('\n');

/** A schematic artifact: parsed dot paths are the addressable units (#58). */
const CONFIG_YAML = 'database:\n  host: db.local\n  port: 5432\n';

/** Flat leaves, a unique flat name, and a block sequence whose items keep
 *  minting bullet nodes (the #49 additive behavior) — all in one file. */
const GOV_YAML = [
  'governance:',
  '  maintenance:',
  '    window: weekly',
  'checklist:',
  '  - first item',
  '  - second item',
  '',
].join('\n');

/** Two leaves sharing the flat name `host` — the #58 ambiguity shape. */
const HOSTS_YAML = 'database:\n  host: db.local\ncache:\n  host: cache.local\n';

/** Beyond the supported YAML subset — the #58 parse-error shape. */
const BAD_YAML = 'database:\n  host: [unclosed\n';

// ── A. Extraction: the widened file group (pure, no fs) ─────────────────────

describe('issue #69 engine — extraction (the artifact target tier)', () => {
  test('a1: every CODEBASE_TARGET_EXTS extension captures its target — the full 18-ext matrix', () => {
    // The table IS the grammar's file group now: each member must extract
    // its whole spelling (targetFile as written, anchor intact). A member
    // that fails here is a table entry no pointer can ever name.
    for (const ext of CODEBASE_TARGET_EXTS) {
      const out = extractCodebasePointers(`// see: cans/artifacts/code/example.${ext}#Anchor`);
      expect(out.length).toBe(1);
      expect(out[0]!.targetFile).toBe(`cans/artifacts/code/example.${ext}`);
      expect(out[0]!.targetSlug).toBe('Anchor');
      expect(out[0]!.raw).toBe(`see: cans/artifacts/code/example.${ext}#Anchor`);
    }
    expect(SEE_POINTER_RE.global).toBe(true); // per-line consumers rely on it (the frozen shape)
  });

  test('a2: the alternation trap — .tsx captures driver.tsx NOT driver.ts (and .jsx/.text likewise)', () => {
    // A regex alternation takes its FIRST matching alternative: in table
    // order `ts` precedes `tsx`, so `driver.tsx` would capture `driver.ts`
    // and strand the `x` — the seam's longest-first sort exists for exactly
    // this. Pinned here so a naive `[...EXTS].join('|')` can never return.
    const tsx = extractCodebasePointers('// see: cans/artifacts/code/driver.tsx#Mount');
    expect(tsx.length).toBe(1);
    expect(tsx[0]!.targetFile).toBe('cans/artifacts/code/driver.tsx'); // NOT .../driver.ts
    expect(tsx[0]!.targetSlug).toBe('Mount');
    const jsx = extractCodebasePointers('// see: cans/artifacts/ui/widget.jsx#Render');
    expect(jsx[0]!.targetFile).toBe('cans/artifacts/ui/widget.jsx'); // NOT .../widget.js
    // The bare members still fire when the longer one cannot — the sort
    // widens, it never blocks the plain spellings.
    expect(extractCodebasePointers('// see: cans/artifacts/code/driver.ts#Mount')[0]!.targetFile)
      .toBe('cans/artifacts/code/driver.ts');
    expect(extractCodebasePointers('// see: cans/artifacts/ui/widget.js#Render')[0]!.targetFile)
      .toBe('cans/artifacts/ui/widget.js');
    // The 4-vs-3 pair behaves the same way: `text` wins over `txt` only
    // when the spelling actually carries it.
    expect(extractCodebasePointers('// see: cans/artifacts/notes.text#Head')[0]!.targetFile)
      .toBe('cans/artifacts/notes.text');
    expect(extractCodebasePointers('// see: cans/artifacts/notes.txt#Head')[0]!.targetFile)
      .toBe('cans/artifacts/notes.txt');
  });

  test('a3: the over-capture guard — .c/.cpp/.csv/uppercase .RS/v1.2/e.g/bare stems mint NOTHING', () => {
    // The extension table is the guard: none of these spellings names a
    // file any anchor vocabulary can address, so capturing them could only
    // mint unresolvable-anchor noise, never a verified pointer. (.c/.cpp
    // ARE scanned SOURCE extensions — the RFC §3 code set — but a pointer
    // may not TARGET them: the asymmetry is deliberate.)
    const negatives = [
      '// see: src/main.c',
      '// see: src/kernel.cpp',
      '// see: data/export.csv',
      '// see: cans/artifacts/code/driver.RS', // uppercase: the .md spelling rule — extensions are lowercase
      '// see: spec v1.2 and later',
      '// see: e.g. the runbook above',
      'see e.g. the runbook above', // no `see:` keyword shape at all
      '// see: runbook',             // bare stem — no extension
    ];
    for (const line of negatives) {
      expect(extractCodebasePointers(line)).toEqual([]);
    }
  });

  test('a4: `foo.md5` never becomes a target — the table matches md, the digit run strands', () => {
    // The pre-#69 extractor captured `foo.md` from `see: foo.md5` (the path
    // class stops at the dot, `md` matches, the `5` is not `#`-shaped so
    // the optional anchor group takes nothing); the #69 regex keeps that
    // capture EXACTLY — the .md tier is byte-identical. The guard's claim
    // is precise: `md5` is not in the table, so no pointer ever NAMES a
    // `.md5` file (a checksum sidecar no vocabulary can address).
    const out = extractCodebasePointers('// see: foo.md5');
    expect(out.length).toBe(1);
    expect(out[0]!.targetFile).toBe('foo.md');
    expect(out[0]!.targetSlug).toBeNull();
    expect(out.every(p => !p.targetFile.endsWith('.md5'))).toBe(true);
  });

  test('a5: multiple pointers on one line — .md and artifact targets side by side, left-to-right', () => {
    const out = extractCodebasePointers(
      '// see: 00-overview.md#Session-validation and see: cans/artifacts/code/x.rs#federate, then see: artifacts/diagrams/host-runtime.txt#driver-avf',
    );
    expect(out.length).toBe(3);
    expect(out[0]!.targetFile).toBe('00-overview.md'); // the .md tier, exactly as before
    expect(out[0]!.targetSlug).toBe('Session-validation');
    expect(out[1]!.targetFile).toBe('cans/artifacts/code/x.rs');
    expect(out[1]!.targetSlug).toBe('federate'); // the glued `,` cleaned by the #67 pass
    expect(out[2]!.targetFile).toBe('artifacts/diagrams/host-runtime.txt'); // no cans/ — as written
    expect(out[2]!.targetSlug).toBe('driver-avf');
  });

  test('a6: the cans/ prefix is preserved in targetFile AS WRITTEN (both artifact spellings)', () => {
    // The #66 convention, unchanged by the widening: `raw` and `targetFile`
    // quote the written spelling; the prefix strips only at resolution, so
    // `refs --codebase` can echo what the author wrote.
    const prefixed = extractCodebasePointers('// see: cans/artifacts/code/plugin-trait.rs#PluginError');
    expect(prefixed[0]!.raw).toBe('see: cans/artifacts/code/plugin-trait.rs#PluginError');
    expect(prefixed[0]!.targetFile).toBe('cans/artifacts/code/plugin-trait.rs');
    const bare = extractCodebasePointers('// see: artifacts/code/plugin-trait.rs#PluginError');
    expect(bare[0]!.raw).toBe('see: artifacts/code/plugin-trait.rs#PluginError');
    expect(bare[0]!.targetFile).toBe('artifacts/code/plugin-trait.rs');
  });

  test('a7: artifact anchors clean exactly like .md anchors — glued punctuation strips at extraction', () => {
    // The issue's own repro spelling: a diagram pointer whose anchor is
    // glued to sentence punctuation. The #67 pass is target-type-agnostic:
    // raw keeps the written span, targetSlug carries the resolvable token.
    const dot = extractCodebasePointers('// see: cans/artifacts/diagrams/host-runtime.txt#driver-avf.)');
    expect(dot.length).toBe(1);
    expect(dot[0]!.raw).toBe('see: cans/artifacts/diagrams/host-runtime.txt#driver-avf.)');
    expect(dot[0]!.targetSlug).toBe('driver-avf');
    const semi = extractCodebasePointers('verify(x); /* (see: artifacts/code/x.rs#federate); */');
    expect(semi[0]!.raw).toBe('see: artifacts/code/x.rs#federate);');
    expect(semi[0]!.targetSlug).toBe('federate');
  });

  test('a8: an artifact anchor that cleans to empty degrades to a file-level pointer (the #67 rule)', () => {
    const out = extractCodebasePointers('// see: cans/artifacts/diagrams/host-runtime.txt#).');
    expect(out.length).toBe(1);
    expect(out[0]!.targetFile).toBe('cans/artifacts/diagrams/host-runtime.txt');
    expect(out[0]!.targetSlug).toBeNull(); // pure glue — the file target is real
  });
});

// ── B. The grammar single-source (pointer grammar ≡ query grammar) ──────────

describe('issue #69 engine — the extension-table seam', () => {
  test('b1: codebaseTargetExtAlt() is LONGEST-FIRST — tsx before ts, jsx before js, lengths non-increasing', () => {
    const alt = codebaseTargetExtAlt().split('|');
    // The prefix pairs, pinned explicitly (a2 is the behavior pin; this is
    // the ordering pin at the source).
    expect(alt.indexOf('tsx')).toBeLessThan(alt.indexOf('ts'));
    expect(alt.indexOf('jsx')).toBeLessThan(alt.indexOf('js'));
    // No member is ever shadowed by a longer member AFTER it.
    for (let i = 1; i < alt.length; i++) {
      expect(alt[i - 1]!.length).toBeGreaterThanOrEqual(alt[i]!.length);
    }
    // The extractor's file group is BUILT from this alternation — the
    // single-source contract: pointer grammar and `cans refs` query grammar
    // can never drift apart (a query must name everything a pointer can).
    expect(SEE_POINTER_RE.source).toContain(codebaseTargetExtAlt());
  });

  test('b2: CODEBASE_TARGET_EXTS membership pinned — additions/removals must be conscious', () => {
    // The table is policy, not accident: every entry names a vocabulary
    // that can address it, every omission names one that cannot. Changing
    // this list changes what `check --codebase` validates AND what
    // `cans refs` accepts — re-pin this test with your WHY when you touch it.
    expect(CODEBASE_TARGET_EXTS).toEqual([
      'md',                                            // the corpus tier (spec files)
      'json', 'yaml', 'yml', 'toml',                   // the schematic vocabulary (#58)
      'txt', 'text',                                   // the text-heading vocabulary (#60)
      'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'rs', 'py', 'go', // the code-symbol vocabulary (#60)
    ]);
  });

  test('b3: the table IS the union of the addressable vocabularies (plus .md) — the keep-in-sync guard', () => {
    // Every schematic/text/code extension must be a legal target, and
    // nothing outside the table may be addressable by any vocabulary —
    // otherwise the grammar either over-captures (noise) or under-captures
    // (silently unvalidated pointers, the very defect #69 fixes).
    for (const ext of ['json', 'yaml', 'yml', 'toml']) {
      expect(schematicFormatFor(`x.${ext}`)).not.toBeNull();
    }
    for (const ext of ['txt', 'text']) {
      expect(isTextArtifact(`x.${ext}`)).toBe(true);
    }
    for (const ext of ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'rs', 'py', 'go']) {
      expect(isCodeArtifact(`x.${ext}`)).toBe(true);
    }
    for (const ext of ['c', 'cpp', 'csv', 'md5']) {
      expect(schematicFormatFor(`x.${ext}`)).toBeNull();
      expect(isTextArtifact(`x.${ext}`)).toBe(false);
      expect(isCodeArtifact(`x.${ext}`)).toBe(false);
    }
  });
});

// ── C. Resolution: the artifact tier in checkCodebaseRefs ───────────────────

describe('issue #69 engine — resolution (the artifact tier, end to end)', () => {
  test('c1: a code-symbol anchor resolves — pub fn federate in artifacts/x.rs', async () => {
    const { root } = makeProject('code-symbol', {
      '00-overview.md': CORPUS[0]![1],
      'artifacts/code/x.rs': RS_SRC,
    }, {
      'src/driver.rs': '// see: cans/artifacts/code/x.rs#federate\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings).toEqual([]); // the silently-unvalidated class, now verified and passing
    expect(scan.pointers).toBe(1);
    expect(scan.scanned).toBe(1);
  });

  test('c2: a text-heading anchor resolves — the underlined driver-avf heading in a .txt', async () => {
    const { root } = makeProject('text-heading', {
      '00-overview.md': CORPUS[0]![1],
      'artifacts/diagrams/host-runtime.txt': TXT_SRC,
    }, {
      'src/driver.rs': '// see: cans/artifacts/diagrams/host-runtime.txt#driver-avf\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings).toEqual([]);
    expect(scan.pointers).toBe(1);
  });

  test('c3: schematic anchors resolve — the dot path AND the intermediate object', async () => {
    // #58 contract 2 (a scalar leaf resolves) and contract 4 (an
    // intermediate object is a valid address) ride through the codebase
    // tier unchanged — the SAME shared verdict function.
    const { root } = makeProject('schematic', {
      '00-overview.md': CORPUS[0]![1],
      'artifacts/config.yaml': CONFIG_YAML,
    }, {
      'src/driver.rs': [
        '// see: cans/artifacts/config.yaml#database.host',
        '// see: cans/artifacts/config.yaml#database',
        '',
      ].join('\n'),
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings).toEqual([]);
    expect(scan.pointers).toBe(2);
  });

  test('c4: a flat schematic leaf and yaml block-sequence bullets resolve (the #58/#49 behaviors ride through)', async () => {
    const { root } = makeProject('flat-and-bullets', {
      '00-overview.md': CORPUS[0]![1],
      'artifacts/governance.yaml': GOV_YAML,
    }, {
      'src/driver.rs': [
        '// see: cans/artifacts/governance.yaml#window',      // flat name, unique leaf
        '// see: cans/artifacts/governance.yaml#first-item',  // a block-sequence bullet node
        '// see: cans/artifacts/governance.yaml#maintenance', // an intermediate object, path-form
        '',
      ].join('\n'),
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings).toEqual([]);
    expect(scan.pointers).toBe(3);
  });

  test('c5: file-level artifact pointers resolve — no anchor, nothing verified, no read', async () => {
    const { root } = makeProject('file-level', {
      '00-overview.md': CORPUS[0]![1],
      'artifacts/code/x.rs': RS_SRC,
      'artifacts/config.yaml': CONFIG_YAML,
    }, {
      'src/driver.rs': [
        '// see: cans/artifacts/code/x.rs',
        '// see: artifacts/config.yaml',
        '',
      ].join('\n'),
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings).toEqual([]);
    expect(scan.warnings).toEqual([]);
    expect(scan.pointers).toBe(2);
  });

  test('c6: both spellings resolve — with and without the cans/ prefix', async () => {
    const { root } = makeProject('spellings', {
      '00-overview.md': CORPUS[0]![1],
      'artifacts/code/x.rs': RS_SRC,
    }, {
      'src/a.rs': '// see: cans/artifacts/code/x.rs#federate\n',
      'src/b.rs': '// see: artifacts/code/x.rs#federate\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings).toEqual([]);
    expect(scan.pointers).toBe(2);
  });

  test('c7: a missing artifact file ⇒ FileNotFound, the artifact message family', async () => {
    const { root } = makeProject('missing-artifact', {
      '00-overview.md': CORPUS[0]![1],
    }, {
      'src/driver.rs': '// see: cans/artifacts/code/ghost.rs#Nope\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings.length).toBe(1);
    const f = scan.findings[0]!;
    expect(f.reason).toBe('FileNotFound');
    expect(f.resolvedFile).toBeNull();
    expect(f.file).toBe('src/driver.rs');
    expect(f.line).toBe(1);
    expect(f.raw).toBe('see: cans/artifacts/code/ghost.rs#Nope');
    expect(f.targetFile).toBe('cans/artifacts/code/ghost.rs');
    expect(f.targetSlug).toBe('Nope');
    expect(f.message).toBe(
      'broken codebase ref: src/driver.rs:1 — see: cans/artifacts/code/ghost.rs#Nope — artifact target not found in the cans workspace',
    );
    expect(f.suggestion).toBeUndefined();
  });

  test('c8: a broken code anchor ⇒ AnchorNotFound with a did-you-mean proposing the real symbol', async () => {
    const { root } = makeProject('broken-code-anchor', {
      '00-overview.md': CORPUS[0]![1],
      'artifacts/code/x.rs': RS_SRC,
    }, {
      'src/driver.rs': '// see: cans/artifacts/code/x.rs#federat\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings.length).toBe(1);
    const f = scan.findings[0]!;
    expect(f.reason).toBe('AnchorNotFound');
    expect(f.resolvedFile).toBe('artifacts/code/x.rs'); // workspace-relative, / separators
    expect(f.message).toBe(
      'broken codebase ref: src/driver.rs:1 — see: cans/artifacts/code/x.rs#federat — broken anchor: cans/artifacts/code/x.rs#federat — no node matches',
    );
    // The suggestion echoes the WRITTEN targetFile (the anchorSuggestion
    // writtenTarget convention) — both spellings resolve, so either is a
    // valid fix, but the advice quotes what the author wrote.
    expect(f.suggestion).toBe('did you mean cans/artifacts/code/x.rs#federate? — fix the ref anchor');
  });

  test('c9: an ambiguous flat schematic name ⇒ AnchorNotFound, the suggestion proposes the dot form', async () => {
    const { root } = makeProject('ambiguous-flat', {
      '00-overview.md': CORPUS[0]![1],
      'artifacts/hosts.yaml': HOSTS_YAML,
    }, {
      'src/driver.rs': '// see: cans/artifacts/hosts.yaml#host\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings.length).toBe(1);
    const f = scan.findings[0]!;
    expect(f.reason).toBe('AnchorNotFound'); // the finer grain rides the message, not the reason union
    expect(f.message).toBe(
      'broken codebase ref: src/driver.rs:1 — see: cans/artifacts/hosts.yaml#host — ambiguous anchor: cans/artifacts/hosts.yaml#host — flat name matches multiple leaves: database.host, cache.host',
    );
    expect(f.suggestion).toBe(
      'use the full path form: cans/artifacts/hosts.yaml#database.host or cans/artifacts/hosts.yaml#cache.host',
    );
  });

  test('c10: an unparseable YAML artifact + anchor ⇒ AnchorNotFound with the parse-error message — never silent, never a crash', async () => {
    const { root } = makeProject('parse-error', {
      '00-overview.md': CORPUS[0]![1],
      'artifacts/bad.yaml': BAD_YAML,
    }, {
      'src/driver.rs': '// see: cans/artifacts/bad.yaml#database.host\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings.length).toBe(1);
    const f = scan.findings[0]!;
    expect(f.reason).toBe('AnchorNotFound');
    expect(f.message).toContain('schematic parse error: cans/artifacts/bad.yaml#database.host');
    expect(f.message).toContain('YAML line 2');
    expect(f.message).toContain('unterminated flow collection');
    expect(f.suggestion).toContain('fix cans/artifacts/bad.yaml');
  });

  test('c11: an artifact with NOTHING addressable + anchor ⇒ the codebase.anchor.no-target WARNING, not a finding', async () => {
    // An empty .txt has no bullets, no schematic paths, no headings, no
    // symbols — no anchor could ever resolve there by construction. The
    // corpus engine downgrades this to an advisory (refs.anchor.no-target);
    // the codebase tier mirrors it: scan.warnings, never findings — an
    // advisory, not a broken pointer.
    const { root } = makeProject('no-target', {
      '00-overview.md': CORPUS[0]![1],
      'artifacts/empty.txt': '',
    }, {
      'src/driver.rs': '// see: cans/artifacts/empty.txt#anything\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings).toEqual([]);
    expect(scan.warnings.length).toBe(1);
    const w = scan.warnings[0]!;
    expect(w.file).toBe('src/driver.rs');
    expect(w.line).toBe(1);
    expect(w.level).toBe('warning');
    expect(w.category).toBe('refs');
    expect(w.rule).toBe('codebase.anchor.no-target');
    expect(w.message).toBe(
      // issue #70: the parenthetical vocabulary list widened with the leaf
      // tier (referenced names, text tokens) — bytes re-pinned to the emission.
      // issue #71: the entry tier (text entries) joined the list — bytes
      // re-pinned again, seven vocabularies.
      'anchor on artifact target: cans/artifacts/empty.txt#anything — target has no addressable nodes (bullets, schematic key paths, text headings, text entries, code symbols, referenced names, text tokens); use a file-level ref',
    );
    expect(w.suggestion).toBe(
      'drop the #anything anchor (file-level refs are valid on any target), or add the anchor as a node/key in cans/artifacts/empty.txt',
    );
  });

  test('c12: counters — pointers includes artifact pointers; scanned counts files regardless of target type', async () => {
    const { root } = makeProject('counters', {
      '00-overview.md': CORPUS[0]![1],
      'artifacts/code/x.rs': RS_SRC,
    }, {
      'src/mixed.rs': [
        '// see: 00-overview.md#Session-validation',   // .md, resolves
        '// see: 00-overview.md',                      // .md, file-level
        '// see: cans/artifacts/code/x.rs#federate',   // artifact, resolves
        '// see: cans/artifacts/code/x.rs',            // artifact, file-level
        '',
      ].join('\n'),
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.scanned).toBe(1);          // files scanned — unchanged by target type
    expect(scan.pointers).toBe(4);         // every extracted pointer, both tiers
    expect(scan.findings).toEqual([]);
    expect(scan.warnings).toEqual([]);
  });

  test('c13: determinism — findings in file-asc/line-asc order across a multi-file workspace', async () => {
    const { root } = makeProject('order', {
      '00-overview.md': CORPUS[0]![1],
      'artifacts/code/x.rs': RS_SRC,
    }, {
      'src/zeta.rs': [
        '// see: cans/artifacts/code/ghost.rs#Nope', // artifact FileNotFound, line 1
        '// see: cans/artifacts/code/x.rs#federat',  // artifact AnchorNotFound, line 2
        '',
      ].join('\n'),
      'src/alpha.rs': [
        '// see: 99-nope.md#Ghost',                  // .md FileNotFound, line 1
        '// see: cans/artifacts/code/x.rs#federate', // resolves, line 2
        '',
      ].join('\n'),
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings.map(f => [f.file, f.line, f.reason])).toEqual([
      ['src/alpha.rs', 1, 'FileNotFound'],   // .md tier and artifact tier interleave
      ['src/zeta.rs', 1, 'FileNotFound'],    // by document order, not by tier
      ['src/zeta.rs', 2, 'AnchorNotFound'],
    ]);
  });

  test('c14: the #68 seam rides — glued punctuation and the canonical colon spelling both resolve', async () => {
    // Two shapes the anchor-matching seam already owns, now proven at the
    // artifact tier: (1) an anchor glued to prose punctuation cleans at
    // extraction (#67) and resolves; (2) a heading carrying its OWN trailing
    // colon (`retries:` — slug-preserved into the addressable heading, the
    // canonical spelling `cans slug` would print) resolves through the #68
    // cleaned-vs-cleaned clause — pre-#68 this was a false positive.
    const { root } = makeProject('seam', {
      '00-overview.md': CORPUS[0]![1],
      'artifacts/diagrams/host-runtime.txt': TXT_SRC,
    }, {
      'src/driver.rs': [
        '// see: cans/artifacts/diagrams/host-runtime.txt#driver-avf.', // glued `.` (prose)
        '// see: cans/artifacts/diagrams/host-runtime.txt#retries:',    // canonical colon spelling
        '',
      ].join('\n'),
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings).toEqual([]);
    expect(scan.pointers).toBe(2);
  });
});

// ── D. Regression pins: the .md tier beside the new one ─────────────────────

describe('issue #69 engine — the .md tier, unchanged', () => {
  test('d1: a .md pointer beside artifact pointers — FileNotFound message byte-identical with pre-#69', async () => {
    const { root } = makeProject('md-regression', {
      '00-overview.md': CORPUS[0]![1],
      'artifacts/code/x.rs': RS_SRC,
    }, {
      'src/mixed.rs': [
        '// see: 00-overview.md#Session-validation',  // .md, resolves as ever
        '// see: 99-nope.md#Ghost',                   // .md, missing — the byte-unchanged finding
        '// see: cans/artifacts/code/x.rs#federate',  // artifact, resolves (the new tier)
        '// see: cans/artifacts/code/ghost.rs#Nope',  // artifact, missing (the new tier)
        '',
      ].join('\n'),
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.pointers).toBe(4);
    expect(scan.findings.length).toBe(2);
    // The .md FileNotFound finding — the exact pre-#69 message, byte for
    // byte (the issue66-engine c2 pin, now proven coexisting with the tier).
    expect(scan.findings[0]!.reason).toBe('FileNotFound');
    expect(scan.findings[0]!.message).toBe(
      'broken codebase ref: src/mixed.rs:2 — see: 99-nope.md#Ghost — file not found in the spec corpus',
    );
    expect(scan.findings[0]!.suggestion).toBeUndefined();
    // The artifact sibling right after it, in document order.
    expect(scan.findings[1]!.reason).toBe('FileNotFound');
    expect(scan.findings[1]!.message).toBe(
      'broken codebase ref: src/mixed.rs:4 — see: cans/artifacts/code/ghost.rs#Nope — artifact target not found in the cans workspace',
    );
  });
});
