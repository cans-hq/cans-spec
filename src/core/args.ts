/** Centralized arg parser enforcing §20 contract:
 *  `--flag value` only. No `--flag=value`, no short flags, no combined flags.
 *  Unknown flags are errors, not silently ignored. */

export interface ParsedArgs {
  positional: string[];
  flags: Map<string, string | true>;
  errors: string[];
}

export interface FlagSpec {
  /** flag name without `--` */
  name: string;
  /** true = boolean flag (no value), false = requires value */
  boolean: boolean;
}

/**
 * Parse args against a known flag set.
 * Returns errors for: unknown flags, `--flag=value` form, short flags,
 * missing values, combined flags.
 */
export function parseArgs(args: string[], spec: FlagSpec[]): ParsedArgs {
  const known = new Map<string, FlagSpec>();
  for (const f of spec) known.set(f.name, f);

  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  const errors: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];

    // Reject --flag=value form
    if (a.startsWith('--') && a.includes('=')) {
      errors.push(`invalid flag form "${a}" — use "--${a.slice(2).split('=')[0]} <value>"`);
      continue;
    }

    // Reject short flags / combined flags
    if (/^-[a-zA-Z]/.test(a) && !a.startsWith('--')) {
      errors.push(`unknown flag "${a}" — no short flags supported`);
      continue;
    }

    if (a.startsWith('--')) {
      const name = a.slice(2);
      const flagSpec = known.get(name);
      if (flagSpec === undefined) {
        errors.push(`unknown flag "--${name}"`);
        continue;
      }
      if (flagSpec.boolean) {
        flags.set(name, true);
      } else {
        const val = args[i + 1];
        if (val === undefined || val.startsWith('--')) {
          errors.push(`flag "--${name}" requires a value`);
        } else {
          flags.set(name, val);
          i++; // consume value
        }
      }
      continue;
    }

    positional.push(a);
  }

  return { positional, flags, errors };
}

/** Format arg errors per §37: what / where / what to do — WITHOUT the `✗` mark
 *  (error fields carry raw text; the human printer adds the mark). */
export function formatArgErrors(errors: string[], command: string): string {
  return errors
    .map(e => `${e}\n  Run \`cans help\` for valid ${command} flags.`)
    .join('\n');
}
