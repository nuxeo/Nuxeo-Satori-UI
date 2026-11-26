/**
 * A demo kit's own stand-in model, read from its package rather than from a server: the readers'
 * second source (the moves kit's Phase 8 feedback, item 9). A demo kit's types are on no server
 * until it is installed, so the server's readers answer that there is no such type or page
 * provider, though `app-model` wrote both and the package describes them:
 *
 * - **the content model,** from the package's `content-model.json`, beside `bundle/`, which
 *   `app-model` writes in the shape `npm run app-package:model` exports;
 * - **its page providers,** from the components the manifest names, as the server would register
 *   them (`package-components.ts`), each turned into what `/search/pp/<name>` answers, so that it
 *   is described as a server's is.
 *
 * Only a package that ships a stand-in model is read so, as the pipeline decides one does: a
 * `content-model.json` and a component that registers a document type of its own. A package on a
 * customer's model holds no type and no page provider of its own, and a `content-model.json` there
 * describes a server, which may have changed since: its readers are the server's. The package is
 * found as the write tools find one, inside the package roots, through no link and holding none,
 * no file with a second name either; a component outside `bundle/` is not read.
 */
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { modelOf, type ContentModel } from './model.ts';
import {
  OWN_MODEL,
  pageProvidersOf,
  shipsStandIn,
  type PackagePageProvider,
  type PackageRead,
} from './package-components.ts';
import { packageFolder } from './package-writes.ts';
import { isIndexed } from './page-providers.ts';
import type { JsonRecord } from './shapes.ts';

export { OWN_MODEL };

export interface PackageSource {
  /** The package, as the answers name it: from the repository when inside it. */
  readonly shown: string;
  /** Its model, `null` when the package ships no stand-in model. */
  readonly model: ContentModel | null;
  /** Its page providers, by name, each as `/search/pp/<name>` answers one, and where it is. */
  readonly pageProviders: ReadonlyMap<string, PackagePageProvider>;
}

/**
 * The package's files, read from `directory`: a regular file with one name, by its path inside the
 * package, or `undefined`. `packageFolder` has already refused a package holding a link.
 */
function readerOf(directory: string): PackageRead {
  return (path) => {
    if (path.split('/').some((part) => part === '..' || part === '')) return undefined;
    const file = join(directory, ...path.split('/'));
    const entry = lstatSync(file, { throwIfNoEntry: false });
    if (!entry?.isFile() || entry.nlink > 1) return undefined;
    return readFileSync(file, 'utf8');
  };
}

/**
 * The package `path` names, read as a source: refused as the write tools refuse it when it is not
 * one folder directly inside one of `roots`, or holds a link. An error says why.
 */
export function readPackageSource(path: string, roots: readonly string[]): PackageSource {
  const target = packageFolder(path, roots);
  if (!target.exists) throw new Error(`package: ${path} does not exist.`);
  const read = readerOf(target.directory);
  if (!shipsStandIn(read)) return { shown: target.shown, model: null, pageProviders: new Map() };
  let raw: unknown;
  try {
    raw = JSON.parse((read(OWN_MODEL) ?? '').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(
      `package: ${target.shown}/${OWN_MODEL} cannot be read as JSON: ${(error as Error).message}`,
    );
  }
  const file = typeof raw === 'object' && raw !== null ? (raw as JsonRecord) : {};
  let model: ContentModel;
  try {
    model = modelOf({ doctypes: file['doctypes'] }, file['facets'] ?? [], file['schemas']);
  } catch (error) {
    throw new Error(
      `package: ${target.shown}/${OWN_MODEL} is not a content model, { doctypes, facets, schemas }: ${(error as Error).message}`,
    );
  }
  return { shown: target.shown, model, pageProviders: pageProvidersOf(read) };
}

/** Where a page provider of the package is defined, as the answers name it. */
export function definedIn(source: PackageSource, provider: PackagePageProvider): string {
  return `${source.shown}/${provider.component}`;
}

/** The package's own page providers, listed as `list_page_providers` lists a server's. */
export function listPackagePageProviders(source: PackageSource, query: string | undefined) {
  const wanted = query?.toLowerCase();
  const all = [...source.pageProviders]
    .map(([name, provider]) => ({
      name,
      class: provider.className,
      // One that reads the repository never lags; one of the search service reads what the
      // server's default search client reads, which the package does not say.
      indexed:
        provider.element === 'coreQueryPageProvider'
          ? false
          : isIndexed({ class: provider.className ?? '' }),
      maxPageSize:
        typeof provider.definition['maxPageSize'] === 'number'
          ? provider.definition['maxPageSize']
          : null,
      defined: definedIn(source, provider),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const shown = wanted ? all.filter((entry) => entry.name.toLowerCase().includes(wanted)) : all;
  return {
    total: all.length,
    matched: shown.length,
    pageProviders: shown,
    note:
      "The package's own page providers only, which no server has until it is installed: the" +
      " server's are listed without package. indexed: false reads the repository, which shows a" +
      ' write at once; null is a search service page provider, which reads what the server it is' +
      ' installed on searches with by default: the search index, which lags, on a server that' +
      ' has one.',
  };
}
