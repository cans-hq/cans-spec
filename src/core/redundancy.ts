import type { OutlineNode, Issue, RedundancyRules } from '../types';
import { flattenNodes } from './outline';

interface NodeRef {
  text: string;
  file: string;
  line: number;
}

const EDGE_PUNCT_RE = /^[.,;:!?"']+|[.,;:!?"']+$/g;

/** lowercase → strip edge punctuation → synonym group (any member → first member) → bare word. */
export function normalizeWord(word: string, synonyms: string[][]): string {
  const stripped = word.toLowerCase().replace(EDGE_PUNCT_RE, '');
  for (const group of synonyms) {
    if (group.includes(stripped)) return group[0];
  }
  return stripped;
}

function tokenize(text: string): string[] {
  return text.split(/[^A-Za-z0-9]+/).filter(w => w.length > 0);
}

/** Normalized word set of a text; stopwords filtered when rules are given. */
function wordSet(text: string, rules?: RedundancyRules): Set<string> {
  const out = new Set<string>();
  const synonyms = rules ? rules.synonyms : [];
  const stopwords = rules ? rules.stopwords : null;
  for (const raw of tokenize(text)) {
    const w = normalizeWord(raw, synonyms);
    if (w.length === 0) continue;
    if (stopwords !== null && stopwords.includes(w)) continue;
    out.add(w);
  }
  return out;
}

/** Levenshtein edit distance (two-row DP). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  return prev[n];
}

/** Layer 1 — words appearing in >= threshold nodes (node count, not occurrences). */
export function wordFrequency(
  nodes: NodeRef[],
  rules: RedundancyRules,
): Issue[] {
  const counts = new Map<string, number>();
  const firstLoc = new Map<string, NodeRef>();
  for (const node of nodes) {
    const seen = new Set<string>();
    for (const w of wordSet(node.text, rules)) {
      if (seen.has(w)) continue;
      seen.add(w);
      counts.set(w, (counts.get(w) ?? 0) + 1);
      if (!firstLoc.has(w)) firstLoc.set(w, node);
    }
  }
  const flagged = [...counts.entries()].filter(([, n]) => n >= rules.word_frequency_threshold);
  flagged.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const issues: Issue[] = [];
  for (const [word, n] of flagged) {
    const loc = firstLoc.get(word)!;
    issues.push({
      file: loc.file, line: loc.line, level: 'warning', category: 'redundancy',
      message: `"${word}" × ${n} nodes (threshold: ${rules.word_frequency_threshold})`,
      suggestion: `pick one canonical home for "${word}" and see: it from the others`,
    });
  }
  return issues;
}

/** Layer 2 — pairwise word-set overlap of normalized word sets >= threshold.
 *  §13: "Normalized word set overlap ≥ 70% → flag." Overlap is measured
 *  against the LARGER of the two sets (|A∩B| / max(|A|,|B|)), after stopword
 *  and synonym normalization. */
export function phraseOverlap(
  nodes: NodeRef[],
  threshold: number,
  rules?: RedundancyRules,
): Issue[] {
  const sets = nodes.map(n => ({ node: n, words: wordSet(n.text, rules) }));
  const issues: Issue[] = [];
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const a = sets[i];
      const b = sets[j];
      if (a.node.file === b.node.file && a.node.line === b.node.line) continue;
      if (a.words.size === 0 || b.words.size === 0) continue;
      let inter = 0;
      for (const w of a.words) if (b.words.has(w)) inter++;
      const larger = Math.max(a.words.size, b.words.size);
      const similarity = larger === 0 ? 0 : inter / larger;
      if (similarity >= threshold) {
        const pct = Math.round(similarity * 100);
        issues.push({
          file: a.node.file, line: a.node.line, level: 'warning', category: 'redundancy',
          message: `${pct}% overlap: ${a.node.file}:${a.node.line} ↔ ${b.node.file}:${b.node.line}`,
          suggestion: 'merge the duplicated bullets or see: the canonical one',
        });
      }
    }
  }
  return issues;
}

/** Layer 3 — near-miss word forms (Levenshtein <= 2, both words > 4 chars) → possible typo.
 *  §13: "NOT ALREADY SYNONYM-MATCHED" — words are normalized with the rules'
 *  synonym groups first, so members of the same group collapse to one word and
 *  never pair up as typos. */
