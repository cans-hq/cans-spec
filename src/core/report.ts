/** Pure issue-aggregation core for `cans check` (issue #41).
 *
 *  Turns the raw issue list into pattern groups: one group per root cause,
 *  compact per-file locations (`action:30,111,143`), count prefixes for the
 *  human printer (`61× <min children (2/3)`), ranked sub-items (missing
 *  targets, keywords, overlap pairs, referrers), a fix hint once per group,
 *  and the lossless `--json` wire shape.
 *
 *  FULLY STANDALONE: zero imports — not even from src/types.ts. IssueLike is
 *  structurally compatible with src/types.ts Issue (which gains an optional
 *  machine-readable `rule` at integration). Every known engine message format
 *  has a normalizer, so the module behaves identically with and without
 *  `rule` annotations — the rule path and the fallback path MUST agree
 *  (test/report.test.ts pins this on a full mixed scenario).
 *
 *  Design decisions pinned here (integration agents read this):
 *  - Group key = `rule + '|' + (key ?? pattern)`. Threshold-family rules
 *    (siblings/depth/node-length/tbd.max/collapse/parse.indent)
 *    encode the observed ratio IN the pattern, so `<min children (2/3)` and
 *    `<min children (1/3)` are distinct patterns; identity-family rules
 *    (missing file, stale target, keyword, overlap class, duplicate-home
 *    concept, prefix word, malformed dir) use a stable pattern plus a `key`
 *    carrying the root-cause identity.
 *  - Group ordering: section (structure → style → refs → redundancy →
 *    config → parse → content → io → other), then count desc, then
 *    first occurrence in the input. Nothing is dropped: every input issue
 *    raises its group's count exactly once. ('config', issue #43, sits after
 *    the engines: a config error preempts every check, and its group only
 *    ever exists alone on the checkFail path.)
 *  - `category` on a group is the SECTION (rule prefix wins over the engine
 *    category — e.g. content.tbd.* lands under `content`).
 *  - `level` is the first member's level; sections count errors/warnings
 *    (and, since issue #53 Part 1.5, info — its own bucket, never folded
 *    into the other two) from the raw issues, so a hypothetically mixed
 *    group never skews them.
 *  - topGroups: `folded` is the number of issue OCCURRENCES hidden in the
 *    tail groups (the "…and K more" line), not the group count.
 *  - Engine message formats with no id in the rule vocabulary (transient
 *    refs, _collab/ refs, possible typos) fall through to `<category>.other`
 *    (typos get the local extension `redundancy.typo` so they still group).
 */

// issue #41: contract types — the human printer and the JSON emitter build on these.
export interface IssueLike {
  file: string;
  line: number;
  /** Issue #53 Part 1.5: 'info' is the author-time hint band — grouped and
   *  counted (SectionReport.infoCount) but deliberately excluded from
   *  errorCount/warningCount, exit codes and `ok`. */
  level: 'error' | 'warning' | 'info';
  category: string;
  message: string;
  suggestion?: string;
  rule?: string;
}

export interface GroupItem {
  label: string;
  count: number;
  locations?: string[];
  /** issue #41 integration: semantic size when the message carries one —
   *  keyword sprawl's node count (`"artifacts" × 105 nodes` → 105). Ranking
   *  and display use the metric; `count` stays the raw occurrence count. */
  metric?: number;
  /** issue #53 Part 1.3: per-item fix hint. refs.broken.anchor items carry
   *  each ref's own did-you-mean — the group-level suggestion is first-non-
   *  empty only, so a multi-anchor group would otherwise hide the other
   *  refs' advice from the expanded `--show refs` view. */
  suggestion?: string;
}

export interface IssueGroup {
  /** Section: structure|style|refs|redundancy|config|parse|content|io|other */
  category: string;
  /** Normalized rule id (issue.rule when present, else derived from the message). */
  rule: string;
  /** One-line pattern label, e.g. `<min children (2/3)` or `missing file`. */
  pattern: string;
  /** Occurrences. */
  count: number;
  /** Issue #53 Part 1.5: first member's level — 'info' groups (refs.slug.hint)
   *  render with the ℹ mark and never touch section error/warning counts. */
  level: 'error' | 'warning' | 'info';
  /** Compact per-file strings `action:30,111,143` (dedup, stable order). */
  locations: string[];
  /** Metric-ranked sub-items (keywords, missing targets, overlap pairs, …). */
  items?: GroupItem[];
  /** Representative detail, e.g. `budget.md:148 → interface.md#Refusals`. */
  detail?: string;
  /** Fix hint — once per group (first non-empty among members). */
  suggestion?: string;
  /** Extracted root-cause key (missing target path, keyword, pair, …). */
  key?: string;
}

export interface SectionReport {
  name: string;
  errorCount: number;
  warningCount: number;
  /** Issue #53 Part 1.5: level:'info' occurrences in the section (author-
   *  time hints). Counted SEPARATELY — never folded into errorCount or
   *  warningCount, never affecting exit codes or `ok`. */
  infoCount: number;
  groups: IssueGroup[];
}

