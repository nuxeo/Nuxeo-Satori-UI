import { formatFiles, generateFiles, names, type Tree } from '@nx/devkit';

import { generatorFilesDir } from '../util/generator-files-dir';
import { libraryContext } from '../util/library-context';
import { assertIdAbsent, insertAboveMarker } from '../util/splice';

export interface ExtensionComponentSchema {
  name: string;
  library: string;
  surface?: string;
}

/**
 * Scaffold a standalone component and register it by ID.
 *
 * Registered **behind a dynamic import**, which is the property that makes this
 * worth generating rather than hand-writing: the chunk is only fetched if something
 * actually places the component, so a library can offer twenty panels and cost
 * nothing until a manifest uses one.
 *
 * The component is deliberately **not** exported from the library's `index.ts`. A
 * host that could import the class would depend on a name that should stay free to
 * change; it gets the component through `ExtensionOutletComponent` and the ID
 * instead. That indirection is the contract, not an inconvenience.
 */
export default async function extensionComponentGenerator(
  tree: Tree,
  options: ExtensionComponentSchema,
) {
  const context = libraryContext(tree, options.library);
  const name = names(options.name);
  const surface = options.surface ?? 'panel';
  const componentId = `${context.owner}.${surface}.${name.propertyName}`;
  const dir = `${context.root}/src/lib/${name.fileName}`;

  assertIdAbsent(tree, context.extensionsFile, componentId);
  if (tree.exists(dir)) {
    throw new Error(`${dir} already exists. Choose another name, or delete the directory.`);
  }

  generateFiles(tree, generatorFilesDir('extension-component'), dir, {
    ...name,
    owner: context.owner,
    componentId,
    projectName: context.projectName,
    tmpl: '',
  });

  insertAboveMarker(tree, context.extensionsFile, 'satori:ids:components', [`'${componentId}',`]);

  insertAboveMarker(tree, context.extensionsFile, 'satori:register:components', [
    `'${componentId}': () =>`,
    `  import('./${name.fileName}/${name.fileName}').then((m) => m.${name.className}Component),`,
  ]);

  await formatFiles(tree);

  return () => {
    console.log(`
Registered ${componentId}

  component  ${dir}/${name.fileName}.ts  (${name.className}Component)
  loaded     lazily — the chunk is only fetched if something places it

It is registered but not yet *placed*. Two ways to get it on screen:

  Layer 1, from a manifest — no rebuild:
    "slots": { "sidebar": [{ "id": "${context.owner}.sidebar.${name.propertyName}",
                             "label": "${name.className}",
                             "component": "${componentId}" }] }

  Or a host route, resolving it from the registry by ID:
    { path: '${name.fileName}', component: ExtensionOutletComponent,
      data: { componentId: '${componentId}' } }

Deliberately NOT exported from index.ts — a host resolves it by ID, so the class
name stays free to change.

Next:
  1. Assert in src/lib/extensions.spec.ts that
     \`ExtensionComponentRegistry.has('${componentId}')\` is true.
  2. npx nx test ${context.projectName}
     npx nx typecheck ${context.projectName}
`);
  };
}
