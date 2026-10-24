// ── Outline ──

export interface RefTarget {
  raw: string;
  file: string;
  anchor: string | null;
  line: number;
  /** Issue #57: set when this ref was WRITTEN as an alias use (`see: [1]`).
   *  After resolution (core/alias.ts) `file`/`anchor` hold the full pointer's
   *  target — exactly what parseOutline would have minted had the full
   *  target been written — so every ref-layer consumer (graph counting, deep
   *  hops, orphans, back-pointers, checker verdicts) is identical between
   *  the aliased and expanded forms of a file. `raw` keeps the WRITTEN
   *  spelling (diagnostics quote what is on the line), and these fields
   *  record the alias spelling for precise diagnostics: the `--fix` anchor
   *  repair targets the DEFINITION line, not the use line. */
  alias?: { name: string; defLine: number };
}

export interface OutlineNode {
  text: string;
  line: number;
  indent: number;
  children: OutlineNode[];
  file: string;
  isTask: boolean;
  isDone: boolean;
  owner: string | null;
  isHumanGate: boolean;
  refs: RefTarget[];
  hasCodeFence: boolean;
  hasTable: boolean;
  /** Issue #8: true ONLY for parser-created placeholder nodes (text "(table)"
   *  or "(code fence)") that represent a table/fence appearing BEFORE the
   *  first bullet of a file. They carry the hasTable/hasCodeFence signal but
   *  are not user content — consumers that count nodes or compare node text
   *  as content must exclude them (isSyntheticNode). Never set on nodes
   *  parsed from real bullets. */
  synthetic?: boolean;
}

export interface BackPointer {
  fromFile: string;
  fromLine: number;
  toFile: string;
  /** The anchor side of the back-pointer. For graph-built back-pointers
   *  (buildRefGraph): the ref's raw anchor token, null for file-level refs.
   *  For extracted `<!-- ref-by: ... -->` comments (extractBackPointers,
   *  issue #19): the text of the node whose bullet line carries the comment
   *  (INLINE form — a node mark), or null when the comment stands on its own
   *  line (STANDALONE form — a file-level mark). */
  toAnchor: string | null;
}

// ── Issues ──

/** 'info' is the author-time hint band (issue #53 Part 1.5): advisory
 *  notes — e.g. refs.slug.hint, which names the canonical anchor of a node
 *  containing slug-confusable characters — that must NEVER affect `ok`,
 *  exit codes, `--strict`, or the error/warning counts. Every count filter
 *  in the codebase is an equality test (`=== 'error'` / `=== 'warning'`),
 *  so info is invisible to them by construction. */
export type IssueLevel = 'error' | 'warning' | 'info';
/** 'config' (issue #43) is the check-level configuration band: an invalid
 *  _rules.yaml surfaces as rule 'config.invalid' on file '_rules.yaml' —
 *  never as an engine finding. Emitted only by the invalid-rules catch in
 *  checkWorkspace (configFail); all other checkFail paths (no workspace,
 *  unknown flag, unmatched file filter) keep the legacy 'refs' shape.
 *  ('overflow' was removed with the §16 engine — issue #56.) */
export type IssueCategory = 'structure' | 'style' | 'refs' | 'redundancy' | 'config';

export interface Issue {
  file: string;
  line: number;
  level: IssueLevel;
  category: IssueCategory;
  message: string;
  suggestion?: string;
  /** issue #41: machine-readable dotted rule key (e.g. "refs.broken.file",
   *  "structure.node_length.max") — stable vocabulary for report grouping and
   *  agent consumption. Optional so non-engine Issue constructors stay legal. */
  rule?: string;
}

// ── Rules ──

/** §18 delete-key semantics: a check whose mapping key is deleted (or whose
 *  section is deleted) is OFF. Off is encoded as `null` members — engines MUST
 *  skip the corresponding check when a member is null/false (never compare
 *  against null, which would coerce to 0 and flag everything). */
export interface LengthRange {
  min: number | null;
  max: number | null;
}

export interface StructureRules {
  node_length: LengthRange;
  siblings: LengthRange;
  depth: LengthRange;
  single_child_collapse: boolean;
  empty_nodes: boolean;
}

export interface StyleRules {
  /** Style-guide selector: `sibling` suppresses the nested-grouping hint,
   *  `nested` suppresses the sibling-collapse hint; null (deleted, §18) → no
   *  prefer-driven modulation — both base style hints fire unchanged. */
  prefer: 'sibling' | 'nested' | null;
  force_nested_above: number | null;
  force_sibling_below: number | null;
  shared_prefix_detection: boolean;
}

export interface ContentRules {
  tbd_allowed: boolean;
  max_tbd_per_file: number | null;
}