export interface CheckReport {
  /** Every group, ordered by section → count desc → first occurrence. */
  groups: IssueGroup[];
  sections: Record<string, SectionReport>;
}

/** Structural subset of CheckResult needed for the --json wire shape. */
export interface CheckResultLike {
  ok: boolean;
  exitCode: number;
  files: number;
  nodes: number;
  maxDepth: number;
  elapsedMs?: number;
  refs: {
    total: number;
    broken: number;
    deepHops: number;
    /** issue #59: refs.slug.hint items the workspace holds — the opt-in
     *  discoverability signal. Present only when > 0 (additive wire). */
    hintCount?: number;
  };
  backPointers: { total: number; current: number; stale: number };
  errorCount: number;
  warningCount: number;
  backPointersUpdated: number;
  /** Issue #11: sorted spec-relative paths of the files --fix actually
   *  rewrote (empty without --fix or when nothing needed a write). */
  backPointersUpdatedFiles: string[];
  /** issue #53 (Part 2.4): the --fix anchor-repair transaction's items
   *  ({file, line, from, to, applied}) — proposals applied:false, --yes
   *  rewrites applied:true. Optional and additive: plain checks omit it. */
  anchorFixes?: Array<{ file: string; line: number; from: string; to: string; applied: boolean }>;
  /** issue #53 (Part 2.4): true when --fix --dry-run previewed the run —
   *  the backPointersUpdated* fields and anchorFixes then describe WOULD-BE
   *  writes. */
  dryRun?: boolean;
  rulesSummary?: string;
  issues: IssueLike[];
  /** checkFail diagnosis (usage / no-workspace / invalid rules) — carried
   *  through the wire shape so agents get the real cause, not just exit 2. */
  error?: string;
}

// ── Section/rule vocabulary ──

const SECTION_ORDER = ['structure', 'style', 'refs', 'redundancy', 'config', 'parse', 'content', 'io', 'other'];
// issue #43: 'config' joins the rule prefixes and the section order (after
// the engines, before the meta sections) so a config.invalid group lands in
// its own section on both the rule path and the message-derived fallback
// path. It is NOT an engine category: ENGINE_CATEGORIES stays untouched so
// unknown rules never re-route, and checkReportJson buckets 'config'
// explicitly (additively — see below).
const KNOWN_RULE_PREFIXES = new Set(['structure', 'style', 'refs', 'redundancy', 'config', 'content', 'parse', 'io']);
const ENGINE_CATEGORIES = new Set(['structure', 'style', 'refs', 'redundancy']);

function sectionFor(rule: string, category: string): string {
  const dot = rule.indexOf('.');
  const prefix = dot === -1 ? rule : rule.slice(0, dot);
  if (KNOWN_RULE_PREFIXES.has(prefix)) return prefix;
  if (ENGINE_CATEGORIES.has(category)) return category;
  return 'other';
}

// ── Message normalizers (one per engine emission format) ──

