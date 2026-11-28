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
 * - **A banner's link** names a string property of the type, which holds the linked record's id.
 * - **A related list's `create`** names a type of the model, and a string property of that type,
 *   which takes the open record's id.
 * - **A `document-link`'s `show`**, in a card's field or a related list's column, names a property
 *   of every type its `types` lists ({@link linkedShowFindings}): the linked records' types, which
 *   the file says, though a related list's own type it does not.
 * - **A review**, and **share links**, are for a type with the `picture` schema and without the
 *   `video` one, the records whose page shows a picture.
 * - **A capture's property** is a list of files on the type: a list of complex values with a
 *   `file` subfield that is a blob, as `files:files` is, or a list of blobs. Each property its
 *   `findBy` names is a single text on the type.
 *
 * Each finding is `unknown` or `parameter`, never `structure`, so that the app, loading a file
 * tolerantly, would leave out the field it is in and show the rest. It runs once the file's own
 * checks have: an entry that is malformed already has a finding, and is passed over here.
 *
 * - **What a rule, a computation, a check, a widget's parameter or a related list's parameter
 *   reads** of the open record is a property of the type, as the checker collected them
 *   (`PropertyReference`), when the caller asks (`ValidationOptions.references`): a banner whose
 *   rule names one it lacks would never show. The server's own `ecm:` properties are in no
 *   schema, and are not looked for; a property a facet of the model brings is read on a record
 *   given that facet at run time, and is let be.
 *
 * Not checked against the model: a related list's columns, which are the listed records' and not
 * this type's, but for their `show`; what a table's or a related list's column computes or gives a
 * widget, which may be the row's; and a vocabulary widget's `directory` against the one the
 * property is bound to. Nor whether a `document-link`'s property, or the one its `show` names, is a document
 * reference: the model reader does not read resolvers. The record page refuses a `show` naming a
 * reference, which it can tell from the linked type's schema.
 *
 * Stricter than the record page in two places, as the pipeline is meant to be: a column whose
 * widget does not show its subfield is refused here, where the page shows the value itself; and a
 * table inside a table's column is held to its subfield's subfields, though the page does not draw
 * one yet.
 */
import { join, type Finding, type LinkedRead, type PropertyReference } from './checker';
import {
  propertiesOf,
  propertyTypeOf,
  type ContentModel,
  type PropertyModel,
} from './content-model';
import { isRecord, linkedShowOf, XPATH, type Registries } from './registries';

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

/**
 * A `document-link` entry's `show` held to the content model (layout-v2.md, section 12): the
 * property it names is one of every type its `types` lists, on the type or a facet it declares,
 * since the linked record may be of any of them. An `unknown` finding for each type that lacks it,
 * and for one the model does not have. An entry with no `show`, or whose `show` or `types` is
 * malformed and has its finding already, has none here.
 */
export function linkedShowFindings(
  entry: unknown,
  path: string,
  model: ContentModel,
  registries?: Registries,
): Finding[] {
  if (!isRecord(entry) || entry['widget'] !== 'document-link') return [];
  const parameters = entry['parameters'];
  if (!isRecord(parameters)) return [];
  const shown = linkedShowOf(parameters['show']);
  const { types } = parameters;
  if (shown === null || !Array.isArray(types)) return [];
  const at = join(join(path, 'parameters'), 'show');
  const findings = linkedPropertyFindings(shown.field, types, at, model, 'the field links to');
  // The widget it is shown through, held to the property's type on each type that has it, as a
  // field's widget is to its own property's.
  const widget = shown.widget;
  if (widget === null || !registries || !Object.hasOwn(registries.widgets, widget)) return findings;
  const accepts = registries.widgets[widget].accepts as readonly string[];
  for (const linked of types) {
    const property =
      typeof linked === 'string' ? propertiesOf(model, linked)?.get(shown.field) : undefined;
    if (!property) continue;
    const type = propertyTypeOf(property);
    if (!accepts.includes(type))
      findings.push({
        path: join(at, 'widget'),
        kind: 'parameter',
        message: `the widget "${widget}" does not show "${shown.field}" of "${linked}", a ${type} property: it takes ${accepts.join(' or ')}`,
      });
  }
  return findings;
}

/**
 * A linked record's property held to the content model: one of every type `types` lists, on the
 * type or a facet it declares, since the linked record may be of any of them. An `unknown` finding
 * for each type that lacks it, and for one the model does not have. `what` names who links: the
 * field, or a rule.
 */
