/**
 * A package's components, read as the server would register them: what the model readers
 * (`package-model.ts`) and the write tools' warnings (`schema-headings.ts`) need of a demo kit's
 * stand-in model, read from a package's files by `read`, which answers a file by its path inside
 * the package, `/` between its parts, or `undefined` when there is none. So the same reading serves
 * a package on disk and the staging copy of a write.
 *
 * - **The components** are those the manifest names, `Nuxeo-Component`, its lines unfolded, each
 *   inside `bundle/`: one whose path is absolute or leaves the bundle is not read.
 * - **The markup** is read without its comments and processing instructions, CDATA kept whole, and
 *   with each `<documentation>`, which may hold examples of real markup, left out.
 * - **A stand-in model** ({@link shipsStandIn}) is the package's `content-model.json` with a
 *   component that registers a document type of its own: a `<doctype>` that does not `append` to
 *   one the server has, as the pipeline decides (`ownModel` in `scripts/app-package.mjs`). A
 *   `content-model.json` with none describes a server, which may have changed since.
 * - **Its page providers** ({@link pageProvidersOf}): each `coreQueryPageProvider` or
 *   `genericPageProvider` of an extension to `PageProviderService`'s `providers` point, the later
 *   of a name kept and a disabled one, `enabled` anything but `true`, taking it away, as the
 *   server does. Each is turned into what `/search/pp/<name>` answers.
 */
import { posix } from 'node:path';
import type { JsonRecord } from './shapes.ts';

/** A package's file by its path inside the package, or `undefined` when it has none. */
export type PackageRead = (path: string) => string | undefined;

export const OWN_MODEL = 'content-model.json';
const PAGE_PROVIDERS = 'org.nuxeo.ecm.platform.query.api.PageProviderService';
const TYPES = 'org.nuxeo.ecm.core.schema.TypeService';

export interface PackagePageProvider {
  readonly definition: JsonRecord;
  /** The component that defines it, by its path inside the package. */
  readonly component: string;
  readonly element: 'coreQueryPageProvider' | 'genericPageProvider';
  readonly className: string | null;
}

/**
 * The markup the server registers: comments and processing instructions out, CDATA kept whole,
 * one after the other as they come, so that a comment's opening inside a CDATA section is text.
 * Then each `<documentation>` out.
 */
function registered(xml: string): string {
  const opening = /<!--|<\?|<!\[CDATA\[/g;
  let out = '';
  let at = 0;
  for (;;) {
    opening.lastIndex = at;
    const found = opening.exec(xml);
    if (!found) {
      out += xml.slice(at);
      break;
    }
    out += xml.slice(at, found.index);
    const close = found[0] === '<!--' ? '-->' : found[0] === '<?' ? '?>' : ']]>';
    const end = xml.indexOf(close, found.index + found[0].length);
    const stop = end === -1 ? xml.length : end + close.length;
    if (found[0] === '<![CDATA[') out += xml.slice(found.index, stop);
    at = stop;
  }
  return out.replace(/<documentation(?:\s[^>]*)?>[\s\S]*?<\/documentation\s*>/g, '');
}

const ENTITIES: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

/** A text or an attribute's value as the server reads it: entities and references decoded. */
function decoded(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, name: string) => {
    const code = name.startsWith('#x')
      ? Number.parseInt(name.slice(2), 16)
      : name.startsWith('#')
        ? Number.parseInt(name.slice(1), 10)
        : null;
    if (code === null) return ENTITIES[name] ?? whole;
    return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/** An element's text as the server reads it: CDATA as written, the rest decoded; trimmed. */
function textOf(inner: string): string {
  return inner
    .split(/(<!\[CDATA\[[\s\S]*?\]\]>)/)
    .map((part) =>
      part.startsWith('<![CDATA[') ? part.slice(9, -3) : decoded(part.replace(/<[^>]*>/g, '')),
    )
    .join('')
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

/** An extension's target as Nuxeo reads a component's name: one with no type is a service's. */
const targetOf = (extension: { attributes: Record<string, string> }): string =>
  (extension.attributes['target'] ?? '').replace(/^service:/, '');

/**
 * The components the manifest names, by their path inside the package, each with its markup as
 * the server registers it. One whose path is absolute, leaves `bundle/`, or is not a file `read`
 * answers is passed over.
 */
export function componentsOf(read: PackageRead): { path: string; xml: string }[] {
  const manifest = read('bundle/META-INF/MANIFEST.MF');
  if (manifest === undefined) return [];
  const headers = manifest
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n /g, '');
  const paths = headers
    .split('\n')
    .filter((line) => /^nuxeo-component:/i.test(line))
    .flatMap((line) => line.slice(line.indexOf(':') + 1).split(/[,\s]+/))
    .filter((path) => path !== '');
  const components: { path: string; xml: string }[] = [];
  for (const component of new Set(paths)) {
    if (component.startsWith('/') || component.includes('\\') || /^[A-Za-z]:/.test(component))
      continue;
    const inside = posix.normalize(component);
    if (inside === '.' || inside.startsWith('../') || inside === '..') continue;
    const path = `bundle/${inside}`;
    const text = read(path);
    if (text !== undefined) components.push({ path, xml: registered(text) });
  }
  return components;
}

/**
 * Whether the package ships a stand-in model: its `content-model.json`, and a component that
 * registers a document type of its own, a `<doctype>` that does not append to one the server has.
 */
export function shipsStandIn(read: PackageRead): boolean {
  if (read(OWN_MODEL) === undefined) return false;
  return componentsOf(read).some(({ xml }) =>
    elements(xml, 'extension').some(
      (extension) =>
        targetOf(extension) === TYPES &&
        extension.attributes['point'] === 'doctype' &&
        elements(extension.inner, 'doctype').some(
          (doctype) => doctype.attributes['append']?.toLowerCase() !== 'true',
        ),
    ),
  );
}

/** The package's own page providers, by name, as the server would register them. */
export function pageProvidersOf(read: PackageRead): Map<string, PackagePageProvider> {
  const providers = new Map<string, PackagePageProvider>();
  for (const { path, xml } of componentsOf(read))
    for (const extension of elements(xml, 'extension')) {
      if (targetOf(extension) !== PAGE_PROVIDERS || extension.attributes['point'] !== 'providers')
        continue;
      for (const element of ['coreQueryPageProvider', 'genericPageProvider'] as const)
        for (const provider of elements(extension.inner, element)) {
          const name = provider.attributes['name'];
          if (!name) continue;
          const enabled = provider.attributes['enabled'];
          if (enabled !== undefined && enabled.toLowerCase() !== 'true') {
            providers.delete(name);
            continue;
          }
          providers.set(name, {
            definition: definitionOf(name, provider.inner),
            component: path,
            element,
            className: provider.attributes['class'] ?? null,
          });
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
