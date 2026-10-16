/** The CANS anchor-slug algorithm — issue #53, Part 1.1 (Option A).
 *
 *  THE PUBLISHED CONTRACT (mirrored in `templates/_rules.yaml#slug` and
 *  docs/cans.architecture.md §12 — keep the three in sync):
 *
 *    1. SEPARATORS are the ASCII hyphen `-`, the underscore `_`, the whole
 *       Unicode dash-like family (U+2010 hyphen, U+2011 non-breaking hyphen,
 *       U+2012 figure dash, U+2013 en dash, U+2014 em dash, U+2015 horizontal
 *       bar, U+2043 hyphen bullet, U+2212 minus sign, U+FE58 small em dash,
 *       U+FE63 small hyphen-minus, U+FF0D fullwidth hyphen-minus), and every
 *       whitespace run (spaces, tabs, NBSP, the U+2000–U+200A spaces …).
 *    2. A run of consecutive separators collapses to ONE `-`.
 *    3. Every other character is preserved VERBATIM, case included.
 *    4. Leading/trailing separators are dropped.
 *
 *  So `Layer 1 — C authorizer` → `Layer-1-C-authorizer` (the exact spelling
 *  the issue's refs already assumed), and `Data protection` → `Data-protection`
 *  (the docs' own §12 convention). Characters that are NOT separators pass
 *  through untouched: `What's Next?` → `What's-Next?`, `API (v2)` →
 *  `API-(v2)`. Zero-width/invisible characters are preserved too — they are
 *  not separators — which is exactly why `slugConfusables` exists: authors
 *  get an info-level note (issue #53 Part 1.5) naming the anchor such
 *  characters produce, instead of discovering it as a broken ref.
 *
 *  MATCHING stays normalization-based and tolerant (case-insensitive,
 *  separator-insensitive — `anchorMatches` in refs.ts, which delegates to
 *  `normalizeForAnchor` here). The slug above is the CANONICAL spelling —
 *  the one `cans slug` prints and the one suggestions propose — while any
 *  spelling that normalizes equal still resolves. `nearSlugMatches` is the
 *  fuzzy layer reserved for broken-anchor SUGGESTIONS and the gated
 *  `--fix` anchor repair (issue #53 Parts 1.3 and 2.4); resolution itself
 *  never goes fuzzy.
 *
 *  Fully standalone and dependency-free by design (report.ts is the model):
 *  string/regex work only, portable across the Bun and Node runtimes. */

/** The dash-like family, as escapes so the codepoints are explicit and can
 *  never be visually confused — en and em dashes are near-indistinguishable
 *  in most fonts (same convention as test/issues/issue-50.test.ts). */
export const DASH_FAMILY: readonly string[] = [
  '\u002D', // hyphen-minus (ASCII `-`)
  '\u2010', // hyphen
  '\u2011', // non-breaking hyphen
  '\u2012', // figure dash
  '\u2013', // en dash
  '\u2014', // em dash
  '\u2015', // horizontal bar
  '\u2043', // hyphen bullet
  '\u2212', // minus sign
  '\uFE58', // small em dash
  '\uFE63', // small hyphen-minus
  '\uFF0D', // fullwidth hyphen-minus
];

/** One separator run = any mix of the dash family, `_`, or whitespace.
 *  Built from DASH_FAMILY so the class and the exported list cannot drift.
 *  `\s` already folds the space family (incl. NBSP U+00A0 and U+FEFF);
 *  zero-width characters (U+200B–U+200F …) are deliberately NOT separators —
 *  they are preserved verbatim and flagged by slugConfusables instead. */
const SEPARATOR_RE = new RegExp(`[${DASH_FAMILY.map(escapeForClass).join('')}\\u005F\\s]+`, 'gu');

/** Escape a literal char for use inside a RegExp character class. */
function escapeForClass(ch: string): string {
  return ch.replace(/[-\\\]\^]/g, '\\$&');
}

/** The canonical anchor slug (issue #53 Option A): separators collapse to a
 *  single `-`, everything else is preserved verbatim, case included.
 *
 *  `Layer 1 — C authorizer` → `Layer-1-C-authorizer`
 *  `Data protection`        → `Data-protection`
 *  `What's Next?`           → `What's-Next?`
 *  `A - — _ B`              → `A-B`          (mixed run collapses)
 *  `` (empty / only separators) → `` */
export function anchorSlug(text: string): string {
  return text
    .trim()
    .replace(SEPARATOR_RE, '-')
    .replace(/^-+|-+$/g, '');
}

/** Anchor ↔ text equivalence normalization (the §12 matching contract, and
 *  the single source of truth for `anchorMatches` in refs.ts since issue
 *  #53): lowercase, every separator run → one space, trimmed. Widens the
 *  issue #50 class (which folded only `-`, `_`, U+2012–U+2015, U+2212) to
 *  the FULL dash family above — same spirit, deterministic superset, so
 *  every anchor that resolved before still resolves. */
