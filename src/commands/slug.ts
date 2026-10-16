/** `cans slug` — print the canonical anchor fragment for a node (issue #53,
 *  Part 1.2).
 *
 *  WHY this command exists: the slug algorithm (Part 1.1, core/slug.ts —
 *  Option A) is deterministic but not guessable from prose. A node titled
 *  `Layer 1 — C authorizer` anchors as `#Layer-1-C-authorizer`, and before
 *  this command authors reverse-engineered that mapping by trial and error —
 *  every miss minted a broken ref. `cans slug` prints the exact fragment
 *  from the single source of truth, eliminating the whole bug class:
 *
 *      see: 02-authentication.md#$(cans slug "Layer 1 — C authorizer")
 *
 *  Dual input modes (the issue's ask, plus the `--explain-anchor <file:line>`
 *  idea folded in as a query command — deliberately NOT a flag on check.ts,
 *  which stays a pure validator):
 *
 *  - TEXT: `cans slug <text...>` — all positional args joined with a single
 *    space (exactly how `new` joins its title args), so shell quoting is
 *    forgiving: `cans slug Layer 1 — C authorizer` and the quoted spelling
 *    produce the same fragment. No workspace needed — pure string work.
 *  - FILE:LINE: `cans slug <file>:<line>` (e.g. `02-authentication.md:14`) —
 *    resolve the workspace root, parse the spec file, print the slug of the
 *    node whose bullet sits EXACTLY on that line. Answers "what anchor does
 *    THIS node get?" straight from the parsed source.
 *
 *  Disambiguation (parseSlugTarget, the exported contract): the joined input
 *  runs in text mode unless it ends in `.md:<line>`. An `.md:` tail whose
 *  line part is not a clean 1-based integer (`0`, `-14`, `abc`, `014`, empty)
 *  is diagnosed as a malformed file:line — never silently slugged as prose.
 *  The trade is deliberate: literal node text ending in `.md:<digits>` is
 *  vanishingly rare, and when it happens the failure is loud and names the
 *  misread file; the reverse error (a lookup slugged as text) would print
 *  plausible nonsense — exactly the silent failure §37 exists to prevent.
 */
import type { SlugResult } from '../types.ts';
import { readText } from '../core/runtime.ts';
import { resolveWorkspaceRoot, resolveSpecFile } from '../core/fs.ts';
import { parseOutline, realNodes } from '../core/outline.ts';
import { anchorSlug } from '../core/slug.ts';
import { parseArgs, formatArgErrors, type FlagSpec } from '../core/args.ts';

const SLUG_FLAGS: FlagSpec[] = [
  { name: 'json', boolean: true },
];

/** The strict file:line form `<path>.md:<line>`: a clean 1-based line number
 *  — digits only, no sign, no leading zeros (so `014` can never silently
 *  mean 14). The `.+` before `.md` already spans `/`, so folder spellings
 *  (`04-api/request-schema.md:3`) need no separate case. */
const FILE_LINE_RE = /^(.+\.md):([1-9]\d*)$/;

/** The near-miss: the SAME `.md:` tail but a line part that is not a clean
 *  1-based integer. Almost certainly an intended file:line lookup, so it is
 *  a §37 diagnosis rather than a silently wrong text-mode slug. */
const FILE_LINE_ATTEMPT_RE = /^(.+\.md):(.*)$/;

/** What `cans slug` was asked to do with its positional args. Pure and
 *  exported for unit tests — the mode rule IS the command's contract. */
export type SlugTarget =
  | { mode: 'text'; text: string }
  | { mode: 'file'; file: string; line: number }
  | { mode: 'bad-line'; file: string; raw: string };

/** Classify the positional args: file:line mode when the JOINED input ends in
 *  `.md:<line>` (join first — `new`'s convention — so multi-word text and
 *  multi-arg lookups behave identically), bad-line for an `.md:` tail with a
 *  non-clean line part, text mode for everything else. */
export function parseSlugTarget(args: string[]): SlugTarget {
  const joined = args.join(' ');
  const strict = joined.match(FILE_LINE_RE);
  if (strict !== null) {
    return { mode: 'file', file: strict[1]!, line: Number(strict[2]) };
  }
  const attempt = joined.match(FILE_LINE_ATTEMPT_RE);
  if (attempt !== null) {
    return { mode: 'bad-line', file: attempt[1]!, raw: attempt[2]! };
  }
  return { mode: 'text', text: joined };
}

