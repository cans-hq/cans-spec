import { join } from 'path';
import { renameSync } from 'fs';
import type { DoneResult, OutlineNode } from '../types';
import { resolveWorkspaceRoot, mkdirp, isFile, dirExists, globFiles } from '../core/fs';
import { parseOutline, flattenNodes } from '../core/outline';
import { checkWorkspace, type CheckArgs } from './check';
import { parseArgs, type FlagSpec } from '../core/args';

export interface DoneArgs {
  name: string;
  allowIncomplete: boolean;
  skipCheck: boolean;
  json: boolean;
  errors: string[];
}

const DONE_FLAGS: FlagSpec[] = [
  { name: 'allow-incomplete', boolean: true },
  { name: 'skip-check', boolean: true },
  { name: 'json', boolean: true },
];

export function parseDoneArgs(args: string[]): DoneArgs {
  const parsed = parseArgs(args, DONE_FLAGS);
  return {
    name: parsed.positional[0] ?? '',
    allowIncomplete: parsed.flags.has('allow-incomplete'),
    skipCheck: parsed.flags.has('skip-check'),
    json: parsed.flags.has('json'),
    errors: parsed.errors,
  };
}

const ZERO_GATES = { human: 0, humanOpen: 0, tasks: 0, tasksOpen: 0 };

const ZERO_CHECK_ARGS: CheckArgs = {
  fix: false, strict: false, refsOnly: false, noRedundancy: false, file: null, json: false,
};

/** §37: every done failure carries the real diagnosis, not a fake check diagnosis. */
function failResult(name: string, error: string): DoneResult {
  return {
    ok: false, command: 'done', exitCode: 1, change: name,
    gates: { ...ZERO_GATES }, archived: null, backPointersUpdated: 0,
    error,
  };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** §24: archive record names are YYYY-MM-DD-<name>.md. A second same-day done of a
 *  recreated task must never clobber the earlier archived record — pick the first
 *  non-colliding name (-2, -3, …) instead. */
function pickArchiveName(archiveDir: string, name: string): string {
  const base = `${today()}-${name}.md`;
  if (!isFile(join(archiveDir, base))) return base;
  for (let i = 2; ; i++) {
    const candidate = `${today()}-${name}-${i}.md`;
    if (!isFile(join(archiveDir, candidate))) return candidate;
  }
}

export async function run(args: string[]): Promise<DoneResult> {
  const opts = parseDoneArgs(args);
  if (opts.errors.length > 0) {
    return failResult('', opts.errors[0]);
  }

  const { name, allowIncomplete, skipCheck } = opts;

  if (name === '') {
    return failResult('', 'usage: cans done <task-name>');
  }

  const workspace = resolveWorkspaceRoot();
  if (workspace === null) {
    return failResult(name, 'no cans workspace found — run `cans init` first');
  }

  // §24: task names resolve ONLY inside _tasks/. A name carrying path
  // separators or traversal segments can never name a task there — refuse
  // with the standard not-found error BEFORE any gate/read/rename logic
  // (QA-08 A13/A14: no gate evaluation outside _tasks/, no raw ENOENT, nothing
  // moved, exit 1).
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    return failResult(name, `task "${name}" not found in _tasks/ — run \`cans status\` to list active tasks`);
  }

  const taskFile = join(workspace, '_tasks', `${name}.md`);
  if (!isFile(taskFile)) {
    // Distinguish "already archived" from "never existed" (§24: the archive is
    // the only history `done` keeps — say so instead of a generic failure).
    const archiveDir = join(workspace, '_tasks', '_archive');
    if (dirExists(archiveDir)) {
      const archived = globFiles(archiveDir, `*-${name}.md`);
      if (archived.length > 0) {
        return failResult(name, `task "${name}" is already archived (_tasks/_archive/${archived[0]})`);
      }
    }
    return failResult(name, `task "${name}" not found in _tasks/ — run \`cans status\` to list active tasks`);
  }

  let taskNodes: OutlineNode[] = [];
  let flat: OutlineNode[] = [];
  try {
    taskNodes = parseOutline(await Bun.file(taskFile).text(), `_tasks/${name}.md`);
    flat = flattenNodes(taskNodes);
  } catch {
    return failResult(name, `cannot parse _tasks/${name}.md — check for tab indentation or malformed content`);
  }

  const humanGates = flat.filter(n => n.isTask && n.isHumanGate);
  const humanOpen = humanGates.filter(n => !n.isDone).length;
  const tasks = flat.filter(n => n.isTask && !n.isHumanGate);
  const tasksOpen = tasks.filter(n => !n.isDone).length;
  const gates = {
    human: humanGates.length,
    humanOpen,
    tasks: tasks.length,
    tasksOpen,
  };

  // §36: gate detail lines for human output (file:line — text).
  const gateDetails = flat
    .filter(n => n.isTask && !n.isDone)
    .map(n => ({ file: `_tasks/${name}.md`, line: n.line, text: n.text }));

  const blocked = (): DoneResult => ({
    ok: false, command: 'done', exitCode: 1, change: name,
    gates, gateDetails, archived: null, backPointersUpdated: 0,
  });

  // Gate 1: unchecked ← @human gates always block.
  if (humanOpen > 0) return blocked();

  // Gate 2: open tasks block unless --allow-incomplete.
  if (tasksOpen > 0 && !allowIncomplete) return blocked();

  // Gate 3: final cans check must pass unless --skip-check.
  if (!skipCheck) {
    const check = await checkWorkspace(workspace, ZERO_CHECK_ARGS);
    if (check.errorCount > 0) return blocked();
  }

  // Archive: _tasks/<name>.md → _tasks/_archive/YYYY-MM-DD-<name>.md
  // (§24: never overwrite an earlier same-day archive record).
  const archiveDir = join(workspace, '_tasks', '_archive');
  mkdirp(archiveDir);
  const archivedRel = join('_tasks', '_archive', pickArchiveName(archiveDir, name));
  renameSync(taskFile, join(workspace, archivedRel));

  // §24: "Updates back-pointers if needed." Reuse the check engine's --fix pass
  // (strictly ref-by comment rewrites in spec files) and report the count.
  // The task has just been renamed into _archive/, so its parsed nodes are
  // injected under their former _tasks/<name>.md identity — refs held by the
  // archived task still earn their targets' ref-by marks (QA-04 #10). The pass
  // is gated on §18 references.back_pointers inside checkWorkspace (off →
  // zero writes, backPointersUpdated 0).
  const fixRun = await checkWorkspace(workspace, {
    ...ZERO_CHECK_ARGS,
    fix: true,
    extraReferrer: { key: `_tasks/${name}.md`, nodes: taskNodes },
  });

  return {
    ok: true, command: 'done', exitCode: 0, change: name,
    gates, archived: archivedRel, backPointersUpdated: fixRun.backPointersUpdated,
  };
}
