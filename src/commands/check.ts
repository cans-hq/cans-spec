import { join } from 'path';
import type { CheckResult, Issue, OutlineNode } from '../types';
import {
  discoverSpecFiles, discoverActiveTasks, discoverAdrs, resolveWorkspaceRoot,
  dirExists, detectFlatFolderConflicts, detectMalformedSpecDirs, discoverOverflowTargets,
} from '../core/fs';
import {
  parseOutline, extractBackPointers, flattenNodes, maxDepth as outlineMaxDepth,
  type ParseWarning,
} from '../core/outline';
import { loadRules } from '../core/rules';
import { checkStructure, checkTbdPolicy } from '../core/structure';
import { checkStyle } from '../core/style';
import { checkOverflow, checkNoChaining } from '../core/overflow';
import { checkRedundancy } from '../core/redundancy';
import {
  buildRefGraph, checkRefs, detectDeepHops, detectOrphans,
  rebuildBackPointers, targetMatchesKey,
} from '../core/refs';
import { parseArgs, formatArgErrors, type FlagSpec } from '../core/args';

export interface CheckArgs {
  fix: boolean;
  strict: boolean;
  refsOnly: boolean;
  noRedundancy: boolean;
  file: string | null;
  json: boolean;
  /** §24 (done): the archiving task's parsed nodes, injected under their
   *  former `_tasks/<name>.md` identity so refs held by the archived task
   *  still count for the back-pointer rebuild. Never set by `check` itself. */
  extraReferrer?: { key: string; nodes: OutlineNode[] } | null;
}

const CHECK_FLAGS: FlagSpec[] = [
  { name: 'fix', boolean: true },
  { name: 'strict', boolean: true },
  { name: 'refs-only', boolean: true },
  { name: 'no-redundancy', boolean: true },
  { name: 'json', boolean: true },
];

const REF_BY_RE = /<!--\s*ref-by:\s*(.*?)\s*-->/;

// globFiles throws ENOENT on missing dirs — guard the optional ones.
function safeActiveTasks(root: string): string[] {
  return dirExists(join(root, '_tasks')) ? discoverActiveTasks(root) : [];
}

function safeAdrs(root: string): string[] {
  return dirExists(join(root, '_adr')) ? discoverAdrs(root) : [];
}

/** §20: route check's args through the shared parser — `--flag value` only,
 *  `[file]` is the sole positional. Unknown flags, short flags, `--flag=value`
 *  and extra positionals are user errors, never silently ignored. */
export function parseCheckArgs(args: string[]): CheckArgs & { errors: string[] } {
  const parsed = parseArgs(args, CHECK_FLAGS);
  const errors = [...parsed.errors];
  const positional = parsed.positional;
  const file = positional.length > 0 ? positional[0]! : null;
  if (positional.length > 1) {
    errors.push(`unexpected argument "${positional[1]}" — check takes a single optional [file]`);
  }
  return {
    fix: parsed.flags.has('fix'),
    strict: parsed.flags.has('strict'),
    refsOnly: parsed.flags.has('refs-only'),
    noRedundancy: parsed.flags.has('no-redundancy'),
    json: parsed.flags.has('json'),
    file,
    errors,
  };
}

function zeroedCounts(): Omit<CheckResult, 'ok' | 'command' | 'exitCode'> {
  return {
    files: 0,
    nodes: 0,
    maxDepth: 0,
    refs: { total: 0, broken: 0, deepHops: 0 },
    backPointers: { total: 0, current: 0, stale: 0 },
    issues: [],
    errorCount: 0,
    warningCount: 0,
    backPointersUpdated: 0,
  };
}

/** §37: check-level failure (no workspace, invalid rules, unknown flag, file
 *  filter matched nothing). The diagnosis rides in `error` so the human printer
 *  can show it standalone — never inside a report-shaped body. */
function checkFail(message: string): CheckResult & { error: string } {
  return {
    ok: false,
    command: 'check',
    exitCode: 1,
    ...zeroedCounts(),
    issues: [{ file: '', line: 0, level: 'error', category: 'refs', message }],
    errorCount: 1,
    error: message,
  };
}

/** Does raw ref target `name` point at workspace key `key`? (flat + folder layouts) */
function refTargetKey(name: string, keys: Iterable<string>): string | null {
  for (const key of keys) {
    if (targetMatchesKey(name, key)) return key;
  }
  return null;
}

