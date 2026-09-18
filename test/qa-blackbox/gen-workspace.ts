/** QA-12 workspace generator (issue #41).
 *
 *  Deterministically builds a cans workspace at the issue's reported scale
 *  (~13 spec files, ~2300 nodes, depth 6) with every violation class from
 *  issue #41 planted by construction:
 *
 *    - 61 sibling-count-min violations   (2-child parents)
 *    - 2 depth-min violations            (02-agent, 08-recovery: depth 4)
 *    - 91 broken refs to 4 missing files (72/16/2/1) + 1 broken anchor
 *    - 1 orphan file                     (13-orphan.md)
 *    - 8 stale back-pointers             (ref-by comments in 04-budget.md)
 *    - 115 keyword-sprawl warnings       (top: yaml, artifacts:105, db:74,
 *                                         governance:72, api:66, execution:61, deny:60)
 *    - 75 overlap warnings               (22 exact-duplicate pairs, 53 fuzzy pairs)
 *
 *  Engine-semantics notes that keep the plantings CLEAN (each verified against
 *  src/core/redundancy.ts + outline.ts):
 *    - tokenize() splits on non-alphanumerics; stopwords are filtered; node
 *      text RETAINS `see:` targets, so `artifacts/governance.yaml` contributes
 *      the words artifacts/governance/yaml — the artifacts count (105) matches
 *      the issue exactly (91 ref lines + 14 planted).
 *    - the typo layer skips words <= 4 chars AND dedupes distinct words
 *      globally, so ALL generated tokens are <= 4 chars — typo warnings are
 *      structurally impossible here.
 *    - overlap = |A∩B| / max(|A|,|B|); every node's word set carries a bounded
 *      pool of co-host tokens (ref nodes: unique (p,p) pairs; keyword nodes:
 *      per-occurrence rotation), so unintended pairs stay at 50-60% (< 0.7
 *      threshold). Only the planted pairs cross it — 22 at 100%, 53 at 75%.
 *    - every node set has ≤ 10 children (siblings max 12), exactly 61 parents
 *      have 2 (siblings min 3), and single_child_collapse is off.
 *
 *  Variants: 'issue' (everything above), 'warnings-only' (refs point at real
 *  spec files — no error-class findings, all warnings → exit 1), 'clean'
 *  (tiny valid workspace, relaxed rules → exit 0).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface GenStats {
  files: number;
  nodes: number;
  planted: Record<string, number>;
}

/** 107 three-char minor keywords (consonant-initial, typo-layer-immune). */
export const MINOR_KEYWORDS: string[] = (() => {
  const C = 'bcdfghjklmnprstvwz'.split('');
  const V = 'aeiou'.split('');
  const E = 'xqzk'.split('');
  const out: string[] = [];
  for (const e of E) {
    for (const v of V) {
      for (const c of C) {
        if (out.length < 107) out.push(`${c}${v}${e}`);
      }
    }
  }
  return out;
})();

const MISSING_TARGETS: Array<[string, number]> = [
  ['artifacts/governance.yaml', 72],
  ['artifacts/policy.yaml', 16],
  ['artifacts/system-schema.yaml', 2],
  ['artifacts/schema.yaml', 1],
];

const STOPWORD_TAIL = 'of the and to in';
const REF_BUDGET_FILE = '04-budget.md';
const ANCHOR_TARGET = '06-interface.md#Refusals';
const STALE_REFERRERS = [
  '01-charter.md', '02-agent.md', '03-assembly.md', '05-effect.md',
  '06-interface.md', '10-time.md', '11-trust.md', '12-world.md',
];
const FILE_NAMES = ['charter', 'agent', 'assembly', 'budget', 'effect', 'interface', 'physics', 'recovery', 'space', 'time', 'trust', 'world'];

const RULES_ISSUE = `structure:
  node_length: { min: 3, max: 120 }
  siblings: { min: 3, max: 12 }
  depth: { min: 5, max: 7 }
  single_child_collapse: false
  empty_nodes: false

style:
  prefer: sibling
  force_nested_above: null
  force_sibling_below: null
  shared_prefix_detection: false

content:
  tbd_allowed: true
  max_tbd_per_file: 5

references:
  mode: pointer
  back_pointers: true
  max_hops: 3
  orphan_check: true
  duplicate_home_check: true

redundancy:
  enabled: true
  word_frequency_threshold: 12
  phrase_overlap_threshold: 0.7
  cross_file_threshold: 2
  stopwords: [the, a, an, of, to, in, for, and, or, with, must, shall, requires]
  synonyms: []

token_budget:
  enabled: true
  default_limit: 4096
  estimate_chars_per_token: 3.5
  warn_threshold: 0.8

overflow:
  max_node_chars: 200
  force_file_for: []
`;

