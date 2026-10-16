import { LOCALE_ID, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DateAdapter, MAT_DATE_FORMATS, MAT_NATIVE_DATE_FORMATS } from '@angular/material/core';
import { TranslateService } from '@ngx-translate/core';
import { describe, expect, it } from 'vitest';

import { NxsDateMaskPipe } from './date-mask.pipe';
import {
  NXS_DATE_MASK_SAMPLE,
  NXS_ENGLISH_DATE_MASK,
  NxsLocaleDateAdapter,
  nxsDateMask,
} from './locale-date';

/**
 * Each language's `common.date-mask` as main's catalogues localize it (NXSAT-629), with the
 * letters each one uses for each field. The English one is held to the real catalogue below.
 */
const CATALOGUE = {
  en: { mask: NXS_ENGLISH_DATE_MASK, day: 'd', month: 'm', year: 'y' },
  fr: { mask: 'jj/mm/aaaa', day: 'j', month: 'm', year: 'a' },
  de: { mask: 'tt.mm.jjjj', day: 't', month: 'm', year: 'j' },
  nl: { mask: 'dd-mm-jjjj', day: 'd', month: 'm', year: 'j' },
  ja: { mask: 'yyyy/mm/dd', day: 'd', month: 'm', year: 'y' },
  th: { mask: 'dd/mm/yyyy', day: 'd', month: 'm', year: 'y' },
  zh: { mask: 'yy-mm-dd', day: 'd', month: 'm', year: 'y' },
} as const;
type Language = keyof typeof CATALOGUE;

/** The adapter a date field gets from `provideNxsDateAdapter()` when the host has none. */
function adapterFor(locale: string): NxsLocaleDateAdapter {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), { provide: LOCALE_ID, useValue: locale }],
  });
  return TestBed.runInInjectionContext(() => new NxsLocaleDateAdapter());
}

/** The sample date as the adapter writes it into the field. */
function writtenBy(adapter: DateAdapter<Date>): string {
  const { year, month, day } = NXS_DATE_MASK_SAMPLE;
  return adapter.format(
    adapter.createDate(year, month, day),
    MAT_NATIVE_DATE_FORMATS.display.dateInput,
  );
}

/**
 * What a user types who follows the hint to enter 3 April 2026: each run of the hint's letters
 * replaced by that field, as many digits as letters for the year.
 */
function followed(hint: string, language: Language): string {
  const letters = CATALOGUE[language];
  return hint.replace(/\p{L}+/gu, (run) => {
    if (run[0] === letters.day) return '03';
    if (run[0] === letters.month) return '04';
    if (run[0] === letters.year) return run.length <= 2 ? '26' : '2026';
    return run;
  });
}

const ymd = (date: Date | null) =>
  date ? `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}` : null;

describe('NxsLocaleDateAdapter', () => {
  // The hint is worked out from what the adapter writes, so it is only as good as the adapter
  // reading back what it wrote. Main's `provideSatoriDateAdapter` spec asserts the same of its own.
  it.each(['en-US', 'fr', 'de', 'nl', 'ja', 'th', 'zh', 'en-GB', 'fr-CA', 'fr-CH', 'nl-BE'])(
    'reads back the dates it writes in %s',
    (locale) => {
      const adapter = adapterFor(locale);
      const written = adapter.format(
        adapter.createDate(2026, 3, 3),
        MAT_NATIVE_DATE_FORMATS.display.dateInput,
      );
      expect(ymd(adapter.parse(written))).toBe('2026-4-3');
    },
  );
});

