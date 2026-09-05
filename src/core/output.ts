import type {
  CommandResult, CheckResult, Issue, InitResult, NewResult, DoneResult, StatusResult,
  BudgetReadResult, BudgetWriteResult, ImportResult, ExportResult, VersionResult,
} from '../types';

/** Single emission point. Commands never console.log or process.exit directly.
 *  `refsOnly` (check only, §22/§36): human output is scoped to the References
 *  section (+ Rules + summary); JSON output is always the full result. */
export function emit(result: CommandResult, json: boolean, refsOnly?: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  printHuman(result, refsOnly);
}

const CATEGORY_ORDER: Array<Issue['category']> = ['structure', 'style', 'refs', 'redundancy', 'overflow'];

export function printHuman(result: CommandResult, refsOnly?: boolean): void {
  switch (result.command) {
    case 'check':
      printCheckHuman(result as CheckResult, refsOnly);
      break;
    case 'help':
      printHelp();
      break;
    case 'version': {
      const r = result as VersionResult;
      console.log(`cans ${r.version}`);
      break;
    }
    case 'init': {
      const r = result as InitResult;
      if (!r.ok) {
        console.log(`✗ ${r.error ?? 'cannot init here'}`);
        break;
      }
      console.log(`Workspace: ${r.root}`);
      if (r.created?.length) {
        for (const c of r.created) console.log(`  + ${c}`);
      }
      if (r.skipped?.length) {
        for (const s of r.skipped) console.log(`  = ${s} (exists, skipped)`);
      }
      break;
    }
    case 'new': {
      const r = result as NewResult;
      if (r.ok) {
        console.log(`Created ${r.file}`);
        if (r.warning) console.log(`  ⚠ ${r.warning}`);
      } else {
        console.log(`✗ ${r.error ?? 'failed to create'}`);
      }
      break;
    }
    case 'done': {
      const r = result as DoneResult;
      if (!r.ok) {
        if (r.error) {
          console.log(`✗ ${r.error}`);
        } else if ((r.gates?.humanOpen ?? 0) > 0) {
          console.log(`✗ BLOCKED: ${r.gates.humanOpen} unchecked ← @human gate${r.gates.humanOpen > 1 ? 's' : ''}`);
          // §36: file:line — gate text
          for (const g of r.gateDetails ?? []) {
            if (g.text.includes('@human')) {
              console.log(`  ${g.file}:${g.line} — ${g.text}`);
            }
          }
          console.log('  Check the gate, then re-run cans done.');
        } else if ((r.gates?.tasksOpen ?? 0) > 0) {
          console.log(`✗ BLOCKED: ${r.gates.tasksOpen} open task${r.gates.tasksOpen > 1 ? 's' : ''} (--allow-incomplete to override)`);
          for (const g of r.gateDetails ?? []) {
            if (!g.text.includes('@human')) {
              console.log(`  ${g.file}:${g.line} — ${g.text}`);
            }
          }
        } else {
          console.log(`✗ BLOCKED: cans check failed (--skip-check to override)`);
        }
      } else {
        console.log(`✓ Archived ${r.archived}`);
      }
      break;
    }
    case 'status': {
      const r = result as StatusResult;
      if (!r.ok) {
        // §37: say what actually happened. Arg/usage failures carry the real
        // diagnosis in `error` — surface it verbatim (QA-10 M1: a rejected flag
        // must never be re-diagnosed as a missing workspace). The genuine
        // missing-workspace case also reports through `error`.
        if (r.error) {
          console.log(`✗ ${r.error}`);
        } else {
          console.log('✗ No cans workspace found.');
          console.log('  Run `cans init` or cd into a project with a cans/ directory.');
        }
        break;
      }
      if (r.filter === 'owners') {
        // Owners view: per-owner rollup, structurally distinct from the default report.
        console.log('Owners view:');
        const names = Object.keys(r.owners ?? {});
        if (names.length === 0) console.log('  no owners assigned yet');
        for (const name of names) {
          const s = (r.owners ?? {})[name];
          console.log(`  ${name}: ${s.tasks} task(s), ${s.done} done`);
        }
        if (r.conflicts > 0) console.log(`Conflicts: ${r.conflicts} unresolved in _collab/conflicts.md`);
        break;
      }
      console.log(`Files: ${r.specFiles} specs, ${r.activeTasks} tasks, ${r.archivedTasks} archived, ${r.adrCount} ADRs`);
      console.log(`Tasks: ${r.tasks?.done ?? 0}/${r.tasks?.total ?? 0} done, ${r.tasks?.unclaimed ?? 0} unclaimed, ${r.tasks?.blocked ?? 0} blocked`);
      if (r.owners && Object.keys(r.owners).length > 0) {
        console.log(`Owners: ${Object.keys(r.owners).join(', ')}`);
      }
      let shown = r.taskFiles ?? [];
      if (r.filter === 'unclaimed') {
        // Only task files that still hold unclaimed items (§25 semantics).
        shown = shown.filter(tf => (tf.unclaimed ?? Math.max(tf.tasksTotal - tf.tasksDone, 0)) > 0);
      } else if (r.filter === 'blocked') {
        shown = shown.filter(tf => tf.blocked);
      }
      // §36: multi-line per-task block
      for (const tf of shown) {
        console.log(`  ${tf.name}:`);
        console.log(`    Tasks: ${tf.tasksDone}/${tf.tasksTotal}`);
        console.log(`    Gates: ${tf.gatesDone}/${tf.gatesTotal} ← @human`);
        if (tf.blocked) console.log('    ⚠ BLOCKED');
      }
      if (r.conflicts > 0) console.log(`Conflicts: ${r.conflicts} unresolved in _collab/conflicts.md`);
      break;
    }
    case 'budget-read': {
      const r = result as BudgetReadResult;
      if (!r.ok) {
        console.log(`✗ ${r.error ?? `No files match concept "${r.concept}".`}`);
        break;
      }
      console.log(`Reading plan for: ${r.concept}`);
      let i = 1;
      for (const item of r.plan ?? []) {
        const anchor = item.anchor ? `#${item.anchor}` : '';
        console.log(`  ${i++}. ${item.file}${anchor} ← ${item.reason} (${item.estTokens} tok)`);
      }
      if (r.skipped?.length) {
        console.log(`Skipped:`);
        for (const s of r.skipped) console.log(`  ${s}`);
      }
      console.log(`Budget: ${r.totalTokens} / ${r.budgetLimit} tokens (${r.usagePercent}%)`);
      break;
    }
    case 'budget-write': {
      const r = result as BudgetWriteResult;
      if (!r.ok) {
        console.log(`✗ ${r.error ?? `No files match concept "${r.concept}".`}`);
        break;
      }
      console.log(`Writing scope for: ${r.concept}`);
      console.log(`CAN edit:`);
      for (const e of r.canEdit ?? []) console.log(`  ${e.file} ← ${e.reason}`);
      console.log(`MUST NOT edit:`);
      for (const e of r.mustNotEdit ?? []) console.log(`  ${e.file} ← ${e.reason}`);
      break;
    }
    case 'import': {
      const r = result as ImportResult;
      if (!r.ok) {
        console.log(`✗ ${r.error ?? 'import failed'}`);
        break;
      }
      if (r.dryRun) {
        console.log(`[dry-run] Would import ${r.format} from ${r.source}. No files written.`);
      } else {
        console.log(`Imported ${r.format} from ${r.source}`);
      }
      for (const f of r.newFiles ?? []) console.log(`  + ${f}`);
      for (const f of r.merged ?? []) console.log(`  ~ ${f} (merged)`);
      for (const c of r.conflicts ?? []) console.log(`  ! ${c.file}:${c.line} ${c.resolution}`);
      break;
    }
    case 'export': {
      const r = result as ExportResult;
      if (!r.ok) {
        console.log(`✗ ${r.error ?? 'export failed'}`);
        break;
      }
      if (r.dryRun) {
        console.log(`[dry-run] Would export ${r.format} → ${r.outputDir} (${r.filesExported} files). No files written.`);
      } else {
        console.log(`Exported ${r.format} → ${r.outputDir} (${r.filesExported} files)`);
      }
      break;
    }
    default: {
      // §37: unknown command — say what happened and how to fix it.
      const err = (result as { error?: string }).error;
      if (err) {
        console.log(`✗ ${err}`);
      } else {
        console.log(`✗ Unknown command "${result.command}".`);
        console.log('  Run `cans help` for available commands.');
      }
    }
  }
}

