/**
 * Issue #71 — the ENGINE half: phrase anchors into `.txt` diagram targets.
 *
 *   the defect — on the kelir repo (1650 codebase `see:` pointers) `cans
 *   check --codebase` reported 2 errors of one shape: a hyphenated PHRASE
 *   anchor naming a whole diagram entry, reported `broken anchor: … — no
 *   node matches` although the entry sat in the target file verbatim:
 *     1. crates/kelir-shim/src/trap.rs:3 — `see: cans/artifacts/diagrams/
 *        trap-flow.txt#Kernel-seccomp-unotify-triggers`; target line 8 of
 *        trap-flow.txt: `Kernel seccomp-unotify triggers`
 *     2. crates/kelir-transport/src/lib.rs:3 — `see: cans/artifacts/
 *        diagrams/wire-plane.txt#USERSPACE-SMOLTCP-INGRESS-RING`; target
 *        line 5 of wire-plane.txt: `[USERSPACE SMOLTCP INGRESS RING]`
 *   The #70 fix gave .txt targets extractTextLeafTokens — SINGLE-word
 *   tokens only (`kelir-shim`, `virtio-shm`, `driver-avf` resolve; the
 *   issue's own single-token census was already clean), so a phrase
 *   anchor naming a whole entry had no phrase-level vocabulary. The
 *   expected semantics are #70's own convention quote: "a pointer into a
 *   diagram means 'this entry of the diagram'", where the entry is the
 *   WHOLE LINE.
 *
 *   the fix — an ENTRY tier (a third vocabulary) for .txt/.text targets,
 *   minted between the #60 declarations and the #70 leaves:
 *    1. extractTextEntries (text-anchors.ts): every contentful physical
 *       line is an entry — leading tree/box decoration (a U+2500–U+257F
 *       run mixed with whitespace) stripped, ONE outermost ASCII
 *       box-bracket pair stripped only when it embraces the whole line
 *       (exactly one `[` and one `]` — `[a] [b]` stays verbatim), nothing
 *       stripped from the right except whitespace, and lines shorter than
 *       2 chars or without a letter never minting (`----`, `====`, `5432`
 *       are decoration/data, never entries). Dedupe first-occurrence,
 *       document order; CRLF-identical. Since issue #72 a line carrying
 *       SEVERAL bracketed groups mints each maximal flat group's trimmed
 *       interior as its OWN entry BESIDE the verbatim whole-line entry
 *       (the brackets delimit the entry — `[USERSPACE SMOLTCP INGRESS
 *       RING] [on_net_outbound]` mints the row AND both interiors), so a
 *       bracketed entry sharing its line with others is still
 *       addressable; the whole-line entry keeps minting, so the widening
 *       never narrows.
 *    2. refs.ts artifactEntryVocabulary: .txt/.text → extractTextEntries;
 *       schematic → [] (parseSchematic is their only resolution);
 *       code → [] (a code LINE is not an "entry").
 *    3. checkArtifactAnchor (the frozen #69 seam): the miss probe widens
 *       to declarations ∪ ENTRIES ∪ leaves — the entry ranked between the
 *       tiers, because the entry is the convention's named unit — and
 *       brokenAnchorSuggestion is fed the same widened union, so a phrase
 *       typo gets `did you mean <target>#<Entry-Phrase-Slug>?` with the
 *       canonical anchorSlug spelling. The no-target "contentless"
 *       condition gains entryVocab.length === 0 and both bands' advisory
 *       messages (plus report.ts's RE_ANCHOR_NO_TARGET, the --fix healing
 *       parser) enumerate SEVEN vocabularies: bullets, schematic key
 *       paths, text headings, text entries, code symbols, referenced
 *       names, text tokens.
 *   UNTOUCHED: anchorMatches/normalizeForAnchor/stripAnchorTrailingPunct
 *   (the whole-line entry already matches the hyphenated phrase through
 *   the frozen §12 folding — only the vocabulary was missing), the
 *   broken-anchor/ambiguous/parse-error messages, .md corpus behavior,
 *   schematic targets, code-target vocabularies, the --fix candidate
 *   layer (declaration-tier only, the #70 precedent), and the schematic
 *   parser (the YAML multi-line-quoted-scalar note is out of scope).
 *
 *   RE-PINNED FOR #72 (the bracketed-entry-shares-its-line defect): the
 *   WIRE_PLANE_TXT fixture's line 5 takes the real repo's 0.20.0 shape
 *   verbatim — `[USERSPACE SMOLTCP INGRESS RING] [on_net_outbound]
 *   [on_net_inbound]`, the three-group row that motivated issue #72 — so
 *   en10's wire-plane entry list mints the verbatim row plus its three
 *   group interiors, en3's multi-pair assertions gain their group
 *   entries (the whole-line entry still mints verbatim), h2's token list
 *   gains the two on_net_* tokens of the new line, and r2's repro anchor
 *   now resolves through the #72 PER-GROUP entry (its old single-pair
 *   strip no longer applies to a three-group line). Every other pin is
 *   byte-identical to the #71 suite.
 *
 * WHAT EACH BLOCK PINS
 *   en1-en10 .. extractTextEntries (pure): the two repro lines (plain
 *               phrase; bracket strip); leading tree-glyph strip (│├└─
 *               shapes); the `[a] [b]` guard (whole multi-pair rows stay
 *               verbatim while their group interiors mint beside — #72);
 *               underline/`----`/no-letter/pure-number skips; dedupe +
 *               document order; CRLF; empty source; single-word lines mint
 *               too; right side verbatim; the repro fixtures' exact entry
 *               lists (wire-plane's line 5 in its three-group #72 shape)
 *   h1-h2 ..... regression pins: extractTextHeadings and
 *               extractTextLeafTokens byte-unchanged on the repro
 *               fixtures (the entry tier is purely additive; h2's token
 *               list carries the two on_net_* tokens of the #72 fixture
 *               line — the fixture grew, the tier did not)
 *   r1-r9 ..... checkArtifactAnchor through the seam: both repro anchors
 *               resolve (zero issues — r2 through the #72 per-group
 *               entry); single-token anchors still
 *               resolve; a miss into a contentful .txt = the exact
 *               refs.broken.anchor message; a miss into an EMPTY .txt =
 *               the advisory with the exact SEVEN-vocabulary message
 *               (corpus-band shape); the phrase typo did-you-mean (the
 *               entry outranks single tokens); the no-target narrowing
 *               (decorative-only .txt keeps the advisory); schematic
 *               targets get NO entry tier; prose .md gets NO entry tier
 *   c1-c3 ..... end to end over tmp workspaces (checkCodebaseRefs): the
 *               issue's two repro pointers at their real source paths
 *               resolve — zero findings, zero warnings; the phrase typo
 *               yields the did-you-mean naming the entry; the corpus
 *               refs engine inherits the tier through the ONE shared
 *               verdict (checkRefs silent on a spec-side phrase pointer)
 *
 * Runtime-neutral: imports the test facade, never 'bun:test' directly.
 */
