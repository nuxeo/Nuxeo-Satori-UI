/**
 * One run of an app generator, in a process of its own, for `apply_generator` and
 * `apply_package_changes` (package-writes.ts), in this repository. It writes nothing but its
 * answer, and what it does but load the generator and make its tree is `generator-process.ts`'s,
 * which the bundled runner, `bundle/run-generator.ts`, shares:
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
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { require as tsxRequire } from 'tsx/cjs/api';
import {
  runGeneratorProcess,
  stagedPath,
  type GeneratorFactory,
  type GeneratorRequest,
  type RunTree,
} from './generator-process.ts';

export type { GeneratedChange, GeneratorAnswer, GeneratorRequest } from './generator-process.ts';

type FsTreeClass = new (root: string, isVerbose: boolean) => RunTree;

await runGeneratorProcess({
  tree(request) {
    const load = createRequire(join(request.root, 'package.json'));
    const { FsTree } = load('nx/src/devkit-internals') as { FsTree: FsTreeClass };
    /**
     * Nx's own tree, rooted at `treeRoot`, whose four reads of the file system go to the staging
     * copy under the package's path and to the repository everywhere else. Everything else it
     * does, what it records and how it lists the changes, is Nx's.
     */
    class StagedTree extends FsTree {
      where(path: string): string {
        return stagedPath(request, this.normalize(path));
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
    return new StagedTree(request.treeRoot, false);
  },
  factory(request: GeneratorRequest): GeneratorFactory {
    const module = tsxRequire(request.factory, import.meta.url) as { default?: GeneratorFactory };
    if (typeof module.default !== 'function')
      throw new Error(`${request.factory} exports no generator.`);
    return module.default;
  },
});
