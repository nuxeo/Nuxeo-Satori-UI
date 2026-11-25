/**
 * A layout file held to the content model (docs/business-apps/layout-v2.md, section 3): what only
 * a reader of the server's model can check, and so the pipeline, the designer and the migration
 * server check when they have one.
 *
 * - **A field's property** is on the type or on a facet it declares.
 * - **A widget shows its property's type**, as its `accepts` in the registries says.
 * - **A table's columns** name subfields of its property, and each column's widget shows its
 *   subfield's type, as a field's does. An address's `parts` name subfields of its property too.
 * - **A checklist's property** is on the type, a list of complex values, with the subfields
 *   {@link CHECKLIST_SUBFIELDS} names, each of its type.
 * - **A review** is for a type with the `picture` schema and without the `video` one, the records
 *   whose page shows a picture.
 *
 * Each finding is `unknown` or `parameter`, never `structure`, so that the app, loading a file
 * tolerantly, would leave out the field it is in and show the rest. It runs once the file's own
 * checks have: an entry that is malformed already has a finding, and is passed over here.
 *
 * Not checked against the model: a related list's columns, which are the listed records' and not
 * this type's; the properties a computation, a rule or a widget parameter names; and a vocabulary
 * widget's `directory` against the one the property is bound to.
 *
 * Stricter than the record page in two places, as the pipeline is meant to be: a column whose
 * widget does not show its subfield is refused here, where the page shows the value itself; and a
 * table inside a table's column is held to its subfield's subfields, though the page does not draw
 * one yet.
 */
import { join, type Finding } from './checker';
import {
  propertiesOf,
  propertyTypeOf,
  type ContentModel,
  type PropertyModel,
} from './content-model';
import { isRecord, XPATH, type Registries } from './registries';

/** A task form's variables, `var:<name>`, are not the record's properties. */
const VARIABLE = 'var:';

/**
 * What each entry of a checklist's property holds (layout-v2.md, section 7), by subfield, with
 * its type: the item's id, whether it is done, who did it, and the day. The record page reads them
 * by these names, held to this object's keys by its types (`record-checklist.ts`), so a schema
 * written for a checklist uses them.
 */
export const CHECKLIST_SUBFIELDS = {
  item: 'string',
  done: 'boolean',
  doneBy: 'string',
  doneOn: 'date',
} as const;

/** Where a field's name is looked up: the type's properties, or a complex property's subfields. */
interface Scope {
  readonly lookup: (name: string) => PropertyModel | undefined;
  /** What a field is called in a message: `"claim:lines"`, or a subfield as `"amount" of "claim:lines"`. */
  readonly label: (name: string) => string;
  /** Why the name is not found. */
  readonly missing: (name: string) => string;
}

