import { LOCALE_ID, Provider, inject, isDevMode } from '@angular/core';
import { provideDateFnsAdapter } from '@angular/material-date-fns-adapter';
import { MAT_DATE_LOCALE } from '@angular/material/core';
import type { Locale } from 'date-fns';
import {
  de,
  enAU,
  enCA,
  enGB,
  enIE,
  enIN,
  enNZ,
  enUS,
  enZA,
  fr,
  frCA,
  frCH,
  ja,
  nl,
  nlBE,
  th,
  zhCN,
} from 'date-fns/locale';

/**
 * A date-fns locale for every language the application ships a catalogue for, plus the regional
 * variants date-fns ships for those languages.
 *
 * Keyed by the Angular locale id, lowercased. The seven bare language ids are the ones this
 * application can actually produce — `resolveFormattingLocale` clamps `LOCALE_ID` to
 * `REGISTERED_LOCALES` — and a test asserts they match `availableLanguages`, so adding a
 * language cannot quietly leave its dates being parsed as English.
 *
 * The regional entries are here for the **published** provider rather than for us. These
 * dialogs are exported from `@nuxeo/satori-platform/ui`, so a customer's `LOCALE_ID` reaches
 * this map unclamped, and a region can change the field order outright: all seven non-US
 * English regions date-fns ships are day-first or year-first, so reducing any of them to `en`
 * hands them `enUS` — month-first, the original defect wearing a different locale id.
 *
 * The list is exactly **the regional variants whose date-fns `P` format differs from their base
 * language**, enumerated rather than guessed:
 *
 * | variant | `P` | base `P` |
 * | --- | --- | --- |
 * | `en-AU` `en-GB` `en-IE` `en-IN` `en-NZ` | `dd/MM/yyyy` | `MM/dd/yyyy` |
 * | `en-CA` | `yyyy-MM-dd` | `MM/dd/yyyy` |
 * | `en-ZA` | `yyyy/MM/dd` | `MM/dd/yyyy` |
 * | `fr-CA` | `yy-MM-dd` | `dd/MM/y` |
 * | `fr-CH` | `dd.MM.y` | `dd/MM/y` |
 * | `nl-BE` | `dd.MM.y` | `dd-MM-y` |
 *
 * `de-AT`, `zh-HK` and `zh-TW` are deliberately **absent**: their `P` is identical to their
 * base, so an entry would add a locale to every consumer's bundle and change no behaviour. They
 * resolve correctly through the bare-language fallback.
 *
 * `en` maps to `enUS` and is present here although `register-locale-data.ts` omits it: Angular
 * bundles `en-US` locale data so registering it there would be a no-op, whereas date-fns ships
 * no region-less English and the adapter needs one named.
 */
const DATE_FNS_LOCALES: Readonly<Record<string, Locale>> = {
  en: enUS,
  'en-us': enUS,
  'en-au': enAU,
  'en-ca': enCA,
  'en-gb': enGB,
  'en-ie': enIE,
  'en-in': enIN,
  'en-nz': enNZ,
  'en-za': enZA,
  fr,
  'fr-ca': frCA,
  'fr-ch': frCH,
  de,
  ja,
  nl,
  'nl-be': nlBE,
  th,
  zh: zhCN,
};

/** The bare language ids above, for the test that keeps this map and `availableLanguages` in step. */
export const DATE_ADAPTER_LANGUAGES: readonly string[] = Object.keys(DATE_FNS_LOCALES).filter(
  (id) => !id.includes('-'),
);

/**
 * The date-fns locale for an Angular locale id.
 *
 * Resolution order is exact tag, then bare language, then English. The exact tag comes first
 * because a region can change the field order outright, not just the separators, and silently
 * parsing one region's dates with another's order is the defect this file exists to remove.
 *
 * A regional tag we have no data for still falls back rather than throwing — an application
 * that will not start is worse than one that formats in the wrong region — but it says so in
 * development, because the fallback is the one case here that can be wrong without any symptom.
 */
