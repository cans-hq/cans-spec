/** `cans refs <node> --codebase` — the reverse-traceability query (issue #66,
 *  RFC §4.2).
 *
 *  WHY this command exists: `cans check` verifies the corpus's OUTBOUND refs
 *  (spec → spec), and since issue #66 the `--codebase` phase also verifies
 *  the inbound ones (source → spec). But verification only answers "is this
 *  pointer broken?" — an author retargeting a spec node needs the other
 *  direction: WHICH source files reference this node? Until now that query
 *  was a grep. This command answers it from the same extraction engine the
 *  checker uses, so the two can never disagree about what a pointer is.
 *
 *  Shape (v1):
 *  - `--codebase` is REQUIRED: without it the command refuses (§20 — a flag
 *    that silently does nothing is a typo hiding in plain sight; the flag is
 *    the scan consent, exactly as on `cans check --codebase`). The refusal is
 *    ok:false / exitCode 1 with a message naming the flag and what it does.
 *  - The first positional is the node query: `<file>.md` optionally
 *    `#Slug` — both `02-auth.md` (every pointer into the file) and
 *    `02-auth.md#Sessions` (the RFC's canonical example) — and, since issue
 *    #69, the ARTIFACT form `<file>.<ext>` optionally `#Slug` (both
 *    `cans/artifacts/examples/multi-vm-swarm.rs#federate` and the
 *    file-level `cans/artifacts/diagrams/host-runtime.txt`). The grammar
 *    mirrors SEE_POINTER_RE's character classes through the SHARED
 *    target-extension table (core/codebase.ts CODEBASE_TARGET_EXTS via
 *    codebaseTargetExtAlt — a query must name everything a pointer can;
 *    the two grammars are built from one source and cannot drift),
 *    anchored on both ends: anything else (a bare stem without an
 *    extension, an extension no anchor vocabulary can address, an empty
 *    slug, trailing garbage) is a usage refusal, never a fuzzy match.
 *  - A `.md` query file resolves against the DISCOVERED spec keys exactly
 *    the way the engine resolves pointer targets (exact key, else `cans/`
 *    -stripped). v1 scope: discovered corpus keys only — the check engine's
 *    subfolder promotion and plugin tier are NOT reimplemented here, so a
 *    v1 `.md` query names corpus files. An unknown spec file refuses with
 *    the corpus boundary named.
 *  - A non-`.md` query file (issue #69, the artifact tier) resolves against
 *    the WORKSPACE FILESYSTEM: the optional `cans/` prefix strips, then
 *    resolveSpecFile (the same containment-guarded resolver the corpus
 *    refs engine uses for on-disk artifact targets — `artifacts/examples/
 *    multi-vm-swarm.rs` and `cans/artifacts/examples/multi-vm-swarm.rs`
 *    name one file). An unknown artifact file refuses with the same
 *    family shape, the spec-or-artifact boundary named. Matching never
 *    crosses the tiers: a `.md` query matches only corpus pointers (an
 *    artifact target is never a corpus key) and an artifact query only
 *    artifact pointers (resolveSpecFile of an `.md` target is an `.md`
 *    path — the folder-index fallback only ever appends `index.md` — so it
 *    can never equal a non-`.md` artifact path).
 *  - Matching is the tolerant contract, never fuzzy: a file-only query
 *    matches every pointer whose RESOLVED target file equals the query file;
 *    a slugged query compares `normalizeForAnchor(pointer.targetSlug)` with
 *    `normalizeForAnchor(query slug)` (anchor-insensitive — the same
 *    equivalence the refs engine verifies with). Matches are sorted file asc,
 *    line asc, each carrying the FULL source line as written.
 *  - Exit 0 on any successful query — zero matches is an ANSWER, not a
 *    failure. Refusals (no flag, bad query, unknown node, no workspace,
 *    invalid rules) are ok:false / exitCode 1, the user-correctable class —
 *    the `cans slug` precedent for pure query commands.
 *  - `--json` rides the standard emit() path: the frozen RefsResult shape
 *    (ok/command/exitCode/node/scanned/matches) and nothing else.
 *
 *  UNREADABLE SOURCE FILES — a documented v1 choice: a source file the scan
 *  selected but could not read is not a match (it has no lines), and the
 *  frozen RefsResult has no warnings field — so such files are kept OUT of
 *  `matches` and OUT of the --json wire entirely, while the human output
 *  notes each one as a `  ? <file>: unreadable` line (skip-silently is
 *  forbidden; the honest minimum is a named line in the human report only).
 *  They ride the result on a NON-ENUMERABLE `unreadableSources` side field
 *  (JSON.stringify skips non-enumerable properties, so the --json shape
 *  stays byte-exact); the human printer (output.ts, case 'refs') reads it.
 *  `scanned` counts every selected file, readable or not — the discoverability
 *  counter, not a success count.
 */
