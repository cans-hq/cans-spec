/** Code-symbol anchors — issue #60: the addressable top-level-symbol
 *  vocabulary of CODE artifact targets (TS/JS family, Rust, Python, Go);
 *  issue #70: Rust grammar v2 (non-pub column-0 items + trait methods) and
 *  the extractCodeLeafNames referenced-names tier.
 *
 *  WHY THIS MODULE EXISTS. Before #60, an anchored ref aimed at a code
 *  artifact (`see: artifacts/code/parse.ts#createRule`) was structurally
 *  unresolvable: parseOutline mints bullet nodes, the schematic module
 *  mints mapping keys — a code file has neither — so the target's
 *  addressable vocabulary was empty and the ref fell to the issue #49
 *  `refs.anchor.no-target` advisory, even with `export function createRule`
 *  sitting in the file verbatim. The natural addressable units of a code
 *  file are its TOP-LEVEL SYMBOLS (exported functions, types, consts,
 *  modules — the issue's words), and this module is exactly that
 *  vocabulary, behind the same two-function surface schematic.ts exposes
 *  (extension detection + a vocabulary list) so the ref checker can consult
 *  it the same way (wiring: refs.ts checkArtifactAnchor, issue #60).
 *
 *  THE SYMBOL FORM. Names come back RAW — identifier-shaped, exactly as
 *  written (`createRule`, never a slug): resolution against a `#anchor`
 *  happens later through the same §12 anchorMatches normalization every
 *  other vocabulary uses (case-insensitive, folds the dash/underscore/
 *  space separator family — NOT camelCase: `#createRule` resolves against
 *  `createRule`, `#create-rule` does not, so the exact identifier spelling
 *  is the addressable one). Per language, TOP LEVEL = the line starts at
 *  COLUMN 0 (every mainstream formatter keeps top-level declarations
 *  flush-left, so indentation is the nesting signal) and the declaration
 *  fits one line:
 *
 *    TS/JS family (.ts .tsx .mts .cts .js .jsx .mjs .cjs) — one shared
 *      grammar, EXPORTED declarations only: `export` at column 0, then a
 *      bounded run of modifiers (default / async / abstract / declare, any
 *      order), then one of function / const / let / var / class /
 *      interface / type / enum (incl. `const enum`) / namespace (and its
 *      legacy synonym `module`), then the NAME — an identifier captured
 *      before any `(`, `=`, `<`, `extends`, `{`; generics sit after the
 *      name and are never part of it. `export default` with no name
 *      (anonymous function/class/object/scalar) yields nothing;
 *      `export * from` and `export { … }` re-exports yield nothing (they
 *      declare nothing — the declaration lives in another file); an
 *      unexported declaration yields nothing (a private helper is not part
 *      of the file's addressed surface — issue #70 narrowed #60's
 *      "exported-only" parity claim to Rust's pub(crate)/pub(super)
 *      restricted forms; the tsjs export gate itself stands). A heritage
 *      keyword where a name would sit
 *      (`export default class extends Base {}`) is rejected so
 *      `extends`/`implements` never mint as symbols.
 *
 *    Rust (.rs) — column-0 items, `pub` OPTIONAL (issue #70 revises
 *      #60's exported-only call: a non-pub declaration is still a code
 *      symbol — the kelir corpus's example artifacts hold `struct
 *      UserOracle;` and whole files of ONLY non-pub column-0 items
 *      (`enum WorkerAction`, `const SWARM_REGION`, `fn swarm_builder`,
 *      `async fn main`), which is exactly why their pointers drew
 *      no-target warnings; over-extraction is the documented fail-safe
 *      direction): optional `pub` at column 0, then a bounded run of
 *      modifiers (unsafe / async / const / extern [+ quoted ABI]), then one
 *      of fn / const / static (incl. `static mut`) / struct / enum / trait /
 *      type / mod / union, then the NAME. Crate-restricted visibility
 *      (`pub(crate)`, `pub(super)`, `pub(in …)`) still mints NOTHING — the
 *      regex fails on the `(` right after `pub`. Generics and lifetimes sit
 *      after the name (`pub fn parse<'a, T: Clone>(…)` → `parse`); a
 *      raw-identifier `r#` prefix is stripped so `#type` addresses
 *      `pub fn r#type()`. impls are not named symbols; their methods are
 *      indented and still mint nothing (the issue #70 LEAF tier —
 *      extractCodeLeafNames below — is their addressing net, not this
 *      grammar). TRAIT METHODS mint (issue #70: `async fn
 *      configure_runtime(&mut self)` inside `pub trait ContainerService`
 *      is addressable as `#configure_runtime`) via the trait-block tracker
 *      in extractCodeSymbols: a column-0 `trait` decl opens a tracked block
 *      and every INDENTED `fn` / `type` / `const` item inside it (methods,
 *      associated types, associated consts; default-bodied methods mint —
 *      the name precedes the body braces) joins the vocabulary, multi-line
 *      signatures mint from their first line, and `r#` raw identifiers
 *      strip like everywhere else. One-line compact traits (`pub trait
 *      Walker { fn walk(&self); }`) mint ONLY the trait name — the method
 *      sits on the decl line, before the block state exists; a documented
 *      limit, pinned by test/issues/issue-60-code-anchors.test.ts r2.
 *
 *    Python (.py) — no export marker exists, so top level IS the surface:
 *      column-0 `def NAME`, `async def NAME`, `class NAME`. Module-level
 *      assignments are not minted (not named units); indented defs (class
 *      methods, nested functions) are not minted.
 *
 *    Go (.go) — column-0 `func NAME`, `func (recv T) NAME` (a method's
 *      NAME is still addressable: Go documents it as `T.Name`, but this
 *      vocabulary is bare names and a bare-name hit is the fail-safe
 *      direction), `type NAME <kind>`, `const NAME`, `var NAME`.
 *      Unexported lowercase names ARE minted (Go has no export keyword;
 *      the symbol is declared at top level). Grouped `const (…)` /
 *      `var (…)` blocks mint nothing — the names live on indented lines,
 *      a documented subset limit.
 *
 *  COMMENT EXCLUSION (all languages, best-effort): full-line `//` (incl.
 *  `///` and `//!` doc comments), full-line `#` (Python comments; also
 *  harmlessly absorbs Rust `#[…]` attributes and shebangs — none are
 *  symbols), and block comments opened by a line that STARTS with `/*`
 *  (suppressed through their closing star-slash) never mint.
 *
 *  FAIL-SAFE DIRECTION + HONEST LIMITS. Hand-rolled line regexes, not
 *  compilers (repo law: zero runtime deps — the schematic.ts subset
 *  discipline applied to code): no string-literal awareness (a symbol
 *  pattern inside a string/template/Python docstring may over-extract),
 *  no multi-line declarations, block comments opened mid-line are not
 *  tracked, and the Go/Python omissions above stand. The #70 trait-block
 *  tracker counts braces the same best-effort way — a string literal with
 *  unbalanced braces can perturb the depth and shift the tracker's window
 *  (the same imprecision class as no-string-awareness; the real corpus
 *  files are clean). Every imprecision errs toward OVER-extraction: a
 *  spurious name can only turn a would-be broken-anchor error into a hit,
 *  never mask a real one — the same guarantee extractYamlKeys documents.
 *  Unknown extension → []. Empty source → []. Duplicates dedupe to the
 *  first occurrence; document order is preserved. */
