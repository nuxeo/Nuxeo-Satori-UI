import { LayoutFile } from './layout-file';
import {
  DocumentSchemaRef,
  DocumentTypeDefinition,
  DocumentTypeSchema,
  LayoutField,
  LayoutFieldConstraints,
  LayoutFieldType,
  LayoutMode,
  ResolvedLayout,
} from './layout.model';

/**
 * Schemas a generated layout leaves out: the Properties panel's own rows and the viewers already
 * present them. Without this list a File would grow a section for `uid` and `files`, and a
 * Picture one for `picture:views`, a list of blob-bearing records. A layout file may still name
 * any of their fields.
 *
 * The last three come with stock facets Nuxeo adds to a document as it is used, not with its
 * type: `collectionMember` once it is put in a collection, which the panel's Collections row
 * shows; `notification` once someone subscribes, which the toolbar's subscribe action shows;
 * `thumbnail` once it has content, which the viewers show.
 */
export const PRESENTED_SCHEMAS: ReadonlySet<string> = new Set([
  'common',
  'dublincore',
  'uid',
  'file',
  'files',
  'note',
  'facetedTag',
  'relatedtext',
  'picture',
  'image_metadata',
  'iptc',
  'video',
  'audio',
  'collectionMember',
  'notification',
  'thumbnail',
]);

/** Translation keys a manifest `labels` entry can set to rename a generated label. */
export const fieldLabelKey = (xpath: string): string => `layout.field.${xpath}`;
export const schemaLabelKey = (schema: string): string => `layout.schema.${schema}`;

/** `billedAmount` → `Billed amount`, `payers_case` → `Payers case`, `memberID` → `Member ID`. */
export function humanize(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])(?=[A-Z][a-z])/g, '$1 ')
    .split(/[\s_.-]+/)
    .filter(Boolean)
    .map((word) => (word.length > 1 && word === word.toUpperCase() ? word : word.toLowerCase()));
  const text = words.join(' ');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : name;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function directoryOf(constraints: unknown): string | undefined {
  if (!Array.isArray(constraints)) return undefined;
  for (const constraint of constraints) {
    if (!isRecord(constraint) || constraint['name'] !== 'directoryResolver') continue;
    const parameters = constraint['parameters'];
    const directory = isRecord(parameters) ? parameters['directory'] : undefined;
    if (typeof directory === 'string' && directory) return directory;
  }
  return undefined;
}

/** A constraint parameter as Nuxeo serialises it, always a string: `"2000"`, `"false"`. */
function numberParameter(parameters: Record<string, unknown>, name: string): number | undefined {
  const value = parameters[name];
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const parsed = Number(value);
  return value !== '' && Number.isFinite(parsed) ? parsed : undefined;
}

function flagParameter(parameters: Record<string, unknown>, name: string): boolean | undefined {
  const value = parameters[name];
  return value === 'false' || value === false ? false : undefined;
}

type ReadConstraints = { -readonly [K in keyof LayoutFieldConstraints]: LayoutFieldConstraints[K] };

/** `NotNullConstraint`, and the pattern, length and interval constraints a form can check. */
function readConstraints(raw: unknown): { required: boolean; constraints: ReadConstraints } {
  const constraints: ReadConstraints = {};
  let required = false;
  for (const constraint of Array.isArray(raw) ? raw : []) {
    if (!isRecord(constraint)) continue;
    const parameters = isRecord(constraint['parameters']) ? constraint['parameters'] : {};
    switch (constraint['name']) {
      case 'NotNullConstraint':
        required = true;
        break;
      case 'PatternConstraint':
        if (typeof parameters['Pattern'] === 'string') constraints.pattern = parameters['Pattern'];
        break;
      case 'LengthConstraint':
        constraints.minLength = numberParameter(parameters, 'Minimum');
        constraints.maxLength = numberParameter(parameters, 'Maximum');
        break;
      case 'NumericIntervalConstraint':
        constraints.minimum = numberParameter(parameters, 'Minimum');
        constraints.maximum = numberParameter(parameters, 'Maximum');
        constraints.minimumInclusive = flagParameter(parameters, 'MinimumInclusive');
        constraints.maximumInclusive = flagParameter(parameters, 'MaximumInclusive');
        break;
    }
  }
  for (const key of Object.keys(constraints) as (keyof ReadConstraints)[]) {
    if (constraints[key] === undefined) delete constraints[key];
  }
  return { required, constraints };
}

