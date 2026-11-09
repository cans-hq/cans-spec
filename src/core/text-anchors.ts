/** Plain-text heading anchors — issue #60: the addressable section-heading
 *  vocabulary of .txt/.text artifact targets; issue #70 adds the
 *  extractTextLeafTokens diagram/tree-line tier beside it and issue #71
 *  the extractTextEntries whole-line entry tier between the two (headings
 *  and tokens behavior byte-unchanged); issue #72 refines that tier's
 *  bracket rule — a line of SEVERAL bracketed groups mints each group as
 *  its own entry beside the verbatim whole-line entry.
 *
 *  WHY THIS MODULE EXISTS. Issues #49/#58 taught checkRefs to resolve
 *  `#anchors` against the natural addressable units of schematic artifacts
 *  (YAML keys, then parsed dot paths) and of outline targets (bullet nodes,
 *  §12 anchorMatches). A plain-text target has neither: no bullets, no
 *  schematic parser — its vocabulary was empty by construction, so every
 *  anchored ref into it fell to the issue #49 `refs.anchor.no-target`
 *  downgrade ("anchor on non-outline target") even when the section the
 *  anchor named sat in the file verbatim (`see:
 *  artifacts/diagrams/data-flow.txt#creation-flow` under a literal
 *  `CREATION FLOW` heading line — the issue #60 repro). This module is the
 *  plain-text half of #60's "natural addressable units of every file kind":
 *  section headings.
 *
 *  THE VOCABULARY (one forward scan over physical lines; a line is claimed
 *  by at most one rule, and an underline line is consumed as decoration,
 *  never inspected as a candidate itself). Scan priority is ATX → underlined
 *  → ALL-CAPS; the three forms below are numbered as the issue presents
 *  them:
 *
 *    1. UNDERLINED (setext-style) headings — a non-blank line IMMEDIATELY
 *       followed by a line that is only `=` or only `-` (≥ 3 of the char;
 *       whitespace around the run tolerated). The heading text is the upper
 *       line, trimmed. An underline exists only BELOW a non-blank line —
 *       DECIDED: a blank-line-then-`---` pair is a horizontal SEPARATOR,
 *       never an underline, and the same holds for `=` runs after a blank
 *       (markdown's own reading). A line that is itself a pure `=`/`-` run
 *       of any length is never heading TEXT — `----\n----` is border
 *       drawing, and a stacked second underline (`Title\n====\n====`)
 *       decorates one heading, not two.
 *    2. ALL-CAPS section lines — the issue's `CREATION FLOW` form. A
 *       standalone line qualifies iff EVERY guard holds:
 *         · trimmed length ≤ 72 chars,
 *         · 1–8 whitespace-separated words,
 *         · contains at least one letter, and every CASED letter is
 *           uppercase (caseless scripts pass vacuously — `\p{L}`/`\p{Ll}`,
 *           ES2018 Unicode property escapes, portable across both runtimes),
 *         · no sentence punctuation (`.` `,` `;` `!` `?` `:`) anywhere,
 *         · does not start with `#` (ATX territory),
 *         · contains no ASCII-art box characters: `|`, `+`, or a run of
 *           ≥ 2 consecutive `-`/`=` INSIDE the line. DECIDED: a LONE `-`/`=`
 *           survives (`DATA-FLOW`, `KEY = VALUE`) — only runs read as box
 *           or border drawing; over-extraction is the fail-safe direction,
 *         · preceded by a blank line (whitespace-only) or standing first in
 *           the file. DECIDED: underline, heading and prose lines all count
 *           as NON-blank predecessors — the guard approximates markdown's
 *           "standalone paragraph" requirement, so a shouty line mid-
 *           paragraph is prose, while the FIRST all-caps line of a
 *           paragraph qualifies (fail-safe).
 *    3. ATX headings — `#{1,6} ` then text (plain-text notes often carry
 *       markdown headings). The heading text is what follows the space,
 *       trimmed; an empty remainder (`# ` alone) is not a heading. DECIDED:
 *       7 `#`s, `#nospace`, and closing `#` sequences are all verbatim —
 *       closers are kept in the text (`## Title ##` → `Title ##`), matching
 *       the module's one-line-per-rule predictability over CommonMark's
 *       closer stripping. ATX is tried FIRST in the scan, so a `#`-led line
 *       is an ATX heading or nothing — never underlined-heading TEXT and
 *       never an ALL-CAPS candidate.
 *
 *  RETURNS raw heading TEXTS (not slugs) in document order, duplicates
 *  preserved — exactly the extractYamlKeys convention (refs.ts): resolution
 *  against a `#anchor` happens later through the §12 `anchorMatches`
 *  normalization (case-insensitive, dash/underscore/space folding —
 *  `CREATION FLOW` ↔ `creation-flow` resolves there). Over-extraction is
 *  fail-safe: a false heading can only turn a would-be miss into a hit,
 *  never mask a real one; the guard set above still keeps prose sentences
 *  (`THIS IS A SENTENCE.` fails on the period), ordinary mixed-case lines
 *  (fail on case), and ASCII-art boxes out of the vocabulary.
 *
 *  CRLF input behaves identically to LF (`\r?\n` split, the extractYamlKeys
 *  house split); leading/trailing whitespace on a line is trimmed before
 *  every rule is applied. Standalone by design: string/regex work only, no
 *  imports — the repo's zero-runtime-dependency law holds. */
