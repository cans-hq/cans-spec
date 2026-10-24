/** Issue #57 — pointer aliasing: footnote-style short aliases for repeated
 *  `see:` targets.
 *
 *  One verified definition per file (`- [1]: full/target.md#Anchor`,
 *  footnote-style at the end of the file), short fully-counted uses
 *  (`see: [1]`). The checker contract (issue #57):
 *
 *  - An alias resolves EXACTLY like the full pointer it stands for: file
 *    existence, anchor match, declared external root (#55's `name://`
 *    pointers), traversal containment, duplicate-home and orphan_check all
 *    apply with the same error rules. A broken alias definition fails the run.
 *  - Every alias use counts as a ref for graph, hop, SCC and orphan purposes,
 *    exactly as if the full target were written. Resolution happens at load
 *    time (BEFORE the ref graph is built): the use's RefTarget is replaced by
 *    the full pointer's RefTarget — same file, anchor and raw spelling the
 *    parser would have minted for the expanded form — so aliasing cannot hide
 *    graph edges or dodge deep-hop checks, and checker output is IDENTICAL
 *    between the aliased and expanded forms of a file (graph-identity).
 *  - Undefined alias = broken-ref error. Unused alias = warning (dead weight,
 *    not a broken graph — but its TARGET is still verified: a broken
 *    definition fails the run even with zero uses).
 *  - Scope is the defining file only (footnote-like): no cross-file alias
 *    leakage, no global alias tables in v1.
 *  - Definition lines are file metadata, never outline nodes (parseOutline
 *    skips them via outline.ts's ALIAS_DEF_RE): they never count against
 *    node_length, sibling caps, depth, style or redundancy — aliasing must
 *    not move the 90-char problem from N use sites to one definition site.
 *  - Backwards compatible: aliasing is opt-in (`references.aliasing.enabled`,
 *    default false) and full-pointer corpora pass unchanged. Aliasing
 *    DISABLED plus any alias use or definition present is an ERROR, never a
 *    silent pass — the fix is `cans alias expand`, not acceptance.
 *
 *  This module owns the whole feature's semantics: the name grammar, alias
 *  table extraction, use resolution (refs + node text, in-memory
 *  as-if-expanded), the definition-level check pass (unused / min_uses /
 *  zero-use target verification), and the byte-preserving expand/collapse
 *  source transforms behind `cans alias` (commands/alias.ts orchestrates). */
import type { AliasingRules, Issue, OutlineNode, RefTarget } from '../types.ts';
import {
  REF_RE, flattenNodes, matchAliasDefinition,
  stripRefTrailingPunct, stripRefTrailingPunctBracketAware,
} from './outline.ts';
import { checkRefs, type ExternalRefsConfig, type RefGraph } from './refs.ts';

// ── Grammar ─────────────────────────────────────────────────────────────────

/** Numeric alias names: `[1]`, `[2]`, … — digits only (the footnote form). */
const NUMERIC_ALIAS_RE = /^[0-9]+$/;
/** Named alias names: `[hyper]` — a lowercase word (same shape as the §18
 *  external-root name grammar: it can never be confused with a path or URL). */
const NAMED_ALIAS_RE = /^[a-z][a-z0-9_-]*$/;

/** Fence marker rule, mirrored from src/core/outline.ts (issue #6): a line
 *  whose trimmed form starts with ``` toggles fence state. Must never diverge. */
