import type { NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';

import { TODAY, daysBetween, daysFromToday } from './date-rules';
import { DOCUMENT_RULE_EVALUATORS } from './document-rules';
import { EMPTY_EXTENSION_RULE_CONTEXT, type ExtensionRuleContext } from './extension-rules';

/**
 * Layout version 2's date rules (docs/business-apps/layout-v2.md, section 5), and the reading of a
 * date they share with the computations (AGENTS/08-bug-patterns.md, pattern 29).
 *
 * The zone is given to `daysFromToday` rather than taken from the process, so these cases prove
 * the same thing on every machine: in UTC, where CI runs, a stored day and an instant read in the
 * wrong zone fall on the right day, and a test of the process's own zone would prove nothing.
 */

const EAST = 'Asia/Calcutta'; // +05:30
const WEST = 'America/New_York'; // -05:00 in November

describe('daysFromToday', () => {
  // 17:30 on the 24th in the east, 07:00 on the 24th in the west.
  const noon = new Date('2026-11-24T12:00:00Z');

  it('reads a stored day as written, in every zone', () => {
    for (const zone of [EAST, WEST, 'UTC']) {
      expect(daysFromToday('2026-11-24', noon, zone)).toBe(0);
      expect(daysFromToday('2026-11-25T00:00:00.000Z', noon, zone)).toBe(1);
      expect(daysFromToday('2026-11-23T00:00:00Z', noon, zone)).toBe(-1);
      expect(daysFromToday('2026-12-24T00:00:00+00:00', noon, zone)).toBe(30);
    }
  });

  it("reads a stored day in UTC where the reader's own day is another", () => {
    // 22:00 on the 24th in the west, already the 25th in UTC: the stored 25th is tomorrow there.
    const evening = new Date('2026-11-25T03:00:00Z');
    expect(daysFromToday('2026-11-25T00:00:00.000Z', evening, WEST)).toBe(1);
    expect(daysFromToday('2026-11-25T00:00:00.000Z', evening, EAST)).toBe(0);
  });

  it("reads an instant on the reader's own day", () => {
    // 01:30 on the 25th in the east, 15:00 on the 24th in the west.
    expect(daysFromToday('2026-11-24T20:00:00Z', noon, EAST)).toBe(1);
    expect(daysFromToday('2026-11-24T20:00:00Z', noon, WEST)).toBe(0);
    // Midnight in a zone other than UTC is an instant, not a stored day.
    expect(daysFromToday('2026-11-25T00:00:00+05:30', noon, WEST)).toBe(0);
  });

  it("counts today from the reader's own midnight", () => {
    // 23:00 on the 24th in the east, 13:30 on the 24th in the west; a minute later, the 25th east.
    expect(daysFromToday('2026-11-25', new Date('2026-11-24T18:29:00Z'), EAST)).toBe(1);
    expect(daysFromToday('2026-11-25', new Date('2026-11-24T18:31:00Z'), EAST)).toBe(0);
    expect(daysFromToday('2026-11-25', new Date('2026-11-24T18:31:00Z'), WEST)).toBe(1);
  });

  it('counts across months, years and a leap day', () => {
    expect(daysFromToday('2028-03-01', new Date('2028-02-28T12:00:00Z'), 'UTC')).toBe(2);
    expect(daysFromToday('2027-01-01', noon, 'UTC')).toBe(38);
  });

  it('finds no date in anything else', () => {
    for (const value of [
      '2026-11-24T12:00:00', // no zone: a different instant in every zone
      '2023-02-29',
      '2026-13-01',
      '2026-11-24T24:00:00Z',
      '24/11/2026',
      '',
      1764000000000,
      null,
      undefined,
      { field: 'dc:expired' },
    ])
      expect(daysFromToday(value, noon, 'UTC')).toBeNull();
    expect(daysFromToday('2026-11-24', new Date(Number.NaN), 'UTC')).toBeNull();
  });
});

describe('daysBetween', () => {
  const noon = new Date('2026-11-24T12:00:00Z');

  it('counts the days from one date to another, each read as daysFromToday reads it', () => {
    for (const zone of [EAST, WEST, 'UTC']) {
      expect(daysBetween('2026-12-24', '2026-11-24', noon, zone)).toBe(30);
      expect(daysBetween('2026-11-24T00:00:00.000Z', '2026-12-24', noon, zone)).toBe(-30);
      expect(daysBetween('2026-11-24', '2026-11-24T00:00:00Z', noon, zone)).toBe(0);
    }
    // Across a leap day, and a year.
    expect(daysBetween('2028-03-01', '2028-02-28', noon, 'UTC')).toBe(2);
    expect(daysBetween('2027-01-01', '2026-01-01', noon, 'UTC')).toBe(365);
  });

  it("reads an instant on the reader's own day, and counts days, not hours", () => {
    // 20:00 UTC on the 24th is the 25th in the east and the 24th in the west.
    expect(daysBetween('2026-11-24T20:00:00Z', '2026-11-24', noon, EAST)).toBe(1);
    expect(daysBetween('2026-11-24T20:00:00Z', '2026-11-24', noon, WEST)).toBe(0);
    // An hour apart across the reader's midnight is a day; twenty hours within it is none.
    expect(daysBetween('2026-11-25T05:30:00Z', '2026-11-25T04:30:00Z', noon, WEST)).toBe(1);
    expect(daysBetween('2026-11-24T23:00:00Z', '2026-11-24T03:00:00Z', noon, 'UTC')).toBe(0);
  });

  it("reads TODAY as the reader's day, on either side", () => {
    expect(daysBetween(TODAY, '2026-10-25', noon, 'UTC')).toBe(30);
    expect(daysBetween('2026-12-24', TODAY, noon, 'UTC')).toBe(30);
    expect(daysBetween(TODAY, TODAY, noon, 'UTC')).toBe(0);
    // 20:00 UTC on the 24th is already the 25th in the east.
    const late = new Date('2026-11-24T20:00:00Z');
    expect(daysBetween(TODAY, '2026-11-24', late, EAST)).toBe(1);
    expect(daysBetween(TODAY, '2026-11-24', late, WEST)).toBe(0);
  });

  it('finds no count where either is not a date, the text "today" among them', () => {
    for (const value of [
      'today',
      '2023-02-29',
      '2026-11-24T12:00:00',
      '',
      null,
      5,
      { field: 'x' },
    ]) {
      expect(daysBetween(value, '2026-11-24', noon, 'UTC')).toBeNull();
      expect(daysBetween('2026-11-24', value, noon, 'UTC')).toBeNull();
    }
    expect(daysBetween(TODAY, '2026-11-24', new Date(Number.NaN), 'UTC')).toBeNull();
    expect(daysBetween('2026-11-25', '2026-11-24', noon, 'Not/AZone')).toBeNull();
  });
});

function asset(expired: unknown): NuxeoDocument {
  return {
    uid: 'a1',
    title: 'Trail jacket, front',
    type: 'Picture',
    path: '/a1',
    lastModified: '2026-11-24T00:00:00.000Z',
    properties: { 'dc:expired': expired },
  };
}

const on = (document: NuxeoDocument | null): ExtensionRuleContext => ({
  ...EMPTY_EXTENSION_RULE_CONTEXT,
  document,
});

const evaluate = (id: string, context: ExtensionRuleContext, ...parameters: unknown[]): boolean =>
  DOCUMENT_RULE_EVALUATORS[id](context, parameters, () => false);

const expired = { field: 'dc:expired' };

/**
 * The day `offset` days from the reader's today, as Nuxeo stores a day: its midnight UTC, or as
 * `2026-11-24` with `bare`. Derived from the reader's own day on purpose: these cases are about each
 * rule's window, and hold in any zone, from UTC-12 to UTC+14. How a stored day and an instant are read
 * in a zone is `daysFromToday`'s cases above, with literals in zones chosen either side of UTC.
 */
function storedDay(offset: number, bare = false): string {
  const now = new Date();
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, '0');
  const written = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
  return bare ? written : `${written}T00:00:00.000Z`;
}

