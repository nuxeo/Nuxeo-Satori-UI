/**
 * The content model a Studio package declares: its document types, its schemas and their fields,
 * its page providers and its directories, read from its model contributions and XSD files.
 *
 * Check 3 of the harness (docs/business-apps/studio-migration.md, section 6) holds every field,
 * vocabulary and page provider of a conversion against the model. The package's own part of it is
 * here, in the package, and is checked without a server. The platform's part, Dublin Core and the
 * stock types, vocabularies and page providers, is the server's to say: what rests on it is
 * listed, and lab mode confirms it on a server (`lab-server.ts`).
 *
 * Read as data: the XML is parsed, and nothing in it is run. A file that cannot be read leaves its
 * part of the model out and is listed in `problems`, each of which check 3 reports as a finding,
 * so that what the file defined is never taken for the platform's.
 */
import type { PropertyType } from '@agentic-ui/shared/app-definition';
import type { Inventory } from './inventory';
import { elementsOf, parseXml } from './markup';
import type { StudioPackage } from './studio-package';

export interface ModelSchema {
  readonly name: string;
  readonly prefix: string;
  /** Field name to type. Empty when its XSD could not be read. */
  readonly fields: ReadonlyMap<string, PropertyType>;
  /** False when its XSD was missing or not well-formed. */
  readonly read: boolean;
}

export interface ModelType {
  readonly name: string;
  readonly extends: string | null;
  /** The schemas it declares itself, by name. */
  readonly schemas: readonly string[];
  /** The facets it declares, by name. */
  readonly facets: readonly string[];
}

export interface PackageModel {
  /** By prefix, which is how a layout names a field. */
  readonly schemas: ReadonlyMap<string, ModelSchema>;
  readonly types: ReadonlyMap<string, ModelType>;
  /** The facets the package declares, each with the schemas it adds. */
  readonly facets: ReadonlyMap<string, readonly string[]>;
  readonly pageProviders: ReadonlySet<string>;
  readonly directories: ReadonlySet<string>;
  /** The workflows it imports (`routeModelImporter`), by their model's id. */
  readonly workflows: ReadonlySet<string>;
  /** What could not be read, one line each. */
  readonly problems: readonly string[];
}

const SCHEMA_POINT = 'schema';
const DOCTYPE_POINT = 'doctype';
const PROVIDERS_POINT = 'providers';
const DIRECTORIES_POINT = 'directories';
const WORKFLOWS_POINT = 'routeModelImporter';
const PROVIDER_ELEMENTS = new Set(['coreQueryPageProvider', 'genericPageProvider']);

/** XSD's built-in types, as Nuxeo maps them. */
const XS_TYPES: Readonly<Record<string, PropertyType>> = {
  string: 'string',
  normalizedString: 'string',
  token: 'string',
  anyURI: 'string',
  date: 'date',
  dateTime: 'date',
  long: 'long',
  integer: 'long',
  int: 'long',
  short: 'long',
  double: 'double',
  float: 'double',
  decimal: 'double',
  boolean: 'boolean',
};

export function packageModel(pkg: StudioPackage, inventory: Inventory): PackageModel {
  const schemas = new Map<string, ModelSchema>();
  const types = new Map<string, ModelType>();
  const facets = new Map<string, readonly string[]>();
  const pageProviders = new Set<string>();
  const directories = new Set<string>();
  const workflows = new Set<string>();
  const problems: string[] = [];

  // Every file of model contributions, not only those the inventory could read: one it could not
  // is a problem here too.
  const files = inventory.files.filter(
    (file) => file.location === 'bundle' && file.kind === 'model-contributions',
  );
  for (const { path } of files) {
    let root: Element;
    try {
      root = parseXml(pkg.bundleFiles.get(path)?.toString('utf8') ?? '').documentElement;
    } catch {
      problems.push(`${path} is not well-formed XML, so its part of the model is unknown`);
      continue;
    }
    for (const extension of elementsOf(root).filter(
      (element) => element.localName === 'extension',
    )) {
      const point = extension.getAttribute('point');
      const children = Array.from(extension.children);
      if (point === SCHEMA_POINT) {
        for (const schema of children.filter((child) => child.localName === 'schema')) {
          const name = schema.getAttribute('name') ?? '';
          // A schema with no prefix is addressed by its name, as Nuxeo does: `file:content`.
          const prefix = schema.getAttribute('prefix') || name;
          const src = schema.getAttribute('src') ?? '';
          const fields = readXsd(pkg.bundleFiles.get(src)?.toString('utf8'));
          if (fields === null) problems.push(`the schema ${name}'s file, ${src}, cannot be read`);
          schemas.set(prefix, { name, prefix, fields: fields ?? new Map(), read: fields !== null });
        }
      } else if (point === DOCTYPE_POINT) {
        for (const facet of children.filter((child) => child.localName === 'facet')) {
          facets.set(facet.getAttribute('name') ?? '', namesOf(facet, 'schema'));
        }
        for (const doctype of children.filter((child) => child.localName === 'doctype')) {
          const name = doctype.getAttribute('name') ?? '';
          // `append="true"` adds subtypes to a type declared elsewhere, the platform's own.
          if (doctype.getAttribute('append') === 'true') continue;
          types.set(name, {
            name,
            extends: doctype.getAttribute('extends'),
            schemas: namesOf(doctype, 'schema'),
            facets: namesOf(doctype, 'facet'),
          });
        }
      } else if (point === PROVIDERS_POINT) {
        for (const provider of children.filter((child) => PROVIDER_ELEMENTS.has(child.localName))) {
          const name = provider.getAttribute('name');
          if (name) pageProviders.add(name);
        }
      } else if (point === WORKFLOWS_POINT) {
        for (const resource of children.filter(
          (child) => child.localName === 'template-resource',
        )) {
          const id = resource.getAttribute('id');
          if (id) workflows.add(id);
        }
      } else if (point === DIRECTORIES_POINT) {
        for (const directory of children.filter((child) => child.localName === 'directory')) {
          const name = directory.getAttribute('name');
          if (name) directories.add(name);
        }
      }
    }
  }
  return { schemas, types, facets, pageProviders, directories, workflows, problems };
}

