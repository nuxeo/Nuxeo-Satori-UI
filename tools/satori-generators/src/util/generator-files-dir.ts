import { workspaceRoot } from '@nx/devkit';
import { join } from 'node:path';

/**
 * The `files/` template directory of a generator, resolved whether this module was loaded as
 * CommonJS or as ESM.
 *
 * `scripts/build-platform-generators.mjs` compiles these sources to CommonJS for
 * `@nuxeo/satori-platform` — the copy every customer runs — and there `__dirname` is this
 * module's own directory. Nx loads the TypeScript source a different way: since Nx 23,
 * `loadTsFile` prefers Node's native type stripping, which gives the module ESM semantics, and
 * ESM has no `__dirname`. `generateFiles(tree, join(__dirname, 'files'), …)` therefore threw
 * `ReferenceError: __dirname is not defined` on every run of the command
 * `docs/extension-reference.md` documents —
 * `npx nx g ./tools/satori-generators:config-package acme-config --owner=acme` — while the
 * published copy worked, so the suite and the customer path both stayed green (NXSAT-795).
 *
 * `NX_PREFER_NODE_STRIP_TYPES=false` puts Nx back on the swc/ts-node path, where `__dirname`
 * exists, but a documented command should not need an environment variable.
 *
 * Only this repository ever runs the TypeScript source: a customer's workspace has no `tools/`.
 * So the ESM branch can name the in-repo location, anchored on Nx's own `workspaceRoot`.
 *
 * @param generator the generator's directory name, e.g. `config-package`
 * @param here this module's own directory. A parameter so a test can reach both branches —
 *   `generator-files-dir.spec.ts` asserts they resolve to the same place. No caller passes it.
 */
export function generatorFilesDir(
  generator: string,
  here: string | undefined = typeof __dirname === 'undefined' ? undefined : __dirname,
): string {
  // `here` is this module's own directory — `src/util` in the repository, `generators/util` in
  // the published package — so the generators sit beside its parent in both layouts.
  return here === undefined
    ? join(workspaceRoot, 'tools', 'satori-generators', 'src', generator, 'files')
    : join(here, '..', generator, 'files');
}
