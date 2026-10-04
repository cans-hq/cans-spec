import { join } from 'path';
import type { BackPointer, CheckResult, Issue, OutlineNode } from '../types.ts';
import { readText, writeText } from '../core/runtime.ts';
import {
  discoverSpecFiles, discoverActiveTasks, discoverAdrs, resolveWorkspaceRoot,
  dirExists, detectFlatFolderConflicts, detectMalformedSpecDirs, discoverOverflowTargets,
} from '../core/fs.ts';
import {
  parseOutline, extractBackPointers, realNodes, maxDepth as outlineMaxDepth,
  type ParseWarning,
} from '../core/outline.ts';
import { loadRules } from '../core/rules.ts';
import { checkStructure, checkTbdPolicy } from '../core/structure.ts';
import { checkStyle } from '../core/style.ts';
import { checkOverflow, checkNoChaining } from '../core/overflow.ts';
import { checkRedundancy } from '../core/redundancy.ts';
import {
  buildRefGraph, checkRefs, detectDeepHops, detectOrphans,
  rebuildBackPointers, targetMatchesKey, anchorMatches, type RefByGroup, type RefGraph,
} from '../core/refs.ts';
import { parseArgs, formatArgErrors, type FlagSpec } from '../core/args.ts';

export interface CheckArgs {
  fix: boolean;
  strict: boolean;
  refsOnly: boolean;
  noRedundancy: boolean;
  file: string | null;
  json: boolean;
  /** issue #41: sections to render unfolded (`--show <section[,section]>`).
   *  Emission-time concern only — the engine result is identical either way.
   *  Optional: internal callers (done.ts's ZERO_CHECK_ARGS) never set it. */
  show?: string[];
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
  { name: 'show', boolean: false },
  { name: 'json', boolean: true },
];

/** issue #41: user-facing --show targets. `all` unfolds every section. */
const SHOW_SECTIONS = new Set([
  'structure', 'style', 'refs', 'redundancy', 'overflow', 'parse', 'content', 'io', 'other', 'all',
]);

