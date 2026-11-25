import { compute } from './compute';
import { TODAY, recordOf } from './record.testing';
import { TEMPLATE_MAX_LENGTH } from '@agentic-ui/shared/app-definition';
import { MAX_TEMPLATE_LENGTH } from './types';
import { inZone } from './zones.testing';

const ageOf = (birthDate: unknown, today = TODAY) =>
  compute(
    { type: 'core.age', parameters: [{ field: 'member:birthDate' }] },
    recordOf({ 'member:birthDate': birthDate }, { today }),
  );

describe('core.age', () => {
  it('counts whole years to today, on the birthday itself', () => {
    expect(ageOf('1990-11-23T00:00:00.000Z')).toEqual({ ok: true, value: 36 });
    expect(ageOf('1990-11-23')).toEqual({ ok: true, value: 36 });
  });

  it('counts as birthdays are, not as days divided by 365 or 365.25', () => {
    // 13 148 days: 36.02 years of 365 days, but the 36th birthday is tomorrow.
    expect(ageOf('1990-11-24T00:00:00.000Z')).toEqual({ ok: true, value: 35 });
    // 9 496 days: 25.998 years of 365.25 days, but the 26th birthday is today.
    expect(ageOf('2000-11-23T00:00:00.000Z')).toEqual({ ok: true, value: 26 });
    expect(ageOf('1990-12-01')).toEqual({ ok: true, value: 35 });
    expect(ageOf('1990-01-01')).toEqual({ ok: true, value: 36 });
  });

  it('turns someone born on 29 February a year older on 1 March in a common year', () => {
    expect(ageOf('2000-02-29', new Date(2001, 1, 28, 12))).toEqual({ ok: true, value: 0 });
    expect(ageOf('2000-02-29', new Date(2001, 2, 1, 12))).toEqual({ ok: true, value: 1 });
    expect(ageOf('2000-02-29', new Date(2004, 1, 29, 12))).toEqual({ ok: true, value: 4 });
  });

  it('reads a stored day, at midnight UTC, as its day in UTC', () => {
    // The evening of 23 November in America/New_York, where the birthday would seem to be today.
    expect(ageOf('1990-11-24T00:00:00.000Z')).toEqual({ ok: true, value: 35 });
    expect(ageOf('1990-11-24T00:00:00+00:00')).toEqual({ ok: true, value: 35 });
  });

  it('reads any other instant as its day in the reader’s zone', () => {
    // 01:30 on 24 November in Asia/Calcutta, 15:00 on the 23rd in America/New_York.
    expect(ageOf('1990-11-23T20:00:00.000Z')).toEqual({
      ok: true,
      value: inZone({ 'Asia/Calcutta': 35, 'America/New_York': 36 }),
    });
    // 1990-11-23T22:00:00.000Z: 03:30 on the 24th in Asia/Calcutta, 17:00 on the 23rd in New York.
    expect(ageOf('1990-11-24T00:00:00+02:00')).toEqual({
      ok: true,
      value: inZone({ 'Asia/Calcutta': 35, 'America/New_York': 36 }),
    });
  });

  it('reads a stamp just past midnight UTC on the reader’s day, not as a day after today', () => {
    // In America/New_York, 2026-11-24T01:00Z is 20:00 on the 23rd, and the stamp is 19:30 on it.
    const today = new Date('2026-11-24T01:00:00.000Z');
    expect(ageOf('2026-11-24T00:30:00.000Z', today)).toEqual({ ok: true, value: 0 });
  });

  it('reads a Date as its local day, as a date picker gives it at local midnight', () => {
    // In Asia/Calcutta, local midnight on 24 November is still the 23rd in UTC.
    expect(ageOf(new Date(1990, 10, 24))).toEqual({ ok: true, value: 35 });
    expect(ageOf(new Date(2026, 10, 24))).toEqual({
      ok: false,
      reason: 'the computation "core.age" takes a date that is not after today, not 2026-11-24',
    });
    // In America/New_York, 23:00 on 23 November is already the 24th in UTC.
    expect(ageOf(new Date(1990, 10, 23, 23, 0))).toEqual({ ok: true, value: 36 });
    // And 19:00 on the 23rd is exactly midnight UTC: written as an instant, it would be taken for
    // a stored 24 November.
    expect(ageOf(new Date(1990, 10, 23, 19, 0))).toEqual({ ok: true, value: 36 });
  });

  it('refuses a today that is not a valid Date, rather than answer NaN', () => {
    expect(ageOf('1990-11-23', new Date(Number.NaN))).toEqual({
      ok: false,
      reason:
        'the computation "core.age" reads today from its context, which gives an invalid Date, not a valid Date',
    });
    expect(ageOf('1990-11-23', '2026-11-23' as unknown as Date)).toEqual({
      ok: false,
      reason:
        'the computation "core.age" reads today from its context, which gives "2026-11-23", not a valid Date',
    });
  });

  it('reads today’s day in the reader’s zone', () => {
    // TODAY is the 23rd here and still the 22nd in UTC, when this birthday has not come.
    expect(ageOf('1990-11-23')).toEqual({ ok: true, value: 36 });
  });

  it('gives 0 on the day of birth', () => {
    expect(ageOf('2026-11-23')).toEqual({ ok: true, value: 0 });
  });

  it('gives null for a missing date', () => {
    expect(ageOf(undefined)).toEqual({ ok: true, value: null });
    expect(ageOf(null)).toEqual({ ok: true, value: null });
  });

  it('takes a literal date, or one a computation gives', () => {
    const context = recordOf({});
    expect(compute({ type: 'core.age', parameters: ['1990-11-23'] }, context)).toEqual({
      ok: true,
      value: 36,
    });
    const chosen = { type: 'core.choose', parameters: [true, '1990-11-24', '1990-11-23'] };
    expect(compute({ type: 'core.age', parameters: [{ computed: chosen }] }, context)).toEqual({
      ok: true,
      value: 35,
    });
  });

  it.each([
    ['a word', 'yesterday', '"yesterday"'],
    ['a number of milliseconds', 659_318_400_000, '659318400000'],
    ['a boolean', true, 'true'],
    ['a day that does not exist', '2023-02-29', '"2023-02-29"'],
    ['a time with no zone', '1990-11-23T10:00:00', '"1990-11-23T10:00:00"'],
  ])('refuses %s', (_what, birthDate, quoted) => {
    expect(ageOf(birthDate)).toEqual({
      ok: false,
      reason: `the computation "core.age" takes an ISO 8601 date, not ${quoted}`,
    });
  });

  it('refuses a date after today: an age before birth is not an age', () => {
    expect(ageOf('2030-01-01')).toEqual({
      ok: false,
      reason: 'the computation "core.age" takes a date that is not after today, not 2030-01-01',
    });
    expect(ageOf('2026-11-24T00:00:00.000Z')).toEqual({
      ok: false,
      reason: 'the computation "core.age" takes a date that is not after today, not 2026-11-24',
    });
  });

  it('refuses any number of parameters but one', () => {
    const context = recordOf({});
    expect(compute({ type: 'core.age', parameters: [] }, context)).toEqual({
      ok: false,
      reason: 'the computation "core.age" takes 1 parameter, not 0',
    });
    expect(compute({ type: 'core.age', parameters: ['1990-11-23', 'today'] }, context)).toEqual({
      ok: false,
      reason: 'the computation "core.age" takes 1 parameter, not 2',
    });
  });
});

