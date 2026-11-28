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
  /** The release check, `package-pipeline/release-check.mjs`'s command, before the package folder. */
  readonly releaseCheck: readonly string[];
  /** The release check as an answer names it. */
  readonly releaseShown: string;
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
  /** What the tools' descriptions say of this place, so that none names what is not there. */
  readonly words: Words;
}

export interface Words {
  /** A package folder, as an example. */
  readonly packageExample: string;
  /** A demo kit's package folder, as an example. */
  readonly kitExample: string;
  /** The folder the write tools write a package in, unless configured otherwise. */
  readonly packageRoot: string;
  /** What the pipeline is, in a description. */
  readonly pipeline: string;
  /** Where the pipeline's steps are described. */
  readonly steps: string;
  /** How a package is checked with a server's model. */
  readonly withModel: string;
  /** The platform version a package is checked against unless another is given. */
  readonly platformDefault: string;
  /** How the generators are run elsewhere, for a description of apply_generator. */
  readonly generators: string;
  /** Where a task form's file and fields are described. */
  readonly taskForms: string;
  /** Whether preview_package serves here. */
  readonly preview: boolean;
  /** What release_check takes as the package as it was installed. */
  readonly previous: string;
}

const HERE = fileURLToPath(new URL('.', import.meta.url));

function repositoryHost(): Host {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  return {
    kind: 'repository',
    root,
    pipeline: [join(root, 'scripts', 'app-package.mjs')],
    pipelineShown: 'node scripts/app-package.mjs',
    releaseCheck: [join(root, 'scripts', 'app-release-check.mjs')],
    releaseShown: 'node scripts/app-release-check.mjs',
    packageRoot: join(root, 'business-apps', 'packages'),
    generators: join(root, 'tools', 'satori-generators', 'src'),
    generatorRoot: root,
    runner: join(HERE, 'run-generator.ts'),
    platform: { file: join(root, 'libs', 'platform', 'package.json'), shown: 'libs/platform' },
    modelExport:
      '`npm run app-package:model -- --server <address> --out tmp/content-model.json`, into the checkout (its tmp/ is ignored by git)',
    words: {
      packageExample: 'business-apps/packages/acme-contracts',
      kitExample: 'business-apps/packages/moves-demo',
      packageRoot: 'business-apps/packages/',
      pipeline: 'scripts/app-package.mjs',
      steps: 'steps 1 to 6 of docs/business-apps/package-pipeline.md',
      withModel: 'npm run app-package takes --model',
      platformDefault: "libs/platform's",
      generators: 'as npx nx g ./tools/satori-generators:<generator> would',
      taskForms: ' (docs/business-apps/app-definition-v2.md, section 6)',
      preview: true,
      previous: 'a package folder, as app-upgrade-check.mjs takes one',
    },
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
    releaseCheck: [join(tool, 'satori.mjs'), 'release-check'],
    releaseShown: 'satori release-check',
    packageRoot: join(root, 'config-packages'),
    generators: join(carried, 'tools', 'satori-generators', 'src'),
    generatorRoot: carried,
    runner: join(tool, 'mcp-generator.mjs'),
    platform: { file: join(tool, 'platform', 'platform.json'), shown: "the tool's platform" },
    modelExport:
      "`satori model pull --server <address> --out content-model.json`, kept out of git if it is a customer's",
    words: {
      packageExample: 'config-packages/acme-contracts',
      kitExample: 'config-packages/acme-demo',
      packageRoot: 'config-packages/',
      pipeline: 'satori build, the steps satori validate takes',
      steps: "the package pipeline's steps 1 to 6",
      withModel: 'satori validate takes --model',
      platformDefault: 'the one @nuxeo/satori-cli carries',
      generators: "with each generator's options named as its schema names them",
      taskForms: '',
      preview: false,
      previous: 'a package folder, or the zip it was built into',
    },
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
