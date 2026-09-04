import { join } from 'path';
import type { BudgetReadResult, BudgetWriteResult, OutlineNode, Rules } from '../types';
import { parseArgs, type FlagSpec } from '../core/args';
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
  /** §20/§37: malformed flags (--flag=value, unknown, missing value) — user errors. */
  argErrors: string[];
}

const BUDGET_FLAGS: FlagSpec[] = [
  { name: 'limit', boolean: false },
  { name: 'change', boolean: false },
  { name: 'json', boolean: true },
];

export function parseBudgetArgs(args: string[]): BudgetArgs {
  // §37: unknown subcommands must error, never silently run as `read`.
  const sub = args[0] === 'read' || args[0] === 'write' ? args[0] : '';
  const parsed = parseArgs(args.slice(1), BUDGET_FLAGS);
  const concept = parsed.positional[0] ?? '';
  let limit: number | null = null;
  const limitRaw = parsed.flags.get('limit');
  if (typeof limitRaw === 'string') {
    const n = Number(limitRaw);
    if (Number.isFinite(n)) limit = n;
  }
  const change = typeof parsed.flags.get('change') === 'string' ? (parsed.flags.get('change') as string) : null;
  return {
    mode: sub === 'write' ? 'write' : 'read',
    concept,
    limit,
    change,
    json: parsed.flags.get('json') === true,
    argErrors: parsed.errors,
  };
}

function readFail(concept: string, error: string): BudgetReadResult {
  return {
    ok: false, command: 'budget-read', exitCode: 1, concept,
    plan: [], skipped: [], totalTokens: 0, budgetLimit: 0, usagePercent: 0,
    error,
  };
}

function writeFail(concept: string, error: string): BudgetWriteResult {
  return {
    ok: false, command: 'budget-write', exitCode: 1, concept,
    canEdit: [], mustNotEdit: [], backPointersToUpdate: [],
    error,
  };
}

/** §37: say what happened and what to do when nothing matches the concept. */
function noMatchError(concept: string): string {
  return `no files match concept "${concept}" — check spelling or run \`cans status\``;
}

const NO_WORKSPACE_ERROR = 'no cans workspace found — run `cans init` first, or cd into a project with a cans/ directory';

export async function run(args: string[]): Promise<BudgetReadResult | BudgetWriteResult> {
  const opts = parseBudgetArgs(args);

  // §37: reject unknown subcommands with a usage error (never success-shaped).
  const sub = args[0] ?? '';
  if (sub !== 'read' && sub !== 'write') {
    const error = sub === ''
      ? 'usage: cans budget <read|write> <concept>'
      : `unknown subcommand "${sub}" — valid: read, write`;
    return readFail(sub, error);
  }

  // §20: `--flag value` only — malformed flags are user errors, not silently ignored.
  if (opts.argErrors.length > 0) {
    const error = opts.argErrors.join('\n');
    return opts.mode === 'write' ? writeFail(opts.concept, error) : readFail(opts.concept, error);
  }

  if (opts.concept === '') {
    return opts.mode === 'write'
      ? writeFail('', 'usage: cans budget write <concept>\n  Example: cans budget write sessions')
      : readFail('', 'usage: cans budget read <concept>\n  Example: cans budget read sessions');
  }

  const workspace = resolveWorkspaceRoot();
  if (workspace === null) {
    return opts.mode === 'write'
      ? writeFail(opts.concept, NO_WORKSPACE_ERROR)
      : readFail(opts.concept, NO_WORKSPACE_ERROR);
  }

  let rules: Rules;
  try {
    rules = loadRules(workspace);
  } catch (e) {
    const error = `invalid _rules.yaml: ${e instanceof Error ? e.message : String(e)}`;
    return opts.mode === 'write' ? writeFail(opts.concept, error) : readFail(opts.concept, error);
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

    // §26 step 3: active tasks mentioning the concept join the plan (score 80).
    const activeTaskPaths = dirExists(join(workspace, '_tasks'))
      ? discoverActiveTasks(workspace).map(rel => join(workspace, rel))
      : [];

    const result = buildReadPlan(
      opts.concept,
      files,
      graph.back,
      rules.token_budget,
      opts.limit ?? undefined,
      taskFile,
      activeTaskPaths,
    );
    if (result.plan.length === 0) {
      return { ...result, ok: false, exitCode: 1, error: noMatchError(opts.concept) };
    }
    // §18 token_budget.warn_threshold: warn when plan usage reaches the threshold.
    const thresholdPct = rules.token_budget.warn_threshold * 100;
    if (result.usagePercent >= thresholdPct) {
      console.error(
        `  ⚠ warning: plan usage ${result.usagePercent}% of ${result.budgetLimit} tokens ` +
        `exceeds token_budget.warn_threshold (${thresholdPct}%) — trim the plan or raise default_limit in _rules.yaml`,
      );
    }
    return result;
  }

  // write
  const activeTasks = dirExists(join(workspace, '_tasks'))
    ? discoverActiveTasks(workspace).map(rel => join(workspace, rel))
    : [];
  const result = buildWritePlan(opts.concept, files, graph.back, activeTasks);
  // §19: empty scope (no home, no mentioning task, no back-refs) = user-correctable failure.
  if (result.canEdit.length === 0 && result.mustNotEdit.length === 0) {
    return { ...result, ok: false, exitCode: 1, error: noMatchError(opts.concept) };
  }
  return result;
}