const RULES_CLEAN = `structure:
  node_length: { min: 3, max: 120 }
  siblings: { min: 1, max: 12 }
  depth: { min: 1, max: 7 }
  single_child_collapse: false
  empty_nodes: false

style:
  prefer: sibling
  force_nested_above: null
  force_sibling_below: null
  shared_prefix_detection: false

content:
  tbd_allowed: true
  max_tbd_per_file: 5

references:
  mode: pointer
  back_pointers: true
  max_hops: 3
  orphan_check: true
  duplicate_home_check: true

redundancy:
  enabled: false
  word_frequency_threshold: null
  phrase_overlap_threshold: null
  cross_file_threshold: null
  stopwords: [the, a, an, of, to, in, for, and, or, with, must, shall, requires]
  synonyms: []

token_budget:
  enabled: true
  default_limit: 4096
  estimate_chars_per_token: 3.5
  warn_threshold: 0.8

overflow:
  max_node_chars: 200
  force_file_for: []
`;

const AGENTS_MD = `# AGENTS

- The outline is the spec, the state, and the task board.
- Run \`cans check\` after every edit.
`;

/** The leaf content, dealt round-robin across the 12 regular files. */
function buildLeafContent(variant: 'issue' | 'warnings-only'): string[] {
  const leaves: string[] = [];
  let kIdx2 = 0;
  const ktok = (): string => `k${(kIdx2++).toString(36).padStart(3, '0')}`;

  // 1. Ref lines — broken (issue variant) or valid (warnings-only). 92 nodes.
  //    Co-hosts: TWO GLOBALLY UNIQUE <= 4-char tokens per node (r-scheme) —
  //    shared co-hosts would push cross-node word-set overlap to 80% and
  //    manufacture phantom fuzzy overlaps.
  if (variant === 'issue') {
    for (const [target, count] of MISSING_TARGETS) {
      for (let i = 0; i < count; i++) {
        const n = leaves.length;
        leaves.push(`see: ${target} ${rtok(n)} ${rtok(n + 500)} ${STOPWORD_TAIL}`);
      }
    }
    leaves.push(`see: ${ANCHOR_TARGET} ${rtok(92)} ${rtok(92 + 500)} ${STOPWORD_TAIL}`);
  } else {
    // Valid star refs into 02-agent (no cycles → no deep hops, no self-refs).
    // Leaves landing in 02-agent itself (n % 12 === 1) become keyword nodes —
    // a self-ref is an ERROR, and 02 must stay ref-free to keep the star flat.
    for (let i = 0; i < 92; i++) {
      const n = leaves.length;
      if (n % 12 === 1) {
        leaves.push(`${MINOR_KEYWORDS[106]} ${ktok()} ${STOPWORD_TAIL}`);
      } else {
        leaves.push(`see: 02-agent.md ${rtok(n)} ${rtok(n + 500)} ${STOPWORD_TAIL}`);
      }
    }
  }

  // 2. Exact-duplicate pairs (22 × 100% overlap) — 3-char pair tokens.
  for (let p = 0; p < 22; p++) {
    const t = pairTokens(p, 3);
    const text = `${t.join(' ')} ${STOPWORD_TAIL}`;
    leaves.push(text, text);
  }

  // 3. Fuzzy pairs (53 × 75% overlap: 3 shared + 1 extra word).
  for (let p = 0; p < 53; p++) {
    const t = pairTokens(22 + p, 4);
    leaves.push(`${t.slice(0, 3).join(' ')} ${STOPWORD_TAIL}`);
    leaves.push(`${t.join(' ')} ${STOPWORD_TAIL}`);
  }

  // 4. Dominant keywords (artifacts: 14 planted — 91 more ride the ref lines).
  //    Co-hosts: GLOBALLY UNIQUE k-scheme tokens (4 chars, typo-immune) — a
  //    reused rotation would itself cross the keyword threshold and pollute
  //    the planted keyword set.
  for (let i = 0; i < 14; i++) leaves.push(`artifacts ${ktok()} ${STOPWORD_TAIL}`);
  for (const [kw, count] of [['db', 74], ['api', 66], ['execution', 61], ['deny', 60]] as Array<[string, number]>) {
    for (let i = 0; i < count; i++) leaves.push(`${kw} ${ktok()} ${STOPWORD_TAIL}`);
  }

  // 5. Minor keywords: 83 × 13 + 24 × 12 = 1367 nodes — content total is
  // 1884, EXACTLY the tree's leaf capacity (12 files × 157), so nothing is
  // dropped or padded.
  MINOR_KEYWORDS.forEach((kw, kwIdx) => {
    const occurrences = kwIdx < 83 ? 13 : 12;
    for (let i = 0; i < occurrences; i++) leaves.push(`${kw} ${ktok()} ${STOPWORD_TAIL}`);
  });
  return leaves;
}