const EQ_UNDERLINE_RE = /^={3,}$/;
const DASH_UNDERLINE_RE = /^-{3,}$/;

/** A pure `=`/`-` RUN of any length (≥ 1): underline-shaped decoration
 *  (a typographic rule). Such a line is never heading TEXT itself — rule 1's
 *  text line may be any other non-blank line (including a `#`-led one that
 *  failed ATX, which is markdown's own setext reading of `#nospace` above
 *  an `====`). */
const PURE_RUN_RE = /^[=-]+$/;

/** ATX opener with its text in a capture: 1–6 `#`, one space, remainder.
 *  `####### x` (7 hashes) and `#nospace` both fail — not headings. */
const ATX_TEXT_RE = /^(#{1,6}) (.*)$/;

/** Sentence punctuation anywhere in the line — an ALL-CAPS line carrying
 *  any of these is a sentence (or data like `VERSION 2.0`), not a heading. */
const SENTENCE_PUNCT_RE = /[.,;!?:]/;

/** ASCII-art box characters: `|`, `+`, or a run of ≥ 2 consecutive `-`/`=`
 *  inside the line (`+----+`, `| DATA |`, `A -- B`). A lone `-`/`=` is not
 *  box drawing (`DATA-FLOW`, `KEY = VALUE` stay extractable). */
const BOX_RE = /[|+]|[-=]{2,}/;

/** At least one letter, any script (so caseless scripts are not excluded
 *  from the vocabulary — "all cased letters uppercase" holds vacuously). */
const HAS_LETTER_RE = /\p{L}/u;

/** A lowercase cased letter — its ABSENCE is exactly "all cased letters
 *  uppercase", the case half of rule 2's guard set. */
const HAS_LOWER_RE = /\p{Ll}/u;

/** Longest trimmed line an ALL-CAPS candidate may be (the prose cut). */
const MAX_CAPS_LINE = 72;

/** Most whitespace-separated words an ALL-CAPS heading may carry (the
 *  shouty-sentence cut — real section titles are short). */
const MAX_CAPS_WORDS = 8;

/** Is `line` a setext underline — only `=`s or only `-`s, ≥ 3, after trim? */
function isUnderline(line: string): boolean {
  const t = line.trim();
  return EQ_UNDERLINE_RE.test(t) || DASH_UNDERLINE_RE.test(t);
}

/** Rule 2's full guard set on a TRIMMED, non-blank line (the blank-line
 *  predecessor is checked by the caller — it needs the physical line above). */
function isAllCapsSection(text: string): boolean {
  if (text.length > MAX_CAPS_LINE) return false;
  if (text.startsWith('#')) return false;          // ATX territory
  if (SENTENCE_PUNCT_RE.test(text)) return false;  // sentence/data
  if (BOX_RE.test(text)) return false;             // box/border drawing
  if (!HAS_LETTER_RE.test(text)) return false;     // ≥ 1 letter
  if (HAS_LOWER_RE.test(text)) return false;       // all cased letters uppercase
  return text.split(/\s+/).length <= MAX_CAPS_WORDS; // 1–8 words (non-blank ⇒ ≥ 1)
}

/** Issue #60: addressable section-heading vocabulary of plain-text artifact
 *  targets (.txt/.text). Returns raw heading TEXTS in document order. */
export function extractTextHeadings(source: string): string[] {
  const headings: string[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === '') continue; // blank — never a heading, and never consumed

    // Rule 3 first (scan priority): a `#`-led line is an ATX heading or
    // nothing — never underlined-heading text, never an ALL-CAPS candidate.
    const atx = ATX_TEXT_RE.exec(line);
    if (atx !== null) {
      const text = atx[2]!.trim();
      if (text !== '') headings.push(text); // `# ` alone is not a heading
      continue;
    }

    // Rule 1: an underline immediately below claims this line as the text.
    // The text line must not itself be a pure `=`/`-` run (stacked
    // underlines / borders decorate, they do not head).
    if (!PURE_RUN_RE.test(line) && i + 1 < lines.length && isUnderline(lines[i + 1]!)) {
      headings.push(line);
      i++; // consume the underline — decoration, not a candidate line
      continue;
    }

    // Rule 2: ALL-CAPS section line, standalone — blank line (or file
    // start) physically above. Underline/heading/prose lines above count
    // as NON-blank predecessors (markdown's standalone-paragraph shape).
    if (isAllCapsSection(line) && (i === 0 || lines[i - 1]!.trim() === '')) {
      headings.push(line);
    }
  }
  return headings;
}

