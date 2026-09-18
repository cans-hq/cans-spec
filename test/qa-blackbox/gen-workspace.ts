/** QA-12 workspace generator (issue #41).
 *
 *  Deterministically builds a cans workspace planting EVERY violation class
 *  from issue #41 (the report contract under test is scale-independent):
 *
 *    - 20 sibling-count-min violations   (2-child parents, min 3)
 *    - 2 depth-min files                 (02-agent, 08-recovery: depth 4)
 *    - 83 broken refs to 4 missing files (67/13/2/1) + 1 broken anchor
 *    - 1 orphan file                     (13-orphan.md)
 *    - 8 stale back-pointers             (ref-by comments in 04-budget.md)
 *    - 12 keyword-sprawl warnings        (8 planted minors at threshold 12,
 *                                         plus artifacts/yaml/governance/policy
 *                                         riding the ref lines)
 *    - 15 overlap warnings               (5 exact-duplicate pairs, 10 fuzzy pairs)
 *    - 0 typo warnings                   (all generated tokens ≤ 4 chars — the
 *                                         typo layer skips words ≤ 4 chars)
 *
 *  Tree shape (both variants): root → 3 sections → 3 subs → 3 parents → 3
 *  leaves. Every parent has exactly 3 children except the marked 2-child
 *  parents (siblings.min 3 ✓, max 12 ✓). Depth 5 (regular) / 4 (depth-min).
 *  Overlap math: |A∩B| / max(|A|,|B|) — every leaf carries a globally unique
 *  co-host token, so unintended pairs stay at 50-60% (< 0.7 threshold).
 *
 *  Variants: 'issue' (everything above), 'warnings-only' (broken refs become
 *  valid star refs into 02-agent — 0 errors, all warnings → exit 1), 'clean'
 *  (tiny valid workspace, relaxed rules → exit 0).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface GenStats {
  files: number;
  nodes: number;
  planted: Record<string, number>;
}

/** 8 three-char minor keywords (consonant-initial, typo-layer-immune). */
export const MINOR_KEYWORDS: string[] = ['bax', 'cex', 'diq', 'foz', 'kuq', 'lyk', 'muq', 'neq'];

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

/** Globally unique ref co-hosts: `r` + base36 index (<= 4 chars). */
function rtok(n: number): string {
  return `r${n.toString(36).padStart(2, '0')}`;
}

/** Pair vocabulary: distinct 3-char token families (<= 4 chars → typo-immune). */
function pairTokens(p: number, n: number): string[] {
  const L = 'abcdefghijklmnopqrstuvwxyz';
  const a = L[p % 13]!;
  const b = L[Math.floor(p / 13) % 6]!;
  return 'abcde'.split('').slice(0, n).map(r => `${a}${b}${r}`);
}

let kCounter = 0;
function ktok(): string {
  return `k${(kCounter++).toString(36).padStart(3, '0')}`;
}
let padCounter = 0;
function ptok(): string {
  return `p${(padCounter++).toString(36).padStart(3, '0')}`;
}

/** The leaf content as 12 per-file buckets (one per regular file): class
 *  arrays cycled per bucket, so every file carries a mix of every planted
 *  class (a class-ordered queue clustered all refs into the first files and
 *  orphaned the rest). */ 
function buildLeafBuckets(variant: 'issue' | 'warnings-only'): string[][] {
  const leaves: string[] = [];
  const refsArr: string[] = [];
  const dupsArr: string[] = [];
  const kwArr: string[] = [];

  // 1. Refs — broken (issue) or valid star refs (warnings-only).
  if (variant === 'issue') {
    for (const [target, count] of MISSING_TARGETS) {
      for (let i = 0; i < count; i++) {
        const n = refsArr.length;
        refsArr.push(`see: ${target} ${rtok(n)} ${rtok(n + 500)} ${STOPWORD_TAIL}`);
      }
    }
    refsArr.push(`see: ${ANCHOR_TARGET} ${rtok(92)} ${rtok(92 + 500)} ${STOPWORD_TAIL}`);
  } else {
    for (let i = 0; i < 92; i++) {
      const n = refsArr.length;
      if (n % 12 === 1) {
        refsArr.push(`${MINOR_KEYWORDS[0]} ${ktok()} ${STOPWORD_TAIL}`); // no self-ref
      } else {
        refsArr.push(`see: 02-agent.md ${rtok(n)} ${rtok(n + 500)} ${STOPWORD_TAIL}`);
      }
    }
  }

  // 2. Overlap pairs — 5 exact (100%) + 10 fuzzy (75%).
  for (let p = 0; p < 5; p++) {
    const t = pairTokens(p, 3);
    dupsArr.push(`${t.join(' ')} ${STOPWORD_TAIL}`, `${t.join(' ')} ${STOPWORD_TAIL}`);
  }
  for (let p = 0; p < 10; p++) {
    const t = pairTokens(5 + p, 4);
    dupsArr.push(`${t.slice(0, 3).join(' ')} ${STOPWORD_TAIL}`, `${t.join(' ')} ${STOPWORD_TAIL}`);
  }

  // 3. Keywords — 8 minors × 16 nodes (threshold 12; the 4-node headroom
  // absorbs the depth-min files' smaller leaf capacity).
    // artifacts/yaml/governance/policy ride the ref lines.
  for (const kw of MINOR_KEYWORDS) {
    for (let i = 0; i < 16; i++) kwArr.push(`${kw} ${ktok()} ${STOPWORD_TAIL}`);
  }

  // Cycle the class arrays per bucket — every file receives refs AND dups
  // AND keywords.
  const arrays = [refsArr, dupsArr, kwArr];
  const idx = [0, 0, 0];
  const buckets: string[][] = Array.from({ length: 12 }, () => []);
  let done = false;
  while (!done) {
    done = true;
    for (let f = 0; f < 12; f++) {
      for (let i = 0; i < arrays.length; i++) {
        if (idx[i]! < arrays[i].length) {
          buckets[f].push(arrays[i][idx[i]!]);
          idx[i]++;
          done = false;
        }
      }
    }
  }
  return buckets;
}

