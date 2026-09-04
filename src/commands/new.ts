import { join, basename } from 'path';
import type { NewResult } from '../types';
import { resolveWorkspaceOrCreate, mkdirp, discoverAdrs, dirExists } from '../core/fs';

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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function run(args: string[]): Promise<NewResult> {
  const kind = args[0] ?? '';
  const rawName = args.slice(1).join(' ');
  const slug = slugify(rawName);

  if (kind !== 'task' && kind !== 'adr') {
    return { ok: false, command: 'new', exitCode: 1, change: rawName, file: '' };
  }
  if (slug === '') {
    return { ok: false, command: 'new', exitCode: 1, change: rawName, file: '' };
  }

  const workspace = resolveWorkspaceOrCreate();

  if (kind === 'task') {
    const tasksDir = join(workspace, '_tasks');
    mkdirp(tasksDir);
    const template = await readTemplate('task-template.md');
    const content = template.replaceAll('{slug}', slug);
    const file = join('_tasks', `${slug}.md`);
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
  await Bun.write(join(workspace, file), content);
  return { ok: true, command: 'new', exitCode: 0, change: slug, file };
}