/** Plain-text artifact extensions: `.txt` and `.text` (case-insensitive,
 *  `$`-anchored on the whole path — the schematicFormatFor convention, so
 *  `notes.textile` and `dir/notes.txt/` are NOT text artifacts). */
const TEXT_EXT_RE = /\.te?xt$/i;

/** Issue #60: does this path name a plain-text artifact target? */
export function isTextArtifact(path: string): boolean {
  return TEXT_EXT_RE.test(path);
}

// ── Issue #70: the diagram/tree-line leaf tier ──

/** The text-leaf token grammar: a maximal run of ASCII alphanumerics plus
 *  INTERNAL `-`/`_` — so `kelir-shim`, `driver-rustvmm` and `virtio-shm`
 *  are single tokens (internal dashes preserved), while a LEADING dash
 *  (bullet decoration, `─`-runs) never joins (the first char class is
 *  alnum-only). Unicode box/tree drawing (│├└─┌┐┘┴…) is outside the class
 *  entirely and never glues tokens together. */
const TEXT_LEAF_TOKEN_RE = /[A-Za-z0-9][A-Za-z0-9_-]*/g;

/** Issue #70 (class B): the diagram/tree-LINE leaf vocabulary of a
 *  plain-text artifact target — the text tokens of its lines, not just its
 *  headings. WHY: on the kelir corpus anchors aimed at entries that exist
 *  only as tree/box lines — `project-structure.txt#kelir-shim` (the tree
 *  entry `│   ├── kelir-shim/`), `four-ring-bus.txt#virtio-shm` (the box
 *  entry `[virtio-shm]`), `host-runtime.txt#driver-rustvmm` (the box-tree
 *  line `│   ├── driver-rustvmm (DEFAULT Linux)…`, a file that is pure
 *  box-drawing, so extractTextHeadings mints nothing and its pointers drew
 *  no-target warnings) — and the reporter's convention quote is the repo's
 *  established reading: “a pointer into a diagram means ‘this entry of the
 *  diagram’”. Headings alone cannot address that class; this tier
 *  tokenizes every line: tokens are maximal `[A-Za-z0-9][A-Za-z0-9_-]*`
 *  runs filtered to length ≥ 2 AND at least one letter — pure numbers (a
 *  port like `5432`) and single characters stay out, and box-drawing never
 *  joins. `THE VIRTIO DEVICE COMPLEX` therefore yields THE, VIRTIO,
 *  DEVICE, COMPLEX as separate tokens. Deliberately dumb: CRLF-safe by
 *  construction (the token class excludes `\r`/`\n`), and over-extraction
 *  stays the fail-safe direction (a spurious token can only turn a
 *  would-be error into a hit, never mask a real one). Dedupe keeps the
 *  first occurrence, document order; empty source → []. extractTextHeadings
 *  above is byte-unchanged — this is an ADDITIVE tier beside it. */
export function extractTextLeafTokens(source: string): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const m of source.matchAll(TEXT_LEAF_TOKEN_RE)) {
    const tok = m[0];
    if (tok.length < 2) continue;              // single chars never address anything
    if (!/[A-Za-z]/.test(tok)) continue;       // pure numbers (ports, sizes) stay out
    if (!seen.has(tok)) {
      seen.add(tok); // first occurrence wins; document order kept
      tokens.push(tok);
    }
  }
  return tokens;
}

// ── Issue #71: the whole-line entry tier ──