export function againstModel(
  file: Record<string, unknown>,
  type: string | undefined,
  model: ContentModel,
  registries: Registries,
): Finding[] {
  const findings: Finding[] = [];
  const add = (path: string, kind: Finding['kind'], message: string): void => {
    findings.push({ path, kind, message });
  };
  if (!type) {
    add(
      '',
      'unknown',
      'a content model was given without the document type the file lays out, so no field was checked against it',
    );
    return findings;
  }
  const properties = propertiesOf(model, type);
  if (!properties) {
    add('', 'unknown', `the document type "${type}" is not in the content model`);
    return findings;
  }

  const ofType: Scope = {
    lookup: (xpath) => properties.get(xpath),
    label: (xpath) => `"${xpath}"`,
    missing: (xpath) => whyMissing(model, type, xpath),
  };

  /** A complex property's subfields, `null` when the model read none for it. */
  const subfieldsOf = (property: PropertyModel, owner: string): Scope | null => {
    const fields = property.fields;
    // With no subfields read, as the record page does, the columns are taken as written.
    if (!fields || fields.size === 0) return null;
    // A column is written `<prefix>:<subfield>`, and the record page reads only the subfield.
    const subfield = (name: string): string => name.slice(name.indexOf(':') + 1);
    return {
      lookup: (name) => fields.get(subfield(name)),
      label: (name) => `"${subfield(name)}" of ${owner}`,
      missing: (name) => `${owner} has no subfield "${subfield(name)}"`,
    };
  };

  const field = (entry: unknown, path: string, scope: Scope): void => {
    let name: unknown;
    let at = path;
    let widget: unknown;
    let parameters: unknown;
    if (typeof entry === 'string') name = entry;
    else if (isRecord(entry) && !('computed' in entry)) {
      name = entry['field'];
      at = join(path, 'field');
      widget = entry['widget'];
      parameters = entry['parameters'];
    }
    // A malformed name has its finding already; a variable is not the record's.
    if (typeof name !== 'string' || !XPATH.test(name) || name.startsWith(VARIABLE)) return;
    const property = scope.lookup(name);
    if (!property) {
      add(at, 'unknown', scope.missing(name));
      return;
    }
    // No widget shows the property by its type; one nobody registered has its finding already.
    if (typeof widget !== 'string' || !Object.hasOwn(registries.widgets, widget)) return;
    const shown = propertyTypeOf(property);
    const accepts = registries.widgets[widget].accepts;
    if (!(accepts as readonly string[]).includes(shown)) {
      add(
        join(path, 'widget'),
        'parameter',
        `the widget "${widget}" does not show ${scope.label(name)}, a ${shown} property: it takes ${accepts.join(' or ')}`,
      );
      return;
    }
    if (!isRecord(parameters)) return;
    const subfields = subfieldsOf(property, scope.label(name));
    if (!subfields) return;
    const parameter = (key: string): string => join(join(path, 'parameters'), key);
    if (widget === 'table' && Array.isArray(parameters['columns'])) {
      parameters['columns'].forEach((column, index) =>
        field(column, join(parameter('columns'), index), subfields),
      );
    }
    // An address's parts are subfields by their bare names.
    if (widget === 'address' && isRecord(parameters['parts'])) {
      for (const [part, subfield] of Object.entries(parameters['parts'])) {
        // A part that is not a text has its finding already, and is not made into one here.
        if (typeof subfield !== 'string') continue;
        const written = `:${subfield}`;
        if (!subfields.lookup(written))
          add(join(parameter('parts'), part), 'unknown', subfields.missing(written));
      }
    }
  };

  /** A checklist's property: a list of complex values, each entry one item's state. */
  const checklist = (entry: Record<string, unknown>, path: string): void => {
    const name = entry['field'];
    // A malformed name has its finding already.
    if (typeof name !== 'string' || !XPATH.test(name)) return;
    const at = join(path, 'field');
    const property = properties.get(name);
    if (!property) {
      add(at, 'unknown', whyMissing(model, type, name));
      return;
    }
    const shown = propertyTypeOf(property);
    if (shown !== 'complex[]') {
      add(
        at,
        'parameter',
        `a checklist reads a list of complex values, and "${name}" is a ${shown} property`,
      );
      return;
    }
    // With no subfields read, as for a table, the property is taken as written.
    if (!property.fields || property.fields.size === 0) return;
    for (const [subfield, wanted] of Object.entries(CHECKLIST_SUBFIELDS)) {
      const read = property.fields.get(subfield);
      if (!read)
        add(at, 'unknown', `"${name}" has no subfield "${subfield}", which a checklist reads`);
      else if (propertyTypeOf(read) !== wanted)
        add(
          at,
          'parameter',
          `"${subfield}" of "${name}" is a ${propertyTypeOf(read)} value, and a checklist reads it as a ${wanted}`,
        );
    }
  };

  const cards = (list: unknown, path: string): void => {
    if (!Array.isArray(list)) return;
    list.forEach((card, index) => {
      if (isRecord(card) && isRecord(card['checklist']))
        checklist(card['checklist'], join(join(path, index), 'checklist'));
      // A card of related records lists other records, whose type this file does not say.
      if (!isRecord(card) || !Array.isArray(card['fields'])) return;
      const fields = join(join(path, index), 'fields');
      card['fields'].forEach((entry, inner) => field(entry, join(fields, inner), ofType));
    });
  };
  cards(file['cards'], 'cards');
  if (Array.isArray(file['tabs'])) {
    file['tabs'].forEach((tab, index) => {
      if (isRecord(tab)) cards(tab['cards'], join(join('tabs', index), 'cards'));
    });
  }
  // A review is drawn on a picture's views, which a record shows only with the `picture` schema
  // and without the `video` one, whose player it keeps, as the record page decides it. The page
  // decides for each record, whose run-time facets can add a schema the type's model lacks: this
  // holds the type to it, as the type's records are without such a facet.
  if (isRecord(file['review'])) {
    const schemas = schemasOf(model, type);
    if (!schemas.has('picture'))
      add(
        'review',
        'unknown',
        `a review is drawn on a picture, and the type "${type}" has no "picture" schema: its record page shows no picture`,
      );
    else if (schemas.has('video'))
      add(
        'review',
        'unknown',
        `a review is drawn on a picture, and the type "${type}" has the "video" schema: its record page keeps its player, not its picture`,
      );
  }
  return findings;
}

/** The schemas a document of `type` has: its own, and those of each facet it declares. */
function schemasOf(model: ContentModel, type: string): ReadonlySet<string> {
  const names = new Set(model.types.get(type)?.schemas ?? []);
  for (const facet of model.types.get(type)?.facets ?? [])
    for (const schema of model.facets.get(facet)?.schemas ?? []) names.add(schema);
  return names;
}

/**
 * Why `<prefix>:<name>` is not a property of the type, as helpfully as the model can say: it is
 * written with the schema's name rather than its prefix, or only a facet the type does not declare
 * brings it.
 */
function whyMissing(model: ContentModel, type: string, xpath: string): string {
  const [prefix, name] = xpath.split(':');
  const declared = schemasOf(model, type);
  const named = model.schemas.get(prefix);
  if (named && declared.has(prefix) && named.prefix !== prefix && named.properties.has(name))
    return `"${xpath}" is written "${named.prefix}:${name}": the schema "${prefix}" has the prefix "${named.prefix}"`;
  const bringing = [...model.facets.values()].filter(
    (facet) =>
      !(model.types.get(type)?.facets ?? []).includes(facet.name) &&
      facet.schemas.some((schema) => {
        const read = model.schemas.get(schema);
        return read?.prefix === prefix && read.properties.has(name);
      }),
  );
  if (bringing.length > 0) {
    const names = bringing.map((facet) => `"${facet.name}"`);
    const one = names.length === 1;
    return (
      `"${xpath}" is not a property of the type "${type}": ` +
      `${one ? 'the facet' : 'the facets'} ${names.join(' and ')} ${one ? 'brings' : 'bring'} it, ` +
      `which "${type}" does not declare, so a record shows it only once given ` +
      `${one ? 'that facet' : 'one of them'} at run time`
    );
  }
  return `"${xpath}" is not a property of the type "${type}" or of its facets`;
}