function printCheckHuman(r: CheckResult, refsOnly?: boolean): void {
  // §37: check-level failures (unknown flag, no cans workspace, invalid
  // _rules.yaml, unmatched file filter) carry their diagnosis in `error` —
  // print it standalone, never inside a report-shaped body.
  const failure = (r as { error?: string }).error;
  if (failure) {
    console.log(`✗ ${failure}`);
    return;
  }

  const byCategory = new Map<string, Issue[]>();
  for (const i of r.issues) {
    const list = byCategory.get(i.category) ?? [];
    list.push(i);
    byCategory.set(i.category, list);
  }
  if (!refsOnly) {
    console.log('Structure');
    console.log(`  ${r.files} files, ${r.nodes} nodes, max depth ${r.maxDepth}`);
    printIssues(byCategory.get('structure'));

    console.log('Style');
    printIssues(byCategory.get('style'));
  }

  console.log('References');
  console.log(`  ${r.refs.total} see: refs, ${r.refs.broken} broken, ${r.refs.deepHops} deep hops`);
  console.log(`  back-pointers: ${r.backPointers.current}/${r.backPointers.total} current`);
  printIssues(byCategory.get('refs'));

  if (!refsOnly) {
    console.log('Redundancy');
    printIssues(byCategory.get('redundancy'));
    if (!byCategory.get('redundancy')?.length) {
      const none = r.issues.filter(i => i.category === 'redundancy').length === 0;
      if (none) console.log('  ✓ no redundancy detected');
    }

    console.log('Overflow');
    if (!byCategory.get('overflow')?.length) {
      console.log('  ✓ no code blocks, tables, or oversized nodes');
    } else {
      printIssues(byCategory.get('overflow'));
    }
  }

  // §22: the fixed report order ends Structure → Style → References →
  // Redundancy → Overflow → Rules → Summary (QA-02 F17).
  if (r.rulesSummary !== undefined) {
    console.log('Rules (_rules.yaml)');
    console.log(`  ✓ ${r.rulesSummary}`);
  }

  void CATEGORY_ORDER;
  console.log('');
  console.log(`${r.errorCount} errors, ${r.warningCount} warnings.`);
}

