import {
  NumberSymbol,
  formatDate,
  formatNumber,
  formatPercent,
  getLocaleNumberSymbol,
} from '@angular/common';
import { isStoredCalendarDay } from '@agentic-ui/shared/computations';
import type { TrustedHtmlConfig } from '@nuxeo/satori-platform/nuxeo-client';
import DOMPurify from 'dompurify';

import { describeField, type FieldView, type ValueView } from '../document-layout/field-view';
import type { LayoutFieldType, LayoutLabel } from '../layout.model';
import { humanize } from '../resolve-layout';
import {
  type TableColumn,
  WIDGETS_SHOWN_AS_VERSION_1,
  own,
  tableColumns,
  widgetAccepts,
} from './widget-support';

export { WIDGETS_SHOWN_AS_VERSION_1 } from './widget-support';

/**
 * How the record page shows one value through a registered widget (layout-v2.md, section 3).
 *
 * Functions from a value to a view, so every widget is tested without drawing a page, as version
 * 1's `describeField` is. A field with no widget is shown by version 1's own function, so the two
 * versions show an unannotated property the same way, except a date: see {@link asVersion1}.
 */

/**
 * What a `rich-text` value may keep: formatting, lists, quotes, code and links. Never an image,
 * which would load from wherever the value says; a form or an input, which could ask for a
 * password in the page's own look; a style, a frame or a script. DOMPurify also strips a
 * `javascript:` link. The page renders a field through it, and a table's cell is its text.
 */
export const RICH_TEXT_HTML: TrustedHtmlConfig = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'sub',
    'sup',
    'ul',
    'ol',
    'li',
    'blockquote',
    'code',
    'pre',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'a',
    'span',
  ],
  ALLOWED_ATTR: ['href'],
};

/** The elements of rich text that part the words either side of them, as a block or a break does. */
const PARTING = 'p, br, li, blockquote, pre, h1, h2, h3, h4, h5, h6';

/**
 * The words a `rich-text` value shows, as one line: what {@link RICH_TEXT_HTML} keeps of it, with
 * each entity read as the character it stands for, so `&lt;10` is `<10` and `R&amp;D` is `R&D`.
 * A paragraph, a list item, a heading or a line break parts the words either side; inline
 * formatting does not, so `<b>R</b>&amp;D` stays one word. Text, never markup: the page binds it
 * as text.
 */
