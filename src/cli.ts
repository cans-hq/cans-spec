#!/usr/bin/env bun

import type { CommandResult } from './types';
import { emit } from './core/output';

/** §44: version line. Keep in sync with package.json. */
const VERSION = '0.1.0';

const [cmd, ...args] = Bun.argv.slice(2);

async function dispatch(): Promise<CommandResult> {
  switch (cmd) {
    case 'init':    return (await import('./commands/init')).run(args);
    case 'check':   return (await import('./commands/check')).run(args);
    case 'new':     return (await import('./commands/new')).run(args);
    case 'done':    return (await import('./commands/done')).run(args);
    case 'status':  return (await import('./commands/status')).run(args);
    case 'budget':  return (await import('./commands/budget')).run(args);
    case 'import':  return (await import('./commands/import')).run(args);
    case 'export':  return (await import('./commands/export')).run(args);
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
  emit(result, args.includes('--json'), args.includes('--refs-only'));
  process.exit(result.exitCode);
} catch (e) {
  console.error(`✗ Internal error: ${e instanceof Error ? e.message : e}`);
  process.exit(2);
}
