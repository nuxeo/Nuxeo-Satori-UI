/**
 * One run of an app generator, in a process of its own: what `run-generator.ts`, in this
 * repository, and `bundle/run-generator.ts`, bundled into `@nuxeo/satori-cli`, both do. Each gives
 * it a tree and the generator's factory; everything else is here, once:
 *
 * - **The request** is the file the command line names, which the server wrote.
 * - **What the generator prints is kept for the answer,** not written to a stream: `console` is
 *   replaced before the generator is loaded.
 * - **It sees the staging copy, not the package** (`stagedPath`): the tree reads the root, except
 *   under the package's path, which it reads from the staging copy the server made.
 * - **It writes nothing.** What the generator writes stays in the tree's memory, and is returned,
 *   each file with its content, for the server to check before anything is written. The callback a
 *   generator returns, which prints what to do next, runs on a locked tree, so it cannot write.
 *
 * The answer goes to the file `request.answer` names, so that stdout and stderr hold only what the
 * generator printed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { format } from 'node:util';

export interface GeneratorRequest {
  /** The generator, one of the app generators the write tools run. */
  readonly generator: string;
  /** The generator's factory module, an absolute path to its `.ts` file, in this repository. */
  readonly factory: string;
  readonly options: Readonly<Record<string, unknown>>;
  /** The root the tree reads outside the package's path, and the generator's `workspaceRoot`. */
  readonly root: string;
  /**
   * The tree's own root: a folder holding only the formatting configuration, so that nothing looks
   * for a configuration in the package's folder.
   */
  readonly treeRoot: string;
  /** The package's path in the tree, from the root, with `/`. */
  readonly packagePath: string;
  /** The folder the package's path is read from: the staging copy. */
  readonly staging: string;
  /** Where the answer goes. */
  readonly answer: string;
}

export interface GeneratedChange {
  readonly path: string;
  readonly type: 'CREATE' | 'UPDATE' | 'DELETE';
  /** The content, in base64; `null` for a deletion. */
  readonly content: string | null;
}

export type GeneratorAnswer =
  | { readonly changes: readonly GeneratedChange[]; readonly said: readonly string[] }
  | { readonly error: string; readonly said: readonly string[] };

/** What a run needs of a tree: Nx's `FsTree`, or the bundle's own. */
export interface RunTree {
  normalize(path: string): string;
  listChanges(): { path: string; type: GeneratedChange['type']; content: Buffer | null }[];
  lock(): void;
}

export type GeneratorFactory = (tree: RunTree, options: unknown) => unknown;

/**
 * Where the tree reads a path from, `normal` as the tree normalises it: the staging copy under the
 * package's path, and the root everywhere else.
 */
export function stagedPath(request: GeneratorRequest, normal: string): string {
  const prefix = request.packagePath;
  if (normal === prefix) return request.staging;
  if (normal.startsWith(`${prefix}/`))
    return join(request.staging, ...normal.slice(prefix.length + 1).split('/'));
  return join(request.root, normal);
}

/**
 * The run: the request read, `console` kept, the tree and the factory from `use`, the changes
 * listed, the tree locked, the callback run, the answer written.
 */
export async function runGeneratorProcess(use: {
  readonly tree: (request: GeneratorRequest) => RunTree | Promise<RunTree>;
  readonly factory: (request: GeneratorRequest) => GeneratorFactory | Promise<GeneratorFactory>;
}): Promise<void> {
  const request = JSON.parse(readFileSync(process.argv[2] ?? '', 'utf8')) as GeneratorRequest;
  const said: string[] = [];
  // Whatever the generator and its tree print is kept for the answer, not written to a stream.
  const keep = (...args: unknown[]) => {
    said.push(format(...args));
  };
  Object.assign(console, { log: keep, info: keep, warn: keep, error: keep, debug: keep });
  const answer = (value: GeneratorAnswer) => writeFileSync(request.answer, JSON.stringify(value));
  try {
    const tree = await use.tree(request);
    const generator = await use.factory(request);
    const callback = await generator(tree, { ...request.options });
    const changes = tree.listChanges().map((change): GeneratedChange => ({
      path: change.path,
      type: change.type,
      content: change.content === null ? null : Buffer.from(change.content).toString('base64'),
    }));
    tree.lock();
    if (typeof callback === 'function') {
      try {
        await callback();
      } catch (error) {
        said.push(`The generator's closing message failed: ${(error as Error).message}`);
      }
    }
    answer({ changes, said });
  } catch (error) {
    answer({ error: error instanceof Error ? error.message : String(error), said });
  }
}