describe('the date rules, read against the clock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-24T12:00:00Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('datePassed: the day is before today, and today has not passed', () => {
    const passed = (value: string) => evaluate('app.rules.datePassed', on(asset(value)), expired);
    expect(passed(storedDay(-1))).toBe(true);
    expect(passed(storedDay(0))).toBe(false);
    expect(passed(storedDay(7, true))).toBe(false);
  });

  it('dateWithin: from today to the given days ahead, both included, and not once it has passed', () => {
    const within = (value: unknown, days: unknown) =>
      evaluate('app.rules.dateWithin', on(asset(value)), expired, days);
    expect(within(storedDay(0), 30)).toBe(true);
    expect(within(storedDay(30), 30)).toBe(true);
    expect(within(storedDay(31), 30)).toBe(false);
    expect(within(storedDay(-1), 30)).toBe(false);
    expect(within(storedDay(0, true), 0)).toBe(true);
    expect(within(storedDay(1, true), 0)).toBe(false);
  });

  it('dateWithin: does not pass on days the validator refuses', () => {
    const within = (days: unknown) =>
      evaluate('app.rules.dateWithin', on(asset(storedDay(0, true))), expired, days);
    for (const days of [-1, 36501, 1.5, '30', null, undefined]) expect(within(days)).toBe(false);
    expect(within(36500)).toBe(true);
  });

  it('do not pass with no date, no record, or a computation they do not evaluate', () => {
    for (const id of ['app.rules.datePassed', 'app.rules.dateWithin']) {
      expect(evaluate(id, on(asset(null)), expired, 30)).toBe(false);
      expect(evaluate(id, on(asset('not a date')), expired, 30)).toBe(false);
      expect(evaluate(id, on(null), expired, 30)).toBe(false);
      const computed = { computed: { type: 'core.template', parameters: [storedDay(-1, true)] } };
      expect(evaluate(id, on(asset(storedDay(-1, true))), computed, 30)).toBe(false);
    }
  });

  it('read a literal date as it is, with nothing in focus', () => {
    expect(evaluate('app.rules.datePassed', on(null), storedDay(-20, true))).toBe(true);
    expect(evaluate('app.rules.dateWithin', on(null), storedDay(6, true), 7)).toBe(true);
    expect(evaluate('app.rules.dateAfter', on(null), 'today', storedDay(-8, true), 7)).toBe(true);
  });
});

