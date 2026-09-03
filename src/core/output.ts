import type { CommandResult, CheckResult, Issue } from '../types';

/** Single emission point. Commands never console.log or process.exit directly. */
export function emit(result: CommandResult, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  printHuman(result);
}

const CATEGORY_ORDER: Array<Issue['category']> = ['structure', 'style', 'refs', 'redundancy', 'overflow'];

export function printHuman(result: CommandResult): void {
  switch (result.command) {
    case 'check':
      printCheckHuman(result as CheckResult);
      break;
    case 'help':
      printHelp();
      break;
    case 'init': {
      const r = result as any;
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
      const r = result as any;
      console.log(r.ok ? `Created ${r.file}` : `✗ ${r.file ?? r.change}`);
      break;
    }
    case 'done': {
      const r = result as any;
      if (!r.ok) {
        if (r.gates?.humanOpen > 0) {
          console.log(`✗ BLOCKED: ${r.gates.humanOpen} unchecked ← @human gate`);
          console.log(`  Check the gate, then re-run cans done.`);
        } else if (r.gates?.tasksOpen > 0) {
          console.log(`✗ BLOCKED: ${r.gates.tasksOpen} open tasks (--allow-incomplete to override)`);
        } else {
          console.log(`✗ BLOCKED: cans check failed (--skip-check to override)`);
        }
      } else {
        console.log(`✓ Archived ${r.archived}`);
      }
      break;
    }
    case 'status': {
      const r = result as any;
      console.log(`Files: ${r.specFiles} specs, ${r.activeTasks} tasks, ${r.archivedTasks} archived, ${r.adrCount} ADRs`);
      console.log(`Tasks: ${r.tasks?.done ?? 0}/${r.tasks?.total ?? 0} done, ${r.tasks?.unclaimed ?? 0} unclaimed, ${r.tasks?.blocked ?? 0} blocked`);
      if (r.owners && Object.keys(r.owners).length > 0) {
        console.log(`Owners: ${Object.keys(r.owners).join(', ')}`);
      }
      for (const tf of r.taskFiles ?? []) {
        const flag = tf.blocked ? '    ⚠ BLOCKED' : '';
        console.log(`  ${tf.name}: tasks ${tf.tasksDone}/${tf.tasksTotal}, gates ${tf.gatesDone}/${tf.gatesTotal}${flag}`);
      }
      if (r.conflicts > 0) console.log(`Conflicts: ${r.conflicts} unresolved in _collab/conflicts.md`);
      break;
    }
    case 'budget-read': {
      const r = result as any;
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
      const r = result as any;
      console.log(`Writing scope for: ${r.concept}`);
      console.log(`CAN edit:`);
      for (const e of r.canEdit ?? []) console.log(`  ${e.file} ← ${e.reason}`);
      console.log(`MUST NOT edit:`);
      for (const e of r.mustNotEdit ?? []) console.log(`  ${e.file} ← ${e.reason}`);
      break;
    }
    case 'import': {
      const r = result as any;
      console.log(`Imported ${r.format} from ${r.source}`);
      for (const f of r.newFiles ?? []) console.log(`  + ${f}`);
      for (const f of r.merged ?? []) console.log(`  ~ ${f} (merged)`);
      for (const c of r.conflicts ?? []) console.log(`  ! ${c.file}:${c.line} ${c.resolution}`);
      break;
    }
    case 'export': {
      const r = result as any;
      console.log(`Exported ${r.format} → ${r.outputDir} (${r.filesExported} files)`);
      break;
    }
    default: {
      console.log(JSON.stringify(result, null, 2));
    }
  }
}

function printCheckHuman(r: CheckResult): void {
  const byCategory = new Map<string, Issue[]>();
  for (const i of r.issues) {
    const list = byCategory.get(i.category) ?? [];
    list.push(i);
    byCategory.set(i.category, list);
  }
  console.log('Structure');
  console.log(`  ${r.files} files, ${r.nodes} nodes, max depth ${r.maxDepth}`);
  printIssues(byCategory.get('structure'));

  console.log('Style');
  printIssues(byCategory.get('style'));

  console.log('References');
  console.log(`  ${r.refs.total} see: refs, ${r.refs.broken} broken, ${r.refs.deepHops} deep hops`);
  console.log(`  back-pointers: ${r.backPointers.current}/${r.backPointers.total} current`);
  printIssues(byCategory.get('refs'));

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

  void CATEGORY_ORDER;
  console.log('');
  console.log(`${r.errorCount} errors, ${r.warningCount} warnings.`);
}

function printIssues(issues: Issue[] | undefined): void {
  for (const i of issues ?? []) {
    const mark = i.level === 'error' ? '✗' : '⚠';
    console.log(`  ${mark} ${i.file}:${i.line} — ${i.message}`);
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
  budget read <concept> [--limit <tokens>] [--json]
  budget write <concept> [--json]
  import <format> <path> [--out <path>] [--dry-run] [--merge-strategy <s>]
  export <format> [--from <path>] [--vault <path>] [--dry-run]
  help

Formats: opml, dynalist, logseq, obsidian
Config:  cans/_rules.yaml
Agents:  cans/AGENTS.md`);
}
