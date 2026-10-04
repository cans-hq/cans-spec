import type { OutlineNode, Issue, RedundancyRules } from '../types.ts';
import { flattenNodes, isSyntheticNode } from './outline.ts';

interface NodeRef {
  text: string;
  file: string;
  line: number;
}

const EDGE_PUNCT_RE = /^[.,;:!?"']+|[.,;:!?"']+$/g;

/** §8/§13: ref syntax tokens (`see:`, `.md`) are structural pointers, not
 *  content words — excluded from every redundancy layer (QA-02 F3). */
const REF_SYNTAX_TOKENS = new Set(['see', 'md']);

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
    if (REF_SYNTAX_TOKENS.has(w)) continue;
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

/** Layer 1 — words appearing in >= threshold nodes (node count, not occurrences).
 *  §18 delete-key semantics: `word_frequency_threshold` null (deleted) → the
 *  layer is OFF — skipped entirely, never compared against null. */
export function wordFrequency(
  nodes: NodeRef[],
  rules: RedundancyRules,
): Issue[] {
  const threshold = rules.word_frequency_threshold;
  if (threshold === null) return [];
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
  const flagged = [...counts.entries()].filter(([, n]) => n >= threshold);
  flagged.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const issues: Issue[] = [];
  for (const [word, n] of flagged) {
    const loc = firstLoc.get(word)!;
    issues.push({
      file: loc.file, line: loc.line, level: 'warning', category: 'redundancy',
      message: `"${word}" × ${n} nodes (threshold: ${threshold})`,
      suggestion: `pick one canonical home for "${word}" and see: it from the others`,
      rule: 'redundancy.keyword', // issue #41: machine-readable rule key
    });
  }
  return issues;
}

/** Layer 2 — pairwise word-set overlap of normalized word sets >= threshold.
 *  §13: "Normalized word set overlap ≥ 70% → flag." Overlap is measured
 *  against the LARGER of the two sets (|A∩B| / max(|A|,|B|)), after stopword
 *  and synonym normalization. §18: threshold null (deleted key) → layer OFF. */
export function phraseOverlap(
  nodes: NodeRef[],
  threshold: number | null,
  rules?: RedundancyRules,
): Issue[] {
  if (threshold === null) return [];
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
          // issue #41: 100% overlap is an exact duplicate; below that is fuzzy.
          rule: pct >= 100 ? 'redundancy.overlap.exact' : 'redundancy.overlap.fuzzy',
        });
      }
    }
  }
  return issues;
}

/** Light English suffixes for the inflection check (issue #3), longest first —
 *  stripped iteratively from the end so "carries" → "carri" (→ i↔y → "carry"). */
const INFLECTION_SUFFIXES = ['ing', 'ers', 'er', 'ed', 'es', 'ly', 's'];

/** Reduce a word to a rough stem by iteratively stripping common English
 *  suffixes, then a trailing `e`, folding a trailing `i` onto `y` (so
 *  deny/denied → deny, approve/approved → approv). Deliberately NOT a real
 *  stemmer — only good enough to recognize pure suffix inflections. */
