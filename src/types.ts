// ── Outline ──

export interface RefTarget {
  raw: string;
  file: string;
  anchor: string | null;
  line: number;
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
}

export interface BackPointer {
  fromFile: string;
  fromLine: number;
  toFile: string;
  toAnchor: string | null;
}

// ── Issues ──

export type IssueLevel = 'error' | 'warning';
export type IssueCategory = 'structure' | 'style' | 'refs' | 'redundancy' | 'overflow';

export interface Issue {
  file: string;
  line: number;
  level: IssueLevel;
  category: IssueCategory;
  message: string;
  suggestion?: string;
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
  /** Deleted `prefer` disables prefer-driven style guidance (§18). */
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
}

export interface RedundancyRules {
  enabled: boolean;
  word_frequency_threshold: number | null;
  phrase_overlap_threshold: number | null;
  cross_file_threshold: number | null;
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

export interface OverflowRules {
  /** Deleted → char-length check off (§18). */
  max_node_chars: number | null;
  /** Deleted → nothing is forced into files → no content-type flags (§16/§18). */
  force_file_for: string[] | null;
}

export interface Rules {
  structure: StructureRules;
  style: StyleRules;
  content: ContentRules;
  references: ReferenceRules;
  redundancy: RedundancyRules;
  token_budget: TokenBudgetRules;
  overflow: OverflowRules;
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
  refs: { total: number; broken: number; deepHops: number };
  backPointers: { total: number; current: number; stale: number };
  issues: Issue[];
  errorCount: number;
  warningCount: number;
  backPointersUpdated: number;
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

export interface VersionResult extends CommandResult {
  command: 'version';
  version: string;
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