import { describe, test, expect, afterEach } from './testing.ts';
import { join, dirname } from 'path';
import { mkdirSync, writeFileSync } from 'fs';

import { checkCodebaseRefs } from '../src/core/codebase.ts';
import { defaultCodebaseRules } from '../src/core/rules.ts';
import { parseOutline, flattenNodes } from '../src/core/outline.ts';
import { extractTextHeadings, extractTextEntries, extractTextLeafTokens } from '../src/core/text-anchors.ts';
import { checkArtifactAnchor, checkRefs, buildRefGraph } from '../src/core/refs.ts';
import { makeTmpDir, cleanTmpDir, makeCansWorkspace } from './helpers.ts';
import type { CodebaseRules, OutlineNode } from '../src/types.ts';

// ── Scaffolding (the issue #67–#70 engine suites' shape) ─────────────────────

const tmps: string[] = [];

afterEach(() => {
  while (tmps.length > 0) cleanTmpDir(tmps.pop()!);
});

const cbCfg = (over: Partial<CodebaseRules> = {}): CodebaseRules => ({
  ...defaultCodebaseRules(),
  ...over,
});

/** A PROJECT directory: `files` become the cans/ workspace, `projectFiles`
 *  sit beside it — the scanner's turf (the #69/#70 suites' makeProject). */
function makeProject(
  name: string,
  files: Record<string, string> = {},
  projectFiles: Record<string, string> = {},
): { project: string; root: string } {
  const project = makeTmpDir(`issue71-engine-${name}`);
  tmps.push(project);
  const root = makeCansWorkspace(project, files);
  for (const [rel, content] of Object.entries(projectFiles)) {
    const p = join(project, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content, 'utf8');
  }
  return { project, root };
}