function lightStem(word: string): string {
  let w = word;
  for (;;) {
    const suffix = INFLECTION_SUFFIXES.find(s => w.length > s.length && w.endsWith(s));
    if (suffix === undefined) break;
    w = w.slice(0, w.length - suffix.length);
  }
  if (w.endsWith('i')) w = `${w.slice(0, -1)}y`;
  if (w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

/** Issue #3: is `a` a pure suffix-inflection of `b` (or vice versa)? Both words
 *  are reduced with lightStem; equal stems — or a stem equal to the other word's
 *  unstemmed form — mean the pair differs only by an English inflection
 *  (approve/approved, session/sessions, deny/denied), not by a typo. Stems
 *  shorter than 3 chars are treated as unsafe and the pair is NOT skipped
 *  (e.g. sing/singe stays a typo candidate). Genuine near-misses with no suffix
 *  relation (flavour/flavor, table/tabble) keep different stems → still flagged. */
export function isInflectionOf(a: string, b: string): boolean {
  const sa = lightStem(a);
  const sb = lightStem(b);
  if (sa.length < 3 || sb.length < 3) return false;
  return sa === sb || sa === b || sb === a;
}

/** Layer 3 — near-miss word forms (Levenshtein <= 2, both words > 4 chars) → possible typo.
 *  §13: "NOT ALREADY SYNONYM-MATCHED" — words are normalized with the rules'
 *  synonym groups first, so members of the same group collapse to one word and
 *  never pair up as typos. Issue #3: the layer now applies the SAME collection
 *  filter as the other layers — the configured `redundancy.stopwords` and the
 *  §8/§13 ref-syntax tokens (`see`, `md`) are never collected — and skips
 *  candidate pairs that are pure suffix inflections of each other
 *  (isInflectionOf) before the Levenshtein comparison, so English inflections
 *  (approved/approve, sessions/session) are no longer reported as typos. */
export function fuzzyDistance(
  nodes: NodeRef[],
  rules?: RedundancyRules,
): Issue[] {
  const synonyms = rules ? rules.synonyms : [];
  const stopwords = rules ? rules.stopwords : [];
  const words: NodeRef[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    for (const raw of tokenize(node.text)) {
      const w = normalizeWord(raw, synonyms);
      if (w.length === 0 || seen.has(w)) continue;
      if (REF_SYNTAX_TOKENS.has(w)) continue;
      if (stopwords.includes(w)) continue;
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
      if (isInflectionOf(a.text, b.text)) continue;
      const d = levenshtein(a.text, b.text);
      if (d <= 2) {
        issues.push({
          file: a.file, line: a.line, level: 'warning', category: 'redundancy',
          message: `possible typo: "${a.text}" (${a.file}:${a.line}) ↔ "${b.text}" (${b.file}:${b.line}) — Levenshtein ${d}`,
          suggestion: 'unify the spelling or map the variant as a synonym',
          rule: 'redundancy.typo', // issue #41: word-form layer of the redundancy scheme
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

/** Layer 4 — identical node text at depth 0-1 in >= threshold files without see: linkage.
 *  §18 delete-key semantics: threshold null (deleted) → layer OFF. */
export function crossFileCanonicality(
  allFiles: Map<string, OutlineNode[]>,
  threshold: number | null,
): Issue[] {
  if (threshold === null) return [];
  const concepts = new Map<string, { files: Set<string>; first: NodeRef }>();
  for (const [key, nodes] of allFiles) {
    for (const node of flattenNodes(nodes)) {
      // Issue #8: synthetic "(table)"/"(code fence)" placeholders are not
      // concepts — comparing them across files fabricated "canonical home"
      // warnings with nonsense advice.
      if (isSyntheticNode(node)) continue;
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
      rule: 'redundancy.duplicate_home', // issue #41
    });
  }
  return issues;
}

/** All four redundancy layers over every loaded spec node.
 *  `duplicateHomeCheck` (§18 references.duplicate_home_check) gates layer 4.
 *  Issue #3: `redundancy.fuzzy` (§18 delete-key semantics: deleted → false)
 *  gates layer 3 independently of `enabled`, which still covers all layers. */
export function checkRedundancy(
  allFiles: Map<string, OutlineNode[]>,
  rules: RedundancyRules,
  duplicateHomeCheck = true,
): Issue[] {
  const nodes: NodeRef[] = [];
  for (const [file, tree] of allFiles) {
    for (const node of flattenNodes(tree)) {
      // Issue #8: synthetic "(table)"/"(code fence)" placeholders are not
      // content — excluded from all three text-comparison layers (they made
      // any two table-opening files 100%-overlapping and inflated the
      // "table"/"code"/"fence" word-frequency counts).
      if (isSyntheticNode(node)) continue;
      nodes.push({ text: node.text, file, line: node.line });
    }
  }
  return [
    ...wordFrequency(nodes, rules),
    ...phraseOverlap(nodes, rules.phrase_overlap_threshold, rules),
    ...(rules.fuzzy !== false ? fuzzyDistance(nodes, rules) : []),
    ...(duplicateHomeCheck ? crossFileCanonicality(allFiles, rules.cross_file_threshold) : []),
  ];
}
