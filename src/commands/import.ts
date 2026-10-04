import { join, basename, dirname } from 'path';
import { readdirSync } from 'fs';
import type {
  ImportResult, ImportFormat, ImportConflict, MergeStrategy, ExternalNode,
} from '../types.ts';
import { readText, writeText } from '../core/runtime.ts';
import { resolveWorkspaceRoot, discoverSpecFiles, mkdirp, isFile, dirExists } from '../core/fs.ts';
import { convertArrowRefs, parseOpml, parseOpmlTitle } from '../converters/opml.ts';
import { parseLogseq } from '../converters/logseq.ts';
import { parseObsidian, stripFrontmatter } from '../converters/obsidian.ts';
import {
  serializeToCans, parseFromCans, stripMetadata, parseCheckbox,
  extractOverflowContent, type OverflowExtraction,
} from '../converters/shared.ts';

export interface ImportArgs {
  format: ImportFormat;
  path: string;
  out: string | null;
  dryRun: boolean;
  mergeStrategy: MergeStrategy;
  /** Raw `--merge-strategy` value as given, so invalid enums can be rejected (QA-05 F10). */
  mergeStrategyRaw: string | null;
  /** First `--flag=value` token seen, so the equals form can be rejected (§20, QA-14 F3). */
  invalidFlagForm: string | null;
  json: boolean;
}

const FORMATS: readonly string[] = ['opml', 'dynalist', 'logseq', 'obsidian'];
const STRATEGIES: readonly MergeStrategy[] = ['cans-wins', 'import-wins', 'ask'];

export function parseImportArgs(args: string[]): ImportArgs {
  const positional: string[] = [];
  let out: string | null = null;
  let dryRun = false;
  let mergeStrategy: MergeStrategy = 'cans-wins';
  let mergeStrategyRaw: string | null = null;
  let invalidFlagForm: string | null = null;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    // §20: `--flag value` only — the equals form is rejected like on every other
    // command, never silently defaulted (QA-14 F3 / QA-06 #4).
    if (a.startsWith('--') && a.includes('=')) {
      if (invalidFlagForm === null) invalidFlagForm = a;
      continue;
    }
    if (a === '--out') {
      out = args[i + 1] ?? null;
    } else if (a === '--dry-run') {
      dryRun = true;
    } else if (a === '--merge-strategy') {
      const s = args[i + 1] ?? null;
      mergeStrategyRaw = s;
      if (s !== null && (STRATEGIES as readonly string[]).includes(s)) mergeStrategy = s as MergeStrategy;
    } else if (a === '--json') {
      json = true;
    } else if (!a.startsWith('--')) {
      positional.push(a);
    }
  }
  return {
    format: (positional[0] ?? '') as ImportFormat,
    path: positional[1] ?? '',
    out,
    dryRun,
    mergeStrategy,
    mergeStrategyRaw,
    invalidFlagForm,
    json,
  };
}