/** A corpus map the way check.ts's specFiles is shaped (the #69 shape). */
function corpusOf(entries: Array<[string, string]>): Map<string, OutlineNode[]> {
  return new Map(entries.map(([key, src]) => [key, parseOutline(src, key)]));
}

const CORPUS: Array<[string, string]> = [
  ['00-overview.md', '- Overview\n- Session validation\n'],
];

// ── The issue's artifacts (kelir shapes; the target lines verbatim) ──────────

/** Shaped from the REAL cans/artifacts/diagrams/trap-flow.txt — the issue's
 *  repro 1. Target line 8 is the literal `Kernel seccomp-unotify triggers`
 *  (mixed case: never an ALL-CAPS heading; never underlined; no single
 *  token of it equals the hyphenated phrase — pre-#71 the anchor was a
 *  truthful-looking broken-anchor FALSE POSITIVE). */
const TRAP_FLOW_TXT = [
  'THE TRAP FLOW — guest syscalls, kernel first',
  '============================================',
  '',
  'The filter arms at shim boot (PID 1); the guest traps; the',
  'request queues on the notify ring. The lifecycle turn, in order:',
  'arming, trapping, queueing, then the one this diagram is about:',
  '',
  'Kernel seccomp-unotify triggers',
  '',
  'The shim polls the ring, renders each verdict, resumes the guest',
  '(a Drop verdict resumes with EPERM — policy, never a crash).',
  '',
].join('\n');

/** Shaped from the REAL cans/artifacts/diagrams/wire-plane.txt — the
 *  issue's repro 2, in its real 0.20.0 shape (issue #72): target line 5
 *  is the literal `[USERSPACE SMOLTCP INGRESS RING] [on_net_outbound]
 *  [on_net_inbound]` row — a bracketed box entry SHARING its line with
 *  two more bracketed groups. #71's exactly-one-pair strip therefore
 *  never applied (three of each), so pre-#72 only the whole three-group
 *  row minted and `#USERSPACE-SMOLTCP-INGRESS-RING` was a truthful-
 *  looking broken-anchor FALSE POSITIVE; #72 mints each flat group
 *  beside the verbatim row. Line 4 above it is non-blank so the ALL-CAPS
 *  heading guard stays out, and the bracketed `→` row at line 8 carries
 *  three more bracket pairs — the same per-group rule on a real diagram
 *  shape. */
const WIRE_PLANE_TXT = [
  'THE WIRE PLANE',
  '===============',
  '',
  'one hop per ring, guest to host:',
  '[USERSPACE SMOLTCP INGRESS RING] [on_net_outbound] [on_net_inbound]',
  '        │',
  '        ▼',
  ' [virtio-net TX] ──> [vsock stream] ──> [host tap]',
  ' KERNEL EGRESS RING',
  '',
].join('\n');

// ── A. extractTextEntries (the whole-line entry tier, pure) ──────────────────