const FENCE_RE = /^```/;

// Mirror of outline.ts's BULLET_RE (bullet-ness only — the transforms never
// need the captures). Must never diverge: refs live on bullet lines only, so
// only bullet lines are ever rewritten.
const BULLETISH_RE = /^\s*-\s+/;

/** The §18 default aliasing block: disabled, file scope, both styles,
 *  min_uses 2 (issue #57: "defaults when the block is absent … and
 *  full-pointer corpora pass unchanged"). */
export function defaultAliasing(): AliasingRules {
  return { enabled: false, scope: 'file', style: 'both', min_uses: 2 };
}

/** Is `name` a grammar-legal alias name (numeric or named)? */
export function legalAliasName(name: string): boolean {
  return NUMERIC_ALIAS_RE.test(name) || NAMED_ALIAS_RE.test(name);
}

/** The style class of a legal alias name: all-digits → numeric, letter-led →
 *  named. Drives the references.aliasing.style enforcement. */
export function aliasNameStyle(name: string): 'numeric' | 'named' {
  return NUMERIC_ALIAS_RE.test(name) ? 'numeric' : 'named';
}

/** The alias-use token inside a see: raw match: `[1]` (numeric) or `[hyper]`
 *  (named), or null when the token is not a grammar-legal bracketed alias
 *  use. Bracketed prose that is NOT alias-shaped (`[Bad_Name]`, `[a]b`, a
 *  bare `[1` from the #48 strip) is deliberately NOT an alias use: it keeps
 *  its exact pre-#57 treatment (see-like-prose warning at resolution time),
 *  never a silent rewrite. */
export function aliasUseName(token: string): string | null {
  if (!token.startsWith('[') || !token.endsWith(']') || token.length < 3) return null;
  const name = token.slice(1, -1);
  return legalAliasName(name) ? name : null;
}

// ── Alias tables (per-file definition extraction) ───────────────────────────

/** One alias definition — the FIRST definition of a grammar-legal name. */
export interface AliasDef {
  name: string;
  /** Full pointer file token, exactly as written (§48-stripped). */
  target: string;
  anchor: string | null;
  /** 1-based source line of the definition. */
  line: number;
}

/** One definition-SHAPED line, legal or not — the raw material for the
 *  config-aware issue pass. `primary` marks the first definition of a
 *  grammar-legal name (the one that resolves); duplicates and illegal names
 *  carry their own errors instead. */
export interface AliasLine {
  line: number;
  name: string;
  target: string;
  anchor: string | null;
  nameLegal: boolean;
  /** False when the target is itself alias-shaped (`- [1]: [2]`) —
   *  definitions must hold the FULL pointer, never another alias: one level
   *  of indirection, no chains, no cycles. */
  targetLegal: boolean;
  primary: boolean;
}

/** A file's alias surface: every definition-shaped line plus the resolvable
 *  table (first definition wins; duplicates error). */
export interface AliasTable {
  lines: AliasLine[];
  defs: Map<string, AliasDef>;
}

/** Extract a file's alias definitions from its source. Fence-aware (a
 *  definition quoted inside a ``` block is documentation, not a definition —
 *  same toggle rule as parseOutline/extractBackPointers); position-
 *  independent (the convention is a block at the END of the file, but a
 *  definition anywhere outside a fence is recognized — it can never silently
 *  become a stray outline node, parseOutline skips the same shape). Pure
 *  syntax: config-aware reporting is aliasDefinitionIssues. */
export function extractAliases(source: string): AliasTable {
  const lines = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out: AliasLine[] = [];
  const defs = new Map<string, AliasDef>();
  let fenceOpen = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.trim().startsWith('```')) {
      fenceOpen = !fenceOpen;
      continue;
    }
    if (fenceOpen) continue;
    const m = matchAliasDefinition(raw);
    if (m === null) continue;
    const nameLegal = legalAliasName(m.name);
    const targetLegal = !m.target.startsWith('[');
    const primary = nameLegal && !defs.has(m.name);
    out.push({
      line: i + 1,
      name: m.name,
      target: m.target,
      anchor: m.anchor,
      nameLegal,
      targetLegal,
      primary,
    });
    if (primary) {
      defs.set(m.name, { name: m.name, target: m.target, anchor: m.anchor, line: i + 1 });
    }
  }
  return { lines: out, defs };
}

/** Config-aware definition-line issues (per file, at load time):
 *  - aliasing disabled: EVERY definition-shaped line is an error (the file
 *    opted into aliasing syntax while the config opted out — expand is the
 *    fix, never silent acceptance);
 *  - aliasing enabled: illegal names, alias-shaped targets and duplicate
 *    definitions are line-numbered errors.
 *  Broken TARGETS (file existence, anchors) are verified later, in
 *  finishAliasChecks — the unused ones via the same checkRefs machinery a
 *  full pointer would hit, the used ones through their own resolved uses. */
export function aliasDefinitionIssues(table: AliasTable, file: string, cfg: AliasingRules): Issue[] {
  const issues: Issue[] = [];
  if (!cfg.enabled) {
    for (const l of table.lines) {
      issues.push({
        file, line: l.line, level: 'error', category: 'refs',
        message: `aliasing is disabled: "[${l.name}]: ${l.target}${l.anchor !== null ? `#${l.anchor}` : ''}" — references.aliasing.enabled is false`,
        rule: 'refs.alias.disabled',
        suggestion: 'enable aliasing under references.aliasing in _rules.yaml, or run `cans alias expand` to restore full targets',
      });
    }
    return issues;
  }
  const firstLine = new Map<string, number>();
  for (const l of table.lines) {
    if (!l.nameLegal) {
      issues.push({
        file, line: l.line, level: 'error', category: 'refs',
        message: `invalid alias name: "[${l.name}]" — alias names are [1]-style numbers or lowercase [a-z][a-z0-9_-]* words`,
        rule: 'refs.alias.bad-name',
        suggestion: 'rename the alias (lowercase word or number), or make the line ordinary outline content',
      });
      continue;
    }
    if (!l.targetLegal) {
      issues.push({
        file, line: l.line, level: 'error', category: 'refs',
        message: `alias definition targets an alias: "[${l.name}]: ${l.target}" — definitions must hold the full pointer`,
        rule: 'refs.alias.bad-target',
        suggestion: 'write the full target on the definition — alias chains are not supported (one level of indirection)',
      });
      continue;
    }
    if (l.primary) {
      firstLine.set(l.name, l.line);
      continue;
    }
    issues.push({
      file, line: l.line, level: 'error', category: 'refs',
      message: `duplicate alias definition: [${l.name}] — already defined at line ${firstLine.get(l.name) ?? '?'}`,
      rule: 'refs.alias.duplicate',
      suggestion: 'keep exactly one definition per alias name (the first resolves; the rest are dead weight)',
    });
  }
  return issues;
}