/** Leading tree/box decoration: a run of Unicode Box Drawing block chars
 *  (U+2500–U+257F — │ ├ └ ─ ┌ ┐ ┘ ┴ ┬ ┼ ═ ║ …) mixed with whitespace.
 *  These glyphs INDENT an entry inside a drawn tree or box (`│   ├──
 *  kelir-shim/`, `│   └── driver-avf: …`) and are never part of the entry's
 *  name. ASCII `-`/`=` are deliberately NOT in the set: they are content
 *  characters of phrases (`seccomp-unotify`, `DATA-FLOW`) and border runs
 *  (`----`, `====`) — the no-letter guard below is what keeps pure border
 *  and underline rows out of the vocabulary, not this strip. */
const ENTRY_LEAD_DECOR_RE = /^[\s\u2500-\u257F]+/u;

/** A maximal FLAT bracketed group — an ASCII `[` … `]` span with NO
 *  bracket inside (issue #72). Global + matchAll: scanned left-to-right
 *  over the cleaned line, never mutating a shared lastIndex (matchAll
 *  clones its receiver). Nested brackets are skipped over, not entered:
 *  on `[[FOO BAR]]` the outer `[` has a `[` right behind it, so the FIRST
 *  match is the inner `[FOO BAR]` — one flat group, exactly the entry a
 *  human reads off the diagram. */
const ENTRY_FLAT_GROUP_RE = /\[([^\[\]]*)\]/g;

/** Issues #71/#72: the whole-line ENTRY vocabulary of a plain-text
 *  artifact target — a .txt/.text line that names a thing IS that thing's
 *  address, the #70 convention quote taken to its phrase form: “a pointer
 *  into a diagram means ‘this entry of the diagram’”, where the entry is
 *  the WHOLE LINE. WHY (#71): #70's extractTextLeafTokens minted
 *  single-word tokens only, so a hyphenated PHRASE anchor naming a whole
 *  diagram entry — the issue's two repros, `see: cans/artifacts/diagrams/
 *  trap-flow.txt#Kernel-seccomp-unotify-triggers` over the literal line
 *  `Kernel seccomp-unotify triggers` (trap-flow.txt line 8) and
 *  `…wire-plane.txt#USERSPACE-SMOLTCP-INGRESS-RING` over
 *  `[USERSPACE SMOLTCP INGRESS RING]` (wire-plane.txt line 5) — had no
 *  phrase-level vocabulary to resolve against and fell as `broken
 *  anchor: … — no node matches` errors even though the entry sat in the
 *  target verbatim (the §12 normalizeForAnchor folding already equates
 *  `Kernel-seccomp-unotify-triggers` with `Kernel seccomp-unotify
 *  triggers`; only the vocabulary was missing). Single-token anchors
 *  (`#kelir-shim`, `#virtio-shm`, `#driver-avf`) already resolve through
 *  the #70 token tier — this tier adds the entry-shaped unit BETWEEN the
 *  #60 headings and the #70 tokens (the entry is the convention's named
 *  unit, so it outranks the tokens).
 *
 *  WHY (#72): the #71 bracket strip applied only to a line whose cleaned
 *  text is ONE bracketed span, so a bracketed entry SHARING its line with
 *  other bracketed entries minted nothing but the whole multi-group row:
 *  the issue's repro, wire-plane.txt line 5 — `[USERSPACE SMOLTCP INGRESS
 *  RING] [on_net_outbound] [on_net_inbound]` — left `#USERSPACE-SMOLTCP-
 *  INGRESS-RING` a `broken anchor: … — no node matches` error although
 *  the entry sat in the target verbatim (the `#FOO-BAR-BAZ` minimal
 *  repro: `[FOO BAR BAZ] [other one]` fails while `[SOLO ENTRY HERE]`
 *  resolves — the only difference is the second bracketed group). DECIDED
 *  (#72, reversing #71's “a partial strip would mint a name the line
 *  never had” note): each maximal FLAT bracketed group on a line is its
 *  OWN entry BESIDE the whole-line entry — the brackets DELIMIT the
 *  entry, exactly as they do in the single-pair case, so `[USERSPACE
 *  SMOLTCP INGRESS RING] [on_net_outbound]` mints the verbatim row AND
 *  `USERSPACE SMOLTCP INGRESS RING` AND `on_net_outbound`. The whole-line
 *  entry KEEPS minting verbatim, so the widening never narrows: a pointer
 *  that spells the whole row still resolves, and nothing strips inside a
 *  group except whitespace-trim (interior decoration is part of the
 *  group's name — the brackets are the box, not the name's interior).
 *
 *  CLEANING (one pass over physical lines, the `\r?\n` house split —
 *  CRLF-identical by construction):
 *    · trim; skip empty;
 *    · strip LEADING tree/box decoration (the regex above), then trim —
 *      NOTHING is stripped from the right except whitespace, so a tree
 *      entry's trailing `/` (`kelir-shim/`) and a boxed row's closing `│`
 *      stay truthful (their interior tokens remain #70 leaf-addressable);
 *    · brackets, two cases:
 *        - SINGLE PAIR (#71, unchanged): the cleaned text starts with
 *          `[`, ends with `]`, and contains exactly one of each — the
 *          brackets are the box, and the entry is the interior, trimmed:
 *          `[USERSPACE SMOLTCP INGRESS RING]` → `USERSPACE SMOLTCP
 *          INGRESS RING` (only the interior mints; the bracketed
 *          spelling itself never does);
 *        - EVERY OTHER SHAPE (0 or ≥2 bracket pairs, or brackets not
 *          embracing the whole text — #72): the whole cleaned line mints
 *          VERBATIM, and ADDITIONALLY each maximal flat `[…]` group on
 *          the line (the regex above, left-to-right) mints its trimmed
 *          interior as its OWN entry: `[[FOO BAR]]` (two of each — not
 *          the single-pair case) mints the verbatim line plus its flat
 *          group's interior `FOO BAR`; `[FOO BAR` (no closer) mints only
 *          the verbatim line; `[a] [b]` mints the verbatim line alone
 *          (its interiors fail the guard below);
 *    · skip when the candidate — whole line or group interior alike — is
 *      shorter than 2 chars or carries no letter (`/\p{L}/u`) — `----`,
 *      `====`, `5432`, `80`, `[]` and pure glyph rows never mint, and
 *      neither do the interiors of `[]`, `[5]`, `[x]`, `[----]`.
 *      Trailing `/`, `)`, `:` stay verbatim: the token tier already
 *      covers token-shaped anchors, and an entry is the whole line,
 *      truthful.
 *  EMISSION ORDER per line: the whole-line candidate first, then the
 *  group interiors left-to-right. Underline and heading lines mint their
 *  text too — harmless duplicates of the other tiers: resolution is a
 *  `some()` probe and suggestions dedupe by slug, so a repeated text can
 *  neither mask a miss nor mint a false ambiguity. Over-extraction stays
 *  the fail-safe direction (a spurious entry can only turn a would-be
 *  error into a hit, never mask a real one). Dedupe keeps the first
 *  occurrence, document order; empty or whitespace-only source → [].
 *  extractTextHeadings and extractTextLeafTokens above are
 *  byte-unchanged — #72, like #71 before it, is purely additive inside
 *  this tier (the widening never narrows). */