const RE_BROKEN_FILE = /^broken ref: see (\S+) — file not found$/;
// Issue #55: external-root pointer verdicts — same refs.broken.file family
// (they count in the refs.broken JSON counter, check.ts), keyed by the full
// pointer so the missing-file block lists them as targets.
const RE_EXT_UNDECLARED = /^broken ref: see (\S+) — undeclared external root '(\S+)'$/;
const RE_EXT_ESCAPE = /^broken ref: see (\S+) — target escapes external root '(\S+)'$/;
const RE_EXT_MISSING = /^broken ref: see (\S+) — file not found under external root '(\S+)'$/;
const RE_EXT_ABSENT = /^external root '(\S+)' is not checked out \(\S+ from the project root\) — pointers into it are not verified$/;
const RE_BROKEN_ANCHOR = /^broken anchor: (\S+)#(\S+) — no node matches$/;
// Issue #49: zero-addressable-target downgrade (prose .md, empty yaml) —
// same <file>#<anchor> shape as RE_BROKEN_ANCHOR, advisory severity.
const RE_ANCHOR_NO_TARGET = /^anchor on non-outline target: (\S+)#(\S+) — target has no addressable nodes \(bullets or YAML keys\); use a file-level ref$/;
// Issue #58: the schematic-anchor errors (JSON/YAML/TOML targets). Both are
// error-level refs findings — grouped per pointer target like the no-target
// advisory, so several anchors on the same broken/ambiguous file stay
// addressable in the report.
const RE_ANCHOR_AMBIGUOUS = /^ambiguous anchor: (\S+)#(\S+) — flat name matches multiple leaves: (.+)$/;
const RE_ANCHOR_PARSE_ERROR = /^schematic parse error: (\S+)#(\S+) — (?:JSON|YAML|TOML) line \d+: /;
// Issue #53 Part 1.5: info-level slug-safety notes — one per confusable node
// (first SLUG_HINT_CAP per file) plus one per-file cap summary line. Greedy
// first group: a node text containing `"` still matches (backtracking lands
// on the LAST `" → #` — the message's own shape).
const RE_SLUG_HINT = /^non-obvious slug: "(.*)" → #(.+) \(contains (.+)\)$/;
const RE_SLUG_HINT_MORE = /^non-obvious slug: (\d+) more in (\S+) \((\d+) total\)$/;
const RE_STALE_BP = /^stale back-pointer: (\S+) no longer refs (\S+)$/;
const RE_SELF = /^self-reference: (\S+) → (\S+)$/;
const RE_ORPHAN = /^orphan: (\S+) has no incoming or outgoing refs$/;
const RE_DEEP_HOP = /^DEEP HOP: (.+)$/;
const RE_PROSE = /^see-like prose: "see (\S+)" did not resolve to a spec file/;
// Issue #57: the alias-layer message families — grouped per alias name (or
// the quoted spelling) so a definitions block with N problems reads as N
// items under one line, like every other refs family.
const RE_ALIAS_DISABLED = /^aliasing is disabled: "(.*)" — references\.aliasing\.enabled is false$/;
const RE_ALIAS_UNDEFINED = /^undefined alias: see \[(\S+)\] — not defined in this file$/;
const RE_ALIAS_STYLE = /^alias style violation: "\[(\S+)\]" is (?:named|numeric), but references\.aliasing\.style is "(?:numeric|named)"$/;
const RE_ALIAS_BAD_USE = /^alias use carries an anchor: "(.*)" — /;
const RE_ALIAS_UNUSED = /^unused alias: \[(\S+)\] \(line \d+\) is never used$/;
const RE_ALIAS_MIN_USES = /^alias below min_uses: \[(\S+)\] → (\S+) used \d+ times?, but references\.aliasing\.min_uses is \d+ — /;
const RE_ALIAS_DUP = /^duplicate alias definition: \[(\S+)\] — already defined at line \d+$/;
const RE_ALIAS_BAD_TARGET = /^alias definition targets an alias: "(.*)" — definitions must hold the full pointer$/;
const RE_ALIAS_BAD_NAME = /^invalid alias name: "(.*)" — alias names are /;
const RE_KEYWORD = /^"([^"]+)" × (\d+) nodes \(threshold: (\d+)\)$/;
const RE_OVERLAP = /^(\d+)% overlap: (\S+) ↔ (\S+)$/;
const RE_TYPO = /^possible typo: "([^"]+)" \(([^)]*)\) ↔ "([^"]+)" \(([^)]*)\) — Levenshtein (\d+)$/;
const RE_DUP_HOME_RED = /^"([^"]+)" at depth 0-1 in (\d+)\+ files without see: \(([^)]*)\)$/;
const RE_SIBLINGS = /^".*" has (\d+) children \((min|max) (\d+)\)\.?$/;
const RE_DEPTH_MIN = /^Max depth (\d+) is below min (\d+)\b/;
const RE_DEPTH_MAX = /^Depth (\d+) exceeds max (\d+)\b/;
const RE_NODE_LONG = /^Node too long \((\d+) > (\d+)\)/;
const RE_NODE_SHORT = /^Node too short \((\d+) < (\d+)\)/;
const RE_EMPTY_NODE = /^Empty node\.?$/;
const RE_SINGLE_CHILD = /^".*" has exactly 1 child\. Collapse\.$/;
const RE_MALFORMED = /^malformed workspace entry: directory "([^"]+)" looks like a spec file/;
const RE_DUP_HOME = /^duplicate home: both (\S+) and (\S+) exist/;
const RE_SHARED_PREFIX = /^(\d+) siblings share prefix "([^"]+)"/;
const RE_COLLAPSE = /^".*" has (\d+) child(?:ren)?\. Collapse to sibling style\.$/;
const RE_TBD_MAX = /^(\d+) TBD nodes exceed content\.max_tbd_per_file \((\d+)\)$/;
const RE_TBD_DISALLOWED = /^TBD used but content\.tbd_allowed is false$/;
const RE_UNREADABLE = /^unreadable spec file: /;
const RE_PARSE_ERROR = /^parse error: /;
const RE_PARSE_INDENT = /^odd indentation \((\d+) spaces?\) —/;
// issue #43: checkFail/configFail diagnosis for an unparsable _rules.yaml —
// the message the invalid-rules catch wraps as `invalid _rules.yaml: <cause>`.
const RE_INVALID_RULES = /^invalid _rules\.yaml: /;

interface Normalized {
  rule: string;
  pattern: string;
  key?: string;
  detail?: string;
  /** Per-member item (merged by label across the group). */
  item?: { label: string; sort: number; metric?: number; suggestion?: string };
  /** How the merged items are ranked: by item count, by metric, or input order. */
  itemSort?: 'count' | 'pct' | 'metric' | 'appearance';
  /** refs.broken.file: single item {label: key, count: group count} at finalize. */
  targetItem?: boolean;
}

function stripMd(file: string): string {
  return file.endsWith('.md') ? file.slice(0, -3) : file;
}

