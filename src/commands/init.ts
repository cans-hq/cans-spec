import { join } from 'path';
import type { InitResult } from '../types';
import { insideWorkspace, resolveInitTarget, mkdirp, exists, dirExists } from '../core/fs';

export interface InitArgs {
  flat: boolean;
  folders: boolean;
  bare: boolean;
  force: boolean;
  tool: string | null;
}

const TEMPLATES_DIR = join(import.meta.dir, '..', '..', 'templates');

async function readTemplate(name: string): Promise<string> {
  return await Bun.file(join(TEMPLATES_DIR, name)).text();
}

export function parseInitArgs(args: string[]): InitArgs {
  let folders = false;
  let bare = false;
  let force = false;
  let tool: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--folders') folders = true;
    else if (a === '--flat') folders = false;
    else if (a === '--bare') bare = true;
    else if (a === '--force') force = true;
    else if (a === '--tool') tool = args[i + 1] ?? null;
  }
  return { flat: !folders, folders, bare, force, tool };
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

export async function run(args: string[]): Promise<InitResult> {
  const opts = parseInitArgs(args);

  // Refuse when already inside a cans workspace.
  if (insideWorkspace()) {
    return { ok: false, command: 'init', exitCode: 1, created: [], skipped: [], root: '' };
  }

  const target = resolveInitTarget();
  const workspace = join(target, 'cans');
  mkdirp(workspace);

  const rulesContent = await readTemplate('_rules.yaml');
  const agentsContent = await readTemplate('AGENTS.md');

  const plan: PlanEntry[] = [
    { path: '_rules.yaml', dir: false, content: rulesContent },
    { path: 'AGENTS.md', dir: false, content: agentsContent },
  ];

  // Spec stubs: flat files by default; --folders keeps 00-overview.md flat
  // and puts numbered specs into NN-name/index.md folders.
  for (const stub of SPEC_STUBS) {
    if (opts.bare && stub.name !== '00-overview.md') continue;
    const path = opts.folders && /^(?!00-)\d{2}-/.test(stub.name)
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
  }

  if (opts.tool === 'claude') {
    plan.push({ path: 'CLAUDE.md', dir: false, content: agentsContent });
  } else if (opts.tool === 'cursor') {
    plan.push({ path: '.cursorrules', dir: false, content: agentsContent });
  }

  const created: string[] = [];
  const skipped: string[] = [];
  for (const entry of plan) {
    const abs = join(workspace, entry.path);
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

  return { ok: true, command: 'init', exitCode: 0, created, skipped, root: workspace };
}
