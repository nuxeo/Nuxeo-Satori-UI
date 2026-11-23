import { PACKAGED_WIDGETS } from '@agentic-ui/shared/app-definition';

import type {
  DocumentSchemaRef,
  DocumentTypeDefinition,
  DocumentTypeSchema,
  LayoutFieldType,
} from '../layout.model';
import { PRESENTED_SCHEMAS, prefixOfXpath } from '../resolve-layout';
import type {
  RecordCardEntry,
  RecordComputedField,
  RecordFieldEntry,
  RecordLayoutFile,
  RecordPropertyField,
  RecordTabEntry,
} from './record-layout';

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

/** A `view` file resolved for one document: what its record page shows. */
export interface ResolvedRecordLayout {
  readonly type: string;
  readonly columns: number;
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

/**
 * The property type a widget's `accepts` is written in. Nuxeo reports some numeric fields as
 * `integer`, which the widgets, like the schema language, call `long`.
 */
export function widgetPropertyType(definition: LayoutFieldType): string {
  return definition.type.replace(/^integer(?=$|\[\]$)/, 'long');
}

/** Whether `widget` shows a property of this type (layout-v2.md, section 3). */
export function widgetAccepts(widget: string, definition: LayoutFieldType): boolean {
  const accepts: readonly string[] | undefined = PACKAGED_WIDGETS[widget]?.accepts;
  return accepts?.includes(widgetPropertyType(definition)) ?? false;
}

function propertyFields(file: RecordLayoutFile): readonly RecordPropertyField[] {
  const cards = file.tabs ? file.tabs.flatMap((tab) => tab.cards) : file.cards;
  return cards.flatMap((card) =>
    card.fields.filter((field): field is RecordPropertyField => field.kind === 'property'),
  );
}

/**
 * The schemas a document's facets add that the record page needs read: those the file's fields
 * name a property of. As `facetSchemasToRead` does for version 1, a facet schema no field names
 * is not read at all.
 */
export function recordFacetSchemasToRead(
  type: DocumentTypeDefinition,
  documentSchemas: readonly DocumentSchemaRef[],
  file: RecordLayoutFile,
): readonly DocumentSchemaRef[] {
  const own = new Set(type.schemas.map((schema) => schema.name));
  const named = new Set(propertyFields(file).map((field) => prefixOfXpath(field.xpath)));
  return documentSchemas.filter(
    (schema) =>
      !own.has(schema.name) && named.has(schema.prefix) && !PRESENTED_SCHEMAS.has(schema.name),
  );
}

/**
 * The file, resolved against a document's type and the facet schemas read for it. A field whose
 * property neither has is left out, as version 1 leaves one out; so is a field whose widget does
 * not show its property's type, which the pipeline cannot check without the content model and
 * the app can, from the schemas it has just read. A card left with no field is left out, and a tab
 * left with no card.
 */
export function resolveRecordLayout(
  type: DocumentTypeDefinition,
  file: RecordLayoutFile,
  facetSchemas: readonly DocumentTypeSchema[] = [],
): { readonly layout: ResolvedRecordLayout; readonly skipped: readonly SkippedRecordField[] } {
  const properties = new Map<string, LayoutFieldType>();
  for (const schema of [...type.schemas, ...facetSchemas]) {
    for (const [name, definition] of Object.entries(schema.fields)) {
      properties.set(`${schema.prefix}:${name}`, definition);
    }
  }
  const skipped: SkippedRecordField[] = [];

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
    return [{ ...entry, definition }];
  };

  // Mapped before they are filtered, so a field in a card that is itself left out is still reported.
  const cards = (list: readonly RecordCardEntry[]): ResolvedRecordCard[] =>
    list
      .map((card) => ({ ...card, fields: card.fields.flatMap(field) }))
      .filter((card) => card.fields.length > 0);

  const tabs = file.tabs
    ? file.tabs
        .map((tab) => ({ ...tab, cards: cards(tab.cards) }))
        .filter((tab) => tab.cards.length > 0)
    : null;
  return {
    layout: {
      type: type.name,
      columns: file.columns,
      tabs,
      cards: tabs ? [] : cards(file.cards),
      properties,
    },
    skipped,
  };
}
