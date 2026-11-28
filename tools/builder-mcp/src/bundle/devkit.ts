/**
 * What the app generators import from `@nx/devkit`, in the bundled runner, where Nx is not
 * installed: `bundle.mjs` resolves `@nx/devkit` to this module for `mcp-generator.mjs` alone. Each
 * does what Nx's does, so that a generator writes the same bytes whichever runner ran it:
 *
 * - **`workspaceRoot`** is the carried root the request names, `generators/` beside the tool,
 *   which holds what a generator reads outside a package: its templates, the platform's routes and
 *   version. Set once, before the generator is loaded.
 * - **`formatFiles`** formats every file the tree created or changed with Prettier, the same
 *   version as this repository's, in its standalone build with every one of its own plugins, as
 *   the Prettier Nx loads has them. A file Prettier infers no parser for is left as it is, and one
 *   it cannot format is said and left, as Nx does. The options are this repository's
 *   configuration as Prettier resolves it for each kind of file, written at build time into
 *   `formatting.json` (`useFormatting`), since the standalone build cannot read a configuration
 *   file.
 * - **`generateFiles`** writes a folder of templates into the tree: each name's `__<key>__`
 *   replaced and its `.template` dropped, each text rendered with EJS, the engine Nx uses.
 *
 * The rest of `@nx/devkit` that a bundled module names but no app generator calls, the
 * `config-package` generator's, refuses: that generator is not bundled.
 *
 * `tools/satori-cli/selftest.mjs` holds the bundled runner to Nx's, byte for byte.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { render } from 'ejs';
import type { Options, Plugin } from 'prettier';
import * as prettier from 'prettier/standalone';
import * as acorn from 'prettier/plugins/acorn';
import * as angular from 'prettier/plugins/angular';
import * as babel from 'prettier/plugins/babel';
import * as estree from 'prettier/plugins/estree';
import * as flow from 'prettier/plugins/flow';
import * as glimmer from 'prettier/plugins/glimmer';
import * as graphql from 'prettier/plugins/graphql';
import * as html from 'prettier/plugins/html';
import * as markdown from 'prettier/plugins/markdown';
import * as meriyah from 'prettier/plugins/meriyah';
import * as postcss from 'prettier/plugins/postcss';
import * as typescript from 'prettier/plugins/typescript';
import * as yaml from 'prettier/plugins/yaml';
import type { GeneratorTree } from './tree.ts';

export type Tree = GeneratorTree;

/** Prettier's own plugins, in the order its Node build lists them. */
const PLUGINS = [
  acorn,
  angular,
  babel,
  estree,
  flow,
  glimmer,
  graphql,
  html,
  markdown,
  meriyah,
  postcss,
  typescript,
  yaml,
] as Plugin[];
/** The standalone build's version, which its types leave out. */
const PRETTIER = (prettier as typeof prettier & { readonly version: string }).version;

export let workspaceRoot = '';

/** The carried root, for `workspaceRoot`: set by the runner before a generator is loaded. */
export function useWorkspaceRoot(root: string): void {
  workspaceRoot = root;
}

/**
 * This repository's Prettier configuration, as `prettier.resolveConfig` resolves it with
 * `editorconfig: true`, by file extension, and for any other file.
 */
export interface Formatting {
  readonly prettier: string;
  readonly byExtension: Readonly<Record<string, Options>>;
  readonly otherwise: Options;
}

let formatting: Formatting | null = null;

export function useFormatting(given: Formatting): void {
  if (given.prettier !== PRETTIER)
    throw new Error(
      `formatting.json was resolved by Prettier ${given.prettier}, and this runner carries ${PRETTIER}: the tool was not built whole.`,
    );
  formatting = given;
}

