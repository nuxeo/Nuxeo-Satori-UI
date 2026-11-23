import { describe, expect, it } from 'vitest';

import type { DocumentTypeDefinition, LayoutLabel } from '../layout.model';
import type { RecordRule } from '../record-page/record-layout';
import { readFormLayout } from './form-layout';
import { formView, type FormViewContext } from './form-view';
import { resolveFormLayout, type ResolvedFormLayout } from './resolve-form-layout';

const CLAIM: DocumentTypeDefinition = {
  name: 'Claim',
  schemas: [
    {
      name: 'claim',
      prefix: 'claim',
      fields: {
        number: { type: 'string' },
        status: { type: 'string' },
        billed: { type: 'double' },
        allowed: { type: 'double' },
        denial: { type: 'string' },
        notes: { type: 'string' },
        serviceStart: { type: 'date' },
        serviceEnd: { type: 'date', required: true },
        currency: { type: 'string' },
        scan: { type: 'blob' },
        files: {
          type: 'complex[]',
          fields: { file: { type: 'blob' }, filename: { type: 'string' } },
        },
      },
    },
  ],
};

const RULES = ['core.every', 'core.some', 'core.not', 'app.rules.fieldIn', 'acme.rules.locked'];

function layoutOf(
  content: Record<string, unknown>,
  kind: 'edit' | 'create' | 'task' = 'edit',
  variables = new Map<string, { type: string }>(),
): ResolvedFormLayout {
  const file = readFormLayout(content, kind, { rules: RULES });
  if ('invalid' in file) throw new Error(file.invalid);
  return resolveFormLayout(CLAIM, file, [], variables).layout;
}

/**
 * A context over plain values. `app.rules.fieldIn` is answered as the platform's evaluator does,
 * for a property named first; `acme.rules.locked` passes while `locked` is set.
 */
function contextOf(
  values: Record<string, unknown>,
  options: { locked?: boolean; translations?: Record<string, string> } = {},
): FormViewContext & { readonly told: string[] } {
  const told: string[] = [];
  const rule = (rule: RecordRule | null): boolean => {
    if (rule === null) return true;
    if (rule === 'acme.rules.locked') return options.locked === true;
    if (typeof rule === 'object' && rule.type === 'app.rules.fieldIn') {
      const [subject, ...wanted] = rule.parameters ?? [];
      const field = (subject as { field: string }).field;
      return wanted.includes(values[field]);
    }
    throw new Error(`unexpected rule ${JSON.stringify(rule)}`);
  };
  const label = (entry: LayoutLabel): string | null =>
    entry.literal ??
    entry.keys.map((key) => options.translations?.[key]).find((text) => text !== undefined) ??
    entry.fallback;
  return {
    told,
    value: (xpath) => values[xpath],
    rule,
    label,
    valueText: ({ value, definition }, widget) =>
      value === null || value === undefined
        ? ''
        : widget === 'currency'
          ? `$${Number(value).toFixed(2)}`
          : `${String(value)}${definition.type === 'date' ? ' (date)' : ''}`,
    checkText: (type, field, bound) => `${type}: ${field} / ${bound}`,
    today: new Date(2026, 10, 23),
    tell: (message) => told.push(message),
  };
}

const field = (view: ReturnType<typeof formView>, xpath: string) =>
  view.sections.flatMap((section) => section.fields).find((entry) => entry.xpath === xpath);

const decided = (...values: string[]) => ({
  type: 'app.rules.fieldIn',
  parameters: [{ field: 'claim:status' }, ...values],
});

