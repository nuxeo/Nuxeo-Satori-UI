import { formatDate, formatNumber } from '@angular/common';

import { LayoutFieldType } from '../layout.model';
import { isDocumentId } from '../record-page/linked-record';
import type { RecordLink } from '../record-page/record-field-view';
import { humanize } from '../resolve-layout';
import { isStoredCalendarDay } from './stored-calendar-day';

/**
 * One rendered value: text, a boolean the template translates, or the record a document reference
 * names, as a link that opens it or the unavailable text. Never a reference's stored id.
 */
export type ValueView =
  { readonly text: string } | { readonly flag: boolean } | { readonly record: RecordLink };

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
  /**
   * How a `date` value shows, at any depth of a complex value. Absent, version 1's own rule: a
   * stored day in UTC, and an instant in {@link timeZone}. The record page gives the `date`
   * widget's rule, so that its fields, cells and placeholders show a date the one way.
   */
  readonly date?: (value: unknown) => ValueView;
  /**
   * The zone an instant is shown in: absent, the reader's own, as the panel leaves it; an offset
   * such as `+0530`, so that a test controls it. A stored day is shown in UTC whatever this is.
   */
  readonly timeZone?: string;
  /**
   * The record a document reference names ({@link LayoutFieldType.documentReference}): its title
   * and route, the unavailable text where it cannot be shown, or `null` while it is read. The
   * Properties panel gives it. Absent, as on the record page, a reference shows its stored value.
   */
  readonly record?: (id: string) => RecordLink | null;
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

/**
 * A date as a long date: a stored day in UTC, an instant in the reader's zone (pattern 29).
 *
 * A stored day, `2024-03-06T00:00:00.000Z`, is formatted in UTC, where Nuxeo and the edit form
 * anchor it, so every reader sees the day that was written; in the reader's zone it would be 5
 * March west of Greenwich. An instant, such as `dc:created` at `2026-11-23T20:00:00Z`, is formatted
 * in the reader's zone, so that a reader at +05:30 sees 24 November, the day it was there. In UTC
 * it would be the 23rd, which is the day it was in London and not where the reader is.
 */
function dateView(value: unknown, context: ValueContext): ValueView {
  if (context.date) return context.date(value);
  const date = new Date(textOf(value));
  if (Number.isNaN(date.getTime())) return { text: textOf(value) };
  const zone = isStoredCalendarDay(value) ? 'UTC' : context.timeZone;
  return { text: formatDate(date, 'longDate', context.locale, zone) };
}

/**
 * Angular refuses a larger maximum: "Exceeded maximum limits of 100 digits" (NG02306). Measured,
 * not read off the spec — ECMA-402 and Angular's own validator do not have to agree.
 */
const MAX_FRACTION_DIGITS = 100;

/**
 * Fraction digits needed to write `value` out exactly, read off its shortest round-trip form.
 *
 * `String(value)` is that form, and it is the one the edit form and `nxsPropertyText` show, so
 * matching it is what makes the view and the form agree. The exponent has to be folded in:
 * `1e-21` carries no fraction digits in its mantissa but needs 21 of them written out, and
 * `1e+21` needs none at all.
 */
function fractionDigitsOf(value: number): number {
  const text = String(value);
  const exponent = /e([+-]\d+)$/i.exec(text);
  const mantissa = exponent ? text.slice(0, exponent.index) : text;
  const afterPoint = mantissa.split('.')[1]?.length ?? 0;
  if (!exponent) return afterPoint;
  return Math.max(0, afterPoint - Number(exponent[1]));
}

/**
 * A number at full precision, never rounded (NXSAT-725).
 *
 * `formatNumber`'s own default is `1.0-3`, which showed `3.14159265` as `3.142` and — worse —
 * `0.0004` as `0`, a non-zero measurement reading as absent with nothing on screen to say the
 * value had been cut.
 *
 * The precision is derived per value rather than capped at a constant. A fixed maximum only
 * moves the same defect further out: at `1.0-20`, which this first shipped as, `1e-21` still
 * rendered as `0` and `1.23456789012345e-7` still lost digits, because a digits format counts
 * fractional *places* and not significant ones (caught in review on PR 515). Deriving it means
 * there is no magnitude at which the panel shows a number that is not the stored one.
 *
 * Above Angular's ceiling — only a denormal gets there — the round-trip form is the only exact
 * one left, so it is used directly. That loses the locale's grouping, which a value of that size
 * has no integer part to need.
 *
 * It stays `formatNumber` elsewhere precisely for that grouping: `2480` shows as `2,480`, and a
 * small value as `0.0000001` rather than `1e-7`. Angular's formatter does not expand a double's
 * binary representation the way `toFixed` does, so `0.1` stays `0.1`.
 */
