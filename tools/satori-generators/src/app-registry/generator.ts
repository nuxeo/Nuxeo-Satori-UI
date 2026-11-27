import { formatFiles, type Tree } from '@nx/devkit';

import {
  contributeApp,
  readAppPackage,
  uncontributeMissingLayouts,
} from '../app-package/package-files';

export interface AppRegistrySchema {
  package: string;
}

/**
 * Have the package's component contribute its app to the app registry in nuxeo-agentic-core
 * (docs/business-apps/app-definition-v2.md, section 10): the `<app id src>` element, from
 * `agentic-ui-config/app.json` under its id, naming every file of the app definition the registry
 * serves, `home.json`, `navigation.json`, `actions.json`, `queues/<id>.json`, `labels/<lang>.json`
 * and `tasks/<workflow>.<step>.layout.json`, as the package pipeline's step 2 requires.
 *
 * Without it, "Switch app" cannot list the app on a server: the registry serves an app only as a
 * component names it. `app-package` writes it; `app-layout`, `app-form`, `app-queue` and
 * `app-action` keep it in step when they add a file. Run this one for a package that has none, and
 * after writing a file by hand, such as the home, the menu or a task form: it adds the files the
 * element does not name yet, and takes out those the package no longer holds. Layouts are not the
 * registry's: each is a `<layout>` of its own (app-layout, app-form), and one whose file the
 * package no longer holds, removed with the write tools, is taken out of the component here too.
 *
 * The registry serves the app to the groups its `app.json` names, after sign-in. That is not a
 * security control: Nuxeo's permissions still decide which records anyone reads.
 */
export default async function appRegistryGenerator(tree: Tree, options: AppRegistrySchema) {
  const pkg = readAppPackage(tree, options.package);
  const layouts = uncontributeMissingLayouts(tree, pkg);
  const result = contributeApp(tree, pkg, { create: true });

  await formatFiles(tree);

  return () => {
    const changes = [
      ...(result.added.length > 0 ? [`  Now names:      ${result.added.join(', ')}`] : []),
      ...(result.removed.length > 0 ? [`  No longer names: ${result.removed.join(', ')}`] : []),
      ...(layouts.length > 0
        ? [`  No longer contributes the layouts, whose files are gone: ${layouts.join(', ')}`]
        : []),
    ];
    console.log(`
${
  result.status === 'written'
    ? `${pkg.component} contributes the app ${pkg.appId} to the app registry`
    : result.status === 'unchanged'
      ? `${pkg.component} already names every file of the app ${pkg.appId}`
      : `${pkg.component}'s <app> is in step with the package`
}

  Files:  ${result.files.length === 0 ? 'none besides app.json' : result.files.join(', ')}
${changes.length > 0 ? `${changes.join('\n')}\n` : ''}
On a server, the registry serves it after sign-in to the groups its app.json names. Check it with:

  npm run app-package -- ${pkg.root} --platform <platform version>
`);
  };
}