/** A field as Nuxeo answers it: a bare type string, or an object when constraints or sub-fields apply. */
function readFieldType(raw: unknown): LayoutFieldType | null {
  if (typeof raw === 'string') return { type: raw };
  if (!isRecord(raw) || typeof raw['type'] !== 'string') return null;
  const directory = directoryOf(raw['constraints']) ?? directoryOf(raw['itemConstraints']);
  const fields = isRecord(raw['fields']) ? readFields(raw['fields']) : undefined;
  const { required, constraints } = readConstraints(raw['constraints']);
  const items = readConstraints(raw['itemConstraints']).constraints;
  const checks = { ...items, ...constraints };
  return {
    type: raw['type'],
    ...(directory ? { directory } : {}),
    ...(fields ? { fields } : {}),
    ...(required ? { required } : {}),
    ...(Object.keys(checks).length ? { constraints: checks } : {}),
  };
}

function readFields(raw: Record<string, unknown>): Record<string, LayoutFieldType> {
  const fields: Record<string, LayoutFieldType> = {};
  for (const [name, value] of Object.entries(raw)) {
    const field = readFieldType(value);
    if (field) fields[name] = field;
  }
  return fields;
}

/** The name Nuxeo addresses a schema's fields by: its prefix, else, as for `file`, its name. */
function prefixOf(raw: Record<string, unknown>, name: string): string {
  const prefix = raw['@prefix'] ?? raw['prefix'];
  return typeof prefix === 'string' && prefix ? prefix : name;
}

/**
 * One schema read with `fetch-schema: fields`, as `/config/types/<type>` answers it among the
 * type's and `/config/schemas/<name>` answers it alone: the same shape, vocabulary bindings
 * included. `null` for any other body, a 204's empty one among them.
 */
export function readSchema(raw: unknown): DocumentTypeSchema | null {
  if (!isRecord(raw)) return null;
  const name = raw['name'];
  if (typeof name !== 'string' || !name) return null;
  return {
    name,
    prefix: prefixOf(raw, name),
    fields: isRecord(raw['fields']) ? readFields(raw['fields']) : {},
  };
}

/**
 * A `/config/schemas/<name>` response. Stricter than a schema inside a type: it must be the schema
 * asked for and carry a `fields` object, so a malformed answer is a failed read rather than a
 * schema with no fields that would be kept for the session.
 */
export function readSchemaResponse(raw: unknown, name: string): DocumentTypeSchema | null {
  if (!isRecord(raw) || !isRecord(raw['fields'])) return null;
  const schema = readSchema(raw);
  return schema?.name === name ? schema : null;
}

/**
 * A `/config/types/<type>` response, read with `fetch-schema: fields`.
 *
 * Nuxeo reports `@prefix` only when a schema has one; `file`, `uid` and `files` have none and are
 * addressed by schema name (`file:content`), so a missing prefix becomes the schema name.
 */
export function readDocumentType(raw: unknown, name: string): DocumentTypeDefinition | null {
  if (!isRecord(raw) || !Array.isArray(raw['schemas'])) return null;
  const schemas = raw['schemas'].flatMap((schema) => readSchema(schema) ?? []);
  return { name, schemas };
}

const byName = (a: string, b: string) => a.localeCompare(b);

/** `externalEntity:origin` → `externalEntity`. */
export const prefixOfXpath = (xpath: string): string => xpath.slice(0, xpath.indexOf(':'));

/**
 * The `schemas` of a document's own read: every schema it carries, its type's and those its
 * dynamic facets added, each once and sorted by name. None for anything that is not that list.
 */
export function readDocumentSchemas(raw: unknown): readonly DocumentSchemaRef[] {
  if (!Array.isArray(raw)) return [];
  const read = new Map<string, DocumentSchemaRef>();
  for (const schema of raw) {
    if (!isRecord(schema)) continue;
    const name = schema['name'];
    if (typeof name === 'string' && name && !read.has(name)) {
      read.set(name, { name, prefix: prefixOf(schema, name) });
    }
  }
  return [...read.values()].sort((a, b) => byName(a.name, b.name));
}

/**
 * The schemas a document carries that its type does not, and the layout could show: for the
 * generated layout those the panel does not already present, for a contributed file those whose
 * prefix it names. Only these are worth a read.
 */
