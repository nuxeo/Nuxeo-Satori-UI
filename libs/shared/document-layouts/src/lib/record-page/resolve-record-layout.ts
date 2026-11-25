import { CHECKLIST_SUBFIELDS } from '@agentic-ui/shared/app-definition';

import type {
  DocumentSchemaRef,
  DocumentTypeDefinition,
  DocumentTypeSchema,
  LayoutFieldType,
} from '../layout.model';
import { prefixOfXpath } from '../resolve-layout';
import {
  propertiesReadBy,
  type RecordBannerEntry,
  type RecordCardEntry,
  type RecordChecklistEntry,
  type RecordComputedField,
  type RecordFieldEntry,
  type RecordLayoutFile,
  type RecordPropertyField,
  type RecordTabEntry,
} from './record-layout';
import {
  WIDGETS_SHOWN_AS_VERSION_1,
  own,
  tableColumns,
  widgetAccepts,
  widgetPropertyType,
} from './widget-support';

export { widgetAccepts, widgetPropertyType } from './widget-support';

/** A property field, with what its schema says the property is. */
export interface ResolvedPropertyField extends RecordPropertyField {
  readonly definition: LayoutFieldType;
}

export type ResolvedRecordField = ResolvedPropertyField | RecordComputedField;

export interface ResolvedRecordCard extends Omit<RecordCardEntry, 'fields'> {
  readonly fields: readonly ResolvedRecordField[];
}

export interface ResolvedRecordTab extends Omit<RecordTabEntry, 'cards'> {
  readonly cards: readonly ResolvedRecordCard[];
}

/**
 * What a record page shows of the record's own file before its cards, for a record whose file is
 * its content: `picture`, a Picture's views, for a record with the `picture` schema; `null` for a
 * record with no such file.
 */
export type RecordPreview = 'picture' | null;

/** A `view` file resolved for one document: what its record page shows. */
export interface ResolvedRecordLayout {
  readonly type: string;
  readonly columns: number;
  readonly banners: readonly RecordBannerEntry[];
  readonly preview: RecordPreview;
  readonly tabs: readonly ResolvedRecordTab[] | null;
  readonly cards: readonly ResolvedRecordCard[];
  /**
   * Every property the type and the document's facets define, by `<prefix>:<name>`: what a
   * computation's placeholder or parameter may name besides the fields on the page.
   */
  readonly properties: ReadonlyMap<string, LayoutFieldType>;
}

/** Why a field was left out when the file was resolved against the document's type. */
export interface SkippedRecordField {
  readonly place: string;
  readonly xpath: string;
  readonly reason: 'not-on-type' | 'widget-type';
  /** For `widget-type`: the widget, and the property type it does not show. */
  readonly widget?: string;
  readonly type?: string;
}

function cardsOf(file: RecordLayoutFile): readonly RecordCardEntry[] {
  return file.tabs ? file.tabs.flatMap((tab) => tab.cards) : file.cards;
}

function fieldsOf(file: RecordLayoutFile): readonly RecordFieldEntry[] {
  return cardsOf(file).flatMap((card) => card.fields);
}

/**
 * Why a checklist's property cannot hold its items' state, as the console says it, or `null` when
 * it can: a list of complex values whose subfields, where the schema lists them, are
 * `CHECKLIST_SUBFIELDS`, each of its type. With no subfields read, as for a table, it is taken as
 * written, and an entry's missing subfield reads as not done.
 */
function checklistShapeProblem(
  checklist: RecordChecklistEntry,
  definition: LayoutFieldType,
): string | null {
  const type = widgetPropertyType(definition);
  if (type !== 'complex[]')
    return `a checklist reads a list of complex values, and ${checklist.field} is a ${type} property`;
  const subfields = definition.fields ?? {};
  if (Object.keys(subfields).length === 0) return null;
  for (const [name, wanted] of Object.entries(CHECKLIST_SUBFIELDS)) {
    const sub = own(subfields, name);
    if (!sub) return `${checklist.field} has no subfield "${name}", which a checklist reads`;
    const read = widgetPropertyType(sub);
    if (read !== wanted)
      return `"${name}" of ${checklist.field} is a ${read} value, and a checklist reads it as a ${wanted}`;
  }
  return null;
}

/** Every property `schemas` define, by `<prefix>:<name>`. */
export function propertyDefinitions(
  schemas: readonly DocumentTypeSchema[],
): Map<string, LayoutFieldType> {
  const properties = new Map<string, LayoutFieldType>();
  for (const schema of schemas) {
    for (const [name, definition] of Object.entries(schema.fields)) {
      properties.set(`${schema.prefix}:${name}`, definition);
    }
  }
  return properties;
}

/**
 * The schemas a document's facets add that the record page needs read: those whose properties a
 * field shows or a computation reads. As `facetSchemasToRead` does for version 1, a facet schema
 * nothing names is not read, and one a field names is read even where the panel presents it.
 */
export function recordFacetSchemasToRead(
  type: DocumentTypeDefinition,
  documentSchemas: readonly DocumentSchemaRef[],
  file: RecordLayoutFile,
): readonly DocumentSchemaRef[] {
  const own = new Set(type.schemas.map((schema) => schema.name));
  const read = new Set<string>();
  for (const field of fieldsOf(file)) {
    if (field.kind === 'property') read.add(field.xpath);
    else propertiesReadBy(field.computed, read);
  }
  for (const card of cardsOf(file)) if (card.checklist) read.add(card.checklist.field);
  const named = new Set([...read].map(prefixOfXpath));
  return documentSchemas.filter((schema) => !own.has(schema.name) && named.has(schema.prefix));
}

