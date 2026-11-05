/** Issue #63 — the agent-guardrails ENGINE (`agent_guardrails`, §18).
 *
 *  Workspace-only execution policies for autonomous agents working inside a
 *  CANS-governed workspace: the engine inspects LOCAL WORKSPACE STATE ONLY —
 *  active task declarations, the devlog, AGENTS.md, build-output directories,
 *  manifest residue — and never touches CI/CD or runner configs (the issue's
 *  framing: these are local workspace-hygiene concerns, decoupled from CI).
 *
 *  The four checks (each gated on its own config switch; the whole engine is
 *  silent unless `agent_guardrails.enabled` is true — absent / empty / null
 *  block, or `enabled: false`, produce zero findings so every pre-#63
 *  workspace behaves byte-identically):
 *
 *   1. isolation.mode === 'require-target-prefix'
 *      a. every ACTIVE task (`_tasks/*.md`, discoverActiveTasks) that
 *         declares a build/output directory via a yaml-ish key line
 *         (`target:` / `output:` / `build_dir:`) must declare it under the
 *         configured prefix (string-prefix-match after path normalization);
 *      b. a shared DEFAULT build dir at the workspace ROOT (`target/`,
 *         `dist/`, `build/`, `out/` — exactly these four spellings,
 *         directories, root level only) is a contention finding, EXCEPT the
 *         dir that hosts the prefixed agent dirs (prefix `target/agent-` →
 *         `target/` is the prefix root and legal).
 *   2. manifests.atomic_writes_only === true
 *      a. the devlog's `touched_files` section listing a protected manifest
 *         is evidence of an in-place mutation — agents must copy-modify-swap;
 *      b. atomic-write residue beside a protected manifest (`<path>.bak`,
 *         `<path>.orig`, `<path>~`, `<path>.tmp`) is a finding.
 *   3. devlog.enabled === true — the devlog file must exist AND carry every
 *      `required_sections` entry as a Markdown heading (any #..###### level,
 *      text equal case-insensitively after trim). Missing file → one
 *      finding; file missing sections → one finding naming them.
 *   4. negative_invariants.required === true — AGENTS.md at the workspace
 *      root must exist and carry a heading equal to the anchor text (any
 *      level, exact after trim) with at least one non-empty content line
 *      beneath it before the next heading of level <= its own.
 *
 *  ── Output-surface decision (pinned here because it deviates from the
 *  issue sketch) ────────────────────────────────────────────────────────────
 *  The sketch asks for `category: 'guardrails'`. The Issue.category union
 *  (IssueCategory, src/types.ts) is a closed five-member union
 *  ('structure' | 'style' | 'refs' | 'redundancy' | 'config') owned by
 *  another file this engine deliberately does not touch; smuggling a new
 *  literal through a cast would be a type-system lie. report.ts's fallback
 *  path (sectionFor) routes an unknown rule PREFIX by the issue's category,
 *  so these findings carry category 'structure' — the closest existing
 *  bucket (the structure section already hosts workspace-shape findings:
 *  malformed workspace entries, duplicate homes) — with machine-readable
 *  `guardrails.*` rule keys. Consequences, both renderers:
 *    - human: the findings render in the STRUCTURE section (always shown
 *      when non-empty; `--show structure` unfolds them), grouped per rule
 *      key with per-file locations and the fix hint;
 *    - --json: lossless under sections.structure — each entry carries the
 *      full `guardrails.*` rule key and the complete message as `detail`,
 *      so agents can filter on the rule prefix alone.
 *  'config' was rejected (issue #43 reserves it for config.invalid — never
 *  an engine finding); 'refs'/'style'/'redundancy' are semantically wrong.
 *
 *  House rules honored: deterministic (fixed scan orders, no wall-clock, no
 *  map iteration over user-inserted order), statically decidable (local
 *  files and headings only), and every finding names the file involved, the
 *  violated guardrail (the `_rules.yaml` key), and a concrete remediation
 *  hint in `suggestion` (the engines' "fix:" style). */

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentGuardrailsRules, Issue, IssueLevel } from '../types.ts';
import { dirExists, discoverActiveTasks } from './fs.ts';

