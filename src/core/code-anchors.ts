/** Code-symbol anchors — issue #60: the addressable top-level-symbol
 *  vocabulary of CODE artifact targets (TS/JS family, Rust, Python, Go).
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
 *      of the file's addressed surface — the same call the Rust rules make
 *      for non-`pub`). A heritage keyword where a name would sit
 *      (`export default class extends Base {}`) is rejected so
 *      `extends`/`implements` never mint as symbols.
 *
 *    Rust (.rs) — `pub` items only (the issue's "exported" call: bare `fn`
 *      and crate-restricted `pub(crate)`/`pub(super)` are NOT minted):
 *      `pub` at column 0, then a bounded run of modifiers (unsafe / async /
 *      const / extern [+ quoted ABI]), then one of fn / const / static
 *      (incl. `static mut`) / struct / enum / trait / type / mod / union,
 *      then the NAME. Generics and lifetimes sit after the name
 *      (`pub fn parse<'a, T: Clone>(…)` → `parse`); a raw-identifier `r#`
 *      prefix is stripped so `#type` addresses `pub fn r#type()`. impls
 *      are not named symbols; their methods are indented and thus not
 *      minted either.
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
 *  tracked, and the Go/Python omissions above stand. Every imprecision
 *  errs toward OVER-extraction: a spurious name can only turn a would-be
 *  broken-anchor error into a hit, never mask a real one — the same
 *  guarantee extractYamlKeys documents. Unknown extension → []. Empty
 *  source → []. Duplicates dedupe to the first occurrence; document order
 *  is preserved. */
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

/** Rust: `pub [modifiers…] <item-keyword> NAME`. Backtracking makes the
 *  modifier/item overlap safe: `pub const fn f` consumes `const` as a
 *  modifier and mints `f`; `pub const X` keeps `const` as the item keyword
 *  and mints `X`. `static mut` is one two-token item so `mut` is never
 *  minted as a name. The optional `r#` is stripped from raw identifiers
 *  (see docblock). Restricted visibility (`pub(crate)`) fails `pub\s+`
 *  outright — by the exported-only decision. */
const RUST_ITEM_RE =
  /^pub\s+(?:(?:unsafe|async|const|extern(?:\s+"[^"]*")?)\s+)*(fn|static\s+mut|const|static|struct|enum|trait|type|mod|union)\s+(?:r#)?([A-Za-z_][A-Za-z0-9_]*)/;

function rustSymbol(line: string): string | null {
  const m = RUST_ITEM_RE.exec(line);
  return m === null ? null : m[2]!;
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
    const name = lang === 'tsjs' ? tsjsSymbol(raw)
      : lang === 'rust' ? rustSymbol(raw)
      : lang === 'python' ? pySymbol(raw)
      : goSymbol(raw);
    if (name !== null && !seen.has(name)) {
      seen.add(name);
      names.push(name); // first occurrence wins; document order kept
    }
  }
  return names;
}
