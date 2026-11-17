import { workspaceRoot } from '@nx/devkit';
import { join } from 'node:path';

/**
 * This module's own directory, or `undefined` when it was loaded as an ES module.
 *
 * `scripts/build-platform-generators.mjs` compiles these sources to CommonJS for
 * `@nuxeo/satori-platform` — the copy every customer runs — and there `__dirname` is defined.
 * Nx loads the TypeScript source a different way: since Nx 23, `loadTsFile` prefers Node's
 * native type stripping, which gives the module ESM semantics, and ESM has no `__dirname`.
 *
 * `typeof` rather than a bare reference: in ESM the name is not merely unset, it is undeclared,
 * so reading it throws `ReferenceError`.
 */
function moduleDir(): string | undefined {
  return typeof __dirname === 'undefined' ? undefined : __dirname;
}

/**
 * The `files/` template directory of a generator, given the directory of *this* module — or
 * `undefined` when there is none, because the module was loaded as ESM.
 *
 * Separate from `generatorFilesDir` and exported for one reason: it is the only way to test the
 * ESM branch. A default parameter value is applied when the argument is `undefined`, whether it
 * was omitted or passed explicitly, so a single function with `here = moduleDir()` cannot be
 * driven down that branch from a test at all — vitest defines `__dirname`, the default wins, and
 * a test that passes `undefined` silently asserts the CommonJS branch twice. It passes, because
 * both branches resolve to the same directory in this repository, which is exactly how such a
 * test escapes notice (Copilot caught this on PR #575).
 *
 * `__dirname` cannot be stubbed to reach the branch instead: it is a module-scoped binding in
 * CommonJS, not a property of `globalThis`.
 *
 * Only this repository ever runs the TypeScript source — a customer's workspace has no `tools/`
 * — so the ESM branch can name the in-repo location, anchored on Nx's own `workspaceRoot`.
 *
 * @param here this module's own directory: `src/util` in the repository, `generators/util` in the
 *   published package. In both layouts the generators sit beside its parent.
 * @param generator the generator's directory name, e.g. `config-package`
 */
export function filesDirFrom(here: string | undefined, generator: string): string {
  return here === undefined
    ? join(workspaceRoot, 'tools', 'satori-generators', 'src', generator, 'files')
    : join(here, '..', generator, 'files');
}

/**
 * The `files/` template directory of a generator, resolved whether this module was loaded as
 * CommonJS or as ESM.
 *
 * `generateFiles(tree, join(__dirname, 'files'), …)` threw `ReferenceError: __dirname is not
 * defined` on every run of the command `docs/extension-reference.md` documents —
 * `npx nx g ./tools/satori-generators:config-package acme-config --owner=acme` — while the
 * published copy worked, so the suite and the customer path both stayed green (NXSAT-795).
 *
 * `NX_PREFER_NODE_STRIP_TYPES=false` puts Nx back on the swc/ts-node path, where `__dirname`
 * exists, but a documented command should not need an environment variable.
 */
export function generatorFilesDir(generator: string): string {
  return filesDirFrom(moduleDir(), generator);
}
