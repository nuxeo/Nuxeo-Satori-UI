/**
 * One run of an app generator, in a process of its own, for `apply_generator` and
 * `apply_package_changes` (package-writes.ts). It writes nothing but its answer:
 *
 *   node tools/builder-mcp/src/run-generator.ts <request.json>
 *
 * - **The generator is this repository's.** The request names a factory under
 *   `tools/satori-generators/src/`, which the server chose from its own list; it is loaded with
 *   `tsx`, as Nx would load it with its own transpiler, and nothing of the package is loaded.
 * - **It sees the staging copy, not the package.** Its tree reads the repository, except under the
 *   package's path, which it reads from the staging copy the server made: so the generator works
 *   on the package as the earlier steps of the same call left it, and never reads the package
 *   itself.
 * - **It writes nothing.** What the generator writes stays in the tree's memory, and is returned,
 *   each file with its content, for the server to check before anything is written. The callback
 *   a generator returns, which prints what to do next, runs on a locked tree, so it cannot write.
 * - **The tree's root is a folder of its own,** `request.treeRoot`, which holds the repository's
 *   `.prettierrc` and `.editorconfig` and nothing else. Nx's `formatFiles` looks for a prettier
 *   configuration upwards from the tree's root joined with each file it formats, and loads the
 *   nearest, JavaScript included: rooted at the repository, it would look in the package's own
 *   folder first, and run a `prettier.config.mjs` a package holds. Rooted here, it finds the
 *   repository's configuration and nothing of the package. Only the four reads below use the
 *   tree's root, and they go to the repository and the staging copy.
 *
 * The answer goes to the file `request.answer` names, so that stdout and stderr hold only what the
 * generator printed.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { format } from 'node:util';
import { require as tsxRequire } from 'tsx/cjs/api';

export interface GeneratorRequest {
  /** The generator's factory module, an absolute path to its `.ts` file. */
  readonly factory: string;
  readonly options: Readonly<Record<string, unknown>>;
  /** The repository's root, which the tree reads outside the package's path. */
  readonly root: string;
  /**
   * The tree's own root: a folder holding only the repository's formatting configuration, so that
   * nothing looks for a configuration in the package's folder.
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

interface NxTree {
  normalize(path: string): string;
  listChanges(): { path: string; type: GeneratedChange['type']; content: Buffer | null }[];
  lock(): void;
}
type FsTreeClass = new (root: string, isVerbose: boolean) => NxTree;

const request = JSON.parse(readFileSync(process.argv[2] ?? '', 'utf8')) as GeneratorRequest;
const said: string[] = [];
// Whatever the generator and Nx print is kept for the answer, not written to a stream.
const keep = (...args: unknown[]) => {
  said.push(format(...args));
};
Object.assign(console, { log: keep, info: keep, warn: keep, error: keep, debug: keep });

const answer = (value: GeneratorAnswer) => writeFileSync(request.answer, JSON.stringify(value));

try {
  const load = createRequire(join(request.root, 'package.json'));
  const { FsTree } = load('nx/src/devkit-internals') as { FsTree: FsTreeClass };
  const prefix = request.packagePath;
  /**
   * Nx's own tree, rooted at `treeRoot`, whose four reads of the file system go to the staging copy
   * under the package's path and to the repository everywhere else. Everything else it does, what
   * it records and how it lists the changes, is Nx's.
   */
  class StagedTree extends FsTree {
    where(path: string): string {
      const normal = this.normalize(path);
      if (normal === prefix) return request.staging;
      if (normal.startsWith(`${prefix}/`))
        return join(request.staging, ...normal.slice(prefix.length + 1).split('/'));
      return join(request.root, normal);
    }
    fsReadDir(path: string): string[] {
      try {
        return readdirSync(this.where(path));
      } catch {
        return [];
      }
    }
    fsIsFile(path: string): boolean {
      return statSync(this.where(path)).isFile();
    }
    fsReadFile(path: string): Buffer {
      return readFileSync(this.where(path));
    }
    fsExists(path: string): boolean {
      try {
        const entry = statSync(this.where(path));
        return entry.isFile() || entry.isDirectory();
      } catch {
        return false;
      }
    }
  }
  const tree = new StagedTree(request.treeRoot, false);
  const module = tsxRequire(request.factory, import.meta.url) as {
    default?: (tree: NxTree, options: unknown) => unknown;
  };
  if (typeof module.default !== 'function')
    throw new Error(`${request.factory} exports no generator.`);
  const callback = await module.default(tree, { ...request.options });
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
