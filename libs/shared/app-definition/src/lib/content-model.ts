/**
 * The model reader: a server's content model, its document types, schemas and facets, as the
 * checks of a layout file need it (docs/business-apps/layout-v2.md, section 3). The package
 * pipeline and the layout designer hold a layout to it; the Studio migration is to.
 *
 * It reads `{ doctypes, facets, schemas }`: the pipeline's model file, and the shape of
 * `NuxeoContentModel`, which `ContentModelService` in `libs/shared/nuxeo-client` resolves, though
 * nothing calls it yet and its schemas are the list's, so they name no directory. The record page
 * reads its model another way, one type at a time from `/config/types/<type>`.
 *
 * - `doctypes`: the `doctypes` of `/api/v1/config/types`. Each names its parent, its facets and
 *   its schemas, the inherited ones and those its facets bring included;
 * - `facets`: `/api/v1/config/facets`, each facet with the schemas it brings;
 * - `schemas`: `/api/v1/config/schemas`, or each `/api/v1/config/schemas/<name>` read with
 *   `fetch-schema: fields`. Only the second names the directory a property is bound to: the list
 *   leaves every field's constraints out.
 *
 * Reading files and servers is the caller's: this stays plain TypeScript, for the browser as well
 * as Node.
 */
import { isRecord } from './registries';

/** One property, or one subfield of a complex one. */
export interface PropertyModel {
  /**
   * Its type as Nuxeo names it, `string`, `long`, `double`, `boolean`, `date`, `blob` or
   * `complex`; for a list, the type of each item.
   */
  readonly type: string;
  readonly list: boolean;
  /** A complex property's subfields, by name. */
  readonly fields?: ReadonlyMap<string, PropertyModel>;
  /** The directory a `directoryResolver` binds it to, or binds each item of a list to. */
  readonly directory?: string;
}

export interface SchemaModel {
  readonly name: string;
  /** What its properties are written with: its prefix, or its name when it has none, as `file`. */
  readonly prefix: string;
  readonly properties: ReadonlyMap<string, PropertyModel>;
}

export interface FacetModel {
  readonly name: string;
  readonly schemas: readonly string[];
}

export interface DocumentTypeModel {
  readonly name: string;
  /** The type it extends; `null` for `Document`, which Nuxeo gives the parent `None!!!`. */
  readonly parent: string | null;
  readonly facets: readonly string[];
  readonly schemas: readonly string[];
}

export interface ContentModel {
  readonly types: ReadonlyMap<string, DocumentTypeModel>;
  readonly facets: ReadonlyMap<string, FacetModel>;
  readonly schemas: ReadonlyMap<string, SchemaModel>;
}

export type ContentModelReading =
  | { readonly model: ContentModel; readonly problems?: undefined }
  | { readonly model?: undefined; readonly problems: readonly string[] };

const KEYS = ['doctypes', 'facets', 'schemas'];
/** The parent Nuxeo gives `Document`, which has none. */
const NO_PARENT = 'None!!!';

/**
 * The content model in `source`, `{ doctypes, facets, schemas }`, or every problem with it. A
 * model that a type, a facet, a schema or a property cannot be read from is refused as a whole:
 * checked against it, a layout would be refused for what the model left out.
 */