export interface ReferenceRules {
  /** Parameter (not a check): keeps its default when deleted (§18). */
  mode: 'pointer';
  back_pointers: boolean;
  /** Deleted → deep-hop check off (null = skip detectDeepHops, §18 strict). */
  max_hops: number | null;
  orphan_check: boolean;
  duplicate_home_check: boolean;
  /** Issue #55: inter-repo pointer roots — root name → path, both author-
   *  declared in `cans/_rules.yaml`. The path resolves from the PROJECT root
   *  (the parent of the `cans/` workspace), so `"../kelir-cloud/cans"` names a
   *  sibling checkout. A `see: name://sub/path` target resolves `sub/path`
   *  under that root as an artifact-style TERMINAL target: no promotion into
   *  the spec graph, no chaining, no back-pointer requirement, never a deep
   *  hop (§12). Optional parameter (§18): absent/empty = no external roots,
   *  and every `name://` target is an `undeclared external root` broken ref.
   *  Root names match ^[a-z][a-z0-9_-]*$; values are non-empty strings
   *  (malformed entries are line-numbered config errors, like every §18 key).
   *  `http://` and `https://` targets are URLs, never root pointers. */
  external_roots?: Record<string, string>;
  /** Issue #57: per-file pointer aliasing (footnote-style short `see:`
   *  targets). A PARAMETER block, not a check switch: absent/empty = the
   *  documented defaults (disabled), and it never participates in the §18
   *  delete/override reconciliation. See AliasingRules. */
  aliasing?: AliasingRules | null;
}

/** Issue #57: the `references.aliasing` block. One verified definition per
 *  file (`- [1]: full/target.md#Anchor`, footnote-style at the end), short
 *  fully-counted uses (`see: [1]`). Resolution is EXACTLY the full pointer's
 *  (file existence, anchors, external roots, containment, duplicate-home,
 *  orphan_check); every use counts as a ref for graph/hop/SCC purposes. */
export interface AliasingRules {
  /** Opt-in master switch, default false: aliasing disabled plus any alias
   *  use or definition present is an ERROR, never a silent pass (the fix is
   *  `cans alias expand`, not acceptance). */
  enabled: boolean;
  /** v1 scope: the defining FILE only — no cross-file leakage, no global
   *  alias tables. The only legal value in v1; anything else is a
   *  line-numbered config error. */
  scope: 'file';
  /** Which alias spellings are legal: `[1]`-style numbers, `[name]`-style
   *  lowercase words, or both. A use of the other style is an error. */
  style: 'numeric' | 'named' | 'both';
  /** Only targets used at least this many times (uses + full spellings, per
   *  file) are alias-eligible: a hand-written alias below the threshold is an
   *  error — indirection with no saving. Integer >= 1, default 2. */
  min_uses: number;
}

export interface RedundancyRules {
  enabled: boolean;
  word_frequency_threshold: number | null;
  phrase_overlap_threshold: number | null;
  cross_file_threshold: number | null;
  /** Layer 3 switch: deleted → false (§18 delete-key semantics). */
  fuzzy: boolean;
  /** Issue #47: layer 3 PARAMETER (not a check switch) — max Levenshtein
   *  distance for a typo pair; also the pair's length-difference pre-filter
   *  bound (an optimization upper bound: d ≥ |lenA − lenB|). Keeps its
   *  default (2) when deleted/omitted (§18). */
  fuzzy_max_distance: number;
  /** Issue #47: layer 3 PARAMETER (not a check switch) — words shorter than
   *  this are never typo candidates. Keeps its default (5) when
   *  deleted/omitted (§18). */
  fuzzy_min_word_length: number;
  /** Parameters (not checks): keep their defaults when deleted (§18). */
  stopwords: string[];
  synonyms: string[][];
}

export interface TokenBudgetRules {
  enabled: boolean;
  /** Parameters (not checks): budget planning keeps defaults when deleted (§18). */
  default_limit: number;
  estimate_chars_per_token: number;
  /** Deleted → usage warning off (null = never warn). */
  warn_threshold: number | null;
}

export interface OutputRules {
  /** Issue #59: the slug-hint info band (refs.slug.hint — issue #53 Part
   *  1.5) is OPT-IN. Default false: a plain `cans check` prints no hint
   *  items, no hint group, no "ℹ N notes" count, and `--json` carries no
   *  info items — only the refs.hintCount discoverability integer. The
   *  `--hints` CLI flag enables the band for one run (either path enables;
   *  there is deliberately no --no-hints because off is the default).
   *  A DISPLAY preference, not a check: never part of the §18 delete/override
   *  reconciliation, never affects ok/exit codes/--strict or any count. */
  slug_hints: boolean;
}

