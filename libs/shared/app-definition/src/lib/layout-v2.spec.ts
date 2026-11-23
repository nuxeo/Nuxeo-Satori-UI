import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadable,
  publishable,
  validateLayoutV2,
  type Finding,
  type LayoutMode,
} from './layout-v2';
import { PACKAGED_REGISTRIES, withRegistered } from './registries';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const proposal = readFileSync(join(ROOT, 'docs', 'business-apps', 'layout-v2.md'), 'utf8');

/** A minimal sound file, for the controls to break one thing at a time. */
const sound = (): Record<string, unknown> => ({
  version: 2,
  columns: 2,
  cards: [
    {
      id: 'member',
      label: 'Member',
      fields: [
        'member:firstName',
        { field: 'member:birthDate', widget: 'date', parameters: { format: 'long' } },
        {
          id: 'age',
          widget: 'number',
          computed: { type: 'core.age', parameters: [{ field: 'member:birthDate' }] },
        },
      ],
    },
  ],
});

const findings = (content: unknown, mode: LayoutMode = 'view'): Finding[] =>
  validateLayoutV2(content, { mode });
const messages = (content: unknown, mode: LayoutMode = 'view'): string[] =>
  findings(content, mode).map((finding) => `${finding.path}: ${finding.message} [${finding.kind}]`);

/** A file with one card holding these fields. */
const withFields = (...fields: unknown[]) => ({ version: 2, cards: [{ id: 'c', fields }] });

describe('the proposal and the validator agree', () => {
  // Every JSON example of docs/business-apps/layout-v2.md must validate with no finding. The
  // examples are files, cards or fields; a card or field is wrapped in the smallest file.
  const examples = [...proposal.matchAll(/```json\n([\s\S]*?)```/g)].map((match) =>
    JSON.parse(match[1]),
  );

  it('finds the examples', () => {
    expect(examples.length).toBeGreaterThanOrEqual(5);
  });

  examples.forEach((example, index) => {
    it(`example ${index + 1} has no finding`, () => {
      const form = JSON.stringify(example).includes('"checks"');
      const file =
        'version' in example
          ? example
          : 'related' in example || 'fields' in example
            ? { version: 2, columns: 2, cards: [example] }
            : withFields(example);
      expect(messages(file, form ? 'edit' : 'view')).toEqual([]);
    });
  });
});

describe('the proposed examples are refused until they are built', () => {
  // A block fenced "```json proposed <widget>.<parameter>" is a proposal not yet built, such as
  // layout-v2.md's section 12: the validator refuses it today, and for that widget's parameter
  // alone. The day it is accepted, the proposal is built: make the block a plain ```json example,
  // which the test above then holds to no finding, and settle its section. When no proposed block
  // is left, delete this describe, whose first test would fail.
  const proposed = [
    ...proposal.matchAll(/```json proposed ([a-z-]+)\.([A-Za-z]+)\n([\s\S]*?)```/g),
  ].map(([, widget, parameter, body]) => ({ widget, parameter, example: JSON.parse(body) }));

  it('finds them', () => {
    expect(proposed.length).toBeGreaterThanOrEqual(1);
  });

  proposed.forEach(({ widget, parameter, example }, index) => {
    it(`proposed example ${index + 1} is refused, for ${widget}'s "${parameter}" alone`, () => {
      // Wrapped as the examples above are: a file, a card, or a field.
      const file =
        'version' in example
          ? example
          : 'related' in example || 'fields' in example
            ? { version: 2, columns: 2, cards: [example] }
            : withFields(example);
      const found = messages(file);
      expect(found.length).toBeGreaterThan(0);
      const refusal = `.parameters.${parameter}: the widget "${widget}" has no parameter "${parameter}" [parameter]`;
      for (const message of found) expect(message.endsWith(refusal)).toBe(true);
    });
  });
});

describe('a sound file', () => {
  it('has no finding, in every mode it suits', () => {
    expect(messages(sound())).toEqual([]);
    const form = {
      version: 2,
      tabs: [
        {
          id: 't',
          cards: [{ id: 'c', fields: ['dc:title', { field: 'cl:amount', required: true }] }],
        },
      ],
    };
    for (const mode of ['metadata', 'edit', 'create'] as const) {
      expect(messages(mode === 'metadata' ? withFields('dc:title') : form, mode)).toEqual([]);
    }
  });
});