import { join, dirname } from 'path';
import type { CodebaseRules, OutlineNode, RefsResult } from '../types.ts';
import { readText } from '../core/runtime.ts';
import { resolveWorkspaceRoot, discoverSpecFiles, resolveSpecFile } from '../core/fs.ts';
import { parseOutline } from '../core/outline.ts';
import { loadRules, defaultCodebaseRules } from '../core/rules.ts';
import {
  collectSourceFiles,
  extractCodebasePointers,
  stripCodebaseAnchorPunct,
  codebaseTargetExtAlt,
} from '../core/codebase.ts';
import { normalizeForAnchor } from '../core/slug.ts';
import { parseArgs, formatArgErrors, type FlagSpec } from '../core/args.ts';

const REFS_FLAGS: FlagSpec[] = [
  { name: 'json', boolean: true },
  // issue #66: the scan consent — REQUIRED in v1. Without it the command
  // refuses instead of silently answering nothing (§20).
  { name: 'codebase', boolean: true },
];

/** The node query grammar: `<file>.<ext>` optionally `#Slug`, anchored on
 *  both ends. Character classes mirror SEE_POINTER_RE (file: letters/digits/
 *  underscore/dash/slash; slug: issue #67 — the FULL slug alphabet,
 *  whitespace/`#`-terminated, the same `[^\s#]+` shape the extractor
 *  captures), so anything a source pointer could express is queryable and
 *  nothing else parses. Issue #69: the extension alternation is built from
 *  the SHARED table — codebaseTargetExtAlt(), the same longest-first source
 *  the extractor's SEE_POINTER_RE file group builds from — so the query
 *  grammar accepts exactly the target extensions pointers can carry (the
 *  `.md` corpus tier plus the #58 schematic, #60 text-heading and #60
 *  code-symbol vocabularies) and no others (`foo.csv#x` is malformed: no
 *  anchor vocabulary could ever address a `.csv`, so accepting the query
 *  could only ever answer an empty match set). The captured query anchor is
 *  then cleaned with the extractor's own stripCodebaseAnchorPunct — the
 *  mirror runs BOTH ways, so a glued-closer spelling (`…#Invariants-and-
 *  policy-(transaction))` pasted from prose) resolves exactly like the
 *  captured pointer would. */
const QUERY_RE = new RegExp(
  '^([A-Za-z0-9_\\-/]+\\.(?:' + codebaseTargetExtAlt() + '))(?:#([^\\s#]+))?$',
);

/** Resolve a written `<file>.md` target against the corpus keys the way the
 *  engine does (§2.3): exact key first, else the `cans/`-stripped spelling
 *  (both `01-spec.md` and `cans/01-spec.md` name the same corpus file).
 *  Never fuzzy — no case folding, no stem completion, no suggestions. */