// ── Use resolution (in-memory as-if-expanded) ───────────────────────────────

/** One see: ref span in a text, in the parser's own coordinates — the shared
 *  scanner behind use resolution and the expand/collapse rewriters. Spans
 *  skip exactly the matches parseOutline skips (§11 + the issue #48
 *  empty-after-strip rule, NON-bracket-aware for the skip decision so the
 *  spans stay aligned with parseOutline's minted refs), while the FILE token
 *  is identified with the BRACKET-aware strip so a parenthesized alias use
 *  (`(see: [1])`) keeps its structural `]`. */
interface RefSpan {
  /** Start of the file token inside the text. */
  tokenStart: number;
  /** End of the POINTER = file token + `#anchor` when present. Glued sentence
 *  punctuation after it belongs to the prose, never the pointer — EXCEPT a
 *  degenerate anchor that strips to nothing (`see: x#)`): its whole raw run
 *  is garbage and joins the span, or a collapse would leave `[1]#)` behind. */
  pointerEnd: number;
  /** Bracket-aware-stripped file token (the alias-use candidate). */
  fileTok: string;
  /** Stripped anchor token, null for file-level refs. */
  anchorTok: string | null;
}

function scanRefSpans(text: string): RefSpan[] {
  const out: RefSpan[] = [];
  REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF_RE.exec(text)) !== null) {
    // Mirror parseOutline's skip: a FILE token that strips to nothing is
    // pure-punctuation prose ("see .") — never a ref, never a span.
    if (stripRefTrailingPunct(m[1]!) === '') continue;
    const fileTok = stripRefTrailingPunctBracketAware(m[1]!);
    const prefix = m[0].match(/^see(?::\s*|\s+)/)![0].length;
    const tokenStart = m.index + prefix;
    let pointerEnd = tokenStart + fileTok.length;
    let anchorTok: string | null = null;
    if (m[2] !== undefined) {
      anchorTok = stripRefTrailingPunct(m[2]!);
      pointerEnd = anchorTok !== ''
        ? tokenStart + m[1]!.length + 1 + anchorTok.length
        : tokenStart + m[1]!.length + 1 + m[2]!.length;
      if (anchorTok === '') anchorTok = null;
    }
    out.push({ tokenStart, pointerEnd, fileTok, anchorTok });
  }
  return out;
}

/** The full-pointer spelling an alias use expands to (issue #57
 *  graph-identity): `see: [1]` + def → the raw parseOutline would have minted
 *  for `see: <target>[#anchor]` — same see-form (`see:` vs `see `), same
 *  glued trailing punctuation, only the token swapped. */
function expandedRaw(raw: string, def: AliasDef): string {
  REF_RE.lastIndex = 0;
  const m = REF_RE.exec(raw);
  if (m === null) return raw; // unreachable: raw IS a see: match
  const prefix = m[0].match(/^see(?::\s*|\s+)/)![0].length;
  const full = `${def.target}${def.anchor !== null ? `#${def.anchor}` : ''}`;
  return raw.slice(0, prefix) + full + raw.slice(prefix + m[1]!.length);
}

/** Resolve a file's alias USES in place: every grammar-legal bracketed see:
 *  token resolves to its definition's full pointer. The RefTarget is replaced
 *  wholesale (file/anchor/raw = the expanded spelling, plus the `alias`
 *  marker for diagnostics) and the node's TEXT has the alias token swapped
 *  for the full target — so structure/style/content/redundancy/slug-hint
 *  engines all see the as-if-expanded outline and their findings (including
 *  quoted node text) are identical between the two forms.
 *
 *  Unresolvable uses (aliasing disabled, undefined name, anchored use) are
 *  DROPPED from the ref graph and reported here — the alias layer owns
 *  bracketed tokens; a broken alias use must not double-report as see-like
 *  prose. A style VIOLATION on an otherwise-defined use still resolves (the
 *  error is about the spelling, not the target: "an alias resolves exactly
 *  like the full pointer it stands for"). Returns the use-level issues. */
