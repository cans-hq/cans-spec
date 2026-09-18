import type {
  CommandResult, CheckResult, InitResult, NewResult, DoneResult, StatusResult,
  BudgetReadResult, BudgetWriteResult, ImportResult, ExportResult, VersionResult,
} from '../types.ts';
import {
  buildReport, topGroups, checkReportJson,
  type IssueGroup, type SectionReport,
} from './report.ts';

/** Single emission point. Commands never console.log or process.exit directly.
 *  `refsOnly` (check only): human output is scoped to the REFS section (+ Rules).
 *  `show` (check only, issue #41): sections rendered UNFOLDED by --show.
 *  --json: check emits the lossless structured wire shape (sections → arrays
 *  of {file, line, rule, detail}, issue #41); other commands the raw result. */
export function emit(result: CommandResult, json: boolean, refsOnly?: boolean, show?: Set<string>): void {
  if (json) {
    const body = result.command === 'check' ? checkReportJson(result as unknown as Parameters<typeof checkReportJson>[0]) : result;
    console.log(JSON.stringify(body, null, 2));
    return;
  }
  printHuman(result, refsOnly, show);
}

export function printHuman(result: CommandResult, refsOnly?: boolean, show?: Set<string>): void {
  switch (result.command) {
    case 'check':
      printCheckHuman(result as CheckResult, refsOnly, show);
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

// ── issue #41: aggregated check report ──
// One line per pattern (`61× <min children (2/3)`), grouped by root cause,
// top-N + fold with --show expansion, timing on the summary line, and a
// ≤500-token default budget for issue-scale projects.

const DISPLAY_NAMES: Record<string, string> = {
  structure: 'STRUCTURE', style: 'STYLE', refs: 'REFS', redundancy: 'REDUNDANCY',
  overflow: 'OVERFLOW', parse: 'PARSE', content: 'CONTENT', io: 'IO', other: 'OTHER',
};
const SECTION_PRINT_ORDER = ['structure', 'style', 'refs', 'redundancy', 'overflow', 'parse', 'content', 'io', 'other'];
const FOLD_TOP_GROUPS = 5;
const FOLD_KEYWORD_ITEMS = 5;
const FOLD_OVERLAP_ITEMS = 3;
const FOLD_TARGETS = 8;
const WRAP_COLS = 72;

function printCheckHuman(r: CheckResult, refsOnly?: boolean, show?: Set<string>): void {
  // §37: check-level failures (unknown flag, no cans workspace, invalid
  // _rules.yaml, unmatched file filter) carry their diagnosis in `error` —
  // print it standalone, never inside a report-shaped body.
  const failure = (r as { error?: string }).error;
  if (failure) {
    console.log(`✗ ${failure}`);
    return;
  }

  const expanded = (name: string): boolean => show !== undefined && (show.has('all') || show.has(name));

  // issue #41: summary line first — severity mark, workspace shape, elapsed ms.
  const mark = r.errorCount > 0 ? '✗' : r.warningCount > 0 ? '⚠' : '✓';
  console.log(`${mark} ${r.files} files · ${r.nodes} nodes · depth ${r.maxDepth} · ${r.elapsedMs ?? 0}ms`);

  const report = buildReport(r.issues);
  for (const name of SECTION_PRINT_ORDER) {
    if (refsOnly && name !== 'refs') continue;
    const section = report.sections[name];
    // Compact contract: STRUCTURE/STYLE/REDUNDANCY (and the small sections)
    // print only when they carry findings; REFS and OVERFLOW always print
    // (they carry the ✓ healthy state, as in the issue's expected output).
    if (section === undefined) {
      if (name === 'overflow' && !refsOnly) {
        console.log('');
        console.log('OVERFLOW  ✓');
      }
      continue;
    }
    console.log('');
    if (name === 'refs') printRefsSection(r, section, expanded('refs'));
    else printSection(section, expanded(name));
  }

  if (r.rulesSummary !== undefined) {
    console.log('');
    console.log(`RULES  ✓ ${compactRules(r.rulesSummary)}`);
  }
}

function printSection(section: SectionReport, expanded: boolean): void {
  const mark = section.errorCount > 0 ? '✗' : '⚠';
  console.log(`${DISPLAY_NAMES[section.name] ?? section.name.toUpperCase()}  ${mark} ${section.errorCount + section.warningCount}`);
  const { shown, folded } = expanded ? { shown: section.groups, folded: 0 } : topGroups(section, FOLD_TOP_GROUPS);
  for (const g of shown) printGroup(g, expanded);
  if (folded > 0) console.log(`   … ${folded} more → cans check --show ${section.name}`);
}

function printRefsSection(r: CheckResult, section: SectionReport, expanded: boolean): void {
  // Header: per-root-cause counts (issue #41 example: `REFS  ✗ 96 broken · ⚠ 8 stale · ⚠ 1 orphan`).
  // Level-aware: named buckets subtract from the section totals, the residue
  // prints as `✗ N` / `⚠ N` — no finding is ever hidden or double-counted.
  const byRule = new Map<string, { err: number; warn: number }>();
  for (const g of section.groups) {
    const cur = byRule.get(g.rule) ?? { err: 0, warn: 0 };
    if (g.level === 'error') cur.err += g.count;
    else cur.warn += g.count;
    byRule.set(g.rule, cur);
  }
  const named = ['refs.broken.file', 'refs.backpointer.stale', 'refs.orphan', 'refs.deep_hop'];
  const namedErr = named.reduce((a, rl) => a + (byRule.get(rl)?.err ?? 0), 0);
  const namedWarn = named.reduce((a, rl) => a + (byRule.get(rl)?.warn ?? 0), 0);
  const parts: string[] = [];
  const broken = byRule.get('refs.broken.file');
  if (broken !== undefined && broken.err + broken.warn > 0) parts.push(`✗ ${broken.err + broken.warn} broken`);
  const stale = byRule.get('refs.backpointer.stale');
  if (stale !== undefined && stale.err + stale.warn > 0) parts.push(`⚠ ${stale.err + stale.warn} stale`);
  const orphan = byRule.get('refs.orphan');
  if (orphan !== undefined && orphan.err + orphan.warn > 0) parts.push(`⚠ ${orphan.err + orphan.warn} orphan`);
  const hops = byRule.get('refs.deep_hop');
  if (hops !== undefined && hops.err > 0) parts.push(`✗ ${hops.err} deep-hop`);
  else if (hops !== undefined && hops.warn > 0) parts.push(`⚠ ${hops.warn} deep-hop`);
  const errOther = section.errorCount - namedErr;
  const warnOther = section.warningCount - namedWarn;
  if (errOther > 0) parts.push(`✗ ${errOther}`);
  if (warnOther > 0) parts.push(`⚠ ${warnOther}`);
  if (parts.length > 0) {
    console.log(`REFS  ${parts.join(' · ')}`);
  } else {
    const bp = r.backPointers.total > 0 ? ` · ${r.backPointers.current}/${r.backPointers.total} back-ptrs` : '';
    console.log(`REFS  ✓ ${r.refs.total} refs${bp}`);
  }

  // issue #41 design rule 2: all missing-file refs coalesce into ONE block
  // (91 broken refs → 4 targets with per-target counts, one fix hint).
  const brokenGroups = section.groups.filter(g => g.rule === 'refs.broken.file');
  const rest = section.groups.filter(g => g.rule !== 'refs.broken.file');
  if (brokenGroups.length > 0) printBrokenFileBlock(brokenGroups);
  const { shown, folded } = expanded ? { shown: rest, folded: 0 } : topGroups({ ...section, groups: rest }, FOLD_TOP_GROUPS);
  for (const g of shown) printGroup(g, expanded);
  if (folded > 0) console.log(`   … ${folded} more → cans check --show refs`);
}

function printBrokenFileBlock(groups: IssueGroup[]): void {
  const total = groups.reduce((a, g) => a + g.count, 0);
  console.log(`  ${String(total).padStart(2)}× missing file`);
  const targets = groups
    .filter(g => g.key !== undefined)
    .map(g => ({ label: g.key!, count: g.count }))
    .sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : 1));
  const shown = targets.slice(0, FOLD_TARGETS);
  for (const line of wrapText(shown.map(t => `${t.label} (${t.count})`).join(' · '), WRAP_COLS, 6)) console.log(line);
  if (targets.length > shown.length) console.log(`      ↳ ${targets.length - shown.length} more targets → cans check --show refs`);
  const hint = groups.map(g => g.suggestion).find(s => s !== undefined);
  if (hint !== undefined) console.log(`      ↳ ${hint}`);
}

