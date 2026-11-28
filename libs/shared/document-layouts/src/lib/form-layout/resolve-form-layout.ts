import type {
  DocumentSchemaRef,
  DocumentTypeDefinition,
  DocumentTypeSchema,
  LayoutFieldType,
} from '../layout.model';
import { prefixOfXpath } from '../resolve-layout';
import { propertiesReadBy } from '../record-page/record-layout';
import { propertyDefinitions, type SkippedRecordField } from '../record-page/resolve-record-layout';
import { widgetAccepts } from '../record-page/widget-support';
import type {
  FormCardEntry,
  FormComputedField,
  FormFieldEntry,
  FormLayoutFile,
  FormLayoutKind,
  FormPropertyField,
  FormTabEntry,
} from './form-layout';

/** A property field, with what its schema, or its step's variables, say the value is. */
export interface ResolvedFormPropertyField extends FormPropertyField {
  readonly definition: LayoutFieldType;
}

export type ResolvedFormField = ResolvedFormPropertyField | FormComputedField;

export interface ResolvedFormCard extends Omit<FormCardEntry, 'fields'> {
  readonly fields: readonly ResolvedFormField[];
}

export interface ResolvedFormTab extends Omit<FormTabEntry, 'cards'> {
  readonly cards: readonly ResolvedFormCard[];
}

/** A version 2 form file resolved for one type: what its form shows. */
export interface ResolvedFormLayout {
  readonly version: 2;
  readonly kind: FormLayoutKind;
  readonly type: string;
  readonly tabs: readonly ResolvedFormTab[] | null;
  readonly cards: readonly ResolvedFormCard[];
  /**
   * Every property the type and the document's facets define, and in a task form every variable
   * of the step, by `<prefix>:<name>` or `var:<name>`: what a computation's placeholder or
   * parameter may name besides the fields on the form.
   */
  readonly properties: ReadonlyMap<string, LayoutFieldType>;
}

/**
 * The widgets whose input the form does not draw as layout-v2.md, section 3, describes it, each
 * with what it draws instead: the input its property's schema type picks, as a version 1 form
 * does. The console says so once per field.
 */
export const FORM_INPUTS_SHOWN_AS_VERSION_1: Readonly<Record<string, string>> = {
  'rich-text': 'a text area, its HTML as text',
  user: "the stored id, as the property's type edits it",
  group: "the stored id, as the property's type edits it",
  'document-link': "the stored id, as the property's type edits it",
  'status-badge': 'a text field, not a select',
  address: 'each of its subfields, not only its parts',
  table: 'each of its subfields, not only its columns',
  image: 'read-only, its file by name: files are changed in Attachments',
  file: 'read-only, its file by name: files are changed in Attachments',
  'file-list': 'read-only, its files by name: files are changed in Attachments',
};

function fieldsOf(file: FormLayoutFile): readonly FormFieldEntry[] {
  const cards = file.tabs ? file.tabs.flatMap((tab) => tab.cards) : file.cards;
  return cards.flatMap((card) => card.fields);
}

/**
 * The schemas a document's facets add that the form needs read: those whose properties a field
 * edits or a computation reads, as for the record page (`recordFacetSchemasToRead`).
 */
export function formFacetSchemasToRead(
  type: DocumentTypeDefinition,
  documentSchemas: readonly DocumentSchemaRef[],
  file: FormLayoutFile,
): readonly DocumentSchemaRef[] {
  const own = new Set(type.schemas.map((schema) => schema.name));
  const read = new Set<string>();
  for (const field of fieldsOf(file)) {
    if (field.kind === 'property') read.add(field.xpath);
    else propertiesReadBy(field.computed, read);
  }
  const named = new Set([...read].map(prefixOfXpath));
  return documentSchemas.filter((schema) => !own.has(schema.name) && named.has(schema.prefix));
}

/**
 * The file, resolved against a document type, the facet schemas read for it, and in a task form
 * the step's variables. A field whose property, or variable, none of them has is left out, as on
 * the record page; so is a field whose widget does not show its property's type. A card left with
 * no field is left out, and a tab left with no card.
 */
export function resolveFormLayout(
  type: DocumentTypeDefinition,
  file: FormLayoutFile,
  facetSchemas: readonly DocumentTypeSchema[] = [],
  variables: ReadonlyMap<string, LayoutFieldType> = new Map(),
): { readonly layout: ResolvedFormLayout; readonly skipped: readonly SkippedRecordField[] } {
  const properties = new Map([
    ...propertyDefinitions([...type.schemas, ...facetSchemas]),
    ...(file.kind === 'task' ? variables : []),
  ]);
  const skipped: SkippedRecordField[] = [];

  const field = (entry: FormFieldEntry): ResolvedFormField[] => {
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
  const cards = (list: readonly FormCardEntry[]): ResolvedFormCard[] =>
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
      version: 2,
      kind: file.kind,
      type: type.name,
      tabs,
      cards: tabs ? [] : cards(file.cards),
      properties,
    },
    skipped,
  };
}