describe('app.rules.dateAfter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-24T12:00:00Z'));
  });

  afterEach(() => vi.useRealTimers());

  /** A damage claim, filed and delivered on these days. */
  const claim = (filedOn: unknown, deliveredOn: unknown): NuxeoDocument => ({
    uid: 'c1',
    title: 'Piano lid scratched',
    type: 'DamageClaim',
    path: '/c1',
    lastModified: '2026-11-24T00:00:00.000Z',
    properties: { 'dmg:filedOn': filedOn, 'dmg:deliveredOn': deliveredOn },
  });
  const filedOn = { field: 'dmg:filedOn' };
  const deliveredOn = { field: 'dmg:deliveredOn' };
  const after = (context: ExtensionRuleContext, ...parameters: unknown[]) =>
    evaluate('app.rules.dateAfter', context, ...parameters);
  const late = (filed: unknown, delivered: unknown, ...days: unknown[]) =>
    after(on(claim(filed, delivered)), filedOn, deliveredOn, ...(days.length > 0 ? days : [30]));

  it('passes when the first date is more than the days after the second, not on the last day', () => {
    expect(late('2026-11-24T00:00:00.000Z', '2026-10-24T00:00:00.000Z')).toBe(true); // 31 days
    expect(late('2026-11-23T00:00:00.000Z', '2026-10-24T00:00:00.000Z')).toBe(false); // 30
    expect(late('2026-11-24', '2026-11-24')).toBe(false);
    // Filed before delivery, which the Edit form's check refuses, is never late.
    expect(late('2026-10-01', '2026-11-24')).toBe(false);
  });

  it('with 0 days, passes when the first date is after the second at all', () => {
    expect(late('2026-11-25', '2026-11-24', 0)).toBe(true);
    expect(late('2026-11-24', '2026-11-24', 0)).toBe(false);
  });

  it('reads "today" as the reader\'s day, for a date an offset in the past or ahead', () => {
    expect(after(on(claim(null, storedDay(-31))), 'today', deliveredOn, 30)).toBe(true);
    expect(after(on(claim(null, storedDay(-30))), 'today', deliveredOn, 30)).toBe(false);
    expect(after(on(claim(storedDay(31, true), null)), filedOn, 'today', 30)).toBe(true);
    expect(after(on(claim(storedDay(30, true), null)), filedOn, 'today', 30)).toBe(false);
  });

  it("reads the context's today and zone, as the other date rules do", () => {
    const record = claim(null, '2027-02-01');
    const march = { ...on(record), today: new Date('2027-03-10T12:00:00Z'), timeZone: 'UTC' };
    expect(after(on(record), 'today', deliveredOn, 30)).toBe(false);
    expect(after(march, 'today', deliveredOn, 30)).toBe(true);
    expect(after({ ...march, timeZone: 'Not/AZone' }, 'today', deliveredOn, 30)).toBe(false);
  });

  it('does not pass with no date, a property holding the text "today", or a computation', () => {
    expect(late(null, '2026-01-01')).toBe(false);
    expect(late('2026-11-24', '')).toBe(false);
    expect(late('2026-11-24', 'today')).toBe(false);
    expect(late('today', '2026-01-01')).toBe(false);
    const computed = { computed: { type: 'core.template', parameters: ['2026-01-01'] } };
    expect(after(on(claim('2026-11-24', null)), filedOn, computed, 30)).toBe(false);
    expect(after(on(null), filedOn, deliveredOn, 30)).toBe(false);
  });

  it('does not pass on days the validator refuses', () => {
    for (const days of [-1, 36501, 1.5, '30', null, undefined])
      expect(late('2026-11-24', '2000-01-01', days)).toBe(false);
    // And with none at all.
    expect(after(on(claim('2026-11-24', '2000-01-01')), filedOn, deliveredOn)).toBe(false);
    expect(late('2126-11-24', '2000-01-01', 36500)).toBe(true);
  });
});

