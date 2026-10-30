import { registerLocaleData } from '@angular/common';
import localeAr from '@angular/common/locales/ar';
import localeDe from '@angular/common/locales/de';
import localeEs from '@angular/common/locales/es';
import localeFr from '@angular/common/locales/fr';
import localeHe from '@angular/common/locales/he';
import localeIt from '@angular/common/locales/it';
import localeJa from '@angular/common/locales/ja';
import localeNl from '@angular/common/locales/nl';
import localeSv from '@angular/common/locales/sv';

/**
 * Angular locale data for every language we ship a catalogue for.
 *
 * ## Why this file exists
 *
 * Translating strings and formatting dates are two different mechanisms, and having the first
 * does not give you the second. `DatePipe`, `DecimalPipe` and `CurrencyPipe` format against
 * Angular's **locale data** — month names, date order, decimal separator — which is shipped
 * per-locale in `@angular/common/locales` and must be registered explicitly. Only `en-US` is
 * built in.
 *
 * Ask a pipe to format in a locale whose data is not registered and it does not degrade: it
 * throws `NG0701: Missing locale data for the locale "fr"`, which surfaces as
 * `NG02100: InvalidPipeArgument` wherever a date renders.
 *
 * ## Why it was not needed until now
 *
 * It was needed and the defect was masked. adf-core's `TranslationService` was forcing the
 * application back to `en` whenever an adf-hx surface rendered (`W14`), so no pipe was ever
 * handed `fr`. Fixing that made the locale actually apply, and the missing data threw
 * immediately — thirty-six console errors on the French pass of the evidence capture.
 *
 * That ordering is worth keeping in mind: **the i18n bug was hiding the l10n bug.** A
 * half-applied locale looks like a working one right up until it works.
 *
 * ## Adding a locale — five touchpoints, in two steps, not one change
 *
 * The order matters, and getting it wrong is not a style question: three of the five cannot
 * precede the translated catalogue, and one of those three cannot even be pushed early, because
 * `.husky/pre-push` runs `review:guardrails`.
 *
 * **Step 1 — request it.** Safe before any translation exists:
 *
 * - an entry in `LOCALE_DATA` here;
 * - a `--language` in `download_translations_args` in `.github/workflows/crowdin-pull.yaml`,
 *   which downloads only the languages listed there — so this is what *causes* the catalogue.
 *
 * **Step 2 — advertise it**, once `apps/nuxeo-ui/public/i18n/<lang>.json` has landed:
 *
 * - `availableLanguages` in both Layer 0 configs — earlier, and
 *   `checkAdvertisedLocalesShip` fails it;
 * - `DATE_FNS_LOCALES` in `libs/shared/ui/.../satori-date-adapter.ts`, easy to miss because it
 *   is in another library; a test holds it equal to `availableLanguages`, so it cannot drift
 *   silently — but that also means it cannot lead.
 *
 * A language sits between the two steps for as long as translation takes. That is the normal
 * state, not an unfinished one: nine non-English languages are registered here, the set Nuxeo
 * Web UI supports — `ar`, `de`, `es`, `fr`, `he`, `it`, `ja`, `nl`, `sv` — and **five of them
 * are mid-flight**, with `ar`, `es`, `he`, `it` and `sv` requested and awaiting Crowdin.
 *
 * Registration leading is the harmless direction, which is the whole reason step 1 can run
 * early: `checkLocaleDataRegistered` only *warns* about locale data with no catalogue behind it,
 * while the reverse throws `NG0701` wherever a date renders. See `D8e-webui`.
 *
 * `checkLocaleDataRegistered` in `scripts/review-guardrails.mjs` fails the build when a
 * catalogue has no matching registration, because the symptom otherwise appears far from the
 * cause — as a pipe error on a page that has nothing to do with the locale that was added.
 *
 * `th` and `zh` were registered until the set was aligned to Web UI; their catalogues and
 * Crowdin downloads went with them.
 *
 * `en` is not listed: Angular bundles it, and registering it would be a no-op that the
 * guardrail would then have to special-case in the opposite direction.
 */
const LOCALE_DATA: ReadonlyArray<readonly [locale: string, data: unknown]> = [
  ['ar', localeAr],
  ['de', localeDe],
  ['es', localeEs],
  ['fr', localeFr],
  ['he', localeHe],
  ['it', localeIt],
  ['ja', localeJa],
  ['nl', localeNl],
  ['sv', localeSv],
];

/** Registers Angular locale data for every non-English locale we ship. */
export function registerShippedLocaleData(): void {
  for (const [locale, data] of LOCALE_DATA) {
    registerLocaleData(data, locale);
  }
}

/** The locales registered here, for the guardrail and for tests. */
export const REGISTERED_LOCALES: readonly string[] = LOCALE_DATA.map(([locale]) => locale);