/** Rewrite `<!-- ref-by: ... -->` comments in one spec file source.
 *  Replaces the first existing comment's content, drops duplicates/stale ones,
 *  or inserts a fresh comment line right after the first root bullet. */
function rewriteRefBy(source: string, body: string | null): string {
  const lines: Array<string | null> = source.split('\n');
  const comment = body !== null && body !== '' ? `<!-- ref-by: ${body} -->` : null;
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== null && REF_BY_RE.test(lines[i]!)) hits.push(i);
  }
  if (hits.length > 0) {
    for (let j = 0; j < hits.length; j++) {
      const i = hits[j];
      const raw = lines[i]!;
      if (j === 0 && comment !== null) {
        lines[i] = raw.replace(REF_BY_RE, comment);
      } else {
        const isBullet = /^\s*-\s/.test(raw);
        lines[i] = isBullet ? raw.replace(REF_BY_RE, '').replace(/[ \t]+$/, '') : null;
      }
    }
  } else if (comment !== null) {
    let insertAt = lines.length;
    for (let i = 0; i < lines.length; i++) {
      if (/^- /.test(lines[i]!)) {
        insertAt = i + 1;
        break;
      }
    }
    lines.splice(insertAt, 0, comment);
  }
  return lines.filter((l): l is string => l !== null).join('\n');
}

