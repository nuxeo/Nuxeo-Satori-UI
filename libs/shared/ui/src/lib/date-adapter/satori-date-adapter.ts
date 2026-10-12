import { LOCALE_ID, Provider, inject } from '@angular/core';
import { provideDateFnsAdapter } from '@angular/material-date-fns-adapter';
import { MAT_DATE_LOCALE } from '@angular/material/core';
import type { Locale } from 'date-fns';
import { de, enUS, fr, ja, nl, th, zhCN } from 'date-fns/locale';

/**
 * A date-fns locale for every language the application ships a catalogue for.
 *
 * Keyed by the two-letter language id this application uses — the same ids as
 * `availableLanguages`, because the whole point is that one setting drives translation,
 * number formatting, date *display* and now date *parsing*. A test asserts the two lists
 * match, so adding a language cannot quietly leave its dates being parsed as English.
 *
 * `en` is present here but absent from `register-locale-data.ts`'s list: Angular bundles
 * `en-US` locale data, so registering it there would be a no-op, whereas date-fns ships no
 * region-less English and the adapter needs `enUS` named explicitly.
 */
const DATE_FNS_LOCALES: Readonly<Record<string, Locale>> = { en: enUS, fr, de, ja, nl, th, zh: zhCN };

/** The language ids above, for the test that keeps this map and `availableLanguages` in step. */
export const DATE_ADAPTER_LANGUAGES: readonly string[] = Object.keys(DATE_FNS_LOCALES);

/**
 * The date-fns locale for an Angular locale id, falling back to English.
 *
 * Region subtags are tolerated and reduced (`fr-CA` → `fr`) because `LOCALE_ID` is whatever
 * Layer 0's `defaultLanguage` was set to, and a customer can set it to anything. An id we
 * have no locale for falls back to English rather than throwing: a wrong date order is a
 * correctness defect, but an application that will not start is worse.
 */
export function dateFnsLocaleFor(localeId: string): Locale {
  const language = (localeId ?? '').toLowerCase().split(/[-_]/)[0];
  return DATE_FNS_LOCALES[language] ?? enUS;
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
 * ## Why every component provides it, rather than the app root
 *
 * Same reason as `provideTranslatedDatepickerIntl()` next to it, and one more. Components that
 * import `MatNativeDateModule` get `provideNativeDateAdapter()` from that module's own
 * providers, which an app-root provider cannot override — so a root-only fix silently left
 * six of the fifteen date inputs parsing US dates. And several of these dialogs are exported
 * from `@nuxeo-satori/platform/ui`: a customer who mounts `EditCollectionDialogComponent` in
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
