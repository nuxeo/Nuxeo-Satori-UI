import { formatDate, formatNumber, formatPercent } from '@angular/common';

import { describeField, type FieldView } from '../document-layout/field-view';
import type { LayoutFieldType, LayoutLabel } from '../layout.model';
import { humanize } from '../resolve-layout';
import { WIDGETS_SHOWN_AS_VERSION_1, tableColumns, widgetAccepts } from './widget-support';

export { WIDGETS_SHOWN_AS_VERSION_1 } from './widget-support';

/**
 * How the record page shows one value through a registered widget (layout-v2.md, section 3).
 *
 * Pure functions from a value to a view, so every widget is tested without a browser, as
 * version 1's `describeField` is. A field with no widget is shown by version 1's own function, so
 * the two versions show an unannotated property the same way.
 */

export type Tone = 'positive' | 'warning' | 'negative' | 'info' | 'neutral';

export type RecordValueView =
  | { readonly kind: 'empty' }
  | { readonly kind: 'text'; readonly text: string }
  /** Text whose line breaks show: `long-text`. */
  | { readonly kind: 'multiline'; readonly text: string }
  | { readonly kind: 'flag'; readonly flag: boolean }
  /**
   * `phone` and `email`: `href` is `tel:` and digits, or `mailto:` and a plain address, so a value
   * chooses neither the scheme nor any of the link's parameters.
   */
  | { readonly kind: 'link'; readonly text: string; readonly href: string }
  | { readonly kind: 'badge'; readonly text: string; readonly tone: Tone }
  | { readonly kind: 'chips'; readonly chips: readonly string[] }
  /** `address`: one line per part. */
  | { readonly kind: 'lines'; readonly lines: readonly string[] }
  | {
      readonly kind: 'table';
      readonly headings: readonly string[];
      readonly rows: readonly (readonly string[])[];
    }
  /** `rich-text`: raw HTML, which the page shows only through the platform's sanitiser. */
  | { readonly kind: 'html'; readonly html: string }
  /** No widget, or one this build shows as version 1 would: version 1's own view. */
  | { readonly kind: 'layout'; readonly field: FieldView };

/** What a widget may read besides its own value. Every lookup answers at once, from what is loaded. */
export interface RecordValueContext {
  readonly locale: string;
  /** Today, for relative dates. Injected so that the views are deterministic. */
  readonly today: Date;
  /** A vocabulary entry's label, or the stored id until it is read or when it cannot be. */
  readonly vocabulary: (directory: string, id: string) => string;
  /** A user's or group's display name, or the id until it is read or when it cannot be. */
  readonly principal: (kind: 'user' | 'group', id: string) => string;
  /** Another property of the record, for a parameter that names one: `currency`'s code. */
  readonly property: (xpath: string) => unknown;
  /** A label's text, translated: for a table's column headings. */
  readonly label: (label: LayoutLabel) => string | null;
  /** A boolean's translated yes or no, for a table's cell. */
  readonly flagText: (flag: boolean) => string;
  /** Whether a rule passes for the record and the user: a table column's `visibleWhen`. */
  readonly rule: (rule: unknown) => boolean;
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
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

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return JSON.stringify(value) ?? '';
}

const EMPTY: RecordValueView = { kind: 'empty' };
const text = (value: string): RecordValueView => ({ kind: 'text', text: value });

