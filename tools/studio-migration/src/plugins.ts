/**
 * The plugins of a package's custom elements, as check 9 reads them: each plugin library's files,
 * read from the customer's copy of the repository, which is this repository by default. Reading is
 * all this does; running a plugin is `plugin-run.ts`'s.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import * as ts from 'typescript';
import type { PluginFiles } from './approval';
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
  /** The directories under it that are not read, `node_modules` and `.git`, by their path. */
  readonly skipped?: readonly string[];
}

/** What check 9 is given beside the package and its conversion. */
export interface PluginsInput {
  /** The workspace the plugins were read from. */
  readonly workspace: string;
  /** One for each custom element whose plugin library is there. */
  readonly sources: readonly PluginSource[];
  /** The template app's configuration, where a plugin is built in, by its path in the workspace. */
  readonly template: { readonly path: string; readonly text: string } | null;
  /**
   * The import paths the template app is built with, as TypeScript resolves them from its
   * `tsconfig.app.json` and what it extends: each to its files, relative to the workspace.
   * `null` when it cannot be read.
   */
  readonly aliases?: Readonly<Record<string, readonly string[]>> | null;
  /** What each element shows on a set of records, for the values half. */
  readonly observed?: ObservedBehaviour;
  /** Each plugin's run, by element: its tests, its gates and what it showed. */
  readonly runs?: Readonly<Record<string, PluginRun>>;
}

/** The app every plugin is built into until plugins load at run time (decision 5). */
export const TEMPLATE_CONFIG = 'apps/nuxeo-satori-template/src/app/app.config.ts';

/** The TypeScript configuration the template app is built and type-checked with (`angular.json`). */
export const TEMPLATE_TSCONFIG = 'apps/nuxeo-satori-template/tsconfig.app.json';

/** The directories a library's files are never read from: installed packages, and git's own. */
const SKIPPED = new Set(['node_modules', '.git']);

/** Every file of a library, as text, by its path under it; `null` when there is no such directory. */
export function readLibrary(workspace: string, library: string): Record<string, string> | null {
  return readLibraryWhole(workspace, library)?.files ?? null;
}

/** A library's files, and the directories under it that are not read. */
function readLibraryWhole(
  workspace: string,
  library: string,
): { files: Record<string, string>; skipped: string[] } | null {
  const root = join(workspace, ...library.split('/'));
  if (!existsSync(root) || !statSync(root).isDirectory()) return null;
  const files: Record<string, string> = {};
  const skipped: string[] = [];
  const walk = (directory: string, prefix: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const full = join(directory, name);
      const path = prefix ? `${prefix}/${name}` : name;
      // Dotfiles too: a plugin holds none, and check 9 says so of one it finds. What is not read
      // is named, and check 9 refuses it too, since nothing then holds what it holds.
      if (SKIPPED.has(name)) {
        skipped.push(path);
        continue;
      }
      if (statSync(full).isDirectory()) walk(full, path);
      else files[path] = readFileSync(full, 'utf8');
    }
  };
  walk(root, '');
  return { files, skipped };
}

/** The template app's import paths, as TypeScript resolves them (`PluginsInput.aliases`). */
export function templateAliases(workspace: string): Record<string, string[]> | null {
  const file = join(workspace, ...TEMPLATE_TSCONFIG.split('/'));
  if (!existsSync(file)) return null;
  const parsed = ts.getParsedCommandLineOfConfigFile(
    file,
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined },
  );
  if (!parsed) return null;
  const options = parsed.options as ts.CompilerOptions & { readonly pathsBasePath?: string };
  const base = options.baseUrl ?? options.pathsBasePath ?? dirname(file);
  return Object.fromEntries(
    Object.entries(options.paths ?? {}).map(([key, targets]) => [
      key,
      targets.map((target) => relative(workspace, resolve(base, target)).split(sep).join('/')),
    ]),
  );
}

/**
 * The files of each plugin library as check 9 read them, for the approval to be held to
 * (`approval.ts`): those it ran, from `check --run-plugins`. `undefined` when the plugins were not
 * read, so nothing is held to them.
 */
export function pluginFilesOf(plugins: PluginsInput | undefined): PluginFiles | undefined {
  if (!plugins) return undefined;
  return (library) => plugins.sources.find((source) => source.library === library)?.files ?? null;
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
    const read = readLibraryWhole(workspace, library);
    if (read !== null)
      sources.push({
        element: element.name,
        library,
        files: read.files,
        ...(read.skipped.length > 0 ? { skipped: read.skipped } : {}),
      });
  }
  const template = join(workspace, ...TEMPLATE_CONFIG.split('/'));
  return {
    workspace,
    sources,
    template: existsSync(template)
      ? { path: TEMPLATE_CONFIG, text: readFileSync(template, 'utf8') }
      : null,
    aliases: templateAliases(workspace),
    ...extra,
  };
}
