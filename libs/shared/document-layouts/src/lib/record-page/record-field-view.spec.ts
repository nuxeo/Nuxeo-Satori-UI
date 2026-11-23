import { describe, expect, it } from 'vitest';

import type { LayoutFieldType } from '../layout.model';
import {
  WIDGETS_SHOWN_AS_VERSION_1,
  WIDGET_VIEWS,
  computedDefinition,
  relativeDateText,
  showValue,
  viewText,
  type RecordValueContext,
} from './record-field-view';
import { PACKAGED_WIDGETS } from '@agentic-ui/shared/app-definition';

const TODAY = new Date('2026-11-23T12:00:00Z');

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
  property: (xpath) => ({ 'claim:currency': 'EUR', 'claim:badCurrency': 'eur' })[xpath],
  label: (label) => label.literal ?? label.fallback,
  flagText: (flag) => (flag ? 'Yes' : 'No'),
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
});

describe('viewText', () => {
  it("writes rich text's words, never its markup", () => {
    expect(
      viewText({ kind: 'html', html: '<p>Hi <b>there</b>&nbsp;now</p>' }, context.flagText),
    ).toBe('Hi there now');
  });

  it('writes a flag in words, through the page’s translation', () => {
    expect(viewText({ kind: 'flag', flag: false }, context.flagText)).toBe('No');
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
});
