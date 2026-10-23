import { statSync, readdirSync, existsSync, mkdirSync, type Stats } from 'fs';
import { join, relative, dirname, basename, isAbsolute } from 'path';
import { globFiles as runtimeGlobFiles } from './runtime.ts';

const SPEC_FILE_RE = /^\d{2}-.+\.md$/;

/** Tool-specific instruction artifacts (§21 `--tool <name>`, §32): emitted
 *  beside the specs as agent-facing instructions, never spec content — same
 *  exclusion class as AGENTS.md (QA-09 F4: CLAUDE.md must not be discovered
 *  as a spec file, counted by status, or exported). */
const TOOL_ARTIFACTS = new Set(['AGENTS.md', 'CLAUDE.md', '.cursorrules']);

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
  // Delegated to the runtime shim (issue #12): Bun fast path, node:fs fallback.
  return runtimeGlobFiles(dir, pattern);
}

/** Spec files: root-level *.md (excluding _-prefixed, AGENTS.md and other tool
 *  artifacts) plus folder `index.md` at ANY depth (issue #54: `plugins/topic/
 *  index.md` is a first-class spec file, not invisible content — 0.6.0 only
 *  looked one level deep). _-prefixed directories (_tasks/, _adr/, …) and
 *  tool artifacts are skipped at every level, exactly like the root.
 *
 *  Only `index.md` counts below the root: a NON-index subfolder .md (e.g.
 *  `plugins/pty.md`) is §16 overflow-target material (leaf content) unless a
 *  loaded spec file references it — the check engine's promotion pass (issue
 *  #54) promotes those; discovery itself never loads them.
 *
 *  Relative keys are '/'-joined (the same convention as discoverOverflow
 *  Targets and toRelative, never path.join's platform separator) so ref
 *  targets like `plugins/topic/index.md` always match a discovered key. */
export function discoverSpecFiles(root: string): string[] {
  const out: string[] = [];
  if (!dirExists(root)) return out;
  const walk = (dir: string, prefix: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('_') || TOOL_ARTIFACTS.has(entry.name)) continue;
      if (entry.isFile() && entry.name.endsWith('.md')) {
        // Loose .md files are spec files at the ROOT level only.
        if (prefix === '') out.push(entry.name);
      } else if (entry.isDirectory()) {
        const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
        if (exists(join(dir, entry.name, 'index.md'))) out.push(`${rel}/index.md`);
        walk(join(dir, entry.name), rel);
      }
    }
  };
  walk(root, '');
  return out.sort();
}

/** Detect flat-vs-folder conflicts: both `<slug>.md` AND `<slug>/index.md` exist.
 *  §8/§11: "Flat wins. Both existing = error." Round 6 (QA-19 F15/F17–19):
 *  the condition is slug-AGNOSTIC — any pair (numbered `02-authentication.md` +
 *  `02-authentication/index.md`, or plain `auth.md` + `auth/index.md`) is a
 *  duplicate home; the old NN--only gate let unnumbered pairs coexist
 *  silently. Returns pairs of [flatRel, folderRel].
 *
 *  ROOT-LEVEL (depth-1) semantics by design (issue #54): recursive folder-
 *  index discovery now also LOADS deeper pairs (e.g. `plugins/pty.md` +
 *  `plugins/pty/index.md`), but the duplicate-home ERROR class stays a
 *  root-level check — the root is the spec's table of contents, the place
 *  where a duplicated home misleads every reader. Deeper collisions are not
 *  flagged (the flat file simply wins refs by resolution order). */
export function detectFlatFolderConflicts(root: string): Array<[string, string]> {
  const conflicts: Array<[string, string]> = [];
  if (!dirExists(root)) return conflicts;

  const flatFiles = new Set<string>();
  const folderDirs = new Set<string>();

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || TOOL_ARTIFACTS.has(entry.name)) continue;
    if (entry.isFile() && entry.name.endsWith('.md')) {
      // §11 both-existing: ANY spec-shaped .md file, numbered slug or not.
      flatFiles.add(entry.name);
    } else if (entry.isDirectory() && exists(join(root, entry.name, 'index.md'))) {
      folderDirs.add(entry.name);
    }
  }

  for (const flat of flatFiles) {
    const dirName = flat.replace(/\.md$/, '');
    if (folderDirs.has(dirName)) {
      conflicts.push([flat, `${dirName}/index.md`]);
    }
  }

  return conflicts.sort();
}

/** Directories named like a spec file (e.g. `02-authentication.md/`) — malformed
 *  workspace entries that discovery would silently skip (§37: report what the
 *  user can fix instead of tolerating it). Returns the directory names. */
export function detectMalformedSpecDirs(root: string): string[] {
  const out: string[] = [];
  if (!dirExists(root)) return out;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && SPEC_FILE_RE.test(entry.name)) {
      out.push(entry.name);
    }
  }
  return out.sort();
}

