import { basename, dirname, join, relative } from 'path';
import type { InitResult } from '../types';
import { resolveWorkspaceRoot, resolveInitTarget, mkdirp, exists, dirExists } from '../core/fs';
import { parseArgs, type FlagSpec } from '../core/args';

const TEMPLATES_DIR = join(import.meta.dir, '..', '..', 'templates');

async function readTemplate(name: string): Promise<string> {
  return await Bun.file(join(TEMPLATES_DIR, name)).text();
}

export interface InitArgs {
  flat: boolean;
  folders: boolean;
  bare: boolean;
  force: boolean;
  json: boolean;
  tool: string | null;
  errors: string[];
}

const INIT_FLAGS: FlagSpec[] = [
  { name: 'flat', boolean: true },
  { name: 'folders', boolean: true },
  { name: 'bare', boolean: true },
  { name: 'force', boolean: true },
  { name: 'json', boolean: true },
  { name: 'tool', boolean: false },
];

/** §21: `--tool <name>` emits a tool-specific copy of AGENTS.md. */
const KNOWN_TOOLS = ['claude', 'cursor'];

export function parseInitArgs(args: string[]): InitArgs {
  const parsed = parseArgs(args, INIT_FLAGS);
  const folders = parsed.flags.has('folders');
  const flat = parsed.flags.has('flat');
  const tool = parsed.flags.get('tool');
  return {
    flat: flat || !folders,
    folders,
    bare: parsed.flags.has('bare'),
    force: parsed.flags.has('force'),
    json: parsed.flags.has('json'),
    tool: typeof tool === 'string' ? tool : null,
    errors: parsed.errors,
  };
}

// Dense, clean spec stubs (parents have 2+ children, texts 3..120 chars, depth <= 5).
const SPEC_STUBS: Array<{ name: string; content: string }> = [
  { name: '00-overview.md', content: '- Overview\n  - Product: TBD\n  - Users: TBD\n  - Status: draft\n' },
  { name: '01-architecture.md', content: '- Architecture\n  - Stack: TBD\n  - Layers: TBD\n  - Boundaries: TBD\n  - Principles: TBD\n' },
  { name: '02-authentication.md', content: '- Authentication\n  - Sign up: TBD\n  - Sessions: TBD\n  - Passwords: TBD\n' },
  { name: '03-data.md', content: '- Data\n  - Storage: TBD\n  - Schema: TBD\n  - Backups: TBD\n  - Retention: TBD\n' },
  { name: '04-api.md', content: '- API\n  - Endpoints: TBD\n  - Auth: TBD\n  - Errors: TBD\n  - Rate limits: TBD\n' },
  { name: '05-frontend.md', content: '- Frontend\n  - Framework: TBD\n  - Routes: TBD\n  - State: TBD\n' },
  { name: '06-operations.md', content: '- Operations\n  - Deployment: TBD\n  - Environments: TBD\n  - Monitoring: TBD\n  - Runbooks: TBD\n' },
];

interface PlanEntry {
  path: string;
  dir: boolean;
  content: string | null;
}

/** §21: "Refuses if already inside a `cans/` directory" — at any depth
 *  (`<root>/cans` as well as `<root>/cans/_collab`). */
function insideCansDirectory(): boolean {
  let dir = process.cwd();
  for (;;) {
    if (basename(dir) === 'cans' && dirExists(dir)) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

function initRefusal(error: string): InitResult {
  return { ok: false, command: 'init', exitCode: 1, created: [], skipped: [], root: '', error };
}

export async function run(args: string[]): Promise<InitResult> {
  const opts = parseInitArgs(args);

  // §20/§37: unknown or malformed flags are never silently ignored.
  if (opts.errors.length > 0) {
    return initRefusal(opts.errors[0]);
  }

  // §21/§37: an unrecognized --tool value must be surfaced, not dropped.
  if (opts.tool !== null && !KNOWN_TOOLS.includes(opts.tool)) {
    return initRefusal(`unknown tool "${opts.tool}" — supported tools: ${KNOWN_TOOLS.join(', ')}`);
  }

  // §21: refuse when standing anywhere inside a cans/ directory.
  if (insideCansDirectory()) {
    return initRefusal('already inside a cans/ workspace — cd to the project root first');
  }

  // Idempotent: an existing workspace (walk-up `cans/` or scratch) is re-used —
  // existing files are skipped unless --force. Architecture §21.
  const existing = resolveWorkspaceRoot();
  const workspace = existing ?? join(resolveInitTarget(), 'cans');
  mkdirp(workspace);

  const rulesContent = await readTemplate('_rules.yaml');
  const agentsContent = await readTemplate('AGENTS.md');
  let agentOutside = false;

  const plan: PlanEntry[] = [
    { path: '_rules.yaml', dir: false, content: rulesContent },
    { path: 'AGENTS.md', dir: false, content: agentsContent },
  ];

  // Spec stubs: flat files by default; --folders keeps 00-overview.md flat
  // and puts numbered specs into NN-name/index.md folders. §8: "Flat wins over
  // folder" — when the flat file already exists, never manufacture a folder
  // twin beside it (duplicate canonical home).
  for (const stub of SPEC_STUBS) {
    if (opts.bare && stub.name !== '00-overview.md') continue;
    const folderMode = opts.folders && /^(?!00-)\d{2}-/.test(stub.name);
    const path = folderMode && !exists(join(workspace, stub.name))
      ? `${stub.name.slice(0, -3)}/index.md`
      : stub.name;
    plan.push({ path, dir: false, content: stub.content });
  }

  if (!opts.bare) {
    plan.push({ path: '_adr', dir: true, content: null });
    plan.push({ path: '_tasks', dir: true, content: null });
    plan.push({ path: '_collab/handoffs.md', dir: false, content: '- handoffs\n' });
    plan.push({ path: '_collab/conflicts.md', dir: false, content: '- conflicts\n' });
    plan.push({ path: '_collab/decisions.md', dir: false, content: '- decisions\n' });
  } else {
    // --bare (§21 "minimal"): the workspace stays lean (specs + _rules.yaml);
    // agent instructions are emitted at the project root, beside cans/, so the
    // workspace contains no agent-facing .md alongside the spec stubs.
    agentOutside = true;
  }

  if (opts.tool === 'claude') {
    plan.push({ path: 'CLAUDE.md', dir: false, content: agentsContent });
  } else if (opts.tool === 'cursor') {
    plan.push({ path: '.cursorrules', dir: false, content: agentsContent });
  }

  const created: string[] = [];
  const skipped: string[] = [];
  for (const entry of plan) {
    const abs = join(agentOutside && entry.path === 'AGENTS.md'
      ? dirname(workspace) // --bare: AGENTS.md lives beside cans/, not inside it
      : workspace, entry.path);
    if (entry.dir) {
      const label = `${entry.path}/`;
      if (dirExists(abs)) {
        skipped.push(label);
      } else {
        mkdirp(abs);
        created.push(label);
      }
      continue;
    }
    if (exists(abs) && !opts.force) {
      skipped.push(entry.path);
      continue;
    }
    await Bun.write(abs, entry.content ?? '');
    created.push(entry.path);
  }

  // §35 init.json fixture: `root` is the relative display form ("./cans").
  // Programmatic (non-JSON) callers keep the absolute path for path joins.
  let root = workspace;
  if (opts.json) {
    const relRoot = relative(process.cwd(), workspace) || '.';
    root = relRoot.startsWith('.') ? relRoot : `./${relRoot}`;
  }

  return { ok: true, command: 'init', exitCode: 0, created, skipped, root };
}
