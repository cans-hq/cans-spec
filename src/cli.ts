#!/usr/bin/env node

import type { CommandResult } from './types.ts';
import { emit } from './core/output.ts';
import { argv, readText, dirFromUrl } from './core/runtime.ts';
import { join } from 'node:path';

/** §44: version line — derived from package.json so it can never drift.
 *  Read through the runtime shim (issue #12): a bare JSON import has no
 *  import attributes and is therefore not portable to the Node fallback. */
const PKG_FILE = join(dirFromUrl(import.meta.url), '..', 'package.json');
const VERSION: string = (JSON.parse(await readText(PKG_FILE)) as { version: string }).version;

const [cmd, ...args] = argv();

async function dispatch(): Promise<CommandResult> {
  switch (cmd) {
    case 'init':    return (await import('./commands/init.ts')).run(args);
    case 'check':   return (await import('./commands/check.ts')).run(args);
    case 'new':     return (await import('./commands/new.ts')).run(args);
    case 'done':    return (await import('./commands/done.ts')).run(args);
    case 'status':  return (await import('./commands/status.ts')).run(args);
    case 'budget':  return (await import('./commands/budget.ts')).run(args);
    case 'import':  return (await import('./commands/import.ts')).run(args);
    case 'export':  return (await import('./commands/export.ts')).run(args);
    case 'help':
    case '-h':      // §20/§44: conventional help shortcuts
    case '--help':
      return { ok: true, command: 'help', exitCode: 0 };
    case 'version':
    case '--version': // §44: version surface
      return { ok: true, command: 'version', exitCode: 0, version: VERSION } as CommandResult;
    default:
      // §37: unknown / missing command must say what happened and how to fix it.
      return {
        ok: false,
        command: cmd ?? 'unknown',
        exitCode: 1,
        error: cmd === undefined
          ? 'no command given — run `cans help`'
          : `unknown command "${cmd}" — run \`cans help\``,
      } as CommandResult;
  }
}

try {
  const result = await dispatch();
  // issue #41: check's --show sections are parsed for the EMIT side only —
  // lazily, so non-check commands never load the check module.
  const show = cmd === 'check'
    ? (await import('./commands/check.ts')).showSectionsFromArgs(args)
    : undefined;
  emit(result, args.includes('--json'), args.includes('--refs-only'), show);
  process.exit(result.exitCode);
} catch (e) {
  console.error(`✗ Internal error: ${e instanceof Error ? e.message : e}`);
  process.exit(2);
}