/** Overflow target files: `.md` content files inside workspace subfolders
 *  (e.g. `04-api/request-schema.md`) that are not spec files themselves.
 *  §16: these must NOT contain their own `see:` refs (no chaining).
 *  Issue #54: a subfolder .md that the check engine PROMOTED to a first-class
 *  spec file (a loaded spec file references it) is excluded from this set by
 *  the caller — its `see:` refs are ordinary graph edges. Only the
 *  UNREFERENCED subfolder .md files remain §16 leaf content here. */
export function discoverOverflowTargets(root: string): string[] {
  const out: string[] = [];
  if (!dirExists(root)) return out;
  const walk = (dir: string, prefix: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('_') || TOOL_ARTIFACTS.has(entry.name)) continue;
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isFile() && entry.name.endsWith('.md')) {
        // `*/index.md` is a folder-mode spec file, not an overflow target.
        if (prefix !== '' && entry.name !== 'index.md') out.push(rel);
      } else if (entry.isDirectory()) {
        walk(join(dir, entry.name), rel);
      }
    }
  };
  walk(root, '');
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

/** Containment guard (issue #10, round-6 port of 3adbc91): a ref candidate
 *  must resolve INSIDE the workspace root. `../` traversal, absolute targets
 *  and root-aliasing paths (rel === "") are all rejected — null falls through
 *  to broken-ref reporting. */
function isInsideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/** Resolve a ref target: flat file wins, then folder index.md. null when neither exists.
 *  Issue #22: trailing slashes are folder-target spelling, not a different
 *  path — `auth/` resolves exactly like `auth` / `auth/index.md`.
 *  Issue #10 (round-6 port of 3adbc91): the result can never point OUTSIDE
 *  `root` — an escaping candidate is rejected even when the file physically
 *  exists beyond the workspace. */
export function resolveSpecFile(root: string, name: string): string | null {
  const clean = name.replace(/\/+$/, '');
  if (clean === '') return null;
  const direct = join(root, clean);
  if (isInsideRoot(root, direct) && exists(direct) && statSync(direct).isFile()) return direct;
  if (clean.endsWith('.md')) {
    const folderIdx = join(root, clean.slice(0, -3), 'index.md');
    if (isInsideRoot(root, folderIdx) && exists(folderIdx)) return folderIdx;
  }
  return null;
}

/** Issue #54: map a raw `see:` target to the workspace-relative key of a
 *  subfolder .md file the check engine may PROMOTE to a first-class spec
 *  file — null when the target is not promotable.
 *
 *  Resolution mirrors the ref engines' own order (§11 flat-first): the target
 *  as spelled, then — for extensionless stems — `<stem>.md`, both through
 *  resolveSpecFile (whose folder-index fallback keeps `auth`, `auth.md` and
 *  `auth/` naming one folder-layout home). Guards, in order:
 *  - the target must resolve INSIDE the workspace (resolveSpecFile's
 *    containment guard, issue #10);
 *  - only `.md` files promote — YAML artifacts keep their issue #49
 *    read-from-disk treatment (addressable keys, never loaded, never
 *    rewritten by --fix);
 *  - no `_`-prefixed path segment and no tool artifact at any level:
 *    `_tasks/`/`_adr/` files stay aux (parsed for refs only) and AGENTS.md
 *    is not spec, exactly as in discovery.
 *  The returned key uses the '/'-joined relative convention shared by
 *  discoverSpecFiles / discoverOverflowTargets / toRelative. */
export function promotableSpecKey(root: string, name: string): string | null {
  const target = name.replace(/\/+$/, '');
  if (target === '') return null;
  let p = resolveSpecFile(root, target);
  if (p === null && !target.endsWith('.md')) {
    // §11 flat-first extensionless stem: `see plugins/pty` names
    // plugins/pty.md exactly like `see 02-b` names 02-b.md.
    p = resolveSpecFile(root, `${target}.md`);
  }
  if (p === null) return null;
  const rel = toRelative(root, p);
  if (!rel.endsWith('.md')) return null; // .yaml/.yml/.ts artifacts never promote
  for (const part of rel.split('/')) {
    if (part.startsWith('_') || TOOL_ARTIFACTS.has(part)) return null;
  }
  return rel;
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
 *  2. Newest completely-empty dir under <cwd>/.tmp that is not nested inside
 *     an existing workspace (scratch/sandbox init — never re-inits into
 *     `cans/_adr`-style empty subdirs of a workspace).
 *  3. cwd. */
export function resolveInitTarget(): string {
  const env = process.env.CANS_ROOT;
  if (env) return env;
  const tmp = join(process.cwd(), '.tmp');
  if (dirExists(tmp)) {
    const dirs = listDirsRecursive(tmp, 3).filter(d => {
      // never target a dir that lives inside an existing workspace
      const rel = relative(tmp, d.dir).split('\\').join('/');
      if (rel.split('/').includes('cans')) return false;
      try {
        return readdirSync(d.dir).length === 0;
      } catch {
        return false;
      }
    });
    if (dirs.length > 0) {
      dirs.sort(newestFirst);
      return dirs[0].dir;
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
