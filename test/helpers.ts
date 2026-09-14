import { join } from 'path';
import { mkdirSync, rmSync, cpSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { REPO } from './runtime.ts';

export const FIXTURES = join(REPO, 'test', 'fixtures');
export const OUTPUT_FIXTURES = join(FIXTURES, 'output');

export function fixturePath(...parts: string[]): string {
  return join(FIXTURES, ...parts);
}

export function outputFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(OUTPUT_FIXTURES, name), 'utf-8'));
}

export function readFixture(...parts: string[]): string {
  return readFileSync(fixturePath(...parts), 'utf-8');
}

export function makeTmpDir(name: string): string {
  const p = join(REPO, '.tmp', name);
  mkdirSync(p, { recursive: true });
  return p;
}

export function cleanTmpDir(p: string): void {
  if (existsSync(p)) rmSync(p, { recursive: true, force: true });
}

export function copyFixtureToTmp(fixtureName: string, tmpDir: string): string {
  const src = fixturePath(fixtureName);
  const dest = join(tmpDir, fixtureName);
  cpSync(src, dest, { recursive: true });
  return dest;
}

export function makeCansWorkspace(tmpDir: string, files: Record<string, string>): string {
  const root = join(tmpDir, 'cans');
  mkdirSync(root, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const p = join(root, name);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, content, 'utf8'); // was fire-and-forget Bun.write (issue #12)
  }
  return root;
}
