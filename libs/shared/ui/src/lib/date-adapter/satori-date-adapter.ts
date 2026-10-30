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
} from 'date-fns/locale';

/**
 * A date-fns locale for every language the application ships a catalogue for, plus the regional
 * variants date-fns ships for those languages.
 *
 * Keyed by the Angular locale id, lowercased. The five bare language ids are the ones this
 * application can actually produce — `resolveFormattingLocale` clamps `LOCALE_ID` to locales
 * that are both registered and in `availableLanguages` — and a test asserts they match
 * `availableLanguages`, so adding a language cannot quietly leave its dates being parsed as
 * English. That clamp used to read `REGISTERED_LOCALES` alone, and registering `es` ahead of its
 * catalogue was enough to admit a locale this map has no entry for (#522).
 *
 * That test is why this map holds five rather than the ten the application targets. `ar`, `es`,
 * `he`, `it` and `sv` have Angular locale data registered and are requested from Crowdin, but
 * they are not advertised until their catalogues land — so they do not belong here yet either.
 * Each arrives with its catalogue, and `ar` brings the regional variants with it: date-fns'
 * `ar-DZ`, `ar-MA` and `ar-SA` are month-first while bare `ar` is day-first, so they need their
 * own entries by the rule below or they would parse day-first through the fallback.
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
 * The same rule decides what the five pending languages bring with them. Measured, so it does
 * not have to be re-derived: `ar-DZ`, `ar-MA` and `ar-SA` are `MM/dd/yyyy` and `ar-EG` is
 * `d/MM/y` against bare `ar`'s `dd/MM/yyyy`, so all four need entries; `ar-TN` matches its base
 * and does not. `it-CH` is `dd.MM.y` against `it`'s `dd/MM/y`, so it does. date-fns ships no
 * regional variant at all for `es`, `he` or `sv`.
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
};

/** The bare language ids above, for the test that keeps this map and `availableLanguages` in step. */
export const DATE_ADAPTER_LANGUAGES: readonly string[] = Object.keys(DATE_FNS_LOCALES).filter(
  (id) => !id.includes('-'),
);

/** Exact tag, then bare language. `undefined` means this build has no data for the locale at all. */
function dateFnsLocaleOrNone(localeId: string): Locale | undefined {
  const tag = (localeId ?? '').toLowerCase().replaceAll('_', '-');
  return DATE_FNS_LOCALES[tag] ?? DATE_FNS_LOCALES[tag.split('-')[0]];
}

/**
 * Whether this build can parse dates in a locale, rather than silently reading them as English.
 *
 * This is a **packaged capability**, which is what makes it worth exporting: it depends on which
 * date-fns locales are compiled into the bundle, and nothing a deployment writes in Layer 0 can
 * change it. `availableLanguages` cannot answer the question, because a customer edits that file
 * — a config with `defaultLanguage: 'es'` and `availableLanguages: ['en', 'es']` is perfectly
 * valid and parses fine, and `es` still has no entry above.
 *
 * That gap is the second half of the #522 review. The first fix tied `LOCALE_ID` to
 * `availableLanguages`, which closed it for the packaged config — `checkAdvertisedLocalesShip`
 * governs that one — and left it open for every customer override. Angular formats dates from
 * registered locale data and Material parses them from this map; when a locale reaches one and
 * not the other, a date copied out of a list and typed into a field changes day.
 *
 * Callers that select a formatting locale must intersect their intent with this. Returns true for
 * a regional tag whose base language is present, because that is what the adapter will use.
 */
export function canFormatDatesIn(localeId: string): boolean {
  return dateFnsLocaleOrNone(localeId) !== undefined;
}

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
  // Same lookup `canFormatDatesIn` reports on, so the predicate and the resolution cannot
  // disagree about whether this build has data for a locale.
  const base = dateFnsLocaleOrNone(tag);

  // Warned only on a regional miss until #522, so a BARE language with no entry fell through to
  // `enUS` in silence — which is how `defaultLanguage: 'es'` came to display day-first Spanish
  // dates and parse them month-first without a word anywhere. The locale being admissible at all
  // is `resolveFormattingLocale`'s job and it now checks `availableLanguages`; this is the
  // backstop for every other way a locale reaches here, including a customer's own `LOCALE_ID`
  // through the published provider.
  if (!base && isDevMode()) {
    console.warn(
      `[satori-date-adapter] No date-fns locale for "${localeId}"; dates will be parsed and ` +
        'formatted as "en", which is month-first. Typed dates will be misread wherever this ' +
        'locale is not. Add it to DATE_FNS_LOCALES.',
    );
  } else if (tag !== language && isDevMode()) {
    console.warn(
      `[satori-date-adapter] No date-fns locale for "${localeId}"; dates will be parsed and ` +
        `formatted as "${language}". If that region orders or separates date ` +
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
 * in a French, German, Dutch, Japanese, Spanish, Italian or Arabic deployment typing `03/04/2026`
 * meaning 3 April stored 4 March — with no error, and with the field still showing the text the
 * user typed, because `MatDatepickerInput` does not rewrite it.
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
 * ## date-fns and `Intl` disagree about numerals and calendars, and date-fns is the one to follow
 *
 * This was found on Thai, which shipped until the language set was aligned to Web UI
 * (NXSAT-293 added it, and it was dropped again with `zh`). `Intl.DateTimeFormat('th')`
 * resolves to the **Buddhist** calendar, so the native adapter showed 3 April 2026 as
 * `03/04/2569` — and `Date.parse('03/04/2569')` reads back as 4 March, so a user who retyped
 * what the picker had just shown them got the wrong month *and* a year 543 years out. Angular's
 * `DatePipe` never calls `Intl`, so every other date on the page had always shown `2026`. Only
 * the picker disagreed, and only the picker was unparseable by itself.
 *
 * Arabic will raise the milder half of the same split when it lands, so it is recorded here
 * rather than rediscovered then. `Intl` formats `ar-EG` and `ar-SA` with **Arabic-Indic**
 * numerals (`٣/٤/٢٠٢٦`); date-fns' `ar` writes Latin ones (`03/04/2026`). Both resolve to the
 * Gregorian calendar on our ICU — measured, not assumed — so unlike Thai there is no year to get
 * wrong, and the field round-trips what it displays. That round-trip is the property this file
 * is for, so the Latin digits are the right answer and are not to be papered over with `Intl`.
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