// Negative controls: each file below is wrong in one way, and each must be found, with the right
// place and kind.
describe('the validator finds', () => {
  it('a file that is not version 2, and refuses to read further', () => {
    expect(messages({ ...sound(), version: 1 })).toEqual([
      'version: version must be 2, not 1 [structure]',
    ]);
    expect(messages([])).toEqual([': a layout file is a JSON object [structure]']);
  });

  it('cards and tabs together, or neither', () => {
    expect(messages({ version: 2, cards: [], tabs: [] })).toContain(
      ': a file has "cards" or "tabs", one of the two [structure]',
    );
    expect(messages({ version: 2 })).toContain(
      ': a file has "cards" or "tabs", one of the two [structure]',
    );
  });

  it('an id used twice, or malformed', () => {
    const file = withFields({
      id: 'c',
      computed: { type: 'core.count', parameters: [{ field: 'cl:lines' }] },
    });
    expect(messages(file)).toContain(
      'cards[0].fields[0].id: the id "c" is already used at cards[0].id [structure]',
    );
    expect(messages({ version: 2, cards: [{ id: '-bad', fields: [] }] })).toEqual([
      'cards[0].id: an id is 1 to 64 letters, digits, ".", "_" or "-", starting with a letter or digit [structure]',
    ]);
  });

  it('a field with both a property and a computation, or neither, or a computed field with no id', () => {
    expect(
      messages(
        withFields({
          field: 'dc:title',
          computed: { type: 'core.count', parameters: [{ field: 'x:y' }] },
          id: 'n',
        }),
      ),
    ).toContain(
      'cards[0].fields[0]: a field has "field" or "computed", one of the two [structure]',
    );
    expect(messages(withFields({ label: 'Nothing' }))).toContain(
      'cards[0].fields[0]: a field has "field" or "computed", one of the two [structure]',
    );
    expect(
      messages(withFields({ computed: { type: 'core.count', parameters: [{ field: 'x:y' }] } })),
    ).toContain('cards[0].fields[0]: a computed field needs an id [structure]');
    expect(messages(withFields('not a property'))).toContain(
      'cards[0].fields[0]: "not a property" is not a property, <prefix>:<name> [structure]',
    );
  });

  it('a widget nobody registered, by name: phase 0 demo step 1', () => {
    expect(messages(withFields({ field: 'member:birthDate', widget: 'calendar' }))).toEqual([
      'cards[0].fields[0].widget: the widget "calendar" is not registered [unknown]',
    ]);
  });

  it("a widget's parameter it does not have, a bad value, and a missing one", () => {
    expect(
      messages(
        withFields({
          field: 'cl:amount',
          widget: 'currency',
          parameters: { currency: 'USD', colour: 'red' },
        }),
      ),
    ).toEqual([
      'cards[0].fields[0].parameters.colour: the widget "currency" has no parameter "colour" [parameter]',
    ]);
    expect(
      messages(
        withFields({ field: 'cl:amount', widget: 'currency', parameters: { currency: 'dollars' } }),
      ),
    ).toEqual([
      'cards[0].fields[0].parameters.currency: currency must be an ISO 4217 code such as "USD", or { "field": "<prefix>:<name>" } [parameter]',
    ]);
    expect(messages(withFields({ field: 'cl:status', widget: 'vocabulary' }))).toEqual([
      'cards[0].fields[0].parameters: the widget "vocabulary" needs "directory" [parameter]',
    ]);
  });

  it("a table's columns, held to the rules of any field", () => {
    const table = {
      field: 'cl:lines',
      widget: 'table',
      parameters: { columns: ['line:code', { field: 'line:amount', widget: 'money' }] },
    };
    expect(messages(withFields(table))).toEqual([
      'cards[0].fields[0].parameters.columns[1].widget: the widget "money" is not registered [unknown]',
    ]);
  });

  it('a computation nobody registered, the wrong number of parameters, and a bad placeholder', () => {
    expect(
      messages(withFields({ id: 'x', computed: { type: 'core.median', parameters: [] } })),
    ).toEqual([
      'cards[0].fields[0].computed.type: the computation "core.median" is not registered [unknown]',
    ]);
    expect(
      messages(
        withFields({
          id: 'x',
          computed: { type: 'core.dateDiff', parameters: [{ field: 'a:b' }] },
        }),
      ),
    ).toEqual([
      'cards[0].fields[0].computed.parameters: the computation "core.dateDiff" takes 3 parameters, not 1 [parameter]',
    ]);
    expect(
      messages(
        withFields({
          id: 'x',
          computed: { type: 'core.template', parameters: ['{member:firstName} {surname}'] },
        }),
      ),
    ).toEqual([
      'cards[0].fields[0].computed.parameters[0]: the placeholder {surname} is not a property, <prefix>:<name> [parameter]',
    ]);
    expect(
      messages(
        withFields({
          id: 'x',
          computed: { type: 'core.dateDiff', parameters: [{ field: 'a:b' }, 'today', 'weeks'] },
        }),
      ),
    ).toEqual([
      'cards[0].fields[0].computed.parameters[2]: the computation "core.dateDiff" takes "days", "months" or "years" here [parameter]',
    ]);
  });

  it('a rule nobody registered, a combinator given the wrong rules, and a malformed value', () => {
    expect(messages(withFields({ field: 'a:b', visibleWhen: 'app.rules.isFullMoon' }))).toEqual([
      'cards[0].fields[0].visibleWhen: the rule "app.rules.isFullMoon" is not registered [unknown]',
    ]);
    expect(
      messages(
        withFields({
          field: 'a:b',
          visibleWhen: {
            type: 'core.not',
            parameters: ['app.rules.canWrite', 'app.rules.isLocked'],
          },
        }),
      ),
    ).toEqual([
      'cards[0].fields[0].visibleWhen.parameters: the rule "core.not" takes 1 parameter, not 2 [parameter]',
    ]);
    expect(
      messages(
        withFields({
          field: 'a:b',
          visibleWhen: { type: 'core.every', parameters: ['app.rules.canWrite', 'app.rules.nope'] },
        }),
      ),
    ).toEqual([
      'cards[0].fields[0].visibleWhen.parameters[1]: the rule "app.rules.nope" is not registered [unknown]',
    ]);
    expect(
      messages(
        withFields({
          id: 'x',
          computed: { type: 'core.age', parameters: [{ field: 'not a property' }] },
        }),
      ),
    ).toEqual([
      'cards[0].fields[0].computed.parameters[0]: a value is a text, a number, a boolean, { "field": "<prefix>:<name>" } or { "computed": {...} } [structure]',
    ]);
  });

  it("a customer's own rule, once the caller registers it", () => {
    const file = withFields({
      field: 'a:b',
      visibleWhen: { type: 'acme.rules.isContract', parameters: [1, 'any'] },
    });
    expect(messages(file)).toHaveLength(1);
    const registries = withRegistered(PACKAGED_REGISTRIES, { rules: ['acme.rules.isContract'] });
    expect(validateLayoutV2(file, { mode: 'view', registries })).toEqual([]);
  });

  it('a key version 2 does not have, such as a misspelt one', () => {
    expect(messages(withFields({ field: 'a:b', visibileWhen: 'app.rules.canWrite' }))).toEqual([
      'cards[0].fields[0].visibileWhen: "visibileWhen" is not a key version 2 has [unknown]',
    ]);
  });

  it('form keys outside a form, and a computed field made required', () => {
    expect(messages(withFields({ field: 'a:b', required: true }), 'view')).toEqual([
      'cards[0].fields[0].required: "required" belongs in the edit and create forms only [structure]',
    ]);
    expect(
      messages(
        withFields({
          id: 'n',
          computed: { type: 'core.count', parameters: [{ field: 'x:y' }] },
          required: true,
        }),
        'edit',
      ),
    ).toContain(
      'cards[0].fields[0]: a computed field is never editable, so it is never required or read-only [structure]',
    );
  });

  it("fieldIn given a computation to compare, which the rules' library never evaluates", () => {
    expect(
      messages(
        withFields({
          field: 'a:b',
          visibleWhen: {
            type: 'app.rules.fieldIn',
            parameters: [{ computed: { type: 'core.template', parameters: ['x'] } }, 'x'],
          },
        }),
      ),
    ).toEqual([
      'cards[0].fields[0].visibleWhen.parameters[0]: the rule "app.rules.fieldIn" takes a property or a literal here, not a computation [parameter]',
    ]);
    expect(
      messages(
        withFields({
          field: 'a:b',
          visibleWhen: { type: 'app.rules.fieldIn', parameters: [{ field: 'a:status' }, 'denied'] },
        }),
      ),
    ).toEqual([]);
  });

  it('fieldIn given the numbers and booleans its evaluator compares, and nothing else', () => {
    const fieldIn = (...values: unknown[]) =>
      messages(
        withFields({
          field: 'a:b',
          visibleWhen: {
            type: 'app.rules.fieldIn',
            parameters: [{ field: 'a:amount' }, ...values],
          },
        }),
      );
    expect(fieldIn(5000, 2.5, true, false, 'denied')).toEqual([]);
    expect([...fieldIn({ field: 'a:other' }), ...fieldIn(null), ...fieldIn('')]).toEqual(
      [0, 1, 2].map(
        () =>
          'cards[0].fields[0].visibleWhen.parameters[1]: the rule "app.rules.fieldIn" takes a text, a number or a boolean here [parameter]',
      ),
    );
    // The names the other two compare are still texts.
    expect(
      messages(
        withFields({
          field: 'a:b',
          visibleWhen: { type: 'app.rules.inGroup', parameters: [5000] },
        }),
      ),
    ).toEqual([
      'cards[0].fields[0].visibleWhen.parameters[0]: the rule "app.rules.inGroup" takes a text here [parameter]',
    ]);
  });

  it('isNotBusy given the operations it waits for, as the reference writes it', () => {
    expect(
      messages(
        withFields({
          field: 'a:b',
          visibleWhen: { type: 'app.rules.isNotBusy', parameters: ['trash'] },
        }),
      ),
    ).toEqual([]);
  });

  it('a computed field shown as rich text, which would make its text markup', () => {
    expect(
      messages(
        withFields({
          id: 'n',
          widget: 'rich-text',
          computed: { type: 'core.template', parameters: ['{a:b}'] },
        }),
      ),
    ).toEqual([
      'cards[0].fields[0].widget: a computed field is text, never HTML, so it cannot use the widget "rich-text" [parameter]',
    ]);
  });

  it("a form's checks: one nobody registered, and one given the wrong parameters", () => {
    expect(
      messages(
        withFields({
          field: 'a:end',
          checks: [{ type: 'core.after', parameters: [{ field: 'a:start' }] }],
        }),
        'edit',
      ),
    ).toEqual([
      'cards[0].fields[0].checks[0].type: the check "core.after" is not registered [unknown]',
    ]);
    expect(
      messages(
        withFields({ field: 'a:end', checks: [{ type: 'core.notBefore', parameters: [] }] }),
        'edit',
      ),
    ).toEqual([
      'cards[0].fields[0].checks[0].parameters: the check "core.notBefore" takes 1 parameter, not 0 [parameter]',
    ]);
  });

  it('related records outside view mode, and columns or span where they do not belong', () => {
    const related = { id: 'r', related: { pageProvider: 'p', columns: ['dc:title'] } };
    expect(messages({ version: 2, cards: [related] }, 'edit')).toEqual([
      'cards[0].related: related records belong in view mode only [structure]',
    ]);
    expect(
      messages({ version: 2, columns: 2, cards: [{ id: 'c', fields: [] }] }, 'metadata'),
    ).toEqual(['columns: columns belongs in view mode only [structure]']);
    expect(messages({ version: 2, columns: 2, cards: [{ id: 'c', span: 3, fields: [] }] })).toEqual(
      ["cards[0].span: span is a whole number from 1 to the file's 2 columns [structure]"],
    );
    expect(messages({ version: 2, columns: 4, cards: [] })).toEqual([
      'columns: columns is 1, 2 or 3 [structure]',
    ]);
  });

  it('a related list with no page provider or columns, a bad sort, page size and row action', () => {
    const bad = {
      version: 2,
      cards: [
        {
          id: 'r',
          related: {
            pageProvider: '',
            columns: [],
            sort: [{ field: 'dc:title', order: 'up' }],
            pageSize: 500,
            rowActions: ['app.rowActions.open'],
          },
        },
      ],
    };
    expect(messages(bad)).toEqual([
      'cards[0].related.pageProvider: needs the name of a page provider defined on the server [structure]',
      'cards[0].related.columns: needs a list of columns [structure]',
      'cards[0].related.sort[0].order: order is "asc" or "desc" [structure]',
      'cards[0].related.pageSize: pageSize is a whole number from 1 to 100 [structure]',
      'cards[0].related.rowActions[0]: the row action "app.rowActions.open" is not registered [unknown]',
    ]);
  });
});