export function normalizeForAnchor(s: string): string {
  return s.toLowerCase().replace(SEPARATOR_RE, ' ').trim();
}

/** Classic two-row Levenshtein edit distance (O(n·m), no allocation churn).
 *  Node text is bounded by the structure rules (≤ ~120 chars), so the DP is
 *  trivially cheap; kept dependency-free per repo policy. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  return prev[b.length]!;
}

/** Similarity of two texts as a potential anchor target: 1 − edit-distance
 *  ratio over the NORMALIZED forms (case- and separator-insensitive), 0..1.
 *  Identical-after-normalization texts score exactly 1. */
export function slugSimilarity(a: string, b: string): number {
  const x = normalizeForAnchor(a);
  const y = normalizeForAnchor(b);
  if (x === y) return 1;
  const longest = Math.max(x.length, y.length);
  if (longest === 0) return 0;
  return 1 - levenshtein(x, y) / longest;
}

/** One fuzzy candidate for a failing anchor, ranked by score. */
export interface SlugMatch {
  text: string;
  score: number;
}

/** Default confidence floor for "did you mean" suggestions and the gated
 *  `--fix` anchor repair (issue #53 Parts 1.3 / 2.4): a candidate must be
 *  at least 80% similar (normalized Levenshtein) to the failing anchor.
 *  Callers treat 0 matches as "no near node" and ≥ 2 as ambiguous. */
export const SLUG_SUGGEST_THRESHOLD = 0.8;

/** Rank the candidates that fuzzy-match `anchor` at or above `threshold`,
 *  best first (stable alphabetical tiebreak). Empty texts never match.
 *  Deliberately does NOT filter out exact-after-normalization candidates —
 *  callers invoke it only after `anchorMatches` already missed, so a 1.0
 *  score here means the candidate set differs from the resolution set
 *  (e.g. YAML keys probed from a different path), not a contradiction. */
export function nearSlugMatches(
  candidates: readonly string[],
  anchor: string,
  threshold: number = SLUG_SUGGEST_THRESHOLD,
): SlugMatch[] {
  const out: SlugMatch[] = [];
  for (const text of candidates) {
    if (text === '') continue;
    const score = slugSimilarity(text, anchor);
    if (score >= threshold) out.push({ text, score });
  }
  return out.sort((a, b) => b.score - a.score || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
}

/** Named labels for the invisible characters most likely to hide in prose —
 *  an info note that prints a bare zero-width joiner helps nobody. */
const NAMED_CHARS: Record<string, string> = {
  '\u00A0': 'NBSP',
  '\u00AD': 'SHY',     // soft hyphen
  '\u200B': 'ZWSP',    // zero-width space
  '\u200C': 'ZWNJ',    // zero-width non-joiner
  '\u200D': 'ZWJ',     // zero-width joiner
  '\u200E': 'LRM',     // left-to-right mark
  '\u200F': 'RLM',     // right-to-left mark
  '\u202A': 'LRE', '\u202B': 'RLE', '\u202C': 'PDF', '\u202D': 'LRO', '\u202E': 'RLO',
  '\u2060': 'WJ',      // word joiner
  '\uFEFF': 'BOM',     // zero-width no-break space
};

/** Human label for a character: `ZWJ(U+200D)` for named invisibles,
 *  `—(U+2014)` for printable non-ASCII, the char itself for ASCII. */
export function charLabel(ch: string): string {
  const named = NAMED_CHARS[ch];
  if (named !== undefined) return `${named}(U+${codepoint(ch)})`;
  const hex = codepoint(ch);
  if (parseInt(hex, 16) <= 0x7e) return ch;
  return `${ch}(U+${hex})`;
}

function codepoint(ch: string): string {
  const cp = ch.codePointAt(0);
  return cp === undefined ? '' : cp.toString(16).toUpperCase().padStart(4, '0');
}

/** Characters of `text` outside the slug-safe set (issue #53 Part 1.5):
 *  anything that is neither ASCII printable (U+0020–U+007E) nor one of the
 *  benign ASCII controls that can appear in source text (tab, CR, LF).
 *  This flags the whole confusable zoo — typographic dashes, NBSP, the
 *  zero-width/format characters, curly quotes, any non-ASCII letter —
 *  because all of them produce anchors a human cannot predict from the
 *  prose. Unique, first-occurrence order. */
const SLUG_SAFE_RE = /^[\t\n\r\x20-\x7E]$/;

export function slugConfusables(text: string): string[] {
  const seen: string[] = [];
  for (const ch of text) {
    if (!SLUG_SAFE_RE.test(ch) && !seen.includes(ch)) seen.push(ch);
  }
  return seen;
}
