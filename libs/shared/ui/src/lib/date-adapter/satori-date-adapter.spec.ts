import { Component, LOCALE_ID, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  DateAdapter,
  MAT_DATE_FORMATS,
  MatDateFormats,
  MatNativeDateModule,
} from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { DEFAULT_APP_BOOTSTRAP_CONFIG } from '@nuxeo-satori/platform/app-config';
import { de, enGB, enUS, fr, frCA, zhCN } from 'date-fns/locale';
import { describe, expect, it, vi } from 'vitest';

import {
  DATE_ADAPTER_LANGUAGES,
  dateFnsLocaleFor,
  provideSatoriDateAdapter,
} from './satori-date-adapter';

/**
 * The regression this file exists for.
 *
 * `03/04/2026` is 3 April written day-first and 4 March written month-first. With
 * `provideNativeDateAdapter()` every one of these cases returned 4 March, in every locale,
 * because `NativeDateAdapter.parse()` is `Date.parse` and ignores both the format and the
 * locale it is handed. Run this spec against that provider and the three day-first rows fail.
 */
const PARSE_CASES = [
  { locale: 'en', input: '03/04/2026', year: 2026, month: 2, date: 4, why: 'US order, unchanged' },
  { locale: 'fr', input: '03/04/2026', year: 2026, month: 3, date: 3, why: 'French is day-first' },
  { locale: 'nl', input: '03-04-2026', year: 2026, month: 3, date: 3, why: 'Dutch uses hyphens' },
  { locale: 'de', input: '03.04.2026', year: 2026, month: 3, date: 3, why: 'German uses dots' },
  {
    locale: 'ja',
    input: '2026/04/03',
    year: 2026,
    month: 3,
    date: 3,
    why: 'Japanese is year-first',
  },
];

/**
 * Input a locale cannot express at all.
 *
 * The native adapter accepted all of these — `Date.parse` is lenient — and silently stored
 * 4 March, which is AC-3's whole point: a date the locale cannot express must be refused
 * rather than guessed into some third value.
 */
const REJECTED_CASES = [
  { locale: 'de', input: '03/04/2026', why: 'German writes 03.04.2026, not 03/04/2026' },
  { locale: 'fr', input: 'not a date', why: 'free text is not a date in any locale' },
];

function adapterFor(locale: string): { adapter: DateAdapter<Date>; formats: MatDateFormats } {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: LOCALE_ID, useValue: locale },
      provideSatoriDateAdapter(),
    ],
  });
  return {
    adapter: TestBed.inject(DateAdapter) as DateAdapter<Date>,
    formats: TestBed.inject(MAT_DATE_FORMATS),
  };
}

/** Parse the way a date input does: with the format the component actually gets handed. */
function parseAsInput(locale: string, input: string): Date | null {
  const { adapter, formats } = adapterFor(locale);
  return adapter.parse(input, formats.parse.dateInput);
}

