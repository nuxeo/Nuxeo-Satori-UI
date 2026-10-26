import { formatDate, formatNumber } from '@angular/common';

import { LayoutFieldType } from '../layout.model';
import { humanize } from '../resolve-layout';

/** One rendered value: text, or a boolean the template translates. */
export type ValueView = { readonly text: string } | { readonly flag: boolean };

export interface FieldView {
  /** The xpath at the top level, the bare sub-field name inside a complex value. */
  readonly key: string;
  readonly label: string;
  readonly kind: 'empty' | 'value' | 'chips' | 'groups';
  readonly value?: ValueView;
  readonly chips?: readonly ValueView[];
  /** One group of sub-field rows per complex value. */
  readonly groups?: readonly (readonly FieldView[])[];
}

export interface ValueContext {
  readonly locale: string;
  /** The vocabulary entry's label for an id, or the id itself when it is not known. */
  readonly vocabulary: (directory: string, id: string) => string;
}

/** Complex values nest arbitrarily in Nuxeo; past this depth the rest is shown as JSON. */
const MAX_DEPTH = 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEmpty(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** A value as text, with objects as JSON rather than `[object Object]`. */
function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return JSON.stringify(value) ?? '';
}

function dateView(value: unknown, context: ValueContext): ValueView {
  // In UTC, as formatCompareDate does: a calendar date is stored at midnight UTC, and the
  // browser's timezone would move it to the previous day west of Greenwich.
  const date = new Date(textOf(value));
  if (Number.isNaN(date.getTime())) return { text: textOf(value) };
  return { text: formatDate(date, 'longDate', context.locale, 'UTC') };
}

function numberView(value: unknown, context: ValueContext): ValueView {
  return { text: typeof value === 'number' ? formatNumber(value, context.locale) : textOf(value) };
}

function booleanView(value: unknown): ValueView {
  if (value === true || value === 'true') return { flag: true };
  if (value === false || value === 'false') return { flag: false };
  return { text: textOf(value) };
}

function blobView(value: unknown): ValueView {
  return { text: isRecord(value) && typeof value['name'] === 'string' ? value['name'] : '' };
}

const VIEWS: Readonly<Record<string, (value: unknown, context: ValueContext) => ValueView>> = {
  date: dateView,
  long: numberView,
  integer: numberView,
  double: numberView,
  boolean: booleanView,
  blob: blobView,
};

function scalar(
  type: string,
  directory: string | undefined,
  value: unknown,
  context: ValueContext,
): ValueView {
  const view = VIEWS[type];
  if (view) return view(value, context);
  if (directory && typeof value === 'string') return { text: context.vocabulary(directory, value) };
  return { text: textOf(value) };
}

function subFields(
  definition: LayoutFieldType,
  value: Record<string, unknown>,
  context: ValueContext,
  depth: number,
): FieldView[] {
  const fields = definition.fields ?? {};
  const names = Object.keys(fields).length ? Object.keys(fields) : Object.keys(value);
  return [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) =>
      describeField(
        name,
        humanize(name),
        fields[name] ?? { type: 'string' },
        value[name],
        context,
        depth + 1,
      ),
    );
}

function complexView(
  key: string,
  label: string,
  definition: LayoutFieldType,
  value: unknown,
  list: boolean,
  context: ValueContext,
  depth: number,
): FieldView {
  const items = (list && Array.isArray(value) ? value : [value]).filter(isRecord);
  if (items.length > 0) {
    return {
      key,
      label,
      kind: 'groups',
      groups: items.map((item) => subFields(definition, item, context, depth)),
    };
  }
  return list
    ? { key, label, kind: 'empty' }
    : { key, label, kind: 'value', value: { text: textOf(value) } };
}

function listView(
  key: string,
  label: string,
  type: string,
  definition: LayoutFieldType,
  value: unknown,
  context: ValueContext,
): FieldView {
  const items = (Array.isArray(value) ? value : [value]).filter((item) => !isEmpty(item));
  if (items.length === 0) return { key, label, kind: 'empty' };
  return {
    key,
    label,
    kind: 'chips',
    chips: items.map((item) => scalar(type, definition.directory, item, context)),
  };
}

/** What one field of one document looks like, chosen from its schema type. */
export function describeField(
  key: string,
  label: string,
  definition: LayoutFieldType,
  value: unknown,
  context: ValueContext,
  depth = 0,
): FieldView {
  if (isEmpty(value)) return { key, label, kind: 'empty' };
  const list = definition.type.endsWith('[]');
  const type = list ? definition.type.slice(0, -2) : definition.type;
  if (type === 'complex' && depth < MAX_DEPTH) {
    return complexView(key, label, definition, value, list, context, depth);
  }
  if (list) return listView(key, label, type, definition, value, context);
  return { key, label, kind: 'value', value: scalar(type, definition.directory, value, context) };
}

/** A vocabulary entry a value names: the vocabulary, and the id the document stores. */
export interface VocabularyValue {
  readonly directory: string;
  readonly id: string;
}

type FoundValues = Map<string, VocabularyValue>;

function collectSubFieldValues(
  definition: LayoutFieldType,
  items: readonly Record<string, unknown>[],
  depth: number,
  found: FoundValues,
): void {
  const subs = Object.entries(definition.fields ?? {});
  for (const item of items) {
    for (const [name, sub] of subs) collectValues(sub, item[name], depth + 1, found);
  }
}

function collectValues(
  definition: LayoutFieldType,
  value: unknown,
  depth: number,
  found: FoundValues,
): void {
  if (isEmpty(value)) return;
  const list = definition.type.endsWith('[]');
  const type = list ? definition.type.slice(0, -2) : definition.type;
  const values: unknown[] = list && Array.isArray(value) ? value : [value];
  if (type === 'complex' && depth < MAX_DEPTH) {
    collectSubFieldValues(definition, values.filter(isRecord), depth, found);
    return;
  }
  const directory = definition.directory;
  if (!directory || VIEWS[type]) return;
  for (const id of values) {
    if (typeof id === 'string' && id !== '') found.set(`${directory}\n${id}`, { directory, id });
  }
}

/**
 * The vocabulary entries a document's values name, in its fields and their sub-fields: the
 * entries `describeField` will ask a label for, so only those need reading, however large the
 * vocabulary is. Sorted, so an unchanged document gives an equal list.
 */
export function vocabularyValues(
  fields: readonly { readonly definition: LayoutFieldType; readonly value: unknown }[],
): VocabularyValue[] {
  const found: FoundValues = new Map();
  for (const { definition, value } of fields) collectValues(definition, value, 0, found);
  return [...found.values()].sort(
    (a, b) => a.directory.localeCompare(b.directory) || a.id.localeCompare(b.id),
  );
}
