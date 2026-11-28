import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { describe, expect, it } from 'vitest';

import { describeField } from '../document-layout/field-view';
import type { LayoutFieldType } from '../layout.model';
import {
  WIDGETS_SHOWN_AS_VERSION_1,
  WIDGET_VIEWS,
  computedDefinition,
  relativeDateText,
  richTextWords,
  showLinkedProperty,
  showValue,
  viewText,
  type RecordValueContext,
} from './record-field-view';
import { PACKAGED_WIDGETS } from '@agentic-ui/shared/app-definition';

const TODAY = new Date('2026-11-23T12:00:00Z');
const MEMBER = 'a00e20f3-1398-4b64-827e-628bfdada64c';
const PENDING = '9cd9b1cf-6f0b-442f-afa0-c2539996ba30';
const GONE = '0a762678-0e77-4b58-8256-e5d7bce1f55e';

const context: RecordValueContext = {
  locale: 'en-US',
  today: TODAY,
  vocabulary: (directory, id) => (directory === 'country' && id === 'fr' ? 'France' : id),
  principal: (kind, id) =>
    kind === 'user' && id === 'jdoe'
      ? 'Jane Doe'
      : kind === 'group' && id === 'members'
        ? 'Member services'
        : id,
  // A read record, one still being read, and one the reader may not read.
  record: (id) =>
    id === MEMBER
      ? { text: 'Wei Chen', url: `/doc/${MEMBER}` }
      : id === PENDING
        ? null
        : { text: 'Unavailable', url: null },
  property: (xpath) => ({ 'claim:currency': 'EUR', 'claim:badCurrency': 'eur' })[xpath],
  label: (label) => label.literal ?? label.fallback,
  flagText: (flag) => (flag ? 'Yes' : 'No'),
  rule: (rule) => rule !== 'test.rules.hidden',
};

function show(
  widget: string | null,
  value: unknown,
  parameters: Record<string, unknown> = {},
  definition: LayoutFieldType = { type: 'string' },
) {
  return showValue({ key: 'k', label: 'L', value, parameters, definition }, widget, context);
}

describe('the widget registry', () => {
  it('has a view for every widget the validator registers, and no other', () => {
    expect(Object.keys(WIDGET_VIEWS).length + WIDGETS_SHOWN_AS_VERSION_1.size).toBe(
      Object.keys(PACKAGED_WIDGETS).length,
    );
    for (const widget of Object.keys(PACKAGED_WIDGETS)) {
      expect(widget in WIDGET_VIEWS || WIDGETS_SHOWN_AS_VERSION_1.has(widget), widget).toBe(true);
    }
    for (const widget of Object.keys(WIDGET_VIEWS)) {
      expect(widget in PACKAGED_WIDGETS, widget).toBe(true);
      expect(WIDGETS_SHOWN_AS_VERSION_1.has(widget), widget).toBe(false);
    }
  });
});