describe('provideSatoriDateAdapter', () => {
  it.each(PARSE_CASES)(
    'reads "$input" in $locale as the locale means it ($why)',
    ({ locale, input, year, month, date }) => {
      const parsed = parseAsInput(locale, input);

      expect(parsed).not.toBeNull();
      expect(Number.isNaN(parsed?.getTime())).toBe(false);
      expect([parsed?.getFullYear(), parsed?.getMonth(), parsed?.getDate()]).toEqual([
        year,
        month,
        date,
      ]);
    },
  );

  // The assertion requires an Invalid Date specifically, and must NOT accept `null`. Material
  // reads `null` as an empty, valid field: it clears the model and marks nothing, so a
  // regression returning `null` for non-empty unparseable text would leave the field looking
  // fine while the user's input vanished — and a test that tolerated `null` would stay green
  // through it. That is AC-3's whole point, and permitting `null` here was caught in review.
  it.each(REJECTED_CASES)(
    'refuses "$input" in $locale rather than guessing ($why)',
    ({ locale, input }) => {
      const parsed = parseAsInput(locale, input);

      expect(parsed).not.toBeNull();
      expect(parsed).toBeInstanceOf(Date);
      expect(Number.isNaN((parsed as Date).getTime())).toBe(true);
    },
  );

  it('supplies MAT_DATE_FORMATS, the token the application never set', () => {
    const { formats } = adapterFor('fr');

    // `P` is date-fns' locale-specific short date. Without a parse format there is nothing for a
    // typed date to be parsed *against*, which is how the native adapter ended up on Date.parse.
    expect(formats.parse.dateInput).toBe('P');
    expect(formats.display.dateInput).toBe('P');
  });

  it('formats and parses through the same locale, so a round-trip is stable', () => {
    for (const locale of DATE_ADAPTER_LANGUAGES) {
      const { adapter, formats } = adapterFor(locale);
      const original = adapter.createDate(2026, 3, 3);

      const roundTripped = adapter.parse(
        adapter.format(original, formats.display.dateInput),
        formats.parse.dateInput,
      );

      expect([
        locale,
        roundTripped?.getFullYear(),
        roundTripped?.getMonth(),
        roundTripped?.getDate(),
      ]).toEqual([locale, 2026, 3, 3]);
    }
  });

  // Named for what it does. That the provider actually *consumes* `LOCALE_ID` is asserted by
  // the parse cases above, which set it and get locale-specific parsing back; this one covers
  // only the mapping, including the region subtag a customer's `LOCALE_ID` may carry.
  it('maps an Angular locale id to a date-fns locale, case and separator insensitively', () => {
    expect(dateFnsLocaleFor('fr')).toBe(fr);
    expect(dateFnsLocaleFor('FR')).toBe(fr);
    expect(dateFnsLocaleFor('fr_CA')).toBe(frCA);
  });

  // A region can change the field order outright, not just the separators, and all seven
  // non-US English regions date-fns ships are day- or year-first. Reduced to their base language they
  // would all get `enUS` — month-first — which is the original defect under a different id.
  // Every variant whose `P` differs from its base is covered, with the parsed result asserted
  // rather than just the locale object, so a wrong mapping cannot pass.
  it.each([
    { locale: 'en-GB', input: '03/04/2026', month: 3, date: 3 },
    { locale: 'en-AU', input: '03/04/2026', month: 3, date: 3 },
    { locale: 'en-IE', input: '03/04/2026', month: 3, date: 3 },
    { locale: 'en-IN', input: '03/04/2026', month: 3, date: 3 },
    { locale: 'en-NZ', input: '03/04/2026', month: 3, date: 3 },
    { locale: 'en-CA', input: '2026-04-03', month: 3, date: 3 },
    { locale: 'en-ZA', input: '2026/04/03', month: 3, date: 3 },
    { locale: 'fr-CA', input: '26-04-03', month: 3, date: 3 },
    { locale: 'fr-CH', input: '03.04.2026', month: 3, date: 3 },
    { locale: 'nl-BE', input: '03.04.2026', month: 3, date: 3 },
    { locale: 'en-US', input: '03/04/2026', month: 2, date: 4 },
  ])(
    'reads "$input" in $locale with that region\'s own order',
    ({ locale, input, month, date }) => {
      const parsed = parseAsInput(locale, input);

      expect(Number.isNaN(parsed?.getTime())).toBe(false);
      expect([parsed?.getMonth(), parsed?.getDate()]).toEqual([month, date]);
    },
  );

  it('uses Angular’s default en-US locale without a fallback warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(dateFnsLocaleFor('en-US')).toBe(enUS);
      expect(dateFnsLocaleFor('EN_us')).toBe(enUS);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('resolves the exact regional tag rather than the bare language', () => {
    expect(dateFnsLocaleFor('en-GB')).toBe(enGB);
    expect(dateFnsLocaleFor('en-US')).toBe(enUS);
    expect(dateFnsLocaleFor('fr-CA')).toBe(frCA);
  });

  // `de-AT`, `zh-HK` and `zh-TW` have the same `P` as their base, so they are deliberately not
  // in the map — an entry would add a locale to every bundle and change nothing. They must
  // still resolve correctly through the fallback.
  it('resolves a region identical to its base through the bare-language fallback', () => {
    expect(dateFnsLocaleFor('de-AT')).toBe(de);
    expect(dateFnsLocaleFor('zh-TW')).toBe(zhCN);
    expect([
      parseAsInput('de-AT', '03.04.2026')?.getMonth(),
      parseAsInput('de-AT', '03.04.2026')?.getDate(),
    ]).toEqual([3, 3]);
  });

  it('falls back to English for a language it has no locale for at all', () => {
    expect(dateFnsLocaleFor('pt-BR')).toBe(enUS);
  });

  // The warning is the only thing standing between a customer and a silently wrong date order
  // for a region we ship no data for, so it is asserted rather than assumed. An earlier version
  // of this test was named for the warning and checked only the returned locale, which means
  // deleting the `console.warn` would have left it green — caught in review on PR #394.
  it('warns in development when a regional tag falls back, naming the locale and the fallback', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      dateFnsLocaleFor('de-CH');

      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0][0]);
      expect(message).toContain('de-CH');
      expect(message).toContain('"de"');
      expect(message).toContain('misread');
    } finally {
      warn.mockRestore();
    }
  });

  it('does not warn for a tag it resolved exactly, or for a bare language', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      dateFnsLocaleFor('en-GB');
      dateFnsLocaleFor('fr');

      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  // NXSAT-629 review: the native adapter rendered Thai through `Intl`, which resolves `th` to
  // the Buddhist calendar, so it showed 3 April 2026 as `03/04/2569` — a string its own
  // `Date.parse` then read back as 4 March 2569. Angular's `DatePipe` has always shown the
  // Gregorian year for `th` (it never calls `Intl`, and the locale data has no calendar), so
  // Gregorian here makes the picker agree with every other date in the application.
  it('renders Thai with the Gregorian year, matching every other date surface', () => {
    const { adapter, formats } = adapterFor('th');

    expect(adapter.format(adapter.createDate(2026, 3, 3), formats.display.dateInput)).toBe(
      '03/04/2026',
    );
    expect(adapter.format(adapter.createDate(2026, 3, 3), formats.display.dateInput)).not.toContain(
      '2569',
    );
  });

  it('falls back to English for a language it has no locale for, rather than failing to start', () => {
    // A customer can set `defaultLanguage` to anything; a typo must not be fatal.
    expect(dateFnsLocaleFor('xx')).toBe(enUS);
    expect(dateFnsLocaleFor('')).toBe(enUS);
  });

  // The map and the shipped languages are two lists that must not drift. They did once already:
  // `register-locale-data.ts` exists because adding a catalogue without registering locale data
  // throws `NG0701` far from the cause.
  it('covers every language the application advertises', () => {
    expect([...DATE_ADAPTER_LANGUAGES].sort()).toEqual(
      [...DEFAULT_APP_BOOTSTRAP_CONFIG.availableLanguages].sort(),
    );
  });

  // Six of the fifteen date inputs got their adapter from `MatNativeDateModule` in `imports`
  // rather than from `providers`, and an app-root provider cannot override an imported module's.
  // This asserts the direction that makes the per-component fix work.
  it('overrides an adapter a component imports MatNativeDateModule for', () => {
    @Component({
      standalone: true,
      imports: [MatDatepickerModule, MatNativeDateModule, MatFormFieldModule, MatInputModule],
      providers: [provideSatoriDateAdapter()],
      templateUrl: './satori-date-adapter.host.html',
    })
    class HostWithNativeDateModule {}

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), { provide: LOCALE_ID, useValue: 'fr' }],
    });
    const fixture = TestBed.createComponent(HostWithNativeDateModule);
    fixture.detectChanges();

    const adapter = fixture.debugElement.injector.get(DateAdapter) as DateAdapter<Date>;
    const formats = fixture.debugElement.injector.get(MAT_DATE_FORMATS);
    const parsed = adapter.parse('03/04/2026', formats.parse.dateInput);

    expect([parsed?.getMonth(), parsed?.getDate()]).toEqual([3, 3]);
  });
});