function resolveCorpusKey(file: string, keys: ReadonlySet<string>): string | null {
  if (keys.has(file)) return file;
  const stripped = file.replace(/^cans\//, '');
  return stripped !== file && keys.has(stripped) ? stripped : null;
}

/** Strip the optional `cans/` workspace prefix from a written target — the
 *  same spelling normalization checkCodebaseRefs applies before corpus-key
 *  resolution, reused here (issue #69) for the artifact tier: a pointer's
 *  `cans/artifacts/…` and a query's `artifacts/…` (and vice versa) must
 *  name the same workspace file. */
function cansStripped(file: string): string {
  return file.startsWith('cans/') ? file.slice('cans/'.length) : file;
}

/** Full-line splitter mirroring the engine's line normalization (§45:
 *  CRLF/lone-CR are terminators exactly like LF, so `text` — the line as
 *  written, minus its terminator — and pointer line numbers agree). */
function sourceLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

export async function run(args: string[]): Promise<RefsResult> {
  const parsed = parseArgs(args, REFS_FLAGS);
  const nodeRaw = parsed.positional[0] ?? '';

  const fail = (error: string): RefsResult => ({
    ok: false,
    command: 'refs',
    exitCode: 1,
    node: nodeRaw,
    scanned: 0,
    matches: [],
    error,
  });

  // §20: unknown flags / short flags / --flag=value — user errors, never
  // silently ignored.
  if (parsed.errors.length > 0) {
    return fail(formatArgErrors(parsed.errors, 'refs'));
  }
  if (parsed.positional.length === 0) {
    return fail('no node given — run `cans refs 02-auth.md --codebase` (or 02-auth.md#Sessions)');
  }
  if (parsed.positional.length > 1) {
    return fail(`unexpected argument "${parsed.positional[1]}" — refs takes a single <node> query`);
  }
  // §20: the consent flag is REQUIRED in v1 — without it the command would
  // silently do nothing, which is exactly the typo §20 refuses to hide.
  if (!parsed.flags.has('codebase')) {
    return fail(
      '"--codebase" is required — the refs query reads pointers embedded in SOURCE files; re-run as `cans refs <node> --codebase` to scan the trees configured under the codebase block in _rules.yaml',
    );
  }
  const query = nodeRaw.match(QUERY_RE);
  if (query === null) {
    return fail(
      `malformed node "${nodeRaw}" — use <file>.md or <file>.md#Slug (spec files, e.g. 02-auth.md or 02-auth.md#Sessions), or <file>.<ext> or <file>.<ext>#Slug (artifact files, e.g. artifacts/examples/driver.rs or artifacts/diagrams/host-runtime.txt#driver-avf)`,
    );
  }

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

  // The scan config: the codebase block when configured, else the defaults —
  // with enabled FORCED true (the flag IS the consent; a config block may
  // tune roots/include/exclude but cannot silently answer nothing).
  const cfg: CodebaseRules = { ...(rules.codebase ?? defaultCodebaseRules()), enabled: true };

  // The corpus: discovered spec keys parsed via parseOutline (the minimal
  // mirror of check.ts's load loop — file keys + node titles is all a query
  // needs). v1 resolves against DISCOVERED keys only: the check engine's
  // promotion loop and plugin tier are deliberately not reimplemented here.
  // A file that fails to read/parse never joins the corpus — a broken spec
  // file is not a resolvable target, consistent with the engine's
  // FileNotFound verdicts.
  const corpus = new Map<string, OutlineNode[]>();
  for (const rel of discoverSpecFiles(root)) {
    try {
      corpus.set(rel, parseOutline(await readText(join(root, rel)), rel));
    } catch {
      // unreadable/unparseable corpus file: not a resolvable query target
    }
  }
  const corpusKeys = new Set(corpus.keys());

  // Issue #69 — the query tier split. A `.md` query is the v1 corpus query
  // (resolved against DISCOVERED keys only, unchanged); anything else in
  // the shared extension table is an ARTIFACT query, resolved against the
  // workspace filesystem through the containment-guarded resolveSpecFile
  // — the same resolver the corpus refs engine uses for on-disk artifact
  // targets, so `cans refs` and `cans check` answer over one target space.
  // The two tiers never cross: the branches below keep corpus-key matching
  // for `.md` queries and resolved-path matching for artifact queries.
  const isArtifactQuery = !query[1]!.endsWith('.md');
  let queryKey: string | null = null;
  let queryArtifactPath: string | null = null;
  if (isArtifactQuery) {
    queryArtifactPath = resolveSpecFile(root, cansStripped(query[1]!));
    if (queryArtifactPath === null) {
      return fail(
        `no spec or artifact file matches "${query[1]}" — refs --codebase resolves against the workspace corpus (cans/) and its artifact files; run \`cans status\` to list the spec files`,
      );
    }
  } else {
    queryKey = resolveCorpusKey(query[1]!, corpusKeys);
    if (queryKey === null) {
      return fail(
        `no spec file matches "${query[1]}" — refs --codebase resolves against the workspace corpus (cans/); run \`cans status\` to list the spec files`,
      );
    }
  }
  // Issue #67: the query anchor is cleaned by the SAME pass the extractor
  // applies to captured pointers (the QUERY_RE mirror, both directions); an
  // anchor that cleans to empty (`#).`) degrades to a file-level query —
  // targetSlug null — exactly like extractCodebasePointers degrades it.
  const cleanedQuerySlug = query[2] === undefined ? '' : stripCodebaseAnchorPunct(query[2]!);
  const querySlug = cleanedQuerySlug === '' ? null : cleanedQuerySlug;

  // The scan: the engine's own file selection + extraction (never
  // reimplemented here), matched against the query. Source paths are
  // project-root-relative (the engine's convention — the same spelling the
  // RFC's `src/auth.rs:42` examples use), so they are read from the PROJECT
  // root: the parent of the workspace, the references.external_roots
  // convention.
  const sources = await collectSourceFiles(root, cfg);
  const projectRoot = dirname(root);
  const matches: Array<{ file: string; line: number; text: string }> = [];
  const unreadable: string[] = [];
  for (const src of sources) {
    let text: string;
    try {
      text = await readText(join(projectRoot, src));
    } catch {
      // Documented v1 choice (file header): unscannable, not a match —
      // named in the human output only, kept out of the frozen JSON shape.
      unreadable.push(src);
      continue;
    }
    for (const ptr of extractCodebasePointers(text)) {
      // Tier split (issue #69): an artifact query matches iff the pointer's
      // target resolves to the SAME workspace file (resolved absolute-path
      // equality — both spellings, `cans/`-prefixed or not, resolve through
      // resolveSpecFile to one path); a `.md` query keeps the corpus-key
      // comparison. A `.md` target's resolveSpecFile result always ends in
      // `.md` (the folder-index fallback appends `index.md`), so it can
      // never equal a non-`.md` artifact path — and a non-`.md` target is
      // never a corpus key — so the tiers cannot cross-match.
      if (queryArtifactPath !== null) {
        if (resolveSpecFile(root, cansStripped(ptr.targetFile)) !== queryArtifactPath) continue;
      } else {
        if (resolveCorpusKey(ptr.targetFile, corpusKeys) !== queryKey) continue;
      }
      if (querySlug !== null) {
        if (ptr.targetSlug === null) continue;
        if (normalizeForAnchor(ptr.targetSlug) !== normalizeForAnchor(querySlug)) continue;
      }
      matches.push({ file: src, line: ptr.line, text: sourceLines(text)[ptr.line - 1] ?? '' });
    }
  }
  // Deterministic order (file asc, line asc) — sources arrive sorted and
  // extraction is document order, so this is a no-op re-affirmation of the
  // contract; a stable sort keeps same-line pointers in raw order.
  matches.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));

  const result: RefsResult = {
    ok: true,
    command: 'refs',
    exitCode: 0,
    node: nodeRaw,
    scanned: sources.length,
    matches,
  };
  if (unreadable.length > 0) {
    // Non-enumerable side channel (file header): invisible to JSON.stringify,
    // read by the human printer for the `  ? <file>: unreadable` lines.
    Object.defineProperty(result, 'unreadableSources', { value: unreadable, enumerable: false });
  }
  return result;
}