function printGroup(g: IssueGroup, expanded: boolean): void {
  console.log(`  ${String(g.count).padStart(2)}× ${g.pattern}`);
  switch (g.rule) {
    case 'redundancy.keyword': {
      const items = g.items ?? [];
      const shownItems = expanded ? items : items.slice(0, FOLD_KEYWORD_ITEMS);
      // issue #41: `artifacts:105  db:74` — keyword:nodeCount, metric-ranked.
      for (const line of wrapText(shownItems.map(it => `${it.label}:${it.metric ?? it.count}`).join('  '), WRAP_COLS, 6)) console.log(line);
      const hidden = items.slice(FOLD_KEYWORD_ITEMS).reduce((a, it) => a + it.count, 0);
      if (!expanded && hidden > 0) console.log(`      ↳ ${hidden} more → cans check --show redundancy`);
      else if (g.suggestion !== undefined) console.log(`      ↳ ${g.suggestion}`);
      return;
    }
    case 'redundancy.overlap.exact':
    case 'redundancy.overlap.fuzzy': {
      const items = g.items ?? [];
      const shownItems = expanded ? items : items.slice(0, FOLD_OVERLAP_ITEMS);
      if (shownItems.length > 0) {
        for (const line of wrapText(`worst: ${shownItems.map(it => it.label).join(' · ')}`, WRAP_COLS, 6)) console.log(line);
      }
      const hidden = items.length - shownItems.length;
      if (!expanded && hidden > 0) console.log(`      ↳ ${hidden} more pairs → cans check --show redundancy`);
      else if (g.suggestion !== undefined) console.log(`      ↳ ${g.suggestion}`);
      return;
    }
    case 'refs.backpointer.stale': {
      // `budget:2  ← agent, effect, interface` — target lines + referrers.
      const referrers = (g.items ?? []).map(it => it.label).join(', ');
      const line = referrers !== '' ? `${g.locations.join(' ')}  ← ${referrers}` : g.locations.join(' ');
      for (const l of wrapText(line, WRAP_COLS, 6)) console.log(l);
      break;
    }
    case 'refs.broken.anchor': {
      const details = (expanded ? (g.items ?? []).map(it => it.label) : (g.detail !== undefined ? [g.detail] : (g.items ?? []).slice(0, FOLD_OVERLAP_ITEMS).map(it => it.label)));
      for (const d of details) console.log(`      ${d}`);
      break;
    }
    default: {
      for (const line of wrapText(g.locations.join('  '), WRAP_COLS, 6)) console.log(line);
    }
  }
  if (g.suggestion !== undefined) console.log(`      ↳ ${g.suggestion}`);
}

