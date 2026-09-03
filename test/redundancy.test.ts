import { describe, test, expect } from 'bun:test';
import { parseOutline } from '../src/core/outline';
import { checkRedundancy, normalizeWord, wordFrequency, phraseOverlap } from '../src/core/redundancy';
import { defaultRules } from '../src/core/rules';
import { readFixture } from './helpers';

const rules = defaultRules().redundancy;

describe('normalizeWord', () => {
  test('lowercases', () => {
    expect(normalizeWord('Authentication', rules.synonyms)).toBe('authentication');
  });

  test('expands synonyms', () => {
    expect(normalizeWord('postgresql', rules.synonyms)).toBe('postgres');
    expect(normalizeWord('pg', rules.synonyms)).toBe('postgres');
  });

  test('strips punctuation', () => {
    expect(normalizeWord('users.', rules.synonyms)).toBe('users');
  });
});

describe('word frequency', () => {
  test('flags repeated word across nodes', () => {
    const files = new Map();
    const authSrc = readFixture('redundancy-project', '02-authentication.md');
    const apiSrc = readFixture('redundancy-project', '04-api.md');
    files.set('02-authentication.md', parseOutline(authSrc, '02-authentication.md'));
    files.set('04-api.md', parseOutline(apiSrc, '04-api.md'));
    const issues = checkRedundancy(files, rules);
    const freqIssue = issues.find(i => i.message.includes('authentication'));
    expect(freqIssue).toBeDefined();
    expect(freqIssue!.level).toBe('warning');
  });
});

describe('phrase overlap', () => {
  test('flags near-duplicate bullets', () => {
    const nodes = [
      { text: 'Authentication tokens expire after 24 hours', file: 'a.md', line: 1 },
      { text: 'Authentication tokens expire after 24 hours', file: 'b.md', line: 2 },
    ];
    const issues = phraseOverlap(nodes, rules.phrase_overlap_threshold);
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe('cross-file canonicality', () => {
  test('flags same concept in two files without see:', () => {
    const files = new Map();
    files.set('02-authentication.md', parseOutline(
      '- Authentication\n  - Sign up\n', '02-authentication.md'
    ));
    files.set('04-api.md', parseOutline(
      '- Authentication\n  - Header required\n', '04-api.md'
    ));
    const issues = checkRedundancy(files, rules);
    const crossIssue = issues.find(i => i.category === 'redundancy');
    expect(crossIssue).toBeDefined();
  });
});