describe('issue #71 engine — extractTextEntries (whole lines as entries)', () => {
  test('en1: the two repro lines — the plain phrase mints verbatim, the bracketed phrase strips ONE pair', () => {
    // Repro 1: `Kernel seccomp-unotify triggers` is the whole entry, the
    // hyphenated anchor resolves against it through the §12 folding.
    expect(extractTextEntries('Kernel seccomp-unotify triggers\n')).toEqual([
      'Kernel seccomp-unotify triggers',
    ]);
    // Repro 2: `[USERSPACE SMOLTCP INGRESS RING]` — exactly one `[` and
    // one `]` embracing the whole line, so the brackets are the box.
    expect(extractTextEntries('[USERSPACE SMOLTCP INGRESS RING]\n')).toEqual([
      'USERSPACE SMOLTCP INGRESS RING',
    ]);
  });

  test('en2: leading tree/box decoration strips — the │├└─ shapes of a project tree', () => {
    // The #70 tree shapes, entry-shaped: the glyphs INDENT the entry, they
    // are never part of its name. The pure-`│` spine line mints nothing.
    const tree = [
      'cans-ws/',
      '│',
      '├── crates/',
      '│   ├── kelir-shim/',
      '│   │   └── src/',
      '│   └── kelir-drivers/',
      '│       ├── driver-avf/',
      '│       └── driver-proot/',
      '└── docs/',
    ].join('\n');
    expect(extractTextEntries(tree)).toEqual([
      'cans-ws/', 'crates/', 'kelir-shim/', 'src/', 'kelir-drivers/',
      'driver-avf/', 'driver-proot/', 'docs/',
    ]);
  });

  test('en3: the `[a] [b]` guard — the whole multi-pair row stays verbatim while #72 mints each group beside it', () => {
    // Two pairs: the whole-line entry is the verbatim bracketed row (a
    // partial strip would mint a name the line never had) and, since #72,
    // each flat group mints its own interior — here both interiors are
    // 1-char, so the row mints alone (the guard stays).
    expect(extractTextEntries('[a] [b]\n')).toEqual(['[a] [b]']);
    // The real wire-plane row: three pairs plus ──> arrows — the verbatim
    // row FIRST, then the three group interiors left-to-right (#72).
    expect(extractTextEntries(' [virtio-net TX] ──> [vsock stream] ──> [host tap]\n')).toEqual([
      '[virtio-net TX] ──> [vsock stream] ──> [host tap]',
      'virtio-net TX',
      'vsock stream',
      'host tap',
    ]);
    // A leading bracket that does not END in `]` never strips the single
    // pair either — the whole line verbatim plus the one group it holds.
    expect(extractTextEntries('[USERSPACE RING] extra\n')).toEqual([
      '[USERSPACE RING] extra', 'USERSPACE RING',
    ]);
  });

  test('en4: decoration and data rows never mint — dashes, equals, numbers, single chars, empty brackets', () => {
    // Border/underline runs, pure numbers, single chars, empty and
    // digit-only bracket spans: length < 2 or no letter, never entries.
    expect(extractTextEntries('----\n====\n5432\n80\nx\n[]\n[5]\n')).toEqual([]);
    expect(extractTextEntries('┌──────┐\n└──────┘\n')).toEqual([]);
    expect(extractTextEntries('│\n├──\n└──\n─ ─ ─\n')).toEqual([]);
  });

  test('en4b: an underline row decorates — its TEXT line mints, the ---- row itself does not', () => {
    // Harmless duplicate of the #60 heading tier (the some() probe and the
    // slug-deduped suggestions are indifferent to a repeated text).
    expect(extractTextEntries('Title\n====\n----\n')).toEqual(['Title']);
  });

  test('en5: dedupe keeps the FIRST occurrence at its document position — on the CLEANED text', () => {
    // `[USERSPACE RING]` and `USERSPACE RING` clean to one entry; the
    // repeat phrase line collapses into its first occurrence.
    expect(extractTextEntries([
      'Kernel seccomp-unotify triggers',
      'Kernel seccomp-unotify triggers',
      '[USERSPACE RING]',
      'USERSPACE RING',
      'first',
    ].join('\n'))).toEqual([
      'Kernel seccomp-unotify triggers', 'USERSPACE RING', 'first',
    ]);
  });

  test('en6: CRLF input behaves identically to LF (the \r?\n house split)', () => {
    expect(extractTextEntries(
      'Kernel seccomp-unotify triggers\r\n[USERSPACE SMOLTCP INGRESS RING]\r\n│   ├── kelir-shim/\r\n',
    )).toEqual([
      'Kernel seccomp-unotify triggers',
      'USERSPACE SMOLTCP INGRESS RING',
      'kelir-shim/',
    ]);
  });

  test('en7: empty or whitespace-only source → []', () => {
    expect(extractTextEntries('')).toEqual([]);
    expect(extractTextEntries('\n\n   \n')).toEqual([]);
  });

  test('en8: single-word lines mint too — an entry is the whole line whatever its word count', () => {
    expect(extractTextEntries('OVERVIEW\nseccomp\n5432\n')).toEqual(['OVERVIEW', 'seccomp']);
  });

  test('en9: nothing strips from the RIGHT except whitespace — trailing │, / and inline comments stay truthful', () => {
    // A boxed row keeps its closing glyph (its interior tokens remain #70
    // leaf-addressable); a tree entry keeps its trailing `/`; the inline
    // `# comment` of the real project-structure shape is part of the line.
    expect(extractTextEntries('│  boxed row with trailing bar  │\n')).toEqual([
      'boxed row with trailing bar  │',
    ]);
    expect(extractTextEntries(
      '│   ├── kelir-shim/                    # Guest Paravirtual Micro-Init (<50KB musl PID 1)\n',
    )).toEqual([
      'kelir-shim/                    # Guest Paravirtual Micro-Init (<50KB musl PID 1)',
    ]);
    // Decoration strip runs BEFORE the bracket strip, so an indented
    // bracketed box entry cleans fully — the host-runtime box shape.
    expect(extractTextEntries('│ [USERSPACE SMOLTCP INGRESS RING]\n')).toEqual([
      'USERSPACE SMOLTCP INGRESS RING',
    ]);
  });

  test('en10: the two repro fixtures — the exact entry lists, document order', () => {
    expect(extractTextEntries(TRAP_FLOW_TXT)).toEqual([
      'THE TRAP FLOW — guest syscalls, kernel first',
      'The filter arms at shim boot (PID 1); the guest traps; the',
      'request queues on the notify ring. The lifecycle turn, in order:',
      'arming, trapping, queueing, then the one this diagram is about:',
      'Kernel seccomp-unotify triggers',
      'The shim polls the ring, renders each verdict, resumes the guest',
      '(a Drop verdict resumes with EPERM — policy, never a crash).',
    ]);
    expect(extractTextEntries(WIRE_PLANE_TXT)).toEqual([
      'THE WIRE PLANE',
      'one hop per ring, guest to host:',
      '[USERSPACE SMOLTCP INGRESS RING] [on_net_outbound] [on_net_inbound]',
      'USERSPACE SMOLTCP INGRESS RING',
      'on_net_outbound',
      'on_net_inbound',
      '[virtio-net TX] ──> [vsock stream] ──> [host tap]',
      'virtio-net TX',
      'vsock stream',
      'host tap',
      'KERNEL EGRESS RING',
    ]);
  });
});

