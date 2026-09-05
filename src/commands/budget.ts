import { join } from 'path';
import type { BudgetReadResult, BudgetWriteResult, OutlineNode, Rules } from '../types';
import { resolveWorkspaceRoot, discoverSpecFiles, discoverActiveTasks, dirExists, isFile } from '../core/fs';
import { parseOutline } from '../core/outline';
import { loadRules } from '../core/rules';
import { buildRefGraph } from '../core/refs';
import { buildReadPlan, buildWritePlan } from '../core/token-budget';

export interface BudgetArgs {
  mode: 'read' | 'write';
  /** The subcommand candidate found at the first non-flag position
   *  ('' when absent, or the offending token for unknown-subcommand errors). */
  sub: string;
  concept: string;
  limit: number | null;
  change: string | null;
  json: boolean;
  /** §20/§37: malformed flags (--flag=value, unknown, missing value, invalid
   *  --limit value) — user errors, never silently ignored. */
  argErrors: string[];
}

/** §20 flag-position flexibility: budget's known flags (`--json` bool,
 *  `--limit`/`--change` value flags) are recognized anywhere on the line —
 *  including BEFORE the subcommand — so `budget --json read Sessions` ≡
 *  `budget read Sessions --json`. Values following value-flags are consumed
 *  even in the pre-scan; leftover tokens decide subcommand + concept.
 *  Error wording mirrors the shared parser (§20: `--flag value` only). */
export function parseBudgetArgs(args: string[]): BudgetArgs {
  const rest: string[] = [];
  const flagErrors: string[] = [];
  let json = false;
  let limitRaw: string | null = null;
  let change: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;

    // Reject --flag=value form
    if (a.startsWith('--') && a.includes('=')) {
      flagErrors.push(`invalid flag form "${a}" — use "--${a.slice(2).split('=')[0]} <value>"`);
      continue;
    }

    // Reject short flags / combined flags
    if (/^-[a-zA-Z]/.test(a) && !a.startsWith('--')) {
      flagErrors.push(`unknown flag "${a}" — no short flags supported`);
      continue;
    }

    if (a.startsWith('--')) {
      const name = a.slice(2);
      if (name === 'json') {
        json = true;
        continue;
      }
      if (name === 'limit' || name === 'change') {
        const val = args[i + 1];
        if (val === undefined || val.startsWith('--')) {
          flagErrors.push(`flag "--${name}" requires a value`);
          continue;
        }
        if (name === 'limit') limitRaw = val;
        else change = val;
        i++; // consume value
        continue;
      }
      flagErrors.push(`unknown flag "--${name}"`);
      continue;
    }

    rest.push(a);
  }

  // §37: unknown subcommands must error, never silently run as `read`.
  const sub = rest[0] === 'read' || rest[0] === 'write' ? rest[0] : (rest[0] ?? '');
  const concept = rest[1] ?? '';

  // §37: a malformed --limit value is a user error, not a silent default.
  // 0 stays a valid (degenerate) limit; negative / non-numeric / non-integer
  // values are rejected with the offending value named.
  let limit: number | null = null;
  if (limitRaw !== null) {
    const n = Number(limitRaw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      flagErrors.push(`invalid --limit value "${limitRaw}" — pass a positive integer`);
    } else {
      limit = n;
    }
  }

  return {
    mode: sub === 'write' ? 'write' : 'read',
    sub,
    concept,
    limit,
    change,
    json,
    argErrors: flagErrors,
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
  if (opts.sub !== 'read' && opts.sub !== 'write') {
    const error = opts.sub === ''
      ? 'usage: cans budget <read|write> <concept>'
      : `unknown subcommand "${opts.sub}" — valid: read, write`;
    return readFail(opts.sub, error);
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
      // §37 truthfulness: distinguish "the concept matches nothing" from
      // "the limit is smaller than the cheapest matching item" — a limit
      // problem must never be reported as a spelling problem (QA-10 M2b).
      if (opts.limit !== null) {
        const unbounded = buildReadPlan(
          opts.concept, files, graph.back, rules.token_budget,
          undefined, taskFile, activeTaskPaths,
        );
        if (unbounded.plan.length > 0) {
          const cheapest = Math.min(...unbounded.plan.map(p => p.estTokens));
          return readFail(
            opts.concept,
            `plan empty: --limit ${opts.limit} is below the cheapest item (${cheapest} tok) — raise the limit`,
          );
        }
      }
      return { ...result, ok: false, exitCode: 1, error: noMatchError(opts.concept) };
    }
    // §18 token_budget.warn_threshold: warn when plan usage reaches the
    // threshold. A deleted key (null) turns the warning off — never compare
    // against null (it would coerce to 0 and warn on every plan).
    const threshold = rules.token_budget.warn_threshold;
    if (threshold !== null && result.usagePercent >= threshold * 100) {
      console.error(
        `  ⚠ warning: plan usage ${result.usagePercent}% of ${result.budgetLimit} tokens ` +
        `exceeds token_budget.warn_threshold (${threshold * 100}%) — trim the plan or raise default_limit in _rules.yaml`,
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