describe('core.template', () => {
  const member = {
    'member:firstName': 'ada',
    'member:lastName': 'lovelace',
    'member:status': 'active',
  };
  const display = {
    'member:firstName': 'Ada',
    'member:lastName': 'Lovelace',
    'member:status': 'Active member',
  };
  const fill = (
    text: unknown,
    values: Readonly<Record<string, unknown>> = member,
    shown: Readonly<Record<string, string>> = display,
  ) => compute({ type: 'core.template', parameters: [text] }, recordOf(values, { display: shown }));

  it('replaces each placeholder with the property’s display value', () => {
    expect(fill('{member:firstName} {member:lastName}')).toEqual({
      ok: true,
      value: 'Ada Lovelace',
    });
    expect(fill('{member:lastName}, {member:firstName} ({member:status})')).toEqual({
      ok: true,
      value: 'Lovelace, Ada (Active member)',
    });
  });

  it('gives empty text for a missing property, whatever the display would say', () => {
    const shown = { ...display, 'member:firstName': '—', 'member:middleName': '—' };
    expect(
      fill('{member:firstName} {member:lastName}', { ...member, 'member:firstName': null }, shown),
    ).toEqual({
      ok: true,
      value: ' Lovelace',
    });
    expect(fill('{member:middleName}|{member:lastName}', member, shown)).toEqual({
      ok: true,
      value: '|Lovelace',
    });
  });

  it('leaves text in braces that is not a placeholder as written', () => {
    expect(fill('{note} {member:firstName} { member:firstName } {} {member:} {:x}')).toEqual({
      ok: true,
      value: '{note} Ada { member:firstName } {} {member:} {:x}',
    });
    expect(fill('{{member:firstName}}')).toEqual({ ok: true, value: '{Ada}' });
  });

  it('gives text, never HTML: markup in a value is passed on as the characters it is', () => {
    const shown = { ...display, 'member:firstName': '<b onmouseover="x()">Ada</b> &amp;' };
    expect(fill('<i>{member:firstName}</i>', member, shown)).toEqual({
      ok: true,
      value: '<i><b onmouseover="x()">Ada</b> &amp;</i>',
    });
  });

  it('inserts a value as it is, so "$&" in it is not a replacement pattern', () => {
    const shown = { ...display, 'member:firstName': "$& $1 $$ $'" };
    expect(fill('{member:firstName}', member, shown)).toEqual({ ok: true, value: "$& $1 $$ $'" });
  });

  it('replaces a task variable’s placeholder too', () => {
    expect(fill('Note: {var:comment}', { 'var:comment': 'ok' }, {})).toEqual({
      ok: true,
      value: 'Note: ok',
    });
  });

  it('reads only the properties its placeholders name', () => {
    const context = recordOf(member, { display });
    compute({ type: 'core.template', parameters: ['{member:lastName} and {x}'] }, context);
    expect(context.reads).toEqual(['member:lastName']);
    expect(context.displayed).toEqual(['member:lastName']);
  });

  it(`takes a text of up to ${MAX_TEMPLATE_LENGTH} characters, and refuses a longer one`, () => {
    expect(MAX_TEMPLATE_LENGTH).toBe(1000);
    // The validator refuses a longer one when the file is written, with the same limit.
    expect(TEMPLATE_MAX_LENGTH).toBe(MAX_TEMPLATE_LENGTH);
    expect(fill('x'.repeat(1000))).toEqual({ ok: true, value: 'x'.repeat(1000) });
    expect(fill('x'.repeat(1001))).toEqual({
      ok: false,
      reason: 'the computation "core.template" takes a text of at most 1000 characters, not 1001',
    });
  });

  it.each([
    ['a property', { field: 'member:firstName' }, '{"field":"member:firstName"}'],
    ['a computation', { computed: { type: 'core.count' } }, '{"computed":{"type":"core.count"}}'],
    ['a number', 3, '3'],
  ])('refuses %s, which is not a text with placeholders', (_what, text, quoted) => {
    expect(fill(text)).toEqual({
      ok: false,
      reason: `the computation "core.template" takes a text with {<prefix>:<name>} placeholders, not ${quoted}`,
    });
  });

  it('refuses any number of parameters but one', () => {
    expect(compute({ type: 'core.template', parameters: ['a', 'b'] }, recordOf({}))).toEqual({
      ok: false,
      reason: 'the computation "core.template" takes 1 parameter, not 2',
    });
  });
});

