import { describe, test, expect } from 'bun:test';
import { loadRules, defaultRules, parseMinimalYaml } from '../src/core/rules';
import { makeTmpDir, cleanTmpDir } from './helpers';
import { join } from 'path';
import { mkdirSync } from 'fs';

describe('defaultRules', () => {
  test('returns complete structure', () => {
    const r = defaultRules();
    expect(r.structure.node_length.max).toBe(120);
    expect(r.structure.siblings.max).toBe(12);
    expect(r.structure.depth.max).toBe(5);
    expect(r.style.force_nested_above).toBe(6);
    expect(r.redundancy.word_frequency_threshold).toBe(4);
    expect(r.token_budget.default_limit).toBe(4096);
    expect(r.overflow.max_node_chars).toBe(200);
  });
});

describe('parseMinimalYaml', () => {
  test('parses nested objects', () => {
    const yaml = 'structure:\n  node_length: { min: 3, max: 120 }\n';
    const result = parseMinimalYaml(yaml) as any;
    expect(result.structure.node_length.min).toBe(3);
  });

  test('parses arrays', () => {
    const yaml = 'stopwords:\n  - the\n  - a\n';
    const result = parseMinimalYaml(yaml) as any;
    expect(result.stopwords).toEqual(['the', 'a']);
  });

  test('parses inline arrays', () => {
    const yaml = 'stopwords: [the, a, an]\n';
    const result = parseMinimalYaml(yaml) as any;
    expect(result.stopwords).toEqual(['the', 'a', 'an']);
  });
});

describe('loadRules', () => {
  test('missing file returns defaults', () => {
    const tmp = makeTmpDir('rules-empty');
    try {
      const rules = loadRules(tmp);
      expect(rules.structure.node_length.max).toBe(120);
    } finally {
      cleanTmpDir(tmp);
    }
  });

  test('partial file: listed keys override, deleted check-keys turn OFF (§18)', () => {
    // §18: "Partial file = only listed keys override. Delete a key = check
    // turns off." The file lists only structure.node_length → that key
    // overrides its default, while EVERY deleted check-key (siblings, depth,
    // single_child_collapse, empty_nodes and the absent sections) must be OFF
    // — not silently restored to its default. Parameters (e.g. stopwords,
    // token_budget.default_limit) are not checks and keep their defaults.
    const tmp = makeTmpDir('rules-partial');
    try {
      mkdirSync(tmp, { recursive: true });
      Bun.write(join(tmp, '_rules.yaml'), 'structure:\n  node_length: { min: 5, max: 200 }\n');
      const rules = loadRules(tmp);
      // listed key overrides
      expect(rules.structure.node_length.min).toBe(5);
      expect(rules.structure.node_length.max).toBe(200);
      // deleted mapping keys → null (check off)
      expect(rules.structure.siblings.max).toBeNull();
      expect(rules.structure.siblings.min).toBeNull();
      expect(rules.structure.depth.max).toBeNull();
      // deleted boolean switches → false
      expect(rules.structure.single_child_collapse).toBe(false);
      expect(rules.structure.empty_nodes).toBe(false);
      // absent sections → every check under them off
      expect(rules.style.shared_prefix_detection).toBe(false);
      expect(rules.style.force_nested_above).toBeNull();
      expect(rules.content.tbd_allowed).toBe(false);
      expect(rules.references.orphan_check).toBe(false);
      expect(rules.references.back_pointers).toBe(false);
      expect(rules.redundancy.enabled).toBe(false);
      expect(rules.overflow.max_node_chars).toBeNull();
      // parameters keep documented defaults when their section is absent
      expect(rules.token_budget.default_limit).toBe(4096);
      expect(rules.redundancy.stopwords).toEqual(defaultRules().redundancy.stopwords);
    } finally {
      cleanTmpDir(tmp);
    }
  });

  test('full rules file behaves exactly like the defaults (§18 compatibility)', () => {
    // A file listing EVERY key must load identically to "no file" — the §18
    // delete-key pass may only change the meaning of PARTIAL files.
    const tmp = makeTmpDir('rules-full');
    try {
      mkdirSync(tmp, { recursive: true });
      const d = defaultRules();
      const yaml = [
        'structure:',
        '  node_length: { min: 3, max: 120 }',
        '  siblings: { min: 1, max: 12 }',
        '  depth: { min: 1, max: 5 }',
        '  single_child_collapse: true',
        '  empty_nodes: false',
        'style:',
        '  prefer: sibling',
        '  force_nested_above: 6',
        '  force_sibling_below: 3',
        '  shared_prefix_detection: true',
        'content:',
        '  tbd_allowed: true',
        '  max_tbd_per_file: 5',
        'references:',
        '  mode: pointer',
        '  back_pointers: true',
        '  max_hops: 1',
        '  orphan_check: true',
        '  duplicate_home_check: true',
        'redundancy:',
        '  enabled: true',
        '  word_frequency_threshold: 4',
        '  phrase_overlap_threshold: 0.7',
        '  cross_file_threshold: 2',
        'token_budget:',
        '  enabled: true',
        '  default_limit: 4096',
        '  estimate_chars_per_token: 3.5',
        '  warn_threshold: 0.8',
        'overflow:',
        '  max_node_chars: 200',
        '  force_file_for: [code_block, table, diagram]',
        '',
      ].join('\n');
      Bun.write(join(tmp, '_rules.yaml'), yaml);
      const rules = loadRules(tmp);
      expect(rules).toEqual(d);
    } finally {
      cleanTmpDir(tmp);
    }
  });
});
