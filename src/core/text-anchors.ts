/** Plain-text heading anchors — issue #60: the addressable section-heading
 *  vocabulary of .txt/.text artifact targets.
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