export function resolveFileAliases(
  nodes: OutlineNode[],
  table: AliasTable,
  file: string,
  cfg: AliasingRules,
): Issue[] {
  const issues: Issue[] = [];
  for (const node of flattenNodes(nodes)) {
    const spans = scanRefSpans(node.text);
    // spans and node.refs are aligned by construction: both scan the same
    // text with the same regex and the same skip rule, in match order.
    const newRefs: RefTarget[] = [];
    const textEdits: Array<{ start: number; end: number; full: string }> = [];
    let touched = false;
    for (let i = 0; i < node.refs.length; i++) {
      const ref = node.refs[i]!;
      const span = spans[i];
      if (span === undefined) continue; // defensive: never mis-aligned in practice
      const name = aliasUseName(span.fileTok);
      if (name === null) {
        newRefs.push(ref); // ordinary (full-pointer or prose) ref — untouched
        continue;
      }
      const useSpelling = node.text.slice(span.tokenStart, span.pointerEnd);
      touched = true;
      if (!cfg.enabled) {
        issues.push({
          file, line: ref.line, level: 'error', category: 'refs',
          message: `aliasing is disabled: "see: [${name}]" — references.aliasing.enabled is false`,
          rule: 'refs.alias.disabled',
          suggestion: 'enable aliasing under references.aliasing in _rules.yaml, or run `cans alias expand` to restore full targets',
        });
        continue; // dropped: the alias layer owns bracketed tokens
      }
      if (span.anchorTok !== null) {
        // An anchored alias use (`see: [1]#Anchor`) is ambiguous authoring:
        // the definition already carries the pointer's anchor. Refuse the
        // resolution rather than guessing a merge — one clean error.
        const anchored = table.defs.get(name);
        issues.push({
          file, line: ref.line, level: 'error', category: 'refs',
          message: anchored !== undefined
            ? `alias use carries an anchor: "${useSpelling}" — anchors live on the definition (line ${anchored.line})`
            : `alias use carries an anchor: "${useSpelling}" — [${name}] is not defined in this file`,
          rule: 'refs.alias.bad-use',
          suggestion: 'drop the anchor from the use and put it on the definition, or write the full see: target',
        });
        continue; // dropped
      }
      const def = table.defs.get(name);
      if (def === undefined) {
        issues.push({
          file, line: ref.line, level: 'error', category: 'refs',
          message: `undefined alias: see [${name}] — not defined in this file`,
          rule: 'refs.alias.undefined',
          suggestion: `add "- [${name}]: <full target>" to this file's definitions, or write the full see: target`,
        });
        continue; // dropped
      }
      if (cfg.style !== 'both' && aliasNameStyle(name) !== cfg.style) {
        issues.push({
          file, line: ref.line, level: 'error', category: 'refs',
          message: `alias style violation: "[${name}]" is ${aliasNameStyle(name)}, but references.aliasing.style is "${cfg.style}"`,
          rule: 'refs.alias.style',
          suggestion: `set references.aliasing.style to "both" (or spell the aliases in ${cfg.style} form), or run \`cans alias expand\` and collapse again`,
        });
        // style error only — the use still resolves (see docblock).
      }
      const full = `${def.target}${def.anchor !== null ? `#${def.anchor}` : ''}`;
      newRefs.push({
        raw: expandedRaw(ref.raw, def),
        file: def.target,
        anchor: def.anchor,
        line: ref.line,
        alias: { name: def.name, defLine: def.line },
      });
      textEdits.push({ start: span.tokenStart, end: span.pointerEnd, full });
    }
    if (!touched) continue;
    node.refs = newRefs;
    // Apply the text edits right-to-left so earlier spans stay valid.
    for (let k = textEdits.length - 1; k >= 0; k--) {
      const e = textEdits[k]!;
      node.text = node.text.slice(0, e.start) + e.full + node.text.slice(e.end);
    }
  }
  return issues;
}

// ── Definition-level finish pass (needs the whole loaded set) ───────────────

/** The second half of the alias check, run once the whole spec set is loaded
 *  and the graph is built (needs `files` for anchor resolution and the
 *  external-root config for `name://` targets):
 *
 *  - UNUSED aliases → warning (dead weight, not a broken graph) — and their
 *    targets are VERIFIED anyway: a broken alias definition fails the run
 *    even with zero uses (issue contract 1: "not just the uses"). The
 *    verification mints each zero-use definition as one synthetic ref and
 *    runs it through the SAME checkRefs machinery a full pointer would hit
 *    (existence, anchors, external roots, containment, transient/_collab,
 *    self-refs) — same message shapes, same refs.broken counter, definition
 *    line as the location. Used definitions need no separate verification:
 *    their uses resolve to the same target and are verified as ordinary refs
 *    (graph-identity: the expanded form has exactly the uses' errors, so the
 *    collapsed form must not add one more at the definition site).
 *  - min_uses: a USED alias whose target is referenced fewer than
 *    min_uses times in the file (alias uses + full spellings) is an error —
 *    indirection with no saving; such targets must stay full pointers. An
 *    alias with ZERO uses is the unused case above (warning only): it is not
 *    live at all, there is nothing whose saving to audit. */