export function richTextWords(html: string): string {
  // Parsed into an inert document, which runs no script and loads nothing, and never attached.
  const kept = DOMPurify.sanitize(html, { ...RICH_TEXT_HTML, RETURN_DOM_FRAGMENT: true });
  for (const element of kept.querySelectorAll(PARTING)) {
    element.before(' ');
    element.after(' ');
  }
  return (kept.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export type Tone = 'positive' | 'warning' | 'negative' | 'info' | 'neutral';

/**
 * One record a `document-link` names, as the page shows it: its title and the app's route to it,
 * or the unavailable text and no route, for a record the reader may not read, one that no longer
 * exists, or a value that is not a document's id. Never the stored id.
 */
export interface RecordLink {
  readonly text: string;
  /**
   * For a `document-link`'s `show` through `status-badge` (layout-v2.md, section 12): the shown
   * value's tone, which the record page draws as a badge inside the link. Absent otherwise.
   */
  readonly tone?: Tone;
  /**
   * The app's route to the record, opened through the router: `/doc/<uid>`, or browse for a folder
   * and the collection page for a collection, as a row opens one. `null` where there is none.
   */
  readonly url: string | null;
}

export type RecordValueView =
  | { readonly kind: 'empty' }
  | { readonly kind: 'text'; readonly text: string }
  /** Text whose line breaks show: `long-text`. */
  | { readonly kind: 'multiline'; readonly text: string }
  | { readonly kind: 'flag'; readonly flag: boolean }
  /**
   * `phone` and `email`: `href` is `tel:` and the digits of a number written with nothing but
   * digits and separators, or `mailto:` and a plain address, so a value chooses neither the scheme
   * nor any of the link's parameters, nor dials a number it does not show.
   */
  | { readonly kind: 'link'; readonly text: string; readonly href: string }
  | { readonly kind: 'badge'; readonly text: string; readonly tone: Tone }
  | { readonly kind: 'chips'; readonly chips: readonly string[] }
  /**
   * `document-link`: the records the value names, in its order. One still being read is not
   * listed yet, so the field shows nothing, rather than the id, until it is.
   */
  | { readonly kind: 'records'; readonly records: readonly RecordLink[] }
  /**
   * `file`: one file, by its name, which the record page downloads when it is pressed, fetched
   * through the blob service as the reader. `xpath` is the property, which the download names.
   */
  | { readonly kind: 'file'; readonly name: string; readonly xpath: string }
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
  /**
   * The record a `document-link` value names: its title and route, the unavailable text where it
   * cannot be shown, or `null` while it is read. Never the stored id.
   */
  readonly record: (id: string) => RecordLink | null;
  /**
   * A property of the record a `document-link` value names, as the page read it with that record,
   * for a `show` (layout-v2.md, section 12): `undefined` where that record is not read, or was read
   * without it. Absent where nothing on the page has a `show`.
   */
  readonly linkedValue?: (id: string, xpath: string) => unknown;
  /** Another property of the record, for a parameter that names one: `currency`'s code. */
  readonly property: (xpath: string) => unknown;
  /** A label's text, translated: for a table's column headings. */
  readonly label: (label: LayoutLabel) => string | null;
  /** A boolean's translated yes or no, for a table's cell. */
  readonly flagText: (flag: boolean) => string;
  /** Whether a rule passes for the record and the user: a table column's `visibleWhen`. */
  readonly rule: (rule: unknown) => boolean;
  /**
   * The zone an instant is shown in: absent, the reader's own, as the page leaves it unless a test
   * provides `RECORD_PAGE_TIME_ZONE`; an offset such as `+0530`, so that a view is the same in any
   * zone the suite runs in.
   */
  readonly timeZone?: string;
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
  // A date, at any depth of a complex value or in a list, as the `date` widget shows it, not in
  // UTC as version 1 shows every date. UTC is right for a stored day and wrong for an instant
  // such as `dc:created`, which belongs in the reader's zone (AGENTS/08-bug-patterns.md, pattern
  // 29). So a field, a table's cell and a template's placeholder show a date on the same day.
  const field = describeField(key, label, definition, value, {
    locale: context.locale,
    vocabulary: context.vocabulary,
    date: (date) => ({ text: dateText(date, context) }),
  });
  return field.kind === 'empty' ? EMPTY : { kind: 'layout', field };
}

function numberText(
  value: number,
  locale: string,
  decimals: unknown,
  grouping: unknown = true,
): string {
  const written = groupedNumberText(value, locale, decimals);
  // `grouping: false` (layout-v2.md, section 3): the locale's own digits and decimal sign, without
  // its group separator, so a model year shows as 2024, not 2,024. Only that one symbol is taken
  // out, so a locale whose separator is a space keeps every other space it writes.
  return grouping === false ? written.split(groupSeparator(locale)).join('') : written;
}

function groupedNumberText(value: number, locale: string, decimals: unknown): string {
  if (typeof decimals === 'number') return formatNumber(value, locale, `1.${decimals}-${decimals}`);
  // Version 1's view writes a number out exactly, never rounded; without `decimals`, so does this.
  const view = describeField('', '', { type: 'double' }, value, {
    locale,
    vocabulary: (_, id) => id,
  });
  return view.value && 'text' in view.value ? view.value.text : String(value);
}

/** The locale's group separator, as Angular's `formatNumber` writes it: `,` in English. */
function groupSeparator(locale: string): string {
  return getLocaleNumberSymbol(locale, NumberSymbol.Group);
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

/**
 * A number as it is written to be dialled: digits, an optional `+` first, and the spaces, dots,
 * dashes, slashes and brackets that group them. Anything else, such as `ext. 42` or a letter, is
 * not linked: taking it out would dial another number, as `ext. 42` would add its digits to it.
 */
const DIALABLE = /^\+?[\d\s()./-]+$/;

/** The digits a `tel:` link dials, or `null` for a value that is not written to be dialled. */
function dialable(value: string): string | null {
  const written = value.trim();
  if (!DIALABLE.test(written) || !/\d/.test(written)) return null;
  return written.replace(/[^\d+]/g, '');
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
    case 'records':
      return view.records.map((record) => record.text).join(', ');
    case 'file':
      return view.name;
    case 'lines':
      return view.lines.join(', ');
    case 'table':
      return view.rows.map((row) => row.join(' ')).join('; ');
    case 'html':
      // Never markup in a cell: the words the field would show.
      return richTextWords(view.html);
    case 'layout':
      return fieldText(view.field, flagText);
  }
}

/**
 * Version 1's view of a value as one line. A complex value is its sub-fields, each written
 * `Label: value` as the field lists them, and one value after another; a complex sub-field is
 * bracketed, so that its own values do not read as the outer one's. Empty sub-fields are left
 * out, as the field shows them as a dash. The depth is version 1's own, which writes a value
 * nested deeper as text.
 */
function fieldText(field: FieldView, flagText: (flag: boolean) => string): string {
  const one = (value: ValueView): string =>
    'text' in value ? value.text : 'flag' in value ? flagText(value.flag) : value.record.text;
  if (field.value) return one(field.value);
  if (field.chips) return field.chips.map(one).join(', ');
  if (!field.groups) return '';
  return field.groups
    .map((group) =>
      group
        .filter((sub) => sub.kind !== 'empty')
        .map((sub) => {
          const text = fieldText(sub, flagText);
          return `${sub.label}: ${sub.kind === 'groups' ? `(${text})` : text}`;
        })
        .join(', '),
    )
    .filter((text) => text !== '')
    .join('; ');
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
      ? text(numberText(value, locale, parameters['decimals'], parameters['grouping']))
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
  date: ({ value, parameters }, { locale, timeZone }) => {
    const date = dateOf(value);
    if (!date) return text(textOf(value));
    // A stored day in UTC, where Nuxeo anchors a day-only write, so that every reader sees the
    // day that was written; an instant, such as `dc:created`, in the reader's own zone. The same
    // rule as the computations' (AGENTS/08-bug-patterns.md, pattern 29).
    const zone = isStoredCalendarDay(value) ? 'UTC' : timeZone;
    const format = parameters['format'] === 'short' ? 'shortDate' : 'longDate';
    return text(formatDate(date, format, locale, zone));
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
    return digits === null ? text(shown) : { kind: 'link', text: shown, href: `tel:${digits}` };
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
      const subfield = own(parts, name);
      if (typeof subfield !== 'string' || isEmpty(own(value, subfield))) return '';
      const directory = own(definition.fields, subfield)?.directory;
      const stored = textOf(own(value, subfield));
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
  'document-link': ({ value }, context) => {
    const ids = (Array.isArray(value) ? value : [value]).filter((id) => !isEmpty(id));
    if (ids.length === 0) return EMPTY;
    return {
      kind: 'records',
      records: ids
        .map((id) => context.record(textOf(id)))
        .filter((record): record is RecordLink => record !== null),
    };
  },
  chips: ({ value }) => listOrOne(Array.isArray(value) ? value : [value], (item) => item),
  file: ({ key, value }) => {
    // A blob as Nuxeo writes one: `{ name, mime-type, length, data, ... }`. A file with no name is
    // shown by none, and offered as no download.
    const name = isRecord(value) && typeof value['name'] === 'string' ? value['name'].trim() : '';
    return name === '' ? EMPTY : { kind: 'file', name, xpath: key };
  },
  'status-badge': ({ value, parameters, definition }, context) => {
    const stored = textOf(value);
    const tones = isRecord(parameters['tones']) ? parameters['tones'] : {};
    const tone = own(tones, stored);
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
          const sub = subfieldDefinition(definition, column);
          return viewText(
            showValue(
              {
                key: column.subfield,
                label: column.subfield,
                value: own(item, column.subfield),
                parameters: column.parameters,
                definition: sub,
              },
              columnWidget(column, sub),
              context,
            ),
            context.flagText,
          );
        }),
      ),
    };
  },
};

