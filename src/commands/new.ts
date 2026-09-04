import { join, basename } from 'path';
import type { NewResult } from '../types';
import { resolveWorkspaceRoot, resolveWorkspaceOrCreate, mkdirp, discoverAdrs, dirExists, isFile } from '../core/fs';
import { parseArgs, type FlagSpec } from '../core/args';

const TEMPLATES_DIR = join(import.meta.dir, '..', '..', 'templates');

async function readTemplate(name: string): Promise<string> {
  return await Bun.file(join(TEMPLATES_DIR, name)).text();
}

/** lowercase → strip double quotes → non-alphanumeric runs → hyphens → trim hyphens.
 *  Apostrophes become hyphens ("What's Next?" → "what-s-next"). */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/["“”]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Next ADR number: max existing NNN in _adr + 1 (starts at 1). */
export function nextAdrNumber(root: string): number {
  let max = 0;
  if (dirExists(join(root, '_adr'))) {
    for (const rel of discoverAdrs(root)) {
      const m = basename(rel).match(/^(\d{3})-/);
      if (m !== null) max = Math.max(max, Number(m[1]));
    }
  }
  return max + 1;
}

const NEW_FLAGS: FlagSpec[] = [
  { name: 'json', boolean: true },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** §21/§37: `new` never silently resets an existing artifact. If the target
 *  file already exists, refuse unless the content would be byte-identical
 *  (idempotent no-op). */
async function existingContentGuard(
  abs: string,
  file: string,
  content: string,
  change: string,
): Promise<NewResult | null> {
  if (!isFile(abs)) return null;
  const existing = await Bun.file(abs).text();
  if (existing === content) {
    return { ok: true, command: 'new', exitCode: 0, change, file };
  }
  return {
    ok: false, command: 'new', exitCode: 1, change, file,
    error: `refusing to overwrite existing ${file} — it already has content; delete it or use a different name`,
  };
}

export async function run(args: string[]): Promise<NewResult> {
  const parsed = parseArgs(args, NEW_FLAGS);

  if (parsed.errors.length > 0) {
    return { ok: false, command: 'new', exitCode: 1, change: '', file: '', error: parsed.errors[0] };
  }

  const kind = parsed.positional[0] ?? '';
  const rawName = parsed.positional.slice(1).join(' ');
  const slug = slugify(rawName);

  if (kind !== 'task' && kind !== 'adr') {
    return {
      ok: false, command: 'new', exitCode: 1, change: rawName, file: '',
      error: kind === '' ? 'usage: cans new <adr|task> <name>' : `unknown kind "${kind}" — use "adr" or "task"`,
    };
  }

  if (slug === '') {
    return {
      ok: false, command: 'new', exitCode: 1, change: rawName, file: '',
      error: `empty slug from "${rawName}" — provide a non-empty title`,
    };
  }

  // §21 (QA-06 6c): only `init` may create cans/. `new` operates on an existing
  // workspace (walk-up `cans/`, CANS_ROOT, or a scratch dir under <cwd>/.tmp)
  // and must REFUSE — never auto-vivify a partial cans/ skeleton — when no
  // workspace directory exists. Every resolver result except the
  // `<cwd>/cans` last-resort points at a directory that already exists on
  // disk, so requiring an existing directory is exactly the no-vivify guard.
  let workspace = resolveWorkspaceRoot();
  if (workspace === null) workspace = resolveWorkspaceOrCreate();
  if (!dirExists(workspace)) {
    return {
      ok: false, command: 'new', exitCode: 1, change: slug, file: '',
      error: 'no cans workspace found — run `cans init` first',
    };
  }

  if (kind === 'task') {
    const tasksDir = join(workspace, '_tasks');
    mkdirp(tasksDir);
    const template = await readTemplate('task-template.md');
    const content = template.replaceAll('{slug}', slug);
    const file = join('_tasks', `${slug}.md`);
    const guard = await existingContentGuard(join(workspace, file), file, content, slug);
    if (guard !== null) return guard;
    await Bun.write(join(workspace, file), content);
    return { ok: true, command: 'new', exitCode: 0, change: slug, file };
  }

  // adr
  const adrDir = join(workspace, '_adr');
  mkdirp(adrDir);
  const n = nextAdrNumber(workspace);
  const NNN = String(n).padStart(3, '0');
  const template = await readTemplate('adr-template.md');
  const content = template
    .replaceAll('{NNN}', NNN)
    .replaceAll('{Title}', rawName)
    .replaceAll('{YYYY-MM-DD}', today());
  const file = join('_adr', `${NNN}-${slug}.md`);
  const guard = await existingContentGuard(join(workspace, file), file, content, slug);
  if (guard !== null) return guard;
  await Bun.write(join(workspace, file), content);
  return { ok: true, command: 'new', exitCode: 0, change: slug, file };
}