/** Pair vocabulary: 75 pairs need distinct 3-char token families (all ≤ 4
 *  chars → the typo layer skips them regardless of pairwise distance). */
function pairTokens(p: number, n: number): string[] {
  const L = 'abcdefghijklmnopqrstuvwxyz';
  const a = L[p % 13]!;
  const b = L[Math.floor(p / 13) % 6]!;
  const roles = 'abcde'.split('');
  return roles.slice(0, n).map(r => `${a}${b}${r}`);
}

/** Globally unique <= 4-char ref co-host: `r` + base36 index (2 chars). */
function rtok(n: number): string {
  return `r${n.toString(36).padStart(2, '0')}`;
}

const PAD_TOKENS = ['vo0', 'vo1', 'vo2', 'vo3', 'vo4', 'vo5', 'vo6', 'vo7'];

/**
 * One regular file:
 *   L1 root
 *     L2 section ×6            (children ≤ 10 — never siblings.max)
 *       L3 chain a..d          (depth 6; depth-min files stop at b → depth 4)
 *       L3 2-child parent      (sections 1-5 only → the sibling-min class)
 *       L3 sub-parent ×8-9     (exactly 3 children each — legal)
 * Total leaf capacity: 5×(2+8×3) + 9×3 = 157 per file.
 */
function regularFileBody(fIdx: number, depthMin: boolean, leaves: string[], leafCursor: number, capacity: number): { lines: string[]; nodes: number; used: number } {
  const f = 'abcdefghijkl'[fIdx]!;
  const lines: string[] = [];
  let nodes = 0;
  let used = 0;
  const takeLeaf = (): string => {
    const t = leaves[leafCursor + used] ?? `see: ${FILE_NAMES[2]}.md p99 p98 ${STOPWORD_TAIL}`;
    used++;
    return t;
  };

  lines.push(`- x${f}r ${STOPWORD_TAIL}`);
  nodes++;
  const chainLen = depthMin ? 2 : 4;
  for (let s = 1; s <= 6; s++) {
    lines.push(`  - x${f}s${s} ${STOPWORD_TAIL}`);
    nodes++;
    for (let c = 0; c < chainLen; c++) {
      // indent 4,6,8,10 → outline levels 3..6 (depth 6 max, §35 1-based).
      lines.push(`${'  '.repeat(2 + c)}- x${f}${s}${'abcd'[c]} ${STOPWORD_TAIL}`);
      nodes++;
    }
    const hasParent = s <= 5;
    const subParents = hasParent ? 8 : 9;
    if (hasParent) {
      // issue #41: parent with exactly 2 children → sibling-min violation.
      lines.push(`    - x${f}p${s} ${STOPWORD_TAIL}`);
      nodes++;
      for (let k = 0; k < 2; k++) {
        lines.push(`      - ${takeLeaf()}`);
        nodes++;
      }
    }
    for (let j = 0; j < subParents; j++) {
      lines.push(`    - x${f}${s}${j} ${STOPWORD_TAIL}`);
      nodes++;
      for (let k = 0; k < 3; k++) {
        lines.push(`      - ${takeLeaf()}`);
        nodes++;
      }
    }
  }
  void capacity;
  return { lines, nodes, used };
}
function orphanFileBody(): { lines: string[]; nodes: number } {
  const lines: string[] = ['- xmr0 ' + STOPWORD_TAIL];
  let nodes = 1;
  for (let s = 1; s <= 4; s++) {
    lines.push(`  - xms${s} ${STOPWORD_TAIL}`);
    nodes++;
    for (let c = 0; c < 4; c++) {
      // 4-char tokens only (5-char forms would typo-pair; see header note).
      lines.push(`${'  '.repeat(2 + c)}- xm${s}${'abcd'[c]} ${STOPWORD_TAIL}`);
      nodes++;
    }
  }
  // One 2-child parent (the 61st) + pad leaves — no refs in or out. The two
  // pad sub-parents sit at L2 (indent 2) so xmp1 keeps EXACTLY 2 children.
  lines.push(`  - xmp1 ${STOPWORD_TAIL}`);
  nodes++;
  for (let k = 0; k < 2; k++) {
    lines.push(`    - ${PAD_TOKENS[k]} ${STOPWORD_TAIL}`);
    nodes++;
  }
  for (let j = 0; j < 2; j++) {
    lines.push(`  - xm9${j} ${STOPWORD_TAIL}`);
    nodes++;
    for (let k = 0; k < 3; k++) {
      lines.push(`    - ${PAD_TOKENS[2 + j * 3 + k]} ${STOPWORD_TAIL}`);
      nodes++;
    }
  }
  return { lines, nodes };
}

