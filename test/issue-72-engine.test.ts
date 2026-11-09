/**
 * Issue #72 — the ENGINE half: a bracketed diagram entry SHARING its line
 * with other bracketed entries.
 *
 *   the defect — issue #71 fixed the phrase form (the entry tier resolves
 *   phrase anchors naming a whole diagram line; `#Kernel-seccomp-unotify-
 *   triggers` resolves), but ONE case remained on the kelir repo (1650
 *   codebase `see:` pointers; the local checker passes 1650/0/0): `cans
 *   check --codebase` reports 1 error, `crates/kelir-transport/src/lib.rs:
 *   3` — `see: cans/artifacts/diagrams/wire-plane.txt#USERSPACE-SMOLTCP-
 *   INGRESS-RING`; target line 5 of wire-plane.txt: `[USERSPACE SMOLTCP
 *   INGRESS RING] [on_net_outbound] [on_net_inbound]`; reported as `broken
 *   anchor: … — no node matches`. CAUSE: the #71 entry tier strips one
 *   outermost ASCII bracket pair only "when it is the only one" — this
 *   line has three bracketed groups, so no stripping applies, the whole
 *   line (all three entries plus brackets) is the entry, and the phrase
 *   anchor names the first group, which no single node equals. The issue's
 *   minimal repro: t.txt line 1 `  [FOO BAR BAZ] [other one]`, line 2
 *   `  [SOLO ENTRY HERE]` — `#FOO-BAR-BAZ` fails "no node matches" while
 *   `#SOLO-ENTRY-HERE` resolves; the ONLY difference is the second
 *   bracketed group. EXPECTED: each bracketed group on a line is its own
 *   entry (or the bracket-stripping applies per group) — the #71
 *   semantics ("a pointer into a diagram means this entry of the diagram")
 *   treat `[USERSPACE SMOLTCP INGRESS RING]` as one entry regardless of
 *   what shares its line.
 *
 *   the fix (the frozen #72 spec) — purely additive inside
 *   extractTextEntries (text-anchors.ts); per physical line, after the
 *   #71 trim and LEADING-decoration strip:
 *    1. SINGLE-PAIR case byte-unchanged (#71): cleaned text starts with
 *       `[`, ends with `]`, exactly one of each → the entry is the
 *       interior, trimmed (`[SOLO ENTRY HERE]` → `SOLO ENTRY HERE`, and
 *       only the interior — the bracketed spelling itself never mints).
 *    2. EVERY OTHER shape (0 or ≥2 bracket pairs, or brackets not
 *       embracing the whole text): the whole cleaned line mints VERBATIM
 *       (unchanged #71 rule) AND ADDITIONALLY each maximal FLAT bracketed
 *       group on the line — the /\[([^[\]]*)\]/g scan, left-to-right —
 *       mints its trimmed interior as its OWN entry under the SAME guards
 *       (≥ 2 chars AND a letter): `[]`, `[5]`, `[x]`, `[----]` never mint,
 *       nothing strips inside a group except whitespace-trim, and nested
 *       `[[FOO BAR]]` is NOT the single-pair case — its flat group
 *       `[FOO BAR]` mints `FOO BAR` beside the verbatim line.
 *    3. EMISSION ORDER per line: whole-line candidate FIRST, then group
 *       interiors left-to-right; first-occurrence dedupe (key = cleaned
 *       candidate text) over the whole document.
 *   The whole-line entry KEEPS minting verbatim, so the widening never
 *   narrows: a pointer that spells the whole row still resolves. Everything
 *   else byte-unchanged: extractTextHeadings, extractTextLeafTokens, the
 *   refs.ts checkArtifactAnchor seam wiring, the seven-vocabulary
 *   no-target message, report.ts, codebase.ts, schematic/.md/code targets.
 *
 * WHAT EACH BLOCK PINS
 *   en1-en12 .. extractTextEntries (pure): the issue's minimal repro lines
 *               verbatim; the three-group wire-plane line; the solo
 *               single-pair control; `[a] [b]` unchanged; nested
 *               `[[FOO BAR]]`; unbalanced `[FOO BAR`; the guard skips;
 *               emission order (whole-line first, groups left-to-right);
 *               dedupe (a group interior equal to an earlier entry
 *               collapses — and the whole line against an earlier group);
 *               CRLF identity; decoration-then-brackets (decor strip,
 *               then two pairs → verbatim + groups, with the single-pair
 *               after-decor control unchanged); the four-ring-bus
 *               four-group row
 *   h1 ........ regression pin: extractTextHeadings and
 *               extractTextLeafTokens byte-unchanged over the #72 shapes
 *               (headings [], the exact token lists — brackets were never
 *               structure to those tiers)
 *   r1-r9 ..... checkArtifactAnchor through the seam: `#FOO-BAR-BAZ`
 *               resolves over t.txt (zero issues); `#SOLO-ENTRY-HERE`
 *               resolves (the control); `#USERSPACE-SMOLTCP-INGRESS-RING`
 *               resolves over the three-group line; the near-miss typo
 *               earns the did-you-mean naming the ENTRY spelling; the 0.8
 *               suggestion floor keeps a farther typo a truthful "no near
 *               match"; single-token anchors still resolve; the whole-line
 *               spelling still resolves (never narrows — the §12 fold
 *               preserves brackets, so the whole-row anchor spelling is
 *               the bracketed one); a miss into a contentful .txt stays
 *               the exact refs.broken.anchor error; the empty .txt
 *               advisory keeps the exact SEVEN-vocabulary message
 *   c1-c3 ..... end to end over tmp workspaces (checkCodebaseRefs): the
 *               issue's repro — t.txt plus a carrier source with the two
 *               pointers — zero findings, zero warnings, pointers counted;
 *               the typo carrier → one AnchorNotFound finding carrying the
 *               entry did-you-mean; the corpus seam (checkRefs silent on a
 *               spec-side phrase pointer into t.txt — ONE shared verdict)
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

// ── Scaffolding (the issue #67–#71 engine suites' shape) ─────────────────────

const tmps: string[] = [];

afterEach(() => {
  while (tmps.length > 0) cleanTmpDir(tmps.pop()!);
});

const cbCfg = (over: Partial<CodebaseRules> = {}): CodebaseRules => ({
  ...defaultCodebaseRules(),
  ...over,
});

/** A PROJECT directory: `files` become the cans/ workspace, `projectFiles`
 *  sit beside it — the scanner's turf (the #69–#71 suites' makeProject). */