describe('nxsDateMask', () => {
  it('reads the English mask as the English catalogue holds it', () => {
    expect(TestBed.inject(TranslateService).instant('common.date-mask')).toBe(
      NXS_ENGLISH_DATE_MASK,
    );
  });

  /**
   * Every row is the hint a field shows and then the parser's reading of a date typed as that
   * hint says. The second is the property this exists for: a hint that disagrees with the parser
   * stores a date silently swapped.
   */
  describe.each([
    // A language's own mask, under its own locale: the translator's letters, in the field's order.
    { locale: 'en-US', language: 'en', hint: 'mm/dd/yyyy' },
    { locale: 'fr', language: 'fr', hint: 'jj/mm/aaaa' },
    { locale: 'de', language: 'de', hint: 'tt.mm.jjjj' },
    { locale: 'nl', language: 'nl', hint: 'dd-mm-jjjj' },
    { locale: 'ja', language: 'ja', hint: 'yyyy/mm/dd' },
    { locale: 'th', language: 'th', hint: 'dd/mm/yyyy' },
    // The field writes a four-digit year with slashes, so the hint does too.
    { locale: 'zh', language: 'zh', hint: 'yyyy/mm/dd' },
    // A region that orders or separates the fields differently from its language.
    { locale: 'en-GB', language: 'en', hint: 'dd/mm/yyyy' },
    { locale: 'en-CA', language: 'en', hint: 'yyyy-mm-dd' },
    { locale: 'en-ZA', language: 'en', hint: 'yyyy/mm/dd' },
    { locale: 'fr-CH', language: 'fr', hint: 'jj.mm.aaaa' },
    { locale: 'fr-CA', language: 'fr', hint: 'aaaa-mm-jj' },
    { locale: 'nl-BE', language: 'nl', hint: 'dd/mm/jjjj' },
    // The English mask answering for a catalogue without one: read in English order.
    { locale: 'fr', language: 'en', hint: 'dd/mm/yyyy', english: true },
    { locale: 'de', language: 'en', hint: 'dd.mm.yyyy', english: true },
    { locale: 'nl', language: 'en', hint: 'dd-mm-yyyy', english: true },
    { locale: 'ja', language: 'en', hint: 'yyyy/mm/dd', english: true },
    { locale: 'th', language: 'en', hint: 'dd/mm/yyyy', english: true },
    { locale: 'zh', language: 'en', hint: 'yyyy/mm/dd', english: true },
    { locale: 'fr-CA', language: 'en', hint: 'yyyy-mm-dd', english: true },
    // A language whose dates are formatted in another locale: French letters, American order.
    { locale: 'en-US', language: 'fr', hint: 'mm/jj/aaaa' },
  ] as const)('$language mask under $locale', ({ locale, language, hint, ...rest }) => {
    const english = 'english' in rest;
    const mask = english ? NXS_ENGLISH_DATE_MASK : CATALOGUE[language].mask;
    // The English mask arrives under the active language, whichever that is.
    const active = english ? locale.split('-')[0] : language;

    it(`reads ${hint}`, () => {
      expect(nxsDateMask(writtenBy(adapterFor(locale)), mask, active)).toBe(hint);
    });

    it('is read by the parser as it tells the user to type', () => {
      const adapter = adapterFor(locale);
      const shown = nxsDateMask(writtenBy(adapter), mask, active);
      expect(ymd(adapter.parse(followed(shown, language)))).toBe('2026-4-3');
    });
  });

  it('gives the English month-first mask to no day-first field', () => {
    expect(nxsDateMask(writtenBy(adapterFor('fr')), NXS_ENGLISH_DATE_MASK, 'fr')).not.toBe(
      NXS_ENGLISH_DATE_MASK,
    );
  });

  it('gives two letters for a year the field writes with two digits', () => {
    expect(nxsDateMask('26-12-31', CATALOGUE.fr.mask, 'fr')).toBe('aa-mm-jj');
  });

  it('follows digits written in another script', () => {
    expect(nxsDateMask('٣١/١٢/٢٠٢٦', CATALOGUE.fr.mask, 'fr')).toBe('jj/mm/aaaa');
  });

  describe.each([
    { mask: '', why: 'an empty mask' },
    { mask: 'common.date-mask', why: 'an untranslated key' },
    { mask: 'Enter a date', why: 'prose' },
    { mask: 'yyyy年mm月dd日', why: 'literals it cannot place' },
    { mask: 'dd/mm', why: 'two fields' },
    { mask: 'dmy/dd/yyyy', why: 'a run of mixed letters' },
  ])('$why', ({ mask }) => {
    it('shows the date as the field writes it, which the parser reads', () => {
      expect(nxsDateMask('31/12/2026', mask, 'fr')).toBe('31/12/2026');
    });
  });

  it('shows the date as written when the field writes the month as a word', () => {
    expect(nxsDateMask('Dec 31, 2026', CATALOGUE.en.mask, 'en')).toBe('Dec 31, 2026');
  });
});

describe('NxsDateMaskPipe', () => {
  function pipeWith(locale: string): { pipe: NxsDateMaskPipe; adapter: NxsLocaleDateAdapter } {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: LOCALE_ID, useValue: locale },
        { provide: DateAdapter, useClass: NxsLocaleDateAdapter },
        { provide: MAT_DATE_FORMATS, useValue: MAT_NATIVE_DATE_FORMATS },
      ],
    });
    return {
      pipe: TestBed.runInInjectionContext(() => new NxsDateMaskPipe()),
      adapter: TestBed.inject(DateAdapter) as NxsLocaleDateAdapter,
    };
  }

  it.each([
    ['fr', 'dd/mm/yyyy'],
    ['en-US', 'mm/dd/yyyy'],
  ])('reshapes the translated mask into the order its adapter writes in %s', (locale, hint) => {
    expect(pipeWith(locale).pipe.transform(NXS_ENGLISH_DATE_MASK)).toBe(hint);
  });

  it('follows a locale the adapter is switched to, as the parser does', () => {
    const { pipe, adapter } = pipeWith('en-US');
    expect(pipe.transform(NXS_ENGLISH_DATE_MASK)).toBe('mm/dd/yyyy');
    adapter.setLocale('de');
    expect(pipe.transform(NXS_ENGLISH_DATE_MASK)).toBe('dd.mm.yyyy');
  });

  it('shows the date as written for a missing translation, rather than throwing', () => {
    expect(pipeWith('fr').pipe.transform(null)).toBe('31/12/2026');
  });
});