/** Build the workspace into `root` (a directory that will contain cans/). */
export function generateWorkspace(root: string, variant: 'issue' | 'warnings-only' | 'clean' = 'issue'): GenStats {
  const cans = join(root, 'cans');
  mkdirSync(cans, { recursive: true });
  writeFileSync(join(cans, 'AGENTS.md'), AGENTS_MD);
  writeFileSync(join(cans, '_rules.yaml'), variant === 'clean' ? RULES_CLEAN : RULES_ISSUE);

  if (variant === 'clean') {
    // 3 tiny files, valid refs from 01 and 03 into 02, redundancy engines off.
    const files: Record<string, string> = {
      '01-overview.md': '- Overview of the spec\n  - Session handling in cans\n    - see: 02-auth.md\n  - Storage layout for nodes\n',
      '02-auth.md': '- Authentication flows here\n  - Login and token refresh\n  - Session expiry rules\n',
      '03-data.md': '- Data model for the workspace\n  - Node storage and archives\n    - see: 02-auth.md\n',
    };
    for (const [name, body] of Object.entries(files)) writeFileSync(join(cans, name), body);
    return { files: 3, nodes: 9, planted: {} };
  }

  const leaves = buildLeafContent(variant);
  const perFile = 157; // must equal buildLeafContent total / 12 (1892-8 = 1884)
  let totalNodes = 0;

  // 12 regular files; 02-agent + 08-recovery are the depth-min files (issue:
  // `2× depth <min (4/5) — agent:1 recovery:1`). Leaves are dealt ROUND-ROBIN
  // (file f gets leaves f, 12+f, 24+f, …) so ref nodes reach every file —
  // contiguous slices orphaned all but the first two files.
  for (let i = 0; i < 12; i++) {
    const name = `${String(i + 1).padStart(2, '0')}-${FILE_NAMES[i]}.md`;
    const slice: string[] = [];
    for (let s = 0; s < perFile; s++) {
      const idx = s * 12 + i;
      slice.push(leaves[idx] ?? `${PAD_TOKENS[s % PAD_TOKENS.length]} ${STOPWORD_TAIL}`);
    }
    const { lines, nodes } = regularFileBody(i, i === 1 || i === 7, slice, 0, perFile);
    let body = `${lines.join('\n')}\n`;
    // Stale back-pointers ride 04-budget.md (issue: `8× stale back-ptr`).
    if (name === REF_BUDGET_FILE) {
      const comments = STALE_REFERRERS.map((r) => `<!-- ref-by: ${r} -->`).join('\n');
      body = `${lines[0]}\n${comments}\n${lines.slice(1).join('\n')}\n`;
    }
    writeFileSync(join(cans, name), body);
    totalNodes += nodes;
  }

  // 13-orphan.md — no refs in or out (issue: `1× orphan`).
  const orphan = orphanFileBody();
  writeFileSync(join(cans, '13-orphan.md'), `${orphan.lines.join('\n')}\n`);
  totalNodes += orphan.nodes;

  return {
    files: 13,
    nodes: totalNodes,
    planted: {
      siblingMin: 61,
      depthMin: 2,
      brokenFileRefs: variant === 'issue' ? 91 : 0,
      brokenAnchor: variant === 'issue' ? 1 : 0,
      orphans: 1,
      staleBackPointers: 8,
      keywordWarnings: 115,
      overlapExact: 22,
      overlapFuzzy: 53,
    },
  };
}