function makeProject(
  name: string,
  files: Record<string, string> = {},
  projectFiles: Record<string, string> = {},
): { project: string; root: string } {
  const project = makeTmpDir(`issue72-engine-${name}`);
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

// ── The issue's artifacts (the target lines verbatim) ────────────────────────

/** The issue's MINIMAL REPRO target, verbatim: t.txt line 1 the two-group
 *  row `  [FOO BAR BAZ] [other one]` (the bracketed entry sharing its line
 *  with a second bracketed group — pre-#72 only the whole row minted, so
 *  `#FOO-BAR-BAZ` was a broken-anchor FALSE POSITIVE), line 2 the solo
 *  control `  [SOLO ENTRY HERE]` (the single-pair #71 shape that already
 *  resolved). Line 1's lowercase `other one` and line 2's non-blank
 *  predecessor keep the #60 heading tier out of both rows. */
const T_TXT = '  [FOO BAR BAZ] [other one]\n  [SOLO ENTRY HERE]\n';

// ── A. extractTextEntries (the per-group bracket rule, pure) ─────────────────

describe('issue #72 engine — extractTextEntries (each bracketed group is its own entry)', () => {
  test('en1: the issue\'s minimal repro, verbatim — the two-group row mints beside its groups, the solo line keeps the #71 strip', () => {
    // THE heart of the issue: line 1 carries a second bracketed group, so
    // #71's exactly-one-pair strip never applied — the whole row mints
    // verbatim AND each group's interior mints beside it; line 2 is the
    // single-pair control, its interior only (unchanged #71).
    expect(extractTextEntries(T_TXT)).toEqual([
      '[FOO BAR BAZ] [other one]',
      'FOO BAR BAZ',
      'other one',
      'SOLO ENTRY HERE',
    ]);
  });

  test('en2: the three-group wire-plane line — the real 0.20.0 repro, verbatim row plus its three interiors', () => {
    // wire-plane.txt line 5 exactly as the issue quotes it; the phrase
    // anchor names the FIRST group, which no single node equaled pre-#72.
    expect(extractTextEntries('[USERSPACE SMOLTCP INGRESS RING] [on_net_outbound] [on_net_inbound]')).toEqual([
      '[USERSPACE SMOLTCP INGRESS RING] [on_net_outbound] [on_net_inbound]',
      'USERSPACE SMOLTCP INGRESS RING',
      'on_net_outbound',
      'on_net_inbound',
    ]);
  });

  test('en3: the solo single-pair control — `[SOLO ENTRY HERE]` alone mints ONLY the interior (the #71 rule byte-unchanged)', () => {
    // One pair embracing the whole line: the brackets are the box, not the
    // name — and the bracketed spelling itself never mints beside it.
    expect(extractTextEntries('[SOLO ENTRY HERE]\n')).toEqual(['SOLO ENTRY HERE']);
  });

  test('en4: `[a] [b]` unchanged — the whole row mints verbatim, its 1-char interiors never do', () => {
    // The #71 guard pin, byte-green post-#72: both group interiors fail
    // the ≥2-char mint guard, so the verbatim row mints alone.
    expect(extractTextEntries('[a] [b]\n')).toEqual(['[a] [b]']);
  });

  test('en5: nested `[[FOO BAR]]` — two of each is NOT the single-pair case; the flat group mints beside the verbatim line', () => {
    // The flat scan never enters a bracket: the outer `[` has a `[` right
    // behind it, so the ONE maximal flat group is the inner `[FOO BAR]`.
    expect(extractTextEntries('[[FOO BAR]]\n')).toEqual(['[[FOO BAR]]', 'FOO BAR']);
  });

  test('en6: unbalanced `[FOO BAR` — no closer, no group; the whole line mints verbatim only', () => {
    expect(extractTextEntries('[FOO BAR\n')).toEqual(['[FOO BAR']);
  });

  test('en7: the guard skips — `[]`, `[5]`, `[x]`, `[----]` never mint, alone or beside a good group', () => {
    // Alone every one of them is the single-pair case whose interior
    // fails a mint guard (empty / 1 char / letterless).
    expect(extractTextEntries('[]\n[5]\n[x]\n[----]\n')).toEqual([]);
    // Beside a good group the whole row mints verbatim, the good group
    // mints, the failing interiors stay out — the guards apply per
    // candidate, whole line and group interior alike.
    expect(extractTextEntries('[ok entry] [] [5] [x] [----]\n')).toEqual([
      '[ok entry] [] [5] [x] [----]',
      'ok entry',
    ]);
  });

  test('en8: emission order — the whole-line candidate FIRST, then the group interiors left-to-right (never sorted)', () => {
    // ALPHA sorts before GAMMA but sits second on the line: the order is
    // positional, pinning the frozen emission order.
    expect(extractTextEntries('[GAMMA DELTA] [ALPHA BETA]\n')).toEqual([
      '[GAMMA DELTA] [ALPHA BETA]',
      'GAMMA DELTA',
      'ALPHA BETA',
    ]);
  });

  test('en9: dedupe — a group interior equal to an earlier entry collapses, and so does the whole line against an earlier mint', () => {
    // First occurrence wins at its document position, key = cleaned
    // candidate text, over the whole document — in BOTH directions.
    expect(extractTextEntries('USERSPACE RING\n[USERSPACE RING] [other]\n')).toEqual([
      'USERSPACE RING',
      '[USERSPACE RING] [other]',
      'other',
    ]);
    expect(extractTextEntries('[USERSPACE RING] [other]\nUSERSPACE RING\n')).toEqual([
      '[USERSPACE RING] [other]',
      'USERSPACE RING',
      'other',
    ]);
  });

  test('en10: CRLF input behaves identically to LF (the \r?\n house split)', () => {
    expect(extractTextEntries('  [FOO BAR BAZ] [other one]\r\n  [SOLO ENTRY HERE]\r\n')).toEqual([
      '[FOO BAR BAZ] [other one]',
      'FOO BAR BAZ',
      'other one',
      'SOLO ENTRY HERE',
    ]);
  });

  test('en11: decoration-then-brackets — the decor strip runs FIRST, then the pair count decides the case', () => {
    // Two pairs after the `│ ` strip → NOT the single-pair case: the
    // verbatim row plus both group interiors (a `│ [USERSPACE …]` line is
    // no longer the #71 single-pair shape once a second group shares it).
    expect(extractTextEntries('│ [USERSPACE SMOLTCP INGRESS RING] [on_net_outbound]\n')).toEqual([
      '[USERSPACE SMOLTCP INGRESS RING] [on_net_outbound]',
      'USERSPACE SMOLTCP INGRESS RING',
      'on_net_outbound',
    ]);
    // The single-pair-after-decor control keeps the #71 interior strip.
    expect(extractTextEntries('│ [USERSPACE SMOLTCP INGRESS RING]\n')).toEqual([
      'USERSPACE SMOLTCP INGRESS RING',
    ]);
  });

  test('en12: the four-ring-bus four-group row — the real #70 fixture shape, verbatim row plus its four interiors', () => {
    // cans/artifacts/diagrams/four-ring-bus.txt line 5 verbatim; pre-#72
    // the row minted alone and its groups were only leaf-TOKEN-addressable.
    expect(extractTextEntries(
      ' [virtio-vsock]  [virtio-console]          [virtio-fs]        [virtio-net]',
    )).toEqual([
      '[virtio-vsock]  [virtio-console]          [virtio-fs]        [virtio-net]',
      'virtio-vsock',
      'virtio-console',
      'virtio-fs',
      'virtio-net',
    ]);
  });
});

// ── B. Regression pin — the two other tiers are byte-unchanged ───────────────

describe('issue #72 engine — the existing tiers stay byte-unchanged', () => {
  test('h1: extractTextHeadings and extractTextLeafTokens over the #72 shapes — brackets were never structure to them', () => {
    // Headings: line 1 fails the ALL-CAPS case (lowercase `other one`),
    // line 2 `[SOLO ENTRY HERE]` would pass the shape guards but its
    // predecessor is NON-blank — the #60 standalone-paragraph guard keeps
    // it out exactly as on the wire-plane fixture. Tokens: the plain
    // word list, brackets and all decoration ignored (the #70 tier).
    expect(extractTextHeadings(T_TXT)).toEqual([]);
    expect(extractTextLeafTokens(T_TXT)).toEqual([
      'FOO', 'BAR', 'BAZ', 'other', 'one', 'SOLO', 'ENTRY', 'HERE',
    ]);
    // The three-group wire-plane line: no headings, and the tokens the
    // #70 tier always minted — the per-group rule added nothing here.
    expect(extractTextHeadings('[USERSPACE SMOLTCP INGRESS RING] [on_net_outbound] [on_net_inbound]')).toEqual([]);
    expect(extractTextLeafTokens('[USERSPACE SMOLTCP INGRESS RING] [on_net_outbound] [on_net_inbound]')).toEqual([
      'USERSPACE', 'SMOLTCP', 'INGRESS', 'RING', 'on_net_outbound', 'on_net_inbound',
    ]);
  });
});

// ── C. Resolution through the frozen seam (checkArtifactAnchor) ──────────────

describe('issue #72 engine — resolution through checkArtifactAnchor', () => {
  test('r1: the issue\'s failing anchor resolves — #FOO-BAR-BAZ over t.txt, zero issues', () => {
    // THE repro: pre-#72 `broken anchor: cans/artifacts/diagrams/
    // t.txt#FOO-BAR-BAZ — no node matches`. The per-group entry
    // `FOO BAR BAZ` + the §12 folding resolve it now.
    const nodes = flattenNodes(parseOutline(T_TXT, 'cans/artifacts/diagrams/t.txt'));
    expect(checkArtifactAnchor(
      'src/lib.rs', 3, 'cans/artifacts/diagrams/t.txt',
      'FOO-BAR-BAZ', 'cans/artifacts/diagrams/t.txt', T_TXT, nodes,
    )).toEqual([]);
  });

  test('r2: the control resolves — #SOLO-ENTRY-HERE, the #71 single-pair strip untouched by #72', () => {
    const nodes = flattenNodes(parseOutline(T_TXT, 'cans/artifacts/diagrams/t.txt'));
    expect(checkArtifactAnchor(
      'src/lib.rs', 3, 'cans/artifacts/diagrams/t.txt',
      'SOLO-ENTRY-HERE', 'cans/artifacts/diagrams/t.txt', T_TXT, nodes,
    )).toEqual([]);
  });

  test('r3: the real repro resolves — #USERSPACE-SMOLTCP-INGRESS-RING over the three-group line', () => {
    // wire-plane.txt line 5 in its 0.20.0 shape: the phrase names the
    // FIRST group of three, and resolves through the per-group entry.
    const line = '[USERSPACE SMOLTCP INGRESS RING] [on_net_outbound] [on_net_inbound]';
    const nodes = flattenNodes(parseOutline(line, 'cans/artifacts/diagrams/wire-plane.txt'));
    expect(checkArtifactAnchor(
      'crates/kelir-transport/src/lib.rs', 3, 'cans/artifacts/diagrams/wire-plane.txt',
      'USERSPACE-SMOLTCP-INGRESS-RING', 'cans/artifacts/diagrams/wire-plane.txt', line, nodes,
    )).toEqual([]);
  });

  test('r4: a group near-miss typo earns the did-you-mean naming the ENTRY spelling', () => {
    // `FOO-BAR-BAZS` (one letter added) scores ≈ 0.917 against the entry
    // `FOO BAR BAZ` while every single token sits far below the 0.8 floor
    // — ONE near candidate, the canonical anchorSlug spelling
    // `FOO-BAR-BAZ`, exactly the form that resolves.
    const nodes = flattenNodes(parseOutline(T_TXT, 'cans/artifacts/diagrams/t.txt'));
    for (const typo of ['FOO-BAR-BAZS', 'FOO-BAR-BA']) {
      const issues = checkArtifactAnchor(
        'src/lib.rs', 3, 'cans/artifacts/diagrams/t.txt',
        typo, 'cans/artifacts/diagrams/t.txt', T_TXT, nodes,
      );
      expect(issues.length).toBe(1);
      expect(issues[0]!.rule).toBe('refs.broken.anchor');
      expect(issues[0]!.message).toBe(
        `broken anchor: cans/artifacts/diagrams/t.txt#${typo} — no node matches`,
      );
      expect(issues[0]!.suggestion).toBe(
        'did you mean cans/artifacts/diagrams/t.txt#FOO-BAR-BAZ? — fix the ref anchor',
      );
    }
  });

  test('r5: the suggestion floor — a farther typo stays a truthful "no near match" (no fabricated group)', () => {
    // `FOO-BAR` scores ≈ 0.636 against the entry `FOO BAR BAZ` (and less
    // against every token) — below SLUG_SUGGEST_THRESHOLD 0.8, so the
    // suggestion is the add-the-node advice, never a false did-you-mean.
    const nodes = flattenNodes(parseOutline(T_TXT, 'cans/artifacts/diagrams/t.txt'));
    const issues = checkArtifactAnchor(
      'src/lib.rs', 3, 'cans/artifacts/diagrams/t.txt',
      'FOO-BAR', 'cans/artifacts/diagrams/t.txt', T_TXT, nodes,
    );
    expect(issues.length).toBe(1);
    expect(issues[0]!.rule).toBe('refs.broken.anchor');
    expect(issues[0]!.suggestion).toBe(
      'no near match in cans/artifacts/diagrams/t.txt — add the "FOO-BAR" node there, or fix the anchor spelling',
    );
  });

  test('r6: single-token anchors still resolve — the #70 token tier untouched beneath the widened entry tier', () => {
    const nodes = flattenNodes(parseOutline(T_TXT, 'cans/artifacts/diagrams/t.txt'));
    expect(checkArtifactAnchor(
      'src/lib.rs', 3, 'cans/artifacts/diagrams/t.txt',
      'BAZ', 'cans/artifacts/diagrams/t.txt', T_TXT, nodes,
    )).toEqual([]);
    expect(checkArtifactAnchor(
      'src/lib.rs', 3, 'cans/artifacts/diagrams/t.txt',
      'ENTRY', 'cans/artifacts/diagrams/t.txt', T_TXT, nodes,
    )).toEqual([]);
    // A single token that is ALSO a whole group (the three-group line's
    // `on_net_outbound`) resolves through the entry tier now, ranked
    // before the leaves — the widening never narrows.
    const line = '[USERSPACE SMOLTCP INGRESS RING] [on_net_outbound] [on_net_inbound]';
    const wNodes = flattenNodes(parseOutline(line, 'cans/artifacts/diagrams/wire-plane.txt'));
    expect(checkArtifactAnchor(
      'src/lib.rs', 3, 'cans/artifacts/diagrams/wire-plane.txt',
      'on_net_outbound', 'cans/artifacts/diagrams/wire-plane.txt', line, wNodes,
    )).toEqual([]);
  });

  test('r7: the whole-line spelling still resolves — never narrows (the §12 fold preserves brackets)', () => {
    // The whole-row entry `[FOO BAR BAZ] [other one]` normalizes with its
    // brackets (`[`/`]` are not separators — src/core/slug.ts), so the
    // anchor spelling that matches it is the bracketed one: hyphens fold
    // to spaces, brackets stay. The #71 whole-line truth survives #72.
    const nodes = flattenNodes(parseOutline(T_TXT, 'cans/artifacts/diagrams/t.txt'));
    expect(checkArtifactAnchor(
      'src/lib.rs', 3, 'cans/artifacts/diagrams/t.txt',
      '[FOO-BAR-BAZ]-[other-one]', 'cans/artifacts/diagrams/t.txt', T_TXT, nodes,
    )).toEqual([]);
    // …and the literal row spelling trivially (exact text, clause 1 of
    // anchorMatches).
    expect(checkArtifactAnchor(
      'src/lib.rs', 3, 'cans/artifacts/diagrams/t.txt',
      '[FOO BAR BAZ] [other one]', 'cans/artifacts/diagrams/t.txt', T_TXT, nodes,
    )).toEqual([]);
  });

  test('r8: a miss into a CONTENTFUL .txt — the exact refs.broken.anchor error, never a silent pass', () => {
    const nodes = flattenNodes(parseOutline(T_TXT, 'cans/artifacts/diagrams/t.txt'));
    const issues = checkArtifactAnchor(
      'src/lib.rs', 3, 'cans/artifacts/diagrams/t.txt',
      'no-such-entry', 'cans/artifacts/diagrams/t.txt', T_TXT, nodes,
    );
    expect(issues.length).toBe(1);
    expect(issues[0]!.level).toBe('error');
    expect(issues[0]!.rule).toBe('refs.broken.anchor');
    expect(issues[0]!.message).toBe(
      'broken anchor: cans/artifacts/diagrams/t.txt#no-such-entry — no node matches',
    );
  });

  test('r9: a miss into an EMPTY .txt — the advisory, exact SEVEN-vocabulary bytes (unchanged by #72)', () => {
    // The #49 downgrade survives for truly contentless targets; #72 added
    // no vocabulary to an empty file, so the message bytes stay the #71
    // seven-vocabulary enumeration.
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
});

// ── D. End to end (checkCodebaseRefs over tmp workspaces) ────────────────────

describe('issue #72 engine — the codebase band end to end', () => {
  test('c1: the issue\'s repro — t.txt plus the two-pointer carrier, zero findings and zero warnings', async () => {
    // The minimal repro exactly as the issue writes it: both pointers in
    // one carrier source, the failing group anchor and the solo control.
    const { root } = makeProject('repro', {
      '00-overview.md': CORPUS[0]![1],
      'artifacts/diagrams/t.txt': T_TXT,
    }, {
      'src/lib.rs': [
        '// src/lib.rs',
        '//',
        '// see: cans/artifacts/diagrams/t.txt#FOO-BAR-BAZ',
        '// see: cans/artifacts/diagrams/t.txt#SOLO-ENTRY-HERE',
        '',
      ].join('\n'),
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings).toEqual([]); // the issue's 1 error, resolving
    expect(scan.warnings).toEqual([]);
    expect(scan.pointers).toBe(2);
  });

  test('c2: the typo carrier — one AnchorNotFound finding carrying the ENTRY did-you-mean', async () => {
    const { root } = makeProject('typo', {
      '00-overview.md': CORPUS[0]![1],
      'artifacts/diagrams/t.txt': T_TXT,
    }, {
      'src/lib.rs': '// see: cans/artifacts/diagrams/t.txt#FOO-BAR-BAZS\n',
    });
    const scan = await checkCodebaseRefs(root, cbCfg(), corpusOf(CORPUS));
    expect(scan.findings.length).toBe(1);
    const f = scan.findings[0]!;
    expect(f.reason).toBe('AnchorNotFound');
    expect(f.message).toBe(
      'broken codebase ref: src/lib.rs:1 — see: cans/artifacts/diagrams/t.txt#FOO-BAR-BAZS — broken anchor: cans/artifacts/diagrams/t.txt#FOO-BAR-BAZS — no node matches',
    );
    expect(f.suggestion).toBe(
      'did you mean cans/artifacts/diagrams/t.txt#FOO-BAR-BAZ? — fix the ref anchor',
    );
  });

  test('c3: the corpus refs engine inherits the rule — ONE shared verdict, a spec-side phrase pointer resolves', () => {
    // checkRefs' on-disk artifact path rides the same checkArtifactAnchor
    // (the #68–#71 architecture principle), so a corpus `see:` naming the
    // bracketed group of a shared line resolves there too — no
    // per-engine drift.
    const project = makeTmpDir('issue72-engine-corpus-seam');
    tmps.push(project);
    const root = makeCansWorkspace(project, {
      '00-overview.md': [
        '- Overview',
        '  - Diagram entry: see artifacts/diagrams/t.txt#FOO-BAR-BAZ',
        '',
      ].join('\n'),
      'artifacts/diagrams/t.txt': T_TXT,
    });
    const spec = {
      '00-overview.md': '- Overview\n  - Diagram entry: see artifacts/diagrams/t.txt#FOO-BAR-BAZ\n',
    };
    const files = new Map<string, OutlineNode[]>(
      Object.entries(spec).map(([name, body]) => [name, parseOutline(body, name)] as const),
    );
    const issues = checkRefs(files, buildRefGraph(files, root), root);
    expect(issues).toEqual([]); // resolves through the per-group entry, silently
  });
});