/** issue #41: unknown message shapes → first 40 chars with quoted strings
 *  removed and digit runs replaced by '#' (stable shape, no leaking values). */
function genericPattern(message: string): string {
  const stripped = message
    .replace(/"[^"]*"/g, '')
    .replace(/'[^']*'/g, '')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length > 0 ? stripped.slice(0, 40) : '(unrecognized)';
}

function normalizeMessage(issue: IssueLike): Normalized {
  const m = issue.message;
  let mt: RegExpMatchArray | null;

  // ── refs ──
  if ((mt = m.match(RE_BROKEN_FILE)) !== null) {
    // issue #41: group per missing target — pattern generic, key = target path.
    return { rule: 'refs.broken.file', pattern: 'missing file', key: mt[1]!, targetItem: true };
  }
  if ((mt = m.match(RE_EXT_UNDECLARED)) !== null) {
    // issue #55: name:// pointer whose root is not in references.external_roots.
    return { rule: 'refs.broken.file', pattern: 'undeclared external root', key: mt[1]!, targetItem: true };
  }
  if ((mt = m.match(RE_EXT_ESCAPE)) !== null) {
    // issue #55: sub-path escaped the declared root (traversal or symlink).
    return { rule: 'refs.broken.file', pattern: 'escapes external root', key: mt[1]!, targetItem: true };
  }
  if ((mt = m.match(RE_EXT_MISSING)) !== null) {
    // issue #55: declared, present root — the pointed-at file is not there.
    return { rule: 'refs.broken.file', pattern: 'missing file', key: mt[1]!, targetItem: true };
  }
  if ((mt = m.match(RE_EXT_ABSENT)) !== null) {
    // issue #55: declared root not checked out — pointers unverified, one
    // warning per root per run.
    return { rule: 'refs.external.absent', pattern: 'external root absent', key: mt[1]! };
  }
  if ((mt = m.match(RE_BROKEN_ANCHOR)) !== null) {
    const detail = `${issue.file}:${issue.line} → ${mt[1]}#${mt[2]}`;
    return {
      rule: 'refs.broken.anchor',
      pattern: 'broken anchor',
      detail,
      // issue #53 Part 1.3: each member's own fix (did-you-mean with the
      // canonical slug, or add-node advice) rides on its item — the group
      // hint stays first-non-empty as before.
      item: {
        label: detail,
        sort: 0,
        ...(issue.suggestion !== undefined && issue.suggestion !== '' ? { suggestion: issue.suggestion } : {}),
      },
    };
  }
  if ((mt = m.match(RE_ANCHOR_NO_TARGET)) !== null) {
    // Issue #49: anchored ref to a target with nothing addressable — advisory
    // downgrade, grouped per file#anchor target like the other ref families.
    return { rule: 'refs.anchor.no-target', pattern: 'anchor on non-outline target', key: `${mt[1]}#${mt[2]}` };
  }
  if ((mt = m.match(RE_ANCHOR_AMBIGUOUS)) !== null) {
    // Issue #58 contract 3: a flat single-segment anchor matching multiple
    // leaves — error listing the full paths (the group key keeps the target;
    // the message already carries the path list verbatim).
    return { rule: 'refs.anchor.ambiguous', pattern: 'ambiguous anchor', key: `${mt[1]}#${mt[2]}` };
  }
  if ((mt = m.match(RE_ANCHOR_PARSE_ERROR)) !== null) {
    // Issue #58 contract 5: the pointed-at schematic file could not be parsed
    // (malformed or beyond the supported subset) — an explicit error at the
    // pointer site, never a silent pass or a broken-anchor false positive.
    return { rule: 'refs.anchor.parse-error', pattern: 'schematic parse error', key: `${mt[1]}#${mt[2]}` };
  }
  if ((mt = m.match(RE_SLUG_HINT)) !== null) {
    // Issue #53 Part 1.5: info-level slug-safety note. All notes (per-node
    // + per-file cap summaries) share ONE group — the items are the
    // self-contained `file:line — "text" → #slug` pairs, because the note's
    // whole value is naming the anchor.
    return {
      rule: 'refs.slug.hint',
      pattern: 'non-obvious slug',
      item: { label: `${issue.file}:${issue.line} — "${mt[1]}" → #${mt[2]}`, sort: 0 },
    };
  }
  if ((mt = m.match(RE_SLUG_HINT_MORE)) !== null) {
    // Issue #53 Part 1.5: the per-file cap summary rides in the same group
    // as its file's notes (appearance order keeps it after them).
    return {
      rule: 'refs.slug.hint',
      pattern: 'non-obvious slug',
      item: { label: `${mt[2]}: +${mt[1]} more (${mt[3]} total)`, sort: 0 },
    };
  }
  if ((mt = m.match(RE_STALE_BP)) !== null) {
    // One group per stale target; items = referrer basenames, ranked by count.
    return {
      rule: 'refs.backpointer.stale',
      pattern: 'stale back-pointer',
      key: mt[2]!,
      item: { label: stripMd(mt[1]!), sort: 0 },
      itemSort: 'count',
    };
  }
  if ((mt = m.match(RE_SELF)) !== null) {
    return { rule: 'refs.self', pattern: 'self reference' };
  }
  if ((mt = m.match(RE_ORPHAN)) !== null) {
    return { rule: 'refs.orphan', pattern: 'orphan file' };
  }
  if ((mt = m.match(RE_DEEP_HOP)) !== null) {
    return { rule: 'refs.deep_hop', pattern: 'deep hop chain', detail: mt[1]! };
  }
  if ((mt = m.match(RE_PROSE)) !== null) {
    // Main's see-like-prose finding (advisory rephrase hint) — per-target group.
    return { rule: 'refs.prose', pattern: 'see-like prose', key: mt[1]!, detail: m };
  }

  // ── refs: the issue #57 alias families ──
  if ((mt = m.match(RE_ALIAS_DISABLED)) !== null) {
    return { rule: 'refs.alias.disabled', pattern: 'aliasing disabled', key: mt[1]! };
  }
  if ((mt = m.match(RE_ALIAS_UNDEFINED)) !== null) {
    return { rule: 'refs.alias.undefined', pattern: 'undefined alias', key: mt[1]! };
  }
  if ((mt = m.match(RE_ALIAS_STYLE)) !== null) {
    return { rule: 'refs.alias.style', pattern: 'alias style violation', key: mt[1]! };
  }
  if ((mt = m.match(RE_ALIAS_BAD_USE)) !== null) {
    return { rule: 'refs.alias.bad-use', pattern: 'alias use with anchor', key: mt[1]! };
  }
  if ((mt = m.match(RE_ALIAS_UNUSED)) !== null) {
    return { rule: 'refs.alias.unused', pattern: 'unused alias', key: mt[1]! };
  }
  if ((mt = m.match(RE_ALIAS_MIN_USES)) !== null) {
    return { rule: 'refs.alias.min_uses', pattern: 'alias below min_uses', key: mt[1]!, detail: m };
  }
  if ((mt = m.match(RE_ALIAS_DUP)) !== null) {
    return { rule: 'refs.alias.duplicate', pattern: 'duplicate alias definition', key: mt[1]! };
  }
  if ((mt = m.match(RE_ALIAS_BAD_TARGET)) !== null) {
    return { rule: 'refs.alias.bad-target', pattern: 'alias targeting an alias', key: mt[1]! };
  }
  if ((mt = m.match(RE_ALIAS_BAD_NAME)) !== null) {
    return { rule: 'refs.alias.bad-name', pattern: 'invalid alias name', key: mt[1]! };
  }

  // ── redundancy ──
  if ((mt = m.match(RE_KEYWORD)) !== null) {
    // issue #41: ONE group — items = keywords ranked by NODE count desc (the
    // message's ×N), so the engine's one-issue-per-keyword shape renders
    // `artifacts:105  db:74 …` exactly as the issue specifies.
    return {
      rule: 'redundancy.keyword',
      pattern: 'keyword sprawl',
      item: { label: mt[1]!, sort: 0, metric: Number(mt[2]) },
      itemSort: 'metric',
    };
  }
  if ((mt = m.match(RE_OVERLAP)) !== null) {
    const pct = Number(mt[1]);
    if (pct >= 100) {
      return { rule: 'redundancy.overlap.exact', pattern: 'exact overlap (100%)', item: { label: `${mt[2]} ↔ ${mt[3]}`, sort: 0 } };
    }
    return {
      rule: 'redundancy.overlap.fuzzy',
      pattern: 'fuzzy overlap (<100%)',
      item: { label: `${mt[2]} ↔ ${mt[3]} (${pct}%)`, sort: pct },
      itemSort: 'pct',
    };
  }
  if ((mt = m.match(RE_TYPO)) !== null) {
    // Not in the rule vocabulary — local extension so typos still group.
    return { rule: 'redundancy.typo', pattern: 'possible typo', item: { label: `"${mt[1]}" ↔ "${mt[3]}"`, sort: 0 } };
  }
  if ((mt = m.match(RE_DUP_HOME_RED)) !== null) {
    return { rule: 'redundancy.duplicate_home', pattern: 'duplicate home', key: mt[1]!, detail: m };
  }

  // ── structure ──
  if ((mt = m.match(RE_SIBLINGS)) !== null) {
    const isMin = mt[2] === 'min';
    return {
      rule: isMin ? 'structure.siblings.min' : 'structure.siblings.max',
      // issue #41: quoted node title dropped, ratio kept — `<min children (2/3)`.
      pattern: isMin ? `<min children (${mt[1]}/${mt[3]})` : `>max children (${mt[1]}/${mt[3]})`,
    };
  }
  if ((mt = m.match(RE_DEPTH_MIN)) !== null) {
    return { rule: 'structure.depth.min', pattern: `depth <min (${mt[1]}/${mt[2]})` };
  }
  if ((mt = m.match(RE_DEPTH_MAX)) !== null) {
    return { rule: 'structure.depth.max', pattern: `depth >max (${mt[1]}/${mt[2]})` };
  }
  if ((mt = m.match(RE_NODE_LONG)) !== null) {
    return { rule: 'structure.node_length.max', pattern: `node chars >max (${mt[1]}/${mt[2]})` };
  }
  if ((mt = m.match(RE_NODE_SHORT)) !== null) {
    return { rule: 'structure.node_length.min', pattern: `node chars <min (${mt[1]}/${mt[2]})` };
  }
  if (RE_EMPTY_NODE.test(m)) {
    return { rule: 'structure.empty_node', pattern: 'empty node' };
  }
  if (RE_SINGLE_CHILD.test(m)) {
    return { rule: 'structure.single_child', pattern: 'single child (collapse)' };
  }
  if ((mt = m.match(RE_MALFORMED)) !== null) {
    return { rule: 'structure.malformed_dir', pattern: 'malformed dir', key: mt[1]! };
  }
  if ((mt = m.match(RE_DUP_HOME)) !== null) {
    return { rule: 'structure.duplicate_home', pattern: 'duplicate home', key: `${mt[1]}|${mt[2]}` };
  }

  // ── style ──
  if ((mt = m.match(RE_SHARED_PREFIX)) !== null) {
    // Per-word groups: the fix (group under a nested style) differs per prefix.
    return { rule: 'style.prefix.shared', pattern: `shared prefix "${mt[2]}"`, key: `prefix:${mt[2]}` };
  }
  if ((mt = m.match(RE_COLLAPSE)) !== null) {
    return { rule: 'style.nesting.prefer', pattern: `collapse to sibling (${mt[1]})` };
  }

  // ── content ──
  if ((mt = m.match(RE_TBD_MAX)) !== null) {
    return { rule: 'content.tbd.max', pattern: `tbd nodes >max (${mt[1]}/${mt[2]})` };
  }
  if (RE_TBD_DISALLOWED.test(m)) {
    return { rule: 'content.tbd.disallowed', pattern: 'tbd disallowed' };
  }

  // ── io / parse ──
  if (RE_UNREADABLE.test(m)) {
    return { rule: 'io.unreadable', pattern: 'unreadable file', detail: m };
  }
  if (RE_PARSE_ERROR.test(m)) {
    return { rule: 'parse.error', pattern: 'parse error', detail: m };
  }
  if ((mt = m.match(RE_PARSE_INDENT)) !== null) {
    const n = Number(mt[1]);
    return { rule: 'parse.indent', pattern: `odd indentation (${n} ${n === 1 ? 'space' : 'spaces'})` };
  }

  // ── config ──
  // issue #43: an invalid _rules.yaml is a config error, never a refs
  // finding. The engine (configFail in check.ts) always sets rule
  // 'config.invalid' explicitly; this branch keeps the no-rule fallback
  // path in agreement (report.ts discipline: both paths MUST agree).
  if (RE_INVALID_RULES.test(m)) {
    return { rule: 'config.invalid', pattern: 'invalid _rules.yaml', detail: m };
  }

  // issue #41: fallback — unknown shapes must still group, never be dropped.
  return { rule: `${issue.category}.other`, pattern: genericPattern(m) };
}

