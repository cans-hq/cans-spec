import { join, basename, dirname } from 'path';
import { readdirSync } from 'fs';
import type {
  ImportResult, ImportFormat, ImportConflict, MergeStrategy, ExternalNode,
} from '../types';
import { resolveWorkspaceRoot, discoverSpecFiles, mkdirp, isFile, dirExists } from '../core/fs';
import { convertArrowRefs, parseOpml, parseOpmlTitle } from '../converters/opml';
import { parseLogseq } from '../converters/logseq';
import { parseObsidian, stripFrontmatter } from '../converters/obsidian';
import {
  serializeToCans, parseFromCans, stripMetadata, parseCheckbox,
  extractOverflowContent, type OverflowExtraction,
} from '../converters/shared';

export interface ImportArgs {
  format: ImportFormat;
  path: string;
  out: string | null;
  dryRun: boolean;
  mergeStrategy: MergeStrategy;
  /** Raw `--merge-strategy` value as given, so invalid enums can be rejected (QA-05 F10). */
  mergeStrategyRaw: string | null;
  json: boolean;
}

const FORMATS: readonly string[] = ['opml', 'dynalist', 'logseq', 'obsidian'];
const STRATEGIES: readonly MergeStrategy[] = ['cans-wins', 'import-wins', 'ask'];

export function parseImportArgs(args: string[]): ImportArgs {
  const positional: string[] = [];
  let out: string | null = null;
  let dryRun = false;
  let mergeStrategy: MergeStrategy = 'cans-wins';
  let mergeStrategyRaw: string | null = null;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--out') {
      out = args[i + 1] ?? null;
    } else if (a === '--dry-run') {
      dryRun = true;
    } else if (a === '--merge-strategy') {
      const s = args[i + 1] ?? null;
      mergeStrategyRaw = s;
      if (s !== null && (STRATEGIES as readonly string[]).includes(s)) mergeStrategy = s as MergeStrategy;
    } else if (a === '--json') {
      json = true;
    } else if (!a.startsWith('--')) {
      positional.push(a);
    }
  }
  return {
    format: (positional[0] ?? '') as ImportFormat,
    path: positional[1] ?? '',
    out,
    dryRun,
    mergeStrategy,
    mergeStrategyRaw,
    json,
  };
}