/** Fence marker rule, mirrored from src/core/outline.ts (issue #6) — the
 *  same convention check.ts's FENCE_RE copy pins: a line whose trimmed form
 *  starts with ``` toggles fence state. The devlog/AGENTS.md scanners use it
 *  so fenced `# headings` and fenced `- Cargo.toml` examples can never read
 *  as real content. Must never diverge from the original. */
const FENCE_RE = /^```/;

/** The yaml-ish key spellings a task file may use to declare a build/output
 *  directory — exactly the three the issue names (`target:` / `output:` /
 *  `build_dir:`). Deliberately closed: inventing more spellings would make
 *  the predicate guess instead of decide. */
const TASK_BUILD_KEYS = new Set(['target', 'output', 'build_dir']);

/** `key: value` (optionally behind a `- ` bullet, the task files' native
 *  shape) — the value is captured raw and unquoted/normalized separately. */
const TASK_DECL_RE = /^[ \t]*(?:[-*+][ \t]+)?([A-Za-z_][A-Za-z0-9_-]*)[ \t]*:[ \t]*(.*?)[ \t]*$/;

/** The shared default build dirs at the workspace ROOT, in the issue's own
 *  order — exactly these four spellings, root level only. */
const DEFAULT_BUILD_DIRS = ['target', 'dist', 'build', 'out'];

/** Atomic-write residue suffixes beside a protected manifest, in the issue's
 *  own order (`<path>.bak`, `<path>.orig`, `<path>~`, `<path>.tmp`). */
const RESIDUE_SUFFIXES = ['.bak', '.orig', '~', '.tmp'];

/** The devlog section that records what an agent physically touched — the
 *  fixed heading of the devlog format (the default required_sections[0]).
 *  Matched case-insensitively like every required_sections entry. */
const TOUCHED_FILES_SECTION = 'touched_files';

/** Markdown ATX heading: 1–6 `#`, one space, text (up to 3 leading spaces is
 *  legal Markdown). `#######` (7) and `#tag` (no space) are not headings. */
const HEADING_RE = /^[ ]{0,3}(#{1,6})[ \t]+(.+?)[ \t]*$/;

interface MdLine {
  text: string;
  fence: boolean;
}

interface MdHeading {
  level: number;
  text: string;
  line: number; // 1-based
}

/** Split source into lines tagged with their fence state (fence markers
 *  themselves are fenced). 1-based addressing matches every engine's line
 *  numbers. */
function scanMdLines(source: string): MdLine[] {
  const out: MdLine[] = [];
  let fenceOpen = false;
  for (const raw of source.split('\n')) {
    const fence = FENCE_RE.test(raw.trim());
    out.push({ text: raw, fence: fence || fenceOpen });
    if (fence) fenceOpen = false;
    else if (fence) fenceOpen = true;
  }
  return out;
}

function scanHeadings(lines: MdLine[]): MdHeading[] {
  const out: MdHeading[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.fence) continue;
    const m = l.text.match(HEADING_RE);
    if (m !== null) out.push({ level: m[1]!.length, text: m[2]!.trim(), line: i + 1 });
  }
  return out;
}

/** Section body lines (fence lines excluded) under heading `h`: everything
 *  after it until the next heading of level <= h.level (or EOF). */
function sectionBody(lines: MdLine[], h: MdHeading): Array<{ text: string; line: number }> {
  const out: Array<{ text: string; line: number }> = [];
  for (let i = h.line; i < lines.length; i++) {
    const l = lines[i]!;
    if (!l.fence) {
      const m = l.text.match(HEADING_RE);
      if (m !== null && m[1]!.length <= h.level) break;
    }
    if (!l.fence) out.push({ text: l.text, line: i + 1 });
  }
  return out;
}

/** Strip one layer of matching quotes — task/devlog spellings are prose, not
 *  the rules parser, so a quoted value keeps its literal path. */
