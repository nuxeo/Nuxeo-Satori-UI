/**
 * One run of an app generator, bundled into `@nuxeo/satori-cli` as `mcp-generator.mjs`: what
 * `run-generator.ts` does in this repository, where Nx and `tsx` are installed, with neither.
 *
 *   node mcp-generator.mjs <request.json>
 *
 * - **The generators are bundled,** the same sources as `tools/satori-generators`'s, by name
 *   (`satori:generators`, which `bundle.mjs` writes): nothing is loaded by a path, and nothing of a
 *   package is loaded.
 * - **Their `@nx/devkit` is `devkit.ts`,** and their tree `tree.ts`, which read the staging copy
 *   under the package's path and the carried root, `generators/`, everywhere else.
 * - **Everything else is `generator-process.ts`'s,** as for the runner in this repository: what
 *   the generator prints kept for the answer, its changes listed, then the tree locked.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GENERATORS } from 'satori:generators';
import {
  runGeneratorProcess,
  stagedPath,
  type GeneratorFactory,
  type GeneratorRequest,
} from '../generator-process.ts';
import { useFormatting, useWorkspaceRoot, type Formatting } from './devkit.ts';
import { GeneratorTree } from './tree.ts';

await runGeneratorProcess({
  tree(request: GeneratorRequest) {
    useWorkspaceRoot(request.root);
    useFormatting(
      JSON.parse(readFileSync(join(request.root, 'formatting.json'), 'utf8')) as Formatting,
    );
    class StagedTree extends GeneratorTree {
      where(path: string): string {
        return stagedPath(request, this.normalize(path));
      }
      override fsReadDir(path: string): string[] {
        try {
          return readdirSync(this.where(path));
        } catch {
          return [];
        }
      }
      override fsIsFile(path: string): boolean {
        return statSync(this.where(path)).isFile();
      }
      override fsReadFile(path: string): Buffer {
        return readFileSync(this.where(path));
      }
      override fsExists(path: string): boolean {
        try {
          const entry = statSync(this.where(path));
          return entry.isFile() || entry.isDirectory();
        } catch {
          return false;
        }
      }
    }
    return new StagedTree(request.treeRoot);
  },
  factory(request: GeneratorRequest): GeneratorFactory {
    const generator = Object.hasOwn(GENERATORS, request.generator)
      ? GENERATORS[request.generator]
      : undefined;
    if (typeof generator !== 'function')
      throw new Error(`${request.generator} is not a generator this tool carries.`);
    return generator as GeneratorFactory;
  },
});
