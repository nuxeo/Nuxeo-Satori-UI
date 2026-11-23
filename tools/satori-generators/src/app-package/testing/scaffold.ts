import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { workspaceRoot, type Tree } from '@nx/devkit';

/**
 * What the business-app generators' specs share: a fictional content model, and running this
 * repository's validator and package pipeline on what a generator wrote, as commands, the way CI
 * and the Builder MCP server's `validate_package` run them.
 */

/** A fictional model: a Contract type, a Counterparty, a Memo with only Nuxeo's own schemas. */
export const CONTRACTS_MODEL = join(
  workspaceRoot,
  'tools',
  'satori-generators',
  'src',
  'app-package',
  'testing',
  'contracts-model.json',
);

/** The Payers kit's content model, the stand-in model as a local Nuxeo exported it. Read only. */
export const PAYERS_MODEL = join(
  workspaceRoot,
  'business-apps',
  'packages',
  'payers-claims-demo',
  'content-model.json',
);

const PIPELINE = join(workspaceRoot, 'scripts', 'app-package.mjs');
const VALIDATOR = join(workspaceRoot, 'libs', 'shared', 'app-definition', 'src', 'bin.mjs');

/** Every file the tree holds under `root`, written beneath `target`, as a package on disk. */
export function flush(tree: Tree, root: string, target: string): void {
  for (const change of tree.listChanges()) {
    if (change.type === 'DELETE' || !change.path.startsWith(`${root}/`) || !change.content)
      continue;
    const file = join(target, change.path.slice(root.length + 1));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, change.content);
  }
}

export interface Run {
  readonly status: number | null;
  readonly output: string;
}

function run(args: string[]): Run {
  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    cwd: workspaceRoot,
    // The pipeline needs no credential, and must not be handed one.
    env: Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !/^NUXEO_(USER|PASS)$/i.test(name)),
    ),
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/** `npm run app-package -- <directory> ...flags`, as a command. */
export function pipeline(directory: string, flags: string[] = []): Run {
  return run([PIPELINE, directory, ...flags]);
}

/** `npm run app-definition:validate -- <path> ...flags`, as a command. */
export function validate(path: string, flags: string[] = []): Run {
  return run([VALIDATOR, 'validate', path, ...flags]);
}