export interface Rules {
  structure: StructureRules;
  style: StyleRules;
  content: ContentRules;
  references: ReferenceRules;
  redundancy: RedundancyRules;
  token_budget: TokenBudgetRules;
  /** Issue #59: output-surface preferences (display switches, not checks). */
  output: OutputRules;
}

// ── Command Results ──

export interface CommandResult {
  ok: boolean;
  command: string;
  exitCode: number;
}

export interface InitResult extends CommandResult {
  command: 'init';
  created: string[];
  skipped: string[];
  root: string;
  /** §37: set when init refuses (e.g. already inside a cans/ workspace). */
  error?: string;
}

export interface CheckResult extends CommandResult {
  command: 'check';
  files: number;
  nodes: number;
  maxDepth: number;
  refs: {
    total: number;
    broken: number;
    deepHops: number;
    /** Issue #59: the number of refs.slug.hint items the workspace holds —
     *  the --json discoverability signal while the hint band is opt-in.
     *  Present only when > 0 (additive wire: a hint-free corpus is
     *  byte-identical to the pre-#59 shape). With `--hints` the value equals
     *  the info items carried in sections; without it the items are omitted
     *  and this integer is all that remains. Never a finding: does not
     *  affect ok, exitCode, counts or the human output. */
    hintCount?: number;
  };
  backPointers: { total: number; current: number; stale: number };
  issues: Issue[];
  errorCount: number;
  warningCount: number;
  /** Issue #53 Part 1.5: count of level:'info' issues (author-time hints,
   *  e.g. refs.slug.hint slug-safety notes). Additive/optional: internal
   *  callers that never emit info leave it unset. NEVER affects `ok`,
   *  exitCode, `--strict` or errorCount/warningCount. */
  infoCount?: number;
  backPointersUpdated: number;
  /** Issue #11: spec-relative paths of the files --fix actually rewrote
   *  (sorted). Empty without --fix or when nothing needed a write; with a
   *  [file] filter only matching files can ever appear here. */
  backPointersUpdatedFiles: string[];
  /** issue #53 (Part 2.4): the --fix anchor-repair transaction's items —
   *  every proposed pure-anchor rewrite (applied:false — plain --fix and
   *  --fix --dry-run propose only) and every one a --fix --yes run actually
   *  wrote (applied:true). Present only on --fix runs; absent on plain
   *  checks (additive-only result fields). */
  anchorFixes?: Array<{ file: string; line: number; from: string; to: string; applied: boolean }>;
  /** issue #53 (Part 2.4): true when --fix --dry-run previewed the run —
   *  the backPointersUpdated* fields and anchorFixes then describe WOULD-BE
   *  writes and no byte changed on disk. */
  dryRun?: boolean;
  /** issue #41: wall-clock duration of the whole checkWorkspace run,
   *  rounded to whole ms (0 for the static checkFail paths). */
  elapsedMs: number;
  /** §22/§36: human-facing one-line summary of the active _rules.yaml limits (QA-02 F17). */
  rulesSummary?: string;
}

export interface NewResult extends CommandResult {
  command: 'new';
  change: string;
  file: string;
  /** §37: real diagnosis for failures (unknown kind, empty slug, no workspace). */
  error?: string;
  /** Set when `new` notices a condition the user should know about. */
  warning?: string;
}

export interface DoneResult extends CommandResult {
  command: 'done';
  change: string;
  gates: { human: number; humanOpen: number; tasks: number; tasksOpen: number };
  /** §36: gate detail lines for human output. Each: { file, line, text } */
  gateDetails?: Array<{ file: string; line: number; text: string }>;
  archived: string | null;
  backPointersUpdated: number;
  /** §37: real diagnosis (task not found, no workspace, parse error). */
  error?: string;
}

export interface StatusResult extends CommandResult {
  command: 'status';
  specFiles: number;
  activeTasks: number;
  archivedTasks: number;
  adrCount: number;
  tasks: { total: number; done: number; unclaimed: number; blocked: number };
  owners: Record<string, { tasks: number; done: number }>;
  taskFiles: Array<{
    name: string;
    tasksDone: number;
    tasksTotal: number;
    gatesDone: number;
    gatesTotal: number;
    blocked: boolean;
    /** Items with `←` but no owner (§25 unclaimed semantics). */
    unclaimed?: number;
  }>;
  conflicts: number;
  /** Set when --unclaimed / --blocked / --owners filters are active.
   *  Human printer uses these to restrict output; JSON always has full data. */
  filter?: 'unclaimed' | 'blocked' | 'owners';
  /** §37: set when the workspace is missing. */
  error?: string;
}

export interface BudgetReadPlanItem {
  file: string;
  anchor: string | null;
  reason: string;
  score: number;
  estTokens: number;
}