function printIssues(issues: Issue[] | undefined): void {
  for (const i of issues ?? []) {
    const mark = i.level === 'error' ? '✗' : '⚠';
    // Avoid duplicating the file path when the message already carries it (parse errors)
    const msg = i.message.startsWith(`${i.file}:`) ? i.message.slice(i.file.length + 1) : i.message;
    const linePart = i.line > 0 ? `:${i.line}` : '';
    console.log(`  ${mark} ${i.file}${linePart} — ${msg}`);
    if (i.suggestion) console.log(`    ${i.suggestion}`);
  }
}

function printHelp(): void {
  console.log(`CANS — Canonical Agent-Native Spec

Usage: cans <command> [args]

Commands:
  init [--flat|--folders] [--bare] [--force] [--tool <name>]
  check [--fix] [--strict] [--refs-only] [--no-redundancy] [file] [--json]
  new adr <title>
  new task <name>
  done <name> [--allow-incomplete] [--skip-check] [--json]
  status [--unclaimed] [--blocked] [--owners] [--json]
  budget read <concept> [--limit <tokens>] [--change <name>] [--json]
  budget write <concept> [--json]
  import <format> <path> [--out <path>] [--dry-run] [--merge-strategy <s>] [--json]
  export <format> [--from <path>] [--include-tasks] [--vault <path>] [--dry-run] [--json]
  help
  version

Formats: opml, dynalist, logseq, obsidian
Config:  cans/_rules.yaml
Agents:  cans/AGENTS.md`);
}
