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
 *  - Scope: spec files plus the aux ref holders (_tasks/, _adr/), and — when
 *    aliasing is enabled AND references.aliasing.include lists globs (issue
 *    #65) — the configured plugin files OUTSIDE the spec corpus (the kelir
 *    cans/plugins/*.md case). The same rules apply everywhere: a plugin file
 *    is collapsed/expanded with the exact per-file transforms (min_uses
 *    counting, style enforcement, safe failures), never a second-class
 *    shortcut. Without a non-empty include — or with aliasing disabled — the
 *    set stays corpus+aux: aliases can never legally exist in files the
 *    checker does not load, and expand under a disabled config still covers
 *    the aux migration route.
 *
 *  Flags: --dry-run (preview, no byte written), --json, [file] (optional
 *  single-file filter, check's UX). Plain runs WRITE (the import/export
 *  migration-command pattern); problems are per-file refusals with the other
 *  files still processed, ok:false / exit 1. A [file] filter matching
 *  nothing gets the historical refusal — unless the named file physically
 *  exists inside the workspace as a .md file (issue #65): then the refusal
 *  names the corpus boundary and the include knob, because "pass a spec
 *  filename" is unactionable advice for a plugin file the user can see.
 */
import { join, relative, resolve, isAbsolute } from 'path';
import type { AliasResult, AliasFileOutcome } from '../types.ts';
import { readText, writeText } from '../core/runtime.ts';
import {
  resolveWorkspaceRoot, discoverSpecFiles, discoverActiveTasks, discoverAdrs,
  discoverAliasingFiles, dirExists, exists, isFile, normalizeNamedFileArg,
} from '../core/fs.ts';
import { targetMatchesKey } from '../core/refs.ts';
import { loadRules } from '../core/rules.ts';
import { collapseAliases, expandAliases, defaultAliasing } from '../core/alias.ts';
import { parseArgs, formatArgErrors, type FlagSpec } from '../core/args.ts';

const ALIAS_FLAGS: FlagSpec[] = [
  { name: 'dry-run', boolean: true },
  { name: 'json', boolean: true },
];

/** Issue #65: does the named [file] argument physically exist inside the
 *  workspace as a markdown FILE? Only then does the no-match refusal earn
 *  the corpus-boundary hint — a file the user can see must never be lectured
 *  with "pass a spec filename" when the real fix is an include glob.
 *
 *  Guards mirror the ref/discovery containment discipline (issue #10 via
 *  fs.ts's isInsideRoot): the argument must resolve INSIDE the workspace
 *  root — an absolute spelling or an escaping `..` candidate can never be
 *  the workspace file even when it physically exists beyond the root, while
 *  interior `..` that normalizes back inside still resolves (messaging only;
 *  the transforms themselves operate on discovered keys). The corpus filter
 *  accepts extensionless spellings of .md files (targetMatchesKey), so the
 *  probe mirrors resolveSpecFile's flat probe: the path as spelled, then
 *  `<stem>.md` for a non-.md spelling. isFile (not exists) — a directory is
 *  never "the file", whatever its name. The probed path always ends in .md,
 *  so non-markdown files keep the historical refusal. */
function namedMdFileInsideWorkspace(root: string, name: string): boolean {
  // Issue #65: the probe rides the NORMALIZED key — the production layout
  // keeps the workspace in a `cans/` directory inside the project, so the
  // issue's command spellings (`cans/plugins/profile.md` from the project
  // root) and the workspace-relative keys (`plugins/profile.md`) differ;
  // both must read as "exists outside the loaded set".
  const key = normalizeNamedFileArg(root, name);
  const clean = key.replace(/\/+$/, '');
  if (clean === '') return false;
  const candidates = clean.endsWith('.md') ? [clean] : [`${clean}.md`];
  for (const c of candidates) {
    const p = resolve(root, c);
    const rel = relative(root, p);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) continue;
    if (exists(p) && isFile(p)) return true;
  }
  return false;
}

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
  // Issue #65: the plugin tier. Configured include globs join the set ONLY
  // when aliasing is enabled AND the list is non-empty — aliases can never
  // legally live in files the checker does not load, so a disabled config or
  // an empty include keeps the corpus+aux set (expand's migration route for
  // _tasks/_adr stays; collapse under a disabled config was already refused
  // above, and that refusal stays FIRST in order — before any file-set or
  // filter work). discoverAliasingFiles deduplicates against the loaded
  // corpus/aux keys by contract, so the appended tier can never double-load;
  // the total sort below keeps the report order deterministic either way.
  const includeGlobs = aliasCfg.include ?? [];
  if (aliasCfg.enabled === true && includeGlobs.length > 0) {
    rels.push(...discoverAliasingFiles(root, includeGlobs, new Set(rels)));
  }
  // Issue #65: the named filter accepts BOTH legal spellings — the raw
  // (workspace-relative) and the process-CWD-relative spelling (the
  // production `cans/`-inside-the-project layout); normalization only fires
  // when the path exists under the workspace. The refusal message below
  // still quotes the author's original spelling.
  const fileKey = file !== null ? normalizeNamedFileArg(root, file) : null;
  const scoped = file !== null ? rels.filter(rel => targetMatchesKey(fileKey!, rel)) : rels;
  if (file !== null && scoped.length === 0) {
    // Issue #65: a named file that physically exists inside the workspace as
    // a .md file but matches no loaded key is a CORPUS-BOUNDARY refusal, not
    // a typo — the actionable advice is the include knob (whatever the knob's
    // current state: with aliasing disabled the glob alone does not join the
    // set, so the hint names the _rules.yaml member the author must touch).
    // A name that exists nowhere keeps the historical message byte-identical
    // (the pre-#65 UX: probably a misspelled spec filename).
    if (namedMdFileInsideWorkspace(root, file)) {
      return fail(
        `no spec file matches "${file}" — the file exists but is outside the spec corpus; ` +
        `add a references.aliasing.include glob (e.g. plugins/*.md) in _rules.yaml to alias plugin files (issue #65)`,
      );
    }
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
