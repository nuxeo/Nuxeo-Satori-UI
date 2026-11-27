/**
 * The plugins of a package's custom elements, as check 9 reads them: each plugin library's files,
 * read from the customer's copy of the repository, which is this repository by default. Reading is
 * all this does; running a plugin is `plugin-run.ts`'s.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pluginLibraryOf } from './convert-elements';
import type { Inventory } from './inventory';
import type { ObservedBehaviour } from './observed';
import type { PluginRun } from './plugin-run';

/** The repository this tool sits in: where it reads plugins from unless it is given another. */
export const WORKSPACE = resolve(__dirname, '..', '..', '..');

/** A plugin library as check 9 reads it. */
export interface PluginSource {
  /** The custom element it is the plugin of. */
  readonly element: string;
  /** Its directory, relative to the workspace, `/`-separated. */
  readonly library: string;
  /** Each of its files, by its path under the library, `/`-separated, as text. */
  readonly files: Readonly<Record<string, string>>;
}

/** What check 9 is given beside the package and its conversion. */
export interface PluginsInput {
  /** The workspace the plugins were read from. */
  readonly workspace: string;
  /** One for each custom element whose plugin library is there. */
  readonly sources: readonly PluginSource[];
  /** The template app's configuration, where a plugin is built in, by its path in the workspace. */
  readonly template: { readonly path: string; readonly text: string } | null;
  /** What each element shows on a set of records, for the values half. */
  readonly observed?: ObservedBehaviour;
  /** Each plugin's run, by element: its tests, its gates and what it showed. */
  readonly runs?: Readonly<Record<string, PluginRun>>;
}

/** The app every plugin is built into until plugins load at run time (decision 5). */
export const TEMPLATE_CONFIG = 'apps/nuxeo-satori-template/src/app/app.config.ts';

/** The directories a library's files are never read from: installed packages, and git's own. */
const SKIPPED = new Set(['node_modules', '.git']);

/** Every file of a library, as text, by its path under it; `null` when there is no such directory. */
export function readLibrary(workspace: string, library: string): Record<string, string> | null {
  const root = join(workspace, ...library.split('/'));
  if (!existsSync(root) || !statSync(root).isDirectory()) return null;
  const files: Record<string, string> = {};
  const walk = (directory: string, prefix: string): void => {
    for (const name of readdirSync(directory).sort()) {
      // Dotfiles too: a plugin holds none, and check 9 says so of one it finds.
      if (SKIPPED.has(name)) continue;
      const full = join(directory, name);
      const path = prefix ? `${prefix}/${name}` : name;
      if (statSync(full).isDirectory()) walk(full, path);
      else files[path] = readFileSync(full, 'utf8');
    }
  };
  walk(root, '');
  return files;
}

/** The plugins of the package's custom elements that are in the workspace. */
export function readPlugins(
  workspace: string,
  inventory: Inventory,
  extra: Pick<PluginsInput, 'observed' | 'runs'> = {},
): PluginsInput {
  const sources: PluginSource[] = [];
  for (const element of inventory.customElements) {
    const library = pluginLibraryOf(element);
    const files = readLibrary(workspace, library);
    if (files !== null) sources.push({ element: element.name, library, files });
  }
  const template = join(workspace, ...TEMPLATE_CONFIG.split('/'));
  return {
    workspace,
    sources,
    template: existsSync(template)
      ? { path: TEMPLATE_CONFIG, text: readFileSync(template, 'utf8') }
      : null,
    ...extra,
  };
}
