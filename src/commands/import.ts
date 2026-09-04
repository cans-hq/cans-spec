import { join, basename, dirname } from 'path';
import { readdirSync } from 'fs';
import type { ImportResult, ImportFormat, ImportConflict, MergeStrategy, ExternalNode } from '../types';
import { resolveWorkspaceRoot, discoverSpecFiles, mkdirp, isFile, dirExists } from '../core/fs';
import { parseOpml } from '../converters/opml';
import { parseLogseq } from '../converters/logseq';
import { parseObsidian, stripFrontmatter } from '../converters/obsidian';
import { serializeToCans, parseFromCans, stripMetadata } from '../converters/shared';

export interface ImportArgs {
  format: ImportFormat;
  path: string;
  out: string | null;
  dryRun: boolean;
  mergeStrategy: MergeStrategy;
  json: boolean;
}

const FORMATS: readonly string[] = ['opml', 'dynalist', 'logseq', 'obsidian'];

export function parseImportArgs(args: string[]): ImportArgs {
  const positional: string[] = [];
  let out: string | null = null;
  let dryRun = false;
  let mergeStrategy: MergeStrategy = 'cans-wins';
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--out') {
      out = args[i + 1] ?? null;
    } else if (a === '--dry-run') {
      dryRun = true;
    } else if (a === '--merge-strategy') {
      const s = args[i + 1];
      if (s === 'cans-wins' || s === 'import-wins' || s === 'ask') mergeStrategy = s;
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
    json,
  };
}

function fail(format: string, source: string, message: string): ImportResult {
  void message;
  return {
    ok: false, command: 'import', exitCode: 1,
    format, source, newFiles: [], merged: [], conflicts: [],
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

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function flattenExternal(nodes: ExternalNode[]): ExternalNode[] {
  const out: ExternalNode[] = [];
  const walk = (list: ExternalNode[]): void => {
    for (const n of list) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
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

function parseSource(text: string, format: string): ExternalNode[] {
  if (format === 'opml' || format === 'dynalist') {
    const nodes = parseOpml(text);
    if (format === 'dynalist') {
      // dynalist exports carry app metadata (^block-ids, #tags, emphasis) inside text
      const clean = (list: ExternalNode[]): ExternalNode[] =>
        list.map(n => ({
          ...n,
          text: stripMetadata(n.text, 'dynalist'),
          children: clean(n.children),
        }));
      return clean(nodes);
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
  content: string | null; // null = no write
  conflicts: ImportConflict[];
}

/** Merge imported nodes into an existing CANS file per the strategy. */
function mergeInto(
  existingText: string,
  imported: ExternalNode[],
  strategy: MergeStrategy,
  relName: string,
): MergeOutcome {
  const conflicts: ImportConflict[] = [];
  const existingFlat = flattenExternal(parseFromCans(existingText));
  const exactTexts = new Set(existingFlat.map(n => n.text));
  const normalizedIndex = new Map<string, { text: string; line: number }>();
  existingFlat.forEach((n, i) => {
    if (!normalizedIndex.has(normalizeText(n.text))) {
      normalizedIndex.set(normalizeText(n.text), { text: n.text, line: i + 1 });
    }
  });

  const presence = (text: string): 'new' | 'exact' | 'near' => {
    if (exactTexts.has(text)) return 'exact';
    const hit = normalizedIndex.get(normalizeText(text));
    if (hit !== undefined) {
      conflicts.push({
        file: relName,
        line: hit.line,
        cansVersion: hit.text,
        importVersion: text,
        resolution: strategy,
      });
      return 'near';
    }
    return 'new';
  };

  if (strategy === 'import-wins') {
    // conflict scan first, then wholesale overwrite
    for (const n of flattenExternal(imported)) presence(n.text);
    return { content: serializeToCans(imported), conflicts };
  }

  // cans-wins / ask: keep only nodes whose text is not already present
  const filterTree = (nodes: ExternalNode[]): ExternalNode[] => {
    const out: ExternalNode[] = [];
    for (const n of nodes) {
      const kids = filterTree(n.children);
      if (presence(n.text) === 'new') {
        out.push({ ...n, children: kids });
      } else {
        out.push(...kids); // re-attach surviving children one level up
      }
    }
    return out;
  };
  const kept = filterTree(imported);
  if (strategy === 'ask') return { content: null, conflicts };
  const appended = serializeToCans(kept);
  const base = existingText.endsWith('\n') || existingText === '' ? existingText : `${existingText}\n`;
  return { content: appended === '' ? existingText : base + appended, conflicts };
}

export async function run(args: string[]): Promise<ImportResult> {
  const opts = parseImportArgs(args);

  if (!FORMATS.includes(opts.format) || opts.path === '') {
    return fail(opts.format, opts.path, 'unknown format or missing source path');
  }

  const files = sourceFiles(opts.path, opts.format);
  if (files === null || files.length === 0) {
    return fail(opts.format, opts.path, 'source not found');
  }

  const workspace = resolveWorkspaceRoot() ?? opts.out;
  if (workspace === null) {
    return fail(opts.format, opts.path, 'no cans workspace found (pass --out <dir>)');
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
    const imported = parseSource(text, opts.format);
    if (imported.length === 0) continue;

    const slug = slugify(imported[0].text);
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
        if (!opts.dryRun) await Bun.write(absTarget, outcome.content);
        merged.push(existingRel);
      }
      continue;
    }

    const relName = `${String(nextNum).padStart(2, '0')}-${slug}.md`;
    const absTarget = join(workspace, relName);

    const cansText = serializeToCans(imported);
    if (!opts.dryRun) {
      mkdirp(dirname(absTarget));
      await Bun.write(absTarget, cansText);
    }
    newFiles.push(relName);
    nextNum++;
  }

  return {
    ok: true, command: 'import', exitCode: 0,
    format: opts.format, source: opts.path, newFiles, merged, conflicts,
  };
}