// ── Extension table ──

const CODE_EXT_RE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|rs|py|go)$/i;

/** Issue #60: does this path name a supported code artifact target? */
export function isCodeArtifact(path: string): boolean {
  return CODE_EXT_RE.test(path);
}

/** Which code grammar a path selects. The eight TS/JS spellings share ONE
 *  grammar (the family's declaration forms are a superset of plain JS). */
type CodeLang = 'tsjs' | 'rust' | 'python' | 'go';

function codeLangFor(path: string): CodeLang | null {
  const m = CODE_EXT_RE.exec(path);
  if (m === null) return null;
  const ext = m[1]!.toLowerCase();
  if (ext === 'rs') return 'rust';
  if (ext === 'py') return 'python';
  if (ext === 'go') return 'go';
  return 'tsjs'; // ts, tsx, mts, cts, js, jsx, mjs, cjs
}

// ── Per-language line matchers (all anchored at column 0) ──

/** TS/JS: `export [modifiers…] <keyword> NAME`. The modifier run is a
 *  bounded any-order set (default/async/abstract/declare) so every legal
 *  stacking — `export default async function*`, `export abstract class`,
 *  `export declare const` — parses; keywords it cannot consume fail the
 *  match (that is what rejects `export * from` and `export { … }`).
 *  `const enum` is ordered before `const` so the two-token form does not
 *  mint `enum` as a name. The identifier capture is greedy, which is what
 *  strips generics/heritage/signatures: the name is simply the first
 *  identifier after the keyword. */
