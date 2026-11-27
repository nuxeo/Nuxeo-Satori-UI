import { formatCurrency, formatDate, formatNumber } from '@angular/common';

import { REGISTERED_LOCALES, registerShippedLocaleData } from './register-locale-data';

/**
 * The claim is not "the function runs". It is that a date and a number formatted in each
 * shipped locale come back in that locale's own conventions instead of throwing `NG0701`.
 *
 * So these assert through `formatDate` and `formatNumber` — the same Angular entry points
 * `DatePipe` and `DecimalPipe` use — rather than spying on `registerLocaleData`. A spy would
 * pass if the wrong data were registered under the right name, which is the mistake worth
 * catching: the failure this file exists to prevent was thirty-six console errors on the
 * French evidence pass, and no spy would have seen it.
 */
describe('registerShippedLocaleData', () => {
  const MIDSUMMER = new Date(2026, 6, 14);

  beforeEach(() => {
    registerShippedLocaleData();
  });

  it('registers data for every locale it advertises', () => {
    // If these two ever disagree the guardrail is checking the wrong list.
    expect([...REGISTERED_LOCALES].sort()).toEqual([
      'ar',
      'da',
      'de',
      'es',
      'fi',
      'fr',
      'he',
      'it',
      'ja',
      'nb',
      'nl',
      'sv',
    ]);
  });

  /**
   * Spanish and the Nordic languages of the business apps' phase 7: a date, a number and an amount
   * in each, as `DatePipe`, `DecimalPipe` and `CurrencyPipe` format them, each in that locale's own
   * conventions. Danish and Norwegian Bokmål write a date identically, so the date rows alone
   * could not tell their data apart: the thousands separator does — Danish groups with a full
   * stop, Norwegian with a no-break space.
   *
   * The amount is in the locale's own currency, which `CurrencyPipe` is given rather than reads:
   * what the locale decides is where the sign goes and which separators are used. Expected values
   * are Angular's CLDR data, written out rather than computed here, so that data registered under
   * the wrong name fails rather than agreeing with itself.
   */
  /** The no-break space Angular's CLDR data groups digits with, and spaces a sign with. */
  const NBSP = '\u00A0';
  const PHASE_7: ReadonlyArray<
    readonly [
      locale: string,
      long: string,
      short: string,
      number: string,
      currency: readonly [code: string, sign: string],
      amount: string,
    ]
  > = [
    ['es', '14 de julio de 2026', '14/7/26', '1.234.567,5', ['EUR', '€'], `1.234,50${NBSP}€`],
    [
      'sv',
      '14 juli 2026',
      '2026-07-14',
      `1${NBSP}234${NBSP}567,5`,
      ['SEK', 'kr'],
      `1${NBSP}234,50${NBSP}kr`,
    ],
    ['da', '14. juli 2026', '14.07.2026', '1.234.567,5', ['DKK', 'kr.'], `1.234,50${NBSP}kr.`],
    [
      'nb',
      '14. juli 2026',
      '14.07.2026',
      `1${NBSP}234${NBSP}567,5`,
      ['NOK', 'kr'],
      `1${NBSP}234,50${NBSP}kr`,
    ],
    [
      'fi',
      '14. heinäkuuta 2026',
      '14.7.2026',
      `1${NBSP}234${NBSP}567,5`,
      ['EUR', '€'],
      `1${NBSP}234,50${NBSP}€`,
    ],
  ];
  for (const [locale, long, short, number, [code, sign], amount] of PHASE_7) {
    it(`formats a date, a number and an amount in ${locale}'s own conventions`, () => {
      expect(formatDate(MIDSUMMER, 'longDate', locale)).toBe(long);
      expect(formatDate(MIDSUMMER, 'shortDate', locale)).toBe(short);
      expect(formatNumber(1234567.5, locale, '1.1-1')).toBe(number);
      expect(formatCurrency(1234.5, locale, sign, code)).toBe(amount);
    });
  }

  it('formats a date in French rather than throwing NG0701', () => {
    // The literal defect: before registration this threw `Missing locale data for "fr"`.
    expect(formatDate(MIDSUMMER, 'longDate', 'fr')).toContain('juillet');
  });

  it('formats a date in German rather than throwing NG0701', () => {
    expect(formatDate(MIDSUMMER, 'longDate', 'de')).toContain('Juli');
  });

  const LONG_DATE_JULY: ReadonlyArray<readonly [locale: string, expected: string]> = [
    ['ja', '2026年7月14日'],
    ['nl', 'juli'],
    ['es', 'julio'],
    ['it', 'luglio'],
    // Non-Latin scripts, which is most of what a wrong-data registration would get wrong here:
    // English data under `ar` or `he` would still format, in Latin letters.
    ['ar', 'يوليو'],
    ['he', 'יולי'],
    // Swedish and Dutch both spell July `juli`, so this row cannot tell them apart on its own —
    // the field order below is what does.
    ['sv', 'juli'],
  ];
  for (const [locale, expected] of LONG_DATE_JULY) {
    it(`formats a date in ${locale} rather than throwing NG0701`, () => {
      expect(formatDate(MIDSUMMER, 'longDate', locale)).toContain(expected);
    });
  }

  it('tells Swedish and Dutch apart, which share every month name', () => {
    // The pair this suite could otherwise pass with swapped: `juli` is `juli` in both. Swedish
    // writes the ISO order and Dutch day-first, so the short form separates them.
    expect(formatDate(MIDSUMMER, 'shortDate', 'sv')).toBe('2026-07-14');
    expect(formatDate(MIDSUMMER, 'shortDate', 'nl')).toBe('14-07-2026');
  });

  it("uses each locale's own separators, not English ones", () => {
    // A locale registered under the wrong data would still format — just wrongly. French uses
    // a comma for the decimal mark and German a full stop for thousands.
    expect(formatNumber(1234.5, 'fr', '1.1-1')).toContain(',');
    expect(formatNumber(1234.5, 'de', '1.1-1')).toContain('.');
  });

  it('is safe to call more than once, because APP_INITIALIZER ordering is not guaranteed', () => {
    expect(() => {
      registerShippedLocaleData();
      registerShippedLocaleData();
    }).not.toThrow();
    expect(formatDate(MIDSUMMER, 'longDate', 'fr')).toContain('juillet');
  });

  it('leaves English alone, which Angular bundles', () => {
    // `en` is deliberately absent from LOCALE_DATA. Registering it would be a no-op the
    // guardrail would then have to special-case in the other direction.
    expect(REGISTERED_LOCALES).not.toContain('en');
    expect(formatDate(MIDSUMMER, 'longDate', 'en-US')).toContain('July');
  });
});