export function facetSchemasToRead(
  type: DocumentTypeDefinition,
  documentSchemas: readonly DocumentSchemaRef[],
  file: LayoutFile | null,
): readonly DocumentSchemaRef[] {
  const own = new Set(type.schemas.map((schema) => schema.name));
  const named = file
    ? new Set(file.sections.flatMap((section) => section.fields.map((f) => prefixOfXpath(f.field))))
    : null;
  return documentSchemas.filter(
    (schema) =>
      !own.has(schema.name) &&
      (named ? named.has(schema.prefix) : !PRESENTED_SCHEMAS.has(schema.name)),
  );
}

/** A form has no control for a file: files are added and replaced through Attachments. */
const isFile = (definition: LayoutFieldType): boolean => /^blob(\[\])?$/.test(definition.type);

function sectionsOf(schemas: readonly DocumentTypeSchema[], mode: LayoutMode) {
  return schemas
    .filter((schema) => !PRESENTED_SCHEMAS.has(schema.name))
    .sort((a, b) => byName(a.name, b.name))
    .map((schema) => ({
      id: schema.name,
      label: { keys: [schemaLabelKey(schema.name)], fallback: humanize(schema.name) },
      fields: Object.keys(schema.fields)
        .filter((name) => mode === 'metadata' || !isFile(schema.fields[name]))
        .sort(byName)
        .map((name) => field(`${schema.prefix}:${name}`, name, schema.fields[name])),
    }))
    .filter((section) => section.fields.length > 0);
}

/**
 * No layout file for this type and mode: one section per schema the panel does not already
 * present. The type's own come first, then those the document's dynamic facets added, so a
 * facet on one document never moves the sections every document of its type shows. The edit and
 * create forms leave out file fields.
 */
export function generateLayout(
  type: DocumentTypeDefinition,
  mode: LayoutMode,
  facetSchemas: readonly DocumentTypeSchema[] = [],
): ResolvedLayout {
  const sections = [...sectionsOf(type.schemas, mode), ...sectionsOf(facetSchemas, mode)];
  return { type: type.name, mode, source: 'generated', display: 'sections', sections };
}

function field(
  xpath: string,
  name: string,
  definition: LayoutFieldType,
  literal?: string,
  labelKey?: string,
): LayoutField {
  return {
    xpath,
    definition,
    label: {
      ...(literal ? { literal } : {}),
      keys: [...(labelKey ? [labelKey] : []), fieldLabelKey(xpath)],
      fallback: humanize(name),
    },
  };
}

/**
 * A contributed file, in place of the generated layout. A field neither the type nor the
 * document's facet schemas have is skipped and reported, and the rest of the file still applies.
 *
 * A section left with no field is left out, as `sectionsOf` leaves out a schema with no fields:
 * a heading with nothing under it is not a section, and in tabs display it would be a tab with
 * nothing in it. That covers a section whose `fields` list is empty and one whose every field
 * was skipped — including a facet field on a document without that facet, which is the case a
 * layout shared across types hits. Every skipped field is still reported, so the console still
 * names a typo in the file even where the section holding it has gone.
 */
export function applyLayoutFile(
  type: DocumentTypeDefinition,
  mode: LayoutMode,
  file: LayoutFile,
  facetSchemas: readonly DocumentTypeSchema[] = [],
): { readonly layout: ResolvedLayout; readonly skipped: readonly string[] } {
  const known = new Map<string, { name: string; definition: LayoutFieldType }>();
  for (const schema of [...type.schemas, ...facetSchemas]) {
    for (const [name, definition] of Object.entries(schema.fields)) {
      known.set(`${schema.prefix}:${name}`, { name, definition });
    }
  }
  const skipped: string[] = [];
  const sections = file.sections
    .map((section) => ({
      id: section.id,
      label: {
        ...(section.label ? { literal: section.label } : {}),
        keys: section.labelKey ? [section.labelKey] : [],
        fallback: null,
      },
      fields: section.fields.flatMap((entry) => {
        const match = known.get(entry.field);
        if (!match) {
          skipped.push(entry.field);
          return [];
        }
        const definition = entry.required
          ? { ...match.definition, required: true }
          : match.definition;
        return [field(entry.field, match.name, definition, entry.label, entry.labelKey)];
      }),
    }))
    // Mapped first, so a field dropped from a section that is itself dropped is still reported.
    .filter((section) => section.fields.length > 0);
  return {
    layout: { type: type.name, mode, source: 'contributed', display: file.display, sections },
    skipped,
  };
}