function linkedPropertyFindings(
  show: string,
  types: readonly unknown[],
  at: string,
  model: ContentModel,
  what: string,
): Finding[] {
  if (!XPATH.test(show)) return [];
  return types.flatMap((linked): Finding[] => {
    if (typeof linked !== 'string' || linked === '') return [];
    if (!propertiesOf(model, linked))
      return [
        {
          path: at,
          kind: 'unknown',
          message: `the type "${linked}" that "types" lists is not in the content model, so "${show}" cannot be found on it`,
        },
      ];
    return propertiesOf(model, linked)?.has(show)
      ? []
      : [
          {
            path: at,
            kind: 'unknown',
            message: `${whyMissing(model, linked, show)}, one of the types ${what}`,
          },
        ];
  });
}

/**
 * The linked records' properties a file's rules read (layout-v2.md, section 5), held to the model:
 * the reference, where the type has it, one text holding one record's id, as a banner's link is;
 * and the property `show` names, on every type `types` lists, as a `document-link`'s `show` is.
 * Whether the type has the reference at all is the references' check, as for any property a rule
 * reads.
 */
function linkedReadFindings(
  reads: readonly LinkedRead[],
  properties: ReadonlyMap<string, PropertyModel>,
  model: ContentModel,
): Finding[] {
  return reads.flatMap(({ reference, path }): Finding[] => {
    const findings: Finding[] = [];
    const property = properties.get(reference.field);
    if (property) {
      const type = propertyTypeOf(property);
      if (type !== 'string')
        findings.push({
          path: join(path, 'field'),
          kind: 'parameter',
          message: `a rule reads one linked record, by a string property holding its id, and "${reference.field}" is a ${type} property`,
        });
    }
    findings.push(
      ...linkedPropertyFindings(
        reference.show,
        reference.types,
        join(path, 'show'),
        model,
        'the rule links to',
      ),
    );
    return findings;
  });
}