// ── B. Regression pins — the two existing tiers are byte-unchanged ───────────

describe('issue #71 engine — the existing tiers stay byte-unchanged', () => {
  test('h1: extractTextHeadings on the repro fixtures — the #60 tier untouched by the entry tier', () => {
    // Only the underlined tops mint; `Kernel seccomp-unotify triggers`
    // (mixed case, non-blank predecessor above `[USERSPACE …]`) never
    // becomes a heading — the phrase repro resolves through ENTRIES only.
    expect(extractTextHeadings(TRAP_FLOW_TXT)).toEqual([
      'THE TRAP FLOW — guest syscalls, kernel first',
    ]);
    expect(extractTextHeadings(WIRE_PLANE_TXT)).toEqual(['THE WIRE PLANE']);
    // The #60 canonical shapes, re-pinned beside them (representative
    // inputs: ATX, underlined, ALL-CAPS standalone; prose stays prose).
    expect(extractTextHeadings('# Creation\n\nBODY\n====\n\nCREATION FLOW\n\nplain prose line\n')).toEqual([
      'Creation', 'BODY', 'CREATION FLOW',
    ]);
  });

  test('h2: extractTextLeafTokens on the repro fixtures — the #70 token tier untouched, exact lists', () => {
    // `seccomp-unotify` stays ONE internal-dash token (never the phrase);
    // the repro phrases are therefore NOT token-addressable — the exact
    // gap the entry tier fills.
    expect(extractTextLeafTokens(TRAP_FLOW_TXT)).toEqual([
      'THE', 'TRAP', 'FLOW', 'guest', 'syscalls', 'kernel', 'first', 'The',
      'filter', 'arms', 'at', 'shim', 'boot', 'PID', 'the', 'traps',
      'request', 'queues', 'on', 'notify', 'ring', 'lifecycle', 'turn',
      'in', 'order', 'arming', 'trapping', 'queueing', 'then', 'one',
      'this', 'diagram', 'is', 'about', 'Kernel', 'seccomp-unotify',
      'triggers', 'polls', 'renders', 'each', 'verdict', 'resumes',
      'Drop', 'with', 'EPERM', 'policy', 'never', 'crash',
    ]);
    expect(extractTextLeafTokens(WIRE_PLANE_TXT)).toEqual([
      'THE', 'WIRE', 'PLANE', 'one', 'hop', 'per', 'ring', 'guest', 'to',
      'host', 'USERSPACE', 'SMOLTCP', 'INGRESS', 'RING', 'on_net_outbound',
      'on_net_inbound', 'virtio-net', 'TX', 'vsock', 'stream', 'tap',
      'KERNEL', 'EGRESS',
    ]);
  });
});

// ── C. Resolution through the frozen seam (checkArtifactAnchor) ──────────────

