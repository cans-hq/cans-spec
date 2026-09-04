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

  test('partial file overrides only listed keys', () => {
    const tmp = makeTmpDir('rules-partial');
    try {
      mkdirSync(tmp, { recursive: true });
      Bun.write(join(tmp, '_rules.yaml'), 'structure:\n  node_length: { min: 5, max: 200 }\n');
      const rules = loadRules(tmp);
      expect(rules.structure.node_length.min).toBe(5);
      expect(rules.structure.node_length.max).toBe(200);
      expect(rules.structure.siblings.max).toBe(12); // default preserved
    } finally {
      cleanTmpDir(tmp);
    }
  });
});