export interface BudgetReadResult extends CommandResult {
  command: 'budget-read';
  concept: string;
  plan: BudgetReadPlanItem[];
  skipped: string[];
  totalTokens: number;
  budgetLimit: number;
  usagePercent: number;
  /** §37: real diagnosis (usage error, no workspace, no matches). */
  error?: string;
}

export interface BudgetWriteResult extends CommandResult {
  command: 'budget-write';
  concept: string;
  canEdit: Array<{ file: string; anchor: string | null; reason: string }>;
  mustNotEdit: Array<{ file: string; reason: string }>;
  backPointersToUpdate: Array<{ fromFile: string; fromLine: number; toFile: string }>;
  /** §37: real diagnosis (usage error, no workspace, empty scope). */
  error?: string;
}

export interface ImportConflict {
  file: string;
  line: number;
  cansVersion: string;
  importVersion: string;
  resolution: string;
}

export interface ImportResult extends CommandResult {
  command: 'import';
  format: string;
  source: string;
  newFiles: string[];
  merged: string[];
  conflicts: ImportConflict[];
  /** §37: real diagnosis (usage error, source not found, parse failure). */
  error?: string;
  /** Set when the import was a dry run (no files written). */
  dryRun?: boolean;
}

export interface ExportResult extends CommandResult {
  command: 'export';
  format: string;
  outputDir: string;
  filesExported: number;
  /** §37: real diagnosis (usage error, no workspace). */
  error?: string;
  /** Set when the export was a dry run (no files written). */
  dryRun?: boolean;
}

export interface SlugResult extends CommandResult {
  command: 'slug';
  /** The raw user input: the joined text-mode args, or the `<file>:<line>`
   *  token. Echoed verbatim so --json consumers can correlate the answer
   *  with the ask (issue #53 Part 1.2). */
  input: string;
  /** The canonical anchor fragment (anchorSlug, core/slug.ts — the Option A
   *  algorithm). Empty string on failure paths. */
  slug: string;
  /** §37: real diagnosis (no text given, empty slug, malformed line number,
   *  no workspace, file not found, line not a node line, parse error). */
  error?: string;
  /** File:line mode only: the source node's text the slug was derived from —
   *  the answer to "which node did line N point at?". Never set in text
   *  mode (there is no source node, only the given text). */
  nodeText?: string;
}

export interface VersionResult extends CommandResult {
  command: 'version';
  version: string;
}

/** Issue #57: `cans alias expand|collapse` — the programmatic switch between
 *  full-pointer form and aliased form. Both directions are lossless for
 *  non-pointer text, idempotent, and graph-identical (checker output on the
 *  two forms of one file matches: same refs, hops, SCC, errors, warnings). */
export interface AliasFileOutcome {
  /** Spec-relative file path. */
  file: string;
  /** False when the transform was a no-op (already in the target form) or the
   *  file was REFUSED — see `problems`. */
  changed: boolean;
  /** expand: alias uses rewritten to full targets; collapse: full targets
   *  rewritten to alias uses. */
  usesRewritten: number;
  /** expand: definitions removed. */
  definitionsRemoved: number;
  /** collapse: NEW definitions appended (existing ones are kept in place and
   *  counted in definitionsKept). */
  definitionsAdded: number;
  /** collapse: existing definitions reused, unchanged. */
  definitionsKept: number;
  /** Source bytes before − after; positive = saved (collapse's whole point). */
  charsSaved: number;
  /** §37 refusals: the file was left byte-identical and each problem names
   *  what happened and what to do (undefined aliases, style/min_uses
   *  conflicts, anchored alias uses, unterminated fences). */
  problems: string[];
}

export interface AliasResult extends CommandResult {
  command: 'alias';
  direction: 'expand' | 'collapse';
  /** Per-file outcomes, spec-relative, sorted. */
  results: AliasFileOutcome[];
  /** True when --dry-run previewed: no byte changed on disk and the counts
   *  describe would-be writes. */
  dryRun?: boolean;
  /** §37: usage / no-workspace / invalid-rules / disabled-config diagnosis
   *  (ok:false, exitCode 2). Per-file refusals ride in results[].problems
   *  instead (ok:false, exitCode 1 — user-correctable file content). */
  error?: string;
}

// ── Converters ──

export interface ExternalNode {
  text: string;
  indent: number;
  isTask: boolean;
  isDone: boolean;
  children: ExternalNode[];
  metadata: Record<string, string>;
}

export type MergeStrategy = 'cans-wins' | 'import-wins' | 'ask';
export type ImportFormat = 'opml' | 'dynalist' | 'logseq' | 'obsidian';
export type ExportFormat = ImportFormat | 'all';
