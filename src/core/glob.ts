/** Issue #62: the glob compiler shared by the strict `_rules.yaml`
 *  validator (the `source` / `except` members of `references.forbidden_targets`,
 *  src/core/rules.ts) and the refs engine's forbidden-target guard
 *  (src/core/refs.ts) — ONE documented semantics, spelled once, identical on
 *  the Bun and Node runtimes (no runtime-native glob: brace expansion and
 *  per-runtime divergence are exactly what a layering guard must not depend
 *  on).
 *
 *  Grammar, matched against the workspace-relative path (`/` separators,
 *  e.g. `00-overview.md`, `plugins/leaf.md`):
 *    *      any run of characters EXCEPT `/` (stays inside one segment)
 *    **     any run of characters INCLUDING `/` (crosses segments)
 *    ?      exactly one character except `/`
 *    [abc]  character class — ranges (`[0-9]`) and negation (`[!a]` / `[^a]`)
 *           included; a `]` as the class's first character is literal (`[]a]`)
 *    \X     the literal character X (an escaped metacharacter)
 *    else   itself, verbatim
 *  The match is case-sensitive and anchored to the WHOLE path (no implicit
 *  substring matching — `plugins/*` does not match `a/plugins/x.md`).
 *
 *  Malformed globs (empty, a dangling `\`, an unclosed `[` class) return
 *  null: the validator turns that into the line-numbered §18 config error,
 *  so a ban can never be silently inert because its selector never
 *  compiled. */
export function globToRegExp(glob: string): RegExp | null {
  if (glob === '') return null;
  const esc = (c: string): string => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let src = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '\\') {
      const next = glob[i + 1];
      if (next === undefined) return null; // dangling escape
      src += esc(next);
      i++;
      continue;
    }
    if (c === '*') {
      // `**` crosses `/`; a single `*` stays inside one segment.
      if (glob[i + 1] === '*') {
        src += '.*';
        i++;
      } else {
        src += '[^/]*';
      }
      continue;
    }
    if (c === '?') {
      src += '[^/]';
      continue;
    }
    if (c === '[') {
      let j = i + 1;
      let body = '';
      let negated = false;
      if (glob[j] === '!' || glob[j] === '^') {
        negated = true;
        j++;
      }
      let closed = false;
      let first = true;
      while (j < glob.length) {
        const cc = glob[j]!;
        if (cc === ']' && !first) {
          closed = true;
          j++;
          break;
        }
        first = false;
        if (cc === '\\' && glob[j + 1] !== undefined) {
          body += `\\${glob[j + 1]!}`;
          j += 2;
          continue;
        }
        body += cc === ']' ? '\\]' : cc === '\\' ? '\\\\' : cc;
        j++;
      }
      // Unclosed class, or a class with no members (`[]` / `[!]`): malformed.
      if (!closed || body === '') return null;
      src += `[${negated ? '^' : ''}${body}]`;
      i = j - 1;
      continue;
    }
    src += esc(c);
  }
  src += '$';
  try {
    return new RegExp(src);
  } catch {
    return null;
  }
}