export function finishAliasChecks(
  files: Map<string, OutlineNode[]>,
  tables: Map<string, AliasTable>,
  root: string,
  external: ExternalRefsConfig,
  cfg: AliasingRules,
): Issue[] {
  const issues: Issue[] = [];
  const verifyForward = new Map<string, RefTarget[]>();
  for (const file of [...files.keys()].sort()) {
    const table = tables.get(file);
    if (table === undefined) continue;
    if (!cfg.enabled) continue; // disabled files already errored at load
    // Per-definition use counts over the RESOLVED refs of this file.
    const usesByName = new Map<string, number>();
    const fullsByTarget = new Map<string, number>();
    for (const node of flattenNodes(files.get(file)!)) {
      for (const ref of node.refs) {
        if (ref.alias !== undefined) {
          usesByName.set(ref.alias.name, (usesByName.get(ref.alias.name) ?? 0) + 1);
        } else {
          const key = `${ref.file}\0${ref.anchor ?? ''}`;
          fullsByTarget.set(key, (fullsByTarget.get(key) ?? 0) + 1);
        }
      }
    }
    const verify: RefTarget[] = [];
    for (const l of table.lines) {
      if (!l.primary || !l.nameLegal || !l.targetLegal) continue; // already errored at load
      const uses = usesByName.get(l.name) ?? 0;
      if (uses === 0) {
        issues.push({
          file, line: l.line, level: 'warning', category: 'refs',
          message: `unused alias: [${l.name}] (line ${l.line}) is never used`,
          rule: 'refs.alias.unused',
          suggestion: 'remove the definition, or point a see: at it — unused aliases are dead weight, not broken refs',
        });
        verify.push({
          raw: `see: ${l.target}${l.anchor !== null ? `#${l.anchor}` : ''}`,
          file: l.target,
          anchor: l.anchor,
          line: l.line,
        });
        continue;
      }
      const fulls = fullsByTarget.get(`${l.target}\0${l.anchor ?? ''}`) ?? 0;
      if (uses + fulls < cfg.min_uses) {
        const total = uses + fulls;
        issues.push({
          file, line: l.line, level: 'error', category: 'refs',
          message: `alias below min_uses: [${l.name}] → ${l.target}${l.anchor !== null ? `#${l.anchor}` : ''} used ${total} time${total === 1 ? '' : 's'}, but references.aliasing.min_uses is ${cfg.min_uses} — targets used fewer than ${cfg.min_uses} times must stay full pointers`,
          rule: 'refs.alias.min_uses',
          suggestion: `expand this alias back to full pointers (\`cans alias expand\`), or lower references.aliasing.min_uses`,
        });
      }
    }
    if (verify.length > 0) verifyForward.set(file, verify);
  }
  if (verifyForward.size > 0) {
    // Zero-use definitions: verified through checkRefs on a mini graph whose
    // forward map holds exactly these synthetic refs (one per definition) —
    // identical error shapes to a full pointer, definition line as location,
    // and NEVER counted in refs.total (definitions are the spelling, uses are
    // the refs — graph-identity between the two forms of a file).
    const graph: RefGraph = {
      forward: verifyForward,
      back: [...verifyForward.entries()].flatMap(([file, refs]) =>
        refs.map(r => ({ fromFile: file, fromLine: r.line, toFile: r.file, toAnchor: r.anchor }))),
    };
    issues.push(...checkRefs(files, graph, root, external));
  }
  return issues;
}

// ── Source transforms (cans alias expand / collapse) ────────────────────────
//
// Byte-preserving line surgery, mirroring commands/check.ts's rewriteRefBy /
// repairAnchors discipline (issues #6/#19/#21): each line keeps its own
// terminator (a CRLF file stays CRLF), only a line's TEXT is ever edited,
// dropped lines vanish with their terminators, and inserted lines mint the
// file's dominant EOL. The SourceLine splitter must never diverge from
// check.ts's — line indices are what parseOutline and extractAliases see.

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
  out.push({ text: source.slice(start), eol: null });
  return out;
}

function joinSourceLines(lines: SourceLine[]): string {
  let out = '';
  for (const l of lines) out += l.text + (l.eol ?? '');
  return out;
}

/** The outcome of one expand/collapse transform over one file's source. */
export interface AliasTransform {
  /** Rewritten source; the ORIGINAL bytes when unchanged or refused. */
  source: string;
  changed: boolean;
  usesRewritten: number;
  definitionsRemoved: number;
  definitionsAdded: number;
  definitionsKept: number;
  /** §37 refusals: the file must be left byte-identical. */
  problems: string[];
}

/** Normalize a line array's EOF in place: no trailing blank lines, the last
 *  surviving line terminated with the file's dominant EOL (issue #21
 *  discipline — inserted/appended content never mints a foreign EOL). */
function normalizeEof(lines: SourceLine[]): void {
  while (lines.length > 0 && lines[lines.length - 1]!.text.trim() === '') lines.pop();
  if (lines.length === 0) return;
  let crlf = 0;
  let lf = 0;
  for (const l of lines) {
    if (l.eol === '\r\n') crlf++;
    else if (l.eol === '\n') lf++;
  }
  if (lines[lines.length - 1]!.eol === null) lines[lines.length - 1]!.eol = crlf > lf ? '\r\n' : '\n';
}