function numberView(value: unknown, context: ValueContext): ValueView {
  if (typeof value !== 'number') return { text: textOf(value) };
  const digits = fractionDigitsOf(value);
  if (digits > MAX_FRACTION_DIGITS) return { text: textOf(value) };
  return { text: formatNumber(value, context.locale, `1.0-${digits}`) };
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

/** How the context reads the record a value of `definition` names, if it is a reference. */
function referenceLookup(
  definition: LayoutFieldType,
  type: string,
  context: ValueContext,
): ValueContext['record'] {
  return definition.documentReference && type === 'string' ? context.record : undefined;
}

function subFields(
  definition: LayoutFieldType,
  value: Record<string, unknown>,
  context: ValueContext,
  depth: number,
): FieldView[] {
  const fields = definition.fields ?? {};
  const names = Object.keys(fields).length ? Object.keys(fields) : Object.keys(value);
  // Own keys only, of both: with no subfields read, the names are the value's own, and one that
  // every object inherits, `constructor` for one, found a function in `{}` where a type was
  // expected, and describing it threw.
  return [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) =>
      describeField(
        name,
        humanize(name),
        (Object.hasOwn(fields, name) ? fields[name] : undefined) ?? { type: 'string' },
        Object.hasOwn(value, name) ? value[name] : undefined,
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
  const record = referenceLookup(definition, type, context);
  if (record) {
    // A record still being read is not listed yet: the field shows nothing of it, never its id.
    const records = items
      .map((item) => record(textOf(item)))
      .filter((link): link is RecordLink => link !== null);
    return { key, label, kind: 'chips', chips: records.map((link) => ({ record: link })) };
  }
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
  const record = referenceLookup(definition, type, context);
  if (record) {
    // While the record is read the field shows nothing, never its id.
    const link = record(textOf(value));
    return { key, label, kind: 'value', value: link === null ? { text: '' } : { record: link } };
  }
  return { key, label, kind: 'value', value: scalar(type, definition.directory, value, context) };
}

/** A vocabulary entry a value names: the vocabulary, and the id the document stores. */
export interface VocabularyValue {
  readonly directory: string;
  readonly id: string;
}

type ShownValues = readonly { readonly definition: LayoutFieldType; readonly value: unknown }[];

/**
 * Calls `visit` with the scalar values one value holds, its sub-fields' included, each with its
 * definition and its type without `[]`: the values `describeField` shows, to the same depth.
 */
function visitScalars(
  definition: LayoutFieldType,
  value: unknown,
  depth: number,
  visit: (definition: LayoutFieldType, type: string, values: readonly unknown[]) => void,
): void {
  if (isEmpty(value)) return;
  const list = definition.type.endsWith('[]');
  const type = list ? definition.type.slice(0, -2) : definition.type;
  const values: unknown[] = list && Array.isArray(value) ? value : [value];
  if (type === 'complex' && depth < MAX_DEPTH) {
    const subs = Object.entries(definition.fields ?? {});
    for (const item of values.filter(isRecord)) {
      // Own keys only, as `subFields` reads them.
      for (const [name, sub] of subs) {
        visitScalars(sub, Object.hasOwn(item, name) ? item[name] : undefined, depth + 1, visit);
      }
    }
    return;
  }
  visit(definition, type, values);
}

/**
 * The vocabulary entries a document's values name, in its fields and their sub-fields: the
 * entries `describeField` will ask a label for, so only those need reading, however large the
 * vocabulary is. Sorted, so an unchanged document gives an equal list.
 */
export function vocabularyValues(fields: ShownValues): VocabularyValue[] {
  const found = new Map<string, VocabularyValue>();
  for (const { definition, value } of fields) {
    visitScalars(definition, value, 0, ({ directory }, type, values) => {
      if (!directory || VIEWS[type]) return;
      for (const id of values) {
        if (typeof id === 'string' && id !== '')
          found.set(`${directory}\n${id}`, { directory, id });
      }
    });
  }
  return [...found.values()].sort(
    (a, b) => a.directory.localeCompare(b.directory) || a.id.localeCompare(b.id),
  );
}

/**
 * The ids a document's references hold ({@link LayoutFieldType.documentReference}), in its fields
 * and their sub-fields: the records `describeField` asks its context's `record` for. Each once and
 * sorted, so an unchanged document gives an equal list; and only a document's id, as
 * `isDocumentId` accepts one, so a value that is not one is never asked for.
 */
export function linkedRecordIds(fields: ShownValues): string[] {
  const found = new Set<string>();
  for (const { definition, value } of fields) {
    visitScalars(definition, value, 0, ({ documentReference }, type, values) => {
      if (!documentReference || type !== 'string') return;
      for (const id of values) if (isDocumentId(id)) found.add(id);
    });
  }
  return [...found].sort();
}
