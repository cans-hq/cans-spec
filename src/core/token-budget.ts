import { readFileSync } from 'fs';
import { basename } from 'path';
import type {
  OutlineNode, BackPointer, TokenBudgetRules,
  BudgetReadPlanItem, BudgetReadResult, BudgetWriteResult,
} from '../types';
import { flattenNodes, parseOutline } from './outline';
import { targetMatchesKey } from './refs';

export function estimateTokens(text: string, charsPerToken: number): number {
  return Math.ceil(text.length / charsPerToken);
}

function serializedNodeText(nodes: OutlineNode[]): string {
  return flattenNodes(nodes).map(n => n.text).join('\n');
}

/** Token estimate for a workspace key (loaded nodes) or a raw file path (content read). */
function fileTokens(allFiles: Map<string, OutlineNode[]>, file: string, cpt: number): number {
  const nodes = allFiles.get(file);
  if (nodes !== undefined) return estimateTokens(serializedNodeText(nodes), cpt);
  try {
    return estimateTokens(readFileSync(file, 'utf-8'), cpt);
  } catch {
    return 0;
  }
}

function readNodesFor(file: string, allFiles: Map<string, OutlineNode[]>): OutlineNode[] | null {
  const loaded = allFiles.get(file);
  if (loaded !== undefined) return loaded;
  try {
    return parseOutline(readFileSync(file, 'utf-8'), file);
  } catch {
    return null;
  }
}

/** Canonical home: candidate nodes (text mentions concept) ranked by
 *  child count DESC → indent ASC → file ASC → line ASC. */
export function findCanonicalHome(
  concept: string,
  allFiles: Map<string, OutlineNode[]>,
): { file: string; anchor: string | null } | null {
  const lc = concept.toLowerCase();
  const candidates: Array<{ file: string; node: OutlineNode }> = [];
  for (const [file, nodes] of allFiles) {
    for (const node of flattenNodes(nodes)) {
      if (node.text.toLowerCase().includes(lc)) candidates.push({ file, node });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const byChildren = b.node.children.length - a.node.children.length;
    if (byChildren !== 0) return byChildren;
    const byIndent = a.node.indent - b.node.indent;
    if (byIndent !== 0) return byIndent;
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return a.node.line - b.node.line;
  });
  const top = candidates[0];
  return { file: top.file, anchor: top.node.text };
}

interface RankedItem extends BudgetReadPlanItem {
  rank: number; // tie-break after score: active task first, then canonical home
}

export function buildReadPlan(
  concept: string,
  allFiles: Map<string, OutlineNode[]>,
  backPointers: BackPointer[],
  rules: TokenBudgetRules,
  limit?: number,
  taskFile?: string,
  activeTaskPaths?: string[],
): BudgetReadResult {
  const lc = concept.toLowerCase();
  const budgetLimit = limit ?? rules.default_limit;
  const cpt = rules.estimate_chars_per_token;
  const home = findCanonicalHome(concept, allFiles);
  const tokens = (f: string): number => fileTokens(allFiles, f, cpt);
  const items = new Map<string, RankedItem>();

  if (taskFile !== undefined) {
    items.set(taskFile, {
      file: taskFile, anchor: null, reason: 'active task', score: 100,
      estTokens: tokens(taskFile), rank: 0,
    });
  }
  if (home !== null) {
    items.set(home.file, {
      file: home.file, anchor: home.anchor, reason: 'canonical home', score: 100,
      estTokens: tokens(home.file), rank: taskFile !== undefined ? 1 : 0,
    });
  }

  const backRefFiles = new Set<string>();
  if (home !== null) {
    for (const bp of backPointers) {
      if (targetMatchesKey(bp.toFile, home.file)) backRefFiles.add(bp.fromFile);
    }
  }
  for (const key of allFiles.keys()) {
    if (items.has(key)) continue;
    if (backRefFiles.has(key)) {
      items.set(key, { file: key, anchor: null, reason: 'see: back-ref', score: 60, estTokens: tokens(key), rank: 2 });
      continue;
    }
    const mentions = flattenNodes(allFiles.get(key)!).some(n => n.text.toLowerCase().includes(lc));
    if (mentions) {
      items.set(key, { file: key, anchor: null, reason: 'mentions concept', score: 20, estTokens: tokens(key), rank: 3 });
    }
  }

  // §26 step 3: active tasks mentioning the concept score 80 and join the plan
  // right after the canonical home.
  if (activeTaskPaths !== undefined) {
    for (const taskPath of activeTaskPaths) {
      if (items.has(taskPath)) continue;
      let content = '';
      try {
        content = readFileSync(taskPath, 'utf-8');
      } catch {
        continue;
      }
      if (content.toLowerCase().includes(lc)) {
        items.set(taskPath, {
          file: taskPath, anchor: null,
          reason: 'active task mentions concept',
          score: 80,
          estTokens: estimateTokens(content, cpt),
          rank: 2,
        });
      }
    }
  }

  if (taskFile !== undefined) {
    const taskNodes = readNodesFor(taskFile, allFiles);
    if (taskNodes !== null) {
      for (const node of flattenNodes(taskNodes)) {
        for (const ref of node.refs) {
          for (const key of allFiles.keys()) {
            if (!targetMatchesKey(ref.file, key)) continue;
            const existing = items.get(key);
            if (existing !== undefined && (existing.reason === 'canonical home' || existing.reason === 'active task')) continue;
            if (existing !== undefined) {
              if (existing.score < 80) {
                existing.score = 80;
                existing.reason = 'task ref target';
              }
            } else {
              items.set(key, { file: key, anchor: null, reason: 'task ref target', score: 80, estTokens: tokens(key), rank: 2 });
            }
          }
        }
      }
    }
  }

  const sorted = [...items.values()].sort((a, b) => {
    const byScore = b.score - a.score;
    if (byScore !== 0) return byScore;
    const byRank = a.rank - b.rank;
    if (byRank !== 0) return byRank;
    return a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
  });

  const plan: BudgetReadPlanItem[] = [];
  const skipped: string[] = [];
  let totalTokens = 0;
  let cut = false;
  for (const item of sorted) {
    if (cut || totalTokens + item.estTokens > budgetLimit) {
      cut = true;
      skipped.push(item.file);
      continue;
    }
    plan.push({
      file: item.file, anchor: item.anchor, reason: item.reason,
      score: item.score, estTokens: item.estTokens,
    });
    totalTokens += item.estTokens;
  }
  for (const key of allFiles.keys()) {
    if (!items.has(key)) skipped.push(key);
  }
  skipped.sort();

  const usagePercent = budgetLimit > 0
    ? Math.round((totalTokens / budgetLimit) * 1000) / 10
    : 0;
  return {
    ok: true, command: 'budget-read', exitCode: 0, concept,
    plan, skipped, totalTokens, budgetLimit, usagePercent,
  };
}