export async function formatFiles(tree: Tree): Promise<void> {
  if (formatting === null) throw new Error('formatFiles: the runner gave no formatting.');
  const resolved = formatting;
  const changed = tree.listChanges().filter((file) => file.type !== 'DELETE');
  const inTree = changedPrettierConfig(tree);
  await Promise.all(
    changed.map(async (file) => {
      const filepath = join(tree.root, file.path);
      const options: Options = {
        ...(resolved.byExtension[extname(file.path)] ?? resolved.otherwise),
        ...inTree,
        filepath,
      };
      if (file.path.endsWith('.swcrc')) options.parser = 'json';
      let text: string;
      try {
        text = await prettier.format((file.content ?? Buffer.alloc(0)).toString('utf-8'), {
          ...options,
          plugins: PLUGINS,
        });
      } catch (error) {
        // No parser for it, as for XML or MANIFEST.MF: left as it is, as Nx leaves it.
        if ((error as Error).name === 'UndefinedParserError') return;
        console.warn(`Could not format ${file.path}. Error: "${(error as Error).message}"`);
        return;
      }
      tree.write(file.path, text);
    }),
  );
}

/** A `.prettierrc` the generator itself wrote, which Nx's `formatFiles` applies too. */
function changedPrettierConfig(tree: Tree): Options | null {
  if (!tree.listChanges().some((file) => file.path === '.prettierrc')) return null;
  try {
    return JSON.parse(tree.read('.prettierrc', 'utf-8') ?? '') as Options;
  } catch {
    return null;
  }
}

/** The extensions Nx's `generateFiles` copies as bytes rather than render. */
const BINARY = new Set(
  '.png .jpg .jpeg .gif .ico .bmp .webp .tif .tiff .svgz .pdf .zip .gz .tgz .jar .class .woff .woff2 .ttf .otf .eot .mp3 .mp4 .wav .ogg .webm'.split(
    ' ',
  ),
);

export function generateFiles(
  tree: Tree,
  srcFolder: string,
  target: string,
  substitutions: Record<string, unknown>,
  options: { overwriteStrategy?: 'overwrite' | 'keepExisting' | 'throwIfExisting' } = {},
): void {
  const strategy = options.overwriteStrategy ?? 'overwrite';
  const files = filesIn(srcFolder);
  if (files.length === 0)
    throw new Error(
      `generateFiles: No files found in "${srcFolder}". Are you sure you specified the correct path?`,
    );
  for (const file of files) {
    let path = join(target, relative(srcFolder, file));
    if (path.endsWith('.template')) path = path.slice(0, -'.template'.length);
    for (const [key, value] of Object.entries(substitutions))
      path = path.split(`__${key}__`).join(String(value));
    if (tree.exists(path)) {
      if (strategy === 'keepExisting') continue;
      if (strategy === 'throwIfExisting')
        throw new Error(
          `Generated file already exists, not allowed by overwrite strategy in generator (${path})`,
        );
    }
    const content = BINARY.has(extname(file).toLowerCase())
      ? readFileSync(file)
      : render(readFileSync(file, 'utf-8'), substitutions, { filename: file });
    tree.write(path, content);
  }
}

/** Every file under `folder`, depth first, in the order the file system lists them, as Nx's. */
function filesIn(folder: string): string[] {
  const found: string[] = [];
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch {
    return found;
  }
  for (const name of names) {
    const path = join(folder, name);
    try {
      if (statSync(path).isDirectory()) found.push(...filesIn(path));
      else found.push(path);
    } catch {
      // Gone, or unreadable: skipped, as Nx skips it.
    }
  }
  return found;
}

function notCarried(name: string): never {
  throw new Error(
    `${name} is not in the bundled generators' @nx/devkit: only the app generators are bundled.`,
  );
}

export function names(): never {
  return notCarried('names');
}

export function addProjectConfiguration(): never {
  return notCarried('addProjectConfiguration');
}

export function updateProjectConfiguration(): never {
  return notCarried('updateProjectConfiguration');
}

export function readProjectConfiguration(): never {
  return notCarried('readProjectConfiguration');
}
