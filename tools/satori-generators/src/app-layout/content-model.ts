import { isRecord } from '../app-package/package-files';

/**
 * Just enough of a server's content model for `app-layout` to lay out a document type: its
 * schemas, and each schema's properties with their types, the directory a property is bound to
 * and whether it holds a document's id.
 *
 * It reads the package pipeline's model file, `{ doctypes, facets, schemas }`
 * (docs/business-apps/package-pipeline.md, section 4), which `npm run app-package:model` exports.
 * `readContentModel` in `libs/shared/app-definition` reads the same file for the validator; this is
 * a second, smaller reader because these sources cannot import from outside `src/` (see
 * `app-package.ts`). It is lenient where that one is strict: a model the validator refuses is
 * refused when the pipeline runs, and the layout spec holds what this reads to what that accepts.
 */

/** One property, or one subfield of a complex one. */
export interface ModelProperty {
  /** `string`, `long`, `double`, `boolean`, `date`, `blob`, `complex`; a list's item type. */
  readonly type: string;
  readonly list: boolean;
  /** A complex property's subfields, by name. */
  readonly fields: ReadonlyMap<string, ModelProperty>;
  /** The directory a `directoryResolver` binds it, or each of its items, to. */
  readonly directory?: string;
  /** Whether a `documentResolver` makes it a document's id. */
  readonly document: boolean;
}

export interface ModelSchema {
  readonly name: string;
  /** What its properties are written with: its prefix, else its name, as `file:content`. */
  readonly prefix: string;
  readonly properties: ReadonlyMap<string, ModelProperty>;
}

export interface ModelType {
  readonly name: string;
  readonly facets: readonly string[];
  readonly schemas: readonly string[];
}

export interface Model {
  readonly types: ReadonlyMap<string, ModelType>;
  readonly schemas: ReadonlyMap<string, ModelSchema>;
  /** Each facet's schemas, by name. */
  readonly facets: ReadonlyMap<string, readonly string[]>;
}

/** The model in `raw`, or an error saying what is missing. */
export function readModel(raw: unknown, from: string): Model {
  if (!isRecord(raw) || !isRecord(raw['doctypes']) || !Array.isArray(raw['schemas'])) {
    throw new Error(
      `${from} is not a content model: it is { doctypes, facets, schemas }, as ` +
        '`npm run app-package:model` exports one.',
    );
  }
  const schemas = new Map<string, ModelSchema>();
  const facets = new Map<string, readonly string[]>();
  const facetSchemas: ModelSchema[] = [];
  for (const entry of raw['schemas']) {
    const schema = readSchema(entry);
    if (schema) schemas.set(schema.name, schema);
  }
  for (const facet of Array.isArray(raw['facets']) ? raw['facets'] : []) {
    if (!isRecord(facet) || typeof facet['name'] !== 'string') continue;
    const brought = (Array.isArray(facet['schemas']) ? facet['schemas'] : [])
      .map(readSchema)
      .filter((schema): schema is ModelSchema => schema !== null);
    facetSchemas.push(...brought);
    facets.set(
      facet['name'],
      brought.map((schema) => schema.name),
    );
  }
  // A schema only a facet brings is described by the facet, as the validator's reader reads it.
  for (const schema of facetSchemas)
    if (!schemas.has(schema.name)) schemas.set(schema.name, schema);

  const types = new Map<string, ModelType>();
  for (const [name, type] of Object.entries(raw['doctypes'])) {
    if (!isRecord(type)) continue;
    const names = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
    types.set(name, { name, facets: names(type['facets']), schemas: names(type['schemas']) });
  }
  return { types, schemas, facets };
}

/**
 * The schemas a document of `type` has, in the order the model lists them: its own, then those of
 * each facet it declares that it does not have already. A facet given at run time is not the
 * type's, so its schemas are not here, as the validator does not count them.
 */
export function schemasOf(model: Model, type: ModelType): string[] {
  const names = [...type.schemas];
  for (const facet of type.facets) {
    for (const schema of model.facets.get(facet) ?? [])
      if (!names.includes(schema)) names.push(schema);
  }
  return names;
}

function readSchema(raw: unknown): ModelSchema | null {
  if (!isRecord(raw) || typeof raw['name'] !== 'string' || raw['name'] === '') return null;
  const prefix = [raw['@prefix'], raw['prefix']].find(
    (value): value is string => typeof value === 'string' && value !== '',
  );
  return {
    name: raw['name'],
    prefix: prefix ?? raw['name'],
    properties: readFields(raw['fields']),
  };
}

function readFields(raw: unknown): Map<string, ModelProperty> {
  const properties = new Map<string, ModelProperty>();
  if (!isRecord(raw)) return properties;
  for (const [name, value] of Object.entries(raw)) {
    const property = readProperty(value);
    if (property) properties.set(name, property);
  }
  return properties;
}

/** `string`, `string[]`, `complex[]`: a type, then `[]` for a list. */
const TYPE = /^([A-Za-z][A-Za-z0-9_.:-]*)(\[\])?$/;

function readProperty(raw: unknown): ModelProperty | null {
  const typed = (type: unknown): { type: string; list: boolean } | null => {
    const match = typeof type === 'string' ? TYPE.exec(type) : null;
    return match
      ? { type: match[1] === 'integer' ? 'long' : match[1], list: match[2] !== undefined }
      : null;
  };
  if (typeof raw === 'string') {
    const read = typed(raw);
    return read ? { ...read, fields: new Map(), document: false } : null;
  }
  if (!isRecord(raw)) return null;
  // The list answers a complex field without `type` when the schema says nothing more.
  const read = typed(raw['type'] ?? ('fields' in raw ? 'complex' : undefined));
  if (!read) return null;
  const constraints = [raw['constraints'], raw['itemConstraints']].flatMap((list) =>
    Array.isArray(list) ? list.filter(isRecord) : [],
  );
  const directory = constraints
    .filter((constraint) => constraint['name'] === 'directoryResolver')
    .map((constraint) =>
      isRecord(constraint['parameters']) ? constraint['parameters']['directory'] : undefined,
    )
    .find((name): name is string => typeof name === 'string' && name !== '');
  return {
    ...read,
    fields: readFields(raw['fields']),
    ...(directory ? { directory } : {}),
    document: constraints.some((constraint) => constraint['name'] === 'documentResolver'),
  };
}