export function readContentModel(source: unknown): ContentModelReading {
  const problems: string[] = [];
  if (!isRecord(source)) return { problems: ['a content model is { doctypes, facets, schemas }'] };
  for (const key of Object.keys(source)) {
    if (!KEYS.includes(key))
      problems.push(`"${key}" is not a key of a content model: ${KEYS.join(', ')}`);
  }
  const { doctypes, facets: facetList, schemas: schemaList } = source;
  if (!isRecord(doctypes)) problems.push('doctypes is the doctypes object of /config/types');
  if (!Array.isArray(facetList)) problems.push('facets is the list /config/facets answers');
  if (!Array.isArray(schemaList)) problems.push('schemas is the list /config/schemas answers');
  if (problems.length > 0) return { problems };

  const schemas = new Map<string, SchemaModel>();
  const facetSchemas: SchemaModel[] = [];
  (schemaList as unknown[]).forEach((raw, index) => {
    const schema = readSchema(raw, `schemas[${index}]`, problems);
    if (!schema) return;
    if (schemas.has(schema.name))
      problems.push(`schemas[${index}]: "${schema.name}" is listed twice`);
    else schemas.set(schema.name, schema);
  });

  const facets = new Map<string, FacetModel>();
  (facetList as unknown[]).forEach((raw, index) => {
    const at = `facets[${index}]`;
    if (!isRecord(raw) || typeof raw['name'] !== 'string' || raw['name'] === '') {
      problems.push(`${at}: a facet is { name, schemas }`);
      return;
    }
    const name = raw['name'];
    // A facet that brings no schema has no `schemas` at all; one written `null` is malformed.
    const brought = raw['schemas'] === undefined ? [] : raw['schemas'];
    if (!Array.isArray(brought)) {
      problems.push(`${at}.schemas: must be a list of schemas`);
      return;
    }
    const names: string[] = [];
    brought.forEach((schema, inner) => {
      const read = readSchema(schema, `${at}.schemas[${inner}]`, problems);
      if (!read) return;
      names.push(read.name);
      facetSchemas.push(read);
    });
    if (facets.has(name)) problems.push(`${at}: "${name}" is listed twice`);
    else facets.set(name, { name, schemas: names });
  });
  // A schema only a facet brings is described by the facet, should the schemas list lack it.
  for (const schema of facetSchemas) {
    if (!schemas.has(schema.name)) schemas.set(schema.name, schema);
  }

  const types = new Map<string, DocumentTypeModel>();
  for (const [name, raw] of Object.entries(doctypes as Record<string, unknown>)) {
    const at = `doctypes.${name}`;
    if (!isRecord(raw)) {
      problems.push(`${at}: a document type is { parent, facets, schemas }`);
      continue;
    }
    const lists: Record<'facets' | 'schemas', string[]> = { facets: [], schemas: [] };
    for (const key of ['facets', 'schemas'] as const) {
      const value = raw[key] === undefined ? [] : raw[key];
      if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item)) {
        problems.push(`${at}.${key}: must be a list of names`);
        continue;
      }
      lists[key] = value as string[];
    }
    for (const facet of lists.facets) {
      if (!facets.has(facet)) problems.push(`${at}.facets: the facet "${facet}" is not in facets`);
    }
    for (const schema of lists.schemas) {
      if (!schemas.has(schema))
        problems.push(`${at}.schemas: the schema "${schema}" is not in schemas`);
    }
    const parent = raw['parent'];
    if (parent !== undefined && typeof parent !== 'string')
      problems.push(`${at}.parent: must be the name of a type`);
    types.set(name, {
      name,
      parent: typeof parent === 'string' && parent !== '' && parent !== NO_PARENT ? parent : null,
      facets: lists.facets,
      schemas: lists.schemas,
    });
  }
  return problems.length > 0 ? { problems } : { model: { types, facets, schemas } };
}

/**
 * Every property a document of `type` has, by `<prefix>:<name>`: its schemas', and those of each
 * facet it declares. `null` for a type the model does not have. A facet a document is given at run
 * time is not the type's, so its properties are not here.
 */
export function propertiesOf(
  model: ContentModel,
  type: string,
): ReadonlyMap<string, PropertyModel> | null {
  const definition = model.types.get(type);
  if (!definition) return null;
  const names = new Set(definition.schemas);
  for (const facet of definition.facets) {
    for (const schema of model.facets.get(facet)?.schemas ?? []) names.add(schema);
  }
  const properties = new Map<string, PropertyModel>();
  for (const name of names) {
    const schema = model.schemas.get(name);
    if (!schema) continue;
    for (const [property, definition] of schema.properties)
      properties.set(`${schema.prefix}:${property}`, definition);
  }
  return properties;
}

/**
 * The property's type as a widget's `accepts` writes it: `string`, `string[]`, `complex[]`. Nuxeo
 * reports some whole numbers as `integer`, which the widgets, like the schema language, call
 * `long`, as the record page does.
 */
export function propertyTypeOf(property: PropertyModel): string {
  const type = property.type === 'integer' ? 'long' : property.type;
  return property.list ? `${type}[]` : type;
}

/**
 * The name Nuxeo writes a schema's properties with: its prefix, else, as for `file`, its name.
 * Nuxeo answers it as `@prefix`, and per schema as `prefix` too; either may be missing or empty.
 * One that is not a text, or two that disagree, is a problem: read as no prefix, the schema's
 * properties would be found under its name, and a layout blamed for the model's fault.
 */