describe('issue #71 engine — resolution through checkArtifactAnchor', () => {
  test('r1: repro 1 resolves — #Kernel-seccomp-unotify-triggers over the whole entry line, zero issues', () => {
    // The §12 folding already equated the spellings; the entry tier
    // supplies the missing vocabulary. Pre-#71: `broken anchor: …
    // cans/artifacts/diagrams/trap-flow.txt#Kernel-seccomp-unotify-
    // triggers — no node matches`.
    const nodes = flattenNodes(parseOutline(TRAP_FLOW_TXT, 'cans/artifacts/diagrams/trap-flow.txt'));
    expect(checkArtifactAnchor(
      'crates/kelir-shim/src/trap.rs', 3, 'cans/artifacts/diagrams/trap-flow.txt',
      'Kernel-seccomp-unotify-triggers', 'cans/artifacts/diagrams/trap-flow.txt', TRAP_FLOW_TXT, nodes,
    )).toEqual([]);
  });

  test('r2: repro 2 resolves — #USERSPACE-SMOLTCP-INGRESS-RING over the #72 per-group entry', () => {
    // Line 5's real 0.20.0 shape carries THREE bracketed groups, so #71's
    // single-pair strip never applied; the #72 per-group rule mints
    // `USERSPACE SMOLTCP INGRESS RING` beside the verbatim row, and the
    // §12 folding resolves the hyphenated phrase against it.
    const nodes = flattenNodes(parseOutline(WIRE_PLANE_TXT, 'cans/artifacts/diagrams/wire-plane.txt'));
    expect(checkArtifactAnchor(
      'crates/kelir-transport/src/lib.rs', 3, 'cans/artifacts/diagrams/wire-plane.txt',
      'USERSPACE-SMOLTCP-INGRESS-RING', 'cans/artifacts/diagrams/wire-plane.txt', WIRE_PLANE_TXT, nodes,
    )).toEqual([]);
  });

  test('r3: single-token anchors into .txt still resolve — the #70 token tier untouched', () => {
    // `seccomp-unotify` is ONE internal-dash token; `virtio-net` minted
    // from the three-pair bracketed row. Both silent before #71, silent
    // after — the entry tier only adds.
    const nodes = flattenNodes(parseOutline(TRAP_FLOW_TXT, 'cans/artifacts/diagrams/trap-flow.txt'));
    expect(checkArtifactAnchor(
      'src/driver.rs', 1, 'cans/artifacts/diagrams/trap-flow.txt',
      'seccomp-unotify', 'cans/artifacts/diagrams/trap-flow.txt', TRAP_FLOW_TXT, nodes,
    )).toEqual([]);
    const nodes2 = flattenNodes(parseOutline(WIRE_PLANE_TXT, 'cans/artifacts/diagrams/wire-plane.txt'));
    expect(checkArtifactAnchor(
      'src/driver.rs', 1, 'cans/artifacts/diagrams/wire-plane.txt',
      'virtio-net', 'cans/artifacts/diagrams/wire-plane.txt', WIRE_PLANE_TXT, nodes2,
    )).toEqual([]);
  });

  test('r4: a miss into a CONTENTFUL .txt — the exact refs.broken.anchor error, never a silent pass', () => {
    const nodes = flattenNodes(parseOutline(TRAP_FLOW_TXT, 'cans/artifacts/diagrams/trap-flow.txt'));
    const issues = checkArtifactAnchor(
      'crates/kelir-shim/src/trap.rs', 3, 'cans/artifacts/diagrams/trap-flow.txt',
      'no-such-entry', 'cans/artifacts/diagrams/trap-flow.txt', TRAP_FLOW_TXT, nodes,
    );
    expect(issues.length).toBe(1);
    expect(issues[0]!.level).toBe('error');
    expect(issues[0]!.rule).toBe('refs.broken.anchor');
    expect(issues[0]!.message).toBe(
      'broken anchor: cans/artifacts/diagrams/trap-flow.txt#no-such-entry — no node matches',
    );
  });

  test('r5: a miss into an EMPTY .txt — the advisory, exact SEVEN-vocabulary bytes (corpus-band shape)', () => {
    // The #49 downgrade survives for truly contentless targets; the
    // parenthetical names the full addressable set, `text entries, `
    // inserted after `text headings, ` (issue #71).
    const issues = checkArtifactAnchor(
      '00-overview.md', 3, 'docs/notes.txt', 'anything', 'docs/notes.txt', '', [],
    );
    expect(issues.length).toBe(1);
    expect(issues[0]!.level).toBe('warning');
    expect(issues[0]!.rule).toBe('refs.anchor.no-target');
    expect(issues[0]!.message).toBe(
      'anchor on non-outline target: docs/notes.txt#anything — target has no addressable nodes (bullets, schematic key paths, text headings, text entries, code symbols, referenced names, text tokens); use a file-level ref',
    );
  });

  test('r6: a phrase typo earns the did-you-mean over the ENTRY — anchorSlug spelling, entries outrank tokens', () => {
    // `Kernel-seccomp-unotfy-triggers` (one letter dropped): the entry
    // `Kernel seccomp-unotify triggers` scores ≈ 0.97 against it while
    // every single token (Kernel, seccomp-unotify, triggers) sits far
    // below the 0.8 floor — ONE near candidate, the canonical slug
    // `Kernel-seccomp-unotify-triggers`, exactly the form that resolves.
    const nodes = flattenNodes(parseOutline(TRAP_FLOW_TXT, 'cans/artifacts/diagrams/trap-flow.txt'));
    const issues = checkArtifactAnchor(
      'crates/kelir-shim/src/trap.rs', 3, 'cans/artifacts/diagrams/trap-flow.txt',
      'Kernel-seccomp-unotfy-triggers', 'cans/artifacts/diagrams/trap-flow.txt', TRAP_FLOW_TXT, nodes,
    );
    expect(issues.length).toBe(1);
    expect(issues[0]!.rule).toBe('refs.broken.anchor');
    expect(issues[0]!.message).toBe(
      'broken anchor: cans/artifacts/diagrams/trap-flow.txt#Kernel-seccomp-unotfy-triggers — no node matches',
    );
    expect(issues[0]!.suggestion).toBe(
      'did you mean cans/artifacts/diagrams/trap-flow.txt#Kernel-seccomp-unotify-triggers? — fix the ref anchor',
    );
  });

  test('r7: the no-target narrowing — a decorative-only .txt (----/====/5432 rows) keeps the advisory', () => {
    // Entries empty, headings empty, tokens empty: no anchor could ever
    // resolve there by construction — the advisory, not a broken-anchor
    // error fabricated by the entry tier's presence in the codebase.
    const decorative = '----\n====\n5432\n80\n';
    const nodes = flattenNodes(parseOutline(decorative, 'artifacts/border.txt'));
    const issues = checkArtifactAnchor(
      '00-overview.md', 3, 'artifacts/border.txt', 'anything', 'artifacts/border.txt', decorative, nodes,
    );
    expect(issues.length).toBe(1);
    expect(issues[0]!.rule).toBe('refs.anchor.no-target');
    expect(issues[0]!.level).toBe('warning');
    expect(issues[0]!.message).toBe(
      'anchor on non-outline target: artifacts/border.txt#anything — target has no addressable nodes (bullets, schematic key paths, text headings, text entries, code symbols, referenced names, text tokens); use a file-level ref',
    );
  });

  test('r8: a schematic target gets NO entry tier — a VALUE phrase stays a truthful error', () => {
    // The wire-plane phrase sits in this yaml as a scalar VALUE; schematic
    // resolution (parseSchematic dot paths) never mints it and the entry
    // tier of a schematic target is [] by construction — the anchor
    // errors instead of silently resolving against the file's lines.
    const yaml = 'wire: USERSPACE SMOLTCP INGRESS RING\nchecklist:\n  - first item\n';
    const nodes = flattenNodes(parseOutline(yaml, 'artifacts/wire.yaml'));
    const issues = checkArtifactAnchor(
      '00-overview.md', 3, 'artifacts/wire.yaml', 'USERSPACE-SMOLTCP-INGRESS-RING',
      'artifacts/wire.yaml', yaml, nodes,
    );
    expect(issues.length).toBe(1);
    expect(issues[0]!.rule).toBe('refs.broken.anchor');
    expect(issues[0]!.message).toBe(
      'broken anchor: artifacts/wire.yaml#USERSPACE-SMOLTCP-INGRESS-RING — no node matches',
    );
  });

  test('r9: a prose .md target gets NO entry tier — a whole prose line is not an addressable entry', () => {
    // Neither isTextArtifact nor isCodeArtifact matches `.md`: spec-node
    // anchors are never entry-addressable, so a phrase naming a whole
    // prose line of a bulletless .md keeps the #49 advisory.
    const prose = 'The quick brown fox jumps over the lazy dog.\nNo bullets here at all.\n';
    const nodes = flattenNodes(parseOutline(prose, 'docs/notes.md'));
    expect(nodes).toHaveLength(0);
    const issues = checkArtifactAnchor(
      '00-overview.md', 3, 'docs/notes.md', 'The-quick-brown-fox-jumps-over-the-lazy-dog',
      'docs/notes.md', prose, nodes,
    );
    expect(issues.length).toBe(1);
    expect(issues[0]!.rule).toBe('refs.anchor.no-target');
    expect(issues[0]!.message).toBe(
      'anchor on non-outline target: docs/notes.md#The-quick-brown-fox-jumps-over-the-lazy-dog — target has no addressable nodes (bullets, schematic key paths, text headings, text entries, code symbols, referenced names, text tokens); use a file-level ref',
    );
  });
});