/**
 * One regular file — root → 3 sections → 3 subs → 3 parents → 3 leaves (L5).
 * Every parent has exactly 3 children except the section's FIRST parent on
 * the first sub, which keeps 2 → the planted sibling-min violations (2 per
 * file; 20 regular; depth 5; depth-min files stop at L4 → depth 4).
 * Leaf capacity: 79 per regular file (81 − 2), 9 per depth-min file.
 */
function regularFileBody(fIdx: number, depthMin: boolean, leaves: string[], leafCursor: number): { lines: string[]; nodes: number; used: number } {
  const f = 'abcdefghijkl'[fIdx]!;
  const lines: string[] = [];
  let nodes = 0;
  let used = 0;
  const takeLeaf = (level: number): void => {
    const t = leaves[leafCursor + used] ?? `${ptok()} ${STOPWORD_TAIL}`;
    used++;
    lines.push(`${'  '.repeat(level - 1)}- ${t}`);
    nodes++;
  };

  lines.push(`- x${f}r ${STOPWORD_TAIL}`);
  nodes++;
  for (let s = 1; s <= 3; s++) {
    lines.push(`  - x${f}s${s} ${STOPWORD_TAIL}`);
    nodes++;
    for (let j = 0; j < 3; j++) {
      lines.push(`    - x${f}${s}${j} ${STOPWORD_TAIL}`);
      nodes++;
      if (depthMin) {
        // Depth-min file: content leaves at L4 (depth 4 < min 5).
        for (let c = 0; c < 3; c++) takeLeaf(4);
        continue;
      }
      for (let p = 0; p < 3; p++) {
        lines.push(`      - x${f}${s}${j}${p} ${STOPWORD_TAIL}`);
        nodes++;
        // The section's first sub's first parent keeps 2 children.
        const twoChild = j === 0 && p === 0 && s <= 2;
        for (let c = 0; c < (twoChild ? 2 : 3); c++) {
          takeLeaf(5);
        }
      }
    }
  }
  return { lines, nodes, used };
}

function orphanFileBody(): { lines: string[]; nodes: number } {
  const lines: string[] = [];
  let nodes = 0;
  lines.push(`- xmr0 ${STOPWORD_TAIL}`);
  nodes++;
  for (let s = 1; s <= 3; s++) {
    lines.push(`  - xms${s} ${STOPWORD_TAIL}`);
    nodes++;
    for (let j = 0; j < 3; j++) {
      lines.push(`    - xms${s}${j} ${STOPWORD_TAIL}`);
      nodes++;
      for (let p = 0; p < 3; p++) {
        lines.push(`      - xms${s}${j}${p} ${STOPWORD_TAIL}`);
        nodes++;
        for (let c = 0; c < 3; c++) {
          lines.push(`        - ${ptok()} ${STOPWORD_TAIL}`);
          nodes++;
        }
      }
    }
  }
  return { lines, nodes };
}

/** Build the workspace into `root` (a directory that will contain cans/). */
export function generateWorkspace(root: string, variant: 'issue' | 'warnings-only' | 'clean' = 'issue'): GenStats {
  kCounter = 0;
  padCounter = 0;
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

  const buckets = buildLeafBuckets(variant);
  let totalNodes = 0;

  // 12 regular files; 02-agent + 08-recovery are the depth-min files.
  for (let i = 0; i < 12; i++) {
    const name = `${String(i + 1).padStart(2, '0')}-${FILE_NAMES[i]}.md`;
    // Depth-min files hold fewer leaves (shallower tree); pads fill slack.
    const cap = i === 1 || i === 7 ? 9 : 79;
    const bucket = buckets[i].slice(0, cap);
    const { lines, nodes } = regularFileBody(i, i === 1 || i === 7, bucket, 0);
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
      siblingMin: 20,
      depthMin: 2,
      brokenFileRefs: variant === 'issue' ? 91 : 0,
      brokenAnchor: variant === 'issue' ? 1 : 0,
      orphans: 1,
      staleBackPointers: 8,
      keywordWarnings: 12,
      overlapExact: 5,
      overlapFuzzy: 10,
    },
  };
}
