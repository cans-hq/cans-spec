import { statSync, readdirSync, existsSync, mkdirSync, type Stats } from 'fs';
import { join, relative, dirname, basename } from 'path';

const SPEC_FILE_RE = /^\d{2}-.+\.md$/;

export function exists(p: string): boolean {
  return existsSync(p);
}

export function dirExists(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function mkdirp(p: string): void {
  mkdirSync(p, { recursive: true });
}

export function globFiles(dir: string, pattern: string): string[] {
  if (!dirExists(dir)) return [];
  const g = new Bun.Glob(pattern);
  const out = [...g.scanSync({ cwd: dir, onlyFiles: true })] as string[];
  return out.sort();
}

/** Spec files: root-level *.md (excluding _-prefixed and AGENTS.md) plus per-folder index.md. */
export function discoverSpecFiles(root: string): string[] {
  const out: string[] = [];
  if (!dirExists(root)) return out;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name === 'AGENTS.md') continue;
    if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(entry.name);
    } else if (entry.isDirectory()) {
      const idx = join(entry.name, 'index.md');
      if (exists(join(root, idx))) out.push(idx);
    }
  }
  return out.sort();
}

export function discoverActiveTasks(root: string): string[] {
  return globFiles(join(root, '_tasks'), '*.md')
    .map(p => join('_tasks', basename(p)))
    .sort();
}

export function discoverArchivedTasks(root: string): string[] {
  return globFiles(join(root, '_tasks', '_archive'), '*.md')
    .map(p => join('_tasks', '_archive', basename(p)))
    .sort();
}

export function discoverAdrs(root: string): string[] {
  return globFiles(join(root, '_adr'), '*.md')
    .map(p => join('_adr', basename(p)))
    .filter(p => basename(p) !== '_template.md')
    .sort();
}

/** Resolve a ref target: flat file wins, then folder index.md. null when neither exists. */
export function resolveSpecFile(root: string, name: string): string | null {
  const direct = join(root, name);
  if (exists(direct) && statSync(direct).isFile()) return direct;
  if (name.endsWith('.md')) {
    const folderIdx = join(root, name.slice(0, -3), 'index.md');
    if (exists(folderIdx)) return folderIdx;
  }
  return null;
}

// ── Workspace discovery ──

function looksLikeWorkspace(dir: string): boolean {
  if (!dirExists(dir)) return false;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && SPEC_FILE_RE.test(entry.name)) return true;
      if (entry.isDirectory() && entry.name === '_tasks') return true;
      if (entry.isDirectory() && entry.name === '_adr') return true;
      if (entry.isFile() && entry.name === '_rules.yaml') return true;
    }
  } catch {
    return false;
  }
  return false;
}

function listDirsRecursive(base: string, maxDepth: number): Array<{ dir: string; mtime: number; depth: number }> {
  const out: Array<{ dir: string; mtime: number; depth: number }> = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const p = join(dir, e.name);
      let mtime = 0;
      try {
        mtime = statSync(p).mtimeMs;
      } catch {
        continue;
      }
      out.push({ dir: p, mtime, depth });
      walk(p, depth + 1);
    }
  };
  walk(base, 1);
  return out;
}

/** newest-mtime first; deeper path wins ties (most specific scratch target). */
function newestFirst(a: { dir: string; mtime: number; depth: number }, b: { dir: string; mtime: number; depth: number }): number {
  if (b.mtime !== a.mtime) return b.mtime - a.mtime;
  return b.depth - a.depth;
}

function scratchRoot(cwd: string): string | null {
  const tmp = join(cwd, '.tmp');
  if (!dirExists(tmp)) return null;
  const dirs = listDirsRecursive(tmp, 3);
  if (dirs.length === 0) return null;
  const workspaceLike = dirs.filter(d => looksLikeWorkspace(d.dir));
  if (workspaceLike.length > 0) {
    workspaceLike.sort(newestFirst);
    return workspaceLike[0].dir;
  }
  return null;
}

/** The directory containing spec files.
 *  1. CANS_ROOT env override.
 *  2. Walk up from cwd for a `cans/` directory (production contract).
 *  3. Scratch mode: newest workspace-like dir under <cwd>/.tmp.
 *  4. null — caller reports "no cans workspace found". */
export function resolveWorkspaceRoot(): string | null {
  const env = process.env.CANS_ROOT;
  if (env && dirExists(env)) return env;

  let dir = process.cwd();
  for (let i = 0; i < 32; i++) {
    const cans = join(dir, 'cans');
    if (dirExists(cans)) return cans;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return scratchRoot(process.cwd());
}

/** Workspace for commands that may create their target (`new`).
 *  Falls back to the newest dir under .tmp, then <cwd>/cans. */
export function resolveWorkspaceOrCreate(): string {
  const found = resolveWorkspaceRoot();
  if (found) return found;
  const tmp = join(process.cwd(), '.tmp');
  if (dirExists(tmp)) {
    const dirs = listDirsRecursive(tmp, 3);
    if (dirs.length > 0) {
      dirs.sort(newestFirst);
      return dirs[0].dir;
    }
  }
  return join(process.cwd(), 'cans');
}

/** Directory in which `cans init` creates the `cans/` workspace.
 *  1. CANS_ROOT env.
 *  2. Newest completely-empty dir under <cwd>/.tmp (scratch/sandbox init).
 *  3. cwd. */
export function resolveInitTarget(): string {
  const env = process.env.CANS_ROOT;
  if (env) return env;
  const tmp = join(process.cwd(), '.tmp');
  if (dirExists(tmp)) {
    const dirs = listDirsRecursive(tmp, 3);
    const empty = dirs.filter(d => {
      try {
        return readdirSync(d.dir).length === 0;
      } catch {
        return false;
      }
    });
    if (empty.length > 0) {
      empty.sort(newestFirst);
      return empty[0].dir;
    }
  }
  return process.cwd();
}

/** Is cwd inside an existing cans workspace? (init must refuse) */
export function insideWorkspace(): boolean {
  let dir = process.cwd();
  for (let i = 0; i < 32; i++) {
    if (basename(dir) === 'cans' && dirExists(dir)) return true;
    const cans = join(dir, 'cans');
    if (dirExists(cans)) return true;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}

export function toRelative(root: string, p: string): string {
  const rel = relative(root, p);
  return rel.split('\\').join('/');
}

export function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

export type { Stats };
