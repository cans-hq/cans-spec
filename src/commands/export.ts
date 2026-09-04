import { join, basename, relative } from 'path';
import type { ExportResult, ExportFormat, OutlineNode, ExternalNode } from '../types';
import { resolveWorkspaceRoot, discoverSpecFiles, discoverActiveTasks, mkdirp, dirExists } from '../core/fs';
import { parseOutline } from '../core/outline';
import { serializeOpml } from '../converters/opml';
import { serializeLogseq } from '../converters/logseq';
import { serializeObsidian } from '../converters/obsidian';

export interface ExportArgs {
  format: ExportFormat;
  from: string | null;
  vault: string | null;
  includeTasks: boolean;
  dryRun: boolean;
  json: boolean;
}

const FORMATS: readonly string[] = ['opml', 'dynalist', 'logseq', 'obsidian', 'all'];

export function parseExportArgs(args: string[]): ExportArgs {
  let format = '';
  let from: string | null = null;
  let vault: string | null = null;
  let includeTasks = false;
  let dryRun = false;
  let json = false;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--from') {
      from = args[i + 1] ?? null;
    } else if (a === '--vault') {
      vault = args[i + 1] ?? null;
    } else if (a === '--include-tasks') {
      includeTasks = true;
    } else if (a === '--dry-run') {
      dryRun = true;
    } else if (a === '--json') {
      json = true;
    } else if (!a.startsWith('--')) {
      positional.push(a);
    }
  }
  format = positional[0] ?? '';
  return { format: format as ExportFormat, from, vault, includeTasks, dryRun, json };
}

/** see: X#Y → '→ X#Y' (opml/dynalist) | '[[X/Y]]' (logseq) | '[[X#Y]]' (obsidian). */
function transformRefs(text: string, fmt: string): string {
  if (fmt === 'opml' || fmt === 'dynalist') {
    return text.replace(
      /\bsee:?\s+([^\s#]+)(?:#([^\s#]+))?/g,
      (_m, file: string, anchor?: string) => `→ ${file}${anchor !== undefined ? `#${anchor}` : ''}`,
    );
  }
  if (fmt === 'logseq') {
    return text.replace(
      /\bsee:?\s+([^\s#]+)(?:#([^\s#]+))?/g,
      (_m, file: string, anchor?: string) => {
        const base = file.replace(/\.md$/, '');
        return anchor !== undefined ? `[[${base}/${anchor}]]` : `[[${base}]]`;
      },
    );
  }
  if (fmt === 'obsidian') {
    return text.replace(
      /\bsee:?\s+([^\s#]+)(?:#([^\s#]+))?/g,
      (_m, file: string, anchor?: string) => {
        const base = file.replace(/\.md$/, '');
        return anchor !== undefined ? `[[${base}#${anchor}]]` : `[[${base}]]`;
      },
    );
  }
  return text;
}

/** ← @human → '⏳ Human'; ← agent-1 → '[agent-1]' / 'agent-1:: assigned' / '🤖 agent-1'. */
function transformOwner(text: string, fmt: string): string {
  let s = text.replace(/←\s*@human\b/g, '⏳ Human');
  if (fmt === 'opml' || fmt === 'dynalist') {
    s = s.replace(/←\s*(\S+)/g, (_m, owner: string) => `[${owner}]`);
  } else if (fmt === 'logseq') {
    s = s.replace(/←\s*(\S+)/g, (_m, owner: string) => `${owner}:: assigned`);
  } else if (fmt === 'obsidian') {
    s = s.replace(/←\s*(\S+)/g, (_m, owner: string) => `🤖 ${owner}`);
  }
  return s;
}

function toExternal(node: OutlineNode, fmt: string): ExternalNode {
  return {
    text: transformOwner(transformRefs(node.text, fmt), fmt),
    indent: node.indent,
    isTask: node.isTask,
    isDone: node.isDone,
    children: node.children.map(c => toExternal(c, fmt)),
    metadata: {},
  };
}

function serializeFor(nodes: ExternalNode[], fmt: string, title: string): string {
  if (fmt === 'opml' || fmt === 'dynalist') return serializeOpml(nodes, title);
  if (fmt === 'logseq') return serializeLogseq(nodes);
  if (fmt === 'obsidian') return serializeObsidian(nodes);
  return '';
}

function outputFileName(specRel: string, fmt: string): string {
  const base = basename(specRel);
  if (fmt === 'opml' || fmt === 'dynalist') return `${base.slice(0, -3)}.opml`;
  return base;
}

export async function run(args: string[]): Promise<ExportResult> {
  const opts = parseExportArgs(args);
  const fmt: string = opts.format.toLowerCase(); // §28 formats are lowercase; accept OPML/All casing

  if (!FORMATS.includes(fmt)) {
    return {
      ok: false, command: 'export', exitCode: 1,
      format: fmt, outputDir: '', filesExported: 0,
      error: fmt === ''
        ? 'usage: cans export <format>\n  Formats: opml, dynalist, logseq, obsidian, all'
        : `unknown format "${opts.format}" — valid: opml, dynalist, logseq, obsidian, all`,
    };
  }

  const workspace = opts.from ?? resolveWorkspaceRoot();
  if (workspace === null) {
    return {
      ok: false, command: 'export', exitCode: 1,
      format: fmt, outputDir: '', filesExported: 0,
      error: 'no cans workspace found — run `cans init` first',
    };
  }

  const sources = discoverSpecFiles(workspace);
  if (opts.includeTasks && dirExists(join(workspace, '_tasks'))) {
    sources.push(...discoverActiveTasks(workspace));
  }

  const formats = fmt === 'all'
    ? ['opml', 'dynalist', 'logseq', 'obsidian']
    : [fmt];

  const baseDir = opts.vault ?? join(process.cwd(), 'cans-export');
  const outputDir = fmt === 'all' ? baseDir : join(baseDir, fmt);

  let filesExported = 0;
  for (const f of formats) {
    const fmtDir = fmt === 'all' ? join(baseDir, f) : outputDir;
    for (const rel of sources) {
      let text = '';
      try {
        text = await Bun.file(join(workspace, rel)).text();
      } catch {
        continue;
      }
      let tree: OutlineNode[] = [];
      try {
        tree = parseOutline(text, rel);
      } catch {
        continue;
      }
      const external = tree.map(n => toExternal(n, f));
      if (external.length === 0) continue;
      const content = serializeFor(external, f, basename(rel));
      if (content === '') continue;
      if (!opts.dryRun) {
        mkdirp(fmtDir);
        await Bun.write(join(fmtDir, outputFileName(rel, f)), content);
      }
      filesExported++;
    }
  }

  return {
    ok: true, command: 'export', exitCode: 0,
    format: fmt,
    outputDir: relative(process.cwd(), outputDir) || '.', // §35 fixture: relative to cwd
    filesExported,
    dryRun: opts.dryRun || undefined,
  };
}
