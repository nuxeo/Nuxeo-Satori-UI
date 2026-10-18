import { LOCALE_ID, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { PLATFORM_EN_TRANSLATIONS } from '../i18n/platform-en';
import { dateMaskFor } from './date-mask';
import { DateMaskPipe } from './date-mask.pipe';

/**
 * The seven catalogue values, as shipped. English is read from the published fallback so this
 * file cannot drift from it; the other six are literals because their catalogues live in
 * `apps/nuxeo-ui` and a library spec must not import across that boundary. Their agreement with
 * each parser is what `satori-date-adapter.spec.ts`' parse table already asserts.
 */
const CATALOGUE_MASKS = {
  en: PLATFORM_EN_TRANSLATIONS['common.date-mask'],
  fr: 'jj/mm/aaaa',
  de: 'tt.mm.jjjj',
  ja: 'yyyy/mm/dd',
  nl: 'dd-mm-jjjj',
  th: 'dd/mm/yyyy',
  zh: 'yy-mm-dd',
} as const;

describe('dateMaskFor', () => {
  it('ships the English mask the fallback declares, so the table below is anchored', () => {
    expect(CATALOGUE_MASKS.en).toBe('mm/dd/yyyy');
  });

  /**
   * A language's own mask is already right, and must come back untouched — including the
   * localized letters a translator chose. Every locale this application can actually produce is
   * one of these seven, so this row set is also "the app's behaviour does not change".
   */
  describe.each(Object.entries(CATALOGUE_MASKS))('%s', (language, mask) => {
    it('returns the catalogue value unchanged', () => {
      expect(dateMaskFor(language, mask)).toBe(mask);
    });
  });

  /**
   * The regression this file exists for.
   *
   * These are the regional tags whose date-fns `P` differs from their base language, so the
   * catalogue's own mask describes a different field order from the one the adapter parses. With
   * the composition removed every row returns its base language's mask, and the `en-*` rows are
   * the original defect exactly: a host told to type month-first into a day-first field.
   */
  const REGIONAL_CASES = [
    { locale: 'en-GB', language: 'en', expected: 'dd/mm/yyyy', why: 'order only' },
    { locale: 'en-AU', language: 'en', expected: 'dd/mm/yyyy', why: 'order only' },
    { locale: 'en-IE', language: 'en', expected: 'dd/mm/yyyy', why: 'order only' },
    { locale: 'en-IN', language: 'en', expected: 'dd/mm/yyyy', why: 'order only' },
    { locale: 'en-NZ', language: 'en', expected: 'dd/mm/yyyy', why: 'order only' },
    { locale: 'en-CA', language: 'en', expected: 'yyyy-mm-dd', why: 'year first, hyphens' },
    { locale: 'en-ZA', language: 'en', expected: 'yyyy/mm/dd', why: 'year first, slashes' },
    { locale: 'fr-CH', language: 'fr', expected: 'jj.mm.aaaa', why: 'separators only' },
    {
      locale: 'fr-CA',
      language: 'fr',
      expected: 'aa-mm-jj',
      why: 'order, separators, 2-digit year',
    },
    { locale: 'nl-BE', language: 'nl', expected: 'dd.mm.jjjj', why: 'separators only' },
  ] as const;

  describe.each(REGIONAL_CASES)('$locale ($why)', ({ locale, language, expected }) => {
    it(`composes ${expected}`, () => {
      const mask = CATALOGUE_MASKS[language as keyof typeof CATALOGUE_MASKS];
      expect(dateMaskFor(locale, mask)).toBe(expected);
    });

    it('keeps the base language letters rather than Latin ones', () => {
      const mask = CATALOGUE_MASKS[language as keyof typeof CATALOGUE_MASKS];
      const lettersIn = (value: string) => new Set(value.match(/\p{L}/gu) ?? []);
      expect(lettersIn(dateMaskFor(locale, mask))).toStrictEqual(lettersIn(mask));
    });
  });

  it('does not reduce a region to its base language, which is the defect it replaces', () => {
    expect(dateMaskFor('en-GB', CATALOGUE_MASKS.en)).not.toBe(CATALOGUE_MASKS.en);
  });

  /**
   * `providePlatformEnglishFallback()` answers with the platform's English for any language
   * whose catalogue has no mask, so the letters arrive in **English** order while `LOCALE_ID`
   * says otherwise. The first version of this function read them as the language's own and
   * reintroduced the defect: `fr` kept month-first `mm/dd/yyyy`, and `fr-CA` composed English
   * runs through French field positions and produced `yy-dd-mm`. Every row here is day-first or
   * year-first, which is what each of these parsers accepts.
   */
  describe.each([
    { locale: 'fr', expected: 'dd/mm/yyyy', why: 'French parses day-first' },
    { locale: 'de', expected: 'dd.mm.yyyy', why: 'German uses dots' },
    { locale: 'nl', expected: 'dd-mm-yyyy', why: 'Dutch uses hyphens' },
    { locale: 'ja', expected: 'yyyy/mm/dd', why: 'Japanese is year-first' },
    { locale: 'th', expected: 'dd/mm/yyyy', why: 'Thai parses day-first' },
    { locale: 'zh', expected: 'yy-mm-dd', why: 'Chinese is a two-digit year' },
    { locale: 'fr-CA', expected: 'yy-mm-dd', why: 'the yy-dd-mm case the review found' },
    { locale: 'fr-CH', expected: 'dd.mm.yyyy', why: 'French order, Swiss dots' },
    { locale: 'en-GB', expected: 'dd/mm/yyyy', why: 'English letters already' },
  ])('English fallback under $locale ($why)', ({ locale, expected }) => {
    it(`composes ${expected}`, () => {
      expect(dateMaskFor(locale, CATALOGUE_MASKS.en)).toBe(expected);
    });

    it('never leaves the English month-first hint in place', () => {
      if (expected === CATALOGUE_MASKS.en) return;
      expect(dateMaskFor(locale, CATALOGUE_MASKS.en)).not.toBe(CATALOGUE_MASKS.en);
    });
  });

  it('reads a language’s own mask as that language, not as the English fallback', () => {
    // `jj/mm/aaaa` is not the English value, so French field positions are the right ones.
    expect(dateMaskFor('fr-CA', CATALOGUE_MASKS.fr)).toBe('aa-mm-jj');
  });

  /**
   * Anything it cannot line up comes back exactly as given. A hint this function mangled would
   * be worse than one that merely disagrees with the parser, and it cannot tell a value it
   * failed to parse from one it misread.
   */
  describe.each([
    { value: '', why: 'empty' },
    { value: 'Enter a date', why: 'prose, not a mask' },
    { value: 'yyyy年mm月dd日', why: 'literal segments it cannot place' },
    { value: 'dd/mm', why: 'fewer fields than the pattern has' },
    { value: 'dmy/dd/yyyy', why: 'a run that is not one repeated letter' },
  ])('$why', ({ value }) => {
    it('returns the value it was given', () => {
      expect(dateMaskFor('en-GB', value)).toBe(value);
    });
  });

  // A host may ship an already-regional catalogue; `d`/`m`/`y` letters name their own fields.
  describe.each([
    { locale: 'en-GB', mask: 'dd/mm/yyyy', expected: 'dd/mm/yyyy', why: 'already day-first' },
    {
      locale: 'en-US',
      mask: 'dd/mm/yyyy',
      expected: 'mm/dd/yyyy',
      why: 'day-first mask, month-first field',
    },
    {
      locale: 'en-CA',
      mask: 'dd/mm/yyyy',
      expected: 'yyyy-mm-dd',
      why: 'day-first mask, year-first field',
    },
    {
      locale: 'de',
      mask: 'yyyy-mm-dd',
      expected: 'dd.mm.yyyy',
      why: 'year-first mask, German field',
    },
  ])('regional catalogue mask $mask under $locale ($why)', ({ locale, mask, expected }) => {
    it(`composes ${expected}`, () => {
      expect(dateMaskFor(locale, mask)).toBe(expected);
    });
  });

  it('falls back to the base language for a region date-fns has no data for', () => {
    expect(dateMaskFor('en-XX', CATALOGUE_MASKS.en)).toBe(CATALOGUE_MASKS.en);
  });

  it('tolerates an underscored locale id, as the adapter does', () => {
    expect(dateMaskFor('en_GB', CATALOGUE_MASKS.en)).toBe('dd/mm/yyyy');
  });
});

describe('DateMaskPipe', () => {
  const maskUnder = (localeId: string, mask: string): string => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), { provide: LOCALE_ID, useValue: localeId }],
    });
    return TestBed.runInInjectionContext(() => new DateMaskPipe()).transform(mask);
  };

  it('reshapes the translated mask for the injected LOCALE_ID', () => {
    expect(maskUnder('en-GB', CATALOGUE_MASKS.en)).toBe('dd/mm/yyyy');
  });

  it('leaves a bare language alone', () => {
    expect(maskUnder('fr', CATALOGUE_MASKS.fr)).toBe(CATALOGUE_MASKS.fr);
  });

  it('treats a missing translation as empty rather than throwing', () => {
    expect(maskUnder('en-GB', null as unknown as string)).toBe('');
  });
});