// ── Public API ──

/** issue #41: compact per-file locations — `action:30,111,143`. Lines are
 *  deduped and sorted numerically; the `.md` extension is stripped only when
 *  lines are listed (a line-0/absent entry renders as the bare `file.md`).
 *  Empty file names (check-level failures) produce no location string. */
export function formatLocations(entries: Array<{ file: string; line: number }>): string[] {
  const perFile = new Map<string, number[]>();
  const seen = new Set<string>();
  for (const e of entries) {
    if (e.file === '') continue;
    const k = `${e.file}\u0000${e.line}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const lines = perFile.get(e.file);
    if (lines === undefined) perFile.set(e.file, [e.line]);
    else lines.push(e.line);
  }
  const out: string[] = [];
  for (const [file, lines] of perFile) {
    const nonZero = lines.filter((l) => l > 0).sort((a, b) => a - b);
    if (nonZero.length === 0) {
      out.push(file); // line 0 / absent → bare path, extension kept
    } else {
      out.push(`${stripMd(file)}:${nonZero.join(',')}`);
    }
  }
  return out;
}

interface Acc {
  group: IssueGroup;
  firstIndex: number;
  entries: Array<{ file: string; line: number }>;
  seenLoc: Set<string>;
  itemMap: Map<string, { label: string; count: number; sort: number; order: number; locations: string[]; metric?: number; suggestion?: string }> | null;
  itemSort: 'count' | 'pct' | 'metric' | 'appearance';
  wantsTargetItem: boolean;
}

function finalizeGroup(acc: Acc): IssueGroup {
  const group = acc.group;
  group.locations = formatLocations(acc.entries);
  if (acc.itemMap !== null && acc.itemMap.size > 0) {
    const items = [...acc.itemMap.values()];
    if (acc.itemSort === 'count') items.sort((a, b) => b.count - a.count || a.order - b.order);
    else if (acc.itemSort === 'pct') items.sort((a, b) => b.sort - a.sort || a.order - b.order);
    else if (acc.itemSort === 'metric') items.sort((a, b) => (b.metric ?? 0) - (a.metric ?? 0) || b.count - a.count || a.order - b.order);
    else items.sort((a, b) => a.order - b.order);
    group.items = items.map((it) => ({
      label: it.label,
      count: it.count,
      ...(it.metric !== undefined ? { metric: it.metric } : {}),
      ...(it.locations.length > 0 ? { locations: it.locations } : {}),
      ...(it.suggestion !== undefined ? { suggestion: it.suggestion } : {}),
    }));
  } else if (acc.wantsTargetItem && group.key !== undefined) {
    // issue #41: missing-target groups show the target as their single item.
    group.items = [{ label: group.key, count: group.count }];
  }
  return group;
}

/** issue #41: the pure aggregation core. Groups every issue by
 *  `rule + '|' + (key ?? pattern)`, orders by section → count desc → first
 *  occurrence, and never drops an issue. With `opts.topN`, each section's
 *  groups are folded to the top N (the flat `groups` array always stays
 *  complete — nothing is dropped silently). */
export function buildReport(issues: IssueLike[], opts?: { topN?: number }): CheckReport {
  const byKey = new Map<string, Acc>();
  const sectionCounts = new Map<string, { errorCount: number; warningCount: number; infoCount: number }>();

  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i]!;
    const norm = normalizeMessage(issue);
    const rule = issue.rule ?? norm.rule; // issue #41: explicit rule wins, fallback agrees
    const section = sectionFor(rule, issue.category);

    const counts = sectionCounts.get(section) ?? { errorCount: 0, warningCount: 0, infoCount: 0 };
    // Issue #53 Part 1.5: info is its OWN bucket — an else-if chain (not the
    // old error/else binary) so a hint can never leak into warningCount.
    if (issue.level === 'error') counts.errorCount++;
    else if (issue.level === 'warning') counts.warningCount++;
    else counts.infoCount++;
    sectionCounts.set(section, counts);

    const gkey = `${rule}|${norm.key ?? norm.pattern}`;
    let acc = byKey.get(gkey);
    if (acc === undefined) {
      const group: IssueGroup = {
        category: section,
        rule,
        pattern: norm.pattern,
        count: 0,
        level: issue.level, // first member's level
        locations: [],
      };
      if (norm.key !== undefined) group.key = norm.key;
      acc = {
        group,
        firstIndex: i,
        entries: [],
        seenLoc: new Set(),
        itemMap: norm.item !== undefined || norm.targetItem === true ? new Map() : null,
        itemSort: norm.itemSort ?? 'appearance',
        wantsTargetItem: norm.targetItem === true,
      };
      byKey.set(gkey, acc);
    }
    acc.group.count++;
    if (acc.group.detail === undefined && norm.detail !== undefined) acc.group.detail = norm.detail;
    if (acc.group.suggestion === undefined && issue.suggestion !== undefined && issue.suggestion !== '') {
      acc.group.suggestion = issue.suggestion; // fix hint once per group
    }
    if (issue.file !== '') {
      const locKey = `${issue.file}\u0000${issue.line}`;
      if (!acc.seenLoc.has(locKey)) {
        acc.seenLoc.add(locKey);
        acc.entries.push({ file: issue.file, line: issue.line });
      }
    }
    if (norm.item !== undefined && acc.itemMap !== null) {
      const entry = acc.itemMap.get(norm.item.label) ?? {
        label: norm.item.label,
        count: 0,
        sort: norm.item.sort,
        order: acc.itemMap.size,
        locations: [],
        ...(norm.item.metric !== undefined ? { metric: norm.item.metric } : {}),
        ...(norm.item.suggestion !== undefined ? { suggestion: norm.item.suggestion } : {}),
      };
      entry.count++;
      if (issue.file !== '') {
        entry.locations.push(formatLocations([{ file: issue.file, line: issue.line }])[0]!);
      }
      acc.itemMap.set(norm.item.label, entry);
    }
  }

  const groups = [...byKey.values()]
    .sort((a, b) => {
      const sa = SECTION_ORDER.indexOf(a.group.category);
      const sb = SECTION_ORDER.indexOf(b.group.category);
      if (sa !== sb) return sa - sb;
      if (b.group.count !== a.group.count) return b.group.count - a.group.count;
      return a.firstIndex - b.firstIndex;
    })
    .map(finalizeGroup);

  const sections: Record<string, SectionReport> = {};
  for (const group of groups) {
    let s = sections[group.category];
    if (s === undefined) {
      s = { name: group.category, errorCount: 0, warningCount: 0, infoCount: 0, groups: [] };
      sections[group.category] = s;
    }
    s.groups.push(group);
  }
  for (const section of Object.values(sections)) {
    const counts = sectionCounts.get(section.name)!;
    section.errorCount = counts.errorCount;
    section.warningCount = counts.warningCount;
    section.infoCount = counts.infoCount;
  }
  if (opts?.topN !== undefined) {
    for (const section of Object.values(sections)) {
      section.groups = topGroups(section, opts.topN).shown;
    }
  }
  return { groups, sections };
}

/** issue #41: top-N + fold. `shown` is the leading group slice; `folded` is
 *  the number of issue OCCURRENCES hidden in the tail (the "…and K more"
 *  count), not the number of hidden groups. */
export function topGroups(section: SectionReport, n: number): { shown: IssueGroup[]; folded: number } {
  const limit = Math.max(n, 0);
  const shown = section.groups.slice(0, limit);
  let folded = 0;
  for (let i = limit; i < section.groups.length; i++) folded += section.groups[i]!.count;
  return { shown, folded };
}

/** ~4 chars per token heuristic (issue #41: ≤500-token default output budget). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** issue #41: lossless `--json` wire shape. One entry per raw issue in source
 *  order. Each entry is `{file, line, rule, detail}` (the acceptance shape)
 *  plus `level` and `suggestion` — agents must be able to filter errors from
 *  warnings and read fix hints without re-deriving them, so the wire format
 *  is a strict superset of the acceptance shape. Unknown engine categories
 *  land in `other`; no folding. Issue #53 Part 1.5: info-level hints carry
 *  `level: 'info'` here; `counts` stays `{errors, warnings}` (info is NOT a
 *  finding — hint totals are countable from the sections). Issue #59: the
 *  hints are OPT-IN, so a default check's raw issues hold none — sections
 *  carry no info entries and `refs.hintCount` is the discoverability signal. */
export function checkReportJson(result: CheckResultLike): unknown {
  const sections: Record<string, Array<{ file: string; line: number; level: string; rule: string; detail: string; suggestion?: string }>> = {};
  // issue #43: ADDITIVE `config` section. test/report.test.ts pins
  // Object.keys(sections) to exactly these five keys for plain runs (and the
  // §35 fixtures pin the wire shape byte-for-byte), so 'config' must NOT
  // join the always-present list — it is added ONLY when a config-category
  // issue exists (the invalid-_rules.yaml configFail). Position: after the
  // engines, before the catch-all, mirroring SECTION_ORDER. (Issue #56: the
  // 'overflow' section left the fixed set with the §16 engine.)
  const sectionNames = ['structure', 'style', 'refs', 'redundancy'];
  if (result.issues.some((issue) => issue.category === 'config')) sectionNames.push('config');
  sectionNames.push('other');
  for (const name of sectionNames) {
    sections[name] = [];
  }
  for (const issue of result.issues) {
    const bucket = issue.category === 'config'
      ? 'config' // issue #43: dedicated bucket — never an engine category, never 'other'
      : ENGINE_CATEGORIES.has(issue.category) ? issue.category : 'other';
    sections[bucket]!.push({
      file: issue.file,
      line: issue.line,
      level: issue.level,
      rule: issue.rule ?? normalizeMessage(issue).rule,
      detail: issue.message,
      ...(issue.suggestion !== undefined ? { suggestion: issue.suggestion } : {}),
    });
  }
  const summary: { files: number; nodes: number; maxDepth: number; elapsedMs?: number } = {
    files: result.files,
    nodes: result.nodes,
    maxDepth: result.maxDepth,
  };
  if (result.elapsedMs !== undefined) summary.elapsedMs = result.elapsedMs;
  const out: Record<string, unknown> = {
    ok: result.ok,
    command: 'check',
    exitCode: result.exitCode,
    summary,
    refs: {
      total: result.refs.total,
      broken: result.refs.broken,
      deepHops: result.refs.deepHops,
      // issue #59: the slug-hint count rides the refs section as the
      // discoverability signal while the info band is opt-in (info items
      // reach sections only under --hints). Additive: absent when zero, so
      // a hint-free corpus keeps the exact pre-#59 wire shape.
      ...(result.refs.hintCount !== undefined && result.refs.hintCount > 0
        ? { hintCount: result.refs.hintCount }
        : {}),
    },
    backPointers: {
      total: result.backPointers.total,
      current: result.backPointers.current,
      stale: result.backPointers.stale,
    },
    counts: { errors: result.errorCount, warnings: result.warningCount },
    sections,
    backPointersUpdated: result.backPointersUpdated,
    // issue #11: name the files --fix actually rewrote (sorted, spec-relative).
    backPointersUpdatedFiles: result.backPointersUpdatedFiles,
  };
  // issue #53 (Part 2.4): additive anchor-repair transaction fields — carried
  // through only when the check set them, so plain-check JSON shapes are
  // byte-identical to the pre-#53 wire format (§35 fixtures stay pinned).
  if (result.anchorFixes !== undefined) out.anchorFixes = result.anchorFixes;
  if (result.dryRun === true) out.dryRun = true;
  if (result.rulesSummary !== undefined) out.rulesSummary = result.rulesSummary;
  if (result.error !== undefined) out.error = result.error;
  return out;
}