/** A view file with one related-records card, its list given these keys too. */
const relatedWith = (keys: Record<string, unknown>) => ({
  version: 2,
  cards: [{ id: 'r', related: { pageProvider: 'p', columns: ['dc:title'], ...keys } }],
});

// The rest of the negative controls: one row for each other shape the validator refuses. Each
// input is wrong in one way, and its finding must be exactly this one.
const refusals: readonly { what: string; file: unknown; mode?: LayoutMode; found: string }[] = [
  {
    what: 'a label that is not a text',
    file: withFields({ field: 'a:b', label: 3 }),
    found: 'cards[0].fields[0].label: must be a text [structure]',
  },
  {
    what: 'a rule that is neither an ID nor an object',
    file: withFields({ field: 'a:b', visibleWhen: 3 }),
    found:
      'cards[0].fields[0].visibleWhen: a rule is an ID, or { "type": <ID>, "parameters": [...] } [structure]',
  },
  {
    what: "a rule's parameters that are not a list",
    file: withFields({
      field: 'a:b',
      visibleWhen: { type: 'app.rules.isType', parameters: 'File' },
    }),
    found: 'cards[0].fields[0].visibleWhen.parameters: parameters must be a list [structure]',
  },
  {
    what: 'a rule given a number where it takes a text',
    file: withFields({ field: 'a:b', visibleWhen: { type: 'app.rules.isType', parameters: [3] } }),
    found:
      'cards[0].fields[0].visibleWhen.parameters[0]: the rule "app.rules.isType" takes a text here [parameter]',
  },
  {
    what: 'a rule that takes a list, given none',
    file: withFields({ field: 'a:b', visibleWhen: 'app.rules.hasFacet' }),
    found:
      'cards[0].fields[0].visibleWhen.parameters: the rule "app.rules.hasFacet" takes at least 1 parameter, not 0 [parameter]',
  },
  {
    what: 'a computation given more parameters than it takes',
    file: withFields({
      id: 's',
      computed: { type: 'core.sum', parameters: [{ field: 'cl:lines' }, 'amount', 'extra'] },
    }),
    found:
      'cards[0].fields[0].computed.parameters: the computation "core.sum" takes 1 to 2 parameters, not 3 [parameter]',
  },
  {
    what: 'a template that is not a text',
    file: withFields({ id: 't', computed: { type: 'core.template', parameters: [3] } }),
    found:
      'cards[0].fields[0].computed.parameters[0]: the computation "core.template" takes a text with {<prefix>:<name>} placeholders [parameter]',
  },
  {
    what: 'a computation that is not an object',
    file: withFields({ id: 'x', computed: 'core.age' }),
    found:
      'cards[0].fields[0].computed: a computation is { "type": <ID>, "parameters": [...] } [structure]',
  },
  {
    what: "a computation's parameters that are not a list",
    file: withFields({ id: 'x', computed: { type: 'core.age', parameters: { field: 'a:b' } } }),
    found: 'cards[0].fields[0].computed.parameters: parameters must be a list [structure]',
  },
  {
    what: 'a check that is not an object',
    file: withFields({ field: 'a:end', checks: ['core.notBefore'] }),
    mode: 'edit',
    found:
      'cards[0].fields[0].checks[0]: a check is { "type": <ID>, "parameters": [...], "label" or "labelKey" } [structure]',
  },
  {
    what: "a check's parameters that are not a list",
    file: withFields({
      field: 'a:end',
      checks: [{ type: 'core.notBefore', parameters: { field: 'a:start' } }],
    }),
    mode: 'edit',
    found: 'cards[0].fields[0].checks[0].parameters: parameters must be a list [structure]',
  },
  {
    what: 'checks that are not a list',
    file: withFields({ field: 'a:end', checks: { type: 'core.notBefore' } }),
    mode: 'create',
    found: 'cards[0].fields[0].checks: checks must be a list [structure]',
  },
  {
    what: "a widget's parameters that are not an object",
    file: withFields({ field: 'a:b', widget: 'number', parameters: [2] }),
    found: 'cards[0].fields[0].parameters: parameters must be an object [structure]',
  },
  {
    what: 'parameters with no widget',
    file: withFields({ field: 'a:b', parameters: { rows: 4 } }),
    found: 'cards[0].fields[0].parameters: parameters need a widget to belong to [parameter]',
  },
  {
    what: 'a widget not named by its ID',
    file: withFields({ field: 'a:b', widget: { id: 'date' } }),
    found: 'cards[0].fields[0].widget: a widget is named by its ID [structure]',
  },
  {
    what: 'a field that is neither a property nor an object',
    file: withFields(3),
    found: 'cards[0].fields[0]: a field is "<prefix>:<name>" or an object [structure]',
  },
  {
    what: 'a field whose property has no prefix',
    file: withFields({ field: 'title' }),
    found: 'cards[0].fields[0].field: must be a property, <prefix>:<name> [structure]',
  },
  {
    what: 'related records that are not an object',
    file: { version: 2, cards: [{ id: 'r', related: 'members' }] },
    found: 'cards[0].related: related is an object [structure]',
  },
  {
    what: "a related list's parameters that are not a list",
    file: relatedWith({ parameters: 'x' }),
    found: 'cards[0].related.parameters: parameters must be a list [structure]',
  },
  {
    what: 'a page provider parameter that is a computation',
    file: relatedWith({
      parameters: [{ computed: { type: 'core.age', parameters: [{ field: 'a:b' }] } }],
    }),
    found:
      'cards[0].related.parameters[0]: a page provider parameter is a literal or { "field": "<prefix>:<name>" } [structure]',
  },
  {
    what: 'a sort that is not a list',
    file: relatedWith({ sort: { field: 'dc:title' } }),
    found: 'cards[0].related.sort: sort must be a list [structure]',
  },
  {
    what: 'a sort with no property',
    file: relatedWith({ sort: [{ order: 'asc' }] }),
    found:
      'cards[0].related.sort[0]: a sort is { "field": "<prefix>:<name>", "order": "asc" or "desc" } [structure]',
  },
  {
    what: 'row actions that are not a list',
    file: relatedWith({ rowActions: 'app.rowActions.download' }),
    found: 'cards[0].related.rowActions: rowActions must be a list [structure]',
  },
  {
    what: 'a card that is not an object',
    file: { version: 2, cards: ['member'] },
    found: 'cards[0]: a card is an object [structure]',
  },
  {
    what: 'a span outside view mode',
    file: { version: 2, cards: [{ id: 'c', span: 1, fields: [] }] },
    mode: 'metadata',
    found: 'cards[0].span: span belongs in view mode only [structure]',
  },
  {
    what: 'a card with neither fields nor related records',
    file: { version: 2, cards: [{ id: 'c' }] },
    found: 'cards[0]: a card has "fields" or "related", one of the two [structure]',
  },
  {
    what: 'fields that are not a list',
    file: { version: 2, cards: [{ id: 'c', fields: 'dc:title' }] },
    found: 'cards[0].fields: fields must be a list [structure]',
  },
  {
    what: 'cards that are not a list',
    file: { version: 2, cards: { id: 'c', fields: [] } },
    found: 'cards: cards must be a list [structure]',
  },
  {
    what: 'tabs that are not a list',
    file: { version: 2, tabs: { id: 't', cards: [] } },
    found: 'tabs: tabs must be a list [structure]',
  },
  {
    what: 'a tab that is not an object',
    file: { version: 2, tabs: ['t'] },
    found: 'tabs[0]: a tab is an object [structure]',
  },
  {
    what: 'a tab with no cards',
    file: { version: 2, tabs: [{ id: 't' }] },
    found: 'tabs[0].cards: cards must be a list [structure]',
  },
];

describe('the validator refuses, one shape at a time', () => {
  it.each(refusals)('$what', ({ file, mode, found }) => {
    expect(messages(file, mode)).toEqual([found]);
  });

  it('a mode that is not one of the four', () => {
    expect(validateLayoutV2({ version: 2, cards: [] }, { mode: 'print' as LayoutMode })).toEqual([
      {
        path: '',
        kind: 'structure',
        message: '"print" is not a mode: view, metadata, edit, create',
      },
    ]);
  });
});

describe('the verdicts', () => {
  it('publishes nothing with a finding, and loads all but a structural one', () => {
    const unknownWidget = findings(withFields({ field: 'a:b', widget: 'calendar' }));
    const structural = findings({ version: 2 });
    expect(publishable(findings(sound()))).toBe(true);
    expect(publishable(unknownWidget)).toBe(false);
    expect(loadable(unknownWidget)).toBe(true);
    expect(loadable(structural)).toBe(false);
  });
});