function fail(format: string, source: string, error: string): ImportResult {
  return {
    ok: false, command: 'import', exitCode: 1,
    format, source, newFiles: [], merged: [], conflicts: [], error,
  };
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/["“”]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** §4 canonical ref form: spec-slug ref targets carry the `.md` extension when
 *  written into the workspace (`see: 02-authentication#Sessions` →
 *  `see: 02-authentication.md#Sessions`). Converter output stays mechanical;
 *  the importer emits workspace-conformant refs (QA-05 F2/F3). Idempotent. */
function canonicalizeRefTargets(text: string): string {
  return text.replace(
    /\bsee:?\s+([^\s#]+)(#[^\s]+)?/g,
    (m, target: string, anchor: string | undefined) => {
      if (/^\d{2}-/.test(target) && !target.endsWith('.md')) {
        return `see: ${target}.md${anchor ?? ''}`;
      }
      return m;
    },
  );
}

/** Normalized key for fuzzy text matching: lowercase, strip punctuation, collapse whitespace. */
function normKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Near-match: same words (len > 1) with ≥ 0.75 overlap.
 * Threshold note: the pasted patch said 0.8, but the QA-05 F8 flagship conflict
 * pair — "Expire after 24 hours" vs "Expire after 48 hours" — shares 3 of 4
 * words (0.75) and MUST be flagged, so the threshold is tuned to 0.75.
 */
function isNearMatch(a: string, b: string): boolean {
  const wa = new Set(normKey(a).split(' ').filter(w => w.length > 1));
  const wb = new Set(normKey(b).split(' ').filter(w => w.length > 1));
  if (wa.size === 0 || wb.size === 0) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.max(wa.size, wb.size) >= 0.75;
}

/** Source files to import: a single file, or every supported file inside a directory. */
function sourceFiles(path: string, format: string): string[] | null {
  if (isFile(path)) return [path];
  if (dirExists(path)) {
    const ext = format === 'opml' || format === 'dynalist' ? '.opml' : '.md';
    let names: string[] = [];
    try {
      names = readdirSync(path).filter(n => n.endsWith(ext));
    } catch {
      return null;
    }
    return names.sort().map(n => join(path, n));
  }
  return null;
}

/** Map every node's text (depth-first) through `f`, preserving structure. */
function mapText(nodes: ExternalNode[], f: (t: string) => string): ExternalNode[] {
  return nodes.map((n) => ({ ...n, text: f(n.text), children: mapText(n.children, f) }));
}

function parseSource(text: string, format: string): ExternalNode[] {
  if (format === 'opml' || format === 'dynalist') {
    let nodes = parseOpml(text);
    // §28 table inverse: the exported `→ X.md#Y` marker restores as `see: X.md#Y`
    // (QA-05 F16 / QA-09 D9 — refs must survive the OPML round-trip).
    nodes = mapText(nodes, (t) => convertArrowRefs(t));
    if (format === 'dynalist') {
      // dynalist exports carry app metadata (^block-ids, #tags, emphasis) inside text
      nodes = mapText(nodes, (t) => stripMetadata(t, 'dynalist'));
    }
    return nodes;
  }
  if (format === 'logseq') return parseLogseq(text);
  if (format === 'obsidian') return parseObsidian(stripFrontmatter(text));
  return [];
}

/** Max spec number in the target dir + 1 (starts at 7). */
function nextSpecNumber(targetDir: string): number {
  let max = 6;
  for (const rel of discoverSpecFiles(targetDir)) {
    const m = basename(rel).match(/^(\d{2})-/);
    if (m !== null) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** Existing spec file with the same slug (ignoring the NN- prefix) — merge target. */
function findExistingBySlug(targetDir: string, slug: string): string | null {
  for (const rel of discoverSpecFiles(targetDir)) {
    const stripped = basename(rel).replace(/\.md$/, '').replace(/^\d{2}-/, '');
    if (slugify(stripped) === slug) return rel;
  }
  return null;
}

interface MergeOutcome {
  content: string | null; // null = no write (ask)
  conflicts: ImportConflict[];
}

/**
 * Tree-level merge (QA-05 F8/F9). One single-pass walk of the import tree:
 * for each imported node, match it against the existing tree by normalized text
 * (global exact index) and, failing that, against its sibling slot by word
 * overlap; brand-new nodes are inserted under the CORRECT parent so tree
 * position is preserved (the old flat-append corrupts the hierarchy).
 *   exact normalized match → conflict only if text differs
 *     (cans-wins keeps the CANS text, import-wins overwrites it)
 *   near-match (word overlap ≥ 0.75) → conflict + strategy
 *   new node → inserted under the matched/near parent; `ask` reports it, no write
 */
function mergeInto(
  existingText: string,
  imported: ExternalNode[],
  strategy: MergeStrategy,
  relName: string,
): MergeOutcome {
  const conflicts: ImportConflict[] = [];
  const existingTree = parseFromCans(existingText);

  // Real source line per existing node text (first occurrence, document order).
  const lineOfKey = new Map<string, number>();
  existingText.split(/\r?\n/).forEach((l, i) => {
    if (!/^\s*-\s+/.test(l)) return;
    const k = normKey(parseCheckbox(l).clean);
    if (k !== '' && !lineOfKey.has(k)) lineOfKey.set(k, i + 1);
  });

  // Index existing nodes by normalized text (first occurrence wins).
  const existingIndex = new Map<string, ExternalNode>();
  const indexTree = (nodes: ExternalNode[]): void => {
    for (const n of nodes) {
      const k = normKey(n.text);
      if (k !== '' && !existingIndex.has(k)) existingIndex.set(k, n);
      indexTree(n.children);
    }
  };
  indexTree(existingTree);

  let newEntryLine = existingText.split(/\r?\n/).length; // approx. line for inserted content

  const mergeNodes = (importNodes: ExternalNode[], targetChildren: ExternalNode[]): void => {
    for (const imp of importNodes) {
      const key = normKey(imp.text);
      const exact = key !== '' ? existingIndex.get(key) : undefined;

      if (exact !== undefined) {
        // Matched by normalized text → conflict only when the wording differs.
        if (exact.text !== imp.text) {
          conflicts.push({
            file: relName,
            line: lineOfKey.get(key) ?? 0,
            cansVersion: exact.text,
            importVersion: imp.text,
            resolution: strategy,
          });
          if (strategy === 'import-wins') exact.text = imp.text;
          // cans-wins / ask: keep the CANS version
        }
        mergeNodes(imp.children, exact.children);
        continue;
      }

      // Near-match check against the siblings at this slot (word overlap).
      const near = targetChildren.find(c => isNearMatch(c.text, imp.text));
      if (near !== undefined) {
        conflicts.push({
          file: relName,
          line: lineOfKey.get(normKey(near.text)) ?? 0,
          cansVersion: near.text,
          importVersion: imp.text,
          resolution: strategy,
        });
        if (strategy === 'import-wins') near.text = imp.text;
        mergeNodes(imp.children, near.children);
        continue;
      }

      if (strategy === 'ask') {
        // ask = report, don't merge: the would-be addition is surfaced too,
        // otherwise ask would silently drop new content with no trace.
        conflicts.push({
          file: relName,
          line: ++newEntryLine,
          cansVersion: '',
          importVersion: imp.text,
          resolution: 'ask',
        });
        continue;
      }

      // New node → insert under the correct parent, re-index so deeper
      // children can find it, then merge its subtree.
      const inserted: ExternalNode = { ...imp, children: [] };
      targetChildren.push(inserted);
      if (key !== '') existingIndex.set(key, inserted);
      mergeNodes(imp.children, inserted.children);
    }
  };

  mergeNodes(imported, existingTree);

  if (strategy === 'ask') return { content: null, conflicts };
  return { content: serializeToCans(existingTree), conflicts };
}

/** §27/§28 (QA-09 D12): OPML/Dynalist exports carry the SOURCE SPEC FILENAME in
 *  `<head><title>` (e.g. `02-authentication.md`). When the title names a spec
 *  file it — not the first node's text — drives merge-target matching and
 *  new-file naming, so re-importing an edited export lands on the original
 *  file instead of silently forking. Other titles (e.g. "Project Backlog")
 *  fall back to first-node naming. */
const SPEC_TITLE_RE = /^\d{2}-[a-z0-9-]+(?:\.md)?$/i;

export async function run(args: string[]): Promise<ImportResult> {
  const opts = parseImportArgs(args);
  const fmt = opts.format.toLowerCase(); // §27 formats are lowercase; accept OPML/Obsidian casing

  // §37/§27: invalid enum values are rejected, never silently defaulted (QA-05 F10).
  if (opts.mergeStrategyRaw !== null && !(STRATEGIES as readonly string[]).includes(opts.mergeStrategyRaw)) {
    return fail(fmt, opts.path,
      `unknown merge strategy "${opts.mergeStrategyRaw}" — valid: cans-wins, import-wins, ask`);
  }

  if (opts.path === '') {
    return fail(fmt, opts.path,
      'usage: cans import <format> <path>\n  Formats: opml, dynalist, logseq, obsidian');
  }
  if (!FORMATS.includes(fmt)) {
    return fail(fmt, opts.path,
      `unknown format "${opts.format}" — valid formats: opml, dynalist, logseq, obsidian`);
  }

  const files = sourceFiles(opts.path, fmt);
  if (files === null || files.length === 0) {
    return fail(fmt, opts.path,
      `source not found: ${opts.path}\n  Check the path and try again.`);
  }

  // §20/§36: --out overrides workspace discovery; otherwise a workspace is required.
  let workspace: string;
  if (opts.out !== null) {
    workspace = opts.out;
    if (!opts.dryRun) mkdirp(workspace);
  } else {
    const ws = resolveWorkspaceRoot();
    if (ws === null) {
      return fail(fmt, opts.path,
        'no cans workspace found — run `cans init` first, or pass --out <dir>');
    }
    workspace = ws;
  }

  const newFiles: string[] = [];
  const merged: string[] = [];
  const conflicts: ImportConflict[] = [];

  let nextNum = nextSpecNumber(workspace);

  for (const src of files) {
    let text = '';
    try {
      text = await Bun.file(src).text();
    } catch {
      continue;
    }

    // §27/§28 (QA-09 D12): use the export's source-filename title as the file
    // identity when it names a spec file; otherwise first-node naming.
    let titleBase: string | null = null;
    if (fmt === 'opml' || fmt === 'dynalist') {
      const title = parseOpmlTitle(text);
      if (title !== null && SPEC_TITLE_RE.test(title)) {
        titleBase = title.replace(/\.md$/i, '');
      }
    }

    // §27: fenced code blocks under bullets are extracted to overflow files
    // before parsing, so their content survives as files + see: refs (QA-05 F5).
    let overflow: OverflowExtraction[] = [];
    let cleanText = text;
    if (fmt === 'obsidian' || fmt === 'logseq') {
      const baseSlug = slugify(basename(src).replace(/\.[^.]+$/, '')) || 'import';
      const extracted = extractOverflowContent(text, baseSlug);
      cleanText = extracted.cleanedSource;
      overflow = extracted.extractions;
    }

    let imported: ExternalNode[];
    try {
      imported = parseSource(cleanText, fmt);
    } catch (e) {
      // e.g. non-XML garbage passed as .opml (QA-05 F12) — fail loudly, write nothing.
      return fail(fmt, opts.path,
        `invalid OPML in ${basename(src)} — ${(e as Error).message}`);
    }
    if (imported.length === 0) continue;

    // Merge target: the export's source-file identity when available, else the
    // first node's text (QA-09 D12 — `02-authentication.opml` must re-match
    // 02-authentication.md, not slug the first node "sessions" into a fork).
    const slug = titleBase !== null
      ? slugify(titleBase.replace(/^\d{2}-/, ''))
      : slugify(imported[0].text);
    if (slug === '') continue;

    // Same-slug spec already present → merge; otherwise a new NN-slug.md file.
    const existingRel = findExistingBySlug(workspace, slug);
    if (existingRel !== null) {
      const absTarget = join(workspace, existingRel);
      const outcome = mergeInto(
        await Bun.file(absTarget).text(),
        imported,
        opts.mergeStrategy,
        existingRel,
      );
      conflicts.push(...outcome.conflicts);
      if (outcome.content !== null) {
        if (!opts.dryRun) {
          await Bun.write(absTarget, canonicalizeRefTargets(outcome.content));
          for (const ovf of overflow) {
            const ovfAbs = join(workspace, ovf.overflowFile);
            mkdirp(dirname(ovfAbs));
            await Bun.write(ovfAbs, `${ovf.content}\n`);
          }
        }
        merged.push(existingRel);
        for (const ovf of overflow) newFiles.push(ovf.overflowFile);
      }
      continue;
    }

    // New file: preserve the source spec's NN-name identity when the export
    // carries it (QA-09 D12/D4), else the next free NN-first-node-slug.md.
    const relName = titleBase !== null
      ? `${titleBase}.md`
      : `${String(nextNum).padStart(2, '0')}-${slug}.md`;
    const absTarget = join(workspace, relName);

    const cansText = canonicalizeRefTargets(serializeToCans(imported));
    if (!opts.dryRun) {
      mkdirp(dirname(absTarget));
      await Bun.write(absTarget, cansText);
      for (const ovf of overflow) {
        const ovfAbs = join(workspace, ovf.overflowFile);
        mkdirp(dirname(ovfAbs));
        await Bun.write(ovfAbs, `${ovf.content}\n`);
      }
    }
    newFiles.push(relName);
    for (const ovf of overflow) newFiles.push(ovf.overflowFile);
    if (titleBase === null) nextNum++;
  }

  return {
    ok: true, command: 'import', exitCode: 0,
    format: fmt, source: opts.path, newFiles, merged, conflicts,
    dryRun: opts.dryRun || undefined,
  };
}