describe('formView', () => {
  it('draws each card as a section, under its heading, and each field with its own label', () => {
    const view = formView(
      layoutOf({
        version: 2,
        cards: [
          {
            id: 'claim',
            label: 'Claim',
            fields: ['claim:number', { field: 'claim:notes', label: 'Notes' }],
          },
          { id: 'none', fields: ['claim:status'] },
        ],
      }),
      contextOf({}),
    );
    expect(view.display).toBe('sections');
    expect(view.sections.map((section) => [section.id, section.heading])).toEqual([
      ['claim', 'Claim'],
      ['none', null],
    ]);
    expect(view.sections[0]?.fields.map((entry) => [entry.xpath, entry.label])).toEqual([
      ['claim:number', 'Number'],
      ['claim:notes', 'Notes'],
    ]);
  });

  it('draws tabs as tabs, each with its cards’ fields one after another', () => {
    const view = formView(
      layoutOf({
        version: 2,
        tabs: [
          {
            id: 'main',
            cards: [
              { id: 'a', fields: ['claim:number'] },
              { id: 'b', fields: ['claim:status'] },
            ],
          },
          {
            id: 'hidden',
            visibleWhen: 'acme.rules.locked',
            cards: [{ id: 'c', fields: ['claim:notes'] }],
          },
        ],
      }),
      contextOf({}),
    );
    expect(view.display).toBe('tabs');
    expect(view.sections.map((section) => section.heading)).toEqual(['Main']);
    expect(view.sections[0]?.fields.map((entry) => entry.xpath)).toEqual([
      'claim:number',
      'claim:status',
    ]);
  });

  describe('rules, which read the values being entered', () => {
    const CONTENT = {
      version: 2,
      cards: [
        {
          id: 'claim',
          fields: [
            'claim:status',
            { field: 'claim:allowed', required: decided('approve', 'partial') },
            { field: 'claim:denial', visibleWhen: decided('deny') },
            { field: 'claim:notes', readOnlyWhen: 'acme.rules.locked' },
          ],
        },
        { id: 'locked', visibleWhen: 'acme.rules.locked', fields: ['claim:number'] },
      ],
    };

    it('make a field required while its rule passes', () => {
      const layout = layoutOf(CONTENT);
      expect(
        field(formView(layout, contextOf({ 'claim:status': 'open' })), 'claim:allowed')?.definition
          .required,
      ).toBeUndefined();
      expect(
        field(formView(layout, contextOf({ 'claim:status': 'approve' })), 'claim:allowed')
          ?.definition.required,
      ).toBe(true);
    });

    it('show a field, or a card, only while its rule passes', () => {
      const layout = layoutOf(CONTENT);
      expect(
        field(formView(layout, contextOf({ 'claim:status': 'open' })), 'claim:denial'),
      ).toBeUndefined();
      expect(
        field(formView(layout, contextOf({ 'claim:status': 'deny' })), 'claim:denial'),
      ).toBeDefined();
      expect(formView(layout, contextOf({})).sections.map((section) => section.id)).toEqual([
        'claim',
      ]);
      expect(
        formView(layout, contextOf({}, { locked: true })).sections.map((section) => section.id),
      ).toEqual(['claim', 'locked']);
    });

    it('make a field read-only while its rule passes, showing its value as its widget does', () => {
      const layout = layoutOf(CONTENT);
      expect(field(formView(layout, contextOf({ 'claim:notes': 'Seen' })), 'claim:notes')).toEqual({
        xpath: 'claim:notes',
        label: 'Notes',
        definition: { type: 'string', required: undefined },
      });
      expect(
        field(
          formView(layout, contextOf({ 'claim:notes': 'Seen' }, { locked: true })),
          'claim:notes',
        ),
      ).toMatchObject({ readOnly: true, readOnlyText: 'Seen' });
    });

    it('never make a read-only field required: there is nothing the person can do about it', () => {
      const layout = layoutOf({
        version: 2,
        cards: [
          {
            id: 'a',
            fields: [
              { field: 'claim:serviceEnd', required: true, readOnlyWhen: 'acme.rules.locked' },
            ],
          },
        ],
      });
      // Required by the schema and by the file, then read-only.
      expect(field(formView(layout, contextOf({})), 'claim:serviceEnd')?.definition.required).toBe(
        true,
      );
      const locked = field(formView(layout, contextOf({}, { locked: true })), 'claim:serviceEnd');
      expect(locked?.readOnly).toBe(true);
      expect(locked?.definition.required).toBeUndefined();
    });
  });

  describe('checks across fields', () => {
    const CHECKED = {
      version: 2,
      cards: [
        {
          id: 'a',
          fields: [
            'claim:serviceStart',
            {
              field: 'claim:serviceEnd',
              label: 'Service end',
              checks: [{ type: 'core.notBefore', parameters: [{ field: 'claim:serviceStart' }] }],
            },
            {
              field: 'claim:allowed',
              label: 'Allowed',
              widget: 'currency',
              parameters: { currency: 'USD' },
              checks: [
                { type: 'core.atMost', parameters: [{ field: 'claim:billed' }], label: 'Too much' },
                { type: 'core.atMost', parameters: [5000], labelKey: 'acme.cap' },
              ],
            },
          ],
        },
      ],
    };

    it('say nothing while every check passes', () => {
      const view = formView(
        layoutOf(CHECKED),
        contextOf({
          'claim:serviceStart': '2026-03-01',
          'claim:serviceEnd': '2026-03-02',
          'claim:allowed': 100,
          'claim:billed': 200,
        }),
      );
      expect(view.errors).toEqual({});
    });

    it('give the first failing check’s label, else the form’s words naming the other field', () => {
      const view = formView(
        layoutOf(CHECKED),
        contextOf({
          'claim:serviceStart': '2026-03-02',
          'claim:serviceEnd': '2026-03-01',
          'claim:allowed': 6000,
          'claim:billed': 200,
        }),
      );
      expect(view.errors).toEqual({
        'claim:serviceEnd': 'core.notBefore: Service end / Service start',
        'claim:allowed': 'Too much',
      });
    });

    it('translate a check’s labelKey, and write a literal bound as the field’s widget shows a value', () => {
      const values = { 'claim:allowed': 6000, 'claim:billed': 9000 };
      expect(
        formView(
          layoutOf(CHECKED),
          contextOf(values, { translations: { 'acme.cap': 'At most 5,000' } }),
        ).errors,
      ).toEqual({ 'claim:allowed': 'At most 5,000' });
      expect(formView(layoutOf(CHECKED), contextOf(values)).errors).toEqual({
        'claim:allowed': 'core.atMost: Allowed / $5000.00',
      });
    });

    it('are not run on a read-only field, which the person cannot correct', () => {
      const layout = layoutOf({
        version: 2,
        cards: [
          {
            id: 'a',
            fields: [
              {
                field: 'claim:allowed',
                readOnlyWhen: 'acme.rules.locked',
                checks: [{ type: 'core.atMost', parameters: [1] }],
              },
            ],
          },
        ],
      });
      expect(formView(layout, contextOf({ 'claim:allowed': 5 })).errors).not.toEqual({});
      expect(formView(layout, contextOf({ 'claim:allowed': 5 }, { locked: true })).errors).toEqual(
        {},
      );
    });

    it('say in the console why a check could not compare, and do not stop the save', () => {
      const context = contextOf({ 'claim:serviceStart': 'soon', 'claim:serviceEnd': '2026-03-01' });
      const view = formView(layoutOf(CHECKED), context);
      expect(view.errors).toEqual({});
      expect(context.told).toEqual([
        'Claim/edit layout: cards[0].fields[1].checks[0] not checked: core.notBefore compares dates, not "soon"',
      ]);
    });
  });

  describe('widgets as inputs', () => {
    it('give a vocabulary its directory, a long text its lines, and a currency its code', () => {
      const view = formView(
        layoutOf({
          version: 2,
          cards: [
            {
              id: 'a',
              fields: [
                {
                  field: 'claim:status',
                  widget: 'vocabulary',
                  parameters: { directory: 'claimStatus' },
                },
                { field: 'claim:notes', widget: 'long-text', parameters: { rows: 5 } },
                { field: 'claim:denial', widget: 'rich-text' },
                { field: 'claim:allowed', widget: 'currency', parameters: { currency: 'USD' } },
                {
                  field: 'claim:billed',
                  widget: 'currency',
                  parameters: { currency: { field: 'claim:currency' } },
                },
              ],
            },
          ],
        }),
        contextOf({ 'claim:currency': 'EUR' }),
      );
      expect(field(view, 'claim:status')?.definition).toEqual({
        type: 'string',
        directory: 'claimStatus',
        required: undefined,
      });
      expect(field(view, 'claim:notes')).toMatchObject({ multiline: true, rows: 5 });
      expect(field(view, 'claim:denial')).toMatchObject({ multiline: true });
      expect(field(view, 'claim:denial')?.rows).toBeUndefined();
      expect(field(view, 'claim:allowed')?.label).toBe('Allowed (USD)');
      expect(field(view, 'claim:billed')?.label).toBe('Billed (EUR)');
    });
  });

  describe('files', () => {
    it('are shown, never edited: a file-list over complex entries is not a list to add to', () => {
      const view = formView(
        layoutOf({
          version: 2,
          cards: [
            {
              id: 'a',
              fields: [
                { field: 'claim:files', widget: 'file-list' },
                { field: 'claim:scan', widget: 'image' },
              ],
            },
          ],
        }),
        contextOf({ 'claim:files': [{ filename: 'eob.pdf' }], 'claim:scan': { name: 'x.png' } }),
      );
      expect(field(view, 'claim:files')).toMatchObject({ readOnly: true });
      expect(field(view, 'claim:scan')).toMatchObject({ readOnly: true });
      expect(field(view, 'claim:files')?.definition.required).toBeUndefined();
    });
  });

  describe('a computed field', () => {
    const COMPUTED = {
      version: 2,
      cards: [
        {
          id: 'a',
          fields: [
            'claim:number',
            {
              id: 'title',
              label: 'Title',
              computed: { type: 'core.template', parameters: ['Claim {claim:number}'] },
            },
            {
              id: 'broken',
              computed: { type: 'core.count', parameters: [{ field: 'claim:number' }] },
            },
          ],
        },
      ],
    };

    it('shows its result read-only, worked out from the values being entered', () => {
      const view = formView(layoutOf(COMPUTED), contextOf({ 'claim:number': 'CLM-9' }));
      expect(field(view, 'title')).toEqual({
        xpath: 'title',
        label: 'Title',
        definition: { type: 'string' },
        readOnly: true,
        readOnlyText: 'Claim CLM-9',
      });
    });

    it('is left out when there is no result, and the console says why', () => {
      const context = contextOf({ 'claim:number': 'CLM-9' });
      const view = formView(layoutOf(COMPUTED), context);
      expect(field(view, 'broken')).toBeUndefined();
      expect(context.told).toEqual([
        'Claim/edit layout: cards[0].fields[2] left out: the computation "core.count" takes a list, not "CLM-9"',
      ]);
    });
  });

  describe('a task form', () => {
    const TASK = {
      version: 2,
      cards: [
        {
          id: 'claim',
          fields: [
            'claim:number',
            { field: 'claim:billed', widget: 'currency', parameters: { currency: 'USD' } },
          ],
        },
        {
          id: 'determination',
          fields: [
            { field: 'var:decision', required: true },
            {
              field: 'var:allowedAmount',
              required: {
                type: 'app.rules.fieldIn',
                parameters: [{ field: 'var:decision' }, 'approve'],
              },
              checks: [
                {
                  type: 'core.atMost',
                  parameters: [{ field: 'claim:billed' }],
                  label: 'No more than billed',
                },
              ],
            },
          ],
        },
      ],
    };
    const VARIABLES = new Map([
      ['var:decision', { type: 'string' }],
      ['var:allowedAmount', { type: 'double' }],
    ]);

    it('shows the record’s own properties read-only, and edits its variables', () => {
      const view = formView(
        layoutOf(TASK, 'task', VARIABLES),
        contextOf({ 'claim:number': 'CLM-1', 'claim:billed': 1200 }),
      );
      expect(field(view, 'claim:number')).toMatchObject({ readOnly: true, readOnlyText: 'CLM-1' });
      expect(field(view, 'claim:billed')).toMatchObject({
        readOnly: true,
        readOnlyText: '$1200.00',
      });
      expect(field(view, 'var:decision')?.readOnly).toBeUndefined();
      expect(field(view, 'var:decision')?.definition.required).toBe(true);
    });

    it('holds a variable to its rules and checks, against the record’s own values', () => {
      const layout = layoutOf(TASK, 'task', VARIABLES);
      const view = formView(
        layout,
        contextOf({ 'claim:billed': 1200, 'var:decision': 'approve', 'var:allowedAmount': 1300 }),
      );
      expect(field(view, 'var:allowedAmount')?.definition.required).toBe(true);
      expect(view.errors).toEqual({ 'var:allowedAmount': 'No more than billed' });
    });
  });
});