export function extractTextEntries(source: string): string[] {
  const entries: string[] = [];
  const seen = new Set<string>();
  const mint = (t: string): void => {
    if (t.length < 2) return;          // `x`, `[]` → `` — never address anything
    if (!HAS_LETTER_RE.test(t)) return; // `----`, `====`, `5432` — decoration/data
    if (!seen.has(t)) {
      seen.add(t); // first occurrence wins; document order kept
      entries.push(t);
    }
  };
  for (const line of source.split(/\r?\n/)) {
    const t = line.trim().replace(ENTRY_LEAD_DECOR_RE, '').trim();
    if (t === '') continue; // blank — or decoration-only row — never an entry
    // Single-pair case (#71, unchanged): exactly one `[` and one `]`
    // (split length 2), embracing the whole text — the line is a single
    // bracketed span, so the brackets are the box, not the name.
    // `[SOLO ENTRY HERE]` → `SOLO ENTRY HERE`.
    if (t.startsWith('[') && t.endsWith(']')
        && t.split('[').length === 2 && t.split(']').length === 2) {
      mint(t.slice(1, -1).trim());
      continue;
    }
    // Every other shape (#72): the whole cleaned line mints verbatim,
    // then each maximal flat bracketed group — left-to-right — mints its
    // trimmed interior as its own entry. `[a] [b]` and `[x] ──> [y]`
    // keep their whole-line entry (never narrowed), and their groups now
    // mint beside it; interiors failing the mint guards never do.
    mint(t);
    for (const m of t.matchAll(ENTRY_FLAT_GROUP_RE)) {
      mint(m[1]!.trim());
    }
  }
  return entries;
}