function taskMentionsConcept(
  taskPath: string,
  allFiles: Map<string, OutlineNode[]>,
  lc: string,
): boolean {
  try {
    return readFileSync(taskPath, 'utf-8').toLowerCase().includes(lc);
  } catch {
    const base = basename(taskPath);
    for (const [key, nodes] of allFiles) {
      if (basename(key) !== base) continue;
      if (flattenNodes(nodes).some(n => n.refs.length === 0 && n.text.toLowerCase().includes(lc))) return true;
    }
    return false;
  }
}

export function buildWritePlan(
  concept: string,
  allFiles: Map<string, OutlineNode[]>,
  backPointers: BackPointer[],
  activeTasks: string[],
): BudgetWriteResult {
  const lc = concept.toLowerCase();
  const home = findCanonicalHome(concept, allFiles);
  const homeFile = home === null ? null : home.file;

  const canEdit: Array<{ file: string; anchor: string | null; reason: string }> = [];
  if (home !== null) {
    canEdit.push({ file: home.file, anchor: home.anchor, reason: 'canonical home' });
  }
  for (const taskPath of activeTasks) {
    if (taskMentionsConcept(taskPath, allFiles, lc)) {
      canEdit.push({ file: taskPath, anchor: null, reason: 'active task' });
    }
  }

  const mustNotEdit: Array<{ file: string; reason: string }> = [];
  const backPointersToUpdate: Array<{ fromFile: string; fromLine: number; toFile: string }> = [];
  if (homeFile !== null) {
    for (const key of allFiles.keys()) {
      if (key === homeFile) continue;
      let hasBackRef = false;
      for (const bp of backPointers) {
        if ((bp.fromFile === key || targetMatchesKey(bp.fromFile, key)) && targetMatchesKey(bp.toFile, homeFile)) {
          hasBackRef = true;
          break;
        }
      }
      if (!hasBackRef) continue;
      // "mentions" counts only non-ref content: see:/anchor text is a pointer, not a definition.
      const contentMention = flattenNodes(allFiles.get(key)!).some(
        n => n.refs.length === 0 && n.text.toLowerCase().includes(lc),
      );
      if (!contentMention) {
        mustNotEdit.push({ file: key, reason: 'only has see: reference' });
      }
    }
    for (const bp of backPointers) {
      if (targetMatchesKey(bp.toFile, homeFile)) {
        backPointersToUpdate.push({ fromFile: bp.fromFile, fromLine: bp.fromLine, toFile: homeFile });
      }
    }
  }

  return {
    ok: true, command: 'budget-write', exitCode: 0, concept,
    canEdit, mustNotEdit, backPointersToUpdate,
  };
}