export function dateFnsLocaleFor(localeId: string): Locale {
  const tag = (localeId ?? '').toLowerCase().replaceAll('_', '-');
  const exact = DATE_FNS_LOCALES[tag];
  if (exact) return exact;

  const language = tag.split('-')[0];
  const base = DATE_FNS_LOCALES[language];
  if (tag !== language && isDevMode()) {
    console.warn(
      `[satori-date-adapter] No date-fns locale for "${localeId}"; dates will be parsed and ` +
        `formatted as "${base ? language : 'en'}". If that region orders or separates date ` +
        'fields differently, typed dates will be misread. Add it to DATE_FNS_LOCALES.',
    );
  }
  return base ?? enUS;
}

/**
 * Angular Material's date adapter, parsing and formatting in the application's language.
 *
 * ## Why this replaces `provideNativeDateAdapter()`
 *
 * `NativeDateAdapter` cannot parse a localized date, and says so in its own source: `parse()`
 * is `new Date(Date.parse(value))` above a comment explaining that the native `Date` offers no
 * way to apply a format or a locale. `Date.parse` reads `nn/nn/yyyy` as US month/day/year, so
 * in a French, German, Dutch, Japanese, Thai or Chinese deployment typing `03/04/2026` meaning
 * 3 April stored 4 March — with no error, and with the field still showing the text the user
 * typed, because `MatDatepickerInput` does not rewrite it.
 *
 * Only `format()` honoured the locale, via `Intl`. That asymmetry is why this survived seven
 * locales shipping: the calendar overlay renders perfect French while the typed input is
 * misread, so there is nothing on screen to notice.
 *
 * Supplying `MAT_DATE_LOCALE` alone would not have helped — `parse()` ignores it too.
 *
 * ## Why the locale comes from `LOCALE_ID`
 *
 * `MAT_DATE_LOCALE`'s own default factory is `inject(LOCALE_ID)`, so `LOCALE_ID` is already
 * the locale Material formats dates in, and the application provides it from Layer 0's
 * `defaultLanguage`. Deriving the parsing locale from the same token is what makes "the
 * calendar, the selected date and the typed input all agree" true by construction rather than
 * by two settings being kept in step by hand.
 *
 * ## Thai dates become Gregorian here, deliberately
 *
 * `Intl.DateTimeFormat('th')` resolves to the **Buddhist** calendar, so the native adapter
 * showed 3 April 2026 as `03/04/2569`. date-fns' `th` locale is Gregorian and shows
 * `03/04/2026`. That is a real change, and it is the right way round for two reasons.
 *
 * Angular's `DatePipe` never calls `Intl` and `@angular/common/locales/th` carries no calendar
 * system, so every other date in a Thai deployment — the document list, the audit table,
 * document detail — has always rendered the Gregorian year. Only the date picker disagreed.
 *
 * And the Buddhist display was not even round-trippable by the field that produced it:
 * `Date.parse('03/04/2569')` is 4 March 2569, so a Thai user who retyped what the picker had
 * just shown them got the wrong month *and* a year 543 years out. Showing the Gregorian year
 * removes the only thing that invited that. Asserted by the `th` case in the parse table and
 * by the explicit Buddhist-year test.
 *
 * ## Why every component provides it, rather than the app root
 *
 * Same reason as `provideTranslatedDatepickerIntl()` next to it, and one more. Components that
 * import `MatNativeDateModule` get `provideNativeDateAdapter()` from that module's own
 * providers, which an app-root provider cannot override — so a root-only fix silently left
 * six of the fifteen date inputs parsing US dates. And several of these dialogs are exported
 * from `@nuxeo/satori-platform/ui`: a customer who mounts `EditCollectionDialogComponent` in
 * their own application gets our adapter with it, instead of whatever their root happens to
 * provide or a `NullInjectorError`.
 *
 * `MAT_DATE_FORMATS` comes from `provideDateFnsAdapter()`'s default, `MAT_DATE_FNS_FORMATS`,
 * whose `parse.dateInput` and `display.dateInput` are both date-fns' `P` — the locale's own
 * short date format. That is the token this application never set, and the reason a typed date
 * had no format to be parsed against.
 */
export function provideSatoriDateAdapter(): Provider[] {
  return [
    ...provideDateFnsAdapter(),
    { provide: MAT_DATE_LOCALE, useFactory: () => dateFnsLocaleFor(inject(LOCALE_ID)) },
  ];
}