const REF_BY_RE = /<!--\s*ref-by:\s*(.*?)\s*-->/;
// Fence marker rule, mirrored from src/core/outline.ts (issue #6): a line whose
// trimmed form starts with ``` toggles fence state. Kept as a regex to reuse
// the outline.ts FENCE_RE convention; the two must never diverge.
const FENCE_RE = /^```/;

// globFiles throws ENOENT on missing dirs — guard the optional ones.
function safeActiveTasks(root: string): string[] {
  return dirExists(join(root, '_tasks')) ? discoverActiveTasks(root) : [];
}

function safeAdrs(root: string): string[] {
  return dirExists(join(root, '_adr')) ? discoverAdrs(root) : [];
}

/** issue #41: which sections `--show` unfolds — tolerant parse for the EMIT
 *  side (cli.ts). Strict validation lives in parseCheckArgs (usage errors); a
 *  failing run prints its diagnosis instead of a report, so the printer never
 *  needs the show set in that case. */
export function showSectionsFromArgs(args: string[]): Set<string> {
  const raw = parseArgs(args, CHECK_FLAGS).flags.get('show');
  if (typeof raw !== 'string') return new Set();
  return new Set(raw.split(',').map(s => s.trim().toLowerCase()).filter(s => SHOW_SECTIONS.has(s)));
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
  // issue #41: --show takes a comma-separated section list; unknown names are
  // user errors, never silently ignored (§20 contract).
  const show: string[] = [];
  const rawShow = parsed.flags.get('show');
  if (typeof rawShow === 'string') {
    for (const part of rawShow.split(',')) {
      const s = part.trim().toLowerCase();
      if (s === '') continue;
      if (!SHOW_SECTIONS.has(s)) {
        errors.push(`unknown --show section "${s}" — use structure|style|refs|redundancy|overflow|all`);
      } else {
        show.push(s);
      }
    }
  }
  return {
    fix: parsed.flags.has('fix'),
    strict: parsed.flags.has('strict'),
    refsOnly: parsed.flags.has('refs-only'),
    noRedundancy: parsed.flags.has('no-redundancy'),
    json: parsed.flags.has('json'),
    show,
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
    backPointersUpdatedFiles: [],
    elapsedMs: 0, // issue #41: the static failure paths never ran a check
  };
}

/** §37: check-level failure (no workspace, invalid rules, unknown flag, file
 *  filter matched nothing). The diagnosis rides in `error` so the human printer
 *  can show it standalone — never inside a report-shaped body.
 *  issue #41: the check could not run = error class → exitCode 2. */
function checkFail(message: string): CheckResult & { error: string } {
  return {
    ok: false,
    command: 'check',
    exitCode: 2, // issue #41: usage/no-workspace/invalid-rules are the error class
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

/** Issue #19: is a `<!-- ref-by: ... -->` comment still earned?
 *  The comment's form (recorded by extractBackPointers in toAnchor) defines
 *  what it answers:
 *  - A STANDALONE comment (own line, toAnchor null) answers "who refs this
 *    file?" — current only while the referrer still holds a FILE-LEVEL ref
 *    here. An anchored ref no longer satisfies it: the mark must sit on the
 *    node the ref names.
 *  - An INLINE comment on node X (toAnchor = X's text) answers "who refs this
 *    node?" — current while the referrer's anchor resolves to X, or while it
 *    refs the file itself (a file-level ref satisfies any mark in the file:
 *    the mark is at least as precise as the ref, which keeps issue #6's
 *    replace-in-place contract convergent).
 *  Consequences pinned by issue #19: retargeting the anchor (#Sessions →
 *  #Passwords) makes the old mark stale; a broken anchor can never match any
 *  node, so it can never read as current. */
function backPointerIsCurrent(
  bp: BackPointer,
  rel: string,
  allFiles: Map<string, OutlineNode[]>,
  graph: RefGraph,
): boolean {
  const fromKey = refTargetKey(bp.fromFile, allFiles.keys());
  if (fromKey === null) return false;
  const fromRefs = graph.forward.get(fromKey);
  if (fromRefs === undefined) return false;
  return fromRefs.some(t => {
    if (refTargetKey(t.file, allFiles.keys()) !== rel) return false;
    if (bp.toAnchor === null) return t.anchor === null;
    return t.anchor === null || anchorMatches(bp.toAnchor, t.anchor);
  });
}

/** Issue #6: remove ONLY the ref-by comment substring from a non-bullet line,
 *  keeping the surrounding prose. Collapses the double space left where the
 *  comment sat (one seam space absorbed) and trims trailing whitespace. The
 *  caller drops the line only when nothing but the comment remains. */
function stripRefByKeepProse(raw: string): string {
  const m = raw.match(REF_BY_RE);
  if (m === null || m.index === undefined) return raw;
  let out = raw.slice(0, m.index) + raw.slice(m.index + m[0].length);
  if (out.charAt(m.index - 1) === ' ' && out.charAt(m.index) === ' ') {
    out = out.slice(0, m.index - 1) + out.slice(m.index);
  }
  return out.replace(/[ \t]+$/, '');
}

/** Issue #19: one anchored ref-by placement — the comment body that belongs
 *  INLINE on the anchor node's bullet line (`line` is the node's 1-based
 *  source line from parseOutline; node lines are real bullets outside any
 *  fence by construction, so anchored marks can never land inside a fence). */
export interface RefByPlacement {
  line: number;
  body: string;
}

/** Issue #21: one source line, split off its terminator. `eol` records the
 *  bytes that ended the line ('\r\n' | '\n'); null only for a final line the
 *  file left unterminated (possibly the empty tail after a trailing newline).
 *  Splitting this way keeps every line's own terminator addressable so the
 *  rejoin is byte-preserving: replaced/stripped content never touches the
 *  terminator, dropped lines vanish with theirs, and only genuinely inserted
 *  lines mint a new one (the file's dominant EOL). Line indices are identical
 *  to normalizeEol + split('\n') — what parseOutline and extractBackPointers
 *  see — because '\r' is peeled off the same '\n' boundaries. */
interface SourceLine {
  text: string;
  eol: string | null;
}

function splitSourceLines(source: string): SourceLine[] {
  const out: SourceLine[] = [];
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10 /* \n */) {
      let end = i;
      let eol = '\n';
      if (end > start && source.charCodeAt(end - 1) === 13 /* \r */) {
        end -= 1;
        eol = '\r\n';
      }
      out.push({ text: source.slice(start, end), eol });
      start = i + 1;
    }
  }
  out.push({ text: source.slice(start), eol: null }); // unterminated tail (may be '')
  return out;
}

function joinSourceLines(lines: SourceLine[]): string {
  let out = '';
  for (const l of lines) out += l.text + (l.eol ?? '');
  return out;
}

/** Rewrite `<!-- ref-by: ... -->` comments in one spec file source.
 *  Fence-aware, prose-preserving, anchor-aware, EOL-preserving
 *  (issues #6 + #19 + #21):
 *  - Lines inside ``` fences (and the fence markers themselves) are preserved
 *    byte-for-byte: never scanned as hits, never rewritten, never dropped, and
 *    fenced "- fake bullets" are never insertion anchors. Anchored placements
 *    come from parsed outline nodes, which by construction never sit inside a
 *    fence — a fenced copy of the anchor node's text is never the anchor line.
 *  - Issue #19 placement: an ANCHORED ref's mark goes INLINE on the referenced
 *    node's bullet line (appended after one space, the §34 fixture convention
 *    `- Authentication <!-- ref-by: ... -->`); a FILE-LEVEL ref's mark keeps
 *    the issue #6 form — a standalone comment line right after the first root
 *    bullet outside any fence, appended at end when none exists — unless the
 *    file ends inside an unterminated fence, in which case the comment is
 *    inserted before the fence opener (never inside a fence).
 *  - Hits (comments outside fences) resolve per placement: an inline hit on an
 *    anchored placement line has its content REPLACED in place (form kept);
 *    the file-level body replaces the FIRST remaining hit's content wherever
 *    it sits (issue #6 contract); every other hit — stale, duplicate or
 *    misplaced — is stripped: bullets keep the bullet, non-bullet prose loses
 *    only the comment substring (the line is dropped only when bare).
 *  - Issue #21 byte preservation: content edits never touch a line's own
 *    terminator (a CRLF line stays CRLF through replace and strip; a dropped
 *    line disappears with its terminator). Only INSERTED lines mint a new
 *    terminator — the file's DOMINANT EOL — so a CRLF spec never acquires a
 *    bare-LF comment line, and an LF spec never acquires \r. Appending after
 *    an unterminated last line gives that line the dominant EOL as separator;
 *    the appended comment stays unterminated, exactly like a join would.
 *  Exported for regression tests (issues #6/#19/#21); behavior lives here. */
export function rewriteRefBy(source: string, body: string | null, anchored?: RefByPlacement[]): string {
  const lines = splitSourceLines(source);
  // Issue #21: the dominant terminator mints the EOL of inserted lines.
  // Majority vote over the file's real terminators; a tie (or a file with no
  // terminated lines) stays LF — the join default.
  let crlf = 0;
  let lf = 0;
  for (const l of lines) {
    if (l.eol === '\r\n') crlf++;
    else if (l.eol === '\n') lf++;
  }
  const dominant = crlf > lf ? '\r\n' : '\n';
  const comment = body !== null && body !== '' ? `<!-- ref-by: ${body} -->` : null;
  // Merge anchored placements onto 0-based line indices (defensive: duplicate
  // lines union their bodies). Out-of-range lines — pathological sources whose
  // parse counted more lines than the raw split — clamp to the last line
  // rather than silently dropping the mark.
  const anchoredByLine = new Map<number, string[]>();
  for (const p of anchored ?? []) {
    if (p.body === '') continue;
    const idx = Math.min(Math.max(p.line - 1, 0), lines.length - 1);
    const list = anchoredByLine.get(idx) ?? [];
    for (const entry of p.body.split(',').map(s => s.trim()).filter(Boolean)) {
      if (!list.includes(entry)) list.push(entry);
    }
    anchoredByLine.set(idx, list);
  }
  const anchoredBody = (idx: number): string | null => {
    const list = anchoredByLine.get(idx);
    return list !== undefined && list.length > 0 ? list.slice().sort().join(', ') : null;
  };

  const hits: number[] = [];
  const dropped = new Set<number>(); // issue #6: bare non-bullet comment lines vanish
  let fenceOpen = false;
  let fenceOpener = -1;
  const inFence: boolean[] = new Array(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.text;
    if (FENCE_RE.test(raw.trim())) {
      // Fence marker: toggles state; never a hit, never an anchor, never touched.
      inFence[i] = true;
      if (fenceOpen) {
        fenceOpen = false;
      } else {
        fenceOpen = true;
        fenceOpener = i;
      }
      continue;
    }
    inFence[i] = fenceOpen;
    if (fenceOpen) continue;
    if (REF_BY_RE.test(raw)) hits.push(i);
  }

  const replaced = new Set<number>(); // hits whose content was replaced in place
  // 1. Anchored placements first: an inline hit ON an anchor node line is the
  //    mark for that node — replace its content, keep the inline form.
  for (const i of hits) {
    if (replaced.has(i)) continue;
    const anchorBody = anchoredBody(i);
    if (anchorBody !== null && /^\s*-\s/.test(lines[i]!.text)) {
      lines[i]!.text = lines[i]!.text.replace(REF_BY_RE, `<!-- ref-by: ${anchorBody} -->`);
      anchoredByLine.delete(i);
      replaced.add(i);
    }
  }
  // 2. File-level body: the first hit not claimed by an anchor placement keeps
  //    its position and form, content replaced (issue #6 contract).
  let fileSlotUsed = false;
  if (comment !== null) {
    for (const i of hits) {
      if (replaced.has(i)) continue;
      lines[i]!.text = lines[i]!.text.replace(REF_BY_RE, comment);
      replaced.add(i);
      fileSlotUsed = true;
      break;
    }
  }
  // 3. Every remaining hit is stale, duplicate or misplaced: strip it.
  for (const i of hits) {
    if (replaced.has(i)) continue;
    const raw = lines[i]!.text;
    const isBullet = /^\s*-\s/.test(raw);
    if (isBullet) {
      lines[i]!.text = raw.replace(REF_BY_RE, '').replace(/[ \t]+$/, '');
    } else {
      // Issue #6: never delete a prose line whole — strip the comment only.
      const stripped = stripRefByKeepProse(raw);
      if (stripped.trim() === '') dropped.add(i);
      else lines[i]!.text = stripped;
    }
  }
  // 4. Fresh anchored marks: append inline to the anchor node's bullet line
  //    (after one space). The line keeps its own terminator (issue #21).
  for (const idx of [...anchoredByLine.keys()].sort((a, b) => a - b)) {
    const anchorBody = anchoredBody(idx);
    if (anchorBody === null) continue;
    const target = lines[idx];
    target.text = target.text === ''
      ? `<!-- ref-by: ${anchorBody} -->`
      : `${target.text} <!-- ref-by: ${anchorBody} -->`;
  }
  // 5. Fresh file-level mark (only when no hit became the file-level slot):
  //    standalone line right after the first root bullet outside any fence,
  //    appended at end when none exists (issue #6) — never inside an
  //    unterminated fence. The inserted line is terminated with the file's
  //    dominant EOL (issue #21).
  if (comment !== null && !fileSlotUsed) {
    let insertAt = lines.length;
    for (let i = 0; i < lines.length; i++) {
      if (inFence[i]) continue; // fenced `- fake bullets` are not anchors
      if (!dropped.has(i) && /^- /.test(lines[i]!.text)) {
        insertAt = i + 1;
        break;
      }
    }
    // Issue #6: never insert inside an open fence — appending at EOF while a
    // fence is unterminated would corrupt the fenced region.
    if (insertAt >= lines.length && fenceOpen) insertAt = fenceOpener;
    if (insertAt < lines.length) {
      lines.splice(insertAt, 0, { text: comment, eol: dominant });
    } else {
      // Appending at EOF: the current last line (an unterminated tail) gains
      // the dominant EOL as separator; the comment becomes the unterminated
      // tail — byte-identical to what a plain join would produce, with the
      // file's own dominant terminator instead of a hard-coded '\n'.
      const last = lines[lines.length - 1]!;
      if (last.eol === null) last.eol = dominant;
      lines.push({ text: comment, eol: null });
    }
  }
  const kept: SourceLine[] = lines.filter((_, i) => !dropped.has(i));
  return joinSourceLines(kept);
}

/** The shared engine orchestrator used by `cans check` and `cans done`. */
export async function checkWorkspace(root: string, opts: CheckArgs): Promise<CheckResult> {
  const t0 = performance.now(); // issue #41: elapsedMs timing (global in Bun + Node ≥16)
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
      rule: 'structure.malformed_dir', // issue #41
    });
  }

  // §8: "Flat wins over folder. If both exist, `cans check` flags error."
  for (const [flat, folder] of detectFlatFolderConflicts(root)) {
    issues.push({
      file: flat, line: 0, level: 'error', category: 'structure',
      message: `duplicate home: both ${flat} and ${folder} exist — flat wins, remove the folder`,
      suggestion: `delete ${folder} (or merge its content into ${flat})`,
      rule: 'structure.duplicate_home', // issue #41
    });
  }

  // Spec files: full checks.
  const specRel = discoverSpecFiles(root);
  const specFiles = new Map<string, OutlineNode[]>();
  const specSources = new Map<string, string>();
  for (const rel of specRel) {
    let text = '';
    try {
      text = await readText(join(root, rel));
    } catch (e) {
      issues.push({
        file: rel, line: 0, level: 'error', category: 'structure',
        message: `unreadable spec file: ${e instanceof Error ? e.message : String(e)}`,
        rule: 'io.unreadable', // issue #41
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
        rule: 'parse.error', // issue #41
      });
    }
    // Odd (non-2-multiple) indentation silently re-parents nodes — surface it.
    for (const pw of fileWarnings) {
      issues.push({
        file: rel, line: pw.line, level: 'warning', category: 'structure',
        message: pw.message,
        rule: 'parse.indent', // issue #41
      });
    }
  }

  // Task + ADR sources: parsed for ref extraction only (no structure/style/etc checks).
  const auxFiles = new Map<string, OutlineNode[]>();
  for (const rel of [...safeActiveTasks(root), ...safeAdrs(root)]) {
    try {
      const text = await readText(join(root, rel));
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
        if (backPointerIsCurrent(bp, rel, allFiles, graph)) {
          bpCurrent++;
        } else {
          bpStale++;
          issues.push({
            file: rel, line: bp.fromLine, level: 'warning', category: 'refs',
            message: `stale back-pointer: ${bp.fromFile} no longer refs ${rel}${bp.toAnchor !== null ? `#${bp.toAnchor}` : ''}`,
            suggestion: 'remove the ref-by comment (or re-run cans check --fix)',
            rule: 'refs.backpointer.stale', // issue #41
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
        targetFiles.set(rel, parseOutline(await readText(join(root, rel)), rel));
      } catch {
        // unreadable overflow target: skipped
      }
    }
    issues.push(...checkNoChaining(targetFiles));
  }

  // --fix: rewrite ref-by comments ONLY, in spec files ONLY.
  // §18/§17: with the back-pointer check off (back_pointers false or deleted),
  // --fix must not write anything — backPointersUpdated stays 0, no file touched.
  // Issue #11 (round 6): a [file] filter scopes the WRITES to the filter-matched
  // spec files. The desired-marks map is still computed from the GLOBAL ref
  // graph (refs stay global by design) — only the writes are scoped, so a
  // filtered run never mutates a file the user did not name. A referrer filter
  // (e.g. 04-api.md) therefore leaves its TARGETS' marks untouched this run
  // (targets are not filter-matched); the user re-runs with the target's
  // filter, or unfiltered, to write them. `cans done` (file: null) and
  // unfiltered runs rewrite every spec source, exactly as before.
  let backPointersUpdated = 0;
  const backPointersUpdatedFiles: string[] = [];
  if (opts.fix && backPointersOn) {
    const desired = rebuildBackPointers(allFiles, graph);
    // Issue #11: filtered run → only the checkable (filter-matched) spec
    // files; unfiltered run (and `cans done`, which fixes with file: null) →
    // every spec source.
    const fixable: string[] = opts.file !== null ? checkable : [...specSources.keys()];
    for (const rel of fixable) {
      const source = specSources.get(rel);
      if (source === undefined) continue;
      // Issue #19: the desired marks are per (file, anchor). Anchored refs
      // earn an INLINE mark on the anchor node's line; file-level refs keep
      // the standalone after-first-root-bullet form (issue #6). Broken-anchor
      // refs were dropped by rebuildBackPointers — nothing is written for
      // them (they are already checkRefs errors).
      const groups: RefByGroup[] = desired.get(rel) ?? [];
      const fileBody = groups.find(g => g.node === null)?.fromFiles.join(', ') ?? null;
      const anchored = groups
        .filter(g => g.node !== null)
        .map(g => ({ line: g.node!.line, body: g.fromFiles.join(', ') }));
      const rewritten = rewriteRefBy(source, fileBody, anchored);
      if (rewritten !== source) {
        await writeText(join(root, rel), rewritten);
        specSources.set(rel, rewritten);
        backPointersUpdated++;
        backPointersUpdatedFiles.push(rel);
      }
    }

    // §35 check-fix.json reports the POST-fix state: recompute back-pointer
    // counts from the rewritten sources and drop now-fixed stale issues.
    // Issue #11: only a file the run ACTUALLY rewrote can have its stale
    // warnings dropped — files outside a [file] filter keep theirs (the
    // comment is still on disk, so it is still stale).
    bpTotal = 0;
    bpCurrent = 0;
    bpStale = 0;
    for (const [rel, source] of specSources) {
      for (const bp of extractBackPointers(source, rel)) {
        bpTotal++;
        if (backPointerIsCurrent(bp, rel, allFiles, graph)) {
          bpCurrent++;
        } else {
          bpStale++;
        }
      }
    }
    const rewrittenSet = new Set(backPointersUpdatedFiles);
    for (let i = issues.length - 1; i >= 0; i--) {
      if (
        issues[i]!.category === 'refs' &&
        issues[i]!.message.startsWith('stale back-pointer:') &&
        rewrittenSet.has(issues[i]!.file)
      ) {
        issues.splice(i, 1);
      }
    }
  }

  let nodeCount = 0;
  let depthMax = 0;
  for (const nodes of specFiles.values()) {
    // Issue #8: report REAL nodes only — synthetic "(table)"/"(code fence)"
    // placeholders (leading table/fence before the first bullet) are not
    // user content and inflated the header count and budget estimates.
    nodeCount += realNodes(nodes).length;
    // Depth keeps the full tree: a synthetic root sits at indent 0, so it can
    // never raise depthMax; a workspace containing only phantoms now has
    // nodeCount 0 and correctly reports maxDepth 0 (§35 empty-workspace case).
    depthMax = Math.max(depthMax, outlineMaxDepth(nodes));
  }
  const refsTotal = [...graph.forward.values()].reduce((a, ts) => a + ts.length, 0);
  // Round 6 (QA-19 F40b): refs.broken is TRUTHFUL — broken ref targets AND
  // broken anchors are both §12 broken-ref errors, so both count. (The old
  // message-prefix filter left refs.broken: 0 beside a broken-anchor ERROR
  // with errorCount 1 / ok:false — machine consumers filtered on the counter
  // missed the error.) Rule keys are the stable vocabulary (issue #41).
  const broken = issues.filter(
    i => i.category === 'refs' && i.level === 'error'
      && (i.rule === 'refs.broken.file' || i.rule === 'refs.broken.anchor'),
  ).length;

  const errorCount = issues.filter(i => i.level === 'error').length;
  const warningCount = issues.filter(i => i.level === 'warning').length;
  const ok = errorCount === 0 && (!opts.strict || warningCount === 0);

  return {
    ok,
    command: 'check',
    // issue #41: exit contract 0 clean · 1 warnings · 2 errors.
    // strict affects `ok` only, never the exit code.
    exitCode: errorCount > 0 ? 2 : (warningCount > 0 ? 1 : 0),
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
    // Issue #11: the report names the files --fix actually rewrote (sorted,
    // spec-relative). Empty without --fix or when nothing needed a write;
    // with a [file] filter only matching files can ever appear here.
    backPointersUpdatedFiles: [...backPointersUpdatedFiles].sort(),
    // issue #41: whole-ms wall-clock duration of the run (never negative).
    elapsedMs: Math.max(0, Math.round(performance.now() - t0)),
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
