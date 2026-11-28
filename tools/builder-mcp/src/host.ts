/**
 * Where the server runs, and so where everything outside a package is. It runs in one of two
 * places, decided when it is built and never from the environment:
 *
 * - **In this repository,** as `node tools/builder-mcp/src/main.ts` runs it: the repository is the
 *   root, a package is validated by `scripts/app-package.mjs`, as CI validates it, packages are
 *   written in `business-apps/packages/`, and the generators are `tools/satori-generators`'s,
 *   loaded by `run-generator.ts` with `tsx` and given Nx's tree.
 * - **Bundled into `@nuxeo/satori-cli`,** as `satori mcp` runs it in a customer's configuration
 *   repository (`bundle.mjs`, which defines `SATORI_MCP_BUNDLE`). The folder it is started in is the
 *   root. A package is validated by the tool's own `satori build`, the steps `satori validate`
 *   takes, so that a write the server keeps is one the customer's CI keeps. Packages are written
 *   in `config-packages/`, as `satori create` lays a repository out. The generators are the same
 *   sources, bundled into `mcp-generator.mjs` with a tree of its own (`bundle/tree.ts`), and what
 *   they read outside a package is what the tool carries in `generators/`. The platform's version
 *   is the one the tool carries. `preview_package` needs this repository's development server, and
 *   refuses.
 *
 * Nothing here reads a variable, so nothing in the environment can point the server elsewhere.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Defined as `true` by `bundle.mjs`, and nowhere else: in this repository it is not declared. */
declare const SATORI_MCP_BUNDLE: boolean | undefined;

export interface Host {
  readonly kind: 'repository' | 'configuration';
  /** The repository the server works in, which package paths are relative to. */
  readonly root: string;
  /** The pipeline, as Node's arguments before the package folder. */
  readonly pipeline: readonly string[];
  /** The pipeline as an answer names it. */
  readonly pipelineShown: string;
  /** The folder the write tools write a package in unless `BUILDER_PACKAGE_ROOTS` names others. */
  readonly packageRoot: string;
  /** Where each generator's `<generator>/schema.json` is. */
  readonly generators: string;
  /**
   * The generator process's root: what a generator's tree reads outside the package, its
   * `workspaceRoot`, and the formatting configuration the tree's own root is given.
   */
  readonly generatorRoot: string;
  /** The generator process's entry point. */
  readonly runner: string;
  /** The file the platform's version is read from, and where in it. */
  readonly platform: { readonly file: string; readonly shown: string };
  /** How a customer's model is written to a file, for a refusal that names it. */
  readonly modelExport: string;
}

const HERE = fileURLToPath(new URL('.', import.meta.url));

function repositoryHost(): Host {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  return {
    kind: 'repository',
    root,
    pipeline: [join(root, 'scripts', 'app-package.mjs')],
    pipelineShown: 'node scripts/app-package.mjs',
    packageRoot: join(root, 'business-apps', 'packages'),
    generators: join(root, 'tools', 'satori-generators', 'src'),
    generatorRoot: root,
    runner: join(HERE, 'run-generator.ts'),
    platform: { file: join(root, 'libs', 'platform', 'package.json'), shown: 'libs/platform' },
    modelExport:
      '`npm run app-package:model -- --server <address> --out tmp/content-model.json`, into the checkout (its tmp/ is ignored by git)',
  };
}

/**
 * The bundle's place is the folder of the file this module is bundled into, `mcp.mjs` or
 * `mcp-generator.mjs`, beside `satori.mjs`: the tool's own folder.
 */
function bundledHost(): Host {
  const tool = HERE;
  const root = process.cwd();
  const carried = join(tool, 'generators');
  return {
    kind: 'configuration',
    root,
    pipeline: [join(tool, 'satori.mjs'), 'build'],
    pipelineShown: 'satori build',
    packageRoot: join(root, 'config-packages'),
    generators: join(carried, 'tools', 'satori-generators', 'src'),
    generatorRoot: carried,
    runner: join(tool, 'mcp-generator.mjs'),
    platform: { file: join(tool, 'platform', 'platform.json'), shown: "the tool's platform" },
    modelExport:
      "`satori model pull --server <address> --out content-model.json`, kept out of git if it is a customer's",
  };
}

export const HOST: Host =
  typeof SATORI_MCP_BUNDLE !== 'undefined' && SATORI_MCP_BUNDLE ? bundledHost() : repositoryHost();

/** The repository the server works in: this one, or a customer's configuration repository. */
export const REPO_ROOT = HOST.root;

/** The platform's version, as the pipeline is given it: the one this server checks a package against. */
export function platformVersion(): string {
  const manifest: unknown = JSON.parse(readFileSync(HOST.platform.file, 'utf8'));
  const version =
    manifest && typeof manifest === 'object' && 'version' in manifest ? manifest.version : null;
  if (typeof version !== 'string') throw new Error(`${HOST.platform.shown} has no version`);
  return version;
}
