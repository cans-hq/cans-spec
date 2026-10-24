import type {
  CommandResult, CheckResult, InitResult, NewResult, DoneResult, StatusResult,
  BudgetReadResult, BudgetWriteResult, ImportResult, ExportResult, SlugResult, VersionResult,
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
    case 'slug': {
      const r = result as SlugResult;
      if (r.ok) {
        // BARE fragment on its own stdout line — shell-composable, so
        // `see: file.md#$(cans slug "...")` works verbatim. No decoration,
        // no trailing prose: anything but the fragment would corrupt the
        // composition (issue #53 Part 1.2).
        console.log(r.slug);
      } else {
        console.log(`✗ ${r.error ?? 'failed to slug'}`);
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
  config: 'CONFIG', parse: 'PARSE', content: 'CONTENT', io: 'IO', other: 'OTHER',
};
// 'config' (issue #43) sits after the engines, mirroring report.ts's
// SECTION_ORDER. It never renders in practice: a config failure carries the
// §37 top-level `error` field, and printCheckHuman prints that standalone
// and returns BEFORE any section — the invalid-rules diagnosis can never
// leak into a bogus report body. Listed for coherence only.
const SECTION_PRINT_ORDER = ['structure', 'style', 'refs', 'redundancy', 'config', 'parse', 'content', 'io', 'other'];
const FOLD_TOP_GROUPS = 5;
const FOLD_KEYWORD_ITEMS = 5;
const FOLD_OVERLAP_ITEMS = 3;
const FOLD_TARGETS = 8;
// Issue #53 Part 1.5: slug-hint items shown in the folded view. Emission
// caps at 5 notes per file + 1 summary line (check.ts SLUG_HINT_CAP), so 6
// keeps a single-file hint group fully visible; only MULTI-file hint groups
// fold — same compact budget as keywords.
const FOLD_HINT_ITEMS = 6;
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
  // Issue #53 Part 1.5: info notes NEVER change this mark — a clean workspace
  // with hints still reads ✓ (hints are advice, not findings).
  const mark = r.errorCount > 0 ? '✗' : r.warningCount > 0 ? '⚠' : '✓';
  console.log(`${mark} ${r.files} files · ${r.nodes} nodes · depth ${r.maxDepth} · ${r.elapsedMs ?? 0}ms`);

  const report = buildReport(r.issues);
  for (const name of SECTION_PRINT_ORDER) {
    if (refsOnly && name !== 'refs') continue;
    let section = report.sections[name];
    // issue #11: a --fix run that rewrote back-pointer files always surfaces
    // the REFS block — even when the refs engine has no findings of its own
    // (the clean/healthy case), the run's writes stay visible there.
    // issue #53 (Part 2.4): a --fix run that proposes or applies anchor
    // repairs surfaces it for the same reason — the transaction report lives
    // under REFS and must never be silently swallowed by a clean refs state.
    const hasFixReport = r.backPointersUpdatedFiles.length > 0 || (r.anchorFixes ?? []).length > 0;
    if (name === 'refs' && section === undefined && hasFixReport) {
      section = { name: 'refs', errorCount: 0, warningCount: 0, infoCount: 0, groups: [] };
    }
    // Compact contract: STRUCTURE/STYLE/REDUNDANCY (and the small sections)
    // print only when they carry findings; REFS always prints (it carries the
    // ✓ healthy state, as in the issue's expected output). Issue #56: the
    // OVERFLOW block is gone with the §16 engine.
    if (section === undefined) {
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
  // Issue #53 Part 1.5: info notes never change a section's mark — errors
  // still print ✗, warnings ⚠, and a section carrying ONLY hints prints ℹ
  // with the hint count (never a fake ⚠ over a zero finding count).
  const findings = section.errorCount + section.warningCount;
  const infoPart = section.infoCount > 0 ? ` · ℹ ${section.infoCount}` : '';
  if (findings > 0) {
    const mark = section.errorCount > 0 ? '✗' : '⚠';
    console.log(`${DISPLAY_NAMES[section.name] ?? section.name.toUpperCase()}  ${mark} ${findings}${infoPart}`);
  } else {
    console.log(`${DISPLAY_NAMES[section.name] ?? section.name.toUpperCase()}  ℹ ${section.infoCount}`);
  }
  const { shown, folded } = expanded ? { shown: section.groups, folded: 0 } : topGroups(section, FOLD_TOP_GROUPS);
  for (const g of shown) printGroup(g, expanded);
  if (folded > 0) console.log(`   … ${folded} more → cans check --show ${section.name}`);
}

function printRefsSection(r: CheckResult, section: SectionReport, expanded: boolean): void {
  // Header: per-root-cause counts (issue #41 example: `REFS  ✗ 96 broken · ⚠ 8 stale · ⚠ 1 orphan`).
  // Level-aware: named buckets subtract from the section totals, the residue
  // prints as `✗ N` / `⚠ N` — no finding is ever hidden or double-counted.
  //
  // Issue #52: the `✗ N broken` part derives from `r.refs.broken` — the EXACT
  // counter `cans check --json` emits (refs.broken.file + refs.broken.anchor
  // errors, check.ts) — so the text header and the JSON counter share one
  // source of truth and can never disagree. The old byRule sum counted
  // refs.broken.file groups only, leaving broken ANCHORS in the anonymous
  // residue (reporter's tree: `✗ 1 broken · ⚠ 54 stale · ✗ 115` beside json
  // refs.broken: 113 = 112 anchors + 1 file). refs.broken.anchor joins
  // `named` so its groups subtract from the residue — they are displayed
  // inside the broken count, never double-counted — and since both broken
  // rules are only ever emitted at error level (refs.ts), the displayed
  // counts still sum to errorCount + warningCount exactly.
  const byRule = new Map<string, { err: number; warn: number; info: number }>();
  for (const g of section.groups) {
    const cur = byRule.get(g.rule) ?? { err: 0, warn: 0, info: 0 };
    // Issue #53 Part 1.5: three-way classification (not error/else) — an
    // info group must never inflate the warning side of the residue math.
    if (g.level === 'error') cur.err += g.count;
    else if (g.level === 'warning') cur.warn += g.count;
    else cur.info += g.count;
    byRule.set(g.rule, cur);
  }
  const named = ['refs.broken.file', 'refs.broken.anchor', 'refs.backpointer.stale', 'refs.orphan', 'refs.deep_hop'];
  const namedErr = named.reduce((a, rl) => a + (byRule.get(rl)?.err ?? 0), 0);
  const namedWarn = named.reduce((a, rl) => a + (byRule.get(rl)?.warn ?? 0), 0);
  const parts: string[] = [];
  // Issue #52: the JSON counter, not a byRule sum — see comment above.
  if (r.refs.broken > 0) parts.push(`✗ ${r.refs.broken} broken`);
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
  // Issue #53 Part 1.5: the hint band rides at the END of the header —
  // `· ℹ N notes` — never inside the error/warning parts, and never
  // displacing the healthy `✓` line when notes are the ONLY refs findings:
  // a hint-only REFS block reads `✓ N refs · M/N back-ptrs · ℹ K notes`.
  const infoPart = section.infoCount > 0
    ? `ℹ ${section.infoCount} note${section.infoCount === 1 ? '' : 's'}`
    : '';
  if (parts.length > 0) {
    console.log(`REFS  ${infoPart !== '' ? `${parts.join(' · ')} · ${infoPart}` : parts.join(' · ')}`);
  } else {
    const bp = r.backPointers.total > 0 ? ` · ${r.backPointers.current}/${r.backPointers.total} back-ptrs` : '';
    console.log(`REFS  ✓ ${r.refs.total} refs${bp}${infoPart !== '' ? ` · ${infoPart}` : ''}`);
  }
  // Issue #11: name the files --fix actually rewrote (099e858 wording) —
  // never printed as an empty list (plain checks show nothing here).
  // issue #53 (Part 2.4): under --dry-run the same list is a PREVIEW — the
  // wording says "would rewrite" and no byte changed on disk.
  if (r.backPointersUpdatedFiles.length > 0) {
    console.log(r.dryRun === true
      ? `  --fix would rewrite ref-by in: ${r.backPointersUpdatedFiles.join(', ')}`
      : `  --fix updated ref-by in: ${r.backPointersUpdatedFiles.join(', ')}`);
  }

  // issue #53 (Part 2.4): the anchor-repair transaction lines, compact per
  // the #41 budget. Up to three proposals print individually (the from → to
  // spellings are the actionable payload); four or more fold into one line
  // naming the referrer files and the count. Applied rewrites (--yes) name
  // each referrer with its count, alongside the ref-by line above.
  const proposals = (r.anchorFixes ?? []).filter(f => !f.applied);
  const applied = (r.anchorFixes ?? []).filter(f => f.applied);
  if (proposals.length > 0) {
    if (proposals.length <= 3) {
      for (const f of proposals) {
        console.log(`  --fix would rewrite: ${f.file}:${f.line} #${f.from} → #${f.to}`);
      }
    } else {
      const files = [...new Set(proposals.map(f => f.file))].sort().join(', ');
      console.log(`  --fix would rewrite anchors in: ${files} (${proposals.length}) — run with --yes to apply`);
    }
  }
  if (applied.length > 0) {
    const perFile = new Map<string, number>();
    for (const f of applied) perFile.set(f.file, (perFile.get(f.file) ?? 0) + 1);
    const parts = [...perFile.keys()].sort().map(k => `${k} (${perFile.get(k)})`);
    console.log(`  --fix rewrote anchors in: ${parts.join(', ')}`);
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
  // Issue #53 Part 1.5: info-level groups print with the ℹ mark, so a hint
  // band is never mistaken for a warning finding.
  const lead = g.level === 'info' ? `ℹ ${g.count}×` : `${String(g.count).padStart(2)}×`;
  console.log(`  ${lead} ${g.pattern}`);
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
      // Issue #53 Part 1.3: each member's own did-you-mean (or add-node
      // advice) must reach the reader — the group hint is first-non-empty
      // only, so a multi-anchor group would otherwise hide the other refs'
      // fixes. Expanded view appends the per-item fix to every line; the
      // folded view keeps the single first-member detail (the compact-output
      // budget) with the group hint, which is that same member's fix.
      const items = g.items ?? [];
      const withFix = (it: { label: string; suggestion?: string }): string =>
        it.suggestion !== undefined ? `${it.label} — ${it.suggestion}` : it.label;
      const details = expanded
        ? items.map(withFix)
        : (g.detail !== undefined ? [g.detail] : items.slice(0, FOLD_OVERLAP_ITEMS).map(withFix));
      for (const d of details) console.log(`      ${d}`);
      break;
    }
    case 'refs.slug.hint': {
      // Issue #53 Part 1.5: the items ARE the value — self-contained
      // `file:line — "text" → #slug` pairs naming each node's canonical
      // anchor (emission caps at 5 per file + a summary; the fold keeps the
      // same compact budget for multi-file groups).
      const items = g.items ?? [];
      const shownItems = expanded ? items : items.slice(0, FOLD_HINT_ITEMS);
      for (const line of wrapText(shownItems.map(it => it.label).join('  '), WRAP_COLS, 6)) console.log(line);
      const hidden = items.slice(shownItems.length).reduce((a, it) => a + it.count, 0);
      if (!expanded && hidden > 0) console.log(`      ↳ ${hidden} more → cans check --show refs`);
      else if (g.suggestion !== undefined) console.log(`      ↳ ${g.suggestion}`);
      return;
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
  check [--fix] [--yes] [--dry-run] [--strict] [--refs-only] [--no-redundancy] [--show <section>] [--hints] [file] [--json]
        --fix + [file] rewrites ref-by comments in matching files only
        --fix proposes broken-anchor repairs; --yes applies, --dry-run previews
        --hints shows slug-hint info notes (opt-in; off by default — also
        enabled per-workspace by output.slug_hints in cans/_rules.yaml)
  new adr <title>
  new task <name>
  done <name> [--allow-incomplete] [--skip-check] [--json]
  status [--unclaimed] [--blocked] [--owners] [--json]
  budget read <concept> [--limit <tokens>] [--change <name>] [--json]
  budget write <concept> [--json]
  import <format> <path> [--out <path>] [--dry-run] [--merge-strategy <s>] [--json]
  export <format> [--from <path>] [--include-tasks] [--vault <path>] [--dry-run] [--json]
  slug "<node text>" | <file>:<line> [--json]
  help
  version

Formats: opml, dynalist, logseq, obsidian
Config:  cans/_rules.yaml
Agents:  cans/AGENTS.md`);
}
