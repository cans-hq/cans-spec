import { join } from 'path';
import type { BudgetReadResult, BudgetWriteResult, OutlineNode, Rules } from '../types';
import { resolveWorkspaceRoot, discoverSpecFiles, discoverActiveTasks, dirExists, isFile } from '../core/fs';
import { parseOutline } from '../core/outline';
import { loadRules } from '../core/rules';
import { buildRefGraph } from '../core/refs';
import { buildReadPlan, buildWritePlan } from '../core/token-budget';

export interface BudgetArgs {
  mode: 'read' | 'write';
  concept: string;
  limit: number | null;
  change: string | null;
  json: boolean;
}

export function parseBudgetArgs(args: string[]): BudgetArgs {
  const mode: 'read' | 'write' = args[0] === 'write' ? 'write' : 'read';
  let concept = '';
  let limit: number | null = null;
  let change: string | null = null;
  let json = false;
  const rest = args.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--limit') {
      const n = Number(rest[i + 1]);
      if (Number.isFinite(n) && rest[i + 1] !== undefined) limit = n;
    } else if (a === '--change') {
      change = rest[i + 1] ?? null;
    } else if (a === '--json') {
      json = true;
    } else if (!a.startsWith('--') && concept === '') {
      concept = a;
    }
  }
  return { mode, concept, limit, change, json };
}

function readFail(concept: string): BudgetReadResult {
  return {
    ok: false, command: 'budget-read', exitCode: 1, concept,
    plan: [], skipped: [], totalTokens: 0, budgetLimit: 0, usagePercent: 0,
  };
}

function writeFail(concept: string): BudgetWriteResult {
  return {
    ok: false, command: 'budget-write', exitCode: 1, concept,
    canEdit: [], mustNotEdit: [], backPointersToUpdate: [],
  };
}

export async function run(args: string[]): Promise<BudgetReadResult | BudgetWriteResult> {
  const opts = parseBudgetArgs(args);

  const workspace = resolveWorkspaceRoot();
  if (workspace === null) {
    return opts.mode === 'write' ? writeFail(opts.concept) : readFail(opts.concept);
  }
  if (opts.concept === '') {
    return opts.mode === 'write' ? writeFail('') : readFail('');
  }

  let rules: Rules;
  try {
    rules = loadRules(workspace);
  } catch {
    return opts.mode === 'write' ? writeFail(opts.concept) : readFail(opts.concept);
  }

  const files = new Map<string, OutlineNode[]>();
  for (const rel of discoverSpecFiles(workspace)) {
    try {
      files.set(rel, parseOutline(await Bun.file(join(workspace, rel)).text(), rel));
    } catch {
      // unreadable spec file: excluded from the plan
    }
  }
  const graph = buildRefGraph(files, workspace);

  if (opts.mode === 'read') {
    // --change: center the plan on an active task file.
    let taskFile: string | undefined;
    if (opts.change !== null) {
      const p = join(workspace, '_tasks', `${opts.change}.md`);
      if (isFile(p)) taskFile = p;
    }
    const result = buildReadPlan(
      opts.concept,
      files,
      graph.back,
      rules.token_budget,
      opts.limit ?? undefined,
      taskFile,
    );
    if (result.plan.length === 0) {
      return { ...result, ok: false, exitCode: 1 };
    }
    return result;
  }

  // write
  const activeTasks = dirExists(join(workspace, '_tasks'))
    ? discoverActiveTasks(workspace).map(rel => join(workspace, rel))
    : [];
  return buildWritePlan(opts.concept, files, graph.back, activeTasks);
}
