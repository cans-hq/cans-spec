import { join } from 'path';
import type { BackPointer, CheckResult, Issue, OutlineNode } from '../types.ts';
import { readText, writeText } from '../core/runtime.ts';
import {
  discoverSpecFiles, discoverActiveTasks, discoverAdrs, resolveWorkspaceRoot,
  dirExists, detectFlatFolderConflicts, detectMalformedSpecDirs, discoverOverflowTargets,
  resolveSpecFile,
} from '../core/fs.ts';
import {
  parseOutline, extractBackPointers, realNodes, flattenNodes, maxDepth as outlineMaxDepth,
  type ParseWarning,
} from '../core/outline.ts';
import { loadRules } from '../core/rules.ts';
import { checkStructure, checkTbdPolicy } from '../core/structure.ts';
import { checkStyle } from '../core/style.ts';
import { checkOverflow, checkNoChaining } from '../core/overflow.ts';
import { checkRedundancy } from '../core/redundancy.ts';
import {
  buildRefGraph, checkRefs, detectDeepHops, detectOrphans,
  rebuildBackPointers, targetMatchesKey, anchorMatches, extractYamlKeys,
  type RefByGroup, type RefGraph,
} from '../core/refs.ts';
import {
  anchorSlug, charLabel, slugConfusables,
  nearSlugMatches, SLUG_SUGGEST_THRESHOLD,
} from '../core/slug.ts';
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
  /** issue #53 (Part 2.4): with `--fix`, APPLY the proposed anchor repairs
   *  (plus the usual ref-by cleanup). Never legal without --fix —
   *  parseCheckArgs rejects that as a §20 usage error before any workspace
   *  is touched. Optional: internal callers (done.ts's ZERO_CHECK_ARGS)
   *  never set it — undefined reads as false. */
  yes?: boolean;
  /** issue #53 (Part 2.4): with `--fix`, PREVIEW every write (anchor repairs
   *  AND ref-by rewrites) in the report and write nothing at all. Never
   *  legal without --fix, and mutually exclusive with --yes (apply and
   *  preview are different transactions). Optional, same rule as --yes. */
  dryRun?: boolean;
  /** §24 (done): the archiving task's parsed nodes, injected under their
   *  former `_tasks/<name>.md` identity so refs held by the archived task
   *  still count for the back-pointer rebuild. Never set by `check` itself. */
  extraReferrer?: { key: string; nodes: OutlineNode[] } | null;
}