describe("the date rules, read against the context's clock", () => {
  // The browser's clock says 24 November; the context pins another day, as the record page does
  // from RECORD_PAGE_TODAY. Each case fails if a rule reads the browser's clock or zone instead.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-24T12:00:00Z'));
  });

  afterEach(() => vi.useRealTimers());

  const pinned = (
    document: NuxeoDocument | null,
    today: Date,
    timeZone?: string,
  ): ExtensionRuleContext => ({ ...on(document), today, timeZone });

  it("reads the context's today, not the browser's", () => {
    const march = new Date('2027-03-10T12:00:00Z');
    const ended = asset('2027-01-15T00:00:00.000Z');
    // On the browser's 24 November these rights have not ended, and do not end within 30 days.
    expect(evaluate('app.rules.datePassed', on(ended), expired)).toBe(false);
    expect(evaluate('app.rules.datePassed', pinned(ended, march, 'UTC'), expired)).toBe(true);
    const ending = asset('2027-03-25T00:00:00.000Z');
    expect(evaluate('app.rules.dateWithin', on(ending), expired, 30)).toBe(false);
    expect(evaluate('app.rules.dateWithin', pinned(ending, march, 'UTC'), expired, 30)).toBe(true);
  });

  it("reads today's day and an instant's in the context's zone, an offset included", () => {
    // 21:00 UTC on the 9th is 02:30 on the 10th at +05:30, and 16:00 on the 9th at -05:00.
    const evening = new Date('2027-03-09T21:00:00Z');
    const endsOnThe10th = asset('2027-03-10');
    const within = (zone: string) =>
      evaluate('app.rules.dateWithin', pinned(endsOnThe10th, evening, zone), expired, 0);
    expect(within('+0530')).toBe(true);
    expect(within('-0500')).toBe(false);
    // 20:00 UTC on the 9th is already the 10th at +05:30: on the 10th there it has not passed.
    const instant = asset('2027-03-09T20:00:00Z');
    const passed = (today: Date, zone: string) =>
      evaluate('app.rules.datePassed', pinned(instant, today, zone), expired);
    expect(passed(new Date('2027-03-10T09:00:00Z'), '+0530')).toBe(false);
    expect(passed(new Date('2027-03-10T09:00:00Z'), 'UTC')).toBe(true);
  });

  it('pass neither rule in a zone the browser cannot read', () => {
    const today = new Date('2026-11-24T12:00:00Z');
    expect(daysFromToday('2026-11-01', today, 'Not/AZone')).toBeNull();
    const ended = asset('2026-11-01');
    expect(evaluate('app.rules.datePassed', pinned(ended, today, 'Not/AZone'), expired)).toBe(
      false,
    );
    const ending = asset('2026-11-30');
    expect(evaluate('app.rules.dateWithin', pinned(ending, today, 'Not/AZone'), expired, 30)).toBe(
      false,
    );
    // The same values pass in a zone it reads, so the refusal above is the zone's.
    expect(evaluate('app.rules.datePassed', pinned(ended, today, 'UTC'), expired)).toBe(true);
    expect(evaluate('app.rules.dateWithin', pinned(ending, today, 'UTC'), expired, 30)).toBe(true);
  });
});
