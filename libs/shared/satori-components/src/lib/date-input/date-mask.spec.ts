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

/**
 * Every language `Intl` formats a date in, found by asking it about each two- and three-letter
 * code rather than read from a list, so a language this suite never names is checked too.
 */
const LETTERS = [...'abcdefghijklmnopqrstuvwxyz'];
const EVERY_LANGUAGE = Intl.DateTimeFormat.supportedLocalesOf(
  LETTERS.flatMap((a) => LETTERS.flatMap((b) => [a + b, ...LETTERS.map((c) => a + b + c)])),
  { localeMatcher: 'lookup' },
);

describe('NxsLocaleDateAdapter', () => {
  // The hint is worked out from what the adapter writes, so it is only as good as the adapter
  // reading back what it wrote. Main's `provideSatoriDateAdapter` spec asserts the same of its own.
  it.each([
    ...['en-US', 'fr', 'de', 'nl', 'ja', 'th', 'zh', 'en-GB', 'fr-CA', 'fr-CH', 'nl-BE'],
    // A locale that writes a word after the date: `3.04.2026 г.`.
    ...['bg', 'mk'],
    // A locale whose plain numbers `Intl` orders unlike its two-digit fields: Maltese `4/3/2026`.
    ...['mt', 'so', 'sbp', 'jgo', 'ckb', 'nds', 'rw'],
    // A locale that writes the year first and then the day: Kyrgyz `2026-03-04`.
    ...['ky', 'ug'],
  ])('reads back the dates it writes in %s', (locale) => {
    const adapter = adapterFor(locale);
    const written = adapter.format(
      adapter.createDate(2026, 3, 3),
      MAT_NATIVE_DATE_FORMATS.display.dateInput,
    );
    expect(ymd(adapter.parse(written))).toBe('2026-4-3');
  });

  it('finds the languages it sweeps', () => {
    // Node's full ICU formats about 250. A build with less data would leave the sweep below
    // checking a handful, so it says so here instead.
    expect(EVERY_LANGUAGE.length).toBeGreaterThan(200);
    expect(EVERY_LANGUAGE).toEqual(
      expect.arrayContaining(['bg', 'ccp', 'ckb', 'dz', 'ky', 'mt', 'my', 'sat', 'ug']),
    );
  });

  it(
    'reads back the dates it writes, and a date typed as its hint says, in every language',
    {
      timeout: 30_000,
    },
    () => {
      const adapter = adapterFor('en-US');
      const failures: string[] = [];
      for (const locale of EVERY_LANGUAGE) {
        adapter.setLocale(locale);
        for (const [year, month, day] of [
          [2026, 3, 3],
          [2026, 11, 31],
          [2026, 0, 15],
        ]) {
          const written = adapter.format(
            adapter.createDate(year, month, day),
            MAT_NATIVE_DATE_FORMATS.display.dateInput,
          );
          const read = ymd(adapter.parse(written));
          if (read !== `${year}-${month + 1}-${day}`)
            failures.push(`${locale}: ${written} is ${read}`);
        }
        // The English mask, as a catalogue without one shows it: the hint, or the date as written.
        const sample = writtenBy(adapter);
        const hint = nxsDateMask(sample, NXS_ENGLISH_DATE_MASK, locale);
        const [typed, meant] =
          hint === sample ? [sample, '2026-12-31'] : [followed(hint, 'en'), '2026-4-3'];
        const read = ymd(adapter.parse(typed));
        if (read !== meant) failures.push(`${locale}: shows ${hint}, reads ${typed} as ${read}`);
      }
      expect(failures).toEqual([]);
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
   * The hint a field shows, and then the parser's reading of a date typed as that hint says. The
   * second is the property this exists for: a hint that disagrees with the parser stores a date
   * silently swapped.
   */
  function hintCases(row: {
    locale: string;
    mask: string;
    active: string;
    language: Language;
    hint: string;
  }): void {
    const { locale, mask, active, language, hint } = row;

    it(`reads ${hint}`, () => {
      expect(nxsDateMask(writtenBy(adapterFor(locale)), mask, active)).toBe(hint);
    });

    it('is read by the parser as it tells the user to type', () => {
      const adapter = adapterFor(locale);
      const shown = nxsDateMask(writtenBy(adapter), mask, active);
      expect(ymd(adapter.parse(followed(shown, language)))).toBe('2026-4-3');
    });
  }

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
    { locale: 'mt', language: 'en', hint: 'mm/dd/yyyy', english: true },
    { locale: 'ky', language: 'en', hint: 'yyyy-dd-mm', english: true },
    // A field that writes its own digits: the hint lines up with them too.
    { locale: 'dz', language: 'en', hint: 'yyyy-mm-dd', english: true },
    // A language whose dates are formatted in another locale: French letters, American order.
    { locale: 'en-US', language: 'fr', hint: 'mm/jj/aaaa' },
  ] as const)('$language mask under $locale', ({ locale, language, hint, ...rest }) => {
    const english = 'english' in rest;
    hintCases({
      locale,
      language,
      hint,
      mask: english ? NXS_ENGLISH_DATE_MASK : CATALOGUE[language].mask,
      // The English mask arrives under the active language, whichever that is.
      active: english ? locale.split('-')[0] : language,
    });
  });

  /**
   * The language as `TranslateService.getCurrentLang()` names it: with an underscore, as
   * ngx-translate setups and POSIX often write it, and with a region whose catalogue has its own
   * mask, in the region's order, or its language's, copied.
   */
  describe.each([
    { active: 'fr_FR', locale: 'fr', language: 'fr', hint: 'jj/mm/aaaa' },
    { active: 'de_DE', locale: 'de', language: 'de', hint: 'tt.mm.jjjj' },
    { active: 'zh_CN', locale: 'zh', language: 'zh', hint: 'yyyy/mm/dd' },
    { active: 'en_GB', locale: 'en-GB', language: 'en', hint: 'dd/mm/yyyy', mask: 'dd/mm/yyyy' },
    { active: 'fr_CA', locale: 'fr-CA', language: 'fr', hint: 'aaaa-mm-jj' },
  ] as const)('$active catalogue under $locale', ({ language, ...row }) => {
    hintCases({
      ...row,
      language,
      mask: ('mask' in row ? row.mask : undefined) ?? CATALOGUE[language].mask,
    });
  });

  it('gives the English month-first mask to no day-first field', () => {
    expect(nxsDateMask(writtenBy(adapterFor('fr')), NXS_ENGLISH_DATE_MASK, 'fr')).not.toBe(
      NXS_ENGLISH_DATE_MASK,
    );
  });

  it('shows the date as written when no order gives the year its longest run', () => {
    expect(nxsDateMask('31/12/2026', 'aaaa/mm/jj', 'fr')).toBe('31/12/2026');
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

  it.each(['bg', 'mk'])(
    'shows the date as written where %s writes a word after it, and the field reads it back',
    (locale) => {
      const adapter = adapterFor(locale);
      const written = writtenBy(adapter);
      expect(written).toMatch(/\p{L}/u);
      expect(nxsDateMask(written, NXS_ENGLISH_DATE_MASK, locale)).toBe(written);
      expect(ymd(adapter.parse(written))).toBe('2026-12-31');
    },
  );

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