/** `cans alias expand` — alias uses become full targets, definitions are
 *  removed. Idempotent (an expanded file has no definitions and no
 *  alias-shaped tokens: a no-op returns the source byte-identical), lossless
 *  for non-pointer text (only see: tokens and definition lines change), and
 *  safe: an undefined alias, an anchored alias use, a duplicate/illegal
 *  definition or an alias-targeting definition REFUSES the whole file —
 *  never a silent rewrite. Unused definitions are simply removed (expand is
 *  the cleanup path for dead weight). */
export function expandAliases(source: string, file: string): AliasTransform {
  const lines = splitSourceLines(source);
  const problems: string[] = [];
  const table = extractAliases(source);
  const defs = new Map<string, { target: string; anchor: string | null; line: number }>();
  for (const l of table.lines) {
    if (!l.nameLegal) {
      problems.push(`${file}:${l.line} — invalid alias name "[${l.name}]" — expand only rewrites legal aliases; fix or remove the line first`);
      continue;
    }
    if (!l.targetLegal) {
      problems.push(`${file}:${l.line} — alias definition targets an alias ("[${l.name}]: ${l.target}") — definitions must hold the full pointer`);
      continue;
    }
    if (defs.has(l.name)) {
      problems.push(`${file}:${l.line} — duplicate alias definition [${l.name}] (first at line ${defs.get(l.name)!.line}) — keep exactly one`);
      continue;
    }
    defs.set(l.name, { target: l.target, anchor: l.anchor, line: l.line });
  }

  // Which 0-based line indices are definition lines (to drop) — from the
  // same fence-aware extraction, so a fenced copy of a definition is content.
  const defLineIdx = new Set<number>(table.lines.map(l => l.line - 1));

  let usesRewritten = 0;
  const rewrites: Array<{ line: number; start: number; end: number; full: string }> = [];
  let fenceOpen = false;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!.text;
    if (FENCE_RE.test(text.trim())) {
      fenceOpen = !fenceOpen;
      continue;
    }
    if (fenceOpen || defLineIdx.has(i) || !BULLETISH_RE.test(text)) continue;
    for (const span of scanRefSpans(text)) {
      const name = aliasUseName(span.fileTok);
      if (name === null) continue;
      const def = defs.get(name);
      if (def === undefined) {
        problems.push(`${file}:${i + 1} — undefined alias [${name}] — add a definition or write the full target`);
        continue;
      }
      if (span.anchorTok !== null) {
        problems.push(`${file}:${i + 1} — alias use carries an anchor ([${name}]#${span.anchorTok}) — anchors live on the definition (line ${def.line})`);
        continue;
      }
      rewrites.push({
        line: i,
        start: span.tokenStart,
        end: span.pointerEnd,
        full: `${def.target}${def.anchor !== null ? `#${def.anchor}` : ''}`,
      });
      usesRewritten++;
    }
  }

  if (problems.length > 0) {
    return {
      source, changed: false, usesRewritten: 0, definitionsRemoved: 0,
      definitionsAdded: 0, definitionsKept: 0, problems,
    };
  }
  if (usesRewritten === 0 && defLineIdx.size === 0) {
    return {
      source, changed: false, usesRewritten: 0, definitionsRemoved: 0,
      definitionsAdded: 0, definitionsKept: 0, problems,
    };
  }

  // Apply the token rewrites right-to-left per line.
  for (let k = rewrites.length - 1; k >= 0; k--) {
    const r = rewrites[k]!;
    const line = lines[r.line]!;
    line.text = line.text.slice(0, r.start) + r.full + line.text.slice(r.end);
  }
  // Drop the definition lines (with their terminators), then normalize the
  // EOF: no trailing blank lines, the last surviving line terminated with the
  // dominant EOL. "modulo definition placement" (issue #57): the round trip
  // lands on this canonical shape, and a second expand of it is a
  // byte-identical no-op.
  const kept = lines.filter((_, i) => !defLineIdx.has(i));
  normalizeEof(kept);
  return {
    source: joinSourceLines(kept),
    changed: true,
    usesRewritten,
    definitionsRemoved: defLineIdx.size,
    definitionsAdded: 0,
    definitionsKept: 0,
    problems,
  };
}

/** Sanitize a string into a grammar-legal named-alias base: lowercase,
 *  non-[a-z0-9_-] runs collapsed to one `-`, edges trimmed. */