const TSJS_DECL_RE =
  /^export\s+(?:(?:default|async|abstract|declare)\s+)*(function\*?|const\s+enum|const|let|var|class|interface|type|enum|namespace|module)\s*([A-Za-z_$][A-Za-z0-9_$]*)/;

function tsjsSymbol(line: string): string | null {
  const m = TSJS_DECL_RE.exec(line);
  if (m === null) return null;
  const name = m[2]!;
  // Anonymous default class with heritage: `export default class extends
  // Base {}` — the heritage keyword sits exactly where a name would. Both
  // are reserved words, so no real symbol is ever lost to this guard.
  if (name === 'extends' || name === 'implements') return null;
  return name;
}

/** Rust: `[pub] [modifiers…] <item-keyword> NAME` at column 0. Issue #70
 *  made `pub` optional — a column-0 declaration mints regardless of
 *  visibility (the docblock's why), while `pub(crate)`/`pub(super)`/
 *  `pub(in …)` still fail outright: the `(` after `pub` cannot match
 *  `pub\s+` NOR any modifier, so restricted visibility keeps minting
 *  nothing. Backtracking makes the modifier/item overlap safe: `const fn f`
 *  consumes `const` as a modifier and mints `f`; `const X` keeps `const` as
 *  the item keyword and mints `X`. `static mut` is one two-token item so
 *  `mut` is never minted as a name. The optional `r#` is stripped from raw
 *  identifiers (see docblock). */
