import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadable,
  publishable,
  validateLayoutV2,
  validateTaskForm,
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

  it("finds the timeline's and the comments' examples among them", () => {
    expect(examples.filter((example) => 'timeline' in example)).toHaveLength(1);
    expect(examples.filter((example) => 'comments' in example)).toHaveLength(1);
  });

  it("finds the card from another system's example among them", () => {
    expect(examples.filter((example) => 'external' in example)).toHaveLength(1);
  });

  it("finds the checklist's example among them", () => {
    expect(examples.filter((example) => 'checklist' in example)).toHaveLength(1);
  });

  examples.forEach((example, index) => {
    it(`example ${index + 1} has no finding`, () => {
      const form = JSON.stringify(example).includes('"checks"');
      const card = ['fields', 'related', 'timeline', 'comments', 'external', 'checklist'].some(
        (key) => key in example,
      );
      const file =
        'version' in example
          ? example
          : card
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

  it('leaves no json block out: each is an example or a labelled proposal', () => {
    // A block fenced "```json proposed" with no label, or a mistyped one, matches neither pattern,
    // and no test would read it.
    const fences = [...proposal.matchAll(/```json[^\n]*\n/g)].length;
    const examples = [...proposal.matchAll(/```json\n/g)].length;
    expect(fences).toBe(examples + proposed.length);
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

describe('banners', () => {
  const page = (...banners: unknown[]) => ({
    version: 2,
    banners,
    cards: [{ id: 'c', fields: ['dc:title'] }],
  });
  const ending = {
    id: 'rights-ending',
    labelKey: 'acme.asset.rightsEnding',
    tone: 'warning',
    visibleWhen: { type: 'app.rules.dateWithin', parameters: [{ field: 'dc:expired' }, 30] },
  };

  it('take an id, a label or a key, a tone and a rule, the last two optional', () => {
    expect(messages(page(ending, { id: 'note', label: 'A note' }))).toEqual([]);
    expect(messages(page())).toEqual([]);
  });

  it('take the three tones only', () => {
    expect(
      messages(
        page(...['info', 'warning', 'negative'].map((tone) => ({ ...ending, id: tone, tone }))),
      ),
    ).toEqual([]);
    expect(messages(page({ ...ending, tone: 'positive' }))).toEqual([
      'banners[0].tone: tone is one of info, warning, negative [structure]',
    ]);
  });

  it('are refused outside view mode, as a timeline is', () => {
    expect(messages(page(ending), 'edit')).toEqual([
      'banners: banners belong in view mode only [structure]',
    ]);
  });

  it('are refused without words, with a key of their own, or as anything but a list of objects', () => {
    expect(messages(page({ id: 'quiet', tone: 'info' }))).toEqual([
      'banners[0]: needs a "label" or a "labelKey" [structure]',
    ]);
    expect(messages(page({ ...ending, message: 'Hello' }))).toEqual([
      'banners[0].message: "message" is not a key version 2 has [unknown]',
    ]);
    expect(messages({ ...page(), banners: { id: 'x' } })).toEqual([
      'banners: banners must be a list [structure]',
    ]);
    expect(messages(page('rights'))).toEqual(['banners[0]: a banner is an object [structure]']);
  });

  it("share the file's ids with its cards", () => {
    expect(messages(page({ id: 'c', label: 'Same as the card' }))).toEqual([
      'cards[0].id: the id "c" is already used at banners[0].id [structure]',
    ]);
  });

  it("name their rule as a card does, and an unregistered one is that banner's finding", () => {
    expect(messages(page({ ...ending, visibleWhen: 'acme.rules.licensed' }))).toEqual([
      'banners[0].visibleWhen: the rule "acme.rules.licensed" is not registered [unknown]',
    ]);
  });
});

describe('a review', () => {
  const reviewed = (review: unknown) => ({
    version: 2,
    review,
    cards: [{ id: 'c', fields: ['dc:title'] }],
  });

  it('is turned on by an empty object, beside cards or tabs', () => {
    expect(messages(reviewed({}))).toEqual([]);
    expect(
      messages({ version: 2, review: {}, tabs: [{ id: 't', cards: [{ id: 'c', fields: [] }] }] }),
    ).toEqual([]);
  });

  it('is refused outside view mode, and in a task form', () => {
    for (const mode of ['metadata', 'edit', 'create'] as const) {
      expect(messages(reviewed({}), mode)).toEqual([
        'review: a review belongs in view mode only [structure]',
      ]);
    }
    expect(validateTaskForm(reviewed({})).map((finding) => finding.message)).toEqual([
      'a review belongs in view mode only',
    ]);
  });

  it('is refused as anything but an object, and an option it does not have is unknown', () => {
    for (const shape of [true, 'pins', [], null]) {
      expect(messages(reviewed(shape))).toEqual([
        'review: review is an object: {} turns it on [structure]',
      ]);
    }
    // Unknown, not structure: the app, loading the file tolerantly, leaves the review out alone.
    expect(messages(reviewed({ rounds: 3 }))).toEqual([
      'review.rounds: "rounds" is not a key version 2 has [unknown]',
    ]);
  });
});

describe('share links', () => {
  const shared = (shareLinks: unknown) => ({
    version: 2,
    shareLinks,
    cards: [{ id: 'c', fields: ['dc:title'] }],
  });

  it('are turned on by an empty object, beside cards or tabs, and beside a review', () => {
    expect(messages(shared({}))).toEqual([]);
    expect(messages({ ...shared({}), review: {} })).toEqual([]);
    expect(
      messages({
        version: 2,
        shareLinks: {},
        tabs: [{ id: 't', cards: [{ id: 'c', fields: [] }] }],
      }),
    ).toEqual([]);
  });

  it('are refused outside view mode, and in a task form', () => {
    for (const mode of ['metadata', 'edit', 'create'] as const) {
      expect(messages(shared({}), mode)).toEqual([
        'shareLinks: share links belong in view mode only [structure]',
      ]);
    }
    expect(validateTaskForm(shared({})).map((finding) => finding.message)).toEqual([
      'share links belong in view mode only',
    ]);
  });

  it('are refused as anything but an object, and an option they do not have is unknown', () => {
    for (const shape of [true, 'links', [], null]) {
      expect(messages(shared(shape))).toEqual([
        'shareLinks: shareLinks is an object: {} turns them on [structure]',
      ]);
    }
    // Unknown, not structure: the app, loading the file tolerantly, leaves the links out alone.
    expect(messages(shared({ maxDays: 30 }))).toEqual([
      'shareLinks.maxDays: "maxDays" is not a key version 2 has [unknown]',
    ]);
  });
});

describe('the date rules', () => {
  const rule = (visibleWhen: unknown) =>
    messages({ version: 2, cards: [{ id: 'c', fields: [{ field: 'dc:title', visibleWhen }] }] });

  it('take a date, and dateWithin how many days ahead of today it looks', () => {
    expect(rule({ type: 'app.rules.datePassed', parameters: [{ field: 'dc:expired' }] })).toEqual(
      [],
    );
    expect(rule({ type: 'app.rules.datePassed', parameters: ['2026-12-01'] })).toEqual([]);
    for (const days of [0, 30, 36500])
      expect(
        rule({ type: 'app.rules.dateWithin', parameters: [{ field: 'dc:expired' }, days] }),
      ).toEqual([]);
  });

  it('refuse a whole number of days out of range, a text, a fraction or none', () => {
    const within = (...parameters: unknown[]) =>
      rule({ type: 'app.rules.dateWithin', parameters: [{ field: 'dc:expired' }, ...parameters] });
    const refused =
      'cards[0].fields[0].visibleWhen.parameters[1]: the rule "app.rules.dateWithin" takes a whole number of days from 0 to 36500 here [parameter]';
    for (const days of [-1, 36501, '30', 1.5, null]) expect(within(days)).toEqual([refused]);
    expect(within()).toEqual([
      'cards[0].fields[0].visibleWhen.parameters: the rule "app.rules.dateWithin" takes 2 parameters, not 1 [parameter]',
    ]);
  });

  it('refuse a literal that is not a date, as the rules would never pass on it', () => {
    const passed = (date: unknown) => rule({ type: 'app.rules.datePassed', parameters: [date] });
    for (const date of ['2026-12-01T09:30:00Z', '2026-12-01T09:30:00.000+05:30', '2028-02-29'])
      expect(passed(date)).toEqual([]);
    const refused =
      'cards[0].fields[0].visibleWhen.parameters[0]: the rule "app.rules.datePassed" takes a property or a date here, as "2026-12-01" or an ISO 8601 date and time with its zone [parameter]';
    for (const date of ['2026-13-01', '2027-02-29', '2026-12-01T09:30:00', '1 December', 30, true])
      expect(passed(date)).toEqual([refused]);
  });

  it("refuse a computation for the date, which the rules' library never evaluates", () => {
    const computed = { computed: { type: 'core.template', parameters: ['2026-12-01'] } };
    expect(rule({ type: 'app.rules.datePassed', parameters: [computed] })).toEqual([
      'cards[0].fields[0].visibleWhen.parameters[0]: the rule "app.rules.datePassed" takes a property or a date here, as "2026-12-01" or an ISO 8601 date and time with its zone [parameter]',
    ]);
  });
});

describe('a checklist', () => {
  const card = (checklist: unknown, more: Record<string, unknown> = {}) => ({
    version: 2,
    cards: [{ id: 'checklist', label: 'Checklist', checklist, ...more }],
  });
  const items = [
    { id: 'medicalRecords', labelKey: 'payers.appeal.medicalRecords' },
    { id: 'reviewer-assigned', label: 'Reviewer assigned' },
  ];
  const sound = (more: Record<string, unknown> = {}) =>
    card({ field: 'case:checklist', items, ...more });

  it("names the record's property and its items, each with a label or a key", () => {
    expect(messages(sound())).toEqual([]);
    // A rule on the card shows it for some records only, as any card's does.
    expect(
      messages(
        card(
          { field: 'case:checklist', items },
          {
            visibleWhen: {
              type: 'app.rules.fieldIn',
              parameters: [{ field: 'case:category' }, 'appeal'],
            },
          },
        ),
      ),
    ).toEqual([]);
  });

  it('is refused outside view mode, and beside any other content', () => {
    expect(messages(sound(), 'edit')).toEqual([
      'cards[0].checklist: a checklist belongs in view mode only [structure]',
    ]);
    expect(messages(sound(), 'metadata')).toEqual([
      'cards[0].checklist: a checklist belongs in view mode only [structure]',
    ]);
    expect(messages(card({ field: 'case:checklist', items }, { timeline: {} }))).toEqual([
      'cards[0]: a card has one of "fields", "related", "timeline", "comments", "external" or "checklist" [structure]',
    ]);
  });

  it('needs a property of the record, never an ecm: or var: name', () => {
    const refusal =
      "cards[0].checklist.field: needs the record's property that holds its items, <prefix>:<name>, never an ecm: or var: name [structure]";
    expect(messages(card({ items }))).toEqual([refusal]);
    expect(messages(card({ field: 'checklist', items }))).toEqual([refusal]);
    expect(messages(card({ field: 42, items }))).toEqual([refusal]);
    expect(messages(card({ field: 'ecm:uuid', items }))).toEqual([refusal]);
    expect(messages(card({ field: 'var:checklist', items }))).toEqual([refusal]);
  });

  it('needs at least one item, each an object with an id', () => {
    const none = 'cards[0].checklist.items: needs a list of at least one item [structure]';
    expect(messages(card({ field: 'case:checklist' }))).toEqual([none]);
    expect(messages(card({ field: 'case:checklist', items: [] }))).toEqual([none]);
    expect(messages(card({ field: 'case:checklist', items: { id: 'a' } }))).toEqual([none]);
    expect(messages(card({ field: 'case:checklist', items: ['medicalRecords'] }))).toEqual([
      'cards[0].checklist.items[0]: an item is { "id", "label" or "labelKey" } [structure]',
    ]);
    const badId = `an item's id is what the property's item holds for it: 1 to 64 letters, digits, ".", "_" or "-", starting with a letter or digit [structure]`;
    expect(messages(card({ field: 'case:checklist', items: [{ label: 'No id' }] }))).toEqual([
      `cards[0].checklist.items[0].id: ${badId}`,
    ]);
    expect(
      messages(card({ field: 'case:checklist', items: [{ id: 'has space', label: 'x' }] })),
    ).toEqual([`cards[0].checklist.items[0].id: ${badId}`]);
    expect(
      messages(card({ field: 'case:checklist', items: [{ id: 'x'.repeat(65), label: 'x' }] })),
    ).toEqual([`cards[0].checklist.items[0].id: ${badId}`]);
  });

  it('refuses an item listed twice, and one with no words for it', () => {
    expect(
      messages(
        card({
          field: 'case:checklist',
          items: [...items, { id: 'medicalRecords', label: 'Again' }],
        }),
      ),
    ).toEqual([
      'cards[0].checklist.items[2].id: the item "medicalRecords" is already listed at cards[0].checklist.items[0] [structure]',
    ]);
    expect(messages(card({ field: 'case:checklist', items: [{ id: 'quiet' }] }))).toEqual([
      'cards[0].checklist.items[0]: needs a "label" or a "labelKey" [structure]',
    ]);
    expect(
      messages(card({ field: 'case:checklist', items: [{ id: 'quiet', labelKey: 7 }] })),
    ).toEqual(['cards[0].checklist.items[0].labelKey: must be a text [structure]']);
  });

  it("keeps its items' ids apart from the file's: a card and an item may share one", () => {
    expect(
      messages(card({ field: 'case:checklist', items: [{ id: 'checklist', label: 'Same' }] })),
    ).toEqual([]);
  });

  it('names a key version 2 does not have as unknown, so the app leaves out only that card', () => {
    expect(findings(sound({ editable: true }))).toEqual([
      {
        path: 'cards[0].checklist.editable',
        kind: 'unknown',
        message: '"editable" is not a key version 2 has',
      },
    ]);
    expect(
      messages(card({ field: 'case:checklist', items: [{ id: 'a', label: 'A', doneWhen: 'x' }] })),
    ).toEqual([
      'cards[0].checklist.items[0].doneWhen: "doneWhen" is not a key version 2 has [unknown]',
    ]);
  });

  it('is refused when it is not an object', () => {
    expect(messages(card(['case:checklist']))).toEqual([
      'cards[0].checklist: checklist is an object [structure]',
    ]);
  });
});

describe('a timeline and comments', () => {
  const card = (content: Record<string, unknown>) => ({
    version: 2,
    cards: [{ id: 'c', label: 'History', ...content }],
  });

  it('take a card of their own, each with every key or none', () => {
    expect(messages(card({ timeline: {} }))).toEqual([]);
    expect(messages(card({ comments: {} }))).toEqual([]);
    expect(
      messages(
        card({
          timeline: {
            events: ['documentModified', 'lifecycle_transition_event'],
            filter: false,
            pageSize: 1,
          },
        }),
      ),
    ).toEqual([]);
    expect(messages(card({ comments: { pageSize: 100 } }))).toEqual([]);
  });

  it('are refused outside view mode, as related records are', () => {
    expect(messages(card({ timeline: {} }), 'edit')).toEqual([
      'cards[0].timeline: a timeline belongs in view mode only [structure]',
    ]);
    expect(messages(card({ comments: {} }), 'metadata')).toEqual([
      'cards[0].comments: comments belong in view mode only [structure]',
    ]);
  });

  it('are refused beside fields, related records or each other', () => {
    const twice =
      'cards[0]: a card has one of "fields", "related", "timeline", "comments", "external" or "checklist" [structure]';
    expect(messages(card({ timeline: {}, comments: {} }))).toEqual([twice]);
    expect(messages(card({ timeline: {}, fields: ['dc:title'] }))).toEqual([twice]);
    expect(
      messages(card({ comments: {}, related: { pageProvider: 'p', columns: ['dc:title'] } })),
    ).toEqual([twice]);
  });

  it('name a key version 2 does not have as unknown, so the app leaves out only that card', () => {
    expect(findings(card({ timeline: { groupBy: 'day' } }))).toEqual([
      {
        path: 'cards[0].timeline.groupBy',
        kind: 'unknown',
        message: '"groupBy" is not a key version 2 has',
      },
    ]);
    expect(messages(card({ comments: { readOnly: true } }))).toEqual([
      'cards[0].comments.readOnly: "readOnly" is not a key version 2 has [unknown]',
    ]);
  });
});

describe('a card from another system', () => {
  const card = (external: unknown, more: Record<string, unknown> = {}) => ({
    version: 2,
    cards: [{ id: 'payment', label: 'Payment', external, ...more }],
  });
  const payments = (fields: unknown[]) => card({ connector: 'payers.claimPayments', fields });
  /** The connectors a server registers, as the pipeline is given them with `--registered`. */
  const registered = withRegistered(PACKAGED_REGISTRIES, {
    connectors: { 'payers.claimPayments': ['paymentStatus', 'paidAmount', 'paidOn'] },
  });
  const against = (content: unknown): string[] =>
    validateLayoutV2(content, { mode: 'view', registries: registered }).map(
      (finding) => `${finding.path}: ${finding.message} [${finding.kind}]`,
    );

  it('names a connector and its fields, by name or with a label, a widget and a rule', () => {
    const file = payments([
      'paymentStatus',
      {
        name: 'paidAmount',
        labelKey: 'payers.claim.paid',
        widget: 'currency',
        parameters: { currency: 'USD' },
      },
      {
        name: 'paidOn',
        label: 'Paid on',
        widget: 'date',
        visibleWhen: { type: 'app.rules.inGroup', parameters: ['claims-supervisors'] },
      },
    ]);
    expect(messages(file)).toEqual([]);
    expect(against(file)).toEqual([]);
  });

  it('is refused outside view mode, and beside any other content', () => {
    expect(messages(payments(['paymentStatus']), 'edit')).toEqual([
      'cards[0].external: a card from another system belongs in view mode only [structure]',
    ]);
    expect(
      messages(
        card(
          { connector: 'payers.claimPayments', fields: ['paymentStatus'] },
          { fields: ['dc:title'] },
        ),
      ),
    ).toEqual([
      'cards[0]: a card has one of "fields", "related", "timeline", "comments", "external" or "checklist" [structure]',
    ]);
  });

  it('never holds an address: a text that looks like one anywhere in it refuses the file', () => {
    const refusal =
      "an address is never written in a layout: a connector's address is the server's configuration";
    expect(
      messages(
        card({ connector: 'https://core.example.invalid/claims', fields: ['paymentStatus'] }),
      ),
    ).toEqual([
      `cards[0].external.connector: ${refusal} [structure]`,
      'cards[0].external.connector: needs the id of a connector the server registers: 1 to 64 letters, digits, ".", "_" or "-", starting with a letter [structure]',
    ]);
    expect(
      messages(
        card({
          connector: 'payers.claimPayments',
          url: 'http://10.0.0.7:8080',
          fields: ['paymentStatus'],
        }),
      ),
    ).toEqual([
      `cards[0].external.url: ${refusal} [structure]`,
      'cards[0].external.url: "url" is not a key version 2 has [unknown]',
    ]);
    for (const label of [
      '//core.example.invalid',
      'See https://core.example.invalid',
      'javascript:alert(1)',
      'FILE:/etc',
      'ldap:core.internal',
      'Paid at core.internal:8443/claims',
      '\\\\core\\share',
    ]) {
      expect(messages(payments([{ name: 'paymentStatus', label }])), label).toEqual([
        `cards[0].external.fields[0].label: ${refusal} [structure]`,
      ]);
    }
    expect(
      messages(
        payments([
          {
            name: 'paymentStatus',
            widget: 'status-badge',
            parameters: { tones: { 'https://x': 'positive', Paid: 'positive' } },
          },
        ]),
      ),
    ).toEqual([`cards[0].external.fields[0].parameters.tones.https://x: ${refusal} [structure]`]);
    // A label with a colon and a space is not an address, nor is a property a parameter names.
    for (const label of [
      'Status: as paid',
      'Data: synced nightly',
      'File: on the claim',
      'Paid 10:30',
    ]) {
      expect(messages(payments([{ name: 'paymentStatus', label }])), label).toEqual([]);
    }
    expect(
      messages(
        payments([
          {
            name: 'paidAmount',
            widget: 'currency',
            parameters: { currency: { field: 'claim:currency' } },
            visibleWhen: {
              type: 'app.rules.fieldIn',
              parameters: [{ field: 'claim:status' }, 'approved'],
            },
          },
        ]),
      ),
    ).toEqual([]);
  });

  it('names its connector and fields as the server does, never as properties', () => {
    expect(messages(card({ fields: ['paymentStatus'] }))).toEqual([
      'cards[0].external.connector: needs the id of a connector the server registers: 1 to 64 letters, digits, ".", "_" or "-", starting with a letter [structure]',
    ]);
    expect(messages(card({ connector: 'payers.claimPayments' }))).toEqual([
      "cards[0].external.fields: needs a list of at least one of the connector's fields [structure]",
    ]);
    expect(messages(payments([]))).toEqual([
      "cards[0].external.fields: needs a list of at least one of the connector's fields [structure]",
    ]);
    const naming =
      'a field of another system is named as its connector names it: 1 to 64 letters, digits or "_", starting with a letter [structure]';
    expect(messages(payments(['claim:number', { name: 'paid-amount' }, { label: 'x' }]))).toEqual([
      `cards[0].external.fields[0]: ${naming}`,
      `cards[0].external.fields[1].name: ${naming}`,
      `cards[0].external.fields[2].name: ${naming}`,
    ]);
    expect(messages(payments([3]))).toEqual([
      'cards[0].external.fields[0]: a field of another system is its name, or { "name", ... } [structure]',
    ]);
  });

  it("holds each field to its connector's allow-list when the server's connectors are given", () => {
    expect(against(payments(['paymentStatus', 'bankAccount', { name: 'memberSsn' }]))).toEqual([
      'cards[0].external.fields[1]: the connector "payers.claimPayments" does not return the field "bankAccount" [unknown]',
      'cards[0].external.fields[2].name: the connector "payers.claimPayments" does not return the field "memberSsn" [unknown]',
    ]);
    expect(against(card({ connector: 'payers.policy', fields: ['paymentStatus'] }))).toEqual([
      'cards[0].external.connector: the connector "payers.policy" is not registered [unknown]',
    ]);
    // Without them, as in the app, the names are held to their form only.
    expect(messages(payments(['bankAccount']))).toEqual([]);
  });

  it('takes only the widgets that show one value as text, with their parameters', () => {
    for (const widget of [
      'rich-text',
      'phone',
      'email',
      'document-link',
      'user',
      'vocabulary',
      'table',
    ]) {
      expect(messages(payments([{ name: 'paymentStatus', widget }])), widget).toEqual([
        `cards[0].external.fields[0].widget: the widget "${widget}" does not show a value from another system: one of text, long-text, number, currency, percent, date, relative-date, boolean, status-badge does [parameter]`,
      ]);
    }
    expect(messages(payments([{ name: 'paidAmount', widget: 'currency' }]))).toEqual([
      'cards[0].external.fields[0].parameters: the widget "currency" needs "currency" [parameter]',
    ]);
    expect(messages(payments([{ name: 'paidAmount', widget: 'calendar' }]))).toEqual([
      'cards[0].external.fields[0].widget: the widget "calendar" is not registered [unknown]',
    ]);
    expect(messages(payments([{ name: 'paidAmount', id: 'x', field: 'claim:number' }]))).toEqual([
      'cards[0].external.fields[0].id: "id" is not a key version 2 has [unknown]',
      'cards[0].external.fields[0].field: "field" is not a key version 2 has [unknown]',
    ]);
    expect(messages(payments([{ name: 'paidOn', visibleWhen: 'acme.rules.unknown' }]))).toEqual([
      'cards[0].external.fields[0].visibleWhen: the rule "acme.rules.unknown" is not registered [unknown]',
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
    what: 'a card with neither fields, related records, a timeline, comments nor another system',
    file: { version: 2, cards: [{ id: 'c' }] },
    found:
      'cards[0]: a card has one of "fields", "related", "timeline", "comments", "external" or "checklist" [structure]',
  },
  {
    what: 'a timeline that is not an object',
    file: { version: 2, cards: [{ id: 't', timeline: true }] },
    found: 'cards[0].timeline: timeline is an object [structure]',
  },
  {
    what: "a timeline's events that are not a list",
    file: { version: 2, cards: [{ id: 't', timeline: { events: 'documentModified' } }] },
    found: 'cards[0].timeline.events: events is a list of at least one event [structure]',
  },
  {
    what: "a timeline's events that are an empty list, which would show nothing",
    file: { version: 2, cards: [{ id: 't', timeline: { events: [] } }] },
    found: 'cards[0].timeline.events: events is a list of at least one event [structure]',
  },
  {
    what: 'an event that is not named by its ID',
    file: { version: 2, cards: [{ id: 't', timeline: { events: ['Document modified'] } }] },
    found:
      'cards[0].timeline.events[0]: an event is named by its ID, as the audit writes it: "documentModified" [structure]',
  },
  {
    what: 'an event that is not a text',
    file: { version: 2, cards: [{ id: 't', timeline: { events: [{ id: 'documentModified' }] } }] },
    found:
      'cards[0].timeline.events[0]: an event is named by its ID, as the audit writes it: "documentModified" [structure]',
  },
  {
    what: "a timeline's filter that is not true or false",
    file: { version: 2, cards: [{ id: 't', timeline: { filter: 'yes' } }] },
    found: 'cards[0].timeline.filter: filter is true or false [structure]',
  },
  {
    what: "a timeline's page size over 100",
    file: { version: 2, cards: [{ id: 't', timeline: { pageSize: 101 } }] },
    found: 'cards[0].timeline.pageSize: pageSize is a whole number from 1 to 100 [structure]',
  },
  {
    what: 'comments that are not an object',
    file: { version: 2, cards: [{ id: 'c', comments: [] }] },
    found: 'cards[0].comments: comments is an object [structure]',
  },
  {
    what: "comments' page size that is not a whole number",
    file: { version: 2, cards: [{ id: 'c', comments: { pageSize: 2.5 } }] },
    found: 'cards[0].comments.pageSize: pageSize is a whole number from 1 to 100 [structure]',
  },
  {
    what: "comments' page size of 0",
    file: { version: 2, cards: [{ id: 'c', comments: { pageSize: 0 } }] },
    found: 'cards[0].comments.pageSize: pageSize is a whole number from 1 to 100 [structure]',
  },
  {
    what: 'a card from another system that is not an object',
    file: { version: 2, cards: [{ id: 'e', external: 'payers.claimPayments' }] },
    found: 'cards[0].external: external is an object [structure]',
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