function unquote(v: string): string {
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

/** Path normalization for prefix matching — the issue #62 discipline
 *  (`\` → `/`, `//` runs collapse, ONE leading `./` strips, trailing slash
 *  trims: the #22 folder form). Both the configured prefix and a task's
 *  declared value normalize through this so `target/agent-x/` and
 *  `./target/agent-x` are one path. */
function normalizePath(p: string): string {
  return p
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function readIfExists(p: string): string | null {
  if (!isFile(p)) return null;
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null; // unreadable: nothing statically decidable to report
  }
}

function finding(
  file: string,
  line: number,
  rule: string,
  message: string,
  suggestion: string,
  level: IssueLevel,
): Issue {
  // category 'structure' + guardrails.* rule key — see the module header's
  // output-surface decision.
  return { file, line, level, category: 'structure', message, suggestion, rule };
}

/** Quoted, comma-joined list for messages naming several config entries. */
function quotedList(names: string[]): string {
  return names.map(n => `"${n}"`).join(', ');
}

// ── Check 1: isolation.mode === 'require-target-prefix' ─────────────────────

function isolationFindings(root: string, cfg: AgentGuardrailsRules, level: IssueLevel): Issue[] {
  if (cfg.isolation?.mode !== 'require-target-prefix') return [];
  // loadRules guarantees a non-empty workspace-relative prefix (§18
  // guardIsolation); the ?? keeps direct callers honest (documented default).
  const prefix = normalizePath(cfg.isolation?.prefix ?? '') || normalizePath('target/agent-');
  const issues: Issue[] = [];

  // (a) active task declarations must sit under the prefix.
  if (dirExists(join(root, '_tasks'))) {
    for (const rel of discoverActiveTasks(root)) {
      const source = readIfExists(join(root, rel));
      if (source === null) continue; // unreadable task: not statically decidable, skip
      const lines = source.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i]!.match(TASK_DECL_RE);
        if (m === null || !TASK_BUILD_KEYS.has(m[1]!)) continue;
        const raw = unquote(m[2]!);
        if (raw === '') continue; // an empty value declares no directory
        if (raw.includes('://')) continue; // a URI is not a workspace path
        const declared = normalizePath(raw);
        // The brief's literal predicate: string-prefix-match after path
        // normalization (prefix 'target/agent-' satisfied by
        // 'target/agent-<task>/…' and by 'target/agent-' itself).
        if (declared.startsWith(prefix)) continue;
        issues.push(
          finding(
            rel,
            i + 1,
            'guardrails.isolation.task_build_dir',
            `build dir outside the agent prefix: ${rel}:${i + 1} declares ${m[1]}: ${declared} — agent_guardrails.isolation.prefix is "${prefix}"`,
            `declare the build/output directory under "${prefix}" (e.g. ${prefix}<task-name>/) — shared defaults make concurrent agents collide on one cache`,
            level,
          ),
        );
      }
    }
  }

  // (b) a shared default build dir at the workspace ROOT is contention —
  // except the prefix's own root segment (prefix 'target/agent-' → 'target/'
  // is legal: the prefixed agent dirs live inside it).
  const prefixRoot = prefix.split('/')[0]!;
  for (const dir of DEFAULT_BUILD_DIRS) {
    if (dir === prefixRoot) continue;
    if (!dirExists(join(root, dir))) continue;
    issues.push(
      finding(
        `${dir}/`,
        0,
        'guardrails.isolation.default_build_dir',
        `shared default build dir at the workspace root: ${dir}/ exists — concurrent agents collide on it — agent_guardrails.isolation.mode is "require-target-prefix" (prefix "${prefix}")`,
        `remove or rename the root-level "${dir}/" dir and let agents build under "${prefix}" (the prefix's own root segment is exempt — it hosts the prefixed agent dirs)`,
        level,
      ),
    );
  }
  return issues;
}

// ── Check 2: manifests.atomic_writes_only === true ──────────────────────────

/** Does `line` list the workspace-relative path `p` as a touched file? The
 *  path must occur delimited by non-path characters on BOTH sides, so
 *  `crates/Cargo.toml` never counts for the root manifest `Cargo.toml` and
 *  `Cargo.toml.bak` never counts either — the boundary set is the path
 *  character set [A-Za-z0-9._-] plus `/` (a longer path is a different
 *  file), while `,`, `:`, whitespace, `(`, `*` etc. delimit a listing. */
