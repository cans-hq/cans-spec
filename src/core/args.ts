/** Centralized arg parser enforcing §20 contract:
 *  `--flag value` only. No short flags, no combined flags.
 *  Unknown flags are errors, not silently ignored.
 *  Issue #61 relaxes exactly one §20 clause, opt-in per flag: a FlagSpec with
 *  `equals: true` also accepts the `--flag=value` spelling (`--structure=strict`).
 *  Every flag without it keeps the historic behavior — the equals form stays
 *  an error (QA-06 F4 / QA-14 F3 pin those rejections for --limit=10 and
 *  --merge-strategy=ask), so §20's language is unchanged for pre-#61 flags. */

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
  /** Issue #61: this flag accepts the `--flag=value` spelling IN ADDITION to
   *  its §20 forms. For a value flag it is an alias of `--flag value`; for a
   *  boolean flag the bare form stays `true` and the `=value` rides along
   *  verbatim in `flags` — the parser stores, never judges: the VALUE's
   *  legality belongs to the command's parse layer (check: only `strict`).
   *  The value is everything after the FIRST `=` (`--f=a=b` → `a=b`), and an
   *  empty value (`--f=`) is stored as `''` for that layer to reject — a
   *  typo must never silently read as the bare boolean form. */
  equals?: boolean;
}

/**
 * Parse args against a known flag set.
 * Returns errors for: unknown flags, `--flag=value` form (unless the flag
 * opted in via `equals`, issue #61), short flags, missing values,
 * combined flags.
 */
export function parseArgs(args: string[], spec: FlagSpec[]): ParsedArgs {
  const known = new Map<string, FlagSpec>();
  for (const f of spec) known.set(f.name, f);

  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  const errors: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];

    // `--flag=value` — rejected per §20 UNLESS the flag opted into the
    // equals spelling (issue #61: --structure=strict). The opt-in keeps
    // every other flag's contract byte-identical: --limit=10 and
    // --merge-strategy=ask keep erroring exactly as before.
    if (a.startsWith('--') && a.includes('=')) {
      const eq = a.indexOf('=');
      const name = a.slice(2, eq);
      const value = a.slice(eq + 1);
      const flagSpec = known.get(name);
      if (flagSpec !== undefined && flagSpec.equals === true) {
        flags.set(name, value);
      } else {
        errors.push(`invalid flag form "${a}" — use "--${name} <value>"`);
      }
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
