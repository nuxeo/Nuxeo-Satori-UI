/**
 * A demo kit's own stand-in model, read from its package rather than from a server: the readers'
 * second source (the moves kit's Phase 8 feedback, item 9). A demo kit's types are on no server
 * until it is installed, so the server's readers answer that there is no such type or page
 * provider, though `app-model` wrote both and the package describes them:
 *
 * - **the content model,** from the package's `content-model.json`, beside `bundle/`, which
 *   `app-model` writes in the shape `npm run app-package:model` exports;
 * - **its page providers,** from the components the manifest names, as the server would register
 *   them: each `coreQueryPageProvider` or `genericPageProvider` of an extension to
 *   `org.nuxeo.ecm.platform.query.api.PageProviderService`'s `providers` point, the later one of a
 *   name kept and a disabled one taking it away. Each is turned into what `/search/pp/<name>`
 *   answers, so that it is described as a server's is.
 *
 * Only a package that ships a stand-in model, one with a `content-model.json`, is read so: a
 * package on a customer's model holds no type and no page provider of its own, and its readers
 * are the server's. The package is found as the write tools find one, inside the package roots,
 * through no link and holding none; a component outside `bundle/` is not read.
 */
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { modelOf, type ContentModel } from './model.ts';
import { isIndexed } from './page-providers.ts';
import { packageFolder } from './package-writes.ts';
import type { JsonRecord } from './shapes.ts';

/** A demo kit's description of its stand-in model, beside `bundle/`, which `app-model` writes. */
export const OWN_MODEL = 'content-model.json';
const PAGE_PROVIDERS = 'org.nuxeo.ecm.platform.query.api.PageProviderService';

export interface PackageSource {
  /** The package, as the answers name it: from the repository when inside it. */
  readonly shown: string;
  /** Its model, `null` when the package ships no stand-in model. */
  readonly model: ContentModel | null;
  /** Its page providers, by name, each as `/search/pp/<name>` answers one, and where it is. */
  readonly pageProviders: ReadonlyMap<string, PackagePageProvider>;
}

export interface PackagePageProvider {
  readonly definition: JsonRecord;
  /** The component that defines it, as the answers name it. */
  readonly defined: string;
  /** Its element and class, for whether the search index answers it. */
  readonly element: 'coreQueryPageProvider' | 'genericPageProvider';
  readonly className: string | null;
}

/**
 * The package `path` names, read as a source: refused as the write tools refuse it when it is not
 * one folder directly inside one of `roots`, or holds a link. An error says why.
 */
export function readPackageSource(path: string, roots: readonly string[]): PackageSource {
  const target = packageFolder(path, roots);
  if (!target.exists) throw new Error(`package: ${path} does not exist.`);
  const modelFile = join(target.directory, OWN_MODEL);
  if (!lstatSync(modelFile, { throwIfNoEntry: false })?.isFile())
    return { shown: target.shown, model: null, pageProviders: new Map() };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(modelFile, 'utf8').replace(/^\uFEFF/, ''));
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
  return {
    shown: target.shown,
    model,
    pageProviders: pageProvidersOf(target.directory, target.shown),
  };
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
      defined: provider.defined,
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const shown = wanted ? all.filter((entry) => entry.name.toLowerCase().includes(wanted)) : all;
  return {
    total: all.length,
    matched: shown.length,
    pageProviders: shown,
    note:
      "The package's own page providers, which no server has until it is installed; list the" +
      " server's without package. indexed: false reads the repository, which shows a write at" +
      ' once; null is a search service page provider, which reads what the server it is installed' +
      ' on searches with by default: the search index, which lags, on a server that has one.',
  };
}

// ------------------------------------------------------------------------- the components' XML

/**
 * The markup the server registers: without comments and processing instructions, and with each
 * `<documentation>`, which may hold examples of real markup, blanked. CDATA is kept, for the text
 * that holds one.
 */
function registered(xml: string): string {
  return xml
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<\?[\s\S]*?(?:\?>|$)/g, '')
    .replace(/<documentation(?:\s[^>]*)?>[\s\S]*?<\/documentation\s*>/g, '');
}

const ENTITIES: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

/** An XML text or attribute value as the server reads it: its entities and character references decoded. */
function decoded(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, name: string) => {
    if (name.startsWith('#x')) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    return ENTITIES[name] ?? whole;
  });
}

/** An element's text: its CDATA as written, the rest decoded, its white space run together. */
function textOf(inner: string): string {
  const parts = inner.split(/(<!\[CDATA\[[\s\S]*?\]\]>)/);
  return parts
    .map((part) =>
      part.startsWith('<![CDATA[') ? part.slice(9, -3) : decoded(part.replace(/<[^>]*>/g, '')),
    )
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function attributes(tag: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [, name, , double, single] of tag.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g))
    found[name] = decoded(double ?? single).trim();
  return found;
}