function listsPath(line: string, p: string): boolean {
  let at = line.indexOf(p);
  const isPathChar = (c: string | undefined): boolean =>
    c !== undefined && /[A-Za-z0-9._\-/]/.test(c);
  while (at >= 0) {
    const before = at === 0 ? undefined : line.charAt(at - 1);
    const after = at + p.length >= line.length ? undefined : line.charAt(at + p.length);
    if (!isPathChar(before) && !isPathChar(after)) return true;
    at = line.indexOf(p, at + 1);
  }
  return false;
}

function manifestFindings(root: string, cfg: AgentGuardrailsRules, level: IssueLevel): Issue[] {
  if (cfg.manifests?.atomic_writes_only !== true) return [];
  const issues: Issue[] = [];
  const protectedPaths = cfg.manifests?.protected ?? [];
  if (protectedPaths.length === 0) return [];

  // (a) the devlog's touched_files section listing a protected manifest is
  // evidence of an in-place mutation. The devlog path is the configured one
  // (canonical devlog location even when devlog.enabled is false — a file
  // sitting there is still evidence; the switch below is the manifests one).
  const devlogPath = cfg.devlog?.path ?? 'log/devlog.md';
  const source = readIfExists(join(root, devlogPath));
  if (source !== null) {
    const lines = scanMdLines(source);
    const headings = scanHeadings(lines);
    const blocks = headings
      .filter(h => h.text.toLowerCase() === TOUCHED_FILES_SECTION)
      .map(h => ({ heading: h, body: sectionBody(lines, h) }));
    for (const p of protectedPaths) {
      for (const { heading, body } of blocks) {
        const hit = body.find(l => listsPath(l.text, p));
        if (hit === undefined) continue;
        issues.push(
          finding(
            devlogPath,
            hit.line,
            'guardrails.manifests.devlog_touched',
            `protected manifest listed as touched: ${devlogPath}:${hit.line} (under the "${heading.text}" heading at line ${heading.line}) lists ${p} — an in-place manifest edit breaks concurrent tasks on any syntax error — agent_guardrails.manifests.atomic_writes_only`,
            `edit ${p} by copy-modify-swap only: write ${p}.next, validate it, then rename over ${p} — and log the swap in the devlog, never an in-place rewrite`,
            level,
          ),
        );
        break; // one finding per manifest — the first listing is the evidence
      }
    }
  }

  // (b) atomic-write residue beside a protected manifest. Manifests in
  // config order, suffixes in the fixed order above — deterministic.
  for (const p of protectedPaths) {
    for (const suffix of RESIDUE_SUFFIXES) {
      const residue = `${p}${suffix}`;
      if (!isFile(join(root, residue))) continue;
      issues.push(
        finding(
          residue,
          0,
          'guardrails.manifests.residue',
          `atomic-write residue beside a protected manifest: ${residue} sits next to ${p} — evidence of a non-atomic in-place write — agent_guardrails.manifests.atomic_writes_only`,
          `finish the copy-modify-swap: validate ${residue}, rename it over ${p}, then delete it — no .bak/.orig/~/.tmp sibling may remain next to a protected manifest`,
          level,
        ),
      );
    }
  }
  return issues;
}

// ── Check 3: devlog.enabled === true ─────────────────────────────────────────