describe('showValue', () => {
  it.each(['text', 'number', 'chips', 'table', null])(
    'shows nothing at all for no value, through %s',
    (widget) => {
      for (const value of [null, undefined, '', []])
        expect(show(widget, value)).toEqual({ kind: 'empty' });
    },
  );

  it('shows text, and long text with its line breaks', () => {
    expect(show('text', 'Claim 42')).toEqual({ kind: 'text', text: 'Claim 42' });
    expect(show('long-text', 'one\ntwo')).toEqual({ kind: 'multiline', text: 'one\ntwo' });
  });

  it('hands rich text on as HTML for the sanitiser, never as text with markup', () => {
    expect(show('rich-text', '<p>Hi</p>')).toEqual({ kind: 'html', html: '<p>Hi</p>' });
  });

  describe('numbers', () => {
    it('with the decimals asked for', () => {
      expect(show('number', 1234.5, { decimals: 2 }, { type: 'double' })).toEqual({
        kind: 'text',
        text: '1,234.50',
      });
    });

    it('grouped by default, and without the group separator for grouping: false', () => {
      // A model year stored as a number: "2,024" with grouping, "2024" without (layout-v2.md,
      // section 3). Grouping true, or left out, is the locale's own.
      expect(show('number', 2024, {}, { type: 'long' })).toEqual({ kind: 'text', text: '2,024' });
      expect(show('number', 2024, { grouping: true }, { type: 'long' })).toEqual({
        kind: 'text',
        text: '2,024',
      });
      expect(show('number', 2024, { grouping: false }, { type: 'long' })).toEqual({
        kind: 'text',
        text: '2024',
      });
      // With decimals, only the group separator goes: the decimal sign stays.
      expect(
        show('number', 1234567.5, { decimals: 2, grouping: false }, { type: 'double' }),
      ).toEqual({ kind: 'text', text: '1234567.50' });
      // Exactly as stored, never rounded, still.
      expect(show('number', 12345.678901, { grouping: false }, { type: 'double' })).toEqual({
        kind: 'text',
        text: '12345.678901',
      });
    });

    it("without grouping, in a locale whose separator is not a comma, keeps the locale's decimal sign", () => {
      registerLocaleData(localeFr);
      const french = { ...context, locale: 'fr' };
      const shown = (parameters: Record<string, unknown>) =>
        showValue(
          { key: 'k', label: 'L', value: 1234567.5, parameters, definition: { type: 'double' } },
          'number',
          french,
        );
      // French groups with a narrow no-break space and writes a decimal comma.
      expect(shown({ decimals: 1 })).toEqual({ kind: 'text', text: '1\u202f234\u202f567,5' });
      expect(shown({ decimals: 1, grouping: false })).toEqual({ kind: 'text', text: '1234567,5' });
    });

    it('otherwise exactly as stored, never rounded, as version 1 shows them', () => {
      expect(show('number', 3.14159265, {}, { type: 'double' })).toEqual({
        kind: 'text',
        text: '3.14159265',
      });
      expect(show('number', 0.0004, {}, { type: 'double' })).toEqual({
        kind: 'text',
        text: '0.0004',
      });
    });

    it('a currency named by its code, or by the property that holds one', () => {
      expect(show('currency', 1234.5, { currency: 'USD' }, { type: 'double' })).toEqual({
        kind: 'text',
        text: '$1,234.50',
      });
      expect(
        show('currency', 1234.5, { currency: { field: 'claim:currency' } }, { type: 'double' }),
      ).toEqual({
        kind: 'text',
        text: '€1,234.50',
      });
    });

    it('the number alone when the property holds no currency code', () => {
      expect(
        show('currency', 1234.5, { currency: { field: 'claim:badCurrency' } }, { type: 'double' }),
      ).toEqual({
        kind: 'text',
        text: '1,234.5',
      });
    });

    it('a percentage, from a fraction or from a hundred', () => {
      expect(show('percent', 0.125, { scale: 1 }, { type: 'double' })).toEqual({
        kind: 'text',
        text: '12.5%',
      });
      expect(show('percent', 12.5, { scale: 100 }, { type: 'double' })).toEqual({
        kind: 'text',
        text: '12.5%',
      });
    });
  });

  describe('dates', () => {
    it('long by default, short when asked, in UTC as version 1 shows them', () => {
      expect(show('date', '2026-11-23T00:00:00Z', {}, { type: 'date' })).toEqual({
        kind: 'text',
        text: 'November 23, 2026',
      });
      expect(show('date', '2026-11-23T00:00:00Z', { format: 'short' }, { type: 'date' })).toEqual({
        kind: 'text',
        text: '11/23/26',
      });
    });

    /**
     * Pattern 29: a stored day is the day written, wherever it is read; an instant is the
     * reader's day. 20:00 UTC is the next day at +05:30, and 00:00 UTC the previous one at -05:00,
     * so each case below fails if the two are read alike.
     */
    it("shows a stored day as written, in any zone, and an instant on the reader's day", () => {
      const at = (timeZone: string, value: string) =>
        showValue(
          { key: 'k', label: 'L', value, parameters: {}, definition: { type: 'date' } },
          'date',
          { ...context, timeZone },
        );
      expect(at('-0500', '2026-11-23T00:00:00.000Z')).toEqual({
        kind: 'text',
        text: 'November 23, 2026',
      });
      expect(at('+0530', '2026-11-23T20:00:00.000Z')).toEqual({
        kind: 'text',
        text: 'November 24, 2026',
      });
      expect(at('-0500', '2026-11-24T00:30:00.000Z')).toEqual({
        kind: 'text',
        text: 'November 23, 2026',
      });
    });

    it('relative to today', () => {
      expect(show('relative-date', '2026-11-20T12:00:00Z', {}, { type: 'date' })).toEqual({
        kind: 'text',
        text: '3 days ago',
      });
    });

    it('a value that is not a date, as written', () => {
      expect(show('date', 'soon', {}, { type: 'date' })).toEqual({ kind: 'text', text: 'soon' });
    });
  });

  it.each([
    ['2026-11-23T11:59:30Z', '30 seconds ago'],
    ['2026-11-23T09:00:00Z', '3 hours ago'],
    ['2026-11-22T12:00:00Z', 'yesterday'],
    ['2027-01-23T00:00:00Z', 'in 2 months'],
    ['2024-11-01T00:00:00Z', '2 years ago'],
  ])('relativeDateText(%s) is "%s"', (date, expected) => {
    expect(relativeDateText(new Date(date), TODAY, 'en-US')).toBe(expected);
  });

  it('shows a boolean as a flag the page translates', () => {
    expect(show('boolean', true, {}, { type: 'boolean' })).toEqual({ kind: 'flag', flag: true });
    expect(show('boolean', 'false', {}, { type: 'boolean' })).toEqual({
      kind: 'flag',
      flag: false,
    });
    expect(show('boolean', 'maybe', {}, { type: 'boolean' })).toEqual({
      kind: 'text',
      text: 'maybe',
    });
  });

  describe('links', () => {
    it('a phone number dials its digits', () => {
      expect(show('phone', '+1 (555) 010-0199')).toEqual({
        kind: 'link',
        text: '+1 (555) 010-0199',
        href: 'tel:+15550100199',
      });
    });

    it('a phone number with no digits is text', () => {
      expect(show('phone', 'n/a')).toEqual({ kind: 'text', text: 'n/a' });
      // Separators alone are written like a number, and are still not one.
      expect(show('phone', '( ) - -')).toEqual({ kind: 'text', text: '( ) - -' });
    });

    /** Taking out what is not a separator would dial another number: `ext. 42` adds `42`. */
    it.each([
      '+1 (555) 010-0199 ext. 42',
      '+1 555 010 0199 x42',
      '1-800-FLOWERS',
      '555 0100 or 555 0101',
      '++1 555 0100',
      '555+0100',
    ])('%j, which holds more than digits and separators, is text', (phone) => {
      expect(show('phone', phone)).toEqual({ kind: 'text', text: phone });
    });

    it.each([
      ['  +44 20 7946 0958 ', 'tel:+442079460958'],
      ['030/123.45-67', 'tel:0301234567'],
    ])('%j dials %j', (phone, href) => {
      expect(show('phone', phone)).toEqual({ kind: 'link', text: phone, href });
    });

    it('an email address writes to it', () => {
      expect(show('email', 'jane@example.com')).toEqual({
        kind: 'link',
        text: 'jane@example.com',
        href: 'mailto:jane@example.com',
      });
    });

    it.each([
      'javascript:alert(1)@x',
      'a b@example.com',
      'a@b@example.com',
      'https://example.com',
      'a?cc=someone@example.com',
      'a&body=x@example.com',
      'a%0Abcc:x@example.com',
      'jane@localhost',
      'help@acme.example?bcc=x%40evil.example&subject=Reset',
    ])('anything else in an email field is text, never a link: %s', (value) => {
      expect(show('email', value)).toEqual({ kind: 'text', text: value });
    });
  });

  describe('address', () => {
    const parts = { street: 'street', city: 'city', postcode: 'zip', country: 'country' };
    const definition: LayoutFieldType = {
      type: 'complex',
      fields: {
        street: { type: 'string' },
        city: { type: 'string' },
        zip: { type: 'string' },
        country: { type: 'string', directory: 'country' },
      },
    };

    it('one line per part, the postcode before the city, a vocabulary part by its label', () => {
      expect(
        show(
          'address',
          { street: '1 Main St', city: 'Springfield', zip: '12345', country: 'fr' },
          { parts },
          definition,
        ),
      ).toEqual({
        kind: 'lines',
        lines: ['1 Main St', '12345 Springfield', 'France'],
      });
    });

    it('leaves out the parts that are empty, and shows nothing when all are', () => {
      expect(show('address', { city: 'Springfield' }, { parts }, definition)).toEqual({
        kind: 'lines',
        lines: ['Springfield'],
      });
      expect(show('address', { street: '' }, { parts }, definition)).toEqual({ kind: 'empty' });
    });
  });

  it('shows a user or a group by name, and by id where the name is not known', () => {
    expect(show('user', 'jdoe')).toEqual({ kind: 'text', text: 'Jane Doe' });
    expect(show('user', ['jdoe', 'gone'], {}, { type: 'string[]' })).toEqual({
      kind: 'chips',
      chips: ['Jane Doe', 'gone'],
    });
    expect(show('group', 'members')).toEqual({ kind: 'text', text: 'Member services' });
  });

  it('shows a vocabulary value by its label, from the parameter or the schema', () => {
    expect(show('vocabulary', 'fr', { directory: 'country' })).toEqual({
      kind: 'text',
      text: 'France',
    });
    expect(
      show('vocabulary', ['fr', 'xx'], {}, { type: 'string[]', directory: 'country' }),
    ).toEqual({
      kind: 'chips',
      chips: ['France', 'xx'],
    });
  });

  describe('document-link', () => {
    it("shows the linked record's title, with the app's route to it", () => {
      expect(show('document-link', MEMBER)).toEqual({
        kind: 'records',
        records: [{ text: 'Wei Chen', url: `/doc/${MEMBER}` }],
      });
    });

    it('shows a list of links in its order, the unavailable ones as text, and never an id', () => {
      const view = show('document-link', [GONE, MEMBER, '', 'not-an-id'], {}, { type: 'string[]' });
      expect(view).toEqual({
        kind: 'records',
        records: [
          { text: 'Unavailable', url: null },
          { text: 'Wei Chen', url: `/doc/${MEMBER}` },
          { text: 'Unavailable', url: null },
        ],
      });
      const text = viewText(view, context.flagText);
      expect(text).toBe('Unavailable, Wei Chen, Unavailable');
      expect(text).not.toContain(GONE);
      expect(text).not.toContain('not-an-id');
    });

    it('shows nothing of a record still being read, not its id', () => {
      expect(show('document-link', PENDING)).toEqual({ kind: 'records', records: [] });
      expect(
        viewText(
          show('document-link', [PENDING, MEMBER], {}, { type: 'string[]' }),
          context.flagText,
        ),
      ).toBe('Wei Chen');
    });

    it('shows no value as empty', () => {
      expect(show('document-link', [], {}, { type: 'string[]' })).toEqual({ kind: 'empty' });
      expect(show('document-link', '')).toEqual({ kind: 'empty' });
    });

    describe("with show, a property of the linked record's", () => {
      const OTHER = '9a651335-d3d4-434c-a7b4-afe7e5c0edae';
      const values: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
        [MEMBER]: { 'move:deliveredOn': '2026-11-14T00:00:00.000Z', 'move:crew': ['ana', 'bo'] },
        [OTHER]: { 'move:deliveredOn': null },
        // What a record the reader may not read would hold: never asked for, never shown.
        [GONE]: { 'move:deliveredOn': '1999-01-01' },
      };
      const linked: RecordValueContext = {
        ...context,
        record: (id) =>
          id === OTHER ? { text: 'Other move', url: `/doc/${OTHER}` } : context.record(id),
        linkedValue: (id, xpath) => values[id]?.[xpath],
      };
      const delivered = { xpath: 'move:deliveredOn', definition: { type: 'date' } };
      const shown = (value: unknown, property = delivered, on = linked) =>
        showLinkedProperty(value, property, on);

      it('shows the property by its schema type, as a link to the linked record', () => {
        expect(shown(MEMBER)).toEqual({
          kind: 'records',
          records: [{ text: 'November 14, 2026', url: `/doc/${MEMBER}` }],
        });
        const crew = { xpath: 'move:crew', definition: { type: 'string[]' } };
        expect(viewText(shown(MEMBER, crew), context.flagText)).toBe('ana, bo');
      });

      it('shows a record the reader may not read as unavailable, never one of its values', () => {
        const view = shown([GONE, MEMBER, 'not-an-id']);
        expect(view).toEqual({
          kind: 'records',
          records: [
            { text: 'Unavailable', url: null },
            { text: 'November 14, 2026', url: `/doc/${MEMBER}` },
            { text: 'Unavailable', url: null },
          ],
        });
        expect(viewText(view, context.flagText)).not.toContain('1999');
      });

      it('shows nothing while a record is read, and empty where every record lacks the property', () => {
        expect(shown(PENDING)).toEqual({ kind: 'records', records: [] });
        expect(shown(OTHER)).toEqual({ kind: 'empty' });
        expect(shown([OTHER, PENDING])).toEqual({ kind: 'records', records: [] });
        // A context with nothing read for a show is the same: the property is not there.
        const { linkedValue: _, ...none } = linked;
        expect(shown(OTHER, delivered, none)).toEqual({ kind: 'empty' });
        expect(shown('')).toEqual({ kind: 'empty' });
      });
    });
  });

  it('shows chips, leaving out the empty ones', () => {
    expect(show('chips', ['a', '', 'b'], {}, { type: 'string[]' })).toEqual({
      kind: 'chips',
      chips: ['a', 'b'],
    });
  });

  it("shows a status badge in its value's tone, neutral for a value with none", () => {
    const tones = { active: 'positive', lapsed: 'warning' };
    expect(show('status-badge', 'active', { tones })).toEqual({
      kind: 'badge',
      text: 'active',
      tone: 'positive',
    });
    expect(show('status-badge', 'new', { tones })).toEqual({
      kind: 'badge',
      text: 'new',
      tone: 'neutral',
    });
    expect(
      show(
        'status-badge',
        'fr',
        { tones: { fr: 'info' } },
        { type: 'string', directory: 'country' },
      ),
    ).toEqual({
      kind: 'badge',
      text: 'France',
      tone: 'info',
    });
  });

  it('shows a table, each cell through its column widget', () => {
    const definition: LayoutFieldType = {
      type: 'complex[]',
      fields: { code: { type: 'string' }, amount: { type: 'double' }, paid: { type: 'boolean' } },
    };
    const columns = [
      'line:code',
      { field: 'line:amount', widget: 'currency', parameters: { currency: 'USD' } },
      { field: 'line:paid', label: 'Paid?' },
    ];
    expect(
      show(
        'table',
        [
          { code: 'A1', amount: 10, paid: true },
          { code: 'B2', amount: 2.5, paid: false },
        ],
        { columns },
        definition,
      ),
    ).toEqual({
      kind: 'table',
      headings: ['Code', 'Amount', 'Paid?'],
      rows: [
        ['A1', '$10.00', 'Yes'],
        ['B2', '$2.50', 'No'],
      ],
    });
  });

  it('leaves out a column whose rule does not pass, heading and cells', () => {
    const definition: LayoutFieldType = {
      type: 'complex[]',
      fields: { code: { type: 'string' }, ssn: { type: 'string' } },
    };
    const columns = ['line:code', { field: 'line:ssn', visibleWhen: 'test.rules.hidden' }];
    expect(show('table', [{ code: 'A1', ssn: '000-11-2222' }], { columns }, definition)).toEqual({
      kind: 'table',
      headings: ['Code'],
      rows: [['A1']],
    });
  });

  it("shows a cell through its column's widget only where the widget shows the subfield's type", () => {
    const definition: LayoutFieldType = {
      type: 'complex[]',
      fields: { amount: { type: 'double' } },
    };
    // `date` on a number would read 10 as a year; the cell shows the number instead.
    const columns = [{ field: 'line:amount', widget: 'date' }];
    expect(show('table', [{ amount: 10 }], { columns }, definition)).toEqual({
      kind: 'table',
      headings: ['Amount'],
      rows: [['10']],
    });
  });

  it.each([...WIDGETS_SHOWN_AS_VERSION_1])(
    'shows %s as version 1 would, until it has its own lookup',
    (widget) => {
      expect(show(widget, { name: 'scan.pdf' }, {}, { type: 'blob' })).toEqual({
        kind: 'layout',
        field: { key: 'k', label: 'L', kind: 'value', value: { text: 'scan.pdf' } },
      });
    },
  );

  it('shows a field with no widget as version 1 would: by its schema type', () => {
    expect(show(null, 'fr', {}, { type: 'string', directory: 'country' })).toEqual({
      kind: 'layout',
      field: { key: 'k', label: 'L', kind: 'value', value: { text: 'France' } },
    });
    expect(show(null, true, {}, { type: 'boolean' })).toEqual({
      kind: 'layout',
      field: { key: 'k', label: 'L', kind: 'value', value: { flag: true } },
    });
  });

  /**
   * Except a date, which version 1 formats in UTC: an instant is the reader's day here, as the
   * `date` widget shows it (pattern 29), alone, in a list, and at any depth of a complex value.
   * 20:00 UTC on the 23rd is the 24th at +05:30.
   */
  describe('a date with no widget, as the date widget shows it', () => {
    const at = (value: unknown, definition: LayoutFieldType) =>
      viewText(
        showValue({ key: 'k', label: 'L', value, parameters: {}, definition }, null, {
          ...context,
          timeZone: '+0530',
        }),
        context.flagText,
      );

    it('alone, and in a list', () => {
      expect(at('2026-11-23T20:00:00.000Z', { type: 'date' })).toBe('November 24, 2026');
      expect(at('2026-11-23T00:00:00.000Z', { type: 'date' })).toBe('November 23, 2026');
      expect(at(['2026-11-23T20:00:00.000Z', null, '2026-11-23'], { type: 'date[]' })).toBe(
        'November 24, 2026, November 23, 2026',
      );
      expect(at('soon', { type: 'date' })).toBe('soon');
    });

    it('in a complex value, and in a list of them, at any depth version 1 shows', () => {
      const visit: LayoutFieldType = {
        type: 'complex',
        fields: {
          at: { type: 'date' },
          follow: { type: 'complex', fields: { due: { type: 'date' } } },
        },
      };
      const value = {
        at: '2026-11-23T20:00:00.000Z',
        follow: { due: '2026-11-23T00:00:00.000Z' },
      };
      expect(at(value, visit)).toBe('At: November 24, 2026, Follow: (Due: November 23, 2026)');
      expect(at([value], { ...visit, type: 'complex[]' })).toBe(
        'At: November 24, 2026, Follow: (Due: November 23, 2026)',
      );
    });

    /**
     * Two rules, one answer. The record page shows a date through its own hook, the `date`
     * widget's; version 1's view, given none, has its own (#636). For a stored day and an instant,
     * in a zone each side of UTC where an instant's day differs from its UTC day, they agree.
     */
    it.each([
      ['+0530', '2026-11-23T20:00:00.000Z', 'November 24, 2026'],
      ['+0530', '2026-11-23T00:00:00.000Z', 'November 23, 2026'],
      ['-0500', '2026-11-24T00:30:00.000Z', 'November 23, 2026'],
      ['-0500', '2026-11-24T00:00:00.000Z', 'November 24, 2026'],
    ])("at %s, %s is %s on the record page and in version 1's view", (zone, value, day) => {
      const page = viewText(
        showValue(
          { key: 'k', label: 'L', value, parameters: {}, definition: { type: 'date' } },
          null,
          {
            ...context,
            timeZone: zone,
          },
        ),
        context.flagText,
      );
      const version1 = describeField('k', 'L', { type: 'date' }, value, {
        locale: 'en-US',
        vocabulary: (_, id) => id,
        timeZone: zone,
      });
      expect(page).toBe(day);
      expect(version1.value).toEqual({ text: day });
    });

    /** Given one, version 1's view shows a date as the hook does, at any depth. */
    it("puts the hook before version 1's own rule", () => {
      const field = describeField(
        'k',
        'L',
        { type: 'complex', fields: { at: { type: 'date' } } },
        { at: '2026-11-23T20:00:00.000Z' },
        {
          locale: 'en-US',
          vocabulary: (_, id) => id,
          timeZone: '+0530',
          date: () => ({ text: 'by the hook' }),
        },
      );
      expect(field.groups?.[0][0].value).toEqual({ text: 'by the hook' });
    });
  });
});