describe('core.sum', () => {
  const sum = (list: unknown, ...subfield: unknown[]) =>
    compute(
      { type: 'core.sum', parameters: [{ field: 'claim:lines' }, ...subfield] },
      recordOf({ 'claim:lines': list }),
    );

  it('adds a list’s numbers', () => {
    expect(sum([1, 2, 3.5])).toEqual({ ok: true, value: 6.5 });
    expect(sum([-4, 4])).toEqual({ ok: true, value: 0 });
  });

  it('adds one subfield’s numbers in a list of complex values', () => {
    expect(
      sum(
        [
          { amount: 10, code: 'a' },
          { amount: 2.5, code: 'b' },
        ],
        'amount',
      ),
    ).toEqual({
      ok: true,
      value: 12.5,
    });
  });

  it('gives 0 for an empty list, and null for a missing one', () => {
    expect(sum([])).toEqual({ ok: true, value: 0 });
    expect(sum(undefined)).toEqual({ ok: true, value: null });
    expect(sum(null)).toEqual({ ok: true, value: null });
  });

  it('skips a blank, as a spreadsheet’s sum skips an empty cell', () => {
    expect(sum([1, null, 2])).toEqual({ ok: true, value: 3 });
    expect(sum([{ amount: null }, { amount: 4 }], 'amount')).toEqual({ ok: true, value: 4 });
    expect(sum([null])).toEqual({ ok: true, value: 0 });
  });

  it.each([
    ['a numeric text', [1, '2'], 'item 1 is "2"'],
    ['a boolean', [true], 'item 0 is true'],
    ['NaN', [1, Number.NaN], 'item 1 is NaN'],
    ['a complex value, with no subfield named', [{ amount: 1 }], 'item 0 is {"amount":1}'],
    ['a list', [[1, 2]], 'item 0 is [1,2]'],
  ])('refuses %s, rather than leave it out of the total', (_what, list, where) => {
    expect(sum(list)).toEqual({
      ok: false,
      reason: `the computation "core.sum" adds numbers, and ${where}`,
    });
  });

  it('refuses a subfield that is not a number', () => {
    expect(sum([{ amount: 1 }, { amount: '10' }], 'amount')).toEqual({
      ok: false,
      reason: 'the computation "core.sum" adds numbers, and "amount" in item 1 is "10"',
    });
  });

  it('refuses an item that is not a complex value when it reads a subfield', () => {
    expect(sum([{ amount: 1 }, 2], 'amount')).toEqual({
      ok: false,
      reason:
        'the computation "core.sum" reads "amount" in each item, and item 1 is 2, not a complex value',
    });
  });

  it('refuses an item with no such subfield: a misspelt subfield is not a total of 0', () => {
    expect(sum([{ amout: 1 }], 'amount')).toEqual({
      ok: false,
      reason: 'the computation "core.sum" reads "amount" in each item, and item 0 has no "amount"',
    });
    expect(sum([{}], 'constructor')).toEqual({
      ok: false,
      reason:
        'the computation "core.sum" reads "constructor" in each item, and item 0 has no "constructor"',
    });
  });

  it('quotes at most 60 characters of a subfield it names', () => {
    const subfield = 's'.repeat(300);
    const quoted = `"${'s'.repeat(59)}…`;
    expect(sum([{}], subfield)).toEqual({
      ok: false,
      reason: `the computation "core.sum" reads ${quoted} in each item, and item 0 has no ${quoted}`,
    });
    expect(sum([1], subfield)).toEqual({
      ok: false,
      reason: `the computation "core.sum" reads ${quoted} in each item, and item 0 is 1, not a complex value`,
    });
    expect(sum([{ [subfield]: 'x' }], subfield)).toEqual({
      ok: false,
      reason: `the computation "core.sum" adds numbers, and ${quoted} in item 0 is "x"`,
    });
  });

  it.each([
    ['a text', 'abc', '"abc"'],
    ['a number', 5, '5'],
    ['a complex value', { amount: 1 }, '{"amount":1}'],
  ])('refuses %s, which is not a list', (_what, list, quoted) => {
    expect(sum(list)).toEqual({
      ok: false,
      reason: `the computation "core.sum" takes a list, not ${quoted}`,
    });
  });

  it('refuses a literal, which is never a list', () => {
    expect(compute({ type: 'core.sum', parameters: [5] }, recordOf({}))).toEqual({
      ok: false,
      reason: 'the computation "core.sum" takes a list, not 5',
    });
  });

  it.each([
    ['an empty text', '', '""'],
    ['a number', 3, '3'],
    ['a property', { field: 'claim:amount' }, '{"field":"claim:amount"}'],
  ])('refuses %s for a subfield’s name', (_what, subfield, quoted) => {
    expect(sum([{ amount: 1 }], subfield)).toEqual({
      ok: false,
      reason: `the computation "core.sum" takes the name of a subfield as its second parameter, not ${quoted}`,
    });
  });

  it('refuses a total too large to be a number, rather than show Infinity', () => {
    expect(sum([Number.MAX_VALUE, Number.MAX_VALUE])).toEqual({
      ok: false,
      reason: 'the computation "core.sum" gives a total too large to be a number',
    });
  });

  it('refuses any number of parameters but one or two', () => {
    expect(compute({ type: 'core.sum', parameters: [] }, recordOf({}))).toEqual({
      ok: false,
      reason: 'the computation "core.sum" takes 1 to 2 parameters, not 0',
    });
    expect(sum([], 'amount', 'extra')).toEqual({
      ok: false,
      reason: 'the computation "core.sum" takes 1 to 2 parameters, not 3',
    });
  });
});