function devlogFindings(root: string, cfg: AgentGuardrailsRules, level: IssueLevel): Issue[] {
  if (cfg.devlog?.enabled !== true) return [];
  const path = cfg.devlog?.path ?? 'log/devlog.md';
  const required = cfg.devlog?.required_sections ?? [];
  const source = readIfExists(join(root, path));
  if (source === null) {
    return [
      finding(
        path,
        0,
        'guardrails.devlog.missing_file',
        `agent devlog missing: ${path} does not exist — evicted agents leave the next one zero granular context — agent_guardrails.devlog.enabled`,
        `create ${path} and have every agent append an entry carrying ${quotedList(required)} before it evicts (token exhaustion, timeout, error)`,
        level,
      ),
    ];
  }
  const headings = scanHeadings(scanMdLines(source));
  const missing = required.filter(s => {
    const want = s.trim().toLowerCase();
    return !headings.some(h => h.text.toLowerCase() === want);
  });
  if (missing.length === 0) return [];
  return [
    finding(
      path,
      0,
      'guardrails.devlog.missing_sections',
      `agent devlog missing required sections: ${path} carries no ${quotedList(missing)} heading — agent_guardrails.devlog.required_sections`,
      `add the missing Markdown headings (${quotedList(missing)} — any #..###### level) so the next agent inherits what was touched, what passed, and what is still open`,
      level,
    ),
  ];
}

// ── Check 4: negative_invariants.required === true ──────────────────────────

function invariantFindings(root: string, cfg: AgentGuardrailsRules, level: IssueLevel): Issue[] {
  if (cfg.negative_invariants?.required !== true) return [];
  // §18 guardInvariants guarantees a non-empty anchor; the ?? keeps direct
  // callers honest (documented default).
  const anchor = (cfg.negative_invariants?.anchor ?? '').trim() || 'Negative Invariants';
  const rel = 'AGENTS.md';
  const source = readIfExists(join(root, rel));
  if (source === null) {
    return [
      finding(
        rel,
        0,
        'guardrails.invariants.missing_file',
        `negative invariants file missing: ${rel} does not exist — agents have no visible strictly-forbidden patterns, dependencies or implementations — agent_guardrails.negative_invariants`,
        `create ${rel} with a "${anchor}" heading and at least one forbidden pattern, dependency or implementation beneath it`,
        level,
      ),
    ];
  }
  const lines = scanMdLines(source);
  const anchorHeading = scanHeadings(lines).find(h => h.text.trim() === anchor);
  if (anchorHeading === undefined) {
    return [
      finding(
        rel,
        0,
        'guardrails.invariants.missing_anchor',
        `negative invariants anchor missing: ${rel} carries no "${anchor}" heading — agents lack immediate visibility into the strictly-forbidden — agent_guardrails.negative_invariants.anchor`,
        `add a "${anchor}" heading (any #..###### level, exact text) with the banned patterns, dependencies and implementations listed beneath it`,
        level,
      ),
    ];
  }
  // The block: every line beneath the anchor heading until the next heading
  // of level <= the anchor's own. At least one non-empty content line must
  // sit there — a bare heading documents no boundary at all.
  const hasContent = sectionBody(lines, anchorHeading).some(l => l.text.trim() !== '');
  if (hasContent) return [];
  return [
    finding(
      rel,
      anchorHeading.line,
      'guardrails.invariants.empty_block',
      `negative invariants block is empty: the "${anchor}" heading at ${rel}:${anchorHeading.line} has no content beneath it — no boundary is actually documented — agent_guardrails.negative_invariants`,
      `list at least one forbidden pattern, dependency or implementation under the "${anchor}" heading (one per line, before the next heading of level <= its own)`,
      level,
    ),
  ];
}

/** The guardrails engine — see the module header. `cfg` is the loaded
 *  `agent_guardrails` block (Rules.agent_guardrails: absent = undefined,
 *  explicitly empty = null, both silent). */
export function checkAgentGuardrails(
  root: string,
  cfg: AgentGuardrailsRules | null | undefined,
): Issue[] {
  // The whole engine is inert unless the block is present AND enabled —
  // `!rules.agent_guardrails?.enabled` is the exact predicate the wiring and
  // this defensive re-check share.
  if (cfg === null || cfg === undefined || cfg.enabled !== true) return [];
  // 'error' → level error (fails the run, exit 2); 'warn' → warning.
  const level: IssueLevel = cfg.severity === 'warn' ? 'warning' : 'error';
  return [
    ...isolationFindings(root, cfg, level),
    ...manifestFindings(root, cfg, level),
    ...devlogFindings(root, cfg, level),
    ...invariantFindings(root, cfg, level),
  ];
}