/** A stored date as a `Date`, or `null`. Nuxeo writes them as ISO 8601 text. */
function dateOf(value: unknown): Date | null {
  const date = value instanceof Date ? value : new Date(textOf(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Version 1's view of the value, for a widget shown as version 1 and for a field with none. */
function asVersion1(
  key: string,
  label: string,
  definition: LayoutFieldType,
  value: unknown,
  context: RecordValueContext,
): RecordValueView {
  const field = describeField(key, label, definition, value, {
    locale: context.locale,
    vocabulary: context.vocabulary,
  });
  return field.kind === 'empty' ? EMPTY : { kind: 'layout', field };
}

function numberText(value: number, locale: string, decimals: unknown): string {
  if (typeof decimals === 'number') return formatNumber(value, locale, `1.${decimals}-${decimals}`);
  // Version 1's view writes a number out exactly, never rounded; without `decimals`, so does this.
  const view = describeField('', '', { type: 'double' }, value, {
    locale,
    vocabulary: (_, id) => id,
  });
  return view.value && 'text' in view.value ? view.value.text : String(value);
}

/** `currency`'s code: the literal, or the one held by the property the parameter names. */
function currencyCode(parameter: unknown, context: RecordValueContext): string | null {
  const code =
    isRecord(parameter) && typeof parameter['field'] === 'string'
      ? context.property(parameter['field'])
      : parameter;
  return typeof code === 'string' && /^[A-Z]{3}$/.test(code) ? code : null;
}

const RELATIVE_UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
];

/** `relative-date`: the largest whole unit between the date and today, as "3 days ago". */
export function relativeDateText(date: Date, today: Date, locale: string): string {
  const seconds = Math.round((date.getTime() - today.getTime()) / 1000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size || unit === 'second')
      return format.format(Math.trunc(seconds / size), unit);
  }
  return format.format(0, 'second');
}

/** An address a `mailto:` link may carry: it chooses no header, and names no other scheme. */
const PLAIN_EMAIL = /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

/** The digits a `tel:` link dials: the value without its spaces, dots, dashes and brackets. */
function dialable(value: string): string {
  return value.replace(/[^\d+]/g, '');
}

/** One scalar of a list widget: a vocabulary entry's label, a user's or group's name, or the text. */
type ScalarText = (item: string) => string;

function listOrOne(value: unknown, show: ScalarText): RecordValueView {
  if (Array.isArray(value)) {
    const chips = value.filter((item) => !isEmpty(item)).map((item) => show(textOf(item)));
    return chips.length === 0 ? EMPTY : { kind: 'chips', chips };
  }
  return text(show(textOf(value)));
}

/**
 * A value as one line of text, for a table's cell. `flagText` is the translated yes or no, as the
 * page shows a boolean everywhere else.
 */
export function viewText(view: RecordValueView, flagText: (flag: boolean) => string): string {
  switch (view.kind) {
    case 'empty':
      return '';
    case 'text':
    case 'multiline':
    case 'link':
    case 'badge':
      return view.text;
    case 'flag':
      return flagText(view.flag);
    case 'chips':
      return view.chips.join(', ');
    case 'lines':
      return view.lines.join(', ');
    case 'table':
      return view.rows.map((row) => row.join(' ')).join('; ');
    case 'html':
      // Never markup in a cell: the text the HTML holds, with its tags and entities gone.
      return view.html
        .replace(/<[^>]*>/g, ' ')
        .replace(/&[a-z#0-9]+;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    case 'layout': {
      const { field } = view;
      const one = (value: { readonly text: string } | { readonly flag: boolean }): string =>
        'text' in value ? value.text : flagText(value.flag);
      if (field.value) return one(field.value);
      if (field.chips) return field.chips.map(one).join(', ');
      return '';
    }
  }
}

/** What a widget is given: the value, its parameters, and what its schema says the property is. */
export interface WidgetInput {
  readonly key: string;
  readonly label: string;
  readonly value: unknown;
  readonly parameters: Readonly<Json>;
  readonly definition: LayoutFieldType;
}

type WidgetView = (input: WidgetInput, context: RecordValueContext) => RecordValueView;

/**
 * Every widget layout-v2.md registers, by its ID. A widget is only ever given a value of a type
 * it accepts: a field whose property is of another type was left out when the layout was resolved.
 */
export const WIDGET_VIEWS: Readonly<Record<string, WidgetView>> = {
  text: ({ value }) => text(textOf(value)),
  'long-text': ({ value }) => ({ kind: 'multiline', text: textOf(value) }),
  'rich-text': ({ value }) => ({ kind: 'html', html: textOf(value) }),
  number: ({ value, parameters }, { locale }) =>
    typeof value === 'number'
      ? text(numberText(value, locale, parameters['decimals']))
      : text(textOf(value)),
  currency: ({ value, parameters }, context) => {
    if (typeof value !== 'number') return text(textOf(value));
    const code = currencyCode(parameters['currency'], context);
    if (!code) return text(numberText(value, context.locale, undefined));
    return text(
      new Intl.NumberFormat(context.locale, { style: 'currency', currency: code }).format(value),
    );
  },
  percent: ({ value, parameters }, { locale }) => {
    if (typeof value !== 'number') return text(textOf(value));
    const fraction = parameters['scale'] === 100 ? value / 100 : value;
    return text(formatPercent(fraction, locale, '1.0-2'));
  },
  date: ({ value, parameters }, { locale }) => {
    const date = dateOf(value);
    if (!date) return text(textOf(value));
    // In UTC, as version 1 does: a calendar date is stored at midnight UTC.
    return text(
      formatDate(date, parameters['format'] === 'short' ? 'shortDate' : 'longDate', locale, 'UTC'),
    );
  },
  'relative-date': ({ value }, { today, locale }) => {
    const date = dateOf(value);
    return date ? text(relativeDateText(date, today, locale)) : text(textOf(value));
  },
  boolean: ({ value }) =>
    value === true || value === 'true'
      ? { kind: 'flag', flag: true }
      : value === false || value === 'false'
        ? { kind: 'flag', flag: false }
        : text(textOf(value)),
  phone: ({ value }) => {
    const shown = textOf(value);
    const digits = dialable(shown);
    return digits === '' ? text(shown) : { kind: 'link', text: shown, href: `tel:${digits}` };
  },
  email: ({ value }) => {
    const shown = textOf(value).trim();
    // Only a plain address is linked: no scheme, no `?`, `&` or `%` to add mail headers, nothing
    // but letters, digits and `._+-` before the `@`. Anything else is shown as text.
    return PLAIN_EMAIL.test(shown)
      ? { kind: 'link', text: shown, href: `mailto:${shown}` }
      : text(shown);
  },
  address: ({ value, parameters, definition }, context) => {
    if (!isRecord(value)) return text(textOf(value));
    const parts = isRecord(parameters['parts']) ? parameters['parts'] : {};
    const part = (name: string): string => {
      const subfield = parts[name];
      if (typeof subfield !== 'string' || isEmpty(value[subfield])) return '';
      const directory = definition.fields?.[subfield]?.directory;
      const stored = textOf(value[subfield]);
      return directory ? context.vocabulary(directory, stored) : stored;
    };
    const lines = [
      part('street'),
      [part('postcode'), part('city')].filter(Boolean).join(' '),
      part('country'),
    ].filter((line) => line !== '');
    return lines.length === 0 ? EMPTY : { kind: 'lines', lines };
  },
  user: ({ value }, context) => listOrOne(value, (id) => context.principal('user', id)),
  group: ({ value }, context) => listOrOne(value, (id) => context.principal('group', id)),
  vocabulary: ({ value, parameters, definition }, context) => {
    const directory =
      typeof parameters['directory'] === 'string' ? parameters['directory'] : definition.directory;
    return listOrOne(value, (id) => (directory ? context.vocabulary(directory, id) : id));
  },
  chips: ({ value }) => listOrOne(Array.isArray(value) ? value : [value], (item) => item),
  'status-badge': ({ value, parameters, definition }, context) => {
    const stored = textOf(value);
    const tones = isRecord(parameters['tones']) ? parameters['tones'] : {};
    const tone = tones[stored];
    return {
      kind: 'badge',
      text: definition.directory ? context.vocabulary(definition.directory, stored) : stored,
      tone: (typeof tone === 'string' ? tone : 'neutral') as Tone,
    };
  },
  table: ({ value, parameters, definition }, context) => {
    // A column shows only while its rule passes, as a field does: a column of numbers a group
    // may not see is not drawn for anyone outside it.
    const columns = tableColumns(parameters['columns']).filter(
      (column) => column.visibleWhen === null || context.rule(column.visibleWhen),
    );
    const items = (Array.isArray(value) ? value : []).filter(isRecord);
    if (items.length === 0 || columns.length === 0) return EMPTY;
    return {
      kind: 'table',
      headings: columns.map((column) => context.label(column.label) ?? humanize(column.subfield)),
      rows: items.map((item) =>
        columns.map((column) => {
          const sub = definition.fields?.[column.subfield] ?? { type: 'string' };
          // A column's widget is held to its subfield's type, as a field's is to its property's;
          // one that does not show it leaves the cell to the subfield's own view.
          const widget =
            column.widget !== null && widgetAccepts(column.widget, sub) ? column.widget : null;
          return viewText(
            showValue(
              {
                key: column.subfield,
                label: column.subfield,
                value: item[column.subfield],
                parameters: column.parameters,
                definition: sub,
              },
              widget,
              context,
            ),
            context.flagText,
          );
        }),
      ),
    };
  },
};

/** Show a value through `widget`, or as version 1 would when there is none. */
export function showValue(
  input: WidgetInput,
  widget: string | null,
  context: RecordValueContext,
): RecordValueView {
  if (isEmpty(input.value)) return EMPTY;
  const view =
    widget !== null && !WIDGETS_SHOWN_AS_VERSION_1.has(widget) ? WIDGET_VIEWS[widget] : undefined;
  return view
    ? view(input, context)
    : asVersion1(input.key, input.label, input.definition, input.value, context);
}

/** What a computation's result is, as a property type, so that a widget can be checked against it. */
export function computedDefinition(value: unknown): LayoutFieldType {
  if (typeof value === 'number') return { type: 'double' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  return { type: 'string' };
}