describe('viewText', () => {
  it("writes rich text's words, never its markup", () => {
    expect(
      viewText({ kind: 'html', html: '<p>Hi <b>there</b>&nbsp;now</p>' }, context.flagText),
    ).toBe('Hi there now');
    // Each entity as its character: `&lt;10` is a comparison, not a word "10".
    expect(viewText({ kind: 'html', html: '<p>&lt;10 R&amp;D</p>' }, context.flagText)).toBe(
      '<10 R&D',
    );
  });
});

describe('richTextWords', () => {
  it.each([
    // An entity is the character it stands for, and only once: `&amp;lt;` is `&lt;`, not `<`.
    ['<p>&lt;10</p>', '<10'],
    ['R&amp;D', 'R&D'],
    ['Caf&eacute; &#8364;5 &#x2014; ok', 'Café €5 — ok'],
    ['&amp;lt;b&amp;gt;', '&lt;b&gt;'],
    // Escaped markup stays characters: it is never parsed again.
    ['&lt;img src=x onerror=alert(1)&gt;', '<img src=x onerror=alert(1)>'],
    // Blocks and breaks part words; inline formatting does not.
    ['<p>one</p><p>two</p>', 'one two'],
    ['one<br>two', 'one two'],
    ['<ul><li>a</li><li>b</li></ul>', 'a b'],
    ['<h2>Title</h2>Body', 'Title Body'],
    ['<b>R</b>&amp;<i>D</i>', 'R&D'],
    ['  <p>  spaced\n\tout  </p>  ', 'spaced out'],
  ])('%j reads %j', (html, words) => {
    expect(richTextWords(html)).toBe(words);
  });

  /**
   * A cell says what its field says: the text the field's sanitiser drops with its element, a
   * script's or a style's, is in neither. One it unwraps, a form's, shows in both.
   */
  it("leaves out a script's and a style's text, as the field's sanitiser does, and keeps a form's", () => {
    expect(
      richTextWords(
        '<p>Hi<script>alert(1)</script><style>p{color:red}</style></p><template>hidden</template>',
      ),
    ).toBe('Hi');
    expect(richTextWords('<form><label>Name</label></form>')).toBe('Name');
  });

  /** A complex value with no widget, as its field lists it: a cell or a placeholder is not empty. */
  it('writes a complex value as its sub-fields, one value after another', () => {
    const address: LayoutFieldType = {
      type: 'complex[]',
      fields: {
        street: { type: 'string' },
        city: { type: 'string' },
        country: { type: 'string', directory: 'country' },
        verified: { type: 'boolean' },
      },
    };
    const view = showValue(
      {
        key: 'k',
        label: 'L',
        value: [
          { street: '1 Main St', city: 'Springfield', country: 'fr', verified: true },
          { street: null, city: 'Paris', country: null, verified: null },
        ],
        parameters: {},
        definition: address,
      },
      null,
      context,
    );
    expect(viewText(view, context.flagText)).toBe(
      'City: Springfield, Country: France, Street: 1 Main St, Verified: Yes; City: Paris',
    );
  });

  it('writes a flag in words, through the page’s translation', () => {
    expect(viewText({ kind: 'flag', flag: false }, context.flagText)).toBe('No');
  });
});

