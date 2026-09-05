import { describe, test, expect } from 'bun:test';
import { parseOpml, serializeOpml, encodeXmlEntity, decodeXmlEntity } from '../src/converters/opml';
import { parseLogseq, serializeLogseq } from '../src/converters/logseq';
import { parseObsidian, serializeObsidian, stripFrontmatter } from '../src/converters/obsidian';
import { parseCheckbox, convertWikiLinks, serializeToCans } from '../src/converters/shared';
import { readFixture } from './helpers';

describe('OPML', () => {
  const src = readFixture('import-fixtures', 'dynalist-export.opml');

  test('parses outline nodes', () => {
    const nodes = parseOpml(src);
    expect(nodes.length).toBe(2); // Authentication, Dashboard
    expect(nodes[0].text).toBe('Authentication');
  });

  test('parses nested hierarchy', () => {
    const nodes = parseOpml(src);
    expect(nodes[0].children.length).toBe(2); // Sign up, Sessions
    expect(nodes[0].children[0].text).toBe('Sign up');
  });

  test('roundtrips', () => {
    const nodes = parseOpml(src);
    const out = serializeOpml(nodes, 'Project Backlog');
    const reparsed = parseOpml(out);
    expect(reparsed.length).toBe(nodes.length);
    expect(reparsed[0].text).toBe(nodes[0].text);
  });

  test('encodes/decodes XML entities', () => {
    expect(encodeXmlEntity('a & b < c')).toBe('a &amp; b &lt; c');
    expect(decodeXmlEntity('a &amp; b &lt; c')).toBe('a & b < c');
  });
});

describe('Logseq', () => {
  const src = readFixture('import-fixtures', 'logseq-page.md');

  test('converts TODO to task', () => {
    const nodes = parseLogseq(src);
    const todo = nodes.find(n => n.text.includes('Implement auth flow'));
    expect(todo!.isTask).toBe(true);
    expect(todo!.isDone).toBe(false);
  });

  test('converts DONE to checked task', () => {
    const nodes = parseLogseq(src);
    const done = nodes.find(n => n.text.includes('Add Google OAuth'));
    expect(done!.isDone).toBe(true);
  });

  test('converts wiki-links to see:', () => {
    const nodes = parseLogseq(src);
    const refNode = nodes.find(n => n.text.includes('Sessions'));
    expect(refNode!.text).toContain('see:');
    expect(refNode!.text).not.toContain('[[');
  });

  test('strips block refs', () => {
    const nodes = parseLogseq(src);
    const flat = JSON.stringify(nodes);
    expect(flat).not.toContain('block-ref');
  });
});

describe('Obsidian', () => {
  const src = readFixture('import-fixtures', 'obsidian-note.md');

  test('strips YAML frontmatter', () => {
    const stripped = stripFrontmatter(src);
    expect(stripped).not.toContain('title:');
    expect(stripped).not.toContain('tags:');
    expect(stripped).toContain('- API');
  });

  test('converts wiki-links', () => {
    const nodes = parseObsidian(src);
    const flat = JSON.stringify(nodes);
    // §4/§27 canonical ref form carries the `.md` suffix.
    expect(flat).toContain('see: 02-authentication.md#Sessions');
    expect(flat).not.toContain('[[');
  });

  test('handles embeds', () => {
    const nodes = parseObsidian(src);
    const flat = JSON.stringify(nodes);
    // §27/§31 + QA-08 E7: `![[embeds]]` convert to `see:` with the canonical
    // `.md` suffix (same as wiki-links) — a `.md`-less ref is guaranteed broken.
    expect(flat).toContain('see: error-codes.md');
    expect(flat).not.toMatch(/see:\s+error-codes(?!\.md)/);
  });

  test('preserves checkboxes', () => {
    const nodes = parseObsidian(src);
    const task = nodes.find(n => n.text.includes('rate limiting'));
    expect(task!.isTask).toBe(true);
  });
});

describe('shared', () => {
  test('parseCheckbox handles variants', () => {
    expect(parseCheckbox('- [ ] todo')).toEqual({ isTask: true, isDone: false, clean: 'todo' });
    expect(parseCheckbox('- [x] done')).toEqual({ isTask: true, isDone: true, clean: 'done' });
    expect(parseCheckbox('- TODO task')).toEqual({ isTask: true, isDone: false, clean: 'task' });
    expect(parseCheckbox('- DONE task')).toEqual({ isTask: true, isDone: true, clean: 'task' });
    expect(parseCheckbox('- plain')).toEqual({ isTask: false, isDone: false, clean: 'plain' });
  });

  test('convertWikiLinks', () => {
    // §4/§27 canonical ref form carries the `.md` suffix (QA-08 E7 — the old
    // `.md`-less expectation pinned a guaranteed-broken ref and was a band-aid).
    expect(convertWikiLinks('[[02-auth#Sessions]]')).toBe('see: 02-auth.md#Sessions');
    expect(convertWikiLinks('[[02-auth#Sessions|label]]')).toBe('see: 02-auth.md#Sessions');
    expect(convertWikiLinks('[[02-auth]]')).toBe('see: 02-auth.md');
  });
});
