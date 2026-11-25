import { PACKAGED_REGISTRIES } from '@agentic-ui/shared/app-definition';

import { appActionForm } from './app-action-form';

// An action's form, as the version 2 form engine draws it: a task form of one card, whose `var:`
// fields take the type their widget shows. One it cannot draw whole is refused, never drawn short.

const RULES = Object.keys(PACKAGED_REGISTRIES.rules);

const REQUEST_RECORDS_FORM = [
  { field: 'var:urgent', labelKey: 'payers.action.requestRecords.urgent', widget: 'boolean' },
  {
    field: 'var:note',
    labelKey: 'payers.action.requestRecords.note',
    widget: 'long-text',
    parameters: { rows: 3 },
    required: true,
  },
];

describe('appActionForm', () => {
  it("draws the Payers kit's form: a flag, and a note that is required", () => {
    const read = appActionForm(REQUEST_RECORDS_FORM, 'Claim', RULES);
    if ('refused' in read) throw new Error(read.refused);
    expect(read.form.kind).toBe('task');
    const fields = read.form.cards.flatMap((card) => card.fields);
    expect(fields.map((field) => (field.kind === 'property' ? field.xpath : field.id))).toEqual([
      'var:urgent',
      'var:note',
    ]);
    expect(fields.map((field) => field.kind === 'property' && field.definition.type)).toEqual([
      'boolean',
      'string',
    ]);
    expect(fields[1].kind === 'property' && fields[1].required).toBe(true);
    expect(read.problems).toEqual([]);
  });

  it('gives each widget the type it asks for', () => {
    const typeOf = (field: Record<string, unknown>) => {
      const read = appActionForm([{ field: 'var:x', ...field }], 'Claim', RULES);
      if ('refused' in read) throw new Error(read.refused);
      const [only] = read.form.cards[0].fields;
      return only.kind === 'property' ? only.definition : null;
    };
    expect(typeOf({})).toEqual({ type: 'string' });
    expect(typeOf({ widget: 'number' })).toEqual({ type: 'long' });
    expect(typeOf({ widget: 'number', parameters: { decimals: 2 } })).toEqual({ type: 'double' });
    expect(typeOf({ widget: 'currency', parameters: { currency: 'USD' } })).toEqual({
      type: 'double',
    });
    expect(typeOf({ widget: 'date' })).toEqual({ type: 'date' });
    expect(
      typeOf({ widget: 'vocabulary', parameters: { directory: 'PayersClaimDecision' } }),
    ).toEqual({ type: 'string', directory: 'PayersClaimDecision' });
  });

  it('refuses a widget that asks for more than one value', () => {
    const read = appActionForm(
      [{ field: 'var:where', widget: 'address', parameters: { parts: ['city'] } }],
      'Claim',
      RULES,
    );
    expect(read).toEqual({
      refused:
        'var:where: the widget "address" asks for more than one value, which an action\'s form cannot send',
    });
  });

  it('refuses a form whose field the reader leaves out, rather than run without it', () => {
    const read = appActionForm(
      [...REQUEST_RECORDS_FORM, { field: 'var:due', visibleWhen: 'acme.rules.unknown' }],
      'Claim',
      RULES,
    );
    expect('refused' in read && read.refused).toMatch(
      /^1 of its 3 fields cannot be drawn, and the operation would run without them: /,
    );
  });

  it('refuses a form that is not one', () => {
    expect('refused' in appActionForm([42], 'Claim', RULES)).toBe(true);
  });
});
