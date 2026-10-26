import {
  addProjectConfiguration,
  generateFiles,
  names,
  updateProjectConfiguration,
  type ProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import { join } from 'node:path';

export interface ConfigPackageSchema {
  name: string;
  owner: string;
  title?: string;
  vendor?: string;
  version?: string;
  presales?: boolean;
  directory?: string;
  force?: boolean;
}

/** `acme-insurance` → `Acme Insurance`. */
function titleCase(kebab: string): string {
  return kebab
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Scaffold a configuration package: the Marketplace package a customer ships to configure Nuxeo
 * Satori, instead of editing a file on the server or a document in the repository.
 *
 * ## What it generates, and why each part is there
 *
 * - `package/package.xml` depends on `nuxeo-agentic-ui`, which orders **installation**: Nuxeo
 *   refuses the package on a server without ours, and reinstalls it around an upgrade of ours.
 * - `bundle/OSGI-INF/<name>-config.xml` `<require>`s `org.nuxeo.agentic.ui.config.defaults`,
 *   which orders **contributions**, so every fragment here is applied after our defaults. Both
 *   declarations are needed; either alone leaves the order to chance.
 * - `bundle/agentic-ui-config/{bootstrap,manifest}.json` are the fragments, with `$schema`
 *   pointing at `schema/`, so an editor validates them while they are written and reviewed.
 * - `build.mjs`, run by the `build` target, checks the fragments the way the server will and
 *   writes the installable zip. It has no dependencies, so the package builds on any machine with
 *   Node and reaches a server only as a reviewed artifact.
 *
 * `create.mjs` beside this file writes the same files with Node alone, for anyone without this
 * workspace's install — which needs a GitHub Packages token. `create.spec.ts` holds the two to the
 * same bytes.
 *
 * ## What it deliberately does not do
 *
 * It declares no minimum version of `nuxeo-agentic-ui`: every published build is currently
 * `2026.0.1-<timestamp>`, so there is no version that separates a build with the configuration
 * service from one without it. The README says what that means for the customer.
 *
 * It does not run Prettier over what it writes. `create.mjs` cannot, and Prettier's output depends
 * on the input — it rewrites `*Claims*` in a title as `_Claims_` and breaks a long `outputs` path
 * onto its own line — so the two would differ for options no test happened to try. The templates
 * are kept as Prettier formats them instead.
 */
export default async function configPackageGenerator(tree: Tree, options: ConfigPackageSchema) {
  const parentDirectory = options.directory ?? 'config-packages';
  // Both paths go into the `build` target's command line unquoted, which is portable across
  // shells only while they hold nothing a shell would split or interpret — and nothing `node`
  // would read as an option, which a leading "-" is.
  const segments = parentDirectory.split('/');
  if (
    !segments.every(
      (segment) => /^[A-Za-z0-9._][A-Za-z0-9._-]*$/.test(segment) && !/^\.\.?$/.test(segment),
    )
  ) {
    throw new Error(
      `--directory "${parentDirectory}" must be a relative path of letters, digits, ".", "_" and "-" separated by "/", no part starting with "-".`,
    );
  }
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(options.name)) {
    throw new Error(`"${options.name}" must be kebab-case, e.g. acme-config.`);
  }
  // The name is also the fragment name, which the server accepts up to 128 characters.
  if (options.name.length > 128) {
    throw new Error(
      `"${options.name}" is ${options.name.length} characters; a fragment name may have at most 128.`,
    );
  }
  // The schema says the same, but only the CLI applies it; a caller of this function would not.
  if (!/^[a-z][a-z0-9]*$/.test(options.owner)) {
    throw new Error(`--owner "${options.owner}" must be lower-case letters and digits.`);
  }
  if (
    options.version !== undefined &&
    !/^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$/.test(options.version)
  ) {
    throw new Error(`--version "${options.version}" must be like 1.0.0 or 1.0.0-rc.1.`);
  }
  const name = names(options.name);
  const projectRoot = `${parentDirectory}/${name.fileName}`;

  if (tree.exists(projectRoot) && !options.force) {
    throw new Error(
      `${projectRoot} already exists. Choose another name, delete the directory, or pass --force to overwrite the generated files.`,
    );
  }

  const title = options.title?.trim() || titleCase(name.fileName);
  const component = `${options.owner}.config.${name.fileName}`;

  const substitutions = {
    name: name.fileName,
    owner: options.owner,
    component,
    title,
    vendor: options.vendor?.trim() || title,
    version: options.version ?? '1.0.0',
    presales: options.presales === true,
    projectRoot,
    tmpl: '',
  };

  const configure = tree.exists(`${projectRoot}/project.json`)
    ? updateProjectConfiguration
    : addProjectConfiguration;
  const config: ProjectConfiguration = {
    root: projectRoot,
    projectType: 'library',
    tags: ['scope:customer', 'type:config'],
    targets: {
      build: {
        executor: 'nx:run-commands',
        cache: true,
        inputs: ['{projectRoot}/**/*'],
        outputs: [`{workspaceRoot}/dist/${projectRoot}`],
        options: {
          cwd: '{workspaceRoot}',
          command: `node ${projectRoot}/build.mjs --out dist/${projectRoot}`,
        },
      },
    },
  };
  configure(tree, name.fileName, config);

  generateFiles(tree, join(__dirname, 'files'), projectRoot, substitutions);

  return () => {
    console.log(`
Generated ${projectRoot}

  Marketplace package:  ${name.fileName} ${substitutions.version}
  Nuxeo component:      ${component}

Edit the fragments in ${projectRoot}/bundle/agentic-ui-config/, then build and install:

  npx nx build ${name.fileName}
  nuxeoctl mp-install dist/${projectRoot}/${name.fileName}-${substitutions.version}.zip

Everything in a fragment is served WITHOUT authentication — put nothing secret in it.
Raise the version in package/package.xml for every change you install, or Nuxeo will
treat the zip as the package it already has.
`);
  };
}