const CHECK_FLAGS: FlagSpec[] = [
  { name: 'fix', boolean: true },
  // issue #53 (Part 2.4): the anchor-repair transaction flags. Both are
  // meaningless without --fix — parseCheckArgs enforces that (§20: a flag
  // that silently does nothing is a typo hiding in plain sight, QA-10 M3).
  { name: 'yes', boolean: true },
  { name: 'dry-run', boolean: true },
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
// Issue #48 trailing-punctuation strip set, mirrored from src/core/outline.ts
// (REF_TRAILING_PUNCT_RE): the parser strips a trailing run of these from
// see: tokens AFTER the match, so a ref's raw token carries `anchor` +
// optional strippable punctuation while the parsed anchor is bare. The anchor
// repair replaces only the anchor prefix — the punctuation belongs to the
// surrounding sentence. The mirror must never diverge from the original.
const REF_TRAILING_PUNCT = /[)\]},.;:!?'\u2019\u201D\u2026]+$/;
// The refs.broken.anchor message shape, mirrored from src/core/refs.ts
// (checkRefs) and test/report.ts (RE_BROKEN_ANCHOR): the --fix anchor repair
// captures its failing (file, line, anchor) tuples FROM the issues list — the
// same list the report prints — so a repair can never target a ref the run did
// not flag. The three spellings must never diverge.
const RE_BROKEN_ANCHOR_MSG = /^broken anchor: (\S+)#(\S+) — no node matches$/;

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
  // issue #53 (Part 2.4): --yes/--dry-run refine --fix's anchor-repair
  // transaction (propose → apply). Alone they are user errors, never
  // silently-ignored typos — and together they are contradictory (apply and
  // preview are different transactions; a combined run must not surprise
  // either expectation, so it is rejected instead of picking a winner).
  const fix = parsed.flags.has('fix');
  const yes = parsed.flags.has('yes');
  const dryRun = parsed.flags.has('dry-run');
  if (yes && !fix) {
    errors.push('"--yes" requires --fix — it applies the anchor repairs --fix proposes');
  }
  if (dryRun && !fix) {
    errors.push('"--dry-run" requires --fix — it previews the changes --fix would make');
  }
  if (yes && dryRun) {
    errors.push('"--yes" and "--dry-run" are mutually exclusive — preview with --dry-run or apply with --yes, not both');
  }
  return {
    fix,
    yes,
    dryRun,
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

/** Issue #53 Part 1.5: per-file cap for refs.slug.hint notes. The issue #41
 *  compact-output budget never pays for unbounded hint lines: the first
 *  SLUG_HINT_CAP confusable nodes per file get a note, the rest ride in ONE
 *  summary line naming the count (never silently dropped). */
const SLUG_HINT_CAP = 5;

/** Issue #53 Part 1.5: author-time slug-safety notes. A node whose text
 *  contains characters outside the slug-safe set (slugConfusables — the
 *  typographic-dash / zero-width / curly-quote zoo) produces an anchor a
 *  human cannot predict from the prose; the note names the EXACT canonical
 *  anchor (anchorSlug — the same form `cans slug` prints), turning the
 *  broken-ref discovery loop into "you typed it, the tool told you the
 *  anchor". Info level BY DESIGN (the issue: "Not a hard failure — just a
 *  hint"): never an error or warning, so it cannot touch `ok`, exit codes,
 *  `--strict` or the error/warning counts. Real nodes only — synthetic
 *  placeholders (issue #8) carry fixed ASCII parser text, not author
 *  content, and a hint on them would be noise. */
function slugSafetyHints(nodes: OutlineNode[], file: string): Issue[] {
  const flagged: Array<{ text: string; line: number; labels: string }> = [];
  for (const n of realNodes(nodes)) {
    const confusables = slugConfusables(n.text);
    if (confusables.length > 0) {
      flagged.push({ text: n.text, line: n.line, labels: confusables.map(charLabel).join(', ') });
    }
  }
  const issues: Issue[] = [];
  for (const n of flagged.slice(0, SLUG_HINT_CAP)) {
    issues.push({
      file, line: n.line, level: 'info', category: 'refs',
      message: `non-obvious slug: "${n.text}" → #${anchorSlug(n.text)} (contains ${n.labels})`,
      suggestion: 'the anchor above is the exact form see: refs must use — cans slug prints it for any text',
      rule: 'refs.slug.hint', // issue #53 Part 1.5
    });
  }
  if (flagged.length > SLUG_HINT_CAP) {
    issues.push({
      file, line: 0, level: 'info', category: 'refs',
      message: `non-obvious slug: ${flagged.length - SLUG_HINT_CAP} more in ${file} (${flagged.length} total)`,
      suggestion: `cans slug "<node text>" prints the exact anchor for any node — the first ${SLUG_HINT_CAP} in this file are noted above`,
      rule: 'refs.slug.hint', // issue #53 Part 1.5
    });
  }
  return issues;
}

/** Issue #53 (Part 2.4): one anchor repair for `repairAnchors`. `line` is the
 *  ref's 1-based source line, `from` the failing anchor spelling (the parsed
 *  anchor token — exactly what the refs.broken.anchor error names) and `to`
 *  the canonical replacement (`anchorSlug` of the unique near-matching node).
 *  `raw`, when present, is the ref's FULL raw token from the ref graph
 *  (`see: 02-auth.md#Sesions`, §11 verbatim match) and disambiguates lines
 *  holding several see: refs — the parser mints them all, so the rewrite must
 *  hit the RIGHT one, never the first `#from` substring that happens by. */
export interface AnchorRewrite {
  line: number;
  from: string;
  to: string;
  raw?: string;
}

/** Where does the `from` anchor sit inside the `#<anchor>` fragment of the
 *  RIGHT ref on this line? Returns the [start, end) span to substitute, or
 *  null when the ref (or its anchor) cannot be located — the caller skips the
 *  fix rather than rewriting blind. */
function anchorSpan(text: string, f: AnchorRewrite): { start: number; end: number } | null {
  // Preferred path: the ref's raw token pins the exact ref on the line. The
  // raw is the parser's verbatim match, so its anchor portion is `from` plus
  // any trailing prose punctuation the issue #48 strip set removed — only the
  // `from` prefix is replaced; the punctuation belongs to the sentence.
  if (f.raw !== undefined && f.raw !== '') {
    const at = text.indexOf(f.raw);
    if (at >= 0) {
      // The raw is the parser's MAXIMAL [^\s#]+ match, so on the real source
      // line it is always followed by whitespace, another '#' or the line
      // end. A raw that stops MID-token is a caller's stale spelling — fall
      // through to the scan instead of corrupting the longer anchor.
      const after = text.charAt(at + f.raw.length);
      if (after === '' || after === '#' || /\s/.test(after)) {
        const h = f.raw.indexOf('#');
        if (h >= 0 && f.raw.slice(h + 1).startsWith(f.from)) {
          return { start: at + h + 1, end: at + h + 1 + f.from.length };
        }
      }
    }
  }
  // Fallback (raw absent, or not found on the line): the first `#<from>`
  // fragment whose anchor run — the maximal [^\s#]+ span the §11 ref regex
  // would capture — is exactly `from`, or `from` plus a strippable trailing
  // punctuation suffix (same §48 strip set, so `(see x.md#Anchor)` shapes
  // match without eating the paren).
  for (let h = text.indexOf('#'); h >= 0; h = text.indexOf('#', h + 1)) {
    let end = h + 1;
    while (end < text.length && text.charAt(end) !== '#' && !/\s/.test(text.charAt(end))) end++;
    const run = text.slice(h + 1, end);
    if (run === f.from || (run.startsWith(f.from) && REF_TRAILING_PUNCT.test(run.slice(f.from.length)))) {
      return { start: h + 1, end: h + 1 + f.from.length };
    }
  }
  return null;
}

/** Rewrite the anchor segment of see: tokens in one spec file source — the
 *  write half of the issue #53 (Part 2.4) `--fix` anchor-repair transaction.
 *  PURE function over bytes, exactly like `rewriteRefBy`:
 *  - Issue #21 byte preservation: the source is split per line keeping each
 *    line's own terminator, and only a line's TEXT is ever edited — a CRLF
 *    file stays fully CRLF, an LF file stays LF, mixed files stay mixed, and
 *    no line is ever added or dropped.
 *  - Fence safety (issue #6 class): lines inside ``` fences and the fence
 *    markers themselves are never touched. A graph-derived fix always targets
 *    a bullet line OUTSIDE fences (parseOutline mints no refs inside them),
 *    so the guard is pure defense — a fix landing on a fenced line is
 *    skipped, leaving the source byte-identical, rather than corrupting a
 *    fenced example.
 *  - Precision (§11): each fix replaces ONLY the anchor segment of the
 *    matching see: token (located via the ref's raw token when available, see
 *    `anchorSpan`) — the file token, the rest of the line, and any other refs
 *    on the same line survive verbatim.
 *  - Degenerate fixes (empty `from`, `to === from`, out-of-range line, or a
 *    `#from` fragment that is not on the line) are skipped, never errors.
 *  Exported for regression tests (issue #53); behavior lives here. */
export function repairAnchors(source: string, fixes: AnchorRewrite[]): string {
  if (fixes.length === 0) return source;
  const lines = splitSourceLines(source);
  // Fence map, same toggling rule as rewriteRefBy (FENCE_RE on trimmed text).
  let fenceOpen = false;
  const inFence: boolean[] = new Array(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i]!.text.trim())) {
      inFence[i] = true; // the marker line itself is never rewritten
      fenceOpen = !fenceOpen;
      continue;
    }
    inFence[i] = fenceOpen;
  }
  for (const f of fixes) {
    if (f.from === '' || f.from === f.to) continue;
    const idx = f.line - 1;
    if (idx < 0 || idx >= lines.length) continue;
    if (inFence[idx]) continue;
    const span = anchorSpan(lines[idx]!.text, f);
    if (span === null) continue;
    lines[idx]!.text = lines[idx]!.text.slice(0, span.start) + f.to + lines[idx]!.text.slice(span.end);
  }
  return joinSourceLines(lines);
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

  // `let` (not `const`): the --fix --yes anchor repair rewrites referrer
  // sources below and rebuilds both on the post-repair parses, so every later
  // consumer — the back-pointer sweep, the ref-by phase, refs.total — sees the
  // POST-fix state (§35: a --fix report describes the workspace the run
  // leaves behind, not the one it found).
  let allFiles = new Map<string, OutlineNode[]>([...specFiles, ...auxFiles]);
  // §24 (done): the archiving task has already been renamed into _archive/, so
  // its parsed nodes join the graph here under their former _tasks/ identity —
  // its see: refs still earn their targets' ref-by marks.
  if (opts.extraReferrer !== undefined && opts.extraReferrer !== null) {
    allFiles.set(opts.extraReferrer.key, opts.extraReferrer.nodes);
  }
  let graph = buildRefGraph(allFiles, root);

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

  const deepHops = detectDeepHops(graph, rules.references.max_hops, root);

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
    // Issue #53 Part 1.5: author-time slug-safety notes (info level — never
    // counted among errors/warnings, never touching ok/exit codes). Scoped
    // by the [file] filter like every other per-file check (issue #11).
    for (const key of checkable) {
      issues.push(...slugSafetyHints(specFiles.get(key)!, key));
    }
  }

  issues.push(...checkRefs(allFiles, graph, root));
  issues.push(...deepHops);
  if (rules.references.orphan_check) {
    issues.push(...detectOrphans(specFiles, graph));
  }

  // ── issue #53 (Part 2.4): the --fix anchor-repair transaction ──
  // A broken anchor is repaired ONLY when the intended target is unambiguous:
  //   1. the target file exists and is parseable — the same resolution path
  //      checkRefs used (loaded key first, then resolveSpecFile + parse; YAML
  //      mapping keys count as candidates too, issue #49),
  //   2. EXACTLY ONE distinct node/key text fuzzy-matches the failing anchor
  //      at ≥ SLUG_SUGGEST_THRESHOLD — two lookalike siblings stay a plain
  //      error (never a coin flip), while duplicate node texts collapse to
  //      one candidate because they spell the SAME anchor,
  //   3. the change is a pure anchor substitution in the see: token
  //      (repairAnchors) — node text and every other byte survive.
  // Transaction shape: plain --fix PROPOSES in the report only (nothing
  // written; the proposal tells the user to pass --yes — the issue's
  // "print each proposed rewrite first, require --yes to commit"); --fix --yes
  // APPLIES the repairs and then the ref-by phase below runs on the rebuilt
  // graph, so repaired refs earn their marks in the same run; --fix --dry-run
  // previews everything and writes nothing at all. The [file] filter scopes
  // proposals AND writes to the filter-matched referrers (issue #11: a
  // filtered run never mutates a file the user did not name).
  // parseCheckArgs already rejects --yes/--dry-run without --fix and the two
  // together; the modes are re-derived defensively for direct callers (cans
  // done) whose CheckArgs never set them.
  const fixDryRun = opts.fix === true && opts.dryRun === true;
  const applyAnchors = opts.fix === true && opts.yes === true && !fixDryRun;
  const anchorFixes: NonNullable<CheckResult['anchorFixes']> = [];
  if (opts.fix) {
    // Which referrers may be rewritten at all: exactly the ref-by fixable set
    // (spec sources; the [file] filter narrows it). Refs held by _tasks/ or
    // _adr/ files are reported but never rewritten — --fix writes spec files
    // only, today's contract.
    const fixableReferrers = new Set<string>(
      opts.file !== null ? checkable : [...specSources.keys()],
    );
    // Capture the failing (referrer, line, anchor) tuples from the issues
    // list — the same list the report prints — so a repair can never target a
    // ref this run did not flag as refs.broken.anchor.
    const proposed: Array<{ file: string; line: number; from: string; to: string; raw: string }> = [];
    for (const issue of issues) {
      if (issue.rule !== 'refs.broken.anchor') continue;
      const m = issue.message.match(RE_BROKEN_ANCHOR_MSG);
      if (m === null) continue; // defensive: a foreign message shape is never a repair target
      if (!fixableReferrers.has(issue.file)) continue; // issue #11 scoping
      const ref = (graph.forward.get(issue.file) ?? [])
        .find(r => r.line === issue.line && r.anchor === m[2] && r.file === m[1]);
      if (ref === undefined || ref.anchor === null) continue;
      // Condition 1: resolve the target on checkRefs' path — loaded key
      // first (flat/folder spellings via targetMatchesKey), else the file on
      // disk (YAML keys + parsed bullets, issue #49).
      const key = refTargetKey(ref.file, allFiles.keys());
      let candidates: string[] | null = null;
      if (key !== null) {
        const nodes = flattenNodes(allFiles.get(key)!).filter(n => n.synthetic !== true);
        candidates = nodes.map(n => n.text);
      } else {
        const p = resolveSpecFile(root, ref.file);
        if (p !== null) {
          try {
            const text = await readText(p);
            const yamlKeys = /\.(yaml|yml)$/i.test(p) ? extractYamlKeys(text) : [];
            const nodes = flattenNodes(parseOutline(text, p)).filter(n => n.synthetic !== true);
            candidates = [...nodes.map(n => n.text), ...yamlKeys];
          } catch {
            candidates = null; // unparseable target: nothing addressable, nothing to match
          }
        }
      }
      if (candidates === null) continue; // missing/unparseable target → skipped cleanly
      // Condition 2: exactly one distinct fuzzy match ≥ threshold. Distinct
      // TEXTS: two nodes sharing a spelling spell the same anchor, so the
      // rewrite stays uniquely determined; two different spellings are a
      // genuine "which node did you mean" — no repair, no proposal.
      const ranked = nearSlugMatches([...new Set(candidates)], ref.anchor, SLUG_SUGGEST_THRESHOLD);
      if (ranked.length !== 1) continue;
      const to = anchorSlug(ranked[0]!.text);
      // Condition 3: a pure, well-formed anchor substitution.
      if (to === '' || to === ref.anchor) continue; // degenerate — already canonical
      if (/[\s#]/.test(to)) continue; // could never re-parse as one §11 anchor token
      if (!anchorMatches(ranked[0]!.text, to)) continue; // defense: the rewrite must resolve
      proposed.push({ file: issue.file, line: ref.line, from: ref.anchor, to, raw: ref.raw });
    }
    // Deterministic report order (referrer file, then source line) and one
    // entry per distinct rewrite — duplicate see: tokens on one line mint one
    // ref each, but they spell the same fix.
    proposed.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
    const seen = new Set<string>();
    const unique = proposed.filter(p => {
      const k = `${p.file}\0${p.line}\0${p.from}\0${p.to}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const appliedKeys = new Set<string>();
    if (applyAnchors && unique.length > 0) {
      const byFile = new Map<string, Array<{ line: number; from: string; to: string; raw: string }>>();
      for (const p of unique) {
        const list = byFile.get(p.file) ?? [];
        list.push(p);
        byFile.set(p.file, list);
      }
      for (const [rel, fileFixes] of byFile) {
        const source = specSources.get(rel);
        if (source === undefined) continue; // referrer is not a spec source — never written
        const rewritten = repairAnchors(source, fileFixes);
        if (rewritten === source) continue; // fence guard / fragment miss — nothing landed
        await writeText(join(root, rel), rewritten);
        specSources.set(rel, rewritten);
        // Post-repair parse for the graph rebuild below. The rewrite only
        // substitutes an anchor spelling inside an existing see: token (the
        // replacement never contains whitespace — guarded above), so the
        // parse cannot newly fail.
        specFiles.set(rel, parseOutline(rewritten, rel));
        // Per-fix verification: the ref's raw token with its anchor segment
        // swapped must now sit on the target line — a fix the rewriter
        // skipped (fence guard) is reported as a proposal, never as applied.
        const outLines = splitSourceLines(rewritten);
        for (const f of fileFixes) {
          const h = f.raw.indexOf('#');
          if (h < 0) continue;
          const expected = f.raw.slice(0, h + 1) + f.to + f.raw.slice(h + 1 + f.from.length);
          const line = outLines[f.line - 1]?.text ?? '';
          if (line.includes(expected)) appliedKeys.add(`${rel}\0${f.line}\0${f.from}`);
        }
      }
    }
    for (const f of unique) {
      anchorFixes.push({
        file: f.file,
        line: f.line,
        from: f.from,
        to: f.to,
        applied: appliedKeys.has(`${f.file}\0${f.line}\0${f.from}`),
      });
    }
    if (appliedKeys.size > 0) {
      // §35 post-fix state: the applied repairs resolved their refs — drop
      // exactly those refs.broken.anchor issues (skipped fixes keep their
      // errors), so the refs.broken counter and the exit code below reflect
      // the workspace the run leaves behind.
      for (let i = issues.length - 1; i >= 0; i--) {
        const iss = issues[i]!;
        if (iss.rule !== 'refs.broken.anchor') continue;
        const m = iss.message.match(RE_BROKEN_ANCHOR_MSG);
        if (m === null) continue;
        if (appliedKeys.has(`${iss.file}\0${iss.line}\0${m[2]}`)) issues.splice(i, 1);
      }
      // Rebuild the graph on the post-repair parses BEFORE the back-pointer
      // sweep and the ref-by phase, so the whole rest of the run is coherent:
      // repaired refs are no longer broken (they earn ref-by marks in this
      // same run) and pre-existing comments they satisfy read as current.
      allFiles = new Map<string, OutlineNode[]>([...specFiles, ...auxFiles]);
      if (opts.extraReferrer !== undefined && opts.extraReferrer !== null) {
        allFiles.set(opts.extraReferrer.key, opts.extraReferrer.nodes);
      }
      graph = buildRefGraph(allFiles, root);
    }
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
  // Issue #53 (Part 2.4): --fix --dry-run writes NOTHING here either — the
  // would-be ref-by rewrites are recorded in backPointersUpdated* and rendered
  // as `--fix would rewrite ref-by in: ...`; the result's dryRun: true marks
  // the whole report as a preview. When --yes applied anchor repairs above,
  // this phase already runs on the rebuilt (post-repair) graph, so repaired
  // refs earn their marks in the same run.
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
        if (fixDryRun) {
          // issue #53: preview only — no byte changes. The would-be file list
          // rides backPointersUpdated* (the human printer renders the
          // "would rewrite" wording when dryRun is set).
          backPointersUpdated++;
          backPointersUpdatedFiles.push(rel);
          continue;
        }
        await writeText(join(root, rel), rewritten);
        specSources.set(rel, rewritten);
        backPointersUpdated++;
        backPointersUpdatedFiles.push(rel);
      }
    }

    if (!fixDryRun) {
      // §35 check-fix.json reports the POST-fix state: recompute back-pointer
      // counts from the rewritten sources and drop now-fixed stale issues.
      // Issue #11: only a file the run ACTUALLY rewrote can have its stale
      // warnings dropped — files outside a [file] filter keep theirs (the
      // comment is still on disk, so it is still stale). A --dry-run run
      // wrote nothing, so every stale warning stays (and the counts above,
      // computed before any write, already describe the on-disk truth).
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
  // Issue #53 Part 1.5: info is its own band — counted and reported, but
  // deliberately outside every decision above and below (ok / exitCode /
  // --strict read errorCount/warningCount only).
  const infoCount = issues.filter(i => i.level === 'info').length;
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
    infoCount,
    backPointersUpdated,
    // Issue #11: the report names the files --fix actually rewrote (sorted,
    // spec-relative). Empty without --fix or when nothing needed a write;
    // with a [file] filter only matching files can ever appear here.
    backPointersUpdatedFiles: [...backPointersUpdatedFiles].sort(),
    // issue #53 (Part 2.4): the anchor-repair transaction report — present
    // only on --fix runs. Proposals (plain --fix, --dry-run) carry
    // applied:false; a --yes run's landed rewrites carry applied:true.
    // Absent on plain checks (additive-only JSON, §35).
    ...(opts.fix ? { anchorFixes } : {}),
    // issue #53 (Part 2.4): --dry-run preview marker. When true,
    // backPointersUpdated* and anchorFixes describe WOULD-BE writes and no
    // byte changed on disk.
    ...(fixDryRun ? { dryRun: true } : {}),
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