/** What a table's column holds: its subfield's type in the list's schema, or text when it has none. */
export function subfieldDefinition(list: LayoutFieldType, column: TableColumn): LayoutFieldType {
  return own(list.fields, column.subfield) ?? { type: 'string' };
}

/**
 * The widget a table's cell is shown through. A column's widget is held to its subfield's type, as
 * a field's is to its property's; one that does not show it leaves the cell to the subfield's own
 * view. The page reads a cell's labels through the same choice, so it reads the ones it shows.
 */
export function columnWidget(column: TableColumn, sub: LayoutFieldType): string | null {
  return column.widget !== null && widgetAccepts(column.widget, sub) ? column.widget : null;
}

/** A date as the `date` widget shows it, with no parameters: one rule for every date on the page. */
function dateText(value: unknown, context: RecordValueContext): string {
  const input = { key: '', label: '', value, parameters: {}, definition: { type: 'date' } };
  return viewText(WIDGET_VIEWS['date'](input, context), context.flagText);
}

/**
 * Show a value through `widget`, or as version 1 would when there is none, its dates excepted
 * (see `asVersion1`).
 */
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

/** What a `document-link`'s `show` shows of the records it links to: the property, and what it is. */
export interface ShownProperty {
  /** `<prefix>:<name>`, on the linked record. */
  readonly xpath: string;
  /** The property in the linked type's schema, which it is shown by. */
  readonly definition: LayoutFieldType;
  /**
   * The widget it is shown through, one of the validator's `SHOWN_WIDGETS`, held to the
   * property's type by the caller; `null` or absent for the schema type's own view.
   */
  readonly widget?: string | null;
  /** That widget's parameters, each a literal. */
  readonly parameters?: Readonly<Json>;
}