describe('core.count', () => {
  const count = (list: unknown) =>
    compute(
      { type: 'core.count', parameters: [{ field: 'claim:lines' }] },
      recordOf({ 'claim:lines': list }),
    );

  it('counts a list’s items, blanks included', () => {
    expect(count([1, 2, 3])).toEqual({ ok: true, value: 3 });
    expect(count([{ amount: 1 }, { amount: null }])).toEqual({ ok: true, value: 2 });
    expect(count([null])).toEqual({ ok: true, value: 1 });
    expect(count([])).toEqual({ ok: true, value: 0 });
  });

  it('gives null for a missing list: a property not loaded is not a list of none', () => {
    expect(count(undefined)).toEqual({ ok: true, value: null });
    expect(count(null)).toEqual({ ok: true, value: null });
  });

  it.each([
    ['a text, whatever its length', 'abc', '"abc"'],
    ['a number', 3, '3'],
    ['a complex value', { length: 2 }, '{"length":2}'],
  ])('refuses %s, which is not a list', (_what, list, quoted) => {
    expect(count(list)).toEqual({
      ok: false,
      reason: `the computation "core.count" takes a list, not ${quoted}`,
    });
  });

  it('refuses a literal or a computation, which is never a list', () => {
    const context = recordOf({ 'claim:lines': [1] });
    expect(compute({ type: 'core.count', parameters: ['abc'] }, context)).toEqual({
      ok: false,
      reason: 'the computation "core.count" takes a list, not "abc"',
    });
    const inner = { type: 'core.count', parameters: [{ field: 'claim:lines' }] };
    expect(compute({ type: 'core.count', parameters: [{ computed: inner }] }, context)).toEqual({
      ok: false,
      reason: 'the computation "core.count" takes a list, not 1',
    });
  });

  it('refuses any number of parameters but one', () => {
    expect(compute({ type: 'core.count', parameters: [] }, recordOf({}))).toEqual({
      ok: false,
      reason: 'the computation "core.count" takes 1 parameter, not 0',
    });
  });
});

