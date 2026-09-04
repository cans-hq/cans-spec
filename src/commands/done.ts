import { join } from 'path';
import { renameSync } from 'fs';
import type { DoneResult, OutlineNode } from '../types';
import { resolveWorkspaceRoot, mkdirp, isFile } from '../core/fs';
import { parseOutline, flattenNodes } from '../core/outline';
import { checkWorkspace, type CheckArgs } from './check';

export interface DoneArgs {
  name: string;
  allowIncomplete: boolean;
  skipCheck: boolean;
  json: boolean;
}

export function parseDoneArgs(args: string[]): DoneArgs {
  let name = '';
  let allowIncomplete = false;
  let skipCheck = false;
  let json = false;
  for (const a of args) {
    if (a === '--allow-incomplete') allowIncomplete = true;
    else if (a === '--skip-check') skipCheck = true;
    else if (a === '--json') json = true;
    else if (!a.startsWith('--') && name === '') name = a;
  }
  return { name, allowIncomplete, skipCheck, json };
}

const ZERO_GATES = { human: 0, humanOpen: 0, tasks: 0, tasksOpen: 0 };

const ZERO_CHECK_ARGS: CheckArgs = {
  fix: false, strict: false, refsOnly: false, noRedundancy: false, file: null, json: false,
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function run(args: string[]): Promise<DoneResult> {
  const opts = parseDoneArgs(args);
  const { name, allowIncomplete, skipCheck } = opts;

  const workspace = resolveWorkspaceRoot();
  if (workspace === null) {
    return {
      ok: false, command: 'done', exitCode: 1, change: name,
      gates: { ...ZERO_GATES }, archived: null, backPointersUpdated: 0,
    };
  }

  const taskFile = join(workspace, '_tasks', `${name}.md`);
  if (!isFile(taskFile)) {
    return {
      ok: false, command: 'done', exitCode: 1, change: name,
      gates: { ...ZERO_GATES }, archived: null, backPointersUpdated: 0,
    };
  }

  let flat: OutlineNode[] = [];
  try {
    flat = flattenNodes(parseOutline(await Bun.file(taskFile).text(), taskFile));
  } catch {
    return {
      ok: false, command: 'done', exitCode: 1, change: name,
      gates: { ...ZERO_GATES }, archived: null, backPointersUpdated: 0,
    };
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

  const blocked = (): DoneResult => ({
    ok: false, command: 'done', exitCode: 1, change: name,
    gates, archived: null, backPointersUpdated: 0,
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
  const archiveDir = join(workspace, '_tasks', '_archive');
  mkdirp(archiveDir);
  const archivedRel = join('_tasks', '_archive', `${today()}-${name}.md`);
  renameSync(taskFile, join(workspace, archivedRel));

  return {
    ok: true, command: 'done', exitCode: 0, change: name,
    gates, archived: archivedRel, backPointersUpdated: 0,
  };
}