/**
 * What a `document-link` with `show` shows (layout-v2.md, section 12): for each record the value
 * names, in its order, the property `show` names, through its widget, or by its schema type as a
 * field with no widget shows one, as a link that opens that record. A `status-badge` gives the link
 * its tone, which the record page draws as a badge inside it, and a list as its text. A record still being read is not listed yet, so the
 * field shows nothing until it is, never the stored id. One the reader may not read, that no longer
 * exists, or a value that is not a document's id, shows the unavailable text and no value. A record
 * read without the property is left out, and a field whose every record is read and lacks it is
 * empty, as an empty property is.
 */
export function showLinkedProperty(
  value: unknown,
  shown: ShownProperty,
  context: RecordValueContext,
): RecordValueView {
  const ids = (Array.isArray(value) ? value : [value]).filter((id) => !isEmpty(id));
  if (ids.length === 0) return EMPTY;
  let reading = false;
  const records: RecordLink[] = [];
  for (const id of ids.map(textOf)) {
    const link = context.record(id);
    if (link === null) {
      reading = true;
      continue;
    }
    if (link.url === null) {
      records.push(link);
      continue;
    }
    const property = context.linkedValue?.(id, shown.xpath);
    const view = showValue(
      {
        key: shown.xpath,
        label: shown.xpath,
        value: property,
        parameters: shown.parameters ?? {},
        definition: shown.definition,
      },
      shown.widget ?? null,
      // A parameter that names a property reads none: the validator refuses one here, since it
      // would be the open record's, not the linked one's.
      { ...context, property: () => undefined },
    );
    const text = viewText(view, context.flagText);
    if (view.kind === 'empty' || text === '') continue;
    records.push(
      view.kind === 'badge' ? { text, url: link.url, tone: view.tone } : { text, url: link.url },
    );
  }
  return records.length === 0 && !reading ? EMPTY : { kind: 'records', records };
}

/**
 * A date as Nuxeo writes one, the computations' rule: a day, or a date and time with its zone, `Z`
 * or `±HH:mm`. A time with no zone names a different instant in every zone, and is not one.
 */
const ISO_DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2}))?$/;

/** Whether a text is a date as {@link ISO_DATE} writes one, on a day that exists. */
function isDateText(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match || Number.isNaN(new Date(value).getTime())) return false;
  // `Date` rolls a day that does not exist into the next month: 2023-02-30 is 2 March to it.
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const written = new Date(Date.UTC(year, month - 1, day));
  return (
    written.getUTCFullYear() === year &&
    written.getUTCMonth() === month - 1 &&
    written.getUTCDate() === day
  );
}

/**
 * What a computation's result is, as a property type, so that its widget can be checked against
 * it. A computation has no date type: `core.choose` gives a date property's value as its text. So
 * a text that is a date is a `date` for a widget that shows dates, `date` or `relative-date`, and
 * the field is not left out; for any other widget it stays the text it is.
 */
export function computedDefinition(value: unknown, widget: string | null = null): LayoutFieldType {
  if (typeof value === 'number') return { type: 'double' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  if (
    widget !== null &&
    typeof value === 'string' &&
    widgetAccepts(widget, { type: 'date' }) &&
    isDateText(value)
  ) {
    return { type: 'date' };
  }
  return { type: 'string' };
}