/** §37 helper: how to name a file's node lines in a not-a-node-line
 *  diagnosis. Few (≤ 8) → the full list, immediately actionable; many → the
 *  `first..last` range with the node count. Sorted defensively: realNodes
 *  walks document order (ascending by construction), but the message
 *  contract must not depend on that. */
function describeNodeLines(lines: number[]): string {
  if (lines.length === 0) return 'the file has no nodes';
  const sorted = [...lines].sort((a, b) => a - b);
  if (sorted.length <= 8) return `node lines: ${sorted.join(', ')}`;
  return `node lines: ${sorted[0]!}..${sorted[sorted.length - 1]!} (${sorted.length} nodes)`;
}

export async function run(args: string[]): Promise<SlugResult> {
  const parsed = parseArgs(args, SLUG_FLAGS);
  const input = parsed.positional.join(' ');

  if (parsed.errors.length > 0) {
    return { ok: false, command: 'slug', exitCode: 1, input, slug: '', error: formatArgErrors(parsed.errors, 'slug') };
  }

  // §37: zero positionals is a usage failure — name the exact invocation
  // (distinct from an empty-slug diagnosis: nothing was given at all).
  if (parsed.positional.length === 0) {
    return {
      ok: false, command: 'slug', exitCode: 1, input, slug: '',
      error: 'no text given — run `cans slug "<node text>"`',
    };
  }

  const target = parseSlugTarget(parsed.positional);

  if (target.mode === 'bad-line') {
    return {
      ok: false, command: 'slug', exitCode: 1, input, slug: '',
      error: `malformed line number "${target.raw}" in "${input}" — line numbers are 1-based: <file>.md:<line>, e.g. 02-authentication.md:14`,
    };
  }

  if (target.mode === 'text') {
    const slug = anchorSlug(target.text);
    if (slug === '') {
      // Mirrors `new`'s empty-slug diagnosis (§23/§37): input WAS given, it
      // just has no slug-able content (whitespace / separator runs only).
      return {
        ok: false, command: 'slug', exitCode: 1, input, slug: '',
        error: `empty slug from "${target.text}" — provide non-empty node text`,
      };
    }
    return { ok: true, command: 'slug', exitCode: 0, input, slug };
  }

  // ── file:line mode ──

  // Requires a workspace — check.ts's diagnosis, verbatim (§37: the user
  // must hear the same fix wherever the same problem surfaces).
  const root = resolveWorkspaceRoot();
  if (root === null) {
    return {
      ok: false, command: 'slug', exitCode: 1, input, slug: '',
      error: 'no cans workspace found — run `cans init` or cd into a project with a cans/ directory',
    };
  }

  // §12 resolution (resolveSpecFile): flat file first, then folder index.md —
  // `02-authentication.md` and `02-authentication/index.md` are the same
  // target, and containment (issue #10) is enforced inside, so a
  // `../escape.md:14` can never point outside the workspace.
  const abs = resolveSpecFile(root, target.file);
  if (abs === null) {
    return {
      ok: false, command: 'slug', exitCode: 1, input, slug: '',
      error: `file not found: ${target.file} — run \`cans status\` to list the workspace files`,
    };
  }

  let source: string;
  try {
    source = await readText(abs);
  } catch (e) {
    return {
      ok: false, command: 'slug', exitCode: 1, input, slug: '',
      error: `unreadable file: ${target.file} — ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  let nodes;
  try {
    nodes = parseOutline(source, target.file);
  } catch (e) {
    // Same shape as check.ts's parse errors (tab indentation &c).
    return {
      ok: false, command: 'slug', exitCode: 1, input, slug: '',
      error: `parse error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // Real nodes only (issue #8): synthetic `(table)` / `(code fence)`
  // placeholders are parser scaffolding, not content — a table row is not a
  // node line, and slugging the literal text "(table)" would be nonsense.
  const real = realNodes(nodes);
  const node = real.find(n => n.line === target.line);
  if (node === undefined) {
    return {
      ok: false, command: 'slug', exitCode: 1, input, slug: '',
      error: `line ${target.line} is not a node line in ${target.file} — ${describeNodeLines(real.map(n => n.line))}`,
    };
  }

  return { ok: true, command: 'slug', exitCode: 0, input, slug: anchorSlug(node.text), nodeText: node.text };
}