/** Greedy two-space-separator wrap (location lists), fixed indent. */
function wrapText(text: string, cols: number, indent: number): string[] {
  const pad = ' '.repeat(indent);
  const budget = Math.max(cols - indent, 20);
  if (text.length <= budget) return text === '' ? [] : [pad + text];
  const pieces = text.split('  ');
  const lines: string[] = [];
  let cur = '';
  for (const p of pieces) {
    const candidate = cur === '' ? p : `${cur}  ${p}`;
    if (cur === '' || candidate.length <= budget) cur = candidate;
    else {
      lines.push(pad + cur);
      cur = p;
    }
  }
  if (cur !== '') lines.push(pad + cur);
  return lines;
}

/** `node_length: 3–120 | siblings: 3–12 | depth: 5–7` → `len 3–120 · sib 3–12 · depth 5–7`. */
function compactRules(s: string): string {
  return s
    .replace('node_length: ', 'len ')
    .replaceAll('siblings: ', 'sib ')
    .replace('depth: ', 'depth ')
    .replaceAll(' | ', ' · ');
}

function printHelp(): void {
  console.log(`CANS — Canonical Agent-Native Spec

Usage: cans <command> [args]

Commands:
  init [--flat|--folders] [--bare] [--force] [--tool <name>]
  check [--fix] [--strict] [--refs-only] [--no-redundancy] [--show <section>] [file] [--json]
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
