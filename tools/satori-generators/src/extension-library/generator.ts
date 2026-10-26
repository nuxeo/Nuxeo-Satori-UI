import {
  addProjectConfiguration,
  formatFiles,
  generateFiles,
  names,
  updateJson,
  updateProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import { join } from 'node:path';

import type { SatoriProjectConfiguration } from '../util/library-context';

export interface ExtensionLibrarySchema {
  name: string;
  owner: string;
  directory?: string;
  tags?: string;
  force?: boolean;
}

/**
 * Scaffold a customer Layer 2 extension library.
 *
 * ## What it generates, and why each part is there
 *
 * A provider calling `provideSatoriExtensions()`, a component contributed by ID,
 * a rule, an action handler, and a **spec that proves the registration actually
 * happened**. The spec is not padding: the whole failure mode this generator
 * exists to prevent is a library that registers descriptors nothing renders, and
 * the only way to know the difference is to assert against the registries.
 *
 * ## What it deliberately does not do
 *
 * It does not touch the platform libraries, the shell, or any manifest. A
 * generated library is inert until an application adds its provider — that is the
 * Layer 2 contract working as intended, not an omission. The generated README says
 * so and gives the one line to add.
 */
export default async function extensionLibraryGenerator(
  tree: Tree,
  options: ExtensionLibrarySchema,
) {
  const parentDirectory = options.directory ?? 'libs/extensions';
  const name = names(options.name);
  const projectRoot = `${parentDirectory}/${name.fileName}`;

  // Refuse by default rather than silently merging into someone's edited library.
  // `--force` exists for the loop of changing a template and regenerating; it
  // overwrites generated paths and leaves anything else in place.
  if (tree.exists(projectRoot) && !options.force) {
    throw new Error(
      `${projectRoot} already exists. Choose another name, delete the directory, or pass --force to overwrite the generated files.`,
    );
  }

  // The alias an application imports. Kept under @agentic-ui rather than
  // @nuxeo-satori because this is *customer* code living in the workspace, not
  // part of the published platform package.
  const importPath = `@agentic-ui/${name.fileName}`;

  // How deep the library sits, so generated tsconfigs and vite configs can
  // reference the workspace root relatively. Computed rather than hardcoded to
  // `../../../`, because `directory` is an option and a wrong depth fails at
  // build time with an error that points at the wrong thing.
  const depth = projectRoot.split('/').length;
  const offsetFromRoot = '../'.repeat(depth);

  // `provide<className>Extensions` reads as `provideAcmeExtensionsExtensions` when
  // the library is already called `acme-extensions`, which is the common case.
  // Strip one trailing `Extensions` so the generated name is the one a customer
  // would have written by hand.
  const baseName = name.className.replace(/Extensions$/, '');
  const providerName = `provide${baseName}Extensions`;

  const substitutions = {
    ...name,
    owner: options.owner,
    providerName,
    baseName,
    projectName: name.fileName,
    projectRoot,
    importPath,
    offsetFromRoot,
    // `generateFiles` strips a trailing `__tmpl__` from filenames. Template files
    // are named `project.json__tmpl__`-style so that nothing inside `files/` is
    // mistaken for a real workspace file by Nx, eslint or vitest.
    tmpl: '',
  };

  // `addProjectConfiguration` refuses when a project already exists at the path,
  // so a `--force` regeneration has to update rather than add.
  const configure = tree.exists(`${projectRoot}/project.json`)
    ? updateProjectConfiguration
    : addProjectConfiguration;

  // Declared as a variable, not passed as a literal: `prefix` is a real project.json
  // field that `library-context.ts` reads back as the owner segment of every registered
  // ID, but it is absent from `ProjectConfiguration` in this Nx version, and TypeScript's
  // excess-property check only fires on a fresh literal.
  const config: SatoriProjectConfiguration = {
    root: projectRoot,
    projectType: 'library',
    sourceRoot: `${projectRoot}/src`,
    prefix: options.owner,
    tags: (options.tags ?? 'scope:customer,type:extension').split(',').map((t) => t.trim()),
    targets: {
      test: {
        executor: '@nx/vitest:test',
        outputs: ['{options.reportsDirectory}'],
        options: { reportsDirectory: `coverage/${projectRoot}` },
      },
      lint: { executor: '@nx/eslint:lint' },
      typecheck: {
        executor: 'nx:run-commands',
        cache: true,
        inputs: ['default', '^default'],
        outputs: [`{workspaceRoot}/dist/out-tsc/${projectRoot}`],
        options: {
          cwd: '{workspaceRoot}',
          command: `ngc -p ${projectRoot}/tsconfig.lib.json --outDir dist/out-tsc/${projectRoot}`,
        },
      },
    },
  };
  configure(tree, name.fileName, config);

  generateFiles(tree, join(__dirname, 'files'), projectRoot, substitutions);

  // Register the import alias, or the application cannot reference the library.
  updateJson(tree, 'tsconfig.base.json', (json) => {
    json.compilerOptions ??= {};
    json.compilerOptions.paths ??= {};
    json.compilerOptions.paths[importPath] = [`${projectRoot}/src/index.ts`];
    // Sorted, matching the rest of the file, so the diff stays reviewable.
    json.compilerOptions.paths = Object.fromEntries(
      Object.entries(json.compilerOptions.paths).sort(([a], [b]) => a.localeCompare(b)),
    );
    return json;
  });

  await formatFiles(tree);

  return () => {
    console.log(`
Generated ${projectRoot}

  Import alias:  ${importPath}
  ID prefix:     ${options.owner}.*

It is inert until an application opts in. Add one line to your app config:

  import { ${providerName} } from '${importPath}';
  // providers: [ ..., ${providerName}() ]

TWO STEPS, not one. The navbar entry points at /${name.fileName} and NOTHING ROUTES
THERE YET, so it falls through your wildcard to /home — a menu item that silently goes
to the wrong page. Add the route to your app as well:

  import { ExtensionOutletComponent } from '@nuxeo/satori-platform/extensions';

  { path: '${name.fileName}',
    component: ExtensionOutletComponent,
    data: { componentId: '${options.owner}.panel.${name.propertyName}' } }

The host maps the path on purpose: this library exports only its provider and its ID
list, so the component class stays free to be renamed without breaking you.

Then verify nothing is registered by accident:

  npx nx test ${name.fileName}
  npx nx typecheck ${name.fileName}
`);
  };
}