/**
 * A table's rows, its schema's subfields and an address's parts are plain objects: a name every
 * object inherits is not in one. `__proto__` is the one whose inherited value shows, as `{}`; a
 * subfield's type that is a function made the page throw.
 */
describe('a name every object inherits', () => {
  it('is an empty cell, whether or not the schema lists the subfields', () => {
    const cells = (definition: LayoutFieldType) =>
      showValue(
        {
          key: 'k',
          label: 'L',
          value: [{ code: 'A' }],
          parameters: { columns: ['line:code', 'line:__proto__', 'line:constructor'] },
          definition,
        },
        'table',
        context,
      );
    expect(cells({ type: 'complex[]' })).toMatchObject({ rows: [['A', '', '']] });
    expect(cells({ type: 'complex[]', fields: { code: { type: 'string' } } })).toMatchObject({
      rows: [['A', '', '']],
    });
  });

  /** Its type is read from the schema only as the schema's own: a function there made it throw. */
  it("shows a row's value under a name the schema does not list, as text", () => {
    const view = showValue(
      {
        key: 'k',
        label: 'L',
        value: [{ code: 'A', constructor: 'x' }],
        parameters: { columns: ['line:code', 'line:constructor'] },
        definition: { type: 'complex[]', fields: { code: { type: 'string' } } },
      },
      'table',
      context,
    );
    expect(view).toMatchObject({ rows: [['A', 'x']] });
  });

  /** The record page shows a complex value with no widget through version 1's view. */
  it('is a sub-field like any other of a complex value with no widget, which never throws', () => {
    const view = showValue(
      {
        key: 'k',
        label: 'L',
        value: JSON.parse('{"code":"A","constructor":"x"}'),
        parameters: {},
        definition: { type: 'complex' },
      },
      null,
      context,
    );
    expect(viewText(view, context.flagText)).toBe('Code: A, Constructor: x');
  });

  it('is no part of an address', () => {
    expect(
      show(
        'address',
        { street: '1 Main St' },
        { parts: { street: 'street', city: '__proto__' } },
        { type: 'complex', fields: { street: { type: 'string' } } },
      ),
    ).toEqual({ kind: 'lines', lines: ['1 Main St'] });
  });
});

describe('computedDefinition', () => {
  it.each([
    [3, 'double'],
    [true, 'boolean'],
    ['Jane', 'string'],
    [null, 'string'],
  ])('a %s result is a %s', (value, type) => {
    expect(computedDefinition(value)).toEqual({ type });
  });

  /** `core.choose` gives a date property's value as text: a date widget shows it as a date. */
  it.each([
    ['2026-11-23', 'date', 'date'],
    ['2026-11-23T20:00:00Z', 'date', 'date'],
    ['2026-11-23T20:00:00.000+05:30', 'relative-date', 'date'],
    ['2024-02-29', 'date', 'date'],
    // For a widget that shows text, a text that looks like a date stays text.
    ['2026-11-23', 'text', 'string'],
    ['2026-11-23', null, 'string'],
    // Not a date as Nuxeo writes one: no zone, a day that does not exist, or prose.
    ['2026-11-23T20:00:00', 'date', 'string'],
    ['2023-02-29', 'date', 'string'],
    ['2026-13-01', 'date', 'string'],
    ['23 November 2026', 'date', 'string'],
  ])('%j for the widget %j is a %s', (value, widget, type) => {
    expect(computedDefinition(value, widget)).toEqual({ type });
  });
});
