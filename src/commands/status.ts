import { join, basename } from 'path';
import { readFileSync } from 'fs';
import type { StatusResult, OutlineNode } from '../types';
import {
  resolveWorkspaceRoot, discoverSpecFiles, discoverActiveTasks,
  discoverArchivedTasks, discoverAdrs, dirExists,
} from '../core/fs';
import { parseOutline, flattenNodes } from '../core/outline';
import { parseArgs, type FlagSpec } from '../core/args';

export interface StatusArgs {
  unclaimed: boolean;
  blocked: boolean;
  owners: boolean;
  json: boolean;
  errors: string[];
}

const STATUS_FLAGS: FlagSpec[] = [
  { name: 'unclaimed', boolean: true },
  { name: 'blocked', boolean: true },
  { name: 'owners', boolean: true },
  { name: 'json', boolean: true },
];

export function parseStatusArgs(args: string[]): StatusArgs {
  const parsed = parseArgs(args, STATUS_FLAGS);
  return {
    unclaimed: parsed.flags.has('unclaimed'),
    blocked: parsed.flags.has('blocked'),
    owners: parsed.flags.has('owners'),
    json: parsed.flags.has('json'),
    errors: parsed.errors,
  };
}

// globFiles throws ENOENT on missing dirs — guard the optional ones.
function safeActiveTasks(root: string): string[] {
  return dirExists(join(root, '_tasks')) ? discoverActiveTasks(root) : [];
}

function safeArchivedTasks(root: string): string[] {
  return dirExists(join(root, '_tasks', '_archive')) ? discoverArchivedTasks(root) : [];
}

function safeAdrs(root: string): string[] {
  return dirExists(join(root, '_adr')) ? discoverAdrs(root) : [];
}

function countConflicts(conflictsPath: string): number {
  try {
    return readFileSync(conflictsPath, 'utf-8')
      .split('\n')
      .filter(line => /status:\s*unresolved/i.test(line)).length;
  } catch {
    return 0;
  }
}

export async function run(args: string[]): Promise<StatusResult> {
  const opts = parseStatusArgs(args);

  if (opts.errors.length > 0) {
    return {
      ok: false, command: 'status', exitCode: 1,
      specFiles: 0, activeTasks: 0, archivedTasks: 0, adrCount: 0,
      tasks: { total: 0, done: 0, unclaimed: 0, blocked: 0 },
      owners: {},
      taskFiles: [],
      conflicts: 0,
      error: opts.errors[0],
    };
  }

  const workspace = resolveWorkspaceRoot();
  if (workspace === null) {
    return {
      ok: false, command: 'status', exitCode: 1,
      specFiles: 0, activeTasks: 0, archivedTasks: 0, adrCount: 0,
      tasks: { total: 0, done: 0, unclaimed: 0, blocked: 0 },
      owners: {},
      taskFiles: [],
      conflicts: 0,
      error: 'no cans workspace found — run `cans init` first',
    };
  }

  const specFiles = discoverSpecFiles(workspace);
  const activeTasks = safeActiveTasks(workspace);
  const archivedTasks = safeArchivedTasks(workspace);
  const adrs = safeAdrs(workspace);

  let tasksTotal = 0;
  let tasksDone = 0;
  let tasksUnclaimed = 0;
  let blockedFiles = 0;
  const owners: Record<string, { tasks: number; done: number }> = {};
  const taskFiles: StatusResult['taskFiles'] = [];

  for (const rel of activeTasks) {
    let flat: OutlineNode[] = [];
    try {
      flat = flattenNodes(parseOutline(await Bun.file(join(workspace, rel)).text(), rel));
    } catch {
      // unparsable task file: contributes nothing but its existence
    }

    const tasks = flat.filter(n => n.isTask && !n.isHumanGate);
    const gates = flat.filter(n => n.isTask && n.isHumanGate);
    const tasksDoneCount = tasks.filter(n => n.isDone).length;
    const gatesDoneCount = gates.filter(n => n.isDone).length;
    const isBlocked = gates.some(n => !n.isDone) || tasks.some(n => !n.isDone);
    const unclaimedCount = tasks.filter(n => n.owner === null).length;

    taskFiles.push({
      name: basename(rel, '.md'),
      tasksDone: tasksDoneCount,
      tasksTotal: tasks.length,
      gatesDone: gatesDoneCount,
      gatesTotal: gates.length,
      blocked: isBlocked,
      unclaimed: unclaimedCount,
    });

    if (isBlocked) blockedFiles++;
    tasksTotal += tasks.length;
    tasksDone += tasksDoneCount;
    tasksUnclaimed += unclaimedCount;

    for (const n of flat) {
      if (!n.isTask) continue;
      if (n.owner === null || n.owner === '@human') continue;
      const entry = owners[n.owner] ?? { tasks: 0, done: 0 };
      entry.tasks++;
      if (n.isDone) entry.done++;
      owners[n.owner] = entry;
    }
  }

  return {
    ok: true, command: 'status', exitCode: 0,
    specFiles: specFiles.length,
    activeTasks: activeTasks.length,
    archivedTasks: archivedTasks.length,
    adrCount: adrs.length,
    tasks: { total: tasksTotal, done: tasksDone, unclaimed: tasksUnclaimed, blocked: blockedFiles },
    owners,
    taskFiles,
    conflicts: countConflicts(join(workspace, '_collab', 'conflicts.md')),
    filter: opts.unclaimed ? 'unclaimed' : opts.blocked ? 'blocked' : opts.owners ? 'owners' : undefined,
  };
}
