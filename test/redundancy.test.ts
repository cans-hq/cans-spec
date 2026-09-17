import { describe, test, expect } from './testing.ts';
import { parseOutline } from '../src/core/outline.ts';
import { checkRedundancy, normalizeWord, wordFrequency, phraseOverlap } from '../src/core/redundancy.ts';
import { defaultRules } from '../src/core/rules.ts';
import { readFixture } from './helpers.ts';

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

// ── Issue #8: phantom "(table)" nodes must not poison the redundancy layers ──

describe('leading tables do not leak into redundancy (issue #8)', () => {
  test('two files opening with tables: no "(table)" issues, no overlap/canonical-home warnings', () => {
    const fileA = [
      '| Field | Value |',
      '|---|---|',
      '| alpha | xray |',
      '',
      '- Alpha renderer streams delta packets',
      '- Zephyr cache warms quickly',
    ].join('\n');
    const fileB = [
      '| Field | Value |',
      '|---|---|',
      '| beta | yankee |',
      '',
      '- Orchard logistics tracks cranes',
      '- Quartz vault hums nightly',
    ].join('\n');
    const files = new Map();
    files.set('01-a.md', parseOutline(fileA, '01-a.md'));
    files.set('02-b.md', parseOutline(fileB, '02-b.md'));

    const issues = checkRedundancy(files, rules);

    // No issue may mention the phantom "(table)" node text.
    expect(issues.filter(i => i.message.includes('(table)'))).toEqual([]);
    // No 100% overlap pair between the two files (previously the two phantoms matched).
    expect(issues.filter(i => i.message.includes('100% overlap'))).toEqual([]);
    // No canonical-home warning naming "(table)".
    expect(issues.filter(i => i.suggestion?.includes('(table)'))).toEqual([]);
    // The unrelated real bullets must not be flagged either — the files are clean.
    expect(issues).toEqual([]);
  });
});
