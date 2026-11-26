/**
 * The content model: document types, facets and schemas, read the three ways it takes.
 *
 * `/config/types` alone is a trap (AGENTS/11-beta-program.md, section 3): its flat schema map
 * covers only the schemas a type reaches, so the schemas come from `/config/schemas`, the nested
 * superset, and what a facet brings from `/config/facets`, the only place that says.
 *
 * A schema whose `@prefix` is empty is addressed by its name, as Nuxeo addresses `file:content`,
 * so every prefix here is the one an app definition writes.
 */
import type { NuxeoReads } from './nuxeo.ts';
import { isRecord, list, notFound, record, text, texts, type JsonRecord } from './shapes.ts';

/** What `/config/types` names as the parent of the root type, `Document`. */
const ROOT_PARENT = 'None!!!';

export interface Field {
  /** `<prefix>:<name>` for a schema's own field, as an app definition names it. */
  readonly xpath?: string;
  /** A subfield's name, inside a complex field. */
  readonly name?: string;
  /** Nuxeo's type: `string`, `date`, `blob`, `complex`; a list ends in `[]`. */
  readonly type: string;
  readonly fields?: readonly Field[];
}

export interface Schema {
  readonly name: string;
  readonly prefix: string;
  readonly fields: readonly Field[];
}

export interface DocumentType {
  readonly name: string;
  readonly parent: string | null;
  readonly facets: readonly string[];
  readonly schemas: readonly string[];
}

export interface Facet {
  readonly name: string;
  readonly schemas: readonly string[];
}

export interface ContentModel {
  readonly types: readonly DocumentType[];
  readonly facets: readonly Facet[];
  readonly schemas: readonly Schema[];
}

export async function readContentModel(nuxeo: NuxeoReads): Promise<ContentModel> {
  const [types, facets, schemas] = await Promise.all([
    nuxeo.get('/config/types'),
    nuxeo.get('/config/facets'),
    nuxeo.get('/config/schemas'),
  ]);
  return modelOf(types, facets, schemas);
}

/**
 * The content model from what `/config/types`, `/config/facets` and `/config/schemas` answer, or a
 * file in their shape, `{ doctypes, facets, schemas }`, as `npm run app-package:model` exports one
 * and `app-model` writes a demo kit's: its `doctypes` are the first answer's.
 */
export function modelOf(types: unknown, facets: unknown, schemas: unknown): ContentModel {
  const doctypes = record(record(types, '/config/types')['doctypes'], "/config/types' doctypes");
  return {
    types: Object.entries(doctypes)
      .map(([name, value]): DocumentType => {
        const type = isRecord(value) ? value : {};
        const parent = text(type['parent']);
        return {
          name,
          // The root type, Document, names its parent `None!!!`.
          parent: parent === ROOT_PARENT ? null : parent,
          facets: texts(type['facets']),
          schemas: texts(type['schemas']),
        };
      })
      .sort(byName),
    facets: list(facets, '/config/facets')
      .filter(isRecord)
      .map((facet): Facet => ({
        name: text(facet['name']) ?? '',
        schemas: list(facet['schemas'] ?? [], "a facet's schemas")
          .filter(isRecord)
          .map((schema) => text(schema['name']) ?? '')
          .filter(Boolean),
      }))
      .filter((facet) => facet.name !== '')
      .sort(byName),
    schemas: list(schemas, '/config/schemas').filter(isRecord).map(toSchema).sort(byName),
  };
}

/** The model at a glance: every type, facet and schema, with no fields. */
export function summarise(model: ContentModel) {
  return {
    counts: {
      types: model.types.length,
      facets: model.facets.length,
      schemas: model.schemas.length,
    },
    types: model.types,
    facets: model.facets,
    schemas: model.schemas.map((schema) => ({
      name: schema.name,
      prefix: schema.prefix,
      fields: schema.fields.length,
    })),
    note:
      'Prefixes are the ones an app definition writes: a schema Nuxeo reports with an empty' +
      ' prefix is addressed by its name. describe_document_type and describe_schema give fields.',
  };
}

/** One type with every field it has, each schema marked with the facets that bring it. */
export function describeType(model: ContentModel, name: string) {
  const type = model.types.find((candidate) => candidate.name === name);
  if (!type)
    throw notFound(
      'document type',
      name,
      model.types.map((candidate) => candidate.name),
    );
  const ancestors: string[] = [];
  for (let parent = type.parent; parent !== null && !ancestors.includes(parent);) {
    ancestors.push(parent);
    parent = model.types.find((candidate) => candidate.name === parent)?.parent ?? null;
  }
  const missing: string[] = [];
  const schemas = type.schemas.flatMap((schemaName) => {
    const schema = model.schemas.find((candidate) => candidate.name === schemaName);
    if (!schema) {
      missing.push(schemaName);
      return [];
    }
    const facets = type.facets.filter((facetName) =>
      model.facets.find((facet) => facet.name === facetName)?.schemas.includes(schemaName),
    );
    return [{ ...schema, ...(facets.length ? { facets } : {}) }];
  });
  return {
    name: type.name,
    parent: type.parent,
    ancestors,
    facets: type.facets,
    subtypes: model.types
      .filter((candidate) => candidate.parent === type.name)
      .map((candidate) => candidate.name),
    schemas,
    ...(missing.length
      ? {
          problems: [
            `The type lists schemas /config/schemas does not describe: ${missing.join(', ')}.`,
          ],
        }
      : {}),
  };
}

/** One schema's fields, with the types and facets that use it. */
export function describeSchema(model: ContentModel, name: string) {
  // A prefix is accepted too: an agent holding `dc:title` asks for `dc`.
  const schema =
    model.schemas.find((candidate) => candidate.name === name) ??
    model.schemas.find((candidate) => candidate.prefix === name);
  if (!schema)
    throw notFound(
      'schema',
      name,
      model.schemas.flatMap((candidate) => [candidate.name, candidate.prefix]),
    );
  return {
    ...schema,
    usedByTypes: model.types
      .filter((type) => type.schemas.includes(schema.name))
      .map((type) => type.name),
    usedByFacets: model.facets
      .filter((facet) => facet.schemas.includes(schema.name))
      .map((facet) => facet.name),
  };
}

export function toSchema(schema: JsonRecord): Schema {
  const name = text(schema['name']) ?? '';
  const prefix = text(schema['@prefix']) || name;
  return { name, prefix, fields: toFields(schema['fields'], prefix) };
}

/**
 * Nuxeo writes a field as its type, `"string"` or `"string[]"`, or as `{ type, fields }` for a
 * complex one. Fields keep Nuxeo's order.
 */
function toFields(fields: unknown, prefix: string | null): Field[] {
  if (!isRecord(fields)) return [];
  return Object.entries(fields).map(([name, value]): Field => {
    const where = prefix === null ? { name } : { xpath: `${prefix}:${name}` };
    if (typeof value === 'string') return { ...where, type: value };
    if (isRecord(value)) {
      const subfields = toFields(value['fields'], null);
      return {
        ...where,
        type: text(value['type']) ?? 'complex',
        ...(subfields.length ? { fields: subfields } : {}),
      };
    }
    return { ...where, type: 'unknown' };
  });
}

function byName(a: { readonly name: string }, b: { readonly name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}