// ── D. End to end (checkCodebaseRefs over tmp workspaces) ────────────────────

describe('issue #71 engine — the codebase band end to end', () => {
  test('c1: the issue\'s two repro pointers resolve — zero findings, zero warnings', async () => {
    // The exact repro shape: the pointers sit at line 3 of their real
    // source paths, naming whole diagram entries of their targets.
    const { root } = makeProject('repro', {
      '00-overview.md': CORPUS[0]![1],
      'artifacts/diagrams/trap-flow.txt': TRAP_FLOW_TXT,
      'artifacts/diagrams/wire-plane.txt': WIRE_PLANE_TXT,
    }, {
      'crates/kelir-shim/src/trap.rs': [
        '// crates/kelir-shim/src/trap.rs',
        '//',
        '// see: cans/artifacts/diagrams/trap-flow.txt#Kernel-seccomp-unotify-triggers',
        '',
      ].join('\n'),
      'crates/kelir-transport/src/lib.rs': [
        '// crates/kelir-transport/src/lib.rs',
        '//',
        '// see: cans/artifacts/diagrams/wire-plane.txt#USERSPACE-SMOLTCP-INGRESS-RING',
        '',
      ].join('\n'),
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings).toEqual([]); // the two false positives, resolving
    expect(scan.warnings).toEqual([]);
    expect(scan.pointers).toBe(2);
  });

  test('c2: a phrase typo end to end — the finding carries the entry did-you-mean', async () => {
    const { root } = makeProject('typo', {
      '00-overview.md': CORPUS[0]![1],
      'artifacts/diagrams/trap-flow.txt': TRAP_FLOW_TXT,
    }, {
      'crates/kelir-shim/src/trap.rs': '// see: cans/artifacts/diagrams/trap-flow.txt#Kernel-seccomp-unotfy-triggers\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings.length).toBe(1);
    const f = scan.findings[0]!;
    expect(f.reason).toBe('AnchorNotFound');
    expect(f.message).toBe(
      'broken codebase ref: crates/kelir-shim/src/trap.rs:1 — see: cans/artifacts/diagrams/trap-flow.txt#Kernel-seccomp-unotfy-triggers — broken anchor: cans/artifacts/diagrams/trap-flow.txt#Kernel-seccomp-unotfy-triggers — no node matches',
    );
    expect(f.suggestion).toBe(
      'did you mean cans/artifacts/diagrams/trap-flow.txt#Kernel-seccomp-unotify-triggers? — fix the ref anchor',
    );
  });

  test('c3: the corpus refs engine inherits the tier — ONE shared verdict, a spec-side phrase pointer resolves', () => {
    // checkRefs' on-disk artifact path rides the same checkArtifactAnchor
    // (the #68/#69/#70 architecture principle), so a corpus `see:` naming
    // a whole diagram entry resolves there too — no per-engine drift.
    const project = makeTmpDir('issue71-engine-corpus-seam');
    tmps.push(project);
    const root = makeCansWorkspace(project, {
      '00-overview.md': [
        '- Overview',
        '  - Trap flow: see artifacts/diagrams/trap-flow.txt#Kernel-seccomp-unotify-triggers',
        '',
      ].join('\n'),
      'artifacts/diagrams/trap-flow.txt': TRAP_FLOW_TXT,
    });
    const spec = {
      '00-overview.md': '- Overview\n  - Trap flow: see artifacts/diagrams/trap-flow.txt#Kernel-seccomp-unotify-triggers\n',
    };
    const files = new Map<string, OutlineNode[]>(
      Object.entries(spec).map(([name, body]) => [name, parseOutline(body, name)] as const),
    );
    const issues = checkRefs(files, buildRefGraph(files, root), root);
    expect(issues).toEqual([]); // resolves through the entry tier, silently
  });
});