function sanitizeAliasBase(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Derive a deterministic, collision-free named alias for a target: the
 *  anchor when present, else the file stem (numeric prefix like `02-`
 *  stripped — `[authentication]`, not `[02-authentication]`); sanitized into
 *  the name grammar (`[virtio-device-complex]`) and suffixed -2, -3, … on
 *  collision with an already-taken name. */
function deriveAliasName(target: string, anchor: string | null, taken: Set<string>): string {
  let base: string;
  if (anchor !== null && anchor !== '') {
    base = sanitizeAliasBase(anchor);
  } else {
    const seg = target.split('/').pop() ?? target;
    const stem = seg.replace(/\.[^.]+$/, '');
    base = sanitizeAliasBase(stem.replace(/^\d+-/, ''));
  }
  if (base === '' || !/^[a-z]/.test(base)) base = base === '' ? 'ref' : `ref-${base}`;
  let name = base;
  let n = 2;
  while (taken.has(name)) name = `${base}-${n++}`;
  return name;
}

/** `cans alias collapse` — repeated full targets become definitions plus
 *  short uses, following the aliasing config (style, min_uses), with
 *  deterministic numbering in first-use order. Existing definitions are KEPT
 *  in place and reused (no renumbering churn — idempotence: collapsing an
 *  already-collapsed file is a byte-identical no-op); only NEW targets get
 *  new names, numbered after the highest existing numeric (numeric/both) or
 *  derived from the target (named). Refuses — leaving the file
 *  byte-identical — on undefined/anchored alias uses, duplicate or illegal
 *  definitions, style conflicts with the config (existing aliases of the
 *  other style: expand first), min_uses violations an existing alias already
 *  perpetrates, and an unterminated code fence at EOF (appending a
 *  definitions block there would corrupt the fenced region). Unused existing
 *  definitions are left in place (dead weight is a check-time WARNING, and
 *  collapse may resurrect one when its target gains uses). */
export function collapseAliases(source: string, file: string, cfg: AliasingRules): AliasTransform {
  const lines = splitSourceLines(source);
  const problems: string[] = [];
  const table = extractAliases(source);
  const defs = table.defs;

  let fenceOpen = false;
  const inFence: boolean[] = new Array(lines.length).fill(false);
  const defLineIdx = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i]!.text.trim())) {
      inFence[i] = true;
      fenceOpen = !fenceOpen;
      continue;
    }
    inFence[i] = fenceOpen;
    if (!inFence[i] && matchAliasDefinition(lines[i]!.text) !== null) defLineIdx.add(i);
  }
  if (fenceOpen) {
    problems.push(`${file} — unterminated code fence at end of file — a definitions block cannot be appended inside it`);
  }
  for (const l of table.lines) {
    if (!l.nameLegal) {
      problems.push(`${file}:${l.line} — invalid alias name "[${l.name}]" — fix or remove the line first`);
    } else if (!l.targetLegal) {
      problems.push(`${file}:${l.line} — alias definition targets an alias ("[${l.name}]: ${l.target}") — definitions must hold the full pointer`);
    } else if (!l.primary) {
      problems.push(`${file}:${l.line} — duplicate alias definition [${l.name}] — keep exactly one`);
    } else if (cfg.style === 'numeric' && aliasNameStyle(l.name) === 'named') {
      problems.push(`${file}:${l.line} — existing named alias [${l.name}] conflicts with references.aliasing.style: "numeric" — run \`cans alias expand\` first, or set style to "both"`);
    } else if (cfg.style === 'named' && aliasNameStyle(l.name) === 'numeric') {
      problems.push(`${file}:${l.line} — existing numeric alias [${l.name}] conflicts with references.aliasing.style: "named" — run \`cans alias expand\` first, or set style to "both"`);
    }
  }

  // Scan the bullet lines: count full pointers per (file, anchor) and alias
  // uses per definition; refuse the unsafe ones.
  interface FullRef { line: number; start: number; end: number }
  const fullsByKey = new Map<string, { target: string; anchor: string | null; refs: FullRef[] }>();
  const usesByDef = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    if (inFence[i] || defLineIdx.has(i)) continue;
    const text = lines[i]!.text;
    if (!BULLETISH_RE.test(text)) continue;
    for (const span of scanRefSpans(text)) {
      const name = aliasUseName(span.fileTok);
      if (name === null) {
        // A full pointer: group by the stripped (file, anchor) spelling —
        // the same key the checker's min_uses audit counts.
        const key = `${span.fileTok}\0${span.anchorTok ?? ''}`;
        let group = fullsByKey.get(key);
        if (group === undefined) {
          group = { target: span.fileTok, anchor: span.anchorTok, refs: [] };
          fullsByKey.set(key, group);
        }
        group.refs.push({ line: i, start: span.tokenStart, end: span.pointerEnd });
        continue;
      }
      const def = defs.get(name);
      if (def === undefined) {
        problems.push(`${file}:${i + 1} — undefined alias [${name}] — add a definition or write the full target`);
        continue;
      }
      if (span.anchorTok !== null) {
        problems.push(`${file}:${i + 1} — alias use carries an anchor ([${name}]#${span.anchorTok}) — anchors live on the definition (line ${def.line})`);
        continue;
      }
      usesByDef.set(name, (usesByDef.get(name) ?? 0) + 1);
    }
  }

  // min_uses audit of EXISTING aliases (uses + full spellings of the same
  // target): collapse must never leave a violation behind — and refuses to
  // touch a file that already perpetrates one.
  for (const def of defs.values()) {
    const uses = usesByDef.get(def.name) ?? 0;
    if (uses === 0) continue; // unused: a check-time warning, left in place
    const fulls = fullsByKey.get(`${def.target}\0${def.anchor ?? ''}`)?.refs.length ?? 0;
    if (uses + fulls < cfg.min_uses) {
      const total = uses + fulls;
      problems.push(
        `${file}:${def.line} — alias [${def.name}] used ${total} time${total === 1 ? '' : 's'}, below references.aliasing.min_uses (${cfg.min_uses}) — expand it first or lower min_uses`,
      );
    }
  }

  if (problems.length > 0) {
    return {
      source, changed: false, usesRewritten: 0, definitionsRemoved: 0,
      definitionsAdded: 0, definitionsKept: 0, problems,
    };
  }

  // Eligibility: a target with full refs present is alias-eligible when its
  // TOTAL references (full spellings + uses of an existing alias of the same
  // target) reach min_uses — exactly the count the checker audits, so a
  // collapse output always passes the check-time rule.
  const targetKey = (t: string, a: string | null): string => `${t}\0${a ?? ''}`;
  const defByTarget = new Map<string, AliasDef>();
  for (const def of defs.values()) defByTarget.set(targetKey(def.target, def.anchor), def);
  const takenNames = new Set<string>([...defs.keys()]);
  let maxNumeric = 0;
  for (const name of defs.keys()) {
    if (NUMERIC_ALIAS_RE.test(name)) maxNumeric = Math.max(maxNumeric, Number(name));
  }
  const newDefs: AliasDef[] = [];
  const eligible: Array<{ group: { target: string; anchor: string | null; refs: FullRef[] }; name: string }> = [];
  for (const [key, group] of fullsByKey) {
    if (group.refs.length === 0) continue;
    const existing = defByTarget.get(key);
    const uses = existing !== undefined ? (usesByDef.get(existing.name) ?? 0) : 0;
    if (group.refs.length + uses < cfg.min_uses) continue; // must stay a full pointer
    let name: string;
    if (existing !== undefined) {
      name = existing.name; // reuse — no renumbering churn
    } else if (cfg.style === 'named') {
      name = deriveAliasName(group.target, group.anchor, takenNames);
      takenNames.add(name);
      newDefs.push({ name, target: group.target, anchor: group.anchor, line: 0 });
    } else {
      // numeric — also the style: both default for NEW aliases (the shortest
      // form, matching the footnote intuition)
      do {
        maxNumeric += 1;
      } while (takenNames.has(String(maxNumeric)));
      name = String(maxNumeric);
      takenNames.add(name);
      newDefs.push({ name, target: group.target, anchor: group.anchor, line: 0 });
    }
    eligible.push({ group, name });
  }

  let usesRewritten = 0;
  const rewrites: Array<{ line: number; start: number; end: number; name: string }> = [];
  for (const e of eligible) {
    for (const r of e.group.refs) {
      rewrites.push({ line: r.line, start: r.start, end: r.end, name: e.name });
      usesRewritten++;
    }
  }

  if (usesRewritten === 0 && newDefs.length === 0) {
    return {
      source, changed: false, usesRewritten: 0, definitionsRemoved: 0,
      definitionsAdded: 0, definitionsKept: defs.size, problems,
    };
  }

  // Apply the rewrites right-to-left per line (full pointer → [name]).
  for (let k = rewrites.length - 1; k >= 0; k--) {
    const r = rewrites[k]!;
    const line = lines[r.line]!;
    line.text = `${line.text.slice(0, r.start)}[${r.name}]${line.text.slice(r.end)}`;
  }

  // Append the NEW definitions at EOF: continuing the definitions block when
  // the file already ends with one, else after exactly one blank separator
  // line. Inserted lines mint the file's dominant EOL (issue #21 discipline);
  // the final definition becomes the file's unterminated tail, byte-identical
  // to what a plain join produces.
  if (newDefs.length > 0) {
    normalizeEof(lines);
    let lastContent = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i]!.text.trim() !== '') {
        lastContent = i;
        break;
      }
    }
    const continuesBlock =
      lastContent >= 0 && !inFence[lastContent] && matchAliasDefinition(lines[lastContent]!.text) !== null;
    if (lines.length > 0 && !continuesBlock) {
      let crlf = 0;
      let lf = 0;
      for (const l of lines) {
        if (l.eol === '\r\n') crlf++;
        else if (l.eol === '\n') lf++;
      }
      lines.push({ text: '', eol: crlf > lf ? '\r\n' : '\n' });
    }
    for (const d of newDefs) {
      lines.push({
        text: `- [${d.name}]: ${d.target}${d.anchor !== null ? `#${d.anchor}` : ''}`,
        eol: lines.length > 0 ? (lines[lines.length - 1]!.eol ?? '\n') : '\n',
      });
    }
    if (lines.length > 0) lines[lines.length - 1]!.eol = null;
  }

  return {
    source: joinSourceLines(lines),
    changed: true,
    usesRewritten,
    definitionsRemoved: 0,
    definitionsAdded: newDefs.length,
    definitionsKept: defs.size,
    problems,
  };
}