function prefixOf(
  raw: Record<string, unknown>,
  name: string,
  at: string,
  problems: string[],
): string | null {
  const given: string[] = [];
  for (const key of ['@prefix', 'prefix']) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== 'string') {
      problems.push(`${at}.${key}: must be the schema's prefix, a text`);
      return null;
    }
    if (value !== '') given.push(value);
  }
  if (new Set(given).size > 1) {
    problems.push(`${at}: its @prefix and prefix disagree, "${given[0]}" and "${given[1]}"`);
    return null;
  }
  return given[0] ?? name;
}

function readSchema(raw: unknown, at: string, problems: string[]): SchemaModel | null {
  if (!isRecord(raw) || typeof raw['name'] !== 'string' || raw['name'] === '') {
    problems.push(`${at}: a schema is { name, @prefix, fields }`);
    return null;
  }
  const name = raw['name'];
  const prefix = prefixOf(raw, name, at, problems);
  if (prefix === null) return null;
  const fields = raw['fields'] === undefined ? {} : raw['fields'];
  if (!isRecord(fields)) {
    problems.push(`${at}.fields: must be an object of fields`);
    return null;
  }
  return {
    name,
    prefix,
    properties: readFields(fields, `${at}.fields`, problems),
  };
}

function readFields(
  raw: Record<string, unknown>,
  at: string,
  problems: string[],
): Map<string, PropertyModel> {
  const properties = new Map<string, PropertyModel>();
  for (const [name, value] of Object.entries(raw)) {
    const property = readProperty(value, `${at}.${name}`, problems);
    if (property) properties.set(name, property);
  }
  return properties;
}

/**
 * A field as Nuxeo answers it: a bare type, `"string"` or `"string[]"`, or an object with its
 * `type`, and its subfields when it is complex, its constraints when read with
 * `fetch-schema: fields`.
 */
function readProperty(raw: unknown, at: string, problems: string[]): PropertyModel | null {
  if (typeof raw === 'string') return typed(raw, at, problems);
  if (!isRecord(raw)) {
    problems.push(`${at}: a field is its type, or { type, fields, constraints }`);
    return null;
  }
  const hasFields = 'fields' in raw;
  // The list answers a complex field without `type` when the schema says nothing more.
  const type = raw['type'] === undefined ? (hasFields ? 'complex' : undefined) : raw['type'];
  if (typeof type !== 'string') {
    problems.push(`${at}.type: must be the field's type`);
    return null;
  }
  const read = typed(type, `${at}.type`, problems);
  if (!read) return null;
  if (hasFields && !isRecord(raw['fields'])) {
    problems.push(`${at}.fields: must be an object of fields`);
    return null;
  }
  const own = directoryOf(raw['constraints'], `${at}.constraints`, problems);
  const items = directoryOf(raw['itemConstraints'], `${at}.itemConstraints`, problems);
  if (own === null || items === null) return null;
  const directory = own ?? items;
  return {
    ...read,
    ...(hasFields
      ? { fields: readFields(raw['fields'] as Record<string, unknown>, `${at}.fields`, problems) }
      : {}),
    ...(directory ? { directory } : {}),
  };
}

/** A type as Nuxeo writes one: a name, `string`, then `[]` once for a list, `string[]`. */
const TYPE = /^([A-Za-z][A-Za-z0-9_.:-]*)(\[\])?$/;

function typed(
  type: string,
  at: string,
  problems: string[],
): { type: string; list: boolean } | null {
  const match = TYPE.exec(type);
  if (!match) {
    problems.push(`${at}: "${type}" is not a type, such as string or string[]`);
    return null;
  }
  return { type: match[1], list: match[2] !== undefined };
}

/**
 * The directory a `directoryResolver` among `constraints` binds the value to; `undefined` when
 * none does, and `null`, with the problem, when the constraints cannot be read: a binding with no
 * directory named would be read as no binding at all.
 */
function directoryOf(
  constraints: unknown,
  at: string,
  problems: string[],
): string | undefined | null {
  if (constraints === undefined) return undefined;
  if (!Array.isArray(constraints)) {
    problems.push(`${at}: must be a list of constraints`);
    return null;
  }
  let directory: string | undefined;
  for (const [index, constraint] of constraints.entries()) {
    if (!isRecord(constraint) || constraint['name'] !== 'directoryResolver') continue;
    const parameters = constraint['parameters'];
    const named = isRecord(parameters) ? parameters['directory'] : undefined;
    if (typeof named !== 'string' || named === '') {
      problems.push(`${at}[${index}]: a directoryResolver names its directory`);
      return null;
    }
    directory ??= named;
  }
  return directory;
}
