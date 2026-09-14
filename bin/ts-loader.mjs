/**
 * ESM loader hook for the Node fallback runtime (issue #12).
 *
 * Node's built-in TypeScript type-stripping refuses to process files under
 * `node_modules`, which breaks `npm i -g cans-spec` on machines without Bun —
 * the exact Termux scenario this package must support. This hook performs the
 * SAME erasable-syntax stripping ourselves via Node's builtin
 * `node:module.stripTypeScriptTypes` (no dependencies, no build step — source
 * stays distribution), bypassing only that path-based veto.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

// This hook runs inside Node's loader thread, whose default handler prints the
// `stripTypeScriptTypes` ExperimentalWarning on every CLI run. Suppress warnings
// scoped to THIS thread only (CANS_DEBUG_WARNINGS=1 restores them).
if (process.env.CANS_DEBUG_WARNINGS !== '1') {
  process.removeAllListeners('warning');
  process.on('warning', () => {});
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts')) {
    const file = fileURLToPath(url);
    const code = await readFile(file, 'utf8');
    // Node ≥23.2 returns an object ({ source }); some versions return the
    // stripped string directly — accept both shapes.
    const result = stripTypeScriptTypes(code, { sourceUrl: file });
    const source = typeof result === 'string' ? result : result?.source;
    return { format: 'module', source, shortCircuit: true };
  }
  return nextLoad(url, context);
}