export function againstModel(
  file: Record<string, unknown>,
  type: string | undefined,
  model: ContentModel,
  registries: Registries,
  references: readonly PropertyReference[] = [],
  linkedReads: readonly LinkedRead[] = [],
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
    if (scope === ofType) findings.push(...linkedShowFindings(entry, path, model, registries));
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

  /**
   * A related list's "New": the type it creates is in the model, and the property given the open
   * record's id is one of that type's, a single text, as a reference holding one record's id is.
   */
  const created = (entry: Record<string, unknown>, path: string): void => {
    const target = entry['type'];
    const name = entry['field'];
    // A malformed name has its finding already.
    if (typeof target !== 'string') return;
    const of = propertiesOf(model, target);
    if (!of) {
      add(
        join(path, 'type'),
        'unknown',
        `the document type "${target}" is not in the content model`,
      );
      return;
    }
    if (typeof name !== 'string' || !XPATH.test(name)) return;
    const property = of.get(name);
    if (!property) {
      add(join(path, 'field'), 'unknown', whyMissing(model, target, name));
      return;
    }
    const shown = propertyTypeOf(property);
    if (shown !== 'string')
      add(
        join(path, 'field'),
        'parameter',
        `a new record takes the open record's id in a string property, and "${name}" is a ${shown} property`,
      );
  };

  const cards = (list: unknown, path: string): void => {
    if (!Array.isArray(list)) return;
    list.forEach((card, index) => {
      if (isRecord(card) && isRecord(card['checklist']))
        checklist(card['checklist'], join(join(path, index), 'checklist'));
      // A card of related records lists other records, whose type this file does not say: only
      // what a column's `show` names is checked, against the types the column says it links to.
      if (
        isRecord(card) &&
        isRecord(card['related']) &&
        Array.isArray(card['related']['columns'])
      ) {
        const columns = join(join(join(path, index), 'related'), 'columns');
        card['related']['columns'].forEach((column, inner) =>
          findings.push(...linkedShowFindings(column, join(columns, inner), model, registries)),
        );
      }
      if (isRecord(card) && isRecord(card['related']) && isRecord(card['related']['create']))
        created(card['related']['create'], join(join(join(path, index), 'related'), 'create'));
      if (!isRecord(card) || !Array.isArray(card['fields'])) return;
      const fields = join(join(path, index), 'fields');
      card['fields'].forEach((entry, inner) => field(entry, join(fields, inner), ofType));
    });
  };
  // A banner's link names one record, by a text property of the type: a list would name several.
  if (Array.isArray(file['banners'])) {
    file['banners'].forEach((banner, index) => {
      const name = isRecord(banner) && isRecord(banner['link']) ? banner['link']['field'] : null;
      // A malformed name has its finding already.
      if (typeof name !== 'string' || !XPATH.test(name)) return;
      const at = join(join(join('banners', index), 'link'), 'field');
      const property = properties.get(name);
      if (!property) {
        add(at, 'unknown', whyMissing(model, type, name));
        return;
      }
      const shown = propertyTypeOf(property);
      if (shown !== 'string')
        add(
          at,
          'parameter',
          `a banner links one record, by a string property holding its id, and "${name}" is a ${shown} property`,
        );
    });
  }
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
  // Share links serve a picture's views, and are drawn with the picture: the same rule.
  if (isRecord(file['shareLinks'])) {
    const schemas = schemasOf(model, type);
    if (!schemas.has('picture'))
      add(
        'shareLinks',
        'unknown',
        `share links serve a picture's views, and the type "${type}" has no "picture" schema: its record page shows no picture`,
      );
    else if (schemas.has('video'))
      add(
        'shareLinks',
        'unknown',
        `share links serve a picture's views, and the type "${type}" has the "video" schema: its record page keeps its player, not its picture`,
      );
  }
  /**
   * A capture adds each photo to its property, as `Blob.AttachOnDocument` adds a file to a list:
   * a `{ "file": <blob> }` entry to a list of complex values, a blob to a list of blobs. A single
   * blob would be replaced by each photo in turn. A number is looked up as one text.
   */
  const capture = (entry: Record<string, unknown>): void => {
    const name = entry['property'];
    // A malformed name has its finding already.
    if (typeof name === 'string' && XPATH.test(name)) {
      const at = join('capture', 'property');
      const property = properties.get(name);
      if (!property) add(at, 'unknown', whyMissing(model, type, name));
      else {
        const shown = propertyTypeOf(property);
        const file = property.fields?.get('file');
        // With no subfields read, as for a table, a list of complex values is taken as written.
        const read = (property.fields?.size ?? 0) > 0;
        if (shown === 'complex[]') {
          if (read && (!file || propertyTypeOf(file) !== 'blob'))
            add(
              at,
              'parameter',
              `a capture adds each photo to a list of files, and the entries of "${name}" have no "file" subfield that is a blob`,
            );
        } else if (shown !== 'blob[]')
          add(
            at,
            'parameter',
            `a capture adds each photo to a list of files, and "${name}" is a ${shown} property`,
          );
      }
    }
    const findBy = entry['findBy'];
    if (!Array.isArray(findBy)) return;
    findBy.forEach((each, index) => {
      // A malformed name has its finding already.
      if (typeof each !== 'string' || !XPATH.test(each)) return;
      const at = join(join('capture', 'findBy'), index);
      const property = properties.get(each);
      if (!property) add(at, 'unknown', whyMissing(model, type, each));
      else if (propertyTypeOf(property) !== 'string')
        add(
          at,
          'parameter',
          `a capture looks a number up in a text, and "${each}" is a ${propertyTypeOf(property)} property`,
        );
    });
  };
  if (isRecord(file['capture'])) capture(file['capture']);
  // What a rule, a computation, a check or a parameter reads of the open record: a property it
  // does not have reads nothing, so a banner whose rule names one never shows, and a required
  // field never is. The server's own `ecm:` properties are in no schema. A property a facet of the
  // model brings, which the type does not declare, is read on a record given that facet at run
  // time, as a rule guarded by `app.rules.hasFacet` reads it, and is let be.
  const facetProperties = new Set<string>();
  for (const facet of model.facets.values())
    for (const schema of facet.schemas) {
      const read = model.schemas.get(schema);
      for (const name of read?.properties.keys() ?? [])
        facetProperties.add(`${read?.prefix}:${name}`);
    }
  for (const { xpath, path, by } of references) {
    if (xpath.startsWith('ecm:') || properties.has(xpath) || facetProperties.has(xpath)) continue;
    add(path, 'unknown', `${whyMissing(model, type, xpath)}, so the ${by} naming it reads nothing`);
  }
  findings.push(...linkedReadFindings(linkedReads, properties, model));
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