function namesOf(parent: Element, child: string): string[] {
  return Array.from(parent.children)
    .filter((element) => element.localName === child)
    .map((element) => element.getAttribute('name') ?? '');
}

/**
 * The top-level fields of an XSD, with their types; `null` when there is no file or it is not
 * well-formed. A named simple type that is a list gives a list of its item type, a complex type
 * whose sequence repeats gives a list of complex values, and any other complex type is complex.
 */
export function readXsd(text: string | undefined): Map<string, PropertyType> | null {
  if (text === undefined) return null;
  let schema: Element;
  try {
    schema = parseXml(text).documentElement;
  } catch {
    return null;
  }
  const named = new Map<string, Element>();
  for (const child of Array.from(schema.children)) {
    const name = child.getAttribute('name');
    if (name && (child.localName === 'simpleType' || child.localName === 'complexType'))
      named.set(name, child);
  }
  const fields = new Map<string, PropertyType>();
  for (const element of Array.from(schema.children).filter(
    (child) => child.localName === 'element',
  )) {
    const name = element.getAttribute('name');
    if (!name) continue;
    const declared = element.getAttribute('type');
    const inline = Array.from(element.children).find(
      (child) => child.localName === 'simpleType' || child.localName === 'complexType',
    );
    fields.set(name, typeOf(declared, inline ?? null, named, 0));
  }
  return fields;
}

function typeOf(
  declared: string | null,
  inline: Element | null,
  named: ReadonlyMap<string, Element>,
  depth: number,
): PropertyType {
  if (depth > 8) return 'complex';
  if (declared !== null) {
    const local = declared.slice(declared.indexOf(':') + 1);
    // `nxs:content` is the blob type every Studio XSD declares.
    if (local === 'content') return 'blob';
    if (declared.startsWith('xs:') || declared.startsWith('xsd:'))
      return Object.hasOwn(XS_TYPES, local) ? XS_TYPES[local] : 'string';
    const definition = named.get(local);
    return definition ? typeOf(null, definition, named, depth + 1) : 'complex';
  }
  if (inline === null) return 'string';
  if (inline.localName === 'simpleType') {
    const list = elementsOf(inline).find((child) => child.localName === 'list');
    if (list) {
      return listOf(typeOf(list.getAttribute('itemType'), null, named, depth + 1));
    }
    const restriction = elementsOf(inline).find((child) => child.localName === 'restriction');
    return restriction
      ? typeOf(restriction.getAttribute('base'), null, named, depth + 1)
      : 'string';
  }
  const repeated = elementsOf(inline).find(
    (child) => child.localName === 'element' && child.getAttribute('maxOccurs') === 'unbounded',
  );
  if (repeated) {
    return listOf(typeOf(repeated.getAttribute('type'), null, named, depth + 1));
  }
  return 'complex';
}

/**
 * A list of the item type. The registry names three kinds of list: blobs, complex values, and the
 * rest, which it calls `string[]`, numbers and dates included.
 */
function listOf(item: PropertyType): PropertyType {
  if (item === 'blob' || item === 'blob[]') return 'blob[]';
  if (item === 'complex' || item === 'complex[]') return 'complex[]';
  return 'string[]';
}

/** The schemas a type has from the package: its own, and those of the package types it extends. */
export function schemasOfType(model: PackageModel, type: string): Set<string> | null {
  const own = model.types.get(type);
  if (!own) return null;
  const schemas = new Set<string>();
  const seen = new Set<string>();
  for (let current: ModelType | undefined = own; current && !seen.has(current.name);) {
    seen.add(current.name);
    for (const schema of current.schemas) schemas.add(schema);
    for (const facet of current.facets)
      for (const schema of model.facets.get(facet) ?? []) schemas.add(schema);
    current = current.extends ? model.types.get(current.extends) : undefined;
  }
  return schemas;
}