describe('core.dateDiff', () => {
  const diff = (first: unknown, second: unknown, unit: unknown, values = {}) =>
    compute({ type: 'core.dateDiff', parameters: [first, second, unit] }, recordOf(values));

  it('gives the second date minus the first, in whole days, months or years', () => {
    expect(diff('2026-03-01', '2026-03-31', 'days')).toEqual({ ok: true, value: 30 });
    expect(diff('2026-01-31', '2026-03-01', 'months')).toEqual({ ok: true, value: 1 });
    expect(diff('2026-01-31', '2026-02-28', 'months')).toEqual({ ok: true, value: 0 });
    expect(diff('2000-02-29', '2001-02-28', 'years')).toEqual({ ok: true, value: 0 });
    expect(diff('2000-02-29', '2001-03-01', 'years')).toEqual({ ok: true, value: 1 });
  });

  it('is negative when the second date is earlier', () => {
    expect(diff('2026-03-31', '2026-03-01', 'days')).toEqual({ ok: true, value: -30 });
    expect(diff('2026-03-01', '2026-01-31', 'months')).toEqual({ ok: true, value: -1 });
    const nothing = diff('2026-05-15', '2026-05-10', 'months');
    expect(nothing.ok && Object.is(nothing.value, 0)).toBe(true);
  });

  it('counts years as core.age does', () => {
    const born = { 'member:birthDate': '1990-11-24T00:00:00.000Z' };
    expect(diff({ field: 'member:birthDate' }, 'today', 'years', born)).toEqual({
      ok: true,
      value: 35,
    });
  });

  it('reads "today", as written, as the reader’s today', () => {
    // 23 November here; it would be 21 days if today were read in UTC, where it is the 22nd.
    expect(diff('2026-11-01', 'today', 'days')).toEqual({ ok: true, value: 22 });
    expect(diff('2026-12-25', 'today', 'days')).toEqual({ ok: true, value: -32 });
  });

  it('reads stored days in UTC', () => {
    // In America/New_York both are the evening before; read there, the difference would not move,
    // but each would be a day out against "today" and against an instant.
    expect(diff('2026-11-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z', 'days')).toEqual({
      ok: true,
      value: 1,
    });
    expect(diff('2026-11-01T00:00:00.000Z', 'today', 'days')).toEqual({ ok: true, value: 22 });
  });

  it('reads other instants as their days in the reader’s zone', () => {
    // 2 November in Asia/Calcutta, both 1 November in America/New_York: the same day either way,
    // where their days in UTC are a day apart.
    expect(diff('2026-11-01T20:00:00.000Z', '2026-11-02T03:00:00.000Z', 'days')).toEqual({
      ok: true,
      value: 0,
    });
  });

  it('reads a stamp just past midnight UTC on the reader’s day, the day today is', () => {
    // In America/New_York, 2026-11-24T01:00Z is 20:00 on the 23rd, and the stamp 19:30 on it.
    const created = { 'dc:created': '2026-11-24T00:30:00.000Z' };
    expect(
      compute(
        { type: 'core.dateDiff', parameters: [{ field: 'dc:created' }, 'today', 'days'] },
        recordOf(created, { today: new Date('2026-11-24T01:00:00.000Z') }),
      ),
    ).toEqual({ ok: true, value: 0 });
  });

  it('reads a Date as its local day, as a literal of that day is read', () => {
    // In Asia/Calcutta, local midnight on 1 November is still 31 October in UTC.
    const picked = { 'claim:start': new Date(2026, 10, 1) };
    expect(diff({ field: 'claim:start' }, 'today', 'days', picked)).toEqual({
      ok: true,
      value: 22,
    });
    expect(diff('2026-11-01', 'today', 'days')).toEqual({ ok: true, value: 22 });
  });

  it('refuses a today that is not a valid Date, and needs none without "today"', () => {
    const broken = recordOf({}, { today: new Date(Number.NaN) });
    expect(
      compute({ type: 'core.dateDiff', parameters: ['2026-11-01', 'today', 'days'] }, broken),
    ).toEqual({
      ok: false,
      reason:
        'the computation "core.dateDiff" reads today from its context, which gives an invalid Date, not a valid Date',
    });
    expect(
      compute({ type: 'core.dateDiff', parameters: ['2026-11-01', '2026-11-02', 'days'] }, broken),
    ).toEqual({ ok: true, value: 1 });
  });

  it('gives null when either date is missing', () => {
    const values = { 'claim:start': '2026-01-01', 'claim:end': null };
    expect(diff({ field: 'claim:start' }, { field: 'claim:end' }, 'days', values)).toEqual({
      ok: true,
      value: null,
    });
    expect(diff({ field: 'claim:none' }, 'today', 'days', values)).toEqual({
      ok: true,
      value: null,
    });
  });

  it('refuses "today" as the first date, and a value that is the text "today"', () => {
    expect(diff('today', '2026-01-01', 'days')).toEqual({
      ok: false,
      reason: 'the computation "core.dateDiff" takes an ISO 8601 date, not "today"',
    });
    expect(diff('2026-01-01', { field: 'claim:end' }, 'days', { 'claim:end': 'today' })).toEqual({
      ok: false,
      reason: 'the computation "core.dateDiff" takes an ISO 8601 date, not "today"',
    });
  });

  it('refuses a date that is not one, even when the other is missing', () => {
    expect(diff({ field: 'claim:none' }, '2026-02-30', 'days')).toEqual({
      ok: false,
      reason: 'the computation "core.dateDiff" takes an ISO 8601 date, not "2026-02-30"',
    });
  });

  it.each([
    ['weeks', '"weeks"'],
    ['Days', '"Days"'],
    [{ field: 'claim:unit' }, '{"field":"claim:unit"}'],
  ])('refuses the unit %j', (unit, quoted) => {
    expect(diff('2026-01-01', '2026-02-01', unit, { 'claim:unit': 'days' })).toEqual({
      ok: false,
      reason: `the computation "core.dateDiff" counts in "days", "months" or "years", not ${quoted}`,
    });
  });

  it('refuses any number of parameters but three', () => {
    expect(
      compute({ type: 'core.dateDiff', parameters: ['2026-01-01', 'today'] }, recordOf({})),
    ).toEqual({ ok: false, reason: 'the computation "core.dateDiff" takes 3 parameters, not 2' });
  });
});