export function fuzzyDistance(
  nodes: NodeRef[],
  rules?: RedundancyRules,
): Issue[] {
  const synonyms = rules ? rules.synonyms : [];
  const words: NodeRef[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    for (const raw of tokenize(node.text)) {
      const w = normalizeWord(raw, synonyms);
      if (w.length === 0 || seen.has(w)) continue;
      seen.add(w);
      words.push({ text: w, file: node.file, line: node.line });
    }
  }
  const issues: Issue[] = [];
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j < words.length; j++) {
      const a = words[i];
      const b = words[j];
      if (a.text.length <= 4 || b.text.length <= 4) continue;
      if (Math.abs(a.text.length - b.text.length) > 2) continue;
      const d = levenshtein(a.text, b.text);
      if (d <= 2) {
        issues.push({
          file: a.file, line: a.line, level: 'warning', category: 'redundancy',
          message: `possible typo: "${a.text}" (${a.file}:${a.line}) ↔ "${b.text}" (${b.file}:${b.line}) — Levenshtein ${d}`,
          suggestion: 'unify the spelling or map the variant as a synonym',
        });
      }
    }
  }
  return issues;
}

/** Candidate ref-name spellings for a workspace key (flat and folder layouts). */
function refNamesForKey(key: string): string[] {
  const names = new Set<string>([key]);
  if (key.endsWith('.md')) names.add(key.slice(0, -3));
  if (key.endsWith('/index.md')) {
    const base = key.slice(0, -9);
    names.add(base);
    names.add(`${base}.md`);
  }
  return [...names];
}

function filesConnected(
  allFiles: Map<string, OutlineNode[]>,
  a: string,
  b: string,
): boolean {
  const aNodes = flattenNodes(allFiles.get(a) ?? []);
  const bNodes = flattenNodes(allFiles.get(b) ?? []);
  const bNames = new Set(refNamesForKey(b));
  const aNames = new Set(refNamesForKey(a));
  const refsTo = (ns: OutlineNode[], names: Set<string>): boolean =>
    ns.some(n => n.refs.some(r => names.has(r.file)));
  return refsTo(aNodes, bNames) || refsTo(bNodes, aNames);
}

/** Layer 4 — identical node text at depth 0-1 in >= threshold files without see: linkage. */
export function crossFileCanonicality(
  allFiles: Map<string, OutlineNode[]>,
  threshold: number,
): Issue[] {
  const concepts = new Map<string, { files: Set<string>; first: NodeRef }>();
  for (const [key, nodes] of allFiles) {
    for (const node of flattenNodes(nodes)) {
      if (node.indent > 1) continue;
      const text = node.text.trim().toLowerCase();
      if (text.length === 0) continue;
      let entry = concepts.get(text);
      if (entry === undefined) {
        entry = { files: new Set<string>(), first: { text, file: key, line: node.line } };
        concepts.set(text, entry);
      }
      entry.files.add(key);
    }
  }
  const issues: Issue[] = [];
  for (const [concept, entry] of concepts) {
    if (entry.files.size < threshold) continue;
    const files = [...entry.files].sort();
    let connected = false;
    for (let i = 0; i < files.length && !connected; i++) {
      for (let j = i + 1; j < files.length && !connected; j++) {
        if (filesConnected(allFiles, files[i], files[j])) connected = true;
      }
    }
    if (connected) continue;
    issues.push({
      file: entry.first.file, line: entry.first.line, level: 'warning', category: 'redundancy',
      message: `"${concept}" at depth 0-1 in ${files.length}+ files without see: (${files.join(', ')})`,
      suggestion: `keep "${concept}" in one canonical file and see: it from the others`,
    });
  }
  return issues;
}

/** All four redundancy layers over every loaded spec node.
 *  `duplicateHomeCheck` (§18 references.duplicate_home_check) gates layer 4. */
export function checkRedundancy(
  allFiles: Map<string, OutlineNode[]>,
  rules: RedundancyRules,
  duplicateHomeCheck = true,
): Issue[] {
  const nodes: NodeRef[] = [];
  for (const [file, tree] of allFiles) {
    for (const node of flattenNodes(tree)) {
      nodes.push({ text: node.text, file, line: node.line });
    }
  }
  return [
    ...wordFrequency(nodes, rules),
    ...phraseOverlap(nodes, rules.phrase_overlap_threshold, rules),
    ...fuzzyDistance(nodes, rules),
    ...(duplicateHomeCheck ? crossFileCanonicality(allFiles, rules.cross_file_threshold) : []),
  ];
}
