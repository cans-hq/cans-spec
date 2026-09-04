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
import { checkStructure } from '../core/structure';
import { checkStyle } from '../core/style';
import { checkOverflow, checkNoChaining } from '../core/overflow';
import { checkRedundancy } from '../core/redundancy';
import {
  buildRefGraph, checkRefs, detectDeepHops, detectOrphans,
  rebuildBackPointers, targetMatchesKey,
} from '../core/refs';

export interface CheckArgs {
  fix: boolean;
  strict: boolean;
  refsOnly: boolean;
  noRedundancy: boolean;
  file: string | null;
  json: boolean;
}

const REF_BY_RE = /<!--\s*ref-by:\s*(.*?)\s*-->/;

// globFiles throws ENOENT on missing dirs — guard the optional ones.
function safeActiveTasks(root: string): string[] {
  return dirExists(join(root, '_tasks')) ? discoverActiveTasks(root) : [];
}

function safeAdrs(root: string): string[] {
  return dirExists(join(root, '_adr')) ? discoverAdrs(root) : [];
}

export function parseCheckArgs(args: string[]): CheckArgs {
  let fix = false;
  let strict = false;
  let refsOnly = false;
  let noRedundancy = false;
  let json = false;
  let file: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--fix') fix = true;
    else if (a === '--strict') strict = true;
    else if (a === '--refs-only') refsOnly = true;
    else if (a === '--no-redundancy') noRedundancy = true;
    else if (a === '--json') json = true;
    else if (a === '--file') file = args[i + 1] ?? null;
    else if (!a.startsWith('--')) file = a; // single optional positional = file filter
  }
  return { fix, strict, refsOnly, noRedundancy, file, json };
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

function checkFail(message: string): CheckResult {
  return {
    ok: false,
    command: 'check',
    exitCode: 1,
    ...zeroedCounts(),
    issues: [{ file: '', line: 0, level: 'error', category: 'refs', message }],
    errorCount: 1,
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
  const graph = buildRefGraph(allFiles, root);

  // File filter: restrict structure/style/overflow/redundancy to one file (refs stay global).
  const checkable = opts.file !== null
    ? [...specFiles.keys()].filter(k => targetMatchesKey(opts.file!, k))
    : [...specFiles.keys()];
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
  }

  issues.push(...checkRefs(allFiles, graph, root));
  issues.push(...deepHops);
  if (rules.references.orphan_check) {
    issues.push(...detectOrphans(specFiles, graph));
  }

  // Back-pointers: ref-by comments in spec sources vs actual incoming refs.
  let bpTotal = 0;
  let bpCurrent = 0;
  let bpStale = 0;
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
  let backPointersUpdated = 0;
  if (opts.fix) {
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
  };
}

export async function run(args: string[]): Promise<CheckResult> {
  const opts = parseCheckArgs(args);
  const root = resolveWorkspaceRoot();
  if (root === null) {
    return checkFail('no cans workspace found — run `cans init` or cd into a project with a cans/ directory');
  }
  return checkWorkspace(root, opts);
}