const RUST_ITEM_RE =
  /^(?:pub\s+)?(?:(?:unsafe|async|const|extern(?:\s+"[^"]*")?)\s+)*(fn|static\s+mut|const|static|struct|enum|trait|type|mod|union)\s+(?:r#)?([A-Za-z_][A-Za-z0-9_]*)/;

function rustSymbol(line: string): string | null {
  const m = RUST_ITEM_RE.exec(line);
  return m === null ? null : m[2]!;
}

/** Issue #70: a column-0 `trait` declaration (pub optional, matching
 *  RUST_ITEM_RE's widening) — opens the trait-block tracker. Does not
 *  consume modifiers (`unsafe trait` is vanishingly rare in artifact
 *  files; its methods simply stay un-minted, the leaf tier's net). */
const RUST_TRAIT_DECL_RE = /^(?:pub\s+)?trait\s+(?:r#)?([A-Za-z_][A-Za-z0-9_]*)/;

/** Issue #70: an INDENTED trait item — the trait methods, associated types
 *  and associated consts the tracker mints. The bounded modifier run sits
 *  between the indentation and the item keyword: `const fn name`
 *  backtracks so `const` is a modifier and `name` mints, while `const NAME:`
 *  keeps `const` as the item keyword and mints `NAME`; `type Out;` mints
 *  `Out`. `\s+` after the keyword is what keeps prefix words out. */
const RUST_TRAIT_ITEM_RE =
  /^\s+(?:(?:unsafe|async|const|extern(?:\s+"[^"]*")?)\s+)*(fn|type|const)\s+(?:r#)?([A-Za-z_][A-Za-z0-9_]*)/;

/** Issue #70: mint one name through the shared dedupe/seen set. */
function mint(seen: Set<string>, names: string[], name: string): void {
  if (!seen.has(name)) {
    seen.add(name); // first occurrence wins; document order kept
    names.push(name);
  }
}

/** Python: column-0 `def` / `async def` / `class`. The `\s+` after each
 *  keyword is what keeps prefix words (`default = …`) out. */
const PY_DECL_RE = /^(?:async\s+def|def|class)\s+([A-Za-z_][A-Za-z0-9_]*)/;

function pySymbol(line: string): string | null {
  const m = PY_DECL_RE.exec(line);
  return m === null ? null : m[1]!;
}

/** Go: the method form is tried first (a receiver list is never an
 *  identifier, so the two forms cannot cross-match); the plain func and
 *  type/const/var forms share one identifier capture. Generics sit after
 *  the name (`func Map[T any]` → `Map`) and receiver brackets contain no
 *  closing paren, so `\([^)]*\)` spans them. */
const GO_METHOD_RE = /^func\s*\([^)]*\)\s*([A-Za-z_][A-Za-z0-9_]*)/;
const GO_FUNC_RE = /^func\s+([A-Za-z_][A-Za-z0-9_]*)/;
const GO_DECL_RE = /^(?:type|const|var)\s+([A-Za-z_][A-Za-z0-9_]*)/;

function goSymbol(line: string): string | null {
  const m = GO_METHOD_RE.exec(line) ?? GO_FUNC_RE.exec(line) ?? GO_DECL_RE.exec(line);
  return m === null ? null : m[1]!;
}

// ── Entry point ──

/** Issue #60: addressable top-level symbol vocabulary of code artifact
 *  targets. Language is selected by the file EXTENSION (path); unsupported
 *  extensions return []. Returns symbol NAMES in document order, deduped
 *  keeping first occurrence. */
export function extractCodeSymbols(path: string, source: string): string[] {
  const lang = codeLangFor(path);
  if (lang === null) return [];
  const src = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source; // BOM
  const names: string[] = [];
  const seen = new Set<string>();
  let inBlock = false; // inside a block comment opened at a line start
  // Issue #70 — the Rust trait-block tracker (best-effort brace counting;
  // see the module docblock): depth runs over processed (non-comment)
  // lines, pendingTrait marks a column-0 trait decl whose `{` has not
  // arrived yet (where-clause on a later line), and traitBase is the depth
  // the open trait block sits at (-1 = no open trait block).
  let depth = 0;
  let pendingTrait = false;
  let traitBase = -1;
  for (const raw of src.split(/\r?\n/)) {
    if (inBlock) {
      // Comment body. Best-effort: the code following a mid-line close on
      // this line is not scanned (rare formatting; over-skip only).
      if (raw.includes('*/')) inBlock = false;
      continue;
    }
    const t = raw.trim();
    if (t === '') continue;                                 // blank
    if (t.startsWith('//') || t.startsWith('#')) continue;  // full-line comment / attribute / shebang
    if (t.startsWith('/*')) {                               // full-line block-comment opener
      if (!t.includes('*/')) inBlock = true;                // unterminated → suppress until close
      continue;
    }
    // Minting decisions use the state at line ENTRY — before this line's
    // braces are counted — so a method on the trait-decl line itself (the
    // one-line compact form) can never mint: traitBase is still -1 here.
    const entryDepth = depth;
    const name = lang === 'tsjs' ? tsjsSymbol(raw)
      : lang === 'rust' ? rustSymbol(raw)
      : lang === 'python' ? pySymbol(raw)
      : goSymbol(raw);
    if (name !== null) mint(seen, names, name);
    if (lang === 'rust') {
      if (traitBase === -1 && !pendingTrait) {
        // (ii) a fresh column-0 trait decl opens the tracker; its `{` may
        // sit on this line or a later one (where-clause).
        if (RUST_TRAIT_DECL_RE.test(raw)) pendingTrait = true;
      } else if (traitBase !== -1 && entryDepth > traitBase) {
        // (iii) inside the open trait block, past its base depth — every
        // indented fn/type/const item is a trait item. impl methods can
        // never land here: `impl … {` never opens trait state, and once a
        // trait closes (depth falls back to traitBase) the tracker resets.
        const ti = RUST_TRAIT_ITEM_RE.exec(raw);
        if (ti !== null) mint(seen, names, ti[2]!);
      }
      // (iv) process this line's braces char-by-char: `{` +1, `}` -1; the
      // first `{` after a pending decl anchors the trait block at the
      // depth just below it; falling back to traitBase closes the tracker.
      for (const ch of raw) {
        if (ch === '{') {
          if (pendingTrait) {
            traitBase = depth;
            pendingTrait = false;
          }
          depth++;
        } else if (ch === '}') {
          depth--;
          if (traitBase !== -1 && depth <= traitBase) traitBase = -1;
        }
      }
    }
  }
  return names;
}

// ── Issue #70: the referenced-names leaf tier ──

/** Per-language identifier token grammar for the leaf tier: the tsjs
 *  family admits `$` (a legal identifier char), rust/python/go do not.
 *  Global — matched over the whole source at once, document order. */
const TSJS_LEAF_RE = /[A-Za-z_$][A-Za-z0-9_$]*/g;
const RUST_PY_GO_LEAF_RE = /[A-Za-z_][A-Za-z0-9_]*/g;

/** Issue #70 (class B): the REFERENCED-NAMES leaf vocabulary of a code
 *  artifact target — every identifier-shaped token in the file, not just
 *  its declarations. WHY: on the kelir corpus 9 errors + 19 warnings held
 *  anchors that exist in their target files as use/import names
 *  (`#LedgerPlugin`, `#LedgerCtx`, `#binary_blake3`, `#FinalizeRequest`,
 *  `#FinalReceipt` in autonomous-swe-agent.rs — imported line 36, used
 *  elsewhere; `#PgWireRewrite`, `#DbProxyConfig` in db-backed-runtime.py —
 *  imported 37-38, constructed 71-72), and the reporter's convention quote
 *  is the repo's established reading: “the local checker … counts
 *  use/import names and text lines/tokens as leaves … a pointer to an
 *  example means ‘this file demonstrates the symbol’”. Declarations alone
 *  cannot address that class — the names are USED in example artifacts,
 *  not declared there — so this tier tokenizes the source as pure text:
 *  declarations, imports, call sites, field accesses and comment text all
 *  mint (deliberate: the convention counts tokens, not semantics — a
 *  did-you-mean pool and a resolution set built from the same convention
 *  cannot disagree). No comment/string awareness, the same documented
 *  imprecision class as extractCodeSymbols; over-extraction stays the
 *  fail-safe direction (a spurious token can only turn a would-be error
 *  into a hit, never mask a real one). Identifier grammar by language
 *  family (codeLangFor): tsjs `[A-Za-z_$][A-Za-z0-9_$]*`, rust/python/go
 *  `[A-Za-z_][A-Za-z0-9_]*`. Dedupe keeps the first occurrence, document
 *  order; unknown extension → []; empty source → []; BOM stripped like
 *  extractCodeSymbols. Resolution still happens through §12 anchorMatches
 *  at the caller — camelCase never folds, so `#ledger-plugin` still does
 *  NOT address the token `LedgerPlugin`. */
export function extractCodeLeafNames(path: string, source: string): string[] {
  const lang = codeLangFor(path);
  if (lang === null) return [];
  const src = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source; // BOM
  const names: string[] = [];
  const seen = new Set<string>();
  for (const m of src.matchAll(lang === 'tsjs' ? TSJS_LEAF_RE : RUST_PY_GO_LEAF_RE)) {
    mint(seen, names, m[0]);
  }
  return names;
}