/**
 * A table field's columns, held to its property's subfields as a field is held to its type: a
 * column naming a subfield the property does not have is left out, and the console is told of a
 * column whose widget does not show its subfield or is shown as version 1 would. Each note is
 * whole, as the console prints it after the layout's name.
 */
function resolveTableColumns(
  field: RecordPropertyField,
  definition: LayoutFieldType,
): { readonly parameters: Readonly<Record<string, unknown>>; readonly notes: readonly string[] } {
  // Checked only where the schema lists them: with no subfields read, as version 1 does, the
  // columns are taken as written.
  const subfields = Object.keys(definition.fields ?? {}).length > 0 ? definition.fields : null;
  const written: readonly unknown[] = Array.isArray(field.parameters['columns'])
    ? field.parameters['columns']
    : [];
  const notes: string[] = [];
  const left = new Set<number>();
  for (const column of tableColumns(written)) {
    const place = `${field.place}.parameters.columns[${column.index}]`;
    if (!subfields) continue;
    const sub = own(subfields, column.subfield);
    if (!sub) {
      left.add(column.index);
      notes.push(`${place} left out: ${field.xpath} has no subfield "${column.subfield}"`);
    } else if (column.widget !== null && WIDGETS_SHOWN_AS_VERSION_1.has(column.widget)) {
      notes.push(
        `${place}: the widget "${column.widget}" shows the subfield's own value in this build`,
      );
    } else if (column.widget === 'document-link' && widgetAccepts(column.widget, sub)) {
      // A table's cell is one line of text: the record's title, without its link.
      notes.push(`${place}: a table's cell shows the linked record's title, without its link`);
    } else if (column.widget !== null && !widgetAccepts(column.widget, sub)) {
      notes.push(
        `${place}: the widget "${column.widget}" does not show "${column.subfield}", a ${widgetPropertyType(sub)} value, so the cell shows the value itself`,
      );
    }
  }
  if (left.size === 0) return { parameters: field.parameters, notes };
  return {
    parameters: { ...field.parameters, columns: written.filter((_, index) => !left.has(index)) },
    notes,
  };
}

/**
 * The file, resolved against a document's type and the facet schemas read for it. A field whose
 * property neither has is left out, as version 1 leaves one out; so is a field whose widget does
 * not show its property's type, which the pipeline cannot check without the content model and
 * the app can, from the schemas it has just read. A card left with no field is left out, and a tab
 * left with no card. A card of related records is kept as it is.
 */
export function resolveRecordLayout(
  type: DocumentTypeDefinition,
  file: RecordLayoutFile,
  facetSchemas: readonly DocumentTypeSchema[] = [],
  preview: RecordPreview = null,
): {
  readonly layout: ResolvedRecordLayout;
  readonly skipped: readonly SkippedRecordField[];
  /** What the console is told about a table's columns, each note whole. */
  readonly notes: readonly string[];
} {
  const properties = propertyDefinitions([...type.schemas, ...facetSchemas]);
  const skipped: SkippedRecordField[] = [];
  const notes: string[] = [];

  const field = (entry: RecordFieldEntry): ResolvedRecordField[] => {
    if (entry.kind === 'computed') return [entry];
    const definition = properties.get(entry.xpath);
    if (!definition) {
      skipped.push({ place: entry.place, xpath: entry.xpath, reason: 'not-on-type' });
      return [];
    }
    if (entry.widget !== null && !widgetAccepts(entry.widget, definition)) {
      skipped.push({
        place: entry.place,
        xpath: entry.xpath,
        reason: 'widget-type',
        widget: entry.widget,
        type: definition.type,
      });
      return [];
    }
    if (entry.widget === 'table') {
      const table = resolveTableColumns(entry, definition);
      notes.push(...table.notes);
      return [{ ...entry, parameters: table.parameters, definition }];
    }
    return [{ ...entry, definition }];
  };

  /**
   * Whether a checklist's card stays: its property is on the type, and can hold the items' state.
   * One that is not is left out whole, as a field is, since no item could be read as done.
   */
  const checklistKept = (card: RecordCardEntry, checklist: RecordChecklistEntry): boolean => {
    const definition = properties.get(checklist.field);
    if (!definition) {
      skipped.push({ place: card.place, xpath: checklist.field, reason: 'not-on-type' });
      return false;
    }
    const problem = checklistShapeProblem(checklist, definition);
    if (problem) notes.push(`${card.place} left out: ${problem}`);
    return problem === null;
  };

  // Mapped before they are filtered, so a field in a card that is itself left out is still reported.
  const cards = (list: readonly RecordCardEntry[]): ResolvedRecordCard[] =>
    list
      .filter((card) => card.checklist === null || checklistKept(card, card.checklist))
      .map((card) => ({ ...card, fields: card.fields.flatMap(field) }))
      // A card of related records has no fields of its own: its columns are its rows' properties,
      // held to the rows' types when they are drawn. Nor has a timeline or comments, nor a card
      // from another system, whose fields are that system's, not the record's, nor a checklist,
      // whose property was held to the type above.
      .filter(
        (card) =>
          card.related !== null ||
          card.timeline !== null ||
          card.comments !== null ||
          card.external !== null ||
          card.checklist !== null ||
          card.fields.length > 0,
      );

  const tabs = file.tabs
    ? file.tabs
        .map((tab) => ({ ...tab, cards: cards(tab.cards) }))
        .filter((tab) => tab.cards.length > 0)
    : null;
  return {
    layout: {
      type: type.name,
      columns: file.columns,
      banners: file.banners,
      preview,
      tabs,
      cards: tabs ? [] : cards(file.cards),
      properties,
    },
    skipped,
    notes,
  };
}
