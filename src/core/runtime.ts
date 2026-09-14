/** Runtime shim — the ONLY module allowed to touch `Bun.*` APIs (issue #12).
 *
 *  Bun stays the primary runtime (fast path, behavior byte-identical to the
 *  pre-#12 code); Node.js ≥22.6 is the fallback (Termux / no-Bun harnesses).
 *  The Node path uses only `node:` builtins — the zero-dependency law holds on
 *  both runtimes. Anything outside this module that needs a runtime-sensitive
 *  operation MUST go through one of these exports; a repo self-audit test
 *  (test/node-fallback.test.ts) enforces `Bun\.` never appears elsewhere.
 */
import { readdirSync, statSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Minimal structural type for the slice of the Bun global we use. Kept local
 *  so the shim also type-checks without relying on ambient `@types/bun`. */
interface BunGlobal {
  file(path: string): { text(): Promise<string> };
  write(path: string, data: string): Promise<number>;
  Glob: new (pattern: string) => {
    scanSync(opts: { cwd: string; onlyFiles: boolean }): Iterable<string>;
  };
}

const BUN: BunGlobal | undefined = (globalThis as { Bun?: BunGlobal }).Bun;

/** Which runtime is executing: `'bun'` (primary) or `'node'` (fallback). */
export const RUNTIME: 'bun' | 'node' = BUN ? 'bun' : 'node';

/** CLI arguments, portable across runtimes (`Bun.argv` is an alias of
 *  `process.argv`, so the Node form works on both). */
export function argv(): string[] {
  return process.argv.slice(2);
}

/** Directory of the module file that passed its `import.meta.url` — the
 *  portable replacement for Bun's `import.meta.dir` (Node has no equivalent
 *  property; both runtimes support `node:url.fileURLToPath`). */
export function dirFromUrl(moduleUrl: string): string {
  return dirname(fileURLToPath(moduleUrl));
}

/** Read a UTF-8 text file. Bun: `Bun.file(path).text()` (unchanged fast path).
 *  Node: `fs/promises.readFile`. Rejects on missing files on both runtimes. */
export async function readText(path: string): Promise<string> {
  if (BUN) return BUN.file(path).text();
  return readFile(path, 'utf8');
}

/** Write a UTF-8 text file, creating missing parent directories — `Bun.write`
 *  auto-creates parents, so the Node path replicates that (plain
 *  `writeFile` would not) to keep behavior identical across runtimes. */
export async function writeText(path: string, data: string): Promise<void> {
  if (BUN) {
    await BUN.write(path, data);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data, 'utf8');
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Glob relative file paths under `dir`, sorted lexicographically — portable
 *  replacement for `new Bun.Glob(pattern).scanSync({ cwd, onlyFiles: true })`.
 *  Supported forms: single-segment (`*.md`) and recursive (a two-star prefix
 *  followed by a slash, e.g. "**" + "/" + "*.md") wildcard patterns; `*` never
 *  crosses `/` (same as Bun.Glob). Returns paths relative to `dir`, sorted.
 *  Empty array when `dir` does not exist (unchanged contract used by
 *  `_tasks`/`_adr` discovery). */
export function globFiles(dir: string, pattern: string): string[] {
  if (!isDir(dir)) return [];
  if (BUN) {
    const g = new BUN.Glob(pattern);
    return [...g.scanSync({ cwd: dir, onlyFiles: true }) as Iterable<string>].sort();
  }
  const recursive = pattern.startsWith('**/');
  const base = recursive ? pattern.slice(3) : pattern;
  const re = new RegExp(
    `^(?:${base.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')})$`,
  );
  const out: string[] = [];
  if (recursive) {
    const walk = (d: string, prefix: string): void => {
      let entries;
      try {
        entries = readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const rel = prefix === '' ? e.name : `${prefix}/${e.name}`;
        if (e.isFile() && re.test(e.name)) out.push(rel);
        else if (e.isDirectory()) walk(join(d, e.name), rel);
      }
    };
    walk(dir, '');
  } else {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile() && re.test(e.name)) out.push(e.name);
    }
  }
  return out.sort();
}
