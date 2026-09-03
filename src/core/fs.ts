import type { OutlineNode } from '../types';

export function exists(p: string): boolean {
  throw new Error('not implemented');
}

export function dirExists(p: string): boolean {
  throw new Error('not implemented');
}

export function mkdirp(p: string): void {
  throw new Error('not implemented');
}

export function globFiles(dir: string, pattern: string): string[] {
  throw new Error('not implemented');
}

export function discoverSpecFiles(root: string): string[] {
  throw new Error('not implemented');
}

export function discoverActiveTasks(root: string): string[] {
  throw new Error('not implemented');
}

export function discoverArchivedTasks(root: string): string[] {
  throw new Error('not implemented');
}

export function discoverAdrs(root: string): string[] {
  throw new Error('not implemented');
}

export function resolveSpecFile(root: string, name: string): string | null {
  throw new Error('not implemented');
}