/** Each `<name ...>...</name>` or `<name ... />` in `xml`: its attributes and what it holds. */
function elements(
  xml: string,
  name: string,
): { attributes: Record<string, string>; inner: string }[] {
  const found: { attributes: Record<string, string>; inner: string }[] = [];
  const open = new RegExp(`<${name}(?=[\\s/>])((?:[^>"']|"[^"]*"|'[^']*')*)>`, 'g');
  for (const match of xml.matchAll(open)) {
    const tag = match[1];
    if (tag.trimEnd().endsWith('/')) {
      found.push({ attributes: attributes(tag.trimEnd().slice(0, -1)), inner: '' });
      continue;
    }
    const start = (match.index ?? 0) + match[0].length;
    const close = new RegExp(`</${name}\\s*>`, 'g');
    close.lastIndex = start;
    const end = close.exec(xml);
    found.push({
      attributes: attributes(tag),
      inner: xml.slice(start, end ? end.index : xml.length),
    });
  }
  return found;
}

/** The components the manifest names, `Nuxeo-Component`, its lines unfolded. */
function componentsOf(directory: string): string[] {
  const manifest = join(directory, 'bundle', 'META-INF', 'MANIFEST.MF');
  if (!lstatSync(manifest, { throwIfNoEntry: false })?.isFile()) return [];
  const headers = readFileSync(manifest, 'utf8')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n /g, '');
  return headers
    .split('\n')
    .filter((line) => /^nuxeo-component:/i.test(line))
    .flatMap((line) => line.slice(line.indexOf(':') + 1).split(/[,\s]+/))
    .filter((path) => path !== '');
}

/** The package's own page providers, as the server would register them. */
function pageProvidersOf(directory: string, shown: string): Map<string, PackagePageProvider> {
  const bundle = resolve(directory, 'bundle');
  const providers = new Map<string, PackagePageProvider>();
  for (const component of componentsOf(directory)) {
    // A component is the bundle's own file: one outside it, or missing, is not read.
    const file = resolve(bundle, component);
    const from = relative(bundle, file);
    if (isAbsolute(component) || from === '' || from.startsWith('..') || isAbsolute(from)) continue;
    if (!existsSync(file) || !lstatSync(file).isFile()) continue;
    const xml = registered(readFileSync(file, 'utf8'));
    const defined = `${shown}/bundle/${from.split(sep).join('/')}`;
    for (const extension of elements(xml, 'extension')) {
      if (
        extension.attributes['target'] !== PAGE_PROVIDERS ||
        extension.attributes['point'] !== 'providers'
      )
        continue;
      for (const element of ['coreQueryPageProvider', 'genericPageProvider'] as const)
        for (const provider of elements(extension.inner, element)) {
          const name = provider.attributes['name'];
          if (!name) continue;
          if (provider.attributes['enabled']?.toLowerCase() === 'false') {
            providers.delete(name);
            continue;
          }
          providers.set(name, {
            definition: definitionOf(name, provider.inner),
            defined,
            element,
            className: provider.attributes['class'] ?? null,
          });
        }
    }
  }
  return providers;
}

/** A page provider's markup as `/search/pp/<name>` answers its definition. */
function definitionOf(name: string, inner: string): JsonRecord {
  const first = (element: string) => elements(inner, element)[0];
  const number = (element: string) => {
    const found = first(element);
    const value = found ? Number(textOf(found.inner)) : Number.NaN;
    return Number.isFinite(value) ? value : undefined;
  };
  const pattern = first('pattern');
  const where = first('whereClause');
  const fixedPart = where ? elements(where.inner, 'fixedPart')[0] : undefined;
  const searchDocumentType = first('searchDocumentType');
  return {
    name,
    ...(pattern ? { pattern: textOf(pattern.inner) } : {}),
    ...(where
      ? {
          whereClause: {
            ...(fixedPart ? { fixedPart: textOf(fixedPart.inner) } : {}),
            predicates: elements(where.inner, 'predicate').map((predicate) => ({
              parameter: predicate.attributes['parameter'] ?? null,
              operator: predicate.attributes['operator'] ?? null,
              values: elements(predicate.inner, 'field').map((field) => ({
                schema: field.attributes['schema'] ?? null,
                name: field.attributes['name'] ?? null,
              })),
            })),
          },
        }
      : {}),
    ...(searchDocumentType ? { searchDocumentType: textOf(searchDocumentType.inner) } : {}),
    ...(number('pageSize') !== undefined ? { pageSize: number('pageSize') } : {}),
    ...(number('maxPageSize') !== undefined ? { maxPageSize: number('maxPageSize') } : {}),
    sortInfos: elements(inner, 'sort').map((sort) => ({
      sortColumn: sort.attributes['column'] ?? null,
      sortAscending: sort.attributes['ascending']?.toLowerCase() !== 'false',
    })),
    aggregates: elements(inner, 'aggregate').map((aggregate) => ({
      id: aggregate.attributes['id'] ?? null,
      type: aggregate.attributes['type'] ?? null,
      documentField: aggregate.attributes['parameter'] ?? null,
      properties: Object.fromEntries(
        elements(aggregate.inner, 'property').map((property) => [
          property.attributes['name'] ?? '',
          textOf(property.inner),
        ]),
      ),
    })),
  };
}