describe('core.choose', () => {
  const inGroup = { type: 'app.rules.inGroup', parameters: ['member-services'] };
  const choose = (passes: boolean, chosen: unknown = 'first', otherwise: unknown = 'second') => {
    const context = recordOf(
      { 'member:ssn': '123', 'dc:title': 'A title' },
      { rule: () => passes },
    );
    return {
      context,
      result: compute({ type: 'core.choose', parameters: [inGroup, chosen, otherwise] }, context),
    };
  };

  it('gives the first value while the rule passes, the second otherwise', () => {
    expect(choose(true).result).toEqual({ ok: true, value: 'first' });
    expect(choose(false).result).toEqual({ ok: true, value: 'second' });
  });

  it('hands the rule to the context as the layout writes it', () => {
    const { context } = choose(true);
    expect(context.rules).toEqual([inGroup]);
  });

  it('evaluates only the chosen value', () => {
    const broken = { computed: { type: 'core.median' } };
    const { context, result } = choose(true, { field: 'dc:title' }, broken);
    expect(result).toEqual({ ok: true, value: 'A title' });
    expect(choose(false, broken, { field: 'dc:title' }).result).toEqual({
      ok: true,
      value: 'A title',
    });
    const other = choose(false, { field: 'member:ssn' }, 'hidden');
    expect(other.result).toEqual({ ok: true, value: 'hidden' });
    expect(other.context.reads).toEqual([]);
    expect(context.reads).toEqual(['dc:title']);
  });

  it('passes on the chosen value’s refusal', () => {
    expect(choose(true, { computed: { type: 'core.median' } }).result).toEqual({
      ok: false,
      reason: 'the computation "core.median" is not registered',
    });
  });

  it('refuses any number of parameters but three', () => {
    expect(compute({ type: 'core.choose', parameters: [inGroup, 'a'] }, recordOf({}))).toEqual({
      ok: false,
      reason: 'the computation "core.choose" takes 3 parameters, not 2',
    });
  });
});