/** The shared engine orchestrator used by `cans check` and `cans done`. */
export async function checkWorkspace(root: string, opts: CheckArgs): Promise<CheckResult> {
  let rules;
  try {
    rules = loadRules(root);
  } catch (e) {
    return checkFail(`invalid _rules.yaml: ${e instanceof Error ? e.message : String(e)}`);
  }

  const issues: Issue[] = [];

  // §37: malformed workspace entries (directories named like spec files) are
  // reported, never silently skipped.
  for (const name of detectMalformedSpecDirs(root)) {
    issues.push({
      file: name, line: 0, level: 'warning', category: 'structure',
      message: `malformed workspace entry: directory "${name}" looks like a spec file — rename it or use folder mode (${name.replace(/\.md$/, '')}/index.md)`,
      suggestion: `remove or rename the directory cans/${name}`,
    });
  }

  // §8: "Flat wins over folder. If both exist, `cans check` flags error."
  for (const [flat, folder] of detectFlatFolderConflicts(root)) {
    issues.push({
      file: flat, line: 0, level: 'error', category: 'structure',
      message: `duplicate home: both ${flat} and ${folder} exist — flat wins, remove the folder`,
      suggestion: `delete ${folder} (or merge its content into ${flat})`,
    });
  }

  // Spec files: full checks.
  const specRel = discoverSpecFiles(root);
  const specFiles = new Map<string, OutlineNode[]>();
  const specSources = new Map<string, string>();
  for (const rel of specRel) {
    let text = '';
    try {
      text = await Bun.file(join(root, rel)).text();
    } catch (e) {
      issues.push({
        file: rel, line: 0, level: 'error', category: 'structure',
        message: `unreadable spec file: ${e instanceof Error ? e.message : String(e)}`,
      });
      continue;
    }
    specSources.set(rel, text);
    const fileWarnings: ParseWarning[] = [];
    try {
      specFiles.set(rel, parseOutline(text, rel, fileWarnings));
    } catch (e) {
      issues.push({
        file: rel, line: 0, level: 'error', category: 'structure',
        message: `parse error: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
    // Odd (non-2-multiple) indentation silently re-parents nodes — surface it.
    for (const pw of fileWarnings) {
      issues.push({
        file: rel, line: pw.line, level: 'warning', category: 'structure',
        message: pw.message,
      });
    }
  }

  // Task + ADR sources: parsed for ref extraction only (no structure/style/etc checks).
  const auxFiles = new Map<string, OutlineNode[]>();
  for (const rel of [...safeActiveTasks(root), ...safeAdrs(root)]) {
    try {
      const text = await Bun.file(join(root, rel)).text();
      auxFiles.set(rel, parseOutline(text, rel));
    } catch {
      // unreadable/unparseable aux file: its refs are simply not counted
    }
  }

  const allFiles = new Map<string, OutlineNode[]>([...specFiles, ...auxFiles]);
  // §24 (done): the archiving task has already been renamed into _archive/, so
  // its parsed nodes join the graph here under their former _tasks/ identity —
  // its see: refs still earn their targets' ref-by marks.
  if (opts.extraReferrer !== undefined && opts.extraReferrer !== null) {
    allFiles.set(opts.extraReferrer.key, opts.extraReferrer.nodes);
  }
  const graph = buildRefGraph(allFiles, root);

  // File filter: restrict structure/style/overflow/redundancy to one file (refs stay global).
  const checkable = opts.file !== null
    ? [...specFiles.keys()].filter(k => targetMatchesKey(opts.file!, k))
    : [...specFiles.keys()];
  // §37: a file filter that matches nothing is a user-correctable mistake —
  // never a silently-empty clean check (missing Part-4 item, QA-02 F13).
  if (opts.file !== null && checkable.length === 0) {
    return checkFail(
      `no spec file matches "${opts.file}" — pass a spec filename like 04-api.md or run \`cans status\` to list files`,
    );
  }
  const checkableMap = new Map<string, OutlineNode[]>(
    checkable.map(k => [k, specFiles.get(k)!]),
  );

  const deepHops = detectDeepHops(graph, rules.references.max_hops);

  if (!opts.refsOnly) {
    for (const key of checkable) {
      issues.push(...checkStructure(specFiles.get(key)!, key, rules.structure));
    }
    for (const key of checkable) {
      issues.push(...checkStyle(specFiles.get(key)!, key, rules.style));
    }
    // §18 content policy: TBD nodes per file (QA-13 F4 — the knobs were inert).
    for (const key of checkable) {
      issues.push(...checkTbdPolicy(specFiles.get(key)!, key, rules.content));
    }
  }

  issues.push(...checkRefs(allFiles, graph, root));
  issues.push(...deepHops);
  if (rules.references.orphan_check) {
    issues.push(...detectOrphans(specFiles, graph));
  }

  // Back-pointers: ref-by comments in spec sources vs actual incoming refs.
  // §18: `references.back_pointers` false (explicit or deleted key) turns the
  // back-pointer check OFF — no stale warnings, and --fix writes nothing.
  const backPointersOn = rules.references.back_pointers;
  let bpTotal = 0;
  let bpCurrent = 0;
  let bpStale = 0;
  if (backPointersOn) {
    for (const [rel, source] of specSources) {
      for (const bp of extractBackPointers(source, rel)) {
        bpTotal++;
        const fromKey = refTargetKey(bp.fromFile, allFiles.keys());
        const fromRefs = fromKey !== null ? graph.forward.get(fromKey) : undefined;
        const isCurrent =
          fromKey !== null &&
          fromRefs !== undefined &&
          fromRefs.some(t => refTargetKey(t.file, allFiles.keys()) === rel);
        if (isCurrent) {
          bpCurrent++;
        } else {
          bpStale++;
          issues.push({
            file: rel, line: bp.fromLine, level: 'warning', category: 'refs',
            message: `stale back-pointer: ${bp.fromFile} no longer refs ${rel}`,
            suggestion: 'remove the ref-by comment (or re-run cans check --fix)',
          });
        }
      }
    }
  }

  if (!opts.refsOnly) {
    if (!opts.noRedundancy && rules.redundancy.enabled) {
      issues.push(...checkRedundancy(checkableMap, rules.redundancy, rules.references.duplicate_home_check));
    }
    for (const key of checkable) {
      issues.push(...checkOverflow(specFiles.get(key)!, key, rules.overflow));
    }

    // §16 no-chaining: overflow target files (spec subfolder content) must not
    // contain their own see: refs.
    const targetFiles = new Map<string, OutlineNode[]>();
    for (const rel of discoverOverflowTargets(root)) {
      try {
        targetFiles.set(rel, parseOutline(await Bun.file(join(root, rel)).text(), rel));
      } catch {
        // unreadable overflow target: skipped
      }
    }
    issues.push(...checkNoChaining(targetFiles));
  }

  // --fix: rewrite ref-by comments ONLY, in spec files ONLY.
  // §18/§17: with the back-pointer check off (back_pointers false or deleted),
  // --fix must not write anything — backPointersUpdated stays 0, no file touched.
  let backPointersUpdated = 0;
  if (opts.fix && backPointersOn) {
    const desired = rebuildBackPointers(allFiles, graph);
    for (const [rel, source] of specSources) {
      const body = desired.get(rel) ?? null;
      const rewritten = rewriteRefBy(source, body);
      if (rewritten !== source) {
        await Bun.write(join(root, rel), rewritten);
        specSources.set(rel, rewritten);
        backPointersUpdated++;
      }
    }

    // §35 check-fix.json reports the POST-fix state: recompute back-pointer
    // counts from the rewritten sources and drop now-fixed stale issues.
    bpTotal = 0;
    bpCurrent = 0;
    bpStale = 0;
    for (const [rel, source] of specSources) {
      for (const bp of extractBackPointers(source, rel)) {
        bpTotal++;
        const fromKey = refTargetKey(bp.fromFile, allFiles.keys());
        const fromRefs = fromKey !== null ? graph.forward.get(fromKey) : undefined;
        const isCurrent =
          fromKey !== null &&
          fromRefs !== undefined &&
          fromRefs.some(t => refTargetKey(t.file, allFiles.keys()) === rel);
        if (isCurrent) {
          bpCurrent++;
        } else {
          bpStale++;
        }
      }
    }
    for (let i = issues.length - 1; i >= 0; i--) {
      if (issues[i]!.category === 'refs' && issues[i]!.message.startsWith('stale back-pointer:')) {
        issues.splice(i, 1);
      }
    }
  }

  let nodeCount = 0;
  let depthMax = 0;
  for (const nodes of specFiles.values()) {
    nodeCount += flattenNodes(nodes).length;
    depthMax = Math.max(depthMax, outlineMaxDepth(nodes));
  }
  const refsTotal = [...graph.forward.values()].reduce((a, ts) => a + ts.length, 0);
  const broken = issues.filter(
    i => i.category === 'refs' && i.level === 'error' && i.message.startsWith('broken ref:'),
  ).length;

  const errorCount = issues.filter(i => i.level === 'error').length;
  const warningCount = issues.filter(i => i.level === 'warning').length;
  const ok = errorCount === 0 && (!opts.strict || warningCount === 0);

  return {
    ok,
    command: 'check',
    exitCode: ok ? 0 : 1,
    files: specFiles.size,
    nodes: nodeCount,
    // §35: maxDepth is 1-based (a 4-level chain reports 4); 0 for an empty workspace.
    maxDepth: nodeCount === 0 ? 0 : depthMax + 1,
    refs: { total: refsTotal, broken, deepHops: deepHops.length },
    backPointers: { total: bpTotal, current: bpCurrent, stale: bpStale },
    issues,
    errorCount,
    warningCount,
    backPointersUpdated,
    // §22: fixed report order ends with a Rules section before the summary (QA-02 F17).
    // §18 delete-key semantics: a deleted range key shows as "off", never a raw null.
    rulesSummary:
      `node_length: ${fmtRange(rules.structure.node_length)}` +
      ` | siblings: ${fmtRange(rules.structure.siblings)}` +
      ` | depth: ${fmtRange(rules.structure.depth)}`,
  };
}

/** "3–120" for an active range; "off" when §18 delete-key semantics nulled it. */
function fmtRange(r: { min: number | null; max: number | null }): string {
  if (r.min === null || r.max === null) return 'off';
  return `${r.min}\u2013${r.max}`;
}

export async function run(args: string[]): Promise<CheckResult> {
  // §20/§36: --help/-h show help — they never execute the check.
  if (args.includes('--help') || args.includes('-h')) {
    const help = { ok: true, command: 'help', exitCode: 0 };
    return help as CheckResult;
  }
  const opts = parseCheckArgs(args);

  // §20/§37: unknown flags, short flags, --flag=value, extra positionals —
  // surface the real problem and never run a check on malformed args.
  if (opts.errors.length > 0) {
    return checkFail(formatArgErrors(opts.errors, 'check'));
  }

  const root = resolveWorkspaceRoot();
  if (root === null) {
    return checkFail('no cans workspace found — run `cans init` or cd into a project with a cans/ directory');
  }
  return checkWorkspace(root, opts);
}
