/** `cans alias expand|collapse` — the programmatic switch between full-pointer
 *  form and aliased form (issue #57).
 *
 *  WHY this command exists: migrating a corpus by hand is error-prone, and
 *  turning aliasing off later would otherwise strand aliased files. The
 *  transforms live in core/alias.ts (expandAliases / collapseAliases); this
 *  file orchestrates: resolve the workspace, load the rules (collapse
 *  follows references.aliasing — style, min_uses — and REFUSES to collapse
 *  under a disabled config, since it would mint files the checker rejects),
 *  discover the file set, transform, write.
 *
 *  Contract (issue #57):
 *  - Lossless for non-pointer text: only see: targets and alias definitions
 *    change; prose, labels, node order and structure are untouched.
 *  - Idempotent: expanding an expanded file / collapsing a collapsed file is
 *    a byte-identical no-op, with no renumbering churn.
 *  - Graph-identical: `cans check` output on the expanded and collapsed
 *    forms of a file is identical (same refs, hops, SCC, errors, warnings).
 *  - Safe failures: a file with undefined/anchored alias uses, duplicate or
 *    illegal definitions, style conflicts or min_uses violations is REFUSED —
 *    left byte-identical, problems named — never silently rewritten.
 *  - Scope: spec files plus the aux ref holders (_tasks/, _adr/) — the same
 *    file set `cans check` loads, so disabling aliasing later has a complete
 *    expand path (an aliased task file would otherwise error with no
 *    migration route).
 *
 *  Flags: --dry-run (preview, no byte written), --json, [file] (optional
 *  single-file filter, check's UX). Plain runs WRITE (the import/export
 *  migration-command pattern); problems are per-file refusals with the other
 *  files still processed, ok:false / exit 1.
 */
import { join } from 'path';
import type { AliasResult, AliasFileOutcome } from '../types.ts';
import { readText, writeText } from '../core/runtime.ts';
import {
  resolveWorkspaceRoot, discoverSpecFiles, discoverActiveTasks, discoverAdrs,
  dirExists,
} from '../core/fs.ts';
import { targetMatchesKey } from '../core/refs.ts';
import { loadRules } from '../core/rules.ts';
import { collapseAliases, expandAliases, defaultAliasing } from '../core/alias.ts';
import { parseArgs, formatArgErrors, type FlagSpec } from '../core/args.ts';

const ALIAS_FLAGS: FlagSpec[] = [
  { name: 'dry-run', boolean: true },
  { name: 'json', boolean: true },
];

export async function run(args: string[]): Promise<AliasResult> {
  const parsed = parseArgs(args, ALIAS_FLAGS);
  const dryRun = parsed.flags.has('dry-run');
  const directionRaw = parsed.positional[0] ?? null;
  const file = parsed.positional.length > 1 ? parsed.positional[1]! : null;

  const fail = (error: string): AliasResult => ({
    ok: false, command: 'alias', exitCode: 2, direction: 'expand', results: [],
    ...(dryRun ? { dryRun: true } : {}), error,
  });

  if (parsed.errors.length > 0) {
    return fail(formatArgErrors(parsed.errors, 'alias'));
  }
  if (directionRaw !== 'expand' && directionRaw !== 'collapse') {
    return fail(
      directionRaw === null
        ? 'no direction given — run `cans alias expand` or `cans alias collapse`'
        : `unknown alias direction "${directionRaw}" — use expand or collapse`,
    );
  }
  if (parsed.positional.length > 2) {
    return fail(`unexpected argument "${parsed.positional[2]}" — alias takes <expand|collapse> and an optional [file]`);
  }
  const direction = directionRaw;

  const root = resolveWorkspaceRoot();
  if (root === null) {
    return fail('no cans workspace found — run `cans init` or cd into a project with a cans/ directory');
  }

  let rules;
  try {
    rules = loadRules(root);
  } catch (e) {
    return fail(`invalid _rules.yaml: ${e instanceof Error ? e.message : String(e)}`);
  }
  const aliasCfg = rules.references.aliasing ?? defaultAliasing();

  if (direction === 'collapse' && !aliasCfg.enabled) {
    // Safe failure, not a silent mint of files the checker would reject:
    // aliasing disabled + alias uses present is an ERROR at check time.
    return fail(
      'references.aliasing.enabled is false — collapse would produce alias uses the checker rejects. Enable aliasing in _rules.yaml first (expand is always allowed).',
    );
  }

  // The check file set: spec files + the aux ref holders. Sorted for a
  // deterministic report; discover* helpers throw on missing dirs (guarded).
  const rels = [
    ...discoverSpecFiles(root),
    ...(dirExists(join(root, '_tasks')) ? discoverActiveTasks(root) : []),
    ...(dirExists(join(root, '_adr')) ? discoverAdrs(root) : []),
  ];
  const scoped = file !== null ? rels.filter(rel => targetMatchesKey(file, rel)) : rels;
  if (file !== null && scoped.length === 0) {
    return fail(`no spec file matches "${file}" — pass a spec filename like 04-api.md or run \`cans status\` to list files`);
  }
  scoped.sort();

  const results: AliasFileOutcome[] = [];
  for (const rel of scoped) {
    let source: string;
    try {
      source = await readText(join(root, rel));
    } catch (e) {
      results.push({
        file: rel, changed: false, usesRewritten: 0, definitionsRemoved: 0,
        definitionsAdded: 0, definitionsKept: 0, charsSaved: 0,
        problems: [`unreadable file: ${e instanceof Error ? e.message : String(e)}`],
      });
      continue;
    }
    const transform = direction === 'expand'
      ? expandAliases(source, rel)
      : collapseAliases(source, rel, aliasCfg);
    if (transform.changed && !dryRun && transform.problems.length === 0) {
      await writeText(join(root, rel), transform.source);
    }
    results.push({
      file: rel,
      changed: transform.changed && transform.problems.length === 0,
      usesRewritten: transform.usesRewritten,
      definitionsRemoved: transform.definitionsRemoved,
      definitionsAdded: transform.definitionsAdded,
      definitionsKept: transform.definitionsKept,
      charsSaved: transform.problems.length > 0 ? 0 : source.length - transform.source.length,
      problems: transform.problems,
    });
  }

  const refused = results.some(r => r.problems.length > 0);
  return {
    ok: !refused,
    command: 'alias',
    // §19 classes: refusals are user-correctable file content (exit 1);
    // usage/no-workspace/invalid-rules are could-not-run (exit 2, `fail`).
    exitCode: refused ? 1 : 0,
    direction,
    results,
    ...(dryRun ? { dryRun: true } : {}),
  };
}