function fail(format: string, source: string, error: string): ImportResult {
  return {
    ok: false, command: 'import', exitCode: 1,
    format, source, newFiles: [], merged: [], conflicts: [], error,
  };
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/["“”]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** §4 canonical ref form: spec-slug ref targets carry the `.md` extension when
 *  written into the workspace (`see: 02-authentication#Sessions` →
 *  `see: 02-authentication.md#Sessions`). Converter output stays mechanical;
 *  the importer emits workspace-conformant refs (QA-05 F2/F3). Idempotent. */
function canonicalizeRefTargets(text: string): string {
  return text.replace(
    /\bsee:?\s+([^\s#]+)(#[^\s]+)?/g,
    (m, target: string, anchor: string | undefined) => {
      if (/^\d{2}-/.test(target) && !target.endsWith('.md')) {
        return `see: ${target}.md${anchor ?? ''}`;
      }
      return m;
    },
  );
}

/** Normalized key for fuzzy text matching: lowercase, strip punctuation, collapse whitespace. */
function normKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Near-match: same words (len > 1) with ≥ minOverlap word overlap.
 * Default 0.75 — the QA-05 F8 flagship conflict pair — "Expire after 24 hours"
 * vs "Expire after 48 hours" — shares 3 of 4 words (0.75) and MUST be flagged.
 * The positional counterpart check (QA-14 F2) passes 0.5: same parent + same
 * sibling slot is strong evidence of correspondence, so a reworded node that
 * picked up extra words ("Expire after 24 hours" vs "Sessions expire after
 * 24h", overlap 0.5) still pairs, while unrelated texts (overlap 0) stay
 * genuinely new.
 */
function isNearMatch(a: string, b: string, minOverlap = 0.75): boolean {
  const wa = new Set(normKey(a).split(' ').filter(w => w.length > 1));
  const wb = new Set(normKey(b).split(' ').filter(w => w.length > 1));
  if (wa.size === 0 || wb.size === 0) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.max(wa.size, wb.size) >= minOverlap;
}

// ── diverged-sibling guard (issue #20 / §27) ────────────────────────────────

/** Significant tokens of a node: normalized words of length > 1. */
function sigTokens(text: string): string[] {
  return normKey(text).split(' ').filter(w => w.length > 1);
}

/** DIVERGED_STEM: the leading-stem length for the guard — the first TWO
 *  significant words when both sides have them (falls back to one). Two, not
 *  one: "sign up" vs "sign in" share the first word but are distinct concepts,
 *  while "sign up" vs "sign up …" is the same concept reworded. */
const DIVERGED_STEM = 2;

/** DIVERGED_JACCARD_FLOOR: corroborating token-set overlap for the guard.
 *  Jaccard (shared / union) is preferred over isNearMatch's shared/max because
 *  it does not decay monotonically as one side is lengthened. The floor is
 *  deliberately low (0.3): the repro pair "Sign up: TBD" vs "Sign up: DONE -
 *  changed externally" scores 2/6 ≈ 0.33, and the stem condition — not the
 *  floor — carries the discrimination (see isDivergedSibling). */
const DIVERGED_JACCARD_FLOOR = 0.3;

/** DIVERGED_CONTAINMENT: length-robustness fallback. A rewording that keeps the
 *  stem but lengthens far ("Sign up: DONE and the ops team also recorded the
 *  external migration notes") decays Jaccard below any floor (2/13 ≈ 0.15),
 *  yet it still preserves ≥ half of the EXISTING sibling's significant tokens
 *  (shared/minSize ≥ 0.5) — that is the same concept elaborated, not a new one. */
const DIVERGED_CONTAINMENT = 0.5;

/**
 * Diverged-sibling guard (issue #20): true when an import node that escaped all
 * three match layers (exact → near-match ≥ 0.75 → positional ≥ 0.5) is still
 * recognizably the SAME concept as an existing sibling under the same parent:
 *
 *   1. leading stem: the first min(2, ·) significant words are identical
 *      ("sign up" == "sign up"), AND
 *   2. word-overlap corroboration: token-Jaccard ≥ 0.3, OR ≥ 0.5 of the
 *      existing sibling's significant tokens survive in the import node.
 *
 * Why a CONJUNCTION: the repro pair has Jaccard 0.33 while the genuinely
 * distinct "Sign up: TBD" vs "Sign in: TBD" has Jaccard 0.50 — no Jaccard-only
 * floor separates them. The two-word stem does ("sign up" ≠ "sign in"), and the
 * overlap metrics corroborate the stem so stem-equal-but-unrelated texts stay
 * distinct. Either signal alone is too noisy; together they catch the reworded
 * re-import without flagging genuinely new siblings.
 *
 * Callers: mergeInto, as the FINAL same-parent check before the new-node append
 * — a hit is a conflict per §27/§35 (recorded, strategy-resolved), never a
 * silent duplicate sibling. Exported for unit tests only.
 */
export function isDivergedSibling(existing: string, incoming: string): boolean {
  const ea = sigTokens(existing);
  const ib = sigTokens(incoming);
  if (ea.length === 0 || ib.length === 0) return false;
  const stemLen = Math.min(DIVERGED_STEM, ea.length, ib.length);
  for (let i = 0; i < stemLen; i++) {
    if (ea[i] !== ib[i]) return false; // leading stem differs → distinct concept
  }
  const sa = new Set(ea);
  const sb = new Set(ib);
  let shared = 0;
  for (const w of sa) if (sb.has(w)) shared++;
  const union = sa.size + sb.size - shared;
  const jaccard = union > 0 ? shared / union : 0;
  const containment = shared / Math.min(sa.size, sb.size);
  return jaccard >= DIVERGED_JACCARD_FLOOR || containment >= DIVERGED_CONTAINMENT;
}

/** Source files to import: a single file, or every supported file inside a directory. */
function sourceFiles(path: string, format: string): string[] | null {
  if (isFile(path)) return [path];
  if (dirExists(path)) {
    const ext = format === 'opml' || format === 'dynalist' ? '.opml' : '.md';
    let names: string[] = [];
    try {
      names = readdirSync(path).filter(n => n.endsWith(ext));
    } catch {
      return null;
    }
    return names.sort().map(n => join(path, n));
  }
  return null;
}

/** Map every node's text (depth-first) through `f`, preserving structure. */
function mapText(nodes: ExternalNode[], f: (t: string) => string): ExternalNode[] {
  return nodes.map((n) => ({ ...n, text: f(n.text), children: mapText(n.children, f) }));
}

/** Logseq/Obsidian parsers (§31) yield a FLAT indent-annotated list; the merge
 *  walk (mergeInto/mergeNodes) needs a real TREE so the sibling-level match
 *  layers (near-match, positional counterpart, diverged guard) scan the ACTUAL
 *  sibling set under the matched parent. Without this, every non-root node of
 *  a logseq/obsidian import was merged at the ROOT level: the sibling layers
 *  never fired below the root, so any diverged nested node fell through to the
 *  append branch — the silent duplicate of issue #20 (the appended node only
 *  LOOKED correctly placed because serializeToCans writes by `indent`).
 *  Stack-attach by indent, same rule as parseFromCans. OPML/Dynalist already
 *  build trees (parseOpml), so only the flat formats are normalized. */
function toTree(flat: ExternalNode[]): ExternalNode[] {
  const roots: ExternalNode[] = [];
  const stack: ExternalNode[] = [];
  for (const n of flat) {
    const node: ExternalNode = { ...n, children: [] };
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= node.indent) stack.pop();
    (stack.length > 0 ? stack[stack.length - 1]!.children : roots).push(node);
    stack.push(node);
  }
  return roots;
}

function parseSource(text: string, format: string): ExternalNode[] {
  if (format === 'opml' || format === 'dynalist') {
    let nodes = parseOpml(text);
    // §28 table inverse: the exported `→ X.md#Y` marker restores as `see: X.md#Y`
    // (QA-05 F16 / QA-09 D9 — refs must survive the OPML round-trip).
    nodes = mapText(nodes, (t) => convertArrowRefs(t));
    if (format === 'dynalist') {
      // dynalist exports carry app metadata (^block-ids, #tags, emphasis) inside text
      nodes = mapText(nodes, (t) => stripMetadata(t, 'dynalist'));
    }
    return nodes;
  }
  if (format === 'logseq') return toTree(parseLogseq(text));
  if (format === 'obsidian') return toTree(parseObsidian(stripFrontmatter(text)));
  return [];
}

/** Max spec number in the target dir + 1 (starts at 7). */
function nextSpecNumber(targetDir: string): number {
  let max = 6;
  for (const rel of discoverSpecFiles(targetDir)) {
    const m = basename(rel).match(/^(\d{2})-/);
    if (m !== null) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** Existing spec file with the same slug (ignoring the NN- prefix) — merge target. */
function findExistingBySlug(targetDir: string, slug: string): string | null {
  for (const rel of discoverSpecFiles(targetDir)) {
    const stripped = basename(rel).replace(/\.md$/, '').replace(/^\d{2}-/, '');
    if (slugify(stripped) === slug) return rel;
  }
  return null;
}

interface MergeOutcome {
  content: string | null; // null = no write (ask)
  conflicts: ImportConflict[];
}

/**
 * Tree-level merge (QA-05 F8/F9, issue #20). One single-pass walk of the import
 * tree: for each imported node, match it against the existing tree by normalized
 * text (global exact index) and, failing that, against its sibling slot by word
 * overlap; brand-new nodes are inserted under the CORRECT parent so tree
 * position is preserved (the old flat-append corrupts the hierarchy).
 *   exact normalized match → conflict only if text differs
 *     (cans-wins keeps the CANS text, import-wins overwrites it)
 *   near-match (word overlap ≥ 0.75) → conflict + strategy
 *   positional counterpart (overlap ≥ 0.5) → conflict + strategy
 *   diverged sibling (leading stem + word overlap, issue #20) → conflict +
 *     strategy — same concept reworded below the overlap layers, NEVER a
 *     silent duplicate sibling appended
 *   new node → inserted under the matched/near parent; `ask` reports it, no write
 */
function mergeInto(
  existingText: string,
  imported: ExternalNode[],
  strategy: MergeStrategy,
  relName: string,
): MergeOutcome {
  const conflicts: ImportConflict[] = [];
  const existingTree = parseFromCans(existingText);

  // Real source line per existing node text (first occurrence, document order).
  const lineOfKey = new Map<string, number>();
  existingText.split(/\r?\n/).forEach((l, i) => {
    if (!/^\s*-\s+/.test(l)) return;
    const k = normKey(parseCheckbox(l).clean);
    if (k !== '' && !lineOfKey.has(k)) lineOfKey.set(k, i + 1);
  });

  // Index existing nodes by normalized text (first occurrence wins).
  const existingIndex = new Map<string, ExternalNode>();
  const indexTree = (nodes: ExternalNode[]): void => {
    for (const n of nodes) {
      const k = normKey(n.text);
      if (k !== '' && !existingIndex.has(k)) existingIndex.set(k, n);
      indexTree(n.children);
    }
  };
  indexTree(existingTree);

  let newEntryLine = existingText.split(/\r?\n/).length; // approx. line for inserted content

  const mergeNodes = (importNodes: ExternalNode[], targetChildren: ExternalNode[]): void => {
    for (let i = 0; i < importNodes.length; i++) {
      const imp = importNodes[i]!;
      const key = normKey(imp.text);
      const exact = key !== '' ? existingIndex.get(key) : undefined;

      if (exact !== undefined) {
        // Matched by normalized text → conflict only when the wording differs.
        if (exact.text !== imp.text) {
          conflicts.push({
            file: relName,
            line: lineOfKey.get(key) ?? 0,
            cansVersion: exact.text,
            importVersion: imp.text,
            resolution: strategy,
          });
          if (strategy === 'import-wins') exact.text = imp.text;
          // cans-wins / ask: keep the CANS version
        }
        mergeNodes(imp.children, exact.children);
        continue;
      }

      // Near-match check against the siblings at this slot (word overlap).
      const near = targetChildren.find(c => isNearMatch(c.text, imp.text));
      if (near !== undefined) {
        conflicts.push({
          file: relName,
          line: lineOfKey.get(normKey(near.text)) ?? 0,
          cansVersion: near.text,
          importVersion: imp.text,
          resolution: strategy,
        });
        if (strategy === 'import-wins') near.text = imp.text;
        mergeNodes(imp.children, near.children);
        continue;
      }

      // Positional counterpart (QA-14 F2): under the SAME matched parent, the
      // imported node's own sibling slot holding a textually-related but
      // diverged node is the same concept re-imported with different wording —
      // a conflict per §35, never a silent duplicate sibling appended.
      const counterpart = targetChildren[i];
      if (counterpart !== undefined && isNearMatch(counterpart.text, imp.text, 0.5)) {
        conflicts.push({
          file: relName,
          line: lineOfKey.get(normKey(counterpart.text)) ?? 0,
          cansVersion: counterpart.text,
          importVersion: imp.text,
          resolution: strategy,
        });
        if (strategy === 'import-wins') counterpart.text = imp.text;
        // cans-wins / ask: keep the CANS version
        mergeNodes(imp.children, counterpart.children);
        continue;
      }

      // Diverged-sibling guard (issue #20): all three match layers missed, but
      // a node that shares the leading stem and corroborating word overlap with
      // an EXISTING sibling under the same parent is the same concept reworded
      // ("Sign up: TBD" → "Sign up: DONE - changed externally", overlap 0.4).
      // Per §27/§35 that is a conflict to surface — never a silent duplicate
      // sibling appended. cans-wins keeps the CANS text; import-wins
      // overwrites; ask reports (no write) — same strategy semantics as the
      // near-match and positional layers above.
      const diverged = targetChildren.find(c => isDivergedSibling(c.text, imp.text));
      if (diverged !== undefined) {
        conflicts.push({
          file: relName,
          line: lineOfKey.get(normKey(diverged.text)) ?? 0,
          cansVersion: diverged.text,
          importVersion: imp.text,
          resolution: strategy,
        });
        if (strategy === 'import-wins') diverged.text = imp.text;
        // cans-wins / ask: keep the CANS version
        mergeNodes(imp.children, diverged.children);
        continue;
      }

      if (strategy === 'ask') {
        // ask = report, don't merge: the would-be addition is surfaced too,
        // otherwise ask would silently drop new content with no trace.
        conflicts.push({
          file: relName,
          line: ++newEntryLine,
          cansVersion: '',
          importVersion: imp.text,
          resolution: 'ask',
        });
        continue;
      }

      // New node → insert under the correct parent, re-index so deeper
      // children can find it, then merge its subtree.
      const inserted: ExternalNode = { ...imp, children: [] };
      targetChildren.push(inserted);
      if (key !== '') existingIndex.set(key, inserted);
      mergeNodes(imp.children, inserted.children);
    }
  };

  mergeNodes(imported, existingTree);

  if (strategy === 'ask') return { content: null, conflicts };
  return { content: serializeToCans(existingTree), conflicts };
}

/** Merge-target fallback (QA-14 F2): when no spec file matches the imported
 *  slug, the file already holding the FIRST imported node's text (exact
 *  normalized match anywhere in its outline) is the merge target — a diverged
 *  re-import must land on the existing outline, not silently fork a duplicate
 *  home. First match in `discoverSpecFiles` order (deterministic). */
async function findExistingByRootText(targetDir: string, imported: ExternalNode[]): Promise<string | null> {
  const rootKey = normKey(imported[0].text);
  if (rootKey === '') return null;
  for (const rel of discoverSpecFiles(targetDir)) {
    let text = '';
    try {
      text = await readText(join(targetDir, rel));
    } catch {
      continue;
    }
    const hasRoot = (nodes: ExternalNode[]): boolean =>
      nodes.some(n => normKey(n.text) === rootKey || hasRoot(n.children));
    if (hasRoot(parseFromCans(text))) return rel;
  }
  return null;
}

/** §27/§28 (QA-09 D12): OPML/Dynalist exports carry the SOURCE SPEC FILENAME in
 *  `<head><title>` (e.g. `02-authentication.md`). When the title names a spec
 *  file it — not the first node's text — drives merge-target matching and
 *  new-file naming, so re-importing an edited export lands on the original
 *  file instead of silently forking. Other titles (e.g. "Project Backlog")
 *  fall back to first-node naming. */
const SPEC_TITLE_RE = /^\d{2}-[a-z0-9-]+(?:\.md)?$/i;

export async function run(args: string[]): Promise<ImportResult> {
  const opts = parseImportArgs(args);
  const fmt = opts.format.toLowerCase(); // §27 formats are lowercase; accept OPML/Obsidian casing

  // §20: the equals form is rejected before anything else — silently behaving
  // as the default strategy is worse than an error (QA-14 F3 / QA-06 #4).
  if (opts.invalidFlagForm !== null) {
    const flag = opts.invalidFlagForm.slice(2).split('=')[0];
    return fail(fmt, opts.path,
      `invalid flag form "${opts.invalidFlagForm}" — use "--${flag} <value>"`);
  }

  // §37/§27: invalid enum values are rejected, never silently defaulted (QA-05 F10).
  if (opts.mergeStrategyRaw !== null && !(STRATEGIES as readonly string[]).includes(opts.mergeStrategyRaw)) {
    return fail(fmt, opts.path,
      `unknown merge strategy "${opts.mergeStrategyRaw}" — valid: cans-wins, import-wins, ask`);
  }

  if (opts.path === '') {
    return fail(fmt, opts.path,
      'usage: cans import <format> <path>\n  Formats: opml, dynalist, logseq, obsidian');
  }
  if (!FORMATS.includes(fmt)) {
    return fail(fmt, opts.path,
      `unknown format "${opts.format}" — valid formats: opml, dynalist, logseq, obsidian`);
  }

  const files = sourceFiles(opts.path, fmt);
  if (files === null || files.length === 0) {
    return fail(fmt, opts.path,
      `source not found: ${opts.path}\n  Check the path and try again.`);
  }

  // §20/§36: --out overrides workspace discovery; otherwise a workspace is required.
  let workspace: string;
  if (opts.out !== null) {
    workspace = opts.out;
    if (!opts.dryRun) mkdirp(workspace);
  } else {
    const ws = resolveWorkspaceRoot();
    if (ws === null) {
      return fail(fmt, opts.path,
        'no cans workspace found — run `cans init` first, or pass --out <dir>');
    }
    workspace = ws;
  }

  const newFiles: string[] = [];
  const merged: string[] = [];
  const conflicts: ImportConflict[] = [];

  let nextNum = nextSpecNumber(workspace);

  for (const src of files) {
    let text = '';
    try {
      text = await readText(src);
    } catch {
      continue;
    }

    // §27/§28 (QA-09 D12): use the export's source-filename title as the file
    // identity when it names a spec file; otherwise first-node naming.
    let titleBase: string | null = null;
    if (fmt === 'opml' || fmt === 'dynalist') {
      const title = parseOpmlTitle(text);
      if (title !== null && SPEC_TITLE_RE.test(title)) {
        titleBase = title.replace(/\.md$/i, '');
      }
    }

    // §27: fenced code blocks under bullets are extracted to overflow files
    // before parsing, so their content survives as files + see: refs (QA-05 F5).
    let overflow: OverflowExtraction[] = [];
    let cleanText = text;
    if (fmt === 'obsidian' || fmt === 'logseq') {
      const baseSlug = slugify(basename(src).replace(/\.[^.]+$/, '')) || 'import';
      const extracted = extractOverflowContent(text, baseSlug);
      cleanText = extracted.cleanedSource;
      overflow = extracted.extractions;
    }

    let imported: ExternalNode[];
    try {
      imported = parseSource(cleanText, fmt);
    } catch (e) {
      // e.g. non-XML garbage passed as .opml (QA-05 F12) — fail loudly, write nothing.
      return fail(fmt, opts.path,
        `invalid OPML in ${basename(src)} — ${(e as Error).message}`);
    }
    if (imported.length === 0) continue;

    // Merge target: the export's source-file identity when available, else the
    // first node's text (QA-09 D12 — `02-authentication.opml` must re-match
    // 02-authentication.md, not slug the first node "sessions" into a fork).
    const slug = titleBase !== null
      ? slugify(titleBase.replace(/^\d{2}-/, ''))
      : slugify(imported[0].text);
    if (slug === '') continue;

    // Same-slug spec already present → merge; otherwise fall back to the file
    // already holding the first imported node's text (QA-14 F2 — a diverged
    // re-import must land on the existing outline, not fork a duplicate home);
    // otherwise a new NN-slug.md file.
    const existingRel =
      findExistingBySlug(workspace, slug) ??
      (await findExistingByRootText(workspace, imported));
    if (existingRel !== null) {
      const absTarget = join(workspace, existingRel);
      const outcome = mergeInto(
        await readText(absTarget),
        imported,
        opts.mergeStrategy,
        existingRel,
      );
      conflicts.push(...outcome.conflicts);
      if (outcome.content !== null) {
        if (!opts.dryRun) {
          await writeText(absTarget, canonicalizeRefTargets(outcome.content));
          for (const ovf of overflow) {
            const ovfAbs = join(workspace, ovf.overflowFile);
            mkdirp(dirname(ovfAbs));
            await writeText(ovfAbs, `${ovf.content}\n`);
          }
        }
        merged.push(existingRel);
        for (const ovf of overflow) newFiles.push(ovf.overflowFile);
      }
      continue;
    }

    // New file: preserve the source spec's NN-name identity when the export
    // carries it (QA-09 D12/D4), else the next free NN-first-node-slug.md.
    const relName = titleBase !== null
      ? `${titleBase}.md`
      : `${String(nextNum).padStart(2, '0')}-${slug}.md`;
    const absTarget = join(workspace, relName);

    const cansText = canonicalizeRefTargets(serializeToCans(imported));
    if (!opts.dryRun) {
      mkdirp(dirname(absTarget));
      await writeText(absTarget, cansText);
      for (const ovf of overflow) {
        const ovfAbs = join(workspace, ovf.overflowFile);
        mkdirp(dirname(ovfAbs));
        await writeText(ovfAbs, `${ovf.content}\n`);
      }
    }
    newFiles.push(relName);
    for (const ovf of overflow) newFiles.push(ovf.overflowFile);
    if (titleBase === null) nextNum++;
  }

  return {
    ok: true, command: 'import', exitCode: 0,
    format: fmt, source: opts.path, newFiles, merged, conflicts,
    dryRun: opts.dryRun || undefined,
  };
}
